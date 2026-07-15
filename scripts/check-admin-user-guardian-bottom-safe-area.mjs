import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir =
  process.env.ADMIN_USER_GUARDIAN_BOTTOM_SAFE_AREA_OUT_DIR ??
  ".data/mobile-builds/ios/admin-user-guardian-bottom-safe-area-20260701";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const targetUserId = "user-guardian";
const browserFlowTimeoutMs = 60_000;
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
      throw new Error(`Managed admin user guardian app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed admin user guardian app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "admin user guardian bottom safe-area check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "admin user guardian bottom safe-area check",
  });

  if (await canReachAppServer()) {
    usingExistingAppServer = true;
    return;
  }

  managedAppServer = spawn(npmCommand, ["run", "dev", "--", "--webpack"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  managedAppServer.stdout?.on("data", (chunk) => {
    if (process.env.ADMIN_USER_GUARDIAN_BOTTOM_SAFE_AREA_SERVER_LOGS === "1") {
      process.stdout.write(`[admin-user-guardian-bottom-safe-area server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.ADMIN_USER_GUARDIAN_BOTTOM_SAFE_AREA_SERVER_LOGS === "1") {
      process.stderr.write(`[admin-user-guardian-bottom-safe-area server] ${chunk}`);
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

  managedAppServer.kill("SIGINT");

  await Promise.race([
    closed,
    sleep(5000).then(() => {
      if (managedAppServer?.exitCode === null) {
        managedAppServer.kill("SIGTERM");
      }
    }),
  ]);
}

async function resetDevData() {
  assert(canMutateLocalDevData(), "admin user guardian bottom safe-area check only mutates local dev data");
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: "admin user guardian bottom safe-area dev reset",
  }).catch((error) => {
    throw new Error(`Cannot reach ${baseUrl} for admin user guardian bottom safe-area checks. ${error.message}`);
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `admin user guardian bottom safe-area dev reset failed with ${response.status}`);

  return {
    attempted: true,
    counts: payload?.data?.counts ?? null,
    ok: response.ok,
    status: response.status,
  };
}

function collectConsoleMessages(page) {
  const messages = [];

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });

  return messages;
}

function createFlowTimeout(timeoutMs) {
  let timeoutId;

  return {
    cancel() {
      clearTimeout(timeoutId);
    },
    promise: new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Admin user guardian browser flow timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  };
}

async function loginTo(page, role, nextPath) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("next", nextPath);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);

  await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => url.pathname === nextPath.split("?")[0], { timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 });
}

async function collectListActionLayout(page) {
  await loginTo(page, "admin", "/app/admin/users");
  await page.waitForSelector('[data-testid="admin-user-list-scroll-region"]', { timeout: 10000 });
  await page.waitForTimeout(150);

  return page.evaluate(() => {
    const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
    const scrollRegion = document.querySelector('[data-testid="admin-user-list-scroll-region"]');
    const listSafeArea = document.querySelector('[data-testid="admin-user-list-bottom-safe-area"]');
    const navRect = nav?.getBoundingClientRect();
    const scrollRegionRect = scrollRegion?.getBoundingClientRect();
    const listSafeAreaRect = listSafeArea?.getBoundingClientRect();
    const actionButtons = Array.from(document.querySelectorAll('[data-testid^="admin-user-action-stack-"] button'));
    const navTop = navRect?.top ?? window.innerHeight;
    const visibleActionOverlaps = actionButtons.filter((button) => {
      const rect = button.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, scrollRegionRect?.top ?? 0, 0);
      const visibleBottom = Math.min(rect.bottom, scrollRegionRect?.bottom ?? window.innerHeight, window.innerHeight);
      const visibleLeft = Math.max(rect.left, scrollRegionRect?.left ?? 0, 0);
      const visibleRight = Math.min(rect.right, scrollRegionRect?.right ?? window.innerWidth, window.innerWidth);
      const hasVisibleArea = visibleBottom > visibleTop && visibleRight > visibleLeft;

      return hasVisibleArea && visibleBottom > navTop && rect.right > (navRect?.left ?? 0) && rect.left < (navRect?.right ?? window.innerWidth);
    });
    const visibleActionHeights = actionButtons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, scrollRegionRect?.top ?? 0, 0);
        const visibleBottom = Math.min(rect.bottom, scrollRegionRect?.bottom ?? window.innerHeight, window.innerHeight);

        return Math.max(0, visibleBottom - visibleTop);
      })
      .filter((height) => height > 0);

    return {
      actionButtonCount: actionButtons.length,
      listSafeAreaCount: document.querySelectorAll('[data-testid="admin-user-list-bottom-safe-area"]').length,
      listSafeAreaHeight: Math.round(listSafeAreaRect?.height ?? 0),
      listScrollRegionBottom: Math.round(scrollRegionRect?.bottom ?? 0),
      listScrollRegionBottomClearance: Math.round(navTop - (scrollRegionRect?.bottom ?? 0)),
      listScrollRegionCount: document.querySelectorAll('[data-testid="admin-user-list-scroll-region"]').length,
      listScrollRegionHeight: Math.round(scrollRegionRect?.height ?? 0),
      visibleActionButtonCount: visibleActionHeights.length,
      visibleActionMinHeight: visibleActionHeights.length > 0 ? Math.round(Math.min(...visibleActionHeights)) : 0,
      visibleActionOverlapBottomNavCount: visibleActionOverlaps.length,
    };
  });
}

