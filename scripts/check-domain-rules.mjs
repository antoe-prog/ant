import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const roles = await import("../src/lib/roles.ts");
const scope = await import("../src/lib/mock-api.ts");
const auditReadDeduplication = await import("../src/lib/audit-read-deduplication.ts");
const auditLogQuery = await import("../src/lib/audit-log-query.ts");
const notificationAlerts = await import("../src/lib/notification-alerts.ts");
const noticeMemberSearch = await import("../src/lib/notice-member-search.ts");
const notices = await import("../src/lib/notices.ts");
const promotions = await import("../src/lib/promotions.ts");
const userDisplay = await import("../src/lib/user-display.ts");
const classRecurrence = await import("../src/lib/class-recurrence.ts");
const finalMainSchedule = await import("../src/lib/final-main-schedule-policy.ts");
const [
  paymentsExportRouteSource,
  operationsExportRouteSource,
  paymentsScreenSource,
  serverApiSource,
  mockApiSource,
  familyMembersSource,
  appStoreSource,
  ownerBranchesScreenSource,
  classesScreenSource,
  paymentCheckoutScreenSource,
  notificationOutboxRunnerSource,
  appShellSource,
  adminRolesScreenSource,
  adminUserRoleRouteSource,
  familyClassCalendarSource,
] = await Promise.all([
  readFile("src/app/api/v1/exports/payments/route.ts", "utf8"),
  readFile("src/app/api/v1/exports/operations/route.ts", "utf8"),
  readFile("src/components/screens/payments-screen.tsx", "utf8"),
  readFile("src/server/api.ts", "utf8"),
  readFile("src/lib/mock-api.ts", "utf8"),
  readFile("src/lib/family-members.ts", "utf8"),
  readFile("src/store/app-store.tsx", "utf8"),
  readFile("src/components/screens/owner-branches-screen.tsx", "utf8"),
  readFile("src/components/screens/classes-screen.tsx", "utf8"),
  readFile("src/components/screens/payment-checkout-screen.tsx", "utf8"),
  readFile("src/server/notification-outbox-runner.ts", "utf8"),
  readFile("src/components/shell/app-shell.tsx", "utf8"),
  readFile("src/components/screens/admin-roles-screen.tsx", "utf8"),
  readFile("src/app/api/v1/admin/users/[userId]/roles/route.ts", "utf8"),
  readFile("src/components/domain/family-class-calendar.tsx", "utf8"),
]);

const db = {
  branches: [
    { id: "branch-gangnam", name: "강남 본관", district: "서울 강남" },
    { id: "branch-songpa", name: "송파 도장", district: "서울 송파" },
  ],
  users: [
    { id: "user-admin", name: "총괄", role: "admin", title: "총괄", branchIds: ["branch-gangnam", "branch-songpa"] },
    { id: "user-owner", name: "대표", role: "owner", title: "대표", branchIds: ["branch-gangnam"] },
    { id: "user-coach", name: "코치", role: "coach", title: "코치", branchIds: ["branch-gangnam"] },
    {
      id: "user-guardian",
      name: "학부모",
      role: "guardian",
      title: "학부모",
      branchIds: ["branch-gangnam"],
      childMemberIds: ["member-jun", "member-adult-stale"],
    },
    {
      id: "user-member",
      name: "회원",
      role: "member",
      title: "회원",
      branchIds: ["branch-gangnam"],
      memberIds: ["member-jun"],
    },
    {
      id: "user-songpa-guardian",
      name: "송파 학부모",
      role: "guardian",
      title: "학부모",
      branchIds: ["branch-songpa"],
      childMemberIds: ["member-harin"],
    },
  ],
  members: [
    {
      id: "member-jun",
      ageGroup: "kids",
      branchId: "branch-gangnam",
      name: "이준",
      guardianIds: ["user-guardian"],
      primaryCoachId: "user-coach",
    },
    {
      id: "member-seo",
      ageGroup: "kids",
      branchId: "branch-gangnam",
      name: "이서",
      guardianIds: [],
      primaryCoachId: "user-coach",
    },
    {
      id: "member-adult-stale",
      ageGroup: "adult",
      branchId: "branch-gangnam",
      name: "성인 기존 연결",
      guardianIds: ["user-guardian"],
      primaryCoachId: "user-coach",
    },
    {
      id: "member-harin",
      ageGroup: "kids",
      branchId: "branch-songpa",
      name: "송하린",
      guardianIds: ["user-songpa-guardian"],
      primaryCoachId: "user-admin",
    },
  ],
  classes: [
    {
      id: "class-kids-am",
      branchId: "branch-gangnam",
      name: "유소년 유도 기초반",
      coachId: "user-coach",
      enrolledMemberIds: ["member-jun", "member-seo"],
    },
    {
      id: "class-songpa",
      branchId: "branch-songpa",
      name: "송파 유소년반",
      coachId: "user-admin",
      enrolledMemberIds: ["member-harin"],
    },
  ],
  attendance: [],
  counselingNotes: [],
  payments: [
    { id: "payment-jun-overdue", branchId: "branch-gangnam", memberId: "member-jun", status: "overdue" },
    { id: "payment-seo-overdue", branchId: "branch-gangnam", memberId: "member-seo", status: "overdue" },
    { id: "payment-adult-stale-overdue", branchId: "branch-gangnam", memberId: "member-adult-stale", status: "overdue" },
    { id: "payment-harin-overdue", branchId: "branch-songpa", memberId: "member-harin", status: "overdue" },
  ],
  notices: [
    {
      id: "notice-global",
      branchId: "branch-gangnam",
      title: "전체 공지",
      audience: ["all"],
      readByUserIds: [],
    },
    {
      id: "notice-class",
      branchId: "branch-gangnam",
      title: "반 공지",
      audience: ["member", "guardian", "coach"],
      targetClassIds: ["class-kids-am"],
      readByUserIds: [],
    },
    {
      id: "notice-member",
      branchId: "branch-gangnam",
      title: "개인 공지",
      audience: ["member", "guardian"],
      targetMemberIds: ["member-jun"],
      readByUserIds: [],
    },
    {
      id: "notice-coach-created-family",
      branchId: "branch-gangnam",
      title: "코치 발행 가족 공지",
      audience: ["member", "guardian"],
      createdByUserId: "user-coach",
      targetMemberIds: ["member-jun"],
      readByUserIds: [],
    },
    {
      id: "notice-member-only-branch",
      branchId: "branch-gangnam",
      title: "회원 전용 전체 공지",
      audience: ["member"],
      readByUserIds: [],
    },
    {
      id: "notice-adult-stale",
      branchId: "branch-gangnam",
      title: "성인 기존 연결 개인 공지",
      audience: ["member", "guardian"],
      targetMemberIds: ["member-adult-stale"],
      readByUserIds: [],
    },
    {
      id: "notice-songpa",
      branchId: "branch-songpa",
      title: "송파 공지",
      audience: ["member", "guardian", "coach"],
      targetMemberIds: ["member-harin"],
      readByUserIds: [],
    },
  ],
  auditLogs: [],
};

