import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  attendanceInputLimits,
  attendanceStateLockKey,
  getAttendanceNoteLengthError,
  hasAttendanceWindowOpened,
} from "../src/lib/attendance-policy.ts";

assert.equal(attendanceStateLockKey, "attendance-state", "attendance mutations must share one lock key");
assert.equal(
  hasAttendanceWindowOpened("2026-07-18T09:59:59.000Z", new Date("2026-07-18T10:00:00.000Z")),
  true,
  "past class sessions must allow attendance corrections",
);
assert.equal(
  hasAttendanceWindowOpened("2026-07-18T10:00:00.000Z", new Date("2026-07-18T10:00:00.000Z")),
  true,
  "attendance must open exactly at the class start time",
);
assert.equal(
  hasAttendanceWindowOpened("2026-07-18T10:00:01.000Z", new Date("2026-07-18T10:00:00.000Z")),
  false,
  "future class sessions must reject attendance mutations",
);
assert.equal(hasAttendanceWindowOpened("invalid", new Date()), false, "invalid class times must fail closed");
assert.equal(attendanceInputLimits.itemsPerRequest, 200, "batch attendance must keep the 200-item boundary");
assert.equal(attendanceInputLimits.memberIdLength, 200, "attendance member IDs must have a storage boundary");
assert.equal(attendanceInputLimits.noteLength, 80, "attendance notes and reasons must share the UI boundary");
assert.match(
  getAttendanceNoteLengthError("x".repeat(81)) ?? "",
  /80/,
  "oversized attendance notes must return the shared limit error",
);

const routePaths = [
  "src/app/api/v1/class-sessions/[sessionId]/attendance/route.ts",
  "src/app/api/v1/class-sessions/[sessionId]/attendance/[memberId]/route.ts",
  "src/app/api/v1/class-sessions/[sessionId]/attendance/[memberId]/reason/route.ts",
];

for (const routePath of routePaths) {
  const source = await readFile(routePath, "utf8");

  assert(source.includes("withServerDbLock(attendanceStateLockKey"), `${routePath} must serialize read-check-write`);
  assert(
    source.includes("selectedScope.selectedBranchId !== session.branchId"),
    `${routePath} must reject a selected branch that differs from the class branch`,
  );
  assert(source.includes("hasAttendanceWindowOpened(session.startsAt)"), `${routePath} must reject future class writes`);

  if (source.includes("request.json()")) {
    assert(
      source.indexOf("selectedScope.selectedBranchId !== session.branchId") < source.indexOf("request.json()"),
      `${routePath} must reject branch mismatches before parsing mutation input`,
    );
    assert(
      source.indexOf("hasAttendanceWindowOpened(session.startsAt)") < source.indexOf("request.json()"),
      `${routePath} must reject future sessions before parsing mutation input`,
    );
    assert(
      source.indexOf("request.json()") < source.indexOf("withServerDbLock(attendanceStateLockKey"),
      `${routePath} must parse and validate the body before acquiring the shared attendance lock`,
    );
    assert(
      source.match(/await requireAttendance(?:Update|Reason)Context\(\)/g)?.length === 2,
      `${routePath} must recheck current authorization and class state inside the attendance lock`,
    );
  }
}

const storeSource = await readFile("src/store/app-store.tsx", "utf8");
assert(
  storeSource.includes("재시도할 수 있게 저장 대기에 남겼습니다.") &&
    storeSource.match(/syncStatus: "failed",[\s\S]{0,260}queuedUpdate/g)?.length >= 2 &&
    storeSource.includes("queuedUpdates,"),
  "failed single, clear, and batch attendance writes must remain in the retry queue",
);

const batchAttendanceRouteSource = await readFile(routePaths[0], "utf8");
for (const snippet of [
  "getAttendanceUpdateBodyTypeError",
  "attendanceInputLimits.itemsPerRequest",
  "attendanceInputLimits.memberIdLength",
  "getAttendanceNoteLengthError(body.reason",
  "getAttendanceNoteLengthError(candidate.note)",
  "Array.isArray(body.items)",
  "memberIds.has(candidate.memberId)",
]) {
  assert(batchAttendanceRouteSource.includes(snippet), `batch attendance input safety is missing ${snippet}`);
}

const smokeSource = await readFile("scripts/smoke-api.mjs", "utf8");
assert(
  smokeSource.includes("slow attendance body parsing must not hold the shared attendance lock") &&
    smokeSource.includes("attendance reason must persist while another request body is still streaming"),
  "smoke coverage must prove a slow attendance body cannot block another attendance mutation",
);

const classesScreenSource = await readFile("src/components/screens/classes-screen.tsx", "utf8");
assert(
  classesScreenSource.includes("attendanceInputLimits") &&
    classesScreenSource.includes("const attendanceWindowOpen = hasAttendanceWindowOpened(session.startsAt") &&
    classesScreenSource.includes("maxLength={attendanceInputLimits.noteLength}") &&
    classesScreenSource.includes("disabled={!attendanceWindowOpen || allMemberIds.length === 0") &&
    classesScreenSource.includes("disabled={!attendanceWindowOpen || attendanceSyncPending}"),
  "attendance UI must disable bulk and individual mutation controls until the class starts",
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "attendance start-time boundary",
    "shared server mutation lock",
    "selected branch and class branch equality",
    "future-session rejection before body parsing",
    "request body parsing outside the shared lock with in-lock authorization recheck",
    "slow-body cross-request lock integration coverage",
    "batch attendance object, item, size, and duplicate-member validation",
    "shared attendance member ID and note/reason length boundaries",
    "future-session UI mutation guard",
    "failed attendance writes remain retryable",
  ],
}, null, 2));
