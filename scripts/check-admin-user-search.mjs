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
const outDir = process.env.ADMIN_USER_SEARCH_OUT_DIR ?? ".data/mobile-builds/ios/admin-user-search-20260704";
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
      throw new Error(`Managed admin user search app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed admin user search app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "admin user search check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "admin user search check",
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
    if (process.env.ADMIN_USER_SEARCH_SERVER_LOGS === "1") {
      process.stdout.write(`[admin-user-search server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.ADMIN_USER_SEARCH_SERVER_LOGS === "1") {
      process.stderr.write(`[admin-user-search server] ${chunk}`);
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
    label: `admin user search ${label} reset`,
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `admin user search ${label} reset failed with ${response.status}`);

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

async function gotoAdminUsers(page, next) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", "admin");
  loginUrl.searchParams.set("next", next);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === "/app/admin/users", { timeout: 15000 });
}

function parseVisibleTotal(label, context) {
  const match = label.match(/(\d+)\/(\d+)명 표시/);

  assert(match, `${context} status label must show visible/total user count`);

  return {
    total: Number(match[2]),
    visible: Number(match[1]),
  };
}

async function readLayout(page) {
  return page.evaluate(() => {
    const inputRect = document.querySelector('[data-testid="admin-user-search-input"]')?.getBoundingClientRect();
    const clearRect = document.querySelector('[data-testid="admin-user-search-clear"]')?.getBoundingClientRect();
    const resetRect = document.querySelector('[data-testid="admin-user-empty-filter-reset"]')?.getBoundingClientRect();
    const navRect = document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect();
    const listSafeAreaRect = document.querySelector('[data-testid="admin-user-list-bottom-safe-area"]')?.getBoundingClientRect();

    return {
      clearButtonCount: document.querySelectorAll('[data-testid="admin-user-search-clear"]').length,
      clearButtonHeight: Math.round(clearRect?.height ?? 0),
      clearButtonWidth: Math.round(clearRect?.width ?? 0),
      clientWidth: document.documentElement.clientWidth,
      emptyStateCount: document.querySelectorAll('[data-testid="admin-user-empty-filter-state"]').length,
      inputHeight: Math.round(inputRect?.height ?? 0),
      listRowCount: document.querySelectorAll('[data-testid="admin-user-list-row"]').length,
      listSafeAreaCount: document.querySelectorAll('[data-testid="admin-user-list-bottom-safe-area"]').length,
      listSafeAreaHeight: Math.round(listSafeAreaRect?.height ?? 0),
      resetBottomNavClearance: resetRect && navRect ? Math.round(navRect.top - resetRect.bottom) : null,
      resetHeight: Math.round(resetRect?.height ?? 0),
      roleFilterResetHeight: Math.round(document.querySelector('[data-testid="admin-user-role-filter-reset"]')?.getBoundingClientRect().height ?? 0),
      scrollWidth: document.documentElement.scrollWidth,
      status: document.querySelector('[data-testid="admin-user-list-status-label"]')?.textContent ?? "",
    };
  });
}

