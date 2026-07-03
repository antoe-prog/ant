import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { createProviderAgreementId, getBillingDayOfMonth, getNextBillingDateFromExpiry } = await import("../src/server/online-payments.ts");

const files = {
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  apiClient: "src/lib/api-client.ts",
  apiContract: "docs/API_CONTRACT.md",
  backendSchema: "docs/BACKEND_DB_SCHEMA.md",
  dbMigration: "db/migrations/0001_initial.sql",
  domain: "src/lib/domain.ts",
  packageJson: "package.json",
  paymentExportRoute: "src/app/api/v1/exports/payments/route.ts",
  paymentsScreen: "src/components/screens/payments-screen.tsx",
  qaPlan: "docs/QA_TEST_PLAN.md",
  readme: "README.md",
  recurringAgreementRoute: "src/app/api/v1/payments/[paymentId]/recurring-agreement/route.ts",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  releaseRunner: "scripts/run-release-checks.mjs",
  smokeApi: "scripts/smoke-api.mjs",
  store: "src/store/app-store.tsx",
};

const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])),
);
const packageJson = JSON.parse(sources.packageJson);
const [recurringPostRouteSource, recurringDeleteRouteSource = ""] = sources.recurringAgreementRoute.split("export async function DELETE");

function assertAppearsAfter(source, needle, earlierNeedle, message) {
  const needleIndex = source.indexOf(needle);
  const earlierIndex = source.indexOf(earlierNeedle);

  assert(needleIndex >= 0, `${message}: missing ${needle}`);
  assert(earlierIndex >= 0, `${message}: missing ${earlierNeedle}`);
  assert(needleIndex > earlierIndex, message);
}

assert(createProviderAgreementId("pay-test").includes("fj_agreement_pay-test_"), "provider agreement id must include payment id");
assert.equal(getBillingDayOfMonth("2026-07-31"), 28, "billing day must be clamped to provider-safe day 28");
assert.equal(getNextBillingDateFromExpiry("2026-07-15"), "2026-07-16", "next billing date must default to day after expiry");

assert(sources.domain.includes("PaymentRecurringAgreement"), "domain must define recurring agreement metadata");
assert(sources.domain.includes("recurringAgreement?: PaymentRecurringAgreement"), "Payment must carry recurring agreement metadata");
assert(sources.domain.includes('"payment.recurring_agreement.create"'), "domain audit actions must include recurring create");
assert(sources.domain.includes('"payment.recurring_agreement.cancel"'), "domain audit actions must include recurring cancel");
assert(sources.recurringAgreementRoute.includes("export async function POST"), "recurring agreement route must create agreements");
assert(sources.recurringAgreementRoute.includes("export async function DELETE"), "recurring agreement route must cancel agreements");
assert(sources.recurringAgreementRoute.includes("payment.recurring_agreement.create"), "recurring create route must audit changes");
assert(sources.recurringAgreementRoute.includes("payment.recurring_agreement.cancel"), "recurring cancel route must audit changes");
assertAppearsAfter(
  recurringPostRouteSource,
  "request.json()",
  "getAccessibleBranchIds(user, db).includes(payment.branchId)",
  "recurring agreement create route must require authentication and branch access before body validation",
);
assertAppearsAfter(
  recurringDeleteRouteSource,
  "request.json()",
  "getAccessibleBranchIds(user, db).includes(payment.branchId)",
  "recurring agreement cancel route must require authentication and branch access before body validation",
);
assert(sources.apiClient.includes("createRecurringAgreement"), "api client must expose recurring create");
assert(sources.apiClient.includes("cancelRecurringAgreement"), "api client must expose recurring cancel");
assert(sources.store.includes("createRecurringAgreement"), "app store must expose recurring create action");
assert(sources.store.includes("cancelRecurringAgreement"), "app store must expose recurring cancel action");
assert(sources.paymentsScreen.includes("정기결제 약정"), "payments screen must render recurring agreement action");
assert(sources.paymentsScreen.includes("정기결제 해지"), "payments screen must render recurring agreement cancellation");
assert(sources.paymentExportRoute.includes("recurring_status"), "payment CSV must include recurring status");
assert(sources.paymentExportRoute.includes("recurring_next_billing_date"), "payment CSV must include next billing date");
assert(sources.dbMigration.includes("recurring_provider_agreement_id"), "DB migration must include recurring provider agreement id");
assert(sources.backendSchema.includes("recurring_provider_agreement_id"), "DB schema docs must include recurring provider agreement id");
assert(sources.apiContract.includes("/api/v1/payments/{paymentId}/recurring-agreement"), "API contract must document recurring agreement route");
assert(sources.smokeApi.includes("/recurring-agreement"), "smoke test must exercise recurring agreement route");

assert.equal(
  packageJson.scripts["test:recurring-billing"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-recurring-billing.mjs",
  "package.json must expose test:recurring-billing",
);
assert(sources.releaseRunner.includes('["run", "test:recurring-billing"]'), "test:release must run recurring billing check");
assert(!sources.adminSettings.includes("npm run test:recurring-billing"), "admin settings must not embed the recurring billing gate command in app source");

for (const [label, source] of [
  ["README", sources.readme],
  ["QA plan", sources.qaPlan],
  ["release checklist", sources.releaseChecklist],
]) {
  assert(source.includes("npm run test:recurring-billing"), `${label} must document test:recurring-billing`);
  assert(source.includes("정기결제"), `${label} must mention recurring billing`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "recurring agreement helper dates and ids",
        "recurring agreement create/cancel API",
        "recurring agreement routes authenticate and check branch scope before body validation",
        "payments screen recurring agreement UI",
        "payment CSV recurring columns",
        "API/DB docs and release gates include recurring billing",
      ],
    },
    null,
    2,
  ),
);
