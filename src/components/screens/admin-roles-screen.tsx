"use client";

import { type FormEvent, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Copy, ExternalLink, History, Pencil, Search, ShieldCheck, UserCog, UserPlus } from "lucide-react";
import { PermissionMatrix, type PermissionMatrixRow } from "@/components/domain/permission-matrix";
import { useApiContext } from "@/hooks/use-api-context";
import { userRoles, type AppUser, type AuditAction, type AuditLog, type UserRole } from "@/lib/domain";
import { formatDateTime, formatPhoneNumber } from "@/lib/format";
import { roleLabels, roleManagementScopeLabels } from "@/lib/roles";
import { getVisibleUserEmail } from "@/lib/user-display";
import { useAppStore } from "@/store/app-store";
import { Button, RoleBadge } from "@/components/ui/primitives";

const adminPermissionRows: PermissionMatrixRow[] = [
  {
    resource: "지점",
    view: "allowed",
    create: "allowed",
    update: "allowed",
    delete: "allowed",
    approve: "allowed",
  },
  {
    resource: "사용자",
    view: "allowed",
    create: "allowed",
    update: "allowed",
    delete: "allowed",
    approve: "allowed",
  },
  {
    resource: "역할/권한",
    view: "allowed",
    create: "allowed",
    update: "allowed",
    delete: "allowed",
    approve: "allowed",
  },
  {
    resource: "결제",
    view: "allowed",
    create: "allowed",
    update: "allowed",
    delete: "allowed",
    approve: "allowed",
  },
  {
    resource: "변경 기록",
    view: "allowed",
    create: "allowed",
    update: "allowed",
    delete: "allowed",
    approve: "allowed",
  },
];

const auditActionLabels: Record<AuditAction, string> = {
  "attendance.update": "출석 변경",
  "notice.create": "공지 작성",
  "notice.delete": "공지 삭제",
  "notice.read": "공지 읽음",
  "notification.subscribe": "알림 수신 등록",
  "notification.unsubscribe": "알림 수신 해제",
  "notification.dispatch": "공지 알림 발송",
  "member.create": "회원 등록",
  "member.update": "회원 정보 변경",
  "counseling_note.create": "상담 메모 작성",
  "promotion.create": "승급 심사 등록",
  "promotion.update": "승급 심사 결과",
  "class.create": "수업 생성",
  "class.update": "수업 변경",
  "payment.create": "결제 등록",
  "payment.online_checkout.create": "온라인 결제 요청",
  "payment.webhook": "결제 상태 반영",
  "payment.recurring_agreement.create": "정기결제 약정",
  "payment.recurring_agreement.cancel": "정기결제 해지",
  "payment.refund": "결제 환불",
  "branch.create": "지점 생성",
  "branch.update": "지점 변경",
  "branch.owner.assign": "대표 배정",
  "user.invite.create": "사용자 초대",
  "user.invite.approve": "초대 승인",
  "user.update": "사용자 수정",
  "user.role.update": "역할 변경",
  "user.delete": "사용자 삭제",
  "audit_logs.read": "변경 기록 조회",
  "export.create": "내보내기",
  "pilot_readiness.update": "운영 준비 변경",
  "pilot_incident.create": "운영 이슈 등록",
  "pilot_incident.update": "운영 이슈 변경",
  "pilot_operation.update": "운영 기록 변경",
  "auth.invite.accept": "초대 수락",
  "auth.password_reset.request": "비밀번호 재설정 요청",
  "auth.password_reset.complete": "비밀번호 재발급",
  "auth.login": "로그인",
  "auth.logout": "로그아웃",
};

const auditResultLabels: Record<AuditLog["result"], string> = {
  blocked: "확인 필요",
  failed: "실패",
  success: "완료",
};

const roleRelevantAuditActions = new Set<AuditAction>([
  "auth.invite.accept",
  "auth.password_reset.complete",
  "auth.password_reset.request",
  "branch.owner.assign",
  "user.invite.approve",
  "user.delete",
  "user.invite.create",
  "user.role.update",
  "user.update",
]);

function getPermissionSummary(rows: PermissionMatrixRow[]) {
  const summary = {
    allowed: 0,
    denied: 0,
    restricted: 0,
    total: 0,
  };

  for (const row of rows) {
    for (const key of ["view", "create", "update", "delete", "approve"] as const) {
      summary[row[key]] += 1;
      summary.total += 1;
    }
  }

  return summary;
}

