import { readFile } from "node:fs/promises";
import path from "node:path";

const { createJsonStore } = await import("../src/server/json-store.ts");
const { createPostgresJsonStore } = await import("../src/server/postgres-store.ts");
const {
  assertNoNewRuntimeStateIntegrityIssues,
  reconcileRuntimeStateIntegrity,
  validateRuntimeStateIntegrity,
} = await import("../src/server/runtime-state-integrity.ts");

const args = process.argv.slice(2);
const write = args.includes("--write");
const driver = args.find((arg) => arg.startsWith("--driver="))?.slice("--driver=".length) ?? "json";
const fileArg = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length);
const postgresUrl = args.find((arg) => arg.startsWith("--postgres-url="))?.slice("--postgres-url=".length)
  ?? process.env.FINAL_JUDO_POSTGRES_URL
  ?? process.env.DATABASE_URL;
const stateKey = args.find((arg) => arg.startsWith("--state-key="))?.slice("--state-key=".length) ?? "mvp";
const tableName = args.find((arg) => arg.startsWith("--table="))?.slice("--table=".length) ?? "app_runtime_state";
const actorUserId = args.find((arg) => arg.startsWith("--actor-user-id="))?.slice("--actor-user-id=".length);

if (driver !== "json" && driver !== "postgres") {
  throw new Error(`Unsupported runtime driver: ${driver}`);
}
if (driver === "json" && !fileArg) {
  throw new Error("JSON reconciliation requires an explicit runtime file: --file=/path/to/final-judo-db.json");
}
if (driver === "postgres" && !postgresUrl) {
  throw new Error("PostgreSQL reconciliation requires --postgres-url or FINAL_JUDO_POSTGRES_URL/DATABASE_URL.");
}
if (!actorUserId) {
  throw new Error("Reconciliation requires an existing admin audit actor: --actor-user-id=<admin-user-id>");
}
if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) {
  throw new Error(`Unsafe PostgreSQL table name: ${tableName}`);
}

function validate(value) {
  return validateRuntimeStateIntegrity(value);
}

function validateWrite(next, previous) {
  return assertNoNewRuntimeStateIntegrityIssues(previous, next);
}

function createMissingStateError() {
  throw new Error("Runtime state does not exist; reconciliation never creates a default database.");
}

async function readPostgresSnapshot() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: postgresUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const result = await client.query(`SELECT data FROM ${tableName} WHERE key = $1`, [stateKey]);
      await client.query("ROLLBACK");
      if (!result.rowCount || !result.rows[0]) {
        throw new Error(`Runtime state row not found: ${tableName}.${stateKey}`);
      }
      return validate(result.rows[0].data);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function readSnapshot() {
  if (driver === "postgres") {
    return readPostgresSnapshot();
  }
  return validate(JSON.parse(await readFile(path.resolve(fileArg), "utf8")));
}

function createStore() {
  if (driver === "postgres") {
    return createPostgresJsonStore({
      connectionString: postgresUrl,
      key: stateKey,
      tableName,
      createDefault: createMissingStateError,
      validate,
      validateWrite,
    });
  }
  const file = path.resolve(fileArg);
  return createJsonStore({
    directory: path.dirname(file),
    fileName: path.basename(file),
    createDefault: createMissingStateError,
    validate,
    validateWrite,
    backupLimit: 20,
  });
}

function summarize(values, key) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => counts.set(value[key], (counts.get(value[key]) ?? 0) + 1), new Map())]
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

let reconciliation;
if (write) {
  const store = createStore();
  try {
    reconciliation = await store.withLock("runtime-integrity-reconcile", async () => {
      const current = await store.read();
      const result = reconcileRuntimeStateIntegrity(current, { actorUserId });
      if (result.repairs.length > 0) {
        result.db = await store.write(result.db);
      }
      return result;
    });
  } finally {
    if ("close" in store) {
      await store.close();
    }
  }
} else {
  reconciliation = reconcileRuntimeStateIntegrity(await readSnapshot(), { actorUserId });
}

const remainingBlockers = reconciliation.unresolvedIssues.filter((issue) => issue.severity === "blocker");
const report = {
  ok: remainingBlockers.length === 0,
  generatedAt: new Date().toISOString(),
  mode: write ? "write" : "dry-run",
  driver,
  sourceModified: write && reconciliation.repairs.length > 0,
  counts: {
    detectedIssues: reconciliation.issues.length,
    repairs: reconciliation.repairs.length,
    remainingIssues: reconciliation.unresolvedIssues.length,
    remainingBlockers: remainingBlockers.length,
  },
  detectedIssueSummary: summarize(reconciliation.issues, "rule"),
  repairSummary: summarize(reconciliation.repairs, "rule"),
  remainingIssueSummary: summarize(reconciliation.unresolvedIssues, "rule"),
  checked: [
    "dry-run is the default",
    "explicit --write required for persistence",
    "same-store lock and optimistic revision protection",
    "one system.integrity.repair audit record per persisted repair",
    "attendance and payment history are never deleted",
    "aggregate-only output without record identifiers or personal data",
  ],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) {
  process.exitCode = 1;
}
