import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { authInputLimits } from "@/lib/auth-input-policy";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, sessionCookieName } from "@/server/api";
import { withAuthAndNotificationStateLock } from "@/server/auth-notification-state-lock";
import { createSessionCookieOptions } from "@/server/auth-policy";
import { createRandomPasswordHash, defaultPilotPassword } from "@/server/auth-password";
import { createAuthSession, revokeUserSecurityAccess } from "@/server/auth-session";
import {
  findUserByInvitationToken,
  getInvitationPasswordRateLimit,
  isInvitationExpired,
  secureStoredInvitationTokens,
} from "@/server/invitation-token";

export const runtime = "nodejs";

type InvitationAcceptBody = {
  password?: string;
};

type PasswordValidationFailure = {
  code: "BUSINESS_RULE_FAILED" | "VALIDATION_ERROR";
  message: string;
  reason: "default_password" | "leading_or_trailing_whitespace" | "missing_or_too_short" | "too_long";
  status: 400 | 422;
};

function validateInvitationPassword(password: unknown): PasswordValidationFailure | null {
  if (typeof password !== "string" || password.length < 12) {
    return {
      code: "VALIDATION_ERROR",
      message: "비밀번호는 12자 이상이어야 합니다.",
      reason: "missing_or_too_short",
      status: 400,
    };
  }

  if (password.length > authInputLimits.passwordLength) {
    return {
      code: "VALIDATION_ERROR",
      message: "비밀번호는 256자 이하여야 합니다.",
      reason: "too_long",
      status: 400,
    };
  }

  if (password !== password.trim()) {
    return {
      code: "VALIDATION_ERROR",
      message: "비밀번호 앞뒤에는 공백을 사용할 수 없습니다.",
      reason: "leading_or_trailing_whitespace",
      status: 400,
    };
  }

  if (password === defaultPilotPassword) {
    return {
      code: "BUSINESS_RULE_FAILED",
      message: "다른 비밀번호를 입력해 주세요.",
      reason: "default_password",
      status: 422,
    };
  }

  return null;
}

function createPasswordFailureAuditLog(
  db: Awaited<ReturnType<typeof readServerDb>>,
  userId: string,
  branchId: string | null,
  reason: PasswordValidationFailure["reason"],
  now: string,
): AuditLog {
  return {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: userId,
    action: "auth.invite.accept",
    targetType: "auth",
    targetId: userId,
    before: { invitationStatus: "pending" },
    after: { failureKind: "password_validation", reason },
    result: "failed",
    message: "초대 수락 비밀번호 정책을 충족하지 못했습니다.",
    createdAt: now,
  };
}

function createRateLimitedResponse(retryAfterSeconds: number) {
  const response = jsonError(429, "RATE_LIMITED", "비밀번호 입력 시도가 많습니다. 잠시 후 다시 시도해 주세요.");

  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as InvitationAcceptBody | null;
  const password = body?.password;

  return withAuthAndNotificationStateLock(async () => {
    const db = await readServerDb();
    const invitedUser = findUserByInvitationToken(db.users, token);

    if (!invitedUser) {
      return jsonError(404, "NOT_FOUND", "초대 링크를 찾을 수 없습니다.");
    }

    const securedUsers = secureStoredInvitationTokens(db.users);
    const shouldUpgradeStoredTokens = securedUsers.some((candidate, index) => candidate !== db.users[index]);
    const persistStoredTokenUpgrade = async () => {
      if (shouldUpgradeStoredTokens) {
        await writeServerDb({ ...db, users: securedUsers });
      }
    };

    if (invitedUser.invitationStatus === "accepted") {
      await persistStoredTokenUpgrade();
      return jsonError(409, "BUSINESS_RULE_FAILED", "이미 사용된 초대 링크입니다. 로그인 화면에서 계정 비밀번호로 접속해 주세요.");
    }

    const nowDate = new Date();

    if (isInvitationExpired(invitedUser.invitedAt, nowDate)) {
      await persistStoredTokenUpgrade();
      return jsonError(410, "BUSINESS_RULE_FAILED", "초대 링크가 만료되었습니다. 관리자에게 새 링크를 요청해 주세요.");
    }

    const rateLimit = getInvitationPasswordRateLimit(db.auditLogs, invitedUser.id, nowDate);

    if (rateLimit.blocked) {
      await persistStoredTokenUpgrade();
      return createRateLimitedResponse(rateLimit.retryAfterSeconds);
    }

    const passwordFailure = validateInvitationPassword(password);

    if (passwordFailure) {
      const now = nowDate.toISOString();
      const auditLog = createPasswordFailureAuditLog(
        db,
        invitedUser.id,
        invitedUser.branchIds[0] ?? null,
        passwordFailure.reason,
        now,
      );

      await writeServerDb({
        ...db,
        users: securedUsers,
        auditLogs: [auditLog, ...db.auditLogs],
      });

      return jsonError(passwordFailure.status, passwordFailure.code, passwordFailure.message);
    }

    const acceptedPassword = password as string;
    const now = nowDate.toISOString();
    const auditLog: AuditLog = {
      id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
      branchId: invitedUser.branchIds[0] ?? null,
      actorUserId: invitedUser.id,
      action: "auth.invite.accept",
      targetType: "auth",
      targetId: invitedUser.id,
      before: { invitationStatus: invitedUser.invitationStatus ?? "pending" },
      after: { invitationStatus: "accepted", passwordSet: true },
      result: "success",
      message: "초대 수락과 비밀번호 설정을 완료했습니다.",
      createdAt: now,
    };
    const updatedDb = revokeUserSecurityAccess({
      ...db,
      users: securedUsers.map((candidate) =>
        candidate.id === invitedUser.id
          ? {
              ...candidate,
              invitationStatus: "accepted",
              acceptedAt: now,
              passwordHash: createRandomPasswordHash(acceptedPassword),
              passwordUpdatedAt: now,
            }
          : candidate,
      ),
      auditLogs: [auditLog, ...db.auditLogs],
    }, invitedUser.id, nowDate);
    const cookieOptions = createSessionCookieOptions();
    const issuedSession = createAuthSession(updatedDb, invitedUser.id, cookieOptions.maxAge, nowDate);
    const nextDb = await writeServerDb(issuedSession.db);
    const acceptedUser = nextDb.users.find((candidate) => candidate.id === invitedUser.id) ?? invitedUser;
    const response = jsonOk(createBootstrapPayload(nextDb, acceptedUser, acceptedUser.branchIds[0] ?? null));

    response.cookies.set(sessionCookieName, issuedSession.token, cookieOptions);

    return response;
  });
}
