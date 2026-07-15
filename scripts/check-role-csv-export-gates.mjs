import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const roles = await import("../src/lib/roles.ts");

const screenDir = "src/components/screens";
const apiClientSource = readFileSync("src/lib/api-client.ts", "utf8");
const paymentsExportRouteSource = readFileSync("src/app/api/v1/exports/payments/route.ts", "utf8");
const operationsExportRouteSource = readFileSync("src/app/api/v1/exports/operations/route.ts", "utf8");
const dashboardScreenSource = readFileSync("src/components/screens/dashboard-screen.tsx", "utf8");
const memberDashboardStartIndex = dashboardScreenSource.indexOf('if (context.user.role === "member")');
const ownerDashboardStartIndex = dashboardScreenSource.indexOf('if (context.user.role === "owner")');
const guardianDashboardSource = dashboardScreenSource.slice(
  dashboardScreenSource.indexOf('if (context.user.role === "guardian")'),
  memberDashboardStartIndex,
);
const memberDashboardSource = dashboardScreenSource.slice(memberDashboardStartIndex, ownerDashboardStartIndex);
const paymentsScreenSource = readFileSync("src/components/screens/payments-screen.tsx", "utf8");
const ownerReportsScreenSource = readFileSync("src/components/screens/owner-reports-screen.tsx", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const releaseRunnerSource = readFileSync("scripts/run-release-checks.mjs", "utf8");
const smokeApiSource = readFileSync("scripts/smoke-api.mjs", "utf8");
const adminSettingsGatesSource = readFileSync("scripts/check-admin-settings-gates.mjs", "utf8");
const releaseDocs = [
  ["README.md", readFileSync("README.md", "utf8")],
  ["docs/QA_TEST_PLAN.md", readFileSync("docs/QA_TEST_PLAN.md", "utf8")],
  ["docs/RELEASE_CHECKLIST.md", readFileSync("docs/RELEASE_CHECKLIST.md", "utf8")],
];

const routeById = new Map(roles.appRoutes.map((route) => [route.id, route]));
const exportApiGuard = '!["owner", "admin"].includes(user.role)';
const allowedCsvExportCallScreens = new Set(["payments-screen.tsx", "owner-reports-screen.tsx"]);
const allowedCsvTextScreens = new Set([
  "admin-audit-logs-screen.tsx",
  "admin-settings-screen.tsx",
  "owner-reports-screen.tsx",
  "payments-screen.tsx",
]);
const csvActionTextPattern = /CSV 내보내기|운영 CSV|결제 CSV|운영 내보내기|결제 내보내기/;
const csvApiCallPattern = /apiClient\.export(?:Payments|Operations)Csv/;
const runtimeCsvGateDocSnippet = "회원/학부모 CSV export API 403";

function assertOwnerAdminExportRoute(source, label) {
  assert(source.includes(exportApiGuard), `${label} must reject every role outside owner/admin`);
  assert(source.includes("return jsonError(403"), `${label} must return 403 for unauthorized CSV export`);
  assert(source.includes("requireSelectedBranchScope(request, user, db)"), `${label} must reject invalid selectedBranchId before exporting`);
  assert(source.includes('"export.create"'), `${label} must audit successful CSV export`);
  assert(source.includes('"Content-Type": "text/csv; charset=utf-8"'), `${label} must return an explicit CSV content type`);
}

assert.deepEqual(
  routeById.get("payments")?.roles,
  ["member", "guardian", "owner", "admin"],
  "payments route must remain visible to member/guardian for status viewing without granting export rights",
);
assert.deepEqual(routeById.get("ownerReports")?.roles, ["owner"], "owner reports CSV screen must stay owner-only");
assert.deepEqual(routeById.get("adminAuditLogs")?.roles, ["admin"], "CSV audit log screen must stay admin-only");
assert.deepEqual(routeById.get("adminSettings")?.roles, ["admin"], "P1 CSV gate documentation screen must stay admin-only");

for (const role of ["member", "guardian"]) {
  assert.equal(roles.canAccessPath(role, "/app/payments"), true, `${role} must still view payment status`);
  assert.equal(roles.canAccessPath(role, "/app/owner/reports"), false, `${role} must not access owner CSV reports`);
  assert.equal(roles.canAccessPath(role, "/app/admin/audit-logs"), false, `${role} must not access CSV audit logs`);
  assert.equal(roles.canAccessPath(role, "/app/admin/settings"), false, `${role} must not access admin CSV gate docs`);
}

assertOwnerAdminExportRoute(paymentsExportRouteSource, "payments CSV export route");
assertOwnerAdminExportRoute(operationsExportRouteSource, "operations CSV export route");
assert(
  operationsExportRouteSource.includes("getRecognizedPaymentRevenue") &&
    ownerReportsScreenSource.includes("getRecognizedPaymentRevenue"),
  "operations CSV and owner branch comparisons must share discount/refund-adjusted revenue semantics",
);

assert(
  apiClientSource.includes("exportPaymentsCsv(selectedBranchId: string | null)") &&
    apiClientSource.includes("textRequest(`/api/v1/exports/payments"),
  "API client must keep payments CSV behind the dedicated export endpoint",
);
assert(
  apiClientSource.includes("exportOperationsCsv(selectedBranchId: string | null)") &&
    apiClientSource.includes("textRequest(`/api/v1/exports/operations"),
  "API client must keep operations CSV behind the dedicated export endpoint",
);
assert(
  smokeApiSource.includes("assertCsvExportRejectsInvalidBranch") &&
    smokeApiSource.includes("selectedBranchId=branch-missing"),
  "smoke API test must reject invalid selectedBranchId for CSV export endpoints",
);

assert(
  paymentsScreenSource.includes('const canManagePayments = context.user.role === "owner" || context.user.role === "admin"'),
  "payments screen CSV and payment management controls must stay gated by owner/admin role",
);
assert(
  /action=\{\s*canManagePayments \? \([\s\S]*?결제 내보내기[\s\S]*?\) : null\s*\}/.test(paymentsScreenSource),
  "payments screen export button must stay inside the canManagePayments SectionHeader action guard",
);
assert(!paymentsScreenSource.includes(">CSV 내보내기"), "payments screen must not show a file-format-first export button label");
assert(!paymentsScreenSource.includes("CSV 내보내기를 완료했습니다."), "payments screen must not show file-format-first export status copy");
assert(
  paymentsScreenSource.includes('data-testid={canManagePayments ? undefined : "member-guardian-payment-status-list"}'),
  "member/guardian payments screen must use a compact status list instead of operation summary cards",
);
assert(
  paymentsScreenSource.includes('온라인 결제{showPaymentOperationsMeta ? ` · ${formatCurrency(onlinePayment.amount)}` : ""}'),
  "member/guardian payments screen must not expose online payment amounts in visible status copy",
);
assert(
  paymentsScreenSource.includes("const familyOnlinePaymentStatusLabels") &&
    paymentsScreenSource.includes("납부 확인 중") &&
    paymentsScreenSource.includes("const familyRecurringAgreementStatusLabels") &&
    paymentsScreenSource.includes("자동 납부 확인 중"),
  "member/guardian payments screen must use family-facing payment status labels",
);
assert(
  paymentsScreenSource.includes("const staffOnlinePaymentDetails") &&
    paymentsScreenSource.includes("const staffRecurringAgreementDetails") &&
    paymentsScreenSource.includes("{staffOnlinePaymentDetails}") &&
    paymentsScreenSource.includes("{staffRecurringAgreementDetails}"),
  "operator payment provider details must stay explicitly staff-scoped",
);
assert(
  !paymentsScreenSource.includes('onlinePayment && onlinePayment.status !== "paid" ? onlinePaymentStatusLabels[onlinePayment.status]') &&
    paymentsScreenSource.includes('onlinePayment && onlinePayment.status !== "paid" ? familyOnlinePaymentStatusLabels[onlinePayment.status]'),
  "member/guardian payment status notes must not reuse operator online payment labels",
);
assert(
  !paymentsScreenSource.includes('showPaymentOperationsMeta ? "확인 필요 금액" : "납부 예정/만료"'),
  "member/guardian payments screen must not render amount-centered summary cards",
);
assert(
  ownerReportsScreenSource.includes("apiClient.exportOperationsCsv") &&
    ownerReportsScreenSource.includes("apiClient.exportPaymentsCsv"),
  "owner reports must keep operations/payments CSV actions on the owner-only route",
);

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
  assert(dashboardScreenSource.includes(snippet), `member/guardian dashboard mobile experience is missing ${snippet}`);
}
assert(!dashboardScreenSource.includes("상담/공지"), "member dashboard must keep the current notice-only priority card");
assert(!dashboardScreenSource.includes("학습 성장 보기"), "guardian dashboard must not render a redundant intro eyebrow");

