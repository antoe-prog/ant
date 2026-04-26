import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import mysql from "mysql2/promise";

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const conn = await mysql.createConnection(url);
  console.log("Connected to DB");

  const sqls = [
    // members ?뚯씠釉붿뿉 userId 而щ읆???놁쑝硫?異붽? (?대? ?덉쑝硫?臾댁떆)
    `ALTER TABLE members ADD COLUMN IF NOT EXISTS userId INT DEFAULT NULL`,

    // activityLogs ?뚯씠釉??앹꽦
    `CREATE TABLE IF NOT EXISTS activityLogs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      action VARCHAR(64) NOT NULL,
      targetType VARCHAR(32),
      targetId INT,
      description TEXT,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    // inviteTokens ?뚯씠釉??앹꽦
    `CREATE TABLE IF NOT EXISTS inviteTokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token VARCHAR(64) NOT NULL UNIQUE,
      memberId INT,
      createdBy INT NOT NULL,
      usedBy INT,
      usedAt TIMESTAMP,
      expiresAt TIMESTAMP NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  for (const sql of sqls) {
    try {
      await conn.execute(sql);
      console.log("OK:", sql.slice(0, 60));
    } catch (e: any) {
      if (e.code === "ER_DUP_FIELDNAME" || e.message?.includes("Duplicate column")) {
        console.log("SKIP (already exists):", sql.slice(0, 60));
      } else {
        console.error("ERROR:", e.message);
      }
    }
  }

  await conn.end();
  console.log("Migration complete!");
}

migrate().catch(console.error);

