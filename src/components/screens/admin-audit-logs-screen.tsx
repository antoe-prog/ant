"use client";

import { type FormEvent, useMemo, useState } from "react";
import { FileDown, Filter, RefreshCw, Search, ShieldCheck, XCircle } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-blocks";
import { useApiContext } from "@/hooks/use-api-context";
import { useResource } from "@/hooks/use-resource";
import { apiClient, type AuditLogsQuery } from "@/lib/api-client";
import type { AuditAction, AuditLog } from "@/lib/domain";
import { formatDateKey, formatDateTime } from "@/lib/format";
import { SectionHeader } from "@/components/ui/primitives";

const auditActionLabels: Record<AuditAction, string> = {
  "attendance.update": "출석 변경",
  "notice.create": "공지 작성",
  "notice.delete": "공지 삭제",
  "notice.read": "공지 읽음",
  "notification.subscribe": "알림 수신 등록",
  "notification.unsubscribe": "알림 수신 해제",
  "notification.dispatch": "공지 알림 발송",
  "member.create": "회원 생성",
  "member.update": "회원 수정",
  "counseling_note.create": "상담 메모",
  "promotion.create": "승급 심사 등록",
  "promotion.update": "승급 심사 결과",
  "class.create": "수업 생성",
  "class.update": "수업 수정",
  "payment.create": "결제 등록",
  "payment.online_checkout.create": "온라인 결제 요청",
  "payment.webhook": "결제 상태 반영",
  "payment.recurring_agreement.create": "정기결제 약정",
  "payment.recurring_agreement.cancel": "정기결제 해지",
  "payment.refund": "환불/취소",
  "branch.create": "지점 생성",
  "branch.update": "지점 수정",
  "branch.owner.assign": "대표 배정",
  "user.invite.create": "사용자 초대",
  "user.invite.approve": "초대 승인",
  "user.update": "사용자 수정",
  "user.role.update": "권한 변경",
  "user.delete": "사용자 삭제",
  "audit_logs.read": "변경 기록 조회",
  "export.create": "내보내기",
  "pilot_readiness.update": "운영 준비",
  "pilot_incident.create": "운영 이슈 기록",
  "pilot_incident.update": "운영 이슈 변경",
  "pilot_operation.update": "운영 로그",
  "auth.invite.accept": "초대 수락",
  "auth.password_reset.request": "비밀번호 재설정",
  "auth.password_reset.complete": "비밀번호 재발급",
  "auth.login": "로그인",
  "auth.logout": "로그아웃",
};

const auditActionOptions = Object.keys(auditActionLabels) as AuditAction[];
const defaultVisibleAuditLogCount = 5;
const auditTargetTypeLabels: Record<AuditLog["targetType"], string> = {
  attendance: "출석",
  auth: "로그인",
  audit: "변경 기록",
  branch: "지점",
  class: "수업",
  counseling_note: "상담",
  promotion: "승급 심사",
  export: "내보내기",
  member: "회원",
  notice: "공지",
  notification: "알림",
  payment: "결제",
  pilot_incident: "운영 이슈",
  pilot_operation: "운영 로그",
  pilot_readiness: "운영 준비",
  push_subscription: "알림 등록",
  user: "사용자",
};
const resultLabels: Record<AuditLog["result"], string> = {
  success: "성공",
  blocked: "확인 필요",
  failed: "실패",
};

const resultBadgeClasses: Record<AuditLog["result"], string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blocked: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
};

type AuditLogDraftFilters = {
  action: AuditAction | "all";
  branchId: string;
  from: string;
  limit: number;
  q: string;
  result: AuditLog["result"] | "all";
  to: string;
};

function formatPayload(payload: AuditLog["before"] | AuditLog["after"]) {
  if (!payload) {
    return "변경 내용 없음";
  }

  return JSON.stringify(payload, null, 2);
}

function hasAuditPayload(payload: AuditLog["before"] | AuditLog["after"]) {
  return Boolean(payload && Object.keys(payload).length > 0);
}

function shouldShowAuditPayload(log: AuditLog) {
  if (log.action === "auth.login" || log.action === "auth.logout" || log.action === "audit_logs.read") {
    return false;
  }

  return hasAuditPayload(log.before) || hasAuditPayload(log.after);
}

function toInputDate(value: Date) {
  return formatDateKey(value);
}

