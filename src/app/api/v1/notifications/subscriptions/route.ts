import { NextRequest, type NextResponse } from "next/server";
import type { AuditLog, PushSubscriptionRecord } from "@/lib/domain";
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
  hasMatchingWebPushCredential,
  isNativePushRegistrationCurrentForUser,
  isPushSubscriptionCurrentForUser,
  normalizeNativePushRegistration,
  normalizePushEndpoint,
  normalizePushSubscription,
  upsertNativePushRegistration,
  upsertPushSubscription,
} from "@/server/push-notifications";
import { createRuntimeId } from "@/server/runtime-id";
import {
  createPushDeviceSubscriptionCookieOptions,
  getPushDeviceSubscriptionId,
  issuePushDeviceSession,
  pushDeviceSubscriptionCookieName,
} from "@/server/push-device-session";

export const runtime = "nodejs";

const familyNotificationAlwaysOnRoles = new Set(["member", "guardian"]);
const pushUserAgentMaxLength = 512;
const expectedPushUserIdMaxLength = 160;

type SubscribeBody = {
  allowReactivation?: boolean;
  expectedUserId?: unknown;
  nativeRegistration?: unknown;
  subscription?: unknown;
  userAgent?: string;
};

type UnsubscribeBody = {
  endpoint?: string;
};

function attachPushDeviceCookie(response: NextResponse, cookieValue: string) {
  response.cookies.set(
    pushDeviceSubscriptionCookieName,
    cookieValue,
    createPushDeviceSubscriptionCookieOptions(),
  );

  return response;
}

async function attachVerifiedPushDeviceCookie(
  request: NextRequest,
  response: NextResponse,
  db: Awaited<ReturnType<typeof readServerDb>>,
  record: PushSubscriptionRecord,
) {
  const currentCookieValue = request.cookies.get(pushDeviceSubscriptionCookieName)?.value;

  if (getPushDeviceSubscriptionId(db, currentCookieValue) === record.id) {
    return response;
  }

  const issuedDeviceSession = issuePushDeviceSession(db, record.id);
  await writeServerDb(issuedDeviceSession.db);
  return attachPushDeviceCookie(response, issuedDeviceSession.cookieValue);
}

function requiresExplicitReactivation(
  existing: PushSubscriptionRecord | undefined,
  allowReactivation: boolean,
) {
  return Boolean(
    existing?.disabledAt &&
    existing.disabledReason !== "logout" &&
    existing.disabledReason !== "account_switch" &&
    !allowReactivation,
  );
}

function rejectChangedPushAccount(userId: string, expectedUserId?: string) {
  return expectedUserId && expectedUserId !== userId
    ? jsonError(
        409,
        "AUTH_SESSION_CHANGED",
        "로그인 계정이 변경되었습니다. 현재 계정에서 알림 연결을 다시 시도해 주세요.",
      )
    : null;
}

function findCredentialedReplacementSubscription(
  request: NextRequest,
  db: Awaited<ReturnType<typeof readServerDb>>,
  userId: string,
  nextEndpoint: string,
) {
  const cookieValue = request.cookies.get(pushDeviceSubscriptionCookieName)?.value;
  const subscriptionId = getPushDeviceSubscriptionId(db, cookieValue);

  return subscriptionId
    ? db.pushSubscriptions.find((item) =>
        item.id === subscriptionId &&
        item.userId === userId &&
        !item.disabledAt &&
        item.endpoint !== nextEndpoint,
      )
    : undefined;
}

