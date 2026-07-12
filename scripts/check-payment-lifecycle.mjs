import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { appendPaymentStatusHistory, createPaymentStatusHistoryEntry, getLatestPaymentStatusChange } = await import("../src/lib/payment-lifecycle.ts");
const {
  canManageManualPayment,
  getManualPaymentDateRangeError,
  getManualPaymentManagementBlockReason,
  validateManualPaymentUpdate,
} = await import("../src/lib/manual-payment-management.ts");

const basePayment = {
  id: "pay-test",
  branchId: "branch-a",
  memberId: "member-a",
  planName: "월 회원권",
  status: "paid",
  amount: 180000,
  discountAmount: 0,
  dueDate: "2026-06-15",
  expiresAt: "2026-07-15",
};
const createdEntry = createPaymentStatusHistoryEntry({
  actorUserId: "user-owner",
  changedAt: "2026-06-15T10:00:00.000Z",
  event: "created",
  reason: "수기 결제 등록",
  status: "paid",
});
const refundedEntry = createPaymentStatusHistoryEntry({
  actorUserId: "user-owner",
  changedAt: "2026-06-16T10:00:00.000Z",
  event: "refund",
  reason: "부분 환불",
  status: "partially_refunded",
});
const paymentWithHistory = appendPaymentStatusHistory(
  appendPaymentStatusHistory(basePayment, createdEntry),
  refundedEntry,
);

function assertAppearsAfter(source, needle, earlierNeedle, message) {
  const needleIndex = source.indexOf(needle);
  const earlierIndex = source.indexOf(earlierNeedle);

  assert(needleIndex >= 0, `${message}: missing ${needle}`);
  assert(earlierIndex >= 0, `${message}: missing ${earlierNeedle}`);
  assert(needleIndex > earlierIndex, message);
}

assert.equal(paymentWithHistory.statusHistory.length, 2, "payment lifecycle helper must append status history");
assert.equal(getLatestPaymentStatusChange(paymentWithHistory)?.reason, "부분 환불", "payment lifecycle helper must return latest change");
assert.equal(canManageManualPayment(basePayment), true, "plain manual payments must be manageable");
assert.equal(
  canManageManualPayment({
    ...basePayment,
    status: "cancelled",
    refundedAt: "2026-06-16T10:00:00.000Z",
    refundReason: "수기 결제 취소",
  }),
  true,
  "cancelled manual payments without a refund amount must remain correctable and deletable",
);
assert.equal(
  canManageManualPayment({ ...basePayment, refundedAmount: 1000 }),
  false,
  "refunded manual payments must not be directly edited or deleted",
);
assert.match(
  getManualPaymentManagementBlockReason({
    ...basePayment,
    onlinePayment: { provider: "mock", providerPaymentId: "provider-1", status: "pending" },
  }),
  /온라인 결제 이력/,
  "online payment history must block manual record management",
);
assert.deepEqual(
  validateManualPaymentUpdate({
    amount: 200000,
    discountAmount: 10000,
    dueDate: "2026-07-01",
    expiresAt: "2026-08-01",
    planName: "수정 회원권",
    reason: "금액 정정",
    status: "paid",
  }),
  {
    ok: true,
    value: {
      amount: 200000,
      discountAmount: 10000,
      dueDate: "2026-07-01",
      expiresAt: "2026-08-01",
      planName: "수정 회원권",
      reason: "금액 정정",
      status: "paid",
    },
  },
  "manual payment updates must normalize valid editable fields",
);
assert.equal(
  validateManualPaymentUpdate({
    amount: 10000,
    discountAmount: 20000,
    dueDate: "2026-07-01",
    expiresAt: "2026-08-01",
    planName: "수정 회원권",
    reason: "할인 정정",
    status: "paid",
  }).ok,
  false,
  "manual payment updates must reject discounts greater than the amount",
);
assert.match(
  getManualPaymentDateRangeError("2026-08-01", "2026-07-31") ?? "",
  /만료일은 납부일과 같거나 이후/,
  "manual payment dates must reject an expiry before the due date",
);
assert.equal(
  validateManualPaymentUpdate({
    amount: 10000,
    discountAmount: 0,
    dueDate: "2026-08-01",
    expiresAt: "2026-07-31",
    planName: "수정 회원권",
    reason: "날짜 정정",
    status: "paid",
  }).ok,
  false,
  "manual payment updates must reject reversed date ranges",
);

