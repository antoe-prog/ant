import { createHash, randomBytes, randomInt } from "node:crypto";
import type { MockDatabase, PasswordResetChallenge } from "../lib/domain.ts";
import { createPasswordHash, verifyPassword } from "./auth-password.ts";
import { createRuntimeId } from "./runtime-id.ts";

export const passwordResetCodeLength = 6;
export const passwordResetCodeLifetimeMs = 10 * 60 * 1_000;
export const passwordResetMaxAttempts = 5;
export const passwordResetMinimumPasswordLength = 8;

const passwordResetRetentionMs = 24 * 60 * 60 * 1_000;

function hashResetToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPasswordResetChallenge(db: MockDatabase, userId: string, now = new Date()) {
  const code = randomInt(0, 10 ** passwordResetCodeLength).toString().padStart(passwordResetCodeLength, "0");
  const createdAt = now.toISOString();
  const challenge: PasswordResetChallenge = {
    id: createRuntimeId("password-reset"),
    userId,
    codeHash: createPasswordHash(code, randomBytes(16).toString("hex")),
    createdAt,
    expiresAt: new Date(now.getTime() + passwordResetCodeLifetimeMs).toISOString(),
    failedAttemptCount: 0,
  };
  const retentionThreshold = now.getTime() - passwordResetRetentionMs;
  const passwordResetChallenges = db.passwordResetChallenges.filter((candidate) => {
    if (candidate.userId === userId) {
      return false;
    }

    const referenceAt = Date.parse(candidate.consumedAt ?? candidate.expiresAt);
    return Number.isFinite(referenceAt) && referenceAt >= retentionThreshold;
  });

  return {
    challenge,
    code,
    db: {
      ...db,
      passwordResetChallenges: [challenge, ...passwordResetChallenges],
    },
  };
}

export type PasswordResetVerificationResult =
  | { ok: true; db: MockDatabase; resetToken: string; userId: string }
  | { ok: false; db: MockDatabase; reason: "expired" | "invalid" };

export function verifyPasswordResetCode(
  db: MockDatabase,
  userId: string,
  code: string,
  now = new Date(),
): PasswordResetVerificationResult {
  const challenge = db.passwordResetChallenges.find(
    (candidate) => candidate.userId === userId && !candidate.consumedAt && !candidate.verifiedAt,
  );
  const nowMs = now.getTime();

  if (!challenge) {
    return { ok: false, db, reason: "expired" };
  }

  if (Date.parse(challenge.expiresAt) <= nowMs || challenge.failedAttemptCount >= passwordResetMaxAttempts) {
    const consumedAt = now.toISOString();

    return {
      ok: false,
      reason: "expired",
      db: {
        ...db,
        passwordResetChallenges: db.passwordResetChallenges.map((candidate) =>
          candidate.id === challenge.id ? { ...candidate, consumedAt } : candidate,
        ),
      },
    };
  }

  if (!verifyPassword(code, challenge.codeHash)) {
    const failedAttemptCount = challenge.failedAttemptCount + 1;
    const failedAt = now.toISOString();

    return {
      ok: false,
      reason: "invalid",
      db: {
        ...db,
        passwordResetChallenges: db.passwordResetChallenges.map((candidate) =>
          candidate.id === challenge.id
            ? {
                ...candidate,
                failedAttemptCount,
                ...(failedAttemptCount >= passwordResetMaxAttempts ? { consumedAt: failedAt } : {}),
              }
            : candidate,
        ),
      },
    };
  }

  const resetToken = randomBytes(32).toString("base64url");
  const verifiedAt = now.toISOString();
  const updatedChallenge: PasswordResetChallenge = {
    ...challenge,
    resetTokenHash: hashResetToken(resetToken),
    verifiedAt,
    expiresAt: new Date(nowMs + passwordResetCodeLifetimeMs).toISOString(),
  };

  return {
    ok: true,
    resetToken,
    userId,
    db: {
      ...db,
      passwordResetChallenges: db.passwordResetChallenges.map((candidate) =>
        candidate.id === challenge.id ? updatedChallenge : candidate,
      ),
    },
  };
}

export function findVerifiedPasswordResetChallenge(
  db: MockDatabase,
  resetToken: string,
  now = new Date(),
) {
  const tokenHash = hashResetToken(resetToken);
  const challenge = db.passwordResetChallenges.find(
    (candidate) =>
      candidate.resetTokenHash === tokenHash &&
      Boolean(candidate.verifiedAt) &&
      !candidate.consumedAt &&
      Date.parse(candidate.expiresAt) > now.getTime(),
  );

  return challenge ?? null;
}

export function consumePasswordResetChallenges(db: MockDatabase, userId: string, now = new Date()) {
  const consumedAt = now.toISOString();

  return {
    ...db,
    passwordResetChallenges: db.passwordResetChallenges.map((challenge) =>
      challenge.userId === userId && !challenge.consumedAt ? { ...challenge, consumedAt } : challenge,
    ),
  };
}
