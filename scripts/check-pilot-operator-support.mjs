import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = {
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  classesScreen: "src/components/screens/classes-screen.tsx",
  packageJson: "package.json",
  qaPlan: "docs/QA_TEST_PLAN.md",
  readme: "README.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  releaseRunner: "scripts/run-release-checks.mjs",
};

function parseReleaseCommands(source) {
  const commands = new Set();
  const tuplePattern = /\[\s*"([^"]+)"\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?\s*\]/g;
  let match = tuplePattern.exec(source);

  while (match) {
    commands.add(["npm", match[1], match[2], match[3]].filter(Boolean).join(" "));
    match = tuplePattern.exec(source);
  }

  return commands;
}

const [
  adminSettingsSource,
  classesScreenSource,
  packageJsonSource,
  qaPlanSource,
  readmeSource,
  releaseChecklistSource,
  releaseRunnerSource,
] =
  await Promise.all([
    readFile(files.adminSettings, "utf8"),
    readFile(files.classesScreen, "utf8"),
    readFile(files.packageJson, "utf8"),
    readFile(files.qaPlan, "utf8"),
    readFile(files.readme, "utf8"),
    readFile(files.releaseChecklist, "utf8"),
    readFile(files.releaseRunner, "utf8"),
  ]);

const packageJson = JSON.parse(packageJsonSource);
const releaseCommands = parseReleaseCommands(releaseRunnerSource);
const staleIosDoctorJsonPath = [".data", "ios-ipa-doctor.json"].join("/");
const staleIosDoctorMarkdownPath = [".data", "ios-ipa-doctor.md"].join("/");

const requiredAdminUiSnippets = [
  "현장 운영 관제",
  "다음 액션",
  "운영 점검 확인",
  "대기 점검 정리",
  "운영 점검은",
  "점검 상태 저장",
  "운영일 기록 입력",
  "운영 기록 입력",
  "운영 기록 저장",
  "운영 기록은",
  "운영일 누락 점검",
  "확인 운영일",
  "다음 입력 추천일",
  "누락 운영일",
  "추천일로 입력",
  "긴급 이슈 처리",
  "모바일 출석 확인 기록 점검",
  "모바일 출석 확인 기록",
  "모바일 출석 확인 누락",
  "모바일 출석 확인",
  "최종 상태 리포트",
  "운영 점검",
  "운영 확인",
  "일일 운영 확인 저장",
  "일일 운영 기록",
];

