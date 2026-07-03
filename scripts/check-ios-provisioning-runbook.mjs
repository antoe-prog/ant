import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runbookPath = "docs/IOS_IPA_PROVISIONING_RUNBOOK.md";
const runbook = readFileSync(runbookPath, "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");
const readme = readFileSync("README.md", "utf8");
const qaPlan = readFileSync("docs/QA_TEST_PLAN.md", "utf8");
const releaseChecklist = readFileSync("docs/RELEASE_CHECKLIST.md", "utf8");
const teamPrompts = readFileSync("docs/TEAM_AGENT_PROMPTS.md", "utf8");

const requiredRunbookSnippets = [
  "iOS IPA 실제 기기/provisioning 런북",
  "roehf45@naver.com",
  "5GWZ792DWH",
  "kr.co.finaljudo.multigym",
  "mobile/ios/App/App.xcodeproj",
  "~/Library/MobileDevice/Provisioning Profiles",
  "FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin>",
  "API 전용 origin은 앱 화면 origin으로 인정하지 않는다",
  "--allow-api-origin-webapp",
  "Apple Developer",
  "실제 iPhone UDID",
  "UDID 원문은 git, 문서, `.data` report, 채팅 요약에 기록하지 않는다",
  "matching provisioning profile",
  "Download Manual Profiles",
  ".mobileprovision",
  ".data/mobile-builds/ios/ios-ipa-doctor.json",
  ".data/mobile-builds/ios/ios-ipa-doctor.md",
  ".data/mobile-builds/ios/ios-ipa-build-report.json",
  "npm run ios:ipa:doctor",
  "npm run ios:ipa:build",
  "npm run p1:operator-status",
  "npm run p1:completion-evidence",
  "npm run p1:readiness",
  "Simulator에서 앱 실행이 성공했어도 IPA ready가 아니다",
];

for (const snippet of requiredRunbookSnippets) {
  assert(runbook.includes(snippet), `${runbookPath} is missing required snippet: ${snippet}`);
}

assert(
  !/FINAL_JUDO_IOS_SERVER_URL=http:\/\//.test(runbook),
  `${runbookPath} must not suggest a non-HTTPS web app origin`,
);
assert(
  !/[0-9a-f]{40}/i.test(runbook),
  `${runbookPath} must not contain a raw iPhone UDID-like value`,
);

assert.equal(
  packageJson.scripts["test:ios-provisioning-runbook"],
  "node scripts/check-ios-provisioning-runbook.mjs",
  "package.json must expose test:ios-provisioning-runbook",
);

const doctorIndex = releaseRunner.indexOf('["run", "ios:ipa:doctor"]');
const runbookIndex = releaseRunner.indexOf('["run", "test:ios-provisioning-runbook"]');
assert(doctorIndex >= 0, "test:release must include npm run ios:ipa:doctor");
assert(runbookIndex > doctorIndex, "test:release must run test:ios-provisioning-runbook after ios:ipa:doctor");

const requiredDocSnippets = [
  runbookPath,
  "npm run test:ios-provisioning-runbook",
  "FINAL_JUDO_IOS_SERVER_URL",
  "5GWZ792DWH",
  "kr.co.finaljudo.multigym",
];

for (const [path, content] of [
  ["README.md", readme],
  ["docs/QA_TEST_PLAN.md", qaPlan],
  ["docs/RELEASE_CHECKLIST.md", releaseChecklist],
  ["docs/TEAM_AGENT_PROMPTS.md", teamPrompts],
]) {
  for (const snippet of requiredDocSnippets) {
    assert(content.includes(snippet), `${path} is missing iOS provisioning runbook snippet: ${snippet}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        runbookPath,
        "iOS real device and provisioning runbook references current Team ID/bundle id",
        "runbook requires HTTPS web app origin and avoids raw UDID storage",
        "runbook separates API base URL from web app origin",
        "release runner runs test:ios-provisioning-runbook after ios:ipa:doctor",
        "README/QA/release/team prompt docs reference the runbook gate",
      ],
    },
    null,
    2,
  ),
);
