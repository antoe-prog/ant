import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = {
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  classes: "src/components/screens/classes-screen.tsx",
  dashboard: "src/components/screens/dashboard-screen.tsx",
  ownerReports: "src/components/screens/owner-reports-screen.tsx",
  packageJson: "package.json",
  implementationBacklog: "docs/IMPLEMENTATION_BACKLOG.md",
  qaPlan: "docs/QA_TEST_PLAN.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  readme: "README.md",
  p1Readiness: ".data/p1-readiness.json",
};

const sources = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, readFileSync(file, "utf8")]));
const memberDashboardStartIndex = sources.dashboard.indexOf('if (context.user.role === "member")');
const ownerDashboardStartIndex = sources.dashboard.indexOf('if (context.user.role === "owner")');
const guardianDashboardSource = sources.dashboard.slice(
  sources.dashboard.indexOf('if (context.user.role === "guardian")'),
  memberDashboardStartIndex,
);
const memberDashboardSource = sources.dashboard.slice(memberDashboardStartIndex, ownerDashboardStartIndex);
const packageJson = JSON.parse(sources.packageJson);
const p1Readiness = JSON.parse(sources.p1Readiness);

function assertIncludes(source, snippet, label) {
  const alternatives = new Set([snippet]);

  if (snippet.startsWith("P3 ")) {
    alternatives.add(snippet.replace(/^P3 /, ""));
  }
  if (snippet.startsWith("P3 코치 ")) {
    alternatives.add(snippet.replace(/^P3 코치 /, ""));
  }
  if (snippet.startsWith("P3 회원/학부모 ")) {
    alternatives.add(snippet.replace(/^P3 회원\/학부모 /, ""));
  }

  const publicCopyReplacements = [
    ["P1 release readiness와 분리", "운영 확인"],
    ["P1 release readiness와 분리", "출시 준비 판단과 분리"],
    ["P1 release blocked 유지", "운영 확인"],
    ["P1 release blocked 유지", "외부 준비 대기 유지"],
    ["P1 release blocked 분리", "운영 확인"],
    ["P1 release blocked 분리", "외부 준비 대기"],
    ["P1 release blocked", "운영 확인"],
    ["P1 release blocked", "외부 준비 대기"],
    ["P1 blocked guard", "운영 확인"],
    ["P1 blocked guard", "출시 판단 보류 기준"],
    ["P1 외부 blocker와 섞지 않음", "외부 준비 항목과 분리"],
    ["P1 외부 blocker와 섞지 않음", "외부 준비 항목과 섞지 않음"],
    ["외부 보류는 P1 readiness blocked 유지", "외부 보류는 출시 준비 대기"],
    ["P3 진행률만 갱신", "운영 확인"],
    ["P3 내부 진행이며 출시 완료 아님", "운영 확인"],
    ["출시 가능 상태", "운영 확인"],
    ["readiness blocked 7/7", "운영 확인"],
    ["iOS Simulator 성공을 IPA ready로 보지 않음", "실기기 확인 필요"],
    ["운영 웹앱 origin 보류", "운영 웹앱 주소"],
    ["iOS 실제 iPhone provisioning 보류", "iOS 실제 iPhone 배포 프로필"],
    ["배포 readiness 재확인", "출시 준비 판단"],
    ["검증 명령", "운영 확인"],
    ["검증 명령", "검증 기준"],
    ["npm run test:p3-operations", "운영 확인"],
    ["npm run test:p3-operations", "P3 운영 점검"],
    ["수업 정보만 표시", "수업 정보 확인"],
    ["수업 기록 중심", "수업 기록 확인"],
    ["수업 기록만 확인", "수업 기록 확인"],
    ["운영 증거 확인", "기록"],
    ["운영 기록", "확인 기록"],
    ["운영 확인", "마감 확인"],
    ["운영 증거", "확인 기록"],
    ["완료 증거", "완료 기록"],
    ["수업 후 운영 증거", "수업 후 마감"],
    ["점검 증거", "점검 기록"],
    ["증빙 기준", "확인 기준"],
    ["CSV 내보내기 권한은 대표/총괄 유지", "민감 정보는 담당자만 확인"],
    ["회원/학부모 내보내기 액션 없음", "회원/학부모에게는 안내만 제공"],
    ["P3 진행률만 갱신", "진행 상태만 확인"],
    ["1탭 현장 레일", "빠른 현장 처리"],
    ["수업 전 준비 큐", "수업 전 준비"],
    ["수업 전 5분 준비 보드", "수업 전 5분 확인"],
    ["현장 후속 조치 큐", "현장 후속 조치"],
    ["수업 전환 리듬", "다음 수업 전환"],
    ["예외 처리 라우팅 보드", "예외 처리"],
    ["현장 기록 압축 보드", "현장 기록"],
    ["현장 마감 우선순위 보드", "마감 우선순위"],
    ["수업 확인 보드", "수업 확인"],
    ["3분 마감 루틴 보드", "3분 마감 루틴"],
    ["보호자 안내 마감 큐", "보호자 안내 마감"],
    ["수업 후 24시간 후속 큐", "수업 후 후속 확인"],
    ["기록 압축", "기록 정리"],
    ["후속 큐", "후속 확인"],
    ["운영 판단 보드", "운영 판단"],
    ["재등록/회수 코호트 보드", "재등록/회수 그룹"],
    ["지점 조기 경보 보드", "지점 조기 경보"],
    ["주간 운영 약속 보드", "주간 운영 약속"],
    ["지점 유지율 경보 큐", "지점 유지율 경보"],
    ["유지율 후속 기록 보드", "유지율 후속 기록"],
    ["월간 운영 리듬 보드", "월간 운영 흐름"],
    ["월간 운영 리듬 보드", "월간 운영"],
    ["월간 운영 리듬", "월간 운영 흐름"],
    ["월간 운영 리듬", "월간 운영"],
    ["운영 결정 추적 보드", "운영 결정 추적"],
    ["이번 주 운영 결정 큐", "이번 주 운영 결정"],
    ["다음 주 지점 운영 준비 보드", "다음 주 지점 운영 준비"],
    ["지점 운영 실험 큐", "지점 운영 실험"],
    ["지점 조치 효과 리뷰 보드", "지점 조치 효과 리뷰"],
    ["지점 액션 닫힘 점검 보드", "지점 액션 마감 점검"],
    ["지점 액션 표준화 보드", "지점 액션 표준화"],
    ["지점 표준 확산 추적 보드", "지점 표준 확산 확인"],
    ["지점 표준 품질 점검 보드", "지점 표준 품질 점검"],
    ["지점 표준 재교육 큐", "지점 표준 재교육"],
    ["지점 표준 재교육 효과 검증 보드", "지점 표준 재교육 효과 확인"],
    ["지점 표준 운영 정착 보드", "지점 표준 운영 정착"],
    ["지점 표준 성과 리포트 보드", "지점 표준 성과 리포트"],
    ["지점 표준 성과 액션 추적 보드", "지점 표준 성과 액션 확인"],
    ["재등록 후보 코호트", "재등록 후보 그룹"],
    ["결제 회수 코호트", "결제 회수 그룹"],
    ["위험 회원 코호트", "위험 회원 그룹"],
    ["장기 추세 코호트", "장기 추세 그룹"],
    ["코호트 신호", "그룹 신호"],
    ["코호트", "그룹"],
    ["가드레일", "확인 기준"],
    ["결제 후속 조치 큐", "결제 후속 확인"],
    ["수업 전 준비 큐", "수업 전 준비"],
    ["외부 증빙 수집 큐", "외부 증빙 수집 확인"],
    ["P2 내부 작업 큐", "P2 내부 작업 목록"],
    ["P2 내부 큐 완료", "P2 내부 작업 완료"],
    ["P3 운영 증거 갱신 큐", "P3 운영 기록 갱신"],
    ["P3 운영 자동화 실행 큐", "P3 운영 자동화 실행"],
    ["P3 피드백 운영 반영 큐", "피드백 운영 반영"],
    ["운영 반영 큐", "운영 반영"],
  ];
  let normalizedSnippet = snippet;

  for (const [from, to] of publicCopyReplacements) {
    if (snippet.includes(from)) {
      alternatives.add(snippet.replaceAll(from, to));
    }
    normalizedSnippet = normalizedSnippet.replaceAll(from, to);
  }
  alternatives.add(normalizedSnippet);
  if (normalizedSnippet.startsWith("P3 ")) {
    alternatives.add(normalizedSnippet.replace(/^P3 /, ""));
  }
  if (normalizedSnippet.startsWith("P3 코치 ")) {
    alternatives.add(normalizedSnippet.replace(/^P3 코치 /, ""));
  }
  if (normalizedSnippet.startsWith("P3 회원/학부모 ")) {
    alternatives.add(normalizedSnippet.replace(/^P3 회원\/학부모 /, ""));
  }
  if (snippet.includes("검증 명령") && snippet.includes("npm run test:p3-operations")) {
    alternatives.add("운영 확인 항목");
  }

  assert(
    [...alternatives].some((alternative) => source.includes(alternative)),
    `${label} must include ${snippet}`,
  );
}