async function openGuardianEditForm(page) {
  await loginTo(page, "admin", "/app/admin/users");
  await page.locator("#admin-user-search").fill("이하린");
  await page.getByTestId(`admin-user-edit-toggle-${targetUserId}`).click();
  await page.getByTestId(`admin-user-edit-form-${targetUserId}`).waitFor({ state: "visible", timeout: 10000 });
  await page.getByTestId(`admin-user-guardian-child-selected-list-${targetUserId}`).waitFor({ state: "visible", timeout: 10000 });
}

async function collectSelectedChildLayout(page) {
  await page.getByTestId(`admin-user-guardian-child-selected-list-${targetUserId}`).evaluate((element) => {
    element.scrollIntoView({ block: "end", inline: "nearest" });
  });
  await page.waitForTimeout(150);

  return page.evaluate((userId) => {
    const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
    const form = document.querySelector(`[data-testid="admin-user-edit-form-${userId}"]`);
	    const selectedList = document.querySelector(`[data-testid="admin-user-guardian-child-selected-list-${userId}"]`);
	    const selectedChips = Array.from(document.querySelectorAll(`[data-testid^="admin-user-guardian-child-selected-${userId}-"]`));
	    const selectedClearButtons = Array.from(document.querySelectorAll(`[data-testid^="admin-user-guardian-child-clear-${userId}-"]`));
	    const spacer = document.querySelector(`[data-testid="admin-user-edit-bottom-safe-area-${userId}"]`);
	    const navRect = nav?.getBoundingClientRect();
	    const formRect = form?.getBoundingClientRect();
	    const selectedListRect = selectedList?.getBoundingClientRect();
	    const selectedChipRects = selectedChips.map((chip) => chip.getBoundingClientRect());
	    const selectedClearButtonRects = selectedClearButtons.map((button) => button.getBoundingClientRect());
	    const spacerRect = spacer?.getBoundingClientRect();
    const navTop = navRect?.top ?? window.innerHeight;
    const selectedChipMaxBottom = Math.max(0, ...selectedChipRects.map((rect) => rect.bottom));
    const frameworkOverlayCount =
      document.querySelectorAll("[data-nextjs-dialog]").length +
      Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0).length;

    return {
      bodyTextLength: document.body.innerText.length,
      clientWidth: document.documentElement.clientWidth,
      formBottom: Math.round(formRect?.bottom ?? 0),
      frameworkOverlayCount,
      mobileBottomNavTop: Math.round(navTop),
      screenVisible: Boolean(document.querySelector('[data-testid="admin-user-list-row"]')),
	      scrollWidth: document.documentElement.scrollWidth,
	      selectedClearButtonCount: selectedClearButtons.length,
	      selectedClearButtonMinHeight: Math.round(Math.min(...selectedClearButtonRects.map((rect) => rect.height))),
	      selectedClearButtonMinWidth: Math.round(Math.min(...selectedClearButtonRects.map((rect) => rect.width))),
	      selectedChipCount: selectedChips.length,
      selectedChipMaxBottom: Math.round(selectedChipMaxBottom),
      selectedChipMinHeight: Math.round(Math.min(...selectedChipRects.map((rect) => rect.height))),
      selectedChipNavClearance: Math.round(navTop - selectedChipMaxBottom),
      selectedListBottom: Math.round(selectedListRect?.bottom ?? 0),
      selectedListCount: document.querySelectorAll(`[data-testid="admin-user-guardian-child-selected-list-${userId}"]`).length,
      selectedListNavClearance: Math.round(navTop - (selectedListRect?.bottom ?? 0)),
      spacerCount: document.querySelectorAll(`[data-testid="admin-user-edit-bottom-safe-area-${userId}"]`).length,
      spacerHeight: Math.round(spacerRect?.height ?? 0),
      viewportHeight: window.innerHeight,
    };
  }, targetUserId);
}

