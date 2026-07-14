import { NextRequest } from "next/server";
import type { AppUser, AuditLog, MockDatabase, UserRole } from "@/lib/domain";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, sessionCookieName } from "@/server/api";
import { canUseDemoRoleLogin, createSessionCookieOptions } from "@/server/auth-policy";
import { defaultPilotPassword, verifyPassword } from "@/server/auth-password";
import {
  authSecurityLockKey,
  createAuthSession,
  getAccountLoginThrottle,
  readUnmodifiedPassword,
} from "@/server/auth-session";
import { samePhoneNumber } from "@/lib/phone";

export const runtime = "nodejs";

type LoginBody = {
  email?: string;
  keepSignedIn?: boolean;
  loginId?: string;
  password?: string;
  phone?: string;
  role?: UserRole;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as LoginBody | null;
  const loginId = (body?.phone ?? body?.loginId ?? body?.email ?? "").trim();
  const emailFallback = loginId.toLowerCase();
  const password = readUnmodifiedPassword(body?.password);
  const requestedDemoRole = body?.role;

  if (loginId || password) {
    if (!loginId || !password) {
      return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호와 비밀번호를 입력해 주세요.");
    }
  } else if (!requestedDemoRole) {
    return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호 또는 역할을 선택해 주세요.");
  }

  return withServerDbLock(authSecurityLockKey, async () => {
    const db = await readServerDb();

    if (loginId || password) {
      const user =
        db.users.find((candidate) => samePhoneNumber(candidate.phone, loginId)) ??
        (loginId.includes("@")
          ? db.users.find((candidate) => candidate.email?.toLowerCase() === emailFallback)
          : null);

      if (user) {
        const now = new Date();
        const throttle = getAccountLoginThrottle(db, user.id, now);

        if (throttle) {
          const blockedAuditLog: AuditLog = {
            id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
            branchId: user.branchIds[0] ?? null,
            actorUserId: user.id,
            action: "auth.login",
            targetType: "auth",
            targetId: user.id,
            before: null,
            after: { reason: "login_rate_limited" },
            result: "blocked",
            message: "로그인 시도가 일시적으로 제한되었습니다.",
            createdAt: now.toISOString(),
          };

          await writeServerDb({
            ...db,
            auditLogs: [blockedAuditLog, ...db.auditLogs],
          });
          const rateLimitedResponse = jsonError(
            429,
            "TOO_MANY_REQUESTS",
            "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.",
          );

          rateLimitedResponse.headers.set("Retry-After", String(throttle.retryAfterSeconds));
          return rateLimitedResponse;
        }
      }

      if (user?.invitationStatus === "pending") {
        const failedAuditLog: AuditLog = {
          id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
          branchId: user.branchIds[0] ?? null,
          actorUserId: user.id,
          action: "auth.login",
          targetType: "auth",
          targetId: user.id,
          before: null,
          after: { reason: "pending_invitation" },
          result: "failed",
          message: "로그인에 실패했습니다.",
          createdAt: new Date().toISOString(),
        };

        await writeServerDb({
          ...db,
          auditLogs: [failedAuditLog, ...db.auditLogs],
        });

        return jsonError(403, "ACCOUNT_PENDING", "초대 가입이 완료되지 않았습니다. 받은 초대 링크에서 비밀번호 설정을 마쳐 주세요.");
      }

      const usesBlockedSharedPassword = Boolean(
        user &&
        process.env.NODE_ENV === "production" &&
        password === defaultPilotPassword &&
        verifyPassword(defaultPilotPassword, user.passwordHash),
      );

      if (!user || !verifyPassword(password, user.passwordHash) || usesBlockedSharedPassword) {
        const failedAuditLog: AuditLog | null = user
          ? {
              id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
              branchId: user.branchIds[0] ?? null,
              actorUserId: user.id,
              action: "auth.login" as const,
              targetType: "auth" as const,
              targetId: user.id,
              before: null,
              after: {
                reason: usesBlockedSharedPassword ? "shared_demo_password_blocked" : "invalid_credentials",
              },
              result: "failed" as const,
              message: "로그인에 실패했습니다.",
              createdAt: new Date().toISOString(),
            }
          : null;

        if (failedAuditLog) {
          await writeServerDb({
            ...db,
            auditLogs: [failedAuditLog, ...db.auditLogs],
          });
        }

        return jsonError(401, "UNAUTHENTICATED", "휴대폰 번호 또는 비밀번호가 올바르지 않습니다.");
      }

      return createLoginResponse(db, user, body?.keepSignedIn === true);
    }

    if (!canUseDemoRoleLogin()) {
      return jsonError(403, "FORBIDDEN", "운영 환경에서는 역할 바로 시작이 비활성화되어 있습니다.");
    }

    const demoUserId = `user-${requestedDemoRole}`;
    const user =
      db.users.find(
        (candidate) =>
          candidate.id === demoUserId &&
          candidate.role === requestedDemoRole &&
          candidate.invitationStatus !== "pending",
      ) ??
      db.users.find((candidate) => candidate.role === requestedDemoRole && candidate.invitationStatus !== "pending") ??
      db.users.find((candidate) => candidate.role === requestedDemoRole);

    if (!user) {
      return jsonError(404, "NOT_FOUND", "선택한 역할의 계정을 찾을 수 없습니다.");
    }

    return createLoginResponse(db, user);
  });
}

async function createLoginResponse(db: MockDatabase, user: AppUser, keepSignedIn = false) {
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: null,
    actorUserId: user.id,
    action: "auth.login",
    targetType: "auth",
    targetId: user.id,
    before: null,
    after: { role: user.role },
    result: "success",
    message: "로그인했습니다.",
    createdAt: new Date().toISOString(),
  };
  const cookieOptions = createSessionCookieOptions(process.env, { keepSignedIn });
  const issuedSession = createAuthSession({
    ...db,
    auditLogs: [auditLog, ...db.auditLogs],
  }, user.id, cookieOptions.maxAge);
  const nextDb = await writeServerDb(issuedSession.db);
  const sessionUser = nextDb.users.find((candidate) => candidate.id === user.id);

  if (!sessionUser) {
    return jsonError(409, "CONFLICT", "로그인 처리 중 계정 상태가 변경되었습니다. 다시 시도해 주세요.");
  }

  const response = jsonOk(createBootstrapPayload(nextDb, sessionUser, null));

  response.cookies.set(sessionCookieName, issuedSession.token, cookieOptions);

  return response;
}
