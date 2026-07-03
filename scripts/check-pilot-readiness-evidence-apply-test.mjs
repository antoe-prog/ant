import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseCsv } from "./pilot-data-utils.mjs";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-readiness-apply-"));
const allDraftPath = join(directory, "pilot-readiness-evidence.all.csv");
const prePilotDraftPath = join(directory, "pilot-readiness-evidence.pre.csv");
const readyPath = join(directory, "pilot-readiness-evidence.ready.csv");
const invalidCheckedAtPath = join(directory, "pilot-readiness-evidence.invalid-checked-at.csv");
const runtimePath = join(directory, "final-judo-db.json");
const nonAdminRuntimePath = join(directory, "final-judo-db.non-admin.json");
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

function createRuntime(allRecords) {
  return {
    branches: [],
    users: [
      {
        id: "user-admin",
        email: "admin@finaljudo.test",
        name: "총괄 어드민",
        passwordHash: "hashed-password",
        role: "admin",
        title: "총괄 운영 관리자",
        branchIds: [],
      },
      {
        id: "user-coach",
        email: "coach@finaljudo.test",
        name: "코치",
        passwordHash: "hashed-password",
        role: "coach",
        title: "코치",
        branchIds: [],
      },
    ],
    members: [],
    classes: [],
    attendance: [],
    counselingNotes: [],
    payments: [],
    notices: [],
    pushSubscriptions: [],
    pilotReadinessChecks: allRecords.map((record) => ({
      id: record.id,
      category: record.category,
      label: record.label,
      owner: record.owner,
      status: "pending",
      evidence: "",
    })),
    pilotIncidents: [],
    pilotOperationLogs: [],
    auditLogs: [],
  };
}

const allDraftRun = await runScript("scripts/create-pilot-readiness-evidence-draft.mjs", [`--out=${allDraftPath}`]);
assert.equal(allDraftRun.code, 0, allDraftRun.stderr);
const allDraft = recordsFromCsv(await readFile(allDraftPath, "utf8"));

const prePilotDraftRun = await runScript("scripts/create-pilot-readiness-evidence-draft.mjs", [
  `--out=${prePilotDraftPath}`,
  "--phase=pre-pilot",
]);
assert.equal(prePilotDraftRun.code, 0, prePilotDraftRun.stderr);
const prePilotDraft = recordsFromCsv(await readFile(prePilotDraftPath, "utf8"));
const readyRecords = prePilotDraft.records.map((record) => ({
  ...record,
  owner: `${record.owner} 확인자`,
  status: "verified",
  evidence: `${record.id} final evidence link`,
  checkedAt: "2026-07-01T09:00:00+09:00",
}));
await writeFile(readyPath, serializeCsv(prePilotDraft.headers, readyRecords));
await writeFile(runtimePath, `${JSON.stringify(createRuntime(allDraft.records), null, 2)}\n`);

const dryRun = await runScript("scripts/apply-pilot-readiness-evidence.mjs", [
  `--file=${readyPath}`,
  `--runtime=${runtimePath}`,
  "--phase=pre-pilot",
]);
assert.equal(dryRun.code, 0, dryRun.stderr || dryRun.stdout);
const dryRunResult = JSON.parse(dryRun.stdout);
assert.equal(dryRunResult.mode, "dry-run", "readiness evidence apply should dry-run without --write");
assert.equal(dryRunResult.changedIds.length, 7, "dry-run should report the pre-pilot rows it would change");
let runtime = JSON.parse(await readFile(runtimePath, "utf8"));
assert.equal(runtime.pilotReadinessChecks.filter((check) => check.status === "verified").length, 0, "dry-run must not mutate runtime");

