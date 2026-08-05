"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bell, CircleAlert, Copy, CreditCard, ExternalLink, MapPin, Pencil, Phone, PlusCircle, Search, Trash2, UserPlus, UserRound, X } from "lucide-react";
import type { CounselingNote, CounselingNoteVisibility, Member, MemberGender, MemberStatus, Payment, UserRole } from "@/lib/domain";
import { memberGenderLabels } from "@/lib/domain";
import { ChildSwitcher } from "@/components/domain/child-switcher";
import { useApiContext } from "@/hooks/use-api-context";
import { useFamilyMemberSelection } from "@/hooks/use-guardian-child-selection";
import { useResource } from "@/hooks/use-resource";
import { useUrlSyncedTextParam } from "@/hooks/use-url-synced-text-param";
import { apiClient } from "@/lib/api-client";
import { counselingNoteInputLimits } from "@/lib/counseling-note-input-policy";
import { canManageCounselingNote, canReadCounselingNote } from "@/lib/counseling-note-visibility";
import { formatCurrency, formatDate, formatDateKey, formatDateTime, formatPhoneNumber } from "@/lib/format";
import { getFamilyMemberRelationLabel, getGuardianFamilyMembers, getGuardianMemberRelation } from "@/lib/family-members";
import { invitationLinkCopyFallbackMessage, invitationLinkCopySuccessMessage } from "@/lib/invitation-link-copy";
import { canMemberHaveGuardianLink } from "@/lib/member-age-policy";
import { memberInputLimits } from "@/lib/member-input-policy";
import { getChildSwitcherPresentation } from "@/lib/member-presentation";
import { matchesMemberSearch, normalizeMemberSearchText } from "@/lib/notice-member-search";
import { noticePublisherRoles } from "@/lib/notice-permissions";
import { getCurrentMemberPayment } from "@/lib/payment-lifecycle";
import { memberStatusLabels, roleLabels } from "@/lib/roles";
import { userAdministrationInputLimits } from "@/lib/user-administration-input-policy";
import { useAppStore } from "@/store/app-store";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-blocks";
import { Button, PaymentStatusBadge, SectionHeader } from "@/components/ui/primitives";

const statusClasses: Record<MemberStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  trial: "border-teal-200 bg-teal-50 text-teal-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  withdrawn: "border-zinc-200 bg-zinc-50 text-zinc-600",
};
const memberStatusOptions: MemberStatus[] = ["active", "trial", "paused", "withdrawn"];
const memberGenderOptions: MemberGender[] = ["male", "female"];
const coachMembershipStatusLabels = {
  active: "회원권 활성",
  attention: "회원권 확인 필요",
  expiring: "회원권 만료 예정",
  inactive: "회원권 비활성",
  none: "등록된 회원권 없음",
} as const;
const coachMembershipStatusClasses = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  attention: "border-amber-200 bg-amber-50 text-amber-700",
  expiring: "border-amber-200 bg-amber-50 text-amber-700",
  inactive: "border-zinc-200 bg-zinc-50 text-zinc-600",
  none: "border-zinc-200 bg-zinc-50 text-zinc-600",
} as const;

function getInitialMemberStatusFilter(): MemberStatus | "all" {
  if (typeof window === "undefined") {
    return "all";
  }

  const value = new URLSearchParams(window.location.search).get("status");

  return (memberStatusOptions as string[]).includes(value ?? "") ? (value as MemberStatus) : "all";
}

function syncMemberStatusFilterToUrl(value: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (value) {
    url.searchParams.set("status", value);
  } else {
    url.searchParams.delete("status");
  }

  window.history.replaceState(window.history.state, "", url);
}
const ageGroupOptions: Array<{ value: Member["ageGroup"]; label: string }> = [
  { value: "kids", label: "유소년" },
  { value: "teen", label: "청소년" },
  { value: "adult", label: "성인" },
];
const ageGroupLabels = Object.fromEntries(ageGroupOptions.map((option) => [option.value, option.label])) as Record<
  Member["ageGroup"],
  string
>;
const inviteRoleOptions: UserRole[] = ["coach", "guardian", "member"];
const noteTypeOptions: Array<{ value: CounselingNote["noteType"]; label: string }> = [
  { value: "general", label: "일반" },
  { value: "caution", label: "주의" },
  { value: "progress", label: "성장" },
  { value: "follow_up", label: "후속 상담" },
];
const noteVisibilityOptions: Array<{ value: CounselingNoteVisibility; label: string }> = [
  { value: "coach_visible", label: "코치에게 공유" },
  { value: "guardian_visible", label: "학부모에게 공유" },
  { value: "member_visible", label: "회원에게 공유" },
  { value: "staff_only", label: "직원만" },
];
const noteTypeLabels = Object.fromEntries(noteTypeOptions.map((option) => [option.value, option.label])) as Record<
  CounselingNote["noteType"],
  string
>;
const noteVisibilityLabels = Object.fromEntries(
  noteVisibilityOptions.map((option) => [option.value, option.label]),
) as Record<CounselingNoteVisibility, string>;

type NoteDraft = {
  body: string;
  feedback?: string;
  noteType: CounselingNote["noteType"];
  visibility: CounselingNoteVisibility;
};

type NoteDialogState = {
  intent: "create" | "edit" | "delete";
  memberId: string;
  noteId?: string;
};

type GuardianLinkDraft = {
  feedback?: string;
  guardianSearch: string;
  guardianUserId: string;
};

type ProfileDraft = {
  ageGroup: Member["ageGroup"];
  address: string;
  alertsText: string;
  belt: string;
  birthDate: string;
  dirty?: boolean;
  emergencyContact: string;
  feedback?: string;
  gender: Member["gender"] | "";
  level: string;
  name: string;
  primaryCoachId: string;
  sourceMemberSignature: string;
};

function getTitle(role: string) {
  if (role === "member") {
    return "내 프로필";
  }

  if (role === "guardian") {
    return "가족 회원";
  }

  if (role === "coach") {
    return "담당 회원";
  }

  return "회원 관리";
}

function createEmptyNoteDraft(role: UserRole): NoteDraft {
  return {
    body: "",
    noteType: "general",
    visibility: role === "coach" ? "coach_visible" : "staff_only",
  };
}

function formatNoteDate(value: string) {
  return formatDateTime(value);
}

function getProfileMemberSignature(member: Member) {
  return [
    member.name,
    member.ageGroup,
    member.belt,
    member.level,
    member.gender ?? "",
    member.birthDate ?? "",
    member.address ?? "",
    member.emergencyContact,
    member.primaryCoachId,
    member.alerts.join("\n"),
  ].join("\u001f");
}

function profileDraftTouchesEditableField(patch: Partial<ProfileDraft>) {
  return ["ageGroup", "address", "alertsText", "belt", "birthDate", "emergencyContact", "gender", "level", "name", "primaryCoachId"].some((key) =>
    Object.prototype.hasOwnProperty.call(patch, key),
  );
}

// 관리자 뷰에서는 회원 상세를 오버레이 창(다이얼로그)으로, 가족·코치 뷰에서는 기존처럼 인라인으로 보여준다.
function MemberDetailContainer({
  inline,
  member,
  statusBadge,
  onClose,
  children,
}: {
  inline: boolean;
  member: Member;
  statusBadge: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (inline) {
      return;
    }

    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog.open) {
      dialog.showModal();
    }

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);

      if (dialog.open) {
        dialog.close();
      }

      const returnTarget = returnFocusRef.current?.isConnected
        ? returnFocusRef.current
        : document.querySelector<HTMLElement>(`[data-testid="member-detail-toggle-${member.id}"]`);

      window.requestAnimationFrame(() => returnTarget?.focus());
    };
  }, [inline, member.id]);

  if (inline) {
    return <>{children}</>;
  }

  return (
    <dialog
      aria-labelledby={`member-detail-title-${member.id}`}
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-zinc-950/40 open:flex open:items-end open:justify-center sm:open:items-center sm:p-6"
      data-testid={`member-detail-dialog-${member.id}`}
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") {
          return;
        }

        const focusableElements = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = focusableElements[0];
        const last = focusableElements.at(-1);

        if (!first || !last) {
          event.preventDefault();
          closeButtonRef.current?.focus();
          return;
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <UserRound className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <h2 className="block truncate text-base font-semibold text-zinc-950" id={`member-detail-title-${member.id}`}>
                {member.name} 상세 정보
              </h2>
              <span className="block text-xs text-zinc-500">
                {member.belt} · {member.level}
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {statusBadge}
            <button
              aria-label="상세 닫기"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
              data-testid={`member-detail-close-${member.id}`}
              ref={closeButtonRef}
              type="button"
              onClick={() => onCloseRef.current()}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-4 pb-6">{children}</div>
      </div>
    </dialog>
  );
}

function MemberFormDialog({
  children,
  description,
  icon,
  labelId,
  onClose,
  testId,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: ReactNode;
  labelId: string;
  onClose: () => void;
  testId: string;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);

      if (dialog.open) {
        dialog.close();
      }

      window.requestAnimationFrame(() => returnFocusRef.current?.isConnected && returnFocusRef.current.focus());
    };
  }, []);

  return (
    <dialog
      aria-describedby={`${labelId}-description`}
      aria-labelledby={labelId}
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-zinc-950/40 open:flex open:items-end open:justify-center sm:open:items-center sm:p-6"
      data-testid={testId}
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              {icon}
            </span>
            <span className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-950" id={labelId}>{title}</h2>
              <p className="mt-1 text-sm leading-5 text-zinc-500" id={`${labelId}-description`}>{description}</p>
            </span>
          </div>
          <button
            aria-label={`${title} 창 닫기`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            ref={closeButtonRef}
            type="button"
            onClick={() => onCloseRef.current()}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </dialog>
  );
}

