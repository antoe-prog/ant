"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useApiContext } from "@/hooks/use-api-context";
import { EmptyState } from "@/components/ui/state-blocks";
import { Button } from "@/components/ui/primitives";
import { FinalWordmark } from "@/components/brand/final-wordmark";

export function PromotionCertificateScreen({ promotionId }: { promotionId: string }) {
  const { db } = useApiContext();
  const promotion = (db.promotions ?? []).find((candidate) => candidate.id === promotionId);
  const member = promotion ? db.members.find((candidate) => candidate.id === promotion.memberId) : undefined;
  const branch = promotion ? db.branches.find((candidate) => candidate.id === promotion.branchId) : undefined;
  const evaluator = promotion ? db.users.find((candidate) => candidate.id === promotion.evaluatorUserId) : undefined;

  if (!promotion || promotion.result !== "passed" || !member) {
    return (
      <div className="grid gap-4">
        <EmptyState
          title="증서를 발급할 수 없습니다"
          description="승급이 확정된 심사만 증서를 발급할 수 있습니다."
          action={
            <Link className="text-sm font-semibold text-teal-700 hover:text-teal-800" href="/app/promotions">
              승급 심사로 돌아가기
            </Link>
          }
        />
      </div>
    );
  }

  const issuedDate = promotion.decidedAt ?? promotion.examDate;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between print:hidden">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700 hover:text-teal-800" href="/app/promotions">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          승급 심사로 돌아가기
        </Link>
        <Button size="sm" variant="primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden />
          인쇄 / PDF 저장
        </Button>
      </div>

      <section
        className="mx-auto w-full max-w-2xl rounded-lg border-4 border-double border-zinc-800 bg-white px-8 py-12 text-center shadow-sm print:max-w-none print:border-8 print:shadow-none"
        aria-label="승급 증서"
      >
        <div className="flex justify-center">
          <FinalWordmark />
        </div>

        <h1 className="mt-8 text-3xl font-bold tracking-[0.3em] text-zinc-950">승 급 증</h1>
        <p className="mt-2 text-xs tracking-widest text-zinc-500">CERTIFICATE OF PROMOTION</p>

        <div className="mx-auto mt-10 grid max-w-md gap-2 text-left text-sm text-zinc-700">
          <p>
            <span className="inline-block w-16 font-semibold text-zinc-500">성명</span>
            <span className="text-lg font-bold text-zinc-950">{member.name}</span>
          </p>
          <p>
            <span className="inline-block w-16 font-semibold text-zinc-500">소속</span>
            {branch?.name ?? "파이널 유도 멀티짐"}
          </p>
          <p>
            <span className="inline-block w-16 font-semibold text-zinc-500">심사일</span>
            {formatDate(promotion.examDate)}
          </p>
        </div>

        <p className="mt-10 text-base leading-8 text-zinc-800">
          위 사람은 본 도장의 승급 심사에서
          <br />
          <span className="text-xl font-bold text-zinc-950">
            {promotion.fromBelt} → {promotion.toBelt}
          </span>
          <br />
          승급 기준을 통과하였기에 이 증서를 수여합니다.
        </p>

        {promotion.score !== undefined ? (
          <p className="mt-4 text-sm text-zinc-600">심사 점수 {promotion.score}점</p>
        ) : null}

        <div className="mt-12 grid gap-1 text-sm text-zinc-700">
          <p className="font-semibold">{formatDate(issuedDate)}</p>
          <p className="mt-4 text-base font-bold text-zinc-950">파이널 유도 멀티짐 {branch?.name ?? ""}</p>
          <p className="text-sm text-zinc-600">심사위원 {evaluator?.name ?? "삭제된 사용자"}</p>
        </div>
      </section>
    </div>
  );
}
