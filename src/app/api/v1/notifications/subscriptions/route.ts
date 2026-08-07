import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { jsonError, jsonOk, requireSession } from "@/server/api";
import { withAuthAndNotificationStateLock } from "@/server/auth-notification-state-lock";
import {
  cancelPushDispatchJobsForSubscriptions,
  hasInFlightPushDispatchForSubscription,
} from "@/server/notification-outbox";
import {
  createEndpointHint,
  disablePushSubscription,
  getVisibleActivePushSubscriptionCount,
  isNativePushRegistrationCurrentForUser,
  isPushSubscriptionCurrentForUser,
  normalizeNativePushRegistration,
  normalizePushEndpoint,
  normalizePushSubscription,
  upsertNativePushRegistration,
  upsertPushSubscription,
} from "@/server/push-notifications";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const familyNotificationAlwaysOnRoles = new Set(["member", "guardian"]);
const pushUserAgentMaxLength = 512;

type SubscribeBody = {
  allowReactivation?: boolean;
  nativeRegistration?: unknown;
  subscription?: unknown;
  userAgent?: string;
};

type UnsubscribeBody = {
  endpoint?: string;
};

export async function POST(request: NextRequest) {
  const initialDb = await readServerDb();
  const { user, response } = requireSession(request, initialDb);

  if (!user) {
    return response;
  }

  const body = (await request.json().catch(() => null)) as SubscribeBody | null;
  const subscription = normalizePushSubscription(body?.subscription);
  const nativeRegistration = normalizeNativePushRegistration(body?.nativeRegistration);
  const userAgent = typeof body?.userAgent === "string" ? body.userAgent.trim() : undefined;

  if ((!subscription && !nativeRegistration) || (subscription && nativeRegistration)) {
    return jsonError(400, "VALIDATION_ERROR", "공지 알림 등록 정보가 올바르지 않습니다.");
  }

  if (
    (body?.allowReactivation !== undefined && typeof body.allowReactivation !== "boolean") ||
    (body?.userAgent !== undefined && typeof body.userAgent !== "string") ||
    (userAgent?.length ?? 0) > pushUserAgentMaxLength
  ) {
    return jsonError(400, "VALIDATION_ERROR", "공지 알림 기기 정보가 올바르지 않습니다.");
  }

  return withAuthAndNotificationStateLock(() => subscription
    ? persistPushSubscription(request, subscription, userAgent, body?.allowReactivation === true)
    : persistNativePushRegistration(request, nativeRegistration!, userAgent, body?.allowReactivation === true));
}

async function persistNativePushRegistration(
  request: NextRequest,
  registration: NonNullable<ReturnType<typeof normalizeNativePushRegistration>>,
  userAgent?: string,
  allowReactivation = false,
) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);
  if (!user) {
    return response;
  }

  const existing = db.pushSubscriptions.find((item) => item.endpoint === registration.endpoint);
  if (existing && isNativePushRegistrationCurrentForUser(existing, user, registration, userAgent)) {
    return jsonOk({
      subscription: {
        id: existing.id,
        endpointHint: createEndpointHint(existing.endpoint),
        disabledAt: null,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
    });
  }
  if (existing?.disabledAt && !allowReactivation) {
    return jsonOk({
      subscription: {
        id: existing.id,
        endpointHint: createEndpointHint(existing.endpoint),
        disabledAt: existing.disabledAt,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
      reactivationRequired: true,
    });
  }
  if (existing && hasInFlightPushDispatchForSubscription(db, existing.id)) {
    return jsonError(
      409,
      "PUSH_SUBSCRIPTION_UPDATE_PENDING",
      "기기의 알림 발송을 마무리하고 있습니다. 잠시 후 다시 연결해 주세요.",
    );
  }

  const { db: dbWithRegistration, record } = upsertNativePushRegistration(db, user, registration, userAgent);
  const now = new Date().toISOString();
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: user.branchIds[0] ?? null,
    actorUserId: user.id,
    action: "notification.subscribe",
    targetType: "push_subscription",
    targetId: record.id,
    before: existing ? { endpointHint: createEndpointHint(existing.endpoint), userId: existing.userId } : null,
    after: {
      endpointHint: createEndpointHint(record.endpoint),
      branchIds: record.branchIds,
      transport: record.transport,
      userId: record.userId,
      userAgent: record.userAgent,
    },
    result: "success",
    message: existing?.userId !== record.userId
      ? "앱 알림 기기의 계정 연결을 변경했습니다."
      : "앱 알림 기기를 저장했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...dbWithRegistration,
    auditLogs: [auditLog, ...dbWithRegistration.auditLogs],
  });

  return jsonOk({
    subscription: {
      id: record.id,
      endpointHint: createEndpointHint(record.endpoint),
      disabledAt: null,
    },
    activeSubscriptionCount: getVisibleActivePushSubscriptionCount(nextDb, user),
  });
}

