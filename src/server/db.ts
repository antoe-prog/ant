import path from "node:path";
import type { MockDatabase, PilotOperationLog, PilotReadinessStatus } from "@/lib/domain";
import { sanitizeAuditLog } from "@/lib/audit-log-security";
import { createDefaultPilotReadinessChecks, createMockData } from "@/lib/mock-data";
import { defaultPilotPasswordHash } from "@/server/auth-password";
import { assertProductionRuntimeEnvironment } from "@/lib/production-runtime-policy";
import { rollSeededDemoDates } from "@/server/demo-date-roll";
import { createJsonStore } from "@/server/json-store";
import { createPostgresJsonStore } from "@/server/postgres-store";
import { mergeRuntimeState } from "@/server/runtime-state-merge";
import { applyRuntimeRetentionPolicy } from "@/lib/runtime-retention";
import {
  assertNoNewRuntimeStateIntegrityIssues,
  validateRuntimeStateIntegrity,
} from "@/server/runtime-state-integrity";

const defaultJsonDataDirectory = `${"."}data`;
const defaultJsonDataFileName = "final-judo-db.json";
const runtimeEnvironment = assertProductionRuntimeEnvironment(process.env);
const dbDriver = process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json";
const pilotReadinessStatuses = new Set<PilotReadinessStatus>(["pending", "verified", "blocked"]);
const legacyAdminSeedPasswordHash =
  "pbkdf2_sha256$120000$final-judo-mvp-pilot$3eeecee80a931e1629209c360dc5209c4ab34b8fdccc41dacd33c4959c65e2c4";
const defaultUserPhones = new Map([
  ["user-admin", "01028476013"],
  ["user-owner", "01059274381"],
  ["user-coach", "01031967428"],
  ["user-guardian", "01072483619"],
  ["user-songpa-guardian", "01081267345"],
  ["user-member", "01093645827"],
]);

const requiredCollections = [
  "branches",
  "users",
  "members",
  "classes",
  "attendance",
  "promotions",
  "tournaments",
  "payments",
  "retainedPaymentTransactions",
  "notices",
  "authSessions",
  "passwordResetChallenges",
  "phoneSignupChallenges",
  "attendanceQrChallenges",
  "pushSubscriptions",
  "pushDispatchJobs",
  "pilotReadinessChecks",
  "pilotIncidents",
  "pilotOperationLogs",
  "counselingNotes",
  "auditLogs",
] as const satisfies readonly (keyof MockDatabase)[];

function sanitizeDatabaseAuditLogs(db: MockDatabase): MockDatabase {
  return {
    ...db,
    auditLogs: db.auditLogs.map(sanitizeAuditLog),
  };
}

