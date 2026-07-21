"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Search, Users } from "lucide-react";
import type { ClassRosterCandidate } from "@/lib/api-client";
import { ApiClientError, apiClient } from "@/lib/api-client";

type ClassRosterEditorProps = {
  classId: string;
  capacity: number;
  enrolledMemberIds: string[];
  selectedBranchId: string | null;
  onSave: (memberIds: string[]) => Promise<boolean>;
};

const statusLabels: Record<ClassRosterCandidate["status"], string> = {
  active: "활성",
  trial: "체험",
  paused: "휴회",
  withdrawn: "탈퇴",
};

export function ClassRosterEditor({
  classId,
  capacity,
  enrolledMemberIds,
  selectedBranchId,
  onSave,
}: ClassRosterEditorProps) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<ClassRosterCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState(enrolledMemberIds);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function loadCandidates() {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiClient.getClassRosterCandidates(classId, selectedBranchId);
      setCandidates(payload.candidates);
      setSelectedIds(payload.candidates.filter((candidate) => candidate.enrolled).map((candidate) => candidate.id));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "배정 가능한 회원을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    setFeedback(null);
    if (nextOpen) {
      await loadCandidates();
    }
  }

  async function handleSave() {
    if (selectedIds.length > capacity || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setFeedback(null);
    const saved = await onSave(selectedIds);
    setSaving(false);

    if (saved) {
      setCandidates((current) => current.map((candidate) => ({
        ...candidate,
        enrolled: selectedIds.includes(candidate.id),
      })));
      setFeedback("수업 회원 배정을 저장했습니다.");
    } else {
      setError("회원 배정을 저장하지 못했습니다. 변경 내용을 확인하고 다시 시도해 주세요.");
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase("ko");
  const visibleCandidates = normalizedSearch
    ? candidates.filter((candidate) => `${candidate.name} ${candidate.level}`.toLocaleLowerCase("ko").includes(normalizedSearch))
    : candidates;

  return (
    <div className="border-b border-zinc-100 py-2" data-testid={`class-roster-editor-${classId}`}>
      <button
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
        type="button"
        onClick={() => void toggleOpen()}
      >
        <span className="inline-flex items-center gap-2">
          <Users className="h-4 w-4 text-teal-700" aria-hidden />
          회원 배정 {enrolledMemberIds.length}/{capacity}명
        </span>
        {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
      </button>

      {open ? (
        <div className="px-2 pb-2 pt-1">
          {loading ? (
            <p className="py-4 text-sm text-zinc-500" role="status">회원 명단을 불러오는 중입니다.</p>
          ) : error && candidates.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-2">
              <p className="text-sm text-red-700" role="alert">{error}</p>
              <button className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-semibold" type="button" onClick={() => void loadCandidates()}>
                다시 불러오기
              </button>
            </div>
          ) : (
            <>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-400" aria-hidden />
                <span className="sr-only">배정할 회원 검색</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-teal-600"
                  placeholder="이름 또는 레벨 검색"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="mt-2 max-h-64 divide-y divide-zinc-100 overflow-y-auto border-y border-zinc-100">
                {visibleCandidates.length > 0 ? visibleCandidates.map((candidate) => {
                  const checked = selectedIds.includes(candidate.id);
                  const removalLocked = candidate.removalLocked && checked;
                  return (
                    <label className="flex min-h-12 items-center gap-3 py-2 text-sm" key={candidate.id}>
                      <input
                        checked={checked}
                        className="h-6 w-6 rounded border-zinc-300 text-teal-700 focus:ring-teal-600"
                        disabled={removalLocked || (!checked && selectedIds.length >= capacity)}
                        type="checkbox"
                        onChange={() => setSelectedIds((current) =>
                          current.includes(candidate.id)
                            ? current.filter((memberId) => memberId !== candidate.id)
                            : [...current, candidate.id],
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate font-semibold text-zinc-900">{candidate.name}</strong>
                        <span className="text-xs text-zinc-500">{candidate.level} · {statusLabels[candidate.status]}{removalLocked ? " · 출석 기록 있음" : ""}</span>
                      </span>
                    </label>
                  );
                }) : (
                  <p className="py-5 text-center text-sm text-zinc-500">검색 결과가 없습니다.</p>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className={`text-sm font-medium ${selectedIds.length > capacity ? "text-red-700" : "text-zinc-600"}`}>
                  선택 {selectedIds.length}/{capacity}명
                </p>
                <button
                  className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={saving || selectedIds.length > capacity}
                  type="button"
                  onClick={() => void handleSave()}
                >
                  {saving ? "저장 중" : "배정 저장"}
                </button>
              </div>
              {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}
              {feedback ? <p className="mt-2 text-sm font-medium text-teal-700" role="status">{feedback}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
