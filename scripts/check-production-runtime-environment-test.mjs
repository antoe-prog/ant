import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const scriptArgs = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/check-production-runtime-environment.mjs",
];
const sensitiveUrl = "postgresql://final_judo:super-secret-value@db.internal:5432/final_judo";
const installationId = "final-judo-production-01";
const managedKeys = [
  "DATABASE_URL",
  "FINAL_JUDO_DB_DRIVER",
  "FINAL_JUDO_INSTALLATION_ID",
  "FINAL_JUDO_POSTGRES_STATE_KEY",
  "FINAL_JUDO_POSTGRES_TABLE",
  "FINAL_JUDO_POSTGRES_URL",
  "FINAL_JUDO_REQUIRE_PERSISTENT_RUNTIME",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
];

function run(extraEnv = {}, extraArgs = []) {
  const env = { ...process.env };

  for (const key of managedKeys) {
    delete env[key];
  }

  return spawnSync(process.execPath, [...scriptArgs, ...extraArgs], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...env, ...extraEnv },
  });
}

const localRun = run();
assert.equal(localRun.status, 0, localRun.stderr);
assert.equal(JSON.parse(localRun.stdout).enforced, false);

const missingRun = run({ VERCEL_ENV: "production" });
assert.notEqual(missingRun.status, 0);
assert.match(missingRun.stderr, /PRODUCTION_RUNTIME_DRIVER_NOT_POSTGRES/);
assert.match(missingRun.stderr, /PRODUCTION_RUNTIME_POSTGRES_URL_INVALID/);
assert.match(missingRun.stderr, /PRODUCTION_RUNTIME_INSTALLATION_ID_MISSING/);

const missingPreviewRun = run({ VERCEL_ENV: "preview" });
assert.notEqual(missingPreviewRun.status, 0);
assert.match(missingPreviewRun.stderr, /PRODUCTION_RUNTIME_DRIVER_NOT_POSTGRES/);
assert.match(missingPreviewRun.stderr, /PRODUCTION_RUNTIME_POSTGRES_URL_INVALID/);
assert.match(missingPreviewRun.stderr, /PRODUCTION_RUNTIME_INSTALLATION_ID_MISSING/);

const jsonRun = run({
  VERCEL_TARGET_ENV: "production",
  FINAL_JUDO_DB_DRIVER: "json",
  FINAL_JUDO_INSTALLATION_ID: installationId,
  FINAL_JUDO_POSTGRES_URL: sensitiveUrl,
});
assert.notEqual(jsonRun.status, 0);
assert.match(jsonRun.stderr, /PRODUCTION_RUNTIME_DRIVER_NOT_POSTGRES/);

const malformedRun = run({
  FINAL_JUDO_REQUIRE_PERSISTENT_RUNTIME: "1",
  FINAL_JUDO_DB_DRIVER: "postgres",
  FINAL_JUDO_INSTALLATION_ID: installationId,
  FINAL_JUDO_POSTGRES_URL: "postgresql://USER:PASSWORD@HOST:5432/final_judo",
});
assert.notEqual(malformedRun.status, 0);
assert.match(malformedRun.stderr, /PRODUCTION_RUNTIME_POSTGRES_URL_INVALID/);

const unsafeTableRun = run({
  VERCEL_ENV: "production",
  FINAL_JUDO_DB_DRIVER: "postgres",
  FINAL_JUDO_INSTALLATION_ID: installationId,
  FINAL_JUDO_POSTGRES_URL: sensitiveUrl,
  FINAL_JUDO_POSTGRES_TABLE: "runtime-state;drop",
});
assert.notEqual(unsafeTableRun.status, 0);
assert.match(unsafeTableRun.stderr, /PRODUCTION_RUNTIME_TABLE_INVALID/);

const wrongStateRun = run({
  VERCEL_ENV: "production",
  FINAL_JUDO_DB_DRIVER: "postgres",
  FINAL_JUDO_INSTALLATION_ID: installationId,
  FINAL_JUDO_POSTGRES_URL: sensitiveUrl,
  FINAL_JUDO_POSTGRES_STATE_KEY: "mvp-typo",
  FINAL_JUDO_POSTGRES_TABLE: "app_runtime_state_copy",
});
assert.notEqual(wrongStateRun.status, 0);
assert.match(wrongStateRun.stderr, /PRODUCTION_RUNTIME_STATE_KEY_MISMATCH/);
assert.match(wrongStateRun.stderr, /PRODUCTION_RUNTIME_TABLE_MISMATCH/);

