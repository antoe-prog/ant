import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  assertOwnedSmokeServer,
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.PHONE_SIGNUP_LOGIN_FLOW_OUT_DIR ?? ".data/mobile-builds/ios/phone-signup-login-flow-20260705";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const password = "FinalJudoSignup!2026";
const sessionCookieName = "final-judo-session";
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

  assert.equal(protocol, "http:", "phone signup login flow check only runs against a local HTTP app server");
  assert(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname), "phone signup login flow check only mutates local dev data");
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
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "phone signup login flow check",
  });

  if (await canReachAppServer()) {
    await assertOwnedSmokeServer({
      baseUrl,
      env: process.env,
      label: "phone signup login flow check",
    });
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
  const response = await resetOwnedSmokeServer({ baseUrl, env: process.env, label: `${label} dev reset` });
  const bodyText = await response.text();

  assert.equal(response.status, 200, `${label} dev reset must succeed: ${bodyText}`);
}

function collectConsoleMessages(page) {
  const messages = [];

  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") {
      return;
    }

    const text = message.text();

    if (message.type() === "warning" && text.includes("[Fast Refresh] performing full reload")) {
      return;
    }

    messages.push(`${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });

  return messages;
}

function generatedMobilePhone() {
  const suffix = String(Date.now()).slice(-8).padStart(8, "0");

  return `010${suffix}`;
}

async function main() {
  const executablePath = findChromeExecutable();

  assert(executablePath, "Chrome/Chromium executable is required for phone signup login flow check");
  mkdirSync(outDir, { recursive: true });
  await ensureLocalAppServer();
  await resetDevData("before");

  const phone = process.env.PHONE_SIGNUP_LOGIN_FLOW_PHONE?.trim() || generatedMobilePhone();
  const browser = await chromium.launch({ executablePath, headless: true });
  activeBrowser = browser;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const consoleMessages = collectConsoleMessages(page);
  const signupScreenshotPath = join(outDir, "phone-signup-form-mobile.png");
  const registeredLoginScreenshotPath = join(outDir, "phone-signup-registered-login-mobile.png");
  const dashboardScreenshotPath = join(outDir, "phone-signup-dashboard-mobile.png");

  await page.goto(`${baseUrl}/signup`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="phone-signup-form"]', { timeout: 15000 });
  await page.screenshot({ path: signupScreenshotPath, fullPage: false, caret: "initial" });

  await page.getByTestId("signup-name-input").fill("가입확인");
  await page.getByTestId("signup-phone-input").fill(phone);
  await page.getByTestId("signup-password-input").fill(password);
  await page.getByTestId("signup-password-confirm-input").fill(password);
  await page.getByTestId("signup-submit-button").click();
  await page.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("registered") === "1", { timeout: 15000 });
  await page.waitForSelector("text=회원가입이 완료되었습니다. 휴대폰 번호와 비밀번호로 로그인해 주세요.", { timeout: 15000 });

  const registeredLoginLayout = await page.evaluate(() => {
    const phoneInput = document.querySelector('input[type="tel"]');
    const passwordInput = document.querySelector("#login-password-input");
    const submit = document.querySelector('button[type="submit"]');
    const noticeText = document.body.innerText;

    return {
      bodyTextLength: noticeText.length,
      hasInvalidPasswordCopy: noticeText.includes("비밀번호가 올바르지") || noticeText.includes("비밀번호가 아니"),
      noticeVisible: noticeText.includes("회원가입이 완료되었습니다. 휴대폰 번호와 비밀번호로 로그인해 주세요."),
      passwordInputHeight: Math.round(passwordInput?.getBoundingClientRect().height ?? 0),
      phoneInputHeight: Math.round(phoneInput?.getBoundingClientRect().height ?? 0),
      phoneValue: phoneInput instanceof HTMLInputElement ? phoneInput.value.replace(/[^\d]/g, "") : "",
      submitHeight: Math.round(submit?.getBoundingClientRect().height ?? 0),
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });

  assert.equal(registeredLoginLayout.noticeVisible, true, "registered login notice must be visible after phone signup");
  assert.equal(registeredLoginLayout.hasInvalidPasswordCopy, false, "registered login screen must not show an invalid-password warning before login");
  assert.equal(registeredLoginLayout.phoneValue, phone, "registered login screen must prefill the signed-up phone number");
  assert(registeredLoginLayout.phoneInputHeight >= 44, "registered login phone input must keep a 44px touch height");
  assert(registeredLoginLayout.passwordInputHeight >= 44, "registered login password input must keep a 44px touch height");
  assert(registeredLoginLayout.submitHeight >= 44, "registered login submit button must keep a 44px touch height");
  assert.equal(registeredLoginLayout.overflowX, 0, "registered login screen must not overflow horizontally");
  assert(registeredLoginLayout.bodyTextLength > 80, "registered login screen must not be blank");
  await page.screenshot({ path: registeredLoginScreenshotPath, fullPage: false, caret: "initial" });

  await page.locator("#login-password-input").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.body.innerText.includes("불러오는 중"), null, { timeout: 15000 });

  const dashboardLayout = await page.evaluate(() => {
    const text = document.body.innerText;

    return {
      bodyTextLength: text.length,
      hasInvalidCredentialsCopy: text.includes("휴대폰 번호 또는 비밀번호가 올바르지 않습니다."),
      memberPriorityCellCount: document.querySelectorAll('[data-testid="member-guardian-priority-cell"]').length,
      memberPriorityPanelVisible: document.querySelector('[data-testid="member-guardian-mobile-priority-panel"]') !== null,
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
  const cookies = await context.cookies(baseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === sessionCookieName);
  await page.screenshot({ path: dashboardScreenshotPath, fullPage: false, caret: "initial" });

  assert.equal(
    dashboardLayout.memberPriorityPanelVisible,
    true,
    `phone signup login must land on the member home dashboard: ${JSON.stringify(dashboardLayout)}`,
  );
  assert(
    dashboardLayout.memberPriorityCellCount > 0,
    `phone signup member dashboard must show at least one priority cell: ${JSON.stringify(dashboardLayout)}`,
  );
  assert.equal(dashboardLayout.hasInvalidCredentialsCopy, false, "phone signup login must not show invalid credential copy after successful login");
  assert.equal(dashboardLayout.overflowX, 0, "phone signup dashboard must not overflow horizontally");
  assert(dashboardLayout.bodyTextLength > 120, "phone signup dashboard must not be blank");
  assert(sessionCookie, "phone signup login must set the httpOnly session cookie");
  assert.equal(consoleMessages.length, 0, `phone signup login flow must not emit console warnings/errors: ${consoleMessages.join(" | ")}`);

  for (const screenshotPath of [signupScreenshotPath, registeredLoginScreenshotPath, dashboardScreenshotPath]) {
    assert(statSync(screenshotPath).size > 10_000, `${screenshotPath} must be a non-empty screenshot`);
  }

  await context.close();
  await browser.close();
  activeBrowser = null;
  await resetDevData("after");

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
    baseUrl,
    checked: [
      "phone signup creates a member account with the entered password",
      "registered login screen pre-fills the signed-up phone number",
      "registered login screen avoids premature invalid-password copy",
      "same password logs in and reaches the member dashboard",
      "session cookie is set after login",
      "390px signup/login/dashboard flow stays horizontally contained",
    ],
    phoneSuffix: phone.slice(-4),
    registeredLoginLayout,
    dashboardLayout,
    screenshots: {
      signup: { path: signupScreenshotPath, bytes: statSync(signupScreenshotPath).size },
      registeredLogin: { path: registeredLoginScreenshotPath, bytes: statSync(registeredLoginScreenshotPath).size },
      dashboard: { path: dashboardScreenshotPath, bytes: statSync(dashboardScreenshotPath).size },
    },
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
