import type { BeltPromotion, Member, MockDatabase } from "./domain";

const promotionDateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Seoul",
  year: "numeric",
});

function promotionDateKey(value: Date) {
  const parts = Object.fromEntries(promotionDateKeyFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const promotionEligibilityMinAttendance = 12;

export type PromotionEligibility = {
  attendanceCount: number;
  eligible: boolean;
  lastPassedAt: string | null;
  requiredCount: number;
};

export function isSchedulablePromotionExamDate(value: string, today = promotionDateKey(new Date())) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const valid =
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day);

  return valid && value >= today;
}

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
