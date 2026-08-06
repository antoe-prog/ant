import { NextRequest } from "next/server";
import type { AuditLog, Member, MemberStatus, MockDatabase } from "@/lib/domain";
import { memberInputLimits } from "@/lib/member-input-policy";
import { getAccessibleBranchIds, getAccessibleMemberIds } from "@/lib/mock-api";
import { removeMemberFromTargetedNotices } from "@/lib/notices";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { withAuthAndNotificationStateLock } from "@/server/auth-notification-state-lock";
import { preparePushDispatchJobsForUserDeletion } from "@/server/notification-outbox";
import { cancelPendingNoticePushJobs } from "@/server/notification-outbox-runner";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const memberStatuses: MemberStatus[] = ["active", "trial", "paused", "withdrawn"];
const ageGroups: Member["ageGroup"][] = ["kids", "teen", "adult"];
const memberGenders: NonNullable<Member["gender"]>[] = ["male", "female"];
type MemberPatchPayload = Partial<
  Pick<Member, "ageGroup" | "alerts" | "belt" | "emergencyContact" | "level" | "name" | "primaryCoachId" | "status">
> & {
  gender?: Member["gender"] | "";
  birthDate?: string;
  address?: string;
};
type MemberDeletePayload = {
  reason?: unknown;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}
function getMemberPatchBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "변경할 회원 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  for (const field of [
    "status",
    "ageGroup",
    "name",
    "emergencyContact",
    "level",
    "belt",
    "primaryCoachId",
    "gender",
    "birthDate",
    "address",
  ] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return "변경할 회원 값의 형식이 올바르지 않습니다.";
    }
  }

  if (body.alerts !== undefined && (!Array.isArray(body.alerts) || body.alerts.some((alert) => typeof alert !== "string"))) {
    return "주의사항 목록의 형식이 올바르지 않습니다.";
  }

  return null;
}

function isDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
}

function hasRestrictedProfileFields(body: MemberPatchPayload) {
  return (
    body.status !== undefined ||
    body.ageGroup !== undefined ||
    body.name !== undefined ||
    body.level !== undefined ||
    body.belt !== undefined ||
    body.alerts !== undefined ||
    body.primaryCoachId !== undefined ||
    body.gender !== undefined ||
    body.birthDate !== undefined ||
    body.address !== undefined
  );
}