assert(
  guardianDashboardSource.includes("<GuardianLearningSummaryPanel"),
  "guardian dashboard must keep the child learning summary as the primary dashboard content",
);
assert(!guardianDashboardSource.includes("<FamilyMobilePriorityPanel"), "guardian dashboard must not render the today summary panel");
assert(
  memberDashboardSource.includes("<FamilyMobilePriorityPanel"),
  "member dashboard must keep the compact today summary as the primary dashboard content",
);
assert(memberDashboardSource.includes("return ("), "member dashboard must return before the generic operations dashboard");
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
  assert(
    !memberDashboardSource.includes(duplicatedMemberSectionSnippet),
    `member dashboard must stay compact and omit ${duplicatedMemberSectionSnippet}`,
  );
}
for (const guardianRemovedSnippet of ["학부모 홈", "자녀별 수업, 출석, 결제 상태와 공지를 한 화면에서 확인합니다.", "보강 요청", "자녀 상태 요약", "등록 수업", "출석 기록", "회원권 상태"]) {
  assert(!guardianDashboardSource.includes(guardianRemovedSnippet), `guardian dashboard must stay focused and omit ${guardianRemovedSnippet}`);
}

assert(
  !dashboardScreenSource.includes("member-guardian-mobile-action-"),
  "member/guardian dashboard must not duplicate summary action links above the detail cards",
);

