import * as webPush from "web-push";
import type { AppUser, MockDatabase, Notice, PushSubscriptionRecord } from "@/lib/domain";
import { isNoticeRecipient } from "@/lib/mock-api";

type WebPushSubscriptionInput = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: {
    auth?: unknown;
    p256dh?: unknown;
  };
};

export type PushConfigPayload = {
  configured: boolean;
  publicKey: string | null;
  subject: string | null;
};

export type PushDispatchSummary = {
  configured: boolean;
  attempted: number;
  disabled: number;
  failed: number;
  sent: number;
};

export function getPushConfig(): PushConfigPayload {
  const publicKey = process.env.FINAL_JUDO_VAPID_PUBLIC_KEY?.trim() || null;
  const privateKey = process.env.FINAL_JUDO_VAPID_PRIVATE_KEY?.trim() || null;
  const subject = process.env.FINAL_JUDO_VAPID_SUBJECT?.trim() || null;

  return {
    configured: Boolean(publicKey && privateKey && subject),
    publicKey,
    subject,
  };
}

export function normalizePushSubscription(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const subscription = value as WebPushSubscriptionInput;
  const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint.trim() : "";
  const p256dh = typeof subscription.keys?.p256dh === "string" ? subscription.keys.p256dh.trim() : "";
  const auth = typeof subscription.keys?.auth === "string" ? subscription.keys.auth.trim() : "";
  const expirationTime =
    typeof subscription.expirationTime === "number" && Number.isFinite(subscription.expirationTime)
      ? subscription.expirationTime
      : null;

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint,
    expirationTime,
    keys: {
      auth,
      p256dh,
    },
  };
}

export function createEndpointHint(endpoint: string) {
  return endpoint.length <= 16 ? endpoint : `...${endpoint.slice(-16)}`;
}

export function createPushPayload(notice: Notice) {
  return {
    title: notice.important ? `[중요] ${notice.title}` : notice.title,
    body: notice.body,
    tag: `final-judo-notice-${notice.id}`,
    url: "/app/notifications",
  };
}

export function getNoticeRecipients(db: MockDatabase, notice: Notice) {
  return db.users.filter((user) => isNoticeRecipient(user, db, notice));
}

export function getNoticeFamilyRecipientCount(db: MockDatabase, notice: Notice) {
  return getNoticeRecipients(db, notice).filter((recipient) => recipient.role === "member" || recipient.role === "guardian").length;
}

export function getNoticePushSubscriptions(db: MockDatabase, notice: Notice) {
  const recipientIds = new Set(getNoticeRecipients(db, notice).map((user) => user.id));

  return db.pushSubscriptions.filter(
    (subscription) =>
      !subscription.disabledAt &&
      recipientIds.has(subscription.userId) &&
      subscription.branchIds.includes(notice.branchId),
  );
}

export function getVisibleActivePushSubscriptionCount(db: MockDatabase, user: AppUser) {
  const activeSubscriptions = db.pushSubscriptions.filter((subscription) => !subscription.disabledAt);

  if (user.role === "owner" || user.role === "admin") {
    const branchIds = new Set(user.branchIds);

    return activeSubscriptions.filter((subscription) =>
      subscription.branchIds.some((branchId) => branchIds.has(branchId)),
    ).length;
  }

  return activeSubscriptions.filter((subscription) => subscription.userId === user.id).length;
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

export function upsertPushSubscription(
  db: MockDatabase,
  user: AppUser,
  subscription: NonNullable<ReturnType<typeof normalizePushSubscription>>,
  userAgent?: string,
) {
  const now = new Date().toISOString();
  const existing = db.pushSubscriptions.find((item) => item.endpoint === subscription.endpoint);
  const nextRecord: PushSubscriptionRecord = {
    id: existing?.id ?? `push-${Date.now()}-${db.pushSubscriptions.length + 1}`,
    userId: user.id,
    branchIds: [...new Set(user.branchIds)],
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    userAgent: userAgent?.trim() || existing?.userAgent,
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

export async function dispatchNoticePushNotifications(
  db: MockDatabase,
  notice: Notice,
): Promise<{ db: MockDatabase; summary: PushDispatchSummary }> {
  const config = getPushConfig();
  const subscriptions = getNoticePushSubscriptions(db, notice);
  const summary: PushDispatchSummary = {
    configured: config.configured,
    attempted: subscriptions.length,
    disabled: 0,
    failed: 0,
    sent: 0,
  };

  if (!config.configured || !config.publicKey || !config.subject || !process.env.FINAL_JUDO_VAPID_PRIVATE_KEY) {
    return { db, summary };
  }

  webPush.setVapidDetails(config.subject, config.publicKey, process.env.FINAL_JUDO_VAPID_PRIVATE_KEY);

  const payload = JSON.stringify(createPushPayload(notice));
  const now = new Date().toISOString();
  let nextSubscriptions = db.pushSubscriptions;

  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        payload,
      );
      summary.sent += 1;
      nextSubscriptions = nextSubscriptions.map((item) =>
        item.id === subscription.id
          ? { ...item, lastSentAt: now, lastFailureAt: undefined, lastFailureReason: undefined, updatedAt: now }
          : item,
      );
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      const shouldDisable = statusCode === 404 || statusCode === 410;
      const failureReason = shouldDisable ? "알림 수신 등록을 다시 확인해야 합니다." : "알림 발송 상태를 다시 확인해야 합니다.";

      summary.failed += 1;
      summary.disabled += shouldDisable ? 1 : 0;
      nextSubscriptions = nextSubscriptions.map((item) =>
        item.id === subscription.id
          ? {
              ...item,
              disabledAt: shouldDisable ? now : item.disabledAt,
              lastFailureAt: now,
              lastFailureReason: failureReason.slice(0, 240),
              updatedAt: now,
            }
          : item,
      );
    }
  }

  return {
    db: {
      ...db,
      pushSubscriptions: nextSubscriptions,
    },
    summary,
  };
}
