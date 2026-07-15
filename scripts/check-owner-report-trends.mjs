import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { buildOwnerTrendRows, getRecognizedPaymentRevenue } = await import("../src/lib/owner-reporting.ts");

function dateWithMonthOffset(offset, day = 15) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  date.setDate(day);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
}

function dateOnlyWithMonthOffset(offset, day = 15) {
  return dateWithMonthOffset(offset, day).slice(0, 10);
}

const scopedDb = {
  branches: [],
  users: [],
  members: [
    {
      ageGroup: "kids",
      alerts: [],
      belt: "흰띠",
      branchId: "branch-a",
      createdAt: dateWithMonthOffset(0, 7),
      emergencyContact: "010-2486-9137",
      guardianIds: [],
      id: "member-a",
      level: "입문",
      name: "신규 회원",
      primaryCoachId: "coach-a",
      status: "active",
      statusChangedAt: dateWithMonthOffset(0, 7),
    },
    {
      ageGroup: "kids",
      alerts: [],
      belt: "노란띠",
      branchId: "branch-a",
      createdAt: dateWithMonthOffset(-1, 7),
      emergencyContact: "010-6259-3048",
      guardianIds: [],
      id: "member-b",
      level: "초급",
      name: "이탈 회원",
      primaryCoachId: "coach-a",
      status: "withdrawn",
      statusChangedAt: dateWithMonthOffset(0, 9),
      withdrawnAt: dateWithMonthOffset(0, 9),
    },
    {
      ageGroup: "kids",
      alerts: [],
      belt: "노란띠",
      branchId: "branch-a",
      createdAt: dateWithMonthOffset(0, 8),
      emergencyContact: "010-7394-5862",
      guardianIds: [],
      id: "member-c",
      level: "초급",
      name: "체험 회원",
      primaryCoachId: "coach-a",
      status: "trial",
      statusChangedAt: dateWithMonthOffset(0, 8),
    },
    {
      ageGroup: "kids",
      alerts: [],
      belt: "흰띠",
      branchId: "branch-b",
      createdAt: dateWithMonthOffset(0, 7),
      emergencyContact: "010-8147-2953",
      guardianIds: [],
      id: "member-z",
      level: "입문",
      name: "다른 지점 회원",
      primaryCoachId: "coach-b",
      status: "active",
      statusChangedAt: dateWithMonthOffset(0, 7),
    },
  ],
  classes: [
    {
      ageGroup: "kids",
      branchId: "branch-a",
      capacity: 12,
      coachId: "coach-a",
      endsAt: dateWithMonthOffset(0, 15),
      enrolledMemberIds: ["member-a", "member-b", "member-c"],
      id: "class-a",
      level: "초급",
      name: "유소년반",
      room: "A",
      startsAt: dateWithMonthOffset(0, 15),
    },
    {
      ageGroup: "kids",
      branchId: "branch-b",
      capacity: 12,
      coachId: "coach-b",
      endsAt: dateWithMonthOffset(0, 15),
      enrolledMemberIds: ["member-z"],
      id: "class-b",
      level: "초급",
      name: "다른 지점",
      room: "B",
      startsAt: dateWithMonthOffset(0, 15),
    },
  ],
  attendance: [
    { confirmedAt: dateWithMonthOffset(0, 15), id: "att-a", memberId: "member-a", sessionId: "class-a", status: "present" },
    { confirmedAt: dateWithMonthOffset(0, 15), id: "att-b", memberId: "member-b", sessionId: "class-a", status: "late" },
    { confirmedAt: dateWithMonthOffset(0, 15), id: "att-z", memberId: "member-z", sessionId: "class-b", status: "present" },
  ],
  counselingNotes: [],
  payments: [
    {
      amount: 100000,
      branchId: "branch-a",
      dueDate: dateOnlyWithMonthOffset(0, 8),
      expiresAt: dateOnlyWithMonthOffset(1, 8),
      id: "pay-paid",
      memberId: "member-a",
      planName: "월 회원권",
      status: "paid",
    },
    {
      amount: 40000,
      branchId: "branch-a",
      dueDate: dateOnlyWithMonthOffset(1, 8),
      expiresAt: dateOnlyWithMonthOffset(2, 8),
      id: "pay-paid-future-due",
      memberId: "member-c",
      planName: "추가 회원권",
      status: "paid",
      statusHistory: [
        {
          actorUserId: "owner-a",
          changedAt: dateWithMonthOffset(0, 5),
          event: "status_changed",
          reason: "납부 확인",
          status: "paid",
        },
      ],
    },
    {
      amount: 90000,
      branchId: "branch-a",
      dueDate: dateOnlyWithMonthOffset(0, 3),
      expiresAt: dateOnlyWithMonthOffset(0, 20),
      id: "pay-expiring",
      memberId: "member-b",
      planName: "월 회원권",
      status: "expiringSoon",
    },
    {
      amount: 80000,
      branchId: "branch-a",
      dueDate: dateOnlyWithMonthOffset(0, 1),
      expiresAt: dateOnlyWithMonthOffset(0, 14),
      id: "pay-overdue",
      memberId: "member-c",
      planName: "월 회원권",
      status: "overdue",
    },
    {
      amount: 180000,
      branchId: "branch-a",
      discountAmount: 20000,
      dueDate: dateOnlyWithMonthOffset(0, 4),
      expiresAt: dateOnlyWithMonthOffset(1, 4),
      id: "pay-partially-refunded",
      memberId: "member-a",
      planName: "할인 회원권",
      refundedAmount: 30000,
      status: "partially_refunded",
    },
    {
      amount: 90000,
      branchId: "branch-a",
      dueDate: dateOnlyWithMonthOffset(0, 4),
      expiresAt: dateOnlyWithMonthOffset(0, 4),
      feeProductId: "training-white",
      id: "pay-uniform-expiring",
      memberId: "member-a",
      planName: "수련용 도복 백",
      status: "expiringSoon",
    },
  ],
  notices: [],
  pushSubscriptions: [],
  pilotReadinessChecks: [],
  pilotIncidents: [],
  pilotOperationLogs: [],
  auditLogs: [
    {
      action: "member.create",
      actorUserId: "owner-a",
      after: null,
      before: null,
      branchId: "branch-a",
      createdAt: dateWithMonthOffset(0, 10),
      id: "audit-a",
      message: "회원 생성",
      result: "success",
      targetId: "member-a",
      targetType: "member",
    },
    {
      action: "member.update",
      actorUserId: "owner-b",
      after: null,
      before: null,
      branchId: "branch-b",
      createdAt: dateWithMonthOffset(0, 10),
      id: "audit-b",
      message: "다른 지점 회원 수정",
      result: "success",
      targetId: "member-z",
      targetType: "member",
    },
  ],
};

