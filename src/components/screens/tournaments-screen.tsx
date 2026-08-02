"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  ExternalLink,
  MapPin,
  Pencil,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Trophy,
  UserPlus,
  X,
} from "lucide-react";
import {
  tournamentDivisions,
  tournamentRegistrationStatuses,
  type Member,
  type Tournament,
  type TournamentDivision,
  type TournamentRegistrationStatus,
} from "@/lib/domain";
import { getFamilyMemberRelationLabel, getGuardianMemberRelation } from "@/lib/family-members";
import { formatDate, formatDateKey, formatDateTime } from "@/lib/format";
import { hasGlobalAdminDataAccess } from "@/lib/google-play-review-access";
import { canMutateTournament, canViewTournament, resolveTournamentAccess } from "@/lib/tournament-policy";
import { useApiContext } from "@/hooks/use-api-context";
import { useAppStore } from "@/store/app-store";
import { Button, SectionHeader } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/state-blocks";

const organizerSuggestions = ["대한유도회", "서울특별시유도회", "대한체육회", "기타 단체"];
const tournamentRegistrationStatusLabels: Record<TournamentRegistrationStatus, string> = {
  pending: "검토 중",
  confirmed: "참가 확정",
  rejected: "신청 반려",
  submitted: "협회 제출",
};

function getTournamentRegistrationStatus(status?: TournamentRegistrationStatus) {
  return status ?? "pending";
}

function getDefaultTournamentDivision(member: Member): TournamentDivision {
  if (member.ageGroup === "kids") {
    return "초등부";
  }

  return member.ageGroup === "teen" ? "중등부" : "일반부";
}

