import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = {
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  apiContract: "docs/API_CONTRACT.md",
  envExample: ".env.example",
  envProductionExample: ".env.production.example",
  environmentMatrix: "docs/ENVIRONMENT_MATRIX.md",
  gitignore: ".gitignore",
  packageJson: "package.json",
  productionRuntimePolicy: "src/lib/production-runtime-policy.ts",
  productionRuntimeTest: "scripts/check-production-runtime-environment-test.mjs",
  qaPlan: "docs/QA_TEST_PLAN.md",
  readme: "README.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  releaseRunner: "scripts/run-release-checks.mjs",
  serverDb: "src/server/db.ts",
};

const sources = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])),
);
const packageJson = JSON.parse(sources.packageJson);

function parseEnv(source) {
  const values = new Map();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    values.set(key, value);
  }

  return values;
}

function assertEnvValue(env, key, expected, label) {
  assert.equal(env.get(key), expected, `${label} must set ${key}=${expected}`);
}

function assertEnvHas(env, key, label) {
  assert(env.has(key), `${label} must document ${key}`);
}

const devEnv = parseEnv(sources.envExample);
const productionEnv = parseEnv(sources.envProductionExample);

const runtimeEnvKeys = [
  "FINAL_JUDO_DB_DRIVER",
  "FINAL_JUDO_DATA_DIR",
  "PILOT_DB_FILE",
  "FINAL_JUDO_POSTGRES_URL",
  "FINAL_JUDO_INSTALLATION_ID",
  "FINAL_JUDO_POSTGRES_STATE_KEY",
  "FINAL_JUDO_POSTGRES_TABLE",
  "FINAL_JUDO_ENABLE_DEMO_LOGIN",
  "FINAL_JUDO_ENABLE_DEV_RESET",
  "FINAL_JUDO_PAYMENT_PROVIDER",
  "FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL",
  "FINAL_JUDO_PAYMENT_WEBHOOK_SECRET",
  "FINAL_JUDO_PUSH_ENABLED",
  "FINAL_JUDO_APNS_TEAM_ID",
  "FINAL_JUDO_APNS_KEY_ID",
  "FINAL_JUDO_APNS_TOPIC",
  "FINAL_JUDO_APNS_PRIVATE_KEY",
  "FINAL_JUDO_APNS_ENVIRONMENT",
  "FINAL_JUDO_FIREBASE_PROJECT_ID",
  "FINAL_JUDO_FIREBASE_CLIENT_EMAIL",
  "FINAL_JUDO_FIREBASE_PRIVATE_KEY",
  "FINAL_JUDO_VAPID_PUBLIC_KEY",
  "FINAL_JUDO_VAPID_PRIVATE_KEY",
  "FINAL_JUDO_VAPID_SUBJECT",
  "CRON_SECRET",
];

assert(
  sources.gitignore.includes("!.env.example") && sources.gitignore.includes("!.env.production.example"),
  ".gitignore must allow committed env example files while ignoring real env files",
);
assertEnvValue(devEnv, "FINAL_JUDO_DB_DRIVER", "json", ".env.example");
assertEnvValue(devEnv, "FINAL_JUDO_DATA_DIR", ".data", ".env.example");
assertEnvValue(devEnv, "PILOT_DB_FILE", ".data/final-judo-db.json", ".env.example");
assertEnvValue(devEnv, "FINAL_JUDO_ENABLE_DEMO_LOGIN", "0", ".env.example");
assertEnvValue(devEnv, "FINAL_JUDO_ENABLE_DEV_RESET", "0", ".env.example");
assertEnvValue(productionEnv, "NODE_ENV", "production", ".env.production.example");
assertEnvValue(productionEnv, "FINAL_JUDO_DB_DRIVER", "postgres", ".env.production.example");
assertEnvValue(productionEnv, "FINAL_JUDO_DATA_DIR", "", ".env.production.example");
assertEnvValue(productionEnv, "PILOT_DB_FILE", "", ".env.production.example");
assertEnvValue(productionEnv, "FINAL_JUDO_ENABLE_DEMO_LOGIN", "0", ".env.production.example");
assertEnvValue(productionEnv, "FINAL_JUDO_ENABLE_DEV_RESET", "0", ".env.production.example");
assertEnvValue(productionEnv, "FINAL_JUDO_PAYMENT_PROVIDER", "external", ".env.production.example");

