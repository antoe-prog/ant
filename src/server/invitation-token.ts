import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppUser, AuditLog } from "@/lib/domain";
import { authSecurityLockKey } from "./auth-session.ts";

const invitationTokenBytes = 32;
const invitationTokenHashPattern = /^[a-f0-9]{64}$/;

export const invitationSecurityLockKey = authSecurityLockKey;
export const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
export const invitationPasswordFailureLimit = 5;
export const invitationPasswordFailureWindowMs = 15 * 60 * 1000;

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createInvitationToken() {
  const token = randomBytes(invitationTokenBytes).toString("base64url");

  return {
    token,
    tokenHash: hashInvitationToken(token),
  };
}

export function normalizeStoredInvitationToken(token: string | undefined) {
  if (!token) {
    return undefined;
  }

  return invitationTokenHashPattern.test(token) ? token : hashInvitationToken(token);
}

export function secureStoredInvitationTokens(users: AppUser[]) {
  return users.map((user) => {
    const invitationToken = normalizeStoredInvitationToken(user.invitationToken);

    return invitationToken === user.invitationToken ? user : { ...user, invitationToken };
  });
}

export function findUserByInvitationToken(users: AppUser[], token: string) {
  const candidateHash = Buffer.from(hashInvitationToken(token), "hex");
  let matchedUser: AppUser | null = null;

  for (const user of users) {
    const storedHash = normalizeStoredInvitationToken(user.invitationToken);

    if (!storedHash) {
      continue;
    }

    if (timingSafeEqual(candidateHash, Buffer.from(storedHash, "hex"))) {
      matchedUser = user;
    }
  }

  return matchedUser;
}

export function isInvitationExpired(invitedAt: string | undefined, now = new Date()) {
  const invitedAtMs = invitedAt ? Date.parse(invitedAt) : Number.NaN;

  return !Number.isFinite(invitedAtMs) || now.getTime() >= invitedAtMs + invitationLifetimeMs;
}

function isInvitationPasswordFailure(log: AuditLog, userId: string, windowStartedAtMs: number, nowMs: number) {
  const createdAtMs = Date.parse(log.createdAt);

  return log.action === "auth.invite.accept" &&
    log.targetId === userId &&
    log.result === "failed" &&
    log.after?.failureKind === "password_validation" &&
    createdAtMs > windowStartedAtMs &&
    createdAtMs <= nowMs;
}

export function getInvitationPasswordRateLimit(auditLogs: AuditLog[], userId: string, now = new Date()) {
  const nowMs = now.getTime();
  const windowStartedAtMs = nowMs - invitationPasswordFailureWindowMs;
  const failures = auditLogs
    .filter((log) => isInvitationPasswordFailure(log, userId, windowStartedAtMs, nowMs))
    .map((log) => Date.parse(log.createdAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  if (failures.length < invitationPasswordFailureLimit) {
    return {
      blocked: false as const,
      failureCount: failures.length,
      retryAfterSeconds: 0,
    };
  }

  return {
    blocked: true as const,
    failureCount: failures.length,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((failures[failures.length - invitationPasswordFailureLimit] + invitationPasswordFailureWindowMs - nowMs) / 1000),
    ),
  };
}
