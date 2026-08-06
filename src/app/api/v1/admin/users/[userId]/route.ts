import { NextRequest } from "next/server";
import type { AppUser, AuditLog, Member, UserRole } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import {
  findAdultGuardianChildMemberIds,
  findInvalidFamilyMemberLinkIds,
  findNonAdultGuardianSelfMemberIds,
} from "@/lib/family-members";
import { getNoticeReadByUserIds } from "@/lib/notices";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { getUserAdministrationInputLimitError } from "@/lib/user-administration-input-policy";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { withAuthAndNotificationStateLock } from "@/server/auth-notification-state-lock";
import { createRandomPasswordHash, defaultPilotPassword } from "@/server/auth-password";
import { readUnmodifiedPassword, revokeUserSecurityAccess } from "@/server/auth-session";
import { consumePasswordResetChallenges } from "@/server/password-reset";
import { createRuntimeId } from "@/server/runtime-id";
import { hasInFlightPushDispatchForUser, preparePushDispatchJobsForUserDeletion } from "@/server/notification-outbox";
import { isActiveAdmin } from "@/server/user-administration";
import {
  findAcceptedBranchOperatorId,
  findOwnerCoverageBlockers,
  reassignUserOperationalLinks,
  summarizeOperationalReassignmentBlockers,
} from "@/server/user-operational-reassignment";

export const runtime = "nodejs";

type UserUpdateBody = {
  branchIds?: unknown;
  childMemberIds?: unknown;
  email?: unknown;
  memberIds?: unknown;
  name?: unknown;
  password?: unknown;
  phone?: unknown;
  reason?: unknown;
  role?: unknown;
  title?: unknown;
};

type UserDeleteBody = {
  reason?: unknown;
};

const userUpdateFields = [
  "branchIds",
  "childMemberIds",
  "email",
  "memberIds",
  "name",
  "password",
  "phone",
  "role",
  "title",
] as const satisfies readonly (keyof UserUpdateBody)[];

function isObjectBody(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getUserUpdateBodyTypeError(body: Record<string, unknown>) {
  for (const field of ["email", "name", "password", "phone", "reason", "role", "title"] as const) {
    if (field in body && typeof body[field] !== "string") {
      return "수정할 사용자 값의 형식이 올바르지 않습니다.";
    }
  }

  for (const field of ["branchIds", "childMemberIds", "memberIds"] as const) {
    if (
      field in body &&
      (!Array.isArray(body[field]) || body[field].some((memberId) => typeof memberId !== "string"))
    ) {
      return "사용자 연결 값의 형식이 올바르지 않습니다.";
    }
  }

  return null;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalIdList(ids: string[]) {
  return [...new Set(ids)].sort().join("\u0000");
}

function cleanEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function cleanBranchIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((branchId): branchId is string => typeof branchId === "string").map((branchId) => branchId.trim()).filter(Boolean))];
}

function cleanMemberIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((memberId): memberId is string => typeof memberId === "string").map((memberId) => memberId.trim()).filter(Boolean))];
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function findMemberAccountConflicts(
  db: Awaited<ReturnType<typeof readServerDb>>,
  targetUserId: string,
  memberIds: string[],
) {
  return memberIds.filter((memberId) =>
    db.users.some(
      (candidate) => candidate.id !== targetUserId && (candidate.memberIds ?? []).includes(memberId),
    ),
  );
}

function syncGuardianMemberLinks(
  db: Awaited<ReturnType<typeof readServerDb>>,
  targetUserId: string,
  nextRole: UserRole,
  nextChildMemberIds: string[],
) {
  const nextChildMemberIdSet = new Set(nextChildMemberIds);

  return db.members.map((member) => {
    const withoutTargetGuardian = member.guardianIds.filter((guardianId) => guardianId !== targetUserId);
    const guardianIds =
      nextRole === "guardian" && nextChildMemberIdSet.has(member.id)
        ? [...withoutTargetGuardian, targetUserId]
        : withoutTargetGuardian;

    return guardianIds.length === member.guardianIds.length &&
      guardianIds.every((guardianId, index) => guardianId === member.guardianIds[index])
      ? member
      : {
          ...member,
          guardianIds,
      };
  });
}