for (const key of runtimeEnvKeys) {
  assertEnvHas(devEnv, key, ".env.example");
  assertEnvHas(productionEnv, key, ".env.production.example");
  assert(sources.environmentMatrix.includes(key), `docs/ENVIRONMENT_MATRIX.md must document ${key}`);
}

for (const forbidden of ["FINAL_JUDO_ENABLE_DEMO_LOGIN=1", "FINAL_JUDO_ENABLE_DEV_RESET=1", "ENABLE_DEMO_LOGIN=1", "ENABLE_DEV_RESET=1"]) {
  assert(!sources.envProductionExample.includes(forbidden), `.env.production.example must not enable ${forbidden}`);
}

for (const placeholder of [
  "postgresql://USER:PASSWORD@HOST:5432/final_judo",
  "replace-with-stable-installation-id",
  "replace-with-provider-webhook-secret",
  "replace-with-apple-team-id",
  "replace-with-apns-key-id",
  "replace-with-apns-p8-private-key",
  "replace-with-firebase-project-id",
  "replace-with-firebase-client-email",
  "replace-with-firebase-private-key",
  "replace-with-random-cron-secret",
]) {
  assert(sources.envProductionExample.includes(placeholder), `.env.production.example must keep explicit placeholder ${placeholder}`);
}

assert.equal(
  packageJson.scripts["test:env-readiness"],
  "node scripts/check-env-readiness.mjs",
  "package.json must expose test:env-readiness",
);
assert(
  packageJson.scripts.prebuild?.includes("check-production-runtime-environment.mjs"),
  "production runtime guard must run before every build",
);
assert.equal(
  packageJson.scripts["test:production-runtime-environment"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-production-runtime-environment-test.mjs",
  "package.json must expose test:production-runtime-environment",
);
assert.equal(
  packageJson.scripts["test:postgres-runtime-identity"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-postgres-runtime-identity-test.mjs",
  "package.json must expose test:postgres-runtime-identity",
);
for (const scriptName of [
  "test:live-production-runtime",
  "test:production-recovery-manifest",
  "test:admin-credential-recovery",
]) {
  assert(packageJson.scripts[scriptName], `package.json must expose ${scriptName}`);
  assert(
    sources.releaseRunner.includes(`["run", "${scriptName}"]`),
    `test:release must run ${scriptName}`,
  );
}
assert(
  sources.releaseRunner.includes('["run", "test:production-runtime-environment"]'),
  "test:release must run the production runtime environment gate",
);
assert(
  sources.productionRuntimePolicy.includes("PRODUCTION_RUNTIME_DRIVER_NOT_POSTGRES") &&
    sources.productionRuntimePolicy.includes("PRODUCTION_RUNTIME_POSTGRES_URL_INVALID"),
  "production runtime policy must fail closed without PostgreSQL",
);
assert(
  sources.productionRuntimeTest.includes("runtime guard output must not expose database credentials"),
  "production runtime test must verify secret redaction",
);
assert(sources.releaseRunner.includes('["run", "test:env-readiness"]'), "test:release must run env readiness");
// 자동 게이트 명령은 앱 UI가 아니라 docs/release runner에만 남긴다 (check-admin-settings-gates 정책과 일치).
assert(
  !sources.adminSettings.includes("npm run test:env-readiness"),
  "admin settings must not embed the env readiness gate command in app source",
);
assert(sources.serverDb.includes("FINAL_JUDO_DATA_DIR"), "server DB must support FINAL_JUDO_DATA_DIR");
assert(sources.serverDb.includes("PILOT_DB_FILE"), "server DB must support PILOT_DB_FILE");
assert(
  sources.serverDb.includes("turbopackIgnore: true"),
  "server DB runtime JSON path resolution must stay out of Turbopack static file tracing",
);

for (const [label, source] of [
  ["README", sources.readme],
  ["QA plan", sources.qaPlan],
  ["release checklist", sources.releaseChecklist],
  ["API contract", sources.apiContract],
]) {
  assert(source.includes("npm run test:env-readiness"), `${label} must document test:env-readiness`);
  assert(source.includes("docs/ENVIRONMENT_MATRIX.md") || source.includes("환경 변수 매트릭스"), `${label} must mention the environment matrix`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "committed env example files stay unignored",
        "development and production env examples use safe defaults",
        "runtime FINAL_JUDO_* variables are documented",
        "native APNs/FCM variables are documented without forcing optional Web Push VAPID",
        "production build and runtime fail closed without PostgreSQL",
        "production danger flags are disabled in examples",
        "release/admin/docs include test:env-readiness",
      ],
    },
    null,
    2,
  ),
);
