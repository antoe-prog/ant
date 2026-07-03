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

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "admin dashboard first-screen KPI points to pending invitations, not audit logs",
        "pending invitations remain actionable through /app/admin/users",
        "P5-P10 readiness guard blocks the retired internal record KPI copy",
      ],
    },
    null,
    2,
  ),
);
