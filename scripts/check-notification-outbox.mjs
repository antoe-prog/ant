import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";

const {
  beginPushDispatchProviderCall,
  calculateNotificationOutboxBackoffMs,
  cancelPushDispatchJob,
  cancelPushDispatchJobsForSubscriptions,
  createNoticePushPayloadSnapshot,
  enqueuePushDispatchJob,
  hasInFlightPushDispatchForSubscription,
  hasInFlightPushDispatchForUser,
  isNonRetryablePushDispatchFailure,
  isPermanentPushSubscriptionFailure,
  leasePushDispatchJob,
  noticePushBodyMaxBytes,
  noticePushTitleMaxBytes,
  notificationOutboxLockKey,
  preparePushDispatchJobsForUserDeletion,
  recoverExpiredPushDispatchLeases,
  settlePushDispatchJob,
} = await import("../src/server/notification-outbox.ts");
const { noticeStateLockKey } = await import("../src/lib/notices.ts");
const { runPushDeliveryWithTimeout } = await import("../src/server/push-notifications.ts");
const {
  createApnsExpirationHeader,
  parseApnsPushFailure,
  parseFcmPushFailure,
  parseRetryAfterMs,
  sendApnsPush,
  sendFcmPush,
} = await import("../src/server/native-push-providers.ts");

const start = "2026-07-14T00:00:00.000Z";
const retryPolicy = { baseDelayMs: 1_000, maxDelayMs: 8_000 };

let providerAbortObserved = false;
const providerTimeoutResult = await runPushDeliveryWithTimeout(
  (signal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => {
      providerAbortObserved = true;
      resolve({
        outcome: "failed",
        errorCode: "PROVIDER_REQUEST_ABORTED",
        message: "provider request aborted",
      });
    }, { once: true });
  }),
  5,
);
assert.equal(providerTimeoutResult.errorCode, "PUSH_PROVIDER_TIMEOUT");
assert.equal(providerAbortObserved, true, "provider timeout must abort the underlying network request");

assert.equal(typeof createApnsExpirationHeader, "function");
assert.equal(
  createApnsExpirationHeader(new Date(start), {}),
  String(Math.floor(Date.parse(start) / 1_000) + 24 * 60 * 60),
  "APNs must retain an accepted alert for a bounded offline-delivery window by default",
);
assert.equal(
  createApnsExpirationHeader(new Date(start), { FINAL_JUDO_APNS_TTL_SECONDS: "0" }),
  "0",
  "operators must be able to opt into one-attempt APNs delivery explicitly",
);

assert.equal(notificationOutboxLockKey, noticeStateLockKey, "notice edits and outbox transitions must share one lock");

