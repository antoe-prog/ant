"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bell, BellRing, CheckCheck, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
import { ChildSwitcher } from "@/components/domain/child-switcher";
import type { Member, Notice, NoticeAudience, NoticeTargetType } from "@/lib/domain";
import { ApiClientError, apiClient, type NoticeCreatePayload } from "@/lib/api-client";
import { userRoles } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import { matchesNoticeMemberSearch, normalizeNoticeMemberSearchText } from "@/lib/notice-member-search";
import { noticeInputLimits } from "@/lib/notice-input-policy";
import { getChildSwitcherPresentation } from "@/lib/member-presentation";
import { canDeleteNotice, canEditNotice, noticePublisherRoles } from "@/lib/notice-permissions";
import { getNoticeReadCount, isNoticeReadByUser, isNoticeRelevantToMember, sortNoticesForDisplay } from "@/lib/notices";
import { isNoticeRecipient } from "@/lib/mock-api";
import { roleLabels } from "@/lib/roles";
import { useApiContext } from "@/hooks/use-api-context";
import { useGuardianChildSelection } from "@/hooks/use-guardian-child-selection";
import { useResource } from "@/hooks/use-resource";
import { useUrlSyncedTextParam } from "@/hooks/use-url-synced-text-param";
import { useAppStore } from "@/store/app-store";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-blocks";
import { Button, SectionHeader } from "@/components/ui/primitives";

type NoticeFilter = "all" | "unread" | "important";

type NoticeDraft = {
  audience: NoticeAudience[];
  body: string;
  important: boolean;
  title: string;
};

const familyNoticeBodyPreviewLength = 22;
const defaultNoticeAudience: NoticeAudience[] = ["member", "guardian"];

function createNoticeDraftKey(userId: string, branchId: string, targetType: NoticeTargetType, targetId: string) {
  return ["final-judo-notice-draft:v2", userId, branchId || "no-branch", targetType, targetId || "unselected"]
    .map(encodeURIComponent)
    .join(":");
}

function parseNoticeDraft(raw: string | null): NoticeDraft | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<NoticeDraft>;
    const audience = Array.isArray(parsed.audience)
      ? [...new Set(parsed.audience)].filter(
          (item): item is NoticeAudience => item === "all" || userRoles.includes(item as (typeof userRoles)[number]),
        )
      : [];

    return {
      audience: audience.length > 0 ? audience : defaultNoticeAudience,
      body: typeof parsed.body === "string" ? parsed.body : "",
      important: parsed.important === true,
      title: typeof parsed.title === "string" ? parsed.title : "",
    };
  } catch {
    return null;
  }
}

function createNoticeRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `notice.${uuid}`;
  }

  return `notice.${Date.now().toString(36)}.${Math.random().toString(36).slice(2).padEnd(12, "0")}`;
}

function createNoticeRequestFingerprint(payload: Omit<NoticeCreatePayload, "clientRequestId">) {
  return JSON.stringify({
    audience: [...payload.audience].sort(),
    body: payload.body,
    important: payload.important === true,
    targetClassIds: [...(payload.targetClassIds ?? [])].sort(),
    targetMemberIds: [...(payload.targetMemberIds ?? [])].sort(),
    title: payload.title,
  });
}

