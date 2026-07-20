import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { resetOwnedSmokeServer } from "./lib/release-smoke-environment.mjs";

const scriptArgs = process.argv.slice(2);
const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.VISIBLE_APP_COPY_OUT_DIR ?? ".data/mobile-builds/ios/visible-app-copy-stability";
const chromeCandidates = [
  process.env.E2E_CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const publicCases = [
  { id: "auth-login", url: "/login" },
  { id: "auth-login-registered", url: "/login?registered=1" },
  { id: "auth-signup", url: "/signup" },
  { id: "auth-reset-password", url: "/reset-password" },
  { id: "auth-invite-accept", url: "/invite/visible-copy-check" },
  { id: "auth-select-role", url: "/select-role" },
];

const appCases = [
  { id: "admin-settings", role: "admin", next: "/app/admin/settings" },
  { id: "admin-users", role: "admin", next: "/app/admin/users" },
  { id: "admin-branches", role: "admin", next: "/app/admin/branches" },
  { id: "admin-roles", role: "admin", next: "/app/admin/roles" },
  { id: "admin-audit", role: "admin", next: "/app/admin/audit-logs?action=attendance.update" },
  { id: "admin-members", role: "admin", next: "/app/members" },
  { id: "admin-notices", role: "admin", next: "/app/notices" },
  { id: "admin-account", role: "admin", next: "/app/account" },
  { id: "owner-dashboard", role: "owner", next: "/app/dashboard" },
  { id: "owner-members", role: "owner", next: "/app/members" },
  { id: "owner-branches", role: "owner", next: "/app/owner/branches" },
  { id: "owner-reports", role: "owner", next: "/app/owner/reports" },
  { id: "owner-notices", role: "owner", next: "/app/notices" },
  { id: "owner-account", role: "owner", next: "/app/account" },
  { id: "coach-dashboard", role: "coach", next: "/app/dashboard" },
  { id: "coach-classes", role: "coach", next: "/app/classes" },
  { id: "coach-members", role: "coach", next: "/app/members" },
  { id: "coach-notices", role: "coach", next: "/app/notices" },
  { id: "coach-account", role: "coach", next: "/app/account" },
  { id: "member-dashboard", role: "member", next: "/app/dashboard" },
  { id: "member-classes", role: "member", next: "/app/classes" },
  { id: "member-members", role: "member", next: "/app/members" },
  { id: "member-payments", role: "member", next: "/app/payments" },
  { id: "member-notices", role: "member", next: "/app/notices" },
  { id: "member-notifications", role: "member", next: "/app/notifications" },
  { id: "guardian-dashboard", role: "guardian", next: "/app/dashboard" },
  { id: "guardian-classes", role: "guardian", next: "/app/classes" },
  { id: "guardian-members", role: "guardian", next: "/app/members" },
  { id: "guardian-payments", role: "guardian", next: "/app/payments" },
  { id: "guardian-notices", role: "guardian", next: "/app/notices" },
  { id: "guardian-notifications", role: "guardian", next: "/app/notifications" },
  { id: "member-account", role: "member", next: "/app/account" },
  { id: "guardian-account", role: "guardian", next: "/app/account" },
];

const cases = [...publicCases, ...appCases];

const blockedVisibleCopyPattern =
  /더미|dummy|샘플|sample|테스트|test@|@finaljudo\.test|\.test|localhost|127\.0\.0\.1|example\.com|FinalJudoPilot|데모|mock|P[0-9]|npm run|release|ready|blocked|readiness|doctor|audit|handoff|IPA|APK|provisioning|Simulator|CSV|TODO|placeholder|릴리즈|인수인계|시뮬레이터|출시 판단/i;
const blockedFormPlaceholderPattern = /010[-\s]?0{3,4}[-\s]?0{4}|010[-\s]?1234[-\s]?5678|홍길동|example\.com|name@example|email@example/i;
const visibleCopyRuntimeDbFile = process.env.PILOT_DB_FILE?.trim()
  ? process.env.PILOT_DB_FILE.trim()
  : join(process.env.FINAL_JUDO_DATA_DIR?.trim() || ".data", "final-judo-db.json");

function findChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate));
}

function shouldRunVisibleCopyScan() {
  if (scriptArgs.includes("--help") || scriptArgs.includes("-h")) {
    console.log(
      [
        "Usage: npm run test:visible-app-copy-stability",
        "",
        "Runs the mobile visible-copy scan against SMOKE_BASE_URL.",
        "Environment:",
        "  SMOKE_BASE_URL=http://localhost:3000",
        "  VISIBLE_APP_COPY_OUT_DIR=.data/mobile-builds/ios/visible-app-copy-stability",
        "  E2E_CHROME_EXECUTABLE=/path/to/chrome",
        "",
        "The scan accepts no positional arguments. Localhost runs reset dev data before and after notice read interactions.",
      ].join("\n"),
    );

    return false;
  }

  if (scriptArgs.length > 0) {
    console.error(`Unsupported visible-copy arguments: ${scriptArgs.join(" ")}. Use environment variables for configuration.`);
    process.exitCode = 1;

    return false;
  }

  return true;
}

function canResetVisibleCopyDevData() {
  const { hostname, protocol } = new URL(baseUrl);

  return (
    protocol === "http:" &&
    ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname)
  );
}

async function resetVisibleCopyDevData(label) {
  if (!canResetVisibleCopyDevData()) {
    return {
      attempted: false,
      label,
      reason: "non-local-base-url",
    };
  }

  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `visible app copy ${label} reset`,
  });
  const bodyText = await response.text();
  let body = null;

  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  assert(
    response.ok,
    `visible copy ${label} dev reset failed with ${response.status}: ${bodyText}`,
  );
  const resetData = body?.data ?? body;

  assert.equal(resetData?.ok, true, `visible copy ${label} dev reset must return ok=true`);

  return {
    attempted: true,
    label,
    ok: true,
    status: response.status,
    counts: resetData.counts ?? null,
  };
}

function readNoticeMutationSnapshot() {
  if (!existsSync(visibleCopyRuntimeDbFile)) {
    return {
      available: false,
      file: visibleCopyRuntimeDbFile,
      noticeReads: [],
      noticeReadAuditLogs: [],
    };
  }

  const db = JSON.parse(readFileSync(visibleCopyRuntimeDbFile, "utf8"));
  const noticeReads = (db.notices ?? [])
    .map((notice) => ({
      id: String(notice.id),
      readByUserIds: [...(notice.readByUserIds ?? [])].map(String).sort(),
    }))
    .filter((notice) => notice.readByUserIds.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  const noticeReadAuditLogs = (db.auditLogs ?? [])
    .filter((log) => log.action === "notice.read")
    .map((log) => ({
      id: String(log.id),
      targetId: String(log.targetId ?? ""),
      userId: String(log.userId ?? ""),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    available: true,
    file: visibleCopyRuntimeDbFile,
    noticeReads,
    noticeReadAuditLogs,
  };
}

function assertNoticeMutationSnapshotRestored(beforeSnapshot, afterSnapshot) {
  if (!beforeSnapshot.available || !afterSnapshot.available) {
    return false;
  }

  assert.deepEqual(
    afterSnapshot.noticeReads,
    beforeSnapshot.noticeReads,
    "visible copy notification read checks must not leave notice read state in the runtime DB",
  );
  assert.deepEqual(
    afterSnapshot.noticeReadAuditLogs,
    beforeSnapshot.noticeReadAuditLogs,
    "visible copy notification read checks must not leave notice.read audit logs in the runtime DB",
  );

  return true;
}

function cleanVisibleCopyOutputDir() {
  if (!existsSync(outDir)) {
    return [];
  }

  const removed = [];

  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const shouldRemove = entry.name.endsWith(".png") || entry.name === "visible-app-copy-stability-report.json";

    if (!shouldRemove) {
      continue;
    }

    unlinkSync(join(outDir, entry.name));
    removed.push(entry.name);
  }

  return removed.sort();
}

async function verifyNotificationReadToneDown(page, testCaseId, beforeLayout) {
  const readAction = page.locator('[data-testid="notification-read-action"]').first();
  const readActionCount = await readAction.count();
  const notificationReadScreenshotPath = join(outDir, `${testCaseId}-after-read-confirm.png`);

  if (readActionCount === 0) {
    return {
      attempted: false,
      feedbackCount: 0,
      feedbackText: "",
      inboxCardCount: beforeLayout.notificationInboxCardCount,
      bulkReadButtonDisabled: beforeLayout.notificationBulkReadButtonDisabled,
      bulkReadButtonState: beforeLayout.notificationBulkReadButtonState,
      bulkReadButtonText: beforeLayout.notificationBulkReadButtonText,
      readActionCount: 0,
      readNoticeBadgeToneDownCount: beforeLayout.notificationReadNoticeBadgeToneDownCount,
      readNoticeCardCount: beforeLayout.notificationReadNoticeCardCount,
      readNoticeCardToneDownCount: beforeLayout.notificationReadNoticeCardToneDownCount,
      screenshotPath: null,
      screenshotSizeBytes: 0,
    };
  }

  await readAction.click();
  await page.waitForSelector('[data-testid="notification-read-feedback"]', { timeout: 10000 });
  await page.waitForFunction(
    ({ beforeReadCardCount, beforeReadActionCount }) => {
      const feedbackText = document.querySelector('[data-testid="notification-read-feedback"]')?.textContent ?? "";
      const readCardCount = document.querySelectorAll(
        '[data-notification-kind="notice"][data-notification-read-state="read"]',
      ).length;
      const readActionCountAfter = document.querySelectorAll('[data-testid="notification-read-action"]').length;

      return (
        feedbackText.includes("공지 확인을 저장했습니다.") &&
        readCardCount > beforeReadCardCount &&
        readActionCountAfter < beforeReadActionCount
      );
    },
    {
      beforeReadActionCount: beforeLayout.notificationReadActionCount,
      beforeReadCardCount: beforeLayout.notificationReadNoticeCardCount,
    },
    { timeout: 10000 },
  );

  await page.screenshot({ path: notificationReadScreenshotPath, fullPage: false, caret: "initial" });
  const notificationReadScreenshotSizeBytes = statSync(notificationReadScreenshotPath).size;
  const state = await page.evaluate(() => {
    const bulkReadButton = document.querySelector('[data-testid="notification-bulk-read-filtered"]');
    const readCards = Array.from(
      document.querySelectorAll('[data-notification-kind="notice"][data-notification-read-state="read"]'),
    );
    const readStateBadges = Array.from(document.querySelectorAll('[data-testid="notification-read-state-badge"]')).filter(
      (badge) => badge.textContent?.includes("확인됨"),
    );

    return {
      feedbackCount: document.querySelectorAll('[data-testid="notification-read-feedback"]').length,
      feedbackText: document.querySelector('[data-testid="notification-read-feedback"]')?.textContent?.trim() ?? "",
      inboxCardCount: document.querySelectorAll('[data-testid="notification-inbox-card"]').length,
      bulkReadButtonDisabled: bulkReadButton instanceof HTMLButtonElement ? bulkReadButton.disabled : false,
      bulkReadButtonState: bulkReadButton?.getAttribute("data-notification-bulk-read-state") ?? "",
      bulkReadButtonText: bulkReadButton?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      readActionCount: document.querySelectorAll('[data-testid="notification-read-action"]').length,
      readNoticeBadgeToneDownCount: readStateBadges.filter((badge) => badge.className.includes("border-zinc-200")).length,
      readNoticeCardCount: readCards.length,
      readNoticeCardToneDownCount: readCards.filter((card) => card.className.includes("bg-zinc-50")).length,
    };
  });

  assert.equal(state.feedbackCount, 1, `${testCaseId} must show one read feedback message after interaction`);
  assert(
    state.feedbackText.includes("공지 확인을 저장했습니다."),
    `${testCaseId} must confirm that the notice read state was saved`,
  );
  assert(
    state.readNoticeCardCount > beforeLayout.notificationReadNoticeCardCount,
    `${testCaseId} must add the confirmed notice to the toned-down read card set`,
  );
  assert.equal(
    state.readNoticeCardToneDownCount,
    state.readNoticeCardCount,
    `${testCaseId} must tone down every confirmed notice card after interaction`,
  );
  assert.equal(
    state.readNoticeBadgeToneDownCount,
    state.readNoticeCardCount,
    `${testCaseId} must tone down every confirmed notice state badge after interaction`,
  );
  assert(
    state.readActionCount < beforeLayout.notificationReadActionCount,
    `${testCaseId} must remove the single read action from the confirmed notice`,
  );
  if (state.readActionCount === 0) {
      assert.equal(state.bulkReadButtonText, "공지 읽음 완료", `${testCaseId} must show done copy when no unread notices remain`);
    assert.equal(state.bulkReadButtonState, "done", `${testCaseId} must mark the bulk read action as done when no unread notices remain`);
    assert.equal(state.bulkReadButtonDisabled, true, `${testCaseId} must disable the bulk read action when no unread notices remain`);
  }
  assert(
    notificationReadScreenshotSizeBytes > 10_000,
    `${testCaseId} read interaction screenshot must be non-empty, got ${notificationReadScreenshotSizeBytes} bytes`,
  );

  return {
    ...state,
    attempted: true,
    screenshotPath: notificationReadScreenshotPath,
    screenshotSizeBytes: notificationReadScreenshotSizeBytes,
  };
}

async function main() {
  const executablePath = findChromeExecutable();

  assert(
    executablePath,
    `Chrome/Chromium executable was not found. Set E2E_CHROME_EXECUTABLE or install Google Chrome to run visible app copy stability checks against ${baseUrl}.`,
  );

  mkdirSync(outDir, { recursive: true });
  const cleanedOutputFiles = cleanVisibleCopyOutputDir();
  const beforeDevDataReset = await resetVisibleCopyDevData("before");
  const beforeNoticeMutationSnapshot = readNoticeMutationSnapshot();
  let afterDevDataReset = {
    attempted: false,
    label: "after",
    reason: "not-run",
  };
  let afterNoticeMutationSnapshot = {
    available: false,
    file: visibleCopyRuntimeDbFile,
    noticeReads: [],
    noticeReadAuditLogs: [],
  };
  let noticeMutationSnapshotRestored = false;

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  const results = [];

  try {
    for (const testCase of cases) {
      const url = testCase.url
        ? new URL(testCase.url, baseUrl).toString()
        : `${baseUrl}/login?role=${testCase.role}&autoLogin=1&next=${encodeURIComponent(testCase.next)}`;
      const screenshotPath = join(outDir, `${testCase.id}.png`);
      const messages = [];
      const handleConsole = (message) => {
        if (message.type() === "error") {
          messages.push(`console: ${message.text()}`);
        }
      };
      const handlePageError = (error) => {
        messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
      };

      page.on("console", handleConsole);
      page.on("pageerror", handlePageError);

      try {
        await page.goto(url, { waitUntil: "load" });
        if (testCase.role) {
          const expectedPathname = new URL(testCase.next, baseUrl).pathname;
          await page.waitForURL((currentUrl) => currentUrl.pathname === expectedPathname, { waitUntil: "load" });
        }
        await page.waitForLoadState("networkidle");
        await page.waitForSelector("main", { timeout: 10000 });
        await page
          .waitForFunction(() => (document.querySelector("main")?.textContent ?? "").trim().length > 30, null, { timeout: 10000 })
          .catch(() => undefined);
        await page
          .waitForFunction(
            () => {
              const text = document.querySelector("main")?.textContent ?? "";

              return !text.includes("화면을 준비하고 있습니다") && !text.includes("불러오는 중");
            },
            null,
            { timeout: 15000 },
          )
          .catch(() => undefined);

        let adminSettingsPolicyLayout = {};
        let adminSettingsViewEvidence = null;
        let inactiveViewBodyText = "";

        if (testCase.id === "admin-settings") {
          inactiveViewBodyText = await page.locator("body").innerText();
          adminSettingsPolicyLayout = await page.evaluate(() => ({
            adminSettingsRolePolicySummaryCount: document.querySelectorAll('[data-testid="admin-settings-role-policy-summary"]').length,
            adminSettingsRolePolicySummaryHeight:
              Math.round(document.querySelector('[data-testid="admin-settings-role-policy-summary"]')?.getBoundingClientRect().height ?? 0),
            adminSettingsRolePolicyDetailCount: document.querySelectorAll('[data-testid="admin-settings-role-policy-detail"]').length,
            adminSettingsRolePolicyToggleCount: document.querySelectorAll('[data-testid="admin-settings-role-policy-toggle"]').length,
            adminSettingsRolePolicyToggleHeight:
              Math.round(document.querySelector('[data-testid="admin-settings-role-policy-toggle"]')?.getBoundingClientRect().height ?? 0),
            adminSettingsBranchPolicySummaryCount: document.querySelectorAll('[data-testid="admin-settings-branch-policy-summary"]').length,
            adminSettingsBranchPolicySummaryHeight:
              Math.round(document.querySelector('[data-testid="admin-settings-branch-policy-summary"]')?.getBoundingClientRect().height ?? 0),
            adminSettingsBranchPolicyDetailCount: document.querySelectorAll('[data-testid="admin-settings-branch-policy-detail"]').length,
            adminSettingsBranchPolicyToggleCount: document.querySelectorAll('[data-testid="admin-settings-branch-policy-toggle"]').length,
            adminSettingsBranchPolicyToggleHeight:
              Math.round(document.querySelector('[data-testid="admin-settings-branch-policy-toggle"]')?.getBoundingClientRect().height ?? 0),
            adminSettingsAuditPolicySummaryCount: document.querySelectorAll('[data-testid="admin-settings-audit-policy-summary"]').length,
            adminSettingsAuditPolicySummaryHeight:
              Math.round(document.querySelector('[data-testid="admin-settings-audit-policy-summary"]')?.getBoundingClientRect().height ?? 0),
            adminSettingsAuditPolicyDetailCount: document.querySelectorAll('[data-testid="admin-settings-audit-policy-detail"]').length,
            adminSettingsAuditPolicyToggleCount: document.querySelectorAll('[data-testid="admin-settings-audit-policy-toggle"]').length,
            adminSettingsAuditPolicyToggleHeight:
              Math.round(document.querySelector('[data-testid="admin-settings-audit-policy-toggle"]')?.getBoundingClientRect().height ?? 0),
            adminSettingsServicePolicySummaryCount: document.querySelectorAll('[data-testid="admin-settings-service-policy-summary"]').length,
            adminSettingsServicePolicySummaryHeight:
              Math.round(document.querySelector('[data-testid="admin-settings-service-policy-summary"]')?.getBoundingClientRect().height ?? 0),
            adminSettingsServicePolicySummaryTileCount: document.querySelectorAll('[data-testid="admin-settings-service-policy-summary"] p').length,
          }));

          const policyScreenshotPath = join(outDir, "admin-settings-policy.png");
          await page.screenshot({ path: policyScreenshotPath, fullPage: true, caret: "initial" });
          const policyScreenshotSizeBytes = statSync(policyScreenshotPath).size;
          const policyTab = page.locator('[data-testid="admin-settings-policy-tab"]');
          const operationsTab = page.locator('[data-testid="admin-settings-operations-tab"]');
          const beforeSwitch = {
            operationsSelected: await operationsTab.getAttribute("aria-selected"),
            operationsViewCount: await page.locator('[data-testid="admin-settings-operations-view"]').count(),
            policySelected: await policyTab.getAttribute("aria-selected"),
            policyViewCount: await page.locator('[data-testid="admin-settings-policy-view"]').count(),
          };

          await operationsTab.click();
          await page.waitForSelector('[data-testid="admin-settings-operations-view"]', { timeout: 10000 });
          const afterSwitch = {
            operationsSelected: await operationsTab.getAttribute("aria-selected"),
            operationsViewCount: await page.locator('[data-testid="admin-settings-operations-view"]').count(),
            policySelected: await policyTab.getAttribute("aria-selected"),
            policyViewCount: await page.locator('[data-testid="admin-settings-policy-view"]').count(),
          };

          adminSettingsViewEvidence = {
            afterSwitch,
            beforeSwitch,
            policyScreenshotPath,
            policyScreenshotSizeBytes,
          };
        }

        let bodyText = await page.locator("body").innerText();
        if (inactiveViewBodyText) {
          bodyText = `${inactiveViewBodyText}\n${bodyText}`;
        }
        const lines = bodyText
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean);
        const blockedHits = lines.filter((line) => blockedVisibleCopyPattern.test(line));
        const blockedPlaceholderHits = await page.evaluate(
          ({ pattern, flags }) => {
            const blockedPattern = new RegExp(pattern, flags);

            return Array.from(document.querySelectorAll("input, textarea"))
              .map((control) => control.getAttribute("placeholder") ?? "")
              .filter((value) => value && blockedPattern.test(value));
          },
          { pattern: blockedFormPlaceholderPattern.source, flags: blockedFormPlaceholderPattern.flags },
        );
        const layout = {
          ...(await page.evaluate(() => {
          const authRoleShortcutButtons = Array.from(document.querySelectorAll("main button")).filter((button) => {
            const text = button.textContent?.replace(/\s+/g, " ").trim() ?? "";

            return /^(대표|코치|학부모|회원|총괄 어드민)(로 시작| 선택| 유지)$/.test(text);
          });
          const finalWordmarks = Array.from(document.querySelectorAll('[data-testid="final-wordmark"]'));
          const finalWordmarkLinkHeights = Array.from(document.querySelectorAll('a[aria-label="FINAL 대시보드로 이동"]'))
            .map((link) => Math.round(link.getBoundingClientRect().height))
            .filter((height) => height > 0);
          const finalWordmarkVisualHeights = finalWordmarks
            .map((wordmark) => Math.round(wordmark.getBoundingClientRect().height))
            .filter((height) => height > 0);

          return {
          pathname: location.pathname,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          hasLoadingCopy: document.body.innerText.includes("화면을 준비하고 있습니다") || document.body.innerText.includes("불러오는 중"),
          hasAppError: document.body.innerText.includes("Application error") || document.body.innerText.includes("Unhandled Runtime Error"),
          inviteFormCount: document.querySelectorAll("#admin-user-invite-form").length,
          inviteToggleCount: document.querySelectorAll('[data-testid="admin-user-invite-toggle"]').length,
          mobileAccountMenuToggleCount: document.querySelectorAll('[data-testid="mobile-account-menu-toggle"]').length,
	          mobileAccountMenuToggleHeight:
	            Math.round(document.querySelector('[data-testid="mobile-account-menu-toggle"]')?.getBoundingClientRect().height ?? 0),
	          mobileBranchScopeCount: document.querySelectorAll('[data-testid="mobile-branch-scope"]').length,
	          mobileBranchScopeHeight:
	            Math.round(document.querySelector('[data-testid="mobile-branch-scope"]')?.getBoundingClientRect().height ?? 0),
	          mobileHeaderHeight: Math.round(document.querySelector("header")?.getBoundingClientRect().height ?? 0),
          mobileHeaderLogoutButtonCount: document.querySelectorAll('[data-testid="mobile-header-logout-button"]').length,
          mobileHeaderLogoutButtonHeight:
            Math.round(document.querySelector('[data-testid="mobile-header-logout-button"]')?.getBoundingClientRect().height ?? 0),
          appHeaderNoticeLinkCount: document.querySelectorAll('[data-testid="app-header-notice-link"]').length,
          appHeaderNoticeLinkHeight:
            Math.round(document.querySelector('[data-testid="app-header-notice-link"]')?.getBoundingClientRect().height ?? 0),
          appHeaderNoticeBadgeCount: document.querySelectorAll('[data-testid="notice-unread-badge"]').length,
          appHeaderNoticeBadgeUnreadCount:
            Number(document.querySelector('[data-testid="notice-unread-badge"]')?.getAttribute("data-unread-notice-count") ?? 0),
          mobileBottomNavScrollerClientWidth:
            Math.round(document.querySelector('[data-testid="mobile-bottom-navigation-scroller"]')?.clientWidth ?? 0),
          mobileBottomNavScrollerScrollWidth:
            Math.round(document.querySelector('[data-testid="mobile-bottom-navigation-scroller"]')?.scrollWidth ?? 0),
          mobileBottomNavScrollerDisplay: (() => {
            const scroller = document.querySelector('[data-testid="mobile-bottom-navigation-scroller"]');

            return scroller ? getComputedStyle(scroller).display : "";
          })(),
          mobileBottomNavGridColumnCount: (() => {
            const scroller = document.querySelector('[data-testid="mobile-bottom-navigation-scroller"]');
            const columns = scroller ? getComputedStyle(scroller).gridTemplateColumns : "";

            return columns && columns !== "none" ? columns.split(/\s+/).filter(Boolean).length : 0;
          })(),
          mobileBottomNavLinkCount: document.querySelectorAll('[data-testid="mobile-bottom-navigation"] a').length,
          mobileBottomNavLinkMinWidth: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="mobile-bottom-navigation"] a'))
              .map((link) => Math.round(link.getBoundingClientRect().width))
              .filter((width) => width > 0),
          ),
          mobileBottomNavLabels: Array.from(document.querySelectorAll('[data-testid="mobile-bottom-navigation"] a'))
            .map((link) => link.textContent?.trim() ?? "")
            .filter(Boolean)
            .join("|"),
          mobileBottomNavNoticeHref:
            document.querySelector('[data-testid="mobile-bottom-navigation"] a[data-mobile-route-id="notices"]')?.getAttribute("href") ?? "",
          mobileBottomNavNoticeLabel:
            document.querySelector('[data-testid="mobile-bottom-navigation"] a[data-mobile-route-id="notices"]')?.textContent?.trim() ?? "",
          mobileBottomNavRouteIds: Array.from(document.querySelectorAll('[data-testid="mobile-bottom-navigation"] a'))
            .map((link) => link.getAttribute("data-mobile-route-id") ?? "")
            .filter(Boolean)
            .join("|"),
          mobileBottomNavActiveRouteIds: Array.from(
            document.querySelectorAll('[data-testid="mobile-bottom-navigation"] a[data-active-mobile-nav="true"]'),
          )
            .map((link) => link.getAttribute("data-mobile-route-id") ?? "")
            .filter(Boolean)
            .join("|"),
          mobileBottomNavCurrentRouteIds: Array.from(
            document.querySelectorAll('[data-testid="mobile-bottom-navigation"] a[aria-current="page"]'),
          )
            .map((link) => link.getAttribute("data-mobile-route-id") ?? "")
            .filter(Boolean)
            .join("|"),
          mobileBottomNavNoticeBadgeCount: document.querySelectorAll(
            '[data-testid="mobile-bottom-navigation"] [data-testid="mobile-notice-unread-badge"]',
          ).length,
          mobileBottomNavNoticeBadgeUnreadCount:
            Number(document.querySelector('[data-testid="mobile-notice-unread-badge"]')?.getAttribute("data-unread-notice-count") ?? 0),
          mobileBottomNavRequestsBadgeCount: document.querySelectorAll(
            '[data-testid="mobile-bottom-navigation"] a[data-mobile-route-id="requests"] [data-testid="mobile-notice-unread-badge"]',
          ).length,
          mobileBottomNavNoticeAriaLabel:
            document.querySelector('[data-testid="mobile-bottom-navigation"] a[data-mobile-route-id="notices"]')?.getAttribute("aria-label") ??
            "",
          mobileBottomNavNoticeBadgeContained: (() => {
            const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const link = document.querySelector('[data-testid="mobile-bottom-navigation"] a[data-mobile-route-id="notices"]');
            const badge = document.querySelector(
              '[data-testid="mobile-bottom-navigation"] a[data-mobile-route-id="notices"] [data-testid="mobile-notice-unread-badge"]',
            );

            if (!badge || !link || !nav) {
              return true;
            }

            const badgeRect = badge.getBoundingClientRect();
            const linkRect = link.getBoundingClientRect();
            const navRect = nav.getBoundingClientRect();

            return (
              badgeRect.left >= linkRect.left &&
              badgeRect.right <= linkRect.right &&
              badgeRect.top >= linkRect.top &&
              badgeRect.bottom <= linkRect.bottom &&
              badgeRect.left >= navRect.left &&
              badgeRect.right <= navRect.right &&
              badgeRect.top >= navRect.top &&
              badgeRect.bottom <= navRect.bottom
            );
          })(),
          mobileBottomNavNoticeBadgePointerEvents: (() => {
            const badge = document.querySelector(
              '[data-testid="mobile-bottom-navigation"] a[data-mobile-route-id="notices"] [data-testid="mobile-notice-unread-badge"]',
            );

            return badge ? getComputedStyle(badge).pointerEvents : "";
          })(),
          requestNoticeInboxHeadingCount: Array.from(document.querySelectorAll("h1, h2, h3")).filter(
            (heading) => heading.textContent?.trim() === "공지함",
          ).length,
          requestsScreenCount: document.querySelectorAll('[data-testid="requests-screen"]').length,
          noticesScreenCount: document.querySelectorAll('[data-testid="notices-screen"]').length,
          notificationsScreenCount: document.querySelectorAll('[data-testid="notifications-screen"]').length,
          notificationSummaryCardCount: document.querySelectorAll('[data-testid="notification-summary-card"]').length,
          notificationSummaryGridCount: document.querySelectorAll('[data-testid="notification-summary-grid"]').length,
          notificationDuplicateSummaryTextCount: ["읽음 처리 필요", "먼저 볼 항목", "결제/요청"].filter((text) =>
            document.body.innerText.includes(text),
          ).length,
          notificationInboxCardCount: document.querySelectorAll('[data-testid="notification-inbox-card"]').length,
          notificationNoticeCardCount: document.querySelectorAll('[data-notification-kind="notice"][data-testid="notification-inbox-card"]').length,
          notificationPaymentCardCount: document.querySelectorAll('[data-notification-kind="payment"][data-testid="notification-inbox-card"]').length,
          notificationKindBadgeCount: document.querySelectorAll('[data-testid="notification-kind-badge"]').length,
          notificationNoticeKindBadgeCount: document.querySelectorAll(
            '[data-notification-kind="notice"] [data-testid="notification-kind-badge"]',
          ).length,
          notificationPaymentKindBadgeCount: document.querySelectorAll(
            '[data-notification-kind="payment"] [data-testid="notification-kind-badge"]',
          ).length,
          notificationInboxCardMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="notification-inbox-card"]'))
              .map((card) => Math.round(card.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          notificationBottomSafeAreaCount: document.querySelectorAll('[data-testid="notification-bottom-safe-area"]').length,
          notificationBottomActionClearanceAtScrollEnd: (() => {
            const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const action =
              document.querySelector('[data-notification-kind="payment"] [data-testid="notification-detail-link"]') ??
              Array.from(document.querySelectorAll('[data-testid="notification-detail-link"], [data-testid="notification-read-action"]')).at(-1);
            const scrollElement = document.scrollingElement;

            if (!nav || !action || !scrollElement) {
              return 0;
            }

            const navRect = nav.getBoundingClientRect();
            const actionRect = action.getBoundingClientRect();
            const maxScrollY = Math.max(0, scrollElement.scrollHeight - window.innerHeight);
            const actionBottomAtScrollEnd = actionRect.bottom + window.scrollY - maxScrollY;

            return Math.round(navRect.top - actionBottomAtScrollEnd);
          })(),
          notificationBottomCardClearanceAtScrollEnd: (() => {
            const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const action =
              document.querySelector('[data-notification-kind="payment"] [data-testid="notification-detail-link"]') ??
              Array.from(document.querySelectorAll('[data-testid="notification-detail-link"], [data-testid="notification-read-action"]')).at(-1);
            const card = action?.closest('[data-testid="notification-inbox-card"]');
            const scrollElement = document.scrollingElement;

            if (!nav || !card || !scrollElement) {
              return 0;
            }

            const navRect = nav.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            const maxScrollY = Math.max(0, scrollElement.scrollHeight - window.innerHeight);
            const cardBottomAtScrollEnd = cardRect.bottom + window.scrollY - maxScrollY;

            return Math.round(navRect.top - cardBottomAtScrollEnd);
          })(),
          notificationReadNoticeCardCount: document.querySelectorAll(
            '[data-testid="notification-inbox-card"][data-notification-read-state="read"]',
          ).length,
          notificationReadNoticeCardToneDownCount: Array.from(
            document.querySelectorAll('[data-testid="notification-inbox-card"][data-notification-read-state="read"]'),
          ).filter((card) => card.className.includes("bg-zinc-50/70")).length,
          notificationReadNoticeBadgeToneDownCount: Array.from(
            document.querySelectorAll('[data-notification-read-state="read"] [data-testid="notification-read-state-badge"]'),
          ).filter((badge) => badge.textContent?.trim() === "확인됨" && badge.className.includes("text-zinc-500")).length,
          notificationFollowUpStateBadgeCount: document.querySelectorAll('[data-testid="notification-follow-up-state-badge"]').length,
          notificationFilterButtonMinHeight: Math.min(
            ...Array.from(
              document.querySelectorAll(
                '[data-testid="notification-filter-all"], [data-testid="notification-filter-unread"], [data-testid="notification-filter-important"]',
              ),
            )
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          notificationFilterButtonText: Array.from(
            document.querySelectorAll(
              '[data-testid="notification-filter-all"], [data-testid="notification-filter-unread"], [data-testid="notification-filter-important"]',
            ),
          )
            .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("|"),
          notificationBulkReadButtonHeight:
            Math.round(document.querySelector('[data-testid="notification-bulk-read-filtered"]')?.getBoundingClientRect().height ?? 0),
          notificationBulkReadButtonText:
            document.querySelector('[data-testid="notification-bulk-read-filtered"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          notificationBulkReadButtonAriaLabel:
            document.querySelector('[data-testid="notification-bulk-read-filtered"]')?.getAttribute("aria-label") ?? "",
          notificationBulkReadButtonDisabled:
            document.querySelector('[data-testid="notification-bulk-read-filtered"]') instanceof HTMLButtonElement
              ? document.querySelector('[data-testid="notification-bulk-read-filtered"]').disabled
              : false,
          notificationBulkReadButtonState:
            document.querySelector('[data-testid="notification-bulk-read-filtered"]')?.getAttribute("data-notification-bulk-read-state") ?? "",
          notificationReadActionCount: document.querySelectorAll('[data-testid="notification-read-action"]').length,
          notificationReadActionMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="notification-read-action"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          notificationReadActionText: Array.from(document.querySelectorAll('[data-testid="notification-read-action"]'))
            .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("|"),
          notificationReadFeedbackCount: document.querySelectorAll('[data-testid="notification-read-feedback"]').length,
          notificationPaymentCheckoutLinkCount: document.querySelectorAll(
            '[data-notification-kind="payment"] [data-testid="notification-detail-link"][href*="/app/payments/checkout?paymentId="]',
          ).length,
          notificationPaymentCheckoutLinkText: Array.from(
            document.querySelectorAll(
              '[data-notification-kind="payment"] [data-testid="notification-detail-link"][href*="/app/payments/checkout?paymentId="]',
            ),
          )
            .map((link) => link.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("|"),
          notificationNoticeDetailLinkCount: document.querySelectorAll(
            '[data-notification-kind="notice"] [data-testid="notification-detail-link"]',
          ).length,
          notificationNoticeContentLinkCount: document.querySelectorAll(
            // 공지 하이라이트 딥링크(?highlight=)를 허용하기 위해 접두 일치로 확인한다.
            '[data-notification-kind="notice"] [data-testid="notification-notice-content-link"][href^="/app/notices"]',
          ).length,
          notificationRequestDetailLinkCount: document.querySelectorAll(
            '[data-notification-kind="request"] [data-testid="notification-detail-link"][href="/app/requests"]',
          ).length,
          notificationRequestDetailLinkText: Array.from(
            document.querySelectorAll('[data-notification-kind="request"] [data-testid="notification-detail-link"]'),
          )
            .map((link) => link.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("|"),
          notificationRequestDetailActionLabels: Array.from(
            document.querySelectorAll('[data-notification-kind="request"] [data-testid="notification-detail-link"]'),
          )
            .map((link) => link.getAttribute("data-notification-action-label") ?? "")
            .filter(Boolean)
            .join("|"),
          notificationSettingsJumpHeight:
            Math.round(document.querySelector('[data-testid="notification-settings-jump"]')?.getBoundingClientRect().height ?? 0),
          notificationSettingsJumpText:
            document.querySelector('[data-testid="notification-settings-jump"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          notificationSettingsJumpHref:
            document.querySelector('[data-testid="notification-settings-jump"]')?.getAttribute("href") ?? "",
          accountSummaryCardCount: document.querySelectorAll('[data-testid="account-summary-card"]').length,
          accountSummaryGridCount: document.querySelectorAll('[data-testid="account-summary-grid"]').length,
          accountStatusCardCount: document.querySelectorAll('[data-testid="account-status-card"]').length,
          accountActiveStatusLabelCount: Array.from(document.querySelectorAll('[data-testid="account-status-card"]')).filter((card) =>
            card.textContent?.includes("활성"),
          ).length,
          accountActionPanelCount: document.querySelectorAll('[data-testid="account-action-panel"]').length,
          accountRoleSwitchLinkCount: document.querySelectorAll('[data-testid="account-role-switch-link"]').length,
          accountLogoutButtonCount: document.querySelectorAll('[data-testid="account-logout-button"]').length,
          accountRoleSwitchLinkHeight:
            Math.round(document.querySelector('[data-testid="account-role-switch-link"]')?.getBoundingClientRect().height ?? 0),
          accountLogoutButtonHeight:
            Math.round(document.querySelector('[data-testid="account-logout-button"]')?.getBoundingClientRect().height ?? 0),
          accountBranchListHeadingCount: Array.from(document.querySelectorAll("h2")).filter((heading) => heading.textContent?.trim() === "이용 지점").length,
          authFormCount: document.querySelectorAll("main form").length,
          authPasswordInputCount: document.querySelectorAll('main input[type="password"]').length,
          authRegisteredNoticeText: Array.from(document.querySelectorAll('main [role="status"]'))
            .map((notice) => notice.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("|"),
          authSignupLinkCount: document.querySelectorAll('[data-testid="login-signup-link"]').length,
          authSignupInvitationInputCount: document.querySelectorAll('[data-testid="signup-invitation-input"]').length,
          authSignupNameInputCount: document.querySelectorAll('[data-testid="signup-name-input"]').length,
          authSignupPhoneInputCount: document.querySelectorAll('[data-testid="signup-phone-input"]').length,
          authSignupBranchInputCount: document.querySelectorAll('[data-testid="signup-branch-input"]').length,
          authSignupBranchInputMinHeight: Math.round(
            document.querySelector('[data-testid="signup-branch-input"]')?.getBoundingClientRect().height ?? 0,
          ),
          authSelectRoleLoginLinkHeight:
            Math.round(document.querySelector('[data-testid="select-role-login-link"]')?.getBoundingClientRect().height ?? 0),
          authSelectRoleProductionCopyVisible: document.body.innerText.includes("휴대폰 번호 로그인으로 계정을 변경합니다."),
          authPasswordInputMinPaddingRight: (() => {
            const paddings = Array.from(
              document.querySelectorAll("#login-password-input, #signup-password-input, #invite-password-input"),
            )
              .map((input) => Math.round(Number.parseFloat(getComputedStyle(input).paddingRight)))
              .filter((padding) => padding > 0);

            return paddings.length > 0 ? Math.min(...paddings) : 0;
          })(),
          authPasswordVisibilityToggleCount: document.querySelectorAll('[data-testid$="password-visibility-toggle"]').length,
          authPasswordVisibilityToggleMinHeight: (() => {
            const heights = Array.from(document.querySelectorAll('[data-testid$="password-visibility-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0);

            return heights.length > 0 ? Math.min(...heights) : 0;
          })(),
          authPasswordVisibilityToggleMinWidth: (() => {
            const widths = Array.from(document.querySelectorAll('[data-testid$="password-visibility-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().width))
              .filter((width) => width > 0);

            return widths.length > 0 ? Math.min(...widths) : 0;
          })(),
          authRoleShortcutButtonCount: authRoleShortcutButtons.length,
          authRoleShortcutButtonMinHeight:
            authRoleShortcutButtons.length > 0
              ? Math.min(...authRoleShortcutButtons.map((button) => Math.round(button.getBoundingClientRect().height)).filter((height) => height > 0))
              : 0,
          authRoleShortcutButtonText: authRoleShortcutButtons
            .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("|"),
          authSubmitButtonCount: Array.from(document.querySelectorAll("main button")).filter((button) =>
            /로그인|회원가입|비밀번호 설정 후 초대 수락|재설정 요청/.test(button.textContent ?? ""),
          ).length,
          adminBranchSummaryGridCount: document.querySelectorAll('[data-testid="admin-branch-summary-grid"]').length,
          adminBranchSummaryGridHeight: Math.round(
            document.querySelector('[data-testid="admin-branch-summary-grid"]')?.getBoundingClientRect().height ?? 0,
          ),
          adminBranchSummaryGridWidth: Math.round(
            document.querySelector('[data-testid="admin-branch-summary-grid"]')?.getBoundingClientRect().width ?? 0,
          ),
          adminBranchSummaryText:
            document.querySelector('[data-testid="admin-branch-summary-grid"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          adminBranchActiveSummaryText:
            document.querySelector('[data-testid="admin-branch-summary-active"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          adminBranchCreateFormCount: document.querySelectorAll("#admin-branch-create-form").length,
          adminBranchCreatePanelHeight: Math.round(
            document.querySelector('[data-testid="admin-branch-create-panel"]')?.getBoundingClientRect().height ?? 0,
          ),
          adminBranchCreatePanelWidth: Math.round(
            document.querySelector('[data-testid="admin-branch-create-panel"]')?.getBoundingClientRect().width ?? 0,
          ),
          adminBranchCreateToggleCount: document.querySelectorAll('[data-testid="admin-branch-create-toggle"]').length,
          adminBranchCreateToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-branch-create-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminBranchCardCount: document.querySelectorAll('[data-testid="admin-branch-card"]').length,
          adminBranchCardMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="admin-branch-card"]')).map((card) =>
              Math.round(card.getBoundingClientRect().height),
            ),
          ),
          adminBranchDetailGridCount: document.querySelectorAll('[data-testid="admin-branch-detail-grid"]').length,
          adminBranchDetailGridMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="admin-branch-detail-grid"]')).map((grid) =>
              Math.round(grid.getBoundingClientRect().height),
            ),
          ),
          adminBranchActionGridCount: document.querySelectorAll('[data-testid="admin-branch-action-grid"]').length,
          adminBranchActionGridMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="admin-branch-action-grid"]')).map((grid) =>
              Math.round(grid.getBoundingClientRect().height),
            ),
          ),
          adminBranchOwnerFormCount: document.querySelectorAll('form[id^="admin-branch-owner-form-"]').length,
          adminBranchOwnerToggleCount: document.querySelectorAll('[data-testid="admin-branch-owner-toggle"]').length,
          adminBranchOwnerToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="admin-branch-owner-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminBranchSettingsFormCount: document.querySelectorAll('form[id^="admin-branch-settings-form-"]').length,
          adminBranchSettingsToggleCount: document.querySelectorAll('[data-testid="admin-branch-settings-toggle"]').length,
          adminBranchSettingsToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="admin-branch-settings-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminUserSummaryGridCount: document.querySelectorAll('[data-testid="admin-user-summary-grid"]').length,
          adminUserRoleFilterPanelCount: document.querySelectorAll('[data-testid="admin-user-role-filter-panel"]').length,
          adminUserRoleFilterButtonCount: document.querySelectorAll('[data-testid="admin-user-role-filter-button"]').length,
          adminUserRoleFilterRoles: Array.from(document.querySelectorAll('[data-testid="admin-user-role-filter-button"]'))
            .map((button) => button.getAttribute("data-role-filter"))
            .filter(Boolean)
            .join("|"),
          adminUserRoleFilterButtonMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="admin-user-role-filter-button"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminUserEditToggleCount: document.querySelectorAll('[data-testid^="admin-user-edit-toggle-"]').length,
          adminUserDeleteToggleCount: document.querySelectorAll('[data-testid^="admin-user-delete-toggle-"]').length,
          adminUserProtectedDeleteRowCount: document.querySelectorAll('[data-admin-user-delete-protected="true"]').length,
          adminUserProtectedDeleteToggleCount: Array.from(document.querySelectorAll('[data-admin-user-delete-protected="true"]')).filter((row) =>
            row.querySelector('[data-testid^="admin-user-delete-toggle-"]'),
          ).length,
          adminUserDisabledDeleteToggleCount: Array.from(document.querySelectorAll('[data-testid^="admin-user-delete-toggle-"]')).filter(
            (button) => button instanceof HTMLButtonElement && button.disabled,
          ).length,
          adminUserEnabledDeleteToggleCount: Array.from(document.querySelectorAll('[data-testid^="admin-user-delete-toggle-"]')).filter(
            (button) => button instanceof HTMLButtonElement && !button.disabled,
          ).length,
          adminUserDeleteBlockerSummaryCount: document.querySelectorAll('[data-admin-user-delete-protected="true"]').length,
          adminUserDeleteBlockerSummaryText: Array.from(document.querySelectorAll('[data-admin-user-delete-protected="true"]'))
            .map((row) => row.getAttribute("data-admin-user-delete-blockers") ?? "")
            .filter(Boolean)
            .join(" | "),
          adminUserDeleteBlockerVisibleText: Array.from(document.querySelectorAll('[data-testid="admin-user-delete-blocker-summary"]'))
            .map((node) =>
              Array.from(node.querySelectorAll('[aria-hidden="true"]'))
                .map((part) => part.textContent?.trim() ?? "")
                .filter(Boolean)
                .join(" "),
            )
            .join(" | "),
          adminUserDeleteBlockerSummaryMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="admin-user-delete-blocker-summary"]')).map((node) =>
              Math.round(node.getBoundingClientRect().height),
            ),
          ),
          adminUserEditToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid^="admin-user-edit-toggle-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminUserDeleteToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid^="admin-user-delete-toggle-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminUserActionStackMaxWidth: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid^="admin-user-action-stack-"]'))
              .map((stack) => Math.round(stack.getBoundingClientRect().width))
              .filter((width) => width > 0),
          ),
          adminUserActionStackMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid^="admin-user-action-stack-"]'))
              .map((stack) => Math.round(stack.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminUserProtectedActionStackMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-admin-user-delete-protected="true"] [data-testid^="admin-user-action-stack-"]'))
              .map((stack) => Math.round(stack.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminUserActionButtonMinWidth: Math.min(
            ...Array.from(
              document.querySelectorAll(
                '[data-testid^="admin-user-edit-toggle-"], [data-testid^="admin-user-delete-toggle-"], [data-testid^="admin-user-password-reset-toggle-"]',
              ),
            )
              .map((button) => Math.round(button.getBoundingClientRect().width))
              .filter((width) => width > 0),
          ),
          adminUserActionButtonMaxWidth: Math.max(
            0,
            ...Array.from(
              document.querySelectorAll(
                '[data-testid^="admin-user-edit-toggle-"], [data-testid^="admin-user-delete-toggle-"], [data-testid^="admin-user-password-reset-toggle-"]',
              ),
            )
              .map((button) => Math.round(button.getBoundingClientRect().width))
              .filter((width) => width > 0),
          ),
          adminUserActionButtonMaxHeight: Math.max(
            0,
            ...Array.from(
              document.querySelectorAll(
                '[data-testid^="admin-user-edit-toggle-"], [data-testid^="admin-user-delete-toggle-"], [data-testid^="admin-user-password-reset-toggle-"]',
              ),
            )
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminUserPasswordResetToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid^="admin-user-password-reset-toggle-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminUserEditFormCount: document.querySelectorAll('[data-testid^="admin-user-edit-form-"]').length,
          adminUserDeleteFormCount: document.querySelectorAll('[data-testid^="admin-user-delete-form-"]').length,
          adminUserListRowCount: document.querySelectorAll('[data-testid="admin-user-list-row"]').length,
          adminUserInvitePanelCount: document.querySelectorAll('[data-testid="admin-user-invite-panel"]').length,
          adminUserMemberCreateLinkHeight:
            Math.round(document.querySelector('[data-testid="admin-user-member-create-link"]')?.getBoundingClientRect().height ?? 0),
          adminUserMemberCreateLinkHref:
            document.querySelector('[data-testid="admin-user-member-create-link"]')?.getAttribute("href") ?? "",
          adminUserInviteToggleText: document.querySelector('[data-testid="admin-user-invite-toggle"]')?.textContent?.trim() ?? "",
          adminUserInviteToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-user-invite-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminUserBottomNavTop: Math.round(document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect().top ?? 0),
          adminUserFirstActionStackBottom: Math.round(
            document.querySelector('[data-testid^="admin-user-action-stack-"]')?.getBoundingClientRect().bottom ?? 0,
          ),
          adminUserFirstActionOverlapBottomNavCount: (() => {
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const firstActionStack = document.querySelector('[data-testid^="admin-user-action-stack-"]');
            const navRect = bottomNav?.getBoundingClientRect();

            if (!navRect || !firstActionStack) {
              return 0;
            }

            return Array.from(firstActionStack.querySelectorAll("button")).filter((button) => {
              const rect = button.getBoundingClientRect();

              return rect.bottom > navRect.top && rect.top < navRect.bottom;
            }).length;
          })(),
          adminUserMobileScopeSummaryCount: document.querySelectorAll('[data-testid="admin-user-mobile-scope-summary"]').length,
          adminUserMobileScopeSummaryText: Array.from(document.querySelectorAll('[data-testid="admin-user-mobile-scope-summary"]'))
            .map((node) => node.textContent?.trim() ?? "")
            .join(" | "),
          adminRoleSummaryGridCount: document.querySelectorAll('[data-testid="admin-role-summary-grid"]').length,
          adminRoleSummaryGridHeight:
            Math.round(document.querySelector('[data-testid="admin-role-summary-grid"]')?.getBoundingClientRect().height ?? 0),
          adminRoleInvitePanelCount: document.querySelectorAll('[data-testid="admin-role-invite-panel"]').length,
          adminRoleInvitePanelHeight:
            Math.round(document.querySelector('[data-testid="admin-role-invite-panel"]')?.getBoundingClientRect().height ?? 0),
          adminRoleInvitePanelWidth:
            Math.round(document.querySelector('[data-testid="admin-role-invite-panel"]')?.getBoundingClientRect().width ?? 0),
          adminRoleInvitePanelText: document.querySelector('[data-testid="admin-role-invite-panel"]')?.textContent?.trim() ?? "",
          adminRoleInviteFormCount: document.querySelectorAll("#admin-role-invite-form").length,
          adminRoleInviteToggleCount: document.querySelectorAll('[data-testid="admin-role-invite-toggle"]').length,
          adminRoleInviteToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-role-invite-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminRoleUserRowCount: document.querySelectorAll('[data-testid="admin-role-user-row"]').length,
          adminRoleActionRowCount: document.querySelectorAll('[data-testid="admin-role-action-row"]').length,
          adminRoleActionRowMaxWidth: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="admin-role-action-row"]')).map((row) =>
              Math.round(row.getBoundingClientRect().width),
            ),
          ),
          adminRoleManagementScopeVisibleCount: Array.from(document.querySelectorAll('[data-testid="admin-role-management-scope"]')).filter(
            (node) => node.getBoundingClientRect().height > 0,
          ).length,
          adminRoleBranchScopeVisibleCount: Array.from(document.querySelectorAll('[data-testid="admin-role-branch-scope"]')).filter(
            (node) => node.getBoundingClientRect().height > 0,
          ).length,
          adminRoleEditFormCount: document.querySelectorAll('form[id^="admin-role-edit-form-"]').length,
          adminRoleEditToggleCount: document.querySelectorAll('[data-testid="admin-role-edit-toggle"]').length,
          adminRoleEditToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="admin-role-edit-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminRolePermissionSummaryCount: document.querySelectorAll('[data-testid="admin-role-permission-summary"]').length,
          adminRolePermissionSummaryRowCount: document.querySelectorAll('[data-testid="admin-role-permission-summary-row"]').length,
          adminRolePermissionDetailToggleCount: document.querySelectorAll('[data-testid="admin-role-permission-detail-toggle"]').length,
          adminRolePermissionDetailToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-role-permission-detail-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminRolePermissionDetailVisibleCount: Array.from(document.querySelectorAll('[data-testid="admin-role-permission-detail"]')).filter(
            (node) => node.getBoundingClientRect().height > 0,
          ).length,
          adminRoleProtectionStatusCount: document.querySelectorAll('[data-testid="admin-role-protection-status"]').length,
          adminRoleProtectionSummaryCount: document.querySelectorAll('[data-testid="admin-role-protection-summary"]').length,
          adminRoleProtectionCancelCount: document.querySelectorAll('[data-testid="admin-role-protection-cancel"]').length,
          adminRoleProtectionLongCopyPresent:
            (document.body?.innerText ?? "").includes("현재 계정이 총괄 권한을 잃지 않도록") ||
            (document.body?.innerText ?? "").includes("기본 역할 직접 삭제 제한") ||
            (document.body?.innerText ?? "").includes("관리 권한 변경 승인 필요"),
          adminRoleRecentChangeSectionHeight:
            Math.round(document.querySelector('[data-testid="admin-role-recent-change-section"]')?.getBoundingClientRect().height ?? 0),
          adminRoleRecentChangeListCount: document.querySelectorAll('[data-testid="admin-role-recent-change-list"]').length,
          adminRoleRecentChangeRowCount: document.querySelectorAll('[data-testid="admin-role-recent-change-row"]').length,
          adminRoleRecentChangeEmptyCount: document.querySelectorAll('[data-testid="admin-role-recent-change-empty"]').length,
          adminRoleRecentChangeText: document.querySelector('[data-testid="admin-role-recent-change-list"]')?.textContent ?? "",
          adminRoleRecentChangeToggleCount: document.querySelectorAll('[data-testid="admin-role-recent-change-toggle"]').length,
          adminRoleRecentChangeToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-role-recent-change-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminRoleRecentReadLogCount: Array.from(document.querySelectorAll('[data-testid="admin-role-recent-change-row"]')).filter((row) =>
            row.textContent?.includes("변경 기록 조회") || row.textContent?.includes("변경 기록을 조회했습니다."),
          ).length,
          adminAuditVisibleReadLogCount: Array.from(
            document.querySelectorAll('section[aria-label="변경 기록 목록"] article'),
          ).filter((article) => article.textContent?.includes("변경 기록 조회")).length,
          adminAuditRefreshHeight:
            Math.round(document.querySelector('[data-testid="admin-audit-refresh"]')?.getBoundingClientRect().height ?? 0),
          adminAuditSummaryBarCount: document.querySelectorAll('[data-testid="admin-audit-summary-bar"]').length,
          adminAuditSummaryBarHeight:
            Math.round(document.querySelector('[data-testid="admin-audit-summary-bar"]')?.getBoundingClientRect().height ?? 0),
          adminAuditListRowCount: document.querySelectorAll('[data-testid="admin-audit-log-row"]').length,
          adminAuditListToggleCount: document.querySelectorAll('[data-testid="admin-audit-log-list-toggle"]').length,
          adminAuditListToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-audit-log-list-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminAuditListToggleText: document.querySelector('[data-testid="admin-audit-log-list-toggle"]')?.textContent ?? "",
          adminAuditBottomSafeAreaCount: document.querySelectorAll('[data-testid="admin-audit-bottom-safe-area"]').length,
          adminAuditBottomSafeAreaHeight:
            Math.round(document.querySelector('[data-testid="admin-audit-bottom-safe-area"]')?.getBoundingClientRect().height ?? 0),
          adminAuditListRowMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="admin-audit-log-row"]')).map((row) =>
              Math.round(row.getBoundingClientRect().height),
            ),
          ),
          adminAuditNoDetailRowCount: Array.from(document.querySelectorAll('[data-testid="admin-audit-log-row"]')).filter(
            (row) => !row.querySelector('[data-testid="admin-audit-change-detail"]'),
          ).length,
          adminAuditNoDetailRowMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="admin-audit-log-row"]'))
              .filter((row) => !row.querySelector('[data-testid="admin-audit-change-detail"]'))
              .map((row) => Math.round(row.getBoundingClientRect().height)),
          ),
          adminAuditChangeDetailCount: document.querySelectorAll('[data-testid="admin-audit-change-detail"]').length,
          adminAuditChangeDetailToggleCount: document.querySelectorAll('[data-testid="admin-audit-change-detail-toggle"]').length,
          adminAuditChangeDetailToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="admin-audit-change-detail-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminAuditBranchMetaVisibleCount: Array.from(document.querySelectorAll('[data-testid="admin-audit-branch-meta"]')).filter(
            (node) => node.getBoundingClientRect().height > 0,
          ).length,
          adminAuditTargetMetaVisibleCount: Array.from(document.querySelectorAll('[data-testid="admin-audit-target-meta"]')).filter(
            (node) => node.getBoundingClientRect().height > 0,
          ).length,
          adminAuditMobileResultBadgeCount: Array.from(document.querySelectorAll('[data-testid="admin-audit-result-badge"]')).filter(
            (node) => node.getBoundingClientRect().height > 0,
          ).length,
          adminAuditFilterPanelCount: document.querySelectorAll('[data-testid="admin-audit-filter-panel"]').length,
          adminAuditFilterToggleCount: document.querySelectorAll('[data-testid="admin-audit-filter-toggle"]').length,
          adminAuditFilterToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-audit-filter-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminAuditFilterFieldsVisibleCount: Array.from(document.querySelectorAll('[data-testid="admin-audit-filter-fields"]')).filter(
            (node) => node.getBoundingClientRect().height > 0,
          ).length,
          adminAuditActiveFilterSummaryCount: document.querySelectorAll('[data-testid="admin-audit-active-filter-summary"]').length,
          adminAuditActiveFilterChipCount: document.querySelectorAll('[data-testid="admin-audit-active-filter-summary"] span').length,
          adminSettingsSummaryBarCount: document.querySelectorAll('[data-testid="admin-settings-summary-bar"]').length,
          adminSettingsSummaryBarHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-summary-bar"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsReadinessEditorToggleCount: document.querySelectorAll('[data-testid="admin-settings-readiness-editor-toggle"]').length,
          adminSettingsReadinessEditorToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-readiness-editor-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsReadinessListToggleCount: document.querySelectorAll('[data-testid="admin-settings-readiness-list-toggle"]').length,
          adminSettingsReadinessListToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-readiness-list-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsReadinessListCount: document.querySelectorAll('[data-testid="admin-settings-readiness-list"]').length,
          adminSettingsReadinessItemCount: document.querySelectorAll('[data-testid="admin-settings-readiness-item"]').length,
          adminSettingsVisibleCodeCount: location.pathname === "/app/admin/settings" ? document.querySelectorAll("main code").length : 0,
          adminSettingsVisibleInternalPanelCount:
            location.pathname === "/app/admin/settings"
              ? Array.from(
                  document.querySelectorAll(
                    '[aria-labelledby="internal-release-gates-heading"], [aria-labelledby="p1-release-readiness-heading"], [data-testid^="p1-"], [data-testid^="p2-"], [data-testid^="p3-"], [data-testid^="p4-"]',
                  ),
                ).filter((panel) => {
                  const rect = panel.getBoundingClientRect();

                  return rect.width > 0 && rect.height > 0 && !panel.hasAttribute("hidden");
                }).length
              : 0,
          adminSettingsReadinessEditorFormCount: document.querySelectorAll('[data-testid="admin-settings-readiness-editor-list"]').length,
          adminSettingsReadinessSummaryCount: document.querySelectorAll('[data-testid="admin-settings-readiness-summary"]').length,
          adminSettingsRolePolicySummaryCount: document.querySelectorAll('[data-testid="admin-settings-role-policy-summary"]').length,
          adminSettingsRolePolicySummaryHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-role-policy-summary"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsRolePolicyDetailCount: document.querySelectorAll('[data-testid="admin-settings-role-policy-detail"]').length,
          adminSettingsRolePolicyToggleCount: document.querySelectorAll('[data-testid="admin-settings-role-policy-toggle"]').length,
          adminSettingsRolePolicyToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-role-policy-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsBranchPolicySummaryCount: document.querySelectorAll('[data-testid="admin-settings-branch-policy-summary"]').length,
          adminSettingsBranchPolicySummaryHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-branch-policy-summary"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsBranchPolicyDetailCount: document.querySelectorAll('[data-testid="admin-settings-branch-policy-detail"]').length,
          adminSettingsBranchPolicyToggleCount: document.querySelectorAll('[data-testid="admin-settings-branch-policy-toggle"]').length,
          adminSettingsBranchPolicyToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-branch-policy-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsAuditPolicySummaryCount: document.querySelectorAll('[data-testid="admin-settings-audit-policy-summary"]').length,
          adminSettingsAuditPolicySummaryHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-audit-policy-summary"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsAuditPolicyDetailCount: document.querySelectorAll('[data-testid="admin-settings-audit-policy-detail"]').length,
          adminSettingsAuditPolicyToggleCount: document.querySelectorAll('[data-testid="admin-settings-audit-policy-toggle"]').length,
          adminSettingsAuditPolicyToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-audit-policy-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsServicePolicySummaryCount: document.querySelectorAll('[data-testid="admin-settings-service-policy-summary"]').length,
          adminSettingsServicePolicySummaryHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-service-policy-summary"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsServicePolicySummaryTileCount: document.querySelectorAll('[data-testid="admin-settings-service-policy-summary"] p').length,
          adminSettingsOperatorSummaryCount: document.querySelectorAll('[data-testid="admin-settings-operator-summary"]').length,
          adminSettingsOperatorSummaryTileCount: document.querySelectorAll('[data-testid="admin-settings-operator-summary"] article').length,
          adminSettingsOperatorDetailToggleCount: document.querySelectorAll('[data-testid="admin-settings-operator-detail-toggle"]').length,
          adminSettingsOperatorDetailToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-operator-detail-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsOperatorDetailCount: document.querySelectorAll('[data-testid="admin-settings-operator-detail"]').length,
          adminSettingsOperationHeaderSummaryCount: document.querySelectorAll('[data-testid="admin-settings-operation-header-summary"]').length,
          adminSettingsOperationCompactSummaryCount: document.querySelectorAll('[data-testid="admin-settings-operation-compact-summary"]').length,
          adminSettingsOperationCompactTileCount: document.querySelectorAll('[data-testid="admin-settings-operation-compact-summary"] > div').length,
          adminSettingsOperationDetailToggleCount: document.querySelectorAll('[data-testid="admin-settings-operation-detail-toggle"]').length,
          adminSettingsOperationDetailToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-operation-detail-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsOperationDetailCount: document.querySelectorAll('[data-testid="admin-settings-operation-detail"]').length,
          adminSettingsOperationRecordListCount: document.querySelectorAll('[data-testid="admin-settings-operation-record-list"]').length,
          adminSettingsOperationLogToggleCount: document.querySelectorAll('[data-testid="admin-settings-operation-log-toggle"]').length,
          adminSettingsOperationLogToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-operation-log-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsOperationLogFormCount: document.querySelectorAll('[data-testid="admin-settings-operation-log-form"]').length,
          adminSettingsOperationLogSummaryCount: document.querySelectorAll('[data-testid="admin-settings-operation-log-summary"]').length,
          adminSettingsOperationLogSummaryHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-operation-log-summary"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsOperationLogSummaryText:
            document.querySelector('[data-testid="admin-settings-operation-log-summary"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          adminSettingsIncidentCreateToggleCount: document.querySelectorAll('[data-testid="admin-settings-incident-create-toggle"]').length,
          adminSettingsIncidentCreateToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-incident-create-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsIncidentCreateFormCount: document.querySelectorAll('[data-testid="admin-settings-incident-create-form"]').length,
          adminSettingsIncidentCreateSummaryCount: document.querySelectorAll('[data-testid="admin-settings-incident-create-summary"]').length,
          adminSettingsIncidentCreateSummaryHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-incident-create-summary"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsIncidentCreateSummaryText:
            document.querySelector('[data-testid="admin-settings-incident-create-summary"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          adminSettingsIncidentHeaderSummaryCount: document.querySelectorAll('[data-testid="admin-settings-incident-header-summary"]').length,
          adminSettingsIncidentListToggleCount: document.querySelectorAll('[data-testid="admin-settings-incident-list-toggle"]').length,
          adminSettingsIncidentListToggleHeight:
            Math.round(document.querySelector('[data-testid="admin-settings-incident-list-toggle"]')?.getBoundingClientRect().height ?? 0),
          adminSettingsIncidentListSummaryCount: document.querySelectorAll('[data-testid="admin-settings-incident-list-summary"]').length,
          adminSettingsIncidentEditorToggleCount: document.querySelectorAll('[data-testid="admin-settings-incident-editor-toggle"]').length,
          adminSettingsIncidentEditorToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="admin-settings-incident-editor-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          adminSettingsIncidentEditorFormCount: document.querySelectorAll('[data-testid="admin-settings-incident-editor-form"]').length,
          passwordResetFormCount: document.querySelectorAll('form[id^="admin-user-password-reset-"]').length,
          passwordResetToggleCount: document.querySelectorAll('[data-testid^="admin-user-password-reset-toggle-"]').length,
          familyNoticeReadActionCount: document.querySelectorAll('[data-testid="family-notice-read-action"]').length,
          familyNoticeReadActionMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="family-notice-read-action"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          familyNoticeCompactFilterBarCount: document.querySelectorAll('[data-testid="family-notice-compact-filter-bar"]').length,
          familyNoticeCompactFilterBarHeight:
            Math.round(document.querySelector('[data-testid="family-notice-compact-filter-bar"]')?.getBoundingClientRect().height ?? 0),
          familyNoticeFilterGridColumnCount:
            getComputedStyle(document.querySelector('[data-testid="family-notice-filter-grid"]') ?? document.body).gridTemplateColumns
              .split(" ")
              .filter(Boolean).length,
          familyNoticeFilterButtonMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="family-notice-compact-filter-bar"] button'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          familyNoticeFilterOverflow:
            Math.round(document.querySelector('[data-testid="family-notice-compact-filter-bar"]')?.scrollWidth ?? 0) -
            Math.round(document.querySelector('[data-testid="family-notice-compact-filter-bar"]')?.clientWidth ?? 0),
          familyNoticeStatusBadgeCount: document.querySelectorAll('[data-testid="family-notice-status-badge"]').length,
          familyNoticeCardCount: document.querySelectorAll('[data-testid="family-notice-card"]').length,
          familyNoticeCardMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="family-notice-card"]')).map((card) =>
              Math.round(card.getBoundingClientRect().height),
            ),
          ),
          familyNoticeBodyMaxHeight: Math.max(
            0,
            ...Array.from(
              document.querySelectorAll('[data-testid="family-notice-body"], [data-testid="family-notice-detail-toggle"]'),
            ).map((body) => Math.round(body.getBoundingClientRect().height)),
          ),
          familyNoticeDetailToggleCount: document.querySelectorAll('[data-testid="family-notice-detail-toggle"]').length,
          familyNoticeDetailToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="family-notice-detail-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          familyNoticeDateLineCount: document.querySelectorAll('[data-testid="family-notice-date-line"]').length,
          noticeReadStateBadgeCount: document.querySelectorAll('[data-testid="notice-read-state-badge"]').length,
          noticeDeliveryCompactCardCount: document.querySelectorAll('[data-testid="notice-delivery-compact-card"]').length,
          noticeDeliveryReadCardCount: document.querySelectorAll(
            '[data-testid="notice-delivery-compact-card"][data-notice-read-state="read"]',
          ).length,
          noticeDeliveryReadCardToneDownCount: Array.from(
            document.querySelectorAll('[data-testid="notice-delivery-compact-card"][data-notice-read-state="read"]'),
          ).filter((card) => card.className.includes("bg-zinc-50/70")).length,
          noticeDeliveryReadBadgeToneDownCount: Array.from(
            document.querySelectorAll('[data-notice-read-state="read"] [data-testid="notice-read-state-badge"]'),
          ).filter((badge) => badge.textContent?.trim() === "읽음" && badge.className.includes("text-zinc-500")).length,
          noticeDeliveryCompactCardMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="notice-delivery-compact-card"]')).map((card) =>
              Math.round(card.getBoundingClientRect().height),
            ),
          ),
          noticeDeliveryMetaLineCount: document.querySelectorAll('[data-testid="notice-delivery-meta-line"]').length,
          noticeDeliveryBodyVisibleCount: Array.from(document.querySelectorAll('[data-testid="notice-delivery-body"]')).filter((body) => {
            const rect = body.getBoundingClientRect();
            const style = getComputedStyle(body);

            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          }).length,
          noticeDeliveryBodyMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="notice-delivery-body"]')).map((body) =>
              Math.round(body.getBoundingClientRect().height),
            ),
          ),
          noticeDeliveryDateLineCount: document.querySelectorAll('[data-testid="notice-delivery-date-line"]').length,
          noticeDeliveryActionRowCount: document.querySelectorAll('[data-testid="notice-delivery-action-row"]').length,
          noticeDeliveryActionRowMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="notice-delivery-action-row"]')).map((row) =>
              Math.round(row.getBoundingClientRect().height),
            ),
          ),
          noticeDeliveryActionButtonMaxWidth: Math.max(
            0,
            ...Array.from(
              document.querySelectorAll('[data-testid="notice-delivery-read-action"], [data-testid="notice-delivery-push-action"]'),
            ).map((button) => Math.round(button.getBoundingClientRect().width)),
          ),
          noticeDeliveryLongPushLabelCount: Array.from(document.querySelectorAll('[data-testid="notice-delivery-action-row"] button')).filter(
            (button) => button.textContent?.trim() === "알림 발송",
          ).length,
          familyNoticeInboxHeadingCount: Array.from(document.querySelectorAll("h2")).filter(
            (heading) => heading.textContent?.trim() === "공지함",
          ).length,
          notificationPermissionButtonMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="notification-permission-panel"] button'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          notificationPermissionPanelHeight:
            Math.round(document.querySelector('[data-testid="notification-permission-panel"]')?.getBoundingClientRect().height ?? 0),
          notificationPermissionStatusChipCount: document.querySelectorAll('[data-testid="notification-permission-status-row"] span').length,
          notificationPermissionActionsColumnCount:
            getComputedStyle(document.querySelector('[data-testid="notification-permission-actions"]') ?? document.body).gridTemplateColumns
              .split(" ")
              .filter(Boolean).length,
          notificationPermissionActionsHeight:
            Math.round(document.querySelector('[data-testid="notification-permission-actions"]')?.getBoundingClientRect().height ?? 0),
          notificationPermissionActionText: Array.from(document.querySelectorAll('[data-testid="notification-permission-panel"] button'))
            .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("|"),
          noticeOperationsPanelCount: document.querySelectorAll('[data-testid="notice-operations-panel"]').length,
          noticeOperationsPanelHeight:
            Math.round(document.querySelector('[data-testid="notice-operations-panel"]')?.getBoundingClientRect().height ?? 0),
          noticeOperationsToggleCount: document.querySelectorAll('[data-testid="notice-operations-toggle"]').length,
          noticeOperationsToggleHeight:
            Math.round(document.querySelector('[data-testid="notice-operations-toggle"]')?.getBoundingClientRect().height ?? 0),
          noticeOperationsMetricCount: document.querySelectorAll('[data-testid="notice-operations-metric"]').length,
          noticeOperationsDetailCount: document.querySelectorAll('[data-testid="notice-operations-detail"]').length,
          noticeActionQueueCount: document.querySelectorAll('[data-testid="notice-action-queue"]').length,
          noticeFollowUpBoardCount: document.querySelectorAll('[data-testid="p2-notice-follow-up-board"]').length,
          noticeCreatePanelCount: document.querySelectorAll('[data-testid="notice-create-panel"]').length,
          noticeCreatePanelTop:
            Math.round(document.querySelector('[data-testid="notice-create-panel"]')?.getBoundingClientRect().top ?? 0),
          noticeFirstDeliveryCardTop:
            Math.round(document.querySelector('[data-testid="notice-delivery-compact-card"]')?.getBoundingClientRect().top ?? 0),
          noticeCreateToggleCount: document.querySelectorAll('[data-testid="notice-create-toggle"]').length,
          noticeCreateToggleHeight:
            Math.round(document.querySelector('[data-testid="notice-create-toggle"]')?.getBoundingClientRect().height ?? 0),
          noticeCreateFormCount: document.querySelectorAll('[data-testid="notice-create-form"]').length,
          noticeCreateControlMinHeight: Math.min(
            ...Array.from(
              document.querySelectorAll(
                '[data-testid="notice-create-form"] input:not([type="checkbox"]):not([type="radio"]), [data-testid="notice-create-form"] select, [data-testid="notice-create-form"] button, [data-testid="notice-create-form"] label',
              ),
            )
              .map((control) => Math.round(control.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          noticeCreateAudienceChipMinHeight: Math.min(
            ...Array.from(
              document.querySelectorAll(
                '[data-testid="notice-create-form"] fieldset label, [data-testid="notice-create-form"] label:has(input[type="checkbox"])',
              ),
            )
              .map((control) => Math.round(control.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          memberPaymentFilterChipGroupCount: document.querySelectorAll('[data-testid="member-payment-filter-chips"]').length,
          memberPaymentFilterChipCount: document.querySelectorAll('[data-testid="member-payment-filter-chip"]').length,
          memberPaymentFilterChipCountLabelCount: document.querySelectorAll('[data-testid="member-payment-filter-chip-count"]').length,
          memberPaymentFilterChipMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="member-payment-filter-chip"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          memberPaymentFilterStatusCount: document.querySelectorAll('[data-testid="member-payment-filter-status"]').length,
          memberPaymentFilterHeadingCount: Array.from(
            document.querySelectorAll('[data-testid="member-payment-filter-chips"] p'),
          ).filter((node) => /보기/.test(node.textContent ?? "")).length,
          memberPaymentFilterChipGroupHeight:
            Math.round(document.querySelector('[data-testid="member-payment-filter-chips"]')?.getBoundingClientRect().height ?? 0),
          memberPaymentFilterLargeSummaryCount: Array.from(
            document.querySelectorAll('[data-testid="member-payment-filter-chips"] > p'),
          ).filter((node) => /결제\s+\d+건/.test(node.textContent ?? "")).length,
          memberPaymentFilterSelectCount: document.querySelectorAll('[aria-label="결제 필터"] select').length,
          memberPaymentCompactCardCount: document.querySelectorAll('[data-testid="member-payment-compact-card"]').length,
          memberPaymentDateLineCount: document.querySelectorAll('[data-testid="member-payment-date-line"]').length,
          memberPaymentDateLineMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="member-payment-date-line"]'))
              .map((line) => Math.round(line.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          memberPaymentCheckoutActionCount: document.querySelectorAll('[data-testid="member-payment-checkout-action"]').length,
          memberPaymentCheckoutActionTexts: Array.from(document.querySelectorAll('[data-testid="member-payment-checkout-action"]')).map((action) =>
            action.textContent?.replace(/\s+/g, " ").trim() ?? "",
          ),
          memberPaymentCheckoutActionMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="member-payment-checkout-action"]'))
              .map((action) => Math.round(action.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          memberPaymentCheckoutStateBadgeCount: document.querySelectorAll('[data-testid="member-payment-checkout-state-badge"]').length,
          memberPaymentCheckoutStateBadgeMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="member-payment-checkout-state-badge"]'))
              .map((badge) => Math.round(badge.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          memberPaymentCheckoutLinkCardCount: document.querySelectorAll(
            '[data-testid="member-payment-compact-card"][role="link"]',
          ).length,
          memberPaymentCheckoutActionInLinkCardCount: Array.from(
            document.querySelectorAll('[data-testid="member-payment-checkout-action"]'),
          ).filter((action) => action.closest('[data-testid="member-payment-compact-card"][role="link"]')).length,
          memberPaymentCheckoutStateBadgeInLinkCardCount: Array.from(
            document.querySelectorAll('[data-testid="member-payment-checkout-state-badge"]'),
          ).filter((badge) => badge.closest('[data-testid="member-payment-compact-card"][role="link"]')).length,
          memberPaymentBlockedCheckoutLinkCardCount: Array.from(
            document.querySelectorAll('[data-testid="member-payment-compact-card"][role="link"]'),
          ).filter((card) => {
            const checkoutState = card.getAttribute("data-payment-checkout-state");

            return checkoutState !== "ready" && checkoutState !== "pending";
          }).length,
          memberPaymentCompactCardMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="member-payment-compact-card"]'))
              .map((card) => Math.round(card.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          memberPaymentCompactAmountTextCount: Array.from(
            document.querySelectorAll('[data-testid="member-payment-compact-card"]'),
          ).filter((node) => {
            const clone = node.cloneNode(true);

            if (!(clone instanceof HTMLElement)) {
              return /₩|원\b/.test(node.textContent ?? "");
            }

            clone.querySelectorAll('[data-testid="member-payment-checkout-action"]').forEach((action) => action.remove());

            return /₩|원\b/.test(clone.textContent ?? "");
          }).length,
          memberGuardianPriorityGridCount: document.querySelectorAll('[data-testid="member-guardian-priority-grid"]').length,
          memberGuardianPriorityCellCount: document.querySelectorAll('[data-testid="member-guardian-priority-cell"]').length,
          memberGuardianPriorityHrefs: Array.from(document.querySelectorAll('[data-testid="member-guardian-priority-cell"]')).map((cell) =>
            cell.getAttribute("href") ?? "",
          ),
          memberGuardianPriorityLabels: Array.from(document.querySelectorAll('[data-testid="member-guardian-priority-cell"]')).map((cell) =>
            cell.querySelector("p")?.textContent?.trim() ?? "",
          ),
          memberGuardianPriorityDetails: Array.from(document.querySelectorAll('[data-testid="member-guardian-priority-cell"]')).map((cell) =>
            Array.from(cell.querySelectorAll("p"))[1]?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          ),
          memberGuardianPriorityCellMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="member-guardian-priority-cell"]'))
              .map((cell) => Math.round(cell.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          memberGuardianPriorityCellMaxHeight: Math.max(
            ...Array.from(document.querySelectorAll('[data-testid="member-guardian-priority-cell"]'))
              .map((cell) => Math.round(cell.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          legacyNoticeConfirmButtonCount: Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "확인 완료").length,
          noticeExpandButtonCount: Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "자세히").length,
          noticeExpandButtonMinHeight: Math.min(
            ...Array.from(document.querySelectorAll("button"))
              .filter((button) => button.textContent?.trim() === "자세히")
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          noticeDeliveryReadActionMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="notice-delivery-read-action"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          noticeDeliveryPushActionMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="notice-delivery-push-action"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          noticeExpandedButtonCount: Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "접기").length,
          finalWordmarkCount: finalWordmarks.length,
          finalWordmarkLinkCount: finalWordmarkLinkHeights.length,
          finalWordmarkMinTouchHeight: finalWordmarkLinkHeights.length > 0 ? Math.min(...finalWordmarkLinkHeights) : 0,
          finalWordmarkVisualMinHeight: finalWordmarkVisualHeights.length > 0 ? Math.min(...finalWordmarkVisualHeights) : 0,
          rasterFinalLogoCount: document.querySelectorAll('img[alt="FINAL"]').length,
          familyRepeatedScreenHeaderCount: Array.from(document.querySelectorAll("h1")).filter((heading) =>
            ["수업/출석", "내 프로필", "자녀 회원", "결제 상태", "공지"].includes(heading.textContent?.trim() ?? ""),
          ).length,
          familyMemberSearchInputCount: document.querySelectorAll('input[placeholder="이름, 레벨, 연락처 검색"]').length,
          memberStatusFilterCount: document.querySelectorAll('[data-testid^="member-status-filter-"]').length,
          memberStatusFilterMinHeight: (() => {
            const heights = Array.from(document.querySelectorAll('[data-testid^="member-status-filter-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0);

            return heights.length > 0 ? Math.min(...heights) : 0;
          })(),
          memberEmergencyContactCallCount: document.querySelectorAll('[data-testid^="member-emergency-contact-call-"]').length,
          memberEmergencyContactCallMinHeight: (() => {
            const heights = Array.from(document.querySelectorAll('[data-testid^="member-emergency-contact-call-"]'))
              .map((link) => Math.round(link.getBoundingClientRect().height))
              .filter((height) => height > 0);

            return heights.length > 0 ? Math.min(...heights) : 0;
          })(),
          memberEmergencyContactCallMinWidth: (() => {
            const widths = Array.from(document.querySelectorAll('[data-testid^="member-emergency-contact-call-"]'))
              .map((link) => Math.round(link.getBoundingClientRect().width))
              .filter((width) => width > 0);

            return widths.length > 0 ? Math.min(...widths) : 0;
          })(),
          familyMemberProfileCardCount: document.querySelectorAll('[data-testid="family-member-profile-card"]').length,
          familyMemberFeedbackHeadingCount: document.querySelectorAll('[data-testid="family-member-feedback-heading"]').length,
          familyMemberFeedbackCardCount: document.querySelectorAll('[data-testid="family-member-feedback-card"]').length,
          familyMemberFeedbackVisibilityMetaCount: Array.from(
            document.querySelectorAll('[data-testid="family-member-feedback-card"]'),
          ).filter((node) => /학부모에게 공유|코치에게 공유|직원만/.test(node.textContent ?? "")).length,
          familyMemberWarningHeadingCount: Array.from(document.querySelectorAll('[data-testid="family-member-profile-card"]')).flatMap((card) =>
            Array.from(card.querySelectorAll("p, h2, h3")).filter((node) => node.textContent?.trim() === "주의사항"),
          ).length,
          familyMemberEmptyAlertCopyCount: Array.from(document.querySelectorAll('[data-testid="family-member-profile-card"]')).filter((card) =>
            /등록된 주의사항 없음/.test(card.textContent ?? ""),
          ).length,
          memberProfileEmptyAlertCopyCount: Array.from(document.querySelectorAll("article")).filter((card) =>
            /등록된 주의사항 없음/.test(card.textContent ?? ""),
          ).length,
          memberProfileEmptyNoteCopyCount: Array.from(document.querySelectorAll("article")).filter((card) =>
            /아직 상담\/주의 메모가 없습니다|아직 코치 피드백이 없습니다/.test(card.textContent ?? ""),
          ).length,
          familyMemberAlertStripCount: document.querySelectorAll('[data-testid="family-member-alert-strip"]').length,
          familyMemberAlertStripMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="family-member-alert-strip"]')).map((strip) =>
              Math.round(strip.getBoundingClientRect().height),
            ),
          ),
          memberNoteEditorToggleCount: document.querySelectorAll('[data-testid^="member-note-editor-toggle-"]').length,
          memberNoteEditorToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid^="member-note-editor-toggle-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          memberNoteEditorToggleBottomNavOverlapCount: (() => {
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const bottomNavTop = bottomNav?.getBoundingClientRect().top ?? window.innerHeight;

            return Array.from(document.querySelectorAll('[data-testid^="member-note-editor-toggle-"]')).filter((button) => {
              const rect = button.getBoundingClientRect();
              const style = getComputedStyle(button);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.top < window.innerHeight &&
                rect.bottom > bottomNavTop
              );
            }).length;
          })(),
          memberNoteEditorCount: document.querySelectorAll('[data-testid^="member-note-editor-"]:not([data-testid^="member-note-editor-toggle-"])').length,
          memberGuardianPhoneCallCount: document.querySelectorAll('[data-testid^="member-guardian-phone-call-"]').length,
          memberGuardianPhoneCallMinHeight: (() => {
            const heights = Array.from(document.querySelectorAll('[data-testid^="member-guardian-phone-call-"]'))
              .map((link) => Math.round(link.getBoundingClientRect().height))
              .filter((height) => height > 0);

            return heights.length > 0 ? Math.min(...heights) : 0;
          })(),
          coachMemberProfileCardCount: document.querySelectorAll('[data-testid="coach-member-profile-card"]').length,
          coachVisibleMemberProfileCardCount: Array.from(document.querySelectorAll('[data-testid="coach-member-profile-card"]')).filter((card) => {
            const rect = card.getBoundingClientRect();
            const style = getComputedStyle(card);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          }).length,
          coachMemberNoticeActionMinHeight: (() => {
            const heights = Array.from(document.querySelectorAll('[data-testid^="member-send-notice-"]'))
              .map((link) => Math.round(link.getBoundingClientRect().height))
              .filter((height) => height > 0);

            return heights.length > 0 ? Math.min(...heights) : 0;
          })(),
          coachMemberPaymentActionMinHeight: (() => {
            const heights = Array.from(document.querySelectorAll('[data-testid^="member-create-payment-"]'))
              .map((link) => Math.round(link.getBoundingClientRect().height))
              .filter((height) => height > 0);

            return heights.length > 0 ? Math.min(...heights) : 0;
          })(),
          coachMemberListToggleCount: document.querySelectorAll('[data-testid="coach-member-list-toggle"]').length,
          coachMemberListToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="coach-member-list-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachMemberListToggleText:
            document.querySelector('[data-testid="coach-member-list-toggle"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          coachMemberListToggleBottomNavOverlapCount: (() => {
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const bottomNavTop = bottomNav?.getBoundingClientRect().top ?? window.innerHeight;

            return Array.from(document.querySelectorAll('[data-testid="coach-member-list-toggle"]')).filter((button) => {
              const rect = button.getBoundingClientRect();
              const style = getComputedStyle(button);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.top < window.innerHeight &&
                rect.bottom > bottomNavTop
              );
            }).length;
          })(),
          coachMemberBottomSafeAreaCount: document.querySelectorAll('[data-testid="coach-member-bottom-safe-area"]').length,
          coachMemberBottomSafeAreaMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="coach-member-bottom-safe-area"]'))
              .map((spacer) => Math.round(spacer.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachMemberNoteSectionCount: document.querySelectorAll('[data-testid="coach-member-note-section"]').length,
          coachMemberNoteClosedSectionCount: document.querySelectorAll('[data-testid="coach-member-note-section"][data-note-state="closed"]').length,
          coachMemberNoteOpenSectionCount: document.querySelectorAll('[data-testid="coach-member-note-section"][data-note-state="open"]').length,
          coachMemberNoteSummaryCount: document.querySelectorAll('[data-testid="coach-member-note-summary"]').length,
          coachMemberNoteCardCount: document.querySelectorAll('[data-testid="coach-member-note-card"]').length,
          coachMemberNoteListToggleCount: document.querySelectorAll('[data-testid^="member-note-list-toggle-"]').length,
          coachMemberNoteListToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid^="member-note-list-toggle-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachMemberNoteListMaxItems: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid^="member-note-list-"]')).map((list) =>
              list.querySelectorAll("li").length,
            ),
          ),
          coachMemberEmptyAlertCopyCount: Array.from(document.querySelectorAll("article")).filter((card) =>
            /상담\/주의 메모/.test(card.textContent ?? "") && /등록된 주의사항 없음/.test(card.textContent ?? ""),
          ).length,
          coachMemberEmptyNoteCopyCount: Array.from(document.querySelectorAll("article")).filter((card) =>
            /상담\/주의 메모/.test(card.textContent ?? "") && /아직 상담\/주의 메모가 없습니다/.test(card.textContent ?? ""),
          ).length,
          ownerBranchComparisonGraphCount: document.querySelectorAll('[data-testid="owner-dashboard-branch-comparison-graph"]').length,
          adminDashboardClassesLinkHeight:
            Math.round(document.querySelector('[data-testid="admin-dashboard-classes-link"]')?.getBoundingClientRect().height ?? 0),
          ownerBranchComparisonRowCount: document.querySelectorAll('[data-testid="owner-dashboard-branch-comparison-row"]').length,
          ownerBranchComparisonRowMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-dashboard-branch-comparison-row"]')).map((row) =>
              Math.round(row.getBoundingClientRect().height),
            ),
          ),
          ownerBranchComparisonRowBottomNavOverlap: (() => {
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');

            if (!bottomNav) {
              return 0;
            }

            const navTop = bottomNav.getBoundingClientRect().top;

            return Math.max(
              0,
              ...Array.from(document.querySelectorAll('[data-testid="owner-dashboard-branch-comparison-row"]')).map((row) =>
                Math.max(0, Math.round(row.getBoundingClientRect().bottom - navTop)),
              ),
            );
          })(),
          ownerBranchComparisonRowBottomNavClearance: (() => {
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const rows = Array.from(document.querySelectorAll('[data-testid="owner-dashboard-branch-comparison-row"]'));

            if (!bottomNav || rows.length === 0) {
              return 0;
            }

            const navTop = bottomNav.getBoundingClientRect().top;

            return Math.min(...rows.map((row) => Math.round(navTop - row.getBoundingClientRect().bottom)));
          })(),
          ownerBranchComparisonCardBottomNavOverlap: (() => {
            const graph = document.querySelector('[data-testid="owner-dashboard-branch-comparison-graph"]');
            const card = graph?.closest(".rounded-lg");
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');

            if (!card || !bottomNav) {
              return 0;
            }

            return Math.max(0, Math.round(card.getBoundingClientRect().bottom - bottomNav.getBoundingClientRect().top));
          })(),
          ownerBranchComparisonCardBottomNavClearance: (() => {
            const graph = document.querySelector('[data-testid="owner-dashboard-branch-comparison-graph"]');
            const card = graph?.closest(".rounded-lg");
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');

            if (!card || !bottomNav) {
              return 0;
            }

            return Math.round(bottomNav.getBoundingClientRect().top - card.getBoundingClientRect().bottom);
          })(),
          ownerBranchMetricGridCount: document.querySelectorAll('[data-testid="owner-dashboard-branch-metric-grid"]').length,
          ownerBranchMetricGridMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-dashboard-branch-metric-grid"]')).map((grid) =>
              Math.round(grid.getBoundingClientRect().height),
            ),
          ),
          ownerBranchComparisonText:
            document.querySelector('[data-testid="owner-dashboard-branch-comparison-graph"]')?.textContent ?? "",
          ownerDashboardPeriodFilterCount: document.querySelectorAll('[data-testid="owner-dashboard-period-filter"]').length,
          ownerDashboardPeriodOptionCount: document.querySelectorAll('[data-testid="owner-dashboard-period-option"]').length,
          ownerDashboardPeriodOptionText: Array.from(document.querySelectorAll('[data-testid="owner-dashboard-period-option"]'))
            .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("|"),
          ownerDashboardPeriodOptionMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="owner-dashboard-period-option"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          ownerDashboardGraphBoardHeight:
            Math.round(document.querySelector('[data-testid="owner-dashboard-graph-board"]')?.getBoundingClientRect().height ?? 0),
          ownerDashboardSecondaryGraphGridCount: document.querySelectorAll('[data-testid="owner-dashboard-secondary-graph-grid"]').length,
          ownerDashboardGraphRowCount: document.querySelectorAll('[data-testid^="owner-dashboard-graph-row-"]').length,
          ownerDashboardSecondaryGraphRowCount: document.querySelectorAll(
            '[data-testid="owner-dashboard-secondary-graph-grid"] [data-testid^="owner-dashboard-graph-row-"]',
          ).length,
          ownerDashboardSecondaryGraphGridHeight:
            Math.round(document.querySelector('[data-testid="owner-dashboard-secondary-graph-grid"]')?.getBoundingClientRect().height ?? 0),
          ownerDashboardGraphLabelOverflow: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-dashboard-graph-label"]')).map(
              (label) => Math.round(label.scrollWidth - label.clientWidth),
            ),
          ),
          ownerDashboardRiskSummaryTop: Math.round(
            document.querySelector('[data-testid="owner-dashboard-risk-summary"]')?.getBoundingClientRect().top ?? 0,
          ),
          ownerDashboardRiskSummaryBottom: Math.round(
            document.querySelector('[data-testid="owner-dashboard-risk-summary"]')?.getBoundingClientRect().bottom ?? 0,
          ),
          ownerDashboardRiskSummaryBottomNavOverlap: (() => {
            const riskSummary = document.querySelector('[data-testid="owner-dashboard-risk-summary"]');
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');

            if (!riskSummary || !bottomNav) {
              return 0;
            }

            return Math.max(
              0,
              Math.round(riskSummary.getBoundingClientRect().bottom - bottomNav.getBoundingClientRect().top),
            );
          })(),
          ownerDashboardDetailToggleCount: document.querySelectorAll('[data-testid="owner-dashboard-detail-toggle"]').length,
          ownerDashboardDetailToggleHeight: Math.round(
            document.querySelector('[data-testid="owner-dashboard-detail-toggle"]')?.getBoundingClientRect().height ?? 0,
          ),
          ownerDashboardDetailToggleBottomNavOverlap: (() => {
            const toggle = document.querySelector('[data-testid="owner-dashboard-detail-toggle"]');
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');

            if (!toggle || !bottomNav) {
              return 0;
            }

            return Math.max(0, Math.round(toggle.getBoundingClientRect().bottom - bottomNav.getBoundingClientRect().top));
          })(),
          ownerDashboardDetailToggleBottomNavClearance: (() => {
            const toggle = document.querySelector('[data-testid="owner-dashboard-detail-toggle"]');
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');

            if (!toggle || !bottomNav) {
              return 0;
            }

            return Math.round(bottomNav.getBoundingClientRect().top - toggle.getBoundingClientRect().bottom);
          })(),
          ownerBranchHealthGraphCount: document.querySelectorAll('[data-testid="owner-branch-health-graph"]').length,
          ownerBranchHealthGraphMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-branch-health-graph"]')).map((graph) =>
              Math.round(graph.getBoundingClientRect().height),
            ),
          ),
          ownerBranchHealthRowCount: document.querySelectorAll('[data-testid="owner-branch-health-row"]').length,
          ownerBranchHealthRowMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-branch-health-row"]')).map((row) =>
              Math.round(row.getBoundingClientRect().height),
            ),
          ),
          ownerBranchHealthText: Array.from(document.querySelectorAll('[data-testid="owner-branch-health-graph"]'))
            .map((node) => node.textContent ?? "")
            .join(" "),
          ownerBranchPolicySummaryCount: document.querySelectorAll('[data-testid="owner-branch-policy-summary"]').length,
          ownerBranchPolicyDetailCount: document.querySelectorAll('[data-testid="owner-branch-policy-detail"]').length,
          ownerBranchPolicyToggleCount: document.querySelectorAll('[data-testid="owner-branch-policy-toggle"]').length,
          ownerBranchPolicyToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="owner-branch-policy-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          ownerBranchActionLinkCount: document.querySelectorAll('[data-testid="owner-branch-action-link"]').length,
          ownerBranchActionLinkMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="owner-branch-action-link"]'))
              .map((link) => Math.round(link.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          ownerBranchActionToggleCount: document.querySelectorAll('[data-testid="owner-branch-action-toggle"]').length,
          ownerBranchActionToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="owner-branch-action-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          ownerBranchBottomSafeAreaCount: document.querySelectorAll('[data-testid="owner-branch-bottom-safe-area"]').length,
          ownerBranchBottomSafeAreaHeight: Math.round(document.querySelector('[data-testid="owner-branch-bottom-safe-area"]')?.getBoundingClientRect().height ?? 0),
          ownerBranchActionBottomNavClearanceAtScrollEnd: (() => {
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const actions = Array.from(
              document.querySelectorAll('[data-testid="owner-branch-action-link"], [data-testid="owner-branch-action-toggle"]'),
            );

            if (!bottomNav || actions.length === 0) {
              return 0;
            }

            const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            const navTop = bottomNav.getBoundingClientRect().top;

            return Math.min(
              ...actions.map((action) => {
                const actionBottomAtScrollEnd = action.getBoundingClientRect().bottom + window.scrollY - maxScrollY;

                return Math.round(navTop - actionBottomAtScrollEnd);
              }),
            );
          })(),
          coachDashboardFlowGraphCount: document.querySelectorAll('[data-testid="coach-dashboard-flow-graph"]').length,
          coachDashboardFlowGraphHeight: Math.round(
            document.querySelector('[data-testid="coach-dashboard-flow-graph"]')?.getBoundingClientRect().height ?? 0,
          ),
          coachDashboardFlowRowCount: document.querySelectorAll('[data-testid="coach-dashboard-flow-row"]').length,
          coachDashboardFlowRowMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="coach-dashboard-flow-row"]'))
              .map((row) => Math.round(row.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachDashboardFlowText:
            document.querySelector('[data-testid="coach-dashboard-flow-graph"]')?.textContent ?? "",
          coachDashboardAllClassesLinkHeight:
            Math.round(document.querySelector('[data-testid="coach-dashboard-all-classes-link"]')?.getBoundingClientRect().height ?? 0),
          coachDashboardClassesPanelTop:
            Math.round(document.querySelector('[data-testid="coach-dashboard-classes-panel"]')?.getBoundingClientRect().top ?? 0),
          guardianLearningStageBarCount: document.querySelectorAll('[data-testid="guardian-learning-stage-bar"]').length,
          guardianLearningInsightGridCount: document.querySelectorAll('[data-testid="guardian-learning-insight-grid"]').length,
          guardianLearningInsightGridHeight: Math.round(
            document.querySelector('[data-testid="guardian-learning-insight-grid"]')?.getBoundingClientRect().height ?? 0,
          ),
          guardianLearningInsightCellCount: document.querySelectorAll('[data-testid="guardian-learning-insight-cell"]').length,
          guardianLearningInsightCellMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="guardian-learning-insight-cell"]'))
              .map((cell) => Math.round(cell.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          guardianLearningInsightCellMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="guardian-learning-insight-cell"]'))
              .map((cell) => Math.round(cell.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          guardianLearningInsightText:
            document.querySelector('[data-testid="guardian-learning-insight-grid"]')?.textContent ?? "",
          guardianLearningActionStripCount: document.querySelectorAll('[data-testid="guardian-learning-action-strip"]').length,
          guardianLearningActionLinkCount: document.querySelectorAll('[data-testid="guardian-learning-action-link"]').length,
          guardianLearningActionLinkMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="guardian-learning-action-link"]'))
              .map((link) => Math.round(link.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          guardianLearningActionHrefs: Array.from(document.querySelectorAll('[data-testid="guardian-learning-action-link"]')).map((link) =>
            link.getAttribute("href") ?? "",
          ),
          guardianLearningActionAriaLabels: Array.from(document.querySelectorAll('[data-testid="guardian-learning-action-link"]')).map((link) =>
            link.getAttribute("aria-label") ?? "",
          ),
          guardianLearningActionText:
            document.querySelector('[data-testid="guardian-learning-action-strip"]')?.textContent ?? "",
          guardianChildSwitcherCount: document.querySelectorAll('[data-testid="guardian-child-switcher"]').length,
          guardianChildChipCount: document.querySelectorAll('[data-testid="guardian-child-chip"]').length,
          guardianChildChipStatusTextCount: Array.from(document.querySelectorAll('[data-testid="guardian-child-chip"]')).filter(
            (chip) => /활성|초대 대기|휴면|체험중/.test(chip.textContent ?? ""),
          ).length,
          guardianChildChipMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="guardian-child-chip"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          guardianChildChipMaxHeight: Math.max(
            ...Array.from(document.querySelectorAll('[data-testid="guardian-child-chip"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          personalAttendanceSummaryCount: document.querySelectorAll('[data-testid^="personal-attendance-summary-"]').length,
          familyClassCardCount: document.querySelectorAll('[data-testid^="family-class-card-"]').length,
          familyClassCardMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid^="family-class-card-"]'))
              .map((card) => Math.round(card.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          familyAttendanceChipGridCount: document.querySelectorAll('[data-testid^="family-attendance-chip-grid-"]').length,
          familyAttendanceChipCount: document.querySelectorAll(
            '[data-testid^="family-attendance-chip-"]:not([data-testid^="family-attendance-chip-grid-"])',
          ).length,
          familyAttendanceChipMinHeight: Math.min(
            ...Array.from(
              document.querySelectorAll('[data-testid^="family-attendance-chip-"]:not([data-testid^="family-attendance-chip-grid-"])'),
            )
              .map((chip) => Math.round(chip.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          familyAttendanceChipMaxHeight: Math.max(
            0,
            ...Array.from(
              document.querySelectorAll('[data-testid^="family-attendance-chip-"]:not([data-testid^="family-attendance-chip-grid-"])'),
            )
              .map((chip) => Math.round(chip.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          attendanceUncheckedFilterLabelHeight:
            Math.round(document.querySelector('[data-testid="attendance-unchecked-filter"]')?.closest("label")?.getBoundingClientRect().height ?? 0),
          attendanceUncheckedFilterBoxHeight:
            Math.round(document.querySelector('[data-testid="attendance-unchecked-filter"]')?.getBoundingClientRect().height ?? 0),
          coachAttendanceControlPanelHeight:
            Math.round(document.querySelector('[data-testid="coach-attendance-control-panel"]')?.getBoundingClientRect().height ?? 0),
          attendanceRosterSearchInputCount: document.querySelectorAll('[data-testid="attendance-roster-search"]').length,
          attendanceRosterSearchToggleCount: document.querySelectorAll('[data-testid="attendance-roster-search-toggle"]').length,
          attendanceRosterSearchToggleHeight:
            Math.round(document.querySelector('[data-testid="attendance-roster-search-toggle"]')?.getBoundingClientRect().height ?? 0),
          coachMobileSpeedPanelHeight:
            Math.round(document.querySelector('[data-testid="coach-mobile-speed-panel"]')?.getBoundingClientRect().height ?? 0),
          coachMobileSpeedActionButtonMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('button[data-testid^="coach-mobile-speed-"][data-testid$="-action"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachMobileSpeedPressedStates: Array.from(
            document.querySelectorAll('button[data-testid^="coach-mobile-speed-"][data-testid$="-action"]'),
          )
            .map((button) => `${button.getAttribute("data-testid")}:${button.getAttribute("aria-pressed") ?? ""}`)
            .join("|"),
          coachMobileSpeedSummaryChipCount: document.querySelectorAll('[data-testid="coach-mobile-speed-summary-chip"]').length,
          coachMobileSpeedSummaryChipMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="coach-mobile-speed-summary-chip"]')).map((chip) =>
              Math.round(chip.getBoundingClientRect().height),
            ),
          ),
          coachMobileSpeedSummaryLineCount: document.querySelectorAll('[data-testid="coach-mobile-speed-summary-line"]').length,
          coachMobileSpeedSummaryLineHeight:
            Math.round(document.querySelector('[data-testid="coach-mobile-speed-summary-line"]')?.getBoundingClientRect().height ?? 0),
          coachMobileToolsToggleHeight:
            Math.round(document.querySelector('[data-testid="coach-mobile-tools-toggle"]')?.getBoundingClientRect().height ?? 0),
          coachMobileToolsExpanded:
            document.querySelector('[data-testid="coach-mobile-tools-toggle"]')?.getAttribute("aria-expanded") ?? "",
          coachMobileToolsDetailsHeight:
            Math.round(document.querySelector('[data-testid="coach-mobile-tools-details"]')?.getBoundingClientRect().height ?? 0),
          coachFieldFlowPanelHeight:
            Math.round(document.querySelector('[data-testid="coach-field-flow-panel"]')?.getBoundingClientRect().height ?? 0),
          coachFieldFlowCompactGridCount: document.querySelectorAll('[data-testid="coach-field-flow-compact-grid"]').length,
          coachFieldFlowCompactColumnCount: document.querySelectorAll('[data-testid="coach-field-flow-compact-column"]').length,
          coachFieldFlowCompactSummaryCount: document.querySelectorAll('[data-testid="coach-field-flow-compact-summary"]').length,
          attendanceStatusFilterGroupHeight:
            Math.round(document.querySelector('[data-testid="attendance-status-filter-group"]')?.getBoundingClientRect().height ?? 0),
          attendanceStatusFilterButtonCount: document.querySelectorAll('button[data-testid^="attendance-status-filter-"]').length,
          attendanceStatusFilterButtonText: Array.from(document.querySelectorAll('button[data-testid^="attendance-status-filter-"]'))
            .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join(" | "),
          attendanceStatusFilterGroupOverflow:
            Math.max(
              0,
              Math.round(document.querySelector('[data-testid="attendance-status-filter-group"]')?.scrollWidth ?? 0) -
                Math.round(document.querySelector('[data-testid="attendance-status-filter-group"]')?.clientWidth ?? 0),
            ),
          attendanceStatusFilterButtonMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('button[data-testid^="attendance-status-filter-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachClassRosterToggleCount: document.querySelectorAll('[data-testid^="coach-class-roster-toggle-"]').length,
          coachClassRosterLongLabelCount: Array.from(
            document.querySelectorAll('[data-testid^="coach-class-roster-toggle-"]'),
          ).filter((button) => /출석\s*명단|미처리\s*\d+명/.test(button.textContent ?? "")).length,
          coachClassCardCount: document.querySelectorAll('[data-testid^="coach-class-card-"]').length,
          coachVisibleClassCardCount: Array.from(document.querySelectorAll('[data-testid^="coach-class-card-"]')).filter((card) => {
            const rect = card.getBoundingClientRect();
            const style = getComputedStyle(card);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          }).length,
          coachFirstClassCardTop:
            Math.round(document.querySelector('[data-testid^="coach-class-card-"]')?.getBoundingClientRect().top ?? 0),
          coachClassCardMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid^="coach-class-card-"]')).map((card) =>
              Math.round(card.getBoundingClientRect().height),
            ),
          ),
          coachClassAttendanceSummaryCount: document.querySelectorAll('[data-testid^="coach-class-attendance-summary-"]').length,
          coachClassAttendanceSummaryMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid^="coach-class-attendance-summary-"]')).map((summary) =>
              Math.round(summary.getBoundingClientRect().height),
            ),
          ),
          coachClassRosterToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid^="coach-class-roster-toggle-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachClassListToggleCount: document.querySelectorAll('[data-testid="coach-class-list-toggle"]').length,
          coachClassListToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="coach-class-list-toggle"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachClassListToggleText:
            document.querySelector('[data-testid="coach-class-list-toggle"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          coachClassRosterToggleBottomNavOverlapCount: (() => {
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const bottomNavTop = bottomNav?.getBoundingClientRect().top ?? window.innerHeight;

            return Array.from(document.querySelectorAll('[data-testid^="coach-class-roster-toggle-"]')).filter((button) => {
              const rect = button.getBoundingClientRect();
              const style = getComputedStyle(button);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.top < window.innerHeight &&
                rect.bottom > bottomNavTop
              );
            }).length;
          })(),
          coachClassListToggleBottomNavOverlapCount: (() => {
            const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
            const bottomNavTop = bottomNav?.getBoundingClientRect().top ?? window.innerHeight;

            return Array.from(document.querySelectorAll('[data-testid="coach-class-list-toggle"]')).filter((button) => {
              const rect = button.getBoundingClientRect();
              const style = getComputedStyle(button);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.top < window.innerHeight &&
                rect.bottom > bottomNavTop
              );
            }).length;
          })(),
          coachClassRosterOpenCount: document.querySelectorAll('[data-testid^="coach-class-roster-panel-"][data-coach-class-roster-state="open"]').length,
          coachClassRosterClosedCount: document.querySelectorAll('[data-testid^="coach-class-roster-collapsed-"][data-coach-class-roster-state="closed"]').length,
          coachClassRosterClosedMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid^="coach-class-roster-collapsed-"]')).map((summary) =>
              Math.round(summary.getBoundingClientRect().height),
            ),
          ),
          attendanceHistoryPanelCount: document.querySelectorAll('[data-testid="attendance-history-panel"]').length,
          attendanceHistoryPanelHeight:
            Math.round(document.querySelector('[data-testid="attendance-history-panel"]')?.getBoundingClientRect().height ?? 0),
          attendanceHistoryState:
            document.querySelector('[data-testid="attendance-history-panel"]')?.getAttribute("data-attendance-history-state") ?? "",
          attendanceHistoryToggleHeight:
            Math.round(document.querySelector('[data-testid="attendance-history-toggle"]')?.getBoundingClientRect().height ?? 0),
          attendanceHistoryDetailListCount: document.querySelectorAll('[data-testid="attendance-history-detail-list"]').length,
          attendanceHistoryDetailRowCount: document.querySelectorAll('[data-testid="attendance-history-detail-row"]').length,
          attendanceHistoryText:
            document.querySelector('[data-testid="attendance-history-panel"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          coachClassAttendanceNoteToggleCount: document.querySelectorAll('[data-testid^="attendance-note-toggle-"]').length,
          coachClassAttendanceNoteToggleMinHeight: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid^="attendance-note-toggle-"]'))
              .map((button) => Math.round(button.getBoundingClientRect().height))
              .filter((height) => height > 0),
          ),
          coachClassAttendanceNoteEditorCount: document.querySelectorAll('[data-testid^="attendance-note-editor-"]').length,
          coachClassAttendanceNoteInputVisibleCount: Array.from(document.querySelectorAll('input[data-testid^="attendance-note-"]')).filter((input) => {
            const rect = input.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }).length,
          coachClassInternalPanelCount: document.querySelectorAll('[data-testid^="p3-coach-"]').length,
          coachClassVisibleCodeCount: location.pathname === "/app/classes" ? document.querySelectorAll("main code").length : 0,
          ownerReportTrendGraphCount: document.querySelectorAll('[data-testid="owner-report-trend-graph"]').length,
          ownerReportTrendGraphRowCount: document.querySelectorAll('[data-testid="owner-report-trend-graph-row"]').length,
          ownerReportTrendGraphText:
            document.querySelector('[data-testid="owner-report-trend-graph"]')?.textContent ?? "",
          ownerReportTrendGraphToggleCount: document.querySelectorAll('[data-testid="owner-report-trend-graph-toggle"]').length,
          ownerReportTrendGraphToggleHeight:
            Math.round(document.querySelector('[data-testid="owner-report-trend-graph-toggle"]')?.getBoundingClientRect().height ?? 0),
          ownerReportTrendSummaryGridCount: document.querySelectorAll('[data-testid="owner-report-trend-summary-grid"]').length,
          ownerReportTrendSummaryGridHeight:
            Math.round(document.querySelector('[data-testid="owner-report-trend-summary-grid"]')?.getBoundingClientRect().height ?? 0),
          ownerReportTrendSummaryRowCount: document.querySelectorAll('[data-testid="owner-report-trend-summary-row"]').length,
          ownerReportTrendSummaryRowMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-report-trend-summary-row"]')).map((row) =>
              Math.round(row.getBoundingClientRect().height),
            ),
          ),
          ownerReportTrendSummaryTileMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-report-trend-summary-grid"] > article')).map((tile) =>
              Math.round(tile.getBoundingClientRect().height),
            ),
          ),
          ownerReportGraphBoardHeight:
            Math.round(document.querySelector('[data-testid="owner-report-graph-board"]')?.getBoundingClientRect().height ?? 0),
          ownerReportSecondaryGraphGridCount: document.querySelectorAll('[data-testid="owner-report-secondary-graph-grid"]').length,
          ownerReportSecondaryGraphTileCount: document.querySelectorAll('[data-testid="owner-report-secondary-graph-tile"]').length,
          ownerReportSecondaryGraphGridHeight:
            Math.round(document.querySelector('[data-testid="owner-report-secondary-graph-grid"]')?.getBoundingClientRect().height ?? 0),
          ownerReportSecondaryGraphTileMinWidth: Math.min(
            ...Array.from(document.querySelectorAll('[data-testid="owner-report-secondary-graph-tile"], [data-testid="owner-report-secondary-graph-toggle"]'))
              .map((tile) => Math.round(tile.getBoundingClientRect().width))
              .filter((width) => width > 0),
          ),
          ownerReportSecondaryGraphLabelOverflow: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-report-secondary-graph-label"]')).map(
              (label) => Math.round(label.scrollWidth - label.clientWidth),
            ),
          ),
          ownerReportSecondaryGraphOverflow: Math.max(
            0,
            Math.round(
              (document.querySelector('[data-testid="owner-report-secondary-graph-grid"]')?.scrollWidth ?? 0) -
                (document.querySelector('[data-testid="owner-report-secondary-graph-grid"]')?.clientWidth ?? 0),
            ),
          ),
          ownerReportSecondaryGraphToggleCount: document.querySelectorAll('[data-testid="owner-report-secondary-graph-toggle"]').length,
          ownerReportSecondaryGraphToggleText:
            document.querySelector('[data-testid="owner-report-secondary-graph-toggle"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          ownerReportSecondaryGraphToggleHeight:
            Math.round(document.querySelector('[data-testid="owner-report-secondary-graph-toggle"]')?.getBoundingClientRect().height ?? 0),
          ownerReportBranchGraphCount: document.querySelectorAll('[data-testid="owner-report-branch-graph"]').length,
          ownerReportBranchGraphRowCount: document.querySelectorAll('[data-testid="owner-report-branch-graph-row"]').length,
          ownerReportBranchGraphRowMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-report-branch-graph-row"]')).map((row) =>
              Math.round(row.getBoundingClientRect().height),
            ),
          ),
          ownerReportBranchGraphToggleCount: document.querySelectorAll('[data-testid="owner-report-branch-graph-toggle"]').length,
          ownerReportBranchGraphToggleHeight:
            Math.round(document.querySelector('[data-testid="owner-report-branch-graph-toggle"]')?.getBoundingClientRect().height ?? 0),
          ownerReportBranchGraphMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-report-branch-graph"]')).map((graph) =>
              Math.round(graph.getBoundingClientRect().height),
            ),
          ),
		          ownerReportBranchGraphText:
		            Array.from(document.querySelectorAll('[data-testid="owner-report-branch-graph"]'))
		              .map((graph) => graph.textContent ?? "")
		              .join(" | "),
          ownerActionQueueHeight: Math.round(document.querySelector('[data-testid="owner-action-queue"]')?.getBoundingClientRect().height ?? 0),
          ownerActionQueueItemCount: document.querySelectorAll('[data-testid="owner-action-queue"] li').length,
          ownerActionQueueItemMaxHeight: Math.max(
            0,
            ...Array.from(document.querySelectorAll('[data-testid="owner-action-queue-item"]')).map((item) =>
              Math.round(item.getBoundingClientRect().height),
            ),
          ),
          ownerActionQueueToggleCount: document.querySelectorAll('[data-testid="owner-action-queue-toggle"]').length,
          ownerActionQueueToggleHeight: Math.round(document.querySelector('[data-testid="owner-action-queue-toggle"]')?.getBoundingClientRect().height ?? 0),
	          ownerReportPriorityBranchRowCount: document.querySelectorAll('[data-testid="owner-report-priority-branch-row"]').length,
	          ownerReportPriorityBranchRowMaxHeight: Math.max(
	            0,
	            ...Array.from(document.querySelectorAll('[data-testid="owner-report-priority-branch-row"]')).map((row) =>
	              Math.round(row.getBoundingClientRect().height),
	            ),
	          ),
	          ownerReportPriorityBranchToggleCount: document.querySelectorAll('[data-testid="owner-report-priority-branch-toggle"]').length,
	          ownerReportPriorityBranchToggleHeight:
	            Math.round(document.querySelector('[data-testid="owner-report-priority-branch-toggle"]')?.getBoundingClientRect().height ?? 0),
	          ownerReportRiskPaymentSummaryCount: document.querySelectorAll('[data-testid="owner-report-risk-payment-summary"]').length,
	          ownerReportRiskPaymentSummaryMaxHeight: Math.max(
	            0,
	            ...Array.from(document.querySelectorAll('[data-testid="owner-report-risk-payment-summary"]')).map((summary) =>
	              Math.round(summary.getBoundingClientRect().height),
	            ),
	          ),
	          ownerReportRiskPaymentListCount: document.querySelectorAll('[data-testid="owner-report-risk-payment-list"]').length,
          ownerReportRiskPaymentRowCount: document.querySelectorAll('[data-testid="owner-report-risk-payment-list"] > div').length,
          ownerReportRiskPaymentToggleCount: document.querySelectorAll('[data-testid="owner-report-risk-payment-toggle"]').length,
          ownerReportRiskPaymentToggleHeight:
            Math.round(document.querySelector('[data-testid="owner-report-risk-payment-toggle"]')?.getBoundingClientRect().height ?? 0),
          ownerReportInternalPanelCount:
            location.pathname === "/app/owner/reports"
              ? Array.from(document.querySelectorAll('[data-testid^="p3-"]')).filter((panel) => {
                  const rect = panel.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0 && !panel.hasAttribute("hidden");
                }).length
              : 0,
          ownerReportVisibleCodeCount: location.pathname === "/app/owner/reports" ? document.querySelectorAll("main code").length : 0,
          ownerReportVisibleControlMinHeight: location.pathname === "/app/owner/reports"
            ? Math.min(
                ...Array.from(document.querySelectorAll("main button, main a"))
                  .map((control) => Math.round(control.getBoundingClientRect().height))
                  .filter((height) => height > 0),
              )
            : 0,
	        };
          })),
          ...adminSettingsPolicyLayout,
        };

        await page.screenshot({ path: screenshotPath, fullPage: true, caret: "initial" });
        const screenshotSizeBytes = statSync(screenshotPath).size;

        assert.equal(messages.length, 0, `${testCase.id} must not log console/page errors: ${messages.join(" | ")}`);
        assert.equal(blockedHits.length, 0, `${testCase.id} must not expose dummy/internal copy: ${blockedHits.join(" | ")}`);
        assert.equal(
          blockedPlaceholderHits.length,
          0,
          `${testCase.id} must not expose dummy placeholders: ${blockedPlaceholderHits.join(" | ")}`,
        );
        assert.equal(layout.hasLoadingCopy, false, `${testCase.id} must render service content, not a loading screen`);
        assert.equal(layout.hasAppError, false, `${testCase.id} must not render a runtime error page`);
        assert.equal(layout.scrollWidth, layout.clientWidth, `${testCase.id} must not overflow horizontally`);
        assert(layout.finalWordmarkCount > 0, `${testCase.id} must render the vector FINAL wordmark`);
        assert(layout.finalWordmarkVisualMinHeight >= 28, `${testCase.id} FINAL wordmark must keep a readable visual height`);
        if (testCase.role) {
          assert(layout.finalWordmarkLinkCount > 0, `${testCase.id} must render the FINAL dashboard link`);
          assert(layout.finalWordmarkMinTouchHeight >= 44, `${testCase.id} FINAL wordmark link must keep a 44px touch height`);
        } else {
          assert.equal(layout.finalWordmarkLinkCount, 0, `${testCase.id} public auth wordmark must not pretend to be a dashboard link`);
          assert.equal(layout.finalWordmarkMinTouchHeight, 0, `${testCase.id} public auth wordmark link touch height must be explicit 0`);
        }
        assert.equal(layout.rasterFinalLogoCount, 0, `${testCase.id} must not render the old raster FINAL logo`);
        assert(screenshotSizeBytes > 10_000, `${testCase.id} screenshot must be non-empty, got ${screenshotSizeBytes} bytes`);

        if (testCase.id === "auth-login" || testCase.id === "auth-login-registered") {
          assert.equal(layout.authFormCount, 1, "login must render one credential form");
          assert.equal(layout.authPasswordInputCount, 1, "login must render one password field");
          assert.equal(layout.authPasswordVisibilityToggleCount, 1, "login must render one password visibility toggle");
          assert(layout.authPasswordVisibilityToggleMinHeight >= 44, "login password visibility toggle must keep a 44px touch height");
          assert(layout.authPasswordVisibilityToggleMinWidth >= 44, "login password visibility toggle must keep a 44px touch width");
          assert(layout.authPasswordInputMinPaddingRight >= 48, "login password input must reserve space for the visibility toggle");
          assert.equal(layout.authSignupLinkCount, 1, "login must expose one signup link");
          assert.equal(layout.authSubmitButtonCount, 1, "login must render one primary login action");
        }

        if (testCase.id === "auth-login-registered") {
          assert(
            layout.authRegisteredNoticeText.includes("회원가입이 완료되었습니다. 휴대폰 번호와 비밀번호로 로그인해 주세요."),
            "registered login notice must point phone signup users to their phone number and password",
          );
          assert(!layout.authRegisteredNoticeText.includes("관리자 승인"), "registered login notice must not imply another approval step");
        }

        if (testCase.id === "auth-signup") {
          assert.equal(layout.authFormCount, 1, "signup must render one phone signup form");
          assert.equal(layout.authSignupInvitationInputCount, 0, "signup must not render an invitation link/code input");
          assert.equal(layout.authSignupNameInputCount, 1, "signup must render one name input");
          assert.equal(layout.authSignupPhoneInputCount, 1, "signup must render one phone input");
          assert.equal(layout.authSignupBranchInputCount, 1, "multi-branch signup must render one branch selector");
          assert(layout.authSignupBranchInputMinHeight >= 44, "signup branch selector must keep a 44px touch height");
          assert.equal(layout.authPasswordInputCount, 2, "signup must render password and confirmation fields");
          assert.equal(layout.authPasswordVisibilityToggleCount, 1, "signup must render one password visibility toggle");
          assert(layout.authPasswordVisibilityToggleMinHeight >= 44, "signup password visibility toggle must keep a 44px touch height");
          assert(layout.authPasswordVisibilityToggleMinWidth >= 44, "signup password visibility toggle must keep a 44px touch width");
          assert(layout.authPasswordInputMinPaddingRight >= 48, "signup password input must reserve space for the visibility toggle");
          assert.equal(layout.authRoleShortcutButtonCount, 0, "signup submit text must not be counted as a role shortcut");
          assert.equal(layout.authSubmitButtonCount, 1, "signup must render one primary signup action");
        }

        if (testCase.id === "auth-reset-password") {
          assert.equal(layout.authFormCount, 1, "password reset must render one request form");
          assert.equal(layout.authSubmitButtonCount, 1, "password reset must render one request action");
        }

        if (testCase.id === "auth-invite-accept") {
          assert.equal(layout.authFormCount, 1, "invite accept must render one password setup form");
          assert.equal(layout.authPasswordInputCount, 2, "invite accept must render password and confirmation fields");
          assert.equal(layout.authPasswordVisibilityToggleCount, 1, "invite accept must render one password visibility toggle");
          assert(layout.authPasswordVisibilityToggleMinHeight >= 44, "invite accept password visibility toggle must keep a 44px touch height");
          assert(layout.authPasswordVisibilityToggleMinWidth >= 44, "invite accept password visibility toggle must keep a 44px touch width");
          assert(layout.authPasswordInputMinPaddingRight >= 48, "invite accept password input must reserve space for the visibility toggle");
          assert.equal(layout.authSubmitButtonCount, 1, "invite accept must render one accept action");
        }

        if (testCase.id === "auth-select-role") {
          assert.equal(layout.authFormCount, 0, "select-role must not render credential or invitation forms");
          assert(
            layout.authRoleShortcutButtonCount === 0 || layout.authRoleShortcutButtonCount === 5,
            "select-role must render either the production login guidance or all five development role shortcuts",
          );
          if (layout.authRoleShortcutButtonCount === 5) {
            assert(layout.authRoleShortcutButtonMinHeight >= 44, "select-role role shortcuts must keep a 44px touch height");
            assert.equal(
              layout.authRoleShortcutButtonText,
              "대표 선택|코치 선택|학부모 선택|회원 선택|총괄 어드민 선택",
              "select-role role shortcut labels must stay scoped to role selection buttons",
            );
            assert.equal(layout.authSelectRoleProductionCopyVisible, false, "development select-role must not show production-only login guidance");
          } else {
            assert.equal(layout.authSelectRoleProductionCopyVisible, true, "production select-role must explain phone-number account switching");
          }
          assert(layout.authSelectRoleLoginLinkHeight >= 44, "select-role login link must keep a 44px touch height");
        }

        if (testCase.id === "admin-dashboard") {
          assert(layout.adminDashboardClassesLinkHeight >= 44, "admin dashboard classes shortcut must keep a 44px touch height");
        }

        if (testCase.id.endsWith("-members")) {
          assert.equal(layout.memberProfileEmptyAlertCopyCount, 0, `${testCase.id} must not repeat empty warning copy inside member cards`);
          assert.equal(layout.memberProfileEmptyNoteCopyCount, 0, `${testCase.id} must not repeat empty counseling/feedback copy inside member cards`);
        }

        if (testCase.id === "admin-users") {
          assert.equal(layout.adminUserSummaryGridCount, 1, "admin users must render the compact summary grid");
          assert.equal(layout.adminUserRoleFilterPanelCount, 1, "admin users must render one role filter panel below the summary cards");
          assert.equal(layout.adminUserRoleFilterButtonCount, 4, "admin users must render owner/coach/guardian/member role filter cards");
          assert.equal(layout.adminUserRoleFilterRoles, "owner|coach|guardian|member", "admin users role filter cards must keep the requested role order");
          assert(layout.adminUserRoleFilterButtonMinHeight >= 44, "admin users role filter cards must stay tappable on mobile");
          assert(layout.adminUserMemberCreateLinkHeight >= 44, "admin users member create shortcut must keep a 44px touch height");
          assert.equal(layout.adminUserMemberCreateLinkHref, "/app/members?create=1", "admin users member create shortcut must open the registration form directly");
          assert(layout.adminUserInviteToggleHeight >= 44, "admin users invite toggle must keep a 44px touch height");
          assert(layout.adminUserListRowCount > 0, "admin users must render user list rows");
          assert(layout.adminUserEditToggleCount >= layout.adminUserListRowCount, "admin users must render an edit toggle for each visible user");
          assert.equal(
            layout.adminUserDeleteToggleCount + layout.adminUserProtectedDeleteRowCount,
            layout.adminUserListRowCount,
            "admin users must show delete only on removable accounts and mark protected rows for tests",
          );
          assert(layout.adminUserProtectedDeleteRowCount > 0, "admin users must keep protected account delete rules");
          assert.equal(layout.adminUserProtectedDeleteToggleCount, 0, "admin users must hide protected delete buttons from mobile rows");
          assert.equal(layout.adminUserDisabledDeleteToggleCount, 0, "admin users must not render disabled delete buttons that inflate row height");
          assert(layout.adminUserEnabledDeleteToggleCount > 0, "admin users must keep delete available for removable accounts");
          assert(layout.adminUserDeleteBlockerSummaryCount > 0, "admin users must retain protected delete reasons for non-visual tests");
          assert(!layout.adminUserDeleteBlockerSummaryText.includes("삭제 보호"), "admin users must not use visible-helper protection wording in delete labels");
          assert(layout.adminUserDeleteBlockerSummaryText.includes("현재 로그인 계정"), "admin users must explain self-delete protection");
          // 담당 수업/회원 연결은 삭제를 막지 않고 자동 인계되므로 차단 사유에 나타나면 안 된다.
          assert(!layout.adminUserDeleteBlockerSummaryText.includes("담당 수업 연결"), "linked coach classes must not block deletion (auto handover)");
          assert(!layout.adminUserDeleteBlockerSummaryText.includes("담당 회원 연결"), "linked coach members must not block deletion (auto handover)");
          assert.equal(layout.adminUserMobileScopeSummaryCount, 0, "admin users mobile cards must hide repeated scope helper copy");
          assert.equal(layout.adminUserDeleteBlockerVisibleText, "", "admin users protected delete summary must not render a visible helper chip");
          assert.equal(layout.adminUserDeleteBlockerSummaryMaxHeight, 0, "admin users protected delete helper chip must stay removed from mobile cards");
          assert(layout.adminUserEditToggleMinHeight >= 44, "admin users edit icon toggles must keep a 44px touch height");
          assert(layout.adminUserDeleteToggleMinHeight >= 44, "admin users delete icon toggles must keep a 44px touch height");
          assert(layout.adminUserPasswordResetToggleMinHeight >= 44, "admin users password reset icon toggles must keep a 44px touch height");
          assert(layout.adminUserActionButtonMinWidth >= 44, "admin users action icon buttons must keep a 44px touch width");
          assert(layout.adminUserActionButtonMaxWidth <= 96, "admin users action controls must keep visible labels within a compact mobile width");
          assert(layout.adminUserActionStackMaxWidth <= 96, "admin users action controls must render as a narrow labeled action stack on mobile");
          assert(layout.adminUserActionStackMaxHeight >= 136, "admin users action controls must render edit/delete/reset as three vertical actions");
          assert(layout.adminUserActionStackMaxHeight <= 152, "admin users action controls must keep the vertical action stack compact");
          assert(layout.adminUserProtectedActionStackMaxHeight <= 92, "admin users protected rows must shrink to edit/reset actions only");
          assert(layout.adminUserActionButtonMaxHeight <= 46, "admin users action controls must keep each icon action compact on mobile");
          assert.equal(layout.adminUserEditFormCount, 0, "admin users edit forms must stay collapsed by default");
          assert.equal(layout.adminUserDeleteFormCount, 0, "admin users delete forms must stay collapsed by default");
          assert.equal(layout.adminUserInvitePanelCount, 0, "admin users invite panel must not push the list down before opening");
          assert.equal(layout.adminUserInviteToggleText, "초대", "admin users collapsed invite action must stay compact in the list header");
          assert.equal(layout.adminUserFirstActionOverlapBottomNavCount, 0, "admin users first action stack must not overlap the mobile bottom navigation");
          if (layout.adminUserBottomNavTop > 0) {
            assert(
              layout.adminUserFirstActionStackBottom <= layout.adminUserBottomNavTop - 8,
              "admin users first action stack must keep visual clearance above the mobile bottom navigation",
            );
          }
          assert.equal(layout.adminUserMobileScopeSummaryCount, 0, "admin users must not render repeated mobile scope helper copy");
          assert.equal(layout.inviteFormCount, 0, "admin users invite form must stay collapsed by default");
          assert.equal(layout.inviteToggleCount, 1, "admin users invite toggle must render");
          assert.equal(layout.passwordResetFormCount, 0, "admin users password reset forms must stay collapsed by default");
          assert(layout.passwordResetToggleCount > 0, "admin users password reset toggles must render");
        }

        if (testCase.id === "admin-branches") {
          assert.equal(layout.adminBranchSummaryGridCount, 1, "admin branches must render the compact summary grid");
          assert(layout.adminBranchSummaryGridHeight >= 44, "admin branches summary must keep readable compact card height");
          assert(layout.adminBranchSummaryGridHeight <= 48, "admin branches summary must stay a compact two-thirds card row");
          assert(layout.adminBranchSummaryGridWidth <= 272, "admin branches summary must stay near two-thirds width on mobile");
          assert(layout.adminBranchSummaryText.includes("운영 중"), "admin branches summary must show active branch count");
          assert(!layout.adminBranchSummaryText.includes("운영 현황"), "admin branches summary must not show ambiguous operations wording");
          assert(!/\d+\s*\/\s*\d+/.test(layout.adminBranchActiveSummaryText), "admin branches active summary must not use member/class slash counts");
          assert.equal(layout.adminBranchCreateFormCount, 0, "admin branches create form must stay collapsed by default");
          assert(layout.adminBranchCreatePanelHeight <= 48, "admin branches create panel must stay a compact action bar with a 44px touch target");
          assert(layout.adminBranchCreatePanelWidth <= 272, "admin branches create panel must stay near two-thirds width on mobile");
          assert.equal(layout.adminBranchCreateToggleCount, 1, "admin branches create toggle must render");
          assert(layout.adminBranchCreateToggleHeight >= 44, "admin branches create toggle must keep a 44px touch height");
          assert(layout.adminBranchCardCount > 0, "admin branches must render compact branch cards");
          assert(layout.adminBranchCardMaxHeight <= 260, "admin branches branch cards must stay compact on mobile");
          assert(layout.adminBranchDetailGridCount > 0, "admin branches must render compact detail grids");
          assert(layout.adminBranchDetailGridMaxHeight <= 96, "admin branches detail grids must stay compact on mobile");
          assert.equal(layout.adminBranchActionGridCount, layout.adminBranchCardCount, "admin branches must render one action grid per branch card");
          assert(layout.adminBranchActionGridMaxHeight <= 72, "admin branches action grids must stay in one compact row");
          assert.equal(layout.adminBranchOwnerFormCount, 0, "admin branches owner forms must stay collapsed by default");
          assert(layout.adminBranchOwnerToggleCount > 0, "admin branches owner toggles must render");
          assert(layout.adminBranchOwnerToggleMinHeight >= 44, "admin branches owner toggles must keep a 44px touch height");
          assert.equal(layout.adminBranchSettingsFormCount, 0, "admin branches settings forms must stay collapsed by default");
          assert(layout.adminBranchSettingsToggleCount > 0, "admin branches settings toggles must render");
          assert(layout.adminBranchSettingsToggleMinHeight >= 44, "admin branches settings toggles must keep a 44px touch height");
        }

        if (testCase.id === "admin-audit") {
          assert.equal(layout.adminAuditVisibleReadLogCount, 0, "admin audit logs must hide read-audit noise by default");
          assert(layout.adminAuditRefreshHeight >= 44, "admin audit logs refresh action must keep a 44px touch height");
          assert.equal(layout.adminAuditSummaryBarCount, 1, "admin audit logs must render one compact summary bar");
          assert(layout.adminAuditSummaryBarHeight >= 44, "admin audit logs summary must keep a readable 44px scan height");
          assert(layout.adminAuditSummaryBarHeight <= 56, "admin audit logs summary must stay compact after readability padding");
          assert(layout.adminAuditListRowCount > 0, "admin audit logs must render compact log rows");
          assert(layout.adminAuditListRowCount <= 5, "admin audit logs must limit default mobile log rows before explicit expansion");
          assert(layout.adminAuditListToggleCount <= 1, "admin audit logs must not render duplicate list expansion controls");
          if (layout.adminAuditListToggleCount > 0) {
            assert(layout.adminAuditListToggleHeight >= 44, "admin audit logs list expansion control must keep a 44px touch height");
            assert(layout.adminAuditListToggleText.includes("더 보기"), "admin audit logs collapsed list action must clearly expand more records");
          }
          assert.equal(layout.adminAuditBottomSafeAreaCount, 1, "admin audit logs must render one mobile bottom safe-area spacer");
          assert(layout.adminAuditBottomSafeAreaHeight >= 112, "admin audit logs bottom safe-area spacer must keep the list action above mobile navigation");
          assert(layout.adminAuditListRowMaxHeight <= 88, "admin audit logs mobile rows with change details must stay bounded");
          assert(layout.adminAuditNoDetailRowCount > 0, "admin audit logs must include compact rows without change details");
          assert(layout.adminAuditNoDetailRowMaxHeight <= 88, "admin audit logs rows without payload details must stay compact");
          assert.equal(layout.adminAuditChangeDetailCount, 0, "admin audit logs must keep raw change payload collapsed by default");
          assert(layout.adminAuditChangeDetailToggleCount > 0, "admin audit logs must render change payload toggles for rows with changes");
          assert(layout.adminAuditChangeDetailToggleMinHeight >= 44, "admin audit logs change payload toggles must keep a 44px touch height");
          assert.equal(layout.adminAuditBranchMetaVisibleCount, 0, "admin audit logs must hide repeated branch/common meta on mobile rows");
          assert.equal(layout.adminAuditTargetMetaVisibleCount, 0, "admin audit logs must hide repeated target type meta on mobile rows");
          assert(layout.adminAuditMobileResultBadgeCount >= layout.adminAuditListRowCount, "admin audit logs must keep visible result badges in compact rows");
          assert.equal(layout.adminAuditFilterPanelCount, 1, "admin audit logs must render one compact filter panel");
          assert.equal(layout.adminAuditFilterToggleCount, 1, "admin audit logs must render one filter toggle");
          assert(layout.adminAuditFilterToggleHeight >= 44, "admin audit logs filter toggle must keep a 44px touch height");
          assert.equal(layout.adminAuditFilterFieldsVisibleCount, 0, "admin audit logs filter fields must stay collapsed by default");
          assert.equal(layout.adminAuditActiveFilterSummaryCount, 1, "admin audit logs must show applied filter summary while collapsed");
          assert(layout.adminAuditActiveFilterChipCount >= 4, "admin audit logs applied filter summary must show compact condition chips");
        }

        if (testCase.id === "admin-settings") {
          assert.equal(adminSettingsViewEvidence?.beforeSwitch.policySelected, "true", "admin settings must open on the policy tab");
          assert.equal(adminSettingsViewEvidence?.beforeSwitch.operationsSelected, "false", "admin settings operations tab must start inactive");
          assert.equal(adminSettingsViewEvidence?.beforeSwitch.policyViewCount, 1, "admin settings must render the policy view by default");
          assert.equal(adminSettingsViewEvidence?.beforeSwitch.operationsViewCount, 0, "admin settings must not render both tab panels at once");
          assert.equal(adminSettingsViewEvidence?.afterSwitch.policySelected, "false", "admin settings policy tab must deactivate after switching");
          assert.equal(adminSettingsViewEvidence?.afterSwitch.operationsSelected, "true", "admin settings operations tab must activate after switching");
          assert.equal(adminSettingsViewEvidence?.afterSwitch.policyViewCount, 0, "admin settings policy panel must leave the active view after switching");
          assert.equal(adminSettingsViewEvidence?.afterSwitch.operationsViewCount, 1, "admin settings must render the operations view after switching");
          assert(
            (adminSettingsViewEvidence?.policyScreenshotSizeBytes ?? 0) > 10_000,
            "admin settings policy screenshot must be non-empty",
          );
          assert.equal(layout.adminSettingsSummaryBarCount, 1, "admin settings must render one compact summary bar");
          assert(layout.adminSettingsSummaryBarHeight >= 44, "admin settings summary must keep a readable 44px scan height");
          assert(layout.adminSettingsSummaryBarHeight <= 56, "admin settings summary must stay compact after readability padding");
          assert.equal(layout.adminSettingsReadinessEditorToggleCount, 1, "admin settings must render one readiness edit toggle");
          assert(layout.adminSettingsReadinessEditorToggleHeight >= 44, "admin settings readiness edit toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsReadinessListToggleCount, 1, "admin settings must render one readiness detail toggle");
          assert(layout.adminSettingsReadinessListToggleHeight >= 44, "admin settings readiness detail toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsReadinessListCount, 0, "admin settings readiness detail list must stay collapsed by default");
          assert.equal(layout.adminSettingsReadinessItemCount, 0, "admin settings readiness items must not lengthen the mobile page by default");
          assert.equal(layout.adminSettingsVisibleCodeCount, 0, "admin settings must not expose command/path code blocks in the app UI");
          assert.equal(layout.adminSettingsVisibleInternalPanelCount, 0, "admin settings must not expose internal P1-P4/release panels in the app UI");
          assert.equal(layout.adminSettingsReadinessEditorFormCount, 0, "admin settings readiness edit forms must stay collapsed by default");
          assert.equal(layout.adminSettingsReadinessSummaryCount, 1, "admin settings must show one compact readiness summary while detail is collapsed");
          assert.equal(layout.adminSettingsRolePolicySummaryCount, 1, "admin settings must show one compact role policy summary");
          assert(layout.adminSettingsRolePolicySummaryHeight <= 56, "admin settings role policy summary must stay compact on mobile");
          assert.equal(layout.adminSettingsRolePolicyDetailCount, 0, "admin settings role policy detail must stay collapsed by default");
          assert.equal(layout.adminSettingsRolePolicyToggleCount, 1, "admin settings role policy toggle must render");
          assert(layout.adminSettingsRolePolicyToggleHeight >= 44, "admin settings role policy toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsBranchPolicySummaryCount, 1, "admin settings must show one compact branch policy summary");
          assert(layout.adminSettingsBranchPolicySummaryHeight <= 56, "admin settings branch policy summary must stay compact on mobile");
          assert.equal(layout.adminSettingsBranchPolicyDetailCount, 0, "admin settings branch policy detail must stay collapsed by default");
          assert.equal(layout.adminSettingsBranchPolicyToggleCount, 1, "admin settings branch policy toggle must render");
          assert(layout.adminSettingsBranchPolicyToggleHeight >= 44, "admin settings branch policy toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsAuditPolicySummaryCount, 1, "admin settings must show one compact audit policy summary");
          assert(layout.adminSettingsAuditPolicySummaryHeight <= 56, "admin settings audit policy summary must stay compact on mobile");
          assert.equal(layout.adminSettingsAuditPolicyDetailCount, 0, "admin settings audit policy detail must stay collapsed by default");
          assert.equal(layout.adminSettingsAuditPolicyToggleCount, 1, "admin settings audit policy toggle must render");
          assert(layout.adminSettingsAuditPolicyToggleHeight >= 44, "admin settings audit policy toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsServicePolicySummaryCount, 1, "admin settings must render one compact service policy summary");
          assert(layout.adminSettingsServicePolicySummaryHeight <= 72, "admin settings service policy summary must stay compact on mobile");
          assert.equal(layout.adminSettingsServicePolicySummaryTileCount, 4, "admin settings service policy summary must stay compact at four tiles");
          assert.equal(layout.adminSettingsOperatorSummaryCount, 1, "admin settings must render one compact operator summary");
          assert.equal(layout.adminSettingsOperatorSummaryTileCount, 4, "admin settings operator summary must stay at four compact tiles");
          assert.equal(layout.adminSettingsOperatorDetailToggleCount, 1, "admin settings must render one operator detail toggle");
          assert(layout.adminSettingsOperatorDetailToggleHeight >= 44, "admin settings operator detail toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsOperatorDetailCount, 0, "admin settings operator detail must stay collapsed by default");
          assert.equal(layout.adminSettingsOperationHeaderSummaryCount, 1, "admin settings must show one compact operation header summary");
          assert.equal(layout.adminSettingsOperationCompactSummaryCount, 1, "admin settings must render one compact operation summary");
          assert.equal(layout.adminSettingsOperationCompactTileCount, 0, "admin settings operation summary must not return to dense metric cards");
          assert.equal(layout.adminSettingsOperationDetailToggleCount, 1, "admin settings must render one operation detail toggle");
          assert(layout.adminSettingsOperationDetailToggleHeight >= 44, "admin settings operation detail toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsOperationDetailCount, 0, "admin settings operation detail must stay collapsed by default");
          assert.equal(layout.adminSettingsOperationRecordListCount, 0, "admin settings operation records must stay collapsed by default");
          assert.equal(layout.adminSettingsOperationLogToggleCount, 1, "admin settings must render one operation log toggle");
          assert(layout.adminSettingsOperationLogToggleHeight >= 44, "admin settings operation log toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsOperationLogFormCount, 0, "admin settings operation log form must stay collapsed by default");
          assert.equal(layout.adminSettingsOperationLogSummaryCount, 1, "admin settings must show one operation log summary");
          assert(layout.adminSettingsOperationLogSummaryHeight >= 44, "admin settings operation log summary must keep a stable 44px rail");
          assert(layout.adminSettingsOperationLogSummaryHeight <= 52, "admin settings operation log summary must stay one compact row");
          assert(
            !layout.adminSettingsOperationLogSummaryText.includes("입력이 필요할 때만"),
            "admin settings operation log summary must not render long helper copy",
          );
          assert.equal(layout.adminSettingsIncidentCreateToggleCount, 1, "admin settings must render one incident create toggle");
          assert(layout.adminSettingsIncidentCreateToggleHeight >= 44, "admin settings incident create toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsIncidentCreateFormCount, 0, "admin settings incident create form must stay collapsed by default");
          assert.equal(layout.adminSettingsIncidentCreateSummaryCount, 1, "admin settings must show one incident summary");
          assert(layout.adminSettingsIncidentCreateSummaryHeight >= 44, "admin settings incident create summary must keep a stable 44px rail");
          assert(layout.adminSettingsIncidentCreateSummaryHeight <= 52, "admin settings incident create summary must stay one compact row");
          assert(
            !layout.adminSettingsIncidentCreateSummaryText.includes("새 현장 이슈가 생겼을 때만"),
            "admin settings incident create summary must not render long helper copy",
          );
          assert.equal(layout.adminSettingsIncidentHeaderSummaryCount, 1, "admin settings must show one compact incident header summary");
          assert.equal(layout.adminSettingsIncidentListToggleCount, 1, "admin settings must render one incident list toggle");
          assert(layout.adminSettingsIncidentListToggleHeight >= 44, "admin settings incident list toggle must keep a 44px touch height");
          assert.equal(layout.adminSettingsIncidentListSummaryCount, 1, "admin settings must show one compact incident list summary");
          if (layout.adminSettingsIncidentEditorToggleCount > 0) {
            assert(layout.adminSettingsIncidentEditorToggleMinHeight >= 44, "admin settings incident status edit toggles must keep a 44px touch height");
          }
          assert.equal(layout.adminSettingsIncidentEditorFormCount, 0, "admin settings incident edit forms must stay collapsed by default");
        }

        if (testCase.id === "admin-roles") {
          assert.equal(layout.adminRoleSummaryGridCount, 1, "admin roles must render the compact summary grid");
          assert(layout.adminRoleSummaryGridHeight >= 44, "admin roles summary must keep a readable 44px scan height");
          assert(layout.adminRoleSummaryGridHeight <= 56, "admin roles summary must stay compact after readability padding");
          assert.equal(layout.adminRoleInvitePanelCount, 1, "admin roles must render one compact invite action panel");
          assert(layout.adminRoleInvitePanelHeight <= 56, "admin roles invite panel must stay compact when collapsed");
          assert(layout.adminRoleInvitePanelWidth <= 276, "admin roles invite panel must stay near two-thirds width on mobile");
          assert(layout.adminRoleInvitePanelText.includes("열기"), "admin roles invite panel must expose a short open action");
          assert.equal(layout.adminRoleInviteFormCount, 0, "admin roles invite form must stay collapsed by default");
          assert.equal(layout.adminRoleInviteToggleCount, 1, "admin roles invite toggle must render");
          assert(layout.adminRoleInviteToggleHeight >= 44, "admin roles invite toggle must keep a 44px touch height");
          assert(layout.adminRoleUserRowCount > 0, "admin roles must render compact user rows");
          assert.equal(layout.adminRoleActionRowCount, layout.adminRoleUserRowCount, "admin roles must render one compact action row per visible user");
          assert(layout.adminRoleActionRowMaxWidth <= 140, "admin roles mobile action row must stay compact");
          assert.equal(layout.adminRoleManagementScopeVisibleCount, 0, "admin roles management scope copy must stay hidden on mobile rows");
          assert.equal(layout.adminRoleBranchScopeVisibleCount, 0, "admin roles branch scope copy must stay hidden on mobile rows");
          assert.equal(layout.adminRoleEditFormCount, 0, "admin roles per-user edit forms must stay collapsed by default");
          assert(layout.adminRoleEditToggleCount > 0, "admin roles per-user edit toggles must render");
          assert(layout.adminRoleEditToggleMinHeight >= 44, "admin roles per-user edit toggles must keep a 44px touch height");
          assert.equal(layout.adminRolePermissionSummaryCount, 1, "admin roles must show one compact permission summary");
          assert.equal(layout.adminRolePermissionSummaryRowCount, 3, "admin roles permission summary must show allowed/restricted/denied rows");
          assert.equal(layout.adminRolePermissionDetailToggleCount, 1, "admin roles must expose one mobile permission detail toggle");
          assert(layout.adminRolePermissionDetailToggleHeight >= 44, "admin roles permission detail toggle must keep a 44px touch height");
          assert.equal(layout.adminRolePermissionDetailVisibleCount, 0, "admin roles permission detail matrix must stay collapsed on mobile by default");
          assert.equal(layout.adminRoleProtectionSummaryCount, 0, "admin roles must not render account-protection helper cards by default");
          assert.equal(layout.adminRoleProtectionStatusCount, 0, "admin roles must not render account-protection status chips by default");
          assert.equal(layout.adminRoleProtectionCancelCount, 0, "admin roles must not render account-protection cancel cards by default");
          assert.equal(layout.adminRoleProtectionLongCopyPresent, false, "admin roles account protection must not render long explanatory copy on mobile");
          assert.equal(
            layout.adminRoleRecentChangeListCount + layout.adminRoleRecentChangeEmptyCount,
            1,
            "admin roles must show exactly one recent account-change list or empty state",
          );
          if (layout.adminRoleRecentChangeListCount === 1) {
            assert(layout.adminRoleRecentChangeRowCount > 0, "admin roles recent account-change list must contain rows");
            assert(layout.adminRoleRecentChangeRowCount <= 1, "admin roles recent account-change list must show only the latest row by default");
            assert(layout.adminRoleRecentChangeSectionHeight <= 120, "admin roles recent account-change section must stay compact on mobile");
            assert.equal(layout.adminRoleRecentChangeToggleCount, 1, "admin roles recent account-change list must expose one expansion control");
            assert(layout.adminRoleRecentChangeToggleHeight >= 44, "admin roles recent account-change toggle must keep a 44px touch height");
          }
          assert.equal(layout.adminRoleRecentReadLogCount, 0, "admin roles recent changes must hide change-record read noise");
          assert(
            !layout.adminRoleRecentChangeText.includes("변경 기록을 조회했습니다."),
            "admin roles recent changes must not repeat change-record read messages",
          );
        }

        if (testCase.id.endsWith("-account")) {
          assert.equal(layout.accountSummaryCardCount, 1, `${testCase.id} must render one compact account summary card`);
          assert.equal(layout.accountSummaryGridCount, 1, `${testCase.id} must render one compact account summary grid`);
          assert.equal(layout.accountStatusCardCount, 0, `${testCase.id} must not show a redundant active account status card`);
          assert.equal(layout.accountActiveStatusLabelCount, 0, `${testCase.id} must not repeat the active status label`);
          assert.equal(layout.accountActionPanelCount, 1, `${testCase.id} must keep account actions on the account screen`);
          assert.equal(layout.accountRoleSwitchLinkCount, 1, `${testCase.id} must keep one role switch action`);
          assert.equal(layout.accountLogoutButtonCount, 1, `${testCase.id} must keep one logout action`);
          assert.equal(layout.mobileHeaderLogoutButtonCount, 0, `${testCase.id} must avoid duplicate header logout on the account screen`);
          assert(layout.accountRoleSwitchLinkHeight >= 44, `${testCase.id} role switch action must keep a 44px touch height`);
          assert(layout.accountLogoutButtonHeight >= 44, `${testCase.id} logout action must keep a 44px touch height`);
          if (testCase.role === "admin" || testCase.role === "owner") {
            assert.equal(layout.accountBranchListHeadingCount, 1, `${testCase.id} must expose its multi-branch scope below the summary`);
          } else {
            assert.equal(layout.accountBranchListHeadingCount, 0, `${testCase.id} must not repeat a single branch list below the summary`);
          }
          assert.equal(layout.mobileBottomNavActiveRouteIds, "", `${testCase.id} must not mislabel family info as the current account destination`);
          assert.equal(layout.mobileBottomNavCurrentRouteIds, "", `${testCase.id} must keep account location in the account menu instead of bottom navigation`);
        }

        if (testCase.role) {
          assert.equal(layout.appHeaderNoticeLinkCount, 1, `${testCase.id} must expose one header notice action`);
          assert(layout.appHeaderNoticeLinkHeight >= 44, `${testCase.id} header notice action must keep a 44px touch height`);
        }

        if (testCase.role) {
          assert.equal(layout.mobileAccountMenuToggleCount, 1, `${testCase.id} must show one compact mobile account menu action`);
          assert(layout.mobileAccountMenuToggleHeight >= 44, `${testCase.id} mobile account menu action must keep 44px touch height`);
          if (layout.mobileBranchScopeCount > 0) {
            assert.equal(layout.mobileBranchScopeCount, 1, `${testCase.id} must show at most one mobile branch scope row`);
            assert(layout.mobileBranchScopeHeight <= 32, `${testCase.id} mobile branch scope row must stay compact`);
            assert(layout.mobileHeaderHeight <= 128, `${testCase.id} multi-branch mobile header must stay compact with its scope row`);
          } else {
            assert(layout.mobileHeaderHeight <= 96, `${testCase.id} single-branch mobile header must stay compact`);
          }
          assert.equal(layout.mobileHeaderLogoutButtonCount, 0, `${testCase.id} must keep logout inside the account menu or account screen`);
        }

        if (testCase.role === "member" || testCase.role === "guardian") {
          const expectedFamilyBottomNavRouteIds = "dashboard|classes|members|payments|tournaments";
          const expectedFamilyBottomNavLabels =
            testCase.role === "guardian"
              ? "홈|수업|가족|결제|대회"
              : "홈|수업|내 정보|결제|대회";
          assert.equal(layout.mobileAccountMenuToggleCount, 1, `${testCase.id} must expose the same account-menu pattern used by other roles`);
          assert.equal(layout.mobileHeaderLogoutButtonCount, 0, `${testCase.id} must not duplicate logout outside the account menu`);
          assert.equal(layout.mobileBottomNavLinkCount, 5, `${testCase.id} must show the five family bottom-nav actions`);
          assert.equal(layout.mobileBottomNavScrollerDisplay, "grid", `${testCase.id} family bottom navigation must render as a fixed grid`);
          assert.equal(layout.mobileBottomNavGridColumnCount, 5, `${testCase.id} family bottom navigation must allocate one grid column per action`);
          assert.equal(
            layout.mobileBottomNavRouteIds,
            expectedFamilyBottomNavRouteIds,
            `${testCase.id} family bottom navigation must remove deleted request actions and the duplicated notice inbox`,
          );
          assert.equal(
            layout.mobileBottomNavLabels,
            expectedFamilyBottomNavLabels,
            `${testCase.id} family bottom navigation labels must keep unread badges out of visible menu text`,
          );
          assert.equal(
            layout.mobileBottomNavNoticeBadgeCount,
            0,
            `${testCase.id} bottom navigation must not duplicate the header notification inbox`,
          );
          assert(layout.mobileBottomNavLinkMinWidth >= 56, `${testCase.id} bottom-nav actions must keep at least a 56px tap width`);
          assert(
            layout.mobileBottomNavScrollerScrollWidth <= layout.mobileBottomNavScrollerClientWidth,
            `${testCase.id} family bottom navigation must fit without horizontal scrolling`,
          );
        }

        if (testCase.role === "admin") {
          const expectedAdminBottomNavRouteIds = "dashboard|adminBranches|adminUsers|notices|adminSettings";
          const expectedAdminBottomNavLabels = "대시보드|지점|사용자|공지|설정";

          assert.equal(layout.mobileBottomNavLinkCount, 5, `${testCase.id} admin bottom navigation must stay focused on five primary management actions`);
          assert.equal(layout.mobileBottomNavScrollerDisplay, "grid", `${testCase.id} admin bottom navigation must render as a fixed grid`);
          assert.equal(layout.mobileBottomNavGridColumnCount, 5, `${testCase.id} admin bottom navigation must allocate one grid column per action`);
          assert.equal(layout.mobileBottomNavRouteIds, expectedAdminBottomNavRouteIds, `${testCase.id} admin bottom navigation must keep stable management destinations`);
          assert.equal(layout.mobileBottomNavLabels, expectedAdminBottomNavLabels, `${testCase.id} admin bottom navigation labels must match the rendered route set`);
          assert(layout.mobileBottomNavLinkMinWidth >= 56, `${testCase.id} admin bottom-nav actions must keep at least a 56px tap width`);
          assert(
            layout.mobileBottomNavScrollerScrollWidth <= layout.mobileBottomNavScrollerClientWidth + 1,
            `${testCase.id} admin bottom navigation must fit without horizontal scrolling`,
          );
        }

        if (testCase.role === "coach") {
          assert.equal(layout.mobileBottomNavLinkCount, 5, `${testCase.id} coach bottom navigation must show five actions including promotions and notices`);
          assert.equal(layout.mobileBottomNavScrollerDisplay, "grid", `${testCase.id} coach bottom navigation must render as a fixed grid`);
          assert.equal(layout.mobileBottomNavGridColumnCount, 5, `${testCase.id} coach bottom navigation must allocate one grid column per action`);
          assert.equal(
            layout.mobileBottomNavRouteIds,
            "dashboard|classes|members|promotions|notices",
            `${testCase.id} coach bottom navigation must remove deleted request actions`,
          );
          assert.equal(
            layout.mobileBottomNavLabels,
            "홈|수업/출석|회원|승급 심사|공지",
            `${testCase.id} coach bottom navigation labels must keep unread badges out of visible menu text`,
          );
          assert.equal(
            layout.mobileBottomNavNoticeBadgeUnreadCount,
            layout.appHeaderNoticeBadgeUnreadCount,
            `${testCase.id} bottom notice badge must mirror only the header unread notice count`,
          );
          assert.equal(
            layout.mobileBottomNavNoticeBadgeCount,
            layout.appHeaderNoticeBadgeUnreadCount > 0 ? 1 : 0,
            `${testCase.id} bottom notice badge visibility must depend only on unread notices`,
          );
          if (layout.mobileBottomNavNoticeBadgeCount > 0) {
            assert(
              layout.mobileBottomNavNoticeAriaLabel.includes("공지, 미확인 공지"),
              `${testCase.id} bottom notice badge must expose a notice-only aria label`,
            );
            assert.equal(
              layout.mobileBottomNavNoticeBadgeContained,
              true,
              `${testCase.id} bottom notice badge must stay inside the bottom-nav notice action`,
            );
            assert.equal(
              layout.mobileBottomNavNoticeBadgePointerEvents,
              "none",
              `${testCase.id} bottom notice badge must not intercept bottom-nav taps`,
            );
          }
          assert(layout.mobileBottomNavLinkMinWidth >= 56, `${testCase.id} coach bottom-nav actions must keep at least a 56px tap width`);
          assert(
            layout.mobileBottomNavScrollerScrollWidth <= layout.mobileBottomNavScrollerClientWidth,
            `${testCase.id} coach bottom navigation must fit without horizontal scrolling`,
          );
        }

        if (testCase.role === "owner") {
          assert.equal(layout.mobileBottomNavLinkCount, 5, `${testCase.id} owner bottom navigation must keep five primary operation actions`);
          assert(layout.mobileBottomNavLinkMinWidth >= 56, `${testCase.id} owner bottom-nav actions must keep at least a 56px tap width`);
          assert(
            layout.mobileBottomNavScrollerScrollWidth <= layout.mobileBottomNavScrollerClientWidth + 1,
            `${testCase.id} owner bottom navigation must fit without horizontal scrolling`,
          );
        }

        if (/^(member|guardian)-(classes|members|payments|notices|notifications)$/.test(testCase.id)) {
          const expectedScreenHeaderCount = testCase.id.endsWith("-notices") ? 1 : 0;
          assert.equal(layout.familyRepeatedScreenHeaderCount, expectedScreenHeaderCount, `${testCase.id} must keep only the page title needed for orientation`);
        }

        if (testCase.id === "member-members" || testCase.id === "guardian-members") {
          assert.equal(layout.familyMemberSearchInputCount, 0, `${testCase.id} must not render the staff search header`);
          assert(layout.familyMemberProfileCardCount > 0, `${testCase.id} must render compact profile cards without the repeated header`);
          assert(layout.memberEmergencyContactCallCount > 0, `${testCase.id} must render a tappable emergency contact call target`);
          assert(layout.memberEmergencyContactCallMinHeight >= 44, `${testCase.id} emergency contact call target must keep 44px touch height`);
          assert(layout.memberEmergencyContactCallMinWidth >= 112, `${testCase.id} emergency contact call target must keep a stable phone-width target`);
          assert(layout.familyMemberFeedbackHeadingCount > 0, `${testCase.id} must label visible notes as coach feedback`);
          assert.equal(layout.familyMemberFeedbackVisibilityMetaCount, 0, `${testCase.id} must not expose staff note visibility metadata`);
	          assert.equal(layout.familyMemberWarningHeadingCount, 0, `${testCase.id} must not render a full warning section in the family app`);
	          assert.equal(layout.familyMemberEmptyAlertCopyCount, 0, `${testCase.id} must hide empty warning copy from the family app`);
	          if (layout.familyMemberAlertStripCount > 0) {
	            assert(
	              layout.familyMemberAlertStripMaxHeight >= 44,
	              `${testCase.id} family alert strip must keep a stable 44px scan height when safety notes exist`,
	            );
	            assert(
	              layout.familyMemberAlertStripMaxHeight <= 72,
	              `${testCase.id} family alert strip must stay compact when safety notes exist`,
	            );
	          }
        }

        if (testCase.id === "guardian-members") {
          assert(layout.familyMemberFeedbackCardCount > 0, "guardian members must keep guardian-visible coach feedback");
        }

        if (testCase.id === "coach-members") {
          assert(layout.memberStatusFilterCount > 0, "coach members must render visible member status filters");
          assert(layout.memberStatusFilterMinHeight >= 44, "coach members status filters must keep 44px touch height");
          assert(layout.memberNoteEditorToggleCount > 0, "coach members must render note editor toggles");
          assert(layout.memberNoteEditorToggleMinHeight >= 44, "coach members note editor toggles must keep 44px touch height");
          assert.equal(layout.memberNoteEditorToggleBottomNavOverlapCount, 0, "coach members note editor toggles must not overlap the mobile bottom navigation");
          assert.equal(layout.memberNoteEditorCount, 0, "coach members must keep note editors collapsed by default");
          assert(layout.coachMemberProfileCardCount > 1, "coach members must render the assigned member cards");
          assert(layout.coachVisibleMemberProfileCardCount <= 1, "coach members must keep the mobile default list short enough to avoid bottom navigation overlap");
          assert(layout.memberEmergencyContactCallCount > 0, "coach members must render tappable emergency contact call targets");
          assert(layout.memberEmergencyContactCallMinHeight >= 44, "coach members emergency contact call targets must keep 44px touch height");
          assert(layout.memberEmergencyContactCallMinWidth >= 112, "coach members emergency contact call targets must keep a stable phone-width target");
          assert(layout.coachMemberNoticeActionMinHeight >= 44, "coach members personal notice action must keep 44px touch height");
          assert.equal(layout.coachMemberListToggleCount, 1, "coach members must expose a mobile assigned-member expansion control");
          assert(layout.coachMemberListToggleMinHeight >= 44, "coach members assigned-member expansion control must keep a 44px touch height");
          assert(layout.coachMemberListToggleText.includes("담당 회원"), "coach members assigned-member expansion control must use clear member-list copy");
          assert.equal(layout.coachMemberListToggleBottomNavOverlapCount, 0, "coach members assigned-member expansion control must not overlap the mobile bottom navigation");
          assert.equal(layout.coachMemberBottomSafeAreaCount, 1, "coach members must keep one bottom safe-area spacer after the assigned-member expansion control");
          assert(layout.coachMemberBottomSafeAreaMinHeight >= 112, "coach members bottom safe-area spacer must keep the expansion control above mobile navigation");
          assert(layout.coachMemberNoteSectionCount > 0, "coach members must render counseling note sections");
          assert(layout.coachMemberNoteClosedSectionCount > 0, "coach members must keep counseling note sections closed by default");
          assert.equal(layout.coachMemberNoteOpenSectionCount, 0, "coach members must not open counseling note sections by default");
          assert(layout.coachMemberNoteSummaryCount > 0, "coach members must show compact counseling note summaries");
          assert.equal(layout.coachMemberNoteCardCount, 0, "coach members must hide counseling note detail cards by default");
          assert.equal(layout.coachMemberNoteListMaxItems, 0, "coach members must not render detail note list items by default");
          assert(layout.coachMemberNoteListToggleCount > 0, "coach members with notes must render a note view toggle");
          assert(layout.coachMemberNoteListToggleMinHeight >= 44, "coach members note more toggles must keep 44px touch height");
          assert.equal(layout.coachMemberEmptyAlertCopyCount, 0, "coach members must hide repeated empty warning copy");
          assert.equal(layout.coachMemberEmptyNoteCopyCount, 0, "coach members must hide repeated empty counseling copy");
        }

        if (testCase.id === "member-notices" || testCase.id === "guardian-notices") {
          assert.equal(layout.noticesScreenCount, 1, `${testCase.id} must render the dedicated notices screen`);
          assert.equal(layout.requestsScreenCount, 0, `${testCase.id} must not render the requests screen inside notices`);
          assert.equal(layout.mobileBottomNavActiveRouteIds, "", `${testCase.id} must not replace a stable family destination with notices`);
          assert.equal(layout.mobileBottomNavCurrentRouteIds, "", `${testCase.id} must keep the header as the notification entry point`);
          assert.equal(layout.mobileBottomNavNoticeLabel, "", `${testCase.id} must not duplicate notices in the family bottom navigation`);
          assert.equal(layout.mobileBottomNavNoticeHref, "", `${testCase.id} must not duplicate the header notice link`);
          assert(
            layout.familyNoticeReadActionCount === 0 || layout.familyNoticeReadActionMinHeight >= 44,
            `${testCase.id} family notice read actions must keep 44px touch height when unread notices exist`,
          );
          assert.equal(layout.familyNoticeCompactFilterBarCount, 1, `${testCase.id} must render one compact family notice filter bar`);
          assert(layout.familyNoticeCompactFilterBarHeight <= 72, `${testCase.id} family notice filter toolbar must stay compact`);
          assert.equal(layout.familyNoticeFilterGridColumnCount, 4, `${testCase.id} family notice toolbar must use four stable columns`);
          assert(layout.familyNoticeFilterButtonMinHeight >= 44, `${testCase.id} family notice toolbar controls must keep 44px touch height`);
          assert.equal(layout.familyNoticeFilterOverflow, 0, `${testCase.id} family notice filter toolbar must not overflow horizontally`);
          assert.equal(layout.familyNoticeStatusBadgeCount, 0, `${testCase.id} must not repeat the filter counts in a separate status badge`);
          assert(layout.familyNoticeCardCount > 0, `${testCase.id} must render compact family notice cards`);
          assert(
            layout.familyNoticeCardMaxHeight <= 152,
            `${testCase.id} family notice cards must stay scan-friendly while preserving guardian target context and 44px actions`,
          );
          assert(layout.familyNoticeBodyMaxHeight <= 44, `${testCase.id} family notice bodies must stay within a compact tappable preview`);
          if (layout.familyNoticeDetailToggleCount > 0) {
            assert(layout.familyNoticeDetailToggleMinHeight >= 44, `${testCase.id} detail toggles must keep a 44px touch target`);
          }
          if (testCase.id === "guardian-notices") {
            assert(layout.familyNoticeDetailToggleCount > 0, `${testCase.id} must keep long notice bodies expandable through the content area`);
          }
          assert.equal(layout.familyNoticeDateLineCount, layout.familyNoticeCardCount, `${testCase.id} family notice cards must keep one compact date/action row`);
          assert.equal(layout.noticeReadStateBadgeCount, 0, `${testCase.id} must not repeat read-state badges inside family notice cards`);
          assert.equal(layout.familyNoticeInboxHeadingCount, 0, `${testCase.id} must not repeat the notice inbox heading`);
          assert.equal(layout.notificationPermissionPanelHeight, 0, `${testCase.id} must remove the notification settings card`);
          assert.equal(layout.notificationPermissionActionText, "", `${testCase.id} must not show notification settings actions`);
          assert.equal(layout.legacyNoticeConfirmButtonCount, 0, `${testCase.id} must not render full-width legacy confirm buttons`);
          assert.equal(layout.noticeExpandedButtonCount, 0, `${testCase.id} must not show expanded notice bodies by default`);
        }

        if (testCase.id === "member-notifications" || testCase.id === "guardian-notifications") {
          assert.equal(layout.notificationsScreenCount, 1, `${testCase.id} must render the dedicated notification inbox`);
          assert.equal(layout.noticesScreenCount, 0, `${testCase.id} must not render the notices screen alias`);
          assert.equal(layout.requestsScreenCount, 0, `${testCase.id} must not render the requests screen`);
          assert.equal(layout.mobileBottomNavActiveRouteIds, "", `${testCase.id} must keep family bottom-nav destinations stable`);
          assert.equal(layout.mobileBottomNavCurrentRouteIds, "", `${testCase.id} must keep the header as the notification entry point`);
          assert.equal(layout.mobileBottomNavNoticeLabel, "", `${testCase.id} must not duplicate the notification inbox`);
          assert.equal(layout.mobileBottomNavNoticeHref, "", `${testCase.id} must not duplicate the header notification link`);
          assert.equal(layout.notificationSummaryCardCount, 0, `${testCase.id} must not render duplicate summary cards`);
          assert.equal(layout.notificationSummaryGridCount, 0, `${testCase.id} must not render a duplicate summary grid`);
          assert.equal(layout.notificationDuplicateSummaryTextCount, 0, `${testCase.id} must not render duplicate summary helper text`);
          assert(layout.notificationInboxCardCount > 0, `${testCase.id} must render notification cards`);
          assert(layout.notificationInboxCardMaxHeight <= 132, `${testCase.id} notification rows must stay compact enough for mobile scanning`);
          assert.equal(layout.notificationBottomSafeAreaCount, 0, `${testCase.id} must rely on the shared shell bottom safe area`);
          assert(
            layout.notificationBottomActionClearanceAtScrollEnd >= 24,
            `${testCase.id} bottom notification action must clear the mobile bottom navigation at scroll end`,
          );
          assert(
            layout.notificationBottomCardClearanceAtScrollEnd >= 24,
            `${testCase.id} bottom notification card must leave breathing room above the mobile bottom navigation`,
          );
          assert.equal(layout.notificationNoticeKindBadgeCount, 0, `${testCase.id} must hide repeated notice kind badges inside notification rows`);
          if (layout.notificationPaymentCardCount > 0) {
            assert.equal(
              layout.notificationPaymentKindBadgeCount,
              layout.notificationPaymentCardCount,
              `${testCase.id} must keep payment kind badges for payment follow-ups`,
            );
          }
          if (layout.notificationReadNoticeCardCount > 0) {
            assert.equal(
              layout.notificationReadNoticeCardToneDownCount,
              layout.notificationReadNoticeCardCount,
              `${testCase.id} must tone down every confirmed notice card`,
            );
            assert.equal(
              layout.notificationReadNoticeBadgeToneDownCount,
              layout.notificationReadNoticeCardCount,
              `${testCase.id} must tone down every confirmed notice state badge`,
            );
          }
          assert.equal(
            layout.notificationFollowUpStateBadgeCount,
            layout.notificationInboxCardCount - layout.notificationNoticeCardCount,
            `${testCase.id} must show follow-up badges on every actionable non-notice item without inventing one for a fully paid selected child`,
          );
          assert(layout.notificationFilterButtonMinHeight >= 44, `${testCase.id} filter buttons must keep 44px touch height`);
          assert(layout.notificationFilterButtonText.includes("미확인"), `${testCase.id} unread filter must remain visible`);
          assert(
            !layout.notificationFilterButtonText.includes("공지 미확인"),
            `${testCase.id} unread filter must keep compact visible copy while aria keeps the notice-only scope`,
          );
          assert(layout.notificationBulkReadButtonHeight >= 44, `${testCase.id} read action must keep 44px touch height`);
          assert.equal(
            layout.notificationBulkReadButtonText,
            "공지 전체 읽음",
            `${testCase.id} read action must disclose that the full current notice view will be marked as read`,
          );
          assert(layout.notificationBulkReadButtonAriaLabel.includes("공지"), `${testCase.id} read action aria-label must make the notice-only scope clear`);
          assert.equal(layout.notificationBulkReadButtonDisabled, false, `${testCase.id} read action must stay enabled while unread notices are visible`);
          assert.equal(layout.notificationBulkReadButtonState, "active", `${testCase.id} read action must expose active state while unread notices are visible`);
          if (layout.notificationReadActionCount > 0) {
            assert(layout.notificationReadActionMinHeight >= 44, `${testCase.id} single read actions must keep 44px touch height`);
            assert(
              layout.notificationReadActionText.split("|").every((label) => label === "확인"),
              `${testCase.id} single read actions must keep compact visible labels`,
            );
          }
          assert.equal(layout.notificationReadFeedbackCount, 0, `${testCase.id} read feedback must stay hidden before a read action`);
          if (testCase.id === "member-notifications") {
            assert(layout.notificationPaymentCheckoutLinkCount > 0, `${testCase.id} must deep-link payable payment alerts to checkout preparation`);
          }
          if (layout.notificationPaymentCheckoutLinkCount > 0) {
            assert(
              /납부 요청|납부 확인 중|납부 확인|학부모 확인/.test(layout.notificationPaymentCheckoutLinkText),
              `${testCase.id} payment alert checkout links must use request or confirmation copy`,
            );
            assert(
              !/결제하기|결제 진행/.test(layout.notificationPaymentCheckoutLinkText),
              `${testCase.id} payment alert checkout links must not imply live payment approval`,
            );
          }
          assert.equal(
            layout.notificationNoticeDetailLinkCount,
            0,
            `${testCase.id} notice alerts must not repeat per-card 보기 buttons`,
          );
          assert.equal(
            layout.notificationNoticeContentLinkCount,
            layout.notificationNoticeCardCount,
            `${testCase.id} notice alert content must remain tappable after removing repeated 보기 buttons`,
          );
          assert.equal(layout.notificationRequestDetailLinkCount, 0, `${testCase.id} must not render deleted request alert links`);
          assert.equal(layout.notificationRequestDetailLinkText, "", `${testCase.id} must not show request alert labels`);
          assert.equal(layout.notificationSettingsJumpHeight, 0, `${testCase.id} must hide the notification settings shortcut`);
          assert.equal(layout.notificationSettingsJumpText, "", `${testCase.id} must not show notification settings copy`);
          assert.equal(
            layout.notificationSettingsJumpHref,
            "",
            `${testCase.id} must not link to notification permission controls`,
          );
          assert.equal(layout.notificationPermissionPanelHeight, 0, `${testCase.id} must remove the notification settings card`);
          assert.equal(layout.notificationPermissionStatusChipCount, 0, `${testCase.id} must not show notification permission status chips`);
          assert.equal(layout.notificationPermissionActionsHeight, 0, `${testCase.id} must not show notification permission actions`);
          assert.equal(layout.notificationPermissionActionText, "", `${testCase.id} must not show notification setting action labels`);
        }

        if (testCase.id === "coach-notices") {
          assert.equal(layout.noticesScreenCount, 1, "coach notices must render the dedicated notices screen");
          assert.equal(layout.requestsScreenCount, 0, "coach notices must not render the requests screen inside notices");
          assert.equal(layout.mobileBottomNavActiveRouteIds, "notices", "coach notices must activate the notices bottom-nav item");
          assert.equal(layout.mobileBottomNavCurrentRouteIds, "notices", "coach notices must mark only notices as the current bottom-nav item");
          assert.equal(layout.mobileBottomNavNoticeLabel, "공지", "coach notices must label notice management directly");
          assert.equal(layout.mobileBottomNavNoticeHref, "/app/notices", "coach notice tab must open notice management directly");
          assert.equal(layout.noticeOperationsPanelCount, 0, "coach notices must not render owner/admin notice operations");
          assert.equal(layout.noticeActionQueueCount, 0, "coach notices must not render owner/admin notice action queues");
          assert.equal(layout.noticeFollowUpBoardCount, 0, "coach notices must not render owner/admin read-status detail");
          assert(layout.noticeDeliveryCompactCardCount > 0, "coach notices must render scoped publisher notice rows");
          assert.equal(
            layout.noticeDeliveryMetaLineCount,
            layout.noticeDeliveryCompactCardCount,
            "coach notices must show delivery/read metadata for publisher rows",
          );
          assert(layout.noticeDeliveryReadActionMinHeight >= 44, "coach notice read actions must keep 44px touch height");
          assert(layout.noticeDeliveryPushActionMinHeight >= 44, "coach notice push actions must keep 44px touch height");
          assert.equal(layout.noticeCreatePanelCount, 1, "coach notices must expose the scoped notice composer");
          assert(
            layout.noticeCreatePanelTop > 0 && layout.noticeCreatePanelTop < layout.noticeFirstDeliveryCardTop,
            "coach notices must show the notice composer before delivery cards on mobile",
          );
          assert.equal(layout.noticeCreateToggleCount, 1, "coach notices must expose one composer toggle");
          assert(layout.noticeCreateToggleHeight >= 44, "coach notice composer toggle must keep 44px touch height");
          assert.equal(layout.familyNoticeCompactFilterBarCount, 0, "coach publisher notices must not use family compact filter bars");
          assert.equal(layout.familyNoticeCardCount, 0, "coach publisher notices must not use family notice cards");
        }

        if (testCase.id === "owner-notices" || testCase.id === "admin-notices") {
          assert.equal(layout.mobileBottomNavActiveRouteIds, "notices", `${testCase.id} must activate notice management in the stable bottom navigation`);
          assert.equal(layout.mobileBottomNavCurrentRouteIds, "notices", `${testCase.id} must mark notice management as current`);
          assert.equal(layout.mobileBottomNavNoticeLabel, "공지", `${testCase.id} must label notice management directly`);
          assert.equal(layout.mobileBottomNavNoticeHref, "/app/notices", `${testCase.id} notice action must keep the management destination`);
          assert.equal(layout.noticeOperationsPanelCount, 0, `${testCase.id} must remove the separate notice operations card panel`);
          assert.equal(layout.noticeOperationsPanelHeight, 0, `${testCase.id} must not reserve space for the removed operations panel`);
          assert.equal(layout.noticeOperationsToggleCount, 0, `${testCase.id} must remove the separate operations detail toggle`);
          assert.equal(layout.noticeOperationsToggleHeight, 0, `${testCase.id} must not render the removed operations detail toggle`);
          assert.equal(layout.noticeOperationsMetricCount, 0, `${testCase.id} must not render duplicate notice operation metric cards`);
          assert.equal(layout.noticeOperationsDetailCount, 0, `${testCase.id} must keep operations detail collapsed by default`);
          assert.equal(layout.noticeActionQueueCount, 0, `${testCase.id} must not render separate notice action queue cards`);
          assert.equal(layout.noticeFollowUpBoardCount, 0, `${testCase.id} must not render separate read-status cards`);
          assert.equal(layout.notificationPermissionPanelHeight, 0, `${testCase.id} must not render a notification settings card inside notices`);
          assert.equal(layout.notificationPermissionStatusChipCount, 0, `${testCase.id} must not render notification status chips inside notices`);
          assert.equal(layout.notificationPermissionActionText, "", `${testCase.id} must not render notification setting actions inside notices`);
          assert(layout.noticeDeliveryCompactCardCount > 0, `${testCase.id} must render compact notice delivery cards`);
          if (layout.noticeDeliveryReadCardCount > 0) {
            assert.equal(
              layout.noticeDeliveryReadCardToneDownCount,
              layout.noticeDeliveryReadCardCount,
              `${testCase.id} must tone down every read notice delivery card`,
            );
            assert.equal(
              layout.noticeDeliveryReadBadgeToneDownCount,
              layout.noticeDeliveryReadCardCount,
              `${testCase.id} must tone down every read notice delivery badge`,
            );
          }
          assert.equal(layout.noticeDeliveryMetaLineCount, layout.noticeDeliveryCompactCardCount, `${testCase.id} must render one compact meta line per notice card`);
          assert.equal(
            layout.noticeDeliveryBodyVisibleCount,
            layout.noticeDeliveryCompactCardCount,
            `${testCase.id} must show one bounded operator notice preview per card on mobile`,
          );
          assert(layout.noticeDeliveryBodyMaxHeight <= 40, `${testCase.id} operator notice previews must stay within two text lines`);
          assert.equal(layout.noticeDeliveryDateLineCount, 0, `${testCase.id} must merge date/read count into the compact meta line`);
          assert.equal(layout.noticeDeliveryActionRowCount, layout.noticeDeliveryCompactCardCount, `${testCase.id} must render one compact action row per notice card`);
          assert(layout.noticeDeliveryActionRowMaxHeight <= 44, `${testCase.id} notice action row must stay as one compact mobile icon row`);
          assert(layout.noticeDeliveryActionButtonMaxWidth <= 144, `${testCase.id} notice action buttons must fit one compact mobile row`);
          assert.equal(
            layout.noticeDeliveryLongPushLabelCount,
            layout.noticeDeliveryCompactCardCount,
            `${testCase.id} must name every push action as 알림 발송`,
          );
          assert(layout.noticeDeliveryCompactCardMaxHeight <= 188, `${testCase.id} notice cards with body previews must stay bounded on mobile`);
          assert.equal(layout.noticeCreatePanelCount, 1, `${testCase.id} must render one collapsed notice creation panel`);
          assert(
            layout.noticeCreatePanelTop > 0 && layout.noticeCreatePanelTop < layout.noticeFirstDeliveryCardTop,
            `${testCase.id} must show the notice creation panel before delivery cards on mobile`,
          );
          assert.equal(layout.noticeCreateToggleCount, 1, `${testCase.id} must render one notice creation toggle`);
          assert(layout.noticeCreateToggleHeight >= 44, `${testCase.id} notice creation toggle must keep 44px touch height`);
          assert.equal(layout.noticeCreateFormCount, 0, `${testCase.id} must keep the notice creation form collapsed by default`);
          assert(layout.noticeDeliveryReadActionMinHeight >= 44, `${testCase.id} notice read actions must keep 44px touch height`);
          assert(layout.noticeDeliveryPushActionMinHeight >= 44, `${testCase.id} notice push actions must keep 44px touch height`);
        }

        if (testCase.id === "member-payments" || testCase.id === "guardian-payments") {
          assert.equal(layout.memberPaymentFilterChipGroupCount, 1, `${testCase.id} must render compact payment filter chips`);
          assert.equal(layout.memberPaymentFilterChipCount, 3, `${testCase.id} must render only the three family payment filter chips`);
          assert.equal(layout.memberPaymentFilterChipCountLabelCount, 3, `${testCase.id} payment filter chips must carry their own counts`);
          assert(layout.memberPaymentFilterChipMinHeight >= 44, `${testCase.id} payment filter chips must keep a 44px touch height`);
          assert.equal(layout.memberPaymentFilterStatusCount, 0, `${testCase.id} must not render a separate payment count badge`);
          assert.equal(layout.memberPaymentFilterHeadingCount, 0, `${testCase.id} must not render a visible payment filter heading`);
          assert(layout.memberPaymentFilterChipGroupHeight <= 52, `${testCase.id} payment filter group must stay compact as one segmented control`);
          assert.equal(layout.memberPaymentFilterLargeSummaryCount, 0, `${testCase.id} must not render a large repeated payment count row`);
          assert.equal(layout.memberPaymentFilterSelectCount, 0, `${testCase.id} must not render the large payment filter select`);
          assert(layout.memberPaymentCompactCardCount > 0, `${testCase.id} must render compact payment cards`);
          assert.equal(layout.memberPaymentDateLineCount, layout.memberPaymentCompactCardCount, `${testCase.id} must show one compact due/expires date line per payment`);
          assert(layout.memberPaymentDateLineMaxHeight >= 44, `${testCase.id} payment date line must keep a stable 44px scan height`);
          assert(layout.memberPaymentDateLineMaxHeight <= 48, `${testCase.id} payment date line must stay compact`);
          if (testCase.id === "member-payments") {
            assert(layout.memberPaymentCheckoutActionCount > 0, `${testCase.id} must keep payment checkout actions on payable cards`);
          } else {
            assert(
              layout.memberPaymentCheckoutActionCount > 0 || layout.memberPaymentCheckoutStateBadgeCount > 0,
              `${testCase.id} must show either a payable action or the selected child's truthful blocked/completed state`,
            );
          }
          if (layout.memberPaymentCheckoutActionCount > 0) {
            assert(
              layout.memberPaymentCheckoutActionTexts.some((text) => text.includes("납부 요청")),
              `${testCase.id} checkout action must use request copy before provider integration`,
            );
            assert(
              layout.memberPaymentCheckoutActionTexts.every((text) => !text.includes("결제하기")),
              `${testCase.id} checkout action must not imply live payment approval`,
            );
            assert(layout.memberPaymentCheckoutActionMinHeight >= 44, `${testCase.id} checkout actions must keep a 44px touch height`);
          }
          assert.equal(
            layout.memberPaymentCheckoutLinkCardCount,
            layout.memberPaymentCheckoutActionCount,
            `${testCase.id} must make exactly the payable payment cards act as links`,
          );
          assert.equal(
            layout.memberPaymentCheckoutActionInLinkCardCount,
            layout.memberPaymentCheckoutActionCount,
            `${testCase.id} checkout actions must sit inside whole-card links`,
          );
          assert.equal(
            layout.memberPaymentCheckoutStateBadgeInLinkCardCount,
            0,
            `${testCase.id} blocked checkout badges must not sit inside link cards`,
          );
          assert.equal(
            layout.memberPaymentBlockedCheckoutLinkCardCount,
            0,
            `${testCase.id} blocked checkout states must not expose whole-card links`,
          );
          if (layout.memberPaymentCheckoutStateBadgeCount > 0) {
            assert(layout.memberPaymentCheckoutStateBadgeMaxHeight <= 32, `${testCase.id} blocked checkout states must render as compact badges`);
          }
          assert(layout.memberPaymentCompactCardMaxHeight <= 130, `${testCase.id} payment cards must stay compact`);
          assert.equal(layout.memberPaymentCompactAmountTextCount, 0, `${testCase.id} compact payment cards must not duplicate amounts outside checkout actions`);
        }

        if (testCase.id === "guardian-notices") {
          assert.equal(layout.noticeExpandButtonCount, 0, "guardian notices must remove repeated 자세히 buttons from notice rows");
        }

        if (testCase.id === "owner-dashboard") {
          assert.equal(layout.ownerDashboardPeriodFilterCount, 1, "owner dashboard must render one period filter");
          assert.equal(layout.ownerDashboardPeriodOptionCount, 3, "owner dashboard period filter must render today/7d/30d options");
          assert.equal(layout.ownerDashboardPeriodOptionText, "오늘|7일|30일", "owner dashboard period filter must keep compact Korean labels");
          assert(
            layout.ownerDashboardPeriodOptionMinHeight >= 44,
            "owner dashboard period filter options must keep a 44px touch target",
          );
          assert(layout.ownerDashboardGraphBoardHeight <= 205, "owner dashboard top graph board must stay compact enough to surface branch comparison quickly");
          assert.equal(layout.ownerDashboardSecondaryGraphGridCount, 1, "owner dashboard must render one compact secondary graph grid");
          assert.equal(layout.ownerDashboardGraphRowCount, 5, "owner dashboard must show one period row and four current-state rows");
          assert.equal(layout.ownerDashboardSecondaryGraphRowCount, 4, "owner dashboard must show four current-state rows without clipping");
          assert(layout.ownerDashboardSecondaryGraphGridHeight <= 122, "owner dashboard secondary graph grid must stay readable in two columns on mobile");
          assert.equal(layout.ownerDashboardGraphLabelOverflow, 0, "owner dashboard graph labels must not be clipped on mobile");
          assert(layout.ownerDashboardRiskSummaryTop > 0, "owner dashboard must render the risk summary in the mobile viewport");
          assert(layout.ownerDashboardRiskSummaryTop <= 640, "owner dashboard risk summary must surface before the bottom navigation zone");
          assert.equal(layout.ownerDashboardRiskSummaryBottomNavOverlap, 0, "owner dashboard risk summary must not sit under the bottom navigation");
          assert.equal(layout.ownerDashboardDetailToggleCount, 1, "owner dashboard must render one detail toggle");
          assert(layout.ownerDashboardDetailToggleHeight >= 44, "owner dashboard detail toggle must keep a 44px touch target");
          assert.equal(layout.ownerDashboardDetailToggleBottomNavOverlap, 0, "owner dashboard detail toggle must not sit under the bottom navigation");
          assert(
            layout.ownerDashboardDetailToggleBottomNavClearance >= 16,
            "owner dashboard detail toggle must keep visible clearance from the bottom navigation",
          );
          assert.equal(layout.ownerBranchComparisonGraphCount, 1, "owner dashboard must render the branch comparison graph");
          assert(layout.ownerBranchComparisonRowCount > 0, "owner dashboard branch comparison graph must render branch rows");
          assert.equal(layout.ownerBranchComparisonRowBottomNavOverlap, 0, "owner dashboard branch comparison row must not sit under the bottom navigation");
          assert(
            layout.ownerBranchComparisonRowBottomNavClearance >= 24,
            "owner dashboard branch comparison row must keep breathing room from the bottom navigation",
          );
          assert.equal(layout.ownerBranchComparisonCardBottomNavOverlap, 0, "owner dashboard branch comparison card must not sit under the bottom navigation");
          assert(
            layout.ownerBranchComparisonCardBottomNavClearance >= 24,
            "owner dashboard branch comparison card must keep breathing room from the bottom navigation",
          );
          assert.equal(layout.ownerBranchMetricGridCount, layout.ownerBranchComparisonRowCount, "owner dashboard branch rows must render compact metric grids");
          assert(layout.ownerBranchComparisonRowMaxHeight <= 108, "owner dashboard branch comparison rows must stay compact above the bottom nav");
          assert(layout.ownerBranchMetricGridMaxHeight >= 32, "owner dashboard branch metric grids must stay readable on mobile");
          assert(layout.ownerBranchMetricGridMaxHeight <= 40, "owner dashboard branch metric grids must stay compact on mobile");
          for (const label of ["출석", "결제 위험"]) {
            assert(layout.ownerBranchComparisonText.includes(label), `owner dashboard branch comparison graph must show ${label}`);
          }
          assert(!layout.ownerBranchComparisonText.includes("요청"), "owner dashboard branch comparison graph must not show deleted request metrics");
        }

        if (testCase.id === "owner-branches") {
          assert(layout.ownerBranchHealthGraphCount > 0, "owner branches must render compact branch health graphs");
          assert.equal(layout.ownerBranchHealthRowCount, layout.ownerBranchHealthGraphCount * 3, "owner branches must render three graph rows for each branch after removing requests");
          assert(layout.ownerBranchHealthGraphMaxHeight <= 90, "owner branches graph must stay as one compact three-row panel");
          assert(layout.ownerBranchHealthRowMaxHeight <= 22, "owner branches graph rows must stay slim on mobile");
          assert.equal(layout.ownerBranchPolicySummaryCount, layout.ownerBranchHealthGraphCount, "owner branches must render one compact policy summary per branch");
          assert.equal(layout.ownerBranchPolicyDetailCount, 0, "owner branches must keep policy details collapsed by default");
          assert.equal(layout.ownerBranchPolicyToggleCount, layout.ownerBranchHealthGraphCount, "owner branches must render one policy detail toggle per branch");
          assert(layout.ownerBranchPolicyToggleMinHeight >= 44, "owner branches policy toggles must keep a 44px touch height");
          assert.equal(layout.ownerBranchActionLinkCount, layout.ownerBranchHealthGraphCount * 2, "owner branches must show two priority action links per branch by default");
          assert(layout.ownerBranchActionLinkMinHeight >= 44, "owner branches action links must keep a 44px touch height");
          assert.equal(layout.ownerBranchActionToggleCount, layout.ownerBranchHealthGraphCount, "owner branches must render one action expansion toggle per branch");
          assert(layout.ownerBranchActionToggleMinHeight >= 44, "owner branches action toggles must keep a 44px touch height");
          assert.equal(layout.ownerBranchBottomSafeAreaCount, 1, "owner branches must render one mobile bottom safe-area spacer");
          assert(layout.ownerBranchBottomSafeAreaHeight >= 112, "owner branches bottom safe-area spacer must reserve mobile bottom space");
          assert(
            layout.ownerBranchActionBottomNavClearanceAtScrollEnd >= 24,
            "owner branches last action row must clear the mobile bottom navigation at scroll end",
          );
          for (const label of ["회원 유지", "수업 채움", "결제 위험"]) {
            assert(layout.ownerBranchHealthText.includes(label), `owner branches graph must show ${label}`);
          }
          assert(!layout.ownerBranchHealthText.includes("보강"), "owner branches graph must not show deleted request rows");
        }

        if (testCase.id === "coach-dashboard") {
          assert.equal(layout.coachDashboardFlowGraphCount, 1, "coach dashboard must render the compact flow graph");
          assert.equal(layout.coachDashboardFlowRowCount, 3, "coach dashboard flow graph must render three action rows after removing requests");
          assert(layout.coachDashboardFlowGraphHeight <= 205, "coach dashboard flow graph must stay compact enough for today's classes to surface");
          assert(layout.coachDashboardFlowRowMaxHeight <= 48, "coach dashboard flow rows must stay in compact single-line rows");
          assert(layout.coachDashboardAllClassesLinkHeight >= 44, "coach dashboard all-classes link must keep a 44px touch height");
          assert(layout.coachDashboardClassesPanelTop <= 500, "coach dashboard today's classes panel must remain visible near the first viewport");
          for (const label of ["오늘 수업", "출석 처리율", "상담/주의"]) {
            assert(layout.coachDashboardFlowText.includes(label), `coach dashboard flow graph must show ${label}`);
          }
          assert(!layout.coachDashboardFlowText.includes("보강"), "coach dashboard flow graph must not show deleted request rows");
        }

        if (testCase.id === "member-dashboard") {
          assert.equal(layout.memberGuardianPriorityGridCount, 1, "member dashboard must render one compact priority list");
          assert.equal(layout.memberGuardianPriorityCellCount, 5, "member dashboard compact priority list must render five core-status rows");
          assert(
            !layout.memberGuardianPriorityHrefs.includes("/app/requests?compose=1"),
            "member dashboard must not expose the deleted request compose flow",
          );
          assert(
            layout.memberGuardianPriorityHrefs.some((href) => href.startsWith("/app/payments/checkout?paymentId=")),
            "member dashboard payment priority row must deep-link payable adult payments to checkout preparation",
          );
          assert.deepEqual(
            layout.memberGuardianPriorityLabels,
            ["다음 수업", "출석", "결제 상태", "승급", "공지"],
            "member dashboard compact priority list must connect class, payment, promotion, and notice flows",
          );
          assert(
            layout.memberGuardianPriorityHrefs.includes("/app/promotions"),
            "member dashboard promotion priority row must open promotion history",
          );
          assert(
            layout.memberGuardianPriorityHrefs.includes("/app/notices"),
            "member dashboard notice priority row must always open notices",
          );
          assert(
            layout.memberGuardianPriorityDetails.some((detail) => /미확인 공지 \d+건|공지 \d+건 모두 확인|도착한 공지 없음/.test(detail)),
            "member dashboard notice priority row must describe only notice state",
          );
          assert(layout.memberGuardianPriorityCellMinHeight >= 56, "member dashboard compact priority rows must keep stable touch height");
          assert(layout.memberGuardianPriorityCellMaxHeight <= 66, "member dashboard compact priority rows must not become tall cards again");
        }

        if (testCase.id === "guardian-dashboard") {
          assert.equal(layout.guardianChildSwitcherCount, 1, "guardian dashboard must render one compact child switcher");
          assert(layout.guardianChildChipCount >= 2, "guardian dashboard must render child chips");
          assert(layout.guardianChildChipStatusTextCount > 0, "guardian dashboard must expose non-active child states in the selector");
          assert(
            layout.guardianChildChipStatusTextCount < layout.guardianChildChipCount,
            "guardian dashboard must keep the normal active state implicit while surfacing exceptional child states",
          );
          assert(layout.guardianChildChipMinHeight >= 44, "guardian dashboard child chips must remain tappable");
          assert(layout.guardianChildChipMaxHeight <= 52, "guardian dashboard child selector must stay compact");
          assert.equal(layout.guardianLearningStageBarCount, 1, "guardian dashboard must render the compact belt stage bar");
          assert.equal(layout.guardianLearningInsightGridCount, 1, "guardian dashboard must render the compact learning insight grid");
          assert(layout.guardianLearningInsightGridHeight <= 220, "guardian dashboard learning grid must stay within a compact two-row layout");
          assert(
            layout.guardianLearningInsightCellCount >= 2 && layout.guardianLearningInsightCellCount <= 4,
            "guardian dashboard learning grid must render core insights without empty promotion or tournament cells",
          );
          assert(layout.guardianLearningInsightCellMinHeight >= 80, "guardian dashboard learning insight cells must keep readable touch height");
          assert(layout.guardianLearningInsightCellMaxHeight <= 128, "guardian dashboard learning insight cells must remain scan-friendly");
          for (const label of ["다음 수업", "코치 피드백"]) {
            assert(layout.guardianLearningInsightText.includes(label), `guardian dashboard learning grid must show ${label}`);
          }
          assert(!layout.guardianLearningInsightText.includes("심사 결과 없음"), "guardian dashboard must omit empty promotion cards");
          assert(!layout.guardianLearningInsightText.includes("대회 일정 없음"), "guardian dashboard must omit empty tournament cards");
          for (const gluedLabel of ["다음수업", "코치피드백", "피드백최근", "1건코치"]) {
            assert(!layout.guardianLearningInsightText.includes(gluedLabel), `guardian dashboard learning grid text extraction must not glue ${gluedLabel}`);
          }
          for (const staleLabel of ["최근 코치 피드백", "심사 결과 공지", "대회 소식", "2개 반", "공지 있음"]) {
            assert(!layout.guardianLearningInsightText.includes(staleLabel), `guardian dashboard learning grid must not repeat ${staleLabel}`);
          }
          assert.equal(layout.guardianLearningActionStripCount, 1, "guardian dashboard must render one toned-down status rail inside learning report");
          assert.equal(layout.guardianLearningActionLinkCount, 2, "guardian dashboard status rail must keep payment and notice links after removing requests");
          assert(layout.guardianLearningActionLinkMinHeight >= 44, "guardian dashboard status rail links must keep 44px touch height");
          for (const href of ["/app/payments", "/app/notifications"]) {
            assert(layout.guardianLearningActionHrefs.includes(href), `guardian dashboard status rail must include ${href}`);
          }
          assert(
            !layout.guardianLearningActionHrefs.some((href) => href.startsWith("/app/requests")),
            "guardian dashboard status rail must not expose deleted request links",
          );
          assert(
            !layout.guardianLearningActionHrefs.some((href) => href.startsWith("/app/payments/checkout?paymentId=pay-jun")),
            "guardian dashboard paid child payment action must not deep-link completed payments to checkout preparation",
          );
          for (const label of ["결제", "공지"]) {
            assert(layout.guardianLearningActionText.includes(label), `guardian dashboard status rail must show ${label}`);
          }
          for (const label of ["결제 완료"]) {
            assert(layout.guardianLearningActionText.includes(label), `guardian dashboard status rail must keep readable ${label} copy`);
          }
          assert(/공지 \d+건/.test(layout.guardianLearningActionText), "guardian dashboard status rail must keep readable notice count copy");
          assert(/결제 완료 공지 \d+건/.test(layout.guardianLearningActionText), "guardian dashboard status rail text extraction must keep a readable space between actions");
          assert(!layout.guardianLearningActionText.includes("결제·"), "guardian dashboard status rail must not visually glue payment status with a dot");
          assert(!layout.guardianLearningActionText.includes("공지·"), "guardian dashboard status rail must not visually glue notice count with a dot");
          assert(
            !layout.guardianLearningActionAriaLabels.some((label) => label.includes("보강")),
            "guardian dashboard status rail must not reintroduce deleted request wording in aria-labels",
          );
        }

			        if (testCase.id === "coach-classes") {
		          assert(layout.coachAttendanceControlPanelHeight <= 96, "coach classes attendance controls must stay compact enough for the first class card to surface quickly");
          assert.equal(layout.attendanceRosterSearchInputCount, 0, "coach classes roster search input must stay collapsed by default");
          assert.equal(layout.attendanceRosterSearchToggleCount, 1, "coach classes roster search toggle must render by default");
          assert(layout.attendanceRosterSearchToggleHeight >= 44, "coach classes roster search toggle must keep a 44px touch height");
		          assert(layout.coachMobileToolsToggleHeight >= 44, "coach classes secondary tools toggle must keep a 44px touch height");
		          assert.equal(layout.coachMobileToolsExpanded, "false", "coach classes secondary tools must stay collapsed by default on mobile");
		          assert.equal(layout.coachMobileToolsDetailsHeight, 0, "coach classes secondary tools must not consume first-viewport height while collapsed");
          assert(layout.coachMobileSpeedPressedStates.includes("coach-mobile-speed-unchecked-action:false"), "coach classes unchecked quick action must expose inactive pressed state");
          assert(layout.coachMobileSpeedPressedStates.includes("coach-mobile-speed-reason-action:false"), "coach classes reason quick action must expose inactive pressed state");
          assert(layout.coachMobileSpeedPressedStates.includes("coach-mobile-speed-attention-action:false"), "coach classes attention quick action must expose inactive pressed state");
		          assert.equal(layout.coachMobileSpeedSummaryChipCount, 0, "coach classes quick action panel must not repeat four summary chips");
		          assert.equal(layout.coachMobileSpeedSummaryLineCount, 1, "coach classes quick action panel must render one compact status line");
		          assert(layout.coachMobileSpeedSummaryLineHeight <= 18, "coach classes quick action status line must stay one row");
          assert.equal(layout.coachFieldFlowCompactGridCount, 1, "coach classes field flow must render one compact grid");
          assert.equal(layout.coachFieldFlowCompactColumnCount, 2, "coach classes field flow must keep pre/post columns");
          assert.equal(layout.coachFieldFlowCompactSummaryCount, 2, "coach classes field flow must keep two short summary lines");
				          assert(layout.attendanceStatusFilterGroupHeight <= 52, "coach classes status filters must stay in one active-status chip row");
          assert(layout.attendanceStatusFilterButtonCount <= 4, "coach classes status filters must hide zero-count status chips by default");
          assert(!layout.attendanceStatusFilterButtonText.includes("결석0"), "coach classes status filters must hide zero-count absent chip");
          assert(!layout.attendanceStatusFilterButtonText.includes("사유0"), "coach classes status filters must hide zero-count excused chip");
          assert(!layout.attendanceStatusFilterButtonText.includes("보강0"), "coach classes status filters must hide zero-count deleted request chip");
	          assert.equal(layout.attendanceStatusFilterGroupOverflow, 0, "coach classes status filter grid must not require horizontal scrolling");
          assert(layout.attendanceUncheckedFilterLabelHeight >= 44, "coach classes unchecked filter label must keep a 44px touch height");
	          assert(layout.attendanceUncheckedFilterBoxHeight >= 28, "coach classes unchecked filter checkbox must remain visually clear");
          assert(layout.attendanceStatusFilterButtonMinHeight >= 44, "coach classes status filter buttons must keep a 44px touch height");
          assert(layout.coachClassRosterToggleCount > 1, "coach classes must render roster toggles for each class card");
          assert.equal(layout.coachClassRosterLongLabelCount, 0, "coach classes roster toggles must keep compact mobile labels");
          assert(layout.coachClassRosterToggleMinHeight >= 44, "coach class roster toggles must keep a 44px touch height");
          assert(layout.coachVisibleClassCardCount <= 1, "coach classes must keep the mobile default list short enough to avoid bottom navigation overlap");
          assert.equal(layout.coachClassListToggleCount, 1, "coach classes must expose a mobile list expansion control when extra classes are hidden");
          assert(layout.coachClassListToggleMinHeight >= 44, "coach classes list expansion control must keep a 44px touch height");
          assert(layout.coachClassListToggleText.includes("오늘 수업"), "coach classes list expansion control must use clear class-list copy");
          assert.equal(layout.coachClassRosterToggleBottomNavOverlapCount, 0, "coach class roster toggles must not overlap the mobile bottom navigation");
          assert.equal(layout.coachClassListToggleBottomNavOverlapCount, 0, "coach class list expansion control must not overlap the mobile bottom navigation");
          assert.equal(layout.coachClassRosterOpenCount, 1, "coach classes must open the first incomplete roster by default on mobile");
          assert.equal(
            layout.coachClassRosterClosedCount,
            layout.coachClassRosterToggleCount - layout.coachClassRosterOpenCount,
            "coach classes must keep non-priority rosters collapsed by default",
          );
          assert(layout.coachClassRosterClosedMaxHeight <= 2, "coach classes must merge collapsed roster status into the toggle without a duplicate visible row");
          assert(layout.coachClassCardCount > 1, "coach classes must render compact class cards");
          assert(layout.coachFirstClassCardTop <= 340, "coach classes first class card must appear before secondary tools and additional-class controls in the mobile first viewport");
          assert.equal(layout.coachClassAttendanceSummaryCount, layout.coachClassCardCount, "coach classes must render one compact attendance summary per class card");
          assert(layout.coachClassAttendanceSummaryMaxHeight <= 44, "coach classes attendance summary must stay inside the compact action row");
          assert(layout.coachClassCardMaxHeight <= 960, "coach class cards must keep a bounded expanded attendance workspace");
          assert.equal(layout.attendanceHistoryPanelCount, 1, "coach classes must keep a recent attendance history affordance");
          assert.equal(layout.attendanceHistoryState, "closed", "coach classes recent attendance history must stay collapsed by default");
          assert(layout.attendanceHistoryPanelHeight <= 76, "coach classes recent attendance history must render as a compact one-row summary");
          assert(layout.attendanceHistoryToggleHeight >= 44, "coach classes recent attendance history toggle must keep a 44px touch height");
          assert.equal(layout.attendanceHistoryDetailListCount, 0, "coach classes recent attendance history details must stay hidden by default");
          assert.equal(layout.attendanceHistoryDetailRowCount, 0, "coach classes recent attendance history rows must not render until opened");
          assert(layout.attendanceHistoryText.includes("최근 저장"), "coach classes recent attendance history summary must remain understandable");
          assert(layout.coachClassAttendanceNoteToggleCount > 0, "coach classes must expose attendance note actions in the default priority roster");
          assert.equal(layout.coachClassAttendanceNoteEditorCount, 0, "coach classes must keep attendance note editors hidden by default");
          assert.equal(
            layout.coachClassAttendanceNoteInputVisibleCount,
            layout.coachClassAttendanceNoteEditorCount,
            "coach classes visible note inputs must only appear inside opened note editors",
          );
          assert.equal(layout.coachClassInternalPanelCount, 0, "coach classes must not expose internal P3 operation panels in the app UI");
          assert.equal(layout.coachClassVisibleCodeCount, 0, "coach classes must not render code-style internal closeout text in the app UI");
        }

        if (testCase.id === "guardian-classes") {
          assert.equal(layout.personalAttendanceSummaryCount, 0, "guardian classes must not duplicate child attendance in a header summary");
          assert(layout.familyClassCardCount > 0, "guardian classes must render family-specific compact class cards");
          assert(layout.familyClassCardMaxHeight <= 132, "guardian classes must keep compact class cards within the mobile scan height budget");
          assert(layout.familyAttendanceChipGridCount > 0, "guardian classes must compress child attendance into compact chip grids");
          assert(layout.familyAttendanceChipCount > 0, "guardian classes must render compact child attendance chips");
          assert(layout.familyAttendanceChipMinHeight >= 44, "guardian class attendance chips must remain readable and stable");
          assert(layout.familyAttendanceChipMaxHeight <= 56, "guardian class attendance chips must stay compact");
        }

        if (testCase.id === "member-classes") {
          assert.equal(layout.personalAttendanceSummaryCount, 0, "member classes must keep attendance status in the member row only");
          assert(layout.familyClassCardCount > 0, "member classes must render family-specific compact class cards");
          assert(layout.familyClassCardMaxHeight <= 132, "member classes must keep compact class cards within the mobile scan height budget");
          assert(layout.familyAttendanceChipGridCount > 0, "member classes must render compact attendance chip grids");
          assert(layout.familyAttendanceChipCount > 0, "member classes must render compact attendance chips");
          assert(layout.familyAttendanceChipMinHeight >= 44, "member class attendance chips must remain readable and stable");
          assert(layout.familyAttendanceChipMaxHeight <= 56, "member class attendance chips must stay compact");
        }

        if (testCase.id === "owner-reports") {
          assert.equal(layout.ownerReportTrendSummaryGridCount, 1, "owner reports must render the compact trend summary grid");
          assert.equal(layout.ownerReportTrendSummaryRowCount, 4, "owner reports trend summary must render four graph rows");
          assert(layout.ownerReportTrendSummaryGridHeight <= 106, "owner reports trend summary graph rail must stay compact on mobile");
          assert(layout.ownerReportTrendSummaryRowMaxHeight <= 24, "owner reports trend summary rows must not become cards again");
          assert(layout.ownerReportTrendSummaryTileMaxHeight <= 24, "owner reports trend summary direct rows must not become tall tiles again");
          assert(layout.ownerReportGraphBoardHeight <= 230, "owner reports top graph board must stay compact enough for the trend section to surface quickly");
          assert.equal(layout.ownerReportSecondaryGraphGridCount, 1, "owner reports must render one compact secondary graph grid");
          assert.equal(layout.ownerReportSecondaryGraphTileCount, 3, "owner reports secondary graph must show only three priority KPI tiles by default");
          assert(layout.ownerReportSecondaryGraphGridHeight >= 92, "owner reports secondary graph grid must use readable two-column KPI tiles on mobile");
          assert(layout.ownerReportSecondaryGraphGridHeight <= 128, "owner reports secondary graph grid must stay compact after the two-column mobile layout");
          assert(layout.ownerReportSecondaryGraphTileMinWidth >= 140, "owner reports secondary graph tiles must not regress to narrow four-column mobile cells");
          assert.equal(layout.ownerReportSecondaryGraphLabelOverflow, 0, "owner reports graph labels must not be clipped on mobile");
          assert.equal(layout.ownerReportSecondaryGraphOverflow, 0, "owner reports secondary graph grid must not require horizontal scrolling");
          assert.equal(layout.ownerReportSecondaryGraphToggleCount, 1, "owner reports secondary graph must expose a compact more button");
          assert.equal(layout.ownerReportSecondaryGraphToggleText, "유지·공지", "owner reports secondary graph toggle must name hidden KPI lanes instead of a generic count");
          assert(layout.ownerReportSecondaryGraphToggleHeight >= 44, "owner reports secondary graph more button must remain tappable");
          assert.equal(layout.ownerReportTrendGraphCount, 1, "owner reports must render the compact mobile trend graph");
          assert(layout.ownerReportTrendGraphRowCount > 0, "owner reports compact trend graph must render trend rows");
          assert(layout.ownerReportTrendGraphRowCount <= 2, "owner reports mobile trend graph must show at most two recent rows by default");
          if (layout.ownerReportTrendGraphToggleCount > 0) {
            assert(layout.ownerReportTrendGraphToggleHeight >= 44, "owner reports trend graph toggle must keep a 44px touch height");
          }
          for (const label of ["매출", "운영량", "위험"]) {
            assert(layout.ownerReportTrendGraphText.includes(label), `owner reports compact trend graph must show ${label}`);
          }
	          assert(layout.ownerReportBranchGraphCount > 0, "owner reports must render branch operation graphs");
	          assert(layout.ownerReportBranchGraphCount <= 1, "owner reports branch operation graph must show only the priority branch by default on mobile");
	          assert.equal(
	            layout.ownerReportBranchGraphRowCount,
	            layout.ownerReportBranchGraphCount * 4,
	            "owner reports branch operation graph must render four rows per branch",
	          );
	          for (const label of ["회원", "출석", "위험", "매출"]) {
	            assert(layout.ownerReportBranchGraphText.includes(label), `owner reports branch operation graph must show ${label}`);
	          }
            assert(layout.ownerReportBranchGraphRowMaxHeight <= 24, "owner reports branch operation graph rows must stay compact");
            assert(layout.ownerReportBranchGraphMaxHeight <= 130, "owner reports branch operation graph must stay compact on mobile");
            if (layout.ownerReportBranchGraphToggleCount > 0) {
              assert(layout.ownerReportBranchGraphToggleHeight >= 44, "owner reports branch graph toggle must keep a 44px touch height");
            }
            assert(layout.ownerActionQueueItemCount <= 1, "owner reports action queue must show only the top priority item by default");
            assert(layout.ownerActionQueueItemMaxHeight <= 52, "owner reports action queue rows must stay single-scan compact");
            assert(layout.ownerActionQueueHeight <= 125, "owner reports action queue must stay compact on mobile");
            if (layout.ownerActionQueueToggleCount > 0) {
              assert(layout.ownerActionQueueToggleHeight >= 44, "owner reports action queue toggle must keep a 44px touch height");
            }
            assert(layout.ownerReportPriorityBranchRowCount <= 1, "owner reports priority branch list must show only one branch by default");
            assert(layout.ownerReportPriorityBranchRowMaxHeight <= 64, "owner reports priority branch row must stay compact");
            if (layout.ownerReportPriorityBranchToggleCount > 0) {
              assert(layout.ownerReportPriorityBranchToggleHeight >= 44, "owner reports priority branch toggle must keep a 44px touch height");
            }
            assert.equal(layout.ownerReportRiskPaymentListCount, 0, "owner reports risk payment detail list must stay collapsed by default");
            if (layout.ownerReportRiskPaymentSummaryCount > 0) {
              assert.equal(layout.ownerReportRiskPaymentSummaryCount, 1, "owner reports must show one compact risk payment summary");
              assert(layout.ownerReportRiskPaymentSummaryMaxHeight <= 56, "owner reports risk payment summary must stay compact");
              assert.equal(layout.ownerReportRiskPaymentToggleCount, 1, "owner reports must expose one risk payment list toggle");
              assert.equal(layout.ownerReportRiskPaymentRowCount, 0, "owner reports risk payment rows must not render before expansion");
              assert(layout.ownerReportRiskPaymentToggleHeight >= 44, "owner reports risk payment toggle must keep a 44px touch height");
            }
            assert.equal(layout.ownerReportInternalPanelCount, 0, "owner reports must not expose internal P3 operation panels in the app UI");
            assert.equal(layout.ownerReportVisibleCodeCount, 0, "owner reports must not render code-style internal operation checks in the app UI");
            assert(layout.ownerReportVisibleControlMinHeight >= 44, "owner reports visible controls must keep a 44px touch height");
        }

        let interaction =
          testCase.id === "admin-branches"
            ? await (async () => {
                const createToggle = page.locator('[data-testid="admin-branch-create-toggle"]');
                const createOpenScreenshotPath = join(outDir, "admin-branches-create-open.png");

                await createToggle.click();
                await page.waitForSelector("#admin-branch-create-form", { timeout: 10000 });
                await page.screenshot({ path: createOpenScreenshotPath, fullPage: false, caret: "initial" });

                const createOpenState = await page.evaluate(() => {
                  const panel = document.querySelector('[data-testid="admin-branch-create-panel"]');
                  const form = document.querySelector("#admin-branch-create-form");
                  const inputWidths = Array.from(document.querySelectorAll("#admin-branch-create-form input, #admin-branch-create-form select")).map(
                    (input) => Math.round(input.getBoundingClientRect().width),
                  );

                  return {
                    expandedToggleCount: Array.from(document.querySelectorAll('[data-testid="admin-branch-create-toggle"]')).filter(
                      (element) => element.getAttribute("aria-expanded") === "true",
                    ).length,
                    formCount: document.querySelectorAll("#admin-branch-create-form").length,
                    formHeight: Math.round(form?.getBoundingClientRect().height ?? 0),
                    panelHeight: Math.round(panel?.getBoundingClientRect().height ?? 0),
                    inputCount: document.querySelectorAll("#admin-branch-create-form input").length,
                    inputMaxLengths: Array.from(document.querySelectorAll("#admin-branch-create-form input")).map(
                      (input) => input.maxLength,
                    ),
                    selectCount: document.querySelectorAll("#admin-branch-create-form select").length,
                    panelWidth: Math.round(panel?.getBoundingClientRect().width ?? 0),
                    formWidth: Math.round(form?.getBoundingClientRect().width ?? 0),
                    minFieldWidth: Math.min(...inputWidths.filter((width) => width > 0)),
                    submitButtonHeight: Math.round(
                      document.querySelector("#admin-branch-create-form button")?.getBoundingClientRect().height ?? 0,
                    ),
                    submitButtonText: Array.from(document.querySelectorAll("#admin-branch-create-form button"))
                      .map((button) => button.textContent?.trim() ?? "")
                      .join(" | "),
                  };
                });
                const createOpenScreenshotSizeBytes = statSync(createOpenScreenshotPath).size;

                assert.equal(createOpenState.expandedToggleCount, 1, "admin branches create toggle must expose expanded state");
                assert.equal(createOpenState.formCount, 1, "admin branches create toggle must open one create form");
                assert.equal(createOpenState.inputCount, 2, "admin branches create form must show branch name and district inputs");
                assert.deepEqual(createOpenState.inputMaxLengths, [80, 100], "admin branches create inputs must match server length limits");
                assert.equal(createOpenState.selectCount, 1, "admin branches create form must show owner assignment select");
                assert(
                  createOpenState.panelWidth > layout.adminBranchCreatePanelWidth + 40,
                  "admin branches opened create panel must expand beyond the compact collapsed card",
                );
                assert(
                  createOpenState.formWidth >= createOpenState.panelWidth - 20,
                  "admin branches opened create form must use the expanded panel width",
                );
                assert(
                  createOpenState.panelHeight <= 160,
                  "admin branches opened create panel must stay compact as a two-row mobile form",
                );
                assert(
                  createOpenState.formHeight <= 112,
                  "admin branches opened create form must keep branch cards close on mobile",
                );
                assert(createOpenState.minFieldWidth >= 104, "admin branches opened create form fields must stay readable on narrow mobile");
                assert(createOpenState.submitButtonHeight >= 44, "admin branches create submit action must keep a 44px touch height");
                assert(createOpenState.submitButtonText.includes("생성"), "admin branches create form must expose submit action");
                assert(
                  createOpenScreenshotSizeBytes > 10_000,
                  `admin branches create form screenshot must be non-empty, got ${createOpenScreenshotSizeBytes} bytes`,
                );

                await createToggle.click();
	                await page.waitForFunction(() => document.querySelectorAll("#admin-branch-create-form").length === 0, null, {
	                  timeout: 10000,
	                });

                const settingsToggle = page.locator('[data-testid="admin-branch-settings-toggle"]').first();
                const settingsOpenScreenshotPath = join(outDir, "admin-branches-settings-open.png");

                await settingsToggle.click();
                await page.waitForSelector('[data-testid^="admin-branch-settings-form-"]', { timeout: 10000 });
                await page.screenshot({ path: settingsOpenScreenshotPath, fullPage: false, caret: "initial" });

                const settingsOpenState = await page.evaluate(() => {
                  const form = document.querySelector('[data-testid^="admin-branch-settings-form-"]');
                  const card = form?.closest('[data-testid="admin-branch-card"]');
                  const saveButton = document.querySelector('[data-testid^="admin-branch-settings-save-"]');
                  const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
                  const fieldGrid = form ? Array.from(form.children).find((child) => child.tagName === "DIV") : null;
                  const fieldControlWidths = Array.from(fieldGrid?.querySelectorAll("input, select") ?? [])
                    .map((control) => Math.round(control.getBoundingClientRect().width))
                    .filter((width) => width > 0);
                  const fieldControlHeights = Array.from(fieldGrid?.querySelectorAll("input, select") ?? [])
                    .map((control) => Math.round(control.getBoundingClientRect().height))
                    .filter((height) => height > 0);
                  const policyGrid = form?.querySelector("fieldset");
                  const policyControl = policyGrid?.querySelector("label");
                  const rect = (element) => {
                    if (!element) {
                      return null;
                    }
                    const bounds = element.getBoundingClientRect();
                    return {
                      bottom: Math.round(bounds.bottom),
                      height: Math.round(bounds.height),
                      top: Math.round(bounds.top),
                      width: Math.round(bounds.width),
                    };
                  };

                  return {
                    card: rect(card),
                    checkboxCount: form?.querySelectorAll('input[type="checkbox"]').length ?? 0,
                    detailGridCount: card?.querySelectorAll('[data-testid="admin-branch-detail-grid"]').length ?? 0,
                    fieldGrid: rect(fieldGrid),
                    fieldGridControlCount: fieldControlWidths.length,
                    fieldGridMinControlHeight: Math.min(...fieldControlHeights),
                    fieldGridMinControlWidth: Math.min(...fieldControlWidths),
                    form: rect(form),
                    formCount: document.querySelectorAll('[data-testid^="admin-branch-settings-form-"]').length,
                    inputCount: form?.querySelectorAll("input").length ?? 0,
                    textInputMaxLengths: Array.from(form?.querySelectorAll('input:not([type="checkbox"])') ?? []).map(
                      (input) => input.maxLength,
                    ),
                    policyControl: rect(policyControl),
                    policyGrid: rect(policyGrid),
                    save: rect(saveButton),
                    bottomNav: rect(bottomNav),
                    selectCount: form?.querySelectorAll("select").length ?? 0,
                    submitButtonText: saveButton?.textContent?.trim() ?? "",
                  };
                });
                const settingsOpenScreenshotSizeBytes = statSync(settingsOpenScreenshotPath).size;

                assert.equal(settingsOpenState.formCount, 1, "admin branches settings toggle must open one settings form");
                assert.equal(settingsOpenState.selectCount, 2, "admin branches settings form must show status and timezone selects");
                assert.equal(settingsOpenState.checkboxCount, 1, "admin branches settings form must remove deleted request policy toggles");
                assert.deepEqual(
                  settingsOpenState.textInputMaxLengths,
                  [80, 100, 500],
                  "admin branches settings inputs must match server length limits",
                );
                assert.equal(settingsOpenState.detailGridCount, 0, "admin branches settings form must hide repeated branch summary tiles while editing");
                assert(settingsOpenState.form.height <= 204, "admin branches settings form must stay compact after opening");
                assert(settingsOpenState.card.height <= 280, "admin branches opened card must stay compact enough for mobile");
                assert(settingsOpenState.fieldGrid.height <= 92, "admin branches settings field grid must use inline labels in two compact rows");
                assert.equal(settingsOpenState.fieldGridControlCount, 4, "admin branches settings field grid must keep four remaining branch controls");
                assert(settingsOpenState.fieldGridMinControlHeight >= 44, "admin branches settings field controls must keep a 44px touch height");
                assert(settingsOpenState.fieldGridMinControlWidth >= 100, "admin branches settings field controls must stay readable on narrow mobile");
                assert(settingsOpenState.policyControl?.height >= 44, "admin branches settings policy toggle must keep a 44px touch height");
                assert(settingsOpenState.policyGrid.height <= 48, "admin branches settings policy toggles must stay in one compact row");
                assert(settingsOpenState.save.height >= 44, "admin branches settings save action must keep a 44px touch height");
                assert(
                  settingsOpenState.save.bottom <= settingsOpenState.bottomNav.top - 8,
                  "admin branches settings save action must stay above the mobile bottom navigation",
                );
                assert(settingsOpenState.submitButtonText.includes("설정 저장"), "admin branches settings form must expose save action");
                assert(
                  settingsOpenScreenshotSizeBytes > 10_000,
                  `admin branches settings form screenshot must be non-empty, got ${settingsOpenScreenshotSizeBytes} bytes`,
                );

                return {
                  branches: {
                    createOpenScreenshotPath,
                    createOpenScreenshotSizeBytes,
                    createOpenPanelHeight: createOpenState.panelHeight,
                    createOpenFormHeight: createOpenState.formHeight,
                    createOpenPanelWidth: createOpenState.panelWidth,
                    createOpenFormWidth: createOpenState.formWidth,
                    createOpenMinFieldWidth: createOpenState.minFieldWidth,
                    createOpenInputMaxLengths: createOpenState.inputMaxLengths,
                    createOpenSubmitButtonHeight: createOpenState.submitButtonHeight,
                    settingsOpenScreenshotPath,
                    settingsOpenScreenshotSizeBytes,
                    settingsOpenCardHeight: settingsOpenState.card.height,
                    settingsOpenDetailGridCount: settingsOpenState.detailGridCount,
                    settingsOpenFieldGridHeight: settingsOpenState.fieldGrid.height,
                    settingsOpenFieldGridMinControlHeight: settingsOpenState.fieldGridMinControlHeight,
                    settingsOpenFieldGridMinControlWidth: settingsOpenState.fieldGridMinControlWidth,
                    settingsOpenFormHeight: settingsOpenState.form.height,
                    settingsOpenPolicyControlHeight: settingsOpenState.policyControl.height,
                    settingsOpenTextInputMaxLengths: settingsOpenState.textInputMaxLengths,
                    settingsOpenSaveBottom: settingsOpenState.save.bottom,
                    settingsOpenSaveHeight: settingsOpenState.save.height,
                  },
                };
              })()
            : testCase.id === "admin-users"
            ? await (async () => {
              const roleFilterResults = [];

              for (const role of ["owner", "coach", "guardian", "member"]) {
                await page.locator(`[data-testid="admin-user-role-filter-button"][data-role-filter="${role}"]`).click();
                await page.waitForFunction(
                  (selectedRole) => {
                    const rows = Array.from(document.querySelectorAll('[data-testid="admin-user-list-row"]'));

                    return rows.length > 0 && rows.every((row) => row.getAttribute("data-admin-user-role") === selectedRole);
                  },
                  role,
                  { timeout: 10000 },
                );

                const roleState = await page.evaluate((selectedRole) => {
                  const rows = Array.from(document.querySelectorAll('[data-testid="admin-user-list-row"]'));
                  const activeButtons = Array.from(document.querySelectorAll('[data-testid="admin-user-role-filter-button"]')).filter(
                    (button) => button.getAttribute("aria-pressed") === "true",
                  );

                  return {
                    activeRole: activeButtons[0]?.getAttribute("data-role-filter") ?? null,
                    rowCount: rows.length,
                    rowsOutsideRole: rows.filter((row) => row.getAttribute("data-admin-user-role") !== selectedRole).length,
                  };
                }, role);

                assert.equal(roleState.activeRole, role, `admin users ${role} role filter must expose active state`);
                assert.equal(roleState.rowsOutsideRole, 0, `admin users ${role} role filter must list only ${role} users`);
                assert(roleState.rowCount > 0, `admin users ${role} role filter must keep at least one row in seeded data`);
                roleFilterResults.push({ role, ...roleState });
              }

              const roleFilterScreenshotPath = join(outDir, "admin-users-role-filter-member.png");
              await page.screenshot({ path: roleFilterScreenshotPath, fullPage: false, caret: "initial" });
              const roleFilterScreenshotSizeBytes = statSync(roleFilterScreenshotPath).size;
              assert(
                roleFilterScreenshotSizeBytes > 10_000,
                `admin users role filter screenshot must be non-empty, got ${roleFilterScreenshotSizeBytes} bytes`,
              );

              await page.locator('[data-testid="admin-user-role-filter-reset"]').click();
              await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-user-list-row"]').length > 4, null, {
                timeout: 10000,
              });

              await page.locator("#admin-user-search").fill("검색없는사용자");
              await page.waitForSelector('[data-testid="admin-user-empty-filter-state"]', { timeout: 10000 });
	              const emptyFilterScreenshotPath = join(outDir, "admin-users-empty-filter-state.png");
	              await page.screenshot({ path: emptyFilterScreenshotPath, fullPage: false, caret: "initial" });
	              const emptyFilterState = await page.evaluate(() => ({
	                clearButtonCount: document.querySelectorAll('[data-testid="admin-user-search-clear"]').length,
	                clearButtonHeight: Math.round(
	                  document.querySelector('[data-testid="admin-user-search-clear"]')?.getBoundingClientRect().height ?? 0,
	                ),
	                clearButtonWidth: Math.round(
	                  document.querySelector('[data-testid="admin-user-search-clear"]')?.getBoundingClientRect().width ?? 0,
	                ),
	                emptyStateCount: document.querySelectorAll('[data-testid="admin-user-empty-filter-state"]').length,
	                emptyStateText: document.querySelector('[data-testid="admin-user-empty-filter-state"]')?.textContent ?? "",
	                listRowCount: document.querySelectorAll('[data-testid="admin-user-list-row"]').length,
                locationSearch: window.location.search,
                resetButtonCount: document.querySelectorAll('[data-testid="admin-user-empty-filter-reset"]').length,
              }));
              const emptyFilterScreenshotSizeBytes = statSync(emptyFilterScreenshotPath).size;

              assert.equal(emptyFilterState.listRowCount, 0, "admin users unmatched search must hide stale list rows");
	              assert.equal(emptyFilterState.emptyStateCount, 1, "admin users unmatched search must show one compact empty state");
	              assert.equal(emptyFilterState.clearButtonCount, 1, "admin users search input must expose a clear control");
	              assert(emptyFilterState.clearButtonHeight >= 44, "admin users search clear control must keep a 44px touch height");
	              assert(emptyFilterState.clearButtonWidth >= 44, "admin users search clear control must keep a 44px touch width");
	              assert.equal(emptyFilterState.resetButtonCount, 1, "admin users empty state must expose a reset action");
              assert(emptyFilterState.emptyStateText.includes("조건에 맞는 사용자가 없습니다."), "admin users empty state must use compact app copy");
              assert(emptyFilterState.locationSearch.includes("q="), "admin users search query must be reflected in the URL for refresh recovery");
              assert(
                emptyFilterScreenshotSizeBytes > 10_000,
                `admin users empty filter screenshot must be non-empty, got ${emptyFilterScreenshotSizeBytes} bytes`,
              );

              await page.locator('[data-testid="admin-user-empty-filter-reset"]').click();
              await page.waitForFunction(
                () => document.querySelectorAll('[data-testid="admin-user-list-row"]').length > 4 && window.location.search === "",
                null,
                { timeout: 10000 },
              );

              await page.locator('[data-testid="admin-user-edit-toggle-user-admin"]').click();
              await page.waitForSelector('[data-testid="admin-user-edit-form-user-admin"]', { timeout: 10000 });
              await page.waitForFunction(
                () => {
                  const form = document.querySelector('[data-testid="admin-user-edit-form-user-admin"]');
                  const header = document.querySelector("header");

                  if (!form || !header) {
                    return false;
                  }

                  const formRect = form.getBoundingClientRect();
                  const headerRect = header.getBoundingClientRect();

                  return headerRect.top <= 8 && formRect.top >= headerRect.bottom - 8 && formRect.top <= headerRect.bottom + 220;
                },
                null,
                { timeout: 10000 },
              );
              const editOpenScreenshotPath = join(outDir, "admin-users-edit-open.png");
              await page.screenshot({ path: editOpenScreenshotPath, fullPage: false, caret: "initial" });
              const editOpenState = await page.evaluate(() => {
                const actionButtons = Array.from(
                  document.querySelectorAll(
                    '[data-testid="admin-user-edit-submit-user-admin"], [data-testid="admin-user-edit-cancel-user-admin"]',
                  ),
                );
                const formRect = document.querySelector('[data-testid="admin-user-edit-form-user-admin"]')?.getBoundingClientRect();
                const headerRect = document.querySelector("header")?.getBoundingClientRect();

                return {
                  expandedEditToggleCount: Array.from(document.querySelectorAll('[data-testid^="admin-user-edit-toggle-"]')).filter(
                    (element) => element.getAttribute("aria-expanded") === "true",
                  ).length,
                  formCount: document.querySelectorAll('[data-testid="admin-user-edit-form-user-admin"]').length,
                  inputCount: document.querySelectorAll('[data-testid="admin-user-edit-form-user-admin"] input').length,
                  passwordSectionCount: document.querySelectorAll('[data-testid="admin-user-password-edit-section-user-admin"]').length,
                  passwordSectionState:
                    document.querySelector('[data-testid="admin-user-password-edit-section-user-admin"]')?.getAttribute("data-admin-user-password-edit-state") ?? "",
                  passwordSectionHeaderHeight: Math.round(
                    document.querySelector('[data-testid="admin-user-password-edit-section-user-admin"]')?.firstElementChild?.getBoundingClientRect().height ?? 0,
                  ),
                  passwordInputCount: document.querySelectorAll('[data-testid="admin-user-edit-form-user-admin"] input[type="password"]').length,
                  passwordInputMinLength: Array.from(
                    document.querySelectorAll('[data-testid="admin-user-password-input-user-admin"], [data-testid="admin-user-password-confirm-input-user-admin"]'),
                  )
                    .map((input) => input.getAttribute("minlength") ?? input.getAttribute("minLength") ?? "")
                    .join("|"),
                  passwordSectionText: document.querySelector('[data-testid="admin-user-password-edit-section-user-admin"]')?.textContent ?? "",
                  selectCount: document.querySelectorAll('[data-testid="admin-user-edit-form-user-admin"] select').length,
                  actionButtonMinHeight: Math.min(
                    ...actionButtons
                      .map((button) => Math.round(button.getBoundingClientRect().height))
                      .filter((height) => height > 0),
                  ),
                  actionBarWidth: Math.round(document.querySelector('[data-testid="admin-user-edit-action-bar-user-admin"]')?.getBoundingClientRect().width ?? 0),
                  formHeaderGap: Math.round((formRect?.top ?? 0) - (headerRect?.bottom ?? 0)),
                  formTop: Math.round(formRect?.top ?? 0),
                  formWidth: Math.round(formRect?.width ?? 0),
                  shellHeaderBottom: Math.round(headerRect?.bottom ?? 0),
                  shellHeaderTop: Math.round(headerRect?.top ?? 0),
                  submitButtonText: Array.from(document.querySelectorAll('[data-testid="admin-user-edit-form-user-admin"] button'))
                    .map((button) => button.textContent?.trim() ?? "")
                    .join(" | "),
                };
              });
              const editOpenScreenshotSizeBytes = statSync(editOpenScreenshotPath).size;

              assert.equal(editOpenState.expandedEditToggleCount, 1, "admin users edit toggle must expose aria-expanded");
              assert.equal(editOpenState.formCount, 1, "admin users edit toggle must open one edit form");
              assert(editOpenState.inputCount >= 6, "admin users edit form must expose identity, password, and reason inputs");
              assert.equal(editOpenState.passwordSectionCount, 1, "admin users edit form must show one password change section");
              assert.equal(editOpenState.passwordSectionState, "visible", "admin users password edit section must be visible in the edit form");
              assert(editOpenState.passwordSectionHeaderHeight >= 44, "admin users password edit section header must keep a 44px touch height");
              assert.equal(editOpenState.passwordInputCount, 2, "admin users edit form must expose password and confirmation inputs");
            assert.equal(editOpenState.passwordInputMinLength, "12|12", "admin users password edit inputs must require at least 12 characters");
              assert(editOpenState.passwordSectionText.includes("비밀번호 변경"), "admin users password edit section must have a clear heading");
              assert(editOpenState.passwordSectionText.includes("선택 입력"), "admin users password edit section must explain optional input");
              assert.equal(editOpenState.selectCount, 1, "admin users edit form must expose one role select");
              assert(editOpenState.actionButtonMinHeight >= 44, "admin users edit form save/cancel actions must keep a 44px touch height");
              assert(editOpenState.actionBarWidth > 0, "admin users edit form must expose a scoped action bar");
              assert(editOpenState.shellHeaderTop <= 8, "admin users edit open viewport must not leave blank space above the sticky header");
              assert(editOpenState.formTop <= editOpenState.shellHeaderBottom + 220, "admin users edit form must open near the sticky header instead of below a blank viewport");
              assert(editOpenState.formHeaderGap >= -8, "admin users edit form must not hide behind the sticky header");
              assert(
                editOpenState.actionBarWidth <= editOpenState.formWidth,
                "admin users edit form action bar must stay inside the form width instead of covering the viewport",
              );
              assert(editOpenState.submitButtonText.includes("수정 저장"), "admin users edit form must expose save action");
              assert(editOpenScreenshotSizeBytes > 10_000, `admin users edit form screenshot must be non-empty, got ${editOpenScreenshotSizeBytes} bytes`);

              const editPasswordOpenScreenshotPath = join(outDir, "admin-users-edit-password-open.png");
              const editPasswordOpenState = await page.evaluate(() => {
                const actionButtons = Array.from(
                  document.querySelectorAll(
                    '[data-testid="admin-user-edit-submit-user-admin"], [data-testid="admin-user-edit-cancel-user-admin"]',
                  ),
                );
                const actionButtonRects = actionButtons.map((button) => button.getBoundingClientRect());
                const actionBarRect = document.querySelector('[data-testid="admin-user-edit-action-bar-user-admin"]')?.getBoundingClientRect();
                const formRect = document.querySelector('[data-testid="admin-user-edit-form-user-admin"]')?.getBoundingClientRect();
                const mobileNavTop =
                  document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect().top ??
                  document.documentElement.clientHeight;
                const actionButtonMaxBottom = Math.max(0, ...actionButtonRects.map((rect) => Math.round(rect.bottom)));

                return {
                  passwordSectionCount: document.querySelectorAll('[data-testid="admin-user-password-edit-section-user-admin"]').length,
                  passwordSectionState:
                    document.querySelector('[data-testid="admin-user-password-edit-section-user-admin"]')?.getAttribute("data-admin-user-password-edit-state") ?? "",
                  passwordSectionHeaderHeight: Math.round(
                    document.querySelector('[data-testid="admin-user-password-edit-section-user-admin"]')?.firstElementChild?.getBoundingClientRect().height ?? 0,
                  ),
                  passwordInputCount: document.querySelectorAll('[data-testid="admin-user-edit-form-user-admin"] input[type="password"]').length,
                  passwordInputMinLength: Array.from(
                    document.querySelectorAll('[data-testid="admin-user-password-input-user-admin"], [data-testid="admin-user-password-confirm-input-user-admin"]'),
                  )
                    .map((input) => input.getAttribute("minlength") ?? input.getAttribute("minLength") ?? "")
                    .join("|"),
                  passwordSectionText: document.querySelector('[data-testid="admin-user-password-edit-section-user-admin"]')?.textContent ?? "",
                  actionButtonMinHeight: Math.min(...actionButtonRects.map((rect) => Math.round(rect.height)).filter((height) => height > 0)),
                  actionButtonMaxBottom,
                  actionButtonNavClearance: Math.round(mobileNavTop) - actionButtonMaxBottom,
                  actionBarWidth: Math.round(actionBarRect?.width ?? 0),
                  formWidth: Math.round(formRect?.width ?? 0),
                  mobileNavTop: Math.round(mobileNavTop),
                };
              });
              await page.screenshot({ path: editPasswordOpenScreenshotPath, fullPage: false, caret: "initial" });
              const editPasswordOpenScreenshotSizeBytes = statSync(editPasswordOpenScreenshotPath).size;

              assert.equal(editPasswordOpenState.passwordSectionCount, 1, "admin users edit form must expose one visible password change section");
              assert.equal(editPasswordOpenState.passwordSectionState, "visible", "admin users password edit section must stay visible");
              assert(editPasswordOpenState.passwordSectionHeaderHeight >= 44, "admin users password edit section header must keep a 44px touch height");
              assert.equal(editPasswordOpenState.passwordInputCount, 2, "admin users edit form must expose password and confirmation inputs");
              assert.equal(editPasswordOpenState.passwordInputMinLength, "12|12", "admin users password edit inputs must require at least 12 characters");
              assert(editPasswordOpenState.passwordSectionText.includes("비밀번호 변경"), "admin users password edit section must have a clear heading");
              assert(editPasswordOpenState.passwordSectionText.includes("선택 입력"), "admin users password edit section must explain optional input");
              assert(editPasswordOpenState.actionButtonMinHeight >= 44, "admin users password edit save/cancel actions must keep a 44px touch height");
              assert(editPasswordOpenState.actionBarWidth > 0, "admin users password edit action bar must be measurable");
              assert(
                editPasswordOpenState.actionBarWidth <= editPasswordOpenState.formWidth,
                "admin users password edit action bar must stay inside the form width",
              );
              assert(
                editPasswordOpenState.actionButtonMaxBottom <= editPasswordOpenState.mobileNavTop - 24,
                "admin users password edit save/cancel actions must stay above the mobile bottom navigation",
              );
              assert(
                editPasswordOpenScreenshotSizeBytes > 10_000,
                `admin users password edit open screenshot must be non-empty, got ${editPasswordOpenScreenshotSizeBytes} bytes`,
              );

              await page.locator('[data-testid="admin-user-edit-toggle-user-admin"]').click();
              await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-user-edit-form-user-admin"]').length === 0, null, {
                timeout: 10000,
              });

              await page.locator('[data-testid="admin-user-edit-toggle-user-owner"]').click();
              await page.waitForSelector('[data-testid="admin-user-edit-form-user-owner"]', { timeout: 10000 });
              const seedEmailEditScreenshotPath = join(outDir, "admin-users-seed-email-edit-finaljudo-kr.png");
              await page.screenshot({ path: seedEmailEditScreenshotPath, fullPage: true, caret: "initial" });
              const seedEmailEditState = await page.evaluate(() => {
                const form = document.querySelector('[data-testid="admin-user-edit-form-user-owner"]');
                const emailInput = form?.querySelector('input[type="email"]');
                const emailValue = emailInput instanceof HTMLInputElement ? emailInput.value : "";

                return {
                  formCount: document.querySelectorAll('[data-testid="admin-user-edit-form-user-owner"]').length,
                  finalJudoKrEmailInputCount: emailValue === "owner@finaljudo.kr" ? 1 : 0,
                  testDomainEmailInputCount: /\.test\b/i.test(emailValue) ? 1 : 0,
                  visibleSeedEmailInputValue: emailValue,
                };
              });
              const seedEmailEditScreenshotSizeBytes = statSync(seedEmailEditScreenshotPath).size;

              assert.equal(seedEmailEditState.formCount, 1, "admin users seed account edit form must open for visibility checks");
              assert.equal(seedEmailEditState.testDomainEmailInputCount, 0, "admin users edit form must not expose .test seed emails as editable values");
              assert.equal(seedEmailEditState.finalJudoKrEmailInputCount, 1, "admin users edit form must expose the current finaljudo.kr email as editable");
              assert.equal(
                seedEmailEditState.visibleSeedEmailInputValue,
                "owner@finaljudo.kr",
                "admin users seed account edit email value must use the current finaljudo.kr account",
              );
              assert(
                seedEmailEditScreenshotSizeBytes > 10_000,
                `admin users seed email edit screenshot must be non-empty, got ${seedEmailEditScreenshotSizeBytes} bytes`,
              );

              await page.locator('[data-testid="admin-user-edit-toggle-user-owner"]').click();
              await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-user-edit-form-user-owner"]').length === 0, null, {
                timeout: 10000,
              });

              const protectedDeleteState = await page.evaluate(() => {
                const row = document.querySelector('[data-admin-user-id="user-admin"]');

                return {
                  buttonCount: row?.querySelectorAll('[data-testid^="admin-user-delete-toggle-"]').length ?? 0,
                  protected: row?.getAttribute("data-admin-user-delete-protected") ?? "",
                  formCount: document.querySelectorAll('[data-testid="admin-user-delete-form-user-admin"]').length,
                  blockerText: row?.getAttribute("data-admin-user-delete-blockers") ?? "",
                };
              });

              assert.equal(protectedDeleteState.buttonCount, 0, "admin users protected self-delete button must be hidden");
              assert.equal(protectedDeleteState.protected, "true", "admin users protected self-delete row must stay marked for tests");
              assert.equal(protectedDeleteState.formCount, 0, "admin users protected self-delete must not open a delete form");
              assert(protectedDeleteState.blockerText.includes("현재 로그인 계정"), "admin users protected delete hint must describe self-delete protection");

              await page.locator('[data-testid="admin-user-delete-toggle-user-member"]').click();
              await page.waitForSelector('[data-testid="admin-user-delete-form-user-member"]', { timeout: 10000 });
              await page.waitForFunction(
                () => {
                  const form = document.querySelector('[data-testid="admin-user-delete-form-user-member"]');
                  const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');

                  if (!form) {
                    return false;
                  }

                  const formRect = form.getBoundingClientRect();
                  const bottomNavTop = bottomNav?.getBoundingClientRect().top ?? window.innerHeight;

                  return formRect.top >= 0 && formRect.bottom <= bottomNavTop - 4;
                },
                null,
                { timeout: 10000 },
              );
              const deleteOpenScreenshotPath = join(outDir, "admin-users-delete-open.png");
              await page.screenshot({ path: deleteOpenScreenshotPath, fullPage: false, caret: "initial" });
              const deleteOpenState = await page.evaluate(() => ({
                expandedDeleteToggleCount: Array.from(document.querySelectorAll('[data-testid^="admin-user-delete-toggle-"]')).filter(
                  (element) => element.getAttribute("aria-expanded") === "true",
                ).length,
                formCount: document.querySelectorAll('[data-testid="admin-user-delete-form-user-member"]').length,
                targetCount: document.querySelectorAll('[data-testid="admin-user-delete-target-user-member"]').length,
                targetText:
                  document.querySelector('[data-testid="admin-user-delete-target-user-member"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
                reasonInputCount: document.querySelectorAll('[data-testid="admin-user-delete-form-user-member"] input[placeholder="삭제 사유 입력"]').length,
                formBottom: Math.round(
                  document.querySelector('[data-testid="admin-user-delete-form-user-member"]')?.getBoundingClientRect().bottom ?? 0,
                ),
                mobileBottomNavTop: Math.round(document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect().top ?? window.innerHeight),
                submitButtonText: Array.from(document.querySelectorAll('[data-testid="admin-user-delete-form-user-member"] button'))
                  .map((button) => button.textContent?.trim() ?? "")
                  .join(" | "),
              }));
              const deleteOpenScreenshotSizeBytes = statSync(deleteOpenScreenshotPath).size;

              assert.equal(deleteOpenState.expandedDeleteToggleCount, 1, "admin users delete toggle must expose aria-expanded");
              assert.equal(deleteOpenState.formCount, 1, "admin users delete toggle must open one delete form");
              assert.equal(deleteOpenState.targetCount, 1, "admin users delete form must repeat the selected account identity");
              assert(
                deleteOpenState.targetText.includes("삭제 대상") && deleteOpenState.targetText.includes("최민재"),
                `admin users delete form must name the selected account; got ${deleteOpenState.targetText}`,
              );
              assert.equal(deleteOpenState.reasonInputCount, 1, "admin users delete form must require a reason");
              assert(
                deleteOpenState.formBottom <= deleteOpenState.mobileBottomNavTop - 4,
                "admin users opened delete form must scroll above the mobile bottom navigation",
              );
              assert(deleteOpenState.submitButtonText.includes("계정 삭제"), "admin users delete form must expose delete action");
              assert(
                deleteOpenScreenshotSizeBytes > 10_000,
                `admin users delete form screenshot must be non-empty, got ${deleteOpenScreenshotSizeBytes} bytes`,
              );

              await page.locator('[data-testid="admin-user-delete-toggle-user-member"]').click();
              await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-user-delete-form-user-member"]').length === 0, null, {
                timeout: 10000,
              });

              const inviteToggle = page.locator('[data-testid="admin-user-invite-toggle"]');
              const inviteOpenScreenshotPath = join(outDir, "admin-users-invite-open.png");

              await inviteToggle.click();
              await page.waitForSelector("#admin-user-invite-form", { timeout: 10000 });
              await page.screenshot({ path: inviteOpenScreenshotPath, fullPage: false, caret: "initial" });

              const inviteOpenState = await page.evaluate(() => ({
                expandedToggleCount: Array.from(document.querySelectorAll('[data-testid="admin-user-invite-toggle"]')).filter(
                  (element) => element.getAttribute("aria-expanded") === "true",
                ).length,
                formCount: document.querySelectorAll("#admin-user-invite-form").length,
                nameInputCount: document.querySelectorAll('#admin-user-invite-form input[placeholder="이름"]').length,
                phoneInputCount: document.querySelectorAll('#admin-user-invite-form input[placeholder="휴대폰 번호 입력"]').length,
                emailInputCount: document.querySelectorAll('#admin-user-invite-form input[placeholder="연락 이메일"]').length,
                roleSelectCount: document.querySelectorAll("#admin-user-invite-form select").length,
              }));
              const inviteOpenScreenshotSizeBytes = statSync(inviteOpenScreenshotPath).size;

              assert.equal(inviteOpenState.formCount, 1, "admin users invite toggle must open one invite form");
              assert.equal(inviteOpenState.nameInputCount, 1, "admin users opened invite form must show one name input");
              assert.equal(inviteOpenState.phoneInputCount, 1, "admin users opened invite form must show one phone input");
              assert.equal(inviteOpenState.emailInputCount, 1, "admin users opened invite form must show one optional email input");
              assert.equal(inviteOpenState.roleSelectCount, 1, "admin users opened invite form must show one role select");
              assert.equal(inviteOpenState.expandedToggleCount, 1, "admin users opened invite toggle must expose aria-expanded");
              assert(inviteOpenScreenshotSizeBytes > 10_000, `admin users open invite screenshot must be non-empty, got ${inviteOpenScreenshotSizeBytes} bytes`);

              await inviteToggle.click();
              await page.waitForFunction(() => document.querySelectorAll("#admin-user-invite-form").length === 0, null, {
                timeout: 10000,
              });

              const resetToggle = page.locator('[data-testid^="admin-user-password-reset-toggle-"]').first();
              const resetOpenScreenshotPath = join(outDir, "admin-users-password-reset-open.png");

              await resetToggle.click();
              await page.waitForSelector('form[id^="admin-user-password-reset-"]', { timeout: 10000 });
              await page.screenshot({ path: resetOpenScreenshotPath, fullPage: false, caret: "initial" });

              const resetOpenState = await page.evaluate(() => ({
                expandedToggleCount: Array.from(document.querySelectorAll('[data-testid^="admin-user-password-reset-toggle-"]')).filter(
                  (element) => element.getAttribute("aria-expanded") === "true",
                ).length,
                formCount: document.querySelectorAll('form[id^="admin-user-password-reset-"]').length,
                inputCount: document.querySelectorAll('form[id^="admin-user-password-reset-"] input[placeholder="재발급 사유 입력"]').length,
              }));
              const resetOpenScreenshotSizeBytes = statSync(resetOpenScreenshotPath).size;

              assert.equal(resetOpenState.formCount, 1, "admin users password reset toggle must open one form");
              assert.equal(resetOpenState.inputCount, 1, "admin users opened password reset form must show one reason input");
              assert.equal(resetOpenState.expandedToggleCount, 1, "admin users opened password reset toggle must expose aria-expanded");
              assert(resetOpenScreenshotSizeBytes > 10_000, `admin users open password reset screenshot must be non-empty, got ${resetOpenScreenshotSizeBytes} bytes`);

              await resetToggle.click();
              await page.waitForFunction(() => document.querySelectorAll('form[id^="admin-user-password-reset-"]').length === 0, null, {
                timeout: 10000,
              });

              const editHashDeepLinkUrl = `${baseUrl}/login?role=admin&autoLogin=1&next=${encodeURIComponent("/app/admin/users#edit-user-owner")}`;
              const editHashDeepLinkScreenshotPath = join(outDir, "admin-users-edit-hash-deeplink.png");
              await page.goto(editHashDeepLinkUrl, { waitUntil: "domcontentloaded" });
              await page.waitForSelector('[data-testid="admin-user-edit-form-user-owner"]', { timeout: 10000 });
              await page.waitForFunction(
                () => {
                  const form = document.querySelector('[data-testid="admin-user-edit-form-user-owner"]');
                  const header = document.querySelector("header");

                  if (!form || !header) {
                    return false;
                  }

                  const formRect = form.getBoundingClientRect();
                  const headerRect = header.getBoundingClientRect();

                  return headerRect.top <= 8 && formRect.top >= headerRect.bottom - 8 && formRect.top <= headerRect.bottom + 220;
                },
                null,
                { timeout: 10000 },
              );
              await page.screenshot({ path: editHashDeepLinkScreenshotPath, fullPage: false, caret: "initial" });
              const editHashDeepLinkState = await page.evaluate(() => {
                const form = document.querySelector('[data-testid="admin-user-edit-form-user-owner"]');
                const emailInput = form?.querySelector('input[type="email"]');
                const emailValue = emailInput instanceof HTMLInputElement ? emailInput.value : "";
                const formRect = form?.getBoundingClientRect();
                const headerRect = document.querySelector("header")?.getBoundingClientRect();

	                return {
	                  formCount: document.querySelectorAll('[data-testid="admin-user-edit-form-user-owner"]').length,
	                  passwordSectionCount: document.querySelectorAll('[data-testid="admin-user-password-edit-section-user-owner"]').length,
	                  passwordInputCount: document.querySelectorAll('[data-testid="admin-user-edit-form-user-owner"] input[type="password"]').length,
	                  passwordSectionText: document.querySelector('[data-testid="admin-user-password-edit-section-user-owner"]')?.textContent ?? "",
	                  finalJudoKrEmailInputCount: emailValue === "owner@finaljudo.kr" ? 1 : 0,
	                  testDomainEmailInputCount: /\.test\b/i.test(emailValue) ? 1 : 0,
                    formHeaderGap: Math.round((formRect?.top ?? 0) - (headerRect?.bottom ?? 0)),
                    formTop: Math.round(formRect?.top ?? 0),
                    shellHeaderBottom: Math.round(headerRect?.bottom ?? 0),
                    shellHeaderTop: Math.round(headerRect?.top ?? 0),
	                  locationHash: window.location.hash,
	                };
	              });
              const editHashDeepLinkScreenshotSizeBytes = statSync(editHashDeepLinkScreenshotPath).size;

              assert.equal(editHashDeepLinkState.locationHash, "#edit-user-owner", "admin users edit hash deep link must preserve the target hash");
              assert.equal(editHashDeepLinkState.formCount, 1, "admin users edit hash deep link must open the owner edit form");
	              assert.equal(editHashDeepLinkState.passwordSectionCount, 1, "admin users edit hash deep link must show the password change section");
	              assert.equal(editHashDeepLinkState.passwordInputCount, 2, "admin users edit hash deep link must expose password and confirmation inputs");
	              assert(editHashDeepLinkState.passwordSectionText.includes("비밀번호 변경"), "admin users edit hash deep link must show password change copy");
	              assert.equal(editHashDeepLinkState.testDomainEmailInputCount, 0, "admin users edit hash deep link must not expose .test seed email values");
	              assert.equal(editHashDeepLinkState.finalJudoKrEmailInputCount, 1, "admin users edit hash deep link must keep the current finaljudo.kr email editable");
              assert(editHashDeepLinkState.shellHeaderTop <= 8, "admin users edit hash deep link must not leave blank space above the sticky header");
              assert(
                editHashDeepLinkState.formTop <= editHashDeepLinkState.shellHeaderBottom + 220,
                "admin users edit hash deep link must place the form near the sticky header",
              );
              assert(editHashDeepLinkState.formHeaderGap >= -8, "admin users edit hash deep link form must not hide behind the sticky header");
              assert(
                editHashDeepLinkScreenshotSizeBytes > 10_000,
                `admin users edit hash deep link screenshot must be non-empty, got ${editHashDeepLinkScreenshotSizeBytes} bytes`,
              );

              return {
	                edit: {
	                  openScreenshotPath: editOpenScreenshotPath,
	                  openScreenshotSizeBytes: editOpenScreenshotSizeBytes,
	                  passwordOpenScreenshotPath: editPasswordOpenScreenshotPath,
	                  passwordOpenScreenshotSizeBytes: editPasswordOpenScreenshotSizeBytes,
	                    seedEmailEditScreenshotPath: seedEmailEditScreenshotPath,
	                    seedEmailEditScreenshotSizeBytes: seedEmailEditScreenshotSizeBytes,
	                    seedEmailFinalJudoKrInputCount: seedEmailEditState.finalJudoKrEmailInputCount,
	                    seedEmailTestDomainInputCount: seedEmailEditState.testDomainEmailInputCount,
	                    hashDeepLinkScreenshotPath: editHashDeepLinkScreenshotPath,
	                    hashDeepLinkScreenshotSizeBytes: editHashDeepLinkScreenshotSizeBytes,
	                    hashDeepLinkFormCount: editHashDeepLinkState.formCount,
	                    hashDeepLinkPasswordSectionCount: editHashDeepLinkState.passwordSectionCount,
	                    hashDeepLinkPasswordInputCount: editHashDeepLinkState.passwordInputCount,
	                    hashDeepLinkFinalJudoKrEmailInputCount: editHashDeepLinkState.finalJudoKrEmailInputCount,
	                    hashDeepLinkTestDomainEmailInputCount: editHashDeepLinkState.testDomainEmailInputCount,
	                    hashDeepLinkFormHeaderGap: editHashDeepLinkState.formHeaderGap,
	                    hashDeepLinkFormTop: editHashDeepLinkState.formTop,
	                    hashDeepLinkShellHeaderBottom: editHashDeepLinkState.shellHeaderBottom,
	                    hashDeepLinkShellHeaderTop: editHashDeepLinkState.shellHeaderTop,
	                    hashDeepLinkLocationHash: editHashDeepLinkState.locationHash,
	                  ...editOpenState,
	                  ...editPasswordOpenState,
	                },
                roleFilters: {
                  openScreenshotPath: roleFilterScreenshotPath,
                  openScreenshotSizeBytes: roleFilterScreenshotSizeBytes,
                  results: roleFilterResults,
                },
                emptyFilter: {
                  screenshotPath: emptyFilterScreenshotPath,
                  screenshotSizeBytes: emptyFilterScreenshotSizeBytes,
                  ...emptyFilterState,
                },
                invite: {
                  openScreenshotPath: inviteOpenScreenshotPath,
                  openScreenshotSizeBytes: inviteOpenScreenshotSizeBytes,
                  ...inviteOpenState,
                },
                passwordReset: {
                  openScreenshotPath: resetOpenScreenshotPath,
                  openScreenshotSizeBytes: resetOpenScreenshotSizeBytes,
                  ...resetOpenState,
                },
              };
            })()
            : testCase.id === "admin-settings"
              ? await (async () => {
                  const readinessToggle = page.locator('[data-testid="admin-settings-readiness-editor-toggle"]');
                  const operationToggle = page.locator('[data-testid="admin-settings-operation-log-toggle"]');
                  const incidentCreateToggle = page.locator('[data-testid="admin-settings-incident-create-toggle"]');
                  const incidentEditorToggle = page.locator('[data-testid="admin-settings-incident-editor-toggle"]').first();

                  await readinessToggle.click();
                  await page.waitForSelector('[data-testid="admin-settings-readiness-editor-list"]', { timeout: 10000 });
                  const readinessOpenScreenshotPath = join(outDir, "admin-settings-readiness-editor-open.png");
                  await page.screenshot({ path: readinessOpenScreenshotPath, fullPage: false, caret: "initial" });
                  const readinessOpenState = await page.evaluate(() => ({
                    expandedToggleCount: Array.from(document.querySelectorAll('[data-testid="admin-settings-readiness-editor-toggle"]')).filter(
                      (element) => element.getAttribute("aria-expanded") === "true",
                    ).length,
                    formCount: document.querySelectorAll('[data-testid="admin-settings-readiness-editor-list"]').length,
                    inputMaxLengths: Array.from(
                      document.querySelectorAll('[data-testid="admin-settings-readiness-editor-list"] input[maxlength]'),
                    ).map((input) => input.maxLength),
                    selectCount: document.querySelectorAll('[data-testid="admin-settings-readiness-editor-list"] select').length,
                    text: document.querySelector('[aria-labelledby="pilot-readiness-heading"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
                    textareaCount: document.querySelectorAll('[data-testid="admin-settings-readiness-editor-list"] textarea').length,
                    textareaMaxLengths: Array.from(
                      document.querySelectorAll('[data-testid="admin-settings-readiness-editor-list"] textarea[maxlength]'),
                    ).map((textarea) => textarea.maxLength),
                    submitButtonText: Array.from(document.querySelectorAll('[data-testid="admin-settings-readiness-editor-list"] button'))
                      .map((button) => button.textContent?.trim() ?? "")
                      .join(" | "),
                  }));
                  const readinessOpenScreenshotSizeBytes = statSync(readinessOpenScreenshotPath).size;
                  const readinessOpenForbiddenHits = readinessOpenState.text
                    .split(/\s*[•·|]\s*|\n/)
                    .map((line) => line.trim())
                    .filter((line) => line && blockedVisibleCopyPattern.test(line));

                  assert.equal(readinessOpenState.expandedToggleCount, 1, "admin settings readiness edit toggle must expose expanded state");
                  assert(readinessOpenState.formCount > 0, "admin settings readiness edit toggle must open readiness controls");
                  assert(readinessOpenState.selectCount > 0, "admin settings readiness editor must expose status selects");
                  assert(readinessOpenState.textareaCount > 0, "admin settings readiness editor must expose memo textareas");
                  assert(
                    readinessOpenState.inputMaxLengths.every((maxLength) => maxLength === 80),
                    "admin settings readiness owner inputs must enforce the shared 80 character limit",
                  );
                  assert(
                    readinessOpenState.textareaMaxLengths.every((maxLength) => maxLength === 1_000),
                    "admin settings readiness evidence inputs must enforce the shared 1000 character limit",
                  );
                  assert(readinessOpenState.submitButtonText.includes("점검 상태 저장"), "admin settings readiness editor must expose save actions");
                  assert.equal(
                    readinessOpenForbiddenHits.length,
                    0,
                    `admin settings readiness editor must not expose internal release/readiness copy: ${readinessOpenForbiddenHits.join(" | ")}`,
                  );
                  assert(
                    readinessOpenScreenshotSizeBytes > 10_000,
                    `admin settings readiness editor screenshot must be non-empty, got ${readinessOpenScreenshotSizeBytes} bytes`,
                  );
                  await readinessToggle.click();
                  await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-settings-readiness-editor-list"]').length === 0, null, {
                    timeout: 10000,
                  });

                  await operationToggle.click();
                  await page.waitForSelector('[data-testid="admin-settings-operation-log-form"]', { timeout: 10000 });
                  const operationOpenScreenshotPath = join(outDir, "admin-settings-operation-log-open.png");
                  await page.screenshot({ path: operationOpenScreenshotPath, fullPage: false, caret: "initial" });
                  const operationOpenState = await page.evaluate(() => ({
                    expandedToggleCount: Array.from(document.querySelectorAll('[data-testid="admin-settings-operation-log-toggle"]')).filter(
                      (element) => element.getAttribute("aria-expanded") === "true",
                    ).length,
                    formCount: document.querySelectorAll('[data-testid="admin-settings-operation-log-form"]').length,
                    inputCount: document.querySelectorAll('[data-testid="admin-settings-operation-log-form"] input').length,
                    inputMaxLengths: Array.from(
                      document.querySelectorAll('[data-testid="admin-settings-operation-log-form"] input[maxlength]'),
                    ).map((input) => input.maxLength),
                    selectCount: document.querySelectorAll('[data-testid="admin-settings-operation-log-form"] select').length,
                    textareaCount: document.querySelectorAll('[data-testid="admin-settings-operation-log-form"] textarea').length,
                    textareaMaxLengths: Array.from(
                      document.querySelectorAll('[data-testid="admin-settings-operation-log-form"] textarea[maxlength]'),
                    ).map((textarea) => textarea.maxLength),
                    submitButtonText: Array.from(document.querySelectorAll('[data-testid="admin-settings-operation-log-form"] button'))
                      .map((button) => button.textContent?.trim() ?? "")
                      .join(" | "),
                  }));
                  const operationOpenScreenshotSizeBytes = statSync(operationOpenScreenshotPath).size;

                  assert.equal(operationOpenState.expandedToggleCount, 1, "admin settings operation log toggle must expose expanded state");
                  assert.equal(operationOpenState.formCount, 1, "admin settings operation log toggle must open one form");
                  assert(operationOpenState.inputCount >= 8, "admin settings operation log form must expose date/count/evidence inputs");
                  assert(operationOpenState.selectCount >= 2, "admin settings operation log form must expose branch and status selects");
                  assert(operationOpenState.textareaCount >= 2, "admin settings operation log form must expose memo textareas");
                  assert.deepEqual(
                    [...operationOpenState.inputMaxLengths].sort((left, right) => left - right),
                    [80, 500],
                    "admin settings operation owner and mobile evidence inputs must enforce shared limits",
                  );
                  assert.deepEqual(
                    operationOpenState.textareaMaxLengths,
                    [1_000, 1_000],
                    "admin settings operation memo inputs must enforce shared limits",
                  );
                  assert(operationOpenState.submitButtonText.includes("운영 기록 저장"), "admin settings operation record form must expose save action");
                  assert(
                    operationOpenScreenshotSizeBytes > 10_000,
                    `admin settings operation log screenshot must be non-empty, got ${operationOpenScreenshotSizeBytes} bytes`,
                  );
                  await operationToggle.click();
                  await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-settings-operation-log-form"]').length === 0, null, {
                    timeout: 10000,
                  });

                  await incidentCreateToggle.click();
                  await page.waitForSelector('[data-testid="admin-settings-incident-create-form"]', { timeout: 10000 });
                  const incidentCreateOpenScreenshotPath = join(outDir, "admin-settings-incident-create-open.png");
                  await page.screenshot({ path: incidentCreateOpenScreenshotPath, fullPage: false, caret: "initial" });
                  const incidentCreateOpenState = await page.evaluate(() => ({
                    expandedToggleCount: Array.from(document.querySelectorAll('[data-testid="admin-settings-incident-create-toggle"]')).filter(
                      (element) => element.getAttribute("aria-expanded") === "true",
                    ).length,
                    formCount: document.querySelectorAll('[data-testid="admin-settings-incident-create-form"]').length,
                    inputCount: document.querySelectorAll('[data-testid="admin-settings-incident-create-form"] input').length,
                    inputMaxLengths: Array.from(
                      document.querySelectorAll('[data-testid="admin-settings-incident-create-form"] input[maxlength]'),
                    ).map((input) => input.maxLength),
                    selectCount: document.querySelectorAll('[data-testid="admin-settings-incident-create-form"] select').length,
                    textareaCount: document.querySelectorAll('[data-testid="admin-settings-incident-create-form"] textarea').length,
                    textareaMaxLengths: Array.from(
                      document.querySelectorAll('[data-testid="admin-settings-incident-create-form"] textarea[maxlength]'),
                    ).map((textarea) => textarea.maxLength),
                    submitButtonText: Array.from(document.querySelectorAll('[data-testid="admin-settings-incident-create-form"] button'))
                      .map((button) => button.textContent?.trim() ?? "")
                      .join(" | "),
                  }));
                  const incidentCreateOpenScreenshotSizeBytes = statSync(incidentCreateOpenScreenshotPath).size;

                  assert.equal(incidentCreateOpenState.expandedToggleCount, 1, "admin settings incident create toggle must expose expanded state");
                  assert.equal(incidentCreateOpenState.formCount, 1, "admin settings incident create toggle must open one form");
                  assert(incidentCreateOpenState.inputCount >= 3, "admin settings incident create form must expose title/screen/owner inputs");
                  assert(incidentCreateOpenState.selectCount >= 3, "admin settings incident create form must expose severity/branch/role selects");
                  assert(incidentCreateOpenState.textareaCount >= 2, "admin settings incident create form must expose detail and workaround textareas");
                  assert.deepEqual(
                    [...incidentCreateOpenState.inputMaxLengths].sort((left, right) => left - right),
                    [80, 120, 120],
                    "admin settings incident title, screen, and owner inputs must enforce shared limits",
                  );
                  assert.deepEqual(
                    incidentCreateOpenState.textareaMaxLengths,
                    [2_000, 1_000],
                    "admin settings incident detail and workaround inputs must enforce shared limits",
                  );
                  assert(incidentCreateOpenState.submitButtonText.includes("이슈 기록"), "admin settings incident create form must expose create action");
                  assert(
                    incidentCreateOpenScreenshotSizeBytes > 10_000,
                    `admin settings incident create screenshot must be non-empty, got ${incidentCreateOpenScreenshotSizeBytes} bytes`,
                  );
                  await incidentCreateToggle.click();
                  await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-settings-incident-create-form"]').length === 0, null, {
                    timeout: 10000,
                  });

                  const incidentSeedStatus = await page.evaluate(async () => {
                    const response = await fetch("/api/v1/admin/pilot-incidents", {
                      body: JSON.stringify({
                        branchId: null,
                        description: "화면 입력 제한 확인을 위한 격리 운영 기록",
                        owner: "총괄 PM",
                        role: "admin",
                        screen: "/app/admin/settings",
                        severity: "p2",
                        title: "현장 운영 확인",
                        workaround: "격리 환경에서 확인",
                      }),
                      headers: { "Content-Type": "application/json" },
                      method: "POST",
                    });

                    return response.status;
                  });
                  assert.equal(incidentSeedStatus, 200, "admin settings incident editor proof must seed one isolated incident");
                  await page.reload({ waitUntil: "domcontentloaded" });
                  await page.locator('[data-testid="admin-settings-incident-list-toggle"]').click();
                  await page.waitForSelector('[data-testid="admin-settings-incident-editor-toggle"]', { timeout: 10000 });

                  const incidentEditorToggleCount = await page.locator('[data-testid="admin-settings-incident-editor-toggle"]').count();
                  let incidentEditorOpenScreenshotPath = null;
                  let incidentEditorOpenScreenshotSizeBytes = 0;
                  let incidentEditorOpenState = null;

                  assert(incidentEditorToggleCount > 0, "admin settings incident editor proof must expose the isolated incident");
                  if (incidentEditorToggleCount > 0) {
                    await incidentEditorToggle.click();
                    await page.waitForSelector('[data-testid="admin-settings-incident-editor-form"]', { timeout: 10000 });
                    const incidentEditorForm = page.locator('[data-testid="admin-settings-incident-editor-form"]');
                    await incidentEditorForm.scrollIntoViewIfNeeded();
                    await page.evaluate(
                      () =>
                        new Promise((resolve) => {
                          requestAnimationFrame(() => requestAnimationFrame(resolve));
                        }),
                    );
                    incidentEditorOpenScreenshotPath = join(outDir, "admin-settings-incident-editor-open.png");
                    await page.screenshot({ path: incidentEditorOpenScreenshotPath, fullPage: true, caret: "initial" });
                    incidentEditorOpenState = await page.evaluate(() => ({
                      expandedToggleCount: Array.from(document.querySelectorAll('[data-testid="admin-settings-incident-editor-toggle"]')).filter(
                        (element) => element.getAttribute("aria-expanded") === "true",
                      ).length,
                      formCount: document.querySelectorAll('[data-testid="admin-settings-incident-editor-form"]').length,
                      inputCount: document.querySelectorAll('[data-testid="admin-settings-incident-editor-form"] input').length,
                      inputMaxLengths: Array.from(
                        document.querySelectorAll('[data-testid="admin-settings-incident-editor-form"] input[maxlength]'),
                      ).map((input) => input.maxLength),
                      selectCount: document.querySelectorAll('[data-testid="admin-settings-incident-editor-form"] select').length,
                      textareaCount: document.querySelectorAll('[data-testid="admin-settings-incident-editor-form"] textarea').length,
                      textareaMaxLengths: Array.from(
                        document.querySelectorAll('[data-testid="admin-settings-incident-editor-form"] textarea[maxlength]'),
                      ).map((textarea) => textarea.maxLength),
                      submitButtonText: Array.from(document.querySelectorAll('[data-testid="admin-settings-incident-editor-form"] button'))
                        .map((button) => button.textContent?.trim() ?? "")
                        .join(" | "),
                    }));
                    incidentEditorOpenScreenshotSizeBytes = statSync(incidentEditorOpenScreenshotPath).size;

                    assert.equal(incidentEditorOpenState.expandedToggleCount, 1, "admin settings incident editor toggle must expose expanded state");
                    assert.equal(incidentEditorOpenState.formCount, 1, "admin settings incident editor toggle must open one form");
                    assert.equal(incidentEditorOpenState.inputCount, 1, "admin settings incident editor must expose one owner input");
                    assert.equal(incidentEditorOpenState.selectCount, 1, "admin settings incident editor must expose one status select");
                    assert.equal(incidentEditorOpenState.textareaCount, 1, "admin settings incident editor must expose one workaround textarea");
                    assert.deepEqual(
                      incidentEditorOpenState.inputMaxLengths,
                      [80],
                      "admin settings incident editor owner input must enforce the shared limit",
                    );
                    assert.deepEqual(
                      incidentEditorOpenState.textareaMaxLengths,
                      [1_000],
                      "admin settings incident editor workaround input must enforce the shared limit",
                    );
                    assert(incidentEditorOpenState.submitButtonText.includes("이슈 상태 저장"), "admin settings incident editor must expose save action");
                    assert(
                      incidentEditorOpenScreenshotSizeBytes > 10_000,
                      `admin settings incident editor screenshot must be non-empty, got ${incidentEditorOpenScreenshotSizeBytes} bytes`,
                    );
                  }

                  return {
                    settings: {
                      incidentCreateOpenScreenshotPath,
                      incidentCreateOpenScreenshotSizeBytes,
                      incidentEditorOpenScreenshotPath,
                      incidentEditorOpenScreenshotSizeBytes,
                      operationOpenScreenshotPath,
                      operationOpenScreenshotSizeBytes,
                      readinessOpenScreenshotPath,
                      readinessOpenScreenshotSizeBytes,
                      incidentCreate: incidentCreateOpenState,
                      incidentEditor: incidentEditorOpenState,
                      operation: operationOpenState,
                readiness: readinessOpenState,
                readinessForbiddenHits: readinessOpenForbiddenHits,
                    },
                  };
                })()
            : null;

        if (testCase.id === "member-notifications" || testCase.id === "guardian-notifications") {
          interaction = {
            ...interaction,
            notificationRead: await verifyNotificationReadToneDown(page, testCase.id, layout),
          };
        }


        if (adminSettingsViewEvidence) {
          interaction = {
            ...interaction,
            settings: {
              ...interaction?.settings,
              views: adminSettingsViewEvidence,
            },
          };
        }

        results.push({
          ...testCase,
          layout,
          blockedHits,
          blockedPlaceholderHits,
          messages,
          interaction,
          screenshotPath,
          screenshotSizeBytes,
        });
      } finally {
        page.off("console", handleConsole);
        page.off("pageerror", handlePageError);
      }
    }
  } finally {
    await context.close();
    await browser.close();
    afterDevDataReset = await resetVisibleCopyDevData("after");
    afterNoticeMutationSnapshot = readNoticeMutationSnapshot();
    noticeMutationSnapshotRestored = assertNoticeMutationSnapshotRestored(
      beforeNoticeMutationSnapshot,
      afterNoticeMutationSnapshot,
    );
  }

  const report = {
    ok: true,
    baseUrl,
    viewport: "390x844",
    generatedAt: new Date().toISOString(),
    outputCleanup: {
      outDir,
      removedCount: cleanedOutputFiles.length,
      removedFiles: cleanedOutputFiles,
    },
    devDataReset: {
      before: beforeDevDataReset,
      after: afterDevDataReset,
      beforeNoticeMutationSnapshot,
      afterNoticeMutationSnapshot,
      noticeMutationSnapshotRestored,
    },
    checked: results.map(({ id, role, next, blockedHits, blockedPlaceholderHits, messages, layout, interaction, screenshotPath, screenshotSizeBytes }) => ({
      id,
      role,
      next,
      blockedHitCount: blockedHits.length,
      messageCount: messages.length,
      hasLoadingCopy: layout.hasLoadingCopy,
      finalWordmarkCount: layout.finalWordmarkCount,
      finalWordmarkLinkCount: layout.finalWordmarkLinkCount,
      finalWordmarkMinTouchHeight: layout.finalWordmarkMinTouchHeight,
      finalWordmarkVisualMinHeight: layout.finalWordmarkVisualMinHeight,
      rasterFinalLogoCount: layout.rasterFinalLogoCount,
      screenshotPath,
      screenshotSizeBytes,
      mobileAccountMenuToggleCount: layout.mobileAccountMenuToggleCount,
      mobileAccountMenuToggleHeight: layout.mobileAccountMenuToggleHeight,
      mobileHeaderHeight: layout.mobileHeaderHeight,
      mobileHeaderLogoutButtonCount: layout.mobileHeaderLogoutButtonCount,
      mobileHeaderLogoutButtonHeight: layout.mobileHeaderLogoutButtonHeight,
      appHeaderNoticeLinkCount: layout.appHeaderNoticeLinkCount,
	      appHeaderNoticeLinkHeight: layout.appHeaderNoticeLinkHeight,
	      appHeaderNoticeBadgeCount: layout.appHeaderNoticeBadgeCount,
	      appHeaderNoticeBadgeUnreadCount: layout.appHeaderNoticeBadgeUnreadCount,
      mobileBottomNavScrollerClientWidth: layout.mobileBottomNavScrollerClientWidth,
      mobileBottomNavScrollerScrollWidth: layout.mobileBottomNavScrollerScrollWidth,
      mobileBottomNavScrollerDisplay: layout.mobileBottomNavScrollerDisplay,
      mobileBottomNavGridColumnCount: layout.mobileBottomNavGridColumnCount,
      mobileBottomNavLinkCount: layout.mobileBottomNavLinkCount,
      mobileBottomNavLinkMinWidth: Number.isFinite(layout.mobileBottomNavLinkMinWidth)
        ? layout.mobileBottomNavLinkMinWidth
        : 0,
      mobileBottomNavLabels: layout.mobileBottomNavLabels,
      mobileBottomNavNoticeHref: layout.mobileBottomNavNoticeHref,
      mobileBottomNavNoticeLabel: layout.mobileBottomNavNoticeLabel,
      mobileBottomNavRouteIds: layout.mobileBottomNavRouteIds,
      mobileBottomNavActiveRouteIds: layout.mobileBottomNavActiveRouteIds,
      mobileBottomNavCurrentRouteIds: layout.mobileBottomNavCurrentRouteIds,
	      mobileBottomNavNoticeBadgeCount: layout.mobileBottomNavNoticeBadgeCount,
	      mobileBottomNavNoticeBadgeUnreadCount: layout.mobileBottomNavNoticeBadgeUnreadCount,
      mobileBottomNavRequestsBadgeCount: layout.mobileBottomNavRequestsBadgeCount,
      mobileBottomNavNoticeAriaLabel: layout.mobileBottomNavNoticeAriaLabel,
      mobileBottomNavNoticeBadgeContained: layout.mobileBottomNavNoticeBadgeContained,
      mobileBottomNavNoticeBadgePointerEvents: layout.mobileBottomNavNoticeBadgePointerEvents,
      requestNoticeInboxHeadingCount: layout.requestNoticeInboxHeadingCount,
      requestsScreenCount: layout.requestsScreenCount,
      noticesScreenCount: layout.noticesScreenCount,
      notificationsScreenCount: layout.notificationsScreenCount,
      notificationSummaryCardCount: layout.notificationSummaryCardCount,
      notificationSummaryGridCount: layout.notificationSummaryGridCount,
      notificationInboxCardCount: layout.notificationInboxCardCount,
      notificationNoticeCardCount: layout.notificationNoticeCardCount,
      notificationPaymentCardCount: layout.notificationPaymentCardCount,
      notificationKindBadgeCount: layout.notificationKindBadgeCount,
      notificationNoticeKindBadgeCount: layout.notificationNoticeKindBadgeCount,
      notificationPaymentKindBadgeCount: layout.notificationPaymentKindBadgeCount,
      notificationInboxCardMaxHeight: layout.notificationInboxCardMaxHeight,
      notificationBottomSafeAreaCount: layout.notificationBottomSafeAreaCount,
      notificationBottomActionClearanceAtScrollEnd: layout.notificationBottomActionClearanceAtScrollEnd,
      notificationBottomCardClearanceAtScrollEnd: layout.notificationBottomCardClearanceAtScrollEnd,
      notificationReadNoticeCardCount: layout.notificationReadNoticeCardCount,
      notificationReadNoticeCardToneDownCount: layout.notificationReadNoticeCardToneDownCount,
      notificationReadNoticeBadgeToneDownCount: layout.notificationReadNoticeBadgeToneDownCount,
      notificationFollowUpStateBadgeCount: layout.notificationFollowUpStateBadgeCount,
      notificationFilterButtonMinHeight: Number.isFinite(layout.notificationFilterButtonMinHeight)
        ? layout.notificationFilterButtonMinHeight
        : 0,
      notificationFilterButtonText: layout.notificationFilterButtonText,
      notificationBulkReadButtonHeight: layout.notificationBulkReadButtonHeight,
      notificationBulkReadButtonText: layout.notificationBulkReadButtonText,
      notificationBulkReadButtonAriaLabel: layout.notificationBulkReadButtonAriaLabel,
      notificationBulkReadButtonDisabled: layout.notificationBulkReadButtonDisabled,
      notificationBulkReadButtonState: layout.notificationBulkReadButtonState,
      notificationReadActionCount: layout.notificationReadActionCount,
      notificationReadActionMinHeight: layout.notificationReadActionMinHeight,
      notificationReadActionText: layout.notificationReadActionText,
      notificationReadFeedbackCount: layout.notificationReadFeedbackCount,
      notificationReadInteractionAttempted: interaction?.notificationRead?.attempted ?? false,
      notificationReadInteractionFeedbackCount: interaction?.notificationRead?.feedbackCount ?? 0,
      notificationReadInteractionFeedbackText: interaction?.notificationRead?.feedbackText ?? "",
      notificationReadInteractionInboxCardCount: interaction?.notificationRead?.inboxCardCount ?? 0,
      notificationReadInteractionBulkReadButtonDisabled: interaction?.notificationRead?.bulkReadButtonDisabled ?? false,
      notificationReadInteractionBulkReadButtonState: interaction?.notificationRead?.bulkReadButtonState ?? "",
      notificationReadInteractionBulkReadButtonText: interaction?.notificationRead?.bulkReadButtonText ?? "",
      notificationReadInteractionReadActionCount: interaction?.notificationRead?.readActionCount ?? 0,
      notificationReadInteractionReadNoticeCardCount: interaction?.notificationRead?.readNoticeCardCount ?? 0,
      notificationReadInteractionReadNoticeCardToneDownCount: interaction?.notificationRead?.readNoticeCardToneDownCount ?? 0,
      notificationReadInteractionReadNoticeBadgeToneDownCount: interaction?.notificationRead?.readNoticeBadgeToneDownCount ?? 0,
      notificationReadInteractionScreenshotPath: interaction?.notificationRead?.screenshotPath ?? null,
      notificationReadInteractionScreenshotSizeBytes: interaction?.notificationRead?.screenshotSizeBytes ?? 0,
      notificationPaymentCheckoutLinkCount: layout.notificationPaymentCheckoutLinkCount,
      notificationPaymentCheckoutLinkText: layout.notificationPaymentCheckoutLinkText,
      notificationNoticeDetailLinkCount: layout.notificationNoticeDetailLinkCount,
      notificationNoticeContentLinkCount: layout.notificationNoticeContentLinkCount,
      notificationRequestDetailLinkCount: layout.notificationRequestDetailLinkCount,
      notificationRequestDetailLinkText: layout.notificationRequestDetailLinkText,
      notificationRequestDetailActionLabels: layout.notificationRequestDetailActionLabels,
      notificationSettingsJumpHeight: layout.notificationSettingsJumpHeight,
      notificationSettingsJumpText: layout.notificationSettingsJumpText,
      notificationSettingsJumpHref: layout.notificationSettingsJumpHref,
      accountSummaryCardCount: layout.accountSummaryCardCount,
      accountSummaryGridCount: layout.accountSummaryGridCount,
      accountStatusCardCount: layout.accountStatusCardCount,
      accountActiveStatusLabelCount: layout.accountActiveStatusLabelCount,
      accountActionPanelCount: layout.accountActionPanelCount,
      accountRoleSwitchLinkCount: layout.accountRoleSwitchLinkCount,
      accountLogoutButtonCount: layout.accountLogoutButtonCount,
      accountRoleSwitchLinkHeight: layout.accountRoleSwitchLinkHeight,
      accountLogoutButtonHeight: layout.accountLogoutButtonHeight,
      accountBranchListHeadingCount: layout.accountBranchListHeadingCount,
      authFormCount: layout.authFormCount,
      authPasswordInputCount: layout.authPasswordInputCount,
      authPasswordInputMinPaddingRight: layout.authPasswordInputMinPaddingRight,
      authPasswordVisibilityToggleCount: layout.authPasswordVisibilityToggleCount,
      authPasswordVisibilityToggleMinHeight: layout.authPasswordVisibilityToggleMinHeight,
      authPasswordVisibilityToggleMinWidth: layout.authPasswordVisibilityToggleMinWidth,
      authRegisteredNoticeText: layout.authRegisteredNoticeText,
      authSignupLinkCount: layout.authSignupLinkCount,
      authSignupInvitationInputCount: layout.authSignupInvitationInputCount,
      authSelectRoleLoginLinkHeight: layout.authSelectRoleLoginLinkHeight,
      authSelectRoleProductionCopyVisible: layout.authSelectRoleProductionCopyVisible,
      authRoleShortcutButtonCount: layout.authRoleShortcutButtonCount,
      authRoleShortcutButtonMinHeight: layout.authRoleShortcutButtonMinHeight,
      authRoleShortcutButtonText: layout.authRoleShortcutButtonText,
      authSubmitButtonCount: layout.authSubmitButtonCount,
      blockedPlaceholderHitCount: blockedPlaceholderHits.length,
      adminRoleInvitePanelCount: layout.adminRoleInvitePanelCount,
      adminRoleInvitePanelHeight: layout.adminRoleInvitePanelHeight,
      adminRoleInvitePanelWidth: layout.adminRoleInvitePanelWidth,
      adminRoleInvitePanelText: layout.adminRoleInvitePanelText,
      adminBranchSummaryGridCount: layout.adminBranchSummaryGridCount,
      adminBranchSummaryGridHeight: layout.adminBranchSummaryGridHeight,
      adminBranchSummaryGridWidth: layout.adminBranchSummaryGridWidth,
      adminBranchSummaryText: layout.adminBranchSummaryText,
      adminBranchActiveSummaryText: layout.adminBranchActiveSummaryText,
      adminBranchCreateFormCount: layout.adminBranchCreateFormCount,
      adminBranchCreatePanelHeight: layout.adminBranchCreatePanelHeight,
      adminBranchCreatePanelWidth: layout.adminBranchCreatePanelWidth,
      adminBranchCreateToggleCount: layout.adminBranchCreateToggleCount,
      adminBranchCreateToggleHeight: layout.adminBranchCreateToggleHeight,
      adminBranchCreateOpenScreenshotPath: interaction?.branches?.createOpenScreenshotPath ?? null,
      adminBranchCreateOpenScreenshotSizeBytes: interaction?.branches?.createOpenScreenshotSizeBytes ?? 0,
      adminBranchCreateOpenPanelHeight: interaction?.branches?.createOpenPanelHeight ?? 0,
      adminBranchCreateOpenFormHeight: interaction?.branches?.createOpenFormHeight ?? 0,
      adminBranchCreateOpenPanelWidth: interaction?.branches?.createOpenPanelWidth ?? 0,
      adminBranchCreateOpenFormWidth: interaction?.branches?.createOpenFormWidth ?? 0,
      adminBranchCreateOpenMinFieldWidth: interaction?.branches?.createOpenMinFieldWidth ?? 0,
      adminBranchCreateOpenInputMaxLengths: interaction?.branches?.createOpenInputMaxLengths ?? [],
      adminBranchCreateOpenSubmitButtonHeight: interaction?.branches?.createOpenSubmitButtonHeight ?? 0,
      adminBranchSettingsOpenScreenshotPath: interaction?.branches?.settingsOpenScreenshotPath ?? null,
      adminBranchSettingsOpenScreenshotSizeBytes: interaction?.branches?.settingsOpenScreenshotSizeBytes ?? 0,
      adminBranchSettingsOpenCardHeight: interaction?.branches?.settingsOpenCardHeight ?? 0,
      adminBranchSettingsOpenDetailGridCount: interaction?.branches?.settingsOpenDetailGridCount ?? 0,
      adminBranchSettingsOpenFieldGridHeight: interaction?.branches?.settingsOpenFieldGridHeight ?? 0,
      adminBranchSettingsOpenFieldGridMinControlHeight: interaction?.branches?.settingsOpenFieldGridMinControlHeight ?? 0,
      adminBranchSettingsOpenFieldGridMinControlWidth: interaction?.branches?.settingsOpenFieldGridMinControlWidth ?? 0,
      adminBranchSettingsOpenFormHeight: interaction?.branches?.settingsOpenFormHeight ?? 0,
      adminBranchSettingsOpenPolicyControlHeight: interaction?.branches?.settingsOpenPolicyControlHeight ?? 0,
      adminBranchSettingsOpenTextInputMaxLengths: interaction?.branches?.settingsOpenTextInputMaxLengths ?? [],
      adminBranchSettingsOpenSaveBottom: interaction?.branches?.settingsOpenSaveBottom ?? 0,
      adminBranchSettingsOpenSaveHeight: interaction?.branches?.settingsOpenSaveHeight ?? 0,
      adminBranchCardCount: layout.adminBranchCardCount,
      adminBranchCardMaxHeight: layout.adminBranchCardMaxHeight,
      adminBranchDetailGridCount: layout.adminBranchDetailGridCount,
      adminBranchDetailGridMaxHeight: layout.adminBranchDetailGridMaxHeight,
      adminBranchActionGridCount: layout.adminBranchActionGridCount,
      adminBranchActionGridMaxHeight: layout.adminBranchActionGridMaxHeight,
      adminBranchOwnerFormCount: layout.adminBranchOwnerFormCount,
      adminBranchOwnerToggleCount: layout.adminBranchOwnerToggleCount,
      adminBranchOwnerToggleMinHeight: layout.adminBranchOwnerToggleMinHeight,
      adminBranchSettingsFormCount: layout.adminBranchSettingsFormCount,
      adminBranchSettingsToggleCount: layout.adminBranchSettingsToggleCount,
      adminBranchSettingsToggleMinHeight: layout.adminBranchSettingsToggleMinHeight,
      ownerBranchComparisonGraphCount: layout.ownerBranchComparisonGraphCount,
      ownerBranchComparisonRowCount: layout.ownerBranchComparisonRowCount,
      ownerBranchComparisonRowMaxHeight: layout.ownerBranchComparisonRowMaxHeight,
      ownerBranchComparisonRowBottomNavOverlap: layout.ownerBranchComparisonRowBottomNavOverlap,
      ownerBranchComparisonRowBottomNavClearance: layout.ownerBranchComparisonRowBottomNavClearance,
      ownerBranchComparisonCardBottomNavOverlap: layout.ownerBranchComparisonCardBottomNavOverlap,
      ownerBranchComparisonCardBottomNavClearance: layout.ownerBranchComparisonCardBottomNavClearance,
      ownerBranchMetricGridCount: layout.ownerBranchMetricGridCount,
      ownerBranchMetricGridMaxHeight: layout.ownerBranchMetricGridMaxHeight,
      ownerDashboardPeriodFilterCount: layout.ownerDashboardPeriodFilterCount,
      ownerDashboardPeriodOptionCount: layout.ownerDashboardPeriodOptionCount,
      ownerDashboardPeriodOptionText: layout.ownerDashboardPeriodOptionText,
      ownerDashboardPeriodOptionMinHeight: layout.ownerDashboardPeriodOptionMinHeight,
      ownerDashboardGraphBoardHeight: layout.ownerDashboardGraphBoardHeight,
      ownerDashboardSecondaryGraphGridCount: layout.ownerDashboardSecondaryGraphGridCount,
      ownerDashboardGraphRowCount: layout.ownerDashboardGraphRowCount,
      ownerDashboardSecondaryGraphGridHeight: layout.ownerDashboardSecondaryGraphGridHeight,
      ownerDashboardGraphLabelOverflow: layout.ownerDashboardGraphLabelOverflow,
      ownerDashboardRiskSummaryTop: layout.ownerDashboardRiskSummaryTop,
      ownerDashboardRiskSummaryBottom: layout.ownerDashboardRiskSummaryBottom,
      ownerDashboardRiskSummaryBottomNavOverlap: layout.ownerDashboardRiskSummaryBottomNavOverlap,
      ownerDashboardDetailToggleCount: layout.ownerDashboardDetailToggleCount,
      ownerDashboardDetailToggleHeight: layout.ownerDashboardDetailToggleHeight,
      ownerDashboardDetailToggleBottomNavOverlap: layout.ownerDashboardDetailToggleBottomNavOverlap,
      ownerDashboardDetailToggleBottomNavClearance: layout.ownerDashboardDetailToggleBottomNavClearance,
      ownerBranchHealthGraphCount: layout.ownerBranchHealthGraphCount,
      ownerBranchHealthGraphMaxHeight: layout.ownerBranchHealthGraphMaxHeight,
      ownerBranchHealthRowCount: layout.ownerBranchHealthRowCount,
      ownerBranchHealthRowMaxHeight: layout.ownerBranchHealthRowMaxHeight,
      ownerBranchPolicySummaryCount: layout.ownerBranchPolicySummaryCount,
      ownerBranchPolicyDetailCount: layout.ownerBranchPolicyDetailCount,
      ownerBranchPolicyToggleCount: layout.ownerBranchPolicyToggleCount,
      ownerBranchPolicyToggleMinHeight: layout.ownerBranchPolicyToggleMinHeight,
      ownerBranchActionLinkCount: layout.ownerBranchActionLinkCount,
      ownerBranchActionLinkMinHeight: layout.ownerBranchActionLinkMinHeight,
      ownerBranchActionToggleCount: layout.ownerBranchActionToggleCount,
      ownerBranchActionToggleMinHeight: layout.ownerBranchActionToggleMinHeight,
      ownerBranchBottomSafeAreaCount: layout.ownerBranchBottomSafeAreaCount,
      ownerBranchBottomSafeAreaHeight: layout.ownerBranchBottomSafeAreaHeight,
      ownerBranchActionBottomNavClearanceAtScrollEnd: layout.ownerBranchActionBottomNavClearanceAtScrollEnd,
      coachDashboardFlowGraphCount: layout.coachDashboardFlowGraphCount,
      coachDashboardFlowGraphHeight: layout.coachDashboardFlowGraphHeight,
      coachDashboardFlowRowCount: layout.coachDashboardFlowRowCount,
      coachDashboardFlowRowMaxHeight: layout.coachDashboardFlowRowMaxHeight,
      coachDashboardAllClassesLinkHeight: layout.coachDashboardAllClassesLinkHeight,
      coachDashboardClassesPanelTop: layout.coachDashboardClassesPanelTop,
      guardianLearningStageBarCount: layout.guardianLearningStageBarCount,
      guardianLearningInsightGridCount: layout.guardianLearningInsightGridCount,
      guardianLearningInsightGridHeight: layout.guardianLearningInsightGridHeight,
      guardianLearningInsightCellCount: layout.guardianLearningInsightCellCount,
      guardianLearningInsightCellMinHeight: layout.guardianLearningInsightCellMinHeight,
      guardianLearningInsightCellMaxHeight: layout.guardianLearningInsightCellMaxHeight,
      guardianLearningInsightText: layout.guardianLearningInsightText,
      guardianLearningActionStripCount: layout.guardianLearningActionStripCount,
      guardianLearningActionLinkCount: layout.guardianLearningActionLinkCount,
      guardianLearningActionLinkMinHeight: Number.isFinite(layout.guardianLearningActionLinkMinHeight)
        ? layout.guardianLearningActionLinkMinHeight
        : 0,
      guardianLearningActionHrefs: layout.guardianLearningActionHrefs,
      guardianLearningActionAriaLabels: layout.guardianLearningActionAriaLabels,
      guardianLearningActionText: layout.guardianLearningActionText,
      guardianChildSwitcherCount: layout.guardianChildSwitcherCount,
      guardianChildChipCount: layout.guardianChildChipCount,
      guardianChildChipStatusTextCount: layout.guardianChildChipStatusTextCount,
      guardianChildChipMinHeight: layout.guardianChildChipMinHeight,
      guardianChildChipMaxHeight: layout.guardianChildChipMaxHeight,
      personalAttendanceSummaryCount: layout.personalAttendanceSummaryCount,
      familyClassCardCount: layout.familyClassCardCount,
      familyClassCardMaxHeight: layout.familyClassCardMaxHeight,
      familyAttendanceChipGridCount: layout.familyAttendanceChipGridCount,
      familyAttendanceChipCount: layout.familyAttendanceChipCount,
      familyAttendanceChipMinHeight: layout.familyAttendanceChipMinHeight,
      familyAttendanceChipMaxHeight: layout.familyAttendanceChipMaxHeight,
      memberPaymentFilterChipGroupCount: layout.memberPaymentFilterChipGroupCount,
      memberPaymentFilterChipCount: layout.memberPaymentFilterChipCount,
      memberPaymentFilterChipCountLabelCount: layout.memberPaymentFilterChipCountLabelCount,
      memberPaymentFilterChipMinHeight: layout.memberPaymentFilterChipMinHeight,
      memberPaymentFilterStatusCount: layout.memberPaymentFilterStatusCount,
      memberPaymentFilterHeadingCount: layout.memberPaymentFilterHeadingCount,
      memberPaymentFilterChipGroupHeight: layout.memberPaymentFilterChipGroupHeight,
      memberPaymentFilterLargeSummaryCount: layout.memberPaymentFilterLargeSummaryCount,
      memberPaymentFilterSelectCount: layout.memberPaymentFilterSelectCount,
      memberPaymentCompactCardCount: layout.memberPaymentCompactCardCount,
      memberPaymentDateLineCount: layout.memberPaymentDateLineCount,
      memberPaymentDateLineMaxHeight: layout.memberPaymentDateLineMaxHeight,
      memberPaymentCheckoutActionCount: layout.memberPaymentCheckoutActionCount,
      memberPaymentCheckoutActionTexts: layout.memberPaymentCheckoutActionTexts,
      memberPaymentCheckoutActionMinHeight: layout.memberPaymentCheckoutActionMinHeight,
      memberPaymentCheckoutStateBadgeCount: layout.memberPaymentCheckoutStateBadgeCount,
      memberPaymentCheckoutStateBadgeMaxHeight: layout.memberPaymentCheckoutStateBadgeMaxHeight,
      memberPaymentCheckoutLinkCardCount: layout.memberPaymentCheckoutLinkCardCount,
      memberPaymentCheckoutActionInLinkCardCount: layout.memberPaymentCheckoutActionInLinkCardCount,
      memberPaymentCheckoutStateBadgeInLinkCardCount: layout.memberPaymentCheckoutStateBadgeInLinkCardCount,
      memberPaymentBlockedCheckoutLinkCardCount: layout.memberPaymentBlockedCheckoutLinkCardCount,
      memberPaymentCompactCardMaxHeight: layout.memberPaymentCompactCardMaxHeight,
      memberPaymentCompactAmountTextCount: layout.memberPaymentCompactAmountTextCount,
      memberGuardianPriorityGridCount: layout.memberGuardianPriorityGridCount,
      memberGuardianPriorityCellCount: layout.memberGuardianPriorityCellCount,
      memberGuardianPriorityHrefs: layout.memberGuardianPriorityHrefs,
      memberGuardianPriorityLabels: layout.memberGuardianPriorityLabels,
      memberGuardianPriorityDetails: layout.memberGuardianPriorityDetails,
      memberGuardianPriorityCellMinHeight: layout.memberGuardianPriorityCellMinHeight,
      memberGuardianPriorityCellMaxHeight: layout.memberGuardianPriorityCellMaxHeight,
      familyMemberSearchInputCount: layout.familyMemberSearchInputCount,
      memberStatusFilterCount: layout.memberStatusFilterCount,
      memberStatusFilterMinHeight: layout.memberStatusFilterMinHeight,
      memberEmergencyContactCallCount: layout.memberEmergencyContactCallCount,
      memberEmergencyContactCallMinHeight: layout.memberEmergencyContactCallMinHeight,
      memberEmergencyContactCallMinWidth: layout.memberEmergencyContactCallMinWidth,
      familyMemberProfileCardCount: layout.familyMemberProfileCardCount,
      familyMemberFeedbackHeadingCount: layout.familyMemberFeedbackHeadingCount,
      familyMemberFeedbackCardCount: layout.familyMemberFeedbackCardCount,
      familyMemberFeedbackVisibilityMetaCount: layout.familyMemberFeedbackVisibilityMetaCount,
      familyMemberWarningHeadingCount: layout.familyMemberWarningHeadingCount,
      familyMemberEmptyAlertCopyCount: layout.familyMemberEmptyAlertCopyCount,
      memberProfileEmptyAlertCopyCount: layout.memberProfileEmptyAlertCopyCount,
      memberProfileEmptyNoteCopyCount: layout.memberProfileEmptyNoteCopyCount,
      familyMemberAlertStripCount: layout.familyMemberAlertStripCount,
      familyMemberAlertStripMaxHeight: layout.familyMemberAlertStripMaxHeight,
      memberNoteEditorToggleCount: layout.memberNoteEditorToggleCount,
      memberNoteEditorToggleMinHeight: layout.memberNoteEditorToggleMinHeight,
      memberNoteEditorToggleBottomNavOverlapCount: layout.memberNoteEditorToggleBottomNavOverlapCount,
      memberNoteEditorCount: layout.memberNoteEditorCount,
      memberGuardianPhoneCallCount: layout.memberGuardianPhoneCallCount,
      memberGuardianPhoneCallMinHeight: layout.memberGuardianPhoneCallMinHeight,
      coachMemberProfileCardCount: layout.coachMemberProfileCardCount,
      coachVisibleMemberProfileCardCount: layout.coachVisibleMemberProfileCardCount,
      coachMemberNoticeActionMinHeight: layout.coachMemberNoticeActionMinHeight,
      coachMemberPaymentActionMinHeight: layout.coachMemberPaymentActionMinHeight,
      coachMemberListToggleCount: layout.coachMemberListToggleCount,
      coachMemberListToggleMinHeight: layout.coachMemberListToggleMinHeight,
      coachMemberListToggleText: layout.coachMemberListToggleText,
      coachMemberListToggleBottomNavOverlapCount: layout.coachMemberListToggleBottomNavOverlapCount,
      coachMemberBottomSafeAreaCount: layout.coachMemberBottomSafeAreaCount,
      coachMemberBottomSafeAreaMinHeight: layout.coachMemberBottomSafeAreaMinHeight,
      coachMemberNoteSectionCount: layout.coachMemberNoteSectionCount,
      coachMemberNoteClosedSectionCount: layout.coachMemberNoteClosedSectionCount,
      coachMemberNoteOpenSectionCount: layout.coachMemberNoteOpenSectionCount,
      coachMemberNoteSummaryCount: layout.coachMemberNoteSummaryCount,
      coachMemberNoteCardCount: layout.coachMemberNoteCardCount,
      coachMemberNoteListToggleCount: layout.coachMemberNoteListToggleCount,
      coachMemberNoteListToggleMinHeight: layout.coachMemberNoteListToggleMinHeight,
      coachMemberNoteListMaxItems: layout.coachMemberNoteListMaxItems,
      coachMemberEmptyAlertCopyCount: layout.coachMemberEmptyAlertCopyCount,
      coachMemberEmptyNoteCopyCount: layout.coachMemberEmptyNoteCopyCount,
      attendanceUncheckedFilterLabelHeight: layout.attendanceUncheckedFilterLabelHeight,
      attendanceUncheckedFilterBoxHeight: layout.attendanceUncheckedFilterBoxHeight,
      coachAttendanceControlPanelHeight: layout.coachAttendanceControlPanelHeight,
      attendanceRosterSearchInputCount: layout.attendanceRosterSearchInputCount,
      attendanceRosterSearchToggleCount: layout.attendanceRosterSearchToggleCount,
      attendanceRosterSearchToggleHeight: layout.attendanceRosterSearchToggleHeight,
      coachMobileSpeedPanelHeight: layout.coachMobileSpeedPanelHeight,
	      coachMobileSpeedActionButtonMinHeight: layout.coachMobileSpeedActionButtonMinHeight,
      coachMobileSpeedPressedStates: layout.coachMobileSpeedPressedStates,
		      coachMobileSpeedSummaryChipCount: layout.coachMobileSpeedSummaryChipCount,
		      coachMobileSpeedSummaryChipMaxHeight: layout.coachMobileSpeedSummaryChipMaxHeight,
			      coachMobileSpeedSummaryLineCount: layout.coachMobileSpeedSummaryLineCount,
			      coachMobileSpeedSummaryLineHeight: layout.coachMobileSpeedSummaryLineHeight,
		      coachMobileToolsToggleHeight: layout.coachMobileToolsToggleHeight,
		      coachMobileToolsExpanded: layout.coachMobileToolsExpanded,
		      coachMobileToolsDetailsHeight: layout.coachMobileToolsDetailsHeight,
		      coachFieldFlowPanelHeight: layout.coachFieldFlowPanelHeight,
	      coachFieldFlowCompactGridCount: layout.coachFieldFlowCompactGridCount,
	      coachFieldFlowCompactColumnCount: layout.coachFieldFlowCompactColumnCount,
	      coachFieldFlowCompactSummaryCount: layout.coachFieldFlowCompactSummaryCount,
		      attendanceStatusFilterGroupHeight: layout.attendanceStatusFilterGroupHeight,
      attendanceStatusFilterButtonCount: layout.attendanceStatusFilterButtonCount,
      attendanceStatusFilterButtonText: layout.attendanceStatusFilterButtonText,
      attendanceStatusFilterGroupOverflow: layout.attendanceStatusFilterGroupOverflow,
      attendanceStatusFilterButtonMinHeight: layout.attendanceStatusFilterButtonMinHeight,
	      coachClassCardCount: layout.coachClassCardCount,
      coachVisibleClassCardCount: layout.coachVisibleClassCardCount,
	      coachFirstClassCardTop: layout.coachFirstClassCardTop,
	      coachClassCardMaxHeight: layout.coachClassCardMaxHeight,
      coachClassAttendanceSummaryCount: layout.coachClassAttendanceSummaryCount,
      coachClassAttendanceSummaryMaxHeight: layout.coachClassAttendanceSummaryMaxHeight,
      coachClassRosterToggleCount: layout.coachClassRosterToggleCount,
      coachClassRosterLongLabelCount: layout.coachClassRosterLongLabelCount,
      coachClassRosterToggleMinHeight: layout.coachClassRosterToggleMinHeight,
      coachClassListToggleCount: layout.coachClassListToggleCount,
      coachClassListToggleMinHeight: layout.coachClassListToggleMinHeight,
      coachClassListToggleText: layout.coachClassListToggleText,
      coachClassRosterToggleBottomNavOverlapCount: layout.coachClassRosterToggleBottomNavOverlapCount,
      coachClassListToggleBottomNavOverlapCount: layout.coachClassListToggleBottomNavOverlapCount,
	      coachClassRosterOpenCount: layout.coachClassRosterOpenCount,
	      coachClassRosterClosedCount: layout.coachClassRosterClosedCount,
	      coachClassRosterClosedMaxHeight: layout.coachClassRosterClosedMaxHeight,
      attendanceHistoryPanelCount: layout.attendanceHistoryPanelCount,
      attendanceHistoryPanelHeight: layout.attendanceHistoryPanelHeight,
      attendanceHistoryState: layout.attendanceHistoryState,
      attendanceHistoryToggleHeight: layout.attendanceHistoryToggleHeight,
      attendanceHistoryDetailListCount: layout.attendanceHistoryDetailListCount,
      attendanceHistoryDetailRowCount: layout.attendanceHistoryDetailRowCount,
      attendanceHistoryText: layout.attendanceHistoryText,
	      coachClassAttendanceNoteToggleCount: layout.coachClassAttendanceNoteToggleCount,
      coachClassAttendanceNoteToggleMinHeight: layout.coachClassAttendanceNoteToggleMinHeight,
      coachClassAttendanceNoteEditorCount: layout.coachClassAttendanceNoteEditorCount,
      coachClassAttendanceNoteInputVisibleCount: layout.coachClassAttendanceNoteInputVisibleCount,
      coachClassInternalPanelCount: layout.coachClassInternalPanelCount,
      coachClassVisibleCodeCount: layout.coachClassVisibleCodeCount,
      ownerReportTrendGraphCount: layout.ownerReportTrendGraphCount,
      ownerReportTrendGraphRowCount: layout.ownerReportTrendGraphRowCount,
      ownerReportTrendGraphToggleCount: layout.ownerReportTrendGraphToggleCount,
      ownerReportTrendGraphToggleHeight: layout.ownerReportTrendGraphToggleHeight,
      ownerReportTrendSummaryGridCount: layout.ownerReportTrendSummaryGridCount,
      ownerReportTrendSummaryGridHeight: layout.ownerReportTrendSummaryGridHeight,
      ownerReportTrendSummaryRowCount: layout.ownerReportTrendSummaryRowCount,
      ownerReportTrendSummaryRowMaxHeight: layout.ownerReportTrendSummaryRowMaxHeight,
      ownerReportTrendSummaryTileMaxHeight: layout.ownerReportTrendSummaryTileMaxHeight,
      ownerReportGraphBoardHeight: layout.ownerReportGraphBoardHeight,
      ownerReportSecondaryGraphGridCount: layout.ownerReportSecondaryGraphGridCount,
      ownerReportSecondaryGraphTileCount: layout.ownerReportSecondaryGraphTileCount,
      ownerReportSecondaryGraphGridHeight: layout.ownerReportSecondaryGraphGridHeight,
      ownerReportSecondaryGraphTileMinWidth: layout.ownerReportSecondaryGraphTileMinWidth,
      ownerReportSecondaryGraphLabelOverflow: layout.ownerReportSecondaryGraphLabelOverflow,
      ownerReportSecondaryGraphOverflow: layout.ownerReportSecondaryGraphOverflow,
      ownerReportSecondaryGraphToggleCount: layout.ownerReportSecondaryGraphToggleCount,
      ownerReportSecondaryGraphToggleText: layout.ownerReportSecondaryGraphToggleText,
      ownerReportSecondaryGraphToggleHeight: layout.ownerReportSecondaryGraphToggleHeight,
      ownerReportBranchGraphCount: layout.ownerReportBranchGraphCount,
      ownerReportBranchGraphRowCount: layout.ownerReportBranchGraphRowCount,
      ownerReportBranchGraphRowMaxHeight: layout.ownerReportBranchGraphRowMaxHeight,
      ownerReportBranchGraphToggleCount: layout.ownerReportBranchGraphToggleCount,
      ownerReportBranchGraphToggleHeight: layout.ownerReportBranchGraphToggleHeight,
      ownerReportBranchGraphMaxHeight: layout.ownerReportBranchGraphMaxHeight,
      ownerActionQueueHeight: layout.ownerActionQueueHeight,
      ownerActionQueueItemCount: layout.ownerActionQueueItemCount,
      ownerActionQueueItemMaxHeight: layout.ownerActionQueueItemMaxHeight,
      ownerActionQueueToggleCount: layout.ownerActionQueueToggleCount,
      ownerActionQueueToggleHeight: layout.ownerActionQueueToggleHeight,
      ownerReportPriorityBranchRowCount: layout.ownerReportPriorityBranchRowCount,
      ownerReportPriorityBranchRowMaxHeight: layout.ownerReportPriorityBranchRowMaxHeight,
      ownerReportPriorityBranchToggleCount: layout.ownerReportPriorityBranchToggleCount,
      ownerReportPriorityBranchToggleHeight: layout.ownerReportPriorityBranchToggleHeight,
      ownerReportRiskPaymentSummaryCount: layout.ownerReportRiskPaymentSummaryCount,
      ownerReportRiskPaymentSummaryMaxHeight: layout.ownerReportRiskPaymentSummaryMaxHeight,
      ownerReportRiskPaymentListCount: layout.ownerReportRiskPaymentListCount,
      ownerReportRiskPaymentRowCount: layout.ownerReportRiskPaymentRowCount,
      ownerReportRiskPaymentToggleCount: layout.ownerReportRiskPaymentToggleCount,
      ownerReportRiskPaymentToggleHeight: layout.ownerReportRiskPaymentToggleHeight,
      ownerReportInternalPanelCount: layout.ownerReportInternalPanelCount,
      ownerReportVisibleCodeCount: layout.ownerReportVisibleCodeCount,
      ownerReportVisibleControlMinHeight: layout.ownerReportVisibleControlMinHeight,
      adminDashboardClassesLinkHeight: layout.adminDashboardClassesLinkHeight,
      adminUserSummaryGridCount: layout.adminUserSummaryGridCount,
      adminUserProtectedDeleteRowCount: layout.adminUserProtectedDeleteRowCount,
      adminUserProtectedDeleteToggleCount: layout.adminUserProtectedDeleteToggleCount,
      adminUserDisabledDeleteToggleCount: layout.adminUserDisabledDeleteToggleCount,
      adminUserEnabledDeleteToggleCount: layout.adminUserEnabledDeleteToggleCount,
      adminUserDeleteBlockerSummaryCount: layout.adminUserDeleteBlockerSummaryCount,
      adminUserDeleteBlockerSummaryText: layout.adminUserDeleteBlockerSummaryText,
      adminUserDeleteBlockerVisibleText: layout.adminUserDeleteBlockerVisibleText,
      adminUserDeleteBlockerSummaryMaxHeight: layout.adminUserDeleteBlockerSummaryMaxHeight,
      adminUserProtectedActionStackMaxHeight: layout.adminUserProtectedActionStackMaxHeight,
      adminUserInvitePanelCount: layout.adminUserInvitePanelCount,
      adminUserMemberCreateLinkHeight: layout.adminUserMemberCreateLinkHeight,
      adminUserMemberCreateLinkHref: layout.adminUserMemberCreateLinkHref,
      adminUserInviteToggleText: layout.adminUserInviteToggleText,
      adminUserInviteToggleHeight: layout.adminUserInviteToggleHeight,
      adminUserBottomNavTop: layout.adminUserBottomNavTop,
      adminUserFirstActionStackBottom: layout.adminUserFirstActionStackBottom,
      adminUserFirstActionOverlapBottomNavCount: layout.adminUserFirstActionOverlapBottomNavCount,
      adminUserMobileScopeSummaryCount: layout.adminUserMobileScopeSummaryCount,
      adminUserMobileScopeSummaryText: layout.adminUserMobileScopeSummaryText,
	      adminUserEditOpenScreenshotPath: interaction?.edit?.openScreenshotPath ?? null,
	      adminUserEditOpenScreenshotSizeBytes: interaction?.edit?.openScreenshotSizeBytes ?? 0,
	      adminUserPasswordEditOpenScreenshotPath: interaction?.edit?.passwordOpenScreenshotPath ?? null,
	      adminUserPasswordEditOpenScreenshotSizeBytes: interaction?.edit?.passwordOpenScreenshotSizeBytes ?? 0,
	      adminUserSeedEmailEditScreenshotPath: interaction?.edit?.seedEmailEditScreenshotPath ?? null,
	      adminUserSeedEmailEditScreenshotSizeBytes: interaction?.edit?.seedEmailEditScreenshotSizeBytes ?? 0,
	      adminUserSeedEmailFinalJudoKrInputCount: interaction?.edit?.seedEmailFinalJudoKrInputCount ?? 0,
	      adminUserSeedEmailTestDomainInputCount: interaction?.edit?.seedEmailTestDomainInputCount ?? 0,
	      adminUserEditHashDeepLinkScreenshotPath: interaction?.edit?.hashDeepLinkScreenshotPath ?? null,
	      adminUserEditHashDeepLinkScreenshotSizeBytes: interaction?.edit?.hashDeepLinkScreenshotSizeBytes ?? 0,
	      adminUserEditHashDeepLinkFormCount: interaction?.edit?.hashDeepLinkFormCount ?? 0,
	      adminUserEditHashDeepLinkPasswordSectionCount: interaction?.edit?.hashDeepLinkPasswordSectionCount ?? 0,
	      adminUserEditHashDeepLinkPasswordInputCount: interaction?.edit?.hashDeepLinkPasswordInputCount ?? 0,
	      adminUserEditHashDeepLinkFinalJudoKrEmailInputCount: interaction?.edit?.hashDeepLinkFinalJudoKrEmailInputCount ?? 0,
	      adminUserEditHashDeepLinkTestDomainEmailInputCount: interaction?.edit?.hashDeepLinkTestDomainEmailInputCount ?? 0,
	      adminUserEditHashDeepLinkLocationHash: interaction?.edit?.hashDeepLinkLocationHash ?? "",
	      adminUserEditPasswordToggleHeight: interaction?.edit?.passwordSectionHeaderHeight ?? 0,
	      adminUserEditActionButtonMinHeight: interaction?.edit?.actionButtonMinHeight ?? 0,
	      adminUserEditActionButtonMaxBottom: interaction?.edit?.actionButtonMaxBottom ?? 0,
	      adminUserEditActionButtonNavClearance: interaction?.edit?.actionButtonNavClearance ?? 0,
	      adminUserEditActionBarWidth: interaction?.edit?.actionBarWidth ?? 0,
	      adminUserEditFormHeaderGap: interaction?.edit?.formHeaderGap ?? 0,
	      adminUserEditFormTop: interaction?.edit?.formTop ?? 0,
	      adminUserEditFormWidth: interaction?.edit?.formWidth ?? 0,
	      adminUserEditShellHeaderBottom: interaction?.edit?.shellHeaderBottom ?? 0,
	      adminUserEditShellHeaderTop: interaction?.edit?.shellHeaderTop ?? 0,
	      adminUserMobileBottomNavTop: interaction?.edit?.mobileNavTop ?? 0,
	      adminUserEditCollapsedPasswordSectionCount: 0,
	      adminUserEditCollapsedPasswordInputCount: 0,
      adminUserEditOpenPasswordSectionCount: interaction?.edit?.passwordSectionCount ?? 0,
      adminUserEditOpenPasswordInputCount: interaction?.edit?.passwordInputCount ?? 0,
      adminUserEditOpenPasswordInputMinLength: interaction?.edit?.passwordInputMinLength ?? "",
      adminUserEditHashDeepLinkFormHeaderGap: interaction?.edit?.hashDeepLinkFormHeaderGap ?? 0,
      adminUserEditHashDeepLinkFormTop: interaction?.edit?.hashDeepLinkFormTop ?? 0,
      adminUserEditHashDeepLinkShellHeaderBottom: interaction?.edit?.hashDeepLinkShellHeaderBottom ?? 0,
      adminUserEditHashDeepLinkShellHeaderTop: interaction?.edit?.hashDeepLinkShellHeaderTop ?? 0,
      adminUserEmptyFilterScreenshotPath: interaction?.emptyFilter?.screenshotPath ?? null,
      adminUserEmptyFilterScreenshotSizeBytes: interaction?.emptyFilter?.screenshotSizeBytes ?? 0,
      adminUserEmptyFilterStateCount: interaction?.emptyFilter?.emptyStateCount ?? 0,
      adminUserEmptyFilterRowCount: interaction?.emptyFilter?.listRowCount ?? -1,
      adminUserEmptyFilterResetButtonCount: interaction?.emptyFilter?.resetButtonCount ?? 0,
      adminUserEmptyFilterClearButtonCount: interaction?.emptyFilter?.clearButtonCount ?? 0,
      adminUserEmptyFilterLocationSearch: interaction?.emptyFilter?.locationSearch ?? "",
      adminRoleSummaryGridCount: layout.adminRoleSummaryGridCount,
      adminRoleSummaryGridHeight: layout.adminRoleSummaryGridHeight,
      adminRoleInviteFormCount: layout.adminRoleInviteFormCount,
      adminRoleInviteToggleCount: layout.adminRoleInviteToggleCount,
      adminRoleInviteToggleHeight: layout.adminRoleInviteToggleHeight,
      adminRoleUserRowCount: layout.adminRoleUserRowCount,
      adminRoleActionRowCount: layout.adminRoleActionRowCount,
      adminRoleActionRowMaxWidth: layout.adminRoleActionRowMaxWidth,
      adminRoleManagementScopeVisibleCount: layout.adminRoleManagementScopeVisibleCount,
      adminRoleBranchScopeVisibleCount: layout.adminRoleBranchScopeVisibleCount,
      adminRoleEditFormCount: layout.adminRoleEditFormCount,
      adminRoleEditToggleCount: layout.adminRoleEditToggleCount,
      adminRoleEditToggleMinHeight: layout.adminRoleEditToggleMinHeight,
      adminRolePermissionSummaryCount: layout.adminRolePermissionSummaryCount,
      adminRolePermissionSummaryRowCount: layout.adminRolePermissionSummaryRowCount,
      adminRolePermissionDetailToggleCount: layout.adminRolePermissionDetailToggleCount,
      adminRolePermissionDetailToggleHeight: layout.adminRolePermissionDetailToggleHeight,
      adminRolePermissionDetailVisibleCount: layout.adminRolePermissionDetailVisibleCount,
      adminRoleProtectionSummaryCount: layout.adminRoleProtectionSummaryCount,
      adminRoleProtectionStatusCount: layout.adminRoleProtectionStatusCount,
      adminRoleProtectionCancelCount: layout.adminRoleProtectionCancelCount,
      adminRoleProtectionLongCopyPresent: layout.adminRoleProtectionLongCopyPresent,
      adminRoleRecentChangeSectionHeight: layout.adminRoleRecentChangeSectionHeight,
      adminRoleRecentChangeListCount: layout.adminRoleRecentChangeListCount,
      adminRoleRecentChangeRowCount: layout.adminRoleRecentChangeRowCount,
      adminRoleRecentChangeEmptyCount: layout.adminRoleRecentChangeEmptyCount,
      adminRoleRecentChangeToggleCount: layout.adminRoleRecentChangeToggleCount,
      adminRoleRecentChangeToggleHeight: layout.adminRoleRecentChangeToggleHeight,
      adminRoleRecentReadLogCount: layout.adminRoleRecentReadLogCount,
      adminSettingsReadinessListToggleCount: layout.adminSettingsReadinessListToggleCount,
      adminSettingsReadinessListToggleHeight: layout.adminSettingsReadinessListToggleHeight,
      adminSettingsReadinessListCount: layout.adminSettingsReadinessListCount,
      adminSettingsReadinessItemCount: layout.adminSettingsReadinessItemCount,
      adminSettingsVisibleCodeCount: layout.adminSettingsVisibleCodeCount,
      adminSettingsVisibleInternalPanelCount: layout.adminSettingsVisibleInternalPanelCount,
      adminAuditVisibleReadLogCount: layout.adminAuditVisibleReadLogCount,
      adminAuditRefreshHeight: layout.adminAuditRefreshHeight,
      adminAuditSummaryBarCount: layout.adminAuditSummaryBarCount,
      adminAuditSummaryBarHeight: layout.adminAuditSummaryBarHeight,
      adminAuditListRowCount: layout.adminAuditListRowCount,
      adminAuditListToggleCount: layout.adminAuditListToggleCount,
      adminAuditListToggleHeight: layout.adminAuditListToggleHeight,
      adminAuditBottomSafeAreaCount: layout.adminAuditBottomSafeAreaCount,
      adminAuditBottomSafeAreaHeight: layout.adminAuditBottomSafeAreaHeight,
      adminAuditListRowMaxHeight: layout.adminAuditListRowMaxHeight,
      adminAuditNoDetailRowCount: layout.adminAuditNoDetailRowCount,
      adminAuditNoDetailRowMaxHeight: layout.adminAuditNoDetailRowMaxHeight,
      adminAuditChangeDetailCount: layout.adminAuditChangeDetailCount,
      adminAuditChangeDetailToggleCount: layout.adminAuditChangeDetailToggleCount,
      adminAuditChangeDetailToggleMinHeight: layout.adminAuditChangeDetailToggleMinHeight,
      adminAuditBranchMetaVisibleCount: layout.adminAuditBranchMetaVisibleCount,
      adminAuditTargetMetaVisibleCount: layout.adminAuditTargetMetaVisibleCount,
      adminAuditMobileResultBadgeCount: layout.adminAuditMobileResultBadgeCount,
      adminAuditFilterPanelCount: layout.adminAuditFilterPanelCount,
      adminAuditFilterToggleCount: layout.adminAuditFilterToggleCount,
      adminAuditFilterToggleHeight: layout.adminAuditFilterToggleHeight,
      adminAuditFilterFieldsVisibleCount: layout.adminAuditFilterFieldsVisibleCount,
      adminAuditActiveFilterSummaryCount: layout.adminAuditActiveFilterSummaryCount,
      adminAuditActiveFilterChipCount: layout.adminAuditActiveFilterChipCount,
      adminSettingsSummaryBarCount: layout.adminSettingsSummaryBarCount,
      adminSettingsSummaryBarHeight: layout.adminSettingsSummaryBarHeight,
      adminSettingsReadinessEditorToggleCount: layout.adminSettingsReadinessEditorToggleCount,
      adminSettingsReadinessEditorFormCount: layout.adminSettingsReadinessEditorFormCount,
      adminSettingsReadinessSummaryCount: layout.adminSettingsReadinessSummaryCount,
      adminSettingsRolePolicySummaryCount: layout.adminSettingsRolePolicySummaryCount,
      adminSettingsRolePolicySummaryHeight: layout.adminSettingsRolePolicySummaryHeight,
      adminSettingsRolePolicyDetailCount: layout.adminSettingsRolePolicyDetailCount,
      adminSettingsRolePolicyToggleCount: layout.adminSettingsRolePolicyToggleCount,
      adminSettingsRolePolicyToggleHeight: layout.adminSettingsRolePolicyToggleHeight,
      adminSettingsBranchPolicySummaryCount: layout.adminSettingsBranchPolicySummaryCount,
      adminSettingsBranchPolicySummaryHeight: layout.adminSettingsBranchPolicySummaryHeight,
      adminSettingsBranchPolicyDetailCount: layout.adminSettingsBranchPolicyDetailCount,
      adminSettingsBranchPolicyToggleCount: layout.adminSettingsBranchPolicyToggleCount,
      adminSettingsBranchPolicyToggleHeight: layout.adminSettingsBranchPolicyToggleHeight,
      adminSettingsAuditPolicySummaryCount: layout.adminSettingsAuditPolicySummaryCount,
      adminSettingsAuditPolicySummaryHeight: layout.adminSettingsAuditPolicySummaryHeight,
      adminSettingsAuditPolicyDetailCount: layout.adminSettingsAuditPolicyDetailCount,
      adminSettingsAuditPolicyToggleCount: layout.adminSettingsAuditPolicyToggleCount,
      adminSettingsAuditPolicyToggleHeight: layout.adminSettingsAuditPolicyToggleHeight,
      adminSettingsServicePolicySummaryCount: layout.adminSettingsServicePolicySummaryCount,
      adminSettingsServicePolicySummaryHeight: layout.adminSettingsServicePolicySummaryHeight,
      adminSettingsServicePolicySummaryTileCount: layout.adminSettingsServicePolicySummaryTileCount,
      adminSettingsOperatorSummaryCount: layout.adminSettingsOperatorSummaryCount,
      adminSettingsOperatorSummaryTileCount: layout.adminSettingsOperatorSummaryTileCount,
      adminSettingsOperatorDetailToggleCount: layout.adminSettingsOperatorDetailToggleCount,
      adminSettingsOperatorDetailToggleHeight: layout.adminSettingsOperatorDetailToggleHeight,
      adminSettingsOperatorDetailCount: layout.adminSettingsOperatorDetailCount,
      adminSettingsOperationCompactSummaryCount: layout.adminSettingsOperationCompactSummaryCount,
      adminSettingsOperationDetailToggleCount: layout.adminSettingsOperationDetailToggleCount,
      adminSettingsOperationDetailToggleHeight: layout.adminSettingsOperationDetailToggleHeight,
      adminSettingsOperationDetailCount: layout.adminSettingsOperationDetailCount,
      adminSettingsOperationRecordListCount: layout.adminSettingsOperationRecordListCount,
      adminSettingsOperationLogToggleCount: layout.adminSettingsOperationLogToggleCount,
      adminSettingsOperationLogFormCount: layout.adminSettingsOperationLogFormCount,
      adminSettingsOperationLogSummaryCount: layout.adminSettingsOperationLogSummaryCount,
      adminSettingsOperationLogSummaryHeight: layout.adminSettingsOperationLogSummaryHeight,
      adminSettingsOperationLogSummaryText: layout.adminSettingsOperationLogSummaryText,
      adminSettingsIncidentCreateToggleCount: layout.adminSettingsIncidentCreateToggleCount,
      adminSettingsIncidentCreateFormCount: layout.adminSettingsIncidentCreateFormCount,
      adminSettingsIncidentCreateSummaryCount: layout.adminSettingsIncidentCreateSummaryCount,
      adminSettingsIncidentCreateSummaryHeight: layout.adminSettingsIncidentCreateSummaryHeight,
      adminSettingsIncidentCreateSummaryText: layout.adminSettingsIncidentCreateSummaryText,
      adminSettingsIncidentListToggleCount: layout.adminSettingsIncidentListToggleCount,
      adminSettingsIncidentListToggleHeight: layout.adminSettingsIncidentListToggleHeight,
      adminSettingsIncidentListSummaryCount: layout.adminSettingsIncidentListSummaryCount,
      adminSettingsIncidentEditorToggleCount: layout.adminSettingsIncidentEditorToggleCount,
      adminSettingsIncidentEditorFormCount: layout.adminSettingsIncidentEditorFormCount,
      adminSettingsReadinessOpenScreenshotPath: interaction?.settings?.readinessOpenScreenshotPath ?? null,
      adminSettingsReadinessOpenScreenshotSizeBytes: interaction?.settings?.readinessOpenScreenshotSizeBytes ?? 0,
      adminSettingsReadinessOpenForbiddenHitCount: interaction?.settings?.readinessForbiddenHits?.length ?? 0,
      adminSettingsReadinessOwnerMaxLengths: interaction?.settings?.readiness?.inputMaxLengths ?? [],
      adminSettingsReadinessEvidenceMaxLengths: interaction?.settings?.readiness?.textareaMaxLengths ?? [],
      adminSettingsOperationOpenScreenshotPath: interaction?.settings?.operationOpenScreenshotPath ?? null,
      adminSettingsOperationOpenScreenshotSizeBytes: interaction?.settings?.operationOpenScreenshotSizeBytes ?? 0,
      adminSettingsOperationInputMaxLengths: interaction?.settings?.operation?.inputMaxLengths ?? [],
      adminSettingsOperationMemoMaxLengths: interaction?.settings?.operation?.textareaMaxLengths ?? [],
      adminSettingsIncidentCreateOpenScreenshotPath: interaction?.settings?.incidentCreateOpenScreenshotPath ?? null,
      adminSettingsIncidentCreateOpenScreenshotSizeBytes: interaction?.settings?.incidentCreateOpenScreenshotSizeBytes ?? 0,
      adminSettingsIncidentCreateInputMaxLengths: interaction?.settings?.incidentCreate?.inputMaxLengths ?? [],
      adminSettingsIncidentCreateMemoMaxLengths: interaction?.settings?.incidentCreate?.textareaMaxLengths ?? [],
      adminSettingsIncidentEditorOpenScreenshotPath: interaction?.settings?.incidentEditorOpenScreenshotPath ?? null,
      adminSettingsIncidentEditorOpenScreenshotSizeBytes: interaction?.settings?.incidentEditorOpenScreenshotSizeBytes ?? 0,
      adminSettingsIncidentEditorInputMaxLengths: interaction?.settings?.incidentEditor?.inputMaxLengths ?? [],
      adminSettingsIncidentEditorMemoMaxLengths: interaction?.settings?.incidentEditor?.textareaMaxLengths ?? [],
      adminSettingsPolicyScreenshotPath: interaction?.settings?.views?.policyScreenshotPath ?? null,
      adminSettingsPolicyScreenshotSizeBytes: interaction?.settings?.views?.policyScreenshotSizeBytes ?? 0,
      adminSettingsPolicySelectedBeforeSwitch: interaction?.settings?.views?.beforeSwitch?.policySelected ?? null,
      adminSettingsOperationsSelectedAfterSwitch: interaction?.settings?.views?.afterSwitch?.operationsSelected ?? null,
      familyNoticeReadActionMinHeight: Number.isFinite(layout.familyNoticeReadActionMinHeight)
        ? layout.familyNoticeReadActionMinHeight
        : 0,
      familyNoticeCompactFilterBarCount: layout.familyNoticeCompactFilterBarCount,
      familyNoticeCompactFilterBarHeight: layout.familyNoticeCompactFilterBarHeight,
      familyNoticeFilterGridColumnCount: layout.familyNoticeFilterGridColumnCount,
      familyNoticeFilterButtonMinHeight: layout.familyNoticeFilterButtonMinHeight,
      familyNoticeFilterOverflow: layout.familyNoticeFilterOverflow,
      familyNoticeStatusBadgeCount: layout.familyNoticeStatusBadgeCount,
      familyNoticeCardCount: layout.familyNoticeCardCount,
      familyNoticeCardMaxHeight: layout.familyNoticeCardMaxHeight,
      familyNoticeBodyMaxHeight: layout.familyNoticeBodyMaxHeight,
      familyNoticeDetailToggleCount: layout.familyNoticeDetailToggleCount,
      familyNoticeDetailToggleMinHeight: Number.isFinite(layout.familyNoticeDetailToggleMinHeight)
        ? layout.familyNoticeDetailToggleMinHeight
        : 0,
      familyNoticeDateLineCount: layout.familyNoticeDateLineCount,
      noticeReadStateBadgeCount: layout.noticeReadStateBadgeCount,
      noticeDeliveryCompactCardCount: layout.noticeDeliveryCompactCardCount,
      noticeDeliveryReadCardCount: layout.noticeDeliveryReadCardCount,
      noticeDeliveryReadCardToneDownCount: layout.noticeDeliveryReadCardToneDownCount,
      noticeDeliveryReadBadgeToneDownCount: layout.noticeDeliveryReadBadgeToneDownCount,
      noticeDeliveryCompactCardMaxHeight: layout.noticeDeliveryCompactCardMaxHeight,
      noticeDeliveryMetaLineCount: layout.noticeDeliveryMetaLineCount,
      noticeDeliveryBodyVisibleCount: layout.noticeDeliveryBodyVisibleCount,
      noticeDeliveryBodyMaxHeight: layout.noticeDeliveryBodyMaxHeight,
      noticeDeliveryDateLineCount: layout.noticeDeliveryDateLineCount,
      noticeDeliveryActionRowCount: layout.noticeDeliveryActionRowCount,
      noticeDeliveryActionRowMaxHeight: layout.noticeDeliveryActionRowMaxHeight,
      noticeDeliveryActionButtonMaxWidth: layout.noticeDeliveryActionButtonMaxWidth,
      noticeDeliveryLongPushLabelCount: layout.noticeDeliveryLongPushLabelCount,
      familyNoticeInboxHeadingCount: layout.familyNoticeInboxHeadingCount,
      notificationPermissionButtonMinHeight: Number.isFinite(layout.notificationPermissionButtonMinHeight)
        ? layout.notificationPermissionButtonMinHeight
        : 0,
      notificationPermissionPanelHeight: layout.notificationPermissionPanelHeight,
      notificationPermissionStatusChipCount: layout.notificationPermissionStatusChipCount,
      notificationPermissionActionsColumnCount: layout.notificationPermissionActionsColumnCount,
      notificationPermissionActionsHeight: layout.notificationPermissionActionsHeight,
      notificationPermissionActionText: layout.notificationPermissionActionText,
      noticeOperationsPanelCount: layout.noticeOperationsPanelCount,
      noticeOperationsPanelHeight: layout.noticeOperationsPanelHeight,
      noticeOperationsToggleCount: layout.noticeOperationsToggleCount,
      noticeOperationsToggleHeight: layout.noticeOperationsToggleHeight,
      noticeOperationsMetricCount: layout.noticeOperationsMetricCount,
      noticeOperationsDetailCount: layout.noticeOperationsDetailCount,
      noticeActionQueueCount: layout.noticeActionQueueCount,
      noticeFollowUpBoardCount: layout.noticeFollowUpBoardCount,
      noticeExpandButtonCount: layout.noticeExpandButtonCount,
      noticeExpandButtonMinHeight: Number.isFinite(layout.noticeExpandButtonMinHeight)
        ? layout.noticeExpandButtonMinHeight
        : 0,
      noticeDeliveryReadActionMinHeight: Number.isFinite(layout.noticeDeliveryReadActionMinHeight)
        ? layout.noticeDeliveryReadActionMinHeight
        : 0,
      noticeDeliveryPushActionMinHeight: Number.isFinite(layout.noticeDeliveryPushActionMinHeight)
        ? layout.noticeDeliveryPushActionMinHeight
        : 0,
      noticeCreatePanelCount: layout.noticeCreatePanelCount,
      noticeCreateToggleCount: layout.noticeCreateToggleCount,
      noticeCreateToggleHeight: layout.noticeCreateToggleHeight,
      noticeCreateFormCount: layout.noticeCreateFormCount,
      noticeCreateControlMinHeight: Number.isFinite(layout.noticeCreateControlMinHeight)
        ? layout.noticeCreateControlMinHeight
        : 0,
      noticeCreateAudienceChipMinHeight: Number.isFinite(layout.noticeCreateAudienceChipMinHeight)
        ? layout.noticeCreateAudienceChipMinHeight
        : 0,
    })),
  };

  writeFileSync(join(outDir, "visible-app-copy-stability-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (shouldRunVisibleCopyScan()) {
  main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1);
  });
}