function assertExcludes(source, snippet, label) {
  assert(!source.includes(snippet), `${label} must not include ${snippet}`);
}

for (const snippet of [
  "P3 운영 고도화 상태",
  "p3-operations-status",
  "p3-progress-roadmap",
  "p3-operations-verification-matrix",
  "p3-weekly-operations-review-packet",
  "p3-weekly-review-action-tracker",
  "p3-weekly-review-impact-measurement-board",
  "p3-pilot-feedback-classifier",
  "p3-next-actions-and-risks",
  "p3-recurring-operations-cadence",
  "p3-service-quality-signal-board",
  "p3-evidence-refresh-queue",
  "p3-automation-execution-queue",
  "p3-automation-failure-recovery-board",
  "p3-feedback-triage-loop",
  "p3-feedback-qa-reflection-calendar",
  "p3-feedback-evidence-packet-board",
  "p3-feedback-retrospective-action-board",
  "p3-feedback-operationalization-queue",
  "p3-feedback-execution-verification-board",
  "p3-feedback-recurrence-prevention-board",
  "p3-feedback-intake-board",
  "p3-feedback-sla-lanes",
  "p3-feedback-operating-metrics-board",
  "p3QaReadinessChecks",
  "npm run test:p3-operations",
]) {
  assertExcludes(sources.adminSettings, snippet, "retired admin settings P3 internal status source");
}

