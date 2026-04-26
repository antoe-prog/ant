import "./load-env.js";
import mysql2 from "mysql2/promise";

async function main() {
  const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
  
  // First expand enum to include all old values
  try {
    await conn.execute("ALTER TABLE users MODIFY COLUMN `role` enum('employee','hr','member','manager','admin') NOT NULL DEFAULT 'member'");
  } catch (e: any) { console.log('expand enum:', e.message); }
  
  // Update existing role values to new enum
  await conn.execute("UPDATE users SET role = 'admin' WHERE role = 'hr'");
  await conn.execute("UPDATE users SET role = 'member' WHERE role = 'employee'");
  
  // Now narrow the column to new values only
  await conn.execute("ALTER TABLE users MODIFY COLUMN `role` enum('member','manager','admin') NOT NULL DEFAULT 'member'");
  
  console.log("Role column updated successfully");
  await conn.end();
}

main().catch(console.error);
