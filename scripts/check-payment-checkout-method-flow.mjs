import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.PAYMENT_CHECKOUT_METHOD_FLOW_OUT_DIR ?? ".data/mobile-builds/ios/payment-checkout-method-flow-20260701";
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
      throw new Error(`Managed payment checkout app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed payment checkout app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "payment checkout method flow check only runs against a local dev app server");

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
    if (process.env.PAYMENT_CHECKOUT_METHOD_FLOW_SERVER_LOGS === "1") {
      process.stdout.write(`[payment-checkout-method-flow server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.PAYMENT_CHECKOUT_METHOD_FLOW_SERVER_LOGS === "1") {
      process.stderr.write(`[payment-checkout-method-flow server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "payment checkout method flow check only mutates local dev data");

  const response = await fetch(new URL("/api/v1/dev/reset", baseUrl), { method: "POST" });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `payment checkout method flow ${label} reset failed with ${response.status}`);

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

async function gotoCheckout(page, role, paymentId) {
  const next = `/app/payments/checkout?paymentId=${encodeURIComponent(paymentId)}`;
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);
  loginUrl.searchParams.set("next", next);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === "/app/payments/checkout" && url.searchParams.get("paymentId") === paymentId, {
    timeout: 15000,
  });
  await page.waitForSelector('[data-testid="payment-checkout-ready"]', { timeout: 15000 });
}

async function collectCheckoutLayout(page, label) {
  const layout = await page.evaluate(() => {
    const confirmButton = document.querySelector('[data-testid="payment-confirm-draft-button"]');

    return {
      bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
      cardIssuerCount: document.querySelectorAll('[data-testid="payment-card-issuer-grid"] button').length,
      clientWidth: document.documentElement.clientWidth,
      confirmButtonHeight: confirmButton?.getBoundingClientRect().height ?? 0,
      methodRadioCount: document.querySelectorAll('[data-testid^="payment-method-radio-"]').length,
      payerInfoCount: document.querySelectorAll('[data-testid="payment-checkout-payer-info"]').length,
      saveMethodChecked:
        document.querySelector('[data-testid="payment-save-method-checkbox"]') instanceof HTMLInputElement
          ? document.querySelector('[data-testid="payment-save-method-checkbox"]').checked
          : null,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  assert.equal(layout.payerInfoCount, 1, `${label} must render payer info section`);
  assert.equal(layout.methodRadioCount, 4, `${label} must render four payment method choices`);
  assert(layout.cardIssuerCount >= 20, `${label} must render the expected card issuer grid`);
  assert.equal(layout.saveMethodChecked, true, `${label} must default to saving the payment method info for repeat payments`);
  assert(layout.confirmButtonHeight >= 44, `${label} confirm button must keep a 44px touch target`);
  assert.equal(layout.scrollWidth, layout.clientWidth, `${label} must not horizontally overflow at 390px`);
  assert.match(layout.bodyText, /결제자 정보/, `${label} must show payer information copy`);
  assert.match(layout.bodyText, /결제수단/, `${label} must show payment method copy`);
  assert.match(layout.bodyText, /신용카드/, `${label} must include card method copy`);

  return layout;
}

function screenshotSize(path) {
  return statSync(path).size;
}

mkdirSync(outDir, { recursive: true });

const chromeExecutable = findChromeExecutable();
assert(chromeExecutable, "Chrome or Chromium executable is required for payment checkout method flow proof");

await ensureLocalAppServer();
const resetBefore = await resetDevData("before");
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const messages = collectConsoleMessages(page);

try {
  await gotoCheckout(page, "member", "pay-minjae");
  const memberLayout = await collectCheckoutLayout(page, "adult member checkout");
  const memberScreenshotPath = join(outDir, "member-card-method-mobile.png");
  await page.screenshot({ path: memberScreenshotPath, fullPage: false });

  await page.getByTestId("payment-card-issuer-woori").click();
  await page.waitForSelector('[data-testid="payment-wooriwonpay-modal"]', { timeout: 10000 });
  const wooriModalScreenshotPath = join(outDir, "wooriwonpay-modal-mobile.png");
  const wooriModalText = await page.getByTestId("payment-wooriwonpay-modal").innerText();
  assert.match(wooriModalText, /우리WON페이/, "Woori modal must show WooriWON Pay tab copy");
  assert.match(wooriModalText, /우리카드 앱/, "Woori modal must show Woori Card app option");
  assert.match(wooriModalText, /우리은행 앱/, "Woori modal must show Woori Bank app option");
  await page.screenshot({ path: wooriModalScreenshotPath, fullPage: false });
  await page.getByTestId("payment-wooriwonpay-close").click();
  await page.waitForSelector('[data-testid="payment-wooriwonpay-modal"]', { state: "detached", timeout: 10000 });

  await page.getByTestId("payment-method-radio-bankTransfer").click();
  await page.waitForSelector('[data-testid="payment-bank-transfer-panel"]', { timeout: 10000 });
  const bankPanelText = await page.getByTestId("payment-bank-transfer-panel").innerText();
  assert.match(bankPanelText, /입금은행/, "bank transfer panel must show bank selector label");
  assert.match(bankPanelText, /입금자명/, "bank transfer panel must show depositor name label");
  await page.getByTestId("payment-confirm-draft-button").click();
  await page.waitForSelector('[data-testid="payment-confirm-feedback"]', { timeout: 10000 });
  const bankFeedback = await page.getByTestId("payment-confirm-feedback").innerText();
  assert.match(bankFeedback, /우리은행/, "bank transfer confirmation must summarize the selected bank");
  const bankScreenshotPath = join(outDir, "member-bank-method-mobile.png");
  await page.screenshot({ path: bankScreenshotPath, fullPage: false });

  await gotoCheckout(page, "guardian", "pay-yuna");
  const guardianLayout = await collectCheckoutLayout(page, "guardian child checkout");
  const guardianScreenshotPath = join(outDir, "guardian-child-card-method-mobile.png");
  await page.screenshot({ path: guardianScreenshotPath, fullPage: false });

  assert.deepEqual(messages, [], "payment checkout method flow must not emit console warnings/errors");

  const report = {
    ok: true,
    appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
    baseUrl,
    viewport: "390x844",
    checked: [
      "adult member checkout renders payer info and payment method selection",
      "card issuer grid renders Woori card app handoff modal",
      "bank transfer method renders bank and depositor inputs",
      "guardian child checkout uses the same payment input flow",
      "mobile checkout screens stay nonblank, overflow-free, and console-clean",
    ],
    consoleMessages: messages,
    layouts: {
      guardian: guardianLayout,
      member: memberLayout,
    },
    resetBefore,
    resetAfter: await resetDevData("after"),
    screenshots: {
      memberCardMethod: {
        path: memberScreenshotPath,
        sizeBytes: screenshotSize(memberScreenshotPath),
      },
      wooriWonPayModal: {
        path: wooriModalScreenshotPath,
        sizeBytes: screenshotSize(wooriModalScreenshotPath),
      },
      memberBankMethod: {
        path: bankScreenshotPath,
        sizeBytes: screenshotSize(bankScreenshotPath),
      },
      guardianChildCardMethod: {
        path: guardianScreenshotPath,
        sizeBytes: screenshotSize(guardianScreenshotPath),
      },
    },
  };

  for (const [label, screenshot] of Object.entries(report.screenshots)) {
    assert(screenshot.sizeBytes > 10_000, `${label} screenshot must be non-empty, got ${screenshot.sizeBytes} bytes`);
  }

  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await stopManagedAppServer();
}
