"use client";

import { CalendarCheck, RefreshCw } from "lucide-react";
import type { ClassRegistrationOption } from "@/lib/api-client";
import { formatCompactTimeRange, formatDate } from "@/lib/format";

type ClassRegistrationPanelProps = {
  memberName: string;
  selectedDateKey: string;
  options: ClassRegistrationOption[];
  loading: boolean;
  error: string | null;
  pendingClassId: string | null;
  feedback: string | null;
  onRegister: (classId: string) => void;
  onCancel: (classId: string) => void;
  onRetry: () => void;
};

const ageGroupLabels: Record<ClassRegistrationOption["ageGroup"], string> = {
  all: "연령 무관",
  kids: "유소년",
  teen: "청소년",
  adult: "성인",
};

export function ClassRegistrationPanel({
  memberName,
  selectedDateKey,
  options,
  loading,
  error,
  pendingClassId,
  feedback,
  onRegister,
  onCancel,
  onRetry,
}: ClassRegistrationPanelProps) {
  const selectedDateLabel = formatDate(options[0]?.startsAt ?? `${selectedDateKey}T12:00:00+09:00`);

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-zinc-200 bg-white" data-testid="class-registration-panel">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-teal-700" aria-hidden />
            <h2 className="text-base font-semibold text-zinc-950">{selectedDateLabel} 수업 신청</h2>
          </div>
          <p className="mt-1 text-sm text-zinc-600">{memberName} 회원이 참여할 시간대를 선택하세요.</p>
        </div>
      </div>

      {feedback ? (
        <p className="border-b border-zinc-100 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-800" role="status">
          {feedback}
        </p>
      ) : null}

      {loading ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500" role="status">신청 가능한 수업을 불러오는 중입니다.</p>
      ) : error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5">
          <p className="text-sm text-red-700" role="alert">{error}</p>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800"
            type="button"
            onClick={onRetry}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            다시 불러오기
          </button>
        </div>
      ) : options.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">선택한 날짜에 신청 가능한 수업이 없습니다.</p>
      ) : (
        <div className="divide-y divide-zinc-100 px-4">
          {options.map((option) => {
            const pending = pendingClassId === option.id;
            const full = option.enrolledCount >= option.capacity;

            return (
              <div className="grid min-h-[76px] gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={option.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="text-sm text-zinc-950">{formatCompactTimeRange(option.startsAt, option.endsAt)} · {option.name}</strong>
                    {option.isEnrolled ? (
                      <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">신청 완료</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">
                    {option.coachName} · {option.room} · {option.level} · {ageGroupLabels[option.ageGroup]} · {option.enrolledCount}/{option.capacity}명
                  </p>
                  {!option.isEnrolled && option.unavailableReason ? (
                    <p className="mt-1 text-xs font-medium text-zinc-500">{option.unavailableReason}</p>
                  ) : full && !option.isEnrolled ? (
                    <p className="mt-1 text-xs font-medium text-zinc-500">정원이 마감되었습니다.</p>
                  ) : null}
                </div>
                {option.canCancel ? (
                  <button
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    data-testid={`class-registration-cancel-${option.id}`}
                    disabled={pending}
                    type="button"
                    onClick={() => onCancel(option.id)}
                  >
                    {pending ? "처리 중" : "신청 취소"}
                  </button>
                ) : (
                  <button
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 sm:w-auto"
                    data-testid={`class-registration-submit-${option.id}`}
                    disabled={pending || !option.canRegister}
                    type="button"
                    onClick={() => onRegister(option.id)}
                  >
                    {pending ? "처리 중" : "신청"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
