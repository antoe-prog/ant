import { NextRequest } from "next/server";
import type { AuditLog, UserRole } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";
import { authSecurityLockKey, revokeUserAuthSessions } from "@/server/auth-session";
import { isActiveAdmin } from "@/server/user-administration";
import { getUserAdministrationInputLimitError } from "@/lib/user-administration-input-policy";
import {
  findOwnerCoverageBlockers,
  reassignUserOperationalLinks,
  summarizeOperationalReassignmentBlockers,
} from "@/server/user-operational-reassignment";

export const runtime = "nodejs";

type RoleUpdateBody = {
  branchIds?: string[];
  role?: UserRole;
  reason?: string;
};

function getRoleUpdateBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "역할 변경 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  if (body.role !== undefined && typeof body.role !== "string") {
    return "변경할 역할 값의 형식이 올바르지 않습니다.";
  }

  if (body.reason !== undefined && typeof body.reason !== "string") {
    return "권한 변경 사유의 형식이 올바르지 않습니다.";
  }

  if (
    body.branchIds !== undefined &&
    (!Array.isArray(body.branchIds) || body.branchIds.some((branchId) => typeof branchId !== "string"))
  ) {
    return "담당 지점 값의 형식이 올바르지 않습니다.";
  }

  return null;
}

export async function PUT(
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
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자 역할을 변경할 수 있습니다.");
  }

  const initialScope = requireSelectedBranchScope(request, initialUser, initialDb);

  if (initialScope.response) {
    return initialScope.response;
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getRoleUpdateBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const inputLimitError = getUserAdministrationInputLimitError(rawBody as Record<string, unknown>);

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  const body = rawBody as RoleUpdateBody;
  const nextRole = body?.role;
  const reason = body?.reason?.trim() ?? "";
  const requestedBranchIds = Array.isArray(body?.branchIds)
    ? [...new Set(body.branchIds.map((branchId) => branchId.trim()).filter(Boolean))]
    : [];

  if (!nextRole || !userRoles.includes(nextRole)) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 역할이 올바르지 않습니다.");
  }

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "권한 변경 사유가 필요합니다.");
  }

  return withServerDbLock(authSecurityLockKey, async () => {
    const db = await readServerDb();
    const { user, response: freshSessionResponse } = requireSession(request, db);

    if (!user) {
      return freshSessionResponse;
    }

    if (user.role !== "admin") {
      return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자 역할을 변경할 수 있습니다.");
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
    return jsonError(403, "FORBIDDEN", "선택한 지점의 사용자 역할만 변경할 수 있습니다.");
  }

  if (targetUser.id === user.id && targetUser.role === "admin" && nextRole !== "admin") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "현재 로그인한 총괄 어드민은 자신의 권한을 제거할 수 없습니다.");
  }

  const knownBranchIds = new Set(db.branches.map((branch) => branch.id));

  if (nextRole !== "admin" && (requestedBranchIds.length === 0 || requestedBranchIds.some((branchId) => !knownBranchIds.has(branchId)))) {
    return jsonError(422, "VALIDATION_ERROR", "변경할 역할의 담당 지점을 한 곳 이상 선택해 주세요.");
  }

  const nextBranchIds = nextRole === "admin" ? db.branches.map((branch) => branch.id) : requestedBranchIds;
  const ownerCoverageBlockers = findOwnerCoverageBlockers(targetUser, nextRole, nextBranchIds, db);

  if (ownerCoverageBlockers.length > 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "다른 대표를 먼저 배정해 주세요.", {
      branchNames: ownerCoverageBlockers,
    });
  }

  const nextTargetUser = { ...targetUser, role: nextRole, branchIds: nextBranchIds };

  if (nextRole !== "member") {
    delete nextTargetUser.memberIds;
  }
  if (nextRole !== "guardian") {
    delete nextTargetUser.childMemberIds;
  }

  const nextUsers = db.users.map((candidate) =>
    candidate.id === targetUser.id ? nextTargetUser : candidate,
  );
  const adminCount = nextUsers.filter(isActiveAdmin).length;

  if (adminCount < 1) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "최소 1명의 총괄 어드민이 필요합니다.");
  }

  const membersAfterGuardianSync = nextRole === "guardian"
    ? db.members
    : db.members.map((member) => ({
        ...member,
        guardianIds: member.guardianIds.filter((guardianId) => guardianId !== targetUser.id),
      }));
  const operationalLinks = reassignUserOperationalLinks({
    db: { ...db, users: nextUsers, members: membersAfterGuardianSync },
    nextBranchIds,
    nextRole,
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

  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: null,
    actorUserId: user.id,
    action: "user.role.update",
    targetType: "user",
    targetId: targetUser.id,
    before: {
      role: targetUser.role,
      branchIds: targetUser.branchIds,
    },
    after: {
      role: nextRole,
      branchIds: nextBranchIds,
      reason,
      reassignedClassCount: operationalLinks.reassignedClassCount,
      reassignedMemberCount: operationalLinks.reassignedMemberCount,
    },
    result: "success",
    message: "사용자 역할을 변경했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb(revokeUserAuthSessions({
    ...db,
    classes: operationalLinks.classes,
    members: operationalLinks.members,
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  }, targetUser.id));

    const actor = nextDb.users.find((candidate) => candidate.id === user.id);

    if (!actor) {
      return jsonError(409, "CONFLICT", "권한 변경 중 관리자 계정 상태가 변경되었습니다. 다시 시도해 주세요.");
    }

    return jsonOk(createBootstrapPayload(nextDb, actor, selectedScope.selectedBranchId));
  });
}
