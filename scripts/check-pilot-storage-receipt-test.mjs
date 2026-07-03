import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-storage-receipt-"));
const archiveDir = join(directory, "archive");
const artifactsDir = join(archiveDir, "artifacts");
const archiveManifestPath = join(archiveDir, "pilot-archive-manifest.json");
const sourceManifestPath = join(archiveDir, "pilot-artifact-manifest.json");
const receiptPath = join(directory, "pilot-storage-receipt.json");
const placeholderReceiptPath = join(directory, "pilot-storage-receipt.placeholder.json");
const missingArtifactReceiptPath = join(directory, "pilot-storage-receipt.missing-artifact.json");
const staleReceiptPath = join(directory, "pilot-storage-receipt.stale.json");
const tamperedReceiptPath = join(directory, "pilot-storage-receipt.tampered.json");

const artifactKeys = [
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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function writeArtifact(filePath, body) {
  const buffer = Buffer.from(body, "utf8");
  await writeFile(filePath, buffer);
  return {
    sizeBytes: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

async function runReceipt(filePath = receiptPath) {
  try {
    const result = await execFile(
      process.execPath,
      ["scripts/check-pilot-storage-receipt.mjs", `--file=${filePath}`, `--archive=${archiveManifestPath}`],
      {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

await mkdir(artifactsDir, { recursive: true });

const sourceManifestStats = await writeArtifact(
  sourceManifestPath,
  `${JSON.stringify({ ok: true, releaseDecision: "ready", generatedAt: "2026-07-15T02:00:00.000Z" }, null, 2)}\n`,
);

const archivedArtifacts = {};
for (const [index, key] of artifactKeys.entries()) {
  const extension = key === "postPilotMarkdown" || key === "prePilotMarkdown" ? ".md" : key === "prePilotReadinessEvidence" || key === "passwordRotationEvidence" ? ".csv" : ".json";
  const archivedPath = join(artifactsDir, `${String(index + 1).padStart(2, "0")}-${key}${extension}`);
  const stats = await writeArtifact(
    archivedPath,
    key === "prePilotReadinessEvidence"
      ? "id,category,label,owner,status,evidence,checkedAt,notes\npilot-branches,scope,운영 준비 지점 1-2곳과 2주 기간 확정,총괄 PM,verified,branch approval memo,2026-06-30T09:00:00.000Z,\n"
      : key === "passwordRotationEvidence"
      ? "userId,email,name,role,branchIds,usesDefaultPassword,hasPasswordHash,lastPasswordAuditAt,rotationStatus,evidence,rotatedAt,notes\nuser-admin,admin@finaljudo.test,관리자,admin,branch-gangnam|branch-songpa,false,true,2026-06-30T09:05:00.000Z,verified,audit-auth-password-reset-admin,2026-06-30T09:05:00.000Z,channel evidence\n"
      : key === "postPilotMarkdown" || key === "prePilotMarkdown"
      ? `# Final Judo Pilot Evidence Report\n\n- Artifact: ${key}\n`
      : `${JSON.stringify({ ok: true, key }, null, 2)}\n`,
  );

  archivedArtifacts[key] = {
    label: key,
    type: extension === ".json" ? "json" : "text",
    sourcePath: join(directory, "source", `${key}${extension}`),
    archivedPath,
    sizeBytes: stats.sizeBytes,
    sha256: stats.sha256,
  };
}

const archiveManifest = {
  ok: true,
  generatedAt: "2026-07-15T02:10:00.000Z",
  releaseDecision: "ready",
  sourceManifest: {
    path: join(directory, "pilot-artifact-manifest.source.json"),
    archivedPath: sourceManifestPath,
    sizeBytes: sourceManifestStats.sizeBytes,
    sha256: sourceManifestStats.sha256,
  },
  archiveDir,
  archiveManifestPath,
  artifacts: archivedArtifacts,
  checked: ["archive copy SHA-256 and byte-size verification"],
  blockers: [],
};
const archiveManifestStats = await writeArtifact(archiveManifestPath, `${JSON.stringify(archiveManifest, null, 2)}\n`);

function validReceipt(overrides = {}) {
  const uploadedArtifacts = [
    {
      key: "pilotArtifactManifest",
      archivedPath: archiveManifest.sourceManifest.archivedPath,
      sizeBytes: archiveManifest.sourceManifest.sizeBytes,
      sha256: archiveManifest.sourceManifest.sha256,
      storageLocation: "https://storage.example.com/final-judo/pilot-20260715/pilot-artifact-manifest.json",
    },
    ...Object.entries(archiveManifest.artifacts).map(([key, artifact]) => ({
      key,
      archivedPath: artifact.archivedPath,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      storageLocation: `https://storage.example.com/final-judo/pilot-20260715/${key}`,
    })),
  ];

  return {
    version: 1,
    archiveManifest: archiveManifestPath,
    archiveManifestSha256: archiveManifestStats.sha256,
    archiveManifestSizeBytes: archiveManifestStats.sizeBytes,
    uploadedAt: "2026-07-15T02:30:00.000Z",
    uploadedBy: "정유진",
    storageProvider: "Google Drive",
    storageLocation: "https://storage.example.com/final-judo/pilot-20260715/",
    evidence: "storage upload completion screenshot",
    retentionPolicy: {
      minimumRetentionDays: 365,
      owner: "총괄 PM",
      accessReviewDueOn: "2027-07-15",
      evidence: "retention policy screenshot",
    },
    uploadedArtifacts,
    ...overrides,
  };
}

await writeFile(receiptPath, `${JSON.stringify(validReceipt(), null, 2)}\n`, "utf8");

const validRun = await runReceipt();
assert.equal(validRun.code, 0, validRun.stderr);
const validResult = JSON.parse(validRun.stdout);
assert.equal(validResult.ok, true, "valid storage receipt must be ready");
assert.equal(validResult.releaseDecision, "ready", "valid storage receipt must have ready decision");
assert.equal(validResult.receipt.archiveManifestSha256, archiveManifestStats.sha256, "storage receipt must report archive manifest hash");
assert(
  validResult.checked.includes("uploaded artifact coverage against archive manifest"),
  "storage receipt validator must check uploaded artifact coverage",
);

await writeFile(
  placeholderReceiptPath,
  `${JSON.stringify(validReceipt({ storageLocation: "https://storage.example.com/TODO/final-judo/" }), null, 2)}\n`,
  "utf8",
);
const placeholderRun = await runReceipt(placeholderReceiptPath);
assert.notEqual(placeholderRun.code, 0, "placeholder storage location must block receipt");
const placeholderResult = JSON.parse(placeholderRun.stdout);
assert(
  placeholderResult.blockers.some((blocker) => blocker.code === "STORAGE_RECEIPT_LOCATION_INVALID"),
  "storage receipt validator must reject placeholder storage locations",
);

const missingArtifactReceipt = validReceipt();
missingArtifactReceipt.uploadedArtifacts = missingArtifactReceipt.uploadedArtifacts.filter((artifact) => artifact.key !== "fieldEvidence");
await writeFile(missingArtifactReceiptPath, `${JSON.stringify(missingArtifactReceipt, null, 2)}\n`, "utf8");
const missingArtifactRun = await runReceipt(missingArtifactReceiptPath);
assert.notEqual(missingArtifactRun.code, 0, "missing uploaded artifact must block receipt");
const missingArtifactResult = JSON.parse(missingArtifactRun.stdout);
assert(
  missingArtifactResult.blockers.some((blocker) => blocker.code === "STORAGE_RECEIPT_ARTIFACT_MISSING"),
  "storage receipt validator must require every archived artifact",
);

await writeFile(
  staleReceiptPath,
  `${JSON.stringify(validReceipt({ uploadedAt: "2026-07-15T02:00:00.000Z" }), null, 2)}\n`,
  "utf8",
);
const staleRun = await runReceipt(staleReceiptPath);
assert.notEqual(staleRun.code, 0, "upload before archive generation must block receipt");
const staleResult = JSON.parse(staleRun.stdout);
assert(
  staleResult.blockers.some((blocker) => blocker.code === "STORAGE_RECEIPT_UPLOADED_BEFORE_ARCHIVE"),
  "storage receipt validator must require upload after archive generation",
);

await writeFile(archiveManifest.artifacts.prePilotEvidence.archivedPath, "{\"tampered\":true}\n", "utf8");
await writeFile(tamperedReceiptPath, `${JSON.stringify(validReceipt(), null, 2)}\n`, "utf8");
const tamperedRun = await runReceipt(tamperedReceiptPath);
assert.notEqual(tamperedRun.code, 0, "tampered archived artifact must block receipt");
const tamperedResult = JSON.parse(tamperedRun.stdout);
assert(
  tamperedResult.blockers.some((blocker) => blocker.code === "STORAGE_RECEIPT_ARCHIVE_HASH_MISMATCH"),
  "storage receipt validator must revalidate local archived artifact hashes",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready pilot storage receipt",
        "archive manifest hash and size receipt match",
        "uploaded artifact coverage",
        "placeholder storage location blocks receipt",
        "missing uploaded artifact blocks receipt",
        "upload before archive generation blocks receipt",
        "tampered archived artifact blocks receipt",
      ],
    },
    null,
    2,
  ),
);
