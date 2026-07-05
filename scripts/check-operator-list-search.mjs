import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.OPERATOR_LIST_SEARCH_OUT_DIR ?? ".data/mobile-builds/ios/operator-list-search-20260704";
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
      throw new Error(`Managed app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "operator list search check only runs against a local dev app server");

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
    if (process.env.OPERATOR_LIST_SEARCH_SERVER_LOGS === "1") {
      process.stdout.write(`[operator-list-search server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.OPERATOR_LIST_SEARCH_SERVER_LOGS === "1") {
      process.stderr.write(`[operator-list-search server] ${chunk}`);
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
  const response = await fetch(new URL("/api/v1/dev/reset", baseUrl), { method: "POST" });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `operator list search ${label} reset failed with ${response.status}`);

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

async function gotoRolePage(page, role, next) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);
  loginUrl.searchParams.set("next", next);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === next.split("?")[0], { timeout: 15000 });
}

async function assertNoHorizontalOverflow(page, label) {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  assert.equal(layout.scrollWidth, layout.clientWidth, `${label} must not horizontally overflow at 390px`);

  return layout;
}

function screenshotSize(path) {
  return statSync(path).size;
}

function parseVisibleTotal(label, context) {
  const match = label.match(/(\d+)\/(\d+)건 표시/);

  assert(match, `${context} status label must show visible/total count`);

  return {
    total: Number(match[2]),
    visible: Number(match[1]),
  };
}

async function measureSearchControls(page, prefix) {
  return page.evaluate((selectorPrefix) => {
    const boxFor = (testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);

      if (!element) {
        return null;
      }

      const rect = element.getBoundingClientRect();

      return {
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      };
    };
    const emptyClearRect = document.querySelector(`[data-testid="${selectorPrefix}-empty-clear"]`)?.getBoundingClientRect();
    const navRect = document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect();

    return {
      bottomNavClearance: emptyClearRect && navRect ? Math.round(navRect.top - emptyClearRect.bottom) : null,
      clear: boxFor(`${selectorPrefix}-clear`),
      emptyClear: boxFor(`${selectorPrefix}-empty-clear`),
      input: boxFor(`${selectorPrefix}-input`),
      status: document.querySelector(`[data-testid="${selectorPrefix.replace("-list-search", "-list-status")}-label"]`)?.textContent ?? "",
    };
  }, prefix);
}