function validateServerDbWrite(next: MockDatabase, previous: MockDatabase | null) {
  const retained = applyRuntimeRetentionPolicy(next).db;
  return assertNoNewRuntimeStateIntegrityIssues(previous, retained);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readOptionalFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readPilotReadinessStatus(value: unknown): PilotReadinessStatus {
  return typeof value === "string" && pilotReadinessStatuses.has(value as PilotReadinessStatus)
    ? (value as PilotReadinessStatus)
    : "pending";
}

function normalizePilotOperationLog(log: unknown): PilotOperationLog {
  const candidate = log && typeof log === "object" ? (log as Record<string, unknown>) : {};
  const normalized: PilotOperationLog = {
    id: readString(candidate.id, `operation-${readString(candidate.date, "unknown")}`),
    branchId: typeof candidate.branchId === "string" ? candidate.branchId : null,
    date: readString(candidate.date),
    status: readPilotReadinessStatus(candidate.status),
    owner: readString(candidate.owner),
    evidence: readString(candidate.evidence),
    classesChecked: readFiniteNumber(candidate.classesChecked),
    attendanceRecords: readFiniteNumber(candidate.attendanceRecords),
    paymentChecks: readFiniteNumber(candidate.paymentChecks),
    noticeFollowupChecks: readFiniteNumber(candidate.noticeFollowupChecks),
    noticeChecks: readFiniteNumber(candidate.noticeChecks),
  };
  const mobileAttendanceDurationSeconds = readOptionalFiniteNumber(candidate.mobileAttendanceDurationSeconds);
  const mobileAttendanceEvidence = readOptionalString(candidate.mobileAttendanceEvidence);
  const blockerSummary = readOptionalString(candidate.blockerSummary);
  const checkedAt = readOptionalString(candidate.checkedAt);
  const checkedByUserId = readOptionalString(candidate.checkedByUserId);

  if (mobileAttendanceDurationSeconds !== undefined) {
    normalized.mobileAttendanceDurationSeconds = mobileAttendanceDurationSeconds;
  }
  if (mobileAttendanceEvidence) {
    normalized.mobileAttendanceEvidence = mobileAttendanceEvidence;
  }
  if (blockerSummary) {
    normalized.blockerSummary = blockerSummary;
  }
  if (checkedAt) {
    normalized.checkedAt = checkedAt;
  }
  if (checkedByUserId) {
    normalized.checkedByUserId = checkedByUserId;
  }

  return normalized;
}

function validateMockDatabase(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Server DB must be a JSON object.");
  }

  const db = value as Partial<Record<keyof MockDatabase, unknown>>;
  const defaultPilotReadinessChecks = createDefaultPilotReadinessChecks();
  const existingPilotReadinessChecks = Array.isArray(db.pilotReadinessChecks) ? db.pilotReadinessChecks : null;
  const pilotReadinessChecks = existingPilotReadinessChecks
    ? [
        ...existingPilotReadinessChecks,
        ...defaultPilotReadinessChecks.filter(
          (defaultCheck) =>
            !existingPilotReadinessChecks.some(
              (check) => check && typeof check === "object" && "id" in check && check.id === defaultCheck.id,
            ),
        ),
      ]
    : defaultPilotReadinessChecks;
  const upgraded = {
    ...db,
    users: Array.isArray(db.users)
      ? db.users.map((user) => {
          if (!user || typeof user !== "object") {
            return user;
          }

          const candidate = user as Record<string, unknown>;
          const defaultPhone = typeof candidate.id === "string" ? defaultUserPhones.get(candidate.id) : undefined;
          const isPendingInvitation = candidate.invitationStatus === "pending";
          const hasLegacyAdminSeedPassword =
            candidate.id === "user-admin" && candidate.passwordHash === legacyAdminSeedPasswordHash;

          return {
            ...candidate,
            ...("email" in candidate && (!("passwordHash" in candidate) || hasLegacyAdminSeedPassword) && !isPendingInvitation
              ? { passwordHash: defaultPilotPasswordHash }
              : {}),
            ...(!("phone" in candidate) && defaultPhone ? { phone: defaultPhone } : {}),
          };
        })
      : db.users,
    pilotReadinessChecks,
    promotions: Array.isArray(db.promotions) ? db.promotions : [],
    tournaments: Array.isArray(db.tournaments) ? db.tournaments : [],
    authSessions: Array.isArray(db.authSessions) ? db.authSessions : [],
    passwordResetChallenges: Array.isArray(db.passwordResetChallenges) ? db.passwordResetChallenges : [],
    phoneSignupChallenges: Array.isArray(db.phoneSignupChallenges) ? db.phoneSignupChallenges : [],
    attendanceQrChallenges: Array.isArray(db.attendanceQrChallenges)
      ? db.attendanceQrChallenges
          .filter(
            (challenge) =>
              !challenge ||
              typeof challenge !== "object" ||
              !("memberId" in challenge) ||
              "redeemedMemberIds" in challenge,
          )
          .map((challenge) =>
            challenge &&
            typeof challenge === "object" &&
            "sessionId" in challenge &&
            !("redeemedMemberIds" in challenge)
              ? { ...challenge, redeemedMemberIds: [] }
              : challenge,
          )
      : [],
    retainedPaymentTransactions: Array.isArray(db.retainedPaymentTransactions)
      ? db.retainedPaymentTransactions
      : [],
    pushSubscriptions: Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [],
    pushDispatchJobs: Array.isArray(db.pushDispatchJobs) ? db.pushDispatchJobs : [],
    pilotIncidents: Array.isArray(db.pilotIncidents) ? db.pilotIncidents : [],
    pilotOperationLogs: Array.isArray(db.pilotOperationLogs) ? db.pilotOperationLogs.map(normalizePilotOperationLog) : [],
  };

  for (const collection of requiredCollections) {
    if (!Array.isArray(upgraded[collection])) {
      throw new Error(`Server DB collection "${collection}" must be an array.`);
    }
  }

  return validateRuntimeStateIntegrity(
    sanitizeDatabaseAuditLogs(rollSeededDemoDates(upgraded as MockDatabase)),
  );
}