function getDdayLabel(dateKey: string) {
  const target = Date.parse(`${dateKey}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today.getTime()) / 86_400_000);

  if (Number.isNaN(diffDays)) {
    return null;
  }

  if (diffDays === 0) {
    return "오늘";
  }

  return diffDays > 0 ? `D-${diffDays}` : "종료";
}

function escapeCsvCell(value: string | number) {
  const raw = String(value);
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function TournamentsScreen() {
  const context = useApiContext();
  const {
    cancelTournamentRegistration,
    createTournament,
    deleteTournament,
    registerForTournament,
    reviewTournamentRegistration,
    reviewTournamentRegistrations,
    syncKoreaJudoTournaments,
    updateTournament,
  } = useAppStore();
  const canManage = context.user.role === "coach" || context.user.role === "owner" || context.user.role === "admin";
  const canApply = context.user.role === "member" || context.user.role === "guardian";
  const canSyncKoreaJudo = hasGlobalAdminDataAccess(context.user);
  const visibleBranchIds = useMemo(
    () => context.selectedBranchId
      ? [context.selectedBranchId]
      : context.db.branches.map((branch) => branch.id),
    [context.db.branches, context.selectedBranchId],
  );
  const selectedBranch = context.selectedBranchId
    ? context.db.branches.find((branch) => branch.id === context.selectedBranchId) ?? null
    : null;
  const canCreate = context.user.role === "admin" || (canManage && selectedBranch !== null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingTournamentId, setEditingTournamentId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [registrationDeadline, setRegistrationDeadline] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deletingTournamentId, setDeletingTournamentId] = useState<string | null>(null);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const [syncPending, setSyncPending] = useState(false);
  const [registrationTournamentId, setRegistrationTournamentId] = useState<string | null>(null);
  const [registrationMemberId, setRegistrationMemberId] = useState("");
  const [registrationDivision, setRegistrationDivision] = useState<TournamentDivision>("일반부");
  const [registrationWeightClass, setRegistrationWeightClass] = useState("");
  const [registrationPending, setRegistrationPending] = useState(false);
  const [registrationFeedback, setRegistrationFeedback] = useState<string | null>(null);
  const [managementTournamentId, setManagementTournamentId] = useState<string | null>(null);
  const [reviewPendingKey, setReviewPendingKey] = useState<string | null>(null);
  const [managementFeedback, setManagementFeedback] = useState<string | null>(null);
  const [managementSearch, setManagementSearch] = useState("");
  const [managementStatusFilter, setManagementStatusFilter] = useState<"all" | TournamentRegistrationStatus>("all");
  const [managementDivisionFilter, setManagementDivisionFilter] = useState<"all" | TournamentDivision>("all");
  const [managementSelectedMemberIds, setManagementSelectedMemberIds] = useState<string[]>([]);
  const [managementReviewNote, setManagementReviewNote] = useState("");

  const todayKey = formatDateKey(new Date());
  const tournaments = useMemo(() => {
    return [...(context.db.tournaments ?? [])]
      .filter((tournament) => canViewTournament(tournament, visibleBranchIds))
      .sort((a, b) => {
        const aUpcoming = a.eventDate >= todayKey;
        const bUpcoming = b.eventDate >= todayKey;

        if (aUpcoming !== bUpcoming) {
          return aUpcoming ? -1 : 1;
        }

        // 예정 대회는 가까운 순, 지난 대회는 최근 순
        return aUpcoming ? a.eventDate.localeCompare(b.eventDate) : b.eventDate.localeCompare(a.eventDate);
      });
  }, [context.db.tournaments, todayKey, visibleBranchIds]);
  const upcomingCount = tournaments.filter((tournament) => tournament.eventDate >= todayKey).length;
  const importedTournaments = tournaments.filter((tournament) => tournament.source === "korea_judo_association");
  const latestSourceSyncAt = importedTournaments
    .map((tournament) => tournament.sourceSyncedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const registrationTournament =
    tournaments.find((tournament) => tournament.id === registrationTournamentId) ?? null;
  const registrationCandidates = registrationTournament
    ? context.db.members.filter((member) => {
        const access = resolveTournamentAccess(registrationTournament);
        return access.scope === "global" || access.branchId === member.branchId;
      })
    : [];
  const selectedRegistrationMember =
    registrationCandidates.find((member) => member.id === registrationMemberId) ?? null;
  const selectedRegistration =
    registrationTournament?.registrations?.find(
      (registration) => registration.memberId === selectedRegistrationMember?.id,
    ) ?? null;
  const selectedRegistrationSubmitted = selectedRegistration?.status === "submitted";
  const managementTournament =
    tournaments.find((tournament) => tournament.id === managementTournamentId) ?? null;
  const pendingRegistrationTournaments = tournaments
    .map((tournament) => ({
      tournament,
      pendingCount: (tournament.registrations ?? []).filter(
        (registration) => getTournamentRegistrationStatus(registration.status) === "pending",
      ).length,
    }))
    .filter((row) => row.pendingCount > 0);
  const pendingRegistrationCount = pendingRegistrationTournaments.reduce((sum, row) => sum + row.pendingCount, 0);
  const managementRows = useMemo(() => {
    if (!managementTournament) {
      return [];
    }

    const normalizedSearch = managementSearch.trim().toLocaleLowerCase("ko-KR");

    return (managementTournament.registrations ?? [])
      .map((registration) => {
        const member = context.db.members.find((candidate) => candidate.id === registration.memberId);
        const branch = member
          ? context.db.branches.find((candidate) => candidate.id === member.branchId)
          : null;

        return {
          branch,
          member,
          registration,
          status: getTournamentRegistrationStatus(registration.status),
        };
      })
      .filter((row) => managementStatusFilter === "all" || row.status === managementStatusFilter)
      .filter((row) => managementDivisionFilter === "all" || row.registration.division === managementDivisionFilter)
      .filter((row) => {
        if (!normalizedSearch) {
          return true;
        }

        return [
          row.member?.name,
          row.branch?.name,
          row.registration.division,
          row.registration.weightClass,
        ].some((value) => value?.toLocaleLowerCase("ko-KR").includes(normalizedSearch));
      })
      .sort((left, right) => right.registration.appliedAt.localeCompare(left.registration.appliedAt));
  }, [
    context.db.branches,
    context.db.members,
    managementDivisionFilter,
    managementSearch,
    managementStatusFilter,
    managementTournament,
  ]);

  async function handleKoreaJudoSync() {
    if (syncPending) {
      return;
    }

    setSyncPending(true);
    setFeedback(null);
    const result = await syncKoreaJudoTournaments(new Date().getFullYear());
    setSyncPending(false);

    setFeedback(
      result
        ? `대한유도회 ${result.year}년 일정 ${result.importedCount}건을 반영했습니다. 신규 ${result.createdCount}건 · 변경 ${result.updatedCount}건`
        : "대한유도회 일정을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  function resetComposer() {
    setEditingTournamentId(null);
    setTitle("");
    setOrganizer("");
    setEventDate("");
    setLocation("");
    setRegistrationDeadline("");
    setSourceUrl("");
    setDescription("");
  }

  function startEdit(tournament: Tournament) {
    setDeleteConfirmationId(null);
    setComposerOpen(true);
    setEditingTournamentId(tournament.id);
    setTitle(tournament.title);
    setOrganizer(tournament.organizer);
    setEventDate(tournament.eventDate);
    setLocation(tournament.location ?? "");
    setRegistrationDeadline(tournament.registrationDeadline ?? "");
    setSourceUrl(tournament.sourceUrl ?? "");
    setDescription(tournament.description ?? "");
    setFeedback(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (!title.trim() || !organizer.trim() || !eventDate) {
      setFeedback("대회명, 주최 단체, 대회일을 입력해 주세요.");
      return;
    }

    setPending(true);

    const payload = {
      title: title.trim(),
      organizer: organizer.trim(),
      eventDate,
      location: location.trim() || undefined,
      registrationDeadline: registrationDeadline || undefined,
      sourceUrl: sourceUrl.trim() || undefined,
      description: description.trim() || undefined,
    };
    const saved = editingTournamentId
      ? await updateTournament(editingTournamentId, payload)
      : await createTournament(payload);

    setPending(false);

    if (saved) {
      setFeedback(editingTournamentId ? "대회 공지를 수정했습니다." : "대회 공지를 등록했습니다.");
      resetComposer();
      setComposerOpen(false);
    } else {
      setFeedback(editingTournamentId ? "대회 공지를 수정하지 못했습니다." : "대회 공지를 등록하지 못했습니다.");
    }
  }

  async function confirmDelete(tournament: Tournament) {
    if (deletingTournamentId) {
      return;
    }

    setDeletingTournamentId(tournament.id);
    const removed = await deleteTournament(tournament.id);
    setDeletingTournamentId(null);
    setDeleteConfirmationId(null);
    setFeedback(removed ? "대회 공지를 삭제했습니다." : "대회 공지를 삭제하지 못했습니다.");

    if (removed && editingTournamentId === tournament.id) {
      resetComposer();
      setComposerOpen(false);
    }
  }

  function openRegistration(tournament: Tournament) {
    const access = resolveTournamentAccess(tournament);
    const candidates = context.db.members.filter(
      (member) => access.scope === "global" || access.branchId === member.branchId,
    );
    const registeredCandidate = candidates.find((member) =>
      (tournament.registrations ?? []).some((registration) => registration.memberId === member.id),
    );
    const selectableCandidate =
      registeredCandidate ?? candidates.find((member) => member.status === "active" || member.status === "trial");
    const selectedCandidate = selectableCandidate ?? candidates[0] ?? null;
    const existingRegistration = (tournament.registrations ?? []).find(
      (registration) => registration.memberId === selectedCandidate?.id,
    );

    setRegistrationTournamentId(tournament.id);
    setRegistrationMemberId(selectedCandidate?.id ?? "");
    setRegistrationDivision(
      existingRegistration?.division ??
        (selectedCandidate ? getDefaultTournamentDivision(selectedCandidate) : "일반부"),
    );
    setRegistrationWeightClass(existingRegistration?.weightClass ?? "");
    setRegistrationFeedback(null);
  }

  function closeRegistration() {
    if (registrationPending) {
      return;
    }

    setRegistrationTournamentId(null);
    setRegistrationMemberId("");
    setRegistrationDivision("일반부");
    setRegistrationWeightClass("");
    setRegistrationFeedback(null);
  }

  async function handleRegistrationSubmit() {
    if (!registrationTournament || !selectedRegistrationMember || registrationPending) {
      return;
    }

    const weightClass = registrationWeightClass.trim();

    if (!weightClass) {
      setRegistrationFeedback("체급을 입력해 주세요.");
      return;
    }

    setRegistrationPending(true);
    setRegistrationFeedback(null);
    const result = await registerForTournament(registrationTournament.id, {
      memberId: selectedRegistrationMember.id,
      division: registrationDivision,
      weightClass,
    });
    setRegistrationPending(false);
    setRegistrationFeedback(result.message);
  }

  async function handleRegistrationCancel() {
    if (!registrationTournament || !selectedRegistrationMember || !selectedRegistration || registrationPending) {
      return;
    }

    setRegistrationPending(true);
    setRegistrationFeedback(null);
    const result = await cancelTournamentRegistration(registrationTournament.id, selectedRegistrationMember.id);
    setRegistrationPending(false);
    setRegistrationFeedback(result.message);
  }

  function openRegistrationManagement(tournament: Tournament) {
    setManagementTournamentId(tournament.id);
    setManagementFeedback(null);
    setManagementSearch("");
    setManagementStatusFilter("all");
    setManagementDivisionFilter("all");
    setManagementSelectedMemberIds([]);
    setManagementReviewNote("");
  }

  function closeRegistrationManagement() {
    if (reviewPendingKey) {
      return;
    }

    setManagementTournamentId(null);
    setManagementFeedback(null);
    setManagementSelectedMemberIds([]);
    setManagementReviewNote("");
  }

  async function handleRegistrationReview(
    tournamentId: string,
    memberId: string,
    status: TournamentRegistrationStatus,
  ) {
    const pendingKey = `${memberId}:${status}`;
    const note = managementReviewNote.trim();

    if (reviewPendingKey) {
      return;
    }

    if (status === "rejected" && !note) {
      setManagementFeedback("신청을 반려하려면 처리 사유를 입력해 주세요.");
      return;
    }

    setReviewPendingKey(pendingKey);
    setManagementFeedback(null);
    const result = await reviewTournamentRegistration(tournamentId, memberId, status, note || undefined);
    setReviewPendingKey(null);
    setManagementFeedback(result.message);

    if (result.ok) {
      setManagementReviewNote("");
    }
  }

  async function handleBulkRegistrationReview(status: TournamentRegistrationStatus) {
    if (!managementTournament || managementSelectedMemberIds.length === 0 || reviewPendingKey) {
      return;
    }

    const note = managementReviewNote.trim();

    if (status === "rejected" && !note) {
      setManagementFeedback("선택한 신청을 반려하려면 처리 사유를 입력해 주세요.");
      return;
    }

    if (
      status === "submitted" &&
      managementRows
        .filter((row) => managementSelectedMemberIds.includes(row.registration.memberId))
        .some((row) => row.status !== "confirmed" && row.status !== "submitted")
    ) {
      setManagementFeedback("참가 확정된 회원만 협회 제출 상태로 변경할 수 있습니다.");
      return;
    }

    setReviewPendingKey(`bulk:${status}`);
    setManagementFeedback(null);
    const result = await reviewTournamentRegistrations(
      managementTournament.id,
      managementSelectedMemberIds,
      status,
      note || undefined,
    );
    setReviewPendingKey(null);
    setManagementFeedback(result.message);

    if (result.ok) {
      setManagementSelectedMemberIds([]);
      setManagementReviewNote("");
    }
  }

  function toggleManagementSelection(memberId: string) {
    setManagementSelectedMemberIds((selected) =>
      selected.includes(memberId)
        ? selected.filter((candidate) => candidate !== memberId)
        : [...selected, memberId],
    );
  }

  function toggleAllVisibleManagementRows() {
    const visibleMemberIds = managementRows.map((row) => row.registration.memberId);
    const allSelected =
      visibleMemberIds.length > 0 &&
      visibleMemberIds.every((memberId) => managementSelectedMemberIds.includes(memberId));

    setManagementSelectedMemberIds((selected) =>
      allSelected
        ? selected.filter((memberId) => !visibleMemberIds.includes(memberId))
        : [...new Set([...selected, ...visibleMemberIds])],
    );
  }

  function exportRegistrationCsv() {
    if (!managementTournament || managementRows.length === 0) {
      setManagementFeedback("출력할 참가 신청 명단이 없습니다.");
      return;
    }

    const header = ["대회", "회원명", "지점", "종별", "체급", "상태", "신청일시", "처리사유"];
    const rows = managementRows.map(({ branch, member, registration, status }) => [
      managementTournament.title,
      member?.name ?? "삭제된 회원",
      branch?.name ?? "지점 미확인",
      registration.division,
      registration.weightClass,
      tournamentRegistrationStatusLabels[status],
      formatDateTime(registration.appliedAt),
      registration.reviewNote ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `final-judo-tournament-registrations-${managementTournament.eventDate}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setManagementFeedback(`현재 필터 기준 ${managementRows.length}명의 참가 명단을 저장했습니다.`);
  }

  return (
    <div className="min-w-0">
      {canManage ? (
        <SectionHeader
          title="대회"
          action={
            <div className="flex flex-wrap justify-end gap-2">
              {canSyncKoreaJudo ? (
                <Button
                  data-testid="korea-judo-tournament-sync"
                  disabled={syncPending}
                  size="md"
                  type="button"
                  variant="secondary"
                  onClick={() => void handleKoreaJudoSync()}
                >
                  <RefreshCw className={`h-4 w-4 ${syncPending ? "animate-spin" : ""}`} aria-hidden />
                  {syncPending ? "가져오는 중" : "일정 가져오기"}
                </Button>
              ) : null}
              {canCreate ? (
                <Button
                  size="md"
                  type="button"
                  variant={composerOpen ? "secondary" : "primary"}
                  onClick={() => {
                    if (composerOpen) {
                      resetComposer();
                    }

                    setComposerOpen((open) => !open);
                    setFeedback(null);
                  }}
                >
                  {composerOpen ? (
                    <>
                      <X className="h-4 w-4" aria-hidden />
                      닫기
                    </>
                  ) : (
                    <>
                      <PlusCircle className="h-4 w-4" aria-hidden />
                      대회 등록
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          }
        />
      ) : null}

      {canManage ? (
        <p className="mb-3 text-sm font-medium text-zinc-600">
          예정 대회 {upcomingCount}건 · 전체 {tournaments.length}건
        </p>
      ) : null}
      {canManage && importedTournaments.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900">
          <span>대한유도회 연동 일정 {importedTournaments.length}건</span>
          {latestSourceSyncAt ? <span>최근 동기화 {formatDate(latestSourceSyncAt)}</span> : null}
        </div>
      ) : null}

      {canManage && !canCreate ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          대회를 등록하려면 상단에서 담당 지점을 선택해 주세요.
        </p>
      ) : null}

      {canCreate && composerOpen ? (
        <form className="mb-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-950">{editingTournamentId ? "대회 공지 수정" : "새 대회 공지"}</p>
            <span className="rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">
              {selectedBranch?.name ?? "전 지점"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-zinc-500">대회명</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="tournament-title-input"
                maxLength={80}
                placeholder="예: 2026 회장기 전국 유도대회"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">주최 단체</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="tournament-organizer-input"
                list="tournament-organizer-suggestions"
                maxLength={40}
                placeholder="예: 대한유도회"
                value={organizer}
                onChange={(event) => setOrganizer(event.target.value)}
                required
              />
              <datalist id="tournament-organizer-suggestions">
                {organizerSuggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">대회일</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="tournament-event-date-input"
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
                required
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">접수 마감일 (선택)</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="tournament-deadline-input"
                max={eventDate || undefined}
                type="date"
                value={registrationDeadline}
                onChange={(event) => setRegistrationDeadline(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">장소 (선택)</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="tournament-location-input"
                maxLength={80}
                placeholder="예: 진천선수촌 유도장"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-zinc-500">공지 링크 (선택)</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="tournament-source-url-input"
                inputMode="url"
                maxLength={300}
                placeholder="https:// 단체 공지 주소"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-zinc-500">설명 (선택)</span>
              <textarea
                className="min-h-20 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="tournament-description-input"
                maxLength={500}
                placeholder="체급, 참가 대상, 준비물 등"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-h-5 text-xs font-medium text-zinc-500" aria-live="polite" role="status">
              {feedback ?? `${selectedBranch?.name ?? "모든 지점"}의 회원·학부모에게 표시됩니다.`}
            </p>
            <Button data-testid="tournament-submit" disabled={pending} size="lg" type="submit" variant="primary">
              {pending ? "저장 중" : editingTournamentId ? "수정 저장" : "등록"}
            </Button>
          </div>
        </form>
      ) : null}

      {!composerOpen && feedback ? (
        <p className="mb-3 text-sm font-medium text-zinc-700" aria-live="polite" role="status">
          {feedback}
        </p>
      ) : null}

      {canManage ? (
        <section
          className="mb-4 overflow-hidden rounded-lg border border-zinc-200 bg-white"
          id="registration-queue"
          data-testid="tournament-registration-queue"
        >
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-950">참가 신청 현황</h2>
              <p className="mt-0.5 text-xs font-medium text-zinc-500">
                검토 대기 {pendingRegistrationCount}명
              </p>
            </div>
            <UserPlus className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
          </div>
          {pendingRegistrationTournaments.length > 0 ? (
            <div className="divide-y divide-zinc-100">
              {pendingRegistrationTournaments.map(({ pendingCount, tournament }) => (
                <button
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
                  data-testid={`tournament-registration-queue-${tournament.id}`}
                  key={tournament.id}
                  type="button"
                  onClick={() => openRegistrationManagement(tournament)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{tournament.title}</span>
                    <span className="mt-0.5 block text-xs font-medium text-zinc-500">
                      {formatDate(tournament.eventDate)} · 신청 {(tournament.registrations ?? []).length}명
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                    대기 {pendingCount}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-4 py-4 text-sm font-medium text-zinc-500">검토할 참가 신청이 없습니다.</p>
          )}
        </section>
      ) : null}

      {tournaments.length === 0 ? (
        <EmptyState
          title="등록된 대회 공지가 없습니다"
          description={
            canCreate
              ? "대회 등록 버튼으로 대한유도회 등 단체의 대회 공지를 추가해 보세요."
              : "도장에서 대회 공지를 등록하면 여기에 표시됩니다."
          }
        />
      ) : (
        <ul className="grid gap-3">
          {tournaments.map((tournament) => {
            const dday = getDdayLabel(tournament.eventDate);
            const access = resolveTournamentAccess(tournament);
            const branchName = access.branchId
              ? context.db.branches.find((branch) => branch.id === access.branchId)?.name ?? "지점 공지"
              : "전 지점";
            const canEditTournament = canMutateTournament(context.user, tournament, visibleBranchIds);
            const deadlinePassed = tournament.registrationDeadline
              ? tournament.registrationDeadline < todayKey
              : false;
            const eventEnded = (tournament.eventEndDate ?? tournament.eventDate) < todayKey;
            const registeredMemberCount = (tournament.registrations ?? []).length;

            return (
              <li
                className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
                data-testid="tournament-card"
                key={tournament.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                      <Trophy className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />
                      <span className="min-w-0 break-words">{tournament.title}</span>
                    </p>
                    <p className="mt-1.5 text-xs font-medium text-zinc-500">{tournament.organizer}</p>
                    <span className="mt-2 inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">
                      {branchName}
                    </span>
                    {tournament.source === "korea_judo_association" ? (
                      <span className="ml-1.5 mt-2 inline-flex rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700">
                        대한유도회 연동
                      </span>
                    ) : null}
                  </div>
                  {dday ? (
                    <span
                      className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${
                        dday === "종료"
                          ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                          : "border-teal-200 bg-teal-50 text-teal-700"
                      }`}
                    >
                      {dday}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-1.5 text-sm text-zinc-700">
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                    대회일 {formatDate(tournament.eventDate)}
                    {tournament.eventEndDate ? ` ~ ${formatDate(tournament.eventEndDate)}` : ""}
                    {tournament.registrationDeadline
                      ? ` · 접수 마감 ${formatDate(tournament.registrationDeadline)}${deadlinePassed ? " (마감됨)" : ""}`
                      : ""}
                  </p>
                  {tournament.location ? (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                      {tournament.location}
                    </p>
                  ) : null}
                  {tournament.description ? (
                    <p className="whitespace-pre-line break-words text-sm leading-6 text-zinc-600">{tournament.description}</p>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {tournament.sourceUrl ? (
                    <a
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                      data-testid={`tournament-source-link-${tournament.id}`}
                      href={tournament.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      단체 공지 보기
                    </a>
                  ) : null}
                  {canEditTournament ? (
                    <>
                      <button
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        data-testid={`tournament-edit-${tournament.id}`}
                        type="button"
                        onClick={() => startEdit(tournament)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        수정
                      </button>
                      <button
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                        data-testid={`tournament-delete-${tournament.id}`}
                        aria-expanded={deleteConfirmationId === tournament.id}
                        disabled={deletingTournamentId === tournament.id}
                        type="button"
                        onClick={() => setDeleteConfirmationId(tournament.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        삭제
                      </button>
                      {deleteConfirmationId === tournament.id ? (
                        <div
                          aria-labelledby={`tournament-delete-title-${tournament.id}`}
                          className="mt-2 grid w-full gap-3 rounded-md border border-red-200 bg-red-50 p-3"
                          data-testid={`tournament-delete-confirmation-${tournament.id}`}
                          role="alertdialog"
                        >
                          <div>
                            <p className="text-sm font-semibold text-red-900" id={`tournament-delete-title-${tournament.id}`}>
                              이 대회 공지를 삭제할까요?
                            </p>
                            <p className="mt-1 text-xs leading-5 text-red-700">삭제하면 모든 대상 화면에서 즉시 사라집니다.</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              data-testid={`tournament-delete-cancel-${tournament.id}`}
                              disabled={deletingTournamentId === tournament.id}
                              size="lg"
                              type="button"
                              onClick={() => setDeleteConfirmationId(null)}
                            >
                              취소
                            </Button>
                            <Button
                              data-testid={`tournament-delete-confirm-${tournament.id}`}
                              disabled={deletingTournamentId === tournament.id}
                              size="lg"
                              type="button"
                              variant="danger"
                              onClick={() => void confirmDelete(tournament)}
                            >
                              {deletingTournamentId === tournament.id ? "삭제 중" : "삭제 확인"}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {canManage && registeredMemberCount > 0 ? (
                    <button
                      className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md bg-zinc-950 px-4 text-xs font-semibold text-white transition hover:bg-zinc-800"
                      data-testid={`tournament-registration-manage-${tournament.id}`}
                      type="button"
                      onClick={() => openRegistrationManagement(tournament)}
                    >
                      <UserPlus className="h-4 w-4" aria-hidden />
                      신청 관리 {registeredMemberCount}명
                    </button>
                  ) : null}
                  {canApply ? (
                    <button
                      className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md bg-teal-700 px-4 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
                      data-testid={`tournament-registration-open-${tournament.id}`}
                      disabled={deadlinePassed || eventEnded}
                      type="button"
                      onClick={() => openRegistration(tournament)}
                    >
                      {registeredMemberCount > 0 ? (
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                      ) : (
                        <UserPlus className="h-4 w-4" aria-hidden />
                      )}
                      {eventEnded ? "대회 종료" : deadlinePassed ? "신청 마감" : registeredMemberCount > 0 ? "신청 확인" : "참가 신청"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {registrationTournament ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center"
          data-testid="tournament-registration-overlay"
          role="presentation"
        >
          <section
            aria-labelledby="tournament-registration-title"
            aria-modal="true"
            className="max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl"
            data-testid="tournament-registration-dialog"
            role="dialog"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-4">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-zinc-950" id="tournament-registration-title">
                  대회 참가 신청
                </p>
                <p className="mt-1 break-words text-sm font-medium text-zinc-600">{registrationTournament.title}</p>
              </div>
              <button
                aria-label="참가 신청 창 닫기"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100"
                disabled={registrationPending}
                type="button"
                onClick={closeRegistration}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="grid gap-4 p-4">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                <p className="font-semibold text-zinc-950">
                  {formatDate(registrationTournament.eventDate)}
                  {registrationTournament.eventEndDate ? ` ~ ${formatDate(registrationTournament.eventEndDate)}` : ""}
                </p>
                {registrationTournament.location ? <p className="mt-1">{registrationTournament.location}</p> : null}
                {registrationTournament.registrationDeadline ? (
                  <p className="mt-1 text-xs font-medium text-zinc-500">
                    신청 마감 {formatDate(registrationTournament.registrationDeadline)}
                  </p>
                ) : null}
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-semibold text-zinc-950">참가 회원</legend>
                {registrationCandidates.length > 0 ? (
                  registrationCandidates.map((member) => {
                    const isSelectable = member.status === "active" || member.status === "trial";
                    const memberRegistration = (registrationTournament.registrations ?? []).find(
                      (registration) => registration.memberId === member.id,
                    );
                    const isRegistered = Boolean(memberRegistration);
                    const registrationStatus = getTournamentRegistrationStatus(memberRegistration?.status);
                    const relationLabel =
                      context.user.role === "guardian"
                        ? getFamilyMemberRelationLabel(getGuardianMemberRelation(context.user, member))
                        : "본인";

                    return (
                      <label
                        className={`flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 transition ${
                          registrationMemberId === member.id
                            ? "border-teal-500 bg-teal-50"
                            : "border-zinc-200 bg-white"
                        } ${isSelectable || isRegistered ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                        key={member.id}
                      >
                        <input
                          checked={registrationMemberId === member.id}
                          className="h-4 w-4 accent-teal-700"
                          data-testid={`tournament-registration-member-${member.id}`}
                          disabled={!isSelectable && !isRegistered}
                          name="tournament-registration-member"
                          type="radio"
                          value={member.id}
                          onChange={() => {
                            const existingRegistration = (registrationTournament.registrations ?? []).find(
                              (registration) => registration.memberId === member.id,
                            );
                            setRegistrationMemberId(member.id);
                            setRegistrationDivision(
                              existingRegistration?.division ?? getDefaultTournamentDivision(member),
                            );
                            setRegistrationWeightClass(existingRegistration?.weightClass ?? "");
                            setRegistrationFeedback(null);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-zinc-950">{member.name}</span>
                          <span className="mt-0.5 block text-xs font-medium text-zinc-500">
                            {relationLabel} · {member.level}
                          </span>
                        </span>
                        <span className={`text-xs font-semibold ${isRegistered ? "text-teal-700" : "text-zinc-500"}`}>
                          {isRegistered
                            ? tournamentRegistrationStatusLabels[registrationStatus]
                            : isSelectable
                              ? "신청 가능"
                              : "신청 불가"}
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-800">
                    신청할 수 있는 연결 회원이 없습니다.
                  </p>
                )}
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-zinc-950">
                  종별
                  <select
                    className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base font-medium text-zinc-950 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:bg-zinc-100"
                    data-testid="tournament-registration-division"
                    disabled={!selectedRegistrationMember || registrationPending || selectedRegistrationSubmitted}
                    value={registrationDivision}
                    onChange={(event) => {
                      setRegistrationDivision(event.target.value as TournamentDivision);
                      setRegistrationFeedback(null);
                    }}
                  >
                    {tournamentDivisions.map((division) => (
                      <option key={division} value={division}>
                        {division}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm font-semibold text-zinc-950">
                  체급
                  <input
                    className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base font-medium text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:bg-zinc-100"
                    data-testid="tournament-registration-weight-class"
                    disabled={!selectedRegistrationMember || registrationPending || selectedRegistrationSubmitted}
                    inputMode="text"
                    maxLength={30}
                    placeholder="예: -60kg, +100kg, 무제한급"
                    type="text"
                    value={registrationWeightClass}
                    onChange={(event) => {
                      setRegistrationWeightClass(event.target.value);
                      setRegistrationFeedback(null);
                    }}
                  />
                </label>
              </div>

              <p
                aria-live="polite"
                className={`min-h-5 text-sm font-medium ${
                  registrationFeedback?.includes("못했습니다") ||
                  registrationFeedback?.includes("마감") ||
                  registrationFeedback?.includes("입력")
                    ? "text-red-700"
                    : "text-zinc-600"
                }`}
                role="status"
              >
                {registrationFeedback ??
                  (selectedRegistrationSubmitted
                    ? "협회에 제출된 참가 신청은 직접 수정하거나 취소할 수 없습니다. 담당 코치에게 문의해 주세요."
                    : selectedRegistration
                    ? `${selectedRegistrationMember?.name ?? "선택 회원"}님의 ${selectedRegistration.division ?? "종별 미입력"} · ${selectedRegistration.weightClass ?? "체급 미입력"} 신청은 ${tournamentRegistrationStatusLabels[getTournamentRegistrationStatus(selectedRegistration.status)]} 상태입니다.`
                    : "참가 회원, 종별, 체급을 확인한 뒤 신청해 주세요.")}
              </p>

              {selectedRegistration?.reviewNote ? (
                <div
                  className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm leading-6 text-teal-900"
                  data-testid="tournament-registration-review-guidance"
                >
                  <span className="font-semibold">처리 안내</span>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{selectedRegistration.reviewNote}</p>
                </div>
              ) : null}

              {selectedRegistration ? (
                <Button
                  data-testid="tournament-registration-cancel"
                  disabled={registrationPending || selectedRegistrationSubmitted}
                  size="lg"
                  type="button"
                  variant="danger"
                  onClick={() => void handleRegistrationCancel()}
                >
                  {registrationPending ? "처리 중" : selectedRegistrationSubmitted ? "협회 제출 완료" : "신청 취소"}
                </Button>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <Button disabled={registrationPending} size="lg" type="button" onClick={closeRegistration}>
                  닫기
                </Button>
                <Button
                  data-testid="tournament-registration-submit"
                  disabled={
                    !selectedRegistrationMember ||
                    !registrationWeightClass.trim() ||
                    registrationPending ||
                    selectedRegistrationSubmitted
                  }
                  size="lg"
                  type="button"
                  variant="primary"
                  onClick={() => void handleRegistrationSubmit()}
                >
                  {registrationPending
                    ? "저장 중"
                    : selectedRegistrationSubmitted
                      ? "수정 불가"
                      : selectedRegistration
                        ? "신청 정보 수정"
                        : "참가 신청"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {managementTournament ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center"
          data-testid="tournament-registration-management-overlay"
          role="presentation"
        >
          <section
            aria-labelledby="tournament-registration-management-title"
            aria-modal="true"
            className="max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl"
            data-testid="tournament-registration-management-dialog"
            role="dialog"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-4">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-zinc-950" id="tournament-registration-management-title">
                  참가 신청 관리
                </p>
                <p className="mt-1 break-words text-sm font-medium text-zinc-600">{managementTournament.title}</p>
              </div>
              <button
                aria-label="참가 신청 관리 창 닫기"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100"
                disabled={Boolean(reviewPendingKey)}
                type="button"
                onClick={closeRegistrationManagement}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="grid gap-4 p-4">
              <div className="grid grid-cols-2 gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-center sm:grid-cols-4">
                {tournamentRegistrationStatuses.map((status) => (
                  <button
                    aria-pressed={managementStatusFilter === status}
                    className={`min-h-14 rounded-md px-2 transition ${
                      managementStatusFilter === status ? "bg-white shadow-sm ring-1 ring-zinc-200" : "hover:bg-white"
                    }`}
                    key={status}
                    type="button"
                    onClick={() => {
                      setManagementStatusFilter((current) => current === status ? "all" : status);
                      setManagementSelectedMemberIds([]);
                    }}
                  >
                    <span className="block text-lg font-semibold text-zinc-950">
                      {(managementTournament.registrations ?? []).filter(
                        (registration) => getTournamentRegistrationStatus(registration.status) === status,
                      ).length}
                    </span>
                    <span className="mt-0.5 block text-xs font-medium text-zinc-500">
                      {tournamentRegistrationStatusLabels[status]}
                    </span>
                  </button>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
                <label className="relative min-w-0">
                  <span className="sr-only">참가 회원 검색</span>
                  <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-400" aria-hidden />
                  <input
                    className="min-h-11 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                    data-testid="tournament-registration-management-search"
                    placeholder="이름, 지점, 체급 검색"
                    type="search"
                    value={managementSearch}
                    onChange={(event) => {
                      setManagementSearch(event.target.value);
                      setManagementSelectedMemberIds([]);
                    }}
                  />
                </label>
                <label>
                  <span className="sr-only">처리 상태 필터</span>
                  <select
                    className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 outline-none focus:border-teal-600"
                    data-testid="tournament-registration-management-status-filter"
                    value={managementStatusFilter}
                    onChange={(event) => {
                      setManagementStatusFilter(event.target.value as "all" | TournamentRegistrationStatus);
                      setManagementSelectedMemberIds([]);
                    }}
                  >
                    <option value="all">전체 상태</option>
                    {tournamentRegistrationStatuses.map((status) => (
                      <option key={status} value={status}>{tournamentRegistrationStatusLabels[status]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">종별 필터</span>
                  <select
                    className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 outline-none focus:border-teal-600"
                    data-testid="tournament-registration-management-division-filter"
                    value={managementDivisionFilter}
                    onChange={(event) => {
                      setManagementDivisionFilter(event.target.value as "all" | TournamentDivision);
                      setManagementSelectedMemberIds([]);
                    }}
                  >
                    <option value="all">전체 종별</option>
                    {tournamentDivisions.map((division) => <option key={division} value={division}>{division}</option>)}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
                  <input
                    checked={managementRows.length > 0 && managementRows.every((row) =>
                      managementSelectedMemberIds.includes(row.registration.memberId)
                    )}
                    className="h-5 w-5 accent-teal-700"
                    data-testid="tournament-registration-management-select-all"
                    type="checkbox"
                    onChange={toggleAllVisibleManagementRows}
                  />
                  현재 목록 전체
                </label>
                <button
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                  data-testid="tournament-registration-export"
                  type="button"
                  onClick={exportRegistrationCsv}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  CSV
                </button>
              </div>

              <label className="grid gap-1.5 text-sm font-semibold text-zinc-900">
                처리 사유
                <textarea
                  className="min-h-20 w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium leading-6 outline-none transition placeholder:text-zinc-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                  data-testid="tournament-registration-review-note"
                  maxLength={300}
                  placeholder="반려 사유 또는 참가 안내를 입력하세요. 반려 시 필수입니다."
                  value={managementReviewNote}
                  onChange={(event) => {
                    setManagementReviewNote(event.target.value);
                    setManagementFeedback(null);
                  }}
                />
              </label>

              {managementSelectedMemberIds.length > 0 ? (
                <div className="rounded-md border border-teal-200 bg-teal-50 p-3" data-testid="tournament-registration-bulk-actions">
                  <p className="text-sm font-semibold text-teal-900">선택 {managementSelectedMemberIds.length}명 일괄 처리</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button
                      className="inline-flex min-h-11 items-center justify-center rounded-md bg-teal-700 px-2 text-xs font-semibold text-white disabled:opacity-60"
                      disabled={Boolean(reviewPendingKey)}
                      type="button"
                      onClick={() => void handleBulkRegistrationReview("confirmed")}
                    >
                      참가 확정
                    </button>
                    <button
                      className="inline-flex min-h-11 items-center justify-center rounded-md bg-red-700 px-2 text-xs font-semibold text-white disabled:opacity-60"
                      disabled={Boolean(reviewPendingKey)}
                      type="button"
                      onClick={() => void handleBulkRegistrationReview("rejected")}
                    >
                      신청 반려
                    </button>
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md bg-blue-700 px-2 text-xs font-semibold text-white disabled:opacity-60"
                      disabled={Boolean(reviewPendingKey)}
                      type="button"
                      onClick={() => void handleBulkRegistrationReview("submitted")}
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden />
                      협회 제출
                    </button>
                  </div>
                </div>
              ) : null}

              {managementRows.length > 0 ? (
                <ul className="grid gap-3">
                  {managementRows.map(({ branch, member, registration, status: currentStatus }) => {
                    const selected = managementSelectedMemberIds.includes(registration.memberId);

                    return (
                      <li
                        className={`rounded-md border p-3 ${selected ? "border-teal-300 bg-teal-50/40" : "border-zinc-200 bg-white"}`}
                        data-testid={`tournament-registration-management-row-${registration.memberId}`}
                        key={registration.id}
                      >
                        <div className="flex items-start gap-3">
                          <label className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-zinc-100">
                            <span className="sr-only">{member?.name ?? "회원"} 선택</span>
                            <input
                              checked={selected}
                              className="h-5 w-5 accent-teal-700"
                              type="checkbox"
                              onChange={() => toggleManagementSelection(registration.memberId)}
                            />
                          </label>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-zinc-950">{member?.name ?? "삭제된 회원"}</p>
                                <p className="mt-1 text-xs font-medium text-zinc-500">
                                  {branch?.name ?? "지점 미확인"} · {registration.division} · {registration.weightClass}
                                </p>
                                <p className="mt-1 text-xs text-zinc-400">신청 {formatDateTime(registration.appliedAt)}</p>
                              </div>
                              <span
                                className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${
                                  currentStatus === "confirmed"
                                    ? "border-teal-200 bg-teal-50 text-teal-700"
                                    : currentStatus === "rejected"
                                      ? "border-red-200 bg-red-50 text-red-700"
                                      : currentStatus === "submitted"
                                        ? "border-blue-200 bg-blue-50 text-blue-700"
                                        : "border-amber-200 bg-amber-50 text-amber-700"
                                }`}
                              >
                                {tournamentRegistrationStatusLabels[currentStatus]}
                              </span>
                            </div>
                            {registration.reviewNote ? (
                              <p className="mt-2 rounded-md bg-zinc-50 px-2.5 py-2 text-xs leading-5 text-zinc-600">
                                처리 사유: {registration.reviewNote}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={`${member?.name ?? "회원"} 신청 상태`}>
                          {tournamentRegistrationStatuses.map((status) => {
                            const pendingKey = `${registration.memberId}:${status}`;
                            const active = currentStatus === status;
                            const submittedBlocked = status === "submitted" && currentStatus !== "confirmed" && currentStatus !== "submitted";

                            return (
                              <button
                                aria-pressed={active}
                                className={`inline-flex min-h-11 items-center justify-center rounded-md border px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                  active
                                    ? status === "confirmed"
                                      ? "border-teal-700 bg-teal-700 text-white"
                                      : status === "rejected"
                                        ? "border-red-700 bg-red-700 text-white"
                                        : status === "submitted"
                                          ? "border-blue-700 bg-blue-700 text-white"
                                          : "border-amber-700 bg-amber-700 text-white"
                                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                                }`}
                                data-testid={`tournament-registration-review-${registration.memberId}-${status}`}
                                disabled={Boolean(reviewPendingKey) || active || submittedBlocked}
                                key={status}
                                type="button"
                                onClick={() =>
                                  void handleRegistrationReview(
                                    managementTournament.id,
                                    registration.memberId,
                                    status,
                                  )
                                }
                              >
                                {reviewPendingKey === pendingKey
                                  ? "처리 중"
                                  : tournamentRegistrationStatusLabels[status]}
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-5 text-center text-sm font-medium text-zinc-500">
                  검색 조건에 맞는 참가 신청이 없습니다.
                </p>
              )}

              <p
                aria-live="polite"
                className={`min-h-5 text-sm font-medium ${
                  managementFeedback?.includes("못했습니다") ||
                  managementFeedback?.includes("입력") ||
                  managementFeedback?.includes("확정된")
                    ? "text-red-700"
                    : "text-zinc-600"
                }`}
                role="status"
              >
                {managementFeedback ?? "검색과 필터로 명단을 좁힌 뒤 개별 또는 일괄 처리할 수 있습니다."}
              </p>

              <Button disabled={Boolean(reviewPendingKey)} size="lg" type="button" onClick={closeRegistrationManagement}>
                닫기
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