function assertStaticContracts() {
  const adminUsersScreen = readFileSync("src/components/screens/admin-users-screen.tsx", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");

  assert(packageJson.includes('"test:admin-user-search"'), "package.json must expose test:admin-user-search");
  assert(releaseRunner.includes('["run", "test:admin-user-search"]'), "test:release must include admin user search");
  assert(adminUsersScreen.includes("useSearchParams"), "admin users screen must read initial filters from Next search params");
  assert(adminUsersScreen.includes("previousListFilterParamRef"), "admin user search must guard stale q/role params after clearing");
  assert(
    adminUsersScreen.includes('window.history.replaceState(null, "", nextUrl)'),
    "admin user search must update q/role through the Next-compatible native history API",
  );
  assert(!adminUsersScreen.includes("window.addEventListener(\"popstate\""), "admin user search must not depend on raw popstate listeners");
  assert(!adminUsersScreen.includes("getInitialUserQuery"), "admin user search must not restore q from a window-only initializer");
  assert(adminUsersScreen.includes('data-testid="admin-user-search-input"'), "admin users screen must expose a stable search input hook");
  assert(adminUsersScreen.includes('data-testid="admin-user-list-status-label"'), "admin users screen must expose filtered count status");
  assert(adminUsersScreen.includes('data-testid="admin-user-empty-filter-state"'), "admin users screen must expose no-result state");
  assert(adminUsersScreen.includes('data-testid="admin-user-empty-filter-reset"'), "admin users screen must expose no-result reset action");
}

mkdirSync(outDir, { recursive: true });
assertStaticContracts();

const chromeExecutable = findChromeExecutable();
assert(chromeExecutable, "Chrome or Chromium executable is required for admin user search proof");

await ensureLocalAppServer();
const resetBefore = await resetDevData("before");
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const messages = collectConsoleMessages(page);

try {
  await gotoAdminUsers(page, "/app/admin/users?role=guardian&q=이하린");
  await page.waitForSelector('[data-testid="admin-user-search-input"]', { timeout: 15000 });
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="admin-user-search-input"]');
    const activeGuardianFilter = document.querySelector('[data-testid="admin-user-role-filter-button"][data-role-filter="guardian"]')?.getAttribute("aria-pressed");
    const label = document.querySelector('[data-testid="admin-user-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)명 표시/);

    return input instanceof HTMLInputElement && input.value === "이하린" && activeGuardianFilter === "true" && match && Number(match[1]) > 0;
  });
  const filteredStatus = await page.getByTestId("admin-user-list-status-label").innerText();
  const filteredCounts = parseVisibleTotal(filteredStatus, "admin user search");
  const filteredText = await page.locator("body").innerText();

  assert(filteredCounts.visible > 0, "admin user q+role deep link must show at least one matching user");
  assert(filteredCounts.visible < filteredCounts.total, "admin user q+role deep link must reduce the selected role list");
  assert.match(filteredText, /이하린/, "admin user q+role deep link must keep the matching guardian visible");
  assert(!/최남용/.test(filteredText), "admin user q+role deep link must hide unrelated admin users");
  const filteredLayout = await readLayout(page);
  assert.equal(filteredLayout.scrollWidth, filteredLayout.clientWidth, "admin user filtered search must not overflow horizontally");
  assert(filteredLayout.inputHeight >= 44, `admin user search input must stay 44px tall; got ${filteredLayout.inputHeight}px`);
  assert(filteredLayout.clearButtonHeight >= 44, `admin user search clear action must stay 44px tall; got ${filteredLayout.clearButtonHeight}px`);
  assert(filteredLayout.clearButtonWidth >= 44, `admin user search clear action must stay 44px wide; got ${filteredLayout.clearButtonWidth}px`);
  assert(filteredLayout.roleFilterResetHeight >= 44, `admin user filter reset action must stay 44px tall; got ${filteredLayout.roleFilterResetHeight}px`);
  const filteredScreenshotPath = join(outDir, "admin-users-search-mobile.png");
  await page.screenshot({ path: filteredScreenshotPath, fullPage: false });

  await page.getByTestId("admin-user-search-clear").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="admin-user-search-input"]');

    return input instanceof HTMLInputElement && input.value === "" && !new URL(window.location.href).searchParams.has("q");
  });
  assert.equal(new URL(page.url()).searchParams.get("role"), "guardian", "clearing q must preserve the active role filter");

  await page.getByTestId("admin-user-search-input").fill("검색없는사용자");
  await page.waitForSelector('[data-testid="admin-user-empty-filter-state"]', { timeout: 10000 });
  await page.waitForFunction(() => {
    const label = document.querySelector('[data-testid="admin-user-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)명 표시/);

    return match && Number(match[1]) === 0 && Number(match[2]) > 0 && new URL(window.location.href).searchParams.has("q");
  });
  const emptyText = await page.locator("body").innerText();
  const emptyLayout = await readLayout(page);

  assert.match(emptyText, /조건에 맞는 사용자가 없습니다/, "admin user empty search must explain the no-result state");
  assert.equal(emptyLayout.listRowCount, 0, "admin user empty search must hide stale list rows");
  assert.equal(emptyLayout.emptyStateCount, 1, "admin user empty search must show one compact empty state");
  assert.equal(emptyLayout.listSafeAreaCount, 1, "admin user empty search must keep the mobile bottom safe-area spacer");
  assert(emptyLayout.listSafeAreaHeight >= 96, `admin user list safe-area must reserve at least 96px; got ${emptyLayout.listSafeAreaHeight}px`);
  assert(emptyLayout.resetHeight >= 44, `admin user empty reset action must stay 44px tall; got ${emptyLayout.resetHeight}px`);
  assert(
    emptyLayout.resetBottomNavClearance === null || emptyLayout.resetBottomNavClearance >= 24,
    `admin user empty reset action must clear bottom navigation by at least 24px; got ${emptyLayout.resetBottomNavClearance}px`,
  );
  assert.equal(emptyLayout.scrollWidth, emptyLayout.clientWidth, "admin user empty search must not overflow horizontally");
  const emptyScreenshotPath = join(outDir, "admin-users-search-empty-mobile.png");
  await page.screenshot({ path: emptyScreenshotPath, fullPage: false });

  await page.getByTestId("admin-user-empty-filter-reset").click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-testid="admin-user-search-input"]');
    const label = document.querySelector('[data-testid="admin-user-list-status-label"]')?.textContent ?? "";
    const match = label.match(/(\d+)\/(\d+)명 표시/);
    const url = new URL(window.location.href);

    return (
      input instanceof HTMLInputElement &&
      input.value === "" &&
      !url.searchParams.has("q") &&
      !url.searchParams.has("role") &&
      match &&
      Number(match[1]) === Number(match[2]) &&
      document.querySelectorAll('[data-testid="admin-user-list-row"]').length === Number(match[2])
    );
  });

  assert.deepEqual(messages, [], `admin user search flow must not emit console warnings/errors: ${messages.join(" | ")}`);

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
      "admin user search hydrates q and role params through Next search params",
      "admin user search filters by user/member/role scope and preserves role when q is cleared",
      "admin user no-result search explains the empty state and clears q/role from reset",
      "admin user search controls stay 44px touch targets above bottom navigation",
      "390px admin user search stays overflow-free and console-clean",
    ],
    consoleMessages: messages,
    controls: {
      empty: emptyLayout,
      filtered: filteredLayout,
    },
    counts: {
      filtered: filteredCounts,
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
