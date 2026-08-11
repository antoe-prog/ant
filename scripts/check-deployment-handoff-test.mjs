import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-deployment-handoff-"));

async function runHandoff(filePath, extraArgs = []) {
  const { stdout } = await execFile(process.execPath, ["scripts/check-deployment-handoff.mjs", `--file=${filePath}`, ...extraArgs], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

async function expectFailure(filePath) {
  try {
    await runHandoff(filePath);
  } catch (error) {
    assert.notEqual(error.code, 0, "invalid deployment handoff should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid deployment handoff unexpectedly passed");
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
    if (key === "evidence") {
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

const preflightReportPath = path.join(directory, "pilot-preflight.pre-pilot.json");
await writeFile(preflightReportPath, `${JSON.stringify({ ok: true, releaseDecision: "ready", blockers: [] }, null, 2)}\n`);

const environmentVariables = [
  ["NODE_ENV", "config", "production"],
  ["FINAL_JUDO_DB_DRIVER", "config", "postgres"],
  ["FINAL_JUDO_POSTGRES_URL", "secret", null],
  ["FINAL_JUDO_POSTGRES_STATE_KEY", "config", "final-judo-pilot"],
  ["FINAL_JUDO_POSTGRES_TABLE", "config", "app_runtime_state"],
  ["FINAL_JUDO_ENABLE_DEMO_LOGIN", "config", "0"],
  ["FINAL_JUDO_ENABLE_DEV_RESET", "config", "0"],
  ["FINAL_JUDO_PAYMENT_PROVIDER", "config", "external"],
  ["FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL", "config", "https://pay.finaljudo.kr"],
  ["FINAL_JUDO_PAYMENT_WEBHOOK_SECRET", "secret", null],
  ["FINAL_JUDO_VAPID_PUBLIC_KEY", "config", "configured-in-platform"],
  ["FINAL_JUDO_VAPID_PRIVATE_KEY", "secret", null],
  ["FINAL_JUDO_VAPID_SUBJECT", "config", "mailto:ops@finaljudo.kr"],
  ["CRON_SECRET", "secret", null],
].map(([key, classification, expectedValue]) => ({
  key,
  classification,
  storage: classification === "secret" ? "deployment-platform-secret-store" : "deployment-platform-env",
  configured: true,
  ...(classification === "secret" ? { secretName: key } : { expectedValue }),
  evidence: `https://evidence.finaljudo.kr/deployment/env/${key}.json`,
}));

const validHandoff = {
  schemaVersion: 1,
  generatedAt: "2026-07-16T04:00:00.000Z",
  environment: "production",
  deployment: {
    platform: "Vercel production project",
    productionOrigin: "https://app.finaljudo.kr",
    deploymentUrl: "https://ops-finaljudo-prod.vercel.app",
    commitSha: "abcdef1234567890",
    evidence: "https://evidence.finaljudo.kr/deployment/build-log",
  },
  environmentVariables,
  database: {
    migrationApplied: true,
    runtimeStoreVerified: true,
    backupPlanVerified: true,
    evidence: "drive://final-judo/evidence/deployment/database-handoff",
  },
  paymentProvider: {
    provider: "external",
    checkoutBaseUrl: "https://pay.finaljudo.kr",
    webhookSecretStored: true,
    providerEventIdMapped: true,
    receiptUrlVerified: true,
    recurringBillingContractVerified: true,
    evidence: "https://evidence.finaljudo.kr/deployment/payment-provider",
  },
  pushNotifications: {
    vapidKeysStored: true,
    subject: "mailto:ops@finaljudo.kr",
    deviceSubscriptionVerified: true,
    noticePushVerified: true,
    evidence: "https://evidence.finaljudo.kr/deployment/push-notifications",
  },
  checks: {
    envReadiness: {
      command: "npm run test:env-readiness",
      passed: true,
      evidence: "https://github.com/antoe-prog/ant/actions/runs/200",
    },
    productionPreflight: {
      command: "NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json",
      reportPath: preflightReportPath,
      passed: true,
      evidence: "drive://final-judo/evidence/deployment/pilot-preflight-json",
    },
    release: {
      command: "npm run test:release",
      passed: true,
      evidence: "https://github.com/antoe-prog/ant/actions/runs/201",
    },
  },
  signoff: {
    signedOffBy: "정유진",
    signedOffAt: "2026-07-16T04:30:00.000Z",
    evidence: "https://evidence.finaljudo.kr/deployment/signoff",
  },
};

const validPath = path.join(directory, "deployment-handoff.valid.json");
const validReportPath = path.join(directory, "deployment-handoff.report.json");
await writeFile(validPath, `${JSON.stringify(validHandoff, null, 2)}\n`);

const validReport = await runHandoff(validPath, [`--out=${validReportPath}`]);
assert.equal(validReport.ok, true);
assert.equal(validReport.releaseDecision, "ready");
assert.equal(validReport.partial.webDeployment.ready, true);
assert.equal(validReport.partial.webDeployment.productionOrigin, validHandoff.deployment.productionOrigin);
assert.equal(validReport.partial.webDeployment.deploymentUrl, new URL(validHandoff.deployment.deploymentUrl).href);
assert.equal(JSON.parse(await readFile(validReportPath, "utf8")).ok, true);

const validNativeHandoff = structuredClone(validHandoff);
validNativeHandoff.schemaVersion = 2;
validNativeHandoff.environmentVariables = validNativeHandoff.environmentVariables.filter(
  (entry) => !entry.key.startsWith("FINAL_JUDO_VAPID_"),
);
validNativeHandoff.pushNotifications = {
  providers: ["apns", "fcm"],
  providerHandoffVerified: true,
  deviceSubscriptionVerified: true,
  noticePushVerified: true,
  evidence: "https://evidence.finaljudo.kr/deployment/native-push-notifications",
};
const validNativePath = path.join(directory, "deployment-handoff.native-valid.json");
await writeFile(validNativePath, `${JSON.stringify(validNativeHandoff, null, 2)}\n`);
const validNativeReport = await runHandoff(validNativePath);
assert.equal(validNativeReport.ok, true, "native APNs/FCM deployment handoff must not require Web Push VAPID settings");
assert(!validNativeReport.blockers.some((blocker) => blocker.code.includes("VAPID")));

const partialWebDeploymentPath = path.join(directory, "deployment-handoff.partial-web-deployment.json");
const partialWebDeploymentHandoff = structuredClone(validHandoff);
partialWebDeploymentHandoff.environmentVariables = [];
partialWebDeploymentHandoff.database.migrationApplied = false;
partialWebDeploymentHandoff.paymentProvider.webhookSecretStored = false;
partialWebDeploymentHandoff.pushNotifications.vapidKeysStored = false;
await writeFile(partialWebDeploymentPath, `${JSON.stringify(partialWebDeploymentHandoff, null, 2)}\n`);
const partialWebDeploymentReport = await runHandoff(partialWebDeploymentPath, ["--allow-pending"]);
assert.equal(partialWebDeploymentReport.ok, false);
assert.equal(partialWebDeploymentReport.releaseDecision, "blocked");
assert.equal(partialWebDeploymentReport.partial.webDeployment.ready, true);
assert(partialWebDeploymentReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_ENV_MISSING"));
assert(partialWebDeploymentReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_DATABASE"));
assert(partialWebDeploymentReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_PAYMENT"));
assert(partialWebDeploymentReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_PUSH"));

const placeholderOriginPath = path.join(directory, "deployment-handoff.placeholder-origin.json");
const placeholderOriginHandoff = structuredClone(validHandoff);
placeholderOriginHandoff.deployment.productionOrigin = "https://ops.finaljudo.example";
placeholderOriginHandoff.paymentProvider.checkoutBaseUrl = "https://pay.finaljudo.example";
placeholderOriginHandoff.pushNotifications.subject = "mailto:ops@example.com";
placeholderOriginHandoff.environmentVariables = placeholderOriginHandoff.environmentVariables.map((entry) => {
  if (entry.key === "FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL") {
    return { ...entry, expectedValue: "https://pay.finaljudo.example" };
  }

  if (entry.key === "FINAL_JUDO_VAPID_SUBJECT") {
    return { ...entry, expectedValue: "mailto:ops@example.com" };
  }

  return entry;
});
await writeFile(placeholderOriginPath, `${JSON.stringify(placeholderOriginHandoff, null, 2)}\n`);
const placeholderOriginReport = await expectFailure(placeholderOriginPath);
assert(placeholderOriginReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_PRODUCTION_ORIGIN"));
assert(placeholderOriginReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_PAYMENT_CHECKOUT"));
assert(placeholderOriginReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_PUSH_SUBJECT"));
assert.equal(placeholderOriginReport.partial.webDeployment.ready, false);

const templateReport = await runHandoff("docs/deployment-handoff.template.json", ["--allow-pending"]);
assert.equal(templateReport.ok, false);
assert(templateReport.blockers.some((blocker) => blocker.code.startsWith("DEPLOYMENT_HANDOFF_")));
await assertEvidenceUriTemplate("docs/deployment-handoff.template.json");

const missingEnvPath = path.join(directory, "deployment-handoff.missing-env.json");
const missingEnvHandoff = structuredClone(validHandoff);
missingEnvHandoff.environmentVariables = missingEnvHandoff.environmentVariables.filter((entry) => entry.key !== "FINAL_JUDO_PAYMENT_WEBHOOK_SECRET");
await writeFile(missingEnvPath, `${JSON.stringify(missingEnvHandoff, null, 2)}\n`);
const missingEnvReport = await expectFailure(missingEnvPath);
assert(missingEnvReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_ENV_MISSING"));

const rawSecretPath = path.join(directory, "deployment-handoff.raw-secret.json");
const rawSecretHandoff = structuredClone(validHandoff);
rawSecretHandoff.environmentVariables.find((entry) => entry.key === "FINAL_JUDO_POSTGRES_URL").value =
  "postgresql://final_judo:super-secret@db.example.com:5432/final_judo";
await writeFile(rawSecretPath, `${JSON.stringify(rawSecretHandoff, null, 2)}\n`);
const rawSecretReport = await expectFailure(rawSecretPath);
assert(rawSecretReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_RAW_SECRET_VALUE"));

const looseEvidencePath = path.join(directory, "deployment-handoff.loose-evidence.json");
const looseEvidenceHandoff = structuredClone(validHandoff);
looseEvidenceHandoff.deployment.evidence = "production deployment page and build log receipt";
await writeFile(looseEvidencePath, `${JSON.stringify(looseEvidenceHandoff, null, 2)}\n`);
const looseEvidenceReport = await expectFailure(looseEvidencePath);
assert(looseEvidenceReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_DEPLOYMENT_EVIDENCE"));

const blockedPreflightPath = path.join(directory, "pilot-preflight.blocked.json");
await writeFile(blockedPreflightPath, `${JSON.stringify({ ok: false, releaseDecision: "blocked", blockers: [{ code: "DEFAULT_PASSWORD_ACTIVE" }] }, null, 2)}\n`);
const blockedPreflightHandoffPath = path.join(directory, "deployment-handoff.blocked-preflight.json");
const blockedPreflightHandoff = structuredClone(validHandoff);
blockedPreflightHandoff.checks.productionPreflight.reportPath = blockedPreflightPath;
await writeFile(blockedPreflightHandoffPath, `${JSON.stringify(blockedPreflightHandoff, null, 2)}\n`);
const blockedPreflightReport = await expectFailure(blockedPreflightHandoffPath);
assert(blockedPreflightReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_PREFLIGHT_NOT_READY"));

const looseTimestampPath = path.join(directory, "deployment-handoff.loose-timestamp.json");
const looseTimestampHandoff = structuredClone(validHandoff);
looseTimestampHandoff.generatedAt = "July 16, 2026 04:00";
looseTimestampHandoff.signoff.signedOffAt = "July 16, 2026 04:30";
await writeFile(looseTimestampPath, `${JSON.stringify(looseTimestampHandoff, null, 2)}\n`);
const looseTimestampReport = await expectFailure(looseTimestampPath);
assert(looseTimestampReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_GENERATED_AT"));
assert(looseTimestampReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_SIGNOFF_AT"));

const signoffBeforeGeneratedPath = path.join(directory, "deployment-handoff.signoff-before-generated.json");
const signoffBeforeGeneratedHandoff = structuredClone(validHandoff);
signoffBeforeGeneratedHandoff.signoff.signedOffAt = "2026-07-16T03:59:59.000Z";
await writeFile(signoffBeforeGeneratedPath, `${JSON.stringify(signoffBeforeGeneratedHandoff, null, 2)}\n`);
const signoffBeforeGeneratedReport = await expectFailure(signoffBeforeGeneratedPath);
assert(signoffBeforeGeneratedReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_SIGNOFF_TIMELINE"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "valid production deployment handoff",
        "native APNs/FCM deployment handoff without Web Push VAPID",
        "report output",
        "partial web deployment evidence while strict handoff remains blocked",
        "placeholder production/payment/push origin blockers",
        "template pending blocker coverage",
        "template evidence URI placeholders",
        "missing required environment variable blocker",
        "raw secret value blocker",
        "non-reference evidence blocker",
        "blocked production preflight report blocker",
        "non-ISO timestamp blocker",
        "signoff before generatedAt blocker",
      ],
    },
    null,
    2,
  ),
);