function addMs(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function createDb(suffix) {
  return {
    branches: [],
    users: [],
    members: [],
    classes: [],
    attendance: [],
    counselingNotes: [],
    promotions: [],
    tournaments: [],
    payments: [],
    notices: [],
    pushDispatchJobs: [],
    pushSubscriptions: [
      {
        id: `push-${suffix}`,
        userId: `user-${suffix}`,
        branchIds: ["branch-a"],
        endpoint: `https://push.example/${suffix}`,
        keys: { auth: "auth", p256dh: "p256dh" },
        createdAt: start,
        updatedAt: start,
      },
    ],
    pilotReadinessChecks: [],
    pilotIncidents: [],
    pilotOperationLogs: [],
    auditLogs: [
      {
        id: `audit-${suffix}`,
        branchId: "branch-a",
        actorUserId: "owner-a",
        action: "notification.dispatch",
        targetType: "notice",
        targetId: `notice-${suffix}`,
        before: null,
        after: { candidateCount: 1, dispatchState: "requested" },
        result: "blocked",
        message: "공지 알림 발송 요청을 저장했습니다.",
        createdAt: start,
      },
    ],
  };
}

function enqueue(db, suffix, options = {}) {
  return enqueuePushDispatchJob(db, {
    id: `push-job-${suffix}`,
    auditLogId: `audit-${suffix}`,
    noticeId: `notice-${suffix}`,
    branchId: "branch-a",
    subscriptionId: `push-${suffix}`,
    recipientUserId: `user-${suffix}`,
    payloadSnapshot:
      options.payloadSnapshot ??
      createNoticePushPayloadSnapshot({
        noticeId: `notice-${suffix}`,
        title: "휴관 안내",
        body: "이번 주 토요일은 휴관입니다.",
        important: true,
      }),
    maxAttempts: options.maxAttempts ?? 3,
    now: options.now ?? start,
  });
}

function lease(db, suffix, now, leaseToken = `lease-${suffix}`) {
  return leasePushDispatchJob(db, {
    jobId: `push-job-${suffix}`,
    leaseToken,
    leaseDurationMs: 5_000,
    now,
    retryPolicy,
  });
}

assert.equal(calculateNotificationOutboxBackoffMs(1, retryPolicy), 1_000);
assert.equal(calculateNotificationOutboxBackoffMs(4, retryPolicy), 8_000);
assert.equal(isPermanentPushSubscriptionFailure(404), true);
assert.equal(isPermanentPushSubscriptionFailure(410), true);
assert.equal(isPermanentPushSubscriptionFailure(503), false);
assert.equal(
  isPermanentPushSubscriptionFailure(400, "APNS_BAD_DEVICE_TOKEN"),
  true,
  "an APNs BadDeviceToken response must disable the stale device registration",
);
assert.equal(
  isPermanentPushSubscriptionFailure(404, "APNS_BAD_PATH"),
  false,
  "an APNs routing error must not disable an otherwise valid device registration",
);
assert.equal(
  isPermanentPushSubscriptionFailure(404, "FCM_UNREGISTERED"),
  true,
  "an FCM UNREGISTERED response must disable the stale device registration",
);
assert.equal(
  isPermanentPushSubscriptionFailure(403, "FCM_SENDER_ID_MISMATCH"),
  true,
  "an FCM token owned by another sender cannot recover under the current provider",
);
assert.equal(
  isPermanentPushSubscriptionFailure(400, "FCM_INVALID_ARGUMENT"),
  false,
  "a generic FCM payload error must not disable a device registration",
);
assert.equal(
  isPermanentPushSubscriptionFailure(400, "FCM_INVALID_REGISTRATION_TOKEN"),
  true,
  "an FCM-specific invalid registration token must disable the stale device registration",
);
assert.equal(
  isNonRetryablePushDispatchFailure(413, "APNS_PAYLOAD_TOO_LARGE"),
  true,
  "an APNs payload rejected by size cannot recover by retrying the same snapshot",
);
assert.equal(
  isNonRetryablePushDispatchFailure(429, "APNS_TOO_MANY_REQUESTS"),
  false,
  "APNs rate limiting must remain retryable",
);
assert.equal(
  isNonRetryablePushDispatchFailure(403, "APNS_FORBIDDEN"),
  true,
  "APNs Forbidden responses must not retry an unchanged request",
);

assert.deepEqual(
  parseApnsPushFailure(400, '{"reason":"BadDeviceToken"}'),
  {
    errorCode: "APNS_BAD_DEVICE_TOKEN",
    message: "iPhone 앱 알림 등록이 만료됐습니다.",
  },
);
assert.deepEqual(
  parseApnsPushFailure(400, '{"reason":"BadMessageId"}'),
  {
    errorCode: "APNS_BAD_MESSAGE_ID",
    message: "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
  },
);
assert.equal(
  parseRetryAfterMs("120", new Date(start)),
  120_000,
  "Retry-After delay-seconds must be converted to milliseconds",
);
assert.equal(
  parseRetryAfterMs(new Date(Date.parse(start) + 90_000).toUTCString(), new Date(start)),
  90_000,
  "Retry-After HTTP dates must be measured from the provider response time",
);
assert.equal(parseRetryAfterMs("invalid", new Date(start)), undefined);
assert.deepEqual(
  parseApnsPushFailure(503, '{"reason":"ServiceUnavailable"}'),
  {
    errorCode: "APNS_SERVICE_UNAVAILABLE",
    message: "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
    retryAfterMs: 15 * 60_000,
  },
  "APNs 5xx responses must not be retried before Apple's recovery window",
);

const apnsAuthenticationFailure = await sendApnsPush(
  "ios-device-token",
  {
    body: "인증 실패 테스트",
    tag: "final-judo-apns-auth-failure",
    title: "공지",
    url: "/app/notifications",
  },
  {
    connectImpl: () => {
      throw new Error("APNs network connection must not start before token signing succeeds.");
    },
    env: {
      FINAL_JUDO_APNS_ENVIRONMENT: "production",
      FINAL_JUDO_APNS_KEY_ID: "APNSKEY1",
      FINAL_JUDO_APNS_PRIVATE_KEY: "invalid-private-key",
      FINAL_JUDO_APNS_TEAM_ID: "TEAMID1",
      FINAL_JUDO_APNS_TOPIC: "kr.co.finaljudo.multigym",
    },
  },
);
assert.deepEqual(
  apnsAuthenticationFailure,
  {
    errorCode: "APNS_AUTHENTICATION_FAILED",
    message: "iPhone 앱 알림 인증 정보를 다시 확인해야 합니다.",
    outcome: "failed",
  },
  "an APNs signing failure must be classified before opening a provider connection",
);

const { privateKey: apnsTestPrivateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const apnsConnectionFailure = await sendApnsPush(
  "ios-device-token",
  {
    body: "연결 실패 테스트",
    tag: "final-judo-apns-connect-failure",
    title: "공지",
    url: "/app/notifications",
  },
  {
    connectImpl: () => {
      throw new Error("simulated synchronous APNs connection failure");
    },
    env: {
      FINAL_JUDO_APNS_ENVIRONMENT: "production",
      FINAL_JUDO_APNS_KEY_ID: "APNSKEY1",
      FINAL_JUDO_APNS_PRIVATE_KEY: apnsTestPrivateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      FINAL_JUDO_APNS_TEAM_ID: "TEAMID1",
      FINAL_JUDO_APNS_TOPIC: "kr.co.finaljudo.multigym",
    },
  },
);
assert.deepEqual(
  apnsConnectionFailure,
  {
    errorCode: "APNS_CONNECTION_FAILED",
    message: "iPhone 앱 알림 발송 서버에 연결하지 못했습니다.",
    outcome: "failed",
  },
  "a synchronous APNs connection failure must remain retryable without claiming uncertain delivery",
);
const apnsRequestFailureClient = new EventEmitter();
let apnsRequestFailureClientDestroyed = false;
Object.assign(apnsRequestFailureClient, {
  close() {},
  destroy() {
    apnsRequestFailureClientDestroyed = true;
  },
  request() {
    throw new Error("simulated APNs request stream failure");
  },
});
const apnsRequestFailure = await sendApnsPush(
  "ios-device-token",
  {
    body: "요청 생성 실패 테스트",
    tag: "final-judo-apns-request-failure",
    title: "공지",
    url: "/app/notifications",
  },
  {
    connectImpl: () => apnsRequestFailureClient,
    env: {
      FINAL_JUDO_APNS_ENVIRONMENT: "production",
      FINAL_JUDO_APNS_KEY_ID: "APNSKEY1",
      FINAL_JUDO_APNS_PRIVATE_KEY: apnsTestPrivateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      FINAL_JUDO_APNS_TEAM_ID: "TEAMID1",
      FINAL_JUDO_APNS_TOPIC: "kr.co.finaljudo.multigym",
    },
    timeoutMs: 5,
  },
);
assert.deepEqual(
  apnsRequestFailure,
  {
    errorCode: "APNS_REQUEST_FAILED",
    message: "iPhone 앱 알림 요청을 시작하지 못했습니다.",
    outcome: "failed",
  },
  "an APNs request stream creation failure must remain retryable without uncertain delivery",
);
assert.equal(apnsRequestFailureClientDestroyed, true, "APNs request creation failure must destroy the HTTP/2 session");
const apnsWriteFailureRequest = new EventEmitter();
let apnsWriteFailureRequestDestroyed = false;
Object.assign(apnsWriteFailureRequest, {
  destroy() {
    apnsWriteFailureRequestDestroyed = true;
  },
  end() {
    throw new Error("simulated APNs request write failure");
  },
  setEncoding() {},
});
const apnsWriteFailureClient = new EventEmitter();
let apnsWriteFailureClientDestroyed = false;
Object.assign(apnsWriteFailureClient, {
  close() {},
  destroy() {
    apnsWriteFailureClientDestroyed = true;
  },
  request() {
    return apnsWriteFailureRequest;
  },
});
const apnsWriteFailure = await sendApnsPush(
  "ios-device-token",
  {
    body: "요청 전송 실패 테스트",
    tag: "final-judo-apns-write-failure",
    title: "공지",
    url: "/app/notifications",
  },
  {
    connectImpl: () => apnsWriteFailureClient,
    env: {
      FINAL_JUDO_APNS_ENVIRONMENT: "production",
      FINAL_JUDO_APNS_KEY_ID: "APNSKEY1",
      FINAL_JUDO_APNS_PRIVATE_KEY: apnsTestPrivateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      FINAL_JUDO_APNS_TEAM_ID: "TEAMID1",
      FINAL_JUDO_APNS_TOPIC: "kr.co.finaljudo.multigym",
    },
    timeoutMs: 5,
  },
);
assert.deepEqual(
  apnsWriteFailure,
  {
    deliveryUncertain: true,
    errorCode: "APNS_DELIVERY_FAILED",
    message: "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
    outcome: "failed",
  },
  "an APNs request write failure must preserve uncertain-delivery state",
);
assert.equal(apnsWriteFailureRequestDestroyed, true);
assert.equal(apnsWriteFailureClientDestroyed, true);
const apnsTimeoutRequest = new EventEmitter();
let apnsTimeoutRequestDestroyed = false;
Object.assign(apnsTimeoutRequest, {
  destroy() {
    apnsTimeoutRequestDestroyed = true;
  },
  end() {},
  setEncoding() {},
});
const apnsTimeoutClient = new EventEmitter();
let apnsTimeoutClientClosed = false;
let apnsTimeoutClientDestroyed = false;
Object.assign(apnsTimeoutClient, {
  close() {
    apnsTimeoutClientClosed = true;
  },
  destroy() {
    apnsTimeoutClientDestroyed = true;
  },
  request() {
    return apnsTimeoutRequest;
  },
});
const apnsTimeoutFailure = await sendApnsPush(
  "ios-device-token",
  {
    body: "응답 지연 테스트",
    tag: "final-judo-apns-timeout",
    title: "공지",
    url: "/app/notifications",
  },
  {
    connectImpl: () => apnsTimeoutClient,
    env: {
      FINAL_JUDO_APNS_ENVIRONMENT: "production",
      FINAL_JUDO_APNS_KEY_ID: "APNSKEY1",
      FINAL_JUDO_APNS_PRIVATE_KEY: apnsTestPrivateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      FINAL_JUDO_APNS_TEAM_ID: "TEAMID1",
      FINAL_JUDO_APNS_TOPIC: "kr.co.finaljudo.multigym",
    },
    timeoutMs: 5,
  },
);
assert.equal(apnsTimeoutFailure.errorCode, "APNS_PROVIDER_TIMEOUT");
assert.equal(apnsTimeoutRequestDestroyed, true, "APNs timeout must destroy the hung request stream");
assert.equal(apnsTimeoutClientDestroyed, true, "APNs timeout must destroy the hung HTTP/2 session");
assert.equal(apnsTimeoutClientClosed, false, "APNs timeout must not wait for a graceful close on a hung stream");

const apnsAbortRequest = new EventEmitter();
let apnsAbortRequestDestroyed = false;
Object.assign(apnsAbortRequest, {
  destroy() {
    apnsAbortRequestDestroyed = true;
  },
  end() {},
  setEncoding() {},
});
const apnsAbortClient = new EventEmitter();
let apnsAbortClientDestroyed = false;
Object.assign(apnsAbortClient, {
  close() {},
  destroy() {
    apnsAbortClientDestroyed = true;
  },
  request() {
    return apnsAbortRequest;
  },
});
const apnsAbortController = new AbortController();
const apnsAbortPromise = sendApnsPush(
  "ios-device-token",
  {
    body: "외부 취소 테스트",
    tag: "final-judo-apns-abort",
    title: "공지",
    url: "/app/notifications",
  },
  {
    connectImpl: () => apnsAbortClient,
    env: {
      FINAL_JUDO_APNS_ENVIRONMENT: "production",
      FINAL_JUDO_APNS_KEY_ID: "APNSKEY1",
      FINAL_JUDO_APNS_PRIVATE_KEY: apnsTestPrivateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      FINAL_JUDO_APNS_TEAM_ID: "TEAMID1",
      FINAL_JUDO_APNS_TOPIC: "kr.co.finaljudo.multigym",
    },
    signal: apnsAbortController.signal,
    timeoutMs: 1_000,
  },
);
apnsAbortController.abort();
const apnsAbortFailure = await apnsAbortPromise;
assert.equal(apnsAbortFailure.errorCode, "APNS_PROVIDER_TIMEOUT");
assert.equal(apnsAbortRequestDestroyed, true, "worker cancellation must destroy the APNs request stream");
assert.equal(apnsAbortClientDestroyed, true, "worker cancellation must destroy the APNs HTTP/2 session");
assert.deepEqual(
  parseFcmPushFailure(404, {
    error: {
      details: [{
        "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
        errorCode: "UNREGISTERED",
      }],
      status: "NOT_FOUND",
    },
  }),
  {
    errorCode: "FCM_UNREGISTERED",
    message: "Android 앱 알림 등록이 만료됐습니다.",
  },
);
assert.deepEqual(
  parseFcmPushFailure(400, {
    error: {
      details: [{
        "@type": "type.googleapis.com/google.rpc.BadRequest",
        fieldViolations: [],
      }],
      status: "INVALID_ARGUMENT",
    },
  }),
  {
    errorCode: "FCM_INVALID_ARGUMENT",
    message: "Android 앱 알림 발송 상태를 다시 확인해야 합니다.",
  },
);
assert.deepEqual(
  parseFcmPushFailure(400, {
    error: {
      details: [{
        "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
        errorCode: "INVALID_ARGUMENT",
      }],
      status: "INVALID_ARGUMENT",
    },
  }),
  {
    errorCode: "FCM_INVALID_REGISTRATION_TOKEN",
    message: "Android 앱 알림 등록이 만료됐습니다.",
  },
  "an FCM-specific INVALID_ARGUMENT detail must be distinguished from a payload validation error",
);

const originalFirebaseEnv = {
  clientEmail: process.env.FINAL_JUDO_FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FINAL_JUDO_FIREBASE_PRIVATE_KEY,
  projectId: process.env.FINAL_JUDO_FIREBASE_PROJECT_ID,
};
const { privateKey: firebaseTestPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
process.env.FINAL_JUDO_FIREBASE_CLIENT_EMAIL = "push-test@final-judo-retry.example";
process.env.FINAL_JUDO_FIREBASE_PRIVATE_KEY = firebaseTestPrivateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();
process.env.FINAL_JUDO_FIREBASE_PROJECT_ID = "final-judo-token-refresh-test";
const fcmRequestSequence = [];
const fcmRefreshResult = await sendFcmPush(
  "android-device-token",
  {
    body: "토큰 갱신 테스트",
    tag: "final-judo-token-refresh",
    title: "공지",
    url: "/app/notifications",
  },
  async (url, init = {}) => {
    const target = String(url);
    const authorization = new Headers(init.headers).get("Authorization");
    fcmRequestSequence.push({ authorization, target });
    if (target === "https://oauth2.googleapis.com/token") {
      const refreshCount = fcmRequestSequence.filter((request) =>
        request.target === "https://oauth2.googleapis.com/token"
      ).length;
      return Response.json({
        access_token: refreshCount === 1 ? "stale-fcm-access-token" : "fresh-fcm-access-token",
        expires_in: 3_600,
      });
    }
    if (authorization === "Bearer stale-fcm-access-token") {
      return Response.json(
        { error: { status: "UNAUTHENTICATED" } },
        { status: 401 },
      );
    }
    assert.equal(authorization, "Bearer fresh-fcm-access-token");
    return Response.json({ name: "projects/test/messages/1" });
  },
);
for (const [name, value] of [
  ["FINAL_JUDO_FIREBASE_CLIENT_EMAIL", originalFirebaseEnv.clientEmail],
  ["FINAL_JUDO_FIREBASE_PRIVATE_KEY", originalFirebaseEnv.privateKey],
  ["FINAL_JUDO_FIREBASE_PROJECT_ID", originalFirebaseEnv.projectId],
]) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
assert.deepEqual(
  fcmRefreshResult,
  { outcome: "sent" },
  "FCM 401 must invalidate a cached OAuth token and retry once with a fresh token",
);
assert.deepEqual(
  fcmRequestSequence.map((request) => request.target),
  [
    "https://oauth2.googleapis.com/token",
    "https://fcm.googleapis.com/v1/projects/final-judo-token-refresh-test/messages:send",
    "https://oauth2.googleapis.com/token",
    "https://fcm.googleapis.com/v1/projects/final-judo-token-refresh-test/messages:send",
  ],
  "FCM authentication recovery must perform exactly one token refresh and one resend",
);

process.env.FINAL_JUDO_FIREBASE_CLIENT_EMAIL = "push-test@final-judo-rate-limit.example";
process.env.FINAL_JUDO_FIREBASE_PRIVATE_KEY = firebaseTestPrivateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();
process.env.FINAL_JUDO_FIREBASE_PROJECT_ID = "final-judo-rate-limit-test";
const fcmRateLimitResult = await sendFcmPush(
  "android-device-token",
  {
    body: "재시도 지시 테스트",
    tag: "final-judo-fcm-rate-limit",
    title: "공지",
    url: "/app/notifications",
  },
  async (url) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "rate-limit-token", expires_in: 3_600 });
    }
    return Response.json(
      { error: { status: "RESOURCE_EXHAUSTED" } },
      { headers: { "Retry-After": "120" }, status: 429 },
    );
  },
);
for (const [name, value] of [
  ["FINAL_JUDO_FIREBASE_CLIENT_EMAIL", originalFirebaseEnv.clientEmail],
  ["FINAL_JUDO_FIREBASE_PRIVATE_KEY", originalFirebaseEnv.privateKey],
  ["FINAL_JUDO_FIREBASE_PROJECT_ID", originalFirebaseEnv.projectId],
]) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
assert.deepEqual(
  fcmRateLimitResult,
  {
    errorCode: "FCM_RESOURCE_EXHAUSTED",
    message: "Android 앱 알림 발송 상태를 다시 확인해야 합니다.",
    outcome: "failed",
    retryAfterMs: 120_000,
    statusCode: 429,
  },
  "FCM rate limits must preserve the provider Retry-After delay",
);