function syncMemberAccountProfileLinks(
  db: Awaited<ReturnType<typeof readServerDb>>,
  nextRole: UserRole,
  nextMemberIds: string[],
  nextName: string,
  nextPhone: string,
) {
  const nextMemberIdSet = new Set(
    nextRole === "member" || nextRole === "guardian" ? nextMemberIds : [],
  );

  return db.members.map((member) =>
    nextMemberIdSet.has(member.id)
      ? {
          ...member,
          emergencyContact: nextPhone,
          name: nextName,
        }
      : member,
  );
}

function createUserAuditLog({
  action,
  actorUserId,
  after,
  before,
  branchId,
  message,
  targetId,
}: {
  action: "user.update" | "user.delete";
  actorUserId: string;
  after: AuditLog["after"];
  before: AuditLog["before"];
  branchId: string | null;
  message: string;
  targetId: string;
}): AuditLog {
  return {
    id: createRuntimeId("audit"),
    branchId,
    actorUserId,
    action,
    targetType: "user",
    targetId,
    before,
    after,
    result: "success",
    message,
    createdAt: new Date().toISOString(),
  };
}

function findBlockingDeleteReasons(targetUser: AppUser, db: Awaited<ReturnType<typeof readServerDb>>) {
  const orphanBranchNames = findOwnerCoverageBlockers(targetUser, null, [], db);
  return orphanBranchNames.length > 0 ? [`대표 미배정 지점: ${orphanBranchNames.join(", ")}`] : [];
}

