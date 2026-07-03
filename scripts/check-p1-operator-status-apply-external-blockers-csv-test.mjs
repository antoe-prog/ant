import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-operator-external-blockers-"));

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((fieldValue) => String(fieldValue).trim()));
}

function csvCell(value) {
  const source = String(value ?? "").trim().replace(/\r?\n/g, " ");
  return /[",\n]/.test(source) ? `"${source.replace(/"/g, '""')}"` : source;
}

function createCsv(headers, rows) {
  return `${[headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n")}\n`;
}

function objectsFromCsv(source) {
  const parsedRows = parseCsv(source);
  const headers = parsedRows[0];
  const rows = parsedRows.slice(1).map((values) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });

  return { headers, rows };
}

function filledRows(rows, override = () => ({})) {
  return rows.map((row, index) => ({
    ...row,
    evidenceOwner: `owner-${row.key}@finaljudo.test`,
    evidenceUrl: `https://evidence.finaljudo.test/p1-external-blockers/${row.key}`,
    checkedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    signoff: `https://evidence.finaljudo.test/signoff/${row.key}`,
    notes: `verified ${row.key}`,
    ...override(row, index),
  }));
}

async function runApply(args, expectFailure = false) {
  try {
    const result = await execFile(process.execPath, ["scripts/apply-p1-operator-status-external-blockers-csv.mjs", ...args], {
      cwd: process.cwd(),
    });

    assert.equal(expectFailure, false, "apply command was expected to fail");
    return JSON.parse(result.stdout);
  } catch (error) {
    if (!expectFailure) {
      throw error;
    }

    const stdoutSource = error?.stdout?.toString() ?? "";
    return JSON.parse(stdoutSource);
  }
}

try {
  const pendingWorkspace = path.join(directory, "pending");
  await execFile(
    process.execPath,
    ["scripts/create-p1-handoff-draft-workspace.mjs", `--out-dir=${pendingWorkspace}`, "--github-repo=antoe-prog/ant"],
    { cwd: process.cwd() },
  );

  const operatorStatusJson = path.join(pendingWorkspace, "p1-operator-status.json");
  const externalBlockersCsv = path.join(pendingWorkspace, "p1-operator-status-external-blockers.csv");
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-operator-status.mjs",
      `--workspace=${pendingWorkspace}`,
      "--allow-pending",
      `--out=${operatorStatusJson}`,
      `--markdown=${path.join(pendingWorkspace, "p1-operator-status.md")}`,
      `--external-blockers-csv=${externalBlockersCsv}`,
    ],
    { cwd: process.cwd() },
  );

  const { headers, rows } = objectsFromCsv(await readFile(externalBlockersCsv, "utf8"));
  const completedCsv = path.join(pendingWorkspace, "p1-operator-status-external-blockers.completed.csv");
  const completedJson = path.join(pendingWorkspace, "p1-operator-status-external-blockers.completed.json");
  const completedMarkdown = path.join(pendingWorkspace, "p1-operator-status-external-blockers.completed.md");
  await writeFile(completedCsv, createCsv(headers, filledRows(rows)));

  const report = await runApply([
    `--csv=${completedCsv}`,
    `--json=${operatorStatusJson}`,
    `--out=${completedJson}`,
    `--markdown=${completedMarkdown}`,
  ]);
  const completed = JSON.parse(await readFile(completedJson, "utf8"));
  const markdown = await readFile(completedMarkdown, "utf8");

  assert.equal(report.ok, true);
  assert.equal(report.releaseDecision, "ready");
  assert.equal(report.summary.csvRows, 7);
  assert.equal(report.summary.appliedRows, 7);
  assert.equal(report.summary.completedExternalBlockers, 7);
  assert.equal(completed.releaseDecision, "blocked");
  assert.equal(completed.externalBlockerEvidenceReady, true);
  assert.equal(completed.summary.operatorExternalBlockerEvidenceRows, 7);
  assert.equal(completed.summary.completedExternalBlockers, 7);
  assert.equal(completed.appliedExternalBlockersCsv.path.endsWith("p1-operator-status-external-blockers.completed.csv"), true);
  assert(completed.checked.includes("operator external blocker CSV fields are applied to a completed evidence record"));
  assert(completed.externalBlockers.every((blocker) => blocker.operatorEvidence?.evidenceOwner));
  assert.equal(
    completed.externalBlockers.find((blocker) => blocker.key === "deployment")?.operatorEvidence.evidenceUrl,
    "https://evidence.finaljudo.test/p1-external-blockers/deployment",
  );
  assert(markdown.includes("# P1 Operator External Blockers Evidence"));
  assert(markdown.includes("deployment"));
  assert(markdown.includes("https://evidence.finaljudo.test/signoff/deployment"));

  const blankReport = await runApply(
    [`--csv=${externalBlockersCsv}`, `--json=${operatorStatusJson}`, `--out=${path.join(pendingWorkspace, "blank.json")}`],
    true,
  );
  assert.equal(blankReport.ok, false);
  assert(blankReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_FIELD_PLACEHOLDER"));

  const tamperedCsv = path.join(pendingWorkspace, "p1-operator-status-external-blockers.tampered.csv");
  await writeFile(tamperedCsv, createCsv(headers, filledRows(rows, (row, index) => (index === 0 ? { ownerLane: "tampered lane" } : {}))));
  const tamperedReport = await runApply(
    [`--csv=${tamperedCsv}`, `--json=${operatorStatusJson}`, `--out=${path.join(pendingWorkspace, "tampered.json")}`],
    true,
  );
  assert(tamperedReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_READONLY_MISMATCH"));

  const insecureCsv = path.join(pendingWorkspace, "p1-operator-status-external-blockers.insecure.csv");
  await writeFile(
    insecureCsv,
    createCsv(headers, filledRows(rows, (row, index) => (index === 0 ? { evidenceUrl: "http://evidence.finaljudo.test/not-secure" } : {}))),
  );
  const insecureReport = await runApply(
    [`--csv=${insecureCsv}`, `--json=${operatorStatusJson}`, `--out=${path.join(pendingWorkspace, "insecure.json")}`],
    true,
  );
  assert(insecureReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_EVIDENCE_INVALID"));

  const secretCsv = path.join(pendingWorkspace, "p1-operator-status-external-blockers.secret.csv");
  await writeFile(secretCsv, createCsv(headers, filledRows(rows, (row, index) => (index === 0 ? { notes: "FinalJudoPilot!2026" } : {}))));
  const secretReport = await runApply(
    [`--csv=${secretCsv}`, `--json=${operatorStatusJson}`, `--out=${path.join(pendingWorkspace, "secret.json")}`],
    true,
  );
  assert(secretReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_SECRET_VALUE"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "completed operator external blockers CSV applies to separate completed JSON and Markdown",
          "blank operator evidence fields are blocked",
          "read-only external blocker columns cannot be edited",
          "insecure evidence URLs are blocked",
          "secret-like values are blocked",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
