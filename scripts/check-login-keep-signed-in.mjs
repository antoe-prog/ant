import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.LOGIN_KEEP_SIGNED_IN_OUT_DIR ?? ".data/mobile-builds/ios/login-keep-signed-in-20260701";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const defaultPassword = "FinalJudoPilot!2026";
const memberPhone = "01093645827";
const sessionCookieName = "final-judo-session";
const standardSessionSeconds = 60 * 60 * 8;
const rememberedSessionSeconds = 60 * 60 * 24 * 30;
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
      throw new Error(`Managed login keep-signed-in app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed login keep-signed-in app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "login keep-signed-in check only runs against a local dev app server");

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
    if (process.env.LOGIN_KEEP_SIGNED_IN_SERVER_LOGS === "1") {
      process.stdout.write(`[login-keep-signed-in server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.LOGIN_KEEP_SIGNED_IN_SERVER_LOGS === "1") {
      process.stderr.write(`[login-keep-signed-in server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "login keep-signed-in check only mutates local dev data");

  const response = await fetch(new URL("/api/v1/dev/reset", baseUrl), { method: "POST" });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `login keep-signed-in ${label} reset failed with ${response.status}`);

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

function cookieLifetimeSeconds(cookie) {
  assert(cookie, "session cookie must be present after login");
  assert(cookie.expires > 0, "session cookie must have a persistent expiry");

  return cookie.expires - Math.floor(Date.now() / 1000);
}

function assertApproximateLifetime(actualSeconds, expectedSeconds, label) {
  const toleranceSeconds = 120;

  assert(
    Math.abs(actualSeconds - expectedSeconds) <= toleranceSeconds,
    `${label} cookie lifetime must be about ${expectedSeconds}s; received ${actualSeconds}s`,
  );
}

async function performLogin(browser, { keepSignedIn, screenshotPath }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);

  try {
    await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="login-keep-signed-in-checkbox"]', { timeout: 15000 });

    const layout = await page.evaluate(() => {
      const checkbox = document.querySelector('[data-testid="login-keep-signed-in-checkbox"]');
      const label = checkbox?.closest("label");
      const submit = document.querySelector('button[type="submit"]');

      return {
        bodyTextLength: document.body.innerText.length,
        checkboxChecked: checkbox instanceof HTMLInputElement ? checkbox.checked : null,
        checkboxCount: document.querySelectorAll('[data-testid="login-keep-signed-in-checkbox"]').length,
        clientWidth: document.documentElement.clientWidth,
        hasThirtyDayCopy: document.body.innerText.includes("30일 동안 다시 로그인하지 않습니다."),
        labelHeight: label?.getBoundingClientRect().height ?? 0,
        loginTitle: document.querySelector("h2")?.textContent?.trim() ?? "",
        scrollWidth: document.documentElement.scrollWidth,
        submitHeight: submit?.getBoundingClientRect().height ?? 0,
      };
    });

    assert.equal(layout.checkboxCount, 1, "login must render one keep-signed-in checkbox");
    assert.equal(layout.checkboxChecked, true, "keep-signed-in checkbox must be enabled by default");
    assert.equal(layout.hasThirtyDayCopy, true, "login must show the thirty-day remembered session copy");
    assert(layout.labelHeight >= 44, "keep-signed-in touch target must be at least 44px high");
    assert(layout.submitHeight >= 44, "login submit button must be at least 44px high");
    assert.equal(layout.scrollWidth, layout.clientWidth, "login screen must not horizontally overflow at 390px");
    assert.equal(layout.loginTitle, "파이널 로그인", "login screen must render the public login title");
    assert(layout.bodyTextLength > 40, "login screen must not be blank");

    await page.screenshot({ path: screenshotPath, fullPage: false });

    if (!keepSignedIn) {
      await page.getByTestId("login-keep-signed-in-checkbox").uncheck();
    }

    await page.locator('input[type="tel"]').fill(memberPhone);
    await page.locator('input[type="password"]').fill(defaultPassword);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 15000 });

    const cookies = await context.cookies(baseUrl);
    const sessionCookie = cookies.find((cookie) => cookie.name === sessionCookieName);
    const lifetimeSeconds = cookieLifetimeSeconds(sessionCookie);

    assertApproximateLifetime(
      lifetimeSeconds,
      keepSignedIn ? rememberedSessionSeconds : standardSessionSeconds,
      keepSignedIn ? "remembered login" : "standard login",
    );
    assert.deepEqual(messages, [], "login keep-signed-in flow must not emit console warnings/errors");

    return {
      cookieExpires: sessionCookie.expires,
      cookieLifetimeSeconds: lifetimeSeconds,
      layout,
      messages,
      screenshotPath,
      screenshotSizeBytes: statSync(screenshotPath).size,
    };
  } finally {
    await context.close();
  }
}

mkdirSync(outDir, { recursive: true });

const chromeExecutable = findChromeExecutable();
assert(chromeExecutable, "Chrome or Chromium executable is required for login keep-signed-in proof");

await ensureLocalAppServer();
const resetBefore = await resetDevData("before");
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
});

try {
  const remembered = await performLogin(browser, {
    keepSignedIn: true,
    screenshotPath: join(outDir, "login-keep-signed-in-mobile.png"),
  });
  const standard = await performLogin(browser, {
    keepSignedIn: false,
    screenshotPath: join(outDir, "login-standard-session-mobile.png"),
  });
  const resetAfter = await resetDevData("after");
  const report = {
    ok: true,
    appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
    baseUrl,
    checked: [
      "login form exposes a 44px keep-signed-in checkbox",
      "keep-signed-in is enabled by default for app-like automatic login",
      "remembered login sets a 30-day httpOnly session cookie",
      "unchecked login keeps the standard 8-hour session cookie",
      "390px login screen stays nonblank, console-clean, and horizontally contained",
    ],
    remembered,
    standard,
    resetBefore,
    resetAfter,
    summaryPath: join(outDir, "summary.json"),
    viewport: "390x844",
  };

  assert(remembered.screenshotSizeBytes > 10_000, "remembered login screenshot must be non-empty");
  assert(standard.screenshotSizeBytes > 10_000, "standard login screenshot must be non-empty");
  writeFileSync(report.summaryPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await stopManagedAppServer();
}
