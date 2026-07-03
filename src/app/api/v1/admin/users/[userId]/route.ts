import { NextRequest } from "next/server";
import type { AppUser, AuditLog, UserRole } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { canMemberHaveGuardianLink } from "@/lib/member-age-policy";
import { getNoticeReadByUserIds } from "@/lib/notices";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRandomPasswordHash, defaultPilotPassword } from "@/server/auth-password";

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

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function findInvalidLinkedMemberIds(
  db: Awaited<ReturnType<typeof readServerDb>>,
  memberIds: string[],
  branchIds: string[],
) {
  return memberIds.filter(
    (memberId) => !db.members.some((member) => member.id === memberId && branchIds.includes(member.branchId)),
  );
}

function findAdultGuardianChildMemberIds(db: Awaited<ReturnType<typeof readServerDb>>, memberIds: string[]) {
  return memberIds.filter((memberId) => {
    const member = db.members.find((candidate) => candidate.id === memberId);

    return member ? !canMemberHaveGuardianLink(member) : false;
  });
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
  const nextMemberIdSet = new Set(nextRole === "member" ? nextMemberIds : []);

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
  db,
  message,
  targetId,
}: {
  action: "user.update" | "user.delete";
  actorUserId: string;
  after: AuditLog["after"];
  before: AuditLog["before"];
  branchId: string | null;
  db: Awaited<ReturnType<typeof readServerDb>>;
  message: string;
  targetId: string;
}): AuditLog {
  return {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
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
  const reasons: string[] = [];

  if (db.classes.some((session) => session.coachId === targetUser.id)) {
    reasons.push("담당 수업");
  }

  if (db.members.some((member) => member.primaryCoachId === targetUser.id)) {
    reasons.push("담당 회원");
  }

  if (targetUser.role === "owner") {
    const orphanBranchNames = targetUser.branchIds
      .filter(
        (branchId) =>
          !db.users.some(
            (candidate) =>
              candidate.id !== targetUser.id &&
              candidate.role === "owner" &&
              candidate.branchIds.includes(branchId),
          ),
      )
      .map((branchId) => db.branches.find((branch) => branch.id === branchId)?.name ?? branchId);

    if (orphanBranchNames.length > 0) {
      reasons.push(`대표 미배정 지점: ${orphanBranchNames.join(", ")}`);
    }
  }

  return reasons;
}

function createSafeActor(db: Awaited<ReturnType<typeof readServerDb>>, user: AppUser) {
  return db.users.find((candidate) => candidate.id === user.id) ?? user;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자를 수정할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const body = (await request.json().catch(() => null)) as UserUpdateBody | null;
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
  const nextPassword = body && "password" in body ? cleanText(body.password) : "";

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

  const requestedMemberIds = body && "memberIds" in body ? cleanMemberIds(body.memberIds) : targetUser.memberIds ?? [];
  const requestedChildMemberIds = body && "childMemberIds" in body ? cleanMemberIds(body.childMemberIds) : targetUser.childMemberIds ?? [];
  const nextMemberIds = nextRole === "member" ? requestedMemberIds : [];
  const nextChildMemberIds = nextRole === "guardian" ? requestedChildMemberIds : [];
  const invalidLinkedMemberIds = findInvalidLinkedMemberIds(db, [...nextMemberIds, ...nextChildMemberIds], nextBranchIds);

  if (invalidLinkedMemberIds.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "연결할 회원이 담당 지점에 포함되어 있지 않습니다.", {
      memberIds: invalidLinkedMemberIds,
    });
  }

  const adultGuardianChildMemberIds = nextRole === "guardian" ? findAdultGuardianChildMemberIds(db, nextChildMemberIds) : [];

  if (adultGuardianChildMemberIds.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "성인 회원은 학부모 자녀로 연결할 수 없습니다.", {
      memberIds: adultGuardianChildMemberIds,
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

  if (nextRole === "member") {
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
  const nextMembersAfterGuardianSync = syncGuardianMemberLinks(db, targetUser.id, nextRole as UserRole, nextChildMemberIds);
  const nextMembers = syncMemberAccountProfileLinks(
    { ...db, members: nextMembersAfterGuardianSync },
    nextRole as UserRole,
    nextMemberIds,
    nextName,
    nextPhone,
  );
  const adminCount = nextUsers.filter((candidate) => candidate.role === "admin").length;

  if (adminCount < 1) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "최소 1명의 총괄 어드민이 필요합니다.");
  }

  const auditLog = createUserAuditLog({
    action: "user.update",
    actorUserId: user.id,
    branchId: nextBranchIds[0] ?? null,
    db,
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
      role: nextRole,
      syncedMemberIds: nextRole === "member" ? nextMemberIds : [],
      title: nextTitle,
    },
    message: "사용자 정보를 수정했습니다.",
  });
  const nextDb = await writeServerDb({
    ...db,
    members: nextMembers,
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, createSafeActor(nextDb, user), selectedScope.selectedBranchId));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자를 삭제할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const body = (await request.json().catch(() => null)) as UserDeleteBody | null;
  const reason = cleanText(body?.reason);

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "사용자 삭제 사유가 필요합니다.");
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

  if (targetUser.role === "admin" && db.users.filter((candidate) => candidate.role === "admin").length <= 1) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "최소 1명의 총괄 어드민이 필요합니다.");
  }

  const blockingReasons = findBlockingDeleteReasons(targetUser, db);

  if (blockingReasons.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "연결된 운영 항목이 있어 삭제할 수 없습니다.", {
      blockingReasons,
    });
  }

  const auditLog = createUserAuditLog({
    action: "user.delete",
    actorUserId: user.id,
    branchId: targetUser.branchIds[0] ?? null,
    db,
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
    },
    message: "사용자 계정을 삭제했습니다.",
  });
  const nextDb = await writeServerDb({
    ...db,
    users: db.users.filter((candidate) => candidate.id !== targetUser.id),
    members: db.members.map((member) => ({
      ...member,
      guardianIds: member.guardianIds.filter((guardianId) => guardianId !== targetUser.id),
    })),
    notices: db.notices.map((notice) => ({
      ...notice,
      readByUserIds: getNoticeReadByUserIds(notice).filter((readByUserId) => readByUserId !== targetUser.id),
    })),
    pushSubscriptions: db.pushSubscriptions.filter((subscription) => subscription.userId !== targetUser.id),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId));
}