const writeRun = await runScript("scripts/apply-pilot-readiness-evidence.mjs", [
  `--file=${readyPath}`,
  `--runtime=${runtimePath}`,
  "--phase=pre-pilot",
  "--write",
]);
assert.equal(writeRun.code, 0, writeRun.stderr || writeRun.stdout);
const writeResult = JSON.parse(writeRun.stdout);
assert.equal(writeResult.mode, "write", "write apply should report write mode");
assert.equal(writeResult.changedIds.length, 7, "write apply should change pre-pilot readiness rows");
assert.equal(writeResult.auditLogCount, 7, "write apply should create one audit log per changed row");
runtime = JSON.parse(await readFile(runtimePath, "utf8"));
assert.equal(runtime.pilotReadinessChecks.filter((check) => check.status === "verified").length, 7, "pre-pilot rows must be verified");
assert.equal(runtime.pilotReadinessChecks.find((check) => check.id === "pilot-retro")?.status, "pending", "pre-pilot apply must leave retro pending");
assert.equal(runtime.auditLogs.length, 7, "write apply must persist audit logs");
assert(runtime.auditLogs.every((log) => log.action === "pilot_readiness.update"), "audit logs must use pilot_readiness.update");
assert(runtime.auditLogs.every((log) => log.actorUserId === "user-admin"), "audit logs must preserve admin actor");

const idempotentRun = await runScript("scripts/apply-pilot-readiness-evidence.mjs", [
  `--file=${readyPath}`,
  `--runtime=${runtimePath}`,
  "--phase=pre-pilot",
  "--write",
]);
assert.equal(idempotentRun.code, 0, idempotentRun.stderr || idempotentRun.stdout);
assert.equal(JSON.parse(idempotentRun.stdout).changedIds.length, 0, "second apply should be idempotent");
runtime = JSON.parse(await readFile(runtimePath, "utf8"));
assert.equal(runtime.auditLogs.length, 7, "idempotent apply must not add audit noise");

const pendingRun = await runScript("scripts/apply-pilot-readiness-evidence.mjs", [
  `--file=${prePilotDraftPath}`,
  `--runtime=${runtimePath}`,
  "--phase=pre-pilot",
  "--write",
]);
assert.notEqual(pendingRun.code, 0, "pending collection template must not apply without --allow-pending");
assert(
  JSON.parse(pendingRun.stdout).blockers.some((blocker) => blocker.code === "READINESS_APPLY_PENDING_REQUIRED"),
  "pending apply must report pending blocker",
);

await writeFile(nonAdminRuntimePath, `${JSON.stringify(createRuntime(allDraft.records), null, 2)}\n`);
const nonAdminRun = await runScript("scripts/apply-pilot-readiness-evidence.mjs", [
  `--file=${readyPath}`,
  `--runtime=${nonAdminRuntimePath}`,
  "--phase=pre-pilot",
  "--actor-user-id=user-coach",
  "--write",
]);
assert.notEqual(nonAdminRun.code, 0, "non-admin actor must not apply readiness evidence");
assert(
  JSON.parse(nonAdminRun.stdout).blockers.some((blocker) => blocker.code === "READINESS_APPLY_ACTOR_NOT_ADMIN"),
  "non-admin actor must report actor blocker",
);

await writeFile(invalidCheckedAtPath, serializeCsv(prePilotDraft.headers, [{ ...readyRecords[0], checkedAt: "not a date" }, ...readyRecords.slice(1)]));
const invalidCheckedAtRun = await runScript("scripts/apply-pilot-readiness-evidence.mjs", [
  `--file=${invalidCheckedAtPath}`,
  `--runtime=${nonAdminRuntimePath}`,
  "--phase=pre-pilot",
  "--write",
]);
assert.notEqual(invalidCheckedAtRun.code, 0, "invalid checkedAt must fail apply");
assert(
  JSON.parse(invalidCheckedAtRun.stdout).blockers.some((blocker) => blocker.code === "READINESS_APPLY_CHECKED_AT_INVALID"),
  "invalid checkedAt must report timestamp blocker",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "readiness evidence apply dry-run does not mutate runtime",
        "write apply verifies pre-pilot readiness and writes audit logs",
        "pre-pilot apply leaves retro pending",
        "apply is idempotent",
        "pending templates, non-admin actors, and invalid checkedAt are blocked",
      ],
    },
    null,
    2,
  ),
);
