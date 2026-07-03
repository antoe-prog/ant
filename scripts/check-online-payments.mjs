import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { createCheckoutUrl, getOnlinePaymentAmount, getOnlinePaymentProvider, getOnlinePaymentRuntimeReadiness, getWebhookSecret } =
  await import("../src/server/online-payments.ts");

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

assert.equal(getOnlinePaymentAmount(samplePayment), 130000, "online payment amount must subtract discount and refunds");
assert(createCheckoutUrl("provider-123").includes("provider-123"), "checkout URL must include provider payment id");
assert.equal(getWebhookSecret(), "final-judo-dev-webhook-secret", "development webhook secret fallback must be available");
assert.equal(getOnlinePaymentProvider({ NODE_ENV: "development" }), "mock", "development online payment provider may use mock mode");
assert.equal(
  getOnlinePaymentProvider({
    NODE_ENV: "production",
    FINAL_JUDO_PAYMENT_PROVIDER: "external",
    FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "https://payments.finaljudo.kr",
    FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "secret",
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
assert.throws(
  () => getOnlinePaymentProvider({ NODE_ENV: "production" }),
  /PAYMENT_PROVIDER_NOT_CONFIGURED/,
  "production online payment provider must not silently fall back to mock mode",
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
assert(sources.paymentWebhookRoute.includes("x-final-judo-payment-event-id"), "webhook route must accept provider event id header");
assert(sources.paymentWebhookRoute.includes("processedWebhookEventIds?.includes"), "webhook route must dedupe provider event ids");
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
        "payment screen request/status/receipt UI",
        "payment CSV online provider columns",
        "API/DB docs and release gates include online payments without app UI command exposure",
      ],
    },
    null,
    2,
  ),
);
