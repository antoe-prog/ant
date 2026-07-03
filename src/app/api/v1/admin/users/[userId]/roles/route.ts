import { NextRequest } from "next/server";
import type { AuditLog, UserRole } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

type RoleUpdateBody = {
  role?: UserRole;
  reason?: string;
};

export async function PUT(
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
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 사용자 역할을 변경할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const body = (await request.json().catch(() => null)) as RoleUpdateBody | null;
  const nextRole = body?.role;
  const reason = body?.reason?.trim() ?? "";

  if (!nextRole || !userRoles.includes(nextRole)) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 역할이 올바르지 않습니다.");
  }

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "권한 변경 사유가 필요합니다.");
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

  const fallbackBranchIds = db.branches[0]?.id ? [db.branches[0].id] : [];
  const nextBranchIds = nextRole === "admin"
    ? db.branches.map((branch) => branch.id)
    : targetUser.branchIds.length > 0
      ? targetUser.branchIds
      : fallbackBranchIds;
  const nextUsers = db.users.map((candidate) =>
    candidate.id === targetUser.id ? { ...candidate, role: nextRole, branchIds: nextBranchIds } : candidate,
  );
  const adminCount = nextUsers.filter((candidate) => candidate.role === "admin").length;

  if (adminCount < 1) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "최소 1명의 총괄 어드민이 필요합니다.");
  }

  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
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
    },
    result: "success",
    message: "사용자 역할을 변경했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId));
}
