import { NextRequest } from "next/server";
import type { AuditLog, MockDatabase } from "@/lib/domain";
import { getAuthInputLimitError } from "@/lib/auth-input-policy";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { createRandomPasswordHash, defaultPilotPassword } from "@/server/auth-password";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { jsonError, jsonOk } from "@/server/api";
import {
  authSecurityLockKey,
  hasReachedPasswordResetRequestLimit,
  revokeUserAuthSessions,
} from "@/server/auth-session";
import {
  consumePasswordResetChallenges,
  createPasswordResetChallenge,
  findVerifiedPasswordResetChallenge,
  passwordResetCodeLength,
  passwordResetMinimumPasswordLength,
  verifyPasswordResetCode,
} from "@/server/password-reset";
import {
  getPasswordResetSmsReadiness,
  sendPasswordResetSms,
} from "@/server/password-reset-sms";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

type PasswordResetBody =
  | { "action": "request"; phone: string }
  | { "action": "verify"; phone: string; code: string }
  | { "action": "complete"; resetToken: string; password: string };

function isPasswordResetBody(value: unknown): value is PasswordResetBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const body = value as Record<string, unknown>;

  if (body.action === "request") {
    return typeof body.phone === "string";
  }
  if (body.action === "verify") {
    return typeof body.phone === "string" && typeof body.code === "string";
  }
  if (body.action === "complete") {
    return typeof body.resetToken === "string" && typeof body.password === "string";
  }

  return false;
}

function createPasswordResetAudit(
  db: MockDatabase,
  input: {
    action: AuditLog["action"];
    createdAt: string;
    message: string;
    result: AuditLog["result"];
    userId: string;
    branchId: string | null;
    after?: Record<string, unknown> | null;
  },
): AuditLog {
  return {
    id: createRuntimeId("audit"),
    branchId: input.branchId,
    actorUserId: input.userId,
    action: input.action,
    targetType: "auth",
    targetId: input.userId,
    before: null,
    after: input.after ?? null,
    result: input.result,
    message: input.message,
    createdAt: input.createdAt,
  };
}

async function requestVerificationCode(phone: string) {
  const readiness = getPasswordResetSmsReadiness();

  if (!readiness.ready) {
    return jsonError(
      503,
      "PASSWORD_RESET_SMS_NOT_CONFIGURED",
      "휴대폰 인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  const reserved = await withServerDbLock(authSecurityLockKey, async () => {
    const db = await readServerDb();
    const user = db.users.find(
      (candidate) =>
        candidate.invitationStatus !== "pending" &&
        Boolean(candidate.passwordHash) &&
        samePhoneNumber(candidate.phone, phone),
    );

    if (!user) {
      return { kind: "anonymous" as const };
    }

    const now = new Date();

    if (hasReachedPasswordResetRequestLimit(db, user.id, now)) {
      return { kind: "limited" as const };
    }

    const createdAt = now.toISOString();
    const created = createPasswordResetChallenge(db, user.id, now);
    const auditLog = createPasswordResetAudit(created.db, {
      action: "auth.password_reset.request",
      branchId: user.branchIds[0] ?? null,
      createdAt,
      message: "비밀번호 변경 휴대폰 인증을 요청했습니다.",
      result: "success",
      userId: user.id,
      after: { verificationRequested: true },
    });

    await writeServerDb({
      ...created.db,
      users: created.db.users.map((candidate) =>
        candidate.id === user.id ? { ...candidate, passwordResetRequestedAt: createdAt } : candidate,
      ),
      auditLogs: [auditLog, ...created.db.auditLogs],
    });

    return {
      kind: "reserved" as const,
      challengeId: created.challenge.id,
      code: created.code,
      phone: normalizePhoneNumber(user.phone ?? ""),
      userId: user.id,
      branchId: user.branchIds[0] ?? null,
    };
  });

  if (reserved.kind !== "reserved") {
    return jsonOk({ ok: true, next: "verify" as const });
  }

  const delivery = await sendPasswordResetSms(readiness, {
    code: reserved.code,
    phone: reserved.phone,
  });

  if (!delivery.ok) {
    await withServerDbLock(authSecurityLockKey, async () => {
      const db = await readServerDb();
      const createdAt = new Date().toISOString();
      const auditLog = createPasswordResetAudit(db, {
        action: "auth.password_reset.request",
        branchId: reserved.branchId,
        createdAt,
        message: "비밀번호 변경 인증번호 발송에 실패했습니다.",
        result: "failed",
        userId: reserved.userId,
        after: { verificationDispatched: false },
      });

      await writeServerDb({
        ...db,
        passwordResetChallenges: db.passwordResetChallenges.filter(
          (challenge) => challenge.id !== reserved.challengeId,
        ),
        auditLogs: [auditLog, ...db.auditLogs],
      });
    });

    return jsonError(
      503,
      "PASSWORD_RESET_SMS_DELIVERY_FAILED",
      "인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  return jsonOk({
    ok: true,
    next: "verify" as const,
    ...(delivery.developmentCode ? { developmentCode: delivery.developmentCode } : {}),
  });
}

