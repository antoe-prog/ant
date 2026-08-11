import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppUser, MockDatabase, PushSubscriptionRecord } from "../lib/domain.ts";
import { rememberedSessionMaxAgeSeconds } from "./auth-policy.ts";
import { cancelPushDispatchJobsForSubscriptions } from "./notification-outbox.ts";

type PushDeviceCookieEnv = {
  NODE_ENV?: string;
};

export const pushDeviceSubscriptionCookieName = "final-judo-push-device";
const pushDeviceSessionVersion = "v1";
const pushDeviceSessionSecretBytes = 32;

export function createPushDeviceSubscriptionCookieOptions(
  env: PushDeviceCookieEnv = process.env,
) {
  return {
    httpOnly: true,
    maxAge: rememberedSessionMaxAgeSeconds,
    path: "/",
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
  };
}

export function createExpiredPushDeviceSubscriptionCookieOptions(
  env: PushDeviceCookieEnv = process.env,
) {
  return {
    ...createPushDeviceSubscriptionCookieOptions(env),
    maxAge: 0,
  };
}

function hashPushDeviceSession(
  subscriptionId: string,
  expiresAtSeconds: number,
  secret: string,
) {
  return createHash("sha256")
    .update(`${pushDeviceSessionVersion}\0${subscriptionId}\0${expiresAtSeconds}\0${secret}`)
    .digest("hex");
}

function parsePushDeviceSessionCookie(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  const match = /^v1\.(push-[A-Za-z0-9][A-Za-z0-9_-]{0,127})\.([1-9][0-9]{9,12})\.([A-Za-z0-9_-]{43})$/.exec(normalized);

  if (!match) {
    return null;
  }

  const expiresAtSeconds = Number(match[2]);
  if (!Number.isSafeInteger(expiresAtSeconds)) {
    return null;
  }

  return {
    expiresAtSeconds,
    secret: match[3],
    subscriptionId: match[1],
  };
}

function matchesStoredPushDeviceSession(
  subscription: PushSubscriptionRecord,
  expiresAtSeconds: number,
  secret: string,
) {
  const storedHash = subscription.deviceSessionHash;
  if (!storedHash || !/^[a-f0-9]{64}$/.test(storedHash)) {
    return false;
  }

  const candidateHash = hashPushDeviceSession(
    subscription.id,
    expiresAtSeconds,
    secret,
  );
  return timingSafeEqual(
    Buffer.from(storedHash, "hex"),
    Buffer.from(candidateHash, "hex"),
  );
}

export function getPushDeviceSubscriptionId(
  db: MockDatabase,
  cookieValue: string | undefined,
  now = new Date(),
) {
  const session = parsePushDeviceSessionCookie(cookieValue);
  if (!session || session.expiresAtSeconds <= Math.floor(now.getTime() / 1000)) {
    return null;
  }

  const subscription = db.pushSubscriptions.find(
    (candidate) => candidate.id === session.subscriptionId,
  );

  return subscription && matchesStoredPushDeviceSession(
    subscription,
    session.expiresAtSeconds,
    session.secret,
  )
    ? subscription.id
    : null;
}

export function issuePushDeviceSession(
  db: MockDatabase,
  subscriptionId: string,
  now = new Date(),
) {
  const subscription = db.pushSubscriptions.find(
    (candidate) => candidate.id === subscriptionId,
  );

  if (!subscription) {
    throw new Error("Push subscription is required before issuing a device session.");
  }

  const secret = randomBytes(pushDeviceSessionSecretBytes).toString("base64url");
  const expiresAtSeconds = Math.floor(
    now.getTime() / 1000 + rememberedSessionMaxAgeSeconds,
  );
  const updatedAt = now.toISOString();
  const record: PushSubscriptionRecord = {
    ...subscription,
    deviceSessionHash: hashPushDeviceSession(
      subscription.id,
      expiresAtSeconds,
      secret,
    ),
    updatedAt,
  };

  return {
    cookieValue: `${pushDeviceSessionVersion}.${record.id}.${expiresAtSeconds}.${secret}`,
    db: {
      ...db,
      pushSubscriptions: db.pushSubscriptions.map((candidate) =>
        candidate.id === record.id ? record : candidate,
      ),
    },
    record,
  };
}

export function detachPushDeviceSubscriptionOnLogout(
  db: MockDatabase,
  user: AppUser | null,
  cookieValue: string | undefined,
  now = new Date(),
): { db: MockDatabase; record: PushSubscriptionRecord | null } {
  return detachPushDeviceSubscription(db, cookieValue, now, {
    cancellationReason: "현재 기기에서 로그아웃하여 대기 중인 알림 발송을 취소했습니다.",
    disabledReason: "logout",
    matchesOwner: (subscription) => !user || subscription.userId === user.id,
  });
}

export function detachPushDeviceSubscriptionOnAccountSwitch(
  db: MockDatabase,
  nextUser: AppUser,
  cookieValue: string | undefined,
  now = new Date(),
): { db: MockDatabase; record: PushSubscriptionRecord | null } {
  return detachPushDeviceSubscription(db, cookieValue, now, {
    cancellationReason: "현재 기기에서 다른 계정으로 로그인하여 이전 계정의 대기 중인 알림 발송을 취소했습니다.",
    disabledReason: "account_switch",
    matchesOwner: (subscription) => subscription.userId !== nextUser.id,
  });
}

function detachPushDeviceSubscription(
  db: MockDatabase,
  cookieValue: string | undefined,
  now: Date,
  options: {
    cancellationReason: string;
    disabledReason: NonNullable<PushSubscriptionRecord["disabledReason"]>;
    matchesOwner: (subscription: PushSubscriptionRecord) => boolean;
  },
): { db: MockDatabase; record: PushSubscriptionRecord | null } {
  const subscriptionId = getPushDeviceSubscriptionId(db, cookieValue, now);
  if (!subscriptionId) {
    return { db, record: null };
  }

  const existing = db.pushSubscriptions.find(
    (subscription) =>
      subscription.id === subscriptionId &&
      options.matchesOwner(subscription) &&
      !subscription.disabledAt,
  );

  if (!existing) {
    return { db, record: null };
  }

  const disabledAt = now.toISOString();
  const record: PushSubscriptionRecord = {
    ...existing,
    disabledAt,
    disabledReason: options.disabledReason,
    updatedAt: disabledAt,
  };
  const dbWithDisabledSubscription: MockDatabase = {
    ...db,
    pushSubscriptions: db.pushSubscriptions.map((subscription) =>
      subscription.id === record.id ? record : subscription,
    ),
  };

  return {
    db: cancelPushDispatchJobsForSubscriptions(
      dbWithDisabledSubscription,
      new Set([record.id]),
      {
        now: disabledAt,
        reason: options.cancellationReason,
      },
    ),
    record,
  };
}