const prohibitedAdminUiSnippets = [
  "준비 확인 자료 초안",
  "준비 확인 자료와 계정 점검 초안을 만들고 빈 항목을 채웁니다.",
  "준비 항목은",
  "운영 준비 항목",
  "준비 항목 수정",
  "준비 상태 저장",
  "P1 최종 배포 준비",
  "모바일 앱 배포 상태",
  "mobileDistributionStatusCards",
  "mobile-distribution-status",
  "Android 역할 APK 산출",
  "Android 역할 APK 무결성",
  "npm run test:android-role-apks",
  "role-apks-20260617",
  "iOS 시뮬레이터 실행 성공",
  "simulator-member-dashboard-webpack.png",
  "iOS Capacitor 연결",
  "npm run test:ios-capacitor-connection",
  "iOS IPA 배포 보류",
  "iOS IPA 배포 프로필 런북",
  "docs/IOS_IPA_PROVISIONING_RUNBOOK.md",
  "npm run test:ios-provisioning-runbook",
  "iOS IPA 점검",
  "npm run ios:ipa:doctor",
  "ios-ipa-build-report.json",
  "ios-ipa-doctor.md",
  "배포 프로필",
  "UDID 원문",
  "--out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md",
  "Team ID 5GWZ792DWH",
  "등록된 iPhone",
  "시뮬레이터 성공과 IPA 배포 가능 상태를 구분",
  "필수 인수인계 리포트",
  "최종 판단 명령",
  "외부 증빙 입력 지도",
  "보류 중인 외부 준비",
  "p1-deferred-external-prep",
  "p1DeferredExternalPrep",
  "사용자 보류",
  "출시 판단은 보류",
  "운영 웹앱 주소 확정",
  "/login",
  "/app/dashboard",
  "iOS 실제 iPhone/배포 프로필",
  "배포 프로필이 0개",
  "P2 개발 착수 상태",
  "p2-internal-development-status",
  "p2DevelopmentSummaryCards",
  "p2DevelopmentTracks",
  "P1 외부 준비 대기 / P2 내부 개발 진행",
  "P1은 출시 완료가 아닙니다",
  "P2 내부 작업 목록",
  "P2 일일 운영 체크리스트",
  "p2-daily-operation-checklist",
  "p2DailyOperationChecklist",
  "추천 운영일",
  "개선 후보 분류",
  "파일럿 최종 승인 상태",
  "P1/P2 상태 분리 확인",
  "외부 준비 7개 · 사용자 보류 2개",
  "P2 진행/QA 상태판",
  "p2-progress-backlog-status",
  "p2ProgressSummaryCards",
  "p2QaReadinessChecks",
  "P2 완료 8/8",
  "P2 내부 작업 완료",
  "P2 대기 0/8",
  "P2 QA 검증 묶음",
  "P2 운영 지원 확인",
  "P2 내부 개발 가능",
  "P1 외부 준비 대기 유지",
  "파일럿 운영 실무 강화",
  "코치 모바일 업무 속도",
  "회원/학부모 경험 개선",
  "회원/학부모 내보내기 노출 금지",
  "결제/회원권 운영 고도화",
  "실 결제 연동 증빙 전 준비 상태로 표시",
  "대표/운영 리포트 고도화",
  "공지 후속 조치 개선",
  "운영/QA 상태판 강화",
  "현재 상태 스냅샷 실행 순서",
  "p1-immediate-operator-runbook",
  "p1ImmediateOperatorRunbook",
  "Android 점검 기록",
  "iOS IPA 대기 기록",
  "iOS 배포 프로필 런북 확인",
  "P1 출시 준비 감사",
  "운영 자료 갱신",
  "doctor-only",
  "일치하는 배포 프로필",
  "출시 가능 오판",
  "출시 가능 0 / 대기 7",
  "APPLE_TEAM_ID=5GWZ792DWH npm run ios:ipa:build -- --doctor-only --team-id=5GWZ792DWH --allow-provisioning-updates",
  "npm run p1:readiness -- --allow-pending --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md",
  "외부 증빙 수집 확인",
  "p1-external-evidence-queue",
  "p1ExternalEvidenceQueue",
  "draftArtifact",
  "blockedReport",
  "수집 필드",
  "먼저 실행",
  "증빙 형식 가드",
  "p1-evidence-format-guardrails",
  "p1EvidenceFormatGuardrails",
  "HTTPS URL 또는 보관 위치",
  "표준 시간 형식",
  "입력 전 값, 증빙 주소 입력 전 문구",
  "로컬/임시 주소",
  "민감 정보 미기록",
  "담당 영역",
  "p1ReadinessEvidenceLanes",
  "DevOps/총괄 PM",
  "Android/Release",
  "iOS/Release",
  "Backend/Data",
  "Frontend/QA",
  "Product Lead",
  "QA/Release",
  "운영 주소/환경",
  "APK/AAB",
  "빌드 준비/보류 사유",
  "IPA 보관/내보내기",
  "이슈 등록 URL",
  "담당자 패키지 접수 확인",
  "npm run p1:handoff-draft -- --out-dir=.data",
  "npm run p1:handoff-checklist -- --workspace=.data",
  "npm run p1:handoff-bundle -- --workspace=.data --out=.data/p1-handoff-bundle-manifest.json",
  "npm run p1:handoff-dispatch:draft -- --bundle=.data/p1-handoff-bundle-manifest.json --out=.data/p1-handoff-dispatch-receipt.json --markdown=.data/p1-handoff-dispatch-receipt.md --csv=.data/p1-handoff-dispatch-receipt.csv",
  "npm run p1:handoff-dispatch:apply-csv -- --receipt=.data/p1-handoff-dispatch-receipt.json --csv=.data/p1-handoff-dispatch-receipt.csv --out=.data/p1-handoff-dispatch-receipt.completed.json --markdown=.data/p1-handoff-dispatch-receipt.completed.md",
  "npm run p1:handoff-dispatch -- --file=.data/p1-handoff-dispatch-receipt.completed.json --bundle=.data/p1-handoff-bundle-manifest.json --out=.data/p1-handoff-dispatch-report.json",
  "npm run p1:handoff-issues:draft -- --receipt=.data/p1-handoff-dispatch-receipt.completed.json --out-dir=.data/p1-handoff-issue-drafts",
  "등록 계획",
  "실행 안내",
  "결과 입력 템플릿",
  "GitHub 등록 준비 확인",
  "npm run test:p1-github-connector-readiness -- --connector-repo-receipt=.data/p1-github-connector-access.json",
  ".data/p1-github-connector-access.json",
  "접근 권한",
  "게시 가능 상태",
  "게시 금지 상태",
  "외부 호출",
  "npm run p1:handoff-issue-receipt:connector-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --responses=.data/p1-handoff-issue-drafts/github-connector-issue-responses.json --out=.data/p1-handoff-issue-drafts/github-issue-create-results.json",
  "github-connector-issue-responses.json",
  "github-issue-create-results.csv",
  "github-issue-create-results.json",
  "npm run p1:handoff-issue-receipt:apply-results-csv -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --csv=.data/p1-handoff-issue-drafts/github-issue-create-results.csv --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md",
  "npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --results=.data/p1-handoff-issue-drafts/github-issue-create-results.json --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md",
  "npm run p1:handoff-issue-receipt:draft -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md",
  "npm run p1:handoff-issue-receipt -- --file=.data/p1-handoff-issue-registration-receipt.json --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-report.json",
  "이슈 등록 확인",
  "npm run p1:readiness -- --workspace=.data --allow-pending --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md",
  "PostgreSQL Docker 점검",
  "Postgres/Docker 점검",
  "npm run postgres:doctor -- --strict --out=.data/postgres-docker-readiness.json --markdown=.data/postgres-docker-readiness.md",
  ".data/postgres-docker-readiness.md",
  "npm run p1:operator-status -- --workspace=.data --allow-pending --out=.data/p1-operator-status.json --markdown=.data/p1-operator-status.md",
  "--external-blockers-csv=.data/p1-operator-status-external-blockers.csv",
  "npm run p1:operator-status:apply-external-blockers-csv -- --csv=.data/p1-operator-status-external-blockers.csv --json=.data/p1-operator-status.json --out=.data/p1-operator-status-external-blockers.completed.json --markdown=.data/p1-operator-status-external-blockers.completed.md",
  "npm run p1:completion-evidence -- --workspace=.data --allow-pending --out=.data/p1-completion-evidence.json --markdown=.data/p1-completion-evidence.md --csv=.data/p1-completion-evidence.csv",
  "npm run p1:completion-evidence:apply-csv -- --csv=.data/p1-completion-evidence.csv --json=.data/p1-completion-evidence.json --out=.data/p1-completion-evidence.completed.json --markdown=.data/p1-completion-evidence.completed.md",
  "p1-completion-evidence.csv",
  "p1-operator-status-external-blockers.completed.json",
  "p1-completion-evidence.completed.json",
  "P1 완료 기준 10개",
  "완료 기준 증거 매트릭스",
  "외부 준비 입력 적용",
  "완료 기준 입력 적용",
  "p1-operator-status-external-blockers.csv",
  "대표 진행 보고서",
  "docs/P1_OWNER_PROGRESS_REPORT.md",
  "npm run test:owner-progress-report",
  "대표 진행 보고서 초안",
  "npm run owner:progress-report:draft",
  "npm run test:owner-progress-report-draft",
  ".data/p1-owner-progress-report.md",
  "대표 공유 패키지",
  "npm run owner:briefing-package",
  "npm run test:owner-briefing-package",
  ".data/p1-owner-briefing-package.json",
  ".data/p1-owner-briefing-package.md",
  "운영자 상태판",
  "Android/iOS 점검 결과",
  "참고 산출물",
  ".data/android-twa-doctor.md",
  "iOS 점검 결과",
  ".data/mobile-builds/ios/ios-ipa-doctor.md",
  "Android/iOS 점검 산출물",
  "프로필 확인 기록",
  "UDID 원문",
  "운영 주소/릴리즈 서명/실제 iPhone 배포 프로필",
  "externalBlockers",
  "담당자, 증빙 주소, 확인 시각, 승인 열",
  "증빙 주소/승인",
  "외부 준비 항목",
  "GitHub 등록 준비",
  "접근 권한",
  "대표 의사결정 등록표",
  "릴리즈 보관 상태",
  "선행 조건 안내",
  "P1 출시 준비나 증빙 접수가 대기 상태이면",
  "게시 가능 상태",
  "릴리즈 보관 상태",
  "npm run p1:readiness -- --workspace=.data --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md",
  "npm run p1:release-package -- --workspace=.data --out=.data/p1-release-package.json",
  "npm run test:p1-handoff-bundle",
  "npm run test:p1-handoff-dispatch",
  "npm run test:p1-handoff-dispatch-apply-csv",
  "npm run test:p1-handoff-issues",
  "npm run test:p1-handoff-issue-receipt",
  "npm run test:p1-release-package",
  ".data/deployment-handoff.report.json",
  ".data/android-release-handoff.report.json",
  ".data/mobile-builds/ios/ios-ipa-build-report.json",
  ".data/payment-provider-handoff.report.json",
  ".data/notification-push-handoff.report.json",
  ".data/p1-handoff-issue-registration-report.json",
  "운영 푸시",
  "npm run pilot:prelaunch-draft -- --out-dir=.data",
  "npm run pilot:status -- --strict --out=.data/pilot-status.json",
  "지점별 중복 로그",
  "확인 로그",
  "운영 로그 입력",
  "운영 로그 저장",
  "아직 기록된 운영 로그가 없습니다.",
  "고유 운영일",
];

