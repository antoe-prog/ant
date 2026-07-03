import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const handoffPath = path.resolve(args.file ?? ".data/deployment-handoff.json");
const outPath = args.out ? path.resolve(args.out) : null;

const requiredEnvironmentVariables = [
  ["NODE_ENV", "config", "production"],
  ["FINAL_JUDO_DB_DRIVER", "config", "postgres"],
  ["FINAL_JUDO_POSTGRES_URL", "secret", null],
  ["FINAL_JUDO_POSTGRES_STATE_KEY", "config", null],
  ["FINAL_JUDO_POSTGRES_TABLE", "config", "app_runtime_state"],
  ["FINAL_JUDO_ENABLE_DEMO_LOGIN", "config", "0"],
  ["FINAL_JUDO_ENABLE_DEV_RESET", "config", "0"],
  ["FINAL_JUDO_PAYMENT_PROVIDER", "config", "external"],
  ["FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL", "config", null],
  ["FINAL_JUDO_PAYMENT_WEBHOOK_SECRET", "secret", null],
  ["FINAL_JUDO_VAPID_PUBLIC_KEY", "config", null],
  ["FINAL_JUDO_VAPID_PRIVATE_KEY", "secret", null],
  ["FINAL_JUDO_VAPID_SUBJECT", "config", null],
];

const evidenceReferencePattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;

const forbiddenValueKeys = new Set([
  "connectionString",
  "databaseUrl",
  "password",
  "plainText",
  "plaintext",
  "postgresUrl",
  "privateKey",
  "secret",
  "secretValue",
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
    return url.protocol === "https:" && !isPlaceholderProductionHost(url.hostname) && !isPlaceholder(value) ? url.origin : null;
  } catch {
    return null;
  }
}

function validateUrl(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && !isPlaceholderProductionHost(url.hostname) && !isPlaceholder(value) ? url.href : null;
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

function validateMailtoContact(value) {
  const contact = text(value);
  if (!contact.startsWith("mailto:") || isPlaceholder(contact)) {
    return false;
  }

  const address = contact.slice("mailto:".length);
  const [, domain = ""] = address.split("@");
  return Boolean(address && domain && !isPlaceholderProductionHost(domain));
}

function validateEvidence(blockers, code, label, value) {
  const evidence = text(value);
  if (!isEvidenceReference(evidence)) {
    addIssue(blockers, code, `${label} evidence must be an HTTPS URL or provider storage URI.`, { evidence: value ?? null });
  }
}

function isEvidenceReference(value) {
  const evidence = text(value);
  return Boolean(evidence && !isPlaceholder(evidence) && evidenceReferencePattern.test(evidence));
}

function validatePassedCheck(blockers, key, check, expectedCommand) {
  if (!check || typeof check !== "object") {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_CHECK_MISSING", "deployment handoff is missing a required check.", { key });
    return;
  }

  if (text(check.command) !== expectedCommand) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_CHECK_COMMAND", "deployment handoff check command does not match the release contract.", {
      key,
      command: check.command ?? null,
      expectedCommand,
    });
  }

  if (check.passed !== true) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_CHECK_NOT_PASSED", "deployment handoff check must be marked passed only after it succeeds.", { key });
  }

  validateEvidence(blockers, "DEPLOYMENT_HANDOFF_CHECK_EVIDENCE", `${key} check`, check.evidence);
}

async function readJson(filePath) {
  const source = await readFile(filePath, "utf8");
  return JSON.parse(source);
}

async function validatePreflightReport(blockers, check) {
  const reportPath = text(check?.reportPath);

  if (isPlaceholder(reportPath)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_PREFLIGHT_REPORT_PATH", "production preflight reportPath must point to a real JSON report.");
    return;
  }

  try {
    const report = await readJson(path.resolve(reportPath));
    const ready = report.ok === true || report.releaseDecision === "ready" || report.decision === "ready";

    if (!ready) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_PREFLIGHT_NOT_READY", "production preflight report must be ready.", {
        reportPath,
        ok: report.ok ?? null,
        decision: report.releaseDecision ?? report.decision ?? null,
      });
    }
  } catch (error) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_PREFLIGHT_UNREADABLE", "production preflight report must be readable JSON.", {
      reportPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
      const looksLikeConnectionString = /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i.test(child);
      const looksLikePrivateKey = child.includes("-----BEGIN") || (/^[A-Za-z0-9_-]{80,}$/.test(child) && normalizedKey.includes("key"));

      if (forbiddenValueKeys.has(normalizedKey) || looksLikeConnectionString || looksLikePrivateKey) {
        addIssue(blockers, "DEPLOYMENT_HANDOFF_RAW_SECRET_VALUE", "deployment handoff must not contain raw secret values.", {
          path: childTrail.join("."),
        });
      }
    }

    assertNoRawSecretValues(child, blockers, childTrail);
  }
}

