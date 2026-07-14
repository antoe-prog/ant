import { createHash, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const defaultStateTable = "app_runtime_state";
const defaultStateKey = "mvp";
const defaultPilotPassword = "FinalJudoPilot!2026";
const legacyDefaultPilotPasswordHash =
  "pbkdf2_sha256$120000$final-judo-mvp-pilot$135f6e2970d7f8641323bed2c55add3696cc473e1b9d21ab286077be22ed7cf0";
const safeIdentifierPattern = /^[a-z_][a-z0-9_]*$/;
const installationIdPattern = /^[a-z0-9][a-z0-9._-]{7,127}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const requiredCollections = [
  "branches",
  "users",
  "members",
  "classes",
  "attendance",
  "payments",
  "notices",
  "authSessions",
  "auditLogs",
];

export const defaultMinimumProductionCounts = Object.freeze({
  activeBranches: 1,
  users: 1,
  members: 1,
  classes: 1,
});

function fail(message) {
  throw new Error(message);
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail(`${label} must be a positive integer.`);
  }

  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

export function parsePostgresConnectionIdentity(connectionString) {
  if (!connectionString) {
    fail("FINAL_JUDO_POSTGRES_URL or DATABASE_URL is required.");
  }

  let url;

  try {
    url = new URL(connectionString);
  } catch {
    fail("The PostgreSQL connection URL is invalid.");
  }

  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    fail("The database URL must use the postgres or postgresql scheme.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const databaseUser = decodeURIComponent(url.username);

  if (!url.hostname || !databaseName || !databaseUser) {
    fail("The PostgreSQL connection URL must identify a host, database, and user.");
  }

  return {
    databaseName,
    databaseUser,
    host: url.hostname.toLowerCase(),
    port: url.port ? parsePositiveInteger(url.port, "PostgreSQL port") : 5432,
  };
}

function parseEncodedPasswordHash(storedHash) {
  if (typeof storedHash !== "string") {
    return null;
  }

  const [algorithm, iterationsText, salt, encodedHash, ...remainder] = storedHash.split("$");
  const iterations = Number(iterationsText);

  if (
    remainder.length > 0 ||
    algorithm !== "pbkdf2_sha256" ||
    !Number.isSafeInteger(iterations) ||
    iterations <= 0 ||
    iterations > 1_000_000 ||
    !salt ||
    !/^[a-f0-9]{64}$/i.test(encodedHash ?? "")
  ) {
    return null;
  }

  return { iterations, salt, encodedHash };
}

function verifyEncodedPassword(password, storedHash) {
  const parsed = parseEncodedPasswordHash(storedHash);

  if (!parsed) {
    return false;
  }

  const expected = Buffer.from(parsed.encodedHash, "hex");
  const actual = pbkdf2Sync(password, parsed.salt, parsed.iterations, expected.length, "sha256");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hasSharedDefaultPassword(user) {
  return user?.passwordHash === legacyDefaultPilotPasswordHash ||
    verifyEncodedPassword(defaultPilotPassword, user?.passwordHash);
}

function sortedIds(value) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item?.id === "string" ? item.id : ""))
        .filter(Boolean)
        .sort()
    : [];
}

export function createMinimumDataFingerprint(db) {
  const basis = Object.fromEntries(
    ["branches", "users", "members", "classes", "attendance", "payments", "notices"]
      .map((collection) => [collection, {
        count: Array.isArray(db?.[collection]) ? db[collection].length : 0,
        ids: sortedIds(db?.[collection]),
      }]),
  );
  const value = createHash("sha256").update(JSON.stringify(basis)).digest("hex");

  return {
    algorithm: "sha256",
    value,
    collections: Object.keys(basis),
  };
}

