import type { AppUser, Member, MockDatabase } from "./domain.ts";
import { canMemberHaveGuardianLink } from "./member-age-policy.ts";

export type FamilyMemberRelation = "self" | "child";

type GuardianFamilyLinkProjectionOptions = {
  redactFamilyLinks: boolean;
};

export function findInvalidFamilyMemberLinkIds(
  members: readonly Pick<Member, "branchId" | "id">[],
  memberIds: readonly string[],
  branchIds: readonly string[],
) {
  const branchIdSet = new Set(branchIds);
  const memberById = new Map(members.map((member) => [member.id, member]));

  return memberIds.filter((memberId) => {
    const member = memberById.get(memberId);

    return !member || !branchIdSet.has(member.branchId);
  });
}

export function findAdultGuardianChildMemberIds(
  members: readonly Pick<Member, "ageGroup" | "id">[],
  memberIds: readonly string[],
) {
  const memberById = new Map(members.map((member) => [member.id, member]));

  return memberIds.filter((memberId) => {
    const member = memberById.get(memberId);

    return member ? !canMemberHaveGuardianLink(member) : false;
  });
}

export function findNonAdultGuardianSelfMemberIds(
  members: readonly Pick<Member, "ageGroup" | "id">[],
  memberIds: readonly string[],
) {
  const memberById = new Map(members.map((member) => [member.id, member]));

  return memberIds.filter((memberId) => memberById.get(memberId)?.ageGroup !== "adult");
}

export function getGuardianFamilyMemberIds(
  user: AppUser,
  db: Pick<MockDatabase, "members">,
  branchIds: readonly string[] = user.branchIds,
) {
  if (user.role !== "guardian") {
    return [];
  }

  const branchIdSet = new Set(branchIds);
  const selfMemberIds = new Set(user.memberIds ?? []);
  const memberById = new Map(db.members.map((member) => [member.id, member]));
  const memberLinkedChildIds = db.members
    .filter((member) => member.guardianIds.includes(user.id))
    .map((member) => member.id);

  return [...new Set([...(user.memberIds ?? []), ...(user.childMemberIds ?? []), ...memberLinkedChildIds])]
    .filter((memberId) => {
      const member = memberById.get(memberId);

      if (!member) {
        return false;
      }

      if (!branchIdSet.has(member.branchId)) {
        return false;
      }

      if (selfMemberIds.has(member.id)) {
        return member.ageGroup === "adult";
      }

      return (
        member.guardianIds.includes(user.id) &&
        canMemberHaveGuardianLink(member)
      );
    });
}

export function getGuardianFamilyMembers(
  user: AppUser,
  db: Pick<MockDatabase, "members">,
  branchIds: readonly string[] = user.branchIds,
) {
  const accessibleMemberIds = new Set(getGuardianFamilyMemberIds(user, db, branchIds));
  const memberById = new Map(db.members.map((member) => [member.id, member]));

  return [...accessibleMemberIds]
    .map((memberId) => memberById.get(memberId))
    .filter((member): member is Member => Boolean(member));
}

export function syncGuardianUserFamilyLinks(user: AppUser, members: readonly Member[]): AppUser {
  const linkedChildMembers = members.filter(
    (member) => canMemberHaveGuardianLink(member) && member.guardianIds.includes(user.id),
  );
  const linkedSelfMembers = members.filter(
    (member) => member.ageGroup === "adult" && (user.memberIds ?? []).includes(member.id),
  );
  const linkedBranchIds = [...linkedSelfMembers, ...linkedChildMembers].map((member) => member.branchId);

  return {
    ...user,
    branchIds: [...new Set([...user.branchIds, ...linkedBranchIds])],
    childMemberIds: linkedChildMembers.map((member) => member.id),
  };
}

export function createGuardianFamilyLinkProjection(
  user: AppUser,
  db: Pick<MockDatabase, "members">,
  { redactFamilyLinks }: GuardianFamilyLinkProjectionOptions,
) {
  if (user.role !== "guardian" || redactFamilyLinks) {
    return null;
  }

  const allowedFamilyMemberIds = new Set(getGuardianFamilyMemberIds(user, db));
  const memberById = new Map(db.members.map((member) => [member.id, member]));
  const memberIds = (user.memberIds ?? []).filter((memberId) => allowedFamilyMemberIds.has(memberId));
  const selfMemberIdSet = new Set(memberIds);
  const childMemberIds = [...allowedFamilyMemberIds].filter((memberId) => {
    const member = memberById.get(memberId);
    return !selfMemberIdSet.has(memberId) && Boolean(member?.guardianIds.includes(user.id));
  });

  return { memberIds, childMemberIds };
}

export function createFamilySafeMember(member: Member, viewer: Pick<AppUser, "id" | "role">): Member {
  return {
    ...member,
    alerts: [],
    guardianIds:
      viewer.role === "guardian" && member.guardianIds.includes(viewer.id)
        ? [viewer.id]
        : [],
  };
}

export function createFamilySafeReferencedUser(user: AppUser, visibleBranchIds: readonly string[]): AppUser {
  const visibleBranchIdSet = new Set(visibleBranchIds);
  const safeUser = {
    ...user,
    branchIds: user.branchIds.filter((branchId) => visibleBranchIdSet.has(branchId)),
  };

  delete safeUser.acceptedAt;
  delete safeUser.childMemberIds;
  delete safeUser.email;
  delete safeUser.invitationStatus;
  delete safeUser.invitationToken;
  delete safeUser.invitedAt;
  delete safeUser.memberIds;
  delete safeUser.passwordHash;
  delete safeUser.passwordResetRequestedAt;
  delete safeUser.passwordUpdatedAt;
  delete safeUser.phone;

  return safeUser;
}

export function getGuardianMemberRelation(user: AppUser, member: Pick<Member, "id">): FamilyMemberRelation {
  return (user.memberIds ?? []).includes(member.id) ? "self" : "child";
}

export function getFamilyMemberRelationLabel(relation: FamilyMemberRelation): "나" | "자녀" {
  return relation === "self" ? "나" : "자녀";
}
