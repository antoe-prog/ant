import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRandomPasswordHash, defaultPilotPassword, generateTemporaryPassword } from "@/server/auth-password";
import { authSecurityLockKey, readUnmodifiedPassword, revokeUserAuthSessions } from "@/server/auth-session";

export const runtime = "nodejs";

type PasswordIssueBody = {
  reason?: string;
  temporaryPassword?: string;
};

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

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 비밀번호를 재발급할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const body = (await request.json().catch(() => null)) as PasswordIssueBody | null;
  const reason = body?.reason?.trim() ?? "";
  const suppliedTemporaryPassword = readUnmodifiedPassword(body?.temporaryPassword);
  const temporaryPassword = suppliedTemporaryPassword || generateTemporaryPassword();

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "비밀번호 재발급 사유가 필요합니다.");
  }

  if (temporaryPassword === defaultPilotPassword) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "다른 새 비밀번호를 입력해 주세요.");
  }

  if (temporaryPassword.length < 12) {
    return jsonError(400, "VALIDATION_ERROR", "새 비밀번호는 12자 이상이어야 합니다.");
  }

  return withServerDbLock(authSecurityLockKey, async () => {
    const freshDb = await readServerDb();
    const { user: freshUser, response: freshSessionResponse } = requireSession(request, freshDb);

    if (!freshUser) {
      return freshSessionResponse;
    }

    if (freshUser.role !== "admin") {
      return jsonError(403, "FORBIDDEN", "총괄 어드민만 비밀번호를 재발급할 수 있습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, freshUser, freshDb);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    const targetUser = freshDb.users.find((candidate) => candidate.id === userId);

    if (!targetUser) {
      return jsonError(404, "NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }

    if (selectedScope.selectedBranchId && !targetUser.branchIds.includes(selectedScope.selectedBranchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 사용자만 비밀번호를 재발급할 수 있습니다.");
    }

    const now = new Date().toISOString();
    const auditLog: AuditLog = {
      id: `audit-${Date.now()}-${freshDb.auditLogs.length + 1}`,
      branchId: targetUser.branchIds[0] ?? null,
      actorUserId: freshUser.id,
      action: "auth.password_reset.complete",
      targetType: "auth",
      targetId: targetUser.id,
      before: {
        passwordResetRequestedAt: targetUser.passwordResetRequestedAt ?? null,
        passwordUpdatedAt: targetUser.passwordUpdatedAt ?? null,
      },
      after: {
        issuedAt: now,
        mode: suppliedTemporaryPassword ? "manual" : "generated",
        reason,
      },
      result: "success",
      message: "비밀번호를 재발급했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb(revokeUserAuthSessions({
      ...freshDb,
      users: freshDb.users.map((candidate) =>
        candidate.id === targetUser.id
          ? {
              ...candidate,
              passwordHash: createRandomPasswordHash(temporaryPassword),
              passwordResetRequestedAt: undefined,
              passwordUpdatedAt: now,
            }
          : candidate,
      ),
      auditLogs: [auditLog, ...freshDb.auditLogs],
    }, targetUser.id, new Date(now)));
    const actor = nextDb.users.find((candidate) => candidate.id === freshUser.id);

    if (!actor) {
      return jsonError(409, "CONFLICT", "비밀번호 변경 중 관리자 계정 상태가 변경되었습니다. 다시 시도해 주세요.");
    }

    return jsonOk({
      ...createBootstrapPayload(nextDb, actor, selectedScope.selectedBranchId),
      password: {
        userId: targetUser.id,
        temporaryPassword,
        issuedAt: now,
      },
    });
  });
}
