import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockData } from "../src/lib/mock-data.ts";
import {
  createRandomPasswordHash,
  verifyAuthenticationPassword,
  verifyPassword,
} from "../src/server/auth-password.ts";
import {
  authSecurityLockKey,
  createAuthSession,
  findAuthSession,
  findAuthSessionUser,
  getAccountLoginThrottle,
  getPublicSignupThrottle,
  hasReachedPasswordResetRequestLimit,
  readUnmodifiedPassword,
  revokeAuthSession,
  revokeUserAuthSessions,
  shouldRecordBlockedLoginAudit,
} from "../src/server/auth-session.ts";
import {
  createExpiredPushDeviceSubscriptionCookieOptions,
  createPushDeviceSubscriptionCookieOptions,
  detachPushDeviceSubscriptionOnAccountSwitch,
  detachPushDeviceSubscriptionOnLogout,
  getPushDeviceSubscriptionId,
  issuePushDeviceSession,
} from "../src/server/push-device-session.ts";
import {
  hasMatchingWebPushCredential,
  normalizeNativePushRegistration,
  normalizePushSubscription,
  upsertNativePushRegistration,
} from "../src/server/push-notifications.ts";
import { userAdministrationLockKey } from "../src/server/user-administration.ts";

const now = new Date("2026-07-14T00:00:00.000Z");
const db = createMockData();
const user = db.users[0];
assert(user);

assert.equal(findAuthSessionUser(db, user.id, now), null, "raw user ids must never authenticate as session tokens");

const issued = createAuthSession(db, user.id, 3600, now);
assert.notEqual(issued.token, user.id);
assert.equal(issued.db.authSessions.some((session) => session.tokenHash === issued.token), false);
assert.equal(findAuthSessionUser(issued.db, issued.token, now)?.id, user.id);
assert.equal(findAuthSession(issued.db, issued.token, new Date("2026-07-14T01:00:01.000Z")), null);

const revoked = revokeAuthSession(issued.db, issued.token, new Date("2026-07-14T00:10:00.000Z"));
assert.equal(findAuthSessionUser(revoked, issued.token, new Date("2026-07-14T00:10:01.000Z")), null);
assert.equal(
  revokeAuthSession(issued.db, "unknown-session-token", new Date("2026-07-14T00:10:00.000Z")),
  issued.db,
  "unknown session tokens must not create a write candidate",
);

const first = createAuthSession(db, user.id, 3600, now);
const second = createAuthSession(first.db, user.id, 3600, now);
const allRevoked = revokeUserAuthSessions(second.db, user.id, new Date("2026-07-14T00:20:00.000Z"));
assert.equal(findAuthSessionUser(allRevoked, first.token, new Date("2026-07-14T00:20:01.000Z")), null);
assert.equal(findAuthSessionUser(allRevoked, second.token, new Date("2026-07-14T00:20:01.000Z")), null);