export function AdminRolesScreen() {
  const context = useApiContext();
  const { updateUserRole, createInvitation } = useAppStore();
  const [query, setQuery] = useState("");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [roleReasons, setRoleReasons] = useState<Record<string, string>>({});
  const [roleFeedback, setRoleFeedback] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("coach");
  const [inviteBranchIds, setInviteBranchIds] = useState<string[]>([]);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [roleEditorUserId, setRoleEditorUserId] = useState<string | null>(null);
  const [permissionMatrixOpen, setPermissionMatrixOpen] = useState(false);
  const [showAllRecentRoleChanges, setShowAllRecentRoleChanges] = useState(false);

  const branchById = useMemo(() => new Map(context.db.branches.map((branch) => [branch.id, branch])), [context.db.branches]);
  const permissionSummary = useMemo(() => getPermissionSummary(adminPermissionRows), []);
  const filteredUsers = useMemo(() => {
    const keyword = query.trim();

    if (!keyword) {
      return context.db.users;
    }

    return context.db.users.filter((user) =>
      [user.name, user.phone ?? "", getVisibleUserEmail(user.email) ?? "", user.title, roleLabels[user.role], roleManagementScopeLabels[user.role]].some((value) =>
        value.includes(keyword),
      ),
    );
  }, [context.db.users, query]);

  const privilegedUsers = context.db.users.filter((user) => user.role === "admin" || user.role === "owner");
  const pendingInvitations = context.db.users.filter((user) => user.invitationStatus === "pending");
  const roleAuditLogs = useMemo(
    () => context.db.auditLogs.filter((log) => roleRelevantAuditActions.has(log.action)),
    [context.db.auditLogs],
  );
  const recentRoleAuditLogs = roleAuditLogs.slice(0, 5);
  const visibleRecentRoleAuditLogs = showAllRecentRoleChanges ? recentRoleAuditLogs : recentRoleAuditLogs.slice(0, 1);
  const hiddenRecentRoleAuditLogCount = Math.max(recentRoleAuditLogs.length - 1, 0);
  const inviteCanSubmit =
    Boolean(inviteName.trim()) &&
    Boolean(invitePhone.trim()) &&
    (inviteRole === "admin" || inviteBranchIds.length > 0);

  function getDraftRole(user: AppUser) {
    return roleDrafts[user.id] ?? user.role;
  }

  async function handleSaveRole(event: FormEvent<HTMLFormElement>, targetUser: AppUser) {
    event.preventDefault();

    const nextRole = getDraftRole(targetUser);
    const reason = roleReasons[targetUser.id]?.trim() ?? "";

    if (nextRole === targetUser.role || !reason) {
      return;
    }

    if (targetUser.id === context.user.id && targetUser.role === "admin" && nextRole !== "admin") {
      setRoleFeedback("현재 로그인한 총괄 어드민은 자신의 권한을 제거할 수 없습니다.");
      return;
    }

    const ok = await updateUserRole(targetUser.id, nextRole, reason);

    if (!ok) {
      setRoleFeedback("권한 변경을 저장하지 못했습니다. 현재 계정 권한과 관리 정책을 확인해 주세요.");
      return;
    }

    setRoleFeedback("권한 변경을 저장했습니다.");
    setRoleDrafts((current) => {
      const next = { ...current };
      delete next[targetUser.id];
      return next;
    });
    setRoleReasons((current) => {
      const next = { ...current };
      delete next[targetUser.id];
      return next;
    });
    setRoleEditorUserId(null);
  }

  function toggleInviteBranch(branchId: string) {
    setInviteBranchIds((current) =>
      current.includes(branchId) ? current.filter((candidate) => candidate !== branchId) : [...current, branchId],
    );
  }

  async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
      setInviteFeedback("초대 링크를 복사했습니다.");
    } catch {
      setInviteFeedback("초대 링크를 열어 주소를 복사해 주세요.");
    }
  }

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_20rem] sm:items-center">
        <h1 className="text-xl font-semibold tracking-normal text-zinc-950 sm:text-2xl">총괄 권한 관리</h1>
        <label className="relative block w-full">
          <span className="sr-only">사용자 또는 역할 검색</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-400" aria-hidden />
          <input
            className="h-10 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
            placeholder="사용자, 역할, 관리 항목 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <section
        aria-label="권한 관리 요약"
        className="grid grid-cols-4 overflow-hidden rounded-md border border-zinc-200 bg-white"
        data-testid="admin-role-summary-grid"
      >
        <div className="flex min-w-0 items-center justify-center gap-1 px-1 py-0.5 text-center">
          <p className="truncate text-[9px] font-medium leading-3 text-zinc-600 sm:text-[10px]">기본 역할</p>
          <p className="text-sm font-semibold leading-4 tabular-nums text-zinc-950">5</p>
        </div>
        <div className="flex min-w-0 items-center justify-center gap-1 border-l border-blue-100 bg-blue-50 px-1 py-0.5 text-center">
          <p className="truncate text-[9px] font-medium leading-3 text-blue-700 sm:text-[10px]">관리 권한</p>
          <p className="text-sm font-semibold leading-4 tabular-nums text-zinc-950">{privilegedUsers.length}</p>
        </div>
        <div className="flex min-w-0 items-center justify-center gap-1 border-l border-zinc-200 px-1 py-0.5 text-center">
          <p className="truncate text-[9px] font-medium leading-3 text-zinc-600 sm:text-[10px]">대기 초대</p>
          <p className="text-sm font-semibold leading-4 tabular-nums text-zinc-950">{pendingInvitations.length}</p>
        </div>
        <div className="flex min-w-0 items-center justify-center gap-1 border-l border-teal-100 bg-teal-50 px-1 py-0.5 text-center">
          <p className="truncate text-[9px] font-medium leading-3 text-teal-700 sm:text-[10px]">계정 변경</p>
          <p className="text-sm font-semibold leading-4 tabular-nums text-zinc-950">{roleAuditLogs.length}</p>
        </div>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">사용자/역할 목록</h2>
            </div>
            <UserCog className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
          </div>
          <div className={`border-b border-zinc-200 bg-zinc-50 px-4 ${inviteFormOpen ? "py-3" : "py-2"}`}>
            <div
              className={
                inviteFormOpen
                  ? "flex items-center justify-between gap-3"
                  : "flex w-2/3 max-w-[18rem] items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1"
              }
              data-testid="admin-role-invite-panel"
            >
            <div className="flex min-w-0 items-center gap-2">
              <div>
                <h3 className={`${inviteFormOpen ? "text-sm" : "text-xs"} truncate font-semibold text-zinc-950`}>사용자 초대</h3>
              </div>
              <UserPlus className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
            </div>
            <button
              aria-controls="admin-role-invite-form"
              aria-expanded={inviteFormOpen}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white font-semibold text-zinc-800 transition hover:bg-zinc-50 ${
                inviteFormOpen ? "px-3 text-sm" : "px-2 text-xs"
              }`}
              data-testid="admin-role-invite-toggle"
              type="button"
              onClick={() => setInviteFormOpen((current) => !current)}
            >
              {inviteFormOpen ? "닫기" : "열기"}
            </button>
            </div>
          </div>
          {inviteFormOpen ? (
            <form
              className="grid gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-4"
              id="admin-role-invite-form"
              onSubmit={(event) => void handleCreateInvitation(event)}
            >
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_0.8fr]">
              <label>
                <span className="sr-only">초대 이름</span>
                <input
                  className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  placeholder="이름"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">초대 휴대폰 번호</span>
                <input
                  className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  inputMode="tel"
                  placeholder="휴대폰 번호"
                  type="tel"
                  value={invitePhone}
                  onChange={(event) => setInvitePhone(event.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">초대 이메일 선택 입력</span>
                <input
                  className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  placeholder="이메일 선택"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">초대 역할</span>
                <select
                  className="h-10 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none transition focus:border-teal-500"
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
            </div>
            {inviteRole === "admin" ? (
              <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800">
                총괄 어드민은 모든 지점에 접근할 수 있는 계정으로 초대됩니다.
              </p>
            ) : (
              <fieldset className="grid gap-2">
                <legend className="text-xs font-semibold text-zinc-600">담당 지점</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {context.db.branches.map((branch) => (
                    <label
                      className="flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700"
                      key={branch.id}
                    >
                      <input
                        className="h-5 w-5 accent-teal-700"
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button className="w-full sm:w-auto" disabled={!inviteCanSubmit} size="sm" type="submit" variant="primary">
                초대 링크 생성
              </Button>
              {inviteFeedback ? <p className="text-sm font-medium text-zinc-700">{inviteFeedback}</p> : null}
            </div>
            {invitePath ? (
              <div
                className="flex flex-col gap-2 rounded-md border border-teal-200 bg-teal-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid="admin-role-invite-link-actions"
              >
                <p className="text-sm font-semibold text-teal-900">초대 링크가 준비됐습니다.</p>
                <div className="flex flex-wrap gap-2">
                  <a
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-100"
                    data-testid="admin-role-invite-link-open"
                    href={invitePath}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden />
                    초대 링크 열기
                  </a>
                  <button
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800"
                    data-testid="admin-role-invite-link-copy"
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
          <div className="hidden grid-cols-[1.1fr_0.8fr_0.9fr_1fr] border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500 md:grid">
            <span>사용자</span>
            <span>역할 변경</span>
            <span>관리 항목</span>
            <span>담당 지점</span>
          </div>
          {roleFeedback ? (
            <p className="border-b border-zinc-100 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-700">
              {roleFeedback}
            </p>
          ) : null}
          <div className="divide-y divide-zinc-100">
            {filteredUsers.map((user) => {
              const visibleEmail = getVisibleUserEmail(user.email);
              const visiblePhone = user.phone ? formatPhoneNumber(user.phone) : null;
              const draftRole = getDraftRole(user);
              const reason = roleReasons[user.id]?.trim() ?? "";
              const isSelfAdminDemotion = user.id === context.user.id && user.role === "admin" && draftRole !== "admin";
              const canSaveRole = draftRole !== user.role && Boolean(reason) && !isSelfAdminDemotion;
              const roleEditorOpen = roleEditorUserId === user.id;

              return (
                <article
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-2.5 md:grid-cols-[1.1fr_1.15fr_0.9fr_1fr] md:items-start"
                  data-testid="admin-role-user-row"
                  key={user.id}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-950">{user.name}</p>
                    <p className="mt-0.5 text-sm text-zinc-500">{user.title}</p>
                    {visiblePhone ? <p className="mt-0.5 text-xs font-semibold text-zinc-600">{visiblePhone}</p> : null}
                    {visibleEmail ? <p className="mt-0.5 hidden break-all text-xs text-zinc-500 sm:block">{visibleEmail}</p> : null}
                    {user.invitationStatus === "pending" ? (
                      <p className="mt-2 inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                        초대 대기
                      </p>
                    ) : null}
                  </div>
                  <div className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto">
                    <div
                      className="flex flex-row items-center gap-1 justify-self-end md:justify-between md:gap-2"
                      data-testid="admin-role-action-row"
                    >
                      <RoleBadge role={user.role} />
                      <button
                        aria-controls={`admin-role-edit-form-${user.id}`}
                        aria-expanded={roleEditorOpen}
                        aria-label={`${user.name} ${roleEditorOpen ? "역할 변경 닫기" : "역할 변경"}`}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-800 transition hover:bg-zinc-50 md:w-auto md:px-3"
                        data-testid="admin-role-edit-toggle"
                        title={roleEditorOpen ? "역할 변경 닫기" : "역할 변경"}
                        type="button"
                        onClick={() => setRoleEditorUserId((current) => (current === user.id ? null : user.id))}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                        <span className="sr-only md:not-sr-only md:ml-2">{roleEditorOpen ? "닫기" : "변경"}</span>
                      </button>
                    </div>
                  </div>
                  <p
                    className="hidden text-sm font-semibold leading-6 text-zinc-700 md:block"
                    data-testid="admin-role-management-scope"
                  >
                    {roleManagementScopeLabels[user.role]}
                  </p>
                  <p className="hidden text-sm leading-6 text-zinc-600 md:block" data-testid="admin-role-branch-scope">
                    {user.role === "admin"
                      ? "전체 지점"
                      : user.branchIds.map((branchId) => branchById.get(branchId)?.name ?? "지점 확인 중").join(", ")}
                  </p>
                  {roleEditorOpen ? (
                    <form
                      className="col-span-2 mt-1 grid gap-2 md:col-span-4"
                      id={`admin-role-edit-form-${user.id}`}
                      onSubmit={(event) => void handleSaveRole(event, user)}
                    >
                      <label>
                        <span className="sr-only">역할 선택</span>
                        <select
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none transition focus:border-teal-500"
                          value={draftRole}
                          onChange={(event) =>
                            setRoleDrafts((current) => ({
                              ...current,
                              [user.id]: event.target.value as UserRole,
                            }))
                          }
                        >
                          {userRoles.map((role) => (
                            <option key={role} value={role}>
                              {roleLabels[role]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="sr-only">권한 변경 사유</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                          placeholder="변경 사유"
                          value={roleReasons[user.id] ?? ""}
                          onChange={(event) =>
                            setRoleReasons((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      {isSelfAdminDemotion ? (
                        <p className="text-xs font-medium text-red-700">내 총괄 권한은 제거할 수 없습니다.</p>
                      ) : null}
                      <Button size="sm" variant="secondary" disabled={!canSaveRole} type="submit">
                        역할 저장
                      </Button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className="grid min-w-0 gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">권한 매트릭스</h2>
                <p className="mt-1 text-sm text-zinc-600">총괄 어드민의 권한 상태입니다.</p>
              </div>
              <ShieldCheck className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
            </div>
            <div
              className="rounded-lg border border-zinc-200 bg-white p-3"
              data-testid="admin-role-permission-summary"
            >
              {[
                { label: "허용", value: permissionSummary.allowed, className: "bg-emerald-500", textClassName: "text-emerald-700" },
                { label: "제한", value: permissionSummary.restricted, className: "bg-red-500", textClassName: "text-red-700" },
                { label: "거부", value: permissionSummary.denied, className: "bg-zinc-400", textClassName: "text-zinc-600" },
              ].map((item) => {
                const percent = Math.round((item.value / permissionSummary.total) * 100);

                return (
                  <div className="grid grid-cols-[2.75rem_1fr_3rem] items-center gap-2 py-1.5" data-testid="admin-role-permission-summary-row" key={item.label}>
                    <span className={`text-xs font-semibold ${item.textClassName}`}>{item.label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-zinc-100">
                      <span className={`block h-full rounded-full ${item.className}`} style={{ width: `${percent}%` }} />
                    </span>
                    <span className="text-right text-xs font-semibold tabular-nums text-zinc-700">{item.value}건</span>
                  </div>
                );
              })}
              <button
                aria-controls="admin-role-permission-detail"
                aria-expanded={permissionMatrixOpen}
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 sm:hidden"
                data-testid="admin-role-permission-detail-toggle"
                type="button"
                onClick={() => setPermissionMatrixOpen((current) => !current)}
              >
                세부 권한 {permissionMatrixOpen ? "닫기" : "보기"}
                <ChevronDown className={`h-4 w-4 transition ${permissionMatrixOpen ? "rotate-180" : ""}`} aria-hidden />
              </button>
            </div>
            <div
              className={`max-w-full overflow-x-auto ${permissionMatrixOpen ? "mt-3" : "hidden sm:mt-3 sm:block"}`}
              data-testid="admin-role-permission-detail"
              id="admin-role-permission-detail"
            >
              <PermissionMatrix rows={adminPermissionRows} />
            </div>
          </div>

        </div>
      </section>

      <section className="mt-3 rounded-lg border border-zinc-200 bg-white p-2" data-testid="admin-role-recent-change-section">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">최근 계정 변경</h2>
          </div>
          {hiddenRecentRoleAuditLogCount > 0 ? (
            <button
              aria-controls="admin-role-recent-change-list"
              aria-expanded={showAllRecentRoleChanges}
              aria-label={showAllRecentRoleChanges ? "최근 변경 접기" : `최근 변경 ${hiddenRecentRoleAuditLogCount}건 더 보기`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
              data-testid="admin-role-recent-change-toggle"
              type="button"
              onClick={() => setShowAllRecentRoleChanges((current) => !current)}
            >
              {showAllRecentRoleChanges ? "접기" : `${hiddenRecentRoleAuditLogCount}건 더`}
            </button>
          ) : (
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-teal-700">
              <History className="h-4 w-4" aria-hidden />
            </span>
          )}
        </div>
        {recentRoleAuditLogs.length === 0 ? (
          <div className="mt-1.5 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-sm leading-5 text-amber-900" data-testid="admin-role-recent-change-empty">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>아직 계정 변경 이력이 없습니다.</p>
          </div>
        ) : (
          <div className="mt-1.5 divide-y divide-zinc-100" data-testid="admin-role-recent-change-list" id="admin-role-recent-change-list">
            {visibleRecentRoleAuditLogs.map((log) => (
              <article
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 py-1"
                data-testid="admin-role-recent-change-row"
                key={log.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">{log.message}</p>
                  <p className="mt-0.5 truncate text-[11px] leading-4 text-zinc-500">
                    {auditActionLabels[log.action]} · {formatDateTime(log.createdAt)}
                  </p>
                </div>
                <p className="text-xs font-semibold text-zinc-600">{auditResultLabels[log.result]}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
