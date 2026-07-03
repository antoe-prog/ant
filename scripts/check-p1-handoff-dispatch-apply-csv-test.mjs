import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(os.tmpdir(), "final-judo-p1-handoff-dispatch-apply-csv-"));
const csvHeaders = [
  "packageDir",
  "ownerRole",
  "assignedToName",
  "assignedToContact",
  "channel",
  "assignedAt",
  "dueAt",
  "assignmentEvidence",
  "acknowledgementStatus",
  "acknowledgedAt",
  "acknowledgementEvidence",
];

function filePath(name) {
  return path.join(directory, name);
}

async function assertFileMissing(targetPath) {
  await assert.rejects(access(targetPath), (error) => error?.code === "ENOENT");
}

async function runScript(args) {
  const { stdout } = await execFile(process.execPath, args, { cwd: process.cwd() });
  return JSON.parse(stdout);
}

async function expectFailure(args) {
  try {
    await runScript(args);
  } catch (error) {
    assert.notEqual(error.code, 0, "invalid P1 handoff dispatch CSV should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid P1 handoff dispatch CSV unexpectedly passed");
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
    row.packageDir,
    row.ownerRole,
    row.assignedToName,
    row.assignedToContact,
    row.channel,
    row.assignedAt,
    row.dueAt,
    row.assignmentEvidence,
    row.acknowledgementStatus,
    row.acknowledgedAt,
    row.acknowledgementEvidence,
  ];
}

async function writeCsvFromRows(targetPath, rows, headers = csvHeaders) {
  const lines = [headers.join(","), ...rows.map((row) => csvLine(rowToCsvValues(row).slice(0, headers.length)))];
  await writeFile(targetPath, `${lines.join("\n")}\n`);
}

function completedRowsFromDraft(draft) {
  return draft.ownerPackages.map((ownerPackage, index) => ({
    packageDir: ownerPackage.packageDir,
    ownerRole: ownerPackage.ownerRole,
    assignedToName: `${ownerPackage.ownerRole} 실무 담당자`,
    assignedToContact: `owner-${index + 1}@finaljudo.kr`,
    channel: "GitHub issue and Slack channel",
    assignedAt: "2026-07-01T09:00:00.000Z",
    dueAt: "2026-07-02T18:00:00.000Z",
    assignmentEvidence: `https://github.com/antoe-prog/ant/issues/${101 + index}`,
    acknowledgementStatus: "acknowledged",
    acknowledgedAt: "2026-07-01T10:00:00.000Z",
    acknowledgementEvidence: `https://github.com/antoe-prog/ant/issues/${101 + index}#issuecomment-${9001 + index}`,
  }));
}

await runScript([
  "scripts/create-p1-handoff-draft-workspace.mjs",
  `--out-dir=${directory}`,
  "--production-origin=https://app.finaljudo.kr",
  "--payment-checkout-base-url=https://pay.finaljudo.kr",
  "--github-repo=antoe-prog/ant",
]);

const bundlePath = filePath("p1-handoff-bundle-manifest.json");
await runScript(["scripts/check-p1-handoff-bundle.mjs", `--workspace=${directory}`, `--out=${bundlePath}`]);

const receiptPath = filePath("p1-handoff-dispatch-receipt.json");
const receiptMarkdownPath = filePath("p1-handoff-dispatch-receipt.md");
const receiptCsvPath = filePath("p1-handoff-dispatch-receipt.csv");
const draft = await runScript([
  "scripts/create-p1-handoff-dispatch-draft.mjs",
  `--bundle=${bundlePath}`,
  `--out=${receiptPath}`,
  `--markdown=${receiptMarkdownPath}`,
  `--csv=${receiptCsvPath}`,
]);
const receiptCsvSource = await readFile(receiptCsvPath, "utf8");
assert(receiptCsvSource.includes("packageManifestSha256"));
assert(receiptCsvSource.includes("TODO real owner name"));
assert.equal(receiptCsvSource.trim().split("\n").length, draft.ownerPackages.length + 1);

