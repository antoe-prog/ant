import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const noticesScreenSource = readFileSync("src/components/screens/notices-screen.tsx", "utf8");
const notificationsScreenSource = readFileSync("src/components/screens/notifications-screen.tsx", "utf8");
const noticeDeleteRouteSource = readFileSync("src/app/api/v1/branches/[branchId]/notices/[noticeId]/route.ts", "utf8");
const noticePermissionsSource = readFileSync("src/lib/notice-permissions.ts", "utf8");
const apiClientSource = readFileSync("src/lib/api-client.ts", "utf8");
const appStoreSource = readFileSync("src/store/app-store.tsx", "utf8");
const packageJsonSource = readFileSync("package.json", "utf8");
const releaseRunnerSource = readFileSync("scripts/run-release-checks.mjs", "utf8");
const smokeApiSource = readFileSync("scripts/smoke-api.mjs", "utf8");
const visibleCopyTestSource = readFileSync("scripts/check-visible-app-copy-stability.mjs", "utf8");
const noticeDeleteUiSource = readFileSync("scripts/check-notice-delete-ui.mjs", "utf8");
const packageJson = JSON.parse(packageJsonSource);

const removedNoticeOperationContracts = [
  'data-testid="notice-operations-panel"',
  'data-testid="notice-operations-metric"',
  'data-testid="notice-action-queue"',
  'data-testid="p2-notice-follow-up-board"',
  "noticeOperationMetrics",
  "noticeActionQueue",
  "noticeOperationsOpen",
  "{showNoticeSettings ? <NotificationPermissionPanel",
  "hideWhenUnavailable={!showNoticeDeliveryMeta}",
];

for (const contract of removedNoticeOperationContracts) {
  assert(
    !noticesScreenSource.includes(contract),
    `notices screen must not reintroduce the removed notice operation card contract: ${contract}`,
  );
}

const removedNotificationInboxContracts = [
  'data-testid="notification-settings-jump"',
  'href="#notification-permission-panel"',
  "showNotificationSettings",
  "<NotificationPermissionPanel",
];

for (const contract of removedNotificationInboxContracts) {
  assert(
    !notificationsScreenSource.includes(contract),
    `notifications screen must not reintroduce the removed settings card contract: ${contract}`,
  );
}

