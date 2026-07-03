#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const script = "scripts/check-postgres-docker-readiness.mjs";

async function runDoctor(args, env = {}) {
  try {
    const result = await execFile(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stderr: error.stderr ?? "",
      stdout: error.stdout ?? "",
    };
  }
}

function parseStdout(stdout) {
  return JSON.parse(stdout);
}

function assertNoSecret(source) {
  assert(!source.includes("super-secret-pass"), "doctor output must redact PostgreSQL password");
  assert(!/postgres(?:ql)?:\/\/[^:\s/@]+:(?!REDACTED@)[^@\s]+@/i.test(source), "doctor output must not include raw Postgres credentials");
}

const workspace = await mkdtemp(join(tmpdir(), "final-judo-postgres-doctor-"));

const readyOut = join(workspace, "ready.json");
const readyMarkdown = join(workspace, "ready.md");
const ready = await runDoctor(
  [`--mock-docker=ready`, `--out=${readyOut}`, `--markdown=${readyMarkdown}`],
  {
    FINAL_JUDO_DB_DRIVER: "postgres",
    FINAL_JUDO_POSTGRES_STATE_KEY: "pilot-runtime",
    FINAL_JUDO_POSTGRES_TABLE: "app_runtime_state",
    FINAL_JUDO_POSTGRES_URL: "postgresql://pilot:super-secret-pass@db.example.com:5432/final_judo",
  },
);
assert.equal(ready.code, 0, "ready mock doctor should exit 0");
const readySummary = parseStdout(ready.stdout);
assert.equal(readySummary.releaseDecision, "ready", "ready mock doctor should be ready");
const readyJson = await readFile(readyOut, "utf8");
const readyMd = await readFile(readyMarkdown, "utf8");
assertNoSecret(ready.stdout);
assertNoSecret(readyJson);
assertNoSecret(readyMd);
assert(readyJson.includes("REDACTED"), "ready report should include redacted Postgres URL");
assert(readyMd.includes("npm run test:postgres-store"), "ready Markdown should include runtime store smoke command");

const daemonDownOut = join(workspace, "daemon-down.json");
const daemonDown = await runDoctor([`--mock-docker=daemon-down`, `--out=${daemonDownOut}`]);
assert.equal(daemonDown.code, 0, "non-strict daemon-down doctor should preserve exit 0 for status artifact generation");
const daemonDownSummary = parseStdout(daemonDown.stdout);
assert.equal(daemonDownSummary.releaseDecision, "blocked", "daemon-down doctor should be blocked");
assert(daemonDownSummary.blockers.includes("POSTGRES_DOCKER_DAEMON_DOWN"), "daemon-down blocker should be reported");
assert(daemonDownSummary.nextActions.some((action) => action.includes("Docker Desktop")), "daemon-down next action should mention Docker Desktop");

const strictDaemonDown = await runDoctor([`--mock-docker=daemon-down`, "--strict"]);
assert.notEqual(strictDaemonDown.code, 0, "strict daemon-down doctor should fail");
assert(parseStdout(strictDaemonDown.stdout).blockers.includes("POSTGRES_DOCKER_DAEMON_DOWN"), "strict daemon-down stdout should remain parseable");

const cliMissing = await runDoctor([`--mock-docker=cli-missing`]);
assert.equal(cliMissing.code, 0, "non-strict CLI-missing doctor should preserve exit 0 for status artifact generation");
assert(parseStdout(cliMissing.stdout).blockers.includes("POSTGRES_DOCKER_CLI_MISSING"), "CLI-missing blocker should be reported");

const fakeDockerBin = join(workspace, "fake-docker");
await writeFile(
  fakeDockerBin,
  `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "--version" ]; then
  echo "Docker version 26.1.0, build fixture"
  exit 0
fi
if [ "$1" = "info" ]; then
  echo "Cannot connect to the Docker daemon" >&2
  exit 1
fi
echo "unexpected fake docker command: $*" >&2
exit 1
`,
);
await chmod(fakeDockerBin, 0o755);
const realProbeDaemonDown = await runDoctor([`--docker-bin=${fakeDockerBin}`]);
assert.equal(realProbeDaemonDown.code, 0, "real probe daemon-down fixture should preserve exit 0 in non-strict mode");
const realProbeDaemonDownSummary = parseStdout(realProbeDaemonDown.stdout);
assert.equal(realProbeDaemonDownSummary.docker.cliAvailable, true, "real probe should detect CLI availability without daemon");
assert.equal(realProbeDaemonDownSummary.docker.daemonRunning, false, "real probe should report daemon down separately");
assert(realProbeDaemonDownSummary.blockers.includes("POSTGRES_DOCKER_DAEMON_DOWN"), "real probe daemon-down blocker should be reported");
assert(!realProbeDaemonDownSummary.blockers.includes("POSTGRES_DOCKER_CLI_MISSING"), "real probe daemon-down should not be misclassified as CLI missing");

const missingProdEnv = await runDoctor([`--mock-docker=ready`, "--strict", "--require-postgres-env"]);
assert.notEqual(missingProdEnv.code, 0, "production strict doctor should fail without Postgres env");
const missingProdSummary = parseStdout(missingProdEnv.stdout);
assert(missingProdSummary.blockers.includes("POSTGRES_ENV_DRIVER_NOT_POSTGRES"), "production strict doctor should require postgres driver");
assert(missingProdSummary.blockers.includes("POSTGRES_ENV_URL_MISSING"), "production strict doctor should require Postgres URL");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready Docker fixture writes JSON/Markdown with redacted Postgres URL",
        "daemon-down fixture creates blocked status artifact without failing non-strict mode",
        "strict daemon-down fixture exits nonzero",
        "missing Docker CLI fixture is reported as blocker",
        "real probe separates Docker CLI availability from daemon readiness",
        "production strict mode requires postgres driver and URL",
      ],
    },
    null,
    2,
  ),
);
