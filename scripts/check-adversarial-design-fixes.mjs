import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  paymentsScreen,
  checkoutScreen,
  noticesScreen,
  classesScreen,
  membersScreen,
  dashboardScreen,
  promotionsScreen,
  appShell,
  serverApi,
  attendanceClearRoute,
  mockApi,
  memberPresentation,
  adminSettingsScreen,
  ownerReportsScreen,
] = await Promise.all([
  readFile("src/components/screens/payments-screen.tsx", "utf8"),
  readFile("src/components/screens/payment-checkout-screen.tsx", "utf8"),
  readFile("src/components/screens/notices-screen.tsx", "utf8"),
  readFile("src/components/screens/classes-screen.tsx", "utf8"),
  readFile("src/components/screens/members-screen.tsx", "utf8"),
  readFile("src/components/screens/dashboard-screen.tsx", "utf8"),
  readFile("src/components/screens/promotions-screen.tsx", "utf8"),
  readFile("src/components/shell/app-shell.tsx", "utf8"),
  readFile("src/server/api.ts", "utf8"),
  readFile("src/app/api/v1/class-sessions/[sessionId]/attendance/[memberId]/route.ts", "utf8"),
  readFile("src/lib/mock-api.ts", "utf8"),
  readFile("src/lib/member-presentation.ts", "utf8"),
  readFile("src/components/screens/admin-settings-screen.tsx", "utf8"),
  readFile("src/components/screens/owner-reports-screen.tsx", "utf8"),
]);

for (const snippet of [
  'data-testid="payment-adjustment-confirmation"',
  'setPaymentAdjustmentPendingId(payment.id)',
  '"환불 확정"',
  '"취소 확정"',
]) {
  assert(paymentsScreen.includes(snippet), `payment destructive action guard must include ${snippet}`);
}
assert(checkoutScreen.includes('data-testid="payment-collection-request-error"'), "family checkout must keep a dedicated request error");
assert(
  !/if \(!ok\)[\s\S]{0,180}setConfirmedInputFingerprint\(""\)/.test(checkoutScreen),
  "family checkout failure must keep the confirmed input fingerprint for retry",
);

for (const snippet of [
  'data-testid="notice-create-confirmation"',
  'recipientCount: context.db.users.filter',
  '"발행 내용 확인"',
  '"확인 후 발행"',
]) {
  assert(noticesScreen.includes(snippet), `notice publish confirmation must include ${snippet}`);
}
assert(classesScreen.includes('noticeAudience=guardian'), "guardian follow-up deep link must default to guardian-only delivery");
assert(noticesScreen.includes('data-testid="notice-delivery-body-toggle"'), "publisher notice cards must expose long-body details on mobile");
assert(
  noticesScreen.includes('data-testid="notice-delivery-body"') && noticesScreen.includes('line-clamp-2'),
  "publisher notice cards must show a bounded mobile body preview",
);

assert(classesScreen.includes("previousStatus: AttendanceStatus | null"), "first attendance selection must preserve an unchecked undo state");
assert(classesScreen.includes('"미처리로 되돌리기"'), "attendance undo must name the unchecked restore action");
assert(
  classesScreen.includes("Number(getAttendanceProgress(left).uncheckedCount === 0)") &&
    classesScreen.includes("visibleSessions.find((session) => getAttendanceProgress(session).uncheckedCount > 0)"),
  "coach classes must sort and open incomplete attendance before completed classes",
);
assert(
  classesScreen.includes('grid grid-cols-1 items-start gap-2 border-b border-zinc-100 pb-1.5 sm:grid-cols-[minmax(0,1fr)_11rem]'),
  "coach class headers must stack before the small-screen breakpoint",
);
assert(attendanceClearRoute.includes("export async function DELETE"), "attendance API must expose a scoped clear operation");
assert(mockApi.includes("export function clearAttendance"), "attendance clear must be a shared domain operation");
assert(mockApi.includes("attendance: db.attendance.filter"), "attendance clear must restore the member to unchecked");
assert(mockApi.includes('message: "출석 상태를 미처리로 되돌렸습니다."'), "attendance clear must remain auditable");
assert(attendanceClearRoute.includes("clearAttendance(db, sessionId, memberId, user.id)"), "attendance clear must be idempotent for retries");

assert(serverApi.includes("membershipSummary: createCoachMembershipSummary"), "coach bootstrap must include amount-free membership status");
assert(membersScreen.includes('data-testid={`coach-member-membership-summary-${member.id}`}'), "coach member cards must show membership status");
assert(!/membershipSummary[\s\S]{0,200}amount/.test(serverApi), "coach membership summary must not include payment amounts");

