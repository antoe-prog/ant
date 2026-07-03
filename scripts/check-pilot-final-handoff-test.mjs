import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

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

async function writeText(filePath, body) {
  const buffer = Buffer.from(body, "utf8");
  await writeFile(filePath, buffer);
  return {
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
  };
}

async function runFinalHandoff(paths, extraArgs = []) {
  try {
    const result = await execFile(
      process.execPath,
      [
        "scripts/check-pilot-final-handoff.mjs",
        `--artifact-manifest=${paths.artifactManifestPath}`,
        `--archive-manifest=${paths.archiveManifestPath}`,
        `--storage-receipt=${paths.storageReceiptPath}`,
        ...extraArgs,
      ],
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

async function setupFixture(label) {
  const root = await mkdtemp(join(tmpdir(), `final-judo-final-handoff-${label}-`));
  const sourceDir = join(root, "source");
  const archiveDir = join(root, "archive");
  const artifactsDir = join(archiveDir, "artifacts");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  const artifactManifestPath = join(sourceDir, "pilot-artifact-manifest.json");
  const archivedArtifactManifestPath = join(archiveDir, "pilot-artifact-manifest.json");
  const archiveManifestPath = join(archiveDir, "pilot-archive-manifest.json");
  const storageReceiptPath = join(root, "pilot-storage-receipt.json");
  const finalHandoffPath = join(root, "pilot-final-handoff.json");

  const artifactEntries = {};
  const archiveEntries = {};

  for (const [index, key] of artifactKeys.entries()) {
    const extension = key === "postPilotMarkdown" || key === "prePilotMarkdown" ? ".md" : key === "prePilotReadinessEvidence" || key === "passwordRotationEvidence" ? ".csv" : ".json";
    const sourcePath = join(sourceDir, `${key}${extension}`);
    const archivedPath = join(artifactsDir, `${String(index + 1).padStart(2, "0")}-${key}${extension}`);
    const body =
      key === "prePilotReadinessEvidence"
        ? "id,category,label,owner,status,evidence,checkedAt,notes\npilot-branches,scope,운영 준비 지점 1-2곳과 2주 기간 확정,총괄 PM,verified,branch approval memo,2026-06-30T09:00:00.000Z,\n"
        : key === "passwordRotationEvidence"
        ? "userId,email,name,role,branchIds,usesDefaultPassword,hasPasswordHash,lastPasswordAuditAt,rotationStatus,evidence,rotatedAt,notes\nuser-admin,admin@finaljudo.test,관리자,admin,branch-gangnam|branch-songpa,false,true,2026-06-30T09:05:00.000Z,verified,audit-auth-password-reset-admin,2026-06-30T09:05:00.000Z,channel evidence\n"
        : key === "prePilotMarkdown"
        ? "# Final Judo Pilot Evidence Report\n\n- Mode: pre-pilot\n- Decision: ready\n\n## Readiness\n\n## Operations\n"
        : key === "postPilotMarkdown"
          ? "# Final Judo Pilot Evidence Report\n\n- Mode: post-pilot\n- Decision: ready\n\n## Operations\n"
        : `${JSON.stringify({ ok: true, releaseDecision: "ready", key }, null, 2)}\n`;
    const stats = await writeText(sourcePath, body);
    await writeText(archivedPath, body);

    artifactEntries[key] = {
      label: key,
      type: extension === ".json" ? "json" : "text",
      path: sourcePath,
      sizeBytes: stats.sizeBytes,
      sha256: stats.sha256,
    };
    archiveEntries[key] = {
      label: key,
      type: extension === ".json" ? "json" : "text",
      sourcePath,
      archivedPath,
      sizeBytes: stats.sizeBytes,
      sha256: stats.sha256,
    };
  }

  const artifactManifest = {
    ok: true,
    generatedAt: "2026-07-15T02:00:00.000Z",
    releaseDecision: "ready",
    artifacts: artifactEntries,
    checked: ["fixture artifact manifest"],
    blockers: [],
  };
  const artifactManifestBody = `${JSON.stringify(artifactManifest, null, 2)}\n`;
  const artifactManifestStats = await writeText(artifactManifestPath, artifactManifestBody);
  await writeText(archivedArtifactManifestPath, artifactManifestBody);

  const archiveManifest = {
    ok: true,
    generatedAt: "2026-07-15T02:10:00.000Z",
    releaseDecision: "ready",
    sourceManifest: {
      sourcePath: artifactManifestPath,
      archivedPath: archivedArtifactManifestPath,
      sizeBytes: artifactManifestStats.sizeBytes,
      sha256: artifactManifestStats.sha256,
    },
    archiveDir,
    archiveManifestPath,
    artifacts: archiveEntries,
    checked: ["fixture archive manifest"],
    blockers: [],
  };
  const archiveManifestStats = await writeText(archiveManifestPath, `${JSON.stringify(archiveManifest, null, 2)}\n`);

  const storageLocation = `https://storage.example.com/final-judo/${label}/`;
  const storageReceipt = {
    version: 1,
    archiveManifest: archiveManifestPath,
    archiveManifestSha256: archiveManifestStats.sha256,
    archiveManifestSizeBytes: archiveManifestStats.sizeBytes,
    uploadedAt: "2026-07-15T02:20:00.000Z",
    uploadedBy: "A0 PM",
    storageProvider: "Cloud Archive",
    storageLocation,
    evidence: `${storageLocation}receipt-proof.png`,
    retentionPolicy: {
      minimumRetentionDays: 365,
      owner: "A0 PM",
      accessReviewDueOn: "2027-07-15",
      evidence: `${storageLocation}retention-policy.pdf`,
    },
    uploadedArtifacts: [
      {
        key: "pilotArtifactManifest",
        archivedPath: archivedArtifactManifestPath,
        sizeBytes: artifactManifestStats.sizeBytes,
        sha256: artifactManifestStats.sha256,
        storageLocation: `${storageLocation}pilot-artifact-manifest.json`,
      },
      ...Object.entries(archiveEntries).map(([key, artifact]) => ({
        key,
        archivedPath: artifact.archivedPath,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        storageLocation: `${storageLocation}${key}`,
      })),
    ],
  };
  await writeText(storageReceiptPath, `${JSON.stringify(storageReceipt, null, 2)}\n`);

  return {
    root,
    artifactManifestPath,
    archiveManifestPath,
    storageReceiptPath,
    finalHandoffPath,
    artifactManifest,
    archiveManifest,
    storageReceipt,
    archiveEntries,
  };
}

const readyFixture = await setupFixture("ready");
const readyResult = await runFinalHandoff(readyFixture);
assert.equal(readyResult.code, 0, readyResult.stderr || readyResult.stdout);
const readyOutput = JSON.parse(readyResult.stdout);
assert.equal(readyOutput.ok, true);
assert.equal(readyOutput.releaseDecision, "ready");
assert(readyOutput.checked.includes("storage receipt validator pass"));

const outFixture = await setupFixture("out");
const outResult = await runFinalHandoff(outFixture, [`--out=${outFixture.finalHandoffPath}`]);
assert.equal(outResult.code, 0, outResult.stderr || outResult.stdout);
const writtenHandoff = JSON.parse(await readFile(outFixture.finalHandoffPath, "utf8"));
assert.equal(writtenHandoff.ok, true);

const missingArchiveFixture = await setupFixture("missing-archive");
const missingArchiveManifest = structuredClone(missingArchiveFixture.archiveManifest);
delete missingArchiveManifest.artifacts.closeoutPackage;
await writeText(missingArchiveFixture.archiveManifestPath, `${JSON.stringify(missingArchiveManifest, null, 2)}\n`);
const missingArchiveResult = await runFinalHandoff(missingArchiveFixture);
assert.notEqual(missingArchiveResult.code, 0, "missing archive artifact should block final handoff");
const missingArchiveOutput = JSON.parse(missingArchiveResult.stdout);
assert(
  missingArchiveOutput.blockers.some((blocker) => blocker.code === "FINAL_HANDOFF_ARCHIVE_MANIFEST_ENTRY_MISSING"),
  "missing archive artifact must be reported",
);

const tamperedFixture = await setupFixture("tampered");
await writeText(tamperedFixture.archiveEntries.postPilotEvidence.archivedPath, '{"tampered":true}\n');
const tamperedResult = await runFinalHandoff(tamperedFixture);
assert.notEqual(tamperedResult.code, 0, "tampered archived artifact should block final handoff");
const tamperedOutput = JSON.parse(tamperedResult.stdout);
assert(
  tamperedOutput.blockers.some((blocker) => blocker.code === "FINAL_HANDOFF_ARCHIVED_ARTIFACT_HASH_MISMATCH") ||
    tamperedOutput.blockers.some((blocker) => blocker.code === "FINAL_HANDOFF_STORAGE_RECEIPT_VALIDATION_FAILED"),
  "tampered archived artifact must be reported",
);

const blockedArtifactFixture = await setupFixture("blocked-artifact");
const blockedArtifactManifest = structuredClone(blockedArtifactFixture.artifactManifest);
blockedArtifactManifest.ok = false;
blockedArtifactManifest.releaseDecision = "blocked";
blockedArtifactManifest.blockers = [{ code: "FIXTURE_BLOCKED", message: "blocked fixture" }];
await writeText(blockedArtifactFixture.artifactManifestPath, `${JSON.stringify(blockedArtifactManifest, null, 2)}\n`);
const blockedArtifactResult = await runFinalHandoff(blockedArtifactFixture);
assert.notEqual(blockedArtifactResult.code, 0, "blocked artifact manifest should block final handoff");
const blockedArtifactOutput = JSON.parse(blockedArtifactResult.stdout);
assert(
  blockedArtifactOutput.blockers.some((blocker) => blocker.code === "FINAL_HANDOFF_ARTIFACT_MANIFEST_NOT_READY"),
  "blocked artifact manifest must be reported",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready final handoff package",
        "final handoff writes JSON output",
        "missing archive artifact blocks final handoff",
        "tampered archived artifact blocks final handoff",
        "blocked artifact manifest blocks final handoff",
      ],
    },
    null,
    2,
  ),
);
