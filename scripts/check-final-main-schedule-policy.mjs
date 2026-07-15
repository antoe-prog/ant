import assert from "node:assert/strict";

const policyModule = await import("../src/lib/final-main-schedule-policy.ts");
const { isFinalMainBranch } = await import("../src/lib/final-main-policy.ts");
const {
  finalMainRegularSchedule,
  finalMainSchedulePolicy,
  finalMainSchedulePolicyVersion,
  finalMainSpecialSchedules,
  finalMainTrainingProgram,
  getFinalMainTrainingProgramForWeekday,
  resolveFinalMainDayPolicy,
} = policyModule;

function addMinutes(time, minutes) {
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = hour * 60 + minute + minutes;
  const endHour = Math.floor(totalMinutes / 60);
  const endMinute = totalMinutes % 60;
  return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
}

function assertTimeWindow(window, expectedStart, expectedEnd, expectedDuration) {
  assert.equal(window.startTime, expectedStart);
  assert.equal(window.endTime, expectedEnd);
  assert.equal(window.durationMinutes, expectedDuration);
  assert.equal(addMinutes(window.startTime, window.durationMinutes), window.endTime);
}

assert.deepEqual(
  Object.keys(policyModule).sort(),
  [
    "finalMainRegularSchedule",
    "finalMainSchedulePolicy",
    "finalMainSchedulePolicyVersion",
    "finalMainSpecialSchedules",
    "finalMainTrainingProgram",
    "getFinalMainTrainingProgramForWeekday",
    "resolveFinalMainDayPolicy",
  ],
  "the main policy module must expose only static policy data and its day resolver",
);
assert.equal(finalMainSchedulePolicy.id, "final-main-schedule-policy");
assert.equal(finalMainSchedulePolicyVersion, "2026-03");
assert.equal(finalMainSchedulePolicy.version, finalMainSchedulePolicyVersion);
assert.equal(finalMainSchedulePolicy.scope.location, "final_main");
assert.equal(finalMainSchedulePolicy.scope.applicability, "main_only");
assert.deepEqual(finalMainSchedulePolicy.scope.policyAreas, ["class_schedule", "weekday_training_program"]);
assert.deepEqual(finalMainSchedulePolicy.scope.doesNotDefine, [
  "fees",
  "discounts",
  "public_service_one_plus_one",
  "day_pass_rules",
  "uniform_standards",
  "promotion_criteria",
]);
assert.equal(isFinalMainBranch({ id: "branch-gangnam", name: "강남점" }), true);
assert.equal(isFinalMainBranch({ id: "branch-main", name: "목동 본관" }), true);
assert.equal(isFinalMainBranch({ id: "branch-annex", name: "목동 별관" }), false);
assert.equal(isFinalMainBranch({ id: "branch-other", name: "신월점" }), false);

