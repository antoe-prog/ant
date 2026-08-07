import * as webPush from "web-push";
import { createHash } from "node:crypto";
import type {
  AppUser,
  AuditLog,
  MockDatabase,
  Notice,
  PushDispatchPayloadSnapshot,
  PushSubscriptionRecord,
} from "@/lib/domain";
import { getNoticeRecipients } from "@/lib/push-subscription-scope";
import { createRuntimeId } from "@/server/runtime-id";
import {
  getNativePushProviderReadiness,
  sendApnsPush,
  sendFcmPush,
} from "@/server/native-push-providers";

export {
  getNoticePushSubscriptions,
  getNoticeRecipients,
  getVisibleActivePushSubscriptionCount,
} from "@/lib/push-subscription-scope";

type WebPushSubscriptionInput = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: {
    auth?: unknown;
    p256dh?: unknown;
  };
};

type NativePushRegistrationInput = {
  platform?: unknown;
  token?: unknown;
};

export const pushEndpointMaxLength = 2_048;
const pushKeyMaxLength = 512;
const pushKeyPattern = /^[A-Za-z0-9_-]+={0,2}$/;
const nativePushTokenMaxLength = 4_096;
const nativePushTokenPattern = /^[^\s\u0000-\u001f\u007f]+$/;

export type PushConfigPayload = {
  configured: boolean;
  publicKey: string | null;
  subject: string | null;
  providers: {
    apns: boolean;
    fcm: boolean;
    web: boolean;
  };
};

export type PushDispatchSummary = {
  configured: boolean;
  attempted: number;
  disabled: number;
  failed: number;
  sent: number;
};

export type PushDeliveryResult =
  | { outcome: "sent" }
  | {
      outcome: "failed";
      statusCode?: number;
      errorCode: string;
      message: string;
      deliveryUncertain?: boolean;
    };

type NoticePushDispatchAuditInput = {
  auditId: string;
  branchId: string;
  actorUserId: string;
  noticeId: string;
  candidateCount: number;
  recipientCount: number;
  requestedAt: string;
  autoDispatchedOnCreate?: boolean;
};

const defaultPushProviderTimeoutMs = 15_000;

export function getPushProviderTimeoutMs(env: NodeJS.ProcessEnv = process.env) {
  const configured = Number(env.FINAL_JUDO_PUSH_PROVIDER_TIMEOUT_MS);

  if (!Number.isSafeInteger(configured) || configured < 1_000 || configured > 60_000) {
    return defaultPushProviderTimeoutMs;
  }

  return configured;
}

