import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const archiveManifestPath = path.resolve(
  args.find((arg) => arg.startsWith("--archive="))?.slice("--archive=".length) ??
    ".data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json",
);
const outPath = path.resolve(args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) ?? ".data/pilot-storage-receipt.json");

function argValue(name, fallback) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
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
  const storagePrefix = text(argValue("--storage-prefix", ""));
  if (!storagePrefix) {
    return "TODO: 최종 보관 위치";
  }

  const fileName = key === "pilotArtifactManifest" ? "pilot-artifact-manifest.json" : path.basename(text(archivedPath));
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
  const sourceManifest = archiveManifest.sourceManifest ?? {};
  const uploadedArtifacts = [
    uploadedArtifactEntry("pilotArtifactManifest", sourceManifest),
    ...Object.entries(archiveManifest.artifacts ?? {}).map(([key, artifact]) => uploadedArtifactEntry(key, artifact)),
  ];

  return {
    version: 1,
    archiveManifest: archiveManifestPath,
    archiveManifestSha256: sha256(archiveManifestBuffer),
    archiveManifestSizeBytes: archiveManifestBuffer.byteLength,
    uploadedAt: argValue("--uploaded-at", "TODO: 2026-07-15T03:00:00+09:00"),
    uploadedBy: argValue("--uploaded-by", "TODO: 업로드 담당자"),
    storageProvider: argValue("--storage-provider", "TODO: Google Drive, S3, GCS, SharePoint 등"),
    storageLocation: argValue("--storage-location", "TODO: https://, s3://, gs://, drive:// 등 최종 보관 위치"),
    evidence: argValue("--evidence", "TODO: 업로드 완료 화면, 권한 설정, 또는 CI 로그 링크"),
    retentionPolicy: {
      minimumRetentionDays: Number(argValue("--retention-days", "365")),
      owner: argValue("--retention-owner", "TODO: 보관 책임자"),
      accessReviewDueOn: argValue("--retention-access-review-due-on", "TODO: 2027-07-15"),
      evidence: argValue("--retention-evidence", "TODO: 보존 정책 또는 접근 권한 검토 증빙"),
    },
    uploadedArtifacts,
    checked: [
      "archive manifest SHA-256 and byte-size captured",
      "source artifact manifest upload entry generated",
      "archived artifact upload entries generated from archive manifest",
      "operator-supplied storage fields preserved",
    ],
  };
}

async function main() {
  const { parsed: archiveManifest, buffer } = await readArchiveManifest();

  if (archiveManifest.ok !== true || archiveManifest.releaseDecision !== "ready" || archiveManifest.blockers?.length > 0) {
    console.error("archive manifest must be ready before creating a storage receipt draft.");
    process.exit(1);
  }

  const receipt = buildReceipt(archiveManifest, buffer);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, serialized, "utf8");
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
