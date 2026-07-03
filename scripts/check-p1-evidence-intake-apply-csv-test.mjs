import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(os.tmpdir(), "final-judo-p1-evidence-intake-apply-csv-"));

const csvHeaders = [
  "key",
  "label",
  "lane",
  "status",
  "releaseDecision",
  "blockerCount",
  "requiredEvidence",
  "evidenceDraft",
  "sourceReport",
  "strictCommand",
  "nextAction",
  "evidenceOwner",
  "evidenceUrl",
  "checkedAt",
  "signoff",
];

function filePath(name) {
  return path.join(directory, name);
}

async function assertFileMissing(targetPath) {
  await assert.rejects(access(targetPath), (error) => error?.code === "ENOENT");
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
    assert.notEqual(error.code, 0, "invalid P1 evidence intake CSV should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid P1 evidence intake CSV unexpectedly passed");
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
  const csv = filePath(`${prefix}p1-evidence-intake-draft.csv`);
  await runScript([
    "scripts/create-p1-evidence-intake-draft.mjs",
    `--workspace=${directory}`,
    `--readiness=${readiness}`,
    `--json=${intake}`,
    `--csv=${csv}`,
    `--markdown=${filePath(`${prefix}p1-evidence-intake-draft.md`)}`,
  ]);

  return { paths, readiness, intake, csv };
}

