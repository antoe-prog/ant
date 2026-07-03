import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./pilot-data-utils.mjs";

const { defaultPilotPassword, defaultPilotPasswordHash } = await import("../src/server/auth-password.ts");

export const passwordRotationHeaders = [
  "userId",
  "email",
  "name",
  "role",
  "branchIds",
  "usesDefaultPassword",
  "hasPasswordHash",
  "lastPasswordAuditAt",
  "rotationStatus",
  "evidence",
  "rotatedAt",
  "notes",
];
export const passwordRotationStatuses = new Set(["pending", "verified", "blocked"]);
export const passwordRotationPlaceholderPattern = /\b(todo|tbd|placeholder)\b|미정|확인 필요/i;
export const leakedPasswordPattern = new RegExp(`${escapeRegExp(defaultPilotPassword)}|\\bFJ-[a-f0-9]{8}-[a-f0-9]{8}\\b`, "i");

export function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function csvCell(value) {
  const stringValue = value == null ? "" : String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

export function serializePasswordRotationCsv(records) {
  return `${[passwordRotationHeaders, ...records.map((record) => passwordRotationHeaders.map((header) => record[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

export function addPasswordRotationIssue(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function assertSafeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }

  return value;
}

function redactConnectionString(connectionString) {
  if (!connectionString) {
    return null;
  }

  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "********";
    }
    return url.toString();
  } catch {
    return "configured";
  }
}

export function parseBoolean(value) {
  const normalized = text(value).toLowerCase();

  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }

  return null;
}

export function userBranchIds(user) {
  return Array.isArray(user.branchIds) ? user.branchIds.join("|") : "";
}

export function readPasswordRotationCsv(csv) {
  const [headers, ...rows] = csv ? parseCsv(csv) : [];

  if (!headers) {
    return { headers: [], records: [] };
  }

  const normalizedHeaders = headers.map((header) => header.trim());

  return {
    headers: normalizedHeaders,
    records: rows.map((row, index) => ({
      row: Object.fromEntries(normalizedHeaders.map((header, headerIndex) => [header, row[headerIndex]?.trim() ?? ""])),
      rowNumber: index + 2,
    })),
  };
}

export async function readRuntimeDb(runtimePath) {
  const resolvedPath = path.resolve(runtimePath);
  const raw = await readFile(resolvedPath, "utf8");
  const db = JSON.parse(raw);

  return validatePasswordRotationRuntimeDb(db);
}

export function validatePasswordRotationRuntimeDb(db) {
  if (!db || typeof db !== "object") {
    throw new Error("Runtime DB must be a JSON object.");
  }

  if (!Array.isArray(db.users)) {
    throw new Error('Runtime DB collection "users" must be an array.');
  }

  if (!Array.isArray(db.auditLogs)) {
    throw new Error('Runtime DB collection "auditLogs" must be an array.');
  }

  return db;
}

export async function readPasswordRotationRuntimeSource({
  driver = "json",
  runtimePath = ".data/final-judo-db.json",
  postgresUrl = null,
  stateKey = "mvp",
  table = "app_runtime_state",
} = {}) {
  if (driver === "json") {
    const resolvedPath = path.resolve(runtimePath);
    return {
      db: await readRuntimeDb(resolvedPath),
      runtime: {
        driver,
        file: resolvedPath,
      },
    };
  }

  if (driver !== "postgres") {
    throw new Error("--driver must be json or postgres.");
  }

  if (!postgresUrl) {
    throw new Error("PostgreSQL password rotation check requires --postgres-url, FINAL_JUDO_POSTGRES_URL, or DATABASE_URL.");
  }

  const tableName = assertSafeIdentifier(table);
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: postgresUrl, max: 1 });

  try {
    const result = await pool.query(`SELECT data, revision, updated_at FROM ${tableName} WHERE key = $1`, [stateKey]);
    const row = result.rows[0];

    if (!row) {
      throw new Error(`Runtime state row not found: ${tableName}.${stateKey}`);
    }

    return {
      db: validatePasswordRotationRuntimeDb(row.data),
      runtime: {
        driver,
        table: tableName,
        key: stateKey,
        revision: Number(row.revision),
        updatedAt: row.updated_at?.toISOString?.() ?? null,
        connectionString: redactConnectionString(postgresUrl),
      },
    };
  } finally {
    await pool.end();
  }
}

export function emailUsers(db) {
  return db.users.filter((user) => typeof user.email === "string" && user.email.trim());
}

export function passwordEvidenceAuditLogs(db, userId) {
  return db.auditLogs
    .filter(
      (log) =>
        log?.targetId === userId &&
        log?.result === "success" &&
        (log.action === "auth.password_reset.complete" || log.action === "auth.invite.accept"),
    )
    .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""));
}

export function createPasswordRotationRecord(user, db) {
  const audits = passwordEvidenceAuditLogs(db, user.id);
  const latestAudit = audits[0] ?? null;
  const usesDefaultPassword = user.passwordHash === defaultPilotPasswordHash;
  const hasPasswordHash = Boolean(user.passwordHash);
  const rotatedAt = user.passwordUpdatedAt ?? user.acceptedAt ?? latestAudit?.createdAt ?? "";
  const canPrefillVerified = hasPasswordHash && !usesDefaultPassword && Boolean(rotatedAt) && Boolean(latestAudit);

  return {
    userId: user.id,
    email: user.email ?? "",
    name: user.name ?? "",
    role: user.role ?? "",
    branchIds: userBranchIds(user),
    usesDefaultPassword: usesDefaultPassword ? "true" : "false",
    hasPasswordHash: hasPasswordHash ? "true" : "false",
    lastPasswordAuditAt: latestAudit?.createdAt ?? "",
    rotationStatus: canPrefillVerified ? "verified" : "pending",
    evidence: canPrefillVerified
      ? `${latestAudit.action} ${latestAudit.id} ${latestAudit.after?.reason ?? "password updated"}`
      : "",
    rotatedAt,
    notes: usesDefaultPassword
      ? "TODO: /app/admin/users에서 계정별 임시 비밀번호를 발급하고 전달 채널 증빙을 기록한다."
      : "TODO: 전달 채널, 담당자, 증빙 링크를 확인한다.",
  };
}

export function validatePasswordRotationCsv(csv, db, { allowPending = false, filePath = null } = {}) {
  const blockers = [];
  const { headers, records } = readPasswordRotationCsv(csv);
  const missingHeaders = passwordRotationHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_HEADERS_MISSING", "password rotation CSV is missing required headers.", {
      missingHeaders,
    });
  }

  const users = emailUsers(db);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const rowsById = new Map();
  const duplicateIds = [];

  for (const { row, rowNumber } of records) {
    const userId = text(row.userId);
    const status = text(row.rotationStatus);
    const evidence = text(row.evidence);
    const notes = text(row.notes);
    const rotatedAt = text(row.rotatedAt);
    const runtimeUser = usersById.get(userId);

    if (!userId) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_USER_ID_MISSING", "password rotation row must include userId.", {
        rowNumber,
      });
      continue;
    }

    if (rowsById.has(userId)) {
      duplicateIds.push(userId);
    }
    rowsById.set(userId, row);

    if (!runtimeUser) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_USER_UNKNOWN", "password rotation row userId is not in runtime users.", {
        userId,
        rowNumber,
      });
      continue;
    }

    if (text(row.email) !== text(runtimeUser.email)) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_EMAIL_MISMATCH", "password rotation email must match runtime user.", {
        userId,
        expected: runtimeUser.email ?? "",
        actual: row.email ?? "",
      });
    }

    if (text(row.role) !== text(runtimeUser.role)) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_ROLE_MISMATCH", "password rotation role must match runtime user.", {
        userId,
        expected: runtimeUser.role ?? "",
        actual: row.role ?? "",
      });
    }

    if (text(row.branchIds) !== userBranchIds(runtimeUser)) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_BRANCH_SCOPE_MISMATCH", "password rotation branchIds must match runtime user.", {
        userId,
        expected: userBranchIds(runtimeUser),
        actual: row.branchIds ?? "",
      });
    }

    const rowUsesDefault = parseBoolean(row.usesDefaultPassword);
    const actualUsesDefault = runtimeUser.passwordHash === defaultPilotPasswordHash;
    if (rowUsesDefault !== actualUsesDefault) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_DEFAULT_FLAG_MISMATCH", "usesDefaultPassword must match runtime password hash.", {
        userId,
        expected: actualUsesDefault,
        actual: row.usesDefaultPassword ?? "",
      });
    }

    const rowHasPasswordHash = parseBoolean(row.hasPasswordHash);
    const actualHasPasswordHash = Boolean(runtimeUser.passwordHash);
    if (rowHasPasswordHash !== actualHasPasswordHash) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_HASH_FLAG_MISMATCH", "hasPasswordHash must match runtime user.", {
        userId,
        expected: actualHasPasswordHash,
        actual: row.hasPasswordHash ?? "",
      });
    }

    if (!actualHasPasswordHash) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_HASH_MISSING", "email login user is missing passwordHash.", {
        userId,
      });
    }

    if (actualUsesDefault) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_DEFAULT_ACTIVE", "default pilot temporary password is still active for this user.", {
        userId,
        email: runtimeUser.email ?? null,
      });
    }

    if (!passwordRotationStatuses.has(status)) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_STATUS_INVALID", "rotationStatus must be pending, verified, or blocked.", {
        userId,
        status,
      });
    }

    if (!allowPending && status !== "verified") {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_NOT_VERIFIED", "all password rotation rows must be verified before pilot launch.", {
        userId,
        status,
      });
    }

    if ((status === "verified" || status === "blocked") && (evidence.length < 5 || passwordRotationPlaceholderPattern.test(evidence))) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_EVIDENCE_MISSING", "verified/blocked password rotation rows require evidence.", {
        userId,
        status,
      });
    }

    if (leakedPasswordPattern.test(evidence) || leakedPasswordPattern.test(notes)) {
      addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_SECRET_LEAK", "password rotation CSV must not include raw temporary passwords.", {
        userId,
      });
    }

    if (status === "verified") {
      const rotatedAtTime = Date.parse(rotatedAt);
      if (!rotatedAt || Number.isNaN(rotatedAtTime)) {
        addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_ROTATED_AT_INVALID", "verified password rotation rows require a valid rotatedAt timestamp.", {
          userId,
          rotatedAt,
        });
      }

      const audits = passwordEvidenceAuditLogs(db, userId);
      const hasAudit = audits.some((log) => Date.parse(log.createdAt ?? "") <= rotatedAtTime || Number.isNaN(rotatedAtTime));
      if (!hasAudit) {
        addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_AUDIT_MISSING", "verified password rotation rows require a password reset or invite accept audit log.", {
          userId,
        });
      }
    }
  }

  if (duplicateIds.length > 0) {
    addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_USER_DUPLICATE", "password rotation CSV must not duplicate user ids.", {
      duplicateIds,
    });
  }

  const missingUserIds = users.map((user) => user.id).filter((userId) => !rowsById.has(userId));
  if (missingUserIds.length > 0) {
    addPasswordRotationIssue(blockers, "PASSWORD_ROTATION_USER_MISSING", "password rotation CSV is missing runtime email users.", {
      missingUserIds,
    });
  }

  const statusCounts = records.reduce((counts, { row }) => {
    const status = text(row.rotationStatus) || "missing";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    ok: blockers.length === 0,
    file: filePath,
    users: users.length,
    statusCounts,
    blockers,
    checked: [
      "runtime email users coverage",
      "default temporary password hash absence",
      "password hash presence",
      "password reset or invite accept audit evidence",
      "raw temporary password leakage guard",
    ],
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
