import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  assertOwnedSmokeServer,
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const parsedBaseUrl = new URL(baseUrl);
const managedHostname = parsedBaseUrl.hostname.replace(/^\[(.*)\]$/, "$1");
const managedPort = parsedBaseUrl.port || "3000";
const outDir = process.env.PHONE_SIGNUP_LOGIN_FLOW_OUT_DIR ?? ".data/mobile-builds/ios/phone-signup-login-flow-20260705";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const password = "FinalJudoSignup!2026";
const resetPassword = "FinalJudoReset!2026";
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
const managedRuntimeStamp = `${process.pid}-${Date.now()}`;
const managedDistDir = `.next-phone-signup-login-${managedRuntimeStamp}`;
const managedTsconfigPath = `.tsconfig.phone-signup-login-${managedRuntimeStamp}.json`;
const managedServerOutput = [];

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
      throw new Error(`Managed app server exited before ${baseUrl} became reachable\n${managedServerOutput.join("").slice(-4000)}`);
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

  writeFileSync(
    managedTsconfigPath,
    `${JSON.stringify({
      extends: "./tsconfig.json",
      include: [
        "next-env.d.ts",
        "**/*.ts",
        "**/*.tsx",
        `${managedDistDir}/types/**/*.ts`,
        `${managedDistDir}/dev/types/**/*.ts`,
      ],
    }, null, 2)}\n`,
  );

  managedAppServer = spawn(
    npmCommand,
    ["run", "dev", "--", "--webpack", "--hostname", managedHostname, "--port", managedPort],
    {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FINAL_JUDO_NEXT_DIST_DIR: managedDistDir,
      FINAL_JUDO_NEXT_TSCONFIG_PATH: managedTsconfigPath,
      FINAL_JUDO_ROLL_DEMO_DATES: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    },
  );
  managedAppServer.stdout?.on("data", (chunk) => managedServerOutput.push(chunk.toString()));
  managedAppServer.stderr?.on("data", (chunk) => managedServerOutput.push(chunk.toString()));

  await waitForManagedAppServer();
}

