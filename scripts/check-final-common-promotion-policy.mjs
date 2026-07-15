import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { judoBelts } from "../src/lib/domain.ts";
import {
  canCoachManagePromotionMember,
  canTakeYouthToGeneralPromotionExam,
  finalCommonPromotionPeriodRules,
  finalCommonPromotionPolicy,
  finalCommonPromotionPolicyVersion,
  finalCommonPromotionSkillCategories,
  finalGeneralPromotionGrades,
  finalYouthPromotionGrades,
  getExactNextCompatiblePromotionBelt,
  getFinalCommonPromotionPolicyForBranch,
  getFinalPromotionAgeBand,
  getFinalPromotionExamKind,
  getFinalPromotionMonthlyRequiredHours,
  getFinalPromotionPeriodRule,
  getFinalPromotionTrackForAge,
  getPromotionAgeBand,
  getPromotionPeriodRule,
  getRecognizedPromotionTrainingHoursForDay,
  isExactNextCompatiblePromotionBelt,
  isFinalPromotionGradeForTrack,
} from "../src/lib/final-common-promotion-policy.ts";

const createRouteSource = await readFile("src/app/api/v1/promotions/route.ts", "utf8");
const resultRouteSource = await readFile("src/app/api/v1/promotions/[promotionId]/route.ts", "utf8");

assert.equal(finalCommonPromotionPolicy.scope, "all_branches", "promotion policy must be common to every branch");
assert.equal(finalCommonPromotionPolicyVersion, "2026-03", "common promotion policy must expose its source revision");
assert.equal(finalCommonPromotionPolicy.version, finalCommonPromotionPolicyVersion, "policy summary must include the exported version");
assert.strictEqual(
  getFinalCommonPromotionPolicyForBranch("branch-gangnam"),
  getFinalCommonPromotionPolicyForBranch("branch-songpa"),
  "different branches must resolve the same promotion policy object",
);
assert.deepEqual(
  finalCommonPromotionSkillCategories.map(({ id, label }) => [id, label]),
  [
    ["ukemi", "낙법"],
    ["nage_waza", "메치기"],
    ["katame_waza", "굳히기"],
    ["theory", "이론"],
  ],
  "promotion policy must expose only the four verified skill categories",
);
assert.deepEqual(finalYouthPromotionGrades, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "youth grades must cover 10 through 1");
assert.deepEqual(finalGeneralPromotionGrades, [8, 7, 6, 5, 4, 3, 2, 1], "general grades must cover 8 through 1");
assert.equal(isFinalPromotionGradeForTrack("youth", 10), true, "youth track must accept grade 10");
assert.equal(isFinalPromotionGradeForTrack("general", 10), false, "general track must reject grade 10");
assert.equal(isFinalPromotionGradeForTrack("general", 8), true, "general track must accept grade 8");

for (const [age, expectedBand, expectedTrack] of [
  [8, "age_8_and_under", "youth"],
  [9, "age_9_to_13", "youth"],
  [13, "age_9_to_13", "youth"],
  [14, "age_14_to_16", "general"],
  [16, "age_14_to_16", "general"],
  [17, "age_17_to_19", "general"],
  [19, "age_17_to_19", "general"],
  [20, "age_20_and_over", "general"],
  [70, "age_20_and_over", "general"],
]) {
  assert.equal(getFinalPromotionAgeBand(age).id, expectedBand, `age ${age} must resolve the correct promotion age band`);
  assert.equal(getPromotionAgeBand(age).id, expectedBand, `age ${age} must resolve the integration age band`);
  assert.equal(getFinalPromotionTrackForAge(age), expectedTrack, `age ${age} must resolve the correct promotion track`);
  assert.equal(getFinalPromotionMonthlyRequiredHours(age, "normal"), 12, `age ${age} normal training must require 12 hours`);
}

for (const [age, expectedHours] of [
  [8, 28],
  [9, 28],
  [13, 28],
  [14, 26],
  [16, 26],
  [17, 26],
  [19, 26],
  [20, 24],
  [70, 24],
]) {
  assert.equal(
    getFinalPromotionMonthlyRequiredHours(age, "accelerated"),
    expectedHours,
    `age ${age} accelerated training hours must match the common policy`,
  );
}

assert.equal(canTakeYouthToGeneralPromotionExam(13, "youth"), false, "age 13 must stay on the youth track");
assert.equal(canTakeYouthToGeneralPromotionExam(14, "youth"), true, "age 14 youth members may take the general transition exam");
assert.equal(canTakeYouthToGeneralPromotionExam(14, "general"), false, "general members do not need a youth transition exam");
assert.equal(getRecognizedPromotionTrainingHoursForDay(0.5), 0.5, "sub-hour daily training must be recognized as recorded");
assert.equal(getRecognizedPromotionTrainingHoursForDay(1), 1, "one daily training hour must be recognized");
assert.equal(getRecognizedPromotionTrainingHoursForDay(2), 1, "daily training recognition must be capped at one hour");
assert.equal(getRecognizedPromotionTrainingHoursForDay(-1), 0, "negative daily training must not be recognized");

