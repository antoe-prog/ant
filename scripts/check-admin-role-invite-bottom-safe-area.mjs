import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.ADMIN_ROLE_INVITE_BOTTOM_SAFE_AREA_OUT_DIR ?? ".data/mobile-builds/ios/admin-role-invite-bottom-safe-area-20260705";
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
let activeBrowser = null;

function findChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate));
}

function assertLocalBaseUrl() {
  const { hostname, protocol } = new URL(baseUrl);

  assert(protocol === "http:", "admin role invite bottom safe-area check only runs against a local HTTP app server");
  assert(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname), "admin role invite bottom safe-area check only mutates local dev data");
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
      throw new Error(`Managed app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assertLocalBaseUrl();

  if (await canReachAppServer()) {
    usingExistingAppServer = true;
    return;
  }

  managedAppServer = spawn(npmCommand, ["run", "dev", "--", "--webpack"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
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

async function resetDevData(label) {
  const response = await fetch(`${baseUrl}/api/v1/dev/reset`, { method: "POST" });

  assert.equal(response.status, 200, `${label} dev reset must succeed`);
}

async function measureInviteLayout(page) {
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();

      return rect
        ? {
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
          }
        : null;
    };

    const navRect = rectFor('[data-testid="mobile-bottom-navigation"]');
    const formRect = rectFor("#admin-role-invite-form");
    const submitRect = rectFor('[data-testid="admin-role-invite-submit"]');
    const spacerRect = rectFor('[data-testid="admin-role-bottom-safe-area"]');
    const fieldsetRect = rectFor("#admin-role-invite-form fieldset");

    return {
      hash: window.location.hash,
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      inviteExpanded: document.querySelector('[data-testid="admin-role-invite-toggle"]')?.getAttribute("aria-expanded") === "true",
      navTop: navRect?.top ?? null,
      formBottomNavClearance: formRect && navRect ? Math.round(navRect.top - formRect.bottom) : null,
      submitBottomNavClearance: submitRect && navRect ? Math.round(navRect.top - submitRect.bottom) : null,
      fieldsetBottomNavClearance: fieldsetRect && navRect ? Math.round(navRect.top - fieldsetRect.bottom) : null,
      submitHeight: submitRect?.height ?? null,
      spacerCount: document.querySelectorAll('[data-testid="admin-role-bottom-safe-area"]').length,
      spacerHeight: spacerRect?.height ?? null,
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      scrollY: Math.round(window.scrollY),
    };
  });
}

async function main() {
  const executablePath = findChromeExecutable();

  assert(executablePath, "Chrome/Chromium executable is required for admin role invite bottom safe-area check");
  mkdirSync(outDir, { recursive: true });
  await ensureLocalAppServer();
  await resetDevData("before");

  const browser = await chromium.launch({ executablePath, headless: true });
  activeBrowser = browser;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.goto(`${baseUrl}/api/v1/dev/auto-login?role=admin&next=%2Fapp%2Fadmin%2Froles%3Finvite%3D1`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("#admin-role-invite-form", { timeout: 15000 });
  await page.waitForSelector('[data-testid="mobile-bottom-navigation"]', { timeout: 15000 });

  const initialScreenshotPath = join(outDir, "admin-role-invite-open-initial-mobile.png");
  await page.screenshot({ path: initialScreenshotPath, fullPage: false, caret: "initial" });

  await page.getByTestId("admin-role-invite-submit").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);

  const submitScreenshotPath = join(outDir, "admin-role-invite-submit-clearance-mobile.png");
  await page.screenshot({ path: submitScreenshotPath, fullPage: false, caret: "initial" });
  const submitLayout = await measureInviteLayout(page);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  const scrollEndLayout = await measureInviteLayout(page);

  await page.goto(`${baseUrl}/api/v1/dev/auto-login?role=admin&next=%2Fapp%2Fadmin%2Froles%3Finvite%3D1%23admin-role-invite-submit`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("#admin-role-invite-form", { timeout: 15000 });
  await page.waitForSelector('[data-testid="mobile-bottom-navigation"]', { timeout: 15000 });
  await page.waitForTimeout(750);

  const hashSubmitScreenshotPath = join(outDir, "admin-role-invite-hash-submit-clearance-mobile.png");
  await page.screenshot({ path: hashSubmitScreenshotPath, fullPage: false, caret: "initial" });
  const hashSubmitLayout = await measureInviteLayout(page);

  assert.equal(submitLayout.heading, "총괄 권한 관리", "admin role invite bottom safe-area check must land on admin roles");
  assert.equal(submitLayout.inviteExpanded, true, "admin role invite form must be opened by invite=1 query");
  assert.equal(submitLayout.spacerCount, 1, "admin roles screen must render one mobile bottom safe-area spacer");
  assert(submitLayout.spacerHeight >= 112, `admin role bottom safe-area spacer must be at least 112px; got ${submitLayout.spacerHeight}px`);
  assert(submitLayout.submitHeight >= 44, `admin role invite submit button must keep 44px touch height; got ${submitLayout.submitHeight}px`);
  assert(
    submitLayout.submitBottomNavClearance !== null && submitLayout.submitBottomNavClearance >= 24,
    `admin role invite submit action must clear bottom nav by at least 24px; got ${submitLayout.submitBottomNavClearance}px`,
  );
  assert(
    scrollEndLayout.formBottomNavClearance !== null && scrollEndLayout.formBottomNavClearance >= 96,
    `admin role invite form must clear bottom nav by at least 96px at scroll end; got ${scrollEndLayout.formBottomNavClearance}px`,
  );
  assert.equal(submitLayout.overflowX, 0, "admin role invite submit view must not overflow horizontally");
  assert.equal(scrollEndLayout.overflowX, 0, "admin role invite scroll end must not overflow horizontally");
  assert.equal(hashSubmitLayout.heading, "총괄 권한 관리", "admin role invite hash deeplink must land on admin roles");
  assert.equal(hashSubmitLayout.hash, "#admin-role-invite-submit", "admin role invite hash deeplink must preserve submit hash");
  assert.equal(hashSubmitLayout.inviteExpanded, true, "admin role invite hash deeplink must open the invite form");
  assert(
    hashSubmitLayout.submitBottomNavClearance !== null && hashSubmitLayout.submitBottomNavClearance >= 24,
    `admin role invite submit hash deeplink must clear bottom nav by at least 24px; got ${hashSubmitLayout.submitBottomNavClearance}px`,
  );
  assert.equal(hashSubmitLayout.overflowX, 0, "admin role invite hash deeplink must not overflow horizontally");

  for (const screenshotPath of [initialScreenshotPath, submitScreenshotPath, hashSubmitScreenshotPath]) {
    assert(statSync(screenshotPath).size > 10_000, `${screenshotPath} must be a non-empty screenshot`);
  }

  await browser.close();
  activeBrowser = null;
  await resetDevData("after");

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    baseUrl,
    viewport: { width: 390, height: 844 },
    screenshots: {
      initial: {
        path: initialScreenshotPath,
        bytes: statSync(initialScreenshotPath).size,
      },
      submitClearance: {
        path: submitScreenshotPath,
        bytes: statSync(submitScreenshotPath).size,
      },
      hashSubmitClearance: {
        path: hashSubmitScreenshotPath,
        bytes: statSync(hashSubmitScreenshotPath).size,
      },
    },
    submitLayout,
    scrollEndLayout,
    hashSubmitLayout,
    releaseDecision: "internal_browser_evidence_only_not_operational_ready",
  };

  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch(async (error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (activeBrowser) {
      await activeBrowser.close().catch(() => {});
      activeBrowser = null;
    }
    await stopManagedAppServer();
  });