function hasInFlightPushMutation(
  db: Awaited<ReturnType<typeof readServerDb>>,
  subscriptions: Array<PushSubscriptionRecord | undefined>,
) {
  return subscriptions.some((subscription) =>
    subscription && hasInFlightPushDispatchForSubscription(db, subscription.id),
  );
}

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
  const expectedUserId = typeof body?.expectedUserId === "string" ? body.expectedUserId.trim() : undefined;

  if ((!subscription && !nativeRegistration) || (subscription && nativeRegistration)) {
    return jsonError(400, "VALIDATION_ERROR", "공지 알림 등록 정보가 올바르지 않습니다.");
  }

  if (
    (body?.allowReactivation !== undefined && typeof body.allowReactivation !== "boolean") ||
    (
      body?.expectedUserId !== undefined &&
      (typeof body.expectedUserId !== "string" || !expectedUserId || expectedUserId.length > expectedPushUserIdMaxLength)
    ) ||
    (body?.userAgent !== undefined && typeof body.userAgent !== "string") ||
    (userAgent?.length ?? 0) > pushUserAgentMaxLength
  ) {
    return jsonError(400, "VALIDATION_ERROR", "공지 알림 기기 정보가 올바르지 않습니다.");
  }

  return withAuthAndNotificationStateLock(() => subscription
    ? persistPushSubscription(request, subscription, userAgent, body?.allowReactivation === true, expectedUserId)
    : persistNativePushRegistration(request, nativeRegistration!, userAgent, body?.allowReactivation === true, expectedUserId));
}

async function persistNativePushRegistration(
  request: NextRequest,
  registration: NonNullable<ReturnType<typeof normalizeNativePushRegistration>>,
  userAgent?: string,
  allowReactivation = false,
  expectedUserId?: string,
) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);
  if (!user) {
    return response;
  }
  const changedAccountResponse = rejectChangedPushAccount(user.id, expectedUserId);
  if (changedAccountResponse) {
    return changedAccountResponse;
  }

  const existing = db.pushSubscriptions.find((item) => item.endpoint === registration.endpoint);
  const replacement = findCredentialedReplacementSubscription(
    request,
    db,
    user.id,
    registration.endpoint,
  );
  if (existing && !replacement && isNativePushRegistrationCurrentForUser(existing, user, registration, userAgent)) {
    return attachVerifiedPushDeviceCookie(request, jsonOk({
      subscription: {
        id: existing.id,
        endpointHint: createEndpointHint(existing.endpoint),
        disabledAt: null,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
    }), db, existing);
  }
  if (existing && requiresExplicitReactivation(existing, allowReactivation)) {
    const reactivationResponse = jsonOk({
      subscription: {
        id: existing.id,
        endpointHint: createEndpointHint(existing.endpoint),
        disabledAt: existing.disabledAt,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
      reactivationRequired: true,
    });
    return replacement
      ? reactivationResponse
      : attachVerifiedPushDeviceCookie(request, reactivationResponse, db, existing);
  }
  if (hasInFlightPushMutation(db, [existing, replacement])) {
    return jsonError(
      409,
      "PUSH_SUBSCRIPTION_UPDATE_PENDING",
      "기기의 알림 발송을 마무리하고 있습니다. 잠시 후 다시 연결해 주세요.",
    );
  }

  const {
    db: dbWithRegistration,
    record,
    retiredSubscriptionId,
  } = upsertNativePushRegistration(db, user, registration, userAgent, {
    replacementSubscriptionId: replacement?.id,
  });
  const now = new Date().toISOString();
  const dbWithReconciledRegistration = retiredSubscriptionId
    ? cancelPushDispatchJobsForSubscriptions(
        dbWithRegistration,
        new Set([retiredSubscriptionId]),
        {
          now,
          reason: "앱 알림 기기 토큰이 갱신되어 이전 토큰의 대기 발송을 취소했습니다.",
        },
      )
    : dbWithRegistration;
  const previous = existing ?? replacement;
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: user.branchIds[0] ?? null,
    actorUserId: user.id,
    action: "notification.subscribe",
    targetType: "push_subscription",
    targetId: record.id,
    before: previous
      ? {
          endpointHint: createEndpointHint(previous.endpoint),
          userId: previous.userId,
          ...(retiredSubscriptionId ? { retiredSubscriptionId } : {}),
        }
      : null,
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
      : replacement
        ? "앱 알림 기기 토큰을 갱신했습니다."
        : "앱 알림 기기를 저장했습니다.",
    createdAt: now,
  };
  const issuedDeviceSession = issuePushDeviceSession(dbWithReconciledRegistration, record.id);
  const nextDb = await writeServerDb({
    ...issuedDeviceSession.db,
    auditLogs: [auditLog, ...issuedDeviceSession.db.auditLogs],
  });

  return attachPushDeviceCookie(jsonOk({
    subscription: {
      id: record.id,
      endpointHint: createEndpointHint(record.endpoint),
      disabledAt: null,
    },
    activeSubscriptionCount: getVisibleActivePushSubscriptionCount(nextDb, user),
  }), issuedDeviceSession.cookieValue);
}