process.env.FINAL_JUDO_FIREBASE_CLIENT_EMAIL = "push-test@final-judo-auth-failure.example";
process.env.FINAL_JUDO_FIREBASE_PRIVATE_KEY = firebaseTestPrivateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();
process.env.FINAL_JUDO_FIREBASE_PROJECT_ID = "final-judo-auth-failure-test";
const fcmAuthenticationFailure = await sendFcmPush(
  "android-device-token",
  {
    body: "인증 실패 테스트",
    tag: "final-judo-auth-failure",
    title: "공지",
    url: "/app/notifications",
  },
  async (url) => {
    assert.equal(String(url), "https://oauth2.googleapis.com/token");
    throw new Error("oauth unavailable");
  },
);
for (const [name, value] of [
  ["FINAL_JUDO_FIREBASE_CLIENT_EMAIL", originalFirebaseEnv.clientEmail],
  ["FINAL_JUDO_FIREBASE_PRIVATE_KEY", originalFirebaseEnv.privateKey],
  ["FINAL_JUDO_FIREBASE_PROJECT_ID", originalFirebaseEnv.projectId],
]) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
assert.deepEqual(
  fcmAuthenticationFailure,
  {
    errorCode: "FCM_AUTHENTICATION_FAILED",
    message: "Android 앱 알림 인증 정보를 다시 확인해야 합니다.",
    outcome: "failed",
  },
  "an OAuth failure before message submission must not claim uncertain device delivery",
);