const weeklyClassRecurrence = classRecurrence.getClassWeeklyRecurrence({
  mode: "weekly",
  startsOn: "2026-07-20",
  endsOn: "2026-07-31",
  weekdays: [1, 3],
  startTime: "18:00",
  endTime: "19:00",
});
assert.equal(weeklyClassRecurrence.ok, true, "weekly class recurrence must accept valid weekdays and times");
if (weeklyClassRecurrence.ok) {
  assert.deepEqual(
    weeklyClassRecurrence.occurrences.map((occurrence) => occurrence.date),
    ["2026-07-20", "2026-07-22", "2026-07-27", "2026-07-29"],
    "weekly class recurrence must create each selected weekday within the inclusive range",
  );
  assert.equal(
    weeklyClassRecurrence.occurrences[0].startsAt,
    "2026-07-20T09:00:00.000Z",
    "weekly class recurrence must convert Korea schedule time to a stable instant",
  );
}
assert.equal(
  classRecurrence.getClassWeeklyRecurrence({
    mode: "weekly",
    startsOn: "2026-07-20",
    endsOn: "2026-07-19",
    weekdays: [1],
    startTime: "18:00",
    endTime: "19:00",
  }).ok,
  false,
  "weekly class recurrence must reject reversed date ranges",
);
assert.equal(
  classRecurrence.getClassWeeklyRecurrence({
    mode: "weekly",
    startsOn: "2026-07-20",
    endsOn: "2026-07-31",
    weekdays: [],
    startTime: "18:00",
    endTime: "19:00",
  }).ok,
  false,
  "weekly class recurrence must require at least one weekday",
);
assert.equal(
  classRecurrence.getClassWeeklyRecurrence({
    mode: "weekly",
    startsOn: "2026-07-20",
    endsOn: "2026-07-31",
    weekdays: [1],
    startTime: "19:00",
    endTime: "18:00",
  }).ok,
  false,
  "weekly class recurrence must reject non-positive durations",
);
assert.equal(
  finalMainSchedule.isFinalMainClassRegistrationSlot(1, "18:00", "19:00"),
  true,
  "main timetable must accept a registered Monday slot",
);
assert.equal(
  finalMainSchedule.isFinalMainClassRegistrationSlot(5, "22:00", "23:00"),
  false,
  "main timetable must reject Friday times outside the registered schedule",
);
assert.equal(
  finalMainSchedule.isFinalMainClassRegistrationSlot(6, "11:00", "12:30"),
  true,
  "main timetable must expose the fixed Saturday session",
);

const [admin, owner, coach, guardian, member, songpaGuardian] = db.users;

function routeIdsFor(role) {
  return roles.getVisibleRoutes(role).map((route) => route.id);
}

function mobileRouteIdsFor(role) {
  return roles.getMobileVisibleRoutes(role).map((route) => route.id);
}

function mobileRouteIdsForPath(role, pathname) {
  return roles.getMobileVisibleRoutes(role, pathname).map((route) => route.id);
}

function mobileSecondaryRouteIdsFor(role) {
  return roles.getMobileSecondaryRoutes(role).map((route) => route.id);
}

for (const role of ["member", "guardian", "coach", "owner", "admin"]) {
  const rbacRole = roles.getRbacRole(role);

  assert.equal(roles.getUiRole(rbacRole), role, `${role} must round-trip through RBAC mapping`);
  assert.equal(roles.getDefaultRoute(role), "/app/dashboard", `${role} default route must be dashboard`);
}

