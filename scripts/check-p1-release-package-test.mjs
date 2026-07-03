import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-release-package-"));

function filePath(name) {
  return path.join(directory, name);
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
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

function packageArgs(paths, readiness, evidenceIntake, extra = []) {
  return [
    "scripts/check-p1-release-package.mjs",
    `--readiness=${readiness}`,
    `--evidence-intake-report=${evidenceIntake}`,
    `--deployment-report=${paths.deployment}`,
    `--android-report=${paths.android}`,
    `--ios-ipa-report=${paths.iosIpa}`,
    `--payment-provider-report=${paths.paymentProvider}`,
    `--notification-push-report=${paths.notificationPush}`,
    `--issue-registration-report=${paths.issueRegistration}`,
    `--pilot-status=${paths.pilot}`,
    ...extra,
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
    assert.notEqual(error.code, 0, "invalid P1 release package should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid P1 release package unexpectedly passed");
}

async function writeReadyReport(targetPath, label, generatedAt = "2026-06-01T05:00:00.000Z") {
  await mkdir(path.dirname(targetPath), { recursive: true });
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

async function writeCompletedIntake(sourcePath, targetPath) {
  const intake = JSON.parse(await readFile(sourcePath, "utf8"));

  intake.rows = intake.rows.map((row, index) => ({
    ...row,
    intake: {
      evidenceOwner: `${row.lane} owner`,
      evidenceUrl: `https://evidence.finaljudo.test/release/${index + 1}-${row.key}`,
      checkedAt: `2026-06-0${index + 1}T09:00:00.000Z`,
      signoff: `https://signoff.finaljudo.test/release/${index + 1}-${row.key}`,
    },
  }));

  await writeFile(targetPath, `${JSON.stringify(intake, null, 2)}\n`);
}

async function createReadyFixture(prefix = "") {
  const paths = {
    deployment: filePath(`${prefix}deployment-handoff.report.json`),
    android: filePath(`${prefix}android-release-handoff.report.json`),
    iosIpa: filePath(path.join(`${prefix}mobile-builds`, "ios", "ios-ipa-build-report.json")),
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

  const intakeDraft = filePath(`${prefix}p1-evidence-intake-draft.json`);
  const intakeCompleted = filePath(`${prefix}p1-evidence-intake.completed.json`);
  const evidenceIntake = filePath(`${prefix}p1-evidence-intake-report.json`);
  await runScript([
    "scripts/create-p1-evidence-intake-draft.mjs",
    `--workspace=${directory}`,
    `--readiness=${readiness}`,
    `--json=${intakeDraft}`,
    `--csv=${filePath(`${prefix}p1-evidence-intake-draft.csv`)}`,
    `--markdown=${filePath(`${prefix}p1-evidence-intake-draft.md`)}`,
  ]);
  await writeCompletedIntake(intakeDraft, intakeCompleted);
  await runScript([
    "scripts/check-p1-evidence-intake.mjs",
    `--file=${intakeCompleted}`,
    `--readiness=${readiness}`,
    `--out=${evidenceIntake}`,
  ]);

  return { paths, readiness, evidenceIntake };
}

const ready = await createReadyFixture();
const packageOut = filePath("p1-release-package.json");
const packageReport = await runScript(packageArgs(ready.paths, ready.readiness, ready.evidenceIntake, [`--out=${packageOut}`]));
assert.equal(packageReport.ok, true);
assert.equal(packageReport.releaseDecision, "ready");
assert.equal(packageReport.summary.totalArtifacts, 9);
assert.equal(packageReport.summary.readyArtifacts, 9);
assert.equal(packageReport.artifacts.p1Readiness.path, ready.readiness);
assert.equal(packageReport.artifacts.p1EvidenceIntake.path, ready.evidenceIntake);
assert.equal(packageReport.artifacts.deploymentHandoff.path, ready.paths.deployment);
assert.equal(packageReport.artifacts.iosIpaBuild.path, ready.paths.iosIpa);
assert.equal(packageReport.artifacts.notificationPushHandoff.path, ready.paths.notificationPush);
assert.equal(packageReport.artifacts.issueRegistrationReceipt.path, ready.paths.issueRegistration);
assert.equal(packageReport.artifacts.paymentProviderHandoff.sha256.length, 64);

const writtenPackage = await readFile(packageOut, "utf8");
assert.equal(JSON.parse(writtenPackage).ok, true);
assert.equal(packageReport.artifacts.p1Readiness.sha256, sha256(await readFile(ready.readiness)));

const workspacePackageOut = filePath("p1-release-package.workspace.json");
const workspacePackageReport = await runScript([
  "scripts/check-p1-release-package.mjs",
  `--workspace=${directory}`,
  `--out=${workspacePackageOut}`,
]);
assert.equal(workspacePackageReport.ok, true);
assert.equal(workspacePackageReport.releaseDecision, "ready");
assert.equal(workspacePackageReport.workspace, path.relative(process.cwd(), directory));
assert.equal(workspacePackageReport.artifacts.p1Readiness.path, ready.readiness);

const missingPayment = await expectFailure(
  packageArgs(
    { ...ready.paths, paymentProvider: filePath("missing-payment-provider.report.json") },
    ready.readiness,
    ready.evidenceIntake,
  ),
);
assert(missingPayment.blockers.some((blocker) => blocker.code === "P1_RELEASE_PACKAGE_ARTIFACT_UNREADABLE"));

const missingEvidenceIntake = await expectFailure(packageArgs(ready.paths, ready.readiness, filePath("missing-p1-evidence-intake-report.json")));
assert(missingEvidenceIntake.blockers.some((blocker) => blocker.code === "P1_RELEASE_PACKAGE_ARTIFACT_UNREADABLE"));

const blockedReadiness = filePath("p1-readiness.blocked.json");
await writeFile(
  blockedReadiness,
  `${JSON.stringify(
    {
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-07-20T05:30:00.000Z",
      summary: { ready: 6, missing: 0, blocked: 1, total: 7 },
      requirements: {},
      blockers: [{ code: "P1_READINESS_REPORT_BLOCKED" }],
    },
    null,
    2,
  )}\n`,
);
const blockedReadinessPackage = await expectFailure(packageArgs(ready.paths, blockedReadiness, ready.evidenceIntake));
assert(blockedReadinessPackage.blockers.some((blocker) => blocker.code === "P1_RELEASE_PACKAGE_READINESS_NOT_READY"));

const mismatch = await createReadyFixture("mismatch-");
const alternateDeployment = filePath("alternate-deployment.report.json");
await writeReadyReport(alternateDeployment, "alternate deployment");
const mismatchReport = await expectFailure(packageArgs({ ...mismatch.paths, deployment: alternateDeployment }, mismatch.readiness, mismatch.evidenceIntake));
assert(mismatchReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_PACKAGE_READINESS_PATH_MISMATCH"));

const stale = await createReadyFixture("stale-");
await writeReadyReport(stale.paths.android, "android updated after readiness", "2099-07-20T05:00:00.000Z");
const staleReport = await expectFailure(packageArgs(stale.paths, stale.readiness, stale.evidenceIntake));
assert(staleReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_PACKAGE_STALE_READINESS_REPORT"));

const staleIntake = await createReadyFixture("stale-intake-");
const staleEvidenceIntake = JSON.parse(await readFile(staleIntake.evidenceIntake, "utf8"));
staleEvidenceIntake.generatedAt = "2000-01-01T00:00:00.000Z";
await writeFile(staleIntake.evidenceIntake, `${JSON.stringify(staleEvidenceIntake, null, 2)}\n`);
const staleIntakeReport = await expectFailure(packageArgs(staleIntake.paths, staleIntake.readiness, staleIntake.evidenceIntake));
assert(staleIntakeReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_PACKAGE_STALE_EVIDENCE_INTAKE_REPORT"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready P1 release package manifest with hashes and sizes",
        "JSON output writing",
        "missing handoff report blocker",
        "missing evidence intake report blocker",
        "blocked readiness report blocker",
        "readiness path mismatch blocker",
        "stale readiness chronology blocker",
        "stale evidence intake report blocker",
        "workspace artifact defaults",
      ],
    },
    null,
    2,
  ),
);