const mondayToThursdayStarts = ["17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
for (const day of ["monday", "tuesday", "wednesday", "thursday"]) {
  const resolved = resolveFinalMainDayPolicy(day);
  assert.strictEqual(resolved, finalMainSchedulePolicy.days[day]);
  assert.equal(resolved.regularJudo.kind, "regular_judo");
  assert.equal(resolved.regularJudo.audience, "all_ages");
  assert.equal(resolved.regularJudo.participation, "open");
  assert.equal(resolved.regularJudo.durationMinutes, 60);
  assert.deepEqual(resolved.regularJudo.startTimes, mondayToThursdayStarts);
  assert.equal(addMinutes(resolved.regularJudo.startTimes.at(-1), resolved.regularJudo.durationMinutes), "23:00");
}

const friday = resolveFinalMainDayPolicy("friday");
assert.equal(friday.regularJudo.audience, "all_ages");
assert.equal(friday.regularJudo.participation, "open");
assert.equal(friday.regularJudo.durationMinutes, 60);
assert.deepEqual(friday.regularJudo.startTimes, ["17:00", "18:00", "19:00", "20:00", "21:00"]);
assert.equal(addMinutes(friday.regularJudo.startTimes.at(-1), friday.regularJudo.durationMinutes), "22:00");
assert(!friday.regularJudo.startTimes.includes("22:00"), "Friday must not start a 22:00 regular class");

assert.equal(finalMainRegularSchedule.length, 5);
assert.deepEqual(finalMainRegularSchedule.map((schedule) => schedule.weekday), [1, 2, 3, 4, 5]);
assert.deepEqual(finalMainRegularSchedule.map((schedule) => schedule.label), ["월요일", "화요일", "수요일", "목요일", "금요일"]);
assert.deepEqual(finalMainRegularSchedule.map((schedule) => schedule.time), [
  "17:00-23:00",
  "17:00-23:00",
  "17:00-23:00",
  "17:00-23:00",
  "17:00-22:00",
]);
assert.deepEqual(finalMainRegularSchedule.map((schedule) => schedule.items.length), [6, 6, 6, 6, 5]);
for (const schedule of finalMainRegularSchedule) {
  assert.equal(typeof schedule.label, "string");
  assert.equal(typeof schedule.time, "string");
  assert(Array.isArray(schedule.items));
  for (const item of schedule.items) {
    assert.equal(item.label, "전연령 오픈 유도");
    assert.match(item.time, /^\d{2}:\d{2}-\d{2}:\d{2}$/);
  }
}

const saturday = resolveFinalMainDayPolicy("saturday");
assert.equal(saturday.regularJudo, null);
assert.equal(saturday.trainingProgram, null);
assert.equal(saturday.specialSessions.length, 1);
assert.deepEqual(saturday.specialSessions.map((session) => session.id), ["saturday_add_on_judo"]);

const saturdayJudo = saturday.specialSessions.find((session) => session.id === "saturday_add_on_judo");
assert(saturdayJudo);
assertTimeWindow(saturdayJudo, "11:00", "12:30", 90);
assert.equal(saturdayJudo.access, "separate_add_on_or_day_pass");
assert.deepEqual(saturdayJudo.accessPolicyReference, {
  policyId: "common-day-pass-and-add-on-policy",
  policyScope: "all_branches_common",
});

const athleteFirst = finalMainSchedulePolicy.fixedPrograms.find((program) => program.id === "athlete_squad_first");
const athleteSecond = finalMainSchedulePolicy.fixedPrograms.find((program) => program.id === "athlete_squad_second");
assert(athleteFirst);
assert(athleteSecond);
assertTimeWindow(athleteFirst, "17:00", "19:00", 120);
assertTimeWindow(athleteSecond, "19:00", "22:00", 180);
assert.equal(athleteFirst.weekday, null);
assert.equal(athleteSecond.weekday, null);
assert.equal(athleteSecond.variationNotice, "middle_school_second_block_may_vary");

assert.equal(finalMainSpecialSchedules.length, 3);
for (const schedule of finalMainSpecialSchedules) {
  assert.equal(typeof schedule.label, "string");
  assert.equal(typeof schedule.time, "string");
  assert(Array.isArray(schedule.items));
  assert(schedule.items.every((item) => typeof item.label === "string" && typeof item.time === "string"));
}
assert.deepEqual(
  finalMainSpecialSchedules[0].items.map(({ label, time }) => [label, time]),
  [
    ["토요일 유도", "11:00-12:30"],
  ],
);
assert.deepEqual(
  finalMainSpecialSchedules[1].items.map(({ label, time }) => [label, time]),
  [
    ["선수부 1부", "17:00-19:00"],
    ["선수부 2부", "19:00-22:00"],
  ],
);
assert.equal(finalMainSpecialSchedules[1].items[1].note, "중등 둘째 블록 변동 가능");
assert.deepEqual(
  finalMainSpecialSchedules[2].items.map(({ label, time }) => [label, time]),
  [
    ["입시 준비", "20:00-23:00 일정 협의"],
    ["경찰·군인·소방/단축 단 준비", "일정 협의"],
  ],
);

const sunday = resolveFinalMainDayPolicy("sunday");
assert.equal(sunday.regularJudo, null);
assert.deepEqual(sunday.specialSessions, []);
assert.equal(sunday.trainingProgram, null);

const commonOpening = ["stretching", "conditioning", "uchikomi"];
const commonClosing = ["groundwork_randori", "throwing_randori", "cooldown"];
const techniqueByDay = {
  monday: "throwing_technique",
  tuesday: "groundwork_technique",
  wednesday: "mixed_technique",
  thursday: "throwing_breakfall",
  friday: "throwing_breakfall",
};

for (const [day, technique] of Object.entries(techniqueByDay)) {
  const phaseIds = resolveFinalMainDayPolicy(day).trainingProgram.map((phase) => phase.id);
  assert.deepEqual(phaseIds.slice(0, 3), commonOpening);
  assert.equal(phaseIds[3], technique);
  assert.deepEqual(phaseIds.slice(-3), commonClosing);
  assert.equal(phaseIds.length, 7);
}

assert.equal(finalMainTrainingProgram.length, 5);
for (const program of finalMainTrainingProgram) {
  assert.equal(typeof program.label, "string");
  assert.equal(program.time, "각 정규 수업 60분");
  assert.equal(program.items.length, 7);
  assert.strictEqual(getFinalMainTrainingProgramForWeekday(program.weekday), program);
}
assert.equal(getFinalMainTrainingProgramForWeekday(0), null);
assert.equal(getFinalMainTrainingProgramForWeekday(6), null);
assert.equal(getFinalMainTrainingProgramForWeekday(-1), null);
assert.equal(getFinalMainTrainingProgramForWeekday(7), null);
assert.equal(getFinalMainTrainingProgramForWeekday(1.5), null);

const entrancePreparation = finalMainSchedulePolicy.coordinatedPrograms.find(
  (program) => program.id === "entrance_exam_preparation",
);
const careerPreparation = finalMainSchedulePolicy.coordinatedPrograms.find(
  (program) => program.id === "career_and_expedited_dan_preparation",
);
assert(entrancePreparation);
assert(careerPreparation);
assert.equal(entrancePreparation.scheduleMode, "by_coordination");
assertTimeWindow(entrancePreparation.preferredTimeWindow, "20:00", "23:00", 180);
assert.equal(careerPreparation.scheduleMode, "by_coordination");
assert.deepEqual(careerPreparation.tracks, ["police", "military", "firefighter", "expedited_dan"]);
assert.equal(careerPreparation.preferredTimeWindow, null);

assert.deepEqual(finalMainSchedulePolicy.promotionOperationsReference, {
  referenceOnly: true,
  policyModule: "final-common-promotion-policy",
  policyExport: "finalCommonPromotionPolicy",
  policyScope: "all_branches",
  notices: ["둘째 금요일 특별승급", "넷째 금요일 정기승급"],
});

console.log(
  JSON.stringify(
    {
      ok: true,
      policy: finalMainSchedulePolicy.id,
      scope: finalMainSchedulePolicy.scope.applicability,
      checked: [
        "Mon-Thu six hourly all-ages open classes",
        "Friday five hourly classes and 22:00 closing",
        "Saturday add-on/day-pass judo and weekday-independent athlete squads",
        "Sunday has no classes",
        "coordinated preparation programs",
        "weekday training phase order and technique focus",
        "UI-ready label/time/items integration exports",
        "numeric weekday training resolver",
        "common promotion policy reference only",
      ],
    },
    null,
    2,
  ),
);
