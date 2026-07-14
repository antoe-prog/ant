import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const smokeOwnershipHeader = "x-final-judo-smoke-ownership-token";
const smokeDataDirectoryPrefix = "final-judo-release-smoke-";
const smokeDataOwnershipMarker = ".final-judo-smoke-owner.json";
const smokeDataFileName = "final-judo-db.json";

function isStrongSmokeOwnershipToken(token: string | undefined): token is string {
  return /^[a-f0-9]{64}$/.test(token ?? "");
}

export function getSmokeOwnershipDigest(env: NodeJS.ProcessEnv = process.env) {
  const token = env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN?.trim();

  return isStrongSmokeOwnershipToken(token) ? createHash("sha256").update(token!).digest("hex") : null;
}

async function isSymbolicLink(runtimePath: string) {
  try {
    return (await lstat(runtimePath)).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function hasValidSmokeDataOwnership(
  env: NodeJS.ProcessEnv = process.env,
  runtimeDataFile = env.PILOT_DB_FILE?.trim(),
) {
  const dataDir = env.FINAL_JUDO_DATA_DIR?.trim();
  const ownershipDigest = getSmokeOwnershipDigest(env);

  if (env.FINAL_JUDO_DB_DRIVER !== "json" || !dataDir || !runtimeDataFile || !ownershipDigest) {
    return false;
  }

  try {
    const [realDataDir, realDataFileDirectory, realTempDir] = await Promise.all([
      realpath(dataDir),
      realpath(dirname(resolve(/* turbopackIgnore: true */ process.cwd(), runtimeDataFile))),
      realpath(tmpdir()),
    ]);

    if (
      (await isSymbolicLink(dataDir)) ||
      dirname(realDataDir) !== realTempDir ||
      !basename(realDataDir).startsWith(smokeDataDirectoryPrefix) ||
      realDataFileDirectory !== realDataDir ||
      basename(runtimeDataFile) !== smokeDataFileName ||
      (await isSymbolicLink(runtimeDataFile))
    ) {
      return false;
    }

    const marker = JSON.parse(await readFile(join(realDataDir, smokeDataOwnershipMarker), "utf8"));

    return marker?.databaseFile === smokeDataFileName && marker?.ownershipDigest === ownershipDigest;
  } catch {
    return false;
  }
}

export function hasValidSmokeOwnershipToken(
  headers: Pick<Headers, "get">,
  env: NodeJS.ProcessEnv = process.env,
) {
  const expectedToken = env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN?.trim();
  const receivedToken = headers.get(smokeOwnershipHeader)?.trim();

  if (!isStrongSmokeOwnershipToken(expectedToken) || !receivedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const receivedBuffer = Buffer.from(receivedToken);

  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}