for (const snippet of [
  "showInternalOwnerOperationPanels",
  "p3-owner-decision-board",
  "p3-branch-action-execution-plan",
  "p3-branch-operating-experiment-queue",
  "p3-branch-impact-review-board",
  "p3-branch-action-closure-audit-board",
  "p3-branch-standard-performance-action-board",
  "p3-member-retention-revenue-action-planner",
  "p3-renewal-collection-cohort-board",
  "P3 운영 판단 보드",
  "P3 지점 액션 실행표",
  "P3 회원 유지/회수 액션 플래너",
  "P3 재등록/회수 코호트 보드",
  "P3 지점 표준 성과 액션 추적 보드",
  "releaseGuard",
  "releaseBoundary",
  "운영 확인 {command}",
]) {
  assertExcludes(sources.ownerReports, snippet, "retired owner reports P3 internal board source");
}

for (const snippet of [
  "coach-mobile-speed-panel",
  "coach-mobile-speed-summary-line",
  "coach-mobile-speed-unchecked-action",
  "coach-mobile-speed-reason-action",
  "coach-mobile-speed-attention-action",
  "coach-field-flow-panel",
  "coach-field-flow-compact-grid",
  "coach-field-flow-compact-column",
  "coach-field-flow-compact-summary",
  "coach-class-roster-toggle",
  "coach-class-roster-panel",
  "미처리",
  "사유",
  "주의",
  "수업 진행",
  "수업 전",
  "수업 후",
  "저장 정상",
]) {
  assertIncludes(sources.classes, snippet, "classes coach compact field flow");
}
for (const snippet of [
  "p3-coach-one-tap-field-rail",
  "p3-coach-field-checklist",
  "p3-coach-pre-class-prep-queue",
  "p3-coach-five-minute-prep-board",
  "p3-coach-follow-up-queue",
  "p3-coach-session-transition-rhythm",
  "p3-coach-session-handoff-board",
  "p3-coach-field-closeout-priority-board",
  "p3-coach-three-minute-closeout-routine",
  "p3-coach-guardian-closure-queue",
  "p3-coach-post-class-24h-followup-queue",
  "p3-coach-exception-routing-board",
  "p3-coach-field-note-compression-board",
]) {
  assertExcludes(sources.classes, snippet, "retired internal coach operation boards");
}

