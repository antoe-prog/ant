import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  createCheckoutUrl,
  getOnlinePaymentAmount,
  getOnlinePaymentProvider,
  getOnlinePaymentRuntimeReadiness,
  getWebhookSecret,
  isPaymentWebhookSecretSecure,
  isValidPaymentReceiptUrl,
  matchesPaymentWebhookSecret,
  normalizePaymentCheckoutBaseUrl,
  paymentWebhookSecretMinBytes,
} =
  await import("../src/server/online-payments.ts");
const {
  isPositiveSafeIntegerPaymentAmount,
  paymentWebhookClockSkewMs,
  validatePaymentWebhookOccurredAt,
  validatePaymentWebhookTransition,
} =
  await import("../src/server/payment-mutation-policy.ts");

const files = {
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  adminSettingsGates: "scripts/check-admin-settings-gates.mjs",
  apiClient: "src/lib/api-client.ts",
  apiContract: "docs/API_CONTRACT.md",
  backendSchema: "docs/BACKEND_DB_SCHEMA.md",
  dbMigration: "db/migrations/0001_initial.sql",
  domain: "src/lib/domain.ts",
  onlineCheckoutRoute: "src/app/api/v1/payments/[paymentId]/online-checkout/route.ts",
  onlinePaymentsHelper: "src/server/online-payments.ts",
  paymentExportRoute: "src/app/api/v1/exports/payments/route.ts",
  paymentWebhookRoute: "src/app/api/v1/payments/webhook/route.ts",
  paymentsScreen: "src/components/screens/payments-screen.tsx",
  recurringAgreementRoute: "src/app/api/v1/payments/[paymentId]/recurring-agreement/route.ts",
  packageJson: "package.json",
  qaPlan: "docs/QA_TEST_PLAN.md",
  readme: "README.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  releaseRunner: "scripts/run-release-checks.mjs",
  smokeApi: "scripts/smoke-api.mjs",
  store: "src/store/app-store.tsx",
};

const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])),
);
const packageJson = JSON.parse(sources.packageJson);
const samplePayment = {
  amount: 180000,
  branchId: "branch-a",
  discountAmount: 20000,
  dueDate: "2026-06-15",
  expiresAt: "2026-07-15",
  id: "pay-a",
  memberId: "member-a",
  planName: "월 회원권",
  refundedAmount: 30000,
  status: "scheduled",
};
const onlinePayment = {
  amount: 180000,
  checkoutUrl: "/checkout/provider-123",
  provider: "mock",
  providerPaymentId: "provider-123",
  requestedAt: "2026-06-15T08:00:00.000Z",
  requestedByUserId: "user-owner",
  status: "paid",
};
const paidWebhookHistory = {
  actorUserId: "system-payment-webhook",
  changedAt: "2026-06-15T10:00:00.000Z",
  event: "webhook",
  id: "history-paid",
  providerEventId: "event-paid",
  reason: "온라인 결제 입금 확인",
  status: "paid",
};