const logoutUser = db.users.find((candidate) => candidate.role === "member") ?? user;
const otherUser = db.users.find((candidate) => candidate.id !== logoutUser.id);
assert(otherUser);
const logoutAt = new Date("2026-07-14T00:25:00.000Z");
const basePushSubscription = {
  userId: logoutUser.id,
  branchIds: [...logoutUser.branchIds],
  transport: "web",
  endpoint: "https://push.example.test/current-device",
  keys: { auth: "auth-key", p256dh: "p256dh-key" },
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const logoutDeviceDb = {
  ...db,
  pushSubscriptions: [
    { ...basePushSubscription, id: "push-current-device" },
    { ...basePushSubscription, id: "push-other-device", endpoint: "https://push.example.test/other-device" },
    {
      ...basePushSubscription,
      id: "push-foreign-device",
      userId: otherUser.id,
      endpoint: "https://push.example.test/foreign-device",
    },
  ],
  pushDispatchJobs: [
    {
      id: "push-job-current",
      auditLogId: "audit-push-current",
      branchId: logoutUser.branchIds[0] ?? "branch-gangnam",
      noticeId: "notice-current",
      subscriptionId: "push-current-device",
      recipientUserId: logoutUser.id,
      status: "pending",
      revision: 0,
      attemptCount: 0,
      maxAttempts: 3,
      nextAttemptAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      payloadSnapshot: { title: "공지", body: "현재 기기", tag: "notice-current", url: "/app/notifications" },
    },
    {
      id: "push-job-other",
      auditLogId: "audit-push-other",
      branchId: logoutUser.branchIds[0] ?? "branch-gangnam",
      noticeId: "notice-other",
      subscriptionId: "push-other-device",
      recipientUserId: logoutUser.id,
      status: "pending",
      revision: 0,
      attemptCount: 0,
      maxAttempts: 3,
      nextAttemptAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      payloadSnapshot: { title: "공지", body: "다른 기기", tag: "notice-other", url: "/app/notifications" },
    },
  ],
};
const currentDeviceSession = issuePushDeviceSession(
  logoutDeviceDb,
  "push-current-device",
  now,
);
const detachedLogoutDevice = detachPushDeviceSubscriptionOnLogout(
  currentDeviceSession.db,
  logoutUser,
  currentDeviceSession.cookieValue,
  logoutAt,
);
assert.equal(detachedLogoutDevice.record?.disabledReason, "logout");
assert.equal(detachedLogoutDevice.record?.disabledAt, logoutAt.toISOString());
assert.equal(
  detachedLogoutDevice.db.pushSubscriptions.find((subscription) => subscription.id === "push-other-device")?.disabledAt,
  undefined,
  "logging out one device must preserve the same account's other device",
);
assert.equal(
  detachedLogoutDevice.db.pushDispatchJobs.find((job) => job.id === "push-job-current")?.status,
  "cancelled",
  "logout must cancel queued delivery to the detached device",
);
assert.equal(
  detachedLogoutDevice.db.pushDispatchJobs.find((job) => job.id === "push-job-other")?.status,
  "pending",
  "logout must preserve queued delivery to the account's other device",
);
const detachedExpiredSessionDevice = detachPushDeviceSubscriptionOnLogout(
  currentDeviceSession.db,
  null,
  currentDeviceSession.cookieValue,
  logoutAt,
);
assert.equal(
  detachedExpiredSessionDevice.record?.disabledReason,
  "logout",
  "a valid device credential must detach the current device even after the login session expires",
);
assert.equal(
  detachedExpiredSessionDevice.db.pushDispatchJobs.find((job) => job.id === "push-job-current")?.status,
  "cancelled",
  "expired-session logout must cancel queued delivery to the credentialed device",
);
const foreignDeviceSession = issuePushDeviceSession(
  logoutDeviceDb,
  "push-foreign-device",
  now,
);
assert.equal(
  detachPushDeviceSubscriptionOnLogout(
    foreignDeviceSession.db,
    logoutUser,
    foreignDeviceSession.cookieValue,
    logoutAt,
  ).db,
  foreignDeviceSession.db,
  "a device cookie must not detach another account's subscription",
);
assert.equal(
  getPushDeviceSubscriptionId(currentDeviceSession.db, currentDeviceSession.cookieValue, now),
  "push-current-device",
);
assert.equal(getPushDeviceSubscriptionId(currentDeviceSession.db, "push-current-device"), null);
const tamperedDeviceCookie = `${currentDeviceSession.cookieValue.slice(0, -1)}${
  currentDeviceSession.cookieValue.endsWith("A") ? "B" : "A"
}`;
assert.equal(
  getPushDeviceSubscriptionId(
    currentDeviceSession.db,
    tamperedDeviceCookie,
    now,
  ),
  null,
  "tampering with a device credential must fail closed",
);
assert.equal(
  getPushDeviceSubscriptionId(
    currentDeviceSession.db,
    currentDeviceSession.cookieValue,
    new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000),
  ),
  null,
  "a copied device credential must expire on the server after the remembered-session window",
);
assert.match(
  currentDeviceSession.db.pushSubscriptions.find((subscription) => subscription.id === "push-current-device")?.deviceSessionHash ?? "",
  /^[a-f0-9]{64}$/,
);
assert.equal(
  currentDeviceSession.db.pushSubscriptions.some((subscription) =>
    subscription.deviceSessionHash && currentDeviceSession.cookieValue.includes(subscription.deviceSessionHash),
  ),
  false,
  "the browser cookie must not expose the stored device-session hash",
);
assert.deepEqual(createPushDeviceSubscriptionCookieOptions({ NODE_ENV: "production" }), {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
  sameSite: "lax",
  secure: true,
});
assert.equal(createExpiredPushDeviceSubscriptionCookieOptions({ NODE_ENV: "production" }).maxAge, 0);

