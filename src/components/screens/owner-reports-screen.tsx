"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BarChart3, Download, LineChart, TrendingUp } from "lucide-react";
import { useApiContext } from "@/hooks/use-api-context";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { isNoticeReadByUser } from "@/lib/notices";
import { buildOwnerTrendRows, getRecognizedPaymentRevenue } from "@/lib/owner-reporting";
import { isMembershipPayment } from "@/lib/payment-lifecycle";
import { PaymentStatusBadge, SectionHeader } from "@/components/ui/primitives";

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

  return Math.round((done / total) * 100);
}

function signedValue(value: number, suffix = "") {
  if (value === 0) {
    return `0${suffix}`;
  }

  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function signedCurrency(value: number) {
  if (value === 0) {
    return formatCurrency(0);
  }

  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

const ownerReportGraphToneClasses = {
  critical: {
    accent: "bg-red-500",
    guide: "text-red-700",
  },
  good: {
    accent: "bg-emerald-500",
    guide: "text-emerald-700",
  },
  info: {
    accent: "bg-blue-500",
    guide: "text-blue-700",
  },
  neutral: {
    accent: "bg-zinc-500",
    guide: "text-zinc-700",
  },
  warning: {
    accent: "bg-amber-500",
    guide: "text-amber-700",
  },
} as const;

const trendPeriodOptions = [
  { label: "최근 3개월", months: 3 },
  { label: "최근 6개월", months: 6 },
  { label: "최근 12개월", months: 12 },
] as const;

type TrendPeriodMonths = (typeof trendPeriodOptions)[number]["months"];

export function OwnerReportsScreen() {
  const context = useApiContext();
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [trendPeriodMonths, setTrendPeriodMonths] = useState<TrendPeriodMonths>(6);
  const [showAllOwnerActions, setShowAllOwnerActions] = useState(false);
  const [showAllOwnerSecondaryGraphs, setShowAllOwnerSecondaryGraphs] = useState(false);
  const [showAllOwnerBranchGraphs, setShowAllOwnerBranchGraphs] = useState(false);
  const [showAllOwnerPriorityBranches, setShowAllOwnerPriorityBranches] = useState(false);
  const [showAllOwnerTrendGraphRows, setShowAllOwnerTrendGraphRows] = useState(false);
  const [showOwnerRiskPaymentList, setShowOwnerRiskPaymentList] = useState(false);
  const scopedBranchIds = context.selectedBranchId ? [context.selectedBranchId] : context.user.branchIds;
  const branches = context.db.branches.filter((branch) => scopedBranchIds.includes(branch.id));
  const members = context.db.members.filter((member) => scopedBranchIds.includes(member.branchId));
  const classes = context.db.classes.filter((session) => scopedBranchIds.includes(session.branchId));
  const payments = context.db.payments.filter((payment) => scopedBranchIds.includes(payment.branchId));
  const notices = context.db.notices.filter((notice) => scopedBranchIds.includes(notice.branchId));
  const sessionIds = new Set(classes.map((session) => session.id));
  const attendance = context.db.attendance.filter((record) => sessionIds.has(record.sessionId));
  const enrolledCount = classes.reduce((sum, session) => sum + session.enrolledMemberIds.length, 0);
  const riskPayments = payments.filter(
    (payment) => isMembershipPayment(payment) && (payment.status === "overdue" || payment.status === "expiringSoon"),
  );
  const trendRows = buildOwnerTrendRows(context.db, scopedBranchIds, trendPeriodMonths);
  const latestTrend = trendRows.at(-1);
  const previousTrend = trendRows.at(-2);
  const revenueDelta = latestTrend && previousTrend ? latestTrend.paidRevenue - previousTrend.paidRevenue : 0;
  const attendanceDelta = latestTrend && previousTrend ? latestTrend.attendanceRatePercent - previousTrend.attendanceRatePercent : 0;
  const riskDelta = latestTrend && previousTrend ? latestTrend.paymentRiskCount - previousTrend.paymentRiskCount : 0;
  const ownerReportActiveTrendRows = trendRows.filter(
    (row) =>
      row.paidRevenue > 0 ||
      row.paymentRiskCount > 0,
  );
  const ownerReportTrendGraphBaseRows = (ownerReportActiveTrendRows.length > 0 ? ownerReportActiveTrendRows : trendRows.slice(-1)).slice(-6);
  const maxTrendRevenue = Math.max(...ownerReportTrendGraphBaseRows.map((row) => row.paidRevenue), 1);
  const maxTrendActivity = Math.max(
    ...ownerReportTrendGraphBaseRows.map((row) => row.attendanceRecords + row.newMembers + row.withdrawnMembers + row.memberChangeEvents),
    1,
  );
  const maxTrendRiskSignal = Math.max(...ownerReportTrendGraphBaseRows.map((row) => row.paymentRiskCount), 1);
  const ownerReportTrendSummaryRows = [
    {
      delta: `전 기간 대비 ${signedCurrency(revenueDelta)}`,
      label: "매출",
      percent: Math.max(((latestTrend?.paidRevenue ?? 0) / maxTrendRevenue) * 100, latestTrend?.paidRevenue ? 8 : 0),
      tone: "bg-teal-600",
      value: formatCurrency(latestTrend?.paidRevenue ?? 0),
    },
    {
      delta: `전 기간 대비 ${signedValue(attendanceDelta, "%p")}`,
      label: "출석",
      percent: latestTrend?.attendanceRatePercent ?? 0,
      tone: "bg-blue-500",
      value: `${latestTrend?.attendanceRatePercent ?? 0}%`,
    },
    {
      delta: `전 기간 대비 ${signedValue(riskDelta, "건")}`,
      label: "위험",
      percent: Math.max(
        ((latestTrend?.paymentRiskCount ?? 0) / maxTrendRiskSignal) * 100,
        latestTrend?.paymentRiskCount ? 8 : 0,
      ),
      tone: "bg-red-500",
      value: `${latestTrend?.paymentRiskCount ?? 0}건`,
    },
    {
      delta: `신규 ${latestTrend?.newMembers ?? 0} · 이탈 ${latestTrend?.withdrawnMembers ?? 0}`,
      label: "순증",
      percent: Math.max(8, Math.min(100, 50 + (latestTrend?.netMemberChange ?? 0) * 15)),
      tone: (latestTrend?.netMemberChange ?? 0) < 0 ? "bg-amber-500" : "bg-emerald-500",
      value: signedValue(latestTrend?.netMemberChange ?? 0, "명"),
    },
  ];
  const ownerReportTrendGraphRows = ownerReportTrendGraphBaseRows.map((row) => {
    const activitySignal = row.attendanceRecords + row.newMembers + row.withdrawnMembers + row.memberChangeEvents;
    const riskSignal = row.paymentRiskCount;

    return {
      ...row,
      activityPercent: Math.max((activitySignal / maxTrendActivity) * 100, activitySignal > 0 ? 4 : 0),
      activitySignal,
      revenuePercent: Math.max((row.paidRevenue / maxTrendRevenue) * 100, row.paidRevenue > 0 ? 4 : 0),
      riskPercent: Math.max((riskSignal / maxTrendRiskSignal) * 100, riskSignal > 0 ? 4 : 0),
      riskSignal,
    };
  });
  const ownerReportVisibleTrendGraphRows = showAllOwnerTrendGraphRows ? ownerReportTrendGraphRows : ownerReportTrendGraphRows.slice(-2);
  const ownerReportHiddenTrendGraphCount = Math.max(ownerReportTrendGraphRows.length - 2, 0);
  const branchRows = branches.map((branch) => {
    const branchMembers = members.filter((member) => member.branchId === branch.id);
    const branchClasses = classes.filter((session) => session.branchId === branch.id);
    const branchSessionIds = new Set(branchClasses.map((session) => session.id));
    const branchAttendance = attendance.filter((record) => branchSessionIds.has(record.sessionId));
    const branchEnrolledCount = branchClasses.reduce((sum, session) => sum + session.enrolledMemberIds.length, 0);
    const branchPayments = payments.filter((payment) => payment.branchId === branch.id);
    const branchPaymentRisks = branchPayments.filter(
      (payment) => isMembershipPayment(payment) && (payment.status === "overdue" || payment.status === "expiringSoon"),
    );
    const attendanceGap = Math.max(branchEnrolledCount - branchAttendance.length, 0);
    const pausedMembers = branchMembers.filter((member) => member.status === "paused").length;
    const branchTrendRows = buildOwnerTrendRows(context.db, [branch.id], trendPeriodMonths);
    const branchLatestTrend = branchTrendRows.at(-1);
    const branchPreviousTrend = branchTrendRows.at(-2);
    const branchRevenueDelta = branchLatestTrend && branchPreviousTrend ? branchLatestTrend.paidRevenue - branchPreviousTrend.paidRevenue : 0;
    const branchAttendanceDelta =
      branchLatestTrend && branchPreviousTrend ? branchLatestTrend.attendanceRatePercent - branchPreviousTrend.attendanceRatePercent : 0;
    const branchPaymentRiskDelta =
      branchLatestTrend && branchPreviousTrend ? branchLatestTrend.paymentRiskCount - branchPreviousTrend.paymentRiskCount : 0;
    const branchMemberDelta = branchLatestTrend?.netMemberChange ?? 0;
    const decisionScore =
      attendanceGap +
      branchPaymentRisks.length * 3 +
      pausedMembers +
      Math.max(branchPaymentRiskDelta, 0) * 2 +
      Math.max(-branchAttendanceDelta, 0) +
      Math.max(-branchMemberDelta, 0) * 2;

    return {
      branch,
      activeMembers: branchMembers.filter((member) => member.status === "active").length,
      attendanceDelta: branchAttendanceDelta,
      attendanceGap,
      attendancePercent: percentValue(branchAttendance.length, branchEnrolledCount),
      attendanceRate: rateLabel(branchAttendance.length, branchEnrolledCount),
      classes: branchClasses.length,
      decisionScore,
      memberDelta: branchMemberDelta,
      pausedMembers,
      paymentRiskDelta: branchPaymentRiskDelta,
      riskPayments: branchPaymentRisks.length,
      riskScore: attendanceGap + branchPaymentRisks.length * 3 + pausedMembers,
      riskAmount: branchPaymentRisks.reduce((sum, payment) => sum + payment.amount, 0),
      revenue: branchPayments.reduce((sum, payment) => sum + getRecognizedPaymentRevenue(payment), 0),
      revenueDelta: branchRevenueDelta,
    };
  });
  const maxBranchActiveMembers = Math.max(...branchRows.map((row) => row.activeMembers), 1);
  const maxBranchRevenue = Math.max(...branchRows.map((row) => row.revenue), 1);
  const maxBranchRiskSignal = Math.max(...branchRows.map((row) => row.riskPayments + Math.ceil(row.riskAmount / 100000)), 1);
  const ownerReportBranchGraphRows = [...branchRows].sort((left, right) => right.decisionScore - left.decisionScore || right.riskAmount - left.riskAmount).map((row) => {
    const riskSignal = row.riskPayments + Math.ceil(row.riskAmount / 100000);

    return {
      ...row,
      graphs: [
        {
          label: "회원",
          value: `${row.activeMembers}명`,
          detail: `${signedValue(row.memberDelta, "명")} 흐름`,
          percent: Math.max((row.activeMembers / maxBranchActiveMembers) * 100, row.activeMembers > 0 ? 8 : 0),
          tone: "bg-emerald-500",
        },
        {
          label: "출석",
          value: row.attendanceRate,
          detail: `${signedValue(row.attendanceDelta, "%p")} 변화`,
          percent: row.attendancePercent,
          tone: "bg-blue-500",
        },
        {
          label: "위험",
          value: `${row.riskPayments}건`,
          detail: row.riskAmount > 0 ? formatCurrency(row.riskAmount) : "위험 없음",
          percent: riskSignal > 0 ? Math.max((riskSignal / maxBranchRiskSignal) * 100, 8) : 0,
          tone: row.riskPayments > 0 ? "bg-red-500" : "bg-zinc-300",
        },
        {
          label: "매출",
          value: formatCurrency(row.revenue),
          detail: `${signedCurrency(row.revenueDelta)} 변화`,
          percent: Math.max((row.revenue / maxBranchRevenue) * 100, row.revenue > 0 ? 8 : 0),
          tone: "bg-teal-500",
        },
      ],
    };
  });
  const ownerReportVisibleBranchGraphRows = showAllOwnerBranchGraphs ? ownerReportBranchGraphRows : ownerReportBranchGraphRows.slice(0, 1);
  const ownerReportHiddenBranchGraphCount = Math.max(ownerReportBranchGraphRows.length - 1, 0);
  const priorityRows = [...branchRows].sort((a, b) => b.riskScore - a.riskScore || b.riskAmount - a.riskAmount);
  const p2DecisionRows = [...branchRows].sort((a, b) => b.decisionScore - a.decisionScore || b.riskAmount - a.riskAmount);
  const memberGrowthBranchCount = branchRows.filter((row) => row.memberDelta > 0).length;
  const attendanceDeclineBranchCount = branchRows.filter((row) => row.attendanceDelta < 0).length;
  const actionQueue = priorityRows
    .flatMap((row) => {
      const actions = [];

      if (row.attendanceGap > 0) {
        actions.push({
          branchName: row.branch.name,
          detail: `${row.attendanceGap}명 미처리 · 처리율 ${row.attendanceRate}`,
          id: `${row.branch.id}-attendance`,
          label: "출석 미처리 정리",
          owner: "코치",
          score: row.attendanceGap * 2,
          tone: "amber",
        });
      }

      if (row.riskPayments > 0) {
        actions.push({
          branchName: row.branch.name,
          detail: `${row.riskPayments}건 · ${formatCurrency(row.riskAmount)}`,
          id: `${row.branch.id}-payment`,
          label: "결제 위험 확인",
          owner: "대표/운영",
          score: row.riskPayments * 4 + Math.round(row.riskAmount / 100000),
          tone: "red",
        });
      }

      if (row.pausedMembers > 0) {
        actions.push({
          branchName: row.branch.name,
          detail: `${row.pausedMembers}명 휴면 상태`,
          id: `${row.branch.id}-paused`,
          label: "휴면 회원 케어",
          owner: "대표",
          score: row.pausedMembers,
          tone: "zinc",
        });
      }

      return actions;
    })
    .sort((a, b) => b.score - a.score || a.branchName.localeCompare(b.branchName))
    .slice(0, 5);
  const ownerReportVisibleActionQueue = showAllOwnerActions ? actionQueue : actionQueue.slice(0, 1);
  const ownerReportHiddenActionCount = Math.max(actionQueue.length - 1, 0);
  const ownerReportVisiblePriorityRows = showAllOwnerPriorityBranches ? priorityRows : priorityRows.slice(0, 1);
  const ownerReportHiddenPriorityCount = Math.max(priorityRows.length - 1, 0);
  const healthyBranchCount = branchRows.filter((row) => row.decisionScore === 0).length;
  const urgentBranchCount = branchRows.filter((row) => row.decisionScore >= 8).length;
  const paidPaymentCount = payments.filter(
    (payment) => payment.status === "paid" || payment.status === "partially_refunded",
  ).length;
  const ownerUnreadNoticeCount = notices.filter((notice) => !isNoticeReadByUser(notice, context.user.id)).length;
  const ownerReportFocusRow = p2DecisionRows[0] ?? priorityRows[0];
  const ownerReportFocusBranchName = ownerReportFocusRow?.branch.name ?? "전체 지점";
  const ownerReportKpiCards = [
    {
      actionHref: "/app/owner/reports",
      actionLabel: actionQueue.length > 0 ? "우선순위 보기" : "리포트 보기",
      badge: actionQueue.length > 0 ? "먼저" : "대기",
      helper: actionQueue[0] ? `${actionQueue[0].branchName} · ${actionQueue[0].label}` : "오늘 우선 처리 없음",
      label: "이번 주 액션",
      tone: actionQueue.length > 0 ? "warning" : "neutral",
      value: String(actionQueue.length),
    },
    {
      actionHref: "/app/owner/branches",
      actionLabel: urgentBranchCount > 0 ? "위험 지점 보기" : "지점 비교",
      badge: urgentBranchCount > 0 ? "주의" : "양호",
      helper:
        urgentBranchCount > 0
          ? `${ownerReportFocusBranchName} 포함 즉시 점검 ${urgentBranchCount}곳`
          : `${branchRows.length}개 지점 모두 안정`,
      label: "지점 건강도",
      tone: urgentBranchCount > 0 ? "warning" : "good",
      value: `${healthyBranchCount}/${branchRows.length || 0}`,
    },
    {
      actionHref: "/app/payments",
      actionLabel: riskPayments.length > 0 ? "결제 확인" : "결제 보기",
      badge: riskPayments.length > 0 ? "위험" : "정상",
      helper:
        riskPayments.length > 0
          ? `${riskPayments.length}건 · ${formatCurrency(riskPayments.reduce((sum, payment) => sum + payment.amount, 0))} 확인`
          : "위험 결제 없음",
      label: "결제 회수",
      tone: riskPayments.length > 0 ? "critical" : "good",
      value: rateLabel(paidPaymentCount, payments.length),
    },
    {
      actionHref: "/app/classes",
      actionLabel: attendanceDeclineBranchCount > 0 ? "출석 하락 보기" : "출석 보기",
      badge: attendanceDeclineBranchCount > 0 ? "하락" : "유지",
      helper:
        attendanceDeclineBranchCount > 0
          ? `${ownerReportFocusBranchName} · 변화 ${signedValue(attendanceDelta, "%p")}`
          : `현재 ${rateLabel(attendance.length, enrolledCount)} · 안정`,
      label: "출석 추세",
      tone: attendanceDeclineBranchCount > 0 ? "warning" : "good",
      value: signedValue(attendanceDelta, "%p"),
    },
    {
      actionHref: "/app/members",
      actionLabel: "회원 흐름 보기",
      badge: memberGrowthBranchCount > 0 ? "증가" : undefined,
      helper:
        (latestTrend?.netMemberChange ?? 0) < 0
          ? `${ownerReportFocusBranchName} · 증가 ${memberGrowthBranchCount}곳 · 하락 ${attendanceDeclineBranchCount}곳`
          : `증가 지점 ${memberGrowthBranchCount}곳 · 하락 지점 ${attendanceDeclineBranchCount}곳`,
      label: "회원 유지",
      tone: (latestTrend?.netMemberChange ?? 0) < 0 ? "warning" : "good",
      value: signedValue(latestTrend?.netMemberChange ?? 0, "명"),
    },
    {
      actionHref: "/app/notices",
      actionLabel: ownerUnreadNoticeCount > 0 ? "공지 확인" : "공지 보기",
      badge: undefined,
      helper: `${notices.length}건 중 미확인 ${ownerUnreadNoticeCount}건`,
      label: "공지 도달",
      tone: ownerUnreadNoticeCount > 0 ? "info" : "neutral",
      value: String(Math.max(notices.length - ownerUnreadNoticeCount, 0)),
    },
  ] as const;
  const ownerReportGraphRows = ownerReportKpiCards.map((card) => {
    const progress =
      card.label === "이번 주 액션"
        ? Math.min(100, Math.round((actionQueue.length / 5) * 100))
        : card.label === "지점 건강도"
          ? percentValue(healthyBranchCount, branchRows.length)
          : card.label === "결제 회수"
            ? percentValue(paidPaymentCount, payments.length)
            : card.label === "출석 추세"
              ? percentValue(attendance.length, enrolledCount)
              : card.label === "회원 유지"
                ? Math.max(10, Math.min(100, 55 + (latestTrend?.netMemberChange ?? 0) * 15))
                : percentValue(Math.max(notices.length - ownerUnreadNoticeCount, 0), notices.length);

    return {
      ...card,
      id: card.label.replaceAll(" ", "-"),
      progress,
      toneClass: ownerReportGraphToneClasses[card.tone],
    };
  });
  const ownerReportPrimaryGraphRow = ownerReportGraphRows[0];
  const ownerReportSecondaryGraphRows = ownerReportGraphRows.slice(1);
  const ownerReportVisibleSecondaryGraphRows = showAllOwnerSecondaryGraphs
    ? ownerReportSecondaryGraphRows
    : ownerReportSecondaryGraphRows.slice(0, 3);
  const ownerReportHiddenSecondaryGraphCount = Math.max(ownerReportSecondaryGraphRows.length - 3, 0);
  const ownerReportHiddenSecondaryGraphLabel = ownerReportSecondaryGraphRows
    .slice(3)
    .map((row) => (row.label === "회원 유지" ? "유지" : row.label === "공지 도달" ? "공지" : row.label))
    .join("·");
  const ownerReportPrimaryGraphSummary =
    actionQueue.length > 0 ? `${actionQueue[0]?.branchName ?? ownerReportFocusBranchName} 우선 점검 ${actionQueue.length}건` : "이번 주 우선 처리 없음";
  const ownerReportRiskPaymentTotalAmount = riskPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const ownerReportTopRiskPayment = [...riskPayments].sort(
    (left, right) =>
      (left.status === "overdue" ? 0 : 1) - (right.status === "overdue" ? 0 : 1) ||
      left.dueDate.localeCompare(right.dueDate) ||
      right.amount - left.amount,
  )[0];
  const ownerReportTopRiskMember = ownerReportTopRiskPayment
    ? context.db.members.find((candidate) => candidate.id === ownerReportTopRiskPayment.memberId)
    : undefined;
  async function handleExportPayments() {
    try {
      const csv = await apiClient.exportPaymentsCsv(context.selectedBranchId);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "final-judo-owner-report-payments.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportStatus("결제 내보내기를 완료했습니다.");
    } catch (error) {
      setExportStatus(error instanceof ApiClientError ? error.message : "내보내기에 실패했습니다.");
    }
  }

  async function handleExportOperations() {
    try {
      const csv = await apiClient.exportOperationsCsv(context.selectedBranchId);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "final-judo-owner-report-operations.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportStatus("운영 리포트 내보내기를 완료했습니다.");
    } catch (error) {
      setExportStatus(error instanceof ApiClientError ? error.message : "내보내기에 실패했습니다.");
    }
  }

  return (
    <div>
      <SectionHeader
        title="대표 운영 리포트"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
              type="button"
              onClick={() => void handleExportOperations()}
            >
              <Download className="h-4 w-4" aria-hidden />
              운영 내보내기
            </button>
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100"
              type="button"
              onClick={() => void handleExportPayments()}
            >
              <Download className="h-4 w-4" aria-hidden />
              결제 내보내기
            </button>
          </div>
        }
      />

      {exportStatus ? (
        <p className="mb-4 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900">
          {exportStatus}
        </p>
      ) : null}

      <section
        className="rounded-lg border border-zinc-200 bg-white p-2"
        aria-label="대표 리포트 운영 그래프"
        data-testid="owner-report-graph-board"
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-semibold text-zinc-950">운영 그래프</h2>
          </div>
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700">
            <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          </span>
        </div>

        <div className="mt-1.5 rounded-md bg-zinc-50 px-2 py-0.5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-500">이번 주 우선 신호</p>
              <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4 text-zinc-600">
                <span className="shrink-0 text-lg font-semibold tabular-nums text-zinc-950">{ownerReportPrimaryGraphRow.value}</span>
                <span className="min-w-0 break-words">{ownerReportPrimaryGraphSummary}</span>
              </p>
            </div>
            <Link
              aria-label={ownerReportPrimaryGraphRow.actionLabel}
              className="inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white transition hover:bg-zinc-800"
              href={ownerReportPrimaryGraphRow.actionHref}
            >
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </Link>
          </div>
        </div>

        <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5" data-testid="owner-report-secondary-graph-grid">
          {ownerReportVisibleSecondaryGraphRows.map((row) => {
            const compactLabel =
              row.label === "지점 건강도"
                ? "건강"
                : row.label === "결제 회수"
                  ? "결제"
                  : row.label === "출석 추세"
                    ? "출석"
                    : row.label === "회원 유지"
                      ? "유지"
                      : row.label === "공지 도달"
                        ? "공지"
                        : row.label;

            return (
              <Link
                aria-label={`${row.label}: ${row.value}`}
                className="group block min-h-11 min-w-0 rounded-md bg-zinc-50 px-2 py-1.5 transition hover:bg-zinc-100"
                data-owner-report-graph-id={row.id}
                data-owner-report-graph-row={`owner-report-graph-row-${row.id}`}
                data-testid="owner-report-secondary-graph-tile"
                href={row.actionHref}
                key={row.label}
              >
                <div className="flex min-w-0 items-center justify-between gap-1">
                  <p className="min-w-0 truncate text-xs font-semibold leading-4 text-zinc-600" data-testid="owner-report-secondary-graph-label">
                    {compactLabel}
                  </p>
                  {row.badge ? <span className={`shrink-0 text-[10px] font-semibold ${row.toneClass.guide}`}>{row.badge}</span> : null}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center justify-between gap-1">
                  <span className="min-w-0 truncate text-sm font-semibold tabular-nums text-zinc-950">{row.value}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-700" aria-hidden />
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white" aria-hidden>
                  <div className={`h-full rounded-full ${row.toneClass.accent}`} style={{ width: `${row.progress}%` }} />
                </div>
              </Link>
            );
          })}
          {ownerReportHiddenSecondaryGraphCount > 0 ? (
            <button
              aria-label={showAllOwnerSecondaryGraphs ? "보조 운영 지표 접기" : `${ownerReportHiddenSecondaryGraphLabel || "보조 운영 지표"} 보기`}
              aria-expanded={showAllOwnerSecondaryGraphs}
              className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-center text-xs font-semibold leading-4 text-zinc-700 transition hover:bg-zinc-50"
              data-testid="owner-report-secondary-graph-toggle"
              onClick={() => setShowAllOwnerSecondaryGraphs((current) => !current)}
              type="button"
            >
              {showAllOwnerSecondaryGraphs ? "접기" : ownerReportHiddenSecondaryGraphLabel}
            </button>
          ) : null}
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-zinc-200 bg-white p-3" aria-labelledby="owner-trend-heading">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-2">
            <LineChart className="h-5 w-5 text-teal-700" aria-hidden />
            <div>
              <h2 id="owner-trend-heading" className="text-base font-semibold text-zinc-950">
                기간별 운영 추세
              </h2>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2 text-xs font-semibold" aria-label="대표 리포트 기간 필터">
              {trendPeriodOptions.map((option) => {
                const isSelected = trendPeriodMonths === option.months;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={`min-h-11 rounded-md border px-3 text-xs font-semibold transition ${
                      isSelected
                        ? "border-teal-300 bg-teal-50 text-teal-800"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                    }`}
                    key={option.months}
                    type="button"
                    onClick={() => setTrendPeriodMonths(option.months)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-teal-700">
                최근 {latestTrend?.label ?? "-"}
              </span>
            </div>
          </div>
        </div>

        <div
          className="mt-3 grid gap-1 rounded-md border border-zinc-200 bg-zinc-50/70 px-2 py-1.5"
          data-testid="owner-report-trend-summary-grid"
        >
          {ownerReportTrendSummaryRows.map((row) => (
            <article
              aria-label={`${row.label} ${row.value}, ${row.delta}`}
              className="grid min-h-5 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2"
              data-testid="owner-report-trend-summary-row"
              key={row.label}
            >
              <span className="text-[11px] font-semibold leading-4 text-zinc-500">{row.label}</span>
              <span className="min-w-0">
                <span className="block h-1.5 overflow-hidden rounded-full bg-white" aria-hidden>
                  <span className={`block h-full rounded-full ${row.tone}`} style={{ width: `${row.percent}%` }} />
                </span>
                <span className="sr-only">{row.delta}</span>
              </span>
              <span className="text-xs font-semibold tabular-nums text-zinc-950">{row.value}</span>
            </article>
          ))}
        </div>

        <div
          className="mt-3 rounded-md border border-zinc-200 bg-zinc-50/40 p-2.5 md:hidden"
          data-testid="owner-report-trend-graph"
        >
          <div className="space-y-2">
            {ownerReportVisibleTrendGraphRows.map((row) => (
              <article
                className="rounded-md border border-zinc-200 bg-white p-2"
                data-testid="owner-report-trend-graph-row"
                key={row.key}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-950">{row.label}</p>
                    <p className="mt-1 text-xs text-zinc-500">출석 {row.attendanceRatePercent}% · 순증 {signedValue(row.netMemberChange, "명")}</p>
                  </div>
                  <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-950">{formatCurrency(row.paidRevenue)}</span>
                </div>
                <div className="mt-2 grid gap-1.5">
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span className="text-zinc-500">매출</span>
                      <span className="tabular-nums text-zinc-950">{formatCurrency(row.paidRevenue)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
                      <div className="h-full rounded-full bg-teal-600" style={{ width: `${row.revenuePercent}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span className="text-zinc-500">운영량</span>
                      <span className="tabular-nums text-zinc-950">{row.activitySignal}건</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${row.activityPercent}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span className="text-zinc-500">위험</span>
                      <span className="tabular-nums text-zinc-950">{row.riskSignal}건</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
                      <div className="h-full rounded-full bg-red-500" style={{ width: `${row.riskPercent}%` }} />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {ownerReportHiddenTrendGraphCount > 0 ? (
            <button
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              data-testid="owner-report-trend-graph-toggle"
              type="button"
              onClick={() => setShowAllOwnerTrendGraphRows((current) => !current)}
            >
              {showAllOwnerTrendGraphRows ? "추세 접기" : `추세 ${ownerReportHiddenTrendGraphCount}개 더 보기`}
            </button>
          ) : null}
        </div>

        <div className="mt-4 hidden overflow-hidden rounded-md border border-zinc-200 md:block">
          <div className="hidden grid-cols-[0.7fr_1fr_0.75fr_0.75fr_0.75fr] border-b border-zinc-200 bg-zinc-50 px-3 py-3 text-xs font-semibold text-zinc-500 md:grid">
            <span>기간</span>
            <span>확정 매출</span>
            <span>출석률</span>
            <span>위험</span>
            <span>회원 순증</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {trendRows.map((row) => {
              const activityWidth = Math.max(
                ((row.attendanceRecords + row.newMembers + row.withdrawnMembers + row.memberChangeEvents) / maxTrendActivity) * 100,
                4,
              );
              const revenueWidth = Math.max((row.paidRevenue / maxTrendRevenue) * 100, row.paidRevenue > 0 ? 4 : 0);

              return (
                <article className="grid gap-3 px-3 py-3 md:grid-cols-[0.7fr_1fr_0.75fr_0.75fr_0.75fr] md:items-center" key={row.key}>
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">{row.label}</p>
                    <p className="mt-1 text-xs text-zinc-500">수업 {row.classes} · 슬롯 {row.enrolledSlots}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums text-zinc-950">{formatCurrency(row.paidRevenue)}</p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
                      <div className="h-full rounded-full bg-teal-600" style={{ width: `${revenueWidth}%` }} />
                    </div>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-zinc-950">
                    {row.attendanceRatePercent}%
                    <span className="mt-1 block text-xs font-medium text-zinc-500">{row.attendanceRecords}건</span>
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-zinc-950">{row.paymentRiskCount}건</p>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums text-zinc-950">{signedValue(row.netMemberChange, "명")}</p>
                    <p className="mt-1 text-xs font-medium text-zinc-500">
                      신규 {row.newMembers} · 이탈 {row.withdrawnMembers} · 변경 {row.memberChangeEvents}
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${activityWidth}%` }} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-3 grid gap-2 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-2.5 py-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950">지점별 운영 그래프</h2>
            </div>
            <BarChart3 className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
          </div>
          <div className="divide-y divide-zinc-100">
            {ownerReportVisibleBranchGraphRows.map((row) => (
              <article className="grid gap-0.5 px-2 py-1 md:grid-cols-[0.7fr_1.3fr] md:items-start" data-testid="owner-report-branch-graph" key={row.branch.id}>
                <div className="flex min-w-0 items-center justify-between gap-1.5 md:block">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-zinc-950">
                      {row.branch.name}
                      <span className="ml-1 text-xs font-medium text-zinc-500">{row.branch.district}</span>
                    </p>
                  </div>
                  <p className="shrink-0 rounded-md bg-zinc-50 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600 md:mt-1 md:inline-block">
                    수업 {row.classes}
                  </p>
                </div>
                <div className="grid min-w-0 gap-1">
                  {row.graphs.map((graph) => (
                    <div
                      className="grid min-w-0 grid-cols-[2.25rem_1fr_auto] items-center gap-1 rounded-md bg-zinc-50 px-1.5 py-0.5"
                      data-testid="owner-report-branch-graph-row"
                      key={`${row.branch.id}-${graph.label}`}
                    >
                      <p className="truncate text-[11px] font-semibold text-zinc-600">{graph.label}</p>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white" aria-hidden>
                        <div className={`h-full rounded-full ${graph.tone}`} style={{ width: `${graph.percent}%` }} />
                      </div>
                      <p className="shrink-0 truncate text-[11px] font-semibold tabular-nums text-zinc-950">{graph.value}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {ownerReportHiddenBranchGraphCount > 0 ? (
            <div className="border-t border-zinc-100 px-2 py-1.5">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                data-testid="owner-report-branch-graph-toggle"
                type="button"
                onClick={() => setShowAllOwnerBranchGraphs((current) => !current)}
              >
                {showAllOwnerBranchGraphs ? "지점 그래프 접기" : `지점 그래프 ${ownerReportHiddenBranchGraphCount}곳 더 보기`}
              </button>
            </div>
          ) : null}
        </div>

        <section className="rounded-lg border border-zinc-200 bg-white p-2" data-testid="owner-report-action-rail">
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-zinc-950">오늘 조치</h2>
            <span className="rounded-md bg-zinc-50 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600">3개 영역</span>
          </div>

          <div className="mt-1.5 grid gap-1.5">
            <div className="rounded-md bg-zinc-50 px-2 py-1.5" data-testid="owner-action-queue">
              {actionQueue.length === 0 ? (
                <div className="flex min-h-11 items-center gap-2 text-sm text-zinc-600">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                  <span className="min-w-0 truncate">오늘 먼저 처리할 항목이 없습니다.</span>
                </div>
              ) : (
                <ol className="space-y-1">
                  {ownerReportVisibleActionQueue.map((action, index) => {
                    const toneClass =
                      action.tone === "red"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : action.tone === "amber"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : action.tone === "teal"
                            ? "border-teal-200 bg-teal-50 text-teal-700"
                            : "border-zinc-200 bg-white text-zinc-700";

                    return (
                      <li className="rounded-md bg-white px-2 py-1" data-testid="owner-action-queue-item" key={action.id}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" aria-hidden />
                            <p className="min-w-0 truncate text-sm font-semibold text-zinc-950">
                              {index + 1}. {action.label}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${toneClass}`}>
                            {action.owner}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs font-medium tabular-nums text-zinc-600">
                          {action.branchName} · {action.detail}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
              {ownerReportHiddenActionCount > 0 ? (
                <button
                  className="mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                  data-testid="owner-action-queue-toggle"
                  type="button"
                  onClick={() => setShowAllOwnerActions((current) => !current)}
                >
                  {showAllOwnerActions ? "우선순위 접기" : `우선순위 ${ownerReportHiddenActionCount}건 더 보기`}
                </button>
              ) : null}
            </div>

            <div className="rounded-md bg-zinc-50 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-zinc-500">지점 점검</p>
                <TrendingUp className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              </div>
              <div className="mt-1 grid gap-1" data-testid="owner-report-priority-branch-list">
                {ownerReportVisiblePriorityRows.map((row) => (
                  <div className="rounded-md bg-white px-2 py-1" data-testid="owner-report-priority-branch-row" key={row.branch.id}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-950">{row.branch.name}</p>
                      <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
                        row.riskScore > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}>
                        점검 {row.riskScore}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">
                        출석 {row.attendancePercent}%
                      </span>
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">
                        미처리 {row.attendanceGap}
                      </span>
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">
                        결제 {row.riskPayments}
                      </span>
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">
                        휴면 {row.pausedMembers}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {ownerReportHiddenPriorityCount > 0 ? (
                <button
                  className="mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                  data-testid="owner-report-priority-branch-toggle"
                  type="button"
                  onClick={() => setShowAllOwnerPriorityBranches((current) => !current)}
                >
                  {showAllOwnerPriorityBranches ? "점검 지점 접기" : `점검 지점 ${ownerReportHiddenPriorityCount}곳 더 보기`}
                </button>
              ) : null}
            </div>

            <div className="rounded-md bg-zinc-50 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden />
                <p className="text-xs font-semibold text-zinc-500">결제 위험</p>
              </div>
              {riskPayments.length === 0 ? (
                <p className="mt-1 rounded-md bg-white px-2 py-1.5 text-sm text-zinc-600">위험 결제 항목이 없습니다.</p>
              ) : (
                <>
                  <div className="mt-1 rounded-md bg-white px-2 py-1" data-testid="owner-report-risk-payment-summary">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-zinc-950">{riskPayments.length}건 확인 필요</p>
                        <p className="mt-0.5 break-words text-xs leading-4 text-zinc-600">
                          {ownerReportTopRiskMember?.name ?? "회원 확인 중"} · {formatCurrency(ownerReportRiskPaymentTotalAmount)}
                        </p>
                      </div>
                      {ownerReportTopRiskPayment ? <PaymentStatusBadge status={ownerReportTopRiskPayment.status} /> : null}
                    </div>
                  </div>
                  <button
                    className="mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                    data-testid="owner-report-risk-payment-toggle"
                    type="button"
                    onClick={() => setShowOwnerRiskPaymentList((current) => !current)}
                  >
                    {showOwnerRiskPaymentList ? "목록 접기" : `위험 결제 ${riskPayments.length}건 보기`}
                  </button>
                  {showOwnerRiskPaymentList ? (
                    <div className="mt-1.5 space-y-1" data-testid="owner-report-risk-payment-list">
                      {riskPayments.slice(0, 5).map((payment) => {
                        const member = context.db.members.find((candidate) => candidate.id === payment.memberId);

                        return (
                          <div className="rounded-md border border-zinc-200 px-2 py-1.5" key={payment.id}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-zinc-950">{member?.name ?? "회원 확인 중"}</p>
                              <PaymentStatusBadge status={payment.status} />
                            </div>
                            <p className="mt-0.5 text-xs text-zinc-600">{payment.planName}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
