import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createRuntimeIdentityFingerprint,
  parsePostgresConnectionIdentity,
} from "./check-live-production-runtime.mjs";

const defaultStateTable = "app_runtime_state";
const defaultStateKey = "mvp";
const defaultPilotPassword = "FinalJudoPilot!2026";
const safeIdentifierPattern = /^[a-z_][a-z0-9_]*$/;
const installationIdPattern = /^[a-z0-9][a-z0-9._-]{7,127}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const approvalFlag = "--approve-admin-credential-recovery";

export class AdminCredentialRecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdminCredentialRecoveryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AdminCredentialRecoveryError(code, message);
}

function positiveInteger(value, label) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail("INVALID_RECOVERY_ARGUMENT", `${label} must be a positive integer.`);
  }

  return parsed;
}

function exactNonEmptyString(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    fail("INVALID_RECOVERY_ARGUMENT", `${label} must be non-empty and must not have surrounding whitespace.`);
  }

  return value;
}

export function assertStrongRecoveryPassword(password) {
  if (typeof password !== "string" || password.length < 12) {
    fail("WEAK_RECOVERY_PASSWORD", "The recovery password must contain at least 12 characters.");
  }
  if (password === defaultPilotPassword) {
    fail("SHARED_RECOVERY_PASSWORD", "The retired shared default password cannot be restored.");
  }
}