function getLinkedMemberAccountUsers(
  db: Awaited<ReturnType<typeof readServerDb>>,
  memberId: string,
) {
  return db.users.filter(
    (candidate) =>
      (candidate.role === "member" || candidate.role === "guardian") &&
      (candidate.memberIds ?? []).includes(memberId),
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const initialDb = await readServerDb();
  const { user: initialUser, response: initialResponse } = requireSession(request, initialDb);

  if (!initialUser) {
    return initialResponse;
  }

  const initialMember = initialDb.members.find((candidate) => candidate.id === memberId);

  if (!initialMember) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  const initialAccessibleBranchIds = getAccessibleBranchIds(initialUser, initialDb);
  const initialCanReadMember = getAccessibleMemberIds(
    initialUser,
    initialDb,
    initialAccessibleBranchIds,
  ).includes(initialMember.id);

  if (!initialCanReadMember) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  const initialScope = requireSelectedBranchScope(request, initialUser, initialDb);

  if (initialScope.response) {
    return initialScope.response;
  }

  if (initialScope.selectedBranchId && initialScope.selectedBranchId !== initialMember.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const initialCanManageMember = initialUser.role === "owner" || initialUser.role === "admin";
  const initialCanUpdateOwnContact =
    (initialUser.role === "member" && (initialUser.memberIds ?? []).includes(initialMember.id)) ||
    (initialUser.role === "guardian" &&
      getAccessibleMemberIds(initialUser, initialDb, [initialMember.branchId]).includes(initialMember.id));

  if (!initialCanManageMember && !initialCanUpdateOwnContact) {
    return jsonError(403, "FORBIDDEN", "회원 정보를 변경할 권한이 없습니다.");
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getMemberPatchBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as MemberPatchPayload;

  if (Object.keys(body).length === 0) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 회원 정보가 없습니다.");
  }

  if (!initialCanManageMember && hasRestrictedProfileFields(body)) {
    return jsonError(403, "FORBIDDEN", "회원/학부모는 긴급 연락처만 변경할 수 있습니다.");
  }

  return withServerDbLock(`member-profile:${memberId}`, () => patchMember(request, memberId, body));
}

async function patchMember(request: NextRequest, memberId: string, body: MemberPatchPayload) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  const accessibleBranchIds = getAccessibleBranchIds(user, db);
  const canReadMember = getAccessibleMemberIds(user, db, accessibleBranchIds).includes(member.id);

  if (!canReadMember) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const canManageMember = user.role === "owner" || user.role === "admin";
  const canUpdateOwnContact =
    (user.role === "member" && (user.memberIds ?? []).includes(member.id)) ||
    (user.role === "guardian" && getAccessibleMemberIds(user, db, [member.branchId]).includes(member.id));

  if (!canManageMember && !canUpdateOwnContact) {
    return jsonError(403, "FORBIDDEN", "회원 정보를 변경할 권한이 없습니다.");
  }

  if (Object.keys(body).length === 0) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 회원 정보가 없습니다.");
  }

  if (!canManageMember && hasRestrictedProfileFields(body)) {
    return jsonError(403, "FORBIDDEN", "회원/학부모는 긴급 연락처만 변경할 수 있습니다.");
  }

  const patch: Partial<Member> = {};
  const now = new Date().toISOString();

  if (body.status !== undefined) {
    if (!memberStatuses.includes(body.status)) {
      return jsonError(400, "VALIDATION_ERROR", "변경할 회원 상태가 올바르지 않습니다.");
    }

    patch.status = body.status;

    if (body.status !== member.status) {
      patch.statusChangedAt = now;
      patch.withdrawnAt = body.status === "withdrawn" ? now : undefined;
    }
  }

  if (body.ageGroup !== undefined) {
    if (!ageGroups.includes(body.ageGroup)) {
      return jsonError(400, "VALIDATION_ERROR", "연령 그룹이 올바르지 않습니다.");
    }

    patch.ageGroup = body.ageGroup;
  }

  if (body.name !== undefined) {
    const name = cleanText(body.name);

    if (!name || name.length > memberInputLimits.nameLength) {
      return jsonError(400, "VALIDATION_ERROR", "회원 이름을 30자 이내로 입력해 주세요.");
    }

    patch.name = name;
  }

  if (body.emergencyContact !== undefined) {
    const emergencyContact = cleanText(body.emergencyContact);

    if (!emergencyContact || emergencyContact.length > memberInputLimits.emergencyContactLength) {
      return jsonError(400, "VALIDATION_ERROR", "긴급 연락처를 40자 이내로 입력해 주세요.");
    }

    patch.emergencyContact = emergencyContact;
  }

  if (body.level !== undefined) {
    const level = cleanText(body.level);

    if (!level || level.length > memberInputLimits.levelLength) {
      return jsonError(400, "VALIDATION_ERROR", "레벨을 30자 이내로 입력해 주세요.");
    }

    patch.level = level;
  }

  if (body.belt !== undefined) {
    const belt = cleanText(body.belt);

    if (!belt || belt.length > memberInputLimits.beltLength) {
      return jsonError(400, "VALIDATION_ERROR", "띠 정보를 30자 이내로 입력해 주세요.");
    }

    patch.belt = belt;
  }

  if (body.primaryCoachId !== undefined) {
    const primaryCoachId = cleanText(body.primaryCoachId);
    const primaryCoach = db.users.find((candidate) => candidate.id === primaryCoachId);

    if (
      !primaryCoachId ||
      !primaryCoach ||
      primaryCoach.invitationStatus === "pending" ||
      !["coach", "owner", "admin"].includes(primaryCoach.role) ||
      !primaryCoach.branchIds.includes(member.branchId)
    ) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "해당 지점의 승인된 담당 코치를 선택해 주세요.");
    }

    patch.primaryCoachId = primaryCoachId;
  }

  if (body.gender !== undefined) {
    if (body.gender === "") {
      patch.gender = undefined;
    } else if (!memberGenders.includes(body.gender)) {
      return jsonError(400, "VALIDATION_ERROR", "성별 값이 올바르지 않습니다.");
    } else {
      patch.gender = body.gender;
    }
  }

  if (body.birthDate !== undefined) {
    const birthDate = cleanText(body.birthDate) ?? "";

    if (birthDate === "") {
      patch.birthDate = undefined;
    } else if (!isDateOnly(birthDate)) {
      return jsonError(400, "VALIDATION_ERROR", "생년월일은 YYYY-MM-DD 형식으로 입력해 주세요.");
    } else if (Date.parse(birthDate) > Date.now()) {
      return jsonError(400, "VALIDATION_ERROR", "생년월일은 오늘 이전 날짜여야 합니다.");
    } else {
      patch.birthDate = birthDate;
    }
  }

  if (body.address !== undefined) {
    const address = cleanText(body.address) ?? "";

    if (address.length > memberInputLimits.addressLength) {
      return jsonError(400, "VALIDATION_ERROR", "주소는 100자 이내로 입력해 주세요.");
    }

    patch.address = address === "" ? undefined : address;
  }

  if (body.alerts !== undefined) {
    if (!Array.isArray(body.alerts)) {
      return jsonError(400, "VALIDATION_ERROR", "주의사항은 목록 형식이어야 합니다.");
    }

    const alerts = body.alerts
      .map((alert) => cleanText(alert))
      .filter((alert): alert is string => Boolean(alert));

    if (
      alerts.length > memberInputLimits.alertItems ||
      alerts.some((alert) => alert.length > memberInputLimits.alertLength)
    ) {
      return jsonError(400, "VALIDATION_ERROR", "주의사항은 8개 이하, 항목당 80자 이내로 입력해 주세요.");
    }

    patch.alerts = alerts;
  }

  if (Object.keys(patch).length === 0) {
    return jsonError(400, "VALIDATION_ERROR", "변경 가능한 회원 정보가 없습니다.");
  }

  const shouldSyncLinkedMemberAccount =
    canManageMember ||
    ((user.role === "member" || user.role === "guardian") && (user.memberIds ?? []).includes(member.id));
  const linkedMemberAccountUsers = shouldSyncLinkedMemberAccount ? getLinkedMemberAccountUsers(db, member.id) : [];
  const linkedMemberAccountUserIds = linkedMemberAccountUsers.map((candidate) => candidate.id);
  const linkedMemberAccountUserIdSet = new Set(linkedMemberAccountUserIds);
  const syncedPhone = patch.emergencyContact !== undefined ? normalizePhoneNumber(patch.emergencyContact) : null;

  if (linkedMemberAccountUsers.length > 0 && syncedPhone !== null) {
    if (!isValidKoreanMobileNumber(syncedPhone)) {
      return jsonError(400, "VALIDATION_ERROR", "회원 앱 계정 연락처는 휴대폰 번호 형식이어야 합니다.");
    }

    if (db.users.some((candidate) => !linkedMemberAccountUserIdSet.has(candidate.id) && samePhoneNumber(candidate.phone, syncedPhone))) {
      return jsonError(409, "CONFLICT", "이미 등록된 휴대폰 번호입니다.");
    }
  }

  const before = Object.fromEntries(
    Object.keys(patch).map((key) => [key, member[key as keyof Member]]),
  );
  const nextMember = { ...member, ...patch };
  const after = Object.fromEntries(
    Object.keys(patch).map((key) => [key, nextMember[key as keyof Member]]),
  );
  const nextUsers = linkedMemberAccountUsers.length > 0
    ? db.users.map((candidate) =>
        linkedMemberAccountUserIdSet.has(candidate.id)
          ? {
              ...candidate,
              ...(patch.name !== undefined ? { name: nextMember.name } : {}),
              ...(syncedPhone !== null ? { phone: syncedPhone } : {}),
            }
          : candidate,
      )
    : db.users;

  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: member.branchId,
    actorUserId: user.id,
    action: "member.update",
    targetType: "member",
    targetId: member.id,
    before,
    after: {
      ...after,
      ...(linkedMemberAccountUserIds.length > 0 ? { syncedUserIds: linkedMemberAccountUserIds } : {}),
    },
    result: "success",
    message: canManageMember ? "회원 정보를 변경했습니다." : "회원 긴급 연락처를 변경했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    members: db.members.map((candidate) =>
      candidate.id === member.id ? nextMember : candidate,
    ),
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? member.branchId));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const initialDb = await readServerDb();
  const { user: initialUser, response: initialResponse } = requireSession(request, initialDb);

  if (!initialUser) {
    return initialResponse;
  }

  if (!["owner", "admin"].includes(initialUser.role)) {
    return jsonError(403, "FORBIDDEN", "대표 또는 총괄 어드민만 회원을 삭제할 수 있습니다.");
  }

  const initialMember = initialDb.members.find((candidate) => candidate.id === memberId);

  if (!initialMember || !getAccessibleBranchIds(initialUser, initialDb).includes(initialMember.branchId)) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  const initialScope = requireSelectedBranchScope(request, initialUser, initialDb);

  if (initialScope.response) {
    return initialScope.response;
  }

  if (initialScope.selectedBranchId && initialScope.selectedBranchId !== initialMember.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const rawBody = await request.json().catch(() => null);

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "회원 삭제 정보를 확인해 주세요.");
  }

  const body = rawBody as MemberDeletePayload;

  if (typeof body.reason !== "string") {
    return jsonError(400, "VALIDATION_ERROR", "회원 삭제 사유의 형식이 올바르지 않습니다.");
  }

  const reason = body.reason.trim();

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "회원 삭제 사유가 필요합니다.");
  }

  if (reason.length > memberInputLimits.deleteReasonLength) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      `회원 삭제 사유는 ${memberInputLimits.deleteReasonLength}자 이내로 입력해 주세요.`,
    );
  }

  return withAuthAndNotificationStateLock(() =>
    withServerDbLock(`member-profile:${memberId}`, async () => {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return response;
    }

    if (!["owner", "admin"].includes(user.role)) {
      return jsonError(403, "FORBIDDEN", "대표 또는 총괄 어드민만 회원을 삭제할 수 있습니다.");
    }

    const member = db.members.find((candidate) => candidate.id === memberId);

    if (!member || !getAccessibleBranchIds(user, db).includes(member.branchId)) {
      return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
    }

    const removedClassEnrollmentCount = db.classes.filter((session) =>
      session.enrolledMemberIds.includes(member.id),
    ).length;
    const removedAttendanceCount = db.attendance.filter((record) => record.memberId === member.id).length;
    const removedPaymentCount = db.payments.filter((payment) => payment.memberId === member.id).length;
    const removedPromotionCount = db.promotions.filter((promotion) => promotion.memberId === member.id).length;
    const removedCounselingNoteCount = db.counselingNotes.filter((note) => note.memberId === member.id).length;
    const removedNoticeTargetCount = db.notices.filter((notice) =>
      (notice.targetMemberIds ?? []).includes(member.id),
    ).length;
    const noticeCleanup = removeMemberFromTargetedNotices(db.notices, member.id);
    const removedQrRedemptionCount = db.attendanceQrChallenges.filter((challenge) =>
      challenge.redeemedMemberIds.includes(member.id),
    ).length;
    const removedTournamentRegistrationCount = db.tournaments.reduce(
      (count, tournament) =>
        count + (tournament.registrations ?? []).filter((registration) => registration.memberId === member.id).length,
      0,
    );
    const deletedUserIds = new Set(
      db.users
        .filter((candidate) => {
          if (
            candidate.id === user.id ||
            candidate.role !== "member" ||
            !(candidate.memberIds ?? []).includes(member.id)
          ) {
            return false;
          }

          return (candidate.memberIds ?? []).filter((candidateMemberId) => candidateMemberId !== member.id).length === 0;
        })
        .map((candidate) => candidate.id),
    );
    let pushCleanupDb = db;
    let cancelledPushJobCount = 0;

    for (const deletedUserId of deletedUserIds) {
      const pushCleanup = preparePushDispatchJobsForUserDeletion(pushCleanupDb, deletedUserId, {
        now: new Date().toISOString(),
        reason: "연결 회원 삭제로 알림 발송을 취소했습니다.",
      });

      if (!pushCleanup.ok) {
        return jsonError(
          409,
          "BUSINESS_RULE_FAILED",
          "연결 계정의 휴대폰 알림 발송이 처리 중입니다. 잠시 후 다시 삭제해 주세요.",
        );
      }

      pushCleanupDb = pushCleanup.db as MockDatabase;
      cancelledPushJobCount += pushCleanup.cancelledJobCount;
    }
    const nextUsers = db.users
      .filter((candidate) => !deletedUserIds.has(candidate.id))
      .map((candidate) => ({
        ...candidate,
        ...(candidate.memberIds
          ? { memberIds: candidate.memberIds.filter((candidateMemberId) => candidateMemberId !== member.id) }
          : {}),
        ...(candidate.childMemberIds
          ? { childMemberIds: candidate.childMemberIds.filter((candidateMemberId) => candidateMemberId !== member.id) }
          : {}),
      }));
    const now = new Date().toISOString();
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: member.branchId,
      actorUserId: user.id,
      action: "member.delete",
      targetType: "member",
      targetId: member.id,
      before: {
        ageGroup: member.ageGroup,
        branchId: member.branchId,
        name: member.name,
        status: member.status,
      },
      after: {
        reason,
        cancelledPushJobCount,
        deletedUserCount: deletedUserIds.size,
        removedAttendanceCount,
        removedClassEnrollmentCount,
        removedCounselingNoteCount,
        removedNoticeCount: noticeCleanup.deletedNoticeIds.length,
        removedNoticeTargetCount,
        removedPaymentCount,
        removedPromotionCount,
        removedQrRedemptionCount,
        removedTournamentRegistrationCount,
      },
      result: "success",
      message: "회원과 연결된 운영 기록을 삭제했습니다.",
      createdAt: now,
    };
    const nextDbBeforeNoticeCancellation: MockDatabase = {
      ...pushCleanupDb,
      members: db.members.filter((candidate) => candidate.id !== member.id),
      users: nextUsers,
      classes: db.classes.map((session) => ({
        ...session,
        enrolledMemberIds: session.enrolledMemberIds.filter((candidate) => candidate !== member.id),
      })),
      attendance: db.attendance.filter((record) => record.memberId !== member.id),
      counselingNotes: db.counselingNotes.filter((note) => note.memberId !== member.id),
      promotions: db.promotions.filter((promotion) => promotion.memberId !== member.id),
      tournaments: db.tournaments.map((tournament) => ({
        ...tournament,
        registrations: (tournament.registrations ?? []).filter(
          (registration) => registration.memberId !== member.id,
        ),
      })),
      payments: db.payments.filter((payment) => payment.memberId !== member.id),
      notices: noticeCleanup.notices.map((notice) => ({
        ...notice,
        readByUserIds: notice.readByUserIds.filter((readByUserId) => !deletedUserIds.has(readByUserId)),
      })),
      attendanceQrChallenges: db.attendanceQrChallenges.map((challenge) => ({
        ...challenge,
        redeemedMemberIds: challenge.redeemedMemberIds.filter((candidate) => candidate !== member.id),
      })),
      authSessions: db.authSessions.filter((session) => !deletedUserIds.has(session.userId)),
      passwordResetChallenges: db.passwordResetChallenges.filter((challenge) => !deletedUserIds.has(challenge.userId)),
      pushSubscriptions: db.pushSubscriptions.filter((subscription) => !deletedUserIds.has(subscription.userId)),
      auditLogs: [auditLog, ...pushCleanupDb.auditLogs],
    };
    const nextDbWithCancelledNoticeJobs = noticeCleanup.changedNoticeIds.reduce<MockDatabase>(
      (candidateDb, noticeId) =>
        cancelPendingNoticePushJobs(
          candidateDb,
          noticeId,
          "회원 삭제로 공지 대상이 변경되어 대기 중인 발송 요청을 취소했습니다.",
          now,
        ),
      nextDbBeforeNoticeCancellation,
    );
    const nextDb = await writeServerDb(nextDbWithCancelledNoticeJobs);

    return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? member.branchId));
    }),
  );
}
