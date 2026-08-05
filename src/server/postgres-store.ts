import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type { JsonValidator, JsonWriteValidator } from "./json-store";
import { attachStoreVersion, getStoreVersion } from "./store-version.ts";

export type PostgresJsonStoreOptions<T> = {
  connectionString: string;
  key: string;
  createDefault: () => T;
  expectedInstallationId?: string;
  requireExistingState?: boolean;
  validate?: JsonValidator<T>;
  validateWrite?: JsonWriteValidator<T>;
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
    url.search = "";
    url.hash = "";
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
  const expectedInstallationId = options.expectedInstallationId?.trim() || null;
  const requireExistingState = options.requireExistingState === true;

  if (requireExistingState && !expectedInstallationId) {
    throw new Error("PostgreSQL required-state mode requires an expected installation identity.");
  }

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

  function assertRequiredRuntimeState(row: { installation_id: string | null } | undefined) {
    if (!requireExistingState) {
      return;
    }

    if (!row) {
      throw new Error("Required PostgreSQL runtime state is missing. Restore it before production starts.");
    }

    if (row.installation_id !== expectedInstallationId) {
      throw new Error("PostgreSQL runtime installation identity mismatch.");
    }
  }

  async function ensureStorage() {
    initialized ??= requireExistingState
      ? pool
          .query(`SELECT installation_id FROM ${tableName} LIMIT 0`)
          .then(() => undefined)
          .catch(() => {
            throw new Error("PostgreSQL runtime identity schema is unavailable. Apply the production runtime migration.");
          })
      : pool
          .query(`
            CREATE TABLE IF NOT EXISTS ${tableName} (
              key text PRIMARY KEY,
              data jsonb NOT NULL,
              revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
              installation_id text,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            );
            ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS installation_id text;
          `)
          .then(() => undefined);

    return initialized;
  }

  async function read() {
    await ensureStorage();

    const result = await query<{ data: unknown; revision: string; installation_id: string | null }>(
      `SELECT data, revision, installation_id FROM ${tableName} WHERE key = $1`,
      [options.key],
    );
    const row = result.rows[0];

    assertRequiredRuntimeState(row);

    if (row) {
      return attachStoreVersion(validate(row.data), Number(row.revision));
    }

    return write(options.createDefault());
  }

  async function write(value: T) {
    const version = getStoreVersion(value);
    const requested = validate(value);

    await ensureStorage();

    if (version) {
      return inTransaction(async () => {
        const currentResult = await query<{ data: unknown; revision: string; installation_id: string | null }>(
          `SELECT data, revision, installation_id FROM ${tableName} WHERE key = $1 FOR UPDATE`,
          [options.key],
        );
        const currentRow = currentResult.rows[0];

        assertRequiredRuntimeState(currentRow);

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
        const validatedNext = options.validateWrite ? options.validateWrite(next, latest) : next;
        const result = await query<{ data: unknown; revision: string }>(
          `
            UPDATE ${tableName}
            SET data = $2::jsonb, revision = revision + 1, updated_at = now()
            WHERE key = $1
            RETURNING data, revision;
          `,
          [options.key, JSON.stringify(validatedNext)],
        );

        return attachStoreVersion(validate(result.rows[0]?.data), Number(result.rows[0]?.revision));
      });
    }

    return inTransaction(async () => {
      await query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${tableName}:${options.key}:write`,
      ]);
      const currentResult = await query<{ data: unknown; revision: string; installation_id: string | null }>(
        `SELECT data, revision, installation_id FROM ${tableName} WHERE key = $1 FOR UPDATE`,
        [options.key],
      );
      const currentRow = currentResult.rows[0];

      assertRequiredRuntimeState(currentRow);

      const latest = currentRow ? validate(currentRow.data) : null;
      const next = options.validateWrite ? options.validateWrite(requested, latest) : requested;

      if (currentRow) {
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
      }

      const result = await query<{ data: unknown; revision: string }>(
        `
          INSERT INTO ${tableName} (key, data, revision, installation_id)
          VALUES ($1, $2::jsonb, 1, $3)
          RETURNING data, revision;
        `,
        [options.key, JSON.stringify(next), expectedInstallationId],
      );

      return attachStoreVersion(validate(result.rows[0]?.data), Number(result.rows[0]?.revision));
    });
  }

  async function reset() {
    if (requireExistingState) {
      await ensureStorage();

      return inTransaction(async () => {
        const result = await query<{ installation_id: string | null }>(
          `SELECT installation_id FROM ${tableName} WHERE key = $1 FOR UPDATE`,
          [options.key],
        );

        assertRequiredRuntimeState(result.rows[0]);
        return write(options.createDefault());
      });
    }

    return write(options.createDefault());
  }

  async function status() {
    await ensureStorage();

    const result = await query<{ revision: string; updated_at: Date; installation_id: string | null }>(
      `SELECT revision, updated_at, installation_id FROM ${tableName} WHERE key = $1`,
      [options.key],
    );
    const row = result.rows[0];

    assertRequiredRuntimeState(row);

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
    await ensureStorage();
    const scopedKey = `${tableName}:${options.key}:${key}`;

    // Nested domain locks share one transaction; callers must keep a stable lock order.
    return inTransaction(async () => {
      await query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scopedKey]);
      const result = await query<{ installation_id: string | null }>(
        `SELECT installation_id FROM ${tableName} WHERE key = $1`,
        [options.key],
      );

      assertRequiredRuntimeState(result.rows[0]);
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
