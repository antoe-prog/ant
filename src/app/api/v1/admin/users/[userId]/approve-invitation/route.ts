import { NextRequest } from "next/server";
import type { AuditLog, MockDatabase, UserRole } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRandomPasswordHash, generateTemporaryPassword } from "@/server/auth-password";
import { revokeUserAuthSessions } from "@/server/auth-session";

export const runtime = "nodejs";

const ownerApprovableRoles: UserRole[] = ["coach", "guardian", "member"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin" && user.role !== "owner") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민 또는 대표만 초대를 승인할 수 있습니다.");
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
    return jsonError(403, "FORBIDDEN", "선택한 지점의 초대만 승인할 수 있습니다.");
  }

  if (targetUser.invitationStatus !== "pending") {
    return jsonError(409, "BUSINESS_RULE_FAILED", "이미 승인된 초대입니다.");
  }

  const accessibleBranchIds = getAccessibleBranchIds(user, db);

  if (user.role === "owner") {
    if (!ownerApprovableRoles.includes(targetUser.role)) {
      return jsonError(403, "FORBIDDEN", "대표는 코치, 학부모, 회원 초대만 승인할 수 있습니다.");
    }

    if (targetUser.branchIds.some((branchId) => !accessibleBranchIds.includes(branchId))) {
      return jsonError(403, "FORBIDDEN", "접근 가능한 지점의 초대만 승인할 수 있습니다.");
    }
  }

  const now = new Date().toISOString();
  const temporaryPassword = targetUser.passwordHash ? null : generateTemporaryPassword();
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: targetUser.branchIds[0] ?? null,
    actorUserId: user.id,
    action: "user.invite.approve",
    targetType: "user",
    targetId: targetUser.id,
    before: { invitationStatus: targetUser.invitationStatus ?? "pending" },
    after: {
      invitationStatus: "accepted",
      passwordIssued: Boolean(temporaryPassword),
      approvedByUserId: user.id,
    },
    result: "success",
    message: "초대를 승인했습니다.",
    createdAt: now,
  };
  const updatedDb: MockDatabase = {
    ...db,
    users: db.users.map((candidate) =>
      candidate.id === targetUser.id
        ? {
            ...candidate,
            invitationStatus: "accepted",
            invitationToken: undefined,
            acceptedAt: now,
            ...(temporaryPassword
              ? {
                  passwordHash: createRandomPasswordHash(temporaryPassword),
                  passwordUpdatedAt: now,
                }
              : {}),
          }
        : candidate,
    ),
    auditLogs: [auditLog, ...db.auditLogs],
  };
  const nextDb = await writeServerDb(
    temporaryPassword ? revokeUserAuthSessions(updatedDb, targetUser.id, new Date(now)) : updatedDb,
  );
  const actor = nextDb.users.find((candidate) => candidate.id === user.id) ?? user;

  return jsonOk({
    ...createBootstrapPayload(nextDb, actor, selectedScope.selectedBranchId),
    approval: {
      userId: targetUser.id,
      temporaryPassword,
      approvedAt: now,
    },
  });
}
