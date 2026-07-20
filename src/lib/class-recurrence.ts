export const classWeekdayOptions = [
  { label: "일", value: 0 },
  { label: "월", value: 1 },
  { label: "화", value: 2 },
  { label: "수", value: 3 },
  { label: "목", value: 4 },
  { label: "금", value: 5 },
  { label: "토", value: 6 },
] as const;

export type ClassWeeklyRecurrence = {
  mode: "weekly";
  startsOn: string;
  endsOn: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
};

export type ClassRecurrenceOccurrence = {
  date: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
};

type ClassRecurrenceResult =
  | { ok: false; error: string }
  | { ok: true; recurrence: ClassWeeklyRecurrence; occurrences: ClassRecurrenceOccurrence[] };

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const maximumRecurrenceDays = 366;

function parseDateKey(value: string) {
  if (!dateKeyPattern.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function timeToMinutes(value: string) {
  if (!timePattern.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function koreaDateTimeToIso(dateKey: string, time: string) {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

export function getClassWeeklyRecurrence(value: unknown): ClassRecurrenceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "요일 고정 정보가 올바른 형식이 아닙니다." };
  }

  const source = value as Record<string, unknown>;

  if (source.mode !== "weekly") {
    return { ok: false, error: "지원하지 않는 반복 방식입니다." };
  }

  if (
    typeof source.startsOn !== "string" ||
    typeof source.endsOn !== "string" ||
    typeof source.startTime !== "string" ||
    typeof source.endTime !== "string" ||
    !Array.isArray(source.weekdays) ||
    source.weekdays.some((weekday) => typeof weekday !== "number")
  ) {
    return { ok: false, error: "요일 고정 기간과 시간을 확인해 주세요." };
  }

  const startsOn = parseDateKey(source.startsOn);
  const endsOn = parseDateKey(source.endsOn);
  const startMinutes = timeToMinutes(source.startTime);
  const endMinutes = timeToMinutes(source.endTime);
  const weekdays = [...new Set(source.weekdays)];

  if (!startsOn || !endsOn) {
    return { ok: false, error: "요일 고정 시작일과 종료일을 확인해 주세요." };
  }

  const rangeDays = Math.floor((endsOn.getTime() - startsOn.getTime()) / 86_400_000) + 1;

  if (rangeDays < 1) {
    return { ok: false, error: "종료일은 시작일보다 빠를 수 없습니다." };
  }

  if (rangeDays > maximumRecurrenceDays) {
    return { ok: false, error: "요일 고정 수업은 최대 1년까지 등록할 수 있습니다." };
  }

  if (
    weekdays.length === 0 ||
    weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
  ) {
    return { ok: false, error: "고정할 요일을 하나 이상 선택해 주세요." };
  }

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return { ok: false, error: "종료 시간은 시작 시간보다 늦어야 합니다." };
  }

  const recurrence: ClassWeeklyRecurrence = {
    mode: "weekly",
    startsOn: source.startsOn,
    endsOn: source.endsOn,
    weekdays,
    startTime: source.startTime,
    endTime: source.endTime,
  };
  const occurrences: ClassRecurrenceOccurrence[] = [];

  for (let offset = 0; offset < rangeDays; offset += 1) {
    const date = new Date(startsOn.getTime() + offset * 86_400_000);
    const weekday = date.getUTCDay();

    if (!weekdays.includes(weekday)) {
      continue;
    }

    const dateKey = date.toISOString().slice(0, 10);
    occurrences.push({
      date: dateKey,
      weekday,
      startsAt: koreaDateTimeToIso(dateKey, recurrence.startTime),
      endsAt: koreaDateTimeToIso(dateKey, recurrence.endTime),
    });
  }

  if (occurrences.length === 0) {
    return { ok: false, error: "선택한 기간에 등록할 수업 요일이 없습니다." };
  }

  return { ok: true, recurrence, occurrences };
}