const completedRows = completedRowsFromDraft(draft);
const completedCsv = filePath("p1-handoff-dispatch.completed.csv");
const completedReceipt = filePath("p1-handoff-dispatch-receipt.completed.json");
const completedMarkdown = filePath("p1-handoff-dispatch-receipt.completed.md");
await writeCsvFromRows(completedCsv, completedRows);

const applyReport = await runScript([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${completedCsv}`,
  `--out=${completedReceipt}`,
  `--markdown=${completedMarkdown}`,
]);
assert.equal(applyReport.ok, true);
assert.equal(applyReport.releaseDecision, "ready");
assert.equal(applyReport.summary.appliedRows, draft.ownerPackages.length);
assert.equal(applyReport.summary.acknowledged, draft.ownerPackages.length);
assert.equal(applyReport.artifacts.out.written, true);
assert.equal(applyReport.artifacts.markdown.written, true);

const completed = JSON.parse(await readFile(completedReceipt, "utf8"));
assert.equal(completed.releaseDecision, "ready");
assert.equal(completed.appliedDispatchCsv.sha256.length, 64);
assert.equal(completed.outputPaths.receipt, path.relative(process.cwd(), completedReceipt));
assert.equal(completed.summary.acknowledged, draft.ownerPackages.length);
assert(!completed.ownerPackages.some((ownerPackage) => ownerPackage.assignment.assignedToName.includes("TODO")));
assert((await readFile(completedMarkdown, "utf8")).includes("Applied CSV"));

const strictReport = await runScript([
  "scripts/check-p1-handoff-dispatch.mjs",
  `--file=${completedReceipt}`,
  `--bundle=${bundlePath}`,
  `--out=${filePath("p1-handoff-dispatch-report.json")}`,
]);
assert.equal(strictReport.ok, true);
assert.equal(strictReport.releaseDecision, "ready");
assert.equal(strictReport.summary.ownerPackages, draft.ownerPackages.length);
assert.equal(strictReport.summary.acknowledged, draft.ownerPackages.length);

const draftFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${receiptCsvPath}`,
  `--out=${filePath("draft-should-not-apply.json")}`,
]);
assert(draftFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_FIELD_PLACEHOLDER"));

const duplicateCsv = filePath("p1-handoff-dispatch.duplicate.csv");
await writeCsvFromRows(duplicateCsv, [...completedRows, completedRows[0]]);
const duplicateFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${duplicateCsv}`,
  `--out=${filePath("duplicate-should-not-apply.json")}`,
]);
assert(duplicateFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_ROW_DUPLICATE"));

const unknownCsv = filePath("p1-handoff-dispatch.unknown.csv");
await writeCsvFromRows(unknownCsv, [{ ...completedRows[0], packageDir: "unknown-package" }, ...completedRows.slice(1)]);
const unknownFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${unknownCsv}`,
  `--out=${filePath("unknown-should-not-apply.json")}`,
]);
assert(unknownFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_ROW_UNKNOWN"));

const readonlyCsv = filePath("p1-handoff-dispatch.readonly.csv");
await writeCsvFromRows(readonlyCsv, [{ ...completedRows[0], ownerRole: "Wrong owner" }, ...completedRows.slice(1)]);
const readonlyFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${readonlyCsv}`,
  `--out=${filePath("readonly-should-not-apply.json")}`,
]);
assert(readonlyFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_READONLY_MISMATCH"));

const secretCsv = filePath("p1-handoff-dispatch.secret.csv");
await writeCsvFromRows(secretCsv, [
  { ...completedRows[0], acknowledgementEvidence: "https://github.com/antoe-prog/ant/issues/101?secret=whsec_live_SUPERSECRET" },
  ...completedRows.slice(1),
]);
const secretFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${secretCsv}`,
  `--out=${filePath("secret-should-not-apply.json")}`,
]);
assert(secretFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_SECRET_VALUE"));

const pendingCsv = filePath("p1-handoff-dispatch.pending.csv");
await writeCsvFromRows(pendingCsv, [{ ...completedRows[0], acknowledgementStatus: "pending" }, ...completedRows.slice(1)]);
const pendingFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${pendingCsv}`,
  `--out=${filePath("pending-should-not-apply.json")}`,
]);
assert(pendingFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_ACK_STATUS_INVALID"));

const dueBeforeCsv = filePath("p1-handoff-dispatch.due-before.csv");
await writeCsvFromRows(dueBeforeCsv, [{ ...completedRows[0], dueAt: "2026-06-30T18:00:00.000Z" }, ...completedRows.slice(1)]);
const dueBeforeFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${dueBeforeCsv}`,
  `--out=${filePath("due-before-should-not-apply.json")}`,
]);
assert(dueBeforeFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_DUE_BEFORE_ASSIGNMENT"));

const looseTimestampCsv = filePath("p1-handoff-dispatch.loose-timestamp.csv");
await writeCsvFromRows(looseTimestampCsv, [{ ...completedRows[0], assignedAt: "July 1, 2026 09:00" }, ...completedRows.slice(1)]);
const looseTimestampFailureOut = filePath("loose-timestamp-should-not-apply.json");
const looseTimestampFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${looseTimestampCsv}`,
  `--out=${looseTimestampFailureOut}`,
]);
assert(looseTimestampFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_TIMESTAMP_INVALID"));
await assertFileMissing(looseTimestampFailureOut);

const invalidAssignmentEvidenceCsv = filePath("p1-handoff-dispatch.invalid-assignment-evidence.csv");
await writeCsvFromRows(invalidAssignmentEvidenceCsv, [
  { ...completedRows[0], assignmentEvidence: "delivery-confirmed-in-chat" },
  ...completedRows.slice(1),
]);
const invalidAssignmentEvidenceFailureOut = filePath("invalid-assignment-evidence-should-not-apply.json");
const invalidAssignmentEvidenceFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${invalidAssignmentEvidenceCsv}`,
  `--out=${invalidAssignmentEvidenceFailureOut}`,
]);
assert(
  invalidAssignmentEvidenceFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_EVIDENCE_INVALID"),
);
await assertFileMissing(invalidAssignmentEvidenceFailureOut);

