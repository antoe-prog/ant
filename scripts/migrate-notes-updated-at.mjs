import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("No DATABASE_URL - skipping migration");
  process.exit(0);
}

try {
  const conn = await mysql.createConnection(url);
  // notesUpdatedAt 而щ읆???놁쓣 ?뚮쭔 異붽?
  const [rows] = await conn.execute(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'members' AND COLUMN_NAME = 'notesUpdatedAt'"
  );
  if (rows.length === 0) {
    await conn.execute("ALTER TABLE `members` ADD COLUMN `notesUpdatedAt` timestamp NULL");
    console.log("??notesUpdatedAt column added to members table");
  } else {
    console.log("?뱄툘  notesUpdatedAt column already exists");
  }
  await conn.end();
} catch (e) {
  console.log("Migration error (non-fatal):", e.message);
  process.exit(0);
}

