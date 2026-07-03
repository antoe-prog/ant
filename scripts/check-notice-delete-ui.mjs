import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.NOTICE_DELETE_UI_OUT_DIR ?? ".data/mobile-builds/ios/notice-delete-ui-20260701";
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
      throw new Error(`Managed notice delete UI app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed notice delete UI app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "notice delete UI check only runs against a local dev app server");

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
    if (process.env.NOTICE_DELETE_UI_SERVER_LOGS === "1") {
      process.stdout.write(`[notice-delete-ui server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.NOTICE_DELETE_UI_SERVER_LOGS === "1") {
      process.stderr.write(`[notice-delete-ui server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "notice delete UI check only mutates local dev data");

  const response = await fetch(new URL("/api/v1/dev/reset", baseUrl), { method: "POST" }).catch((error) => {
    throw new Error(`Cannot reach ${baseUrl} for notice delete UI checks. ${error.message}`);
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `notice delete UI ${label} dev reset failed with ${response.status}`);

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
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });

  return messages;
}

async function collectScreenState(page, screenTestId) {
  return page.evaluate((testId) => {
    const screen = document.querySelector(`[data-testid="${testId}"]`);
    const bodyText = document.body?.innerText ?? "";

    return {
      bodyTextLength: bodyText.length,
      clientWidth: document.documentElement.clientWidth,
      deleteActionCount: document.querySelectorAll(
        '[data-testid="notice-delivery-delete-action"], [data-testid="notification-notice-delete-action"]',
      ).length,
      frameworkOverlayCount:
        document.querySelectorAll("[data-nextjs-dialog]").length +
        Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0).length,
      heading: document.querySelector("main h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      screenVisible: Boolean(screen),
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, screenTestId);
}

async function loginTo(page, role, nextPath) {
  await page.goto(
    new URL(`/api/v1/dev/auto-login?role=${role}&next=${encodeURIComponent(nextPath)}`, baseUrl).toString(),
    { waitUntil: "load" },
  );
}

async function createNoticeFromCurrentSession(page, title, body) {
  const result = await page.evaluate(
    async ({ noticeBody, noticeTitle }) => {
      const response = await fetch("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: ["member", "guardian"],
          body: noticeBody,
          important: true,
          title: noticeTitle,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      return {
        ok: response.ok,
        payload,
        status: response.status,
      };
    },
    {
      noticeBody: body,
      noticeTitle: title,
    },
  );

  assert(result.ok, `notice API seed failed with ${result.status}: ${JSON.stringify(result.payload)}`);
  assert(result.payload?.data?.notice?.id, "notice API seed must return the created notice id");

  return result.payload.data.notice.id;
}

async function verifyNoticesScreenDelete(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const title = `UI 삭제 확인 ${Date.now()}`;
  const confirmScreenshotPath = join(outDir, "desktop-notices-delete-confirm.png");
  const afterScreenshotPath = join(outDir, "desktop-notices-delete-after.png");

  try {
    await loginTo(page, "admin", "/app/notices?noticeCompose=1");
    await page.waitForSelector('[data-testid="notices-screen"]', { timeout: 15000 });

    const initialState = await collectScreenState(page, "notices-screen");

    assert.equal(initialState.screenVisible, true, "admin notices screen must render");
    assert.equal(initialState.frameworkOverlayCount, 0, "admin notices screen must not show a framework overlay");
    assert(initialState.bodyTextLength > 100, "admin notices screen must not be blank");

    await page.getByTestId("notice-create-title-input").fill(title);
    await page.locator('textarea[placeholder="공지 내용"]').fill("공지 삭제 UI 회귀 검증용 임시 공지입니다.");
    await page.getByTestId("notice-create-submit").click();

    const createdCard = page.getByTestId("notice-delivery-compact-card").filter({ hasText: title }).first();

    await createdCard.waitFor({ state: "visible", timeout: 15000 });
    await createdCard.getByTestId("notice-delivery-delete-action").click();
    await createdCard.getByTestId("notice-delete-confirm").waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ fullPage: false, path: confirmScreenshotPath });
    await createdCard.getByTestId("notice-delete-confirm-action").click();
    await page.getByTestId("notice-delete-feedback").waitFor({ state: "visible", timeout: 10000 });
    await createdCard.waitFor({ state: "detached", timeout: 10000 });
    await page.screenshot({ fullPage: false, path: afterScreenshotPath });

    const feedbackText = await page.getByTestId("notice-delete-feedback").innerText();
    const afterState = await collectScreenState(page, "notices-screen");

    assert(feedbackText.includes("공지를 삭제했습니다"), "admin notices screen must confirm deletion");
    assert.equal(await page.getByTestId("notice-delivery-compact-card").filter({ hasText: title }).count(), 0, "deleted notice must disappear from notices screen");
    assert.equal(afterState.frameworkOverlayCount, 0, "admin notices screen must stay free of framework overlays after delete");
    assert.equal(afterState.scrollWidth, afterState.clientWidth, "admin notices screen must not overflow horizontally after delete");
    assert.equal(messages.length, 0, `admin notices screen must not log console/page warnings: ${messages.join(" | ")}`);
    assert(statSync(confirmScreenshotPath).size > 10_000, "desktop notices confirm screenshot must be non-empty");
    assert(statSync(afterScreenshotPath).size > 10_000, "desktop notices after screenshot must be non-empty");

    return {
      afterScreenshotPath,
      afterScreenshotSizeBytes: statSync(afterScreenshotPath).size,
      afterState,
      confirmScreenshotPath,
      confirmScreenshotSizeBytes: statSync(confirmScreenshotPath).size,
      feedbackText,
      initialState,
      messages,
      title,
      url: page.url(),
      viewport: "1280x900",
    };
  } finally {
    await context.close();
  }
}

async function verifyMobileNoticesScreenActionLayout(browser) {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const screenshotPath = join(outDir, "mobile-notices-action-row-compact.png");
  const bottomScreenshotPath = join(outDir, "mobile-notices-bottom-safe-area.png");

  try {
    await loginTo(page, "admin", "/app/notices");
    await page.waitForSelector('[data-testid="notices-screen"]', { timeout: 15000 });

    const firstCard = page.getByTestId("notice-delivery-compact-card").first();

    await firstCard.waitFor({ state: "visible", timeout: 15000 });

    const layoutState = await firstCard.evaluate((card) => {
      const title = card.querySelector("h3");
      const actionRow = card.querySelector('[data-testid="notice-delivery-action-row"]');
      const buttons = actionRow ? Array.from(actionRow.querySelectorAll("button")) : [];
      const titleRect = title?.getBoundingClientRect();
      const actionRect = actionRow?.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      return {
        actionButtonWidths: buttons.map((button) => button.getBoundingClientRect().width),
        actionLayout: actionRow?.getAttribute("data-notice-action-layout") ?? "",
        actionRight: actionRect?.right ?? 0,
        actionTop: actionRect?.top ?? 0,
        bodyTextLength: document.body?.innerText.length ?? 0,
        cardHeight: Math.round(cardRect.height),
        cardRight: cardRect.right,
        clientWidth: document.documentElement.clientWidth,
        frameworkOverlayCount:
          document.querySelectorAll("[data-nextjs-dialog]").length +
          Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0).length,
        noticeDeliveryBodyVisibleCount: Array.from(document.querySelectorAll('[data-testid="notice-delivery-body"]')).filter((body) => {
          const rect = body.getBoundingClientRect();
          const style = getComputedStyle(body);

          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        }).length,
        scrollWidth: document.documentElement.scrollWidth,
        titleBottom: titleRect?.bottom ?? 0,
      };
    });

    assert.equal(layoutState.frameworkOverlayCount, 0, "admin mobile notices screen must not show a framework overlay");
    assert(layoutState.bodyTextLength > 100, "admin mobile notices screen must not be blank");
    assert.equal(layoutState.actionLayout, "stacked-mobile", "admin mobile notices action row must use the compact stacked layout");
    assert(
      layoutState.actionTop >= layoutState.titleBottom - 2,
      `admin mobile notices action row must sit below the title row; titleBottom=${layoutState.titleBottom}, actionTop=${layoutState.actionTop}`,
    );
    assert(
      layoutState.actionButtonWidths.every((width) => width <= 56),
      `admin mobile notices action buttons must stay compact; widths=${layoutState.actionButtonWidths.join(", ")}`,
    );
    assert.equal(layoutState.noticeDeliveryBodyVisibleCount, 0, "admin mobile notices must hide operator body previews to keep cards compact");
    assert(layoutState.cardHeight <= 132, `admin mobile notices compact card must stay at or below 132px; got ${layoutState.cardHeight}px`);
    assert(layoutState.actionRight <= layoutState.cardRight + 1, "admin mobile notices action row must stay inside the card");
    assert.equal(layoutState.scrollWidth, layoutState.clientWidth, "admin mobile notices screen must not overflow horizontally");
    assert.equal(messages.length, 0, `admin mobile notices screen must not log console/page warnings: ${messages.join(" | ")}`);

    await page.screenshot({ fullPage: false, path: screenshotPath });
    assert(statSync(screenshotPath).size > 10_000, "mobile notices action row screenshot must be non-empty");

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);

    const bottomState = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="notice-delivery-compact-card"]'));
      const lastCard = cards.at(-1);
      const lastCardRect = lastCard?.getBoundingClientRect();
      const navRect = document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect();
      const safeAreaRect = document.querySelector('[data-testid="notice-bottom-safe-area"]')?.getBoundingClientRect();

      return {
        bottomClearance: navRect && lastCardRect ? navRect.top - lastCardRect.bottom : 0,
        cardCount: cards.length,
        clientWidth: document.documentElement.clientWidth,
        lastCardBottom: lastCardRect?.bottom ?? 0,
        navTop: navRect?.top ?? 0,
        safeAreaCount: document.querySelectorAll('[data-testid="notice-bottom-safe-area"]').length,
        safeAreaHeight: safeAreaRect?.height ?? 0,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    assert.equal(bottomState.safeAreaCount, 1, "admin mobile notices screen must render one bottom safe-area spacer");
    assert(bottomState.safeAreaHeight >= 112, `admin mobile notices bottom safe-area spacer must be at least 112px; got ${bottomState.safeAreaHeight}px`);
    assert(bottomState.cardCount > 0, "admin mobile notices bottom check needs at least one notice card");
    assert(
      bottomState.bottomClearance >= 96,
      `admin mobile notices last card must clear the bottom nav by at least 96px; got ${bottomState.bottomClearance}px`,
    );
    assert.equal(bottomState.scrollWidth, bottomState.clientWidth, "admin mobile notices screen must not overflow horizontally at scroll end");
    await page.screenshot({ fullPage: false, path: bottomScreenshotPath });
    assert(statSync(bottomScreenshotPath).size > 10_000, "mobile notices bottom safe-area screenshot must be non-empty");

    return {
      bottomScreenshotPath,
      bottomScreenshotSizeBytes: statSync(bottomScreenshotPath).size,
      bottomState,
      layoutState,
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

async function verifyNotificationInboxDelete(browser) {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const title = `모바일 알림 삭제 ${Date.now()}`;
  const confirmScreenshotPath = join(outDir, "mobile-notifications-delete-confirm.png");
  const afterScreenshotPath = join(outDir, "mobile-notifications-delete-after.png");

  try {
    await loginTo(page, "admin", "/app/notifications");
    await page.waitForSelector('[data-testid="notifications-screen"]', { timeout: 15000 });
    await createNoticeFromCurrentSession(page, title, "모바일 알림함 삭제 UI 회귀 검증용 임시 공지입니다.");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('[data-testid="notifications-screen"]', { timeout: 15000 });

    const seededCard = page.getByTestId("notification-inbox-card").filter({ hasText: title }).first();
    const initialState = await collectScreenState(page, "notifications-screen");

    assert.equal(initialState.screenVisible, true, "admin notification inbox must render");
    assert.equal(initialState.frameworkOverlayCount, 0, "admin notification inbox must not show a framework overlay");
    assert(initialState.deleteActionCount > 0, "admin notification inbox must expose notice delete actions");
    await seededCard.waitFor({ state: "visible", timeout: 15000 });
    const mobileDeleteButtonBox = await seededCard.getByTestId("notification-notice-delete-action").boundingBox();

    assert(mobileDeleteButtonBox, "admin mobile notification inbox notice delete action must be measurable");
    assert(
      mobileDeleteButtonBox.width <= 56,
      `admin mobile notification inbox notice delete action must stay compact; got ${mobileDeleteButtonBox.width}px`,
    );
    await seededCard.getByTestId("notification-notice-delete-action").click();
    await seededCard.getByTestId("notification-notice-delete-confirm").waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ fullPage: false, path: confirmScreenshotPath });
    await seededCard.getByTestId("notification-notice-delete-confirm-action").click();
    await page.getByTestId("notification-delete-feedback").waitFor({ state: "visible", timeout: 10000 });
    await seededCard.waitFor({ state: "detached", timeout: 10000 });
    await page.screenshot({ fullPage: false, path: afterScreenshotPath });

    const feedbackText = await page.getByTestId("notification-delete-feedback").innerText();
    const afterState = await collectScreenState(page, "notifications-screen");

    assert(feedbackText.includes("공지를 삭제했습니다"), "admin notification inbox must confirm deletion");
    assert.equal(await page.getByTestId("notification-inbox-card").filter({ hasText: title }).count(), 0, "deleted notice must disappear from notification inbox");
    assert.equal(afterState.frameworkOverlayCount, 0, "admin notification inbox must stay free of framework overlays after delete");
    assert.equal(afterState.scrollWidth, afterState.clientWidth, "admin notification inbox must not overflow horizontally after delete");
    assert.equal(messages.length, 0, `admin notification inbox must not log console/page warnings: ${messages.join(" | ")}`);
    assert(statSync(confirmScreenshotPath).size > 10_000, "mobile notifications confirm screenshot must be non-empty");
    assert(statSync(afterScreenshotPath).size > 10_000, "mobile notifications after screenshot must be non-empty");

    return {
      afterScreenshotPath,
      afterScreenshotSizeBytes: statSync(afterScreenshotPath).size,
      afterState,
      confirmScreenshotPath,
      confirmScreenshotSizeBytes: statSync(confirmScreenshotPath).size,
      feedbackText,
      initialState,
      messages,
      mobileDeleteButtonWidth: mobileDeleteButtonBox.width,
      title,
      url: page.url(),
      viewport: "390x844",
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const executablePath = findChromeExecutable();
  let browser = null;
  let resetAfter = null;

  assert(executablePath, `Chrome/Chromium is required for notice delete UI proof against ${baseUrl}`);
  mkdirSync(outDir, { recursive: true });

  try {
    await ensureLocalAppServer();

    const resetBefore = await resetDevData("before");
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      executablePath,
      headless: true,
    });

    const noticesScreen = await verifyNoticesScreenDelete(browser);
    const mobileNoticesActionLayout = await verifyMobileNoticesScreenActionLayout(browser);
    const notificationInbox = await verifyNotificationInboxDelete(browser);

    resetAfter = await resetDevData("after");

    const summaryPath = join(outDir, "summary.json");
    const previousSummary = existsSync(summaryPath)
      ? JSON.parse(readFileSync(summaryPath, "utf8"))
      : {};
    const summary = {
      ok: true,
      baseUrl,
      appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
      browserAvailability: "Browser skill present but node_repl js tool unavailable; Playwright fallback used",
      checked: [
        "admin notices screen delete button opens a confirm step",
        "admin notices screen confirmed delete removes the notice and shows feedback",
        "admin mobile notices screen action row stacks below the title row",
        "admin mobile notices screen bottom safe-area keeps the last notice above the bottom navigation",
        "admin mobile notification inbox delete button opens a confirm step",
        "admin mobile notification inbox delete action stays compact on 390px screens",
        "admin mobile notification inbox confirmed delete removes the notice and shows feedback",
        "delete UI screens stay nonblank, overlay-free, console-clean, and horizontally contained",
      ],
      iosSimulator: previousSummary.iosSimulator ?? null,
      mobileNoticesActionLayout,
      notificationInbox,
      noticesScreen,
      resetAfter,
      resetBefore,
    };

    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  } finally {
    await browser?.close();
    if (!resetAfter && (await canReachAppServer())) {
      await resetDevData("after-failure").catch(() => null);
    }
    await stopManagedAppServer();
  }
}

main().catch((error) => {
  console.error(`notice delete UI check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