async function verifyCode(phone: string, code: string) {
  return withServerDbLock(authSecurityLockKey, async () => {
    const db = await readServerDb();
    const user = db.users.find(
      (candidate) =>
        candidate.invitationStatus !== "pending" &&
        Boolean(candidate.passwordHash) &&
        samePhoneNumber(candidate.phone, phone),
    );

    if (!user) {
      return jsonError(400, "PASSWORD_RESET_CODE_INVALID", "인증번호가 올바르지 않거나 만료되었습니다.");
    }

    const now = new Date();
    const result = verifyPasswordResetCode(db, user.id, code, now);

    if (!result.ok && result.db === db) {
      return jsonError(400, "PASSWORD_RESET_CODE_INVALID", "인증번호가 올바르지 않거나 만료되었습니다.");
    }

    const auditLog = createPasswordResetAudit(result.db, {
      action: "auth.password_reset.verify",
      branchId: user.branchIds[0] ?? null,
      createdAt: now.toISOString(),
      message: result.ok ? "비밀번호 변경 본인 확인을 완료했습니다." : "비밀번호 변경 본인 확인에 실패했습니다.",
      result: result.ok ? "success" : "failed",
      userId: user.id,
      after: { verificationCompleted: result.ok },
    });

    await writeServerDb({
      ...result.db,
      auditLogs: [auditLog, ...result.db.auditLogs],
    });

    if (!result.ok) {
      return jsonError(400, "PASSWORD_RESET_CODE_INVALID", "인증번호가 올바르지 않거나 만료되었습니다.");
    }

    return jsonOk({ ok: true, resetToken: result.resetToken });
  });
}

async function completePasswordReset(resetToken: string, password: string) {
  return withServerDbLock(authSecurityLockKey, async () => {
    const db = await readServerDb();
    const now = new Date();
    const challenge = findVerifiedPasswordResetChallenge(db, resetToken, now);

    if (!challenge) {
      return jsonError(400, "PASSWORD_RESET_TOKEN_INVALID", "비밀번호 변경 인증이 만료되었습니다. 다시 인증해 주세요.");
    }

    const user = db.users.find((candidate) => candidate.id === challenge.userId);

    if (!user || user.invitationStatus === "pending") {
      return jsonError(400, "PASSWORD_RESET_TOKEN_INVALID", "비밀번호 변경 인증이 만료되었습니다. 다시 인증해 주세요.");
    }

    if (password === defaultPilotPassword) {
      return jsonError(422, "SHARED_PASSWORD_BLOCKED", "공용 비밀번호는 사용할 수 없습니다.");
    }

    const passwordHash = createRandomPasswordHash(password);
    const updatedAt = now.toISOString();
    const revokedSessionCount = db.authSessions.filter(
      (session) => session.userId === user.id && !session.revokedAt,
    ).length;
    const dbWithUpdatedUser: MockDatabase = {
      ...db,
      users: db.users.map((candidate) => {
        if (candidate.id !== user.id) {
          return candidate;
        }

        return {
          ...candidate,
          passwordHash,
          passwordResetRequestedAt: undefined,
          passwordUpdatedAt: updatedAt,
        };
      }),
    };
    const consumedDb = consumePasswordResetChallenges(
      revokeUserAuthSessions(dbWithUpdatedUser, user.id, now),
      user.id,
      now,
    );
    const auditLog = createPasswordResetAudit(consumedDb, {
      action: "auth.password_reset.complete",
      branchId: user.branchIds[0] ?? null,
      createdAt: updatedAt,
      message: "휴대폰 본인 확인 후 비밀번호를 변경했습니다.",
      result: "success",
      userId: user.id,
      after: { passwordChanged: true, revokedSessionCount },
    });

    await writeServerDb({
      ...consumedDb,
      auditLogs: [auditLog, ...consumedDb.auditLogs],
    });

    return jsonOk({ ok: true });
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);

  if (!isPasswordResetBody(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "비밀번호 재설정 입력 형식이 올바르지 않습니다.");
  }

  const inputLimitError = getAuthInputLimitError(rawBody as unknown as Record<string, unknown>);

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  if (rawBody.action === "request") {
    const phone = normalizePhoneNumber(rawBody.phone);

    if (!isValidKoreanMobileNumber(phone)) {
      return jsonError(400, "VALIDATION_ERROR", "올바른 휴대폰 번호를 입력해 주세요.");
    }

    return requestVerificationCode(phone);
  }

  if (rawBody.action === "verify") {
    const phone = normalizePhoneNumber(rawBody.phone);
    const code = rawBody.code.trim();

    if (!isValidKoreanMobileNumber(phone) || !new RegExp(`^\\d{${passwordResetCodeLength}}$`).test(code)) {
      return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호와 6자리 인증번호를 확인해 주세요.");
    }

    return verifyCode(phone, code);
  }

  const resetToken = rawBody.resetToken.trim();

  if (
    !/^[A-Za-z0-9_-]{40,64}$/.test(resetToken) ||
    rawBody.password.length < passwordResetMinimumPasswordLength
  ) {
    return jsonError(400, "VALIDATION_ERROR", "비밀번호는 8자리 이상 입력해 주세요.");
  }

  return completePasswordReset(resetToken, rawBody.password);
}
