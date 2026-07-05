import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.ADMIN_AUDIT_SEARCH_OUT_DIR ?? ".data/mobile-builds/ios/admin-audit-search-20260704";
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
      throw new Error(`Managed admin audit search app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed admin audit search app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "admin audit search check only runs against a local dev app server");

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
    if (process.env.ADMIN_AUDIT_SEARCH_SERVER_LOGS === "1") {
      process.stdout.write(`[admin-audit-search server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.ADMIN_AUDIT_SEARCH_SERVER_LOGS === "1") {
      process.stderr.write(`[admin-audit-search server] ${chunk}`);
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

  assert(response.ok, `admin audit search ${label} reset failed with ${response.status}`);

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

async function loginTo(page, nextPath) {
  await page.goto(
    new URL(`/api/v1/dev/auto-login?role=admin&next=${encodeURIComponent(nextPath)}`, baseUrl).toString(),
    { waitUntil: "load" },
  );
}

async function readLayout(page) {
  return page.evaluate(() => {
    const inputRect = document.querySelector('[data-testid="admin-audit-search-input"]')?.getBoundingClientRect();
    const clearRect = document.querySelector('[data-testid="admin-audit-search-clear"]')?.getBoundingClientRect();
    const submitRect = document.querySelector('[data-testid="admin-audit-filter-submit"]')?.getBoundingClientRect();
    const resetRect = document.querySelector('[data-testid="admin-audit-filter-reset"]')?.getBoundingClientRect();
    const emptyResetRect = document.querySelector('[data-testid="admin-audit-empty-filter-reset"]')?.getBoundingClientRect();
    const navRect = document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect();

    return {
      activeSummaryText: document.querySelector('[data-testid="admin-audit-active-filter-summary"]')?.textContent ?? "",
      clearButtonCount: document.querySelectorAll('[data-testid="admin-audit-search-clear"]').length,
      clearButtonHeight: Math.round(clearRect?.height ?? 0),
      clearButtonWidth: Math.round(clearRect?.width ?? 0),
      clientWidth: document.documentElement.clientWidth,
      emptyResetBottomNavClearance: emptyResetRect && navRect ? Math.round(navRect.top - emptyResetRect.bottom) : null,
      emptyResetHeight: Math.round(emptyResetRect?.height ?? 0),
      inputHeight: Math.round(inputRect?.height ?? 0),
      resetBottomNavClearance: resetRect && navRect ? Math.round(navRect.top - resetRect.bottom) : null,
      resetHeight: Math.round(resetRect?.height ?? 0),
      rowCount: document.querySelectorAll('[data-testid="admin-audit-log-row"]').length,
      scrollWidth: document.documentElement.scrollWidth,
      submitHeight: Math.round(submitRect?.height ?? 0),
    };
  });
}

function assertStaticContracts() {
  const packageJson = readFileSync("package.json", "utf8");
  const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");
  const adminAuditScreen = readFileSync("src/components/screens/admin-audit-logs-screen.tsx", "utf8");
  const adminAuditRoute = readFileSync("src/app/api/v1/admin/audit-logs/route.ts", "utf8");

  assert(packageJson.includes('"test:admin-audit-search"'), "package.json must expose test:admin-audit-search");
  assert(releaseRunner.includes('["run", "test:admin-audit-search"]'), "test:release must include admin audit search");
  assert(adminAuditScreen.includes("useSearchParams"), "admin audit screen must hydrate filters from Next search params");
  assert(adminAuditScreen.includes("router.replace(nextUrl, { scroll: false })"), "admin audit screen must write applied filters to the URL");
  assert(adminAuditScreen.includes('data-testid="admin-audit-search-input"'), "admin audit screen must expose a stable search input hook");
  assert(adminAuditScreen.includes('data-testid="admin-audit-search-clear"'), "admin audit screen must expose a search clear action");
  assert(adminAuditScreen.includes('data-testid="admin-audit-filter-reset"'), "admin audit screen must expose a filter reset action");
  assert(adminAuditScreen.includes('data-testid="admin-audit-empty-filter-reset"'), "admin audit screen must expose an empty state reset action");
  assert(adminAuditRoute.includes('"promotion.create"'), "admin audit API must accept promotion.create filter values shown in the UI");
  assert(adminAuditRoute.includes('"promotion.update"'), "admin audit API must accept promotion.update filter values shown in the UI");
}

mkdirSync(outDir, { recursive: true });
assertStaticContracts();

const chromeExecutable = findChromeExecutable();
assert(chromeExecutable, "Chrome or Chromium executable is required for admin audit search proof");

await ensureLocalAppServer();
const resetBefore = await resetDevData("before");
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const messages = collectConsoleMessages(page);

try {
  await loginTo(page, "/app/admin/audit-logs?q=회원권");
  await page.waitForURL((url) => url.pathname === "/app/admin/audit-logs" && url.searchParams.get("q") === "회원권", {
    timeout: 15000,
  });
  await page.waitForSelector('[data-testid="admin-audit-log-row"]', { timeout: 15000 });
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="admin-audit-log-row"]'));

    return rows.length === 1 && rows[0]?.textContent?.includes("회원권 결제를 등록했습니다.");
  });

  const filteredText = await page.locator('[data-testid="admin-audit-log-row"]').innerText();
  assert.match(filteredText, /회원권 결제를 등록했습니다/, "admin audit q deep link must keep the matching payment audit log visible");
  assert.doesNotMatch(filteredText, /출석 상태를 변경했습니다/, "admin audit q deep link must hide unrelated audit logs");

  await page.getByTestId("admin-audit-filter-toggle").click();
  await page.waitForSelector('[data-testid="admin-audit-search-input"]');
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="admin-audit-search-input"]');

    return input instanceof HTMLInputElement && input.value === "회원권";
  });
  const filteredLayout = await readLayout(page);
  assert.match(filteredLayout.activeSummaryText, /검색 회원권/, "admin audit q deep link must show the applied search chip");
  assert(filteredLayout.inputHeight >= 44, `admin audit search input must stay 44px tall; got ${filteredLayout.inputHeight}px`);
  assert(filteredLayout.clearButtonHeight >= 44, `admin audit search clear action must stay 44px tall; got ${filteredLayout.clearButtonHeight}px`);
  assert(filteredLayout.clearButtonWidth >= 44, `admin audit search clear action must stay 44px wide; got ${filteredLayout.clearButtonWidth}px`);
  assert(filteredLayout.submitHeight >= 44, `admin audit filter submit must stay 44px tall; got ${filteredLayout.submitHeight}px`);
  assert(filteredLayout.resetHeight >= 44, `admin audit filter reset must stay 44px tall; got ${filteredLayout.resetHeight}px`);
  assert.equal(filteredLayout.scrollWidth, filteredLayout.clientWidth, "admin audit filtered search must not overflow horizontally");
  const filteredScreenshotPath = join(outDir, "admin-audit-search-mobile.png");
  await page.screenshot({ path: filteredScreenshotPath, fullPage: false });

  await page.getByTestId("admin-audit-search-clear").click();
  await page.getByTestId("admin-audit-filter-submit").click();
  await page.waitForFunction(() => {
    const url = new URL(window.location.href);

    return !url.searchParams.has("q") && document.querySelectorAll('[data-testid="admin-audit-log-row"]').length > 1;
  });

  await page.getByTestId("admin-audit-filter-toggle").click();
  await page.getByTestId("admin-audit-search-input").fill("없는변경기록");
  await page.getByTestId("admin-audit-filter-submit").click();
  await page.waitForSelector('[data-testid="admin-audit-empty-filter-reset"]', { timeout: 10000 });
  await page.waitForFunction(() => {
    const url = new URL(window.location.href);

    return url.searchParams.get("q") === "없는변경기록" && document.body.innerText.includes("조건에 맞는 변경 기록이 없습니다");
  });
  const emptyLayout = await readLayout(page);
  assert.equal(emptyLayout.rowCount, 0, "admin audit empty search must hide stale audit rows");
  assert(emptyLayout.emptyResetHeight >= 44, `admin audit empty reset action must stay 44px tall; got ${emptyLayout.emptyResetHeight}px`);
  assert(
    emptyLayout.emptyResetBottomNavClearance === null || emptyLayout.emptyResetBottomNavClearance >= 24,
    `admin audit empty reset action must clear bottom nav by at least 24px; got ${emptyLayout.emptyResetBottomNavClearance}px`,
  );
  assert.equal(emptyLayout.scrollWidth, emptyLayout.clientWidth, "admin audit empty search must not overflow horizontally");
  const emptyScreenshotPath = join(outDir, "admin-audit-search-empty-mobile.png");
  await page.screenshot({ path: emptyScreenshotPath, fullPage: false });

  await page.getByTestId("admin-audit-empty-filter-reset").click();
  await page.waitForFunction(() => {
    const url = new URL(window.location.href);

    return !url.searchParams.has("q") && document.querySelectorAll('[data-testid="admin-audit-log-row"]').length > 0;
  });

  const promotionFilterApi = await page.evaluate(async () => {
    const response = await fetch("/api/v1/admin/audit-logs?action=promotion.create&reason=승급 심사 필터 검증");
    const payload = await response.json().catch(() => ({}));

    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  });

  assert.equal(promotionFilterApi.ok, true, "admin audit API must accept promotion.create filters shown in the UI");
  assert.equal(promotionFilterApi.status, 200, "admin audit promotion filter API must return 200");
  assert.deepEqual(messages, [], `admin audit search flow must not emit console warnings/errors: ${messages.join(" | ")}`);

  const resetAfter = await resetDevData("after");
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
      "admin audit search hydrates q from the URL",
      "admin audit search clear and reset actions stay 44px touch targets",
      "admin audit empty search clears filters without stale rows or bottom-nav overlap",
      "admin audit API accepts promotion filters shown in the UI",
      "390px admin audit search stays overflow-free and console-clean",
    ],
    consoleMessages: messages,
    controls: {
      empty: emptyLayout,
      filtered: filteredLayout,
    },
    promotionFilterApi: {
      filteredCount: promotionFilterApi.payload?.data?.summary?.filteredCount ?? null,
      status: promotionFilterApi.status,
    },
    resetAfter,
    resetBefore,
    screenshots: {
      empty: {
        path: emptyScreenshotPath,
        sizeBytes: statSync(emptyScreenshotPath).size,
      },
      filtered: {
        path: filteredScreenshotPath,
        sizeBytes: statSync(filteredScreenshotPath).size,
      },
    },
  };

  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await stopManagedAppServer();
}