assert.equal(getOnlinePaymentAmount(samplePayment), 130000, "online payment amount must subtract discount and refunds");
assert(createCheckoutUrl("provider-123").includes("provider-123"), "checkout URL must include provider payment id");
assert.equal(getWebhookSecret(), "final-judo-dev-webhook-secret", "development webhook secret fallback must be available");
assert.equal(getOnlinePaymentProvider({ NODE_ENV: "development" }), "mock", "development online payment provider may use mock mode");
assert.deepEqual(
  getOnlinePaymentRuntimeReadiness({
    NODE_ENV: "development",
    FINAL_JUDO_PAYMENT_PROVIDER: "externla",
  }).blockers,
  ["PAYMENT_PROVIDER_INVALID"],
  "an unsupported configured provider must not be treated as external mode",
);
const strongWebhookSecret = "final-judo-webhook-0123456789-ABCDEF";
assert(Buffer.byteLength(strongWebhookSecret, "utf8") >= paymentWebhookSecretMinBytes);
assert.equal(
  getOnlinePaymentProvider({
    NODE_ENV: "production",
    FINAL_JUDO_PAYMENT_PROVIDER: "external",
    FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "https://payments.finaljudo.kr",
    FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: strongWebhookSecret,
  }),
  "external",
  "production online payment provider must use external mode when configured",
);
assert.deepEqual(
  getOnlinePaymentRuntimeReadiness({ NODE_ENV: "production" }).blockers,
  ["PAYMENT_PROVIDER_NOT_CONFIGURED"],
  "production online payment runtime must block missing payment provider",
);
assert.deepEqual(
  getOnlinePaymentRuntimeReadiness({ NODE_ENV: "production", FINAL_JUDO_PAYMENT_PROVIDER: "external" }).blockers,
  ["PAYMENT_CHECKOUT_BASE_URL_MISSING", "PAYMENT_WEBHOOK_SECRET_MISSING"],
  "production online payment runtime must block missing checkout and webhook settings",
);
assert.deepEqual(
  getOnlinePaymentRuntimeReadiness({
    NODE_ENV: "production",
    FINAL_JUDO_PAYMENT_PROVIDER: "external",
    FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "http://payments.finaljudo.kr/path?token=secret",
    FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: strongWebhookSecret,
  }).blockers,
  ["PAYMENT_CHECKOUT_BASE_URL_INVALID"],
  "production online payment runtime must reject an insecure or non-origin checkout base URL",
);
assert.deepEqual(
  getOnlinePaymentRuntimeReadiness({
    NODE_ENV: "development",
    FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "javascript:alert(1)",
  }).blockers,
  ["PAYMENT_CHECKOUT_BASE_URL_INVALID"],
  "mock runtime must not create an executable checkout link from a configured base URL",
);
assert.deepEqual(
  getOnlinePaymentRuntimeReadiness({
    NODE_ENV: "production",
    FINAL_JUDO_PAYMENT_PROVIDER: "external",
    FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "https://payments.finaljudo.kr",
    FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "secret",
  }).blockers,
  ["PAYMENT_WEBHOOK_SECRET_WEAK"],
  "production online payment runtime must reject short webhook secrets",
);
assert.deepEqual(
  getOnlinePaymentRuntimeReadiness({
    NODE_ENV: "production",
    FINAL_JUDO_PAYMENT_PROVIDER: "external",
    FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "https://payments.finaljudo.kr",
    FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "replace-with-provider-webhook-secret",
  }).blockers,
  ["PAYMENT_WEBHOOK_SECRET_WEAK"],
  "production online payment runtime must reject the documented placeholder webhook secret",
);
assert.equal(isPaymentWebhookSecretSecure(strongWebhookSecret), true, "32-byte webhook secrets must be accepted");
assert.equal(isPaymentWebhookSecretSecure("secret"), false, "short webhook secrets must be rejected");
assert.equal(
  isPaymentWebhookSecretSecure("replace-with-provider-webhook-secret"),
  false,
  "placeholder webhook secrets must be rejected",
);
assert.equal(
  getWebhookSecret({ NODE_ENV: "production", FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "secret" }),
  null,
  "the production webhook route must fail closed for weak configured secrets",
);
assert.equal(
  getWebhookSecret({ NODE_ENV: "production", FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: strongWebhookSecret }),
  strongWebhookSecret,
  "the production webhook route must accept policy-compliant secrets",
);
assert.equal(matchesPaymentWebhookSecret(strongWebhookSecret, strongWebhookSecret), true, "matching webhook secrets must pass");
assert.equal(matchesPaymentWebhookSecret(`${strongWebhookSecret}x`, strongWebhookSecret), false, "different-length webhook secrets must fail");
assert.equal(matchesPaymentWebhookSecret(`x${strongWebhookSecret.slice(1)}`, strongWebhookSecret), false, "same-length webhook secrets must fail when content differs");
assert.throws(
  () => getOnlinePaymentProvider({ NODE_ENV: "production" }),
  /PAYMENT_PROVIDER_NOT_CONFIGURED/,
  "production online payment provider must not silently fall back to mock mode",
);
assert.throws(
  () => getOnlinePaymentProvider({ NODE_ENV: "development", FINAL_JUDO_PAYMENT_PROVIDER: "externla" }),
  /PAYMENT_PROVIDER_INVALID/,
  "an invalid configured provider must fail closed instead of enabling external mode",
);
assert.equal(isPositiveSafeIntegerPaymentAmount(1), true, "one KRW must be a valid payment mutation amount");
assert.equal(isPositiveSafeIntegerPaymentAmount(0.4), false, "fractional KRW must be rejected");
assert.equal(isPositiveSafeIntegerPaymentAmount(Number.POSITIVE_INFINITY), false, "infinite amounts must be rejected");
assert.equal(isPositiveSafeIntegerPaymentAmount(Number.MAX_SAFE_INTEGER + 1), false, "unsafe integer amounts must be rejected");
assert.equal(isValidPaymentReceiptUrl("https://payments.finaljudo.test/receipt/1"), true, "HTTPS receipt URLs must be accepted");
assert.equal(isValidPaymentReceiptUrl("javascript:alert(1)"), false, "executable receipt URLs must be rejected");
assert.equal(
  isValidPaymentReceiptUrl("https://user:secret@payments.finaljudo.test/receipt/1"),
  false,
  "credential-bearing receipt URLs must be rejected",
);
assert.equal(isValidPaymentReceiptUrl({}), false, "non-string receipt URLs must be rejected");
assert.equal(normalizePaymentCheckoutBaseUrl("https://payments.finaljudo.kr/"), "https://payments.finaljudo.kr");
assert.equal(normalizePaymentCheckoutBaseUrl("https://user:secret@payments.finaljudo.kr"), null);
assert.equal(normalizePaymentCheckoutBaseUrl("https://payments.finaljudo.kr/base"), null);
assert.equal(
  validatePaymentWebhookTransition(
    { ...samplePayment, onlinePayment, refundedAmount: 180000, status: "refunded" },
    "paid",
    "2026-06-15T12:00:00.000Z",
  ).ok,
  false,
  "a paid webhook must not resurrect a fully refunded payment",
);
assert.equal(
  validatePaymentWebhookTransition(
    { ...samplePayment, onlinePayment, status: "cancelled" },
    "paid",
    "2026-06-15T12:00:00.000Z",
  ).ok,
  false,
  "a paid webhook must not resurrect a cancelled payment",
);
assert.equal(
  validatePaymentWebhookTransition(
    { ...samplePayment, onlinePayment: { ...onlinePayment, status: "refunded" }, refundedAmount: 30000, status: "partially_refunded" },
    "paid",
    "2026-06-15T12:00:00.000Z",
  ).ok,
  false,
  "a paid webhook must not erase a partial refund state",
);
assert.deepEqual(
  validatePaymentWebhookTransition(
    { ...samplePayment, onlinePayment, status: "paid", statusHistory: [paidWebhookHistory] },
    "refunded",
    "2026-06-15T11:00:00.000Z",
  ),
  { ok: true },
  "a newer refund webhook must remain valid after payment completion",
);
assert.deepEqual(
  validatePaymentWebhookTransition(
    {
      ...samplePayment,
      onlinePayment: { ...onlinePayment, status: "refunded" },
      refundedAmount: 30000,
      status: "partially_refunded",
      statusHistory: [paidWebhookHistory],
    },
    "refunded",
    "2026-06-15T11:00:00.000Z",
  ),
  { ok: true },
  "a later refund webhook must remain valid after a partial refund",
);
assert.equal(
  validatePaymentWebhookTransition(
    { ...samplePayment, onlinePayment, status: "paid", statusHistory: [paidWebhookHistory] },
    "refunded",
    "2026-06-15T09:00:00.000Z",
  ).code,
  "OUT_OF_ORDER",
  "an older provider event must not override a newer webhook state",
);
assert.deepEqual(
  validatePaymentWebhookTransition(
    {
      ...samplePayment,
      onlinePayment: { ...onlinePayment, status: "failed" },
      refundedAmount: 0,
      statusHistory: [{ ...paidWebhookHistory, changedAt: "2026-06-15T09:00:00.000Z", status: "scheduled" }],
    },
    "paid",
    "2026-06-15T10:00:00.000Z",
  ),
  { ok: true },
  "a newer paid event must remain valid after an earlier failed attempt",
);
assert.deepEqual(
  validatePaymentWebhookOccurredAt(
    { ...samplePayment, onlinePayment },
    "2026-06-15T08:00:00.000Z",
    new Date("2026-06-15T08:01:00.000Z"),
  ),
  { ok: true },
  "a webhook occurrence at checkout time must be accepted",
);
assert.equal(
  validatePaymentWebhookOccurredAt(
    { ...samplePayment, onlinePayment },
    new Date(Date.parse(onlinePayment.requestedAt) - paymentWebhookClockSkewMs - 1).toISOString(),
    new Date("2026-06-15T08:01:00.000Z"),
  ).code,
  "EVENT_TIME_OUT_OF_RANGE",
  "a webhook occurrence before checkout beyond clock skew must be rejected",
);
assert.equal(
  validatePaymentWebhookOccurredAt(
    { ...samplePayment, onlinePayment },
    new Date(Date.parse("2026-06-15T08:01:00.000Z") + paymentWebhookClockSkewMs + 1).toISOString(),
    new Date("2026-06-15T08:01:00.000Z"),
  ).code,
  "EVENT_TIME_OUT_OF_RANGE",
  "a webhook occurrence in the future beyond clock skew must be rejected",
);

