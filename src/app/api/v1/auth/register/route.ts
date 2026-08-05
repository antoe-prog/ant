import { after, NextRequest } from "next/server";
import { getAuthInputLimitError } from "@/lib/auth-input-policy";
import type { AppUser, AuditLog, Member, MockDatabase } from "@/lib/domain";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import {
  createRandomPasswordHash,
  defaultPilotPassword,
  runPasswordHashTimingEqualizer,
} from "@/server/auth-password";
import { createBootstrapPayload, jsonError, jsonOk } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import {
  createPhoneSignupChallenge,
  discardPhoneSignupChallenge,
  hasReachedPhoneSignupRequestLimit,
  phoneSignupCodeLength,
  verifyPhoneSignupCode,
} from "@/server/phone-signup-verification";
import {
  getPasswordResetSmsReadiness,
  sendPasswordResetSms,
} from "@/server/password-reset-sms";
import { createRuntimeId } from "@/server/runtime-id";
import { findAcceptedBranchOperatorId } from "@/server/user-operational-reassignment";

export const runtime = "nodejs";

type RegisterBody =
  | { action: "request"; phone: string }
  | { action: "complete"; branchId: string; code: string; name: string; password: string; phone: string };

function isRegisterBody(value: unknown): value is RegisterBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const body = value as Record<string, unknown>;

  if (body.action === "request") {
    return typeof body.phone === "string";
  }

  if (body.action === "complete") {
    return (
      typeof body.branchId === "string" &&
      typeof body.code === "string" &&
      typeof body.name === "string" &&
      typeof body.password === "string" &&
      typeof body.phone === "string"
    );
  }

  return false;
}

function getAvailableSignupBranches(db: MockDatabase) {
  return db.branches
    .filter((branch) => branch.status !== "inactive")
    .map((branch) => ({ branch, operatorId: findAcceptedBranchOperatorId(db, branch.id) }))
    .filter((entry): entry is { branch: MockDatabase["branches"][number]; operatorId: string } => Boolean(entry.operatorId));
}

async function requestVerificationCode(phone: string) {
  const readiness = await getPasswordResetSmsReadiness();

  if (!readiness.ready) {
    return jsonError(
      503,
      "SIGNUP_SMS_NOT_CONFIGURED",
      "휴대폰 인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  const reserved = await withServerDbLock(`auth-register-phone:${phone}`, async () => {
    const db = await readServerDb();
    const now = new Date();

    if (hasReachedPhoneSignupRequestLimit(db, phone, now)) {
      runPasswordHashTimingEqualizer(phone);
      return { kind: "limited" as const };
    }

    const phoneAlreadyRegistered = db.users.some((candidate) => samePhoneNumber(candidate.phone, phone));
    const created = createPhoneSignupChallenge(db, phone, now);

    await writeServerDb(created.db);

    return {
      kind: "reserved" as const,
      challengeId: created.challenge.id,
      code: created.code,
      deliverable: !phoneAlreadyRegistered,
    };
  });

  if (reserved.kind !== "reserved") {
    return jsonOk({ ok: true, next: "verify" as const });
  }

  const deliverReservedCode = async () => {
    if (!reserved.deliverable) {
      return { ok: true as const };
    }

    const delivery = await sendPasswordResetSms(readiness, {
      code: reserved.code,
      phone,
      purpose: "signup",
    });

    if (!delivery.ok) {
      await withServerDbLock(`auth-register-phone:${phone}`, async () => {
        const db = await readServerDb();
        await writeServerDb(discardPhoneSignupChallenge(db, reserved.challengeId));
      });
    }

    return delivery;
  };

  if (readiness.mode === "webhook") {
    after(async () => {
      try {
        await deliverReservedCode();
      } catch {
        // The bounded challenge expires automatically; a retry reserves a new challenge.
      }
    });

    return jsonOk({ ok: true, next: "verify" as const });
  }

  const delivery = await deliverReservedCode();

  return jsonOk({
    ok: true,
    next: "verify" as const,
    ...(delivery.ok && "developmentCode" in delivery && delivery.developmentCode
      ? { developmentCode: delivery.developmentCode }
      : {}),
  });
}

