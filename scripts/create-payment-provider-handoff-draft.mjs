import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(args.out ?? ".data/payment-provider-handoff.json");
const evidenceReferencePattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;
const webhookSecretMinBytes = 32;

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--checkout-verified") {
      parsed.checkoutVerified = true;
      continue;
    }

    if (arg === "--webhook-secret-stored") {
      parsed.webhookSecretStored = true;
      continue;
    }

    if (arg === "--webhook-verified") {
      parsed.webhookVerified = true;
      continue;
    }

    if (arg === "--recurring-verified") {
      parsed.recurringVerified = true;
      continue;
    }

    if (arg === "--security-verified") {
      parsed.securityVerified = true;
      continue;
    }

    if (arg === "--checks-passed") {
      parsed.checksPassed = true;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    const normalizedKey = key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[normalizedKey] = value;
  }

  return parsed;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholder(value) {
  const normalized = text(value).toUpperCase();
  return (
    !normalized ||
    normalized.includes("TODO") ||
    normalized.includes("TBD") ||
    normalized.includes("REPLACE-WITH") ||
    normalized.includes("PLACEHOLDER") ||
    normalized.includes("SAMPLE") ||
    normalized.includes("EXAMPLE") ||
    normalized.includes("LOCALHOST") ||
    normalized.includes("PASSWORD") ||
    normalized.includes("USER:") ||
    /<[^>]+>/.test(text(value))
  );
}

function evidenceReady(value) {
  const evidence = text(value);
  return Boolean(evidence && !isPlaceholder(evidence) && evidenceReferencePattern.test(evidence));
}

function webhookSecretReady(value) {
  const secret = text(value);
  return (
    !isPlaceholder(secret) &&
    Buffer.byteLength(secret, "utf8") >= webhookSecretMinBytes &&
    new Set(secret).size >= 8
  );
}

function safeProviderName() {
  const provider = text(args.providerName) || text(process.env.FINAL_JUDO_PAYMENT_PROVIDER);
  return provider && !["external", "mock", "none", "test"].includes(provider.toLowerCase()) ? provider : "TODO_PROVIDER_NAME";
}

function safeCheckoutBaseUrl() {
  return text(args.checkoutBaseUrl) || text(process.env.FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL) || "https://TODO-PAYMENT-CHECKOUT-HOST";
}

function secretStored() {
  return (
    args.webhookSecretStored === true ||
    webhookSecretReady(process.env.FINAL_JUDO_PAYMENT_WEBHOOK_SECRET)
  );
}

