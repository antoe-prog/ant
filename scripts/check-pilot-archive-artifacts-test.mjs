import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-archive-artifacts-"));
const sourceDirectory = join(directory, "source");
const manifestPath = join(directory, "pilot-artifact-manifest.json");
const blockedManifestPath = join(directory, "pilot-artifact-manifest.blocked.json");
const archiveDir = join(directory, "archive-ready");
const tamperedArchiveDir = join(directory, "archive-tampered");
const blockedArchiveDir = join(directory, "archive-blocked");
const existingArchiveDir = join(directory, "archive-existing");
const placeholderArchiveDir = join(directory, "final-judo-pilot-YYYYMMDD");

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

async function runArchive(extraArgs = {}) {
  const args = [
    "scripts/archive-pilot-artifacts.mjs",
    `--manifest=${extraArgs.manifestPath ?? manifestPath}`,
    `--archive-dir=${extraArgs.archiveDir ?? archiveDir}`,
    ...(extraArgs.outPath ? [`--out=${extraArgs.outPath}`] : []),
  ];

  try {
    const result = await execFile(process.execPath, args, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

await mkdir(sourceDirectory, { recursive: true });

const artifacts = {};
for (const [index, key] of artifactKeys.entries()) {
  const extension = key === "postPilotMarkdown" || key === "prePilotMarkdown" ? ".md" : key === "prePilotReadinessEvidence" || key === "passwordRotationEvidence" ? ".csv" : ".json";
  const filePath = join(sourceDirectory, `${key}${extension}`);
  const body =
    key === "prePilotReadinessEvidence"
      ? "id,category,label,owner,status,evidence,checkedAt,notes\npilot-branches,scope,운영 준비 지점 1-2곳과 2주 기간 확정,총괄 PM,verified,branch approval memo,2026-06-30T09:00:00.000Z,\n"
      : key === "passwordRotationEvidence"
      ? "userId,email,name,role,branchIds,usesDefaultPassword,hasPasswordHash,lastPasswordAuditAt,rotationStatus,evidence,rotatedAt,notes\nuser-admin,admin@finaljudo.test,관리자,admin,branch-gangnam|branch-songpa,false,true,2026-06-30T09:05:00.000Z,verified,audit-auth-password-reset-admin,2026-06-30T09:05:00.000Z,channel evidence\n"
      : key === "postPilotMarkdown" || key === "prePilotMarkdown"
      ? `# Final Judo Pilot Evidence Report\n\n- Artifact: ${key}\n`
      : `${JSON.stringify({ ok: true, key, index }, null, 2)}\n`;
  const buffer = Buffer.from(body, "utf8");
  await writeFile(filePath, buffer);
  artifacts[key] = {
    label: key,
    path: filePath,
    type: extension === ".json" ? "json" : "text",
    sizeBytes: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

const readyManifest = {
  ok: true,
  generatedAt: "2026-07-15T02:00:00.000Z",
  releaseDecision: "ready",
  artifacts,
  checked: ["SHA-256 and byte-size manifest for every release artifact"],
  blockers: [],
};
await writeFile(manifestPath, `${JSON.stringify(readyManifest, null, 2)}\n`, "utf8");

const validRun = await runArchive();
assert.equal(validRun.code, 0, validRun.stderr);
const archiveManifest = JSON.parse(validRun.stdout);
assert.equal(archiveManifest.ok, true, "valid pilot artifact archive must be ready");
assert.equal(archiveManifest.releaseDecision, "ready", "archive release decision must be ready");
assert.equal(Object.keys(archiveManifest.artifacts).length, 11, "archive manifest must include every release artifact");
assert.match(archiveManifest.sourceManifest.sha256, /^[a-f0-9]{64}$/, "archive manifest must include the source manifest SHA-256");
assert(
  archiveManifest.checked.includes("archive copy SHA-256 and byte-size verification"),
  "archive command must verify copied artifact hashes before writing the archive manifest",
);

const writtenArchiveManifest = JSON.parse(await readFile(join(archiveDir, "pilot-archive-manifest.json"), "utf8"));
assert.deepEqual(writtenArchiveManifest, archiveManifest, "archive manifest file must match stdout");

const archivedSourceManifest = await readFile(archiveManifest.sourceManifest.archivedPath);
assert.equal(sha256(archivedSourceManifest), archiveManifest.sourceManifest.sha256, "source artifact manifest archive copy must preserve SHA-256");

const archivedFiles = await readdir(join(archiveDir, "artifacts"));
assert.equal(archivedFiles.length, 11, "archive must copy all release artifacts");
for (const [key, artifact] of Object.entries(archiveManifest.artifacts)) {
  const archivedBuffer = await readFile(artifact.archivedPath);
  assert.equal(sha256(archivedBuffer), readyManifest.artifacts[key].sha256, `${key} archive copy must preserve SHA-256`);
}

await writeFile(readyManifest.artifacts.prePilotEvidence.path, "{\"tampered\":true}\n", "utf8");
const tamperedRun = await runArchive({ archiveDir: tamperedArchiveDir });
assert.notEqual(tamperedRun.code, 0, "tampered source artifact must block archiving");
const tamperedManifest = JSON.parse(tamperedRun.stdout);
assert(
  tamperedManifest.blockers.some((blocker) => blocker.code === "ARTIFACT_HASH_MISMATCH"),
  "archive must block when source artifact SHA-256 no longer matches the manifest",
);

await writeFile(blockedManifestPath, `${JSON.stringify({ ...readyManifest, ok: false, releaseDecision: "blocked", blockers: [{ code: "MANUAL_BLOCK" }] }, null, 2)}\n`, "utf8");
const blockedRun = await runArchive({ manifestPath: blockedManifestPath, archiveDir: blockedArchiveDir });
assert.notEqual(blockedRun.code, 0, "blocked artifact manifest must block archiving");
const blockedManifest = JSON.parse(blockedRun.stdout);
assert(
  blockedManifest.blockers.some((blocker) => blocker.code === "ARTIFACT_MANIFEST_NOT_READY"),
  "archive must require a ready artifact manifest",
);

await mkdir(existingArchiveDir);
const existingRun = await runArchive({ archiveDir: existingArchiveDir });
assert.notEqual(existingRun.code, 0, "existing archive directory must block immutable archive writes");
const existingManifest = JSON.parse(existingRun.stdout);
assert(
  existingManifest.blockers.some((blocker) => blocker.code === "ARCHIVE_DIR_EXISTS"),
  "archive must require a fresh archive directory",
);

const placeholderRun = await runArchive({ archiveDir: placeholderArchiveDir });
assert.notEqual(placeholderRun.code, 0, "placeholder archive directory must block archiving");
const placeholderManifest = JSON.parse(placeholderRun.stdout);
assert(
  placeholderManifest.blockers.some((blocker) => blocker.code === "ARCHIVE_DIR_PLACEHOLDER"),
  "archive must reject placeholder archive directory names",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready pilot archive manifest with copied artifacts",
        "archive manifest writes JSON output",
        "archive command verifies copied artifact hashes",
        "tampered source artifact blocks archive",
        "blocked artifact manifest blocks archive",
        "existing archive directory blocks archive",
        "placeholder archive directory blocks archive",
      ],
    },
    null,
    2,
  ),
);