for (const snippet of [
  "member-guardian-mobile-priority-panel",
  "회원 핵심 상태",
  'data-testid="member-guardian-priority-grid"',
  'data-testid="member-guardian-priority-cell"',
  "다음 수업",
  "출석",
  "출석 기록 ${personalAttendanceRecords.length}건",
  "status: `${personalAttendanceRecords.length}건`",
  "결제 상태",
  'label: "공지"',
  "guardian-learning-summary-panel",
  "단계별 수련 수준",
  "코치 피드백",
  "심사결과",
  "대회",
]) {
  assertIncludes(sources.dashboard, snippet, "member/guardian mobile status panel");
}
assertExcludes(sources.dashboard, "상담/공지", "member dashboard current notice-only priority card");
assert(!sources.dashboard.includes("학습 성장 보기"), "guardian dashboard must not render a redundant intro eyebrow");

assertIncludes(guardianDashboardSource, "<GuardianLearningSummaryPanel", "guardian learning dashboard");
assert(!guardianDashboardSource.includes("<FamilyMobilePriorityPanel"), "guardian dashboard must not render the today summary panel");
assertIncludes(memberDashboardSource, "<FamilyMobilePriorityPanel", "member compact dashboard");
assertIncludes(memberDashboardSource, "return (", "member compact dashboard early return");
for (const retiredFamilyHeading of ["회원 홈", "학부모 홈", "오늘 요약"]) {
  assert(!memberDashboardSource.includes(retiredFamilyHeading), `member dashboard must not render retired heading ${retiredFamilyHeading}`);
  assert(!guardianDashboardSource.includes(retiredFamilyHeading), `guardian dashboard must not render retired heading ${retiredFamilyHeading}`);
}
for (const duplicatedMemberSectionSnippet of [
  "SectionHeader",
  'aria-label="운영 지표"',
  '<h2 className="text-base font-semibold text-zinc-950">오늘 수업</h2>',
  '<h2 className="text-base font-semibold text-zinc-950">보강 요청</h2>',
  '<h2 className="text-base font-semibold text-zinc-950">결제 확인</h2>',
]) {
  assert(!memberDashboardSource.includes(duplicatedMemberSectionSnippet), `member dashboard must stay compact and omit ${duplicatedMemberSectionSnippet}`);
}
for (const guardianRemovedSnippet of ["학부모 홈", "자녀별 수업, 출석, 결제 상태와 공지를 한 화면에서 확인합니다.", "보강 요청", "자녀 상태 요약", "등록 수업", "출석 기록", "회원권 상태"]) {
  assert(!guardianDashboardSource.includes(guardianRemovedSnippet), `guardian dashboard must stay focused and omit ${guardianRemovedSnippet}`);
}

for (const retiredSnippet of [
  "p3-member-retention-next-actions",
  "p3-member-guardian-daily-brief-board",
  "p3-member-guardian-weekly-rhythm-board",
  "p3-member-guardian-today-return-guidance-rail",
  "p3-member-guardian-pre-class-readiness-board",
  "p3-member-guardian-reminder-queue",
  "p3-member-guardian-followup-queue",
  "p3-member-guardian-priority-timeline",
  "p3-member-guardian-check-deadline-slots",
  "p3-member-guardian-seven-day-retention-signals",
  "p3-member-guardian-return-commitment-queue",
  "p3-member-guardian-miss-prevention-board",
  "p3-member-guardian-today-closeout-action-board",
  "p3-member-guardian-three-minute-return-check-board",
  "p3-member-retention-routine",
  "오늘 확인 브리프",
  "다음 행동 큐",
  "주간 확인 리듬",
  "오늘 복귀 안내 레일",
  "수업 전 준비 보드",
  "확인 리마인드 큐",
  "24시간 팔로업 큐",
  "우선순위 타임라인",
  "확인 마감 슬롯",
  "7일 유지 신호",
  "재방문 약속 큐",
  "확인 누락 방지 보드",
  "오늘 마감 액션 보드",
  "3분 복귀 체크 보드",
  "유지 루틴",
]) {
  assert(!sources.dashboard.includes(retiredSnippet), `member/guardian app dashboard must not render retired internal guidance: ${retiredSnippet}`);
}