const requiredCoachMobileSpeedSnippets = [
  "coach-mobile-speed-panel",
  "coach-mobile-speed-unchecked-action",
  "coach-mobile-speed-reason-action",
  "coach-mobile-speed-attention-action",
  "coach-mobile-speed-reset-action",
  "빠른 조치",
  "사유 입력 대상 보기",
  "주의 회원 찾기",
  "수업 진행",
  "수업 전",
  "수업 후",
  "isCoachVisibleCounselingNote",
];

const coachMobileSpeedPanelStart = classesScreenSource.indexOf('data-testid="coach-mobile-speed-panel"');
const coachMobileSpeedPanelEnd = classesScreenSource.indexOf('data-testid="coach-field-flow-panel"', coachMobileSpeedPanelStart);
assert.notEqual(coachMobileSpeedPanelStart, -1, "/app/classes coach mobile speed panel must exist");
assert.notEqual(coachMobileSpeedPanelEnd, -1, "/app/classes coach mobile speed panel must be followed by the compact coach flow panel");
const coachMobileSpeedPanelSource = classesScreenSource.slice(coachMobileSpeedPanelStart, coachMobileSpeedPanelEnd);

for (const snippet of requiredAdminUiSnippets) {
  assert(adminSettingsSource.includes(snippet), `/app/admin/settings pilot operator support is missing ${snippet}`);
}

