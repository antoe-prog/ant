import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { appendPaymentStatusHistory, createPaymentStatusHistoryEntry, getCurrentMemberPayment, getLatestPaymentStatusChange } = await import("../src/lib/payment-lifecycle.ts");
const {
  createPaymentCreateIdempotencyKey,
  createPaymentCreateFingerprint,
  createPaymentCreateSnapshot,
  parsePaymentCreateIdempotencyKey,
  resolvePaymentCreateReplay,
} = await import("../src/lib/payment-create-idempotency.ts");
const {
  canManageManualPayment,
  getManualPaymentDateRangeError,
  getManualPaymentManagementBlockReason,
  manualPaymentCreatableStatuses,
  requiresManualPaymentCreateReason,
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

const idempotencyKey = createPaymentCreateIdempotencyKey();
const idempotentSnapshot = createPaymentCreateSnapshot({
  memberId: basePayment.memberId,
  planName: basePayment.planName,
  status: basePayment.status,
  amount: 180000.4,
  discountAmount: 0,
  dueDate: basePayment.dueDate,
  expiresAt: basePayment.expiresAt,
});
const idempotencyFingerprint = await createPaymentCreateFingerprint(idempotentSnapshot);
const legacyCanonicalPayload = JSON.stringify([
  idempotentSnapshot.memberId,
  idempotentSnapshot.planName,
  idempotentSnapshot.status,
  idempotentSnapshot.amount,
  idempotentSnapshot.discountAmount,
  idempotentSnapshot.dueDate,
  idempotentSnapshot.expiresAt,
]);
const legacyDigest = await globalThis.crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(legacyCanonicalPayload),
);
const legacyFingerprint = Array.from(new Uint8Array(legacyDigest), (value) =>
  value.toString(16).padStart(2, "0"),
).join("");
const cancelledSnapshot = createPaymentCreateSnapshot({
  ...idempotentSnapshot,
  status: "cancelled",
  reason: "  이중 등록 취소  ",
});
const ordinarySnapshotWithStaleReason = createPaymentCreateSnapshot({
  ...idempotentSnapshot,
  reason: "이전 취소 사유",
});
const idempotentCreationLog = {
  id: "audit-idempotency",
  branchId: basePayment.branchId,
  actorUserId: "user-owner",
  action: "payment.create",
  targetType: "payment",
  targetId: basePayment.id,
  before: null,
  after: { ...idempotentSnapshot, idempotencyFingerprint, idempotencyKey, planName: "[감사 로그 표시용 마스킹 값]" },
  result: "success",
  message: "수기 결제 기록을 등록했습니다.",
  createdAt: "2026-06-15T10:00:00.000Z",
};

function assertAppearsAfter(source, needle, earlierNeedle, message) {
  const needleIndex = source.indexOf(needle);
  const earlierIndex = source.indexOf(earlierNeedle);

  assert(needleIndex >= 0, `${message}: missing ${needle}`);
  assert(earlierIndex >= 0, `${message}: missing ${earlierNeedle}`);
  assert(needleIndex > earlierIndex, message);
}

