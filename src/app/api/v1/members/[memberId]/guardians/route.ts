import { NextRequest } from "next/server";
import type { AppUser, AuditLog, Member } from "@/lib/domain";
import { canMemberHaveGuardianLink } from "@/lib/member-age-policy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, writeServerDb } from "@/server/db";

export const runtime = "nodejs";

type GuardianLinkBody = {
  guardianUserId?: string;
};

function linkMemberGuardian(member: Member, guardianUserId: string): Member {
  return {
    ...member,
    guardianIds: [...new Set([...member.guardianIds, guardianUserId])],
  };
}

function linkGuardianUser(user: AppUser, memberId: string, branchId: string): AppUser {
  return {
    ...user,
    branchIds: [...new Set([...user.branchIds, branchId])],
    childMemberIds: [...new Set([...(user.childMemberIds ?? []), memberId])],
  };
}

function unlinkMemberGuardian(member: Member, guardianUserId: string): Member {
  return {
    ...member,
    guardianIds: member.guardianIds.filter((candidate) => candidate !== guardianUserId),
  };
}

function unlinkGuardianUser(user: AppUser, memberId: string): AppUser {
  return {
    ...user,
    childMemberIds: (user.childMemberIds ?? []).filter((candidate) => candidate !== memberId),
  };
}

function replaceMemberGuardians(member: Member, guardianUserId: string): Member {
  return {
    ...member,
    guardianIds: [guardianUserId],
  };
}

function replaceGuardianUserLinks(users: AppUser[], member: Member, guardian: AppUser) {
  const affectedGuardianIds = new Set([...member.guardianIds, guardian.id]);

  return users.map((candidate) => {
    if (!affectedGuardianIds.has(candidate.id)) {
      return candidate;
    }

    return candidate.id === guardian.id
      ? linkGuardianUser(candidate, member.id, member.branchId)
      : unlinkGuardianUser(candidate, member.id);
  });
}

function canManageGuardianLinks(user: AppUser) {
  return user.role === "owner" || user.role === "admin";
}

