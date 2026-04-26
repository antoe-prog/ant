import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const projectRoot = process.cwd();
const localUsersPath = path.resolve(projectRoot, "server", ".local-users.json");

function normalizeRole(role) {
  if (role === "admin" || role === "manager" || role === "member") return role;
  return "member";
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  let users;
  try {
    users = JSON.parse(await fs.readFile(localUsersPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("No local user store found. Skipping user import.");
      return;
    }
    throw error;
  }

  if (!Array.isArray(users) || users.length === 0) {
    console.log("Local user store is empty. Skipping user import.");
    return;
  }

  const connection = await mysql.createConnection(databaseUrl);
  try {
    for (const user of users) {
      if (!user?.openId) continue;
      await connection.execute(
        `
          INSERT INTO users
            (openId, name, email, passwordHash, loginMethod, role, avatarUrl, createdAt, updatedAt, lastSignedIn)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            email = VALUES(email),
            passwordHash = VALUES(passwordHash),
            loginMethod = VALUES(loginMethod),
            role = VALUES(role),
            avatarUrl = VALUES(avatarUrl),
            updatedAt = VALUES(updatedAt),
            lastSignedIn = VALUES(lastSignedIn)
        `,
        [
          user.openId,
          user.name ?? null,
          user.email ?? null,
          user.passwordHash ?? null,
          user.loginMethod ?? null,
          normalizeRole(user.role),
          user.avatarUrl ?? null,
          user.createdAt ? new Date(user.createdAt) : new Date(),
          user.updatedAt ? new Date(user.updatedAt) : new Date(),
          user.lastSignedIn ? new Date(user.lastSignedIn) : new Date(),
        ],
      );
    }

    const [rows] = await connection.query(
      "SELECT id, email, role FROM users ORDER BY id",
    );
    console.log(`Imported ${users.length} local user(s).`);
    console.table(rows);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