const trendRows = buildOwnerTrendRows(scopedDb, ["branch-a"], 3);
const expandedTrendRows = buildOwnerTrendRows(scopedDb, ["branch-a"], 12);
const latestTrend = trendRows.at(-1);

assert.equal(trendRows.length, 3, "owner trend helper must return requested period count");
assert.equal(expandedTrendRows.length, 12, "owner trend helper must support expanded P2 period filters");
assert(latestTrend, "owner trend helper must return a latest period");
assert.equal(latestTrend.key, dateOnlyWithMonthOffset(0, 1).slice(0, 7), "owner trend latest period must not move into future payment months");
assert.equal(latestTrend.classes, 1, "owner trend must count scoped classes by class start month");
assert.equal(latestTrend.enrolledSlots, 3, "owner trend must sum scoped enrolled slots");
assert.equal(latestTrend.attendanceRecords, 2, "owner trend must count scoped attendance records");
assert.equal(latestTrend.attendanceRatePercent, 67, "owner trend must calculate attendance percent");
assert.equal(latestTrend.paidRevenue, 270000, "owner trend must sum discount/refund-adjusted paid revenue");
assert.equal(latestTrend.paymentRiskCount, 2, "owner trend must count overdue and expiring payments");
assert.equal(latestTrend.memberChangeEvents, 1, "owner trend must count scoped member audit changes");
assert.equal(latestTrend.newMembers, 2, "owner trend must count scoped new members by createdAt");
assert.equal(latestTrend.withdrawnMembers, 1, "owner trend must count scoped withdrawn members by withdrawnAt");
assert.equal(latestTrend.netMemberChange, 1, "owner trend must calculate net member change");
assert.match(latestTrend.label, /^\d{4}년 \d{1,2}월$/, "owner trend label must be app-readable Korean month text");
assert.equal(
  getRecognizedPaymentRevenue({ ...scopedDb.payments[0], amount: 180000, discountAmount: 20000 }),
  160000,
  "recognized revenue must subtract discounts",
);
assert.equal(
  getRecognizedPaymentRevenue(scopedDb.payments.find((payment) => payment.id === "pay-partially-refunded")),
  130000,
  "recognized revenue must include partial refunds at their remaining net amount",
);
assert.equal(
  getRecognizedPaymentRevenue({ ...scopedDb.payments[0], status: "refunded", refundedAmount: 160000 }),
  0,
  "fully refunded payments must not contribute recognized revenue",
);

