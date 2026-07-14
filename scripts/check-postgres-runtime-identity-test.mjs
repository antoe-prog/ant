import assert from "node:assert/strict";
import { Pool } from "pg";
import { createPostgresJsonStore } from "../src/server/postgres-store.ts";

const originalPoolMethods = {
  connect: Pool.prototype.connect,
  end: Pool.prototype.end,
  query: Pool.prototype.query,
};

let activeDatabase = null;

function result(rows = []) {
  return { command: "", fields: [], oid: 0, rowCount: rows.length, rows };
}

function createFakeDatabase({ row = null, schemaAvailable = true, tableAvailable = true } = {}) {
  return {
    ddlCount: 0,
    insertCount: 0,
    queryLog: [],
    row: row ? { ...row } : null,
    schemaAvailable,
    tableAvailable,
    async query(text, values = []) {
      const sql = text.replaceAll(/\s+/g, " ").trim();
      this.queryLog.push(sql);

      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes("pg_advisory_xact_lock")) {
        return result();
      }

      if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) {
        this.ddlCount += 1;
        this.tableAvailable = true;
        this.schemaAvailable = true;
        return result();
      }

      if (sql === "SELECT installation_id FROM app_runtime_state LIMIT 0") {
        if (!this.tableAvailable || !this.schemaAvailable) {
          throw new Error("database schema unavailable");
        }
        return result();
      }

      if (!this.tableAvailable) {
        throw new Error("database table unavailable");
      }

      if (sql.startsWith("SELECT") && sql.includes("FROM app_runtime_state") && sql.includes("WHERE key = $1")) {
        if (!this.schemaAvailable && sql.includes("installation_id")) {
          throw new Error("database identity column unavailable");
        }
        return result(this.row && this.row.key === values[0] ? [{ ...this.row }] : []);
      }

      if (sql.startsWith("UPDATE app_runtime_state")) {
        assert(this.row && this.row.key === values[0], "fake update requires an existing row");
        this.row.data = JSON.parse(values[1]);
        this.row.revision = String(Number(this.row.revision) + 1);
        this.row.updated_at = new Date("2026-07-15T00:00:00.000Z");
        return result([{ data: this.row.data, revision: this.row.revision }]);
      }

      if (sql.startsWith("INSERT INTO app_runtime_state")) {
        this.insertCount += 1;
        this.row = {
          key: values[0],
          data: JSON.parse(values[1]),
          revision: "1",
          installation_id: values[2],
          updated_at: new Date("2026-07-15T00:00:00.000Z"),
        };
        return result([{ data: this.row.data, revision: this.row.revision }]);
      }

      throw new Error(`Unexpected fake PostgreSQL query: ${sql}`);
    },
  };
}

Pool.prototype.query = function query(text, values) {
  assert(activeDatabase, "fake PostgreSQL database must be active");
  return activeDatabase.query(text, values);
};

Pool.prototype.connect = async function connect() {
  assert(activeDatabase, "fake PostgreSQL database must be active");
  const database = activeDatabase;
  return {
    query: (text, values) => database.query(text, values),
    release() {},
  };
};

Pool.prototype.end = async function end() {};

function createStore(overrides = {}) {
  return createPostgresJsonStore({
    connectionString: "postgresql://runtime:secret-value@db.internal:5432/final_judo?sslpassword=query-secret-value",
    key: "mvp",
    tableName: "app_runtime_state",
    createDefault: () => ({ value: "seeded" }),
    ...overrides,
  });
}

async function assertRejectsWithoutSensitiveValues(operation, pattern, sensitiveValues) {
  await assert.rejects(operation, (error) => {
    assert.match(error.message, pattern);
    for (const value of sensitiveValues) {
      assert(!error.message.includes(value), "runtime identity failures must not expose configured or database values");
    }
    return true;
  });
}

