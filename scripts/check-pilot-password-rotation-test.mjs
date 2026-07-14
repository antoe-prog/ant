import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseCsv } from "./pilot-data-utils.mjs";

const { createRandomPasswordHash, defaultPilotPasswordHash } = await import("../src/server/auth-password.ts");

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-password-rotation-"));
const runtimePath = join(directory, "final-judo-db.json");
const readyRuntimePath = join(directory, "final-judo-db.ready.json");
const missingAuditRuntimePath = join(directory, "final-judo-db.missing-audit.json");
const draftPath = join(directory, "pilot-password-rotation.csv");
const readyPath = join(directory, "pilot-password-rotation.ready.csv");
const missingUserPath = join(directory, "pilot-password-rotation.missing-user.csv");
const secretLeakPath = join(directory, "pilot-password-rotation.secret-leak.csv");
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

function baseRuntime({ adminHash = defaultPilotPasswordHash, coachHash = createRandomPasswordHash("CoachRotated!2026"), includeCoachAudit = true } = {}) {
  const rotatedAt = "2026-07-01T09:00:00.000Z";
  const auditLogs = includeCoachAudit
    ? [
        {
          id: "audit-password-coach",
          branchId: "branch-gangnam",
          actorUserId: "user-admin",
          action: "auth.password_reset.complete",
          targetType: "auth",
          targetId: "user-coach",
          before: { passwordUpdatedAt: null },
          after: { issuedAt: rotatedAt, mode: "generated", reason: "파일럿 계정별 임시 비밀번호 교체" },
          result: "success",
          message: "임시 비밀번호를 발급했습니다.",
          createdAt: rotatedAt,
        },
      ]
    : [];

  return {
    branches: [],
    users: [
      {
        id: "user-admin",
        email: "admin@finaljudo.test",
        name: "총괄",
        passwordHash: adminHash,
        role: "admin",
        title: "총괄",
        branchIds: ["branch-gangnam"],
      },
      {
        id: "user-coach",
        email: "coach@finaljudo.test",
        name: "코치",
        passwordHash: coachHash,
        role: "coach",
        title: "코치",
        branchIds: ["branch-gangnam"],
        passwordUpdatedAt: rotatedAt,
      },
    ],
    members: [],
    classes: [],
    attendance: [],
    counselingNotes: [],
    payments: [],
    notices: [],
    authSessions: [],
    pushSubscriptions: [],
    pushDispatchJobs: [],
    pilotReadinessChecks: [],
    pilotIncidents: [],
    pilotOperationLogs: [],
    auditLogs,
  };
}

function readyRuntime() {
  const rotatedAt = "2026-07-01T09:00:00.000Z";
  const db = baseRuntime({
    adminHash: createRandomPasswordHash("AdminRotated!2026"),
    coachHash: createRandomPasswordHash("CoachRotated!2026"),
  });
  db.users = db.users.map((user) => ({ ...user, passwordUpdatedAt: rotatedAt }));
  db.auditLogs = [
    {
      id: "audit-password-admin",
      branchId: "branch-gangnam",
      actorUserId: "user-admin",
      action: "auth.password_reset.complete",
      targetType: "auth",
      targetId: "user-admin",
      before: { passwordUpdatedAt: null },
      after: { issuedAt: rotatedAt, mode: "generated", reason: "파일럿 계정별 임시 비밀번호 교체" },
      result: "success",
      message: "임시 비밀번호를 발급했습니다.",
      createdAt: rotatedAt,
    },
    ...db.auditLogs,
  ];
  return db;
}

await writeFile(runtimePath, `${JSON.stringify(baseRuntime(), null, 2)}\n`);
await writeFile(readyRuntimePath, `${JSON.stringify(readyRuntime(), null, 2)}\n`);
await writeFile(missingAuditRuntimePath, `${JSON.stringify(baseRuntime({ adminHash: createRandomPasswordHash("AdminRotated!2026"), includeCoachAudit: false }), null, 2)}\n`);

