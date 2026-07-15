import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const noticesScreen = readFileSync("src/components/screens/notices-screen.tsx", "utf8");
const notificationsScreen = readFileSync("src/components/screens/notifications-screen.tsx", "utf8");
const requestsScreenPath = "src/components/screens/requests-screen.tsx";
const requestsScreen = existsSync(requestsScreenPath) ? readFileSync(requestsScreenPath, "utf8") : "";
const appShell = readFileSync("src/components/shell/app-shell.tsx", "utf8");
const appStore = readFileSync("src/store/app-store.tsx", "utf8");
const notificationAlerts = readFileSync("src/lib/notification-alerts.ts", "utf8");
const roles = readFileSync("src/lib/roles.ts", "utf8");
const notificationsAliasRoute = readFileSync("src/app/(app)/app/notifications/page.tsx", "utf8");
const noticesAliasRoute = readFileSync("src/app/(app)/notices/page.tsx", "utf8");
const serviceWorker = readFileSync("public/sw.js", "utf8");
const apiClient = readFileSync("src/lib/api-client.ts", "utf8");
const domain = readFileSync("src/lib/domain.ts", "utf8");
const noticeHelpers = readFileSync("src/lib/notices.ts", "utf8");
const noticePermissions = readFileSync("src/lib/notice-permissions.ts", "utf8");
const noticeMemberSearch = readFileSync("src/lib/notice-member-search.ts", "utf8");
const paymentCheckoutAccess = readFileSync("src/lib/payment-checkout-access.ts", "utf8");
const serverDb = readFileSync("src/server/db.ts", "utf8");
const pushHelper = readFileSync("src/server/push-notifications.ts", "utf8");
const notificationOutbox = readFileSync("src/server/notification-outbox.ts", "utf8");
const notificationOutboxRunner = readFileSync("src/server/notification-outbox-runner.ts", "utf8");
const notificationOutboxCron = readFileSync("src/app/api/v1/internal/notification-outbox/route.ts", "utf8");
const pushConfigRoute = readFileSync("src/app/api/v1/notifications/push-config/route.ts", "utf8");
const pushSubscriptionRoute = readFileSync("src/app/api/v1/notifications/subscriptions/route.ts", "utf8");
const noticeCreateRoute = readFileSync("src/app/api/v1/branches/[branchId]/notices/route.ts", "utf8");
const noticeUpdateRoute = readFileSync("src/app/api/v1/branches/[branchId]/notices/[noticeId]/route.ts", "utf8");
const noticeReadRoute = readFileSync("src/app/api/v1/me/notices/[noticeId]/read/route.ts", "utf8");
const noticeBulkReadRoute = readFileSync("src/app/api/v1/me/notices/bulk-read/route.ts", "utf8");
const noticePushRoute = readFileSync("src/app/api/v1/branches/[branchId]/notices/[noticeId]/push/route.ts", "utf8");
const apiContract = readFileSync("docs/API_CONTRACT.md", "utf8");
const backendSchema = readFileSync("docs/BACKEND_DB_SCHEMA.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");
const smokeApi = readFileSync("scripts/smoke-api.mjs", "utf8");
const noticeDeleteUi = readFileSync("scripts/check-notice-delete-ui.mjs", "utf8");

