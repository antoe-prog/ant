import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.ADMIN_ROLE_SEARCH_OUT_DIR ?? ".data/mobile-builds/ios/admin-role-search-20260704";
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
  assert(canMutateLocalDevData(), "admin role search check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "admin role search check",
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
    if (process.env.ADMIN_ROLE_SEARCH_SERVER_LOGS === "1") {
      process.stdout.write(`[admin-role-search server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.ADMIN_ROLE_SEARCH_SERVER_LOGS === "1") {
      process.stderr.write(`[admin-role-search server] ${chunk}`);
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
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `admin role search ${label} reset`,
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `admin role search ${label} reset failed with ${response.status}`);

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

async function gotoAdminRoles(page, next) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", "admin");
  loginUrl.searchParams.set("next", next);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === "/app/admin/roles", { timeout: 15000 });
}

function parseVisibleTotal(label) {
  const match = label.match(/(\d+)\/(\d+)명 표시/);

  assert(match, "admin role list status label must show visible/total user count");

  return {
    total: Number(match[2]),
    visible: Number(match[1]),
  };
}

async function readLayout(page) {
  return page.evaluate(() => {
    const resetRect = document.querySelector('[data-testid="admin-role-empty-filter-reset"]')?.getBoundingClientRect();
    const navRect = document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect();
    const inputRect = document.querySelector('[data-testid="admin-role-search-input"]')?.getBoundingClientRect();
    const clearRect = document.querySelector('[data-testid="admin-role-search-clear"]')?.getBoundingClientRect();
    const bottomSafeAreaRect = document.querySelector('[data-testid="admin-role-bottom-safe-area"]')?.getBoundingClientRect();
    const rowCount = document.querySelectorAll('[data-testid="admin-role-user-row"]').length;
    const supportingPanelVisibleCount = [...document.querySelectorAll('[data-testid="admin-role-supporting-panels"]')].filter((element) => {
      const rect = element.getBoundingClientRect();

      return rect.width > 0 && rect.height > 0;
    }).length;

    return {
      bottomSafeAreaCount: document.querySelectorAll('[data-testid="admin-role-bottom-safe-area"]').length,
      bottomSafeAreaHeight: Math.round(bottomSafeAreaRect?.height ?? 0),
      clearButtonHeight: Math.round(clearRect?.height ?? 0),
      clearButtonCount: document.querySelectorAll('[data-testid="admin-role-search-clear"]').length,
      clientWidth: document.documentElement.clientWidth,
      emptyStateCount: document.querySelectorAll('[data-testid="admin-role-empty-filter-state"]').length,
      inputHeight: Math.round(inputRect?.height ?? 0),
      resetBottomNavClearance: resetRect && navRect ? Math.round(navRect.top - resetRect.bottom) : null,
      resetHeight: Math.round(resetRect?.height ?? 0),
      rowCount,
      scrollWidth: document.documentElement.scrollWidth,
      status: document.querySelector('[data-testid="admin-role-list-status-label"]')?.textContent ?? "",
      supportingPanelVisibleCount,
    };
  });
}

function assertStaticContracts() {
  const adminRolesScreen = readFileSync("src/components/screens/admin-roles-screen.tsx", "utf8");
  const syncedTextParamHook = readFileSync("src/hooks/use-url-synced-text-param.ts", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");

  assert(packageJson.includes('"test:admin-role-search"'), "package.json must expose test:admin-role-search");
  assert(releaseRunner.includes('["run", "test:admin-role-search"]'), "test:release must include admin role search");
  assert(adminRolesScreen.includes('data-testid="admin-role-search-input"'), "admin roles screen must expose role search input");
  assert(adminRolesScreen.includes('data-testid="admin-role-search-clear"'), "admin roles screen must expose role search clear action");
  assert(adminRolesScreen.includes('data-testid="admin-role-list-status-label"'), "admin roles screen must expose filtered user count");
  assert(adminRolesScreen.includes('data-testid="admin-role-empty-filter-state"'), "admin roles screen must expose empty search state");
  assert(adminRolesScreen.includes('data-testid="admin-role-empty-filter-reset"'), "admin roles screen must expose empty search reset action");
  assert(adminRolesScreen.includes('data-testid="admin-role-supporting-panels"'), "admin roles screen must expose supporting panel visibility hook");
  assert(adminRolesScreen.includes('data-testid="admin-role-bottom-safe-area"'), "admin roles screen must reserve mobile bottom safe area");
  assert(adminRolesScreen.includes('useUrlSyncedTextParam("q")'), "admin role search must use the shared URL-synced text state");
  assert(syncedTextParamHook.includes("useSearchParams()"), "shared text state must initialize from Next search params");
  assert(syncedTextParamHook.includes("previousParamValueRef"), "shared text state must guard stale q params after clearing");
  assert(
    syncedTextParamHook.includes('window.history.replaceState(null, "", nextUrl)'),
    "shared text state must update q through the Next-compatible native history API",
  );
  assert(adminRolesScreen.includes('roleSearchActive ? "hidden xl:grid" : "grid"'), "admin role search must hide supporting panels on mobile while filtering");
}

mkdirSync(outDir, { recursive: true });
assertStaticContracts();

const chromeExecutable = findChromeExecutable();
assert(chromeExecutable, "Chrome or Chromium executable is required for admin role search proof");

await ensureLocalAppServer();
const resetBefore = await resetDevData("before");
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const messages = collectConsoleMessages(page);

try {
  await gotoAdminRoles(page, "/app/admin/roles?q=코치");
  await page.waitForSelector('[data-testid="admin-role-search-input"]', { timeout: 15000 });
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="admin-role-search-input"]');
    const label = document.querySelector('[data-testid="admin-role-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)명 표시/);

    return input instanceof HTMLInputElement && input.value === "코치" && match && Number(match[1]) > 0 && Number(match[1]) < Number(match[2]);
  });
  const filteredStatus = await page.getByTestId("admin-role-list-status-label").innerText();
  const filteredCounts = parseVisibleTotal(filteredStatus);
  const filteredText = await page.locator("body").innerText();
  assert.match(filteredText, /박서준/, "admin role search deep link must keep matching coach user visible");
  assert(!/최남용/.test(filteredText), "admin role search deep link must hide unrelated admin users");
  const filteredLayout = await readLayout(page);
  assert.equal(filteredLayout.scrollWidth, filteredLayout.clientWidth, "admin role filtered search must not overflow horizontally");
  const filteredScreenshotPath = join(outDir, "admin-roles-search-mobile.png");
  await page.screenshot({ path: filteredScreenshotPath, fullPage: false });

  await page.getByTestId("admin-role-search-clear").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="admin-role-search-input"]');
    const label = document.querySelector('[data-testid="admin-role-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)명 표시/);

    return (
      input instanceof HTMLInputElement &&
      input.value === "" &&
      !new URL(window.location.href).searchParams.has("q") &&
      match &&
      Number(match[1]) === Number(match[2])
    );
  });

  await page.getByTestId("admin-role-search-input").fill("없는권한");
  await page.waitForSelector('[data-testid="admin-role-empty-filter-state"]', { timeout: 10000 });
  await page.waitForFunction(() => {
    const label = document.querySelector('[data-testid="admin-role-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)명 표시/);

    return match && Number(match[1]) === 0 && Number(match[2]) > 0 && new URL(window.location.href).searchParams.has("q");
  });
  const emptyText = await page.locator("body").innerText();
  assert.match(emptyText, /조건에 맞는 사용자가 없습니다/, "admin role empty search must explain the no-result state");
  const emptyInputValue = await page.getByTestId("admin-role-search-input").inputValue();
  assert.equal(emptyInputValue, "없는권한", "admin role empty search must keep the active query visible in the search input");
  const emptyLayout = await readLayout(page);
  assert.equal(emptyLayout.rowCount, 0, "admin role empty search must hide stale user rows");
  assert.equal(emptyLayout.emptyStateCount, 1, "admin role empty search must show one empty state");
  assert.equal(emptyLayout.clearButtonCount, 1, "admin role search must expose a clear control while filtered");
  assert.equal(emptyLayout.supportingPanelVisibleCount, 0, "admin role mobile search must hide supporting panels while filtering");
  assert.equal(emptyLayout.bottomSafeAreaCount, 1, "admin role screen must render one mobile bottom safe-area spacer");
  assert(filteredLayout.inputHeight >= 44, `admin role filtered search input must stay 44px tall; got ${filteredLayout.inputHeight}px`);
  assert(filteredLayout.clearButtonHeight >= 44, `admin role filtered clear action must stay 44px tall; got ${filteredLayout.clearButtonHeight}px`);
  assert(emptyLayout.inputHeight >= 44, `admin role empty search input must stay 44px tall; got ${emptyLayout.inputHeight}px`);
  assert(emptyLayout.clearButtonHeight >= 44, `admin role empty clear action must stay 44px tall; got ${emptyLayout.clearButtonHeight}px`);
  assert(emptyLayout.resetHeight >= 44, `admin role empty reset action must stay at least 44px tall; got ${emptyLayout.resetHeight}px`);
  assert(
    emptyLayout.bottomSafeAreaHeight >= 112,
    `admin role bottom safe-area spacer must reserve at least 112px; got ${emptyLayout.bottomSafeAreaHeight}px`,
  );
  assert(
    emptyLayout.resetBottomNavClearance === null || emptyLayout.resetBottomNavClearance >= 24,
    `admin role empty reset action must clear bottom nav by at least 24px; got ${emptyLayout.resetBottomNavClearance}px`,
  );
  assert.equal(emptyLayout.scrollWidth, emptyLayout.clientWidth, "admin role empty search must not overflow horizontally");
  assert(new URL(page.url()).searchParams.has("q"), "admin role empty search query must be reflected in the URL for refresh recovery");
  const emptyScreenshotPath = join(outDir, "admin-roles-search-empty-mobile.png");
  await page.screenshot({ path: emptyScreenshotPath, fullPage: false });

  await page.getByTestId("admin-role-empty-filter-reset").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="admin-role-search-input"]');
    const label = document.querySelector('[data-testid="admin-role-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)명 표시/);

    return (
      input instanceof HTMLInputElement &&
      input.value === "" &&
      !new URL(window.location.href).searchParams.has("q") &&
      match &&
      Number(match[1]) === Number(match[2]) &&
      document.querySelectorAll('[data-testid="admin-role-user-row"]').length === Number(match[2])
    );
  });

  assert.deepEqual(messages, [], `admin role search flow must not emit console warnings/errors: ${messages.join(" | ")}`);

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
      "admin role search hydrates q param after mount",
      "admin role search filters users by name/title/role/scope and clears q param",
      "admin role no-result search explains the empty state",
      "admin role inline clear and no-result reset actions stay 44px touch targets above bottom navigation",
      "admin role mobile search hides supporting panels and keeps a bottom safe-area spacer",
      "390px admin role search controls stay overflow-free and console-clean",
    ],
    consoleMessages: messages,
    controls: {
      empty: emptyLayout,
      filtered: filteredLayout,
    },
    counts: {
      filtered: filteredCounts,
    },
    resetBefore,
    resetAfter: null,
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

  report.resetAfter = await resetDevData("after");
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await stopManagedAppServer();
}