const originalNativeRegistration = normalizeNativePushRegistration({
  platform: "ios",
  token: "original-native-device-token-1234567890",
});
const rotatedNativeRegistration = normalizeNativePushRegistration({
  platform: "ios",
  token: "rotated-native-device-token-1234567890",
});
assert(originalNativeRegistration && rotatedNativeRegistration);

const browserRegistration = normalizePushSubscription({
  endpoint: "https://push.example.test/credentialed-browser-device",
  keys: {
    auth: "browser-auth-secret",
    p256dh: "browser-p256dh-public-key",
  },
});
assert(browserRegistration);
const credentialedBrowserSubscription = {
  ...basePushSubscription,
  id: "push-browser-credentialed-device",
  endpoint: browserRegistration.endpoint,
  keys: browserRegistration.keys,
};
assert.equal(
  hasMatchingWebPushCredential(credentialedBrowserSubscription, browserRegistration),
  true,
  "the current browser subscription credentials must authorize an account handoff",
);
assert.equal(
  hasMatchingWebPushCredential(credentialedBrowserSubscription, {
    ...browserRegistration,
    keys: { ...browserRegistration.keys, auth: "attacker-auth-secret" },
  }),
  false,
  "an endpoint without the stored Web Push auth secret must not authorize an account handoff",
);
assert.equal(
  hasMatchingWebPushCredential(credentialedBrowserSubscription, {
    ...browserRegistration,
    keys: { ...browserRegistration.keys, p256dh: "attacker-p256dh-key" },
  }),
  false,
  "an endpoint without the stored Web Push key must not authorize an account handoff",
);
const nativeRotationDb = {
  ...db,
  pushSubscriptions: [
    {
      ...basePushSubscription,
      id: "push-native-current-device",
      transport: "apns",
      endpoint: originalNativeRegistration.endpoint,
      keys: { auth: "", p256dh: "" },
      deviceToken: originalNativeRegistration.token,
      userAgent: "Final Judo iOS",
    },
  ],
};
const rotatedNativeDevice = upsertNativePushRegistration(
  nativeRotationDb,
  logoutUser,
  rotatedNativeRegistration,
  "Final Judo iOS",
  { replacementSubscriptionId: "push-native-current-device" },
);
assert.equal(
  rotatedNativeDevice.record.id,
  "push-native-current-device",
  "a credentialed native device must keep one stable subscription id when its provider token rotates",
);
assert.equal(
  rotatedNativeDevice.db.pushSubscriptions.length,
  1,
  "native provider token rotation must not leave duplicate active subscriptions for one device",
);
assert.equal(rotatedNativeDevice.record.endpoint, rotatedNativeRegistration.endpoint);
assert.equal(rotatedNativeDevice.record.deviceToken, rotatedNativeRegistration.token);

const nativeRotationCollisionDb = {
  ...nativeRotationDb,
  pushSubscriptions: [
    ...nativeRotationDb.pushSubscriptions,
    {
      ...nativeRotationDb.pushSubscriptions[0],
      id: "push-native-previous-token-record",
      endpoint: rotatedNativeRegistration.endpoint,
      deviceToken: rotatedNativeRegistration.token,
    },
  ],
};
const reconciledNativeDevice = upsertNativePushRegistration(
  nativeRotationCollisionDb,
  logoutUser,
  rotatedNativeRegistration,
  "Final Judo iOS",
  { replacementSubscriptionId: "push-native-current-device" },
);
assert.equal(reconciledNativeDevice.record.id, "push-native-previous-token-record");
assert.equal(reconciledNativeDevice.retiredSubscriptionId, "push-native-current-device");
assert.equal(
  reconciledNativeDevice.db.pushSubscriptions.find((item) => item.id === "push-native-current-device")?.disabledReason,
  "token_rotated",
  "a prior token record must be retired when the rotated token already has a stored record",
);
assert.equal(
  reconciledNativeDevice.db.pushSubscriptions.filter((item) => !item.disabledAt).length,
  1,
  "token reconciliation must leave only one active native subscription for the device",
);

assert.equal(
  detachPushDeviceSubscriptionOnAccountSwitch(
    logoutDeviceDb,
    otherUser,
    "push-current-device",
    logoutAt,
  ).db,
  logoutDeviceDb,
  "an unsigned subscription id must not authorize detaching another account's push device",
);

