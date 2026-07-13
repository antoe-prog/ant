import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type { JsonValidator } from "./json-store";
import { attachStoreVersion, getStoreVersion } from "./store-version.ts";

export type PostgresJsonStoreOptions<T> = {
  connectionString: string;
  key: string;
  createDefault: () => T;
  validate?: JsonValidator<T>;
  tableName?: string;
  merge?: (base: T, requested: T, latest: T) => T;
};

function defaultValidate<T>(value: unknown) {
  return value as T;
}

function assertSafeIdentifier(identifier: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }

  return identifier;
}

function redactConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "********";
    }
    return url.toString();
  } catch {
    return "configured";
  }
}

export function createPostgresJsonStore<T>(options: PostgresJsonStoreOptions<T>) {
  const validate = options.validate ?? defaultValidate<T>;
  const tableName = assertSafeIdentifier(options.tableName ?? "app_runtime_state");
  const pool = new Pool({
    connectionString: options.connectionString,
    max: 5,
  });
  const transactionClient = new AsyncLocalStorage<PoolClient>();

  let initialized: Promise<void> | null = null;

  function query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> {
    const client = transactionClient.getStore();

    return client ? client.query<Row>(text, values) : pool.query<Row>(text, values);
  }

  async function inTransaction<Result>(operation: () => Promise<Result>) {
    if (transactionClient.getStore()) {
      return operation();
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await transactionClient.run(client, operation);

      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function ensureTable() {
    initialized ??= pool
      .query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          key text PRIMARY KEY,
          data jsonb NOT NULL,
          revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `)
      .then(() => undefined);

    return initialized;
  }

  async function read() {
    await ensureTable();

    const result = await query<{ data: unknown; revision: string }>(
      `SELECT data, revision FROM ${tableName} WHERE key = $1`,
      [options.key],
    );

    if (result.rowCount && result.rows[0]) {
      return attachStoreVersion(validate(result.rows[0].data), Number(result.rows[0].revision));
    }

    return write(options.createDefault());
  }

  async function write(value: T) {
    const version = getStoreVersion(value);
    const requested = validate(value);

    await ensureTable();

    if (version) {
      return inTransaction(async () => {
        const currentResult = await query<{ data: unknown; revision: string }>(
          `SELECT data, revision FROM ${tableName} WHERE key = $1 FOR UPDATE`,
          [options.key],
        );
        const currentRow = currentResult.rows[0];

        if (!currentRow) {
          throw new Error(`PostgreSQL runtime state ${options.key} was removed during an update.`);
        }

        const currentRevision = Number(currentRow.revision);
        const latest = validate(currentRow.data);
        const next = version.revision === currentRevision
          ? requested
          : options.merge
            ? validate(options.merge(version.baseValue, requested, latest))
            : (() => {
                throw new Error("PostgreSQL runtime state changed before this write completed.");
              })();
        const result = await query<{ data: unknown; revision: string }>(
          `
            UPDATE ${tableName}
            SET data = $2::jsonb, revision = revision + 1, updated_at = now()
            WHERE key = $1
            RETURNING data, revision;
          `,
          [options.key, JSON.stringify(next)],
        );

        return attachStoreVersion(validate(result.rows[0]?.data), Number(result.rows[0]?.revision));
      });
    }

    const result = await query<{ data: unknown; revision: string }>(
      `
        INSERT INTO ${tableName} (key, data, revision)
        VALUES ($1, $2::jsonb, 1)
        ON CONFLICT (key) DO UPDATE
        SET
          data = EXCLUDED.data,
          revision = ${tableName}.revision + 1,
          updated_at = now()
        RETURNING data, revision;
      `,
      [options.key, JSON.stringify(requested)],
    );

    return attachStoreVersion(validate(result.rows[0]?.data), Number(result.rows[0]?.revision));
  }

  async function reset() {
    return write(options.createDefault());
  }

  async function status() {
    await ensureTable();

    const result = await query<{ revision: string; updated_at: Date }>(
      `SELECT revision, updated_at FROM ${tableName} WHERE key = $1`,
      [options.key],
    );
    const row = result.rows[0];

    return {
      tableName,
      key: options.key,
      connectionString: redactConnectionString(options.connectionString),
      revision: row ? Number(row.revision) : 0,
      updatedAt: row?.updated_at?.toISOString() ?? null,
    };
  }

  async function close() {
    await pool.end();
  }

  async function withLock<Result>(key: string, operation: () => Promise<Result>) {
    await ensureTable();

    if (transactionClient.getStore()) {
      throw new Error("Nested PostgreSQL runtime locks are not supported.");
    }

    const scopedKey = `${tableName}:${options.key}:${key}`;

    return inTransaction(async () => {
      await query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scopedKey]);
      return operation();
    });
  }

  return {
    read,
    write,
    reset,
    status,
    close,
    withLock,
  };
}