function validateEnvironmentVariables(document, blockers) {
  const variables = Array.isArray(document.environmentVariables) ? document.environmentVariables : [];
  const byKey = new Map(variables.map((entry) => [text(entry?.key), entry]));

  for (const [key, classification, expectedValue] of requiredEnvironmentVariables) {
    const entry = byKey.get(key);

    if (!entry) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_ENV_MISSING", "deployment handoff is missing a required environment variable.", { key });
      continue;
    }

    if (entry.configured !== true) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_ENV_NOT_CONFIGURED", "required environment variable must be marked configured.", { key });
    }

    if (text(entry.classification) !== classification) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_ENV_CLASSIFICATION", "environment variable classification does not match the contract.", {
        key,
        classification: entry.classification ?? null,
        expected: classification,
      });
    }

    if (classification === "secret") {
      if (!["deployment-platform-secret-store", "ci-secret", "secret-manager"].includes(text(entry.storage))) {
        addIssue(blockers, "DEPLOYMENT_HANDOFF_SECRET_STORAGE", "secret variables must be stored in a secret store.", { key, storage: entry.storage ?? null });
      }

      if (isPlaceholder(entry.secretName) || text(entry.secretName) !== key) {
        addIssue(blockers, "DEPLOYMENT_HANDOFF_SECRET_NAME", "secretName must identify the deployment secret without exposing its value.", {
          key,
          secretName: entry.secretName ?? null,
        });
      }
    }

    if (expectedValue !== null && text(entry.expectedValue) !== expectedValue) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_ENV_EXPECTED_VALUE", "config expectedValue does not match the production contract.", {
        key,
        expectedValue: entry.expectedValue ?? null,
        expected: expectedValue,
      });
    }

    if (key === "FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL" && !validateHttpsOrigin(entry.expectedValue)) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_PAYMENT_CHECKOUT_URL", "payment checkout base URL must be a real HTTPS origin.", {
        key,
        expectedValue: entry.expectedValue ?? null,
      });
    }

    if (key === "FINAL_JUDO_VAPID_SUBJECT" && !validateMailtoContact(entry.expectedValue)) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_VAPID_SUBJECT", "VAPID subject must be a mailto contact.", {
        key,
        expectedValue: entry.expectedValue ?? null,
      });
    }

    validateEvidence(blockers, "DEPLOYMENT_HANDOFF_ENV_EVIDENCE", key, entry.evidence);
  }
}