const switchedAccountDevice = detachPushDeviceSubscriptionOnAccountSwitch(
  currentDeviceSession.db,
  otherUser,
  currentDeviceSession.cookieValue,
  logoutAt,
);
assert.equal(switchedAccountDevice.record?.disabledReason, "account_switch");
assert.equal(switchedAccountDevice.record?.disabledAt, logoutAt.toISOString());
assert.equal(
  switchedAccountDevice.db.pushDispatchJobs.find((job) => job.id === "push-job-current")?.status,
  "cancelled",
  "a successful account switch must cancel queued delivery for the previous account on this device",
);
assert.equal(
  detachPushDeviceSubscriptionOnAccountSwitch(
    currentDeviceSession.db,
    logoutUser,
    currentDeviceSession.cookieValue,
    logoutAt,
  ).db,
  currentDeviceSession.db,
  "logging back into the subscription owner must preserve the active device registration",
);

assert.equal(authSecurityLockKey, userAdministrationLockKey, "auth and user administration must share one lock key");
assert.equal(readUnmodifiedPassword("  password with spaces  "), "  password with spaces  ");
assert.equal(readUnmodifiedPassword(1234), "");
for (const malformedHash of [
  "pbkdf2_sha256$120000$salt$zz",
  "pbkdf2_sha256$120000$salt$abcd",
  `pbkdf2_sha256$1000001$salt$${"a".repeat(64)}`,
]) {
  assert.doesNotThrow(() => verifyPassword("password", malformedHash));
  assert.equal(verifyPassword("password", malformedHash), false, "malformed password hashes must fail closed");
  assert.equal(
    verifyAuthenticationPassword("final-judo-invalid-credential-sentinel", malformedHash),
    false,
    "malformed account hashes must use dummy verification without authenticating",
  );
}
const authenticationHash = createRandomPasswordHash("authentication-password");
assert.equal(verifyAuthenticationPassword("authentication-password", authenticationHash), true);
assert.equal(verifyAuthenticationPassword("wrong-password", authenticationHash), false);
assert.equal(
  verifyAuthenticationPassword("final-judo-invalid-credential-sentinel", undefined),
  false,
  "unknown accounts must use dummy verification without authenticating",
);

function authAudit({ id, result, action = "auth.login", targetId = user.id, createdAt }) {
  return {
    id,
    branchId: null,
    actorUserId: targetId,
    action,
    targetType: "auth",
    targetId,
    before: null,
    after: { reason: result === "success" ? "authenticated" : "invalid_credentials" },
    result,
    message: "auth event",
    createdAt,
  };
}

function publicSignupAudit({ id, branchId = "branch-gangnam", createdAt, accountCreated = true }) {
  return {
    id,
    branchId,
    actorUserId: `user-${id}`,
    action: "member.create",
    targetType: "member",
    targetId: `member-${id}`,
    before: null,
    after: { accountCreated },
    result: "success",
    message: "public signup",
    createdAt,
  };
}

const throttleNow = new Date("2026-07-14T00:15:00.000Z");
const fiveRecentFailures = [0, 1, 2, 3, 4].map((minute) =>
  authAudit({
    id: `audit-failed-${minute}`,
    result: "failed",
    createdAt: new Date(Date.parse("2026-07-14T00:05:00.000Z") + minute * 60_000).toISOString(),
  }),
);
const throttled = getAccountLoginThrottle(
  { ...db, auditLogs: fiveRecentFailures },
  user.id,
  throttleNow,
);
assert(throttled, "five recent failed logins must activate the account limit");
assert.equal(throttled.failureCount, 5);
assert.equal(throttled.retryAfterSeconds, 300);
assert.equal(
  shouldRecordBlockedLoginAudit({ ...db, auditLogs: fiveRecentFailures }, user.id, throttleNow),
  true,
  "the first blocked request in a failure window must be audited",
);
const blockedRetry = authAudit({
  id: "audit-blocked-retry",
  result: "blocked",
  createdAt: "2026-07-14T00:14:00.000Z",
});
assert.deepEqual(
  getAccountLoginThrottle({ ...db, auditLogs: [blockedRetry, ...fiveRecentFailures] }, user.id, throttleNow),
  throttled,
  "blocked retries must be audited without extending the account lock window",
);
assert.equal(
  shouldRecordBlockedLoginAudit(
    { ...db, auditLogs: [blockedRetry, ...fiveRecentFailures] },
    user.id,
    throttleNow,
  ),
  false,
  "blocked retries in the same failure window must not amplify database writes",
);
const blockedBeforeFailureWindow = authAudit({
  id: "audit-blocked-before-window",
  result: "blocked",
  createdAt: "2026-07-14T00:04:00.000Z",
});
assert.equal(
  shouldRecordBlockedLoginAudit(
    { ...db, auditLogs: [blockedBeforeFailureWindow, ...fiveRecentFailures] },
    user.id,
    throttleNow,
  ),
  true,
  "a blocked audit from an older window must not suppress the current window audit",
);

