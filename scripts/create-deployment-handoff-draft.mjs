import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(args.out ?? ".data/deployment-handoff.json");
const evidenceReferencePattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;

const envContracts = [
  { key: "NODE_ENV", classification: "config", fallback: "production" },
  { key: "FINAL_JUDO_DB_DRIVER", classification: "config", fallback: "postgres" },
  { key: "FINAL_JUDO_POSTGRES_URL", classification: "secret" },
  { key: "FINAL_JUDO_POSTGRES_STATE_KEY", classification: "config", fallback: "mvp" },
  { key: "FINAL_JUDO_POSTGRES_TABLE", classification: "config", fallback: "app_runtime_state" },
  { key: "FINAL_JUDO_ENABLE_DEMO_LOGIN", classification: "config", fallback: "0" },
  { key: "FINAL_JUDO_ENABLE_DEV_RESET", classification: "config", fallback: "0" },
  { key: "FINAL_JUDO_PAYMENT_PROVIDER", classification: "config", fallback: "external" },
  { key: "FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL", classification: "config", arg: "paymentCheckoutBaseUrl" },
  { key: "FINAL_JUDO_PAYMENT_WEBHOOK_SECRET", classification: "secret" },
  { key: "FINAL_JUDO_VAPID_PUBLIC_KEY", classification: "config", redactConfiguredValue: true },
  { key: "FINAL_JUDO_VAPID_PRIVATE_KEY", classification: "secret" },
  { key: "FINAL_JUDO_VAPID_SUBJECT", classification: "config", arg: "vapidSubject" },
  { key: "CRON_SECRET", classification: "secret" },
];

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

function safeConfigValue(contract) {
  const explicitArg = contract.arg ? text(args[contract.arg]) : "";
  const envValue = text(process.env[contract.key]);

  if (contract.redactConfiguredValue) {
    return explicitArg || (envValue && !isPlaceholder(envValue) ? "configured-in-platform" : `TODO_${contract.key}`);
  }

  return explicitArg || envValue || contract.fallback || `TODO_${contract.key}`;
}

function isConfigured(contract) {
  if (contract.classification === "secret") {
    return Boolean(text(process.env[contract.key]) && !isPlaceholder(process.env[contract.key]));
  }

  return Boolean(text(safeConfigValue(contract)) && !isPlaceholder(safeConfigValue(contract)));
}

function envEvidence(contract) {
  return contract.classification === "secret" ? args.secretEvidence ?? "TODO_SECRET_EVIDENCE" : args.envEvidence ?? "TODO_ENV_EVIDENCE";
}

function envEntry(contract) {
  const configured = isConfigured(contract);
  const base = {
    key: contract.key,
    classification: contract.classification,
    storage: contract.classification === "secret" ? args.secretStorage ?? "deployment-platform-secret-store" : args.envStorage ?? "deployment-platform-env",
    configured,
    evidence: envEvidence(contract),
  };

  if (contract.classification === "secret") {
    return {
      ...base,
      secretName: contract.key,
    };
  }

  return {
    ...base,
    expectedValue: safeConfigValue(contract),
  };
}

async function readJsonIfExists(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch {
    return null;
  }
}

async function inferCommitSha() {
  if (text(args.commitSha)) {
    return text(args.commitSha);
  }

  if (text(process.env.GITHUB_SHA)) {
    return text(process.env.GITHUB_SHA).slice(0, 40);
  }

  try {
    const { stdout } = await execFile("git", ["rev-parse", "--short=12", "HEAD"], { cwd: process.cwd() });
    return stdout.trim();
  } catch {
    return "TODO_COMMIT_SHA";
  }
}

function preflightReady(report) {
  return Boolean(report && (report.ok === true || report.releaseDecision === "ready" || report.decision === "ready"));
}

const preflightReportPath = args.preflightReport ?? ".data/pilot-preflight.pre-pilot.json";
const preflightReport = await readJsonIfExists(preflightReportPath);
const preflightPassed = preflightReady(preflightReport);
const databaseEvidenceReady = evidenceReady(args.databaseEvidence);
const paymentEvidenceReady = evidenceReady(args.paymentEvidence);
const pushEvidenceReady = evidenceReady(args.pushEvidence);
const productionOrigin = args.productionOrigin ?? process.env.FINAL_JUDO_PRODUCTION_ORIGIN ?? "https://TODO-PRODUCTION-HOST";
const paymentCheckoutBaseUrl = safeConfigValue(envContracts.find((contract) => contract.key === "FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL"));
const vapidSubject = safeConfigValue(envContracts.find((contract) => contract.key === "FINAL_JUDO_VAPID_SUBJECT"));
const signedOffBy = args.signedOffBy ?? "TODO_OWNER";
const signedOffAt = args.signedOffAt ?? (signedOffBy === "TODO_OWNER" ? "TODO_ISO_TIMESTAMP" : new Date().toISOString());

