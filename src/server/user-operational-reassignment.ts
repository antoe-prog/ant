import type { AppUser, MockDatabase, UserRole } from "../lib/domain.ts";

const operationalRoles = new Set<UserRole>(["coach", "owner", "admin"]);
const reassignmentRolePriority: UserRole[] = ["coach", "owner", "admin"];

export function findAcceptedBranchOperatorId(
  db: MockDatabase,
  branchId: string,
  excludedUserId: string | null = null,
) {
  for (const role of reassignmentRolePriority) {
    const candidate = db.users.find(
      (user) =>
        user.id !== excludedUserId &&
        user.role === role &&
        user.invitationStatus !== "pending" &&
        user.branchIds.includes(branchId),
    );

    if (candidate) {
      return candidate.id;
    }
  }

  return null;
}

function canKeepOperationalAssignment(
  role: UserRole | null,
  branchIds: string[],
  branchId: string,
  invitationStatus: AppUser["invitationStatus"],
) {
  return Boolean(
    invitationStatus !== "pending" &&
    role &&
    operationalRoles.has(role) &&
    branchIds.includes(branchId),
  );
}

export function reassignUserOperationalLinks({
  db,
  nextBranchIds,
  nextRole,
  targetUserId,
}: {
  db: MockDatabase;
  nextBranchIds: string[];
  nextRole: UserRole | null;
  targetUserId: string;
}) {
  const targetInvitationStatus = db.users.find((user) => user.id === targetUserId)?.invitationStatus;
  const linkedClasses = db.classes.filter(
    (session) =>
      session.coachId === targetUserId &&
      !canKeepOperationalAssignment(nextRole, nextBranchIds, session.branchId, targetInvitationStatus),
  );
  const linkedMembers = db.members.filter(
    (member) =>
      member.primaryCoachId === targetUserId &&
      !canKeepOperationalAssignment(nextRole, nextBranchIds, member.branchId, targetInvitationStatus),
  );
  const affectedBranchIds = [...new Set([
    ...linkedClasses.map((session) => session.branchId),
    ...linkedMembers.map((member) => member.branchId),
  ])];
  const reassignmentUserIds = new Map(
    affectedBranchIds.map((branchId) => [
      branchId,
      findAcceptedBranchOperatorId(db, branchId, targetUserId),
    ]),
  );
  const blockers = affectedBranchIds
    .filter((branchId) => !reassignmentUserIds.get(branchId))
    .map((branchId) => ({
      branchId,
      classIds: linkedClasses.filter((session) => session.branchId === branchId).map((session) => session.id),
      memberIds: linkedMembers.filter((member) => member.branchId === branchId).map((member) => member.id),
    }));

  if (blockers.length > 0) {
    return {
      blockers,
      classes: db.classes,
      members: db.members,
      reassignedClassCount: 0,
      reassignedMemberCount: 0,
    };
  }

  const classes = db.classes.map((session) => {
    if (
      session.coachId !== targetUserId ||
      canKeepOperationalAssignment(nextRole, nextBranchIds, session.branchId, targetInvitationStatus)
    ) {
      return session;
    }

    return {
      ...session,
      coachId: reassignmentUserIds.get(session.branchId)!,
    };
  });
  const members = db.members.map((member) => {
    if (
      member.primaryCoachId !== targetUserId ||
      canKeepOperationalAssignment(nextRole, nextBranchIds, member.branchId, targetInvitationStatus)
    ) {
      return member;
    }

    return {
      ...member,
      primaryCoachId: reassignmentUserIds.get(member.branchId)!,
    };
  });

  return {
    blockers,
    classes,
    members,
    reassignedClassCount: linkedClasses.length,
    reassignedMemberCount: linkedMembers.length,
  };
}

export function summarizeOperationalReassignmentBlockers(
  blockers: ReturnType<typeof reassignUserOperationalLinks>["blockers"],
  db: MockDatabase,
) {
  return {
    blockedBranchCount: blockers.length,
    blockedClassCount: blockers.reduce((count, blocker) => count + blocker.classIds.length, 0),
    blockedMemberCount: blockers.reduce((count, blocker) => count + blocker.memberIds.length, 0),
    branches: blockers.map((blocker) => ({
      branchName: db.branches.find((branch) => branch.id === blocker.branchId)?.name ?? "알 수 없는 지점",
      classCount: blocker.classIds.length,
      memberCount: blocker.memberIds.length,
    })),
  };
}

export function findOwnerCoverageBlockers(
  targetUser: AppUser,
  nextRole: UserRole | null,
  nextBranchIds: string[],
  db: MockDatabase,
) {
  if (targetUser.role !== "owner") {
    return [];
  }

  return targetUser.branchIds
    .filter((branchId) => nextRole !== "owner" || !nextBranchIds.includes(branchId))
    .filter(
      (branchId) =>
        !db.users.some(
          (candidate) =>
            candidate.id !== targetUser.id &&
            candidate.role === "owner" &&
            candidate.invitationStatus !== "pending" &&
            candidate.branchIds.includes(branchId),
        ),
    )
    .map((branchId) => db.branches.find((branch) => branch.id === branchId)?.name ?? branchId);
}
