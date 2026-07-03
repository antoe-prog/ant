import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const receiptPath = path.resolve(args.file ?? ".data/p1-release-storage-receipt.json");
const explicitArchiveManifestPath = args.archive ? path.resolve(args.archive) : null;
const placeholderPattern = /\b(todo|tbd|placeholder|sample|example|dummy)\b|yyyy|mmdd|미정|확인 필요/i;
const storageLocationPattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;

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

function parseDateTime(value) {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIsoDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text(value))) {
    return null;
  }

  return parseDateTime(value);
}

function parseIsoDateOrDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text(value))) {
    return null;
  }

  return parseDateTime(value);
}

function hasPlaceholder(value) {
  return placeholderPattern.test(text(value));
}

function secretHits(value) {
  const source = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const hits = [];

  if (/-----BEGIN[\s\S]*?(PRIVATE KEY|END [^-]+KEY)-----/.test(source)) {
    hits.push("private-key");
  }

  if (/\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source)) {
    hits.push("provider-secret");
  }

  if (/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(source)) {
    hits.push("token");
  }

  if (/FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)) {
    hits.push("default-password");
  }

  return hits;
}

function validateFilledString(blockers, code, message, value, detail = {}) {
  if (!text(value) || hasPlaceholder(value)) {
    addIssue(blockers, code, message, { value: value ?? null, ...detail });
  }
}

function validateStorageLocation(blockers, value, detail) {
  const location = text(value);
  if (!location || hasPlaceholder(location) || !storageLocationPattern.test(location)) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_LOCATION_INVALID", "storage locations must be HTTPS URLs or provider URIs, not placeholders.", {
      location: value ?? null,
      ...detail,
    });
  }
}

function validateEvidenceLocation(blockers, code, message, value, detail = {}) {
  const location = text(value);
  if (!location || hasPlaceholder(location) || !storageLocationPattern.test(location)) {
    addIssue(blockers, code, message, {
      location: value ?? null,
      ...detail,
    });
  }
}

