import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function parseJson(value, label) {
  try {
    return JSON.parse(value.trim());
  } catch (error) {
    throw new Error(`${label} did not emit parseable JSON: ${error.message}`);
  }
}

const tempDir = await mkdtemp(join(tmpdir(), "final-judo-pilot-prelaunch-draft-"));

try {
  const summaryPath = join(tempDir, "pilot-prelaunch-draft.json");
  const result = await execFile(process.execPath, ["scripts/create-pilot-prelaunch-draft.mjs", `--out-dir=${tempDir}`, `--summary-out=${summaryPath}`], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });
  const summary = parseJson(result.stdout, "prelaunch draft stdout");
  const writtenSummary = parseJson(await readFile(summaryPath, "utf8"), "prelaunch draft file");

  assert.deepEqual(writtenSummary, summary, "prelaunch draft summary file must match stdout");
  assert.equal(summary.ok, true, "prelaunch draft command should succeed even when release remains blocked");
  assert.equal(summary.mode, "draft", "prelaunch draft summary must record draft mode");
  assert.equal(summary.releaseDecision, "blocked", "draft workspace should preserve blocked release decision");
  assert.equal(summary.runtime.driver, "json", "default prelaunch draft should use JSON runtime");
  assert.equal(summary.artifacts.launchPackage.mode, "audit", "draft workspace must create an audit launch package");
  assert.equal(summary.artifacts.launchPackage.releaseDecision, "blocked", "audit launch package should remain blocked for demo data");
  assert.equal(summary.artifacts.status.releaseDecision, "blocked", "strict status output should remain blocked");
  assert(summary.artifacts.status.blockerCount > 0, "strict status should report non-ready blockers");

  for (const artifact of [
    summary.artifacts.readinessEvidence,
    summary.artifacts.passwordRotation,
    summary.artifacts.evidencePre,
    summary.artifacts.evidencePreMarkdown,
    summary.artifacts.preflightPre,
    summary.artifacts.launchPackage,
    summary.artifacts.status,
  ]) {
    assert.equal(artifact.exists, true, `${artifact.path} should be written`);
    assert(artifact.bytes > 0, `${artifact.path} should not be empty`);
  }

  const readinessCsv = await readFile(summary.artifacts.readinessEvidence.path, "utf8");
  const passwordRotationCsv = await readFile(summary.artifacts.passwordRotation.path, "utf8");
  const launchPackage = parseJson(await readFile(summary.artifacts.launchPackage.path, "utf8"), "prelaunch launch package");
  const status = parseJson(await readFile(summary.artifacts.status.path, "utf8"), "prelaunch status");

  assert(readinessCsv.includes("pilot-branches"), "readiness draft must include pre-pilot readiness ids");
  assert(!readinessCsv.includes("pilot-retro"), "pre-pilot readiness draft must exclude pilot-retro");
  assert(passwordRotationCsv.includes("rotationStatus"), "password rotation draft must include required headers");
  assert(launchPackage.commands.launchPackage.includes("--allow-incomplete"), "audit launch package command must be reproducible");
  assert.equal(status.phase, "runtime", "status should still point operators to runtime readiness first");
  assert(summary.commands.launchPackageAudit.includes("--allow-incomplete"), "summary must show the audit launch command");
  assert(!summary.commands.launchPackageStrict.includes("--allow-incomplete"), "summary must show a strict launch command without audit flag");
  assert(summary.commands.statusStrict.includes("--strict"), "summary must show strict status command");
  assert(summary.nextActions.some((action) => action.includes("준비 증빙 CSV")), "summary must include operator next actions");

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "prelaunch draft writes readiness evidence CSV",
          "prelaunch draft writes password rotation CSV",
          "prelaunch draft writes audit launch package",
          "prelaunch draft writes strict blocked status",
          "prelaunch draft summary preserves blocked decision and next actions",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
