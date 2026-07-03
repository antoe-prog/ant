import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { pilotReadinessDefinitions, prePilotReadinessIds } = await import("../src/lib/pilot-readiness.ts");

const args = process.argv.slice(2);
const explicitDriver = argValue("--driver", null);
const driver = explicitDriver ?? (process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");

function argValue(name, fallback) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

function csvCell(value) {
  const stringValue = value == null ? "" : String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

async function readRuntimeChecks(runtimePath) {
  try {
    const runtime = JSON.parse(await readFile(path.resolve(runtimePath), "utf8"));
    return new Map((runtime.pilotReadinessChecks ?? []).map((check) => [check.id, check]));
  } catch {
    return new Map();
  }
}

function assertSafeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }

  return value;
}

async function readPostgresRuntimeChecks({ postgresUrl, stateKey, table }) {
  if (!postgresUrl) {
    throw new Error("PostgreSQL readiness evidence draft requires --postgres-url, FINAL_JUDO_POSTGRES_URL, or DATABASE_URL.");
  }

  const tableName = assertSafeIdentifier(table);
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: postgresUrl, max: 1 });

  try {
    const result = await pool.query(`SELECT data FROM ${tableName} WHERE key = $1`, [stateKey]);
    const db = result.rows[0]?.data;

    if (!db) {
      throw new Error(`Runtime state row not found: ${tableName}.${stateKey}`);
    }

    return new Map((db.pilotReadinessChecks ?? []).map((check) => [check.id, check]));
  } finally {
    await pool.end();
  }
}

async function readRuntimeChecksForDriver(runtimePath) {
  if (driver === "json") {
    return readRuntimeChecks(runtimePath);
  }

  if (driver !== "postgres") {
    throw new Error("--driver must be json or postgres.");
  }

  return readPostgresRuntimeChecks({
    postgresUrl: argValue("--postgres-url", process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL ?? null),
    stateKey: argValue("--state-key", process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp"),
    table: argValue("--table", process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state"),
  });
}

function definitionsForPhase(phase) {
  if (phase === "pre-pilot") {
    return pilotReadinessDefinitions.filter((definition) => prePilotReadinessIds.includes(definition.id));
  }

  if (phase === "post-pilot" || phase === "all") {
    return pilotReadinessDefinitions;
  }

  throw new Error("--phase must be pre-pilot, post-pilot, or all.");
}

async function main() {
  const phase = argValue("--phase", "all");
  const outPath = path.resolve(argValue("--out", ".data/pilot-readiness-evidence.csv"));
  const runtimePath = argValue("--runtime", ".data/final-judo-db.json");
  const runtimeChecks = await readRuntimeChecksForDriver(runtimePath);
  const headers = ["id", "category", "label", "owner", "status", "evidence", "checkedAt", "notes"];
  const rows = definitionsForPhase(phase).map((definition) => {
    const runtimeCheck = runtimeChecks.get(definition.id);

    return [
      definition.id,
      definition.category,
      definition.label,
      runtimeCheck?.owner ?? definition.owner,
      runtimeCheck?.status ?? "pending",
      runtimeCheck?.evidence ?? "",
      runtimeCheck?.checkedAt ?? "",
      "TODO: verified/blocked 상태일 때 증빙 링크, 회의록, 캡처, 실행 결과를 남긴다.",
    ];
  });
  const body = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${body}\n`, "utf8");
  process.stdout.write(`${body}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
