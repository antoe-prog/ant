import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const promptPath = "docs/TEAM_AGENT_PROMPTS.md";
const source = readFileSync(promptPath, "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");
const readme = readFileSync("README.md", "utf8");
const qaPlan = readFileSync("docs/QA_TEST_PLAN.md", "utf8");
const releaseChecklist = readFileSync("docs/RELEASE_CHECKLIST.md", "utf8");

const requiredSnippets = [
  "파이널 유도 멀티짐 P1 6인 팀 에이전트 목표 프롬프트",
  "P0 MVP 개발은 완료된 상태",
  "P1은 P0를 다시 만드는 작업이 아니다",
  "회원/학부모 CSV 내보내기 비노출",
  "Android 역할별 APK 4개",
  ".data/mobile-builds/role-apks-20260617",
  "artifact ready, release handoff blocked",
  "iOS Capacitor 프로젝트와 Simulator 연결은 성공",
  "simulator connected, IPA release blocked",
  "Team ID: `5GWZ792DWH`",
  "bundle id: `kr.co.finaljudo.multigym`",
  "실제 iPhone UDID 등록",
  "matching provisioning profile",
  "Product Lead",
  "UX/IA",
  "UI/Design System",
  "Frontend",
  "Backend/Data",
  "QA/Release",
  "운영 배포 URL/배포 handoff",
  "Android 릴리즈 handoff",
  "iOS 실제 기기 등록 및 provisioning profile",
  "결제 PG/상점 ID handoff",
  "푸시 알림 provider handoff",
  "이슈 등록 접수/ack 증빙",
  "파일럿 최종 승인 상태",
  "npm run lint",
  "npm run build",
  "npm run test:unit",
  "npm run test:role-csv-export-gates",
  "npm run test:store",
  "npm run test:qa-plan",
  "npm run test:release-docs",
  "npm run test:implementation-backlog",
  "npm run test:team-agent-prompts",
  "npm run test:admin-settings-gates",
  "npm run test:pilot-operator-support",
  "npm run android:twa:doctor",
  "npm run ios:ipa:doctor",
  "npm run test:ios-provisioning-runbook",
  "npm run p1:readiness",
  "docs/IOS_IPA_PROVISIONING_RUNBOOK.md",
  "FINAL_JUDO_IOS_SERVER_URL",
  "iOS IPA는 Simulator 성공만으로 ready 처리하지 않는다",
  "실제 iPhone 등록 및 provisioning profile 확인 전까지 iOS IPA 배포 ready로 판단하지 않는다",
  "현재 상태:",
  "P1 완료로 선언하지 말아야 하는 외부 blocker",
];

const staleSnippets = [
  "가장 앞선 P0 작업부터 직접 구현",
  "P0 작업을 순서대로 쪼갠다",
  "현재 프로토타입을 최종 IA",
  "PM이 문서만 보고 남은 P0 작업을 알 수 있음",
  "보강 요청 확인",
];

for (const snippet of requiredSnippets) {
  assert(source.includes(snippet), `${promptPath} is missing required P1 prompt snippet: ${snippet}`);
}

for (const snippet of staleSnippets) {
  assert(!source.includes(snippet), `${promptPath} still contains stale P0-first prompt snippet: ${snippet}`);
}

assert.equal(
  packageJson.scripts["test:team-agent-prompts"],
  "node scripts/check-team-agent-prompts.mjs",
  "package.json must expose test:team-agent-prompts",
);
assert(
  releaseRunner.includes('["run", "test:team-agent-prompts"]'),
  "test:release must run npm run test:team-agent-prompts",
);

for (const document of [readme, qaPlan, releaseChecklist]) {
  assert(document.includes("npm run test:team-agent-prompts"), "release docs must mention test:team-agent-prompts");
  assert(document.includes("docs/TEAM_AGENT_PROMPTS.md"), "release docs must mention docs/TEAM_AGENT_PROMPTS.md");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "P1 6-person team agent prompt is current",
        "P0-first stale prompt language is absent",
        "Android APK artifact and iOS Simulator/IPA release separation are documented",
        "external blocker list prevents premature P1 completion claims",
        "release runner and docs reference the prompt drift check",
      ],
    },
    null,
    2,
  ),
);
