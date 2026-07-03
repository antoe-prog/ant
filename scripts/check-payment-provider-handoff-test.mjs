import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-payment-provider-handoff-"));

async function runHandoff(filePath, extraArgs = []) {
  const { stdout } = await execFile(process.execPath, ["scripts/check-payment-provider-handoff.mjs", `--file=${filePath}`, ...extraArgs], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

async function expectFailure(filePath) {
  try {
    await runHandoff(filePath);
  } catch (error) {
    assert.notEqual(error.code, 0, "invalid payment provider handoff should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid payment provider handoff unexpectedly passed");
}

function collectEvidenceTemplateValues(value, values = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEvidenceTemplateValues(item, values);
    }
    return values;
  }

  if (!value || typeof value !== "object") {
    return values;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "evidence" || key === "contractEvidence") {
      values.push(child);
    }
    collectEvidenceTemplateValues(child, values);
  }

  return values;
}

async function assertEvidenceUriTemplate(filePath) {
  const template = JSON.parse(await readFile(filePath, "utf8"));
  const evidenceValues = collectEvidenceTemplateValues(template);
  assert(evidenceValues.length > 0, `${filePath} should include evidence placeholders`);
  assert(
    evidenceValues.every((value) => typeof value === "string" && /^TODO_[A-Z0-9_]+_EVIDENCE_URI$/.test(value)),
    `${filePath} evidence placeholders must point operators to URI evidence fields`,
  );
}

const validHandoff = {
  schemaVersion: 1,
  generatedAt: "2026-07-16T05:00:00.000Z",
  provider: {
    name: "Final Pay PG",
    contractStatus: "pilot-contract",
    contractOwner: "정유진",
    contractEvidence: "https://evidence.finaljudo.kr/payment/provider-contract",
  },
  checkout: {
    baseUrl: "https://pay.finaljudo.kr",
    successRedirectVerified: true,
    failureRedirectVerified: true,
    receiptUrlVerified: true,
    evidence: "https://evidence.finaljudo.kr/payment/checkout-capture",
  },
  webhook: {
    endpointPath: "/api/v1/payments/webhook",
    secretName: "FINAL_JUDO_PAYMENT_WEBHOOK_SECRET",
    secretStored: true,
    signatureHeader: "x-final-pay-signature",
    signatureAlgorithm: "HMAC-SHA256 over raw body",
    eventIdField: "providerEventId",
    statusField: "event",
    amountField: "amount",
    receiptUrlField: "receiptUrl",
    testEventIds: ["evt_final_pay_0001", "evt_final_pay_0002"],
    idempotencyVerified: true,
    signatureVerified: true,
    evidence: "https://evidence.finaljudo.kr/payment/webhook-replay",
  },
  recurringBilling: {
    enabled: true,
    billingKeyField: "billingKey",
    mandateIdField: "mandateId",
    nextChargeDatePolicy: "provider-schedule-after-membership-expiry",
    billingKeyCustody: "provider-vault",
    cancelVerified: true,
    evidence: "drive://final-judo/evidence/payment/recurring-billing",
  },
  security: {
    rawSecretsNotCommitted: true,
    coachAmountMaskedVerified: true,
    auditLogVerified: true,
    evidence: "https://evidence.finaljudo.kr/payment/security-audit",
  },
  checks: {
    onlinePayments: {
      command: "npm run test:online-payments",
      passed: true,
      evidence: "https://github.com/antoe-prog/ant/actions/runs/310",
    },
    recurringBilling: {
      command: "npm run test:recurring-billing",
      passed: true,
      evidence: "https://github.com/antoe-prog/ant/actions/runs/311",
    },
    smoke: {
      command: "npm run test:smoke",
      passed: true,
      evidence: "https://github.com/antoe-prog/ant/actions/runs/312",
    },
  },
  signoff: {
    signedOffBy: "정유진",
    signedOffAt: "2026-07-16T05:30:00.000Z",
    evidence: "https://evidence.finaljudo.kr/payment/signoff",
  },
};

const validPath = path.join(directory, "payment-provider-handoff.valid.json");
const validReportPath = path.join(directory, "payment-provider-handoff.report.json");
await writeFile(validPath, `${JSON.stringify(validHandoff, null, 2)}\n`);

const validReport = await runHandoff(validPath, [`--out=${validReportPath}`]);
assert.equal(validReport.ok, true);
assert.equal(validReport.releaseDecision, "ready");
assert.equal(JSON.parse(await readFile(validReportPath, "utf8")).ok, true);

