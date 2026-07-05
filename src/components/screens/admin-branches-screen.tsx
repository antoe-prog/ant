"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Building2, Save, Settings2, PlusCircle, ShieldCheck } from "lucide-react";
import { useApiContext } from "@/hooks/use-api-context";
import type { Branch, BranchSettings, BranchStatus } from "@/lib/domain";
import { formatBranchTimezone, normalizeBranchSettings, supportedBranchTimezones } from "@/lib/domain";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/primitives";

type BranchEditDraft = {
  attendanceEditRequiresReason: boolean;
  district: string;
  name: string;
  reason: string;
  status: BranchStatus;
  timezone: string;
};

function getBranchStatus(branch: Branch): BranchStatus {
  return branch.status ?? "active";
}

function createBranchEditDraft(branch: Branch): BranchEditDraft {
  const settings = normalizeBranchSettings(branch.settings);

  return {
    attendanceEditRequiresReason: settings.attendanceEditRequiresReason,
    district: branch.district,
    name: branch.name,
    reason: "",
    status: getBranchStatus(branch),
    timezone: branch.timezone ?? "Asia/Seoul",
  };
}

function toBranchSettings(draft: BranchEditDraft): BranchSettings {
  return {
    attendanceEditRequiresReason: draft.attendanceEditRequiresReason,
  };
}

function scrollBranchPanelIntoView(panelId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.getElementById(panelId)?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  });
}

