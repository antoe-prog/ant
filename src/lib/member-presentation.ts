import type { Member } from "@/lib/domain";
import { memberStatusLabels } from "@/lib/roles";

export function getChildSwitcherPresentation(member: Pick<Member, "belt" | "level" | "status">) {
  const level = member.level.trim();
  const hideDuplicateTrialLevel = member.status === "trial" && level.includes("체험");

  return {
    meta: hideDuplicateTrialLevel || !level ? member.belt : `${member.belt} · ${level}`,
    statusLabel: memberStatusLabels[member.status],
  };
}