export function createRecoveryPasswordHash(password, salt = randomBytes(16).toString("hex")) {
  assertStrongRecoveryPassword(password);
  const iterations = 120_000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");

  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

export function validateAdminCredentialRecoveryRequest(options) {
  const mode = options.mode ?? "validate-only";

  if (!new Set(["validate-only", "apply"]).has(mode)) {
    fail("INVALID_RECOVERY_MODE", "Recovery mode must be validate-only or apply.");
  }
  if (mode === "apply" && options.approved !== true) {
    fail(
      "RECOVERY_APPROVAL_REQUIRED",
      `Apply mode requires the explicit ${approvalFlag} flag.`,
    );
  }

  exactNonEmptyString(options.actorUserId, "actor user id");
  exactNonEmptyString(options.targetUserId, "target user id");
  exactNonEmptyString(options.reason, "recovery reason");
  assertStrongRecoveryPassword(options.password);
  positiveInteger(options.expectedRevision, "expected revision");

  if (!safeIdentifierPattern.test(options.stateTable ?? defaultStateTable)) {
    fail("UNSAFE_STATE_TABLE", "The runtime state table is not a safe PostgreSQL identifier.");
  }
  const stateKey = options.stateKey ?? defaultStateKey;
  if (!stateKey || stateKey.length > 128) {
    fail("INVALID_STATE_KEY", "The runtime state key must contain 1 to 128 characters.");
  }
  if (options.expectedRuntimeIdentity && !sha256Pattern.test(options.expectedRuntimeIdentity)) {
    fail("INVALID_RUNTIME_IDENTITY", "The expected runtime identity must be a SHA-256 fingerprint.");
  }
  if (!installationIdPattern.test(options.expectedInstallationId ?? "")) {
    fail("INVALID_INSTALLATION_IDENTITY", "A valid expected production installation identity is required.");
  }

  return {
    ...options,
    mode,
    expectedRevision: Number(options.expectedRevision),
    stateTable: options.stateTable ?? defaultStateTable,
    stateKey,
  };
}

function isAcceptedAdmin(user) {
  return user?.role === "admin" && user?.invitationStatus !== "pending";
}

export function prepareAdminCredentialRecovery({
  db,
  actorUserId,
  targetUserId,
  reason,
  password,
  recoveredAt = new Date(),
  expectedRevision,
  auditId = `audit-recovery-${randomUUID()}`,
  passwordHash,
}) {
  if (!db || !Array.isArray(db.users) || !Array.isArray(db.authSessions) || !Array.isArray(db.auditLogs)) {
    fail("INVALID_RUNTIME_STATE", "Runtime state must contain users, authSessions, and auditLogs arrays.");
  }

  const actor = db.users.find((user) => user?.id === actorUserId);
  const target = db.users.find((user) => user?.id === targetUserId);

  if (!isAcceptedAdmin(actor)) {
    fail("RECOVERY_ACTOR_NOT_ADMIN", "The recovery actor must be an accepted administrator in the locked runtime state.");
  }
  if (!isAcceptedAdmin(target)) {
    fail("RECOVERY_TARGET_NOT_ADMIN", "The recovery target must be an accepted administrator in the locked runtime state.");
  }

  const recoveredAtIso = recoveredAt.toISOString();
  const sessionsToRevoke = db.authSessions.filter(
    (session) => session?.userId === targetUserId && !session.revokedAt,
  );
  const nextPasswordHash = passwordHash ?? createRecoveryPasswordHash(password);
  const nextUsers = db.users.map((user) => {
    if (user?.id !== targetUserId) {
      return user;
    }

    const nextUser = {
      ...user,
      passwordHash: nextPasswordHash,
      passwordUpdatedAt: recoveredAtIso,
    };
    delete nextUser.passwordResetRequestedAt;
    return nextUser;
  });
  const auditLog = {
    id: auditId,
    branchId: target.branchIds?.[0] ?? null,
    actorUserId,
    action: "auth.password_reset.complete",
    targetType: "auth",
    targetId: targetUserId,
    before: {
      passwordResetRequestedAt: target.passwordResetRequestedAt ?? null,
      passwordUpdatedAt: target.passwordUpdatedAt ?? null,
    },
    after: {
      issuedAt: recoveredAtIso,
      mode: "production-admin-credential-recovery",
      reason,
      sessionsRevoked: sessionsToRevoke.length,
      expectedRevision,
    },
    result: "success",
    message: "운영 관리자 자격 증명을 복구했습니다.",
    createdAt: recoveredAtIso,
  };
  const nextDb = {
    ...db,
    users: nextUsers,
    authSessions: db.authSessions.map((session) =>
      session?.userId === targetUserId && !session.revokedAt
        ? { ...session, revokedAt: recoveredAtIso }
        : session,
    ),
    auditLogs: [auditLog, ...db.auditLogs],
  };

  return {
    nextDb,
    auditLog,
    revokedSessions: sessionsToRevoke.length,
    recoveredAt: recoveredAtIso,
  };
}

export async function recoverAdminCredential(rawOptions) {
  const options = validateAdminCredentialRecoveryRequest(rawOptions);
  const {
    client,
    connectionIdentity,
    stateTable,
    stateKey,
    expectedRevision,
    expectedInstallationId,
    expectedRuntimeIdentity,
    mode,
  } = options;
  let transactionStarted = false;

  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    transactionStarted = true;
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      String(options.statementTimeoutMs ?? 15_000),
    ]);
    const identityResult = await client.query(`
      SELECT current_database() AS database_name, current_user AS database_user
    `);
    const databaseIdentity = identityResult.rows[0];

    if (
      databaseIdentity?.database_name !== connectionIdentity.databaseName ||
      databaseIdentity?.database_user !== connectionIdentity.databaseUser
    ) {
      fail("DATABASE_IDENTITY_MISMATCH", "The connected database identity does not match the configured runtime URL.");
    }

    const lockKey = `${stateTable}:${stateKey}:user-administration`;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
    const stateResult = await client.query(
      `SELECT data, revision, installation_id, updated_at FROM ${stateTable} WHERE key = $1 FOR UPDATE`,
      [stateKey],
    );
    const stateRow = stateResult.rows[0];

    if (!stateRow) {
      fail("RUNTIME_STATE_ROW_MISSING", "The locked production runtime state row does not exist.");
    }
    if (stateRow.installation_id !== expectedInstallationId) {
      fail("INSTALLATION_IDENTITY_MISMATCH", "The locked runtime installation identity does not match production configuration.");
    }

    const runtimeIdentity = {
      databaseName: databaseIdentity.database_name,
      databaseUser: databaseIdentity.database_user,
      host: connectionIdentity.host,
      port: connectionIdentity.port,
      installationId: stateRow.installation_id,
      stateTable,
      stateKey,
    };
    const runtimeIdentityFingerprint = createRuntimeIdentityFingerprint(runtimeIdentity);

    if (expectedRuntimeIdentity && runtimeIdentityFingerprint !== expectedRuntimeIdentity.toLowerCase()) {
      fail("RUNTIME_IDENTITY_MISMATCH", "The connected runtime identity does not match the approved fingerprint.");
    }

    const currentRevision = Number(stateRow.revision);
    if (currentRevision !== expectedRevision) {
      fail(
        "RUNTIME_REVISION_MISMATCH",
        `The locked runtime revision is ${currentRevision}; expected ${expectedRevision}.`,
      );
    }

    const prepared = prepareAdminCredentialRecovery({
      db: stateRow.data,
      actorUserId: options.actorUserId,
      targetUserId: options.targetUserId,
      reason: options.reason,
      password: options.password,
      recoveredAt: options.recoveredAt,
      expectedRevision,
      auditId: options.auditId,
      passwordHash: options.passwordHash,
    });
    let resultingRevision = currentRevision;

    if (mode === "apply") {
      const updateResult = await client.query(
        `
          UPDATE ${stateTable}
          SET data = $2::jsonb, revision = revision + 1, updated_at = now()
          WHERE key = $1 AND revision = $3
          RETURNING revision, updated_at
        `,
        [stateKey, JSON.stringify(prepared.nextDb), expectedRevision],
      );
      const updatedRow = updateResult.rows[0];

      if (!updatedRow) {
        fail("ATOMIC_UPDATE_FAILED", "The production runtime changed before the atomic recovery update completed.");
      }
      resultingRevision = Number(updatedRow.revision);
      if (resultingRevision !== currentRevision + 1) {
        fail("ATOMIC_UPDATE_FAILED", "The recovery update did not advance the runtime revision exactly once.");
      }
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    transactionStarted = false;

    return {
      ok: true,
      mode,
      applied: mode === "apply",
      runtime: {
        identity: runtimeIdentityFingerprint,
        stateTable,
        stateKey,
        expectedRevision,
        lockedRevision: currentRevision,
        resultingRevision,
        wouldBecomeRevision: mode === "validate-only" ? currentRevision + 1 : resultingRevision,
      },
      recovery: {
        actorUserId: options.actorUserId,
        targetUserId: options.targetUserId,
        reason: options.reason,
        recoveredAt: prepared.recoveredAt,
        revokedSessions: prepared.revokedSessions,
        auditAction: prepared.auditLog.action,
      },
    };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  }
}

