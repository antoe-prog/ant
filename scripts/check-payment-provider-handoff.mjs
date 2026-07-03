import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const handoffPath = path.resolve(args.file ?? ".data/payment-provider-handoff.json");
const outPath = args.out ? path.resolve(args.out) : null;

const allowedContractStatuses = new Set(["contracted", "pilot-contract"]);
const allowedEventIdFields = new Set(["providerEventId", "x-final-judo-payment-event-id"]);
const allowedBillingKeyCustody = new Set(["provider-vault", "secret-manager", "encrypted-db"]);
const evidenceReferencePattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;
const forbiddenValueKeys = new Set([
  "apikey",
  "authorization",
  "authorizationheader",
  "bearer",
  "clientsecret",
  "connectionstring",
  "databaseurl",
  "password",
  "plaintext",
  "postgresurl",
  "privatekey",
  "secret",
  "secretvalue",
  "token",
  "value",
]);

function parseArgs(argv) {
  const parsed = { allowPending: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--allow-pending") {
      parsed.allowPending = true;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--file") {
      parsed.file = value;
    } else if (key === "--out") {
      parsed.out = value;
    }
  }

  return parsed;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function addIssue(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
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

function parseDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text(value))) {
    return null;
  }

  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validateHttpsOrigin(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && !isPlaceholderProductionHost(url.hostname) && !isPlaceholder(value)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function isPlaceholderProductionHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return (
    ["localhost", "127.0.0.1", "0.0.0.0"].includes(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".test") ||
    host.endsWith(".example") ||
    host.endsWith(".example.com") ||
    host.includes("todo") ||
    host.includes("placeholder") ||
    host.includes("sample")
  );
}

function validateEvidence(blockers, code, label, value) {
  const evidence = text(value);
  if (!evidence || isPlaceholder(evidence) || !evidenceReferencePattern.test(evidence)) {
    addIssue(blockers, code, `${label} evidence must be an HTTPS URL or provider storage URI.`, { evidence: value ?? null });
  }
}

function validatePassedCheck(blockers, key, check, expectedCommand) {
  if (!check || typeof check !== "object") {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_CHECK_MISSING", "payment provider handoff is missing a required check.", { key });
    return;
  }

  if (text(check.command) !== expectedCommand) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_CHECK_COMMAND", "payment provider handoff check command does not match the release contract.", {
      key,
      command: check.command ?? null,
      expectedCommand,
    });
  }

  if (check.passed !== true) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_CHECK_NOT_PASSED", "payment provider handoff check must be marked passed only after it succeeds.", {
      key,
    });
  }

  validateEvidence(blockers, "PAYMENT_PROVIDER_HANDOFF_CHECK_EVIDENCE", `${key} check`, check.evidence);
}

async function readJson(filePath) {
  const source = await readFile(filePath, "utf8");
  return JSON.parse(source);
}

function assertNoRawSecretValues(value, blockers, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawSecretValues(item, blockers, [...trail, String(index)]));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childTrail = [...trail, key];
    const normalizedKey = key.toLowerCase();

    if (typeof child === "string") {
      const looksLikeConnectionString = /:\/\/[^:\s]+:[^@\s]+@/i.test(child);
      const looksLikePrivateKey = child.includes("-----BEGIN") || (/^[A-Za-z0-9_-]{80,}$/.test(child) && normalizedKey.includes("key"));
      const looksLikeProviderSecret = /(?:sk|pk|secret|token)_(?:live|test)_[A-Za-z0-9_-]{8,}/i.test(child);

      if (forbiddenValueKeys.has(normalizedKey) || looksLikeConnectionString || looksLikePrivateKey || looksLikeProviderSecret) {
        addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_RAW_SECRET_VALUE", "payment provider handoff must not contain raw secret values.", {
          path: childTrail.join("."),
        });
      }
    }

    assertNoRawSecretValues(child, blockers, childTrail);
  }
}

function validateUniqueEventIds(blockers, testEventIds) {
  if (!Array.isArray(testEventIds) || testEventIds.length === 0) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_TEST_EVENTS", "webhook.testEventIds must include at least one real provider event ID.");
    return;
  }

  const eventIds = testEventIds.map(text);
  const uniqueIds = new Set(eventIds);

  if (uniqueIds.size !== eventIds.length) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_DUPLICATE_EVENT_ID", "webhook.testEventIds must not contain duplicate provider event IDs.");
  }

  for (const eventId of eventIds) {
    if (isPlaceholder(eventId) || eventId.length < 6) {
      addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_TEST_EVENT_ID", "webhook.testEventIds must be filled with real provider event IDs.", {
        eventId,
      });
    }
  }
}