export function AdminBranchesScreen() {
  const context = useApiContext();
  const { assignBranchOwner, createBranch, updateBranch } = useAppStore();
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchDistrict, setNewBranchDistrict] = useState("");
  const [newBranchOwnerId, setNewBranchOwnerId] = useState("");
  const [branchEdits, setBranchEdits] = useState<Record<string, BranchEditDraft>>({});
  const [ownerDrafts, setOwnerDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [branchCreateOpen, setBranchCreateOpen] = useState(false);
  const [ownerEditorBranchId, setOwnerEditorBranchId] = useState<string | null>(null);
  const [settingsEditorBranchId, setSettingsEditorBranchId] = useState<string | null>(null);
  const ownerUsers = useMemo(
    () => context.db.users.filter((user) => user.role === "owner"),
    [context.db.users],
  );
  const ownerByBranch = useMemo(() => {
    const map = new Map<string, typeof ownerUsers>();

    context.db.branches.forEach((branch) => {
      map.set(
        branch.id,
        ownerUsers.filter((user) => user.branchIds.includes(branch.id)),
      );
    });

    return map;
  }, [context.db.branches, ownerUsers]);
  const visibleBranches = context.selectedBranchId
    ? context.db.branches.filter((branch) => branch.id === context.selectedBranchId)
    : context.db.branches;
  const activeBranches = visibleBranches.filter((branch) => getBranchStatus(branch) === "active");
  const inactiveBranches = visibleBranches.filter((branch) => getBranchStatus(branch) === "inactive");
  const branchesWithoutOwner = visibleBranches.filter((branch) => (ownerByBranch.get(branch.id)?.length ?? 0) === 0);
  const branchScopeTitle = context.selectedBranchId ? "선택 지점 관리" : "전체 지점 관리";
  const branchSummaryTotalLabel = context.selectedBranchId ? "선택" : "전체";
  const canCreateBranchInCurrentScope = !context.selectedBranchId;

  function getBranchEdit(branch: Branch) {
    return branchEdits[branch.id] ?? createBranchEditDraft(branch);
  }

  function updateBranchEdit(branchId: string, patch: Partial<BranchEditDraft>) {
    const branch = context.db.branches.find((candidate) => candidate.id === branchId);

    if (!branch) {
      return;
    }

    setBranchEdits((current) => ({
      ...current,
      [branchId]: {
        ...getBranchEdit(branch),
        ...patch,
      },
    }));
  }

  function isKnownBranchTimezone(timezone: string) {
    return supportedBranchTimezones.some((option) => option.value === timezone);
  }

  useEffect(() => {
    function openHashTarget() {
      const hashTarget = window.location.hash.slice(1);
      const panelTarget = new URLSearchParams(window.location.search).get("panel");

      if (hashTarget === "create" || panelTarget === "create") {
        setBranchCreateOpen(true);
        setOwnerEditorBranchId(null);
        setSettingsEditorBranchId(null);
        window.setTimeout(() => scrollBranchPanelIntoView("admin-branch-create-form"), 0);
        return;
      }

      const branchId = hashTarget.match(/^settings-(.+)$/)?.[1];

      if (!branchId) {
        return;
      }

      const targetBranch = context.db.branches.find((branch) => branch.id === branchId);

      if (!targetBranch) {
        return;
      }

      setBranchEdits((current) => ({
        ...current,
        [targetBranch.id]: current[targetBranch.id] ?? createBranchEditDraft(targetBranch),
      }));
      setOwnerEditorBranchId(null);
      setSettingsEditorBranchId(targetBranch.id);
      scrollBranchPanelIntoView(`admin-branch-settings-form-${targetBranch.id}`);
    }

    openHashTarget();
    window.addEventListener("hashchange", openHashTarget);

    return () => {
      window.removeEventListener("hashchange", openHashTarget);
    };
  }, [context.db.branches]);

  async function handleCreateBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newBranchName.trim() || !newBranchDistrict.trim()) {
      return;
    }

    const ok = await createBranch({
      name: newBranchName.trim(),
      district: newBranchDistrict.trim(),
      ownerUserId: newBranchOwnerId || undefined,
    });

    if (!ok) {
      setFeedback("지점을 생성하지 못했습니다. 중복 지점명 또는 대표 배정 조건을 확인해 주세요.");
      return;
    }

    setFeedback("지점을 생성했습니다.");
    setNewBranchName("");
    setNewBranchDistrict("");
    setNewBranchOwnerId("");
    setBranchCreateOpen(false);
  }

  async function handleAssignOwner(event: FormEvent<HTMLFormElement>, branchId: string) {
    event.preventDefault();

    const ownerUserId = ownerDrafts[branchId];

    if (!ownerUserId) {
      return;
    }

    const ok = await assignBranchOwner(branchId, ownerUserId);

    setFeedback(ok ? "지점 대표를 배정했습니다." : "지점 대표 배정에 실패했습니다.");
    if (ok) {
      setOwnerEditorBranchId(null);
    }
  }

  async function handleUpdateBranch(event: FormEvent<HTMLFormElement>, branch: Branch) {
    event.preventDefault();

    const draft = getBranchEdit(branch);
    const settings = toBranchSettings(draft);

    if (
      !draft.name.trim() ||
      !draft.district.trim() ||
      !draft.reason.trim()
    ) {
      setFeedback("지점명, 지역, 변경 사유를 확인해 주세요.");
      return;
    }

    const ok = await updateBranch(branch.id, {
      district: draft.district.trim(),
      name: draft.name.trim(),
      reason: draft.reason.trim(),
      settings,
      status: draft.status,
      timezone: draft.timezone.trim() || "Asia/Seoul",
    });

    if (!ok) {
      setFeedback("지점 정보를 수정하지 못했습니다.");
      return;
    }

    setFeedback(draft.status === "inactive" ? "지점을 비활성화했습니다." : "지점 정보를 수정했습니다.");
    setBranchEdits((current) => {
      const next = { ...current };
      delete next[branch.id];
      return next;
    });
    setSettingsEditorBranchId(null);
  }

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl font-semibold tracking-normal text-zinc-950 sm:text-2xl">{branchScopeTitle}</h1>
      </div>

      <section
        aria-label="지점 관리 요약"
        className="mb-1.5 grid w-2/3 max-w-[17rem] grid-cols-4 overflow-hidden rounded-md border border-zinc-200 bg-white"
        data-testid="admin-branch-summary-grid"
      >
        <div className="flex min-h-11 min-w-0 flex-col items-center justify-center px-1 py-1 text-center" data-testid="admin-branch-summary-total">
          <p className="truncate text-[9px] font-medium leading-3 text-zinc-600 sm:text-[10px]">{branchSummaryTotalLabel}</p>
          <p className="text-base font-semibold leading-5 tabular-nums text-zinc-950">{visibleBranches.length}</p>
        </div>
        <div className="flex min-h-11 min-w-0 flex-col items-center justify-center border-l border-zinc-200 bg-teal-50 px-1 py-1 text-center" data-testid="admin-branch-summary-active">
          <p className="truncate text-[9px] font-medium leading-3 text-teal-700 sm:text-[10px]">운영 중</p>
          <p className="text-base font-semibold leading-5 tabular-nums text-zinc-950">{activeBranches.length}</p>
        </div>
        <div className="flex min-h-11 min-w-0 flex-col items-center justify-center border-l border-zinc-200 bg-amber-50 px-1 py-1 text-center" data-testid="admin-branch-summary-unassigned-owner">
          <p className="truncate text-[9px] font-medium leading-3 text-amber-700 sm:text-[10px]">
            <span className="sm:hidden">미배정</span>
            <span className="hidden sm:inline">대표 미배정</span>
          </p>
          <p className="text-base font-semibold leading-5 tabular-nums text-zinc-950">{branchesWithoutOwner.length}</p>
        </div>
        <div className="flex min-h-11 min-w-0 flex-col items-center justify-center border-l border-zinc-200 px-1 py-1 text-center" data-testid="admin-branch-summary-inactive">
          <p className="truncate text-[9px] font-medium leading-3 text-zinc-600 sm:text-[10px]">
            <span className="sm:hidden">비활성</span>
            <span className="hidden sm:inline">비활성 지점</span>
          </p>
          <p className="text-base font-semibold leading-5 tabular-nums text-zinc-950">{inactiveBranches.length}</p>
        </div>
      </section>

      {feedback ? (
        <p className="mb-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700" data-testid="admin-branch-feedback">
          {feedback}
        </p>
      ) : null}

      {canCreateBranchInCurrentScope ? (
        <section
          className={`mb-2 rounded-md border border-zinc-200 bg-white px-2 py-0 transition-[max-width,width] ${
            branchCreateOpen ? "w-full max-w-none" : "w-2/3 max-w-[17rem]"
          }`}
          data-testid="admin-branch-create-panel"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <PlusCircle className="h-3 w-3 text-teal-700" aria-hidden />
              <h2 className="text-[11px] font-semibold text-zinc-950">지점 생성</h2>
            </div>
            <button
              aria-controls="admin-branch-create-form"
              aria-expanded={branchCreateOpen}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50"
              data-testid="admin-branch-create-toggle"
              type="button"
              onClick={() => setBranchCreateOpen((current) => !current)}
            >
              {branchCreateOpen ? "닫기" : "생성"}
            </button>
          </div>
          {branchCreateOpen ? (
            <form className="mt-1.5 grid gap-1.5 md:grid-cols-[1fr_1fr_1fr_auto]" id="admin-branch-create-form" onSubmit={handleCreateBranch}>
              <div className="grid grid-cols-2 gap-1.5 md:contents">
                <label>
                  <span className="sr-only">지점명</span>
                  <input
                    className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                    placeholder="지점명 입력"
                    value={newBranchName}
                    onChange={(event) => setNewBranchName(event.target.value)}
                  />
                </label>
                <label>
                  <span className="sr-only">지역</span>
                  <input
                    className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                    placeholder="지역 입력"
                    value={newBranchDistrict}
                    onChange={(event) => setNewBranchDistrict(event.target.value)}
                  />
                </label>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-1.5 md:contents">
                <label className="min-w-0">
                  <span className="sr-only">대표 배정</span>
                  <select
                    className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                    value={newBranchOwnerId}
                    onChange={(event) => setNewBranchOwnerId(event.target.value)}
                  >
                    <option value="">나중에 배정</option>
                    {ownerUsers.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button className="self-end" disabled={!newBranchName.trim() || !newBranchDistrict.trim()} size="lg" type="submit" variant="primary">
                  생성
                </Button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        {visibleBranches.map((branch) => {
          const owners = ownerByBranch.get(branch.id) ?? [];
          const draftOwnerId = ownerDrafts[branch.id] ?? owners[0]?.id ?? "";
          const edit = getBranchEdit(branch);
          const status = getBranchStatus(branch);
          const branchTimezoneLabel = formatBranchTimezone(branch.timezone);
          const ownerEditorOpen = ownerEditorBranchId === branch.id;
          const settingsEditorOpen = settingsEditorBranchId === branch.id;

          return (
            <article
              className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white p-3"
              data-testid="admin-branch-card"
              key={branch.id}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-teal-700" aria-hidden />
                    <h2 className="truncate text-base font-semibold text-zinc-950">{branch.name}</h2>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-600">{branch.district}</p>
                </div>
                <div
                  className="grid shrink-0 grid-cols-[auto_auto_auto] items-center gap-1.5"
                  data-testid="admin-branch-action-grid"
                >
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                    status === "active"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-zinc-200 bg-zinc-50 text-zinc-600"
                  }`}>
                    {status === "active" ? "운영 중" : "비활성"}
                  </span>
                  <button
                    aria-controls={`admin-branch-owner-form-${branch.id}`}
                    aria-expanded={ownerEditorOpen}
                    aria-label={`${branch.name} 대표 변경`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 transition hover:bg-zinc-50"
                    data-testid="admin-branch-owner-toggle"
                    type="button"
                    onClick={() => setOwnerEditorBranchId((current) => (current === branch.id ? null : branch.id))}
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    aria-controls={`admin-branch-settings-form-${branch.id}`}
                    aria-expanded={settingsEditorOpen}
                    aria-label={`${branch.name} 운영 설정`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 transition hover:bg-zinc-50"
                    data-testid="admin-branch-settings-toggle"
                    title={`운영 설정 · ${branchTimezoneLabel}`}
                    type="button"
                    onClick={() => setSettingsEditorBranchId((current) => (current === branch.id ? null : branch.id))}
                  >
                    <Settings2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>

              {settingsEditorOpen ? null : (
                <dl
                  className="mt-2 grid grid-cols-3 gap-1 border-t border-zinc-100 pt-2"
                  data-testid="admin-branch-detail-grid"
                >
                  <div className="min-w-0 rounded-md bg-zinc-50 px-1.5 py-1">
                    <dt className="truncate text-[9px] font-semibold leading-3 text-zinc-500">회원</dt>
                    <dd className="truncate text-xs font-semibold leading-4 text-zinc-950">
                      {context.db.members.filter((member) => member.branchId === branch.id).length}명
                    </dd>
                  </div>
                  <div className="min-w-0 rounded-md bg-zinc-50 px-1.5 py-1">
                    <dt className="truncate text-[9px] font-semibold leading-3 text-zinc-500">수업</dt>
                    <dd className="truncate text-xs font-semibold leading-4 text-zinc-950">
                      {context.db.classes.filter((session) => session.branchId === branch.id).length}개
                    </dd>
                  </div>
                  <div className="min-w-0 rounded-md bg-zinc-50 px-1.5 py-1">
                    <dt className="truncate text-[9px] font-semibold leading-3 text-zinc-500">대표</dt>
                    <dd className="truncate text-xs font-semibold leading-4 text-zinc-950">
                      {owners.length > 0 ? owners.map((owner) => owner.name).join(", ") : "미배정"}
                    </dd>
                  </div>
                </dl>
              )}

              {ownerEditorOpen ? (
                <form
                  className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-zinc-100 pt-3"
                  data-testid={`admin-branch-owner-form-${branch.id}`}
                  id={`admin-branch-owner-form-${branch.id}`}
                  onSubmit={(event) => void handleAssignOwner(event, branch.id)}
                >
                  <label>
                    <span className="mb-1 block text-xs font-semibold text-zinc-500">대표 변경</span>
                    <select
                      className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                      value={draftOwnerId}
                      onChange={(event) =>
                        setOwnerDrafts((current) => ({
                          ...current,
                          [branch.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">대표 선택</option>
                      {ownerUsers.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button className="self-end whitespace-nowrap" disabled={!draftOwnerId} size="lg" type="submit">
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    배정
                  </Button>
                </form>
              ) : null}

              {settingsEditorOpen ? (
                <form
                  className="mt-2 grid gap-1.5 border-t border-zinc-100 pt-2"
                  data-testid={`admin-branch-settings-form-${branch.id}`}
                  id={`admin-branch-settings-form-${branch.id}`}
                  onSubmit={(event) => void handleUpdateBranch(event, branch)}
                >
                  <div className="grid grid-cols-3 gap-1">
                    <label className="relative min-w-0">
                      <span className="pointer-events-none absolute left-2 top-1 text-[9px] font-semibold leading-3 text-zinc-500">지점명</span>
                      <input
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-2 pb-1 pt-4 text-xs outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                        value={edit.name}
                        onChange={(event) => updateBranchEdit(branch.id, { name: event.target.value })}
                      />
                    </label>
                    <label className="relative min-w-0">
                      <span className="pointer-events-none absolute left-2 top-1 text-[9px] font-semibold leading-3 text-zinc-500">지역</span>
                      <input
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-2 pb-1 pt-4 text-xs outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                        value={edit.district}
                        onChange={(event) => updateBranchEdit(branch.id, { district: event.target.value })}
                      />
                    </label>
                    <label className="relative min-w-0">
                      <span className="pointer-events-none absolute left-2 top-1 text-[9px] font-semibold leading-3 text-zinc-500">상태</span>
                      <select
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-2 pb-1 pt-4 text-xs outline-none transition focus:border-teal-500"
                        value={edit.status}
                        onChange={(event) => updateBranchEdit(branch.id, { status: event.target.value as BranchStatus })}
                      >
                        <option value="active">운영 중</option>
                        <option value="inactive">비활성</option>
                      </select>
                    </label>
                    <label className="relative min-w-0">
                      <span className="pointer-events-none absolute left-2 top-1 text-[9px] font-semibold leading-3 text-zinc-500">시간대</span>
                      <select
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-2 pb-1 pt-4 text-xs outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                        value={edit.timezone}
                        onChange={(event) => updateBranchEdit(branch.id, { timezone: event.target.value })}
                      >
                        {supportedBranchTimezones.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                        {!isKnownBranchTimezone(edit.timezone) ? (
                          <option value={edit.timezone}>{formatBranchTimezone(edit.timezone)}</option>
                        ) : null}
                      </select>
                    </label>
                  </div>
                  <fieldset className="grid gap-2">
                    <legend className="sr-only">지점 정책 토글</legend>
                    <label className="flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-xs font-medium leading-4 text-zinc-700">
                      <input
                        className="h-5 w-5 shrink-0 accent-teal-700"
                        checked={edit.attendanceEditRequiresReason}
                        type="checkbox"
                        onChange={(event) => updateBranchEdit(branch.id, { attendanceEditRequiresReason: event.target.checked })}
                      />
                      <span className="min-w-0 break-words">출석 수정 사유 필수</span>
                    </label>
                  </fieldset>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <label>
                      <span className="sr-only">지점 변경 사유</span>
                      <input
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                        placeholder="변경 사유"
                        value={edit.reason}
                        onChange={(event) => updateBranchEdit(branch.id, { reason: event.target.value })}
                      />
                    </label>
                    <Button
                      className="self-end whitespace-nowrap"
                      data-testid={`admin-branch-settings-save-${branch.id}`}
                      disabled={!edit.name.trim() || !edit.district.trim() || !edit.reason.trim()}
                      size="lg"
                      type="submit"
                      variant={edit.status === "inactive" ? "danger" : "secondary"}
                    >
                      <Save className="h-4 w-4" aria-hidden />
                      설정 저장
                    </Button>
                  </div>
                </form>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