function readGuardianUserId(body: GuardianLinkBody | null) {
  return body?.guardianUserId?.trim() ?? "";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!canManageGuardianLinks(user)) {
    return jsonError(403, "FORBIDDEN", "보호자 연결 권한이 없습니다.");
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(member.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  if (!canMemberHaveGuardianLink(member)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "성인 회원은 학부모 계정에 연결할 수 없습니다.");
  }

  const body = (await request.json().catch(() => null)) as GuardianLinkBody | null;
  const guardianUserId = readGuardianUserId(body);

  if (!guardianUserId) {
    return jsonError(400, "VALIDATION_ERROR", "연결할 학부모 계정을 선택해 주세요.");
  }

  const guardian = db.users.find((candidate) => candidate.id === guardianUserId);

  if (!guardian || guardian.role !== "guardian" || guardian.invitationStatus === "pending") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "활성 학부모 계정만 연결할 수 있습니다.");
  }

  if (member.guardianIds.includes(guardian.id)) {
    return jsonOk(createBootstrapPayload(db, user, selectedScope.selectedBranchId ?? member.branchId));
  }

  const nextMember = linkMemberGuardian(member, guardian.id);
  const nextGuardian = linkGuardianUser(guardian, member.id, member.branchId);
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: member.branchId,
    actorUserId: user.id,
    action: "member.update",
    targetType: "member",
    targetId: member.id,
    before: {
      guardianIds: member.guardianIds,
      guardianChildMemberIds: guardian.childMemberIds ?? [],
    },
    after: {
      guardianIds: nextMember.guardianIds,
      guardianUserId: guardian.id,
      guardianChildMemberIds: nextGuardian.childMemberIds ?? [],
    },
    result: "success",
    message: "보호자-자녀 연결을 추가했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    members: db.members.map((candidate) => (candidate.id === member.id ? nextMember : candidate)),
    users: db.users.map((candidate) => (candidate.id === guardian.id ? nextGuardian : candidate)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? member.branchId));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!canManageGuardianLinks(user)) {
    return jsonError(403, "FORBIDDEN", "보호자 연결 권한이 없습니다.");
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(member.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  if (!canMemberHaveGuardianLink(member)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "성인 회원은 학부모 계정에 연결할 수 없습니다.");
  }

  const body = (await request.json().catch(() => null)) as GuardianLinkBody | null;
  const guardianUserId = readGuardianUserId(body);

  if (!guardianUserId) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 학부모 계정을 선택해 주세요.");
  }

  const guardian = db.users.find((candidate) => candidate.id === guardianUserId);

  if (!guardian || guardian.role !== "guardian" || guardian.invitationStatus === "pending") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "활성 학부모 계정만 연결할 수 있습니다.");
  }

  if (member.guardianIds.length === 1 && member.guardianIds[0] === guardian.id) {
    return jsonOk(createBootstrapPayload(db, user, selectedScope.selectedBranchId ?? member.branchId));
  }

  const nextMember = replaceMemberGuardians(member, guardian.id);
  const nextUsers = replaceGuardianUserLinks(db.users, member, guardian);
  const nextGuardian = nextUsers.find((candidate) => candidate.id === guardian.id) ?? guardian;
  const previousGuardians = db.users.filter((candidate) => member.guardianIds.includes(candidate.id));
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: member.branchId,
    actorUserId: user.id,
    action: "member.update",
    targetType: "member",
    targetId: member.id,
    before: {
      guardianIds: member.guardianIds,
      guardianChildMemberIds: previousGuardians.map((candidate) => ({
        guardianUserId: candidate.id,
        childMemberIds: candidate.childMemberIds ?? [],
      })),
    },
    after: {
      guardianIds: nextMember.guardianIds,
      guardianUserId: guardian.id,
      guardianChildMemberIds: nextGuardian.childMemberIds ?? [],
    },
    result: "success",
    message: "보호자-자녀 연결을 변경했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    members: db.members.map((candidate) => (candidate.id === member.id ? nextMember : candidate)),
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? member.branchId));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!canManageGuardianLinks(user)) {
    return jsonError(403, "FORBIDDEN", "보호자 연결 권한이 없습니다.");
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(member.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
  }

  const body = (await request.json().catch(() => null)) as GuardianLinkBody | null;
  const guardianUserId = readGuardianUserId(body);

  if (!guardianUserId) {
    return jsonError(400, "VALIDATION_ERROR", "해제할 학부모 계정을 선택해 주세요.");
  }

  const guardian = db.users.find((candidate) => candidate.id === guardianUserId);

  if (!guardian || guardian.role !== "guardian") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "학부모 계정을 확인할 수 없습니다.");
  }

  if (!member.guardianIds.includes(guardian.id)) {
    return jsonOk(createBootstrapPayload(db, user, selectedScope.selectedBranchId ?? member.branchId));
  }

  const nextMember = unlinkMemberGuardian(member, guardian.id);
  const nextGuardian = unlinkGuardianUser(guardian, member.id);
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: member.branchId,
    actorUserId: user.id,
    action: "member.update",
    targetType: "member",
    targetId: member.id,
    before: {
      guardianIds: member.guardianIds,
      guardianUserId: guardian.id,
      guardianChildMemberIds: guardian.childMemberIds ?? [],
    },
    after: {
      guardianIds: nextMember.guardianIds,
      guardianUserId: guardian.id,
      guardianChildMemberIds: nextGuardian.childMemberIds ?? [],
    },
    result: "success",
    message: "보호자-자녀 연결을 해제했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    members: db.members.map((candidate) => (candidate.id === member.id ? nextMember : candidate)),
    users: db.users.map((candidate) => (candidate.id === guardian.id ? nextGuardian : candidate)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? member.branchId));
}
