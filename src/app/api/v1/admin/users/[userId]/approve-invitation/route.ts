import { NextRequest } from "next/server";
import type { AuditLog, MockDatabase, UserRole } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { withAuthAndNotificationStateLock } from "@/server/auth-notification-state-lock";
import { createRandomPasswordHash, generateTemporaryPassword } from "@/server/auth-password";
import { revokeUserSecurityAccess } from "@/server/auth-session";
import { createRuntimeId } from "@/server/runtime-id";

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

  return withAuthAndNotificationStateLock(async () => {
    const latestDb = await readServerDb();
    const { user: latestUser, response: latestResponse } = requireSession(request, latestDb);

    if (!latestUser) {
      return latestResponse;
    }

    if (latestUser.role !== "admin" && latestUser.role !== "owner") {
      return jsonError(403, "FORBIDDEN", "총괄 어드민 또는 대표만 초대를 승인할 수 있습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, latestUser, latestDb);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    const targetUser = latestDb.users.find((candidate) => candidate.id === userId);

    if (!targetUser) {
      return jsonError(404, "NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }

    if (selectedScope.selectedBranchId && !targetUser.branchIds.includes(selectedScope.selectedBranchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 초대만 승인할 수 있습니다.");
    }

    if (targetUser.invitationStatus !== "pending") {
      return jsonError(409, "BUSINESS_RULE_FAILED", "이미 승인된 초대입니다.");
    }

    const accessibleBranchIds = getAccessibleBranchIds(latestUser, latestDb);

    if (latestUser.role === "owner") {
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
      id: createRuntimeId("audit"),
      branchId: targetUser.branchIds[0] ?? null,
      actorUserId: latestUser.id,
      action: "user.invite.approve",
      targetType: "user",
      targetId: targetUser.id,
      before: { invitationStatus: targetUser.invitationStatus ?? "pending" },
      after: {
        invitationStatus: "accepted",
        passwordIssued: Boolean(temporaryPassword),
        approvedByUserId: latestUser.id,
      },
      result: "success",
      message: "초대를 승인했습니다.",
      createdAt: now,
    };
    const updatedDb: MockDatabase = {
      ...latestDb,
      users: latestDb.users.map((candidate) =>
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
      auditLogs: [auditLog, ...latestDb.auditLogs],
    };
    const nextDb = await writeServerDb(
      temporaryPassword ? revokeUserSecurityAccess(updatedDb, targetUser.id, new Date(now)) : updatedDb,
    );
    const actor = nextDb.users.find((candidate) => candidate.id === latestUser.id) ?? latestUser;

    return jsonOk({
      ...createBootstrapPayload(nextDb, actor, selectedScope.selectedBranchId),
      approval: {
        userId: targetUser.id,
        temporaryPassword,
        approvedAt: now,
      },
    });
  });
}
