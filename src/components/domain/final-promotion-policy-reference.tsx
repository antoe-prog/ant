"use client";

import Image from "next/image";
import { Award, ChevronDown, Clock3, ExternalLink } from "lucide-react";
import { useState } from "react";
import { finalCommonPromotionPolicy } from "@/lib/final-common-promotion-policy";

type ReferenceTab = "skills" | "periods";

const referenceTabs = [
  {
    alt: "FINAL 승급심사 기술표 원본",
    height: 529,
    href: "/reference/final-judo-promotion-skills-2026-03.png",
    label: "심사 기술표",
    value: "skills" as const,
    width: 708,
  },
  {
    alt: "FINAL 연령별 승급 수련기간 규정 원본",
    height: 539,
    href: "/reference/final-judo-promotion-periods-2026-03.png",
    label: "수련기간표",
    value: "periods" as const,
    width: 711,
  },
];

export function FinalPromotionPolicyReference() {
  const [activeTab, setActiveTab] = useState<ReferenceTab>("skills");
  const activeReference = referenceTabs.find((tab) => tab.value === activeTab) ?? referenceTabs[0];

  return (
    <section
      aria-labelledby="final-promotion-policy-title"
      className="mb-4 border-y border-zinc-200 bg-white py-4"
      data-testid="final-common-promotion-policy"
    >
      <div className="flex items-start gap-3 px-1">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-teal-50 text-teal-700">
          <Award className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-zinc-950" id="final-promotion-policy-title">
            전 지점 공통 승급 기준
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            13세 이하는 유소년급, 14세 이상은 전환심사 후 일반급을 적용합니다.
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 border-y border-zinc-100 text-sm sm:grid-cols-3">
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

      <details className="group mt-3 border-t border-zinc-100 pt-1" data-testid="final-promotion-reference-details">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-1 text-sm font-semibold text-zinc-700 marker:hidden">
          기술표·수련기간표 보기
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-zinc-100 p-1" role="tablist" aria-label="승급 기준표">
          {referenceTabs.map((tab) => (
            <button
              aria-controls="final-promotion-reference-panel"
              aria-selected={activeTab === tab.value}
              className={`min-h-11 rounded-[4px] px-3 text-sm font-semibold transition ${
                activeTab === tab.value ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:bg-white/60"
              }`}
              data-testid={`final-promotion-reference-tab-${tab.value}`}
              key={tab.value}
              role="tab"
              type="button"
              onClick={() => setActiveTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-3" id="final-promotion-reference-panel" role="tabpanel">
          <a
            aria-label={`${activeReference.label} 원본 크게 보기`}
            className="group block overflow-hidden rounded-md border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            href={activeReference.href}
            rel="noreferrer"
            target="_blank"
          >
            <Image
              alt={activeReference.alt}
              className="h-auto w-full"
              height={activeReference.height}
              sizes="(max-width: 768px) 100vw, 900px"
              src={activeReference.href}
              width={activeReference.width}
            />
            <span className="flex min-h-11 items-center justify-center gap-1.5 border-t border-zinc-100 text-xs font-semibold text-zinc-600 group-hover:text-teal-700">
              원본 크게 보기 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </span>
          </a>
        </div>
      </details>
    </section>
  );
}
