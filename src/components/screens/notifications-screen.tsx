"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, CheckCheck, CreditCard, MailOpen, Medal, Trash2 } from "lucide-react";
import type { AppUser, BeltPromotion, EnrichedPayment, Notice } from "@/lib/domain";
import { apiClient } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  canShowPaymentNotificationForRole,
  formatNotificationActionableLabel,
  getNotificationAlertCounts,
  getNotificationScopeBranchIds,
  isPaymentNotificationCandidate,
  isUpcomingPromotionExam,
} from "@/lib/notification-alerts";
import { getAccessibleMemberIds } from "@/lib/mock-api";
import { canDeleteNotice } from "@/lib/notice-permissions";
import { isNoticeReadByUser, sortNoticesForDisplay } from "@/lib/notices";
import { getFamilyPaymentCheckoutAccess, getFamilyPaymentPlanLine } from "@/lib/payment-checkout-access";
import { paymentStatusLabels, roleLabels } from "@/lib/roles";
import { useApiContext } from "@/hooks/use-api-context";
import { useResource } from "@/hooks/use-resource";
import { useAppStore } from "@/store/app-store";
import { Button, SectionHeader } from "@/components/ui/primitives";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-blocks";

type NotificationFilter = "all" | "unread" | "important" | "payment" | "promotion";
type NotificationKind = "notice" | "payment" | "promotion";
type NotificationTone = "critical" | "warning" | "teal" | "zinc";

type NotificationItem = {
  body: string;
  createdAt: string;
  href: string;
  id: string;
  important: boolean;
  kind: NotificationKind;
  kindLabel: string;
  actionLabel: string;
  meta: string;
  noticeCanDelete?: boolean;
  noticeBranchId?: string;
  noticeId?: string;
  read: boolean;
  title: string;
  tone: NotificationTone;
};

function audienceLabel(notice: Notice) {
  return notice.audience.map((item) => (item === "all" ? "전체" : roleLabels[item])).join(", ");
}

function noticeTargetLabel(notice: Notice, context: ReturnType<typeof useApiContext>) {
  const classNames = (notice.targetClassIds ?? [])
    .map((classId) => context.db.classes.find((session) => session.id === classId)?.name)
    .filter(Boolean);
  const memberNames = (notice.targetMemberIds ?? [])
    .map((memberId) => context.db.members.find((member) => member.id === memberId)?.name)
    .filter(Boolean);

  if (classNames.length === 0 && memberNames.length === 0) {
    return "지점 전체";
  }

  return [
    ...classNames.map((name) => `반 ${name}`),
    ...memberNames.map((name) => `개인 ${name}`),
  ].join(", ");
}

function buildNoticeNotification(notice: Notice, context: ReturnType<typeof useApiContext>): NotificationItem {
  const read = isNoticeReadByUser(notice, context.user.id);

  return {
    body: notice.body,
    createdAt: notice.createdAt,
    href: `/app/notices?highlight=${encodeURIComponent(notice.id)}`,
    id: `notice-${notice.id}`,
    important: Boolean(notice.important),
    kind: "notice",
    kindLabel: "공지",
    actionLabel: "보기",
    meta: `${audienceLabel(notice)} · ${noticeTargetLabel(notice, context)} · ${formatDateTime(notice.createdAt)}`,
    noticeCanDelete: canDeleteNotice(context.user, context.db, notice),
    noticeBranchId: notice.branchId,
    noticeId: notice.id,
    read,
    title: notice.title,
    tone: read ? "zinc" : notice.important ? "critical" : "teal",
  };
}

function paymentNotificationTarget(payment: EnrichedPayment, user: AppUser) {
  const checkoutAccess = getFamilyPaymentCheckoutAccess(user, payment, payment.member);

  if (checkoutAccess.canOpen) {
    return { actionLabel: checkoutAccess.label, href: `/app/payments/checkout?paymentId=${encodeURIComponent(payment.id)}` };
  }

  return {
    actionLabel: checkoutAccess.state === "guardian_required" ? "학부모 확인" : "납부 확인",
    href: "/app/payments",
  };
}

