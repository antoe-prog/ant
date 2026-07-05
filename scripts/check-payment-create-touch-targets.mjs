import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.PAYMENT_CREATE_TOUCH_TARGETS_OUT_DIR ?? ".data/mobile-builds/ios/payment-create-touch-targets-20260704";
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
      throw new Error(`Managed payment create app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed payment create app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "payment create touch-target check only runs against a local dev app server");

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
    if (process.env.PAYMENT_CREATE_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stdout.write(`[payment-create-touch-targets server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.PAYMENT_CREATE_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stderr.write(`[payment-create-touch-targets server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "payment create touch-target check only mutates local dev data");

  const response = await fetch(new URL("/api/v1/dev/reset", baseUrl), { method: "POST" });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `payment create touch-target ${label} reset failed with ${response.status}`);

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

function cleanPaymentCreateOutputDir() {
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

function assertStaticContracts() {
  const packageJson = readFileSync("package.json", "utf8");
  const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");
  const paymentsScreen = readFileSync("src/components/screens/payments-screen.tsx", "utf8");

  assert(packageJson.includes('"test:payment-create-touch-targets"'), "package.json must expose test:payment-create-touch-targets");
  assert(
    releaseRunner.includes('["run", "test:payment-create-touch-targets"]'),
    "test:release must include payment create touch-target proof",
  );
  for (const snippet of [
    'data-testid="payment-export-button"',
    'data-testid="payment-status-filter"',
    'data-testid="payment-operations-metric"',
    'data-testid="payment-renewal-prefill"',
    'data-testid="payment-online-request-button"',
    'data-testid="payment-recurring-create-button"',
    'data-testid="payment-adjustment-form"',
    'data-testid="payment-refund-amount-input"',
    'data-testid="payment-adjustment-reason-input"',
    'data-testid="payment-refund-submit"',
    'data-testid="payment-cancel-submit"',
    'data-testid="payment-create-form"',
    'data-testid="payment-create-toggle"',
    'data-testid="payment-create-fields"',
    'data-testid="payment-create-member-search-input"',
    'data-testid="payment-create-member-result"',
    'data-testid="payment-create-selected-member"',
    'data-testid="payment-create-submit"',
    "회원 이름, 연락처, 보호자 검색",
  ]) {
    assert(paymentsScreen.includes(snippet), `payments screen must include ${snippet}`);
  }
  assert(!paymentsScreen.includes("선택 가능한 샘플 회원"), "payment create form must not expose sample member copy");
}

async function gotoOwnerPayments(page) {
  const next = "/app/payments";
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", "owner");
  loginUrl.searchParams.set("next", next);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === "/app/payments", { timeout: 15000 });
  await page.waitForSelector('[data-testid="payment-create-toggle"]', { timeout: 15000 });
}

async function collectCollapsedLayout(page, { requireRefundRowAlignment = false } = {}) {
  const layout = await page.evaluate(() => {
    const toggle = document.querySelector('[data-testid="payment-create-toggle"]')?.getBoundingClientRect();
    const readHeights = (selector) =>
      Array.from(document.querySelectorAll(selector)).map((element) => Math.round(element.getBoundingClientRect().height));
    const actionControlSelectors = [
      '[data-testid="payment-renewal-prefill"]',
      '[data-testid="payment-online-request-button"]',
      '[data-testid="payment-recurring-create-button"]',
      '[data-testid^="payment-refund-full-amount-"]',
      '[data-testid="payment-refund-submit"]',
      '[data-testid="payment-cancel-submit"]',
      '[data-testid="payment-recurring-cancel-button"]',
      '[data-testid="payment-recurring-cancel-submit"]',
      '[data-testid="payment-online-checkout-link"]',
      '[data-testid="payment-receipt-link"]',
    ];
    const actionControlHeights = Object.fromEntries(
      actionControlSelectors.map((selector) => [selector, readHeights(selector)]),
    );
    const topControlHeights = {
      exportButton: readHeights('[data-testid="payment-export-button"]'),
      listSearchInput: readHeights('[data-testid="payment-list-search-input"]'),
      listStatusLabel: readHeights('[data-testid="payment-list-status-label"]'),
      operationsMetrics: readHeights('[data-testid="payment-operations-metric"]'),
      statusFilter: readHeights('[data-testid="payment-status-filter"]'),
    };
    const refundFormControlRows = Array.from(document.querySelectorAll('[data-testid="payment-adjustment-form"]'))
      .map((form) => {
        const amountInput = form.querySelector('[data-testid="payment-refund-amount-input"]')?.getBoundingClientRect();
        const fullAmountButton = form.querySelector('[data-testid^="payment-refund-full-amount-"]')?.getBoundingClientRect();
        const reasonInput = form.querySelector('[data-testid="payment-adjustment-reason-input"]')?.getBoundingClientRect();
        const submitButton = form.querySelector('[data-testid="payment-refund-submit"]')?.getBoundingClientRect();

        if (!amountInput || !fullAmountButton || !reasonInput || !submitButton) {
          return null;
        }

        return {
          amountInputBottom: Math.round(amountInput.bottom),
          amountInputTop: Math.round(amountInput.top),
          fullAmountButtonBottom: Math.round(fullAmountButton.bottom),
          fullAmountButtonTop: Math.round(fullAmountButton.top),
          reasonInputBottom: Math.round(reasonInput.bottom),
          reasonInputTop: Math.round(reasonInput.top),
          submitButtonBottom: Math.round(submitButton.bottom),
          submitButtonTop: Math.round(submitButton.top),
        };
      })
      .filter(Boolean);

    return {
      actionControlHeights,
      bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
      clientWidth: document.documentElement.clientWidth,
      fieldsCount: document.querySelectorAll('[data-testid="payment-create-fields"]').length,
      formCount: document.querySelectorAll('[data-testid="payment-create-form"]').length,
      refundFormControlRows,
      scrollWidth: document.documentElement.scrollWidth,
      topControlHeights,
      toggleHeight: Math.round(toggle?.height ?? 0),
    };
  });

  assert.equal(layout.formCount, 1, "owner payments must render one manual payment create form");
  assert.equal(layout.fieldsCount, 0, "payment create fields must stay collapsed by default");
  assert(layout.toggleHeight >= 44, `payment create toggle must stay 44px tall; got ${layout.toggleHeight}px`);
  for (const [label, heights] of Object.entries(layout.topControlHeights)) {
    assert(heights.length > 0, `owner payment ${label} control must be rendered`);
    for (const [index, height] of heights.entries()) {
      assert(height >= 44, `owner payment ${label} control ${index + 1} must stay 44px tall; got ${height}px`);
    }
  }
  for (const requiredSelector of [
    '[data-testid="payment-renewal-prefill"]',
    '[data-testid="payment-online-request-button"]',
    '[data-testid="payment-recurring-create-button"]',
    '[data-testid^="payment-refund-full-amount-"]',
    '[data-testid="payment-refund-submit"]',
    '[data-testid="payment-cancel-submit"]',
  ]) {
    assert(
      layout.actionControlHeights[requiredSelector]?.length > 0,
      `owner payment action ${requiredSelector} must be present in seeded payment rows`,
    );
  }
  for (const [selector, heights] of Object.entries(layout.actionControlHeights)) {
    for (const [index, height] of heights.entries()) {
      assert(height >= 44, `owner payment action ${selector} ${index + 1} must stay 44px tall; got ${height}px`);
    }
  }
  assert(layout.refundFormControlRows.length > 0, "owner payment rows must expose at least one refund form alignment sample");
  if (requireRefundRowAlignment) {
    for (const [index, row] of layout.refundFormControlRows.entries()) {
      const topValues = [row.amountInputTop, row.fullAmountButtonTop, row.reasonInputTop, row.submitButtonTop];
      const bottomValues = [row.amountInputBottom, row.fullAmountButtonBottom, row.reasonInputBottom, row.submitButtonBottom];
      const topDelta = Math.max(...topValues) - Math.min(...topValues);
      const bottomDelta = Math.max(...bottomValues) - Math.min(...bottomValues);

      assert(topDelta <= 1, `refund form ${index + 1} controls must start on one row; got ${topDelta}px top delta`);
      assert(bottomDelta <= 1, `refund form ${index + 1} controls must end on one row; got ${bottomDelta}px bottom delta`);
    }
  }
  assert.equal(layout.scrollWidth, layout.clientWidth, "collapsed owner payment create form must not overflow horizontally");
  assert.match(layout.bodyText, /수기 결제 등록/, "owner payments must show the manual payment create affordance");

  return layout;
}

async function collectSearchResultLayout(page) {
  const layout = await page.evaluate(() => {
    const fields = document.querySelector('[data-testid="payment-create-fields"]')?.getBoundingClientRect();
    const searchInput = document.querySelector('[data-testid="payment-create-member-search-input"]')?.getBoundingClientRect();
    const results = Array.from(document.querySelectorAll('[data-testid="payment-create-member-result"]')).map((result) =>
      Math.round(result.getBoundingClientRect().height),
    );
    const controls = Array.from(
      document.querySelectorAll('[data-testid="payment-create-fields"] input, [data-testid="payment-create-fields"] select'),
    ).map((control) => ({
      ariaLabel: control.getAttribute("aria-label"),
      height: Math.round(control.getBoundingClientRect().height),
      tag: control.tagName.toLowerCase(),
      type: control.getAttribute("type") ?? "",
    }));
    const submit = document.querySelector('[data-testid="payment-create-submit"]')?.getBoundingClientRect();

    return {
      bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
      clientWidth: document.documentElement.clientWidth,
      controlHeights: controls.map((control) => control.height),
      controls,
      fieldsHeight: Math.round(fields?.height ?? 0),
      resultHeights: results,
      resultText: Array.from(document.querySelectorAll('[data-testid="payment-create-member-result"]'))
        .map((result) => result.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .join(" | "),
      scrollWidth: document.documentElement.scrollWidth,
      searchInputHeight: Math.round(searchInput?.height ?? 0),
      submitDisabled: document.querySelector('[data-testid="payment-create-submit"]') instanceof HTMLButtonElement
        ? document.querySelector('[data-testid="payment-create-submit"]').disabled
        : null,
      submitHeight: Math.round(submit?.height ?? 0),
    };
  });

  assert(layout.fieldsHeight > 0, "payment create fields must open after tapping the toggle");
  assert(layout.searchInputHeight >= 44, `payment member search input must stay 44px tall; got ${layout.searchInputHeight}px`);
  assert(layout.controlHeights.length >= 7, "payment create form must expose searchable member, plan, status, amount, and date controls");
  for (const [index, height] of layout.controlHeights.entries()) {
    assert(height >= 44, `payment create control ${index + 1} must stay 44px tall; got ${height}px`);
  }
  assert(layout.resultHeights.length > 0, "payment create search must return at least one member result");
  for (const [index, height] of layout.resultHeights.entries()) {
    assert(height >= 44, `payment create search result ${index + 1} must stay 44px tall; got ${height}px`);
  }
  assert.match(layout.resultText, /최민재/, "payment create search result must include the searched member");
  assert.equal(layout.submitDisabled, true, "payment create submit must remain disabled before selecting a member");
  assert(layout.submitHeight >= 44, `payment create submit must stay 44px tall; got ${layout.submitHeight}px`);
  assert.equal(layout.scrollWidth, layout.clientWidth, "payment create search state must not overflow horizontally");
  assert.doesNotMatch(layout.bodyText, /샘플|예시|더미|테스트 회원/i, "payment create form must not show sample/test member copy");

  return layout;
}

async function collectSelectedLayout(page) {
  const layout = await page.evaluate(() => {
    const selected = document.querySelector('[data-testid="payment-create-selected-member"]')?.getBoundingClientRect();
    const submit = document.querySelector('[data-testid="payment-create-submit"]')?.getBoundingClientRect();

    return {
      clientWidth: document.documentElement.clientWidth,
      resultCount: document.querySelectorAll('[data-testid="payment-create-member-result"]').length,
      scrollWidth: document.documentElement.scrollWidth,
      selectedHeight: Math.round(selected?.height ?? 0),
      selectedText: document.querySelector('[data-testid="payment-create-selected-member"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      submitDisabled: document.querySelector('[data-testid="payment-create-submit"]') instanceof HTMLButtonElement
        ? document.querySelector('[data-testid="payment-create-submit"]').disabled
        : null,
      submitHeight: Math.round(submit?.height ?? 0),
    };
  });

  assert.match(layout.selectedText, /최민재/, "payment create selected member card must show the chosen member");
  assert(layout.selectedHeight >= 44, `payment create selected member card must remain readable; got ${layout.selectedHeight}px`);
  assert.equal(layout.resultCount, 0, "payment create results must collapse after selecting a member");
  assert.equal(layout.submitDisabled, false, "payment create submit must enable after selecting a member");
  assert(layout.submitHeight >= 44, `payment create submit must stay 44px tall after selection; got ${layout.submitHeight}px`);
  assert.equal(layout.scrollWidth, layout.clientWidth, "payment create selected state must not overflow horizontally");

  return layout;
}

mkdirSync(outDir, { recursive: true });
const cleanedOutputFiles = cleanPaymentCreateOutputDir();
assertStaticContracts();

const chromeExecutable = findChromeExecutable();
assert(chromeExecutable, "Chrome or Chromium executable is required for payment create touch-target proof");

let browser = null;
let desktopPage = null;
let page = null;
let resetBefore = null;

try {
  await ensureLocalAppServer();
  resetBefore = await resetDevData("before");
  browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const messages = collectConsoleMessages(page);
  desktopPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const desktopMessages = collectConsoleMessages(desktopPage);

  await gotoOwnerPayments(page);
  const collapsedLayout = await collectCollapsedLayout(page);
  const collapsedScreenshotPath = join(outDir, "owner-payments-create-collapsed-mobile.png");
  await page.screenshot({ path: collapsedScreenshotPath, fullPage: false });

  await gotoOwnerPayments(desktopPage);
  const desktopRefundLayout = await collectCollapsedLayout(desktopPage, { requireRefundRowAlignment: true });
  const desktopRefundScreenshotPath = join(outDir, "owner-payments-refund-aligned-desktop.png");
  await desktopPage.screenshot({ path: desktopRefundScreenshotPath, fullPage: false });

  await page.getByTestId("payment-create-toggle").click();
  await page.waitForSelector('[data-testid="payment-create-fields"]', { timeout: 10000 });
  await page.getByTestId("payment-create-member-search-input").fill("최민재");
  await page.waitForSelector('[data-testid="payment-create-member-result"]', { timeout: 10000 });
  const searchLayout = await collectSearchResultLayout(page);
  const searchScreenshotPath = join(outDir, "owner-payments-create-search-mobile.png");
  await page.screenshot({ path: searchScreenshotPath, fullPage: false });

  await page.getByTestId("payment-create-member-result").first().click();
  await page.waitForSelector('[data-testid="payment-create-selected-member"]', { timeout: 10000 });
  const selectedLayout = await collectSelectedLayout(page);
  const selectedScreenshotPath = join(outDir, "owner-payments-create-selected-mobile.png");
  await page.screenshot({ path: selectedScreenshotPath, fullPage: false });
  await page.getByTestId("payment-create-submit").click();
  await page.waitForTimeout(250);

  assert.deepEqual(messages, [], `payment create touch-target flow must not emit console warnings/errors: ${messages.join(" | ")}`);
  assert.deepEqual(desktopMessages, [], `payment refund desktop alignment flow must not emit console warnings/errors: ${desktopMessages.join(" | ")}`);

  const report = {
    ok: true,
    appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
    baseUrl,
    browserPath: {
      classification: "Browser runtime unavailable",
      fallback: "Playwright with system Chrome",
      reason: "Browser skill is available, but tool discovery did not expose the required Browser Node JavaScript control tool.",
    },
    checked: [
      "owner manual payment create form stays collapsed by default",
      "owner payment export, filter, summary status, operations metrics, and row actions stay 44px touch targets",
      "desktop refund amount, full amount, reason, and submit controls stay aligned on one row",
      "payment create toggle, search input, results, fields, and submit action stay 44px touch targets",
      "payment create member search finds and selects a real member without scroll-only picker behavior",
      "payment create submit enables only after member selection",
      "390px owner payment create flow stays overflow-free and console-clean",
    ],
    consoleMessages: messages,
    layouts: {
      collapsed: collapsedLayout,
      desktopRefund: desktopRefundLayout,
      search: searchLayout,
      selected: selectedLayout,
    },
    outputCleanup: {
      outDir,
      removedCount: cleanedOutputFiles.length,
      removedFiles: cleanedOutputFiles,
    },
    resetAfter: await resetDevData("after"),
    resetBefore,
    screenshots: {
      collapsed: {
        path: collapsedScreenshotPath,
        sizeBytes: statSync(collapsedScreenshotPath).size,
      },
      search: {
        path: searchScreenshotPath,
        sizeBytes: statSync(searchScreenshotPath).size,
      },
      selected: {
        path: selectedScreenshotPath,
        sizeBytes: statSync(selectedScreenshotPath).size,
      },
      desktopRefund: {
        path: desktopRefundScreenshotPath,
        sizeBytes: statSync(desktopRefundScreenshotPath).size,
      },
    },
  };

  for (const [label, screenshot] of Object.entries(report.screenshots)) {
    assert(screenshot.sizeBytes > 10_000, `${label} screenshot must be non-empty, got ${screenshot.sizeBytes} bytes`);
  }

  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await desktopPage?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await stopManagedAppServer();
}
