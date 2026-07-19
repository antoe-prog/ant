import { NextRequest } from "next/server";
import { getAuthInputLimitError } from "@/lib/auth-input-policy";
import type { AppUser, AuditLog, Member, MockDatabase } from "@/lib/domain";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { createRandomPasswordHash, defaultPilotPassword } from "@/server/auth-password";
import { createBootstrapPayload, jsonError, jsonOk } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";
import { findAcceptedBranchOperatorId } from "@/server/user-operational-reassignment";

export const runtime = "nodejs";

type RegisterBody = {
  branchId?: string;
  name?: string;
  password?: string;
  phone?: string;
};

function getAvailableSignupBranches(db: MockDatabase) {
  return db.branches
    .filter((branch) => branch.status !== "inactive")
    .map((branch) => ({ branch, operatorId: findAcceptedBranchOperatorId(db, branch.id) }))
    .filter((entry): entry is { branch: MockDatabase["branches"][number]; operatorId: string } => Boolean(entry.operatorId));
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

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "회원가입 입력 형식이 올바르지 않습니다.");
  }

  const body = rawBody as RegisterBody;

  if (
    (body.branchId !== undefined && typeof body.branchId !== "string") ||
    (body.name !== undefined && typeof body.name !== "string") ||
    (body.phone !== undefined && typeof body.phone !== "string") ||
    (body.password !== undefined && typeof body.password !== "string")
  ) {
    return jsonError(400, "VALIDATION_ERROR", "회원가입 입력 형식이 올바르지 않습니다.");
  }

  const inputLimitError = getAuthInputLimitError(rawBody as Record<string, unknown>);

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  const name = body.name?.trim() ?? "";
  const phone = normalizePhoneNumber(body.phone ?? "");
  const password = body.password ?? "";
  const requestedBranchId = body.branchId?.trim() ?? "";

  if (!name || !phone || !password) {
    return jsonError(400, "VALIDATION_ERROR", "이름, 휴대폰 번호, 비밀번호를 입력해 주세요.");
  }

  if (!isValidKoreanMobileNumber(phone)) {
    return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호 형식이 올바르지 않습니다.");
  }

  if (password.length < 8) {
    return jsonError(400, "VALIDATION_ERROR", "비밀번호는 8자 이상이어야 합니다.");
  }

  if (password === defaultPilotPassword) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "다른 비밀번호를 입력해 주세요.");
  }

  return withServerDbLock(`auth-register-phone:${phone}`, async () => {
    const db = await readServerDb();

    if (db.users.some((candidate) => samePhoneNumber(candidate.phone, phone))) {
      return jsonError(409, "CONFLICT", "이미 등록된 휴대폰 번호입니다.");
    }

    const availableBranches = getAvailableSignupBranches(db);

    if (availableBranches.length === 0) {
      return jsonError(503, "SERVICE_UNAVAILABLE", "현재 가입 가능한 지점이 없습니다.");
    }

    if (!requestedBranchId && availableBranches.length > 1) {
      return jsonError(400, "VALIDATION_ERROR", "가입 지점을 선택해 주세요.");
    }

    const selectedBranch = requestedBranchId
      ? availableBranches.find(({ branch: candidate }) => candidate.id === requestedBranchId)
      : availableBranches[0];

    if (!selectedBranch) {
      return jsonError(400, "VALIDATION_ERROR", "선택한 지점에서는 현재 가입할 수 없습니다.");
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
        phone,
        role: user.role,
        status: member.status,
      },
      result: "success",
      message: "휴대폰 회원가입을 완료했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...db,
      users: [user, ...db.users],
      members: [member, ...db.members],
      auditLogs: [auditLog, ...db.auditLogs],
    });

    return jsonOk({
      ...createBootstrapPayload(nextDb, user, branch.id),
      ok: true,
      userId,
      memberId,
    });
  });
}
