import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AttendanceQrChallenge, MockDatabase } from "../lib/domain.ts";
import {
  attendanceQrLifetimeMs,
  attendanceQrPayloadMaxLength,
  attendanceQrPayloadPrefix,
} from "../lib/attendance-qr-policy.ts";
import { createRuntimeId } from "./runtime-id.ts";

export { attendanceQrPayloadMaxLength } from "../lib/attendance-qr-policy.ts";

const attendanceQrRetentionMs = 24 * 60 * 60 * 1_000;

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function equalTokenHash(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function parseAttendanceQrPayload(payload: string) {
  const normalized = payload.trim();

  if (!normalized.startsWith(attendanceQrPayloadPrefix) || normalized.length > attendanceQrPayloadMaxLength) {
    return null;
  }

  const token = normalized.slice(attendanceQrPayloadPrefix.length);

  return /^[A-Za-z0-9_-]{40,64}$/.test(token) ? token : null;
}

export function createAttendanceQrChallenge(
  db: MockDatabase,
  options: { branchId: string; sessionId: string; userId: string; now?: Date },
) {
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + attendanceQrLifetimeMs).toISOString();
  const token = randomBytes(32).toString("base64url");
  const challenge: AttendanceQrChallenge = {
    id: createRuntimeId("attendance-qr"),
    tokenHash: hashToken(token),
    userId: options.userId,
    branchId: options.branchId,
    sessionId: options.sessionId,
    redeemedMemberIds: [],
    createdAt,
    expiresAt,
  };
  const retentionThreshold = now.getTime() - attendanceQrRetentionMs;
  const attendanceQrChallenges = db.attendanceQrChallenges.filter((candidate) => {
    if (candidate.sessionId === options.sessionId) {
      return false;
    }

    const referenceAt = Date.parse(candidate.expiresAt);
    return Number.isFinite(referenceAt) && referenceAt >= retentionThreshold;
  });

  return {
    challenge,
    db: {
      ...db,
      attendanceQrChallenges: [challenge, ...attendanceQrChallenges],
    },
    payload: `${attendanceQrPayloadPrefix}${token}`,
  };
}

export type AttendanceQrLookupResult =
  | { ok: true; challenge: AttendanceQrChallenge }
  | { ok: false; reason: "expired" | "invalid" };

export function findAttendanceQrChallenge(
  db: MockDatabase,
  payload: string,
  now = new Date(),
): AttendanceQrLookupResult {
  const token = parseAttendanceQrPayload(payload);

  if (!token) {
    return { ok: false, reason: "invalid" };
  }

  const tokenHash = hashToken(token);
  const challenge = db.attendanceQrChallenges.find((candidate) => equalTokenHash(candidate.tokenHash, tokenHash));

  if (!challenge) {
    return { ok: false, reason: "invalid" };
  }

  if (Date.parse(challenge.expiresAt) <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, challenge };
}

export function redeemAttendanceQrChallenge(
  db: MockDatabase,
  challengeId: string,
  memberId: string,
) {
  return {
    ...db,
    attendanceQrChallenges: db.attendanceQrChallenges.map((challenge) =>
      challenge.id === challengeId
        ? {
            ...challenge,
            redeemedMemberIds: challenge.redeemedMemberIds.includes(memberId)
              ? challenge.redeemedMemberIds
              : [...challenge.redeemedMemberIds, memberId],
          }
        : challenge,
    ),
  };
}
