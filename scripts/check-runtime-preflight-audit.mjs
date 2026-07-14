import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const allowedAuditBlockers = new Set(["DEFAULT_PASSWORD_ACTIVE", "PILOT_READINESS_INCOMPLETE"]);
const allowedAuditWarnings = new Set(["NODE_ENV_NOT_PRODUCTION", "TEST_EMAIL_ACCOUNTS"]);
const tempDir = mkdtempSync(join(tmpdir(), "final-judo-runtime-preflight-"));
const runtimeDbPath = join(tempDir, "pilot-runtime.json");
process.on("exit", () => rmSync(tempDir, { recursive: true, force: true }));

execFileSync(process.execPath, [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/import-pilot-data.mjs",
  "--driver=json",
  `--out=${runtimeDbPath}`,
  "--write",
  "docs/pilot-templates/pilot-data-intake.csv",
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "pipe",
});

const runtimeDb = JSON.parse(readFileSync(runtimeDbPath, "utf8"));
const expectedRuntimeUserIds = (runtimeDb.users ?? []).map((user) => user.id).filter(Boolean).sort();
const expectedCountKeys = [
  "branches",
  "users",
  "members",
  "classes",
  "attendance",
  "payments",
  "notices",
  "pilotReadinessChecks",
  "pilotIncidents",
  "pilotOperationLogs",
];
const expectedCounts = Object.fromEntries(
  expectedCountKeys.map((key) => [key, Array.isArray(runtimeDb[key]) ? runtimeDb[key].length : 0]),
);
const nodeArgs = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/check-production-preflight.mjs",
  "--allow-incomplete",
  `--file=${runtimeDbPath}`,
];
const { prePilotReadinessIds } = await import("../src/lib/pilot-readiness.ts");

function parseReport(stdout) {
  const report = JSON.parse(stdout.trim());

  assert.equal(report.mode, "audit", "runtime preflight must run in audit mode");
  assert.equal(typeof report.ok, "boolean", "runtime preflight report must include ok");
  assert(Array.isArray(report.blockers), "runtime preflight report must include blockers");
  assert(Array.isArray(report.warnings), "runtime preflight report must include warnings");
  assert(report.counts && typeof report.counts === "object", "runtime preflight report must include counts");

  return report;
}

function collectUnexpectedIssues(issues, allowedCodes) {
  return issues.filter((issue) => !allowedCodes.has(issue.code));
}

function issueCodes(issues) {
  return issues.map((issue) => issue.code);
}

function detailUserIds(issue) {
  return issue?.detail?.users?.map((user) => user.id).sort() ?? [];
}

const result = await execFile(process.execPath, nodeArgs, {
  cwd: process.cwd(),
  env: process.env,
  maxBuffer: 1024 * 1024,
});
const report = parseReport(result.stdout);
const unexpectedBlockers = collectUnexpectedIssues(report.blockers, allowedAuditBlockers);
const unexpectedWarnings = collectUnexpectedIssues(report.warnings, allowedAuditWarnings);

assert.deepEqual(
  unexpectedBlockers,
  [],
  `runtime preflight has unexpected blockers: ${unexpectedBlockers.map((issue) => issue.code).join(", ")}`,
);
assert.deepEqual(
  unexpectedWarnings,
  [],
  `runtime preflight has unexpected warnings: ${unexpectedWarnings.map((issue) => issue.code).join(", ")}`,
);
assert.deepEqual(report.counts, expectedCounts, "runtime preflight must run against the current runtime dataset shape");
assert(!("requests" in report.counts), "runtime preflight counts must not restore deleted request collection");

const defaultPasswordBlocker = report.blockers.find((issue) => issue.code === "DEFAULT_PASSWORD_ACTIVE");
const expectedBlockerCodes = [...prePilotReadinessIds.map(() => "PILOT_READINESS_INCOMPLETE")];
if (defaultPasswordBlocker) {
  expectedBlockerCodes.push("DEFAULT_PASSWORD_ACTIVE");
}
assert.deepEqual(issueCodes(report.blockers).sort(), expectedBlockerCodes.sort());
const expectedWarningCodes = ["NODE_ENV_NOT_PRODUCTION"];
if (report.warnings.some((issue) => issue.code === "TEST_EMAIL_ACCOUNTS")) {
  expectedWarningCodes.push("TEST_EMAIL_ACCOUNTS");
}
assert.deepEqual(issueCodes(report.warnings).sort(), expectedWarningCodes.sort());

const defaultPasswordUserIds = detailUserIds(defaultPasswordBlocker);
if (defaultPasswordBlocker) {
  assert(defaultPasswordUserIds.length > 0, "default password blocker must include affected demo users");
  assert(
    defaultPasswordUserIds.every((userId) => expectedRuntimeUserIds.includes(userId)),
    `default password audit must only identify known demo users: ${defaultPasswordUserIds.join(", ")}`,
  );
  assert.equal(
    new Set(defaultPasswordUserIds).size,
    defaultPasswordUserIds.length,
    "default password audit must not duplicate affected users",
  );
}
const rotatedDemoUserIds = expectedRuntimeUserIds.filter((userId) => !defaultPasswordUserIds.includes(userId)).sort();

const incompleteReadinessIds = report.blockers
  .filter((issue) => issue.code === "PILOT_READINESS_INCOMPLETE")
  .map((issue) => issue.detail?.id)
  .sort();
assert.deepEqual(
  incompleteReadinessIds,
  [...prePilotReadinessIds].sort(),
  "runtime preflight must report exactly the expected pre-pilot readiness blockers",
);

const testEmailWarning = report.warnings.find((issue) => issue.code === "TEST_EMAIL_ACCOUNTS");
if (testEmailWarning) {
  assert.deepEqual(
    detailUserIds(testEmailWarning),
    [...expectedRuntimeUserIds].sort(),
    "test email audit must identify all demo users",
  );
}
assert(report.checked.includes("runtime sensitive data guardrails"), "runtime preflight must include sensitive data guardrails");
assert(
  report.checked.includes("user branch and self/guardian scope references"),
  "runtime preflight must include user/member scope reference checks",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "runtime preflight audit exits successfully",
        "expected runtime blocker classes remain",
        "expected runtime warnings remain",
        "runtime collections match current dataset shape without deleted requests",
        "remaining default password users are identified",
        "rotated users are accepted",
        "test email users are identified when present",
        "pre-pilot readiness blockers match the shared contract",
        "runtime sensitive-data and reference checks executed",
      ],
      blockers: report.blockers.map((issue) => issue.code),
      warnings: report.warnings.map((issue) => issue.code),
      defaultPasswordUsers: defaultPasswordUserIds,
      rotatedDemoUsers: rotatedDemoUserIds,
      counts: report.counts,
    },
    null,
    2,
  ),
);
