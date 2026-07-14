import { createHash, randomBytes } from "node:crypto";
import type { AppUser, AuthSession, MockDatabase } from "@/lib/domain";
import { userAdministrationLockKey } from "./user-administration.ts";

const sessionTokenBytes = 32;
const loginFailureLimit = 5;
const loginFailureWindowMs = 15 * 60 * 1000;
const passwordResetRequestLimit = 3;
const passwordResetRequestWindowMs = 60 * 60 * 1000;

// Authentication and user security mutations must share one serialized state transition.
export const authSecurityLockKey = userAdministrationLockKey;

export function readUnmodifiedPassword(value: unknown) {
  return typeof value === "string" ? value : "";
}

function auditCreatedAtMs(createdAt: string) {
  const value = Date.parse(createdAt);
  return Number.isFinite(value) ? value : null;
}

export function getAccountLoginThrottle(
  db: MockDatabase,
  userId: string,
  now = new Date(),
) {
  const nowMs = now.getTime();
  const windowStartedAt = nowMs - loginFailureWindowMs;
  const lastSuccessfulLoginAt = db.auditLogs.reduce((latest, log) => {
    if (
      log.action !== "auth.login" ||
      log.targetId !== userId ||
      log.result !== "success"
    ) {
      return latest;
    }

    const createdAt = auditCreatedAtMs(log.createdAt);
    return createdAt !== null && createdAt > latest ? createdAt : latest;
  }, Number.NEGATIVE_INFINITY);
  const failures = db.auditLogs
    .filter(
      (log) =>
        log.action === "auth.login" &&
        log.targetId === userId &&
        log.result === "failed",
    )
    .map((log) => auditCreatedAtMs(log.createdAt))
    .filter((createdAt): createdAt is number =>
      createdAt !== null &&
      createdAt > windowStartedAt &&
      createdAt > lastSuccessfulLoginAt &&
      createdAt <= nowMs,
    )
    .sort((left, right) => left - right);

  if (failures.length < loginFailureLimit) {
    return null;
  }

  return {
    failureCount: failures.length,
    retryAfterSeconds: Math.max(1, Math.ceil((failures[0] + loginFailureWindowMs - nowMs) / 1000)),
  };
}

export function hasReachedPasswordResetRequestLimit(
  db: MockDatabase,
  userId: string,
  now = new Date(),
) {
  const nowMs = now.getTime();
  const windowStartedAt = nowMs - passwordResetRequestWindowMs;
  const requestCount = db.auditLogs.filter((log) => {
    if (log.action !== "auth.password_reset.request" || log.targetId !== userId) {
      return false;
    }

    const createdAt = auditCreatedAtMs(log.createdAt);
    return createdAt !== null && createdAt > windowStartedAt && createdAt <= nowMs;
  }).length;

  return requestCount >= passwordResetRequestLimit;
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createSessionId() {
  return `session-${randomBytes(16).toString("hex")}`;
}

function isSessionActive(session: AuthSession, nowMs: number) {
  return !session.revokedAt && Date.parse(session.expiresAt) > nowMs;
}

export function createAuthSession(
  db: MockDatabase,
  userId: string,
  maxAgeSeconds: number,
  now = new Date(),
) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error("Session max age must be a positive integer.");
  }

  const token = randomBytes(sessionTokenBytes).toString("base64url");
  const createdAt = now.toISOString();
  const session: AuthSession = {
    id: createSessionId(),
    tokenHash: hashSessionToken(token),
    userId,
    createdAt,
    expiresAt: new Date(now.getTime() + maxAgeSeconds * 1000).toISOString(),
  };

  return {
    db: {
      ...db,
      authSessions: [
        session,
        ...db.authSessions.filter((candidate) => Date.parse(candidate.expiresAt) > now.getTime()),
      ],
    },
    session,
    token,
  };
}

export function findAuthSession(db: MockDatabase, token: string | undefined, now = new Date()) {
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  return db.authSessions.find(
    (session) => session.tokenHash === tokenHash && isSessionActive(session, now.getTime()),
  ) ?? null;
}

export function findAuthSessionUser(
  db: MockDatabase,
  token: string | undefined,
  now = new Date(),
): AppUser | null {
  const session = findAuthSession(db, token, now);
  return session ? db.users.find((user) => user.id === session.userId) ?? null : null;
}

export function revokeAuthSession(
  db: MockDatabase,
  token: string | undefined,
  now = new Date(),
): MockDatabase {
  if (!token) {
    return db;
  }

  const tokenHash = hashSessionToken(token);
  const matchingSession = db.authSessions.find(
    (session) => session.tokenHash === tokenHash && !session.revokedAt,
  );

  if (!matchingSession) {
    return db;
  }

  const revokedAt = now.toISOString();

  return {
    ...db,
    authSessions: db.authSessions.map((session) =>
      session.tokenHash === tokenHash && !session.revokedAt ? { ...session, revokedAt } : session,
    ),
  };
}

export function revokeUserAuthSessions(db: MockDatabase, userId: string, now = new Date()): MockDatabase {
  const revokedAt = now.toISOString();

  return {
    ...db,
    authSessions: db.authSessions.map((session) =>
      session.userId === userId && !session.revokedAt ? { ...session, revokedAt } : session,
    ),
  };
}