try {
  activeDatabase = createFakeDatabase({ schemaAvailable: false, tableAvailable: false });
  let createDefaultCalls = 0;
  const missingSchemaStore = createStore({
    expectedInstallationId: "final-judo-production-01",
    requireExistingState: true,
    createDefault: () => {
      createDefaultCalls += 1;
      return { value: "must-not-seed" };
    },
  });

  await assertRejectsWithoutSensitiveValues(
    () => missingSchemaStore.read(),
    /identity schema is unavailable/,
    ["final-judo-production-01", "secret-value"],
  );
  assert.equal(createDefaultCalls, 0);
  assert.equal(activeDatabase.ddlCount, 0, "production must not create a missing runtime table");
  await missingSchemaStore.close();

  activeDatabase = createFakeDatabase();
  createDefaultCalls = 0;
  const missingRowStore = createStore({
    expectedInstallationId: "final-judo-production-01",
    requireExistingState: true,
    createDefault: () => {
      createDefaultCalls += 1;
      return { value: "must-not-seed" };
    },
  });

  await assertRejectsWithoutSensitiveValues(
    () => missingRowStore.read(),
    /Required PostgreSQL runtime state is missing/,
    ["final-judo-production-01", "secret-value"],
  );
  await assert.rejects(() => missingRowStore.write({ value: "must-not-insert" }), /runtime state is missing/);
  assert.equal(createDefaultCalls, 0);
  assert.equal(activeDatabase.insertCount, 0, "production must not insert a missing runtime row");
  assert.equal(activeDatabase.ddlCount, 0, "production must not run runtime DDL");
  await missingRowStore.close();

  const expectedInstallationId = "final-judo-production-01";
  const actualInstallationId = "other-production-install-01";
  activeDatabase = createFakeDatabase({
    row: {
      key: "mvp",
      data: { value: "wrong-database" },
      revision: "3",
      installation_id: actualInstallationId,
      updated_at: new Date("2026-07-15T00:00:00.000Z"),
    },
  });
  const wrongIdentityStore = createStore({ expectedInstallationId, requireExistingState: true });

  await assertRejectsWithoutSensitiveValues(
    () => wrongIdentityStore.read(),
    /installation identity mismatch/,
    [expectedInstallationId, actualInstallationId, "secret-value"],
  );
  assert.equal(activeDatabase.insertCount, 0);
  await wrongIdentityStore.close();

  activeDatabase = createFakeDatabase({
    row: {
      key: "mvp",
      data: { value: "persisted" },
      revision: "4",
      installation_id: expectedInstallationId,
      updated_at: new Date("2026-07-15T00:00:00.000Z"),
    },
  });
  createDefaultCalls = 0;
  const matchingIdentityStore = createStore({
    expectedInstallationId,
    requireExistingState: true,
    createDefault: () => {
      createDefaultCalls += 1;
      return { value: "reset" };
    },
  });

  assert.equal((await matchingIdentityStore.read()).value, "persisted");
  const matchingStatus = await matchingIdentityStore.status();
  assert.equal(matchingStatus.revision, 4);
  assert(!matchingStatus.connectionString.includes("secret-value"));
  assert(!matchingStatus.connectionString.includes("query-secret-value"));
  assert.equal(await matchingIdentityStore.withLock("unit-test", async () => "locked"), "locked");
  assert.equal((await matchingIdentityStore.write({ value: "updated" })).value, "updated");
  assert.equal(activeDatabase.row.installation_id, expectedInstallationId, "writes must preserve the bound identity");

  activeDatabase.row = null;
  await assert.rejects(() => matchingIdentityStore.reset(), /runtime state is missing/);
  assert.equal(createDefaultCalls, 0, "production reset must check the row before calling createDefault");
  assert.equal(activeDatabase.insertCount, 0);
  await matchingIdentityStore.close();

  activeDatabase = createFakeDatabase({ schemaAvailable: false, tableAvailable: false });
  createDefaultCalls = 0;
  const localStore = createStore({
    createDefault: () => {
      createDefaultCalls += 1;
      return { value: "local-seed" };
    },
  });

  assert.equal((await localStore.read()).value, "local-seed");
  assert.equal(createDefaultCalls, 1, "local runtime must retain automatic default creation");
  assert.equal(activeDatabase.ddlCount, 1, "local runtime must retain automatic table/schema creation");
  assert.equal(activeDatabase.insertCount, 1, "local runtime must retain automatic row creation");
  assert.equal(activeDatabase.row.installation_id, null);
  await localStore.close();
} finally {
  Pool.prototype.connect = originalPoolMethods.connect;
  Pool.prototype.end = originalPoolMethods.end;
  Pool.prototype.query = originalPoolMethods.query;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "production missing schema does not run DDL",
        "production missing state does not seed or insert",
        "production rejects a different database installation identity without exposing values",
        "production accepts and preserves the matching installation identity",
        "production reset checks required state before createDefault",
        "local runtime retains automatic schema and default state creation",
      ],
    },
    null,
    2,
  ),
);
