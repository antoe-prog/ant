import type { BeltPromotion, Member, MockDatabase } from "@/lib/domain";

export const promotionEligibilityMinAttendance = 12;

export type PromotionEligibility = {
  attendanceCount: number;
  eligible: boolean;
  lastPassedAt: string | null;
  requiredCount: number;
};

export function getLastPassedPromotion(memberId: string, promotions: BeltPromotion[]): BeltPromotion | null {
  const passed = promotions
    .filter((promotion) => promotion.memberId === memberId && promotion.result === "passed" && promotion.decidedAt)
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));

  return passed[0] ?? null;
}

export function getPromotionEligibility(
  member: Member,
  db: Pick<MockDatabase, "attendance" | "classes" | "promotions">,
  requiredCount = promotionEligibilityMinAttendance,
): PromotionEligibility {
  const lastPassed = getLastPassedPromotion(member.id, db.promotions ?? []);
  const sinceTime = lastPassed?.decidedAt ? Date.parse(lastPassed.decidedAt) : null;
  const sessionStartById = new Map(db.classes.map((session) => [session.id, Date.parse(session.startsAt)]));
  const attendanceCount = db.attendance.filter((record) => {
    if (record.memberId !== member.id || (record.status !== "present" && record.status !== "late")) {
      return false;
    }

    if (sinceTime === null) {
      return true;
    }

    const sessionTime = sessionStartById.get(record.sessionId);

    return sessionTime !== undefined && !Number.isNaN(sessionTime) && sessionTime >= sinceTime;
  }).length;

  return {
    attendanceCount,
    eligible: attendanceCount >= requiredCount,
    lastPassedAt: lastPassed?.decidedAt ?? null,
    requiredCount,
  };
}
