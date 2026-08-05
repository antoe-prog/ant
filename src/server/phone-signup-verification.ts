import { createHash, randomBytes, randomInt } from "node:crypto";
import type { MockDatabase, PhoneSignupChallenge } from "../lib/domain.ts";
import { createPasswordHash, runPasswordHashTimingEqualizer, verifyPassword } from "./auth-password.ts";
import { createRuntimeId } from "./runtime-id.ts";

export const phoneSignupCodeLength = 6;
export const phoneSignupCodeLifetimeMs = 10 * 60 * 1_000;
export const phoneSignupMaxAttempts = 5;
export const phoneSignupRequestLimit = 3;
export const phoneSignupRequestWindowMs = 60 * 60 * 1_000;

const phoneSignupRetentionMs = 24 * 60 * 60 * 1_000;

function hashPhone(phone: string) {
  return createHash("sha256").update(phone, "utf8").digest("hex");
}

function challenges(db: MockDatabase) {
  return db.phoneSignupChallenges ?? [];
}

export function hasReachedPhoneSignupRequestLimit(
  db: MockDatabase,
  phone: string,
  now = new Date(),
) {
  const phoneHash = hashPhone(phone);
  const windowStartedAt = now.getTime() - phoneSignupRequestWindowMs;
  return challenges(db).filter((challenge) => {
    const createdAt = Date.parse(challenge.createdAt);
    return challenge.phoneHash === phoneHash &&
      Number.isFinite(createdAt) &&
      createdAt > windowStartedAt &&
      createdAt <= now.getTime();
  }).length >= phoneSignupRequestLimit;
}

export function createPhoneSignupChallenge(db: MockDatabase, phone: string, now = new Date()) {
  const phoneHash = hashPhone(phone);
  const code = randomInt(0, 10 ** phoneSignupCodeLength).toString().padStart(phoneSignupCodeLength, "0");
  const createdAt = now.toISOString();
  const inheritedFailedAttemptCount = Math.max(
    0,
    ...challenges(db)
      .filter(
        (candidate) =>
          candidate.phoneHash === phoneHash &&
          !candidate.consumedAt &&
          Date.parse(candidate.expiresAt) > now.getTime() &&
          candidate.failedAttemptCount < phoneSignupMaxAttempts,
      )
      .map((candidate) => candidate.failedAttemptCount),
  );
  const challenge: PhoneSignupChallenge = {
    id: createRuntimeId("phone-signup"),
    phoneHash,
    codeHash: createPasswordHash(code, randomBytes(16).toString("hex")),
    createdAt,
    expiresAt: new Date(now.getTime() + phoneSignupCodeLifetimeMs).toISOString(),
    failedAttemptCount: inheritedFailedAttemptCount,
  };
  const retentionThreshold = now.getTime() - phoneSignupRetentionMs;
  const retained = challenges(db).filter((candidate) => {
    const referenceAt = Date.parse(candidate.consumedAt ?? candidate.expiresAt);
    return Number.isFinite(referenceAt) && referenceAt >= retentionThreshold;
  });

  return {
    challenge,
    code,
    db: {
      ...db,
      phoneSignupChallenges: [challenge, ...retained],
    },
  };
}

export type PhoneSignupVerificationResult =
  | { ok: true; db: MockDatabase }
  | { ok: false; db: MockDatabase; reason: "expired" | "invalid" };

export function verifyPhoneSignupCode(
  db: MockDatabase,
  phone: string,
  code: string,
  now = new Date(),
): PhoneSignupVerificationResult {
  const phoneHash = hashPhone(phone);
  const nowMs = now.getTime();
  const pending = challenges(db).filter(
    (candidate) => candidate.phoneHash === phoneHash && !candidate.consumedAt,
  );
  const active = pending.filter(
    (candidate) =>
      Date.parse(candidate.expiresAt) > nowMs &&
      candidate.failedAttemptCount < phoneSignupMaxAttempts,
  );

  if (active.length === 0) {
    runPasswordHashTimingEqualizer(code);

    if (pending.length === 0) {
      return { ok: false, db, reason: "expired" };
    }

    const consumedAt = now.toISOString();
    const pendingIds = new Set(pending.map((candidate) => candidate.id));
    return {
      ok: false,
      reason: "expired",
      db: {
        ...db,
        phoneSignupChallenges: challenges(db).map((candidate) =>
          pendingIds.has(candidate.id) ? { ...candidate, consumedAt } : candidate,
        ),
      },
    };
  }

  const matched = active.find((candidate) => verifyPassword(code, candidate.codeHash));

  if (!matched) {
    const failedAttemptCount = Math.max(...active.map((candidate) => candidate.failedAttemptCount)) + 1;
    const failedAt = now.toISOString();
    const activeIds = new Set(active.map((candidate) => candidate.id));
    return {
      ok: false,
      reason: "invalid",
      db: {
        ...db,
        phoneSignupChallenges: challenges(db).map((candidate) =>
          activeIds.has(candidate.id)
            ? {
                ...candidate,
                failedAttemptCount,
                ...(failedAttemptCount >= phoneSignupMaxAttempts ? { consumedAt: failedAt } : {}),
              }
            : candidate,
        ),
      },
    };
  }

  const consumedAt = now.toISOString();
  return {
    ok: true,
    db: {
      ...db,
      phoneSignupChallenges: challenges(db).map((candidate) =>
        candidate.phoneHash === phoneHash && !candidate.consumedAt
          ? { ...candidate, consumedAt }
          : candidate,
      ),
    },
  };
}

export function discardPhoneSignupChallenge(db: MockDatabase, challengeId: string) {
  return {
    ...db,
    phoneSignupChallenges: challenges(db).filter((challenge) => challenge.id !== challengeId),
  };
}
