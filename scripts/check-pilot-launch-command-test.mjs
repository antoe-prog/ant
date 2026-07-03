import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const transformArgs = ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
const pilotCsv = "docs/pilot-templates/pilot-data-intake.csv";

async function runLaunchPackage(tempDir, extraArgs = []) {
  const out = join(tempDir, `pilot-launch-package-${Math.random().toString(16).slice(2)}.json`);
  const evidence = join(tempDir, `pilot-evidence-${Math.random().toString(16).slice(2)}.json`);
  const evidenceMarkdown = join(tempDir, `pilot-evidence-${Math.random().toString(16).slice(2)}.md`);
  const preflight = join(tempDir, `pilot-preflight-${Math.random().toString(16).slice(2)}.json`);
  const readinessEvidence = join(tempDir, `pilot-readiness-evidence-${Math.random().toString(16).slice(2)}.csv`);
  const passwordRotation = join(tempDir, `pilot-password-rotation-${Math.random().toString(16).slice(2)}.csv`);
  const args = [
    ...transformArgs,
    "scripts/create-pilot-launch-package.mjs",
    `--csv=${pilotCsv}`,
    `--out=${out}`,
    `--evidence-out=${evidence}`,
    `--evidence-markdown=${evidenceMarkdown}`,
    `--preflight-out=${preflight}`,
    `--readiness-evidence=${readinessEvidence}`,
    `--password-rotation=${passwordRotation}`,
    ...extraArgs,
  ];

  try {
    const result = await execFile(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024 * 5,
    });

    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      out,
      evidence,
      evidenceMarkdown,
      preflight,
      readinessEvidence,
      passwordRotation,
    };
  } catch (error) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
      out,
      evidence,
      evidenceMarkdown,
      preflight,
      readinessEvidence,
      passwordRotation,
    };
  }
}

function parseJson(value, label) {
  try {
    return JSON.parse(value.trim());
  } catch (error) {
    throw new Error(`${label} did not emit parseable JSON: ${error.message}`);
  }
}

const tempDir = await mkdtemp(join(tmpdir(), "final-judo-pilot-launch-command-"));

