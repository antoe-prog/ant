import { NextRequest } from "next/server";
import type { AppUser, AuditLog, UserRole } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { isValidKoreanMobileNumber, normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

type InvitationBody = {
  name?: string;
  email?: string;
  phone?: string;
  role?: UserRole;
  branchIds?: string[];
};

function createToken() {
  return `invite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const branchScopedInviteRoles: UserRole[] = ["coach", "guardian", "member"];

export async function POST(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin" && user.role !== "owner") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민 또는 대표만 사용자를 초대할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const body = (await request.json().catch(() => null)) as InvitationBody | null;
  const name = body?.name?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";
  const phone = normalizePhoneNumber(body?.phone ?? "");
  const role = body?.role;
  const branchIds = [...new Set(body?.branchIds ?? [])];

  if (!name || !phone || !role || !userRoles.includes(role)) {
    return jsonError(400, "VALIDATION_ERROR", "이름, 휴대폰 번호, 역할이 필요합니다.");
  }

  if (selectedScope.selectedBranchId && role !== "admin" && branchIds.some((branchId) => branchId !== selectedScope.selectedBranchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 사용자만 초대할 수 있습니다.");
  }

  if (!isValidKoreanMobileNumber(phone)) {
    return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호 형식이 올바르지 않습니다.");
  }

  if (user.role === "owner" && !branchScopedInviteRoles.includes(role)) {
    return jsonError(403, "FORBIDDEN", "대표는 코치, 학부모, 회원만 초대할 수 있습니다.");
  }

  if (db.users.some((candidate) => samePhoneNumber(candidate.phone, phone))) {
    return jsonError(409, "CONFLICT", "이미 등록된 휴대폰 번호입니다.");
  }

  if (email && db.users.some((candidate) => candidate.email?.toLowerCase() === email)) {
    return jsonError(409, "CONFLICT", "이미 등록된 이메일입니다.");
  }

  const accessibleBranchIds = getAccessibleBranchIds(user, db);

  if (role !== "admin") {
    const invalidBranchId = branchIds.find(
      (branchId) =>
        !db.branches.some((branch) => branch.id === branchId) ||
        (user.role === "owner" && !accessibleBranchIds.includes(branchId)),
    );

    if (invalidBranchId) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "접근 가능한 지점만 배정할 수 있습니다.", { branchId: invalidBranchId });
    }
  }

  const assignedBranchIds = role === "admin" ? accessibleBranchIds : branchIds;

  if (role !== "admin" && assignedBranchIds.length === 0) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "총괄 어드민 외 역할은 최소 1개 지점이 필요합니다.");
  }

  const now = new Date().toISOString();
  const invitedUser: AppUser = {
    id: `user-${Date.now()}`,
    ...(email ? { email } : {}),
    name,
    phone,
    role,
    title: `${name} 초대 대기`,
    branchIds: assignedBranchIds,
    invitationStatus: "pending",
    invitationToken: createToken(),
    invitedAt: now,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: assignedBranchIds[0] ?? null,
    actorUserId: user.id,
    action: "user.invite.create",
    targetType: "user",
    targetId: invitedUser.id,
    before: null,
    after: {
      email,
      phone,
      role,
      branchIds: assignedBranchIds,
      invitationStatus: "pending",
    },
    result: "success",
    message: "사용자를 초대했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    users: [invitedUser, ...db.users],
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk({
    ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId),
    invitation: {
      userId: invitedUser.id,
      token: invitedUser.invitationToken,
      path: `/invite/${invitedUser.invitationToken}`,
    },
  });
}
