import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { canAdminManageUser } from "@/lib/admin-access";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import {
  createInvitationToken,
  invitationSecurityLockKey,
  secureStoredInvitationTokens,
} from "@/server/invitation-token";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const ownerReissuableRoles = new Set(["coach", "guardian", "member"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  return withServerDbLock(invitationSecurityLockKey, async () => {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return response;
    }

    if (user.role !== "admin" && user.role !== "owner") {
      return jsonError(403, "FORBIDDEN", "초대 링크를 다시 만들 수 없습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    const targetUser = db.users.find((candidate) => candidate.id === userId);

    if (!targetUser || targetUser.invitationStatus !== "pending") {
      return jsonError(404, "NOT_FOUND", "다시 만들 초대 링크를 찾을 수 없습니다.");
    }

    if (selectedScope.selectedBranchId && !targetUser.branchIds.includes(selectedScope.selectedBranchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 초대 링크만 다시 만들 수 있습니다.");
    }

    const accessibleBranchIds = getAccessibleBranchIds(user, db);

    if (user.role === "admin" && !canAdminManageUser(user, targetUser)) {
      return jsonError(403, "FORBIDDEN", "접근 가능한 지점의 초대 링크만 다시 만들 수 있습니다.");
    }

    if (
      user.role === "owner" &&
      (!ownerReissuableRoles.has(targetUser.role) ||
        targetUser.branchIds.some((branchId) => !accessibleBranchIds.includes(branchId)))
    ) {
      return jsonError(403, "FORBIDDEN", "담당 지점의 초대 링크만 다시 만들 수 있습니다.");
    }

    const issued = createInvitationToken();
    const now = new Date().toISOString();
    const securedUsers = secureStoredInvitationTokens(db.users).map((candidate) =>
      candidate.id === targetUser.id
        ? { ...candidate, invitationToken: issued.tokenHash, invitedAt: now }
        : candidate,
    );
    const auditLog: AuditLog = {
      id: createRuntimeId("audit-invitation-link"),
      branchId: targetUser.branchIds[0] ?? null,
      actorUserId: user.id,
      action: "user.invite.create",
      targetType: "user",
      targetId: targetUser.id,
      before: { invitationStatus: "pending", invitedAt: targetUser.invitedAt ?? null },
      after: { invitationStatus: "pending", invitedAt: now, reissued: true },
      result: "success",
      message: "초대 링크를 다시 만들었습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...db,
      users: securedUsers,
      auditLogs: [auditLog, ...db.auditLogs],
    });
    const actor = nextDb.users.find((candidate) => candidate.id === user.id);

    if (!actor) {
      return jsonError(409, "CONFLICT", "초대 링크를 다시 만드는 중 계정 상태가 변경되었습니다.");
    }

    return jsonOk({
      ...createBootstrapPayload(nextDb, actor, selectedScope.selectedBranchId),
      invitation: {
        userId: targetUser.id,
        token: issued.token,
        path: `/invite/${issued.token}`,
      },
    });
  });
}
