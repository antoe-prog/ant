import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const files = {
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  packageJson: "package.json",
  implementationBacklog: "docs/IMPLEMENTATION_BACKLOG.md",
  qaPlan: "docs/QA_TEST_PLAN.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  readme: "README.md",
  p1Readiness: ".data/p1-readiness.json",
  iosCapacitorConnection: ".data/mobile-builds/ios/ios-capacitor-connection.json",
  iosIpaDoctor: ".data/mobile-builds/ios/ios-ipa-doctor.json",
};

const screenshotFiles = [
  ".data/mobile-builds/ios/p4-simulator-screenshots/admin-dashboard.jpg",
  ".data/mobile-builds/ios/p4-simulator-screenshots/admin-settings-p4.jpg",
  ".data/mobile-builds/ios/p4-simulator-screenshots/coach-classes.jpg",
  ".data/mobile-builds/ios/p4-simulator-screenshots/member-dashboard.jpg",
  ".data/mobile-builds/ios/p4-simulator-screenshots/guardian-dashboard.jpg",
];

const sources = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, readFileSync(file, "utf8")]));
const packageJson = JSON.parse(sources.packageJson);
const p1Readiness = JSON.parse(sources.p1Readiness);
const iosCapacitorConnection = JSON.parse(sources.iosCapacitorConnection);
const iosIpaDoctor = JSON.parse(sources.iosIpaDoctor);

function assertIncludes(source, snippet, label) {
  assert(source.includes(snippet), `${label} must include ${snippet}`);
}

function assertExcludes(source, snippet, label) {
  assert(!source.includes(snippet), `${label} must not include ${snippet}`);
}

for (const snippet of [
  "P4 실제 사용 환경 검증 상태",
  "p4-simulator-rehearsal-status",
  "P1 외부 준비 대기 · P2/P3 내부 완료 · P4 화면 확인",
  "P4 리허설 완료, 출시 완료 아님",
  "P4 역할별 시뮬레이터 증거",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings app UI internal P4 simulator status");
}

for (const snippet of [
  "운영 확인",
  'data-testid="admin-settings-operation-header-summary"',
  'data-testid="admin-settings-operation-compact-summary"',
  "확인 운영일",
]) {
  assertIncludes(sources.adminSettings, snippet, "admin settings app-safe operating status");
}

for (const snippet of [
  "admin-dashboard.jpg",
  "admin-settings-p4.jpg",
  "coach-classes.jpg",
  "member-dashboard.jpg",
  "guardian-dashboard.jpg",
  "iOS Simulator 성공을 IPA ready로 보지 않음",
  "npm run test:p4-simulator-rehearsal",
]) {
  assertIncludes(sources.implementationBacklog, snippet, "implementation backlog P4 simulator evidence");
}

for (const document of [
  ["README", sources.readme],
  ["QA plan", sources.qaPlan],
  ["release checklist", sources.releaseChecklist],
  ["implementation backlog", sources.implementationBacklog],
]) {
  for (const snippet of [
    "P4 실제 사용 환경 검증",
    "앱 UI에는 P4 내부 상태판을 노출하지 않고",
    "npm run test:p4-simulator-rehearsal",
    ".data/mobile-builds/ios/p4-simulator-screenshots",
    "iOS Simulator 성공을 IPA ready로 보지 않음",
  ]) {
    assertIncludes(document[1], snippet, document[0]);
  }
}

assert.equal(
  packageJson.scripts?.["test:p4-simulator-rehearsal"],
  "node scripts/check-p4-simulator-rehearsal.mjs",
  "package.json must expose test:p4-simulator-rehearsal",
);

assert.equal(p1Readiness.ok, false, "P1 readiness must remain not ok during P4 simulator rehearsal");
assert.equal(p1Readiness.releaseDecision, "blocked", "P1 readiness releaseDecision must remain blocked");
assert.equal(p1Readiness.summary?.total, 7, "P1 readiness total must remain 7");
assert.equal(p1Readiness.summary?.ready, 1, "P1 readiness must include the successful iOS upload");
assert((p1Readiness.summary?.blocked ?? 0) > 0, "P1 readiness must keep unresolved external requirements blocked");
assert.equal(p1Readiness.requirements?.iosIpa?.status, "ready", "P1 readiness must keep iOS upload ready");
assert(
  !p1Readiness.blockers?.some((blocker) => blocker.key === "iosIpa"),
  "P1 readiness must not recreate the resolved iOS IPA blocker",
);

assert.equal(
  iosCapacitorConnection.releaseDecision,
  "simulator_connected_release_blocked",
  "iOS Capacitor simulator connection must stay release blocked",
);
assert.equal(iosIpaDoctor.releaseDecision, "ready", "iOS IPA doctor must reflect the App Store profile");

const ipaBlockerChecks = new Set((iosIpaDoctor.blockers ?? []).map((blocker) => blocker.check));
assert.equal(iosIpaDoctor.checks?.origin?.ok, true, "iOS IPA doctor must use the deployed web app origin");
assert.equal(
  iosIpaDoctor.checks?.origin?.value,
  "https://final-judo.vercel.app",
  "iOS IPA doctor origin must point at the deployed web app",
);
assert(!ipaBlockerChecks.has("origin"), "iOS IPA doctor must not keep stale origin blocker after deployed origin evidence");
assert.equal(ipaBlockerChecks.size, 0, "iOS IPA doctor must not keep resolved blockers");
assert(
  (iosIpaDoctor.checks?.provisioningProfile?.inventory?.matchingExportMethodProfiles ?? 0) > 0,
  "iOS IPA doctor must find an export-method-compatible provisioning profile",
);

for (const screenshotFile of screenshotFiles) {
  assert(existsSync(screenshotFile), `${screenshotFile} must exist`);
  assert(statSync(screenshotFile).size > 10_000, `${screenshotFile} must be a non-empty simulator screenshot`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "admin settings keeps internal P4 simulator status out of app UI",
        "P4 simulator screenshots for admin dashboard/admin settings/coach/member/guardian",
        "P1 readiness remains blocked while unresolved external requirements remain",
        "iOS IPA doctor recognizes the App Store distribution profile independently of simulator evidence",
        "README/QA/release/backlog P4 documentation",
      ],
      screenshots: screenshotFiles,
    },
    null,
    2,
  ),
);
