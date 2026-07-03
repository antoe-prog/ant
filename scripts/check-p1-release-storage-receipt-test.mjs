import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(os.tmpdir(), "final-judo-p1-release-storage-receipt-"));

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
    assert.notEqual(error.code, 0, "invalid P1 release storage receipt should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid P1 release storage receipt unexpectedly passed");
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
      evidenceUrl: `https://evidence.finaljudo.test/storage/${index + 1}-${row.key}`,
      checkedAt: `2026-07-0${index + 1}T09:00:00.000Z`,
      signoff: `https://signoff.finaljudo.test/storage/${index + 1}-${row.key}`,
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

  const archiveDir = filePath(`${prefix}p1-release-archive-ready`);
  const archiveManifest = path.join(archiveDir, "p1-release-archive-manifest.json");
  await runScript([
    "scripts/archive-p1-release-package.mjs",
    `--package=${releasePackage}`,
    `--archive-dir=${archiveDir}`,
  ]);

  return { paths, readiness, evidenceIntake, releasePackage, archiveDir, archiveManifest };
}

const ready = await createReadyFixture();
const draftReceipt = filePath("p1-release-storage-receipt.draft.json");
const draft = await runScript([
  "scripts/create-p1-release-storage-receipt-draft.mjs",
  `--archive=${ready.archiveManifest}`,
  `--out=${draftReceipt}`,
]);
assert.equal(draft.archiveManifestSha256, sha256(await readFile(ready.archiveManifest)));
assert.equal(draft.uploadedArtifacts.length, 10);
assert.equal(draft.uploadedArtifacts[0].key, "p1ReleasePackage");
assert.deepEqual(JSON.parse(await readFile(draftReceipt, "utf8")), draft);

const blockedDraft = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${draftReceipt}`,
  `--archive=${ready.archiveManifest}`,
]);
assert(blockedDraft.blockers.some((blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_LOCATION_INVALID"));

const readyReceipt = filePath("p1-release-storage-receipt.ready.json");
const storagePrefix = "https://storage.finaljudo.test/p1-release-20260715/artifacts";
const completedDraft = await runScript([
  "scripts/create-p1-release-storage-receipt-draft.mjs",
  `--archive=${ready.archiveManifest}`,
  `--out=${readyReceipt}`,
  "--uploaded-at=2026-07-15T03:00:00.000Z",
  "--uploaded-by=A0 PM",
  "--storage-provider=Cloud Archive",
  "--storage-location=https://storage.finaljudo.test/p1-release-20260715/",
  "--evidence=https://storage.finaljudo.test/p1-release-20260715/upload-proof.png",
  "--retention-owner=A0 PM",
  "--retention-access-review-due-on=2027-07-15",
  "--retention-evidence=https://storage.finaljudo.test/p1-release-20260715/retention-policy.pdf",
  `--storage-prefix=${storagePrefix}`,
]);
assert(completedDraft.uploadedArtifacts.every((artifact) => artifact.storageLocation.startsWith(`${storagePrefix}/`)));

const readyReport = await runScript([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${readyReceipt}`,
  `--archive=${ready.archiveManifest}`,
]);
assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");

