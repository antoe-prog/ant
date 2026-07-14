import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createProductionRecoveryManifest,
  ProductionRecoveryManifestError,
  writeProductionRecoveryManifest,
} from "./create-production-recovery-manifest.mjs";

function passingLiveReport() {
  return {
    ok: true,
    runtime: {
      identity: {
        fingerprint: "a".repeat(64),
        databaseName: "final_judo",
        databaseUser: "runtime_user",
        host: "ep-runtime.neon.tech",
        stateTable: "app_runtime_state",
        stateKey: "mvp",
      },
      state: {
        revision: 91,
        updatedAt: "2026-07-15T02:00:00.000Z",
      },
    },
    counts: {
      branches: 2,
      activeBranches: 2,
      users: 8,
      members: 42,
      classes: 12,
      attendance: 180,
      payments: 40,
      notices: 7,
      authSessions: 3,
      auditLogs: 220,
    },
    minimumDataFingerprint: {
      algorithm: "sha256",
      value: "b".repeat(64),
      collections: ["branches", "users", "members"],
    },
    ignoredConnectionString: "postgresql://user:must-not-leak@host/database",
    ignoredPasswordHash: "pbkdf2_sha256$120000$salt$must-not-leak",
  };
}

const input = {
  liveReport: passingLiveReport(),
  deployment: {
    id: "dpl_01JUL15PROD",
    sourceSha: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
    buildId: "build-20260715.4",
  },
  neon: {
    projectId: "silent-moon-12345678",
    branchId: "br-production-87654321",
  },
  smoke: {
    status: "passed",
    checkedAt: "2026-07-15T02:05:00.000Z",
    evidenceId: "smoke-prod-20260715-0205",
  },
  generatedAt: new Date("2026-07-15T02:06:00.000Z"),
};
const manifest = createProductionRecoveryManifest(input);

assert.equal(manifest.schemaVersion, "final-judo-production-recovery-manifest/v1");
assert.equal(manifest.purpose, "production-rollback");
assert.deepEqual(manifest.deployment, {
  id: "dpl_01JUL15PROD",
  sourceSha: "abcdef0123456789abcdef0123456789abcdef01",
  buildId: "build-20260715.4",
});
assert.deepEqual(manifest.neon, {
  projectId: "silent-moon-12345678",
  branchId: "br-production-87654321",
  identity: "a".repeat(64),
});
assert.equal(manifest.runtime.revision, 91);
assert.equal(manifest.runtime.counts.members, 42);
assert.equal(manifest.runtime.minimumDataFingerprint.value, "b".repeat(64));
assert.deepEqual(manifest.smoke, {
  status: "passed",
  checkedAt: "2026-07-15T02:05:00.000Z",
  evidenceId: "smoke-prod-20260715-0205",
});

const serialized = JSON.stringify(manifest);
assert(!serialized.includes("must-not-leak"));
assert(!serialized.includes("connectionString"));
assert(!serialized.includes("passwordHash"));
assert(!serialized.includes("databaseUser"));
assert(!serialized.includes("host"));

await assert.rejects(
  async () => createProductionRecoveryManifest({ ...input, liveReport: { ...passingLiveReport(), ok: false } }),
  (error) => error instanceof ProductionRecoveryManifestError && error.code === "LIVE_PREFLIGHT_REQUIRED",
);
await assert.rejects(
  async () => createProductionRecoveryManifest({ ...input, smoke: { ...input.smoke, status: "failed" } }),
  (error) => error instanceof ProductionRecoveryManifestError && error.code === "SMOKE_NOT_PASSED",
);
await assert.rejects(
  async () => createProductionRecoveryManifest({ ...input, neon: { ...input.neon, branchId: "" } }),
  (error) => error instanceof ProductionRecoveryManifestError && error.code === "INVALID_MANIFEST_METADATA",
);
await assert.rejects(
  async () => createProductionRecoveryManifest({ ...input, deployment: { ...input.deployment, sourceSha: "not-a-sha" } }),
  (error) => error instanceof ProductionRecoveryManifestError && error.code === "INVALID_MANIFEST_METADATA",
);

const directory = await mkdtemp(path.join(tmpdir(), "final-judo-recovery-manifest-"));
const outputPath = path.join(directory, "nested", "production-recovery.json");

try {
  await writeProductionRecoveryManifest(outputPath, manifest);
  const written = JSON.parse(await readFile(outputPath, "utf8"));
  const fileStat = await stat(outputPath);

  assert.deepEqual(written, manifest);
  assert.equal(fileStat.mode & 0o777, 0o600);
} finally {
  await rm(directory, { recursive: true, force: true });
}

const rejectedSecretArgument = spawnSync(
  process.execPath,
  [
    "scripts/create-production-recovery-manifest.mjs",
    "--postgres-url=postgresql://user:manifest-cli-secret@host/db",
  ],
  { cwd: process.cwd(), encoding: "utf8" },
);
assert.notEqual(rejectedSecretArgument.status, 0);
assert(!rejectedSecretArgument.stdout.includes("manifest-cli-secret"));
assert(!rejectedSecretArgument.stderr.includes("manifest-cli-secret"));

console.log(JSON.stringify({
  ok: true,
  checked: [
    "deployment id, source SHA, and build id",
    "Neon project, branch, and runtime identity",
    "revision, counts, and minimum data fingerprint",
    "passed production smoke evidence",
    "allowlisted secret-free manifest reconstruction",
    "atomic 0600 manifest write",
    "invalid live, smoke, metadata, and CLI secret rejection",
  ],
}, null, 2));
