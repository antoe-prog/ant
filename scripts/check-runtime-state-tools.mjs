import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "final-judo-integrity-tools-"));
const snapshot = path.join(directory, "runtime-copy.json");
const incompleteSnapshot = path.join(directory, "runtime-copy-incomplete.json");
const invalidPilotCsv = path.join(directory, "cross-branch-pilot.csv");

function emptyRuntimeState() {
  return {
    branches: [], users: [], members: [], classes: [], attendance: [], counselingNotes: [],
    promotions: [], tournaments: [], payments: [], notices: [], authSessions: [], pushSubscriptions: [], pushDispatchJobs: [],
    pilotReadinessChecks: [], pilotIncidents: [], pilotOperationLogs: [], auditLogs: [],
  };
}

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      script,
      ...args,
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

try {
  const legacy = {
    ...emptyRuntimeState(),
    branches: [{ id: "branch-a" }],
    users: [
      { id: "admin-global", branchIds: [], role: "admin", phone: "01000001111" },
      { id: "owner-a", branchIds: ["branch-a"], role: "owner", phone: "01011112222" },
    ],
    members: [{ id: "member-a", branchId: "branch-a", guardianIds: ["missing-guardian"], primaryCoachId: "missing-coach" }],
    classes: [{ id: "class-a", branchId: "branch-a", coachId: "missing-coach", enrolledMemberIds: ["member-a", "missing-member"] }],
  };
  await writeFile(snapshot, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  const original = await readFile(snapshot, "utf8");
  const pilotCsv = await readFile("docs/pilot-templates/pilot-data-intake.csv", "utf8");
  await writeFile(
    invalidPilotCsv,
    pilotCsv.replace(
      "member,송파 도장,,,,,송하린,박지연,,kids,초급,노란띠,송민호,",
      "member,송파 도장,,,,,송하린,박지연,,kids,초급,노란띠,박서준,",
    ),
    "utf8",
  );
  const invalidImport = await run("scripts/import-pilot-data.mjs", [invalidPilotCsv]);
  assert.notEqual(invalidImport.code, 0, "pilot import must reject an operator from another branch");
  assert.match(
    invalidImport.stderr,
    /requires an accepted operator in branch/,
    "cross-branch pilot import rejection must explain the operator requirement",
  );

  const compatibility = await run("scripts/check-runtime-state-compatibility.mjs", [`--file=${snapshot}`, "--allow-issues"]);
  assert.equal(compatibility.code, 0, compatibility.stderr);
  const compatibilityReport = JSON.parse(compatibility.stdout);
  assert.equal(compatibilityReport.mode, "read-only-snapshot");
  assert.equal(compatibilityReport.sourceModified, false);
  assert(compatibilityReport.counts.blockers >= 1);
  assert(!compatibility.stdout.includes("member-a"), "compatibility report must not expose record IDs");
  assert.equal(await readFile(snapshot, "utf8"), original, "compatibility preflight must not modify its snapshot");

  const incompleteRuntime = structuredClone(legacy);
  delete incompleteRuntime.authSessions;
  delete incompleteRuntime.pushDispatchJobs;
  await writeFile(incompleteSnapshot, `${JSON.stringify(incompleteRuntime, null, 2)}\n`, "utf8");
  const incompleteCompatibility = await run("scripts/check-runtime-state-compatibility.mjs", [
    `--file=${incompleteSnapshot}`,
    "--allow-issues",
  ]);
  assert.equal(incompleteCompatibility.code, 0, incompleteCompatibility.stderr);
  const incompleteReport = JSON.parse(incompleteCompatibility.stdout);
  assert.equal(incompleteReport.structuralError?.name, "RuntimeStateSchemaError");
  assert.deepEqual(incompleteReport.structuralError?.missingCollections, ["authSessions", "pushDispatchJobs"]);
  assert.deepEqual(incompleteReport.structuralError?.invalidCollections, []);
  assert(!incompleteCompatibility.stdout.includes("member-a"), "schema reports must not expose record IDs");
  const overwriteAttempt = await run("scripts/check-runtime-state-compatibility.mjs", [
    `--file=${snapshot}`,
    `--out=${snapshot}`,
    "--allow-issues",
  ]);
  assert.notEqual(overwriteAttempt.code, 0, "compatibility preflight must reject snapshot/report path aliasing");
  assert.equal(await readFile(snapshot, "utf8"), original, "rejected report output must preserve the snapshot");

  const missingActor = await run("scripts/reconcile-runtime-state.mjs", [`--file=${snapshot}`]);
  assert.notEqual(missingActor.code, 0, "reconciliation must require an explicit admin audit actor");
  assert.equal(await readFile(snapshot, "utf8"), original, "missing audit actor must not modify the snapshot");

  const dryRun = await run("scripts/reconcile-runtime-state.mjs", [
    `--file=${snapshot}`,
    "--actor-user-id=admin-global",
  ]);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  const dryRunReport = JSON.parse(dryRun.stdout);
  assert.equal(dryRunReport.mode, "dry-run");
  assert(dryRunReport.counts.repairs >= 3);
  assert.equal(dryRunReport.counts.remainingBlockers, 0);
  assert.equal(await readFile(snapshot, "utf8"), original, "reconciliation dry-run must not modify its snapshot");

  const applied = await run("scripts/reconcile-runtime-state.mjs", [
    `--file=${snapshot}`,
    "--actor-user-id=admin-global",
    "--write",
  ]);
  assert.equal(applied.code, 0, applied.stderr);
  const appliedReport = JSON.parse(applied.stdout);
  assert.equal(appliedReport.mode, "write");
  assert.equal(appliedReport.sourceModified, true);
  const persisted = JSON.parse(await readFile(snapshot, "utf8"));
  assert.equal(persisted.members[0].primaryCoachId, "owner-a");
  assert.deepEqual(persisted.members[0].guardianIds, []);
  assert.equal(persisted.classes[0].coachId, "owner-a");
  assert.deepEqual(persisted.classes[0].enrolledMemberIds, ["member-a"]);
  assert.equal(
    persisted.auditLogs.filter((log) => log.action === "system.integrity.repair").length,
    appliedReport.counts.repairs,
  );
  assert(
    persisted.auditLogs
      .filter((log) => log.action === "system.integrity.repair")
      .every((log) => log.actorUserId === "admin-global"),
    "repair audit records must use the verified admin actor",
  );
  assert(
    (await readdir(path.join(directory, "backups"))).some((file) => file.endsWith(".bak")),
    "an applied JSON reconciliation must create a store backup",
  );

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "read-only snapshot compatibility preflight",
      "explicit missing runtime collection diagnostics",
      "snapshot and report output separation",
      "explicit existing admin audit actor requirement",
      "aggregate report privacy",
      "reconciliation dry-run default",
      "explicit audited reconciliation write",
      "JSON backup-producing store path",
      "cross-branch pilot operator import rejection",
    ],
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
