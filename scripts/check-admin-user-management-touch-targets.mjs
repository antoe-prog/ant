import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir =
  process.env.ADMIN_USER_MANAGEMENT_TOUCH_TARGETS_OUT_DIR ??
  ".data/mobile-builds/ios/admin-user-management-touch-targets-20260705";
const iosSummaryPath = join(outDir, "ios-sim-summary.json");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const chromeCandidates = [
  process.env.E2E_CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
let managedAppServer = null;
let usingExistingAppServer = false;

function signalManagedAppServer(signal) {
  if (!managedAppServer || managedAppServer.exitCode !== null) {
    return;
  }

  if (process.platform !== "win32" && managedAppServer.pid) {
    try {
      process.kill(-managedAppServer.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when a process group is unavailable.
    }
  }

  managedAppServer.kill(signal);
}

function findChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate));
}

function canMutateLocalDevData() {
  const { hostname, protocol } = new URL(baseUrl);

  return protocol === "http:" && ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 1000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function canReachAppServer() {
  try {
    const response = await fetchWithTimeout(baseUrl, { method: "GET", redirect: "manual" });

    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function waitForManagedAppServer(timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await canReachAppServer()) {
      return;
    }

    if (managedAppServer?.exitCode !== null) {
      throw new Error(`Managed admin user management app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed admin user management app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "admin user management touch-target check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "admin user management touch-target check",
  });

  if (await canReachAppServer()) {
    usingExistingAppServer = true;
    return;
  }

  const target = new URL(baseUrl);
  managedAppServer = spawn(
    npmCommand,
    ["run", "dev", "--", "--webpack", "--hostname", target.hostname, "--port", target.port],
    {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  managedAppServer.stdout?.on("data", (chunk) => {
    if (process.env.ADMIN_USER_MANAGEMENT_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stdout.write(`[admin-user-management-touch-targets server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.ADMIN_USER_MANAGEMENT_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stderr.write(`[admin-user-management-touch-targets server] ${chunk}`);
    }
  });

  await waitForManagedAppServer();
}

async function stopManagedAppServer() {
  if (!managedAppServer || usingExistingAppServer) {
    return;
  }

  const closed = new Promise((resolve) => {
    managedAppServer.once("close", resolve);
  });

  signalManagedAppServer("SIGINT");

  await Promise.race([
    closed,
    sleep(5000).then(() => {
      if (managedAppServer?.exitCode === null) {
        signalManagedAppServer("SIGTERM");
      }
    }),
  ]);
}

async function resetDevData(label) {
  assert(canMutateLocalDevData(), "admin user management touch-target check only mutates local dev data");
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `admin user management touch-target ${label} reset`,
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `admin user management touch-target ${label} reset failed with ${response.status}`);

  return {
    attempted: true,
    counts: payload?.data?.counts ?? null,
    label,
    ok: response.ok,
    status: response.status,
  };
}

function collectConsoleMessages(page) {
  const messages = [];

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      const text = message.text();

      if (message.type() === "warning" && text.includes("[Fast Refresh] performing full reload")) {
        return;
      }

      messages.push(`${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });

  return messages;
}

function cleanOutputDir() {
  if (!existsSync(outDir)) {
    return [];
  }

  const removed = [];

  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const shouldRemove = (entry.name.endsWith(".png") && !entry.name.includes("-ios-sim")) || entry.name === "summary.json";

    if (!shouldRemove) {
      continue;
    }

    unlinkSync(join(outDir, entry.name));
    removed.push(entry.name);
  }

  return removed.sort();
}

function assertStaticContracts() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");
  const adminUsersScreen = readFileSync("src/components/screens/admin-users-screen.tsx", "utf8");

  assert.equal(
    packageJson.scripts?.["test:admin-user-management-touch-targets"],
    "node scripts/check-admin-user-management-touch-targets.mjs",
    "package.json must expose test:admin-user-management-touch-targets",
  );
  assert(
    releaseRunner.includes('["run", "test:admin-user-management-touch-targets"]'),
    "test:release must include admin user management touch-target proof",
  );

  for (const snippet of [
    'data-testid="admin-user-invite-field"',
    'data-admin-user-edit-control="true"',
    'data-testid={`admin-user-delete-reason-input-${user.id}`}',
    'data-testid={`admin-user-password-reset-reason-input-${user.id}`}',
    'data-testid={`admin-user-member-link-search-input-${user.id}`}',
    'data-testid={`admin-user-guardian-child-search-input-${user.id}`}',
    'data-testid={`admin-user-approved-password-dismiss-${user.id}`}',
    'data-testid={`admin-user-issued-password-dismiss-${user.id}`}',
    "maxLength={userAdministrationInputLimits.nameLength}",
    "maxLength={userAdministrationInputLimits.phoneLength}",
    "maxLength={userAdministrationInputLimits.emailLength}",
    "maxLength={userAdministrationInputLimits.passwordLength}",
    "maxLength={userAdministrationInputLimits.titleLength}",
    "maxLength={userAdministrationInputLimits.reasonLength}",
    "clearSensitivePasswordState();",
    "requestId !== sensitivePasswordRequestRef.current",
    'data-testid="admin-user-list-scroll-region"',
    'data-admin-user-list-mode={userListPanelExpanded ? "panel-open" : "browse"}',
    'userListPanelExpanded ? "max-h-none overflow-visible" : "max-h-[25dvh] overflow-y-auto overscroll-contain"',
  ]) {
    assert(adminUsersScreen.includes(snippet), `admin users screen must include ${snippet}`);
  }

  for (const forbidden of [
    'className="max-h-36 divide-y',
    'className="h-10 w-full',
    'className="inline-flex h-10',
    'className="inline-flex min-h-10',
    'className="flex min-h-10',
    'size="sm" type="submit" variant="danger"',
  ]) {
    assert(!adminUsersScreen.includes(forbidden), `admin users screen must not keep 40px controls: ${forbidden}`);
  }
}

async function gotoAdminUsers(page, extraSearch = "") {
  const next = `/app/admin/users${extraSearch}`;
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", "admin");
  loginUrl.searchParams.set("next", next);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === "/app/admin/users", { timeout: 15000 });
  await page.waitForSelector('[data-testid="admin-user-list-scroll-region"]', { timeout: 15000 });
}

async function readHeights(page, selector) {
  return page.evaluate((targetSelector) => {
    return Array.from(document.querySelectorAll(targetSelector))
      .filter((element) => {
        const rect = element.getBoundingClientRect();

        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => Math.round(element.getBoundingClientRect().height));
  }, selector);
}

function assertHeightsAtLeast(label, heights, min = 44) {
  assert(heights.length > 0, `${label} must render at least one measurable control`);

  for (const [index, height] of heights.entries()) {
    assert(height >= min, `${label} ${index + 1} must stay ${min}px tall; got ${height}px`);
  }
}

async function collectPageHealth(page) {
  return page.evaluate(() => {
    const frameworkOverlayCount =
      document.querySelectorAll("[data-nextjs-dialog]").length +
      Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0)
        .length;
    const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
    const actionBar = document.querySelector('[data-testid^="admin-user-edit-action-bar-"]');
    const navRect = nav?.getBoundingClientRect();
    const actionBarRect = actionBar?.getBoundingClientRect();

    return {
      actionBarBottomNavClearance: navRect && actionBarRect ? Math.round(navRect.top - actionBarRect.bottom) : null,
      bodyTextLength: document.body?.innerText.length ?? 0,
      clientWidth: document.documentElement.clientWidth,
      frameworkOverlayCount,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

function minMeasuredHeight(groups) {
  return Math.min(...Object.values(groups).flat().filter((height) => Number.isFinite(height)));
}

function readIosSimulatorProof() {
  if (!existsSync(iosSummaryPath)) {
    return {
      ok: false,
      reason: "ios-sim-summary-missing",
      path: iosSummaryPath,
    };
  }

  const parsed = JSON.parse(readFileSync(iosSummaryPath, "utf8"));

  return {
    ok: parsed.ok === true && parsed.noBrowserChrome === true,
    ...parsed,
  };
}

async function openFirstVisible(page, selector, waitSelector) {
  const control = page.locator(selector).first();
  await control.waitFor({ state: "visible", timeout: 15000 });
  await control.click();
  await page.waitForSelector(waitSelector, { timeout: 15000 });
}

async function captureAdminUsers(context) {
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const collapsedScreenshotPath = join(outDir, "admin-users-management-collapsed-mobile.png");
  const openScreenshotPath = join(outDir, "admin-users-management-open-mobile.png");

  try {
    await gotoAdminUsers(page);

    const collapsedLayout = {
      health: await collectPageHealth(page),
      inviteFormCount: await page.locator("#admin-user-invite-form").count(),
      inviteToggleHeights: await readHeights(page, '[data-testid="admin-user-invite-toggle"]'),
      listActionHeights: await readHeights(page, '[data-testid^="admin-user-action-stack-"] button'),
      pendingInviteActionHeights: await readHeights(page, '[data-testid^="admin-user-pending-invite-link-"]'),
      listFlow: await page.locator('[data-testid="admin-user-list-scroll-region"]').evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: window.getComputedStyle(element).overflowY,
        rowCount: element.querySelectorAll('[data-testid="admin-user-list-row"]').length,
        scrollHeight: element.scrollHeight,
        viewportHeight: window.innerHeight,
      })),
      listStatus: await page.getByTestId("admin-user-list-status-label").textContent(),
    };

    assert.equal(collapsedLayout.health.frameworkOverlayCount, 0, "admin users collapsed state must not show a framework overlay");
    assert(collapsedLayout.health.bodyTextLength > 100, "admin users collapsed state must not render a blank page");
    assert.equal(collapsedLayout.health.horizontalOverflow, 0, "admin users collapsed state must not overflow horizontally");
    assert.equal(collapsedLayout.inviteFormCount, 0, "admin user invite form must stay collapsed by default");
    assert.equal(collapsedLayout.listFlow.overflowY, "auto", "admin user list must keep a bounded mobile scroll region");
    assert(
      collapsedLayout.listFlow.clientHeight <= Math.ceil(collapsedLayout.listFlow.viewportHeight * 0.25) + 1,
      `admin user list must stay within 25dvh on mobile; got ${collapsedLayout.listFlow.clientHeight}/${collapsedLayout.listFlow.viewportHeight}px`,
    );
    assert(
      collapsedLayout.listFlow.scrollHeight >= collapsedLayout.listFlow.clientHeight,
      `admin user list scroll metrics must remain valid; got ${collapsedLayout.listFlow.clientHeight}/${collapsedLayout.listFlow.scrollHeight}px`,
    );
    const listStatusMatch = collapsedLayout.listStatus?.match(/(\d+)\/(\d+)명 표시/);
    assert(listStatusMatch, `admin user list status must expose visible/total counts; got ${collapsedLayout.listStatus}`);
    assert.equal(Number.parseInt(listStatusMatch[1], 10), collapsedLayout.listFlow.rowCount, "visible count must match rendered rows");
    assert.equal(Number.parseInt(listStatusMatch[2], 10), collapsedLayout.listFlow.rowCount, "unfiltered total must match rendered rows");
    assertHeightsAtLeast("admin user invite toggle", collapsedLayout.inviteToggleHeights);
    assertHeightsAtLeast("admin user row action controls", collapsedLayout.listActionHeights);
    if (collapsedLayout.pendingInviteActionHeights.length > 0) {
      assertHeightsAtLeast("admin user pending invitation link actions", collapsedLayout.pendingInviteActionHeights);
    }
    await page.screenshot({ fullPage: false, path: collapsedScreenshotPath });

    await page.getByTestId("admin-user-invite-toggle").click();
    await page.waitForSelector("#admin-user-invite-form", { timeout: 15000 });

    await openFirstVisible(page, '[data-testid^="admin-user-edit-toggle-"]', '[data-testid^="admin-user-edit-form-"]');
    await page.waitForSelector("[data-admin-user-edit-control='true']", { timeout: 15000 });
    await page.locator("[data-admin-user-edit-control='true']").first().fill("정유진");

    const editFormTestId = await page.locator('[data-testid^="admin-user-edit-form-"]').first().getAttribute("data-testid");
    assert(editFormTestId, "admin user edit form must expose a test id");
    const editingUserId = editFormTestId.replace("admin-user-edit-form-", "");

    await page.locator(`[data-testid="admin-user-edit-toggle-${editingUserId}"]`).click();
    await page.waitForFunction(
      (userId) => document.querySelectorAll(`[data-testid="admin-user-edit-form-${userId}"]`).length === 0,
      editingUserId,
      { timeout: 10000 },
    );

    // Reset another user's password so revoking that account's sessions cannot invalidate the admin test session.
    await openFirstVisible(
      page,
      '[data-testid^="admin-user-password-reset-toggle-"]:not([data-testid="admin-user-password-reset-toggle-user-admin"])',
      '[id^="admin-user-password-reset-"]',
    );
    await page.waitForSelector('[data-testid^="admin-user-password-reset-reason-input-"]', { timeout: 15000 });
    await page.locator('[data-testid^="admin-user-password-reset-reason-input-"]').first().fill("모바일 터치 검증");
    const passwordResetHeights = {
      passwordResetFields: await readHeights(page, '[data-testid^="admin-user-password-reset-reason-input-"]'),
      passwordResetSubmit: await readHeights(page, '[id^="admin-user-password-reset-"] button[type="submit"]'),
    };
    const passwordResetReasonMaxLength = Number(
      await page.locator('[data-testid^="admin-user-password-reset-reason-input-"]').first().getAttribute("maxlength"),
    );

    const resetFormId = await page.locator('[id^="admin-user-password-reset-"]').first().getAttribute("id");
    assert(resetFormId, "admin user password reset form must expose an id");
    const resetUserId = resetFormId.replace("admin-user-password-reset-", "");
    await page.locator(`#${resetFormId} button[type="submit"]`).click();
    const issuedPasswordDismiss = page.getByTestId(`admin-user-issued-password-dismiss-${resetUserId}`);
    await issuedPasswordDismiss.waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.getByText("새 비밀번호:", { exact: false }).count(), 1, "issued password must be shown once after reset");
    assertHeightsAtLeast(
      "admin user issued password confirmation",
      await readHeights(page, `[data-testid="admin-user-issued-password-dismiss-${resetUserId}"]`),
    );
    await issuedPasswordDismiss.click();
    await page.waitForFunction(
      (userId) =>
        document.querySelectorAll(`[data-testid="admin-user-issued-password-dismiss-${userId}"]`).length === 0 &&
        !document.body.innerText.includes("새 비밀번호:"),
      resetUserId,
      { timeout: 10000 },
    );

    await page.locator(`[data-testid="admin-user-password-reset-toggle-${resetUserId}"]`).click();
    await page.waitForSelector(`#admin-user-password-reset-${resetUserId}`, { timeout: 10000 });
    assert.equal(
      await page.getByTestId(`admin-user-issued-password-dismiss-${resetUserId}`).count(),
      0,
      "dismissed issued password must not reappear when the panel reopens",
    );
    await page.getByTestId(`admin-user-password-reset-reason-input-${resetUserId}`).fill("닫기 상태 폐기 검증");
    await page.locator(`#admin-user-password-reset-${resetUserId} button[type="submit"]`).click();
    await page.getByTestId(`admin-user-issued-password-dismiss-${resetUserId}`).waitFor({ state: "visible", timeout: 15000 });
    await page.locator(`[data-testid="admin-user-password-reset-toggle-${resetUserId}"]`).click();
    await page.waitForFunction(
      (userId) =>
        document.querySelectorAll(`#admin-user-password-reset-${userId}`).length === 0 &&
        document.querySelectorAll(`[data-testid="admin-user-issued-password-dismiss-${userId}"]`).length === 0 &&
        !document.body.innerText.includes("새 비밀번호:"),
      resetUserId,
      { timeout: 10000 },
    );

    await page.locator(`[data-testid="admin-user-password-reset-toggle-${resetUserId}"]`).click();
    await page.waitForSelector(`#admin-user-password-reset-${resetUserId}`, { timeout: 10000 });
    assert.equal(
      await page.getByTestId(`admin-user-issued-password-dismiss-${resetUserId}`).count(),
      0,
      "closed issued password must not reappear when the panel reopens",
    );
    await page.locator(`[data-testid="admin-user-password-reset-toggle-${resetUserId}"]`).click();

    const deleteToggle = page.locator('[data-testid^="admin-user-delete-toggle-"]').first();
    let deleteHeights = {};
    if ((await deleteToggle.count()) > 0) {
      await deleteToggle.click();
      await page.waitForSelector('[data-testid^="admin-user-delete-form-"]', { timeout: 15000 });
      await page.locator('[data-testid^="admin-user-delete-reason-input-"]').first().fill("모바일 터치 검증");
      deleteHeights = {
        deleteFields: await readHeights(page, '[data-testid^="admin-user-delete-reason-input-"]'),
        deleteSubmit: await readHeights(page, '[data-testid^="admin-user-delete-form-"] button[type="submit"]'),
      };
    }
    const deleteReasonMaxLength = Number(
      await page.locator('[data-testid^="admin-user-delete-reason-input-"]').first().getAttribute("maxlength"),
    );

    const openControlHeights = {
      ...deleteHeights,
      inviteFields: await readHeights(page, '[data-testid="admin-user-invite-field"]'),
      inviteSubmit: await readHeights(page, '#admin-user-invite-form button[type="submit"]'),
      ...passwordResetHeights,
    };
    const inviteTextMaxLengths = await page
      .locator('#admin-user-invite-form input:not([type="checkbox"])')
      .evaluateAll((inputs) => inputs.map((input) => Number(input.getAttribute("maxlength"))));

    await page.locator('[data-testid^="admin-user-delete-toggle-"]').first().click().catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="admin-user-delete-form-"]').length === 0, null, {
      timeout: 10000,
    }).catch(() => {});
    await openFirstVisible(page, '[data-testid^="admin-user-edit-toggle-"]', '[data-testid^="admin-user-edit-form-"]');
    const editOpenHeights = {
      editActionButtons: await readHeights(page, '[data-testid^="admin-user-edit-submit-"], [data-testid^="admin-user-edit-cancel-"]'),
      editBranchLabels: await readHeights(page, '[data-testid^="admin-user-edit-form-"] fieldset label'),
      editControls: await readHeights(page, "[data-admin-user-edit-control='true']"),
      memberShortcut: await readHeights(page, '[data-testid^="admin-user-member-link-create-shortcut-"]'),
    };
    const editInputMaxLengths = {
      email: Number(await page.locator('[data-testid^="admin-user-edit-email-input-"]').first().getAttribute("maxlength")),
      name: Number(await page.locator('[data-testid^="admin-user-edit-name-input-"]').first().getAttribute("maxlength")),
      password: Number(await page.locator('[data-testid^="admin-user-password-input-"]').first().getAttribute("maxlength")),
      passwordConfirm: Number(
        await page.locator('[data-testid^="admin-user-password-confirm-input-"]').first().getAttribute("maxlength"),
      ),
      phone: Number(await page.locator('[data-testid^="admin-user-edit-phone-input-"]').first().getAttribute("maxlength")),
      title: Number(await page.locator('[data-testid^="admin-user-edit-title-input-"]').first().getAttribute("maxlength")),
    };
    await page.locator('[data-testid^="admin-user-edit-action-bar-"]').scrollIntoViewIfNeeded();
    const openHealth = await collectPageHealth(page);

    assert.equal(openHealth.frameworkOverlayCount, 0, "admin users opened forms must not show a framework overlay");
    assert(openHealth.bodyTextLength > 100, "admin users opened forms must not render a blank page");
    assert.equal(openHealth.horizontalOverflow, 0, "admin users opened forms must not overflow horizontally");
    assert(
      openHealth.actionBarBottomNavClearance === null || openHealth.actionBarBottomNavClearance >= 24,
      `admin user edit action bar must clear the bottom navigation by at least 24px; got ${openHealth.actionBarBottomNavClearance}px`,
    );
    for (const [label, heights] of Object.entries(openControlHeights)) {
      assertHeightsAtLeast(`admin user management ${label}`, heights);
    }
    assert.deepEqual(inviteTextMaxLengths, [80, 40, 254], "admin invitation fields must expose server input limits");
    assert.deepEqual(
      editInputMaxLengths,
      { email: 254, name: 80, password: 256, passwordConfirm: 256, phone: 40, title: 120 },
      "admin user edit fields must expose server input limits",
    );
    assert.equal(deleteReasonMaxLength, 500, "admin user delete reason must expose the server input limit");
    assert.equal(passwordResetReasonMaxLength, 500, "admin password issue reason must expose the server input limit");
    for (const [label, heights] of Object.entries(editOpenHeights)) {
      if (heights.length > 0) {
        assertHeightsAtLeast(`admin user management ${label}`, heights);
      }
    }
    await page.screenshot({ fullPage: false, path: openScreenshotPath });

    const inviteFields = page.getByTestId("admin-user-invite-field");
    await inviteFields.nth(0).fill("초대 비밀번호 검증");
    await inviteFields.nth(1).fill("01099998888");
    await page.locator('#admin-user-invite-form input[type="checkbox"]').first().check();
    await page.locator('#admin-user-invite-form button[type="submit"]').click();
    await page.getByText("초대 링크가 준비됐습니다.").waitFor({ state: "visible", timeout: 15000 });

    const pendingInviteRow = page.locator('[data-admin-user-invitation-status="pending"]').first();
    const approvalToggle = pendingInviteRow.locator('[data-admin-user-action="approve-invitation"]');
    const approvalToggleTestId = await approvalToggle.getAttribute("data-testid");
    assert(approvalToggleTestId, "pending invitation must expose an approval control");
    const approvalUserId = approvalToggleTestId.replace("admin-user-approve-invitation-", "");
    await approvalToggle.click();
    await page.getByTestId(`admin-user-confirm-approve-invitation-${approvalUserId}`).click();
    const approvedPasswordDismiss = page.getByTestId(`admin-user-approved-password-dismiss-${approvalUserId}`);
    await approvedPasswordDismiss.waitFor({ state: "visible", timeout: 15000 });
    assertHeightsAtLeast(
      "admin user approved invitation password confirmation",
      await readHeights(page, `[data-testid="admin-user-approved-password-dismiss-${approvalUserId}"]`),
    );
    await approvedPasswordDismiss.click();
    await page.waitForFunction(
      (userId) =>
        document.querySelectorAll(`[data-testid="admin-user-approved-password-dismiss-${userId}"]`).length === 0 &&
        !document.body.innerText.includes("첫 접속 비밀번호:"),
      approvalUserId,
      { timeout: 10000 },
    );

    await page.goto(new URL("/app/dashboard", baseUrl).toString(), { waitUntil: "networkidle" });
    await page.goto(new URL("/app/admin/users", baseUrl).toString(), { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="admin-user-list-scroll-region"]', { timeout: 15000 });
    assert.equal(await page.getByText("첫 접속 비밀번호:", { exact: false }).count(), 0, "approved password must not survive a route change");
    assert.equal(await page.getByText("새 비밀번호:", { exact: false }).count(), 0, "issued password must not survive a route change");

    assert.deepEqual(messages, [], "admin user management touch-target flow must not emit console warnings/errors");

    return {
      collapsedLayout,
      deleteReasonMaxLength,
      editInputMaxLengths,
      editOpenHeights,
      inviteTextMaxLengths,
      messages,
      openControlHeights,
      openHealth,
      passwordResetReasonMaxLength,
      screenshots: [
        { label: "admin users collapsed", path: collapsedScreenshotPath, sizeBytes: statSync(collapsedScreenshotPath).size },
        { label: "admin users open", path: openScreenshotPath, sizeBytes: statSync(openScreenshotPath).size },
      ],
    };
  } finally {
    await page.close();
  }
}