async function readJson(filePath, blockers, code, message) {
  try {
    const buffer = await readFile(filePath);
    const source = buffer.toString("utf8");
    return { parsed: JSON.parse(source), buffer, source };
  } catch (error) {
    addIssue(blockers, code, message, {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { parsed: null, buffer: null, source: "" };
  }
}

function expectedArchiveEntries(archiveManifest) {
  const entries = [
    [
      "p1ReleasePackage",
      {
        label: "P1 release package",
        archivedPath: archiveManifest.sourcePackage?.archivedPath,
        sha256: archiveManifest.sourcePackage?.sha256,
        sizeBytes: archiveManifest.sourcePackage?.sizeBytes,
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

async function validateArchivedPath(key, archivedPath, expectedSha, expectedSize, blockers) {
  try {
    const buffer = await readFile(archivedPath);
    const actualSha = sha256(buffer);
    const actualSize = buffer.byteLength;

    if (actualSha !== expectedSha) {
      addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARCHIVE_HASH_MISMATCH", "local archived artifact SHA-256 must match the archive manifest.", {
        key,
        archivedPath,
        expectedSha,
        actualSha,
      });
    }

    if (actualSize !== expectedSize) {
      addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARCHIVE_SIZE_MISMATCH", "local archived artifact byte size must match the archive manifest.", {
        key,
        archivedPath,
        expectedSize,
        actualSize,
      });
    }
  } catch (error) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARCHIVE_UNREADABLE", "local archived artifact must be readable when validating storage receipt.", {
      key,
      archivedPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateReceiptShape(receipt, blockers) {
  if (!receipt) {
    return;
  }

  if (receipt.version !== 1) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_VERSION_INVALID", "P1 release storage receipt version must be 1.", {
      version: receipt.version ?? null,
    });
  }

  validateFilledString(blockers, "P1_RELEASE_STORAGE_RECEIPT_UPLOADED_BY_MISSING", "storage receipt must include uploadedBy.", receipt.uploadedBy);
  validateFilledString(blockers, "P1_RELEASE_STORAGE_RECEIPT_PROVIDER_MISSING", "storage receipt must include storageProvider.", receipt.storageProvider);
  validateStorageLocation(blockers, receipt.storageLocation, { field: "storageLocation" });
  validateFilledString(blockers, "P1_RELEASE_STORAGE_RECEIPT_EVIDENCE_MISSING", "storage receipt must include upload evidence.", receipt.evidence);
  validateEvidenceLocation(
    blockers,
    "P1_RELEASE_STORAGE_RECEIPT_EVIDENCE_INVALID",
    "storage receipt upload evidence must be an HTTPS URL or provider URI.",
    receipt.evidence,
    { field: "evidence" },
  );

  const uploadedAt = parseIsoDateTime(receipt.uploadedAt);
  if (!uploadedAt) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_UPLOADED_AT_INVALID", "storage receipt must include a valid ISO uploadedAt date-time.", {
      uploadedAt: receipt.uploadedAt ?? null,
    });
  }

  const retention = receipt.retentionPolicy ?? {};
  if (Number(retention.minimumRetentionDays) < 365) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_RETENTION_TOO_SHORT", "storage receipt retention must be at least 365 days.", {
      minimumRetentionDays: retention.minimumRetentionDays ?? null,
    });
  }

  validateFilledString(blockers, "P1_RELEASE_STORAGE_RECEIPT_RETENTION_OWNER_MISSING", "storage receipt must include retention policy owner.", retention.owner);
  validateFilledString(blockers, "P1_RELEASE_STORAGE_RECEIPT_RETENTION_EVIDENCE_MISSING", "storage receipt must include retention policy evidence.", retention.evidence);
  validateEvidenceLocation(
    blockers,
    "P1_RELEASE_STORAGE_RECEIPT_RETENTION_EVIDENCE_INVALID",
    "storage receipt retention evidence must be an HTTPS URL or provider URI.",
    retention.evidence,
    { field: "retentionPolicy.evidence" },
  );

  const accessReviewDueOn = parseIsoDateOrDateTime(retention.accessReviewDueOn);
  if (!accessReviewDueOn) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ACCESS_REVIEW_INVALID", "storage receipt must include a valid ISO accessReviewDueOn date.", {
      accessReviewDueOn: retention.accessReviewDueOn ?? null,
    });
  } else if (uploadedAt && accessReviewDueOn <= uploadedAt) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ACCESS_REVIEW_TOO_EARLY", "accessReviewDueOn must be after uploadedAt.", {
      uploadedAt: receipt.uploadedAt,
      accessReviewDueOn: retention.accessReviewDueOn,
    });
  }
}

