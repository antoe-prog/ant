import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const roles = await import("../src/lib/roles.ts");
const scope = await import("../src/lib/mock-api.ts");
const auditReadDeduplication = await import("../src/lib/audit-read-deduplication.ts");
const auditLogQuery = await import("../src/lib/audit-log-query.ts");
const notificationAlerts = await import("../src/lib/notification-alerts.ts");
const noticeMemberSearch = await import("../src/lib/notice-member-search.ts");
const userDisplay = await import("../src/lib/user-display.ts");
const [paymentsExportRouteSource, operationsExportRouteSource, paymentsScreenSource, serverApiSource, mockApiSource] = await Promise.all([
  readFile("src/app/api/v1/exports/payments/route.ts", "utf8"),
  readFile("src/app/api/v1/exports/operations/route.ts", "utf8"),
  readFile("src/components/screens/payments-screen.tsx", "utf8"),
  readFile("src/server/api.ts", "utf8"),
  readFile("src/lib/mock-api.ts", "utf8"),
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
  ["dashboard", "adminBranches", "adminUsers", "adminRoles", "adminAuditLogs", "adminSettings"],
  "admin mobile nav must stay focused on management routes",
);
assert.deepEqual(
  mobileRouteIdsForPath("admin", "/app/notices"),
  ["dashboard", "adminBranches", "adminUsers", "adminRoles", "adminAuditLogs", "notices"],
  "admin mobile nav must keep the current notices route visible when managing notices",
);
assert.deepEqual(
  mobileRouteIdsForPath("admin", "/app/notifications"),
  ["dashboard", "adminBranches", "adminUsers", "adminRoles", "adminAuditLogs", "notices"],
  "admin mobile nav must keep the current notification inbox route mapped to notices",
);
assert.deepEqual(
  mobileRouteIdsFor("owner"),
  ["dashboard", "members", "payments", "notices", "ownerBranches", "ownerReports"],
  "owner mobile nav must keep daily operation routes without deleted request links",
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
  serverApiSource.includes(': db.auditLogs.filter((log) => log.actorUserId === user.id);'),
  "non-owner/admin bootstrap snapshots must only include actor-authored audit logs",
);
assert(
  !serverApiSource.includes("log.actorUserId === user.id || (log.branchId !== null && branchIds.includes(log.branchId))"),
  "non-owner/admin bootstrap snapshots must not include branch-wide audit logs",
);
assert(
  serverApiSource.includes('const payments = user.role === "coach" ? [] : scopedPayments;'),
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
  mockApiSource.includes("canMemberHaveGuardianLink(member)") &&
    mockApiSource.includes("const linkedChildMemberIds = getAccessibleMemberIds(user, db, [notice.branchId]);"),
  "guardian scope helpers must reject stale adult child links for members and notices",
);
assert(
  serverApiSource.includes('safeUser.role === "guardian"') &&
    serverApiSource.includes("allowedChildMemberIds") &&
    serverApiSource.includes("safeUser.childMemberIds = (safeUser.childMemberIds ?? []).filter"),
  "guardian bootstrap user must drop stale adult child ids",
);
assert(
  serverApiSource.includes("createSafeUser(user: AppUser, db?: MockDatabase, viewerRole") &&
    serverApiSource.includes('if (viewerRole !== "admin")') &&
    serverApiSource.includes("delete safeUser.invitationToken;") &&
    serverApiSource.includes("delete safeUser.invitedAt;") &&
    serverApiSource.includes("delete safeUser.acceptedAt;") &&
    serverApiSource.includes("delete safeUser.passwordResetRequestedAt;") &&
    serverApiSource.includes("delete safeUser.passwordUpdatedAt;") &&
    serverApiSource.includes("const users = scopedUsers.map((candidate) => createSafeUser(candidate, db, user.role));") &&
    serverApiSource.includes("user: createSafeUser(user, db, user.role),"),
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
        "user email display guard",
        "role-scoped notification alert counts",
        "per-user notice read notification counts",
        "legacy notice read list compatibility",
        "audit read retry deduplication",
        "audit date filter boundaries",
        "audit reversed date range rejection",
      ],
    },
    null,
    2,
  ),
);
