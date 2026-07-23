import assert from "node:assert/strict";
import { createMockData } from "../src/lib/mock-data.ts";
import {
  consumePasswordResetChallenges,
  createPasswordResetChallenge,
  findVerifiedPasswordResetChallenge,
  passwordResetMaxAttempts,
  passwordResetMinimumPasswordLength,
  verifyPasswordResetCode,
} from "../src/server/password-reset.ts";
import {
  getPasswordResetSmsReadiness,
  sendPasswordResetSms,
} from "../src/server/password-reset-sms.ts";

const userId = "user-member";
const initial = createMockData();
const created = createPasswordResetChallenge(initial, userId, new Date("2026-07-24T00:00:00.000Z"));

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

assert.deepEqual(getPasswordResetSmsReadiness({ NODE_ENV: "production" }), { ready: false });
assert.deepEqual(
  getPasswordResetSmsReadiness({
    NODE_ENV: "production",
    FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_TOKEN: "secret",
    FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_URL: "http://sms.example.test/send",
  }),
  { ready: false },
);
const productionReadiness = getPasswordResetSmsReadiness({
  NODE_ENV: "production",
  FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_TOKEN: "secret",
  FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_URL: "https://sms.example.test/send",
});
assert.equal(productionReadiness.ready, true);
assert.equal(productionReadiness.ready && productionReadiness.mode, "webhook");

const developmentReadiness = getPasswordResetSmsReadiness({
  NODE_ENV: "development",
  FINAL_JUDO_ENABLE_DEV_SMS_CODE: "1",
});
assert.equal(developmentReadiness.ready, true);
assert(developmentReadiness.ready);
assert.deepEqual(
  await sendPasswordResetSms(developmentReadiness, { phone: "01050504927", code: "123456" }),
  { ok: true, developmentCode: "123456" },
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "six-digit code stored only as a salted password hash",
    "five failed attempts consume the challenge",
    "verified reset token stored only as a hash and accepted once",
    "reset password minimum is eight characters",
    "production SMS requires an authenticated HTTPS webhook",
    "development code exposure requires an explicit non-production flag",
  ],
}, null, 2));