for (const snippet of prohibitedAdminUiSnippets) {
  assert(!adminSettingsSource.includes(snippet), `/app/admin/settings must not expose internal or log-jargon operator copy: ${snippet}`);
}

for (const snippet of requiredCoachMobileSpeedSnippets) {
  assert(classesScreenSource.includes(snippet), `/app/classes coach mobile speed panel is missing ${snippet}`);
}

for (const snippet of ["결제 금액 비노출 유지", "코치 모바일 bootstrap 결제 레코드 비노출", "코치 화면 금액 미노출"]) {
  assert(!coachMobileSpeedPanelSource.includes(snippet), `/app/classes coach mobile speed panel must not expose internal policy copy: ${snippet}`);
}

assert(!classesScreenSource.includes("formatCurrency"), "/app/classes coach screen must not format or expose payment amounts");

assert.equal(
  packageJson.scripts["test:pilot-operator-support"],
  "node scripts/check-pilot-operator-support.mjs",
  "package.json must expose test:pilot-operator-support",
);
assert.equal(
  packageJson.scripts["postgres:doctor"],
  "node scripts/check-postgres-docker-readiness.mjs",
  "package.json must expose postgres:doctor",
);
assert.equal(
  packageJson.scripts["test:postgres-doctor"],
  "node scripts/check-postgres-docker-readiness-test.mjs",
  "package.json must expose test:postgres-doctor",
);