function createSafeActor(db: Awaited<ReturnType<typeof readServerDb>>, user: AppUser) {
  return db.users.find((candidate) => candidate.id === user.id) ?? user;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const initialDb = await readServerDb();
  const { user: initialUser, response } = requireSession(request, initialDb);

  if (!initialUser) {
    return response;
  }

  if (initialUser.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자를 수정할 수 있습니다.");
  }

  const initialScope = requireSelectedBranchScope(request, initialUser, initialDb);

  if (initialScope.response) {
    return initialScope.response;
  }

  const rawBody = await request.json().catch(() => null);

  if (!isObjectBody(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "수정할 사용자 정보를 확인해 주세요.");
  }

  const bodyTypeError = getUserUpdateBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const inputLimitError = getUserAdministrationInputLimitError(rawBody);

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  const body = rawBody as UserUpdateBody;

  if (!userUpdateFields.some((field) => field in body)) {
    return jsonError(400, "VALIDATION_ERROR", "수정할 사용자 정보가 필요합니다.");
  }

  return withAuthAndNotificationStateLock(async () => {
    const db = await readServerDb();
    const { user, response: freshSessionResponse } = requireSession(request, db);

    if (!user) {
      return freshSessionResponse;
    }

    if (user.role !== "admin") {
      return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자를 수정할 수 있습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    const reason = cleanText(body?.reason) || "-";

  const targetUser = db.users.find((candidate) => candidate.id === userId);

  if (!targetUser) {
    return jsonError(404, "NOT_FOUND", "사용자를 찾을 수 없습니다.");
  }

  if (selectedScope.selectedBranchId && !targetUser.branchIds.includes(selectedScope.selectedBranchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 사용자만 수정할 수 있습니다.");
  }

  const nextRole = body && "role" in body ? body.role : targetUser.role;

  if (!userRoles.includes(nextRole as UserRole)) {
    return jsonError(400, "VALIDATION_ERROR", "역할이 올바르지 않습니다.");
  }

  if (targetUser.id === user.id && targetUser.role === "admin" && nextRole !== "admin") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "현재 로그인한 총괄 어드민은 자신의 권한을 제거할 수 없습니다.");
  }

  const nextName = body && "name" in body ? cleanText(body.name) : targetUser.name;
  const nextTitle = body && "title" in body ? cleanText(body.title) : targetUser.title;
  const nextEmail = body && "email" in body ? cleanEmail(body.email) : targetUser.email?.toLowerCase() ?? "";
  const nextPhone = body && "phone" in body ? normalizePhoneNumber(cleanText(body.phone)) : normalizePhoneNumber(targetUser.phone ?? "");
  const nextPassword = body && "password" in body ? readUnmodifiedPassword(body.password) : "";

  if (!nextName || !nextTitle || !nextPhone) {
    return jsonError(400, "VALIDATION_ERROR", "이름, 휴대폰 번호, 설명은 비워둘 수 없습니다.");
  }

  if (!isValidKoreanMobileNumber(nextPhone)) {
    return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호 형식이 올바르지 않습니다.");
  }

  if (nextEmail && !isValidEmail(nextEmail)) {
    return jsonError(400, "VALIDATION_ERROR", "이메일 형식이 올바르지 않습니다.");
  }

  if (db.users.some((candidate) => candidate.id !== targetUser.id && samePhoneNumber(candidate.phone, nextPhone))) {
    return jsonError(409, "CONFLICT", "이미 등록된 휴대폰 번호입니다.");
  }

  if (nextEmail && db.users.some((candidate) => candidate.id !== targetUser.id && candidate.email?.toLowerCase() === nextEmail)) {
    return jsonError(409, "CONFLICT", "이미 등록된 이메일입니다.");
  }

  if (nextPassword === defaultPilotPassword) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "다른 새 비밀번호를 입력해 주세요.");
  }

  if (nextPassword && nextPassword.length < 12) {
    return jsonError(400, "VALIDATION_ERROR", "새 비밀번호는 12자 이상이어야 합니다.");
  }

  const requestedBranchIds = body && "branchIds" in body ? cleanBranchIds(body.branchIds) : targetUser.branchIds;
  const nextBranchIds =
    nextRole === "admin"
      ? db.branches.map((branch) => branch.id)
      : requestedBranchIds.filter((branchId) => db.branches.some((branch) => branch.id === branchId));

  if (nextRole !== "admin" && nextBranchIds.length === 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "총괄 어드민 외 역할은 최소 1개 지점이 필요합니다.");
  }

  if (selectedScope.selectedBranchId && nextRole !== "admin" && !nextBranchIds.includes(selectedScope.selectedBranchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점 배정은 유지해야 합니다.");
  }

  const ownerCoverageBlockers = findOwnerCoverageBlockers(
    targetUser,
    nextRole as UserRole,
    nextBranchIds,
    db,
  );

  if (ownerCoverageBlockers.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "다른 대표를 먼저 배정해 주세요.", {
      branchNames: ownerCoverageBlockers,
    });
  }

  const requestedMemberIds = body && "memberIds" in body ? cleanMemberIds(body.memberIds) : targetUser.memberIds ?? [];
  const requestedChildMemberIds = body && "childMemberIds" in body ? cleanMemberIds(body.childMemberIds) : targetUser.childMemberIds ?? [];
  let nextMemberIds = nextRole === "member" || nextRole === "guardian" ? requestedMemberIds : [];
  const nextChildMemberIds = nextRole === "guardian" ? requestedChildMemberIds : [];
  let provisionedMember: Member | null = null;

  if (nextRole === "member" && nextMemberIds.length === 0) {
    const existingOperationalLinks = reassignUserOperationalLinks({
      db,
      nextBranchIds,
      nextRole: nextRole as UserRole,
      targetUserId: targetUser.id,
    });

    if (existingOperationalLinks.blockers.length > 0) {
      return jsonError(
        422,
        "BUSINESS_RULE_FAILED",
        "같은 지점의 인계 가능 담당자를 먼저 배정해 주세요.",
        summarizeOperationalReassignmentBlockers(existingOperationalLinks.blockers, db),
      );
    }

    const identityMatches = db.members.filter(
      (member) =>
        nextBranchIds.includes(member.branchId) &&
        member.name.trim() === nextName &&
        samePhoneNumber(member.emergencyContact, nextPhone),
    );
    const conflictingMatches = identityMatches.filter((member) =>
      db.users.some(
        (candidate) => candidate.id !== targetUser.id && (candidate.memberIds ?? []).includes(member.id),
      ),
    );
    const availableMatches = identityMatches.filter(
      (member) => !conflictingMatches.some((conflict) => conflict.id === member.id),
    );

    if (conflictingMatches.length > 0) {
      return jsonError(409, "CONFLICT", "동일한 회원 프로필이 이미 다른 계정에 연결되어 있습니다.");
    }

    if (availableMatches.length > 1) {
      return jsonError(409, "CONFLICT", "동일한 회원 프로필이 여러 개입니다. 앱 연결 회원을 직접 선택해 주세요.");
    }

    if (availableMatches[0]) {
      nextMemberIds = [availableMatches[0].id];
    } else {
      const memberBranchId =
        selectedScope.selectedBranchId && nextBranchIds.includes(selectedScope.selectedBranchId)
          ? selectedScope.selectedBranchId
          : nextBranchIds[0];
      const prospectiveDb = {
        ...db,
        users: db.users.map((candidate) =>
          candidate.id === targetUser.id
            ? { ...candidate, branchIds: nextBranchIds, role: nextRole as UserRole }
            : candidate,
        ),
      };
      const primaryCoachId = memberBranchId ? findAcceptedBranchOperatorId(prospectiveDb, memberBranchId) : null;

      if (!memberBranchId || !primaryCoachId) {
        return jsonError(422, "BUSINESS_RULE_FAILED", "담당 지점의 승인된 코치, 대표 또는 어드민을 먼저 배정해 주세요.");
      }

      const now = new Date().toISOString();
      provisionedMember = {
        id: createRuntimeId("member"),
        alerts: [],
        ageGroup: "adult",
        belt: "흰띠",
        branchId: memberBranchId,
        createdAt: now,
        emergencyContact: nextPhone,
        guardianIds: [],
        level: "입문",
        name: nextName,
        primaryCoachId,
        status: "active",
        statusChangedAt: now,
      };
      nextMemberIds = [provisionedMember.id];
    }
  }

  const dbWithProvisionedMember = provisionedMember
    ? { ...db, members: [provisionedMember, ...db.members] }
    : db;
  const invalidLinkedMemberIds = findInvalidFamilyMemberLinkIds(
    dbWithProvisionedMember.members,
    [...nextMemberIds, ...nextChildMemberIds],
    nextBranchIds,
  );

  if (invalidLinkedMemberIds.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "연결할 회원이 담당 지점에 포함되어 있지 않습니다.", {
      memberIds: invalidLinkedMemberIds,
    });
  }

  const adultGuardianChildMemberIds =
    nextRole === "guardian" ? findAdultGuardianChildMemberIds(dbWithProvisionedMember.members, nextChildMemberIds) : [];

  if (adultGuardianChildMemberIds.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "성인 회원은 학부모 자녀로 연결할 수 없습니다.", {
      memberIds: adultGuardianChildMemberIds,
    });
  }

  const nonAdultGuardianSelfMemberIds =
    nextRole === "guardian" ? findNonAdultGuardianSelfMemberIds(dbWithProvisionedMember.members, nextMemberIds) : [];

  if (nonAdultGuardianSelfMemberIds.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "학부모 본인 수련에는 성인 회원만 연결할 수 있습니다.", {
      memberIds: nonAdultGuardianSelfMemberIds,
    });
  }

  const duplicateFamilyMemberIds = nextMemberIds.filter((memberId) => nextChildMemberIds.includes(memberId));

  if (duplicateFamilyMemberIds.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "같은 회원을 본인과 자녀로 동시에 연결할 수 없습니다.", {
      memberIds: duplicateFamilyMemberIds,
    });
  }

  const memberAccountConflicts = findMemberAccountConflicts(dbWithProvisionedMember, targetUser.id, nextMemberIds);

  if (memberAccountConflicts.length > 0) {
    return jsonError(409, "CONFLICT", "이미 다른 계정의 본인 회원으로 연결된 회원입니다.", {
      memberIds: memberAccountConflicts,
    });
  }

  const nextTargetUser: AppUser = {
    ...targetUser,
    branchIds: nextBranchIds,
    ...(nextEmail ? { email: nextEmail } : { email: undefined }),
    name: nextName,
    phone: nextPhone,
    ...(nextPassword
      ? {
          passwordHash: createRandomPasswordHash(nextPassword),
          passwordResetRequestedAt: undefined,
          passwordUpdatedAt: new Date().toISOString(),
        }
      : {}),
    role: nextRole as UserRole,
    title: nextTitle,
  };

  if (nextRole === "member" || nextRole === "guardian") {
    nextTargetUser.memberIds = nextMemberIds;
  } else {
    delete nextTargetUser.memberIds;
  }

  if (nextRole === "guardian") {
    nextTargetUser.childMemberIds = nextChildMemberIds;
  } else {
    delete nextTargetUser.childMemberIds;
  }

  const nextUsers = db.users.map((candidate) =>
    candidate.id === targetUser.id ? nextTargetUser : candidate,
  );
  const nextMembersAfterGuardianSync = syncGuardianMemberLinks(
    dbWithProvisionedMember,
    targetUser.id,
    nextRole as UserRole,
    nextChildMemberIds,
  );
  const nextMembers = syncMemberAccountProfileLinks(
    { ...db, members: nextMembersAfterGuardianSync },
    nextRole as UserRole,
    nextMemberIds,
    nextName,
    nextPhone,
  );
  const operationalLinks = reassignUserOperationalLinks({
    db: { ...db, users: nextUsers, members: nextMembers },
    nextBranchIds,
    nextRole: nextRole as UserRole,
    targetUserId: targetUser.id,
  });

  if (operationalLinks.blockers.length > 0) {
    return jsonError(
      422,
      "BUSINESS_RULE_FAILED",
      "같은 지점의 인계 가능 담당자를 먼저 배정해 주세요.",
      summarizeOperationalReassignmentBlockers(operationalLinks.blockers, db),
    );
  }

  const adminCount = nextUsers.filter(isActiveAdmin).length;

  if (adminCount < 1) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "최소 1명의 총괄 어드민이 필요합니다.");
  }

  const authorizationContextChanged =
    nextRole !== targetUser.role ||
    canonicalIdList(nextBranchIds) !== canonicalIdList(targetUser.branchIds) ||
    canonicalIdList(nextMemberIds) !== canonicalIdList(targetUser.memberIds ?? []) ||
    canonicalIdList(nextChildMemberIds) !== canonicalIdList(targetUser.childMemberIds ?? []);
  const securityContextChanged = Boolean(nextPassword) || authorizationContextChanged;

  if (authorizationContextChanged && hasInFlightPushDispatchForUser(db, targetUser.id)) {
    return jsonError(
      409,
      "BUSINESS_RULE_FAILED",
      "휴대폰 알림 발송이 처리 중입니다. 잠시 후 역할, 지점 또는 회원 연결을 다시 변경해 주세요.",
    );
  }

  const auditLog = createUserAuditLog({
    action: "user.update",
    actorUserId: user.id,
    branchId: nextBranchIds[0] ?? null,
    targetId: targetUser.id,
    before: {
      branchIds: targetUser.branchIds,
      childMemberIds: targetUser.childMemberIds ?? [],
      email: targetUser.email ?? null,
      memberIds: targetUser.memberIds ?? [],
      name: targetUser.name,
      passwordUpdatedAt: targetUser.passwordUpdatedAt ?? null,
      phone: targetUser.phone ?? null,
      role: targetUser.role,
      title: targetUser.title,
    },
    after: {
      branchIds: nextBranchIds,
      childMemberIds: nextChildMemberIds,
      email: nextEmail || null,
      memberIds: nextMemberIds,
      name: nextName,
      passwordUpdated: Boolean(nextPassword),
      phone: nextPhone,
      reason,
      reassignedClassCount: operationalLinks.reassignedClassCount,
      reassignedMemberCount: operationalLinks.reassignedMemberCount,
      role: nextRole,
      memberProfileProvisioned: Boolean(provisionedMember),
      syncedMemberIds: nextRole === "member" ? nextMemberIds : [],
      title: nextTitle,
    },
    message: "사용자 정보를 수정했습니다.",
  });
  const updatedDb = {
    ...db,
    classes: operationalLinks.classes,
    members: operationalLinks.members,
    users: nextUsers,
    auditLogs: [
      auditLog,
      ...(provisionedMember
        ? [{
            id: createRuntimeId("audit"),
            branchId: provisionedMember.branchId,
            actorUserId: user.id,
            action: "member.create" as const,
            targetType: "member" as const,
            targetId: provisionedMember.id,
            before: null,
            after: {
              accountUserId: targetUser.id,
              ageGroup: provisionedMember.ageGroup,
              branchId: provisionedMember.branchId,
              status: provisionedMember.status,
            },
            result: "success" as const,
            message: "회원 계정 저장 시 회원 프로필을 생성했습니다.",
            createdAt: provisionedMember.createdAt ?? new Date().toISOString(),
          }]
        : []),
      ...db.auditLogs,
    ],
  };
  const securedDb = securityContextChanged ? revokeUserSecurityAccess(updatedDb, targetUser.id) : updatedDb;
  const nextDb = await writeServerDb(
    nextPassword ? consumePasswordResetChallenges(securedDb, targetUser.id) : securedDb,
  );

    return jsonOk(createBootstrapPayload(nextDb, createSafeActor(nextDb, user), selectedScope.selectedBranchId));
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const initialDb = await readServerDb();
  const { user: initialUser, response } = requireSession(request, initialDb);

  if (!initialUser) {
    return response;
  }

  if (initialUser.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자를 삭제할 수 있습니다.");
  }

  const initialScope = requireSelectedBranchScope(request, initialUser, initialDb);

  if (initialScope.response) {
    return initialScope.response;
  }

  const rawBody = await request.json().catch(() => null);

  if (!isObjectBody(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "사용자 삭제 정보를 확인해 주세요.");
  }

  if (typeof rawBody.reason !== "string") {
    return jsonError(400, "VALIDATION_ERROR", "사용자 삭제 사유의 형식이 올바르지 않습니다.");
  }

  const inputLimitError = getUserAdministrationInputLimitError(rawBody);

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  const body = rawBody as UserDeleteBody;
  const reason = cleanText(body.reason);

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "사용자 삭제 사유가 필요합니다.");
  }

  return withAuthAndNotificationStateLock(async () => {
    const db = await readServerDb();
    const { user, response: freshSessionResponse } = requireSession(request, db);

    if (!user) {
      return freshSessionResponse;
    }

    if (user.role !== "admin") {
      return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자를 삭제할 수 있습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

  const targetUser = db.users.find((candidate) => candidate.id === userId);

  if (!targetUser) {
    return jsonError(404, "NOT_FOUND", "사용자를 찾을 수 없습니다.");
  }

  if (selectedScope.selectedBranchId && !targetUser.branchIds.includes(selectedScope.selectedBranchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 사용자만 삭제할 수 있습니다.");
  }

  if (targetUser.id === user.id) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "현재 로그인한 계정은 삭제할 수 없습니다.");
  }

  if (isActiveAdmin(targetUser) && db.users.filter(isActiveAdmin).length <= 1) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "최소 1명의 총괄 어드민이 필요합니다.");
  }

  const blockingReasons = findBlockingDeleteReasons(targetUser, db);

  if (blockingReasons.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "연결된 운영 항목이 있어 삭제할 수 없습니다.", {
      blockingReasons,
    });
  }

  const operationalLinks = reassignUserOperationalLinks({
    db,
    nextBranchIds: [],
    nextRole: null,
    targetUserId: targetUser.id,
  });

  if (operationalLinks.blockers.length > 0) {
    return jsonError(
      422,
      "BUSINESS_RULE_FAILED",
      "같은 지점의 인계 가능 담당자를 먼저 배정해 주세요.",
      summarizeOperationalReassignmentBlockers(operationalLinks.blockers, db),
    );
  }

  const pushCleanup = preparePushDispatchJobsForUserDeletion(db, targetUser.id, {
    now: new Date().toISOString(),
    reason: "사용자 계정 삭제로 알림 발송을 취소했습니다.",
  });

  if (!pushCleanup.ok) {
    return jsonError(
      409,
      "BUSINESS_RULE_FAILED",
      "휴대폰 알림 발송이 처리 중입니다. 잠시 후 다시 삭제해 주세요.",
    );
  }

  const auditLog = createUserAuditLog({
    action: "user.delete",
    actorUserId: user.id,
    branchId: targetUser.branchIds[0] ?? null,
    targetId: targetUser.id,
    before: {
      branchIds: targetUser.branchIds,
      email: targetUser.email ?? null,
      invitationStatus: targetUser.invitationStatus ?? null,
      name: targetUser.name,
      phone: targetUser.phone ?? null,
      role: targetUser.role,
      title: targetUser.title,
    },
    after: {
      reason,
      cancelledPushJobCount: pushCleanup.cancelledJobCount,
      reassignedClassCount: operationalLinks.reassignedClassCount,
      reassignedMemberCount: operationalLinks.reassignedMemberCount,
    },
    message: "사용자 계정을 삭제했습니다.",
  });
  const nextDb = await writeServerDb({
    ...pushCleanup.db,
    users: pushCleanup.db.users.filter((candidate) => candidate.id !== targetUser.id),
    classes: operationalLinks.classes,
    members: operationalLinks.members.map((member) => ({
      ...member,
      guardianIds: member.guardianIds.filter((guardianId) => guardianId !== targetUser.id),
    })),
    notices: pushCleanup.db.notices.map((notice) => ({
      ...notice,
      readByUserIds: getNoticeReadByUserIds(notice).filter((readByUserId) => readByUserId !== targetUser.id),
    })),
    authSessions: pushCleanup.db.authSessions.filter((session) => session.userId !== targetUser.id),
    passwordResetChallenges: pushCleanup.db.passwordResetChallenges.filter((challenge) => challenge.userId !== targetUser.id),
    pushSubscriptions: pushCleanup.db.pushSubscriptions.filter((subscription) => subscription.userId !== targetUser.id),
    auditLogs: [auditLog, ...pushCleanup.db.auditLogs],
  });

    return jsonOk(createBootstrapPayload(nextDb, createSafeActor(nextDb, user), selectedScope.selectedBranchId));
  });
}
