import path from "node:path";
import { readFile } from "node:fs/promises";
import { createJsonStore } from "../src/server/json-store.ts";
import { createPostgresJsonStore } from "../src/server/postgres-store.ts";
import {
  assertNoNewRuntimeStateIntegrityIssues,
  validateRuntimeStateIntegrity,
} from "../src/server/runtime-state-integrity.ts";
import {
  addReadinessEvidenceIssue,
  readinessDefinitionsForPhase,
  text,
  validateReadinessEvidenceCsv,
} from "./pilot-readiness-evidence-utils.mjs";

const requiredCollections = [
  "branches",
  "users",
  "members",
  "classes",
  "attendance",
  "payments",
  "notices",
  "authSessions",
  "pushSubscriptions",
  "pushDispatchJobs",
  "pilotReadinessChecks",
  "pilotIncidents",
  "pilotOperationLogs",
  "counselingNotes",
  "promotions",
  "tournaments",
  "auditLogs",
];

const args = process.argv.slice(2);
const writeMode = args.includes("--write");
const allowPending = args.includes("--allow-pending");
const filePath = path.resolve(argValue("--file", ".data/pilot-readiness-evidence.csv"));
const phase = argValue("--phase", "pre-pilot");
const actorUserId = argValue("--actor-user-id", "user-admin");
const explicitDriver = argValue("--driver", null);
const runtimePath = path.resolve(argValue("--runtime", process.env.PILOT_DB_FILE ?? ".data/final-judo-db.json"));
const postgresUrl = argValue("--postgres-url", process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL ?? null);
const postgresStateKey = argValue("--state-key", process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp");
const postgresTable = argValue("--table", process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state");
const driver = explicitDriver ?? (process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");

if (driver !== "json" && driver !== "postgres") {
  throw new Error("--driver must be json or postgres.");
}

function argValue(name, fallback) {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  return exact ? exact.slice(name.length + 1) : fallback;
}

function createDefaultUnavailable() {
  throw new Error("Runtime DB is missing. Import pilot data or create the runtime store before applying readiness evidence.");
}

function validateRuntimeDb(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Runtime DB must be a JSON object.");
  }

  const upgraded = {
    ...value,
    promotions: Array.isArray(value.promotions) ? value.promotions : [],
    tournaments: Array.isArray(value.tournaments) ? value.tournaments : [],
  };

  for (const collection of requiredCollections) {
    if (!Array.isArray(upgraded[collection])) {
      throw new Error(`Runtime DB collection "${collection}" must be an array.`);
    }
  }

  return validateRuntimeStateIntegrity(upgraded);
}

function validateRuntimeWrite(next, previous) {
  return assertNoNewRuntimeStateIntegrityIssues(previous, next);
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

function createRuntimeStore() {
  if (driver === "postgres") {
    if (!postgresUrl) {
      throw new Error("PostgreSQL readiness evidence apply requires --postgres-url, FINAL_JUDO_POSTGRES_URL, or DATABASE_URL.");
    }

    return createPostgresJsonStore({
      connectionString: postgresUrl,
      key: postgresStateKey,
      tableName: postgresTable,
      createDefault: createDefaultUnavailable,
      validate: validateRuntimeDb,
      validateWrite: validateRuntimeWrite,
    });
  }

  return createJsonStore({
    directory: path.dirname(runtimePath),
    fileName: path.basename(runtimePath),
    createDefault: createDefaultUnavailable,
    validate: validateRuntimeDb,
    validateWrite: validateRuntimeWrite,
    backupLimit: 20,
  });
}

function targetSummary() {
  if (driver === "postgres") {
    return {
      connectionString: redactConnectionString(postgresUrl),
      stateKey: postgresStateKey,
      table: postgresTable,
    };
  }

  return { runtimePath };
}

function normalizeCheckedAt(value, fallback, blockers, id) {
  const checkedAt = text(value);

  if (!checkedAt) {
    return fallback;
  }

  const parsed = Date.parse(checkedAt);
  if (Number.isNaN(parsed)) {
    addReadinessEvidenceIssue(blockers, "READINESS_APPLY_CHECKED_AT_INVALID", "checkedAt must be an ISO-compatible timestamp.", {
      id,
      checkedAt,
    });
    return fallback;
  }

  return new Date(parsed).toISOString();
}

function readinessSnapshot(check) {
  return {
    checkedAt: check.checkedAt ?? null,
    checkedByUserId: check.checkedByUserId ?? null,
    evidence: check.evidence || null,
    owner: check.owner,
    status: check.status,
  };
}

function hasReadinessChange(before, after) {
  return JSON.stringify(readinessSnapshot(before)) !== JSON.stringify(readinessSnapshot(after));
}

async function main() {
  const blockers = [];
  let csv = "";

  try {
    csv = await readFile(filePath, "utf8");
  } catch (error) {
    addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_UNREADABLE", "pilot readiness evidence CSV could not be read.", {
      file: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const validation = validateReadinessEvidenceCsv(csv, { filePath, phase });
  blockers.push(...validation.blockers);

  const recordsById = new Map(validation.records.map(({ row }) => [text(row.id), row]));
  const pendingIds = validation.requiredIds.filter((id) => text(recordsById.get(id)?.status) === "pending");

  if (!allowPending && pendingIds.length > 0) {
    addReadinessEvidenceIssue(
      blockers,
      "READINESS_APPLY_PENDING_REQUIRED",
      "Applying readiness evidence requires every required row to be verified or blocked. Use --allow-pending only for an explicit partial sync.",
      { pendingIds },
    );
  }

  let db = null;
  let store = null;

  if (blockers.length === 0) {
    store = createRuntimeStore();

    try {
      db = await store.read();
    } catch (error) {
      addReadinessEvidenceIssue(blockers, "READINESS_APPLY_RUNTIME_UNREADABLE", "runtime DB could not be read.", {
        driver,
        target: targetSummary(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const requiredDefinitions = readinessDefinitionsForPhase(phase);
  const requiredIds = requiredDefinitions.map((definition) => definition.id);
  const actor = db?.users?.find((user) => user.id === actorUserId);

  if (db && (!actor || actor.role !== "admin")) {
    addReadinessEvidenceIssue(blockers, "READINESS_APPLY_ACTOR_NOT_ADMIN", "readiness evidence apply must use an existing admin actor.", {
      actorUserId,
    });
  }

  const runtimeChecksById = new Map((db?.pilotReadinessChecks ?? []).map((check) => [check.id, check]));
  const missingRuntimeIds = db ? requiredIds.filter((id) => !runtimeChecksById.has(id)) : [];
  if (missingRuntimeIds.length > 0) {
    addReadinessEvidenceIssue(blockers, "READINESS_APPLY_RUNTIME_ID_MISSING", "runtime DB is missing required readiness checks.", {
      missingRuntimeIds,
    });
  }

  const now = new Date().toISOString();
  const nextChecksById = new Map();
  const changed = [];

  if (db && blockers.length === 0) {
    for (const id of requiredIds) {
      const row = recordsById.get(id);
      const current = runtimeChecksById.get(id);
      const status = text(row.status);
      const next = {
        ...current,
        owner: text(row.owner) || current.owner,
        status,
        evidence: text(row.evidence),
        checkedAt: status === "pending" ? undefined : normalizeCheckedAt(row.checkedAt, now, blockers, id),
        checkedByUserId: status === "pending" ? undefined : actorUserId,
      };

      nextChecksById.set(id, next);

      if (hasReadinessChange(current, next)) {
        changed.push({ id, before: current, after: next });
      }
    }
  }

  if (blockers.length === 0 && db && writeMode && changed.length > 0) {
    const auditLogs = changed.map((change, index) => ({
      id: `audit-${Date.now()}-${db.auditLogs.length + index + 1}`,
      branchId: null,
      actorUserId,
      action: "pilot_readiness.update",
      targetType: "pilot_readiness",
      targetId: change.id,
      before: readinessSnapshot(change.before),
      after: {
        ...readinessSnapshot(change.after),
        sourceFile: filePath,
        sourcePhase: phase,
      },
      result: "success",
      message: "파일럿 준비 증빙 CSV를 반영했습니다.",
      createdAt: now,
    }));

    db = await store.write({
      ...db,
      pilotReadinessChecks: db.pilotReadinessChecks.map((check) => nextChecksById.get(check.id) ?? check),
      auditLogs: [...auditLogs, ...db.auditLogs],
    });
  }

  if (store && "close" in store) {
    await store.close();
  }

  const result = {
    ok: blockers.length === 0,
    mode: writeMode ? "write" : "dry-run",
    driver,
    file: filePath,
    phase,
    actorUserId,
    target: targetSummary(),
    statusCounts: validation.statusCounts,
    requiredIds: validation.requiredIds,
    changedIds: blockers.length === 0 ? changed.map((change) => change.id) : [],
    unchangedIds:
      blockers.length === 0
        ? requiredIds.filter((id) => !changed.some((change) => change.id === id))
        : [],
    auditLogCount: writeMode && blockers.length === 0 ? changed.length : 0,
    blockers,
    checked: [
      ...validation.checked,
      "admin actor exists for readiness apply",
      "runtime readiness ids match selected phase",
      "pilot_readiness.update audit logs for changed rows",
    ],
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (blockers.length > 0) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
