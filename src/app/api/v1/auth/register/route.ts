import { NextRequest } from "next/server";
import type { AppUser, AuditLog, Member } from "@/lib/domain";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { createRandomPasswordHash } from "@/server/auth-password";
import { createBootstrapPayload, jsonError, jsonOk } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";
import { findAcceptedBranchOperatorId } from "@/server/user-operational-reassignment";

export const runtime = "nodejs";

type RegisterBody = {
  name?: string;
  password?: string;
  phone?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RegisterBody | null;
  const name = body?.name?.trim() ?? "";
  const phone = normalizePhoneNumber(body?.phone ?? "");
  const password = body?.password ?? "";

  if (!name || !phone || !password) {
    return jsonError(400, "VALIDATION_ERROR", "이름, 휴대폰 번호, 비밀번호를 입력해 주세요.");
  }

  if (!isValidKoreanMobileNumber(phone)) {
    return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호 형식이 올바르지 않습니다.");
  }

  if (password.length < 8) {
    return jsonError(400, "VALIDATION_ERROR", "비밀번호는 8자 이상이어야 합니다.");
  }

  return withServerDbLock(`auth-register-phone:${phone}`, async () => {
    const db = await readServerDb();

    if (db.users.some((candidate) => samePhoneNumber(candidate.phone, phone))) {
      return jsonError(409, "CONFLICT", "이미 등록된 휴대폰 번호입니다.");
    }

    const branch = db.branches.find((candidate) => candidate.status !== "inactive") ?? db.branches[0];

    if (!branch) {
      return jsonError(503, "SERVICE_UNAVAILABLE", "가입 가능한 지점을 찾지 못했습니다.");
    }

    const branchOperatorId = findAcceptedBranchOperatorId(db, branch.id);

    if (!branchOperatorId) {
      return jsonError(503, "SERVICE_UNAVAILABLE", "가입 지점의 담당 운영자가 준비되지 않았습니다.");
    }

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