const files = {
  adminSettingsGateTest: "scripts/check-admin-settings-gates.mjs",
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  apiContract: "docs/API_CONTRACT.md",
  backendSchema: "docs/BACKEND_DB_SCHEMA.md",
  domain: "src/lib/domain.ts",
  manualPaymentAuditMigration: "db/migrations/0003_payment_management_audit_actions.sql",
  manualPaymentComponent: "src/components/domain/manual-payment-management.tsx",
  paymentCreateRoute: "src/app/api/v1/branches/[branchId]/payments/route.ts",
  paymentExportRoute: "src/app/api/v1/exports/payments/route.ts",
  paymentManageRoute: "src/app/api/v1/payments/[paymentId]/route.ts",
  paymentRefundRoute: "src/app/api/v1/payments/[paymentId]/refund/route.ts",
  paymentsScreen: "src/components/screens/payments-screen.tsx",
  packageJson: "package.json",
  qaPlan: "docs/QA_TEST_PLAN.md",
  readme: "README.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  releaseRunner: "scripts/run-release-checks.mjs",
  smokeApi: "scripts/smoke-api.mjs",
};

const [
  adminSettingsGateTestSource,
  adminSettingsSource,
  apiContractSource,
  backendSchemaSource,
  domainSource,
  manualPaymentAuditMigrationSource,
  manualPaymentComponentSource,
  paymentCreateRouteSource,
  paymentExportRouteSource,
  paymentManageRouteSource,
  paymentRefundRouteSource,
  paymentsScreenSource,
  packageJsonSource,
  qaPlanSource,
  readmeSource,
  releaseChecklistSource,
  releaseRunnerSource,
  smokeApiSource,
] = await Promise.all(Object.values(files).map((file) => readFile(file, "utf8")));
const packageJson = JSON.parse(packageJsonSource);