function CounselingNoteDialog({
  draft,
  intent,
  member,
  pending,
  role,
  onClose,
  onDelete,
  onDraftChange,
  onSubmit,
}: {
  draft: NoteDraft;
  intent: NoteDialogState["intent"];
  member: Member;
  pending: boolean;
  role: UserRole;
  onClose: () => void;
  onDelete: () => void;
  onDraftChange: (patch: Partial<NoteDraft>) => void;
  onSubmit: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog.open) {
      dialog.showModal();
    }

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);

      if (dialog.open) {
        dialog.close();
      }

      window.requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) {
          returnFocusRef.current.focus();
        }
      });
    };
  }, []);

  const title =
    intent === "create"
      ? `${member.name} 메모 작성`
      : intent === "edit"
        ? `${member.name} 메모 수정`
        : `${member.name} 메모 삭제`;

  return (
    <dialog
      aria-labelledby="counseling-note-dialog-title"
      className="fixed inset-0 z-[60] m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-zinc-950/45 open:flex open:items-end open:justify-center sm:open:items-center sm:p-6"
      data-testid={`member-note-dialog-${member.id}`}
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();

        if (!pending) {
          onCloseRef.current();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) {
          onCloseRef.current();
        }
      }}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-zinc-950" id="counseling-note-dialog-title">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {member.belt} · {member.level}
            </p>
          </div>
          <button
            aria-label="메모 창 닫기"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            disabled={pending}
            ref={closeButtonRef}
            type="button"
            onClick={() => onCloseRef.current()}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {intent === "delete" ? (
          <div className="overflow-y-auto px-4 py-5">
            <p className="text-sm leading-6 text-zinc-700">
              이 메모를 삭제하면 회원 카드에서 더 이상 확인할 수 없습니다.
            </p>
            <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{draft.body}</p>
            </div>
            <p className="mt-3 text-xs font-medium text-red-700" aria-live="polite" role="status">
              {draft.feedback ?? "삭제한 메모는 복구할 수 없습니다."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button disabled={pending} onClick={onClose}>
                취소
              </Button>
              <Button
                data-testid="member-note-delete-confirm"
                disabled={pending}
                variant="danger"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {pending ? "삭제 중" : "메모 삭제"}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="overflow-y-auto px-4 py-5"
            data-testid={`member-note-editor-${member.id}`}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-600">유형</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-note-field"
                  disabled={pending}
                  value={draft.noteType}
                  onChange={(event) =>
                    onDraftChange({ noteType: event.target.value as CounselingNote["noteType"], feedback: undefined })
                  }
                >
                  {noteTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-600">볼 수 있는 대상</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-note-field"
                  disabled={pending}
                  value={draft.visibility}
                  onChange={(event) =>
                    onDraftChange({ visibility: event.target.value as CounselingNoteVisibility, feedback: undefined })
                  }
                >
                  {noteVisibilityOptions
                    .filter((option) => role !== "coach" || option.value !== "staff_only")
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-semibold text-zinc-600">메모</span>
              <textarea
                autoFocus
                className="min-h-36 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="member-note-body"
                disabled={pending}
                maxLength={counselingNoteInputLimits.bodyLength}
                placeholder="상담 내용과 다음 확인 일정"
                value={draft.body}
                onChange={(event) => onDraftChange({ body: event.target.value, feedback: undefined })}
              />
            </label>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="min-h-5 text-xs font-medium text-zinc-500" aria-live="polite" role="status">
                {draft.feedback ?? "저장하면 선택한 대상이 볼 수 있습니다."}
              </p>
              <div className="ml-auto flex gap-2">
                <Button disabled={pending} onClick={onClose}>
                  취소
                </Button>
                <Button
                  data-testid="member-note-submit"
                  disabled={pending || !draft.body.trim()}
                  size="lg"
                  type="submit"
                  variant="primary"
                >
                  {pending ? "저장 중" : intent === "edit" ? "수정 저장" : "메모 저장"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

function CounselingNoteListDialog({
  authorNamesById,
  canManageNote,
  member,
  notes,
  role,
  onClose,
  onDelete,
  onEdit,
}: {
  authorNamesById: ReadonlyMap<string, string>;
  canManageNote: (note: CounselingNote) => boolean;
  member: Member;
  notes: CounselingNote[];
  role: UserRole;
  onClose: () => void;
  onDelete: (note: CounselingNote) => void;
  onEdit: (note: CounselingNote) => void;
}) {
  const isFamilyRole = role === "member" || role === "guardian";

  return (
    <MemberFormDialog
      description={`전체 ${notes.length}건`}
      icon={<Pencil className="h-5 w-5" aria-hidden />}
      labelId={`counseling-note-list-dialog-title-${member.id}`}
      testId={`member-note-list-dialog-${member.id}`}
      title={`${member.name} 최근 메모`}
      onClose={onClose}
    >
      <ul className="space-y-2" data-testid={`member-note-list-${member.id}`}>
        {notes.map((note) => {
          const noteManageable = canManageNote(note);

          return (
            <li
              className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
              data-testid={isFamilyRole ? "family-member-feedback-card" : "coach-member-note-card"}
              key={note.id}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-zinc-500">
                <span className="rounded-md bg-white px-2 py-1 text-zinc-700">
                  {noteTypeLabels[note.noteType]}
                </span>
                {!isFamilyRole ? (
                  <span className="rounded-md bg-white px-2 py-1 text-zinc-700">
                    {noteVisibilityLabels[note.visibility]}
                  </span>
                ) : null}
                <span>{formatNoteDate(note.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{note.body}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">
                  {isFamilyRole ? "코치" : "작성자"} {authorNamesById.get(note.authorUserId) ?? "작성자 확인 중"}
                  {note.updatedAt && note.updatedAt !== note.createdAt ? " · 수정됨" : ""}
                </p>
                {noteManageable ? (
                  <div className="flex gap-1">
                    <button
                      aria-label={`${member.name} 메모 수정`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-zinc-600 transition hover:bg-white hover:text-zinc-900"
                      data-testid={`member-note-edit-${note.id}`}
                      type="button"
                      onClick={() => onEdit(note)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                      수정
                    </button>
                    <button
                      aria-label={`${member.name} 메모 삭제`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                      data-testid={`member-note-delete-${note.id}`}
                      type="button"
                      onClick={() => onDelete(note)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      삭제
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </MemberFormDialog>
  );
}

export function MembersScreen() {
  const searchParams = useSearchParams();
  const context = useApiContext();
  const {
    createCounselingNote,
    createInvitation,
    createMember,
    deleteCounselingNote,
    deleteMember,
    linkGuardian,
    replaceGuardian,
    unlinkGuardian,
    updateCounselingNote,
    updateMemberProfile,
    updateMemberStatus,
  } = useAppStore();
  const [query, setQuery] = useUrlSyncedTextParam("q");
  const [statusFilter, setStatusFilterState] = useState<MemberStatus | "all">(getInitialMemberStatusFilter);
  const [memberSort, setMemberSort] = useState<"default" | "name" | "recent">("default");
  // 관리자 회원 카드는 기본 요약 상태로 접고, 탭하면 상세(상태 변경·정보 수정·보호자·메모)가 열린다.
  const [expandedMemberIds, setExpandedMemberIds] = useState<Set<string>>(() => new Set());

  function toggleMemberDetail(memberId: string) {
    setExpandedMemberIds((current) => {
      return current.has(memberId) ? new Set() : new Set([memberId]);
    });
  }

  function setStatusFilter(value: MemberStatus | "all") {
    setStatusFilterState(value);
    syncMemberStatusFilterToUrl(value === "all" ? null : value);
  }
  const guardianChildIds = useMemo(
    () =>
      context.user.role === "guardian"
        ? getGuardianFamilyMembers(context.user, context.db).map((member) => member.id)
        : undefined,
    [context.db, context.user],
  );
  const requestedMemberId = searchParams.get("memberId")?.trim() ?? "";
  const [selectedChildId, setSelectedChildId] = useFamilyMemberSelection(
    context.user.id,
    guardianChildIds,
    context.user.role === "guardian" ? requestedMemberId : null,
  );
  const [inviteBranchId, setInviteBranchId] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("coach");
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [newMemberBranchId, setNewMemberBranchId] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberStatus, setNewMemberStatus] = useState<MemberStatus>("active");
  const [newMemberAgeGroup, setNewMemberAgeGroup] = useState<Member["ageGroup"]>("kids");
  const [newMemberLevel, setNewMemberLevel] = useState("입문");
  const [newMemberBelt, setNewMemberBelt] = useState("흰띠");
  const [newMemberEmergencyContact, setNewMemberEmergencyContact] = useState("");
  const [newMemberGender, setNewMemberGender] = useState<Member["gender"] | "">("");
  const [newMemberBirthDate, setNewMemberBirthDate] = useState("");
  const [newMemberAddress, setNewMemberAddress] = useState("");
  const [memberCreateFormOpen, setMemberCreateFormOpen] = useState(false);
  const [memberDeleteId, setMemberDeleteId] = useState<string | null>(null);
  const [memberDeleteReason, setMemberDeleteReason] = useState("");
  const [memberDeleteFeedback, setMemberDeleteFeedback] = useState<string | null>(null);
  const [memberDeletePending, setMemberDeletePending] = useState(false);
  const [guardianLinkDrafts, setGuardianLinkDrafts] = useState<Record<string, GuardianLinkDraft>>({});
  const [noteDraft, setNoteDraft] = useState<NoteDraft>(() => createEmptyNoteDraft(context.user.role));
  const [noteDialog, setNoteDialog] = useState<NoteDialogState | null>(null);
  const [noteMutationPending, setNoteMutationPending] = useState(false);
  const [noteListMemberId, setNoteListMemberId] = useState<string | null>(null);
  const [coachMemberListExpanded, setCoachMemberListExpanded] = useState(false);
  const [profileDrafts, setProfileDrafts] = useState<Record<string, ProfileDraft>>({});
  const [editingContactMemberId, setEditingContactMemberId] = useState<string | null>(null);
  const { data, loading, error, reload } = useResource(
    () => apiClient.getMembers(context),
    [context.user.id, context.selectedBranchId, context.version],
  );
  const canManageMembers = context.user.role === "owner" || context.user.role === "admin";
  const canInviteUsers = context.user.role === "owner" || context.user.role === "admin";
  const canCreateNotes = ["coach", "owner", "admin"].includes(context.user.role);
  const isCoachRole = context.user.role === "coach";
  const isFamilyRole = context.user.role === "member" || context.user.role === "guardian";
  const canEditOwnContact = isFamilyRole;
  const showMembersScreenHeader = !isFamilyRole;
  const selectedInviteBranchId = inviteBranchId || context.selectedBranchId || context.db.branches[0]?.id || "";
  const selectedCreateBranchId = newMemberBranchId || context.selectedBranchId || context.db.branches[0]?.id || "";
  const showMemberBranchIdentity = canManageMembers && !context.selectedBranchId && context.db.branches.length > 1;

  useEffect(() => {
    if (
      context.user.role !== "guardian" ||
      !requestedMemberId ||
      !guardianChildIds?.includes(requestedMemberId) ||
      selectedChildId === requestedMemberId
    ) {
      return;
    }

    setSelectedChildId(requestedMemberId);
  }, [context.user.role, guardianChildIds, requestedMemberId, selectedChildId, setSelectedChildId]);

  useEffect(() => {
    if (!canManageMembers || new URLSearchParams(window.location.search).get("create") !== "1") {
      return;
    }

    const revealTimer = window.setTimeout(() => {
      setMemberCreateFormOpen(true);
    }, 0);

    return () => window.clearTimeout(revealTimer);
  }, [canManageMembers]);

  const guardianChildId = context.user.role === "guardian" ? selectedChildId || data?.[0]?.id || null : null;
  const childSwitcherItems = useMemo(
    () =>
      context.user.role === "guardian"
        ? (data ?? []).map((member) => ({
          id: member.id,
          name: member.name,
          relationLabel: getFamilyMemberRelationLabel(getGuardianMemberRelation(context.user, member)),
          ...getChildSwitcherPresentation(member),
          }))
        : [],
    [context.user, data],
  );
  const authorNamesById = useMemo(
    () => new Map(context.db.users.map((user) => [user.id, user.name])),
    [context.db.users],
  );
  const branchNamesById = useMemo(
    () => new Map(context.db.branches.map((branch) => [branch.id, branch.name])),
    [context.db.branches],
  );
  const guardianUsers = useMemo(
    () => context.db.users.filter((user) => user.role === "guardian" && user.invitationStatus !== "pending"),
    [context.db.users],
  );
  const usersById = useMemo(
    () => new Map(context.db.users.map((user) => [user.id, user])),
    [context.db.users],
  );
  const notesByMemberId = useMemo(() => {
    const grouped = new Map<string, CounselingNote[]>();

    for (const note of context.db.counselingNotes ?? []) {
      const notes = grouped.get(note.memberId) ?? [];

      notes.push(note);
      grouped.set(note.memberId, notes);
    }

    grouped.forEach((notes) =>
      notes.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    );

    return grouped;
  }, [context.db.counselingNotes]);
  const currentPaymentByMemberId = useMemo(() => {
    const grouped = new Map<string, Payment[]>();

    if (context.user.role === "coach") {
      return new Map<string, Payment>();
    }

    for (const payment of context.db.payments) {
      const memberPayments = grouped.get(payment.memberId) ?? [];

      memberPayments.push(payment);
      grouped.set(payment.memberId, memberPayments);
    }

    return new Map(
      [...grouped.entries()].flatMap(([memberId, payments]) => {
        const currentPayment = getCurrentMemberPayment(payments);

        return currentPayment ? [[memberId, currentPayment] as const] : [];
      }),
    );
  }, [context.db.payments, context.user.role]);

  const filteredMembers = useMemo(() => {
    const keyword = query.trim();
    const scopedData = context.user.role === "guardian" && guardianChildId
      ? (data ?? []).filter((member) => member.id === guardianChildId)
      : data;
    const statusScoped =
      statusFilter === "all"
        ? (scopedData ?? [])
        : (scopedData ?? []).filter((member) => member.status === statusFilter);
    const searched = keyword
      ? statusScoped.filter((member) =>
          matchesMemberSearch(keyword, [member.name, member.level, member.belt, member.emergencyContact]),
        )
      : statusScoped;

    if (memberSort === "name") {
      return [...searched].sort((left, right) => left.name.localeCompare(right.name, "ko"));
    }

    if (memberSort === "recent") {
      return [...searched].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
    }

    return searched;
  }, [context.user.role, data, guardianChildId, memberSort, query, statusFilter]);

  useEffect(() => {
    if (!canEditOwnContact || !data?.length) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const shouldOpenContactForm = params.get("contact") === "1" || window.location.hash === "#edit-contact";

    if (!shouldOpenContactForm) {
      return;
    }

    const requestedMemberId = params.get("memberId");
    const targetMember =
      data.find((member) => member.id === requestedMemberId) ??
      (guardianChildId ? data.find((member) => member.id === guardianChildId) : null) ??
      data[0];

    if (!targetMember) {
      return;
    }

    const openHandle = window.setTimeout(() => setEditingContactMemberId(targetMember.id), 0);

    return () => window.clearTimeout(openHandle);
  }, [canEditOwnContact, data, guardianChildId]);

  async function handleCreateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedCreateBranchId || !newMemberName.trim() || !newMemberEmergencyContact.trim()) {
      return;
    }

    const created = await createMember(selectedCreateBranchId, {
      name: newMemberName.trim(),
      status: newMemberStatus,
      ageGroup: newMemberAgeGroup,
      level: newMemberLevel.trim() || "입문",
      belt: newMemberBelt.trim() || "흰띠",
      emergencyContact: newMemberEmergencyContact.trim(),
      gender: newMemberGender,
      birthDate: newMemberBirthDate.trim(),
      address: newMemberAddress.trim(),
    });

    if (!created) {
      return;
    }

    setNewMemberName("");
    setNewMemberEmergencyContact("");
    setNewMemberGender("");
    setNewMemberBirthDate("");
    setNewMemberAddress("");
    setMemberCreateFormOpen(false);
  }

  function openMemberDeleteDialog(memberId: string) {
    setMemberDeleteId(memberId);
    setMemberDeleteReason("");
    setMemberDeleteFeedback(null);
  }

  function closeMemberDeleteDialog() {
    if (memberDeletePending) {
      return;
    }

    setMemberDeleteId(null);
    setMemberDeleteReason("");
    setMemberDeleteFeedback(null);
  }

  async function handleDeleteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!memberDeleteId || !memberDeleteReason.trim()) {
      setMemberDeleteFeedback("삭제 사유를 입력해 주세요.");
      return;
    }

    setMemberDeletePending(true);
    const deleted = await deleteMember(memberDeleteId, { reason: memberDeleteReason.trim() });
    setMemberDeletePending(false);

    if (!deleted) {
      setMemberDeleteFeedback("회원과 연결 데이터를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    setExpandedMemberIds(new Set());
    setMemberDeleteId(null);
    setMemberDeleteReason("");
    setMemberDeleteFeedback(null);
  }

  async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedInviteBranchId || !inviteName.trim() || !invitePhone.trim()) {
      setInviteFeedback("이름, 휴대폰 번호, 지점을 확인해 주세요.");
      return;
    }

    const path = await createInvitation({
      name: inviteName.trim(),
      email: inviteEmail.trim() || undefined,
      phone: invitePhone.trim(),
      role: inviteRole,
      branchIds: [selectedInviteBranchId],
    });

    if (!path) {
      setInviteFeedback("초대를 생성하지 못했습니다. 휴대폰 번호 중복 또는 선택 지점을 확인해 주세요.");
      return;
    }

    setInviteFeedback("초대 링크를 생성했습니다.");
    setInvitePath(path);
    setInviteName("");
    setInviteEmail("");
    setInvitePhone("");
  }

  async function handleCopyInvitationLink() {
    if (!invitePath) {
      return;
    }

    const link = new URL(invitePath, window.location.origin).toString();

    try {
      await navigator.clipboard.writeText(link);
      setInviteFeedback(invitationLinkCopySuccessMessage);
    } catch {
      setInviteFeedback(invitationLinkCopyFallbackMessage);
    }
  }

  function updateNoteDraft(patch: Partial<NoteDraft>) {
    setNoteDraft((current) => ({
      ...current,
      ...patch,
    }));
  }

  function openCreateNoteDialog(member: Member) {
    setNoteDraft(createEmptyNoteDraft(context.user.role));
    setNoteDialog({ intent: "create", memberId: member.id });
  }

  function openEditNoteDialog(member: Member, note: CounselingNote) {
    setNoteDraft({
      body: note.body,
      noteType: note.noteType,
      visibility: note.visibility,
    });
    setNoteDialog({ intent: "edit", memberId: member.id, noteId: note.id });
  }

  function openDeleteNoteDialog(member: Member, note: CounselingNote) {
    setNoteDraft({
      body: note.body,
      noteType: note.noteType,
      visibility: note.visibility,
    });
    setNoteDialog({ intent: "delete", memberId: member.id, noteId: note.id });
  }

  function closeNoteDialog() {
    if (!noteMutationPending) {
      setNoteDialog(null);
    }
  }

  function openNoteListDialog(memberId: string) {
    setNoteListMemberId(memberId);
  }

  function closeNoteListDialog() {
    setNoteListMemberId(null);
  }

  function openEditNoteFromList(member: Member, note: CounselingNote) {
    closeNoteListDialog();
    openEditNoteDialog(member, note);
  }

  function openDeleteNoteFromList(member: Member, note: CounselingNote) {
    closeNoteListDialog();
    openDeleteNoteDialog(member, note);
  }

  function getAvailableGuardians(member: Member) {
    if (!canMemberHaveGuardianLink(member)) {
      return [];
    }

    return guardianUsers.filter((guardian) => !member.guardianIds.includes(guardian.id));
  }

  function getGuardianLinkDraft(member: Member) {
    const availableGuardians = getAvailableGuardians(member);
    const draft = guardianLinkDrafts[member.id];

    if (!draft) {
      return {
        guardianSearch: "",
        guardianUserId: "",
      };
    }

    return {
      ...draft,
      guardianUserId: availableGuardians.some((guardian) => guardian.id === draft.guardianUserId)
        ? draft.guardianUserId
        : "",
    };
  }

  function getGuardianSearchResults(member: Member) {
    const draft = getGuardianLinkDraft(member);
    const normalizedSearch = normalizeMemberSearchText(draft.guardianSearch);

    if (!normalizedSearch) {
      return [];
    }

    return getAvailableGuardians(member)
      .filter((guardian) => matchesMemberSearch(draft.guardianSearch, [guardian.name, guardian.phone, guardian.email, guardian.title]))
      .slice(0, 8);
  }

  function updateGuardianLinkDraft(member: Member, patch: Partial<GuardianLinkDraft>) {
    setGuardianLinkDrafts((current) => ({
      ...current,
      [member.id]: {
        ...(current[member.id] ?? {
          guardianSearch: "",
          guardianUserId: "",
        }),
        ...patch,
      },
    }));
  }

  function createProfileDraft(member: Member): ProfileDraft {
    return {
      ageGroup: member.ageGroup,
      address: member.address ?? "",
      alertsText: member.alerts.join("\n"),
      belt: member.belt,
      birthDate: member.birthDate ?? "",
      dirty: false,
      emergencyContact: formatPhoneNumber(member.emergencyContact),
      gender: member.gender ?? "",
      level: member.level,
      name: member.name,
      primaryCoachId: member.primaryCoachId,
      sourceMemberSignature: getProfileMemberSignature(member),
    };
  }

  function getProfileDraft(member: Member) {
    const draft = profileDrafts[member.id];

    if (!draft) {
      return createProfileDraft(member);
    }

    const sourceMemberSignature = getProfileMemberSignature(member);

    if (!draft.dirty && draft.sourceMemberSignature !== sourceMemberSignature) {
      return {
        ...createProfileDraft(member),
        feedback: draft.feedback,
      };
    }

    return draft;
  }

  function updateProfileDraft(member: Member, patch: Partial<ProfileDraft>) {
    setProfileDrafts((current) => {
      const baseDraft = createProfileDraft(member);
      const currentDraft = current[member.id];
      const syncedCurrentDraft =
        currentDraft && !currentDraft.dirty && currentDraft.sourceMemberSignature !== baseDraft.sourceMemberSignature
          ? {
              ...baseDraft,
              feedback: currentDraft.feedback,
            }
          : currentDraft;

      return {
        ...current,
        [member.id]: {
          ...baseDraft,
          ...syncedCurrentDraft,
          ...patch,
          dirty:
            patch.dirty ??
            (profileDraftTouchesEditableField(patch)
              ? true
              : syncedCurrentDraft?.dirty ?? false),
        },
      };
    });
  }

  async function handleUpdateMemberProfile(event: FormEvent<HTMLFormElement>, member: Member) {
    event.preventDefault();

    const draft = getProfileDraft(member);
    const emergencyContact = draft.emergencyContact.trim();
    const memberName = draft.name.trim();

    if (!emergencyContact) {
      updateProfileDraft(member, { feedback: "긴급 연락처를 입력해 주세요." });
      return;
    }

    if (canManageMembers && !memberName) {
      updateProfileDraft(member, { feedback: "회원 이름을 입력해 주세요." });
      return;
    }

    const nextAlerts = draft.alertsText
      .split("\n")
      .map((alert) => alert.trim())
      .filter(Boolean);
    const saved = await updateMemberProfile(member.id, canManageMembers
      ? {
          alerts: nextAlerts,
          ageGroup: draft.ageGroup,
          address: draft.address.trim(),
          belt: draft.belt.trim(),
          birthDate: draft.birthDate.trim(),
          emergencyContact,
          gender: draft.gender,
          level: draft.level.trim(),
          name: memberName,
          primaryCoachId: draft.primaryCoachId,
        }
      : { emergencyContact });

    updateProfileDraft(member, {
      ...(saved
        ? {
            ageGroup: draft.ageGroup,
            address: draft.address.trim(),
            alertsText: nextAlerts.join("\n"),
            belt: draft.belt.trim(),
            birthDate: draft.birthDate.trim(),
            emergencyContact,
            gender: draft.gender,
            level: draft.level.trim(),
            name: canManageMembers ? memberName : draft.name,
            primaryCoachId: draft.primaryCoachId,
          }
        : {}),
      feedback: saved ? "회원 기본 정보를 저장했습니다." : "회원 기본 정보를 저장하지 못했습니다.",
      ...(saved ? { dirty: false } : {}),
    });
  }

  async function handleLinkGuardian(event: FormEvent<HTMLFormElement>, member: Member) {
    event.preventDefault();

    const draft = getGuardianLinkDraft(member);

    if (!draft.guardianUserId) {
      updateGuardianLinkDraft(member, { feedback: "학부모를 검색해서 선택해 주세요." });
      return;
    }

    const linked =
      member.guardianIds.length > 0
        ? member.guardianIds.includes(draft.guardianUserId) ||
          (await replaceGuardian(member.id, { guardianUserId: draft.guardianUserId }))
        : await linkGuardian(member.id, { guardianUserId: draft.guardianUserId });

    updateGuardianLinkDraft(member, {
      feedback: linked
        ? member.guardianIds.length > 0
          ? "보호자 연결을 변경했습니다."
          : "보호자 연결을 저장했습니다."
        : member.guardianIds.length > 0
          ? "보호자 연결을 변경하지 못했습니다."
          : "보호자 연결을 저장하지 못했습니다.",
      guardianSearch: "",
      guardianUserId: "",
    });
  }

  async function handleUnlinkGuardian(member: Member, guardianUserId: string) {
    const unlinked = await unlinkGuardian(member.id, { guardianUserId });

    updateGuardianLinkDraft(member, {
      feedback: unlinked ? "보호자 연결을 해제했습니다." : "보호자 연결을 해제하지 못했습니다.",
      guardianSearch: "",
      guardianUserId: "",
    });
  }

  async function handleSaveCounselingNote() {
    if (!noteDialog || noteDialog.intent === "delete") {
      return;
    }

    const member = data?.find((candidate) => candidate.id === noteDialog.memberId);

    if (!member) {
      updateNoteDraft({ feedback: "회원 정보를 다시 불러온 뒤 시도해 주세요." });
      return;
    }

    if (!noteDraft.body.trim()) {
      updateNoteDraft({ feedback: "메모 내용을 입력해 주세요." });
      return;
    }

    setNoteMutationPending(true);

    const saved =
      noteDialog.intent === "edit" && noteDialog.noteId
        ? await updateCounselingNote(member.branchId, member.id, noteDialog.noteId, {
            body: noteDraft.body.trim(),
            noteType: noteDraft.noteType,
            visibility: noteDraft.visibility,
          })
        : await createCounselingNote(member.branchId, member.id, {
            body: noteDraft.body.trim(),
            noteType: noteDraft.noteType,
            visibility: noteDraft.visibility,
          });

    setNoteMutationPending(false);

    if (saved) {
      setNoteDialog(null);
      return;
    }

    updateNoteDraft({ feedback: "메모를 저장하지 못했습니다. 다시 시도해 주세요." });
  }

  async function handleDeleteCounselingNote() {
    if (!noteDialog?.noteId || noteDialog.intent !== "delete") {
      return;
    }

    const member = data?.find((candidate) => candidate.id === noteDialog.memberId);

    if (!member) {
      updateNoteDraft({ feedback: "회원 정보를 다시 불러온 뒤 시도해 주세요." });
      return;
    }

    setNoteMutationPending(true);
    const deleted = await deleteCounselingNote(member.branchId, member.id, noteDialog.noteId);
    setNoteMutationPending(false);

    if (deleted) {
      setNoteDialog(null);
      return;
    }

    updateNoteDraft({ feedback: "메모를 삭제하지 못했습니다. 다시 시도해 주세요." });
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState description={error ?? "회원 정보를 불러오지 못했습니다."} onRetry={reload} />;
  }

  const noteDialogMember = noteDialog
    ? data.find((member) => member.id === noteDialog.memberId) ?? null
    : null;
  const noteListMember = noteListMemberId
    ? data.find((member) => member.id === noteListMemberId) ?? null
    : null;
  const noteListNotes = noteListMember
    ? (notesByMemberId.get(noteListMember.id) ?? []).filter((note) => canReadCounselingNote(context.user, note))
    : [];
  const memberDeleteTarget = memberDeleteId
    ? data.find((member) => member.id === memberDeleteId) ?? null
    : null;
  const coachMemberMobileVisibleLimit = 1;
  const coachMemberListCollapsible = isCoachRole && !query.trim() && filteredMembers.length > coachMemberMobileVisibleLimit;
  const hiddenCoachMemberCount = coachMemberListCollapsible ? filteredMembers.length - coachMemberMobileVisibleLimit : 0;

  return (
    <div>
      {showMembersScreenHeader ? (
        <SectionHeader
          title={getTitle(context.user.role)}
          action={
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">회원 검색</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-12 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="member-search-input"
                placeholder="이름, 레벨, 연락처 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button
                  aria-label="검색어 지우기"
                  className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                  data-testid="member-search-clear"
                  type="button"
                  onClick={() => setQuery("")}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </label>
          }
        />
      ) : null}

      {context.user.role === "guardian" ? (
        <ChildSwitcher
          items={childSwitcherItems}
          selectedChildId={guardianChildId}
          onSelect={setSelectedChildId}
        />
      ) : null}

      {showMembersScreenHeader && (data?.length ?? 0) > 0 ? (
        <div aria-label="회원 상태 필터" className="mb-2 flex flex-wrap gap-1.5" role="group">
          {(
            [
              { label: "전체", value: "all" as const, count: data?.length ?? 0 },
              ...memberStatusOptions.map((status) => ({
                label: memberStatusLabels[status],
                value: status,
                count: (data ?? []).filter((member) => member.status === status).length,
              })),
            ]
          )
            .filter((option) => option.value === "all" || option.count > 0)
            .map((option) => {
              const selected = statusFilter === option.value;
              return (
                <button
                  aria-pressed={selected}
                  className={`inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-xs font-semibold transition ${
                    selected
                      ? "border-teal-600 bg-teal-600 text-white"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                  }`}
                  data-testid={`member-status-filter-${option.value}`}
                  key={option.value}
                  type="button"
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                  <span className={`tabular-nums ${selected ? "text-teal-100" : "text-zinc-400"}`}>{option.count}</span>
                </button>
              );
            })}
          {canManageMembers ? (
            <label className="ml-auto inline-flex min-h-11 items-center">
              <span className="sr-only">회원 정렬</span>
              <select
                className="h-11 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-700 outline-none transition focus:border-teal-500"
                data-testid="member-sort-select"
                value={memberSort}
                onChange={(event) => setMemberSort(event.target.value as "default" | "name" | "recent")}
              >
                <option value="default">기본 순서</option>
                <option value="name">이름순</option>
                <option value="recent">최근 등록순</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {canInviteUsers ? (
        <section className="mb-3 rounded-lg border border-zinc-200 bg-white p-3" data-testid="member-invite-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <UserPlus className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <h2 className="min-w-0 truncate text-base font-semibold text-zinc-950">계정 초대</h2>
            </div>
            <Button
              aria-controls="member-invite-form"
              aria-haspopup="dialog"
              data-testid="member-invite-toggle"
              size="lg"
              type="button"
              variant="secondary"
              onClick={() => setInviteFormOpen(true)}
            >
              열기
            </Button>
          </div>
        </section>
      ) : null}

      {canInviteUsers && inviteFormOpen ? (
        <MemberFormDialog
          description="역할과 지점을 선택한 뒤 로그인에 사용할 초대 링크를 발급합니다."
          icon={<UserPlus className="h-5 w-5" aria-hidden />}
          labelId="member-invite-dialog-title"
          testId="member-invite-dialog"
          title="계정 초대"
          onClose={() => setInviteFormOpen(false)}
        >
            <form
              className="grid gap-3 sm:grid-cols-2"
              id="member-invite-form"
              onSubmit={(event) => void handleCreateInvitation(event)}
            >
              {context.db.branches.length > 1 ? (
                <label>
                  <span className="mb-1 block text-xs font-semibold text-zinc-500">지점</span>
                  <select
                    className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                    data-testid="member-invite-field"
                    value={selectedInviteBranchId}
                    onChange={(event) => setInviteBranchId(event.target.value)}
                  >
                    {context.db.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">이름</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="member-invite-field"
                  maxLength={userAdministrationInputLimits.nameLength}
                  placeholder="초대 이름"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">휴대폰 번호</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="member-invite-field"
                  inputMode="tel"
                  maxLength={userAdministrationInputLimits.phoneLength}
                  placeholder="휴대폰 번호 입력"
                  type="tel"
                  value={invitePhone}
                  onChange={(event) => setInvitePhone(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">이메일(선택)</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="member-invite-field"
                  maxLength={userAdministrationInputLimits.emailLength}
                  placeholder="연락 이메일"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">역할</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-invite-field"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as UserRole)}
                >
                  {inviteRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                className="self-end sm:col-span-2"
                data-testid="member-invite-submit"
                disabled={!selectedInviteBranchId || !inviteName.trim() || !invitePhone.trim()}
                size="lg"
                type="submit"
                variant="primary"
              >
                초대
              </Button>
              {inviteFeedback ? (
                <p className="text-sm font-medium text-zinc-700 sm:col-span-2" data-testid="member-invite-feedback" aria-live="polite" role="status">
                  {inviteFeedback}
                </p>
              ) : null}
              {invitePath ? (
                <div className="flex flex-col gap-2 rounded-md border border-teal-200 bg-teal-50 p-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-teal-900">초대 링크가 준비됐습니다.</p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-100"
                      href={invitePath}
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      초대 링크 열기
                    </a>
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800"
                      type="button"
                      onClick={() => void handleCopyInvitationLink()}
                    >
                      <Copy className="h-4 w-4" aria-hidden />
                      링크 복사
                    </button>
                  </div>
                </div>
              ) : null}
            </form>
        </MemberFormDialog>
      ) : null}

      {canManageMembers ? (
        <section
          className="mb-4 scroll-mt-24 rounded-lg border border-zinc-200 bg-white p-3"
          data-testid="member-create-panel"
          id="member-create-panel"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <PlusCircle className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <h2 className="min-w-0 truncate text-base font-semibold text-zinc-950">회원 등록</h2>
            </div>
            <Button
              aria-controls="member-create-form"
              aria-haspopup="dialog"
              data-testid="member-create-toggle"
              size="lg"
              type="button"
              variant="secondary"
              onClick={() => setMemberCreateFormOpen(true)}
            >
              열기
            </Button>
          </div>
        </section>
      ) : null}

      {canManageMembers && memberCreateFormOpen ? (
        <MemberFormDialog
          description="기본 수련 정보와 연락처를 입력해 회원 프로필을 등록합니다."
          icon={<PlusCircle className="h-5 w-5" aria-hidden />}
          labelId="member-create-dialog-title"
          testId="member-create-dialog"
          title="회원 등록"
          onClose={() => setMemberCreateFormOpen(false)}
        >
            <form
              className="grid gap-3 sm:grid-cols-2"
              id="member-create-form"
              onSubmit={(event) => void handleCreateMember(event)}
            >
              {context.db.branches.length > 1 ? (
                <label>
                  <span className="mb-1 block text-xs font-semibold text-zinc-500">지점</span>
                  <select
                    className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                    data-testid="member-create-field"
                    value={selectedCreateBranchId}
                    onChange={(event) => setNewMemberBranchId(event.target.value)}
                  >
                    {context.db.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">이름</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="member-create-field"
                  maxLength={memberInputLimits.nameLength}
                  placeholder="회원명"
                  value={newMemberName}
                  onChange={(event) => setNewMemberName(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">연령</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-create-field"
                  value={newMemberAgeGroup}
                  onChange={(event) => setNewMemberAgeGroup(event.target.value as Member["ageGroup"])}
                >
                  {ageGroupOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">상태</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-create-field"
                  value={newMemberStatus}
                  onChange={(event) => setNewMemberStatus(event.target.value as MemberStatus)}
                >
                  {memberStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {memberStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">레벨</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-create-field"
                  maxLength={memberInputLimits.levelLength}
                  value={newMemberLevel}
                  onChange={(event) => setNewMemberLevel(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">띠</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-create-field"
                  maxLength={memberInputLimits.beltLength}
                  value={newMemberBelt}
                  onChange={(event) => setNewMemberBelt(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">연락처</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="member-create-field"
                  maxLength={memberInputLimits.emergencyContactLength}
                  placeholder="연락 가능한 번호"
                  value={newMemberEmergencyContact}
                  onChange={(event) => setNewMemberEmergencyContact(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">성별 (선택)</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-create-field"
                  value={newMemberGender}
                  onChange={(event) => setNewMemberGender(event.target.value as Member["gender"] | "")}
                >
                  <option value="">선택 안함</option>
                  {memberGenderOptions.map((gender) => (
                    <option key={gender} value={gender}>
                      {memberGenderLabels[gender]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">생년월일 (선택)</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-create-field"
                  max={formatDateKey(new Date())}
                  type="date"
                  value={newMemberBirthDate}
                  onChange={(event) => setNewMemberBirthDate(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">주소 (선택)</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="member-create-field"
                  maxLength={memberInputLimits.addressLength}
                  placeholder="도로명 주소"
                  value={newMemberAddress}
                  onChange={(event) => setNewMemberAddress(event.target.value)}
                />
              </label>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
                data-testid="member-create-submit"
                disabled={!selectedCreateBranchId || !newMemberName.trim() || !newMemberEmergencyContact.trim()}
                type="submit"
              >
                등록
              </button>
            </form>
        </MemberFormDialog>
      ) : null}

      {filteredMembers.length === 0 ? (
        <EmptyState
          title={
            query
              ? "검색 결과가 없습니다"
              : statusFilter !== "all"
                ? `${memberStatusLabels[statusFilter]} 상태 회원이 없습니다`
                : context.user.role === "guardian"
                  ? "연결된 수련 프로필이 없습니다"
                  : "표시할 회원이 없습니다"
          }
          description={
            query
              ? "검색어를 지우거나 다시 찾아보세요."
              : statusFilter !== "all"
                ? "상태 필터를 전체로 바꾸면 모든 회원이 표시됩니다."
                : context.user.role === "guardian"
                  ? "운영자에게 본인 수련 회원과 자녀 프로필 연결을 요청해 주세요."
                  : undefined
          }
        />
      ) : (
        <>
        {hiddenCoachMemberCount > 0 ? (
          <button
            aria-expanded={coachMemberListExpanded}
            className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 lg:hidden"
            data-testid="coach-member-list-toggle"
            type="button"
            onClick={() => setCoachMemberListExpanded((current) => !current)}
          >
            {coachMemberListExpanded ? "담당 회원 접기" : `담당 회원 ${hiddenCoachMemberCount}명 더 보기`}
          </button>
        ) : null}
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredMembers.map((member, memberIndex) => {
            const showProfileForm = canManageMembers || editingContactMemberId === member.id;
            const memberNotes = (notesByMemberId.get(member.id) ?? []).filter(
              (note) => !isFamilyRole || canReadCounselingNote(context.user, note),
            );
            const latestMemberNote = memberNotes[0];
            const visibleMemberNotes = isCoachRole ? [] : memberNotes.slice(0, 3);
            const showAlertSection = !isFamilyRole && member.alerts.length > 0;
            const showCoachNoteListToggle = isCoachRole && memberNotes.length > 0;
            const coachMemberCollapsedOnMobile =
              coachMemberListCollapsible && !coachMemberListExpanded && memberIndex >= coachMemberMobileVisibleLimit;
            const guardianLinkDraft = getGuardianLinkDraft(member);
            const guardianSearchResults = getGuardianSearchResults(member);
            // 관리자 뷰만 접힘/펼침을 적용하고, 가족·코치 뷰는 기존 그대로 항상 펼친다.
            const memberDetailExpanded = !canManageMembers || expandedMemberIds.has(member.id);
            const selectedGuardian =
              guardianUsers.find((guardian) => guardian.id === guardianLinkDraft.guardianUserId) ?? null;
            const currentPayment = currentPaymentByMemberId.get(member.id) ?? null;
            const assignedOperator = usersById.get(member.primaryCoachId) ?? null;
            const assignableCoaches = context.db.users.filter(
              (candidate) =>
                candidate.role === "coach" &&
                candidate.invitationStatus !== "pending" &&
                candidate.branchIds.includes(member.branchId),
            );
            const canOpenPaymentHistory =
              Boolean(currentPayment) && (context.user.role !== "guardian" || member.status !== "withdrawn");

            return (
            <article
              className={`min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white ${isCoachRole ? "p-2.5 sm:p-4" : "p-4"} ${
                coachMemberCollapsedOnMobile ? "hidden lg:block" : ""
              }`}
              data-coach-member-mobile-state={isCoachRole ? (coachMemberCollapsedOnMobile ? "hidden" : "visible") : undefined}
              data-member-id={member.id}
              data-testid={isFamilyRole ? "family-member-profile-card" : isCoachRole ? "coach-member-profile-card" : undefined}
              key={member.id}
            >
              {canManageMembers ? (
                <button
                  aria-controls={`member-detail-${member.id}`}
                  aria-expanded={memberDetailExpanded}
                  className="-m-1 flex w-full items-start justify-between gap-3 rounded-md p-1 text-left transition hover:bg-zinc-50"
                  data-testid={`member-detail-toggle-${member.id}`}
                  type="button"
                  onClick={() => toggleMemberDetail(member.id)}
                >
                  <span className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                      <UserRound className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-zinc-950">{member.name}</span>
                      <span className="mt-1 block text-sm text-zinc-600">
                        {member.belt} · {member.level}
                      </span>
                      {showMemberBranchIdentity ? (
                        <span
                          className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700"
                          data-testid={`member-branch-identity-${member.id}`}
                        >
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                          <span className="truncate">{branchNamesById.get(member.branchId) ?? "지점 미지정"}</span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClasses[member.status]}`}>
                      {memberStatusLabels[member.status]}
                    </span>
                    <span className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold text-zinc-600">
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      수정
                    </span>
                  </span>
                </button>
              ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    <UserRound className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    {isFamilyRole ? (
                      <h1 className="truncate text-base font-semibold text-zinc-950">{member.name}</h1>
                    ) : (
                      <h2 className="truncate text-base font-semibold text-zinc-950">{member.name}</h2>
                    )}
                    <p className="mt-1 text-sm text-zinc-600">
                      {member.belt} · {member.level}
                    </p>
	                  {isCoachRole ? (
	                    <div
	                      className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-zinc-600"
	                      data-testid={`coach-member-membership-summary-${member.id}`}
	                    >
	                      <span
	                        className={`inline-flex rounded-md border px-2 py-1 font-semibold ${coachMembershipStatusClasses[member.membershipSummary?.status ?? "none"]}`}
	                      >
	                        {coachMembershipStatusLabels[member.membershipSummary?.status ?? "none"]}
	                      </span>
	                      <span className="truncate">
	                        {member.membershipSummary?.expiresAt
	                          ? `만료 ${formatDate(member.membershipSummary.expiresAt)}`
	                          : "만료일 확인 필요"}
	                      </span>
	                    </div>
	                  ) : null}
	                  </div>
	                </div>
	                <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${statusClasses[member.status]}`}>
	                  {memberStatusLabels[member.status]}
	                </span>
	              </div>
              )}

              <dl
                className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-zinc-100 pt-4 text-sm"
                data-testid={`member-profile-summary-${member.id}`}
              >
                <div>
                  <dt className="text-xs font-medium text-zinc-500">연령</dt>
                  <dd
                    className="mt-1 font-semibold text-zinc-950"
                    data-testid={`member-profile-age-summary-${member.id}`}
                  >
                    {ageGroupLabels[member.ageGroup]}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-zinc-500">비상 연락처</dt>
                  <dd
                    className="mt-1 font-semibold text-zinc-950"
                    data-testid={`member-profile-contact-summary-${member.id}`}
                  >
                    <a
                      aria-label={`${member.name} 비상 연락처로 전화`}
                      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-sm font-semibold text-zinc-950 no-underline transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"
                      data-testid={`member-emergency-contact-call-${member.id}`}
                      href={`tel:${member.emergencyContact.replace(/[^0-9+]/g, "")}`}
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                      <span className="truncate">{formatPhoneNumber(member.emergencyContact)}</span>
                    </a>
                  </dd>
                </div>
                {member.gender ? (
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">성별</dt>
                    <dd className="mt-1 font-semibold text-zinc-950" data-testid={`member-profile-gender-summary-${member.id}`}>
                      {memberGenderLabels[member.gender]}
                    </dd>
                  </div>
                ) : null}
                {member.birthDate ? (
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">생년월일</dt>
                    <dd className="mt-1 font-semibold text-zinc-950" data-testid={`member-profile-birth-summary-${member.id}`}>
                      {member.birthDate}
                    </dd>
                  </div>
                ) : null}
                {member.address ? (
                  <div className="col-span-2">
                    <dt className="text-xs font-medium text-zinc-500">주소</dt>
                    <dd className="mt-1 break-words font-semibold text-zinc-950" data-testid={`member-profile-address-summary-${member.id}`}>
                      {member.address}
                    </dd>
                  </div>
                ) : null}
                {canManageMembers ? (
                  <div className="col-span-2">
                    <dt className="text-xs font-medium text-zinc-500">담당 코치</dt>
                    <dd
                      className="mt-1 font-semibold text-zinc-950"
                      data-testid={`member-primary-coach-summary-${member.id}`}
                    >
                      {assignedOperator
                        ? `${assignedOperator.name}${assignedOperator.role === "coach" ? "" : " · 임시 담당"}`
                        : "담당자 확인 필요"}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {isFamilyRole && member.alerts.length > 0 ? (
                <div
                  className="mt-3 flex min-h-11 min-w-0 items-center gap-2 max-h-[72px] overflow-hidden rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"
                  data-testid="family-member-alert-strip"
                >
                  <CircleAlert className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                  <p className="line-clamp-2 min-w-0 text-xs font-medium leading-5">{member.alerts.join(" · ")}</p>
                </div>
              ) : null}

              {memberDetailExpanded ? (
              <MemberDetailContainer
                inline={!canManageMembers}
                member={member}
                statusBadge={
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClasses[member.status]}`}>
                    {memberStatusLabels[member.status]}
                  </span>
                }
                onClose={() => toggleMemberDetail(member.id)}
              >
              <div id={`member-detail-${member.id}`}>
              {canManageMembers ? (
                <label className="mt-4 block">
                  <span className="mb-1 block text-xs font-semibold text-zinc-500">회원 상태</span>
                  <select
                    className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                    data-testid="member-status-select"
                    value={member.status}
                    onChange={(event) => updateMemberStatus(member.id, event.target.value as MemberStatus)}
                  >
                    {memberStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {memberStatusLabels[status]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {noticePublisherRoles.has(context.user.role) || canManageMembers ? (
	                <div className="mt-2 flex flex-wrap gap-1.5">
                  {noticePublisherRoles.has(context.user.role) ? (
                    <Link
	                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                      data-testid={`member-send-notice-${member.id}`}
                      href={`/app/notices?noticeCompose=1&noticeTarget=member&noticeTargetMemberId=${encodeURIComponent(member.id)}&noticeMemberSearch=${encodeURIComponent(member.name)}`}
                    >
                      <Bell className="h-3.5 w-3.5" aria-hidden />
                      개인 공지 보내기
                    </Link>
                  ) : null}
                  {canManageMembers ? (
                    <Link
	                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                      data-testid={`member-create-payment-${member.id}`}
                      href={`/app/payments?payMemberId=${encodeURIComponent(member.id)}&payMemberSearch=${encodeURIComponent(member.name)}`}
                    >
                      <CreditCard className="h-3.5 w-3.5" aria-hidden />
                      결제 등록
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {context.user.role !== "coach" ? (
                <section
                  className="mt-4 border-t border-zinc-100 pt-4"
                  data-testid={`member-payment-summary-${member.id}`}
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <h3 className="text-xs font-medium text-zinc-500">결제·회원권</h3>
                    {currentPayment ? <PaymentStatusBadge status={currentPayment.status} /> : null}
                  </div>
                  {currentPayment ? (
                    <>
                      <div className="mt-2 flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-950">{currentPayment.planName}</p>
                          <p className="mt-1 break-words text-xs leading-5 text-zinc-600">
                            납부 {formatDate(currentPayment.dueDate)} · 만료 {formatDate(currentPayment.expiresAt)}
                          </p>
                        </div>
                        {canManageMembers ? (
                          <p className="shrink-0 text-sm font-semibold tabular-nums text-zinc-950">
                            {formatCurrency(
                              Math.max(
                                currentPayment.amount -
                                  (currentPayment.discountAmount ?? 0) -
                                  (currentPayment.refundedAmount ?? 0),
                                0,
                              ),
                            )}
                          </p>
                        ) : null}
                      </div>
                      {canOpenPaymentHistory ? (
                        <Link
                          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                          data-testid={`member-payment-summary-link-${member.id}`}
                          href={`/app/payments?memberId=${encodeURIComponent(member.id)}&q=${encodeURIComponent(member.name)}&focusPayment=${encodeURIComponent(currentPayment.id)}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          결제 내역 보기
                        </Link>
                      ) : context.user.role === "guardian" && member.status === "withdrawn" ? (
                        <p className="mt-2 text-xs leading-5 text-zinc-500">퇴회 회원의 결제 내역은 도장에 문의해 주세요.</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-500">등록된 결제 내역이 없습니다.</p>
                  )}
                </section>
              ) : null}

              {canEditOwnContact && !canManageMembers && !showProfileForm ? (
                <div className="mt-4 border-t border-zinc-100 pt-4">
                  <Button className="w-full" size="touch" type="button" variant="secondary" onClick={() => setEditingContactMemberId(member.id)}>
                    연락처 수정
                  </Button>
                </div>
              ) : null}

              {(canManageMembers || canEditOwnContact) && showProfileForm ? (
                <form
                  className={
                    canManageMembers
                      ? "mt-4 border-t border-zinc-100 pt-4"
                      : "mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2.5"
                  }
                  data-testid={!canManageMembers ? "family-member-contact-form" : undefined}
                  onSubmit={(event) => void handleUpdateMemberProfile(event, member)}
                >
                  <div className={!canManageMembers ? "flex items-center justify-between gap-2" : ""}>
                    <p className="text-xs font-medium text-zinc-500">{canManageMembers ? "기본 정보 수정" : "긴급 연락처 수정"}</p>
                    {!canManageMembers ? (
                      <Button
                        aria-label="긴급 연락처 수정 닫기"
                        size="lg"
                        type="button"
                        variant="ghost"
                        onClick={() => setEditingContactMemberId(null)}
                      >
                        <X className="h-4 w-4" aria-hidden />
                        닫기
                      </Button>
                    ) : null}
                  </div>
                  <div className={canManageMembers ? "mt-2 grid gap-2 sm:grid-cols-2" : "mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"}>
                    {canManageMembers ? (
                      <>
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">이름</span>
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            data-testid={`member-profile-name-input-${member.id}`}
                            maxLength={memberInputLimits.nameLength}
                            value={getProfileDraft(member).name}
                            onChange={(event) => updateProfileDraft(member, { name: event.target.value, feedback: undefined })}
                          />
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">연령</span>
                          <select
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            data-testid={`member-age-group-select-${member.id}`}
                            value={getProfileDraft(member).ageGroup}
                            onChange={(event) =>
                              updateProfileDraft(member, {
                                ageGroup: event.target.value as Member["ageGroup"],
                                feedback: undefined,
                              })
                            }
                          >
                            {ageGroupOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">띠</span>
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            maxLength={memberInputLimits.beltLength}
                            value={getProfileDraft(member).belt}
                            onChange={(event) => updateProfileDraft(member, { belt: event.target.value, feedback: undefined })}
                          />
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">레벨</span>
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            maxLength={memberInputLimits.levelLength}
                            value={getProfileDraft(member).level}
                            onChange={(event) => updateProfileDraft(member, { level: event.target.value, feedback: undefined })}
                          />
                        </label>
                        <label className="sm:col-span-2">
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">담당 코치</span>
                          <select
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            data-testid={`member-primary-coach-select-${member.id}`}
                            value={getProfileDraft(member).primaryCoachId}
                            onChange={(event) =>
                              updateProfileDraft(member, {
                                primaryCoachId: event.target.value,
                                feedback: undefined,
                              })
                            }
                          >
                            {assignedOperator && assignedOperator.role !== "coach" ? (
                              <option value={assignedOperator.id}>
                                {assignedOperator.name} · {assignedOperator.role === "owner" ? "대표" : "총괄 어드민"} 임시 담당
                              </option>
                            ) : null}
                            {assignableCoaches.map((coach) => (
                              <option key={coach.id} value={coach.id}>
                                {coach.name} · 코치
                              </option>
                            ))}
                          </select>
                          {assignableCoaches.length === 0 ? (
                            <span className="mt-1 block text-xs text-amber-700">
                              이 지점에 승인된 코치가 없어 현재 운영 담당자를 유지합니다.
                            </span>
                          ) : null}
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">성별</span>
                          <select
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            data-testid={`member-gender-input-${member.id}`}
                            value={getProfileDraft(member).gender}
                            onChange={(event) =>
                              updateProfileDraft(member, {
                                gender: event.target.value as ProfileDraft["gender"],
                                feedback: undefined,
                              })
                            }
                          >
                            <option value="">선택 안함</option>
                            {memberGenderOptions.map((gender) => (
                              <option key={gender} value={gender}>
                                {memberGenderLabels[gender]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">생년월일</span>
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            data-testid={`member-birth-date-input-${member.id}`}
                            max={formatDateKey(new Date())}
                            type="date"
                            value={getProfileDraft(member).birthDate}
                            onChange={(event) => updateProfileDraft(member, { birthDate: event.target.value, feedback: undefined })}
                          />
                        </label>
                        <label className="sm:col-span-2">
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">주소</span>
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            data-testid={`member-address-input-${member.id}`}
                            maxLength={memberInputLimits.addressLength}
                            placeholder="도로명 주소"
                            value={getProfileDraft(member).address}
                            onChange={(event) => updateProfileDraft(member, { address: event.target.value, feedback: undefined })}
                          />
                        </label>
                      </>
                    ) : null}
                    <label className={canManageMembers ? "sm:col-span-2" : undefined}>
                      <span className="mb-1 block text-xs font-semibold text-zinc-500">긴급 연락처</span>
                      <input
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                        data-touch-target="member-profile-field"
                        data-testid={`member-emergency-contact-input-${member.id}`}
                        maxLength={memberInputLimits.emergencyContactLength}
                        placeholder="연락 가능한 번호"
                        value={getProfileDraft(member).emergencyContact}
                        onChange={(event) => updateProfileDraft(member, { emergencyContact: event.target.value, feedback: undefined })}
                      />
                    </label>
                    {!canManageMembers ? (
                      <Button
                        className="self-end"
                        disabled={!getProfileDraft(member).emergencyContact.trim()}
                        size="touch"
                        type="submit"
                        variant="secondary"
                      >
                        저장
                      </Button>
                    ) : null}
                    {canManageMembers ? (
                      <label className="sm:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">주의사항</span>
                        <textarea
                          className="min-h-20 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                          maxLength={memberInputLimits.alertsTextLength}
                          placeholder="한 줄에 하나씩 입력"
                          value={getProfileDraft(member).alertsText}
                          onChange={(event) => updateProfileDraft(member, { alertsText: event.target.value, feedback: undefined })}
                        />
                      </label>
                    ) : null}
                  </div>
                  {canManageMembers && getProfileDraft(member).ageGroup !== "adult" && member.guardianIds.length === 0 ? (
                    <p
                      className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-900"
                      data-testid={`member-minor-guardian-warning-${member.id}`}
                    >
                      유소년/청소년 회원은 학부모 연결 후 결제 안내가 가능합니다.
                    </p>
                  ) : null}
                  <div className={canManageMembers ? "mt-2 flex flex-wrap items-center gap-2" : "mt-2 min-h-5"}>
                    {canManageMembers ? (
                      <Button
                        data-testid={`member-profile-submit-${member.id}`}
                        disabled={!getProfileDraft(member).emergencyContact.trim() || !getProfileDraft(member).name.trim()}
                        size="lg"
                        type="submit"
                        variant="secondary"
                      >
                        저장
                      </Button>
                    ) : null}
                    {getProfileDraft(member).feedback ? (
                      <p
                        className="text-xs font-medium text-zinc-600"
                        data-testid={`member-profile-feedback-${member.id}`}
                        aria-live="polite"
                        role="status"
                      >
                        {getProfileDraft(member).feedback}
                      </p>
                    ) : null}
                  </div>
                </form>
              ) : null}

              {canManageMembers ? (
                <div className="mt-4 border-t border-zinc-100 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-zinc-500">보호자 연결</p>
                    <span className="text-xs font-semibold text-zinc-500">{member.guardianIds.length}명</span>
                  </div>
                  {member.guardianIds.length > 0 ? (
                    <div className="mt-2 grid gap-2" data-testid={`member-guardian-link-list-${member.id}`}>
                      {member.guardianIds.map((guardianId) => {
                        const guardian = usersById.get(guardianId);

                        return (
                        <div
                          className="flex min-h-12 min-w-0 items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5"
                          data-testid={`member-guardian-current-${member.id}-${guardianId}`}
                          key={guardianId}
                        >
                          <span className="min-w-0 text-xs text-zinc-700">
                            <span className="block truncate font-semibold">
                              {guardian?.name ?? authorNamesById.get(guardianId) ?? guardianId}
                            </span>
                            {guardian?.phone ? (
                              <a
                                aria-label={`${guardian?.name ?? "보호자"} 연락처로 전화`}
                                className="mt-1 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 font-semibold text-zinc-700 no-underline transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700"
                                data-testid={`member-guardian-phone-call-${member.id}-${guardianId}`}
                                href={`tel:${guardian.phone.replace(/[^0-9+]/g, "")}`}
                              >
                                <Phone className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                                <span className="truncate">{formatPhoneNumber(guardian.phone)}</span>
                              </a>
                            ) : null}
                          </span>
                          <button
                            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-md border border-red-200 bg-white px-2.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                            data-testid={`member-guardian-unlink-${member.id}-${guardianId}`}
                            type="button"
                            onClick={() => void handleUnlinkGuardian(member, guardianId)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                            해제
                          </button>
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-500">연결된 보호자가 없습니다.</p>
                  )}

                  {canMemberHaveGuardianLink(member) && getAvailableGuardians(member).length > 0 ? (
                    <form className="mt-3 grid gap-2" onSubmit={(event) => void handleLinkGuardian(event, member)}>
                      <label className="min-w-0">
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">
                          {member.guardianIds.length > 0 ? "변경할 학부모 검색" : "학부모 검색"}
                        </span>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                            data-testid={`member-guardian-search-input-${member.id}`}
                            placeholder="이름, 휴대폰, 이메일 검색"
                            value={guardianLinkDraft.guardianSearch}
                            onChange={(event) =>
                              updateGuardianLinkDraft(member, {
                                feedback: undefined,
                                guardianSearch: event.target.value,
                                guardianUserId: "",
                              })
                            }
                          />
                        </div>
                      </label>

                      {selectedGuardian ? (
                        <div
                          className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs"
                          data-testid={`member-guardian-selected-${member.id}`}
                        >
                          <span className="min-w-0 truncate font-semibold text-teal-900">{selectedGuardian.name}</span>
                          <span className="shrink-0 font-medium text-teal-700">{formatPhoneNumber(selectedGuardian.phone ?? "")}</span>
                        </div>
                      ) : null}

                      {guardianLinkDraft.guardianSearch.trim() ? (
                        <div
                          className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1"
                          data-testid={`member-guardian-search-results-${member.id}`}
                          role="listbox"
                        >
                          {guardianSearchResults.length > 0 ? (
                            guardianSearchResults.map((guardian) => (
                              <button
                                aria-selected={guardianLinkDraft.guardianUserId === guardian.id}
                                className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded px-2 text-left text-xs transition ${
                                  guardianLinkDraft.guardianUserId === guardian.id
                                    ? "bg-teal-50 text-teal-900"
                                    : "text-zinc-700 hover:bg-zinc-50"
                                }`}
                                data-testid={`member-guardian-search-result-${member.id}`}
                                key={guardian.id}
                                role="option"
                                type="button"
                                onClick={() =>
                                  updateGuardianLinkDraft(member, {
                                    feedback: undefined,
                                    guardianSearch: guardian.name,
                                    guardianUserId: guardian.id,
                                  })
                                }
                              >
                                <span className="min-w-0 truncate font-semibold">{guardian.name}</span>
                                <span className="shrink-0 font-medium text-zinc-500">{formatPhoneNumber(guardian.phone ?? "")}</span>
                              </button>
                            ))
                          ) : (
                            <p className="px-2 py-2 text-xs font-medium text-zinc-500" data-testid={`member-guardian-search-empty-${member.id}`}>
                              검색 결과가 없습니다.
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs font-medium text-zinc-500">학부모 이름이나 연락처를 검색한 뒤 선택해 주세요.</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          data-testid={`member-guardian-submit-${member.id}`}
                          disabled={!guardianLinkDraft.guardianUserId}
                          size="lg"
                          type="submit"
                          variant="secondary"
                        >
                          {member.guardianIds.length > 0 ? "변경" : "연결"}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p
                      className="mt-2 text-xs font-medium text-zinc-500"
                      data-testid={!canMemberHaveGuardianLink(member) ? `member-guardian-ineligible-${member.id}` : undefined}
                    >
                      {!canMemberHaveGuardianLink(member)
                        ? "성인 회원은 학부모 연결 대상이 아닙니다."
                        : member.guardianIds.length > 0
                        ? "변경할 다른 학부모 계정이 없습니다."
                        : "연결 가능한 학부모 계정이 없습니다."}
                    </p>
                  )}
                  {guardianLinkDraft.feedback ? (
                    <p
                      className="mt-2 text-xs font-medium text-zinc-600"
                      data-testid={`member-guardian-feedback-${member.id}`}
                      aria-live="polite"
                      role="status"
                    >
                      {guardianLinkDraft.feedback}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showAlertSection ? (
                <div className="mt-4 border-t border-zinc-100 pt-4">
                  <p className="text-xs font-medium text-zinc-500">주의사항</p>
                  <ul className="mt-2 space-y-1 text-sm leading-6 text-zinc-700">
                    {member.alerts.map((alert) => (
                      <li key={alert}>{alert}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div
                className="mt-4 border-t border-zinc-100 pt-4"
                data-note-state={isCoachRole ? "closed" : undefined}
                data-testid={isCoachRole ? "coach-member-note-section" : undefined}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="text-xs font-medium text-zinc-500"
                      data-testid={isFamilyRole ? "family-member-feedback-heading" : undefined}
                    >
                      {isFamilyRole ? "코치 피드백" : "상담/주의 메모"}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-zinc-500">{memberNotes.length}건</p>
                    {isCoachRole && latestMemberNote ? (
                      <p className="mt-1 text-xs font-medium text-zinc-500" data-testid="coach-member-note-summary">
                        최근 {noteTypeLabels[latestMemberNote.noteType]} · {formatNoteDate(latestMemberNote.createdAt)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {showCoachNoteListToggle ? (
                      <button
                        className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        data-testid={`member-note-list-toggle-${member.id}`}
                        type="button"
                        aria-haspopup="dialog"
                        onClick={() => openNoteListDialog(member.id)}
                      >
                        최근 메모 보기
                      </button>
                    ) : null}
                    {canCreateNotes ? (
                      <button
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        data-testid={`member-note-editor-toggle-${member.id}`}
                        type="button"
                        aria-haspopup="dialog"
                        onClick={() => openCreateNoteDialog(member)}
                      >
                        <Pencil className="h-4 w-4 shrink-0" aria-hidden />
                        작성
                      </button>
                    ) : null}
                  </div>
                </div>
                {visibleMemberNotes.length > 0 ? (
                  <ul className="mt-2 space-y-2" data-testid={`member-note-list-${member.id}`}>
                    {visibleMemberNotes.map((note) => {
                      const canManageNote = canManageCounselingNote(context.user, note);

                      return (
                      <li
                        className="rounded-md border border-zinc-100 bg-zinc-50 p-3"
                        data-testid={isFamilyRole ? "family-member-feedback-card" : isCoachRole ? "coach-member-note-card" : undefined}
                        key={note.id}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-zinc-500">
                          <span className="rounded-md bg-white px-2 py-1 text-zinc-700">
                            {noteTypeLabels[note.noteType]}
                          </span>
                          {!isFamilyRole ? (
                            <span className="rounded-md bg-white px-2 py-1 text-zinc-700">
                              {noteVisibilityLabels[note.visibility]}
                            </span>
                          ) : null}
                          <span>{formatNoteDate(note.createdAt)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{note.body}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-zinc-500">
                            {isFamilyRole ? "코치" : "작성자"} {authorNamesById.get(note.authorUserId) ?? "작성자 확인 중"}
                            {note.updatedAt && note.updatedAt !== note.createdAt ? " · 수정됨" : ""}
                          </p>
                          {canManageNote ? (
                            <div className="flex gap-1">
                              <button
                                aria-label={`${member.name} 메모 수정`}
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-zinc-600 transition hover:bg-white hover:text-zinc-900"
                                data-testid={`member-note-edit-${note.id}`}
                                type="button"
                                onClick={() => openEditNoteDialog(member, note)}
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                                수정
                              </button>
                              <button
                                aria-label={`${member.name} 메모 삭제`}
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                                data-testid={`member-note-delete-${note.id}`}
                                type="button"
                                onClick={() => openDeleteNoteDialog(member, note)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                                삭제
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
              {canManageMembers ? (
                <div className="mt-5 border-t border-zinc-100 pt-4">
                  <div className="flex flex-col gap-3 rounded-lg border border-red-100 bg-red-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">회원 삭제</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-600">
                        회원 프로필과 연결된 출석·결제·승급·상담 기록을 함께 삭제합니다.
                      </p>
                    </div>
                    <Button
                      className="shrink-0 text-red-700 hover:bg-red-100"
                      data-testid={`member-delete-open-${member.id}`}
                      size="lg"
                      type="button"
                      variant="secondary"
                      onClick={() => openMemberDeleteDialog(member.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      회원 삭제
                    </Button>
                  </div>
                </div>
              ) : null}
              </div>
              </MemberDetailContainer>
              ) : null}
            </article>
            );
          })}
        </div>
        {noteListMember && noteListNotes.length > 0 ? (
          <CounselingNoteListDialog
            authorNamesById={authorNamesById}
            canManageNote={(note) => canManageCounselingNote(context.user, note)}
            member={noteListMember}
            notes={noteListNotes}
            role={context.user.role}
            onClose={closeNoteListDialog}
            onDelete={(note) => openDeleteNoteFromList(noteListMember, note)}
            onEdit={(note) => openEditNoteFromList(noteListMember, note)}
          />
        ) : null}
        {noteDialog && noteDialogMember ? (
          <CounselingNoteDialog
            draft={noteDraft}
            intent={noteDialog.intent}
            member={noteDialogMember}
            pending={noteMutationPending}
            role={context.user.role}
            onClose={closeNoteDialog}
            onDelete={() => void handleDeleteCounselingNote()}
            onDraftChange={updateNoteDraft}
            onSubmit={() => void handleSaveCounselingNote()}
          />
        ) : null}
        {memberDeleteTarget ? (
          <MemberFormDialog
            description={`${memberDeleteTarget.name} 회원을 삭제합니다. 삭제한 프로필은 복구할 수 없습니다.`}
            icon={<Trash2 className="h-5 w-5 text-red-700" aria-hidden />}
            labelId={`member-delete-dialog-title-${memberDeleteTarget.id}`}
            testId={`member-delete-dialog-${memberDeleteTarget.id}`}
            title="회원 삭제 확인"
            onClose={closeMemberDeleteDialog}
          >
            <form onSubmit={(event) => void handleDeleteMember(event)}>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                출석·결제·승급·상담 기록과 수업 배정이 함께 삭제됩니다. 해당 회원만 연결된 일반 회원 로그인 계정도 삭제됩니다.
              </div>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-semibold text-zinc-600">삭제 사유</span>
                <textarea
                  autoFocus
                  className="min-h-28 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-zinc-400 focus:border-red-400"
                  data-testid="member-delete-reason"
                  disabled={memberDeletePending}
                  maxLength={memberInputLimits.deleteReasonLength}
                  placeholder="예: 중복으로 등록한 회원"
                  value={memberDeleteReason}
                  onChange={(event) => {
                    setMemberDeleteReason(event.target.value);
                    setMemberDeleteFeedback(null);
                  }}
                />
              </label>
              <p className="mt-2 min-h-5 text-xs font-medium text-red-700" aria-live="polite" role="status">
                {memberDeleteFeedback}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button disabled={memberDeletePending} size="lg" type="button" onClick={closeMemberDeleteDialog}>
                  취소
                </Button>
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="member-delete-confirm"
                  disabled={memberDeletePending || !memberDeleteReason.trim()}
                  type="submit"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {memberDeletePending ? "삭제 중" : "삭제"}
                </button>
              </div>
            </form>
          </MemberFormDialog>
        ) : null}
        {isCoachRole ? <div className="h-28 lg:hidden" data-testid="coach-member-bottom-safe-area" aria-hidden /> : null}
        </>
      )}
    </div>
  );
}
