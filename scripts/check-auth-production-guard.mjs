import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canUseDemoRoleLogin,
  createExpiredSessionCookieOptions,
  createSessionCookieOptions,
  rememberedSessionMaxAgeSeconds,
  standardSessionMaxAgeSeconds,
} from "../src/server/auth-policy.ts";
import { defaultPilotPassword, defaultPilotPasswordHash, verifyPassword } from "../src/server/auth-password.ts";

const demoLoginCases = [
  {
    env: { NODE_ENV: "development" },
    expected: true,
    label: "development allows demo role login",
  },
  {
    env: { NODE_ENV: "test" },
    expected: true,
    label: "test allows demo role login",
  },
  {
    env: { NODE_ENV: "production" },
    expected: false,
    label: "production blocks demo role login by default",
  },
  {
    env: { NODE_ENV: "production", FINAL_JUDO_ENABLE_DEMO_LOGIN: "1" },
    expected: true,
    label: "production allows demo role login with final-judo override",
  },
  {
    env: { NODE_ENV: "production", FINAL_JUDO_ENABLE_DEMO_LOGIN: "true" },
    expected: true,
    label: "production accepts true demo override",
  },
  {
    env: { NODE_ENV: "production", ENABLE_DEMO_LOGIN: "1" },
    expected: true,
    label: "production keeps legacy demo override compatibility",
  },
  {
    env: { NODE_ENV: "production", FINAL_JUDO_ENABLE_DEMO_LOGIN: "0", ENABLE_DEMO_LOGIN: "0" },
    expected: false,
    label: "production rejects disabled demo override values",
  },
];

for (const testCase of demoLoginCases) {
  assert.equal(canUseDemoRoleLogin(testCase.env), testCase.expected, testCase.label);
}

const developmentCookie = createSessionCookieOptions({ NODE_ENV: "development" });
const productionCookie = createSessionCookieOptions({ NODE_ENV: "production" });
const rememberedProductionCookie = createSessionCookieOptions({ NODE_ENV: "production" }, { keepSignedIn: true });
const expiredProductionCookie = createExpiredSessionCookieOptions({ NODE_ENV: "production" });

assert.equal(developmentCookie.httpOnly, true, "development session cookie must be httpOnly");
assert.equal(developmentCookie.sameSite, "lax", "development session cookie must use lax sameSite");
assert.equal(developmentCookie.secure, false, "development session cookie must not require HTTPS");
assert.equal(productionCookie.httpOnly, true, "production session cookie must be httpOnly");
assert.equal(productionCookie.sameSite, "lax", "production session cookie must use lax sameSite");
assert.equal(productionCookie.secure, true, "production session cookie must require HTTPS");
assert.equal(productionCookie.maxAge, standardSessionMaxAgeSeconds, "standard session cookie must expire after eight hours");
assert.equal(
  rememberedProductionCookie.maxAge,
  rememberedSessionMaxAgeSeconds,
  "remembered session cookie must stay signed in for thirty days",
);
assert.equal(expiredProductionCookie.secure, true, "expired production cookie must keep secure flag");
assert.equal(expiredProductionCookie.maxAge, 0, "expired session cookie must clear immediately");
assert.equal(defaultPilotPassword, "FinalJudoPilot!2026", "default pilot password contract must match smoke/docs");
assert.equal(verifyPassword(defaultPilotPassword, defaultPilotPasswordHash), true, "default pilot password must verify");
assert.equal(verifyPassword("wrong-password", defaultPilotPasswordHash), false, "wrong password must not verify");

