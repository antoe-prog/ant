import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const qaPlanPath = "docs/QA_TEST_PLAN.md";
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const qaPlan = readFileSync(qaPlanPath, "utf8");
const lines = qaPlan.split(/\r?\n/);
const scenarios = [];

for (const [index, line] of lines.entries()) {
  if (!/^\|\s*QA-[A-Z]+-[A-Z0-9]+\s*\|/.test(line)) {
    continue;
  }

  const cells = line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  const [id, ...details] = cells;

  assert(
    cells.length >= 3 && cells.length <= 5,
    `${qaPlanPath} QA row at line ${index + 1} must have 3 to 5 columns`,
  );
  assert(/^QA-[A-Z]+-[A-Z0-9]+$/.test(id), `${qaPlanPath} has an invalid QA ID at line ${index + 1}`);

  const expected = details.at(-1) ?? "";
  const action = details.slice(0, -1).join(" / ");

  scenarios.push({
    id,
    action,
    expected,
    lineNumber: index + 1,
    columnCount: cells.length,
  });
}

assert(scenarios.length > 0, `${qaPlanPath} must contain QA scenario rows`);

const duplicateIds = [];
const seenIds = new Map();

for (const scenario of scenarios) {
  const first = seenIds.get(scenario.id);

  if (first) {
    duplicateIds.push(`${scenario.id} at lines ${first.lineNumber}, ${scenario.lineNumber}`);
    continue;
  }

  seenIds.set(scenario.id, scenario);
}

assert.equal(duplicateIds.length, 0, `Duplicate QA scenario IDs found:\n${duplicateIds.join("\n")}`);

for (const scenario of scenarios) {
  assert(scenario.action.length > 0, `${scenario.id} at line ${scenario.lineNumber} must have an action`);
  assert(scenario.expected.length > 0, `${scenario.id} at line ${scenario.lineNumber} must have an expected result`);
}

assert.deepEqual(
  [...new Set(scenarios.map((scenario) => scenario.columnCount))].sort((a, b) => a - b),
  [3, 4, 5],
  `${qaPlanPath} must keep covered 3-, 4-, and 5-column QA scenario tables`,
);

const npmRunReferences = [...qaPlan.matchAll(/npm run\s+([^\s`,)]+)/g)]
  .map((match) => match[1].replace(/[.,;:]+$/, ""))
  .filter((scriptName) => scriptName.length > 0)
  .filter((scriptName) => !/[<>*]/.test(scriptName))
  .filter((scriptName) => !scriptName.endsWith(":"));
const uniqueNpmRunReferences = [...new Set(npmRunReferences)].sort();
const missingScripts = uniqueNpmRunReferences.filter((scriptName) => !packageJson.scripts?.[scriptName]);

assert.equal(
  missingScripts.length,
  0,
  `QA plan references npm scripts that are missing from package.json:\n${missingScripts.join("\n")}`,
);

const requiredScenarioIds = [
  "QA-ROLE-01",
  "QA-PAY-24",
  "QA-ADMIN-35B5",
  "QA-ADMIN-36",
  "QA-ADMIN-40",
];

for (const requiredScenarioId of requiredScenarioIds) {
  assert(seenIds.has(requiredScenarioId), `${qaPlanPath} must keep ${requiredScenarioId}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "3- to 5-column QA scenario tables",
        "unique QA scenario IDs across every table shape",
        "non-empty QA actions and expected results",
        "npm run references exist in package.json",
      ],
      scenarioCount: scenarios.length,
      npmRunReferences: uniqueNpmRunReferences.length,
    },
    null,
    2,
  ),
);
