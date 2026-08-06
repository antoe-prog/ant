import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registerRouteSource = readFileSync("src/app/api/v1/auth/register/route.ts", "utf8");
const signupScreenSource = readFileSync("src/components/screens/signup-screen.tsx", "utf8");
const apiClientSource = readFileSync("src/lib/api-client.ts", "utf8");

assert(registerRouteSource.includes("type RegisterBody = { branchId: string; name: string; password: string; phone: string }"));
assert(registerRouteSource.includes("if (!isRegisterBody(rawBody))"), "signup must reject malformed payloads before processing");
assert(registerRouteSource.includes("getAuthInputLimitError"), "signup must reject oversized public inputs");
assert(registerRouteSource.includes("isValidKoreanMobileNumber"), "signup must validate Korean mobile numbers");
assert(registerRouteSource.includes("getAvailableSignupBranches"), "signup must derive eligible branches on the server");
assert(registerRouteSource.includes("availableBranches.find"), "signup must validate the selected branch");
assert(registerRouteSource.includes("withServerDbLock(`auth-register-phone:${phone}`"), "signup must serialize writes per normalized phone");
assert(registerRouteSource.includes("phoneAlreadyRegistered"), "signup must recheck phone uniqueness inside the lock");
assert(registerRouteSource.includes('"REGISTRATION_NOT_AVAILABLE"'), "duplicate signup must use a stable neutral error");
assert(!registerRouteSource.includes("이미 등록된 휴대폰 번호입니다."), "signup must not enumerate existing phone numbers");
assert(!registerRouteSource.includes("after: { phone"), "signup audit metadata must not retain raw phone numbers");
assert(registerRouteSource.includes("createRandomPasswordHash"), "signup must persist a password hash");
assert(registerRouteSource.includes('role: "member"'), "public signup must create member accounts only");
assert(registerRouteSource.includes("memberIds: [memberId]"), "public signup must link the user and member profile");

assert(!registerRouteSource.includes('action: "request"'), "signup must not expose the deferred verification request action");
assert(!registerRouteSource.includes('action: "complete"'), "signup must use one direct registration request");
assert(!registerRouteSource.includes("createPhoneSignupChallenge"), "signup must not create deferred verification challenges");
assert(!registerRouteSource.includes("verifyPhoneSignupCode"), "signup must not require a deferred verification code");
assert(!registerRouteSource.includes("SIGNUP_SMS_NOT_CONFIGURED"), "signup must not depend on SMS configuration");

assert(signupScreenSource.includes('data-testid="signup-phone-input"'));
assert(signupScreenSource.includes('data-testid="signup-submit-button"'));
assert(!signupScreenSource.includes('data-testid="signup-code-request-button"'));
assert(!signupScreenSource.includes('data-testid="signup-code-input"'));
assert(!signupScreenSource.includes("requestSignupVerificationCode"));
assert(apiClientSource.includes("registerWithPhone(payload: PhoneSignupPayload)"));
assert(!apiClientSource.includes("requestSignupVerificationCode"));

console.log(JSON.stringify({
  ok: true,
  checked: [
    "direct signup validates bounded typed inputs and eligible branches",
    "per-phone locking and in-lock uniqueness prevent duplicate accounts",
    "duplicate responses do not disclose registered phone numbers",
    "signup audit metadata omits raw phone numbers",
    "signup UI and API do not expose deferred phone verification",
    "passwords are hashed and users are linked to member profiles",
  ],
}, null, 2));