async function persistPushSubscription(
  request: NextRequest,
  subscription: NonNullable<ReturnType<typeof normalizePushSubscription>>,
  userAgent?: string,
  allowReactivation = false,
  expectedUserId?: string,
) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }
  const changedAccountResponse = rejectChangedPushAccount(user.id, expectedUserId);
  if (changedAccountResponse) {
    return changedAccountResponse;
  }

  const existing = db.pushSubscriptions.find((item) => item.endpoint === subscription.endpoint);
  const replacement = findCredentialedReplacementSubscription(
    request,
    db,
    user.id,
    subscription.endpoint,
  );

  if (
    existing &&
    existing.userId !== user.id &&
    !hasMatchingWebPushCredential(existing, subscription)
  ) {
    return jsonError(
      409,
      "PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT",
      "현재 브라우저의 알림 연결 정보를 다시 확인해 주세요.",
    );
  }

  if (existing && !replacement && isPushSubscriptionCurrentForUser(existing, user, subscription, userAgent)) {
    return attachVerifiedPushDeviceCookie(request, jsonOk({
      subscription: {
        id: existing.id,
        endpointHint: createEndpointHint(existing.endpoint),
        disabledAt: null,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
    }), db, existing);
  }

  if (existing && requiresExplicitReactivation(existing, allowReactivation)) {
    const reactivationResponse = jsonOk({
      subscription: {
        id: existing.id,
        endpointHint: createEndpointHint(existing.endpoint),
        disabledAt: existing.disabledAt,
      },
      activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
      reactivationRequired: true,
    });
    return replacement
      ? reactivationResponse
      : attachVerifiedPushDeviceCookie(request, reactivationResponse, db, existing);
  }

  if (hasInFlightPushMutation(db, [existing, replacement])) {
    return jsonError(
      409,
      "PUSH_SUBSCRIPTION_UPDATE_PENDING",
      "기기의 알림 발송을 마무리하고 있습니다. 잠시 후 다시 연결해 주세요.",
    );
  }

  const {
    db: dbWithSubscription,
    record,
    retiredSubscriptionId,
  } = upsertPushSubscription(db, user, subscription, userAgent, {
    replacementSubscriptionId: replacement?.id,
  });
  const now = new Date().toISOString();
  const dbWithReconciledSubscription = retiredSubscriptionId
    ? cancelPushDispatchJobsForSubscriptions(
        dbWithSubscription,
        new Set([retiredSubscriptionId]),
        {
          now,
          reason: "브라우저 알림 구독이 갱신되어 이전 구독의 대기 발송을 취소했습니다.",
        },
      )
    : dbWithSubscription;
  const previous = existing ?? replacement;
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: user.branchIds[0] ?? null,
    actorUserId: user.id,
    action: "notification.subscribe",
    targetType: "push_subscription",
    targetId: record.id,
    before: previous
      ? {
          endpointHint: createEndpointHint(previous.endpoint),
          userId: previous.userId,
          ...(retiredSubscriptionId ? { retiredSubscriptionId } : {}),
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
      : replacement
        ? "브라우저 알림 구독을 갱신했습니다."
        : "브라우저 알림 구독을 저장했습니다.",
    createdAt: now,
  };
  const issuedDeviceSession = issuePushDeviceSession(dbWithReconciledSubscription, record.id);
  const nextDb = await writeServerDb({
    ...issuedDeviceSession.db,
    auditLogs: [auditLog, ...issuedDeviceSession.db.auditLogs],
  });

  return attachPushDeviceCookie(jsonOk({
    subscription: {
      id: record.id,
      endpointHint: createEndpointHint(record.endpoint),
      disabledAt: record.disabledAt ?? null,
    },
    activeSubscriptionCount: getVisibleActivePushSubscriptionCount(nextDb, user),
  }), issuedDeviceSession.cookieValue);
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
