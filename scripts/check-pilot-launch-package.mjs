import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const transformArgs = ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
const launchCommands = [
  "npm run test:pilot-launch-package",
  "npm run test:pilot-launch-command",
  "npm run test:pilot-prelaunch-draft",
  "npm run test:pilot",
  "npm run test:pilot-import",
  "npm run pilot:prelaunch-draft -- --out-dir=.data",
  "npm run pilot:launch-package -- --allow-incomplete --out=.data/pilot-launch-package.json",
  "npm run pilot:readiness-evidence -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot",
  "npm run pilot:launch-package -- --csv=docs/pilot-templates/pilot-data-intake.csv --readiness-evidence=.data/pilot-readiness-evidence.csv --password-rotation=.data/pilot-password-rotation.csv --out=.data/pilot-launch-package.json",
  "npm run pilot:password-rotation -- --runtime=.data/final-judo-db.json --file=.data/pilot-password-rotation.csv",
  "npm run pilot:evidence -- --out=.data/pilot-evidence.json",
  "npm run pilot:evidence -- --require-retro --out=.data/pilot-evidence.post-pilot.json",
  "npm run pilot:evidence -- --require-retro --format=markdown --out=.data/pilot-evidence.md",
  "npm run pilot:field-evidence -- --file=.data/pilot-field-evidence.json --report=.data/pilot-evidence.post-pilot.json",
];

async function runNode(args) {
  return await execFile(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`${label} did not emit parseable JSON: ${error.message}`);
  }
}

function assertIncludes(content, value, label) {
  assert(content.includes(value), `${label} is missing ${value}`);
}

async function checkLaunchDocs() {
  const docs = [
    { path: "README.md", label: "README" },
    { path: "docs/PILOT_OPERATIONS_RUNBOOK.md", label: "pilot operations runbook" },
    { path: "docs/RELEASE_CHECKLIST.md", label: "release checklist" },
    { path: "docs/QA_TEST_PLAN.md", label: "QA test plan" },
  ];

  for (const doc of docs) {
    const content = await readFile(doc.path, "utf8");

    for (const command of launchCommands) {
      assertIncludes(content, command, doc.label);
    }
  }
}

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), "final-judo-pilot-launch-"));

  try {
    const readiness = parseJson((await runNode(["scripts/check-pilot-readiness.mjs"])).stdout, "pilot data readiness");
    assert.equal(readiness.ok, true, "pilot data intake template must pass validation");
    assert.equal(readiness.warnings.length, 0, "pilot data intake template should have no warnings");
    assert(readiness.rows >= 5, "pilot data intake template must include enough rows for launch");

    const importDryRun = parseJson((await runNode([...transformArgs, "scripts/import-pilot-data.mjs"])).stdout, "pilot import dry-run");
    assert.equal(importDryRun.ok, true, "pilot import dry-run must pass");
    assert.equal(importDryRun.mode, "dry-run", "pilot launch package must not write runtime data");
    assert(importDryRun.counts.branches >= 1, "pilot import dry-run must include at least one branch");
    assert(importDryRun.counts.users >= 5, "pilot import dry-run must include five role accounts");
    assert(importDryRun.counts.members > 0, "pilot import dry-run must include members");
    assert(importDryRun.counts.classes > 0, "pilot import dry-run must include classes");
    assert(importDryRun.counts.payments > 0, "pilot import dry-run must include membership/payment samples");
    assert(importDryRun.counts.notices > 0, "pilot import dry-run must include notices");
    assert(importDryRun.counts.pilotReadinessChecks >= 8, "pilot import dry-run must include launch readiness checks");

    const evidenceJsonPath = join(tempDir, "pilot-evidence.pre-pilot.json");
    const evidenceMarkdownPath = join(tempDir, "pilot-evidence.pre-pilot.md");
    const evidenceJson = parseJson(
      (await runNode([...transformArgs, "scripts/export-pilot-evidence.mjs", `--out=${evidenceJsonPath}`])).stdout,
      "pre-pilot evidence JSON",
    );
    const evidenceJsonFile = parseJson(await readFile(evidenceJsonPath, "utf8"), "written pre-pilot evidence JSON");

    assert.equal(evidenceJson.mode, "pre-pilot", "pilot launch evidence must default to pre-pilot mode");
    assert.equal(evidenceJsonFile.mode, "pre-pilot", "written pilot launch evidence must default to pre-pilot mode");
    assert(Array.isArray(evidenceJson.preflight.blockerCodes), "pilot launch evidence must include preflight blocker codes");
    assert(Array.isArray(evidenceJson.readiness.requiredIds), "pilot launch evidence must include readiness ids");
    assert.equal(typeof evidenceJson.counts.noticeFollowupChecksLogged, "number", "pilot launch evidence must include notice follow-up operation counts");
    assert.equal(typeof evidenceJson.counts.noticeChecksLogged, "number", "pilot launch evidence must include notice operation counts");

    await runNode([...transformArgs, "scripts/export-pilot-evidence.mjs", "--format=markdown", `--out=${evidenceMarkdownPath}`]);
    const evidenceMarkdown = await readFile(evidenceMarkdownPath, "utf8");
    assertIncludes(evidenceMarkdown, "# Final Judo Pilot Evidence Report", "pre-pilot evidence Markdown");
    assertIncludes(evidenceMarkdown, "- Mode: pre-pilot", "pre-pilot evidence Markdown");
    assertIncludes(evidenceMarkdown, "## Readiness", "pre-pilot evidence Markdown");
    assertIncludes(evidenceMarkdown, "## Operations", "pre-pilot evidence Markdown");
    assertIncludes(evidenceMarkdown, "Notice follow-up checks logged", "pre-pilot evidence Markdown");
    assertIncludes(evidenceMarkdown, "Notice checks logged", "pre-pilot evidence Markdown");

    const fieldTemplate = parseJson(
      (await runNode(["scripts/check-pilot-field-evidence.mjs", "--file=docs/pilot-templates/pilot-field-evidence.template.json", "--allow-template"])).stdout,
      "pilot field evidence template",
    );
    assert.equal(fieldTemplate.ok, true, "pilot field evidence template must keep a valid launch shape");
    assert(fieldTemplate.checked.includes("pilot source CSV validation and command cross-check"), "field evidence template checker must cover source CSV validation");
    assert(
      fieldTemplate.checked.includes("pilot branch/account source CSV scope cross-check"),
      "field evidence template checker must cover source CSV scope cross-check",
    );
    assert(
      fieldTemplate.checked.includes("pre-pilot evidence source CSV count cross-check"),
      "field evidence template checker must cover source CSV count cross-check",
    );
    assert(fieldTemplate.checked.includes("post-pilot Markdown evidence report content"), "field evidence template checker must cover Markdown report content");

    await checkLaunchDocs();

    console.log(
      JSON.stringify(
        {
          ok: true,
          checked: [
            "pilot intake CSV validation",
            "pilot import dry-run without runtime writes",
            "pre-pilot pilot:evidence JSON artifact",
            "pre-pilot pilot:evidence Markdown artifact",
            "field evidence manifest template shape",
            "pilot launch commands documented in README/runbook/checklist/QA",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