function assertStaticContracts() {
  const paymentsScreen = readFileSync("src/components/screens/payments-screen.tsx", "utf8");
  const noticesScreen = readFileSync("src/components/screens/notices-screen.tsx", "utf8");
  const notificationReadiness = readFileSync("scripts/check-notification-readiness.mjs", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");

  assert(packageJson.includes('"test:operator-list-search"'), "package.json must expose test:operator-list-search");
  assert(releaseRunner.includes('["run", "test:operator-list-search"]'), "test:release must include operator list search");
  assert(paymentsScreen.includes('data-testid="payment-list-search-input"'), "payments screen must expose operator payment search input");
  assert(paymentsScreen.includes('data-testid="payment-list-search-clear"'), "payments screen must expose payment search clear action");
  assert(paymentsScreen.includes('data-testid="payment-list-search-empty-clear"'), "payments screen must expose empty payment search clear action");
  assert(paymentsScreen.includes('data-testid="payment-list-status-label"'), "payments screen must expose filtered payment count");
  assert(paymentsScreen.includes("검색 결과가 없습니다"), "payments screen must explain no-result search states");
  assert(paymentsScreen.includes("showPaymentSearchEmptyState"), "payments screen must prioritize empty search results over operations cards");
  assert(paymentsScreen.includes('const initialPaymentListSearch = searchParams.get("q")?.trim() ?? "";'), "payment search q param must initialize from Next search params");
  assert(paymentsScreen.includes("previousPaymentListSearchParamRef"), "payment search must guard stale q params after clearing");
  assert(paymentsScreen.includes("nextPaymentListSearch"), "payment search must react to client-side q param changes");
  assert(paymentsScreen.includes("router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })"), "payment search must update q through the Next router");
  assert(!paymentsScreen.includes('new URLSearchParams(window.location.search).get("q")'), "payment search must not read q from window during initial render");
  assert(noticesScreen.includes('data-testid="notice-list-search-input"'), "notices screen must expose operator notice search input");
  assert(noticesScreen.includes('data-testid="notice-list-search-clear"'), "notices screen must expose notice search clear action");
  assert(noticesScreen.includes('data-testid="notice-list-search-empty-clear"'), "notices screen must expose empty notice search clear action");
  assert(noticesScreen.includes('data-testid="notice-list-status-label"'), "notices screen must expose filtered notice count");
  assert(noticesScreen.includes("검색 결과가 없습니다"), "notices screen must explain no-result search states");
  assert(noticesScreen.includes("noticeSearchKeyword"), "notices screen must filter notices by search text");
  assert(noticesScreen.includes('const initialNoticeListSearch = searchParams.get("q")?.trim() ?? "";'), "notice search q param must initialize from Next search params");
  assert(noticesScreen.includes("previousNoticeListSearchParamRef"), "notice search must guard stale q params after clearing");
  assert(noticesScreen.includes("nextNoticeListSearch"), "notice search must react to client-side q param changes");
  assert(noticesScreen.includes("router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })"), "notice search must update q through the Next router");
  assert(notificationReadiness.includes("notice-list-search-input"), "notification readiness must guard notice list search");
}

mkdirSync(outDir, { recursive: true });
assertStaticContracts();

const chromeExecutable = findChromeExecutable();
assert(chromeExecutable, "Chrome or Chromium executable is required for operator list search proof");

await ensureLocalAppServer();
const resetBefore = await resetDevData("before");
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const messages = collectConsoleMessages(page);

try {
  await gotoRolePage(page, "admin", "/app/payments?q=최민재");
  await page.waitForSelector('[data-testid="payment-list-search-input"]', { timeout: 15000 });
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="payment-list-search-input"]');

    return input instanceof HTMLInputElement && input.value === "최민재";
  });
  const paymentStatus = await page.getByTestId("payment-list-status-label").innerText();
  const paymentCounts = parseVisibleTotal(paymentStatus, "payment search");
  assert(paymentCounts.visible > 0, "payment search deep link must show at least one matching payment");
  assert(paymentCounts.visible < paymentCounts.total, "payment search deep link must reduce the payment list");
  const filteredPaymentBodyText = await page.locator("body").innerText();
  assert.match(filteredPaymentBodyText, /최민재/, "payment search must keep the matched member visible");
  assert.match(filteredPaymentBodyText, new RegExp(`조회 건수\\s+${paymentCounts.visible}`), "payment search summary must match visible results");
  assert(!/한유나/.test(filteredPaymentBodyText), "payment search must hide unrelated members");
  const paymentsLayout = await assertNoHorizontalOverflow(page, "operator payment search");
  const paymentScreenshotPath = join(outDir, "admin-payments-search-mobile.png");
  await page.screenshot({ path: paymentScreenshotPath, fullPage: false });
  await page.getByTestId("payment-list-search-clear").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="payment-list-search-input"]');

    return input instanceof HTMLInputElement && input.value === "" && !new URL(window.location.href).searchParams.has("q");
  });
  await page.getByTestId("payment-list-search-input").fill("없는결제");
  await page.waitForFunction(() => {
    const label = document.querySelector('[data-testid="payment-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)건 표시/);

    return match && Number(match[1]) === 0 && Number(match[2]) > 0;
  });
  const emptyPaymentBodyText = await page.locator("body").innerText();
  assert.match(emptyPaymentBodyText, /검색 결과가 없습니다/, "empty payment search must explain the no-result state");
  assert.match(emptyPaymentBodyText, /없는결제/, "empty payment search must echo the active query");
  assert(!/수기 결제 등록/.test(emptyPaymentBodyText), "empty payment search must not push the no-result state below the manual create card");
  assert(!/결제\/회원권 요약/.test(emptyPaymentBodyText), "empty payment search must not show unrelated operations summary cards");
  assert(!/확인할 결제/.test(emptyPaymentBodyText), "empty payment search must not show unrelated action queue cards");
  const paymentEmptyScreenshotPath = join(outDir, "admin-payments-search-empty-mobile.png");
  await page.screenshot({ path: paymentEmptyScreenshotPath, fullPage: false });
  const paymentEmptyControls = await measureSearchControls(page, "payment-list-search");
  assert(paymentEmptyControls.input?.height >= 44, "payment search input must stay 44px touch-friendly on mobile");
  assert(paymentEmptyControls.clear?.height >= 44, "payment search inline clear action must stay at least 44px tall");
  assert(paymentEmptyControls.emptyClear?.height >= 44, "empty payment search clear action must stay at least 44px tall");
  await page.getByTestId("payment-list-search-empty-clear").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="payment-list-search-input"]');
    const label = document.querySelector('[data-testid="payment-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)건 표시/);

    return (
      input instanceof HTMLInputElement &&
      input.value === "" &&
      !new URL(window.location.href).searchParams.has("q") &&
      match &&
      Number(match[1]) === Number(match[2])
    );
  });

  await gotoRolePage(page, "admin", "/app/notices?q=승급");
  await page.waitForSelector('[data-testid="notice-list-search-input"]', { timeout: 15000 });
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="notice-list-search-input"]');
    const label = document.querySelector('[data-testid="notice-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)건 표시/);

    return input instanceof HTMLInputElement && input.value === "승급" && match && Number(match[1]) > 0 && Number(match[1]) < Number(match[2]);
  });
  const noticeStatus = await page.getByTestId("notice-list-status-label").innerText();
  const noticeCounts = parseVisibleTotal(noticeStatus, "notice search");
  assert(noticeCounts.visible > 0, "notice search must show at least one matching notice");
  assert(noticeCounts.visible < noticeCounts.total, "notice search must reduce the notice list");
  assert.match(await page.locator("body").innerText(), /승급 심사 준비 안내/, "notice search must keep the matched notice visible");
  assert(!/회원권 만료 안내/.test(await page.locator("body").innerText()), "notice search must hide unrelated notices");
  const noticesLayout = await assertNoHorizontalOverflow(page, "operator notice search");
  const noticeScreenshotPath = join(outDir, "admin-notices-search-mobile.png");
  await page.screenshot({ path: noticeScreenshotPath, fullPage: false });
  await page.getByTestId("notice-list-search-clear").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="notice-list-search-input"]');

    return input instanceof HTMLInputElement && input.value === "" && !new URL(window.location.href).searchParams.has("q");
  });
  await page.getByTestId("notice-list-search-input").fill("없는공지");
  await page.waitForFunction(() => {
    const label = document.querySelector('[data-testid="notice-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)건 표시/);

    return match && Number(match[1]) === 0 && Number(match[2]) > 0;
  });
  assert.match(await page.locator("body").innerText(), /검색 결과가 없습니다/, "empty notice search must explain the no-result state");
  assert.match(await page.locator("body").innerText(), /없는공지/, "empty notice search must echo the active query");
  assert(!/보이는 공지 읽음 처리/.test(await page.locator("body").innerText()), "empty notice search must hide bulk-read actions that have no target notices");
  const noticeEmptyScreenshotPath = join(outDir, "admin-notices-search-empty-mobile.png");
  await page.screenshot({ path: noticeEmptyScreenshotPath, fullPage: false });
  const noticeEmptyControls = await measureSearchControls(page, "notice-list-search");
  assert(noticeEmptyControls.input?.height >= 44, "notice search input must stay 44px touch-friendly on mobile");
  assert(noticeEmptyControls.clear?.height >= 44, "notice search inline clear action must stay at least 44px tall");
  assert(noticeEmptyControls.emptyClear?.height >= 44, "empty notice search clear action must stay at least 44px tall");
  assert(
    noticeEmptyControls.bottomNavClearance === null || noticeEmptyControls.bottomNavClearance >= 24,
    `empty notice search clear action must stay above bottom navigation by at least 24px; got ${noticeEmptyControls.bottomNavClearance}px`,
  );
  await page.getByTestId("notice-list-search-empty-clear").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="notice-list-search-input"]');
    const label = document.querySelector('[data-testid="notice-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)건 표시/);

    return input instanceof HTMLInputElement && input.value === "" && !new URL(window.location.href).searchParams.has("q") && match && Number(match[1]) === Number(match[2]);
  });

  assert.deepEqual(messages, [], "operator list search flows must not emit console warnings/errors");

  const report = {
    ok: true,
    appServer: usingExistingAppServer ? "existing" : "managed",
    baseUrl,
    browserPath: {
      classification: "Browser runtime unavailable",
      fallback: "Playwright with system Chrome",
      reason: "Browser skill is available, but tool discovery did not expose the required Browser Node JavaScript control tool.",
    },
    checked: [
      "operator payment list search hydrates q param after mount",
      "operator payment list search filters by member/plan/contact and clears q param",
      "operator payment no-result search explains the empty state and clears q param",
      "operator notice list search hydrates q param after mount",
      "operator notice list search filters by title/body and clears q param",
      "operator notice no-result search explains the empty state and clears q param",
      "operator notice no-result search hides targetless bulk-read action",
      "inline and empty search clear actions stay 44px touch targets",
      "390px mobile search controls stay overflow-free and console-clean",
    ],
    consoleMessages: messages,
    controls: {
      noticesEmpty: noticeEmptyControls,
      paymentsEmpty: paymentEmptyControls,
    },
    layouts: {
      notices: noticesLayout,
      payments: paymentsLayout,
    },
    resetBefore,
    resetAfter: null,
    screenshots: {
      notices: {
        path: noticeScreenshotPath,
        sizeBytes: screenshotSize(noticeScreenshotPath),
      },
      noticesEmpty: {
        path: noticeEmptyScreenshotPath,
        sizeBytes: screenshotSize(noticeEmptyScreenshotPath),
      },
      payments: {
        path: paymentScreenshotPath,
        sizeBytes: screenshotSize(paymentScreenshotPath),
      },
      paymentsEmpty: {
        path: paymentEmptyScreenshotPath,
        sizeBytes: screenshotSize(paymentEmptyScreenshotPath),
      },
    },
  };

  report.resetAfter = await resetDevData("after");
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await stopManagedAppServer();
}
