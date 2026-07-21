"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { EnrichedClassSession } from "@/lib/domain";
import { formatDateKey } from "@/lib/format";

type FamilyClassDayState = "scheduled" | "present" | "absent" | "unrecorded";

type FamilyClassCalendarProps = {
  availableDateKeys?: string[];
  monthKey: string;
  referenceTime: number;
  selectedDateKey: string | null;
  sessions: EnrichedClassSession[];
  onMonthChange: (monthKey: string) => void;
  onSelectDate: (dateKey: string) => void;
};

const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

const dayStatePresentation: Record<FamilyClassDayState, { className: string; label: string }> = {
  scheduled: {
    className: "border-2 border-teal-500 bg-white text-teal-900",
    label: "예정",
  },
  present: {
    className: "border border-emerald-700 bg-emerald-600 text-white",
    label: "출석",
  },
  absent: {
    className: "border border-red-700 bg-red-600 text-white",
    label: "결석",
  },
  unrecorded: {
    className: "border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900",
    label: "미기록",
  },
};

function parseMonthKey(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);

  if (!match) {
    const today = formatDateKey(new Date());
    return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  }

  return { year: Number(match[1]), month: Number(match[2]) };
}

function formatCalendarDateKey(year: number, monthIndex: number, day: number) {
  const date = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function shiftMonthKey(monthKey: string, offset: number) {
  const { year, month } = parseMonthKey(monthKey);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1, 12, 0, 0));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getCalendarDateKeys(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  const firstDay = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const firstWeekday = firstDay.getUTCDay();

  return Array.from({ length: 42 }, (_, index) =>
    formatCalendarDateKey(year, month - 1, index - firstWeekday + 1),
  );
}

function getSessionDayState(session: EnrichedClassSession, referenceTime: number): FamilyClassDayState {
  if (session.attendance.some((record) => record.status === "absent" || record.status === "excused")) {
    return "absent";
  }

  if (
    session.attendance.length > 0 &&
    session.attendance.every((record) => record.status === "present" || record.status === "late")
  ) {
    return "present";
  }

  return new Date(session.endsAt).getTime() < referenceTime ? "unrecorded" : "scheduled";
}

function getDayState(sessions: EnrichedClassSession[], referenceTime: number): FamilyClassDayState {
  const states = sessions.map((session) => getSessionDayState(session, referenceTime));

  if (states.includes("absent")) {
    return "absent";
  }

  if (states.includes("unrecorded")) {
    return "unrecorded";
  }

  if (states.length > 0 && states.every((state) => state === "present")) {
    return "present";
  }

  return "scheduled";
}

function getDayAriaLabel(dateKey: string, sessions: EnrichedClassSession[], referenceTime: number) {
  const day = Number(dateKey.slice(8, 10));
  const stateCounts = sessions.reduce<Record<FamilyClassDayState, number>>(
    (counts, session) => {
      counts[getSessionDayState(session, referenceTime)] += 1;
      return counts;
    },
    { absent: 0, present: 0, scheduled: 0, unrecorded: 0 },
  );
  const statusSummary = (Object.entries(stateCounts) as Array<[FamilyClassDayState, number]>)
    .filter(([, count]) => count > 0)
    .map(([state, count]) => `${dayStatePresentation[state].label} ${count}개`)
    .join(", ");

  return `${Number(dateKey.slice(5, 7))}월 ${day}일, 수업 ${sessions.length}개, ${statusSummary}`;
}