async function validateHandoff(document, blockers) {
  if (document.schemaVersion !== 1) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_SCHEMA_VERSION", "deployment handoff schemaVersion must be 1.", { schemaVersion: document.schemaVersion ?? null });
  }

  const generatedAt = parseDateTime(document.generatedAt);
  if (!generatedAt || isPlaceholder(document.generatedAt)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_GENERATED_AT", "generatedAt must be a real ISO timestamp.", { generatedAt: document.generatedAt ?? null });
  }

  if (document.environment !== "production") {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_ENVIRONMENT", "deployment handoff must target production.", { environment: document.environment ?? null });
  }

  const deployment = document.deployment ?? {};
  if (isPlaceholder(deployment.platform)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_PLATFORM", "deployment platform must be filled.", { platform: deployment.platform ?? null });
  }

  if (!validateHttpsOrigin(deployment.productionOrigin)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_PRODUCTION_ORIGIN", "productionOrigin must be a real HTTPS production origin.", {
      productionOrigin: deployment.productionOrigin ?? null,
    });
  }

  if (!validateUrl(deployment.deploymentUrl)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_DEPLOYMENT_URL", "deploymentUrl must be a real HTTPS URL.", { deploymentUrl: deployment.deploymentUrl ?? null });
  }

  if (!/^[a-f0-9]{7,40}$/i.test(text(deployment.commitSha))) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_COMMIT_SHA", "commitSha must identify the deployed revision.", { commitSha: deployment.commitSha ?? null });
  }
  validateEvidence(blockers, "DEPLOYMENT_HANDOFF_DEPLOYMENT_EVIDENCE", "deployment", deployment.evidence);

  validateEnvironmentVariables(document, blockers);

  const database = document.database ?? {};
  for (const key of ["migrationApplied", "runtimeStoreVerified", "backupPlanVerified"]) {
    if (database[key] !== true) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_DATABASE", "database handoff must verify migrations, runtime store, and backup plan.", { key, value: database[key] ?? null });
    }
  }
  validateEvidence(blockers, "DEPLOYMENT_HANDOFF_DATABASE_EVIDENCE", "database", database.evidence);

  const payment = document.paymentProvider ?? {};
  if (payment.provider !== "external") {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_PAYMENT_PROVIDER", "payment provider must be external for production.", { provider: payment.provider ?? null });
  }
  if (!validateHttpsOrigin(payment.checkoutBaseUrl)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_PAYMENT_CHECKOUT", "payment checkoutBaseUrl must be a real HTTPS origin.", {
      checkoutBaseUrl: payment.checkoutBaseUrl ?? null,
    });
  }
  for (const key of ["webhookSecretStored", "providerEventIdMapped", "receiptUrlVerified", "recurringBillingContractVerified"]) {
    if (payment[key] !== true) {
      addIssue(blockers, "DEPLOYMENT_HANDOFF_PAYMENT", "payment provider handoff must verify provider settings and evidence.", {
        key,
        value: payment[key] ?? null,
      });
    }
  }
  validateEvidence(blockers, "DEPLOYMENT_HANDOFF_PAYMENT_EVIDENCE", "payment provider", payment.evidence);

  const push = document.pushNotifications ?? {};
  if (push.vapidKeysStored !== true || push.deviceSubscriptionVerified !== true || push.noticePushVerified !== true) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_PUSH", "push notification handoff must verify VAPID keys, device subscription, and notice push.", {
      vapidKeysStored: push.vapidKeysStored ?? null,
      deviceSubscriptionVerified: push.deviceSubscriptionVerified ?? null,
      noticePushVerified: push.noticePushVerified ?? null,
    });
  }
  if (!validateMailtoContact(push.subject)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_PUSH_SUBJECT", "push subject must be a real mailto contact.", { subject: push.subject ?? null });
  }
  validateEvidence(blockers, "DEPLOYMENT_HANDOFF_PUSH_EVIDENCE", "push notifications", push.evidence);

  const checks = document.checks ?? {};
  validatePassedCheck(blockers, "envReadiness", checks.envReadiness, "npm run test:env-readiness");
  validatePassedCheck(
    blockers,
    "productionPreflight",
    checks.productionPreflight,
    "NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json",
  );
  validatePassedCheck(blockers, "release", checks.release, "npm run test:release");
  await validatePreflightReport(blockers, checks.productionPreflight);

  const signoff = document.signoff ?? {};
  if (text(signoff.signedOffBy).length < 2 || isPlaceholder(signoff.signedOffBy)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_SIGNOFF_OWNER", "signoff.signedOffBy must be filled.");
  }
  const signedOffAt = parseDateTime(signoff.signedOffAt);
  if (!signedOffAt || isPlaceholder(signoff.signedOffAt)) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_SIGNOFF_AT", "signoff.signedOffAt must be a real ISO timestamp.", { signedOffAt: signoff.signedOffAt ?? null });
  }
  if (generatedAt && signedOffAt && signedOffAt < generatedAt) {
    addIssue(blockers, "DEPLOYMENT_HANDOFF_SIGNOFF_TIMELINE", "signoff.signedOffAt must be at or after generatedAt.", {
      generatedAt: document.generatedAt ?? null,
      signedOffAt: signoff.signedOffAt ?? null,
    });
  }
  validateEvidence(blockers, "DEPLOYMENT_HANDOFF_SIGNOFF_EVIDENCE", "signoff", signoff.evidence);

  assertNoRawSecretValues(document, blockers);
}

function buildPartialStatus(document, blockers) {
  const deployment = document?.deployment ?? {};
  const deploymentBlockerCodes = new Set([
    "DEPLOYMENT_HANDOFF_PLATFORM",
    "DEPLOYMENT_HANDOFF_PRODUCTION_ORIGIN",
    "DEPLOYMENT_HANDOFF_DEPLOYMENT_URL",
    "DEPLOYMENT_HANDOFF_COMMIT_SHA",
    "DEPLOYMENT_HANDOFF_DEPLOYMENT_EVIDENCE",
  ]);
  const deploymentBlockers = blockers.filter((blocker) => deploymentBlockerCodes.has(blocker.code));

  return {
    webDeployment: {
      ready:
        deploymentBlockers.length === 0 &&
        !isPlaceholder(deployment.platform) &&
        Boolean(validateHttpsOrigin(deployment.productionOrigin)) &&
        Boolean(validateUrl(deployment.deploymentUrl)) &&
        /^[a-f0-9]{7,40}$/i.test(text(deployment.commitSha)) &&
        isEvidenceReference(deployment.evidence),
      platform: text(deployment.platform) || null,
      productionOrigin: validateHttpsOrigin(deployment.productionOrigin),
      deploymentUrl: validateUrl(deployment.deploymentUrl),
      commitSha: text(deployment.commitSha) || null,
      evidence: text(deployment.evidence) || null,
      blockerCodes: deploymentBlockers.map((blocker) => blocker.code),
    },
  };
}

const blockers = [];
let handoff = null;

try {
  handoff = await readJson(handoffPath);
} catch (error) {
  addIssue(blockers, "DEPLOYMENT_HANDOFF_UNREADABLE", "deployment handoff JSON must be readable.", {
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
  partial: buildPartialStatus(handoff, blockers),
  checked: [
    "production deployment origin and revision",
    "required production environment variables without raw secrets",
    "PostgreSQL runtime store and backup evidence",
    "external payment provider settings and evidence",
    "VAPID push notification settings and device evidence",
    "env readiness, production preflight, and release evidence",
    "final deployment signoff",
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