function buildPaymentNotification(payment: EnrichedPayment, user: AppUser): NotificationItem | null {
  if (!isPaymentNotificationCandidate(payment)) {
    return null;
  }

  const checkoutPending = payment.onlinePayment?.status === "pending";
  const critical = payment.status === "overdue";
  const target = paymentNotificationTarget(payment, user);
  const paymentPlanLine = getFamilyPaymentPlanLine(payment.planName, payment.member.ageGroup);
  const title = critical
    ? `${payment.member.name} 미납 결제 확인`
    : checkoutPending
      ? `${payment.member.name} 납부 정보 확인 필요`
      : `${payment.member.name} 회원권 만료 예정`;

  return {
    body: `${paymentPlanLine} · ${paymentStatusLabels[payment.status]} · 납부일 ${formatDate(payment.dueDate)}`,
    createdAt: payment.dueDate,
    href: target.href,
    id: `payment-${payment.id}`,
    important: critical,
    kind: "payment",
    kindLabel: "결제",
    actionLabel: target.actionLabel,
    meta: `${payment.branch.name} · ${payment.member.name}`,
    read: true,
    title,
    tone: critical ? "critical" : "warning",
  };
}

function buildPromotionNotification(
  promotion: BeltPromotion,
  context: ReturnType<typeof useApiContext>,
): NotificationItem {
  const member = context.db.members.find((item) => item.id === promotion.memberId);
  const branch = context.db.branches.find((item) => item.id === promotion.branchId);

  return {
    body: `${promotion.fromBelt} → ${promotion.toBelt} · 심사일 ${formatDate(promotion.examDate)}`,
    createdAt: promotion.examDate,
    href: "/app/promotions",
    id: `promotion-${promotion.id}`,
    important: false,
    kind: "promotion",
    kindLabel: "승급",
    actionLabel: "승급 심사 확인",
    meta: `${branch?.name ?? "지점 미지정"} · ${member?.name ?? "회원"}`,
    read: true,
    title: `${member?.name ?? "회원"} 승급 심사 임박`,
    tone: "teal",
  };
}

const toneClasses = {
  critical: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  teal: "border-teal-200 bg-teal-50 text-teal-700",
  zinc: "border-zinc-200 bg-zinc-50 text-zinc-700",
} satisfies Record<NotificationTone, string>;

const kindIcons = {
  notice: Bell,
  payment: CreditCard,
  promotion: Medal,
} satisfies Record<NotificationKind, React.ComponentType<{ className?: string }>>;

// ?filter=unread 같은 딥링크·새로고침에서 필터 상태를 복원한다.
function getInitialNotificationFilter(): NotificationFilter {
  if (typeof window === "undefined") {
    return "all";
  }

  const value = new URLSearchParams(window.location.search).get("filter");

  return value === "unread" || value === "important" || value === "payment" || value === "promotion" ? value : "all";
}

function syncNotificationFilterToUrl(value: NotificationFilter) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (value === "all") {
    url.searchParams.delete("filter");
  } else {
    url.searchParams.set("filter", value);
  }

  window.history.replaceState(window.history.state, "", url);
}

