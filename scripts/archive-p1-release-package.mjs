import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const packagePath = path.resolve(args.package ?? ".data/p1-release-package.json");
const requestedArchiveDir = args.archiveDir;
const archiveDir = path.resolve(
  requestedArchiveDir ?? path.join(".data", "p1-release-archives", new Date().toISOString().replace(/[:.]/g, "-")),
);
const outPath = path.resolve(args.out ?? path.join(archiveDir, "p1-release-archive-manifest.json"));
const artifactsDir = path.join(archiveDir, "artifacts");
const placeholderPattern = /\b(todo|tbd|placeholder|sample|example|dummy)\b|yyyy|mmdd|미정|확인 필요/i;

const requiredArtifactKeys = [
  "p1Readiness",
  "p1EvidenceIntake",
  "deploymentHandoff",
  "androidReleaseHandoff",
  "iosIpaBuild",
  "paymentProviderHandoff",
  "notificationPushHandoff",
  "issueRegistrationReceipt",
  "pilotFinalStatus",
];

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    const normalizedKey = key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[normalizedKey] = value;
  }

  return parsed;
}

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

function archiveFileName(index, key, artifactPath) {
  const extension = path.extname(artifactPath) || ".json";
  return `${String(index + 1).padStart(2, "0")}-${safeName(key)}${extension}`;
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?(PRIVATE KEY|END [^-]+KEY)-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

function validateArchivePath(blockers) {
  if (requestedArchiveDir && placeholderPattern.test(requestedArchiveDir)) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_DIR_PLACEHOLDER", "P1 release archive directory must use a final release/date label, not a placeholder path.", {
      archiveDir: requestedArchiveDir,
    });
  }

  if (args.out && placeholderPattern.test(args.out)) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_OUT_PLACEHOLDER", "P1 release archive manifest output path must not contain placeholder text.", {
      out: args.out,
    });
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