assert(dashboardScreen.includes("const latestChildPromotion"), "guardian dashboard must use promotion records");
assert(dashboardScreen.includes("const nextTournament"), "guardian dashboard must use tournament records");
assert(dashboardScreen.includes('eyebrow: "다음 수업"'), "guardian dashboard must lead learning insights with the next class");
assert(
  dashboardScreen.indexOf('data-testid="guardian-learning-action-strip"') <
    dashboardScreen.indexOf('data-testid="guardian-learning-insight-grid"'),
  "guardian payment and notice actions must precede secondary learning insights",
);
assert(
  dashboardScreen.includes("if (latestChildPromotion)") && dashboardScreen.includes("if (nextTournament)"),
  "guardian dashboard must not render empty promotion or tournament cards",
);
assert(
  dashboardScreen.includes('data-testid="owner-dashboard-period-scope"') &&
    dashboardScreen.includes('data-testid="owner-dashboard-current-scope"') &&
    dashboardScreen.includes("기간 필터 미적용") &&
    dashboardScreen.includes('scope: "현재 상태"') &&
    dashboardScreen.includes("scope: period.label"),
  "owner dashboard must separate selected-period operations from current-state KPIs",
);
assert(
  dashboardScreen.includes("max-[420px]:grid-cols-1"),
  "coach operations must use a single column at 390px to prevent text and value collisions",
);
assert(!dashboardScreen.includes("promotionResultNotice"), "guardian promotion status must not be inferred from notice copy");
assert(!dashboardScreen.includes("tournamentNotice"), "guardian tournament status must not be inferred from notice copy");
assert(
  dashboardScreen.includes('data-testid="guardian-learning-belt-steps"') &&
    dashboardScreen.includes("승급 진척률이 아닌 단계 순서입니다.") &&
    dashboardScreen.includes('aria-current="step"'),
  "guardian belt status must use an explicit step sequence instead of a progress percentage",
);
assert(!dashboardScreen.includes("currentBeltProgress"), "guardian belt status must not calculate a fake completion percentage");
assert(promotionsScreen.includes("회원·학부모 공개 메모"), "promotion note input must disclose its audience");

assert(appShell.includes("mobile-current-route-context"), "mobile secondary routes must keep visible role and route context");
assert(appShell.includes("isFamilyNoticeRoute"), "family notices must activate the notification entry point");
assert(appShell.includes('aria-current={mobileSecondaryRouteActive ? "page" : undefined}'), "mobile more menu must expose the active page");
assert(
  appShell.includes("mobileContextLabel = mobileSecondaryRouteActive || isNotificationRoute"),
  "mobile notification and account routes must keep visible route context",
);

assert(adminSettingsScreen.includes('data-testid="admin-settings-priority-work"'), "admin operations must expose one primary work board");
assert(adminSettingsScreen.includes("pilotNextActions.slice(0, 3)"), "admin operations must show the first three actions by default");
assert(
  (adminSettingsScreen.match(/data-operation-tier="secondary"/g) ?? []).length === 3,
  "admin readiness, operations, and incident sections must remain secondary bands",
);
assert(
  membersScreen.includes("const showMemberBranchIdentity = canManageMembers && !context.selectedBranchId") &&
    membersScreen.includes('data-testid={`member-branch-identity-${member.id}`}'),
  "all-branch member cards must expose branch identity without repeating it in a selected branch",
);
assert(
  ownerReportsScreen.indexOf('data-testid="owner-report-action-rail"') <
    ownerReportsScreen.indexOf('data-testid="owner-report-export-controls"') &&
    ownerReportsScreen.indexOf('data-testid="owner-report-export-controls"') <
      ownerReportsScreen.indexOf('data-testid="owner-report-graph-board"'),
  "owner reports must place actions before exports and graphs",
);
assert(!/text-\[(?:10|11)px\]/.test(ownerReportsScreen), "owner reports must not rely on 10px or 11px operational copy");
assert(
  ownerReportsScreen.includes("const ownerReportTrendGraphBaseRows = ownerReportActiveTrendRows;") &&
    ownerReportsScreen.includes('dataStatus: hasObservedData ? "수집됨" : "미수집"'),
  "owner report trends must retain zero months and label missing periods",
);
assert(
  appShell.match(/\(route\.id === "notices" && isNotificationRoute\) \|\| isRouteActive/g)?.length === 2,
  "desktop and mobile navigation must activate notices for the notification inbox",
);
assert(
  !appShell.includes('route.id === "notices" && pathname.startsWith("/app/notifications")'),
  "notification routes must not suppress the notices navigation state",
);

assert(memberPresentation.includes('member.status === "trial" && level.includes("체험")'), "trial child presentation must detect duplicate trial labels");
assert(memberPresentation.includes("hideDuplicateTrialLevel || !level ? member.belt"), "trial child presentation must avoid repeating the trial label");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "destructive payment confirmation and pending lock",
    "family payment request error retry",
    "notice recipient confirmation and guardian-only follow-up",
    "unchecked attendance restore with audit",
    "amount-free coach membership status",
    "guardian dashboard domain source consistency",
    "promotion note audience disclosure",
    "mobile route context",
    "notification and account navigation context",
    "role-specific UI priority and branch context",
    "shared child switcher presentation",
  ],
}, null, 2));
