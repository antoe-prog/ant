import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseCsv } from "./pilot-data-utils.mjs";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-readiness-evidence-"));
const draftPath = join(directory, "pilot-readiness-evidence.csv");
const prePilotDraftPath = join(directory, "pilot-readiness-evidence.pre.csv");
const readyPath = join(directory, "pilot-readiness-evidence.ready.csv");
const placeholderPath = join(directory, "pilot-readiness-evidence.placeholder.csv");
const unknownPath = join(directory, "pilot-readiness-evidence.unknown.csv");
const missingPath = join(directory, "pilot-readiness-evidence.missing.csv");
const nodeFlags = ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

function csvCell(value) {
  const stringValue = value == null ? "" : String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

function serializeCsv(headers, records) {
  return `${[headers, ...records.map((record) => headers.map((header) => record[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

function recordsFromCsv(csv) {
  const [headers, ...rows] = parseCsv(csv);
  return {
    headers,
    records: rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))),
  };
}

async function runScript(script, args = []) {
  try {
    const result = await execFile(process.execPath, [...nodeFlags, script, ...args], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

const draftRun = await runScript("scripts/create-pilot-readiness-evidence-draft.mjs", [`--out=${draftPath}`]);
assert.equal(draftRun.code, 0, draftRun.stderr);
const draftCsv = await readFile(draftPath, "utf8");
assert.equal(draftRun.stdout, draftCsv, "readiness evidence draft must write stdout and --out CSV");
const { headers, records } = recordsFromCsv(draftCsv);
assert.deepEqual(headers, ["id", "category", "label", "owner", "status", "evidence", "checkedAt", "notes"]);
assert.equal(records.length, 8, "default readiness evidence draft must include all readiness checks");
assert(records.some((record) => record.id === "pilot-retro"), "default readiness evidence draft must include post-pilot retro row");
assert(records.every((record) => record.status === "pending"), "draft rows should start pending");

const prePilotDraftRun = await runScript("scripts/create-pilot-readiness-evidence-draft.mjs", [`--out=${prePilotDraftPath}`, "--phase=pre-pilot"]);
assert.equal(prePilotDraftRun.code, 0, prePilotDraftRun.stderr);
const prePilotRecords = recordsFromCsv(prePilotDraftRun.stdout).records;
assert.equal(prePilotRecords.length, 7, "pre-pilot readiness evidence draft must exclude pilot-retro");
assert(!prePilotRecords.some((record) => record.id === "pilot-retro"), "pre-pilot readiness evidence draft must not include pilot-retro");

const draftCheckRun = await runScript("scripts/check-pilot-readiness-evidence.mjs", [`--file=${draftPath}`]);
assert.equal(draftCheckRun.code, 0, draftCheckRun.stderr || draftCheckRun.stdout);
const draftCheck = JSON.parse(draftCheckRun.stdout);
assert.equal(draftCheck.ok, true, "pending readiness evidence draft should validate as a collection template");

const readyRecords = records.map((record) => ({
  ...record,
  status: "verified",
  evidence: `${record.id} verified with final evidence link`,
  checkedAt: "2026-07-01T09:00:00+09:00",
}));
await writeFile(readyPath, serializeCsv(headers, readyRecords));
const readyRun = await runScript("scripts/check-pilot-readiness-evidence.mjs", [`--file=${readyPath}`]);
assert.equal(readyRun.code, 0, readyRun.stderr || readyRun.stdout);
assert.equal(JSON.parse(readyRun.stdout).ok, true, "verified readiness evidence CSV should pass");

const placeholderRecords = readyRecords.map((record, index) =>
  index === 0 ? { ...record, evidence: "TODO: evidence" } : record,
);
await writeFile(placeholderPath, serializeCsv(headers, placeholderRecords));
const placeholderRun = await runScript("scripts/check-pilot-readiness-evidence.mjs", [`--file=${placeholderPath}`]);
assert.notEqual(placeholderRun.code, 0, "verified placeholder evidence must fail");
assert(
  JSON.parse(placeholderRun.stdout).blockers.some((blocker) => blocker.code === "READINESS_EVIDENCE_PROOF_MISSING"),
  "verified placeholder evidence must report proof blocker",
);

await writeFile(unknownPath, serializeCsv(headers, [...readyRecords, { ...readyRecords[0], id: "pilot-unknown" }]));
const unknownRun = await runScript("scripts/check-pilot-readiness-evidence.mjs", [`--file=${unknownPath}`]);
assert.notEqual(unknownRun.code, 0, "unknown readiness id must fail");
assert(
  JSON.parse(unknownRun.stdout).blockers.some((blocker) => blocker.code === "READINESS_EVIDENCE_ID_UNKNOWN"),
  "unknown readiness id must report contract blocker",
);

await writeFile(missingPath, serializeCsv(headers, readyRecords.filter((record) => record.id !== "pilot-data")));
const missingRun = await runScript("scripts/check-pilot-readiness-evidence.mjs", [`--file=${missingPath}`]);
assert.notEqual(missingRun.code, 0, "missing required readiness id must fail");
assert(
  JSON.parse(missingRun.stdout).blockers.some((blocker) => blocker.code === "READINESS_EVIDENCE_REQUIRED_ID_MISSING"),
  "missing required readiness id must report missing id blocker",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "readiness evidence draft includes shared readiness ids",
        "pre-pilot draft excludes retro readiness",
        "pending draft validates as a collection template",
        "verified readiness evidence requires non-placeholder proof",
        "unknown and missing readiness ids are blocked",
      ],
    },
    null,
    2,
  ),
);
