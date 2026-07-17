"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Medal,
  MessageSquareText,
  Trophy,
} from "lucide-react";
import { ChildSwitcher } from "@/components/domain/child-switcher";
import { useApiContext } from "@/hooks/use-api-context";
import { useGuardianChildSelection } from "@/hooks/use-guardian-child-selection";
import { useResource } from "@/hooks/use-resource";
import { apiClient } from "@/lib/api-client";
import { beltPromotionResultLabels } from "@/lib/domain";
import { formatCompactTimeRange, formatCurrency, formatDate } from "@/lib/format";
import { isNoticeReadByUser, isNoticeRelevantToMember } from "@/lib/notices";
import { getChildSwitcherPresentation } from "@/lib/member-presentation";
import { getFamilyPaymentCheckoutAccess, getFamilyPaymentPlanLine } from "@/lib/payment-checkout-access";
import { getCurrentMemberPayment } from "@/lib/payment-lifecycle";
import { paymentStatusLabels } from "@/lib/roles";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-blocks";
import { MetricCard, OperationalKpiCard, PaymentStatusBadge, SectionHeader } from "@/components/ui/primitives";

type OwnerPeriod = "today" | "7d" | "30d";

const ownerPeriodOptions: { id: OwnerPeriod; label: string; days: number }[] = [
  { id: "today", label: "오늘", days: 1 },
  { id: "7d", label: "7일", days: 7 },
  { id: "30d", label: "30일", days: 30 },
];

function isInUpcomingPeriod(value: string, days: number) {
  const target = new Date(value);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + days);

  return target >= start && target < end;
}

function rateLabel(done: number, total: number) {
  if (total === 0) {
    return "0%";
  }

  return `${Math.round((done / total) * 100)}%`;
}

