import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-release-archive-"));

function filePath(name) {
  return path.join(directory, name);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

function releasePackageArgs(paths, readiness, evidenceIntake, out) {
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
    `--out=${out}`,
  ];
}

async function runScript(args) {
  const { stdout } = await execFile(process.execPath, args, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function expectFailure(args) {
  try {
    await runScript(args);
  } catch (error) {
    assert.notEqual(error.code, 0, "invalid P1 release archive should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid P1 release archive unexpectedly passed");
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
      evidenceUrl: `https://evidence.finaljudo.test/archive/${index + 1}-${row.key}`,
      checkedAt: `2026-07-0${index + 1}T09:00:00.000Z`,
      signoff: `https://signoff.finaljudo.test/archive/${index + 1}-${row.key}`,
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

  const releasePackage = filePath(`${prefix}p1-release-package.json`);
  await runScript(releasePackageArgs(paths, readiness, evidenceIntake, releasePackage));

  return { paths, readiness, evidenceIntake, releasePackage };
}

const ready = await createReadyFixture();
const archiveDir = filePath("p1-release-archive-ready");
const archiveReport = await runScript([
  "scripts/archive-p1-release-package.mjs",
  `--package=${ready.releasePackage}`,
  `--archive-dir=${archiveDir}`,
]);
assert.equal(archiveReport.ok, true);
assert.equal(archiveReport.releaseDecision, "ready");
assert.equal(Object.keys(archiveReport.artifacts).length, 9);
assert.match(archiveReport.sourcePackage.sha256, /^[a-f0-9]{64}$/);
assert(archiveReport.checked.includes("archive copy SHA-256 and byte-size verification"));

const writtenArchiveReport = JSON.parse(await readFile(path.join(archiveDir, "p1-release-archive-manifest.json"), "utf8"));
assert.deepEqual(writtenArchiveReport, archiveReport);

const archivedPackage = await readFile(archiveReport.sourcePackage.archivedPath);
assert.equal(sha256(archivedPackage), archiveReport.sourcePackage.sha256);

const archivedFiles = await readdir(path.join(archiveDir, "artifacts"));
assert.equal(archivedFiles.length, 9);
const releasePackage = JSON.parse(await readFile(ready.releasePackage, "utf8"));
for (const [key, artifact] of Object.entries(archiveReport.artifacts)) {
  const archivedBuffer = await readFile(artifact.archivedPath);
  assert.equal(sha256(archivedBuffer), releasePackage.artifacts[key].sha256, `${key} archive copy must preserve SHA-256`);
}

await writeFile(releasePackage.artifacts.androidReleaseHandoff.path, `${JSON.stringify({ tampered: true }, null, 2)}\n`);
const tamperedReport = await expectFailure([
  "scripts/archive-p1-release-package.mjs",
  `--package=${ready.releasePackage}`,
  `--archive-dir=${filePath("p1-release-archive-tampered")}`,
]);
assert(tamperedReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_ARCHIVE_ARTIFACT_HASH_MISMATCH"));

const blockedPackage = filePath("p1-release-package.blocked.json");
await writeFile(
  blockedPackage,
  `${JSON.stringify(
    {
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-07-01T09:00:00.000Z",
      summary: { totalArtifacts: 9, readyArtifacts: 8 },
      artifacts: releasePackage.artifacts,
      blockers: [{ code: "MANUAL_BLOCK" }],
    },
    null,
    2,
  )}\n`,
);
const blockedReport = await expectFailure([
  "scripts/archive-p1-release-package.mjs",
  `--package=${blockedPackage}`,
  `--archive-dir=${filePath("p1-release-archive-blocked")}`,
]);
assert(blockedReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_ARCHIVE_PACKAGE_NOT_READY"));

const existingArchiveDir = filePath("p1-release-archive-existing");
await mkdir(existingArchiveDir);
const existingReport = await expectFailure([
  "scripts/archive-p1-release-package.mjs",
  `--package=${blockedPackage}`,
  `--archive-dir=${existingArchiveDir}`,
]);
assert(existingReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_ARCHIVE_DIR_EXISTS"));

const placeholderReport = await expectFailure([
  "scripts/archive-p1-release-package.mjs",
  `--package=${ready.releasePackage}`,
  `--archive-dir=${filePath("final-judo-p1-YYYYMMDD")}`,
]);
assert(placeholderReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_ARCHIVE_DIR_PLACEHOLDER"));

const secret = await createReadyFixture("secret-");
const secretPackage = JSON.parse(await readFile(secret.releasePackage, "utf8"));
const secretArtifactPath = secretPackage.artifacts.paymentProviderHandoff.path;
const secretBuffer = Buffer.from("whsec_live_SUPERSECRET\n", "utf8");
await writeFile(secretArtifactPath, secretBuffer);
secretPackage.artifacts.paymentProviderHandoff.sha256 = sha256(secretBuffer);
secretPackage.artifacts.paymentProviderHandoff.sizeBytes = secretBuffer.byteLength;
await writeFile(secret.releasePackage, `${JSON.stringify(secretPackage, null, 2)}\n`);
const secretReport = await expectFailure([
  "scripts/archive-p1-release-package.mjs",
  `--package=${secret.releasePackage}`,
  `--archive-dir=${filePath("p1-release-archive-secret")}`,
]);
assert(secretReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_ARCHIVE_SECRET_LIKE_VALUE"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready P1 release archive manifest with copied package artifacts",
        "archive manifest writes JSON output",
        "archive command verifies copied artifact hashes",
        "tampered source artifact blocks archive",
        "blocked release package blocks archive",
        "existing archive directory blocks archive",
        "placeholder archive directory blocks archive",
        "raw secret-like values are rejected from archived artifacts",
      ],
    },
    null,
    2,
  ),
);