const signupScreenSource = readFileSync("src/components/screens/signup-screen.tsx", "utf8");
const publicRegisterRouteSource = readFileSync("src/app/api/v1/auth/register/route.ts", "utf8");
const inviteAcceptRouteSource = readFileSync("src/app/api/v1/auth/invitations/[token]/accept/route.ts", "utf8");
const inviteAcceptScreenSource = readFileSync("src/components/screens/invite-accept-screen.tsx", "utf8");
const inviteApproveRouteSource = readFileSync("src/app/api/v1/admin/users/[userId]/approve-invitation/route.ts", "utf8");
const adminUsersScreenSource = readFileSync("src/components/screens/admin-users-screen.tsx", "utf8");
const mockDataSource = readFileSync("src/lib/mock-data.ts", "utf8");
const serverDbSource = readFileSync("src/server/db.ts", "utf8");
const loginScreenSource = readFileSync("src/components/screens/login-screen.tsx", "utf8");
const selectRoleScreenSource = readFileSync("src/components/screens/select-role-screen.tsx", "utf8");
const loginRouteSource = readFileSync("src/app/api/v1/auth/login/route.ts", "utf8");
const bootstrapRouteSource = readFileSync("src/app/api/v1/me/bootstrap/route.ts", "utf8");
const appStoreSource = readFileSync("src/store/app-store.tsx", "utf8");
const apiClientSource = readFileSync("src/lib/api-client.ts", "utf8");
const serverApiSource = readFileSync("src/server/api.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

assert(signupScreenSource.includes("휴대폰 번호로 회원가입"), "signup must render the phone signup heading");
assert(signupScreenSource.includes('data-testid="signup-phone-input"'), "signup must collect a phone number");
assert(signupScreenSource.includes('data-testid="signup-password-input"'), "signup must collect a password");
assert(signupScreenSource.includes('data-testid="signup-password-confirm-input"'), "signup must confirm the password");
assert(signupScreenSource.includes("apiClient.registerWithPhone"), "signup must submit through the phone registration API");
assert(!signupScreenSource.includes("초대 링크로 회원가입"), "signup must not regress to invitation-link entry");
assert(!signupScreenSource.includes("signup-invitation-input"), "signup must not render the invitation input");
assert(!signupScreenSource.includes("router.push(`/invite/"), "signup must not route phone signup through invite accept");
assert(!signupScreenSource.includes("010-0000-0000"), "signup must not expose dummy phone placeholders");
assert(publicRegisterRouteSource.includes("request.json()"), "public register route must parse phone signup payloads");
assert(publicRegisterRouteSource.includes("writeServerDb"), "public register route must persist the phone signup account");
assert(publicRegisterRouteSource.includes("isValidKoreanMobileNumber"), "public register route must validate Korean mobile numbers");
assert(publicRegisterRouteSource.includes("samePhoneNumber"), "public register route must block duplicate phone numbers");
assert(publicRegisterRouteSource.includes("createRandomPasswordHash"), "public register route must store a password hash");
assert(publicRegisterRouteSource.includes('role: "member"'), "public register route must create member accounts only");
assert(publicRegisterRouteSource.includes("memberIds: [memberId]"), "public register route must link the user to a member profile");
assert(!publicRegisterRouteSource.includes("INVITATION_REQUIRED"), "public register route must not reject all phone signups as invitation-only");
assert(inviteAcceptRouteSource.includes("password.length < 12"), "invitation accept API must require a 12+ character password");
assert(inviteAcceptScreenSource.includes("minLength={12}"), "invitation accept form must enforce a 12+ character password hint");
assert(
  inviteAcceptScreenSource.includes("const result = await acceptInvitation(token, password);") &&
    inviteAcceptScreenSource.includes("setError(result.message);"),
  "invitation accept form must display the API user-facing failure message",
);
assert(
  !inviteAcceptScreenSource.includes("초대 링크를 확인하지 못했습니다. 링크가 만료되었거나 이미 삭제되었을 수 있습니다."),
  "invitation accept form must not overwrite specific API failure messages with a generic stale-link message",
);
assert(
  loginScreenSource.includes("회원가입이 완료되었습니다. 휴대폰 번호와 비밀번호로 로그인해 주세요."),
  "registered login notice must tell phone signup users to use their phone number and password",
);
assert(
  appStoreSource.includes('const publicAuthPathnames = new Set(["/signup", "/reset-password"]);') &&
    appStoreSource.includes("an app restart with only the HttpOnly session cookie can show account switch UI") &&
    appStoreSource.includes("apiClient.getOptionalBootstrap(null)"),
  "login/select-role must silently restore HttpOnly cookie sessions even without localStorage",
);
assert(
  bootstrapRouteSource.includes('request.nextUrl.searchParams.get("optional") === "1"') &&
    bootstrapRouteSource.includes("return jsonOk(null);"),
  "optional bootstrap must return a 200/null response instead of a 401 for anonymous auth entry screens",
);
assert(apiClientSource.includes("getOptionalBootstrap"), "client API must expose optional bootstrap for cookie-only auth entry restore");
assert.equal(
  packageJson.scripts?.["test:phone-signup-login-flow"],
  "node scripts/check-phone-signup-login-flow.mjs",
  "phone signup must keep an executable same-password login regression check",
);
assert(loginScreenSource.includes('data-testid="login-keep-signed-in-checkbox"'), "login form must expose a keep-signed-in checkbox");
assert(loginScreenSource.includes("30일 동안 다시 로그인하지 않습니다."), "login form must explain the remembered session period");
assert(
  loginScreenSource.includes('data-testid="login-account-switch-button"') && loginScreenSource.includes("inline-flex min-h-11"),
  "authenticated login account switch action must keep a 44px touch target",
);
assert(
  selectRoleScreenSource.includes('data-testid="select-role-login-link"') && selectRoleScreenSource.includes("inline-flex min-h-11"),
  "select-role login link must keep a 44px touch target",
);
assert(!loginScreenSource.includes("관리자 승인 후 로그인"), "registered login notice must not imply a second admin approval step");
assert(loginRouteSource.includes("keepSignedIn?: boolean"), "login API must accept an explicit keep-signed-in flag");
assert(
  loginRouteSource.includes("shared_demo_password_blocked") &&
    loginRouteSource.includes('process.env.NODE_ENV === "production"'),
  "production credential login must reject the retired shared demo password",
);
assert(
  loginRouteSource.includes("body?.keepSignedIn === true") &&
    loginRouteSource.includes("createSessionCookieOptions(process.env, { keepSignedIn })"),
  "login API must map the keep-signed-in flag to the session cookie max-age",
);
assert(
  apiClientSource.includes("function canSendStoredUserHeader()") &&
    apiClientSource.includes('process.env.NODE_ENV !== "production"'),
  "client API must not send localStorage user ids as auth headers in production",
);
assert(
  serverApiSource.includes('process.env.NODE_ENV !== "production" ? request.headers.get("x-user-id") : null'),
  "server auth must ignore x-user-id fallback headers in production",
);
assert(
  appStoreSource.includes("type InvitationAcceptResult = { ok: true } | { ok: false; message: string }") &&
    appStoreSource.includes('const message = toUserFacingErrorMessage(error, "초대 수락을 완료하지 못했습니다.");') &&
    appStoreSource.includes("return { ok: false, message };"),
  "app store invitation accept action must return API-safe user-facing failure messages",
);
assert(inviteApproveRouteSource.includes('action: "user.invite.approve"'), "admin invitation approval API must audit approvals");
assert(
  inviteApproveRouteSource.includes("targetUser.passwordHash ? null : generateTemporaryPassword()"),
  "admin invitation approval API must issue a temporary password only when needed",
);
assert(
  serverDbSource.includes('candidate.invitationStatus === "pending"') && serverDbSource.includes("!isPendingInvitation"),
  "server DB upgrade must not assign the default pilot password to pending invitations",
);
assert(
  mockDataSource.includes("passwordHash: defaultPilotPasswordHash"),
  "seeded admin account must use the shared default pilot password hash",
);
assert(
  serverDbSource.includes("legacyAdminSeedPasswordHash") && serverDbSource.includes("hasLegacyAdminSeedPassword"),
  "server DB upgrade must replace only the known legacy seeded admin password hash",
);
assert(adminUsersScreenSource.includes('data-admin-user-action="approve-invitation"'), "admin users screen must expose invitation approval action");
assert(
  adminUsersScreenSource.includes('<span>{approvalPending ? "승인 중" : "승인"}</span>'),
  "admin users screen must visibly label invitation approval action",
);
assert(
  adminUsersScreenSource.includes("function openInvitationApprovalConfirm") &&
    adminUsersScreenSource.includes('data-admin-user-approval-confirmation="visible"') &&
    adminUsersScreenSource.includes('data-admin-user-action="confirm-approve-invitation"') &&
    adminUsersScreenSource.includes('data-admin-user-action="cancel-approve-invitation"') &&
    adminUsersScreenSource.includes('window.location.hash.slice(1).match(/^(edit|approve)-(.+)$/)'),
  "admin users screen must require a confirmation step before approving invitations",
);
assert(
  adminUsersScreenSource.includes("function sortUsersForInvitationReview") &&
    adminUsersScreenSource.includes("return [...pendingUsers, ...activeUsers]"),
  "admin users screen must surface pending invitations before active users",
);
assert(
  adminUsersScreenSource.includes('data-admin-user-invitation-status={user.invitationStatus ?? "accepted"}'),
  "admin users screen must expose invitation status on each list row",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        ...demoLoginCases.map((testCase) => testCase.label),
        "development session cookie flags",
        "production session cookie flags",
        "remembered production session cookie flags",
        "expired session cookie flags",
        "default pilot password hash verification",
        "public signup uses phone number and password",
        "public register API creates a member account with password hash",
        "invitation accept password length policy",
        "invitation accept API failure messages reach the form",
        "registered login notice uses phone/password copy",
        "login/select-role restore cookie-only sessions",
        "login keep-signed-in checkbox and 30-day cookie policy",
        "authenticated login and select-role account navigation touch targets",
        "production auth ignores localStorage user-id fallback headers",
        "admin invitation approval action",
        "visible admin invitation approval label",
        "confirmation step before admin invitation approval",
        "pending invitations are listed before active users",
        "pending invitations avoid default pilot password upgrade",
        "seeded admin account shares the default pilot password hash contract",
        "legacy seeded admin password hash upgrade",
      ],
    },
    null,
    2,
  ),
);
