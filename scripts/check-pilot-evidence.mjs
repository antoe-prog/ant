import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const { prePilotReadinessIds } = await import("../src/lib/pilot-readiness.ts");
const directory = await mkdtemp(join(tmpdir(), "final-judo-evidence-"));
const runtimePath = join(directory, "pilot-runtime.json");
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));

await execFile(process.execPath, [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/import-pilot-data.mjs",
  "--driver=json",
  `--out=${runtimePath}`,
  "--write",
  "docs/pilot-templates/pilot-data-intake.csv",
], {
  cwd: process.cwd(),
  env: process.env,
  maxBuffer: 1024 * 1024,
});

const nodeArgs = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/export-pilot-evidence.mjs",
  "--format=json",
  "--driver=json",
  `--file=${runtimePath}`,
];

const result = await execFile(process.execPath, nodeArgs, {
  cwd: process.cwd(),
  env: process.env,
  maxBuffer: 1024 * 1024,
});
const report = JSON.parse(result.stdout.trim());
const postPilotRun = await execFile(
  process.execPath,
  [
    "--experimental-transform-types",
    "--disable-warning=ExperimentalWarning",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "scripts/export-pilot-evidence.mjs",
    "--format=json",
    "--driver=json",
    `--file=${runtimePath}`,
    "--require-retro",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024,
  },
);
const postPilotReport = JSON.parse(postPilotRun.stdout.trim());
const markdownPath = join(directory, "pilot-evidence.md");
const markdownRun = await execFile(
  process.execPath,
  [
    "--experimental-transform-types",
    "--disable-warning=ExperimentalWarning",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "scripts/export-pilot-evidence.mjs",
    "--format=markdown",
    "--driver=json",
    `--file=${runtimePath}`,
    `--out=${markdownPath}`,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024,
  },
);
const markdown = await readFile(markdownPath, "utf8");

assert.equal(report.mode, "pre-pilot", "pilot evidence report should default to pre-pilot mode");
assert.equal(report.releaseDecision, "blocked", "demo pilot evidence report should remain blocked until field evidence is complete");
assert.equal(report.runtime.driver, "json");
assert.equal(report.counts.branches, 2, "pilot evidence report should include demo branch count");
assert(report.counts.users >= 6, "pilot evidence report should include at least the core demo users");
assert.equal(report.counts.requiredReadiness, prePilotReadinessIds.length, "pilot evidence report must track pre-pilot readiness checks");
assert.equal(report.counts.requiredReadinessVerified, 0, "demo pilot evidence should not mark field readiness as verified");
assert.equal(report.counts.operationDays, 0, "demo pilot evidence should not contain operation days");
assert.equal(report.counts.noticeFollowupChecksLogged, 0, "demo pilot evidence should include notice follow-up check count");
assert.equal(report.counts.noticeChecksLogged, 0, "demo pilot evidence should include notice check count");
assert.deepEqual(report.readiness.requiredIds, prePilotReadinessIds, "pilot evidence readiness ids must match shared contract");
assert(report.preflight.blockerCodes.includes("DEFAULT_PASSWORD_ACTIVE"), "pilot evidence must include preflight blockers");
assert(report.preflight.blockerCodes.includes("PILOT_READINESS_INCOMPLETE"), "pilot evidence must include readiness blockers");
assert(report.preflight.checked.includes("runtime sensitive data guardrails"), "pilot evidence must include preflight checked labels");
assert.equal(postPilotReport.mode, "post-pilot", "pilot evidence --require-retro should switch to post-pilot mode");
assert.equal(
  postPilotReport.counts.requiredReadiness,
  prePilotReadinessIds.length + 1,
  "post-pilot evidence must require pilot-retro readiness",
);
assert(postPilotReport.readiness.requiredIds.includes("pilot-retro"), "post-pilot evidence must include pilot-retro readiness");
assert(
  postPilotReport.preflight.blockerCodes.includes("PILOT_OPERATION_DAYS_INCOMPLETE"),
  "post-pilot evidence must include operation-day blockers until 14 verified days exist",
);
assert(
  postPilotReport.preflight.blockerCodes.includes("PILOT_OPERATION_ATTENDANCE_MISSING"),
  "post-pilot evidence must include attendance evidence blockers until field logs exist",
);
assert(
  postPilotReport.preflight.blockerCodes.includes("PILOT_OPERATION_PAYMENT_MISSING"),
  "post-pilot evidence must include payment evidence blockers until field logs exist",
);
assert(markdownRun.stdout.includes("# Final Judo Pilot Evidence Report"), "pilot evidence markdown should print to stdout");
assert(markdown.includes("## Readiness"), "pilot evidence markdown file should include readiness section");
assert(markdown.includes("## Operations"), "pilot evidence markdown file should include operation section");
assert(markdown.includes("Notice follow-up checks logged"), "pilot evidence markdown file should include notice follow-up check count");
assert(markdown.includes("Notice checks logged"), "pilot evidence markdown file should include notice check count");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "pilot evidence report command emits parseable JSON",
        "pilot evidence report summarizes preflight blockers",
        "pilot evidence report uses shared readiness contract",
        "pilot evidence report includes runtime counts and attendance/payment/notice follow-up/notice operation evidence",
        "pilot evidence report covers post-pilot require-retro mode",
        "pilot evidence report writes markdown artifacts",
      ],
      decision: report.releaseDecision,
      requiredReadiness: report.counts.requiredReadiness,
      operationDays: report.counts.operationDays,
    },
    null,
    2,
  ),
);