assert.equal(paymentWithHistory.statusHistory.length, 2, "payment lifecycle helper must append status history");
assert.equal(parsePaymentCreateIdempotencyKey(idempotencyKey).ok, true, "generated payment idempotency keys must be valid");
assert.equal(parsePaymentCreateIdempotencyKey("short").ok, false, "short payment idempotency keys must be rejected");
assert.equal(idempotentSnapshot.amount, 180000, "idempotency snapshots must use the persisted rounded amount");
assert.equal(
  idempotencyFingerprint,
  legacyFingerprint,
  "ordinary manual payment fingerprints must remain compatible with pre-reason requests",
);
assert.equal(
  "reason" in ordinarySnapshotWithStaleReason,
  false,
  "ordinary manual payment snapshots must discard stale terminal-state reasons",
);
assert.equal(
  await createPaymentCreateFingerprint(ordinarySnapshotWithStaleReason),
  legacyFingerprint,
  "stale reasons must not change ordinary manual payment fingerprints",
);
assert.equal(cancelledSnapshot.reason, "이중 등록 취소", "manual payment create reasons must be normalized");
assert.notEqual(
  await createPaymentCreateFingerprint(cancelledSnapshot),
  idempotencyFingerprint,
  "manual payment create reasons must participate in new idempotency fingerprints",
);
assert.equal(
  resolvePaymentCreateReplay({
    actorUserId: "user-owner",
    auditLogs: [idempotentCreationLog],
    branchId: basePayment.branchId,
    fingerprint: idempotencyFingerprint,
    idempotencyKey,
    payments: [{ ...basePayment, amount: 200000 }],
  }).kind,
  "replay",
  "an exact retry must use the immutable creation audit even if the payment was later edited",
);
assert.equal(
  resolvePaymentCreateReplay({
    actorUserId: "user-owner",
    auditLogs: [idempotentCreationLog],
    branchId: basePayment.branchId,
    fingerprint: await createPaymentCreateFingerprint({ ...idempotentSnapshot, amount: 200000 }),
    idempotencyKey,
    payments: [basePayment],
  }).kind,
  "conflict",
  "an idempotency key must not accept a different payment payload",
);
assert.equal(
  resolvePaymentCreateReplay({
    actorUserId: "user-owner",
    auditLogs: [idempotentCreationLog],
    branchId: basePayment.branchId,
    fingerprint: idempotencyFingerprint,
    idempotencyKey,
    payments: [],
  }).kind,
  "conflict",
  "a deleted payment must not be silently recreated by an old retry",
);
assert.equal(getLatestPaymentStatusChange(paymentWithHistory)?.reason, "부분 환불", "payment lifecycle helper must return latest change");
const membershipPeriodPayments = [
  { ...basePayment, id: "pay-older", dueDate: "2026-05-15", expiresAt: "2026-06-15" },
  { ...basePayment, id: "pay-current", dueDate: "2026-06-15", expiresAt: "2026-07-15" },
];
const membershipPeriodPaymentIds = membershipPeriodPayments.map((payment) => payment.id);
assert.equal(
  getCurrentMemberPayment(membershipPeriodPayments)?.id,
  "pay-current",
  "member payment summary must select the latest membership period",
);
assert.deepEqual(
  membershipPeriodPayments.map((payment) => payment.id),
  membershipPeriodPaymentIds,
  "member payment summary selection must not mutate source order",
);
assert.equal(
  getCurrentMemberPayment([
    { ...basePayment, id: "pay-refunded", status: "refunded", expiresAt: "2026-07-15" },
    { ...basePayment, id: "pay-active", status: "paid", expiresAt: "2026-07-15" },
  ])?.id,
  "pay-active",
  "member payment summary must prefer a non-terminal record within the same membership period",
);
assert.equal(
  getCurrentMemberPayment([
    {
      ...basePayment,
      id: "pay-z-older-paid",
      statusHistory: [
        {
          ...createdEntry,
          id: "history-older-paid",
          changedAt: "2026-06-15T10:00:00.000Z",
          status: "paid",
        },
      ],
    },
    {
      ...basePayment,
      id: "pay-a-newer-overdue",
      status: "overdue",
      statusHistory: [
        {
          ...createdEntry,
          id: "history-newer-overdue",
          changedAt: "2026-06-20T10:00:00.000Z",
          status: "overdue",
        },
      ],
    },
  ])?.id,
  "pay-a-newer-overdue",
  "same-period duplicates must select the record with the latest status history instead of UUID order",
);
assert.equal(getCurrentMemberPayment([]), null, "member payment summary must handle members without payment history");
assert.equal(canManageManualPayment(basePayment), true, "plain manual payments must be manageable");
assert.equal(
  manualPaymentCreatableStatuses.includes("partially_refunded"),
  false,
  "manual payment creation must not accept a partial refund without a refund amount",
);
assert.equal(requiresManualPaymentCreateReason("paid"), false, "ordinary manual payment creation must not require a reason");
assert.equal(requiresManualPaymentCreateReason("cancelled"), true, "cancelled manual payment creation must require a reason");
assert.equal(requiresManualPaymentCreateReason("refunded"), true, "refunded manual payment creation must require a reason");
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
assert.equal(
  canManageManualPayment({ ...basePayment, amount: 0, refundedAmount: 0, status: "refunded" }),
  false,
  "refunded and partial-refund states remain immutable even without a positive refund amount",
);
assert.equal(
  canManageManualPayment({ ...basePayment, amount: 0, refundedAmount: 0, status: "partially_refunded" }),
  false,
  "partial-refund status must remain immutable even when legacy data has no refund amount",
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
assert.match(
  getManualPaymentDateRangeError("2026-02-29", "2026-03-31") ?? "",
  /납부일과 만료일을 확인/,
  "manual payment dates must reject a non-leap-year February 29",
);
assert.match(
  getManualPaymentDateRangeError("2026-04-30", "2026-04-31") ?? "",
  /납부일과 만료일을 확인/,
  "manual payment dates must reject a day outside the calendar month",
);
assert.equal(
  getManualPaymentDateRangeError("2028-02-29", "2028-02-29"),
  null,
  "manual payment dates must accept a real leap-year February 29",
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
  paymentCreateIdempotency: "src/lib/payment-create-idempotency.ts",
  paymentCreateRoute: "src/app/api/v1/branches/[branchId]/payments/route.ts",
  paymentExportRoute: "src/app/api/v1/exports/payments/route.ts",
  paymentManageRoute: "src/app/api/v1/payments/[paymentId]/route.ts",
  paymentOnlineCheckoutRoute: "src/app/api/v1/payments/[paymentId]/online-checkout/route.ts",
  paymentRefundRoute: "src/app/api/v1/payments/[paymentId]/refund/route.ts",
  paymentsScreen: "src/components/screens/payments-screen.tsx",
  packageJson: "package.json",
  qaPlan: "docs/QA_TEST_PLAN.md",
  readme: "README.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  releaseRunner: "scripts/run-release-checks.mjs",
  runtimeId: "src/server/runtime-id.ts",
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
  paymentCreateIdempotencySource,
  paymentCreateRouteSource,
  paymentExportRouteSource,
  paymentManageRouteSource,
  paymentOnlineCheckoutRouteSource,
  paymentRefundRouteSource,
  paymentsScreenSource,
  packageJsonSource,
  qaPlanSource,
  readmeSource,
  releaseChecklistSource,
  releaseRunnerSource,
  runtimeIdSource,
  smokeApiSource,
] = await Promise.all(Object.values(files).map((file) => readFile(file, "utf8")));
const packageJson = JSON.parse(packageJsonSource);

assert(domainSource.includes("PaymentStatusHistoryEntry"), "domain must define payment status history entries");
assert(domainSource.includes("statusHistory?: PaymentStatusHistoryEntry[]"), "Payment must carry statusHistory");
assert(paymentCreateRouteSource.includes("createPaymentStatusHistoryEntry"), "payment create route must persist initial status history");
assert(paymentCreateRouteSource.includes("getManualPaymentDateRangeError"), "payment create route must validate date chronology with the shared rule");
assert(paymentCreateRouteSource.includes("withServerDbLock"), "payment create route must use the runtime store lock for concurrent retries");
assert(paymentCreateRouteSource.includes("Idempotency-Replayed"), "payment create route must mark replayed responses");
assert(paymentCreateRouteSource.includes('createRuntimeId("pay")'), "payment create route must use collision-resistant payment IDs");
assert(runtimeIdSource.includes("randomUUID"), "runtime IDs must use UUID entropy instead of timestamps and array lengths");
assert(paymentCreateIdempotencySource.includes("actorUserId") && paymentCreateIdempotencySource.includes("branchId"), "payment idempotency lookup must be scoped by actor and branch");
assert(paymentCreateIdempotencySource.includes('reason: "deleted"'), "payment idempotency must protect deleted records from stale retries");
assert(paymentRefundRouteSource.includes("appendPaymentStatusHistory"), "payment refund route must append status history");
assert(paymentManageRouteSource.includes('action: "payment.update"'), "manual payment update must create an update audit log");
assert(paymentManageRouteSource.includes('action: "payment.delete"'), "manual payment deletion must create a delete audit log");
assert(paymentManageRouteSource.includes("getManualPaymentManagementBlockReason"), "manual payment route must block external/refunded records");
assert(paymentManageRouteSource.includes("requireSelectedBranchScope"), "manual payment route must enforce selected branch scope");
assert(
  paymentManageRouteSource.includes("payment-mutation:${paymentId}") &&
    paymentOnlineCheckoutRouteSource.includes("payment-mutation:${paymentId}"),
  "manual edits and online checkout creation must share the same payment mutation lock",
);
assert(
  paymentManageRouteSource.includes("refundedAt: payment.refundedAt") &&
    paymentManageRouteSource.includes("statusHistory: payment.statusHistory"),
  "manual payment deletion audits must retain cancellation and status history details",
);
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
  paymentsScreenSource.includes('const requestedMemberId = searchParams.get("memberId")') &&
    paymentsScreenSource.includes("appliedRequestedMemberIdRef.current === requestedMemberId") &&
    paymentsScreenSource.includes("guardianPaymentChildren.some((child) => child.id === requestedMemberId)") &&
    paymentsScreenSource.includes("setSelectedChildId(requestedMemberId)"),
  "guardian payment deep links must select an accessible active child once without pinning later choices",
);
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
assert(smokeApiSource.includes("concurrent payment retries with the same key"), "smoke test must verify concurrent payment idempotency");
assert(smokeApiSource.includes("a stale retry must not recreate a deleted payment"), "smoke test must verify deleted payment retry protection");
assert(smokeApiSource.includes("payment refund must append status history"), "smoke test must verify payment refund history");
assert(smokeApiSource.includes("manual payment update must persist editable fields"), "smoke test must verify manual payment editing");
assert(smokeApiSource.includes("manual payment deletion must remove the record"), "smoke test must verify manual payment deletion");
assert(backendSchemaSource.includes("CREATE TABLE payment_status_events"), "DB schema must include payment status events");
assert(apiContractSource.includes("statusHistory"), "API contract must document payment status history");
assert(apiContractSource.includes("Idempotency-Key"), "API contract must document manual payment idempotency");

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
        "manual payment create retries are scoped, replayed once, and reject conflicting or deleted originals",
        "manual payment create reasons preserve legacy fingerprints and bind terminal-state retries",
        "manual payment create/update rejects reversed and impossible calendar dates",
        "manual payment cancelled/refunded creation requires an audit reason",
        "manual payment creation rejects impossible partial-refund state",
        "same-payment manual and online mutations are serialized",
        "payment and audit IDs use UUID entropy",
        "cancelled manual payments remain correctable and deletable when no refund amount exists",
        "refunded and partial-refund states remain immutable even without a positive refund amount",
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
