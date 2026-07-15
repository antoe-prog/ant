import { CalendarDays, ChevronDown, Dumbbell } from "lucide-react";
import {
  finalMainSchedulePolicy,
  resolveFinalMainDayPolicy,
  type FinalMainDay,
} from "@/lib/final-main-schedule-policy";

const dayLabels: Record<FinalMainDay, string> = {
  monday: "월",
  tuesday: "화",
  wednesday: "수",
  thursday: "목",
  friday: "금",
  saturday: "토",
  sunday: "일",
};

const englishWeekdayToPolicyDay: Record<string, FinalMainDay> = {
  Monday: "monday",
  Tuesday: "tuesday",
  Wednesday: "wednesday",
  Thursday: "thursday",
  Friday: "friday",
  Saturday: "saturday",
  Sunday: "sunday",
};

const koreaWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  weekday: "long",
});

function todayPolicyDay(): FinalMainDay {
  return englishWeekdayToPolicyDay[koreaWeekdayFormatter.format(new Date())] ?? "monday";
}

function regularScheduleLabel(day: FinalMainDay) {
  const policy = resolveFinalMainDayPolicy(day);

  if (policy.regularJudo) {
    const first = policy.regularJudo.startTimes[0];
    const last = policy.regularJudo.startTimes.at(-1);
    const lastHour = last ? `${String(Number(last.slice(0, 2)) + 1).padStart(2, "0")}:00` : "";
    return `${first}–${lastHour} · 1시간 단위`;
  }

  const fixedSession = policy.specialSessions.find((session) => session.id === "saturday_add_on_judo");
  return fixedSession ? `${fixedSession.startTime}–${fixedSession.endTime} · 별도 추가/일일권` : "운영 없음";
}

export function FinalMainScheduleReference({ branchName }: { branchName: string }) {
  const today = todayPolicyDay();
  const todayProgram = resolveFinalMainDayPolicy(today).trainingProgram;
  const athleteSquadSchedule = finalMainSchedulePolicy.fixedPrograms
    .map((program) => `${program.startTime}–${program.endTime}`)
    .join(" / ");
  const hasMiddleSchoolVariation = finalMainSchedulePolicy.fixedPrograms.some(
    (program) => "variationNotice" in program && program.variationNotice === "middle_school_second_block_may_vary",
  );

  return (
    <details
      aria-labelledby="final-main-schedule-title"
      className="group mt-4 border-y border-zinc-200 bg-white"
      data-testid="final-main-schedule-policy"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-1 py-3 marker:hidden sm:px-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-700">
            <CalendarDays className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-zinc-950" id="final-main-schedule-title">
              {branchName} 참고 시간표
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">요일별 운영·훈련 프로그램</span>
          </span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-zinc-500 transition group-open:rotate-180" aria-hidden />
      </summary>

      <div className="border-t border-zinc-100 px-1 pb-4 pt-3 sm:px-3">
        <p className="text-sm text-zinc-600">전 연령 오픈 수업 기준입니다. 출석 처리는 위의 실제 수업 명단에서 진행합니다.</p>

        <dl className="mt-3 divide-y divide-zinc-100 border-y border-zinc-100 text-sm">
          {(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const).map((day) => (
            <div className="grid min-h-11 grid-cols-[3rem_minmax(0,1fr)] items-center gap-2 px-1 sm:px-3" key={day}>
              <dt className={`font-bold ${day === today ? "text-teal-700" : "text-zinc-700"}`}>
                {dayLabels[day]}
                {day === today ? " · 오늘" : ""}
              </dt>
              <dd className={regularScheduleLabel(day) === "운영 없음" ? "text-zinc-400" : "font-medium text-zinc-800"}>
                {regularScheduleLabel(day)}
              </dd>
            </div>
          ))}
        </dl>

        {todayProgram ? (
          <div className="mt-4" data-testid="final-main-today-training-program">
            <p className="flex items-center gap-2 text-sm font-bold text-zinc-900">
              <Dumbbell className="h-4 w-4 text-teal-700" aria-hidden /> 오늘의 훈련 순서
            </p>
            <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-zinc-700">
              {todayProgram.map((phase, index) => (
                <li className="flex items-center gap-2" key={phase.id}>
                  <span>{phase.label}</span>
                  {index < todayProgram.length - 1 ? <span className="text-zinc-300" aria-hidden>›</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="mt-4 text-sm font-medium text-zinc-500">오늘은 요일별 정규 훈련 프로그램이 없습니다.</p>
        )}

        <p className="mt-4 border-t border-zinc-100 pt-3 text-xs leading-5 text-zinc-500">
          선수부 {athleteSquadSchedule} · 입시 준비 20:00–23:00 협의 · 경찰·군인·소방 및 단 준비는 일정 협의
        </p>
        {hasMiddleSchoolVariation ? (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800" role="note">
            중등 선수부 2부는 학교·대회 일정에 따라 운영 시간이 변경될 수 있습니다.
          </p>
        ) : null}
      </div>
    </details>
  );
}