function parseCli(args, env) {
  if (args.some((arg) => arg === "--password" || arg.startsWith("--password="))) {
    fail("PASSWORD_CLI_FORBIDDEN", "Recovery passwords must be provided only through FINAL_JUDO_RECOVERY_PASSWORD.");
  }
  if (args.some((arg) => arg === "--postgres-url" || arg.startsWith("--postgres-url="))) {
    fail("DATABASE_URL_CLI_FORBIDDEN", "Database secrets must be provided through environment variables, never CLI arguments.");
  }

  const flags = new Set(args.filter((arg) => !arg.includes("=")));
  const allowedFlags = new Set(["--apply", "--validate-only", approvalFlag]);
  for (const flag of flags) {
    if (!allowedFlags.has(flag)) {
      fail("INVALID_RECOVERY_ARGUMENT", `Unsupported argument: ${flag}`);
    }
  }
  if (flags.has("--apply") && flags.has("--validate-only")) {
    fail("INVALID_RECOVERY_MODE", "Choose either --apply or --validate-only, not both.");
  }

  const allowedValues = new Set([
    "--actor-user-id",
    "--target-user-id",
    "--reason",
    "--expected-revision",
    "--expected-runtime-identity",
    "--state-key",
    "--table",
  ]);
  const values = new Map();

  for (const arg of args.filter((candidate) => candidate.includes("="))) {
    const separator = arg.indexOf("=");
    const name = arg.slice(0, separator);
    const value = arg.slice(separator + 1);

    if (!allowedValues.has(name) || !value) {
      fail("INVALID_RECOVERY_ARGUMENT", `Unsupported or incomplete argument: ${name}`);
    }
    values.set(name, value);
  }

  return validateAdminCredentialRecoveryRequest({
    actorUserId: values.get("--actor-user-id") ?? env.FINAL_JUDO_RECOVERY_ACTOR_USER_ID,
    targetUserId: values.get("--target-user-id") ?? env.FINAL_JUDO_RECOVERY_TARGET_USER_ID,
    reason: values.get("--reason") ?? env.FINAL_JUDO_RECOVERY_REASON,
    password: env.FINAL_JUDO_RECOVERY_PASSWORD,
    expectedRevision: values.get("--expected-revision") ?? env.FINAL_JUDO_EXPECTED_RUNTIME_REVISION,
    expectedRuntimeIdentity:
      values.get("--expected-runtime-identity") ?? env.FINAL_JUDO_EXPECTED_RUNTIME_IDENTITY,
    expectedInstallationId: env.FINAL_JUDO_INSTALLATION_ID?.trim(),
    stateKey: values.get("--state-key") ?? env.FINAL_JUDO_POSTGRES_STATE_KEY ?? defaultStateKey,
    stateTable: values.get("--table") ?? env.FINAL_JUDO_POSTGRES_TABLE ?? defaultStateTable,
    mode: flags.has("--apply") ? "apply" : "validate-only",
    approved: flags.has(approvalFlag),
  });
}

async function main() {
  let pool;

  try {
    const options = parseCli(process.argv.slice(2), process.env);
    const connectionString = process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL;
    const connectionIdentity = parsePostgresConnectionIdentity(connectionString);
    const { Pool } = await import("pg");
    pool = new Pool({
      application_name: "final-judo-admin-credential-recovery",
      connectionString,
      max: 1,
    });
    const client = await pool.connect();

    try {
      const report = await recoverAdminCredential({ client, connectionIdentity, ...options });
      console.log(JSON.stringify(report, null, 2));
    } finally {
      client.release();
    }
  } catch (error) {
    const knownError = error instanceof AdminCredentialRecoveryError;
    console.error(JSON.stringify({
      ok: false,
      code: knownError ? error.code : "ADMIN_CREDENTIAL_RECOVERY_FAILED",
      message: knownError
        ? error.message
        : "Administrator credential recovery failed without exposing secrets or connection details.",
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