const httpStorageReceipt = JSON.parse(await readFile(readyReceipt, "utf8"));
httpStorageReceipt.storageLocation = "http://storage.finaljudo.test/p1-release-20260715/";
const httpStoragePath = filePath("p1-release-storage-receipt.http-storage.json");
await writeFile(httpStoragePath, `${JSON.stringify(httpStorageReceipt, null, 2)}\n`);
const httpStorageReport = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${httpStoragePath}`,
  `--archive=${ready.archiveManifest}`,
]);
assert(httpStorageReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_LOCATION_INVALID"));

const looseUploadedAtReceipt = JSON.parse(await readFile(readyReceipt, "utf8"));
looseUploadedAtReceipt.uploadedAt = "July 15, 2026 03:00";
const looseUploadedAtPath = filePath("p1-release-storage-receipt.loose-uploaded-at.json");
await writeFile(looseUploadedAtPath, `${JSON.stringify(looseUploadedAtReceipt, null, 2)}\n`);
const looseUploadedAtReport = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${looseUploadedAtPath}`,
  `--archive=${ready.archiveManifest}`,
]);
assert(looseUploadedAtReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_UPLOADED_AT_INVALID"));

const invalidEvidenceReceipt = JSON.parse(await readFile(readyReceipt, "utf8"));
invalidEvidenceReceipt.evidence = "uploaded by PM in shared drive";
const invalidEvidencePath = filePath("p1-release-storage-receipt.invalid-evidence.json");
await writeFile(invalidEvidencePath, `${JSON.stringify(invalidEvidenceReceipt, null, 2)}\n`);
const invalidEvidenceReport = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${invalidEvidencePath}`,
  `--archive=${ready.archiveManifest}`,
]);
assert(invalidEvidenceReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_EVIDENCE_INVALID"));

const invalidRetentionEvidenceReceipt = JSON.parse(await readFile(readyReceipt, "utf8"));
invalidRetentionEvidenceReceipt.retentionPolicy.evidence = "retention policy confirmed verbally";
const invalidRetentionEvidencePath = filePath("p1-release-storage-receipt.invalid-retention-evidence.json");
await writeFile(invalidRetentionEvidencePath, `${JSON.stringify(invalidRetentionEvidenceReceipt, null, 2)}\n`);
const invalidRetentionEvidenceReport = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${invalidRetentionEvidencePath}`,
  `--archive=${ready.archiveManifest}`,
]);
assert(
  invalidRetentionEvidenceReport.blockers.some(
    (blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_RETENTION_EVIDENCE_INVALID",
  ),
);

const missingArtifactReceipt = JSON.parse(await readFile(readyReceipt, "utf8"));
missingArtifactReceipt.uploadedArtifacts = missingArtifactReceipt.uploadedArtifacts.filter((artifact) => artifact.key !== "deploymentHandoff");
const missingArtifactPath = filePath("p1-release-storage-receipt.missing-artifact.json");
await writeFile(missingArtifactPath, `${JSON.stringify(missingArtifactReceipt, null, 2)}\n`);
const missingArtifactReport = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${missingArtifactPath}`,
  `--archive=${ready.archiveManifest}`,
]);
assert(missingArtifactReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_ARTIFACT_MISSING"));

const staleReceipt = JSON.parse(await readFile(readyReceipt, "utf8"));
staleReceipt.uploadedAt = "2000-01-01T00:00:00.000Z";
const stalePath = filePath("p1-release-storage-receipt.stale.json");
await writeFile(stalePath, `${JSON.stringify(staleReceipt, null, 2)}\n`);
const staleReport = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${stalePath}`,
  `--archive=${ready.archiveManifest}`,
]);
assert(staleReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_UPLOADED_BEFORE_ARCHIVE"));

const archiveManifest = JSON.parse(await readFile(ready.archiveManifest, "utf8"));
await writeFile(archiveManifest.artifacts.androidReleaseHandoff.archivedPath, `${JSON.stringify({ tampered: true }, null, 2)}\n`);
const tamperedReport = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${readyReceipt}`,
  `--archive=${ready.archiveManifest}`,
]);
assert(tamperedReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_ARCHIVE_HASH_MISMATCH"));

const secret = await createReadyFixture("secret-");
const secretReceipt = filePath("p1-release-storage-receipt.secret.json");
await runScript([
  "scripts/create-p1-release-storage-receipt-draft.mjs",
  `--archive=${secret.archiveManifest}`,
  `--out=${secretReceipt}`,
  "--uploaded-at=2026-07-15T03:00:00.000Z",
  "--uploaded-by=A0 PM",
  "--storage-provider=Cloud Archive",
  "--storage-location=https://storage.finaljudo.test/p1-release-secret/",
  "--evidence=whsec_live_SUPERSECRET",
  "--retention-owner=A0 PM",
  "--retention-access-review-due-on=2027-07-15",
  "--retention-evidence=https://storage.finaljudo.test/p1-release-secret/retention-policy.pdf",
  "--storage-prefix=https://storage.finaljudo.test/p1-release-secret/artifacts",
]);
const secretReport = await expectFailure([
  "scripts/check-p1-release-storage-receipt.mjs",
  `--file=${secretReceipt}`,
  `--archive=${secret.archiveManifest}`,
]);
assert(secretReport.blockers.some((blocker) => blocker.code === "P1_RELEASE_STORAGE_RECEIPT_SECRET_VALUE"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "P1 release storage receipt draft captures archive manifest digest",
        "draft includes P1 release package plus nine archived reports",
        "placeholder draft remains blocked until upload fields are filled",
        "operator-supplied storage fields can produce a validator-ready receipt",
        "HTTP storage locations, non-ISO uploadedAt values, and non-reference evidence fields are rejected",
        "missing uploaded artifact blocks receipt",
        "upload before archive generation blocks receipt",
        "tampered archived artifact blocks receipt",
        "raw secret-like values are rejected from receipt submissions",
      ],
    },
    null,
    2,
  ),
);