function resolveRuntimePath(runtimePath: string) {
  if (path.isAbsolute(runtimePath)) {
    return runtimePath;
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), runtimePath);
}

function createServerDbStore() {
  if (dbDriver === "postgres") {
    const connectionString = process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("FINAL_JUDO_DB_DRIVER=postgres requires FINAL_JUDO_POSTGRES_URL or DATABASE_URL.");
    }

    return createPostgresJsonStore<MockDatabase>({
      connectionString,
      key: runtimeEnvironment.stateKey,
      tableName: runtimeEnvironment.tableName,
      expectedInstallationId: runtimeEnvironment.expectedInstallationId ?? undefined,
      requireExistingState: runtimeEnvironment.enforced,
      createDefault: () => sanitizeDatabaseAuditLogs(createMockData()),
      validate: validateMockDatabase,
      validateWrite: validateServerDbWrite,
      merge: mergeRuntimeState,
    });
  }

  const explicitJsonFile = process.env.PILOT_DB_FILE?.trim();
  const jsonStoreTarget = explicitJsonFile
    ? {
        directory: path.dirname(resolveRuntimePath(explicitJsonFile)),
        fileName: path.basename(explicitJsonFile),
      }
    : {
        directory: resolveRuntimePath(process.env.FINAL_JUDO_DATA_DIR?.trim() || defaultJsonDataDirectory),
        fileName: defaultJsonDataFileName,
      };

  return createJsonStore<MockDatabase>({
    directory: jsonStoreTarget.directory,
    fileName: jsonStoreTarget.fileName,
    createDefault: () => sanitizeDatabaseAuditLogs(createMockData()),
    validate: validateMockDatabase,
    validateWrite: validateServerDbWrite,
    backupLimit: 20,
    merge: mergeRuntimeState,
  });
}

const serverDbStore = createServerDbStore();

export const serverDbPaths = "paths" in serverDbStore ? serverDbStore.paths : null;

export async function readServerDb(options: { enforceRuntimeRetention?: boolean } = {}) {
  const db = await serverDbStore.read();

  if (options.enforceRuntimeRetention === false) {
    return db;
  }

  const retained = applyRuntimeRetentionPolicy(db);

  if (retained.prunedAuditLogCount === 0 && retained.prunedPaymentTransactionCount === 0) {
    return db;
  }

  return serverDbStore.write(sanitizeDatabaseAuditLogs(retained.db));
}

export async function writeServerDb(db: MockDatabase) {
  const retained = applyRuntimeRetentionPolicy(db).db;

  return serverDbStore.write(sanitizeDatabaseAuditLogs({
    ...retained,
  }));
}

export async function resetServerDb() {
  return serverDbStore.reset();
}

export async function getServerDbStatus() {
  return {
    driver: dbDriver,
    ...(await serverDbStore.status()),
  };
}

export async function closeServerDb() {
  if ("close" in serverDbStore) {
    await serverDbStore.close();
  }
}

export function withServerDbLock<Result>(key: string, operation: () => Promise<Result>) {
  return serverDbStore.withLock(key, operation);
}

export async function updateServerDb(mutator: (db: MockDatabase) => MockDatabase) {
  const current = await readServerDb();
  const next = mutator(current);
  return writeServerDb(next);
}
