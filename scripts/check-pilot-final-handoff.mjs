import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);
const artifactManifestPath = path.resolve(
  args.find((arg) => arg.startsWith("--artifact-manifest="))?.slice("--artifact-manifest=".length) ??
    ".data/pilot-artifact-manifest.json",
);
const archiveManifestPath = path.resolve(
  args.find((arg) => arg.startsWith("--archive-manifest="))?.slice("--archive-manifest=".length) ??
    ".data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json",
);
const storageReceiptPath = path.resolve(
  args.find((arg) => arg.startsWith("--storage-receipt="))?.slice("--storage-receipt=".length) ??
    ".data/pilot-storage-receipt.json",
);
const outFile = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
const outPath = outFile ? path.resolve(outFile) : null;

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

function parseDateTime(value) {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function readJsonWithBuffer(filePath, blockers, code, message) {
  try {
    const buffer = await readFile(filePath);
    return { parsed: JSON.parse(buffer.toString("utf8")), buffer };
  } catch (error) {
    addIssue(blockers, code, message, {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { parsed: null, buffer: null };
  }
}

async function verifyFileDigest({ key, filePath, expectedSha, expectedSize, blockers, codePrefix }) {
  try {
    const buffer = await readFile(filePath);
    const actualSha = sha256(buffer);
    const actualSize = buffer.byteLength;

    if (actualSha !== expectedSha) {
      addIssue(blockers, `${codePrefix}_HASH_MISMATCH`, "file SHA-256 does not match the final handoff manifest.", {
        key,
        path: filePath,
        expectedSha,
        actualSha,
      });
    }

    if (actualSize !== expectedSize) {
      addIssue(blockers, `${codePrefix}_SIZE_MISMATCH`, "file byte size does not match the final handoff manifest.", {
        key,
        path: filePath,
        expectedSize,
        actualSize,
      });
    }
  } catch (error) {
    addIssue(blockers, `${codePrefix}_UNREADABLE`, "file listed in the final handoff manifest must be readable.", {
      key,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateReadyDocument(document, label, blockers, codePrefix) {
  if (!document) {
    return;
  }

  if (document.ok !== true || document.releaseDecision !== "ready" || document.blockers?.length > 0) {
    addIssue(blockers, `${codePrefix}_NOT_READY`, `${label} must be ready with no blockers.`, {
      ok: document.ok ?? null,
      releaseDecision: document.releaseDecision ?? null,
      blockers: document.blockers ?? null,
    });
  }

  if (!parseDateTime(document.generatedAt)) {
    addIssue(blockers, `${codePrefix}_GENERATED_AT_INVALID`, `${label} must include a valid generatedAt timestamp.`, {
      generatedAt: document.generatedAt ?? null,
    });
  }
}

function validateArtifactKeys(artifactManifest, archiveManifest, blockers) {
  const artifactKeys = Object.keys(artifactManifest?.artifacts ?? {});
  const archiveKeys = Object.keys(archiveManifest?.artifacts ?? {});

  for (const key of requiredArtifactKeys) {
    if (!artifactKeys.includes(key)) {
      addIssue(blockers, "FINAL_HANDOFF_ARTIFACT_MANIFEST_ENTRY_MISSING", "pilot artifact manifest is missing a required artifact.", {
        key,
      });
    }

    if (!archiveKeys.includes(key)) {
      addIssue(blockers, "FINAL_HANDOFF_ARCHIVE_MANIFEST_ENTRY_MISSING", "pilot archive manifest is missing a required artifact.", {
        key,
      });
    }
  }

  for (const key of artifactKeys) {
    if (!archiveKeys.includes(key)) {
      addIssue(blockers, "FINAL_HANDOFF_ARCHIVE_MANIFEST_ENTRY_MISSING", "pilot archive manifest must include every artifact manifest entry.", {
        key,
      });
    }
  }

  for (const key of archiveKeys) {
    if (!artifactKeys.includes(key)) {
      addIssue(blockers, "FINAL_HANDOFF_ARCHIVE_MANIFEST_ENTRY_UNKNOWN", "pilot archive manifest includes an artifact not listed in the artifact manifest.", {
        key,
      });
    }
  }
}

async function validateArchiveAgainstArtifactManifest(artifactManifest, archiveManifest, artifactManifestBuffer, blockers) {
  if (!artifactManifest || !archiveManifest || !artifactManifestBuffer) {
    return;
  }

  validateArtifactKeys(artifactManifest, archiveManifest, blockers);

  const artifactManifestSha = sha256(artifactManifestBuffer);
  const artifactManifestSize = artifactManifestBuffer.byteLength;
  const sourceManifest = archiveManifest.sourceManifest ?? {};

  if (text(sourceManifest.sha256) !== artifactManifestSha) {
    addIssue(blockers, "FINAL_HANDOFF_SOURCE_MANIFEST_HASH_MISMATCH", "archive sourceManifest hash must match the artifact manifest file.", {
      expectedSha: artifactManifestSha,
      archiveSha: sourceManifest.sha256 ?? null,
    });
  }

  if (Number(sourceManifest.sizeBytes) !== artifactManifestSize) {
    addIssue(blockers, "FINAL_HANDOFF_SOURCE_MANIFEST_SIZE_MISMATCH", "archive sourceManifest size must match the artifact manifest file.", {
      expectedSize: artifactManifestSize,
      archiveSize: sourceManifest.sizeBytes ?? null,
    });
  }

  await verifyFileDigest({
    key: "pilotArtifactManifest",
    filePath: path.resolve(text(sourceManifest.archivedPath)),
    expectedSha: artifactManifestSha,
    expectedSize: artifactManifestSize,
    blockers,
    codePrefix: "FINAL_HANDOFF_ARCHIVED_SOURCE_MANIFEST",
  });

  for (const key of requiredArtifactKeys) {
    const source = artifactManifest.artifacts?.[key];
    const archived = archiveManifest.artifacts?.[key];
    if (!source || !archived) {
      continue;
    }

    const sourcePath = path.resolve(text(source.path));
    const archiveSourcePath = path.resolve(text(archived.sourcePath));
    if (sourcePath !== archiveSourcePath) {
      addIssue(blockers, "FINAL_HANDOFF_ARTIFACT_SOURCE_PATH_MISMATCH", "archive artifact sourcePath must match the artifact manifest.", {
        key,
        sourcePath,
        archiveSourcePath,
      });
    }

    if (text(source.sha256) !== text(archived.sha256)) {
      addIssue(blockers, "FINAL_HANDOFF_ARTIFACT_HASH_MISMATCH", "archive artifact hash must match the artifact manifest.", {
        key,
        artifactSha: source.sha256 ?? null,
        archiveSha: archived.sha256 ?? null,
      });
    }

    if (Number(source.sizeBytes) !== Number(archived.sizeBytes)) {
      addIssue(blockers, "FINAL_HANDOFF_ARTIFACT_SIZE_MISMATCH", "archive artifact byte size must match the artifact manifest.", {
        key,
        artifactSize: source.sizeBytes ?? null,
        archiveSize: archived.sizeBytes ?? null,
      });
    }

    await verifyFileDigest({
      key,
      filePath: path.resolve(text(archived.archivedPath)),
      expectedSha: text(source.sha256),
      expectedSize: Number(source.sizeBytes),
      blockers,
      codePrefix: "FINAL_HANDOFF_ARCHIVED_ARTIFACT",
    });
  }
}

async function validateStorageReceipt(blockers) {
  try {
    const result = await execFile(
      process.execPath,
      [
        "scripts/check-pilot-storage-receipt.mjs",
        `--file=${storageReceiptPath}`,
        `--archive=${archiveManifestPath}`,
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024,
      },
    );
    const parsed = JSON.parse(result.stdout);
    if (parsed.ok !== true || parsed.releaseDecision !== "ready" || parsed.blockers?.length > 0) {
      addIssue(blockers, "FINAL_HANDOFF_STORAGE_RECEIPT_NOT_READY", "storage receipt validation must be ready.", parsed);
    }
    return parsed;
  } catch (error) {
    let parsed = null;
    try {
      parsed = JSON.parse(error.stdout ?? "{}");
    } catch {
      parsed = null;
    }

    addIssue(blockers, "FINAL_HANDOFF_STORAGE_RECEIPT_VALIDATION_FAILED", "storage receipt validator must pass for the final handoff.", {
      exitCode: error.code ?? null,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      parsed,
    });
    return parsed;
  }
}

function validateChronology(artifactManifest, archiveManifest, receipt, blockers) {
  const artifactGeneratedAt = parseDateTime(artifactManifest?.generatedAt);
  const archiveGeneratedAt = parseDateTime(archiveManifest?.generatedAt);
  const uploadedAt = parseDateTime(receipt?.uploadedAt);

  if (artifactGeneratedAt && archiveGeneratedAt && archiveGeneratedAt < artifactGeneratedAt) {
    addIssue(blockers, "FINAL_HANDOFF_ARCHIVE_BEFORE_ARTIFACT_MANIFEST", "archive manifest must be generated after the artifact manifest.", {
      artifactGeneratedAt: artifactManifest.generatedAt,
      archiveGeneratedAt: archiveManifest.generatedAt,
    });
  }

  if (archiveGeneratedAt && uploadedAt && uploadedAt < archiveGeneratedAt) {
    addIssue(blockers, "FINAL_HANDOFF_UPLOAD_BEFORE_ARCHIVE", "storage receipt uploadedAt must be after the archive manifest.", {
      archiveGeneratedAt: archiveManifest.generatedAt,
      uploadedAt: receipt.uploadedAt,
    });
  }
}

async function main() {
  const blockers = [];
  const { parsed: artifactManifest, buffer: artifactManifestBuffer } = await readJsonWithBuffer(
    artifactManifestPath,
    blockers,
    "FINAL_HANDOFF_ARTIFACT_MANIFEST_UNREADABLE",
    "pilot artifact manifest must be readable JSON.",
  );
  const { parsed: archiveManifest, buffer: archiveManifestBuffer } = await readJsonWithBuffer(
    archiveManifestPath,
    blockers,
    "FINAL_HANDOFF_ARCHIVE_MANIFEST_UNREADABLE",
    "pilot archive manifest must be readable JSON.",
  );
  const { parsed: storageReceipt } = await readJsonWithBuffer(
    storageReceiptPath,
    blockers,
    "FINAL_HANDOFF_STORAGE_RECEIPT_UNREADABLE",
    "pilot storage receipt must be readable JSON.",
  );

  validateReadyDocument(artifactManifest, "pilot artifact manifest", blockers, "FINAL_HANDOFF_ARTIFACT_MANIFEST");
  validateReadyDocument(archiveManifest, "pilot archive manifest", blockers, "FINAL_HANDOFF_ARCHIVE_MANIFEST");
  await validateArchiveAgainstArtifactManifest(artifactManifest, archiveManifest, artifactManifestBuffer, blockers);
  const storageReceiptValidation = await validateStorageReceipt(blockers);
  validateChronology(artifactManifest, archiveManifest, storageReceipt, blockers);

  const archiveManifestSha = archiveManifestBuffer ? sha256(archiveManifestBuffer) : null;
  const result = {
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    releaseDecision: blockers.length === 0 ? "ready" : "blocked",
    artifacts: {
      artifactManifest: {
        path: artifactManifestPath,
        sha256: artifactManifestBuffer ? sha256(artifactManifestBuffer) : null,
        sizeBytes: artifactManifestBuffer?.byteLength ?? 0,
      },
      archiveManifest: {
        path: archiveManifestPath,
        sha256: archiveManifestSha,
        sizeBytes: archiveManifestBuffer?.byteLength ?? 0,
      },
      storageReceipt: {
        path: storageReceiptPath,
        archiveManifest: path.resolve(text(storageReceipt?.archiveManifest)),
      },
    },
    storageReceiptValidation,
    checked: [
      "artifact manifest ready decision",
      "archive manifest ready decision",
      "archive source manifest SHA-256 and byte-size match",
      "archive artifact coverage against artifact manifest",
      "archived artifact SHA-256 and byte-size revalidation",
      "storage receipt validator pass",
      "artifact/archive/upload chronology",
    ],
    blockers,
  };

  if (outPath) {
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
