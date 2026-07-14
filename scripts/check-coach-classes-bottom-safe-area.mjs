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
const outDir = process.env.COACH_CLASSES_BOTTOM_SAFE_AREA_OUT_DIR ?? ".data/mobile-builds/ios/coach-classes-bottom-safe-area-20260701";
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
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
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
      throw new Error(`Managed coach classes app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed coach classes app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "coach classes bottom safe-area check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "coach classes bottom safe-area check",
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
    if (process.env.COACH_CLASSES_BOTTOM_SAFE_AREA_SERVER_LOGS === "1") {
      process.stdout.write(`[coach-classes-bottom-safe-area server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.COACH_CLASSES_BOTTOM_SAFE_AREA_SERVER_LOGS === "1") {
      process.stderr.write(`[coach-classes-bottom-safe-area server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "coach classes bottom safe-area check only mutates local dev data");
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: "coach classes bottom safe-area dev reset",
  }).catch((error) => {
    throw new Error(`Cannot reach ${baseUrl} for coach classes bottom safe-area checks. ${error.message}`);
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `coach classes bottom safe-area dev reset failed with ${response.status}`);

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

async function loginTo(page, role, nextPath) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);
  loginUrl.searchParams.set("next", nextPath);

  await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
}

async function clickExistingAttendanceChange(page) {
  const targetTestId = await page.evaluate(() => {
    const statuses = ["present", "late", "absent", "excused"];
    const pressedButtons = Array.from(document.querySelectorAll('button[data-testid^="attendance-"][aria-pressed="true"]'));

    for (const button of pressedButtons) {
      const currentTestId = button.getAttribute("data-testid") ?? "";
      const currentStatus = statuses.find((status) => currentTestId.endsWith(`-${status}`));

      if (!currentStatus) {
        continue;
      }

      const nextStatus = statuses.find((status) => status !== currentStatus);
      const baseTestId = currentTestId.slice(0, -(currentStatus.length + 1));

      if (nextStatus && document.querySelector(`[data-testid="${baseTestId}-${nextStatus}"]`)) {
        return `${baseTestId}-${nextStatus}`;
      }
    }

    return "";
  });

  assert(targetTestId, "coach classes check needs at least one existing attendance status to modify");
  await page.getByTestId(targetTestId).click();

  return targetTestId;
}

async function collectCoachClassesLayout(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="coach-mobile-save-status-panel"]');
    const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
    const listToggle = document.querySelector('[data-testid="coach-class-list-toggle"]');
    const retryButton = document.querySelector('[data-testid="attendance-retry-mobile"]');
    const statusChip = document.querySelector('[data-testid="attendance-sync-status-mobile"]');
    const undoButton = document.querySelector('[data-testid="attendance-undo-last-mobile"]');
    const panelRect = panel?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const listToggleRect = listToggle?.getBoundingClientRect();
    const retryRect = retryButton?.getBoundingClientRect();
    const statusChipRect = statusChip?.getBoundingClientRect();
    const undoRect = undoButton?.getBoundingClientRect();
    const visibleRosterToggles = Array.from(document.querySelectorAll('[data-testid^="coach-class-roster-toggle-"]')).filter((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);

      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const visibleClassCards = Array.from(document.querySelectorAll('[data-testid^="coach-class-card-"]')).filter((card) => {
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);

      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const frameworkOverlayCount =
      document.querySelectorAll("[data-nextjs-dialog]").length +
      Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0).length;
    const navTop = navRect?.top ?? window.innerHeight;
    const listToggleBottom = listToggleRect?.bottom ?? 0;

    return {
      bodyTextLength: document.body?.innerText.length ?? 0,
      clientWidth: document.documentElement.clientWidth,
      frameworkOverlayCount,
      listToggleBottom: Math.round(listToggleBottom),
      listToggleBottomClearance: Math.round(navTop - listToggleBottom),
      listToggleCount: document.querySelectorAll('[data-testid="coach-class-list-toggle"]').length,
      listToggleVisibleInViewport: Boolean(listToggleRect && listToggleRect.top < window.innerHeight && listToggleRect.bottom > 0),
      navHeight: Math.round(navRect?.height ?? 0),
      navTop: Math.round(navTop),
      panelBottom: Math.round(panelRect?.bottom ?? 0),
      panelBottomClearance: Math.round(navTop - (panelRect?.bottom ?? 0)),
      panelCount: document.querySelectorAll('[data-testid="coach-mobile-save-status-panel"]').length,
      panelHeight: Math.round(panelRect?.height ?? 0),
      panelText: panel?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      panelTop: Math.round(panelRect?.top ?? 0),
      panelZIndex: Number.parseInt(panel ? getComputedStyle(panel).zIndex : "0", 10) || 0,
      retryButtonCount: document.querySelectorAll('[data-testid="attendance-retry-mobile"]').length,
      retryButtonHeight: Math.round(retryRect?.height ?? 0),
      rosterToggleBottomNavOverlapCount: visibleRosterToggles.filter((button) => {
        const rect = button.getBoundingClientRect();

        return rect.top < window.innerHeight && rect.bottom > navTop;
      }).length,
      scrollWidth: document.documentElement.scrollWidth,
      statusChipCount: document.querySelectorAll('[data-testid="attendance-sync-status-mobile"]').length,
      statusChipHeight: Math.round(statusChipRect?.height ?? 0),
      undoButtonCount: document.querySelectorAll('[data-testid="attendance-undo-last-mobile"]').length,
      undoButtonHeight: Math.round(undoRect?.height ?? 0),
      visibleClassCardCount: visibleClassCards.length,
      visibleRosterToggleCount: visibleRosterToggles.length,
      viewportHeight: window.innerHeight,
    };
  });
}

async function captureCoachClassesBottomSafeArea(browser) {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const screenshotPath = join(outDir, "coach-classes-bottom-safe-area-browser.png");

  try {
    await loginTo(page, "coach", "/app/classes");
    await page.waitForSelector('[data-testid^="coach-class-card-"]', { timeout: 15000 });
    const initialLayout = await collectCoachClassesLayout(page);

    assert.equal(initialLayout.frameworkOverlayCount, 0, "coach classes screen must not show a framework overlay before attendance change");
    assert(initialLayout.bodyTextLength > 100, "coach classes screen must not be blank before attendance change");
    assert.equal(initialLayout.scrollWidth, initialLayout.clientWidth, "coach classes screen must not overflow horizontally before attendance change");
    assert.equal(initialLayout.visibleClassCardCount, 1, "coach classes mobile default list must keep one visible class card");
    assert.equal(initialLayout.listToggleCount, 1, "coach classes mobile default list must expose one expansion control");
    assert(
      initialLayout.listToggleBottomClearance >= 96,
      `coach classes list expansion control must keep at least 96px bottom-nav clearance before roster open; got ${initialLayout.listToggleBottomClearance}px`,
    );
    assert.equal(initialLayout.rosterToggleBottomNavOverlapCount, 0, "coach class roster toggles must not overlap the bottom navigation before roster open");

    await page.locator('[data-testid^="coach-class-roster-toggle-"]').first().click();
    const changedAttendanceTestId = await clickExistingAttendanceChange(page);
    await page.waitForSelector('[data-testid="coach-mobile-save-status-panel"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="mobile-bottom-navigation"]', { timeout: 15000 });
    await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 100, null, { timeout: 15000 });

    const layout = await collectCoachClassesLayout(page);

    assert.equal(layout.frameworkOverlayCount, 0, "coach classes screen must not show a framework overlay");
    assert(layout.bodyTextLength > 100, "coach classes screen must not be blank");
    assert.equal(layout.scrollWidth, layout.clientWidth, "coach classes screen must not overflow horizontally");
    assert.equal(layout.panelCount, 1, "coach classes must render one mobile save status panel");
    assert(layout.panelText.includes("출석"), "coach classes mobile save status panel must expose attendance status copy");
    assert(layout.panelHeight >= 44, `coach classes mobile save status panel must keep a tappable height; got ${layout.panelHeight}px`);
    assert(layout.panelBottomClearance >= 24, `coach classes mobile save status panel must clear bottom nav by at least 24px; got ${layout.panelBottomClearance}px`);
    assert(layout.panelZIndex < 30, `coach classes mobile save status panel must stay below the z-30 bottom nav; got z-index ${layout.panelZIndex}`);
    assert.equal(layout.statusChipCount, 1, "coach classes mobile save status panel must expose one sync status chip");
    assert(layout.statusChipHeight >= 44, `coach classes mobile save status chip must keep a 44px scan height; got ${layout.statusChipHeight}px`);
    assert.equal(layout.undoButtonCount, 1, "coach classes mobile save status panel must expose one undo action after a change");
    assert(layout.undoButtonHeight >= 44, `coach classes mobile undo action must keep a 44px touch height; got ${layout.undoButtonHeight}px`);
    assert(
      layout.retryButtonCount === 0 || layout.retryButtonHeight >= 44,
      `coach classes mobile retry action must keep a 44px touch height when visible; got ${layout.retryButtonHeight}px`,
    );
    assert.equal(layout.rosterToggleBottomNavOverlapCount, 0, "coach class roster toggles must not overlap the bottom navigation");
    assert.equal(messages.length, 0, `coach classes screen must not log console/page warnings: ${messages.join(" | ")}`);

    await page.screenshot({ fullPage: false, path: screenshotPath });
    assert(statSync(screenshotPath).size > 10_000, "coach classes bottom safe-area screenshot must be non-empty");

    return {
      layout,
      initialLayout,
      changedAttendanceTestId,
      messages,
      screenshotPath,
      screenshotSizeBytes: statSync(screenshotPath).size,
      url: page.url(),
      viewport: "390x844",
    };
  } finally {
    await context.close();
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  await ensureLocalAppServer();

  const chromeExecutable = findChromeExecutable();

  assert(chromeExecutable, "Google Chrome/Chromium executable is required for coach classes bottom safe-area checks");

  const browser = await chromium.launch({
    executablePath: chromeExecutable,
  });

  try {
    const summary = {
      appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
      baseUrl,
      browserExecutable: chromeExecutable,
      devReset: await resetDevData(),
      flow: "/login?autoLogin=1&role=coach -> /app/classes -> mobile save status panel and bottom navigation clearance",
      result: await captureCoachClassesBottomSafeArea(browser),
    };
    const summaryPath = join(outDir, "summary.json");

    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, summaryPath, ...summary }, null, 2));
  } finally {
    await browser.close();
    await stopManagedAppServer();
  }
}

main().catch(async (error) => {
  await stopManagedAppServer();
  console.error(error);
  process.exit(1);
});
