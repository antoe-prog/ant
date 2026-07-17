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
  "파이널 유도 멀티짐 11팀 하위 에이전트 운영 프롬프트",
  "전체 하위 에이전트 정원은 60명",
  "1팀 제품·아키텍처",
  "2팀 인증·권한",
  "3팀 회원·학부모",
  "4팀 수업·성장",
  "5팀 결제·회비",
  "6팀 공지·알림",
  "7팀 프론트엔드 UX",
  "8팀 데이터·백엔드",
  "9팀 QA·보안",
  "10팀 모바일·릴리즈",
  "11팀 유도장 현장 운영",
  "기본값은 주 에이전트 단독 수행",
  "사전 승인을 받기 전에는 하위 에이전트를 생성·추가·재개하지 않는다",
  "과거 승인, 팀 정원, 복합 작업이라는 사실만으로 승인을 추정하지 않는다",
  "자동 투입 권한이 아니다",
  "O1 | 관장 운영 담당",
  "O10 | 현장 QA·파일럿 담당",
  "실제로 사용 가능한 에이전트와 독립 작업이 있을 때만 투입",
  "일반 작업은 관련 팀 2~4개만 활성화",
  "기능명이 아니라 실제 업무를 끝낼 수 있는지",
  "실제 메시지 발송, 결제·환불, 운영 데이터와 개인정보 변경은 명시적 승인 없이 수행하지 않는다",
  "기존 P1 릴리즈 인계 6개 전문 lane",
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
        "11-team 60-agent responsibility model is current",
        "sub-agent creation requires fresh explicit user approval",
        "10-person dojo operations team and field acceptance boundaries are documented",
        "legacy P1 six-lane release handoff compatibility is preserved",
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
