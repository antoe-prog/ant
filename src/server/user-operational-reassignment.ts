import type { AppUser, MockDatabase, UserRole } from "../lib/domain.ts";

const operationalRoles = new Set<UserRole>(["coach", "owner", "admin"]);

function findReassignmentUserId(
  branchId: string,
  targetUserId: string,
  actorUserId: string,
  db: MockDatabase,
) {
  const fallbackCoach = db.users.find(
    (candidate) => candidate.id !== targetUserId && candidate.role === "coach" && candidate.branchIds.includes(branchId),
  );

  if (fallbackCoach) {
    return fallbackCoach.id;
  }

  const branchOwner = db.users.find(
    (candidate) => candidate.id !== targetUserId && candidate.role === "owner" && candidate.branchIds.includes(branchId),
  );

  return branchOwner?.id ?? actorUserId;
}

function canKeepOperationalAssignment(role: UserRole | null, branchIds: string[], branchId: string) {
  return Boolean(role && operationalRoles.has(role) && branchIds.includes(branchId));
}

export function reassignUserOperationalLinks({
  actorUserId,
  db,
  nextBranchIds,
  nextRole,
  targetUserId,
}: {
  actorUserId: string;
  db: MockDatabase;
  nextBranchIds: string[];
  nextRole: UserRole | null;
  targetUserId: string;
}) {
  let reassignedClassCount = 0;
  let reassignedMemberCount = 0;
  const classes = db.classes.map((session) => {
    if (
      session.coachId !== targetUserId ||
      canKeepOperationalAssignment(nextRole, nextBranchIds, session.branchId)
    ) {
      return session;
    }

    reassignedClassCount += 1;
    return {
      ...session,
      coachId: findReassignmentUserId(session.branchId, targetUserId, actorUserId, db),
    };
  });
  const members = db.members.map((member) => {
    if (
      member.primaryCoachId !== targetUserId ||
      canKeepOperationalAssignment(nextRole, nextBranchIds, member.branchId)
    ) {
      return member;
    }

    reassignedMemberCount += 1;
    return {
      ...member,
      primaryCoachId: findReassignmentUserId(member.branchId, targetUserId, actorUserId, db),
    };
  });

  return { classes, members, reassignedClassCount, reassignedMemberCount };
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
            candidate.branchIds.includes(branchId),
        ),
    )
    .map((branchId) => db.branches.find((branch) => branch.id === branchId)?.name ?? branchId);
}