const expectedPeriodRules = {
  age_8_and_under: [[10, 2, 2], [9, 4, 2], [8, 7, 3], [7, 9, 2, 6], [6, 11, 2], [5, 14, 3], [4, 16, 2, 12], [3, 18, 2], [2, 21, 3], [1, 23, 2, 18]],
  age_9_to_13: [[10, 2, 2], [9, 4, 2], [8, 6, 2], [7, 8, 2, 4], [6, 10, 2], [5, 12, 2], [4, 14, 2, 7], [3, 16, 2], [2, 18, 2], [1, 20, 2, 10]],
  age_14_to_16: [[10, 1, 1], [9, 2, 1], [8, 4, 2], [7, 5, 1, 3], [6, 7, 2], [5, 8, 1], [4, 10, 2, 6], [3, 11, 1], [2, 13, 2], [1, 14, 1, 9]],
  age_17_to_19: [[10, 1, 1], [9, 2, 1], [8, 3, 1], [7, 5, 2, 3], [6, 6, 1], [5, 7, 1], [4, 9, 2, 6], [3, 10, 1], [2, 11, 1], [1, 12, 1, 9]],
  age_20_and_over: [[10, 1, 1], [9, 2, 1], [8, 3, 1], [7, 4, 1, 2], [6, 5, 1], [5, 6, 1], [4, 7, 1, 4], [3, 8, 1], [2, 9, 1], [1, 10, 1, 6]],
};

for (const [ageBandId, expectedRules] of Object.entries(expectedPeriodRules)) {
  assert.deepEqual(
    finalCommonPromotionPeriodRules[ageBandId].map((rule) => [
      rule.grade,
      rule.cumulativeMonths,
      rule.monthsAtGrade,
      ...(rule.acceleratedCumulativeMonths === undefined ? [] : [rule.acceleratedCumulativeMonths]),
    ]),
    expectedRules,
    `${ageBandId} promotion period table must match the common regulation`,
  );
}

assert.deepEqual(getFinalPromotionPeriodRule(8, 7), {
  grade: 7,
  cumulativeMonths: 9,
  monthsAtGrade: 2,
  acceleratedCumulativeMonths: 6,
});
assert.deepEqual(getFinalPromotionPeriodRule(20, 1), {
  grade: 1,
  cumulativeMonths: 10,
  monthsAtGrade: 1,
  acceleratedCumulativeMonths: 6,
});
assert.deepEqual(getPromotionPeriodRule(20, 1), getFinalPromotionPeriodRule(20, 1), "integration period helper must match the compatible alias");
assert.equal(getFinalPromotionExamKind("2026-07-10"), "special", "the second Friday must be a special grading day");
assert.equal(getFinalPromotionExamKind("2026-07-24"), "regular", "the fourth Friday must be a regular grading day");
assert.equal(getFinalPromotionExamKind("2026-07-17"), null, "the third Friday must not be a common grading day");
assert.equal(getFinalPromotionExamKind("2026-07-11"), null, "non-Friday dates must not be common grading days");
assert.equal(getFinalPromotionExamKind("2026-02-30"), null, "invalid dates must not be grading days");

for (let index = 0; index < judoBelts.length; index += 1) {
  const currentBelt = judoBelts[index];
  const expectedNextBelt = judoBelts[index + 1] ?? null;
  assert.equal(getExactNextCompatiblePromotionBelt(currentBelt), expectedNextBelt, `${currentBelt} must resolve only its exact next belt`);

  for (const candidateBelt of judoBelts) {
    assert.equal(
      isExactNextCompatiblePromotionBelt(currentBelt, candidateBelt),
      candidateBelt === expectedNextBelt,
      `${currentBelt} must reject same, lower, and skipped belt targets`,
    );
  }
}

const coach = {
  id: "coach-a",
  role: "coach",
  branchIds: ["branch-a"],
};
const coachScopeDb = {
  classes: [
    {
      id: "class-a",
      branchId: "branch-a",
      coachId: "coach-a",
      enrolledMemberIds: ["member-class"],
    },
    {
      id: "class-other-coach",
      branchId: "branch-a",
      coachId: "coach-b",
      enrolledMemberIds: ["member-other"],
    },
  ],
};
assert.equal(
  canCoachManagePromotionMember(coach, coachScopeDb, { id: "member-class", branchId: "branch-a" }),
  true,
  "coach must manage members enrolled in a class they teach",
);
assert.equal(
  canCoachManagePromotionMember(coach, coachScopeDb, { id: "member-other", branchId: "branch-a" }),
  false,
  "coach must not manage unrelated members in the same branch",
);
assert.equal(
  canCoachManagePromotionMember(coach, coachScopeDb, { id: "member-class", branchId: "branch-b" }),
  false,
  "coach must not manage promotion members in another branch",
);

for (const [source, branchExpression, label] of [
  [createRouteSource, "selectedScope.selectedBranchId !== member.branchId", "promotion create route"],
  [resultRouteSource, "selectedScope.selectedBranchId !== promotion.branchId", "promotion result route"],
]) {
  assert(source.includes(branchExpression), `${label} must reject a resource outside the selected branch`);
  assert(source.includes("canCoachManagePromotionMember(user, db, member)"), `${label} must enforce coach assignment scope`);
}
assert(
  createRouteSource.includes("isExactNextCompatiblePromotionBelt(member.belt, toBelt)"),
  "promotion create route must enforce the exact next compatible belt",
);
assert(
  resultRouteSource.includes('result === "passed" && member.belt !== promotion.fromBelt'),
  "promotion result route must block stale passed decisions",
);
assert(
  resultRouteSource.includes('jsonError(409, "CONFLICT"'),
  "promotion result route stale decisions must return a conflict",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "all branches resolve one common promotion policy",
        "youth and general grade ranges and four skill categories",
        "five age bands and normal or accelerated monthly hours",
        "all fifty promotion period rows",
        "daily recognized training is capped at one hour",
        "second-Friday special and fourth-Friday regular grading",
        "existing belt sequence permits only the exact next target",
        "coach class assignment scope",
        "promotion APIs enforce selected branch, coach scope, progression, and stale passed conflicts",
      ],
    },
    null,
    2,
  ),
);
