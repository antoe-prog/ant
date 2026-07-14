import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertIsolatedSmokeDataEnvironment,
  assertOwnedSmokeServer,
  cleanupReleaseSmokeEnvironment,
  createReleaseSmokeEnvironment,
  getSmokeResetRequestOptions,
  getFreePort,
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const plans = [];
let occupiedServer = null;
let sharedDataDir = null;
let symlinkDataDir = null;
let ownedSymlinkDataDir = null;

try {
  const defaultPlan = await createReleaseSmokeEnvironment({ env: { FINAL_JUDO_DB_DRIVER: "postgres" } });
  plans.push(defaultPlan);
  assert.match(defaultPlan.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(defaultPlan.env.FINAL_JUDO_DB_DRIVER, "json");
  assert.equal(defaultPlan.env.FINAL_JUDO_DATA_DIR, defaultPlan.dataDir);
  assert.equal(defaultPlan.env.FINAL_JUDO_ENABLE_DEMO_LOGIN, "1");
  assert.equal(defaultPlan.env.FINAL_JUDO_ENABLE_DEV_RESET, "1");
  assert.match(defaultPlan.env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN, /^[a-f0-9]{64}$/);
  assert.equal(defaultPlan.env.FINAL_JUDO_PAYMENT_PROVIDER, "external");
  assert.equal(defaultPlan.env.FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL, "https://payments.finaljudo.test");
  assert.equal(defaultPlan.env.FINAL_JUDO_PAYMENT_WEBHOOK_SECRET, "final-judo-dev-webhook-secret");
  assert.equal(defaultPlan.env.PILOT_DB_FILE, `${defaultPlan.dataDir}/final-judo-db.json`);
  assert.equal(defaultPlan.env.SMOKE_SKIP_DEV_RESET, "0");
  const smokeRolePasswords = [
    defaultPlan.env.SMOKE_ADMIN_PASSWORD,
    defaultPlan.env.SMOKE_OWNER_PASSWORD,
    defaultPlan.env.SMOKE_COACH_PASSWORD,
    defaultPlan.env.SMOKE_GUARDIAN_PASSWORD,
    defaultPlan.env.SMOKE_MEMBER_PASSWORD,
  ];
  assert(smokeRolePasswords.every((password) => /^FJ-Smoke-[A-Za-z0-9_-]{20,}$/.test(password ?? "")));
  assert.equal(new Set(smokeRolePasswords).size, smokeRolePasswords.length, "isolated smoke role passwords must be unique");
  assert.equal(
    getSmokeResetRequestOptions({ env: defaultPlan.env }).headers["x-final-judo-smoke-ownership-token"],
    defaultPlan.env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN,
  );
  assert.throws(
    () => getSmokeResetRequestOptions({ env: {}, label: "release smoke regression" }),
    /helper-issued 256-bit lowercase hex/,
    "reset requests without an explicit server ownership token must fail before fetch",
  );
  await assert.doesNotReject(() =>
    assertIsolatedSmokeDataEnvironment({ env: defaultPlan.env, label: "release smoke regression" }),
  );
  await assert.rejects(
    () => assertIsolatedSmokeDataEnvironment({ env: {}, label: "release smoke regression" }),
    /explicit isolated JSON/,
    "UI reset checks must reject an implicit shared app server",
  );
  const predictableInheritedToken = "a".repeat(64);
  const standaloneEnv = { FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN: predictableInheritedToken };
  const standalonePlan = await prepareStandaloneSmokeEnvironment({
    baseUrl: "http://127.0.0.1:3999",
    env: standaloneEnv,
    label: "standalone smoke regression",
  });
  plans.push(standalonePlan);
  assert.equal(standalonePlan.created, true);
  assert.notEqual(
    standaloneEnv.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN,
    predictableInheritedToken,
    "standalone smoke preparation must replace inherited tokens instead of trusting their entropy",
  );
  assert.equal(standaloneEnv.PILOT_DB_FILE, join(standalonePlan.dataDir, "final-judo-db.json"));
  await assert.doesNotReject(() =>
    assertIsolatedSmokeDataEnvironment({ env: standaloneEnv, label: "standalone smoke regression" }),
  );

  sharedDataDir = await mkdtemp(join(tmpdir(), "shared-final-judo-data-"));
  const unsafeEnv = {
    FINAL_JUDO_DATA_DIR: sharedDataDir,
    FINAL_JUDO_DB_DRIVER: "json",
    FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN: defaultPlan.env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN,
    PILOT_DB_FILE: join(sharedDataDir, "final-judo-db.json"),
    SMOKE_BASE_URL: "http://127.0.0.1:3999",
  };
  await assert.rejects(
    () => assertIsolatedSmokeDataEnvironment({ env: unsafeEnv, label: "release smoke regression" }),
    /run-owned temporary data directory|outside its run-owned temporary directory/,
    "arbitrary temporary directories must not be accepted as isolated smoke storage",
  );
  await assert.rejects(
    () =>
      assertIsolatedSmokeDataEnvironment({
        env: { ...defaultPlan.env, PILOT_DB_FILE: ".data/final-judo-db.json" },
        label: "release smoke regression",
      }),
    /outside its run-owned temporary directory/,
    "an inherited shared PILOT_DB_FILE must not bypass isolated directory ownership",
  );
  symlinkDataDir = join(tmpdir(), `final-judo-release-smoke-symlink-${process.pid}-${Date.now()}`);
  await symlink(process.cwd(), symlinkDataDir, "dir");
  await assert.rejects(
    () =>
      assertIsolatedSmokeDataEnvironment({
        env: { ...unsafeEnv, FINAL_JUDO_DATA_DIR: symlinkDataDir },
        label: "release smoke regression",
      }),
    /run-owned temporary data directory|outside its run-owned temporary directory/,
    "symlink aliases to shared data must not be accepted as isolated smoke storage",
  );
  ownedSymlinkDataDir = join(tmpdir(), `final-judo-release-smoke-owned-symlink-${process.pid}-${Date.now()}`);
  await symlink(defaultPlan.dataDir, ownedSymlinkDataDir, "dir");
  await assert.rejects(
    () =>
      assertIsolatedSmokeDataEnvironment({
        env: {
          ...defaultPlan.env,
          FINAL_JUDO_DATA_DIR: ownedSymlinkDataDir,
          PILOT_DB_FILE: join(ownedSymlinkDataDir, "final-judo-db.json"),
        },
        label: "release smoke regression",
      }),
    /outside its run-owned temporary directory/,
    "symlink aliases to otherwise valid owned data must be rejected",
  );
  const linkedDataTarget = join(defaultPlan.dataDir, "linked-target.json");
  await writeFile(linkedDataTarget, "{}\n", "utf8");
  await symlink(linkedDataTarget, defaultPlan.env.PILOT_DB_FILE);
  await assert.rejects(
    () => assertIsolatedSmokeDataEnvironment({ env: defaultPlan.env, label: "release smoke regression" }),
    /outside its run-owned temporary directory/,
    "a symlinked runtime database file must be rejected",
  );
  await rm(defaultPlan.env.PILOT_DB_FILE, { force: true });

  const explicitPort = await getFreePort();
  const explicitBaseUrl = `http://127.0.0.1:${explicitPort}`;
  const explicitPlan = await createReleaseSmokeEnvironment({ baseUrl: explicitBaseUrl, env: {} });
  plans.push(explicitPlan);
  assert.equal(explicitPlan.baseUrl, explicitBaseUrl);
  assert.equal(explicitPlan.port, explicitPort);

  await assert.rejects(
    () => createReleaseSmokeEnvironment({ baseUrl: "https://final-judo.vercel.app", env: {} }),
    /unused local HTTP origin/,
    "remote origins must not be used for local release smoke checks",
  );

  const occupiedPort = await getFreePort();
  let occupiedResetPostCount = 0;
  occupiedServer = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/v1/dev/reset") {
      occupiedResetPostCount += 1;
    }
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("occupied");
  });
  await new Promise((resolve, reject) => {
    occupiedServer.once("error", reject);
    occupiedServer.listen(occupiedPort, "127.0.0.1", resolve);
  });

  await assert.rejects(
    () => createReleaseSmokeEnvironment({ baseUrl: `http://127.0.0.1:${occupiedPort}`, env: {} }),
    /Refusing to reuse the existing or unowned server/,
    "a reachable server must never be adopted by the release runner",
  );
  await assert.rejects(
    () =>
      assertOwnedSmokeServer({
        baseUrl: `http://127.0.0.1:${occupiedPort}`,
        env: defaultPlan.env,
        label: "release smoke regression",
      }),
    /unowned or differently configured/,
    "reset-capable UI checks must reject a reachable server without matching ownership attestation",
  );
  await assert.rejects(
    () =>
      resetOwnedSmokeServer({
        baseUrl: `http://127.0.0.1:${occupiedPort}`,
        env: defaultPlan.env,
        label: "release smoke regression",
      }),
    /unowned or differently configured/,
    "the centralized reset helper must attest before issuing a destructive request",
  );
  assert.equal(occupiedResetPostCount, 0, "failed ownership attestation must leave reset POST count at zero");

  for (const scriptPath of [
    "scripts/check-phone-signup-login-flow.mjs",
    "scripts/check-class-management-touch-targets.mjs",
  ]) {
    const source = await readFile(scriptPath, "utf8");

    assert.match(source, /await assertOwnedSmokeServer\(/, `${scriptPath} must attest a reachable server before reuse`);
  }

  const resetCallerPaths = (await readdir("scripts", { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => `scripts/${entry.name}`);
  let resetCallerCount = 0;
  let standaloneSpawnerCount = 0;

  for (const scriptPath of resetCallerPaths) {
    const source = await readFile(scriptPath, "utf8");

    if (
      scriptPath === "scripts/check-p5-p10-internal-readiness.mjs" ||
      scriptPath === "scripts/check-release-smoke-isolation.mjs"
    ) {
      continue;
    }

    assert.doesNotMatch(
      source,
      /\/api\/v1\/dev\/reset/,
      `${scriptPath} must not bypass the centralized owned reset helper`,
    );

    if (source.includes("resetOwnedSmokeServer(")) {
      resetCallerCount += 1;
    }

    if (source.includes("spawn(") && (source.includes('"dev"') || source.includes('"run", "dev"'))) {
      if (!source.includes("resetOwnedSmokeServer(")) {
        continue;
      }

      standaloneSpawnerCount += 1;
      assert.match(
        source,
        /await prepareStandaloneSmokeEnvironment\(/,
        `${scriptPath} must create or verify run-owned temporary data before starting a reset-capable server`,
      );
    }
  }
  assert.equal(resetCallerCount, 24, "release reset ownership contract must cover every reset-capable script");
  assert.equal(standaloneSpawnerCount, 17, "every standalone JSON reset server must use run-owned temporary data");

  for (const plan of plans) {
    await cleanupReleaseSmokeEnvironment(plan);
    await assert.rejects(access(plan.dataDir), { code: "ENOENT" }, "isolated smoke data must be removed");
  }
  plans.length = 0;

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "default release smoke target uses a free local port",
          "managed server environment limits demo login and reset flags to isolated JSON data",
          "explicit unused local origins are supported",
          "remote origins and reachable unowned servers are rejected",
          "reset-capable UI checks require matching server ownership attestation",
          "reset requests require the isolated server ownership token",
          "standalone checks replace inherited ownership tokens",
          "standalone reset checks create run-owned temporary JSON data",
          "the actual PILOT_DB_FILE target is bound to run-owned temporary JSON data",
          "arbitrary and symlinked data paths are rejected",
          "every reset-capable script uses the centralized owned reset contract",
          "isolated smoke data is removed after the run",
          "UI reset checks require explicit isolated JSON data",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (occupiedServer) {
    await new Promise((resolve) => occupiedServer.close(resolve));
  }

  await Promise.all(plans.map((plan) => cleanupReleaseSmokeEnvironment(plan)));
  await Promise.all([
    sharedDataDir ? rm(sharedDataDir, { force: true, recursive: true }) : undefined,
    symlinkDataDir ? rm(symlinkDataDir, { force: true }) : undefined,
    ownedSymlinkDataDir ? rm(ownedSymlinkDataDir, { force: true }) : undefined,
  ]);
}
