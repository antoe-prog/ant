import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { p5P10AuditPaths, writeP5P10InternalAudit } from "./create-p5-p10-internal-audit.mjs";

writeP5P10InternalAudit({ quiet: true });

const files = {
  accountScreen: "src/components/screens/account-screen.tsx",
  adminAuditLogsScreen: "src/components/screens/admin-audit-logs-screen.tsx",
  adminBranchesScreen: "src/components/screens/admin-branches-screen.tsx",
  adminRolesScreen: "src/components/screens/admin-roles-screen.tsx",
  adminSettings: "src/components/screens/admin-settings-screen.tsx",
  adminUsersScreen: "src/components/screens/admin-users-screen.tsx",
  appShell: "src/components/shell/app-shell.tsx",
  finalWordmark: "src/components/brand/final-wordmark.tsx",
  appError: "src/app/(app)/error.tsx",
  appLayout: "src/app/layout.tsx",
  appLoading: "src/app/(app)/loading.tsx",
  appManifest: "src/app/manifest.ts",
  apiClient: "src/lib/api-client.ts",
  auditReadDeduplication: "src/lib/audit-read-deduplication.ts",
  auditLogQuery: "src/lib/audit-log-query.ts",
  auditLogPresentation: "src/lib/audit-log-presentation.ts",
  auditLogSecurity: "src/lib/audit-log-security.ts",
  bootstrapRoute: "src/app/api/v1/me/bootstrap/route.ts",
  auditLogsRoute: "src/app/api/v1/admin/audit-logs/route.ts",
  authLoginRoute: "src/app/api/v1/auth/login/route.ts",
  authInvitationAcceptRoute: "src/app/api/v1/auth/invitations/[token]/accept/route.ts",
  branchClassCreateRoute: "src/app/api/v1/branches/[branchId]/classes/route.ts",
  branchMemberCreateRoute: "src/app/api/v1/branches/[branchId]/members/route.ts",
  branchPaymentCreateRoute: "src/app/api/v1/branches/[branchId]/payments/route.ts",
  classUpdateRoute: "src/app/api/v1/classes/[classId]/route.ts",
  counselingNotesRoute: "src/app/api/v1/branches/[branchId]/members/[memberId]/counseling-notes/route.ts",
  devAutoLoginRoute: "src/app/api/v1/dev/auto-login/route.ts",
  installAppAction: "src/components/pwa/install-app-action.tsx",
  classesScreen: "src/components/screens/classes-screen.tsx",
  childSwitcher: "src/components/domain/child-switcher.tsx",
  dashboardScreen: "src/components/screens/dashboard-screen.tsx",
  inviteAcceptScreen: "src/components/screens/invite-accept-screen.tsx",
  invitationLinkCopy: "src/lib/invitation-link-copy.ts",
  loginScreen: "src/components/screens/login-screen.tsx",
  signupPage: "src/app/(auth)/signup/page.tsx",
  signupScreen: "src/components/screens/signup-screen.tsx",
  memberUpdateRoute: "src/app/api/v1/members/[memberId]/route.ts",
  memberGuardianRoute: "src/app/api/v1/members/[memberId]/guardians/route.ts",
  membersScreen: "src/components/screens/members-screen.tsx",
  mockApi: "src/lib/mock-api.ts",
  mockData: "src/lib/mock-data.ts",
  domain: "src/lib/domain.ts",
  format: "src/lib/format.ts",
  dataTable: "src/components/domain/data-table.tsx",
  pilotReadiness: "src/lib/pilot-readiness.ts",
  roles: "src/lib/roles.ts",
  notificationAlerts: "src/lib/notification-alerts.ts",
  notificationsAliasRoute: "src/app/(app)/app/notifications/page.tsx",
  notificationsScreen: "src/components/screens/notifications-screen.tsx",
  noticesAliasRoute: "src/app/(app)/notices/page.tsx",
  noticeMemberSearch: "src/lib/notice-member-search.ts",
  notFound: "src/app/not-found.tsx",
  noticesScreen: "src/components/screens/notices-screen.tsx",
  noticeCreateRoute: "src/app/api/v1/branches/[branchId]/notices/route.ts",
  noticeDeleteRoute: "src/app/api/v1/branches/[branchId]/notices/[noticeId]/route.ts",
  noticePermissions: "src/lib/notice-permissions.ts",
  noticePushRoute: "src/app/api/v1/branches/[branchId]/notices/[noticeId]/push/route.ts",
  notificationSubscriptionsRoute: "src/app/api/v1/notifications/subscriptions/route.ts",
  operationsExportRoute: "src/app/api/v1/exports/operations/route.ts",
  pilotOperationsRoute: "src/app/api/v1/admin/pilot-operations/route.ts",
  ownerBranchesScreen: "src/components/screens/owner-branches-screen.tsx",
  ownerReportsScreen: "src/components/screens/owner-reports-screen.tsx",
  onlineCheckoutRoute: "src/app/api/v1/payments/[paymentId]/online-checkout/route.ts",
  onlinePaymentsHelper: "src/server/online-payments.ts",
  paymentRefundRoute: "src/app/api/v1/payments/[paymentId]/refund/route.ts",
  paymentCheckoutAccess: "src/lib/payment-checkout-access.ts",
  paymentCheckoutPage: "src/app/(app)/app/payments/checkout/page.tsx",
  paymentCheckoutScreen: "src/components/screens/payment-checkout-screen.tsx",
  paymentsExportRoute: "src/app/api/v1/exports/payments/route.ts",
  paymentsScreen: "src/components/screens/payments-screen.tsx",
  paymentWebhookRoute: "src/app/api/v1/payments/webhook/route.ts",
  productionPreflight: "scripts/check-production-preflight.mjs",
  permissionMatrix: "src/components/domain/permission-matrix.tsx",
  passwordResetScreen: "src/components/screens/password-reset-screen.tsx",
  adminBranchUpdateRoute: "src/app/api/v1/admin/branches/[branchId]/route.ts",
  adminBranchOwnerRoute: "src/app/api/v1/admin/branches/[branchId]/owner/route.ts",
  adminInvitationRoute: "src/app/api/v1/admin/users/invitations/route.ts",
  adminUserInvitationApproveRoute: "src/app/api/v1/admin/users/[userId]/approve-invitation/route.ts",
  adminUserRoute: "src/app/api/v1/admin/users/[userId]/route.ts",
  adminUserPasswordRoute: "src/app/api/v1/admin/users/[userId]/password/route.ts",
  adminUserRoleRoute: "src/app/api/v1/admin/users/[userId]/roles/route.ts",
  recurringAgreementRoute: "src/app/api/v1/payments/[paymentId]/recurring-agreement/route.ts",
  protectedRoute: "src/components/routing/protected-route.tsx",
  proxy: "src/proxy.ts",
  pushHelper: "src/server/push-notifications.ts",
  requestsScreen: "src/components/screens/requests-screen.tsx",
  selectRoleScreen: "src/components/screens/select-role-screen.tsx",
  seedSql: "db/seeds/seed_mvp.sql",
  demoDateRoll: "src/server/demo-date-roll.ts",
  appStore: "src/store/app-store.tsx",
  uiPrimitives: "src/components/ui/primitives.tsx",
  stateBlocks: "src/components/ui/state-blocks.tsx",
  userDisplay: "src/lib/user-display.ts",
  useResource: "src/hooks/use-resource.ts",
  nextConfig: "next.config.ts",
  eslintConfig: "eslint.config.mjs",
  packageJson: "package.json",
  loginKeepSignedInScript: "scripts/check-login-keep-signed-in.mjs",
  p1OperatorStatusScript: "scripts/check-p1-operator-status.mjs",
  p1OperatorStatusTest: "scripts/check-p1-operator-status-test.mjs",
  pilotImport: "scripts/import-pilot-data.mjs",
  productionPreflightTest: "scripts/check-production-preflight-test.mjs",
  releaseRunner: "scripts/run-release-checks.mjs",
  routeSmoke: "scripts/smoke-routes.mjs",
  smokeApi: "scripts/smoke-api.mjs",
  mobileE2e: "scripts/smoke-mobile-attendance-e2e.mjs",
  attendanceSpeedSmoke: "scripts/smoke-attendance-speed.mjs",
  adminSettingsGate: "scripts/check-admin-settings-gates.mjs",
  implementationBacklog: "docs/IMPLEMENTATION_BACKLOG.md",
  pilotOperationsRunbook: "docs/PILOT_OPERATIONS_RUNBOOK.md",
  pilotDataIntake: "docs/pilot-templates/pilot-data-intake.csv",
  pilotFeedbackForm: "docs/pilot-templates/pilot-feedback-form.md",
  qaPlan: "docs/QA_TEST_PLAN.md",
  releaseChecklist: "docs/RELEASE_CHECKLIST.md",
  readme: "README.md",
  runtimeDb: ".data/final-judo-db.json",
  visibleAppCopyScript: "scripts/check-visible-app-copy-stability.mjs",
  visibleTextAuditRecheck: ".data/mobile-builds/ios/visible-text-audit-20260621-recheck/recheck.json",
  userVisibleCopyAudit: ".data/mobile-builds/ios/user-visible-copy-audit-20260621/user-visible-copy-audit.json",
  visibleAppCopyStabilityReport:
    ".data/mobile-builds/ios/visible-app-copy-stability/visible-app-copy-stability-report.json",
  quickVisibleCopyRecheck: ".data/mobile-builds/ios/quick-visible-copy-recheck-20260621/quick-visible-copy-recheck.json",
  nextVisibleCopyScan: ".data/mobile-builds/ios/next-visible-copy-scan-20260623/next-visible-copy-scan-report.json",
  compactEmptyCopyReport: ".data/mobile-builds/ios/compact-empty-copy-20260621/compact-empty-copy-render-report.json",
  loadingCopyReport: ".data/mobile-builds/ios/loading-copy-20260623/loading-copy-report.json",
  networkErrorCopyReport: ".data/mobile-builds/ios/network-error-copy-20260623/network-error-copy-report.json",
  errorFallbackCopyReport:
    ".data/mobile-builds/ios/error-fallback-copy-20260623/member-dashboard-fallback-copy-report.json",
  memberContactFormatReport: ".data/mobile-builds/ios/member-contact-format-20260623/member-contact-format-report.json",
  emptyStateTitleOnlyReport: ".data/mobile-builds/ios/empty-state-title-only-20260623/empty-state-title-only-report.json",
  emptyStateCopyTighteningReport:
    ".data/mobile-builds/ios/empty-state-copy-tightening-20260623/empty-state-copy-tightening-report.json",
  notificationAccessCopyReport:
    ".data/mobile-builds/ios/notification-access-copy-20260623/notification-access-copy-report.json",
  adminSettingsRoleSelectCopyReport:
    ".data/mobile-builds/ios/admin-settings-role-fallback-20260623/admin-settings-role-select-copy-report.json",
  adminSettingsInternalReferenceCleanupReport:
    ".data/mobile-builds/ios/admin-settings-internal-reference-cleanup-20260623/admin-settings-reference-cleanup-report.json",
  memberInvitationLinkCompactReport:
    ".data/mobile-builds/ios/member-invitation-link-compact-20260623/admin-members-invitation-compact-report.json",
  coachSaveLabelCleanupReport:
    ".data/mobile-builds/ios/coach-save-label-cleanup-20260623/coach-save-label-cleanup-report.json",
  coachSaveCopyPolishReport:
    ".data/mobile-builds/ios/coach-save-copy-polish-20260623/coach-classes-save-copy-report.json",
  invitePasswordCopyReport:
    ".data/mobile-builds/ios/invite-password-copy-20260623/invite-accept-password-copy-report.json",
  adminRolesCopyReport:
    ".data/mobile-builds/ios/admin-roles-copy-20260623/admin-roles-copy-report.json",
  guardianLearningStatusCopyReport:
    ".data/mobile-builds/ios/guardian-learning-status-copy-20260623/guardian-learning-status-copy-report.json",
  ownerPeriodTouchPolishReport:
    ".data/mobile-builds/ios/owner-period-touch-polish-20260623/owner-dashboard-period-touch-report.json",
  adminSettingsPilotLabelReport:
    ".data/mobile-builds/ios/admin-settings-pilot-label-20260623/admin-settings-pilot-label-report.json",
  continuousVisibleCopyScanReport:
    ".data/mobile-builds/ios/continuous-visible-copy-scan-20260623-loaded/visible-copy-scan-report.json",
  memberDashboardScheduleCompactReport:
    ".data/mobile-builds/ios/member-dashboard-schedule-compact-20260623/member-dashboard-schedule-compact-report.json",
  coachAttendanceFilterGridReport:
    ".data/mobile-builds/ios/coach-attendance-filter-touch-20260624/coach-classes-filter-touch-report.json",
  adminSettingsInternalStageHiddenReport:
    ".data/mobile-builds/ios/admin-settings-internal-stage-hidden-20260623/admin-settings-internal-stage-hidden-report.json",
  adminSettingsOpsWordingReport:
    ".data/mobile-builds/ios/admin-settings-ops-wording-20260623/admin-settings-ops-wording-report.json",
  adminSettingsReadinessCollapseReport:
    ".data/mobile-builds/ios/admin-settings-readiness-collapse-20260624/admin-settings-readiness-collapse-report.json",
  coachClassCompactTimeReport:
    ".data/mobile-builds/ios/coach-class-compact-time-20260623/coach-classes-compact-time-report.json",
  dashboardCompactTimeReport:
    ".data/mobile-builds/ios/dashboard-compact-time-20260623/dashboard-compact-time-report.json",
  guardianLearningPreviewCompactReport:
    ".data/mobile-builds/ios/guardian-learning-preview-compact-20260623/guardian-learning-preview-compact-report.json",
  memberNoteDateTimeReport:
    ".data/mobile-builds/ios/member-note-datetime-20260623/member-note-datetime-report.json",
  continuousPolishScanReport:
    ".data/mobile-builds/ios/continuous-polish-scan-20260623/continuous-polish-scan-report.json",
  memberContactEditCollapseReport:
    ".data/mobile-builds/ios/member-contact-edit-collapse-20260623/member-contact-edit-collapse-report.json",
  familyContactEditDeepLinkReport:
    ".data/mobile-builds/ios/family-contact-edit-deeplink-20260628/summary.json",
  memberManagementFormCollapseReport:
    ".data/mobile-builds/ios/member-management-touch-targets-20260705/summary.json",
  classCreateFormCollapseReport:
    ".data/mobile-builds/ios/class-create-form-collapse-20260630/summary.json",
  memberManagementTouchTargetsScript: "scripts/check-member-management-touch-targets.mjs",
  classManagementTouchTargetsScript: "scripts/check-class-management-touch-targets.mjs",
  classManagementTouchTargetsReport:
    ".data/mobile-builds/ios/class-management-touch-targets-20260705/summary.json",
  memberProfileGuardianSyncReport:
    ".data/mobile-builds/ios/member-profile-guardian-sync-20260630/summary.json",
  memberProfileDraftSyncReport:
    ".data/mobile-builds/ios/member-profile-draft-sync-20260701/summary.json",
  memberListSearchNormalizedReport:
    ".data/mobile-builds/ios/member-list-search-normalized-20260630/summary.json",
  memberGuardianReentrySyncReport:
    ".data/mobile-builds/ios/member-guardian-reentry-sync-20260630/summary.json",
  guardianPaymentChildSyncReport:
    ".data/mobile-builds/ios/guardian-payment-child-sync-20260630/summary.json",
  noticeDeleteEvidenceReport:
    ".data/mobile-builds/ios/notice-delete-20260630/summary.json",
  adminUserGuardianBottomSafeAreaScript: "scripts/check-admin-user-guardian-bottom-safe-area.mjs",
  adminUserGuardianBottomSafeAreaReport:
    ".data/mobile-builds/ios/admin-user-guardian-bottom-safe-area-20260701/summary.json",
  adminUserListSafeAreaIosReport:
    ".data/mobile-builds/ios/admin-user-guardian-bottom-safe-area-20260701/admin-user-list-safe-area-ios-sim-summary.json",
  adminUserManagementTouchTargetsScript: "scripts/check-admin-user-management-touch-targets.mjs",
  adminUserManagementTouchTargetsReport:
    ".data/mobile-builds/ios/admin-user-management-touch-targets-20260705/summary.json",
  adminAuditBottomSafeAreaScript: "scripts/check-admin-audit-bottom-safe-area.mjs",
  adminAuditBottomSafeAreaReport:
    ".data/mobile-builds/ios/admin-audit-bottom-safe-area-20260701/summary.json",
  adminAuditSearchScript: "scripts/check-admin-audit-search.mjs",
  auditLogPrivacyScript: "scripts/check-audit-log-privacy.mjs",
  adminAuditSearchReport: ".data/mobile-builds/ios/audit-privacy-20260713/summary.json",
  adminAuditPrivacyIosReport: ".data/mobile-builds/ios/audit-privacy-20260713/ios-simulator-summary.json",
  coachClassesBottomSafeAreaScript: "scripts/check-coach-classes-bottom-safe-area.mjs",
  coachClassesBottomSafeAreaReport:
    ".data/mobile-builds/ios/coach-classes-bottom-safe-area-20260701/summary.json",
  coachClassesBottomSafeAreaIosReport:
    ".data/mobile-builds/ios/coach-classes-bottom-safe-area-20260701/ios-sim-summary.json",
  adminBranchSelectedScopeReport:
    ".data/mobile-builds/ios/admin-branch-selected-scope-20260701/summary.json",
  familyClassPersonalAttendanceReport:
    ".data/mobile-builds/ios/family-class-personal-attendance-20260623/family-class-personal-attendance-report.json",
  memberDashboardPaymentCheckoutLinkReport:
    ".data/mobile-builds/ios/dashboard-payment-checkout-link-20260628/summary.json",
  phoneSignupRegressionGuardReport:
    ".data/mobile-builds/ios/phone-signup-regression-guard-20260628/summary.json",
  authRegisteredCopyReport: ".data/mobile-builds/ios/auth-registered-copy-20260628/summary.json",
  adminInvitationApprovalReport:
    ".data/mobile-builds/ios/admin-invitation-approval-20260627/summary.json",
  adminUsersPendingFirstReport:
    ".data/mobile-builds/ios/admin-users-pending-first-20260627/summary.json",
  adminUsersApproveLabelReport:
    ".data/mobile-builds/ios/admin-users-approve-label-20260627/summary.json",
  adminInviteLinkActionsReport:
    ".data/mobile-builds/ios/admin-invite-link-actions-20260628/summary.json",
  notificationsInboxEvidenceReport:
    ".data/mobile-builds/ios/notifications-inbox-20260628/summary.json",
  notificationInboxDensityEvidenceReport:
    ".data/mobile-builds/ios/notification-inbox-density-20260629/summary.json",
  notificationReadActionEvidenceReport:
    ".data/mobile-builds/ios/notification-read-action-feedback-20260628/summary.json",
  notificationPaymentCopyEvidenceReport:
    ".data/mobile-builds/ios/notification-payment-copy-20260705/summary.json",
  noticeNotificationNavLabelReport:
    ".data/mobile-builds/ios/notice-notification-nav-label-20260705/summary.json",
  readNoticeToneDownEvidenceReport:
    ".data/mobile-builds/ios/read-notice-tone-down-20260628/summary.json",
  familyNotificationSettingsHiddenReport:
    ".data/mobile-builds/ios/family-notification-settings-hidden-20260628/summary.json",
  familyNotificationAlwaysOnGuardReport:
    ".data/mobile-builds/ios/family-notification-always-on-guard-20260628/summary.json",
  paymentCheckoutEvidenceReport:
    ".data/mobile-builds/ios/payment-checkout-prep-20260628/evidence.json",
  familyPaymentCheckoutScript: "scripts/check-family-payment-checkout.mjs",
  paymentCheckoutMethodFlowScript: "scripts/check-payment-checkout-method-flow.mjs",
  paymentCreateTouchTargetsScript: "scripts/check-payment-create-touch-targets.mjs",
  paymentCreateTouchTargetsReport:
    ".data/mobile-builds/ios/payment-create-touch-targets-20260704/summary.json",
  manualPaymentCreateFeedbackReport:
    ".data/mobile-builds/ios/manual-payment-create-feedback-20260713/summary.json",
  adminUserDeletePolicyFeedbackReport:
    ".data/mobile-builds/ios/admin-user-policy-feedback-20260713/summary.json",
  operatorListSearchReport:
    ".data/mobile-builds/ios/operator-list-search-20260704/summary.json",
  operatorListSearchTouchReport:
    ".data/mobile-builds/ios/operator-list-search-touch-20260704/summary.json",
  ownerDashboardDetailToggleReport:
    ".data/mobile-builds/ios/owner-dashboard-detail-toggle-20260701/summary.json",
  finalWordmarkLetterSpacingReport:
    ".data/mobile-builds/ios/final-wordmark-letter-spacing-20260704/summary.json",
  p1Readiness: ".data/p1-readiness.json",
  p1OperatorStatusCurrent: ".data/p1-operator-status.current.json",
  p1OperatorStatusCurrentMarkdown: ".data/p1-operator-status.current.md",
  androidTwaDoctor: ".data/android-twa-doctor.json",
  iosIpaDoctor: ".data/mobile-builds/ios/ios-ipa-doctor.json",
  p5P10InternalAudit: p5P10AuditPaths.json,
  p5P10InternalAuditMarkdown: p5P10AuditPaths.markdown,
};

const screenshotFiles = [
  ".data/mobile-builds/ios/p5-p10-simulator-screenshots/admin-settings-p5-p10.jpg",
  ".data/mobile-builds/ios/p5-p10-simulator-screenshots/coach-classes-p5.jpg",
  ".data/mobile-builds/ios/p5-p10-simulator-screenshots/member-dashboard-p5.jpg",
  ".data/mobile-builds/ios/p5-p10-simulator-screenshots/guardian-dashboard-p5.jpg",
  ".data/mobile-builds/ios/dummy-cleanup-stability/guardian-learning-dashboard-ios-sim.jpg",
  ".data/mobile-builds/ios/dummy-cleanup-stability/coach-classes-clean-ios-sim.jpg",
  ".data/mobile-builds/ios/dummy-cleanup-stability/owner-reports-clean-ios-sim.jpg",
  ".data/mobile-builds/ios/dummy-cleanup-stability/admin-account-native-install-hidden-ios-sim.jpg",
  ".data/mobile-builds/ios/dummy-cleanup-stability/admin-settings-incident-clean-ios-sim.jpg",
  ".data/mobile-builds/ios/dummy-cleanup-stability/guardian-account-branch-scope-ios-sim.jpg",
  ".data/mobile-builds/ios/guardian-dashboard-child-switcher/guardian-dashboard-child-switcher-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-graph-spacing/owner-dashboard-graph-spacing-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-dashboard-branch-graph-20260623/owner-dashboard-branch-graph-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-dashboard-graph-density-20260625/owner-dashboard-graph-density-browser.png",
  ".data/mobile-builds/ios/owner-dashboard-graph-density-20260625/owner-dashboard-graph-density-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-dashboard-detail-collapse-20260626/owner-dashboard-detail-collapse-browser.png",
  ".data/mobile-builds/ios/owner-dashboard-detail-collapse-20260626/owner-dashboard-detail-collapse-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-dashboard-helper-copy-density-20260626/admin-dashboard-helper-copy-density-browser.png",
  ".data/mobile-builds/ios/admin-dashboard-helper-copy-density-20260626/admin-dashboard-helper-copy-density-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-dashboard-copy-cleanup/admin-dashboard-account-records-browser.png",
  ".data/mobile-builds/ios/admin-dashboard-copy-cleanup/admin-dashboard-account-records-ios-sim.jpg",
  ".data/mobile-builds/ios/login-hydration-stability/login-quicklogin-hydration-fixed-ios-sim.jpg",
  ".data/mobile-builds/ios/phone-signup-regression-guard-20260628/signup-phone-browser.png",
  ".data/mobile-builds/ios/phone-signup-regression-guard-20260628/signup-phone-ios-sim.jpg",
  ".data/mobile-builds/ios/payment-checkout-prep-20260628/member-payments-card.jpg",
  ".data/mobile-builds/ios/payment-checkout-prep-20260628/member-checkout-safearea.jpg",
  ".data/mobile-builds/ios/payment-checkout-prep-20260628/guardian-payments-card.jpg",
  ".data/mobile-builds/ios/payment-checkout-prep-20260628/guardian-checkout-ready.jpg",
  ".data/mobile-builds/ios/payment-checkout-save-opt-in-20260705/payment-checkout-save-opt-in-ios-sim.png",
  ".data/mobile-builds/ios/payment-checkout-woori-copy-ios-20260705/payment-checkout-woori-copy-ios-sim.png",
  ".data/mobile-builds/ios/guardian-payment-child-sync-20260630/guardian-payment-child-sync-ios-sim.png",
  ".data/mobile-builds/ios/notice-delete-20260630/owner-notice-delete-ios-sim.png",
  ".data/mobile-builds/ios/family-payment-state-badge-compact-20260630/guardian-payments-state-badge-compact-ios-sim.png",
  ".data/mobile-builds/ios/admin-users-password-edit-20260624/admin-users-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-users-password-edit-collapse-20260624/admin-users-ios-sim-top.jpg",
  ".data/mobile-builds/ios/admin-users-password-edit-collapse-20260624/admin-users-ios-sim-list.jpg",
  ".data/mobile-builds/ios/admin-users-password-edit-collapse-20260624/admin-users-edit-password-collapsed-browser.png",
  ".data/mobile-builds/ios/admin-users-password-edit-collapse-20260624/admin-users-edit-password-open-browser.png",
  ".data/mobile-builds/ios/admin-users-action-icons-20260624/admin-users-action-icons-browser.png",
  ".data/mobile-builds/ios/admin-users-action-icons-20260624/admin-users-action-icons-ios-sim-actions.jpg",
  ".data/mobile-builds/ios/admin-users-action-stack-density-20260625/admin-users-action-stack-density-browser.png",
  ".data/mobile-builds/ios/admin-users-action-stack-density-20260625/admin-users-action-stack-density-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-users-protected-delete-density-20260626/admin-users-protected-delete-density-browser.png",
  ".data/mobile-builds/ios/admin-users-protected-delete-density-20260626/admin-users-protected-delete-density-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-invitation-approval-20260627/admin-users-initial-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-invitation-approval-20260627/admin-users-pending-invite-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-invitation-approval-20260627/admin-users-after-approval-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-users-pending-first-20260627/admin-users-pending-first-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-users-approve-label-20260627/admin-users-approve-label-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-invite-link-actions-20260628/admin-users-pending-invite-link-actions-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-roles-protection-card-cleanup-20260625/admin-roles-protection-card-cleanup-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-roles-protection-card-cleanup-20260625/admin-roles-protection-card-cleanup-ios-sim-after-scroll.jpg",
  ".data/mobile-builds/ios/admin-roles-recent-change-collapse-20260624/admin-roles-recent-change-collapsed-browser.png",
  ".data/mobile-builds/ios/admin-roles-recent-change-collapse-20260624/admin-roles-recent-change-expanded-browser.png",
  ".data/mobile-builds/ios/admin-roles-recent-change-collapse-20260624/admin-roles-recent-change-collapsed-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-roles-density-20260625/admin-roles-density-browser.png",
  ".data/mobile-builds/ios/admin-roles-density-20260625/admin-roles-density-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-roles-invite-density-20260625/admin-roles-invite-density-browser.png",
  ".data/mobile-builds/ios/admin-roles-invite-density-20260625/admin-roles-invite-density-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-roles-recent-change-density-tight-20260625/admin-roles-recent-change-density-tight-browser.png",
  ".data/mobile-builds/ios/admin-roles-recent-change-density-tight-20260625/admin-roles-recent-change-density-tight-open-browser.png",
  ".data/mobile-builds/ios/admin-roles-recent-change-density-tight-20260625/admin-roles-recent-change-density-tight-ios-sim-top.jpg",
  ".data/mobile-builds/ios/admin-roles-recent-change-density-tight-20260625/admin-roles-recent-change-density-tight-ios-sim-recent.jpg",
  ".data/mobile-builds/ios/admin-users-delete-guard-20260624/admin-users-delete-guard-browser-after-scroll.png",
  ".data/mobile-builds/ios/admin-users-delete-guard-20260624/admin-users-delete-guard-ios-sim-protected.jpg",
  ".data/mobile-builds/ios/admin-users-delete-guard-20260624/admin-users-delete-guard-ios-sim-scrolled.jpg",
  ".data/mobile-builds/ios/admin-users-delete-protection-chip-20260624/admin-users-delete-protection-chip-ios-sim-scrolled.jpg",
  ".data/mobile-builds/ios/admin-users-filter-state-20260624/admin-users-empty-filter-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-user-guardian-bottom-safe-area-20260701/admin-user-list-safe-area-browser.png",
  ".data/mobile-builds/ios/admin-user-guardian-bottom-safe-area-20260701/admin-user-list-safe-area-ios-sim.png",
  ".data/mobile-builds/ios/admin-user-guardian-bottom-safe-area-20260701/admin-user-guardian-bottom-safe-area-browser.png",
  ".data/mobile-builds/ios/admin-audit-filter-compact-20260624/admin-audit-filter-collapsed-ios-sim.jpg",
    ".data/mobile-builds/ios/admin-audit-compact-rows-20260624/admin-audit-compact-rows-browser.png",
    ".data/mobile-builds/ios/admin-audit-compact-rows-20260624/admin-audit-compact-rows-ios-sim.jpg",
    ".data/mobile-builds/ios/admin-audit-payload-collapse-20260624/admin-audit-payload-collapsed-browser.png",
    ".data/mobile-builds/ios/admin-audit-payload-collapse-20260624/admin-audit-payload-collapsed-ios-sim.jpg",
    ".data/mobile-builds/ios/admin-audit-list-collapse-20260624/admin-audit-list-collapsed-browser.png",
    ".data/mobile-builds/ios/admin-audit-list-collapse-20260624/admin-audit-list-expanded-browser.png",
    ".data/mobile-builds/ios/admin-audit-list-collapse-20260624/admin-audit-list-collapsed-ios-sim.jpg",
    ".data/mobile-builds/ios/admin-audit-list-density-20260624/admin-audit-list-density-collapsed-browser.png",
    ".data/mobile-builds/ios/admin-audit-list-density-20260624/admin-audit-list-density-expanded-browser.png",
    ".data/mobile-builds/ios/admin-audit-list-density-20260624/admin-audit-list-density-collapsed-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-audit-density-20260625/admin-audit-density-browser.png",
  ".data/mobile-builds/ios/admin-audit-density-20260625/admin-audit-density-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-audit-row-density-20260625/admin-audit-row-density-browser.png",
  ".data/mobile-builds/ios/admin-audit-row-density-20260625/admin-audit-row-density-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-settings-internal-panel-guard-20260625/admin-settings-internal-panel-guard-browser.png",
  ".data/mobile-builds/ios/admin-settings-internal-panel-guard-20260625/admin-settings-internal-panel-guard-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branch-summary-20260624/admin-branches-active-summary-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branch-summary-bar-20260624/admin-branches-summary-bar-browser.png",
  ".data/mobile-builds/ios/admin-branch-summary-bar-20260624/admin-branches-summary-bar-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branch-card-compact-20260624/admin-branches-card-compact-browser.png",
  ".data/mobile-builds/ios/admin-branch-card-compact-20260624/admin-branches-card-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branches-density-20260624/admin-branches-compact-browser.png",
  ".data/mobile-builds/ios/admin-branches-density-20260624/admin-branches-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branches-card-size-20260624/admin-branches-compact-browser.png",
  ".data/mobile-builds/ios/admin-branches-card-size-20260624/admin-branches-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branches-card-size-20260625/admin-branches-compact-browser.png",
  ".data/mobile-builds/ios/admin-branches-card-size-20260625/admin-branches-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branches-card-density-20260625/admin-branches-card-density-browser.png",
  ".data/mobile-builds/ios/admin-branches-card-density-20260625/admin-branches-card-density-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branches-create-responsive-20260625/admin-branches-collapsed-browser.png",
  ".data/mobile-builds/ios/admin-branches-create-responsive-20260625/admin-branches-create-open-browser.png",
  ".data/mobile-builds/ios/admin-branches-create-responsive-20260625/admin-branches-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branch-create-compact-20260704/admin-branches-create-compact-ios-sim.png",
  ".data/mobile-builds/ios/admin-branches-settings-density-20260625/admin-branches-collapsed-browser.png",
  ".data/mobile-builds/ios/admin-branches-settings-density-20260625/admin-branches-settings-open-browser.png",
  ".data/mobile-builds/ios/admin-branches-settings-density-20260625/admin-branches-settings-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branches-settings-inline-labels-20260625/admin-branches-default-browser.png",
  ".data/mobile-builds/ios/admin-branches-settings-inline-labels-20260625/admin-branches-settings-inline-labels-browser.png",
  ".data/mobile-builds/ios/admin-branches-settings-inline-labels-20260625/admin-branches-settings-hash-browser.png",
  ".data/mobile-builds/ios/admin-branches-settings-inline-labels-20260625/admin-branches-settings-inline-labels-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branches-settings-density-tight-20260625/admin-branches-settings-density-tight-browser.png",
  ".data/mobile-builds/ios/admin-branches-settings-density-tight-20260625/admin-branches-settings-density-tight-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-branches-collapsed-detail-density-20260626/admin-branches-collapsed-detail-density-browser-mobile-clip.png",
  ".data/mobile-builds/ios/admin-branches-collapsed-detail-density-20260626/admin-branches-collapsed-detail-density-ios-sim.jpg",
  ".data/mobile-builds/ios/auth-copy-cleanup/login-compact-browser.png",
  ".data/mobile-builds/ios/auth-copy-cleanup/password-reset-compact-browser.png",
  ".data/mobile-builds/ios/auth-copy-cleanup/invite-accept-compact-browser.png",
  ".data/mobile-builds/ios/invite-password-copy-20260623/invite-accept-password-copy-browser.png",
  ".data/mobile-builds/ios/state-block-density/members-empty-state-compact-browser.png",
  ".data/mobile-builds/ios/coach-notices-reader-20260626/coach-notices-reader-browser.png",
  ".data/mobile-builds/ios/coach-notices-reader-20260626/coach-notices-reader-ios-sim.jpg",
  ".data/mobile-builds/ios/stale-seed-date-roll/member-dashboard-date-roll.png",
  ".data/mobile-builds/ios/member-summary-cleanup/member-dashboard-no-summary-heading-browser.png",
  ".data/mobile-builds/ios/copy-stability/account-home-screen-install-copy-browser.png",
  ".data/mobile-builds/ios/copy-stability/coach-notices-copy-browser.png",
  ".data/mobile-builds/ios/copy-stability/notices-feedback-copy-browser.png",
  ".data/mobile-builds/ios/copy-stability/admin-settings-validator-copy-browser.png",
  ".data/mobile-builds/ios/copy-stability/admin-roles-record-labels-browser.png",
  ".data/mobile-builds/ios/admin-roles-copy-20260623/admin-roles-copy-browser.png",
  ".data/mobile-builds/ios/copy-stability/guardian-role-aware-nav-browser.png",
  ".data/mobile-builds/ios/copy-stability/member-role-aware-nav-browser.png",
  ".data/mobile-builds/ios/copy-stability/coach-role-aware-nav-browser.png",
  ".data/mobile-builds/ios/copy-stability/owner-reports-no-csv-badge-browser.png",
  ".data/mobile-builds/ios/admin-ops-copy-cleanup/admin-audit-common-copy-browser.png",
  ".data/mobile-builds/ios/admin-ops-copy-cleanup/admin-branches-ops-status-browser.png",
  ".data/mobile-builds/ios/admin-ops-copy-cleanup/admin-settings-runtime-copy-browser.png",
  ".data/mobile-builds/ios/role-visible-copy-audit/guardian-dashboard.png",
  ".data/mobile-builds/ios/role-visible-copy-audit/member-dashboard.png",
  ".data/mobile-builds/ios/role-visible-copy-audit/coach-classes.png",
  ".data/mobile-builds/ios/role-visible-copy-audit/owner-dashboard.png",
  ".data/mobile-builds/ios/role-visible-copy-audit/owner-reports.png",
  ".data/mobile-builds/ios/loading-state-stability/guardian-entry-loading-brand-browser.png",
  ".data/mobile-builds/ios/loading-state-stability/guardian-dashboard-after-loading-browser.png",
  ".data/mobile-builds/ios/loading-state-stability/guardian-dashboard-after-loading-ios-sim.jpg",
  ".data/mobile-builds/ios/visible-text-audit-20260621-recheck/admin-app_admin_audit-logs.png",
  ".data/mobile-builds/ios/visible-text-audit-20260621-recheck/coach-app_members.png",
  ".data/mobile-builds/ios/brand-shell-cleanup/admin-dashboard-brand-shell-desktop-browser.png",
  ".data/mobile-builds/ios/brand-shell-cleanup/admin-dashboard-brand-shell-mobile-browser.png",
  ".data/mobile-builds/ios/dummy-copy-refresh/guardian-learning-evergreen-notices-browser.png",
  ".data/mobile-builds/ios/data-copy-refinement/coach-members-paused-alert-browser.png",
  ".data/mobile-builds/ios/data-copy-refinement/coach-notices-compact-copy-browser.png",
  ".data/mobile-builds/ios/empty-state-copy-cleanup-20260621/guardian-dashboard.png",
  ".data/mobile-builds/ios/empty-state-copy-cleanup-20260621/member-dashboard.png",
  ".data/mobile-builds/ios/empty-state-copy-cleanup-20260621/member-classes.png",
  ".data/mobile-builds/ios/state-label-copy-cleanup-20260621/guardian-dashboard-state-labels-before-child-switch.png",
  ".data/mobile-builds/ios/state-label-copy-cleanup-20260621/guardian-dashboard-state-labels-after-child-switch.png",
  ".data/mobile-builds/ios/state-label-copy-cleanup-20260621/member-dashboard-state-labels.png",
  ".data/mobile-builds/ios/state-label-copy-cleanup-20260621/member-classes-state-labels.png",
  ".data/mobile-builds/ios/state-label-copy-cleanup-20260621/member-dashboard-state-labels-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-copy-cleanup-20260621/coach-classes-no-internal-guardrails-browser.png",
  ".data/mobile-builds/ios/member-dashboard-panel-compact-20260621/member-dashboard-compact-browser.png",
  ".data/mobile-builds/ios/member-dashboard-panel-compact-20260621/guardian-dashboard-compact-browser.png",
  ".data/mobile-builds/ios/owner-report-trend-label-cleanup-20260621/owner-reports-trend-labels-browser.png",
  ".data/mobile-builds/ios/user-copy-compact-20260621/coach-classes-compact-copy-browser.png",
  ".data/mobile-builds/ios/user-copy-compact-20260621/coach-account-compact-copy-browser.png",
  ".data/mobile-builds/ios/compact-empty-copy-20260621/member-payments-filter-empty-compact-copy-browser.png",
  ".data/mobile-builds/ios/compact-empty-copy-20260621/owner-branches-compact-copy-browser.png",
  ".data/mobile-builds/ios/continuous-dummy-stability-20260623/admin-settings-operating-title-browser.png",
  ".data/mobile-builds/ios/continuous-dummy-stability-20260623/admin-settings-operating-title-ios-sim.jpg",
  ".data/mobile-builds/ios/continuous-copy-stability-20260623/admin-settings-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-settings-internal-reference-cleanup-20260623/admin-settings-reference-cleanup-browser.png",
  ".data/mobile-builds/ios/admin-settings-internal-reference-cleanup-20260623/admin-settings-reference-cleanup-ios-sim.jpg",
  ".data/mobile-builds/ios/member-invitation-link-compact-20260623/admin-members-invitation-compact-browser.png",
  ".data/mobile-builds/ios/coach-save-label-cleanup-20260623/coach-save-label-cleanup-browser.png",
  ".data/mobile-builds/ios/coach-save-copy-polish-20260623/coach-classes-save-copy-browser.png",
  ".data/mobile-builds/ios/continuous-dummy-stability-20260623/coach-classes-user-facing-panel-titles-browser.png",
  ".data/mobile-builds/ios/continuous-dummy-stability-20260623/owner-reports-user-facing-panel-titles-browser.png",
  ".data/mobile-builds/ios/coach-save-panel-compact-20260623/coach-classes-save-panel-after-browser.png",
  ".data/mobile-builds/ios/coach-save-panel-compact-20260623/coach-classes-save-panel-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-classes-flow-copy-20260623/coach-classes-flow-copy-browser.png",
  ".data/mobile-builds/ios/coach-classes-flow-copy-20260623/coach-classes-flow-copy-ios-sim-scroll.jpg",
  ".data/mobile-builds/ios/admin-settings-copy-cleanup-20260623/admin-settings-mobile-copy-cleanup.png",
  ".data/mobile-builds/ios/admin-settings-summary-compact-20260623/admin-settings-summary-compact-browser.png",
  ".data/mobile-builds/ios/admin-settings-readiness-collapse-20260624/admin-settings-readiness-collapsed-browser.png",
  ".data/mobile-builds/ios/admin-settings-readiness-collapse-20260624/admin-settings-readiness-collapsed-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-settings-policy-density-20260624/admin-settings-policy-compact-browser.png",
  ".data/mobile-builds/ios/admin-settings-policy-density-20260624/admin-settings-policy-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-settings-branch-policy-density-20260624/admin-settings-branch-policy-compact-browser.png",
  ".data/mobile-builds/ios/admin-settings-branch-policy-density-20260624/admin-settings-branch-policy-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/member-guardian-payment-filter-20260623/member-payments-filter-browser.png",
  ".data/mobile-builds/ios/member-guardian-payment-filter-20260623/guardian-payments-filter-browser.png",
  ".data/mobile-builds/ios/member-guardian-payment-filter-20260623/member-payments-filter-ios-sim.jpg",
  ".data/mobile-builds/ios/member-guardian-payment-filter-20260623/member-payments-filter-chips-ios-sim.jpg",
  ".data/mobile-builds/ios/member-guardian-payment-filter-20260623/guardian-payments-filter-chips-ios-sim.jpg",
  ".data/mobile-builds/ios/member-guardian-payment-filter-compact-20260623/member-payments-filter-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/member-guardian-payment-card-compact-20260623/guardian-payments-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/payment-filter-compact-20260624/guardian-payments-filter-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/family-screen-header-compact-20260623/member-payments-header-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/family-screen-header-compact-20260623/guardian-notices-header-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/member-notice-summary-compact-20260623/member-notices-summary-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/family-mobile-session-rail-compact-20260623/member-dashboard-no-session-rail-ios-sim.jpg",
  ".data/mobile-builds/ios/family-mobile-session-rail-compact-20260623/member-account-actions-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-report-export-label-20260623/owner-reports-export-label-browser.png",
  ".data/mobile-builds/ios/owner-report-export-label-20260623/owner-reports-export-label-ios-sim.jpg",
  ".data/mobile-builds/ios/payments-export-label-20260623/owner-payments-export-label-browser.png",
  ".data/mobile-builds/ios/payments-export-label-20260623/owner-payments-export-label-ios-sim.jpg",
  ".data/mobile-builds/ios/admin-audit-export-label-20260623/admin-audit-export-label-browser.png",
  ".data/mobile-builds/ios/admin-audit-export-label-20260623/admin-audit-export-label-ios-sim-summary.jpg",
  ".data/mobile-builds/ios/admin-settings-audit-policy-label-20260623/admin-settings-audit-policy-label-browser.png",
  ".data/mobile-builds/ios/admin-settings-audit-policy-label-20260623/admin-settings-audit-policy-label-ios-sim-policy.jpg",
  ".data/mobile-builds/ios/loading-copy-20260623/member-dashboard-loading-copy-browser.png",
  ".data/mobile-builds/ios/loading-copy-20260623/member-dashboard-after-loading-browser.png",
  ".data/mobile-builds/ios/network-error-copy-20260623/login-network-error-copy-browser.png",
  ".data/mobile-builds/ios/error-fallback-copy-20260623/member-dashboard-fallback-copy-browser.png",
  ".data/mobile-builds/ios/member-contact-format-20260623/member-contact-format-browser.png",
  ".data/mobile-builds/ios/family-class-personal-attendance-20260623/member-classes-personal-attendance-browser.png",
  ".data/mobile-builds/ios/family-class-personal-attendance-20260623/guardian-classes-personal-attendance-browser.png",
  ".data/mobile-builds/ios/family-class-personal-attendance-20260623/coach-classes-personal-attendance-browser.png",
  ".data/mobile-builds/ios/family-class-personal-attendance-20260623/guardian-classes-personal-attendance-ios-sim.jpg",
  ".data/mobile-builds/ios/member-guardian-class-chip-compact-20260623/member-classes-chip-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/family-class-card-compact-20260623/member-classes-card-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/family-class-card-compact-20260623/guardian-classes-card-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-quick-actions-density-20260623/coach-classes-quick-actions-no-idle-overlay-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-quick-actions-density-20260625/coach-classes-quick-actions-density-browser.png",
  ".data/mobile-builds/ios/coach-quick-actions-density-20260625/coach-classes-quick-actions-density-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-classes-status-filter-density-20260625/coach-classes-status-filter-density-browser.png",
  ".data/mobile-builds/ios/coach-classes-status-filter-density-20260625/coach-classes-status-filter-density-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-classes-control-density-20260625/coach-classes-control-density-browser.png",
  ".data/mobile-builds/ios/coach-classes-control-density-20260625/coach-classes-control-density-ios-sim.jpg",
  ".data/mobile-builds/ios/notice-body-collapse-20260623/guardian-notices-collapsed-ios-sim.jpg",
  ".data/mobile-builds/ios/family-notice-card-density-20260626/member-notices-card-density-ios-sim.jpg",
  ".data/mobile-builds/ios/notification-row-density-20260630/guardian-notifications-row-density-ios-sim.png",
  ".data/mobile-builds/ios/notification-kind-badge-density-20260630/guardian-notifications-kind-badge-ios-sim.png",
  ".data/mobile-builds/ios/notification-bottom-safe-area-20260630/guardian-notifications-bottom-safe-ios-sim.png",
  ".data/mobile-builds/ios/notification-bottom-card-clearance-20260630/guardian-notifications-bottom-card-clearance-ios-sim.png",
  ".data/mobile-builds/ios/notification-payment-copy-ios-20260705/guardian-notifications-payment-copy-ios-sim.png",
  ".data/mobile-builds/ios/notification-filter-toolbar-ios-20260705/guardian-notifications-filter-toolbar-ios-sim.png",
  ".data/mobile-builds/ios/notice-notification-nav-label-20260705/member-notices-bottom-nav-ios-sim.png",
  ".data/mobile-builds/ios/notice-notification-nav-label-20260705/member-notifications-bottom-nav-ios-sim.png",
  ".data/mobile-builds/ios/coach-attendance-history-collapse-20260630/coach-classes-attendance-history-collapsed-ios-sim.png",
  ".data/mobile-builds/ios/coach-classes-mobile-list-collapse-20260630/coach-classes-list-collapsed-ios-sim.png",
  ".data/mobile-builds/ios/admin-audit-bottom-safe-area-20260701/admin-audit-bottom-safe-area-browser.png",
  ".data/mobile-builds/ios/coach-classes-bottom-safe-area-20260701/coach-classes-bottom-safe-area-browser.png",
  ".data/mobile-builds/ios/admin-users-edit-scroll-start-20260630/admin-users-edit-open-ios-sim.png",
  ".data/mobile-builds/ios/empty-state-title-only-20260623/empty-state-title-only-browser.png",
  ".data/mobile-builds/ios/empty-state-copy-tightening-20260623/member-members-empty-copy-browser.png",
  ".data/mobile-builds/ios/empty-state-copy-tightening-20260623/guardian-dashboard-learning-copy-browser.png",
  ".data/mobile-builds/ios/empty-state-copy-tightening-20260623/member-dashboard-compact-copy-browser.png",
  ".data/mobile-builds/ios/guardian-learning-status-copy-20260623/guardian-learning-status-copy-browser.png",
  ".data/mobile-builds/ios/owner-period-touch-polish-20260623/owner-dashboard-period-touch-browser.png",
  ".data/mobile-builds/ios/member-dashboard-action-links-20260623/member-dashboard-action-links-browser.png",
  ".data/mobile-builds/ios/member-dashboard-action-links-20260623/member-classes-from-dashboard-link-browser.png",
  ".data/mobile-builds/ios/member-dashboard-priority-grid-20260623/member-dashboard-priority-grid-ios-sim.jpg",
  ".data/mobile-builds/ios/member-dashboard-priority-grid-tight-20260623/member-dashboard-priority-grid-tight-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-classes-copy-tightening-20260623/coach-classes-copy-tightening-browser.png",
  ".data/mobile-builds/ios/coach-classes-copy-tightening-20260623/coach-classes-copy-tightening-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-attendance-filter-grid-20260623/coach-classes-filter-grid-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-attendance-filter-grid-20260625/coach-classes-filter-grid-browser.png",
  ".data/mobile-builds/ios/coach-attendance-filter-grid-20260625/coach-classes-filter-grid-ios-sim.jpg",
    ".data/mobile-builds/ios/coach-class-roster-collapse-20260624/coach-classes-roster-collapse-browser.png",
    ".data/mobile-builds/ios/coach-class-roster-collapse-20260624/coach-classes-roster-collapse-ios-sim.jpg",
    ".data/mobile-builds/ios/coach-classes-roster-default-collapse-20260624/coach-classes-roster-collapsed-browser.png",
    ".data/mobile-builds/ios/coach-classes-roster-default-collapse-20260624/coach-classes-roster-open-browser.png",
    ".data/mobile-builds/ios/coach-classes-roster-default-collapse-20260624/coach-classes-roster-collapsed-ios-sim.jpg",
    ".data/mobile-builds/ios/coach-attendance-note-collapse-20260624/coach-classes-note-collapse-browser.png",
    ".data/mobile-builds/ios/coach-attendance-note-collapse-20260624/coach-classes-note-open-browser.png",
	    ".data/mobile-builds/ios/coach-attendance-note-collapse-20260624/coach-classes-note-collapse-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-class-card-density-20260625/coach-classes-card-density-browser.png",
  ".data/mobile-builds/ios/coach-class-card-density-20260625/coach-classes-card-density-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-classes-card-flow-density-20260625/coach-classes-card-flow-density-browser.png",
  ".data/mobile-builds/ios/coach-classes-card-flow-density-20260625/coach-classes-card-flow-density-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-class-card-density-tight-20260625/coach-classes-card-density-tight-browser.png",
  ".data/mobile-builds/ios/coach-class-card-density-tight-20260625/coach-classes-card-density-tight-ios-sim-top.jpg",
  ".data/mobile-builds/ios/coach-class-card-density-tight-20260625/coach-classes-card-density-tight-ios-sim-cards.jpg",
  ".data/mobile-builds/ios/coach-class-card-header-density-20260625/coach-classes-card-header-density-browser.png",
  ".data/mobile-builds/ios/coach-class-card-header-density-20260625/coach-classes-card-header-density-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-class-card-header-density-20260625/coach-classes-card-header-density-ios-sim-cards.jpg",
  ".data/mobile-builds/ios/coach-classes-speed-density-20260626/coach-classes-speed-density-browser.png",
  ".data/mobile-builds/ios/coach-classes-speed-density-20260626/coach-classes-speed-density-ios-sim.jpg",
  ".data/mobile-builds/ios/family-members-header-cleanup-20260624/guardian-members-header-cleanup-ios-sim.jpg",
  ".data/mobile-builds/ios/family-members-focus-20260626/guardian-members-alert-strip-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-members-note-editor-collapse-20260626/coach-members-note-editor-collapsed-browser.png",
  ".data/mobile-builds/ios/coach-members-note-editor-collapse-20260626/coach-members-note-editor-open-browser.png",
  ".data/mobile-builds/ios/coach-members-note-collapse-20260630/coach-members-note-collapsed-ios-sim.png",
  ".data/mobile-builds/ios/coach-members-mobile-list-collapse-20260630/coach-members-list-collapsed-ios-sim.png",
  ".data/mobile-builds/ios/vector-brand-shell-20260623/owner-reports-vector-logo-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-class-compact-time-20260623/coach-classes-compact-time-ios-sim-card.jpg",
  ".data/mobile-builds/ios/coach-dashboard-flow-graph-20260623/coach-dashboard-flow-graph-ios-sim.jpg",
  ".data/mobile-builds/ios/coach-dashboard-flow-density-20260626/coach-dashboard-flow-density-ios-sim.jpg",
  ".data/mobile-builds/ios/guardian-learning-compact-grid-20260623/guardian-learning-compact-grid-ios-sim.jpg",
  ".data/mobile-builds/ios/guardian-learning-actual-preview-20260623/guardian-dashboard-learning-preview-ios-sim.jpg",
  ".data/mobile-builds/ios/guardian-learning-compact-density-20260625/guardian-dashboard-learning-compact-browser.png",
  ".data/mobile-builds/ios/guardian-learning-compact-density-20260625/guardian-dashboard-learning-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/guardian-learning-status-grid-20260625/guardian-dashboard-learning-status-grid-browser.png",
  ".data/mobile-builds/ios/guardian-learning-status-grid-20260625/guardian-dashboard-learning-status-grid-ios-sim.jpg",
  ".data/mobile-builds/ios/guardian-learning-density-tight-20260625/guardian-dashboard-learning-tight-browser.png",
  ".data/mobile-builds/ios/guardian-learning-density-tight-20260625/guardian-dashboard-learning-tight-ios-sim.jpg",
  ".data/mobile-builds/ios/guardian-child-chip-switcher-20260623/guardian-dashboard-child-chips-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-report-trend-graph-20260623/owner-report-trend-graph-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-touch-target-20260624/owner-reports-touch-target-browser.png",
  ".data/mobile-builds/ios/owner-reports-touch-target-20260624/owner-reports-touch-target-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-density-20260624/owner-reports-compact-browser.png",
  ".data/mobile-builds/ios/owner-reports-density-20260624/owner-reports-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-trend-density-20260625/owner-reports-trend-density-browser.png",
  ".data/mobile-builds/ios/owner-reports-trend-density-20260625/owner-reports-trend-density-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-trend-summary-rail-20260626/owner-reports-trend-summary-rail-browser.png",
  ".data/mobile-builds/ios/owner-reports-trend-summary-rail-20260626/owner-reports-trend-summary-rail-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-branch-graph-collapse-20260624/owner-reports-branch-graph-collapsed-browser.png",
  ".data/mobile-builds/ios/owner-reports-branch-graph-collapse-20260624/owner-reports-branch-graph-collapsed-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-branch-graph-density-20260625/owner-reports-branch-graph-density-browser.png",
  ".data/mobile-builds/ios/owner-reports-branch-graph-density-20260625/owner-reports-branch-graph-density-ios-sim-branch-graph.jpg",
  ".data/mobile-builds/ios/owner-reports-priority-risk-density-20260625/owner-reports-priority-risk-density-browser.png",
  ".data/mobile-builds/ios/owner-reports-priority-risk-density-20260625/owner-reports-priority-risk-density-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-action-queue-density-20260625/owner-reports-action-queue-density-browser.png",
  ".data/mobile-builds/ios/owner-reports-action-queue-density-20260625/owner-reports-action-queue-density-ios-sim-action-queue.jpg",
  ".data/mobile-builds/ios/owner-reports-action-queue-collapse-20260624/owner-reports-action-queue-collapsed-browser.png",
  ".data/mobile-builds/ios/owner-reports-action-queue-collapse-20260624/owner-reports-action-queue-collapsed-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-trend-risk-collapse-20260624/owner-reports-trend-risk-collapsed-browser.png",
  ".data/mobile-builds/ios/owner-reports-trend-risk-collapse-20260624/owner-reports-trend-risk-open-browser.png",
  ".data/mobile-builds/ios/owner-reports-trend-risk-collapse-20260624/owner-reports-trend-risk-collapsed-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-branches-policy-collapse-20260624/owner-branches-policy-collapsed-browser.png",
  ".data/mobile-builds/ios/owner-branches-policy-collapse-20260624/owner-branches-policy-open-browser.png",
  ".data/mobile-builds/ios/owner-branches-policy-collapse-20260624/owner-branches-policy-collapsed-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-branches-priority-actions-20260625/owner-branches-priority-actions-browser.png",
  ".data/mobile-builds/ios/owner-branches-priority-actions-20260625/owner-branches-priority-actions-open-browser.png",
  ".data/mobile-builds/ios/owner-branches-priority-actions-20260625/owner-branches-priority-actions-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-branches-health-density-20260625/owner-branches-health-density-browser.png",
  ".data/mobile-builds/ios/owner-branches-health-density-20260625/owner-branches-health-density-ios-sim.jpg",
  ".data/mobile-builds/ios/owner-reports-secondary-priority-20260625/owner-reports-secondary-priority-browser.png",
  ".data/mobile-builds/ios/owner-reports-secondary-priority-20260625/owner-reports-secondary-priority-open-browser.png",
  ".data/mobile-builds/ios/owner-reports-secondary-priority-20260625/owner-reports-secondary-priority-ios-sim.jpg",
  ".data/mobile-builds/ios/audit-privacy-20260713/ios-simulator-admin-audit-detail.png",
  ...[
    "admin-dashboard",
    "admin-classes",
    "admin-members",
    "admin-payments",
    "admin-notices",
    "admin-account",
    "admin-branches",
    "admin-users",
    "admin-roles",
    "admin-audit",
    "admin-settings",
    "owner-dashboard",
    "owner-classes",
    "owner-members",
    "owner-payments",
    "owner-notices",
    "owner-account",
    "owner-branches",
    "owner-reports",
    "coach-dashboard",
    "coach-classes",
    "coach-members",
    "coach-notices",
    "coach-account",
    "member-dashboard",
    "member-classes",
    "member-members",
    "member-payments",
    "member-notices",
    "member-account",
    "guardian-dashboard",
    "guardian-classes",
    "guardian-members",
    "guardian-payments",
    "guardian-notices",
    "guardian-account",
  ].map((name) => `.data/mobile-builds/ios/visible-copy-expanded/${name}.png`),
];

const kpiCardScreenshotFiles = [
  ".data/mobile-builds/ios/kpi-card-design-screenshots-v2/admin-dashboard-kpi-v2.jpg",
  ".data/mobile-builds/ios/kpi-card-design-screenshots-v2/owner-dashboard-kpi-v2.jpg",
  ".data/mobile-builds/ios/kpi-card-design-screenshots-v2/owner-reports-kpi-v2.jpg",
];

const retiredRequestEvidenceFragments = [
  "request-notice-split",
  "notice-request-split",
  "notice-request-menu-split",
  "request-and-feedback-copy-cleanup",
];

for (const fragment of retiredRequestEvidenceFragments) {
  assert(!screenshotFiles.some((file) => file.includes(fragment)), `deleted request evidence must not stay in active screenshot requirements: ${fragment}`);
}

const optionalRemovedFileKeys = new Set(["requestsScreen"]);
const sources = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [
    key,
    optionalRemovedFileKeys.has(key) && !existsSync(file) ? "" : readFileSync(file, "utf8"),
  ]),
);
const packageJson = JSON.parse(sources.packageJson);
const p1Readiness = JSON.parse(sources.p1Readiness);
const p1OperatorStatusCurrent = JSON.parse(sources.p1OperatorStatusCurrent);
const androidTwaDoctor = JSON.parse(sources.androidTwaDoctor);
const iosIpaDoctor = JSON.parse(sources.iosIpaDoctor);
const p5P10InternalAudit = JSON.parse(sources.p5P10InternalAudit);
const visibleTextAuditRecheck = JSON.parse(sources.visibleTextAuditRecheck);
const userVisibleCopyAudit = JSON.parse(sources.userVisibleCopyAudit);
const visibleAppCopyStabilityReport = JSON.parse(sources.visibleAppCopyStabilityReport);
const quickVisibleCopyRecheck = JSON.parse(sources.quickVisibleCopyRecheck);
const nextVisibleCopyScan = JSON.parse(sources.nextVisibleCopyScan);
const compactEmptyCopyReport = JSON.parse(sources.compactEmptyCopyReport);
const loadingCopyReport = JSON.parse(sources.loadingCopyReport);
const networkErrorCopyReport = JSON.parse(sources.networkErrorCopyReport);
const errorFallbackCopyReport = JSON.parse(sources.errorFallbackCopyReport);
const memberContactFormatReport = JSON.parse(sources.memberContactFormatReport);
const emptyStateTitleOnlyReport = JSON.parse(sources.emptyStateTitleOnlyReport);
const emptyStateCopyTighteningReport = JSON.parse(sources.emptyStateCopyTighteningReport);
const notificationAccessCopyReport = JSON.parse(sources.notificationAccessCopyReport);
const adminSettingsRoleSelectCopyReport = JSON.parse(sources.adminSettingsRoleSelectCopyReport);
const adminSettingsInternalReferenceCleanupReport = JSON.parse(sources.adminSettingsInternalReferenceCleanupReport);
const memberInvitationLinkCompactReport = JSON.parse(sources.memberInvitationLinkCompactReport);
const coachSaveLabelCleanupReport = JSON.parse(sources.coachSaveLabelCleanupReport);
const coachSaveCopyPolishReport = JSON.parse(sources.coachSaveCopyPolishReport);
const invitePasswordCopyReport = JSON.parse(sources.invitePasswordCopyReport);
const adminRolesCopyReport = JSON.parse(sources.adminRolesCopyReport);
const guardianLearningStatusCopyReport = JSON.parse(sources.guardianLearningStatusCopyReport);
const ownerPeriodTouchPolishReport = JSON.parse(sources.ownerPeriodTouchPolishReport);
const adminSettingsPilotLabelReport = JSON.parse(sources.adminSettingsPilotLabelReport);
const continuousVisibleCopyScanReport = JSON.parse(sources.continuousVisibleCopyScanReport);
const memberDashboardScheduleCompactReport = JSON.parse(sources.memberDashboardScheduleCompactReport);
const coachAttendanceFilterGridReport = JSON.parse(sources.coachAttendanceFilterGridReport);
const adminSettingsInternalStageHiddenReport = JSON.parse(sources.adminSettingsInternalStageHiddenReport);
const adminSettingsOpsWordingReport = JSON.parse(sources.adminSettingsOpsWordingReport);
const adminSettingsReadinessCollapseReport = JSON.parse(sources.adminSettingsReadinessCollapseReport);
const coachClassCompactTimeReport = JSON.parse(sources.coachClassCompactTimeReport);
const dashboardCompactTimeReport = JSON.parse(sources.dashboardCompactTimeReport);
const guardianLearningPreviewCompactReport = JSON.parse(sources.guardianLearningPreviewCompactReport);
const memberNoteDateTimeReport = JSON.parse(sources.memberNoteDateTimeReport);
const continuousPolishScanReport = JSON.parse(sources.continuousPolishScanReport);
const memberContactEditCollapseReport = JSON.parse(sources.memberContactEditCollapseReport);
const familyContactEditDeepLinkReport = JSON.parse(sources.familyContactEditDeepLinkReport);
const memberManagementFormCollapseReport = JSON.parse(sources.memberManagementFormCollapseReport);
const classCreateFormCollapseReport = JSON.parse(sources.classCreateFormCollapseReport);
const memberProfileGuardianSyncReport = JSON.parse(sources.memberProfileGuardianSyncReport);
const memberProfileDraftSyncReport = JSON.parse(sources.memberProfileDraftSyncReport);
const memberListSearchNormalizedReport = JSON.parse(sources.memberListSearchNormalizedReport);
const memberGuardianReentrySyncReport = JSON.parse(sources.memberGuardianReentrySyncReport);
const guardianPaymentChildSyncReport = JSON.parse(sources.guardianPaymentChildSyncReport);
const noticeDeleteEvidenceReport = JSON.parse(sources.noticeDeleteEvidenceReport);
const adminUserGuardianBottomSafeAreaReport = JSON.parse(sources.adminUserGuardianBottomSafeAreaReport);
const adminUserListSafeAreaIosReport = JSON.parse(sources.adminUserListSafeAreaIosReport);
const adminUserManagementTouchTargetsReport = JSON.parse(sources.adminUserManagementTouchTargetsReport);
const adminAuditBottomSafeAreaReport = JSON.parse(sources.adminAuditBottomSafeAreaReport);
const adminAuditSearchReport = JSON.parse(sources.adminAuditSearchReport);
const adminAuditPrivacyIosReport = JSON.parse(sources.adminAuditPrivacyIosReport);
const coachClassesBottomSafeAreaReport = JSON.parse(sources.coachClassesBottomSafeAreaReport);
const coachClassesBottomSafeAreaIosReport = JSON.parse(sources.coachClassesBottomSafeAreaIosReport);
const adminBranchSelectedScopeReport = JSON.parse(sources.adminBranchSelectedScopeReport);
const familyClassPersonalAttendanceReport = JSON.parse(sources.familyClassPersonalAttendanceReport);
const memberDashboardPaymentCheckoutLinkReport = JSON.parse(sources.memberDashboardPaymentCheckoutLinkReport);
const runtimeDb = JSON.parse(sources.runtimeDb);
const phoneSignupRegressionGuardReport = JSON.parse(sources.phoneSignupRegressionGuardReport);
const authRegisteredCopyReport = JSON.parse(sources.authRegisteredCopyReport);
const adminInvitationApprovalReport = JSON.parse(sources.adminInvitationApprovalReport);
const adminUsersPendingFirstReport = JSON.parse(sources.adminUsersPendingFirstReport);
const adminUsersApproveLabelReport = JSON.parse(sources.adminUsersApproveLabelReport);
const adminInviteLinkActionsReport = JSON.parse(sources.adminInviteLinkActionsReport);
const notificationsInboxEvidenceReport = JSON.parse(sources.notificationsInboxEvidenceReport);
const notificationInboxDensityEvidenceReport = JSON.parse(sources.notificationInboxDensityEvidenceReport);
const notificationReadActionEvidenceReport = JSON.parse(sources.notificationReadActionEvidenceReport);
const notificationPaymentCopyEvidenceReport = JSON.parse(sources.notificationPaymentCopyEvidenceReport);
const noticeNotificationNavLabelReport = JSON.parse(sources.noticeNotificationNavLabelReport);
const readNoticeToneDownEvidenceReport = JSON.parse(sources.readNoticeToneDownEvidenceReport);
const operatorListSearchReport = JSON.parse(sources.operatorListSearchReport);
const operatorListSearchTouchReport = JSON.parse(sources.operatorListSearchTouchReport);
const ownerDashboardDetailToggleReport = JSON.parse(sources.ownerDashboardDetailToggleReport);
const finalWordmarkLetterSpacingReport = JSON.parse(sources.finalWordmarkLetterSpacingReport);
const familyNotificationSettingsHiddenReport = JSON.parse(sources.familyNotificationSettingsHiddenReport);
const familyNotificationAlwaysOnGuardReport = JSON.parse(sources.familyNotificationAlwaysOnGuardReport);
const paymentCheckoutEvidenceReport = JSON.parse(sources.paymentCheckoutEvidenceReport);
const paymentCreateTouchTargetsReport = JSON.parse(sources.paymentCreateTouchTargetsReport);
const manualPaymentCreateFeedbackReport = JSON.parse(sources.manualPaymentCreateFeedbackReport);
const adminUserDeletePolicyFeedbackReport = JSON.parse(sources.adminUserDeletePolicyFeedbackReport);

function assertIncludes(source, snippet, label) {
  assert(source.includes(snippet), `${label} must include ${snippet}`);
}

function assertExcludes(source, snippet, label) {
  assert(!source.includes(snippet), `${label} must not include ${snippet}`);
}

assertIncludes(sources.eslintConfig, '".data/xcode-derived/**"', "eslint ignores generated Xcode derived data");
assertIncludes(sources.eslintConfig, '".data/mobile-builds/ios/**/DerivedData/**"', "eslint ignores simulator evidence DerivedData");

function assertAppearsBefore(source, earlier, later, label) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);

  assert.notEqual(earlierIndex, -1, `${label} must include ${earlier}`);
  assert.notEqual(laterIndex, -1, `${label} must include ${later}`);
  assert(earlierIndex < laterIndex, `${label} must place ${earlier} before ${later}`);
}

function getRenderedSource(source) {
  const returnIndex = source.lastIndexOf("  return (\n    <div");
  assert.notEqual(returnIndex, -1, "screen source must include a JSX return");
  return source.slice(returnIndex);
}

function stripInternalReadinessPanels(source) {
  for (const snippet of [
    "showInternalReadinessPanels",
    "internal-release-gates-heading",
    "p1-release-readiness-heading",
    "p2-internal-development-status",
    "p3-operations-status",
    "p4-simulator-rehearsal-status",
  ]) {
    assertExcludes(source, snippet, "admin settings retired internal readiness/release panels");
  }

  return source;
}

function stripInternalCoachOperationPanels(source) {
  for (const snippet of [
    "showInternalCoachOperationPanels",
    "p3-coach-one-tap-field-rail",
    "p3-coach-field-checklist",
    "p3-coach-post-class-24h-followup-queue",
    "p3-coach-session-handoff-board",
  ]) {
    assertExcludes(source, snippet, "classes screen retired internal coach operation panels");
  }

  return source;
}

function stripInternalOwnerReportOperationPanels(source) {
  for (const snippet of [
    "showInternalOwnerOperationPanels",
    "p3-owner-decision-board",
    "p3-branch-standard-performance-action-board",
    "releaseGuard",
    "releaseBoundary",
    "운영 확인 {command}",
  ]) {
    assertExcludes(source, snippet, "owner reports retired internal operation panels");
  }

  return source;
}

function stripLegacyOwnerDecisionBoard(source) {
  for (const snippet of [
    "showLegacyOwnerDecisionBoard",
    "p2-owner-operations-board",
    "p2-owner-operations-board-heading",
  ]) {
    assertExcludes(source, snippet, "owner reports retired legacy owner decision board");
  }

  return source;
}

const adminSettingsVisibleSource = stripInternalReadinessPanels(getRenderedSource(sources.adminSettings));
const adminAuditLogsVisibleSource = getRenderedSource(sources.adminAuditLogsScreen);
const classesVisibleSource = stripInternalCoachOperationPanels(getRenderedSource(sources.classesScreen));
const ownerReportsVisibleSource = stripInternalOwnerReportOperationPanels(stripLegacyOwnerDecisionBoard(getRenderedSource(sources.ownerReportsScreen)));
const guardianDashboardSource = sources.dashboardScreen.slice(
  sources.dashboardScreen.indexOf('if (context.user.role === "guardian")'),
  sources.dashboardScreen.indexOf('if (context.user.role === "member")'),
);
const memberDashboardSource = sources.dashboardScreen.slice(
  sources.dashboardScreen.indexOf('if (context.user.role === "member")'),
  sources.dashboardScreen.indexOf('if (context.user.role === "owner")'),
);

for (const snippet of [
  "pt-[calc(env(safe-area-inset-top)+0.75rem)]",
  "lg:pt-0",
  "mobileNavScrollRef",
  "activeMobileNavRef",
  "scroller.scrollTo",
  "left: 0",
  'inline: "center"',
  "data-active-mobile-nav",
  "snap-x",
  "scroll-px-4",
  "snap-center",
  'data-testid="mobile-bottom-navigation-scroller"',
  "min-w-[3.5rem]",
  "getMobileVisibleRoutes",
  "denseMobileNav",
  "min-w-12",
  "pb-[calc(6.25rem+env(safe-area-inset-bottom))]",
  "block max-w-full truncate text-center leading-none",
]) {
  assertIncludes(sources.appShell, snippet, "app shell mobile safe area header");
}
for (const snippet of [
  "getRouteLabel(route, user.role)",
  "const routeLabel = getRouteLabel(route, user.role);",
  "{routeLabel}",
]) {
  assertIncludes(sources.appShell, snippet, "app shell role-aware navigation labels");
}
for (const snippet of [
  'const showMobileSessionRail = user.role !== "member" && user.role !== "guardian";',
  'data-testid="mobile-session-rail"',
  'data-testid="app-header-notice-link"',
  'className="relative inline-flex h-11 w-11',
  'data-testid="mobile-session-role-switch"',
  'data-testid="mobile-session-logout-button"',
  "data-mobile-route-id={route.id}",
  'const isNoticeScreenPath = pathname === "/app/notices" || pathname.startsWith("/app/notices/");',
  'const useNotificationInboxMobileRoute = route.id === "notices" && !isNoticeScreenPath;',
  'const mobileRouteHref = useNotificationInboxMobileRoute ? "/app/notifications" : route.href;',
  'const mobileRouteLabel = useNotificationInboxMobileRoute ? "알림" : routeLabel;',
  "const mobileRouteAriaLabel =",
  'aria-label={mobileRouteAriaLabel}',
  'renderNotificationBadge("mobile-notice-unread-badge", "mobile")',
  'placement === "mobile" ? "right-1 top-1" : "-right-1 -top-1"',
  "pointer-events-none absolute inline-flex",
  "{showMobileSessionRail ? (",
]) {
  assertIncludes(sources.appShell, snippet, "app shell family mobile session rail cleanup");
}
for (const snippet of ["operationError.status", "operationError.code"]) {
  assertExcludes(sources.appShell, snippet, "app shell operation error technical code cleanup");
}
for (const snippet of [
  'labelsByRole: {\n      coach: "홈",\n      guardian: "홈",\n      member: "홈",\n    }',
  'labelsByRole: {\n      guardian: "수업",\n      member: "수업",\n    }',
  'labelsByRole: {\n      guardian: "자녀",\n      member: "내 정보",\n    }',
  "export function getRouteLabel(route: AppRouteConfig, role: UserRole)",
]) {
  assertIncludes(sources.roles, snippet, "role-aware mobile navigation labels");
}
for (const snippet of ['id: "requests"', 'coach: "보강"', 'guardian: "보강"', 'member: "보강"', 'owner: "보강"']) {
  assertExcludes(sources.roles, snippet, "deleted request route must not reappear in role navigation");
}

for (const snippet of [
  "export const supportedBranchTimezones",
  '{ label: "한국 시간", value: "Asia/Seoul" }',
  "export function formatBranchTimezone(timezone?: string): string",
  "supportedTimezone?.label",
]) {
  assertIncludes(sources.domain, snippet, "branch timezone display labels");
}
for (const snippet of [
  "formatBranchTimezone(branch.timezone)",
]) {
  assertIncludes(sources.ownerBranchesScreen, snippet, "owner branch timezone display label");
  assertIncludes(sources.adminBranchesScreen, snippet, "admin branch timezone display label");
}
for (const snippet of [
  "supportedBranchTimezones.map",
  "!isKnownBranchTimezone(edit.timezone)",
  "{formatBranchTimezone(edit.timezone)}",
]) {
  assertIncludes(sources.adminBranchesScreen, snippet, "admin branch timezone picker display label");
}
for (const snippet of [
  '{branch.timezone ?? "Asia/Seoul"}',
  'value={edit.timezone}\n                      onChange={(event) => updateBranchEdit(branch.id, { timezone: event.target.value })}\n                    />',
]) {
  assertExcludes(sources.adminBranchesScreen, snippet, "admin branch timezone raw visible display");
  assertExcludes(sources.ownerBranchesScreen, snippet, "owner branch timezone raw visible display");
}
for (const snippet of [
  "break-all rounded-md border border-zinc-200 bg-zinc-50",
  "{branch.id}\n                  </span>",
]) {
  assertExcludes(sources.adminBranchesScreen, snippet, "admin branch internal id visible display");
}

for (const snippet of [
  "function isNativeAppRuntime()",
  "Capacitor?:",
  "windowWithCapacitor.Capacitor?.isNativePlatform?.()",
  "useSyncExternalStore",
  "function useNativeAppRuntime()",
  "const nativeAppRuntime = useNativeAppRuntime();",
  'if (nativeAppRuntime || installState === "checking" || installState === "manual" || installState === "dismissed")',
]) {
  assertIncludes(sources.installAppAction, snippet, "native app install card visibility guard");
}

assertIncludes(sources.installAppAction, 'manual: "기기 메뉴 사용"', "web install manual state uses device-centered copy");

for (const snippet of ["브라우저 설치", "브라우저 메뉴 사용", "설치 보류", "홈 화면 추가 안내"]) {
  assertExcludes(sources.installAppAction, snippet, "web install action app-safe copy");
}

for (const snippet of [
  "branches.length === 1",
  "branches[0].name",
  'context.user.role === "admin"',
  "지점 미배정",
  'data-testid="account-summary-card"',
  "branches.length > 1",
  "showAccountStatus",
  "accountStatusLabel",
  'data-testid="account-status-card"',
]) {
  assertIncludes(sources.accountScreen, snippet, "account branch scope display");
}
assertExcludes(sources.accountScreen, '<h2 className="text-sm font-semibold text-zinc-950">계정 정보</h2>', "account avoids duplicate account info card heading");
assertExcludes(sources.accountScreen, '<h2 className="text-sm font-semibold text-zinc-950">계정 상태</h2>', "account avoids duplicate account status card heading");

assertIncludes(sources.roles, 'trial: "체험중"', "member trial status app-safe label");
assertExcludes(sources.roles, 'trial: "체험"', "member trial status duplicate-prone label");
assertIncludes(
  sources.dashboardScreen,
  'meta: child.status === "trial" && child.level.includes("체험") ? child.belt : `${child.belt} · ${child.level}`',
  "guardian child switcher avoids duplicate trial copy",
);
for (const snippet of [
  "function isNoticeVisibleForGuardianChild",
  'notice.audience.includes("all") || notice.audience.includes("guardian")',
  "notice.branchId === child.branchId",
  "notice.targetMemberIds.includes(child.id)",
  "notice.targetClassIds.some((classId) => childClassIds.has(classId))",
  "const selectedChildVisibleNotices = selectedChild",
  "const promotionResultNotice = selectedChildVisibleNotices.find",
  "/심사\\s*결과|승급\\s*결과|통과|합격|불합격/.test",
  "selectedChildVisibleNotices.find((notice) => /대회|시합|토너먼트/.test",
  'title: promotionResultNotice ? "승급 심사 결과" : "다음 심사 준비"',
  'title: tournamentNotice ? "대회 참가 안내" : "대회 일정 준비"',
  'actionHref: promotionResultNotice ? "/app/notices" : undefined',
  'actionHref: tournamentNotice ? "/app/notices" : undefined',
]) {
  assertIncludes(sources.dashboardScreen, snippet, "guardian learning notices stay scoped to selected child");
}
for (const snippet of [
  'data-testid="guardian-child-switcher"',
  'data-testid="guardian-child-chip"',
  'className="grid grid-cols-3 gap-1.5 sm:grid-cols-4"',
  "flex min-h-11 min-w-0 flex-col justify-center",
  "block min-w-0 truncate text-sm font-semibold",
]) {
  assertIncludes(sources.childSwitcher, snippet, "guardian child switcher mobile no-overflow layout");
}
assertExcludes(sources.childSwitcher, 'child.statusLabel ? ` · ${child.statusLabel}` : ""', "guardian child switcher avoids repeated account status labels");
assertExcludes(sources.childSwitcher, "overflow-x-auto", "guardian child switcher mobile horizontal crop");
for (const snippet of [
  'actionLabel: "자세히 보기"',
  'actionLabel: promotionResultNotice ? "공지 보기" : undefined',
  'actionLabel: tournamentNotice ? "공지 보기" : undefined',
]) {
  assertIncludes(sources.dashboardScreen, snippet, "guardian learning action copy avoids duplicate aria names");
}
for (const snippet of ['actionLabel: "피드백 보기"', 'actionLabel: "심사 공지"', 'actionLabel: "대회 공지"']) {
  assertExcludes(sources.dashboardScreen, snippet, "guardian learning duplicate-prone action copy");
}
for (const snippet of [
  'title: latestChildFeedback ? "코치 피드백 도착" : "다음 피드백 예정"',
  'title: tournamentNotice ? "대회 참가 안내" : "대회 일정 준비"',
  "const promotionResultStatus = promotionResultNotice",
  "value: selectedChildNextBelt ? `목표 ${selectedChildNextBelt}` : \"단계 유지\"",
  "detail: `수련 ${selectedChildAttendance.length}회 · 수업 ${selectedChildClasses.length}개`",
  "value: latestChildFeedback ? `최근 ${selectedChildPublicNotes.length}건` : \"예정\"",
  "value: promotionResultStatus",
  'value: tournamentNotice ? "참가 안내" : "예정"',
  '"다음 피드백 예정"',
  "수업 후 확인",
]) {
  assertIncludes(sources.dashboardScreen, snippet, "guardian learning feedback app-safe copy");
}
for (const snippet of ['"최근 코치 피드백"', '"심사 결과 공지"', '"대회 소식"', '"공지 있음"', "개 반"]) {
  assertExcludes(sources.dashboardScreen, snippet, "guardian learning cards must show actual preview text instead of repeated category titles");
}
for (const snippet of [
  'data-testid="guardian-learning-stage-bar"',
  'data-testid="guardian-learning-insight-grid"',
  'data-testid="guardian-learning-insight-cell"',
  "grid grid-cols-2 gap-1.5",
  "min-h-14 rounded-md border border-zinc-200 bg-zinc-50/60",
  "sr-only",
  "현재 단계",
  "다음 목표",
  "단계별 수련 수준",
  "코치 피드백",
  "심사결과",
  "대회",
  'data-testid="guardian-learning-action-strip"',
  'data-testid="guardian-learning-action-link"',
  "href: personalPaymentActionHref",
  'href: "/app/notifications"',
  "import { Fragment, useMemo, useState } from \"react\";",
  "{index > 0 ? <span className=\"sr-only\"> </span> : null}",
  "const node = insight.actionHref && insight.actionLabel ?",
  "{node}",
  "{action.label}",
  "{displayValue ? <span className=\"text-zinc-500\"> {displayValue}</span> : null}",
]) {
  assertIncludes(sources.dashboardScreen, snippet, "guardian learning compact dashboard grid and action strip");
}
assertExcludes(sources.dashboardScreen, '<span className="text-zinc-300" aria-hidden>', "guardian learning action strip must not restore dot-separated status text");
for (const snippet of ["href: personalRequestActionHref", "/app/requests?compose=1", "보강 작성", "보강 확인"]) {
  assertExcludes(sources.dashboardScreen, snippet, "guardian learning actions must not expose deleted request links");
}
for (const snippet of ["학부모에게 남긴 피드백", "학부모 공개로 남긴 피드백", "최근 공개 피드백", "공개 피드백 대기", "피드백 없음", "피드백 대기"]) {
  assertExcludes(sources.dashboardScreen, snippet, "guardian learning internal visibility copy");
}
for (const snippet of [
  "actionHref: \"/app/classes\"",
  "actionHref: personalPaymentActionHref",
  'actionHref: "/app/notices"',
  'data-testid="member-guardian-priority-grid"',
  'data-testid="member-guardian-priority-cell"',
  "divide-y divide-zinc-100",
  "grid min-h-14 grid-cols-[minmax(0,1fr)_auto]",
  'aria-label={`${card.label} 보기`}',
]) {
  assertIncludes(sources.dashboardScreen, snippet, "member priority rows keep direct action links without restoring large cards");
}
for (const snippet of [
  "getFamilyPaymentCheckoutAccess",
  "const personalPaymentCheckoutAccess",
  "const personalPaymentActionHref",
  "/app/payments/checkout?paymentId=",
  "encodeURIComponent(personalPrimaryPayment.id)",
  "personalPaymentCheckoutAccess?.canOpen",
  "personalPaymentActionStatus",
]) {
  assertIncludes(sources.dashboardScreen, snippet, "member and guardian dashboard payment actions reuse checkout access rules");
}
for (const snippet of [
  "function formatMobileClassSchedule(name: string, startsAt: string, endsAt: string)",
  "formatCompactTimeRange(startsAt, endsAt)",
  "formatMobileClassSchedule(nextPersonalClass.name, nextPersonalClass.startsAt, nextPersonalClass.endsAt)",
]) {
  assertIncludes(sources.dashboardScreen, snippet, "member dashboard next class uses compact mobile schedule");
}
for (const snippet of [
  "`출석 기록 ${personalAttendanceRecords.length}건`",
  "const personalNoticeStatus = personalUnreadNotices.length > 0 ? `${personalUnreadNotices.length}건` : \"확인 완료\"",
  "`미확인 공지 ${personalUnreadNotices.length}건`",
  "`공지 ${data.notices.length}건 모두 확인`",
  'label: "공지"',
]) {
  assertIncludes(sources.dashboardScreen, snippet, "member dashboard priority card copy stays compact");
}
assertExcludes(
  sources.dashboardScreen,
  "const personalVisibleNotes = (context.db.counselingNotes ?? []).filter((note) => personalMemberIds.has(note.memberId));",
  "member and guardian dashboard counseling count must not include staff-only notes",
);
for (const snippet of ["보강 대기", "personalPendingRequests", "상담/안내", "미읽음 공지"]) {
  assertExcludes(sources.dashboardScreen, snippet, "member dashboard avoids verbose priority detail copy");
}
for (const snippet of [
  '"상담/공지"',
  "`상담 ${personalVisibleNotes.length} · 공지 ${personalUnreadNotices.length}`",
  'actionHref: personalUnreadNotices.length > 0 ? "/app/notices" : "/app/members"',
]) {
  assertExcludes(sources.dashboardScreen, snippet, "member dashboard notice priority must not restore counseling/notice bundle");
}
for (const snippet of [
  "export function formatCompactTime(value: string)",
  "export function formatCompactTimeRange(startsAt: string, endsAt: string)",
  'hour12: false',
]) {
  assertIncludes(sources.format, snippet, "shared compact mobile schedule formatter");
}
assertExcludes(
  sources.dashboardScreen,
  "`${nextPersonalClass.name} · ${formatDate(nextPersonalClass.startsAt)} ${formatTimeRange(nextPersonalClass.startsAt, nextPersonalClass.endsAt)}`",
  "member dashboard next class avoids verbose mobile time range",
);
for (const snippet of ["모바일 오늘 확인", "오늘 확인 브리프", "다음 행동 큐", "주간 확인 리듬", "확인 리마인드 큐"]) {
  assertExcludes(sources.dashboardScreen, snippet, "member and guardian dashboard avoids process-heavy guidance blocks");
}
for (const snippet of [
  "모바일 출석, 상담, 주의 회원 처리 흐름을 미처리 확인부터 동기화까지 한 줄로 줄입니다.",
  "수업 전 확인, 수업 후 마감, 상담/주의 후속을 한 번에 점검합니다.",
  "사유 보강, 주의 확인, 상담 후속을 수업 전/후 1분 점검으로 정렬합니다.",
  "모바일 출석, 사유 메모, 상담/주의, 동기화 예외를 현장 신호별로 즉시 처리",
  "3분 마감 안에 1분 출석, 1분 사유, 30초 보호자 안내, 30초 동기화를 순서대로 닫습니다.",
  "보호자 안내, 동기화, 변경 기록을 수업 후 한 번에 마감합니다.",
  "방금 저장한 출석 변경을 다시 확인합니다.",
]) {
  assertExcludes(sources.classesScreen, snippet, "coach classes avoids repetitive board intro copy");
}
for (const snippet of [
  'data-testid="coach-dashboard-follow-up-panel"',
  'context.user.role === "coach" ? (',
  "상담/주의 회원",
  "오늘 수업 명단에 확인할 상담/주의 메모가 없습니다.",
]) {
  assertIncludes(sources.dashboardScreen, snippet, "coach dashboard follow-up replaces payment warning");
}
for (const snippet of [
  "const coachDashboardFlowRows = [",
  'data-testid="coach-dashboard-flow-graph"',
  'data-testid="coach-dashboard-flow-row"',
  "오늘 운영",
  "오늘 수업",
  "출석 처리율",
  "상담/주의",
  "style={{ width: `${row.progress}%` }}",
]) {
  assertIncludes(sources.dashboardScreen, snippet, "coach dashboard compact flow graph");
}
assertExcludes(sources.dashboardScreen, '"보강 요청"', "coach dashboard compact flow graph must not restore deleted request rows");
for (const snippet of [
  'className="mt-2 grid grid-cols-2 gap-1.5 xl:grid-cols-4"',
  'className="group grid min-h-11 grid-cols-[2rem_minmax(0,1fr)_auto]',
  'data-testid={context.user.role === "coach" ? "coach-dashboard-classes-panel" : undefined}',
  "coachDashboardFlowGraphHeight <= 205",
  "coachDashboardFlowRowMaxHeight <= 48",
  "coachDashboardClassesPanelTop <= 500",
]) {
  assertIncludes(
    snippet.startsWith("coachDashboard") ? sources.visibleAppCopyScript : sources.dashboardScreen,
    snippet,
    "coach dashboard compact row density guard",
  );
}
assertExcludes(sources.dashboardScreen, "오늘 운영 흐름", "coach dashboard compact graph avoids document-style flow label");
const dashboardMetricGridSource = sources.dashboardScreen.slice(
  sources.dashboardScreen.indexOf('aria-label="운영 지표"'),
  sources.dashboardScreen.indexOf("<section className=\"mt-6", sources.dashboardScreen.indexOf('aria-label="운영 지표"')),
);
assertAppearsBefore(
  dashboardMetricGridSource,
  'context.user.role === "coach"',
  "data.metrics.map",
  "coach dashboard compact graph must take precedence over stacked metric cards",
);
for (const snippet of [
  "coach dashboard follow-up instead of payment warning",
  "coach dashboard must not expose payment warning operations",
  "coach dashboard follow-up panel must not expose payment amounts",
]) {
  assertIncludes(sources.mobileE2e, snippet, "coach dashboard payment-warning regression guard");
}

for (const snippet of ['label: "코치에게 공유"', 'label: "학부모에게 공유"', 'label: "직원만"']) {
  assertIncludes(sources.membersScreen, snippet, "member counseling visibility app-safe labels");
}
for (const snippet of ['label: "코치 공개"', 'label: "학부모 공개"', 'label: "스태프 전용"', 'label: "운영진만"']) {
  assertExcludes(sources.membersScreen, snippet, "member counseling visibility internal labels");
}
assertIncludes(sources.membersScreen, 'placeholder="상담 내용과 다음 확인 일정"', "member counseling note compact placeholder");
assertIncludes(sources.membersScreen, "저장하면 선택한 대상이 볼 수 있습니다.", "member counseling note save helper copy");
assertIncludes(sources.membersScreen, "볼 수 있는 대상", "member counseling visibility app-safe field label");
assertIncludes(sources.membersScreen, "memberNotes.length}건", "member counseling note count replaces repeated empty copy");
assertIncludes(
  sources.membersScreen,
  "const showAlertSection = !isFamilyRole && member.alerts.length > 0;",
  "member warning section must stay hidden when there are no alerts",
);
assertIncludes(sources.membersScreen, "openNoteEditorMemberIds", "coach member note editor collapsed state");
assertIncludes(sources.membersScreen, "expandedNoteMemberIds", "coach member note list compact state");
assertIncludes(sources.membersScreen, "coachMemberListExpanded", "coach member mobile list collapsed state");
assertIncludes(sources.membersScreen, "coachMemberMobileVisibleLimit = 1", "coach member mobile list visible limit");
assertIncludes(sources.membersScreen, "coachMemberListCollapsible", "coach member mobile list collapsible guard");
assertIncludes(sources.membersScreen, 'data-testid="coach-member-list-toggle"', "coach member mobile list expansion toggle marker");
assertIncludes(sources.membersScreen, 'data-testid={isFamilyRole ? "family-member-profile-card" : isCoachRole ? "coach-member-profile-card" : undefined}', "coach member profile card marker");
assertIncludes(sources.membersScreen, 'data-coach-member-mobile-state={isCoachRole ? (coachMemberCollapsedOnMobile ? "hidden" : "visible") : undefined}', "coach member mobile card visibility marker");
assertIncludes(sources.membersScreen, "hidden lg:block", "coach member mobile collapsed cards remain available on desktop");
assertIncludes(sources.membersScreen, "담당 회원 ${hiddenCoachMemberCount}명 더 보기", "coach member mobile list expansion copy");
assertIncludes(sources.membersScreen, 'data-testid={`member-note-editor-toggle-${member.id}`}', "coach member note editor toggle marker");
assertIncludes(sources.membersScreen, 'data-testid={`member-note-editor-${member.id}`}', "coach member note editor form marker");
assertIncludes(sources.membersScreen, 'data-testid={isCoachRole ? "coach-member-note-section" : undefined}', "coach member collapsed note section marker");
assertIncludes(sources.membersScreen, 'data-testid="coach-member-note-summary"', "coach member note compact summary marker");
assertIncludes(sources.membersScreen, 'data-testid={`member-note-list-toggle-${member.id}`}', "coach member note list toggle marker");
assertIncludes(sources.membersScreen, '"coach-member-note-card"', "coach member compact note card marker");
assertIncludes(sources.membersScreen, "isCoachRole ? (noteListExpanded ? memberNotes : [])", "coach member note detail collapsed default");
assertIncludes(sources.membersScreen, "aria-expanded={isNoteEditorOpen(member.id)}", "coach member note editor expanded state");
assertExcludes(
  sources.membersScreen,
  "상담 내용, 주의사항, 다음 확인 일정을 남겨주세요.",
  "member counseling note long placeholder",
);
assertExcludes(sources.membersScreen, "공개된 상담/주의 메모가 없습니다.", "member counseling note internal empty-state copy");
assertExcludes(sources.membersScreen, "등록된 주의사항 없음", "member warning empty-state copy");
assertExcludes(sources.membersScreen, "아직 상담/주의 메모가 없습니다.", "member counseling repeated empty-state copy");
assertExcludes(sources.membersScreen, "아직 코치 피드백이 없습니다.", "family feedback repeated empty-state copy");
assertExcludes(sources.membersScreen, "저장 후 선택한 대상에게 공유됩니다.", "member counseling note passive helper copy");
assertExcludes(sources.membersScreen, "공개 범위", "member counseling visibility internal field label");
assertIncludes(sources.counselingNotesRoute, "메모를 볼 수 있는 대상이 올바르지 않습니다.", "counseling note validation error app-safe target label");
assertExcludes(sources.counselingNotesRoute, "메모 공개 범위가 올바르지 않습니다.", "counseling note validation error internal visibility label");
assertIncludes(sources.counselingNotesRoute, "운영진 전용 메모", "counseling note forbidden error app-safe label");
assertExcludes(sources.counselingNotesRoute, "스태프 전용 메모", "counseling note forbidden error internal label");
for (const snippet of [
  'data-testid="notice-operations-panel"',
  'data-testid="notice-operations-toggle"',
  'data-testid="notice-operations-metric"',
  'data-testid="notice-action-queue"',
  'data-testid="p2-notice-follow-up-board"',
  "noticeOperationMetrics",
  "noticeActionQueue",
  "noticeOperationsOpen",
]) {
  assertExcludes(sources.noticesScreen, snippet, "notices must not restore removed operation cards");
}
assertIncludes(sources.noticesScreen, 'data-testid={showNoticeDeliveryMeta ? "notice-delivery-compact-card" : "family-notice-card"}', "notices compact row contract");
assertIncludes(sources.noticesScreen, 'data-testid="notice-bulk-read-filtered"', "notices bulk read action remains after card removal");
assertIncludes(sources.noticesScreen, 'data-testid="notice-read-state-badge"', "notices read state badge remains on admin rows");
assertIncludes(sources.noticesScreen, "확인할 공지", "notices title-only empty state remains");
assertExcludes(sources.noticesScreen, "공지 요약", "notices old oversized summary heading");
assertExcludes(sources.noticesScreen, "수신 대상", "notices old oversized push status helper");
assertIncludes(sources.pushHelper, "알림함에는 표시됩니다. 휴대폰 푸시는 기기 알림 연결 후 발송할 수 있습니다.", "notice push result copy separates phone push setup from app inbox delivery");
assertIncludes(sources.noticesScreen, "const showNoticeAside = canPublishNotice;", "notice screen keeps publisher composer separate from removed notification settings cards");
for (const removedNoticeSettingsContract of [
  "NotificationPermissionPanel",
  'data-testid="notification-permission-panel"',
  'data-testid="notification-permission-enable"',
  'data-testid="notification-permission-status-row"',
  'data-testid="notification-permission-actions"',
  'aria-label="알림 권한 켜기"',
  'aria-label="알림 확인 보내기"',
  "Notification.requestPermission()",
  "registration.showNotification",
  "pushManager.subscribe",
  "apiClient.subscribeToPush",
  "apiClient.unsubscribeFromPush",
  "이 기기에서는 알림 설정이 제한됩니다.",
  "설정 필요",
  "기기 확인",
  "수신 가능",
  "수신 중",
]) {
  assertExcludes(sources.noticesScreen, removedNoticeSettingsContract, "notices screen removed notification settings card contract");
}
assertExcludes(sources.noticesScreen, "이 기기에서는 알림을 받을 수 없습니다.", "notices unsupported device hard failure copy");
assertIncludes(sources.noticesScreen, "공지 대상", "notice audience app-safe label");
assertIncludes(sources.noticesScreen, "받는 대상", "notice target app-safe label");
assertIncludes(sources.noticesScreen, "const noticeListStatusLabel = showNoticeDeliveryMeta", "member and guardian notice count label guard");
assertIncludes(sources.noticesScreen, '`공지 ${filteredNotices.length} · 미읽음 ${filteredUnreadNoticeIds.length}`', "member and guardian notice count app copy");
assertIncludes(sources.noticesScreen, 'const bulkReadButtonLabel = showNoticeDeliveryMeta ? "보이는 공지 읽음 처리" : "읽음";', "member and guardian bulk read button app copy");
assertIncludes(sources.noticesScreen, ': `공지 ${filteredNotices.length} · 미읽음 ${filteredUnreadNoticeIds.length}`;', "member and guardian compact notice count copy");
assertExcludes(sources.noticesScreen, "현재 공지 모두 읽음", "member and guardian bulk read button state-like copy");
assertIncludes(sources.noticesScreen, 'data-testid="family-notice-compact-filter-bar"', "member and guardian compact notice filter bar");
assertIncludes(sources.noticesScreen, 'data-testid="family-notice-filter-grid"', "member and guardian notice toolbar fixed grid layout");
assertIncludes(sources.noticesScreen, "grid grid-cols-4 gap-1.5", "member and guardian notice toolbar avoids clipped horizontal scroll");
assertIncludes(sources.noticesScreen, "inline-flex min-h-11 min-w-0", "member and guardian notice filter touch target");
assertIncludes(sources.noticesScreen, 'className="min-h-11 min-w-0 px-1.5 text-sm"', "member and guardian notice bulk read touch target");
assertExcludes(sources.noticesScreen, 'data-testid="family-notice-status-badge"', "member and guardian notices avoid redundant filter-count status badge");
assertIncludes(sources.noticesScreen, 'const singleReadButtonLabel = showNoticeDeliveryMeta ? "읽음" : "확인";', "member and guardian individual read button compact app copy");
assertIncludes(sources.noticesScreen, "const showCompactReadAction = !showNoticeDeliveryMeta && !read;", "member and guardian compact notice read action guard");
assertIncludes(sources.noticesScreen, "const [readNoticePendingId, setReadNoticePendingId] = useState<string | null>(null)", "notices screen exposes single read pending state");
assertIncludes(sources.noticesScreen, "function clearNoticeFeedback()", "notices screen centralizes stale feedback cleanup");
assertIncludes(sources.noticesScreen, "setNoticeFeedback(null);", "notices screen clears stale create feedback before other notice actions");
assertIncludes(sources.noticesScreen, "setDeleteFeedback(null);", "notices screen clears stale delete feedback before other notice actions");
assertIncludes(sources.noticesScreen, "setPushFeedback(null);", "notices screen clears stale push feedback before other notice actions");
assertIncludes(sources.noticesScreen, "setReadFeedback(null);", "notices screen clears stale read feedback before other notice actions");
assertIncludes(sources.noticesScreen, 'setNoticeFeedback("제목, 내용, 대상 정보를 확인해 주세요.");', "notice composer explains incomplete publish forms");
assertIncludes(sources.noticesScreen, "async function handleMarkNoticeAsRead", "notices screen single read actions use a feedback handler");
assertIncludes(sources.noticesScreen, "공지 확인을 저장했습니다.", "notices screen confirms single notice read persistence");
assertExcludes(sources.noticesScreen, "onClick={() => void markNoticeAsRead(notice.id)}", "notices screen must not silently mark one notice as read");
assertIncludes(sources.noticesScreen, 'data-testid="family-notice-read-action"', "member and guardian compact notice read action test id");
assertIncludes(sources.noticesScreen, 'className="inline-flex min-h-11 shrink-0 items-center justify-center', "member and guardian notice read action touch target");
assertIncludes(sources.noticesScreen, 'data-testid="notice-read-state-badge"', "admin notice read-state badge is gated away from family cards");
assertIncludes(sources.noticesScreen, "const noticeReadTone = read ?", "notices screen tones down read notice cards");
assertIncludes(sources.noticesScreen, 'data-notice-read-state={read ? "read" : "active"}', "notices screen exposes read notice tone state");
assertIncludes(sources.noticesScreen, "const noticeReadStateBadgeClass = read", "notices screen tones down read-state badges after read");
assertIncludes(sources.noticesScreen, 'aria-label={`${notice.title} 확인 완료`}', "member and guardian compact notice read action accessibility label");
assertIncludes(sources.noticesScreen, '"현재 공지를 읽음 처리하지 못했습니다."', "member and guardian notice bulk read failure app copy");
assertIncludes(sources.noticesScreen, "function compactNoticeBody", "member and guardian compact notice body helper");
assertIncludes(sources.noticesScreen, "const [expandedNoticeIds, setExpandedNoticeIds] = useState<Set<string>>(() => new Set());", "member and guardian notice body expansion state");
assertIncludes(sources.noticesScreen, "const bodyCanCollapse = !showNoticeDeliveryMeta", "member and guardian notice body collapse guard");
assertIncludes(sources.noticesScreen, "bodyCanCollapse && !bodyExpanded ? compactNoticeBody(notice.body) : notice.body", "member and guardian notice body compact rendering");
assertIncludes(sources.noticesScreen, 'aria-expanded={bodyExpanded}', "member and guardian notice body expansion accessibility");
assertIncludes(sources.noticesScreen, 'data-testid={showNoticeDeliveryMeta ? "notice-delivery-compact-card" : "family-notice-card"}', "member and guardian compact notice card hook");
assertIncludes(sources.noticesScreen, 'data-testid="family-notice-body"', "member and guardian compact notice body hook");
assertIncludes(sources.noticesScreen, 'data-testid="family-notice-detail-toggle"', "member and guardian compact notice detail toggle hook");
assertIncludes(sources.noticesScreen, 'data-testid="family-notice-date-line"', "member and guardian compact notice date/action row hook");
assertIncludes(sources.noticesScreen, 'aria-label={`${notice.title} 내용 ${bodyExpanded ? "접기" : "펼치기"}`}', "member and guardian notice body toggle accessibility label");
assertExcludes(sources.noticesScreen, '{bodyExpanded ? "접기" : "자세히"}', "member and guardian notices remove repeated detail buttons");
assertIncludes(sources.visibleAppCopyScript, "notificationPermissionPanelHeight", "visible copy scan checks notification permission card stays absent");
assertIncludes(sources.visibleAppCopyScript, "notificationPermissionActionText", "visible copy scan checks notification setting actions stay absent");
assertIncludes(sources.noticesScreen, 'data-testid="notice-delivery-read-action"', "coach notice delivery read action test hook");
assertIncludes(sources.noticesScreen, 'data-testid={showNoticeDeliveryMeta ? "notice-delivery-compact-card" : "family-notice-card"}', "operator and family notice compact card hooks");
assertIncludes(sources.noticesScreen, 'data-testid="notice-delivery-meta-line"', "operator notice compact meta line hook");
assertIncludes(sources.noticesScreen, 'data-testid="notice-delivery-action-row"', "operator notice compact action row hook");
assertIncludes(sources.noticesScreen, 'data-testid="notice-delivery-delete-action"', "operator notice delete action test hook");
assertIncludes(sources.noticesScreen, 'data-testid="notice-delete-confirm"', "operator notice delete confirmation test hook");
assertIncludes(sources.noticesScreen, 'data-testid="notice-delete-confirm-action"', "operator notice delete confirmation action hook");
assertIncludes(sources.noticesScreen, 'data-testid="notice-delete-feedback"', "operator notice delete feedback remains visible after deletion");
assertIncludes(sources.noticeDeleteRoute, 'action: "notice.delete"', "notice delete route records audit action");
assertIncludes(sources.noticeDeleteRoute, "canDeleteNotice", "notice delete route centralizes permission checks");
assertIncludes(sources.noticePermissions, "notice.createdByUserId === user.id", "coach notice deletion is limited to owned notices");
assertIncludes(sources.noticePermissions, "canReadNotice(user, db, notice)", "notice delete helper requires readable notices");
assertIncludes(sources.noticeDeleteRoute, "requireSelectedBranchScope", "notice delete route enforces selected branch scope");
assertIncludes(sources.noticeDeleteRoute, "selectedScope.selectedBranchId !== branchId", "notice delete route rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "notice delete must reject a selected branch mismatch before deletion", "notice delete smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not delete the notice", "notice delete smoke guard preserves notice on selected branch mismatch");
assertIncludes(sources.noticeCreateRoute, "selectedScope.selectedBranchId !== branchId", "notice create route rejects selected branch mismatches");
assertIncludes(sources.noticePushRoute, "selectedScope.selectedBranchId !== branchId", "notice push route rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "notice create must reject a selected branch mismatch before validation", "notice create smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not create the notice", "notice create smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "notice push must reject a selected branch mismatch before dispatch", "notice push smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not append a notice push dispatch audit log", "notice push smoke guard avoids mismatch audit mutation");
assertIncludes(sources.branchMemberCreateRoute, "selectedScope.selectedBranchId !== branchId", "member create route rejects selected branch mismatches");
assertIncludes(sources.branchClassCreateRoute, "selectedScope.selectedBranchId !== branchId", "class create route rejects selected branch mismatches");
assertIncludes(sources.branchPaymentCreateRoute, "selectedScope.selectedBranchId !== branchId", "payment create route rejects selected branch mismatches");
assertIncludes(sources.counselingNotesRoute, "selectedScope.selectedBranchId !== branchId", "counseling note route rejects selected branch mismatches");
assertIncludes(sources.memberUpdateRoute, "selectedScope.selectedBranchId !== member.branchId", "member update route rejects selected branch mismatches");
assertIncludes(sources.memberGuardianRoute, "selectedScope.selectedBranchId !== member.branchId", "guardian link route rejects selected branch mismatches");
assertIncludes(sources.classUpdateRoute, "selectedScope.selectedBranchId !== existing.branchId", "class update route rejects selected branch mismatches");
assertIncludes(sources.paymentRefundRoute, "selectedScope.selectedBranchId !== payment.branchId", "payment refund route rejects selected branch mismatches");
assertIncludes(sources.onlineCheckoutRoute, "selectedScope.selectedBranchId !== payment.branchId", "online checkout route rejects selected branch mismatches");
assertIncludes(sources.recurringAgreementRoute, "selectedScope.selectedBranchId !== payment.branchId", "recurring agreement route rejects selected branch mismatches");
assertIncludes(sources.adminBranchUpdateRoute, "selectedScope.selectedBranchId !== branchId", "admin branch update route rejects selected branch mismatches");
assertIncludes(sources.adminBranchOwnerRoute, "selectedScope.selectedBranchId !== branchId", "admin branch owner route rejects selected branch mismatches");
assertIncludes(
  sources.adminInvitationRoute,
  "branchIds.some((branchId) => branchId !== selectedScope.selectedBranchId)",
  "admin invitation route rejects selected branch mismatches",
);
assertIncludes(
  sources.adminUserInvitationApproveRoute,
  "!targetUser.branchIds.includes(selectedScope.selectedBranchId)",
  "admin invitation approval route rejects selected branch mismatches",
);
assertIncludes(
  sources.adminUserPasswordRoute,
  "!targetUser.branchIds.includes(selectedScope.selectedBranchId)",
  "admin password route rejects selected branch mismatches",
);
assertIncludes(
  sources.adminUserRoute,
  "!targetUser.branchIds.includes(selectedScope.selectedBranchId)",
  "admin user route rejects selected branch mismatches for target users",
);
assertIncludes(
  sources.adminUserRoute,
  "!nextBranchIds.includes(selectedScope.selectedBranchId)",
  "admin user route rejects branch reassignment outside selected branch scope",
);
assertIncludes(
  sources.adminUserRoleRoute,
  "!targetUser.branchIds.includes(selectedScope.selectedBranchId)",
  "admin role route rejects selected branch mismatches",
);
assertIncludes(sources.smokeApi, "member create must reject a selected branch mismatch before validation", "member create smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not create the member", "member create smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "class create must reject a selected branch mismatch before validation", "class create smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not create the class", "class create smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "payment create must reject a selected branch mismatch before validation", "payment create smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not create the payment", "payment create smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "counseling note create must reject a selected branch mismatch before validation", "counseling note smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not create the counseling note", "counseling note smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "member update must reject a selected branch mismatch before validation", "member update smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not update the member", "member update smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "guardian link must reject a selected branch mismatch before validation", "guardian link smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not link the guardian", "guardian link smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "class update must reject a selected branch mismatch before validation", "class update smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not update the class", "class update smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "payment refund must reject a selected branch mismatch before validation", "payment refund smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not refund the payment", "payment refund smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "online checkout must reject a selected branch mismatch before provider preparation", "online checkout smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not create an online checkout", "online checkout smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "recurring agreement create must reject a selected branch mismatch before validation", "recurring agreement create smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not create a recurring agreement", "recurring agreement create smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "recurring agreement cancel must reject a selected branch mismatch before validation", "recurring agreement cancel smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not cancel the recurring agreement", "recurring agreement cancel smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "admin branch update must reject a selected branch mismatch", "admin branch update smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not update the admin branch", "admin branch update smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "admin branch owner assignment must reject a selected branch mismatch", "admin branch owner smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not assign the branch owner", "admin branch owner smoke guard avoids mismatch audit mutation");
assertIncludes(sources.smokeApi, "admin invitation create must reject a selected branch mismatch", "admin invitation smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not create the invitation", "admin invitation smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "admin invitation approval must reject a selected branch mismatch", "admin invitation approval smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "admin password issue must reject a selected branch mismatch", "admin password issue smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not issue a password", "admin password issue smoke guard preserves audit state on selected branch mismatch");
assertIncludes(sources.smokeApi, "admin user update must reject a selected branch mismatch", "admin user update smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not update the admin user", "admin user update smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "admin role update must reject a selected branch mismatch", "admin role update smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not update the user role", "admin role update smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.smokeApi, "admin user delete must reject a selected branch mismatch", "admin user delete smoke guard rejects selected branch mismatches");
assertIncludes(sources.smokeApi, "selected branch mismatch must not delete the user", "admin user delete smoke guard preserves data on selected branch mismatch");
assertIncludes(sources.noticesScreen, 'className="inline-flex h-11 w-11 items-center justify-center gap-1.5', "operator notice delete action stays compact on mobile");
assertIncludes(sources.noticesScreen, '<span className="sr-only sm:not-sr-only">삭제</span>', "operator notice delete action shows the text label on wider screens");
assertIncludes(sources.noticesScreen, 'grid gap-2 sm:flex sm:items-start sm:justify-between sm:gap-2', "operator notice mobile action row stacks below title content");
assertIncludes(sources.noticesScreen, 'data-notice-action-layout="stacked-mobile"', "operator notice action layout has a regression hook");
assertIncludes(sources.noticesScreen, 'data-testid="notice-bottom-safe-area"', "operator notice screen keeps mobile bottom safe-area spacer");
assertIncludes(sources.noticesScreen, "${formatDateTime(notice.createdAt)} · 읽음 ${getNoticeReadCount(notice)}명", "operator notice meta merges date and read count");
assertIncludes(sources.noticesScreen, "line-clamp-1 break-words text-[13px] leading-5", "operator notice body stays compact");
assertExcludes(sources.noticesScreen, "notice-delivery-date-line", "operator notice avoids separate date line");
assertExcludes(sources.noticesScreen, "border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800", "operator notice audience chip removed");
assertExcludes(sources.noticesScreen, "border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800", "operator notice target chip removed");
assertIncludes(sources.noticesScreen, 'data-testid="notice-create-form"', "owner and admin notice create form test hook");
assertIncludes(sources.noticesScreen, 'data-testid="notice-create-title-input"', "owner and admin notice title input test hook");
assertIncludes(sources.noticesScreen, 'data-testid="notice-create-submit"', "owner and admin notice submit test hook");
assertIncludes(sources.noticesScreen, 'className="order-1 grid h-fit gap-4 xl:order-2"', "notice composer appears before delivery cards on mobile while staying in the desktop side rail");
assertIncludes(sources.visibleAppCopyScript, "noticeCreatePanelTop < layout.noticeFirstDeliveryCardTop", "visible copy scan checks mobile notice composer order");
assertIncludes(sources.noticesScreen, "normalizeNoticeMemberSearchText", "notice personal target search normalizes member queries");
assertIncludes(sources.noticeMemberSearch, 'normalize("NFKC")', "notice personal target search normalizes composed and full-width text");
assertIncludes(sources.noticeMemberSearch, "[^\\p{L}\\p{N}]+", "notice personal target search ignores spaces, hyphens, and punctuation");
assertIncludes(sources.noticeMemberSearch, "getHangulInitialSearchText", "notice personal target search supports Korean initial consonant queries");
assertIncludes(sources.noticeMemberSearch, "matchesNoticeMemberSearch", "notice personal target search uses centralized matching");
assertIncludes(sources.noticesScreen, 'className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"', "owner and admin notice title input touch target");
assertIncludes(sources.noticesScreen, 'className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700"', "owner and admin notice audience chips touch target");
assertIncludes(sources.noticesScreen, 'className="min-h-11"', "owner and admin notice submit touch target");
assertExcludes(sources.requestsScreen, "공지 대상", "requests screen no longer embeds notice authoring");
assertExcludes(sources.requestsScreen, 'placeholder="공지 내용"', "requests screen no longer embeds notice body fields");
assertExcludes(sources.requestsScreen, "apiClient.getNotices(context)", "requests screen no longer fetches notices");
assertExcludes(sources.requestsScreen, "공지함", "requests screen no longer embeds the notice inbox");
assert(!existsSync(files.requestsScreen), "deleted requests screen file must not be restored");
for (const snippet of [
  'type RequestStatusFilter = "all" | "pending" | "completed";',
  'params.get("status")',
  'testId: "request-status-filter-pending"',
  '"operator-request-card"',
  'data-request-status={request.status}',
  'member-request-create-panel',
  'member-request-form',
]) {
  assertExcludes(sources.requestsScreen, snippet, "deleted requests screen must not keep request filters, forms, or cards");
}
assertIncludes(sources.noticesScreen, 'data-testid="notices-screen"', "notices route has a dedicated screen hook");
assertIncludes(sources.visibleAppCopyScript, "requestsScreenCount", "visible copy scan detects dedicated requests screen");
assertIncludes(sources.visibleAppCopyScript, "notificationRequestDetailLinkCount", "visible copy scan checks deleted request notification links");
assertIncludes(sources.visibleAppCopyScript, "must not expose the deleted request compose flow", "visible copy scan blocks deleted request compose flow");
assertIncludes(sources.visibleAppCopyScript, "noticesScreenCount", "visible copy scan detects dedicated notices screen");
assertIncludes(sources.visibleAppCopyScript, "notificationsScreenCount", "visible copy scan detects dedicated notifications screen");
assertIncludes(sources.visibleAppCopyScript, "notificationSummaryCardCount", "visible copy scan detects duplicate notification summary cards");
assertIncludes(sources.visibleAppCopyScript, "notificationDuplicateSummaryTextCount", "visible copy scan detects duplicate notification summary helper text");
assertIncludes(sources.visibleAppCopyScript, "must not render the requests screen inside notices", "visible copy scan blocks requests embedded in notices");
assertIncludes(sources.roles, 'id: "notices"', "dedicated notices route");
assertIncludes(sources.roles, 'href: "/app/notices"', "dedicated notices route href");
assertIncludes(sources.roles, 'aliases: ["/app/notifications"]', "legacy notifications route is owned by notices");
assertIncludes(sources.roles, 'label: "공지"', "dedicated notices route label");
assertIncludes(sources.roles, 'description: "공지 목록과 읽음 상태"', "dedicated notices route description");
assertIncludes(sources.roles, 'roles: ["member", "guardian", "coach", "owner", "admin"]', "dedicated notices route visibility");
assertIncludes(sources.roles, "isRouteActive", "route aliases stay active in navigation");
assertIncludes(sources.appShell, "isRouteActive(route, pathname)", "app shell uses alias-aware active navigation");
assertIncludes(sources.notificationsAliasRoute, "NotificationsScreen", "notifications route renders the dedicated notification inbox");
assertIncludes(sources.notificationsScreen, 'data-testid="notifications-screen"', "notifications screen has a dedicated screen hook");
assertIncludes(sources.notificationsScreen, "notification-filter-unread", "notifications screen exposes unread filtering");
assertIncludes(sources.notificationsScreen, "grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7.25rem]", "notifications screen keeps read action compact beside filters");
assertIncludes(sources.notificationsScreen, 'data-testid="notification-filter-toolbar"', "notifications screen exposes flat filter toolbar for mobile QA");
assertIncludes(sources.notificationsScreen, "flex min-w-0 flex-wrap gap-1.5", "notifications screen keeps filters as a flat wrapping toolbar");
assertExcludes(sources.notificationsScreen, 'className="min-w-0 rounded-md border border-zinc-200 bg-white p-0.5"', "notifications screen must not restore nested filter card frame");
assertIncludes(sources.notificationsScreen, 'className="whitespace-nowrap"', "notifications screen keeps compact filter labels on one line");
assertIncludes(sources.notificationsScreen, 'ariaLabel: "공지 미확인"', "notifications screen unread filter exposes notice-only scope to assistive tech");
assertIncludes(sources.notificationsScreen, 'label: "미확인"', "notifications screen unread filter uses compact visible copy");
assertExcludes(sources.notificationsScreen, 'label: "공지 미확인"', "notifications screen unread filter avoids repeated visible notice wording");
assertIncludes(sources.notificationsScreen, 'const showKindBadge = item.kind !== "notice";', "notifications screen hides repeated notice kind badges");
assertIncludes(sources.notificationsScreen, 'data-testid="notification-kind-badge"', "notifications screen marks remaining kind badges");
assertIncludes(sources.notificationsScreen, 'data-testid="notification-bottom-safe-area"', "notifications screen keeps mobile bottom safe-area spacer");
assertIncludes(sources.notificationsScreen, 'item.kind === "notice" && !item.read', "notifications screen unread filter only targets unread notices");
assertIncludes(sources.notificationsScreen, "notification-bulk-read-filtered", "notifications screen exposes filtered read action");
assertIncludes(sources.notificationsScreen, "notificationBulkReadAriaLabel", "notifications screen bulk read action explains notice-only scope");
assertIncludes(sources.notificationsScreen, "읽음 처리", "notifications screen bulk read action uses compact visible copy");
assertIncludes(sources.notificationsScreen, "읽음 완료", "notifications screen bulk read action shows done copy when no unread notices remain");
assertIncludes(sources.notificationsScreen, 'className="sr-only sm:not-sr-only"', "notifications screen hides bulk read text on narrow mobile while preserving accessible text");
assertIncludes(sources.notificationsScreen, "data-notification-bulk-read-state", "notifications screen exposes active/done bulk read state");
assertExcludes(sources.notificationsScreen, "공지 읽음 처리", "notifications screen bulk read action avoids repeated visible notice wording");
assertIncludes(sources.notificationsScreen, "공지 읽음 상태를 저장하지 못했습니다.", "notifications screen bulk read failure copy stays notice-scoped");
assertIncludes(sources.notificationsScreen, 'data-notification-read-state={readNotice ? "read" : "active"}', "notifications screen marks confirmed notice cards for tone-down styling");
assertIncludes(sources.notificationsScreen, "const importantBadgeClass = readNotice", "notifications screen tones down important badges after confirmation");
assertIncludes(sources.notificationsScreen, "const readStateBadgeClass = item.read", "notifications screen tones down confirmed state badges");
assertIncludes(sources.notificationsScreen, "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2", "notifications screen keeps per-row actions beside notification copy on mobile");
assertIncludes(sources.notificationsScreen, "flex shrink-0 flex-col items-end gap-1.5", "notifications screen keeps per-row action buttons from expanding notification height");
assertIncludes(sources.notificationsScreen, "line-clamp-1 text-xs leading-5", "notifications screen keeps notification body previews to one compact line");
assertIncludes(sources.notificationsScreen, "line-clamp-1 text-[11px] font-medium leading-4", "notifications screen keeps notification metadata to one compact line");
assertExcludes(sources.notificationsScreen, "PaymentStatusBadge", "notifications screen must not restore duplicate payment status badges inside notification cards");
assertIncludes(sources.notificationsScreen, "border-zinc-200 bg-zinc-50 text-zinc-500", "notifications screen confirmed badges use muted zinc styling");
assertIncludes(sources.appStore, "markNoticeAsRead: (noticeId: string) => Promise<boolean>", "single notification read action reports persistence result");
assertIncludes(sources.notificationsScreen, "readNoticePendingId", "notifications screen exposes single read pending state");
assertIncludes(sources.notificationsScreen, "handleMarkNotificationAsRead", "notifications screen awaits single notice read persistence");
assertIncludes(sources.notificationsScreen, "공지 확인을 저장했습니다.", "notifications screen confirms single notice read persistence");
assertIncludes(sources.notificationsScreen, "공지 확인 상태를 저장하지 못했습니다.", "notifications screen handles single notice read failure");
assertIncludes(sources.notificationsScreen, 'data-testid="notification-read-feedback"', "notifications screen exposes single notice read feedback");
assertIncludes(sources.notificationsScreen, 'readPending ? "저장 중" : "확인"', "notifications screen keeps a visible single read pending label");
assertIncludes(sources.notificationsScreen, 'data-testid="notification-notice-content-link"', "notifications screen keeps notice content tappable after removing repeated view buttons");
assertIncludes(sources.notificationsScreen, 'item.kind !== "notice"', "notifications screen keeps detail action buttons off repeated notice alerts");
for (const snippet of [
  "NotificationPermissionPanel",
  'data-testid="notification-settings-jump"',
  'href="#notification-permission-panel"',
  "showNotificationSettings",
]) {
  assertExcludes(sources.notificationsScreen, snippet, "notifications screen must not restore removed settings cards");
}
assertIncludes(sources.notificationsScreen, "data-notification-action-label={item.actionLabel}", "notification action labels are exposed for visible regression checks");
for (const snippet of [
  "requestNotificationTarget",
  'actionLabel: `${typeLabel} ${isFamilyNotificationUser(user) ? "확인" : "처리"}`',
  'href: isFamilyNotificationUser(user) ? "/app/requests" : "/app/requests?status=pending"',
  "buildRequestNotification(request, context.user)",
  'testId: "request-status-filter-pending"',
  '"operator-request-card"',
]) {
  assertExcludes(`${sources.notificationsScreen}\n${sources.requestsScreen}`, snippet, "deleted request notifications and cards must stay removed");
}
assertIncludes(
  sources.noticesScreen,
  "const showNoticeAside = canPublishNotice;",
  "notice screen keeps publisher side panel limited to composer after removing notification settings",
);
assertExcludes(sources.noticesScreen, "showNoticeSettings", "notice screen must not keep the old notification settings visibility gate");
assertExcludes(sources.noticesScreen, "NotificationPermissionPanel", "notice screen must not restore the notification settings card");
assertIncludes(sources.notificationSubscriptionsRoute, "familyNotificationAlwaysOnRoles", "notification subscription API keeps family notifications always on");
assertIncludes(sources.notificationSubscriptionsRoute, "family_notification_always_on", "notification subscription API audits family always-on policy");
assertIncludes(sources.notificationSubscriptionsRoute, "enforcedAlwaysOn: true", "notification subscription API reports enforced family always-on policy");
assertIncludes(sources.pushHelper, "getVisibleActivePushSubscriptionCount", "notification subscription count visibility is centralized");
assertIncludes(
  sources.notificationSubscriptionsRoute,
  "getVisibleActivePushSubscriptionCount(nextDb, user)",
  "notification subscription API returns role-scoped active subscription counts",
);
assertIncludes(
  sources.notificationSubscriptionsRoute,
  "회원/학부모 알림 수신은 항상 켜짐으로 유지했습니다.",
  "notification subscription API uses user-facing family always-on copy",
);
assertIncludes(sources.visibleAppCopyScript, "notificationSettingsJumpHeight", "visible copy scan checks notification settings shortcut touch height");
assertIncludes(sources.visibleAppCopyScript, "notificationSettingsJumpHref", "visible copy scan checks notification settings shortcut anchor");
assertIncludes(sources.visibleAppCopyScript, "notificationInboxCardMaxHeight", "visible copy scan checks compact notification card height");
assertIncludes(sources.visibleAppCopyScript, "notificationBottomSafeAreaCount", "visible copy scan checks notification bottom safe-area spacer");
assertIncludes(
  sources.visibleAppCopyScript,
  "notificationBottomActionClearanceAtScrollEnd",
  "visible copy scan checks bottom notification action clearance",
);
assertIncludes(
  sources.visibleAppCopyScript,
  "notificationBottomCardClearanceAtScrollEnd",
  "visible copy scan checks bottom notification card clearance",
);
assertIncludes(
  sources.visibleAppCopyScript,
  "notificationBottomCardClearanceAtScrollEnd >= 96",
  "visible copy scan requires bottom notification card breathing room above mobile navigation",
);
assertIncludes(sources.visibleAppCopyScript, "notificationNoticeKindBadgeCount", "visible copy scan checks repeated notice kind badges stay hidden");
assertIncludes(sources.visibleAppCopyScript, "notificationPaymentKindBadgeCount", "visible copy scan checks payment kind badges remain visible");
assertIncludes(sources.visibleAppCopyScript, "notificationNoticeDetailLinkCount", "visible copy scan checks repeated notice view buttons stay removed");
assertIncludes(sources.visibleAppCopyScript, "notificationNoticeContentLinkCount", "visible copy scan checks notice content remains tappable");
assertIncludes(sources.visibleAppCopyScript, "notificationReadActionMinHeight", "visible copy scan checks single notification read action touch height");
assertIncludes(sources.visibleAppCopyScript, "notificationReadFeedbackCount", "visible copy scan checks single notification read feedback visibility");
assertIncludes(sources.visibleAppCopyScript, "verifyNotificationReadToneDown", "visible copy scan clicks notification read actions and verifies tone-down");
assertIncludes(sources.visibleAppCopyScript, "notificationReadInteractionReadNoticeCardToneDownCount", "visible copy report records post-click read notice tone-down counts");
assertIncludes(sources.visibleAppCopyScript, "notificationReadInteractionBulkReadButtonText", "visible copy report records post-click bulk read button copy");
assertIncludes(sources.visibleAppCopyScript, "notificationReadInteractionBulkReadButtonDisabled", "visible copy report records post-click bulk read disabled state");
assertIncludes(sources.visibleAppCopyScript, "resetVisibleCopyDevData", "visible copy scan resets local dev data around notification read clicks");
assertIncludes(
  sources.visibleAppCopyScript,
  "resetOwnedSmokeServer",
  "visible copy scan uses the centralized owned reset helper for isolated DB cleanup",
);
assertIncludes(sources.visibleAppCopyScript, "assertNoticeMutationSnapshotRestored", "visible copy scan verifies notification read clicks do not persist test state");
assertIncludes(sources.visibleAppCopyScript, "shouldRunVisibleCopyScan", "visible copy scan validates CLI arguments before running browser interactions");
assertIncludes(sources.visibleAppCopyScript, "The scan accepts no positional arguments", "visible copy scan help exits without starting browser interactions");
assertIncludes(sources.visibleAppCopyScript, "cleanVisibleCopyOutputDir", "visible copy scan cleans stale screenshots before writing current evidence");
assertIncludes(sources.visibleAppCopyScript, 'entry.name.endsWith(".png")', "visible copy scan removes stale PNG screenshots from the current output folder only");
assertIncludes(sources.visibleAppCopyScript, "outputCleanup", "visible copy report records output cleanup evidence");
assertIncludes(sources.visibleAppCopyScript, "notificationPaymentCheckoutLinkCount", "visible copy scan checks notification payment checkout links");
assertIncludes(sources.notificationsScreen, "canShowPaymentNotificationForRole(context.user.role)", "notifications screen hides payment alerts from coach role");
assertIncludes(sources.notificationsScreen, "isPaymentNotificationCandidate(payment)", "notifications screen uses shared payment alert predicate");
assertExcludes(sources.notificationsScreen, "isRequestNotificationCandidate(request)", "notifications screen must not rebuild deleted request alert cards");
assertIncludes(sources.notificationsScreen, "getFamilyPaymentCheckoutAccess", "notifications screen reuses family payment checkout access rules");
assertIncludes(sources.notificationsScreen, "paymentNotificationTarget", "notifications screen selects role-safe payment alert targets");
assertIncludes(sources.notificationsScreen, "/app/payments/checkout?paymentId=", "notifications screen deep-links payable family payment alerts to checkout preparation");
const notificationPaymentTargetSource = sources.notificationsScreen.slice(
  sources.notificationsScreen.indexOf("function paymentNotificationTarget"),
  sources.notificationsScreen.indexOf("function buildPaymentNotification"),
);
assertIncludes(notificationPaymentTargetSource, 'actionLabel: checkoutAccess.label', "notifications screen reuses checkout action label for payable family users");
assertIncludes(notificationPaymentTargetSource, 'checkoutAccess.state === "guardian_required" ? "학부모 확인" : "납부 확인"', "notifications screen uses specific non-payable payment action labels");
assertExcludes(notificationPaymentTargetSource, 'actionLabel: "보기"', "payment notification fallback must not restore generic view copy");
assertIncludes(sources.notificationsScreen, "납부 정보 확인 필요", "notifications screen pending payment copy asks for payment info confirmation");
assertIncludes(
  sources.paymentCheckoutAccess,
  'label: payment.onlinePayment?.status === "pending" ? "납부 확인 중" : "납부 정보 확인"',
  "family checkout ready action uses payment-info confirmation copy",
);
assertExcludes(sources.paymentCheckoutAccess, "결제하기", "family checkout ready action must not imply live payment approval");
assertExcludes(sources.notificationsScreen, "결제 진행 필요", "notifications screen must not imply live payment progress from pending alerts");
assertExcludes(sources.notificationsScreen, "notification-summary-card", "notifications screen avoids duplicate summary cards");
assertExcludes(sources.notificationsScreen, "읽음 처리 필요", "notifications screen avoids duplicate unread summary helper");
assertExcludes(sources.notificationsScreen, "먼저 볼 항목", "notifications screen avoids duplicate important summary helper");
assertExcludes(sources.notificationsScreen, "결제/요청", "notifications screen avoids duplicate follow-up summary helper");
assertIncludes(sources.notificationsScreen, "notification-follow-up-state-badge", "notifications screen renders non-action follow-up states as badges");
assertExcludes(
  sources.notificationsScreen,
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-700",
  "notifications screen avoids button-like non-action follow-up states",
);
assertIncludes(sources.notificationAlerts, 'return role !== "coach";', "shared notification policy excludes coach payment alerts");
assertIncludes(sources.appShell, "notificationAlertCount", "app shell counts actionable notification alerts");
assertIncludes(sources.appShell, "getNotificationAlertCounts", "app shell uses shared notification counts");
assertIncludes(sources.notificationAlerts, "paymentAlertCount", "shared notification policy includes scoped payment alerts in notification count");
assertIncludes(sources.notificationAlerts, "getAccessibleMemberIds(user, db, scopeBranchIds)", "shared notification policy scopes payment alerts by role member access");
assertExcludes(sources.appShell, "requestAlertCount", "app shell must not count deleted request alerts");
assertIncludes(sources.appShell, "notificationActionableLabel", "top notification action uses typed actionable alert wording");
assertIncludes(sources.notificationAlerts, "확인 필요 결제", "shared notification label names payment follow-ups");
assertIncludes(sources.appShell, 'href="/app/notifications"', "top bell opens the notification inbox");
assertIncludes(sources.noticesAliasRoute, 'redirect("/app/notices")', "legacy root notices route redirects to the app notices menu");
assertIncludes(sources.roles, "mobileNavRouteIdsByRole", "role-specific mobile bottom navigation contract");
assertIncludes(
  sources.roles,
  'admin: ["dashboard", "adminBranches", "adminUsers", "adminRoles", "adminAuditLogs", "adminSettings"]',
  "admin mobile nav management route set",
);
assertIncludes(
  sources.roles,
  'owner: ["dashboard", "members", "payments", "notices", "ownerBranches", "ownerReports"]',
  "owner mobile nav compact route set",
);
for (const snippet of [
  'coach: ["dashboard", "classes", "members", "promotions", "notices"]',
  'guardian: ["dashboard", "classes", "members", "payments", "tournaments"]',
  'member: ["dashboard", "classes", "members", "payments", "tournaments"]',
]) {
  assertIncludes(sources.roles, snippet, "family and coach mobile navigation removes deleted requests");
}
for (const snippet of [
  "requestFeedback",
  "사유를 입력해 주세요.",
  "결석할 수업을 선택해 주세요.",
  "보강 희망 수업을 선택해 주세요.",
  "요청을 보냈습니다.",
]) {
  assertExcludes(sources.requestsScreen, snippet, "deleted request form feedback must stay removed");
}
assertExcludes(sources.noticesScreen, "발송 범위", "notice target internal range label");
assertExcludes(sources.requestsScreen, "공지 내용을 입력하세요", "request notice form avoids verbose placeholder");
assertIncludes(sources.noticesScreen, '<EmptyState title="확인할 공지가 없습니다" />', "notices title-only empty-state copy");
assertIncludes(sources.noticesScreen, '<EmptyState title="선택한 보기의 공지가 없습니다" />', "notices filtered title-only empty-state copy");
assertExcludes(sources.requestsScreen, '{canCreate ? "요청 내역" : "결석/보강 요청"}', "operator requests list avoids repeating the screen title");
assertExcludes(sources.noticesScreen, "먼저 확인할 공지", "notices action queue urgency copy");
assertExcludes(sources.noticesScreen, "공지/알림 요약", "notices slash-heavy summary heading");
assertExcludes(sources.noticesScreen, "알림 상태 확인", "notices repetitive push status label");
assertExcludes(sources.noticesScreen, "수신 상태", "notices placeholder push status label");
assertExcludes(sources.noticesScreen, "수신 상태 재확인", "notices repetitive push review label");
assertExcludes(sources.noticesScreen, "새 공지 대기 중입니다.", "notices repetitive waiting empty-state copy");
assertExcludes(sources.noticesScreen, "새 공지가 등록되면 이곳에서 확인할 수 있습니다.", "notices verbose empty-state copy");
assertExcludes(sources.noticesScreen, "새 공지가 등록되면 표시됩니다.", "notices empty-state passive copy");
assertExcludes(sources.noticesScreen, "다른 보기로 바꾸거나 새 공지를 확인해 주세요.", "notices filtered empty-state helper copy");
assertExcludes(sources.adminSettings, "회원/학부모이", "admin settings malformed guardian/member copy");
assertExcludes(sources.adminSettings, "운영 데이터", "admin settings technical data wording");
assertExcludes(sources.adminSettings, "파일럿 데이터 검증", "admin settings internal pilot data wording");
assertExcludes(sources.adminSettings, "모바일 viewport 메타데이터", "admin settings metadata wording");
assertExcludes(sources.adminSettings, "데이터 보정", "admin settings blocker placeholder data wording");
assertExcludes(sources.adminSettings, "계측 증빙", "admin settings technical evidence wording");
assertExcludes(sources.adminSettings, "모바일 출석 30초 증빙", "admin settings technical mobile attendance evidence wording");
assertExcludes(sources.adminSettings, "모바일 30초 증빙", "admin settings technical mobile attendance evidence wording");
assertExcludes(sources.adminSettings, "증빙 메모", "admin settings technical evidence memo wording");
assertExcludes(sources.adminSettings, "녹화 링크", "admin settings recording-link placeholder wording");
assertExcludes(sources.adminSettings, "기록 보정", "admin settings correction-style blocker placeholder wording");
assertExcludes(sources.adminSettings, "후속 확인 링크", "admin settings follow-up link placeholder wording");
assertExcludes(sources.adminSettings, "관련 화면 또는 동선", "admin settings route-style incident placeholder wording");
assertExcludes(sources.adminSettings, "실제 수업 수", "admin settings audit-style operation placeholder wording");
assertExcludes(sources.adminSettings, "현장 우회책/조치 메모", "admin settings workaround-style incident label");
assertExcludes(sources.adminSettings, "개발/운영 env 예시", "admin settings env shorthand wording");
assertExcludes(sources.adminSettings, "placeholder 제거", "admin settings developer placeholder label");
assertExcludes(sources.adminSettings, "증빙 주소 자리표시", "admin settings placeholder evidence wording");
assertExcludes(sources.adminSettings, "로컬/예시 origin", "admin settings technical origin wording");
assertIncludes(sources.adminSettings, "확인할 사유와 후속 조치를 기록", "admin settings app-safe blocker placeholder wording");
assertIncludes(sources.adminSettings, "모바일 출석 확인 기록", "admin settings app-safe mobile attendance evidence wording");
assertIncludes(sources.adminSettings, "확인 메모", "admin settings app-safe evidence memo wording");
assertIncludes(sources.adminSettings, "현장 확인 내용", "admin settings field-safe mobile attendance evidence placeholder");
assertIncludes(sources.adminSettings, "현장 조치 메모", "admin settings field-safe incident action label");
assertIncludes(sources.adminSettings, "현장 조치와 후속 확인 내용을 기록", "admin settings field-safe incident action placeholder");
assertIncludes(sources.adminSettings, "누락 없음", "admin settings missing operation day contextual empty copy");
assertIncludes(sources.adminSettings, "처리 시간 기록 전", "admin settings mobile timing contextual empty copy");
assertIncludes(sources.adminSettings, "확인 기록 전", "admin settings mobile evidence contextual empty copy");
assertIncludes(sources.adminSettings, "확인 메모 전", "admin settings operation evidence contextual empty copy");
assertExcludes(sources.adminSettings, ' : "없음"', "admin settings terse empty fallback");
assertExcludes(sources.adminSettings, "시간 없음", "admin settings terse time fallback");
assertExcludes(sources.adminSettings, "확인 기록 없음", "admin settings terse evidence fallback");
assertExcludes(sources.adminSettings, "확인 메모 없음", "admin settings terse memo fallback");
for (const snippet of [
  "파일럿 입력 검증",
  "모바일 화면 설정 확인",
  "환경 기준값",
  "입력 전 값 차단",
  "증빙 주소 입력 전 문구",
  "로컬/임시 주소",
  "P1 증빙 접수 초안",
  "P1 증빙 접수표 적용",
  "P1 준비 상태 집계",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings retired internal gate labels must stay out of client source");
}
assertExcludes(sources.adminSettings, "P1 릴리즈 패키지", "admin settings retired P1 release package label");
assertExcludes(sources.adminSettings, "환경 설정 예시", "admin settings avoids example environment copy");
assertExcludes(sources.adminSettings, "미작성 값 정리", "admin settings avoids missing-value copy");
assertExcludes(sources.adminSettings, "로컬/예시 주소", "admin settings avoids example address copy");
assertExcludes(sources.adminSettings, "P1 evidence intake draft", "admin settings avoids English evidence intake label");
assertExcludes(sources.adminSettings, "P1 evidence intake CSV apply", "admin settings avoids English evidence intake apply label");
assertExcludes(sources.adminSettings, "P1 readiness 집계", "admin settings avoids mixed English readiness label");
assertExcludes(sources.adminSettings, "P1 release package", "admin settings avoids English release package label");
assertExcludes(sources.adminSettings, "P3 진행 중", "admin settings retired P3 progress badge");
assertExcludes(sources.adminSettings, "P3 in progress", "admin settings avoids English progress badge");
assertIncludes(sources.roles, "export const roleAccessDescriptions", "shared role access descriptions");
assertIncludes(sources.roles, "담당 수업, 출석, 상담 메모, 보호자 안내", "shared coach role access copy");
assertIncludes(sources.roles, "자녀 수업, 출석, 결제 상태, 공지 확인", "shared guardian role access copy");
assertExcludes(sources.roles, "자녀 수업, 출석, 보강, 결제 상태, 공지 확인", "shared guardian role access copy must not restore request wording");
assertExcludes(sources.domain, '| "request"', "domain audit target type must not restore deleted request target");
assertIncludes(sources.adminSettings, "roleAccessDescriptions[role]", "admin settings role access rendering");
assertExcludes(
  sources.adminSettings,
  "rbacRoleLabels[roleToRbacRole[role]]",
  "admin settings duplicate role label rendering",
);
assertIncludes(sources.adminUsersScreen, 'import { getVisibleUserEmail } from "@/lib/user-display";', "admin users seed email display guard");
assertIncludes(sources.adminUsersScreen, 'import { matchesMemberSearch } from "@/lib/notice-member-search";', "admin users member link search uses shared matcher");
assertIncludes(sources.adminUsersScreen, "email: getVisibleUserEmail(user.email) ?? \"\"", "admin users edit draft seed email blank guard");
assertIncludes(sources.adminUsersScreen, 'memberLinkSearch: ""', "admin users edit draft resets member link search state");
assertIncludes(sources.adminUsersScreen, "phone: formatPhoneNumber(user.phone ?? \"\")", "admin users edit draft seed phone guard");
assertIncludes(sources.adminUsersScreen, "getVisibleUserEmail(user.email) ?? \"\"", "admin users .test seed email hidden");
assertIncludes(sources.userDisplay, 'normalizedEmail.toLowerCase().endsWith(".test")', "shared user email display guard hides test-domain seed emails");
assertExcludes(sources.adminUsersScreen, "@finaljudo.test", "admin users visible seed email literals");
const legacyPersonalAdminEmail = [["tmv", "kdl", "xm12"].join(""), "naver.com"].join("@");
const legacySequentialSeedPhonePrefix = ["010", "1000", "000"].join("");
const legacyAppInternalSeedPhonePrefix = "010500110";
const legacyAppInternalSeedPhoneE164Prefix = "+8210500110";
const legacyPreflightEmergencyContact = ["010", "1000", "2000"].join("-");
const legacyInternalPreflightEmergencyContact = ["010", "5001", "2001"].join("-");

for (const [label, source, expectedCredential] of [
  ["mock data default user emails", sources.mockData, "@finaljudo.kr"],
  ["runtime database default user emails", sources.runtimeDb, "@finaljudo.kr"],
  ["PostgreSQL seed default user emails", sources.seedSql, "@finaljudo.kr"],
  ["route smoke default login emails", sources.routeSmoke, "@finaljudo.kr"],
  ["API smoke default login emails", sources.smokeApi, "@finaljudo.kr"],
  ["mobile E2E default login phone", sources.mobileE2e, "01031967428"],
  ["attendance speed smoke default login emails", sources.attendanceSpeedSmoke, "@finaljudo.kr"],
  ["README default account emails", sources.readme, "@finaljudo.kr"],
  ["pilot operations runbook seed emails", sources.pilotOperationsRunbook, "@finaljudo.kr"],
  ["pilot data intake template emails", sources.pilotDataIntake, "@finaljudo.kr"],
  ["production preflight fixture contacts", sources.productionPreflightTest, "010-3482-6159"],
]) {
  assertExcludes(source, "@finaljudo.test", label);
  assertExcludes(source, legacyPersonalAdminEmail, label);
  assertExcludes(source, legacySequentialSeedPhonePrefix, label);
  assertExcludes(source, legacyAppInternalSeedPhonePrefix, label);
  assertExcludes(source, legacyAppInternalSeedPhoneE164Prefix, label);
  assertExcludes(source, legacyPreflightEmergencyContact, label);
  assertExcludes(source, legacyInternalPreflightEmergencyContact, label);
  assertIncludes(source, expectedCredential, label);
}

for (const [label, source] of [
  ["pilot data intake template", sources.pilotDataIntake],
  ["pilot feedback form template", sources.pilotFeedbackForm],
]) {
  for (const snippet of ["결석/보강 요청", "보강 요청 확인", "주말 보강 안내"]) {
    assertExcludes(source, snippet, `${label} deleted request copy`);
  }
}
	for (const snippet of [
	  'data-testid="admin-user-summary-grid"',
	  "useSearchParams",
	  "function getUserQueryFromParams",
	  "function getRoleFilterFromParams",
	  "previousListFilterParamRef",
	  'window.history.replaceState(null, "", nextUrl)',
	  'id="admin-user-search"',
	  'data-testid="admin-user-search-input"',
	  'data-testid="admin-user-search-clear"',
	  'data-testid="admin-user-list-status-label"',
	  'data-testid="admin-user-empty-filter-state"',
	  'data-testid="admin-user-empty-filter-reset"',
	  'data-testid="admin-user-role-filter-reset"',
	  'placeholder="사용자, 휴대폰, 역할, 회원 검색"',
	  "function getLinkedUserMembers",
	  "function getLinkedMemberDisplay",
	  "function getLinkedMemberSummary",
	  "linkedMembersByUserId.get(user.id)",
	  "matchesMemberSearch(keyword",
	  'data-testid={`admin-user-linked-member-summary-${user.id}`}',
	  "const branchSummary =",
	  "grid grid-cols-3 gap-2",
	  "inviteFormOpen",
	  'data-testid="admin-user-invite-toggle"',
	  'data-testid="admin-user-invite-panel"',
  'id="admin-user-invite-form"',
  '{inviteFormOpen ? "닫기" : "초대"}',
  "function sortUsersForInvitationReview",
  "return [...pendingUsers, ...activeUsers]",
  'data-admin-user-invitation-status={user.invitationStatus ?? "accepted"}',
  'data-admin-user-action="approve-invitation"',
  '<span>{approvalPending ? "승인 중" : "승인"}</span>',
  "approvalConfirmUserId",
  "window.location.hash.slice(1).match(/^(edit|approve)-(.+)$/)",
  "function openInvitationApprovalConfirm",
  'data-admin-user-approval-confirmation="visible"',
  'data-admin-user-action="confirm-approve-invitation"',
  'data-admin-user-action="cancel-approve-invitation"',
  "승인 확정",
	  "passwordResetOpenUserId",
	  'data-testid={`admin-user-password-reset-toggle-${user.id}`}',
	  "aria-expanded={resetPanelOpen}",
	  "grid grid-cols-[minmax(0,1fr)_auto]",
		  "col-start-2 row-start-1 flex w-auto flex-col items-end",
	  'data-admin-user-action="edit"',
	  'data-admin-user-action="delete"',
	  'data-admin-user-action="password-reset"',
		  'aria-label={`${user.name} ${resetPanelOpen ? "비밀번호 재발급 닫기" : "비밀번호 재발급"}`}',
		  '<span className="sr-only">{resetPanelOpen ? "비밀번호 재발급 닫기" : "비밀번호 재발급"}</span>',
		  'data-admin-user-password-edit-state="visible"',
		  'admin-user-password-edit-heading-${user.id}',
		  'data-testid={`admin-user-password-edit-section-${user.id}`}',
		  'data-testid={`admin-user-password-input-${user.id}`}',
	  'data-testid={`admin-user-password-confirm-input-${user.id}`}',
	  'data-testid={`admin-user-edit-submit-${user.id}`}',
	  'data-testid={`admin-user-edit-cancel-${user.id}`}',
	  'data-testid={`admin-user-edit-action-bar-${user.id}`}',
	  "matchesMemberSearch(memberLinkSearchQuery",
	  'data-testid={`admin-user-member-link-search-input-${user.id}`}',
	  'data-testid={`admin-user-member-link-results-${user.id}`}',
	  'data-testid={`admin-user-member-link-result-${user.id}`}',
	  'data-testid={`admin-user-member-link-selected-${user.id}`}',
	  'data-testid={`admin-user-member-link-clear-${user.id}`}',
	  'data-testid={`admin-user-guardian-child-search-input-${user.id}`}',
	  'data-testid={`admin-user-guardian-child-results-${user.id}`}',
	  'data-testid={`admin-user-guardian-child-result-${user.id}`}',
	  'data-testid={`admin-user-guardian-child-selected-list-${user.id}`}',
	  "회원 이름이나 연락처를 검색한 뒤 선택해 주세요.",
	  "자녀 이름이나 연락처를 검색해 연결해 주세요.",
	  'size="lg"',
	  "sticky bottom-28",
	  "scroll-mb-56",
		  "window.location.hash.slice(1).match(/^(edit|approve)-(.+)$/)",
	  "window.addEventListener(\"hashchange\", openHashTarget)",
	  "비밀번호 변경",
	  "선택 입력",
	  "minLength={12}",
		  "function createDeleteBlockers",
		  "function scrollUserPanelIntoView",
		  "function clearUserPanelHash",
		  "window.history.replaceState(null, \"\", `${window.location.pathname}${window.location.search}`)",
		  'scrollIntoView({ block: "start", inline: "nearest" })',
		  "scroll-mt-40",
		  "scrollUserPanelIntoView(`admin-user-delete-${user.id}`)",
		  "data-admin-user-delete-protected={canOpenDelete ? \"false\" : \"true\"}",
		  "data-admin-user-delete-blockers={deleteBlockerSummary}",
		  "현재 로그인 계정",
		  "담당 수업 연결",
	  "담당 회원 연결",
		]) {
		  assertIncludes(sources.adminUsersScreen, snippet, "admin users dense forms and password edit visibility");
		}
for (const snippet of [
  "function getInitialUserQuery",
  "function getInitialRoleFilter",
  "window.addEventListener(\"popstate\"",
]) {
  assertExcludes(sources.adminUsersScreen, snippet, "admin users search must use Next search params instead of stale window-only filters");
}
for (const snippet of [
  'data-testid="admin-user-mobile-scope-summary"',
  'data-testid="admin-user-delete-blocker-summary"',
  "const mobileScopeSummary",
  "col-start-2 row-start-1 flex w-auto flex-row",
]) {
  assertExcludes(sources.adminUsersScreen, snippet, "admin users mobile list must stay compact without repeated helper chips");
}
assertExcludes(sources.adminUsersScreen, "passwordEditOpenUserId", "admin users password edit no longer hidden behind local toggle state");
assertExcludes(sources.adminUsersScreen, 'data-testid={`admin-user-member-link-select-${user.id}`}', "admin users member link must not regress to long select dropdown");
assertExcludes(sources.adminUsersScreen, 'data-testid={`admin-user-password-edit-toggle-${user.id}`}', "admin users password edit no longer hidden behind a toggle");
assertExcludes(sources.adminUsersScreen, 'data-testid={`admin-user-password-edit-collapsed-${user.id}`}', "admin users password edit no collapsed hint");
assertIncludes(sources.adminUsersScreen, "첫 접속 비밀번호", "admin users invitation approval clarifies first-login password copy");
assertExcludes(sources.adminUsersScreen, "초기 접속 비밀번호", "admin users invitation approval avoids signup-password confusion");
assertExcludes(sources.adminUsersScreen, "전체 지점/사용자 · 전체 지점", "admin users avoids repeated global branch scope copy");
assertExcludes(sources.adminUsersScreen, "title={!canOpenDelete", "admin users protected delete reasons must not render as hover helper copy");
assertIncludes(sources.inviteAcceptScreen, "사용할 비밀번호", "invite accept app-safe password setup label");
assertIncludes(sources.inviteAcceptScreen, "비밀번호는 12자 이상이어야 합니다.", "invite accept app-safe password validation copy");
assertIncludes(sources.inviteAcceptScreen, "const result = await acceptInvitation(token, password);", "invite accept returns structured API result");
assertIncludes(sources.inviteAcceptScreen, "setError(result.message);", "invite accept shows API-safe user-facing failure message");
assertExcludes(sources.inviteAcceptScreen, "초기 비밀번호", "invite accept initial-state password copy");
assertExcludes(
  sources.inviteAcceptScreen,
  "초대 링크를 확인하지 못했습니다. 링크가 만료되었거나 이미 삭제되었을 수 있습니다.",
  "invite accept generic stale-link failure copy",
);
assertIncludes(
  sources.appStore,
  "type InvitationAcceptResult = { ok: true } | { ok: false; message: string }",
  "app store invitation accept structured result",
);
assertIncludes(
  sources.appStore,
  'const message = toUserFacingErrorMessage(error, "초대 수락을 완료하지 못했습니다.");',
  "app store invitation accept API-safe failure message",
);
for (const snippet of ['data-testid="login-signup-link"', 'href="/signup"', "회원가입"]) {
  assertIncludes(sources.loginScreen, snippet, "login phone signup entry");
}
for (const snippet of [
  "휴대폰 번호로 회원가입",
  'data-testid="phone-signup-form"',
  'data-testid="signup-name-input"',
  'data-testid="signup-phone-input"',
  'data-testid="signup-password-input"',
  'data-testid="signup-password-confirm-input"',
  "apiClient.registerWithPhone",
  'data-testid="signup-submit-button"',
  "회원가입",
]) {
  assertIncludes(sources.signupScreen, snippet, "signup route stays phone-number based");
}
for (const snippet of [
  "초대 링크로 회원가입",
  "관리자 또는 대표가 발급한 초대 링크를 입력합니다.",
  "sanitizeInvitationToken",
  "router.push(`/invite/${encodeURIComponent(token)}`)",
  "signup-invitation-input",
  "초대 가입 계속하기",
]) {
  assertExcludes(sources.signupScreen, snippet, "signup route must not regress to invitation-link entry");
}
assertIncludes(sources.signupPage, "SignupScreen", "signup page renders signup screen");
for (const snippet of ['"/login"', '"/signup"', '"/reset-password"', '"public auth routes"', '"phone signup entry route"']) {
  assertIncludes(sources.routeSmoke, snippet, "route smoke covers public auth entry routes");
}
for (const snippet of [
  '<html lang="ko" className="h-full antialiased" suppressHydrationWarning>',
  '<body className="min-h-full flex flex-col" suppressHydrationWarning>',
  "viewportFit: \"cover\"",
]) {
  assertIncludes(sources.appLayout, snippet, "root layout mobile safe-area hydration guard");
}
assertExcludes(sources.appLayout, "document.documentElement", "root layout must not mutate html styles before hydration");
assertExcludes(sources.appShell, "document.documentElement", "app shell must not mutate html styles before hydration");
for (const snippet of ["FinalJudoPilot!2026", "@finaljudo.test", "계정 채우기", "공개 계정 생성"]) {
  assertExcludes(sources.signupScreen, snippet, "signup screen avoids local seed/open signup copy");
}
assert.equal(phoneSignupRegressionGuardReport.ok, true, "phone signup regression guard report must pass");
assert.equal(phoneSignupRegressionGuardReport.authDomState?.signupLinkCount, 1, "phone signup report must confirm one login signup link");
assert.equal(phoneSignupRegressionGuardReport.authDomState?.signupLinkHref, "/signup", "phone signup report must confirm signup href");
assert.equal(phoneSignupRegressionGuardReport.signupDomState?.heading, "휴대폰 번호로 회원가입", "phone signup report must confirm phone signup heading");
assert.equal(phoneSignupRegressionGuardReport.signupDomState?.phoneInputCount, 1, "phone signup report must confirm phone input");
assert.equal(phoneSignupRegressionGuardReport.signupDomState?.passwordInputCount, 2, "phone signup report must confirm password and confirmation inputs");
assert.equal(phoneSignupRegressionGuardReport.signupDomState?.invitationInputCount, 0, "phone signup report must reject invitation input regression");
assert.equal(phoneSignupRegressionGuardReport.signupDomState?.bodyHasInvitationSignupCopy, false, "phone signup report must avoid invitation signup copy");
const authLoginRegisteredVisibleReport = visibleAppCopyStabilityReport.checked.find((entry) => entry.id === "auth-login-registered");

assert(authLoginRegisteredVisibleReport, "visible app copy report must include registered login notice route");
assert(
  authLoginRegisteredVisibleReport.authRegisteredNoticeText?.includes("회원가입이 완료되었습니다. 휴대폰 번호와 비밀번호로 로그인해 주세요."),
  "visible app copy report must confirm registered login phone/password copy",
);
assert(
  !authLoginRegisteredVisibleReport.authRegisteredNoticeText?.includes("관리자 승인"),
  "visible app copy report must reject duplicate admin approval registered copy",
);
assert.equal(authRegisteredCopyReport.ok, true, "registered login copy simulator evidence must pass");
assert.equal(authRegisteredCopyReport.surface, "/login?registered=1", "registered login copy evidence must target the registered login route");
assert.equal(
  authRegisteredCopyReport.expectedNotice,
  "회원가입이 완료되었습니다. 휴대폰 번호와 비밀번호로 로그인해 주세요.",
  "registered login copy evidence must record the phone/password notice",
);
assert(
  authRegisteredCopyReport.screenshot?.path && existsSync(authRegisteredCopyReport.screenshot.path),
  "registered login copy simulator screenshot must exist",
);
assert(
  statSync(authRegisteredCopyReport.screenshot.path).size > 10_000,
  "registered login copy simulator screenshot must be non-empty",
);
assert.equal(
  statSync(authRegisteredCopyReport.screenshot.path).size,
  authRegisteredCopyReport.screenshot.bytes,
  "registered login copy screenshot byte size must match summary",
);
assert(
  (authRegisteredCopyReport.verified ?? []).includes("관리자 승인 후 로그인 문구가 보이지 않는다"),
  "registered login copy evidence must verify duplicate approval copy is absent",
);
assert.equal(
  authRegisteredCopyReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "registered login copy evidence must not claim IPA readiness",
);
assert.equal(adminInvitationApprovalReport.ok, true, "admin invitation approval simulator evidence must pass");
assert.equal(
  adminInvitationApprovalReport.apiEvidence?.approvalEndpointVerified,
  true,
  "admin invitation approval evidence must verify the protected approval endpoint",
);
assert.equal(
  adminInvitationApprovalReport.apiEvidence?.approvedCredentialLoginVerified,
  true,
  "admin invitation approval evidence must verify approved credential login",
);
assert.equal(
  adminInvitationApprovalReport.apiEvidence?.cleanupDeletedEvidenceUser,
  true,
  "admin invitation approval evidence must clean up the temporary evidence user",
);
assert.equal(
  adminInvitationApprovalReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "admin invitation approval simulator evidence must not be treated as IPA readiness",
);
for (const screenshotPath of Object.values(adminInvitationApprovalReport.screenshots ?? {})) {
  assert(typeof screenshotPath === "string" && existsSync(screenshotPath), `${screenshotPath} must exist`);
  assert(statSync(screenshotPath).size > 10_000, `${screenshotPath} must be a non-empty invitation approval simulator screenshot`);
}
assert.equal(
  adminUsersPendingFirstReport.invitationStatus,
  "pending",
  "admin users pending-first evidence must create a pending invitation",
);
assert.equal(
  adminUsersPendingFirstReport.cleanup?.ok,
  true,
  "admin users pending-first evidence must clean up the temporary evidence user",
);
assert(
  adminUsersPendingFirstReport.screenshot && existsSync(adminUsersPendingFirstReport.screenshot),
  "admin users pending-first simulator screenshot must exist",
);
assert(
  statSync(adminUsersPendingFirstReport.screenshot).size > 10_000,
  "admin users pending-first simulator screenshot must be non-empty",
);
assert.equal(
  adminUsersApproveLabelReport.invitationStatus,
  "pending",
  "admin users approval-label evidence must create a pending invitation",
);
assert.equal(
  adminUsersApproveLabelReport.expectedVisibleActionLabel,
  "승인",
  "admin users approval-label evidence must verify the visible approve label",
);
assert.equal(
  adminUsersApproveLabelReport.cleanup?.ok,
  true,
  "admin users approval-label evidence must clean up the temporary evidence users",
);
assert(
  adminUsersApproveLabelReport.screenshot && existsSync(adminUsersApproveLabelReport.screenshot),
  "admin users approval-label simulator screenshot must exist",
);
assert(
  statSync(adminUsersApproveLabelReport.screenshot).size > 10_000,
  "admin users approval-label simulator screenshot must be non-empty",
);
assert.equal(adminInviteLinkActionsReport.ok, true, "admin invite link actions simulator evidence must pass");
assert.equal(
  adminInviteLinkActionsReport.cleanup?.deleted,
  true,
  "admin invite link actions evidence must clean up the temporary evidence user",
);
assert.equal(
  adminInviteLinkActionsReport.browserPlugin?.blockedByPolicy,
  true,
  "admin invite link actions evidence must record blocked Browser plugin local access",
);
assert.equal(
  adminInviteLinkActionsReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "admin invite link actions evidence must not be treated as IPA readiness",
);
assert(
  adminInviteLinkActionsReport.screenshot && existsSync(adminInviteLinkActionsReport.screenshot),
  "admin invite link actions simulator screenshot must exist",
);
assert(
  statSync(adminInviteLinkActionsReport.screenshot).size > 10_000,
  "admin invite link actions simulator screenshot must be non-empty",
);
const staleAdminInvitationEvidenceUsers = (runtimeDb.users ?? []).filter((user) =>
  [
    /승인확인검증/,
    /승인라벨검증/,
    /ios-pending-first/,
    /admin-users-approval-confirm/,
    /approve-label/,
    /pending-first/,
  ].some((pattern) => pattern.test(`${user.id} ${user.name ?? ""} ${user.email ?? ""} ${user.phone ?? ""}`)),
);
assert.deepEqual(
  staleAdminInvitationEvidenceUsers.map((user) => user.id),
  [],
  "runtime DB must not keep temporary admin invitation evidence users",
);
assert.equal(notificationsInboxEvidenceReport.ok, true, "notifications inbox simulator evidence must pass");
assert.equal(notificationsInboxEvidenceReport.surface, "/app/notifications", "notifications inbox evidence must target /app/notifications");
assert.equal(notificationsInboxEvidenceReport.role, "member", "notifications inbox evidence must cover the member app");
assert(
  notificationsInboxEvidenceReport.screenshot?.path && existsSync(notificationsInboxEvidenceReport.screenshot.path),
  "notifications inbox simulator screenshot must exist",
);
assert(
  statSync(notificationsInboxEvidenceReport.screenshot.path).size > 10_000,
  "notifications inbox simulator screenshot must be non-empty",
);
assert(
  (notificationsInboxEvidenceReport.verified ?? []).includes("dedicated notification inbox renders instead of notices alias"),
  "notifications inbox evidence must verify the dedicated screen",
);
assert(
  (notificationsInboxEvidenceReport.verified ?? []).includes("duplicate summary cards are removed"),
  "notifications inbox evidence must verify duplicate summary card removal",
);
assert(
  (notificationsInboxEvidenceReport.verified ?? []).includes("non-action follow-up state renders as a badge, not a touch button"),
  "notifications inbox evidence must verify non-action follow-up state treatment",
);
assertIncludes(
  notificationsInboxEvidenceReport.releaseDecision,
  "internal simulator evidence only",
  "notifications inbox evidence must not be treated as release readiness",
);
assert.equal(notificationPaymentCopyEvidenceReport.ok, true, "notification payment copy mobile evidence must pass");
assertIncludes(
  notificationPaymentCopyEvidenceReport.browserPath,
  "Playwright fallback used",
  "notification payment copy evidence must record Browser fallback",
);
const guardianNotificationPaymentCopyCase = notificationPaymentCopyEvidenceReport.cases?.find((testCase) => testCase.role === "guardian");
assert(guardianNotificationPaymentCopyCase, "notification payment copy evidence must cover guardian role");
assert.equal(
  guardianNotificationPaymentCopyCase.pendingPaymentSeed?.checkoutStatus,
  "pending",
  "guardian payment copy evidence must seed a pending checkout",
);
assert(
  (guardianNotificationPaymentCopyCase.beforeState?.paymentTitles ?? []).includes("한유나 납부 정보 확인 필요"),
  "guardian payment copy evidence must show pending payment info-confirmation title",
);
assert(
  (guardianNotificationPaymentCopyCase.beforeState?.paymentActionLabels ?? []).includes("납부 확인 중"),
  "guardian payment copy evidence must show pending payment confirmation action copy",
);
assert(
  (guardianNotificationPaymentCopyCase.beforeState?.paymentActionLabels ?? []).includes("납부 정보 확인"),
  "guardian payment copy evidence must show payable payment info-confirmation action copy",
);
assert(
  !/결제 진행 필요|결제 진행 중|결제하기/.test(guardianNotificationPaymentCopyCase.beforeState?.inboxText ?? ""),
  "guardian payment copy evidence must not imply live payment progress",
);
assert(
  guardianNotificationPaymentCopyCase.beforeScreenshotPath && existsSync(guardianNotificationPaymentCopyCase.beforeScreenshotPath),
  "guardian payment copy browser screenshot must exist",
);
assert(
  statSync(guardianNotificationPaymentCopyCase.beforeScreenshotPath).size > 10_000,
  "guardian payment copy browser screenshot must be non-empty",
);
assert.equal(noticeNotificationNavLabelReport.ok, true, "notice/notification nav label evidence must pass");
assert.equal(
  noticeNotificationNavLabelReport.policy?.noticesPath?.expectedLabel,
  "공지",
  "notice/notification nav label evidence must record notices path label",
);
assert.equal(
  noticeNotificationNavLabelReport.policy?.notificationsPath?.expectedLabel,
  "알림",
  "notice/notification nav label evidence must record notifications path label",
);
for (const [id, expected] of [
  ["admin-notices", { label: "공지", href: "/app/notices" }],
  ["owner-notices", { label: "공지", href: "/app/notices" }],
  ["coach-notices", { label: "공지", href: "/app/notices" }],
  ["member-notices", { label: "공지", href: "/app/notices" }],
  ["guardian-notices", { label: "공지", href: "/app/notices" }],
  ["member-notifications", { label: "알림", href: "/app/notifications" }],
  ["guardian-notifications", { label: "알림", href: "/app/notifications" }],
  ["member-dashboard", { label: "알림", href: "/app/notifications" }],
  ["guardian-dashboard", { label: "알림", href: "/app/notifications" }],
]) {
  const page = noticeNotificationNavLabelReport.visibleCopyBottomNav?.[id];

  assert(page, `notice/notification nav label evidence must include ${id}`);
  assert.equal(page.mobileBottomNavNoticeLabel, expected.label, `${id} nav label evidence must match the path policy`);
  assert.equal(page.mobileBottomNavNoticeHref, expected.href, `${id} nav href evidence must match the path policy`);
}
for (const screenshot of Object.values(noticeNotificationNavLabelReport.iosScreenshots ?? {})) {
  assert(screenshot?.path && existsSync(screenshot.path), "notice/notification nav iOS screenshot must exist");
  assert(screenshot.sizeBytes > 10_000, "notice/notification nav iOS screenshot summary must record a non-empty image");
  assert(statSync(screenshot.path).size === screenshot.sizeBytes, "notice/notification nav iOS screenshot summary size must match disk");
}
assert.equal(notificationInboxDensityEvidenceReport.ok, true, "notification inbox density evidence must pass");
assert.equal(
  notificationInboxDensityEvidenceReport.surface,
  "/app/notifications",
  "notification inbox density evidence must target /app/notifications",
);
assert.deepEqual(
  notificationInboxDensityEvidenceReport.roles?.sort(),
  ["guardian", "member"],
  "notification inbox density evidence must cover member and guardian roles",
);
assert(
  notificationInboxDensityEvidenceReport.policy?.includes("compact") &&
    notificationInboxDensityEvidenceReport.policy?.includes("settings card") &&
    notificationInboxDensityEvidenceReport.policy?.includes("tappable"),
  "notification inbox density evidence must record the compact inbox and removed settings card policy",
);
for (const screenshot of [
  notificationInboxDensityEvidenceReport.memberScreenshot,
  notificationInboxDensityEvidenceReport.guardianScreenshot,
]) {
  assert(screenshot?.path && existsSync(screenshot.path), "notification inbox density screenshot must exist");
  assert(statSync(screenshot.path).size > 10_000, "notification inbox density screenshot must be non-empty");
  assert(screenshot.bytes > 10_000, "notification inbox density summary must record non-empty screenshots");
  assert.equal(
    statSync(screenshot.path).size,
    screenshot.bytes,
    "notification inbox density screenshot byte size must match summary",
  );
}
for (const expected of [
  "member notification inbox renders compact filter and read action in one row",
  "guardian notification inbox renders compact filter and read action in one row",
  "notification settings card remains removed for family roles",
  "payable payment alert still exposes the checkout action",
  "local Simulator evidence is not IPA ready or operating ready",
]) {
  assert(
    (notificationInboxDensityEvidenceReport.verified ?? []).includes(expected),
    `notification inbox density evidence must verify ${expected}`,
  );
}
assert.equal(
  notificationInboxDensityEvidenceReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "notification inbox density evidence must not claim IPA readiness",
);
assert.equal(notificationReadActionEvidenceReport.ok, true, "notification read action feedback evidence must pass");
assert.equal(notificationReadActionEvidenceReport.surface, "/app/notifications", "notification read action evidence must target /app/notifications");
assert.equal(notificationReadActionEvidenceReport.role, "member", "notification read action evidence must cover member role");
assert(
  notificationReadActionEvidenceReport.screenshot?.path && existsSync(notificationReadActionEvidenceReport.screenshot.path),
  "notification read action simulator screenshot must exist",
);
assert(
  statSync(notificationReadActionEvidenceReport.screenshot.path).size > 10_000,
  "notification read action simulator screenshot must be non-empty",
);
assert(
  (notificationReadActionEvidenceReport.verified ?? []).includes("single notice read action is visible as 확인"),
  "notification read action evidence must verify the single read action copy",
);
assert(
  (notificationReadActionEvidenceReport.verified ?? []).includes("API smoke verifies notice read and bulk-read persistence with selected-branch scope"),
  "notification read action evidence must pair UI with API persistence smoke",
);
assert(
  (notificationReadActionEvidenceReport.automationLimits ?? []).some((item) => item.includes("enterprise network policy")),
  "notification read action evidence must record Browser policy limitation",
);
assert(
  (notificationReadActionEvidenceReport.automationLimits ?? []).some((item) => item.includes("no tappable button elementRefs")),
  "notification read action evidence must record WebView tap automation limitation",
);
assert.equal(
  notificationReadActionEvidenceReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "notification read action evidence must not be treated as release readiness",
);
assert.equal(readNoticeToneDownEvidenceReport.ok, true, "read notice tone-down evidence must pass");
assert.equal(readNoticeToneDownEvidenceReport.route, "/app/notices", "read notice tone-down evidence must target /app/notices");
assert.equal(readNoticeToneDownEvidenceReport.role, "admin", "read notice tone-down evidence must cover admin notice operations");
assert.equal(
  readNoticeToneDownEvidenceReport.scenario,
  "read_notice_tone_down",
  "read notice tone-down evidence must record the scenario",
);
assert(
  readNoticeToneDownEvidenceReport.screenshot?.path && existsSync(readNoticeToneDownEvidenceReport.screenshot.path),
  "read notice tone-down simulator screenshot must exist",
);
assert(
  statSync(readNoticeToneDownEvidenceReport.screenshot.path).size > 10_000,
  "read notice tone-down simulator screenshot must be non-empty",
);
assert.equal(
  statSync(readNoticeToneDownEvidenceReport.screenshot.path).size,
  readNoticeToneDownEvidenceReport.screenshot.bytes,
  "read notice tone-down screenshot byte size must match summary",
);
for (const expected of [
  "read notice card uses muted zinc background",
  "read notice state badge uses muted zinc tone",
  "unread and important notices remain visually stronger",
  "local Simulator evidence is not IPA ready or operating ready",
]) {
  assert(
    (readNoticeToneDownEvidenceReport.verified ?? []).includes(expected),
    `read notice tone-down evidence must verify ${expected}`,
  );
}
assert.equal(operatorListSearchReport.ok, true, "operator list search evidence must pass");
assert.equal(operatorListSearchReport.consoleMessages?.length ?? 0, 0, "operator list search evidence must be console-clean");
for (const [key, value] of Object.entries(operatorListSearchReport.controls?.noticesEmpty ?? {})) {
  if (["input", "clear", "emptyClear"].includes(key)) {
    assert(value?.height >= 44, `operator notice empty search ${key} control must keep a 44px touch height`);
  }
}
assert(
  operatorListSearchReport.controls?.noticesEmpty?.bottomNavClearance >= 24,
  "operator notice empty search clear action must stay above bottom navigation",
);
assert.equal(operatorListSearchTouchReport.ok, true, "operator notice empty search touch simulator evidence must pass");
for (const [key, value] of Object.entries(operatorListSearchTouchReport.browserProof?.controls ?? {})) {
  if (["input", "clear", "emptyClear"].includes(key)) {
    assert(value?.height >= 44, `operator notice touch summary ${key} control must not keep stale sub-44px evidence`);
  }
}
assert(
  operatorListSearchTouchReport.browserProof?.controls?.bottomNavClearance >= 24,
  "operator notice touch summary clear action must stay above bottom navigation",
);
assert(
  operatorListSearchTouchReport.iosSimulator?.screenshot &&
    existsSync(operatorListSearchTouchReport.iosSimulator.screenshot),
  "operator notice empty search simulator screenshot must exist",
);
assert(
  statSync(operatorListSearchTouchReport.iosSimulator.screenshot).size > 10_000,
  "operator notice empty search simulator screenshot must be non-empty",
);
assert.equal(
  operatorListSearchTouchReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "operator notice empty search simulator evidence must not be treated as IPA readiness",
);
assert.equal(ownerDashboardDetailToggleReport.ok, true, "owner dashboard detail toggle simulator evidence must pass");
assert.equal(ownerDashboardDetailToggleReport.role, "owner", "owner dashboard detail toggle evidence must target owner role");
assert.equal(
  ownerDashboardDetailToggleReport.route,
  "/app/dashboard",
  "owner dashboard detail toggle evidence must target the dashboard route",
);
assert(
  ownerDashboardDetailToggleReport.browserVisibleCopy?.ownerDashboardDetailToggleHeight >= 44,
  "owner dashboard detail toggle summary must keep the detail toggle tappable",
);
assert.equal(
  ownerDashboardDetailToggleReport.browserVisibleCopy?.ownerDashboardDetailToggleBottomNavOverlap,
  0,
  "owner dashboard detail toggle summary must keep the detail toggle above the bottom nav",
);
assert(
  ownerDashboardDetailToggleReport.browserVisibleCopy?.ownerDashboardDetailToggleBottomNavClearance >= 24,
  "owner dashboard detail toggle summary must keep detail toggle clearance above the bottom nav",
);
assert.equal(
  ownerDashboardDetailToggleReport.browserVisibleCopy?.ownerBranchComparisonRowBottomNavOverlap,
  0,
  "owner dashboard detail toggle summary must keep branch comparison rows above the bottom nav",
);
assert(
  ownerDashboardDetailToggleReport.browserVisibleCopy?.ownerBranchComparisonRowBottomNavClearance >= 24,
  "owner dashboard detail toggle summary must not keep stale sub-24px row clearance evidence",
);
assert.equal(
  ownerDashboardDetailToggleReport.browserVisibleCopy?.ownerBranchComparisonCardBottomNavOverlap,
  0,
  "owner dashboard detail toggle summary must keep branch comparison card above the bottom nav",
);
assert(
  ownerDashboardDetailToggleReport.browserVisibleCopy?.ownerBranchComparisonCardBottomNavClearance >= 24,
  "owner dashboard detail toggle summary must not keep stale sub-24px card clearance evidence",
);
assert.equal(
  ownerDashboardDetailToggleReport.browserVisibleCopy?.ownerDashboardRiskSummaryBottomNavOverlap,
  0,
  "owner dashboard detail toggle summary must keep risk summary above the bottom nav",
);
assert(
  ownerDashboardDetailToggleReport.screenshotPath && existsSync(ownerDashboardDetailToggleReport.screenshotPath),
  "owner dashboard detail toggle simulator screenshot must exist",
);
assert(
  statSync(ownerDashboardDetailToggleReport.screenshotPath).size > 10_000,
  "owner dashboard detail toggle simulator screenshot must be non-empty",
);
assert.equal(
  ownerDashboardDetailToggleReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "owner dashboard detail toggle simulator evidence must not be treated as IPA readiness",
);
assert.equal(finalWordmarkLetterSpacingReport.ok, true, "FINAL wordmark letter-spacing evidence must pass");
assert.equal(
  finalWordmarkLetterSpacingReport.source,
  files.finalWordmark,
  "FINAL wordmark letter-spacing evidence must point to the vector source",
);
assert.equal(
  finalWordmarkLetterSpacingReport.checks?.letterSpacing,
  "0",
  "FINAL wordmark letter-spacing evidence must record zero letter spacing",
);
assert.equal(
  finalWordmarkLetterSpacingReport.checks?.negativeLetterSpacingBlocked,
  true,
  "FINAL wordmark letter-spacing evidence must block negative letter spacing",
);
assert(
  finalWordmarkLetterSpacingReport.browserProof?.authLogin?.finalWordmarkVisualMinHeight >= 28,
  "FINAL wordmark evidence must keep public auth wordmark visually readable",
);
assert.equal(
  finalWordmarkLetterSpacingReport.browserProof?.authLogin?.finalWordmarkLinkCount,
  0,
  "FINAL wordmark evidence must not count public auth wordmark as an app link",
);
assert.equal(
  finalWordmarkLetterSpacingReport.browserProof?.authLogin?.finalWordmarkMinTouchHeight,
  0,
  "FINAL wordmark evidence must keep public auth dashboard-link touch height explicit zero",
);
assert(
  finalWordmarkLetterSpacingReport.browserProof?.ownerDashboard?.finalWordmarkLinkCount > 0,
  "FINAL wordmark evidence must keep app dashboard wordmark linked",
);
assert(
  finalWordmarkLetterSpacingReport.browserProof?.ownerDashboard?.finalWordmarkMinTouchHeight >= 44,
  "FINAL wordmark evidence must keep app dashboard wordmark touch target",
);
assert(
  finalWordmarkLetterSpacingReport.browserProof?.ownerDashboard?.finalWordmarkVisualMinHeight >= 28,
  "FINAL wordmark evidence must keep app dashboard wordmark visually readable",
);
assert.equal(
  finalWordmarkLetterSpacingReport.browserProof?.nullWordmarkEvidenceCount,
  0,
  "FINAL wordmark evidence must not keep null/Infinity wordmark measurements",
);
assert(
  finalWordmarkLetterSpacingReport.iosSimulator?.screenshot &&
    existsSync(finalWordmarkLetterSpacingReport.iosSimulator.screenshot),
  "FINAL wordmark letter-spacing simulator screenshot must exist",
);
assert(
  statSync(finalWordmarkLetterSpacingReport.iosSimulator.screenshot).size > 10_000,
  "FINAL wordmark letter-spacing simulator screenshot must be non-empty",
);
assert.equal(
  finalWordmarkLetterSpacingReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "FINAL wordmark letter-spacing evidence must not be treated as IPA readiness",
);
assert.equal(familyNotificationSettingsHiddenReport.ok, true, "family notification settings hidden evidence must pass");
assert.equal(
  familyNotificationSettingsHiddenReport.surface,
  "/app/notifications",
  "family notification settings hidden evidence must target /app/notifications",
);
assert.equal(
  familyNotificationSettingsHiddenReport.role,
  "member",
  "family notification settings hidden evidence must include the member primary role",
);
assert.deepEqual(
  familyNotificationSettingsHiddenReport.roles?.sort(),
  ["guardian", "member"],
  "family notification settings hidden evidence must cover member and guardian roles",
);
assert(
  familyNotificationSettingsHiddenReport.policy?.includes("항상 켜짐") &&
    familyNotificationSettingsHiddenReport.policy?.includes("설정 카드") &&
    familyNotificationSettingsHiddenReport.policy?.includes("노출하지 않는다"),
  "family notification settings hidden evidence must record the always-on hidden-settings policy",
);
for (const screenshot of [
  familyNotificationSettingsHiddenReport.screenshot,
  familyNotificationSettingsHiddenReport.guardianScreenshot,
]) {
  assert(screenshot?.path && existsSync(screenshot.path), "family notification settings hidden screenshot must exist");
  assert(statSync(screenshot.path).size > 10_000, "family notification settings hidden screenshot must be non-empty");
  assert(screenshot.bytes > 10_000, "family notification settings hidden summary must record non-empty screenshots");
  assert.equal(
    statSync(screenshot.path).size,
    screenshot.bytes,
    "family notification settings hidden screenshot byte size must match summary",
  );
}
for (const expected of [
  "회원 알림함 첫 화면에서 알림 설정 바로가기 미노출",
  "회원 알림함에서 알림 설정 카드 미노출",
  "학부모 알림함 첫 화면에서 알림 설정 바로가기 미노출",
  "학부모 알림함에서 알림 설정 카드 미노출",
  "공지 읽음 처리와 납부 정보 확인 주요 액션 유지",
]) {
  assert(
    (familyNotificationSettingsHiddenReport.verified ?? []).includes(expected),
    `family notification settings hidden evidence must verify ${expected}`,
  );
}
assert.equal(
  familyNotificationSettingsHiddenReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "family notification settings hidden evidence must not claim IPA readiness",
);
assert.equal(familyNotificationAlwaysOnGuardReport.ok, true, "family notification always-on guard evidence must pass");
assert.equal(
  familyNotificationAlwaysOnGuardReport.surface,
  "/app/notifications",
  "family notification always-on guard evidence must target /app/notifications",
);
assert.deepEqual(
  familyNotificationAlwaysOnGuardReport.roles?.sort(),
  ["guardian", "member"],
  "family notification always-on guard evidence must cover member and guardian roles",
);
assert(
  familyNotificationAlwaysOnGuardReport.policy?.includes("항상 켜짐") &&
    familyNotificationAlwaysOnGuardReport.policy?.includes("해지 대신 유지"),
  "family notification always-on guard evidence must record the no-unsubscribe policy",
);
for (const screenshot of [
  familyNotificationAlwaysOnGuardReport.memberScreenshot,
  familyNotificationAlwaysOnGuardReport.guardianScreenshot,
]) {
  assert(screenshot?.path && existsSync(screenshot.path), "family notification always-on guard screenshot must exist");
  assert(statSync(screenshot.path).size > 10_000, "family notification always-on guard screenshot must be non-empty");
  assert(screenshot.bytes > 10_000, "family notification always-on guard summary must record non-empty screenshots");
  assert.equal(
    statSync(screenshot.path).size,
    screenshot.bytes,
    "family notification always-on guard screenshot byte size must match summary",
  );
}
for (const expected of [
  "회원 알림함 첫 화면에서 해지 액션 미노출",
  "학부모 알림함 첫 화면에서 해지 액션 미노출",
  "Capacitor URL을 관리자 대시보드 기본값으로 복구",
]) {
  assert(
    (familyNotificationAlwaysOnGuardReport.verified ?? []).includes(expected),
    `family notification always-on guard evidence must verify ${expected}`,
  );
}
assert.equal(
  familyNotificationAlwaysOnGuardReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "family notification always-on guard evidence must not claim IPA readiness",
);
assertIncludes(
  sources.invitationLinkCopy,
  "복사를 완료하지 못했습니다. 링크 열기로 확인해 주세요.",
  "invitation link copy fallback uses app-centered guidance",
);
assertIncludes(sources.invitationLinkCopy, "초대 링크를 복사했습니다.", "invitation link copy success message");
assertExcludes(sources.invitationLinkCopy, "주소를 복사", "invitation link copy avoids address-bar/manual URL wording");
for (const source of [sources.membersScreen, sources.adminUsersScreen, sources.adminRolesScreen]) {
  assertIncludes(source, "invitationLinkCopyFallbackMessage", "invitation link copy fallback is shared");
  assertIncludes(source, "invitationLinkCopySuccessMessage", "invitation link copy success is shared");
  assertExcludes(source, "초대 링크를 열어 주소를 복사해 주세요.", "invitation link fallback avoids browser address wording");
}
for (const snippet of ["초대 링크가 준비됐습니다.", "초대 링크 열기", "링크 복사", "navigator.clipboard.writeText"]) {
  assertIncludes(sources.membersScreen, snippet, "member invitation link compact action UI");
}
assertExcludes(sources.membersScreen, "생성된 초대 링크:", "member invitation link avoids long raw path display");
for (const snippet of [
  'data-testid="admin-user-invite-link-actions"',
  'data-testid="admin-user-invite-link-open"',
  'data-testid="admin-user-invite-link-copy"',
  "function getInvitationPathForUser",
  'data-testid={`admin-user-pending-invite-link-actions-${user.id}`}',
  'data-admin-user-action="open-invitation-link"',
  'data-admin-user-action="copy-invitation-link"',
  'data-testid={`admin-user-pending-invite-link-open-${user.id}`}',
  'data-testid={`admin-user-pending-invite-link-copy-${user.id}`}',
  "초대 링크가 준비됐습니다.",
  "초대 링크 열기",
  "링크 복사",
  "navigator.clipboard.writeText",
]) {
  assertIncludes(sources.adminUsersScreen, snippet, "admin users invitation link compact action UI");
}
assertExcludes(sources.adminUsersScreen, "생성된 초대 링크:", "admin users invitation link avoids long raw path display");
assertIncludes(sources.authInvitationAcceptRoute, "비밀번호는 12자 이상이어야 합니다.", "invitation accept route app-safe password validation copy");
assertIncludes(sources.authInvitationAcceptRoute, "다른 비밀번호를 입력해 주세요.", "invitation accept route app-safe default password block copy");
assertExcludes(sources.authInvitationAcceptRoute, "기본 초기 비밀번호", "invitation accept route internal default password copy");
assertIncludes(sources.adminUserPasswordRoute, "다른 새 비밀번호를 입력해 주세요.", "admin password route app-safe default password block copy");
assertExcludes(sources.adminUserPasswordRoute, "기본 초기 비밀번호", "admin password route internal default password copy");
assertIncludes(sources.adminRolesScreen, 'import { getVisibleUserEmail } from "@/lib/user-display";', "admin roles seed email display guard");
assertIncludes(sources.adminRolesScreen, "getVisibleUserEmail(user.email) ?? \"\"", "admin roles .test seed email hidden");
assertExcludes(sources.adminRolesScreen, "@finaljudo.test", "admin roles visible seed email literals");
assertExcludes(sources.adminRolesScreen, "초대 링크, 역할, 담당 지점을 함께 기록합니다.", "admin roles invitation intro copy");
assertIncludes(sources.adminRolesScreen, "관리 권한", "admin roles management access summary copy");
assertExcludes(sources.adminRolesScreen, "관리 권한 변경 승인 필요", "admin roles redundant management approval copy");
assertIncludes(sources.adminRolesScreen, "<span>역할 변경</span>", "admin roles role-change table header app copy");
assertIncludes(sources.adminRolesScreen, "총괄 어드민의 권한 상태입니다.", "admin roles permission matrix app copy");
assertIncludes(sources.adminRolesScreen, "function getPermissionSummary", "admin roles permission summary helper");
assertIncludes(sources.adminRolesScreen, 'const [permissionMatrixOpen, setPermissionMatrixOpen] = useState(false)', "admin roles permission detail collapsed state");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-permission-summary"', "admin roles permission summary hook");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-permission-summary-row"', "admin roles permission summary row hook");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-permission-detail-toggle"', "admin roles permission detail toggle hook");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-permission-detail"', "admin roles permission detail hook");
assertIncludes(sources.adminRolesScreen, 'hidden sm:mt-3 sm:block', "admin roles permission detail stays collapsed on mobile by default");
assertExcludes(sources.adminRolesScreen, 'data-testid="admin-role-protection-status"', "admin roles account protection status chip hidden from app surface");
assertExcludes(sources.adminRolesScreen, 'data-testid="admin-role-protection-summary"', "admin roles account protection summary hidden from app surface");
assertExcludes(sources.adminRolesScreen, 'data-testid="admin-role-protection-cancel"', "admin roles draft cancel helper hidden from app surface");
assertExcludes(sources.adminRolesScreen, "hasRoleDraftChanges ? (", "admin roles draft cancel helper hidden from app surface");
assertExcludes(sources.adminRolesScreen, "내 계정 보호", "admin roles account protection card title");
assertExcludes(sources.adminRolesScreen, "기본 역할 잠김", "admin roles account protection status copy");
assertExcludes(sources.adminRolesScreen, "현재 계정이 총괄 권한을 잃지 않도록 변경 저장을 제한합니다.", "admin roles account protection long helper copy");
assertExcludes(sources.adminRolesScreen, "기본 역할 직접 삭제 제한", "admin roles account protection redundant delete helper copy");
assertExcludes(sources.adminRolesScreen, "관리 권한 변경 승인 필요", "admin roles account protection redundant approval helper copy");
assertIncludes(sources.permissionMatrix, 'className="grid gap-3 sm:hidden"', "permission matrix mobile card layout");
assertIncludes(sources.permissionMatrix, 'className="hidden min-w-[520px] overflow-hidden rounded-lg border border-zinc-200 bg-white sm:block"', "permission matrix desktop table layout");
assertIncludes(sources.permissionMatrix, "<span>권한 항목</span>", "permission matrix app-safe desktop header copy");
assertExcludes(sources.adminRolesScreen, "위험 권한 보유자", "admin roles alarmist access card copy");
assertExcludes(sources.adminRolesScreen, "위험 권한 변경 승인 필요", "admin roles alarmist approval copy");
assertExcludes(sources.adminRolesScreen, "제품 역할/변경", "admin roles product-design table header copy");
assertExcludes(sources.adminRolesScreen, "총괄 어드민 기본 역할의 리소스별 권한 상태입니다.", "admin roles resource-level matrix copy");
assertExcludes(sources.permissionMatrix, "<span>리소스</span>", "permission matrix resource-label copy");
assertIncludes(sources.accountScreen, 'import { getVisibleUserEmail } from "@/lib/user-display";', "account seed email display guard");
assertIncludes(sources.accountScreen, "const displayEmail = getVisibleUserEmail(context.user.email);", "account seed email display guard");
assertExcludes(sources.accountScreen, "@finaljudo.test", "account visible seed email literals");
assertIncludes(sources.accountScreen, "<InstallAppAction />", "account keeps web-only install action");
for (const snippet of [
  'const { signOut } = useAppStore();',
  'const showFamilyAccountActions = context.user.role === "member" || context.user.role === "guardian";',
  'data-testid="account-action-panel"',
  'data-testid="account-role-switch-link"',
  'data-testid="account-logout-button"',
  "min-h-11",
]) {
  assertIncludes(sources.accountScreen, snippet, "family account actions stay on the account screen");
}
assertIncludes(sources.roles, "export const roleManagementScopeLabels", "shared role management scope descriptions");
assertIncludes(sources.roles, 'guardian: "자녀 확인"', "shared guardian scope copy");
assertIncludes(sources.adminUsersScreen, "roleManagementScopeLabels[user.role]", "admin users management column scope rendering");
assertExcludes(
  sources.adminUsersScreen,
  "rbacRoleLabels[roleToRbacRole[user.role]]",
  "admin users duplicate role label rendering",
);
assertIncludes(sources.adminRolesScreen, "roleManagementScopeLabels[user.role]", "admin roles management column scope rendering");
assertExcludes(
  sources.adminRolesScreen,
  "rbacRoleLabels[roleToRbacRole[user.role]]",
  "admin roles duplicate role label rendering",
);
assertIncludes(sources.adminRolesScreen, 'function shouldOpenInviteForm(searchParams: Pick<URLSearchParams, "get">)', "admin roles invite form query helper");
assertIncludes(sources.adminRolesScreen, 'return searchParams.get("invite") === "1";', "admin roles invite form opens only for explicit invite query");
assertIncludes(sources.adminRolesScreen, "const inviteFormRequested = shouldOpenInviteForm(searchParams);", "admin roles invite form reads invite query");
assertIncludes(
  sources.adminRolesScreen,
  "const [inviteFormOpen, setInviteFormOpen] = useState(() => inviteFormRequested)",
  "admin roles invite form keeps default collapsed state unless invite query is present",
);
assertExcludes(sources.adminRolesScreen, "setInviteFormOpen(true);", "admin roles invite query must not trigger synchronous effect state updates");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-summary-grid"', "admin roles compact summary grid hook");
assertIncludes(sources.adminRolesScreen, "grid min-h-11 grid-cols-4 overflow-hidden rounded-md border", "admin roles readable compact mobile summary grid");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-invite-panel"', "admin roles compact invite panel hook");
assertIncludes(sources.adminRolesScreen, "w-2/3 max-w-[18rem]", "admin roles invite panel reduced mobile width");
assertIncludes(sources.adminRolesScreen, '{inviteFormOpen ? "닫기" : "열기"}', "admin roles invite panel short action copy");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-invite-toggle"', "admin roles invite toggle hook");
assertIncludes(sources.adminRolesScreen, 'id="admin-role-invite-form"', "admin roles invite form controlled panel");
assertIncludes(sources.adminRolesScreen, "inviteFormOpen ? (", "admin roles invite form stays collapsed by default");
for (const snippet of [
  'data-testid="admin-role-invite-link-actions"',
  'data-testid="admin-role-invite-link-open"',
  'data-testid="admin-role-invite-link-copy"',
  'data-testid="admin-role-invite-submit"',
  'id="admin-role-invite-submit"',
  "scroll-mb-32",
  'window.location.hash !== "#admin-role-invite-submit"',
  'document.getElementById("admin-role-invite-submit")?.scrollIntoView',
  "window.requestAnimationFrame",
  "초대 링크가 준비됐습니다.",
  "초대 링크 열기",
  "링크 복사",
  "navigator.clipboard.writeText",
]) {
  assertIncludes(sources.adminRolesScreen, snippet, "admin roles invitation link compact action UI");
}
assert(
  /className="[^"]*min-h-11[^"]*"[\s\S]{0,260}data-testid="admin-role-invite-link-open"/.test(sources.adminRolesScreen),
  "admin roles invitation link open action must keep a 44px touch height",
);
assert(
  /className="[^"]*min-h-11[^"]*"[\s\S]{0,260}data-testid="admin-role-invite-link-copy"/.test(sources.adminRolesScreen),
  "admin roles invitation link copy action must keep a 44px touch height",
);
assertExcludes(sources.adminRolesScreen, "생성된 초대 링크:", "admin roles invitation link avoids long raw path display");
assertIncludes(
  sources.adminRolesScreen,
  'const [roleEditorUserId, setRoleEditorUserId] = useState<string | null>(null)',
  "admin roles per-user edit form collapsed state",
);
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-edit-toggle"', "admin roles per-user edit toggle hook");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-user-row"', "admin roles compact user row hook");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-action-row"', "admin roles compact action row hook");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-management-scope"', "admin roles desktop management scope hook");
assertIncludes(sources.adminRolesScreen, 'data-testid="admin-role-branch-scope"', "admin roles desktop branch scope hook");
assertIncludes(sources.adminRolesScreen, "hidden text-sm font-semibold leading-6 text-zinc-700 md:block", "admin roles management scope hidden on mobile");
assertIncludes(sources.adminRolesScreen, "hidden text-sm leading-6 text-zinc-600 md:block", "admin roles branch scope hidden on mobile");
assertIncludes(sources.adminRolesScreen, "inline-flex h-11 w-11 shrink-0", "admin roles mobile edit action compact 44px icon");
assertIncludes(sources.adminRolesScreen, '<Pencil className="h-4 w-4" aria-hidden />', "admin roles mobile edit icon");
assertIncludes(sources.adminRolesScreen, 'id={`admin-role-edit-form-${user.id}`}', "admin roles per-user edit form controlled panel");
assertIncludes(sources.adminRolesScreen, "roleEditorOpen ? (", "admin roles per-user edit forms stay collapsed by default");
assertIncludes(sources.dashboardScreen, 'actionLabel: dashboardUnreadNoticeCount > 0 ? "미확인 공지" : "공지 보기"', "admin dashboard notice CTA copy");
assertExcludes(sources.dashboardScreen, 'actionLabel: dashboardUnreadNoticeCount > 0 ? "공지 확인" : "공지 보기"', "admin dashboard duplicate notice CTA copy");
for (const snippet of [
  'params.get("compose") === "1"',
  'data-testid="member-request-create-panel"',
  'data-testid="member-request-form-toggle"',
  'id="member-request-form"',
  'data-testid="request-resolve-approve-action"',
  'data-testid="request-resolve-reject-action"',
  "/app/requests?compose=1",
  "priority cell href includes /app/requests?compose=1",
  "compose deep link opens the request form",
]) {
  assertExcludes(`${sources.requestsScreen}\n${sources.dashboardScreen}`, snippet, "deleted request compose evidence and UI must stay removed");
}
assert.equal(memberDashboardPaymentCheckoutLinkReport.ok, true, "member dashboard payment checkout link iOS evidence must pass");
assert.equal(
  memberDashboardPaymentCheckoutLinkReport.surface,
  "/app/dashboard",
  "member dashboard payment checkout link evidence must start on the dashboard",
);
assert.equal(
  memberDashboardPaymentCheckoutLinkReport.target,
  "/app/payments/checkout?paymentId=pay-minjae",
  "member dashboard payment checkout link evidence must target checkout preparation",
);
assert.equal(
  memberDashboardPaymentCheckoutLinkReport.implementation?.apiChanged,
  false,
  "member dashboard payment checkout link evidence must not change payment APIs",
);
assert.equal(
  memberDashboardPaymentCheckoutLinkReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "member dashboard payment checkout link evidence must not be treated as IPA readiness",
);
for (const expected of [
  "priority cell href includes /app/payments/checkout?paymentId=pay-minjae",
  "payment card shows 납부 정보 확인",
  "payment-checkout-ready",
  "checkout screen remains API-free",
]) {
  assert(
    (memberDashboardPaymentCheckoutLinkReport.verified ?? []).some((item) => item.includes(expected)),
    `member dashboard payment checkout link evidence must verify ${expected}`,
  );
}
for (const screenshot of memberDashboardPaymentCheckoutLinkReport.screenshots ?? []) {
  assert(screenshot.path && existsSync(screenshot.path), `${screenshot.path} must exist`);
  assert(statSync(screenshot.path).size > 10_000, `${screenshot.path} must be a non-empty dashboard payment checkout simulator screenshot`);
}
assertExcludes(sources.requestsScreen, "확인할 공지가 없습니다", "requests screen no longer renders notice empty state");
assertExcludes(sources.requestsScreen, "아직 요청 내역이 없습니다.", "requests repetitive member empty-state copy");
assertExcludes(sources.requestsScreen, "대기 중인 요청이 없습니다.", "requests repetitive operator empty-state copy");
assertExcludes(sources.requestsScreen, "요청을 남기면 이곳에서 확인할 수 있습니다.", "requests member verbose empty-state copy");
assertExcludes(sources.requestsScreen, "새 요청이 들어오면 이곳에서 확인할 수 있습니다.", "requests operator verbose empty-state copy");
assertExcludes(sources.requestsScreen, "새 공지가 등록되면 이곳에서 확인할 수 있습니다.", "requests notice verbose empty-state copy");
assertExcludes(sources.requestsScreen, "요청을 남기면 목록에 표시됩니다.", "requests member empty-state passive copy");
assertExcludes(sources.requestsScreen, "대기 요청이 등록되면 표시됩니다.", "requests operator empty-state passive copy");
assertExcludes(sources.requestsScreen, "새 공지가 등록되면 표시됩니다.", "requests notice empty-state passive copy");
assertExcludes(sources.requestsScreen, "새 공지 대기 중입니다.", "requests notice repetitive waiting empty-state copy");
assertIncludes(sources.stateBlocks, "description?: string", "empty state optional description prop");
assertIncludes(sources.stateBlocks, "{description ? <p", "empty state hides missing description");
assertIncludes(sources.uiPrimitives, "export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode })", "section header title/action-only API");
assertExcludes(sources.uiPrimitives, "description?: string; action?: React.ReactNode", "section header stale description prop");
assertIncludes(sources.appShell, "inline-flex min-h-11 items-center", "app shell FINAL wordmark link touch target");
assertIncludes(sources.dashboardScreen, 'data-testid="coach-dashboard-all-classes-link"', "coach dashboard all classes touch target hook");
assertIncludes(sources.dashboardScreen, "inline-flex min-h-11 items-center gap-1", "coach dashboard compact all link touch target");
assertIncludes(sources.classesScreen, 'data-testid="attendance-unchecked-filter"', "coach attendance filter touch target hook");
assertIncludes(sources.classesScreen, "className=\"inline-flex min-h-11 shrink-0 items-center gap-1.5", "coach attendance filter label compact touch target");
assertIncludes(sources.classesScreen, "className=\"h-7 w-7 rounded border-zinc-300", "coach attendance filter checkbox visual target");
assertIncludes(sources.classesScreen, "className=\"h-5 w-5 rounded border-zinc-300", "coach checkbox visual target size");

for (const snippet of [
  "formatDate(payment.dueDate)",
  "formatDate(payment.expiresAt)",
  "formatDate(recurringAgreement.nextBillingDate)",
]) {
  assertIncludes(sources.paymentsScreen, snippet, "payments mobile date display formatting");
}

for (const snippet of [
  'import { auditActionLabels, auditResultLabels } from "@/lib/audit-log-presentation";',
  "const roleRelevantAuditActions",
  "const roleAuditLogs = useMemo(",
  "recentRoleAuditLogs",
  "const [showAllRecentRoleChanges, setShowAllRecentRoleChanges] = useState(false);",
  "const visibleRecentRoleAuditLogs = showAllRecentRoleChanges ? recentRoleAuditLogs : recentRoleAuditLogs.slice(0, 1);",
  "const hiddenRecentRoleAuditLogCount = Math.max(recentRoleAuditLogs.length - 1, 0);",
  "auditActionLabels[log.action]",
  "auditResultLabels[log.result]",
  'data-testid="admin-role-recent-change-section"',
  'data-testid="admin-role-recent-change-list"',
  'data-testid="admin-role-recent-change-row"',
  'data-testid="admin-role-recent-change-empty"',
  'data-testid="admin-role-recent-change-toggle"',
  'aria-controls="admin-role-recent-change-list"',
  'id="admin-role-recent-change-list"',
  'className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"',
  "최근 변경 접기",
]) {
  assertIncludes(sources.adminRolesScreen, snippet, "admin roles audit log display labels");
}
for (const snippet of [
  "export const auditActionLabels: Record<AuditAction, string>",
  '"audit_logs.read": "변경 기록 조회"',
  '"tournament.create": "대회 공지 등록"',
  '"tournament.update": "대회 공지 수정"',
  '"tournament.delete": "대회 공지 삭제"',
  "export const auditActions = Object.keys(auditActionLabels)",
  "export const auditResultLabels: Record<AuditLog[\"result\"], string>",
  'success: "완료"',
]) {
  assertIncludes(sources.auditLogPresentation, snippet, "shared audit presentation policy");
}
assertExcludes(sources.adminRolesScreen, "const auditActionLabels", "admin roles must not duplicate shared audit action labels");
assertExcludes(sources.adminAuditLogsScreen, "const auditActionLabels", "admin audit screen must not duplicate shared audit action labels");
for (const snippet of ["{log.action}", "{log.result}", "context.db.auditLogs.slice(0, 5)"]) {
  assertExcludes(sources.adminRolesScreen, snippet, "admin roles visible audit log raw code");
}

for (const snippet of [
  "메시지, 처리 항목, 담당자, 대상 검색",
  "useSearchParams",
  'window.history.replaceState(null, "", nextUrl)',
  "function getAuditFiltersFromParams",
  "function resetFilters",
  "처리 항목 필터",
  "전체 처리 항목",
  "담당자 확인 중",
  'branchId: "all"',
  "전체 지점/공통",
  "공통 기록",
  "{branch?.name ?? \"공통\"}",
  "function hasAuditPayload",
  "function shouldShowAuditPayload",
  "const [openPayloadLogIds, setOpenPayloadLogIds] = useState<string[]>(() => (detailLogId ? [detailLogId] : []));",
  "const [showAllAuditLogs, setShowAllAuditLogs] = useState(false);",
  "const defaultVisibleAuditLogCount = 5;",
  "const visibleAuditLogs = showAllAuditLogs ? filteredLogs : filteredLogs.slice(0, defaultVisibleAuditLogCount);",
  "const hiddenAuditLogCount = Math.max(filteredLogs.length - visibleAuditLogs.length, 0);",
  "function togglePayload(logId: string)",
  'log.action === "auth.login" || log.action === "auth.logout" || log.action === "audit_logs.read"',
  "Object.keys(payload).length > 0",
  "const payloadChanges = getAuditPayloadChanges(log.before, log.after);",
  "const hasChangePayload = shouldShowAuditPayload(log) && payloadChanges.length > 0;",
  "const payloadOpen = openPayloadLogIds.includes(log.id);",
  'url.searchParams.set("detail", openDetailLogId)',
  'data-testid="admin-audit-log-row"',
  'data-testid="admin-audit-branch-meta"',
  'data-testid="admin-audit-target-meta"',
  'data-testid="admin-audit-change-detail-toggle"',
  'data-testid="admin-audit-change-detail"',
  'data-testid="admin-audit-change-row"',
  'data-testid="admin-audit-log-list-toggle"',
  'data-testid="admin-audit-summary-bar"',
  "완료",
  "변경값 보기",
  "변경값 닫기",
  "변경 기록 접기",
  "더 보기",
  "변경 전",
  "변경 후",
  "filterPanelOpen",
  'data-testid="admin-audit-filter-panel"',
  'data-testid="admin-audit-filter-toggle"',
  'data-testid="admin-audit-active-filter-summary"',
  'data-testid="admin-audit-filter-fields"',
  'data-testid="admin-audit-search-input"',
  'data-testid="admin-audit-search-clear"',
  'data-testid="admin-audit-filter-reset"',
  'data-testid="admin-audit-filter-submit"',
  'data-testid="admin-audit-from-input"',
  'data-testid="admin-audit-to-input"',
  'data-testid="admin-audit-empty-filter-reset"',
  "function updateDraftFromDate",
  "필터 열기",
  "필터 닫기",
  "<span>처리 항목</span>",
  "<span>담당자/지점</span>",
  "grid min-h-11 grid-cols-4 overflow-hidden rounded-md border",
  'title="조건에 맞는 변경 기록이 없습니다"',
]) {
  assertIncludes(sources.adminAuditLogsScreen, snippet, "admin audit app-safe filter copy");
}
for (const snippet of ["<pre", "JSON.stringify(payload"]) {
  assertExcludes(sources.adminAuditLogsScreen, snippet, "admin audit raw JSON detail");
}
for (const snippet of [
  "export function sanitizeAuditPayload",
  "export function sanitizeAuditLog",
  'const protectedValue = "[보호됨]"',
  'const sensitiveContentValue = "[민감 내용]"',
]) {
  assertIncludes(sources.auditLogSecurity, snippet, "central audit privacy policy");
}
for (const snippet of [
  "export const auditReadDeduplicationWindowMs = 5_000",
  "export function isDuplicateAuditRead",
  "createAuditReadFingerprint(log) === candidateFingerprint",
]) {
  assertIncludes(sources.auditReadDeduplication, snippet, "audit read retry deduplication policy");
}
assertIncludes(sources.auditLogsRoute, "isDuplicateAuditRead(db.auditLogs, readAuditLog)", "admin audit read deduplication gate");
for (const snippet of [
  'export type AuditDateBoundary = "from" | "to"',
  "boundary === \"from\"",
  "Date.UTC(year, month - 1, day, 23, 59, 59, 999)",
  "localTime - koreaUtcOffsetMs",
  "export function isAuditDateRangeValid",
]) {
  assertIncludes(sources.auditLogQuery, snippet, "audit date range boundary policy");
}
assertIncludes(sources.auditLogsRoute, 'parseAuditDateParam(searchParams.get("to"), "to")', "admin audit full-day end filter");
assertIncludes(sources.auditLogsRoute, "if (!isAuditDateRangeValid(from, to))", "admin audit reversed date range rejection");
assertIncludes(sources.auditLogsRoute, "시작일은 종료일보다 늦을 수 없습니다.", "admin audit reversed date range copy");
assertIncludes(sources.adminAuditLogsScreen, "hasChangePayload ? (", "admin audit change detail rendered only when payload exists");
assertIncludes(sources.adminAuditLogsScreen, "mt-1 hidden text-xs text-zinc-500 sm:block", "admin audit branch meta hidden on mobile");
assertIncludes(sources.adminAuditLogsScreen, "mt-1 hidden break-all text-xs text-zinc-500 sm:block", "admin audit target meta hidden on mobile");
assertExcludes(
  sources.adminAuditLogsScreen,
  "검색어, 처리 항목, 지점 또는 날짜 조건을 조정",
  "admin audit empty-state helper copy stays compact",
);
for (const snippet of [
  "메시지, 액션, 행위자, 대상 검색",
  "검색어, 액션, 지점 또는 날짜 조건",
  "액션 필터",
  "전체 액션",
  "전체 지점/시스템",
  "시스템 이벤트",
  "{branch?.name ?? \"시스템\"}",
  "성공 이벤트",
  "변경 diff",
  "<span>액션</span>",
  "<span>행위자/지점</span>",
]) {
  assertExcludes(sources.adminAuditLogsScreen, snippet, "admin audit technical filter copy");
}
for (const snippet of [
  "변경 기록을 조회했습니다.",
  "변경 기록 조회 사유가 필요합니다.",
  "변경 기록 처리 항목 필터가 올바르지 않습니다.",
  "변경 기록 결과 필터가 올바르지 않습니다.",
  'import { auditActions, auditResults } from "@/lib/audit-log-presentation";',
]) {
  assertIncludes(sources.auditLogsRoute, snippet, "admin change record app-safe route copy");
}
assertIncludes(sources.auditLogsRoute, "function isAuditReadLog(log: AuditLog)", "admin audit read-log classifier");
assertIncludes(sources.auditLogsRoute, 'const includeAuditReadLogs = action === "audit_logs.read"', "admin audit read-log explicit filter path");
assertIncludes(sources.auditLogsRoute, "if (!includeAuditReadLogs && isAuditReadLog(log))", "admin audit default list hides read-log noise");
assertIncludes(sources.mockData, "function seededAuditLogs()", "mock data must provide app-safe seed audit rows");
assertIncludes(sources.mockData, 'id: "audit-seed-attendance-update"', "mock data must seed audit rows without test API mutation");
assertExcludes(sources.visibleAppCopyScript, "prepareVisibleCopyAuditRows", "visible copy scan must not mutate admin users to seed audit rows");
assertExcludes(sources.visibleAppCopyScript, "/api/v1/admin/users/", "visible copy scan must not patch user records for audit rows");
assertExcludes(sources.visibleAppCopyScript, "변경 기록 화면 확인", "visible copy scan must not persist test-only audit reasons");
for (const snippet of ["감사 로그를 조회했습니다.", "감사 로그 조회 사유", "감사 로그 액션 필터", "감사 로그 결과 필터"]) {
  assertExcludes(sources.adminAuditLogsScreen, snippet, "admin change record old audit copy");
  assertExcludes(sources.auditLogsRoute, snippet, "admin change record old audit route copy");
}
assertIncludes(sources.classesScreen, "처리자 확인 중", "classes action log actor fallback app copy");
assertIncludes(sources.membersScreen, "작성자 확인 중", "members note author fallback app copy");
assertIncludes(sources.auditLogPresentation, 'return "없음";', "shared admin audit payload empty value copy");
assertExcludes(sources.adminAuditLogsScreen, "변경 내용 없음", "admin audit detail must avoid duplicate empty payload blocks");
for (const [label, source] of [
  ["admin users branch fallback", sources.adminUsersScreen],
  ["admin roles branch fallback", sources.adminRolesScreen],
  ["classes member fallback", sources.classesScreen],
  ["dashboard payment fallback", sources.dashboardScreen],
  ["owner reports payment fallback", sources.ownerReportsScreen],
  ["admin settings incident fallback", sources.adminSettings],
]) {
  assertExcludes(source, "미확인 회원", label);
  assertExcludes(source, "미확인 지점", label);
  assertExcludes(source, "역할 미확인", label);
  assertExcludes(source, "화면 미기록", label);
}
for (const snippet of ["회원 확인 중", "지점 확인 중"]) {
  assertIncludes(`${sources.classesScreen}\n${sources.dashboardScreen}\n${sources.ownerReportsScreen}`, snippet, "app-safe missing relation fallback");
}
assertIncludes(sources.adminSettings, "역할 확인 중", "admin settings incident role fallback app copy");
assertIncludes(sources.adminSettings, "화면 확인 중", "admin settings incident screen fallback app copy");
assertIncludes(sources.adminSettings, '<option value="unknown">역할 선택 전</option>', "admin settings incident role select app copy");
assertExcludes(sources.adminSettings, '<option value="unknown">미확인</option>', "admin settings incident role select old fallback copy");
for (const [label, source] of [
  ["admin audit logs fallback", sources.adminAuditLogsScreen],
  ["classes action log fallback", sources.classesScreen],
  ["members note author fallback", sources.membersScreen],
]) {
  assertExcludes(source, "알 수 없음", label);
}
assertIncludes(sources.demoDateRoll, '"변경 기록을 조회했습니다."', "seeded runtime change record copy normalization");
assertIncludes(sources.demoDateRoll, '"감사 로그를 조회했습니다."', "seeded runtime stale audit copy detection");
assertIncludes(sources.apiClient, '"변경 기록 조회"', "admin audit query reason app-safe copy");
assertIncludes(sources.adminBranchesScreen, "운영 중", "admin branch summary active branch copy");
assertIncludes(sources.adminBranchesScreen, "const visibleBranches = context.selectedBranchId", "admin branch screen derives branch rows from the selected branch scope");
assertIncludes(
  sources.adminBranchesScreen,
  "? context.db.branches.filter((branch) => branch.id === context.selectedBranchId)",
  "admin branch screen filters branch rows in selected branch scope",
);
assertIncludes(sources.adminBranchesScreen, "activeBranches.length", "admin branch summary uses branch status count");
assertIncludes(sources.adminBranchesScreen, "const activeBranches = visibleBranches.filter", "admin branch active summary uses visible branch scope");
assertIncludes(sources.adminBranchesScreen, "const inactiveBranches = visibleBranches.filter", "admin branch inactive summary uses visible branch scope");
assertIncludes(sources.adminBranchesScreen, "const branchesWithoutOwner = visibleBranches.filter", "admin branch owner summary uses visible branch scope");
assertIncludes(
  sources.adminBranchesScreen,
  'const branchScopeTitle = context.selectedBranchId ? "선택 지점 관리" : "전체 지점 관리";',
  "admin branch screen labels selected branch scope distinctly",
);
assertIncludes(
  sources.adminBranchesScreen,
  'const branchSummaryTotalLabel = context.selectedBranchId ? "선택" : "전체";',
  "admin branch summary total label follows selected branch scope",
);
assertIncludes(
  sources.adminBranchesScreen,
  "const canCreateBranchInCurrentScope = !context.selectedBranchId;",
  "admin branch creation is disabled while a single branch scope is selected",
);
assertExcludes(sources.adminBranchesScreen, "{totalMembers}/{totalClasses}", "admin branch summary member/class slash count");
assertExcludes(sources.adminBranchesScreen, "운영 현황", "admin branch summary ambiguous operations copy");
assertExcludes(sources.adminBranchesScreen, "운영 데이터", "admin branch summary technical copy");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-summary-grid"', "admin branch compact summary grid hook");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-summary-active"', "admin branch active summary hook");
assertIncludes(sources.adminBranchesScreen, "mb-1.5 grid w-2/3 max-w-[17rem] grid-cols-4", "admin branch summary stays compact at two-thirds width");
assertIncludes(sources.adminBranchesScreen, "min-h-11 min-w-0 flex-col items-center justify-center", "admin branch summary cells keep compact readable card height");
assertIncludes(sources.adminBranchesScreen, 'const [branchCreateOpen, setBranchCreateOpen] = useState(false)', "admin branch create form collapsed state");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-create-panel"', "admin branch create compact panel hook");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-create-toggle"', "admin branch create toggle hook");
assertIncludes(sources.adminBranchesScreen, 'branchCreateOpen ? "w-full max-w-none" : "w-2/3 max-w-[17rem]"', "admin branch create panel expands only while the form is open");
assertIncludes(sources.adminBranchesScreen, "mt-1.5 grid gap-1.5", "admin branch create form uses compact two-row mobile layout");
assertIncludes(sources.adminBranchesScreen, "grid grid-cols-2 gap-1.5 md:contents", "admin branch create name and district fields share one compact mobile row");
assertIncludes(sources.adminBranchesScreen, "grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-1.5", "admin branch create owner select and submit action share one compact mobile row");
assertIncludes(sources.adminBranchesScreen, "grid grid-cols-3 gap-1", "admin branch settings form uses compact three-column mobile field grid");
assertIncludes(sources.adminBranchesScreen, ">출석 수정 사유 필수</span>", "admin branch settings keeps attendance edit reason policy");
assertExcludes(sources.adminBranchesScreen, ">보강 기간</span>", "admin branch settings must remove deleted request policy label");
assertExcludes(sources.adminBranchesScreen, ">월 보강</span>", "admin branch settings must remove deleted request policy label");
assertIncludes(sources.adminBranchesScreen, "bg-white px-2 py-0", "admin branch create panel keeps compact mobile padding around a 44px touch target");
assertIncludes(sources.adminBranchesScreen, "inline-flex min-h-11", "admin branch create toggle keeps a 44px touch target");
assertIncludes(sources.adminBranchesScreen, 'id="admin-branch-create-form"', "admin branch create form controlled panel");
assertIncludes(sources.adminBranchesScreen, "branchCreateOpen ? (", "admin branch create form stays collapsed by default");
assertIncludes(sources.adminBranchesScreen, "{canCreateBranchInCurrentScope ? (", "admin branch create panel is hidden in selected branch scope");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-card"', "admin branch compact card hook");
assertIncludes(sources.adminBranchesScreen, "{visibleBranches.map((branch) => {", "admin branch cards render the selected-scope branch rows");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-feedback"', "admin branch feedback remains visible even when create panel is hidden");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-detail-grid"', "admin branch compact detail grid hook");
assertIncludes(sources.adminBranchesScreen, "grid grid-cols-3 gap-1 border-t", "admin branch detail grid uses dense mobile chips");
assertIncludes(sources.adminBranchesScreen, "rounded-md bg-zinc-50 px-1.5 py-1", "admin branch detail cells use compact chip styling");
assertIncludes(sources.adminBranchesScreen, "const branchTimezoneLabel = formatBranchTimezone(branch.timezone);", "admin branch timezone stays available in settings action context");
assertIncludes(sources.adminBranchesScreen, 'title={`운영 설정 · ${branchTimezoneLabel}`}', "admin branch timezone stays out of collapsed detail chips");
assertExcludes(sources.adminBranchesScreen, ">정책</dt>", "admin branch collapsed detail must hide policy chip");
assertExcludes(sources.adminBranchesScreen, ">시간대</dt>", "admin branch collapsed detail must hide timezone chip");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-action-grid"', "admin branch compact action row hook");
assertIncludes(sources.adminBranchesScreen, "grid shrink-0 grid-cols-[auto_auto_auto] items-center gap-1.5", "admin branch actions stay compact in the card header");
assertIncludes(sources.adminBranchesScreen, 'aria-label={`${branch.name} 대표 변경`}', "admin branch owner icon action has accessible label");
assertIncludes(sources.adminBranchesScreen, 'aria-label={`${branch.name} 운영 설정`}', "admin branch settings icon action has accessible label");
assertIncludes(sources.adminBranchesScreen, 'const [ownerEditorBranchId, setOwnerEditorBranchId] = useState<string | null>(null)', "admin branch owner form collapsed state");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-owner-toggle"', "admin branch owner toggle hook");
assertIncludes(sources.adminBranchesScreen, 'id={`admin-branch-owner-form-${branch.id}`}', "admin branch owner form controlled panel");
assertIncludes(sources.adminBranchesScreen, 'data-testid={`admin-branch-owner-form-${branch.id}`}', "admin branch owner form visible hook");
assertIncludes(sources.adminBranchesScreen, 'className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2', "admin branch owner form keeps compact mobile row");
assertIncludes(sources.adminBranchesScreen, "ownerEditorOpen ? (", "admin branch owner forms stay collapsed by default");
assertIncludes(sources.adminBranchesScreen, 'const [settingsEditorBranchId, setSettingsEditorBranchId] = useState<string | null>(null)', "admin branch settings form collapsed state");
assertIncludes(sources.adminBranchesScreen, 'data-testid="admin-branch-settings-toggle"', "admin branch settings toggle hook");
assertIncludes(sources.adminBranchesScreen, 'id={`admin-branch-settings-form-${branch.id}`}', "admin branch settings form controlled panel");
assertIncludes(sources.adminBranchesScreen, 'data-testid={`admin-branch-settings-form-${branch.id}`}', "admin branch settings form visible hook");
assertIncludes(sources.adminBranchesScreen, "grid grid-cols-3 gap-1", "admin branch settings fields use compact mobile three-column grid");
assertIncludes(sources.adminBranchesScreen, "pointer-events-none absolute left-2 top-1", "admin branch settings fields use inline labels to reduce editor height");
assertIncludes(sources.adminBranchesScreen, "h-11 w-full rounded-md border border-zinc-200 bg-white px-2 pb-1 pt-4 text-xs", "admin branch settings inputs keep a 44px touch height");
assertExcludes(sources.adminBranchesScreen, "h-10 w-full rounded-md border border-zinc-200 bg-white px-2 pb-1 pt-4 text-xs", "admin branch settings inputs must not regress below 44px");
assertIncludes(sources.adminBranchesScreen, "pb-1 pt-4 text-xs", "admin branch settings inputs reserve readable inline label space");
assertIncludes(sources.adminBranchesScreen, 'hashTarget === "create"', "admin branch create form supports hash deep links");
assertIncludes(sources.adminBranchesScreen, 'panelTarget === "create"', "admin branch create form supports query deep links");
assertIncludes(sources.adminBranchesScreen, 'match(/^settings-(.+)$/)?.[1]', "admin branch settings editor supports hash deep links");
assertIncludes(sources.adminBranchesScreen, "scrollBranchPanelIntoView", "admin branch settings hash target scrolls into view");
assertIncludes(sources.adminBranchesScreen, '<fieldset className="grid gap-2">', "admin branch settings policy toggle uses compact mobile stack");
assertIncludes(sources.adminBranchesScreen, 'data-testid={`admin-branch-settings-save-${branch.id}`}', "admin branch settings save button visible hook");
assertIncludes(sources.adminBranchesScreen, 'size="lg"', "admin branch inline form actions keep 44px touch height");
assertIncludes(sources.adminBranchesScreen, "settingsEditorOpen ? (", "admin branch settings forms stay collapsed by default");
assertIncludes(sources.ownerBranchesScreen, '<EmptyState title="배정된 지점이 없습니다" />', "owner branch title-only empty state");
assertIncludes(sources.ownerBranchesScreen, "const [openPolicyBranchIds, setOpenPolicyBranchIds] = useState<string[]>([]);", "owner branch policy details collapsed state");
assertIncludes(sources.ownerBranchesScreen, "function togglePolicy(branchId: string)", "owner branch policy toggle handler");
assertIncludes(sources.ownerBranchesScreen, 'data-testid="owner-branch-policy-summary"', "owner branch compact policy summary hook");
assertIncludes(sources.ownerBranchesScreen, 'data-testid="owner-branch-policy-toggle"', "owner branch policy toggle hook");
assertIncludes(sources.ownerBranchesScreen, 'data-testid="owner-branch-policy-detail"', "owner branch policy detail hook");
assertIncludes(sources.ownerBranchesScreen, 'data-testid="owner-branch-bottom-safe-area"', "owner branch bottom safe-area spacer hook");
assertIncludes(sources.ownerBranchesScreen, 'policyOpen ? (', "owner branch policy details stay collapsed by default");
assertExcludes(sources.ownerBranchesScreen, "지점 배정 대기 중입니다.", "owner branch repetitive waiting empty-state copy");
assertExcludes(sources.ownerBranchesScreen, "지점 연결 후 운영 현황을 확인할 수 있습니다.", "owner branch empty state verbose copy");
assertExcludes(sources.ownerBranchesScreen, "지점 연결 후 운영 데이터가 표시됩니다.", "owner branch empty state technical copy");
assertIncludes(sources.dataTable, 'emptyTitle = "표시할 항목이 없습니다"', "data table app-safe empty copy");
assertIncludes(sources.dataTable, "emptyDescription,", "data table title-only empty description default");
assertExcludes(sources.dataTable, 'emptyDescription = "현재 조건에 맞는 항목이 없습니다."', "data table repetitive default empty copy");
assertExcludes(sources.dataTable, 'emptyTitle = "데이터가 없습니다"', "data table technical empty copy");
assertIncludes(sources.mockApi, "정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "mock API app-safe error copy");
assertExcludes(sources.mockApi, "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "mock API technical error copy");
assertIncludes(sources.apiClient, "연결이 불안정합니다. 잠시 후 다시 시도해 주세요.", "API network error app-safe copy");
assertIncludes(sources.apiClient, "요청을 처리하지 못했습니다.", "API response fallback app-safe copy");
assertExcludes(sources.apiClient, "로컬 서버 또는 네트워크 상태", "API network error local-dev copy");
assertExcludes(sources.apiClient, "API 요청에 실패했습니다.", "API response fallback technical copy");
assertIncludes(sources.useResource, "정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "resource hook app-safe fallback copy");
assertExcludes(sources.useResource, "데이터를 불러오지 못했습니다.", "resource hook technical fallback copy");
assertExcludes(sources.useResource, "caught instanceof Error ? caught.message", "resource hook raw error message display");
assertIncludes(sources.appStore, "지점 선택을 저장하지 못했습니다.", "app store app-safe branch selection error copy");
assertExcludes(sources.appStore, "지점 범위 변경을 저장하지 못했습니다.", "app store internal branch scope error copy");
for (const snippet of [
  "네트워크가 불안정해 이 기기에 저장했고 다시 저장을 기다리고 있습니다.",
  "${memberIds.length}명의 출석을 이 기기에 저장했고 다시 저장을 기다리고 있습니다.",
  "대기 출석 ${queue.length}건을 다시 저장하고 있습니다.",
  "대기 출석 ${queue.length}건을 다시 저장했습니다.",
  "대기 출석 다시 저장에 실패했습니다.",
]) {
  assertIncludes(sources.appStore, snippet, "app store attendance save status app-safe copy");
}
for (const snippet of [
  "로컬에 저장했고 동기화 대기 중입니다.",
  "대기 출석 ${queue.length}건을 동기화하고 있습니다.",
  "대기 출석 ${queue.length}건을 동기화했습니다.",
  "대기 출석 동기화에 실패했습니다.",
]) {
  assertExcludes(sources.appStore, snippet, "app store attendance save status avoids technical sync copy");
}
assertIncludes(sources.pilotReadiness, "실제 시간표, 회원권, 결제 상태 입력 후 운영 현황 재확인", "pilot readiness app-safe data copy");
assertExcludes(sources.pilotReadiness, "실제 시간표, 회원권, 결제 상태 데이터 입력 후 운영 데이터 재확인", "pilot readiness technical data copy");
assertIncludes(sources.pilotReadiness, "계정별 비밀번호 교체와 전달 채널 확인", "pilot readiness password check app-safe copy");
assertExcludes(sources.pilotReadiness, "기본 초기 비밀번호 계정별 교체와 전달 채널 확인", "pilot readiness password check internal copy");
assertIncludes(sources.pilotReadiness, 'label: "접근성 현장 확인"', "pilot readiness app-facing accessibility label");
assertIncludes(sources.pilotReadiness, 'owner: "접근성 담당"', "pilot readiness app-facing accessibility owner");
assertExcludes(sources.pilotReadiness, 'owner: "QA"', "pilot readiness avoids internal QA owner abbreviation");
assertExcludes(sources.pilotReadiness, "실제 스크린리더와 키보드 운용 확인", "pilot readiness QA-style accessibility copy");
assertIncludes(sources.adminSettings, 'return "접근성 현장 확인";', "admin settings stale accessibility label normalization");
assertIncludes(sources.adminSettings, 'return "계정별 비밀번호 교체와 전달 채널 확인";', "admin settings stale password label normalization");
assertExcludes(sources.adminSettings, 'return "기본 초기 비밀번호 계정별 교체와 전달 채널 확인";', "admin settings stale password label internal copy");
assertIncludes(sources.runtimeDb, "실제 시간표, 회원권, 결제 상태 입력 후 운영 현황 재확인", "runtime DB app-safe pilot data copy");
assertExcludes(sources.runtimeDb, "실제 시간표, 회원권, 결제 상태 데이터 입력 후 운영 데이터 재확인", "runtime DB technical pilot data copy");

for (const snippet of [
  "coach-mobile-save-status-panel",
  "shouldShowMobileSaveStatusPanel",
  "hasPendingAttendance || attendanceSyncPending || Boolean(lastAttendanceChange)",
  'relative ${canEditAttendance ? "pb-36 lg:pb-0" : ""}',
  "bottom-[calc(6.5rem+env(safe-area-inset-bottom))]",
  "출석 {totalChecked}/{totalEnrolled} · 미처리 {totalUnchecked}",
  '저장 대기 ${attendanceSync.pendingCount}건',
  'data-testid="attendance-retry-mobile"',
  'data-testid="attendance-sync-status-mobile"',
  'data-testid="attendance-undo-last-mobile"',
  "min-h-11",
  'offline: "저장 대기"',
  'aria-label="대기 출석 저장 재시도"',
  "저장 재시도",
]) {
  assertIncludes(sources.classesScreen, snippet, "coach mobile save status panel safe area");
}
for (const snippet of [
  'offline: "오프라인 대기"',
  'aria-label="대기 출석 동기화"',
  '"동기화 마감"',
  '"동기화 확인"',
  '"동기화 상태 확인"',
  '"동기화 24시간 후속"',
  '"동기화 예외 처리"',
  '"동기화 기록"',
  '"동기화 증거 기록 정리"',
  '"30초 동기화"',
  "오프라인 대기",
  "재동기화",
]) {
  assertExcludes(sources.classesScreen, snippet, "coach visible save status avoids technical sync copy");
}
assertIncludes(sources.classesScreen, "출석 처리 {totalChecked}/{totalEnrolled}", "coach attendance summary compact title includes key counts");
assertExcludes(sources.classesScreen, "오늘 출석 처리", "coach attendance summary all-class title cleanup");
for (const snippet of [
  "const [classCreateFormOpen, setClassCreateFormOpen] = useState(false);",
  'data-testid="class-create-panel"',
  'data-testid="class-create-toggle"',
  'data-testid="class-create-form"',
  'data-testid="class-create-field"',
  'data-testid="class-create-submit"',
  'id="class-create-form"',
  "classCreateFormOpen ? (",
  'aria-expanded={classCreateFormOpen}',
  '{classCreateFormOpen ? "닫기" : "열기"}',
  'className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"',
  'className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"',
  'data-testid="class-edit-form"',
  'data-testid="class-edit-input"',
  'data-testid="class-edit-submit"',
]) {
  assertIncludes(sources.classesScreen, snippet, "owner and admin class create form default collapse");
}
for (const snippet of [
  "coachClassRosterOpenById",
  "coachClassListExpanded",
  "coachClassMobileVisibleLimit = 1",
  "coachClassListCollapsible",
  "hiddenCoachClassCount",
  "function toggleCoachClassRoster",
  "const defaultOpenCoachClassId =",
  'data-testid={`coach-class-roster-toggle-${session.id}`}',
  'data-testid={`coach-class-roster-panel-${session.id}`}',
  'data-testid={`coach-class-roster-collapsed-${session.id}`}',
  'data-testid="coach-class-list-toggle"',
  'data-coach-class-mobile-state={isCoachRole ? (coachClassCollapsedOnMobile ? "hidden" : "visible") : undefined}',
  "hidden lg:block",
  "오늘 수업 ${hiddenCoachClassCount}개 더 보기",
	  'data-coach-class-roster-state={coachRosterOpen ? "open" : "closed"}',
	  "inline-flex shrink-0 items-center gap-2",
	  "명단 {visibleMembers.length}/{session.enrolledMembers.length}",
	  "미처리 ${attendanceProgress.uncheckedCount}`",
	  'className="sr-only"',
	  "미처리 ${attendanceProgress.uncheckedCount}명",
	  "출석 완료",
]) {
  assertIncludes(sources.classesScreen, snippet, "coach class roster default collapse");
}
for (const snippet of [
  "attendanceNoteEditorOpenByKey",
  "function setAttendanceNoteEditorOpen",
  'data-testid={`attendance-note-toggle-${session.id}-${member.id}`}',
  'data-testid={`attendance-note-editor-${session.id}-${member.id}`}',
  'className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"',
  'className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"',
  'className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"',
  'className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"',
  "coachReasonRequiredStatuses.includes(nextStatus)",
  "const defaultOpenCoachClassId =",
  "hasAttendanceRosterFilter",
  ": null;",
]) {
  assertIncludes(sources.classesScreen, snippet, "coach attendance note compact editor");
}
for (const snippet of [
  "coachClassInternalPanelCount",
	  "coachClassVisibleCodeCount",
  "coachVisibleClassCardCount",
  "coachClassListToggleCount",
  "coachClassListToggleMinHeight",
  "coachClassRosterToggleBottomNavOverlapCount",
  "coachClassListToggleBottomNavOverlapCount",
		  "coachClassAttendanceNoteToggleCount",
		  "coachClassAttendanceNoteEditorCount",
		  "coachClassRosterClosedMaxHeight <= 2",
  "coach classes must keep the mobile default list short enough to avoid bottom navigation overlap",
  "coach class roster toggles must not overlap the mobile bottom navigation",
		  "coachFieldFlowPanelHeight <= 64",
		  "coachFirstClassCardTop <= 430",
		  "coachClassCardMaxHeight <= 135",
		  "coach classes must hide attendance note toggles until a roster is opened",
	  "coach classes must keep rosters collapsed by default on mobile",
	  "coach classes must merge collapsed roster status into the toggle without a duplicate visible row",
  "coach classes must not expose internal P3 operation panels in the app UI",
  "coach classes must not render code-style internal closeout text in the app UI",
  "ownerReportInternalPanelCount",
  "ownerReportVisibleCodeCount",
  "owner reports must not expose internal P3 operation panels in the app UI",
  "owner reports must not render code-style internal operation checks in the app UI",
  "admin-users-edit-hash-deeplink.png",
  "/app/admin/users#edit-user-owner",
  "adminUserEditHashDeepLinkFormCount",
  "adminUserEditHashDeepLinkPasswordSectionCount",
  "adminUserEditShellHeaderTop",
  "adminUserEditFormTop",
  "admin users edit form must open near the sticky header instead of below a blank viewport",
  "adminUserEditHashDeepLinkShellHeaderTop",
  "adminUserEditHashDeepLinkFormTop",
  "admin users edit hash deep link must place the form near the sticky header",
  "admin users edit hash deep link must open the owner edit form",
  "adminUserActionStackMaxHeight",
  "admin users action controls must render as a narrow vertical icon stack on mobile",
  "admin users action controls must render edit/delete/reset as three vertical actions",
  "admin users action controls must keep the vertical action stack compact",
  "adminUserFirstActionOverlapBottomNavCount",
  "admin users first action stack must not overlap the mobile bottom navigation",
  "admin users first action stack must keep visual clearance above the mobile bottom navigation",
  "accountStatusCardCount",
  "accountActiveStatusLabelCount",
  "must not show a redundant active account status card",
  "must not repeat the active status label",
]) {
  assertIncludes(sources.visibleAppCopyScript, snippet, "visible-copy internal panel and account compactness guard");
}
for (const snippet of [
  'data-testid="coach-attendance-control-panel"',
  'className="min-w-0 flex-1"',
  "visibleAttendanceStatusFilters",
  "attendanceCounts.filter((item) => item.count > 0 || attendanceStatusFilter === item.status)",
  "flex gap-1 overflow-x-auto pb-0.5",
  "inline-flex min-h-11 min-w-0",
  "sm:min-w-16",
  "? `전체 ${selectedAttendanceStatusCount}명`",
  "showAttendanceControlMeta",
  'data-testid="attendance-status-filter-count"',
  'attendanceSync.status === "idle" && !attendanceSync.updatedAt ? "변경 없음"',
  'className="hidden grid-cols-3 gap-2 sm:grid sm:grid-cols-5"',
]) {
  assertIncludes(sources.classesScreen, snippet, "coach mobile attendance filter compact layout");
}
for (const snippet of [
  'className="-mx-1 mt-2 overflow-x-auto px-1 pb-1"',
  "flex w-max gap-2 sm:w-auto sm:flex-wrap",
]) {
  assertExcludes(sources.classesScreen, snippet, "coach mobile attendance filter avoids horizontal crop");
}
assertExcludes(sources.classesScreen, "`상태 전체 ${selectedAttendanceStatusCount}명`", "coach mobile attendance filter verbose status copy");
assertExcludes(sources.classesScreen, 'label: "수업 상태"', "coach quick action no longer repeats class status as a separate chip");
assertExcludes(sources.classesScreen, "수업별 회원 상태 요약", "coach quick action verbose class summary label");
for (const snippet of [
  "function coachQuickActionClass",
  "coachAttentionFilterActive",
  "aria-pressed={showUncheckedOnly}",
  "coachQuickActionClass(showReasonRequiredOnly, \"amber\")",
  "aria-pressed={coachAttentionFilterActive}",
  'className="mb-2 rounded-lg border border-teal-200 bg-teal-50/40 p-1.5 sm:p-4"',
  'data-testid="coach-mobile-speed-summary-line"',
  "coachMobileSpeedSummaryText",
  'hasAttendanceRosterFilter ? "grid-cols-4" : "grid-cols-3"',
  "미처리 명단만 보기",
  "출석 필터 초기화",
  "min-h-11 w-full min-w-0",
]) {
  assertIncludes(sources.classesScreen, snippet, "coach quick action mobile density compact layout");
}
for (const snippet of [
  'className="mt-1.5 grid grid-cols-4 gap-1"',
  'data-testid="coach-mobile-speed-summary-chip"',
  'title={`${card.label}: ${card.detail}`}',
]) {
  assertExcludes(sources.classesScreen, snippet, "coach quick action must not repeat old summary chip grid");
}
for (const snippet of [
  "coach-field-flow-panel",
  'data-testid="coach-field-flow-compact-grid"',
  'data-testid="coach-field-flow-compact-column"',
  'data-testid="coach-field-flow-compact-summary"',
  "coachPreClassFlowSummary",
  "coachPostClassFlowSummary",
  "수업 진행",
  "수업 전</h3>",
  "수업 후</h3>",
  "{totalCheckedPercent}% 완료",
]) {
  assertIncludes(classesVisibleSource, snippet, "coach visible class flow panel");
}
assertExcludes(classesVisibleSource, "수업 흐름", "coach visible class flow panel avoids document-style label");
assertExcludes(classesVisibleSource, "mt-1 hidden break-words text-xs leading-5 text-zinc-500 sm:block", "coach class flow helper copy no longer uses hidden mobile detail rows");
for (const snippet of [
  "coach-mobile-speed-panel",
  "coach-mobile-speed-summary-line",
  "coach-field-flow-panel",
  "coach-field-flow-compact-grid",
  "수업 진행",
  "수업 전",
  "수업 후",
  "미처리",
  "사유",
  "주의",
]) {
  assertIncludes(sources.classesScreen, snippet, "coach compact field flow app-safe copy");
}
for (const snippet of [
  "코치 공개 상담",
  "주의/상담 공개 회원",
  "수업 정보만 표시",
  "수업 기록 중심",
  "수업 기록만 확인",
  "수업 기록 확인",
  "마감 확인",
  "운영 기록",
  "운영 확인",
  "진행 상태만 확인",
]) {
  assertExcludes(sources.classesScreen, snippet, "coach compact field flow internal copy");
}

for (const snippet of [
  "p3-coach-one-tap-field-rail",
  "p3-coach-field-checklist",
  "p3-coach-post-class-24h-followup-queue",
  "1탭 현장 레일",
  "수업 전 준비 큐",
  "수업 전 5분 준비 보드",
  "현장 후속 조치 큐",
  "수업 전환 리듬",
  "예외 처리 라우팅 보드",
  "현장 기록 압축 보드",
  "현장 마감 우선순위 보드",
  "수업 확인 보드",
  "3분 마감 루틴 보드",
  "보호자 안내 마감 큐",
  "수업 후 24시간 후속 큐",
  "1탭 흐름",
  "기록 압축",
  "결제 금액 비노출 유지",
  "코치 화면 금액 미노출",
  "운영 상태와 분리",
  "감사 로그",
  "releaseGuard",
  "최근 출석 변경 기록",
  "변경 기록 확인",
  "확인 기록",
  "현장에서 먼저 볼 미처리, 사유 입력, 상담/주의 회원을 한 번에 모읍니다.",
]) {
  assertExcludes(classesVisibleSource, snippet, "classes visible app copy internal coach operation panels");
}
for (const snippet of ["저장 정상", "출석 처리", "미처리", "수업 진행", "수업 전", "수업 후"]) {
  assertIncludes(sources.classesScreen, snippet, "coach compact operational records app-safe copy");
}
for (const snippet of [
  "감사 로그 확인",
  "동기화/감사 인계",
  "attendance.update 감사",
  "출석 마감 인계",
  "사유 메모 인계",
  "보호자 안내 인계",
  "동기화 기록 인계",
  "수업 사이 인계",
  "인계 마감",
]) {
  assertExcludes(sources.classesScreen, snippet, "coach operational records internal audit copy");
}

for (const snippet of [
  "showInternalOwnerOperationPanels",
  "p3-owner-decision-board",
  "p3-branch-standard-performance-action-board",
  "P3",
  "releaseGuard",
  "releaseBoundary",
  "운영 증거",
  "운영 확인",
  "진행률만 갱신",
  "선택한 기간 필터 기준으로",
  "CSV는 대표/총괄만",
  "기간별 회원, 출석, 결제, 매출 흐름을 비교합니다.",
  "결제 위험, 출석 하락, 회원 이탈, 매출 변화를 함께 봅니다.",
  "수업일, 출석 확인, 결제 기한, 공지 생성일, 회원 생성·퇴관·상태 변경일 기준입니다.",
  "대표 운영 판단 보드",
  "대표 운영 판단",
  "p2-owner-operations-board",
  "CSV 포함",
]) {
  assertExcludes(ownerReportsVisibleSource, snippet, "owner reports visible app copy internal operation panels");
  assertExcludes(sources.ownerReportsScreen, snippet, "owner reports retired internal operation source");
}
for (const snippet of [
  "운영 판단",
  "운영 판단 보드",
  "운영 데이터 의사결정 보드",
  "유지율 후속 기록",
  "지점 액션 마감 점검",
  "지점 표준 품질 점검",
  "지점 표준 확산 확인",
  "지점 표준 재교육 효과 확인",
  "지점 표준 성과 액션 확인",
  "대상 그룹",
  "그룹 신호",
  "확인 기준 {guardrail}",
  "결제 상태 확인",
  "결제 상태 이력과 내보내기 제외 확인",
  "미처리 없음 확인",
  "출석 마감 체크리스트",
]) {
  assertExcludes(sources.ownerReportsScreen, snippet, "owner reports retired internal operation source");
}
assertExcludes(sources.ownerReportsScreen, "export.create 제외 변경 기록", "owner reports internal audit event copy");
assertExcludes(sources.ownerReportsScreen, "결제 상태 변경 기록", "owner reports internal change-record wording");
assertExcludes(sources.ownerReportsScreen, "결제 상태 이력과 내보내기 제외 변경 기록", "owner reports internal export change-record wording");
for (const snippet of [
  "P3 유지율 후속 기록 보드",
  "P3 지점 액션 닫힘 점검 보드",
  "P3 지점 표준 품질 점검 보드",
]) {
  assertIncludes(
    `${sources.readme}\n${sources.releaseChecklist}\n${sources.qaPlan}\n${sources.implementationBacklog}`,
    snippet,
    "P3 documentation operation tracking labels",
  );
}
for (const snippet of [
  "P3 유지율 후속 감사 보드",
  "P3 지점 액션 닫힘 감사 보드",
  "P3 지점 표준 품질 감사 보드",
  "후속 감사",
  "닫힘 감사",
  "품질 감사",
  "장기 추세와 오늘의 위험/재등록/회수 후보를 묶어 대표가 먼저 볼 액션을 고릅니다.",
  "위험 회원, 재등록 후보, 결제 회수 우선순위를 오늘 연락 대상과 다음 확인으로 바꿉니다.",
  "재등록 후보, 결제 회수 우선순위, 위험 회원, 장기 추세를 코호트로 묶어 다음 운영 리뷰 순서를 정합니다.",
  "기준 지점 대비 출석 격차, 위험 금액 비중, 추세 압력을 함께 보고 지점별 운영 비교와 액션 추천 개선에 씁니다.",
  "출석률 하락, 결제 위험 증가, 보강 대기, 회원 순감, 매출 하락을 조기 경보 점수로 묶어 오늘 먼저 볼 지점을 고릅니다.",
  "지점 액션 닫힘 점검 보드",
  "지점 액션 표준화 보드",
  "지점 표준 확산 추적 보드",
  "지점 표준 품질 점검 보드",
  "지점 표준 재교육 큐",
  "지점 표준 재교육 효과 검증 보드",
  "지점 표준 운영 정착 보드",
  "지점 표준 성과 리포트 보드",
  "지점 표준 성과 액션 추적 보드",
  "재교육 큐 #",
  "정착 보드 #",
  "코호트 신호",
  "결제 후속 조치 큐",
  "수업 전 준비 큐",
  "회원/학부모 다음 행동 큐",
  "재방문 약속 큐",
  "lifecycle",
  "예시",
  "캡처",
  "SLA",
  "템플릿",
]) {
  assertExcludes(sources.ownerReportsScreen, snippet, "owner reports internal audit wording cleanup");
}

assertIncludes(sources.nextConfig, "devIndicators: false", "Next dev indicator mobile overlay guard");

for (const snippet of [
  "getSafeNextPath",
  "user?.role === requestedRole",
  "router.replace(nextPath)",
  'new Set(["localhost", "127.0.0.1", "::1"])',
  "process.env.NODE_ENV === \"production\" && !isLocalAutoLoginHost",
  "const [manualPhone, setManualPhone] = useState<string | null>(null);",
  'const [password, setPassword] = useState("");',
  "hydrated &&",
  'typeof window !== "undefined"',
  'new URLSearchParams(window.location.search).get("quickLogin") === "1"',
  'placeholder="휴대폰 번호 입력"',
  "파이널 로그인",
]) {
  assertIncludes(sources.loginScreen, snippet, "login autoLogin same-session deep-link guard");
}
assertExcludes(sources.loginScreen, "const [showLocalShortcuts] = useState(() =>", "login SSR hydration-safe shortcut guard");
assertExcludes(sources.loginScreen, "setShowLocalShortcuts", "login SSR hydration-safe shortcut guard");
assertIncludes(sources.loginScreen, "useSyncExternalStore", "login registered notice uses hydration-safe URL search subscription");
assertIncludes(sources.loginScreen, "getServerLocationSearch", "login registered notice starts from a stable server snapshot");
assertIncludes(sources.loginScreen, 'const registered = locationParams.get("registered") === "1";', "login registered notice is derived from the client URL search snapshot");
assertIncludes(sources.loginScreen, "function normalizePhoneQuery(value: string)", "login registered phone query is normalized before filling the form");
assertIncludes(sources.loginScreen, 'const registeredPhone = normalizePhoneQuery(locationParams.get("phone") ?? "");', "login registered notice can carry the just-registered phone number");
assertIncludes(sources.loginScreen, "const phone = manualPhone ?? registeredPhone;", "login registered phone does not overwrite manual user input");
assertIncludes(
  sources.loginScreen,
  "회원가입이 완료되었습니다. 휴대폰 번호와 비밀번호로 로그인해 주세요.",
  "login registered notice phone/password copy",
);
assertExcludes(sources.loginScreen, "관리자 승인 후 로그인", "login registered notice avoids duplicate admin approval copy");
assertExcludes(sources.loginScreen, "useMemo(() => typeof window", "login registered notice must not read window during render");
assertExcludes(sources.loginScreen, "setRegistered(", "login registered notice must not set state synchronously in an effect");
assertExcludes(sources.loginScreen, "setPhone(registeredPhone", "login registered notice must not fill phone with a synchronous effect state update");
assertExcludes(sources.loginScreen, 'placeholder="admin@finaljudo.test"', "login visible credential placeholder");
assertExcludes(sources.loginScreen, "@finaljudo.test", "login client shortcut seed email cleanup");
assertExcludes(sources.loginScreen, "FinalJudoPilot!2026", "login client default password cleanup");
assertExcludes(sources.loginScreen, "계정 입력 도구", "login local account fill tool cleanup");
assertExcludes(sources.loginScreen, "계정 채우기", "login local account fill tool cleanup");
assertExcludes(sources.loginScreen, "빠른 입력 비밀번호", "login visible default password helper");
assertExcludes(sources.loginScreen, "운영 계정 로그인", "login visible operator-only title");
assertExcludes(sources.loginScreen, "세션을 시작합니다", "login visible technical session copy");
assertExcludes(sources.loginScreen, "이메일과 비밀번호를 입력해 로그인하세요.", "login compact header copy");
for (const snippet of ["export function FinalWordmark", 'data-testid="final-wordmark"', 'aria-label={ariaHidden ? undefined : "FINAL"}']) {
  assertIncludes(sources.finalWordmark, snippet, "vector final brand mark");
}
assertIncludes(sources.finalWordmark, 'letterSpacing="0"', "vector final brand mark keeps zero letter spacing");
assertExcludes(sources.finalWordmark, 'letterSpacing="-', "vector final brand mark must not use negative letter spacing");
for (const [label, source] of [
  ["app shell brand", sources.appShell],
  ["login brand", sources.loginScreen],
  ["full page loading brand", sources.stateBlocks],
]) {
  assertIncludes(source, "FinalWordmark", label);
  assertExcludes(source, "/brand/final-logo-wordmark-sharp.png", `${label} raster logo cleanup`);
}
assertIncludes(sources.stateBlocks, 'title = "화면을 불러오지 못했습니다"', "state block app-safe error title");
assertExcludes(sources.stateBlocks, 'title = "데이터를 불러오지 못했습니다"', "state block technical error title");
assertIncludes(sources.stateBlocks, "불러오는 중", "compact loading state copy");
assertIncludes(sources.appError, 'description="잠시 후 다시 시도해 주세요."', "app error boundary app-safe description");
assertExcludes(sources.appError, "description={error.message", "app error boundary raw error message");
assertIncludes(sources.appStore, "toUserFacingErrorMessage", "app store user-facing error sanitizer");
assertIncludes(sources.appStore, "error instanceof ApiClientError", "app store keeps only API client messages");
assertExcludes(sources.appStore, "error instanceof Error ? error.message", "app store raw error message display");
assertIncludes(sources.paymentsScreen, "error instanceof ApiClientError ? error.message", "payments export app-safe API error feedback");
assertIncludes(sources.ownerReportsScreen, "error instanceof ApiClientError ? error.message", "owner report export app-safe API error feedback");
assertIncludes(sources.noticesScreen, "error instanceof ApiClientError ? error.message", "notice push app-safe API error feedback");
assertIncludes(sources.appLoading, "<LoadingState />", "app route loading compact copy");
assertIncludes(sources.stateBlocks, 'role="status"', "loading state accessibility status");
assertIncludes(sources.stateBlocks, 'aria-live="polite"', "loading state accessibility live region");
assertExcludes(sources.stateBlocks, "준비 중", "loading state development-like copy");
assertExcludes(sources.appLoading, 'LoadingState label="준비 중"', "app route loading old explicit copy");
assertExcludes(sources.stateBlocks, "화면을 준비하고 있습니다", "full page loading verbose copy cleanup");
assertExcludes(sources.appLoading, "화면을 준비하고 있습니다", "app route loading verbose copy cleanup");
assertExcludes(sources.appLoading, "화면을 준비하는 중", "app route loading verbose copy cleanup");
assertExcludes(sources.stateBlocks, "화면 준비 중", "full page loading blank-state cleanup");
assertExcludes(sources.stateBlocks, "세션 확인 중", "full page loading technical copy");
for (const [label, source, oldSnippets, newSnippets] of [
  [
    "dashboard loading/error copy",
    sources.dashboardScreen,
    ["대시보드 데이터를 불러오는 중", "대시보드 데이터가 비어 있습니다.", "화면을 불러오는 중"],
    ["오늘 확인할 내용을 불러오지 못했습니다."],
  ],
  [
    "payments loading/error copy",
    sources.paymentsScreen,
    [
      "결제 데이터를 불러오지 못했습니다.",
      "결제 데이터가 없습니다",
      "회원권이나 납부 내역이 등록되면 표시됩니다.",
      "회원권이나 납부 내역이 생기면 확인할 수 있습니다.",
      "등록된 회원권 없음",
    ],
    ["결제 내역을 불러오지 못했습니다.", "결제 내역이 없습니다"],
  ],
  ["members error copy", sources.membersScreen, ["회원 데이터를 불러오지 못했습니다."], ["회원 정보를 불러오지 못했습니다."]],
  [
    "classes error copy",
    sources.classesScreen,
    ["수업 데이터를 불러오지 못했습니다."],
    ["수업과 출석 명단을 불러오지 못했습니다."],
  ],
  ["notices error copy", sources.noticesScreen, ["공지 데이터를 불러오지 못했습니다."], ["공지를 불러오지 못했습니다."]],
]) {
  for (const snippet of oldSnippets) {
    assertExcludes(source, snippet, label);
  }
  for (const snippet of newSnippets) {
    assertIncludes(source, snippet, label);
  }
}
assertExcludes(sources.requestsScreen, "보강 요청을 불러오지 못했습니다.", "deleted requests screen must not keep request loading error copy");
for (const [label, source] of [
  ["classes loading copy", sources.classesScreen],
  ["members loading copy", sources.membersScreen],
  ["payments loading copy", sources.paymentsScreen],
  ["notices loading copy", sources.noticesScreen],
  ["admin audit loading copy", sources.adminAuditLogsScreen],
]) {
  assertIncludes(source, "<LoadingState />", label);
  assertExcludes(source, 'LoadingState label="준비 중"', label);
  assertExcludes(source, 'LoadingState label="화면을 준비하고 있습니다"', label);
}
assertExcludes(sources.roles, "roleDescriptions", "role description dead data cleanup");
assertIncludes(sources.roles, 'label: "변경 기록"', "admin audit navigation app-safe label");
assertIncludes(sources.roles, 'description: "운영 변경 기록 조회"', "admin audit navigation app-safe description");
assertExcludes(sources.roles, 'label: "감사"', "admin audit navigation internal label");
assertExcludes(sources.roles, "감사 로그 검색과 변경 추적", "admin audit navigation internal description");
for (const snippet of [
  '"notification.subscribe": "알림 수신 등록"',
  '"notification.unsubscribe": "알림 수신 해제"',
  '"notification.dispatch": "공지 알림 발송"',
  '"payment.webhook": "결제 상태 반영"',
]) {
  assertIncludes(sources.auditLogPresentation, snippet, "shared admin audit action app-safe labels");
}
for (const snippet of ['"notification.subscribe": "푸시 구독"', '"notification.unsubscribe": "푸시 해지"', '"notification.dispatch": "푸시 발송"', '"payment.webhook": "결제 webhook"']) {
  assertExcludes(sources.auditLogPresentation, snippet, "shared admin audit action technical labels");
}
for (const [label, source] of [
  ["login local shortcut visible copy", sources.loginScreen],
  ["role selection visible copy", sources.selectRoleScreen],
]) {
  for (const snippet of [
    "본인 수업, 출석, 결제 상태, 공지를 확인합니다.",
    "연결된 자녀의 일정, 출석, 결제, 보강 요청을 관리합니다.",
    "담당 수업 명단과 출석, 수업 메모를 처리합니다.",
    "지점 운영 현황, 회원, 수업, 결제, 직원을 관리합니다.",
    "전체 지점과 권한, 기준 데이터, 감사 로그를 관리합니다.",
  ]) {
    assertExcludes(source, snippet, `${label} compact role shortcut copy`);
  }
}
assertIncludes(sources.visibleAppCopyScript, "authRoleShortcutButtonMinHeight", "visible copy scan measures role shortcut touch height");
assertIncludes(sources.visibleAppCopyScript, "authRoleShortcutButtonText", "visible copy scan records role shortcut labels");
assertIncludes(sources.visibleAppCopyScript, "authSelectRoleLoginLinkHeight", "visible copy scan measures select-role login link touch height");
assertIncludes(
  sources.visibleAppCopyScript,
  "signup submit text must not be counted as a role shortcut",
  "visible copy scan blocks phone signup submit miscount",
);
assertIncludes(sources.visibleAppCopyScript, "finalWordmarkLinkCount", "visible copy scan separates FINAL dashboard links from public wordmarks");
assertIncludes(sources.visibleAppCopyScript, "finalWordmarkVisualMinHeight", "visible copy scan measures public FINAL wordmark visual height");
assertIncludes(
  sources.visibleAppCopyScript,
  "public auth wordmark link touch height must be explicit 0",
  "visible copy scan blocks Infinity/null FINAL wordmark link evidence",
);
assertIncludes(sources.loginScreen, 'data-testid="login-account-switch-button"', "authenticated login account switch action is directly measurable");
assertIncludes(sources.loginScreen, "mt-3 inline-flex min-h-11", "authenticated login account switch action keeps a 44px touch height");
assertIncludes(sources.selectRoleScreen, 'data-testid="select-role-login-link"', "select-role login link is directly measurable");
assertIncludes(sources.selectRoleScreen, "inline-flex min-h-11 items-center justify-center rounded-md border", "select-role login link keeps a 44px touch height");
assertIncludes(sources.appStore, 'const publicAuthPathnames = new Set(["/signup", "/reset-password"]);', "login/select-role cookie-only session restore is not skipped");
assertIncludes(sources.appStore, "apiClient.getOptionalBootstrap(null)", "login/select-role cookie-only session restore uses optional bootstrap");
assertIncludes(sources.bootstrapRoute, 'request.nextUrl.searchParams.get("optional") === "1"', "bootstrap API supports optional auth entry restore");
assertIncludes(sources.apiClient, "getOptionalBootstrap", "api client exposes optional bootstrap");
assertIncludes(sources.loginKeepSignedInScript, "cookie-only restored login screen shows the account switch action", "login keep-signed-in proof covers cookie-only app restarts");

for (const snippet of [
  'matcher: "/login"',
  'localAutoLoginHosts.has(request.nextUrl.hostname)',
  'request.nextUrl.searchParams.get("autoLogin") !== "1"',
  'NextResponse.redirect(new URL(getSafeNextPath(request), request.url))',
  'secure: false',
]) {
  assertIncludes(sources.proxy, snippet, "local simulator autoLogin proxy guard");
}

for (const snippet of [
  'runtime = "nodejs"',
  'localAutoLoginHosts.has(request.nextUrl.hostname)',
  'NextResponse.redirect(new URL(getSafeNextPath(request), request.url))',
  'secure: false',
]) {
  assertIncludes(sources.devAutoLoginRoute, snippet, "local simulator dev auto-login route guard");
}

for (const snippet of [
  "p5-p10-internal-readiness-status",
  "P5~P10 내부 readiness audit",
  "P5-P10 internal audit",
  "P5~P10은 release ready 판정이 아님",
  "P5~P10 iOS Simulator 증빙",
  "p5-p10-release-boundary-guard",
  "judokan.store 참고값 finaljudo 확정값으로 치환 금지",
  "P3 회원/학부모 확인 브리프",
  "P3 회원/학부모 오늘 확인 브리프",
  "주간 확인 리듬",
  "회원/학부모 다음 행동 큐",
  "P3 다음 행동 큐",
  "확인 마감 슬롯",
  "재방문 약속 큐",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings app UI internal release content");
}
for (const snippet of [
  "운영 점검 확인",
  "확인 필요 항목",
  "대기 점검 정리",
  "대기 중인 점검 항목의 담당자와 확인 메모를 채웁니다.",
  "운영 점검은",
  "운영 점검",
  "점검 상태 저장",
]) {
  assertIncludes(sources.adminSettings, snippet, "admin settings app-safe operation readiness wording");
}
for (const snippet of [
  "준비 확인 자료 초안",
  "준비 확인 자료와 계정 점검 초안을 만들고 빈 항목을 채웁니다.",
  "준비 항목은",
  "운영 준비 항목",
  "준비 항목 수정",
  "준비 상태 저장",
  "준비 증빙 초안 생성",
  "준비 증빙과 계정 점검 초안을 만들고 빈 증빙을 채웁니다.",
  "준비 게이트",
  "준비 게이트는",
  "운영 준비 게이트",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings internal operation readiness wording");
}

for (const snippet of [
  "targetLabel: string",
  'targetLabel: "운영 담당자 확인"',
  'targetLabel: "운영 상태 확인"',
  "{action.targetLabel}",
]) {
  assertIncludes(sources.adminSettings, snippet, "admin settings app-safe action target labels");
}
for (const snippet of [
  "function formatAdminAppReference",
  "formatAdminAppReference(",
  "{action.target}",
  "action.target}",
  'target: "npm run',
  "npm run pilot:prelaunch-draft",
  "npm run pilot:status",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings client source must not keep internal command references");
}
for (const snippet of [
  "const showInternalReadinessPanels = false;",
  "function formatAdminVisibleText(value: string)",
  "function formatAdminCommandReference(value: string)",
  "function formatAdminRouteReference(value: string)",
  "formatAdminCommandReference(",
  "formatAdminRouteReference(",
  "formatAdminVisibleText(",
  "automatedReleaseGates",
  "p1ReadinessHandoffItems",
  "p1ReadinessEvidenceLanes",
  "p2DevelopmentSummaryCards",
  "p3DevelopmentSummaryCards",
  "p4SimulatorSummaryCards",
  "p1-release-readiness-heading",
  "p2-internal-development-status",
  "p3-operations-status",
  "p4-simulator-rehearsal-status",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings must keep retired internal readiness/release panels out of the client screen source");
}
for (const snippet of [
  '.replaceAll("P1 release readiness", "출시 준비 판단")',
  '.replaceAll("P1 readiness", "출시 준비 상태")',
  '.replaceAll("P1 release blocked", "외부 준비 대기")',
  '.replaceAll("handoff", "인수인계")',
  'return "출시 준비 상태 갱신";',
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings formatter must not reintroduce release/handoff wording into app UI");
}
assertIncludes(sources.adminSettings, "function formatAdminPilotCheckLabel(value: string)", "admin settings app-safe pilot label formatter");
assertIncludes(sources.adminSettings, "formatAdminPilotCheckLabel(check.label)", "admin settings pilot label app-safe rendering");
assertIncludes(sources.adminSettings, 'value.replace("파일럿 지점", "운영 준비 지점")', "admin settings pilot branch label app-safe rendering");
assertIncludes(sources.adminSettings, 'value.replace("실제 파일럿 계정", "운영 계정").replace("파일럿 계정", "운영 계정")', "admin settings pilot account label app-safe rendering");
assertIncludes(sources.adminSettings, 'value.replace("파일럿 종료 후", "운영 종료 후")', "admin settings pilot retro label app-safe rendering");
assertIncludes(sources.adminSettings, 'value.replace("test:pilot 재검증", "운영 현황 재확인")', "admin settings pilot data label app-safe rendering");
assertIncludes(sources.adminSettings, 'data-testid="admin-settings-summary-bar"', "admin settings summary stays a compact status bar");
assertIncludes(sources.adminSettings, 'className="grid min-h-11 grid-cols-3 overflow-hidden rounded-md border border-zinc-200 bg-white"', "admin settings summary uses readable compact mobile status bar");
assertExcludes(sources.adminSettings, ">보강</p>", "admin settings summary must remove deleted request policy label");
for (const snippet of [
  "const [readinessEditorOpen, setReadinessEditorOpen] = useState(false);",
  "const [readinessListOpen, setReadinessListOpen] = useState(false);",
  "const [operationEditorOpen, setOperationEditorOpen] = useState(false);",
  "const [incidentCreateOpen, setIncidentCreateOpen] = useState(false);",
  "const [incidentEditorId, setIncidentEditorId] = useState<string | null>(null);",
  "const [rolePolicyOpen, setRolePolicyOpen] = useState(false);",
  "const [branchPolicyOpen, setBranchPolicyOpen] = useState(false);",
  "const [auditPolicyOpen, setAuditPolicyOpen] = useState(false);",
  'data-testid="admin-settings-readiness-editor-toggle"',
  'data-testid="admin-settings-summary-bar"',
  'data-testid="admin-settings-readiness-list-toggle"',
  'data-testid="admin-settings-role-policy-summary"',
  'data-testid="admin-settings-role-policy-toggle"',
  'data-testid="admin-settings-role-policy-detail"',
  'data-testid="admin-settings-branch-policy-summary"',
  'data-testid="admin-settings-branch-policy-toggle"',
  'data-testid="admin-settings-branch-policy-detail"',
  'data-testid="admin-settings-audit-policy-summary"',
  'data-testid="admin-settings-audit-policy-toggle"',
  'data-testid="admin-settings-audit-policy-detail"',
  'data-testid="admin-settings-operation-log-toggle"',
  'data-testid="admin-settings-incident-create-toggle"',
  'data-testid="admin-settings-incident-editor-toggle"',
  'data-testid="admin-settings-operation-log-summary"',
  'data-testid="admin-settings-incident-create-summary"',
]) {
  assertIncludes(sources.adminSettings, snippet, "admin settings operational forms collapsed-by-default contract");
}
for (const snippet of [
  'data-testid="admin-settings-readiness-list" id="admin-settings-readiness-list"',
  'data-testid="admin-settings-operation-log-form" id="admin-settings-operation-log-form"',
  'data-testid="admin-settings-incident-create-form" id="admin-settings-incident-create-form"',
  'data-testid="admin-settings-incident-editor-form" id={`admin-settings-incident-editor-${incident.id}`}',
  'data-testid="admin-settings-role-policy-detail" id="admin-settings-role-policy-detail"',
  'data-testid="admin-settings-branch-policy-detail" id="admin-settings-branch-policy-detail"',
  'data-testid="admin-settings-audit-policy-detail" id="admin-settings-audit-policy-detail"',
]) {
  assertIncludes(sources.adminSettings, snippet, "admin settings operational forms remain available behind toggles");
}
for (const snippet of [
  "{lane.output}</code>",
  "{step.terminal}</code>",
  "{item.nextAction}</code>",
  "{item.draftArtifact}</code>",
  "{item.blockedReport}</code>",
  "{item.firstGate}</code>",
  "{item.strictGate}</code>",
  "{item.artifact}\n                    </span>",
  "{item.route}</code>",
  "{item.screenshot}</code>",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings rendered references must be app-safe labels");
}
assertExcludes(adminSettingsVisibleSource, "기본 보강 한도", "admin settings verbose deleted request limit summary label");
assertExcludes(adminSettingsVisibleSource, "입력이 필요할 때만 운영 로그 입력", "admin settings operation log avoids long helper copy");
assertExcludes(adminSettingsVisibleSource, "지점별 중복 로그", "admin settings operation day copy avoids log jargon");
assertExcludes(adminSettingsVisibleSource, "확인 로그", "admin settings mobile attendance copy avoids log jargon");
assertExcludes(adminSettingsVisibleSource, "운영 로그 입력", "admin settings operation action avoids log jargon");
assertExcludes(adminSettingsVisibleSource, "운영 로그 저장", "admin settings operation save action avoids log jargon");
assertExcludes(adminSettingsVisibleSource, "아직 기록된 운영 로그가 없습니다.", "admin settings empty operation record avoids log jargon");
assertIncludes(adminSettingsVisibleSource, "운영 기록 입력", "admin settings operation action uses record wording");
assertIncludes(adminSettingsVisibleSource, "운영 기록 저장", "admin settings operation save action uses record wording");
assertIncludes(adminSettingsVisibleSource, "확인 운영일", "admin settings operation day summary uses app-safe wording");
assertExcludes(adminSettingsVisibleSource, "새 현장 이슈가 생겼을 때만", "admin settings incident create avoids long helper copy");
for (const snippet of [
  "운영 기준",
  "지점별 데이터 분리",
  "코치 금액 비노출",
  "관리자 승인 기준",
  "역할별 정보 제한",
]) {
  assertIncludes(adminSettingsVisibleSource, snippet, "admin settings visible operation standards app-safe copy");
}
for (const snippet of [
  "데이터 운영 기준",
  "핵심 데이터는 지점 ID 기준으로 격리합니다.",
  "운영 준비 데이터는 승인된 관리자 화면과 확인된 운영 절차로 반영합니다.",
  "개인정보와 결제 노출 범위를 확인합니다.",
]) {
  assertExcludes(adminSettingsVisibleSource, snippet, "admin settings visible operation standards technical copy");
}
assertIncludes(sources.selectRoleScreen, 'const showRoleShortcuts = process.env.NODE_ENV !== "production";', "select-role production shortcut guard");
for (const snippet of [
  "내부 자동 검증 목록",
  "P1 최종 배포 준비",
  "P2 개발 착수 상태",
  "P3 운영 고도화 상태",
  "P4 실제 사용 환경 검증 상태",
  "npm run",
  "doctor",
  "handoff",
  ".data/",
  "iOS Simulator 성공을 IPA ready로 보지 않음",
  "release ready",
  "Release guard",
  "release boundary",
  "blocked guard",
  "P1 release",
  "P1 readiness",
  "P1 blocked",
  "preflight/status",
  "post-pilot",
  "최종 preflight",
  "{action.target}</code>",
  "임시 우회책/조치 메모",
  "당일 담당자 지정, 임시 우회책",
  "담당자, 임시 우회책",
  "코치 스냅샷은 결제 금액을 서버에서 마스킹합니다.",
  "검증된 운영 절차",
  "개인정보/결제 데이터 마스킹 정책",
  "test:pilot 재검증",
  "파일럿 운영",
  "파일럿 준비 게이트",
  "파일럿 운영 전 확인",
  "파일럿 14일 운영 로그",
  "파일럿 계정",
  "파일럿 이슈",
  "미해결 P0/P1",
  "P0/P1",
  "P1 당일 수정",
  "P2 개선 후보",
  "P0 운영 중단",
  "P0 {incidentSummary.p0}건",
  "follow-up 링크",
]) {
  assertExcludes(adminSettingsVisibleSource, snippet, "admin settings visible app copy");
}

for (const [label, source] of [
  ["login visible copy", sources.loginScreen],
  ["member/guardian dashboard visible copy", sources.dashboardScreen],
  ["payments visible copy", sources.paymentsScreen],
  ["notices visible copy", sources.noticesScreen],
  ["notice push feedback copy", sources.noticePushRoute],
  ["requests visible copy", sources.requestsScreen],
  ["owner reports visible copy", ownerReportsVisibleSource],
]) {
  for (const snippet of ["npm run", "handoff", "doctor", ".data/", "release ready", "Release guard", "VAPID", "공지 푸시 발송 권한", "검증 명령", "운영 상태와 분리"]) {
    assertExcludes(source, snippet, label);
  }
}

for (const [label, source, snippets] of [
  ["app shell visible copy", sources.appShell, ["FINAL JUDO OPS", "파이널 유도 멀티짐"]],
  ["app metadata", `${sources.appLayout}\n${sources.appManifest}`, ["운영툴 MVP", "운영 MVP", "MVP"]],
  ["not found visible copy", sources.notFound, ["MVP 범위"]],
  [
    "members visible copy",
    sources.membersScreen,
    [
      "name@example.com",
      "지점 권한",
      "자기 지점 범위",
      "대표는 담당 지점의 코치, 학부모, 회원을 초대할 수 있습니다.",
      "권한으로 접근 가능한 회원 정보만 표시합니다.",
      "공개 범위에 따라 학부모/코치 화면 노출이 달라집니다.",
      "현재 역할과 지점 범위에서 조회 가능한 회원이 없습니다.",
    ],
  ],
  [
    "payments visible copy",
    sources.paymentsScreen,
    [
      "현재 필터 기준으로 먼저 연락하거나 확인할 결제 항목입니다.",
      "현재 필터에서 먼저 처리할 결제가 없습니다.",
      "현재 역할과 지점 범위에서 확인할 결제 내역이 없습니다.",
      "필터 조건에 맞는 결제가 없습니다",
      "온라인 결제와 영수증 상태를 확인할 수 있습니다.",
    ],
  ],
  [
    "notices visible copy",
    sources.noticesScreen,
    [
      "역할과 지점 범위에 맞는 공지",
      "현재 필터에서 먼저 확인할 공지입니다.",
      "현재 필터에서 먼저 확인할 공지가 없습니다.",
      "반/개인 대상 공지 기준",
      "현재 필터에서 대상별 후속 조치가 없습니다.",
      "알림 설정, 권한, 수신 등록 상태를 확인합니다.",
      "현재 역할과 지점 범위에서 확인할 공지가 없습니다.",
      "현재 필터 읽음 처리",
      "현재 필터의 미읽음 공지",
      "현재 필터의 공지를 읽음 처리하지 못했습니다.",
      "지점 권한",
      "권한 필요",
      "준비 필요",
      "알림 발송 준비",
      "필터 조건에 맞는 공지가 없습니다",
    ],
  ],
  [
    "requests visible copy",
    sources.requestsScreen,
    [
      "지점 권한",
      "현재 역할과 지점 범위에서 확인할 결석/보강 요청이 없습니다.",
      "현재 역할과 지점 범위에서 표시할 공지가 없습니다.",
    ],
  ],
  [
    "classes visible copy",
    sources.classesScreen,
    [
      "선택한 지점 또는 현재 역할에 배정된 수업이 없습니다.",
      "수업 사이 확인에서 빠지기 쉬운 출석",
      "현장에서 먼저 볼 미처리",
      "출석 명단, 주의/상담, 사유 메모",
      "npm run test:p3-operations",
      "npm run test:e2e",
    ],
  ],
  [
    "dashboard metric visible copy",
    `${sources.dashboardScreen}\n${sources.mockApi}`,
    [
      "역할과 지점 범위 기준",
      "접근 가능한 회원",
      "오늘 수업 기준",
      "선택한 지점과 역할 범위에서 오늘 진행할 수업이 없습니다.",
      "지점 스코프",
      "상단 지점 필터",
    ],
  ],
  [
    "pilot operations API user copy",
    sources.pilotOperationsRoute,
    ["파일럿 일일 운영 기록을 저장했습니다."],
  ],
  [
    "notification subscription API user copy",
    sources.notificationSubscriptionsRoute,
    ["푸시 구독 endpoint", "브라우저 키"],
  ],
[
  "app store user copy",
  sources.appStore,
  ["임시 비밀번호를 발급하지 못했습니다.", "지점 범위 변경을 저장하지 못했습니다."],
],
  [
    "login visible copy",
    sources.loginScreen,
    [
      "FINAL JUDO OPS",
      "MVP",
      "파일럿 계정",
      "임시 비밀번호",
      "공통 임시 비밀번호",
      "개발용 계정 빠른 입력",
      "개발/테스트 역할 선택",
      "역할별 운영 화면을 바로 검증합니다",
      "데모 계정으로 로그인",
      "운영 계정 로그인",
      "세션을 시작합니다",
    ],
  ],
  ["role selection visible copy", sources.selectRoleScreen, ["데모 계정"]],
  ["invite accept visible copy", sources.inviteAcceptScreen, ["초대된 계정의 초기 비밀번호를 설정합니다."]],
  ["role login error copy", `${sources.mockApi}\n${sources.authLoginRoute}`, ["데모 계정", "데모 역할", "목 API 오류", "로컬스토리지"]],
  [
    "password reset visible copy",
    sources.passwordResetScreen,
    ["name@example.com", "감사 로그", "운영자 확인", "임시 비밀번호", "사용 중인 계정을 확인할 수 있게 정보를 입력해 주세요."],
  ],
  ["admin branch management visible copy", sources.adminBranchesScreen, ["파일럿 지점", "파일럿 제외", "분당 도장", "경기 성남"]],
  ["classes visible copy", sources.classesScreen, ["코치 모바일 빠른 조치", "수업별 회원 상태 요약"]],
  [
    "admin user management visible copy",
    sources.adminUsersScreen,
    [
      "email@example.com",
      "전체 지점 권한",
      "역할과 지점 범위",
      "지점 범위",
      "지점 접근 범위",
      "권한 코드",
      "관리 코드",
      "파일럿 계정",
      "RBAC",
      "임시 비밀번호",
      "예: 계정별 비밀번호 교체",
    ],
  ],
  ["admin audit visible copy", sources.adminAuditLogsScreen, ["임시 비밀번호", "비활성 기록"]],
  [
    "admin role management visible copy",
    sources.adminRolesScreen,
    [
      "email@example.com",
      "전체 지점 권한",
      "역할과 지점 범위",
      "지점 범위",
      "권한 코드",
      "관리 코드",
      "RBAC",
      "self-lockout",
      "super_admin",
      "시스템 역할",
      "기본 역할 세트",
      "감사 로그",
      "감사 이벤트",
      "출석 또는 보강 요청 변경 후 이 영역에 감사 로그가 표시됩니다.",
    ],
  ],
  [
    "account visible copy",
    sources.accountScreen,
    [
      "RBAC",
      "권한 코드",
      "현재 역할",
      "지점 범위",
      "지점 접근 범위",
      "`/reset-password`",
      "감사 로그와 함께",
      "{context.user.email}",
      "mobileSessionChecks",
      'data-testid="mobile-account-session-panel"',
      "앱 이용 상태",
    ],
  ],
  [
    "role access error copy",
    sources.protectedRoute,
    ["접근 권한이 없습니다", "현재 역할은", "다른 역할로 로그인", "이 화면을 사용할 수 없습니다", "화면을 사용할 수 없습니다"],
  ],
  [
    "requests visible copy",
    `${sources.requestsScreen}\n${sources.mockData}\n${sources.seedSql}\n${sources.runtimeDb}`,
    ["예: 감기로 결석한 수업 보강 요청", "예: 감기로", "감기로 결석한 수업 보강 요청"],
  ],
  [
    "admin settings visible copy",
    sources.adminSettings,
    [
      "역할/RBAC 기준",
      "샘플 계정",
      "기본 임시 비밀번호",
      "테스트 결과",
      "예: iPhone 현장 수업 전체 출석 22초 녹화 링크",
      "예: 송파 도장 출석 저장 실패",
      "pending ack",
      "secret-like",
      "샘플 mailto subject",
      "TODO, *_EVIDENCE_URI",
      "감사 정책",
      "감사 로그 필수 이벤트",
      "감사 로그 조회",
      'placeholder="/app/classes"',
      "일시, 재현 절차, 기대 결과, 실제 결과를 기록",
    ],
  ],
  [
    "admin audit visible copy",
    adminAuditLogsVisibleSource,
    ["파일럿 준비", "파일럿 이슈", "파일럿 운영 로그", "감사 로그", "{log.action}", "{log.targetType} · {log.targetId}"],
  ],
  [
    "notices visible copy",
    sources.noticesScreen,
    [
      "테스트 알림",
      "final-judo-notice-test",
      "푸시 알림 키",
      "서버 푸시",
      "키 필요",
      "구독 가능",
      "구독됨",
      "공지 후속 조치 큐",
      "공지/알림 후속 조치 보드",
      "대상별 후속 조치",
      "푸시 미구성/실패 사유",
      "실기기 확인 필요",
      "알림 키 미설정",
      "중요 공지 푸시 점검",
      "푸시 알림 설정 확인",
      "우선 {action.score}",
      "서비스 워커",
      "수신 상태",
      "공지 알림은 준비 중입니다.",
      "공지 알림을 아직 사용할 수 없습니다.",
      "공지 알림 수신 준비가 확인되었습니다.",
      "이 기기에서는 공지 알림을 사용할 수 없습니다.",
      "이 브라우저에서는 알림을 사용할 수 없습니다.",
      "브라우저 권한",
    ],
  ],
  [
    "payments visible copy",
    `${sources.paymentsScreen}\n${sources.paymentWebhookRoute}`,
    [
      "mock provider",
      "provider-neutral",
      "mock checkout",
      "provider 실패 응답",
      "provider 환불 webhook",
      "providerPaymentId와 결제 webhook 이벤트",
      "결제 provider webhook을 처리했습니다.",
      "webhook secret이 설정되지 않았습니다.",
      "결제 webhook 인증",
      "리허설",
      "PG/VAN",
      "준비 연동",
      "외부 연동",
      "결제 연동 준비 상태",
      "온라인 결제 연결 전",
      "온라인 결제 요청과 영수증",
      "결제 후속 조치 큐",
      "먼저 처리할 결제",
      "우선 {action.score}",
    ],
  ],
]) {
  for (const snippet of snippets) {
    assertExcludes(source, snippet, `${label} production-like wording`);
  }
}

assertIncludes(sources.onlinePaymentsHelper, "getOnlinePaymentRuntimeReadiness", "online payment production runtime readiness helper");
assertIncludes(sources.onlinePaymentsHelper, "PAYMENT_PROVIDER_NOT_CONFIGURED", "online payment provider production blocker");
assertIncludes(sources.onlinePaymentsHelper, "PAYMENT_CHECKOUT_BASE_URL_MISSING", "online payment checkout base URL production blocker");
assertIncludes(sources.onlinePaymentsHelper, "PAYMENT_WEBHOOK_SECRET_MISSING", "online payment webhook secret production blocker");
assertIncludes(sources.onlinePaymentsHelper, 'env.NODE_ENV === "production"', "online payment production-only strictness");
assertIncludes(sources.onlineCheckoutRoute, "getOnlinePaymentRuntimeReadiness", "online checkout runtime readiness guard");
assertIncludes(sources.onlineCheckoutRoute, "온라인 결제 설정 확인이 필요합니다.", "online checkout app-safe setup copy");
assertIncludes(sources.recurringAgreementRoute, "getOnlinePaymentRuntimeReadiness", "recurring agreement runtime readiness guard");
assertIncludes(sources.recurringAgreementRoute, "온라인 결제 설정 확인이 필요합니다.", "recurring agreement app-safe setup copy");
assertIncludes(sources.paymentWebhookRoute, "결제 승인 상태를 확인해 주세요.", "payment webhook app-safe failure reason");
assertIncludes(sources.paymentWebhookRoute, "결제 환불 상태가 반영되었습니다.", "payment webhook app-safe refund reason");
assertExcludes(sources.paymentWebhookRoute, "body.reason?.trim()", "payment webhook raw provider reason");
assertIncludes(sources.productionPreflight, "getOnlinePaymentRuntimeReadiness", "production preflight payment runtime readiness guard");
assertIncludes(sources.productionPreflightTest, "PAYMENT_PROVIDER_NOT_CONFIGURED", "production preflight payment provider missing test");
assertIncludes(sources.productionPreflightTest, "PAYMENT_CHECKOUT_BASE_URL_MISSING", "production preflight payment checkout missing test");
assertIncludes(sources.productionPreflightTest, "PAYMENT_WEBHOOK_SECRET_MISSING", "production preflight payment webhook missing test");

for (const source of [sources.classesScreen, sources.membersScreen]) {
  assertIncludes(source, '{ value: "kids", label: "유소년" }', "age group app-safe label");
  assertExcludes(source, '{ value: "kids", label: "키즈" }', "age group casual label");
}
assertIncludes(sources.format, "export function formatPhoneNumber", "phone number app display formatter");
assertIncludes(sources.format, 'digits.startsWith("8210")', "phone number +82 display formatter");
assertIncludes(sources.format, 'return `010-${digits.slice(4, 8)}-${digits.slice(8)}`;', "phone number Korean display formatter");
assertIncludes(sources.membersScreen, 'formatPhoneNumber } from "@/lib/format"', "member contact display formatter import");
assertIncludes(sources.membersScreen, "emergencyContact: formatPhoneNumber(member.emergencyContact)", "member contact edit draft formatting");
assertIncludes(sources.membersScreen, 'data-testid={`member-profile-contact-summary-${member.id}`}', "member contact summary test hook");
assertIncludes(sources.membersScreen, "{formatPhoneNumber(member.emergencyContact)}", "member contact display formatting");
assertExcludes(sources.membersScreen, "{member.emergencyContact}</dd>", "member raw emergency contact display");
for (const source of [sources.mockData, sources.runtimeDb, sources.seedSql]) {
  for (const snippet of ["유소년 유도 기초반", "유소년 낙법 집중반", "송파 유소년반", "유소년 주 3회권", "유소년 주 2회권"]) {
    assertIncludes(source, snippet, "seed data app-safe youth copy");
  }
  for (const snippet of ["키즈 유도 기초반", "키즈 낙법 집중반", "송파 키즈반", "키즈 주 3회권", "키즈 주 2회권"]) {
    assertExcludes(source, snippet, "seed data casual youth copy");
  }
}
assertIncludes(sources.productionPreflightTest, 'name: "파일럿 유소년반"', "preflight fixture app-safe youth copy");
assertExcludes(sources.productionPreflightTest, 'name: "파일럿 키즈반"', "preflight fixture casual youth copy");

for (const [label, source] of [
  ["admin user management test email masking", sources.adminUsersScreen],
  ["admin role management test email masking", sources.adminRolesScreen],
]) {
  assertIncludes(source, 'import { getVisibleUserEmail } from "@/lib/user-display";', label);
  assertIncludes(source, "getVisibleUserEmail(user.email)", label);
  assertIncludes(source, "{visibleEmail}", label);
  assertExcludes(source, "{user.email}</p>", label);
}

assertIncludes(sources.noticePermissions, 'export const noticePublisherRoles = new Set<UserRole>(["owner", "admin", "coach"]);', "member and guardian notice operation board visibility guard");
for (const snippet of [
  "noticePublisherRoles.has(context.user.role)",
  'const isCoachNoticeReader = context.user.role === "coach" && !canPublishNotice;',
  "showNoticeScreenHeader",
  "const showNoticeAside = canPublishNotice;",
]) {
  assertIncludes(sources.noticesScreen, snippet, "member and guardian notice operation board visibility guard");
}
for (const snippet of ["const showNoticeOperations = canPublishNotice;", "showNoticeSettings", "NotificationPermissionPanel", "notice-action-queue", "p2-notice-follow-up-board"]) {
  assertExcludes(sources.noticesScreen, snippet, "member and guardian notice operation boards stay removed");
}

for (const snippet of [
  "const showNoticeDeliveryMeta = canPublishNotice;",
  "showNoticeDeliveryMeta ? (",
  "${formatDateTime(notice.createdAt)} · 읽음 ${getNoticeReadCount(notice)}명",
  '{showNoticeScreenHeader ? <SectionHeader title="공지" /> : null}',
]) {
  assertIncludes(sources.noticesScreen, snippet, "notice delivery metadata stays limited to publishing roles");
}
assertExcludes(sources.noticesScreen, "hideWhenUnavailable={!showNoticeDeliveryMeta}", "notice settings side card stays removed");

for (const snippet of [
  'const showNoticeDeliveryMeta = context.user.role !== "member" && context.user.role !== "guardian";',
  "const showRequestScreenHeader = !canCreate;",
  "const showMemberSelector = data.members.length > 1;",
  'const requestFormGridClass = "mt-2.5 grid grid-cols-2 gap-2";',
  '{showRequestScreenHeader ? <SectionHeader title="보강 요청" /> : null}',
  'rounded-lg border px-3 text-sm font-semibold transition',
  '"border-zinc-200 bg-white text-zinc-950 hover:bg-zinc-50"',
  '<Send className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />',
  '"보강/결석 요청 작성"',
  '"요청 작성 닫기"',
  'data-testid="member-request-form-toggle"',
  "grid grid-cols-2 gap-2",
  "requestTypeFieldClass",
  "requestFromClassFieldClass",
  "requestTargetClassFieldClass",
  'grid grid-cols-[minmax(0,1fr)_auto]',
  '{context.user.role === "guardian" ? "자녀" : "회원"}',
  'placeholder="사유 입력"',
  '요청하기',
  '{canCreate ? "요청 내역" : "요청 목록"}',
  'showNoticeDeliveryMeta ? ` · 요청자 ${request.requestedBy?.name ?? "요청자 확인 중"}` : null',
]) {
  assertExcludes(sources.requestsScreen, snippet, "deleted requests screen must not keep request form/list structure");
}
assertExcludes(
  sources.requestsScreen,
  '<h2 className="text-base font-semibold text-zinc-950">요청 작성</h2>',
  "member and guardian request create action avoids a large heading-only card",
);
assertExcludes(
  sources.requestsScreen,
  '"bg-zinc-950 text-white hover:bg-zinc-800"',
  "member and guardian request create action avoids a heavy black CTA",
);
for (const snippet of [
  "보강 요청 만들기",
  '<h2 className="text-base font-semibold text-zinc-950">새 요청</h2>',
  'placeholder="요청 사유 입력"',
  '<h2 className="text-base font-semibold text-zinc-950">결석/보강 요청</h2>',
  "{session.enrolledMemberIds.length}/{session.capacity}",
  "{targetClass.enrolledMemberIds.length}/{targetClass.capacity}",
]) {
  assertExcludes(sources.requestsScreen, snippet, "member and guardian request compact form copy");
}
assertExcludes(sources.requestsScreen, "보강/공지", "requests screen mixed request and notice title");
assertIncludes(sources.adminSettings, '<SectionHeader title="운영 설정" />', "admin settings user-facing title");
assertIncludes(sources.adminSettings, 'aria-label="운영 설정 요약"', "admin settings summary aria label");
assertExcludes(sources.adminSettings, '<SectionHeader title="시스템 설정" />', "admin settings system-facing title");
assertExcludes(sources.adminSettings, 'aria-label="시스템 설정 요약"', "admin settings system-facing summary label");
for (const [source, snippet, label] of [
  [sources.classesScreen, 'const showClassesScreenHeader = context.user.role !== "member" && context.user.role !== "guardian";', "classes member/guardian screen header guard"],
  [sources.classesScreen, '{showClassesScreenHeader ? <SectionHeader title="수업/출석" /> : null}', "classes member/guardian repeated title removal"],
  [sources.paymentsScreen, 'const showPaymentsScreenHeader = context.user.role !== "member" && context.user.role !== "guardian";', "payments member/guardian screen header guard"],
  [sources.paymentsScreen, "{showPaymentsScreenHeader ? (", "payments member/guardian repeated title removal"],
  [sources.appShell, 'const isAccountRoute = pathname === "/app/account" || pathname.startsWith("/app/account/");', "family account route header logout guard"],
  [sources.appShell, "const showMobileHeaderLogout = !showMobileSessionRail && !isAccountRoute;", "member/guardian compact header logout guard"],
  [sources.appShell, 'data-testid="mobile-header-logout-button"', "member/guardian compact header logout test id"],
  [sources.visibleAppCopyScript, "familyRepeatedScreenHeaderCount", "visible copy repeated family screen header guard"],
  [sources.visibleAppCopyScript, "mobileSessionRailCount", "visible copy family session rail guard"],
  [sources.visibleAppCopyScript, "mobileHeaderLogoutButtonCount", "visible copy family header logout guard"],
  [sources.visibleAppCopyScript, "mobileHeaderLogoutButtonCount, 0", "visible copy family account header logout removal guard"],
  [sources.visibleAppCopyScript, "mobileHeaderLogoutButtonHeight >= 44", "visible copy family header logout touch guard"],
  [sources.visibleAppCopyScript, "mobileBottomNavRouteIds", "visible copy mobile nav order guard"],
  [sources.visibleAppCopyScript, "mobileBottomNavActiveRouteIds", "visible copy mobile active nav route guard"],
  [sources.visibleAppCopyScript, "mobileBottomNavCurrentRouteIds", "visible copy mobile current nav route guard"],
  [sources.visibleAppCopyScript, 'mobileBottomNavScrollerDisplay, "grid"', "visible copy fixed mobile nav grid guard"],
  [sources.visibleAppCopyScript, "mobileBottomNavGridColumnCount", "visible copy fixed mobile nav column guard"],
  [sources.visibleAppCopyScript, "mobileBottomNavScrollerScrollWidth <= layout.mobileBottomNavScrollerClientWidth", "visible copy fixed mobile nav no-overflow guard"],
  [sources.visibleAppCopyScript, "mobileBottomNavNoticeBadgeCount", "visible copy mobile notice badge guard"],
  [sources.visibleAppCopyScript, "mobileBottomNavNoticeBadgeContained", "visible copy mobile notice badge containment guard"],
  [sources.visibleAppCopyScript, "mobileBottomNavNoticeBadgePointerEvents", "visible copy mobile notice badge tap guard"],
  [sources.visibleAppCopyScript, "must activate the notices bottom-nav item", "visible copy notices active nav guard"],
  [sources.visibleAppCopyScript, "`${expectedFamilyNoticeLabel}, 미확인 공지`", "visible copy family mobile unread notice aria guard"],
  [sources.visibleAppCopyScript, "`${expectedFamilyNoticeLabel}, 확인 필요 결제`", "visible copy family mobile payment alert aria guard"],
  [sources.visibleAppCopyScript, "`${expectedCoachNoticeLabel}, 미확인 공지`", "visible copy coach mobile unread notice aria guard"],
  [sources.visibleAppCopyScript, "`${expectedCoachNoticeLabel}, 확인 필요 결제`", "visible copy coach mobile payment alert aria guard"],
  [sources.visibleAppCopyScript, "familyNoticeCardMaxHeight <= 132", "visible copy compact family notice card guard"],
  [sources.visibleAppCopyScript, "familyNoticeBodyMaxHeight <= 44", "visible copy compact tappable family notice body guard"],
  [sources.visibleAppCopyScript, "familyNoticeFilterGridColumnCount", "visible copy family notice toolbar grid guard"],
  [sources.visibleAppCopyScript, "familyNoticeDetailToggleCount", "visible copy family notice content toggle guard"],
  [sources.noticesScreen, 'data-testid="family-notice-filter-grid"', "family notice toolbar stays as a fixed grid"],
  [sources.noticesScreen, 'data-testid="family-notice-detail-toggle"', "family notice details open from the content area"],
  [sources.visibleAppCopyScript, "familyNoticeDateLineCount", "visible copy compact family notice date row guard"],
  [sources.visibleAppCopyScript, "noticeDeliveryCompactCardMaxHeight <= 132", "visible copy compact operator notice card guard"],
  [sources.visibleAppCopyScript, "noticeDeliveryBodyVisibleCount, 0", "visible copy hidden operator notice body guard"],
  [sources.visibleAppCopyScript, "noticeDeliveryReadCardToneDownCount", "visible copy read operator notice card tone-down guard"],
  [sources.visibleAppCopyScript, "noticeDeliveryReadBadgeToneDownCount", "visible copy read operator notice badge tone-down guard"],
  [sources.visibleAppCopyScript, "noticeDeliveryActionButtonMaxWidth <= 56", "visible copy compact operator notice action guard"],
  [sources.visibleAppCopyScript, "accountActionPanelCount", "visible copy family account action guard"],
  [sources.visibleAppCopyScript, "accountRoleSwitchLinkHeight >= 44", "visible copy account switch touch guard"],
  [sources.visibleAppCopyScript, "accountLogoutButtonHeight >= 44", "visible copy account logout touch guard"],
  [sources.visibleAppCopyScript, "guardianChildChipMaxHeight <= 52", "visible copy guardian child chip compact height guard"],
  [sources.visibleAppCopyScript, "guardianChildChipMinHeight >= 44", "visible copy guardian child chip touch guard"],
  [sources.visibleAppCopyScript, "guardianChildChipStatusTextCount", "visible copy guardian child chip status-label guard"],
  [sources.visibleAppCopyScript, "guardianLearningInsightGridHeight <= 122", "visible copy guardian learning compact grid height guard"],
  [sources.visibleAppCopyScript, "guardianLearningInsightCellMinHeight >= 56", "visible copy guardian learning touch guard"],
  [sources.visibleAppCopyScript, "guardianLearningInsightCellMaxHeight <= 58", "visible copy guardian learning compact card guard"],
  [sources.visibleAppCopyScript, "guardianLearningActionStripCount", "visible copy guardian learning action strip guard"],
  [sources.visibleAppCopyScript, "guardianLearningActionLinkMinHeight >= 44", "visible copy guardian action strip touch guard"],
  [sources.visibleAppCopyScript, "guardianLearningActionHrefs.includes(href)", "visible copy guardian action strip href guard"],
  [sources.visibleAppCopyScript, "guardianLearningActionAriaLabels", "visible copy guardian action strip aria-label guard"],
  [sources.visibleAppCopyScript, '"owner-branches"', "visible copy owner branches route coverage"],
  [sources.visibleAppCopyScript, '"member-notifications"', "visible copy member notifications alias coverage"],
  [sources.visibleAppCopyScript, '"guardian-notifications"', "visible copy guardian notifications alias coverage"],
  [sources.visibleAppCopyScript, "mobileBottomNavNoticeHref", "visible copy bottom notice href evidence"],
  [sources.visibleAppCopyScript, "mobileBottomNavNoticeLabel", "visible copy bottom notice label evidence"],
  [sources.visibleAppCopyScript, 'testCase.next === "/app/notices" ? "공지" : "알림"', "visible copy path-aware notice label guard"],
  [sources.visibleAppCopyScript, 'layout.mobileBottomNavNoticeHref, "/app/notices"', "visible copy notices bottom href guard"],
  [sources.visibleAppCopyScript, 'layout.mobileBottomNavNoticeHref, "/app/notifications"', "visible copy notifications bottom href guard"],
  [sources.visibleAppCopyScript, "localhost|127\\.0\\.0\\.1|example\\.com", "visible copy local/example origin guard"],
  [sources.dashboardScreen, 'className="order-1 overflow-hidden rounded-lg border border-zinc-200 bg-white"', "owner dashboard surfaces branch comparison before risk summary on mobile"],
  [sources.dashboardScreen, 'className="order-2 grid gap-2 xl:gap-3"', "owner dashboard keeps compact risk summary below branch comparison on mobile"],
  [sources.visibleAppCopyScript, "ownerDashboardRiskSummaryTop", "visible copy owner dashboard risk summary position guard"],
  [sources.visibleAppCopyScript, "ownerDashboardRiskSummaryBottomNavOverlap", "visible copy owner dashboard risk summary bottom nav overlap guard"],
  [sources.visibleAppCopyScript, "ownerDashboardDetailToggleBottomNavOverlap", "visible copy owner dashboard detail toggle bottom nav overlap guard"],
  [sources.visibleAppCopyScript, "ownerDashboardDetailToggleBottomNavClearance", "visible copy owner dashboard detail toggle bottom nav clearance guard"],
  [sources.visibleAppCopyScript, "ownerBranchComparisonRowBottomNavOverlap", "visible copy owner dashboard branch row bottom nav overlap guard"],
  [sources.visibleAppCopyScript, "ownerBranchComparisonCardBottomNavClearance", "visible copy owner dashboard branch card bottom nav clearance guard"],
  [sources.visibleAppCopyScript, "ownerBranchHealthGraphCount", "visible copy owner branch graph guard"],
  [sources.visibleAppCopyScript, "ownerBranchBottomSafeAreaCount", "visible copy owner branch bottom safe-area guard"],
  [sources.visibleAppCopyScript, "ownerBranchActionBottomNavClearanceAtScrollEnd", "visible copy owner branch scroll-end action clearance guard"],
  [sources.visibleAppCopyScript, "ownerBranchPolicyDetailCount", "visible copy owner branch policy collapse guard"],
  [sources.visibleAppCopyScript, "ownerBranchPolicyToggleMinHeight >= 44", "visible copy owner branch policy touch guard"],
  [sources.visibleAppCopyScript, "ownerBranchActionLinkMinHeight >= 44", "visible copy owner branch action touch guard"],
  [sources.visibleAppCopyScript, "ownerBranchActionToggleMinHeight >= 44", "visible copy owner branch action expansion touch guard"],
  [sources.visibleAppCopyScript, "/^(member|guardian)-(classes|members|payments|notices|notifications)$/", "visible copy member/guardian title guard scope"],
]) {
  assertIncludes(source, snippet, label);
}
for (const snippet of [
  "확인 기준",
]) {
  assertIncludes(sources.adminSettings, snippet, "admin settings app-safe operations label");
}
for (const snippet of [
  "외부 증빙 수집 확인",
  "P2 내부 작업 목록",
  "P2 내부 작업 완료",
  "P3 운영 기록 갱신",
  "P3 운영 자동화 실행",
  "피드백 운영 반영",
  "주간 리뷰 액션 추적",
  "주간 리뷰 효과 확인",
  "운영 자동화 실패 복구",
  "현장 피드백 분류",
  "피드백 접수",
  "피드백 증거 묶음",
  "피드백 회고 액션",
  "피드백 실행 확인",
  "피드백 재발 방지",
  "피드백 응답 기준",
  "피드백 운영 지표",
  "외부 증빙 수집 큐",
  "P2 내부 작업 큐",
  "P2 내부 큐 완료",
  "P3 운영 증거 갱신 큐",
  "P3 운영 자동화 실행 큐",
  "P3 피드백 운영 반영 큐",
  "P3 피드백 운영 반영",
  "P3 백로그 후보",
  "피드백 증거 패킷",
  "P3 주간 리뷰 액션 추적 보드",
  "P3 주간 리뷰 효과 측정 보드",
  "P3 운영 자동화 실패 복구 보드",
  "P3 파일럿 피드백 분류",
  "P3 피드백 트리아지 루프",
  "P3 피드백 QA 반영 캘린더",
  "P3 피드백 접수 보드",
  "P3 피드백 증거 패킷 보드",
  "P3 피드백 회고 액션 보드",
  "P3 피드백 실행 검증 보드",
  "P3 피드백 재발 방지 보드",
  "P3 피드백 SLA 레인",
  "P3 피드백 운영 지표 보드",
  "가드레일",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings internal queue/guardrail label");
}
assertIncludes(sources.adminSettings, '<option value="">전체 지점</option>', "admin settings branch fallback app copy");
assertIncludes(sources.adminSettings, '{branch?.name ?? "전체 지점"}', "admin settings branch badge fallback app copy");
assertExcludes(sources.adminSettings, "전체/시스템", "admin settings branch fallback system copy");

for (const snippet of [
  "const todayDateKey = formatDateKey(new Date());",
  "const isUpcomingRequestSession",
  "formatDateKey(session.endsAt) >= todayDateKey",
  ".filter(isUpcomingRequestSession)",
  "const baseTargetClasses",
  "session.id !== selectedFromClassId",
  "formatCompactTime",
  "function formatRequestClassLabel",
  "결석할 예정 수업",
  "보강 희망 수업",
  "예정 수업 없음",
  "결석만 요청할 때는 선택하지 않습니다",
  "다른 예정 수업 없음",
  "formatRequestClassLabel(session, remainingSeats)",
  "formatRequestClassLabel(targetClass, targetClassRemainingSeats)",
  "formatFamilyRequestClassLabel",
  'data-testid="member-guardian-request-flow-row"',
  "지난 수업",
]) {
  assertExcludes(sources.requestsScreen, snippet, "deleted requests screen must not keep request session selectors");
}
assertExcludes(sources.requestsScreen, 'join(" → ")', "member and guardian request flow avoids a long combined arrow line");
assertExcludes(sources.requestsScreen, "formatTimeRange(fromClass.startsAt, fromClass.endsAt)", "requests compact mobile time range");
assertExcludes(sources.requestsScreen, "formatTimeRange(targetClass.startsAt, targetClass.endsAt)", "requests compact mobile time range");
assertExcludes(sources.requestsScreen, "잔여 {remainingSeats}명", "requests mobile select avoids long remaining-seat copy");
assertExcludes(sources.requestsScreen, "잔여 {targetClassRemainingSeats}명", "requests mobile history avoids long remaining-seat copy");
for (const snippet of [
  "결석 요청은 보강 수업 없음",
  "승인 시 보강 출석으로 반영됩니다.",
  "알 수 없음",
]) {
  assertExcludes(sources.requestsScreen, snippet, "requests passive/system fallback copy");
}
assertExcludes(sources.requestsScreen, "보강 출석 반영", "deleted requests screen must not keep approved request action copy");
assertExcludes(sources.requestsScreen, "보강 출석으로 확인할 수 있습니다.", "requests approved deleted request verbose copy");
assertExcludes(sources.requestsScreen, "승인되면 보강 출석으로 확인할 수 있습니다.", "requests approved deleted request future-tense copy");
assertIncludes(sources.classesScreen, "저장 대기 없음", "coach save status compact copy");
assertIncludes(sources.classesScreen, 'idle: "정상"', "coach idle save status app-safe label");
assertExcludes(sources.classesScreen, 'idle: "대기"', "coach idle save status ambiguous label");
assertExcludes(sources.classesScreen, "저장 대기 없이 바로 출석을 처리할 수 있습니다.", "coach save status verbose copy");
assertExcludes(sources.classesScreen, 'line-clamp-1 text-xs text-zinc-500">{attendanceSync.message}', "coach save status default message clutter");
for (const snippet of [
  "attendanceHistoryOpen",
  "attendanceHistoryNeedsAttention",
  "attendanceHistoryDetailsOpen",
  'data-testid="attendance-history-panel"',
  'data-attendance-history-state={attendanceHistoryDetailsOpen ? "open" : "closed"}',
  'data-testid="attendance-history-toggle"',
  'data-testid="attendance-history-detail-list"',
]) {
  assertIncludes(sources.classesScreen, snippet, "coach attendance history default collapse");
}
for (const snippet of [
	  "coachMobileSpeedSummaryText = [",
	  "`사유 필요 ${coachReasonRequiredRecords.length}명`",
  "`주의 ${coachAttentionMemberCount}명`",
  "`저장 ${attendanceSync.pendingCount}건 대기`",
  "저장 대기 ${attendanceSync.pendingCount}건",
  "저장 정상",
]) {
  assertIncludes(sources.classesScreen, snippet, "coach class flow compact copy");
}
for (const snippet of [
  "결석/지각/사유/보강 상태의 빈 메모 없음",
  "주의사항 ${coachAttentionMembers.length}명 · 수업 참고 상담",
  "오프라인 대기 ${attendanceSync.pendingCount}건 저장",
  "오늘 담당 수업이 없으면 지점 공지를 확인합니다.",
  "수업 전 확인할 주의/상담 회원이 없습니다.",
  "명단, 출석, 상담/주의 기록을 수업 전에 확인합니다.",
  "수업 후 미처리 ${totalUnchecked}명을 마감합니다.",
  "수업 후 출석 마감이 완료됐습니다.",
  "결석/지각/사유/보강 메모 ${coachReasonRequiredRecords.length}건을 보강합니다.",
  "사유가 필요한 빈 메모가 없습니다.",
  "오프라인 대기 ${attendanceSync.pendingCount}건을 동기화합니다.",
  "오프라인 대기 출석이 없습니다.",
]) {
  assertExcludes(sources.classesScreen, snippet, "coach class flow verbose copy");
}
assertExcludes(sources.accountScreen, "비밀번호를 잊었을 때는 로그인 화면에서 재설정을 요청할 수 있습니다.", "account status verbose reset guidance");

for (const snippet of [
  'label: "보강 요청"',
  'description: "결석과 보강 요청"',
]) {
  assertExcludes(sources.roles, snippet, "deleted request route label must stay removed");
}

for (const snippet of [
  "const showPaymentOperationsMeta = canManagePayments;",
  'const staffOnlyPaymentFilterValues: Array<PaymentStatus | "all" | "risk"> = ["partially_refunded", "refunded", "cancelled"];',
  'const familyPaymentFilterValues: Array<PaymentStatus | "all" | "risk"> = ["all", "risk", "paid"];',
  'function isStaffOnlyPaymentFilter(value: PaymentStatus | "all" | "risk")',
  'function isFamilyPaymentFilter(value: PaymentStatus | "all" | "risk")',
  'const effectivePaymentFilter = !showPaymentOperationsMeta && !isFamilyPaymentFilter(paymentFilter) ? "all" : paymentFilter;',
  "const visiblePaymentFilterOptions = showPaymentOperationsMeta",
  ": paymentFilterOptions.filter((option) => isFamilyPaymentFilter(option.value));",
  "const familyPaymentFilterCounts",
  "showPaymentOperationsMeta ? (",
  "latestStatusChange ? (",
  'data-testid={canManagePayments ? undefined : "member-guardian-payment-status-list"}',
  'data-testid={canManagePayments ? undefined : "member-payment-compact-card"}',
  'data-testid="member-payment-date-line"',
  '온라인 결제{showPaymentOperationsMeta ? ` · ${formatCurrency(onlinePayment.amount)}` : ""}',
  "const familyOnlinePaymentStatusLabels",
  "const familyRecurringAgreementStatusLabels",
  "const staffOnlinePaymentDetails",
  "const staffRecurringAgreementDetails",
  "familyOnlinePaymentStatusLabels[onlinePayment.status]",
  "familyRecurringAgreementStatusLabels[recurringAgreement.status]",
  "{staffOnlinePaymentDetails}",
  "{staffRecurringAgreementDetails}",
  "납부 확인 중",
  "자동 납부 확인 중",
  '{showPaymentOperationsMeta ? (',
  'const paymentFilterLabel = showPaymentOperationsMeta ? "상태 필터" : "결제 보기";',
  "const paymentListStatusLabel = showPaymentOperationsMeta",
  ": `결제 ${filteredPayments.length}건`",
  "const familyPaymentFilterLabels",
  "scopedPayments.length === 0",
  "${selectedGuardianPaymentChild.name} 결제 내역이 없습니다",
  "선택한 보기의 결제가 없습니다",
  "value={effectivePaymentFilter}",
  'data-testid="member-payment-filter-chips"',
  'className="rounded-md border border-zinc-200 bg-white p-0.5"',
  "grid grid-cols-3 gap-0.5",
  "inline-flex min-h-11 min-w-0 items-center justify-center",
  "rounded-full px-1.5 text-[10px]",
  'role="group"',
  'aria-label={`${paymentFilterLabel} · ${paymentListStatusLabel}`}',
  "{visiblePaymentFilterOptions.map((option) => {",
  "const selected = effectivePaymentFilter === option.value;",
  "const familyLabel = familyPaymentFilterLabels[option.value] ?? option.label;",
  "const familyCount = familyPaymentFilterCounts[option.value] ?? 0;",
  'aria-label={`${familyLabel} ${familyCount}건`}',
  'data-testid="member-payment-filter-chip"',
  'data-testid="member-payment-filter-chip-count"',
  "onClick={() => setPaymentFilter(option.value)}",
  'className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"',
  'className="flex min-h-11 items-center break-words rounded-md bg-zinc-50 px-2 py-1 text-[11px] font-medium leading-4 text-zinc-600"',
  "납부 {formatDate(payment.dueDate)} · 만료 {formatDate(payment.expiresAt)}",
  '{effectivePaymentFilter === "all" ? overdueCount : filteredOverdueCount}',
  'formatCurrency(effectivePaymentFilter === "all" ? totalDue : filteredDue)',
]) {
  assertIncludes(sources.paymentsScreen, snippet, "member and guardian payment operations meta guard");
}
assertExcludes(sources.paymentsScreen, 'showPaymentOperationsMeta ? "조회 건수" : "회원권"', "member and guardian payment summary card cleanup");
assertExcludes(sources.paymentsScreen, 'showPaymentOperationsMeta ? "확인 필요 금액" : "납부 예정/만료"', "member and guardian payment amount summary cleanup");
assertExcludes(
  sources.paymentsScreen,
  'onlinePayment && onlinePayment.status !== "paid" ? onlinePaymentStatusLabels[onlinePayment.status]',
  "member and guardian payment status notes avoid operator online labels",
);
assertExcludes(sources.paymentsScreen, '<p className="text-sm font-semibold text-zinc-950">{paymentFilterLabel}</p>', "member and guardian visible payment filter heading");
assertExcludes(sources.paymentsScreen, "다른 상태를 선택해 주세요.", "member and guardian payment filter empty-state operational copy");
assertExcludes(sources.paymentsScreen, 'paymentFilter === "all" ?', "member and guardian hidden payment filter state fallback");
assertExcludes(sources.paymentsScreen, 'data-testid="member-payment-filter-status"', "member and guardian payment filter must not restore a separate count badge");

for (const snippet of [
  "const ageGroupLabels = Object.fromEntries",
  "{ageGroupLabels[member.ageGroup]}",
  'ageGroup: Member["ageGroup"];',
  "ageGroup: draft.ageGroup",
  "name: memberName",
  "const [inviteFormOpen, setInviteFormOpen] = useState(false);",
  "const [memberCreateFormOpen, setMemberCreateFormOpen] = useState(false);",
  'data-testid="member-invite-panel"',
  'data-testid="member-invite-toggle"',
  'id="member-invite-form"',
  "inviteFormOpen ? (",
  'data-testid="member-create-panel"',
  'data-testid="member-create-toggle"',
  'id="member-create-form"',
  "memberCreateFormOpen ? (",
  'data-testid={`member-profile-name-input-${member.id}`}',
  'data-testid={`member-profile-summary-${member.id}`}',
  'data-testid={`member-age-group-select-${member.id}`}',
  'data-testid={`member-profile-submit-${member.id}`}',
  'data-testid={`member-profile-feedback-${member.id}`}',
  'data-testid={`member-minor-guardian-warning-${member.id}`}',
  "sourceMemberSignature: getProfileMemberSignature(member)",
  "profileDraftTouchesEditableField",
  "if (!draft.dirty && draft.sourceMemberSignature !== sourceMemberSignature)",
  "const syncedCurrentDraft",
  'getProfileDraft(member).ageGroup !== "adult" && member.guardianIds.length === 0',
  "유소년/청소년 회원은 학부모 연결 후 결제 안내가 가능합니다.",
  "value={getProfileDraft(member).ageGroup}",
  'data-testid="member-search-input"',
  "matchesMemberSearch(keyword, [member.name, member.level, member.belt, member.emergencyContact])",
  "변경할 다른 학부모 계정이 없습니다.",
  "연결 가능한 학부모 계정이 없습니다.",
  'data-testid={`member-emergency-contact-input-${member.id}`}',
  'placeholder="연락 가능한 번호"',
]) {
  assertIncludes(sources.membersScreen, snippet, "member age group production label guard");
}
assertExcludes(
  sources.membersScreen,
  "추가로 연결할 학부모 계정이 없습니다.",
  "member guardian link empty copy must not imply add-only behavior",
);
assert.equal(memberListSearchNormalizedReport.ok, true, "member list normalized search evidence must pass");
assert.equal(
  memberListSearchNormalizedReport.verified?.phoneSearchIgnoresHyphen,
  true,
  "member list search evidence must confirm phone search ignores hyphens",
);
assert.equal(
  memberListSearchNormalizedReport.verified?.initialConsonantSearchWorks,
  true,
  "member list search evidence must confirm Korean initial consonant search",
);
assert.equal(
  memberListSearchNormalizedReport.verified?.mobileScreenshotEvidence,
  true,
  "member list search evidence must include mobile screenshot proof",
);
assert.equal(
  memberListSearchNormalizedReport.verified?.iosScreenshotEvidence,
  true,
  "member list search evidence must include iOS Simulator screenshot proof",
);
assert.equal(memberGuardianReentrySyncReport.ok, true, "member guardian reentry sync evidence must pass");
assert.equal(
  memberGuardianReentrySyncReport.verified?.guardianChangeReentryPersists,
  true,
  "member guardian reentry evidence must confirm owner view persists changed guardian after reload",
);
assert.equal(
  memberGuardianReentrySyncReport.verified?.newGuardianRoleSeesChild,
  true,
  "member guardian reentry evidence must confirm new guardian sees linked child",
);
assert.equal(
  memberGuardianReentrySyncReport.verified?.oldGuardianChildLinkRemoved,
  true,
  "member guardian reentry evidence must confirm old guardian no longer sees unlinked child",
);
assert.equal(
  memberGuardianReentrySyncReport.verified?.runtimeBidirectionalLinks,
  true,
  "member guardian reentry evidence must confirm bidirectional member/user links",
);
assert.equal(
  memberGuardianReentrySyncReport.verified?.mobileScreenshotEvidence,
  true,
  "member guardian reentry evidence must include mobile screenshot proof",
);
assert.equal(
  memberGuardianReentrySyncReport.verified?.noAvailableGuardianCopyClear,
  true,
  "member guardian reentry evidence must confirm no-available-guardian copy is clear",
);
assert.equal(
  memberGuardianReentrySyncReport.verified?.iosScreenshotEvidence,
  true,
  "member guardian reentry evidence must include iOS Simulator screenshot proof",
);
for (const snippet of [
  'Pick<Member, "ageGroup" | "alerts" | "belt" | "emergencyContact" | "level" | "name" | "status">',
  "unlinkGuardian(memberId: string, payload: GuardianLinkPayload",
  "replaceGuardian(memberId: string, payload: GuardianLinkPayload",
]) {
  assertIncludes(sources.apiClient, snippet, "member age group profile update API client guard");
}
for (const snippet of [
  'const ageGroups: Member["ageGroup"][] = ["kids", "teen", "adult"];',
  "body.ageGroup !== undefined",
  "body.name !== undefined",
  "patch.name = name",
  "patch.ageGroup = body.ageGroup",
  "getLinkedMemberAccountUsers",
  "samePhoneNumber",
  "syncedUserIds",
]) {
  assertIncludes(sources.memberUpdateRoute, snippet, "member age group profile update route guard");
}
for (const snippet of [
  'ageGroup: "teen"',
  "owner member name update did not persist",
  "owner member age group update did not persist",
  "owner member profile update did not sync linked user name",
  "owner member profile update did not sync linked user phone",
  "member emergency contact update did not sync linked user phone",
  "guardian must not update linked member age group",
]) {
  assertIncludes(sources.smokeApi, snippet, "member age group profile update smoke guard");
}
for (const snippet of [
  "unlinkGuardian",
  "replaceGuardian",
  "matchesMemberSearch(draft.guardianSearch",
  "normalizeMemberSearchText(draft.guardianSearch)",
  'guardianSearch: ""',
  "flex min-h-11 min-w-0 items-center justify-between",
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-md border border-red-200",
  'data-testid={`member-guardian-unlink-${member.id}-${guardianId}`}',
  'data-testid={`member-guardian-current-${member.id}-${guardianId}`}',
  'data-testid={`member-guardian-search-input-${member.id}`}',
  'data-testid={`member-guardian-search-results-${member.id}`}',
  'data-testid={`member-guardian-search-result-${member.id}`}',
  'data-testid={`member-guardian-selected-${member.id}`}',
  'data-testid={`member-guardian-feedback-${member.id}`}',
  'data-testid={`member-guardian-submit-${member.id}`}',
  "formatPhoneNumber(guardian.phone)",
  "보호자 연결을 해제했습니다.",
  "보호자 연결을 변경했습니다.",
  "학부모를 검색해서 선택해 주세요.",
  "학부모 이름이나 연락처를 검색한 뒤 선택해 주세요.",
  "변경할 학부모 검색",
  '{member.guardianIds.length > 0 ? "변경" : "연결"}',
]) {
  assertIncludes(sources.membersScreen, snippet, "member guardian unlink screen guard");
}
assertExcludes(
  sources.membersScreen,
  'data-testid={`member-guardian-select-${member.id}`}',
  "member guardian selection must not regress to dropdown-only selection",
);
assertExcludes(sources.membersScreen, "변경할 학부모 계정", "member guardian selection must use searchable copy");
for (const snippet of [
  "export async function PUT",
  "export async function DELETE",
  "replaceMemberGuardians",
  "replaceGuardianUserLinks",
  "unlinkMemberGuardian",
  "unlinkGuardianUser",
  "보호자-자녀 연결을 변경했습니다.",
  "보호자-자녀 연결을 해제했습니다.",
]) {
  assertIncludes(sources.memberGuardianRoute, snippet, "member guardian unlink route guard");
}
for (const snippet of [
  "guardian replace must atomically replace member guardian ids",
  "guardian replace must remove previous guardian child ids",
  "guardian replace back must remove temporary guardian child ids",
  "guardian unlink did not update member guardian ids",
  "guardian relink after unlink did not update member guardian ids",
]) {
  assertIncludes(sources.smokeApi, snippet, "member guardian unlink smoke guard");
}
for (const snippet of [
  "syncMemberAccountProfileLinks",
  "emergencyContact: nextPhone",
  "name: nextName",
  "syncedMemberIds",
]) {
  assertIncludes(sources.adminUserRoute, snippet, "admin user linked member profile sync route guard");
}
for (const snippet of [
  "unlinkGuardian: (memberId: string, payload: GuardianLinkPayload) => Promise<boolean>",
  "replaceGuardian: (memberId: string, payload: GuardianLinkPayload) => Promise<boolean>",
  "apiClient.unlinkGuardian",
  "apiClient.replaceGuardian",
]) {
  assertIncludes(sources.appStore, snippet, "member guardian unlink store guard");
}
assertExcludes(sources.membersScreen, "010-0000-0000", "member contact placeholder dummy data cleanup");

for (const snippet of ["OperationalKpiCard", "min-h-11", "break-words", "rounded-lg border p-3", "min-h-5 break-words text-xs leading-4"]) {
  assertIncludes(sources.uiPrimitives, snippet, "shared operational KPI card");
}
assertExcludes(sources.uiPrimitives, "rounded-lg border p-4 shadow-sm", "shared operational KPI card avoids oversized mobile padding");
assertExcludes(sources.uiPrimitives, "min-h-8 break-words text-xs leading-5", "shared operational KPI helper avoids oversized reserved height");
assertIncludes(sources.uiPrimitives, "export function SectionHeader({ title, action }", "shared page header compact mode");
assertExcludes(sources.uiPrimitives, ">{description}</p>", "shared page header compact mode");
for (const snippet of [
  "min-h-40",
  "sm:min-h-[220px]",
  "p-4 text-center sm:min-h-[220px] sm:p-6",
  "h-7 w-7",
  "sm:h-8 sm:w-8",
]) {
  assertIncludes(sources.stateBlocks, snippet, "mobile compact state blocks");
}

assertIncludes(sources.format, "export function formatDateKey", "shared local date key helper");
assertIncludes(sources.format, 'timeZone: "Asia/Seoul"', "shared local date key helper");
assertIncludes(sources.format, "dateKeyFormatter.formatToParts(date)", "shared local date key helper");
assertIncludes(sources.format, "export function addDaysToDateKey", "shared local date key helper");
assertIncludes(sources.format, "Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0)", "shared local date key helper");
assertIncludes(sources.mockApi, "const mockApiDateKeyFormatter = new Intl.DateTimeFormat", "dashboard today local timezone key");
assertIncludes(sources.mockApi, "mockApiDateKeyFormatter.formatToParts(date)", "dashboard today local timezone key");
assertExcludes(sources.mockApi, "return date.toISOString().slice(0, 10);", "dashboard today UTC date key");
assertIncludes(sources.adminAuditLogsScreen, "return formatDateKey(value);", "admin audit date filter local timezone key");
assertIncludes(sources.paymentsScreen, "return formatDateKey(date);", "payment date input local timezone key");
assertIncludes(sources.adminSettings, "return formatDateKey(new Date());", "admin settings operation date local timezone key");
assertIncludes(sources.adminSettings, "return addDaysToDateKey(dateInput, days);", "admin settings operation date local timezone key");

for (const snippet of [
  "학습 성장 보기",
  "띠별 수련 수준, 코치 피드백, 심사와 대회 소식을 모았습니다.",
  "오늘 처리해야 할 수업, 출석, 결제, 보강 요청을 역할 범위 안에서 요약합니다.",
  "출석 처리와 정원 상태를 빠르게 확인합니다.",
  "승인 대기 건을 확인합니다.",
  "미납 또는 만료 예정 회원권입니다.",
  "이번 주 액션부터 공지 도달까지 같은 축에서 보고",
  "지점별 회원, 수업, 출석 처리, 미해결 운영 항목을 비교합니다.",
  "파일럿 운영 전 즉시 확인할 항목입니다.",
  "현재 대시보드에 반영된 조회 범위입니다.",
]) {
  assertExcludes(sources.dashboardScreen, snippet, "dashboard compact intro copy");
}

for (const [label, source] of [
  ["dashboard empty-state copy", sources.dashboardScreen],
  ["classes empty-state copy", sources.classesScreen],
  ["members empty-state copy", sources.membersScreen],
  ["notices empty-state copy", sources.noticesScreen],
  ["payments empty-state copy", sources.paymentsScreen],
  ["requests empty-state copy", sources.requestsScreen],
  ["owner branches empty-state copy", sources.ownerBranchesScreen],
]) {
  for (const snippet of [
    "오늘 진행할 수업이 생기면 이곳에서 명단과 출석 상태를 확인할 수 있습니다.",
    "예정된 수업이 생기면 이곳에서 시간과 출석 상태를 확인할 수 있습니다.",
    "등록된 회원이나 연결된 자녀가 생기면 이곳에 표시됩니다.",
    "새 공지가 올라오면 이곳에서 바로 확인할 수 있습니다.",
    "회원권이나 납부 내역이 생기면 이곳에 표시됩니다.",
    "관리자가 대표 계정에 지점을 연결하면 운영 데이터를 볼 수 있습니다.",
    "지점에 자녀 연결을 요청하면 자녀 수업과 출석을 확인할 수 있습니다.",
    "지점에 계정 연결을 요청하면 수업과 출석을 확인할 수 있습니다.",
    "자녀 연결 후 확인 가능합니다.",
    "회원 연결 후 확인 가능합니다.",
    "연결된 회원/자녀가 없습니다.",
    "아직 요청 내역이 없습니다.",
    "대기 중인 요청이 없습니다.",
    "필요할 때 위에서 요청을 남기면 이곳에 표시됩니다.",
    "대기 요청이 생기면 이곳에 표시됩니다.",
  ]) {
    assertExcludes(source, snippet, label);
  }
}

assertIncludes(memberDashboardSource, "<FamilyMobilePriorityPanel", "member compact dashboard");
for (const retiredFamilyHeading of ["회원 홈", "학부모 홈", "오늘 요약"]) {
  assertExcludes(memberDashboardSource, retiredFamilyHeading, "member compact dashboard retired headings");
  assertExcludes(guardianDashboardSource, retiredFamilyHeading, "guardian learning dashboard retired headings");
}
assertIncludes(sources.dashboardScreen, 'title="대시보드"', "generic role dashboard compact heading");
assertExcludes(sources.dashboardScreen, 'title={`${roleLabels[context.user.role]} 홈`}', "generic role dashboard role-name home heading");
for (const duplicatedMemberSectionSnippet of [
  "SectionHeader",
  'aria-label="운영 지표"',
  '<h2 className="text-base font-semibold text-zinc-950">오늘 수업</h2>',
  '<h2 className="text-base font-semibold text-zinc-950">보강 요청</h2>',
  '<h2 className="text-base font-semibold text-zinc-950">결제 확인</h2>',
]) {
  assertExcludes(memberDashboardSource, duplicatedMemberSectionSnippet, "member compact dashboard duplicate sections");
}

for (const snippet of [
  'data-testid="member-guardian-priority-grid"',
  'data-testid="member-guardian-priority-cell"',
  "divide-y divide-zinc-100",
  "function compactText(value: string, maxLength = 56)",
  'title: latestChildFeedback ? "코치 피드백 도착" : "다음 피드백 예정"',
  "formatDate(latestChildFeedback.createdAt)",
  "compactText(promotionResultNotice.body, 32)",
  "compactText(tournamentNotice.body, 32)",
  'aria-label={`${childName} ${insight.eyebrow} ${insight.actionLabel}: ${insight.title}, ${insight.detail}`}',
  "${formatDate(personalPrimaryPayment.expiresAt)} 만료",
]) {
  assertIncludes(sources.dashboardScreen, snippet, "member/guardian mobile dashboard readable copy guard");
}

for (const snippet of [
  "const apiRequestTimeoutMs = 12_000",
  "new AbortController()",
  "signal: timeout.signal",
  "timeout.clear()",
]) {
  assertIncludes(sources.apiClient, snippet, "API request timeout stability guard");
}

assertIncludes(sources.pushHelper, "알림함에는 표시됩니다. 휴대폰 푸시는 기기 알림 연결 후 발송할 수 있습니다.", "notification app-safe setup copy");
assertIncludes(sources.pushHelper, "FINAL_JUDO_VAPID_SUBJECT", "notification app-safe setup copy");
assertIncludes(sources.pushHelper, "알림 수신 등록을 다시 확인해야 합니다.", "notification app-safe disabled subscription failure copy");
assertIncludes(sources.pushHelper, "알림 발송 상태를 다시 확인해야 합니다.", "notification app-safe dispatch failure copy");
assertExcludes(sources.noticePushRoute, "알림 발송 설정", "notification unclear setup copy");
assertExcludes(sources.noticePushRoute, "공지 알림을 보류", "notification unclear blocked copy");
assertExcludes(sources.noticePushRoute, "VAPID 키가 없어", "notification app-safe setup copy");
assertExcludes(sources.noticePushRoute, "VAPID 공개키/비밀키", "notification app-safe setup copy");
assertExcludes(sources.pushHelper, "ops@finaljudo.test", "notification app-safe setup copy");
assertExcludes(sources.pushHelper, "push dispatch failed", "notification raw dispatch failure copy");
assertExcludes(sources.pushHelper, "error.message", "notification raw provider failure copy");
assertExcludes(sources.noticePushRoute, "ops@finaljudo.test", "notification app-safe setup copy");
assertExcludes(sources.notificationSubscriptionsRoute, "ops@finaljudo.test", "notification app-safe setup copy");

for (const snippet of [
  'id: "note-jun-progress"',
  'memberId: "member-jun"',
  'visibility: "guardian_visible"',
  'id: "notice-promotion-result-jun"',
  'id: "notice-youth-tournament"',
]) {
  assertIncludes(sources.mockData, snippet, "guardian learning code seed data");
}

for (const [label, source] of [
  ["guardian learning code seed data", sources.mockData],
  ["guardian learning runtime data", sources.runtimeDb],
]) {
  for (const snippet of [
    "낙법 후 일어서는 속도가 좋아졌고",
    "승급 심사 결과 안내",
    "보완 항목은 코치가 다음 피드백으로 안내합니다.",
    "강남 유소년 교류전 대회 참가 안내",
    "보호자 확인 후 체급과 출전 가능 시간",
    "승급 심사 준비 안내",
    "심사 대상자는 출석률과 기본기 체크 항목을 담당 코치와 확인해 주세요.",
  ]) {
    assertIncludes(source, snippet, label);
  }

  for (const snippet of [
    "6월 승급 심사 결과 안내",
    "이번 달 승급 심사 결과 안내",
    "7월 둘째 주 승급 심사",
    "여름 승급 심사 예비 일정",
    "다음 승급 심사 예비 일정",
    "다음 달 둘째 주 승급 심사 대상자는 이번 주 출석률을 확인해 주세요.",
    "6월 말 복귀 예정",
    "다음 달 회원권 상담",
    "보완 항목은 코치 피드백에 반영됩니다.",
  ]) {
    assertExcludes(source, snippet, `${label} stale fixed-month copy`);
  }

  for (const snippet of ["송보호", "대표/학부모 화면"]) {
    assertExcludes(source, snippet, `${label} public-facing dummy copy`);
  }
}

for (const snippet of [
  "승급 심사 준비 안내",
  "심사 대상자는 출석률과 기본기 체크 항목을 담당 코치와 확인해 주세요.",
]) {
  assertIncludes(sources.demoDateRoll, snippet, "guardian learning runtime date-roll notice copy");
}

for (const snippet of [
  "다음 승급 심사 예비 일정",
  "다음 달 둘째 주 승급 심사 대상자는 이번 주 출석률을 확인해 주세요.",
]) {
  assertExcludes(sources.demoDateRoll, snippet, "guardian learning runtime date-roll stale notice copy");
}

assertIncludes(sources.mockData, 'alerts: ["복귀 일정 조율 중"]', "mock member paused alert copy");
assertIncludes(sources.runtimeDb, '"복귀 일정 조율 중"', "runtime member paused alert copy");
assertIncludes(sources.mockData, "손목 상태 확인 후 재등록 상담 필요.", "mock staff counseling note copy");
assertIncludes(sources.runtimeDb, "손목 상태 확인 후 재등록 상담 필요.", "runtime staff counseling note copy");

for (const snippet of ["송보호", "한보호", "대표/학부모 화면", "6월 말 복귀 예정", "학부모에게 공유했습니다", "다음 달 회원권 상담"]) {
  assertExcludes(sources.seedSql, snippet, "SQL seed public-facing dummy guardian name");
}
assertIncludes(sources.seedSql, "복귀 일정 조율 중", "SQL seed paused member alert copy");
assertIncludes(sources.seedSql, "승급 심사 준비 안내", "SQL seed evergreen promotion notice title");
assertIncludes(sources.seedSql, "심사 대상자는 출석률과 기본기 체크 항목을 담당 코치와 확인해 주세요.", "SQL seed evergreen promotion notice copy");
assertExcludes(sources.seedSql, "다음 승급 심사 예비 일정", "SQL seed relative promotion notice title");
assertExcludes(sources.seedSql, "다음 달 둘째 주 승급 심사 대상자는 이번 주 출석률을 확인해 주세요.", "SQL seed relative promotion notice copy");
assertIncludes(sources.seedSql, "앞구르기 진입 동작이 안정됨. 다음 수업에서 낙법 연결 연습 예정.", "SQL seed guardian counseling note copy");
assertIncludes(sources.seedSql, "손목 상태 확인 후 재등록 상담이 필요합니다.", "SQL seed staff counseling note copy");
assertIncludes(sources.seedSql, "CURRENT_DATE + TIME '10:00'", "SQL seed class sessions use relative current-day dates");
assertIncludes(sources.seedSql, "CURRENT_DATE + 20", "SQL seed payment due dates use relative dates");
assertIncludes(sources.seedSql, "CURRENT_DATE - 1 + TIME '12:00'", "SQL seed notices use relative dates");
assertIncludes(sources.pilotImport, 'emergencyContact: row.phone || "연락처 등록 전"', "pilot import missing phone app-safe fallback");
assertExcludes(sources.pilotImport, 'emergencyContact: row.phone || "미입력"', "pilot import missing phone dummy fallback");
for (const snippet of [
  "2026-06-13T10:00:00+09:00",
  "2026-06-13T10:08:00+09:00",
  "2026-07-18",
  "2026-07-03",
  "2026-06-12T12:00:00+09:00",
  "2026-06-12T18:10:00+09:00",
]) {
  assertExcludes(sources.seedSql, snippet, "SQL seed operational stale fixed date");
}
assertIncludes(sources.seedSql, "회원권 만료 안내", "SQL seed compact payment notice title");
assertIncludes(sources.seedSql, "만료 7일 전부터 결제 상태에서 확인하세요.", "SQL seed compact payment notice copy");
assertExcludes(sources.seedSql, "회원권 만료 알림 기준 변경", "SQL seed system payment notice title");
assertExcludes(sources.seedSql, "만료 7일 전부터 결제 상태 화면에서 확인할 수 있습니다.", "SQL seed verbose payment notice copy");
assertExcludes(sources.seedSql, "만료 7일 전부터 결제 상태 화면에 알림이 표시됩니다.", "SQL seed passive payment notice copy");
assertIncludes(sources.mockData, "회원권 만료 안내", "mock compact payment notice title");
assertIncludes(sources.mockData, "만료 7일 전부터 결제 상태에서 확인하세요.", "mock compact payment notice copy");
assertExcludes(sources.mockData, "회원권 만료 알림 기준 변경", "mock system payment notice title");
assertExcludes(sources.mockData, "만료 7일 전부터 결제 상태 화면에서 확인할 수 있습니다.", "mock verbose payment notice copy");
assertExcludes(sources.mockData, "만료 7일 전부터 결제 상태 화면에 알림이 표시됩니다.", "mock passive payment notice copy");
assertIncludes(sources.runtimeDb, "회원권 만료 안내", "runtime compact payment notice title");
assertIncludes(sources.runtimeDb, "만료 7일 전부터 결제 상태에서 확인하세요.", "runtime compact payment notice copy");
assertExcludes(sources.runtimeDb, "회원권 만료 알림 기준 변경", "runtime system payment notice title");
assertExcludes(sources.runtimeDb, "만료 7일 전부터 결제 상태 화면에서 확인할 수 있습니다.", "runtime verbose payment notice copy");
assertExcludes(sources.runtimeDb, "만료 7일 전부터 결제 상태 화면에 알림이 표시됩니다.", "runtime passive payment notice copy");

for (const snippet of [
  "다음 심사 준비",
  "기본기 점검 중",
  "대회 일정 준비",
  "출전 일정 확인 중",
  "예정된 수업 없음",
  "결제 정보 없음",
  '<EmptyState title="연결된 자녀가 없습니다" />',
  '<EmptyState title="연결된 회원 정보가 없습니다" />',
  '<EmptyState title="오늘 배정된 수업이 없습니다" />',
]) {
  assertIncludes(sources.dashboardScreen, snippet, "dashboard compact state copy");
}
for (const snippet of [
  "심사 결과 대기",
  "결과 등록 전",
  "참가 일정 대기",
  "예정 없음",
  "심사 결과가 등록되면 이곳에서 확인할 수 있습니다.",
  "심사 결과가 등록되면 여기 표시됩니다.",
  "참가 가능한 대회 일정이 등록되면 준비 항목과 함께 확인할 수 있습니다.",
  "참가 가능한 대회 일정이 등록되면 준비 항목과 함께 표시됩니다.",
  "자녀를 연결하면 학습 리포트를 확인할 수 있습니다.",
  "자녀 연결 후 학습 리포트가 표시됩니다.",
  "회원 연결 후 수업과 출석 상태를 확인할 수 있습니다.",
  "회원 연결 후 수업과 출석 상태가 표시됩니다.",
  "오늘 수업이 등록되면 명단을 확인할 수 있습니다.",
  "오늘 수업이 등록되면 명단이 표시됩니다.",
  "수업 등록 대기 중입니다.",
]) {
  assertExcludes(sources.dashboardScreen, snippet, "dashboard verbose empty-state copy");
}
assertIncludes(sources.classesScreen, '<EmptyState title="예정 수업이 없습니다" />', "classes title-only empty-state copy");
assertExcludes(sources.classesScreen, "예정 수업 등록 대기 중입니다.", "classes repetitive waiting empty-state copy");
assertExcludes(sources.classesScreen, "수업이 등록되면 이곳에서 확인할 수 있습니다.", "classes verbose empty-state copy");
assertExcludes(sources.classesScreen, "예정 수업이 등록되면 표시됩니다.", "classes empty-state passive copy");
assertIncludes(
  sources.membersScreen,
  '? "검색어를 지우거나 다시 찾아보세요."',
  "members search-only empty-state description",
);
// 상태 필터가 추가되어 빈 상태 설명이 상태 필터 안내도 함께 제공한다.
assertIncludes(
  sources.membersScreen,
  '? "상태 필터를 전체로 바꾸면 모든 회원이 표시됩니다."',
  "members status-filter empty-state description",
);
assertExcludes(sources.membersScreen, "연결된 회원/자녀가 없습니다.", "members repetitive empty-state copy");
assertExcludes(sources.membersScreen, "회원 또는 자녀를 연결하면 이곳에서 확인할 수 있습니다.", "members verbose empty-state copy");
assertExcludes(sources.membersScreen, "회원 또는 자녀 연결 후 표시됩니다.", "members empty-state passive copy");

for (const snippet of [
  "function rollSeededDemoDates",
  "function shouldRollSeededDemoDates",
  'process.env.NODE_ENV === "production"',
  'process.env.FINAL_JUDO_ROLL_DEMO_DATES === "0"',
  "seededDemoUserIds.every",
  '"class-kids-am"',
  '"class-adult-night"',
  '"pay-minjae"',
]) {
  assertIncludes(sources.demoDateRoll, snippet, "stale seeded runtime date rolling guard");
}

assertAppearsBefore(
  sources.mockData,
  'id: "notice-promotion-result-jun"',
  'id: "notice-summer"',
  "guardian dashboard promotion notice priority",
);

for (const snippet of ["admin-operational-kpi-", "오늘 수업", "출석 처리율", "운영 이슈", "대기 초대", "초대 승인", "사용자 보기"]) {
  assertIncludes(sources.dashboardScreen, snippet, "admin operational KPI dashboard");
}
for (const snippet of ["ariaLabel?: string", "const summaryLabel = ariaLabel ??", "aria-label={summaryLabel}"]) {
  assertIncludes(sources.uiPrimitives, snippet, "operational KPI accessible summary labels");
}
assertIncludes(sources.dashboardScreen, 'ariaLabel={`${card.label}. ${card.value}. ${card.helper}.`}', "admin KPI accessible summary label");
for (const snippet of ['label: "권한/감사"', 'actionLabel: "감사 로그"', "최근 감사"]) {
  assertExcludes(sources.dashboardScreen, snippet, "admin dashboard app-facing audit summary copy");
}
for (const snippet of ['label: "계정/기록"', 'actionLabel: "최근 기록"', "최근 변경 ${dashboardScopedAuditLogs.length}건"]) {
  assertExcludes(sources.dashboardScreen, snippet, "admin dashboard first-screen internal record KPI");
}

for (const snippet of [
  "owner-dashboard-graph-board",
  "owner-dashboard-graph-row-",
  "owner-report-graph-board",
  "owner-report-graph-row-",
  "지점 건강도",
  "회원 유지",
  "결제 회수",
  "이번 주 액션",
]) {
  assertIncludes(`${sources.dashboardScreen}\n${sources.ownerReportsScreen}`, snippet, "owner operational KPI and graph surfaces");
}

const adminKpiSource = sources.dashboardScreen.slice(
  sources.dashboardScreen.indexOf("const dashboardPrimaryIssue ="),
  sources.dashboardScreen.indexOf("  const personalMemberIds"),
);
assertAppearsBefore(adminKpiSource, 'label: "운영 이슈"', 'label: "오늘 수업"', "admin KPI mobile priority order");
assertAppearsBefore(adminKpiSource, 'label: "출석 처리율"', 'label: "활성 회원"', "admin KPI mobile priority order");
assertIncludes(adminKpiSource, "미처리 출석 닫기", "admin KPI action clarity");
assertIncludes(adminKpiSource, "먼저", "admin KPI priority copy");
for (const snippet of ["명 먼저 · 요청", "건 먼저 · 출석", "승인 대기 먼저 처리"]) {
  assertExcludes(adminKpiSource, snippet, "admin KPI helpers avoid repeated urgency copy");
}
assertIncludes(sources.dashboardScreen, 'const ownerActionLabel = period.id === "today" ? "오늘 액션"', "owner dashboard period-aware action label");
assertIncludes(sources.dashboardScreen, 'period.id === "7d" ? "7일 액션" : "30일 액션"', "owner dashboard period-aware action label");
assertIncludes(sources.dashboardScreen, 'const ownerActionButtonLabel = period.id === "today" ? "오늘 순서" : `${period.label} 순서`', "owner dashboard period-aware action CTA");
assertIncludes(sources.dashboardScreen, "const ownerNoActionLabel = `${period.label} 우선 액션 없음`", "owner dashboard period-aware no-action copy");
assertIncludes(sources.dashboardScreen, 'const ownerPrioritySignalLabel = period.id === "today" ? "오늘 우선 신호"', "owner dashboard period-aware priority signal");

for (const snippet of [
  "formatDateKey",
  "const todayDateKey = formatDateKey(new Date());",
  "const personalUpcomingClasses = [...personalClasses]",
  "formatDateKey(session.endsAt) >= todayDateKey",
  "const personalUpcomingTodayClasses = [...personalTodayClasses]",
  "personalUpcomingTodayClasses[0] ?? personalUpcomingClasses[0]",
  "출석 기록 ${personalAttendanceRecords.length}건",
]) {
  assertIncludes(sources.dashboardScreen, snippet, "member/guardian dashboard compact status stability");
}
assertExcludes(sources.dashboardScreen, "personalPendingRequests", "member/guardian dashboard must not keep deleted request pending state");

const ownerDashboardKpiSource = sources.dashboardScreen.slice(
  sources.dashboardScreen.indexOf("const ownerOperationalGraphRows = ["),
  sources.dashboardScreen.indexOf("    ] as const;", sources.dashboardScreen.indexOf("const ownerOperationalGraphRows = [")),
);
assert.equal(
  (ownerDashboardKpiSource.match(/\n\s+helper:/g) ?? []).length,
  (ownerDashboardKpiSource.match(/\n\s+id:/g) ?? []).length,
  "owner dashboard graph rows must keep one helper copy per row and avoid duplicate object keys",
);
assertAppearsBefore(ownerDashboardKpiSource, "label: ownerActionLabel", 'label: "지점 건강도"', "owner dashboard KPI priority order");
assertAppearsBefore(ownerDashboardKpiSource, 'label: "결제 회수"', 'label: "회원 유지"', "owner dashboard KPI priority order");
assertIncludes(ownerDashboardKpiSource, "ownerPriorityBranchLabel", "owner dashboard branch-first KPI helper");
assertIncludes(ownerDashboardKpiSource, "ownerActionButtonLabel", "owner dashboard action clarity");
assertExcludes(ownerDashboardKpiSource, "ownerPriorityBranchLabel} 먼저", "owner dashboard repeated branch-first helper");
assertExcludes(ownerDashboardKpiSource, "ownerPriorityBranchLabel} 먼저 · ${paymentRisks.length}", "owner dashboard payment row duplicate branch-first helper");
assertExcludes(ownerDashboardKpiSource, "ownerPriorityBranchLabel} 먼저 · ${period.label}", "owner dashboard attendance row duplicate branch-first helper");
assertIncludes(sources.dashboardScreen, "운영 그래프", "owner dashboard graph heading");
assertExcludes(sources.dashboardScreen, "운영 흐름 그래프", "owner dashboard graph document-style heading");
assertIncludes(sources.dashboardScreen, "style={{ width: `${row.progress}%` }}", "owner dashboard graph bar width");
assertIncludes(sources.dashboardScreen, "ownerPrimaryGraphRow", "owner dashboard graph primary summary");
assertIncludes(sources.dashboardScreen, "const ownerPrimaryGraphSummary", "owner dashboard primary graph duplicate helper guard");
assertIncludes(sources.dashboardScreen, "{ownerPrimaryGraphSummary}", "owner dashboard primary graph summary copy");
assertIncludes(sources.dashboardScreen, "const ownerBranchComparisonRows = branchRows.map", "owner dashboard branch comparison graph rows");
assertIncludes(
  sources.dashboardScreen,
  "const [showOwnerDashboardDetails, setShowOwnerDashboardDetails] = useState(false);",
  "owner dashboard detail collapse state",
);
assertIncludes(
  sources.dashboardScreen,
  "const ownerVisibleBranchComparisonRows = showOwnerDashboardDetails ? ownerBranchComparisonRows : ownerBranchComparisonRows.slice(0, 1);",
  "owner dashboard defaults branch comparison to a compact priority row",
);
assertIncludes(sources.dashboardScreen, 'data-testid="owner-dashboard-branch-comparison-graph"', "owner dashboard branch comparison graph test hook");
assertIncludes(sources.dashboardScreen, 'data-testid="owner-dashboard-branch-comparison-row"', "owner dashboard branch comparison row test hook");
assertIncludes(sources.dashboardScreen, 'data-testid="owner-dashboard-branch-metric-grid"', "owner dashboard branch compact metric grid test hook");
assertIncludes(sources.dashboardScreen, 'data-testid="owner-dashboard-detail-toggle"', "owner dashboard detail toggle test hook");
assertIncludes(sources.dashboardScreen, 'data-testid="owner-dashboard-risk-summary"', "owner dashboard compact risk summary test hook");
assertIncludes(
  sources.dashboardScreen,
  'className="order-1 overflow-hidden rounded-lg border border-zinc-200 bg-white"',
  "owner dashboard branch comparison appears before risk summary on mobile",
);
assertIncludes(
  sources.dashboardScreen,
  'className="order-2 grid gap-2 xl:gap-3"',
  "owner dashboard risk summary appears below branch comparison on mobile",
);
assertIncludes(sources.dashboardScreen, 'data-testid="owner-dashboard-branch-detail"', "owner dashboard branch detail stays behind toggle");
assertIncludes(sources.dashboardScreen, 'data-testid="owner-dashboard-payment-risk-detail"', "owner dashboard payment risk detail stays behind toggle");
assertIncludes(sources.dashboardScreen, "aria-expanded={showOwnerDashboardDetails}", "owner dashboard detail toggle expanded state");
assertIncludes(sources.dashboardScreen, 'className="min-w-0 px-3 py-1.5"', "owner dashboard branch comparison row compact spacing");
assertIncludes(sources.dashboardScreen, 'className="mt-0.5 truncate text-[11px] leading-4 text-zinc-500"', "owner dashboard branch comparison meta stays one line");
assertIncludes(sources.dashboardScreen, 'className="mt-1 grid grid-cols-3 gap-1"', "owner dashboard branch metric grid compact spacing");
assertIncludes(sources.dashboardScreen, "min-h-8 min-w-0 rounded-md bg-zinc-50 px-1.5 py-1", "owner dashboard branch metric cells keep a readable compact height");
for (const snippet of ["출석", "결제 위험", "style={{ width: `${row.attendancePercent}%` }}", "style={{ width: `${row.riskPercent}%` }}"]) {
  assertIncludes(sources.dashboardScreen, snippet, "owner dashboard branch comparison graph labels and bars");
}
assertExcludes(sources.dashboardScreen, "row.requestPercent", "owner dashboard branch comparison graph must not keep request bars");
assertIncludes(
  sources.dashboardScreen,
  '<p className="mt-1 hidden truncate text-[11px] leading-4 text-zinc-500 sm:block">{row.helper}</p>',
  "owner dashboard graph rows keep detailed helper copy",
);

const ownerReportKpiSource = sources.ownerReportsScreen.slice(
  sources.ownerReportsScreen.indexOf("const ownerReportKpiCards = ["),
  sources.ownerReportsScreen.indexOf("  ] as const;", sources.ownerReportsScreen.indexOf("const ownerReportKpiCards = [")),
);
assertAppearsBefore(ownerReportKpiSource, 'label: "이번 주 액션"', 'label: "지점 건강도"', "owner report KPI priority order");
assertAppearsBefore(ownerReportKpiSource, 'label: "결제 회수"', 'label: "회원 유지"', "owner report KPI priority order");
assertIncludes(ownerReportKpiSource, "ownerReportFocusBranchName", "owner report branch-first KPI helper");
assertIncludes(ownerReportKpiSource, "먼저", "owner report priority copy");
assertExcludes(ownerReportKpiSource, "branchName} 먼저", "owner report repeated action helper");
assertExcludes(ownerReportKpiSource, "ownerReportFocusBranchName} 먼저", "owner report repeated branch-first helper");
assertExcludes(ownerReportKpiSource, "ownerReportPaymentFocusBranchName", "owner report payment row duplicate branch-first helper");
assertIncludes(sources.ownerReportsScreen, "ownerReportGraphRows", "owner report graph rows");
assertIncludes(sources.ownerReportsScreen, "ownerReportPrimaryGraphRow", "owner report primary graph summary");
assertIncludes(sources.ownerReportsScreen, "const ownerReportSecondaryGraphRows = ownerReportGraphRows.slice(1);", "owner report avoids duplicate primary graph row");
assertIncludes(
  sources.ownerReportsScreen,
  "const [showAllOwnerSecondaryGraphs, setShowAllOwnerSecondaryGraphs] = useState(false);",
  "owner reports secondary graph collapsed state",
);
assertIncludes(
  sources.ownerReportsScreen,
  "const ownerReportVisibleSecondaryGraphRows = showAllOwnerSecondaryGraphs",
  "owner reports secondary graph limits default KPI tiles",
);
assertIncludes(
  sources.ownerReportsScreen,
  "const ownerReportHiddenSecondaryGraphCount = Math.max(ownerReportSecondaryGraphRows.length - 3, 0);",
  "owner reports secondary graph hidden count",
);
assertIncludes(
  sources.ownerReportsScreen,
  "const ownerReportHiddenSecondaryGraphLabel = ownerReportSecondaryGraphRows",
  "owner reports secondary graph hidden KPI label",
);
assertIncludes(sources.ownerReportsScreen, 'aria-label={showAllOwnerSecondaryGraphs ? "보조 운영 지표 접기"', "owner reports hidden KPI toggle accessible label");
assertExcludes(sources.ownerReportsScreen, '`${ownerReportHiddenSecondaryGraphCount}개 더`', "owner reports hidden KPI toggle avoids generic count copy");
assertIncludes(
  sources.ownerReportsScreen,
  "grid min-w-0 grid-cols-2 gap-1.5",
  "owner reports secondary graph uses readable two-column mobile KPI tiles",
);
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-secondary-graph-grid"', "owner reports secondary graph grid hook");
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-secondary-graph-tile"', "owner reports secondary graph tile hook");
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-secondary-graph-label"', "owner reports secondary graph label overflow hook");
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-secondary-graph-toggle"', "owner reports secondary graph compact more button");
assertIncludes(sources.ownerReportsScreen, "style={{ width: `${row.progress}%` }}", "owner report graph bar width");
assertIncludes(
  sources.ownerReportsScreen,
  "const [showAllOwnerTrendGraphRows, setShowAllOwnerTrendGraphRows] = useState(false);",
  "owner reports trend graph collapsed state",
);
assertIncludes(
  sources.ownerReportsScreen,
  "const [showAllOwnerPriorityBranches, setShowAllOwnerPriorityBranches] = useState(false);",
  "owner reports priority branch list collapsed state",
);
assertIncludes(
  sources.ownerReportsScreen,
  "const ownerReportVisibleTrendGraphRows = showAllOwnerTrendGraphRows ? ownerReportTrendGraphRows : ownerReportTrendGraphRows.slice(-2);",
  "owner reports trend graph limits mobile rows by default",
);
assertIncludes(
  sources.ownerReportsScreen,
  "const ownerReportHiddenTrendGraphCount = Math.max(ownerReportTrendGraphRows.length - 2, 0);",
  "owner reports trend graph expansion keeps compact two-row default",
);
assertIncludes(
  sources.ownerReportsScreen,
  "const ownerReportVisiblePriorityRows = showAllOwnerPriorityBranches ? priorityRows : priorityRows.slice(0, 1);",
  "owner reports priority branch list limits mobile rows by default",
);
assertIncludes(
  sources.ownerReportsScreen,
  "const ownerReportHiddenPriorityCount = Math.max(priorityRows.length - 1, 0);",
  "owner reports priority branch expansion keeps collapse control",
);
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-trend-graph-toggle"', "owner reports trend graph toggle hook");
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-priority-branch-row"', "owner reports priority branch row hook");
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-priority-branch-toggle"', "owner reports priority branch toggle hook");
assertIncludes(
  sources.ownerReportsScreen,
  "const [showOwnerRiskPaymentList, setShowOwnerRiskPaymentList] = useState(false);",
  "owner reports risk payment list collapsed state",
);
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-risk-payment-summary"', "owner reports risk payment summary hook");
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-risk-payment-toggle"', "owner reports risk payment toggle hook");
assertIncludes(sources.ownerReportsScreen, 'data-testid="owner-report-risk-payment-list"', "owner reports risk payment list hook");
assertIncludes(sources.ownerReportsScreen, "showOwnerRiskPaymentList ? (", "owner reports risk payment list stays collapsed by default");
for (const snippet of [
  "const ownerReportActiveTrendRows = trendRows.filter",
  "const ownerReportTrendGraphBaseRows =",
  "const ownerReportTrendGraphRows = ownerReportTrendGraphBaseRows.map",
  "const ownerReportTrendSummaryRows = [",
  "ownerReportTrendGraphRows.slice(-2)",
  "ownerReportTrendGraphRows.length - 2",
  'data-testid="owner-report-trend-summary-grid"',
  'data-testid="owner-report-trend-summary-row"',
  'data-testid="owner-report-trend-graph"',
  'data-testid="owner-report-trend-graph-row"',
  "style={{ width: `${row.percent}%` }}",
  "style={{ width: `${row.revenuePercent}%` }}",
  "style={{ width: `${row.activityPercent}%` }}",
  "style={{ width: `${row.riskPercent}%` }}",
  "운영량",
]) {
  assertIncludes(sources.ownerReportsScreen, snippet, "owner reports compact mobile trend graph");
}
const ownerReportMobileTrendFilterSource = sources.ownerReportsScreen.slice(
  sources.ownerReportsScreen.indexOf("const ownerReportActiveTrendRows = trendRows.filter"),
  sources.ownerReportsScreen.indexOf("const ownerReportTrendGraphBaseRows ="),
);
for (const snippet of ["row.newMembers > 0", "row.withdrawnMembers > 0", "row.memberChangeEvents > 0"]) {
  assertExcludes(ownerReportMobileTrendFilterSource, snippet, "owner reports mobile trend graph avoids low-signal member-only months");
}
assertIncludes(sources.ownerReportsScreen, "운영 내보내기", "owner reports service-facing operations export label");
assertIncludes(sources.ownerReportsScreen, "결제 내보내기", "owner reports service-facing payments export label");
assertIncludes(sources.ownerReportsScreen, "inline-flex min-h-11 items-center gap-2", "owner reports export actions keep 44px touch height");
assertIncludes(sources.ownerReportsScreen, "className={`min-h-11 rounded-md border px-3", "owner reports period filters keep 44px touch height");
assertExcludes(sources.ownerReportsScreen, ">운영 CSV", "owner reports file-format-first operations export label");
assertExcludes(sources.ownerReportsScreen, ">결제 CSV", "owner reports file-format-first payments export label");
assertExcludes(sources.ownerReportsScreen, "CSV 내보내기를 완료했습니다.", "owner reports file-format-first export status");
assertIncludes(sources.operationsExportRoute, "운영 리포트 내보내기 권한이 없습니다.", "operations export API service-facing authorization copy");
assertIncludes(sources.operationsExportRoute, "운영 리포트 내보내기를 완료했습니다.", "operations export API service-facing audit copy");
assertExcludes(sources.operationsExportRoute, "운영 리포트 CSV를 내보낼 권한이 없습니다.", "operations export API file-format-first authorization copy");
assertExcludes(sources.operationsExportRoute, "운영 리포트 CSV를 내보냈습니다.", "operations export API file-format-first audit copy");
assertIncludes(sources.paymentsScreen, "결제 내보내기", "payments screen service-facing export label");
assertExcludes(sources.paymentsScreen, ">CSV 내보내기", "payments screen file-format-first export label");
assertExcludes(sources.paymentsScreen, "CSV 내보내기를 완료했습니다.", "payments screen file-format-first export status");
for (const snippet of [
  "/app/payments/checkout?paymentId=",
  "<ChildSwitcher",
  "guardianPaymentChildren",
  "prioritizedGuardianPaymentChild",
  "selectedGuardianPaymentChildId",
  "scopedPayments",
  "data.filter((payment) => payment.memberId === selectedGuardianPaymentChildId)",
  'data-testid="member-payment-checkout-action"',
  'data-testid="member-payment-checkout-state-badge"',
  "inline-flex h-8 min-w-[104px]",
  'data-testid="member-payment-checkout-state-helper"',
  'data-testid="member-payment-plan-line"',
  "data-payment-checkout-state",
  "familyCheckoutStateHelper",
  "getFamilyPaymentCheckoutAccess",
  "학부모 계정에서 진행",
]) {
  assertIncludes(sources.paymentsScreen, snippet, "family payment cards route to checkout preparation");
}
assertExcludes(
  sources.paymentsScreen,
  'className="sr-only" data-testid="member-payment-checkout-state-helper"',
  "family payment guardian-required helper must stay visible on the payment card",
);
for (const snippet of [
  "familyPaymentAgeGroupLabels",
  "familyPaymentAgeGroupLabels[ageGroup]",
  "getFamilyPaymentPlanLine",
  "planNameAgePrefixes",
]) {
  assertIncludes(sources.paymentCheckoutAccess, snippet, "shared family payment display helper keeps age labels out of view code");
}
for (const [source, snippet, label] of [
  [sources.paymentsScreen, "getFamilyPaymentPlanLine", "payment list family plan display"],
  [sources.dashboardScreen, "personalPaymentPlanLine", "dashboard family plan display"],
  [sources.notificationsScreen, "paymentPlanLine", "notification family plan display"],
  [sources.paymentCheckoutScreen, "familyPaymentPlanLine", "checkout family plan display"],
]) {
  assertIncludes(source, snippet, label);
}
assertIncludes(
  sources.paymentsScreen,
  'role={familyCheckoutCanOpen ? "link" : undefined}',
  "family payment cards only expose link semantics when checkout can open",
);
assertIncludes(
  sources.paymentsScreen,
  "onClick={familyCheckoutCanOpen ? () => openFamilyPaymentCheckout(payment.id) : undefined}",
  "payable family payment cards open checkout preparation from the full card",
);
assertIncludes(
  sources.paymentsScreen,
  'tabIndex={familyCheckoutCanOpen ? 0 : undefined}',
  "payable family payment cards stay keyboard reachable",
);
assertIncludes(
  sources.paymentsScreen,
  "familyCheckoutCanOpen ? (",
  "family payment cards split payable CTA from passive checkout state",
);
for (const snippet of [
  'payment.status === "paid"',
  "function paymentClosedAccess",
  "function authorizedPaymentCheckoutAccess",
  'member.ageGroup !== "adult"',
  'user.role === "guardian"',
  "member.guardianIds.includes(user.id)",
  "유소년/청소년 회원 결제는 학부모 계정에서 진행합니다.",
]) {
  assertIncludes(sources.paymentCheckoutAccess, snippet, "family payment checkout access guard");
}
for (const snippet of [
  "const childMemberIds = new Set(user.childMemberIds ?? []);",
  "member.guardianIds.includes(user.id)",
  "childMemberIds.has(member.id)",
]) {
  assertIncludes(sources.mockApi, snippet, "guardian payment/member data scope requires bidirectional links");
}
for (const snippet of [
  "payment-checkout-ready",
  "payment-checkout-unavailable",
  "payment-checkout-guardian-required",
  "payment-checkout-forbidden",
  "payment-checkout-provider-status",
  "payment-wooriwonpay-modal",
  "payment-checkout-summary",
	  "payment-checkout-summary-grid",
	  "initialPaymentMethod",
	  "getInitialPaymentMethod",
	  "#payment-wooriwonpay-modal",
	  "#payment-account-method-panel",
	  'id="payment-account-method-panel"',
	  'checkoutAccess.state === "guardian_required"',
  'checkoutAccess.state === "forbidden"',
  "checkoutStateLabel",
	  "납부 안내",
	  "이름·휴대전화 필수",
	  "결제 대상",
	  "납부 방법 안내 상태",
	  "납부 정보 접수",
		  "납부 정보 확인",
		  "const [savePaymentInfo, setSavePaymentInfo] = useState(false);",
		  "선택한 납부 정보는 확인용으로 접수되며, 담당자가 확인 후 안내합니다.",
		  "선택한 납부 방식은 확인용으로 저장하고, 도장 안내 후 입금·인증 절차를 이어갑니다.",
		  "다음 납부에도 사용할 정보로 표시했습니다.",
	  "이번 납부 확인에만 사용합니다.",
  'data-testid="payment-confirm-feedback"',
  'id="payment-confirm-feedback"',
  'role="status"',
  'aria-live="polite"',
  'data-testid="payment-card-guide-button"',
  "familyPaymentAgeGroupLabels[member.ageGroup]",
  "getPaymentCheckoutAmount",
]) {
  assertIncludes(sources.paymentCheckoutScreen, snippet, "payment checkout preparation screen");
}
for (const snippet of ["성인", "유소년", "청소년"]) {
  assertIncludes(sources.paymentCheckoutAccess, snippet, "shared payment checkout age labels");
}
for (const snippet of [
  "결제 연결 전",
  "실 결제 연결 전",
	  "결제 연동",
	  "결제사 연결",
	  "온라인 결제 준비",
	  "온라인 결제 준비 중",
	  "납부 안내 대기",
		  "온라인 납부 방법이 열리면",
		  "결제 진행하기",
		  "운영 결제 설정이 완료",
	  "전용 화면으로 이어집니다",
	]) {
  assertExcludes(sources.paymentCheckoutScreen, snippet, "payment checkout screen must avoid unfinished integration copy");
}
assert(
  sources.paymentCheckoutScreen.indexOf('checkoutAccess.state === "guardian_required"') <
    sources.paymentCheckoutScreen.indexOf("getPaymentCheckoutAmount(payment)"),
  "payment checkout screen must suppress amount details before youth member direct checkout rendering",
);
for (const snippet of ["fetch(", "online-checkout", "PaymentIntent", "CheckoutSession", "stripe"]) {
  assertExcludes(sources.paymentCheckoutScreen, snippet, "payment checkout preparation screen stays API-free");
}
for (const snippet of [
  "payerOptionalOpen",
  "addressSearchMessage",
  "#payment-payer-address",
  "manualAddressEntryMessage",
  'data-testid="payment-payer-optional-toggle"',
  'data-testid="payment-payer-optional-details"',
  'data-testid="payment-payer-address-search"',
  'data-testid="payment-payer-address-search-feedback"',
  'data-testid="payment-payer-zip-input"',
  'data-testid="payment-payer-base-address-input"',
  'data-testid="payment-payer-landline-prefix"',
  "주소·이메일 추가",
  "우편번호와 주소를 직접 입력해 주세요.",
]) {
  assertIncludes(sources.paymentCheckoutScreen, snippet, "payment checkout optional payer details stay collapsed by default");
}
for (const snippet of ["연동 전", "연결 전", "주소 검색 연동", "API 연동"]) {
  assertExcludes(sources.paymentCheckoutScreen, snippet, "payment checkout address guidance must avoid implementation-state copy");
}
for (const snippet of ["06164", "서울 강남구 테헤란로"]) {
  assertExcludes(sources.paymentCheckoutScreen, snippet, "payment checkout address search must not inject sample address data");
}
assertIncludes(sources.paymentCheckoutPage, "PaymentCheckoutScreen", "payment checkout route");
assert.equal(
  packageJson.scripts?.["test:family-payment-checkout"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-family-payment-checkout.mjs",
  "package.json must expose test:family-payment-checkout",
);
assert.equal(
  packageJson.scripts?.["test:payment-create-touch-targets"],
  "node scripts/check-payment-create-touch-targets.mjs",
  "package.json must expose test:payment-create-touch-targets",
);
assert.equal(
  packageJson.scripts?.["test:class-management-touch-targets"],
  "node scripts/check-class-management-touch-targets.mjs",
  "package.json must expose test:class-management-touch-targets",
);
assert.equal(
  packageJson.scripts?.["test:member-management-touch-targets"],
  "node scripts/check-member-management-touch-targets.mjs",
  "package.json must expose test:member-management-touch-targets",
);
assert.equal(
  packageJson.scripts?.["test:coach-classes-bottom-safe-area"],
  "node scripts/check-coach-classes-bottom-safe-area.mjs",
  "package.json must expose test:coach-classes-bottom-safe-area",
);
assert.equal(
  packageJson.scripts?.["test:admin-audit-bottom-safe-area"],
  "node scripts/check-admin-audit-bottom-safe-area.mjs",
  "package.json must expose test:admin-audit-bottom-safe-area",
);
assert.equal(
  packageJson.scripts?.["test:admin-audit-search"],
  "node scripts/check-admin-audit-search.mjs",
  "package.json must expose test:admin-audit-search",
);
assert.equal(
  packageJson.scripts?.["test:audit-action-contract"],
  "node scripts/check-audit-action-contract.mjs",
  "package.json must expose test:audit-action-contract",
);
assert.equal(
  packageJson.scripts?.["test:audit-log-privacy"],
  "node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-audit-log-privacy.mjs",
  "package.json must expose test:audit-log-privacy",
);
for (const snippet of [
  "audit phone, email, identifier, credential, endpoint, and sensitive content masking",
  "central server read/write audit sanitization",
  "readable before/after audit detail rows without raw JSON",
  "audit detail URL restoration",
]) {
  assertIncludes(sources.auditLogPrivacyScript, snippet, "audit log privacy regression script");
}
assert.equal(
  packageJson.scripts?.["test:admin-user-guardian-bottom-safe-area"],
  "node scripts/check-admin-user-guardian-bottom-safe-area.mjs",
  "package.json must expose test:admin-user-guardian-bottom-safe-area",
);
for (const snippet of [
  "guardian bidirectional child scope",
  "guardian payment child switcher scope",
  "adult member direct checkout preparation",
  "guardian child checkout preparation",
  "youth member direct checkout block",
  "youth member direct checkout detail suppression",
  "forbidden direct checkout route hides payment details",
  "blocked checkout state passive badge",
  "whole-card click and keyboard checkout entry",
  "payment notification checkout entry",
  "checkout page avoids duplicated bottom status row",
]) {
  assertIncludes(sources.familyPaymentCheckoutScript, snippet, "family payment checkout regression script");
}
for (const snippet of [
  "collectBottomNavigationClearance",
  "payment-checkout-provider-status",
  "confirmButtonNavClearance >= 24",
  "providerStatusNavClearance >= 24",
  "summaryHeight <= 245",
  "summaryGridHeight <= 150",
  "payerInfoTop <= 480",
  "payerInfoHeight <= 280",
  "methodSectionTop <= 730",
  "cardGuideButtonMinHeight >= 44",
  "payment-card-guide-button",
  "optionalDetailsCount, 0",
  "optional payer address landline and email details stay collapsed until requested",
  "member-optional-payer-details-mobile.png",
  "payment-payer-optional-toggle",
  "payment-payer-optional-details",
  "payment-payer-address-search",
  "payment-payer-address-search-feedback",
  "address search avoids sample autofill before provider integration",
  "address search must not inject a sample zip code",
  "address search must not inject a sample base address",
  "checkout summary stays compact before payer information",
  "member-bottom-clearance-mobile.png",
  "bottomNavigationClearance",
  "cleanPaymentCheckoutOutputDir",
  'entry.name.endsWith(".png")',
  "outputCleanup",
  "이메일 주소 입력",
  "payer email placeholder avoids sample/test account copy",
  "must require an explicit opt-in before saving payment method info",
  "bank transfer confirmation must default to one-time payment info",
  "confirmation must reflect saved payment info after explicit opt-in",
  "reusable payment information starts unchecked and only changes after explicit opt-in",
  "다음 납부에도 사용할 정보로 표시했습니다",
  "이번 납부 확인에만 사용합니다",
  "default confirmation must not claim saved payment info",
  "saved confirmation must not keep one-time payment copy",
  "collectConfirmationFeedbackA11y",
  "confirmation feedback must announce as a status message",
  "confirmation feedback must use polite live-region timing",
  "checkout confirmation feedback announces through a polite status live region",
  "confirmationFeedbackA11y",
	  "collectWooriWonPayModalLayout",
	  "우리WON페이 선택을 확인합니다",
	  "앱 선택은 납부 안내에 참고됩니다",
	  "WooriWON Pay modal copy confirms app selection without implying live payment",
  "Woori modal must not imply live payment completion before provider connection",
  'data-testid="payment-wooriwonpay-panel"',
  'data-testid="payment-wooriwonpay-tab-primary"',
  'data-testid="payment-wooriwonpay-tab-secondary"',
  "WooriWON Pay modal keeps 44px close and tab touch targets",
  "modal panel must keep bottom breathing room",
]) {
  assertIncludes(sources.paymentCheckoutMethodFlowScript, snippet, "payment checkout method flow regression script");
}
for (const snippet of [
  "PAYMENT_CREATE_TOUCH_TARGETS_OUT_DIR",
  'data-testid="payment-export-button"',
  'data-testid="payment-status-filter"',
  'data-testid="payment-operations-metric"',
  'data-testid="payment-renewal-prefill"',
  'data-testid="payment-online-request-button"',
  'data-testid="payment-recurring-create-button"',
  'data-testid="payment-refund-submit"',
  'data-testid="payment-cancel-submit"',
  'data-testid="payment-create-form"',
  'data-testid="payment-create-toggle"',
  'data-testid="payment-create-fields"',
  'data-testid="payment-create-member-search-input"',
  'data-testid="payment-create-member-result"',
  'data-testid="payment-create-selected-member"',
  'data-testid="payment-create-submit"',
  "owner payment export, filter, summary status, operations metrics, and row actions stay 44px touch targets",
  "payment create toggle, search input, results, fields, and submit action stay 44px touch targets",
  "payment create member search finds and selects a real member without scroll-only picker behavior",
  "Browser skill is available, but tool discovery did not expose",
  "cleanPaymentCreateOutputDir",
  "outputCleanup",
]) {
  assertIncludes(sources.paymentCreateTouchTargetsScript, snippet, "payment create touch-target regression script");
}
for (const snippet of [
  'ADMIN_USER_GUARDIAN_BOTTOM_SAFE_AREA_OUT_DIR',
  'admin-user-list-scroll-region',
  'admin-user-list-bottom-safe-area',
  'admin-user-guardian-child-selected-list',
  'admin-user-edit-bottom-safe-area',
  'data-testid="mobile-bottom-navigation"',
  'visibleActionOverlapBottomNavCount',
  'listScrollRegionBottomClearance >= 24',
  'selectedChipNavClearance >= 96',
  'selectedListNavClearance >= 96',
  'managed-next-dev-webpack',
]) {
  assertIncludes(sources.adminUserGuardianBottomSafeAreaScript, snippet, "admin user guardian bottom safe-area regression script");
}
for (const snippet of [
  'ADMIN_AUDIT_BOTTOM_SAFE_AREA_OUT_DIR',
  'data-testid="admin-audit-bottom-safe-area"',
  'data-testid="admin-audit-log-list-toggle"',
  'data-testid="mobile-bottom-navigation"',
  'listToggleClearance >= 96',
  'managed-next-dev-webpack',
]) {
  assertIncludes(sources.adminAuditBottomSafeAreaScript, snippet, "admin audit bottom safe-area regression script");
}
for (const snippet of [
  'ADMIN_AUDIT_SEARCH_OUT_DIR',
  'data-testid="admin-audit-search-input"',
  'data-testid="admin-audit-search-clear"',
  'data-testid="admin-audit-filter-reset"',
  'data-testid="admin-audit-empty-filter-reset"',
  "promotion.create",
  "tournament.create",
  "tournament.update",
  "tournament.delete",
  "admin audit search hydrates q from the URL",
  "admin audit API accepts shared promotion and tournament filters shown in the UI",
  "admin audit and role screens use one completion label policy",
]) {
  assertIncludes(sources.adminAuditSearchScript, snippet, "admin audit search regression script");
}
for (const snippet of [
  'COACH_CLASSES_BOTTOM_SAFE_AREA_OUT_DIR',
  'data-testid="coach-mobile-save-status-panel"',
  'data-testid="mobile-bottom-navigation"',
  'panelBottomClearance >= 24',
  'panelZIndex < 30',
  "statusChipHeight >= 44",
  "undoButtonHeight >= 44",
  "layout.retryButtonCount === 0 || layout.retryButtonHeight >= 44",
  'listToggleBottomClearance >= 96',
  'rosterToggleBottomNavOverlapCount',
  'managed-next-dev-webpack',
]) {
  assertIncludes(sources.coachClassesBottomSafeAreaScript, snippet, "coach classes bottom safe-area regression script");
}
assert.equal(guardianPaymentChildSyncReport.ok, true, "guardian payment child sync evidence must pass");
assert.equal(guardianPaymentChildSyncReport.browser?.ok, true, "guardian payment child sync browser proof must pass");
assert.equal(guardianPaymentChildSyncReport.ios?.ok, true, "guardian payment child sync iOS proof must pass");
assert.equal(
  guardianPaymentChildSyncReport.browser?.initial?.paymentCardCount,
  1,
  "guardian payment child sync must show one selected child payment initially",
);
assert.equal(
  guardianPaymentChildSyncReport.browser?.junSelected?.hasJunPayment,
  true,
  "guardian payment child sync must switch to Jun's selected child payment",
);
assert.equal(
  guardianPaymentChildSyncReport.browser?.yunaSelected?.hasYunaPayment,
  true,
  "guardian payment child sync must switch to Yuna's selected child payment",
);
assert.equal(
  guardianPaymentChildSyncReport.browser?.oldGuardianAfterReplace?.hasJunPayment,
  false,
  "guardian payment child sync must remove replaced child payments from the old guardian",
);
assert.equal(
  guardianPaymentChildSyncReport.ios?.visualCheck?.obviousOverlap,
  false,
  "guardian payment child sync iOS screenshot must not show obvious overlap",
);
assert.equal(noticeDeleteEvidenceReport.ok, true, "notice delete evidence must pass");
assert.equal(noticeDeleteEvidenceReport.browser?.ok, true, "notice delete browser proof must pass");
assert.equal(noticeDeleteEvidenceReport.browser?.ownerAfter?.titleVisible, false, "notice delete proof must remove deleted notice from owner list");
assert.match(
  noticeDeleteEvidenceReport.browser?.ownerAfter?.deleteFeedback ?? "",
  /삭제했습니다/,
  "notice delete proof must keep success feedback visible",
);
assert.equal(
  noticeDeleteEvidenceReport.browser?.memberView?.deleteActionCount,
  0,
  "notice delete proof must keep delete actions hidden from member and guardian notice screens",
);
assert.equal(noticeDeleteEvidenceReport.ios?.ok, true, "notice delete iOS proof must pass");
assert.equal(
  noticeDeleteEvidenceReport.ios?.visualCheck?.deleteActionVisible,
  true,
  "notice delete iOS proof must show publisher delete action",
);
assert.equal(
  noticeDeleteEvidenceReport.ios?.visualCheck?.obviousOverlap,
  false,
  "notice delete iOS screenshot must not show obvious overlap",
);
assert.match(
  adminUserGuardianBottomSafeAreaReport.appServer ?? "",
  /^(existing|managed-next-dev-webpack)$/,
  "admin user guardian bottom safe-area evidence must record app server source",
);
assert.equal(adminUserGuardianBottomSafeAreaReport.ok, true, "admin user guardian bottom safe-area evidence must pass");
assert.equal(
  adminUserGuardianBottomSafeAreaReport.layout?.listScrollRegionCount,
  1,
  "admin users list safe-area evidence must show one bounded scroll region",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.listScrollRegionBottomClearance >= 24,
  "admin users list scroll region must clear the mobile bottom navigation",
);
assert.equal(
  adminUserGuardianBottomSafeAreaReport.layout?.listSafeAreaCount,
  1,
  "admin users list safe-area evidence must show one internal list spacer",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.listSafeAreaHeight >= 96,
  "admin users list safe-area evidence must reserve mobile bottom space",
);
assert.equal(
  adminUserGuardianBottomSafeAreaReport.layout?.visibleActionOverlapBottomNavCount,
  0,
  "admin users visible list actions must not overlap the mobile bottom navigation",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.visibleActionMinHeight >= 44,
  "admin users visible list actions must keep 44px touch targets",
);
assert.equal(
  adminUserGuardianBottomSafeAreaReport.layout?.selectedListCount,
  1,
  "admin guardian edit bottom safe-area evidence must show one selected-child list",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.selectedChipCount >= 2,
  "admin guardian edit bottom safe-area evidence must show linked child chips",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.selectedListNavClearance >= 96,
  "admin guardian selected-child list must clear the mobile bottom navigation",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.selectedChipNavClearance >= 96,
  "admin guardian selected-child chips must clear the mobile bottom navigation",
);
assert.equal(
  adminUserGuardianBottomSafeAreaReport.layout?.spacerCount,
  1,
  "admin guardian edit bottom safe-area evidence must show one spacer",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.spacerHeight >= 112,
  "admin guardian edit bottom safe-area evidence must reserve mobile bottom space",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.actionBarHeight >= 44,
  "admin guardian edit action bar must keep 44px controls",
);
assert(
  adminUserGuardianBottomSafeAreaReport.layout?.actionBarBottomClearance >= 16,
  "admin guardian edit action bar must clear the mobile bottom navigation",
);
assert.equal(
  adminUserGuardianBottomSafeAreaReport.layout?.frameworkOverlayCount,
  0,
  "admin guardian edit bottom safe-area evidence must show no framework overlay",
);
assert.equal(
  adminUserGuardianBottomSafeAreaReport.layout?.scrollWidth,
  adminUserGuardianBottomSafeAreaReport.layout?.clientWidth,
  "admin guardian edit bottom safe-area evidence must show no horizontal overflow",
);
assert(
  adminUserGuardianBottomSafeAreaReport.listActionScreenshotPath &&
    existsSync(adminUserGuardianBottomSafeAreaReport.listActionScreenshotPath),
  "admin users list safe-area screenshot must exist",
);
assert(
  statSync(adminUserGuardianBottomSafeAreaReport.listActionScreenshotPath).size > 10_000,
  "admin users list safe-area screenshot must be non-empty",
);
assert(
  adminUserGuardianBottomSafeAreaReport.screenshotPath &&
    existsSync(adminUserGuardianBottomSafeAreaReport.screenshotPath),
  "admin guardian edit bottom safe-area screenshot must exist",
);
assert(
  statSync(adminUserGuardianBottomSafeAreaReport.screenshotPath).size > 10_000,
  "admin guardian edit bottom safe-area screenshot must be non-empty",
);
assert.equal(adminUserListSafeAreaIosReport.ok, true, "admin users list safe-area iOS evidence must pass");
assert.equal(
  adminUserListSafeAreaIosReport.visualCheck?.appScreenVisible,
  true,
  "admin users list safe-area iOS evidence must show the app screen",
);
assert.equal(
  adminUserListSafeAreaIosReport.visualCheck?.userListVisible,
  true,
  "admin users list safe-area iOS evidence must show the user list",
);
assert.equal(
  adminUserListSafeAreaIosReport.visualCheck?.firstRowActionButtonsVisible,
  true,
  "admin users list safe-area iOS evidence must show the first row actions",
);
assert.equal(
  adminUserListSafeAreaIosReport.visualCheck?.obviousBottomNavOverlap,
  false,
  "admin users list safe-area iOS evidence must not show obvious bottom navigation overlap",
);
assert(
  adminUserListSafeAreaIosReport.screenshotPath && existsSync(adminUserListSafeAreaIosReport.screenshotPath),
  "admin users list safe-area iOS screenshot must exist",
);
assert(
  statSync(adminUserListSafeAreaIosReport.screenshotPath).size > 10_000,
  "admin users list safe-area iOS screenshot must be non-empty",
);
assert.equal(
  adminUserManagementTouchTargetsReport.ok,
  true,
  "admin user management touch-target evidence must pass",
);
assert.equal(
  adminUserManagementTouchTargetsReport.verified?.inviteFormCollapsedByDefault,
  true,
  "admin user management touch-target evidence must keep invite form collapsed by default",
);
assert.equal(
  adminUserManagementTouchTargetsReport.verified?.allTouchTargetsAtLeast44,
  true,
  "admin user management touch-target evidence must keep opened controls at least 44px",
);
assert(
  adminUserManagementTouchTargetsReport.verified?.minOpenTouchHeight >= 44,
  "admin user management touch-target evidence must record min open control height",
);
assert.equal(
  adminUserManagementTouchTargetsReport.verified?.rowActionsAtLeast44,
  true,
  "admin user management touch-target evidence must keep row actions at least 44px",
);
assert.equal(
  adminUserManagementTouchTargetsReport.verified?.horizontalOverflow,
  0,
  "admin user management touch-target evidence must not overflow horizontally",
);
assert.equal(
  adminUserManagementTouchTargetsReport.adminUsers?.messages?.length,
  0,
  "admin user management touch-target evidence must be console-clean",
);
assert.equal(
  adminUserManagementTouchTargetsReport.verified?.iosSimulatorNoBrowserChrome,
  true,
  "admin user management touch-target evidence must include iOS Simulator app chrome proof",
);
for (const screenshot of adminUserManagementTouchTargetsReport.screenshots ?? []) {
  assert(screenshot.path && existsSync(screenshot.path), `${screenshot.path} must exist`);
  assert(statSync(screenshot.path).size > 10_000, `${screenshot.path} must be a non-empty admin user management screenshot`);
}
assert(
  adminUserManagementTouchTargetsReport.iosSimulator?.screenshot?.path &&
    existsSync(adminUserManagementTouchTargetsReport.iosSimulator.screenshot.path),
  "admin user management iOS simulator screenshot must exist",
);
assert(
  statSync(adminUserManagementTouchTargetsReport.iosSimulator.screenshot.path).size > 10_000,
  "admin user management iOS simulator screenshot must be non-empty",
);
assert.match(
  coachClassesBottomSafeAreaReport.appServer ?? "",
  /^(existing|managed-next-dev-webpack)$/,
  "coach classes bottom safe-area evidence must record app server source",
);
assert.match(
  coachClassesBottomSafeAreaReport.flow ?? "",
  /role=coach.*\/app\/classes/,
  "coach classes bottom safe-area evidence must target the coach classes flow",
);
assert.equal(
  coachClassesBottomSafeAreaReport.result?.layout?.frameworkOverlayCount,
  0,
  "coach classes bottom safe-area evidence must show no framework overlay",
);
assert.equal(
  coachClassesBottomSafeAreaReport.result?.layout?.scrollWidth,
  coachClassesBottomSafeAreaReport.result?.layout?.clientWidth,
  "coach classes bottom safe-area evidence must show no horizontal overflow",
);
assert.equal(
  coachClassesBottomSafeAreaReport.result?.layout?.panelCount,
  1,
  "coach classes bottom safe-area evidence must show one mobile save status panel",
);
assert(
  coachClassesBottomSafeAreaReport.result?.layout?.panelBottomClearance >= 24,
  "coach classes mobile save status panel must clear the bottom navigation",
);
assert(
  coachClassesBottomSafeAreaReport.result?.layout?.panelZIndex < 30,
  "coach classes mobile save status panel must stay below the bottom navigation layer",
);
assert.equal(
  coachClassesBottomSafeAreaReport.result?.layout?.statusChipCount,
  1,
  "coach classes mobile save status evidence must show one status chip",
);
assert(
  coachClassesBottomSafeAreaReport.result?.layout?.statusChipHeight >= 44,
  "coach classes mobile save status chip must keep a 44px scan height",
);
assert.equal(
  coachClassesBottomSafeAreaReport.result?.layout?.undoButtonCount,
  1,
  "coach classes mobile save status evidence must show one undo action after a change",
);
assert(
  coachClassesBottomSafeAreaReport.result?.layout?.undoButtonHeight >= 44,
  "coach classes mobile undo action must keep a 44px touch height",
);
assert(
  coachClassesBottomSafeAreaReport.result?.layout?.retryButtonCount === 0 ||
    coachClassesBottomSafeAreaReport.result?.layout?.retryButtonHeight >= 44,
  "coach classes mobile retry action must keep a 44px touch height when visible",
);
assert(
  coachClassesBottomSafeAreaReport.result?.initialLayout?.listToggleBottomClearance >= 96,
  "coach classes mobile list expansion control must keep bottom navigation clearance",
);
assert.equal(
  coachClassesBottomSafeAreaReport.result?.initialLayout?.rosterToggleBottomNavOverlapCount,
  0,
  "coach classes roster toggles must not overlap bottom navigation",
);
assert(
  coachClassesBottomSafeAreaReport.result?.screenshotPath &&
    existsSync(coachClassesBottomSafeAreaReport.result.screenshotPath),
  "coach classes bottom safe-area screenshot must exist",
);
assert(
  statSync(coachClassesBottomSafeAreaReport.result.screenshotPath).size > 10_000,
  "coach classes bottom safe-area screenshot must be non-empty",
);
assert.equal(coachClassesBottomSafeAreaIosReport.ok, true, "coach classes bottom safe-area iOS evidence must pass");
assert.match(
  coachClassesBottomSafeAreaIosReport.flow ?? "",
  /coach auto-login -> \/app\/classes/,
  "coach classes bottom safe-area iOS evidence must target the coach classes flow",
);
assert.equal(
  coachClassesBottomSafeAreaIosReport.visualCheck?.appScreenVisible,
  true,
  "coach classes bottom safe-area iOS evidence must show the app screen",
);
assert.equal(
  coachClassesBottomSafeAreaIosReport.visualCheck?.coachClassesVisible,
  true,
  "coach classes bottom safe-area iOS evidence must show the coach classes screen",
);
assert.equal(
  coachClassesBottomSafeAreaIosReport.visualCheck?.bottomNavigationVisible,
  true,
  "coach classes bottom safe-area iOS evidence must show the bottom navigation",
);
assert.equal(
  coachClassesBottomSafeAreaIosReport.visualCheck?.obviousBottomNavOverlap,
  false,
  "coach classes bottom safe-area iOS evidence must not show obvious bottom navigation overlap",
);
assert.equal(
  coachClassesBottomSafeAreaIosReport.browserPanelLayout?.panelBottomClearance,
  coachClassesBottomSafeAreaReport.result?.layout?.panelBottomClearance,
  "coach classes iOS summary must reference the same browser panel clearance regression result",
);
assert(
  coachClassesBottomSafeAreaIosReport.browserPanelLayout?.statusChipHeight >= 44,
  "coach classes iOS summary must reference the 44px mobile save status chip regression result",
);
assert(
  coachClassesBottomSafeAreaIosReport.browserPanelLayout?.undoButtonHeight >= 44,
  "coach classes iOS summary must reference the 44px mobile undo action regression result",
);
assert(
  coachClassesBottomSafeAreaIosReport.browserPanelLayout?.retryButtonCount === 0 ||
    coachClassesBottomSafeAreaIosReport.browserPanelLayout?.retryButtonHeight >= 44,
  "coach classes iOS summary must reference the 44px mobile retry action regression result when visible",
);
assert(
  coachClassesBottomSafeAreaIosReport.screenshotPath &&
    existsSync(coachClassesBottomSafeAreaIosReport.screenshotPath),
  "coach classes bottom safe-area iOS screenshot must exist",
);
assert(
  statSync(coachClassesBottomSafeAreaIosReport.screenshotPath).size > 10_000,
  "coach classes bottom safe-area iOS screenshot must be non-empty",
);
assert.match(
  adminAuditBottomSafeAreaReport.appServer ?? "",
  /^(existing|managed-next-dev-webpack)$/,
  "admin audit bottom safe-area evidence must record app server source",
);
assert.equal(adminAuditBottomSafeAreaReport.ok, true, "admin audit bottom safe-area evidence must pass");
assert.equal(
  adminAuditBottomSafeAreaReport.layout?.spacerCount,
  1,
  "admin audit bottom safe-area evidence must show one spacer",
);
assert(
  adminAuditBottomSafeAreaReport.layout?.spacerHeight >= 112,
  "admin audit bottom safe-area evidence must reserve mobile bottom space",
);
assert.equal(
  adminAuditBottomSafeAreaReport.layout?.listToggleCount,
  1,
  "admin audit bottom safe-area evidence must show one more-records action",
);
assert(
  adminAuditBottomSafeAreaReport.layout?.listToggleClearance >= 96,
  "admin audit more-records action must clear the bottom navigation",
);
assert.equal(
  adminAuditBottomSafeAreaReport.layout?.frameworkOverlayCount,
  0,
  "admin audit bottom safe-area evidence must show no framework overlay",
);
assert.equal(
  adminAuditBottomSafeAreaReport.layout?.scrollWidth,
  adminAuditBottomSafeAreaReport.layout?.clientWidth,
  "admin audit bottom safe-area evidence must show no horizontal overflow",
);
assert(
  adminAuditBottomSafeAreaReport.screenshotPath &&
    existsSync(adminAuditBottomSafeAreaReport.screenshotPath),
  "admin audit bottom safe-area screenshot must exist",
);
assert(
  statSync(adminAuditBottomSafeAreaReport.screenshotPath).size > 10_000,
  "admin audit bottom safe-area screenshot must be non-empty",
);
assert.match(
  adminAuditSearchReport.appServer ?? "",
  /^(existing|managed)$/,
  "admin audit search evidence must record app server source",
);
assert.equal(adminAuditSearchReport.ok, true, "admin audit search evidence must pass");
assert.equal(adminAuditSearchReport.consoleMessages?.length ?? 0, 0, "admin audit search evidence must be console-clean");
assert(
  adminAuditSearchReport.checked?.includes("admin audit search hydrates q from the URL"),
  "admin audit search evidence must verify URL hydration",
);
assert(
  adminAuditSearchReport.checked?.includes("admin audit API accepts shared promotion and tournament filters shown in the UI"),
  "admin audit search evidence must verify API/UI promotion and tournament filter parity",
);
assert(
  adminAuditSearchReport.checked?.includes("admin audit detail uses readable Korean before/after rows without raw JSON"),
  "admin audit search evidence must verify readable detail rows",
);
assert(
  adminAuditSearchReport.checked?.includes("admin audit detail deep link restores and toggles the selected record"),
  "admin audit search evidence must verify detail deep links",
);
assert(
  adminAuditSearchReport.checked?.includes("identical short-window audit read retries persist one traceable record"),
  "admin audit search evidence must verify read retry deduplication",
);
assert(
  adminAuditSearchReport.checked?.includes("audit date-only ranges include the full selected Korea day"),
  "admin audit search evidence must verify date-only range boundaries",
);
assert(
  adminAuditSearchReport.checked?.includes("audit filter form prevents reversed date drafts"),
  "admin audit search evidence must verify reversed date draft prevention",
);
assert(
  adminAuditSearchReport.controls?.filtered?.inputHeight >= 44,
  "admin audit search evidence must keep filtered search input tappable",
);
assert(
  adminAuditSearchReport.controls?.filtered?.clearButtonHeight >= 44,
  "admin audit search evidence must keep search clear action tappable",
);
assert(
  adminAuditSearchReport.controls?.filtered?.submitHeight >= 44,
  "admin audit search evidence must keep filter submit tappable",
);
assert(
  adminAuditSearchReport.controls?.filtered?.resetHeight >= 44,
  "admin audit search evidence must keep filter reset tappable",
);
assert.equal(
  adminAuditSearchReport.controls?.filtered?.scrollWidth,
  adminAuditSearchReport.controls?.filtered?.clientWidth,
  "admin audit search evidence must show no filtered horizontal overflow",
);
assert.equal(
  adminAuditSearchReport.controls?.empty?.rowCount,
  0,
  "admin audit empty search evidence must hide stale rows",
);
assert(
  adminAuditSearchReport.controls?.empty?.emptyResetHeight >= 44,
  "admin audit empty search reset must stay tappable",
);
assert(
  adminAuditSearchReport.controls?.empty?.emptyResetBottomNavClearance >= 24,
  "admin audit empty search reset must clear mobile bottom navigation",
);
assert.equal(
  adminAuditSearchReport.controls?.empty?.scrollWidth,
  adminAuditSearchReport.controls?.empty?.clientWidth,
  "admin audit empty search evidence must show no horizontal overflow",
);
assert(adminAuditSearchReport.controls?.detail?.changeRowCount >= 2, "admin audit detail evidence must include change rows");
assert.equal(adminAuditSearchReport.controls?.detail?.preCount, 0, "admin audit detail evidence must exclude raw preformatted JSON");
assert.equal(
  adminAuditSearchReport.controls?.detail?.scrollWidth,
  adminAuditSearchReport.controls?.detail?.clientWidth,
  "admin audit detail evidence must show no horizontal overflow",
);
for (const action of ["promotion.create", "promotion.update", "tournament.create", "tournament.update", "tournament.delete"]) {
  const filterApi = adminAuditSearchReport.actionFilterApis?.find((item) => item.action === action);
  assert.equal(filterApi?.status, 200, `admin audit ${action} filter API evidence must return 200`);
}
assert.equal(adminAuditSearchReport.duplicateReadAudit?.count, 1, "admin audit duplicate reads must persist once");
assert.equal(adminAuditSearchReport.duplicateReadAudit?.repeatedStatus, 200, "admin audit duplicate read requests must succeed");
assert.equal(adminAuditSearchReport.duplicateReadAudit?.inspectStatus, 200, "admin audit duplicate read inspection must succeed");
assert.equal(adminAuditSearchReport.dateBoundaryApi?.validStatus, 200, "admin audit same-day range API must succeed");
assert(adminAuditSearchReport.dateBoundaryApi?.returnedCount >= 1, "admin audit same-day range must return current-day records");
assert.equal(
  adminAuditSearchReport.dateBoundaryApi?.allReturnedLogsInsideSelectedDay,
  true,
  "admin audit same-day range must stay inside the selected Korea date",
);
assert(adminAuditSearchReport.controls?.filtered?.fromHeight >= 44, "admin audit from-date input must stay tappable");
assert(adminAuditSearchReport.controls?.filtered?.toHeight >= 44, "admin audit to-date input must stay tappable");
assert.equal(
  adminAuditSearchReport.controls?.filtered?.toMin,
  adminAuditSearchReport.controls?.filtered?.fromValue,
  "admin audit end-date minimum must follow the start date",
);
for (const screenshot of Object.values(adminAuditSearchReport.screenshots ?? {})) {
  assert(screenshot?.path && existsSync(screenshot.path), "admin audit search screenshot must exist");
  assert(statSync(screenshot.path).size > 10_000, "admin audit search screenshot must be non-empty");
}
assert.equal(adminAuditPrivacyIosReport.ok, true, "admin audit privacy iOS simulator evidence must pass");
assert.equal(adminAuditPrivacyIosReport.build?.result, "BUILD SUCCEEDED", "admin audit privacy iOS build must pass");
assert(
  adminAuditPrivacyIosReport.checked?.includes("Capacitor app opens the selected audit detail from the detail deep link"),
  "admin audit privacy iOS evidence must verify detail deep-link restoration",
);
assert(
  adminAuditPrivacyIosReport.screenshot?.path && existsSync(adminAuditPrivacyIosReport.screenshot.path),
  "admin audit privacy iOS screenshot must exist",
);
assert(statSync(adminAuditPrivacyIosReport.screenshot.path).size > 10_000, "admin audit privacy iOS screenshot must be non-empty");
assert.equal(adminBranchSelectedScopeReport.ok, true, "admin branch selected-scope browser proof must pass");
assert.equal(
  adminBranchSelectedScopeReport.state?.title,
  "선택 지점 관리",
  "admin branch selected-scope proof must show selected-scope title",
);
assert.equal(
  adminBranchSelectedScopeReport.state?.branchCardCount,
  1,
  "admin branch selected-scope proof must render only the selected branch card",
);
assert.match(
  adminBranchSelectedScopeReport.state?.branchCardText ?? "",
  /강남 본관/,
  "admin branch selected-scope proof must render the selected branch",
);
assert(
  !(adminBranchSelectedScopeReport.state?.branchCardText ?? "").includes("송파 도장"),
  "admin branch selected-scope proof must hide non-selected branch cards",
);
assert.equal(
  adminBranchSelectedScopeReport.state?.createPanelCount,
  0,
  "admin branch selected-scope proof must hide branch creation controls",
);
assert.equal(
  adminBranchSelectedScopeReport.state?.ownerToggleCount,
  1,
  "admin branch selected-scope proof must keep selected branch owner action",
);
assert.equal(
  adminBranchSelectedScopeReport.state?.settingsToggleCount,
  1,
  "admin branch selected-scope proof must keep selected branch settings action",
);
assert(adminBranchSelectedScopeReport.screenshotSizeBytes > 10_000, "admin branch selected-scope screenshot must be non-empty");
assert.equal(paymentCheckoutEvidenceReport.apiIntegration, false, "payment checkout evidence must stay API-free");
assert.equal(
  paymentCheckoutEvidenceReport.safeAreaFix?.file,
  "member-checkout-safearea.jpg",
  "payment checkout evidence must include the mobile safe-area fix screenshot",
);
const paymentCheckoutEvidenceFiles = new Set((paymentCheckoutEvidenceReport.screenshots ?? []).map((screenshot) => screenshot.file));
for (const screenshotFile of [
  "member-payments-card.jpg",
  "member-checkout-ready.jpg",
  "member-checkout-safearea.jpg",
  "guardian-payments-card.jpg",
  "guardian-checkout-ready.jpg",
]) {
  assert(paymentCheckoutEvidenceFiles.has(screenshotFile), `payment checkout evidence must include ${screenshotFile}`);
}
assert(
  (paymentCheckoutEvidenceReport.caveats ?? []).some((caveat) =>
    caveat.includes("not IPA ready or payment provider ready"),
  ),
  "payment checkout evidence must keep release/payment-provider caveat",
);
assert.equal(paymentCreateTouchTargetsReport.ok, true, "payment create touch-target evidence must pass");
assert.equal(paymentCreateTouchTargetsReport.consoleMessages?.length ?? 0, 0, "payment create touch-target evidence must be console-clean");
assert(
  paymentCreateTouchTargetsReport.checked?.includes("owner manual payment create form stays collapsed by default"),
  "payment create touch-target evidence must verify collapsed default state",
);
assert(
  paymentCreateTouchTargetsReport.checked?.includes(
    "payment create toggle, search input, results, fields, and submit action stay 44px touch targets",
  ),
  "payment create touch-target evidence must verify 44px controls",
);
assert(
  paymentCreateTouchTargetsReport.checked?.includes(
    "payment create member search finds and selects a real member without scroll-only picker behavior",
  ),
  "payment create touch-target evidence must verify searchable member selection",
);
assert(
  paymentCreateTouchTargetsReport.checked?.includes(
    "manual payment retry reuses its idempotency key, persists exactly once, and shows success feedback",
  ),
  "payment create evidence must verify retry idempotency, persistence, and direct feedback",
);
assert.equal(
  paymentCreateTouchTargetsReport.paymentCreateIdempotency?.keyReused,
  true,
  "payment create evidence must confirm the same idempotency key was reused",
);
assert(
  paymentCreateTouchTargetsReport.screenshots?.created?.path &&
    existsSync(paymentCreateTouchTargetsReport.screenshots.created.path),
  "payment create success feedback screenshot must exist",
);
assert.equal(manualPaymentCreateFeedbackReport.ok, true, "manual payment create iOS evidence must pass");
assert.equal(
  manualPaymentCreateFeedbackReport.browserEvidence,
  files.paymentCreateTouchTargetsReport,
  "manual payment create iOS evidence must reference the interaction proof",
);
assert(
  manualPaymentCreateFeedbackReport.checked?.includes(
    "manual payment create form restores with a selected member deep link",
  ),
  "manual payment create iOS evidence must verify the open form",
);
for (const screenshot of manualPaymentCreateFeedbackReport.screenshots ?? []) {
  assert(screenshot?.path && existsSync(screenshot.path), "manual payment create iOS screenshot must exist");
  assert(statSync(screenshot.path).size > 10_000, "manual payment create iOS screenshot must be non-empty");
}
assert.equal(adminUserDeletePolicyFeedbackReport.ok, true, "admin user delete policy iOS evidence must pass");
assert.equal(
  adminUserDeletePolicyFeedbackReport.expectedFeedback,
  "사용자 계정을 삭제하지 못했습니다. 현재 계정, 총괄 유지, 지점 대표 배정 상태를 확인해 주세요.",
  "admin user delete policy evidence must keep the actionable failure copy",
);
assert.equal(
  adminUserDeletePolicyFeedbackReport.releaseClaim,
  "internal_only",
  "admin user delete policy evidence must stay internal-only",
);
assert.equal(adminUserDeletePolicyFeedbackReport.ipaReady, false, "admin user delete policy evidence must not claim IPA readiness");
assert(
  adminUserDeletePolicyFeedbackReport.screenshot?.path && existsSync(adminUserDeletePolicyFeedbackReport.screenshot.path),
  "admin user delete policy iOS screenshot must exist",
);
assert(
  statSync(adminUserDeletePolicyFeedbackReport.screenshot.path).size > 10_000,
  "admin user delete policy iOS screenshot must be non-empty",
);
assert.equal(
  paymentCreateTouchTargetsReport.layouts?.collapsed?.fieldsCount,
  0,
  "payment create fields must be collapsed by default in evidence",
);
assert(
  paymentCreateTouchTargetsReport.layouts?.collapsed?.toggleHeight >= 44,
  "payment create collapsed toggle must be at least 44px",
);
assert.equal(
  paymentCreateTouchTargetsReport.layouts?.collapsed?.scrollWidth,
  paymentCreateTouchTargetsReport.layouts?.collapsed?.clientWidth,
  "payment create collapsed state must be overflow-free",
);
assert(
  paymentCreateTouchTargetsReport.layouts?.search?.searchInputHeight >= 44,
  "payment create search input must be at least 44px",
);
assert(
  paymentCreateTouchTargetsReport.layouts?.search?.controlHeights?.every((height) => height >= 44),
  "payment create form controls must be at least 44px",
);
assert(
  paymentCreateTouchTargetsReport.layouts?.search?.resultHeights?.length > 0 &&
    paymentCreateTouchTargetsReport.layouts.search.resultHeights.every((height) => height >= 44),
  "payment create search results must be at least 44px",
);
assert.match(
  paymentCreateTouchTargetsReport.layouts?.search?.resultText ?? "",
  /최민재/,
  "payment create search evidence must include the selected real member",
);
assert.equal(
  paymentCreateTouchTargetsReport.layouts?.search?.submitDisabled,
  true,
  "payment create submit must be disabled before selecting a member",
);
assert.equal(
  paymentCreateTouchTargetsReport.layouts?.search?.scrollWidth,
  paymentCreateTouchTargetsReport.layouts?.search?.clientWidth,
  "payment create search state must be overflow-free",
);
assert.match(
  paymentCreateTouchTargetsReport.layouts?.selected?.selectedText ?? "",
  /최민재/,
  "payment create selected evidence must show the chosen member",
);
assert.equal(
  paymentCreateTouchTargetsReport.layouts?.selected?.resultCount,
  0,
  "payment create results must collapse after member selection",
);
assert.equal(
  paymentCreateTouchTargetsReport.layouts?.selected?.submitDisabled,
  false,
  "payment create submit must enable after member selection",
);
assert(
  paymentCreateTouchTargetsReport.layouts?.selected?.submitHeight >= 44,
  "payment create selected submit must be at least 44px",
);
assert.equal(
  paymentCreateTouchTargetsReport.layouts?.selected?.scrollWidth,
  paymentCreateTouchTargetsReport.layouts?.selected?.clientWidth,
  "payment create selected state must be overflow-free",
);
for (const screenshot of Object.values(paymentCreateTouchTargetsReport.screenshots ?? {})) {
  assert(screenshot?.path && existsSync(screenshot.path), "payment create touch-target screenshot must exist");
  assert(statSync(screenshot.path).size > 10_000, "payment create touch-target screenshot must be non-empty");
}
assertIncludes(sources.paymentsExportRoute, "결제 내보내기 권한이 없습니다.", "payments export API service-facing authorization copy");
assertIncludes(sources.paymentsExportRoute, "결제 내보내기를 완료했습니다.", "payments export API service-facing audit copy");
assertExcludes(sources.paymentsExportRoute, "결제 CSV를 내보낼 권한이 없습니다.", "payments export API file-format-first authorization copy");
assertExcludes(sources.paymentsExportRoute, "결제 CSV를 내보냈습니다.", "payments export API file-format-first audit copy");
assertIncludes(sources.auditLogPresentation, '"export.create": "내보내기"', "shared admin audit service-facing export action label");
assertExcludes(sources.auditLogPresentation, '"export.create": "CSV 내보내기"', "shared admin audit file-format-first action label");
assertExcludes(sources.adminAuditLogsScreen, ">CSV 내보내기<", "admin audit logs file-format-first summary card label");
assertIncludes(sources.adminSettings, "결제 생성과 내보내기", "admin settings service-facing audit policy export label");
assertExcludes(sources.adminSettings, "결제 생성과 CSV 내보내기", "admin settings file-format-first audit policy export label");
for (const snippet of ["운영 신호 {dataSignal}", "데이터 신호 {dataSignal}"]) {
  assertExcludes(sources.ownerReportsScreen, snippet, "owner report retired internal operating signal label");
}
for (const snippet of ["최근 확정 매출", "최근 출석률", "최근 결제 위험"]) {
  assertExcludes(sources.ownerReportsScreen, snippet, "owner reports repeated recent trend labels");
}
for (const snippet of [">확정 매출<", ">출석률<", ">결제 위험<"]) {
  assertIncludes(sources.ownerReportsScreen, snippet, "owner reports concise trend summary labels");
}
assertIncludes(sources.ownerReportsScreen, "const ownerReportPrimaryGraphSummary", "owner report primary graph duplicate helper guard");
assertIncludes(sources.ownerReportsScreen, "{ownerReportPrimaryGraphSummary}", "owner report primary graph summary copy");
for (const snippet of [
  "const [showAllOwnerBranchGraphs, setShowAllOwnerBranchGraphs] = useState(false);",
  "const ownerReportBranchGraphRows =",
  "const ownerReportVisibleBranchGraphRows =",
  "const ownerReportHiddenBranchGraphCount = Math.max(ownerReportBranchGraphRows.length - 1, 0);",
  'data-testid="owner-report-branch-graph"',
  'data-testid="owner-report-branch-graph-row"',
  'data-testid="owner-report-branch-graph-toggle"',
  "grid gap-0.5 px-2 py-1",
  "grid min-w-0 grid-cols-[2.25rem_1fr_auto] items-center gap-1",
  "ownerReportVisibleActionQueue",
  "const ownerReportHiddenActionCount = Math.max(actionQueue.length - 1, 0);",
  "actionQueue.slice(0, 1)",
  'data-testid="owner-action-queue-toggle"',
  "지점별 운영 그래프",
]) {
  assertIncludes(sources.ownerReportsScreen, snippet, "owner reports branch operation graph guard");
}
assertExcludes(sources.ownerReportsScreen, "지점별 운영 표", "owner reports stale branch table heading");
assertExcludes(
  sources.ownerReportsScreen,
  '<p className="mt-1 hidden truncate text-[11px] leading-4 text-zinc-500 sm:block">{row.helper}</p>',
  "owner report graph rail must not render helper copy inside compact mobile KPI cells",
);

for (const snippet of [
  "scrollToHashTarget",
  "scrollIntoView",
]) {
  assertIncludes(sources.adminSettings, snippet, "admin settings operational guardrails");
}
for (const snippet of [
  "회원/학부모 CSV 내보내기 노출 금지",
  "코치 결제 금액 비노출 유지",
  "npm run test:p5-p10-internal-readiness",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings internal audit guardrail copy must stay out of client source");
}

for (const document of [
  ["README", sources.readme],
  ["QA plan", sources.qaPlan],
  ["release checklist", sources.releaseChecklist],
  ["implementation backlog", sources.implementationBacklog],
]) {
  for (const snippet of [
    "P5~P10 내부 readiness audit",
    ".data/p5-p10-internal-audit.json",
    ".data/p5-p10-internal-audit.md",
    "npm run p5-p10:internal-audit",
    "npm run test:p5-p10-internal-readiness",
    ".data/mobile-builds/ios/p5-p10-simulator-screenshots",
    "P1 외부 blocker",
    "출시 완료",
    "iOS Simulator 성공을 IPA ready로 보지 않음",
  ]) {
    assertIncludes(document[1], snippet, document[0]);
  }
}

assert.equal(
  packageJson.scripts?.["p5-p10:internal-audit"],
  "node scripts/create-p5-p10-internal-audit.mjs",
  "package.json must expose p5-p10:internal-audit",
);
assert.equal(
  packageJson.scripts?.["test:p5-p10-internal-readiness"],
  "node scripts/check-p5-p10-internal-readiness.mjs",
  "package.json must expose test:p5-p10-internal-readiness",
);
assertIncludes(sources.releaseRunner, '["run", "test:p5-p10-internal-readiness"]', "release runner");
assertIncludes(sources.releaseRunner, '["run", "test:payment-create-touch-targets"]', "release runner");
assertIncludes(sources.releaseRunner, '["run", "test:class-management-touch-targets"]', "release runner");
assertIncludes(sources.releaseRunner, '["run", "test:member-management-touch-targets"]', "release runner");
assertIncludes(sources.releaseRunner, '["run", "test:admin-user-management-touch-targets"]', "release runner");
assert.equal(
  packageJson.scripts?.["test:admin-user-management-touch-targets"],
  "node scripts/check-admin-user-management-touch-targets.mjs",
  "package.json must expose test:admin-user-management-touch-targets",
);
for (const snippet of [
  "MEMBER_MANAGEMENT_TOUCH_TARGETS_OUT_DIR",
  "member-invite-field",
  "member-create-field",
  "member-status-select",
  "member-profile-field",
  "member-note-field",
  "Browser runtime unavailable / Playwright with system Chrome",
]) {
  assertIncludes(sources.memberManagementTouchTargetsScript, snippet, "member management touch target regression script");
}
for (const snippet of [
  "ADMIN_USER_MANAGEMENT_TOUCH_TARGETS_OUT_DIR",
  "admin-user-invite-field",
  "data-admin-user-edit-control",
  "admin-user-delete-reason-input",
  "admin-user-password-reset-reason-input",
  "admin users screen must not keep 40px controls",
  "Browser skill is available, but tool discovery did not expose",
]) {
  assertIncludes(sources.adminUserManagementTouchTargetsScript, snippet, "admin user management touch target regression script");
}
for (const snippet of [
  "CLASS_MANAGEMENT_TOUCH_TARGETS_OUT_DIR",
  "class-create-field",
  "class-edit-input",
  "attendance-note-toggle-",
  "attendance-note-preset-",
  "Browser runtime unavailable / Playwright with system Chrome",
]) {
  assertIncludes(sources.classManagementTouchTargetsScript, snippet, "class management touch target regression script");
}
assertIncludes(sources.adminSettingsGate, "npm run test:p5-p10-internal-readiness", "admin settings gate test");

assert.equal(p1Readiness.ok, false, "P1 readiness must remain not ok during P5-P10 internal audit");
assert.equal(p1Readiness.releaseDecision, "blocked", "P1 readiness releaseDecision must remain blocked");
assert.equal(p1Readiness.summary?.blocked, 7, "P1 readiness must keep blocked 7/7");
assert.equal(p1Readiness.summary?.total, 7, "P1 readiness total must remain 7");

const p1BlockerKeys = new Set((p1Readiness.blockers ?? []).map((blocker) => blocker.key));
for (const blockerKey of [
  "deployment",
  "android",
  "iosIpa",
  "paymentProvider",
  "notificationPush",
  "issueRegistration",
  "pilot",
]) {
  assert(p1BlockerKeys.has(blockerKey), `P1 readiness must keep ${blockerKey} blocker`);
}

assert.equal(androidTwaDoctor.ok, false, "Android TWA doctor must remain blocked until release handoff inputs exist");
assert.equal(androidTwaDoctor.checks?.origin?.ok, true, "Android TWA doctor must use the deployed web app origin after production deploy");
assert.equal(
  androidTwaDoctor.checks?.origin?.value,
  "https://final-judo.vercel.app",
  "Android TWA doctor origin must point at the deployed web app",
);
assertIncludes(
  sources.p1OperatorStatusScript,
  "findLatestAndroidPlayReleaseReport",
  "P1 operator status must discover the latest Android Play release report",
);
assertIncludes(
  sources.p1OperatorStatusScript,
  "Android Play AAB/APK release report",
  "P1 operator status must label Android Play release artifacts distinctly from role APKs",
);
assertIncludes(
  sources.p1OperatorStatusTest,
  "androidPlayRelease",
  "P1 operator status test must cover Android Play release artifacts",
);
assert.equal(p1OperatorStatusCurrent.releaseDecision, "blocked", "P1 operator status must remain blocked while external evidence is pending");
assert(
  (p1OperatorStatusCurrent.checked ?? []).includes("Android Play AAB/APK release report integrity"),
  "P1 operator status must check Android Play AAB/APK release report integrity",
);
const androidPlayReleaseArtifact = (p1OperatorStatusCurrent.supportArtifacts ?? []).find(
  (artifact) => artifact.key === "androidPlayRelease",
);
assert(androidPlayReleaseArtifact, "P1 operator status must expose Android Play AAB/APK release support artifact");
assert.equal(androidPlayReleaseArtifact.status, "ready", "Android Play AAB/APK release artifact must be ready after the current build");
assert.equal(
  androidPlayReleaseArtifact.releaseDecision,
  "artifact_ready_release_blocked",
  "Android Play AAB/APK release artifact must stay artifact-ready while release handoff remains blocked",
);
assert.equal(
  androidPlayReleaseArtifact.packageName,
  "kr.co.finaljudo.multigym",
  "Android Play AAB/APK release artifact must use the Google Play package name",
);
assert(Number(androidPlayReleaseArtifact.versionCode) > 0, "Android Play AAB/APK release artifact must expose versionCode");
assert(
  typeof androidPlayReleaseArtifact.versionName === "string" && androidPlayReleaseArtifact.versionName.trim().length > 0,
  "Android Play AAB/APK release artifact must expose versionName",
);
assert(
  Number(androidPlayReleaseArtifact.aabBytes) > 0 && Number(androidPlayReleaseArtifact.apkBytes) > 0,
  "Android Play AAB/APK release artifact must expose non-empty AAB/APK sizes",
);
assert(
  /android-play-release-\d{14}\/google-play-release-report\.json$/.test(androidPlayReleaseArtifact.path ?? ""),
  "Android Play AAB/APK release artifact must point at the timestamped Play release report",
);
assertIncludes(
  sources.p1OperatorStatusCurrentMarkdown,
  "Android Play AAB/APK release report",
  "P1 operator status Markdown must expose Android Play release artifacts",
);
assertIncludes(
  sources.p1OperatorStatusCurrentMarkdown,
  "google-play-release-report.json",
  "P1 operator status Markdown must include the Play release report path",
);
const androidBlockerChecks = new Set((androidTwaDoctor.blockers ?? []).map((blocker) => blocker.check));
assert(!androidBlockerChecks.has("origin"), "Android TWA doctor must not keep stale origin blocker after deployed origin evidence");
assert(androidBlockerChecks.has("sha256"), "Android TWA doctor must keep sha256 blocker");
for (const blocker of ["java", "keytool", "sdkmanager", "adb", "androidHome"]) {
  assert(!androidBlockerChecks.has(blocker), `Android TWA doctor must not keep stale local build tool blocker ${blocker}`);
}
for (const check of ["java", "keytool", "sdkmanager", "adb", "androidHome"]) {
  assert.equal(androidTwaDoctor.checks?.[check]?.ok, true, `Android TWA doctor must resolve local toolchain check ${check}`);
}
assertIncludes(
  androidTwaDoctor.toolchain?.javaHome ?? "",
  ".data/toolchains/jdk",
  "Android TWA doctor resolved local JDK evidence",
);
assertIncludes(
  androidTwaDoctor.toolchain?.androidHome ?? "",
  ".data/toolchains/android-sdk",
  "Android TWA doctor resolved local Android SDK evidence",
);

assert.equal(iosIpaDoctor.releaseDecision, "blocked", "iOS IPA doctor must remain blocked");
assert.equal(iosIpaDoctor.checks?.origin?.ok, true, "iOS IPA doctor must use the deployed web app origin after production deploy");
assert.equal(
  iosIpaDoctor.checks?.origin?.value,
  "https://final-judo.vercel.app",
  "iOS IPA doctor origin must point at the deployed web app",
);
const ipaBlockerChecks = new Set((iosIpaDoctor.blockers ?? []).map((blocker) => blocker.check));
assert(!ipaBlockerChecks.has("origin"), "iOS IPA doctor must not keep stale origin blocker after deployed origin evidence");
assert(ipaBlockerChecks.has("provisioningProfile"), "iOS IPA doctor must keep provisioningProfile blocker");

assert.equal(p5P10InternalAudit.ok, true, "P5-P10 audit artifact must pass internal evidence checks");
assert.equal(p5P10InternalAudit.releaseDecision, "blocked", "P5-P10 audit artifact must keep releaseDecision blocked");
assert.equal(
  p5P10InternalAudit.internalDecision,
  "p5_p10_internal_audit_ready_release_blocked",
  "P5-P10 audit artifact must distinguish internal readiness from release blocked",
);
assert.equal(p5P10InternalAudit.p1?.releaseDecision, "blocked", "P5-P10 audit artifact must keep P1 blocked");
assert.equal(p5P10InternalAudit.p1?.summary?.blocked, 7, "P5-P10 audit artifact must keep P1 blocked 7/7");
assert.equal(p5P10InternalAudit.p1?.summary?.total, 7, "P5-P10 audit artifact must keep P1 total 7");
assert.equal(p5P10InternalAudit.phases?.length, 6, "P5-P10 audit artifact must include P5 through P10 phases");
assert.deepEqual(
  p5P10InternalAudit.phases.map((phase) => phase.id),
  ["P5", "P6", "P7", "P8", "P9", "P10"],
  "P5-P10 audit artifact must preserve phase order",
);
assert.deepEqual(
  p5P10InternalAudit.externalBlockers.map((blocker) => blocker.key),
  ["deployment", "android", "iosIpa", "paymentProvider", "notificationPush", "issueRegistration", "pilot"],
  "P5-P10 audit artifact must keep all external blocker keys",
);
assert(
  p5P10InternalAudit.externalBlockers.every((blocker) => blocker.status === "blocked"),
  "P5-P10 audit artifact must keep every external blocker blocked",
);
assert(
  p5P10InternalAudit.evidence?.screenshots?.every((screenshot) => screenshot.exists && screenshot.bytes > 10_000),
  "P5-P10 audit artifact must include non-empty simulator screenshots",
);
assert.equal(
  p5P10InternalAudit.evidence?.paymentCheckout?.apiIntegration,
  false,
  "P5-P10 audit artifact must record payment checkout preparation as API-free",
);
assert.equal(
  p5P10InternalAudit.evidence?.paymentCheckout?.safeAreaFix?.file,
  "member-checkout-safearea.jpg",
  "P5-P10 audit artifact must include payment checkout safe-area evidence",
);
assert(
  p5P10InternalAudit.evidence?.paymentCheckout?.screenshotFiles?.includes("guardian-checkout-ready.jpg"),
  "P5-P10 audit artifact must include guardian checkout preparation evidence",
);
assert(
  p5P10InternalAudit.guardedAssertions?.includes(
    "결제 준비 흐름은 내부 화면까지만 확인하며 외부 PG/API 연결 완료로 보지 않음",
  ),
  "P5-P10 audit artifact must keep the payment provider/API boundary explicit",
);
for (const snippet of [
  "P5~P10 내부 readiness audit",
  "p5_p10_internal_audit_ready_release_blocked",
  "Release decision: blocked",
  "iOS Simulator 성공을 IPA ready로 보지 않음",
  "결제 준비 흐름은 내부 화면까지만 확인하며 외부 PG/API 연결 완료로 보지 않음",
]) {
  assertIncludes(sources.p5P10InternalAuditMarkdown, snippet, "P5-P10 audit markdown");
}

const visibleTextAuditRecheckResults = visibleTextAuditRecheck.results ?? [];
const adminAuditLogRecheck = visibleTextAuditRecheckResults.find(
  (result) => result.role === "admin" && result.route === "/app/admin/audit-logs",
);
const coachMembersRecheck = visibleTextAuditRecheckResults.find(
  (result) => result.role === "coach" && result.route === "/app/members",
);

assert(adminAuditLogRecheck, "visible text recheck must include admin change record route");
assert(coachMembersRecheck, "visible text recheck must include coach member route");
assert.equal(adminAuditLogRecheck.blank, false, "admin change record recheck must render actual content");
assert.equal(coachMembersRecheck.blank, false, "coach members recheck must render actual content");
assert.equal(adminAuditLogRecheck.messages?.length ?? 0, 0, "admin change record recheck must have no console errors");
assert.equal(coachMembersRecheck.messages?.length ?? 0, 0, "coach members recheck must have no console errors");
assertIncludes(adminAuditLogRecheck.sample ?? "", "변경 기록을 조회했습니다.", "admin change record rendered copy");
assertExcludes(adminAuditLogRecheck.sample ?? "", "감사 로그를 조회했습니다.", "admin change record rendered copy");
for (const snippet of ["상담/주의 메모", "최근 메모 1건 더보기", "작성"]) {
  assertIncludes(coachMembersRecheck.sample ?? "", snippet, "coach members rendered counseling copy");
}
for (const snippet of ["공개 범위", "저장 후 선택한 대상에게 공유됩니다.", "공개된 상담/주의 메모가 없습니다.", "등록된 주의사항 없음", "아직 상담/주의 메모가 없습니다."]) {
  assertExcludes(coachMembersRecheck.sample ?? "", snippet, "coach members rendered stale counseling copy");
}

assert.equal(userVisibleCopyAudit.ok, true, "user visible copy audit must pass");
assert.equal(userVisibleCopyAudit.pageCount, 20, "user visible copy audit must cover owner/coach/member/guardian core routes");
assert(
  userVisibleCopyAudit.pages.every((page) => Array.isArray(page.hits) && page.hits.length === 0),
  "user visible copy audit must not expose banned dummy/internal copy",
);
assert(
  userVisibleCopyAudit.pages.every((page) => page.hasHorizontalOverflow === false),
  "user visible copy audit must not report horizontal overflow",
);

assert.equal(visibleAppCopyStabilityReport.ok, true, "visible app copy stability report must pass");
assert.equal(visibleAppCopyStabilityReport.viewport, "390x844", "visible app copy stability must use mobile viewport");
assert.equal(
  visibleAppCopyStabilityReport.outputCleanup?.outDir,
  ".data/mobile-builds/ios/visible-app-copy-stability",
  "visible app copy stability report must record the cleaned evidence output directory",
);
assert(
  Number.isInteger(visibleAppCopyStabilityReport.outputCleanup?.removedCount) &&
    visibleAppCopyStabilityReport.outputCleanup.removedCount >= 0,
  "visible app copy stability report must record how many stale screenshots were cleaned before the current scan",
);
assert(
  Array.isArray(visibleAppCopyStabilityReport.outputCleanup?.removedFiles),
  "visible app copy stability report must list cleaned output files for evidence traceability",
);
assert.equal(
  visibleAppCopyStabilityReport.outputCleanup.removedFiles.length,
  visibleAppCopyStabilityReport.outputCleanup.removedCount,
  "visible app copy cleanup report must keep removed count and file list in sync",
);
assert(
  !visibleAppCopyStabilityReport.outputCleanup.removedFiles.some((fileName) => fileName.includes("/") || fileName.includes("\\")),
  "visible app copy cleanup report must only list files inside the current evidence directory",
);
assert.equal(
  visibleAppCopyStabilityReport.devDataReset?.before?.attempted,
  true,
  "visible app copy stability must reset local dev data before read-state interactions",
);
assert.equal(
  visibleAppCopyStabilityReport.devDataReset?.after?.attempted,
  true,
  "visible app copy stability must reset local dev data after read-state interactions",
);
assert.equal(
  visibleAppCopyStabilityReport.devDataReset?.noticeMutationSnapshotRestored,
  true,
  "visible app copy stability must restore notice read-state DB snapshots",
);
assert.deepEqual(
  visibleAppCopyStabilityReport.devDataReset?.afterNoticeMutationSnapshot?.noticeReads,
  visibleAppCopyStabilityReport.devDataReset?.beforeNoticeMutationSnapshot?.noticeReads,
  "visible app copy stability report must show no leftover notice read state",
);
assert.deepEqual(
  visibleAppCopyStabilityReport.devDataReset?.afterNoticeMutationSnapshot?.noticeReadAuditLogs,
  visibleAppCopyStabilityReport.devDataReset?.beforeNoticeMutationSnapshot?.noticeReadAuditLogs,
  "visible app copy stability report must show no leftover notice.read audit logs",
);
const visibleAppCopyStabilityScreens = new Map((visibleAppCopyStabilityReport.checked ?? []).map((page) => [page.id, page]));
const authSignupVisibleCopy = visibleAppCopyStabilityScreens.get("auth-signup");
const authSelectRoleVisibleCopy = visibleAppCopyStabilityScreens.get("auth-select-role");

assert(authSignupVisibleCopy, "visible app copy stability must cover phone signup");
assert.equal(
  authSignupVisibleCopy.authRoleShortcutButtonCount,
  0,
  "phone signup submit copy must not be miscounted as a role shortcut",
);
assert(authSelectRoleVisibleCopy, "visible app copy stability must cover select-role");
assert(
  [0, 5].includes(authSelectRoleVisibleCopy.authRoleShortcutButtonCount),
  "select-role visible app copy scan must expose either no production shortcuts or all five development shortcuts",
);
if (authSelectRoleVisibleCopy.authRoleShortcutButtonCount === 5) {
  assert(
    authSelectRoleVisibleCopy.authRoleShortcutButtonMinHeight >= 44,
    "development select-role shortcuts must keep a 44px touch height",
  );
  assert.equal(
    authSelectRoleVisibleCopy.authRoleShortcutButtonText,
    "대표 선택|코치 선택|학부모 선택|회원 선택|총괄 어드민 선택",
    "development select-role scan must measure all role selection buttons",
  );
  assert.equal(
    authSelectRoleVisibleCopy.authSelectRoleProductionCopyVisible,
    false,
    "development select-role must not show production-only login guidance",
  );
} else {
  assert.equal(
    authSelectRoleVisibleCopy.authRoleShortcutButtonText,
    "",
    "production select-role must not expose role shortcut text",
  );
  assert.equal(
    authSelectRoleVisibleCopy.authSelectRoleProductionCopyVisible,
    true,
    "production select-role must explain phone-number account switching",
  );
}
assert(
  authSelectRoleVisibleCopy.authSelectRoleLoginLinkHeight >= 44,
  "select-role visible app copy scan must keep the login link at a 44px touch height",
);
for (const id of ["auth-login", "auth-login-registered", "auth-signup", "auth-reset-password", "auth-invite-accept", "auth-select-role"]) {
  const page = visibleAppCopyStabilityScreens.get(id);

  assert(page, `visible app copy stability must cover ${id}`);
  assert(page.finalWordmarkVisualMinHeight >= 28, `${id} visible app copy scan must keep FINAL wordmark visually readable`);
  assert.equal(page.finalWordmarkLinkCount, 0, `${id} visible app copy scan must not count public auth wordmark as a dashboard link`);
  assert.equal(page.finalWordmarkMinTouchHeight, 0, `${id} visible app copy scan must record explicit 0 dashboard-link touch height`);
}
for (const id of [
  "admin-branches",
  "admin-roles",
	  "admin-audit",
	  "admin-members",
  "admin-notices",
	  "owner-members",
	  "owner-branches",
	  "owner-reports",
  "owner-notices",
  "coach-notices",
	  "member-dashboard",
  "member-classes",
  "member-members",
  "member-payments",
  "member-notices",
  "member-notifications",
  "member-account",
  "guardian-dashboard",
  "guardian-classes",
  "guardian-members",
  "guardian-payments",
  "guardian-notices",
  "guardian-notifications",
  "guardian-account",
]) {
  const page = visibleAppCopyStabilityScreens.get(id);

  assert(page, `visible app copy stability must cover ${id}`);
  assert.equal(page.messageCount, 0, `${id} visible app copy scan must not report console/page errors`);
  assert.equal(page.blockedHitCount, 0, `${id} visible app copy scan must not report dummy/internal copy`);
  assert.equal(page.hasLoadingCopy, false, `${id} visible app copy scan must reach service content`);
  assert(page.finalWordmarkCount > 0, `${id} visible app copy scan must render vector FINAL wordmark`);
  assert(page.finalWordmarkLinkCount > 0, `${id} visible app copy scan must render the FINAL dashboard link`);
  assert(page.finalWordmarkMinTouchHeight >= 44, `${id} visible app copy scan must keep FINAL wordmark touch target`);
  assert(page.finalWordmarkVisualMinHeight >= 28, `${id} visible app copy scan must keep FINAL wordmark visually readable`);
  assert.equal(page.rasterFinalLogoCount, 0, `${id} visible app copy scan must not render raster FINAL logo`);
  if (id.endsWith("-members")) {
    assert.equal(page.memberProfileEmptyAlertCopyCount, 0, `${id} visible app copy scan must hide repeated empty warning copy`);
    assert.equal(page.memberProfileEmptyNoteCopyCount, 0, `${id} visible app copy scan must hide repeated empty counseling/feedback copy`);
  }
  if (page.role === "member" || page.role === "guardian") {
    const isFamilyAccountPage = id === "member-account" || id === "guardian-account";

    assert.equal(page.mobileSessionRailCount, 0, `${id} visible app copy scan must keep the repeated mobile session rail hidden`);
    if (isFamilyAccountPage) {
      assert.equal(page.mobileHeaderLogoutButtonCount, 0, `${id} visible app copy scan must keep logout only in the account action panel`);
      assert.equal(page.accountLogoutButtonCount, 1, `${id} visible app copy scan must keep one account-screen logout action`);
    } else {
      assert.equal(page.mobileHeaderLogoutButtonCount, 1, `${id} visible app copy scan must render one compact header logout action`);
      assert(page.mobileHeaderLogoutButtonHeight >= 44, `${id} visible app copy scan must keep header logout tappable`);
    }
  }
  if (id === "member-account" || id === "guardian-account") {
    assert.equal(page.mobileBottomNavActiveRouteIds, "members", `${id} visible app copy scan must keep the family info bottom-nav item active`);
    assert.equal(page.mobileBottomNavCurrentRouteIds, "members", `${id} visible app copy scan must mark the family info bottom-nav item as current`);
  }
	  if (id === "admin-audit") {
	    assert.equal(page.adminAuditVisibleReadLogCount, 0, "admin audit visible app copy scan must hide read-audit noise by default");
	    assert.equal(page.adminAuditSummaryBarCount, 1, "admin audit visible app copy scan must render one compact summary bar");
	    assert(page.adminAuditSummaryBarHeight >= 44, "admin audit visible app copy scan must keep summary bar readable");
	    assert(page.adminAuditSummaryBarHeight <= 56, "admin audit visible app copy scan must keep summary bar compact");
	    assert(page.adminAuditListRowCount > 0, "admin audit visible app copy scan must render compact log rows");
		    assert(page.adminAuditListRowCount <= 5, "admin audit visible app copy scan must limit default mobile log rows before expansion");
	    assert(page.adminAuditListToggleCount <= 1, "admin audit visible app copy scan must not render duplicate list expansion controls");
	    if (page.adminAuditListToggleCount > 0) {
	      assert(page.adminAuditListToggleHeight >= 44, "admin audit visible app copy scan must keep list expansion control tappable");
	    }
	    assert.equal(page.adminAuditBottomSafeAreaCount, 1, "admin audit visible app copy scan must render one mobile bottom safe-area spacer");
	    assert(page.adminAuditBottomSafeAreaHeight >= 112, "admin audit visible app copy scan must reserve bottom navigation space");
	    assert(page.adminAuditListRowMaxHeight <= 88, "admin audit visible app copy scan must keep payload rows bounded");
	    assert(page.adminAuditNoDetailRowCount > 0, "admin audit visible app copy scan must render compact rows without change details");
	    assert(page.adminAuditNoDetailRowMaxHeight <= 88, "admin audit visible app copy scan must keep no-detail rows compact");
	    assert.equal(page.adminAuditChangeDetailCount, 0, "admin audit visible app copy scan must keep raw change payload collapsed by default");
	    assert(page.adminAuditChangeDetailToggleCount > 0, "admin audit visible app copy scan must render change payload toggles");
	    assert(page.adminAuditChangeDetailToggleMinHeight >= 44, "admin audit visible app copy scan must keep change payload toggles tappable");
	    assert.equal(page.adminAuditBranchMetaVisibleCount, 0, "admin audit visible app copy scan must hide repeated branch/common meta on mobile");
	    assert.equal(page.adminAuditTargetMetaVisibleCount, 0, "admin audit visible app copy scan must hide repeated target meta on mobile");
	    assert(page.adminAuditMobileResultBadgeCount >= page.adminAuditListRowCount, "admin audit visible app copy scan must keep mobile result badges visible");
	    assert.equal(page.adminAuditFilterPanelCount, 1, "admin audit visible app copy scan must render one compact filter panel");
	    assert.equal(page.adminAuditFilterToggleCount, 1, "admin audit visible app copy scan must render one filter toggle");
	    assert(page.adminAuditFilterToggleHeight >= 44, "admin audit visible app copy scan must keep filter toggle tappable");
	    assert.equal(page.adminAuditFilterFieldsVisibleCount, 0, "admin audit visible app copy scan must keep filter fields collapsed by default");
	    assert.equal(page.adminAuditActiveFilterSummaryCount, 1, "admin audit visible app copy scan must show applied filter summary");
	    assert(page.adminAuditActiveFilterChipCount >= 4, "admin audit visible app copy scan must show compact applied filter chips");
	  }
  if (id === "admin-settings") {
    assert.equal(page.adminSettingsSummaryBarCount, 1, "admin settings visible app copy scan must render one compact summary bar");
    assert(page.adminSettingsSummaryBarHeight >= 44, "admin settings visible app copy scan must keep summary readable");
    assert(page.adminSettingsSummaryBarHeight <= 56, "admin settings visible app copy scan must keep summary compact");
    assert.equal(page.adminSettingsReadinessEditorToggleCount, 1, "admin settings visible app copy scan must render one readiness edit toggle");
    assert.equal(page.adminSettingsReadinessListToggleCount, 1, "admin settings visible app copy scan must render one readiness detail toggle");
    assert(page.adminSettingsReadinessListToggleHeight >= 44, "admin settings visible app copy scan must keep readiness detail toggle tappable");
    assert.equal(page.adminSettingsReadinessListCount, 0, "admin settings visible app copy scan must keep readiness details collapsed by default");
    assert.equal(page.adminSettingsReadinessItemCount, 0, "admin settings visible app copy scan must not render readiness item cards by default");
    assert.equal(page.adminSettingsVisibleCodeCount, 0, "admin settings visible app copy scan must not expose command/path code blocks");
    assert.equal(page.adminSettingsVisibleInternalPanelCount, 0, "admin settings visible app copy scan must not expose internal P1-P4/release panels");
    assert.equal(page.adminSettingsReadinessEditorFormCount, 0, "admin settings visible app copy scan must keep readiness forms collapsed by default");
    assert.equal(page.adminSettingsReadinessSummaryCount, 1, "admin settings visible app copy scan must show one compact readiness summary by default");
    assert.equal(
      page.adminSettingsReadinessOpenForbiddenHitCount ?? 0,
      0,
      "admin settings visible app copy scan must keep opened readiness editor free of internal release/readiness wording",
    );
    assert.equal(page.adminSettingsRolePolicySummaryCount, 1, "admin settings visible app copy scan must show one compact role policy summary");
    assert(page.adminSettingsRolePolicySummaryHeight <= 56, "admin settings visible app copy scan must keep role policy summary compact");
    assert.equal(page.adminSettingsRolePolicyDetailCount, 0, "admin settings visible app copy scan must keep role policy detail collapsed by default");
    assert.equal(page.adminSettingsRolePolicyToggleCount, 1, "admin settings visible app copy scan must render one role policy toggle");
    assert(page.adminSettingsRolePolicyToggleHeight >= 44, "admin settings visible app copy scan must keep role policy toggle tappable");
    assert.equal(page.adminSettingsBranchPolicySummaryCount, 1, "admin settings visible app copy scan must show one compact branch policy summary");
    assert(page.adminSettingsBranchPolicySummaryHeight <= 56, "admin settings visible app copy scan must keep branch policy summary compact");
    assert.equal(page.adminSettingsBranchPolicyDetailCount, 0, "admin settings visible app copy scan must keep branch policy detail collapsed by default");
    assert.equal(page.adminSettingsBranchPolicyToggleCount, 1, "admin settings visible app copy scan must render one branch policy toggle");
    assert(page.adminSettingsBranchPolicyToggleHeight >= 44, "admin settings visible app copy scan must keep branch policy toggle tappable");
    assert.equal(page.adminSettingsAuditPolicySummaryCount, 1, "admin settings visible app copy scan must show one compact audit policy summary");
    assert(page.adminSettingsAuditPolicySummaryHeight <= 56, "admin settings visible app copy scan must keep audit policy summary compact");
    assert.equal(page.adminSettingsAuditPolicyDetailCount, 0, "admin settings visible app copy scan must keep audit policy detail collapsed by default");
    assert.equal(page.adminSettingsAuditPolicyToggleCount, 1, "admin settings visible app copy scan must render one audit policy toggle");
    assert(page.adminSettingsAuditPolicyToggleHeight >= 44, "admin settings visible app copy scan must keep audit policy toggle tappable");
    assert.equal(page.adminSettingsServicePolicySummaryCount, 1, "admin settings visible app copy scan must show one compact service policy summary");
    assert(page.adminSettingsServicePolicySummaryHeight <= 72, "admin settings visible app copy scan must keep service policy summary compact");
    assert.equal(page.adminSettingsServicePolicySummaryTileCount, 4, "admin settings visible app copy scan must keep service policy summary at four tiles");
    assert.equal(page.adminSettingsOperatorSummaryCount, 1, "admin settings visible app copy scan must show one compact operator summary");
    assert.equal(page.adminSettingsOperatorSummaryTileCount, 4, "admin settings visible app copy scan must keep operator summary at four tiles");
    assert.equal(page.adminSettingsOperatorDetailToggleCount, 1, "admin settings visible app copy scan must render one operator detail toggle");
    assert(page.adminSettingsOperatorDetailToggleHeight >= 44, "admin settings visible app copy scan must keep operator detail toggle tappable");
    assert.equal(page.adminSettingsOperatorDetailCount, 0, "admin settings visible app copy scan must keep operator details collapsed by default");
    assert.equal(page.adminSettingsOperationCompactSummaryCount, 1, "admin settings visible app copy scan must show one compact operation summary");
    assert.equal(page.adminSettingsOperationDetailToggleCount, 1, "admin settings visible app copy scan must render one operation detail toggle");
    assert(page.adminSettingsOperationDetailToggleHeight >= 44, "admin settings visible app copy scan must keep operation detail toggle tappable");
    assert.equal(page.adminSettingsOperationDetailCount, 0, "admin settings visible app copy scan must keep operation detail collapsed by default");
    assert.equal(page.adminSettingsOperationRecordListCount, 0, "admin settings visible app copy scan must keep operation records collapsed by default");
    assert.equal(page.adminSettingsOperationLogToggleCount, 1, "admin settings visible app copy scan must render one operation log toggle");
    assert.equal(page.adminSettingsOperationLogFormCount, 0, "admin settings visible app copy scan must keep operation log form collapsed by default");
    assert.equal(page.adminSettingsOperationLogSummaryCount, 1, "admin settings visible app copy scan must show one operation log summary");
    assert(page.adminSettingsOperationLogSummaryHeight >= 44, "admin settings visible app copy scan must keep operation log summary at a stable 44px rail");
    assert(page.adminSettingsOperationLogSummaryHeight <= 52, "admin settings visible app copy scan must keep operation log summary compact");
    assert(
      !String(page.adminSettingsOperationLogSummaryText ?? "").includes("입력이 필요할 때만"),
      "admin settings visible app copy scan must not show operation log helper copy",
    );
    assert.equal(page.adminSettingsIncidentCreateToggleCount, 1, "admin settings visible app copy scan must render one incident create toggle");
    assert.equal(page.adminSettingsIncidentCreateFormCount, 0, "admin settings visible app copy scan must keep incident create form collapsed by default");
    assert.equal(page.adminSettingsIncidentCreateSummaryCount, 1, "admin settings visible app copy scan must show one incident summary");
    assert(page.adminSettingsIncidentCreateSummaryHeight >= 44, "admin settings visible app copy scan must keep incident summary at a stable 44px rail");
    assert(page.adminSettingsIncidentCreateSummaryHeight <= 52, "admin settings visible app copy scan must keep incident create summary compact");
    assert(
      !String(page.adminSettingsIncidentCreateSummaryText ?? "").includes("새 현장 이슈가 생겼을 때만"),
      "admin settings visible app copy scan must not show incident helper copy",
    );
    assert.equal(page.adminSettingsIncidentListToggleCount, 1, "admin settings visible app copy scan must render one incident list toggle");
    assert(page.adminSettingsIncidentListToggleHeight >= 44, "admin settings visible app copy scan must keep incident list toggle tappable");
    assert.equal(page.adminSettingsIncidentListSummaryCount, 1, "admin settings visible app copy scan must show one compact incident list summary");
    assert.equal(page.adminSettingsIncidentEditorFormCount, 0, "admin settings visible app copy scan must keep incident editor forms collapsed by default");
    assert(page.adminSettingsReadinessOpenScreenshotSizeBytes > 10_000, "admin settings visible app copy scan must capture readiness editor open state");
    assert(page.adminSettingsOperationOpenScreenshotSizeBytes > 10_000, "admin settings visible app copy scan must capture operation log open state");
    assert(page.adminSettingsIncidentCreateOpenScreenshotSizeBytes > 10_000, "admin settings visible app copy scan must capture incident create open state");
    if (page.adminSettingsIncidentEditorToggleCount > 0) {
      assert(page.adminSettingsIncidentEditorOpenScreenshotSizeBytes > 10_000, "admin settings visible app copy scan must capture incident editor open state");
    }
  }
  if (id === "owner-dashboard") {
    assert(page.ownerDashboardGraphBoardHeight <= 205, "owner dashboard visible app copy scan must keep top graph board compact enough to surface branch comparison");
    assert.equal(page.ownerDashboardSecondaryGraphGridCount, 1, "owner dashboard visible app copy scan must render one compact secondary graph grid");
    assert.equal(page.ownerDashboardGraphRowCount, 4, "owner dashboard visible app copy scan must show four priority secondary graph rows without clipping");
    assert(page.ownerDashboardSecondaryGraphGridHeight <= 122, "owner dashboard visible app copy scan must keep secondary graph grid readable in two columns");
    assert.equal(page.ownerDashboardGraphLabelOverflow, 0, "owner dashboard visible app copy scan must keep graph labels unclipped");
    assert(page.ownerDashboardRiskSummaryTop > 0, "owner dashboard visible app copy scan must render the risk summary");
    assert(page.ownerDashboardRiskSummaryTop <= 640, "owner dashboard visible app copy scan must surface risk summary before the bottom navigation zone");
    assert.equal(page.ownerDashboardRiskSummaryBottomNavOverlap, 0, "owner dashboard visible app copy scan must keep risk summary above the bottom nav");
    assert.equal(page.ownerDashboardDetailToggleCount, 1, "owner dashboard visible app copy scan must render one detail toggle");
    assert(page.ownerDashboardDetailToggleHeight >= 44, "owner dashboard visible app copy scan must keep the detail toggle tappable");
    assert.equal(page.ownerDashboardDetailToggleBottomNavOverlap, 0, "owner dashboard visible app copy scan must keep the detail toggle above the bottom nav");
    assert(
      page.ownerDashboardDetailToggleBottomNavClearance >= 16,
      "owner dashboard visible app copy scan must keep detail toggle clearance above the bottom nav",
    );
    assert.equal(page.ownerBranchComparisonRowBottomNavOverlap, 0, "owner dashboard visible app copy scan must keep branch comparison rows above the bottom nav");
    assert(
      page.ownerBranchComparisonRowBottomNavClearance >= 24,
      "owner dashboard visible app copy scan must keep branch comparison row clearance above the bottom nav",
    );
    assert.equal(page.ownerBranchComparisonCardBottomNavOverlap, 0, "owner dashboard visible app copy scan must keep branch comparison card above the bottom nav");
    assert(
      page.ownerBranchComparisonCardBottomNavClearance >= 24,
      "owner dashboard visible app copy scan must keep branch comparison card clearance above the bottom nav",
    );
    assert.equal(page.ownerBranchMetricGridCount, page.ownerBranchComparisonRowCount, "owner dashboard visible app copy scan must render compact metric grids per branch");
    assert(page.ownerBranchComparisonRowMaxHeight <= 108, "owner dashboard visible app copy scan must keep branch comparison rows compact");
    assert(page.ownerBranchMetricGridMaxHeight >= 32, "owner dashboard visible app copy scan must keep branch metric grids readable");
    assert(page.ownerBranchMetricGridMaxHeight <= 40, "owner dashboard visible app copy scan must keep branch metric grids compact");
  }
		  if (id === "owner-reports") {
        assert.equal(page.ownerReportTrendSummaryGridCount, 1, "owner reports visible app copy scan must render compact trend summary");
        assert.equal(page.ownerReportTrendSummaryRowCount, 4, "owner reports visible app copy scan must render four trend summary graph rows");
        assert(page.ownerReportTrendSummaryGridHeight <= 106, "owner reports visible app copy scan must keep trend summary graph rail compact");
        assert(page.ownerReportTrendSummaryRowMaxHeight <= 24, "owner reports visible app copy scan must keep trend summary rows compact");
        assert(page.ownerReportTrendSummaryTileMaxHeight <= 24, "owner reports visible app copy scan must keep trend summary direct rows compact");
        assert(page.ownerReportGraphBoardHeight <= 230, "owner reports visible app copy scan must keep top graph board compact enough for trend content");
        assert.equal(page.ownerReportSecondaryGraphGridCount, 1, "owner reports visible app copy scan must render compact secondary graph grid");
        assert.equal(page.ownerReportSecondaryGraphTileCount, 3, "owner reports visible app copy scan must show three priority KPI graph tiles by default");
        assert(page.ownerReportSecondaryGraphGridHeight >= 92, "owner reports visible app copy scan must use readable two-column KPI tiles");
        assert(page.ownerReportSecondaryGraphGridHeight <= 128, "owner reports visible app copy scan must keep the two-column KPI tiles compact");
        assert(page.ownerReportSecondaryGraphTileMinWidth >= 140, "owner reports visible app copy scan must not regress to narrow four-column KPI cells");
        assert.equal(page.ownerReportSecondaryGraphLabelOverflow, 0, "owner reports visible app copy scan must keep graph labels unclipped");
        assert.equal(page.ownerReportSecondaryGraphOverflow, 0, "owner reports visible app copy scan must avoid horizontal secondary graph scrolling");
        assert.equal(page.ownerReportSecondaryGraphToggleCount, 1, "owner reports visible app copy scan must expose the secondary graph more button");
        assert.equal(page.ownerReportSecondaryGraphToggleText, "유지·공지", "owner reports visible app copy scan must name hidden KPI lanes");
        assert(page.ownerReportSecondaryGraphToggleHeight >= 44, "owner reports visible app copy scan must keep secondary graph more button tappable");
        assert.equal(page.ownerReportTrendGraphCount, 1, "owner reports visible app copy scan must render compact mobile trend graph");
        assert(page.ownerReportTrendGraphRowCount > 0, "owner reports visible app copy scan must render mobile trend rows");
        assert(page.ownerReportTrendGraphRowCount <= 2, "owner reports visible app copy scan must limit mobile trend rows by default");
        if (page.ownerReportTrendGraphToggleCount > 0) {
          assert(page.ownerReportTrendGraphToggleHeight >= 44, "owner reports visible app copy scan must keep trend graph toggle tappable");
        }
		    assert(page.ownerReportBranchGraphCount > 0, "owner reports visible app copy scan must render branch operation graphs");
		    assert(page.ownerReportBranchGraphCount <= 1, "owner reports visible app copy scan must show only the priority branch graph by default");
	    assert(page.ownerReportVisibleControlMinHeight >= 44, "owner reports visible app copy scan must keep all visible controls tappable");
        assert(page.ownerReportBranchGraphRowMaxHeight <= 24, "owner reports visible app copy scan must keep branch graph rows compact");
        assert(page.ownerReportBranchGraphMaxHeight <= 130, "owner reports visible app copy scan must keep branch operation graphs compact on mobile");
        if (page.ownerReportBranchGraphToggleCount > 0) {
          assert(page.ownerReportBranchGraphToggleHeight >= 44, "owner reports visible app copy scan must keep the branch graph toggle tappable");
        }
        assert(page.ownerActionQueueItemCount <= 1, "owner reports visible app copy scan must show only the top priority action row by default");
        assert(page.ownerActionQueueItemMaxHeight <= 52, "owner reports visible app copy scan must keep action rows compact");
        assert(page.ownerActionQueueHeight <= 125, "owner reports visible app copy scan must keep the action queue compact on mobile");
        if (page.ownerActionQueueToggleCount > 0) {
          assert(page.ownerActionQueueToggleHeight >= 44, "owner reports visible app copy scan must keep the action queue toggle tappable");
        }
        assert(page.ownerReportPriorityBranchRowCount <= 1, "owner reports visible app copy scan must show only one priority branch by default");
        assert(page.ownerReportPriorityBranchRowMaxHeight <= 64, "owner reports visible app copy scan must keep priority branch row compact");
        if (page.ownerReportPriorityBranchToggleCount > 0) {
          assert(page.ownerReportPriorityBranchToggleHeight >= 44, "owner reports visible app copy scan must keep priority branch toggle tappable");
        }
        assert.equal(page.ownerReportRiskPaymentListCount, 0, "owner reports visible app copy scan must keep risk payment detail list collapsed by default");
        if (page.ownerReportRiskPaymentSummaryCount > 0) {
          assert.equal(page.ownerReportRiskPaymentSummaryCount, 1, "owner reports visible app copy scan must show one compact risk payment summary");
          assert(page.ownerReportRiskPaymentSummaryMaxHeight <= 56, "owner reports visible app copy scan must keep risk payment summary compact");
          assert.equal(page.ownerReportRiskPaymentToggleCount, 1, "owner reports visible app copy scan must expose one risk payment list toggle");
          assert.equal(page.ownerReportRiskPaymentRowCount, 0, "owner reports visible app copy scan must not render risk payment rows before expansion");
          assert(page.ownerReportRiskPaymentToggleHeight >= 44, "owner reports visible app copy scan must keep risk payment toggle tappable");
        }
        assert.equal(page.ownerReportInternalPanelCount, 0, "owner reports visible app copy scan must not expose internal P3 operation panels");
        assert.equal(page.ownerReportVisibleCodeCount, 0, "owner reports visible app copy scan must not expose code-style operation checks");
		    assert.equal(
		      page.ownerReportBranchGraphRowCount,
	      page.ownerReportBranchGraphCount * 4,
	      "owner reports visible app copy scan must render four branch graph rows per branch",
	    );
		  }
		  if (id === "admin-users") {
		    assert.equal(page.adminUserSummaryGridCount, 1, "admin users visible app copy scan must render compact summary grid");
		    assert.equal(page.adminUserMobileScopeSummaryCount, 0, "admin users visible app copy scan must hide repeated mobile scope summaries");
	    assert(page.adminUserProtectedDeleteRowCount > 0, "admin users visible app copy scan must keep protected account delete rules");
	    assert.equal(page.adminUserProtectedDeleteToggleCount, 0, "admin users visible app copy scan must hide protected account delete toggles");
	    assert.equal(page.adminUserDisabledDeleteToggleCount, 0, "admin users visible app copy scan must not render disabled delete toggles");
	    assert(page.adminUserEnabledDeleteToggleCount > 0, "admin users visible app copy scan must keep removable account delete toggles enabled");
	    assert(page.adminUserDeleteBlockerSummaryCount > 0, "admin users visible app copy scan must keep protected delete reasons in non-visual row metadata");
	    assert(!page.adminUserDeleteBlockerSummaryText.includes("삭제 보호"), "admin users visible app copy scan must not use visible-helper protection wording");
	    assert(page.adminUserDeleteBlockerSummaryText.includes("현재 로그인 계정"), "admin users visible app copy scan must explain self-delete protection");
	    assert(page.adminUserProtectedActionStackMaxHeight <= 92, "admin users visible app copy scan must shrink protected rows to edit/reset actions");
	    assert.equal(page.adminUserDeleteBlockerVisibleText ?? "", "", "admin users visible app copy scan must hide visible delete protection helper chips");
	    assert.equal(page.adminUserDeleteBlockerSummaryMaxHeight, 0, "admin users visible app copy scan must keep delete helper chips removed");
	    assert.equal(page.adminUserInvitePanelCount, 0, "admin users visible app copy scan must keep the invite panel collapsed by default");
    assert.equal(page.adminUserInviteToggleText, "초대", "admin users visible app copy scan must keep collapsed invite action compact");
    assert.equal(page.adminUserFirstActionOverlapBottomNavCount, 0, "admin users visible app copy scan must keep first action stack above mobile bottom nav");
    if (page.adminUserBottomNavTop > 0) {
      assert(
        page.adminUserFirstActionStackBottom <= page.adminUserBottomNavTop - 8,
        "admin users visible app copy scan must keep first action stack visually clear of mobile bottom nav",
      );
    }
    // 담당 수업/회원 연결은 삭제를 막지 않고 자동 인계되므로 차단 사유에 나타나면 안 된다.
    assert(!page.adminUserDeleteBlockerSummaryText.includes("담당 수업 연결"), "linked class connections must not block deletion (auto handover)");
    assert(!page.adminUserDeleteBlockerSummaryText.includes("담당 회원 연결"), "linked member connections must not block deletion (auto handover)");
    assert(page.adminUserEditOpenScreenshotSizeBytes > 10_000, "admin users visible app copy scan must capture edit form open state");
    assert(page.adminUserPasswordEditOpenScreenshotSizeBytes > 10_000, "admin users visible app copy scan must capture password edit open state");
    assert(page.adminUserEditShellHeaderTop <= 8, "admin users visible app copy scan must keep the sticky header at the top when edit opens");
    assert(
      page.adminUserEditFormTop <= page.adminUserEditShellHeaderBottom + 220,
      "admin users visible app copy scan must keep the edit form near the sticky header",
    );
    assert(page.adminUserEditFormHeaderGap >= -8, "admin users visible app copy scan must keep the edit form below the sticky header");
    assert(page.adminUserEditPasswordToggleHeight >= 44, "admin users visible app copy scan must keep visible password edit section header tappable");
    assert(page.adminUserEditActionButtonMinHeight >= 44, "admin users visible app copy scan must keep edit form save/cancel actions tappable");
    assert(
      page.adminUserEditActionButtonMaxBottom <= page.adminUserMobileBottomNavTop - 24,
      "admin users visible app copy scan must keep edit form save/cancel actions above the bottom navigation",
    );
    assert(page.adminUserEditActionButtonNavClearance >= 24, "admin users visible app copy scan must keep at least 24px between edit actions and bottom navigation");
    assert.equal(page.adminUserEditCollapsedPasswordSectionCount, 0, "admin users visible app copy scan must not use a separate collapsed password section");
    assert.equal(page.adminUserEditCollapsedPasswordInputCount, 0, "admin users visible app copy scan must not keep hidden password inputs behind a toggle");
    assert.equal(page.adminUserEditOpenPasswordSectionCount, 1, "admin users visible app copy scan must render one visible password edit section in the edit form");
    assert.equal(page.adminUserEditOpenPasswordInputCount, 2, "admin users visible app copy scan must render password and confirmation inputs in the edit form");
    assert.equal(page.adminUserEditOpenPasswordInputMinLength, "12|12", "admin users visible app copy scan must keep password edit minimum length");
    assert(page.adminUserSeedEmailEditScreenshotSizeBytes > 10_000, "admin users visible app copy scan must capture seed email edit state");
    assert.equal(page.adminUserSeedEmailTestDomainInputCount, 0, "admin users visible app copy scan must keep .test seed emails out of edit forms");
    assert.equal(page.adminUserSeedEmailFinalJudoKrInputCount, 1, "admin users visible app copy scan must keep the current finaljudo.kr seed email editable");
    assert(page.adminUserEditHashDeepLinkScreenshotSizeBytes > 10_000, "admin users visible app copy scan must capture edit hash deep link state");
    assert.equal(page.adminUserEditHashDeepLinkLocationHash, "#edit-user-owner", "admin users visible app copy scan must preserve edit hash deep link");
    assert.equal(page.adminUserEditHashDeepLinkFormCount, 1, "admin users visible app copy scan must open owner edit form from hash deep link");
    assert(page.adminUserEditHashDeepLinkShellHeaderTop <= 8, "admin users visible app copy scan must keep hash edit header at the top");
    assert(
      page.adminUserEditHashDeepLinkFormTop <= page.adminUserEditHashDeepLinkShellHeaderBottom + 220,
      "admin users visible app copy scan must keep hash edit form near the sticky header",
    );
    assert(page.adminUserEditHashDeepLinkFormHeaderGap >= -8, "admin users visible app copy scan must keep hash edit form below the sticky header");
    assert.equal(page.adminUserEditHashDeepLinkPasswordSectionCount, 1, "admin users visible app copy scan must show password section from hash deep link");
    assert.equal(page.adminUserEditHashDeepLinkPasswordInputCount, 2, "admin users visible app copy scan must show password inputs from hash deep link");
    assert.equal(page.adminUserEditHashDeepLinkTestDomainEmailInputCount, 0, "admin users visible app copy scan must keep .test seed emails out of hash deep link edit forms");
    assert.equal(
      page.adminUserEditHashDeepLinkFinalJudoKrEmailInputCount,
      1,
      "admin users visible app copy scan must keep the current finaljudo.kr seed email editable from hash deep links",
    );
    assert(page.adminUserEmptyFilterScreenshotSizeBytes > 10_000, "admin users visible app copy scan must capture the empty filter state");
    assert.equal(page.adminUserEmptyFilterStateCount, 1, "admin users visible app copy scan must show one empty state for unmatched filters");
    assert.equal(page.adminUserEmptyFilterRowCount, 0, "admin users visible app copy scan must hide stale rows for unmatched filters");
    assert.equal(page.adminUserEmptyFilterResetButtonCount, 1, "admin users visible app copy scan must expose empty filter reset");
    assert.equal(page.adminUserEmptyFilterClearButtonCount, 1, "admin users visible app copy scan must expose search clear action");
    assert(page.adminUserEmptyFilterLocationSearch.includes("q="), "admin users visible app copy scan must persist query filters in the URL");
	  }
  if (id === "admin-branches") {
    assert.equal(page.adminBranchSummaryGridCount, 1, "admin branches visible app copy scan must render compact summary grid");
    assert(page.adminBranchSummaryGridHeight >= 44, "admin branches visible app copy scan must keep summary readable as compact cards");
    assert(page.adminBranchSummaryGridHeight <= 48, "admin branches visible app copy scan must keep summary as a compact two-thirds card row");
    assert(page.adminBranchSummaryGridWidth <= 272, "admin branches visible app copy scan must keep summary near two-thirds width on mobile");
    assert(page.adminBranchSummaryText.includes("운영 중"), "admin branches visible app copy scan must show active branch summary");
    assert(!page.adminBranchSummaryText.includes("운영 현황"), "admin branches visible app copy scan must hide ambiguous operations summary");
    assert(!/\d+\s*\/\s*\d+/.test(page.adminBranchActiveSummaryText), "admin branches visible app copy scan must not show member/class slash count");
    assert.equal(page.adminBranchCreateFormCount, 0, "admin branches visible app copy scan must keep create form collapsed by default");
    assert(page.adminBranchCreatePanelHeight <= 48, "admin branches visible app copy scan must keep create panel as a compact action bar with a 44px touch target");
    assert(page.adminBranchCreatePanelWidth <= 272, "admin branches visible app copy scan must keep create panel near two-thirds width on mobile");
    assert.equal(page.adminBranchCreateToggleCount, 1, "admin branches visible app copy scan must render create toggle");
    assert(page.adminBranchCreateToggleHeight >= 44, "admin branches visible app copy scan must keep create toggle tappable");
    assert(page.adminBranchCreateOpenScreenshotSizeBytes > 10_000, "admin branches visible app copy scan must capture the opened create form");
    assert(
      page.adminBranchCreateOpenPanelWidth > page.adminBranchCreatePanelWidth + 40,
      "admin branches visible app copy scan must expand the create panel when the form is open",
    );
    assert(page.adminBranchCreateOpenPanelHeight <= 160, "admin branches visible app copy scan must keep opened create panel as a compact two-row mobile form");
    assert(page.adminBranchCreateOpenFormHeight <= 112, "admin branches visible app copy scan must keep opened create form compact");
    assert(page.adminBranchCreateOpenMinFieldWidth >= 104, "admin branches visible app copy scan must keep opened create fields readable on narrow mobile");
    assert(page.adminBranchCreateOpenSubmitButtonHeight >= 44, "admin branches visible app copy scan must keep create submit tappable");
    assert(page.adminBranchSettingsOpenScreenshotSizeBytes > 10_000, "admin branches visible app copy scan must capture the opened settings form");
    assert(page.adminBranchSettingsOpenFormHeight <= 204, "admin branches visible app copy scan must keep opened settings form compact");
    assert(page.adminBranchSettingsOpenCardHeight <= 280, "admin branches visible app copy scan must keep opened settings card compact");
    assert.equal(page.adminBranchSettingsOpenDetailGridCount, 0, "admin branches visible app copy scan must hide repeated summary tiles while settings editor is open");
    assert(page.adminBranchSettingsOpenFieldGridHeight <= 92, "admin branches visible app copy scan must keep settings fields in two compact rows with inline labels");
    assert(page.adminBranchSettingsOpenFieldGridMinControlHeight >= 44, "admin branches visible app copy scan must keep settings input/select controls tappable");
    assert(page.adminBranchSettingsOpenFieldGridMinControlWidth >= 100, "admin branches visible app copy scan must keep settings controls readable on narrow mobile");
    assert(page.adminBranchSettingsOpenPolicyControlHeight >= 44, "admin branches visible app copy scan must keep settings policy toggle tappable");
    assert(page.adminBranchSettingsOpenSaveHeight >= 44, "admin branches visible app copy scan must keep settings save action tappable");
    assert(page.adminBranchSettingsOpenSaveBottom <= 760, "admin branches visible app copy scan must keep settings save action above bottom nav");
    assert(page.adminBranchCardCount > 0, "admin branches visible app copy scan must render compact branch cards");
    assert(page.adminBranchCardMaxHeight <= 260, "admin branches visible app copy scan must keep branch cards compact on mobile");
    assert(page.adminBranchDetailGridCount > 0, "admin branches visible app copy scan must render compact detail grids");
    assert(page.adminBranchDetailGridMaxHeight <= 96, "admin branches visible app copy scan must keep detail grids compact on mobile");
    assert.equal(page.adminBranchActionGridCount, page.adminBranchCardCount, "admin branches visible app copy scan must render one action row per branch card");
    assert(page.adminBranchActionGridMaxHeight <= 72, "admin branches visible app copy scan must keep action rows compact");
    assert.equal(page.adminBranchOwnerFormCount, 0, "admin branches visible app copy scan must keep owner forms collapsed by default");
    assert(page.adminBranchOwnerToggleCount > 0, "admin branches visible app copy scan must render owner toggles");
    assert(page.adminBranchOwnerToggleMinHeight >= 44, "admin branches visible app copy scan must keep owner toggles tappable");
    assert.equal(page.adminBranchSettingsFormCount, 0, "admin branches visible app copy scan must keep settings forms collapsed by default");
    assert(page.adminBranchSettingsToggleCount > 0, "admin branches visible app copy scan must render settings toggles");
    assert(page.adminBranchSettingsToggleMinHeight >= 44, "admin branches visible app copy scan must keep settings toggles tappable");
  }
  if (id === "admin-roles") {
    assert.equal(page.adminRoleSummaryGridCount, 1, "admin roles visible app copy scan must render compact summary grid");
    assert(page.adminRoleSummaryGridHeight >= 44, "admin roles visible app copy scan must keep summary readable");
    assert(page.adminRoleSummaryGridHeight <= 56, "admin roles visible app copy scan must keep summary compact");
    assert.equal(page.adminRoleInvitePanelCount, 1, "admin roles visible app copy scan must render one compact invite panel");
    assert(page.adminRoleInvitePanelHeight <= 56, "admin roles visible app copy scan must keep invite panel compact");
    assert(page.adminRoleInvitePanelWidth <= 276, "admin roles visible app copy scan must keep invite panel near two-thirds width");
    assert(page.adminRoleInvitePanelText.includes("열기"), "admin roles visible app copy scan must show a short invite open action");
    assert.equal(page.adminRoleInviteFormCount, 0, "admin roles visible app copy scan must keep invite form collapsed by default");
    assert.equal(page.adminRoleInviteToggleCount, 1, "admin roles visible app copy scan must render invite toggle");
    assert(page.adminRoleInviteToggleHeight >= 44, "admin roles visible app copy scan must keep invite toggle touch target");
    assert(page.adminRoleUserRowCount > 0, "admin roles visible app copy scan must render compact user rows");
    assert.equal(page.adminRoleActionRowCount, page.adminRoleUserRowCount, "admin roles visible app copy scan must render one action row per user");
    assert(page.adminRoleActionRowMaxWidth <= 140, "admin roles visible app copy scan must keep mobile action row compact");
    assert.equal(page.adminRoleManagementScopeVisibleCount, 0, "admin roles visible app copy scan must hide management scope copy on mobile");
    assert.equal(page.adminRoleBranchScopeVisibleCount, 0, "admin roles visible app copy scan must hide branch scope copy on mobile");
    assert.equal(page.adminRoleEditFormCount, 0, "admin roles visible app copy scan must keep per-user edit forms collapsed by default");
    assert(page.adminRoleEditToggleCount > 0, "admin roles visible app copy scan must render per-user edit toggles");
    assert(page.adminRoleEditToggleMinHeight >= 44, "admin roles visible app copy scan must keep per-user edit toggles tappable");
    assert.equal(page.adminRolePermissionSummaryCount, 1, "admin roles visible app copy scan must render one permission summary");
    assert.equal(page.adminRolePermissionSummaryRowCount, 3, "admin roles visible app copy scan must render permission summary rows");
    assert.equal(page.adminRolePermissionDetailToggleCount, 1, "admin roles visible app copy scan must render permission detail toggle");
    assert(page.adminRolePermissionDetailToggleHeight >= 44, "admin roles visible app copy scan must keep permission detail toggle tappable");
    assert.equal(page.adminRolePermissionDetailVisibleCount, 0, "admin roles visible app copy scan must keep mobile permission detail collapsed");
    assert.equal(page.adminRoleProtectionSummaryCount, 0, "admin roles visible app copy scan must hide account-protection helper cards");
    assert.equal(page.adminRoleProtectionStatusCount, 0, "admin roles visible app copy scan must hide account-protection status chips");
    assert.equal(page.adminRoleProtectionCancelCount, 0, "admin roles visible app copy scan must hide account-protection cancel helpers");
    assert.equal(page.adminRoleProtectionLongCopyPresent, false, "admin roles visible app copy scan must hide long account protection helper copy");
    assert.equal(
      page.adminRoleRecentChangeListCount + page.adminRoleRecentChangeEmptyCount,
      1,
      "admin roles visible app copy scan must render exactly one recent account-change list or empty state",
    );
    if (page.adminRoleRecentChangeListCount === 1) {
      assert(page.adminRoleRecentChangeRowCount > 0, "admin roles visible app copy scan must render recent account-change rows");
      assert(page.adminRoleRecentChangeRowCount <= 1, "admin roles visible app copy scan must show only the latest account-change row by default");
      assert(page.adminRoleRecentChangeSectionHeight <= 120, "admin roles visible app copy scan must keep recent account changes compact");
      assert.equal(page.adminRoleRecentChangeToggleCount, 1, "admin roles visible app copy scan must render one recent account-change expansion control");
      assert(page.adminRoleRecentChangeToggleHeight >= 44, "admin roles visible app copy scan must keep recent account-change toggle tappable");
    }
  }
  if (id === "member-payments" || id === "guardian-payments") {
    assert.equal(page.memberPaymentFilterChipGroupCount, 1, `${id} visible app copy scan must render compact payment filter chips`);
    assert.equal(page.memberPaymentFilterChipCount, 3, `${id} visible app copy scan must render only the three family payment filter chips`);
    assert.equal(page.memberPaymentFilterChipCountLabelCount, 3, `${id} visible app copy scan must show counts inside the filter chips`);
    assert(page.memberPaymentFilterChipMinHeight >= 44, `${id} visible app copy scan must keep payment filter chips at a 44px touch height`);
    assert.equal(page.memberPaymentFilterStatusCount, 0, `${id} visible app copy scan must not render a separate payment count badge`);
    assert.equal(page.memberPaymentFilterHeadingCount, 0, `${id} visible app copy scan must not render a visible payment filter heading`);
    assert(page.memberPaymentFilterChipGroupHeight <= 52, `${id} visible app copy scan must keep payment filters compact as one segmented control`);
    assert.equal(page.memberPaymentFilterLargeSummaryCount, 0, `${id} visible app copy scan must not render a repeated payment count row`);
    assert.equal(page.memberPaymentFilterSelectCount, 0, `${id} visible app copy scan must not render the large payment filter select`);
    assert(page.memberPaymentCompactCardCount > 0, `${id} visible app copy scan must render compact payment cards`);
    assert.equal(page.memberPaymentDateLineCount, page.memberPaymentCompactCardCount, `${id} visible app copy scan must render one due/expires line per payment`);
    assert(page.memberPaymentDateLineMaxHeight >= 44, `${id} visible app copy scan must keep payment date lines at a stable scan height`);
    assert(page.memberPaymentDateLineMaxHeight <= 48, `${id} visible app copy scan must keep payment date lines compact`);
    assert(
      (page.memberPaymentCheckoutActionTexts ?? []).some((text) => String(text).includes("납부 정보 확인")),
      `${id} visible app copy scan must show payment-info confirmation copy on checkout actions`,
    );
    assert(
      (page.memberPaymentCheckoutActionTexts ?? []).every((text) => !String(text).includes("결제하기")),
      `${id} visible app copy scan must not show live-payment approval copy on checkout actions`,
    );
    assert.equal(
      page.memberPaymentCheckoutLinkCardCount,
      page.memberPaymentCheckoutActionCount,
      `${id} visible app copy scan must make exactly the payable payment cards act as links`,
    );
    assert.equal(
      page.memberPaymentCheckoutActionInLinkCardCount,
      page.memberPaymentCheckoutActionCount,
      `${id} visible app copy scan must keep checkout actions inside whole-card links`,
    );
    assert.equal(
      page.memberPaymentCheckoutStateBadgeInLinkCardCount,
      0,
      `${id} visible app copy scan must keep blocked checkout badges outside link cards`,
    );
    assert.equal(
      page.memberPaymentBlockedCheckoutLinkCardCount,
      0,
      `${id} visible app copy scan must not expose blocked checkout states as whole-card links`,
    );
    assert(page.memberPaymentCompactCardMaxHeight <= 130, `${id} visible app copy scan must keep payment cards compact`);
    assert.equal(page.memberPaymentCompactAmountTextCount, 0, `${id} visible app copy scan must not expose compact payment amounts`);
  }
  if (id === "member-notices" || id === "guardian-notices") {
    assert.equal(page.mobileBottomNavNoticeLabel, "공지", `${id} visible app copy scan must label the active notices tab as 공지`);
    assert.equal(page.mobileBottomNavNoticeHref, "/app/notices", `${id} visible app copy scan must keep the active notices tab on /app/notices`);
    assert.equal(page.familyNoticeCompactFilterBarCount, 1, `${id} visible app copy scan must render compact family notice filter bar`);
    assert(page.familyNoticeCompactFilterBarHeight <= 72, `${id} visible app copy scan must keep family notice toolbar compact`);
    assert.equal(page.familyNoticeFilterGridColumnCount, 4, `${id} visible app copy scan must keep family notice toolbar in four fixed columns`);
    assert(page.familyNoticeFilterButtonMinHeight >= 44, `${id} visible app copy scan must keep family notice toolbar tappable`);
    assert.equal(page.familyNoticeFilterOverflow, 0, `${id} visible app copy scan must avoid family notice toolbar overflow`);
    assert.equal(page.familyNoticeStatusBadgeCount, 0, `${id} visible app copy scan must hide the redundant family notice status badge`);
    assert(page.familyNoticeCardCount > 0, `${id} visible app copy scan must render compact family notice cards`);
    assert(page.familyNoticeCardMaxHeight <= 132, `${id} visible app copy scan must keep family notice cards scan-friendly`);
    assert(page.familyNoticeBodyMaxHeight <= 44, `${id} visible app copy scan must keep family notice previews compact and tappable`);
    if (page.familyNoticeDetailToggleCount > 0) {
      assert(page.familyNoticeDetailToggleMinHeight >= 44, `${id} visible app copy scan must keep family notice detail toggles tappable`);
    }
    if (id === "guardian-notices") {
      assert(page.familyNoticeDetailToggleCount > 0, `${id} visible app copy scan must keep long notices expandable from content`);
      assert.equal(page.noticeExpandButtonCount, 0, `${id} visible app copy scan must remove repeated 자세히 buttons`);
    }
    assert.equal(page.familyNoticeDateLineCount, page.familyNoticeCardCount, `${id} visible app copy scan must keep one date/action row per notice`);
    assert.equal(page.noticeReadStateBadgeCount, 0, `${id} visible app copy scan must hide repeated notice read-state badges`);
    assert.equal(page.familyNoticeInboxHeadingCount, 0, `${id} visible app copy scan must not repeat the notice inbox heading`);
    if (id === "member-notices" || id === "guardian-notices") {
      assert.equal(page.notificationPermissionPanelHeight, 0, `${id} visible app copy scan must remove the notification settings card`);
      assert.equal(page.notificationPermissionActionText, "", `${id} visible app copy scan must not show notification settings actions`);
    }
  }
  if (id === "coach-notices") {
    assert.equal(page.mobileBottomNavNoticeLabel, "공지", `${id} visible app copy scan must label the active notices tab as 공지`);
    assert.equal(page.mobileBottomNavNoticeHref, "/app/notices", `${id} visible app copy scan must keep the active notices tab on /app/notices`);
    assert(page.noticeDeliveryCompactCardCount > 0, `${id} visible app copy scan must render scoped publisher notice rows`);
    assert.equal(
      page.noticeDeliveryMetaLineCount,
      page.noticeDeliveryCompactCardCount,
      `${id} visible app copy scan must show delivery/read metadata for publisher rows`,
    );
    assert(page.noticeDeliveryReadActionMinHeight >= 44, `${id} visible app copy scan must keep read actions tappable`);
    assert(page.noticeDeliveryPushActionMinHeight >= 44, `${id} visible app copy scan must keep push actions tappable`);
    assert.equal(page.noticeCreatePanelCount, 1, `${id} visible app copy scan must expose the scoped notice composer`);
    assert.equal(page.noticeCreateToggleCount, 1, `${id} visible app copy scan must expose one composer toggle`);
    assert(page.noticeCreateToggleHeight >= 44, `${id} visible app copy scan must keep composer toggle tappable`);
    assert.equal(page.familyNoticeCompactFilterBarCount, 0, `${id} visible app copy scan must not render family filter bars`);
    assert.equal(page.familyNoticeCardCount, 0, `${id} visible app copy scan must not render family notice cards`);
  }
  if (id === "member-notifications" || id === "guardian-notifications") {
    if (typeof page.notificationsScreenCount === "number") {
      assert.equal(page.notificationsScreenCount, 1, `${id} visible app copy scan must render the dedicated notification inbox`);
      assert.equal(page.noticesScreenCount, 0, `${id} visible app copy scan must not render the notices alias screen`);
      assert.equal(page.mobileBottomNavNoticeLabel, "알림", `${id} visible app copy scan must label the notification inbox tab as 알림`);
      assert.equal(page.mobileBottomNavNoticeHref, "/app/notifications", `${id} visible app copy scan must keep notification inbox tab on /app/notifications`);
      assert.equal(page.notificationSummaryCardCount, 0, `${id} visible app copy scan must not render duplicate notification summary cards`);
      assert(page.notificationInboxCardCount > 0, `${id} visible app copy scan must render notification cards`);
      assert(page.notificationInboxCardMaxHeight <= 132, `${id} visible app copy scan must keep notification rows compact enough for mobile scanning`);
      assert.equal(page.notificationBottomSafeAreaCount, 1, `${id} visible app copy scan must render one mobile bottom safe-area spacer`);
      assert(
        page.notificationBottomActionClearanceAtScrollEnd >= 72,
        `${id} visible app copy scan must keep the bottom notification action above the mobile bottom navigation`,
      );
      assert(
        page.notificationBottomCardClearanceAtScrollEnd >= 96,
        `${id} visible app copy scan must keep the bottom notification card clear of the mobile bottom navigation`,
      );
      assert.equal(page.notificationNoticeKindBadgeCount, 0, `${id} visible app copy scan must hide repeated notice kind badges`);
      if ((page.notificationPaymentCardCount ?? 0) > 0) {
        assert.equal(
          page.notificationPaymentKindBadgeCount,
          page.notificationPaymentCardCount,
          `${id} visible app copy scan must keep payment kind badges for payment follow-ups`,
        );
      }
      if (typeof page.notificationReadNoticeCardCount === "number" && page.notificationReadNoticeCardCount > 0) {
        assert.equal(
          page.notificationReadNoticeCardToneDownCount,
          page.notificationReadNoticeCardCount,
          `${id} visible app copy scan must tone down every confirmed notice card`,
        );
      assert.equal(
        page.notificationReadNoticeBadgeToneDownCount,
        page.notificationReadNoticeCardCount,
        `${id} visible app copy scan must tone down every confirmed notice badge`,
      );
      }
      if (typeof page.notificationNoticeDetailLinkCount === "number") {
        assert.equal(page.notificationNoticeDetailLinkCount, 0, `${id} visible app copy scan must remove repeated notice 보기 buttons`);
      } else {
        assertIncludes(sources.notificationsScreen, 'item.kind !== "notice"', `${id} current source must keep detail buttons off notice alerts`);
      }
      if (typeof page.notificationNoticeContentLinkCount === "number") {
        assert.equal(
          page.notificationNoticeContentLinkCount,
          page.notificationNoticeCardCount,
          `${id} visible app copy scan must keep every notice alert content tappable`,
        );
      } else {
        assertIncludes(sources.notificationsScreen, 'data-testid="notification-notice-content-link"', `${id} current source must keep notice content tappable`);
      }
      assert(page.notificationFollowUpStateBadgeCount > 0, `${id} visible app copy scan must render follow-up states as badges`);
      assert(page.notificationFilterButtonMinHeight >= 44, `${id} visible app copy scan must keep notification filters tappable`);
      if (typeof page.notificationFilterButtonText === "string") {
        assert(page.notificationFilterButtonText.includes("미확인"), `${id} visible app copy scan must keep unread filter visible`);
        assert(!page.notificationFilterButtonText.includes("공지 미확인"), `${id} visible app copy scan must keep unread filter compact`);
      } else {
        assertIncludes(sources.notificationsScreen, 'ariaLabel: "공지 미확인"', `${id} current source must expose notice-only unread scope to assistive tech`);
        assertIncludes(sources.notificationsScreen, 'label: "미확인"', `${id} current source must keep unread filter compact`);
      }
      assert(page.notificationBulkReadButtonHeight >= 44, `${id} visible app copy scan must keep notification read action tappable`);
      if (typeof page.notificationBulkReadButtonText === "string") {
        assert.equal(page.notificationBulkReadButtonText, "읽음 처리", `${id} visible app copy scan must keep the notification read action compact`);
      } else {
        assertIncludes(sources.notificationsScreen, "읽음 처리", `${id} current source must keep the notification read action compact`);
      }
      if (typeof page.notificationBulkReadButtonState === "string") {
        assert.equal(page.notificationBulkReadButtonState, "active", `${id} visible app copy scan must expose active notification read action state before interaction`);
      } else {
        assertIncludes(sources.notificationsScreen, "data-notification-bulk-read-state", `${id} current source must expose active/done notification read action state`);
      }
      if (typeof page.notificationBulkReadButtonDisabled === "boolean") {
        assert.equal(page.notificationBulkReadButtonDisabled, false, `${id} visible app copy scan must keep notification read action enabled while unread notices are visible`);
      }
      if (typeof page.notificationBulkReadButtonAriaLabel === "string") {
        assert(page.notificationBulkReadButtonAriaLabel.includes("공지"), `${id} visible app copy scan must expose notice-only read action scope to assistive tech`);
      } else {
        assertIncludes(sources.notificationsScreen, "notificationBulkReadAriaLabel", `${id} current source must expose notice-only read action scope to assistive tech`);
      }
      if (page.notificationReadActionCount > 0) {
        assert(page.notificationReadActionMinHeight >= 44, `${id} visible app copy scan must keep single notice read actions tappable`);
        assert(
          page.notificationReadActionText.split("|").every((label) => label === "확인"),
          `${id} visible app copy scan must keep single notice action copy compact`,
        );
      }
      assert.equal(page.notificationReadFeedbackCount, 0, `${id} visible app copy scan must keep read feedback hidden before interaction`);
      if (id === "member-notifications") {
        assert(page.notificationPaymentCheckoutLinkCount > 0, `${id} visible app copy scan must deep-link payable payment alerts to checkout preparation`);
      }
      if (page.notificationPaymentCheckoutLinkCount > 0) {
        assert(
          /납부 정보 확인|납부 확인 중|납부 확인|학부모 확인/.test(page.notificationPaymentCheckoutLinkText),
          `${id} visible app copy scan must label payment alert checkout links with payment-info confirmation copy`,
        );
        assert(
          !/결제하기|결제 진행/.test(page.notificationPaymentCheckoutLinkText),
          `${id} visible app copy scan must not imply live payment approval on payment alert links`,
        );
      }
      assert.equal(page.notificationRequestDetailLinkCount, 0, `${id} visible app copy scan must not deep-link deleted request alerts`);
      assert.equal(page.notificationRequestDetailLinkText, "", `${id} visible app copy scan must not label deleted request alerts`);
      assert.equal(page.notificationSettingsJumpHeight, 0, `${id} visible app copy scan must hide the notification settings shortcut`);
      assert.equal(page.notificationSettingsJumpText, "", `${id} visible app copy scan must not show notification settings copy`);
      assert.equal(page.notificationSettingsJumpHref, "", `${id} visible app copy scan must not link to notification permission controls`);
      assert.equal(page.notificationPermissionPanelHeight, 0, `${id} visible app copy scan must remove the notification settings card`);
      assert.equal(page.notificationPermissionStatusChipCount, 0, `${id} visible app copy scan must not show notification permission status chips`);
      assert.equal(page.notificationPermissionActionsHeight, 0, `${id} visible app copy scan must not show notification permission actions`);
      assert.equal(page.notificationPermissionActionText, "", `${id} visible app copy scan must not show notification setting action labels`);
    } else {
      assertIncludes(sources.notificationsScreen, 'data-testid="notifications-screen"', `${id} current source must render the dedicated notification inbox`);
      assertExcludes(sources.notificationsScreen, "notification-summary-card", `${id} current source must avoid duplicate notification summary cards`);
      assertIncludes(sources.notificationsScreen, "notification-inbox-card", `${id} current source must render notification cards`);
      assertIncludes(sources.notificationsScreen, "notification-follow-up-state-badge", `${id} current source must render follow-up states as badges`);
    }
  }
  if (id === "admin-notices" || id === "owner-notices") {
    assert.equal(page.mobileBottomNavActiveRouteIds, "notices", `${id} visible app copy scan must activate the notices bottom-nav item`);
    assert.equal(page.mobileBottomNavCurrentRouteIds, "notices", `${id} visible app copy scan must mark only notices as current in bottom navigation`);
    assert.equal(page.mobileBottomNavNoticeLabel, "공지", `${id} visible app copy scan must label the active notices tab as 공지`);
    assert.equal(page.mobileBottomNavNoticeHref, "/app/notices", `${id} visible app copy scan must keep the active notices tab on /app/notices`);
    assert(page.noticeDeliveryCompactCardCount > 0, `${id} visible app copy scan must render operator notice delivery cards`);
    if (typeof page.noticeDeliveryReadCardCount === "number" && page.noticeDeliveryReadCardCount > 0) {
      assert.equal(
        page.noticeDeliveryReadCardToneDownCount,
        page.noticeDeliveryReadCardCount,
        `${id} visible app copy scan must tone down every read notice delivery card`,
      );
      assert.equal(
        page.noticeDeliveryReadBadgeToneDownCount,
        page.noticeDeliveryReadCardCount,
        `${id} visible app copy scan must tone down every read notice delivery badge`,
      );
    }
    assert(page.noticeDeliveryCompactCardMaxHeight <= 132, `${id} visible app copy scan must keep operator notice delivery cards compact`);
    assert.equal(page.noticeDeliveryBodyVisibleCount, 0, `${id} visible app copy scan must hide operator notice body previews on mobile`);
    assert.equal(page.noticeDeliveryActionRowCount, page.noticeDeliveryCompactCardCount, `${id} visible app copy scan must keep one compact action row per notice`);
    assert(page.noticeDeliveryActionRowMaxHeight <= 44, `${id} visible app copy scan must keep notice actions in one compact mobile icon row`);
    assert(page.noticeDeliveryActionButtonMaxWidth <= 56, `${id} visible app copy scan must keep notice actions compact as icon buttons on mobile`);
    assert(page.noticeDeliveryReadActionMinHeight >= 44, `${id} visible app copy scan must keep read action tappable`);
    assert(page.noticeDeliveryPushActionMinHeight >= 44, `${id} visible app copy scan must keep push action tappable`);
  }
	  if (id === "owner-branches") {
	    assert(page.ownerBranchHealthGraphCount > 0, "owner branches visible app copy scan must render compact branch health graphs");
	    assert.equal(
	      page.ownerBranchHealthRowCount,
	      page.ownerBranchHealthGraphCount * 3,
	      "owner branches visible app copy scan must render three graph rows for each branch after request removal",
	    );
	    assert(page.ownerBranchHealthGraphMaxHeight <= 110, "owner branches visible app copy scan must keep branch health graph as one compact panel");
	    assert(page.ownerBranchHealthRowMaxHeight <= 22, "owner branches visible app copy scan must keep branch health rows slim");
	    assert.equal(
	      page.ownerBranchPolicySummaryCount,
	      page.ownerBranchHealthGraphCount,
      "owner branches visible app copy scan must render one compact policy summary per branch",
    );
    assert.equal(page.ownerBranchPolicyDetailCount, 0, "owner branches visible app copy scan must keep policy details collapsed by default");
    assert.equal(
      page.ownerBranchPolicyToggleCount,
      page.ownerBranchHealthGraphCount,
      "owner branches visible app copy scan must render one policy toggle per branch",
	    );
	    assert(page.ownerBranchPolicyToggleMinHeight >= 44, "owner branches visible app copy scan must keep policy toggles tappable");
	    assert(
	      page.ownerBranchActionLinkCount === page.ownerBranchHealthGraphCount * 2,
	      "owner branches visible app copy scan must render two priority action links per branch by default",
	    );
	    assert(page.ownerBranchActionLinkMinHeight >= 44, "owner branches visible app copy scan must keep action links tappable");
	    assert.equal(
	      page.ownerBranchActionToggleCount,
	      page.ownerBranchHealthGraphCount,
	      "owner branches visible app copy scan must render one action expansion toggle per branch",
	    );
	    assert(page.ownerBranchActionToggleMinHeight >= 44, "owner branches visible app copy scan must keep action toggles tappable");
	    assert.equal(page.ownerBranchBottomSafeAreaCount, 1, "owner branches visible app copy scan must render one mobile bottom safe-area spacer");
	    assert(page.ownerBranchBottomSafeAreaHeight >= 112, "owner branches visible app copy scan must reserve bottom navigation space");
	    assert(
	      page.ownerBranchActionBottomNavClearanceAtScrollEnd >= 24,
	      "owner branches visible app copy scan must keep the last action row clear of the mobile bottom navigation at scroll end",
	    );
	  }
  if (id === "member-members" || id === "guardian-members") {
    assert.equal(page.familyMemberSearchInputCount, 0, `${id} visible app copy scan must hide the staff search header`);
    assert(page.familyMemberProfileCardCount > 0, `${id} visible app copy scan must render compact family profile cards`);
    assert(page.familyMemberFeedbackHeadingCount > 0, `${id} visible app copy scan must label notes as coach feedback`);
	    assert.equal(page.familyMemberFeedbackVisibilityMetaCount, 0, `${id} visible app copy scan must hide staff note visibility metadata`);
	    assert.equal(page.familyMemberWarningHeadingCount, 0, `${id} visible app copy scan must hide the full warning section in family views`);
	    assert.equal(page.familyMemberEmptyAlertCopyCount, 0, `${id} visible app copy scan must hide empty warning copy in family views`);
	    assert(page.familyMemberAlertStripMaxHeight >= 44, `${id} visible app copy scan must keep family alert strips at a stable scan height`);
	    assert(page.familyMemberAlertStripMaxHeight <= 72, `${id} visible app copy scan must keep family alert strips compact`);
	  }
  if (id === "guardian-members") {
    assert(page.familyMemberFeedbackCardCount > 0, "guardian members visible app copy scan must keep guardian-visible coach feedback");
  }
  if (id === "coach-members") {
    assert(page.memberNoteEditorToggleCount > 0, "coach members visible app copy scan must render note editor toggles");
    assert(page.memberNoteEditorToggleMinHeight >= 44, "coach members visible app copy scan must keep note editor toggles tappable");
    assert.equal(page.memberNoteEditorToggleBottomNavOverlapCount, 0, "coach members visible app copy scan must keep note editor toggles clear of the mobile bottom navigation");
    assert.equal(page.memberNoteEditorCount, 0, "coach members visible app copy scan must keep note editors collapsed by default");
    assert(page.coachMemberProfileCardCount > 1, "coach members visible app copy scan must render assigned member cards");
    assert(page.coachVisibleMemberProfileCardCount <= 1, "coach members visible app copy scan must keep mobile default member list short");
    assert.equal(page.coachMemberListToggleCount, 1, "coach members visible app copy scan must render assigned-member expansion control");
    assert(page.coachMemberListToggleMinHeight >= 44, "coach members visible app copy scan must keep assigned-member expansion tappable");
    assert(page.coachMemberListToggleText.includes("담당 회원"), "coach members visible app copy scan must keep assigned-member expansion copy readable");
    assert.equal(page.coachMemberListToggleBottomNavOverlapCount, 0, "coach members visible app copy scan must keep assigned-member expansion clear of the mobile bottom navigation");
    assert(page.coachMemberNoteSectionCount > 0, "coach members visible app copy scan must render note sections");
    assert(page.coachMemberNoteClosedSectionCount > 0, "coach members visible app copy scan must keep note sections closed by default");
    assert.equal(page.coachMemberNoteOpenSectionCount, 0, "coach members visible app copy scan must not open note sections by default");
    assert(page.coachMemberNoteSummaryCount > 0, "coach members visible app copy scan must show compact note summaries");
    assert.equal(page.coachMemberNoteCardCount, 0, "coach members visible app copy scan must hide note detail cards by default");
    assert.equal(page.coachMemberNoteListMaxItems, 0, "coach members visible app copy scan must not render note detail rows by default");
    assert(page.coachMemberNoteListToggleCount > 0, "coach members visible app copy scan must render note view toggles");
    assert(page.coachMemberNoteListToggleMinHeight >= 44, "coach members visible app copy scan must keep note more toggles tappable");
    assert.equal(page.coachMemberEmptyAlertCopyCount, 0, "coach members visible app copy scan must hide repeated empty warning copy");
    assert.equal(page.coachMemberEmptyNoteCopyCount, 0, "coach members visible app copy scan must hide repeated empty counseling copy");
  }
  if (id === "guardian-dashboard") {
    assert.equal(page.guardianChildChipStatusTextCount, 0, "guardian dashboard visible app copy scan must hide repeated child status labels");
    assert.equal(page.guardianLearningInsightGridCount, 1, "guardian dashboard visible app copy scan must render one learning insight grid");
    assert(page.guardianLearningInsightGridHeight <= 122, "guardian dashboard visible app copy scan must keep learning grid dense");
    assert.equal(page.guardianLearningInsightCellCount, 4, "guardian dashboard visible app copy scan must render four learning insight cells");
    assert(page.guardianLearningInsightCellMinHeight >= 56, "guardian dashboard visible app copy scan must keep learning cells tappable");
    assert(page.guardianLearningInsightCellMaxHeight <= 58, "guardian dashboard visible app copy scan must keep learning cells compact");
    assert.equal(page.guardianLearningActionStripCount, 1, "guardian dashboard visible app copy scan must render one learning action strip");
    assert.equal(page.guardianLearningActionLinkCount, 2, "guardian dashboard visible app copy scan must render payment and notification action links");
    assert(page.guardianLearningActionLinkMinHeight >= 44, "guardian dashboard visible app copy scan must keep action links tappable");
    for (const href of ["/app/payments", "/app/notifications"]) {
      assert(page.guardianLearningActionHrefs.includes(href), `guardian dashboard visible app copy scan must keep action href ${href}`);
    }
    assert(
      !page.guardianLearningActionHrefs.some((href) => href.startsWith("/app/payments/checkout?paymentId=pay-jun")),
      "guardian dashboard visible app copy scan must not deep-link completed child payments to checkout preparation",
    );
    for (const label of ["결제", "공지"]) {
      assert(page.guardianLearningActionText.includes(label), `guardian dashboard visible app copy scan must show ${label}`);
    }
    for (const label of [
      "수련 수준 목표",
      "주황띠 노란띠",
      "코치 피드백 최근",
      "1건 코치 피드백 도착",
      "심사결과 통과 안내",
      "대회 참가 안내",
    ]) {
      assert(page.guardianLearningInsightText.includes(label), `guardian dashboard visible app copy scan must keep readable learning text ${label}`);
    }
    for (const gluedLabel of ["수준목표", "주황띠노란띠", "초급코치", "피드백최근", "1건코치", "심사결과통과", "대회참가"]) {
      assert(!page.guardianLearningInsightText.includes(gluedLabel), `guardian dashboard visible app copy scan must not glue learning text ${gluedLabel}`);
    }
    for (const label of ["결제 완료"]) {
      assert(page.guardianLearningActionText.includes(label), `guardian dashboard visible app copy scan must keep readable ${label} copy`);
    }
    assert(/공지 \d+건/.test(page.guardianLearningActionText), "guardian dashboard visible app copy scan must keep readable notice count copy");
    assert(/결제 완료 공지 \d+건/.test(page.guardianLearningActionText), "guardian dashboard visible app copy scan must keep a readable space between action labels");
    assert(!page.guardianLearningActionText.includes("결제·"), "guardian dashboard visible app copy scan must not glue payment status with a dot");
    assert(!page.guardianLearningActionText.includes("공지·"), "guardian dashboard visible app copy scan must not glue notice count with a dot");
    assert(!page.guardianLearningActionText.includes("보강"), "guardian dashboard visible app copy scan must not show deleted request actions");
    assert(
      !page.guardianLearningActionAriaLabels.some((label) => label.includes("보강 요청")),
      "guardian dashboard visible app copy scan must not reintroduce duplicated deleted request aria labels",
    );
  }
  if (id === "member-dashboard") {
    assert.equal(page.memberGuardianPriorityGridCount, 1, "member dashboard visible app copy scan must render one compact priority list");
    assert.equal(page.memberGuardianPriorityCellCount, 4, "member dashboard visible app copy scan must render four priority rows");
    assert(
      !page.memberGuardianPriorityHrefs.some((href) => href.startsWith("/app/requests")),
      "member dashboard visible app copy scan must not expose deleted request links",
    );
    assert(
      page.memberGuardianPriorityHrefs.some((href) => href.startsWith("/app/payments/checkout?paymentId=")),
      "member dashboard visible app copy scan must deep-link payable adult payment priority row to checkout preparation",
    );
    assert.deepEqual(
      page.memberGuardianPriorityLabels,
      ["다음 수업", "출석", "결제 상태", "공지"],
      "member dashboard visible app copy scan must show notice only, not counseling/notice",
    );
    assert(page.memberGuardianPriorityHrefs.includes("/app/notices"), "member dashboard visible app copy scan must always link the notice row to notices");
    assert(
      page.memberGuardianPriorityDetails.some((detail) => /미확인 공지 \d+건|공지 \d+건 모두 확인|도착한 공지 없음/.test(detail)),
      "member dashboard visible app copy scan must keep notice-only detail copy",
    );
    assert(page.memberGuardianPriorityCellMinHeight >= 56, "member dashboard visible app copy scan must keep priority rows stable");
    assert(page.memberGuardianPriorityCellMaxHeight <= 66, "member dashboard visible app copy scan must keep priority rows compact");
  }
  if (id === "member-classes" || id === "guardian-classes") {
    assert.equal(page.personalAttendanceSummaryCount, 0, `${id} visible app copy scan must keep attendance status in inline rows/chips only`);
  }
  if (id === "member-classes") {
    assert(page.familyAttendanceChipGridCount > 0, "member classes visible app copy scan must render compact attendance grids");
    assert(page.familyAttendanceChipCount > 0, "member classes visible app copy scan must render compact attendance chips");
    assert(page.familyClassCardMaxHeight <= 132, "member classes visible app copy scan must keep class cards within the mobile scan height budget");
    assert(page.familyAttendanceChipMinHeight >= 44, "member classes visible app copy scan must keep attendance chips readable");
    assert(page.familyAttendanceChipMaxHeight <= 56, "member classes visible app copy scan must keep attendance chips compact");
  }
  if (id === "guardian-classes") {
    assert(page.familyAttendanceChipGridCount > 0, "guardian classes visible app copy scan must render compact child attendance grids");
    assert(page.familyAttendanceChipCount > 0, "guardian classes visible app copy scan must render compact child attendance chips");
    assert(page.familyClassCardMaxHeight <= 132, "guardian classes visible app copy scan must keep class cards within the mobile scan height budget");
    assert(page.familyAttendanceChipMinHeight >= 44, "guardian classes visible app copy scan must keep child attendance chips readable");
    assert(page.familyAttendanceChipMaxHeight <= 56, "guardian classes visible app copy scan must keep child attendance chips compact");
  }
  if (id === "coach-dashboard") {
    assert(page.coachDashboardAllClassesLinkHeight >= 44, "coach dashboard all classes link must keep 44px touch target");
  }
	  if (id === "coach-classes") {
	    assert(page.coachAttendanceControlPanelHeight <= 150, "coach classes visible app copy scan must keep attendance controls compact enough for the first class card");
	    assert(page.coachMobileSpeedPanelHeight <= 62, "coach classes visible app copy scan must keep quick actions compact");
	    assert(page.coachMobileSpeedActionButtonMinHeight >= 44, "coach classes visible app copy scan must keep quick actions tappable");
    assert(page.coachMobileSpeedPressedStates.includes("coach-mobile-speed-unchecked-action:false"), "coach classes visible app copy scan must expose unchecked quick action pressed state");
    assert(page.coachMobileSpeedPressedStates.includes("coach-mobile-speed-reason-action:false"), "coach classes visible app copy scan must expose reason quick action pressed state");
    assert(page.coachMobileSpeedPressedStates.includes("coach-mobile-speed-attention-action:false"), "coach classes visible app copy scan must expose attention quick action pressed state");
	    assert.equal(page.coachMobileSpeedSummaryChipCount, 0, "coach classes visible app copy scan must not repeat four quick action summary chips");
	    assert.equal(page.coachMobileSpeedSummaryLineCount, 1, "coach classes visible app copy scan must render one compact quick action status line");
	    assert(page.coachMobileSpeedSummaryLineHeight <= 18, "coach classes visible app copy scan must keep quick action status line to one row");
	    assert(page.coachFieldFlowPanelHeight <= 64, "coach classes visible app copy scan must keep field flow as a compact one-row rail");
	    assert(page.coachFirstClassCardTop <= 430, "coach classes visible app copy scan must surface the first class card in the mobile first viewport");
    assert(page.attendanceStatusFilterGroupHeight <= 52, "coach classes visible app copy scan must keep status filters in one active-status chip row");
    assert(page.attendanceStatusFilterButtonCount <= 4, "coach classes visible app copy scan must hide zero-count status chips by default");
    assert(!page.attendanceStatusFilterButtonText.includes("결석0"), "coach classes visible app copy scan must hide zero-count absent chip");
    assert(!page.attendanceStatusFilterButtonText.includes("사유0"), "coach classes visible app copy scan must hide zero-count excused chip");
    assert(!page.attendanceStatusFilterButtonText.includes("보강0"), "coach classes visible app copy scan must hide zero-count deleted request chip");
    assert.equal(page.attendanceStatusFilterGroupOverflow, 0, "coach classes visible app copy scan must avoid horizontal status filter scrolling");
    assert(page.attendanceUncheckedFilterLabelHeight >= 44, "coach classes unchecked filter label must keep 44px touch target");
	    assert(page.attendanceUncheckedFilterBoxHeight >= 28, "coach classes unchecked filter checkbox must stay visually clear");
    assert(page.attendanceStatusFilterButtonMinHeight >= 44, "coach classes visible app copy scan must keep status filters tappable");
    assert(page.coachClassRosterToggleCount > 1, "coach classes visible app copy scan must render roster toggles");
    assert.equal(page.coachClassRosterLongLabelCount, 0, "coach classes visible app copy scan must keep roster toggles compact");
    assert(page.coachClassRosterToggleMinHeight >= 44, "coach classes visible app copy scan must keep roster toggles tappable");
    assert(page.coachVisibleClassCardCount <= 1, "coach classes visible app copy scan must keep mobile default list short");
    assert.equal(page.coachClassListToggleCount, 1, "coach classes visible app copy scan must render the mobile class-list expansion control");
    assert(page.coachClassListToggleMinHeight >= 44, "coach classes visible app copy scan must keep the class-list expansion control tappable");
    assert(page.coachClassListToggleText.includes("오늘 수업"), "coach classes visible app copy scan must keep class-list expansion copy readable");
    assert.equal(page.coachClassRosterToggleBottomNavOverlapCount, 0, "coach classes visible app copy scan must keep roster toggles clear of the mobile bottom navigation");
    assert.equal(page.coachClassListToggleBottomNavOverlapCount, 0, "coach classes visible app copy scan must keep list expansion clear of the mobile bottom navigation");
    assert.equal(page.coachClassRosterOpenCount, 0, "coach classes visible app copy scan must keep rosters collapsed by default");
    assert.equal(
      page.coachClassRosterClosedCount,
      page.coachClassRosterToggleCount,
      "coach classes visible app copy scan must render one collapsed roster summary per class by default",
    );
    assert(page.coachClassRosterClosedMaxHeight <= 2, "coach classes visible app copy scan must not render a duplicate collapsed roster row");
    assert(page.coachClassCardCount > 1, "coach classes visible app copy scan must render compact class cards");
	    assert.equal(page.coachClassAttendanceSummaryCount, page.coachClassCardCount, "coach classes visible app copy scan must render one compact attendance summary per class card");
		    assert(page.coachClassAttendanceSummaryMaxHeight <= 44, "coach classes visible app copy scan must keep attendance summary inside the compact action row");
		    assert(page.coachClassCardMaxHeight <= 135, "coach classes visible app copy scan must keep class cards compact for one-handed use");
    assert.equal(page.attendanceHistoryPanelCount, 1, "coach classes visible app copy scan must keep a recent attendance history affordance");
    assert.equal(page.attendanceHistoryState, "closed", "coach classes visible app copy scan must collapse recent attendance history by default");
    assert(page.attendanceHistoryPanelHeight <= 76, "coach classes visible app copy scan must keep recent attendance history as one compact row");
    assert(page.attendanceHistoryToggleHeight >= 44, "coach classes visible app copy scan must keep recent attendance history toggle tappable");
    assert.equal(page.attendanceHistoryDetailListCount, 0, "coach classes visible app copy scan must hide attendance history details by default");
    assert.equal(page.attendanceHistoryDetailRowCount, 0, "coach classes visible app copy scan must not render attendance history rows until opened");
	    assert.equal(page.coachClassAttendanceNoteToggleCount, 0, "coach classes visible app copy scan must hide note toggles until a roster is opened");
    assert.equal(page.coachClassAttendanceNoteEditorCount, 0, "coach classes visible app copy scan must keep note editors hidden by default");
    assert.equal(
      page.coachClassAttendanceNoteInputVisibleCount,
      page.coachClassAttendanceNoteEditorCount,
      "coach classes visible app copy scan must only show note inputs inside opened editors",
    );
    assert.equal(page.coachClassInternalPanelCount, 0, "coach classes visible app copy scan must not expose internal P3 operation panels");
    assert.equal(page.coachClassVisibleCodeCount, 0, "coach classes visible app copy scan must not expose code-style closeout text");
  }
  assert(page.screenshotPath && existsSync(page.screenshotPath), `${id} visible app copy screenshot must exist`);
  assert(statSync(page.screenshotPath).size > 10_000, `${id} visible app copy screenshot must be non-empty`);
}

assert.equal(quickVisibleCopyRecheck.ok, true, "quick visible copy recheck must pass");
assert.equal(
  quickVisibleCopyRecheck.pages?.length,
  8,
  "quick visible copy recheck must cover admin/owner/coach/member/guardian routes",
);
for (const page of quickVisibleCopyRecheck.pages ?? []) {
  assert.equal(page.hits?.length ?? 0, 0, `${page.name} must not show banned internal/dummy copy`);
  assert.equal(page.hasHorizontalOverflow, false, `${page.name} must not have horizontal overflow`);
  assert.equal(page.stillLoading, false, `${page.name} must render actual service content`);
  assert(page.screenshot && existsSync(page.screenshot), `${page.name} screenshot must exist`);
  assert(statSync(page.screenshot).size > 10_000, `${page.name} screenshot must be non-empty`);
}

assert.equal(nextVisibleCopyScan.ok, true, "next visible copy scan must pass");
assert.equal(nextVisibleCopyScan.browserPath, "iab", "next visible copy scan must use in-app browser");
assert.deepEqual(nextVisibleCopyScan.viewport, { width: 390, height: 844 }, "next visible copy scan must use mobile viewport");
assert.equal(
  nextVisibleCopyScan.results?.length,
  22,
  "next visible copy scan must cover owner/coach/member/guardian follow-up routes",
);
for (const page of nextVisibleCopyScan.results ?? []) {
  const pageName = `${page.role} ${page.route}`;

  assert.equal(page.hits?.length ?? 0, 0, `${pageName} must not show banned dummy/internal copy`);
  assert.equal(page.hasHorizontalOverflow, false, `${pageName} must not have horizontal overflow`);
  assert.equal(page.messages?.length ?? 0, 0, `${pageName} must not have console errors`);
  assert(page.sample && page.sample.trim().length > 20, `${pageName} must render visible service content`);
}

assert.equal(compactEmptyCopyReport.ok, true, "compact empty copy render report must pass");
const activeCompactEmptyCopyPages = (compactEmptyCopyReport.pages ?? []).filter((page) => !page.url.includes("/app/requests"));
assert(
  activeCompactEmptyCopyPages.some((page) => page.url.includes("/app/payments")),
  "compact empty copy render report must cover payments",
);
assert(
  activeCompactEmptyCopyPages.some((page) => page.url.includes("/app/owner/branches")),
  "compact empty copy render report must cover owner branches",
);
for (const page of activeCompactEmptyCopyPages) {
  assert.equal(page.hasHorizontalOverflow, false, `${page.url} must not have horizontal overflow`);
  assert.equal(page.hasFrameworkOverlay, false, `${page.url} must not show a framework overlay`);
  assert.equal(page.bannedHits?.length ?? 0, 0, `${page.url} must not show banned verbose copy`);
  assert(
    Array.isArray(page.wantedHits) && page.wantedHits.length > 0,
    `${page.url} must include expected compact service copy`,
  );
}
const compactPaymentEmptyPage = activeCompactEmptyCopyPages.find((page) => page.url.includes("/app/payments"));
assert(compactPaymentEmptyPage, "compact empty copy render report must include member payments empty filter state");
for (const snippet of [
  "부분 환불",
  "전액 환불",
  "취소",
  "회원권",
  "납부 예정/만료",
  "다른 상태를 선택해 주세요.",
  "다른 보기를 선택해 주세요.",
  "등록된 회원권 없음",
]) {
  assertExcludes(
    compactPaymentEmptyPage.sample ?? "",
    snippet,
    "member payments compact empty evidence must not keep old operational filter copy",
  );
}
for (const snippet of ["보기", "결제 0건", "선택한 보기의 결제가 없습니다"]) {
  assertIncludes(
    compactPaymentEmptyPage.sample ?? "",
    snippet,
    "member payments compact empty evidence must reflect current app copy",
  );
}

assert.equal(loadingCopyReport.ok, true, "loading copy evidence must pass");
assert.equal(loadingCopyReport.route, "/app/dashboard", "loading copy evidence must cover member dashboard");
assert.equal(loadingCopyReport.role, "member", "loading copy evidence must use member role");
for (const [key, value] of Object.entries(loadingCopyReport.assertions ?? {})) {
  assert.equal(value, true, `loading copy evidence assertion ${key} must pass`);
}

assert.equal(networkErrorCopyReport.ok, true, "network error copy evidence must pass");
assert.equal(networkErrorCopyReport.route, "/login", "network error copy evidence must cover login route");
for (const [key, value] of Object.entries(networkErrorCopyReport.assertions ?? {})) {
  assert.equal(value, true, `network error copy evidence assertion ${key} must pass`);
}

assert.equal(errorFallbackCopyReport.ok, true, "error fallback copy evidence must pass");
assert.equal(errorFallbackCopyReport.browserPath, "iab", "error fallback copy evidence must use in-app browser");
assert.equal(errorFallbackCopyReport.path, "/app/dashboard", "error fallback copy evidence must cover member dashboard");
assert.equal(errorFallbackCopyReport.role, "member", "error fallback copy evidence must use member role");
assert.deepEqual(errorFallbackCopyReport.viewport, { width: 390, height: 844 }, "error fallback copy evidence must use mobile viewport");
assert.equal(errorFallbackCopyReport.hasServiceContent, true, "error fallback copy evidence must show service content");
assert.equal(errorFallbackCopyReport.overflowX, 0, "error fallback copy evidence must not overflow horizontally");
assert.deepEqual(errorFallbackCopyReport.consoleErrors, [], "error fallback copy evidence must not include console errors");

assert.equal(memberContactFormatReport.ok, true, "member contact format render evidence must pass");
assert.equal(memberContactFormatReport.browserPath, "iab", "member contact format evidence must use in-app browser");
assert.equal(memberContactFormatReport.route, "/app/members", "member contact format evidence must cover members route");
assert.equal(memberContactFormatReport.role, "member", "member contact format evidence must use member role");
assert.equal(memberContactFormatReport.state?.hasFormattedContact, true, "member contact evidence must show formatted contact");
assert.equal(memberContactFormatReport.state?.hasRawKoreaPrefix, false, "member contact evidence must hide raw +82 contact");
assert.equal(memberContactFormatReport.state?.horizontalOverflow, false, "member contact evidence must not overflow horizontally");
assert.equal(memberContactFormatReport.state?.hasFrameworkOverlay, false, "member contact evidence must not show framework overlay");
assert.equal(
  memberContactFormatReport.logs?.filter((entry) => entry.level === "error").length ?? 0,
  0,
  "member contact evidence must have no console errors",
);

assert.equal(emptyStateTitleOnlyReport.ok, true, "empty state title-only render evidence must pass");
assert.equal(emptyStateTitleOnlyReport.browserPath, "iab", "empty state evidence must use in-app browser");
assert.equal(emptyStateTitleOnlyReport.results?.length, 5, "empty state evidence must cover affected routes");
for (const page of emptyStateTitleOnlyReport.results ?? []) {
  assert.equal(page.bannedHits?.length ?? 0, 0, `${page.role} ${page.route} must not show old waiting empty copy`);
  assert.equal(page.horizontalOverflow, false, `${page.role} ${page.route} must not have horizontal overflow`);
  assert.equal(page.hasFrameworkOverlay, false, `${page.role} ${page.route} must not show a framework overlay`);
  assert.equal(page.errorLogCount, 0, `${page.role} ${page.route} must have no console errors`);
}

assert.equal(emptyStateCopyTighteningReport.ok, true, "empty state copy tightening evidence must pass");
assert.equal(emptyStateCopyTighteningReport.browserPath, "iab", "empty state copy tightening evidence must use in-app browser");
assert.deepEqual(
  emptyStateCopyTighteningReport.viewport,
  { width: 390, height: 844 },
  "empty state copy tightening evidence must use mobile viewport",
);
assert.equal(emptyStateCopyTighteningReport.results?.length, 5, "empty state copy tightening evidence must cover affected routes");
for (const page of emptyStateCopyTighteningReport.results ?? []) {
  assert.equal(page.hits?.length ?? 0, 0, `${page.name} must not show removed empty-state helper copy`);
  assert.equal(page.hasOverflow, false, `${page.name} must not have horizontal overflow`);
  assert(page.screenshot && existsSync(page.screenshot), `${page.name} screenshot must exist`);
  assert(statSync(page.screenshot).size > 10_000, `${page.name} screenshot must be non-empty`);
}

assert.equal(notificationAccessCopyReport.ok, true, "notification/access copy evidence must pass");
assert.equal(notificationAccessCopyReport.browserPath, "iab", "notification/access copy evidence must use in-app browser");
assert.deepEqual(
  notificationAccessCopyReport.viewport,
  { width: 390, height: 844 },
  "notification/access copy evidence must use mobile viewport",
);
assert.equal(notificationAccessCopyReport.results?.length, 2, "notification/access copy evidence must cover notices and protected route");
for (const page of notificationAccessCopyReport.results ?? []) {
  assert.equal(page.bannedHits?.length ?? 0, 0, `${page.url} must not show old notification/access copy`);
  assert.equal(page.overflow, false, `${page.url} must not have horizontal overflow`);
  assert(page.path && existsSync(page.path), `${page.url} screenshot must exist`);
  assert(statSync(page.path).size > 10_000, `${page.url} screenshot must be non-empty`);
}

assert.equal(adminSettingsInternalReferenceCleanupReport.ok, true, "admin settings internal reference cleanup evidence must pass");
assert.equal(
  adminSettingsInternalReferenceCleanupReport.bannedHits?.length ?? 0,
  0,
  "admin settings internal reference cleanup must hide raw paths and commands",
);
assert(
  adminSettingsInternalReferenceCleanupReport.screenshot && existsSync(adminSettingsInternalReferenceCleanupReport.screenshot),
  "admin settings internal reference cleanup screenshot must exist",
);
assert(
  statSync(adminSettingsInternalReferenceCleanupReport.screenshot).size > 10_000,
  "admin settings internal reference cleanup screenshot must be non-empty",
);

assert.equal(memberInvitationLinkCompactReport.ok, true, "member invitation link compact evidence must pass");
assert.equal(
  memberInvitationLinkCompactReport.bannedHits?.length ?? 0,
  0,
  "member invitation link compact evidence must hide raw invite link copy",
);
assert(
  memberInvitationLinkCompactReport.screenshot && existsSync(memberInvitationLinkCompactReport.screenshot),
  "member invitation link compact screenshot must exist",
);
assert(
  statSync(memberInvitationLinkCompactReport.screenshot).size > 10_000,
  "member invitation link compact screenshot must be non-empty",
);

assert.equal(coachSaveLabelCleanupReport.ok, true, "coach save label cleanup evidence must pass");
assert.equal(
  coachSaveLabelCleanupReport.bannedHits?.length ?? 0,
  0,
  "coach save label cleanup evidence must hide technical sync copy",
);
assert(
  coachSaveLabelCleanupReport.screenshot && existsSync(coachSaveLabelCleanupReport.screenshot),
  "coach save label cleanup screenshot must exist",
);
assert(
  statSync(coachSaveLabelCleanupReport.screenshot).size > 10_000,
  "coach save label cleanup screenshot must be non-empty",
);

assert.equal(
  coachSaveCopyPolishReport.coachSaveCopyInfo?.forbiddenHits?.length ?? 0,
  0,
  "coach save copy polish evidence must hide technical sync/offline copy",
);
assert.equal(
  coachSaveCopyPolishReport.coachSaveCopyInfo?.requiredMissing?.length ?? 0,
  0,
  "coach save copy polish evidence must include app-safe save status copy",
);
assert.equal(coachSaveCopyPolishReport.coachSaveCopyInfo?.hasOverlay, false, "coach save copy polish evidence must not show a framework overlay");
assert.equal(
  coachSaveCopyPolishReport.logs?.filter((entry) => entry.level === "error").length ?? 0,
  0,
  "coach save copy polish evidence must have no console errors",
);

assert.equal(adminSettingsRoleSelectCopyReport.ok, true, "admin settings role select copy evidence must pass");
assert.equal(adminSettingsRoleSelectCopyReport.browserPath, "iab", "admin settings role select evidence must use in-app browser");
assert.equal(adminSettingsRoleSelectCopyReport.found, true, "admin settings role select evidence must show app-safe default role copy");
assert.equal(adminSettingsRoleSelectCopyReport.requiredMissing?.length ?? 0, 0, "admin settings role select evidence must include required app-safe copy");
assert.equal(adminSettingsRoleSelectCopyReport.overflow, false, "admin settings role select evidence must not have horizontal overflow");
assert.equal(adminSettingsRoleSelectCopyReport.bannedHits?.length ?? 0, 0, "admin settings role select evidence must not show old fallback copy");
assert(adminSettingsRoleSelectCopyReport.path && existsSync(adminSettingsRoleSelectCopyReport.path), "admin settings role select screenshot must exist");
assert(statSync(adminSettingsRoleSelectCopyReport.path).size > 10_000, "admin settings role select screenshot must be non-empty");

assert.equal(invitePasswordCopyReport.ok, true, "invite password copy evidence must pass");
assert.equal(invitePasswordCopyReport.browserPath, "iab", "invite password copy evidence must use in-app browser");
assert.deepEqual(invitePasswordCopyReport.viewport, { width: 390, height: 844 }, "invite password copy evidence must use mobile viewport");
assert.equal(invitePasswordCopyReport.requiredMissing?.length ?? 0, 0, "invite password copy evidence must include required app-safe copy");
assert.equal(invitePasswordCopyReport.bannedHits?.length ?? 0, 0, "invite password copy evidence must not show initial/default password copy");
assert.equal(invitePasswordCopyReport.overflow?.length ?? 0, 0, "invite password copy evidence must not have horizontal overflow");
assert(invitePasswordCopyReport.path && existsSync(invitePasswordCopyReport.path), "invite password copy screenshot must exist");
assert(statSync(invitePasswordCopyReport.path).size > 10_000, "invite password copy screenshot must be non-empty");

assert.equal(adminRolesCopyReport.ok, true, "admin roles mobile copy evidence must pass");
assert.equal(adminRolesCopyReport.browserPath, "iab", "admin roles mobile copy evidence must use in-app browser");
assert.deepEqual(adminRolesCopyReport.viewport, { width: 390, height: 844 }, "admin roles mobile copy evidence must use mobile viewport");
assert.equal(adminRolesCopyReport.requiredMissing?.length ?? 0, 0, "admin roles mobile copy evidence must include required app-safe copy");
assert.equal(adminRolesCopyReport.bannedHits?.length ?? 0, 0, "admin roles mobile copy evidence must not show product/resource copy");
assert.equal(adminRolesCopyReport.overflow?.length ?? 0, 0, "admin roles mobile matrix evidence must not have positive horizontal overflow");
assert(adminRolesCopyReport.path && existsSync(adminRolesCopyReport.path), "admin roles mobile copy screenshot must exist");
assert(statSync(adminRolesCopyReport.path).size > 10_000, "admin roles mobile copy screenshot must be non-empty");

assert.equal(guardianLearningStatusCopyReport.ok, true, "guardian learning status copy evidence must pass");
assert.equal(guardianLearningStatusCopyReport.browserPath, "iab", "guardian learning status evidence must use in-app browser");
assert.deepEqual(
  guardianLearningStatusCopyReport.viewport,
  { width: 390, height: 844 },
  "guardian learning status evidence must use mobile viewport",
);
assert.equal(
  guardianLearningStatusCopyReport.check?.requiredMissing?.length ?? 0,
  0,
  "guardian learning status evidence must include service-facing learning copy",
);
assert.equal(
  guardianLearningStatusCopyReport.check?.forbiddenHits?.length ?? 0,
  0,
  "guardian learning status evidence must not show empty/dummy-like state copy",
);
assert.equal(guardianLearningStatusCopyReport.check?.overflowX, 0, "guardian learning status evidence must not have horizontal overflow");
assert.equal(guardianLearningStatusCopyReport.check?.hasFrameworkOverlay, false, "guardian learning status evidence must not show a framework overlay");
assert.equal(
  guardianLearningStatusCopyReport.logs?.filter((entry) => entry.level === "error").length ?? 0,
  0,
  "guardian learning status evidence must have no console errors",
);
assert(guardianLearningStatusCopyReport.path && existsSync(guardianLearningStatusCopyReport.path), "guardian learning status screenshot must exist");
assert(statSync(guardianLearningStatusCopyReport.path).size > 10_000, "guardian learning status screenshot must be non-empty");

assert.equal(ownerPeriodTouchPolishReport.polishedInfo?.hasThirtyAction, true, "owner period evidence must show 30일 액션");
assert.equal(ownerPeriodTouchPolishReport.polishedInfo?.hasThirtySignal, true, "owner period evidence must show 30일 우선 신호");
assert.equal(ownerPeriodTouchPolishReport.polishedInfo?.hasThirtyCta, true, "owner period evidence must show 30일 순서 CTA");
assert.equal(ownerPeriodTouchPolishReport.polishedInfo?.hasStaleTodayCta, false, "owner period evidence must not keep 오늘 순서 on 30일");
assert.equal(ownerPeriodTouchPolishReport.polishedInfo?.hasOverlay, false, "owner period evidence must not show a framework overlay");
assert(
  ownerPeriodTouchPolishReport.polishedInfo?.controls?.every((control) => control.h >= 40),
  "owner period evidence must keep segmented buttons at least 40px tall",
);
assert.equal(
  ownerPeriodTouchPolishReport.logs?.filter((entry) => entry.level === "error").length ?? 0,
  0,
  "owner period evidence must have no console errors",
);

assert.equal(adminSettingsPilotLabelReport.ok, true, "admin settings pilot label evidence must pass");
assert.equal(adminSettingsPilotLabelReport.browserPath, "iab", "admin settings pilot label evidence must use in-app browser");
assert.deepEqual(
  adminSettingsPilotLabelReport.viewport,
  { width: 390, height: 844 },
  "admin settings pilot label evidence must use mobile viewport",
);
assert.equal(adminSettingsPilotLabelReport.hasNewLabel, true, "admin settings pilot label evidence must show account-specific password copy");
assert.equal(
  adminSettingsPilotLabelReport.oldHits?.length ?? 0,
  0,
  "admin settings pilot label evidence must hide initial/default password copy",
);
assert.equal(adminSettingsPilotLabelReport.hasServiceHeader, true, "admin settings pilot label evidence must render service header");
assert.equal(adminSettingsPilotLabelReport.hasPilotPanel, true, "admin settings pilot label evidence must render pilot operations panel");
assert.equal(adminSettingsPilotLabelReport.hasFrameworkOverlay, false, "admin settings pilot label evidence must not show a framework overlay");
assert.equal(adminSettingsPilotLabelReport.horizontalOverflow, 0, "admin settings pilot label evidence must not have horizontal overflow");
assert.equal(
  adminSettingsPilotLabelReport.consoleLogs?.filter((entry) => entry.level === "error").length ?? 0,
  0,
  "admin settings pilot label evidence must have no console errors",
);
assert(
  adminSettingsPilotLabelReport.screenshot && existsSync(adminSettingsPilotLabelReport.screenshot),
  "admin settings pilot label screenshot must exist",
);
assert(
  statSync(adminSettingsPilotLabelReport.screenshot).size > 10_000,
  "admin settings pilot label screenshot must be non-empty",
);

assert.equal(continuousVisibleCopyScanReport.ok, true, "continuous visible copy scan evidence must pass");
assert.equal(continuousVisibleCopyScanReport.browserPath, "iab", "continuous visible copy scan must use in-app browser");
assert.deepEqual(
  continuousVisibleCopyScanReport.viewport,
  { width: 390, height: 844 },
  "continuous visible copy scan must use mobile viewport",
);
assert.equal(continuousVisibleCopyScanReport.minimumTextLength, 150, "continuous visible copy scan must keep compact screen threshold");
const activeContinuousVisibleCopyPages = (continuousVisibleCopyScanReport.results ?? []).filter((page) => !page.name.includes("requests"));
assert.equal(activeContinuousVisibleCopyPages.length, 8, "continuous visible copy scan must cover 8 active key role routes");
for (const page of activeContinuousVisibleCopyPages) {
  assert.equal(page.hits?.length ?? 0, 0, `${page.name} must not show dummy/internal/release copy`);
  assert.equal(page.loading, false, `${page.name} must not stay on loading copy`);
  assert(page.textLength >= continuousVisibleCopyScanReport.minimumTextLength, `${page.name} must render meaningful service content`);
  assert.equal(page.hasOverlay, false, `${page.name} must not show a framework overlay`);
  assert.equal(page.horizontalOverflow, 0, `${page.name} must not have horizontal overflow`);
  assert.equal(page.consoleErrors?.length ?? 0, 0, `${page.name} must not have console errors`);
  assert(page.screenshot && existsSync(page.screenshot), `${page.name} visible copy scan screenshot must exist`);
  assert(statSync(page.screenshot).size > 10_000, `${page.name} visible copy scan screenshot must be non-empty`);
}

assert.equal(memberDashboardScheduleCompactReport.ok, true, "member dashboard compact schedule evidence must pass");
assert.equal(memberDashboardScheduleCompactReport.browserPath, "iab", "member dashboard compact schedule evidence must use in-app browser");
assert.deepEqual(
  memberDashboardScheduleCompactReport.viewport,
  { width: 390, height: 844 },
  "member dashboard compact schedule evidence must use mobile viewport",
);
assert.equal(memberDashboardScheduleCompactReport.hasCompactTime, true, "member dashboard must render compact 24-hour class time");
assert.equal(memberDashboardScheduleCompactReport.hasVerboseAmPmTime, false, "member dashboard must avoid verbose AM/PM time wrapping");
assert.equal(memberDashboardScheduleCompactReport.hasLoading, false, "member dashboard compact schedule evidence must reach service content");
assert.equal(memberDashboardScheduleCompactReport.hasFrameworkOverlay, false, "member dashboard compact schedule evidence must not show a framework overlay");
assert.equal(memberDashboardScheduleCompactReport.horizontalOverflow, 0, "member dashboard compact schedule evidence must not have horizontal overflow");
assert.equal(
  memberDashboardScheduleCompactReport.consoleLogs?.filter((entry) => entry.level === "error").length ?? 0,
  0,
  "member dashboard compact schedule evidence must have no console errors",
);
assert(
  memberDashboardScheduleCompactReport.screenshot && existsSync(memberDashboardScheduleCompactReport.screenshot),
  "member dashboard compact schedule screenshot must exist",
);
assert(
  statSync(memberDashboardScheduleCompactReport.screenshot).size > 10_000,
  "member dashboard compact schedule screenshot must be non-empty",
);

assert.equal(coachAttendanceFilterGridReport.ok, true, "coach attendance filter grid evidence must pass");
assert.equal(coachAttendanceFilterGridReport.browserPath, "iab", "coach attendance filter grid evidence must use in-app browser");
assert.deepEqual(
  coachAttendanceFilterGridReport.viewport,
  { width: 390, height: 844 },
  "coach attendance filter grid evidence must use mobile viewport",
);
assert.equal(coachAttendanceFilterGridReport.hasFilter, true, "coach attendance filter grid evidence must render status filter");
assert.equal(coachAttendanceFilterGridReport.hasLoading, false, "coach attendance filter grid evidence must reach service content");
assert.equal(coachAttendanceFilterGridReport.hasFrameworkOverlay, false, "coach attendance filter grid evidence must not show a framework overlay");
assert.equal(coachAttendanceFilterGridReport.horizontalOverflow, 0, "coach attendance filter grid evidence must not have horizontal overflow");
assert.equal(coachAttendanceFilterGridReport.groupOverflow, 0, "coach attendance filter group must not horizontally overflow");
assert(coachAttendanceFilterGridReport.buttonCount >= 5, "coach attendance filter must render status buttons");
assert.equal(coachAttendanceFilterGridReport.clippedButtons?.length ?? 0, 0, "coach attendance filter buttons must not be clipped");
assert(
  coachAttendanceFilterGridReport.checkboxRect?.height >= 24 && coachAttendanceFilterGridReport.checkboxRect?.width >= 24,
  "coach attendance unchecked checkbox must keep at least 24px visual size",
);
assert(
  coachAttendanceFilterGridReport.labelRect?.height >= 44,
  "coach attendance unchecked label must keep at least 44px touch height",
);
assert(
  coachAttendanceFilterGridReport.buttonRects?.every((rect) => rect.height >= 44),
  "coach attendance filter buttons must keep at least 44px touch height",
);
assert.equal(
  coachAttendanceFilterGridReport.consoleLogs?.filter((entry) => entry.level === "error").length ?? 0,
  0,
  "coach attendance filter grid evidence must have no console errors",
);
assert(
  coachAttendanceFilterGridReport.screenshot && existsSync(coachAttendanceFilterGridReport.screenshot),
  "coach attendance filter grid screenshot must exist",
);
assert(
  statSync(coachAttendanceFilterGridReport.screenshot).size > 10_000,
  "coach attendance filter grid screenshot must be non-empty",
);

for (const snippet of [
  'data-testid="p2-internal-development-status"',
  'data-testid="p3-operations-status"',
  'data-testid="p4-simulator-rehearsal-status"',
  "P2 개발 착수 상태",
  "P3 운영 고도화 상태",
  "P4 실제 사용 환경 검증 상태",
]) {
  assertExcludes(sources.adminSettings, snippet, "admin settings internal stage boards must stay removed from client source");
}
assert.equal(adminSettingsInternalStageHiddenReport.ok, true, "admin settings internal stage hidden evidence must pass");
assert.equal(adminSettingsInternalStageHiddenReport.browserPath, "iab", "admin settings internal stage evidence must use in-app browser");
assert.deepEqual(
  adminSettingsInternalStageHiddenReport.viewport,
  { width: 390, height: 844 },
  "admin settings internal stage evidence must use mobile viewport",
);
assert.equal(
  adminSettingsInternalStageHiddenReport.forbiddenHits?.length ?? 0,
  0,
  "admin settings visible text must hide internal P2/P3 development labels",
);
assert.equal(adminSettingsInternalStageHiddenReport.hiddenOk, true, "admin settings internal P2/P3 boards must be absent or hidden");
assert.equal(adminSettingsInternalStageHiddenReport.hasServiceHeader, true, "admin settings hidden-stage evidence must render service header");
assert.equal(adminSettingsInternalStageHiddenReport.hasRolePolicy, true, "admin settings hidden-stage evidence must keep role policy content");
assert.equal(adminSettingsInternalStageHiddenReport.hasLoadingCopy, false, "admin settings hidden-stage evidence must reach service content");
assert.equal(adminSettingsInternalStageHiddenReport.hasFrameworkOverlay, false, "admin settings hidden-stage evidence must not show a framework overlay");
assert.equal(adminSettingsInternalStageHiddenReport.horizontalOverflow, 0, "admin settings hidden-stage evidence must not have horizontal overflow");
assert(
  adminSettingsInternalStageHiddenReport.screenshot && existsSync(adminSettingsInternalStageHiddenReport.screenshot),
  "admin settings hidden-stage screenshot must exist",
);
assert(
  statSync(adminSettingsInternalStageHiddenReport.screenshot).size > 10_000,
  "admin settings hidden-stage screenshot must be non-empty",
);

assert.equal(adminSettingsOpsWordingReport.ok, true, "admin settings operation wording evidence must pass");
assert.equal(adminSettingsOpsWordingReport.browserPath, "iab", "admin settings operation wording evidence must use in-app browser");
assert.deepEqual(
  adminSettingsOpsWordingReport.viewport,
  { width: 390, height: 844 },
  "admin settings operation wording evidence must use mobile viewport",
);
assert.equal(
  adminSettingsOpsWordingReport.forbiddenHits?.length ?? 0,
  0,
  "admin settings visible text must hide internal release/development wording",
);
assert.equal(adminSettingsOpsWordingReport.hasServiceHeader, true, "admin settings operation wording evidence must render service header");
assert.equal(adminSettingsOpsWordingReport.hasRolePolicy, true, "admin settings operation wording evidence must keep role policy content");
assert.equal(adminSettingsOpsWordingReport.hasPilotOps, true, "admin settings operation wording evidence must keep operation controls");
assert.equal(adminSettingsOpsWordingReport.hasNewPilotCopy, true, "admin settings operation wording evidence must show app-safe operation copy");
assert.equal(adminSettingsOpsWordingReport.hasLoadingCopy, false, "admin settings operation wording evidence must reach service content");
assert.equal(adminSettingsOpsWordingReport.hasFrameworkOverlay, false, "admin settings operation wording evidence must not show a framework overlay");
assert.equal(adminSettingsOpsWordingReport.horizontalOverflow, 0, "admin settings operation wording evidence must not have horizontal overflow");
assert(
  adminSettingsOpsWordingReport.screenshot && existsSync(adminSettingsOpsWordingReport.screenshot),
  "admin settings operation wording screenshot must exist",
);
assert(
  statSync(adminSettingsOpsWordingReport.screenshot).size > 10_000,
  "admin settings operation wording screenshot must be non-empty",
);
assert.equal(adminSettingsReadinessCollapseReport.summaryCount, 1, "admin settings readiness collapse evidence must show one compact summary");
assert.equal(adminSettingsReadinessCollapseReport.listCount, 0, "admin settings readiness collapse evidence must keep detail list hidden by default");
assert.equal(adminSettingsReadinessCollapseReport.itemCount, 0, "admin settings readiness collapse evidence must keep readiness item cards hidden by default");
assert(
  adminSettingsReadinessCollapseReport.readinessHeight <= 360,
  "admin settings readiness collapse evidence must keep readiness section compact",
);
assert(
  adminSettingsReadinessCollapseReport.listToggleHeight >= 44 && adminSettingsReadinessCollapseReport.editorToggleHeight >= 44,
  "admin settings readiness collapse evidence must keep toggles tappable",
);
assert.equal(adminSettingsReadinessCollapseReport.horizontalOverflow, false, "admin settings readiness collapse evidence must not overflow horizontally");

assertIncludes(sources.classesScreen, "formatCompactTimeRange(session.startsAt, session.endsAt)", "coach classes compact mobile time range");
assertExcludes(sources.classesScreen, "formatTimeRange(session.startsAt, session.endsAt)", "coach classes verbose mobile time range");
assertIncludes(sources.classesScreen, 'data-testid="coach-attendance-control-panel"', "coach classes compact attendance control panel hook");
assertIncludes(sources.classesScreen, "visibleAttendanceStatusFilters", "coach classes active status filter list");
assertIncludes(sources.classesScreen, "flex gap-1 overflow-x-auto pb-0.5", "coach classes one-row visible status filter chips");
assertIncludes(sources.classesScreen, "showAttendanceSearchInput", "coach classes roster search stays collapsed until requested");
assertIncludes(sources.classesScreen, 'data-testid="attendance-roster-search-toggle"', "coach classes collapsed roster search toggle");
assertExcludes(sources.classesScreen, "grid grid-flow-col auto-cols-[minmax(4.5rem,1fr)]", "coach classes old horizontal status filter rail");
assertIncludes(sources.classesScreen, '<label className="sr-only" htmlFor="attendance-roster-search">', "coach classes accessible search label retained");
assert.equal(coachClassCompactTimeReport.ok, true, "coach class compact time evidence must pass");
assert.equal(coachClassCompactTimeReport.browserPath, "iab", "coach class compact time evidence must use in-app browser");
assert.deepEqual(
  coachClassCompactTimeReport.viewport,
  { width: 390, height: 844 },
  "coach class compact time evidence must use mobile viewport",
);
assert(coachClassCompactTimeReport.compactRangeHits?.length >= 2, "coach class list must render compact 24-hour time ranges");
assert.equal(coachClassCompactTimeReport.verboseTimeHits?.length ?? 0, 0, "coach class list must not render verbose AM/PM time ranges");
assert.equal(coachClassCompactTimeReport.hasClassesHeader, true, "coach class compact time evidence must render classes header");
assert.equal(coachClassCompactTimeReport.hasClassCard, true, "coach class compact time evidence must render class cards");
assert.equal(coachClassCompactTimeReport.hasLoadingCopy, false, "coach class compact time evidence must reach service content");
assert.equal(coachClassCompactTimeReport.hasFrameworkOverlay, false, "coach class compact time evidence must not show a framework overlay");
assert.equal(coachClassCompactTimeReport.horizontalOverflow, 0, "coach class compact time evidence must not have horizontal overflow");
assert(coachClassCompactTimeReport.screenshot && existsSync(coachClassCompactTimeReport.screenshot), "coach class compact time screenshot must exist");
assert(statSync(coachClassCompactTimeReport.screenshot).size > 10_000, "coach class compact time screenshot must be non-empty");

assertIncludes(
  sources.dashboardScreen,
  "{formatDate(session.startsAt)} · {formatCompactTimeRange(session.startsAt, session.endsAt)} · {session.room}",
  "dashboard class list compact mobile time range",
);
assertExcludes(sources.dashboardScreen, "formatTimeRange", "dashboard class list verbose mobile time range");
assert.equal(dashboardCompactTimeReport.ok, true, "dashboard compact time evidence must pass");
assert.equal(dashboardCompactTimeReport.browserPath, "iab", "dashboard compact time evidence must use in-app browser");
assert.equal(dashboardCompactTimeReport.results?.length, 2, "dashboard compact time evidence must cover admin and coach dashboards");
for (const page of dashboardCompactTimeReport.results ?? []) {
  assert(["admin-dashboard", "coach-dashboard"].includes(page.name), `${page.name} dashboard compact time evidence must use expected page`);
  assert.deepEqual(page.viewport, { width: 390, height: 844 }, `${page.name} dashboard compact time evidence must use mobile viewport`);
  assert(page.compactRangeHits?.length >= 2, `${page.name} dashboard must render compact 24-hour time ranges`);
  assert.equal(page.verboseTimeHits?.length ?? 0, 0, `${page.name} dashboard must not render verbose AM/PM time ranges`);
  assert.equal(page.hasDashboardHeader, true, `${page.name} dashboard compact time evidence must render dashboard header`);
  assert.equal(page.hasClassList, true, `${page.name} dashboard compact time evidence must render class list content`);
  assert.equal(page.hasLoadingCopy, false, `${page.name} dashboard compact time evidence must reach service content`);
  assert.equal(page.hasFrameworkOverlay, false, `${page.name} dashboard compact time evidence must not show a framework overlay`);
  assert.equal(page.horizontalOverflow, 0, `${page.name} dashboard compact time evidence must not have horizontal overflow`);
  assert(page.screenshot && existsSync(page.screenshot), `${page.name} dashboard compact time screenshot must exist`);
  assert(statSync(page.screenshot).size > 10_000, `${page.name} dashboard compact time screenshot must be non-empty`);
}
for (const screenshotFile of [
  ".data/mobile-builds/ios/dashboard-compact-time-20260623/admin-dashboard-compact-time-ios-sim.jpg",
  ".data/mobile-builds/ios/dashboard-compact-time-20260623/admin-dashboard-compact-time-ios-sim-classes.jpg",
]) {
  assert(existsSync(screenshotFile), `${screenshotFile} must exist`);
  assert(statSync(screenshotFile).size > 10_000, `${screenshotFile} must be a non-empty simulator screenshot`);
}

assertIncludes(sources.format, "hour12: false", "shared date-time formatter uses compact 24-hour time");

assertIncludes(sources.dashboardScreen, 'title: promotionResultNotice ? "승급 심사 결과" : "다음 심사 준비"', "guardian learning notice preview compact title");
assertIncludes(sources.dashboardScreen, "compactText(promotionResultNotice.body, 32)", "guardian learning notice preview compact body");
assertIncludes(sources.dashboardScreen, "compactText(tournamentNotice.body, 32)", "guardian learning tournament preview compact body");
assert.equal(guardianLearningPreviewCompactReport.ok, true, "guardian learning preview compact evidence must pass");
assert.equal(guardianLearningPreviewCompactReport.browserPath, "iab", "guardian learning preview evidence must use in-app browser");
assert.deepEqual(
  guardianLearningPreviewCompactReport.viewport,
  { width: 390, height: 844 },
  "guardian learning preview evidence must use mobile viewport",
);
assert.equal(guardianLearningPreviewCompactReport.longLearningBlocks?.length ?? 0, 0, "guardian learning preview must not render long notice blocks");
assert.equal(guardianLearningPreviewCompactReport.hasPromotionPreview, true, "guardian learning preview must keep promotion result preview");
assert.equal(guardianLearningPreviewCompactReport.hasTournamentPreview, true, "guardian learning preview must keep tournament preview");
assert.equal(guardianLearningPreviewCompactReport.hasLearningReport, true, "guardian learning preview must keep learning report sections");
assert.equal(guardianLearningPreviewCompactReport.hasLoadingCopy, false, "guardian learning preview evidence must reach service content");
assert.equal(guardianLearningPreviewCompactReport.hasFrameworkOverlay, false, "guardian learning preview evidence must not show a framework overlay");
assert.equal(guardianLearningPreviewCompactReport.horizontalOverflow, 0, "guardian learning preview evidence must not have horizontal overflow");
assert(
  guardianLearningPreviewCompactReport.screenshot && existsSync(guardianLearningPreviewCompactReport.screenshot),
  "guardian learning preview browser screenshot must exist",
);
assert(
  statSync(guardianLearningPreviewCompactReport.screenshot).size > 10_000,
  "guardian learning preview browser screenshot must be non-empty",
);
for (const screenshotFile of [
  ".data/mobile-builds/ios/guardian-learning-preview-compact-20260623/guardian-learning-preview-compact-ios-sim.jpg",
  ".data/mobile-builds/ios/guardian-learning-preview-compact-20260623/guardian-learning-preview-compact-ios-sim-preview.jpg",
]) {
  assert(existsSync(screenshotFile), `${screenshotFile} must exist`);
  assert(statSync(screenshotFile).size > 10_000, `${screenshotFile} must be a non-empty simulator screenshot`);
}
assertIncludes(sources.membersScreen, "return formatDateTime(value);", "member counseling note date uses shared compact formatter");
assert.equal(memberNoteDateTimeReport.ok, true, "member note date-time evidence must pass");
assert.equal(memberNoteDateTimeReport.browserPath, "iab", "member note date-time evidence must use in-app browser");
assert.equal(memberNoteDateTimeReport.results?.length, 2, "member note date-time evidence must cover coach and guardian member screens");
for (const page of memberNoteDateTimeReport.results ?? []) {
  assert(["coach-members", "guardian-members"].includes(page.name), `${page.name} member note date-time evidence must use expected page`);
  assert.deepEqual(page.viewport, { width: 390, height: 844 }, `${page.name} member note date-time evidence must use mobile viewport`);
  assert(page.compactDateTimeHits?.length > 0, `${page.name} member note must render compact 24-hour date-time labels`);
  assert.equal(page.verboseDateTimeHits?.length ?? 0, 0, `${page.name} member note must not render verbose AM/PM date-time labels`);
  assert.equal(page.noteSection, true, `${page.name} member note evidence must render counseling note section`);
  assert.equal(page.hasLoadingCopy, false, `${page.name} member note evidence must reach service content`);
  assert.equal(page.hasFrameworkOverlay, false, `${page.name} member note evidence must not show a framework overlay`);
  assert.equal(page.horizontalOverflow, 0, `${page.name} member note evidence must not have horizontal overflow`);
  assert(page.screenshot && existsSync(page.screenshot), `${page.name} member note screenshot must exist`);
  assert(statSync(page.screenshot).size > 10_000, `${page.name} member note screenshot must be non-empty`);
}
for (const screenshotFile of [
  ".data/mobile-builds/ios/member-note-datetime-20260623/guardian-members-note-datetime-ios-sim.jpg",
  ".data/mobile-builds/ios/member-note-datetime-20260623/guardian-members-note-datetime-ios-sim-notes.jpg",
]) {
  assert(existsSync(screenshotFile), `${screenshotFile} must exist`);
  assert(statSync(screenshotFile).size > 10_000, `${screenshotFile} must be a non-empty simulator screenshot`);
}

assert.equal(continuousPolishScanReport.ok, true, "continuous polish scan evidence must pass");
assert.equal(continuousPolishScanReport.browserPath, "iab", "continuous polish scan evidence must use in-app browser");
const activeContinuousPolishPages = (continuousPolishScanReport.results ?? []).filter((page) => !page.name.includes("requests"));
assert.equal(activeContinuousPolishPages.length, 11, "continuous polish scan must cover 11 active core role routes");
for (const page of activeContinuousPolishPages) {
  assert.deepEqual(page.viewport, { width: 390, height: 844 }, `${page.name} polish scan must use mobile viewport`);
  assert.equal(page.internalHits?.length ?? 0, 0, `${page.name} polish scan must not expose internal/dummy wording`);
  assert.equal(page.verboseDateTimeHits?.length ?? 0, 0, `${page.name} polish scan must not expose verbose AM/PM date-times`);
  assert.equal(page.verboseRangeHits?.length ?? 0, 0, `${page.name} polish scan must not expose verbose AM/PM time ranges`);
  assert.equal(page.longBlockCount ?? 0, 0, `${page.name} polish scan must not expose long visible mobile copy blocks`);
  assert.equal(page.hasLoadingCopy, false, `${page.name} polish scan must reach service content`);
  assert.equal(page.hasFrameworkOverlay, false, `${page.name} polish scan must not show a framework overlay`);
  assert.equal(page.horizontalOverflow, 0, `${page.name} polish scan must not have horizontal overflow`);
  assert(page.visibleTextLength > 80, `${page.name} polish scan must render service content`);
  assert(page.screenshot && existsSync(page.screenshot), `${page.name} polish scan screenshot must exist`);
  assert(statSync(page.screenshot).size > 10_000, `${page.name} polish scan screenshot must be non-empty`);
}

assertIncludes(sources.membersScreen, "editingContactMemberId", "member contact edit collapsed state");
assertIncludes(sources.membersScreen, 'params.get("contact") === "1" || window.location.hash === "#edit-contact"', "member contact edit deep link");
assertIncludes(sources.membersScreen, 'data-testid={!canManageMembers ? "family-member-contact-form" : undefined}', "member contact edit focused form marker");
assertIncludes(sources.membersScreen, 'size="touch" type="button" variant="secondary"', "member contact edit collapsed action keeps touch height");
assertIncludes(sources.membersScreen, 'size="touch"', "member contact edit save action keeps touch height");
assertIncludes(sources.membersScreen, "연락처 수정", "member and guardian contact edit collapsed action");
assertIncludes(sources.membersScreen, "긴급 연락처 수정", "member and guardian contact edit focused form title");
assertIncludes(sources.membersScreen, "const showMembersScreenHeader = !isFamilyRole;", "member and guardian repeated members header hidden");
assertIncludes(
  sources.membersScreen,
  'data-testid={isFamilyRole ? "family-member-profile-card" : isCoachRole ? "coach-member-profile-card" : undefined}',
  "member, guardian, and coach compact profile card marker",
);
assertIncludes(sources.membersScreen, 'data-testid="family-member-alert-strip"', "member and guardian safety notes use a compact alert strip");
assertIncludes(sources.membersScreen, "min-h-11 min-w-0 items-center gap-2", "member and guardian safety notes keep a stable 44px scan height");
assertIncludes(sources.membersScreen, 'note.visibility === "guardian_visible"', "member and guardian feedback only uses family-visible notes");
assertIncludes(sources.membersScreen, 'data-testid={isFamilyRole ? "family-member-feedback-heading" : undefined}', "member and guardian feedback heading marker");
assertIncludes(sources.membersScreen, '"family-member-feedback-card"', "member and guardian feedback card marker");
assert.equal(memberContactEditCollapseReport.ok, true, "member contact edit collapse evidence must pass");
assert.equal(memberContactEditCollapseReport.browserPath, "iab", "member contact edit collapse evidence must use in-app browser");
assert.equal(memberContactEditCollapseReport.results?.length, 3, "member contact edit collapse evidence must cover guardian/member/admin screens");
for (const page of memberContactEditCollapseReport.results ?? []) {
  assert.deepEqual(page.viewport, { width: 390, height: 844 }, `${page.name} contact edit collapse evidence must use mobile viewport`);
  assert.equal(page.hasContactDisplay, true, `${page.name} contact edit collapse evidence must keep visible contact display`);
  assert.equal(page.collapsedForFamily, true, `${page.name} contact edit collapse evidence must keep member/guardian edit form collapsed`);
  assert.equal(page.manageFormVisible, true, `${page.name} contact edit collapse evidence must keep admin manage form visible`);
  assert.equal(page.hasLoadingCopy, false, `${page.name} contact edit collapse evidence must reach service content`);
  assert.equal(page.hasFrameworkOverlay, false, `${page.name} contact edit collapse evidence must not show a framework overlay`);
  assert.equal(page.horizontalOverflow, 0, `${page.name} contact edit collapse evidence must not have horizontal overflow`);
  assert(page.screenshot && existsSync(page.screenshot), `${page.name} contact edit collapse screenshot must exist`);
  assert(statSync(page.screenshot).size > 10_000, `${page.name} contact edit collapse screenshot must be non-empty`);
}
assert.equal(memberContactEditCollapseReport.guardianOpenCheck?.ok, true, "guardian contact edit button must open focused contact form");
assert.deepEqual(
  memberContactEditCollapseReport.guardianOpenCheck?.viewport,
  { width: 390, height: 844 },
  "guardian contact edit open evidence must use mobile viewport",
);
assert(
  memberContactEditCollapseReport.guardianOpenCheck?.screenshot && existsSync(memberContactEditCollapseReport.guardianOpenCheck.screenshot),
  "guardian contact edit open screenshot must exist",
);
assert(
  statSync(memberContactEditCollapseReport.guardianOpenCheck.screenshot).size > 10_000,
  "guardian contact edit open screenshot must be non-empty",
);
assert.equal(memberManagementFormCollapseReport.ok, true, "member management form collapse evidence must pass");
assert.equal(
  memberManagementFormCollapseReport.verified?.inviteFormCollapsedByDefault,
  true,
  "member management invite form must stay collapsed by default",
);
assert.equal(
  memberManagementFormCollapseReport.verified?.createFormCollapsedByDefault,
  true,
  "member management create form must stay collapsed by default",
);
assert(
  memberManagementFormCollapseReport.verified?.toggleTouchHeight >= 44,
  "member management collapsed toggles must keep 44px touch height",
);
assert.equal(
  memberManagementFormCollapseReport.verified?.openFormsStillRenderInputs,
  true,
  "member management collapse evidence must prove opened forms still render inputs",
);
assert.equal(
  memberManagementFormCollapseReport.verified?.horizontalOverflow,
  0,
  "member management collapsed forms must not introduce horizontal overflow",
);
assert.equal(
  memberManagementFormCollapseReport.verified?.iosSimulatorNoBrowserChrome,
  true,
  "member management form collapse evidence must include iOS Simulator app chrome proof",
);
for (const screenshot of memberManagementFormCollapseReport.screenshots ?? []) {
  assert(screenshot.path && existsSync(screenshot.path), `${screenshot.path} must exist`);
  assert(statSync(screenshot.path).size > 10_000, `${screenshot.path} must be a non-empty member management form screenshot`);
}
assert.equal(classCreateFormCollapseReport.ok, true, "class create form collapse evidence must pass");
assert.equal(
  classCreateFormCollapseReport.verified?.createFormCollapsedByDefault,
  true,
  "class create form must stay collapsed by default",
);
assert(
  classCreateFormCollapseReport.verified?.toggleTouchHeight >= 44,
  "class create collapsed toggle must keep 44px touch height",
);
assert.equal(
  classCreateFormCollapseReport.verified?.openFormStillRendersInputs,
  true,
  "class create collapse evidence must prove opened form still renders inputs",
);
assert.equal(
  classCreateFormCollapseReport.verified?.horizontalOverflow,
  0,
  "class create collapsed form must not introduce horizontal overflow",
);
assert.equal(
  classCreateFormCollapseReport.verified?.iosSimulatorNoBrowserChrome,
  true,
  "class create form collapse evidence must include iOS Simulator app chrome proof",
);
for (const screenshot of classCreateFormCollapseReport.screenshots ?? []) {
  assert(screenshot.path && existsSync(screenshot.path), `${screenshot.path} must exist`);
  assert(statSync(screenshot.path).size > 10_000, `${screenshot.path} must be a non-empty class create form screenshot`);
}
assert.equal(memberProfileGuardianSyncReport.ok, true, "member profile and guardian sync evidence must pass");
assert.equal(
  memberProfileGuardianSyncReport.verified?.memberProfileSavePersists,
  true,
  "member profile sync evidence must prove member profile save persists",
);
assert.equal(
  memberProfileGuardianSyncReport.verified?.linkedUserAccountSyncsFromMemberProfile,
  true,
  "member profile save must sync linked member app account",
);
assert.equal(
  memberProfileGuardianSyncReport.verified?.adminUsersListReflectsMemberProfile,
  true,
  "admin users list must reflect saved member profile values",
);
assert.equal(
  memberProfileGuardianSyncReport.verified?.guardianChangeActionVisible,
  true,
  "guardian link change action must be visible for existing guardian links",
);
assert.equal(
  memberProfileGuardianSyncReport.verified?.guardianChangeReplacesExistingGuardian,
  true,
  "guardian change flow must replace an existing guardian link",
);
assert.equal(
  memberProfileGuardianSyncReport.verified?.guardianChildLinksStayBidirectional,
  true,
  "guardian change flow must keep member and guardian child links bidirectional",
);
for (const screenshot of memberProfileGuardianSyncReport.screenshots ?? []) {
  assert(screenshot.path && existsSync(screenshot.path), `${screenshot.path} must exist`);
  assert(statSync(screenshot.path).size > 10_000, `${screenshot.path} must be a non-empty member profile guardian sync screenshot`);
}
assert.equal(memberProfileDraftSyncReport.ok, true, "member profile draft sync evidence must pass");
assert.equal(
  memberProfileDraftSyncReport.verified?.memberProfileSummaryReflectsSave,
  true,
  "member profile draft sync must prove saved age/contact values update the visible summary",
);
assert.equal(
  memberProfileDraftSyncReport.verified?.minorGuardianWarningAppearsBeforeLink,
  true,
  "member profile draft sync must show the minor guardian warning after changing an adult to youth/teen",
);
assert.equal(
  memberProfileDraftSyncReport.verified?.guardianFeedbackRemainsVisibleAfterSave,
  true,
  "member profile draft sync must keep guardian save feedback visible after the link form collapses",
);
assert.equal(
  memberProfileDraftSyncReport.verified?.guardianRowShowsPhone,
  true,
  "member profile draft sync must show the linked guardian phone on the current guardian row",
);
assert.equal(
  memberProfileDraftSyncReport.verified?.reentryPersistsSavedProfileAndGuardian,
  true,
  "member profile draft sync must persist saved profile and guardian link after reload",
);
assert.equal(
  memberProfileDraftSyncReport.verified?.horizontalOverflow,
  0,
  "member profile draft sync must not introduce horizontal overflow on mobile",
);
assert.equal(
  memberProfileDraftSyncReport.verified?.iosScreenshotEvidence,
  true,
  "member profile draft sync must include iOS Simulator screenshot evidence",
);
for (const screenshot of memberProfileDraftSyncReport.screenshots ?? []) {
  assert(screenshot.path && existsSync(screenshot.path), `${screenshot.path} must exist`);
  assert(statSync(screenshot.path).size > 10_000, `${screenshot.path} must be a non-empty member profile draft sync screenshot`);
}
assert(memberProfileDraftSyncReport.ios?.screenshot?.path, "member profile draft sync iOS screenshot path must be recorded");
assert(existsSync(memberProfileDraftSyncReport.ios.screenshot.path), "member profile draft sync iOS screenshot must exist");
assert(
  statSync(memberProfileDraftSyncReport.ios.screenshot.path).size > 10_000,
  "member profile draft sync iOS screenshot must be non-empty",
);
assert.equal(familyContactEditDeepLinkReport.ok, true, "family contact edit deep-link iOS evidence must pass");
assert.equal(
  familyContactEditDeepLinkReport.surface,
  "/app/members?contact=1",
  "family contact edit deep-link evidence must target the contact deep link",
);
assert.equal(
  familyContactEditDeepLinkReport.implementation?.hydration,
  "contact deep link is read inside useEffect after data load and opened on a timer tick",
  "family contact edit deep-link evidence must preserve hydration-safe opening",
);
assert.equal(
  familyContactEditDeepLinkReport.implementation?.apiChanged,
  false,
  "family contact edit deep-link evidence must not change member APIs",
);
assert.equal(
  familyContactEditDeepLinkReport.releaseDecision,
  "internal_simulator_evidence_only_not_ipa_ready",
  "family contact edit deep-link evidence must not be treated as IPA readiness",
);
assert.deepEqual(
  familyContactEditDeepLinkReport.screenshots?.map((screenshot) => screenshot.role).sort(),
  ["guardian", "member"],
  "family contact edit deep-link evidence must cover member and guardian",
);
for (const screenshot of familyContactEditDeepLinkReport.screenshots ?? []) {
  assert(screenshot.path && existsSync(screenshot.path), `${screenshot.path} must exist`);
  assert(statSync(screenshot.path).size > 10_000, `${screenshot.path} must be a non-empty contact edit simulator screenshot`);
  assert(
    (screenshot.verified ?? []).some((item) => item.includes("contact=1 deep link opens")),
    `${screenshot.role} contact edit evidence must verify contact deep-link opening`,
  );
  assert(
    (screenshot.verified ?? []).some((item) => item.includes("touch-sized controls")),
    `${screenshot.role} contact edit evidence must verify touch-sized controls`,
  );
}
assert(
  existsSync(".data/mobile-builds/ios/member-contact-edit-collapse-20260623/guardian-members-contact-edit-collapse-ios-sim.jpg"),
  "guardian contact edit collapse iOS simulator screenshot must exist",
);
assert(
  statSync(".data/mobile-builds/ios/member-contact-edit-collapse-20260623/guardian-members-contact-edit-collapse-ios-sim.jpg").size > 10_000,
  "guardian contact edit collapse iOS simulator screenshot must be non-empty",
);

for (const snippet of [
	  'const isFamilyRole = context.user.role === "member" || context.user.role === "guardian";',
	  'data-testid={isFamilyRole ? `family-class-card-${session.id}` : isCoachRole ? `coach-class-card-${session.id}` : undefined}',
	  'data-testid={`family-attendance-chip-grid-${session.id}`}',
	  'data-testid={`family-attendance-chip-${session.id}-${member.id}`}',
	  '"flex flex-col gap-1.5 pb-1.5"',
	  '"grid grid-cols-[minmax(0,1fr)_11rem] items-start gap-2 border-b border-zinc-100 pb-1.5"',
	  '"flex flex-col gap-2 border-b border-zinc-100 pb-3"',
	  'isFamilyRole || isCoachRole ? "text-[11px] leading-4" : "text-sm leading-5"',
	  'truncate text-[11px] leading-4 text-zinc-600',
	  'visibleMembers.length > 1 ? "grid-cols-2" : "grid-cols-1"',
	  "{canEditAttendance ? (",
	]) {
  assertIncludes(sources.classesScreen, snippet, "member and guardian inline class attendance status");
}
for (const snippet of [
		  'isFamilyRole ? "px-2.5 py-2" : isCoachRole ? "px-3 py-2" : "p-3"',
	  'data-testid={`coach-class-attendance-summary-${session.id}`}',
	  'data-testid="coach-mobile-speed-summary-line"',
	  "function needsAttendanceReason(record: AttendanceRecord | undefined)",
	  "showReasonRequiredOnly && !needsAttendanceReason(attendanceRecord)",
	  "setShowReasonRequiredOnly(true);",
	  '<span className="whitespace-nowrap">사유 필요 {coachReasonRequiredRecords.length}</span>',
	  "`사유 필요 ${coachReasonRequiredRecords.length}명`",
	  'className="mt-1 h-1.5 rounded-full bg-zinc-100"',
	  'isCoachRole ? ` · ${session.level}` : ""',
	  "isCoachRole ? null : (",
	]) {
  assertIncludes(sources.classesScreen, snippet, "coach class compact attendance summary");
}
for (const snippet of [
  "const firstReasonRequiredStatus",
  "setAttendanceStatusFilter(firstReasonRequiredStatus)",
  '<span className="whitespace-nowrap">사유 {coachReasonRequiredRecords.length}</span>',
  "`사유 ${coachReasonRequiredRecords.length}명`",
]) {
  assertExcludes(sources.classesScreen, snippet, "coach reason quick action must not fall back to a single status filter");
}
for (const snippet of [
  "function getPersonalAttendanceSummaryLabel",
  "function getPersonalAttendanceStatusText",
  'data-testid={`personal-attendance-summary-${session.id}`}',
]) {
  assertExcludes(sources.classesScreen, snippet, "member and guardian class attendance summary duplication");
}
assert.equal(familyClassPersonalAttendanceReport.ok, true, "family class personal attendance evidence must pass");
assert.equal(familyClassPersonalAttendanceReport.browserPath, "iab", "family class personal attendance evidence must use in-app browser");
assert.equal(familyClassPersonalAttendanceReport.results?.length, 3, "family class personal attendance evidence must cover member, guardian, and coach");
for (const page of familyClassPersonalAttendanceReport.results ?? []) {
  assert.deepEqual(page.viewport, { width: 390, height: 844 }, `${page.name} family class evidence must use mobile viewport`);
  assert.equal(page.hasLoadingCopy, false, `${page.name} family class evidence must reach service content`);
  assert.equal(page.hasFrameworkOverlay, false, `${page.name} family class evidence must not show a framework overlay`);
  assert.equal(page.horizontalOverflow, 0, `${page.name} family class evidence must not have horizontal overflow`);
  assert(page.screenshot && existsSync(page.screenshot), `${page.name} family class screenshot must exist`);
  assert(statSync(page.screenshot).size > 10_000, `${page.name} family class screenshot must be non-empty`);

  if (["member-classes", "guardian-classes"].includes(page.name)) {
    assert.equal(page.hasPersonalSummary, false, `${page.name} must keep attendance status in inline rows/chips only`);
    assert.equal(page.hasOperationalClassSummary, false, `${page.name} must not show class capacity/processing metrics`);
    assert.equal(page.hasAttendanceProgressbar, false, `${page.name} must not show coach attendance progress bar`);
    assert.equal(page.hasWholeClassAttendanceAction, false, `${page.name} must not show whole-class attendance action`);
  }

  if (page.name === "coach-classes") {
    assert.equal(page.hasOperationalClassSummary, true, "coach classes must keep attendance operation summary");
    assert.equal(page.hasAttendanceProgressbar, true, "coach classes must keep attendance progress bar");
    assert.equal(page.hasWholeClassAttendanceAction, true, "coach classes must keep whole-class attendance action");
  }
}
assert(
  existsSync(".data/mobile-builds/ios/family-class-personal-attendance-20260623/guardian-classes-personal-attendance-ios-sim.jpg"),
  "guardian personal class attendance iOS simulator screenshot must exist",
);
assert(
  statSync(".data/mobile-builds/ios/family-class-personal-attendance-20260623/guardian-classes-personal-attendance-ios-sim.jpg").size > 10_000,
  "guardian personal class attendance iOS simulator screenshot must be non-empty",
);

for (const screenshotFile of screenshotFiles) {
  assert(existsSync(screenshotFile), `${screenshotFile} must exist`);
  assert(statSync(screenshotFile).size > 10_000, `${screenshotFile} must be a non-empty simulator screenshot`);
}

for (const screenshotFile of kpiCardScreenshotFiles) {
  assert(existsSync(screenshotFile), `${screenshotFile} must exist`);
  assert(statSync(screenshotFile).size > 10_000, `${screenshotFile} must be a non-empty KPI card simulator screenshot`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "P5-P10 internal release/audit cards are not rendered inside the app",
        "P5-P10 simulator screenshots for admin settings/coach/member/guardian",
        "P1 readiness remains blocked 7/7",
        "Android and iOS release blockers remain separated",
        "P1 operator status exposes the current Android Play AAB/APK release report",
        "coach mobile save status panel has reserved scroll space above bottom navigation",
        "Next dev indicator does not cover mobile bottom navigation in simulator evidence",
        "autoLogin same-session deep links land on real service screens",
        "README/QA/release/backlog P5-P10 documentation",
        "P5-P10 JSON/Markdown internal audit artifact",
        "admin and owner KPI card v2 simulator evidence",
        "dummy-data cleanup simulator evidence for guardian/coach/owner",
        "coach compact save status panel browser and iOS simulator evidence",
        "request route files stay deleted without request cards, forms, or actions",
        "native app runtime hides browser/PWA install card",
        "expanded 36 route/role visible copy screenshots are present",
        "20 owner/coach/member/guardian routes pass visible dummy/internal copy and overflow audit",
        "operator, member, and guardian members screens plus dashboard/classes/payments/notices/account screens pass visible app copy stability scan",
        "8 admin/owner/coach/member/guardian routes pass fresh visible copy recheck",
        "22 owner/coach/member/guardian follow-up routes pass latest visible copy and console scan",
        "payments/owner branches compact empty copy render report passes",
        "member dashboard loading copy uses app-safe wording and reaches service content",
        "login network error copy hides raw Load failed/local-server wording",
        "login signup entry remains phone-number based with browser and iOS simulator evidence",
        "auth role shortcut measurement excludes phone signup submit copy and keeps select-role touch targets",
        "registered login completion copy has visible scan and iOS simulator evidence",
        "admin invitation approval has iOS simulator evidence and API login verification",
	        "admin users pending invitations surface first with iOS simulator evidence",
	        "admin users pending invitation approval action has a visible label with iOS simulator evidence",
	        "runtime DB has no leftover admin invitation evidence users",
	        "adult member and guardian child payment checkout preparation stays API-free with iOS simulator evidence",
	        "owner manual payment creation persists once with pending feedback and browser/iOS evidence",
	        "member contact formatting evidence hides raw +82 seed/intake phone values",
        "affected empty-state routes hide old waiting copy in mobile browser evidence",
        "dashboard/members empty-state helper copy remains title-only in mobile browser evidence",
        "notification and protected-route app copy stays compact in mobile browser evidence",
        "admin settings incident role select copy stays app-safe in mobile browser evidence",
        "admin settings pilot password label stays account-specific in mobile browser evidence",
        "8 active key role routes pass continuous visible copy, loading, overflow, and console scan",
	        "member dashboard next class time stays compact on mobile",
	        "coach attendance status filters wrap without mobile horizontal crop",
	        "coach class rosters stay collapsed by default and open on demand",
	        "admin user edit form exposes optional password change fields directly",
	        "owner reports export and period controls keep 44px touch targets",
		        "request routes stay deleted and no longer require request-list mobile evidence",
        "admin settings hides internal P2/P3 development boards from app UI",
        "admin settings hides internal release/development wording from visible app UI",
        "coach class list uses compact mobile class time ranges",
        "admin and coach dashboards use compact mobile class time ranges",
        "notice/payment/audit timestamps use compact 24-hour labels",
        "guardian learning dashboard keeps promotion and tournament previews compact",
        "coach and guardian member note timestamps use compact 24-hour labels",
        "11 active core role routes pass continuous polish scan for internal wording, long copy, time labels, overflow, and overlays",
        "member and guardian contact edit forms stay collapsed until requested while admin management remains visible",
        "owner and admin member invite/create forms stay collapsed until requested",
        "owner member management invite/create/status/profile/guardian/note controls keep 44px touch targets with iOS simulator evidence",
        "admin user management invite/edit/delete/password reset controls keep 44px touch targets with iOS simulator evidence",
        "member and guardian contact edit deep link opens compact touch-sized mobile form with iOS simulator evidence",
        "member and guardian members screens hide repeated title/search header and keep compact profile cards",
        "member and guardian dashboards do not expose deleted request compose links",
        "guardian dashboard learning report keeps compact payment/notice action strip",
        "pilot import missing phone fallback avoids dummy missing-value copy",
        "stale demo seed date rolling member dashboard evidence is present",
        "admin change record rendered copy uses app-safe wording",
        "admin change record privacy, readable detail rows, and iOS deep-link evidence",
        "admin change record short-window read retries persist one audit entry",
        "admin change record date-only range includes the full Korea day",
        "admin change record rejects reversed date ranges in the form and API",
        "notifications inbox has dedicated iOS simulator evidence",
        "member and guardian notification inbox density has iOS simulator evidence",
        "guardian notification rows stay compact with iOS simulator evidence",
		        "notification single read action has iOS simulator and API persistence evidence",
		        "read notice tone-down has iOS simulator evidence",
		        "operator notice empty search keeps 44px controls with refreshed iOS simulator evidence",
		        "owner dashboard branch comparison keeps refreshed 24px clearance with iOS simulator evidence",
		        "FINAL wordmark keeps zero letter spacing with iOS simulator evidence",
		        "member and guardian notification settings stay hidden with always-on policy evidence",
        "admin branch selected scope hides non-selected branches and branch creation controls",
      ],
      screenshots: [
        ...screenshotFiles,
        ...kpiCardScreenshotFiles,
        adminSettingsPilotLabelReport.screenshot,
        ...activeContinuousVisibleCopyPages.map((page) => page.screenshot),
        memberDashboardScheduleCompactReport.screenshot,
        coachAttendanceFilterGridReport.screenshot,
        adminSettingsInternalStageHiddenReport.screenshot,
	        adminSettingsOpsWordingReport.screenshot,
	        notificationsInboxEvidenceReport.screenshot.path,
	        notificationInboxDensityEvidenceReport.memberScreenshot.path,
		        notificationInboxDensityEvidenceReport.guardianScreenshot.path,
		        notificationReadActionEvidenceReport.screenshot.path,
			        readNoticeToneDownEvidenceReport.screenshot.path,
			        operatorListSearchTouchReport.iosSimulator.screenshot,
			        ownerDashboardDetailToggleReport.screenshotPath,
			        finalWordmarkLetterSpacingReport.iosSimulator.screenshot,
			        authRegisteredCopyReport.screenshot.path,
	        familyNotificationSettingsHiddenReport.screenshot.path,
	        familyNotificationSettingsHiddenReport.guardianScreenshot.path,
	        familyNotificationAlwaysOnGuardReport.memberScreenshot.path,
	        familyNotificationAlwaysOnGuardReport.guardianScreenshot.path,
	        adminBranchSelectedScopeReport.screenshotPath,
	        coachClassCompactTimeReport.screenshot,
        ...dashboardCompactTimeReport.results.map((page) => page.screenshot),
        ".data/mobile-builds/ios/dashboard-compact-time-20260623/admin-dashboard-compact-time-ios-sim.jpg",
        ".data/mobile-builds/ios/dashboard-compact-time-20260623/admin-dashboard-compact-time-ios-sim-classes.jpg",
        guardianLearningPreviewCompactReport.screenshot,
        ".data/mobile-builds/ios/guardian-learning-preview-compact-20260623/guardian-learning-preview-compact-ios-sim.jpg",
        ".data/mobile-builds/ios/guardian-learning-preview-compact-20260623/guardian-learning-preview-compact-ios-sim-preview.jpg",
        ...memberNoteDateTimeReport.results.map((page) => page.screenshot),
        ".data/mobile-builds/ios/member-note-datetime-20260623/guardian-members-note-datetime-ios-sim.jpg",
        ".data/mobile-builds/ios/member-note-datetime-20260623/guardian-members-note-datetime-ios-sim-notes.jpg",
        ...activeContinuousPolishPages.map((page) => page.screenshot),
        ...memberContactEditCollapseReport.results.map((page) => page.screenshot),
        memberContactEditCollapseReport.guardianOpenCheck.screenshot,
        ".data/mobile-builds/ios/member-contact-edit-collapse-20260623/guardian-members-contact-edit-collapse-ios-sim.jpg",
        ...familyContactEditDeepLinkReport.screenshots.map((screenshot) => screenshot.path),
        ...memberManagementFormCollapseReport.screenshots.map((screenshot) => screenshot.path),
        ...memberManagementFormCollapseReport.iosSimulator.screenshots.map((screenshot) => screenshot.path),
        ...adminUserManagementTouchTargetsReport.screenshots.map((screenshot) => screenshot.path),
        adminUserManagementTouchTargetsReport.iosSimulator.screenshot.path,
        ...familyClassPersonalAttendanceReport.results.map((page) => page.screenshot),
        ".data/mobile-builds/ios/family-class-personal-attendance-20260623/guardian-classes-personal-attendance-ios-sim.jpg",
        ...memberDashboardPaymentCheckoutLinkReport.screenshots.map((screenshot) => screenshot.path),
        ...Object.values(paymentCreateTouchTargetsReport.screenshots ?? {}).map((screenshot) => screenshot.path),
        ...manualPaymentCreateFeedbackReport.screenshots.map((screenshot) => screenshot.path),
        adminUserDeletePolicyFeedbackReport.screenshot.path,
      ],
    },
    null,
    2,
  ),
);