async function stopManagedAppServer() {
  if (usingExistingAppServer) {
    return;
  }

  if (!managedAppServer || managedAppServer.exitCode !== null) {
    rmSync(managedDistDir, { force: true, recursive: true });
    rmSync(managedTsconfigPath, { force: true });
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
  rmSync(managedDistDir, { force: true, recursive: true });
  rmSync(managedTsconfigPath, { force: true });
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

    if (
      message.type() === "warning" &&
      (text.includes("[Fast Refresh] performing full reload") ||
        text.includes("was preloaded using link preload but not used"))
    ) {
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

function debugStep(label) {
  if (process.env.PHONE_SIGNUP_LOGIN_FLOW_DEBUG === "1") {
    console.log(`[phone-signup-login-flow] ${label}`);
  }
}

async function closeBrowserWithDeadline(browser) {
  await Promise.race([
    browser.close().catch(() => {}),
    sleep(5_000),
  ]);
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
  const passwordResetScreenshotPath = join(outDir, "phone-password-reset-mobile.png");

  for (const payload of [
    { action: "complete", branchId: "branch-gangnam", code: "123456", name: "가".repeat(31), password, phone },
    { action: "complete", branchId: "branch-gangnam", code: "123456", name: "가입확인", password: "P".repeat(257), phone },
    { action: "complete", branchId: "b".repeat(161), code: "123456", name: "가입확인", password, phone },
    { action: "complete", branchId: "branch-gangnam", code: "123456", name: "가입확인", password, phone: "0".repeat(41) },
  ]) {
    const response = await context.request.post(`${baseUrl}/api/v1/auth/register`, { data: payload });
    assert.equal(response.status(), 400, "oversized public registration input must be rejected before account creation");
  }

  const oversizedSignupRequest = await context.request.post(`${baseUrl}/api/v1/auth/register`, {
    data: { action: "request", phone: "0".repeat(41) },
  });
  assert.equal(oversizedSignupRequest.status(), 400, "oversized signup phones must be rejected before challenge creation");

  for (const payload of [
    { password: "P".repeat(257), phone: "01050504927" },
    { loginId: "i".repeat(255), password },
  ]) {
    const response = await context.request.post(`${baseUrl}/api/v1/auth/login`, { data: payload });
    assert.equal(response.status(), 400, "oversized public login input must be rejected before credential verification");
  }

  const oversizedReset = await context.request.post(`${baseUrl}/api/v1/auth/password-reset`, {
    data: { action: "request", phone: "0".repeat(41) },
  });
  assert.equal(oversizedReset.status(), 400, "oversized password-reset phones must be rejected before account lookup");

  await page.goto(`${baseUrl}/signup`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="phone-signup-form"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="signup-branch-input"]', { timeout: 15000 });
  const signupLayout = await page.evaluate(() => {
    const branchInput = document.querySelector('[data-testid="signup-branch-input"]');

    return {
      branchInputHeight: Math.round(branchInput?.getBoundingClientRect().height ?? 0),
      branchOptionCount: branchInput instanceof HTMLSelectElement ? branchInput.options.length : 1,
      branchSelectorVisible: branchInput instanceof HTMLSelectElement,
      inputMaxLengths: {
        name: Number(document.querySelector('[data-testid="signup-name-input"]')?.getAttribute("maxlength")),
        password: Number(document.querySelector('[data-testid="signup-password-input"]')?.getAttribute("maxlength")),
        passwordConfirm: Number(document.querySelector('[data-testid="signup-password-confirm-input"]')?.getAttribute("maxlength")),
        phone: Number(document.querySelector('[data-testid="signup-phone-input"]')?.getAttribute("maxlength")),
      },
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
  assert.equal(signupLayout.branchSelectorVisible, true, "multi-branch signup must render a branch selector");
  assert(signupLayout.branchOptionCount >= 3, "multi-branch signup must include a placeholder and available branches");
  assert(signupLayout.branchInputHeight >= 44, "signup branch selector must keep a 44px touch height");
  assert.deepEqual(
    signupLayout.inputMaxLengths,
    { name: 30, password: 256, passwordConfirm: 256, phone: 11 },
    "signup fields must expose the public authentication input limits",
  );
  assert.equal(signupLayout.overflowX, 0, "signup branch selector must not cause horizontal overflow");
  await page.screenshot({ path: signupScreenshotPath, animations: "disabled", fullPage: false, caret: "initial" });

  await page.getByTestId("signup-name-input").fill("가입확인");
  await page.getByTestId("signup-phone-input").fill(phone);
  await page.getByTestId("signup-code-request-button").click();
  await page.waitForSelector('[data-testid="signup-code-input"]', { timeout: 15000 });
  const signupVerificationLayout = await page.evaluate(() => {
    const codeInput = document.querySelector('[data-testid="signup-code-input"]');
    const requestButton = document.querySelector('[data-testid="signup-code-request-button"]');

    return {
      codeInputHeight: Math.round(codeInput?.getBoundingClientRect().height ?? 0),
      codeMaxLength: Number(codeInput?.getAttribute("maxlength")),
      codeValue: codeInput instanceof HTMLInputElement ? codeInput.value : "",
      requestButtonHeight: Math.round(requestButton?.getBoundingClientRect().height ?? 0),
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
  assert.match(signupVerificationLayout.codeValue, /^\d{6}$/, "isolated signup flow must receive and fill a development code");
  assert.equal(signupVerificationLayout.codeMaxLength, 6, "signup verification input must accept six digits");
  assert(signupVerificationLayout.codeInputHeight >= 44, "signup verification input must keep a 44px touch height");
  assert(signupVerificationLayout.requestButtonHeight >= 44, "signup verification request must keep a 44px touch height");
  assert.equal(signupVerificationLayout.overflowX, 0, "signup verification controls must not overflow horizontally");
  await page.getByTestId("signup-branch-input").selectOption("branch-gangnam");
  await page.getByTestId("signup-password-input").fill(password);
  await page.getByTestId("signup-password-confirm-input").fill(password);
  const registrationResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${baseUrl}/api/v1/auth/register` &&
      response.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.getByTestId("signup-submit-button").click();
  const registrationResponse = await registrationResponsePromise;
  const registrationResponseBody = await registrationResponse.text();
  assert.equal(
    registrationResponse.status(),
    200,
    `phone signup completion must succeed before login navigation: ${registrationResponseBody}`,
  );
  await page.waitForFunction(
    () => window.location.pathname === "/login" && new URLSearchParams(window.location.search).get("registered") === "1",
    undefined,
    { timeout: 30000 },
  );
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
      passwordMaxLength: Number(passwordInput?.getAttribute("maxlength")),
      phoneInputHeight: Math.round(phoneInput?.getBoundingClientRect().height ?? 0),
      phoneMaxLength: Number(phoneInput?.getAttribute("maxlength")),
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
  assert.equal(registeredLoginLayout.passwordMaxLength, 256, "login password must expose the server input limit");
  assert.equal(registeredLoginLayout.phoneMaxLength, 40, "login phone must expose the server input limit");
  assert(registeredLoginLayout.submitHeight >= 44, "registered login submit button must keep a 44px touch height");
  assert.equal(registeredLoginLayout.overflowX, 0, "registered login screen must not overflow horizontally");
  assert(registeredLoginLayout.bodyTextLength > 80, "registered login screen must not be blank");
  await page.screenshot({ path: registeredLoginScreenshotPath, animations: "disabled", fullPage: false, caret: "initial" });

  await page.locator("#login-password-input").fill(password);
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST",
    { timeout: 15000 },
  );
  await page.locator('button[type="submit"]').click();
  const loginResponse = await loginResponsePromise;
  const loginSetCookie = await loginResponse.headerValue("set-cookie");
  assert.equal(loginResponse.status(), 200, "phone signup login API must accept the registered credentials");
  assert.match(loginSetCookie ?? "", new RegExp(`(?:^|[,;]\\s*)${sessionCookieName}=`), "login response must issue a session cookie");
  assert.match(loginSetCookie ?? "", /;\s*HttpOnly(?:;|$)/i, "login response session cookie must be httpOnly");
  assert.match(loginSetCookie ?? "", /;\s*Secure(?:;|$)/i, "production login response session cookie must require HTTPS");
  assert.match(loginSetCookie ?? "", /;\s*SameSite=Lax(?:;|$)/i, "login response session cookie must use SameSite=Lax");
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.body.innerText.includes("불러오는 중"), null, { timeout: 15000 });

  const dashboardLayout = await page.evaluate(() => {
    const text = document.body.innerText;

    return {
      bodyTextLength: text.length,
      hasInvalidCredentialsCopy: text.includes("휴대폰 번호 또는 비밀번호가 올바르지 않습니다."),
      memberAttendanceQrCardVisible: document.querySelector('[data-testid="member-attendance-qr-card"]') !== null,
      memberAttendanceQrScannerVisible: document.querySelector('[data-testid="member-attendance-qr-open"]') !== null,
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
  const cookies = await context.cookies(baseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === sessionCookieName);
  await page.screenshot({ path: dashboardScreenshotPath, animations: "disabled", fullPage: false, caret: "initial" });

  assert.equal(
    dashboardLayout.memberAttendanceQrCardVisible,
    true,
    `phone signup login must land on the member home dashboard: ${JSON.stringify(dashboardLayout)}`,
  );
  assert.equal(
    dashboardLayout.memberAttendanceQrScannerVisible,
    true,
    `phone signup member dashboard must offer the attendance QR scanner: ${JSON.stringify(dashboardLayout)}`,
  );
  assert.equal(dashboardLayout.hasInvalidCredentialsCopy, false, "phone signup login must not show invalid credential copy after successful login");
  assert.equal(dashboardLayout.overflowX, 0, "phone signup dashboard must not overflow horizontally");
  assert(dashboardLayout.bodyTextLength > 120, "phone signup dashboard must not be blank");
  // A production Secure cookie is intentionally not persisted by Chromium on
  // the local HTTP smoke origin. The response flags above are the security
  // contract; browser storage is evidence only when the transport accepts it.
  assert.equal(consoleMessages.length, 0, `phone signup login flow must not emit console warnings/errors: ${consoleMessages.join(" | ")}`);

  const logoutResponse = await context.request.post(`${baseUrl}/api/v1/auth/logout`);
  assert.equal(logoutResponse.status(), 200, "password reset setup must sign out the current session");
  await page.goto(`${baseUrl}/reset-password`, { waitUntil: "networkidle" });
  await page.getByTestId("password-reset-phone-input").fill(phone);
  await page.locator('[data-testid="password-reset-phone-form"] button[type="submit"]').click();
  await page.waitForSelector('[data-testid="password-reset-code-form"]', { timeout: 15000 });
  const developmentOtp = await page.getByTestId("password-reset-code-input").inputValue();
  assert.match(developmentOtp, /^\d{6}$/, "isolated reset flow must expose a development OTP only to the test server");
  await page.locator('[data-testid="password-reset-code-form"] button[type="submit"]').click();
  await page.waitForSelector('[data-testid="password-reset-password-form"]', { timeout: 15000 });
  await page.getByTestId("password-reset-password-input").fill(resetPassword);
  await page.getByTestId("password-reset-password-confirm-input").fill(resetPassword);
  await page.locator('[data-testid="password-reset-password-form"] button[type="submit"]').click();
  await page.waitForSelector("text=비밀번호 변경 완료", { timeout: 15000 });
  await page.screenshot({ path: passwordResetScreenshotPath, animations: "disabled", fullPage: false, caret: "initial" });
  debugStep("password reset UI completed");

  const oldPasswordLogin = await context.request.post(`${baseUrl}/api/v1/auth/login`, {
    data: { phone, password },
    timeout: 15000,
  });
  assert.equal(oldPasswordLogin.status(), 401, "the previous password must stop working after verified reset");
  debugStep("old password rejection verified");
  const resetPasswordLogin = await context.request.post(`${baseUrl}/api/v1/auth/login`, {
    data: { phone, password: resetPassword },
    timeout: 15000,
  });
  assert.equal(resetPasswordLogin.status(), 200, "the verified replacement password must log in");
  debugStep("replacement password login verified");

  for (const screenshotPath of [signupScreenshotPath, registeredLoginScreenshotPath, dashboardScreenshotPath, passwordResetScreenshotPath]) {
    assert(statSync(screenshotPath).size > 10_000, `${screenshotPath} must be a non-empty screenshot`);
  }

  // Browser.close() owns context teardown. Closing both separately can leave
  // the system Chrome transport waiting indefinitely after APIRequest use.
  await closeBrowserWithDeadline(browser);
  activeBrowser = null;
  debugStep("browser closed");
  await resetDevData("after");
  debugStep("isolated data reset after flow");

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
    baseUrl,
    checked: [
      "phone signup creates a member account with the entered password",
      "oversized register, login, and reset inputs fail before account or password work",
      "phone signup assigns the branch selected by the member",
      "registered login screen pre-fills the signed-up phone number",
      "registered login screen avoids premature invalid-password copy",
      "same password logs in and reaches the member dashboard",
      "registered phone OTP changes the password directly",
      "old password is rejected and the replacement password logs in",
      "login response emits an httpOnly Secure SameSite=Lax session cookie",
      "390px signup/login/dashboard flow stays horizontally contained",
    ],
    phoneSuffix: phone.slice(-4),
    browserStoredSessionCookie: Boolean(sessionCookie),
    signupLayout,
    registeredLoginLayout,
    dashboardLayout,
    screenshots: {
      signup: { path: signupScreenshotPath, bytes: statSync(signupScreenshotPath).size },
      registeredLogin: { path: registeredLoginScreenshotPath, bytes: statSync(registeredLoginScreenshotPath).size },
      dashboard: { path: dashboardScreenshotPath, bytes: statSync(dashboardScreenshotPath).size },
      passwordReset: { path: passwordResetScreenshotPath, bytes: statSync(passwordResetScreenshotPath).size },
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
      await closeBrowserWithDeadline(activeBrowser);
      activeBrowser = null;
    }
    await stopManagedAppServer();
  });
