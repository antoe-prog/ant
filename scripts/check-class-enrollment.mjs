import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findOverlappingClassEnrollment,
  getClassRegistrationBlockReason,
  isClassAgeGroupCompatible,
} from "../src/lib/class-enrollment-policy.ts";

const now = new Date("2026-07-21T00:00:00.000Z");
const member = {
  id: "member-1",
  branchId: "branch-1",
  status: "active",
  ageGroup: "adult",
};
const enrolledClass = {
  id: "class-existing",
  branchId: "branch-1",
  startsAt: "2026-07-22T09:00:00.000Z",
  endsAt: "2026-07-22T10:00:00.000Z",
  ageGroup: "adult",
  capacity: 10,
  enrolledMemberIds: [member.id],
};
const availableClass = {
  id: "class-available",
  branchId: "branch-1",
  startsAt: "2026-07-22T11:00:00.000Z",
  endsAt: "2026-07-22T12:00:00.000Z",
  ageGroup: "all",
  capacity: 2,
  enrolledMemberIds: [],
};
const db = { classes: [enrolledClass, availableClass] };

assert.equal(isClassAgeGroupCompatible(member, availableClass), true, "all-age classes must accept adult members");
assert.equal(
  isClassAgeGroupCompatible(member, { ...availableClass, ageGroup: "kids" }),
  false,
  "age-specific classes must reject incompatible members",
);
assert.equal(getClassRegistrationBlockReason(db, member, availableClass, now), null, "compatible future classes must be registerable");
assert.equal(
  getClassRegistrationBlockReason(db, member, { ...availableClass, branchId: "branch-2" }, now),
  "회원과 수업의 지점이 다릅니다.",
  "registration must enforce branch isolation",
);
assert.equal(
  getClassRegistrationBlockReason(db, { ...member, status: "paused" }, availableClass, now),
  "활성 또는 체험 회원만 수업을 신청할 수 있습니다.",
  "paused members must not register",
);
assert.equal(
  getClassRegistrationBlockReason(db, member, { ...availableClass, enrolledMemberIds: ["member-2", "member-3"] }, now),
  "수업 정원이 마감되었습니다.",
  "registration must enforce capacity",
);
const overlappingTarget = {
  ...availableClass,
  startsAt: "2026-07-22T09:30:00.000Z",
  endsAt: "2026-07-22T10:30:00.000Z",
};
assert.equal(findOverlappingClassEnrollment(db, member.id, overlappingTarget)?.id, enrolledClass.id);
assert.equal(
  getClassRegistrationBlockReason(db, member, overlappingTarget, now),
  "같은 시간에 이미 신청한 수업이 있습니다.",
  "registration must reject time overlaps",
);

const [enrollmentRoute, optionsRoute, rosterRoute, classesScreen] = await Promise.all([
  readFile(new URL("../src/app/api/v1/classes/[classId]/enrollment/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/v1/classes/registration-options/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/v1/classes/[classId]/roster-candidates/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/screens/classes-screen.tsx", import.meta.url), "utf8"),
]);

assert(enrollmentRoute.includes("requireSession(request, initialDb)"), "enrollment route must authenticate before parsing the body");
assert(enrollmentRoute.includes("class-mutation:${classId}"), "enrollment updates must share the class mutation lock");
assert(enrollmentRoute.includes("getAccessibleMemberIds"), "enrollment must verify linked family members");
assert(optionsRoute.includes("getClassRegistrationBlockReason"), "registration options must use the server policy");
assert(!optionsRoute.includes("enrolledMemberIds:"), "registration options must not return raw rosters");
assert(rosterRoute.includes('user.role === "coach" && session.coachId !== user.id'), "coach roster access must be limited to assigned classes");
assert(classesScreen.includes('const canManageClasses = ["coach", "owner", "admin"]'), "all operator roles must reach class creation");
assert(classesScreen.includes("ClassRegistrationPanel"), "family class registration UI must be rendered");
assert(classesScreen.includes("ClassRosterEditor"), "operator roster management UI must be rendered");

console.log("class enrollment policy checks passed");
