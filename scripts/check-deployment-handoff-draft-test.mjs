import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-deployment-handoff-draft-"));

async function runScript(scriptPath, args = [], env = {}) {
  const { stdout } = await execFile(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout);
}

const preflightReportPath = path.join(directory, "pilot-preflight.pre-pilot.json");
await writeFile(preflightReportPath, `${JSON.stringify({ ok: true, releaseDecision: "ready", blockers: [] }, null, 2)}\n`);

const draftPath = path.join(directory, "deployment-handoff.json");
const secretEnv = {
  NODE_ENV: "production",
  FINAL_JUDO_DB_DRIVER: "postgres",
  FINAL_JUDO_POSTGRES_URL: "postgresql://final_judo:super-secret@db.finaljudo.internal:5432/final_judo",
  FINAL_JUDO_POSTGRES_STATE_KEY: "final-judo-pilot",
  FINAL_JUDO_POSTGRES_TABLE: "app_runtime_state",
  FINAL_JUDO_ENABLE_DEMO_LOGIN: "0",
  FINAL_JUDO_ENABLE_DEV_RESET: "0",
  FINAL_JUDO_PAYMENT_PROVIDER: "external",
  FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "https://pay.finaljudo.kr",
  FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "provider-webhook-secret",
  FINAL_JUDO_VAPID_PUBLIC_KEY: "B".repeat(88),
  FINAL_JUDO_VAPID_PRIVATE_KEY: "C".repeat(88),
  FINAL_JUDO_VAPID_SUBJECT: "mailto:ops@finaljudo.kr",
  CRON_SECRET: "cron-secret-for-test-only",
};

const draftReport = await runScript(
  "scripts/create-deployment-handoff-draft.mjs",
  [
    `--out=${draftPath}`,
    "--platform=Vercel production project",
    "--production-origin=https://app.finaljudo.kr",
    "--deployment-url=https://ops-finaljudo-prod.vercel.app",
    "--commit-sha=abcdef1234567890",
    "--deployment-evidence=https://evidence.finaljudo.kr/deployment/build-log",
    `--preflight-report=${preflightReportPath}`,
    "--env-evidence=https://evidence.finaljudo.kr/deployment/env",
    "--secret-evidence=drive://final-judo/evidence/deployment/secrets",
    "--database-evidence=drive://final-judo/evidence/deployment/database-handoff",
    "--payment-evidence=https://evidence.finaljudo.kr/deployment/payment-provider",
    "--push-evidence=https://evidence.finaljudo.kr/deployment/push-notifications",
    "--env-readiness-evidence=https://github.com/antoe-prog/ant/actions/runs/200",
    "--preflight-evidence=drive://final-judo/evidence/deployment/pilot-preflight-json",
    "--release-evidence=https://github.com/antoe-prog/ant/actions/runs/201",
    "--signed-off-by=정유진",
    "--signed-off-at=2026-07-16T04:30:00.000Z",
    "--signoff-evidence=https://evidence.finaljudo.kr/deployment/signoff",
  ],
  secretEnv,
);

assert.equal(draftReport.ok, true);
assert.equal(draftReport.inferred.preflightReady, true);
assert.deepEqual(draftReport.missingEnvironmentVariables, []);
assert(draftReport.configuredSecrets.includes("FINAL_JUDO_POSTGRES_URL"));
assert(draftReport.configuredSecrets.includes("FINAL_JUDO_PAYMENT_WEBHOOK_SECRET"));
assert(draftReport.configuredSecrets.includes("FINAL_JUDO_VAPID_PRIVATE_KEY"));
assert(draftReport.configuredSecrets.includes("CRON_SECRET"));

const draft = JSON.parse(await readFile(draftPath, "utf8"));
const draftSource = JSON.stringify(draft);
assert(!draftSource.includes("super-secret"), "draft must not write raw PostgreSQL passwords");
assert(!draftSource.includes("provider-webhook-secret"), "draft must not write raw webhook secrets");
assert(!draftSource.includes("C".repeat(88)), "draft must not write raw VAPID private keys");
assert(!draftSource.includes("cron-secret-for-test-only"), "draft must not write raw cron secrets");

const postgresUrlEntry = draft.environmentVariables.find((entry) => entry.key === "FINAL_JUDO_POSTGRES_URL");
assert.equal(postgresUrlEntry.secretName, "FINAL_JUDO_POSTGRES_URL");
assert.equal(postgresUrlEntry.value, undefined);
assert.equal(draft.paymentProvider.checkoutBaseUrl, "https://pay.finaljudo.kr");
assert.equal(draft.pushNotifications.subject, "mailto:ops@finaljudo.kr");

const handoffReport = await runScript("scripts/check-deployment-handoff.mjs", [`--file=${draftPath}`]);
assert.equal(handoffReport.ok, true);

const missingDraftPath = path.join(directory, "deployment-handoff.missing.json");
const missingDraftReport = await runScript("scripts/create-deployment-handoff-draft.mjs", [`--out=${missingDraftPath}`], {
  NODE_ENV: "",
  FINAL_JUDO_POSTGRES_URL: "",
  FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "",
  FINAL_JUDO_VAPID_PRIVATE_KEY: "",
});
assert(missingDraftReport.missingEnvironmentVariables.includes("FINAL_JUDO_POSTGRES_URL"));
assert(missingDraftReport.missingEnvironmentVariables.includes("FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL"));

const missingHandoffReport = await runScript("scripts/check-deployment-handoff.mjs", [`--file=${missingDraftPath}`, "--allow-pending"]);
assert.equal(missingHandoffReport.ok, false);
assert(missingHandoffReport.blockers.some((blocker) => blocker.code === "DEPLOYMENT_HANDOFF_ENV_NOT_CONFIGURED"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "draft infers deployment config without writing raw secrets",
        "draft can pass strict deployment handoff when evidence is supplied",
        "missing secret/config placeholders remain blocked",
      ],
    },
    null,
    2,
  ),
);