const successAfterFailures = authAudit({
  id: "audit-login-success",
  result: "success",
  createdAt: "2026-07-14T00:10:00.000Z",
});
assert.equal(
  getAccountLoginThrottle({ ...db, auditLogs: [successAfterFailures, ...fiveRecentFailures] }, user.id, throttleNow),
  null,
  "successful login must discard earlier failures from the account limit",
);

const resetAudits = [0, 1, 2].map((minute) =>
  authAudit({
    id: `audit-reset-${minute}`,
    action: "auth.password_reset.request",
    result: "success",
    createdAt: new Date(Date.parse("2026-07-14T00:00:00.000Z") + minute * 60_000).toISOString(),
  }),
);
assert.equal(
  hasReachedPasswordResetRequestLimit({ ...db, auditLogs: resetAudits }, user.id, new Date("2026-07-14T00:30:00.000Z")),
  true,
  "three reset requests in one hour must suppress additional writes",
);
assert.equal(
  hasReachedPasswordResetRequestLimit({ ...db, auditLogs: resetAudits }, user.id, new Date("2026-07-14T02:00:00.000Z")),
  false,
  "expired reset requests must not suppress a later request",
);

const signupBurstNow = new Date("2026-07-14T00:14:30.000Z");
const signupBurstAudits = Array.from({ length: 12 }, (_, index) =>
  publicSignupAudit({
    id: `signup-burst-${index}`,
    createdAt: new Date(signupBurstNow.getTime() - (30 - index) * 1_000).toISOString(),
  }),
);
assert.deepEqual(
  getPublicSignupThrottle({ ...db, auditLogs: signupBurstAudits }, "branch-gangnam", signupBurstNow),
  { limit: 12, retryAfterSeconds: 30, windowSeconds: 60 },
  "twelve successful public signups in one minute must activate the branch burst limit",
);
assert.equal(
  getPublicSignupThrottle({ ...db, auditLogs: signupBurstAudits }, "branch-songpa", signupBurstNow),
  null,
  "public signup limits must remain isolated by branch",
);
assert.equal(
  getPublicSignupThrottle(
    {
      ...db,
      auditLogs: signupBurstAudits.map((log) => ({ ...log, after: { accountUserId: log.actorUserId } })),
    },
    "branch-gangnam",
    signupBurstNow,
  ),
  null,
  "operator-created member records must not consume the public signup quota",
);

const signupHourlyNow = new Date("2026-07-14T01:00:00.000Z");
const signupHourlyAudits = Array.from({ length: 60 }, (_, index) =>
  publicSignupAudit({
    id: `signup-hour-${index}`,
    createdAt: new Date(Date.parse("2026-07-14T00:00:30.000Z") + index * 60_000).toISOString(),
  }),
);
assert.deepEqual(
  getPublicSignupThrottle({ ...db, auditLogs: signupHourlyAudits }, "branch-gangnam", signupHourlyNow),
  { limit: 60, retryAfterSeconds: 30, windowSeconds: 3600 },
  "sustained public signup activity must activate the hourly branch limit",
);

const signupDailyNow = new Date("2026-07-15T00:00:00.000Z");
const signupDailyAudits = Array.from({ length: 150 }, (_, index) =>
  publicSignupAudit({
    id: `signup-day-${index}`,
    createdAt: new Date(Date.parse("2026-07-14T00:30:00.000Z") + index * 9 * 60_000).toISOString(),
  }),
);
assert.deepEqual(
  getPublicSignupThrottle({ ...db, auditLogs: signupDailyAudits }, "branch-gangnam", signupDailyNow),
  { limit: 150, retryAfterSeconds: 1800, windowSeconds: 86400 },
  "slow automated public signups must activate the daily branch limit",
);

class SecurityTransitionLock {
  queue = Promise.resolve();

