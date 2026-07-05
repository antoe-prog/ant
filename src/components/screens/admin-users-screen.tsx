"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, ExternalLink, KeyRound, Pencil, Save, Search, Trash2, UserCheck, UserCog, UserPlus, X } from "lucide-react";
import { useApiContext } from "@/hooks/use-api-context";
import { userRoles, type AppUser, type Member, type MockDatabase, type UserRole } from "@/lib/domain";
import { formatPhoneNumber } from "@/lib/format";
import { invitationLinkCopyFallbackMessage, invitationLinkCopySuccessMessage } from "@/lib/invitation-link-copy";
import { canMemberHaveGuardianLink } from "@/lib/member-age-policy";
import { matchesMemberSearch } from "@/lib/notice-member-search";
import { roleLabels, roleManagementScopeLabels } from "@/lib/roles";
import { getVisibleUserEmail } from "@/lib/user-display";
import { useAppStore } from "@/store/app-store";
import { Button, RoleBadge, SectionHeader } from "@/components/ui/primitives";

const adminUserRoleFilters: UserRole[] = ["owner", "coach", "guardian", "member"];

type UserEditDraft = {
  branchIds: string[];
  childMemberIds: string[];
  email: string;
  memberLinkSearch: string;
  memberIds: string[];
  name: string;
  password: string;
  passwordConfirm: string;
  phone: string;
  reason: string;
  role: UserRole;
  title: string;
};

function getUserQueryFromParams(params: Pick<URLSearchParams, "get">) {
  return params.get("q")?.trim() ?? "";
}

function getRoleFilterFromParams(params: Pick<URLSearchParams, "get">): UserRole | "all" {
  const role = params.get("role");

  return adminUserRoleFilters.includes(role as UserRole) ? (role as UserRole) : "all";
}

function getInvitationPathForUser(user: AppUser) {
  return user.invitationToken ? `/invite/${user.invitationToken}` : null;
}

function sortUsersForInvitationReview(users: AppUser[]) {
  const pendingUsers = users
    .filter((user) => user.invitationStatus === "pending")
    .sort((left, right) => (right.invitedAt ?? "").localeCompare(left.invitedAt ?? ""));
  const activeUsers = users.filter((user) => user.invitationStatus !== "pending");

  return [...pendingUsers, ...activeUsers];
}

function createUserEditDraft(user: AppUser): UserEditDraft {
  return {
    branchIds: user.branchIds,
    childMemberIds: user.childMemberIds ?? [],
    email: getVisibleUserEmail(user.email) ?? "",
    memberLinkSearch: "",
    memberIds: user.memberIds ?? [],
    name: user.name,
    password: "",
    passwordConfirm: "",
    phone: formatPhoneNumber(user.phone ?? ""),
    reason: "",
    role: user.role,
    title: user.title,
  };
}

function createDeleteBlockers(user: AppUser, db: MockDatabase, actorUserId: string) {
  const blockers: string[] = [];

  if (user.id === actorUserId) {
    blockers.push("현재 로그인 계정");
  }

  if (user.role === "admin" && db.users.filter((candidate) => candidate.role === "admin").length <= 1) {
    blockers.push("마지막 총괄 어드민");
  }

  if (db.classes.some((session) => session.coachId === user.id)) {
    blockers.push("담당 수업 연결");
  }

  if (db.members.some((member) => member.primaryCoachId === user.id)) {
    blockers.push("담당 회원 연결");
  }

  if (user.role === "owner") {
    const ownerOnlyBranchNames = user.branchIds
      .filter(
        (branchId) =>
          !db.users.some(
            (candidate) => candidate.id !== user.id && candidate.role === "owner" && candidate.branchIds.includes(branchId),
          ),
      )
      .map((branchId) => db.branches.find((branch) => branch.id === branchId)?.name ?? branchId);

    if (ownerOnlyBranchNames.length > 0) {
      blockers.push(`대표 미배정 지점: ${ownerOnlyBranchNames.join(", ")}`);
    }
  }

  return blockers;
}

function getLinkedUserMembers(user: AppUser, memberById: Map<string, Member>) {
  return Array.from(new Set([...(user.memberIds ?? []), ...(user.childMemberIds ?? [])]))
    .map((memberId) => memberById.get(memberId))
    .filter((member): member is Member => Boolean(member));
}

function getLinkedMemberDisplay(member: Member, branchById: Map<string, MockDatabase["branches"][number]>) {
  const branchName = branchById.get(member.branchId)?.name ?? "지점 확인";
  const contact = member.emergencyContact ? ` · ${formatPhoneNumber(member.emergencyContact)}` : "";

  return `${member.name} · ${branchName}${contact}`;
}

function getLinkedMemberSummary(user: AppUser, linkedMembers: Member[], branchById: Map<string, MockDatabase["branches"][number]>) {
  if (linkedMembers.length === 0) {
    return null;
  }

  const label = user.role === "guardian" ? "자녀" : "앱 연결";
  const visibleMembers = linkedMembers.slice(0, 2).map((member) => getLinkedMemberDisplay(member, branchById));
  const remaining = linkedMembers.length > visibleMembers.length ? ` 외 ${linkedMembers.length - visibleMembers.length}명` : "";

  return `${label} ${visibleMembers.join(", ")}${remaining}`;
}

function scrollUserPanelIntoView(panelId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.getElementById(panelId)?.scrollIntoView({ block: "start", inline: "nearest" });
    });
  });
}