export function FamilyClassCalendar({
  availableDateKeys = [],
  monthKey,
  referenceTime,
  selectedDateKey,
  sessions,
  onMonthChange,
  onSelectDate,
}: FamilyClassCalendarProps) {
  const { year, month } = parseMonthKey(monthKey);
  const todayDateKey = formatDateKey(new Date(referenceTime));
  const sessionsByDate = new Map<string, EnrichedClassSession[]>();
  const availableDateKeySet = new Set(availableDateKeys.filter((dateKey) => dateKey.startsWith(`${monthKey}-`)));

  for (const session of sessions) {
    const dateKey = formatDateKey(session.startsAt);
    const current = sessionsByDate.get(dateKey) ?? [];
    current.push(session);
    sessionsByDate.set(dateKey, current);
  }

  const monthClassDateKeys = new Set(availableDateKeySet);
  for (const dateKey of sessionsByDate.keys()) {
    if (dateKey.startsWith(`${monthKey}-`)) {
      monthClassDateKeys.add(dateKey);
    }
  }

  return (
    <section
      aria-label="수업 출석 달력"
      className="mb-3 rounded-lg border border-zinc-200 bg-white p-3"
      data-testid="family-class-calendar"
    >
      <div className="flex min-h-11 items-center justify-between gap-2">
        <button
          aria-label="이전 달"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50"
          data-testid="family-class-calendar-previous-month"
          type="button"
          onClick={() => onMonthChange(shiftMonthKey(monthKey, -1))}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 text-center">
          <h2 className="text-base font-semibold text-zinc-950" data-testid="family-class-calendar-month-label">
            {year}년 {month}월
          </h2>
          <p className="mt-0.5 text-xs font-medium text-zinc-500">이달 수업 {monthClassDateKeys.size}일</p>
        </div>
        <button
          aria-label="다음 달"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50"
          data-testid="family-class-calendar-next-month"
          type="button"
          onClick={() => onMonthChange(shiftMonthKey(monthKey, 1))}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7" aria-hidden>
        {weekdayLabels.map((label, index) => (
          <span
            className={`py-1 text-center text-[11px] font-semibold ${index === 0 ? "text-red-600" : index === 6 ? "text-blue-600" : "text-zinc-500"}`}
            key={label}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7" data-testid="family-class-calendar-grid">
        {getCalendarDateKeys(monthKey).map((dateKey) => {
          const inCurrentMonth = dateKey.startsWith(`${monthKey}-`);
          const daySessions = inCurrentMonth ? sessionsByDate.get(dateKey) ?? [] : [];
          const hasAvailableClass = availableDateKeySet.has(dateKey);
          const state = daySessions.length > 0 ? getDayState(daySessions, referenceTime) : hasAvailableClass ? "scheduled" : null;
          const isSelected = selectedDateKey === dateKey;
          const isToday = todayDateKey === dateKey;

          if (!inCurrentMonth) {
            return <div aria-hidden className="min-h-12" key={dateKey} />;
          }

          if (!state) {
            return (
              <div
                aria-current={isToday ? "date" : undefined}
                className="flex min-h-12 items-center justify-center text-xs text-zinc-400"
                key={dateKey}
              >
                <span className={isToday ? "font-bold text-zinc-950 underline decoration-2 underline-offset-4" : ""}>
                  {Number(dateKey.slice(8, 10))}
                </span>
              </div>
            );
          }

          return (
            <button
              aria-current={isToday ? "date" : undefined}
              aria-label={
                daySessions.length > 0
                  ? getDayAriaLabel(dateKey, daySessions, referenceTime)
                  : `${Number(dateKey.slice(5, 7))}월 ${Number(dateKey.slice(8, 10))}일, 신청 가능한 수업`
              }
              aria-pressed={isSelected}
              className="flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1"
              data-family-calendar-state={state}
              data-testid={`family-class-calendar-date-${dateKey}`}
              key={dateKey}
              type="button"
              onClick={() => onSelectDate(dateKey)}
            >
              <span
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${dayStatePresentation[state].className} ${isSelected ? "ring-2 ring-zinc-950 ring-offset-2" : ""}`}
              >
                {Number(dateKey.slice(8, 10))}
              </span>
              {daySessions.length > 1 ? <span className="text-[10px] font-semibold leading-3 text-zinc-500">{daySessions.length}회</span> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 border-t border-zinc-100 pt-3 text-xs font-medium text-zinc-600" aria-label="달력 상태 범례">
        {(Object.entries(dayStatePresentation) as Array<[FamilyClassDayState, { className: string; label: string }]>).map(
          ([state, presentation]) => (
            <span className="inline-flex items-center gap-1.5" key={state}>
              <span className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full ${presentation.className}`} aria-hidden />
              {presentation.label}
            </span>
          ),
        )}
      </div>
    </section>
  );
}