const files = {
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  apiContract: "docs/API_CONTRACT.md",
  backendSchema: "docs/BACKEND_DB_SCHEMA.md",
  memberCreateRoute: "src/app/api/v1/branches/[branchId]/members/route.ts",
  memberUpdateRoute: "src/app/api/v1/members/[memberId]/route.ts",
  ownerReports: "src/components/screens/owner-reports-screen.tsx",
  operationsExport: "src/app/api/v1/exports/operations/route.ts",
  packageJson: "package.json",
  qaPlan: "docs/QA_TEST_PLAN.md",
  readme: "README.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  releaseRunner: "scripts/run-release-checks.mjs",
  smokeApi: "scripts/smoke-api.mjs",
};

const [
  adminSettingsSource,
  apiContractSource,
  backendSchemaSource,
  memberCreateRouteSource,
  memberUpdateRouteSource,
  ownerReportsSource,
  operationsExportSource,
  packageJsonSource,
  qaPlanSource,
  readmeSource,
  releaseChecklistSource,
  releaseRunnerSource,
  smokeApiSource,
] = await Promise.all(Object.values(files).map((file) => readFile(file, "utf8")));
const packageJson = JSON.parse(packageJsonSource);

assert(ownerReportsSource.includes("기간별 운영 추세"), "owner reports screen must show the trend section");
assert(ownerReportsSource.includes("buildOwnerTrendRows"), "owner reports screen must use the shared trend helper");
assert(ownerReportsSource.includes("trendPeriodMonths"), "owner reports screen must keep an interactive period filter");
assert(ownerReportsSource.includes("대표 리포트 기간 필터"), "owner reports screen must label the period filter");
assert(ownerReportsSource.includes("최근 3개월"), "owner reports screen must expose the 3 month period filter");
assert(ownerReportsSource.includes("최근 12개월"), "owner reports screen must expose the 12 month period filter");
assert(ownerReportsSource.includes("회원 순증"), "owner reports screen must surface net member change");
assert(ownerReportsSource.includes("newMembers"), "owner reports screen must keep new member trend values");
assert(ownerReportsSource.includes("withdrawnMembers"), "owner reports screen must keep withdrawn member trend values");
assert(ownerReportsSource.includes("netMemberChange"), "owner reports screen must keep net member trend values");
assert(ownerReportsSource.includes("owner-report-graph-board"), "owner reports screen must expose the graph board as the primary owner report view");
assert(ownerReportsSource.includes("ownerReportPrimaryGraphRow"), "owner reports screen must render the primary owner report graph row");
assert(ownerReportsSource.includes("ownerReportVisibleSecondaryGraphRows.map"), "owner reports screen must render secondary owner report graph rows");
assert(ownerReportsSource.includes("data-owner-report-graph-row"), "owner reports screen must expose owner report graph row hooks");
for (const snippet of [
  "showInternalOwnerOperationPanels",
  "p3-owner-decision-board",
  "운영 판단",
  "releaseGuard",
  "운영 확인 {command}",
]) {
  assert(!ownerReportsSource.includes(snippet), `owner reports screen must remove retired internal operation panels: ${snippet}`);
}
assert(ownerReportsSource.includes("apiClient.exportPaymentsCsv"), "owner reports screen must keep payments CSV export in owner reports");
assert(ownerReportsSource.includes("apiClient.exportOperationsCsv"), "owner reports screen must keep operations CSV export in owner reports");
assert(ownerReportsSource.includes("운영 내보내기"), "owner reports screen must render operations export action with service-facing wording");
assert(ownerReportsSource.includes("결제 내보내기"), "owner reports screen must render payments export action with service-facing wording");
assert(!ownerReportsSource.includes(">운영 CSV"), "owner reports screen must not show file-format-first operations CSV button copy");
assert(!ownerReportsSource.includes(">결제 CSV"), "owner reports screen must not show file-format-first payments CSV button copy");
assert(ownerReportsSource.includes("지점 비교"), "owner reports screen must show branch comparison in the P2 board");
assert(ownerReportsSource.includes("memberDelta"), "owner reports screen must calculate branch member growth");
assert(ownerReportsSource.includes("paymentRiskDelta"), "owner reports screen must calculate branch payment risk changes");
assert(ownerReportsSource.includes("revenueDelta"), "owner reports screen must calculate branch revenue trend changes");
assert(ownerReportsSource.includes("getRecognizedPaymentRevenue"), "owner branch comparisons must use shared net revenue semantics");
assert(ownerReportsSource.includes("owner-action-queue"), "owner reports screen must expose the owner action queue test hook");
assert(ownerReportsSource.includes("우선순위 보기"), "owner reports screen must show the owner daily priority entry point");
assert(ownerReportsSource.includes("우선순위 ${ownerReportHiddenActionCount}건 더 보기"), "owner reports screen must keep the owner daily priority expansion action");
assert(ownerReportsSource.includes("오늘 먼저 처리할 항목이 없습니다."), "owner action queue must keep an empty state");
assert(ownerReportsSource.includes("출석 미처리 정리"), "owner action queue must include attendance follow-up actions");
assert(ownerReportsSource.includes("결제 위험 확인"), "owner action queue must include payment risk actions");
assert(!ownerReportsSource.includes("보강 요청 승인"), "owner action queue must not include deleted request actions");
assert(ownerReportsSource.includes("신규 {row.newMembers} · 이탈 {row.withdrawnMembers}"), "owner reports screen must show new and withdrawn members");
assert(memberCreateRouteSource.includes("createdAt: now"), "member create route must persist createdAt");
assert(memberCreateRouteSource.includes("statusChangedAt: now"), "member create route must persist statusChangedAt");
assert(memberUpdateRouteSource.includes("patch.statusChangedAt = now"), "member update route must refresh statusChangedAt");
assert(memberUpdateRouteSource.includes("patch.withdrawnAt"), "member update route must persist withdrawnAt transitions");
assert(backendSchemaSource.includes("status_changed_at timestamptz NOT NULL DEFAULT now()"), "DB schema must persist member status changes");
assert(apiContractSource.includes("회원 생성은 `createdAt`, `statusChangedAt`을 서버 시각으로 저장"), "API contract must document member lifecycle fields");
assert(apiContractSource.includes("new_members`, `withdrawn_members`, `net_member_change`"), "API contract must document member lifecycle CSV columns");
assert(operationsExportSource.includes("trend_period"), "operations CSV must include trend rows");
assert(operationsExportSource.includes("net_member_change"), "operations CSV must include net member change");
assert(operationsExportSource.includes("member_change_events"), "operations CSV must include member change events");
assert(operationsExportSource.includes("getRecognizedPaymentRevenue"), "operations CSV branch rows must use shared net revenue semantics");
assert(smokeApiSource.includes("net_member_change,member_change_events"), "smoke test must verify lifecycle trend CSV header");
assert.equal(
  packageJson.scripts["test:owner-report-trends"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-owner-report-trends.mjs",
  "package.json must expose test:owner-report-trends",
);
assert(releaseRunnerSource.includes('["run", "test:owner-report-trends"]'), "test:release must run owner report trends");
assert(!adminSettingsSource.includes("npm run test:owner-report-trends"), "admin settings must not expose automated gate commands");

for (const [label, source] of [
  ["README", readmeSource],
  ["QA plan", qaPlanSource],
  ["release checklist", releaseChecklistSource],
]) {
  assert(source.includes("npm run test:owner-report-trends"), `${label} must document test:owner-report-trends`);
  assert(source.includes("기간별 운영 추세"), `${label} must mention owner report trends`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "shared owner trend helper aggregates scoped operational data",
        "shared owner trend helper calculates new/withdrawn/net member change",
        "shared owner trend helper supports P2 period filters",
        "owner reports screen shows period trend section",
        "owner reports screen uses graph board as the primary view and keeps legacy owner decision board hidden",
        "owner reports screen keeps CSV exports owner/admin scoped",
        "owner reports screen shows daily owner priority list",
        "member lifecycle fields are documented in API/DB docs",
        "operations CSV includes trend rows",
        "release runner, admin gate, and documents include owner report trend check",
      ],
      latestTrend,
    },
    null,
    2,
  ),
);
