import { createHash, randomBytes, randomInt } from "node:crypto";
import type { MockDatabase, PasswordResetChallenge } from "../lib/domain.ts";
import {
  createPasswordHash,
  runPasswordHashTimingEqualizer,
  verifyPassword,
} from "./auth-password.ts";
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
  const inheritedFailedAttemptCount = Math.max(
    0,
    ...db.passwordResetChallenges
      .filter(
        (candidate) =>
          candidate.userId === userId &&
          !candidate.consumedAt &&
          !candidate.verifiedAt &&
          Date.parse(candidate.expiresAt) > now.getTime() &&
          candidate.failedAttemptCount < passwordResetMaxAttempts,
      )
      .map((candidate) => candidate.failedAttemptCount),
  );
  const challenge: PasswordResetChallenge = {
    id: createRuntimeId("password-reset"),
    userId,
    codeHash: createPasswordHash(code, randomBytes(16).toString("hex")),
    createdAt,
    expiresAt: new Date(now.getTime() + passwordResetCodeLifetimeMs).toISOString(),
    failedAttemptCount: inheritedFailedAttemptCount,
  };
  const retentionThreshold = now.getTime() - passwordResetRetentionMs;
  const passwordResetChallenges = db.passwordResetChallenges.filter((candidate) => {
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
  const nowMs = now.getTime();
  const pendingChallenges = db.passwordResetChallenges.filter(
    (candidate) => candidate.userId === userId && !candidate.consumedAt && !candidate.verifiedAt,
  );
  const activeChallenges = pendingChallenges.filter(
    (candidate) =>
      Date.parse(candidate.expiresAt) > nowMs &&
      candidate.failedAttemptCount < passwordResetMaxAttempts,
  );

  if (activeChallenges.length === 0) {
    runPasswordHashTimingEqualizer(code);

    if (pendingChallenges.length === 0) {
      return { ok: false, db, reason: "expired" };
    }

    const consumedAt = now.toISOString();
    const pendingChallengeIds = new Set(pendingChallenges.map((candidate) => candidate.id));

    return {
      ok: false,
      reason: "expired",
      db: {
        ...db,
        passwordResetChallenges: db.passwordResetChallenges.map((candidate) =>
          pendingChallengeIds.has(candidate.id)
            ? { ...candidate, consumedAt }
            : candidate,
        ),
      },
    };
  }

  const challenge = activeChallenges.find((candidate) => verifyPassword(code, candidate.codeHash));

  if (!challenge) {
    const failedAttemptCount = Math.max(...activeChallenges.map((candidate) => candidate.failedAttemptCount)) + 1;
    const failedAt = now.toISOString();
    const activeChallengeIds = new Set(activeChallenges.map((candidate) => candidate.id));
    const staleChallengeIds = new Set(
      pendingChallenges
        .filter((candidate) => !activeChallengeIds.has(candidate.id))
        .map((candidate) => candidate.id),
    );

    return {
      ok: false,
      reason: "invalid",
      db: {
        ...db,
        passwordResetChallenges: db.passwordResetChallenges.map((candidate) =>
          activeChallengeIds.has(candidate.id)
            ? {
                ...candidate,
                failedAttemptCount,
                ...(failedAttemptCount >= passwordResetMaxAttempts ? { consumedAt: failedAt } : {}),
              }
            : staleChallengeIds.has(candidate.id)
              ? { ...candidate, consumedAt: failedAt }
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
        candidate.id === challenge.id
          ? updatedChallenge
          : candidate.userId === userId && !candidate.consumedAt
            ? { ...candidate, consumedAt: verifiedAt }
            : candidate,
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

export function discardPasswordResetChallenge(db: MockDatabase, challengeId: string) {
  return {
    ...db,
    passwordResetChallenges: db.passwordResetChallenges.filter(
      (challenge) => challenge.id !== challengeId,
    ),
  };
}

export function reconcileFailedPasswordResetDelivery(
  db: MockDatabase,
  input: {
    auditLogId: string;
    challengeId: string;
    requestedAt: string;
    userId: string;
  },
) {
  const discardedDb = discardPasswordResetChallenge(db, input.challengeId);

  return {
    ...discardedDb,
    users: discardedDb.users.map((user) =>
      user.id === input.userId && user.passwordResetRequestedAt === input.requestedAt
        ? { ...user, passwordResetRequestedAt: undefined }
        : user,
    ),
    auditLogs: discardedDb.auditLogs.map((log) =>
      log.id === input.auditLogId
        ? {
            ...log,
            result: "failed" as const,
            message: "비밀번호 변경 인증번호 발송에 실패했습니다.",
            after: {
              ...(log.after ?? {}),
              verificationDispatched: false,
            },
          }
        : log,
    ),
  };
}
