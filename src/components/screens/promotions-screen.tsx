"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { Award, CalendarCheck, CheckCircle2, CircleSlash, Clock3, FileBadge, Plus, XCircle } from "lucide-react";
import type { BeltPromotion, BeltPromotionResult } from "@/lib/domain";
import { beltPromotionResultLabels, getNextBelt, judoBelts } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { getPromotionEligibility } from "@/lib/promotions";
import { useApiContext } from "@/hooks/use-api-context";
import { useAppStore } from "@/store/app-store";
import { EmptyState } from "@/components/ui/state-blocks";
import { Button, SectionHeader } from "@/components/ui/primitives";

const beltBadgeStyles: Record<string, string> = {
  흰띠: "bg-zinc-100 text-zinc-700 border-zinc-300",
  노란띠: "bg-yellow-50 text-yellow-800 border-yellow-300",
  주황띠: "bg-orange-50 text-orange-800 border-orange-300",
  초록띠: "bg-green-50 text-green-800 border-green-300",
  파란띠: "bg-blue-50 text-blue-800 border-blue-300",
  밤띠: "bg-amber-100 text-amber-900 border-amber-400",
  빨간띠: "bg-red-50 text-red-800 border-red-300",
};

function beltBadgeClass(belt: string) {
  return beltBadgeStyles[belt] ?? "bg-zinc-900 text-white border-zinc-900";
}

function resultBadge(result: BeltPromotionResult) {
  switch (result) {
    case "passed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {beltPromotionResultLabels.passed}
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
          <XCircle className="h-3.5 w-3.5" aria-hidden /> {beltPromotionResultLabels.failed}
        </span>
      );
    case "cancelled":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">
          <CircleSlash className="h-3.5 w-3.5" aria-hidden /> {beltPromotionResultLabels.cancelled}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
          <Clock3 className="h-3.5 w-3.5" aria-hidden /> {beltPromotionResultLabels.scheduled}
        </span>
      );
  }
}