const placeholderCheckoutPath = path.join(directory, "payment-provider-handoff.placeholder-checkout.json");
const placeholderCheckoutHandoff = structuredClone(validHandoff);
placeholderCheckoutHandoff.checkout.baseUrl = "https://pay.finaljudo.example";
await writeFile(placeholderCheckoutPath, `${JSON.stringify(placeholderCheckoutHandoff, null, 2)}\n`);
const placeholderCheckoutReport = await expectFailure(placeholderCheckoutPath);
assert(placeholderCheckoutReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_CHECKOUT_BASE_URL"));

const templateReport = await runHandoff("docs/payment-provider-handoff.template.json", ["--allow-pending"]);
assert.equal(templateReport.ok, false);
assert(templateReport.blockers.some((blocker) => blocker.code.startsWith("PAYMENT_PROVIDER_HANDOFF_")));
await assertEvidenceUriTemplate("docs/payment-provider-handoff.template.json");

const missingSignaturePath = path.join(directory, "payment-provider-handoff.missing-signature.json");
const missingSignatureHandoff = structuredClone(validHandoff);
missingSignatureHandoff.webhook.signatureVerified = false;
missingSignatureHandoff.webhook.signatureHeader = "TODO_SIGNATURE_HEADER";
await writeFile(missingSignaturePath, `${JSON.stringify(missingSignatureHandoff, null, 2)}\n`);
const missingSignatureReport = await expectFailure(missingSignaturePath);
assert(missingSignatureReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_SIGNATURE_HEADER"));
assert(missingSignatureReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_VERIFICATION"));

const duplicateEventIdPath = path.join(directory, "payment-provider-handoff.duplicate-event-id.json");
const duplicateEventIdHandoff = structuredClone(validHandoff);
duplicateEventIdHandoff.webhook.testEventIds = ["evt_final_pay_0001", "evt_final_pay_0001"];
await writeFile(duplicateEventIdPath, `${JSON.stringify(duplicateEventIdHandoff, null, 2)}\n`);
const duplicateEventIdReport = await expectFailure(duplicateEventIdPath);
assert(duplicateEventIdReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_DUPLICATE_EVENT_ID"));

const rawSecretPath = path.join(directory, "payment-provider-handoff.raw-secret.json");
const rawSecretHandoff = structuredClone(validHandoff);
rawSecretHandoff.webhook.secretValue = "sk_live_finaljudo_super_secret_value";
await writeFile(rawSecretPath, `${JSON.stringify(rawSecretHandoff, null, 2)}\n`);
const rawSecretReport = await expectFailure(rawSecretPath);
assert(rawSecretReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_RAW_SECRET_VALUE"));

const looseEvidencePath = path.join(directory, "payment-provider-handoff.loose-evidence.json");
const looseEvidenceHandoff = structuredClone(validHandoff);
looseEvidenceHandoff.provider.contractEvidence = "provider onboarding ticket PAY-101 and signed pilot addendum";
await writeFile(looseEvidencePath, `${JSON.stringify(looseEvidenceHandoff, null, 2)}\n`);
const looseEvidenceReport = await expectFailure(looseEvidencePath);
assert(looseEvidenceReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_CONTRACT_EVIDENCE"));

const missingRecurringPath = path.join(directory, "payment-provider-handoff.missing-recurring.json");
const missingRecurringHandoff = structuredClone(validHandoff);
missingRecurringHandoff.recurringBilling.billingKeyCustody = "spreadsheet";
missingRecurringHandoff.recurringBilling.cancelVerified = false;
await writeFile(missingRecurringPath, `${JSON.stringify(missingRecurringHandoff, null, 2)}\n`);
const missingRecurringReport = await expectFailure(missingRecurringPath);
assert(missingRecurringReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_RECURRING_CUSTODY"));
assert(missingRecurringReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_RECURRING_CANCEL"));

const looseTimestampPath = path.join(directory, "payment-provider-handoff.loose-timestamp.json");
const looseTimestampHandoff = structuredClone(validHandoff);
looseTimestampHandoff.generatedAt = "July 16, 2026 05:00";
looseTimestampHandoff.signoff.signedOffAt = "July 16, 2026 05:30";
await writeFile(looseTimestampPath, `${JSON.stringify(looseTimestampHandoff, null, 2)}\n`);
const looseTimestampReport = await expectFailure(looseTimestampPath);
assert(looseTimestampReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_GENERATED_AT"));
assert(looseTimestampReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_SIGNOFF_AT"));

const signoffBeforeGeneratedPath = path.join(directory, "payment-provider-handoff.signoff-before-generated.json");
const signoffBeforeGeneratedHandoff = structuredClone(validHandoff);
signoffBeforeGeneratedHandoff.signoff.signedOffAt = "2026-07-16T04:59:59.000Z";
await writeFile(signoffBeforeGeneratedPath, `${JSON.stringify(signoffBeforeGeneratedHandoff, null, 2)}\n`);
const signoffBeforeGeneratedReport = await expectFailure(signoffBeforeGeneratedPath);
assert(signoffBeforeGeneratedReport.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_SIGNOFF_TIMELINE"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "valid real PG/VAN provider handoff",
        "report output",
        "placeholder checkout origin blocker",
        "template pending blocker coverage",
        "template evidence URI placeholders",
        "webhook signature blocker",
        "duplicate provider event ID blocker",
        "raw secret value blocker",
        "non-reference evidence blocker",
        "recurring billing custody and cancel blockers",
        "non-ISO timestamp blocker",
        "signoff before generatedAt blocker",
      ],
    },
    null,
    2,
  ),
);
