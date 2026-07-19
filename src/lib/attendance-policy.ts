export const attendanceStateLockKey = "attendance-state";

export const attendanceInputLimits = {
  itemsPerRequest: 200,
  memberIdLength: 200,
  noteLength: 80,
} as const;

export function getAttendanceNoteLengthError(value: unknown, label = "출석 메모") {
  if (typeof value === "string" && value.length > attendanceInputLimits.noteLength) {
    return `${label}은 ${attendanceInputLimits.noteLength}자 이하로 입력해 주세요.`;
  }

  return null;
}

export function hasAttendanceWindowOpened(startsAt: string, now = new Date()) {
  const startsAtMs = Date.parse(startsAt);

  return Number.isFinite(startsAtMs) && startsAtMs <= now.getTime();
}