assert.deepEqual(
  routeIdsFor("coach"),
  ["dashboard", "classes", "members", "promotions", "tournaments", "notices"],
  "coach nav must include promotion and tournament menus and must not expose deleted request routes",
);
assert(routeIdsFor("member").includes("tournaments"), "member nav must include the tournament notice menu");
assert(routeIdsFor("guardian").includes("tournaments"), "guardian nav must include the tournament notice menu");
assert(routeIdsFor("owner").includes("ownerReports"), "owner nav must include operation reports");
assert(!routeIdsFor("owner").includes("adminUsers"), "owner nav must omit admin user management");
assert(routeIdsFor("admin").includes("adminSettings"), "admin nav must include system settings");
assert(!routeIdsFor("admin").includes("ownerReports"), "admin nav must omit owner-only reports");
assert.deepEqual(
  mobileRouteIdsFor("admin"),
  ["dashboard", "adminBranches", "adminUsers", "notices", "adminSettings"],
  "admin mobile nav must stay focused on management routes",
);
assert.deepEqual(
  mobileRouteIdsForPath("admin", "/app/notices"),
  ["dashboard", "adminBranches", "adminUsers", "notices", "adminSettings"],
  "admin mobile nav must keep its management destinations stable on notices",
);
assert.deepEqual(
  mobileRouteIdsForPath("admin", "/app/notifications"),
  ["dashboard", "adminBranches", "adminUsers", "notices", "adminSettings"],
  "admin mobile nav must keep its management destinations stable in the notification inbox",
);
assert.deepEqual(
  mobileRouteIdsFor("owner"),
  ["dashboard", "members", "payments", "notices", "ownerReports"],
  "owner mobile nav must keep daily operation routes without deleted request links",
);
assert.deepEqual(
  mobileSecondaryRouteIdsFor("admin"),
  ["members", "adminRoles", "adminAuditLogs"],
  "admin account menu must keep member records distinct from user administration and expose secondary management routes",
);
assert.deepEqual(
  mobileSecondaryRouteIdsFor("owner"),
  ["classes", "promotions", "tournaments", "ownerBranches"],
  "owner mobile secondary navigation must expose class, promotion, tournament, and branch operations",
);
assert.deepEqual(
  mobileSecondaryRouteIdsFor("coach"),
  ["tournaments"],
  "coach mobile secondary navigation must expose tournament operations",
);
assert(
  appShellSource.includes('data-testid="mobile-branch-scope"') &&
    appShellSource.includes('data-testid="mobile-branch-scope-label"'),
  "multi-branch mobile shell must keep the current branch scope visible without expanding the menu",
);
assert(
  adminRolesScreenSource.includes('data-testid="admin-role-branch-selector"') &&
    adminRolesScreenSource.includes('data-testid="admin-role-scope-summary"') &&
    adminRolesScreenSource.includes("updateUserRole(targetUser.id, nextRole, nextBranchIds, reason)") &&
    adminUserRoleRouteSource.includes("requestedBranchIds.length === 0") &&
    !adminUserRoleRouteSource.includes("fallbackBranchIds"),
  "admin role changes must review and persist an explicit branch scope without automatic fallback assignment",
);
assert(
  appStoreSource.includes("branchSelectionRequestRef") &&
    appStoreSource.includes("requestId !== branchSelectionRequestRef.current") &&
    appStoreSource.includes('dispatch({ type: "selectBranch", branchId: previousBranchId })') &&
    appStoreSource.includes("branchSelectionPending"),
  "branch selection must ignore stale responses, restore the confirmed scope after failure, and expose pending state",
);
assert(
  ownerBranchesScreenSource.includes("await selectBranch(branchId)") &&
    ownerBranchesScreenSource.includes("router.push(href)") &&
    ownerBranchesScreenSource.includes("branchSelectionPending"),
  "owner branch actions must confirm their branch scope before navigating",
);
assert.deepEqual(mobileRouteIdsFor("member"), ["dashboard", "classes", "members", "payments", "tournaments"], "member mobile nav must surface tournaments instead of the duplicated notice inbox");
assert.deepEqual(
  mobileRouteIdsFor("guardian"),
  ["dashboard", "classes", "members", "payments", "tournaments"],
  "guardian mobile nav must surface tournaments instead of the duplicated notice inbox",
);

assert.equal(roles.canAccessPath("coach", "/app/payments"), false, "coach must not access payments");
assert.equal(roles.canAccessPath("member", "/app/owner/reports"), false, "member must not access owner reports");
assert.equal(roles.canAccessPath("guardian", "/app/owner/reports"), false, "guardian must not access owner reports");
assert.equal(roles.canAccessPath("admin", "/app/owner/reports"), false, "admin must not access owner reports");
assert.equal(roles.canAccessPath("guardian", "/app/notices"), true, "guardian must access notices");

