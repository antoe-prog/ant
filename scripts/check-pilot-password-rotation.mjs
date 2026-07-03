import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  addPasswordRotationIssue,
  readPasswordRotationRuntimeSource,
  validatePasswordRotationCsv,
} from "./pilot-password-rotation-utils.mjs";

const args = process.argv.slice(2);
const allowPending = args.includes("--allow-pending");

function argValue(name, fallback) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

async function main() {
  const filePath = path.resolve(argValue("--file", ".data/pilot-password-rotation.csv"));
  const runtimePath = path.resolve(argValue("--runtime", ".data/final-judo-db.json"));
  const explicitDriver = argValue("--driver", null);
  const driver = explicitDriver ?? (process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");
  const postgresUrl = argValue("--postgres-url", process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL ?? null);
  const postgresStateKey = argValue("--state-key", process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp");
  const postgresTable = argValue("--table", process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state");
  const blockers = [];
  let csv = "";
  let db = null;
  let runtime = driver === "postgres" ? { driver, stateKey: postgresStateKey, table: postgresTable } : { driver, file: runtimePath };

  try {
    csv = await readFile(filePath, "utf8");
  } catch (error) {
    addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_CSV_UNREADABLE", "password rotation CSV could not be read.", {
      file: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const source = await readPasswordRotationRuntimeSource({
      driver,
      runtimePath,
      postgresUrl,
      stateKey: postgresStateKey,
      table: postgresTable,
    });
    db = source.db;
    runtime = source.runtime;
  } catch (error) {
    addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_RUNTIME_UNREADABLE", "runtime DB could not be read.", {
      runtime,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const validation = db
    ? validatePasswordRotationCsv(csv, db, { allowPending, filePath })
    : {
        ok: false,
        file: filePath,
        users: 0,
        statusCounts: {},
        blockers: [],
        checked: [],
      };
  const result = {
    ok: blockers.length === 0 && validation.ok,
    file: filePath,
    runtime,
    allowPending,
    users: validation.users,
    statusCounts: validation.statusCounts,
    blockers: [...blockers, ...validation.blockers],
    checked: validation.checked,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (result.blockers.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
