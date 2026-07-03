import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const archiveManifestPath = path.resolve(
  args.archive ?? ".data/p1-release-archives/final-judo-p1-20260715/p1-release-archive-manifest.json",
);
const outPath = path.resolve(args.out ?? ".data/p1-release-storage-receipt.json");

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

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readArchiveManifest() {
  const buffer = await readFile(archiveManifestPath);
  const parsed = JSON.parse(buffer.toString("utf8"));
  return { parsed, buffer };
}

function storageLocationFor(key, archivedPath) {
  const storagePrefix = text(args.storagePrefix);
  if (!storagePrefix) {
    return "TODO: 최종 P1 release 보관 위치";
  }

  const fileName = key === "p1ReleasePackage" ? "p1-release-package.json" : path.basename(text(archivedPath));
  return `${storagePrefix.replace(/\/+$/, "")}/${fileName}`;
}

function uploadedArtifactEntry(key, artifact) {
  return {
    key,
    archivedPath: artifact.archivedPath,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    storageLocation: storageLocationFor(key, artifact.archivedPath),
  };
}

function buildReceipt(archiveManifest, archiveManifestBuffer) {
  const sourcePackage = archiveManifest.sourcePackage ?? {};
  const uploadedArtifacts = [
    uploadedArtifactEntry("p1ReleasePackage", sourcePackage),
    ...Object.entries(archiveManifest.artifacts ?? {}).map(([key, artifact]) => uploadedArtifactEntry(key, artifact)),
  ];

  return {
    version: 1,
    archiveManifest: archiveManifestPath,
    archiveManifestSha256: sha256(archiveManifestBuffer),
    archiveManifestSizeBytes: archiveManifestBuffer.byteLength,
    uploadedAt: text(args.uploadedAt) || "TODO: 2026-07-15T03:00:00+09:00",
    uploadedBy: text(args.uploadedBy) || "TODO: 업로드 담당자",
    storageProvider: text(args.storageProvider) || "TODO: Google Drive, S3, GCS, SharePoint 등",
    storageLocation: text(args.storageLocation) || "TODO: https://, s3://, gs://, drive:// 등 최종 보관 위치",
    evidence: text(args.evidence) || "TODO: 업로드 완료 화면, 권한 설정, 또는 CI 로그 링크",
    retentionPolicy: {
      minimumRetentionDays: Number(text(args.retentionDays) || "365"),
      owner: text(args.retentionOwner) || "TODO: 보관 책임자",
      accessReviewDueOn: text(args.retentionAccessReviewDueOn) || "TODO: 2027-07-15",
      evidence: text(args.retentionEvidence) || "TODO: 보존 정책 또는 접근 권한 검토 증빙",
    },
    uploadedArtifacts,
    checked: [
      "P1 release archive manifest SHA-256 and byte-size captured",
      "P1 release package upload entry generated",
      "P1 release artifact upload entries generated from archive manifest",
      "operator-supplied storage fields preserved",
    ],
  };
}

async function main() {
  const { parsed: archiveManifest, buffer } = await readArchiveManifest();

  if (archiveManifest.ok !== true || archiveManifest.releaseDecision !== "ready" || archiveManifest.blockers?.length > 0) {
    console.error("P1 release archive manifest must be ready before creating a storage receipt draft.");
    process.exit(1);
  }

  const receipt = buildReceipt(archiveManifest, buffer);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, serialized);
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