assert(
  paymentsExportRouteSource.includes('!["owner", "admin"].includes(user.role)'),
  "payments CSV export API must stay owner/admin only",
);
assert(
  operationsExportRouteSource.includes('!["owner", "admin"].includes(user.role)'),
  "operations CSV export API must stay owner/admin only",
);
assert(
  paymentsScreenSource.includes('const canManagePayments = context.user.role === "owner" || context.user.role === "admin"'),
  "payments screen CSV export action must stay hidden from member/guardian roles",
);
assert(
  serverApiSource.includes("const globalAdminDataAccess = hasGlobalAdminDataAccess(user)") &&
    serverApiSource.includes("const auditLogs = globalAdminDataAccess") &&
    serverApiSource.includes('? db.auditLogs') &&
    serverApiSource.includes('user.role === "owner" || user.role === "admin"') &&
    serverApiSource.includes('log.branchId !== null && branchIds.includes(log.branchId)'),
  "regular admin bootstrap must include all audit logs while owner and review-admin bootstrap remain branch scoped",
);
assert(
  serverApiSource.includes('user.role === "coach"') &&
    serverApiSource.includes('log.actorUserId === user.id') &&
    serverApiSource.includes('log.targetType === "attendance"') &&
    /const auditLogs = globalAdminDataAccess[\s\S]{0,800}: \[\];/.test(serverApiSource),
  "coach bootstrap must only include own scoped attendance history and family roles must receive no audit logs",
);
assert(
  serverApiSource.includes('const payments = user.role === "coach"') &&
    /const payments = user\.role === "coach"[\s\S]{0,80}\? \[\]/.test(serverApiSource),
  "coach bootstrap snapshots must not include payment records",
);
assert(!serverApiSource.includes("amount: 0"), "coach bootstrap snapshots must not rely on amount masking");
assert(
  !mockApiSource.includes("amount: 0"),
  "mock API must not rely on amount masking for coach payment privacy",
);

const coachDashboard = await scope.mockApi.getDashboard({ db, user: coach, selectedBranchId: "branch-gangnam" });
const coachPayments = await scope.mockApi.getPayments({ db, user: coach, selectedBranchId: "branch-gangnam" });
const ownerDashboard = await scope.mockApi.getDashboard({ db, user: owner, selectedBranchId: "branch-gangnam" });

assert.equal(coachDashboard.expiringPayments.length, 0, "coach dashboard API must not include payment follow-up records");
assert.equal(coachPayments.length, 0, "coach payment API projection must not include payment records");
assert.equal(ownerDashboard.expiringPayments.length, 3, "owner dashboard API must keep scoped payment follow-ups");

assert.deepEqual(scope.getAccessibleBranchIds(admin, db), ["branch-gangnam", "branch-songpa"], "admin must see all branches");
assert.deepEqual(scope.getAccessibleBranchIds(owner, db), ["branch-gangnam"], "owner branch scope must come from assigned branches");
assert.deepEqual(
  scope.getSelectedBranchIds({ db, user: owner, selectedBranchId: "branch-songpa" }),
  ["branch-gangnam"],
  "inaccessible selected branch must fall back to accessible owner branch",
);

assert.deepEqual(scope.getAccessibleMemberIds(coach, db, ["branch-gangnam"]).sort(), ["member-jun", "member-seo"], "coach members must come from coached classes");
assert.deepEqual(scope.getAccessibleMemberIds(guardian, db, ["branch-gangnam"]), ["member-jun"], "guardian member scope must exclude adult stale links");
assert.deepEqual(scope.getAccessibleMemberIds(member, db, ["branch-gangnam"]), ["member-jun"], "member scope must be self only");
assert.deepEqual(
  scope.getAccessibleMemberIds(owner, db, ["branch-gangnam"]).sort(),
  ["member-adult-stale", "member-jun", "member-seo"],
  "owner must see branch members",
);

assert(
  mockApiSource.includes("getGuardianFamilyMemberIds(user, db, branchIds)") &&
    familyMembersSource.includes("canMemberHaveGuardianLink(member)") &&
    mockApiSource.includes("const linkedChildMemberIds = getAccessibleMemberIds(user, db, [notice.branchId]);"),
  "guardian scope helpers must reject stale adult child links for members and notices",
);
assert(
  serverApiSource.includes('safeUser.role === "guardian"') &&
    serverApiSource.includes("allowedFamilyMemberIds") &&
    serverApiSource.includes("safeUser.memberIds = selfMemberIds") &&
    serverApiSource.includes("safeUser.childMemberIds = [...allowedFamilyMemberIds].filter") &&
    serverApiSource.includes("member?.guardianIds.includes(safeUser.id)"),
  "guardian bootstrap user must drop stale self links and expose member-authorized child links",
);
assert(
  serverApiSource.includes("function createSafeUser(") &&
    serverApiSource.includes('viewerRole: AppUser["role"] = user.role') &&
    serverApiSource.includes('if (viewerRole !== "admin")') &&
    serverApiSource.includes("delete safeUser.invitationToken;") &&
    serverApiSource.includes("delete safeUser.invitedAt;") &&
    serverApiSource.includes("delete safeUser.acceptedAt;") &&
    serverApiSource.includes("delete safeUser.passwordResetRequestedAt;") &&
    serverApiSource.includes("delete safeUser.passwordUpdatedAt;") &&
    serverApiSource.includes('(viewerRole === "member" || viewerRole === "guardian") && safeUser.id !== viewerUserId') &&
    serverApiSource.includes("delete safeUser.email;") &&
    serverApiSource.includes("delete safeUser.phone;") &&
    serverApiSource.includes("? { ...member, alerts: [] }") &&
    serverApiSource.includes("payment.collectionRequest.requestedByUserId !== user.id") &&
    serverApiSource.includes('payerName: "다른 보호자"') &&
    serverApiSource.includes('payerPhone: ""') &&
    serverApiSource.includes("const users = scopedUsers.map((candidate) => createSafeUser(candidate, db, user.role, user.id));") &&
    serverApiSource.includes("user: createSafeUser(user, db, user.role, user.id),"),
  "guardian bootstrap user and user snapshot sanitizers must both use scoped safe users",
);