const draftRun = await runScript("scripts/create-pilot-password-rotation-draft.mjs", [`--runtime=${runtimePath}`, `--out=${draftPath}`]);
assert.equal(draftRun.code, 0, draftRun.stderr);
const draftCsv = await readFile(draftPath, "utf8");
assert.equal(draftRun.stdout, draftCsv, "password rotation draft must print and write the same CSV");
const draft = recordsFromCsv(draftCsv);
assert.equal(draft.records.length, 2, "password rotation draft must include email users");
assert.equal(draft.records.find((record) => record.userId === "user-admin")?.usesDefaultPassword, "true", "draft must flag default passwords");
assert.equal(draft.records.find((record) => record.userId === "user-coach")?.rotationStatus, "verified", "draft must prefill audited rotations");

const pendingCheck = await runScript("scripts/check-pilot-password-rotation.mjs", [
  `--runtime=${runtimePath}`,
  `--file=${draftPath}`,
  "--allow-pending",
]);
assert.notEqual(pendingCheck.code, 0, "allow-pending must still block active default passwords");
assert(
  JSON.parse(pendingCheck.stdout).blockers.some((blocker) => blocker.code === "PASSWORD_ROTATION_DEFAULT_ACTIVE"),
  "default password blocker must be reported",
);

const readyDraft = await runScript("scripts/create-pilot-password-rotation-draft.mjs", [`--runtime=${readyRuntimePath}`, `--out=${readyPath}`]);
assert.equal(readyDraft.code, 0, readyDraft.stderr);
const readyRun = await runScript("scripts/check-pilot-password-rotation.mjs", [`--runtime=${readyRuntimePath}`, `--file=${readyPath}`]);
assert.equal(readyRun.code, 0, readyRun.stderr || readyRun.stdout);
assert.equal(JSON.parse(readyRun.stdout).ok, true, "fully rotated password receipt must pass");

const readyCsv = recordsFromCsv(await readFile(readyPath, "utf8"));
await writeFile(missingUserPath, serializeCsv(readyCsv.headers, readyCsv.records.filter((record) => record.userId !== "user-coach")));
const missingUserRun = await runScript("scripts/check-pilot-password-rotation.mjs", [`--runtime=${readyRuntimePath}`, `--file=${missingUserPath}`]);
assert.notEqual(missingUserRun.code, 0, "missing user row must fail");
assert(
  JSON.parse(missingUserRun.stdout).blockers.some((blocker) => blocker.code === "PASSWORD_ROTATION_USER_MISSING"),
  "missing user blocker must be reported",
);

const noAuditRun = await runScript("scripts/check-pilot-password-rotation.mjs", [`--runtime=${missingAuditRuntimePath}`, `--file=${readyPath}`]);
assert.notEqual(noAuditRun.code, 0, "verified rows without audit evidence must fail");
assert(
  JSON.parse(noAuditRun.stdout).blockers.some((blocker) => blocker.code === "PASSWORD_ROTATION_AUDIT_MISSING"),
  "missing audit blocker must be reported",
);

await writeFile(
  secretLeakPath,
  serializeCsv(
    readyCsv.headers,
    readyCsv.records.map((record, index) => (index === 0 ? { ...record, notes: "FinalJudoPilot!2026" } : record)),
  ),
);
const secretLeakRun = await runScript("scripts/check-pilot-password-rotation.mjs", [`--runtime=${readyRuntimePath}`, `--file=${secretLeakPath}`]);
assert.notEqual(secretLeakRun.code, 0, "raw password leakage must fail");
assert(
  JSON.parse(secretLeakRun.stdout).blockers.some((blocker) => blocker.code === "PASSWORD_ROTATION_SECRET_LEAK"),
  "secret leakage blocker must be reported",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "password rotation draft includes runtime email users",
        "default temporary password rows are blocked",
        "fully rotated users with audit evidence pass",
        "missing users and missing audit evidence are blocked",
        "raw temporary password leakage is blocked",
      ],
    },
    null,
    2,
  ),
);