assert(
  releaseCommands.has("npm run test:pilot-operator-support"),
  "test:release must run npm run test:pilot-operator-support",
);

const requiredReleaseGateDocSnippets = [
  "npm run test:pilot-operator-support",
  "현장 운영 관제",
  "P1 최종 배포 준비",
  "외부 증빙 수집 확인",
  "증빙 형식 가드",
  ".data/android-twa-doctor.md",
  ".data/mobile-builds/ios/ios-ipa-doctor.json",
  ".data/mobile-builds/ios/ios-ipa-doctor.md",
  "docs/IOS_IPA_PROVISIONING_RUNBOOK.md",
  "test:ios-provisioning-runbook",
  "externalBlockers",
  "github-connector-runbook.md",
  "GitHub Connector 섹션",
  "Release Custody 섹션",
  "release custody prerequisite",
  "p1:operator-status:apply-external-blockers-csv",
  "test:p1-operator-status-apply-external-blockers-csv",
  "p1:completion-evidence",
  "p1:completion-evidence:apply-csv",
  "test:p1-completion-evidence",
  "test:p1-completion-evidence-apply-csv",
  "postgres:doctor",
  "test:postgres-doctor",
  "test:owner-progress-report",
  "test:owner-progress-report-draft",
  "test:owner-briefing-package",
  ".data/postgres-docker-readiness.md",
  "모바일 앱 배포 상태",
  "Simulator 성공과 IPA 배포 가능 상태",
  "Local Profile Inventory",
  "등록 기기 포함 profile 수",
  "UDID 원문",
  "matching provisioning profile",
  "보류 중인 외부 준비",
  "사용자 보류",
  "출시 판단은 보류",
  "P2 개발 착수 상태",
  "P1 external-blocked / P2 development open",
  "P2 내부 작업 목록",
  "P2 일일 운영 체크리스트",
  "추천 운영일",
  "개선 후보",
  "파일럿 최종 승인 상태",
  "P2 진행/QA 상태판",
  "P2 완료 8/8",
  "P2 내부 작업 완료",
  "P2 QA 검증 묶음",
  "회원/학부모 CSV 내보내기 노출 금지",
];

for (const [label, source] of [
  ["README", readmeSource],
  ["QA plan", qaPlanSource],
  ["release checklist", releaseChecklistSource],
]) {
  for (const snippet of requiredReleaseGateDocSnippets) {
    assert(source.includes(snippet), `${label} must document pilot operator support release gate snippet: ${snippet}`);
  }
}

assert(
  readmeSource.includes("총 7개 externalBlockers row"),
  "README must document the seven external blocker CSV rows including iOS IPA.",
);
assert(
  qaPlanSource.includes("7개 externalBlockers CSV row"),
  "QA plan must document the seven external blocker CSV rows including iOS IPA.",
);
assert(
  releaseChecklistSource.includes("7개 row"),
  "Release checklist must document the seven external blocker CSV rows including iOS IPA.",
);
assert(
  !readmeSource.includes(staleIosDoctorJsonPath) && !readmeSource.includes(staleIosDoctorMarkdownPath),
  "README must not document stale root-level iOS IPA doctor artifact paths.",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "admin settings exposes pilot operator support panel",
        "admin settings keeps internal release and handoff copy out of the app screen",
        "admin settings derives prioritized next actions",
        "admin settings keeps mobile attendance evidence visible",
        "admin settings uses operation record wording instead of log jargon",
        "package script exists",
        "test:release includes pilot operator support check",
        "README/QA/release checklist document pilot and P1 operator status gates",
      ],
    },
    null,
    2,
  ),
);
