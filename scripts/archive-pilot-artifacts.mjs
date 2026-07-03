import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const manifestPath = path.resolve(args.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length) ?? ".data/pilot-artifact-manifest.json");
const requestedArchiveDir = args.find((arg) => arg.startsWith("--archive-dir="))?.slice("--archive-dir=".length);
const archiveDir = path.resolve(
  requestedArchiveDir ??
    path.join(".data", "pilot-archives", new Date().toISOString().replace(/[:.]/g, "-")),
);
const outFile = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
const outPath = path.resolve(outFile ?? path.join(archiveDir, "pilot-archive-manifest.json"));
const artifactsDir = path.join(archiveDir, "artifacts");
const placeholderPattern = /\b(todo|tbd|placeholder)\b|yyyy|mmdd|미정|확인 필요/i;

const requiredArtifactKeys = [
  "prePilotPreflight",
  "prePilotEvidence",
  "prePilotMarkdown",
  "prePilotReadinessEvidence",
  "launchPackage",
  "passwordRotationEvidence",
  "postPilotPreflight",
  "postPilotEvidence",
  "postPilotMarkdown",
  "fieldEvidence",
  "closeoutPackage",
];

function addIssue(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function archiveFileName(index, key, artifactPath, type) {
  const extension = path.extname(artifactPath) || (type === "json" ? ".json" : ".txt");
  return `${String(index + 1).padStart(2, "0")}-${safeName(key)}${extension}`;
}

function validateArchivePath(blockers) {
  if (requestedArchiveDir && placeholderPattern.test(requestedArchiveDir)) {
    addIssue(blockers, "ARCHIVE_DIR_PLACEHOLDER", "archive directory must use a final pilot/date label, not a placeholder path.", {
      archiveDir: requestedArchiveDir,
    });
  }

  if (outFile && placeholderPattern.test(outFile)) {
    addIssue(blockers, "ARCHIVE_OUT_PLACEHOLDER", "archive manifest output path must not contain placeholder text.", {
      outFile,
    });
  }
}

async function readJson(filePath, blockers, code, message) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    addIssue(blockers, code, message, {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function archiveDirExists() {
  try {
    await stat(archiveDir);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function validateSourceArtifact(key, artifact, blockers) {
  const artifactPath = path.resolve(text(artifact?.path));
  const expectedSha = text(artifact?.sha256);
  const expectedSize = Number(artifact?.sizeBytes);
  const type = text(artifact?.type);

  if (!artifactPath || !expectedSha || !Number.isFinite(expectedSize) || expectedSize <= 0) {
    addIssue(blockers, "ARTIFACT_MANIFEST_ENTRY_INVALID", "artifact manifest entries must include path, sha256, and positive sizeBytes.", {
      key,
      path: artifact?.path ?? null,
      sha256: artifact?.sha256 ?? null,
      sizeBytes: artifact?.sizeBytes ?? null,
    });
    return null;
  }

  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    addIssue(blockers, "ARTIFACT_SHA_INVALID", "artifact manifest sha256 must be a 64-character lowercase hex digest.", {
      key,
      sha256: expectedSha,
    });
    return null;
  }

  try {
    const buffer = await readFile(artifactPath);
    const actualSha = sha256(buffer);
    const actualSize = buffer.byteLength;

    if (actualSha !== expectedSha) {
      addIssue(blockers, "ARTIFACT_HASH_MISMATCH", "source artifact SHA-256 does not match the pilot artifact manifest.", {
        key,
        path: artifactPath,
        expectedSha,
        actualSha,
      });
    }

    if (actualSize !== expectedSize) {
      addIssue(blockers, "ARTIFACT_SIZE_MISMATCH", "source artifact byte size does not match the pilot artifact manifest.", {
        key,
        path: artifactPath,
        expectedSize,
        actualSize,
      });
    }

    return {
      key,
      label: text(artifact?.label),
      type,
      sourcePath: artifactPath,
      sizeBytes: actualSize,
      sha256: actualSha,
      buffer,
    };
  } catch (error) {
    addIssue(blockers, "ARTIFACT_SOURCE_UNREADABLE", "source artifact listed in the pilot artifact manifest must be readable.", {
      key,
      path: artifactPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function buildResult({ generatedAt, sourceManifest, archivedArtifacts, blockers }) {
  return {
    ok: blockers.length === 0,
    generatedAt,
    releaseDecision: blockers.length === 0 ? "ready" : "blocked",
    sourceManifest,
    archiveDir,
    archiveManifestPath: outPath,
    artifacts: Object.fromEntries(
      archivedArtifacts.map((artifact) => [
        artifact.key,
        {
          label: artifact.label,
          type: artifact.type,
          sourcePath: artifact.sourcePath,
          archivedPath: artifact.archivedPath,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
        },
      ]),
    ),
    checked: [
      "pilot artifact manifest ready decision",
      "required artifact entries present",
      "source artifact SHA-256 and byte-size revalidation",
      "immutable archive directory creation",
      "source artifact copy to archive",
      "pilot artifact manifest copy to archive",
      "archive copy SHA-256 and byte-size verification",
      "archive manifest write",
    ],
    blockers,
  };
}

async function validateArchivedFile({ key, path: filePath, expectedSha, expectedSize }, blockers) {
  try {
    const buffer = await readFile(filePath);
    const actualSha = sha256(buffer);
    const actualSize = buffer.byteLength;

    if (actualSha !== expectedSha) {
      addIssue(blockers, "ARCHIVE_COPY_HASH_MISMATCH", "archived artifact SHA-256 does not match the verified source artifact.", {
        key,
        path: filePath,
        expectedSha,
        actualSha,
      });
    }

    if (actualSize !== expectedSize) {
      addIssue(blockers, "ARCHIVE_COPY_SIZE_MISMATCH", "archived artifact byte size does not match the verified source artifact.", {
        key,
        path: filePath,
        expectedSize,
        actualSize,
      });
    }
  } catch (error) {
    addIssue(blockers, "ARCHIVE_COPY_UNREADABLE", "archived artifact must be readable after copy.", {
      key,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function validateArchivedCopies(sourceManifest, archivedArtifacts, blockers) {
  await validateArchivedFile(
    {
      key: "pilotArtifactManifest",
      path: sourceManifest.archivedPath,
      expectedSha: sourceManifest.sha256,
      expectedSize: sourceManifest.sizeBytes,
    },
    blockers,
  );

  await Promise.all(
    archivedArtifacts.map((artifact) =>
      validateArchivedFile(
        {
          key: artifact.key,
          path: artifact.archivedPath,
          expectedSha: artifact.sha256,
          expectedSize: artifact.sizeBytes,
        },
        blockers,
      ),
    ),
  );
}

async function main() {
  const blockers = [];
  const generatedAt = new Date().toISOString();
  validateArchivePath(blockers);
  const manifestBuffer = await readFile(manifestPath).catch((error) => {
    addIssue(blockers, "ARTIFACT_MANIFEST_UNREADABLE", "pilot artifact manifest must be readable.", {
      path: manifestPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  const manifest = manifestBuffer
    ? await readJson(manifestPath, blockers, "ARTIFACT_MANIFEST_INVALID_JSON", "pilot artifact manifest must be valid JSON.")
    : null;
  const sourceManifest = {
    path: manifestPath,
    archivedPath: path.join(archiveDir, "pilot-artifact-manifest.json"),
    sizeBytes: manifestBuffer?.byteLength ?? 0,
    sha256: manifestBuffer ? sha256(manifestBuffer) : null,
  };

  if (manifest && (manifest.ok !== true || manifest.releaseDecision !== "ready" || manifest.blockers?.length > 0)) {
    addIssue(blockers, "ARTIFACT_MANIFEST_NOT_READY", "pilot artifact manifest must be ready before archiving.", {
      ok: manifest.ok ?? null,
      releaseDecision: manifest.releaseDecision ?? null,
      blockers: manifest.blockers ?? null,
    });
  }

  const manifestArtifacts = manifest?.artifacts && typeof manifest.artifacts === "object" ? manifest.artifacts : {};
  for (const key of requiredArtifactKeys) {
    if (!manifestArtifacts[key]) {
      addIssue(blockers, "ARTIFACT_MANIFEST_MISSING_ENTRY", "pilot artifact manifest is missing a required artifact entry.", { key });
    }
  }

  let sourceArtifacts = [];
  if (manifest) {
    sourceArtifacts = (
      await Promise.all(
        requiredArtifactKeys.map((key) => validateSourceArtifact(key, manifestArtifacts[key], blockers)),
      )
    ).filter(Boolean);
  }

  if (await archiveDirExists()) {
    addIssue(blockers, "ARCHIVE_DIR_EXISTS", "archive directory must not already exist; use a fresh immutable archive directory.", {
      archiveDir,
    });
  }

  if (blockers.length > 0) {
    const result = buildResult({ generatedAt, sourceManifest, archivedArtifacts: [], blockers });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  const archivedArtifacts = [];

  try {
    await mkdir(path.dirname(archiveDir), { recursive: true });
    await mkdir(archiveDir, { recursive: false });
    await mkdir(artifactsDir, { recursive: false });

    await copyFile(manifestPath, sourceManifest.archivedPath);

    for (const [index, artifact] of sourceArtifacts.entries()) {
      const archivedPath = path.join(artifactsDir, archiveFileName(index, artifact.key, artifact.sourcePath, artifact.type));
      await writeFile(archivedPath, artifact.buffer);
      archivedArtifacts.push({ ...artifact, archivedPath });
    }
  } catch (error) {
    addIssue(blockers, "ARTIFACT_ARCHIVE_WRITE_FAILED", "pilot release artifacts could not be copied to the archive directory.", {
      archiveDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (blockers.length === 0) {
    await validateArchivedCopies(sourceManifest, archivedArtifacts, blockers);
  }

  const result = buildResult({ generatedAt, sourceManifest, archivedArtifacts, blockers });

  if (blockers.length === 0) {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(result, null, 2));

  if (blockers.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