try {
  const auditRun = await runLaunchPackage(tempDir, ["--allow-incomplete"]);
  assert.equal(auditRun.exitCode, 0, "launch package audit mode should exit successfully for blocked demo runtime");
  const auditPackage = parseJson(auditRun.stdout, "audit launch package stdout");
  const auditPackageFile = parseJson(await readFile(auditRun.out, "utf8"), "audit launch package file");
  const auditEvidence = parseJson(await readFile(auditRun.evidence, "utf8"), "audit evidence JSON");
  const auditPreflight = parseJson(await readFile(auditRun.preflight, "utf8"), "audit preflight JSON");
  const auditMarkdown = await readFile(auditRun.evidenceMarkdown, "utf8");

  assert.equal(auditPackage.ok, false, "demo runtime launch package should remain blocked");
  assert.equal(auditPackage.mode, "audit", "allow-incomplete launch package must record audit mode");
  assert.equal(auditPackage.releaseDecision, "blocked", "demo runtime launch package must be blocked");
  assert.equal(auditPackage.csv.validation.ok, true, "launch package must validate pilot CSV");
  assert.equal(auditPackage.csv.importDryRun.mode, "dry-run", "launch package must not write runtime data");
  assert(auditPackage.csv.importDryRun.counts.users >= 5, "launch package import dry-run must include five role accounts");
  assert.equal(auditPackage.csv.readinessEvidence.ok, false, "launch package must verify pre-pilot readiness evidence CSV");
  assert(
    auditPackage.csv.readinessEvidence.blockerCodes.includes("READINESS_EVIDENCE_UNREADABLE"),
    "launch package must surface missing readiness evidence CSV blockers",
  );
  assert.equal(auditPackage.artifacts.passwordRotation.ok, false, "launch package must verify password rotation evidence");
  assert(
    auditPackage.artifacts.passwordRotation.blockerCodes.includes("PASSWORD_ROTATION_CSV_UNREADABLE"),
    "launch package must surface missing password rotation CSV blockers",
  );
  assert(auditPackage.artifacts.preflightPre.blockerCodes.includes("DEFAULT_PASSWORD_ACTIVE"), "launch package must surface preflight blockers");
  assert.equal(auditEvidence.mode, "pre-pilot", "launch package evidence JSON must be pre-pilot");
  assert.equal(auditPreflight.mode, "audit", "allow-incomplete preflight artifact must be audit mode");
  assert(auditMarkdown.includes("# Final Judo Pilot Evidence Report"), "launch package evidence Markdown must be written");
  assert(auditMarkdown.includes("## Operations"), "launch package evidence Markdown must include operations section");
  assert.equal(auditPackageFile.artifacts.launchPackage.path, auditRun.out, "launch package file path must be self-recorded");
  assert(auditPackage.checked.includes("production pre-pilot preflight artifact"), "launch package must record preflight artifact coverage");

  const secretPostgresUrl = "postgresql://pilot:super-secret@db.example.com:5432/final_judo";
  const redactionRun = await runLaunchPackage(tempDir, ["--allow-incomplete", "--driver=json", `--postgres-url=${secretPostgresUrl}`, "--state-key=redaction-state"]);
  assert.equal(redactionRun.exitCode, 0, "launch package should redact explicit PostgreSQL URLs without requiring a PostgreSQL connection in JSON mode");
  const redactionPackageContent = await readFile(redactionRun.out, "utf8");
  const redactionPackage = parseJson(redactionPackageContent, "redaction launch package file");
  const redactedPostgresUrl = "postgresql://pilot:REDACTED@db.example.com:5432/final_judo";

  assert(!redactionRun.stdout.includes("super-secret"), "launch package stdout must not include PostgreSQL passwords");
  assert(!redactionPackageContent.includes("super-secret"), "launch package file must not include PostgreSQL passwords");
  assert(redactionPackage.commands.launchPackage.includes(`--postgres-url=${redactedPostgresUrl}`), "launch command must keep a redacted PostgreSQL URL");
  assert(redactionPackage.commands.passwordRotation.includes(`--postgres-url=${redactedPostgresUrl}`), "password rotation command must keep a redacted PostgreSQL URL");
  assert(redactionPackage.commands.evidenceJson.includes(`--postgres-url=${redactedPostgresUrl}`), "evidence command must keep a redacted PostgreSQL URL");

  const strictRun = await runLaunchPackage(tempDir);
  assert.notEqual(strictRun.exitCode, 0, "strict launch package should fail for blocked demo runtime");
  const strictPackage = parseJson(await readFile(strictRun.out, "utf8"), "strict launch package file");

  assert.equal(strictPackage.ok, false, "strict blocked launch package should still write a package file");
  assert.equal(strictPackage.mode, "strict", "strict launch package must record strict mode");
  assert(strictPackage.artifacts.preflightPre.blockerCodes.includes("PILOT_READINESS_INCOMPLETE"), "strict launch package must preserve readiness blockers");
  assert(
    strictPackage.artifacts.readinessEvidence.blockerCodes.includes("READINESS_EVIDENCE_UNREADABLE"),
    "strict launch package must preserve readiness evidence blockers",
  );
  assert(
    strictPackage.artifacts.passwordRotation.blockerCodes.includes("PASSWORD_ROTATION_CSV_UNREADABLE"),
    "strict launch package must preserve password rotation blockers",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "pilot:launch-package audit mode writes blocked package",
          "pilot:launch-package validates CSV and import dry-run",
          "pilot:launch-package validates readiness evidence CSV",
          "pilot:launch-package validates password rotation evidence CSV",
          "pilot:launch-package writes pre-pilot evidence JSON/Markdown",
          "pilot:launch-package writes pre-pilot preflight artifact",
          "pilot:launch-package redacts PostgreSQL passwords in archived commands",
          "pilot:launch-package strict mode exits nonzero while preserving package",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
