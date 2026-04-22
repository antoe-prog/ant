import "./load-env.js";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL!;

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS promotions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        memberId INT NOT NULL,
        examDate DATE NOT NULL,
        currentBelt ENUM('white','yellow','orange','green','blue','brown','black') NOT NULL,
        targetBelt ENUM('white','yellow','orange','green','blue','brown','black') NOT NULL,
        result ENUM('pending','passed','failed') NOT NULL DEFAULT 'pending',
        notes TEXT,
        recordedBy INT,
        createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("promotions table created successfully");
  } finally {
    await conn.end();
  }
}

main().catch(console.error);
