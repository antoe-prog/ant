import type { AppUser, Member, MockDatabase } from "./domain.ts";
import { canMemberHaveGuardianLink } from "./member-age-policy.ts";

export type FamilyMemberRelation = "self" | "child";

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
  const childMemberIds = new Set(user.childMemberIds ?? []);
  const memberById = new Map(db.members.map((member) => [member.id, member]));

  return [...new Set([...(user.memberIds ?? []), ...(user.childMemberIds ?? [])])]
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
        childMemberIds.has(member.id) &&
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

export function getGuardianMemberRelation(user: AppUser, member: Pick<Member, "id">): FamilyMemberRelation {
  return (user.memberIds ?? []).includes(member.id) ? "self" : "child";
}

export function getFamilyMemberRelationLabel(relation: FamilyMemberRelation): "나" | "자녀" {
  return relation === "self" ? "나" : "자녀";
}