  run(operation) {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const targetUser = db.users.find((candidate) => candidate.id === "user-guardian") ?? db.users[1];
assert(targetUser);
const oldPassword = "  Old-Account-Password!2026  ";
const newPassword = "  New-Account-Password!2026  ";
let transitionDb = {
  ...db,
  users: db.users.map((candidate) =>
    candidate.id === targetUser.id
      ? { ...candidate, passwordHash: createRandomPasswordHash(oldPassword), role: "guardian" }
      : candidate,
  ),
};
const oldTargetSession = createAuthSession(transitionDb, targetUser.id, 3600, now);
transitionDb = oldTargetSession.db;
const transitionLock = new SecurityTransitionLock();
let releaseBarrier;
let markBarrierAcquired;
const barrierAcquired = new Promise((resolve) => {
  markBarrierAcquired = resolve;
});
const barrier = new Promise((resolve) => {
  releaseBarrier = resolve;
});
const heldTransition = transitionLock.run(async () => {
  markBarrierAcquired();
  await barrier;
});
await barrierAcquired;

const securityMutation = transitionLock.run(async () => {
  const latest = transitionDb;
  const changed = {
    ...latest,
    users: latest.users.map((candidate) =>
      candidate.id === targetUser.id
        ? { ...candidate, passwordHash: createRandomPasswordHash(newPassword), role: "member" }
        : candidate,
    ),
  };
  transitionDb = revokeUserAuthSessions(changed, targetUser.id, new Date("2026-07-14T00:30:00.000Z"));
});
const staleLogin = transitionLock.run(async () => {
  const latest = transitionDb;
  const latestUser = latest.users.find((candidate) => candidate.id === targetUser.id);
  if (!latestUser || !verifyPassword(oldPassword, latestUser.passwordHash)) {
    return { status: 401, role: null };
  }
  const issuedLogin = createAuthSession(latest, latestUser.id, 3600, new Date("2026-07-14T00:31:00.000Z"));
  transitionDb = issuedLogin.db;
  return { status: 200, role: latestUser.role };
});
releaseBarrier();
await heldTransition;
await securityMutation;
assert.deepEqual(await staleLogin, { status: 401, role: null }, "queued login must reject the pre-mutation password");
assert.equal(
  findAuthSessionUser(transitionDb, oldTargetSession.token, new Date("2026-07-14T00:31:00.000Z")),
  null,
  "security mutation must revoke sessions issued before the lock transition",
);

const freshLogin = await transitionLock.run(async () => {
  const latest = transitionDb;
  const latestUser = latest.users.find((candidate) => candidate.id === targetUser.id);
  assert(latestUser && verifyPassword(newPassword, latestUser.passwordHash));
  assert.equal(verifyPassword(newPassword.trim(), latestUser.passwordHash), false, "password whitespace must be preserved");
  const issuedLogin = createAuthSession(latest, latestUser.id, 3600, new Date("2026-07-14T00:32:00.000Z"));
  transitionDb = issuedLogin.db;
  return { role: latestUser.role, token: issuedLogin.token };
});
assert.equal(freshLogin.role, "member", "post-mutation login must bootstrap the latest role");
assert.equal(findAuthSessionUser(transitionDb, freshLogin.token, new Date("2026-07-14T00:32:01.000Z"))?.role, "member");

const loginRouteSource = readFileSync("src/app/api/v1/auth/login/route.ts", "utf8");
const passwordRouteSource = readFileSync("src/app/api/v1/admin/users/[userId]/password/route.ts", "utf8");
const roleRouteSource = readFileSync("src/app/api/v1/admin/users/[userId]/roles/route.ts", "utf8");
const userRouteSource = readFileSync("src/app/api/v1/admin/users/[userId]/route.ts", "utf8");
const resetRouteSource = readFileSync("src/app/api/v1/auth/password-reset/route.ts", "utf8");
const registerRouteSource = readFileSync("src/app/api/v1/auth/register/route.ts", "utf8");
const logoutRouteSource = readFileSync("src/app/api/v1/auth/logout/route.ts", "utf8");
const apiClientSource = readFileSync("src/lib/api-client.ts", "utf8");
const appStoreSource = readFileSync("src/store/app-store.tsx", "utf8");
const browserPushSource = readFileSync("src/lib/browser-push-subscription.ts", "utf8");
const nativePushSource = readFileSync("src/lib/native-push-registration.ts", "utf8");
const pushSubscriptionRouteSource = readFileSync("src/app/api/v1/notifications/subscriptions/route.ts", "utf8");
const authSessionSource = readFileSync("src/server/auth-session.ts", "utf8");
const authNotificationStateLockSource = readFileSync("src/server/auth-notification-state-lock.ts", "utf8");

assert(loginRouteSource.includes("withAuthAndNotificationStateLock"));
assert(loginRouteSource.includes("function isLoginBody(value: unknown)"));
assert(loginRouteSource.indexOf("if (!isLoginBody(rawBody))") < loginRouteSource.indexOf("loginId ="));
assert(loginRouteSource.indexOf("withAuthAndNotificationStateLock") < loginRouteSource.indexOf("const db = await readServerDb()"));
assert(loginRouteSource.indexOf("const throttle = user ? getAccountLoginThrottle") < loginRouteSource.indexOf("verifyAuthenticationPassword(password"));
assert(loginRouteSource.includes("const canBypassAccountThrottle = passwordMatches && !usesBlockedSharedPassword;"));
assert(loginRouteSource.indexOf("verifyAuthenticationPassword(password") < loginRouteSource.indexOf("if (user && throttle && !canBypassAccountThrottle)"));
assert(loginRouteSource.includes("verifyAuthenticationPassword(password, user?.passwordHash)"));
assert(loginRouteSource.includes('process.env.NODE_ENV === "production"'));
assert(loginRouteSource.includes("password === defaultPilotPassword"));
assert(loginRouteSource.includes("if (shouldRecordBlockedLoginAudit(db, user.id, now))"));
const throttledLoginBranch = loginRouteSource.slice(
  loginRouteSource.indexOf("if (user && throttle && !canBypassAccountThrottle)"),
  loginRouteSource.indexOf("if (!user || !passwordMatches || usesBlockedSharedPassword)"),
);
assert(throttledLoginBranch.includes("return createInvalidCredentialResponse();"));
assert(!throttledLoginBranch.includes("429"));
assert(!throttledLoginBranch.includes("Retry-After"));
assert(!loginRouteSource.includes("after: { phone:"), "login audits must not persist raw identifiers");
assert(!/x-forwarded-for|x-real-ip|request\.ip/i.test(loginRouteSource), "login throttling must not persist request-origin identifiers");
assert(loginRouteSource.includes("withAuthAndNotificationStateLock"));
assert(loginRouteSource.includes("detachPushDeviceSubscriptionOnAccountSwitch"));
assert(loginRouteSource.includes("createExpiredPushDeviceSubscriptionCookieOptions"));
assert(loginRouteSource.includes('reason: "account_switch"'));
assert(logoutRouteSource.includes("withAuthAndNotificationStateLock"));
assert(logoutRouteSource.indexOf("withAuthAndNotificationStateLock") < logoutRouteSource.indexOf("const db = await readServerDb()"));
assert(logoutRouteSource.includes("detachPushDeviceSubscriptionOnLogout"));
assert(
  !/if\s*\(user\)\s*\{[\s\S]*?detachPushDeviceSubscriptionOnLogout/.test(logoutRouteSource),
  "logout must detach a credentialed current device even when its login session already expired",
);
assert(logoutRouteSource.includes("createExpiredPushDeviceSubscriptionCookieOptions"));
assert(logoutRouteSource.includes('action: "notification.unsubscribe"'));
assert(/signOut\(\)[\s\S]*?keepalive: true/.test(apiClientSource), "logout request must survive navigation and app backgrounding");
assert(appStoreSource.includes("signOut: () => Promise<boolean>"));
const clientSignOutBranch = appStoreSource.slice(
  appStoreSource.indexOf("const signOut = useCallback"),
  appStoreSource.indexOf("const selectBranch = useCallback"),
);
assert(clientSignOutBranch.includes("await apiClient.signOut()"));
assert(
  clientSignOutBranch.indexOf("await apiClient.signOut()") < clientSignOutBranch.indexOf("persistSession(null)"),
  "local session removal must wait for server logout acknowledgement",
);
assert(clientSignOutBranch.includes('reportOperationError(error, "로그아웃하지 못했습니다."'));
assert(browserPushSource.includes("disconnectCurrentBrowserPushSubscription"));
assert(browserPushSource.includes("subscription.unsubscribe()"));
assert(nativePushSource.includes("disconnectCurrentNativePushRegistration"));
assert(nativePushSource.includes("PushNotifications.unregister()"));
assert(
  pushSubscriptionRouteSource.includes("replacementSubscriptionId") &&
    pushSubscriptionRouteSource.includes("getPushDeviceSubscriptionId"),
  "push registration must use the authenticated device credential to replace a rotated endpoint in place",
);
assert(
  pushSubscriptionRouteSource.includes("hasMatchingWebPushCredential") &&
    pushSubscriptionRouteSource.includes('"PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT"'),
  "cross-account Web Push ownership changes must prove the stored browser subscription credentials",
);
assert(passwordRouteSource.includes("withAuthAndNotificationStateLock"));
assert(passwordRouteSource.includes("const freshDb = await readServerDb()"));
assert(passwordRouteSource.includes("readUnmodifiedPassword(body?.temporaryPassword)"));
assert(roleRouteSource.includes("withAuthAndNotificationStateLock"));
assert(roleRouteSource.includes("const db = await readServerDb()"));
assert(userRouteSource.match(/withAuthAndNotificationStateLock\(/g)?.length === 2);
assert(userRouteSource.includes("readUnmodifiedPassword(body.password)"));
assert(resetRouteSource.includes("withServerDbLock(authSecurityLockKey"));
assert(resetRouteSource.includes("withAuthAndNotificationStateLock"));
assert(
  authNotificationStateLockSource.indexOf("withServerDbLock(authSecurityLockKey") <
    authNotificationStateLockSource.indexOf("withServerDbLock(notificationOutboxLockKey"),
  "account security and push state mutations must acquire both locks in one stable order",
);
assert(resetRouteSource.includes("hasReachedPasswordResetRequestLimit"));
assert(resetRouteSource.includes("if (!isPasswordResetBody(rawBody))"));
assert(resetRouteSource.includes("findVerifiedPasswordResetChallenge"));
assert(resetRouteSource.includes("consumePasswordResetChallenges"));
assert(
  resetRouteSource.includes("revokeUserSecurityAccess"),
  "completed password reset must revoke both sessions and earlier-device push credentials",
);
assert(
  authSessionSource.includes("cancelPushDispatchJobsForSubscriptions") &&
    authSessionSource.includes("revokedSubscriptionIds") &&
    authSessionSource.includes("return cancelPushDispatchJobsForSubscriptions(nextDb, revokedSubscriptionIds"),
  "security-context revocation must cancel queued earlier-device push jobs through the outbox state machine",
);
assert(resetRouteSource.includes("passwordResetMinimumPasswordLength"));
assert(!resetRouteSource.includes("after: { identifier }"), "reset audits must not persist the supplied identifier");
assert(registerRouteSource.includes("if (!isRegisterBody(rawBody))"));
assert(registerRouteSource.includes("withServerDbLock(`auth-register-phone:${phone}`"));
assert(registerRouteSource.includes("phoneAlreadyRegistered"));
assert(!registerRouteSource.includes("createPhoneSignupChallenge"));
assert(!registerRouteSource.includes("verifyPhoneSignupCode"));

console.log(JSON.stringify({
  ok: true,
  checked: [
    "raw user-id cookie rejected",
    "only hashed opaque token persisted",
    "expiration enforced",
    "single-session and user-wide revocation enforced",
    "unknown logout tokens do not trigger storage writes",
    "auth and user administration share one security lock",
    "password input whitespace preserved",
    "malformed password hashes fail closed without throwing",
    "unknown and malformed accounts take dummy password verification without authenticating",
    "five failures activate throttling with one blocked audit per failure window",
    "account throttling is enforced without a distinguishable status or Retry-After response",
    "valid active-account credentials recover from account-only throttling while the production shared password stays blocked",
    "successful login resets the failure window",
    "password reset writes stop after three account requests per hour",
    "public signup burst, hourly, and daily quotas remain branch-scoped and exclude operator-created members",
    "barrier transition rejects stale password and session state",
    "post-transition login observes the latest role",
    "login, logout, and account security changes share ordered auth/push locks without raw identifier audit data",
    "logout detaches only the current device after an active or expired login session, cancels its queued push, expires its cookie, and uses a keepalive request",
    "account switching requires a hashed expiring device credential before detaching a prior-account push registration",
    "credentialed native token rotation reuses one device record and retires a duplicate stored token",
    "cross-account Web Push ownership transfer requires the stored auth and p256dh credentials",
    "client logout waits for server acknowledgement and disconnects the local browser or native push token",
    "security-context changes cancel queued earlier-device push jobs and fence in-flight delivery uncertainty",
  ],
}, null, 2));