const invalidAckEvidenceCsv = filePath("p1-handoff-dispatch.invalid-ack-evidence.csv");
await writeCsvFromRows(invalidAckEvidenceCsv, [
  { ...completedRows[0], acknowledgementEvidence: "acknowledged verbally" },
  ...completedRows.slice(1),
]);
const invalidAckEvidenceFailureOut = filePath("invalid-ack-evidence-should-not-apply.json");
const invalidAckEvidenceFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${invalidAckEvidenceCsv}`,
  `--out=${invalidAckEvidenceFailureOut}`,
]);
assert(invalidAckEvidenceFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_EVIDENCE_INVALID"));
await assertFileMissing(invalidAckEvidenceFailureOut);

const missingHeaderCsv = filePath("p1-handoff-dispatch.missing-header.csv");
await writeCsvFromRows(missingHeaderCsv, completedRows, ["packageDir", "ownerRole", "assignedToName"]);
const missingHeaderFailure = await expectFailure([
  "scripts/apply-p1-handoff-dispatch-csv.mjs",
  `--receipt=${receiptPath}`,
  `--csv=${missingHeaderCsv}`,
  `--out=${filePath("missing-header-should-not-apply.json")}`,
]);
assert(missingHeaderFailure.blockers.some((blocker) => blocker.code === "P1_HANDOFF_DISPATCH_CSV_HEADERS_MISSING"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "completed dispatch CSV applies owner assignment and acknowledgement fields into a separate receipt JSON",
        "completed dispatch receipt passes the strict P1 handoff dispatch verifier",
        "draft TODO CSV fields remain blocked",
        "duplicate, unknown, and missing CSV rows are rejected",
        "read-only CSV column edits are rejected",
        "pending acknowledgements, invalid timelines, and raw secret-like values are rejected",
        "loose timestamps and non-reference evidence fields are rejected before completed receipts are written",
      ],
    },
    null,
    2,
  ),
);