process.env.FINAL_JUDO_FIREBASE_CLIENT_EMAIL = "push-test@final-judo-abort-signal.example";
process.env.FINAL_JUDO_FIREBASE_PRIVATE_KEY = firebaseTestPrivateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();
process.env.FINAL_JUDO_FIREBASE_PROJECT_ID = "final-judo-abort-signal-test";
const fcmAbortController = new AbortController();
const observedFcmSignals = [];
const fcmAbortSignalResult = await sendFcmPush(
  "android-device-token",
  {
    body: "취소 신호 테스트",
    tag: "final-judo-fcm-abort-signal",
    title: "공지",
    url: "/app/notifications",
  },
  async (url, init = {}) => {
    observedFcmSignals.push(init.signal);
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "abort-signal-token", expires_in: 3_600 });
    }
    return Response.json({ name: "projects/test/messages/abort-signal" });
  },
  fcmAbortController.signal,
);
for (const [name, value] of [
  ["FINAL_JUDO_FIREBASE_CLIENT_EMAIL", originalFirebaseEnv.clientEmail],
  ["FINAL_JUDO_FIREBASE_PRIVATE_KEY", originalFirebaseEnv.privateKey],
  ["FINAL_JUDO_FIREBASE_PROJECT_ID", originalFirebaseEnv.projectId],
]) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
assert.deepEqual(fcmAbortSignalResult, { outcome: "sent" });
assert.equal(observedFcmSignals.length, 2);
assert(
  observedFcmSignals.every((signal) => signal === fcmAbortController.signal),
  "FCM OAuth and message requests must receive the worker abort signal",
);

const boundedKoreanPayload = createNoticePushPayloadSnapshot({
  noticeId: "notice-byte-limit",
  title: "중요한 공지 ".repeat(100),
  body: "회원과 학부모에게 전달할 긴 공지입니다. ".repeat(500),
  important: true,
});
assert.ok(
  Buffer.byteLength(boundedKoreanPayload.title, "utf8") <= noticePushTitleMaxBytes,
  "push titles must remain within the byte budget",
);
assert.ok(
  Buffer.byteLength(boundedKoreanPayload.body, "utf8") <= noticePushBodyMaxBytes,
  "push bodies must remain within the byte budget",
);
assert.match(boundedKoreanPayload.title, /…$/, "truncated titles must make truncation visible");
assert.match(boundedKoreanPayload.body, /…$/, "truncated bodies must make truncation visible");

