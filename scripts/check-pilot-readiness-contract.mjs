import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mockDataPath = "src/lib/mock-data.ts";
const importPath = "scripts/import-pilot-data.mjs";
const preflightPath = "scripts/check-production-preflight.mjs";

const mockData = readFileSync(mockDataPath, "utf8");
const importScript = readFileSync(importPath, "utf8");
const preflightScript = readFileSync(preflightPath, "utf8");
const { createDefaultPilotReadinessChecks, pilotReadinessDefinitions, prePilotReadinessIds } = await import(
  "../src/lib/pilot-readiness.ts"
);

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

assert(
  mockData.includes('import { createDefaultPilotReadinessChecks } from "@/lib/pilot-readiness";'),
  "mock data must import readiness checks from the shared contract",
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
      ],
      readinessIds: defaultChecks.map((check) => check.id),
    },
    null,
    2,
  ),
);