async function validateHandoff(document, blockers) {
  if (document.schemaVersion !== 1) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_SCHEMA_VERSION", "payment provider handoff schemaVersion must be 1.", {
      schemaVersion: document.schemaVersion ?? null,
    });
  }

  const generatedAt = parseDateTime(document.generatedAt);
  if (!generatedAt || isPlaceholder(document.generatedAt)) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_GENERATED_AT", "generatedAt must be a real ISO timestamp.", {
      generatedAt: document.generatedAt ?? null,
    });
  }

  const provider = document.provider ?? {};
  if (isPlaceholder(provider.name)) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_PROVIDER_NAME", "provider.name must identify the contracted PG/VAN provider.");
  }
  if (!allowedContractStatuses.has(text(provider.contractStatus))) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_CONTRACT_STATUS", "provider.contractStatus must be contracted or pilot-contract.", {
      contractStatus: provider.contractStatus ?? null,
    });
  }
  if (text(provider.contractOwner).length < 2 || isPlaceholder(provider.contractOwner)) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_CONTRACT_OWNER", "provider.contractOwner must be filled.");
  }
  validateEvidence(blockers, "PAYMENT_PROVIDER_HANDOFF_CONTRACT_EVIDENCE", "provider contract", provider.contractEvidence);

  const checkout = document.checkout ?? {};
  if (!validateHttpsOrigin(checkout.baseUrl)) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_CHECKOUT_BASE_URL", "checkout.baseUrl must be a real HTTPS payment checkout origin.", {
      baseUrl: checkout.baseUrl ?? null,
    });
  }
  for (const key of ["successRedirectVerified", "failureRedirectVerified", "receiptUrlVerified"]) {
    if (checkout[key] !== true) {
      addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_CHECKOUT_VERIFICATION", "checkout redirects and receipt URL must be verified.", {
        key,
        value: checkout[key] ?? null,
      });
    }
  }
  validateEvidence(blockers, "PAYMENT_PROVIDER_HANDOFF_CHECKOUT_EVIDENCE", "checkout", checkout.evidence);

  const webhook = document.webhook ?? {};
  if (text(webhook.endpointPath) !== "/api/v1/payments/webhook") {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_ENDPOINT", "webhook.endpointPath must match the implemented provider webhook route.", {
      endpointPath: webhook.endpointPath ?? null,
    });
  }
  if (text(webhook.secretName) !== "FINAL_JUDO_PAYMENT_WEBHOOK_SECRET") {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_SECRET_NAME", "webhook.secretName must reference the deployment secret name without exposing its value.", {
      secretName: webhook.secretName ?? null,
    });
  }
  if (webhook.secretStored !== true) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_SECRET_STORED", "webhook secret must be stored in a deployment secret store.", {
      secretStored: webhook.secretStored ?? null,
    });
  }
  if (isPlaceholder(webhook.signatureHeader)) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_SIGNATURE_HEADER", "webhook.signatureHeader must identify the provider signature header.");
  }
  if (isPlaceholder(webhook.signatureAlgorithm)) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_SIGNATURE_ALGORITHM", "webhook.signatureAlgorithm must identify the provider signature algorithm.");
  }
  if (!allowedEventIdFields.has(text(webhook.eventIdField))) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_EVENT_ID_FIELD", "webhook.eventIdField must map to the implemented event ID input.", {
      eventIdField: webhook.eventIdField ?? null,
    });
  }
  for (const key of ["statusField", "amountField", "receiptUrlField"]) {
    if (isPlaceholder(webhook[key])) {
      addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_FIELD_MAPPING", "webhook provider payload fields must be mapped.", {
        key,
        value: webhook[key] ?? null,
      });
    }
  }
  validateUniqueEventIds(blockers, webhook.testEventIds);
  for (const key of ["idempotencyVerified", "signatureVerified"]) {
    if (webhook[key] !== true) {
      addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_VERIFICATION", "webhook signature and idempotency must be verified.", {
        key,
        value: webhook[key] ?? null,
      });
    }
  }
  validateEvidence(blockers, "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_EVIDENCE", "webhook", webhook.evidence);

  const recurring = document.recurringBilling ?? {};
  if (recurring.enabled !== true) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_RECURRING_ENABLED", "recurringBilling.enabled must be true for automatic billing handoff.", {
      enabled: recurring.enabled ?? null,
    });
  }
  for (const key of ["billingKeyField", "mandateIdField", "nextChargeDatePolicy"]) {
    if (isPlaceholder(recurring[key])) {
      addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_RECURRING_MAPPING", "recurring billing provider fields and date policy must be mapped.", {
        key,
        value: recurring[key] ?? null,
      });
    }
  }
  if (!allowedBillingKeyCustody.has(text(recurring.billingKeyCustody))) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_RECURRING_CUSTODY", "billingKeyCustody must be provider-vault, secret-manager, or encrypted-db.", {
      billingKeyCustody: recurring.billingKeyCustody ?? null,
    });
  }
  if (recurring.cancelVerified !== true) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_RECURRING_CANCEL", "recurring billing cancellation must be verified.", {
      cancelVerified: recurring.cancelVerified ?? null,
    });
  }
  validateEvidence(blockers, "PAYMENT_PROVIDER_HANDOFF_RECURRING_EVIDENCE", "recurring billing", recurring.evidence);

  const security = document.security ?? {};
  for (const key of ["rawSecretsNotCommitted", "coachAmountMaskedVerified", "auditLogVerified"]) {
    if (security[key] !== true) {
      addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_SECURITY", "security checks must verify raw secret handling, coach masking, and audit logs.", {
        key,
        value: security[key] ?? null,
      });
    }
  }
  validateEvidence(blockers, "PAYMENT_PROVIDER_HANDOFF_SECURITY_EVIDENCE", "security", security.evidence);

  const checks = document.checks ?? {};
  validatePassedCheck(blockers, "onlinePayments", checks.onlinePayments, "npm run test:online-payments");
  validatePassedCheck(blockers, "recurringBilling", checks.recurringBilling, "npm run test:recurring-billing");
  validatePassedCheck(blockers, "smoke", checks.smoke, "npm run test:smoke");

  const signoff = document.signoff ?? {};
  if (text(signoff.signedOffBy).length < 2 || isPlaceholder(signoff.signedOffBy)) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_SIGNOFF_OWNER", "signoff.signedOffBy must be filled.");
  }
  const signedOffAt = parseDateTime(signoff.signedOffAt);
  if (!signedOffAt || isPlaceholder(signoff.signedOffAt)) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_SIGNOFF_AT", "signoff.signedOffAt must be a real ISO timestamp.", {
      signedOffAt: signoff.signedOffAt ?? null,
    });
  }
  if (generatedAt && signedOffAt && signedOffAt < generatedAt) {
    addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_SIGNOFF_TIMELINE", "signoff.signedOffAt must be at or after generatedAt.", {
      generatedAt: document.generatedAt ?? null,
      signedOffAt: signoff.signedOffAt ?? null,
    });
  }
  validateEvidence(blockers, "PAYMENT_PROVIDER_HANDOFF_SIGNOFF_EVIDENCE", "signoff", signoff.evidence);

  assertNoRawSecretValues(document, blockers);
}

const blockers = [];
let handoff = null;

try {
  handoff = await readJson(handoffPath);
} catch (error) {
  addIssue(blockers, "PAYMENT_PROVIDER_HANDOFF_UNREADABLE", "payment provider handoff JSON must be readable.", {
    path: handoffPath,
    error: error instanceof Error ? error.message : String(error),
  });
}

if (handoff) {
  await validateHandoff(handoff, blockers);
}

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  file: handoffPath,
  checked: [
    "contracted PG/VAN provider and owner evidence",
    "real HTTPS checkout origin, redirects, and receipt URL",
    "webhook endpoint, secret store reference, signature, and event ID idempotency",
    "recurring billing key and mandate custody policy",
    "coach payment masking, audit logs, and raw secret exclusion",
    "online payment, recurring billing, and smoke test evidence",
    "final payment provider signoff",
  ],
  blockers,
};

if (outPath) {
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));

if (!args.allowPending && blockers.length > 0) {
  process.exit(1);
}
