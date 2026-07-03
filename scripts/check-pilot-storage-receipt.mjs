import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const receiptPath = path.resolve(args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length) ?? ".data/pilot-storage-receipt.json");
const explicitArchiveManifestPath = args.find((arg) => arg.startsWith("--archive="))?.slice("--archive=".length);
const placeholderPattern = /\b(todo|tbd|placeholder)\b|yyyy|mmdd|미정|확인 필요/i;
const storageLocationPattern = /^(https?:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;

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

function hasPlaceholder(value) {
  return placeholderPattern.test(text(value));
}

function validateFilledString(blockers, code, message, value, detail = {}) {
  if (!text(value) || hasPlaceholder(value)) {
    addIssue(blockers, code, message, { value: value ?? null, ...detail });
  }
}

async function readJson(filePath, blockers, code, message) {
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

async function validateArchivedPath(key, archivedPath, expectedSha, expectedSize, blockers) {
  try {
    const buffer = await readFile(archivedPath);
    const actualSha = sha256(buffer);
    const actualSize = buffer.byteLength;

    if (actualSha !== expectedSha) {
      addIssue(blockers, "STORAGE_RECEIPT_ARCHIVE_HASH_MISMATCH", "local archived artifact SHA-256 must match the archive manifest.", {
        key,
        archivedPath,
        expectedSha,
        actualSha,
      });
    }

    if (actualSize !== expectedSize) {
      addIssue(blockers, "STORAGE_RECEIPT_ARCHIVE_SIZE_MISMATCH", "local archived artifact byte size must match the archive manifest.", {
        key,
        archivedPath,
        expectedSize,
        actualSize,
      });
    }
  } catch (error) {
    addIssue(blockers, "STORAGE_RECEIPT_ARCHIVE_UNREADABLE", "local archived artifact must be readable when validating storage receipt.", {
      key,
      archivedPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function expectedArchiveEntries(archiveManifest) {
  const entries = [
    [
      "pilotArtifactManifest",
      {
        label: "pilot artifact manifest",
        archivedPath: archiveManifest.sourceManifest?.archivedPath,
        sha256: archiveManifest.sourceManifest?.sha256,
        sizeBytes: archiveManifest.sourceManifest?.sizeBytes,
      },
    ],
  ];

  for (const [key, artifact] of Object.entries(archiveManifest.artifacts ?? {})) {
    entries.push([
      key,
      {
        label: artifact.label,
        archivedPath: artifact.archivedPath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      },
    ]);
  }

  return new Map(entries);
}

function validateStorageLocation(blockers, value, detail) {
  const location = text(value);
  if (!location || hasPlaceholder(location) || !storageLocationPattern.test(location)) {
    addIssue(blockers, "STORAGE_RECEIPT_LOCATION_INVALID", "storage locations must be final URLs or provider URIs, not placeholders.", {
      location: value ?? null,
      ...detail,
    });
  }
}

async function main() {
  const blockers = [];
  const { parsed: receipt } = await readJson(receiptPath, blockers, "STORAGE_RECEIPT_UNREADABLE", "pilot storage receipt must be readable JSON.");

  const archiveManifestPath = path.resolve(explicitArchiveManifestPath ?? text(receipt?.archiveManifest));
  if (!explicitArchiveManifestPath && !text(receipt?.archiveManifest)) {
    addIssue(blockers, "STORAGE_RECEIPT_ARCHIVE_PATH_MISSING", "storage receipt must include archiveManifest path or --archive must be provided.");
  }

  if (explicitArchiveManifestPath && receipt?.archiveManifest && archiveManifestPath !== path.resolve(text(receipt.archiveManifest))) {
    addIssue(blockers, "STORAGE_RECEIPT_ARCHIVE_PATH_MISMATCH", "--archive must match receipt.archiveManifest when both are provided.", {
      explicitArchiveManifestPath: archiveManifestPath,
      receiptArchiveManifestPath: path.resolve(text(receipt.archiveManifest)),
    });
  }

  const { parsed: archiveManifest, buffer: archiveManifestBuffer } =
    archiveManifestPath && archiveManifestPath !== process.cwd()
      ? await readJson(archiveManifestPath, blockers, "ARCHIVE_MANIFEST_UNREADABLE", "pilot archive manifest must be readable JSON.")
      : { parsed: null, buffer: null };

  if (receipt) {
    if (receipt.version !== 1) {
      addIssue(blockers, "STORAGE_RECEIPT_VERSION_INVALID", "storage receipt version must be 1.", {
        version: receipt.version ?? null,
      });
    }

    validateFilledString(blockers, "STORAGE_RECEIPT_UPLOADED_BY_MISSING", "storage receipt must include uploadedBy.", receipt.uploadedBy);
    validateFilledString(blockers, "STORAGE_RECEIPT_PROVIDER_MISSING", "storage receipt must include storageProvider.", receipt.storageProvider);
    validateStorageLocation(blockers, receipt.storageLocation, { field: "storageLocation" });
    validateFilledString(blockers, "STORAGE_RECEIPT_EVIDENCE_MISSING", "storage receipt must include upload evidence.", receipt.evidence);

    const uploadedAt = parseDateTime(receipt.uploadedAt);
    if (!uploadedAt) {
      addIssue(blockers, "STORAGE_RECEIPT_UPLOADED_AT_INVALID", "storage receipt must include a valid uploadedAt timestamp.", {
        uploadedAt: receipt.uploadedAt ?? null,
      });
    }

    const retention = receipt.retentionPolicy ?? {};
    if (Number(retention.minimumRetentionDays) < 365) {
      addIssue(blockers, "STORAGE_RECEIPT_RETENTION_TOO_SHORT", "storage receipt retention must be at least 365 days.", {
        minimumRetentionDays: retention.minimumRetentionDays ?? null,
      });
    }
    validateFilledString(blockers, "STORAGE_RECEIPT_RETENTION_OWNER_MISSING", "storage receipt must include retention policy owner.", retention.owner);
    validateFilledString(blockers, "STORAGE_RECEIPT_RETENTION_EVIDENCE_MISSING", "storage receipt must include retention policy evidence.", retention.evidence);

    const accessReviewDueOn = parseDateTime(retention.accessReviewDueOn);
    if (!accessReviewDueOn) {
      addIssue(blockers, "STORAGE_RECEIPT_ACCESS_REVIEW_INVALID", "storage receipt must include a valid accessReviewDueOn date.", {
        accessReviewDueOn: retention.accessReviewDueOn ?? null,
      });
    } else if (uploadedAt && accessReviewDueOn <= uploadedAt) {
      addIssue(blockers, "STORAGE_RECEIPT_ACCESS_REVIEW_TOO_EARLY", "accessReviewDueOn must be after uploadedAt.", {
        uploadedAt: receipt.uploadedAt,
        accessReviewDueOn: retention.accessReviewDueOn,
      });
    }
  }

  const archiveManifestActualSha = archiveManifestBuffer ? sha256(archiveManifestBuffer) : null;
  const archiveManifestActualSize = archiveManifestBuffer?.byteLength ?? 0;

  if (archiveManifest) {
    if (archiveManifest.ok !== true || archiveManifest.releaseDecision !== "ready" || archiveManifest.blockers?.length > 0) {
      addIssue(blockers, "ARCHIVE_MANIFEST_NOT_READY", "pilot archive manifest must be ready before storage receipt validation.", {
        ok: archiveManifest.ok ?? null,
        releaseDecision: archiveManifest.releaseDecision ?? null,
        blockers: archiveManifest.blockers ?? null,
      });
    }

    if (receipt) {
      if (text(receipt.archiveManifestSha256) !== archiveManifestActualSha) {
        addIssue(blockers, "STORAGE_RECEIPT_ARCHIVE_MANIFEST_HASH_MISMATCH", "receipt archiveManifestSha256 must match the archive manifest file.", {
          expectedSha: archiveManifestActualSha,
          receiptSha: receipt.archiveManifestSha256 ?? null,
        });
      }

      if (Number(receipt.archiveManifestSizeBytes) !== archiveManifestActualSize) {
        addIssue(blockers, "STORAGE_RECEIPT_ARCHIVE_MANIFEST_SIZE_MISMATCH", "receipt archiveManifestSizeBytes must match the archive manifest file.", {
          expectedSize: archiveManifestActualSize,
          receiptSize: receipt.archiveManifestSizeBytes ?? null,
        });
      }

      const uploadedAt = parseDateTime(receipt.uploadedAt);
      const archiveGeneratedAt = parseDateTime(archiveManifest.generatedAt);
      if (uploadedAt && archiveGeneratedAt && uploadedAt < archiveGeneratedAt) {
        addIssue(blockers, "STORAGE_RECEIPT_UPLOADED_BEFORE_ARCHIVE", "uploadedAt must be after the archive manifest was generated.", {
          uploadedAt: receipt.uploadedAt,
          archiveGeneratedAt: archiveManifest.generatedAt,
        });
      }
    }

    const expectedEntries = expectedArchiveEntries(archiveManifest);
    const receiptEntries = new Map((Array.isArray(receipt?.uploadedArtifacts) ? receipt.uploadedArtifacts : []).map((entry) => [entry.key, entry]));

    for (const [key, expected] of expectedEntries) {
      const entry = receiptEntries.get(key);
      if (!entry) {
        addIssue(blockers, "STORAGE_RECEIPT_ARTIFACT_MISSING", "storage receipt must list every archived artifact.", { key });
        continue;
      }

      const archivedPath = path.resolve(text(entry.archivedPath));
      const expectedArchivedPath = path.resolve(text(expected.archivedPath));
      if (archivedPath !== expectedArchivedPath) {
        addIssue(blockers, "STORAGE_RECEIPT_ARTIFACT_PATH_MISMATCH", "receipt artifact archivedPath must match archive manifest.", {
          key,
          archivedPath,
          expectedArchivedPath,
        });
      }

      if (text(entry.sha256) !== text(expected.sha256)) {
        addIssue(blockers, "STORAGE_RECEIPT_ARTIFACT_HASH_MISMATCH", "receipt artifact SHA-256 must match archive manifest.", {
          key,
          receiptSha: entry.sha256 ?? null,
          expectedSha: expected.sha256 ?? null,
        });
      }

      if (Number(entry.sizeBytes) !== Number(expected.sizeBytes)) {
        addIssue(blockers, "STORAGE_RECEIPT_ARTIFACT_SIZE_MISMATCH", "receipt artifact byte size must match archive manifest.", {
          key,
          receiptSize: entry.sizeBytes ?? null,
          expectedSize: expected.sizeBytes ?? null,
        });
      }

      validateStorageLocation(blockers, entry.storageLocation, { field: "uploadedArtifacts.storageLocation", key });
      await validateArchivedPath(key, expectedArchivedPath, text(expected.sha256), Number(expected.sizeBytes), blockers);
    }

    for (const key of receiptEntries.keys()) {
      if (!expectedEntries.has(key)) {
        addIssue(blockers, "STORAGE_RECEIPT_ARTIFACT_UNKNOWN", "storage receipt contains an artifact not present in archive manifest.", { key });
      }
    }
  }

  const result = {
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    releaseDecision: blockers.length === 0 ? "ready" : "blocked",
    receipt: {
      path: receiptPath,
      archiveManifest: archiveManifestPath,
      archiveManifestSha256: archiveManifestActualSha,
      archiveManifestSizeBytes: archiveManifestActualSize,
    },
    checked: [
      "storage receipt shape and placeholders",
      "archive manifest ready decision",
      "archive manifest SHA-256 and byte-size receipt match",
      "uploaded artifact coverage against archive manifest",
      "uploaded artifact storage locations",
      "local archived artifact SHA-256 and byte-size revalidation",
      "storage retention policy",
    ],
    blockers,
  };

  console.log(JSON.stringify(result, null, 2));

  if (blockers.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
