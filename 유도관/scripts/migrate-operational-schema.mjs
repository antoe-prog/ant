import "dotenv/config";
import mysql from "mysql2/promise";

const REQUIRED_TABLES = [
  {
    name: "attendance_photos",
    sql: `
      CREATE TABLE IF NOT EXISTS attendance_photos (
        id int NOT NULL AUTO_INCREMENT,
        userId int NOT NULL,
        memberId int NOT NULL,
        attendanceDate date NOT NULL,
        imageData longtext NULL,
        imageUrl text NULL,
        storageKey varchar(512) NULL,
        caption varchar(255) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_attendance_photos_member_date (memberId, attendanceDate),
        KEY idx_attendance_photos_user (userId)
      )
    `,
  },
  {
    name: "notification_preferences",
    sql: `
      CREATE TABLE IF NOT EXISTS notification_preferences (
        userId int NOT NULL,
        category enum('announcement','attendance','payment','promotion','tournament','manager_ops') NOT NULL,
        enabled tinyint(1) NOT NULL DEFAULT 1,
        approvedBy int NULL,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (userId, category),
        KEY idx_notification_preferences_category (category),
        KEY idx_notification_preferences_approved_by (approvedBy)
      )
    `,
  },
  {
    name: "manager_tasks",
    sql: `
      CREATE TABLE IF NOT EXISTS manager_tasks (
        id int NOT NULL AUTO_INCREMENT,
        title varchar(255) NOT NULL,
        description text NULL,
        status enum('open','done','archived') NOT NULL DEFAULT 'open',
        priority enum('low','normal','high') NOT NULL DEFAULT 'normal',
        dueDate date NULL,
        memberId int NULL,
        createdBy int NOT NULL,
        assignedTo int NULL,
        completedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_manager_tasks_status_due (status, dueDate),
        KEY idx_manager_tasks_member (memberId),
        KEY idx_manager_tasks_created_by (createdBy)
      )
    `,
  },
  {
    name: "notification_default_preferences",
    sql: `
      CREATE TABLE IF NOT EXISTS notification_default_preferences (
        category enum('announcement','attendance','payment','promotion','tournament','manager_ops') NOT NULL,
        enabled tinyint(1) NOT NULL DEFAULT 1,
        updatedBy int NULL,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (category),
        KEY idx_notification_default_preferences_updated_by (updatedBy)
      )
    `,
  },
  {
    name: "parent_child_links",
    sql: `
      CREATE TABLE IF NOT EXISTS parent_child_links (
        parentUserId int NOT NULL,
        memberId int NOT NULL,
        createdBy int NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (parentUserId, memberId),
        KEY idx_parent_child_links_member (memberId),
        KEY idx_parent_child_links_parent (parentUserId)
      )
    `,
  },
];

const REQUIRED_COLUMNS = [
  {
    table: "members",
    column: "notesUpdatedAt",
    sql: "ALTER TABLE members ADD COLUMN notesUpdatedAt timestamp NULL AFTER notes",
  },
  {
    table: "tournaments",
    column: "entryFee",
    sql: "ALTER TABLE tournaments ADD COLUMN entryFee int NOT NULL DEFAULT 0 AFTER registrationDeadline",
  },
  {
    table: "tournaments",
    column: "notice",
    sql: "ALTER TABLE tournaments ADD COLUMN notice text NULL AFTER description",
  },
  {
    table: "attendance_photos",
    column: "imageUrl",
    sql: "ALTER TABLE attendance_photos ADD COLUMN imageUrl text NULL AFTER imageData",
  },
  {
    table: "attendance_photos",
    column: "storageKey",
    sql: "ALTER TABLE attendance_photos ADD COLUMN storageKey varchar(512) NULL AFTER imageUrl",
  },
  {
    table: "users",
    column: "accountType",
    sql: "ALTER TABLE users ADD COLUMN accountType enum('student','parent') NOT NULL DEFAULT 'student' AFTER role",
  },
];

async function columnExists(connection, table, column) {
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
  return rows.length > 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. .env 파일 또는 환경변수를 확인하세요.");
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  const applied = [];
  const skipped = [];

  for (const table of REQUIRED_TABLES) {
    await connection.query(table.sql);
    applied.push(`table:${table.name}`);
  }

  for (const item of REQUIRED_COLUMNS) {
    if (await columnExists(connection, item.table, item.column)) {
      skipped.push(`${item.table}.${item.column}`);
      continue;
    }
    await connection.query(item.sql);
    applied.push(`${item.table}.${item.column}`);
  }

  await connection.query("ALTER TABLE attendance_photos MODIFY COLUMN imageData longtext NULL");
  applied.push("attendance_photos.imageData:nullable");

  await connection.end();

  console.log("[db:migrate:ops] complete");
  console.log(`applied: ${applied.length ? applied.join(", ") : "none"}`);
  console.log(`skipped: ${skipped.length ? skipped.join(", ") : "none"}`);
}

main().catch((error) => {
  console.error("[db:migrate:ops] failed");
  console.error(error);
  process.exit(1);
});
