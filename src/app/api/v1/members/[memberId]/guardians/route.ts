import { NextRequest } from "next/server";
import type { AppUser, AuditLog, Member } from "@/lib/domain";
import { syncGuardianUserFamilyLinks } from "@/lib/family-members";
import { parseGuardianLinkInput } from "@/lib/member-guardian-input-policy";
import { canMemberHaveGuardianLink } from "@/lib/member-age-policy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

type GuardianLinkRouteContext = {
  params: Promise<{ memberId: string }>;
};

const guardianLinkStateLockKey = "member-guardian-links";

function linkMemberGuardian(member: Member, guardianUserId: string): Member {
  return {
    ...member,
    guardianIds: [...new Set([...member.guardianIds, guardianUserId])],
  };
}

function unlinkMemberGuardian(member: Member, guardianUserId: string): Member {
  return {
    ...member,
    guardianIds: member.guardianIds.filter((candidate) => candidate !== guardianUserId),
  };
}

function replaceMemberGuardians(member: Member, guardianUserId: string): Member {
  return {
    ...member,
    guardianIds: [guardianUserId],
  };
}

function syncAffectedGuardianUsers(users: AppUser[], members: Member[], guardianUserIds: Iterable<string>) {
  const affectedGuardianIds = new Set(guardianUserIds);

  return users.map((candidate) =>
    affectedGuardianIds.has(candidate.id) ? syncGuardianUserFamilyLinks(candidate, members) : candidate,
  );
}

function hasReciprocalGuardianLink(member: Member, guardian: AppUser) {
  return (
    member.guardianIds.includes(guardian.id) &&
    (guardian.childMemberIds ?? []).includes(member.id) &&
    guardian.branchIds.includes(member.branchId)
  );
}

function canManageGuardianLinks(user: AppUser) {
  return user.role === "owner" || user.role === "admin";
}

function canAssignGuardian(user: AppUser, guardian: AppUser, memberBranchId: string) {
  if (user.role === "admin") {
    return true;
  }

  return guardian.branchIds.includes(memberBranchId);
}

async function requireGuardianLinkRequestContext(
  request: NextRequest,
  { params }: GuardianLinkRouteContext,
  requireEligibleMember: boolean,
) {
  const { memberId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { context: null, response };
  }

  if (!canManageGuardianLinks(user)) {
    return { context: null, response: jsonError(403, "FORBIDDEN", "보호자 연결 권한이 없습니다.") };
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member || !getAccessibleBranchIds(user, db).includes(member.branchId)) {
    return { context: null, response: jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.") };
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { context: null, response: selectedScope.response };
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
    return {
      context: null,
      response: jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다."),
    };
  }

  if (requireEligibleMember && !canMemberHaveGuardianLink(member)) {
    return {
      context: null,
      response: jsonError(422, "BUSINESS_RULE_FAILED", "성인 회원은 학부모 계정에 연결할 수 없습니다."),
    };
  }

  return {
    context: {
      db,
      member,
      selectedBranchId: selectedScope.selectedBranchId ?? member.branchId,
      user,
    },
    response: null,
  };
}

async function createGuardianLink(
  request: NextRequest,
  routeContext: GuardianLinkRouteContext,
  guardianUserId: string,
) {
  const currentContext = await requireGuardianLinkRequestContext(request, routeContext, true);

  if (!currentContext.context) {
    return currentContext.response;
  }

  const { db, member, selectedBranchId, user } = currentContext.context;

  const guardian = db.users.find((candidate) => candidate.id === guardianUserId);

  if (
    !guardian ||
    guardian.role !== "guardian" ||
    guardian.invitationStatus === "pending" ||
    !canAssignGuardian(user, guardian, member.branchId)
  ) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "활성 학부모 계정만 연결할 수 있습니다.");
  }

  if (hasReciprocalGuardianLink(member, guardian)) {
    return jsonOk(createBootstrapPayload(db, user, selectedBranchId));
  }

  const repairsExistingMemberLink = member.guardianIds.includes(guardian.id);
  const nextMember = linkMemberGuardian(member, guardian.id);
  const nextMembers = db.members.map((candidate) => (candidate.id === member.id ? nextMember : candidate));
  const nextUsers = syncAffectedGuardianUsers(db.users, nextMembers, [guardian.id]);
  const nextGuardian = nextUsers.find((candidate) => candidate.id === guardian.id) ?? guardian;
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
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
    message: repairsExistingMemberLink
      ? "보호자-자녀 연결 정보를 복구했습니다."
      : "보호자-자녀 연결을 추가했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    members: nextMembers,
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId));
}