const noticesById = new Map(db.notices.map((notice) => [notice.id, notice]));

assert.equal(scope.canReadNotice(coach, db, noticesById.get("notice-class")), true, "coach must read coached class notice");
assert.equal(scope.canReadNotice(coach, db, noticesById.get("notice-coach-created-family")), true, "coach must keep creator access to member and guardian notice");
assert.equal(scope.canReadNotice(guardian, db, noticesById.get("notice-member")), true, "guardian must read child-targeted notice");
assert.equal(scope.canReadNotice(guardian, db, noticesById.get("notice-adult-stale")), false, "guardian must not read stale adult child notice");
assert.equal(scope.canReadNotice(member, db, noticesById.get("notice-member")), true, "member must read self-targeted notice");
assert.equal(scope.canReadNotice(guardian, db, noticesById.get("notice-member-only-branch")), false, "guardian must not read member-only branch notice");
assert.equal(scope.canReadNotice(member, db, noticesById.get("notice-member-only-branch")), true, "member must read member-only branch notice");
assert.equal(scope.canReadNotice(guardian, db, noticesById.get("notice-songpa")), false, "guardian must not read another branch notice");
assert.equal(scope.canReadNotice(member, db, noticesById.get("notice-songpa")), false, "member must not read another member notice");
assert.equal(
  notices.isNoticeRelevantToMember(noticesById.get("notice-global"), "member-jun", db.classes),
  true,
  "branch-wide notices must remain visible in a selected child scope",
);
assert.equal(
  notices.isNoticeRelevantToMember(noticesById.get("notice-class"), "member-jun", db.classes),
  true,
  "class notices must remain visible for an enrolled selected child",
);
assert.equal(
  notices.isNoticeRelevantToMember(noticesById.get("notice-member"), "member-seo", db.classes),
  false,
  "another child's direct notice must stay out of the selected child scope",
);
assert.equal(
  noticeMemberSearch.normalizeNoticeMemberSearchText("010-7248 3619"),
  "01072483619",
  "notice member search must normalize phone punctuation",
);
assert.equal(
  noticeMemberSearch.normalizeMemberSearchText("보호자 이하린"),
  "보호자이하린",
  "shared member search must normalize Korean labels and spacing",
);
assert.equal(
  noticeMemberSearch.matchesNoticeMemberSearch("01072483619", ["이준", "010-7248-3619", "보호자 이하린"]),
  true,
  "notice member search must match hyphen-free phone queries",
);
assert.equal(
  noticeMemberSearch.matchesMemberSearch("하린", ["이준", "010-7248-3619", "보호자 이하린"]),
  true,
  "shared member search must match guardian labels for non-notice pickers",
);
assert.equal(
  noticeMemberSearch.matchesNoticeMemberSearch("이 준", ["이준", "010-7248-3619", "보호자 이하린"]),
  true,
  "notice member search must match spaced Korean name queries",
);
assert.equal(
  noticeMemberSearch.getHangulInitialSearchText("이선영 최민재"),
  "ㅇㅅㅇㅊㅁㅈ",
  "shared member search must derive Hangul initial consonants",
);
assert.equal(
  noticeMemberSearch.matchesNoticeMemberSearch("ㅇㅅㅇ", ["이선영2", "010-4500-1122", "보호자 이하린"]),
  true,
  "notice member search must match Hangul initial consonant queries",
);
assert.equal(
  noticeMemberSearch.matchesMemberSearch("ㅊㅁㅈ", ["최민재", "010-2200-3199"]),
  true,
  "shared member search must support Hangul initial consonants for payment member pickers",
);
assert.equal(userDisplay.getVisibleUserEmail("admin@finaljudo.test"), null, "test-domain seed emails must stay hidden from app UI");
assert.equal(userDisplay.getVisibleUserEmail(" admin@finaljudo.kr "), "admin@finaljudo.kr", "production-domain emails must stay visible after trimming");
assert.equal(userDisplay.getVisibleUserEmail(undefined), null, "missing user email must stay hidden from app UI");

assert.deepEqual(
  notificationAlerts.getNotificationAlertCounts({ db, selectedBranchId: "branch-gangnam", user: guardian }),
  {
    actionableCount: 5,
    paymentAlertCount: 1,
    promotionAlertCount: 0,
    scopeBranchIds: ["branch-gangnam"],
    unreadNoticeCount: 4,
  },
  "guardian notification counts must include child notices and child payments only",
);
assert.equal(
  notificationAlerts.formatNotificationActionableLabel(
    notificationAlerts.getNotificationAlertCounts({ db, selectedBranchId: "branch-gangnam", user: guardian }),
  ),
  "미확인 공지 4건, 확인 필요 결제 1건",
  "guardian notification label must distinguish unread notices from payment follow-ups",
);
const dbAfterGuardianNoticeRead = scope.markNoticeRead(db, "notice-member", guardian.id);

