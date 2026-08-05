import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockData } from "../src/lib/mock-data.ts";
import {
  consumePasswordResetChallenges,
  createPasswordResetChallenge,
  discardPasswordResetChallenge,
  findVerifiedPasswordResetChallenge,
  passwordResetMaxAttempts,
  passwordResetMinimumPasswordLength,
  reconcileFailedPasswordResetDelivery,
  verifyPasswordResetCode,
} from "../src/server/password-reset.ts";
import {
  getPasswordResetSmsReadiness,
  sendPasswordResetSms,
} from "../src/server/password-reset-sms.ts";
import {
  cleanupReleaseSmokeEnvironment,
  createReleaseSmokeEnvironment,
} from "./lib/release-smoke-environment.mjs";

const userId = "user-member";
const initial = createMockData();
const passwordResetRouteSource = readFileSync("src/app/api/v1/auth/password-reset/route.ts", "utf8");
const passwordResetSource = readFileSync("src/server/password-reset.ts", "utf8");
const created = createPasswordResetChallenge(initial, userId, new Date("2026-07-24T00:00:00.000Z"));

assert.match(
  passwordResetRouteSource,
  /writeServerDb\(reconcileFailedPasswordResetDelivery\(db,/,
  "the password reset route must reconcile a failed SMS reservation before responding",
);
assert.match(
  passwordResetRouteSource,
  /revokeUserSecurityAccess\(dbWithUpdatedUser, user\.id, now\)/,
  "a completed password reset must revoke login sessions and earlier-device push credentials",
);
assert.match(
  passwordResetRouteSource,
  /if \(!user\) \{\s*runPasswordHashTimingEqualizer\(code\);/,
  "an unknown reset phone must perform the same baseline password-hash work as an active challenge",
);
assert.match(
  passwordResetSource,
  /if \(activeChallenges\.length === 0\) \{\s*runPasswordHashTimingEqualizer\(code\);/,
  "a known account without an active challenge must not skip the baseline password-hash work",
);
assert.equal(
  passwordResetRouteSource.match(/runPasswordHashTimingEqualizer\(phone\)/g)?.length,
  2,
  "unknown and rate-limited reset requests must each match the challenge-creation PBKDF2 work",
);
assert.match(
  passwordResetRouteSource,
  /if \(readiness\.mode === "webhook"\) \{[\s\S]*?after\(async \(\) => \{[\s\S]*?await deliverReservedCode\(\);[\s\S]*?return jsonOk\(\{ ok: true, next: "verify" as const \}\);/,
  "production webhook delivery must run after the account-neutral response path is committed",
);
const failedDeliveryBranch = passwordResetRouteSource.slice(
  passwordResetRouteSource.indexOf("if (!delivery.ok)"),
  passwordResetRouteSource.indexOf("return jsonOk({", passwordResetRouteSource.indexOf("if (!delivery.ok)")) +
    "return jsonOk({ ok: true, next: \"verify\" as const });".length,
);
assert.match(
  failedDeliveryBranch,
  /return jsonOk\(\{ ok: true, next: "verify" as const \}\);/,
  "an individual SMS delivery failure must keep the same public response as an unknown account",
);
assert(!failedDeliveryBranch.includes("PASSWORD_RESET_SMS_DELIVERY_FAILED"));

assert.equal(created.challenge.userId, userId);
assert.equal(created.code.length, 6);
assert.match(created.code, /^\d{6}$/);
assert(!created.challenge.codeHash.includes(created.code), "the one-time code must never be stored in plaintext");
assert.equal(created.challenge.resetTokenHash, undefined);

let failedDb = created.db;
for (let attempt = 0; attempt < passwordResetMaxAttempts; attempt += 1) {
  const failed = verifyPasswordResetCode(
    failedDb,
    userId,
    created.code === "000000" ? "999999" : "000000",
    new Date(`2026-07-24T00:0${attempt + 1}:00.000Z`),
  );
  assert.equal(failed.ok, false);
  failedDb = failed.db;
}
assert(
  failedDb.passwordResetChallenges[0]?.consumedAt,
  "the challenge must be consumed after the maximum failed attempts",
);
assert.equal(
  verifyPasswordResetCode(failedDb, userId, created.code, new Date("2026-07-24T00:06:00.000Z")).ok,
  false,
  "a locked challenge must reject the correct code",
);
const lockedRetry = verifyPasswordResetCode(
  failedDb,
  userId,
  created.code,
  new Date("2026-07-24T00:06:01.000Z"),
);
assert.equal(lockedRetry.db, failedDb, "a consumed challenge retry must not create another database write");

const firstDelivery = createPasswordResetChallenge(
  initial,
  userId,
  new Date("2026-07-24T01:00:00.000Z"),
);
const delayedSecondDelivery = createPasswordResetChallenge(
  firstDelivery.db,
  userId,
  new Date("2026-07-24T01:01:00.000Z"),
);
assert.equal(
  delayedSecondDelivery.db.passwordResetChallenges.filter(
    (challenge) => challenge.userId === userId && !challenge.consumedAt,
  ).length,
  2,
  "requesting another code must keep the earlier delivered code usable until expiry",
);
const verifiedEarlierDelivery = verifyPasswordResetCode(
  delayedSecondDelivery.db,
  userId,
  firstDelivery.code,
  new Date("2026-07-24T01:02:00.000Z"),
);
assert.equal(
  verifiedEarlierDelivery.ok,
  true,
  "an earlier code that arrives after a newer request must still verify",
);
assert(
  verifiedEarlierDelivery.ok &&
    verifiedEarlierDelivery.db.passwordResetChallenges
      .filter((challenge) => challenge.userId === userId && challenge.id !== firstDelivery.challenge.id)
      .every((challenge) => Boolean(challenge.consumedAt)),
  "verifying one code must consume the user's other active codes",
);
const failedResendDeliveryDb = discardPasswordResetChallenge(
  delayedSecondDelivery.db,
  delayedSecondDelivery.challenge.id,
);
assert.equal(
  verifyPasswordResetCode(
    failedResendDeliveryDb,
    userId,
    firstDelivery.code,
    new Date("2026-07-24T01:02:00.000Z"),
  ).ok,
  true,
  "a failed resend delivery must discard only the failed reservation and preserve the earlier code",
);

const aggregateAttemptFirst = createPasswordResetChallenge(
  initial,
  userId,
  new Date("2026-07-24T02:00:00.000Z"),
);
let aggregateAttemptDb = aggregateAttemptFirst.db;
const aggregateInvalidCode = aggregateAttemptFirst.code === "999999" ? "000000" : "999999";
for (let attempt = 0; attempt < passwordResetMaxAttempts - 1; attempt += 1) {
  const failed = verifyPasswordResetCode(
    aggregateAttemptDb,
    userId,
    aggregateInvalidCode,
    new Date(`2026-07-24T02:0${attempt + 1}:00.000Z`),
  );
  assert.equal(failed.ok, false);
  aggregateAttemptDb = failed.db;
}
const aggregateAttemptSecond = createPasswordResetChallenge(
  aggregateAttemptDb,
  userId,
  new Date("2026-07-24T02:05:00.000Z"),
);
assert.equal(
  aggregateAttemptSecond.challenge.failedAttemptCount,
  passwordResetMaxAttempts - 1,
  "a resent code must inherit the user's existing failed-attempt count",
);
const finalAggregateAttempt = verifyPasswordResetCode(
  aggregateAttemptSecond.db,
  userId,
  [aggregateAttemptFirst.code, aggregateAttemptSecond.code].includes("999999") ? "000000" : "999999",
  new Date("2026-07-24T02:06:00.000Z"),
);
assert.equal(finalAggregateAttempt.ok, false);
aggregateAttemptDb = finalAggregateAttempt.db;
assert(
  aggregateAttemptDb.passwordResetChallenges
    .filter((challenge) => challenge.userId === userId)
    .every((challenge) => Boolean(challenge.consumedAt)),
  "multiple active codes must share one five-attempt verification budget",
);

const renewed = createPasswordResetChallenge(failedDb, userId, new Date("2026-07-24T00:10:00.000Z"));
const verified = verifyPasswordResetCode(
  renewed.db,
  userId,
  renewed.code,
  new Date("2026-07-24T00:11:00.000Z"),
);
assert.equal(verified.ok, true);
assert(verified.ok);
assert(!JSON.stringify(verified.db).includes(verified.resetToken), "the reset token must only be stored as a hash");
assert.equal(
  findVerifiedPasswordResetChallenge(
    verified.db,
    verified.resetToken,
    new Date("2026-07-24T00:12:00.000Z"),
  )?.userId,
  userId,
);

const consumed = consumePasswordResetChallenges(
  verified.db,
  userId,
  new Date("2026-07-24T00:13:00.000Z"),
);
assert.equal(
  findVerifiedPasswordResetChallenge(
    consumed,
    verified.resetToken,
    new Date("2026-07-24T00:13:01.000Z"),
  ),
  null,
  "a consumed reset token must not be reusable",
);
assert.equal(passwordResetMinimumPasswordLength, 8);

const failedDeliveryRequestedAt = "2026-07-24T03:00:00.000Z";
const failedDelivery = createPasswordResetChallenge(
  {
    ...initial,
    users: initial.users.map((user) =>
      user.id === userId ? { ...user, passwordResetRequestedAt: failedDeliveryRequestedAt } : user,
    ),
    auditLogs: [
      {
        id: "audit-password-reset-delivery",
        branchId: "branch-main",
        actorUserId: userId,
        action: "auth.password_reset.request",
        targetType: "auth",
        targetId: userId,
        before: null,
        after: { verificationRequested: true },
        result: "success",
        message: "비밀번호 변경 휴대폰 인증을 요청했습니다.",
        createdAt: failedDeliveryRequestedAt,
      },
      ...initial.auditLogs,
    ],
  },
  userId,
  new Date(failedDeliveryRequestedAt),
);
const reconciledFailedDelivery = reconcileFailedPasswordResetDelivery(failedDelivery.db, {
  auditLogId: "audit-password-reset-delivery",
  challengeId: failedDelivery.challenge.id,
  requestedAt: failedDeliveryRequestedAt,
  userId,
});
assert.equal(
  reconciledFailedDelivery.passwordResetChallenges.some(
    (challenge) => challenge.id === failedDelivery.challenge.id,
  ),
  false,
  "a failed SMS delivery must discard its reserved challenge",
);
assert.equal(
  reconciledFailedDelivery.auditLogs.find((log) => log.id === "audit-password-reset-delivery")?.result,
  "failed",
  "a failed SMS delivery must not remain a successful request that consumes the hourly limit",
);
assert.equal(
  reconciledFailedDelivery.users.find((user) => user.id === userId)?.passwordResetRequestedAt,
  undefined,
  "a failed SMS delivery must clear its own request marker",
);
assert.equal(
  reconciledFailedDelivery.auditLogs.length,
  failedDelivery.db.auditLogs.length,
  "delivery failure must reclassify the reservation instead of writing a contradictory second audit",
);

const newerRequestAt = "2026-07-24T03:01:00.000Z";
const reconciledDelayedFailure = reconcileFailedPasswordResetDelivery(
  {
    ...failedDelivery.db,
    users: failedDelivery.db.users.map((user) =>
      user.id === userId ? { ...user, passwordResetRequestedAt: newerRequestAt } : user,
    ),
  },
  {
    auditLogId: "audit-password-reset-delivery",
    challengeId: failedDelivery.challenge.id,
    requestedAt: failedDeliveryRequestedAt,
    userId,
  },
);
assert.equal(
  reconciledDelayedFailure.users.find((user) => user.id === userId)?.passwordResetRequestedAt,
  newerRequestAt,
  "a delayed failure must not clear a newer reset request marker",
);

assert.deepEqual(await getPasswordResetSmsReadiness({ NODE_ENV: "production" }), { ready: false });
assert.deepEqual(
  await getPasswordResetSmsReadiness({
    NODE_ENV: "production",
    FINAL_JUDO_ENABLE_DEV_SMS_CODE: "1",
  }),
  { ready: false },
  "a production flag without isolated smoke ownership must not expose a development code",
);
assert.deepEqual(
  await getPasswordResetSmsReadiness({
    NODE_ENV: "production",
    FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_TOKEN: "secret",
    FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_URL: "http://sms.example.test/send",
  }),
  { ready: false },
);
const productionReadiness = await getPasswordResetSmsReadiness({
  NODE_ENV: "production",
  FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_TOKEN: "secret",
  FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_URL: "https://sms.example.test/send",
});
assert.equal(productionReadiness.ready, true);
assert.equal(productionReadiness.ready && productionReadiness.mode, "webhook");

const developmentReadiness = await getPasswordResetSmsReadiness({
  NODE_ENV: "development",
  FINAL_JUDO_ENABLE_DEV_SMS_CODE: "1",
});
assert.equal(developmentReadiness.ready, true);
assert(developmentReadiness.ready);
assert.deepEqual(
  await sendPasswordResetSms(developmentReadiness, { phone: "01050504927", code: "123456" }),
  { ok: true, developmentCode: "123456" },
);

const isolatedProductionSmoke = await createReleaseSmokeEnvironment({ env: { NODE_ENV: "production" } });

try {
  const isolatedSmokeReadiness = await getPasswordResetSmsReadiness(isolatedProductionSmoke.env);

  assert.equal(isolatedSmokeReadiness.ready, true);
  assert(isolatedSmokeReadiness.ready);
  assert.equal(
    isolatedSmokeReadiness.mode,
    "development",
    "a run-owned isolated production smoke server must be able to verify the password reset flow without a real SMS",
  );
} finally {
  await cleanupReleaseSmokeEnvironment(isolatedProductionSmoke);
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "six-digit code stored only as a salted password hash",
    "unknown or inactive reset targets perform one baseline PBKDF2 verification",
    "unknown and rate-limited reset requests match challenge-creation PBKDF2 work",
    "production webhook delivery runs after the account-neutral response",
    "individual SMS delivery failure keeps the account-neutral public response",
    "five failed attempts consume the challenge",
    "resend and delayed delivery preserve earlier valid codes with one shared attempt budget",
    "verified reset token stored only as a hash and accepted once",
    "password reset revokes sessions and earlier-device push credentials",
    "failed SMS delivery is reclassified without consuming the request limit or erasing a newer request",
    "reset password minimum is eight characters",
    "production SMS requires an authenticated HTTPS webhook",
    "development code exposure requires an explicit non-production flag",
    "production smoke code exposure requires run-owned isolated data",
  ],
}, null, 2));