assert(domainSource.includes("PaymentStatusHistoryEntry"), "domain must define payment status history entries");
assert(domainSource.includes("statusHistory?: PaymentStatusHistoryEntry[]"), "Payment must carry statusHistory");
assert(paymentCreateRouteSource.includes("createPaymentStatusHistoryEntry"), "payment create route must persist initial status history");
assert(paymentCreateRouteSource.includes("getManualPaymentDateRangeError"), "payment create route must validate date chronology with the shared rule");
assert(paymentRefundRouteSource.includes("appendPaymentStatusHistory"), "payment refund route must append status history");
assert(paymentManageRouteSource.includes('action: "payment.update"'), "manual payment update must create an update audit log");
assert(paymentManageRouteSource.includes('action: "payment.delete"'), "manual payment deletion must create a delete audit log");
assert(paymentManageRouteSource.includes("getManualPaymentManagementBlockReason"), "manual payment route must block external/refunded records");
assert(paymentManageRouteSource.includes("requireSelectedBranchScope"), "manual payment route must enforce selected branch scope");
assert(
  paymentManageRouteSource.includes("statusChanged") && paymentManageRouteSource.includes(": updatedPaymentBase"),
  "manual payment detail corrections must not create false status history entries",
);
assertAppearsAfter(
  paymentManageRouteSource,
  "request.json()",
  "getManualPaymentManagementBlockReason(payment)",
  "manual payment route must authenticate, check branch scope, and verify payment history before body validation",
);
assert(manualPaymentComponentSource.includes('data-testid="manual-payment-edit-form"'), "manual payment UI must expose an edit form");
assert(manualPaymentComponentSource.includes('data-testid="manual-payment-delete-form"'), "manual payment UI must require explicit deletion confirmation");
assert(manualPaymentComponentSource.includes("수정 사유"), "manual payment edit UI must require a change reason");
assert(manualPaymentComponentSource.includes("삭제 사유"), "manual payment delete UI must require a deletion reason");
assert(
  paymentsScreenSource.includes('data-testid="payment-create-feedback"') &&
    paymentsScreenSource.includes("paymentCreatePending"),
  "manual payment create UI must expose pending and direct result feedback",
);
assert(manualPaymentAuditMigrationSource.includes("payment.update"), "audit enum migration must include payment.update");
assert(manualPaymentAuditMigrationSource.includes("payment.delete"), "audit enum migration must include payment.delete");
assert(domainSource.includes('"payment.update"'), "domain audit actions must include payment.update");
assert(domainSource.includes('"payment.delete"'), "domain audit actions must include payment.delete");
assertAppearsAfter(
  paymentCreateRouteSource,
  "request.json()",
  "getAccessibleBranchIds(user, db).includes(branchId)",
  "payment create route must require authentication and branch access before body validation",
);
assertAppearsAfter(
  paymentRefundRouteSource,
  "request.json()",
  "getAccessibleBranchIds(user, db).includes(payment.branchId)",
  "payment refund route must require authentication and branch access before body validation",
);
assert(paymentsScreenSource.includes("상태 변경 이력"), "payments screen must render payment status history");
assert(paymentsScreenSource.includes("getLatestPaymentStatusChange"), "payments screen must show latest status change");
assert(paymentsScreenSource.includes("payment-action-queue"), "payments screen must expose the payment action queue test hook");
assert(paymentsScreenSource.includes("확인할 결제"), "payments screen must show payment follow-up actions");
assert(!paymentsScreenSource.includes("결제 후속 조치 큐"), "payments screen must avoid queue jargon in app UI copy");
assert(!paymentsScreenSource.includes("먼저 처리할 결제"), "payments screen must avoid urgent processing jargon in app UI copy");
assert(!paymentsScreenSource.includes("우선 {action.score}"), "payments screen must avoid exposing internal priority scores");
assert(paymentsScreenSource.includes("p2-payment-membership-ops-board"), "payments screen must expose the P2 payment operations board test hook");
assert(paymentsScreenSource.includes("결제/회원권 요약"), "payments screen must show the payment operations summary");
assert(paymentsScreenSource.includes("미납 회수"), "P2 payment operations board must include overdue collection");
assert(paymentsScreenSource.includes("만료/재등록"), "P2 payment operations board must include renewal candidates");
assert(paymentsScreenSource.includes("환불/할인 점검"), "P2 payment operations board must include refund and discount checks");
assert(paymentsScreenSource.includes("상태 이력"), "P2 payment operations board must include lifecycle history");
assert(paymentsScreenSource.includes("온라인/정기결제"), "payment operations board must summarize online and recurring payment state");
assert(paymentsScreenSource.includes("payment-create-member-search-input"), "payment create form must use member search instead of a scroll-only member picker");
assert(paymentsScreenSource.includes("payment-create-member-result"), "payment create form must render selectable member search results");
assert(paymentsScreenSource.includes("matchesMemberSearch"), "payment create member search must use the shared member search matcher");
assert(paymentsScreenSource.includes("handlePaymentMemberSearchChange"), "payment create form must clear stale selected members when search text changes");
assert(paymentsScreenSource.includes("showPaymentMemberSearchResults"), "payment create form must collapse search results after a member is selected");
assert(
  paymentsScreenSource.includes('setPaymentMemberSearch(renewalMember?.name ?? "")'),
  "renewal prefill must keep the searched member visible after loading an existing payment",
);
assert(
  !/<select[\s\S]{0,260}value=\{selectedPaymentMemberId\}/.test(paymentsScreenSource),
  "payment create form must not regress to a scroll-only member select",
);
assert(paymentsScreenSource.includes("미납 연락"), "payment action queue must include overdue follow-up actions");
assert(paymentsScreenSource.includes("재등록 안내"), "payment action queue must include renewal follow-up actions");
assert(paymentsScreenSource.includes("온라인 결제 재요청"), "payment action queue must include online failure follow-up actions");
assert(paymentsScreenSource.includes("정기결제 실패 확인"), "payment action queue must include recurring failure follow-up actions");
assert(paymentsScreenSource.includes('data-testid="payment-action-queue-link"'), "payment action queue items must be actionable links");
assert(
  paymentsScreenSource.includes("focusPayment=${encodeURIComponent(action.paymentId)}"),
  "payment action queue links must target the exact payment card",
);
assert(paymentsScreenSource.includes("activeFocusedPaymentId === payment.id"), "targeted payment cards must expose a visible deep-link state");
assert(paymentsScreenSource.includes("focusedPaymentAvailable"), "payment focus must not restart when the payment array refreshes");
assert(paymentsScreenSource.includes('data-testid="payment-member-profile-link"'), "operator payment rows must link to member profiles");
assert(paymentExportRouteSource.includes("status_history_count"), "payment CSV must include status history count");
assert(paymentExportRouteSource.includes("last_status_changed_at"), "payment CSV must include latest status timestamp");
assert(paymentExportRouteSource.includes("last_status_reason"), "payment CSV must include latest status reason");
assert(smokeApiSource.includes("payment create must persist status history"), "smoke test must verify payment create history");
assert(smokeApiSource.includes("payment refund must append status history"), "smoke test must verify payment refund history");
assert(smokeApiSource.includes("manual payment update must persist editable fields"), "smoke test must verify manual payment editing");
assert(smokeApiSource.includes("manual payment deletion must remove the record"), "smoke test must verify manual payment deletion");
assert(backendSchemaSource.includes("CREATE TABLE payment_status_events"), "DB schema must include payment status events");
assert(apiContractSource.includes("statusHistory"), "API contract must document payment status history");

