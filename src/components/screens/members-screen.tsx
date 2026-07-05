"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown, Copy, CreditCard, ExternalLink, Pencil, Phone, PlusCircle, Search, UserPlus, UserRound, X } from "lucide-react";
import type { CounselingNote, CounselingNoteVisibility, Member, MemberStatus, UserRole } from "@/lib/domain";
import { ChildSwitcher } from "@/components/domain/child-switcher";
import { useApiContext } from "@/hooks/use-api-context";
import { useGuardianChildSelection } from "@/hooks/use-guardian-child-selection";
import { useResource } from "@/hooks/use-resource";
import { apiClient } from "@/lib/api-client";
import { formatDateTime, formatPhoneNumber } from "@/lib/format";
import { invitationLinkCopyFallbackMessage, invitationLinkCopySuccessMessage } from "@/lib/invitation-link-copy";
import { canMemberHaveGuardianLink } from "@/lib/member-age-policy";
import { matchesMemberSearch, normalizeMemberSearchText } from "@/lib/notice-member-search";
import { noticePublisherRoles } from "@/lib/notice-permissions";
import { memberStatusLabels, roleLabels } from "@/lib/roles";
import { useAppStore } from "@/store/app-store";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-blocks";
import { Button, SectionHeader } from "@/components/ui/primitives";

const statusClasses: Record<MemberStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  trial: "border-teal-200 bg-teal-50 text-teal-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  withdrawn: "border-zinc-200 bg-zinc-50 text-zinc-600",
};
const memberStatusOptions: MemberStatus[] = ["active", "trial", "paused", "withdrawn"];

function getInitialMemberQuery() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
}

function getInitialMemberStatusFilter(): MemberStatus | "all" {
  if (typeof window === "undefined") {
    return "all";
  }

  const value = new URLSearchParams(window.location.search).get("status");

  return (memberStatusOptions as string[]).includes(value ?? "") ? (value as MemberStatus) : "all";
}