export function NotificationsScreen() {
  const context = useApiContext();
  const { deleteNotice, markNoticeAsRead, markNoticesAsRead } = useAppStore();
  const [notificationFilter, setNotificationFilterState] = useState<NotificationFilter>(getInitialNotificationFilter);

  function setNotificationFilter(value: NotificationFilter) {
    setNotificationFilterState(value);
    syncNotificationFilterToUrl(value);
  }
  const [readFeedback, setReadFeedback] = useState<string | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);
  const [readNoticePendingId, setReadNoticePendingId] = useState<string | null>(null);
  const [deleteConfirmNoticeId, setDeleteConfirmNoticeId] = useState<string | null>(null);
  const [deletingNoticeId, setDeletingNoticeId] = useState<string | null>(null);
  const [bulkReadPending, setBulkReadPending] = useState(false);
  const notificationFeedback = deleteFeedback ?? readFeedback;
  const canManageNoticeNotifications = context.user.role === "owner" || context.user.role === "admin" || context.user.role === "coach";
  const { data, loading, error, reload } = useResource(
    async () => {
      const [notices, payments] = await Promise.all([
        apiClient.getNotices(context),
        apiClient.getPayments(context),
      ]);

      return { notices, payments };
    },
    [context.user.id, context.selectedBranchId, context.version],
  );
  const notificationItems = useMemo(() => {
    if (!data) {
      return [];
    }

    const noticeItems = sortNoticesForDisplay(data.notices).map((notice) => buildNoticeNotification(notice, context));
    const paymentItems = canShowPaymentNotificationForRole(context.user.role)
      ? data.payments.flatMap((payment) => {
          const item = buildPaymentNotification(payment, context.user);

          return item ? [item] : [];
        })
      : [];
    // 승급 알림: 요약 카운트(getNotificationAlertCounts)와 동일한 스코프/조건으로 카드 생성
    const scopeBranchIds = getNotificationScopeBranchIds(context.user, context.db, context.selectedBranchId);
    const accessibleMemberIds = new Set(getAccessibleMemberIds(context.user, context.db, scopeBranchIds));
    const promotionItems = (context.db.promotions ?? [])
      .filter(
        (promotion) =>
          scopeBranchIds.includes(promotion.branchId) &&
          accessibleMemberIds.has(promotion.memberId) &&
          isUpcomingPromotionExam(promotion.examDate, promotion.result),
      )
      .map((promotion) => buildPromotionNotification(promotion, context));
    return [...noticeItems, ...paymentItems, ...promotionItems].sort(
      (left, right) =>
        Number(!right.read) - Number(!left.read) ||
        Number(right.important) - Number(left.important) ||
        right.createdAt.localeCompare(left.createdAt),
    );
  }, [context, data]);

  if (loading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState description={error ?? "알림을 불러오지 못했습니다."} onRetry={reload} />;
  }

  const unreadNoticeItems = notificationItems.filter((item) => item.kind === "notice" && !item.read);
  const importantItems = notificationItems.filter((item) => item.important);
  const paymentItems = notificationItems.filter((item) => item.kind === "payment");
  const promotionItems = notificationItems.filter((item) => item.kind === "promotion");
  const filterOptions: Array<{ ariaLabel: string; count: number; label: string; testId: string; value: NotificationFilter }> = [
    { ariaLabel: "전체 알림", count: notificationItems.length, label: "전체", testId: "notification-filter-all", value: "all" },
    { ariaLabel: "공지 미확인", count: unreadNoticeItems.length, label: "미확인", testId: "notification-filter-unread", value: "unread" },
    { ariaLabel: "중요 알림", count: importantItems.length, label: "중요", testId: "notification-filter-important", value: "important" },
    // 종류 필터는 해당 알림이 있을 때만 노출해 칩 줄이 불필요하게 길어지지 않게 한다.
    ...(paymentItems.length > 0
      ? [{ ariaLabel: "결제 알림", count: paymentItems.length, label: "결제", testId: "notification-filter-payment", value: "payment" as const }]
      : []),
    ...(promotionItems.length > 0
      ? [{ ariaLabel: "승급 알림", count: promotionItems.length, label: "승급", testId: "notification-filter-promotion", value: "promotion" as const }]
      : []),
  ];
  const filteredItems = notificationItems.filter((item) => {
    if (notificationFilter === "unread") {
      return item.kind === "notice" && !item.read;
    }

    if (notificationFilter === "important") {
      return item.important;
    }

    if (notificationFilter === "payment" || notificationFilter === "promotion") {
      return item.kind === notificationFilter;
    }

    return true;
  });
  const filteredUnreadNoticeIds = filteredItems
    .filter((item) => item.kind === "notice" && !item.read && item.noticeId)
    .map((item) => item.noticeId as string);
  const notificationCounts = getNotificationAlertCounts({
    db: context.db,
    selectedBranchId: context.selectedBranchId,
    user: context.user,
  });
  const notificationActionableSummary =
    formatNotificationActionableLabel(notificationCounts, " · ") || "미확인 공지 0건";

  async function handleMarkFilteredNotificationsAsRead() {
    if (filteredUnreadNoticeIds.length === 0 || bulkReadPending) {
      return;
    }

    setBulkReadPending(true);
    setReadFeedback(null);
    setDeleteFeedback(null);

    const ok = await markNoticesAsRead(filteredUnreadNoticeIds);

    setReadFeedback(ok ? `미확인 공지 ${filteredUnreadNoticeIds.length}건을 읽음 처리했습니다.` : "공지 읽음 상태를 저장하지 못했습니다.");
    setBulkReadPending(false);
  }

  async function handleMarkNotificationAsRead(noticeId: string) {
    if (readNoticePendingId) {
      return;
    }

    setReadNoticePendingId(noticeId);
    setReadFeedback(null);
    setDeleteFeedback(null);

    const ok = await markNoticeAsRead(noticeId);

    setReadFeedback(ok ? "공지 확인을 저장했습니다." : "공지 확인 상태를 저장하지 못했습니다.");
    setReadNoticePendingId(null);
  }

  async function handleDeleteNotificationNotice(item: NotificationItem) {
    if (!item.noticeBranchId || !item.noticeId || deletingNoticeId) {
      return;
    }

    setDeletingNoticeId(item.noticeId);
    setReadFeedback(null);
    setDeleteFeedback(null);

    const result = await deleteNotice(item.noticeBranchId, item.noticeId);

    setDeleteFeedback(result.message);
    setDeleteConfirmNoticeId(result.ok ? null : item.noticeId);
    setDeletingNoticeId(null);
  }

  const notificationBulkReadAriaLabel =
    filteredUnreadNoticeIds.length > 0
      ? `현재 필터의 미확인 공지 ${filteredUnreadNoticeIds.length}건 읽음 처리`
      : "현재 필터에 읽음 처리할 공지가 없습니다";
  const notificationBulkReadDone = filteredUnreadNoticeIds.length === 0;
  const notificationBulkReadButtonLabel = bulkReadPending ? "처리 중" : notificationBulkReadDone ? "읽음 완료" : "읽음 처리";

  return (
    <div data-testid="notifications-screen">
      <SectionHeader title="알림함" />

      <section className="rounded-lg border border-zinc-200 bg-white" aria-label="알림 목록">
        <div className="grid gap-2 border-b border-zinc-100 px-3 py-2.5 sm:px-4">
          <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7.25rem]">
            <div className="flex min-w-0 flex-wrap gap-1.5" data-testid="notification-filter-toolbar" role="group" aria-label="알림 보기">
              {filterOptions.map((option) => (
                <button
                  aria-label={`${option.ariaLabel} ${option.count}건`}
                  aria-pressed={notificationFilter === option.value}
                  className={`inline-flex min-h-11 min-w-[4.625rem] shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-1 ${
                    notificationFilter === option.value
                      ? "bg-teal-700 text-white"
                      : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                  }`}
                  data-testid={option.testId}
                  key={option.value}
                  type="button"
                  onClick={() => setNotificationFilter(option.value)}
                >
                  <span className="whitespace-nowrap">{option.label}</span>
                  <span
                    className={`whitespace-nowrap rounded-full px-1.5 text-[10px] leading-4 tabular-nums ${
                      notificationFilter === option.value ? "bg-white/20 text-white" : "bg-white text-zinc-500"
                    }`}
                  >
                    {option.count}
                  </span>
                </button>
              ))}
            </div>
            <Button
              aria-label={notificationBulkReadAriaLabel}
              className={`min-h-11 w-11 shrink-0 gap-1 px-0 whitespace-nowrap sm:w-auto sm:px-2 ${
                notificationBulkReadDone ? "border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-50" : ""
              }`}
              data-notification-bulk-read-state={notificationBulkReadDone ? "done" : "active"}
              data-testid="notification-bulk-read-filtered"
              disabled={notificationBulkReadDone || bulkReadPending}
              size="sm"
              variant="secondary"
              onClick={() => void handleMarkFilteredNotificationsAsRead()}
            >
              <CheckCheck className={`h-4 w-4 ${notificationBulkReadDone ? "text-zinc-400" : ""}`} aria-hidden />
              <span className="sr-only sm:not-sr-only">{notificationBulkReadButtonLabel}</span>
            </Button>
          </div>
          {notificationFeedback ? (
            <div className="min-h-5 min-w-0">
              {deleteFeedback ? (
                <p className="truncate text-xs font-medium leading-5 text-zinc-700" data-testid="notification-delete-feedback" aria-live="polite" role="status">
                  {deleteFeedback}
                </p>
              ) : (
                <p className="truncate text-xs font-medium leading-5 text-zinc-700" data-testid="notification-read-feedback" aria-live="polite" role="status">
                  {readFeedback}
                </p>
              )}
              <p className="sr-only" data-testid="notification-actionable-count-summary">
                {notificationActionableSummary}
              </p>
            </div>
          ) : (
            <p className="text-xs font-medium leading-5 text-zinc-500" data-testid="notification-actionable-count-summary">
              {notificationActionableSummary}
            </p>
          )}
        </div>

        {notificationItems.length === 0 ? (
          <div className="p-4">
            <EmptyState title="확인할 알림이 없습니다" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-4">
            <EmptyState title="선택한 알림이 없습니다" />
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {filteredItems.map((item) => {
              const Icon = kindIcons[item.kind];
              const readPending = item.noticeId ? readNoticePendingId === item.noticeId : false;
              const readNotice = item.kind === "notice" && item.read;
              const canDeleteNoticeItem =
                item.kind === "notice" &&
                Boolean(item.noticeBranchId && item.noticeId) &&
                item.noticeCanDelete === true;
              const showKindBadge = item.kind !== "notice";
              const noticeContentClassName = `-m-1 block rounded-md p-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-1 ${
                readNotice ? "hover:bg-zinc-100/70" : "hover:bg-zinc-50"
              }`;
              const importantBadgeClass = readNotice
                ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                : "border-red-200 bg-red-50 text-red-700";
              const readStateBadgeClass = item.read
                ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                : "border-amber-200 bg-amber-50 text-amber-700";

              return (
                <article
                  className={`px-3 py-2 transition-colors sm:px-4 ${readNotice ? "bg-zinc-50/70" : "bg-white"}`}
                  data-notification-kind={item.kind}
                  data-notification-read-state={readNotice ? "read" : "active"}
                  data-testid="notification-inbox-card"
                  key={item.id}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1">
                        {showKindBadge ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${toneClasses[item.tone]}`}
                            data-testid="notification-kind-badge"
                          >
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                            {item.kindLabel}
                          </span>
                        ) : null}
                        {item.important ? (
                          <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${importantBadgeClass}`}>
                            중요
                          </span>
                        ) : null}
                        {item.kind === "notice" ? (
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${readStateBadgeClass}`}
                            data-testid="notification-read-state-badge"
                          >
                            {item.read ? "확인됨" : "미확인"}
                          </span>
                        ) : null}
                        {item.kind !== "notice" ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
                            data-testid="notification-follow-up-state-badge"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                            확인 필요
                          </span>
                        ) : null}
                      </div>
                      {item.kind === "notice" ? (
                        <Link
                          aria-label={`${item.title} 공지함에서 보기`}
                          className={noticeContentClassName}
                          data-testid="notification-notice-content-link"
                          href={item.href}
                        >
                          <h2 className={`mt-1.5 line-clamp-1 text-sm font-semibold leading-5 ${readNotice ? "text-zinc-600" : "text-zinc-950"}`}>{item.title}</h2>
                          <p className={`mt-0.5 hidden line-clamp-1 text-xs leading-5 sm:block ${readNotice ? "text-zinc-500" : "text-zinc-600"}`}>{item.body}</p>
                          <p className={`mt-0.5 line-clamp-1 text-[11px] font-medium leading-4 ${readNotice ? "text-zinc-400" : "text-zinc-500"}`}>{item.meta}</p>
                        </Link>
                      ) : (
                        <>
                          <h2 className={`mt-1.5 line-clamp-1 text-sm font-semibold leading-5 ${readNotice ? "text-zinc-600" : "text-zinc-950"}`}>{item.title}</h2>
                          <p className={`mt-0.5 line-clamp-1 text-xs leading-5 ${readNotice ? "text-zinc-500" : "text-zinc-600"}`}>{item.body}</p>
                          <p className={`mt-0.5 line-clamp-1 text-[11px] font-medium leading-4 ${readNotice ? "text-zinc-400" : "text-zinc-500"}`}>{item.meta}</p>
                        </>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {item.kind === "notice" && !item.read && item.noticeId ? (
                        <button
                          aria-label={`${item.title} 확인 완료`}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-0 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 sm:w-auto sm:px-3"
                          data-testid="notification-read-action"
                          disabled={readPending}
                          title={readPending ? "저장 중" : "확인"}
                          type="button"
                          onClick={() => void handleMarkNotificationAsRead(item.noticeId as string)}
                        >
                          <MailOpen className="h-4 w-4" aria-hidden />
                          <span className="sr-only sm:not-sr-only">{readPending ? "저장 중" : "확인"}</span>
                        </button>
                      ) : null}
                      {canManageNoticeNotifications && canDeleteNoticeItem ? (
                        <button
                          aria-label={`${item.title} 삭제`}
                          className="inline-flex h-11 w-11 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-0 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-16 sm:px-3"
                          data-testid="notification-notice-delete-action"
                          disabled={deletingNoticeId === item.noticeId}
                          title="삭제"
                          type="button"
                          onClick={() => {
                            setDeleteConfirmNoticeId(item.noticeId ?? null);
                            setDeleteFeedback(null);
                            setReadFeedback(null);
                          }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          <span className="sr-only sm:not-sr-only">삭제</span>
                        </button>
                      ) : null}
                      {item.kind !== "notice" ? (
                        <Link
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                          data-notification-action-label={item.actionLabel}
                          data-testid="notification-detail-link"
                          href={item.href}
                        >
                          {item.actionLabel}
                          <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  {canDeleteNoticeItem && deleteConfirmNoticeId === item.noticeId ? (
                    <div
                      className="mt-2 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      data-testid="notification-notice-delete-confirm"
                    >
                      <p className="text-sm font-semibold text-red-800">이 공지를 삭제합니다.</p>
                      <div className="flex gap-2">
                        <button
                          className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                          data-testid="notification-notice-delete-cancel"
                          disabled={deletingNoticeId === item.noticeId}
                          type="button"
                          onClick={() => setDeleteConfirmNoticeId(null)}
                        >
                          취소
                        </button>
                        <button
                          className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-600 bg-red-600 px-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                          data-testid="notification-notice-delete-confirm-action"
                          disabled={deletingNoticeId === item.noticeId}
                          type="button"
                          onClick={() => void handleDeleteNotificationNotice(item)}
                        >
                          {deletingNoticeId === item.noticeId ? "삭제 중" : "삭제"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <div aria-hidden className="h-28 lg:hidden" data-testid="notification-bottom-safe-area" />
    </div>
  );
}
