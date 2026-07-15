import { ChevronDown, ReceiptText } from "lucide-react";
import {
  finalCommonDayPassFees,
  finalCommonLifetimeMembership,
  finalCommonMonthlyProgramFees,
  finalCommonRegularMembershipPlans,
  finalCommonUniformFees,
} from "@/lib/final-common-fee-policy";
import { formatCurrency } from "@/lib/format";

const programLabels: Record<string, string> = {
  "entrance-exam": "입시반",
  "athlete-middle-school": "선수부 중등",
  "athlete-high-school": "선수부 고등",
  "dan-preparation": "단 준비",
};

const dayPassLabels: Record<string, string> = {
  "day-pass-weekday": "평일 일일권",
  "day-pass-weekend": "주말 일일권",
};

const uniformLabels: Record<string, string> = {
  "athlete-blue": "선수용 청",
  "athlete-white": "선수용 백",
  "training-blue": "수련용 청",
  "training-black": "수련용 흑",
  "training-red": "수련용 적",
  "training-white": "수련용 백",
};

export function FinalCommonFeeReference() {
  const durations = [1, 3, 6, 12] as const;
  const trainingDays = [5, 3, 2] as const;

  return (
    <details className="group mb-3 border-y border-zinc-200 bg-white" data-testid="final-common-fee-policy">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-1 py-2 marker:hidden sm:px-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-zinc-950">
          <ReceiptText className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
          전 지점 공통 회비 기준
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-zinc-500">
          기준표 보기 <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
        </span>
      </summary>

      <div className="border-t border-zinc-100 pb-4 pt-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">주간 횟수와 등록 개월별 공통 회비</caption>
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-3 py-2 font-semibold">수련</th>
                {durations.map((duration) => (
                  <th className="px-3 py-2 text-right font-semibold" key={duration}>{duration}개월</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trainingDays.map((days) => (
                <tr className="border-b border-zinc-100 last:border-0" key={days}>
                  <th className="px-3 py-2 text-left font-semibold text-zinc-700">주 {days}일</th>
                  {durations.map((duration) => {
                    const plan = finalCommonRegularMembershipPlans.find(
                      (candidate) => candidate.trainingDaysPerWeek === days && candidate.durationMonths === duration,
                    );
                    return <td className="px-3 py-2 text-right font-semibold tabular-nums text-zinc-950" key={duration}>{formatCurrency(plan?.priceKrw ?? 0)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 border-t border-zinc-100 px-1 pt-3 text-sm sm:grid-cols-3 sm:px-3">
          <div>
            <p className="font-bold text-zinc-900">전문 프로그램 · 1개월</p>
            <ul className="mt-1 space-y-1 text-zinc-600">
              {finalCommonMonthlyProgramFees.map((fee) => (
                <li className="flex justify-between gap-3" key={fee.id}><span>{programLabels[fee.id]}</span><strong className="tabular-nums text-zinc-900">{formatCurrency(fee.priceKrw)}</strong></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-bold text-zinc-900">일일권 · 도복</p>
            <ul className="mt-1 space-y-1 text-zinc-600">
              {finalCommonDayPassFees.map((fee) => (
                <li className="flex justify-between gap-3" key={fee.id}><span>{dayPassLabels[fee.id]}</span><strong className="tabular-nums text-zinc-900">{formatCurrency(fee.priceKrw)}</strong></li>
              ))}
              {finalCommonUniformFees.map((fee) => (
                <li className="flex justify-between gap-3" key={fee.id}><span>{uniformLabels[fee.id]}</span><strong className="tabular-nums text-zinc-900">{formatCurrency(fee.priceKrw)}</strong></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-bold text-zinc-900">운영 기준</p>
            <ul className="mt-1 space-y-1 leading-5 text-zinc-600">
              <li>3/6/12개월 휴회 1/2/3회, 회당 최대 30일</li>
              <li>경찰·군인·소방 등록 개월만큼 기간 추가</li>
              <li>신규 3개월 등록 수련용 도복 1벌</li>
              <li>2년 이상 월 1만원 · 동반 첫 달 10% · 가족 매월 10%</li>
              <li>3단 이상 월 13만원 · FINAL 출신 3단 이상 월 10만원</li>
              <li>평생 회원권 {formatCurrency(finalCommonLifetimeMembership.priceKrw)} · 별도 확인</li>
            </ul>
          </div>
        </div>
      </div>
    </details>
  );
}
