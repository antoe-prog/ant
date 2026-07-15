import { judoBelts, type AppUser, type Member, type MockDatabase } from "./domain.ts";

export const finalCommonPromotionSkillCategories = [
  { id: "ukemi", label: "낙법" },
  { id: "nage_waza", label: "메치기" },
  { id: "katame_waza", label: "굳히기" },
  { id: "theory", label: "이론" },
] as const;

export const finalCommonPromotionPolicyVersion = "2026-03" as const;

export const finalYouthPromotionGrades = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;
export const finalGeneralPromotionGrades = [8, 7, 6, 5, 4, 3, 2, 1] as const;

export type FinalPromotionGrade = (typeof finalYouthPromotionGrades)[number];
export type FinalPromotionTrack = "youth" | "general";
export type FinalPromotionTrainingMode = "normal" | "accelerated";
export type FinalPromotionExamKind = "special" | "regular";
export type FinalPromotionAgeBandId = "age_8_and_under" | "age_9_to_13" | "age_14_to_16" | "age_17_to_19" | "age_20_and_over";

export type FinalPromotionPeriodRule = {
  grade: FinalPromotionGrade;
  cumulativeMonths: number;
  monthsAtGrade: number;
  acceleratedCumulativeMonths?: number;
};

export const finalCommonPromotionAgeBands = [
  { id: "age_8_and_under", minAge: 0, maxAge: 8, acceleratedMonthlyHours: 28 },
  { id: "age_9_to_13", minAge: 9, maxAge: 13, acceleratedMonthlyHours: 28 },
  { id: "age_14_to_16", minAge: 14, maxAge: 16, acceleratedMonthlyHours: 26 },
  { id: "age_17_to_19", minAge: 17, maxAge: 19, acceleratedMonthlyHours: 26 },
  { id: "age_20_and_over", minAge: 20, maxAge: null, acceleratedMonthlyHours: 24 },
] as const;

export const finalCommonPromotionPeriodRules: Record<FinalPromotionAgeBandId, readonly FinalPromotionPeriodRule[]> = {
  age_8_and_under: [
    { grade: 10, cumulativeMonths: 2, monthsAtGrade: 2 },
    { grade: 9, cumulativeMonths: 4, monthsAtGrade: 2 },
    { grade: 8, cumulativeMonths: 7, monthsAtGrade: 3 },
    { grade: 7, cumulativeMonths: 9, monthsAtGrade: 2, acceleratedCumulativeMonths: 6 },
    { grade: 6, cumulativeMonths: 11, monthsAtGrade: 2 },
    { grade: 5, cumulativeMonths: 14, monthsAtGrade: 3 },
    { grade: 4, cumulativeMonths: 16, monthsAtGrade: 2, acceleratedCumulativeMonths: 12 },
    { grade: 3, cumulativeMonths: 18, monthsAtGrade: 2 },
    { grade: 2, cumulativeMonths: 21, monthsAtGrade: 3 },
    { grade: 1, cumulativeMonths: 23, monthsAtGrade: 2, acceleratedCumulativeMonths: 18 },
  ],
  age_9_to_13: [
    { grade: 10, cumulativeMonths: 2, monthsAtGrade: 2 },
    { grade: 9, cumulativeMonths: 4, monthsAtGrade: 2 },
    { grade: 8, cumulativeMonths: 6, monthsAtGrade: 2 },
    { grade: 7, cumulativeMonths: 8, monthsAtGrade: 2, acceleratedCumulativeMonths: 4 },
    { grade: 6, cumulativeMonths: 10, monthsAtGrade: 2 },
    { grade: 5, cumulativeMonths: 12, monthsAtGrade: 2 },
    { grade: 4, cumulativeMonths: 14, monthsAtGrade: 2, acceleratedCumulativeMonths: 7 },
    { grade: 3, cumulativeMonths: 16, monthsAtGrade: 2 },
    { grade: 2, cumulativeMonths: 18, monthsAtGrade: 2 },
    { grade: 1, cumulativeMonths: 20, monthsAtGrade: 2, acceleratedCumulativeMonths: 10 },
  ],
  age_14_to_16: [
    { grade: 10, cumulativeMonths: 1, monthsAtGrade: 1 },
    { grade: 9, cumulativeMonths: 2, monthsAtGrade: 1 },
    { grade: 8, cumulativeMonths: 4, monthsAtGrade: 2 },
    { grade: 7, cumulativeMonths: 5, monthsAtGrade: 1, acceleratedCumulativeMonths: 3 },
    { grade: 6, cumulativeMonths: 7, monthsAtGrade: 2 },
    { grade: 5, cumulativeMonths: 8, monthsAtGrade: 1 },
    { grade: 4, cumulativeMonths: 10, monthsAtGrade: 2, acceleratedCumulativeMonths: 6 },
    { grade: 3, cumulativeMonths: 11, monthsAtGrade: 1 },
    { grade: 2, cumulativeMonths: 13, monthsAtGrade: 2 },
    { grade: 1, cumulativeMonths: 14, monthsAtGrade: 1, acceleratedCumulativeMonths: 9 },
  ],
  age_17_to_19: [
    { grade: 10, cumulativeMonths: 1, monthsAtGrade: 1 },
    { grade: 9, cumulativeMonths: 2, monthsAtGrade: 1 },
    { grade: 8, cumulativeMonths: 3, monthsAtGrade: 1 },
    { grade: 7, cumulativeMonths: 5, monthsAtGrade: 2, acceleratedCumulativeMonths: 3 },
    { grade: 6, cumulativeMonths: 6, monthsAtGrade: 1 },
    { grade: 5, cumulativeMonths: 7, monthsAtGrade: 1 },
    { grade: 4, cumulativeMonths: 9, monthsAtGrade: 2, acceleratedCumulativeMonths: 6 },
    { grade: 3, cumulativeMonths: 10, monthsAtGrade: 1 },
    { grade: 2, cumulativeMonths: 11, monthsAtGrade: 1 },
    { grade: 1, cumulativeMonths: 12, monthsAtGrade: 1, acceleratedCumulativeMonths: 9 },
  ],
  age_20_and_over: [
    { grade: 10, cumulativeMonths: 1, monthsAtGrade: 1 },
    { grade: 9, cumulativeMonths: 2, monthsAtGrade: 1 },
    { grade: 8, cumulativeMonths: 3, monthsAtGrade: 1 },
    { grade: 7, cumulativeMonths: 4, monthsAtGrade: 1, acceleratedCumulativeMonths: 2 },
    { grade: 6, cumulativeMonths: 5, monthsAtGrade: 1 },
    { grade: 5, cumulativeMonths: 6, monthsAtGrade: 1 },
    { grade: 4, cumulativeMonths: 7, monthsAtGrade: 1, acceleratedCumulativeMonths: 4 },
    { grade: 3, cumulativeMonths: 8, monthsAtGrade: 1 },
    { grade: 2, cumulativeMonths: 9, monthsAtGrade: 1 },
    { grade: 1, cumulativeMonths: 10, monthsAtGrade: 1, acceleratedCumulativeMonths: 6 },
  ],
};