async function replaceGuardianLink(
  request: NextRequest,
  routeContext: GuardianLinkRouteContext,
  guardianUserId: string,
) {
  const currentContext = await requireGuardianLinkRequestContext(request, routeContext, true);

  if (!currentContext.context) {
    return currentContext.response;
  }

  const { db, member, selectedBranchId, user } = currentContext.context;

  const guardian = db.users.find((candidate) => candidate.id === guardianUserId);

  if (
    !guardian ||
    guardian.role !== "guardian" ||
    guardian.invitationStatus === "pending" ||
    !canAssignGuardian(user, guardian, member.branchId)
  ) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "활성 학부모 계정만 연결할 수 있습니다.");
  }

  if (
    member.guardianIds.length === 1 &&
    member.guardianIds[0] === guardian.id &&
    hasReciprocalGuardianLink(member, guardian)
  ) {
    return jsonOk(createBootstrapPayload(db, user, selectedBranchId));
  }

  const repairsExistingMemberLink = member.guardianIds.length === 1 && member.guardianIds[0] === guardian.id;
  const nextMember = replaceMemberGuardians(member, guardian.id);
  const nextMembers = db.members.map((candidate) => (candidate.id === member.id ? nextMember : candidate));
  const nextUsers = syncAffectedGuardianUsers(db.users, nextMembers, [...member.guardianIds, guardian.id]);
  const nextGuardian = nextUsers.find((candidate) => candidate.id === guardian.id) ?? guardian;
  const previousGuardians = db.users.filter((candidate) => member.guardianIds.includes(candidate.id));
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
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
    message: repairsExistingMemberLink
      ? "보호자-자녀 연결 정보를 복구했습니다."
      : "보호자-자녀 연결을 변경했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    members: nextMembers,
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId));
}

async function deleteGuardianLink(
  request: NextRequest,
  routeContext: GuardianLinkRouteContext,
  guardianUserId: string,
) {
  const currentContext = await requireGuardianLinkRequestContext(request, routeContext, false);

  if (!currentContext.context) {
    return currentContext.response;
  }

  const { db, member, selectedBranchId, user } = currentContext.context;

  const guardian = db.users.find((candidate) => candidate.id === guardianUserId);
  const hasMemberLink = member.guardianIds.includes(guardianUserId);
  const hasGuardianLink =
    guardian?.role === "guardian" && (guardian.childMemberIds ?? []).includes(member.id);

  if (!hasMemberLink && !hasGuardianLink) {
    return jsonOk(createBootstrapPayload(db, user, selectedBranchId));
  }

  if (!guardian || guardian.role !== "guardian") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "학부모 계정을 확인할 수 없습니다.");
  }

  const nextMember = unlinkMemberGuardian(member, guardian.id);
  const nextMembers = db.members.map((candidate) => (candidate.id === member.id ? nextMember : candidate));
  const nextUsers = syncAffectedGuardianUsers(db.users, nextMembers, [guardian.id]);
  const nextGuardian = nextUsers.find((candidate) => candidate.id === guardian.id) ?? guardian;
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
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
    message: hasMemberLink
      ? "보호자-자녀 연결을 해제했습니다."
      : "남아 있던 보호자-자녀 연결 정보를 정리했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    members: nextMembers,
    users: nextUsers,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId));
}

export async function POST(request: NextRequest, context: GuardianLinkRouteContext) {
  const initialContext = await requireGuardianLinkRequestContext(request, context, true);

  if (!initialContext.context) {
    return initialContext.response;
  }

  const parsedBody = parseGuardianLinkInput(await request.json().catch(() => null));

  if (parsedBody.error) {
    return jsonError(400, "VALIDATION_ERROR", parsedBody.error);
  }

  if (!parsedBody.guardianUserId) {
    return jsonError(400, "VALIDATION_ERROR", "연결할 학부모 계정을 선택해 주세요.");
  }

  return withServerDbLock(guardianLinkStateLockKey, () =>
    createGuardianLink(request, context, parsedBody.guardianUserId),
  );
}

export async function PUT(request: NextRequest, context: GuardianLinkRouteContext) {
  const initialContext = await requireGuardianLinkRequestContext(request, context, true);

  if (!initialContext.context) {
    return initialContext.response;
  }

  const parsedBody = parseGuardianLinkInput(await request.json().catch(() => null));

  if (parsedBody.error) {
    return jsonError(400, "VALIDATION_ERROR", parsedBody.error);
  }

  if (!parsedBody.guardianUserId) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 학부모 계정을 선택해 주세요.");
  }

  return withServerDbLock(guardianLinkStateLockKey, () =>
    replaceGuardianLink(request, context, parsedBody.guardianUserId),
  );
}

export async function DELETE(request: NextRequest, context: GuardianLinkRouteContext) {
  const initialContext = await requireGuardianLinkRequestContext(request, context, false);

  if (!initialContext.context) {
    return initialContext.response;
  }

  const parsedBody = parseGuardianLinkInput(await request.json().catch(() => null));

  if (parsedBody.error) {
    return jsonError(400, "VALIDATION_ERROR", parsedBody.error);
  }

  if (!parsedBody.guardianUserId) {
    return jsonError(400, "VALIDATION_ERROR", "해제할 학부모 계정을 선택해 주세요.");
  }

  return withServerDbLock(guardianLinkStateLockKey, () =>
    deleteGuardianLink(request, context, parsedBody.guardianUserId),
  );
}
