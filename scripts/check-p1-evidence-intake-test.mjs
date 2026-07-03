import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(os.tmpdir(), "final-judo-p1-evidence-intake-check-"));

function filePath(name) {
  return path.join(directory, name);
}

function readinessArgs(paths) {
  return [
    `--deployment-report=${paths.deployment}`,
    `--android-report=${paths.android}`,
    `--ios-ipa-report=${paths.iosIpa}`,
    `--payment-provider-report=${paths.paymentProvider}`,
    `--notification-push-report=${paths.notificationPush}`,
    `--issue-registration-report=${paths.issueRegistration}`,
    `--pilot-status=${paths.pilot}`,
  ];
}

async function runScript(args) {
  const { stdout } = await execFile(process.execPath, args, { cwd: process.cwd() });
  return JSON.parse(stdout);
}

async function expectFailure(args) {
  try {
    await runScript(args);
  } catch (error) {
    assert.notEqual(error.code, 0, "invalid P1 evidence intake should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid P1 evidence intake unexpectedly passed");
}

async function writeReadyReport(targetPath, label, generatedAt = "2026-07-01T05:00:00.000Z") {
  await writeFile(
    targetPath,
    `${JSON.stringify(
      {
        ok: true,
        releaseDecision: "ready",
        generatedAt,
        checked: [`${label} ready fixture`],
        blockers: [],
      },
      null,
      2,
    )}\n`,
  );
}

async function createReadyFixture(prefix = "") {
  const paths = {
    deployment: filePath(`${prefix}deployment-handoff.report.json`),
    android: filePath(`${prefix}android-release-handoff.report.json`),
    iosIpa: filePath(`${prefix}ios-ipa-build-report.json`),
    paymentProvider: filePath(`${prefix}payment-provider-handoff.report.json`),
    notificationPush: filePath(`${prefix}notification-push-handoff.report.json`),
    issueRegistration: filePath(`${prefix}p1-handoff-issue-registration-report.json`),
    pilot: filePath(`${prefix}pilot-status.json`),
  };

  await writeReadyReport(paths.deployment, "deployment");
  await writeReadyReport(paths.android, "android");
  await writeReadyReport(paths.iosIpa, "ios ipa");
  await writeReadyReport(paths.paymentProvider, "payment provider");
  await writeReadyReport(paths.notificationPush, "notification push");
  await writeReadyReport(paths.issueRegistration, "issue registration receipt");
  await writeReadyReport(paths.pilot, "pilot");

  const readiness = filePath(`${prefix}p1-readiness.json`);
  await runScript(["scripts/check-p1-readiness.mjs", ...readinessArgs(paths), `--out=${readiness}`]);

  const intake = filePath(`${prefix}p1-evidence-intake-draft.json`);
  await runScript([
    "scripts/create-p1-evidence-intake-draft.mjs",
    `--workspace=${directory}`,
    `--readiness=${readiness}`,
    `--json=${intake}`,
    `--csv=${filePath(`${prefix}p1-evidence-intake-draft.csv`)}`,
    `--markdown=${filePath(`${prefix}p1-evidence-intake-draft.md`)}`,
  ]);

  return { paths, readiness, intake };
}

async function completedIntake(sourcePath, targetPath) {
  const intake = JSON.parse(await readFile(sourcePath, "utf8"));

  intake.rows = intake.rows.map((row, index) => ({
    ...row,
    intake: {
      evidenceOwner: `${row.lane} owner`,
      evidenceUrl: `https://evidence.finaljudo.test/p1/${index + 1}-${row.key}`,
      checkedAt: `2026-07-0${index + 1}T09:00:00.000Z`,
      signoff: `https://signoff.finaljudo.test/p1/${index + 1}-${row.key}`,
    },
  }));

  await writeFile(targetPath, `${JSON.stringify(intake, null, 2)}\n`);
  return intake;
}

const ready = await createReadyFixture();
const draftFailure = await expectFailure([
  "scripts/check-p1-evidence-intake.mjs",
  `--file=${ready.intake}`,
  `--readiness=${ready.readiness}`,
  `--out=${filePath("p1-evidence-intake-draft-report.json")}`,
]);
assert(draftFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_OWNER_MISSING"));
assert(draftFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_EVIDENCE_URL_MISSING"));
assert(draftFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_SIGNOFF_MISSING"));

const completedPath = filePath("p1-evidence-intake.completed.json");
await completedIntake(ready.intake, completedPath);
const reportPath = filePath("p1-evidence-intake-report.json");
const readyReport = await runScript([
  "scripts/check-p1-evidence-intake.mjs",
  `--file=${completedPath}`,
  `--readiness=${ready.readiness}`,
  `--out=${reportPath}`,
]);
assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert.equal(readyReport.summary.rows, 7);
assert.equal(readyReport.summary.readyRows, 7);
assert.equal(readyReport.artifacts.intake.sha256.length, 64);
assert.equal(JSON.parse(await readFile(reportPath, "utf8")).ok, true);

const blockedReadiness = filePath("p1-readiness.blocked.json");
const blockedReadinessSource = JSON.parse(await readFile(ready.readiness, "utf8"));
blockedReadinessSource.ok = false;
blockedReadinessSource.releaseDecision = "blocked";
blockedReadinessSource.summary.ready = 6;
blockedReadinessSource.summary.blocked = 1;
blockedReadinessSource.blockers = [{ code: "P1_READINESS_REPORT_BLOCKED" }];
await writeFile(blockedReadiness, `${JSON.stringify(blockedReadinessSource, null, 2)}\n`);
const blockedReadinessReport = await expectFailure([
  "scripts/check-p1-evidence-intake.mjs",
  `--file=${completedPath}`,
  `--readiness=${blockedReadiness}`,
]);
assert(blockedReadinessReport.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_READINESS_NOT_READY"));

const tamperedPath = filePath("p1-evidence-intake.tampered.json");
const tampered = JSON.parse(await readFile(completedPath, "utf8"));
tampered.rows[0].lane = "Wrong lane";
await writeFile(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
const tamperedReport = await expectFailure([
  "scripts/check-p1-evidence-intake.mjs",
  `--file=${tamperedPath}`,
  `--readiness=${ready.readiness}`,
]);
assert(tamperedReport.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_ROW_IDENTITY_MISMATCH"));

const secretPath = filePath("p1-evidence-intake.secret.json");
const secret = JSON.parse(await readFile(completedPath, "utf8"));
secret.rows[0].intake.evidenceUrl = "https://evidence.finaljudo.test/?secret=whsec_live_SUPERSECRET";
secret.rows[1].intake.signoff = "https://signoff.finaljudo.test/FinalJudoPilot!2026";
await writeFile(secretPath, `${JSON.stringify(secret, null, 2)}\n`);
const secretReport = await expectFailure([
  "scripts/check-p1-evidence-intake.mjs",
  `--file=${secretPath}`,
  `--readiness=${ready.readiness}`,
]);
assert(secretReport.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_SECRET_VALUE"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "draft intake remains blocked until owner/evidence/signoff fields are filled",
        "completed intake passes when source P1 readiness is ready",
        "blocked readiness keeps completed intake blocked",
        "fixed row contract mismatches are rejected",
        "raw secret-like values are rejected from intake submissions",
      ],
    },
    null,
    2,
  ),
);
