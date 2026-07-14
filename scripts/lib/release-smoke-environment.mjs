import { rmSync } from "node:fs";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;

      server.close(() => {
        if (!port) {
          reject(new Error("Could not allocate an isolated local port for release smoke checks."));
          return;
        }

        resolve(port);
      });
    });
  });
}

export async function canReachHttpOrigin(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    await fetch(baseUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function createSmokeOwnershipToken() {
  return randomBytes(32).toString("hex");
}

export const smokeOwnershipHeader = "x-final-judo-smoke-ownership-token";
export const smokeDataDirectoryPrefix = "final-judo-release-smoke-";
export const smokeDataOwnershipMarker = ".final-judo-smoke-owner.json";
export const smokeDataFileName = "final-judo-db.json";
const smokeRolePasswordEnvKeys = [
  "SMOKE_ADMIN_PASSWORD",
  "SMOKE_OWNER_PASSWORD",
  "SMOKE_COACH_PASSWORD",
  "SMOKE_GUARDIAN_PASSWORD",
  "SMOKE_MEMBER_PASSWORD",
];

function issueSmokeRolePasswords(env) {
  for (const envKey of smokeRolePasswordEnvKeys) {
    env[envKey] = `FJ-Smoke-${randomBytes(18).toString("base64url")}`;
  }
}

function assertStrongSmokeOwnershipToken(token, label) {
  if (!/^[a-f0-9]{64}$/.test(token ?? "")) {
    throw new Error(`${label} requires a helper-issued 256-bit lowercase hex FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN.`);
  }

  return token;
}

export function issueSmokeOwnershipToken(env = process.env) {
  const token = createSmokeOwnershipToken();
  env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN = token;
  return token;
}

export function getSmokeResetRequestOptions({ env = process.env, label = "smoke check" } = {}) {
  const token = env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN?.trim();

  assertStrongSmokeOwnershipToken(token, label);

  return {
    method: "POST",
    headers: {
      [smokeOwnershipHeader]: token,
    },
  };
}

export function getSmokeOwnershipDigest(token) {
  if (!token?.trim()) {
    throw new Error("An explicit smoke server ownership token is required.");
  }

  return createHash("sha256").update(token).digest("hex");
}

export async function assertOwnedSmokeServer({ baseUrl, env = process.env, label = "smoke check" }) {
  const token = env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN?.trim();

  assertStrongSmokeOwnershipToken(token, label);

  let response;

  try {
    response = await fetch(new URL("/api/v1/dev/smoke-attestation", baseUrl), {
      method: "GET",
      redirect: "manual",
    });
  } catch {
    throw new Error(`${label} could not attest ownership of the server at ${baseUrl}.`);
  }

  const payload = await response.json().catch(() => null);
  const expectedDigest = getSmokeOwnershipDigest(token);

  if (!response.ok || payload?.data?.ownershipDigest !== expectedDigest) {
    throw new Error(`${label} refuses to reuse the unowned or differently configured server at ${baseUrl}.`);
  }
}

async function writeSmokeDataOwnershipMarker(dataDir, token) {
  await writeFile(
    path.join(dataDir, smokeDataOwnershipMarker),
    `${JSON.stringify({
      databaseFile: smokeDataFileName,
      ownershipDigest: getSmokeOwnershipDigest(token),
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function resolveRuntimePath(runtimePath) {
  return path.resolve(process.cwd(), runtimePath);
}

async function isSymbolicLink(runtimePath) {
  try {
    return (await lstat(runtimePath)).isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function assertIsolatedSmokeDataEnvironment({ env = process.env, label = "smoke check" } = {}) {
  const baseUrl = env.SMOKE_BASE_URL?.trim();
  const dataDir = env.FINAL_JUDO_DATA_DIR?.trim();
  const dataFile = env.PILOT_DB_FILE?.trim();
  const token = env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN?.trim();

  if (!baseUrl || !dataDir || !dataFile || env.FINAL_JUDO_DB_DRIVER !== "json") {
    throw new Error(`${label} requires SMOKE_BASE_URL and an explicit isolated JSON data file.`);
  }

  assertStrongSmokeOwnershipToken(token, label);

  let realDataDir;
  let realDataFileDirectory;
  let realTempDir;
  let marker;

  try {
    [realDataDir, realDataFileDirectory, realTempDir] = await Promise.all([
      realpath(dataDir),
      realpath(path.dirname(resolveRuntimePath(dataFile))),
      realpath(tmpdir()),
    ]);
    marker = JSON.parse(await readFile(path.join(realDataDir, smokeDataOwnershipMarker), "utf8"));
  } catch {
    throw new Error(`${label} requires a run-owned temporary data directory and ownership marker.`);
  }

  if (
    (await isSymbolicLink(dataDir)) ||
    path.dirname(realDataDir) !== realTempDir ||
    !path.basename(realDataDir).startsWith(smokeDataDirectoryPrefix) ||
    realDataFileDirectory !== realDataDir ||
    path.basename(dataFile) !== smokeDataFileName ||
    (await isSymbolicLink(dataFile)) ||
    marker?.databaseFile !== smokeDataFileName ||
    marker?.ownershipDigest !== getSmokeOwnershipDigest(token)
  ) {
    throw new Error(`${label} refuses to mutate data outside its run-owned temporary directory.`);
  }
}

export async function prepareStandaloneSmokeEnvironment({
  baseUrl,
  env = process.env,
  label = "standalone smoke check",
} = {}) {
  if (!baseUrl) {
    throw new Error(`${label} requires an explicit local baseUrl.`);
  }

  env.SMOKE_BASE_URL = baseUrl;
  issueSmokeRolePasswords(env);

  if (env.FINAL_JUDO_DATA_DIR?.trim()) {
    if (env.FINAL_JUDO_DB_DRIVER !== "json") {
      throw new Error(`${label} refuses to replace an explicitly configured non-JSON database.`);
    }

    env.PILOT_DB_FILE ||= path.join(resolveRuntimePath(env.FINAL_JUDO_DATA_DIR), smokeDataFileName);
    await assertIsolatedSmokeDataEnvironment({ env, label });
    return { created: false, dataDir: env.FINAL_JUDO_DATA_DIR };
  }

  if (env.FINAL_JUDO_DB_DRIVER && env.FINAL_JUDO_DB_DRIVER !== "json") {
    throw new Error(`${label} refuses to replace an explicitly configured non-JSON database.`);
  }

  const token = issueSmokeOwnershipToken(env);
  const dataDir = await mkdtemp(path.join(tmpdir(), smokeDataDirectoryPrefix));
  await writeSmokeDataOwnershipMarker(dataDir, token);
  env.FINAL_JUDO_DB_DRIVER = "json";
  env.FINAL_JUDO_DATA_DIR = dataDir;
  env.PILOT_DB_FILE = path.join(dataDir, smokeDataFileName);
  env.FINAL_JUDO_ENABLE_DEMO_LOGIN = "1";
  env.FINAL_JUDO_ENABLE_DEV_RESET = "1";
  env.SMOKE_SKIP_DEV_RESET = "0";

  if (env === process.env) {
    process.once("exit", () => rmSync(dataDir, { force: true, recursive: true }));
  }

  return { created: true, dataDir };
}

export async function resetOwnedSmokeServer({ baseUrl, env = process.env, label = "smoke reset" }) {
  await assertOwnedSmokeServer({ baseUrl, env, label });

  return fetch(
    new URL("/api/v1/dev/reset", baseUrl),
    getSmokeResetRequestOptions({ env, label }),
  );
}

function parseLocalSmokeOrigin(baseUrl) {
  let target;

  try {
    target = new URL(baseUrl);
  } catch {
    throw new Error(`SMOKE_BASE_URL must be a valid local HTTP URL; received ${baseUrl}`);
  }

  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    !target.port ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    throw new Error("Release smoke checks require an unused local HTTP origin with an explicit port.");
  }

  return target;
}

export async function createReleaseSmokeEnvironment({ baseUrl = null, env = process.env } = {}) {
  const resolvedBaseUrl = baseUrl?.trim() || `http://127.0.0.1:${await getFreePort()}`;
  const target = parseLocalSmokeOrigin(resolvedBaseUrl);

  if (await canReachHttpOrigin(resolvedBaseUrl)) {
    throw new Error(
      `Refusing to reuse the existing or unowned server at ${resolvedBaseUrl}. Omit SMOKE_BASE_URL or provide an unused local port.`,
    );
  }

  const ownershipToken = createSmokeOwnershipToken();
  const dataDir = await mkdtemp(path.join(tmpdir(), smokeDataDirectoryPrefix));
  await writeSmokeDataOwnershipMarker(dataDir, ownershipToken);
  const smokeEnv = { ...env };
  issueSmokeRolePasswords(smokeEnv);

  return {
    baseUrl: resolvedBaseUrl,
    hostname: target.hostname === "localhost" ? "localhost" : target.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: Number(target.port),
    dataDir,
    env: {
      ...smokeEnv,
      SMOKE_BASE_URL: resolvedBaseUrl,
      FINAL_JUDO_DB_DRIVER: "json",
      FINAL_JUDO_DATA_DIR: dataDir,
      FINAL_JUDO_ENABLE_DEMO_LOGIN: "1",
      FINAL_JUDO_ENABLE_DEV_RESET: "1",
      FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN: ownershipToken,
      FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "https://payments.finaljudo.test",
      FINAL_JUDO_PAYMENT_PROVIDER: "external",
      FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "final-judo-dev-webhook-secret",
      PILOT_DB_FILE: path.join(dataDir, smokeDataFileName),
      SMOKE_SKIP_DEV_RESET: "0",
    },
  };
}

export async function cleanupReleaseSmokeEnvironment(plan) {
  if (plan?.dataDir) {
    await rm(plan.dataDir, { force: true, recursive: true });
  }
}
