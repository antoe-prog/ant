"use client";

import Image from "next/image";
import { Award, ChevronDown, Clock3, ExternalLink } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { finalCommonPromotionPolicy } from "@/lib/final-common-promotion-policy";

type ReferenceTab = "skills" | "periods";

const referenceTabs = [
  {
    height: 529,
    href: "/reference/final-judo-promotion-skills-2026-03.png",
    label: "심사 기술표",
    value: "skills" as const,
    width: 708,
  },
  {
    height: 539,
    href: "/reference/final-judo-promotion-periods-2026-03.png",
    label: "수련기간표",
    value: "periods" as const,
    width: 711,
  },
];

const ageBandLabels = {
  age_8_and_under: "8세 이하",
  age_9_to_13: "9–13세",
  age_14_to_16: "14–16세",
  age_17_to_19: "17–19세",
  age_20_and_over: "20세 이상",
} as const;

export function FinalPromotionPolicyReference() {
  const [activeTab, setActiveTab] = useState<ReferenceTab>("skills");
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeReference = referenceTabs.find((tab) => tab.value === activeTab) ?? referenceTabs[0];
  const descriptionId = `final-promotion-reference-description-${activeTab}`;

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % referenceTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + referenceTabs.length) % referenceTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = referenceTabs.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    setActiveTab(referenceTabs[nextIndex].value);
    tabButtonRefs.current[nextIndex]?.focus();
  }

  return (
    <section
      aria-labelledby="final-promotion-policy-title"
      className="mb-4 min-w-0 max-w-full border-y border-zinc-200 bg-white"
      data-testid="final-common-promotion-policy"
    >
      <details className="group/policy" data-testid="final-promotion-policy-details">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-1 py-2 marker:hidden">
          <span className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-teal-50 text-teal-700">
              <Award className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-bold text-zinc-950" id="final-promotion-policy-title">
                전 지점 공통 승급 기준
              </span>
              <span className="mt-1 block text-sm leading-5 text-zinc-600">
                13세 이하는 유소년급, 14세 이상은 전환심사 후 일반급을 적용합니다.
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-zinc-500">
            <span className="group-open/policy:hidden">열기</span>
            <span className="hidden group-open/policy:inline">닫기</span>
            <ChevronDown className="h-4 w-4 transition group-open/policy:rotate-180" aria-hidden />
          </span>
        </summary>

        <div className="border-t border-zinc-100 pb-4 pt-1">
      <dl className="grid grid-cols-1 border-b border-zinc-100 text-sm sm:grid-cols-3">
        <div className="px-1 py-3 sm:border-r sm:border-zinc-100 sm:px-3">
          <dt className="flex items-center gap-1.5 font-semibold text-zinc-500">
            <Clock3 className="h-4 w-4" aria-hidden /> 수련시간 인정
          </dt>
          <dd className="mt-1 font-bold text-zinc-950">
            월 {finalCommonPromotionPolicy.normalMonthlyHours}시간 · 1일 최대 {finalCommonPromotionPolicy.maximumRecognizedHoursPerDay}시간
          </dd>
        </div>
        <div className="border-t border-zinc-100 px-1 py-3 sm:border-r sm:border-t-0 sm:px-3">
          <dt className="font-semibold text-zinc-500">단축 월 인정시간</dt>
          <dd className="mt-1 font-bold text-zinc-950">
            {finalCommonPromotionPolicy.ageBands.map((band) => band.acceleratedMonthlyHours).join(" · ")}시간
          </dd>
          <dd className="mt-1 text-xs text-zinc-500">8세 이하부터 20세 이상 순</dd>
        </div>
        <div className="border-t border-zinc-100 px-1 py-3 sm:border-t-0 sm:px-3">
          <dt className="font-semibold text-zinc-500">심사 운영</dt>
          <dd className="mt-1 font-bold text-zinc-950">둘째 금 특별 · 넷째 금 정기</dd>
        </div>
      </dl>

      <details className="group mt-3 min-w-0 max-w-full border-t border-zinc-100 pt-1" data-testid="final-promotion-reference-details">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-1 text-sm font-semibold text-zinc-700 marker:hidden">
          기술표·수련기간표 보기
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-zinc-100 p-1" role="tablist" aria-label="승급 기준표">
          {referenceTabs.map((tab, index) => (
            <button
              aria-controls="final-promotion-reference-panel"
              aria-selected={activeTab === tab.value}
              className={`min-h-11 rounded-[4px] px-3 text-sm font-semibold transition ${
                activeTab === tab.value ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:bg-white/60"
              }`}
              data-testid={`final-promotion-reference-tab-${tab.value}`}
              id={`final-promotion-reference-tab-${tab.value}`}
              key={tab.value}
              ref={(node) => {
                tabButtonRefs.current[index] = node;
              }}
              role="tab"
              tabIndex={activeTab === tab.value ? 0 : -1}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          aria-labelledby={`final-promotion-reference-tab-${activeTab}`}
          className="mt-3 min-w-0 max-w-full"
          id="final-promotion-reference-panel"
          role="tabpanel"
        >
          <div
            aria-describedby={descriptionId}
            aria-label={`${activeReference.label} 원본 표`}
            className="w-full min-w-0 max-w-full overflow-x-auto rounded-md border border-zinc-200 bg-white pb-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
            data-testid="final-promotion-reference-scroll-region"
            role="region"
            tabIndex={0}
          >
            <div className="w-max min-w-full">
              <Image
                alt=""
                className="h-auto max-w-none"
                height={activeReference.height}
                sizes={`${activeReference.width}px`}
                src={activeReference.href}
                style={{ width: activeReference.width }}
                width={activeReference.width}
              />
            </div>
          </div>

          {activeTab === "skills" ? (
            <p className="mt-2 text-xs leading-5 text-zinc-600" id={descriptionId}>
              심사 범주: {finalCommonPromotionPolicy.skillCategories.map((category) => category.label).join(" · ")}
            </p>
          ) : (
            <>
              <p className="mt-2 text-xs leading-5 text-zinc-600" id={descriptionId}>
                연령별 단축 월 인정시간: {finalCommonPromotionPolicy.ageBands
                  .map((band) => `${ageBandLabels[band.id]} ${band.acceleratedMonthlyHours}시간`)
                  .join(" · ")}
              </p>
              <table className="sr-only">
                <caption>연령별 승급 최소 수련기간</caption>
                <thead>
                  <tr>
                    <th scope="col">연령</th>
                    <th scope="col">급</th>
                    <th scope="col">누적 개월</th>
                    <th scope="col">해당 급 수련 개월</th>
                    <th scope="col">단축 누적 개월</th>
                  </tr>
                </thead>
                <tbody>
                  {finalCommonPromotionPolicy.ageBands.flatMap((band) =>
                    finalCommonPromotionPolicy.periodRules[band.id].map((rule) => (
                      <tr key={`${band.id}-${rule.grade}`}>
                        <th scope="row">{ageBandLabels[band.id]}</th>
                        <td>{rule.grade}급</td>
                        <td>{rule.cumulativeMonths}개월</td>
                        <td>{rule.monthsAtGrade}개월</td>
                        <td>{rule.acceleratedCumulativeMonths ? `${rule.acceleratedCumulativeMonths}개월` : "해당 없음"}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </>
          )}

          <a
            aria-label={`${activeReference.label} 원본 새 창에서 보기`}
            className="mt-2 flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600 transition hover:border-teal-200 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            href={activeReference.href}
            rel="noreferrer"
            target="_blank"
          >
            원본 크게 보기 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </details>
        </div>
      </details>
    </section>
  );
}