assert(packageJson.scripts?.["test:notification-readiness"], "package.json must expose test:notification-readiness");
assert(releaseRunner.includes('["run", "test:notification-readiness"]'), "test:release must include notification readiness");
assert(smokeApi.includes("assertUnreadNoticeCountIncreased"), "smoke API must verify recipient unread notice count increases");
assert(
  smokeApi.includes("notice create feedback must clarify app inbox delivery"),
  "smoke API must verify publish-time delivery feedback mentions the app inbox",
);
assert(
  smokeApi.includes("unread notice count must not change"),
  "smoke API must verify non-recipients do not get notification badge count changes",
);
assert(
  smokeApi.includes("member+guardian personal notice must count both family recipients"),
  "smoke API must verify personal notices addressed to members and guardians appear in both family inboxes",
);
assert(
  smokeApi.includes("must remain unread until member confirms"),
  "smoke API must verify member and guardian notice read states are independent",
);
assert(
  smokeApi.includes("autoDispatchedOnCreate === true"),
  "smoke API must verify publish-time dispatch audit logs are written",
);
assert(
  smokeApi.includes("coach must not delete notices created by another publisher"),
  "smoke API must verify coaches cannot delete notices from another publisher",
);
assert(
  smokeApi.includes("notice delete must reject a selected branch mismatch before deletion"),
  "smoke API must verify notice deletion rejects selected branch mismatches",
);
assert(
  smokeApi.includes("notice create must reject a selected branch mismatch before validation") &&
    smokeApi.includes("selected branch mismatch must not create the notice"),
  "smoke API must verify notice creation rejects selected branch mismatches without mutation",
);
assert(
  smokeApi.includes("notice push must reject a selected branch mismatch before dispatch") &&
    smokeApi.includes("selected branch mismatch must not append a notice push dispatch audit log"),
  "smoke API must verify notice push dispatch rejects selected branch mismatches without audit mutation",
);
assert(
  smokeApi.includes("coach notice delete response must identify deleted own notice"),
  "smoke API must verify coaches can delete their own notices",
);
assert(
  noticeUpdateRoute.includes('user.role === "coach" && audienceChanged') &&
    noticeUpdateRoute.includes("visibleContentChanged ? []") &&
    noticeUpdateRoute.includes("hasSameNoticeAudience") &&
    noticeUpdateRoute.includes("hasNoticeVisibleContentChanged") &&
    noticeUpdateRoute.includes("typeof rawUpdate.important !== \"boolean\"") &&
    noticeUpdateRoute.includes('hasOwnProperty.call(rawUpdate, "targetMemberIds")') &&
    noticeUpdateRoute.includes("bodyLength: notice.body.length") &&
    !/before:\s*\{[\s\S]*?body:\s*notice\.body,/.test(noticeUpdateRoute) &&
    !/after:\s*\{[\s\S]*?body:\s*noticeBody,/.test(noticeUpdateRoute),
  "notice updates must validate input, preserve coach audience scope, reset read state on visible edits, and avoid audit body storage",
);
assert(
  noticeHelpers.includes('export const noticeStateLockKey = "notice-state"') &&
    noticeHelpers.includes("const leftSet = new Set(left)") &&
    noticeUpdateRoute.includes("withServerDbLock(noticeStateLockKey") &&
    noticeReadRoute.includes("withServerDbLock(noticeStateLockKey") &&
    noticeBulkReadRoute.includes("withServerDbLock(noticeStateLockKey"),
  "notice edit and read writes must share a lock and audience equality must normalize legacy duplicates",
);
assert(
  noticeDeleteUi.includes("visible notice edits must reset prior read state") &&
    noticeDeleteUi.includes("an idempotent notice edit must preserve the current read state") &&
    noticeDeleteUi.includes("coach notice updates must not expand the existing audience") &&
    noticeDeleteUi.includes("notice update audit must not retain the updated body") &&
    noticeDeleteUi.includes("final notice read state must match the last serialized read or visible edit operation") &&
    noticeDeleteUi.includes("notice updates must reject unsupported class/member target changes") &&
    noticeDeleteUi.includes("notice create and manual resend finalize durable pre-dispatch audit markers"),
  "notice UI/API regression proof must exercise read-state, concurrency, coach audience, target immutability, audit body, and durable dispatch contracts",
);

function assertExcludes(source, snippet, label) {
  assert(!source.includes(snippet), `${label} must not include ${snippet}`);
}

function assertOrdered(source, snippets, label) {
  let previousIndex = -1;

  for (const snippet of snippets) {
    const index = source.indexOf(snippet, previousIndex + 1);
    assert(index > previousIndex, `${label} must keep ${snippet} after the preceding persistence step`);
    previousIndex = index;
  }
}

assert(noticesScreen.includes("apiClient.dispatchNoticePush"), "notices screen must expose notice push dispatch");
assert(noticesScreen.includes("const showNoticeAside = canPublishNotice;"), "notice screen must keep publisher composer separate from removed notification settings cards");
for (const removedNoticeSettingsContract of [
  "NotificationPermissionPanel",
  'data-testid="notification-permission-panel"',
  'data-testid="notification-permission-actions"',
  'data-testid="notification-permission-status-row"',
  'aria-label="알림 권한 켜기"',
  'aria-label="알림 확인 보내기"',
  "Notification.requestPermission()",
  "registration.showNotification",
  "pushManager.subscribe",
  "apiClient.subscribeToPush",
  "apiClient.unsubscribeFromPush",
  "휴대폰 푸시 연결을 마치면 공지를 받을 수 있습니다.",
  "이 기기에서는 알림 설정이 제한됩니다.",
]) {
  assertExcludes(noticesScreen, removedNoticeSettingsContract, "notices screen removed notification settings card contract");
}
assert(apiClient.includes("getPushConfig()"), "api client must keep push config API access for platform handoff");
assert(apiClient.includes("subscribeToPush(subscription: PushSubscriptionJSON"), "api client must keep push subscription API access");
assert(apiClient.includes("unsubscribeFromPush(endpoint: string)"), "api client must keep push unsubscribe API access");
assert(apiClient.includes("dispatchNoticePush(branchId: string"), "api client must keep notice push dispatch API access");
assertExcludes(noticesScreen, "이 기기에서는 알림을 받을 수 없습니다.", "notification panel unsupported-device hard failure copy");
assertExcludes(noticesScreen, "공지 알림은 준비 중입니다.", "notification panel app UI copy");
assertExcludes(noticesScreen, "이 브라우저에서는 알림을 사용할 수 없습니다.", "notification panel app UI copy");
assertExcludes(noticesScreen, "공지 알림을 아직 사용할 수 없습니다.", "notification panel app UI copy");
assertExcludes(noticesScreen, "공지 알림 수신 준비가 확인되었습니다.", "notification panel app UI copy");
assertExcludes(noticesScreen, "알림 발송 설정", "notices screen unclear notification setup copy");
assertExcludes(noticesScreen, "브라우저 권한", "notification panel app UI copy");
assertExcludes(noticesScreen, "푸시 알림 키", "notification panel app UI copy");
assertExcludes(noticesScreen, "서버 푸시", "notification panel app UI copy");
assertExcludes(noticesScreen, "VAPID 공개키/비밀키", "notification panel app UI copy");
for (const removedNoticeStatusCopy of ["알림 꺼짐", "차단됨", "기기 확인", "설정 필요", "수신 가능", "수신 중"]) {
  assertExcludes(noticesScreen, removedNoticeStatusCopy, "notices screen removed notification settings status chips");
}
assert(noticesScreen.includes("noticeImportant"), "notices screen must support important notice publishing");
assert(noticesScreen.includes("중요 공지"), "notices screen must expose important notice control");
assert(noticesScreen.includes("중요"), "notices screen must render important notice badges");
assert(noticesScreen.includes("NoticeFilter"), "notices screen must define notice list filter state");
assert(noticesScreen.includes("notice-filter-unread"), "notices screen must expose an unread notice filter control");
assert(noticesScreen.includes("notice-filter-important"), "notices screen must expose an important notice filter control");
assert(noticesScreen.includes("notice-bulk-read-filtered"), "notices screen must expose a filtered bulk read control");
assert(noticesScreen.includes('data-testid="notice-list-search-input"'), "operator notice inbox must expose a title/body search input");
assert(noticesScreen.includes('data-testid="notice-list-search-clear"'), "operator notice inbox must expose a search clear action");
assert(noticesScreen.includes('data-testid="notice-list-search-empty-clear"'), "operator notice inbox must expose a no-result search clear action");
assert(noticesScreen.includes('data-testid="notice-list-status-label"'), "operator notice inbox must expose filtered count status");
assert(noticesScreen.includes("검색 결과가 없습니다"), "operator notice inbox must explain no-result searches");
assert(noticesScreen.includes("noticeSearchKeyword"), "operator notice inbox must filter notices by title/body search text");
assert(noticesScreen.includes('data-testid="family-notice-filter-grid"'), "family notice toolbar must use a fixed grid instead of a clipped scroll row");
assert(noticesScreen.includes('data-testid="family-notice-detail-toggle"'), "family notice long body must expand from the content area");
assertExcludes(noticesScreen, '{bodyExpanded ? "접기" : "자세히"}', "family notice screen must not restore repeated 자세히 row buttons");
assert(noticesScreen.includes("markNoticesAsRead"), "notices screen must call the bulk read store action");
assert(
  noticesScreen.includes("noticePublisherRoles.has(context.user.role)") &&
    noticePermissions.includes('export const noticePublisherRoles = new Set<UserRole>(["owner", "admin", "coach"]);'),
  "coach notices must allow scoped publishing roles",
);
assert(noticesScreen.includes('useState<NoticeAudience[]>(["member", "guardian"])'), "notice composer must default to member and guardian recipients");
assert(noticesScreen.includes("setNoticeFeedback(result.message)"), "notice composer must show the publish-time delivery result from the server");
assert(
  /data-testid="notice-create-feedback"[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(noticesScreen),
  "notice composer delivery feedback must stay announced as a polite status message",
);
assert(
  /function clearNoticeFeedback\(\)[\s\S]*setNoticeFeedback\(null\);[\s\S]*setDeleteFeedback\(null\);[\s\S]*setPushFeedback\(null\);[\s\S]*setReadFeedback\(null\);/.test(
    noticesScreen,
  ),
  "notice composer and notice actions must share stale feedback cleanup",
);
assert(
  noticesScreen.includes('setNoticeFeedback("제목, 내용, 대상 정보를 확인해 주세요.");'),
  "notice composer must explain incomplete publish forms through the status feedback",
);
assert(noticesScreen.includes('context.user.role === "coach" ? "담당 회원 전체" : "지점 전체"'), "coach branch target copy must describe assigned members");
assert(noticesScreen.includes("noticeMemberSearch"), "notice composer must search personal target members instead of relying on a long select");
assert(noticesScreen.includes("normalizeNoticeMemberSearchText"), "notice composer must normalize personal target member search input");
assert(noticeMemberSearch.includes('normalize("NFKC")'), "notice composer member search must normalize full-width and composed text");
assert(noticeMemberSearch.includes("[^\\p{L}\\p{N}]+"), "notice composer member search must ignore spaces, hyphens, and punctuation");
assert(noticeMemberSearch.includes("getHangulInitialSearchText"), "notice composer member search must support Korean initial consonant queries");
assert(noticeMemberSearch.includes("HANGUL_INITIAL_CONSONANTS"), "notice composer member search must keep a Hangul initial search key");
assert(noticeMemberSearch.includes("matchesNoticeMemberSearch"), "notice composer must centralize member search matching");
assert(noticesScreen.includes('data-testid="notice-create-member-search-input"'), "notice composer must expose a member search input for personal targets");
assert(noticesScreen.includes('data-testid="notice-create-member-result"'), "notice composer must render selectable member search results");
assert(noticesScreen.includes('data-testid="notice-create-selected-member"'), "notice composer must show the explicitly selected personal target");
assert(noticesScreen.includes('aria-label="공지 대상 회원 검색 결과"'), "notice composer member search results must have an accessible label");
assert(noticesScreen.includes("showNoticeMemberSearchResults"), "notice composer must collapse member search results after a member is selected");
assert(noticesScreen.includes('(noticeTargetType === "member" && !selectedNoticeMember)'), "notice composer must require an explicit searched member selection");
assert(noticesScreen.includes("handleNoticeMemberSearchChange"), "notice composer must centralize member search changes");
assert(noticesScreen.includes('value.trim() !== selectedNoticeMember.name'), "notice composer must clear stale personal target selections when search text changes");
assert(noticesScreen.includes("getInitialNoticeComposerState"), "notice composer must support deep-linked initial compose state");
assert(noticesScreen.includes("noticeCompose"), "notice composer must open from a deep link when requested");
assert(noticesScreen.includes("noticeTargetMemberId"), "notice composer must support a deep-linked personal target member");
assertExcludes(noticesScreen, 'data-testid="notice-create-member-select"', "notice composer removed personal target scroll select");
assertExcludes(noticesScreen, "noticeTargetMembers[0]?.id", "notice composer personal target fallback");
assert(noticesScreen.includes("const showNoticeDeliveryMeta = canPublishNotice;"), "notice delivery metadata must stay limited to publishing roles");
assert(noticesScreen.includes('<SectionHeader title="공지" />'), "all notice roles must keep a stable page heading");
for (const removedNoticeCardContract of [
  'data-testid="notice-action-queue"',
  'data-testid="p2-notice-follow-up-board"',
  "noticeActionQueue",
  "showNoticeOperations",
  "공지 후속 조치 큐",
  "공지/알림 요약",
  "대상별 후속 조치",
  "수신 상태",
  "알림 상태 확인",
  "푸시 미구성/실패 사유",
  "실기기 확인 필요",
  "알림 키 미설정",
  "운영 푸시 provider handoff는 P1 blocker",
  "운영 푸시 ready",
]) {
  assertExcludes(noticesScreen, removedNoticeCardContract, "notices screen removed operation cards");
}
assert(noticesScreen.includes("aria-pressed={noticeFilter === option.value}"), "notice filters must expose pressed state");
assert(noticesScreen.includes("filteredNotices.length"), "notices screen must show filtered notice counts");
assert(noticesScreen.includes("filteredUnreadNoticeIds.length"), "notices screen must show filtered unread counts");
assert(noticesScreen.includes("선택한 보기의 공지가 없습니다"), "notices screen must show a filtered empty state");
assert(!existsSync(requestsScreenPath), "deleted requests screen file must not be restored");
assertExcludes(requestsScreen, "noticeImportant", "requests screen notice composer");
assertExcludes(requestsScreen, "중요 공지", "requests screen notice composer");
assertExcludes(requestsScreen, "notice.important", "requests screen notice badges");
assertExcludes(requestsScreen, "apiClient.getNotices(context)", "requests screen notice data fetch");
assertExcludes(requestsScreen, "공지함", "requests screen embedded notice inbox");
assertExcludes(requestsScreen, "공지 작성", "requests screen notice authoring");
assertExcludes(requestsScreen, "markNoticeAsRead", "requests screen notice read actions");
assert(roles.includes('id: "notices"'), "roles must define a dedicated notices route");
assert(roles.includes('href: "/app/notices"'), "roles must link dedicated notices route");
assert(roles.includes('label: "공지"'), "notices route must use the dedicated notices label");
assert(roles.includes('description: "공지 목록과 읽음 상태"'), "notices route must describe the dedicated notices screen");
assert(roles.includes('roles: ["member", "guardian", "coach", "owner", "admin"]'), "notices route must be visible in app navigation");
assert(noticeHelpers.includes("sortNoticesForDisplay"), "notice display helper must sort important notices first");
assert(notificationsScreen.includes('data-testid="notifications-screen"'), "notifications route must render a dedicated notification inbox");
for (const removedNotificationSettingsContract of [
  "NotificationPermissionPanel",
  "showNotificationSettings",
  "notification-settings-jump",
  'href="#notification-permission-panel"',
  "알림 발송 설정",
]) {
  assertExcludes(notificationsScreen, removedNotificationSettingsContract, "notification inbox removed settings cards");
}
assert(notificationsScreen.includes("apiClient.getNotices(context)"), "notification inbox must load scoped notices");
assert(notificationsScreen.includes("apiClient.getPayments(context)"), "notification inbox must include payment alerts without a new API");
assert(notificationsScreen.includes("canShowPaymentNotificationForRole(context.user.role)"), "notification inbox must hide payment alerts from coach role");
assert(notificationsScreen.includes("isPaymentNotificationCandidate(payment)"), "notification inbox must use the shared payment alert predicate");
assert(notificationsScreen.includes("getFamilyPaymentCheckoutAccess"), "notification inbox payment alerts must reuse family checkout access rules");
assert(notificationsScreen.includes("paymentNotificationTarget"), "notification inbox payment alerts must choose a role-safe payment target");
assert(notificationsScreen.includes("/app/payments/checkout?paymentId="), "notification inbox must deep-link payable family payment alerts to checkout preparation");
assert(notificationsScreen.includes('actionLabel: checkoutAccess.label'), "notification inbox payment alerts must reuse checkout action copy for payable family users");
assert(notificationsScreen.includes("납부 요청 필요"), "notification inbox pending payment copy must ask for a payment request");
assert(notificationsScreen.includes("납부 확인"), "notification inbox fallback payment action must use payment confirmation copy");
assert(paymentCheckoutAccess.includes('label: payment.onlinePayment?.status === "pending" ? "납부 확인 중" : "납부 요청"'), "payable family checkout action must use request copy before provider integration");
assertExcludes(paymentCheckoutAccess, "결제하기", "family checkout live-payment action copy");
assertExcludes(notificationsScreen, "결제 진행 필요", "notification inbox live-payment implication copy");
assertExcludes(notificationsScreen, "apiClient.getRequests(context)", "notification inbox request alert fetch");
assertExcludes(notificationsScreen, "isRequestNotificationCandidate(request)", "notification inbox request alert predicate");
assertExcludes(notificationsScreen, "requestNotificationTarget", "notification inbox request target builder");
assertExcludes(notificationsScreen, "buildRequestNotification", "notification inbox request card builder");
assertExcludes(notificationsScreen, "/app/requests", "notification inbox request deep links");
assert(notificationsScreen.includes("data-notification-action-label={item.actionLabel}"), "notification inbox must expose action labels for visible regressions");
assert(notificationsScreen.includes("notification-filter-unread"), "notification inbox must expose an unread filter");
assert(notificationsScreen.includes("notification-filter-important"), "notification inbox must expose an important filter");
assert(notificationsScreen.includes('ariaLabel: "공지 미확인"'), "notification inbox unread filter must expose notice-only scope to assistive tech");
assert(notificationsScreen.includes('label: "미확인"'), "notification inbox unread filter must use compact visible copy");
assertExcludes(notificationsScreen, 'label: "공지 미확인"', "notification inbox repeated unread filter copy");
assert(notificationsScreen.includes('item.kind === "notice" && !item.read'), "notification inbox unread filter must only count unread notices");
assert(notificationsScreen.includes("notification-bulk-read-filtered"), "notification inbox must expose a filtered read action");
assert(notificationsScreen.includes("notificationBulkReadAriaLabel"), "notification inbox bulk read action must explain notice-only scope");
assert(notificationsScreen.includes("읽음 처리"), "notification inbox bulk read action must use compact visible copy");
assert(notificationsScreen.includes("읽음 완료"), "notification inbox bulk read action must show done copy when no unread notices remain");
assert(notificationsScreen.includes("data-notification-bulk-read-state"), "notification inbox bulk read action must expose active/done state for regression checks");
assertExcludes(notificationsScreen, "공지 읽음 처리", "notification inbox repeated bulk read copy");
assert(notificationsScreen.includes('data-testid="notification-filter-toolbar"'), "notification inbox must expose a flat filter toolbar");
assert(notificationsScreen.includes("flex min-w-0 flex-wrap gap-1.5"), "notification inbox filters must wrap as a flat toolbar");
assertExcludes(
  notificationsScreen,
  'className="min-w-0 rounded-md border border-zinc-200 bg-white p-0.5"',
  "notification inbox nested filter card frame",
);
assert(notificationsScreen.includes("공지 읽음 상태를 저장하지 못했습니다."), "notification inbox bulk read failure copy must stay notice-scoped");
assert(notificationsScreen.includes("markNoticesAsRead"), "notification inbox must persist notice read state");
assert(appStore.includes("markNoticeAsRead: (noticeId: string) => Promise<boolean>"), "single notice read action must report persistence success");
assert(appStore.includes("return true;") && appStore.includes("return false;"), "single notice read action must return success and failure results");
assert(notificationsScreen.includes("notification-inbox-card"), "notification inbox must render notification cards");
assert(notificationsScreen.includes('data-notification-read-state={readNotice ? "read" : "active"}'), "notification inbox must mark confirmed notice cards for tone-down styling");
assert(notificationsScreen.includes("const importantBadgeClass = readNotice"), "notification inbox must tone down important badges after notice confirmation");
assert(notificationsScreen.includes("const readStateBadgeClass = item.read"), "notification inbox must tone down confirmed state badges");
assert(notificationsScreen.includes("border-zinc-200 bg-zinc-50 text-zinc-500"), "notification inbox confirmed badges must use muted zinc styling");
assert(notificationsScreen.includes("deleteNotice, markNoticeAsRead"), "notification inbox must use the shared notice delete store action");
assert(notificationsScreen.includes("const canManageNoticeNotifications"), "notification inbox must gate notice deletion to publisher roles");
assert(
  notificationsScreen.includes("noticeCanDelete: canDeleteNotice(context.user, context.db, notice)") &&
    notificationsScreen.includes("item.noticeCanDelete === true"),
  "notification inbox coach deletion must reuse the shared notice delete permission helper",
);
assert(
  noticePermissions.includes("export function canDeleteNotice") &&
    noticePermissions.includes("canReadNotice(user, db, notice)") &&
    noticePermissions.includes("notice.createdByUserId === user.id"),
  "notice delete permission helper must keep coach deletion limited to readable own notices",
);
assert(notificationsScreen.includes('data-testid="notification-notice-delete-action"'), "notification inbox must expose a notice delete action for publishers");
assert(
  /data-testid="notification-notice-delete-action"[\s\S]*<Trash2 className="h-4 w-4" aria-hidden \/>[\s\S]*삭제[\s\S]*<\/button>/.test(
    notificationsScreen,
  ),
  "notification inbox notice delete action must keep a visible delete label",
);
assert(notificationsScreen.includes('data-testid="notification-notice-delete-confirm"'), "notification inbox must confirm notice deletion before deleting");
assert(notificationsScreen.includes('data-testid="notification-notice-delete-confirm-action"'), "notification inbox must expose the confirmed notice delete action");
assert(notificationsScreen.includes('data-testid="notification-delete-feedback"'), "notification inbox must keep notice delete feedback visible");
assertExcludes(notificationsScreen, "notification-summary-card", "notification inbox duplicate summary cards");
assertExcludes(notificationsScreen, "notification-summary-grid", "notification inbox duplicate summary grid");
assertExcludes(notificationsScreen, "읽음 처리 필요", "notification inbox duplicate unread summary helper");
assertExcludes(notificationsScreen, "먼저 볼 항목", "notification inbox duplicate important summary helper");
assertExcludes(notificationsScreen, "결제/요청", "notification inbox duplicate follow-up summary helper");
assert(notificationsScreen.includes("notification-follow-up-state-badge"), "notification inbox must render follow-up states as badges");
assert(notificationsScreen.includes("getNotificationAlertCounts"), "notification inbox must reuse shared actionable notification counts");
assert(notificationsScreen.includes("formatNotificationActionableLabel(notificationCounts"), "notification inbox must reuse shared actionable notification label copy");
assert(
  notificationsScreen.includes('formatNotificationActionableLabel(notificationCounts, " · ")'),
  "notification inbox visual summary must pass a consistent middle-dot separator to the shared label helper",
);
assert(notificationsScreen.includes('data-testid="notification-actionable-count-summary"'), "notification inbox must explain unread notice and follow-up counts without adding cards");
assert(notificationsScreen.includes("미확인 공지"), "notification inbox count summary must keep notice-unread copy compact");
assert(notificationAlerts.includes("확인 필요 결제"), "notification inbox count summary must distinguish actionable payment follow-ups through shared copy");
assertExcludes(notificationsScreen, 'inline-flex min-h-11 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-700', "notification inbox non-action status must not look like a touch button");
assert(notificationsScreen.includes("notification-read-action"), "notification inbox must expose single notice read actions");
assert(notificationsScreen.includes("readNoticePendingId"), "notification inbox single read action must expose pending state");
assert(notificationsScreen.includes("handleMarkNotificationAsRead"), "notification inbox single read action must use an awaitable handler");
assert(notificationsScreen.includes("공지 확인을 저장했습니다."), "notification inbox single read action must show saved feedback");
assert(notificationsScreen.includes("공지 확인 상태를 저장하지 못했습니다."), "notification inbox single read action must show failure feedback");
assert(notificationsScreen.includes('data-testid="notification-read-feedback"'), "notification inbox single read action must expose live feedback for regression checks");
assert(
  /data-testid="notification-read-feedback"[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(notificationsScreen),
  "notification inbox read feedback must stay announced as a polite status message",
);
assert(notificationsScreen.includes('readPending ? "저장 중" : "확인"'), "notification inbox single read action must show a pending label");
assert(notificationsScreen.includes("data-notification-kind"), "notification inbox must distinguish notice and payment alerts");
assert(noticesScreen.includes("const noticeReadTone = read ?"), "notice screen must tone down read notice cards");
assert(noticesScreen.includes('data-notice-read-state={read ? "read" : "active"}'), "notice screen must expose read notice tone state");
assert(noticesScreen.includes("const noticeReadStateBadgeClass = read"), "notice screen read-state badges must use muted styling after read");
assert(notificationsScreen.includes('href: "/app/payments"'), "notification inbox must deep-link payment alerts");
assert(appShell.includes("getNotificationAlertCounts"), "app shell notification badges must use shared role-scoped notification counts");
assert(notificationAlerts.includes("getNotificationScopeBranchIds"), "shared notification alerts must centralize selected branch scoping");
assert(notificationAlerts.includes("canReadNotice(user, db, notice, scopeBranchIds)"), "shared notification alerts must reuse the notice recipient/scope guard");
assert(notificationAlerts.includes("getAccessibleMemberIds(user, db, scopeBranchIds)"), "shared notification alerts must reuse role member scope");
assert(notificationAlerts.includes("unreadNoticeCount"), "shared notification alerts must calculate unread notice count");
assert(notificationAlerts.includes("paymentAlertCount"), "shared notification alerts must include scoped payment alerts");
assert(notificationAlerts.includes("formatNotificationActionableLabel"), "shared notification alerts must expose a count label helper");
assert(notificationAlerts.includes('separator = ", "'), "shared notification label helper must keep the comma separator as its accessible default");
assert(notificationAlerts.includes("확인 필요 결제"), "shared notification label must name payment follow-ups explicitly");
assertExcludes(appShell, "requestAlertCount", "app shell scoped request alerts in notification badge");
assertExcludes(appShell, "isRequestNotificationCandidate", "app shell request alert predicate");
assert(notificationAlerts.includes("canShowPaymentNotificationForRole(user.role)"), "shared notification alerts must not count payment alerts for coach role");
assert(appShell.includes("notificationAlertCount"), "app shell must calculate total actionable notification count");
assert(appShell.includes("notice-unread-badge"), "app shell must render a visible unread notice badge");
assert(appShell.includes("notificationActionableLabel"), "top notification action must expose typed actionable notification counts to assistive tech");
assert(appShell.includes("data-unread-notice-count"), "notification badge must expose unread notice count for regression checks");
assert(appShell.includes("data-payment-alert-count"), "notification badge must expose payment alert count for regression checks");
assert(appShell.includes('href="/app/notifications"'), "top notification action must open the dedicated notification inbox");
assert(!appShell.includes('route.id === "requests" && hasNotificationAlerts'), "requests navigation must not duplicate notification alert state");
assert(notificationAlerts.includes('return role !== "coach";'), "shared notification alert policy must hide payment alerts from coaches");
assert(notificationAlerts.includes('payment.status === "overdue"'), "shared notification alert policy must include overdue payments");
assert(notificationAlerts.includes('payment.status === "expiringSoon"'), "shared notification alert policy must include expiring payments");
assert(notificationAlerts.includes('payment.onlinePayment?.status === "pending"'), "shared notification alert policy must include pending checkout payments");
assertExcludes(notificationAlerts, "isRequestNotificationCandidate", "shared notification alert policy deleted request alerts");
assertExcludes(notificationAlerts, 'request.status === "pending"', "shared notification alert policy pending request alerts");
assert(notificationsAliasRoute.includes("NotificationsScreen"), "notifications route must render the dedicated notification inbox");
assert(noticesAliasRoute.includes('redirect("/app/notices")'), "legacy root notices route must redirect to the dedicated notices menu");
assert(roles.includes('aliases: ["/app/notifications"]'), "notices route must own the legacy notifications alias");
assert(roles.includes("isRouteActive"), "route helper must keep aliases active in app navigation");
assert(appShell.includes("isRouteActive(route, pathname)"), "app shell must use route aliases for active navigation state");
assert(
  roles.includes('coach: ["dashboard", "classes", "members", "promotions", "notices"]'),
  "coach mobile nav must remove deleted makeup request actions",
);
assert(
  roles.includes('guardian: ["dashboard", "classes", "members", "payments", "tournaments"]'),
  "guardian mobile nav must remove deleted makeup request actions",
);
assert(
  roles.includes('member: ["dashboard", "classes", "members", "payments", "tournaments"]'),
  "member mobile nav must remove deleted makeup request actions",
);
assertExcludes(roles, 'id: "requests"', "roles deleted makeup request route");

assert(domain.includes("PushSubscriptionRecord"), "domain must define push subscription records");
assert(domain.includes("important?: boolean"), "domain must define important notice flag");
assert(domain.includes("createdByUserId?: string"), "domain must keep notice creator visibility metadata");
assert(domain.includes("notification.subscribe"), "audit actions must include push subscribe");
assert(domain.includes("notification.dispatch"), "audit actions must include push dispatch");
assert(serverDb.includes('"pushSubscriptions"'), "runtime DB must require pushSubscriptions collection");

assert(packageJson.dependencies?.["web-push"], "package.json must include web-push");
assert(apiClient.includes("getPushConfig"), "api client must expose push config lookup");
assert(apiClient.includes("subscribeToPush"), "api client must expose push subscribe");
assert(apiClient.includes("unsubscribeFromPush"), "api client must expose push unsubscribe");
assert(apiClient.includes("dispatchNoticePush"), "api client must expose notice push dispatch");
assert(apiClient.includes("markNoticesAsRead"), "api client must expose filtered notice bulk read");
assert(apiClient.includes("important?: boolean"), "api client must accept important notice publishing");
assert(apiClient.includes("recipientCount: number"), "api client must expose app inbox recipient count for notice dispatch feedback");
assert(apiClient.includes("NoticeCreateResponsePayload"), "api client must type notice create responses with delivery feedback");
assert(apiClient.includes("NoticeDispatchSummaryPayload"), "api client must share notice dispatch summary typing");

assert(pushHelper.includes("FINAL_JUDO_VAPID_PUBLIC_KEY"), "push helper must read VAPID public key");
assert(pushHelper.includes("FINAL_JUDO_VAPID_PRIVATE_KEY"), "push helper must read VAPID private key");
assert(pushHelper.includes("FINAL_JUDO_VAPID_SUBJECT"), "push helper must read VAPID subject from env");
assert(!pushHelper.includes("ops@finaljudo.test"), "push helper must not use a sample mailto subject fallback");
assert(pushHelper.includes("webPush.sendNotification"), "push helper must send web push notifications");
assert(pushHelper.includes("statusCode === 404 || statusCode === 410"), "push helper must disable expired subscriptions");
assert(notificationOutbox.includes("[중요]"), "outbox payload snapshot must mark important notice push titles");
assert(pushHelper.includes("export function getNoticeRecipients"), "push helper must expose notice recipients for dispatch feedback");
assert(pushHelper.includes("export function getNoticeFamilyRecipientCount"), "push helper must expose member and guardian recipient counts");
assert(pushHelper.includes("export function createNoticePushDispatchMessage"), "push helper must centralize user-facing dispatch result copy");
assert(pushHelper.includes("getVisibleActivePushSubscriptionCount"), "push helper must scope visible active subscription counts by role");
assert(pushConfigRoute.includes("currentUserSubscribed"), "push config route must expose current user subscription state");
assert(
  pushConfigRoute.includes("getVisibleActivePushSubscriptionCount(db, user)"),
  "push config route must not expose global active subscription counts",
);
assert(pushSubscriptionRoute.includes("normalizePushSubscription"), "push subscription route must validate subscription shape");
assert(pushSubscriptionRoute.includes("notification.subscribe"), "push subscription route must audit subscribe");
assert(pushSubscriptionRoute.includes("notification.unsubscribe"), "push subscription route must audit unsubscribe");
assert(
  pushSubscriptionRoute.includes("getVisibleActivePushSubscriptionCount(nextDb, user)"),
  "push subscription route must return role-scoped active subscription counts",
);
assert(pushSubscriptionRoute.includes("familyNotificationAlwaysOnRoles"), "push subscription route must keep family notifications always on");
assert(pushSubscriptionRoute.includes("family_notification_always_on"), "push subscription route must audit family notification always-on policy");
assert(pushSubscriptionRoute.includes("enforcedAlwaysOn: true"), "push subscription route must tell clients family notifications stayed on");
assert(
  pushSubscriptionRoute.includes("회원/학부모 알림 수신은 항상 켜짐으로 유지했습니다."),
  "push subscription route must use user-facing family always-on copy",
);
assert(noticeCreateRoute.includes("important"), "notice create route must persist important flag");
assert(
  noticeCreateRoute.includes("noticePublisherRoles.has(user.role)") &&
    noticePermissions.includes('export const noticePublisherRoles = new Set<UserRole>(["owner", "admin", "coach"]);'),
  "notice create route must allow admin owner and scoped coach publishers",
);
assert(
  noticeCreateRoute.includes("selectedScope.selectedBranchId !== branchId"),
  "notice create route must reject selected branch mismatches before reading the request body",
);
assert(noticeCreateRoute.includes("getAccessibleMemberIds(user, db, [branchId])"), "notice create route must scope coach branch notices to assigned members");
assert(noticeCreateRoute.includes("createdByUserId: user.id"), "notice create route must persist creator visibility metadata");
assert(noticeCreateRoute.includes("담당 수업과 담당 회원에게만 공지를 발행할 수 있습니다."), "notice create route must reject out-of-scope coach targets");
assert(
  noticeCreateRoute.includes("withServerDbLock(noticeStateLockKey") &&
    noticePushRoute.includes("withServerDbLock(noticeStateLockKey"),
  "notice create and manual dispatch must share the serialized notice-state persistence boundary",
);
assertOrdered(
  noticeCreateRoute,
  [
    "notices: [nextNotice, ...db.notices]",
    "const dispatchRequestAuditLog = createNoticePushDispatchRequestAuditLog",
    "prepareNoticePushDispatchJobs(dbWithAudits, nextNotice",
    "await writeServerDb(prepared.db)",
    "await processNotificationOutbox",
  ],
  "notice create outbox dispatch",
);
assertOrdered(
  noticePushRoute,
  [
    "const baseDispatchRequestAuditLog = createNoticePushDispatchRequestAuditLog",
    "const dispatchRequestAuditLog = {",
    "idempotencyDigest: idempotency.digest",
    "prepareNoticePushDispatchJobs(dbWithAudit, notice",
    "await writeServerDb(prepared.db)",
    "await processNotificationOutbox",
  ],
  "manual notice outbox dispatch",
);
assert(
  pushHelper.includes('dispatchState: "requested"') &&
    notificationOutbox.includes("syncDispatchAudit") &&
    notificationOutbox.includes('"retry_scheduled"') &&
    notificationOutbox.includes('"dead"'),
  "notice dispatch must retain a durable requested marker and retry/dead states",
);
assert(!noticeCreateRoute.includes("dispatchNoticePushNotifications"), "notice create route must not send before durable outbox persistence");
assertExcludes(noticeCreateRoute, "PUSH_DISPATCH_FAILED", "notice create response after durable persistence");
assertExcludes(noticeCreateRoute, "PUSH_RESULT_PERSIST_FAILED", "notice create response after durable persistence");
assert(
  noticeCreateRoute.includes("The durable jobs remain pending or leased for the scheduled worker"),
  "notice creation must preserve queued work after an inline delivery failure",
);
assert(
  noticeCreateRoute.includes("createNoticePushDispatchRequestAuditLog") &&
    pushHelper.includes('action: "notification.dispatch"'),
  "notice create route must audit publish-time notification dispatch",
);
assert(noticeCreateRoute.includes("autoDispatchedOnCreate: true"), "notice create route must distinguish automatic publish-time dispatch");
assert(noticeCreateRoute.includes("push: {"), "notice create route must return delivery feedback to the composer");
assert(noticeReadRoute.includes("requireSelectedBranchScope"), "notice read route must reject invalid selected branch scope");
assert(noticeReadRoute.includes("canReadNotice"), "notice read route must enforce readable notice scope");
assert(noticeBulkReadRoute.includes("canReadNotice"), "notice bulk read route must enforce readable notice scope");
assert(noticeBulkReadRoute.includes("requireSelectedBranchScope"), "notice bulk read route must reject invalid selected branch scope");
assert(noticeBulkReadRoute.includes("markNoticeRead"), "notice bulk read route must reuse audited read persistence");
assert(noticeBulkReadRoute.includes("noticeIds.length > 50"), "notice bulk read route must limit batch size");
assert(!noticePushRoute.includes("dispatchNoticePushNotifications"), "notice push route must use durable outbox jobs");
assert(
  noticePushRoute.includes("createNoticePushDispatchRequestAuditLog") &&
    pushHelper.includes('action: "notification.dispatch"'),
  "notice push route must audit push dispatch",
);
assert(
  noticePushRoute.includes("...summary") && notificationOutbox.includes("configured:"),
  "notice push route must return the persisted outbox summary",
);
assert(notificationOutboxRunner.includes("validateLeasedPushDispatchJob"), "outbox must revalidate recipients and subscriptions before send");
assert(notificationOutboxRunner.includes("createAttemptAuditLog"), "outbox must append a sanitized audit row per delivery attempt");
assert(notificationOutboxCron.includes("timingSafeEqual") && notificationOutboxCron.includes("CRON_SECRET"), "cron worker must require timing-safe bearer authorization");
assert(
  noticePushRoute.includes("noticePublisherRoles.has(user.role)") &&
    noticePermissions.includes('export const noticePublisherRoles = new Set<UserRole>(["owner", "admin", "coach"]);'),
  "notice push route must allow admin owner and scoped coach dispatch",
);
assert(
  noticePushRoute.includes("selectedScope.selectedBranchId !== branchId"),
  "notice push route must reject selected branch mismatches before dispatch",
);
assert(noticePushRoute.includes("getNoticeFamilyRecipientCount"), "notice push route must count member and guardian app inbox recipients");
assert(noticePushRoute.includes("recipientCount"), "notice push route must return recipient count in feedback");
assert(noticePushRoute.includes("requestAudit?.message"), "notice push route must return the durable audit result copy");
assert(pushHelper.includes("알림함에는 표시됩니다. 휴대폰 푸시는 기기 알림 연결 후 발송할 수 있습니다."), "notice dispatch copy must separate app inbox delivery from phone push setup");
assert(pushHelper.includes("휴대폰 푸시를 받을 기기가 아직 없습니다."), "notice dispatch copy must explain missing device subscriptions without hiding app inbox delivery");
assert(noticePushRoute.includes("공지 알림을 보낼 수 없습니다."), "notice push route must use user-facing forbidden copy");
assert(pushHelper.includes("알림 수신 등록이 만료됐습니다."), "push helper must use app-safe disabled subscription failure copy");
assert(pushHelper.includes("알림 발송 상태를 다시 확인해야 합니다."), "push helper must use app-safe dispatch failure copy");
assertExcludes(noticePushRoute, "공지 푸시 발송 권한", "notice push dispatch app/API feedback");
assertExcludes(noticePushRoute, "알림 발송 설정", "notice push dispatch unclear setup copy");
assertExcludes(noticePushRoute, "공지 알림을 보류", "notice push dispatch unclear blocked copy");
assertExcludes(noticePushRoute, "VAPID 키가 없어", "notice push dispatch app/API feedback");
assertExcludes(noticePushRoute, "VAPID 공개키/비밀키", "notice push dispatch app/API feedback");
assertExcludes(pushHelper, "push dispatch failed", "push helper raw failure copy");
assertExcludes(pushHelper, "error.message", "push helper raw provider error copy");

assert(apiContract.includes("/notifications/push-config"), "API contract must document push config route");
assert(apiContract.includes("/notifications/subscriptions"), "API contract must document push subscription route");
assert(apiContract.includes("/notices/:noticeId/push"), "API contract must document notice push route");
assert(apiContract.includes("/me/notices/bulk-read"), "API contract must document notice bulk read route");
assert(apiContract.includes('"important": true'), "API contract must document important notices");
assert(backendSchema.includes("CREATE TABLE push_subscriptions"), "DB schema must include push_subscriptions table");
assert(backendSchema.includes("important boolean NOT NULL DEFAULT false"), "DB schema must include important notice column");

assert(serviceWorker.includes('self.addEventListener("push"'), "service worker must accept future push events");
assert(serviceWorker.includes("self.registration.showNotification"), "service worker push handler must show notifications");
assert(serviceWorker.includes('self.addEventListener("notificationclick"'), "service worker must handle notification clicks");
assert(notificationOutbox.includes('|| "/app/notifications"'), "notice push payload must open the notification inbox");
assert(serviceWorker.includes('"/app/notifications"'), "notification click fallback must return to the notification inbox");
assert(serviceWorker.includes("clients.openWindow"), "notification click must open the app when no window is focused");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "notification settings cards removed from notice and notification screens",
        "push subscription API surface kept for platform handoff",
        "push subscription store and route handlers",
        "notice push dispatch route and audit log",
        "push event handler",
        "notification click navigation to notification inbox",
        "dedicated notification inbox with notice read actions",
        "single notification read action persistence feedback",
        "payment alert aggregation without request cards",
        "coach payment alert privacy guard",
        "global notification badge counts scoped notices and payments",
        "global actionable notification badges",
        "important notice publishing and push title",
        "automatic publish-time notice dispatch feedback",
        "recipient unread notice count smoke checks",
        "notice inbox unread and important filters",
        "notice inbox filtered bulk read",
        "notice read APIs reject invalid selectedBranchId before mutating",
        "notice operation cards and follow-up boards stay removed",
        "notification inbox settings shortcut and settings card stay removed",
        "family notification subscriptions stay active when unsubscribe is requested",
        "release gate inclusion",
      ],
    },
    null,
    2,
  ),
);
