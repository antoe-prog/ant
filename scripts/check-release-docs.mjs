import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const releaseRunnerPath = "scripts/run-release-checks.mjs";
const releaseRunner = readFileSync(releaseRunnerPath, "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const checksBlockMatch = releaseRunner.match(/const checks = \[([\s\S]*?)\];/);
const directReleaseEntrypoints = [
  {
    script: "dev",
    expectedCommand: "node node_modules/next/dist/bin/next dev",
    path: "node_modules/next/dist/bin/next",
  },
  {
    script: "lint",
    expectedCommand: "node node_modules/eslint/bin/eslint.js",
    path: "node_modules/eslint/bin/eslint.js",
  },
  {
    script: "build",
    expectedCommand: "node node_modules/next/dist/bin/next build",
    path: "node_modules/next/dist/bin/next",
  },
  {
    script: "start",
    expectedCommand: "node node_modules/next/dist/bin/next start",
    path: "node_modules/next/dist/bin/next",
  },
];
const serverManagedCommands = [
  "npm run test:routes",
  "npm run test:e2e",
  "npm run test:smoke",
  "npm run test:attendance-speed",
];

assert(checksBlockMatch, "release runner must expose a checks array");

const releaseCommands = [...checksBlockMatch[1].matchAll(/\[([^\]]+)\]/g)].map((match) => {
  const args = JSON.parse(`[${match[1]}]`);
  return `npm ${args.join(" ")}`;
});

const documentedCommands = [...releaseCommands, "npm run test:release"];

const documents = [
  { path: "README.md", label: "README verification section" },
  { path: "docs/QA_TEST_PLAN.md", label: "QA pass criteria" },
  { path: "docs/RELEASE_CHECKLIST.md", label: "release checklist" },
];

const missing = [];
const missingScripts = [];

for (const command of documentedCommands) {
  const scriptMatch = command.match(/^npm run (.+)$/);

  if (scriptMatch && !packageJson.scripts?.[scriptMatch[1]]) {
    missingScripts.push(`package.json scripts is missing ${scriptMatch[1]}`);
  }
}

for (const entrypoint of directReleaseEntrypoints) {
  assert.equal(
    packageJson.scripts?.[entrypoint.script],
    entrypoint.expectedCommand,
    `package.json ${entrypoint.script} must call ${entrypoint.expectedCommand} so release checks do not depend on node_modules/.bin shims`,
  );
  assert(existsSync(entrypoint.path), `${entrypoint.path} must exist for npm run ${entrypoint.script}`);
}

assert(
  releaseRunner.includes("serverManagedChecks"),
  "release runner must declare serverManagedChecks for local smoke/E2E commands",
);
assert(
  releaseRunner.includes("ensureServerForSmokeChecks") && releaseRunner.includes("stopManagedServer"),
  "release runner must start and stop a managed app server around local smoke/E2E commands",
);
assert(
  releaseRunner.includes("createReleaseSmokeEnvironment") &&
    releaseRunner.includes('"test:release-smoke-isolation"'),
  "release runner must allocate and behavior-test an isolated smoke environment",
);
assert(
  releaseRunner.includes("cleanupReleaseSmokeEnvironment"),
  "release runner must remove its isolated smoke data after managed checks",
);
assert(
  !releaseRunner.includes("Using existing app server"),
  "release runner must not reuse a reachable unowned smoke server",
);
assert(
  releaseRunner.includes("serverManagedChecks.has(label) ? smokeEnvironment : process.env"),
  "release runner must scope isolated smoke environment variables to server-managed checks",
);
assert(
  releaseRunner.includes('["run", "start", "--", "--hostname"') && !releaseRunner.includes('["run", "dev", "--"'),
  "release runner managed app server must use the fresh production build through next start",
);

for (const command of serverManagedCommands) {
  assert(
    releaseRunner.includes(`"${command}"`),
    `release runner serverManagedChecks must include ${command}`,
  );
}

assert(
  nextConfig.includes("outputFileTracingExcludes"),
  "next.config.ts must exclude runtime-only data artifacts from output tracing",
);
assert(nextConfig.includes('"/*"'), "next.config.ts outputFileTracingExcludes must apply to all routes");
assert(
  nextConfig.includes('"./.data/**/*"'),
  "next.config.ts outputFileTracingExcludes must exclude .data runtime artifacts",
);

for (const document of documents) {
  const content = readFileSync(document.path, "utf8");

  for (const command of documentedCommands) {
    if (!content.includes(command)) {
      missing.push(`${document.label} is missing ${command}`);
    }
  }
}

const readme = readFileSync("README.md", "utf8");
const verificationBlockMatch = readme.match(/## 검증\s+```bash\n([\s\S]*?)\n```/);

assert(verificationBlockMatch, "README.md must keep a bash command block directly under ## 검증");

const readmeVerificationCommands = verificationBlockMatch[1]
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

assert.deepEqual(
  readmeVerificationCommands,
  documentedCommands,
  "README.md ## 검증 command block must match scripts/run-release-checks.mjs order, followed by npm run test:release",
);

assert.equal(missingScripts.length, 0, missingScripts.join("\n"));
assert.equal(missing.length, 0, missing.join("\n"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "release runner npm scripts exist in package.json",
        "dev/lint/build/start scripts use direct Node package entrypoints",
        "release runner manages an isolated local smoke/E2E server and JSON data lifecycle with next start",
        "Next output tracing excludes runtime-only .data artifacts",
        "README verification command order matches release runner",
        ...documents.map((document) => document.path),
      ],
      releaseCommands: documentedCommands,
    },
    null,
    2,
  ),
);
