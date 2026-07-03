#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-owner-decision-register-apply-"));

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
    decisionOwner: `대표 지정 책임자 ${index + 1}`,
    dueDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    evidenceOwner: `evidence-owner-${row.key}@finaljudo.test`,
    evidenceUrl: `https://evidence.finaljudo.test/owner-decisions/${row.key}`,
    checkedAt: `2026-07-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
    signoff: `https://evidence.finaljudo.test/owner-decisions/${row.key}/signoff`,
    notes: `decision recorded for ${row.key}`,
    ...override(row, index),
  }));
}

async function runApply(args, expectFailure = false) {
  try {
    const result = await execFile(process.execPath, ["scripts/apply-owner-decision-register-csv.mjs", ...args], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 4,
    });

    assert.equal(expectFailure, false, "apply command was expected to fail");
    return JSON.parse(result.stdout);
  } catch (error) {
    if (!expectFailure) {
      throw error;
    }

    return JSON.parse(error?.stdout?.toString() ?? "{}");
  }
}

try {
  const workspace = path.join(directory, "workspace");
  await execFile(
    process.execPath,
    [
      "scripts/create-p1-handoff-draft-workspace.mjs",
      `--out-dir=${workspace}`,
      "--github-repo=antoe-prog/ant",
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 4 },
  );
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-operator-status.mjs",
      `--workspace=${workspace}`,
      "--allow-pending",
      `--out=${path.join(workspace, "p1-operator-status.json")}`,
      `--markdown=${path.join(workspace, "p1-operator-status.md")}`,
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 4 },
  );
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-completion-evidence.mjs",
      `--workspace=${workspace}`,
      "--allow-pending",
      `--out=${path.join(workspace, "p1-completion-evidence.json")}`,
      `--markdown=${path.join(workspace, "p1-completion-evidence.md")}`,
      `--csv=${path.join(workspace, "p1-completion-evidence.csv")}`,
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 4 },
  );
  await execFile(
    process.execPath,
    [
      "scripts/create-owner-progress-report-draft.mjs",
      `--workspace=${workspace}`,
      "--allow-pending",
      `--out=${path.join(workspace, "p1-owner-progress-report.md")}`,
      `--json=${path.join(workspace, "p1-owner-progress-report.json")}`,
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 4 },
  );
  await execFile(
    process.execPath,
    [
      "scripts/create-owner-decision-register.mjs",
      `--workspace=${workspace}`,
      `--out=${path.join(workspace, "p1-owner-decision-register.json")}`,
      `--markdown=${path.join(workspace, "p1-owner-decision-register.md")}`,
      `--csv=${path.join(workspace, "p1-owner-decision-register.csv")}`,
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 4 },
  );

  const sourceCsv = path.join(workspace, "p1-owner-decision-register.csv");
  const registerJson = path.join(workspace, "p1-owner-decision-register.json");
  const { headers, rows } = objectsFromCsv(await readFile(sourceCsv, "utf8"));
  const completedCsv = path.join(workspace, "p1-owner-decision-register.completed.csv");
  const completedJson = path.join(workspace, "p1-owner-decision-register.completed.json");
  const completedMarkdown = path.join(workspace, "p1-owner-decision-register.completed.md");
  await writeFile(completedCsv, createCsv(headers, filledRows(rows)));

  const report = await runApply([
    `--csv=${completedCsv}`,
    `--json=${registerJson}`,
    `--out=${completedJson}`,
    `--markdown=${completedMarkdown}`,
  ]);
  const completed = JSON.parse(await readFile(completedJson, "utf8"));
  const markdown = await readFile(completedMarkdown, "utf8");

  assert.equal(report.ok, true);
  assert.equal(report.releaseDecision, "ready");
  assert.equal(report.summary.csvRows, 7);
  assert.equal(report.summary.appliedRows, 7);
  assert.equal(report.summary.completedDecisionRows, 7);
  assert.equal(completed.registerDecision, "decisions_recorded");
  assert.equal(completed.ownerDecisionRegisterCompleted, true);
  assert.equal(completed.summary.completedDecisionRows, 7);
  assert(completed.checked.includes("owner decision CSV fields are applied to a completed decision register"));
  assert.equal(completed.decisionRows.find((row) => row.key === "deployment")?.ownerDecision.dueDate, "2026-07-01");
  assert(markdown.includes("# P1 Owner Decision Register Completed"));
  assert(markdown.includes("decisions_recorded"));

  const blankReport = await runApply(
    [`--csv=${sourceCsv}`, `--json=${registerJson}`, `--out=${path.join(workspace, "blank.json")}`],
    true,
  );
  assert.equal(blankReport.ok, false);
  assert(blankReport.blockers.some((blocker) => blocker.code === "OWNER_DECISION_REGISTER_CSV_FIELD_PLACEHOLDER"));

  const tamperedCsv = path.join(workspace, "p1-owner-decision-register.tampered.csv");
  await writeFile(tamperedCsv, createCsv(headers, filledRows(rows, (row, index) => (index === 0 ? { ownerLane: "tampered lane" } : {}))));
  const tamperedReport = await runApply(
    [`--csv=${tamperedCsv}`, `--json=${registerJson}`, `--out=${path.join(workspace, "tampered.json")}`],
    true,
  );
  assert(tamperedReport.blockers.some((blocker) => blocker.code === "OWNER_DECISION_REGISTER_CSV_READONLY_MISMATCH"));

  const invalidDueDateCsv = path.join(workspace, "p1-owner-decision-register.invalid-due-date.csv");
  await writeFile(invalidDueDateCsv, createCsv(headers, filledRows(rows, (row, index) => (index === 0 ? { dueDate: "2026-13-40" } : {}))));
  const invalidDueDateReport = await runApply(
    [`--csv=${invalidDueDateCsv}`, `--json=${registerJson}`, `--out=${path.join(workspace, "invalid-due-date.json")}`],
    true,
  );
  assert(invalidDueDateReport.blockers.some((blocker) => blocker.code === "OWNER_DECISION_REGISTER_CSV_DUE_DATE_INVALID"));

  const insecureCsv = path.join(workspace, "p1-owner-decision-register.insecure.csv");
  await writeFile(
    insecureCsv,
    createCsv(headers, filledRows(rows, (row, index) => (index === 0 ? { evidenceUrl: "http://evidence.finaljudo.test/not-secure" } : {}))),
  );
  const insecureReport = await runApply(
    [`--csv=${insecureCsv}`, `--json=${registerJson}`, `--out=${path.join(workspace, "insecure.json")}`],
    true,
  );
  assert(insecureReport.blockers.some((blocker) => blocker.code === "OWNER_DECISION_REGISTER_CSV_EVIDENCE_INVALID"));

  const secretCsv = path.join(workspace, "p1-owner-decision-register.secret.csv");
  await writeFile(secretCsv, createCsv(headers, filledRows(rows, (row, index) => (index === 0 ? { notes: "FinalJudoPilot!2026" } : {}))));
  const secretReport = await runApply(
    [`--csv=${secretCsv}`, `--json=${registerJson}`, `--out=${path.join(workspace, "secret.json")}`],
    true,
  );
  assert(secretReport.blockers.some((blocker) => blocker.code === "OWNER_DECISION_REGISTER_CSV_SECRET_VALUE"));

  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const releaseRunner = await readFile("scripts/run-release-checks.mjs", "utf8");
  const adminSettings = await readFile("src/components/screens/admin-settings-screen.tsx", "utf8");
  const readme = await readFile("README.md", "utf8");
  const qaPlan = await readFile("docs/QA_TEST_PLAN.md", "utf8");
  const releaseChecklist = await readFile("docs/RELEASE_CHECKLIST.md", "utf8");

  assert.equal(packageJson.scripts["owner:decision-register:apply-csv"], "node scripts/apply-owner-decision-register-csv.mjs");
  assert.equal(packageJson.scripts["test:owner-decision-register-apply-csv"], "node scripts/check-owner-decision-register-apply-csv-test.mjs");
  assert(releaseRunner.includes('["run", "test:owner-decision-register-apply-csv"]'));
  assert(!adminSettings.includes("npm run test:owner-decision-register-apply-csv"), "admin settings must not embed automated gate commands in app source");
  assert(!adminSettings.includes("npm run owner:decision-register:apply-csv"), "admin settings must not embed automated gate commands in app source");

  for (const source of [readme, qaPlan, releaseChecklist]) {
    assert(source.includes("npm run test:owner-decision-register-apply-csv"));
    assert(source.includes("owner:decision-register:apply-csv"));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "completed owner decision register CSV applies to separate completed JSON and Markdown",
          "blank decision owner, due date, and evidence owner fields are blocked",
          "read-only decision register columns cannot be edited",
          "invalid dueDate and insecure evidence URLs are blocked",
          "secret-like values are blocked",
          "package, release, admin settings, README, QA, release checklist references exist",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