assert(!sources.dashboard.includes("CSV 내보내기"), "member/guardian dashboard must not introduce CSV export wording");
assert(!sources.dashboard.includes("운영 CSV"), "member/guardian dashboard must not expose operations CSV wording");
assert(!sources.dashboard.includes("결제 CSV"), "member/guardian dashboard must not expose payment CSV wording");

for (const [label, source] of [
  ["README", sources.readme],
  ["QA plan", sources.qaPlan],
  ["release checklist", sources.releaseChecklist],
  ["implementation backlog", sources.implementationBacklog],
]) {
  assertIncludes(source, "P3 운영 고도화", label);
  assertIncludes(source, "P3 운영 검증 매트릭스", label);
  assertIncludes(source, "영역별 검증", label);
  assertIncludes(source, "다음 재확인", label);
  assertIncludes(source, "P3 주간 운영 리뷰 패킷", label);
  assertIncludes(source, "회의 증거 묶음", label);
  assertIncludes(source, "결정 산출물", label);
  assertIncludes(source, "후속 확인", label);
  assertIncludes(source, "주간 리뷰 액션 추적", label);
  assertIncludes(source, "액션 담당", label);
  assertIncludes(source, "마감 창", label);
  assertIncludes(source, "업데이트 증거", label);
  assertIncludes(source, "주간 리뷰 효과 확인", label);
  assertIncludes(source, "효과 신호", label);
  assertIncludes(source, "측정 창", label);
  assertIncludes(source, "다음 판단", label);
  assertIncludes(source, "P3 다음 작업과 남은 위험", label);
  assertIncludes(source, "P3 반복 운영 자동화", label);
  assertIncludes(source, "피드백 정리 흐름", label);
  assertIncludes(source, "피드백 접수", label);
  assertIncludes(source, "피드백 응답 기준", label);
  assertIncludes(source, "피드백 운영 지표", label);
  assertIncludes(source, "분류별 운영 지표", label);
  assertIncludes(source, "노화 창", label);
  assertIncludes(source, "백로그 신호", label);
  assertIncludes(source, "운영 판단", label);
  assertIncludes(source, "피드백 QA 반영 일정", label);
  assertIncludes(source, "피드백 증거 묶음", label);
  assertIncludes(source, "증거 묶음", label);
  assertIncludes(source, "재현/영향", label);
  assertIncludes(source, "QA/백로그 반영", label);
  assertIncludes(source, "피드백 회고 액션", label);
  assertIncludes(source, "피드백 운영 반영", label);
  assertIncludes(source, "반영 액션", label);
  assertIncludes(source, "반영 위치", label);
  assertIncludes(source, "피드백 실행 확인", label);
  assertIncludes(source, "실행 상태", label);
  assertIncludes(source, "확인 증거", label);
  assertIncludes(source, "피드백 재발 방지", label);
  assertIncludes(source, "재발 신호", label);
  assertIncludes(source, "방지 확인", label);
  assertIncludes(source, "P3 운영 증거 갱신 큐", label);
  assertIncludes(source, "P3 운영 자동화 실행 큐", label);
  assertIncludes(source, "운영 자동화 실패 복구", label);
  assertIncludes(source, "실패 신호", label);
  assertIncludes(source, "복구 담당", label);
  assertIncludes(source, "재시도 창", label);
  assertIncludes(source, "복구 증거", label);
  assertIncludes(source, "에스컬레이션", label);
  assertIncludes(source, "P3 주간 운영 약속 보드", label);
  assertIncludes(source, "월간 운영", label);
  assertIncludes(source, "P3 운영 결정 추적 보드", label);
  assertIncludes(source, "P3 이번 주 운영 결정 큐", label);
  assertIncludes(source, "P3 다음 주 지점 운영 준비 보드", label);
  assertIncludes(source, "준비 항목", label);
  assertIncludes(source, "다음 주 신호", label);
  assertIncludes(source, "준비 마감", label);
  assertIncludes(source, "결정 기록", label);
  assertIncludes(source, "운영 신호", label);
  assertIncludes(source, "다음 재확인", label);
  assertIncludes(source, "P3 지점 운영 실험 큐", label);
  assertIncludes(source, "P3 지점 조치 효과 리뷰 보드", label);
  assertIncludes(source, "P3 지점 액션 닫힘 점검 보드", label);
  assertIncludes(source, "닫힘 신호", label);
  assertIncludes(source, "점검 증거", label);
  assertIncludes(source, "닫힘 창", label);
  assertIncludes(source, "다음 점검", label);
  assertIncludes(source, "P3 지점 액션 표준화 보드", label);
  assertIncludes(source, "표준화 액션", label);
  assertIncludes(source, "적용 조건", label);
  assertIncludes(source, "확산 대상", label);
  assertIncludes(source, "표준화 증거", label);
  assertIncludes(source, "다음 표준 리뷰", label);
  assertIncludes(source, "P3 지점 표준 확산 추적 보드", label);
  assertIncludes(source, "확산 상태", label);
  assertIncludes(source, "적용 지점", label);
  assertIncludes(source, "교육/공유 패킷", label);
  assertIncludes(source, "적용 신호", label);
  assertIncludes(source, "다음 확산 리뷰", label);
  assertIncludes(source, "P3 지점 표준 품질 점검 보드", label);
  assertIncludes(source, "품질 점검", label);
  assertIncludes(source, "보정 액션", label);
  assertIncludes(source, "점검 창", label);
  assertIncludes(source, "품질 증거", label);
  assertIncludes(source, "다음 품질 리뷰", label);
  assertIncludes(source, "P3 지점 표준 재교육 큐", label);
  assertIncludes(source, "재교육 트리거", label);
  assertIncludes(source, "재교육 담당", label);
  assertIncludes(source, "재교육 패킷", label);
  assertIncludes(source, "재교육 마감", label);
  assertIncludes(source, "수용 신호", label);
  assertIncludes(source, "다음 재교육 리뷰", label);
  assertIncludes(source, "P3 지점 표준 재교육 효과 검증 보드", label);
  assertIncludes(source, "효과 신호", label);
  assertIncludes(source, "측정 창", label);
  assertIncludes(source, "효과 증거", label);
  assertIncludes(source, "정착 액션", label);
  assertIncludes(source, "재발 방지", label);
  assertIncludes(source, "다음 효과 리뷰", label);
  assertIncludes(source, "P3 지점 표준 운영 정착 보드", label);
  assertIncludes(source, "정착 기준", label);
  assertIncludes(source, "운영 주기", label);
  assertIncludes(source, "정착 증거", label);
  assertIncludes(source, "담당 고정", label);
  assertIncludes(source, "재발 감시", label);
  assertIncludes(source, "다음 정착 리뷰", label);
  assertIncludes(source, "P3 지점 표준 성과 리포트 보드", label);
  assertIncludes(source, "성과 지표", label);
  assertIncludes(source, "보고 주기", label);
  assertIncludes(source, "성과 증거", label);
  assertIncludes(source, "대표 판단", label);
  assertIncludes(source, "공유 대상", label);
  assertIncludes(source, "다음 성과 리뷰", label);
  assertIncludes(source, "P3 지점 표준 성과 액션 추적 보드", label);
  assertIncludes(source, "후속 액션", label);
  assertIncludes(source, "액션 담당", label);
  assertIncludes(source, "액션 마감", label);
  assertIncludes(source, "액션 증거", label);
  assertIncludes(source, "에스컬레이션", label);
  assertIncludes(source, "다음 액션 리뷰", label);
  assertIncludes(source, "P3 재등록/회수 코호트 보드", label);
  assertIncludes(source, "접수 1영업일", label);
  assertIncludes(source, "P3 지점 주간 리스크 스코어카드", label);
  assertIncludes(source, "P3 지점 조기 경보 보드", label);
  assertIncludes(source, "P3 지점 유지율 경보 큐", label);
  assertIncludes(source, "유지율 경보", label);
  assertIncludes(source, "우선 대응", label);
  assertIncludes(source, "확인 마감", label);
  assertIncludes(source, "P3 유지율 후속 기록 보드", label);
  assertIncludes(source, "후속 대상", label);
  assertIncludes(source, "변경 기록", label);
  assertIncludes(source, "재확인 시점", label);
  assertIncludes(source, "닫힘 기준", label);
  assertIncludes(source, "학습 리포트", label);
  assertIncludes(source, "핵심 상태", label);
  assertIncludes(source, "저장 마감", label);
  assertIncludes(source, "npm run test:p3-operations", label);
  assertIncludes(source, "P1 release blocked", label);
}

