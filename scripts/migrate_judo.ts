import "./load-env.js";
import mysql2 from "mysql2/promise";
import * as fs from "fs";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const conn = await mysql2.createConnection(dbUrl!);
  
  const sqlContent = fs.readFileSync(
    "/home/ubuntu/onboarding-workflow/drizzle/0003_gray_ezekiel_stane.sql",
    "utf-8"
  );
  
  const statements = sqlContent
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  console.log(`Running ${statements.length} SQL statements...`);
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await conn.execute(stmt);
      console.log(`[${i+1}/${statements.length}] OK: ${stmt.substring(0, 60)}`);
    } catch (err: any) {
      const msg = (err.message || "") as string;
      if (msg.includes("already exists") || msg.includes("Can't DROP") || msg.includes("Unknown column") || msg.includes("doesn't exist")) {
        console.log(`[${i+1}/${statements.length}] SKIP: ${msg.substring(0, 80)}`);
      } else {
        console.error(`[${i+1}/${statements.length}] ERROR: ${msg}`);
      }
    }
  }
  
  await conn.end();
  console.log("Migration complete!");
}

main().catch(console.error);
