import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const dashboardSource = readFileSync("src/components/screens/dashboard-screen.tsx", "utf8");
const p5ReadinessSource = readFileSync("scripts/check-p5-p10-internal-readiness.mjs", "utf8");

function assertIncludes(source, snippet, label) {
  assert(source.includes(snippet), `${label} is missing ${snippet}`);
}

function assertExcludes(source, snippet, label) {
  assert(!source.includes(snippet), `${label} must not include ${snippet}`);
}

for (const snippet of [
  "const dashboardPendingInvitationCount = dashboardScopedUsers.filter",
  'user.invitationStatus === "pending"',
  "const dashboardActiveUserCount = dashboardScopedUsers.length - dashboardPendingInvitationCount",
  "const adminPendingInvitationKpi = {",
  "const adminOperationalKpiBase = [",
  "dashboardPendingInvitationCount > 0",
  "? [adminOperationalKpiBase[0], adminPendingInvitationKpi, ...adminOperationalKpiBase.slice(1)]",
  'actionHref: "/app/admin/users"',
  'actionLabel: dashboardPendingInvitationCount > 0 ? "초대 승인" : "사용자 보기"',
  'badge: dashboardPendingInvitationCount > 0 ? "대기" : undefined',
  "활성 사용자 ${dashboardActiveUserCount}명 · 대기 초대 ${dashboardPendingInvitationCount}건",
  'label: "대기 초대"',
  'tone: dashboardPendingInvitationCount > 0 ? "warning" : "neutral"',
  "value: String(dashboardPendingInvitationCount)",
]) {
  assertIncludes(dashboardSource, snippet, "admin dashboard pending invitation KPI");
}

for (const snippet of [
  'actionHref: "/app/admin/audit-logs"',
  'actionLabel: "최근 기록"',
  "최근 변경 ${dashboardScopedAuditLogs.length}건",
  'label: "계정/기록"',
]) {
  assertExcludes(dashboardSource, snippet, "admin dashboard first-screen internal record KPI");
}

for (const snippet of ["대기 초대", "초대 승인", "사용자 보기"]) {
  assertIncludes(p5ReadinessSource, snippet, "P5-P10 dashboard copy guard");
}

for (const snippet of [
  'const ownerPaymentGroups = [',
  'id: "training-team"',
  'label: "훈련단"',
  'id: "general-members"',
  'label: "일반관원"',
  'label: "훈련비"',
  'label: "시합비"',
  'label: "심사비"',
  'data-testid="owner-dashboard-payment-groups"',
  'data-testid={`owner-dashboard-payment-group-${group.id}`}',
  "getPaymentRemainingRefundableAmount(payment)",
]) {
  assertIncludes(dashboardSource, snippet, "owner dashboard payment summary");
}

for (const snippet of [
  'scope: "현재 상태"',
  "출석 미처리 수업 ${lowAttendanceClasses.length}개",
  'data-testid="owner-dashboard-branch-detail"',
  'data-testid="owner-dashboard-payment-risk-detail"',
  ">운영 지점<",
  ">결제 위험 회원<",
]) {
  assertExcludes(dashboardSource, snippet, "retired owner dashboard detail");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "admin dashboard first-screen KPI points to pending invitations, not audit logs",
        "pending invitations remain actionable through /app/admin/users",
        "P5-P10 readiness guard blocks the retired internal record KPI copy",
        "owner dashboard separates collected fees into training team and general member summaries",
        "each owner payment group keeps training, competition, and promotion fee totals",
        "retired risk, attendance, branch, and payment-risk detail cards do not regress",
      ],
    },
    null,
    2,
  ),
);
