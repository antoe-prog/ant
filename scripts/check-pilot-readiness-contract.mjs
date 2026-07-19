import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mockDataPath = "src/lib/mock-data.ts";
const importPath = "scripts/import-pilot-data.mjs";
const preflightPath = "scripts/check-production-preflight.mjs";
const adminSettingsPath = "src/components/screens/admin-settings-screen.tsx";
const pilotMutationRoutePaths = [
  "src/app/api/v1/admin/pilot-readiness/route.ts",
  "src/app/api/v1/admin/pilot-incidents/route.ts",
  "src/app/api/v1/admin/pilot-incidents/[incidentId]/route.ts",
  "src/app/api/v1/admin/pilot-operations/route.ts",
];

const mockData = readFileSync(mockDataPath, "utf8");
const importScript = readFileSync(importPath, "utf8");
const preflightScript = readFileSync(preflightPath, "utf8");
const adminSettingsSource = readFileSync(adminSettingsPath, "utf8");
const pilotMutationRouteSources = pilotMutationRoutePaths.map((routePath) => [routePath, readFileSync(routePath, "utf8")]);
const { createDefaultPilotReadinessChecks, pilotReadinessDefinitions, prePilotReadinessIds } = await import(
  "../src/lib/pilot-readiness.ts"
);
const { pilotOperationsInputLimits } = await import("../src/lib/pilot-operations-input-policy.ts");

function assertNoDuplicateIds(checks, label) {
  const ids = checks.map((check) => check.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.equal(duplicateIds.length, 0, `${label} has duplicate readiness ids: ${duplicateIds.join(", ")}`);
}

const defaultChecks = createDefaultPilotReadinessChecks();
const readinessDefinitions = [...pilotReadinessDefinitions];
const defaultPrePilotIds = readinessDefinitions.filter((check) => check.id !== "pilot-retro").map((check) => check.id);

assert(defaultChecks.length > 0, "default readiness checks must not be empty");
assert(defaultChecks.some((check) => check.id === "pilot-retro"), "default readiness checks must include pilot-retro");
assertNoDuplicateIds(defaultChecks, "default readiness checks");
assertNoDuplicateIds(readinessDefinitions, "readiness definitions");
assert.deepEqual(
  defaultChecks.map(({ category, id, label, owner }) => ({ category, id, label, owner })),
  readinessDefinitions,
  "default readiness checks must be created from readiness definitions",
);
assert.deepEqual(prePilotReadinessIds, defaultPrePilotIds, "preflight pre-pilot readiness ids must match default checks except pilot-retro");
assert.deepEqual(
  pilotOperationsInputLimits,
  {
    blockerSummary: 1_000,
    branchId: 200,
    checkId: 200,
    description: 2_000,
    evidence: 1_000,
    mobileAttendanceEvidence: 500,
    owner: 80,
    screen: 120,
    title: 120,
    workaround: 1_000,
  },
  "pilot input policy must keep explicit storage bounds",
);

assert(
  mockData.includes('import { createDefaultPilotReadinessChecks } from "./pilot-readiness.ts";'),
  "mock data must use the shared readiness contract through a Node-compatible import",
);
assert(
  importScript.includes('await import("../src/lib/pilot-readiness.ts")'),
  "pilot import must import readiness checks from the shared contract",
);
assert(
  preflightScript.includes('await import("../src/lib/pilot-readiness.ts")'),
  "preflight must import readiness ids from the shared contract",
);
assert(
  /requireRetro \? \[\.\.\.prePilotReadinessIds, "pilot-retro"\] : prePilotReadinessIds/.test(preflightScript),
  "preflight --require-retro must require pilot-retro",
);
for (const [routePath, source] of pilotMutationRouteSources) {
  assert(
    source.includes("withServerDbLock(pilotOperationsStateLockKey"),
    `${routePath} must serialize pilot state mutations with the shared lock`,
  );
  assert(source.includes('createRuntimeId("audit")'), `${routePath} must create collision-resistant pilot audit IDs`);
  assert(
    source.includes('return jsonError(400, "VALIDATION_ERROR", bodyTypeError)'),
    `${routePath} must reject malformed pilot mutation fields before persistence`,
  );
  assert(source.includes("pilotOperationsInputLimits"), `${routePath} must apply the shared pilot input policy`);
  assert(
    source.indexOf("exceedsPilotInputLimit") < source.indexOf("withServerDbLock(pilotOperationsStateLockKey"),
    `${routePath} must reject oversized pilot input before taking the shared lock`,
  );
}
for (const field of ["blockerSummary", "description", "evidence", "mobileAttendanceEvidence", "owner", "screen", "title", "workaround"]) {
  assert(
    adminSettingsSource.includes(`maxLength={pilotOperationsInputLimits.${field}}`),
    `admin settings must apply the shared ${field} input limit`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "default readiness checks have stable unique ids",
        "default readiness checks are created from the shared contract",
        "mock/import/preflight use the shared readiness contract",
        "preflight pre-pilot readiness ids match default checks",
        "post-pilot preflight requires pilot-retro",
        "pilot mutation APIs share one state lock and reject malformed fields",
        "pilot mutation APIs reject oversized stored fields before the shared lock",
        "pilot settings inputs mirror server storage limits",
        "pilot mutation APIs create collision-resistant audit ids",
      ],
      readinessIds: defaultChecks.map((check) => check.id),
    },
    null,
    2,
  ),
);