assert(
  notificationsScreenSource.includes('data-testid="notification-bulk-read-filtered"'),
  "notifications screen must keep the bulk read action after removing settings cards",
);
assert(
  notificationsScreenSource.includes('data-testid="notification-read-state-badge"'),
  "notifications screen must keep per-notice read state badges",
);
assert(
  notificationsScreenSource.includes('data-testid="notification-notice-content-link"'),
  "notifications screen must keep notice alert content tappable after removing repeated view buttons",
);
assert(
  notificationsScreenSource.includes('data-testid="notification-notice-delete-action"') &&
    notificationsScreenSource.includes('data-testid="notification-notice-delete-confirm"') &&
    notificationsScreenSource.includes('data-testid="notification-notice-delete-confirm-action"'),
  "notifications screen must keep the guarded notice delete action for publishers",
);
assert(
  /data-testid="notification-notice-delete-action"[\s\S]*<Trash2 className="h-4 w-4" aria-hidden \/>[\s\S]*삭제[\s\S]*<\/button>/.test(
    notificationsScreenSource,
  ),
  "notifications screen publisher delete action must keep a visible delete label",
);
assert(
  /data-testid="notification-delete-feedback"[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(notificationsScreenSource),
  "notification inbox delete feedback must stay announced as a polite status message",
);
assert(
  notificationsScreenSource.includes('item.kind !== "notice"'),
  "notifications screen must not reintroduce repeated notice 보기 buttons",
);

assert(
  noticesScreenSource.includes('data-testid={showNoticeDeliveryMeta ? "notice-delivery-compact-card" : "family-notice-card"}'),
  "notices screen must keep the compact notice list rows",
);
assert(
  noticesScreenSource.includes('data-testid="notice-delivery-delete-action"') &&
    noticesScreenSource.includes('data-testid="notice-delete-confirm"') &&
    noticesScreenSource.includes('data-testid="notice-delete-confirm-action"') &&
    noticesScreenSource.includes("canDeleteNotice(context.user, context.db, notice)"),
  "notices screen must keep the guarded notice delete action for publishers",
);
assert(
  /data-testid="notice-delivery-delete-action"[\s\S]*<Trash2 className="h-4 w-4" aria-hidden \/>[\s\S]*삭제[\s\S]*<\/button>/.test(
    noticesScreenSource,
  ),
  "notices screen publisher delete action must keep a visible delete label",
);
assert(
  /data-testid="notice-delete-feedback"[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(noticesScreenSource),
  "notices screen delete feedback must stay announced as a polite status message",
);
assert(
  noticesScreenSource.includes('data-testid="notice-bottom-safe-area"') &&
    noticesScreenSource.includes('className="h-28 lg:hidden"'),
  "notices screen must keep the mobile bottom safe-area spacer so notice delete actions are not hidden by bottom navigation",
);
assert(
  noticesScreenSource.includes('data-testid="notice-delivery-body"') &&
    noticesScreenSource.includes('data-testid="notice-delivery-body-toggle"') &&
    noticesScreenSource.includes("line-clamp-2"),
  "notices screen must keep a bounded, expandable operator body preview on mobile",
);
assert(
  noticesScreenSource.includes("handleDeleteNotice") &&
    noticesScreenSource.includes("deleteNotice(notice.branchId, notice.id)") &&
    noticesScreenSource.includes('setDeleteConfirmNoticeId(result.ok ? null : notice.id)'),
  "notices screen must keep the confirm-to-delete flow wired to the app store",
);
assert(
  /data-testid="notice-read-feedback"[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(noticesScreenSource),
  "notice read feedback must stay announced as a polite status message",
);
assert(
  noticesScreenSource.includes("async function handleMarkNoticeAsRead") &&
    noticesScreenSource.includes("const [readNoticePendingId, setReadNoticePendingId] = useState<string | null>(null)") &&
    noticesScreenSource.includes('setReadFeedback(ok ? "공지 확인을 저장했습니다." : "공지 확인 상태를 저장하지 못했습니다.");') &&
    noticesScreenSource.includes("onClick={() => void handleMarkNoticeAsRead(notice.id)}"),
  "notices screen single read actions must use the feedback/pending handler instead of a silent direct store call",
);
assert(
  !noticesScreenSource.includes("onClick={() => void markNoticeAsRead(notice.id)}"),
  "notices screen must not silently mark one notice as read without user feedback",
);
assert(
  /data-testid="notice-push-feedback"[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(noticesScreenSource),
  "notice push feedback must stay announced as a polite status message",
);
assert(
  /function clearNoticeFeedback\(\)[\s\S]*setNoticeFeedback\(null\);[\s\S]*setDeleteFeedback\(null\);[\s\S]*setPushFeedback\(null\);[\s\S]*setReadFeedback\(null\);/.test(
    noticesScreenSource,
  ),
  "notices screen must centralize stale feedback cleanup across notice actions",
);
assert(
  /async function handleCreateNotice[\s\S]*event\.preventDefault\(\);[\s\S]*clearNoticeFeedback\(\);[\s\S]*setNoticeFeedback\("제목, 내용, 대상 정보를 확인해 주세요\."\)/.test(
    noticesScreenSource,
  ),
  "notices screen must clear stale feedback and explain incomplete notice publish forms",
);
assert(
  /async function handleDispatchNoticePush[\s\S]*clearNoticeFeedback\(\);[\s\S]*dispatchNoticePush/.test(noticesScreenSource) &&
    /async function handleDeleteNotice[\s\S]*clearNoticeFeedback\(\);[\s\S]*deleteNotice\(notice\.branchId, notice\.id\)/.test(
      noticesScreenSource,
    ) &&
    /async function handleMarkFilteredNoticesAsRead[\s\S]*clearNoticeFeedback\(\);[\s\S]*markNoticesAsRead/.test(
      noticesScreenSource,
    ) &&
    /async function handleMarkNoticeAsRead[\s\S]*clearNoticeFeedback\(\);[\s\S]*markNoticeAsRead/.test(noticesScreenSource) &&
    /setDeleteConfirmNoticeId\(notice\.id\);[\s\S]*clearNoticeFeedback\(\);/.test(noticesScreenSource),
  "notices screen must clear stale create/read/push/delete feedback before every notice action",
);
assert(
  noticesScreenSource.includes('data-testid="family-notice-filter-grid"'),
  "family notice filter controls must stay in a fixed grid instead of a clipped scroll row",
);
assert(
  noticesScreenSource.includes('data-testid="family-notice-detail-toggle"'),
  "family notice long bodies must expand from the content area after removing repeated detail buttons",
);
assert(
  !noticesScreenSource.includes('{bodyExpanded ? "접기" : "자세히"}'),
  "family notices must not reintroduce repeated 자세히 buttons",
);
assert(
  noticesScreenSource.includes('const noticeReadTone = read ? "bg-zinc-50/70" : "bg-white";'),
  "read notices must stay visually toned down",
);
assert(
  /notice(ReadState|Important)BadgeClass[\s\S]*\?\s+"border-zinc-200 bg-zinc-50 text-zinc-500"/.test(noticesScreenSource),
  "read notice badges must stay toned down",
);
assert(
  visibleCopyTestSource.includes("must remove the separate notice operations card panel"),
  "visible copy stability test must document the removed operations card panel",
);
assert(
  visibleCopyTestSource.includes("noticeDeliveryBodyVisibleCount") &&
    visibleCopyTestSource.includes("must show one bounded operator notice preview per card on mobile"),
  "visible copy stability test must keep the operator notice body preview visibility guard",
);
assert(
  noticeDeleteUiSource.includes("noticeDeliveryBodyVisibleCount") &&
    noticeDeleteUiSource.includes("card with preview must stay at or below 188px"),
  "notice delete UI test must keep operator notice preview-card height proof",
);
assert(
  visibleCopyTestSource.includes("layout.noticeOperationsMetricCount, 0"),
  "visible copy stability test must fail if notice operation metric cards return",
);
assert(
  visibleCopyTestSource.includes("layout.noticeActionQueueCount, 0"),
  "visible copy stability test must fail if notice action queue cards return",
);
assert(
  visibleCopyTestSource.includes("layout.noticeFollowUpBoardCount, 0"),
  "visible copy stability test must fail if notice read-status cards return",
);
assert(
  noticeDeleteRouteSource.includes("export async function DELETE") &&
    noticeDeleteRouteSource.includes('action: "notice.delete"') &&
    noticeDeleteRouteSource.includes("canDeleteNotice(user, db, notice)") &&
    noticeDeleteRouteSource.includes("selectedScope.selectedBranchId !== branchId") &&
    noticeDeleteRouteSource.includes("notices: db.notices.filter"),
  "notice delete API must keep its protected delete handler, audit log, selected-branch guard, permission guard, and persisted removal",
);
assert(
  noticePermissionsSource.includes("export function canDeleteNotice") &&
    noticePermissionsSource.includes("canReadNotice(user, db, notice)") &&
    noticePermissionsSource.includes('user.role === "owner" || user.role === "admin"') &&
    noticePermissionsSource.includes("notice.createdByUserId === user.id"),
  "notice delete permission helper must centralize owner/admin and coach-owned notice deletion rules",
);
assert(
  noticeDeleteRouteSource.includes("createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId)") &&
    !noticeDeleteRouteSource.includes("createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? branchId)"),
  "notice delete API must preserve the caller's all-branch selection instead of switching the list to the deleted notice branch",
);
assert(
  apiClientSource.includes("deleteNotice(branchId: string, noticeId: string") &&
    apiClientSource.includes("method: \"DELETE\""),
  "API client must keep a DELETE notice request method",
);
assert(
  appStoreSource.includes("const deleteNotice = useCallback") &&
    appStoreSource.includes("apiClient.deleteNotice(branchId, noticeId, state.selectedBranchId)") &&
    appStoreSource.includes("dispatch({ type: \"serverSnapshot\", payload: nextPayload })"),
  "app store must keep notice deletion wired to the refreshed server snapshot",
);
assert(
  smokeApiSource.includes("member must not delete notices") &&
    smokeApiSource.includes("coach must not delete notices created by another publisher") &&
    smokeApiSource.includes("notice delete must reject a selected branch mismatch before deletion") &&
    smokeApiSource.includes("selected branch mismatch must not delete the notice") &&
    smokeApiSource.includes("notice delete did not remove the notice") &&
    smokeApiSource.includes("notice delete must remove the notice from member bootstrap") &&
    smokeApiSource.includes("notice delete must remove the notice from guardian bootstrap") &&
    smokeApiSource.includes("notice delete audit log missing"),
  "smoke API must cover notice deletion permissions, selected-branch mismatch, cross-recipient removal, and audit logging",
);
assert.equal(
  packageJson.scripts["test:notice-delete-ui"],
  "node scripts/check-notice-delete-ui.mjs",
  "package.json must expose the rendered notice delete UI regression check",
);
assert(
  releaseRunnerSource.includes('"npm run test:notice-delete-ui"') &&
    releaseRunnerSource.includes('["run", "test:notice-delete-ui"]'),
  "release runner must execute the rendered notice delete UI regression check with a managed app server",
);
assert(
  noticeDeleteUiSource.includes('getByTestId("notice-delivery-delete-action")') &&
    noticeDeleteUiSource.includes("ensureLocalAppServer") &&
	    noticeDeleteUiSource.includes('["run", "dev", "--", "--webpack", "--hostname", appUrl.hostname, "--port", appPort]') &&
	    noticeDeleteUiSource.includes('appServer: usingExistingAppServer ? "existing" : `managed-next-${managedAppServerMode}`') &&
    noticeDeleteUiSource.includes('getByTestId("notice-delete-confirm-action")') &&
    noticeDeleteUiSource.includes('getByTestId("notice-delivery-read-action")') &&
    noticeDeleteUiSource.includes('getByTestId("notice-read-feedback")') &&
    noticeDeleteUiSource.includes('getByTestId("notice-delivery-push-action")') &&
    noticeDeleteUiSource.includes('getByTestId("notice-push-confirmation-submit")') &&
    noticeDeleteUiSource.includes("feedbackResetState") &&
    noticeDeleteUiSource.includes("mobile-notices-read-feedback.png") &&
    noticeDeleteUiSource.includes('getByTestId("notification-notice-delete-action")') &&
    noticeDeleteUiSource.includes('getByTestId("notification-notice-delete-confirm-action")') &&
	    noticeDeleteUiSource.includes('bottomState.bottomClearance >= 96') &&
	    noticeDeleteUiSource.includes('bottomState.safeAreaHeight >= 112') &&
    noticeDeleteUiSource.includes("Browser skill present but node_repl js tool unavailable; Playwright fallback used") &&
    noticeDeleteUiSource.includes("공지를 삭제했습니다") &&
    noticeDeleteUiSource.includes(".data/mobile-builds/ios/notice-delete-ui-20260701"),
  "rendered notice delete UI check must cover notices screen, notification inbox, feedback, mobile bottom navigation clearance, managed local server setup, and evidence output",
);

console.log("notice card removal guard passed");
