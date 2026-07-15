export type FinalMainDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const finalMainSchedulePolicyVersion = "2026-03" as const;

type FinalMainTimeWindow = {
  startTime: string;
  endTime: string;
  durationMinutes: number;
};

type FinalMainTrainingPhase = {
  id:
    | "stretching"
    | "conditioning"
    | "uchikomi"
    | "throwing_technique"
    | "groundwork_technique"
    | "mixed_technique"
    | "throwing_breakfall"
    | "groundwork_randori"
    | "throwing_randori"
    | "cooldown";
  label: string;
};

type FinalMainRegularJudoSchedule = {
  kind: "regular_judo";
  audience: "all_ages";
  participation: "open";
  durationMinutes: 60;
  startTimes: readonly string[];
};

type FinalMainSpecialSession = FinalMainTimeWindow & {
  id: "saturday_add_on_judo";
  label: string;
  kind: "add_on_judo";
  scheduleMode: "fixed";
  access: "separate_add_on_or_day_pass";
  accessPolicyReference: {
    policyId: "common-day-pass-and-add-on-policy";
    policyScope: "all_branches_common";
  };
};

type FinalMainFixedProgram = FinalMainTimeWindow & {
  id: "athlete_squad_first" | "athlete_squad_second";
  label: string;
  kind: "athlete_squad";
  scheduleMode: "fixed";
  weekday: null;
  access: "athlete_squad";
  variationNotice?: "middle_school_second_block_may_vary";
};

type FinalMainDayPolicy = {
  day: FinalMainDay;
  regularJudo: FinalMainRegularJudoSchedule | null;
  specialSessions: readonly FinalMainSpecialSession[];
  trainingProgram: readonly FinalMainTrainingPhase[] | null;
};

const weekdayProgramOpening = [
  { id: "stretching", label: "스트레칭" },
  { id: "conditioning", label: "체력" },
  { id: "uchikomi", label: "우치코미" },
] as const satisfies readonly FinalMainTrainingPhase[];

const weekdayProgramClosing = [
  { id: "groundwork_randori", label: "굳히기 자유대련" },
  { id: "throwing_randori", label: "메치기 자유대련" },
  { id: "cooldown", label: "정리" },
] as const satisfies readonly FinalMainTrainingPhase[];

const weekdayTrainingPrograms = {
  monday: [
    ...weekdayProgramOpening,
    { id: "throwing_technique", label: "메치기" },
    ...weekdayProgramClosing,
  ],
  tuesday: [
    ...weekdayProgramOpening,
    { id: "groundwork_technique", label: "굳히기" },
    ...weekdayProgramClosing,
  ],
  wednesday: [
    ...weekdayProgramOpening,
    { id: "mixed_technique", label: "혼합" },
    ...weekdayProgramClosing,
  ],
  thursday: [
    ...weekdayProgramOpening,
    { id: "throwing_breakfall", label: "메치기+낙법" },
    ...weekdayProgramClosing,
  ],
  friday: [
    ...weekdayProgramOpening,
    { id: "throwing_breakfall", label: "메치기+낙법" },
    ...weekdayProgramClosing,
  ],
} as const satisfies Record<
  Extract<FinalMainDay, "monday" | "tuesday" | "wednesday" | "thursday" | "friday">,
  readonly FinalMainTrainingPhase[]
>;

const mondayToThursdayRegularJudo = {
  kind: "regular_judo",
  audience: "all_ages",
  participation: "open",
  durationMinutes: 60,
  startTimes: ["17:00", "18:00", "19:00", "20:00", "21:00", "22:00"],
} as const satisfies FinalMainRegularJudoSchedule;

const fridayRegularJudo = {
  kind: "regular_judo",
  audience: "all_ages",
  participation: "open",
  durationMinutes: 60,
  startTimes: ["17:00", "18:00", "19:00", "20:00", "21:00"],
} as const satisfies FinalMainRegularJudoSchedule;

const finalMainDayPolicies = {
  monday: {
    day: "monday",
    regularJudo: mondayToThursdayRegularJudo,
    specialSessions: [],
    trainingProgram: weekdayTrainingPrograms.monday,
  },
  tuesday: {
    day: "tuesday",
    regularJudo: mondayToThursdayRegularJudo,
    specialSessions: [],
    trainingProgram: weekdayTrainingPrograms.tuesday,
  },
  wednesday: {
    day: "wednesday",
    regularJudo: mondayToThursdayRegularJudo,
    specialSessions: [],
    trainingProgram: weekdayTrainingPrograms.wednesday,
  },
  thursday: {
    day: "thursday",
    regularJudo: mondayToThursdayRegularJudo,
    specialSessions: [],
    trainingProgram: weekdayTrainingPrograms.thursday,
  },
  friday: {
    day: "friday",
    regularJudo: fridayRegularJudo,
    specialSessions: [],
    trainingProgram: weekdayTrainingPrograms.friday,
  },
  saturday: {
    day: "saturday",
    regularJudo: null,
    specialSessions: [
      {
        id: "saturday_add_on_judo",
        label: "토요일 유도",
        kind: "add_on_judo",
        scheduleMode: "fixed",
        startTime: "11:00",
        endTime: "12:30",
        durationMinutes: 90,
        access: "separate_add_on_or_day_pass",
        accessPolicyReference: {
          policyId: "common-day-pass-and-add-on-policy",
          policyScope: "all_branches_common",
        },
      },
    ],
    trainingProgram: null,
  },
  sunday: {
    day: "sunday",
    regularJudo: null,
    specialSessions: [],
    trainingProgram: null,
  },
} as const satisfies Record<FinalMainDay, FinalMainDayPolicy>;