async function collectActionBarLayout(page) {
  await page.getByTestId(`admin-user-edit-action-bar-${targetUserId}`).evaluate((element) => {
    element.scrollIntoView({ block: "end", inline: "nearest" });
  });
  await page.waitForTimeout(150);

  return page.evaluate((userId) => {
    const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
    const actionBar = document.querySelector(`[data-testid="admin-user-edit-action-bar-${userId}"]`);
    const navRect = nav?.getBoundingClientRect();
    const actionBarRect = actionBar?.getBoundingClientRect();
    const navTop = navRect?.top ?? window.innerHeight;

    return {
      actionBarBottom: Math.round(actionBarRect?.bottom ?? 0),
      actionBarBottomClearance: Math.round(navTop - (actionBarRect?.bottom ?? 0)),
      actionBarCount: document.querySelectorAll(`[data-testid="admin-user-edit-action-bar-${userId}"]`).length,
      actionBarHeight: Math.round(actionBarRect?.height ?? 0),
      actionBarTop: Math.round(actionBarRect?.top ?? 0),
    };
  }, targetUserId);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  await ensureLocalAppServer();
  const resetBefore = await resetDevData();
  const executablePath = findChromeExecutable();

  assert(executablePath, "Chrome or Chromium executable is required for admin user guardian bottom safe-area checks");

  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ deviceScaleFactor: 2, isMobile: true, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const flowTimeout = createFlowTimeout(browserFlowTimeoutMs);

  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);

  try {
    const runBrowserFlow = async () => {
    const listActionLayout = await collectListActionLayout(page);
    const listActionScreenshotPath = join(outDir, "admin-user-list-safe-area-browser.png");
    await page.screenshot({ path: listActionScreenshotPath, fullPage: false, caret: "initial", timeout: 15_000 });
    const listActionScreenshotSizeBytes = statSync(listActionScreenshotPath).size;

    await openGuardianEditForm(page);

    const selectedLayout = await collectSelectedChildLayout(page);
    const screenshotPath = join(outDir, "admin-user-guardian-bottom-safe-area-browser.png");
    await page.screenshot({ path: screenshotPath, fullPage: false, caret: "initial", timeout: 15_000 });
    const screenshotSizeBytes = statSync(screenshotPath).size;
    const actionBarLayout = await collectActionBarLayout(page);
    const actionBarScreenshotPath = join(outDir, "admin-user-guardian-action-bar-browser.png");
    await page.screenshot({ path: actionBarScreenshotPath, fullPage: false, caret: "initial", timeout: 15_000 });
    const actionBarScreenshotSizeBytes = statSync(actionBarScreenshotPath).size;
    const layout = { ...listActionLayout, ...selectedLayout, ...actionBarLayout };

    assert.equal(layout.screenVisible, true, "admin users screen must stay visible");
    assert.equal(layout.listScrollRegionCount, 1, "admin users mobile list must render one bounded scroll region");
    assert(layout.listScrollRegionHeight >= 144, "admin users mobile list scroll region must keep the first user row readable");
    assert(layout.listScrollRegionBottomClearance >= 24, "admin users mobile list scroll region must stop above the bottom navigation");
    assert.equal(layout.listSafeAreaCount, 1, "admin users mobile list must render one internal bottom safe-area spacer");
    assert(layout.listSafeAreaHeight >= 96, "admin users mobile list bottom safe-area spacer must reserve at least 96px");
    assert(layout.visibleActionButtonCount >= 2, "admin users mobile list must keep visible row actions available");
    assert.equal(layout.visibleActionOverlapBottomNavCount, 0, "admin users visible list actions must not overlap the mobile bottom navigation");
    assert(layout.visibleActionMinHeight >= 44, "admin users visible list actions must keep 44px touch targets");
	    assert.equal(layout.selectedListCount, 1, "admin guardian edit form must render one selected-child list");
	    assert(layout.selectedChipCount >= 2, "admin guardian edit form must render linked child chips");
	    assert(layout.selectedChipMinHeight >= 32, "admin guardian child chips must remain readable and tappable");
	    assert.equal(layout.selectedClearButtonCount, layout.selectedChipCount, "admin guardian child chips must expose one unlink action per child");
	    assert(layout.selectedClearButtonMinHeight >= 44, "admin guardian child unlink actions must keep 44px touch height");
	    assert(layout.selectedClearButtonMinWidth >= 44, "admin guardian child unlink actions must keep 44px touch width");
	    assert(layout.selectedListNavClearance >= 96, "admin guardian selected-child list must stay above the mobile bottom navigation");
    assert(layout.selectedChipNavClearance >= 96, "admin guardian child chips must stay above the mobile bottom navigation");
    assert.equal(layout.spacerCount, 1, "admin user edit form must render one mobile bottom safe-area spacer");
    assert(layout.spacerHeight >= 112, "admin user edit form bottom safe-area spacer must reserve at least 112px");
    assert.equal(layout.actionBarCount, 1, "admin user edit form must keep one save action bar");
    assert(layout.actionBarHeight >= 44, "admin user edit action bar must keep 44px controls");
    assert(layout.actionBarBottomClearance >= 16, "admin user edit action bar must stay above the mobile bottom navigation");
    assert.equal(layout.scrollWidth <= layout.clientWidth, true, "admin user edit form must not overflow horizontally on mobile");
    assert.equal(layout.frameworkOverlayCount, 0, "admin user edit form must not show framework overlays");
    assert.equal(messages.length, 0, `admin user guardian edit flow must stay console-clean: ${messages.join(" | ")}`);
    assert(listActionScreenshotSizeBytes > 10_000, `admin user list safe-area screenshot must be non-empty, got ${listActionScreenshotSizeBytes} bytes`);
    assert(screenshotSizeBytes > 10_000, `admin user guardian bottom safe-area screenshot must be non-empty, got ${screenshotSizeBytes} bytes`);

    const summary = {
      ok: true,
      appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
      baseUrl,
      checked: [
        "admin users mobile list uses a bounded scroll region above the fixed bottom navigation",
	        "admin users visible list actions do not overlap the fixed bottom navigation",
	        "admin guardian edit selected-child list keeps scroll margin above the fixed bottom navigation",
	        "admin guardian child unlink actions keep 44px touch targets",
	        "admin guardian edit form renders a mobile bottom safe-area spacer",
        "admin guardian edit save action bar remains above the fixed bottom navigation",
        "admin guardian edit mobile screen stays console-clean and horizontally contained",
      ],
      layout,
      messages,
      resetBefore,
      listActionScreenshotPath,
      listActionScreenshotSizeBytes,
      screenshotPath,
      screenshotSizeBytes,
      actionBarScreenshotPath,
      actionBarScreenshotSizeBytes,
      summaryPath: join(outDir, "summary.json"),
      viewport: "390x844",
    };

    writeFileSync(summary.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    };

    await Promise.race([runBrowserFlow(), flowTimeout.promise]);
  } finally {
    flowTimeout.cancel();
    await context.close();
    await browser.close();
    await stopManagedAppServer();
  }
}

await main();
