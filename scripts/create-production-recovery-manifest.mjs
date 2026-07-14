import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  inspectLiveProductionRuntime,
  parsePostgresConnectionIdentity,
} from "./check-live-production-runtime.mjs";

const manifestSchemaVersion = "final-judo-production-recovery-manifest/v1";
const sha256Pattern = /^[a-f0-9]{64}$/i;
const sourceShaPattern = /^[a-f0-9]{7,64}$/i;
const safeMetadataPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;

export class ProductionRecoveryManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductionRecoveryManifestError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProductionRecoveryManifestError(code, message);
}

function requiredMetadata(value, label) {
  if (typeof value !== "string" || !safeMetadataPattern.test(value)) {
    fail("INVALID_MANIFEST_METADATA", `${label} is required and must be a non-secret deployment identifier.`);
  }

  return value;
}

function requiredIsoTimestamp(value, label) {
  if (typeof value !== "string") {
    fail("INVALID_MANIFEST_METADATA", `${label} is required.`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("INVALID_MANIFEST_METADATA", `${label} must be an ISO-8601 UTC timestamp.`);
  }

  return value;
}

function optionalIsoTimestamp(value, label) {
  return value === null || value === undefined ? null : requiredIsoTimestamp(value, label);
}

function positiveInteger(value, label) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail("INVALID_MANIFEST_RUNTIME", `${label} must be a positive integer.`);
  }

  return parsed;
}

function sanitizeCounts(counts) {
  if (!counts || typeof counts !== "object") {
    fail("INVALID_MANIFEST_RUNTIME", "Live runtime counts are required.");
  }

  return Object.fromEntries(
    [
      "branches",
      "activeBranches",
      "users",
      "members",
      "classes",
      "attendance",
      "payments",
      "notices",
      "authSessions",
      "auditLogs",
    ].map((key) => {
      const value = Number(counts[key]);
      if (!Number.isSafeInteger(value) || value < 0) {
        fail("INVALID_MANIFEST_RUNTIME", `Runtime count ${key} must be a non-negative integer.`);
      }
      return [key, value];
    }),
  );
}

export function createProductionRecoveryManifest({
  liveReport,
  deployment,
  neon,
  smoke,
  generatedAt = new Date(),
}) {
  if (!liveReport?.ok) {
    fail("LIVE_PREFLIGHT_REQUIRED", "A passing live production preflight is required before creating a recovery manifest.");
  }

  const deploymentId = requiredMetadata(deployment?.id, "deployment id");
  const sourceSha = deployment?.sourceSha;
  if (typeof sourceSha !== "string" || !sourceShaPattern.test(sourceSha)) {
    fail("INVALID_MANIFEST_METADATA", "source SHA must contain 7 to 64 hexadecimal characters.");
  }
  const buildId = requiredMetadata(deployment?.buildId, "build id");
  const neonProjectId = requiredMetadata(neon?.projectId, "Neon project id");
  const neonBranchId = requiredMetadata(neon?.branchId, "Neon branch id");
  const identity = liveReport.runtime?.identity?.fingerprint;
  if (typeof identity !== "string" || !sha256Pattern.test(identity)) {
    fail("INVALID_MANIFEST_RUNTIME", "The live runtime identity fingerprint is missing or invalid.");
  }

  const revision = positiveInteger(liveReport.runtime?.state?.revision, "runtime revision");
  const stateTable = liveReport.runtime?.identity?.stateTable;
  const stateKey = liveReport.runtime?.identity?.stateKey;
  if (typeof stateTable !== "string" || !/^[a-z_][a-z0-9_]*$/.test(stateTable)) {
    fail("INVALID_MANIFEST_RUNTIME", "The live runtime state table is invalid.");
  }
  if (typeof stateKey !== "string" || !stateKey || stateKey.length > 128) {
    fail("INVALID_MANIFEST_RUNTIME", "The live runtime state key is invalid.");
  }

  if (smoke?.status !== "passed") {
    fail("SMOKE_NOT_PASSED", "A passed production smoke result is required for a recovery manifest.");
  }
  const smokeCheckedAt = requiredIsoTimestamp(smoke.checkedAt, "smoke checkedAt");
  const smokeEvidenceId = requiredMetadata(smoke.evidenceId, "smoke evidence id");
  const dataFingerprint = liveReport.minimumDataFingerprint;
  if (dataFingerprint?.algorithm !== "sha256" || !sha256Pattern.test(dataFingerprint?.value ?? "")) {
    fail("INVALID_MANIFEST_RUNTIME", "The minimum data fingerprint is missing or invalid.");
  }

  return {
    schemaVersion: manifestSchemaVersion,
    purpose: "production-rollback",
    generatedAt: generatedAt.toISOString(),
    deployment: {
      id: deploymentId,
      sourceSha: sourceSha.toLowerCase(),
      buildId,
    },
    neon: {
      projectId: neonProjectId,
      branchId: neonBranchId,
      identity: identity.toLowerCase(),
    },
    runtime: {
      stateTable,
      stateKey,
      revision,
      updatedAt: optionalIsoTimestamp(liveReport.runtime.state.updatedAt, "runtime updatedAt"),
      counts: sanitizeCounts(liveReport.counts),
      minimumDataFingerprint: {
        algorithm: "sha256",
        value: dataFingerprint.value.toLowerCase(),
      },
    },
    smoke: {
      status: "passed",
      checkedAt: smokeCheckedAt,
      evidenceId: smokeEvidenceId,
    },
  };
}