const finalMainFixedPrograms = [
  {
    id: "athlete_squad_first",
    label: "선수부 1부",
    kind: "athlete_squad",
    scheduleMode: "fixed",
    weekday: null,
    startTime: "17:00",
    endTime: "19:00",
    durationMinutes: 120,
    access: "athlete_squad",
  },
  {
    id: "athlete_squad_second",
    label: "선수부 2부",
    kind: "athlete_squad",
    scheduleMode: "fixed",
    weekday: null,
    startTime: "19:00",
    endTime: "22:00",
    durationMinutes: 180,
    access: "athlete_squad",
    variationNotice: "middle_school_second_block_may_vary",
  },
] as const satisfies readonly FinalMainFixedProgram[];

export const finalMainSchedulePolicy = {
  id: "final-main-schedule-policy",
  version: finalMainSchedulePolicyVersion,
  name: "본관 전용 시간표/요일별 훈련 정책",
  scope: {
    location: "final_main",
    applicability: "main_only",
    policyAreas: ["class_schedule", "weekday_training_program"],
    doesNotDefine: [
      "fees",
      "discounts",
      "public_service_one_plus_one",
      "day_pass_rules",
      "uniform_standards",
      "promotion_criteria",
    ],
  },
  days: finalMainDayPolicies,
  fixedPrograms: finalMainFixedPrograms,
  coordinatedPrograms: [
    {
      id: "entrance_exam_preparation",
      label: "입시 준비",
      scheduleMode: "by_coordination",
      preferredTimeWindow: {
        startTime: "20:00",
        endTime: "23:00",
        durationMinutes: 180,
      },
    },
    {
      id: "career_and_expedited_dan_preparation",
      label: "경찰·군인·소방/단축 단 준비",
      scheduleMode: "by_coordination",
      tracks: ["police", "military", "firefighter", "expedited_dan"],
      preferredTimeWindow: null,
    },
  ],
  promotionOperationsReference: {
    referenceOnly: true,
    policyModule: "final-common-promotion-policy",
    policyExport: "finalCommonPromotionPolicy",
    policyScope: "all_branches",
    notices: ["둘째 금요일 특별승급", "넷째 금요일 정기승급"],
  },
} as const;

const finalMainWeekdayMetadata = [
  { day: "monday", weekday: 1, label: "월요일" },
  { day: "tuesday", weekday: 2, label: "화요일" },
  { day: "wednesday", weekday: 3, label: "수요일" },
  { day: "thursday", weekday: 4, label: "목요일" },
  { day: "friday", weekday: 5, label: "금요일" },
] as const;

function addMinutesToTime(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = hour * 60 + minute + minutes;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

export const finalMainRegularSchedule = finalMainWeekdayMetadata.map(({ day, weekday, label }) => {
  const regularJudo = finalMainDayPolicies[day].regularJudo;
  const firstStartTime = regularJudo.startTimes[0];
  const lastStartTime = regularJudo.startTimes.at(-1) ?? firstStartTime;

  return {
    id: `${day}-regular-judo`,
    weekday,
    label,
    time: `${firstStartTime}-${addMinutesToTime(lastStartTime, regularJudo.durationMinutes)}`,
    items: regularJudo.startTimes.map((startTime) => ({
      id: `${day}-regular-judo-${startTime.replace(":", "")}`,
      label: "전연령 오픈 유도",
      time: `${startTime}-${addMinutesToTime(startTime, regularJudo.durationMinutes)}`,
      audience: regularJudo.audience,
      participation: regularJudo.participation,
    })),
  };
});

export const finalMainSpecialSchedules = [
  {
    id: "saturday-special-schedule",
    weekday: 6,
    label: "토요일 유도",
    time: "11:00-12:30",
    items: finalMainDayPolicies.saturday.specialSessions.map((session) => ({
      id: session.id,
      label: session.label,
      time: `${session.startTime}-${session.endTime}`,
      access: session.access,
    })),
  },
  {
    id: "athlete-squad-fixed-programs",
    weekday: null,
    label: "선수부 고정 프로그램",
    time: "17:00-22:00",
    items: finalMainSchedulePolicy.fixedPrograms.map((program) => ({
      id: program.id,
      label: program.label,
      time: `${program.startTime}-${program.endTime}`,
      ...("variationNotice" in program ? { note: "중등 둘째 블록 변동 가능" } : {}),
    })),
  },
  {
    id: "coordinated-programs",
    weekday: null,
    label: "일정 협의 프로그램",
    time: "일정 협의",
    items: finalMainSchedulePolicy.coordinatedPrograms.map((program) => ({
      id: program.id,
      label: program.label,
      time: program.preferredTimeWindow
        ? `${program.preferredTimeWindow.startTime}-${program.preferredTimeWindow.endTime} 일정 협의`
        : "일정 협의",
    })),
  },
] as const;

export const finalMainTrainingProgram = finalMainWeekdayMetadata.map(({ day, weekday, label }) => ({
  id: `${day}-training-program`,
  weekday,
  label,
  time: "각 정규 수업 60분",
  items: weekdayTrainingPrograms[day],
}));

export function getFinalMainTrainingProgramForWeekday(weekday: number) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return null;
  }

  return finalMainTrainingProgram.find((program) => program.weekday === weekday) ?? null;
}

export function resolveFinalMainDayPolicy(day: FinalMainDay): FinalMainDayPolicy {
  return finalMainSchedulePolicy.days[day];
}
