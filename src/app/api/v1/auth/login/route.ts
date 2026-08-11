import { NextRequest } from "next/server";
import { getAuthInputLimitError } from "@/lib/auth-input-policy";
import { userRoles, type AppUser, type AuditLog, type MockDatabase, type UserRole } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, sessionCookieName } from "@/server/api";
import { canUseDemoRoleLogin, createSessionCookieOptions } from "@/server/auth-policy";
import { defaultPilotPassword, verifyAuthenticationPassword } from "@/server/auth-password";
import {
  createAuthSession,
  getAccountLoginThrottle,
  readUnmodifiedPassword,
  shouldRecordBlockedLoginAudit,
} from "@/server/auth-session";
import { withAuthAndNotificationStateLock } from "@/server/auth-notification-state-lock";
import { samePhoneNumber } from "@/lib/phone";
import { createEndpointHint } from "@/server/push-notifications";
import {
  createExpiredPushDeviceSubscriptionCookieOptions,
  detachPushDeviceSubscriptionOnAccountSwitch,
  getPushDeviceSubscriptionId,
  pushDeviceSubscriptionCookieName,
} from "@/server/push-device-session";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

type LoginBody = {
  email?: string;
  keepSignedIn?: boolean;
  loginId?: string;
  password?: string;
  phone?: string;
  role?: UserRole;
};

function isLoginBody(value: unknown): value is LoginBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const optionalStringFields = ["email", "loginId", "password", "phone"];

  return optionalStringFields.every(
    (field) => candidate[field] === undefined || typeof candidate[field] === "string",
  ) &&
    (candidate.keepSignedIn === undefined || typeof candidate.keepSignedIn === "boolean") &&
    (candidate.role === undefined || userRoles.includes(candidate.role as UserRole));
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);

  if (!isLoginBody(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "로그인 입력 형식이 올바르지 않습니다.");
  }

  const inputLimitError = getAuthInputLimitError(rawBody as Record<string, unknown>);

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  const body = rawBody;
  const loginId = (body?.phone ?? body?.loginId ?? body?.email ?? "").trim();
  const emailFallback = loginId.toLowerCase();
  const password = readUnmodifiedPassword(body?.password);
  const requestedDemoRole = body?.role;
  const pushDeviceCookieValue = request.cookies.get(pushDeviceSubscriptionCookieName)?.value;

  if (loginId || password) {
    if (!loginId || !password) {
      return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호와 비밀번호를 입력해 주세요.");
    }
  } else if (!requestedDemoRole) {
    return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호 또는 역할을 선택해 주세요.");
  }

  return withAuthAndNotificationStateLock(async () => {
    const db = await readServerDb();

    if (loginId || password) {
      const user =
        db.users.find((candidate) => samePhoneNumber(candidate.phone, loginId)) ??
        (loginId.includes("@")
          ? db.users.find((candidate) => candidate.email?.toLowerCase() === emailFallback)
          : null);

      const now = new Date();
      const throttle = user ? getAccountLoginThrottle(db, user.id, now) : null;
      const verifiedPassword = verifyAuthenticationPassword(password, user?.passwordHash);
      const passwordMatches = Boolean(
        user &&
        user.invitationStatus !== "pending" &&
        verifiedPassword,
      );
      const usesBlockedSharedPassword = Boolean(
        user &&
        process.env.NODE_ENV === "production" &&
        password === defaultPilotPassword &&
        passwordMatches,
      );
      const canBypassAccountThrottle = passwordMatches && !usesBlockedSharedPassword;

      if (user && throttle && !canBypassAccountThrottle) {
        if (shouldRecordBlockedLoginAudit(db, user.id, now)) {
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
        }

        return createInvalidCredentialResponse();
      }

      if (!user || !passwordMatches || usesBlockedSharedPassword) {
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
              createdAt: now.toISOString(),
            }
          : null;

        if (failedAuditLog) {
          await writeServerDb({
            ...db,
            auditLogs: [failedAuditLog, ...db.auditLogs],
          });
        }

        return createInvalidCredentialResponse();
      }

      return createLoginResponse(db, user, body?.keepSignedIn === true, pushDeviceCookieValue);
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

    return createLoginResponse(db, user, false, pushDeviceCookieValue);
  });
}

function createInvalidCredentialResponse() {
  return jsonError(401, "UNAUTHENTICATED", "휴대폰 번호 또는 비밀번호가 올바르지 않습니다.");
}

async function createLoginResponse(
  db: MockDatabase,
  user: AppUser,
  keepSignedIn = false,
  pushDeviceCookieValue?: string,
) {
  const verifiedPushDeviceSubscriptionId = getPushDeviceSubscriptionId(
    db,
    pushDeviceCookieValue,
  );
  const switchedDevice = detachPushDeviceSubscriptionOnAccountSwitch(
    db,
    user,
    pushDeviceCookieValue,
  );
  const notificationAuditLog: AuditLog | null = switchedDevice.record
    ? {
        id: createRuntimeId("audit"),
        branchId: switchedDevice.record.branchIds[0] ?? null,
        actorUserId: switchedDevice.record.userId,
        action: "notification.unsubscribe",
        targetType: "push_subscription",
        targetId: switchedDevice.record.id,
        before: {
          endpointHint: createEndpointHint(switchedDevice.record.endpoint),
          disabledAt: null,
        },
        after: {
          endpointHint: createEndpointHint(switchedDevice.record.endpoint),
          disabledAt: switchedDevice.record.disabledAt ?? null,
          reason: "account_switch",
        },
        result: "success",
        message: "현재 기기에서 다른 계정으로 로그인하여 이전 계정의 알림 연결을 해제했습니다.",
        createdAt: switchedDevice.record.disabledAt ?? new Date().toISOString(),
      }
    : null;
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
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
    ...switchedDevice.db,
    auditLogs: [
      auditLog,
      ...(notificationAuditLog ? [notificationAuditLog] : []),
      ...switchedDevice.db.auditLogs,
    ],
  }, user.id, cookieOptions.maxAge);
  const nextDb = await writeServerDb(issuedSession.db);
  const sessionUser = nextDb.users.find((candidate) => candidate.id === user.id);

  if (!sessionUser) {
    return jsonError(409, "CONFLICT", "로그인 처리 중 계정 상태가 변경되었습니다. 다시 시도해 주세요.");
  }

  const response = jsonOk(createBootstrapPayload(nextDb, sessionUser, null));

  response.cookies.set(sessionCookieName, issuedSession.token, cookieOptions);
  if (switchedDevice.record || (pushDeviceCookieValue && !verifiedPushDeviceSubscriptionId)) {
    response.cookies.set(
      pushDeviceSubscriptionCookieName,
      "",
      createExpiredPushDeviceSubscriptionCookieOptions(),
    );
  }

  return response;
}