function splitList(value, fallback) {
  const values = text(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function owner() {
  return text(args.owner) || text(args.contractOwner) || "TODO_OWNER";
}

function signoffTimestamp() {
  if (text(args.signedOffAt)) {
    return text(args.signedOffAt);
  }

  return owner() === "TODO_OWNER" ? "TODO_ISO_TIMESTAMP" : new Date().toISOString();
}

const checkoutVerified = args.checkoutVerified === true;
const webhookVerified = args.webhookVerified === true;
const recurringVerified = args.recurringVerified === true;
const securityVerified = args.securityVerified === true;
const checksPassed = args.checksPassed === true;
const draft = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  provider: {
    name: safeProviderName(),
    contractStatus: text(args.contractStatus) || "pilot-contract",
    contractOwner: owner(),
    contractEvidence: text(args.contractEvidence) || "TODO_CONTRACT_EVIDENCE",
  },
  checkout: {
    baseUrl: safeCheckoutBaseUrl(),
    successRedirectVerified: checkoutVerified,
    failureRedirectVerified: checkoutVerified,
    receiptUrlVerified: checkoutVerified,
    evidence: text(args.checkoutEvidence) || "TODO_CHECKOUT_EVIDENCE",
  },
  webhook: {
    endpointPath: "/api/v1/payments/webhook",
    secretName: "FINAL_JUDO_PAYMENT_WEBHOOK_SECRET",
    secretStored: secretStored(),
    signatureHeader: text(args.signatureHeader) || "TODO_SIGNATURE_HEADER",
    signatureAlgorithm: text(args.signatureAlgorithm) || "TODO_SIGNATURE_ALGORITHM",
    eventIdField: text(args.eventIdField) || "providerEventId",
    statusField: text(args.statusField) || "TODO_STATUS_FIELD",
    amountField: text(args.amountField) || "TODO_AMOUNT_FIELD",
    receiptUrlField: text(args.receiptUrlField) || "TODO_RECEIPT_URL_FIELD",
    testEventIds: splitList(args.testEventIds, ["TODO_PROVIDER_EVENT_ID"]),
    idempotencyVerified: webhookVerified,
    signatureVerified: webhookVerified,
    evidence: text(args.webhookEvidence) || "TODO_WEBHOOK_EVIDENCE",
  },
  recurringBilling: {
    enabled: args.recurringEnabled === "false" ? false : true,
    billingKeyField: text(args.billingKeyField) || "TODO_BILLING_KEY_FIELD",
    mandateIdField: text(args.mandateIdField) || "TODO_MANDATE_ID_FIELD",
    nextChargeDatePolicy: text(args.nextChargeDatePolicy) || "provider-schedule",
    billingKeyCustody: text(args.billingKeyCustody) || "provider-vault",
    cancelVerified: recurringVerified,
    evidence: text(args.recurringEvidence) || "TODO_RECURRING_EVIDENCE",
  },
  security: {
    rawSecretsNotCommitted: securityVerified,
    coachAmountMaskedVerified: securityVerified,
    auditLogVerified: securityVerified,
    evidence: text(args.securityEvidence) || "TODO_SECURITY_EVIDENCE",
  },
  checks: {
    onlinePayments: {
      command: "npm run test:online-payments",
      passed: checksPassed,
      evidence: text(args.onlinePaymentCheckEvidence) || "TODO_ONLINE_PAYMENT_CHECK_EVIDENCE",
    },
    recurringBilling: {
      command: "npm run test:recurring-billing",
      passed: checksPassed,
      evidence: text(args.recurringBillingCheckEvidence) || "TODO_RECURRING_BILLING_CHECK_EVIDENCE",
    },
    smoke: {
      command: "npm run test:smoke",
      passed: checksPassed,
      evidence: text(args.smokeCheckEvidence) || "TODO_SMOKE_CHECK_EVIDENCE",
    },
  },
  signoff: {
    signedOffBy: text(args.signedOffBy) || owner(),
    signedOffAt: signoffTimestamp(),
    evidence: text(args.signoffEvidence) || "TODO_SIGNOFF_EVIDENCE",
  },
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(draft, null, 2)}\n`);

const pendingEvidence = [
  ["provider.contractEvidence", draft.provider.contractEvidence],
  ["checkout.evidence", draft.checkout.evidence],
  ["webhook.evidence", draft.webhook.evidence],
  ["recurringBilling.evidence", draft.recurringBilling.evidence],
  ["security.evidence", draft.security.evidence],
  ["signoff.evidence", draft.signoff.evidence],
].filter(([, value]) => !evidenceReady(value));

console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      inferred: {
        providerName: draft.provider.name,
        checkoutBaseUrl: draft.checkout.baseUrl,
        webhookSecretStored: draft.webhook.secretStored,
        testEventIds: draft.webhook.testEventIds.length,
      },
      pendingEvidence: pendingEvidence.map(([key]) => key),
      nextAction:
        pendingEvidence.length === 0 && draft.webhook.secretStored
          ? `Run npm run payment-provider:handoff -- --file=${outPath}`
          : "strict handoff 전에 PG/VAN 증빙, webhook mapping, redirect 검증, billing custody, signoff를 채웁니다.",
    },
    null,
    2,
  ),
);