assert.deepEqual(
  notificationAlerts.getNotificationAlertCounts({ db: dbAfterGuardianNoticeRead, selectedBranchId: "branch-gangnam", user: guardian }),
  {
    actionableCount: 4,
    paymentAlertCount: 1,
    promotionAlertCount: 0,
    scopeBranchIds: ["branch-gangnam"],
    unreadNoticeCount: 3,
  },
  "guardian notification counts must decrease after the guardian reads a shared child notice",
);
assert.deepEqual(
  notificationAlerts.getNotificationAlertCounts({ db: dbAfterGuardianNoticeRead, selectedBranchId: "branch-gangnam", user: member }),
  {
    actionableCount: 6,
    paymentAlertCount: 1,
    promotionAlertCount: 0,
    scopeBranchIds: ["branch-gangnam"],
    unreadNoticeCount: 5,
  },
  "member notification counts must not decrease when the guardian reads the shared child notice",
);
const dbWithLegacyNotice = {
  ...db,
  notices: [
    {
      id: "notice-legacy-unread",
      branchId: "branch-gangnam",
      title: "기존 공지",
      audience: ["member", "guardian"],
      targetMemberIds: ["member-jun"],
    },
    ...db.notices,
  ],
};

assert.deepEqual(
  notificationAlerts.getNotificationAlertCounts({ db: dbWithLegacyNotice, selectedBranchId: "branch-gangnam", user: guardian }),
  {
    actionableCount: 6,
    paymentAlertCount: 1,
    promotionAlertCount: 0,
    scopeBranchIds: ["branch-gangnam"],
    unreadNoticeCount: 5,
  },
  "guardian notification counts must treat legacy notices without read users as unread",
);
const dbAfterLegacyNoticeRead = scope.markNoticeRead(dbWithLegacyNotice, "notice-legacy-unread", guardian.id);

assert.deepEqual(
  dbAfterLegacyNoticeRead.notices.find((notice) => notice.id === "notice-legacy-unread")?.readByUserIds,
  [guardian.id],
  "notice read persistence must initialize missing legacy read user lists",
);
assert.equal(
  notices.hasSameNoticeAudience(["member", "member"], ["member", "all"]),
  false,
  "legacy duplicate notice audiences must not hide a coach audience expansion",
);
assert.equal(
  notices.hasSameNoticeAudience(["guardian", "member", "guardian"], ["member", "guardian"]),
  true,
  "notice audience comparison must ignore ordering and duplicate entries",
);
const visibleNoticeContent = {
  audience: ["guardian"],
  body: "기존 본문",
  important: false,
  title: "기존 제목",
};
assert.equal(
  notices.hasNoticeVisibleContentChanged(visibleNoticeContent, { ...visibleNoticeContent }),
  false,
  "idempotent notice updates must not reset read state",
);
for (const [label, next] of [
  ["title", { ...visibleNoticeContent, title: "수정 제목" }],
  ["body", { ...visibleNoticeContent, body: "수정 본문" }],
  ["important", { ...visibleNoticeContent, important: true }],
  ["audience", { ...visibleNoticeContent, audience: ["member", "guardian"] }],
]) {
  assert.equal(
    notices.hasNoticeVisibleContentChanged(visibleNoticeContent, next),
    true,
    `notice ${label} changes must reset read state`,
  );
}
assert.deepEqual(
  notificationAlerts.getNotificationAlertCounts({ db, selectedBranchId: "branch-gangnam", user: coach }),
  {
    actionableCount: 3,
    paymentAlertCount: 0,
    promotionAlertCount: 0,
    scopeBranchIds: ["branch-gangnam"],
    unreadNoticeCount: 3,
  },
  "coach notification counts must exclude payment alerts",
);
assert.equal(
  notificationAlerts.formatNotificationActionableLabel(
    notificationAlerts.getNotificationAlertCounts({ db, selectedBranchId: "branch-gangnam", user: coach }),
  ),
  "미확인 공지 3건",
  "coach notification label must not mention payment follow-ups",
);
assert.deepEqual(
  notificationAlerts.getNotificationAlertCounts({ db, selectedBranchId: null, user: owner }),
  {
    actionableCount: 9,
    paymentAlertCount: 3,
    promotionAlertCount: 0,
    scopeBranchIds: ["branch-gangnam"],
    unreadNoticeCount: 6,
  },
  "owner notification counts must stay scoped to assigned branches",
);