async function completeRegistration(body: Extract<RegisterBody, { action: "complete" }>) {
  const name = body.name.trim();
  const phone = normalizePhoneNumber(body.phone);
  const password = body.password;
  const requestedBranchId = body.branchId.trim();
  const code = body.code.trim();

  if (!name || !phone || !password || !requestedBranchId || !code) {
    return jsonError(400, "VALIDATION_ERROR", "이름, 지점, 휴대폰 번호, 인증번호와 비밀번호를 입력해 주세요.");
  }

  if (!isValidKoreanMobileNumber(phone)) {
    return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호 형식이 올바르지 않습니다.");
  }

  if (!new RegExp(`^\\d{${phoneSignupCodeLength}}$`).test(code)) {
    return jsonError(400, "VALIDATION_ERROR", "6자리 인증번호를 확인해 주세요.");
  }

  if (password.length < 8) {
    return jsonError(400, "VALIDATION_ERROR", "비밀번호는 8자 이상이어야 합니다.");
  }

  if (password === defaultPilotPassword) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "다른 비밀번호를 입력해 주세요.");
  }

  return withServerDbLock(`auth-register-phone:${phone}`, async () => {
    const db = await readServerDb();
    const availableBranches = getAvailableSignupBranches(db);

    if (availableBranches.length === 0) {
      return jsonError(503, "SERVICE_UNAVAILABLE", "현재 가입 가능한 지점이 없습니다.");
    }

    const selectedBranch = availableBranches.find(({ branch: candidate }) => candidate.id === requestedBranchId);

    if (!selectedBranch) {
      return jsonError(400, "VALIDATION_ERROR", "선택한 지점에서는 현재 가입할 수 없습니다.");
    }

    const verification = verifyPhoneSignupCode(db, phone, code, new Date());
    const phoneAlreadyRegistered = db.users.some((candidate) => samePhoneNumber(candidate.phone, phone));

    if (!verification.ok || phoneAlreadyRegistered) {
      if (verification.db !== db) {
        await writeServerDb(verification.db);
      }

      return jsonError(400, "SIGNUP_CODE_INVALID", "인증번호가 올바르지 않거나 만료되었습니다.");
    }

    const { branch, operatorId: branchOperatorId } = selectedBranch;
    const now = new Date().toISOString();
    const userId = createRuntimeId("user-member");
    const memberId = createRuntimeId("member");
    const user: AppUser = {
      id: userId,
      name,
      passwordHash: createRandomPasswordHash(password),
      passwordUpdatedAt: now,
      phone,
      role: "member",
      title: "성인 회원",
      branchIds: [branch.id],
      memberIds: [memberId],
    };
    const member: Member = {
      id: memberId,
      alerts: [],
      ageGroup: "adult",
      belt: "흰띠",
      branchId: branch.id,
      createdAt: now,
      emergencyContact: phone,
      guardianIds: [],
      level: "입문",
      primaryCoachId: branchOperatorId,
      status: "trial",
      statusChangedAt: now,
      name,
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: branch.id,
      actorUserId: user.id,
      action: "member.create",
      targetType: "member",
      targetId: member.id,
      before: null,
      after: {
        accountCreated: true,
        ageGroup: member.ageGroup,
        branchId: branch.id,
        role: user.role,
        status: member.status,
      },
      result: "success",
      message: "휴대폰 본인 확인 후 회원가입을 완료했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...verification.db,
      users: [user, ...verification.db.users],
      members: [member, ...verification.db.members],
      auditLogs: [auditLog, ...verification.db.auditLogs],
    });

    return jsonOk({
      ...createBootstrapPayload(nextDb, user, branch.id),
      ok: true,
      userId,
      memberId,
    });
  });
}

export async function GET() {
  const db = await readServerDb();
  const availableBranches = getAvailableSignupBranches(db);

  if (availableBranches.length === 0) {
    return jsonError(503, "SERVICE_UNAVAILABLE", "현재 가입 가능한 지점이 없습니다.");
  }

  return jsonOk({
    branches: availableBranches.map(({ branch }) => ({
      district: branch.district,
      id: branch.id,
      name: branch.name,
    })),
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);

  if (!isRegisterBody(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "회원가입 입력 형식이 올바르지 않습니다.");
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

  return completeRegistration(rawBody);
}