function getInitialNoticeComposerState() {
  if (typeof window === "undefined") {
    return {
      memberSearch: "",
      open: false,
      audience: defaultNoticeAudience,
      targetMemberId: "",
      targetType: "branch" as NoticeTargetType,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const targetType = params.get("noticeTarget");
  const normalizedTargetType: NoticeTargetType = targetType === "class" || targetType === "member" ? targetType : "branch";

  return {
    audience: params.get("noticeAudience") === "guardian" ? (["guardian"] as NoticeAudience[]) : defaultNoticeAudience,
    memberSearch: params.get("noticeMemberSearch")?.trim() ?? "",
    open: params.get("noticeCompose") === "1",
    targetMemberId: params.get("noticeTargetMemberId")?.trim() ?? "",
    targetType: normalizedTargetType,
  };
}

function compactNoticeBody(value: string, maxLength = familyNoticeBodyPreviewLength) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function audienceLabel(audience: NoticeAudience[]) {
  return audience.map((item) => (item === "all" ? "전체" : roleLabels[item])).join(", ");
}

function targetLabel(
  notice: Notice,
  classNameById: Map<string, string>,
  memberNameById: Map<string, string>,
  selectedChildId?: string | null,
) {
  const classNames = (notice.targetClassIds ?? [])
    .map((classId) => classNameById.get(classId))
    .filter((name): name is string => Boolean(name));
  const memberNames = (notice.targetMemberIds ?? [])
    .map((memberId) => memberNameById.get(memberId))
    .filter((name): name is string => Boolean(name));
  const selectedChildTargeted = selectedChildId ? (notice.targetMemberIds ?? []).includes(selectedChildId) : false;
  const otherFamilyTargetCount = selectedChildId
    ? (notice.targetMemberIds ?? []).filter((memberId) => memberId !== selectedChildId && memberNameById.has(memberId)).length
    : 0;
  const memberLabels = selectedChildId
    ? [
        ...(selectedChildTargeted ? [`개인 ${memberNameById.get(selectedChildId) ?? "선택한 자녀"}`] : []),
        ...(otherFamilyTargetCount > 0 ? [`가족 내 다른 자녀 ${otherFamilyTargetCount}명`] : []),
      ]
    : memberNames.map((name) => `개인 ${name}`);

  if (classNames.length === 0 && memberLabels.length === 0) {
    return "지점 전체";
  }

  return [
    ...classNames.map((name) => `반 ${name}`),
    ...memberLabels,
  ].join(", ");
}

export function NoticesScreen() {
  const searchParams = useSearchParams();
  const context = useApiContext();
  const guardianChildren =
    context.user.role === "guardian"
      ? context.db.members.filter((member) => context.user.childMemberIds?.includes(member.id))
      : [];
  const guardianChildIds = guardianChildren.map((member) => member.id);
  const requestedChildId = searchParams.get("memberId")?.trim() ?? "";
  const [selectedChildId, setSelectedChildId] = useGuardianChildSelection(
    context.user.id,
    context.user.role === "guardian" ? guardianChildIds : undefined,
    context.user.role === "guardian" ? requestedChildId : null,
  );
  const { createNotice, updateNotice, deleteNotice, markNoticeAsRead, markNoticesAsRead } = useAppStore();
  const [noticeSearch, setNoticeListSearch] = useUrlSyncedTextParam("q");
  const [noticeComposerDefaults] = useState(getInitialNoticeComposerState);
  const [noticeBranchId, setNoticeBranchId] = useState("");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeBody, setNoticeBody] = useState("");
  const [noticeImportant, setNoticeImportant] = useState(false);
  const [noticeAudience, setNoticeAudience] = useState<NoticeAudience[]>(noticeComposerDefaults.audience);
  const [noticeFeedback, setNoticeFeedback] = useState<string | null>(null);
  const [readFeedback, setReadFeedback] = useState<string | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);
  const [bulkReadPending, setBulkReadPending] = useState(false);
  const [noticeTargetClassId, setNoticeTargetClassId] = useState("");
  const [noticeTargetMemberId, setNoticeTargetMemberId] = useState(noticeComposerDefaults.targetMemberId);
  const [noticeMemberSearch, setNoticeMemberSearch] = useState(noticeComposerDefaults.memberSearch);
  const [noticeMemberActiveIndex, setNoticeMemberActiveIndex] = useState(0);
  const [noticeTargetType, setNoticeTargetType] = useState<NoticeTargetType>(noticeComposerDefaults.targetType);
  const [noticeFilter, setNoticeFilter] = useState<NoticeFilter>("all");
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [pushConfirmationNoticeId, setPushConfirmationNoticeId] = useState<string | null>(null);
  const [pushPendingNoticeId, setPushPendingNoticeId] = useState<string | null>(null);
  const [readNoticePendingId, setReadNoticePendingId] = useState<string | null>(null);
  const [deleteConfirmNoticeId, setDeleteConfirmNoticeId] = useState<string | null>(null);
  const [deletingNoticeId, setDeletingNoticeId] = useState<string | null>(null);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
  const [editNoticeTitle, setEditNoticeTitle] = useState("");
  const [editNoticeBody, setEditNoticeBody] = useState("");
  const [editNoticeImportant, setEditNoticeImportant] = useState(false);
  const [savingNoticeEditId, setSavingNoticeEditId] = useState<string | null>(null);
  const [expandedNoticeIds, setExpandedNoticeIds] = useState<Set<string>>(() => new Set());
  const [noticeCreateOpen, setNoticeCreateOpen] = useState(noticeComposerDefaults.open);
  const [noticeCreatePending, setNoticeCreatePending] = useState(false);
  const [noticeConfirmationFingerprint, setNoticeConfirmationFingerprint] = useState<string | null>(null);
  const loadedNoticeDraftKeyRef = useRef<string | null>(null);
  const skipNoticeDraftSaveKeyRef = useRef<string | null>(null);
  const noticeCreateAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const pushDispatchInFlightRef = useRef<string | null>(null);
  const pushConfirmationCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pushConfirmationNoticeId) {
      return;
    }

    queueMicrotask(() => pushConfirmationCancelRef.current?.focus());
  }, [pushConfirmationNoticeId]);

  function clearNoticeFeedback() {
    setNoticeFeedback(null);
    setDeleteFeedback(null);
    setPushFeedback(null);
    setReadFeedback(null);
  }

  // 회원 카드 "개인 공지 보내기" 같은 클라이언트 내비게이션에서도 작성 프리셋이 적용되도록
  // URL 파라미터 변화를 반영한다 (최초 하드 로드는 noticeComposerDefaults가 처리).
  useEffect(() => {
    if (searchParams.get("noticeCompose") !== "1") {
      return;
    }

    const targetType = searchParams.get("noticeTarget");
    const targetMemberId = searchParams.get("noticeTargetMemberId")?.trim() ?? "";
    const memberSearch = searchParams.get("noticeMemberSearch")?.trim() ?? "";
    const requestedAudience = searchParams.get("noticeAudience");
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setNoticeCreateOpen(true);

      if (targetType === "class" || targetType === "member") {
        setNoticeTargetType(targetType);
      }

      if (targetMemberId) {
        setNoticeTargetMemberId(targetMemberId);
      }

      if (memberSearch) {
        setNoticeMemberSearch(memberSearch);
      }

      if (requestedAudience === "guardian") {
        setNoticeAudience(["guardian"]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);
  const canPublishNotice = noticePublisherRoles.has(context.user.role);
  const showNoticeDeliveryMeta = canPublishNotice;
  const showNoticeAside = canPublishNotice;
  const selectedNoticeBranchId = noticeBranchId || context.selectedBranchId || context.db.branches[0]?.id || "";
  const classNameById = useMemo(
    () => new Map(context.db.classes.map((session) => [session.id, session.name])),
    [context.db.classes],
  );
  const memberNameById = useMemo(
    () => new Map(context.db.members.map((member) => [member.id, member.name])),
    [context.db.members],
  );
  const userById = useMemo(
    () => new Map(context.db.users.map((user) => [user.id, user])),
    [context.db.users],
  );
  const noticeTargetClasses = context.db.classes.filter((session) => session.branchId === selectedNoticeBranchId);
  const noticeTargetMembers = context.db.members.filter((member) => member.branchId === selectedNoticeBranchId && member.status !== "withdrawn");
  const selectedNoticeMember = noticeTargetMembers.find((member) => member.id === noticeTargetMemberId) ?? null;
  const selectedNoticeClassId = noticeTargetClasses.some((session) => session.id === noticeTargetClassId)
    ? noticeTargetClassId
    : noticeTargetClasses[0]?.id ?? "";
  const noticeDraftTargetId = noticeTargetType === "class"
    ? selectedNoticeClassId
    : noticeTargetType === "member"
      ? selectedNoticeMember?.id ?? ""
      : "branch";
  const noticeDraftKey = createNoticeDraftKey(
    context.user.id,
    selectedNoticeBranchId,
    noticeTargetType,
    noticeDraftTargetId,
  );
  const noticeMemberSearchQuery = normalizeNoticeMemberSearchText(noticeMemberSearch);
  const noticeMemberSearchResults = noticeMemberSearchQuery
    ? noticeTargetMembers
        .filter((member) => {
          const guardians = member.guardianIds
            .map((guardianId) => userById.get(guardianId))
            .filter(Boolean);
          return matchesNoticeMemberSearch(noticeMemberSearch, [
            member.name,
            member.level,
            member.belt,
            member.emergencyContact,
            ...guardians.flatMap((guardian) => [guardian?.name, guardian?.phone, guardian?.email]),
          ]);
        })
        .slice(0, 8)
    : [];
  const showNoticeMemberSearchResults =
    !selectedNoticeMember || noticeMemberSearch.trim() !== selectedNoticeMember.name;

  // 범위를 알 수 없는 기존 단일 초안은 다른 회원에게 섞일 수 있어 새 범위 저장소로 이관하지 않는다.
  useEffect(() => {
    window.localStorage.removeItem(`final-judo-notice-draft:${context.user.id}`);
  }, [context.user.id]);

  // 작성 내용은 사용자·지점·대상 유형·대상 ID가 모두 같은 경우에만 복원한다.
  useEffect(() => {
    const raw = window.localStorage.getItem(noticeDraftKey);
    const draft = parseNoticeDraft(raw);

    if (raw && !draft) {
      window.localStorage.removeItem(noticeDraftKey);
    }

    loadedNoticeDraftKeyRef.current = noticeDraftKey;
    skipNoticeDraftSaveKeyRef.current = noticeDraftKey;
    // 저장 범위 전환은 외부(localStorage/URL) 상태를 폼에 반영하는 의도적인 동기화다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNoticeTitle(draft?.title ?? "");
    setNoticeBody(draft?.body ?? "");
    setNoticeImportant(draft?.important ?? false);
    setNoticeAudience(
      draft?.audience ?? (searchParams.get("noticeAudience") === "guardian" ? ["guardian"] : defaultNoticeAudience),
    );

    if (draft?.title || draft?.body) {
      setNoticeCreateOpen(true);
    }
  }, [noticeDraftKey, searchParams]);

  function buildNoticeCreatePreview() {
    const selectedClassId = noticeTargetClasses.some((session) => session.id === noticeTargetClassId)
      ? noticeTargetClassId
      : noticeTargetClasses[0]?.id ?? "";
    const selectedMemberId = selectedNoticeMember?.id ?? "";

    if (
      !selectedNoticeBranchId ||
      !noticeTitle.trim() ||
      !noticeBody.trim() ||
      noticeAudience.length === 0 ||
      (noticeTargetType === "class" && !selectedClassId) ||
      (noticeTargetType === "member" && !selectedMemberId)
    ) {
      return null;
    }

    const payload: Omit<NoticeCreatePayload, "clientRequestId"> = {
      title: noticeTitle.trim(),
      body: noticeBody.trim(),
      important: noticeImportant,
      audience: noticeAudience,
      ...(noticeTargetType === "class" ? { targetClassIds: [selectedClassId] } : {}),
      ...(noticeTargetType === "member" ? { targetMemberIds: [selectedMemberId] } : {}),
    };
    const previewNotice: Notice = {
      id: "notice-preview",
      branchId: selectedNoticeBranchId,
      title: payload.title,
      body: payload.body,
      important: payload.important,
      audience: payload.audience,
      createdAt: new Date(0).toISOString(),
      readByUserIds: [],
      targetClassIds: payload.targetClassIds,
      targetMemberIds: payload.targetMemberIds,
    };
    const branchName = context.db.branches.find((branch) => branch.id === selectedNoticeBranchId)?.name ?? "선택 지점";
    const targetLabel = noticeTargetType === "class"
      ? noticeTargetClasses.find((session) => session.id === selectedClassId)?.name ?? "선택 수업"
      : noticeTargetType === "member"
        ? selectedNoticeMember?.name ?? "선택 회원"
        : "지점 전체";

    return {
      branchName,
      fingerprint: createNoticeRequestFingerprint(payload),
      payload,
      recipientCount: context.db.users.filter((user) => isNoticeRecipient(user, context.db, previewNotice)).length,
      targetLabel,
    };
  }

  useEffect(() => {
    if (loadedNoticeDraftKeyRef.current !== noticeDraftKey) {
      return;
    }

    if (skipNoticeDraftSaveKeyRef.current === noticeDraftKey) {
      skipNoticeDraftSaveKeyRef.current = null;
      return;
    }

    if (noticeTitle.trim() || noticeBody.trim()) {
      window.localStorage.setItem(
        noticeDraftKey,
        JSON.stringify({
          audience: noticeAudience,
          body: noticeBody,
          important: noticeImportant,
          title: noticeTitle,
        } satisfies NoticeDraft),
      );
    } else {
      window.localStorage.removeItem(noticeDraftKey);
    }
  }, [noticeAudience, noticeBody, noticeDraftKey, noticeImportant, noticeTitle]);
  const { data: notices, loading, error, reload } = useResource(
    () => apiClient.getNotices(context),
    [context.user.id, context.selectedBranchId, context.version],
  );
  const highlightNoticeId = searchParams.get("highlight")?.trim() ?? "";
  const highlightedNoticeAvailable = Boolean(
    highlightNoticeId && notices?.some((notice) => notice.id === highlightNoticeId),
  );
  const [activeHighlightNoticeId, setActiveHighlightNoticeId] = useState<string | null>(null);

  // 알림함에서 공지를 탭해 들어오면 해당 공지로 스크롤하고 잠시 강조 표시한다.
  useEffect(() => {
    if (!highlightedNoticeAvailable) {
      return;
    }

    // 딥링크 진입 시 1회 강조/펼침 — 외부 URL 상태와 동기화하는 의도적 주입.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveHighlightNoticeId(highlightNoticeId);
    setExpandedNoticeIds((current) => {
      const next = new Set(current);
      next.add(highlightNoticeId);
      return next;
    });

    const scrollTimer = window.setTimeout(() => {
      document
        .querySelector(`[data-notice-id="${CSS.escape(highlightNoticeId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    const clearTimer = window.setTimeout(() => setActiveHighlightNoticeId(null), 3500);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightNoticeId, highlightedNoticeAvailable]);

  function toggleNoticeAudience(nextAudience: NoticeAudience) {
    setNoticeAudience((current) => {
      if (nextAudience === "all") {
        return ["all"];
      }

      const withoutAll = current.filter((item) => item !== "all");

      return withoutAll.includes(nextAudience)
        ? withoutAll.filter((item) => item !== nextAudience)
        : [...withoutAll, nextAudience];
    });
  }

  function handleNoticeMemberSearchChange(value: string) {
    setNoticeMemberSearch(value);
    setNoticeMemberActiveIndex(0);

    if (selectedNoticeMember && value.trim() !== selectedNoticeMember.name) {
      setNoticeTargetMemberId("");
    }
  }

  function selectNoticeTargetMember(member: Member) {
    setNoticeTargetMemberId(member.id);
    setNoticeMemberSearch(member.name);
    setNoticeMemberActiveIndex(0);
  }

  async function handleCreateNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (noticeCreatePending) {
      return;
    }

    clearNoticeFeedback();

    const preview = buildNoticeCreatePreview();

    if (!preview) {
      setNoticeFeedback("제목, 내용, 대상 정보를 확인해 주세요.");
      return;
    }

    const { fingerprint, payload } = preview;

    if (noticeConfirmationFingerprint !== fingerprint) {
      setNoticeConfirmationFingerprint(fingerprint);
      setNoticeFeedback("발행 대상과 수신 인원을 확인한 뒤 한 번 더 눌러 발행해 주세요.");
      return;
    }

    const requestId = noticeCreateAttemptRef.current?.fingerprint === fingerprint
      ? noticeCreateAttemptRef.current.requestId
      : createNoticeRequestId();

    noticeCreateAttemptRef.current = { fingerprint, requestId };
    setNoticeCreatePending(true);
    setNoticeFeedback("공지를 발행하고 알림을 준비하는 중입니다.");

    const result = await createNotice(selectedNoticeBranchId, { ...payload, clientRequestId: requestId });

    setNoticeCreatePending(false);

    if (!result.ok) {
      setNoticeFeedback(result.message || "공지를 작성하지 못했습니다. 대상과 지점을 확인해 주세요.");
      return;
    }

    noticeCreateAttemptRef.current = null;
    setNoticeConfirmationFingerprint(null);
    window.localStorage.removeItem(noticeDraftKey);
    setNoticeFeedback(result.message);
    setNoticeTitle("");
    setNoticeBody("");
    setNoticeImportant(false);
    setNoticeAudience(defaultNoticeAudience);
    setNoticeTargetClassId("");
    setNoticeTargetMemberId("");
    setNoticeMemberSearch("");
    setNoticeTargetType("branch");
    setNoticeCreateOpen(false);
  }

  function openNoticePushConfirmation(notice: Notice) {
    clearNoticeFeedback();
    setPushConfirmationNoticeId(notice.id);
  }

  function closeNoticePushConfirmation() {
    if (pushDispatchInFlightRef.current) {
      return;
    }

    setPushConfirmationNoticeId(null);
  }

  function handlePushConfirmationKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeNoticePushConfirmation();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"),
    );
    const first = focusable[0];
    const last = focusable.at(-1);

    if (!first || !last) {
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleDispatchNoticePush(notice: Notice) {
    if (pushDispatchInFlightRef.current) {
      return;
    }

    pushDispatchInFlightRef.current = notice.id;
    setPushPendingNoticeId(notice.id);
    clearNoticeFeedback();

    try {
      const result = await apiClient.dispatchNoticePush(notice.branchId, notice.id, context.selectedBranchId);
      setPushFeedback(result.push.message);
    } catch (error) {
      setPushFeedback(error instanceof ApiClientError ? error.message : "공지 알림 발송 상태를 확인하지 못했습니다.");
    } finally {
      pushDispatchInFlightRef.current = null;
      setPushPendingNoticeId(null);
      setPushConfirmationNoticeId(null);
    }
  }

  async function handleDeleteNotice(notice: Notice) {
    setDeletingNoticeId(notice.id);
    clearNoticeFeedback();

    const result = await deleteNotice(notice.branchId, notice.id);

    setDeleteFeedback(result.message);
    setDeleteConfirmNoticeId(result.ok ? null : notice.id);
    setDeletingNoticeId(null);
  }

  function handleStartEditNotice(notice: Notice) {
    clearNoticeFeedback();
    setDeleteConfirmNoticeId(null);
    setEditingNoticeId(notice.id);
    setEditNoticeTitle(notice.title);
    setEditNoticeBody(notice.body);
    setEditNoticeImportant(notice.important === true);
  }

  function handleCancelEditNotice() {
    setEditingNoticeId(null);
    setEditNoticeTitle("");
    setEditNoticeBody("");
    setEditNoticeImportant(false);
  }

  async function handleSaveEditNotice(notice: Notice) {
    clearNoticeFeedback();

    if (!editNoticeTitle.trim() || !editNoticeBody.trim()) {
      setDeleteFeedback("공지 제목과 본문이 필요합니다.");
      return;
    }

    setSavingNoticeEditId(notice.id);

    const result = await updateNotice(notice.branchId, notice.id, {
      title: editNoticeTitle.trim(),
      body: editNoticeBody.trim(),
      important: editNoticeImportant,
    });

    setDeleteFeedback(result.message);
    setSavingNoticeEditId(null);

    if (result.ok) {
      handleCancelEditNotice();
    }
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error || !notices) {
    return <ErrorState description={error ?? "공지를 불러오지 못했습니다."} onRetry={reload} />;
  }

  const scopedNotices =
    context.user.role === "guardian" && selectedChildId
      ? notices.filter((notice) => isNoticeRelevantToMember(notice, selectedChildId, context.db.classes))
      : notices;
  const pushConfirmationNotice = pushConfirmationNoticeId
    ? scopedNotices.find((notice) => notice.id === pushConfirmationNoticeId) ?? null
    : null;
  const pushConfirmationRecipientCount = pushConfirmationNotice
    ? context.db.users.filter((user) => isNoticeRecipient(user, context.db, pushConfirmationNotice)).length
    : 0;
  const pushConfirmationBranchName = pushConfirmationNotice
    ? context.db.branches.find((branch) => branch.id === pushConfirmationNotice.branchId)?.name ?? "선택 지점"
    : "";
  const pushConfirmationTargetLabel = pushConfirmationNotice
    ? targetLabel(pushConfirmationNotice, classNameById, memberNameById)
    : "";
  const sortedNotices = sortNoticesForDisplay(scopedNotices);
  const unreadNoticeCount = scopedNotices.filter((notice) => !isNoticeReadByUser(notice, context.user.id)).length;
  const importantNoticeCount = scopedNotices.filter((notice) => notice.important).length;
  const noticeFilterOptions: Array<{ label: string; value: NoticeFilter; count: number; testId: string }> = [
    { label: "전체", value: "all", count: scopedNotices.length, testId: "notice-filter-all" },
    { label: "미읽음", value: "unread", count: unreadNoticeCount, testId: "notice-filter-unread" },
    { label: "중요", value: "important", count: importantNoticeCount, testId: "notice-filter-important" },
  ];
  const noticeSearchKeyword = showNoticeDeliveryMeta ? noticeSearch.trim() : "";
  const filteredNotices = sortedNotices.filter((notice) => {
    if (noticeSearchKeyword && !matchesNoticeMemberSearch(noticeSearchKeyword, [notice.title, notice.body])) {
      return false;
    }

    if (noticeFilter === "unread") {
      return !isNoticeReadByUser(notice, context.user.id);
    }

    if (noticeFilter === "important") {
      return Boolean(notice.important);
    }

    return true;
  });
  const filteredUnreadNoticeIds = filteredNotices
    .filter((notice) => !isNoticeReadByUser(notice, context.user.id))
    .map((notice) => notice.id);
  const showNoticeSearchEmptyState =
    showNoticeDeliveryMeta && noticeSearchKeyword.length > 0 && scopedNotices.length > 0 && filteredNotices.length === 0;
  const noticeListStatusLabel = showNoticeDeliveryMeta
    ? `${filteredNotices.length}/${scopedNotices.length}건 표시 · 미읽음 ${filteredUnreadNoticeIds.length}건`
    : `공지 ${filteredNotices.length} · 미읽음 ${filteredUnreadNoticeIds.length}`;
  const bulkReadSuccessLabel = showNoticeDeliveryMeta
    ? `보이는 미읽음 공지 ${filteredUnreadNoticeIds.length}건을 읽음 처리했습니다.`
    : `현재 공지 ${filteredUnreadNoticeIds.length}건을 읽음 처리했습니다.`;
  const bulkReadFailureLabel = showNoticeDeliveryMeta
    ? "보이는 공지를 읽음 처리하지 못했습니다."
    : "현재 공지를 읽음 처리하지 못했습니다.";
  const bulkReadButtonLabel = showNoticeDeliveryMeta ? "보이는 공지 읽음 처리" : "읽음";
  const singleReadButtonLabel = showNoticeDeliveryMeta ? "읽음" : "확인";

  async function handleMarkFilteredNoticesAsRead() {
    if (filteredUnreadNoticeIds.length === 0 || bulkReadPending) {
      return;
    }

    setBulkReadPending(true);
    clearNoticeFeedback();

    const ok = await markNoticesAsRead(filteredUnreadNoticeIds);

    setReadFeedback(ok ? bulkReadSuccessLabel : bulkReadFailureLabel);
    setBulkReadPending(false);
  }

  async function handleMarkNoticeAsRead(noticeId: string) {
    if (readNoticePendingId) {
      return;
    }

    setReadNoticePendingId(noticeId);
    clearNoticeFeedback();

    const ok = await markNoticeAsRead(noticeId);

    setReadFeedback(ok ? "공지 확인을 저장했습니다." : "공지 확인 상태를 저장하지 못했습니다.");
    setReadNoticePendingId(null);
  }

  function toggleNoticeBody(noticeId: string) {
    setExpandedNoticeIds((current) => {
      const next = new Set(current);

      if (next.has(noticeId)) {
        next.delete(noticeId);
      } else {
        next.add(noticeId);
      }

      return next;
    });
  }

  return (
    <div data-testid="notices-screen">
      <SectionHeader title="공지" />

      {context.user.role === "guardian" ? (
        <ChildSwitcher
          items={guardianChildren.map((member) => ({
            id: member.id,
            name: member.name,
            ...getChildSwitcherPresentation(member),
          }))}
          selectedChildId={selectedChildId}
          onSelect={setSelectedChildId}
        />
      ) : null}

      <div className={showNoticeAside ? "grid gap-4 xl:grid-cols-[1fr_360px]" : "grid gap-4"}>
        <section className={`${showNoticeAside ? "order-2 xl:order-1" : ""} rounded-lg border border-zinc-200 bg-white`}>
          {deleteFeedback ? (
            <div className="border-b border-zinc-100 px-3 py-2">
              <p
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700"
                data-testid="notice-delete-feedback"
                aria-live="polite"
                role="status"
              >
                {deleteFeedback}
              </p>
            </div>
          ) : null}
          {showNoticeDeliveryMeta ? (
            <div className="grid gap-3 border-b border-zinc-100 px-4 py-4">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-teal-700" aria-hidden />
                <h2 className="text-base font-semibold text-zinc-950">공지함</h2>
              </div>
              <label className="relative block sm:max-w-xs">
                <span className="sr-only">공지 검색</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 pr-12 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="notice-list-search-input"
                  placeholder="제목·내용 검색"
                  value={noticeSearch}
                  onChange={(event) => setNoticeListSearch(event.target.value)}
                />
                {noticeSearch ? (
                  <button
                    aria-label="검색어 지우기"
                    className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    data-testid="notice-list-search-clear"
                    type="button"
                    onClick={() => setNoticeListSearch("")}
                  >
                    <span aria-hidden className="text-sm font-semibold">×</span>
                  </button>
                ) : null}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2" role="group" aria-label="공지 필터">
                  {noticeFilterOptions.map((option) => (
                    <button
                      className={`inline-flex min-h-11 min-w-24 items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                        noticeFilter === option.value
                          ? "border-teal-700 bg-teal-700 text-white"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      data-testid={option.testId}
                      key={option.value}
                      type="button"
                      aria-pressed={noticeFilter === option.value}
                      onClick={() => setNoticeFilter(option.value)}
                    >
                      {option.label} {option.count}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <p className="text-sm font-medium text-zinc-600" data-testid="notice-list-status-label" aria-live="polite">
                    {noticeListStatusLabel}
                  </p>
                  {!showNoticeSearchEmptyState ? (
                    <Button
                      className="min-h-11 w-full sm:w-auto"
                      data-testid="notice-bulk-read-filtered"
                      disabled={filteredUnreadNoticeIds.length === 0 || bulkReadPending}
                      size="md"
                      variant="secondary"
                      onClick={() => void handleMarkFilteredNoticesAsRead()}
                    >
                      <CheckCheck className="h-4 w-4" aria-hidden />
                      {bulkReadPending ? "처리 중" : bulkReadButtonLabel}
                    </Button>
                  ) : null}
                </div>
              </div>
              {readFeedback ? (
                <p className="text-sm font-medium text-zinc-700" data-testid="notice-read-feedback" aria-live="polite" role="status">
                  {readFeedback}
                </p>
              ) : null}
              {pushFeedback ? (
                <p className="text-sm font-medium text-zinc-700" data-testid="notice-push-feedback" aria-live="polite" role="status">
                  {pushFeedback}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="border-b border-zinc-100 px-3 py-2" data-testid="family-notice-compact-filter-bar">
              <div
                className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(4.5rem,auto)] gap-1.5"
                data-testid="family-notice-filter-grid"
              >
                <div className="contents" role="group" aria-label="공지 필터">
                  {noticeFilterOptions.map((option) => (
                    <button
                      className={`inline-flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-md border px-1.5 text-sm font-semibold transition ${
                        noticeFilter === option.value
                          ? "border-teal-700 bg-teal-700 text-white"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      data-testid={option.testId}
                      key={option.value}
                      type="button"
                      aria-pressed={noticeFilter === option.value}
                      onClick={() => setNoticeFilter(option.value)}
                    >
                      {option.label} {option.count}
                    </button>
                  ))}
                </div>
                <Button
                  className="min-h-11 min-w-0 whitespace-nowrap px-1.5 text-sm"
                  data-testid="notice-bulk-read-filtered"
                  disabled={filteredUnreadNoticeIds.length === 0 || bulkReadPending}
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleMarkFilteredNoticesAsRead()}
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                  {bulkReadPending ? "처리 중" : bulkReadButtonLabel}
                </Button>
              </div>
              {readFeedback ? (
                <p className="mt-2 text-sm font-medium text-zinc-700" data-testid="notice-read-feedback" aria-live="polite" role="status">
                  {readFeedback}
                </p>
              ) : null}
            </div>
          )}

          {scopedNotices.length === 0 ? (
            <div className="p-4">
              <EmptyState title="확인할 공지가 없습니다" />
            </div>
          ) : filteredNotices.length === 0 && noticeSearchKeyword ? (
            <div className="p-4">
              <EmptyState
                title="검색 결과가 없습니다"
                description={`"${noticeSearchKeyword}"와 일치하는 공지가 없습니다.`}
                action={
                  <Button data-testid="notice-list-search-empty-clear" size="lg" variant="secondary" onClick={() => setNoticeListSearch("")}>
                    검색어 지우기
                  </Button>
                }
              />
            </div>
          ) : filteredNotices.length === 0 ? (
            <div className="p-4">
              <EmptyState title="선택한 보기의 공지가 없습니다" />
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {filteredNotices.map((notice) => {
                const read = isNoticeReadByUser(notice, context.user.id);
                const bodyExpanded = expandedNoticeIds.has(notice.id);
                const normalizedBodyLength = notice.body.replace(/\s+/g, " ").trim().length;
                const bodyCanCollapse = showNoticeDeliveryMeta
                  ? normalizedBodyLength > 60
                  : normalizedBodyLength > familyNoticeBodyPreviewLength;
                const showCompactReadAction = !showNoticeDeliveryMeta && !read;
                const deliveryMetaLabel = `${audienceLabel(notice.audience)} · ${targetLabel(notice, classNameById, memberNameById)} · ${formatDateTime(notice.createdAt)} · 읽음 ${getNoticeReadCount(notice)}명`;
                const visibleBody = !showNoticeDeliveryMeta && bodyCanCollapse && !bodyExpanded
                  ? compactNoticeBody(notice.body)
                  : notice.body;
                const readPending = readNoticePendingId === notice.id;
                const noticeReadTone = read ? "bg-zinc-50/70" : "bg-white";
                const noticeImportantBadgeClass = read
                  ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                  : "border-red-200 bg-red-50 text-red-700";
                const noticeReadStateBadgeClass = read
                  ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                  : "border-amber-200 bg-amber-50 text-amber-700";
                const canDeleteCurrentNotice = canDeleteNotice(context.user, context.db, notice);
                const canEditCurrentNotice = canEditNotice(context.user, context.db, notice);

                return (
                  <article
                    className={`${showNoticeDeliveryMeta ? "px-3 py-2.5" : "px-3 py-1.5"} ${noticeReadTone} transition-colors ${
                      highlightedNoticeAvailable && activeHighlightNoticeId === notice.id
                        ? "rounded-md ring-2 ring-inset ring-teal-400"
                        : ""
                    }`}
                    data-notice-id={notice.id}
                    data-notice-read-state={read ? "read" : "active"}
                    data-testid={showNoticeDeliveryMeta ? "notice-delivery-compact-card" : "family-notice-card"}
                    key={notice.id}
                  >
                    <div className={showNoticeDeliveryMeta ? "grid gap-2" : "grid gap-1.5 sm:flex sm:items-start sm:justify-between"}>
                      <div className="min-w-0 flex-1">
                        <div
                          className={
                            showNoticeDeliveryMeta
                              ? "grid gap-2 sm:flex sm:items-start sm:justify-between sm:gap-2"
                              : "flex items-start justify-between gap-2"
                          }
                        >
                          <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                            <h3
                              className={`${showNoticeDeliveryMeta ? "line-clamp-1 min-w-0" : "line-clamp-2 min-w-0"} text-[15px] font-semibold leading-5 ${
                                read ? "text-zinc-600" : "text-zinc-950"
                              }`}
                            >
                              {notice.title}
                            </h3>
                            {notice.important ? (
                              <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${noticeImportantBadgeClass}`}>
                                중요
                              </span>
                            ) : null}
                            {showNoticeDeliveryMeta ? (
                              <span
                                className={`rounded-md border px-2 py-1 text-xs font-semibold ${noticeReadStateBadgeClass}`}
                                data-testid="notice-read-state-badge"
                              >
                                {read ? "읽음" : "미읽음"}
                              </span>
                            ) : null}
                          </div>
                          {showNoticeDeliveryMeta && (!read || canPublishNotice) ? (
                            <div
                              className="flex shrink-0 items-center justify-end gap-1"
                              data-notice-action-layout="stacked-mobile"
                              data-testid="notice-delivery-action-row"
                            >
                              {!read ? (
                                <button
                                  aria-label={`${notice.title} 읽음 처리`}
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 transition hover:bg-zinc-50"
                                  data-testid="notice-delivery-read-action"
                                  disabled={readPending}
                                  title={singleReadButtonLabel}
                                  type="button"
                                  onClick={() => void handleMarkNoticeAsRead(notice.id)}
                                >
                                  <CheckCheck className="h-4 w-4" aria-hidden />
                                  <span className="sr-only">{readPending ? "저장 중" : singleReadButtonLabel}</span>
                                </button>
                              ) : null}
                              {canPublishNotice ? (
                                <button
                                  aria-label={`${notice.title} 알림 발송`}
                                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-teal-500"
                                  data-testid="notice-delivery-push-action"
                                  disabled={pushPendingNoticeId !== null}
                                  title="알림 발송 내용 확인"
                                  type="button"
                                  onClick={() => openNoticePushConfirmation(notice)}
                                >
                                  <BellRing className="h-4 w-4" aria-hidden />
                                  <span>알림 발송</span>
                                </button>
                              ) : null}
                              {canEditCurrentNotice || canDeleteCurrentNotice ? (
                                <details className="group relative" data-testid="notice-delivery-more-menu">
                                  <summary
                                    aria-label={`${notice.title} 추가 작업`}
                                    className="inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-teal-500 [&::-webkit-details-marker]:hidden"
                                    data-testid="notice-delivery-more-menu-toggle"
                                    title="추가 작업"
                                  >
                                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                                  </summary>
                                  <div className="absolute right-0 top-12 z-30 hidden w-36 gap-1 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg group-open:grid">
                                    {canEditCurrentNotice ? (
                                      <button
                                        aria-label={`${notice.title} 수정`}
                                        className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-left text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                                        data-testid="notice-delivery-edit-action"
                                        disabled={savingNoticeEditId === notice.id}
                                        type="button"
                                        onClick={(event) => {
                                          event.currentTarget.closest("details")?.removeAttribute("open");
                                          if (editingNoticeId === notice.id) {
                                            handleCancelEditNotice();
                                          } else {
                                            handleStartEditNotice(notice);
                                          }
                                        }}
                                      >
                                        <Pencil className="h-4 w-4" aria-hidden />
                                        <span>수정</span>
                                      </button>
                                    ) : null}
                                    {canDeleteCurrentNotice ? (
                                      <button
                                        aria-label={`${notice.title} 삭제`}
                                        className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                        data-testid="notice-delivery-delete-action"
                                        disabled={deletingNoticeId === notice.id}
                                        type="button"
                                        onClick={(event) => {
                                          event.currentTarget.closest("details")?.removeAttribute("open");
                                          handleCancelEditNotice();
                                          setDeleteConfirmNoticeId(notice.id);
                                          clearNoticeFeedback();
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" aria-hidden />
                                        <span>삭제</span>
                                      </button>
                                    ) : null}
                                  </div>
                                </details>
                              ) : null}
                            </div>
                          ) : null}
                          {showCompactReadAction ? (
                            <button
                              aria-label={`${notice.title} 확인 완료`}
                              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                              data-testid="family-notice-read-action"
                              disabled={readPending}
                              type="button"
                              onClick={() => void handleMarkNoticeAsRead(notice.id)}
                            >
                              <CheckCheck className="h-4 w-4" aria-hidden />
                              {readPending ? "저장 중" : singleReadButtonLabel}
                            </button>
                          ) : null}
                        </div>
                        {!showNoticeDeliveryMeta && context.user.role === "guardian" ? (
                          <p className="mt-1 text-xs font-semibold leading-5 text-teal-800" data-testid="guardian-notice-target-label">
                            대상 · {targetLabel(notice, classNameById, memberNameById, selectedChildId)}
                          </p>
                        ) : null}
                        {showNoticeDeliveryMeta ? (
                          bodyCanCollapse ? (
                            <button
                              aria-expanded={bodyExpanded}
                              aria-label={`${notice.title} 내용 ${bodyExpanded ? "접기" : "펼치기"}`}
                              className="mt-1 flex min-h-11 w-full items-start rounded-md py-1 text-left text-[13px] leading-5 text-zinc-600 outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-teal-500"
                              data-testid="notice-delivery-body-toggle"
                              type="button"
                              onClick={() => toggleNoticeBody(notice.id)}
                            >
                              <span
                                className={`${bodyExpanded ? "" : "line-clamp-2"} block break-words`}
                                data-testid="notice-delivery-body"
                              >
                                {visibleBody}
                              </span>
                            </button>
                          ) : (
                            <p
                              className="mt-1 line-clamp-2 break-words text-[13px] leading-5 text-zinc-600"
                              data-testid="notice-delivery-body"
                            >
                              {visibleBody}
                            </p>
                          )
                        ) : bodyCanCollapse ? (
                          <button
                            className={`mt-0.5 flex min-h-11 w-full items-center rounded-md py-1 text-left text-[13px] leading-5 outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-teal-500 ${
                              read ? "text-zinc-500" : "text-zinc-600"
                            }`}
                            data-testid="family-notice-detail-toggle"
                            type="button"
                            aria-expanded={bodyExpanded}
                            aria-label={`${notice.title} 내용 ${bodyExpanded ? "접기" : "펼치기"}`}
                            onClick={() => toggleNoticeBody(notice.id)}
                          >
                            <span className={`${bodyExpanded ? "" : "line-clamp-1"} block break-words`}>
                              {visibleBody}
                            </span>
                          </button>
                        ) : (
                          <p
                            className={`mt-0.5 line-clamp-1 break-words text-[13px] leading-5 ${read ? "text-zinc-500" : "text-zinc-600"}`}
                            data-testid="family-notice-body"
                          >
                            {visibleBody}
                          </p>
                        )}
                        {showNoticeDeliveryMeta ? (
                          <p className="mt-1 line-clamp-1 text-xs font-medium leading-5 text-zinc-500" data-testid="notice-delivery-meta-line">
                            {deliveryMetaLabel}
                          </p>
                        ) : null}
                        {!showNoticeDeliveryMeta ? (
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <p className={`min-w-0 text-xs ${read ? "text-zinc-400" : "text-zinc-500"}`} data-testid="family-notice-date-line">
                              {formatDateTime(notice.createdAt)}
                            </p>
                          </div>
                        ) : null}
                        {showNoticeDeliveryMeta && editingNoticeId === notice.id ? (
                          <div
                            className="mt-2 grid gap-2 rounded-md border border-teal-200 bg-teal-50/60 px-3 py-2"
                            data-testid="notice-edit-panel"
                          >
                            <label className="grid gap-1 text-xs font-semibold text-zinc-700">
                              제목
                              <input
                                className="min-h-11 rounded-md border border-zinc-200 bg-white px-3 text-sm font-normal text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                                data-testid="notice-edit-title-input"
                                maxLength={noticeInputLimits.titleLength}
                                value={editNoticeTitle}
                                onChange={(event) => setEditNoticeTitle(event.target.value)}
                              />
                            </label>
                            <label className="grid gap-1 text-xs font-semibold text-zinc-700">
                              본문
                              <textarea
                                className="min-h-20 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-normal leading-5 text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                                data-testid="notice-edit-body-input"
                                maxLength={noticeInputLimits.bodyLength}
                                rows={3}
                                value={editNoticeBody}
                                onChange={(event) => setEditNoticeBody(event.target.value)}
                              />
                            </label>
                            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-800">
                              <input
                                checked={editNoticeImportant}
                                className="h-4 w-4 rounded border-zinc-300 text-teal-600 focus:ring-teal-500"
                                data-testid="notice-edit-important-input"
                                type="checkbox"
                                onChange={(event) => setEditNoticeImportant(event.target.checked)}
                              />
                              중요 공지로 표시
                            </label>
                            <div className="flex justify-end gap-2">
                              <button
                                className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                                data-testid="notice-edit-cancel"
                                disabled={savingNoticeEditId === notice.id}
                                type="button"
                                onClick={handleCancelEditNotice}
                              >
                                취소
                              </button>
                              <button
                                className="inline-flex min-h-11 items-center justify-center rounded-md border border-teal-600 bg-teal-600 px-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                                data-testid="notice-edit-save"
                                disabled={savingNoticeEditId === notice.id}
                                type="button"
                                onClick={() => void handleSaveEditNotice(notice)}
                              >
                                {savingNoticeEditId === notice.id ? "저장 중" : "수정 저장"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {showNoticeDeliveryMeta && deleteConfirmNoticeId === notice.id ? (
                          <div
                            className="mt-2 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                            data-testid="notice-delete-confirm"
                          >
                            <p className="text-sm font-semibold text-red-800">이 공지를 삭제합니다.</p>
                            <div className="flex gap-2">
                              <button
                                className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                                data-testid="notice-delete-cancel"
                                disabled={deletingNoticeId === notice.id}
                                type="button"
                                onClick={() => setDeleteConfirmNoticeId(null)}
                              >
                                취소
                              </button>
                              <button
                                className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-600 bg-red-600 px-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                                data-testid="notice-delete-confirm-action"
                                disabled={deletingNoticeId === notice.id}
                                type="button"
                                onClick={() => void handleDeleteNotice(notice)}
                              >
                                {deletingNoticeId === notice.id ? "삭제 중" : "삭제"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {showNoticeAside ? (
        <aside className="order-1 grid h-fit gap-4 xl:order-2">
          {canPublishNotice ? (
            <section className="rounded-lg border border-zinc-200 bg-white p-3" data-testid="notice-create-panel">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Send className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold leading-5 text-zinc-950">공지 작성</h2>
                    <p className="line-clamp-1 text-[11px] font-medium leading-4 text-zinc-500">
                      {noticeTitle.trim() || "새 공지"}
                    </p>
                  </div>
                </div>
                <button
                  aria-expanded={noticeCreateOpen}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                  data-testid="notice-create-toggle"
                  type="button"
                  onClick={() => setNoticeCreateOpen((open) => !open)}
                >
                  {noticeCreateOpen ? "접기" : "작성 열기"}
                </button>
              </div>
              {noticeFeedback ? (
                <p className="mt-2 text-sm font-medium text-zinc-700" data-testid="notice-create-feedback" aria-live="polite" role="status">
                  {noticeFeedback}
                </p>
              ) : null}
              {noticeCreateOpen ? (
                <form
                  aria-busy={noticeCreatePending}
                  className="mt-3"
                  data-testid="notice-create-form"
                  onSubmit={handleCreateNotice}
                >
                  <fieldset className="grid gap-3 border-0 p-0" disabled={noticeCreatePending}>
                    <legend className="sr-only">공지 발행 정보</legend>
                  {context.db.branches.length > 1 ? (
                    <label>
                      <span className="mb-1 block text-xs font-semibold text-zinc-500">지점</span>
                      <select
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                        data-testid="notice-create-branch-select"
                        value={selectedNoticeBranchId}
                        onChange={(event) => {
                          setNoticeBranchId(event.target.value);
                          setNoticeTargetClassId("");
                          setNoticeTargetMemberId("");
                          setNoticeMemberSearch("");
                        }}
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
                    <span className="mb-1 block text-xs font-semibold text-zinc-500">제목</span>
                    <input
                      className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                      data-testid="notice-create-title-input"
                      maxLength={noticeInputLimits.titleLength}
                      placeholder="공지 제목"
                      value={noticeTitle}
                      onChange={(event) => setNoticeTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-semibold text-zinc-500">내용</span>
                    <textarea
                      className="min-h-28 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                      maxLength={noticeInputLimits.bodyLength}
                      placeholder="공지 내용"
                      value={noticeBody}
                      onChange={(event) => setNoticeBody(event.target.value)}
                    />
                  </label>
                  <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700">
                    <input
                      className="h-4 w-4 accent-red-600"
                      checked={noticeImportant}
                      type="checkbox"
                      onChange={(event) => setNoticeImportant(event.target.checked)}
                    />
                    중요 공지
                  </label>
                  <fieldset>
                    <legend className="mb-2 text-xs font-semibold text-zinc-500">공지 대상</legend>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700">
                        <input
                          className="h-4 w-4 accent-teal-700"
                          checked={noticeAudience.includes("all")}
                          type="checkbox"
                          onChange={() => toggleNoticeAudience("all")}
                        />
                        전체
                      </label>
                      {userRoles.map((role) => (
                        <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700" key={role}>
                          <input
                            className="h-4 w-4 accent-teal-700"
                            checked={noticeAudience.includes(role)}
                            type="checkbox"
                            onChange={() => toggleNoticeAudience(role)}
                          />
                          {roleLabels[role]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="mb-2 text-xs font-semibold text-zinc-500">받는 대상</legend>
                    <div className="grid gap-2">
                      <div className="flex flex-wrap gap-2">
                        {([
                          { label: context.user.role === "coach" ? "담당 회원 전체" : "지점 전체", value: "branch" },
                          { label: "반 대상", value: "class" },
                          { label: "개인 대상", value: "member" },
                        ] as Array<{ label: string; value: NoticeTargetType }>).map((option) => (
                          <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700" key={option.value}>
                            <input
                              className="h-4 w-4 accent-teal-700"
                              checked={noticeTargetType === option.value}
                              name="notice-target-type"
                              type="radio"
                              onChange={() => setNoticeTargetType(option.value)}
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>

                      {noticeTargetType === "class" ? (
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">대상 반</span>
                          <select
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-testid="notice-create-class-select"
                            value={noticeTargetClasses.some((session) => session.id === noticeTargetClassId) ? noticeTargetClassId : noticeTargetClasses[0]?.id ?? ""}
                            onChange={(event) => setNoticeTargetClassId(event.target.value)}
                          >
                            {noticeTargetClasses.length === 0 ? (
                              <option value="">선택 가능한 반 없음</option>
                            ) : (
                              noticeTargetClasses.map((session) => (
                                <option key={session.id} value={session.id}>
                                  {session.name}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                      ) : null}

                      {noticeTargetType === "member" ? (
                        <div className="grid gap-2" data-testid="notice-create-member-search">
                          <label>
                            <span className="mb-1 block text-xs font-semibold text-zinc-500">대상 회원 검색</span>
                            <input
                              aria-activedescendant={
                                noticeMemberSearchResults.length > 0
                                  ? `notice-member-option-${noticeMemberSearchResults[Math.min(noticeMemberActiveIndex, noticeMemberSearchResults.length - 1)].id}`
                                  : undefined
                              }
                              aria-autocomplete="list"
                              aria-controls="notice-member-search-results"
                              aria-expanded={showNoticeMemberSearchResults}
                              className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                              data-testid="notice-create-member-search-input"
                              placeholder="회원 이름, 연락처, 보호자 검색"
                              role="combobox"
                              value={noticeMemberSearch}
                              onChange={(event) => handleNoticeMemberSearchChange(event.target.value)}
                              onKeyDown={(event) => {
                                if (noticeMemberSearchResults.length === 0) {
                                  return;
                                }

                                if (event.key === "ArrowDown") {
                                  event.preventDefault();
                                  setNoticeMemberActiveIndex((current) =>
                                    Math.min(current + 1, noticeMemberSearchResults.length - 1),
                                  );
                                } else if (event.key === "ArrowUp") {
                                  event.preventDefault();
                                  setNoticeMemberActiveIndex((current) => Math.max(current - 1, 0));
                                } else if (event.key === "Enter") {
                                  event.preventDefault();
                                  selectNoticeTargetMember(
                                    noticeMemberSearchResults[Math.min(noticeMemberActiveIndex, noticeMemberSearchResults.length - 1)],
                                  );
                                }
                              }}
                            />
                          </label>

                          {selectedNoticeMember ? (
                            <div
                              className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2"
                              data-testid="notice-create-selected-member"
                            >
                              <p className="text-xs font-semibold text-teal-700">선택 회원</p>
                              <p className="mt-0.5 text-sm font-semibold text-zinc-950">{selectedNoticeMember.name}</p>
                            </div>
                          ) : null}

                          {showNoticeMemberSearchResults ? (
                            <div
                              aria-label="공지 대상 회원 검색 결과"
                              className="max-h-56 overflow-y-auto rounded-md border border-zinc-200 bg-white"
                              data-testid="notice-create-member-results"
                              id="notice-member-search-results"
                              role="listbox"
                            >
                              {noticeTargetMembers.length === 0 ? (
                                <p className="px-3 py-3 text-sm font-medium text-zinc-500">선택 가능한 회원 없음</p>
                              ) : noticeMemberSearchQuery.length === 0 ? (
                                <p className="px-3 py-3 text-sm font-medium text-zinc-500">회원 이름 또는 연락처를 검색해 주세요.</p>
                              ) : noticeMemberSearchResults.length === 0 ? (
                                <p className="px-3 py-3 text-sm font-medium text-zinc-500">검색 결과 없음</p>
                              ) : (
                                noticeMemberSearchResults.map((member) => {
                                  const guardians = member.guardianIds
                                    .map((guardianId) => context.db.users.find((user) => user.id === guardianId)?.name)
                                    .filter(Boolean)
                                    .join(", ");
                                  const selected = member.id === noticeTargetMemberId;

                                  return (
                                    <button
                                      aria-selected={selected}
                                      className={`grid w-full gap-1 border-b border-zinc-100 px-3 py-2 text-left text-sm transition last:border-b-0 ${
                                        selected ? "bg-teal-50 text-teal-900" : "bg-white text-zinc-800 hover:bg-zinc-50"
                                      }`}
                                      data-testid="notice-create-member-result"
                                      id={`notice-member-option-${member.id}`}
                                      key={member.id}
                                      role="option"
                                      type="button"
                                      onClick={() => selectNoticeTargetMember(member)}
                                    >
                                      <span className="font-semibold">{member.name}</span>
                                      <span className="text-xs font-medium text-zinc-500">
                                        {[member.level, member.belt, guardians ? `보호자 ${guardians}` : null].filter(Boolean).join(" · ")}
                                      </span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </fieldset>
                  {(() => {
                    const preview = buildNoticeCreatePreview();
                    const confirmationCurrent = Boolean(preview && preview.fingerprint === noticeConfirmationFingerprint);

                    return confirmationCurrent && preview ? (
                      <div
                        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
                        data-testid="notice-create-confirmation"
                        role="alert"
                      >
                        <p className="font-semibold">발행 전 최종 확인</p>
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-5">
                          <dt className="text-amber-700">지점</dt><dd className="font-semibold">{preview.branchName}</dd>
                          <dt className="text-amber-700">대상</dt><dd className="font-semibold">{preview.targetLabel}</dd>
                          <dt className="text-amber-700">역할</dt><dd className="font-semibold">{audienceLabel(noticeAudience)}</dd>
                          <dt className="text-amber-700">수신자</dt><dd className="font-semibold">{preview.recipientCount}명</dd>
                          <dt className="text-amber-700">중요</dt><dd className="font-semibold">{noticeImportant ? "중요 공지" : "일반 공지"}</dd>
                        </dl>
                        <p className="mt-2 text-xs leading-5">발행하면 알림함에 표시되고 연결된 기기의 푸시 발송도 시작됩니다.</p>
                        <button
                          className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-4"
                          type="button"
                          onClick={() => setNoticeConfirmationFingerprint(null)}
                        >
                          내용 다시 수정
                        </button>
                      </div>
                    ) : null;
                  })()}
                  <Button
                    className="min-h-11"
                    disabled={
                      noticeCreatePending ||
                      !noticeTitle.trim() ||
                      !noticeBody.trim() ||
                      noticeAudience.length === 0 ||
                      (noticeTargetType === "class" && noticeTargetClasses.length === 0) ||
                      (noticeTargetType === "member" && !selectedNoticeMember)
                    }
                    data-testid="notice-create-submit"
                    size="lg"
                    type="submit"
                    variant="primary"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    {noticeCreatePending
                      ? "발행 중"
                      : buildNoticeCreatePreview()?.fingerprint === noticeConfirmationFingerprint
                        ? "확인 후 발행"
                        : "발행 내용 확인"}
                  </Button>
                  </fieldset>
                </form>
              ) : null}
            </section>
          ) : null}
        </aside>
        ) : null}
      </div>
      {pushConfirmationNotice ? (
        <div
          aria-labelledby="notice-push-confirmation-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 p-3 sm:items-center"
          data-testid="notice-push-confirmation-dialog"
          role="dialog"
          onKeyDown={handlePushConfirmationKeyDown}
        >
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                <BellRing className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-zinc-950" id="notice-push-confirmation-title">
                  공지 알림을 발송할까요?
                </h2>
                <p className="mt-1 text-sm leading-5 text-zinc-600">확인 후 연결된 기기로 알림 발송을 한 번 요청합니다.</p>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-y border-zinc-100 py-3 text-sm leading-5">
              <dt className="font-medium text-zinc-500">제목</dt>
              <dd className="break-words font-semibold text-zinc-950" data-testid="notice-push-confirmation-notice-title">
                {pushConfirmationNotice.title}
              </dd>
              <dt className="font-medium text-zinc-500">지점</dt>
              <dd className="font-semibold text-zinc-800">{pushConfirmationBranchName}</dd>
              <dt className="font-medium text-zinc-500">대상 역할</dt>
              <dd className="font-semibold text-zinc-800" data-testid="notice-push-confirmation-audience">
                {audienceLabel(pushConfirmationNotice.audience)}
              </dd>
              <dt className="font-medium text-zinc-500">대상 범위</dt>
              <dd className="break-words font-semibold text-zinc-800" data-testid="notice-push-confirmation-target">
                {pushConfirmationTargetLabel}
              </dd>
              <dt className="font-medium text-zinc-500">예상 수신</dt>
              <dd className="font-semibold text-zinc-800" data-testid="notice-push-confirmation-recipient-count">
                앱 알림함 {pushConfirmationRecipientCount}명
              </dd>
            </dl>

            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium leading-5 text-amber-900">
              이미 발송한 공지를 다시 보내는 동작입니다. 같은 기기에 알림이 중복 표시될 수 있습니다.
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              휴대폰 푸시 수신 수는 기기 연결과 알림 권한 상태에 따라 예상 인원과 다를 수 있습니다.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-teal-500"
                data-testid="notice-push-confirmation-cancel"
                disabled={pushPendingNoticeId === pushConfirmationNotice.id}
                ref={pushConfirmationCancelRef}
                type="button"
                onClick={closeNoticePushConfirmation}
              >
                취소
              </button>
              <button
                aria-busy={pushPendingNoticeId === pushConfirmationNotice.id}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="notice-push-confirmation-submit"
                disabled={pushPendingNoticeId === pushConfirmationNotice.id}
                type="button"
                onClick={() => void handleDispatchNoticePush(pushConfirmationNotice)}
              >
                <BellRing className="h-4 w-4" aria-hidden />
                {pushPendingNoticeId === pushConfirmationNotice.id ? "발송 요청 중" : "확인 후 발송"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div aria-hidden className="h-28 lg:hidden" data-testid="notice-bottom-safe-area" />
    </div>
  );
}