for (const retiredGuidanceSnippet of [
  "다음 행동 큐",
  "오늘 확인 브리프",
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
  assert(
    !dashboardScreenSource.includes(retiredGuidanceSnippet),
    `member/guardian dashboard must not expose internal operations guidance: ${retiredGuidanceSnippet}`,
  );
}

for (const fileName of readdirSync(screenDir).filter((file) => file.endsWith(".tsx"))) {
  const source = readFileSync(path.join(screenDir, fileName), "utf8");

  assert(
    !csvApiCallPattern.test(source) || allowedCsvExportCallScreens.has(fileName),
    `${fileName} must not call CSV export API outside owner/admin export screens`,
  );
  assert(
    !csvActionTextPattern.test(source) || allowedCsvTextScreens.has(fileName),
    `${fileName} must not expose CSV export wording outside owner/admin/admin-audit contexts`,
  );
}

assert.equal(
  packageJson.scripts["test:role-csv-export-gates"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-role-csv-export-gates.mjs",
  "package.json must expose test:role-csv-export-gates",
);
assert(
  releaseRunnerSource.includes('["run", "test:role-csv-export-gates"]'),
  "test:release must run npm run test:role-csv-export-gates",
);
assert(
  smokeApiSource.includes("assertCsvExportBlockedForRole") &&
    smokeApiSource.includes("member/guardian CSV export API 403"),
  "smoke API test must verify member/guardian CSV export endpoints return 403",
);
assert(
  adminSettingsGatesSource.includes('"npm run test:role-csv-export-gates"') &&
    adminSettingsGatesSource.includes("admin settings does not embed automated gate commands"),
  "/app/admin/settings automated gates must list npm run test:role-csv-export-gates outside app source",
);

for (const [docPath, source] of releaseDocs) {
  assert(source.includes("npm run test:role-csv-export-gates"), `${docPath} must document test:role-csv-export-gates`);
  assert(source.includes(runtimeCsvGateDocSnippet), `${docPath} must document runtime member/guardian CSV API 403 evidence`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "member and guardian can view payment status without CSV export controls",
    "owner report CSV screen remains owner-only",
    "admin CSV audit/settings contexts remain admin-only",
    "payments and operations CSV APIs reject non-owner/admin roles",
    "payments and operations CSV APIs reject invalid selectedBranchId before exporting",
    "smoke API verifies member/guardian CSV export endpoints return 403",
        "CSV export API calls appear only in approved owner/admin screens",
        "member dashboard keeps mobile status checks without CSV export controls",
        "guardian dashboard focuses on child learning progress feedback promotion and tournament status",
        "release runner, admin settings, and release docs include the CSV role gate",
      ],
    },
    null,
    2,
  ),
);
