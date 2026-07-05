import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir =
  process.env.CLASS_MANAGEMENT_TOUCH_TARGETS_OUT_DIR ??
  ".data/mobile-builds/ios/class-management-touch-targets-20260705";
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
      throw new Error(`Managed class management app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed class management app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "class management touch-target check only runs against a local dev app server");

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
    if (process.env.CLASS_MANAGEMENT_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stdout.write(`[class-management-touch-targets server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.CLASS_MANAGEMENT_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stderr.write(`[class-management-touch-targets server] ${chunk}`);
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

async function resetDevData(label) {
  assert(canMutateLocalDevData(), "class management touch-target check only mutates local dev data");

  const response = await fetch(new URL("/api/v1/dev/reset", baseUrl), { method: "POST" });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `class management touch-target ${label} reset failed with ${response.status}`);

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

    const shouldRemove = entry.name.endsWith(".png") || entry.name === "summary.json";

    if (!shouldRemove) {
      continue;
    }

    unlinkSync(join(outDir, entry.name));
    removed.push(entry.name);
  }

  return removed.sort();
}

async function gotoRole(page, role, nextPath) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);
  loginUrl.searchParams.set("next", nextPath);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === nextPath, { timeout: 15000 });
}

async function readHeights(page, selector) {
  return page.evaluate((targetSelector) => {
    return Array.from(document.querySelectorAll(targetSelector)).map((element) =>
      Math.round(element.getBoundingClientRect().height),
    );
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

    return {
      bodyTextLength: document.body?.innerText.length ?? 0,
      clientWidth: document.documentElement.clientWidth,
      frameworkOverlayCount,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

async function captureOwnerClasses(context) {
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const collapsedScreenshotPath = join(outDir, "owner-classes-create-collapsed-mobile.png");
  const openScreenshotPath = join(outDir, "owner-classes-create-open-mobile.png");

  try {
    await gotoRole(page, "owner", "/app/classes");
    await page.waitForSelector('[data-testid="class-create-toggle"]', { timeout: 15000 });

    const collapsedLayout = {
      health: await collectPageHealth(page),
      formCount: await page.locator('[data-testid="class-create-form"]').count(),
      toggleHeight: (await readHeights(page, '[data-testid="class-create-toggle"]'))[0] ?? 0,
    };

    assert.equal(collapsedLayout.health.frameworkOverlayCount, 0, "owner classes must not show a framework overlay");
    assert(collapsedLayout.health.bodyTextLength > 100, "owner classes must not render a blank page");
    assert.equal(collapsedLayout.health.scrollWidth, collapsedLayout.health.clientWidth, "owner classes must not overflow horizontally");
    assert.equal(collapsedLayout.formCount, 0, "class create form must stay collapsed by default");
    assert(collapsedLayout.toggleHeight >= 44, `class create toggle must stay 44px tall; got ${collapsedLayout.toggleHeight}px`);
    await page.screenshot({ fullPage: false, path: collapsedScreenshotPath });

    await page.getByTestId("class-create-toggle").click();
    await page.waitForSelector('[data-testid="class-create-form"]', { timeout: 15000 });

    const openLayout = {
      health: await collectPageHealth(page),
      createFieldHeights: await readHeights(page, '[data-testid="class-create-field"]'),
      createSubmitHeights: await readHeights(page, '[data-testid="class-create-submit"]'),
      editInputHeights: await readHeights(page, '[data-testid="class-edit-input"]'),
      editSubmitHeights: await readHeights(page, '[data-testid="class-edit-submit"]'),
      formCount: await page.locator('[data-testid="class-create-form"]').count(),
    };

    assert.equal(openLayout.health.frameworkOverlayCount, 0, "owner classes open form must not show a framework overlay");
    assert.equal(openLayout.health.scrollWidth, openLayout.health.clientWidth, "owner classes open form must not overflow horizontally");
    assert.equal(openLayout.formCount, 1, "class create form must open after tapping the toggle");
    assertHeightsAtLeast("class create field", openLayout.createFieldHeights);
    assertHeightsAtLeast("class create submit", openLayout.createSubmitHeights);
    assertHeightsAtLeast("class edit input", openLayout.editInputHeights);
    assertHeightsAtLeast("class edit submit", openLayout.editSubmitHeights);
    assert.equal(messages.length, 0, `owner classes must not log console/page warnings: ${messages.join(" | ")}`);
    await page.screenshot({ fullPage: false, path: openScreenshotPath });

    assert(statSync(collapsedScreenshotPath).size > 10_000, "owner classes collapsed screenshot must be non-empty");
    assert(statSync(openScreenshotPath).size > 10_000, "owner classes open screenshot must be non-empty");

    return {
      collapsedLayout,
      messages,
      openLayout,
      screenshots: {
        collapsed: collapsedScreenshotPath,
        open: openScreenshotPath,
      },
      screenshotSizeBytes: {
        collapsed: statSync(collapsedScreenshotPath).size,
        open: statSync(openScreenshotPath).size,
      },
      url: page.url(),
    };
  } finally {
    await page.close();
  }
}

async function captureCoachAttendanceNote(context) {
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const screenshotPath = join(outDir, "coach-classes-note-open-mobile.png");

  try {
    await gotoRole(page, "coach", "/app/classes");
    await page.waitForSelector('[data-testid^="coach-class-card-"]', { timeout: 15000 });
    await page.locator('[data-testid^="coach-class-roster-toggle-"]').first().click();
    await page.waitForSelector('[data-testid^="attendance-note-toggle-"]', { timeout: 15000 });
    await page.locator('[data-testid^="attendance-note-toggle-"]').first().click();
    await page.waitForSelector('[data-testid^="attendance-note-editor-"]', { timeout: 15000 });

    const layout = {
      health: await collectPageHealth(page),
      noteInputHeights: await readHeights(page, 'input[data-testid^="attendance-note-"]'),
      notePresetHeights: await readHeights(page, '[data-testid^="attendance-note-preset-"]'),
      noteSaveHeights: await readHeights(page, '[data-testid^="attendance-note-save-"]'),
      noteToggleHeights: await readHeights(page, '[data-testid^="attendance-note-toggle-"]'),
    };

    assert.equal(layout.health.frameworkOverlayCount, 0, "coach classes note flow must not show a framework overlay");
    assert(layout.health.bodyTextLength > 100, "coach classes note flow must not render a blank page");
    assert.equal(layout.health.scrollWidth, layout.health.clientWidth, "coach classes note flow must not overflow horizontally");
    assertHeightsAtLeast("attendance note toggle", layout.noteToggleHeights);
    assertHeightsAtLeast("attendance note input", layout.noteInputHeights);
    assertHeightsAtLeast("attendance note preset", layout.notePresetHeights);
    assertHeightsAtLeast("attendance note save", layout.noteSaveHeights);
    assert.equal(messages.length, 0, `coach classes note flow must not log console/page warnings: ${messages.join(" | ")}`);
    await page.screenshot({ fullPage: false, path: screenshotPath });
    assert(statSync(screenshotPath).size > 10_000, "coach classes note screenshot must be non-empty");

    return {
      layout,
      messages,
      screenshotPath,
      screenshotSizeBytes: statSync(screenshotPath).size,
      url: page.url(),
    };
  } finally {
    await page.close();
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const removedOutputFiles = cleanOutputDir();

  await ensureLocalAppServer();

  const chromeExecutable = findChromeExecutable();

  assert(chromeExecutable, "Google Chrome/Chromium executable is required for class management touch-target checks");

  const browser = await chromium.launch({ executablePath: chromeExecutable });

  try {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });

    try {
      const summary = {
        appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
        baseUrl,
        browserExecutable: chromeExecutable,
        browserMode: "Browser runtime unavailable / Playwright with system Chrome",
        devReset: await resetDevData("before"),
        flow:
          "owner /app/classes create/edit controls + coach /app/classes attendance note controls keep 44px touch targets",
        removedOutputFiles,
        result: {
          coach: await captureCoachAttendanceNote(context),
          owner: await captureOwnerClasses(context),
        },
        viewport: "390x844",
      };
      const summaryPath = join(outDir, "summary.json");

      writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
      console.log(JSON.stringify({ ok: true, summaryPath, ...summary }, null, 2));
    } finally {
      await context.close();
    }
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
