import type { Member } from "@/lib/domain";

export function canMemberHaveGuardianLink(member: Pick<Member, "ageGroup">) {
  return member.ageGroup !== "adult";
}

