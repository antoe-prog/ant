"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, MapPin, X } from "lucide-react";
import type { EnrichedClassSession, Tournament } from "@/lib/domain";
import { formatDate, formatDateKey } from "@/lib/format";
import { getTournamentDateKeys } from "@/lib/tournament-dates";

type FamilyClassDayState = "scheduled" | "present" | "absent" | "unrecorded";

type FamilyClassCalendarProps = {
  availableDateKeys?: string[];
  monthKey: string;
  referenceTime: number;
  selectedDateKey: string | null;
  sessions: EnrichedClassSession[];
  tournaments?: Tournament[];
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

function formatTournamentDateRange(tournament: Tournament) {
  const startsAt = formatDate(`${tournament.eventDate}T12:00:00+09:00`);

  if (!tournament.eventEndDate || tournament.eventEndDate === tournament.eventDate) {
    return startsAt;
  }

  return `${startsAt} - ${formatDate(`${tournament.eventEndDate}T12:00:00+09:00`)}`;
}

function getCalendarTournamentLabel(title: string) {
  const compactTitle = title
    .replace(/^\d{4}\s*/u, "")
    .replace(/^제\s*\d+\s*회\s*/u, "")
    .replace(/(?:생활체육)?전국유도대회$|유도대회$|대회$/u, "")
    .trim();

  return compactTitle || title;
}

export function FamilyClassCalendar({
  availableDateKeys = [],
  monthKey,
  referenceTime,
  selectedDateKey,
  sessions,
  tournaments = [],
  onMonthChange,
  onSelectDate,
}: FamilyClassCalendarProps) {
  const [tournamentDetailDateKey, setTournamentDetailDateKey] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const tournamentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { year, month } = parseMonthKey(monthKey);
  const todayDateKey = formatDateKey(new Date(referenceTime));
  const sessionsByDate = new Map<string, EnrichedClassSession[]>();
  const tournamentsByDate = new Map<string, Tournament[]>();
  const availableDateKeySet = new Set(availableDateKeys.filter((dateKey) => dateKey.startsWith(`${monthKey}-`)));

  for (const session of sessions) {
    const dateKey = formatDateKey(session.startsAt);
    const current = sessionsByDate.get(dateKey) ?? [];
    current.push(session);
    sessionsByDate.set(dateKey, current);
  }

  for (const tournament of tournaments) {
    for (const dateKey of getTournamentDateKeys(tournament)) {
      const current = tournamentsByDate.get(dateKey) ?? [];
      current.push(tournament);
      tournamentsByDate.set(dateKey, current);
    }
  }

  const monthClassDateKeys = new Set(availableDateKeySet);
  for (const dateKey of sessionsByDate.keys()) {
    if (dateKey.startsWith(`${monthKey}-`)) {
      monthClassDateKeys.add(dateKey);
    }
  }

  const closeTournamentDetail = useCallback(() => {
    setTournamentDetailDateKey(null);
    window.requestAnimationFrame(() => tournamentTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!tournamentDetailDateKey) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTournamentDetail();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeTournamentDetail, tournamentDetailDateKey]);

  const detailedTournaments = tournamentDetailDateKey
    ? tournamentsByDate.get(tournamentDetailDateKey) ?? []
    : [];

  return (
    <>
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
            const dayTournaments = inCurrentMonth ? tournamentsByDate.get(dateKey) ?? [] : [];
            const hasAvailableClass = availableDateKeySet.has(dateKey);
            const state = daySessions.length > 0 ? getDayState(daySessions, referenceTime) : hasAvailableClass ? "scheduled" : null;
            const hasTournament = dayTournaments.length > 0;
            const isSelected = selectedDateKey === dateKey;
            const isToday = todayDateKey === dateKey;
            const tournamentNames = dayTournaments.map((tournament) => tournament.title).join(", ");

            if (!inCurrentMonth) {
              return <div aria-hidden className="h-16" key={dateKey} />;
            }

            if (!state && !hasTournament) {
              return (
                <div
                  aria-current={isToday ? "date" : undefined}
                  className="flex h-16 items-start justify-center pt-2 text-xs text-zinc-400"
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
                    ? `${getDayAriaLabel(dateKey, daySessions, referenceTime)}${hasTournament ? `, ${tournamentNames}` : ""}`
                    : `${Number(dateKey.slice(5, 7))}월 ${Number(dateKey.slice(8, 10))}일${
                        hasAvailableClass ? ", 신청 가능한 수업" : ""
                      }${hasTournament ? `, ${tournamentNames}` : ""}`
                }
                aria-pressed={isSelected}
                className="flex h-16 min-w-0 flex-col items-center justify-start gap-0.5 rounded-md pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1"
                data-family-calendar-state={state}
                data-testid={`family-class-calendar-date-${dateKey}`}
                key={dateKey}
                type="button"
                onClick={(event) => {
                  onSelectDate(dateKey);
                  if (hasTournament) {
                    tournamentTriggerRef.current = event.currentTarget;
                    setTournamentDetailDateKey(dateKey);
                  }
                }}
              >
                <span
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
                    state
                      ? dayStatePresentation[state].className
                      : "border border-amber-400 bg-amber-50 text-zinc-900"
                  } ${isSelected ? "ring-2 ring-zinc-950 ring-offset-1" : ""}`}
                >
                  {Number(dateKey.slice(8, 10))}
                </span>
                {hasTournament ? (
                  <span
                    className="w-full min-w-0 px-0.5 text-center text-[10px] font-semibold leading-3 text-amber-800"
                    title={dayTournaments[0].title}
                  >
                    <span className={dayTournaments.length > 1 ? "block truncate" : "line-clamp-2 block break-keep"}>
                      {getCalendarTournamentLabel(dayTournaments[0].title)}
                    </span>
                    {dayTournaments.length > 1 ? (
                      <span className="block text-[9px] leading-3 text-amber-700">외 {dayTournaments.length - 1}건</span>
                    ) : null}
                  </span>
                ) : daySessions.length > 1 ? (
                  <span className="text-[10px] font-semibold leading-3 text-zinc-500">{daySessions.length}회</span>
                ) : null}
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
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-amber-400 bg-amber-50" aria-hidden />
            대회 일정
          </span>
        </div>
      </section>

      {tournamentDetailDateKey && detailedTournaments.length > 0 ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-zinc-950/55 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center"
          data-testid="family-calendar-tournament-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeTournamentDetail();
            }
          }}
        >
          <section
            aria-labelledby="family-calendar-tournament-dialog-title"
            aria-modal="true"
            className="max-h-[82dvh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl"
            data-testid="family-calendar-tournament-dialog"
            role="dialog"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-700">
                  {formatDate(`${tournamentDetailDateKey}T12:00:00+09:00`)}
                </p>
                <h2 className="mt-0.5 text-lg font-bold text-zinc-950" id="family-calendar-tournament-dialog-title">
                  대회 일정 {detailedTournaments.length}건
                </h2>
              </div>
              <button
                aria-label="대회 상세 닫기"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-100"
                ref={closeButtonRef}
                type="button"
                onClick={closeTournamentDetail}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </header>
            <ul className="divide-y divide-zinc-200 px-4" data-testid="family-calendar-selected-tournaments">
              {detailedTournaments.map((tournament) => (
                <li className="py-4" key={tournament.id}>
                  <p className="text-base font-bold leading-6 text-zinc-950">{tournament.title}</p>
                  <dl className="mt-3 grid gap-2 text-sm text-zinc-700">
                    <div className="flex items-start gap-2">
                      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                      <div>
                        <dt className="sr-only">대회 기간</dt>
                        <dd>{formatTournamentDateRange(tournament)}</dd>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                      <div>
                        <dt className="sr-only">주최</dt>
                        <dd>{tournament.organizer}</dd>
                      </div>
                    </div>
                    {tournament.location ? (
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                        <div>
                          <dt className="sr-only">장소</dt>
                          <dd>{tournament.location}</dd>
                        </div>
                      </div>
                    ) : null}
                  </dl>
                  {tournament.registrationDeadline ? (
                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                      신청 마감 {formatDate(`${tournament.registrationDeadline}T12:00:00+09:00`)}
                    </p>
                  ) : null}
                  {tournament.description ? (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-600">{tournament.description}</p>
                  ) : null}
                  {tournament.sourceUrl ? (
                    <a
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-teal-700 transition hover:bg-zinc-50"
                      href={tournament.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      원문에서 자세히 보기
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </>
  );
}
