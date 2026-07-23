import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function source(path) {
  return readFileSync(path, "utf8");
}

const privacyPage = source("src/app/(legal)/privacy/page.tsx");
const deletionPage = source("src/app/(legal)/account-deletion/page.tsx");
const signupScreen = source("src/components/screens/signup-screen.tsx");
const accountScreen = source("src/components/screens/account-screen.tsx");
const appStore = source("src/store/app-store.tsx");
const routeSmoke = source("scripts/smoke-routes.mjs");

for (const [snippet, label] of [
  ["개인정보처리방침", "privacy title"],
  ["파이널 유도 멀티짐", "service identity"],
  ["조승권", "privacy officer"],
  ["010-9297-0524", "privacy phone"],
  ["chosk88@naver.com", "privacy email"],
  ["서울특별시 강서구 등촌로 17", "operator address"],
  ["카페24", "confirmed processor"],
  ["Vercel Inc.", "deployed hosting processor"],
  ["Neon, Inc.", "deployed database processor"],
  ["이용 종료 또는 회원 탈퇴 후 2년", "general retention period"],
  ["QR 출석 스캔 시 카메라", "camera access disclosure"],
  ["카드번호, 카드 비밀번호, 주민등록번호", "non-collection disclosure"],
]) {
  assert(privacyPage.includes(snippet), `privacy page must include ${label}`);
}

for (const snippet of [
  "계정 및 데이터 삭제",
  "계정 비활성화가 아닌 영구 삭제 요청",
  "account-deletion-email-link",
  "비밀번호, 주민등록번호, 카드번호, 건강정보는 이메일에 작성하지 마세요.",
  "법령상 보관 의무가 있는",
]) {
  assert(deletionPage.includes(snippet), `account deletion page must include ${snippet}`);
}

assert(signupScreen.includes('href="/privacy"'), "signup must link to the privacy policy");
assert(accountScreen.includes('data-testid="account-privacy-policy-link"'), "account must expose the privacy policy");
assert(accountScreen.includes('data-testid="account-deletion-link"'), "account must expose account deletion");
assert(
  appStore.includes('const publicLegalPathnames = new Set(["/privacy", "/account-deletion"]);') &&
    appStore.includes("publicLegalPathnames.has(pathname)"),
  "public legal pages must not request an authenticated bootstrap without a local session",
);
assert(routeSmoke.includes('"/privacy"'), "route smoke must cover privacy");
assert(routeSmoke.includes('"/account-deletion"'), "route smoke must cover account deletion");

for (const [page, label] of [
  [privacyPage, "privacy page"],
  [deletionPage, "account deletion page"],
]) {
  assert(!/TODO|확정 필요|example\.com/i.test(page), `${label} must not expose placeholders`);
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "public privacy policy content",
    "external account deletion request path",
    "confirmed operator and processor information",
    "signup and in-app account links",
    "public legal page bootstrap suppression",
    "public route smoke coverage",
    "placeholder exclusion",
  ],
}, null, 2));