function syncMemberListParamToUrl(key: "q" | "status", value: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (value) {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
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

type GuardianLinkDraft = {
  feedback?: string;
  guardianSearch: string;
  guardianUserId: string;
};

type ProfileDraft = {
  ageGroup: Member["ageGroup"];
  alertsText: string;
  belt: string;
  dirty?: boolean;
  emergencyContact: string;
  feedback?: string;
  level: string;
  name: string;
  sourceMemberSignature: string;
};

function getTitle(role: string) {
  if (role === "member") {
    return "내 프로필";
  }

  if (role === "guardian") {
    return "자녀 회원";
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
    member.emergencyContact,
    member.alerts.join("\n"),
  ].join("\u001f");
}

function profileDraftTouchesEditableField(patch: Partial<ProfileDraft>) {
  return ["ageGroup", "alertsText", "belt", "emergencyContact", "level", "name"].some((key) =>
    Object.prototype.hasOwnProperty.call(patch, key),
  );
}

export function MembersScreen() {
  const context = useApiContext();
  const {
    createCounselingNote,
    createInvitation,
    createMember,
    linkGuardian,
    replaceGuardian,
    unlinkGuardian,
    updateMemberProfile,
    updateMemberStatus,
  } = useAppStore();
  const [query, setQueryState] = useState(getInitialMemberQuery);
  const [statusFilter, setStatusFilterState] = useState<MemberStatus | "all">(getInitialMemberStatusFilter);
  const [memberSort, setMemberSort] = useState<"default" | "name" | "recent">("default");
  // 관리자 회원 카드는 기본 요약 상태로 접고, 탭하면 상세(상태 변경·정보 수정·보호자·메모)가 열린다.
  const [expandedMemberIds, setExpandedMemberIds] = useState<Set<string>>(() => new Set());

  function toggleMemberDetail(memberId: string) {
    setExpandedMemberIds((current) => {
      const next = new Set(current);

      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }

      return next;
    });
  }

  // 새로고침·뒤로가기·딥링크에서 목록 필터 상태가 유지되도록 URL에 동기화한다.
  function setQuery(value: string) {
    setQueryState(value);
    syncMemberListParamToUrl("q", value.trim() || null);
  }

  function setStatusFilter(value: MemberStatus | "all") {
    setStatusFilterState(value);
    syncMemberListParamToUrl("status", value === "all" ? null : value);
  }
  const [selectedChildId, setSelectedChildId] = useGuardianChildSelection(context.user.id);
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
  const [memberCreateFormOpen, setMemberCreateFormOpen] = useState(false);
  const [guardianLinkDrafts, setGuardianLinkDrafts] = useState<Record<string, GuardianLinkDraft>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, NoteDraft>>({});
  const [openNoteEditorMemberIds, setOpenNoteEditorMemberIds] = useState<string[]>([]);
  const [expandedNoteMemberIds, setExpandedNoteMemberIds] = useState<string[]>([]);
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

  const guardianChildId = context.user.role === "guardian" ? selectedChildId || data?.[0]?.id || null : null;
  const childSwitcherItems = useMemo(
    () =>
      context.user.role === "guardian"
        ? (data ?? []).map((member) => ({
            id: member.id,
            name: member.name,
            meta: `${member.belt} · ${member.level}`,
            statusLabel: memberStatusLabels[member.status],
          }))
        : [],
    [context.user.role, data],
  );
  const authorNamesById = useMemo(
    () => new Map(context.db.users.map((user) => [user.id, user.name])),
    [context.db.users],
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

  function handleCreateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedCreateBranchId || !newMemberName.trim() || !newMemberEmergencyContact.trim()) {
      return;
    }

    createMember(selectedCreateBranchId, {
      name: newMemberName.trim(),
      status: newMemberStatus,
      ageGroup: newMemberAgeGroup,
      level: newMemberLevel.trim() || "입문",
      belt: newMemberBelt.trim() || "흰띠",
      emergencyContact: newMemberEmergencyContact.trim(),
    });
    setNewMemberName("");
    setNewMemberEmergencyContact("");
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

  function getNoteDraft(memberId: string) {
    return noteDrafts[memberId] ?? createEmptyNoteDraft(context.user.role);
  }

  function updateNoteDraft(memberId: string, patch: Partial<NoteDraft>) {
    setNoteDrafts((current) => ({
      ...current,
      [memberId]: {
        ...createEmptyNoteDraft(context.user.role),
        ...current[memberId],
        ...patch,
      },
    }));
  }

  function isNoteEditorOpen(memberId: string) {
    return openNoteEditorMemberIds.includes(memberId);
  }

  function toggleNoteEditor(memberId: string) {
    setOpenNoteEditorMemberIds((current) =>
      current.includes(memberId) ? current.filter((candidate) => candidate !== memberId) : [...current, memberId],
    );
  }

  function isNoteListExpanded(memberId: string) {
    return expandedNoteMemberIds.includes(memberId);
  }

  function toggleNoteList(memberId: string) {
    setExpandedNoteMemberIds((current) =>
      current.includes(memberId) ? current.filter((candidate) => candidate !== memberId) : [...current, memberId],
    );
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
      alertsText: member.alerts.join("\n"),
      belt: member.belt,
      dirty: false,
      emergencyContact: formatPhoneNumber(member.emergencyContact),
      level: member.level,
      name: member.name,
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
          belt: draft.belt.trim(),
          emergencyContact,
          level: draft.level.trim(),
          name: memberName,
        }
      : { emergencyContact });

    updateProfileDraft(member, {
      ...(saved
        ? {
            ageGroup: draft.ageGroup,
            alertsText: nextAlerts.join("\n"),
            belt: draft.belt.trim(),
            emergencyContact,
            level: draft.level.trim(),
            name: canManageMembers ? memberName : draft.name,
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

  async function handleCreateCounselingNote(event: FormEvent<HTMLFormElement>, member: Member) {
    event.preventDefault();

    const draft = getNoteDraft(member.id);

    if (!draft.body.trim()) {
      updateNoteDraft(member.id, { feedback: "메모 내용을 입력해 주세요." });
      return;
    }

    const created = await createCounselingNote(member.branchId, member.id, {
      body: draft.body.trim(),
      noteType: draft.noteType,
      visibility: draft.visibility,
    });

    updateNoteDraft(member.id, {
      body: created ? "" : draft.body,
      feedback: created ? "메모를 저장했습니다." : "메모를 저장하지 못했습니다.",
    });

    if (created) {
      setOpenNoteEditorMemberIds((current) => current.filter((memberId) => memberId !== member.id));
    }
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState description={error ?? "회원 정보를 불러오지 못했습니다."} onRetry={reload} />;
  }

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
              aria-expanded={inviteFormOpen}
              data-testid="member-invite-toggle"
              size="lg"
              type="button"
              variant="secondary"
              onClick={() => setInviteFormOpen((open) => !open)}
            >
              {inviteFormOpen ? "닫기" : "열기"}
            </Button>
          </div>
          {inviteFormOpen ? (
            <form
              className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_0.9fr_auto]"
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
                className="self-end"
                data-testid="member-invite-submit"
                disabled={!selectedInviteBranchId || !inviteName.trim() || !invitePhone.trim()}
                size="lg"
                type="submit"
                variant="primary"
              >
                초대
              </Button>
              {inviteFeedback ? (
                <p className="text-sm font-medium text-zinc-700 md:col-span-full" data-testid="member-invite-feedback" aria-live="polite" role="status">
                  {inviteFeedback}
                </p>
              ) : null}
              {invitePath ? (
                <div className="flex flex-col gap-2 rounded-md border border-teal-200 bg-teal-50 p-3 sm:flex-row sm:items-center sm:justify-between md:col-span-full">
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
          ) : null}
        </section>
      ) : null}

      {canManageMembers ? (
        <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-3" data-testid="member-create-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <PlusCircle className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <h2 className="min-w-0 truncate text-base font-semibold text-zinc-950">회원 등록</h2>
            </div>
            <Button
              aria-controls="member-create-form"
              aria-expanded={memberCreateFormOpen}
              data-testid="member-create-toggle"
              size="lg"
              type="button"
              variant="secondary"
              onClick={() => setMemberCreateFormOpen((open) => !open)}
            >
              {memberCreateFormOpen ? "닫기" : "열기"}
            </Button>
          </div>
          {memberCreateFormOpen ? (
            <form
              className="mt-3 grid gap-3 md:grid-cols-[1fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr_auto]"
              id="member-create-form"
              onSubmit={handleCreateMember}
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
                  value={newMemberLevel}
                  onChange={(event) => setNewMemberLevel(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">띠</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="member-create-field"
                  value={newMemberBelt}
                  onChange={(event) => setNewMemberBelt(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">연락처</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="member-create-field"
                  placeholder="연락 가능한 번호"
                  value={newMemberEmergencyContact}
                  onChange={(event) => setNewMemberEmergencyContact(event.target.value)}
                />
              </label>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="member-create-submit"
                disabled={!selectedCreateBranchId || !newMemberName.trim() || !newMemberEmergencyContact.trim()}
                type="submit"
              >
                등록
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {filteredMembers.length === 0 ? (
        <EmptyState
          title={query ? "검색 결과가 없습니다" : statusFilter !== "all" ? `${memberStatusLabels[statusFilter]} 상태 회원이 없습니다` : "표시할 회원이 없습니다"}
          description={
            query
              ? "검색어를 지우거나 다시 찾아보세요."
              : statusFilter !== "all"
                ? "상태 필터를 전체로 바꾸면 모든 회원이 표시됩니다."
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
              (note) => !isFamilyRole || note.visibility === "guardian_visible",
            );
            const noteListExpanded = isNoteListExpanded(member.id);
            const latestMemberNote = memberNotes[0];
            const visibleMemberNotes = isCoachRole ? (noteListExpanded ? memberNotes : []) : memberNotes.slice(0, 3);
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
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClasses[member.status]}`}>
                      {memberStatusLabels[member.status]}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-zinc-400 transition-transform ${memberDetailExpanded ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </span>
                </button>
              ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    <UserRound className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-zinc-950">{member.name}</h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      {member.belt} · {member.level}
                    </p>
	                  </div>
	                </div>
	                <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${statusClasses[member.status]}`}>
	                  {memberStatusLabels[member.status]}
	                </span>
	              </div>
              )}

		              {isFamilyRole && member.alerts.length > 0 ? (
		                <div
		                  className="mt-3 flex min-h-11 min-w-0 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-950"
		                  data-testid="family-member-alert-strip"
		                >
	                  <span className="shrink-0 rounded bg-white px-2 py-0.5 text-xs font-semibold text-amber-700">확인 필요</span>
	                  <p className="min-w-0 break-words">
	                    {member.alerts.slice(0, 2).join(" · ")}
	                  </p>
	                </div>
	              ) : null}

              {canManageMembers && memberDetailExpanded ? (
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
              </dl>

              {memberDetailExpanded ? (
              <div id={`member-detail-${member.id}`}>
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
                            value={getProfileDraft(member).belt}
                            onChange={(event) => updateProfileDraft(member, { belt: event.target.value, feedback: undefined })}
                          />
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">레벨</span>
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-touch-target="member-profile-field"
                            value={getProfileDraft(member).level}
                            onChange={(event) => updateProfileDraft(member, { level: event.target.value, feedback: undefined })}
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
                data-note-state={isCoachRole ? (noteListExpanded ? "open" : "closed") : undefined}
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
                        aria-expanded={isNoteListExpanded(member.id)}
                        onClick={() => toggleNoteList(member.id)}
                      >
                        {isNoteListExpanded(member.id) ? "최근 메모 닫기" : "최근 메모 보기"}
                      </button>
                    ) : null}
                    {canCreateNotes ? (
                      <button
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        data-testid={`member-note-editor-toggle-${member.id}`}
                        type="button"
                        aria-expanded={isNoteEditorOpen(member.id)}
                        onClick={() => toggleNoteEditor(member.id)}
                      >
                        {isNoteEditorOpen(member.id) ? (
                          <X className="h-4 w-4 shrink-0" aria-hidden />
                        ) : (
                          <Pencil className="h-4 w-4 shrink-0" aria-hidden />
                        )}
                        {isNoteEditorOpen(member.id) ? "닫기" : "작성"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {visibleMemberNotes.length > 0 ? (
                  <ul className="mt-2 space-y-2" data-testid={`member-note-list-${member.id}`}>
                    {visibleMemberNotes.map((note) => {
                      const collapseBody = isCoachRole && !noteListExpanded;

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
                        <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800 ${collapseBody ? "max-h-12 overflow-hidden" : ""}`}>
                          {note.body}
                        </p>
                        <p className="mt-2 text-xs text-zinc-500">
                          {isFamilyRole ? "코치" : "작성자"} {authorNamesById.get(note.authorUserId) ?? "작성자 확인 중"}
                        </p>
                      </li>
                      );
                    })}
                  </ul>
                ) : null}

                {canCreateNotes && isNoteEditorOpen(member.id) ? (
                  <form
                    className="mt-3 space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3"
                    data-testid={`member-note-editor-${member.id}`}
                    onSubmit={(event) => void handleCreateCounselingNote(event, member)}
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">유형</span>
                        <select
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                          data-testid="member-note-field"
                          value={getNoteDraft(member.id).noteType}
                          onChange={(event) =>
                            updateNoteDraft(member.id, { noteType: event.target.value as CounselingNote["noteType"] })
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
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">볼 수 있는 대상</span>
                        <select
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                          data-testid="member-note-field"
                          value={getNoteDraft(member.id).visibility}
                          onChange={(event) =>
                            updateNoteDraft(member.id, { visibility: event.target.value as CounselingNoteVisibility })
                          }
                        >
                          {noteVisibilityOptions
                            .filter((option) => context.user.role !== "coach" || option.value !== "staff_only")
                            .map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-zinc-500">메모</span>
                      <textarea
                        className="min-h-24 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                        placeholder="상담 내용과 다음 확인 일정"
                        value={getNoteDraft(member.id).body}
                        onChange={(event) => updateNoteDraft(member.id, { body: event.target.value, feedback: undefined })}
                      />
                    </label>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-h-5 text-xs font-medium text-zinc-500">
                        {getNoteDraft(member.id).feedback ?? "저장하면 선택한 대상이 볼 수 있습니다."}
                      </p>
                      <Button data-testid="member-note-submit" disabled={!getNoteDraft(member.id).body.trim()} size="lg" type="submit" variant="secondary">
                        메모 저장
                      </Button>
                    </div>
                  </form>
                ) : null}
              </div>
              </div>
              ) : null}
            </article>
            );
          })}
        </div>
        {isCoachRole ? <div className="h-28 lg:hidden" data-testid="coach-member-bottom-safe-area" aria-hidden /> : null}
        </>
      )}
    </div>
  );
}