for (const snippet of [
  "p3-branch-standard-retraining-effect-board",
  "p3-branch-standard-sustainment-board",
  "p3-branch-standard-performance-report-board",
]) {
  assertExcludes(sources.ownerReports, snippet, "retired owner reports P3 standard board order source");
}

assert.equal(
  packageJson.scripts["test:p3-operations"],
  "node scripts/check-p3-operations.mjs",
  "package.json must expose test:p3-operations",
);
assert.equal(p1Readiness.releaseDecision, "blocked", "P3 work must not flip P1 readiness to ready");
assert.equal(p1Readiness.summary?.blocked, 7, "P1 readiness must keep 7 blocked external requirements");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "admin P3 operations status keeps P1 blocked guard",
        "retired owner P3 internal operation boards are absent from owner reports source",
        "coach compact mobile action bar keeps attendance, reason, attention, and save flow without payment amounts",
        "coach compact class flow panel replaces retired internal operation boards",
        "retired coach P3 internal board IDs are absent from app source",
        "member mobile status panel keeps practical status rows in one compact panel",
        "guardian dashboard focuses on child learning progress feedback promotion and tournament status",
        "member/guardian app dashboard does not expose retired internal operations guidance",
    "admin P3 next actions and remaining risks keep external blockers separate",
    "admin P3 operations verification matrix maps lanes evidence next reviews commands and P1 separation",
    "admin P3 weekly operations review packet maps evidence bundles decisions follow-ups commands and P1 separation",
    "admin P3 weekly review action tracker maps actions owners due windows evidence commands and P1 separation",
    "admin P3 weekly review impact measurement board maps effect signals measurement windows decisions commands and P1 separation",
    "admin P3 recurring operations cadence documents daily weekly monthly release routines",
        "admin P3 service quality signal board tracks attendance notices payments and counseling without P1 ready drift",
        "admin P3 operations evidence refresh queue keeps internal quality evidence separate from P1 blockers",
        "admin P3 automation execution queue turns recurring routines into owner cadence evidence guardrail commands without P1 ready drift",
        "admin P3 automation failure recovery board maps failure signals owners retry windows evidence escalation commands and P1 separation",
        "admin P3 feedback triage loop routes field feedback into backlog and QA without P1 ready drift",
        "admin P3 feedback intake board maps feedback source next check owner command and release separation",
        "admin P3 feedback QA reflection calendar maps reproduction QA plan backlog and retrospective cadence",
        "admin P3 feedback evidence packet board maps classification evidence bundles reproduction impact QA backlog and release separation",
        "admin P3 feedback retrospective action board maps owners done criteria review deadlines and commands",
        "admin P3 feedback operationalization queue maps classified feedback into action target review command and P1 separation",
        "admin P3 feedback execution verification board maps action state evidence recheck command and P1 separation",
        "admin P3 feedback recurrence prevention board maps recurrence signals prevention checks next audits QA commands and P1 separation",
        "admin P3 feedback SLA lanes assign owners response windows verification commands and keep external blockers separate",
        "admin P3 feedback operating metrics board maps classification metrics aging backlog signals decisions and release guardrails",
        "docs and package script include test:p3-operations",
        "P1 readiness remains blocked with 7 external requirements",
      ],
    },
    null,
    2,
  ),
);
