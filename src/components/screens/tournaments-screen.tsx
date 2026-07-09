"use client";

import { type FormEvent, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, MapPin, Pencil, PlusCircle, Trash2, Trophy, X } from "lucide-react";
import type { Tournament } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { useApiContext } from "@/hooks/use-api-context";
import { useAppStore } from "@/store/app-store";
import { Button, SectionHeader } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/state-blocks";

const organizerSuggestions = ["대한유도회", "서울특별시유도회", "대한체육회", "기타 단체"];

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

export function TournamentsScreen() {
  const context = useApiContext();
  const { createTournament, updateTournament, deleteTournament } = useAppStore();
  const canManage = context.user.role === "coach" || context.user.role === "owner" || context.user.role === "admin";

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

  const tournaments = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);

    return [...(context.db.tournaments ?? [])].sort((a, b) => {
      const aUpcoming = a.eventDate >= todayKey;
      const bUpcoming = b.eventDate >= todayKey;

      if (aUpcoming !== bUpcoming) {
        return aUpcoming ? -1 : 1;
      }

      // 예정 대회는 가까운 순, 지난 대회는 최근 순
      return aUpcoming ? a.eventDate.localeCompare(b.eventDate) : b.eventDate.localeCompare(a.eventDate);
    });
  }, [context.db.tournaments]);
  const upcomingCount = tournaments.filter((tournament) => tournament.eventDate >= new Date().toISOString().slice(0, 10)).length;

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

  async function handleDelete(tournament: Tournament) {
    if (deletingTournamentId) {
      return;
    }

    setDeletingTournamentId(tournament.id);
    const removed = await deleteTournament(tournament.id);
    setDeletingTournamentId(null);
    setFeedback(removed ? "대회 공지를 삭제했습니다." : "대회 공지를 삭제하지 못했습니다.");

    if (removed && editingTournamentId === tournament.id) {
      resetComposer();
      setComposerOpen(false);
    }
  }

  return (
    <div className="min-w-0">
      <SectionHeader
        title="대회"
        action={
          canManage ? (
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
          ) : undefined
        }
      />

      <p className="mb-3 text-sm font-medium text-zinc-600">
        대한유도회 등 외부 단체의 대회 공지를 확인하세요. 예정 대회 {upcomingCount}건 · 전체 {tournaments.length}건
      </p>

      {canManage && composerOpen ? (
        <form className="mb-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4" onSubmit={(event) => void handleSubmit(event)}>
          <p className="text-sm font-semibold text-zinc-950">{editingTournamentId ? "대회 공지 수정" : "새 대회 공지"}</p>
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
              {feedback ?? "저장하면 모든 회원·학부모가 확인할 수 있습니다."}
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

      {tournaments.length === 0 ? (
        <EmptyState
          title="등록된 대회 공지가 없습니다"
          description={
            canManage
              ? "대회 등록 버튼으로 대한유도회 등 단체의 대회 공지를 추가해 보세요."
              : "도장에서 대회 공지를 등록하면 여기에 표시됩니다."
          }
        />
      ) : (
        <ul className="grid gap-3">
          {tournaments.map((tournament) => {
            const dday = getDdayLabel(tournament.eventDate);
            const deadlinePassed = tournament.registrationDeadline
              ? tournament.registrationDeadline < new Date().toISOString().slice(0, 10)
              : false;

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
                  {canManage ? (
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
                        disabled={deletingTournamentId === tournament.id}
                        type="button"
                        onClick={() => void handleDelete(tournament)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        삭제
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