async function persistPushSubscription(
  request: NextRequest,
  subscription: NonNullable<ReturnType<typeof normalizePushSubscription>>,
  userAgent?: string,
  allowReactivation = false,
) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const existing = db.pushSubscriptions.find((item) => item.endpoint === subscription.endpoint);

  if (existing && isPushSubscriptionCurrentForUser(existing, user, subscription, userAgent)) {
    return jsonOk({
      subscription: {
        id: existing.id,
        endpointHint: createEndpointHint(existing.endpoint),
        disabledAt: null,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
    });
  }

  if (existing?.disabledAt && !allowReactivation) {
    return jsonOk({
      subscription: {
        id: existing.id,
        endpointHint: createEndpointHint(existing.endpoint),
        disabledAt: existing.disabledAt,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
      reactivationRequired: true,
    });
  }

  if (existing && hasInFlightPushDispatchForSubscription(db, existing.id)) {
    return jsonError(
      409,
      "PUSH_SUBSCRIPTION_UPDATE_PENDING",
      "기기의 알림 발송을 마무리하고 있습니다. 잠시 후 다시 연결해 주세요.",
    );
  }

  const { db: dbWithSubscription, record } = upsertPushSubscription(db, user, subscription, userAgent);
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: user.branchIds[0] ?? null,
    actorUserId: user.id,
    action: "notification.subscribe",
    targetType: "push_subscription",
    targetId: record.id,
    before: existing
      ? {
          endpointHint: createEndpointHint(existing.endpoint),
          userId: existing.userId,
        }
      : null,
    after: {
      endpointHint: createEndpointHint(record.endpoint),
      branchIds: record.branchIds,
      userId: record.userId,
      userAgent: record.userAgent,
    },
    result: "success",
    message: existing?.userId !== record.userId
      ? "푸시 알림 구독의 계정 연결을 변경했습니다."
      : "푸시 알림 구독을 저장했습니다.",
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
  const initialDb = await readServerDb();
  const { user, response } = requireSession(request, initialDb);

  if (!user) {
    return response;
  }

  const rawBody = await request.json().catch(() => null);

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "해지할 공지 알림 정보가 올바른 JSON 객체가 아닙니다.");
  }

  const body = rawBody as UnsubscribeBody;

  if (body.endpoint !== undefined && typeof body.endpoint !== "string") {
    return jsonError(400, "VALIDATION_ERROR", "해지할 공지 알림 값의 형식이 올바르지 않습니다.");
  }

  const endpoint = normalizePushEndpoint(body.endpoint);

  if (!endpoint) {
    return jsonError(400, "VALIDATION_ERROR", "해지할 공지 알림 정보가 올바르지 않습니다.");
  }

  return withAuthAndNotificationStateLock(() =>
    persistPushUnsubscribe(request, endpoint),
  );
}

async function persistPushUnsubscribe(request: NextRequest, endpoint: string) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const existing = db.pushSubscriptions.find((item) => item.endpoint === endpoint && item.userId === user.id);

  if (!existing) {
    return jsonError(404, "NOT_FOUND", "해지할 푸시 구독을 찾을 수 없습니다.");
  }

  if (familyNotificationAlwaysOnRoles.has(user.role)) {
    if (existing.disabledAt) {
      return jsonOk({
        subscription: {
          id: existing.id,
          endpointHint: createEndpointHint(existing.endpoint),
          disabledAt: existing.disabledAt,
        },
        activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
        enforcedAlwaysOn: true,
        reactivationRequired: true,
      });
    }

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
      id: createRuntimeId("audit"),
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

  const now = record.disabledAt ?? new Date().toISOString();
  const dbWithCancelledJobs = cancelPushDispatchJobsForSubscriptions(
    dbWithDisabledSubscription,
    new Set([record.id]),
    {
      now,
      reason: "푸시 알림 구독이 해지되어 대기 발송을 취소했습니다.",
    },
  );
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
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
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...dbWithCancelledJobs,
    auditLogs: [auditLog, ...dbWithCancelledJobs.auditLogs],
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