function createInitialFilters(): AuditLogDraftFilters {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 14);

  return {
    action: "all",
    branchId: "all",
    from: toInputDate(from),
    limit: 50,
    q: "",
    result: "all",
    to: "",
  };
}

export function AdminAuditLogsScreen() {
  const context = useApiContext();
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [openPayloadLogIds, setOpenPayloadLogIds] = useState<string[]>([]);
  const [showAllAuditLogs, setShowAllAuditLogs] = useState(false);
  const [draftFilters, setDraftFilters] = useState(() => createInitialFilters());
  const [filters, setFilters] = useState<AuditLogsQuery>(() => ({
    ...createInitialFilters(),
    reason: "총괄 변경 기록 화면 조회",
  }));
  const { data, loading, error, reload } = useResource(
    () => apiClient.getAuditLogs(filters),
    [filters.action, filters.branchId, filters.from, filters.limit, filters.q, filters.result, filters.to],
  );
  const branchById = useMemo(() => new Map(context.db.branches.map((branch) => [branch.id, branch])), [context.db.branches]);
  const userById = useMemo(() => new Map(context.db.users.map((user) => [user.id, user])), [context.db.users]);
  const filteredLogs = data?.logs ?? [];
  const visibleAuditLogs = showAllAuditLogs ? filteredLogs : filteredLogs.slice(0, defaultVisibleAuditLogCount);
  const hiddenAuditLogCount = Math.max(filteredLogs.length - visibleAuditLogs.length, 0);
  const appliedFilterLabels = useMemo(() => {
    const branchLabel =
      filters.branchId === "all"
        ? "전체 지점"
        : filters.branchId === "system"
          ? "공통 기록"
          : branchById.get(filters.branchId ?? "")?.name ?? "지점 확인";
    const actionLabel = filters.action && filters.action !== "all" ? auditActionLabels[filters.action as AuditAction] : "전체 처리";
    const resultLabel = filters.result && filters.result !== "all" ? resultLabels[filters.result as AuditLog["result"]] : "전체 결과";
    const periodLabel = filters.from ? (filters.to ? `${filters.from} ~ ${filters.to}` : `${filters.from} 이후`) : "전체 기간";

    return [filters.q ? `검색 ${filters.q}` : null, branchLabel, actionLabel, resultLabel, periodLabel].filter(
      (label): label is string => Boolean(label),
    );
  }, [branchById, filters.action, filters.branchId, filters.from, filters.q, filters.result, filters.to]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({
      ...draftFilters,
      reason: "총괄 변경 기록 화면 조회",
    });
    setFilterPanelOpen(false);
    setShowAllAuditLogs(false);
    setOpenPayloadLogIds([]);
  }

  function togglePayload(logId: string) {
    setOpenPayloadLogIds((current) =>
      current.includes(logId) ? current.filter((currentId) => currentId !== logId) : [...current, logId],
    );
  }

  return (
    <div>
      <SectionHeader
        title="변경 기록"
        action={
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
            type="button"
            onClick={reload}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            새로고침
          </button>
        }
      />

      <form className="rounded-lg border border-zinc-200 bg-white p-3 sm:p-4" data-testid="admin-audit-filter-panel" onSubmit={applyFilters}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Filter className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-950 sm:text-base">검색 필터</h2>
              <p className="mt-0.5 hidden truncate text-xs font-medium text-zinc-500 sm:block">적용된 조건을 유지합니다.</p>
            </div>
          </div>
          <button
            aria-controls="admin-audit-filter-fields"
            aria-expanded={filterPanelOpen}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
            data-testid="admin-audit-filter-toggle"
            type="button"
            onClick={() => setFilterPanelOpen((current) => !current)}
          >
            {filterPanelOpen ? "필터 닫기" : "필터 열기"}
          </button>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5" data-testid="admin-audit-active-filter-summary">
          {appliedFilterLabels.slice(0, 5).map((label) => (
            <span
              className="inline-flex min-h-7 shrink-0 items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 text-xs font-semibold text-zinc-700"
              key={label}
            >
              {label}
            </span>
          ))}
        </div>
        <div
          className={`mt-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_0.9fr] xl:grid-cols-[1.4fr_1fr_1fr_0.9fr_0.8fr_0.8fr] ${
            filterPanelOpen ? "" : "hidden"
          }`}
          data-testid="admin-audit-filter-fields"
          id="admin-audit-filter-fields"
        >
          <label>
            <span className="sr-only">변경 기록 검색어</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-400" aria-hidden />
              <input
                className="h-10 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                placeholder="메시지, 처리 항목, 담당자, 대상 검색"
                value={draftFilters.q}
                onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
              />
            </span>
          </label>
          <label>
            <span className="sr-only">지점 필터</span>
            <select
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              value={draftFilters.branchId}
              onChange={(event) => setDraftFilters((current) => ({ ...current, branchId: event.target.value }))}
            >
              <option value="all">전체 지점/공통</option>
              <option value="system">공통 기록</option>
              {context.db.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">처리 항목 필터</span>
            <select
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              value={draftFilters.action}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, action: event.target.value as AuditLogDraftFilters["action"] }))
              }
            >
              <option value="all">전체 처리 항목</option>
              {auditActionOptions.map((action) => (
                <option key={action} value={action}>
                  {auditActionLabels[action]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">결과 필터</span>
            <select
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              value={draftFilters.result}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, result: event.target.value as AuditLogDraftFilters["result"] }))
              }
            >
              <option value="all">전체 결과</option>
              {Object.entries(resultLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">시작일</span>
            <input
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              type="date"
              value={draftFilters.from ?? ""}
              onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))}
            />
          </label>
          <div className="flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">종료일</span>
              <input
                className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                type="date"
                value={draftFilters.to ?? ""}
                onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))}
              />
            </label>
            <button
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
              data-testid="admin-audit-filter-submit"
              type="submit"
            >
              적용
            </button>
          </div>
        </div>
      </form>

      {loading ? <div className="mt-4"><LoadingState /></div> : null}
      {error ? <div className="mt-4"><ErrorState description={error} onRetry={reload} /></div> : null}

      {data && !loading && !error ? (
        <>
          <section
            className="mt-4 grid grid-cols-4 overflow-hidden rounded-md border border-zinc-200 bg-white"
            aria-label="변경 기록 요약"
            data-testid="admin-audit-summary-bar"
          >
            {[
              { label: "조회", value: data.summary.filteredCount, className: "text-zinc-700", tileClassName: "" },
              { label: "성공", value: data.summary.successCount, className: "text-emerald-700", tileClassName: "border-l border-emerald-100 bg-emerald-50" },
              {
                label: "확인",
                value: data.summary.blockedCount + data.summary.failedCount,
                className: "text-red-700",
                tileClassName: "border-l border-red-100 bg-red-50",
              },
              { label: "내보내기", value: data.summary.exportCount, className: "text-blue-700", tileClassName: "border-l border-blue-100 bg-blue-50" },
            ].map((item) => (
              <div className={`flex min-w-0 items-center justify-center gap-1 px-1 py-1 text-center ${item.tileClassName}`} key={item.label}>
                <p className={`truncate text-[10px] font-semibold leading-4 sm:text-xs ${item.className}`}>{item.label}</p>
                <p className="text-sm font-semibold leading-4 tabular-nums text-zinc-950 sm:text-base">{item.value}</p>
              </div>
            ))}
          </section>

          {filteredLogs.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="조건에 맞는 변경 기록이 없습니다" />
            </div>
          ) : (
            <section className="mt-4 rounded-lg border border-zinc-200 bg-white" aria-label="변경 기록 목록">
              <div className="hidden grid-cols-[0.9fr_1fr_1fr_1.15fr_0.8fr] border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500 lg:grid">
                <span>일시</span>
                <span>처리 항목</span>
                <span>담당자/지점</span>
                <span>대상</span>
                <span>결과</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {visibleAuditLogs.map((log) => {
                  const actor = userById.get(log.actorUserId);
                  const branch = log.branchId ? branchById.get(log.branchId) : null;
                  const ActionIcon = log.action === "export.create" ? FileDown : log.result === "success" ? ShieldCheck : XCircle;
                  const hasChangePayload = shouldShowAuditPayload(log);
                  const payloadOpen = openPayloadLogIds.includes(log.id);
                  const payloadDetailId = `admin-audit-change-detail-${log.id}`;

                  return (
                    <article
                      className="grid gap-1 px-3 py-1.5 lg:grid-cols-[0.9fr_1fr_1fr_1.15fr_0.8fr] lg:items-start lg:gap-1 lg:px-4 lg:py-2"
                      data-testid="admin-audit-log-row"
                      key={log.id}
                    >
                      <div className="hidden lg:block">
                        <p className="text-sm leading-5 text-zinc-600">{formatDateTime(log.createdAt)}</p>
                      </div>
                      <div className="flex min-w-0 items-center gap-2 lg:block">
                        <div className="min-w-0 flex-1">
                          <p className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-sm font-semibold leading-5 text-zinc-950">
                            <ActionIcon className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                            <span className="truncate">{auditActionLabels[log.action]}</span>
                          </p>
                          <p className="mt-0.5 truncate text-[11px] font-medium leading-4 text-zinc-500 lg:hidden">
                            {formatDateTime(log.createdAt)} · {actor?.name ?? "담당자 확인 중"}
                          </p>
                        </div>
                        <span
                          className={`inline-flex h-6 w-fit shrink-0 items-center rounded-md border px-1.5 text-[11px] font-semibold leading-4 lg:hidden ${resultBadgeClasses[log.result]}`}
                          data-testid="admin-audit-result-badge"
                        >
                          {resultLabels[log.result]}
                        </span>
                        {hasChangePayload ? (
                          <button
                            aria-controls={payloadDetailId}
                            aria-expanded={payloadOpen}
                            aria-label={payloadOpen ? "변경값 닫기" : "변경값 보기"}
                            className="inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-1 text-[11px] font-semibold leading-none text-zinc-700 transition hover:bg-zinc-100 lg:hidden"
                            data-testid="admin-audit-change-detail-toggle"
                            type="button"
                            onClick={() => togglePayload(log.id)}
                          >
                            {payloadOpen ? "닫기" : "상세"}
                          </button>
                        ) : null}
                      </div>
                      <div className="hidden lg:block">
                        <p className="text-sm font-medium text-zinc-950">{actor?.name ?? "담당자 확인 중"}</p>
                        <p className="mt-1 hidden text-xs text-zinc-500 sm:block" data-testid="admin-audit-branch-meta">
                          {branch?.name ?? "공통"}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-zinc-950">{log.message}</p>
                          {hasChangePayload ? (
                            <button
                              aria-controls={payloadDetailId}
                              aria-expanded={payloadOpen}
                              className="hidden min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 lg:inline-flex"
                              data-testid="admin-audit-change-detail-toggle"
                              type="button"
                              onClick={() => togglePayload(log.id)}
                            >
                              {payloadOpen ? "변경값 닫기" : "변경값 보기"}
                            </button>
                          ) : null}
                        </div>
                        <p className="mt-1 hidden break-all text-xs text-zinc-500 sm:block" data-testid="admin-audit-target-meta">
                          {auditTargetTypeLabels[log.targetType]}
                        </p>
                        {hasChangePayload && payloadOpen ? (
                          <div
                            className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3"
                            data-testid="admin-audit-change-detail"
                            id={payloadDetailId}
                          >
                            <div className="grid gap-2 xl:grid-cols-2">
                              <div>
                                <p className="text-xs font-semibold text-zinc-500">변경 전</p>
                                <pre className="mt-1 max-h-44 overflow-auto rounded-md bg-white p-2 text-xs leading-5 text-zinc-700">
                                  {formatPayload(log.before)}
                                </pre>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-zinc-500">변경 후</p>
                                <pre className="mt-1 max-h-44 overflow-auto rounded-md bg-white p-2 text-xs leading-5 text-zinc-700">
                                  {formatPayload(log.after)}
                                </pre>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <span
                        className={`hidden h-7 w-fit items-center rounded-md border px-2 text-xs font-semibold lg:inline-flex ${resultBadgeClasses[log.result]}`}
                        data-testid="admin-audit-result-badge"
                      >
                        {resultLabels[log.result]}
                      </span>
                    </article>
                  );
                })}
              </div>
              {filteredLogs.length > defaultVisibleAuditLogCount ? (
                <div className="border-t border-zinc-100 p-3">
                  <button
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
                    data-testid="admin-audit-log-list-toggle"
                    type="button"
                    onClick={() => setShowAllAuditLogs((current) => !current)}
                  >
                    {showAllAuditLogs ? "변경 기록 접기" : `변경 기록 ${hiddenAuditLogCount}건 더 보기`}
                  </button>
                </div>
              ) : null}
            </section>
          )}
          <div className="h-28 lg:hidden" aria-hidden="true" data-testid="admin-audit-bottom-safe-area" />
        </>
      ) : null}
    </div>
  );
}
