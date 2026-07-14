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
const outDir = process.env.ADMIN_AUDIT_BOTTOM_SAFE_AREA_OUT_DIR ?? ".data/mobile-builds/ios/admin-audit-bottom-safe-area-20260701";
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
      throw new Error(`Managed admin audit app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed admin audit app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "admin audit bottom safe-area check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "admin audit bottom safe-area check",
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
    if (process.env.ADMIN_AUDIT_BOTTOM_SAFE_AREA_SERVER_LOGS === "1") {
      process.stdout.write(`[admin-audit-bottom-safe-area server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.ADMIN_AUDIT_BOTTOM_SAFE_AREA_SERVER_LOGS === "1") {
      process.stderr.write(`[admin-audit-bottom-safe-area server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "admin audit bottom safe-area check only mutates local dev data");
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: "admin audit bottom safe-area dev reset",
  }).catch((error) => {
    throw new Error(`Cannot reach ${baseUrl} for admin audit bottom safe-area checks. ${error.message}`);
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `admin audit bottom safe-area dev reset failed with ${response.status}`);

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

async function collectLayoutAtScrollEnd(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) < 4, null, {
    timeout: 10000,
  });

  return page.evaluate(() => {
    const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
    const spacer = document.querySelector('[data-testid="admin-audit-bottom-safe-area"]');
    const listToggle = document.querySelector('[data-testid="admin-audit-log-list-toggle"]');
    const list = document.querySelector('section[aria-label="변경 기록 목록"]');
    const navRect = nav?.getBoundingClientRect();
    const spacerRect = spacer?.getBoundingClientRect();
    const listToggleRect = listToggle?.getBoundingClientRect();
    const listRect = list?.getBoundingClientRect();
    const navTop = navRect?.top ?? window.innerHeight;
    const toggleBottom = listToggleRect?.bottom ?? listRect?.bottom ?? 0;
    const frameworkOverlayCount =
      document.querySelectorAll("[data-nextjs-dialog]").length +
      Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0).length;

    return {
      bodyTextLength: document.body.innerText.length,
      clientWidth: document.documentElement.clientWidth,
      frameworkOverlayCount,
      heading: document.querySelector("main h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      listBottom: Math.round(listRect?.bottom ?? 0),
      listRowCount: document.querySelectorAll('[data-testid="admin-audit-log-row"]').length,
      listToggleBottom: Math.round(toggleBottom),
      listToggleClearance: Math.round(navTop - toggleBottom),
      listToggleCount: document.querySelectorAll('[data-testid="admin-audit-log-list-toggle"]').length,
      listToggleHeight: Math.round(listToggleRect?.height ?? 0),
      mobileBottomNavTop: Math.round(navTop),
      screenVisible: Boolean(document.querySelector('section[aria-label="변경 기록 목록"]')),
      scrollWidth: document.documentElement.scrollWidth,
      spacerCount: document.querySelectorAll('[data-testid="admin-audit-bottom-safe-area"]').length,
      spacerHeight: Math.round(spacerRect?.height ?? 0),
      viewportHeight: window.innerHeight,
    };
  });
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  await ensureLocalAppServer();
  const resetBefore = await resetDevData();
  const executablePath = findChromeExecutable();

  assert(executablePath, "Chrome or Chromium executable is required for admin audit bottom safe-area checks");

  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ deviceScaleFactor: 2, isMobile: true, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);

  try {
    await loginTo(page, "admin", "/app/admin/audit-logs");
    await page.waitForSelector('[data-testid="admin-audit-log-row"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="admin-audit-bottom-safe-area"]', { timeout: 10000 });

    const layout = await collectLayoutAtScrollEnd(page);
    const screenshotPath = join(outDir, "admin-audit-bottom-safe-area-browser.png");
    await page.screenshot({ path: screenshotPath, fullPage: false, caret: "initial" });
    const screenshotSizeBytes = statSync(screenshotPath).size;

    assert.equal(layout.heading, "변경 기록", "admin audit bottom safe-area check must land on the audit screen");
    assert.equal(layout.screenVisible, true, "admin audit list must be visible");
    assert.equal(layout.spacerCount, 1, "admin audit list must render one bottom safe-area spacer");
    assert(layout.spacerHeight >= 112, "admin audit bottom safe-area spacer must reserve at least 112px");
    assert.equal(layout.listToggleCount, 1, "admin audit collapsed list must expose one more-records action");
    assert(layout.listToggleHeight >= 44, "admin audit more-records action must keep a 44px touch target");
    assert(layout.listToggleClearance >= 96, "admin audit more-records action must stay above the mobile bottom navigation at scroll end");
    assert.equal(layout.scrollWidth <= layout.clientWidth, true, "admin audit screen must not overflow horizontally on mobile");
    assert.equal(layout.frameworkOverlayCount, 0, "admin audit screen must not show framework overlays");
    assert.equal(messages.length, 0, `admin audit screen must stay console-clean: ${messages.join(" | ")}`);
    assert(screenshotSizeBytes > 10_000, `admin audit bottom safe-area screenshot must be non-empty, got ${screenshotSizeBytes} bytes`);

    const summary = {
      ok: true,
      appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
      baseUrl,
      checked: [
        "admin audit log list renders a mobile bottom safe-area spacer",
        "admin audit more-records action remains above the fixed bottom navigation at scroll end",
        "admin audit mobile screen stays console-clean and horizontally contained",
      ],
      layout,
      messages,
      resetBefore,
      screenshotPath,
      screenshotSizeBytes,
      summaryPath: join(outDir, "summary.json"),
      viewport: "390x844",
    };

    writeFileSync(summary.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await context.close();
    await browser.close();
    await stopManagedAppServer();
  }
}

main().catch(async (error) => {
  await stopManagedAppServer();
  console.error(error);
  process.exitCode = 1;
});