export function createRuntimeIdentityFingerprint(identity) {
  const canonicalIdentity = {
    databaseName: identity.databaseName,
    databaseUser: identity.databaseUser,
    host: identity.host,
    port: identity.port,
    installationId: identity.installationId ?? null,
    stateTable: identity.stateTable,
    stateKey: identity.stateKey,
  };

  return createHash("sha256").update(JSON.stringify(canonicalIdentity)).digest("hex");
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addCheck(checks, blockers, code, ok, message, detail) {
  const check = { code, ok, message, ...(detail === undefined ? {} : { detail }) };
  checks.push(check);

  if (!ok) {
    blockers.push({ code, message, ...(detail === undefined ? {} : { detail }) });
  }
}

function normalizeMinimumCounts(minimumCounts = {}) {
  return Object.fromEntries(
    Object.entries(defaultMinimumProductionCounts).map(([key, fallback]) => [
      key,
      minimumCounts[key] === undefined
        ? fallback
        : parseNonNegativeInteger(minimumCounts[key], `minimum ${key}`),
    ]),
  );
}

export function assessLiveProductionRuntime({
  connectionIdentity,
  databaseIdentity,
  stateRow,
  stateTable = defaultStateTable,
  stateKey = defaultStateKey,
  expectedInstallationId,
  expectedRuntimeIdentity,
  expectedDataFingerprint,
  expectedRevision,
  minimumCounts,
  checkedAt = new Date(),
}) {
  const checks = [];
  const blockers = [];
  const minimums = normalizeMinimumCounts(minimumCounts);
  const rowRevision = stateRow ? Number(stateRow.revision) : null;
  const db = stateRow?.data;
  const identity = {
    databaseName: databaseIdentity?.database_name ?? null,
    databaseUser: databaseIdentity?.database_user ?? null,
    host: connectionIdentity.host,
    port: connectionIdentity.port,
    stateTable,
    stateKey,
  };
  const identityFingerprint = identity.databaseName && identity.databaseUser
    ? createRuntimeIdentityFingerprint({
        ...identity,
        installationId: stateRow?.installation_id ?? null,
      })
    : null;
  const minimumDataFingerprint = createMinimumDataFingerprint(db);

  addCheck(
    checks,
    blockers,
    "READ_ONLY_TRANSACTION",
    databaseIdentity?.transaction_read_only === "on",
    "The live inspection transaction must be read-only.",
  );
  addCheck(
    checks,
    blockers,
    "DATABASE_IDENTITY_MATCH",
    databaseIdentity?.database_name === connectionIdentity.databaseName &&
      databaseIdentity?.database_user === connectionIdentity.databaseUser,
    "The connected database and user must match the configured runtime URL.",
  );
  addCheck(
    checks,
    blockers,
    "INSTALLATION_IDENTITY_MATCH",
    typeof stateRow?.installation_id === "string" && stateRow.installation_id === expectedInstallationId,
    "The runtime state installation identity must match the configured production identity.",
  );
  addCheck(
    checks,
    blockers,
    "EXPECTED_RUNTIME_IDENTITY_MATCH",
    !expectedRuntimeIdentity || identityFingerprint === expectedRuntimeIdentity.toLowerCase(),
    "The live runtime identity fingerprint must match the approved identity.",
  );
  addCheck(
    checks,
    blockers,
    "RUNTIME_STATE_ROW_PRESENT",
    Boolean(stateRow),
    "The production runtime state row must exist.",
  );
  addCheck(
    checks,
    blockers,
    "RUNTIME_REVISION_VALID",
    Number.isSafeInteger(rowRevision) && rowRevision > 0,
    "The production runtime revision must be a positive integer.",
  );
  addCheck(
    checks,
    blockers,
    "EXPECTED_REVISION_MATCH",
    expectedRevision === undefined || rowRevision === expectedRevision,
    "The production runtime revision must match the expected revision.",
    expectedRevision === undefined ? undefined : { expected: expectedRevision, actual: rowRevision },
  );

  const missingCollections = requiredCollections.filter((collection) => !Array.isArray(db?.[collection]));
  addCheck(
    checks,
    blockers,
    "RUNTIME_STATE_SHAPE",
    missingCollections.length === 0,
    "The runtime state must contain the required collections.",
    missingCollections.length === 0 ? undefined : { missingCollections },
  );

  const counts = {
    branches: Array.isArray(db?.branches) ? db.branches.length : 0,
    activeBranches: Array.isArray(db?.branches)
      ? db.branches.filter((branch) => (branch?.status ?? "active") === "active").length
      : 0,
    users: Array.isArray(db?.users) ? db.users.length : 0,
    members: Array.isArray(db?.members) ? db.members.length : 0,
    classes: Array.isArray(db?.classes) ? db.classes.length : 0,
    attendance: Array.isArray(db?.attendance) ? db.attendance.length : 0,
    payments: Array.isArray(db?.payments) ? db.payments.length : 0,
    notices: Array.isArray(db?.notices) ? db.notices.length : 0,
    authSessions: Array.isArray(db?.authSessions) ? db.authSessions.length : 0,
    auditLogs: Array.isArray(db?.auditLogs) ? db.auditLogs.length : 0,
  };
  const countFailures = Object.entries(minimums)
    .filter(([key, minimum]) => counts[key] < minimum)
    .map(([collection, minimum]) => ({ collection, minimum, actual: counts[collection] }));

  addCheck(
    checks,
    blockers,
    "MINIMUM_DATA_COUNTS",
    countFailures.length === 0,
    "The live runtime must meet the approved minimum data counts.",
    countFailures.length === 0 ? { minimums } : { failures: countFailures },
  );
  addCheck(
    checks,
    blockers,
    "EXPECTED_DATA_FINGERPRINT_MATCH",
    !expectedDataFingerprint || minimumDataFingerprint.value === expectedDataFingerprint.toLowerCase(),
    "The minimum live data fingerprint must match the approved fingerprint.",
  );

  const acceptedAdmins = Array.isArray(db?.users)
    ? db.users.filter((user) => user?.role === "admin" && user?.invitationStatus !== "pending")
    : [];
  const credentialedAdmins = acceptedAdmins.filter(
    (user) => Boolean(parseEncodedPasswordHash(user.passwordHash)),
  );
  addCheck(
    checks,
    blockers,
    "REQUIRED_ADMIN_PRESENT",
    credentialedAdmins.length > 0,
    "At least one accepted administrator with a stored credential is required.",
    { acceptedAdmins: acceptedAdmins.length, credentialedAdmins: credentialedAdmins.length },
  );

  const sharedPasswordUsers = Array.isArray(db?.users)
    ? db.users.filter((user) => user?.invitationStatus !== "pending" && hasSharedDefaultPassword(user))
    : [];
  addCheck(
    checks,
    blockers,
    "SHARED_DEFAULT_PASSWORD_RETIRED",
    sharedPasswordUsers.length === 0,
    "No accepted account may retain the retired shared default password.",
    { matchingAccounts: sharedPasswordUsers.length },
  );

  return {
    ok: blockers.length === 0,
    checkedAt: checkedAt.toISOString(),
    runtime: {
      identity: {
        ...identity,
        installationIdentityVerified:
          typeof stateRow?.installation_id === "string" && stateRow.installation_id === expectedInstallationId,
        fingerprint: identityFingerprint,
      },
      state: {
        revision: rowRevision,
        updatedAt: toIsoString(stateRow?.updated_at),
      },
    },
    counts,
    minimumDataFingerprint,
    checks,
    blockers,
  };
}

export async function inspectLiveProductionRuntime({
  client,
  connectionIdentity,
  stateTable = defaultStateTable,
  stateKey = defaultStateKey,
  expectedInstallationId,
  expectedRuntimeIdentity,
  expectedDataFingerprint,
  expectedRevision,
  minimumCounts,
  checkedAt,
  statementTimeoutMs = 15_000,
}) {
  if (!safeIdentifierPattern.test(stateTable)) {
    fail("The runtime state table is not a safe PostgreSQL identifier.");
  }
  if (!stateKey || stateKey.length > 128) {
    fail("The runtime state key must contain 1 to 128 characters.");
  }
  if (!installationIdPattern.test(expectedInstallationId ?? "")) {
    fail("A valid expected production installation identity is required.");
  }
  if (expectedRuntimeIdentity && !sha256Pattern.test(expectedRuntimeIdentity)) {
    fail("The expected runtime identity must be a SHA-256 fingerprint.");
  }
  if (expectedDataFingerprint && !sha256Pattern.test(expectedDataFingerprint)) {
    fail("The expected data fingerprint must be a SHA-256 fingerprint.");
  }
  if (expectedRevision !== undefined) {
    expectedRevision = parsePositiveInteger(expectedRevision, "expected revision");
  }

  let transactionStarted = false;

  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionStarted = true;
    await client.query("SELECT set_config('statement_timeout', $1, true)", [String(statementTimeoutMs)]);
    const identityResult = await client.query(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_setting('transaction_read_only') AS transaction_read_only
    `);
    const stateResult = await client.query(
      `SELECT data, revision, installation_id, updated_at FROM ${stateTable} WHERE key = $1`,
      [stateKey],
    );
    await client.query("COMMIT");
    transactionStarted = false;

    return assessLiveProductionRuntime({
      connectionIdentity,
      databaseIdentity: identityResult.rows[0],
      stateRow: stateResult.rows[0] ?? null,
      stateTable,
      stateKey,
      expectedInstallationId,
      expectedRuntimeIdentity,
      expectedDataFingerprint,
      expectedRevision,
      minimumCounts,
      checkedAt,
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  }
}

function parseCli(args, env) {
  if (args.some((arg) => arg === "--postgres-url" || arg.startsWith("--postgres-url="))) {
    fail("Database secrets must be provided through FINAL_JUDO_POSTGRES_URL or DATABASE_URL, never CLI arguments.");
  }

  const allowedValueArguments = new Set([
    "--expected-runtime-identity",
    "--expected-data-fingerprint",
    "--expected-revision",
    "--min-active-branches",
    "--min-users",
    "--min-members",
    "--min-classes",
    "--state-key",
    "--table",
  ]);
  const values = new Map();

  for (const arg of args) {
    const separator = arg.indexOf("=");
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const value = separator === -1 ? undefined : arg.slice(separator + 1);

    if (!allowedValueArguments.has(name) || value === undefined || value === "") {
      fail(`Unsupported or incomplete argument: ${name}`);
    }
    values.set(name, value);
  }

  const expectedRevisionValue = values.get("--expected-revision") ?? env.FINAL_JUDO_EXPECTED_RUNTIME_REVISION;
  const expectedInstallationId = env.FINAL_JUDO_INSTALLATION_ID?.trim();

  if (!installationIdPattern.test(expectedInstallationId ?? "")) {
    fail("FINAL_JUDO_INSTALLATION_ID must contain the approved production installation identity.");
  }

  return {
    connectionString: env.FINAL_JUDO_POSTGRES_URL ?? env.DATABASE_URL,
    expectedInstallationId,
    expectedRuntimeIdentity:
      values.get("--expected-runtime-identity") ?? env.FINAL_JUDO_EXPECTED_RUNTIME_IDENTITY,
    expectedDataFingerprint:
      values.get("--expected-data-fingerprint") ?? env.FINAL_JUDO_EXPECTED_DATA_FINGERPRINT,
    expectedRevision: expectedRevisionValue === undefined
      ? undefined
      : parsePositiveInteger(expectedRevisionValue, "expected revision"),
    stateKey: values.get("--state-key") ?? env.FINAL_JUDO_POSTGRES_STATE_KEY ?? defaultStateKey,
    stateTable: values.get("--table") ?? env.FINAL_JUDO_POSTGRES_TABLE ?? defaultStateTable,
    minimumCounts: {
      activeBranches: parseNonNegativeInteger(
        values.get("--min-active-branches") ?? env.FINAL_JUDO_MIN_ACTIVE_BRANCHES ?? 1,
        "minimum active branches",
      ),
      users: parseNonNegativeInteger(values.get("--min-users") ?? env.FINAL_JUDO_MIN_USERS ?? 1, "minimum users"),
      members: parseNonNegativeInteger(values.get("--min-members") ?? env.FINAL_JUDO_MIN_MEMBERS ?? 1, "minimum members"),
      classes: parseNonNegativeInteger(values.get("--min-classes") ?? env.FINAL_JUDO_MIN_CLASSES ?? 1, "minimum classes"),
    },
  };
}

async function main() {
  let pool;

  try {
    const options = parseCli(process.argv.slice(2), process.env);
    const connectionIdentity = parsePostgresConnectionIdentity(options.connectionString);
    const { Pool } = await import("pg");
    pool = new Pool({
      application_name: "final-judo-live-production-preflight",
      connectionString: options.connectionString,
      max: 1,
    });
    const client = await pool.connect();

    try {
      const report = await inspectLiveProductionRuntime({
        client,
        connectionIdentity,
        ...options,
      });
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.ok ? 0 : 1;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: "LIVE_PRODUCTION_PREFLIGHT_FAILED",
      message: error instanceof Error && error.message.startsWith("Database secrets must")
        ? error.message
        : "Live production runtime inspection failed without exposing connection details.",
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