assert.equal(
  packageJson.scripts["test:payment-lifecycle"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-payment-lifecycle.mjs",
  "package.json must expose test:payment-lifecycle",
);
assert(releaseRunnerSource.includes('["run", "test:payment-lifecycle"]'), "test:release must run payment lifecycle check");
assert(adminSettingsGateTestSource.includes("npm run test:payment-lifecycle"), "admin settings gate checker must track payment lifecycle check");
assert(!adminSettingsSource.includes("npm run test:payment-lifecycle"), "admin settings UI must not expose raw payment lifecycle command text");

for (const [label, source] of [
  ["README", readmeSource],
  ["QA plan", qaPlanSource],
  ["release checklist", releaseChecklistSource],
]) {
  assert(source.includes("npm run test:payment-lifecycle"), `${label} must document test:payment-lifecycle`);
  assert(source.includes("결제 상태 이력"), `${label} must mention payment status lifecycle`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "payment lifecycle helper appends and reads latest status changes",
        "manual payment create/update rejects reversed due and expiry dates",
        "cancelled manual payments remain correctable and deletable when no refund amount exists",
        "manual payment detail corrections do not append false status changes",
        "payment create/refund routes persist status history",
        "manual payment update/delete routes enforce role, branch, and transaction history boundaries",
        "manual payment creation waits for persistence and exposes direct result feedback",
        "manual payment edit/delete UI requires reasons and explicit confirmation",
        "payments screen renders status history",
        "payments screen shows payment follow-up action queue",
        "payment action queue links to the exact payment card",
        "operator payment rows link back to member profiles",
        "payments screen shows payment operations summary",
        "payment create form uses searchable member selection",
        "payment provider implementation copy stays out of the app surface",
        "payment create/refund routes authenticate and check branch scope before body validation",
        "payment CSV includes lifecycle columns",
        "API/DB docs and release gates include payment lifecycle",
      ],
    },
    null,
    2,
  ),
);