const promotionExamSoon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const promotionExamFar = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
assert.equal(
  notificationAlerts.isUpcomingPromotionExam("2026-07-14", "scheduled", new Date("2026-07-15T12:00:00+09:00")),
  false,
  "past scheduled promotion exams must not remain in imminent notifications",
);
assert.equal(
  notificationAlerts.isUpcomingPromotionExam("2026-07-15", "scheduled", new Date("2026-07-15T12:00:00+09:00")),
  true,
  "today's scheduled promotion exam must remain visible for the full local day",
);
assert.equal(promotions.isSchedulablePromotionExamDate("2026-07-14", "2026-07-15"), false, "past promotion dates must be rejected");
assert.equal(promotions.isSchedulablePromotionExamDate("2026-07-15", "2026-07-15"), true, "today's promotion date must be allowed");
assert.equal(promotions.isSchedulablePromotionExamDate("2026-07-31", "2026-07-15"), true, "future promotion dates must be allowed");
assert.equal(promotions.isSchedulablePromotionExamDate("2026-02-30", "2026-02-01"), false, "impossible promotion dates must be rejected");
assert.equal(promotions.isSchedulablePromotionExamDate("tomorrow", "2026-07-15"), false, "non-date promotion values must be rejected");
assert(
  classesScreenSource.includes("otherDateCoachSessions") &&
    classesScreenSource.includes("formatDateKey(session.startsAt) === todayDateKey") &&
    classesScreenSource.includes("previousNote") &&
    classesScreenSource.includes('member.ageGroup !== "adult"'),
  "coach attendance UI must limit editing to today's sessions, restore notes on undo, and label adult follow-up correctly",
);
assert(
  classesScreenSource.includes('data-testid="class-create-schedule-mode"') &&
    classesScreenSource.includes('data-testid="class-create-weekdays"') &&
    classesScreenSource.includes("finalMainClassTimeOptions") &&
    classesScreenSource.includes("recurringClassCount") &&
    classesScreenSource.includes('{ value: "all", label: "무관 (모두 가능)" }'),
  "class creation UI must expose all-age, single, and fixed-weekday modes with timetable slots and an occurrence count",
);
assert(
  classesScreenSource.includes("FamilyClassCalendar") &&
    classesScreenSource.includes("selectedFamilyMemberIdSet") &&
    familyClassCalendarSource.includes('data-family-calendar-state={state}') &&
    familyClassCalendarSource.includes('label: "출석"') &&
    familyClassCalendarSource.includes('label: "결석"') &&
    familyClassCalendarSource.includes('label: "미기록"'),
  "family class UI must scope one family member and expose scheduled, attended, absent, and unrecorded calendar dates",
);
assert(
  paymentCheckoutScreenSource.includes("confirmedInputFingerprint") &&
    paymentCheckoutScreenSource.includes('data-confirmation-state={confirmationIsCurrent ? "current" : "changed"}') &&
    paymentCheckoutScreenSource.includes("handleWooriPayTabKeyDown"),
  "payment confirmation must become stale after edits and Woori tabs must support keyboard navigation",
);
assert(
  notificationOutboxRunnerSource.includes("createNoticeDeepLink") &&
    notificationOutboxRunnerSource.includes('params.set("memberId", matchingMemberIds[0])') &&
    notificationOutboxRunnerSource.includes("matchingMemberIds.length === 1"),
  "notice push links must include a uniquely resolved family member context without guessing among multiple children",
);
assert(
  !mockApiSource.includes("notices: scopedNotices(context).slice(0, 3)") && mockApiSource.includes("notices: scopedNotices(context)"),
  "dashboard unread notice totals must use the full scoped notice set",
);
const dbWithPromotions = {
  ...db,
  promotions: [
    {
      id: "promotion-jun-soon",
      branchId: "branch-gangnam",
      memberId: "member-jun",
      fromBelt: "흰띠",
      toBelt: "노란띠",
      examDate: promotionExamSoon,
      result: "scheduled",
    },
    {
      id: "promotion-seo-far",
      branchId: "branch-gangnam",
      memberId: "member-seo",
      fromBelt: "노란띠",
      toBelt: "주황띠",
      examDate: promotionExamFar,
      result: "scheduled",
    },
    {
      id: "promotion-harin-passed",
      branchId: "branch-songpa",
      memberId: "member-harin",
      fromBelt: "흰띠",
      toBelt: "노란띠",
      examDate: promotionExamSoon,
      result: "passed",
    },
  ],
};

assert.equal(
  notificationAlerts.getNotificationAlertCounts({ db: dbWithPromotions, selectedBranchId: "branch-gangnam", user: guardian })
    .promotionAlertCount,
  1,
  "guardian promotion alerts must count only linked children with exams inside the alert window",
);
assert.equal(
  notificationAlerts.getNotificationAlertCounts({ db: dbWithPromotions, selectedBranchId: "branch-gangnam", user: coach })
    .promotionAlertCount,
  1,
  "coach promotion alerts must exclude exams outside the alert window",
);
assert.equal(
  notificationAlerts.getNotificationAlertCounts({ db: dbWithPromotions, selectedBranchId: "branch-songpa", user: songpaGuardian })
    .promotionAlertCount,
  0,
  "decided promotions must not raise promotion alerts",
);
assert.equal(
  notificationAlerts.formatNotificationActionableLabel(
    notificationAlerts.getNotificationAlertCounts({ db: dbWithPromotions, selectedBranchId: "branch-gangnam", user: coach }),
  ),
  "미확인 공지 3건, 임박 승급 심사 1건",
  "coach notification label must mention imminent promotion exams without payment follow-ups",
);
assert.equal(
  notificationAlerts.formatNotificationActionableLabel(
    notificationAlerts.getNotificationAlertCounts({ db: dbWithPromotions, selectedBranchId: "branch-gangnam", user: guardian }),
  ),
  "미확인 공지 4건, 확인 필요 결제 1건, 임박 승급 심사 1건",
  "guardian notification label must keep comma separators for assistive text when all alert types are present",
);
assert.equal(
  notificationAlerts.formatNotificationActionableLabel(
    notificationAlerts.getNotificationAlertCounts({ db: dbWithPromotions, selectedBranchId: "branch-gangnam", user: guardian }),
    " · ",
  ),
  "미확인 공지 4건 · 확인 필요 결제 1건 · 임박 승급 심사 1건",
  "notification inbox visual summary must use a consistent separator across all alert types",
);

