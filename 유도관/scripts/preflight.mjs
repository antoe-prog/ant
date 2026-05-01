import "dotenv/config";
import { execSync } from "node:child_process";
import mysql from "mysql2/promise";

const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"];
const REQUIRED_COLUMNS = [
  ["members", "notesUpdatedAt"],
  ["tournaments", "entryFee"],
  ["tournaments", "notice"],
  ["attendance_photos", "imageData"],
];

function run(command) {
  console.log(`\n[preflight] ${command}`);
  execSync(command, { stdio: "inherit", shell: true });
}

async function checkEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
  console.log(`[preflight] env ok: ${REQUIRED_ENV.join(", ")}`);
}

async function checkDatabase() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const [dbRows] = await connection.query("SELECT DATABASE() AS dbName");
  console.log(`[preflight] database ok: ${dbRows[0]?.dbName ?? "(unknown)"}`);

  for (const [table, column] of REQUIRED_COLUMNS) {
    const [rows] = await connection.query(
      `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        LIMIT 1
      `,
      [table, column],
    );
    if (rows.length === 0) {
      throw new Error(`Missing database column: ${table}.${column}`);
    }
  }

  await connection.end();
  console.log("[preflight] database schema ok");
}

async function checkHealth(url, required) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!body?.ok) throw new Error(`health response is not ok: ${JSON.stringify(body)}`);
    console.log(`[preflight] api health ok: ${url}`);
  } catch (error) {
    if (required) throw error;
    console.warn(`[preflight] api health skipped/warn: ${url} (${error.message})`);
  }
}

async function main() {
  await checkEnv();
  await checkDatabase();

  const publicApi = process.env.EXPO_PUBLIC_API_BASE_URL || "https://api.judokan.store";
  await checkHealth(`${publicApi.replace(/\/$/, "")}/api/health`, true);

  if (process.env.CHECK_LOCAL_API === "1") {
    await checkHealth("http://localhost:3000/api/health", true);
  }

  if (process.env.SKIP_CODE_CHECKS !== "1") {
    run("pnpm run check");
    run("pnpm test");
  }

  console.log("\n[preflight] all checks passed");
}

main().catch((error) => {
  console.error("\n[preflight] failed");
  console.error(error);
  process.exit(1);
});