async function main() {
  const blockers = [];
  const receiptRead = await readJson(
    receiptPath,
    blockers,
    "P1_RELEASE_STORAGE_RECEIPT_UNREADABLE",
    "P1 release storage receipt must be readable JSON.",
  );
  const receipt = receiptRead.parsed;

  for (const hit of secretHits(receiptRead.source)) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_SECRET_VALUE", "P1 release storage receipt must not contain raw secret-like values.", { type: hit });
  }

  validateReceiptShape(receipt, blockers);

  const receiptArchiveManifestPath = text(receipt?.archiveManifest);
  if (!explicitArchiveManifestPath && !receiptArchiveManifestPath) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARCHIVE_PATH_MISSING", "storage receipt must include archiveManifest path or --archive must be provided.");
  }

  const archiveManifestPath = explicitArchiveManifestPath ?? (receiptArchiveManifestPath ? path.resolve(receiptArchiveManifestPath) : null);
  if (explicitArchiveManifestPath && receiptArchiveManifestPath && explicitArchiveManifestPath !== path.resolve(receiptArchiveManifestPath)) {
    addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARCHIVE_PATH_MISMATCH", "--archive must match receipt.archiveManifest when both are provided.", {
      explicitArchiveManifestPath,
      receiptArchiveManifestPath: path.resolve(receiptArchiveManifestPath),
    });
  }

  const archiveRead = archiveManifestPath
    ? await readJson(
        archiveManifestPath,
        blockers,
        "P1_RELEASE_STORAGE_ARCHIVE_MANIFEST_UNREADABLE",
        "P1 release archive manifest must be readable JSON.",
      )
    : { parsed: null, buffer: null, source: "" };
  const archiveManifest = archiveRead.parsed;
  const archiveManifestActualSha = archiveRead.buffer ? sha256(archiveRead.buffer) : null;
  const archiveManifestActualSize = archiveRead.buffer?.byteLength ?? 0;

  for (const hit of secretHits(archiveRead.source)) {
    addIssue(blockers, "P1_RELEASE_STORAGE_ARCHIVE_MANIFEST_SECRET_VALUE", "P1 release archive manifest must not contain raw secret-like values.", { type: hit });
  }

  if (archiveManifest) {
    if (archiveManifest.ok !== true || archiveManifest.releaseDecision !== "ready" || archiveManifest.blockers?.length > 0) {
      addIssue(blockers, "P1_RELEASE_STORAGE_ARCHIVE_MANIFEST_NOT_READY", "P1 release archive manifest must be ready before storage receipt validation.", {
        ok: archiveManifest.ok ?? null,
        releaseDecision: archiveManifest.releaseDecision ?? null,
        blockers: archiveManifest.blockers ?? null,
      });
    }

    if (receipt) {
      if (text(receipt.archiveManifestSha256) !== archiveManifestActualSha) {
        addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARCHIVE_MANIFEST_HASH_MISMATCH", "receipt archiveManifestSha256 must match the archive manifest file.", {
          expectedSha: archiveManifestActualSha,
          receiptSha: receipt.archiveManifestSha256 ?? null,
        });
      }

      if (Number(receipt.archiveManifestSizeBytes) !== archiveManifestActualSize) {
        addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARCHIVE_MANIFEST_SIZE_MISMATCH", "receipt archiveManifestSizeBytes must match the archive manifest file.", {
          expectedSize: archiveManifestActualSize,
          receiptSize: receipt.archiveManifestSizeBytes ?? null,
        });
      }

      const uploadedAt = parseIsoDateTime(receipt.uploadedAt);
      const archiveGeneratedAt = parseIsoDateTime(archiveManifest.generatedAt);
      if (uploadedAt && archiveGeneratedAt && uploadedAt < archiveGeneratedAt) {
        addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_UPLOADED_BEFORE_ARCHIVE", "uploadedAt must be after the P1 release archive manifest was generated.", {
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
        addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARTIFACT_MISSING", "storage receipt must list every archived P1 release artifact.", { key });
        continue;
      }

      const archivedPath = path.resolve(text(entry.archivedPath));
      const expectedArchivedPath = path.resolve(text(expected.archivedPath));
      if (archivedPath !== expectedArchivedPath) {
        addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARTIFACT_PATH_MISMATCH", "receipt artifact archivedPath must match archive manifest.", {
          key,
          archivedPath,
          expectedArchivedPath,
        });
      }

      if (text(entry.sha256) !== text(expected.sha256)) {
        addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARTIFACT_HASH_MISMATCH", "receipt artifact SHA-256 must match archive manifest.", {
          key,
          receiptSha: entry.sha256 ?? null,
          expectedSha: expected.sha256 ?? null,
        });
      }

      if (Number(entry.sizeBytes) !== Number(expected.sizeBytes)) {
        addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARTIFACT_SIZE_MISMATCH", "receipt artifact byte size must match archive manifest.", {
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
        addIssue(blockers, "P1_RELEASE_STORAGE_RECEIPT_ARTIFACT_UNKNOWN", "storage receipt contains an artifact not present in the P1 release archive manifest.", { key });
      }
    }
  }

  const result = {
    ok: blockers.length === 0,
    releaseDecision: blockers.length === 0 ? "ready" : "blocked",
    generatedAt: new Date().toISOString(),
    receipt: {
      path: receiptPath,
      archiveManifest: archiveManifestPath,
      archiveManifestSha256: archiveManifestActualSha,
      archiveManifestSizeBytes: archiveManifestActualSize,
    },
    checked: [
      "P1 release storage receipt shape and placeholders",
      "P1 release archive manifest ready decision",
      "P1 release archive manifest SHA-256 and byte-size receipt match",
      "uploaded P1 release artifact coverage against archive manifest",
      "uploaded P1 release artifact storage locations",
      "local archived P1 release artifact SHA-256 and byte-size revalidation",
      "P1 release storage retention policy",
      "raw secret-like value guard",
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