export async function writeProductionRecoveryManifest(outputPath, manifest) {
  const resolvedPath = path.resolve(outputPath);
  const directory = path.dirname(resolvedPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(resolvedPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function parseCli(args, env) {
  if (args.some((arg) => arg === "--postgres-url" || arg.startsWith("--postgres-url="))) {
    fail("DATABASE_URL_CLI_FORBIDDEN", "Database secrets must be provided through environment variables, never CLI arguments.");
  }

  const allowedValues = new Set([
    "--deployment-id",
    "--source-sha",
    "--build-id",
    "--neon-project-id",
    "--neon-branch-id",
    "--smoke-status",
    "--smoke-checked-at",
    "--smoke-evidence-id",
    "--expected-runtime-identity",
    "--expected-data-fingerprint",
    "--expected-revision",
    "--state-key",
    "--table",
    "--out",
  ]);
  const values = new Map();

  for (const arg of args) {
    const separator = arg.indexOf("=");
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const value = separator === -1 ? undefined : arg.slice(separator + 1);

    if (!allowedValues.has(name) || value === undefined || value === "") {
      fail("INVALID_MANIFEST_ARGUMENT", `Unsupported or incomplete argument: ${name}`);
    }
    values.set(name, value);
  }

  const expectedRevisionValue = values.get("--expected-revision") ?? env.FINAL_JUDO_EXPECTED_RUNTIME_REVISION;
  const expectedInstallationId = env.FINAL_JUDO_INSTALLATION_ID?.trim();

  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/i.test(expectedInstallationId ?? "")) {
    fail("INVALID_MANIFEST_METADATA", "FINAL_JUDO_INSTALLATION_ID must identify the approved production installation.");
  }

  return {
    connectionString: env.FINAL_JUDO_POSTGRES_URL ?? env.DATABASE_URL,
    deployment: {
      id: values.get("--deployment-id") ?? env.FINAL_JUDO_DEPLOYMENT_ID ?? env.VERCEL_DEPLOYMENT_ID,
      sourceSha: values.get("--source-sha") ?? env.FINAL_JUDO_SOURCE_SHA ?? env.VERCEL_GIT_COMMIT_SHA ?? env.GITHUB_SHA,
      buildId: values.get("--build-id") ?? env.FINAL_JUDO_BUILD_ID ?? env.VERCEL_BUILD_ID,
    },
    neon: {
      projectId: values.get("--neon-project-id") ?? env.FINAL_JUDO_NEON_PROJECT_ID ?? env.NEON_PROJECT_ID,
      branchId: values.get("--neon-branch-id") ?? env.FINAL_JUDO_NEON_BRANCH_ID ?? env.NEON_BRANCH_ID,
    },
    smoke: {
      status: values.get("--smoke-status") ?? env.FINAL_JUDO_SMOKE_STATUS,
      checkedAt: values.get("--smoke-checked-at") ?? env.FINAL_JUDO_SMOKE_CHECKED_AT,
      evidenceId: values.get("--smoke-evidence-id") ?? env.FINAL_JUDO_SMOKE_EVIDENCE_ID,
    },
    expectedRuntimeIdentity:
      values.get("--expected-runtime-identity") ?? env.FINAL_JUDO_EXPECTED_RUNTIME_IDENTITY,
    expectedInstallationId,
    expectedDataFingerprint:
      values.get("--expected-data-fingerprint") ?? env.FINAL_JUDO_EXPECTED_DATA_FINGERPRINT,
    expectedRevision: expectedRevisionValue === undefined
      ? undefined
      : positiveInteger(expectedRevisionValue, "expected revision"),
    stateKey: values.get("--state-key") ?? env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp",
    stateTable: values.get("--table") ?? env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state",
    outputPath: values.get("--out") ?? env.FINAL_JUDO_RECOVERY_MANIFEST_PATH,
  };
}

async function main() {
  let pool;

  try {
    const options = parseCli(process.argv.slice(2), process.env);
    const connectionIdentity = parsePostgresConnectionIdentity(options.connectionString);
    const { Pool } = await import("pg");
    pool = new Pool({
      application_name: "final-judo-production-recovery-manifest",
      connectionString: options.connectionString,
      max: 1,
    });
    const client = await pool.connect();

    try {
      const liveReport = await inspectLiveProductionRuntime({
        client,
        connectionIdentity,
        stateKey: options.stateKey,
        stateTable: options.stateTable,
        expectedInstallationId: options.expectedInstallationId,
        expectedRuntimeIdentity: options.expectedRuntimeIdentity,
        expectedDataFingerprint: options.expectedDataFingerprint,
        expectedRevision: options.expectedRevision,
      });
      const manifest = createProductionRecoveryManifest({
        liveReport,
        deployment: options.deployment,
        neon: options.neon,
        smoke: options.smoke,
      });

      if (options.outputPath) {
        await writeProductionRecoveryManifest(options.outputPath, manifest);
      }
      console.log(JSON.stringify(manifest, null, 2));
    } finally {
      client.release();
    }
  } catch (error) {
    const knownError = error instanceof ProductionRecoveryManifestError;
    console.error(JSON.stringify({
      ok: false,
      code: knownError ? error.code : "PRODUCTION_RECOVERY_MANIFEST_FAILED",
      message: knownError
        ? error.message
        : "Production recovery manifest creation failed without exposing secrets or connection details.",
    }));
    process.exitCode = 1;
  } finally {
    await pool?.end().catch(() => undefined);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