async function captureMemberDialogAccessibility(context) {
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const screenshotPath = join(outDir, "member-detail-dialog-mobile.png");

  try {
    await page.goto(new URL("/app/members", baseUrl).toString(), { waitUntil: "networkidle" });
    const toggle = page.locator('[data-testid^="member-detail-toggle-"]').first();
    await toggle.waitFor({ state: "visible", timeout: 15000 });
    const toggleTestId = await toggle.getAttribute("data-testid");
    assert(toggleTestId, "member detail trigger must expose a test id");
    const memberId = toggleTestId.replace("member-detail-toggle-", "");

    await toggle.click();
    const dialog = page.getByTestId(`member-detail-dialog-${memberId}`);
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(
      (targetMemberId) => document.activeElement?.getAttribute("data-testid") === `member-detail-close-${targetMemberId}`,
      memberId,
      { timeout: 10000 },
    );

    const openState = await dialog.evaluate((element) => ({
      activeElementInside: element.contains(document.activeElement),
      isModal: element.matches(":modal"),
      open: element instanceof HTMLDialogElement && element.open,
    }));
    assert.deepEqual(
      openState,
      { activeElementInside: true, isModal: true, open: true },
      "member detail must use a native modal dialog with focus inside",
    );
    await page.screenshot({ fullPage: false, path: screenshotPath });

    await page.keyboard.press("Shift+Tab");
    assert(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
      "member detail modal must keep keyboard focus inside after reverse tabbing",
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      ({ targetMemberId, targetToggleTestId }) =>
        document.querySelectorAll(`[data-testid="member-detail-dialog-${targetMemberId}"]`).length === 0 &&
        document.activeElement?.getAttribute("data-testid") === targetToggleTestId,
      { targetMemberId: memberId, targetToggleTestId: toggleTestId },
      { timeout: 10000 },
    );

    assert.deepEqual(messages, [], "member detail modal flow must not emit console warnings/errors");

    return {
      messages,
      openState,
      returnFocusTestId: await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null),
      screenshot: { label: "member detail dialog", path: screenshotPath, sizeBytes: statSync(screenshotPath).size },
    };
  } finally {
    await page.close();
  }
}

