import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { jsonError, jsonOk, requireSession } from "@/server/api";
import {
  createEndpointHint,
  disablePushSubscription,
  getVisibleActivePushSubscriptionCount,
  normalizePushSubscription,
  upsertPushSubscription,
} from "@/server/push-notifications";

export const runtime = "nodejs";

const familyNotificationAlwaysOnRoles = new Set(["member", "guardian"]);

type SubscribeBody = {
  subscription?: unknown;
  userAgent?: string;
};

type UnsubscribeBody = {
  endpoint?: string;
};

export async function POST(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as SubscribeBody | null;
  const subscription = normalizePushSubscription(body?.subscription);

  if (!subscription) {
    return jsonError(400, "VALIDATION_ERROR", "공지 알림 등록 정보가 올바르지 않습니다.");
  }

  const { db: dbWithSubscription, record } = upsertPushSubscription(db, user, subscription, body?.userAgent);
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: user.branchIds[0] ?? null,
    actorUserId: user.id,
    action: "notification.subscribe",
    targetType: "push_subscription",
    targetId: record.id,
    before: null,
    after: {
      endpointHint: createEndpointHint(record.endpoint),
      branchIds: record.branchIds,
      userAgent: record.userAgent,
    },
    result: "success",
    message: "푸시 알림 구독을 저장했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...dbWithSubscription,
    auditLogs: [auditLog, ...dbWithSubscription.auditLogs],
  });

  return jsonOk({
    subscription: {
      id: record.id,
      endpointHint: createEndpointHint(record.endpoint),
      disabledAt: record.disabledAt ?? null,
    },
    activeSubscriptionCount: getVisibleActivePushSubscriptionCount(nextDb, user),
  });
}

export async function DELETE(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as UnsubscribeBody | null;
  const endpoint = body?.endpoint?.trim() ?? "";

  if (!endpoint) {
    return jsonError(400, "VALIDATION_ERROR", "해지할 공지 알림 정보를 찾지 못했습니다.");
  }

  const existing = db.pushSubscriptions.find((item) => item.endpoint === endpoint && item.userId === user.id);

  if (!existing) {
    return jsonError(404, "NOT_FOUND", "해지할 푸시 구독을 찾을 수 없습니다.");
  }

  if (familyNotificationAlwaysOnRoles.has(user.role)) {
    const now = new Date().toISOString();
    const record = {
      ...existing,
      disabledAt: undefined,
      updatedAt: now,
    };
    const dbWithPreservedSubscription = {
      ...db,
      pushSubscriptions: db.pushSubscriptions.map((item) => (item.id === existing.id ? record : item)),
    };
    const auditLog: AuditLog = {
      id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
      branchId: user.branchIds[0] ?? null,
      actorUserId: user.id,
      action: "notification.unsubscribe",
      targetType: "push_subscription",
      targetId: record.id,
      before: {
        endpointHint: createEndpointHint(record.endpoint),
        disabledAt: existing.disabledAt ?? null,
      },
      after: {
        endpointHint: createEndpointHint(record.endpoint),
        disabledAt: null,
        policy: "family_notification_always_on",
      },
      result: "blocked",
      message: "회원/학부모 알림 수신은 항상 켜짐으로 유지했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...dbWithPreservedSubscription,
      auditLogs: [auditLog, ...dbWithPreservedSubscription.auditLogs],
    });

    return jsonOk({
      subscription: {
        id: record.id,
        endpointHint: createEndpointHint(record.endpoint),
        disabledAt: null,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(nextDb, user),
      enforcedAlwaysOn: true,
    });
  }

  const { db: dbWithDisabledSubscription, record } = disablePushSubscription(db, endpoint, user);

  if (!record) {
    return jsonError(404, "NOT_FOUND", "해지할 푸시 구독을 찾을 수 없습니다.");
  }

  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: user.branchIds[0] ?? null,
    actorUserId: user.id,
    action: "notification.unsubscribe",
    targetType: "push_subscription",
    targetId: record.id,
    before: {
      endpointHint: createEndpointHint(record.endpoint),
      disabledAt: null,
    },
    after: {
      endpointHint: createEndpointHint(record.endpoint),
      disabledAt: record.disabledAt,
    },
    result: "success",
    message: "푸시 알림 구독을 해지했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...dbWithDisabledSubscription,
    auditLogs: [auditLog, ...dbWithDisabledSubscription.auditLogs],
  });

  return jsonOk({
    subscription: {
      id: record.id,
      endpointHint: createEndpointHint(record.endpoint),
      disabledAt: record.disabledAt ?? null,
    },
    activeSubscriptionCount: getVisibleActivePushSubscriptionCount(nextDb, user),
  });
}