function clearUserPanelHash(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const hashTarget = window.location.hash.slice(1);

  if (hashTarget !== `edit-${userId}` && hashTarget !== `approve-${userId}`) {
    return;
  }

  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

export function AdminUsersScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const context = useApiContext();
  const { approveInvitation, createInvitation, deleteUser, resetUserPassword, updateUser } = useAppStore();
  const queryParam = getUserQueryFromParams(searchParams);
  const roleFilterParam = getRoleFilterFromParams(searchParams);
  const previousListFilterParamRef = useRef({ query: queryParam, role: roleFilterParam });
  const [query, setQuery] = useState(queryParam);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("coach");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<UserRole | "all">(roleFilterParam);
  const [inviteBranchIds, setInviteBranchIds] = useState<string[]>([]);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [approvalFeedbacks, setApprovalFeedbacks] = useState<Record<string, string>>({});
  const [approvalConfirmUserId, setApprovalConfirmUserId] = useState<string | null>(null);
  const [approvalPendingUserId, setApprovalPendingUserId] = useState<string | null>(null);
  const [approvedInvitationPassword, setApprovedInvitationPassword] = useState<{ userId: string; value: string } | null>(null);
  const [passwordReasons, setPasswordReasons] = useState<Record<string, string>>({});
  const [passwordFeedbacks, setPasswordFeedbacks] = useState<Record<string, string>>({});
  const [passwordPendingUserId, setPasswordPendingUserId] = useState<string | null>(null);
  const [passwordResetOpenUserId, setPasswordResetOpenUserId] = useState<string | null>(null);
  const [issuedPassword, setIssuedPassword] = useState<{ userId: string; value: string } | null>(null);
  const [editOpenUserId, setEditOpenUserId] = useState<string | null>(null);
  const [deleteOpenUserId, setDeleteOpenUserId] = useState<string | null>(null);
  const [userEditDrafts, setUserEditDrafts] = useState<Record<string, UserEditDraft>>({});
  const [deleteReasons, setDeleteReasons] = useState<Record<string, string>>({});
  const [userActionFeedbacks, setUserActionFeedbacks] = useState<Record<string, string>>({});
  const [pendingUserAction, setPendingUserAction] = useState<{ kind: "delete" | "update"; userId: string } | null>(null);
  const branchById = useMemo(() => new Map(context.db.branches.map((branch) => [branch.id, branch])), [context.db.branches]);
  const memberById = useMemo(() => new Map(context.db.members.map((member) => [member.id, member])), [context.db.members]);
  const linkedMembersByUserId = useMemo(
    () => new Map(context.db.users.map((user) => [user.id, getLinkedUserMembers(user, memberById)])),
    [context.db.users, memberById],
  );
  const deleteBlockersByUserId = useMemo(
    () => new Map(context.db.users.map((user) => [user.id, createDeleteBlockers(user, context.db, context.user.id)])),
    [context.db, context.user.id],
  );
  const roleFilterCounts = useMemo(() => {
    const counts = new Map<UserRole, number>();

    for (const role of adminUserRoleFilters) {
      counts.set(role, context.db.users.filter((user) => user.role === role).length);
    }

    return counts;
  }, [context.db.users]);
  const filteredUsers = useMemo(() => {
    const keyword = query.trim();
    const roleFilteredUsers =
      selectedRoleFilter === "all" ? context.db.users : context.db.users.filter((user) => user.role === selectedRoleFilter);

    const matchedUsers = keyword
      ? roleFilteredUsers.filter((user) =>
          matchesMemberSearch(keyword, [
            user.name,
            user.phone ?? "",
            getVisibleUserEmail(user.email) ?? "",
            user.title,
            roleLabels[user.role],
            roleManagementScopeLabels[user.role],
            ...user.branchIds.map((branchId) => branchById.get(branchId)?.name),
            ...(linkedMembersByUserId.get(user.id) ?? []).flatMap((member) => [
              member.name,
              member.level,
              member.belt,
              member.emergencyContact,
              branchById.get(member.branchId)?.name,
            ]),
          ]),
        )
      : roleFilteredUsers;

    return sortUsersForInvitationReview(matchedUsers);
  }, [branchById, context.db.users, linkedMembersByUserId, query, selectedRoleFilter]);
  const pendingInvitations = context.db.users.filter((user) => user.invitationStatus === "pending");
  const activeUsers = context.db.users.filter((user) => user.invitationStatus !== "pending");
  const hasActiveListFilter = selectedRoleFilter !== "all" || Boolean(query.trim());
  const listStatusTotalCount =
    selectedRoleFilter === "all" ? context.db.users.length : context.db.users.filter((user) => user.role === selectedRoleFilter).length;
  const inviteCanSubmit =
    Boolean(inviteName.trim()) &&
    Boolean(invitePhone.trim()) &&
    (inviteRole === "admin" || inviteBranchIds.length > 0);

  function resetListFilters() {
    setQuery("");
    setSelectedRoleFilter("all");
  }

  function toggleInviteBranch(branchId: string) {
    setInviteBranchIds((current) =>
      current.includes(branchId) ? current.filter((candidate) => candidate !== branchId) : [...current, branchId],
    );
  }

  function openUserEdit(user: AppUser) {
    if (editOpenUserId === user.id) {
      closeUserPanels(user.id);
      return;
    }

    setUserEditDrafts((current) => ({
      ...current,
      [user.id]: current[user.id] ?? createUserEditDraft(user),
    }));
    setDeleteOpenUserId(null);
    setPasswordResetOpenUserId(null);
    setApprovalConfirmUserId(null);
    setEditOpenUserId(user.id);
    scrollUserPanelIntoView(`admin-user-edit-${user.id}`);
  }

  useEffect(() => {
    function openHashTarget() {
      const hashTarget = window.location.hash.slice(1).match(/^(edit|approve)-(.+)$/);
      const hashAction = hashTarget?.[1];
      const userId = hashTarget?.[2];

      if (!userId) {
        return;
      }

      const targetUser = context.db.users.find((user) => user.id === userId);

      if (!targetUser) {
        return;
      }

      if (hashAction === "approve") {
        if (targetUser.invitationStatus !== "pending") {
          return;
        }

        setEditOpenUserId(null);
        setDeleteOpenUserId(null);
        setPasswordResetOpenUserId(null);
        setApprovalConfirmUserId(targetUser.id);
        scrollUserPanelIntoView(`admin-user-approve-invitation-confirm-${targetUser.id}`);
        return;
      }

      setUserEditDrafts((current) => ({
        ...current,
        [targetUser.id]: current[targetUser.id] ?? createUserEditDraft(targetUser),
      }));
      setDeleteOpenUserId(null);
      setPasswordResetOpenUserId(null);
      setApprovalConfirmUserId(null);
      setEditOpenUserId(targetUser.id);
      scrollUserPanelIntoView(`admin-user-edit-${targetUser.id}`);
    }

    openHashTarget();
    window.addEventListener("hashchange", openHashTarget);

    return () => {
      window.removeEventListener("hashchange", openHashTarget);
    };
  }, [context.db.users]);

  useEffect(() => {
    if (
      previousListFilterParamRef.current.query === queryParam &&
      previousListFilterParamRef.current.role === roleFilterParam
    ) {
      return;
    }

    previousListFilterParamRef.current = { query: queryParam, role: roleFilterParam };
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        setQuery(queryParam);
        setSelectedRoleFilter(roleFilterParam);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [queryParam, roleFilterParam]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const trimmedQuery = query.trim();

    if (trimmedQuery) {
      url.searchParams.set("q", trimmedQuery);
    } else {
      url.searchParams.delete("q");
    }

    if (selectedRoleFilter === "all") {
      url.searchParams.delete("role");
    } else {
      url.searchParams.set("role", selectedRoleFilter);
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      router.replace(nextUrl, { scroll: false });
    }
  }, [query, router, selectedRoleFilter]);

  function getUserEditDraft(user: AppUser) {
    return userEditDrafts[user.id] ?? createUserEditDraft(user);
  }

  function updateUserEditDraft(user: AppUser, patch: Partial<UserEditDraft>) {
    setUserEditDrafts((current) => ({
      ...current,
      [user.id]: {
        ...(current[user.id] ?? createUserEditDraft(user)),
        ...patch,
      },
    }));
  }

  function toggleUserEditBranch(user: AppUser, branchId: string) {
    const draft = getUserEditDraft(user);
    const nextBranchIds = draft.branchIds.includes(branchId)
      ? draft.branchIds.filter((candidate) => candidate !== branchId)
      : [...draft.branchIds, branchId];
    const linkedMemberIdsInScope = (memberIds: string[]) =>
      memberIds.filter((memberId) => context.db.members.some((member) => member.id === memberId && nextBranchIds.includes(member.branchId)));

    updateUserEditDraft(user, {
      branchIds: nextBranchIds,
      childMemberIds: linkedMemberIdsInScope(draft.childMemberIds),
      memberLinkSearch: "",
      memberIds: linkedMemberIdsInScope(draft.memberIds),
    });
  }

  function toggleGuardianChildMember(user: AppUser, memberId: string) {
    const draft = getUserEditDraft(user);

    updateUserEditDraft(user, {
      childMemberIds: draft.childMemberIds.includes(memberId)
        ? draft.childMemberIds.filter((candidate) => candidate !== memberId)
        : [...draft.childMemberIds, memberId],
    });
  }

  function openUserDelete(user: AppUser) {
    const blockers = deleteBlockersByUserId.get(user.id) ?? [];

    if (blockers.length > 0) {
      setUserActionFeedbacks((current) => ({ ...current, [user.id]: `삭제 제한: ${blockers.join(", ")}` }));
      setDeleteOpenUserId(null);
      setApprovalConfirmUserId(null);
      return;
    }

    if (deleteOpenUserId === user.id) {
      setDeleteOpenUserId(null);
      return;
    }

    setEditOpenUserId(null);
    setPasswordResetOpenUserId(null);
    setApprovalConfirmUserId(null);
    setDeleteOpenUserId(user.id);
    scrollUserPanelIntoView(`admin-user-delete-${user.id}`);
  }

  function closeUserPanels(userId: string) {
    clearUserPanelHash(userId);
    setEditOpenUserId((current) => (current === userId ? null : current));
    setDeleteOpenUserId((current) => (current === userId ? null : current));
    setPasswordResetOpenUserId((current) => (current === userId ? null : current));
    setApprovalConfirmUserId((current) => (current === userId ? null : current));
  }

  function removeUserDraft(userId: string) {
    setUserEditDrafts((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
    setDeleteReasons((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
    setApprovalFeedbacks((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
    setApprovedInvitationPassword((current) => (current?.userId === userId ? null : current));
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>, targetUser: AppUser) {
    event.preventDefault();

    const draft = getUserEditDraft(targetUser);
    const branchIds = draft.role === "admin" ? context.db.branches.map((branch) => branch.id) : draft.branchIds;

    if (!draft.name.trim() || !draft.phone.trim() || !draft.title.trim() || (draft.role !== "admin" && branchIds.length === 0)) {
      setUserActionFeedbacks((current) => ({ ...current, [targetUser.id]: "이름, 휴대폰 번호, 설명, 담당 지점을 확인해 주세요." }));
      return;
    }

    if ((draft.password || draft.passwordConfirm) && (draft.password.length < 12 || draft.password !== draft.passwordConfirm)) {
      setUserActionFeedbacks((current) => ({ ...current, [targetUser.id]: "새 비밀번호는 12자 이상이며 확인 입력과 같아야 합니다." }));
      return;
    }

    setPendingUserAction({ kind: "update", userId: targetUser.id });
    setUserActionFeedbacks((current) => ({ ...current, [targetUser.id]: "" }));

    const ok = await updateUser(targetUser.id, {
      branchIds,
      childMemberIds: draft.role === "guardian" ? draft.childMemberIds : [],
      email: draft.email.trim() || undefined,
      memberIds: draft.role === "member" ? draft.memberIds : [],
      name: draft.name.trim(),
      ...(draft.password ? { password: draft.password } : {}),
      phone: draft.phone.trim(),
      reason: "",
      role: draft.role,
      title: draft.title.trim(),
    });

    setPendingUserAction(null);

    if (!ok) {
      setUserActionFeedbacks((current) => ({ ...current, [targetUser.id]: "사용자 정보를 수정하지 못했습니다. 휴대폰 번호 중복, 지점, 내 계정 보호를 확인해 주세요." }));
      return;
    }

    removeUserDraft(targetUser.id);
    closeUserPanels(targetUser.id);
  }

  async function handleDeleteUser(event: FormEvent<HTMLFormElement>, targetUser: AppUser) {
    event.preventDefault();

    const reason = deleteReasons[targetUser.id]?.trim() ?? "";

    if (!reason) {
      setUserActionFeedbacks((current) => ({ ...current, [targetUser.id]: "삭제 사유를 입력해 주세요." }));
      return;
    }

    setPendingUserAction({ kind: "delete", userId: targetUser.id });
    setUserActionFeedbacks((current) => ({ ...current, [targetUser.id]: "" }));

    const ok = await deleteUser(targetUser.id, { reason });

    setPendingUserAction(null);

    if (!ok) {
      setUserActionFeedbacks((current) => ({
        ...current,
        [targetUser.id]: "사용자 계정을 삭제하지 못했습니다. 본인 계정, 마지막 총괄 어드민, 담당 수업/회원 연결을 확인해 주세요.",
      }));
      return;
    }

    removeUserDraft(targetUser.id);
    closeUserPanels(targetUser.id);
  }

  async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteFormOpen(true);

    if (!inviteCanSubmit) {
      setInviteFeedback("이름, 휴대폰 번호, 역할과 담당 지점을 확인해 주세요.");
      return;
    }

    const path = await createInvitation({
      name: inviteName.trim(),
      email: inviteEmail.trim() || undefined,
      phone: invitePhone.trim(),
      role: inviteRole,
      branchIds: inviteRole === "admin" ? [] : inviteBranchIds,
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

  async function handleCopyPendingInvitationLink(targetUser: AppUser, path: string) {
    const link = new URL(path, window.location.origin).toString();

    try {
      await navigator.clipboard.writeText(link);
      setApprovalFeedbacks((current) => ({ ...current, [targetUser.id]: invitationLinkCopySuccessMessage }));
    } catch {
      setApprovalFeedbacks((current) => ({ ...current, [targetUser.id]: invitationLinkCopyFallbackMessage }));
    }
  }

  function openInvitationApprovalConfirm(targetUser: AppUser) {
    if (approvalConfirmUserId === targetUser.id) {
      setApprovalConfirmUserId(null);
      return;
    }

    setApprovalFeedbacks((current) => ({ ...current, [targetUser.id]: "" }));
    setApprovedInvitationPassword((current) => (current?.userId === targetUser.id ? null : current));
    setEditOpenUserId(null);
    setDeleteOpenUserId(null);
    setPasswordResetOpenUserId(null);
    setApprovalConfirmUserId(targetUser.id);
    scrollUserPanelIntoView(`admin-user-approve-invitation-confirm-${targetUser.id}`);
  }

  async function handleApproveInvitation(targetUser: AppUser) {
    setApprovalConfirmUserId(null);
    setApprovalPendingUserId(targetUser.id);
    setApprovalFeedbacks((current) => ({ ...current, [targetUser.id]: "" }));
    setApprovedInvitationPassword((current) => (current?.userId === targetUser.id ? null : current));

    const approval = await approveInvitation(targetUser.id);

    setApprovalPendingUserId(null);

    if (!approval) {
      setApprovalFeedbacks((current) => ({ ...current, [targetUser.id]: "초대를 승인하지 못했습니다. 권한과 담당 지점을 확인해 주세요." }));
      return;
    }

    if (approval.temporaryPassword) {
      setApprovedInvitationPassword({ userId: targetUser.id, value: approval.temporaryPassword });
      setApprovalFeedbacks((current) => ({ ...current, [targetUser.id]: "초대를 승인했습니다. 첫 접속 비밀번호를 안전한 채널로 전달하세요." }));
      return;
    }

    setApprovalFeedbacks((current) => ({ ...current, [targetUser.id]: "초대를 승인했습니다. 기존 비밀번호로 로그인할 수 있습니다." }));
  }

  function updatePasswordReason(userId: string, reason: string) {
    setPasswordReasons((current) => ({ ...current, [userId]: reason }));
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>, targetUser: AppUser) {
    event.preventDefault();

    const reason = passwordReasons[targetUser.id]?.trim() ?? "";

    if (!reason) {
      setPasswordResetOpenUserId(targetUser.id);
      setPasswordFeedbacks((current) => ({ ...current, [targetUser.id]: "비밀번호 재발급 사유를 입력해 주세요." }));
      return;
    }

    setPasswordResetOpenUserId(targetUser.id);
    setPasswordPendingUserId(targetUser.id);
    setPasswordFeedbacks((current) => ({ ...current, [targetUser.id]: "" }));

    const temporaryPassword = await resetUserPassword(targetUser.id, { reason });

    setPasswordPendingUserId(null);

    if (!temporaryPassword) {
      setPasswordResetOpenUserId(targetUser.id);
      setPasswordFeedbacks((current) => ({ ...current, [targetUser.id]: "비밀번호를 재발급하지 못했습니다." }));
      return;
    }

    setPasswordResetOpenUserId(targetUser.id);
    setIssuedPassword({ userId: targetUser.id, value: temporaryPassword });
    setPasswordReasons((current) => ({ ...current, [targetUser.id]: "" }));
    setPasswordFeedbacks((current) => ({ ...current, [targetUser.id]: "비밀번호를 재발급했습니다. 안전한 채널로 전달하세요." }));
  }

  return (
    <div>
      <SectionHeader
        title="전체 사용자 관리"
        action={
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(14rem,20rem)_auto]">
            <div className="relative block w-full">
              <label className="sr-only" htmlFor="admin-user-search">
                사용자 검색
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-12 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="admin-user-search-input"
                id="admin-user-search"
                placeholder="사용자, 휴대폰, 역할, 회원 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button
                  aria-label="검색어 지우기"
                  className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                  data-testid="admin-user-search-clear"
                  type="button"
                  onClick={() => setQuery("")}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
              data-testid="admin-user-member-create-link"
              href="/app/members"
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              회원 등록
            </Link>
          </div>
        }
      />

      <section className="mb-3 grid grid-cols-3 gap-2 sm:mb-4 sm:gap-3" aria-label="사용자 관리 요약" data-testid="admin-user-summary-grid">
        <div className="rounded-lg border border-zinc-200 bg-white p-2.5 sm:p-4">
          <p className="text-[11px] font-medium text-zinc-600 sm:text-sm">전체 사용자</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950 sm:mt-2 sm:text-3xl">{context.db.users.length}</p>
        </div>
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-2.5 sm:p-4">
          <p className="text-[11px] font-medium text-teal-700 sm:text-sm">활성 계정</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950 sm:mt-2 sm:text-3xl">{activeUsers.length}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 sm:p-4">
          <p className="text-[11px] font-medium text-amber-700 sm:text-sm">대기 초대</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950 sm:mt-2 sm:text-3xl">{pendingInvitations.length}</p>
        </div>
      </section>

      <section
        className="mb-3 rounded-lg border border-zinc-200 bg-white p-2.5 sm:mb-4 sm:p-3"
        aria-label="역할별 사용자 보기"
        data-testid="admin-user-role-filter-panel"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold text-zinc-950 sm:text-sm">역할별 보기</h2>
          </div>
          {hasActiveListFilter ? (
            <button
              className="inline-flex min-h-11 w-fit items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              data-testid="admin-user-role-filter-reset"
              type="button"
              onClick={resetListFilters}
            >
              전체 보기
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5" role="list">
          {adminUserRoleFilters.map((role) => {
            const active = selectedRoleFilter === role;
            const count = roleFilterCounts.get(role) ?? 0;

            return (
              <button
                aria-pressed={active}
                className={`flex min-h-11 items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-left transition ${
                  active
                    ? "border-teal-500 bg-teal-50 shadow-sm"
                    : "border-zinc-200 bg-white hover:border-teal-200 hover:bg-teal-50/40"
                }`}
                data-testid="admin-user-role-filter-button"
                data-role-filter={role}
                key={role}
                type="button"
                onClick={() => setSelectedRoleFilter(role)}
              >
                <span className={`truncate text-xs font-semibold ${active ? "text-teal-700" : "text-zinc-500"}`}>
                  {roleLabels[role]}
                </span>
                <span className="shrink-0 text-lg font-semibold tabular-nums text-zinc-950">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {inviteFormOpen ? (
      <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-4" data-testid="admin-user-invite-panel">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-teal-700" aria-hidden />
          <h2 className="text-base font-semibold text-zinc-950">사용자 초대</h2>
        </div>

        <form className="mt-4" id="admin-user-invite-form" onSubmit={(event) => void handleCreateInvitation(event)}>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_0.8fr_auto]">
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">이름</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="admin-user-invite-field"
                placeholder="이름"
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">휴대폰 번호</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="admin-user-invite-field"
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
                data-testid="admin-user-invite-field"
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
                data-testid="admin-user-invite-field"
                value={inviteRole}
                onChange={(event) => {
                  const nextRole = event.target.value as UserRole;

                  setInviteRole(nextRole);
                  if (nextRole === "admin") {
                    setInviteBranchIds([]);
                  }
                }}
              >
                {userRoles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
            <Button className="self-end" disabled={!inviteCanSubmit} size="lg" type="submit" variant="primary">
              초대 생성
            </Button>
          </div>
          {inviteRole === "admin" ? (
            <p className="mt-3 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800">
              총괄 어드민은 모든 지점에 접근할 수 있는 계정으로 초대됩니다.
            </p>
          ) : (
            <fieldset className="mt-3 grid gap-2">
              <legend className="text-xs font-semibold text-zinc-600">담당 지점</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {context.db.branches.map((branch) => (
                  <label className="flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700" key={branch.id}>
                    <input
                      className="h-4 w-4 accent-teal-700"
                      checked={inviteBranchIds.includes(branch.id)}
                      type="checkbox"
                      onChange={() => toggleInviteBranch(branch.id)}
                    />
                    <span>{branch.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {inviteFeedback ? <p className="mt-3 text-sm font-medium text-zinc-700">{inviteFeedback}</p> : null}
          {invitePath ? (
            <div
              className="mt-3 flex flex-col gap-2 rounded-md border border-teal-200 bg-teal-50 p-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="admin-user-invite-link-actions"
            >
              <p className="text-sm font-semibold text-teal-900">초대 링크가 준비됐습니다.</p>
              <div className="flex flex-wrap gap-2">
                <a
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-100"
                  data-testid="admin-user-invite-link-open"
                  href={invitePath}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  초대 링크 열기
                </a>
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800"
                  data-testid="admin-user-invite-link-copy"
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
      </section>
      ) : null}

      <section className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:py-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">사용자 목록</h2>
            <p className="mt-1 text-xs font-semibold text-zinc-500" data-testid="admin-user-list-status-label" aria-live="polite">
              {filteredUsers.length}/{listStatusTotalCount}명 표시
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              aria-controls="admin-user-invite-form"
              aria-expanded={inviteFormOpen}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              data-testid="admin-user-invite-toggle"
              type="button"
              onClick={() => setInviteFormOpen((current) => !current)}
            >
              <UserPlus className="h-4 w-4 text-teal-700" aria-hidden />
              {inviteFormOpen ? "닫기" : "초대"}
            </button>
            <UserCog className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
          </div>
        </div>
        <div className="hidden grid-cols-[1.1fr_0.7fr_0.7fr_1fr] border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500 md:grid">
          <span>사용자</span>
          <span>역할</span>
          <span>관리 항목</span>
          <span>담당 지점</span>
        </div>
        <div
          className="max-h-36 divide-y divide-zinc-100 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] sm:max-h-72 lg:max-h-none lg:overflow-visible"
          data-testid="admin-user-list-scroll-region"
        >
          {filteredUsers.map((user) => {
            const visibleEmail = getVisibleUserEmail(user.email);
            const visiblePhone = user.phone ? formatPhoneNumber(user.phone) : null;
            const resetReason = passwordReasons[user.id] ?? "";
            const resetFeedback = passwordFeedbacks[user.id] ?? "";
            const userIssuedPassword = issuedPassword?.userId === user.id ? issuedPassword.value : null;
            const approvedPassword = approvedInvitationPassword?.userId === user.id ? approvedInvitationPassword.value : null;
            const resetPending = passwordPendingUserId === user.id;
            const approvalPending = approvalPendingUserId === user.id;
            const approvalConfirmOpen = approvalConfirmUserId === user.id;
            const approvalFeedback = approvalFeedbacks[user.id] ?? "";
            const pendingInvitePath = user.invitationStatus === "pending" ? getInvitationPathForUser(user) : null;
            const resetPanelOpen = passwordResetOpenUserId === user.id || Boolean(userIssuedPassword) || resetPending;
            const editPanelOpen = editOpenUserId === user.id;
            const deletePanelOpen = deleteOpenUserId === user.id;
            const editDraft = getUserEditDraft(user);
            const deleteReason = deleteReasons[user.id] ?? "";
            const userFeedback = userActionFeedbacks[user.id] ?? "";
            const updatePending = pendingUserAction?.kind === "update" && pendingUserAction.userId === user.id;
            const deletePending = pendingUserAction?.kind === "delete" && pendingUserAction.userId === user.id;
            const editBranchIds = editDraft.role === "admin" ? context.db.branches.map((branch) => branch.id) : editDraft.branchIds;
            const linkedMembers = linkedMembersByUserId.get(user.id) ?? [];
            const linkedMemberSummary = getLinkedMemberSummary(user, linkedMembers, branchById);
            const linkableMembers = context.db.members.filter(
              (member) =>
                (editDraft.role !== "guardian" || canMemberHaveGuardianLink(member)) &&
                (editBranchIds.includes(member.branchId) ||
                  editDraft.memberIds.includes(member.id) ||
                  editDraft.childMemberIds.includes(member.id)),
            );
            const selectedMember = editDraft.memberIds[0]
              ? context.db.members.find((member) => member.id === editDraft.memberIds[0]) ?? null
              : null;
            const selectedChildMembers = editDraft.childMemberIds
              .map((memberId) => context.db.members.find((member) => member.id === memberId))
              .filter((member): member is Member => Boolean(member));
            const memberLinkSearchQuery = editDraft.memberLinkSearch.trim();
            const searchedLinkableMembers = memberLinkSearchQuery
              ? linkableMembers.filter((member) =>
                  matchesMemberSearch(memberLinkSearchQuery, [
                    member.name,
                    member.level,
                    member.belt,
                    member.emergencyContact,
                    branchById.get(member.branchId)?.name,
                  ]),
                )
              : [];
            const passwordEntered = Boolean(editDraft.password || editDraft.passwordConfirm);
            const passwordReady = !passwordEntered || (editDraft.password.length >= 12 && editDraft.password === editDraft.passwordConfirm);
            const deleteBlockers = deleteBlockersByUserId.get(user.id) ?? [];
            const deleteBlockerSummary = deleteBlockers.join(", ");
            const canOpenDelete = deleteBlockers.length === 0;
            const deletePanelVisible = deletePanelOpen && canOpenDelete;
            const canSubmitEdit =
              Boolean(editDraft.name.trim()) &&
              Boolean(editDraft.phone.trim()) &&
              Boolean(editDraft.title.trim()) &&
              (editDraft.role === "admin" || editBranchIds.length > 0) &&
              passwordReady &&
              !updatePending;
            const branchSummary =
              user.role === "admin"
                ? "전체 지점"
                : user.branchIds.map((branchId) => branchById.get(branchId)?.name ?? "지점 확인 중").join(", ");

            return (
              <article
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-2 md:grid-cols-[1.1fr_0.7fr_0.7fr_1fr] md:items-start"
                data-admin-user-delete-blockers={deleteBlockerSummary}
                data-admin-user-delete-protected={canOpenDelete ? "false" : "true"}
                data-admin-user-id={user.id}
                data-admin-user-invitation-status={user.invitationStatus ?? "accepted"}
                data-admin-user-role={user.role}
                data-testid="admin-user-list-row"
                key={user.id}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-950">{user.name}</p>
                  <p className="mt-0.5 text-sm text-zinc-500">{user.title}</p>
                  {visiblePhone || visibleEmail ? (
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs leading-4 text-zinc-500">
                      {visiblePhone ? <span className="shrink-0 font-semibold text-zinc-600">{visiblePhone}</span> : null}
                      {visiblePhone && visibleEmail ? <span className="shrink-0 text-zinc-300">·</span> : null}
                      {visibleEmail ? <span className="min-w-0 truncate">{visibleEmail}</span> : null}
                    </p>
                  ) : null}
                  {linkedMemberSummary ? (
                    <p
                      className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-teal-700"
                      data-testid={`admin-user-linked-member-summary-${user.id}`}
                    >
                      {linkedMemberSummary}
                    </p>
                  ) : null}
                  {user.invitationStatus === "pending" ? (
                    <p className="mt-2 inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                      초대 대기
                    </p>
                  ) : null}
                  {pendingInvitePath ? (
                    <div
                      className="mt-2 flex flex-wrap gap-2"
                      data-testid={`admin-user-pending-invite-link-actions-${user.id}`}
                    >
                      <a
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-teal-200 bg-white px-2.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-50"
                        data-admin-user-action="open-invitation-link"
                        data-testid={`admin-user-pending-invite-link-open-${user.id}`}
                        href={pendingInvitePath}
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        링크 열기
                      </a>
                      <button
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-teal-700 px-2.5 text-xs font-semibold text-white transition hover:bg-teal-800"
                        data-admin-user-action="copy-invitation-link"
                        data-testid={`admin-user-pending-invite-link-copy-${user.id}`}
                        type="button"
                        onClick={() => void handleCopyPendingInvitationLink(user, pendingInvitePath)}
                      >
                        <Copy className="h-4 w-4" aria-hidden />
                        링크 복사
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="col-start-1 row-start-2 md:col-start-auto md:row-start-auto">
                  <RoleBadge role={user.role} />
                </div>
                <p className="hidden text-sm font-semibold leading-6 text-zinc-700 md:block">{roleManagementScopeLabels[user.role]}</p>
                <p className="hidden text-sm leading-6 text-zinc-600 md:block">{branchSummary}</p>
                <div
                  className="col-start-2 row-start-1 flex w-auto flex-col items-end gap-1 justify-self-end md:col-span-4 md:col-start-1 md:row-start-auto md:flex-row md:items-center md:justify-self-start"
                  data-testid={`admin-user-action-stack-${user.id}`}
                >
                  {user.invitationStatus === "pending" ? (
                    <button
                      aria-controls={`admin-user-approve-invitation-confirm-${user.id}`}
                      aria-expanded={approvalConfirmOpen}
                      aria-label={`${user.name} ${approvalConfirmOpen ? "초대 승인 확인 닫기" : "초대 승인 확인"}`}
                      className="inline-flex h-11 min-w-20 shrink-0 items-center justify-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-2.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60 md:px-3 md:text-sm"
                      data-admin-user-action="approve-invitation"
                      data-testid={`admin-user-approve-invitation-${user.id}`}
                      disabled={approvalPending}
                      title={approvalPending ? "승인 중" : "초대 승인"}
                      type="button"
                      onClick={() => openInvitationApprovalConfirm(user)}
                    >
                      <UserCheck className="h-4 w-4" aria-hidden />
                      <span>{approvalPending ? "승인 중" : "승인"}</span>
                    </button>
                  ) : null}
                  <button
                    aria-label={`${user.name} ${editPanelOpen ? "수정 닫기" : "수정"}`}
                    aria-controls={`admin-user-edit-${user.id}`}
                    aria-expanded={editPanelOpen}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 transition hover:bg-zinc-50"
                    data-admin-user-action="edit"
                    data-testid={`admin-user-edit-toggle-${user.id}`}
                    title={editPanelOpen ? "수정 닫기" : "수정"}
                    type="button"
                    onClick={() => openUserEdit(user)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    <span className="sr-only">{editPanelOpen ? "수정 닫기" : "수정"}</span>
                  </button>
                  {canOpenDelete ? (
                    <button
                      aria-controls={`admin-user-delete-${user.id}`}
                      aria-expanded={deletePanelVisible}
                      aria-label={`${user.name} ${deletePanelVisible ? "삭제 닫기" : "삭제"}`}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-red-200 bg-white text-red-700 transition hover:bg-red-50"
                      data-admin-user-action="delete"
                      data-testid={`admin-user-delete-toggle-${user.id}`}
                      type="button"
                      onClick={() => openUserDelete(user)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      <span className="sr-only">{deletePanelVisible ? "삭제 닫기" : "삭제"}</span>
                    </button>
                  ) : null}
                  <button
                    aria-label={`${user.name} ${resetPanelOpen ? "비밀번호 재발급 닫기" : "비밀번호 재발급"}`}
                    aria-controls={`admin-user-password-reset-${user.id}`}
                    aria-expanded={resetPanelOpen}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 transition hover:bg-zinc-50"
                    data-admin-user-action="password-reset"
                    data-testid={`admin-user-password-reset-toggle-${user.id}`}
                    title={resetPanelOpen ? "재발급 닫기" : "재발급"}
                    type="button"
                    onClick={() => {
                      if (resetPanelOpen) {
                        setPasswordResetOpenUserId(null);
                        return;
                      }

                      setEditOpenUserId(null);
                      setDeleteOpenUserId(null);
                      setApprovalConfirmUserId(null);
                      setPasswordResetOpenUserId(user.id);
                      scrollUserPanelIntoView(`admin-user-password-reset-${user.id}`);
                    }}
                  >
                    <KeyRound className="h-4 w-4" aria-hidden />
                    <span className="sr-only">{resetPanelOpen ? "비밀번호 재발급 닫기" : "비밀번호 재발급"}</span>
                  </button>
                </div>
                {approvalConfirmOpen ? (
                  <div
                    className="col-span-2 grid min-w-0 scroll-mt-40 gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 md:col-span-4 lg:scroll-mt-6"
                    data-admin-user-approval-confirmation="visible"
                    data-testid={`admin-user-approve-invitation-confirm-${user.id}`}
                    id={`admin-user-approve-invitation-confirm-${user.id}`}
                  >
                    <p className="text-xs font-semibold text-amber-900">초대 승인 확인</p>
                    <p className="text-xs leading-5 text-amber-800">
                      승인하면 계정이 활성화되고 첫 접속 비밀번호가 발급될 수 있습니다.
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                      <button
                        className="inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                        data-admin-user-action="confirm-approve-invitation"
                        data-testid={`admin-user-confirm-approve-invitation-${user.id}`}
                        disabled={approvalPending}
                        type="button"
                        onClick={() => void handleApproveInvitation(user)}
                      >
                        {approvalPending ? "승인 중" : "승인 확정"}
                      </button>
                      <button
                        className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        data-admin-user-action="cancel-approve-invitation"
                        data-testid={`admin-user-cancel-approve-invitation-${user.id}`}
                        type="button"
                        onClick={() => setApprovalConfirmUserId(null)}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : null}
                {approvalFeedback || approvedPassword ? (
                  <div
                    className="col-span-2 grid min-w-0 gap-2 rounded-md border border-teal-200 bg-teal-50 p-2.5 md:col-span-4"
                    data-testid={`admin-user-approve-invitation-feedback-${user.id}`}
                  >
                    {approvalFeedback ? <p className="text-xs font-semibold text-teal-800">{approvalFeedback}</p> : null}
                    {approvedPassword ? (
                      <p className="break-all rounded-md border border-teal-200 bg-white px-3 py-2 text-xs font-semibold text-teal-800">
                        첫 접속 비밀번호: <span className="font-mono">{approvedPassword}</span>
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {editPanelOpen ? (
                  <form
                    className="col-span-2 grid min-w-0 scroll-mt-40 gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 md:col-span-4 lg:scroll-mt-6"
                    data-testid={`admin-user-edit-form-${user.id}`}
                    id={`admin-user-edit-${user.id}`}
                    onSubmit={(event) => void handleUpdateUser(event, user)}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">이름</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                          data-admin-user-edit-control="true"
                          value={editDraft.name}
                          onChange={(event) => updateUserEditDraft(user, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">휴대폰 번호</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                          data-admin-user-edit-control="true"
                          inputMode="tel"
                          type="tel"
                          value={editDraft.phone}
                          onChange={(event) => updateUserEditDraft(user, { phone: event.target.value })}
                        />
                      </label>
                    </div>
                    <label>
                      <span className="mb-1 block text-xs font-semibold text-zinc-500">이메일(선택)</span>
                      <input
                        className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                        data-admin-user-edit-control="true"
                        type="email"
                        value={editDraft.email}
                        onChange={(event) => updateUserEditDraft(user, { email: event.target.value })}
                      />
                    </label>
                    <div
                      aria-labelledby={`admin-user-password-edit-heading-${user.id}`}
                      className="grid gap-2 rounded-md border border-teal-100 bg-white p-2.5"
                      data-admin-user-password-edit-state="visible"
                      data-testid={`admin-user-password-edit-section-${user.id}`}
                    >
                      <div className="flex min-h-11 items-center justify-between gap-3">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <KeyRound className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                          <span className="min-w-0 text-sm font-semibold text-zinc-950" id={`admin-user-password-edit-heading-${user.id}`}>
                            비밀번호 변경
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700">선택 입력</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">새 비밀번호</span>
                          <input
                            aria-invalid={passwordEntered && !passwordReady}
                            autoComplete="new-password"
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                            data-admin-user-edit-control="true"
                            data-testid={`admin-user-password-input-${user.id}`}
                            minLength={12}
                            placeholder="12자 이상"
                            type="password"
                            value={editDraft.password}
                            onChange={(event) => updateUserEditDraft(user, { password: event.target.value })}
                          />
                        </label>
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">비밀번호 확인</span>
                          <input
                            aria-invalid={passwordEntered && !passwordReady}
                            autoComplete="new-password"
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                            data-admin-user-edit-control="true"
                            data-testid={`admin-user-password-confirm-input-${user.id}`}
                            minLength={12}
                            placeholder="다시 입력"
                            type="password"
                            value={editDraft.passwordConfirm}
                            onChange={(event) => updateUserEditDraft(user, { passwordConfirm: event.target.value })}
                          />
                        </label>
                        {(editDraft.password || editDraft.passwordConfirm) && !passwordReady ? (
                          <p className="text-xs font-semibold text-red-700 sm:col-span-2">
                            새 비밀번호는 12자 이상이며 확인 입력과 같아야 합니다.
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">역할</span>
                        <select
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                          data-admin-user-edit-control="true"
                          value={editDraft.role}
                          onChange={(event) => {
                            const nextRole = event.target.value as UserRole;
                            const nextBranchIds = nextRole === "admin" ? context.db.branches.map((branch) => branch.id) : editDraft.branchIds;

                            updateUserEditDraft(user, {
                              role: nextRole,
                              branchIds: nextBranchIds,
                              childMemberIds: nextRole === "guardian" ? editDraft.childMemberIds : [],
                              memberLinkSearch: "",
                              memberIds: nextRole === "member" ? editDraft.memberIds : [],
                            });
                          }}
                        >
                          {userRoles.map((role) => (
                            <option key={role} value={role}>
                              {roleLabels[role]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">설명</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                          data-admin-user-edit-control="true"
                          value={editDraft.title}
                          onChange={(event) => updateUserEditDraft(user, { title: event.target.value })}
                        />
                      </label>
                    </div>
                    {editDraft.role === "admin" ? (
                      <p className="rounded-md border border-teal-200 bg-white px-3 py-2 text-xs font-semibold text-teal-800">
                        총괄 어드민은 전체 지점을 관리합니다.
                      </p>
                    ) : (
                      <fieldset className="grid gap-2">
                        <legend className="text-xs font-semibold text-zinc-600">담당 지점</legend>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {context.db.branches.map((branch) => (
                            <label
                              className="flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700"
                              key={branch.id}
                            >
                              <input
                                className="h-4 w-4 accent-teal-700"
                                checked={editDraft.branchIds.includes(branch.id)}
                                type="checkbox"
                                onChange={() => toggleUserEditBranch(user, branch.id)}
                              />
                              <span>{branch.name}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    {editDraft.role === "member" ? (
                      <fieldset className="mb-32 scroll-mb-56 grid gap-2 rounded-md border border-zinc-200 bg-white p-2.5 lg:mb-0 lg:scroll-mb-0" data-testid={`admin-user-member-link-section-${user.id}`}>
                        <legend className="px-1 text-xs font-semibold text-zinc-600">앱 연결 회원</legend>
                        {selectedMember ? (
                          <div
                            className="flex min-h-11 flex-wrap items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2"
                            data-testid={`admin-user-member-link-selected-${user.id}`}
                          >
                            <span className="min-w-0 flex-1 text-sm font-semibold text-teal-900">
                              {getLinkedMemberDisplay(selectedMember, branchById)}
                            </span>
                            <button
                              aria-label={`${selectedMember.name} 연결 해제`}
                              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-teal-200 bg-white text-teal-800 transition hover:bg-teal-100"
                              data-testid={`admin-user-member-link-clear-${user.id}`}
                              type="button"
                              onClick={() => updateUserEditDraft(user, { memberIds: [], memberLinkSearch: "" })}
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                        ) : null}
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">회원 앱에 표시할 본인 정보 검색</span>
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                            data-admin-user-edit-control="true"
                            data-testid={`admin-user-member-link-search-input-${user.id}`}
                            placeholder="이름, 연락처, 지점 검색"
                            value={editDraft.memberLinkSearch}
                            onChange={(event) => updateUserEditDraft(user, { memberLinkSearch: event.target.value })}
                          />
                        </label>
                        {memberLinkSearchQuery ? (
                          <div
                            className="max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white"
                            data-testid={`admin-user-member-link-results-${user.id}`}
                          >
                            {searchedLinkableMembers.length > 0 ? (
                              searchedLinkableMembers.map((member) => {
                                const isSelected = editDraft.memberIds.includes(member.id);

                                return (
                                  <button
                                    className={`flex min-h-11 w-full items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 transition ${
                                      isSelected ? "bg-teal-50 text-teal-900" : "bg-white text-zinc-800 hover:bg-zinc-50"
                                    }`}
                                    data-testid={`admin-user-member-link-result-${user.id}`}
                                    key={member.id}
                                    type="button"
                                    onClick={() =>
                                      updateUserEditDraft(user, {
                                        memberIds: [member.id],
                                        memberLinkSearch: member.name,
                                      })
                                    }
                                  >
                                    <span className="min-w-0 truncate">
                                      {getLinkedMemberDisplay(member, branchById)}
                                    </span>
                                    <span className="shrink-0 text-xs font-semibold">{isSelected ? "선택됨" : "선택"}</span>
                                  </button>
                                );
                              })
                            ) : (
                              <p className="px-3 py-2 text-xs font-semibold text-zinc-500">검색 결과가 없습니다.</p>
                            )}
                          </div>
                        ) : (
                          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-500">
                            회원 이름이나 연락처를 검색한 뒤 선택해 주세요.
                          </p>
                        )}
                        <Link
                          className="inline-flex min-h-11 w-fit items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                          data-testid={`admin-user-member-link-create-shortcut-${user.id}`}
                          href="/app/members"
                        >
                          <UserPlus className="h-4 w-4 text-teal-700" aria-hidden />
                          새 회원 등록
                        </Link>
                      </fieldset>
                    ) : null}
                    {editDraft.role === "guardian" ? (
                      <fieldset className="mb-32 scroll-mb-56 grid gap-2 rounded-md border border-zinc-200 bg-white p-2.5 lg:mb-0 lg:scroll-mb-0" data-testid={`admin-user-guardian-link-section-${user.id}`}>
                        <legend className="px-1 text-xs font-semibold text-zinc-600">연결 자녀</legend>
                        {linkableMembers.length > 0 ? (
                          <>
                            <div
                              className="scroll-mb-56 flex min-h-11 flex-wrap gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 lg:scroll-mb-0"
                              data-testid={`admin-user-guardian-child-selected-list-${user.id}`}
                            >
                              {selectedChildMembers.length > 0 ? (
                                selectedChildMembers.map((member) => (
                                  <span
                                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-teal-200 bg-white px-2 py-1 text-xs font-semibold text-teal-900"
                                    data-testid={`admin-user-guardian-child-selected-${user.id}-${member.id}`}
                                    key={member.id}
                                  >
                                    <span className="min-w-0 truncate">
                                      {getLinkedMemberDisplay(member, branchById)}
                                    </span>
                                    <button
                                      aria-label={`${member.name} 자녀 연결 해제`}
                                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-teal-800 transition hover:bg-teal-50"
                                      data-testid={`admin-user-guardian-child-clear-${user.id}-${member.id}`}
                                      type="button"
                                      onClick={() => toggleGuardianChildMember(user, member.id)}
                                    >
                                      <X className="h-4 w-4" aria-hidden />
                                    </button>
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs font-semibold text-zinc-500">연결된 자녀가 없습니다.</span>
                              )}
                            </div>
                            <label>
                              <span className="mb-1 block text-xs font-semibold text-zinc-500">자녀 회원 검색</span>
                              <input
                                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                                data-admin-user-edit-control="true"
                                data-testid={`admin-user-guardian-child-search-input-${user.id}`}
                                placeholder="유소년/청소년 이름, 연락처, 지점 검색"
                                value={editDraft.memberLinkSearch}
                                onChange={(event) => updateUserEditDraft(user, { memberLinkSearch: event.target.value })}
                              />
                            </label>
                            {memberLinkSearchQuery ? (
                              <div
                                className="max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white"
                                data-testid={`admin-user-guardian-child-results-${user.id}`}
                              >
                                {searchedLinkableMembers.length > 0 ? (
                                  searchedLinkableMembers.map((member) => {
                                    const isSelected = editDraft.childMemberIds.includes(member.id);

                                    return (
                                      <button
                                        className={`flex min-h-11 w-full items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 transition ${
                                          isSelected ? "bg-teal-50 text-teal-900" : "bg-white text-zinc-800 hover:bg-zinc-50"
                                        }`}
                                        data-testid={`admin-user-guardian-child-result-${user.id}`}
                                        key={member.id}
                                        type="button"
                                        onClick={() => toggleGuardianChildMember(user, member.id)}
                                      >
                                        <span className="min-w-0 truncate">
                                          {getLinkedMemberDisplay(member, branchById)}
                                        </span>
                                        <span className="shrink-0 text-xs font-semibold">{isSelected ? "연결됨" : "연결"}</span>
                                      </button>
                                    );
                                  })
                                ) : (
                                  <p className="px-3 py-2 text-xs font-semibold text-zinc-500">검색 결과가 없습니다.</p>
                                )}
                              </div>
                            ) : (
                              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-500">
                                자녀 이름이나 연락처를 검색해 연결해 주세요.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-500">
                            선택한 담당 지점에 연결할 회원이 없습니다.
                          </p>
                        )}
                      </fieldset>
                    ) : null}
                    {userFeedback ? <p className="text-xs font-semibold text-red-700">{userFeedback}</p> : null}
	                    <div
	                      className="sticky bottom-28 z-40 flex scroll-mb-56 flex-nowrap gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-1.5 shadow-sm lg:static lg:inset-auto lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:scroll-mb-0"
	                      data-testid={`admin-user-edit-action-bar-${user.id}`}
	                    >
                      <Button
                        className="min-w-32"
                        data-testid={`admin-user-edit-submit-${user.id}`}
                        disabled={!canSubmitEdit}
                        size="lg"
                        type="submit"
                        variant="secondary"
                      >
                        <Save className="h-4 w-4" aria-hidden />
                        {updatePending ? "저장 중" : "수정 저장"}
                      </Button>
                      <Button
                        className="min-w-24"
                        data-testid={`admin-user-edit-cancel-${user.id}`}
                        size="lg"
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          removeUserDraft(user.id);
                          closeUserPanels(user.id);
                        }}
                      >
                        <X className="h-4 w-4" aria-hidden />
                        취소
	                      </Button>
	                    </div>
	                    <div className="h-28 lg:hidden" aria-hidden="true" data-testid={`admin-user-edit-bottom-safe-area-${user.id}`} />
	                  </form>
                ) : null}
                {deletePanelVisible ? (
                  <form
                    className="col-span-2 grid min-w-0 scroll-mt-40 gap-3 rounded-md border border-red-200 bg-red-50 p-3 md:col-span-4 sm:grid-cols-[1fr_auto] lg:scroll-mt-6"
                    data-testid={`admin-user-delete-form-${user.id}`}
                    id={`admin-user-delete-${user.id}`}
                    onSubmit={(event) => void handleDeleteUser(event, user)}
                  >
                    <div className="min-w-0">
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-red-700">삭제 사유</span>
                        <input
                          className="h-11 w-full rounded-md border border-red-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-red-500"
                          data-testid={`admin-user-delete-reason-input-${user.id}`}
                          placeholder="삭제 사유 입력"
                          value={deleteReason}
                          onChange={(event) => setDeleteReasons((current) => ({ ...current, [user.id]: event.target.value }))}
                        />
                      </label>
                      <p className="mt-2 text-xs font-medium leading-5 text-red-700">
                        삭제 후 해당 계정은 로그인할 수 없습니다. 담당 수업이나 회원 연결이 남아 있으면 저장되지 않습니다.
                      </p>
                      {userFeedback ? <p className="mt-2 text-xs font-semibold text-red-800">{userFeedback}</p> : null}
                    </div>
                    <Button className="self-end" disabled={!deleteReason.trim() || deletePending} size="lg" type="submit" variant="danger">
                      <Trash2 className="h-4 w-4" aria-hidden />
                      {deletePending ? "삭제 중" : "계정 삭제"}
                    </Button>
                  </form>
                ) : null}
                {resetPanelOpen ? (
                  <form
                    className="col-span-2 grid min-w-0 scroll-mt-40 gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 md:col-span-4 sm:grid-cols-[1fr_auto] lg:scroll-mt-6"
                    id={`admin-user-password-reset-${user.id}`}
                    onSubmit={(event) => void handleResetPassword(event, user)}
                  >
                    <div className="min-w-0">
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">비밀번호 재발급 사유</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                          data-testid={`admin-user-password-reset-reason-input-${user.id}`}
                          placeholder="재발급 사유 입력"
                          value={resetReason}
                          onChange={(event) => updatePasswordReason(user.id, event.target.value)}
                        />
                      </label>
                      {userIssuedPassword ? (
                        <p className="mt-2 break-all rounded-md border border-teal-200 bg-white px-3 py-2 text-xs font-semibold text-teal-800">
                          새 비밀번호: <span className="font-mono">{userIssuedPassword}</span>
                        </p>
                      ) : null}
                      {resetFeedback ? <p className="mt-2 text-xs font-semibold text-zinc-600">{resetFeedback}</p> : null}
                    </div>
                    <Button
                      className="min-h-11 w-full self-end sm:w-auto"
                      disabled={!resetReason.trim() || resetPending}
                      size="lg"
                      type="submit"
                      variant="secondary"
                    >
                      <KeyRound className="h-4 w-4" aria-hidden />
                      {resetPending ? "발급 중" : "비밀번호 재발급"}
                    </Button>
                  </form>
                ) : null}
              </article>
            );
          })}
          {filteredUsers.length === 0 ? (
            <div className="grid gap-3 px-4 py-8 text-center" data-testid="admin-user-empty-filter-state">
              <p className="text-sm font-semibold text-zinc-950">조건에 맞는 사용자가 없습니다.</p>
              <button
                className="mx-auto inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                data-testid="admin-user-empty-filter-reset"
                type="button"
                onClick={resetListFilters}
              >
                전체 보기
              </button>
            </div>
          ) : null}
          <div className="h-24 lg:hidden" aria-hidden="true" data-testid="admin-user-list-bottom-safe-area" />
        </div>
      </section>
    </div>
  );
}
