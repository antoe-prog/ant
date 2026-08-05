import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createMockData } from "../src/lib/mock-data.ts";
import {
  createPhoneSignupChallenge,
  discardPhoneSignupChallenge,
  hasReachedPhoneSignupRequestLimit,
  phoneSignupCodeLength,
  phoneSignupMaxAttempts,
  phoneSignupRequestLimit,
  verifyPhoneSignupCode,
} from "../src/server/phone-signup-verification.ts";

const phone = "01012349876";
const now = new Date("2026-08-05T00:00:00.000Z");
const initialDb = createMockData();
const created = createPhoneSignupChallenge(initialDb, phone, now);

assert.match(created.code, new RegExp(`^\\d{${phoneSignupCodeLength}}$`));
assert(!JSON.stringify(created.db.phoneSignupChallenges).includes(phone), "signup challenges must not persist raw phones");
assert.match(created.challenge.phoneHash, /^[a-f0-9]{64}$/);
assert.match(created.challenge.codeHash, /^pbkdf2_sha256\$\d+\$[a-f0-9]{32}\$[a-f0-9]{64}$/i);

let failedDb = created.db;
const wrongCode = created.code === "999999" ? "000000" : "999999";
for (let attempt = 1; attempt <= phoneSignupMaxAttempts; attempt += 1) {
  const failed = verifyPhoneSignupCode(failedDb, phone, wrongCode, new Date(now.getTime() + attempt * 1_000));
  assert.equal(failed.ok, false);
  failedDb = failed.db;
}
assert(
  failedDb.phoneSignupChallenges?.every((challenge) => challenge.consumedAt),
  "five failed attempts must consume pending signup challenges",
);
assert.equal(
  verifyPhoneSignupCode(failedDb, phone, created.code, new Date(now.getTime() + 6_000)).ok,
  false,
  "a consumed signup code must not be reusable",
);

const second = createPhoneSignupChallenge(failedDb, phone, new Date(now.getTime() + 60_000));
const verified = verifyPhoneSignupCode(second.db, phone, second.code, new Date(now.getTime() + 61_000));
assert.equal(verified.ok, true, "a current signup code must verify");
assert(
  verified.db.phoneSignupChallenges?.filter((challenge) => challenge.phoneHash === second.challenge.phoneHash).every(
    (challenge) => challenge.consumedAt,
  ),
  "successful verification must consume every pending code for the phone",
);

let limitedDb = createMockData();
for (let request = 0; request < phoneSignupRequestLimit; request += 1) {
  limitedDb = createPhoneSignupChallenge(limitedDb, phone, new Date(now.getTime() + request * 1_000)).db;
}
assert.equal(hasReachedPhoneSignupRequestLimit(limitedDb, phone, new Date(now.getTime() + 5_000)), true);
assert.equal(hasReachedPhoneSignupRequestLimit(limitedDb, "01087654321", new Date(now.getTime() + 5_000)), false);
assert.equal(
  discardPhoneSignupChallenge(limitedDb, limitedDb.phoneSignupChallenges[0].id).phoneSignupChallenges.length,
  phoneSignupRequestLimit - 1,
  "failed delivery cleanup must discard only its reservation",
);

const registerRouteSource = readFileSync("src/app/api/v1/auth/register/route.ts", "utf8");
const signupScreenSource = readFileSync("src/components/screens/signup-screen.tsx", "utf8");
const apiClientSource = readFileSync("src/lib/api-client.ts", "utf8");

assert(registerRouteSource.includes('action: "request"'));
assert(registerRouteSource.includes('action: "complete"'));
assert(registerRouteSource.includes("createPhoneSignupChallenge"));
assert(registerRouteSource.includes("verifyPhoneSignupCode"));
assert(registerRouteSource.includes("hasReachedPhoneSignupRequestLimit"));
assert(registerRouteSource.includes("after(async ()"), "production SMS delivery must run after the response");
assert(registerRouteSource.includes('purpose: "signup"'));
assert(registerRouteSource.includes('"SIGNUP_CODE_INVALID"'));
assert(!registerRouteSource.includes("이미 등록된 휴대폰 번호입니다."), "signup must not enumerate existing phone numbers");
assert(!registerRouteSource.includes("after: { phone"), "signup audit logs must not persist raw phones");
assert(signupScreenSource.includes('data-testid="signup-code-request-button"'));
assert(signupScreenSource.includes('data-testid="signup-code-input"'));
assert(apiClientSource.includes("requestSignupVerificationCode"));
assert(apiClientSource.includes('action: "complete"'));

console.log(JSON.stringify({
  ok: true,
  checked: [
    "raw phone is not stored in signup challenges",
    "signup codes expire after bounded attempts and cannot be reused",
    "request rate limiting is scoped to the hashed phone",
    "failed delivery cleanup removes only its reserved challenge",
    "public signup requires request and complete actions",
    "production signup SMS delivery is deferred",
    "existing phone responses do not expose account existence",
    "signup audit metadata omits raw phone numbers",
    "signup UI and API client require a verification code",
  ],
}, null, 2));
