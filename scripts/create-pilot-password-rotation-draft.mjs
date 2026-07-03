import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPasswordRotationRecord,
  emailUsers,
  readPasswordRotationRuntimeSource,
  serializePasswordRotationCsv,
} from "./pilot-password-rotation-utils.mjs";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

async function main() {
  const runtimePath = path.resolve(argValue("--runtime", ".data/final-judo-db.json"));
  const outPath = path.resolve(argValue("--out", ".data/pilot-password-rotation.csv"));
  const explicitDriver = argValue("--driver", null);
  const driver = explicitDriver ?? (process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");
  const { db } = await readPasswordRotationRuntimeSource({
    driver,
    runtimePath,
    postgresUrl: argValue("--postgres-url", process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL ?? null),
    stateKey: argValue("--state-key", process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp"),
    table: argValue("--table", process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state"),
  });
  const records = emailUsers(db).map((user) => createPasswordRotationRecord(user, db));
  const csv = serializePasswordRotationCsv(records);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, csv, "utf8");
  process.stdout.write(csv);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
