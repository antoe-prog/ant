import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-storage-receipt-draft-"));
const sourceDirectory = join(directory, "source");
const archiveDir = join(directory, "archive");
const artifactsDir = join(archiveDir, "artifacts");
const archiveManifestPath = join(archiveDir, "pilot-archive-manifest.json");
const sourceManifestPath = join(archiveDir, "pilot-artifact-manifest.json");
const draftReceiptPath = join(directory, "pilot-storage-receipt.draft.json");
const readyReceiptPath = join(directory, "pilot-storage-receipt.ready.json");

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

async function runDraft(extraArgs = []) {
  try {
    const result = await execFile(
      process.execPath,
      ["scripts/create-pilot-storage-receipt-draft.mjs", `--archive=${archiveManifestPath}`, ...extraArgs],
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

async function runReceipt(filePath) {
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

await mkdir(sourceDirectory, { recursive: true });
await mkdir(artifactsDir, { recursive: true });

const sourceManifestStats = await writeArtifact(
  sourceManifestPath,
  `${JSON.stringify({ ok: true, releaseDecision: "ready", generatedAt: "2026-07-15T02:00:00.000Z" }, null, 2)}\n`,
);

const archivedArtifacts = {};
for (const [index, key] of artifactKeys.entries()) {
  const extension = key === "prePilotMarkdown" || key === "postPilotMarkdown" ? ".md" : key === "prePilotReadinessEvidence" || key === "passwordRotationEvidence" ? ".csv" : ".json";
  const archivedPath = join(artifactsDir, `${String(index + 1).padStart(2, "0")}-${key}${extension}`);
  const sourcePath = join(sourceDirectory, `${key}${extension}`);
  const body =
    key === "prePilotReadinessEvidence"
      ? "id,category,label,owner,status,evidence,checkedAt,notes\npilot-branches,scope,운영 준비 지점 1-2곳과 2주 기간 확정,총괄 PM,verified,branch approval memo,2026-06-30T09:00:00.000Z,\n"
      : extension === ".csv"
      ? "userId,email,name,role,branchIds,usesDefaultPassword,hasPasswordHash,lastPasswordAuditAt,rotationStatus,evidence,rotatedAt,notes\nuser-admin,admin@finaljudo.test,관리자,admin,branch-gangnam|branch-songpa,false,true,2026-06-30T09:05:00.000Z,verified,audit-auth-password-reset-admin,2026-06-30T09:05:00.000Z,channel evidence\n"
      : extension === ".md"
      ? `# Final Judo Pilot Evidence Report\n\n- Artifact: ${key}\n`
      : `${JSON.stringify({ ok: true, releaseDecision: "ready", key }, null, 2)}\n`;
  const stats = await writeArtifact(archivedPath, body);

  archivedArtifacts[key] = {
    label: key,
    type: extension === ".json" ? "json" : "text",
    sourcePath,
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

const draftRun = await runDraft([`--out=${draftReceiptPath}`]);
assert.equal(draftRun.code, 0, draftRun.stderr);
const draftReceipt = JSON.parse(draftRun.stdout);
const writtenDraftReceipt = JSON.parse(await readFile(draftReceiptPath, "utf8"));
assert.deepEqual(writtenDraftReceipt, draftReceipt, "storage receipt draft --out must write stdout JSON");
assert.equal(draftReceipt.archiveManifestSha256, archiveManifestStats.sha256, "draft must capture archive manifest SHA-256");
assert.equal(draftReceipt.archiveManifestSizeBytes, archiveManifestStats.sizeBytes, "draft must capture archive manifest byte size");
assert.equal(draftReceipt.uploadedArtifacts.length, artifactKeys.length + 1, "draft must include every archive artifact plus source manifest");
assert.equal(draftReceipt.uploadedArtifacts[0].key, "pilotArtifactManifest", "draft must include source artifact manifest first");

const blockedDraftRun = await runReceipt(draftReceiptPath);
assert.notEqual(blockedDraftRun.code, 0, "placeholder draft must not pass strict storage receipt validation");
const blockedDraftResult = JSON.parse(blockedDraftRun.stdout);
assert(
  blockedDraftResult.blockers.some((blocker) => blocker.code === "STORAGE_RECEIPT_LOCATION_INVALID"),
  "placeholder draft must require final storage locations",
);

const storagePrefix = "https://storage.example.com/final-judo/pilot-20260715/artifacts";
const readyRun = await runDraft([
  `--out=${readyReceiptPath}`,
  "--uploaded-at=2026-07-15T02:30:00.000Z",
  "--uploaded-by=A0 PM",
  "--storage-provider=Cloud Archive",
  "--storage-location=https://storage.example.com/final-judo/pilot-20260715/",
  "--evidence=https://storage.example.com/final-judo/pilot-20260715/receipt-proof.png",
  "--retention-owner=A0 PM",
  "--retention-access-review-due-on=2027-07-15",
  "--retention-evidence=https://storage.example.com/final-judo/pilot-20260715/retention-policy.pdf",
  `--storage-prefix=${storagePrefix}`,
]);
assert.equal(readyRun.code, 0, readyRun.stderr);
const readyReceipt = JSON.parse(readyRun.stdout);
assert(
  readyReceipt.uploadedArtifacts.every((artifact) => artifact.storageLocation.startsWith(`${storagePrefix}/`)),
  "ready draft must apply storage prefix to every uploaded artifact",
);

const readyReceiptRun = await runReceipt(readyReceiptPath);
assert.equal(readyReceiptRun.code, 0, readyReceiptRun.stderr || readyReceiptRun.stdout);
const readyReceiptResult = JSON.parse(readyReceiptRun.stdout);
assert.equal(readyReceiptResult.ok, true, "completed storage receipt draft must pass validator");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "storage receipt draft captures archive manifest digest",
        "storage receipt draft includes every archived artifact",
        "placeholder draft remains blocked until upload fields are filled",
        "operator-supplied storage fields can produce a validator-ready receipt",
      ],
    },
    null,
    2,
  ),
);