function csvEscape(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

function csvLine(values) {
  return values.map(csvEscape).join(",");
}

function rowToCsvValues(row) {
  return [
    row.key,
    row.label,
    row.lane,
    row.status,
    row.releaseDecision,
    row.blockerCount ?? "",
    row.requiredEvidence,
    row.evidenceDraft,
    row.sourceReport,
    row.strictCommand,
    row.nextAction,
    row.evidenceOwner,
    row.evidenceUrl,
    row.checkedAt,
    row.signoff,
  ];
}

function completeCsvRows(intake) {
  return intake.rows.map((row, index) => ({
    ...row,
    evidenceOwner: `${row.lane} owner`,
    evidenceUrl: `https://evidence.finaljudo.test/csv/${index + 1}-${row.key}`,
    checkedAt: `2026-07-0${index + 1}T09:00:00.000Z`,
    signoff: `https://signoff.finaljudo.test/csv/${index + 1}-${row.key}`,
  }));
}

async function writeCsvFromRows(targetPath, rows) {
  const lines = [csvHeaders.join(","), ...rows.map((row) => csvLine(rowToCsvValues(row)))];
  await writeFile(targetPath, `${lines.join("\n")}\n`);
}

const ready = await createReadyFixture();
const draft = JSON.parse(await readFile(ready.intake, "utf8"));
const completedRows = completeCsvRows(draft);
const completedCsv = filePath("p1-evidence-intake.completed.csv");
const completedJson = filePath("p1-evidence-intake.completed.json");
await writeCsvFromRows(completedCsv, completedRows);

const applyReport = await runScript([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${completedCsv}`,
  `--json=${ready.intake}`,
  `--out=${completedJson}`,
]);
assert.equal(applyReport.ok, true);
assert.equal(applyReport.releaseDecision, "ready");
assert.equal(applyReport.summary.appliedRows, 7);
assert.equal(applyReport.artifacts.out.written, true);

const completedIntake = JSON.parse(await readFile(completedJson, "utf8"));
assert.equal(completedIntake.appliedIntakeCsv.sha256.length, 64);
assert.equal(completedIntake.outputs.completedJson, path.relative(process.cwd(), completedJson));
assert.equal(completedIntake.rows.length, 7);
assert(!completedIntake.rows.some((row) => row.intake.evidenceOwner.includes("TODO")));

const strictReportPath = filePath("p1-evidence-intake-report.json");
const strictReport = await runScript([
  "scripts/check-p1-evidence-intake.mjs",
  `--file=${completedJson}`,
  `--readiness=${ready.readiness}`,
  `--out=${strictReportPath}`,
]);
assert.equal(strictReport.ok, true);
assert.equal(strictReport.releaseDecision, "ready");

const draftFailureOut = filePath("draft-should-not-apply.json");
const draftCsvFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${ready.csv}`,
  `--json=${ready.intake}`,
  `--out=${draftFailureOut}`,
]);
assert(draftCsvFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_FIELD_PLACEHOLDER"));
await assertFileMissing(draftFailureOut);

const duplicateCsv = filePath("p1-evidence-intake.duplicate.csv");
await writeCsvFromRows(duplicateCsv, [...completedRows, completedRows[0]]);
const duplicateFailureOut = filePath("duplicate-should-not-apply.json");
const duplicateFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${duplicateCsv}`,
  `--json=${ready.intake}`,
  `--out=${duplicateFailureOut}`,
]);
assert(duplicateFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_ROW_DUPLICATE"));
await assertFileMissing(duplicateFailureOut);

const unknownCsv = filePath("p1-evidence-intake.unknown.csv");
await writeCsvFromRows(unknownCsv, [{ ...completedRows[0], key: "unknown" }, ...completedRows.slice(1)]);
const unknownFailureOut = filePath("unknown-should-not-apply.json");
const unknownFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${unknownCsv}`,
  `--json=${ready.intake}`,
  `--out=${unknownFailureOut}`,
]);
assert(unknownFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_ROW_UNKNOWN"));
await assertFileMissing(unknownFailureOut);

const readonlyCsv = filePath("p1-evidence-intake.readonly.csv");
await writeCsvFromRows(readonlyCsv, [{ ...completedRows[0], lane: "Wrong lane" }, ...completedRows.slice(1)]);
const readonlyFailureOut = filePath("readonly-should-not-apply.json");
const readonlyFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${readonlyCsv}`,
  `--json=${ready.intake}`,
  `--out=${readonlyFailureOut}`,
]);
assert(readonlyFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_READONLY_MISMATCH"));
await assertFileMissing(readonlyFailureOut);

const secretCsv = filePath("p1-evidence-intake.secret.csv");
await writeCsvFromRows(secretCsv, [
  { ...completedRows[0], evidenceUrl: "https://evidence.finaljudo.test/?secret=whsec_live_SUPERSECRET" },
  ...completedRows.slice(1),
]);
const secretFailureOut = filePath("secret-should-not-apply.json");
const secretFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${secretCsv}`,
  `--json=${ready.intake}`,
  `--out=${secretFailureOut}`,
]);
assert(secretFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_SECRET_VALUE"));
await assertFileMissing(secretFailureOut);

const invalidEvidenceUrlCsv = filePath("p1-evidence-intake.invalid-evidence-url.csv");
await writeCsvFromRows(invalidEvidenceUrlCsv, [
  { ...completedRows[0], evidenceUrl: "operator-upload-folder/evidence-1" },
  ...completedRows.slice(1),
]);
const invalidEvidenceUrlFailureOut = filePath("invalid-evidence-url-should-not-apply.json");
const invalidEvidenceUrlFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${invalidEvidenceUrlCsv}`,
  `--json=${ready.intake}`,
  `--out=${invalidEvidenceUrlFailureOut}`,
]);
assert(
  invalidEvidenceUrlFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_EVIDENCE_URL_INVALID"),
);
await assertFileMissing(invalidEvidenceUrlFailureOut);

const invalidCheckedAtCsv = filePath("p1-evidence-intake.invalid-checked-at.csv");
await writeCsvFromRows(invalidCheckedAtCsv, [
  { ...completedRows[0], checkedAt: "2026/07/01 09:00" },
  ...completedRows.slice(1),
]);
const invalidCheckedAtFailureOut = filePath("invalid-checked-at-should-not-apply.json");
const invalidCheckedAtFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${invalidCheckedAtCsv}`,
  `--json=${ready.intake}`,
  `--out=${invalidCheckedAtFailureOut}`,
]);
assert(invalidCheckedAtFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_CHECKED_AT_INVALID"));
await assertFileMissing(invalidCheckedAtFailureOut);

const invalidSignoffCsv = filePath("p1-evidence-intake.invalid-signoff.csv");
await writeCsvFromRows(invalidSignoffCsv, [
  { ...completedRows[0], signoff: "signed-off-in-chat" },
  ...completedRows.slice(1),
]);
const invalidSignoffFailureOut = filePath("invalid-signoff-should-not-apply.json");
const invalidSignoffFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${invalidSignoffCsv}`,
  `--json=${ready.intake}`,
  `--out=${invalidSignoffFailureOut}`,
]);
assert(invalidSignoffFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_SIGNOFF_INVALID"));
await assertFileMissing(invalidSignoffFailureOut);

const missingHeaderCsv = filePath("p1-evidence-intake.missing-header.csv");
await writeFile(
  missingHeaderCsv,
  `${["key", "label", "lane", "status", "releaseDecision"].join(",")}\n${csvLine(
    rowToCsvValues(completedRows[0]).slice(0, 5),
  )}\n`,
);
const missingHeaderFailureOut = filePath("missing-header-should-not-apply.json");
const missingHeaderFailure = await expectFailure([
  "scripts/apply-p1-evidence-intake-csv.mjs",
  `--csv=${missingHeaderCsv}`,
  `--json=${ready.intake}`,
  `--out=${missingHeaderFailureOut}`,
]);
assert(missingHeaderFailure.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_CSV_HEADERS_MISSING"));
await assertFileMissing(missingHeaderFailureOut);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "completed CSV applies operator fields into a separate completed intake JSON",
        "completed JSON intake passes the strict P1 evidence intake verifier",
        "draft TODO CSV fields remain blocked",
        "duplicate, unknown, and missing CSV rows are rejected",
        "read-only CSV column edits are rejected",
        "raw secret-like values are rejected from CSV operator fields",
        "invalid evidence URLs, checkedAt timestamps, and signoff references are rejected before completed JSON is written",
        "failed CSV applications do not write completed intake JSON artifacts",
      ],
    },
    null,
    2,
  ),
);