function percentValue(done: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function compactText(value: string, maxLength = 56) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function formatMobileClassSchedule(name: string, startsAt: string, endsAt: string) {
  return `${name} · ${formatDate(startsAt)} · ${formatCompactTimeRange(startsAt, endsAt)}`;
}

type MobilePriorityCard = {
  actionHref?: string;
  detail: string;
  label: string;
  status: string;
};

const beltProgression = ["흰띠", "노란띠", "주황띠", "초록띠", "파란띠", "갈색띠", "검은띠"] as const;
const coachDashboardNoteTypeLabels: Record<string, string> = {
  caution: "주의",
  follow_up: "후속 상담",
  general: "상담",
  progress: "성장",
};

type CoachDashboardFlowRow = {
  actionHref: string;
  helper: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  progress: number;
  status: string;
  tone: "amber" | "blue" | "teal" | "violet";
  value: string;
};

const coachDashboardFlowToneClasses = {
  amber: {
    bar: "bg-amber-500",
    icon: "border-amber-200 bg-amber-50 text-amber-700",
    value: "text-amber-700",
  },
  blue: {
    bar: "bg-blue-500",
    icon: "border-blue-200 bg-blue-50 text-blue-700",
    value: "text-blue-700",
  },
  teal: {
    bar: "bg-teal-500",
    icon: "border-teal-200 bg-teal-50 text-teal-700",
    value: "text-teal-700",
  },
  violet: {
    bar: "bg-violet-500",
    icon: "border-violet-200 bg-violet-50 text-violet-700",
    value: "text-violet-700",
  },
} satisfies Record<CoachDashboardFlowRow["tone"], { bar: string; icon: string; value: string }>;

function CoachDashboardFlowGraph({
  rows,
}: {
  rows: readonly CoachDashboardFlowRow[];
}) {
  return (
    <div
      className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm sm:col-span-2 xl:col-span-4"
      data-testid="coach-dashboard-flow-graph"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-950">오늘 운영</h2>
        <span className="shrink-0 rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">현장 우선</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 xl:grid-cols-4 max-[420px]:grid-cols-1">
        {rows.map((row) => {
          const Icon = row.icon;
          const tone = coachDashboardFlowToneClasses[row.tone];

          return (
            <Link
              className="group grid min-h-11 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 transition hover:border-teal-200 hover:bg-teal-50/50"
              data-testid="coach-dashboard-flow-row"
              href={row.actionHref}
              key={row.label}
            >
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${tone.icon}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="shrink-0 text-sm font-semibold text-zinc-950">{row.label}</p>
                  <p className="min-w-0 truncate text-xs font-medium text-zinc-500">{row.helper}</p>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white ring-1 ring-inset ring-zinc-200">
                  <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${row.progress}%` }} />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-base font-semibold tabular-nums leading-none ${tone.value}`}>{row.value}</p>
                <p className="mt-1 text-xs font-semibold leading-none text-zinc-500">{row.status}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function FamilyMobilePriorityPanel({
  cards,
}: {
  cards: MobilePriorityCard[];
}) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="회원 핵심 상태"
      className="mb-3 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm"
      data-testid="member-guardian-mobile-priority-panel"
    >
      <div className="divide-y divide-zinc-100" data-testid="member-guardian-priority-grid">
        {cards.map((card) => {
          const content = (
            <>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-950">{card.label}</p>
                <p className="mt-0.5 line-clamp-2 break-words text-xs leading-4 text-zinc-500">{card.detail}</p>
              </div>
              <span className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md bg-teal-50 px-2 text-xs font-semibold tabular-nums text-teal-700">
                {card.status}
                {card.actionHref ? <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden /> : null}
              </span>
            </>
          );

          return card.actionHref ? (
            <Link
              aria-label={`${card.label} 보기`}
              className="group grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 transition hover:bg-teal-50/60"
              data-testid="member-guardian-priority-cell"
              href={card.actionHref}
              key={card.label}
            >
              {content}
            </Link>
          ) : (
            <article
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2"
              data-testid="member-guardian-priority-cell"
              key={card.label}
            >
              {content}
            </article>
          );
        })}
      </div>
    </section>
  );
}

type GuardianLearningInsight = {
  actionHref?: string;
  actionLabel?: string;
  detail: string;
  eyebrow: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  tone: "teal" | "blue" | "amber" | "violet";
  value: string;
};

type GuardianLearningAction = {
  ariaLabel: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
};

const guardianLearningToneClasses = {
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  teal: "border-teal-200 bg-teal-50 text-teal-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
} satisfies Record<GuardianLearningInsight["tone"], string>;

function GuardianLearningSummaryPanel({
  actions,
  childName,
  insights,
  selectedBelt,
}: {
  actions: GuardianLearningAction[];
  childName: string;
  insights: GuardianLearningInsight[];
  selectedBelt: string;
}) {
  const currentBeltIndex = beltProgression.findIndex((belt) => selectedBelt.includes(belt));
  const previousBelt = currentBeltIndex > 0 ? beltProgression[currentBeltIndex - 1] : null;
  const nextBelt =
    currentBeltIndex >= 0 && currentBeltIndex < beltProgression.length - 1
      ? beltProgression[currentBeltIndex + 1]
      : null;

  return (
    <section
      aria-label="자녀 학습 리포트"
      className="mb-4 rounded-lg border border-zinc-200 bg-white p-2 sm:p-3"
      data-testid="guardian-learning-summary-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-zinc-950 sm:text-lg">{childName} 학습 리포트</h1>
        </div>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700 sm:h-8 sm:w-8">
          <Award className="h-4 w-4" aria-hidden />
        </span>
      </div>

      <div
        aria-label="띠 단계 순서. 실제 승급 진척률이 아닙니다."
        className="mt-2 rounded-md bg-teal-50/70 p-2 sm:mt-3 sm:p-2.5"
        data-testid="guardian-learning-stage-bar"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-teal-700">띠 단계</p>
            <p className="mt-1 break-words text-sm font-semibold text-zinc-950">현재 {selectedBelt}</p>
          </div>
          <p className="max-w-32 text-right text-xs leading-4 text-zinc-500">승급 진척률이 아닌 단계 순서입니다.</p>
        </div>
        <ol className="mt-2 grid grid-cols-3 gap-1.5" data-testid="guardian-learning-belt-steps">
          <li className="min-w-0 rounded-md bg-white px-2 py-1.5 text-center">
            <p className="text-xs font-semibold text-zinc-500">이전</p>
            <p className="mt-0.5 truncate text-xs text-zinc-700">{previousBelt ?? "시작"}</p>
          </li>
          <li aria-current="step" className="min-w-0 rounded-md border border-teal-300 bg-teal-100 px-2 py-1.5 text-center">
            <p className="text-xs font-semibold text-teal-800">현재</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-zinc-950">{selectedBelt}</p>
          </li>
          <li className="min-w-0 rounded-md bg-white px-2 py-1.5 text-center">
            <p className="text-xs font-semibold text-zinc-500">다음</p>
            <p className="mt-0.5 truncate text-xs text-zinc-700">{nextBelt ?? "단계 유지"}</p>
          </li>
        </ol>
      </div>

      <div
        className="mt-3 grid min-w-0 grid-cols-2 gap-2 rounded-md border border-zinc-200 bg-white p-2"
        data-testid="guardian-learning-action-strip"
      >
        {actions.map((action, index) => {
          const Icon = action.icon;
          const displayValue = action.value.startsWith(action.label)
            ? action.value.slice(action.label.length).trim()
            : action.value;

          return (
            <Fragment key={action.label}>
              {index > 0 ? <span className="sr-only"> </span> : null}
              <Link
                aria-label={action.ariaLabel}
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-md bg-zinc-50 px-2.5 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-teal-50 hover:text-teal-800"
                data-testid="guardian-learning-action-link"
                href={action.href}
              >
                <Icon className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                <span className="min-w-0 truncate">
                  {action.label}
                  {displayValue ? <span className="text-zinc-500"> {displayValue}</span> : null}
                </span>
              </Link>
            </Fragment>
          );
        })}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2" data-testid="guardian-learning-insight-grid">
        {insights.map((insight, index) => {
          const Icon = insight.icon;
          const cellClassName =
            "min-h-20 rounded-md bg-zinc-50 p-2.5 text-left transition hover:bg-teal-50/60";
          const content = (
            <>
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${guardianLearningToneClasses[insight.tone]}`}>
                  <Icon className="h-3 w-3" aria-hidden />
                </span>
                <p className="min-w-0 truncate text-xs font-semibold leading-4 text-zinc-500">{insight.eyebrow}</p>
              </div>
              <p className="mt-1 truncate text-sm font-semibold leading-5 text-zinc-950">{insight.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-zinc-600">{insight.detail}</p>
              <p className="mt-1 text-xs font-semibold text-teal-700">{insight.value}</p>
            </>
          );
          const node = insight.actionHref && insight.actionLabel ? (
            <Link
              aria-label={`${childName} ${insight.eyebrow} ${insight.actionLabel}: ${insight.title}, ${insight.detail}`}
              className={cellClassName}
              data-testid="guardian-learning-insight-cell"
              href={insight.actionHref}
            >
              {content}
            </Link>
          ) : (
            <article
              aria-label={`${childName} ${insight.eyebrow}: ${insight.title}, ${insight.detail}`}
              className={cellClassName}
              data-testid="guardian-learning-insight-cell"
            >
              {content}
            </article>
          );

          return (
            <Fragment key={insight.eyebrow}>
              {index > 0 ? <span className="sr-only"> </span> : null}
              {node}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardScreen() {
  const context = useApiContext();
  const guardianChildren = useMemo(
    () =>
      context.user.role === "guardian"
        ? context.db.members.filter((member) => context.user.childMemberIds?.includes(member.id))
        : [],
    [context.db.members, context.user.childMemberIds, context.user.role],
  );
  const guardianChildIds = useMemo(() => guardianChildren.map((child) => child.id), [guardianChildren]);
  const [selectedChildId, setSelectedChildId] = useGuardianChildSelection(
    context.user.id,
    context.user.role === "guardian" ? guardianChildIds : undefined,
  );
  const [ownerPeriod, setOwnerPeriod] = useState<OwnerPeriod>("today");
  const [showOwnerDashboardDetails, setShowOwnerDashboardDetails] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const { data, loading, error, reload } = useResource(
    () => apiClient.getDashboard(context),
    [context.user.id, context.selectedBranchId, context.version],
  );

  const selectedChild = guardianChildren.find((child) => child.id === selectedChildId) ?? guardianChildren[0];

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState description={error ?? "오늘 확인할 내용을 불러오지 못했습니다."} onRetry={reload} />;
  }

  const personalMembers =
    context.user.role === "guardian"
      ? guardianChildren
      : context.user.role === "member"
        ? context.db.members.filter((member) => context.user.memberIds?.includes(member.id))
        : [];
  const selectedPersonalMember = context.user.role === "guardian" ? selectedChild : personalMembers[0];
  const dashboardScopeBranchIds = context.selectedBranchId ? [context.selectedBranchId] : context.user.branchIds;
  const dashboardScopedMembers = context.db.members.filter((member) => dashboardScopeBranchIds.includes(member.branchId));
  const dashboardScopedUsers = context.db.users.filter((user) => user.branchIds.some((branchId) => dashboardScopeBranchIds.includes(branchId)));
  const dashboardPendingInvitationCount = dashboardScopedUsers.filter((user) => user.invitationStatus === "pending").length;
  const dashboardActiveUserCount = dashboardScopedUsers.length - dashboardPendingInvitationCount;
  const dashboardMemberById = new Map(context.db.members.map((member) => [member.id, member]));
  const dashboardTodayAttendanceCount = data.todaysClasses.reduce((sum, session) => sum + session.attendance.length, 0);
  const dashboardTodayEnrolledCount = data.todaysClasses.reduce((sum, session) => sum + session.enrolledMemberIds.length, 0);
  const dashboardTodayMemberIds = new Set(data.todaysClasses.flatMap((session) => session.enrolledMemberIds));
  const coachDashboardFollowUpNotes =
    context.user.role === "coach"
      ? (context.db.counselingNotes ?? [])
          .filter((note) => dashboardTodayMemberIds.has(note.memberId) && note.visibility !== "staff_only")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 3)
          .map((note) => ({
            member: dashboardMemberById.get(note.memberId),
            note,
          }))
          .filter((row) => row.member)
      : [];
  const coachFirstFollowUpMember = coachDashboardFollowUpNotes[0]?.member;
  const dashboardAttendanceGap = Math.max(dashboardTodayEnrolledCount - dashboardTodayAttendanceCount, 0);
  const dashboardAttendanceRate = rateLabel(dashboardTodayAttendanceCount, dashboardTodayEnrolledCount);
  const dashboardUnreadNoticeCount = data.notices.filter((notice) => !isNoticeReadByUser(notice, context.user.id)).length;
  const dashboardOperatingIssueCount = dashboardAttendanceGap + data.expiringPayments.length;
  const dashboardActiveMemberCount = dashboardScopedMembers.filter((member) => member.status === "active").length;
  const dashboardPrimaryIssue =
    dashboardAttendanceGap > 0
        ? {
          href: "/app/classes",
          label: "미처리 출석 닫기",
          helper: `출석 ${dashboardAttendanceGap}명 · 결제 ${data.expiringPayments.length}`,
        }
      : data.expiringPayments.length > 0
          ? {
              href: "/app/payments?filter=risk",
              label: "결제 상태 확인",
              helper: `결제 ${data.expiringPayments.length}건 · 출석 ${dashboardAttendanceGap}`,
            }
          : {
              href: "/app/dashboard",
              label: "오늘 상태 유지",
              helper: "출석·결제 우선 이슈 없음",
            };
  const adminPendingInvitationKpi = {
    actionHref: "/app/admin/users",
    actionLabel: dashboardPendingInvitationCount > 0 ? "초대 승인" : "사용자 보기",
    badge: dashboardPendingInvitationCount > 0 ? "대기" : undefined,
    helper: `활성 사용자 ${dashboardActiveUserCount}명 · 대기 초대 ${dashboardPendingInvitationCount}건`,
    label: "대기 초대",
    tone: dashboardPendingInvitationCount > 0 ? "warning" : "neutral",
    value: String(dashboardPendingInvitationCount),
  } as const;
  const adminOperationalKpiBase = [
    {
      actionHref: dashboardPrimaryIssue.href,
      actionLabel: dashboardPrimaryIssue.label,
      badge: dashboardOperatingIssueCount > 0 ? "먼저" : "정상",
      helper: dashboardPrimaryIssue.helper,
      label: "운영 이슈",
      tone: dashboardOperatingIssueCount > 0 ? "critical" : "good",
      value: String(dashboardOperatingIssueCount),
    },
    {
      actionHref: "/app/classes",
      actionLabel: dashboardAttendanceGap > 0 ? "미처리 확인" : "출석 보기",
      badge: dashboardAttendanceGap > 0 ? "확인" : "정상",
      helper:
        dashboardTodayEnrolledCount > 0
          ? `${dashboardTodayAttendanceCount}/${dashboardTodayEnrolledCount}명 처리 · 남은 ${dashboardAttendanceGap}명`
          : "오늘 명단 없음",
      label: "출석 처리율",
      tone: dashboardAttendanceGap > 0 ? "warning" : "good",
      value: dashboardAttendanceRate,
    },
    {
      actionHref: "/app/classes",
      actionLabel: "수업 확인",
      badge: "오늘",
      helper: `${data.todaysClasses.length}개 수업 · ${dashboardTodayEnrolledCount}명 명단`,
      label: "오늘 수업",
      tone: "neutral",
      value: String(data.todaysClasses.length),
    },
    {
      actionHref: coachFirstFollowUpMember
        ? `/app/members?memberId=${encodeURIComponent(coachFirstFollowUpMember.id)}&q=${encodeURIComponent(coachFirstFollowUpMember.name)}`
        : "/app/members",
      actionLabel: "회원 보기",
      badge: dashboardActiveMemberCount > 0 ? "활성" : undefined,
      helper: `활성 ${dashboardActiveMemberCount}명 · 전체 ${dashboardScopedMembers.length}명`,
      label: "활성 회원",
      tone: dashboardActiveMemberCount > 0 ? "good" : "neutral",
      value: String(dashboardActiveMemberCount),
    },
    {
      actionHref: "/app/notices",
      actionLabel: dashboardUnreadNoticeCount > 0 ? "미확인 공지" : "공지 보기",
      badge: undefined,
      helper: `${data.notices.length}건 중 미확인 ${dashboardUnreadNoticeCount}건`,
      label: "공지 확인",
      tone: dashboardUnreadNoticeCount > 0 ? "info" : "neutral",
      value: String(dashboardUnreadNoticeCount),
    },
  ] as const;
  const adminOperationalKpis =
    dashboardPendingInvitationCount > 0
      ? [adminOperationalKpiBase[0], adminPendingInvitationKpi, ...adminOperationalKpiBase.slice(1)]
      : [...adminOperationalKpiBase, adminPendingInvitationKpi];
  const coachFirstClass = data.todaysClasses[0];
  const coachDashboardFlowRows = [
    {
      actionHref: "/app/classes",
      helper: coachFirstClass
        ? `${coachFirstClass.name} · ${formatCompactTimeRange(coachFirstClass.startsAt, coachFirstClass.endsAt)}`
        : "오늘 배정 수업 없음",
      icon: CalendarCheck,
      label: "오늘 수업",
      progress: data.todaysClasses.length > 0 ? 100 : 0,
      status: `${dashboardTodayEnrolledCount}명 명단`,
      tone: "teal",
      value: String(data.todaysClasses.length),
    },
    {
      actionHref: "/app/classes",
      helper:
        dashboardTodayEnrolledCount > 0
          ? `${dashboardTodayAttendanceCount}/${dashboardTodayEnrolledCount}명 처리`
          : "오늘 처리할 출석 없음",
      icon: BarChart3,
      label: "출석 처리율",
      progress: percentValue(dashboardTodayAttendanceCount, dashboardTodayEnrolledCount),
      status: dashboardAttendanceGap > 0 ? `남은 ${dashboardAttendanceGap}명` : "완료",
      tone: dashboardAttendanceGap > 0 ? "amber" : "teal",
      value: dashboardAttendanceRate,
    },
    {
      actionHref: "/app/members",
      helper: coachDashboardFollowUpNotes.length > 0 ? "오늘 명단 메모 확인" : "확인할 메모 없음",
      icon: MessageSquareText,
      label: "상담/주의",
      progress: Math.min(100, coachDashboardFollowUpNotes.length * 34),
      status: coachDashboardFollowUpNotes.length > 0 ? "메모" : "없음",
      tone: coachDashboardFollowUpNotes.length > 0 ? "violet" : "blue",
      value: `${coachDashboardFollowUpNotes.length}건`,
    },
  ] as const;
  const personalMemberIds = new Set(
    context.user.role === "guardian" && selectedPersonalMember
      ? [selectedPersonalMember.id]
      : personalMembers.map((member) => member.id),
  );
  const personalClasses = context.db.classes.filter((session) =>
    session.enrolledMemberIds.some((memberId) => personalMemberIds.has(memberId)),
  );
  const personalTodayClasses = data.todaysClasses.filter((session) =>
    session.enrolledMemberIds.some((memberId) => personalMemberIds.has(memberId)),
  );
  const personalAttendanceRecords = context.db.attendance.filter((record) => personalMemberIds.has(record.memberId));
  const personalPayments = context.db.payments.filter((payment) => personalMemberIds.has(payment.memberId));
  const personalPrimaryPayment =
    selectedPersonalMember
      ? getCurrentMemberPayment(personalPayments.filter((payment) => payment.memberId === selectedPersonalMember.id))
      : getCurrentMemberPayment(personalPayments);
  const personalPaymentCheckoutAccess =
    selectedPersonalMember && personalPrimaryPayment
      ? getFamilyPaymentCheckoutAccess(context.user, personalPrimaryPayment, selectedPersonalMember)
      : null;
  const personalPaymentActionHref =
    personalPaymentCheckoutAccess?.canOpen && personalPrimaryPayment
      ? `/app/payments/checkout?paymentId=${encodeURIComponent(personalPrimaryPayment.id)}`
      : "/app/payments";
  const personalPaymentActionStatus =
    personalPaymentCheckoutAccess?.label ?? (personalPrimaryPayment ? paymentStatusLabels[personalPrimaryPayment.status] : "결제 정보 없음");
  const personalPaymentPlanLine =
    personalPrimaryPayment && selectedPersonalMember
      ? getFamilyPaymentPlanLine(personalPrimaryPayment.planName, selectedPersonalMember.ageGroup)
      : null;
  const personalNotices =
    context.user.role === "guardian" && selectedPersonalMember
      ? data.notices.filter((notice) =>
          isNoticeRelevantToMember(notice, selectedPersonalMember.id, context.db.classes),
        )
      : data.notices;
  const personalUnreadNotices = personalNotices.filter((notice) => !isNoticeReadByUser(notice, context.user.id));
  const personalNoticeStatus = personalUnreadNotices.length > 0 ? `${personalUnreadNotices.length}건` : "확인 완료";
  const personalNoticeDetail =
    personalUnreadNotices.length > 0
      ? `미확인 공지 ${personalUnreadNotices.length}건`
      : personalNotices.length > 0
        ? `공지 ${personalNotices.length}건 모두 확인`
        : "도착한 공지 없음";
  const personalPromotion = selectedPersonalMember
    ? [...(context.db.promotions ?? [])]
        .filter((promotion) => promotion.memberId === selectedPersonalMember.id)
        .sort(
          (left, right) =>
            Number(right.result === "scheduled") - Number(left.result === "scheduled") ||
            right.examDate.localeCompare(left.examDate),
        )[0]
    : null;
  const personalUpcomingClasses = [...personalClasses]
    .filter((session) => new Date(session.endsAt).getTime() > currentTime)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const personalUpcomingTodayClasses = [...personalTodayClasses]
    .filter((session) => new Date(session.endsAt).getTime() > currentTime)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const nextPersonalClass =
    personalUpcomingTodayClasses[0] ?? personalUpcomingClasses[0];
  const nextPersonalClassStatus =
    personalUpcomingTodayClasses.length > 0 ? `${personalUpcomingTodayClasses.length}개` : nextPersonalClass ? "예정" : "예정된 수업 없음";
  const personalPanelCards: MobilePriorityCard[] = [
    {
      actionHref: "/app/classes",
      detail: nextPersonalClass
        ? formatMobileClassSchedule(nextPersonalClass.name, nextPersonalClass.startsAt, nextPersonalClass.endsAt)
        : "다가오는 수업이 없습니다.",
      label: "다음 수업",
      status: nextPersonalClassStatus,
    },
    {
      actionHref: "/app/classes",
      detail: `출석 기록 ${personalAttendanceRecords.length}건`,
      label: "출석",
      status: `${personalAttendanceRecords.length}건`,
    },
    {
      actionHref: personalPaymentActionHref,
      detail: personalPrimaryPayment
        ? `${personalPaymentPlanLine ?? personalPrimaryPayment.planName} · ${formatDate(personalPrimaryPayment.expiresAt)} 만료`
        : "등록된 회원권이 없습니다.",
      label: "결제 상태",
      status: personalPaymentActionStatus,
    },
    {
      actionHref: "/app/promotions",
      detail: personalPromotion
        ? `${personalPromotion.fromBelt} → ${personalPromotion.toBelt} · ${formatDate(personalPromotion.examDate)}`
        : "등록된 승급 심사가 없습니다.",
      label: "승급",
      status: personalPromotion ? beltPromotionResultLabels[personalPromotion.result] : "확인",
    },
    {
      actionHref: "/app/notices",
      detail: personalNoticeDetail,
      label: "공지",
      status: personalNoticeStatus,
    },
  ];
  if (context.user.role === "guardian") {
    const selectedChildClasses = selectedChild
      ? context.db.classes.filter((session) => session.enrolledMemberIds.includes(selectedChild.id))
      : [];
    const selectedChildAttendance = selectedChild
      ? context.db.attendance.filter((record) => record.memberId === selectedChild.id)
      : [];
    const selectedChildCoach = selectedChild
      ? context.db.users.find((user) => user.id === selectedChild.primaryCoachId)
      : null;
    const selectedChildPublicNotes = selectedChild
      ? (context.db.counselingNotes ?? [])
          .filter((note) => note.memberId === selectedChild.id && note.visibility === "guardian_visible")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      : [];
    const latestChildFeedback = selectedChildPublicNotes[0];
    const latestChildFeedbackAuthor = latestChildFeedback
      ? context.db.users.find((user) => user.id === latestChildFeedback.authorUserId)
      : null;
    const selectedChildCoachLabel = selectedChildCoach?.name ? `${selectedChildCoach.name} 코치` : "담당 코치";
    const selectedChildVisibleNotices = selectedChild
      ? data.notices.filter((notice) => isNoticeRelevantToMember(notice, selectedChild.id, context.db.classes))
      : [];
    const nextChildClass = [...selectedChildClasses]
      .filter((session) => new Date(session.endsAt).getTime() > currentTime)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0];
    const latestChildAttendance = [...selectedChildAttendance]
      .map((record) => ({
        record,
        session: selectedChildClasses.find((session) => session.id === record.sessionId),
      }))
      .filter((item) => item.session)
      .sort((left, right) => (right.session?.startsAt ?? "").localeCompare(left.session?.startsAt ?? ""))[0];
    const latestChildPromotion = selectedChild
      ? [...(context.db.promotions ?? [])]
          .filter((promotion) => promotion.memberId === selectedChild.id)
          .sort((left, right) =>
            Number(right.result === "scheduled") - Number(left.result === "scheduled") ||
            right.examDate.localeCompare(left.examDate),
          )[0]
      : null;
    const nextTournament = [...(context.db.tournaments ?? [])]
      .filter((tournament) => tournament.eventDate >= new Date().toISOString().slice(0, 10))
      .sort((left, right) => left.eventDate.localeCompare(right.eventDate))[0];
    const selectedChildUnreadNoticeCount = selectedChildVisibleNotices.filter((notice) => !isNoticeReadByUser(notice, context.user.id)).length;
    const guardianLearningInsights: GuardianLearningInsight[] = [];
    if (selectedChild) {
      guardianLearningInsights.push(
        {
          actionHref: "/app/classes",
          actionLabel: "수업 보기",
          detail: nextChildClass
            ? formatMobileClassSchedule(nextChildClass.name, nextChildClass.startsAt, nextChildClass.endsAt)
            : latestChildAttendance?.session
              ? `최근 ${formatDate(latestChildAttendance.session.startsAt)} · ${latestChildAttendance.session.name}`
              : "확인할 수련 일정이 없습니다.",
          eyebrow: "다음 수업",
          icon: CalendarCheck,
          title: nextChildClass?.name ?? "예정된 수업 없음",
          tone: "teal",
          value: nextChildClass ? formatDate(nextChildClass.startsAt) : "일정 확인",
        },
        {
          actionHref: "/app/members",
          actionLabel: "자세히 보기",
          detail: latestChildFeedback
            ? `${latestChildFeedbackAuthor?.name ?? "코치"} · ${formatDate(latestChildFeedback.createdAt)}`
            : `${selectedChildCoachLabel} 수업 후 확인`,
          eyebrow: "코치 피드백",
          icon: MessageSquareText,
          title: latestChildFeedback ? "코치 피드백 도착" : "다음 피드백 예정",
          tone: "blue",
          value: latestChildFeedback ? `최근 ${selectedChildPublicNotes.length}건` : "예정",
        },
      );

      if (latestChildPromotion) {
        guardianLearningInsights.push({
          actionHref: "/app/promotions",
          actionLabel: "심사 보기",
          detail: `${latestChildPromotion.fromBelt} → ${latestChildPromotion.toBelt} · ${formatDate(latestChildPromotion.examDate)}`,
          eyebrow: "심사결과",
          icon: Medal,
          title: "승급 심사 상태",
          tone: "amber",
          value: beltPromotionResultLabels[latestChildPromotion.result],
        });
      }

      if (nextTournament) {
        guardianLearningInsights.push({
          actionHref: "/app/tournaments",
          actionLabel: "대회 보기",
          detail: `${nextTournament.organizer} · ${formatDate(nextTournament.eventDate)}`,
          eyebrow: "대회",
          icon: Trophy,
          title: nextTournament.title,
          tone: "violet",
          value: "일정 있음",
        });
      }
    }
    const guardianLearningActions: GuardianLearningAction[] = selectedChild
      ? [
          {
            ariaLabel: personalPaymentCheckoutAccess?.canOpen
              ? `${selectedChild.name} ${personalPaymentCheckoutAccess.label}`
              : `${selectedChild.name} 결제 상태 보기`,
            href: personalPaymentActionHref,
            icon: CreditCard,
            label: "결제",
            value: personalPaymentCheckoutAccess?.label ?? (personalPrimaryPayment ? paymentStatusLabels[personalPrimaryPayment.status] : "없음"),
          },
          {
            ariaLabel: `${selectedChild.name} 공지 ${selectedChildUnreadNoticeCount}건 확인`,
            href: "/app/notifications",
            icon: Bell,
            label: "공지",
            value: `${selectedChildUnreadNoticeCount}건`,
          },
        ]
      : [];

    return (
      <div>
        <ChildSwitcher
          items={guardianChildren.map((child) => ({
            id: child.id,
            name: child.name,
            ...getChildSwitcherPresentation(child),
          }))}
          selectedChildId={selectedChild?.id ?? null}
          onSelect={setSelectedChildId}
        />

        {!selectedChild ? (
          <EmptyState title="연결된 자녀가 없습니다" />
        ) : (
          <>
            <GuardianLearningSummaryPanel
              actions={guardianLearningActions}
              childName={selectedChild.name}
              insights={guardianLearningInsights}
              selectedBelt={selectedChild.belt}
            />
          </>
        )}
      </div>
    );
  }

  if (context.user.role === "member") {
    return (
      <div>
        {selectedPersonalMember ? <FamilyMobilePriorityPanel cards={personalPanelCards} /> : <EmptyState title="연결된 회원 정보가 없습니다" />}
      </div>
    );
  }

  if (context.user.role === "owner") {
    const period = ownerPeriodOptions.find((option) => option.id === ownerPeriod) ?? ownerPeriodOptions[0];
    const accessibleBranchIds = context.user.branchIds;
    const scopedBranchIds = context.selectedBranchId ? [context.selectedBranchId] : accessibleBranchIds;
    const scopedBranches = context.db.branches.filter((branch) => scopedBranchIds.includes(branch.id));
    const scopedMembers = context.db.members.filter((member) => scopedBranchIds.includes(member.branchId));
    const scopedClasses = context.db.classes.filter(
      (session) => scopedBranchIds.includes(session.branchId) && isInUpcomingPeriod(session.startsAt, period.days),
    );
    const scopedPayments = context.db.payments.filter((payment) => scopedBranchIds.includes(payment.branchId));
    const scopedSessionIds = new Set(scopedClasses.map((session) => session.id));
    const scopedAttendance = context.db.attendance.filter((record) => scopedSessionIds.has(record.sessionId));
    const scopedEnrolledCount = scopedClasses.reduce((sum, session) => sum + session.enrolledMemberIds.length, 0);
    const paymentRisks = scopedPayments.filter((payment) => payment.status === "overdue" || payment.status === "expiringSoon");
    const overduePayments = paymentRisks.filter((payment) => payment.status === "overdue");
    const lowAttendanceClasses = scopedClasses.filter((session) => {
      const done = context.db.attendance.filter((record) => record.sessionId === session.id).length;
      return session.enrolledMemberIds.length > 0 && done < session.enrolledMemberIds.length;
    });
    const memberById = new Map(context.db.members.map((member) => [member.id, member]));
    const branchById = new Map(context.db.branches.map((branch) => [branch.id, branch]));
    const branchRows = scopedBranches.map((branch) => {
      const branchMembers = scopedMembers.filter((member) => member.branchId === branch.id);
      const branchActiveMembers = branchMembers.filter((member) => member.status === "active").length;
      const branchClasses = scopedClasses.filter((session) => session.branchId === branch.id);
      const branchSessionIds = new Set(branchClasses.map((session) => session.id));
      const branchAttendance = scopedAttendance.filter((record) => branchSessionIds.has(record.sessionId));
      const branchEnrolled = branchClasses.reduce((sum, session) => sum + session.enrolledMemberIds.length, 0);
      const branchPayments = scopedPayments.filter((payment) => payment.branchId === branch.id);
      const branchPaymentRisks = branchPayments.filter((payment) => payment.status === "overdue" || payment.status === "expiringSoon");

      return {
        branch,
        activeMembers: branchActiveMembers,
        attendanceGap: Math.max(branchEnrolled - branchAttendance.length, 0),
        classes: branchClasses.length,
        attendanceRate: rateLabel(branchAttendance.length, branchEnrolled),
        memberPercent: percentValue(branchActiveMembers, branchMembers.length),
        riskPayments: branchPaymentRisks.length,
        riskAmount: branchPaymentRisks.reduce((sum, payment) => sum + payment.amount, 0),
        attendancePercent: percentValue(branchAttendance.length, branchEnrolled),
      };
    });
    const branchScopeLabel = context.selectedBranchId
      ? (branchById.get(context.selectedBranchId)?.name ?? "선택 지점")
      : "전체 지점";
    const activeMembersCount = scopedMembers.filter((member) => member.status === "active").length;
    const scopedPaidPayments = scopedPayments.filter((payment) => payment.status === "paid");
    const riskAmount = paymentRisks.reduce((sum, payment) => sum + payment.amount, 0);
    const ownerNoticeRows = context.db.notices.filter((notice) => scopedBranchIds.includes(notice.branchId));
    const ownerUnreadNoticeCount = ownerNoticeRows.filter((notice) => !isNoticeReadByUser(notice, context.user.id)).length;
    const ownerActionCount = lowAttendanceClasses.length;
    const ownerCurrentIssueBranches = branchRows.filter((row) => row.riskPayments > 0);
    const ownerHealthyBranchCount = Math.max(branchRows.length - ownerCurrentIssueBranches.length, 0);
    const ownerReadNoticeCount = Math.max(ownerNoticeRows.length - ownerUnreadNoticeCount, 0);
    const ownerPriorityBranch = [...branchRows].sort((left, right) => right.attendanceGap - left.attendanceGap)[0];
    const ownerPriorityBranchLabel = ownerActionCount > 0 && ownerPriorityBranch ? ownerPriorityBranch.branch.name : branchScopeLabel;
    const ownerActionLabel = period.id === "today" ? "오늘 액션" : period.id === "7d" ? "7일 액션" : "30일 액션";
    const ownerActionButtonLabel = period.id === "today" ? "오늘 순서" : `${period.label} 순서`;
    const ownerNoActionLabel = `${period.label} 우선 액션 없음`;
    const ownerPrioritySignalLabel = period.id === "today" ? "오늘 우선 신호" : `${period.label} 우선 신호`;
    const ownerMaxBranchRiskAmount = Math.max(...branchRows.map((row) => row.riskAmount), 1);
    const ownerBranchComparisonRows = branchRows.map((row) => {
      const riskPercent = row.riskAmount > 0 ? percentValue(row.riskAmount, ownerMaxBranchRiskAmount) : 0;
      const status =
        row.riskPayments > 0
          ? "결제 확인"
          : row.attendanceGap > 0
            ? "출석 마감"
            : "안정";
      const statusClass =
        row.riskPayments > 0
          ? "border-red-200 bg-red-50 text-red-700"
          : row.attendanceGap > 0
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-emerald-200 bg-emerald-50 text-emerald-700";

      return {
        ...row,
        riskPercent,
        status,
        statusClass,
      };
    });
    const riskAlerts = [
      {
        id: "overdue",
        scope: "현재 상태",
        title: `미납 ${overduePayments.length}건`,
        body: overduePayments.length > 0 ? `${formatCurrency(overduePayments.reduce((sum, payment) => sum + payment.amount, 0))} 확인 필요` : "미납 결제 없음",
        tone: overduePayments.length > 0 ? "text-red-700 bg-red-50 border-red-200" : "text-emerald-700 bg-emerald-50 border-emerald-200",
      },
      {
        id: "attendance",
        scope: period.label,
        title: `출석 미처리 수업 ${lowAttendanceClasses.length}개`,
        body: lowAttendanceClasses.length > 0 ? "코치별 출석 확정 상태 확인 필요" : "기간 내 출석 처리 완료",
        tone: lowAttendanceClasses.length > 0 ? "text-amber-700 bg-amber-50 border-amber-200" : "text-emerald-700 bg-emerald-50 border-emerald-200",
      },
    ];
    const ownerOperationalGraphRows = [
      {
        accentClass: ownerActionCount > 0 ? "bg-amber-500" : "bg-zinc-400",
        actionHref: "/app/owner/reports",
        actionLabel: ownerActionCount > 0 ? ownerActionButtonLabel : "리포트",
        guide: ownerActionCount > 0 ? "처리량" : "대기",
        helper: ownerActionCount > 0 ? `${ownerPriorityBranchLabel} · 출석 ${lowAttendanceClasses.length}개 마감 필요` : ownerNoActionLabel,
        id: "actions",
        label: ownerActionLabel,
        progress: ownerActionCount > 0 ? percentValue(ownerActionCount, Math.max(ownerActionCount, 5)) : 0,
        toneClass: ownerActionCount > 0 ? "text-amber-700" : "text-zinc-600",
        value: String(ownerActionCount),
      },
      {
        accentClass: ownerCurrentIssueBranches.length > 0 ? "bg-amber-500" : "bg-emerald-500",
        actionHref: "/app/owner/branches",
        actionLabel: ownerCurrentIssueBranches.length > 0 ? "지점 점검" : "지점 보기",
        guide: ownerCurrentIssueBranches.length > 0 ? "주의" : "안정",
        helper:
          ownerCurrentIssueBranches.length > 0
            ? `현재 결제 위험 ${ownerCurrentIssueBranches.length}곳 확인`
            : `${branchRows.length}개 지점 모두 안정`,
        id: "branches",
        label: "현재 지점 상태",
        progress: percentValue(ownerHealthyBranchCount, branchRows.length),
        toneClass: ownerCurrentIssueBranches.length > 0 ? "text-amber-700" : "text-emerald-700",
        value: `${ownerHealthyBranchCount}/${branchRows.length || 0}`,
      },
      {
        accentClass: paymentRisks.length > 0 ? "bg-red-500" : "bg-emerald-500",
        actionHref: paymentRisks.length > 0 ? "/app/payments?filter=risk" : "/app/payments",
        actionLabel: paymentRisks.length > 0 ? "회수 확인" : "결제 보기",
        guide: paymentRisks.length > 0 ? "위험" : "정상",
        helper: paymentRisks.length > 0 ? `${paymentRisks.length}건 · ${formatCurrency(riskAmount)} 확인` : "위험 결제 없음",
        id: "payments",
        label: "결제 회수",
        progress: percentValue(paymentRisks.length, Math.max(scopedPayments.length, 1)),
        toneClass: paymentRisks.length > 0 ? "text-red-700" : "text-emerald-700",
        value: rateLabel(scopedPaidPayments.length, scopedPayments.length),
      },
      {
        accentClass: lowAttendanceClasses.length > 0 ? "bg-amber-500" : "bg-teal-500",
        actionHref: "/app/classes",
        actionLabel: lowAttendanceClasses.length > 0 ? "출석 마감" : "출석 보기",
        guide: lowAttendanceClasses.length > 0 ? "미처리" : "정상",
        helper: lowAttendanceClasses.length > 0 ? `${period.label} 수업 명단 확인` : `${period.label} 출석 마감 안정`,
        id: "attendance",
        label: "출석 추세",
        progress: percentValue(scopedAttendance.length, scopedEnrolledCount),
        toneClass: lowAttendanceClasses.length > 0 ? "text-amber-700" : "text-teal-700",
        value: rateLabel(scopedAttendance.length, scopedEnrolledCount),
      },
      {
        accentClass: activeMembersCount > 0 ? "bg-emerald-500" : "bg-zinc-400",
        actionHref: "/app/members",
        actionLabel: "회원 확인",
        guide: "활성",
        helper: `${branchScopeLabel} 활성 ${activeMembersCount}명 · 전체 ${scopedMembers.length}명`,
        id: "members",
        label: "회원 유지",
        progress: percentValue(activeMembersCount, scopedMembers.length),
        toneClass: activeMembersCount > 0 ? "text-emerald-700" : "text-zinc-600",
        value: String(activeMembersCount),
      },
      {
        accentClass: ownerUnreadNoticeCount > 0 ? "bg-blue-500" : "bg-zinc-400",
        actionHref: "/app/notices",
        actionLabel: ownerUnreadNoticeCount > 0 ? "공지 확인" : "공지 보기",
        guide: ownerUnreadNoticeCount > 0 ? "미확인" : "도달",
        helper: `${ownerNoticeRows.length}건 중 미확인 ${ownerUnreadNoticeCount}건`,
        id: "notices",
        label: "공지 도달",
        progress: percentValue(ownerReadNoticeCount, ownerNoticeRows.length),
        toneClass: ownerUnreadNoticeCount > 0 ? "text-blue-700" : "text-zinc-600",
        value: String(ownerReadNoticeCount),
      },
    ] as const;
    const ownerPrimaryGraphRow = ownerOperationalGraphRows[0];
    const ownerPeriodAttendanceRow = ownerOperationalGraphRows.find((row) => row.id === "attendance");
    const ownerCurrentGraphRows = ownerOperationalGraphRows.filter((row) =>
      ["branches", "payments", "members", "notices"].includes(row.id),
    );
    const ownerPrimaryGraphSummary =
      ownerActionCount > 0 ? `${ownerPriorityBranchLabel} 우선 점검 ${ownerActionCount}건` : ownerNoActionLabel;
    const ownerVisibleBranchComparisonRows = showOwnerDashboardDetails ? ownerBranchComparisonRows : ownerBranchComparisonRows.slice(0, 1);
    const ownerHiddenBranchComparisonCount = Math.max(ownerBranchComparisonRows.length - ownerVisibleBranchComparisonRows.length, 0);
    const ownerDashboardDetailToggleLabel = showOwnerDashboardDetails
      ? "상세 접기"
      : ownerHiddenBranchComparisonCount > 0
        ? `상세 ${ownerHiddenBranchComparisonCount}곳 더 보기`
        : "상세 열기";
    const OwnerDashboardDetailIcon = showOwnerDashboardDetails ? ChevronUp : ChevronDown;

    return (
      <div>
        <SectionHeader
          title="대표 운영 대시보드"
          action={
            <div
              className="inline-flex rounded-md border border-zinc-200 bg-white p-1"
              aria-label="수업·출석 조회 기간"
              data-testid="owner-dashboard-period-filter"
            >
              {ownerPeriodOptions.map((option) => (
                <button
                  className={`min-h-11 rounded px-3 text-sm font-semibold transition ${
                    ownerPeriod === option.id ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                  data-testid="owner-dashboard-period-option"
                  key={option.id}
                  type="button"
                  aria-pressed={ownerPeriod === option.id}
                  onClick={() => setOwnerPeriod(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />

        <section
          className="rounded-lg border border-zinc-200 bg-white p-2"
          aria-label="대표 운영 KPI 그래프"
          data-testid="owner-dashboard-graph-board"
        >
          <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2" data-testid="owner-dashboard-period-scope">
            <p className="text-xs font-semibold text-zinc-700">선택 기간 · {period.label}</p>
            <p className="text-xs text-zinc-500">수업·출석에 적용</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-1.5">
            <Link
              aria-label={ownerPrimaryGraphRow.actionLabel}
              className="group flex min-h-14 min-w-0 flex-col justify-center rounded-md bg-zinc-50 px-2 py-1.5 transition hover:bg-zinc-100"
              href={ownerPrimaryGraphRow.actionHref}
            >
              <div className="flex min-w-0 items-center justify-between gap-1.5">
                <p className="truncate text-xs font-semibold text-zinc-500">{ownerPrioritySignalLabel}</p>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5" aria-hidden />
              </div>
              <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
                <span className={`shrink-0 text-lg font-semibold tabular-nums ${ownerPrimaryGraphRow.toneClass}`}>
                  {ownerPrimaryGraphRow.value}
                </span>
                <span className="min-w-0 truncate text-[11px] leading-4 text-zinc-600">{ownerPrimaryGraphSummary}</span>
              </div>
            </Link>

            {ownerPeriodAttendanceRow ? (
              <Link
                className="group flex min-h-14 min-w-0 flex-col justify-center rounded-md bg-teal-50 px-2 py-1.5 transition hover:bg-teal-100/70"
                data-testid={`owner-dashboard-graph-row-${ownerPeriodAttendanceRow.id}`}
                href={ownerPeriodAttendanceRow.actionHref}
              >
                <div className="flex min-w-0 items-center justify-between gap-1.5">
                  <p className="truncate text-xs font-semibold text-teal-800">{period.label} 출석</p>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-teal-800">{ownerPeriodAttendanceRow.value}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-teal-700">{ownerPeriodAttendanceRow.helper}</p>
              </Link>
            ) : null}
          </div>

          <div className="mt-2 border-t border-zinc-200 pt-2" data-testid="owner-dashboard-current-scope">
            <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
              <p className="text-xs font-semibold text-zinc-700">현재 상태</p>
              <p className="text-xs text-zinc-500">기간 필터 미적용</p>
            </div>
            <div className="grid min-w-0 grid-cols-4 gap-1" data-testid="owner-dashboard-secondary-graph-grid">
              {ownerCurrentGraphRows.map((row) => (
                <Link
                  className="group block min-h-12 min-w-0 rounded-md bg-zinc-50 px-1.5 py-1 transition hover:bg-zinc-100"
                  data-testid={`owner-dashboard-graph-row-${row.id}`}
                  href={row.actionHref}
                  key={row.id}
                >
                  <p className="truncate text-[11px] font-semibold leading-4 text-zinc-600" data-testid="owner-dashboard-graph-label">
                    {row.label}
                  </p>
                  <div className="mt-0.5 flex min-w-0 items-center justify-between gap-1">
                    <span className="min-w-0 truncate text-xs font-semibold tabular-nums text-zinc-950">{row.value}</span>
                    <span className={`shrink-0 text-[10px] font-semibold ${row.toneClass}`}>{row.guide}</span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white" aria-hidden>
                    <div className={`h-full rounded-full ${row.accentClass}`} style={{ width: `${row.progress}%` }} />
                  </div>
                  <p className="sr-only">{row.helper}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-2 grid gap-2 xl:mt-3 xl:grid-cols-[1.2fr_0.8fr]" data-testid="owner-dashboard-detail-panel">
          <div className="order-1 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2.5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-zinc-950">지점 비교</h2>
                <p className="mt-0.5 text-xs leading-5 text-zinc-500">{period.label} 출석 · 현재 회원/결제</p>
              </div>
              <button
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                data-testid="owner-dashboard-detail-toggle"
                type="button"
                aria-expanded={showOwnerDashboardDetails}
                onClick={() => setShowOwnerDashboardDetails((current) => !current)}
              >
                <span className="whitespace-nowrap">{ownerDashboardDetailToggleLabel}</span>
                <OwnerDashboardDetailIcon className="h-4 w-4 shrink-0" aria-hidden />
              </button>
            </div>
            <div className="divide-y divide-zinc-100" data-testid="owner-dashboard-branch-comparison-graph">
              {ownerVisibleBranchComparisonRows.map((row) => (
                <article className="min-w-0 px-3 py-1.5" data-testid="owner-dashboard-branch-comparison-row" key={row.branch.id}>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-zinc-950">{row.branch.name}</p>
                      <p className="mt-0.5 truncate text-xs leading-4 text-zinc-500">
                        {row.branch.district} · 현재 활성 {row.activeMembers}명 · {period.label} 수업 {row.classes}개
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${row.statusClass}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1" data-testid="owner-dashboard-branch-metric-grid">
                    <div className="min-h-8 min-w-0 rounded-md bg-zinc-50 px-1.5 py-1">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-zinc-500">현재 회원</p>
                        <p className="shrink-0 text-xs font-semibold tabular-nums text-zinc-950">{row.activeMembers}명</p>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white" aria-hidden>
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${row.memberPercent}%` }} />
                      </div>
                    </div>
                    <div className="min-h-8 min-w-0 rounded-md bg-zinc-50 px-1.5 py-1">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-zinc-500">{period.label} 출석</p>
                        <p className="shrink-0 text-xs font-semibold tabular-nums text-zinc-950">{row.attendanceRate}</p>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white" aria-hidden>
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${row.attendancePercent}%` }} />
                      </div>
                    </div>
                    <div className="min-h-8 min-w-0 rounded-md bg-zinc-50 px-1.5 py-1">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-zinc-500">결제 위험</p>
                        <p className="shrink-0 text-xs font-semibold tabular-nums text-zinc-950">{row.riskPayments}건</p>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white" aria-hidden>
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${row.riskPercent}%` }} />
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="order-2 grid gap-2 xl:gap-3">
            <div className="rounded-lg border border-zinc-200 bg-white p-2 xl:p-3" data-testid="owner-dashboard-risk-summary">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-950 xl:text-base">위험 알림</h2>
                </div>
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 xl:h-5 xl:w-5" aria-hidden />
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1 xl:mt-2 xl:gap-1.5">
                {riskAlerts.map((alert) => (
                  <div className={`min-w-0 rounded-md border px-2 py-1 ${alert.tone} xl:py-1.5`} key={alert.id}>
                    <p className="text-xs font-semibold opacity-75">{alert.scope}</p>
                    <p className="break-words text-[11px] font-semibold leading-4 xl:text-xs">{alert.title}</p>
                    <p className="mt-1 hidden text-xs leading-4 sm:block">{alert.body}</p>
                  </div>
                ))}
              </div>
            </div>

            {showOwnerDashboardDetails ? (
              <>
                <div className="rounded-lg border border-zinc-200 bg-white p-3" data-testid="owner-dashboard-branch-detail">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-zinc-950">운영 지점</h2>
                    </div>
                    <Building2 className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {scopedBranches.map((branch) => (
                      <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700" key={branch.id}>
                        {branch.name}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-white p-3" data-testid="owner-dashboard-payment-risk-detail">
                  <h2 className="text-base font-semibold text-zinc-950">결제 위험 회원</h2>
                  {paymentRisks.length === 0 ? (
                    <p className="mt-3 rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-600">위험 결제 항목이 없습니다.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {paymentRisks.slice(0, 4).map((payment) => {
                        const member = memberById.get(payment.memberId);
                        const branch = branchById.get(payment.branchId);

                        return (
                          <div className="rounded-md border border-zinc-200 p-2.5" key={payment.id}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-zinc-950">{member?.name ?? "회원 확인 중"}</p>
                              <PaymentStatusBadge status={payment.status} />
                            </div>
                            <p className="mt-1 text-sm text-zinc-600">
                              {branch?.name ?? "지점 확인 중"} · {payment.planName} · {formatCurrency(payment.amount)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
                        </div>
        </section>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        title="대시보드"
        action={
          <Link
            className="inline-flex h-11 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
            data-testid="admin-dashboard-classes-link"
            href="/app/classes"
          >
            <CalendarCheck className="h-4 w-4" aria-hidden />
            오늘 수업 보기
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="운영 지표">
        {context.user.role === "admin"
          ? adminOperationalKpis.map((card) => (
              <OperationalKpiCard
                actionHref={card.actionHref}
                actionLabel={card.actionLabel}
                ariaLabel={`${card.label}. ${card.value}. ${card.helper}.`}
                badge={card.badge}
                helper={card.helper}
                key={card.label}
                label={card.label}
                testId={`admin-operational-kpi-${card.label}`}
                tone={card.tone}
                value={card.value}
              />
            ))
          : context.user.role === "coach"
            ? <CoachDashboardFlowGraph rows={coachDashboardFlowRows} />
            : data.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div
          className="rounded-lg border border-zinc-200 bg-white p-4"
          data-testid={context.user.role === "coach" ? "coach-dashboard-classes-panel" : undefined}
        >
          <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-950">오늘 수업</h2>
              </div>
            <Link
              className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 hover:text-teal-900"
              data-testid="coach-dashboard-all-classes-link"
              href="/app/classes"
            >
              전체
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {data.todaysClasses.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="오늘 배정된 수업이 없습니다" />
            </div>
          ) : (
            <div className="mt-4 divide-y divide-zinc-100">
              {data.todaysClasses.map((session) => (
                <article className="py-4 first:pt-0 last:pb-0" key={session.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-zinc-950">{session.name}</h3>
                      <p className="mt-1 text-sm text-zinc-600">
                        {formatDate(session.startsAt)} · {formatCompactTimeRange(session.startsAt, session.endsAt)} · {session.room}
                      </p>
                    </div>
                    <span className="inline-flex w-fit rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                      {session.attendance.length}/{session.enrolledMemberIds.length} 처리
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4">
          {context.user.role === "coach" ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-4" data-testid="coach-dashboard-follow-up-panel">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">상담/주의 회원</h2>
                </div>
                <MessageSquareText className="h-5 w-5 text-teal-700" aria-hidden />
              </div>
              {coachDashboardFollowUpNotes.length === 0 ? (
                <p className="mt-4 rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-600">오늘 수업 명단에 확인할 상담/주의 메모가 없습니다.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {coachDashboardFollowUpNotes.map(({ member, note }) => (
                    <Link
                      aria-label={`${member?.name ?? "회원"} 상담·주의 기록 확인`}
                      className="block rounded-md border border-zinc-200 p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
                      href={
                        member
                          ? `/app/members?memberId=${encodeURIComponent(member.id)}&q=${encodeURIComponent(member.name)}`
                          : "/app/members"
                      }
                      key={note.id}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-zinc-950">{member?.name ?? "회원 확인"}</p>
                        <span className="shrink-0 rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700">
                          {coachDashboardNoteTypeLabels[note.noteType] ?? "상담"}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-sm leading-6 text-zinc-600">{compactText(note.body, 64)}</p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">결제 확인</h2>
                </div>
                <CreditCard className="h-5 w-5 text-rose-700" aria-hidden />
              </div>
              {data.expiringPayments.length === 0 ? (
                <p className="mt-4 rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-600">확인할 결제 항목이 없습니다.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {data.expiringPayments.slice(0, 3).map((payment) => (
                    <div className="rounded-md border border-zinc-200 p-3" key={payment.id}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-zinc-950">{payment.member.name}</p>
                        <PaymentStatusBadge status={payment.status} />
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">{payment.planName}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
