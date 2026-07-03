import { Pool } from "pg";
import type { JsonValidator } from "./json-store";

export type PostgresJsonStoreOptions<T> = {
  connectionString: string;
  key: string;
  createDefault: () => T;
  validate?: JsonValidator<T>;
  tableName?: string;
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

  let initialized: Promise<void> | null = null;

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

    const result = await pool.query<{ data: unknown }>(`SELECT data FROM ${tableName} WHERE key = $1`, [options.key]);

    if (result.rowCount && result.rows[0]) {
      return validate(result.rows[0].data);
    }

    return write(options.createDefault());
  }

  async function write(value: T) {
    const next = validate(value);

    await ensureTable();

    const result = await pool.query<{ data: unknown }>(
      `
        INSERT INTO ${tableName} (key, data, revision)
        VALUES ($1, $2::jsonb, 1)
        ON CONFLICT (key) DO UPDATE
        SET
          data = EXCLUDED.data,
          revision = ${tableName}.revision + 1,
          updated_at = now()
        RETURNING data;
      `,
      [options.key, JSON.stringify(next)],
    );

    return validate(result.rows[0]?.data);
  }

  async function reset() {
    return write(options.createDefault());
  }

  async function status() {
    await ensureTable();

    const result = await pool.query<{ revision: string; updated_at: Date }>(
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

  return {
    read,
    write,
    reset,
    status,
    close,
  };
}