const invalidIdentityRun = run({
  VERCEL_ENV: "production",
  FINAL_JUDO_DB_DRIVER: "postgres",
  FINAL_JUDO_INSTALLATION_ID: "replace-me",
  FINAL_JUDO_POSTGRES_URL: sensitiveUrl,
});
assert.notEqual(invalidIdentityRun.status, 0);
assert.match(invalidIdentityRun.stderr, /PRODUCTION_RUNTIME_INSTALLATION_ID_INVALID/);

const validRun = run({
  VERCEL_ENV: "production",
  FINAL_JUDO_DB_DRIVER: "postgres",
  FINAL_JUDO_INSTALLATION_ID: ` ${installationId} `,
  FINAL_JUDO_POSTGRES_URL: sensitiveUrl,
  FINAL_JUDO_POSTGRES_STATE_KEY: " mvp ",
  FINAL_JUDO_POSTGRES_TABLE: " app_runtime_state ",
});
assert.equal(validRun.status, 0, validRun.stderr);
assert.deepEqual(JSON.parse(validRun.stdout), {
  ok: true,
  enforced: true,
  driver: "postgres",
  identityConfigured: true,
  stateKey: "mvp",
  tableName: "app_runtime_state",
});

const validPreviewRun = run({
  VERCEL_TARGET_ENV: "preview",
  FINAL_JUDO_DB_DRIVER: "postgres",
  FINAL_JUDO_INSTALLATION_ID: "final-judo-preview-01",
  FINAL_JUDO_POSTGRES_URL: sensitiveUrl,
});
assert.equal(validPreviewRun.status, 0, validPreviewRun.stderr);
assert.equal(JSON.parse(validPreviewRun.stdout).enforced, true);

const migrationRun = run({}, ["--print-installation-migration"]);
assert.equal(migrationRun.status, 0, migrationRun.stderr);
assert.match(migrationRun.stdout, /ALTER TABLE app_runtime_state ADD COLUMN IF NOT EXISTS installation_id text/);
assert.match(migrationRun.stdout, /actual_id IS NOT NULL AND actual_id <> expected_id/);
assert.match(migrationRun.stdout, /Required runtime state is missing; restore\/import it before binding/);
assert(!migrationRun.stdout.includes(installationId), "migration SQL must accept the identity without embedding its value");

for (const output of [
  validRun.stdout,
  validRun.stderr,
  missingRun.stdout,
  missingRun.stderr,
  invalidIdentityRun.stdout,
  invalidIdentityRun.stderr,
]) {
  assert(!output.includes("super-secret-value"), "runtime guard output must not expose database credentials");
  assert(!output.includes(sensitiveUrl), "runtime guard output must not expose the connection string");
  assert(!output.includes(installationId), "runtime guard output must not expose the installation identity");
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const serverDb = await readFile("src/server/db.ts", "utf8");
const releaseRunner = await readFile("scripts/run-release-checks.mjs", "utf8");

assert.match(packageJson.scripts.prebuild, /check-production-runtime-environment\.mjs/);
assert.equal(
  packageJson.scripts["test:production-runtime-environment"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-production-runtime-environment-test.mjs",
);
assert(serverDb.includes("assertProductionRuntimeEnvironment(process.env)"));
assert(serverDb.includes("expectedInstallationId: runtimeEnvironment.expectedInstallationId ?? undefined"));
assert(serverDb.includes("requireExistingState: runtimeEnvironment.enforced"));
assert(releaseRunner.includes('["run", "test:production-runtime-environment"]'));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "local builds remain available",
        "production and preview targets reject JSON or missing PostgreSQL configuration",
        "production targets require a valid installation identity without logging it",
        "production targets reject placeholder URLs and unsafe table names",
        "production targets reject alternate state keys and tables",
        "valid PostgreSQL production configuration passes without logging secrets or identity values",
        "existing production state has a fail-closed idempotent identity migration",
        "prebuild, runtime, and release runner use the production runtime guard",
      ],
    },
    null,
    2,
  ),
);
