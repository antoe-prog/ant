import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockData } from "../src/lib/mock-data.ts";
import { createRandomPasswordHash, verifyPassword } from "../src/server/auth-password.ts";
import {
  authSecurityLockKey,
  createAuthSession,
  findAuthSession,
  findAuthSessionUser,
  getAccountLoginThrottle,
  hasReachedPasswordResetRequestLimit,
  readUnmodifiedPassword,
  revokeAuthSession,
  revokeUserAuthSessions,
  shouldRecordBlockedLoginAudit,
} from "../src/server/auth-session.ts";
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
}

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

assert(loginRouteSource.includes("withServerDbLock(authSecurityLockKey"));
assert(loginRouteSource.includes("function isLoginBody(value: unknown)"));
assert(loginRouteSource.indexOf("if (!isLoginBody(rawBody))") < loginRouteSource.indexOf("loginId ="));
assert(loginRouteSource.indexOf("withServerDbLock(authSecurityLockKey") < loginRouteSource.indexOf("const db = await readServerDb()"));
assert(loginRouteSource.indexOf("const throttle = getAccountLoginThrottle") < loginRouteSource.indexOf("verifyPassword(password"));
assert(loginRouteSource.includes("const canBypassAccountThrottle = passwordMatches && !usesBlockedSharedPassword;"));
assert(loginRouteSource.indexOf("verifyPassword(password") < loginRouteSource.indexOf("if (user && throttle && !canBypassAccountThrottle)"));
assert(loginRouteSource.includes('process.env.NODE_ENV === "production"'));
assert(loginRouteSource.includes("password === defaultPilotPassword"));
assert(loginRouteSource.includes("if (shouldRecordBlockedLoginAudit(db, user.id, now))"));
assert(loginRouteSource.includes('rateLimitedResponse.headers.set("Retry-After"'));
assert(!loginRouteSource.includes("after: { phone:"), "login audits must not persist raw identifiers");
assert(!/x-forwarded-for|x-real-ip|request\.ip/i.test(loginRouteSource), "login throttling must not persist request-origin identifiers");
assert(logoutRouteSource.includes("withServerDbLock(authSecurityLockKey"));
assert(logoutRouteSource.indexOf("withServerDbLock(authSecurityLockKey") < logoutRouteSource.indexOf("const db = await readServerDb()"));
assert(passwordRouteSource.includes("withServerDbLock(authSecurityLockKey"));
assert(passwordRouteSource.includes("const freshDb = await readServerDb()"));
assert(passwordRouteSource.includes("readUnmodifiedPassword(body?.temporaryPassword)"));
assert(roleRouteSource.includes("withServerDbLock(authSecurityLockKey"));
assert(roleRouteSource.includes("const db = await readServerDb()"));
assert(userRouteSource.match(/withServerDbLock\(authSecurityLockKey/g)?.length === 2);
assert(userRouteSource.includes("readUnmodifiedPassword(body.password)"));
assert(resetRouteSource.includes("withServerDbLock(authSecurityLockKey"));
assert(resetRouteSource.includes("hasReachedPasswordResetRequestLimit"));
assert(resetRouteSource.includes("if (!isPasswordResetBody(rawBody))"));
assert(resetRouteSource.includes("findVerifiedPasswordResetChallenge"));
assert(resetRouteSource.includes("consumePasswordResetChallenges"));
assert(resetRouteSource.includes("revokeUserAuthSessions"));
assert(resetRouteSource.includes("passwordResetMinimumPasswordLength"));
assert(!resetRouteSource.includes("after: { identifier }"), "reset audits must not persist the supplied identifier");
assert(registerRouteSource.indexOf("회원가입 입력 형식이 올바르지 않습니다.") < registerRouteSource.indexOf("withServerDbLock(`auth-register-phone:${phone}`"));

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
    "five failures activate throttling with one blocked audit per failure window",
    "valid active-account credentials recover from account-only throttling while the production shared password stays blocked",
    "successful login resets the failure window",
    "password reset writes stop after three account requests per hour",
    "barrier transition rejects stale password and session state",
    "post-transition login observes the latest role",
    "login/logout and account security routes use the shared lock without raw identifier audit data",
  ],
}, null, 2));