const successQueued = enqueue(createDb("success"), "success");
assert.equal(successQueued.ok, true);
assert.equal(successQueued.created, true);
assert.equal(successQueued.job.payloadSnapshot.tag, "final-judo-notice-notice-success");
assert.equal(successQueued.db.auditLogs[0].after.outboxJobCount, 1);
const successDuplicate = enqueue(successQueued.db, "success");
assert.equal(successDuplicate.ok, true);
assert.equal(successDuplicate.created, false, "the same job id and immutable payload must be idempotent");
assert.equal(successDuplicate.db.pushDispatchJobs.length, 1);
const successConflict = enqueue(successQueued.db, "success", {
  payloadSnapshot: createNoticePushPayloadSnapshot({
    noticeId: "notice-success",
    title: "변경된 제목",
    body: "이번 주 토요일은 휴관입니다.",
  }),
});
assert.equal(successConflict.ok, false);
assert.equal(successConflict.reason, "idempotency_conflict");
const userDeletionQueued = enqueue(createDb("user-delete"), "user-delete");
const preparedUserDeletion = preparePushDispatchJobsForUserDeletion(
  userDeletionQueued.db,
  "user-user-delete",
  { now: addMs(start, 25), reason: "사용자 계정 삭제" },
);
assert.equal(preparedUserDeletion.ok, true);
assert.equal(preparedUserDeletion.cancelledJobCount, 1);
assert.equal(
  preparedUserDeletion.db.pushDispatchJobs.find((job) => job.id === "push-job-user-delete")?.status,
  "cancelled",
  "account deletion must cancel queued device work before removing the subscription",
);
const successLeased = lease(successQueued.db, "success", start);
assert.equal(successLeased.job.status, "leased");
assert.equal(successLeased.job.attemptCount, 1);
assert.equal(
  lease(successLeased.db, "success", addMs(start, 10), "lease-competing-worker").job,
  null,
  "a persisted active lease must prevent a second worker from claiming the same job",
);
const successWithoutProvider = settlePushDispatchJob(successLeased.db, {
  jobId: "push-job-success",
  leaseToken: "lease-success",
  expectedRevision: successLeased.job.revision,
  now: addMs(start, 100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(successWithoutProvider.ok, false);
assert.equal(successWithoutProvider.reason, "provider_call_not_started");
const successProviderStarted = beginPushDispatchProviderCall(successLeased.db, {
  jobId: "push-job-success",
  leaseToken: "lease-success",
  expectedRevision: successLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(successProviderStarted.ok, true);
const successSettled = settlePushDispatchJob(successProviderStarted.db, {
  jobId: "push-job-success",
  leaseToken: "lease-success",
  expectedRevision: successProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(successSettled.ok, true);
assert.equal(successSettled.job.status, "sent");
assert.equal(successSettled.db.auditLogs[0].result, "success");
assert.equal(successSettled.db.auditLogs[0].after.dispatchState, "completed");

const mixedProviderDb = createDb("mixed-provider");
mixedProviderDb.auditLogs[0].after.candidateCount = 2;
mixedProviderDb.auditLogs[0].after.dispatchableCount = 1;
mixedProviderDb.auditLogs[0].after.unconfiguredCount = 1;
const mixedProviderQueued = enqueue(mixedProviderDb, "mixed-provider");
assert.equal(mixedProviderQueued.ok, true);
const mixedProviderLeased = lease(mixedProviderQueued.db, "mixed-provider", start);
const mixedProviderStarted = beginPushDispatchProviderCall(mixedProviderLeased.db, {
  jobId: "push-job-mixed-provider",
  leaseToken: "lease-mixed-provider",
  expectedRevision: mixedProviderLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(mixedProviderStarted.ok, true);
const mixedProviderSettled = settlePushDispatchJob(mixedProviderStarted.db, {
  jobId: "push-job-mixed-provider",
  leaseToken: "lease-mixed-provider",
  expectedRevision: mixedProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(mixedProviderSettled.ok, true);
assert.equal(
  mixedProviderSettled.db.auditLogs[0].after.dispatchState,
  "failed",
  "an unconfigured transport must finish without hiding the partial delivery failure",
);
assert.equal(mixedProviderSettled.db.auditLogs[0].result, "failed");
assert.equal(mixedProviderSettled.db.auditLogs[0].after.unconfiguredCount, 1);
assert.match(mixedProviderSettled.db.auditLogs[0].message, /제공자 설정 미완료 1건/);

const partialDb = createDb("partial");
partialDb.auditLogs[0].after.candidateCount = 2;
partialDb.pushSubscriptions.push({
  ...partialDb.pushSubscriptions[0],
  id: "push-partial-cancelled",
  userId: "user-partial-cancelled",
  endpoint: "https://push.example/partial-cancelled",
});
const partialSentQueued = enqueue(partialDb, "partial");
const partialCancelledQueued = enqueuePushDispatchJob(partialSentQueued.db, {
  id: "push-job-partial-cancelled",
  auditLogId: "audit-partial",
  noticeId: "notice-partial",
  branchId: "branch-a",
  subscriptionId: "push-partial-cancelled",
  recipientUserId: "user-partial-cancelled",
  payloadSnapshot: createNoticePushPayloadSnapshot({
    noticeId: "notice-partial",
    title: "휴관 안내",
    body: "이번 주 토요일은 휴관입니다.",
    important: true,
  }),
  maxAttempts: 3,
  now: start,
});
assert.equal(partialCancelledQueued.ok, true);
const partialSentLeased = lease(partialCancelledQueued.db, "partial", start, "lease-partial");
const partialSentProviderStarted = beginPushDispatchProviderCall(partialSentLeased.db, {
  jobId: "push-job-partial",
  leaseToken: "lease-partial",
  expectedRevision: partialSentLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(partialSentProviderStarted.ok, true);
const partialSentSettled = settlePushDispatchJob(partialSentProviderStarted.db, {
  jobId: "push-job-partial",
  leaseToken: "lease-partial",
  expectedRevision: partialSentProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(partialSentSettled.ok, true);
const partialCancelled = cancelPushDispatchJob(partialSentSettled.db, {
  jobId: "push-job-partial-cancelled",
  now: addMs(start, 150),
  reason: "공지 대상에서 제외됐습니다.",
});
assert.equal(partialCancelled.ok, true);
assert.equal(partialCancelled.db.auditLogs[0].result, "blocked");
assert.equal(partialCancelled.db.auditLogs[0].after.dispatchState, "blocked");
assert.equal(partialCancelled.db.auditLogs[0].after.sent, 1);
assert.equal(partialCancelled.db.auditLogs[0].after.cancelled, 1);
assert.match(partialCancelled.db.auditLogs[0].message, /1건 발송, 1건 취소/);

const retryQueued = enqueue(createDb("retry"), "retry");
const retryLeased = lease(retryQueued.db, "retry", start);
const retryProviderStartedFirst = beginPushDispatchProviderCall(retryLeased.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry",
  expectedRevision: retryLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(retryProviderStartedFirst.ok, true);
const retryScheduled = settlePushDispatchJob(retryProviderStartedFirst.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry",
  expectedRevision: retryProviderStartedFirst.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 503, errorCode: "PUSH_UNAVAILABLE" },
  retryPolicy,
});
assert.equal(retryScheduled.ok, true);
assert.equal(retryScheduled.job.status, "retry_scheduled");
assert.equal(retryScheduled.job.nextAttemptAt, addMs(start, 1_100));
assert.equal(lease(retryScheduled.db, "retry", addMs(start, 1_000), "lease-too-early").job, null);
const retryLeasedAgain = lease(retryScheduled.db, "retry", addMs(start, 1_100), "lease-retry-2");
assert.equal(retryLeasedAgain.job.attemptCount, 2);
assert.equal(retryLeasedAgain.job.providerCallCompletedAt, undefined);
assert.equal(retryLeasedAgain.job.providerOutcome, undefined);
const retryProviderStarted = beginPushDispatchProviderCall(retryLeasedAgain.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry-2",
  expectedRevision: retryLeasedAgain.job.revision,
  now: addMs(start, 1_150),
});
assert.equal(retryProviderStarted.ok, true);
assert.equal(
  hasInFlightPushDispatchForSubscription(retryProviderStarted.db, "push-retry", new Date(addMs(start, 1_160))),
  true,
  "a retried provider call must block subscription ownership changes while it is in flight",
);
const retryCompleted = settlePushDispatchJob(retryProviderStarted.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry-2",
  expectedRevision: retryProviderStarted.job.revision,
  now: addMs(start, 1_200),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(retryCompleted.ok, true);
assert.equal(retryCompleted.job.status, "sent");
assert.equal(retryCompleted.job.lastFailureReason, undefined, "a successful retry must not retain a stale failure reason");

const providerDelayQueued = enqueue(createDb("provider-delay"), "provider-delay");
const providerDelayLeased = lease(providerDelayQueued.db, "provider-delay", start);
const providerDelayStarted = beginPushDispatchProviderCall(providerDelayLeased.db, {
  jobId: "push-job-provider-delay",
  leaseToken: "lease-provider-delay",
  expectedRevision: providerDelayLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(providerDelayStarted.ok, true);
const providerDelayScheduled = settlePushDispatchJob(providerDelayStarted.db, {
  jobId: "push-job-provider-delay",
  leaseToken: "lease-provider-delay",
  expectedRevision: providerDelayStarted.job.revision,
  now: addMs(start, 100),
  result: {
    outcome: "failed",
    statusCode: 429,
    errorCode: "FCM_RESOURCE_EXHAUSTED",
    retryAfterMs: 60_000,
  },
  retryPolicy,
});
assert.equal(providerDelayScheduled.ok, true);
assert.equal(providerDelayScheduled.job.nextAttemptAt, addMs(start, 60_100));
assert.equal(
  lease(providerDelayScheduled.db, "provider-delay", addMs(start, 1_100), "lease-provider-delay-too-early").job,
  null,
  "local backoff expiry must not bypass a longer provider retry delay",
);

const uncertainRetryQueued = enqueue(createDb("uncertain-retry"), "uncertain-retry");
const uncertainRetryLeased = lease(uncertainRetryQueued.db, "uncertain-retry", start);
const uncertainRetryProviderStarted = beginPushDispatchProviderCall(uncertainRetryLeased.db, {
  jobId: "push-job-uncertain-retry",
  leaseToken: "lease-uncertain-retry",
  expectedRevision: uncertainRetryLeased.job.revision,
  now: addMs(start, 25),
});
const uncertainRetryScheduled = settlePushDispatchJob(uncertainRetryProviderStarted.db, {
  jobId: "push-job-uncertain-retry",
  leaseToken: "lease-uncertain-retry",
  expectedRevision: uncertainRetryProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", errorCode: "PUSH_PROVIDER_TIMEOUT", deliveryUncertain: true },
  retryPolicy,
});
assert.equal(uncertainRetryScheduled.ok, true);
assert.equal(uncertainRetryScheduled.job.providerFenceExpiresAt, addMs(start, 5_000));
assert.equal(
  uncertainRetryScheduled.job.nextAttemptAt,
  addMs(start, 5_000),
  "an uncertain provider call must not retry before its original lease fence expires",
);
assert.equal(
  hasInFlightPushDispatchForSubscription(uncertainRetryScheduled.db, "push-uncertain-retry", new Date(addMs(start, 200))),
  true,
  "a timed-out provider promise must keep subscription ownership fenced",
);
assert.equal(
  lease(uncertainRetryScheduled.db, "uncertain-retry", addMs(start, 1_100), "lease-uncertain-too-early").job,
  null,
  "an uncertain provider promise must not be retried at the normal backoff boundary",
);
const uncertainRetryCancelledBeforeFence = cancelPushDispatchJob(uncertainRetryScheduled.db, {
  jobId: "push-job-uncertain-retry",
  now: addMs(start, 250),
  reason: "보안 변경으로 남은 발송을 취소합니다.",
});
assert.equal(uncertainRetryCancelledBeforeFence.ok, true);
assert.equal(uncertainRetryCancelledBeforeFence.job.status, "cancelled");
assert.equal(uncertainRetryCancelledBeforeFence.job.providerOutcome, "uncertain");
assert.equal(uncertainRetryCancelledBeforeFence.job.deliveryMayHaveOccurred, true);
assert.equal(
  hasInFlightPushDispatchForSubscription(
    uncertainRetryCancelledBeforeFence.db,
    "push-uncertain-retry",
    new Date(addMs(start, 300)),
  ),
  true,
  "cancelling a timed-out call must not release its subscription ownership fence early",
);
assert.equal(
  hasInFlightPushDispatchForSubscription(
    uncertainRetryCancelledBeforeFence.db,
    "push-uncertain-retry",
    new Date(addMs(start, 5_000)),
  ),
  false,
  "the bounded provider fence may release at the original lease expiry",
);
const uncertainRetryLeasedAgain = lease(
  uncertainRetryScheduled.db,
  "uncertain-retry",
  uncertainRetryScheduled.job.nextAttemptAt,
  "lease-uncertain-retry-2",
);
assert.equal(uncertainRetryLeasedAgain.job.deliveryMayHaveOccurred, true);
assert.equal(uncertainRetryLeasedAgain.job.providerFenceExpiresAt, undefined);
const uncertainRetryCancelled = settlePushDispatchJob(uncertainRetryLeasedAgain.db, {
  jobId: "push-job-uncertain-retry",
  leaseToken: "lease-uncertain-retry-2",
  expectedRevision: uncertainRetryLeasedAgain.job.revision,
  now: addMs(uncertainRetryScheduled.job.nextAttemptAt, 10),
  result: { outcome: "cancelled", reason: "재시도 전에 공지 대상이 변경됐습니다." },
});
assert.equal(uncertainRetryCancelled.ok, true);
assert.equal(uncertainRetryCancelled.job.status, "cancelled");
assert.equal(
  uncertainRetryCancelled.job.deliveryMayHaveOccurred,
  true,
  "cancelling a later attempt must preserve uncertainty from an earlier provider call",
);

const deadQueued = enqueue(createDb("dead"), "dead", { maxAttempts: 2 });
const deadLeased1 = lease(deadQueued.db, "dead", start, "lease-dead-1");
const deadProviderStarted1 = beginPushDispatchProviderCall(deadLeased1.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-1",
  expectedRevision: deadLeased1.job.revision,
  now: addMs(start, 50),
});
assert.equal(deadProviderStarted1.ok, true);
const deadRetry = settlePushDispatchJob(deadProviderStarted1.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-1",
  expectedRevision: deadProviderStarted1.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 500 },
  retryPolicy,
});
const deadLeased2 = lease(deadRetry.db, "dead", deadRetry.job.nextAttemptAt, "lease-dead-2");
const deadProviderStarted2 = beginPushDispatchProviderCall(deadLeased2.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-2",
  expectedRevision: deadLeased2.job.revision,
  now: addMs(deadRetry.job.nextAttemptAt, 50),
});
assert.equal(deadProviderStarted2.ok, true);
const deadSettled = settlePushDispatchJob(deadProviderStarted2.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-2",
  expectedRevision: deadProviderStarted2.job.revision,
  now: addMs(deadRetry.job.nextAttemptAt, 100),
  result: { outcome: "failed", statusCode: 500 },
  retryPolicy,
});
assert.equal(deadSettled.ok, true);
assert.equal(deadSettled.job.status, "dead");
assert.equal(deadSettled.db.auditLogs[0].result, "failed");

const disabledQueued = enqueue(createDb("disabled"), "disabled");
const disabledLeased = lease(disabledQueued.db, "disabled", start);
const disabledProviderStarted = beginPushDispatchProviderCall(disabledLeased.db, {
  jobId: "push-job-disabled",
  leaseToken: "lease-disabled",
  expectedRevision: disabledLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(disabledProviderStarted.ok, true);
const disabledSettled = settlePushDispatchJob(disabledProviderStarted.db, {
  jobId: "push-job-disabled",
  leaseToken: "lease-disabled",
  expectedRevision: disabledProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 410 },
  retryPolicy,
});
assert.equal(disabledSettled.ok, true);
assert.equal(disabledSettled.job.status, "disabled");
assert.equal(disabledSettled.db.pushSubscriptions[0].disabledAt, addMs(start, 100));
assert.equal(disabledSettled.db.pushSubscriptions[0].disabledReason, "provider_invalid");

const apnsBadPathQueued = enqueue(createDb("apns-bad-path"), "apns-bad-path");
const apnsBadPathLeased = lease(apnsBadPathQueued.db, "apns-bad-path", start);
const apnsBadPathProviderStarted = beginPushDispatchProviderCall(apnsBadPathLeased.db, {
  jobId: "push-job-apns-bad-path",
  leaseToken: "lease-apns-bad-path",
  expectedRevision: apnsBadPathLeased.job.revision,
  now: addMs(start, 50),
});
const apnsBadPathSettled = settlePushDispatchJob(apnsBadPathProviderStarted.db, {
  jobId: "push-job-apns-bad-path",
  leaseToken: "lease-apns-bad-path",
  expectedRevision: apnsBadPathProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 404, errorCode: "APNS_BAD_PATH" },
  retryPolicy,
});
assert.equal(apnsBadPathSettled.ok, true);
assert.equal(apnsBadPathSettled.job.status, "retry_scheduled");
assert.equal(apnsBadPathSettled.db.pushSubscriptions[0].disabledAt, undefined);

const apnsBadTokenQueued = enqueue(createDb("apns-bad-token"), "apns-bad-token");
const apnsBadTokenLeased = lease(apnsBadTokenQueued.db, "apns-bad-token", start);
const apnsBadTokenProviderStarted = beginPushDispatchProviderCall(apnsBadTokenLeased.db, {
  jobId: "push-job-apns-bad-token",
  leaseToken: "lease-apns-bad-token",
  expectedRevision: apnsBadTokenLeased.job.revision,
  now: addMs(start, 50),
});
const apnsBadTokenSettled = settlePushDispatchJob(apnsBadTokenProviderStarted.db, {
  jobId: "push-job-apns-bad-token",
  leaseToken: "lease-apns-bad-token",
  expectedRevision: apnsBadTokenProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 400, errorCode: "APNS_BAD_DEVICE_TOKEN" },
  retryPolicy,
});
assert.equal(apnsBadTokenSettled.ok, true);
assert.equal(apnsBadTokenSettled.job.status, "disabled");
assert.equal(apnsBadTokenSettled.db.pushSubscriptions[0].disabledAt, addMs(start, 100));
assert.equal(apnsBadTokenSettled.db.pushSubscriptions[0].disabledReason, "provider_invalid");

const apnsForbiddenQueued = enqueue(createDb("apns-forbidden"), "apns-forbidden");
const apnsForbiddenLeased = lease(apnsForbiddenQueued.db, "apns-forbidden", start);
const apnsForbiddenProviderStarted = beginPushDispatchProviderCall(apnsForbiddenLeased.db, {
  jobId: "push-job-apns-forbidden",
  leaseToken: "lease-apns-forbidden",
  expectedRevision: apnsForbiddenLeased.job.revision,
  now: addMs(start, 50),
});
const apnsForbiddenSettled = settlePushDispatchJob(apnsForbiddenProviderStarted.db, {
  jobId: "push-job-apns-forbidden",
  leaseToken: "lease-apns-forbidden",
  expectedRevision: apnsForbiddenProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 403, errorCode: "APNS_FORBIDDEN" },
  retryPolicy,
});
assert.equal(apnsForbiddenSettled.ok, true);
assert.equal(apnsForbiddenSettled.job.status, "dead");
assert.equal(apnsForbiddenSettled.job.attemptCount, 1);
assert.equal(
  apnsForbiddenSettled.db.pushSubscriptions[0].disabledAt,
  undefined,
  "an APNs provider authorization rejection must preserve the device subscription",
);

const apnsPayloadTooLargeQueued = enqueue(createDb("apns-payload-too-large"), "apns-payload-too-large");
const apnsPayloadTooLargeLeased = lease(apnsPayloadTooLargeQueued.db, "apns-payload-too-large", start);
const apnsPayloadTooLargeProviderStarted = beginPushDispatchProviderCall(apnsPayloadTooLargeLeased.db, {
  jobId: "push-job-apns-payload-too-large",
  leaseToken: "lease-apns-payload-too-large",
  expectedRevision: apnsPayloadTooLargeLeased.job.revision,
  now: addMs(start, 50),
});
const apnsPayloadTooLargeSettled = settlePushDispatchJob(apnsPayloadTooLargeProviderStarted.db, {
  jobId: "push-job-apns-payload-too-large",
  leaseToken: "lease-apns-payload-too-large",
  expectedRevision: apnsPayloadTooLargeProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 413, errorCode: "APNS_PAYLOAD_TOO_LARGE" },
  retryPolicy,
});
assert.equal(apnsPayloadTooLargeSettled.ok, true);
assert.equal(
  apnsPayloadTooLargeSettled.job.status,
  "dead",
  "a deterministic payload rejection must stop after the first provider attempt",
);
assert.equal(apnsPayloadTooLargeSettled.job.attemptCount, 1);
assert.equal(apnsPayloadTooLargeSettled.job.completedAt, addMs(start, 100));
assert.equal(
  apnsPayloadTooLargeSettled.db.pushSubscriptions[0].disabledAt,
  undefined,
  "a message-specific rejection must preserve the device registration",
);

const expiredPrimaryQueued = enqueue(createDb("expired-primary"), "expired-primary");
const expiredPendingQueued = enqueue(createDb("expired-pending"), "expired-pending");
const expiredInFlightQueued = enqueue(createDb("expired-in-flight"), "expired-in-flight");
const expiredOtherQueued = enqueue(createDb("expired-other"), "expired-other");
const expiredDb = {
  ...expiredPrimaryQueued.db,
  pushSubscriptions: [
    ...expiredPrimaryQueued.db.pushSubscriptions,
    ...expiredPendingQueued.db.pushSubscriptions,
    ...expiredInFlightQueued.db.pushSubscriptions,
    ...expiredOtherQueued.db.pushSubscriptions,
  ],
  pushDispatchJobs: [
    ...expiredPrimaryQueued.db.pushDispatchJobs,
    ...expiredPendingQueued.db.pushDispatchJobs,
    ...expiredInFlightQueued.db.pushDispatchJobs,
    ...expiredOtherQueued.db.pushDispatchJobs,
  ].map((job) =>
    job.id === "push-job-expired-pending" || job.id === "push-job-expired-in-flight"
      ? {
          ...job,
          subscriptionId: "push-expired-primary",
          recipientUserId: "user-expired-primary",
        }
      : job,
  ),
  auditLogs: [
    ...expiredPrimaryQueued.db.auditLogs,
    ...expiredPendingQueued.db.auditLogs,
    ...expiredInFlightQueued.db.auditLogs,
    ...expiredOtherQueued.db.auditLogs,
  ],
};
const expiredInFlightLeased = lease(expiredDb, "expired-in-flight", start);
const expiredProviderStarted = beginPushDispatchProviderCall(expiredInFlightLeased.db, {
  jobId: "push-job-expired-in-flight",
  leaseToken: "lease-expired-in-flight",
  expectedRevision: expiredInFlightLeased.job.revision,
  now: addMs(start, 20),
});
assert.equal(expiredProviderStarted.ok, true);
const expiredPrimaryLeased = lease(expiredProviderStarted.db, "expired-primary", addMs(start, 25));
const expiredPrimaryProviderStarted = beginPushDispatchProviderCall(expiredPrimaryLeased.db, {
  jobId: "push-job-expired-primary",
  leaseToken: "lease-expired-primary",
  expectedRevision: expiredPrimaryLeased.job.revision,
  now: addMs(start, 30),
});
assert.equal(expiredPrimaryProviderStarted.ok, true);
const expiredPrimarySettled = settlePushDispatchJob(expiredPrimaryProviderStarted.db, {
  jobId: "push-job-expired-primary",
  leaseToken: "lease-expired-primary",
  expectedRevision: expiredPrimaryProviderStarted.job.revision,
  now: addMs(start, 40),
  result: { outcome: "failed", statusCode: 410 },
  retryPolicy,
});
assert.equal(expiredPrimarySettled.ok, true);
assert.equal(expiredPrimarySettled.job.status, "disabled");
assert.equal(
  expiredPrimarySettled.db.pushDispatchJobs.find((job) => job.id === "push-job-expired-pending")?.status,
  "cancelled",
  "a permanent subscription failure must drain queued work for the same device",
);
const expiredInFlightJob = expiredPrimarySettled.db.pushDispatchJobs.find(
  (job) => job.id === "push-job-expired-in-flight",
);
assert.equal(expiredInFlightJob?.status, "leased");
assert.equal(expiredInFlightJob?.cancellationRequestedAt, addMs(start, 40));
assert.equal(expiredInFlightJob?.deliveryMayHaveOccurred, true);
assert.equal(
  expiredPrimarySettled.db.pushDispatchJobs.find((job) => job.id === "push-job-expired-other")?.status,
  "pending",
  "a permanent failure must not mutate another device's work",
);
const expiredInFlightSettled = settlePushDispatchJob(expiredPrimarySettled.db, {
  jobId: "push-job-expired-in-flight",
  leaseToken: "lease-expired-in-flight",
  expectedRevision: expiredProviderStarted.job.revision,
  now: addMs(start, 60),
  result: { outcome: "failed", statusCode: 410 },
});
assert.equal(expiredInFlightSettled.ok, true);
assert.equal(expiredInFlightSettled.job.status, "cancelled");
assert.equal(expiredInFlightSettled.job.deliveryMayHaveOccurred, true);

const cancelledQueued = enqueue(createDb("cancelled"), "cancelled");
const cancelled = cancelPushDispatchJob(cancelledQueued.db, {
  jobId: "push-job-cancelled",
  now: addMs(start, 100),
  reason: "공지가 삭제됐습니다.",
});
assert.equal(cancelled.ok, true);
assert.equal(cancelled.job.status, "cancelled");

const crashQueued = enqueue(createDb("crash"), "crash");
const crashLeased = lease(crashQueued.db, "crash", start, "lease-before-crash");
const firstPayload = structuredClone(crashLeased.job.payloadSnapshot);
// Simulate Web Push success followed by a process crash before the sent status is persisted.
const recoveredCrashDb = recoverExpiredPushDispatchLeases(crashLeased.db, addMs(start, 5_000), retryPolicy);
const recoveredCrash = recoveredCrashDb.pushDispatchJobs[0];
assert.equal(recoveredCrash.status, "retry_scheduled");
assert.equal(recoveredCrash.nextAttemptAt, addMs(start, 6_000));
const staleSettlement = settlePushDispatchJob(recoveredCrashDb, {
  jobId: "push-job-crash",
  leaseToken: "lease-before-crash",
  expectedRevision: crashLeased.job.revision,
  now: addMs(start, 5_100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(staleSettlement.ok, false);
assert.equal(staleSettlement.reason, "job_not_leased");
const crashReLeased = lease(recoveredCrashDb, "crash", addMs(start, 6_000), "lease-after-crash");
assert.equal(crashReLeased.job.attemptCount, 2);
assert.deepEqual(crashReLeased.job.payloadSnapshot, firstPayload, "at-least-once retry must reuse the immutable payload snapshot");
assert.equal(
  crashReLeased.job.payloadSnapshot.tag,
  "final-judo-notice-notice-crash",
  "at-least-once retries must keep a stable notification tag so the client can replace the visible notification",
);

const beforeProviderQueued = enqueue(createDb("cancel-before-provider"), "cancel-before-provider");
const beforeProviderLeased = lease(beforeProviderQueued.db, "cancel-before-provider", start);
const beforeProviderCancellation = cancelPushDispatchJob(beforeProviderLeased.db, {
  jobId: "push-job-cancel-before-provider",
  now: addMs(start, 25),
  reason: "공지가 수정됐습니다.",
});
assert.equal(beforeProviderCancellation.ok, true);
assert.equal(beforeProviderCancellation.job.status, "leased");
assert.equal(beforeProviderCancellation.job.cancellationRequestedAt, addMs(start, 25));
const beforeProviderBegin = beginPushDispatchProviderCall(beforeProviderCancellation.db, {
  jobId: "push-job-cancel-before-provider",
  leaseToken: "lease-cancel-before-provider",
  expectedRevision: beforeProviderLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(beforeProviderBegin.ok, true);
assert.equal(beforeProviderBegin.shouldSend, false, "a cancellation observed before provider start must prevent delivery");
assert.equal(beforeProviderBegin.job.status, "cancelled");
assert.equal(beforeProviderBegin.job.providerOutcome, "not_started");
assert.equal(beforeProviderBegin.job.deliveryMayHaveOccurred, false);
assert.equal(beforeProviderBegin.job.providerCallCompletedAt, undefined);

const preProviderSettlementQueued = enqueue(createDb("settle-cancel-before-provider"), "settle-cancel-before-provider");
const preProviderSettlementLeased = lease(preProviderSettlementQueued.db, "settle-cancel-before-provider", start);
const preProviderSettlementCancellation = cancelPushDispatchJob(preProviderSettlementLeased.db, {
  jobId: "push-job-settle-cancel-before-provider",
  now: addMs(start, 25),
  reason: "공지 발송 대상이 변경됐습니다.",
});
const preProviderSettlement = settlePushDispatchJob(preProviderSettlementCancellation.db, {
  jobId: "push-job-settle-cancel-before-provider",
  leaseToken: "lease-settle-cancel-before-provider",
  expectedRevision: preProviderSettlementLeased.job.revision,
  now: addMs(start, 50),
  result: { outcome: "cancelled", reason: "provider 호출 전에 발송이 취소됐습니다." },
});
assert.equal(preProviderSettlement.ok, true);
assert.equal(preProviderSettlement.job.providerOutcome, "not_started");
assert.equal(preProviderSettlement.job.providerCallCompletedAt, undefined);
assert.equal(preProviderSettlement.job.deliveryMayHaveOccurred, false);

const afterProviderQueued = enqueue(createDb("cancel-after-provider"), "cancel-after-provider");
const afterProviderLeased = lease(afterProviderQueued.db, "cancel-after-provider", start);
const afterProviderBegin = beginPushDispatchProviderCall(afterProviderLeased.db, {
  jobId: "push-job-cancel-after-provider",
  leaseToken: "lease-cancel-after-provider",
  expectedRevision: afterProviderLeased.job.revision,
  now: addMs(start, 25),
});
assert.equal(afterProviderBegin.ok, true);
assert.equal(afterProviderBegin.shouldSend, true);
assert.equal(
  hasInFlightPushDispatchForSubscription(afterProviderBegin.db, "push-cancel-after-provider", new Date(addMs(start, 30))),
  true,
  "subscription ownership must not transfer while a provider call can still deliver the old user's payload",
);
assert.equal(
  hasInFlightPushDispatchForUser(afterProviderBegin.db, "user-cancel-after-provider", new Date(addMs(start, 30))),
  true,
  "authorization changes must detect provider calls through the user's subscriptions",
);
const blockedUserDeletion = preparePushDispatchJobsForUserDeletion(
  afterProviderBegin.db,
  "user-cancel-after-provider",
  { now: addMs(start, 30), reason: "사용자 계정 삭제" },
);
assert.equal(blockedUserDeletion.ok, false, "account deletion must wait while a provider call can still deliver");
assert.equal(blockedUserDeletion.reason, "push_delivery_in_flight");
assert.equal(
  hasInFlightPushDispatchForSubscription(afterProviderBegin.db, "push-cancel-after-provider", new Date(addMs(start, 5_001))),
  false,
  "an expired provider-call lease must not block subscription ownership forever",
);
const staleRevisionSettlement = settlePushDispatchJob(afterProviderBegin.db, {
  jobId: "push-job-cancel-after-provider",
  leaseToken: "lease-cancel-after-provider",
  expectedRevision: afterProviderLeased.job.revision,
  now: addMs(start, 30),
  result: { outcome: "sent" },
});
assert.equal(staleRevisionSettlement.ok, false);
assert.equal(staleRevisionSettlement.reason, "stale_revision");
const afterProviderCancellation = cancelPushDispatchJob(afterProviderBegin.db, {
  jobId: "push-job-cancel-after-provider",
  now: addMs(start, 40),
  reason: "공지가 삭제됐습니다.",
});
assert.equal(afterProviderCancellation.ok, true);
assert.equal(afterProviderCancellation.job.deliveryMayHaveOccurred, true);
const afterProviderSettlement = settlePushDispatchJob(afterProviderCancellation.db, {
  jobId: "push-job-cancel-after-provider",
  leaseToken: "lease-cancel-after-provider",
  expectedRevision: afterProviderBegin.job.revision,
  now: addMs(start, 60),
  result: { outcome: "sent" },
});
assert.equal(afterProviderSettlement.ok, true);
assert.equal(afterProviderSettlement.job.status, "cancelled");
assert.equal(afterProviderSettlement.job.providerOutcome, "accepted");
assert.equal(afterProviderSettlement.job.deliveryMayHaveOccurred, true);
assert.match(afterProviderSettlement.job.lastFailureReason, /수신 가능성/);

const cancelledOutcomeQueued = enqueue(createDb("cancelled-outcome-after-provider"), "cancelled-outcome-after-provider");
const cancelledOutcomeLeased = lease(cancelledOutcomeQueued.db, "cancelled-outcome-after-provider", start);
const cancelledOutcomeBegin = beginPushDispatchProviderCall(cancelledOutcomeLeased.db, {
  jobId: "push-job-cancelled-outcome-after-provider",
  leaseToken: "lease-cancelled-outcome-after-provider",
  expectedRevision: cancelledOutcomeLeased.job.revision,
  now: addMs(start, 25),
});
assert.equal(cancelledOutcomeBegin.ok, true);
const cancelledOutcomeCancellation = cancelPushDispatchJob(cancelledOutcomeBegin.db, {
  jobId: "push-job-cancelled-outcome-after-provider",
  now: addMs(start, 40),
  reason: "공지 발송이 취소됐습니다.",
});
assert.equal(cancelledOutcomeCancellation.ok, true);
const cancelledOutcomeSettlement = settlePushDispatchJob(cancelledOutcomeCancellation.db, {
  jobId: "push-job-cancelled-outcome-after-provider",
  leaseToken: "lease-cancelled-outcome-after-provider",
  expectedRevision: cancelledOutcomeBegin.job.revision,
  now: addMs(start, 60),
  result: { outcome: "cancelled", reason: "provider 결과를 확인할 수 없습니다." },
});
assert.equal(cancelledOutcomeSettlement.ok, true);
assert.equal(cancelledOutcomeSettlement.job.providerOutcome, "uncertain");
assert.equal(cancelledOutcomeSettlement.job.deliveryMayHaveOccurred, true);
assert.equal(cancelledOutcomeSettlement.job.providerCallCompletedAt, addMs(start, 60));
assert.equal(
  cancelledOutcomeSettlement.job.providerFenceExpiresAt,
  cancelledOutcomeBegin.job.providerFenceExpiresAt,
  "a cancelled result after provider start must retain the bounded provider fence",
);
assert.equal(
  hasInFlightPushDispatchForSubscription(cancelledOutcomeSettlement.db, "push-cancelled-outcome-after-provider", new Date(addMs(start, 70))),
  true,
);

const bulkPendingQueued = enqueue(createDb("bulk-pending"), "bulk-pending");
const bulkInFlightQueued = enqueue(createDb("bulk-in-flight"), "bulk-in-flight");
const bulkOtherQueued = enqueue(createDb("bulk-other"), "bulk-other");
const bulkDb = {
  ...bulkPendingQueued.db,
  pushSubscriptions: [
    ...bulkPendingQueued.db.pushSubscriptions,
    ...bulkInFlightQueued.db.pushSubscriptions,
    ...bulkOtherQueued.db.pushSubscriptions,
  ],
  pushDispatchJobs: [
    ...bulkPendingQueued.db.pushDispatchJobs,
    ...bulkInFlightQueued.db.pushDispatchJobs,
    ...bulkOtherQueued.db.pushDispatchJobs,
  ],
  auditLogs: [
    ...bulkPendingQueued.db.auditLogs,
    ...bulkInFlightQueued.db.auditLogs,
    ...bulkOtherQueued.db.auditLogs,
  ],
};
const bulkInFlightLeased = lease(bulkDb, "bulk-in-flight", start);
const bulkProviderStarted = beginPushDispatchProviderCall(bulkInFlightLeased.db, {
  jobId: "push-job-bulk-in-flight",
  leaseToken: "lease-bulk-in-flight",
  expectedRevision: bulkInFlightLeased.job.revision,
  now: addMs(start, 25),
});
assert.equal(bulkProviderStarted.ok, true);
const bulkCancelledDb = cancelPushDispatchJobsForSubscriptions(
  bulkProviderStarted.db,
  new Set(["push-bulk-pending", "push-bulk-in-flight"]),
  {
    now: addMs(start, 40),
    reason: "푸시 알림 구독이 해지되어 대기 발송을 취소했습니다.",
  },
);
const bulkPendingJob = bulkCancelledDb.pushDispatchJobs.find((job) => job.id === "push-job-bulk-pending");
const bulkInFlightJob = bulkCancelledDb.pushDispatchJobs.find((job) => job.id === "push-job-bulk-in-flight");
const bulkOtherJob = bulkCancelledDb.pushDispatchJobs.find((job) => job.id === "push-job-bulk-other");
assert.equal(bulkPendingJob?.status, "cancelled", "unsubscribe must cancel queued work immediately");
assert.equal(bulkInFlightJob?.status, "leased", "provider-started work must retain its lease until settlement");
assert.equal(bulkInFlightJob?.cancellationRequestedAt, addMs(start, 40));
assert.equal(bulkInFlightJob?.deliveryMayHaveOccurred, true);
assert.equal(bulkOtherJob?.status, "pending", "unsubscribe must not mutate a different subscription's work");

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        "job-id idempotency and immutable payload conflict",
        "notice and outbox state transitions share one lock",
        "request/completion audit linkage",
        "successful send",
        "provider timeout aborts the underlying request",
        "APNs signing failure is classified before provider connection",
        "APNs synchronous connection failure is classified without uncertain delivery",
        "APNs request stream creation failure is classified and destroys the session",
        "APNs request write failure preserves uncertain delivery and destroys the session",
        "APNs timeout destroys the hung stream and HTTP/2 session",
        "worker cancellation destroys the APNs stream and HTTP/2 session",
        "FCM rejected OAuth token refresh and single resend",
        "FCM pre-delivery authentication failure remains delivery-certain",
        "FCM OAuth and message requests receive the worker abort signal",
        "provider outcomes require an explicit provider-start fence",
        "partial cancellation remains visible in the request audit",
        "transient failure exponential retry",
        "retry attempts reset provider fences and retain ownership protection",
        "later cancellation preserves uncertainty from an earlier delivery attempt",
        "maximum-attempt dead letter",
        "non-retryable payload rejection preserves the device subscription",
        "404/410 subscription disable",
        "permanent subscription failure drains same-device work and preserves in-flight uncertainty",
        "pending cancellation",
        "expired lease recovery",
        "revision fencing and stale settlement rejection",
        "leased cancellation before and after provider start preserves truthful provider state",
        "subscription-scoped cancellation preserves other subscriptions and in-flight uncertainty",
        "in-flight provider call blocks push subscription ownership transfer",
        "account deletion cancels queued pushes and waits for in-flight provider calls",
        "at-least-once retry with stable notification tag",
      ],
    },
    null,
    2,
  ),
);