export async function runPushDeliveryWithTimeout(
  deliver: () => Promise<PushDeliveryResult>,
  timeoutMs = getPushProviderTimeoutMs(),
): Promise<PushDeliveryResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Push provider timeout must be a positive safe integer.");
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<PushDeliveryResult>((resolve) => {
    timeout = setTimeout(() => {
      resolve({
        outcome: "failed",
        errorCode: "PUSH_PROVIDER_TIMEOUT",
        message: "알림 provider 응답 시간이 초과됐습니다.",
        deliveryUncertain: true,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve()
        .then(deliver)
        .catch(() => ({
          outcome: "failed" as const,
          errorCode: "PUSH_DELIVERY_EXCEPTION",
          message: "알림 provider 호출 결과를 확인할 수 없습니다.",
          deliveryUncertain: true,
        })),
      timeoutResult,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function getPushConfig(): PushConfigPayload {
  const publicKey = process.env.FINAL_JUDO_VAPID_PUBLIC_KEY?.trim() || null;
  const privateKey = process.env.FINAL_JUDO_VAPID_PRIVATE_KEY?.trim() || null;
  const subject = process.env.FINAL_JUDO_VAPID_SUBJECT?.trim() || null;

  const web = Boolean(publicKey && privateKey && subject);
  const nativeProviders = getNativePushProviderReadiness();

  return {
    configured: web || nativeProviders.apns || nativeProviders.fcm,
    providers: {
      ...nativeProviders,
      web,
    },
    publicKey,
    subject,
  };
}

export function normalizeNativePushRegistration(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const registration = value as NativePushRegistrationInput;
  const platform = registration.platform === "android" || registration.platform === "ios"
    ? registration.platform
    : null;
  const token = typeof registration.token === "string" ? registration.token.trim() : "";
  if (
    !platform ||
    token.length < 16 ||
    token.length > nativePushTokenMaxLength ||
    !nativePushTokenPattern.test(token)
  ) {
    return null;
  }

  return {
    endpoint: `native:${platform}:${createHash("sha256").update(token).digest("hex")}`,
    platform,
    token,
    transport: platform === "android" ? "fcm" as const : "apns" as const,
  };
}

export function normalizePushEndpoint(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const endpoint = value.trim();

  if (!endpoint || endpoint.length > pushEndpointMaxLength) {
    return null;
  }

  let endpointUrl: URL;

  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return null;
  }

  return endpointUrl.protocol === "https:" ? endpoint : null;
}

export function normalizePushSubscription(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const subscription = value as WebPushSubscriptionInput;
  const endpoint = normalizePushEndpoint(subscription.endpoint);
  const p256dh = typeof subscription.keys?.p256dh === "string" ? subscription.keys.p256dh.trim() : "";
  const auth = typeof subscription.keys?.auth === "string" ? subscription.keys.auth.trim() : "";
  const expirationTime = subscription.expirationTime;

  if (
    !endpoint ||
    !p256dh ||
    p256dh.length > pushKeyMaxLength ||
    !pushKeyPattern.test(p256dh) ||
    !auth ||
    auth.length > pushKeyMaxLength ||
    !pushKeyPattern.test(auth) ||
    (
      expirationTime !== undefined &&
      expirationTime !== null &&
      (typeof expirationTime !== "number" || !Number.isSafeInteger(expirationTime) || expirationTime < 0)
    )
  ) {
    return null;
  }

  return {
    endpoint,
    expirationTime: expirationTime ?? null,
    keys: {
      auth,
      p256dh,
    },
  };
}

export function createEndpointHint(endpoint: string) {
  return endpoint.length <= 16 ? endpoint : `...${endpoint.slice(-16)}`;
}

export async function sendPushPayloadToSubscription(
  subscription: PushSubscriptionRecord,
  payload: PushDispatchPayloadSnapshot,
): Promise<PushDeliveryResult> {
  if (subscription.transport === "fcm") {
    return subscription.deviceToken
      ? sendFcmPush(subscription.deviceToken, payload)
      : {
          outcome: "failed",
          errorCode: "FCM_TOKEN_MISSING",
          message: "Android 앱 알림 등록 정보가 올바르지 않습니다.",
        };
  }
  if (subscription.transport === "apns") {
    return subscription.deviceToken
      ? sendApnsPush(subscription.deviceToken, payload)
      : {
          outcome: "failed",
          errorCode: "APNS_TOKEN_MISSING",
          message: "iPhone 앱 알림 등록 정보가 올바르지 않습니다.",
        };
  }

  const config = getPushConfig();
  const privateKey = process.env.FINAL_JUDO_VAPID_PRIVATE_KEY?.trim();

  if (!config.providers.web || !config.publicKey || !config.subject || !privateKey) {
    return {
      outcome: "failed",
      errorCode: "PUSH_NOT_CONFIGURED",
      message: "알림 발송 설정을 확인해야 합니다.",
    };
  }

  webPush.setVapidDetails(config.subject, config.publicKey, privateKey);
  const timeoutMs = getPushProviderTimeoutMs();

  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
      { timeout: timeoutMs },
    );
    return { outcome: "sent" };
  } catch (error) {
    const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : undefined;
    const errorCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const timedOut = errorCode === "ETIMEDOUT" || errorCode === "ESOCKETTIMEDOUT";
    return {
      outcome: "failed",
      ...(Number.isSafeInteger(statusCode) && statusCode ? { statusCode } : {}),
      errorCode: timedOut ? "PUSH_PROVIDER_TIMEOUT" : statusCode ? `PUSH_HTTP_${statusCode}` : "PUSH_DELIVERY_FAILED",
      message: timedOut
        ? "알림 provider 응답 시간이 초과됐습니다."
        : statusCode === 404 || statusCode === 410
          ? "알림 수신 등록이 만료됐습니다."
          : "알림 발송 상태를 다시 확인해야 합니다.",
      ...(timedOut ? { deliveryUncertain: true } : {}),
    };
  }
}

export function isPushProviderConfiguredForSubscription(subscription: PushSubscriptionRecord) {
  const providers = getPushConfig().providers;
  if (subscription.transport === "fcm") {
    return providers.fcm;
  }
  if (subscription.transport === "apns") {
    return providers.apns;
  }
  return providers.web;
}

export function getNoticeFamilyRecipientCount(db: MockDatabase, notice: Notice) {
  return getNoticeRecipients(db, notice).filter((recipient) => recipient.role === "member" || recipient.role === "guardian").length;
}

export function createNoticePushDispatchMessage({
  candidateCount,
  recipientCount,
  summary,
}: {
  candidateCount: number;
  recipientCount: number;
  summary: PushDispatchSummary;
}) {
  if (!summary.configured) {
    return `대상 ${recipientCount}명 알림함에는 표시됩니다. 휴대폰 푸시는 기기 알림 연결 후 발송할 수 있습니다.`;
  }

  if (candidateCount === 0) {
    return `대상 ${recipientCount}명 알림함에는 표시됩니다. 휴대폰 푸시를 받을 기기가 아직 없습니다.`;
  }

  return `대상 ${recipientCount}명 알림함 표시, 휴대폰 푸시 ${summary.sent}건 발송, 실패 ${summary.failed}건입니다.`;
}

export function createNoticePushDispatchRequestAuditLog({
  auditId,
  branchId,
  actorUserId,
  noticeId,
  candidateCount,
  recipientCount,
  requestedAt,
  autoDispatchedOnCreate,
}: NoticePushDispatchAuditInput): AuditLog {
  return {
    id: auditId,
    branchId,
    actorUserId,
    action: "notification.dispatch",
    targetType: "notice",
    targetId: noticeId,
    before: null,
    after: {
      ...(autoDispatchedOnCreate ? { autoDispatchedOnCreate: true } : {}),
      dispatchState: "requested",
      candidateCount,
      recipientCount,
      requestedAt,
    },
    result: "blocked",
    message: "공지 알림 발송 요청을 저장했습니다. 발송 결과를 확인해야 합니다.",
    createdAt: requestedAt,
  };
}

export function completeNoticePushDispatchAuditLog(
  requestAuditLog: AuditLog,
  summary: PushDispatchSummary,
  completedAt: string,
): AuditLog {
  const candidateCount = Number(requestAuditLog.after?.candidateCount ?? 0);
  const recipientCount = Number(requestAuditLog.after?.recipientCount ?? 0);
  const result: AuditLog["result"] =
    !summary.configured || candidateCount === 0 ? "blocked" : summary.failed > 0 ? "failed" : "success";

  return {
    ...requestAuditLog,
    after: {
      ...requestAuditLog.after,
      dispatchState: result === "success" ? "completed" : result,
      configured: summary.configured,
      attempted: summary.attempted,
      sent: summary.sent,
      failed: summary.failed,
      disabled: summary.disabled,
      completedAt,
    },
    result,
    message: createNoticePushDispatchMessage({ candidateCount, recipientCount, summary }),
  };
}

export function upsertPushSubscription(
  db: MockDatabase,
  user: AppUser,
  subscription: NonNullable<ReturnType<typeof normalizePushSubscription>>,
  userAgent?: string,
) {
  const now = new Date().toISOString();
  const existing = db.pushSubscriptions.find((item) => item.endpoint === subscription.endpoint);
  const nextRecord: PushSubscriptionRecord = {
    id: existing?.id ?? createRuntimeId("push"),
    userId: user.id,
    branchIds: [...new Set(user.branchIds)],
    transport: "web",
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    userAgent: typeof userAgent === "string" ? userAgent.trim() || existing?.userAgent : existing?.userAgent,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  return {
    db: {
      ...db,
      pushSubscriptions: existing
        ? db.pushSubscriptions.map((item) => (item.id === existing.id ? nextRecord : item))
        : [nextRecord, ...db.pushSubscriptions],
    },
    record: nextRecord,
  };
}

export function upsertNativePushRegistration(
  db: MockDatabase,
  user: AppUser,
  registration: NonNullable<ReturnType<typeof normalizeNativePushRegistration>>,
  userAgent?: string,
) {
  const now = new Date().toISOString();
  const existing = db.pushSubscriptions.find((item) => item.endpoint === registration.endpoint);
  const nextRecord: PushSubscriptionRecord = {
    id: existing?.id ?? createRuntimeId("push"),
    userId: user.id,
    branchIds: [...new Set(user.branchIds)],
    transport: registration.transport,
    endpoint: registration.endpoint,
    keys: { auth: "", p256dh: "" },
    deviceToken: registration.token,
    userAgent: typeof userAgent === "string" ? userAgent.trim() || existing?.userAgent : existing?.userAgent,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  return {
    db: {
      ...db,
      pushSubscriptions: existing
        ? db.pushSubscriptions.map((item) => item.id === existing.id ? nextRecord : item)
        : [nextRecord, ...db.pushSubscriptions],
    },
    record: nextRecord,
  };
}

export function isNativePushRegistrationCurrentForUser(
  existing: PushSubscriptionRecord | undefined,
  user: AppUser,
  registration: NonNullable<ReturnType<typeof normalizeNativePushRegistration>>,
  userAgent?: string,
) {
  if (!existing || existing.disabledAt) {
    return false;
  }
  const existingBranchIds = [...new Set(existing.branchIds)].sort();
  const currentBranchIds = [...new Set(user.branchIds)].sort();
  const normalizedUserAgent = typeof userAgent === "string" ? userAgent.trim() || existing.userAgent : existing.userAgent;

  return (
    existing.userId === user.id &&
    existing.transport === registration.transport &&
    existing.deviceToken === registration.token &&
    existing.userAgent === normalizedUserAgent &&
    existingBranchIds.length === currentBranchIds.length &&
    existingBranchIds.every((branchId, index) => branchId === currentBranchIds[index])
  );
}

export function isPushSubscriptionCurrentForUser(
  existing: PushSubscriptionRecord | undefined,
  user: AppUser,
  subscription: NonNullable<ReturnType<typeof normalizePushSubscription>>,
  userAgent?: string,
) {
  if (!existing || existing.disabledAt) {
    return false;
  }

  const existingBranchIds = [...new Set(existing.branchIds)].sort();
  const currentBranchIds = [...new Set(user.branchIds)].sort();
  const normalizedUserAgent = typeof userAgent === "string" ? userAgent.trim() || existing.userAgent : existing.userAgent;

  return (
    existing.userId === user.id &&
    existing.endpoint === subscription.endpoint &&
    existing.keys.auth === subscription.keys.auth &&
    existing.keys.p256dh === subscription.keys.p256dh &&
    existing.userAgent === normalizedUserAgent &&
    existingBranchIds.length === currentBranchIds.length &&
    existingBranchIds.every((branchId, index) => branchId === currentBranchIds[index])
  );
}

export function disablePushSubscription(db: MockDatabase, endpoint: string, user: AppUser) {
  const now = new Date().toISOString();
  const existing = db.pushSubscriptions.find((item) => item.endpoint === endpoint && item.userId === user.id);

  if (!existing) {
    return { db, record: null };
  }

  const nextRecord = {
    ...existing,
    disabledAt: now,
    updatedAt: now,
  };

  return {
    db: {
      ...db,
      pushSubscriptions: db.pushSubscriptions.map((item) => (item.id === existing.id ? nextRecord : item)),
    },
    record: nextRecord,
  };
}