async function main() {
  assertStaticContracts();
  mkdirSync(outDir, { recursive: true });
  const removed = cleanOutputDir();
  const chromeExecutable = findChromeExecutable();
  assert(chromeExecutable, "Chrome or Chromium executable is required for admin user management touch-target proof");

  await ensureLocalAppServer();
  const resetBefore = await resetDevData("before");
  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  try {
    const adminUsers = await captureAdminUsers(context);
    const memberDialog = await captureMemberDialogAccessibility(context);
    const iosSimulator = readIosSimulatorProof();
    const minOpenTouchHeight = minMeasuredHeight({
      ...adminUsers.openControlHeights,
      ...adminUsers.editOpenHeights,
    });
    const report = {
      ok: true,
      baseUrl,
      browserPath: {
        classification: "Browser runtime unavailable",
        fallback: "Playwright with system Chrome",
        reason:
          "Browser skill is available, but tool discovery did not expose the required Browser Node JavaScript control tool.",
      },
      viewport: { width: 390, height: 844 },
      removed,
      verified: {
        allTouchTargetsAtLeast44: minOpenTouchHeight >= 44,
        horizontalOverflow: adminUsers.openHealth.horizontalOverflow,
        inviteFormCollapsedByDefault: adminUsers.collapsedLayout.inviteFormCount === 0,
        iosSimulatorNoBrowserChrome: iosSimulator.ok === true,
        minOpenTouchHeight,
        memberDialogFocusContained: memberDialog.openState.activeElementInside,
        memberDialogModal: memberDialog.openState.isModal,
        memberDialogReturnFocus: memberDialog.returnFocusTestId,
        rowActionsAtLeast44: Math.min(...adminUsers.collapsedLayout.listActionHeights) >= 44,
      },
      adminUsers,
      memberDialog,
      screenshots: [...adminUsers.screenshots, memberDialog.screenshot],
      iosSimulator,
      resetBefore,
      resetAfter: await resetDevData("after"),
    };

    writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
    await browser.close();
    await stopManagedAppServer();
  }
}

main().catch(async (error) => {
  await stopManagedAppServer();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