async function readJsonFile(filePath, blockers, code, message) {
  try {
    const buffer = await readFile(filePath);
    return { buffer, json: JSON.parse(buffer.toString("utf8")) };
  } catch (error) {
    addIssue(blockers, code, message, {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { buffer: null, json: null };
  }
}

async function validatePackageArtifact(key, artifact, blockers) {
  const sourcePath = path.resolve(text(artifact?.path));
  const expectedSha = text(artifact?.sha256);
  const expectedSize = Number(artifact?.sizeBytes);

  if (!sourcePath || !expectedSha || !Number.isFinite(expectedSize) || expectedSize <= 0) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_ARTIFACT_ENTRY_INVALID", "P1 release package artifact entries must include path, sha256, and positive sizeBytes.", {
      key,
      path: artifact?.path ?? null,
      sha256: artifact?.sha256 ?? null,
      sizeBytes: artifact?.sizeBytes ?? null,
    });
    return null;
  }

  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_ARTIFACT_SHA_INVALID", "P1 release package artifact sha256 must be a 64-character lowercase hex digest.", {
      key,
      sha256: expectedSha,
    });
    return null;
  }

  try {
    const buffer = await readFile(sourcePath);
    const source = buffer.toString("utf8");
    const actualSha = sha256(buffer);
    const actualSize = buffer.byteLength;

    if (actualSha !== expectedSha) {
      addIssue(blockers, "P1_RELEASE_ARCHIVE_ARTIFACT_HASH_MISMATCH", "source artifact SHA-256 does not match the P1 release package manifest.", {
        key,
        path: sourcePath,
        expectedSha,
        actualSha,
      });
    }

    if (actualSize !== expectedSize) {
      addIssue(blockers, "P1_RELEASE_ARCHIVE_ARTIFACT_SIZE_MISMATCH", "source artifact byte size does not match the P1 release package manifest.", {
        key,
        path: sourcePath,
        expectedSize,
        actualSize,
      });
    }

    if (hasSecretLikeSource(source)) {
      addIssue(blockers, "P1_RELEASE_ARCHIVE_SECRET_LIKE_VALUE", "P1 release archive artifacts must not include raw secret-like values.", {
        key,
        path: sourcePath,
      });
    }

    return {
      key,
      label: text(artifact?.label) || key,
      sourcePath,
      sizeBytes: actualSize,
      sha256: actualSha,
      generatedAt: artifact?.generatedAt ?? null,
      releaseDecision: artifact?.releaseDecision ?? null,
      buffer,
    };
  } catch (error) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_ARTIFACT_UNREADABLE", "source artifact listed in the P1 release package must be readable.", {
      key,
      path: sourcePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function validateArchivedFile({ key, filePath, expectedSha, expectedSize }, blockers) {
  try {
    const buffer = await readFile(filePath);
    const actualSha = sha256(buffer);
    const actualSize = buffer.byteLength;

    if (actualSha !== expectedSha) {
      addIssue(blockers, "P1_RELEASE_ARCHIVE_COPY_HASH_MISMATCH", "archived copy SHA-256 does not match the verified source.", {
        key,
        path: filePath,
        expectedSha,
        actualSha,
      });
    }

    if (actualSize !== expectedSize) {
      addIssue(blockers, "P1_RELEASE_ARCHIVE_COPY_SIZE_MISMATCH", "archived copy byte size does not match the verified source.", {
        key,
        path: filePath,
        expectedSize,
        actualSize,
      });
    }
  } catch (error) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_COPY_UNREADABLE", "archived copy must be readable after copy.", {
      key,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function validateArchivedCopies(sourcePackage, archivedArtifacts, blockers) {
  await validateArchivedFile(
    {
      key: "p1ReleasePackage",
      filePath: sourcePackage.archivedPath,
      expectedSha: sourcePackage.sha256,
      expectedSize: sourcePackage.sizeBytes,
    },
    blockers,
  );

  await Promise.all(
    archivedArtifacts.map((artifact) =>
      validateArchivedFile(
        {
          key: artifact.key,
          filePath: artifact.archivedPath,
          expectedSha: artifact.sha256,
          expectedSize: artifact.sizeBytes,
        },
        blockers,
      ),
    ),
  );
}

function buildReport({ generatedAt, sourcePackage, archivedArtifacts, blockers }) {
  return {
    ok: blockers.length === 0,
    releaseDecision: blockers.length === 0 ? "ready" : "blocked",
    generatedAt,
    archiveDir,
    archiveManifestPath: outPath,
    sourcePackage,
    artifacts: Object.fromEntries(
      archivedArtifacts.map((artifact) => [
        artifact.key,
        {
          label: artifact.label,
          sourcePath: artifact.sourcePath,
          archivedPath: artifact.archivedPath,
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
          generatedAt: artifact.generatedAt,
          releaseDecision: artifact.releaseDecision,
        },
      ]),
    ),
    checked: [
      "P1 release package ready decision",
      "required P1 release package artifacts present",
      "source artifact SHA-256 and byte-size revalidation",
      "raw secret-like value guard",
      "immutable archive directory creation",
      "P1 release package copy to archive",
      "source artifact copy to archive",
      "archive copy SHA-256 and byte-size verification",
      "P1 release archive manifest write",
    ],
    blockers,
  };
}

async function main() {
  const blockers = [];
  const generatedAt = new Date().toISOString();

  validateArchivePath(blockers);

  const packageRead = await readJsonFile(
    packagePath,
    blockers,
    "P1_RELEASE_ARCHIVE_PACKAGE_UNREADABLE",
    "P1 release package manifest must be readable JSON before archiving.",
  );
  const sourcePackage = {
    path: packagePath,
    archivedPath: path.join(archiveDir, "p1-release-package.json"),
    sha256: packageRead.buffer ? sha256(packageRead.buffer) : null,
    sizeBytes: packageRead.buffer?.byteLength ?? 0,
    generatedAt: packageRead.json?.generatedAt ?? null,
    releaseDecision: packageRead.json?.releaseDecision ?? null,
  };

  if (packageRead.buffer && hasSecretLikeSource(packageRead.buffer.toString("utf8"))) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_PACKAGE_SECRET_LIKE_VALUE", "P1 release package manifest must not include raw secret-like values.", {
      path: packagePath,
    });
  }

  const releasePackage = packageRead.json;
  if (releasePackage && (releasePackage.ok !== true || releasePackage.releaseDecision !== "ready" || releasePackage.blockers?.length > 0)) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_PACKAGE_NOT_READY", "P1 release package must be ready before archiving.", {
      ok: releasePackage.ok ?? null,
      releaseDecision: releasePackage.releaseDecision ?? null,
      blockers: releasePackage.blockers ?? null,
    });
  }

  const expectedArtifactCount = requiredArtifactKeys.length;
  if (
    releasePackage &&
    (Number(releasePackage.summary?.totalArtifacts) !== expectedArtifactCount ||
      Number(releasePackage.summary?.readyArtifacts) !== expectedArtifactCount)
  ) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_PACKAGE_SUMMARY_INCOMPLETE", "P1 release package must include nine ready artifacts.", {
      summary: releasePackage.summary ?? null,
    });
  }

  const packageArtifacts = releasePackage?.artifacts && typeof releasePackage.artifacts === "object" ? releasePackage.artifacts : {};
  for (const key of requiredArtifactKeys) {
    if (!packageArtifacts[key]) {
      addIssue(blockers, "P1_RELEASE_ARCHIVE_ARTIFACT_MISSING", "P1 release package is missing a required artifact entry.", { key });
    }
  }

  let sourceArtifacts = [];
  if (releasePackage) {
    sourceArtifacts = (
      await Promise.all(requiredArtifactKeys.map((key) => validatePackageArtifact(key, packageArtifacts[key], blockers)))
    ).filter(Boolean);
  }

  if (await archiveDirExists()) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_DIR_EXISTS", "P1 release archive directory must not already exist; use a fresh immutable archive directory.", {
      archiveDir,
    });
  }

  if (blockers.length > 0) {
    const report = buildReport({ generatedAt, sourcePackage, archivedArtifacts: [], blockers });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  const archivedArtifacts = [];

  try {
    await mkdir(path.dirname(archiveDir), { recursive: true });
    await mkdir(archiveDir, { recursive: false });
    await mkdir(artifactsDir, { recursive: false });
    await copyFile(packagePath, sourcePackage.archivedPath);

    for (const [index, artifact] of sourceArtifacts.entries()) {
      const archivedPath = path.join(artifactsDir, archiveFileName(index, artifact.key, artifact.sourcePath));
      await writeFile(archivedPath, artifact.buffer);
      archivedArtifacts.push({ ...artifact, archivedPath });
    }
  } catch (error) {
    addIssue(blockers, "P1_RELEASE_ARCHIVE_WRITE_FAILED", "P1 release package artifacts could not be copied to the archive directory.", {
      archiveDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (blockers.length === 0) {
    await validateArchivedCopies(sourcePackage, archivedArtifacts, blockers);
  }

  const report = buildReport({ generatedAt, sourcePackage, archivedArtifacts, blockers });

  if (blockers.length === 0) {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify(report, null, 2));

  if (blockers.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