export function PromotionsScreen() {
  const context = useApiContext();
  const { createPromotion, updatePromotion } = useAppStore();
  const { db, user } = context;
  const canManage = user.role === "coach" || user.role === "owner" || user.role === "admin";

  const [composerOpen, setComposerOpen] = useState(false);
  const [resultFilter, setResultFilter] = useState<BeltPromotionResult | "all">("all");
  const [memberId, setMemberId] = useState("");
  const [toBelt, setToBelt] = useState("");
  const [examDate, setExamDate] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gradingId, setGradingId] = useState<string | null>(null);

  const membersById = useMemo(() => new Map(db.members.map((member) => [member.id, member])), [db.members]);
  const usersById = useMemo(() => new Map(db.users.map((candidate) => [candidate.id, candidate])), [db.users]);
  const promotions = useMemo(
    () =>
      [...(db.promotions ?? [])].sort((a, b) => {
        if (a.result === "scheduled" && b.result !== "scheduled") return -1;
        if (a.result !== "scheduled" && b.result === "scheduled") return 1;
        return b.examDate.localeCompare(a.examDate);
      }),
    [db.promotions],
  );
  const scheduledCount = promotions.filter((promotion) => promotion.result === "scheduled").length;
  const passedCount = promotions.filter((promotion) => promotion.result === "passed").length;
  const filteredPromotions =
    resultFilter === "all" ? promotions : promotions.filter((promotion) => promotion.result === resultFilter);
  const resultFilterOptions = [
    { label: "전체", value: "all" as const, count: promotions.length },
    ...(["scheduled", "passed", "failed", "cancelled"] as const).map((result) => ({
      label: beltPromotionResultLabels[result],
      value: result,
      count: promotions.filter((promotion) => promotion.result === result).length,
    })),
  ].filter((option) => option.value === "all" || option.count > 0);

  const selectableMembers = useMemo(
    () => db.members.filter((member) => member.status === "active" || member.status === "trial"),
    [db.members],
  );
  const selectedMember = memberId ? membersById.get(memberId) : undefined;
  const suggestedBelt = selectedMember ? getNextBelt(selectedMember.belt) : null;
  const eligibilityByMemberId = useMemo(
    () => new Map(selectableMembers.map((member) => [member.id, getPromotionEligibility(member, db)])),
    [selectableMembers, db],
  );
  const selectedEligibility = selectedMember ? eligibilityByMemberId.get(selectedMember.id) : undefined;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!memberId || !toBelt || !examDate) {
      setError("회원, 목표 띠, 심사일을 모두 선택해 주세요.");
      return;
    }

    setPending(true);
    const ok = await createPromotion({ memberId, toBelt, examDate, note: note.trim() || undefined });
    setPending(false);

    if (ok) {
      setComposerOpen(false);
      setMemberId("");
      setToBelt("");
      setExamDate("");
      setNote("");
    }
  }

  async function handleDecide(promotion: BeltPromotion, result: "passed" | "failed" | "cancelled") {
    setGradingId(promotion.id);
    await updatePromotion(promotion.id, { result });
    setGradingId(null);
  }

  return (
    <div className="grid gap-5">
      <SectionHeader
        title="승급 심사"
        action={
          canManage ? (
            <Button size="sm" variant="primary" onClick={() => setComposerOpen((open) => !open)}>
              <Plus className="h-4 w-4" aria-hidden />
              심사 등록
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-center">
          <p className="text-xs font-medium text-sky-700">심사 예정</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-sky-900">{scheduledCount}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-center">
          <p className="text-xs font-medium text-emerald-700">누적 승급</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{passedCount}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 text-center">
          <p className="text-xs font-medium text-zinc-600">전체 기록</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900">{promotions.length}</p>
        </div>
      </div>

      {canManage && composerOpen ? (
        <form className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" onSubmit={(event) => void handleCreate(event)}>
          <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <CalendarCheck className="h-4 w-4 text-teal-600" aria-hidden />새 승급 심사 등록
          </p>

          <label>
            <span className="text-sm font-semibold text-zinc-700">회원</span>
            <select
              className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-teal-500"
              value={memberId}
              onChange={(event) => {
                setMemberId(event.target.value);
                const nextMember = membersById.get(event.target.value);
                const nextBelt = nextMember ? getNextBelt(nextMember.belt) : null;
                if (nextBelt) {
                  setToBelt(nextBelt);
                }
              }}
              required
            >
              <option value="">회원 선택</option>
              {selectableMembers.map((member) => {
                const eligibility = eligibilityByMemberId.get(member.id);

                return (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.belt}
                    {eligibility ? ` · 출석 ${eligibility.attendanceCount}회${eligibility.eligible ? " (자격 충족)" : ""}` : ""}
                  </option>
                );
              })}
            </select>
          </label>

          {selectedEligibility ? (
            <p
              className={`rounded-md border px-3 py-2 text-xs font-medium ${
                selectedEligibility.eligible
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {selectedEligibility.lastPassedAt ? "최근 승급 이후 " : ""}출석 {selectedEligibility.attendanceCount}회 / 기준{" "}
              {selectedEligibility.requiredCount}회 —{" "}
              {selectedEligibility.eligible ? "승급 심사 자격을 충족했습니다." : "기준 미달이지만 필요 시 등록할 수 있습니다."}
            </p>
          ) : null}

          <label>
            <span className="text-sm font-semibold text-zinc-700">목표 띠{suggestedBelt ? ` (추천: ${suggestedBelt})` : ""}</span>
            <select
              className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-teal-500"
              value={toBelt}
              onChange={(event) => setToBelt(event.target.value)}
              required
            >
              <option value="">띠 선택</option>
              {judoBelts.map((belt) => (
                <option key={belt} value={belt}>
                  {belt}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-sm font-semibold text-zinc-700">심사일</span>
            <input
              className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-teal-500"
              type="date"
              value={examDate}
              onChange={(event) => setExamDate(event.target.value)}
              required
            />
          </label>

          <label>
            <span className="text-sm font-semibold text-zinc-700">메모 (선택)</span>
            <input
              className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-teal-500"
              placeholder="심사 항목, 준비 사항 등"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button className="flex-1" disabled={pending} type="submit" variant="primary">
              {pending ? "등록 중..." : "심사 등록"}
            </Button>
            <Button variant="secondary" onClick={() => setComposerOpen(false)}>
              닫기
            </Button>
          </div>
        </form>
      ) : null}

      {promotions.length > 0 ? (
        <div aria-label="승급 결과 필터" className="mb-3 flex flex-wrap gap-1.5" role="group">
          {resultFilterOptions.map((option) => {
            const selected = resultFilter === option.value;
            return (
              <button
                aria-pressed={selected}
                className={`inline-flex min-h-9 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition ${
                  selected
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                }`}
                data-testid={`promotion-result-filter-${option.value}`}
                key={option.value}
                type="button"
                onClick={() => setResultFilter(option.value)}
              >
                {option.label}
                <span className={`tabular-nums ${selected ? "text-teal-100" : "text-zinc-400"}`}>{option.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {promotions.length === 0 ? (
        <EmptyState
          title="승급 심사 기록이 없습니다"
          description={canManage ? "심사 등록 버튼으로 첫 승급 심사를 만들어 보세요." : "승급 심사가 등록되면 여기에 표시됩니다."}
        />
      ) : filteredPromotions.length === 0 ? (
        <EmptyState
          title={`${beltPromotionResultLabels[resultFilter as BeltPromotionResult]} 상태 심사가 없습니다`}
          description="결과 필터를 전체로 바꾸면 모든 심사가 표시됩니다."
        />
      ) : (
        <ul className="grid gap-3">
          {filteredPromotions.map((promotion) => {
            const member = membersById.get(promotion.memberId);
            const evaluator = usersById.get(promotion.evaluatorUserId);

            return (
              <li key={promotion.id} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                      <Award className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />
                      {member?.name ?? "알 수 없는 회원"}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${beltBadgeClass(promotion.fromBelt)}`}>
                        {promotion.fromBelt}
                      </span>
                      <span aria-hidden>→</span>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${beltBadgeClass(promotion.toBelt)}`}>
                        {promotion.toBelt}
                      </span>
                    </p>
                    <p className="mt-1.5 text-xs text-zinc-500">
                      심사일 {formatDate(promotion.examDate)}
                      {evaluator ? ` · 심사자 ${evaluator.name}` : ""}
                      {promotion.note ? ` · ${promotion.note}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0">{resultBadge(promotion.result)}</div>
                </div>

                {promotion.result === "passed" ? (
                  <div className="mt-3 border-t border-zinc-100 pt-3">
                    <Link
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-700 transition hover:bg-teal-100"
                      href={`/app/promotions/${encodeURIComponent(promotion.id)}/certificate`}
                    >
                      <FileBadge className="h-4 w-4" aria-hidden />
                      승급 증서 보기
                    </Link>
                  </div>
                ) : null}

                {canManage && promotion.result === "scheduled" ? (
                  <div className="mt-3 flex gap-2 border-t border-zinc-100 pt-3">
                    <Button
                      className="flex-1"
                      disabled={gradingId === promotion.id}
                      size="sm"
                      variant="primary"
                      onClick={() => void handleDecide(promotion, "passed")}
                    >
                      승급 확정
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={gradingId === promotion.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleDecide(promotion, "failed")}
                    >
                      보류
                    </Button>
                    <Button
                      disabled={gradingId === promotion.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleDecide(promotion, "cancelled")}
                    >
                      취소
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