assert(sources.domain.includes("OnlinePaymentRequest"), "domain must define online payment request metadata");
assert(sources.domain.includes("PaymentReceipt"), "domain must define payment receipt metadata");
assert(sources.domain.includes("processedWebhookEventIds"), "domain must store processed webhook event ids");
assert(sources.domain.includes("providerEventId?: string"), "payment status history must carry provider event ids");
assert(sources.domain.includes('"payment.online_checkout.create"'), "domain audit actions must include online checkout");
assert(sources.domain.includes('"payment.webhook"'), "domain audit actions must include payment webhook");
assert(sources.onlineCheckoutRoute.includes("payment.online_checkout.create"), "online checkout route must audit checkout creation");
assert(sources.onlineCheckoutRoute.includes("onlinePayment"), "online checkout route must persist onlinePayment metadata");
assert(sources.onlineCheckoutRoute.includes("getOnlinePaymentRuntimeReadiness"), "online checkout route must check runtime readiness");
assert(sources.onlineCheckoutRoute.includes("온라인 결제 설정 확인이 필요합니다."), "online checkout route must return app-safe setup copy");
assert(sources.recurringAgreementRoute.includes("getOnlinePaymentRuntimeReadiness"), "recurring agreement route must check runtime readiness");
assert(sources.recurringAgreementRoute.includes("온라인 결제 설정 확인이 필요합니다."), "recurring agreement route must return app-safe setup copy");
assert(sources.paymentWebhookRoute.includes("x-final-judo-payment-webhook-secret"), "webhook route must verify secret header");
assert(
  sources.paymentWebhookRoute.includes("matchesPaymentWebhookSecret"),
  "webhook route must compare authentication secrets with the constant-time helper",
);
assert(sources.paymentWebhookRoute.includes("x-final-judo-payment-event-id"), "webhook route must accept provider event id header");
assert(
  sources.paymentWebhookRoute.includes("bodyProviderEventId !== headerProviderEventId"),
  "webhook route must reject conflicting body and header event IDs",
);
assert(
  sources.paymentWebhookRoute.includes("validatePaymentWebhookOccurredAt"),
  "webhook route must reject provider timestamps outside the checkout and receive-time window",
);
assert(
  sources.paymentWebhookRoute.includes("hasOccurredAt && !hasValidOccurredAt"),
  "webhook route must reject malformed provider timestamps instead of replacing them with receive time",
);
assert(
  sources.paymentWebhookRoute.includes("findPaymentByProcessedWebhookEventId") &&
    sources.paymentWebhookRoute.includes('entry.event === "webhook"') &&
    sources.paymentWebhookRoute.includes('"PROVIDER_EVENT_CONFLICT"'),
  "webhook route must dedupe provider event ids globally across retained status history",
);
assert(
  sources.paymentWebhookRoute.includes("providerEventIdMaxLength = 160"),
  "webhook provider event IDs must match the database varchar(160) contract",
);
assert(
  sources.paymentWebhookRoute.includes("providerPaymentIdMaxLength = 160") &&
    sources.paymentWebhookRoute.includes("receiptIdMaxLength = 160") &&
    sources.paymentWebhookRoute.includes("isValidPaymentReceiptUrl(receiptUrl)"),
  "webhook payment and receipt metadata must match storage limits and reject unsafe links",
);
assert(
  sources.paymentWebhookRoute.includes("withServerDbLock(paymentWebhookStateLockKey"),
  "webhook route must serialize the global provider event namespace",
);
assert(
  sources.paymentWebhookRoute.includes('withServerDbLock(`payment-mutation:${paymentId}`'),
  "webhook route must also serialize against same-payment operator mutations",
);
assert(sources.paymentWebhookRoute.includes("const db = await readServerDb()"), "webhook route must re-read payment state inside the lock");
assert(sources.paymentWebhookRoute.includes("CONCURRENT_MODIFICATION"), "webhook route must expose stable concurrent conflict responses");
assert(sources.paymentWebhookRoute.includes("hasValidOccurredAt"), "follow-up webhook events must require a valid provider occurrence time");
assert(
  sources.paymentWebhookRoute.includes('event === "refunded" && !isPositiveSafeIntegerPaymentAmount(body.amount)'),
  "webhook refunds must require a positive safe-integer amount before reading payment state",
);
assert(sources.paymentWebhookRoute.includes("payment.webhook"), "webhook route must audit provider events");
assert(sources.paymentWebhookRoute.includes("createPaymentReceipt"), "webhook route must persist receipt metadata");
assert(sources.paymentWebhookRoute.includes("결제 승인 상태를 확인해 주세요."), "webhook route must use app-safe payment failure reason");
assert(sources.paymentWebhookRoute.includes("결제 환불 상태가 반영되었습니다."), "webhook route must use app-safe payment refund reason");
assert(!sources.paymentWebhookRoute.includes("body.reason?.trim()"), "webhook route must not persist raw provider reason");
assert(!sources.paymentWebhookRoute.includes("온라인 결제 실패:"), "webhook route must not prefix raw-looking failure history copy");
assert(sources.apiClient.includes("createOnlinePaymentCheckout"), "api client must expose online checkout creation");
assert(sources.store.includes("createOnlinePaymentCheckout"), "app store must expose online checkout action");
assert(sources.paymentsScreen.includes("온라인 요청"), "payments screen must render online checkout action");
assert(sources.paymentsScreen.includes("영수증"), "payments screen must render receipt links");
assert(sources.paymentsScreen.includes("onlinePaymentStatusLabels"), "payments screen must label online payment status");
assert(sources.paymentExportRoute.includes("online_payment_status"), "payment CSV must include online payment status");
assert(sources.paymentExportRoute.includes("receipt_url"), "payment CSV must include receipt URL");
assert(sources.dbMigration.includes("online_provider_payment_id"), "DB migration must include provider payment id");
assert(sources.dbMigration.includes("ux_payment_status_events_provider_event"), "DB migration must include provider event id uniqueness");
assert(sources.backendSchema.includes("online_provider_payment_id"), "DB schema docs must include provider payment id");
assert(sources.backendSchema.includes("ux_payment_status_events_provider_event"), "DB schema docs must include provider event id uniqueness");
assert(sources.apiContract.includes("/api/v1/payments/{paymentId}/online-checkout"), "API contract must document online checkout route");
assert(sources.apiContract.includes("/api/v1/payments/webhook"), "API contract must document payment webhook route");
assert(sources.smokeApi.includes("/online-checkout"), "smoke test must exercise online checkout route");
assert(sources.smokeApi.includes("/api/v1/payments/webhook"), "smoke test must exercise payment webhook route");
assert(sources.smokeApi.includes("duplicate provider webhook event must be idempotent"), "smoke test must verify webhook idempotency");
assert(
  sources.smokeApi.includes("payment refund webhook must require an explicit refund amount") &&
    sources.smokeApi.includes("missing refund amount must not change refunded amount"),
  "smoke test must verify that a missing refund amount cannot become a full refund",
);
assert(
  sources.smokeApi.includes("provider event id must not be reusable across payments") &&
    sources.smokeApi.includes("cross-payment provider event conflict must not mutate the second payment"),
  "smoke test must verify global provider event id uniqueness",
);
assert(
  sources.smokeApi.includes("concurrent webhook and recurring agreement creation must preserve both final states") &&
    sources.smokeApi.includes("append both history events once"),
  "smoke test must verify webhook serialization against operator payment mutations",
);

assert.equal(
  packageJson.scripts["test:online-payments"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-online-payments.mjs",
  "package.json must expose test:online-payments",
);
assert(sources.releaseRunner.includes('["run", "test:online-payments"]'), "test:release must run online payments check");
assert(
  sources.adminSettingsGates.includes('"npm run test:online-payments"') &&
    !sources.adminSettings.includes("npm run test:online-payments"),
  "admin settings automated gates must include online payments without exposing npm commands in the app UI",
);

for (const [label, source] of [
  ["README", sources.readme],
  ["QA plan", sources.qaPlan],
  ["release checklist", sources.releaseChecklist],
]) {
  assert(source.includes("npm run test:online-payments"), `${label} must document test:online-payments`);
  assert(source.includes("온라인 결제"), `${label} must mention online payments`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "online payment amount and checkout URL helpers",
        "online checkout and webhook routes",
        "provider webhook event id idempotency",
        "webhook event ordering, terminal-state monotonicity, and payment mutation locking",
        "payment screen request/status/receipt UI",
        "payment CSV online provider columns",
        "API/DB docs and release gates include online payments without app UI command exposure",
      ],
    },
    null,
    2,
  ),
);