const auditReadLog = {
  id: "audit-read-1",
  branchId: null,
  actorUserId: "user-admin",
  action: "audit_logs.read",
  targetType: "audit",
  targetId: "audit-logs",
  before: null,
  after: {
    action: "payment.create",
    branchId: "all",
    from: null,
    limit: 50,
    query: "회원권",
    reason: "변경 기록 확인",
    result: "all",
    rowCount: 1,
    to: null,
  },
  result: "success",
  message: "변경 기록을 조회했습니다.",
  createdAt: "2026-07-13T00:00:00.000Z",
};
const repeatedAuditReadLog = {
  ...auditReadLog,
  id: "audit-read-2",
  after: { ...auditReadLog.after, rowCount: 2 },
  createdAt: "2026-07-13T00:00:04.000Z",
};

assert.equal(
  auditReadDeduplication.isDuplicateAuditRead([auditReadLog], repeatedAuditReadLog),
  true,
  "identical audit reads inside the short retry window must be deduplicated even if row counts change",
);
assert.equal(
  auditReadDeduplication.isDuplicateAuditRead(
    [auditReadLog],
    { ...repeatedAuditReadLog, after: { ...repeatedAuditReadLog.after, query: "공지" } },
  ),
  false,
  "different audit read filters must stay independently traceable",
);
assert.equal(
  auditReadDeduplication.isDuplicateAuditRead(
    [auditReadLog],
    { ...repeatedAuditReadLog, after: { ...repeatedAuditReadLog.after, reason: "별도 점검" } },
  ),
  false,
  "different audit read reasons must stay independently traceable",
);
assert.equal(
  auditReadDeduplication.isDuplicateAuditRead(
    [auditReadLog],
    { ...repeatedAuditReadLog, createdAt: "2026-07-13T00:00:06.000Z" },
  ),
  false,
  "audit reads outside the retry window must create a new record",
);
assert.equal(
  auditLogQuery.parseAuditDateParam("2026-07-13", "from")?.toISOString(),
  "2026-07-12T15:00:00.000Z",
  "audit date-only from filters must start at midnight in Korea",
);
assert.equal(
  auditLogQuery.parseAuditDateParam("2026-07-13", "to")?.toISOString(),
  "2026-07-13T14:59:59.999Z",
  "audit date-only to filters must include the full selected day in Korea",
);
assert.equal(
  auditLogQuery.parseAuditDateParam("2026-02-29", "to"),
  "invalid",
  "audit date filters must reject impossible calendar dates",
);
assert.equal(
  auditLogQuery.parseAuditDateParam("2028-02-29", "to")?.toISOString(),
  "2028-02-29T14:59:59.999Z",
  "audit date filters must accept valid leap days",
);
assert.equal(
  auditLogQuery.parseAuditDateParam("2026-07-13T03:15:00.000Z", "to")?.toISOString(),
  "2026-07-13T03:15:00.000Z",
  "audit timestamp filters must preserve explicit time values",
);
assert.equal(
  auditLogQuery.isAuditDateRangeValid(
    auditLogQuery.parseAuditDateParam("2026-07-13", "from"),
    auditLogQuery.parseAuditDateParam("2026-07-13", "to"),
  ),
  true,
  "same-day audit ranges must remain valid after full-day expansion",
);
assert.equal(
  auditLogQuery.isAuditDateRangeValid(
    auditLogQuery.parseAuditDateParam("2026-07-14", "from"),
    auditLogQuery.parseAuditDateParam("2026-07-13", "to"),
  ),
  false,
  "audit ranges with a start after the end must be rejected",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "role to RBAC round-trip",
        "role navigation visibility",
        "direct route access rules",
        "member and guardian CSV export restrictions",
        "coach bootstrap payment record exclusion",
        "guardian stale adult child bootstrap exclusion",
        "coach dashboard and payment API projection exclusion",
        "branch scope selection",
        "member scope by role",
        "notice recipient targeting",
        "notice audience equality and visible edit detection",
        "user email display guard",
        "role-scoped notification alert counts",
        "per-user notice read notification counts",
        "legacy notice read list compatibility",
        "audit read retry deduplication",
        "audit date filter boundaries",
        "audit reversed date range rejection",
        "branch selection response ordering and scoped owner navigation",
        "promotion exam date lower-bound validation",
        "coach today-only attendance workflow and full undo context",
        "payment confirmation invalidation and keyboard tabs",
        "family notice push member context",
        "dashboard full notice count scope",
      ],
    },
    null,
    2,
  ),
);
