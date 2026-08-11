import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { getSessionUser, jsonOk, sessionCookieName } from "@/server/api";
import { createExpiredSessionCookieOptions } from "@/server/auth-policy";
import { revokeAuthSession } from "@/server/auth-session";
import { withAuthAndNotificationStateLock } from "@/server/auth-notification-state-lock";
import { createEndpointHint } from "@/server/push-notifications";
import {
  createExpiredPushDeviceSubscriptionCookieOptions,
  detachPushDeviceSubscriptionOnLogout,
  pushDeviceSubscriptionCookieName,
} from "@/server/push-device-session";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get(sessionCookieName)?.value;
  const pushDeviceCookieValue = request.cookies.get(pushDeviceSubscriptionCookieName)?.value;
  const response = await withAuthAndNotificationStateLock(async () => {
    const db = await readServerDb();
    const user = getSessionUser(request, db);
    const revokedDb = revokeAuthSession(db, sessionToken);
    const detached = detachPushDeviceSubscriptionOnLogout(
      revokedDb,
      user,
      pushDeviceCookieValue,
    );
    const notificationAuditLog: AuditLog | null = detached.record
      ? {
          id: createRuntimeId("audit"),
          branchId: detached.record.branchIds[0] ?? user?.branchIds[0] ?? null,
          actorUserId: user?.id ?? detached.record.userId,
          action: "notification.unsubscribe",
          targetType: "push_subscription",
          targetId: detached.record.id,
          before: {
            endpointHint: createEndpointHint(detached.record.endpoint),
            disabledAt: null,
          },
          after: {
            endpointHint: createEndpointHint(detached.record.endpoint),
            disabledAt: detached.record.disabledAt ?? null,
            reason: "logout",
            sessionAuthenticated: Boolean(user),
          },
          result: "success",
          message: "로그아웃한 현재 기기의 알림 연결을 해제했습니다.",
          createdAt: detached.record.disabledAt ?? new Date().toISOString(),
        }
      : null;

    const auditLog: AuditLog | null = user
      ? {
          id: createRuntimeId("audit"),
          branchId: null,
          actorUserId: user.id,
          action: "auth.logout",
          targetType: "auth",
          targetId: user.id,
          before: null,
          after: { role: user.role },
          result: "success",
          message: "로그아웃했습니다.",
          createdAt: new Date().toISOString(),
        }
      : null;

    if (auditLog || notificationAuditLog || revokedDb !== db) {
      await writeServerDb({
        ...detached.db,
        auditLogs: [
          ...(auditLog ? [auditLog] : []),
          ...(notificationAuditLog ? [notificationAuditLog] : []),
          ...detached.db.auditLogs,
        ],
      });
    }

    return jsonOk({ ok: true });
  });
  response.cookies.set(sessionCookieName, "", createExpiredSessionCookieOptions());
  response.cookies.set(
    pushDeviceSubscriptionCookieName,
    "",
    createExpiredPushDeviceSubscriptionCookieOptions(),
  );

  return response;
}