const handoff = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: "production",
  deployment: {
    platform: args.platform ?? "TODO_DEPLOYMENT_PLATFORM",
    productionOrigin,
    deploymentUrl: args.deploymentUrl ?? productionOrigin,
    commitSha: await inferCommitSha(),
    evidence: args.deploymentEvidence ?? "TODO_DEPLOYMENT_EVIDENCE",
  },
  environmentVariables: envContracts.map(envEntry),
  database: {
    migrationApplied: databaseEvidenceReady,
    runtimeStoreVerified: databaseEvidenceReady,
    backupPlanVerified: databaseEvidenceReady,
    evidence: args.databaseEvidence ?? "TODO_DATABASE_EVIDENCE",
  },
  paymentProvider: {
    provider: process.env.FINAL_JUDO_PAYMENT_PROVIDER || "external",
    checkoutBaseUrl: paymentCheckoutBaseUrl,
    webhookSecretStored: Boolean(text(process.env.FINAL_JUDO_PAYMENT_WEBHOOK_SECRET) && !isPlaceholder(process.env.FINAL_JUDO_PAYMENT_WEBHOOK_SECRET)),
    providerEventIdMapped: paymentEvidenceReady,
    receiptUrlVerified: paymentEvidenceReady,
    recurringBillingContractVerified: paymentEvidenceReady,
    evidence: args.paymentEvidence ?? "TODO_PAYMENT_EVIDENCE",
  },
  pushNotifications: {
    vapidKeysStored: Boolean(
      text(process.env.FINAL_JUDO_VAPID_PUBLIC_KEY) &&
        !isPlaceholder(process.env.FINAL_JUDO_VAPID_PUBLIC_KEY) &&
        text(process.env.FINAL_JUDO_VAPID_PRIVATE_KEY) &&
        !isPlaceholder(process.env.FINAL_JUDO_VAPID_PRIVATE_KEY),
    ),
    subject: vapidSubject,
    deviceSubscriptionVerified: pushEvidenceReady,
    noticePushVerified: pushEvidenceReady,
    evidence: args.pushEvidence ?? "TODO_PUSH_EVIDENCE",
  },
  checks: {
    envReadiness: {
      command: "npm run test:env-readiness",
      passed: evidenceReady(args.envReadinessEvidence),
      evidence: args.envReadinessEvidence ?? "TODO_ENV_READINESS_EVIDENCE",
    },
    productionPreflight: {
      command: "NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json",
      reportPath: preflightReportPath,
      passed: preflightPassed,
      evidence: args.preflightEvidence ?? "TODO_PREFLIGHT_EVIDENCE",
    },
    release: {
      command: "npm run test:release",
      passed: evidenceReady(args.releaseEvidence),
      evidence: args.releaseEvidence ?? "TODO_RELEASE_EVIDENCE",
    },
  },
  signoff: {
    signedOffBy,
    signedOffAt,
    evidence: args.signoffEvidence ?? "TODO_SIGNOFF_EVIDENCE",
  },
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(handoff, null, 2)}\n`);

const configuredSecrets = envContracts
  .filter((contract) => contract.classification === "secret" && isConfigured(contract))
  .map((contract) => contract.key);
const missingEnvironmentVariables = handoff.environmentVariables.filter((entry) => entry.configured !== true).map((entry) => entry.key);

console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      inferred: {
        productionOrigin,
        paymentCheckoutBaseUrl,
        vapidSubject,
        preflightReady: preflightPassed,
      },
      configuredSecrets,
      missingEnvironmentVariables,
      nextAction:
        missingEnvironmentVariables.length === 0 && preflightPassed
          ? `Run npm run deployment:handoff -- --file=${outPath}`
          : "strict handoff 전에 배포 secret/evidence를 채우고 운영 preflight를 실행합니다.",
    },
    null,
    2,
  ),
);
