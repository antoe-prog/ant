import { createHash } from "node:crypto";
import { readFile, readdir, readlink, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_DIST_DIR = ".next";
const BUILD_MARKER_FILE = "BUILD_ID";
const BUILD_MANIFEST_FILE = "final-judo-build-readiness.json";
const BUILD_INPUT_DIRECTORIES = ["src", "public"];
const BUILD_INPUT_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "postcss.config.js",
  "postcss.config.mjs",
  "postcss.config.ts",
  "tsconfig.json",
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

export function getNextBuildDistDir(env = process.env) {
  return env.FINAL_JUDO_NEXT_DIST_DIR?.trim() || DEFAULT_DIST_DIR;
}

function getNextBuildArtifactPaths(distDir = getNextBuildDistDir()) {
  return {
    markerPath: path.join(distDir, BUILD_MARKER_FILE),
    manifestPath: path.join(distDir, BUILD_MANIFEST_FILE),
  };
}

async function readFileIfPresent(filePath, encoding = null) {
  try {
    return await readFile(filePath, encoding ?? undefined);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function hashEntry(hash, type, relativePath, content = "") {
  const value = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  hash.update(type);
  hash.update("\0");
  hash.update(normalizePath(relativePath));
  hash.update("\0");
  hash.update(String(value.byteLength));
  hash.update("\0");
  hash.update(value);
  hash.update("\0");
}

async function hashDirectory(hash, rootDir, relativeDirectory) {
  const directoryPath = path.join(rootDir, relativeDirectory);
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      hashEntry(hash, "missing-directory", relativeDirectory);
      return 1;
    }

    throw error;
  }

  hashEntry(hash, "directory", relativeDirectory);
  let inputCount = 1;

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const entryPath = path.join(rootDir, relativePath);

    if (entry.isDirectory()) {
      inputCount += await hashDirectory(hash, rootDir, relativePath);
    } else if (entry.isFile()) {
      hashEntry(hash, "file", relativePath, await readFile(entryPath));
      inputCount += 1;
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await readlink(entryPath);
      const linkedContent = await readFileIfPresent(entryPath);
      hashEntry(hash, "symlink", relativePath, linkedContent ?? linkTarget);
      inputCount += 1;
    }
  }

  return inputCount;
}

export async function createNextBuildInputFingerprint(rootDir = process.cwd()) {
  const hash = createHash("sha256");
  let inputCount = 0;

  for (const directory of BUILD_INPUT_DIRECTORIES) {
    inputCount += await hashDirectory(hash, rootDir, directory);
  }

  for (const file of BUILD_INPUT_FILES) {
    const content = await readFileIfPresent(path.join(rootDir, file));
    hashEntry(hash, content === null ? "missing-file" : "file", file, content ?? "");
    inputCount += 1;
  }

  return {
    inputHash: hash.digest("hex"),
    inputCount,
  };
}

export async function writeNextBuildReadinessManifest(rootDir = process.cwd(), distDir = getNextBuildDistDir()) {
  const { markerPath, manifestPath } = getNextBuildArtifactPaths(distDir);
  const buildId = (await readFileIfPresent(path.join(rootDir, markerPath), "utf8"))?.trim();

  if (!buildId) {
    throw new Error(`Cannot write ${manifestPath} because ${markerPath} is missing.`);
  }

  const fingerprint = await createNextBuildInputFingerprint(rootDir);
  const manifest = {
    version: 1,
    buildId,
    ...fingerprint,
    generatedAt: new Date().toISOString(),
  };

  await writeFile(path.join(rootDir, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, markerPath, manifestPath };
}

export async function inspectNextBuildReadiness(rootDir = process.cwd(), distDir = getNextBuildDistDir()) {
  const { markerPath, manifestPath } = getNextBuildArtifactPaths(distDir);
  const buildId = (await readFileIfPresent(path.join(rootDir, markerPath), "utf8"))?.trim();

  if (!buildId) {
    return { ready: false, reason: "missing-build", markerPath };
  }

  const manifestSource = await readFileIfPresent(path.join(rootDir, manifestPath), "utf8");

  if (!manifestSource) {
    return { ready: false, reason: "missing-fingerprint", markerPath, manifestPath };
  }

  let manifest;

  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    return { ready: false, reason: "invalid-fingerprint", markerPath, manifestPath };
  }

  if (manifest.version !== 1 || typeof manifest.inputHash !== "string" || manifest.buildId !== buildId) {
    return {
      ready: false,
      reason: "build-fingerprint-mismatch",
      markerPath,
      manifestPath,
      buildId,
    };
  }

  const fingerprint = await createNextBuildInputFingerprint(rootDir);

  if (fingerprint.inputHash !== manifest.inputHash) {
    return {
      ready: false,
      reason: "stale-build",
      markerPath,
      manifestPath,
      buildId,
      expectedInputHash: manifest.inputHash,
      ...fingerprint,
    };
  }

  return {
    ready: true,
    reason: "ready",
    markerPath,
    manifestPath,
    buildId,
    ...fingerprint,
  };
}

export async function assertFreshNextBuild(
  rootDir = process.cwd(),
  expectedBuild = null,
  distDir = getNextBuildDistDir(),
) {
  const report = await inspectNextBuildReadiness(rootDir, distDir);

  if (!report.ready) {
    throw new Error(
      `A fresh Next production build is required before this next start based check (${report.reason}). Run npm run build, then retry.`,
    );
  }

  if (
    expectedBuild &&
    (report.buildId !== expectedBuild.buildId || report.inputHash !== expectedBuild.inputHash)
  ) {
    throw new Error("The Next production build or its inputs changed while the next start based check was running. Retry the check.");
  }

  return report;
}