export const finalCommonPromotionSchedule = {
  special: { weekday: 5, occurrence: 2 },
  regular: { weekday: 5, occurrence: 4 },
} as const;

export const finalCommonPromotionPolicy = {
  version: finalCommonPromotionPolicyVersion,
  scope: "all_branches",
  normalMonthlyHours: 12,
  maximumRecognizedHoursPerDay: 1,
  skillCategories: finalCommonPromotionSkillCategories,
  tracks: {
    youth: { grades: finalYouthPromotionGrades, maximumRequiredAge: 13 },
    general: { grades: finalGeneralPromotionGrades, minimumAge: 14 },
  },
  ageBands: finalCommonPromotionAgeBands,
  periodRules: finalCommonPromotionPeriodRules,
  schedule: finalCommonPromotionSchedule,
} as const;

export function getFinalCommonPromotionPolicyForBranch(branchId: string) {
  void branchId;
  return finalCommonPromotionPolicy;
}

export function getPromotionAgeBand(age: number) {
  if (!Number.isInteger(age) || age < 0) {
    throw new RangeError("Age must be a non-negative integer.");
  }

  const ageBand = finalCommonPromotionAgeBands.find(
    (candidate) => age >= candidate.minAge && (candidate.maxAge === null || age <= candidate.maxAge),
  );

  if (!ageBand) {
    throw new RangeError("No promotion age band is configured for this age.");
  }

  return ageBand;
}

export function getFinalPromotionTrackForAge(age: number): FinalPromotionTrack {
  return getPromotionAgeBand(age).maxAge !== null && age <= 13 ? "youth" : "general";
}

export function canTakeYouthToGeneralPromotionExam(age: number, currentTrack: FinalPromotionTrack) {
  getPromotionAgeBand(age);
  return age >= 14 && currentTrack === "youth";
}

export function getFinalPromotionMonthlyRequiredHours(age: number, mode: FinalPromotionTrainingMode) {
  const ageBand = getPromotionAgeBand(age);
  return mode === "normal" ? finalCommonPromotionPolicy.normalMonthlyHours : ageBand.acceleratedMonthlyHours;
}

export function getRecognizedPromotionTrainingHoursForDay(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) {
    return 0;
  }

  return Math.min(hours, finalCommonPromotionPolicy.maximumRecognizedHoursPerDay);
}

export function getPromotionPeriodRule(age: number, grade: FinalPromotionGrade) {
  const ageBand = getPromotionAgeBand(age);
  return finalCommonPromotionPeriodRules[ageBand.id].find((rule) => rule.grade === grade) ?? null;
}

export const getFinalPromotionAgeBand = getPromotionAgeBand;
export const getFinalPromotionPeriodRule = getPromotionPeriodRule;

export function isFinalPromotionGradeForTrack(track: FinalPromotionTrack, grade: number): grade is FinalPromotionGrade {
  const grades = track === "youth" ? finalYouthPromotionGrades : finalGeneralPromotionGrades;
  return (grades as readonly number[]).includes(grade);
}

export function getFinalPromotionExamKind(dateKey: string): FinalPromotionExamKind | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCDay() !== 5) {
    return null;
  }

  const occurrence = Math.floor((day - 1) / 7) + 1;

  if (occurrence === finalCommonPromotionSchedule.special.occurrence) {
    return "special";
  }

  if (occurrence === finalCommonPromotionSchedule.regular.occurrence) {
    return "regular";
  }

  return null;
}

export function getExactNextCompatiblePromotionBelt(currentBelt: string): string | null {
  const currentIndex = judoBelts.indexOf(currentBelt as (typeof judoBelts)[number]);

  if (currentIndex < 0 || currentIndex >= judoBelts.length - 1) {
    return null;
  }

  return judoBelts[currentIndex + 1];
}

export function isExactNextCompatiblePromotionBelt(currentBelt: string, targetBelt: string) {
  return getExactNextCompatiblePromotionBelt(currentBelt) === targetBelt;
}

export function canCoachManagePromotionMember(
  user: AppUser,
  db: Pick<MockDatabase, "classes">,
  member: Pick<Member, "branchId" | "id">,
) {
  if (user.role !== "coach" || !user.branchIds.includes(member.branchId)) {
    return false;
  }

  return db.classes.some(
    (session) =>
      session.branchId === member.branchId &&
      session.coachId === user.id &&
      session.enrolledMemberIds.includes(member.id),
  );
}
