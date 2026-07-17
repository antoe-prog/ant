import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.PAYMENT_CHECKOUT_METHOD_FLOW_OUT_DIR ?? ".data/mobile-builds/ios/payment-checkout-payer-compact-20260704";
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
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "payment checkout method flow check",
  });

  if (await canReachAppServer()) {
    usingExistingAppServer = true;
    return;
  }

  managedAppServer = spawn(npmCommand, ["run", "dev", "--", "--webpack"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: new URL(baseUrl).port || "3000",
    },
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
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `payment checkout method flow ${label} reset`,
  });
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

async function gotoCheckout(page, role, paymentId, hash = "", method = "") {
  const methodQuery = method ? `&method=${encodeURIComponent(method)}` : "";
  const next = `/app/payments/checkout?paymentId=${encodeURIComponent(paymentId)}${methodQuery}${hash}`;
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

async function collectAddressDeepLinkDetails(page, label) {
  await page.waitForSelector('[data-testid="payment-payer-optional-details"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="payment-payer-address-search-feedback"]', { timeout: 10000 });

  const layout = await page.evaluate(() => {
    const addressFeedback = document.querySelector('[data-testid="payment-payer-address-search-feedback"]');
    const optionalToggle = document.querySelector('[data-testid="payment-payer-optional-toggle"]');
    const addressSection = document.getElementById("payment-payer-address")?.getBoundingClientRect();

    return {
      addressSearchFeedbackText: addressFeedback?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      addressSectionTop: Math.round(addressSection?.top ?? 0),
      optionalDetailsCount: document.querySelectorAll('[data-testid="payment-payer-optional-details"]').length,
      optionalToggleExpanded: optionalToggle?.getAttribute("aria-expanded") ?? null,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  assert.equal(layout.optionalDetailsCount, 1, `${label} must open optional payer details from the address hash`);
  assert.equal(layout.optionalToggleExpanded, "true", `${label} optional payer details toggle must reflect hash-opened state`);
  assert.match(layout.addressSearchFeedbackText, /우편번호와 주소를 직접 입력해 주세요\./, `${label} must show user-facing manual address guidance`);
  assert.doesNotMatch(
    layout.addressSearchFeedbackText,
    /API|연동 전|연결 전|준비 중|샘플|예시|테스트|더미/i,
    `${label} address hash feedback must avoid implementation-state copy`,
  );
  assert(layout.addressSectionTop >= 0 && layout.addressSectionTop <= 420, `${label} address section must be visible after hash navigation`);
  assert.equal(layout.scrollWidth, layout.clientWidth, `${label} address hash view must not horizontally overflow`);

  return layout;
}

async function collectCheckoutLayout(page, label) {
  const layout = await page.evaluate(() => {
    const confirmButton = document.querySelector('[data-testid="payment-confirm-draft-button"]');
    const cardGuideButtons = [...document.querySelectorAll('[data-testid="payment-card-guide-button"]')];
    const methodSection = document.querySelector('[data-testid="payment-checkout-method-section"]');
    const payerInfo = document.querySelector('[data-testid="payment-checkout-payer-info"]');
    const payerOptionalToggle = document.querySelector('[data-testid="payment-payer-optional-toggle"]');
    const summary = document.querySelector('[data-testid="payment-checkout-summary"]');
    const summaryGrid = document.querySelector('[data-testid="payment-checkout-summary-grid"]');
    const cardGuideButtonHeights = cardGuideButtons.map((button) => button.getBoundingClientRect().height);
    const summaryGridRowHeights = [...(summaryGrid?.children ?? [])].map((child) => child.getBoundingClientRect().height);

    return {
      bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
      cardGuideButtonCount: cardGuideButtons.length,
      cardGuideButtonMinHeight: cardGuideButtonHeights.length > 0 ? Math.min(...cardGuideButtonHeights) : 0,
      cardIssuerCount: document.querySelectorAll('[data-testid="payment-card-issuer-grid"] button').length,
      clientWidth: document.documentElement.clientWidth,
      confirmButtonHeight: confirmButton?.getBoundingClientRect().height ?? 0,
      methodSectionTop: methodSection?.getBoundingClientRect().top ?? 0,
      methodRadioCount: document.querySelectorAll('[data-testid^="payment-method-radio-"]').length,
      optionalDetailsCount: document.querySelectorAll('[data-testid="payment-payer-optional-details"]').length,
      optionalToggleExpanded: payerOptionalToggle?.getAttribute("aria-expanded") ?? null,
      optionalToggleHeight: payerOptionalToggle?.getBoundingClientRect().height ?? 0,
      payerInfoTop: payerInfo?.getBoundingClientRect().top ?? 0,
      payerInfoHeight: payerInfo?.getBoundingClientRect().height ?? 0,
      payerInfoCount: document.querySelectorAll('[data-testid="payment-checkout-payer-info"]').length,
      saveMethodControlCount: document.querySelectorAll('[data-testid="payment-save-method-checkbox"]').length,
      scrollWidth: document.documentElement.scrollWidth,
      summaryGridHeight: summaryGrid?.getBoundingClientRect().height ?? 0,
      summaryGridRowMinHeight: summaryGridRowHeights.length > 0 ? Math.min(...summaryGridRowHeights) : 0,
      summaryHeight: summary?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    };
  });

  assert.equal(layout.payerInfoCount, 1, `${label} must render payer info section`);
  assert.equal(layout.methodRadioCount, 4, `${label} must render four payment method choices`);
  assert(layout.cardIssuerCount >= 20, `${label} must render the expected card issuer grid`);
  assert.equal(layout.cardGuideButtonCount, 3, `${label} must render three card payment guide actions`);
  assert(layout.cardGuideButtonMinHeight >= 44, `${label} card payment guide actions must keep 44px touch targets`);
  assert.equal(layout.saveMethodControlCount, 0, `${label} must not pretend to save payment method data before provider integration`);
  assert(layout.confirmButtonHeight >= 44, `${label} confirm button must keep a 44px touch target`);
  assert(layout.summaryHeight > 0, `${label} must render the compact checkout summary`);
  assert(layout.summaryHeight <= 245, `${label} checkout summary must stay compact on mobile`);
  assert(layout.summaryGridHeight <= 150, `${label} summary grid must not return to tall card blocks`);
  assert(layout.summaryGridRowMinHeight >= 44, `${label} summary rows must keep a 44px touch target rhythm`);
  assert(layout.payerInfoTop > 0 && layout.payerInfoTop < layout.viewportHeight, `${label} payer info must start within the first mobile viewport`);
  assert(layout.payerInfoHeight <= 280, `${label} payer info must keep optional fields collapsed by default`);
  assert.equal(layout.optionalDetailsCount, 0, `${label} optional payer details must stay collapsed by default`);
  assert.equal(layout.optionalToggleExpanded, "false", `${label} optional payer details toggle must start collapsed`);
  assert(layout.optionalToggleHeight >= 44, `${label} optional payer details toggle must keep a 44px touch target`);
  assert(layout.methodSectionTop > layout.payerInfoTop, `${label} payment method section must follow payer info`);
  assert(layout.methodSectionTop - layout.payerInfoTop <= 360, `${label} payment method section must follow the compact payer info without excess spacing`);
  assert.equal(layout.scrollWidth, layout.clientWidth, `${label} must not horizontally overflow at 390px`);
  assert.match(layout.bodyText, /요청자 정보/, `${label} must show requester information copy`);
  assert.match(layout.bodyText, /이름·휴대전화 필수/, `${label} must make the required payer fields explicit`);
  assert.match(layout.bodyText, /주소·이메일 추가/, `${label} must expose optional payer details as an explicit compact action`);
  assert.match(layout.bodyText, /희망 납부 방법/, `${label} must show payment request method copy`);
  assert.match(layout.bodyText, /신용카드/, `${label} must include card method copy`);
  assert.doesNotMatch(layout.bodyText, /일반전화/, `${label} must not show optional landline fields before expansion`);
  assert.doesNotMatch(layout.bodyText, /우편번호/, `${label} must not show optional address fields before expansion`);

  return layout;
}

async function collectOptionalPayerDetails(page, label) {
  await page.getByTestId("payment-payer-optional-toggle").click();
  await page.waitForSelector('[data-testid="payment-payer-optional-details"]', { timeout: 10000 });
  await page.getByTestId("payment-payer-address-search").click();
  await page.waitForSelector('[data-testid="payment-payer-address-search-feedback"]', { timeout: 10000 });

  const layout = await page.evaluate(() => {
    const emailInput = document.querySelector('[data-testid="payment-payer-email-input"]');
    const optionalDetails = document.querySelector('[data-testid="payment-payer-optional-details"]');
    const optionalToggle = document.querySelector('[data-testid="payment-payer-optional-toggle"]');
    const addressSearch = document.querySelector('[data-testid="payment-payer-address-search"]');
    const addressFeedback = document.querySelector('[data-testid="payment-payer-address-search-feedback"]');
    const zipInput = document.querySelector('[data-testid="payment-payer-zip-input"]');
    const baseAddressInput = document.querySelector('[data-testid="payment-payer-base-address-input"]');
    const detailAddressInput = document.querySelector('[data-testid="payment-payer-detail-address-input"]');
    const landlinePrefix = document.querySelector('[data-testid="payment-payer-landline-prefix"]');

    return {
      addressSearchHeight: addressSearch?.getBoundingClientRect().height ?? 0,
      addressSearchFeedbackHeight: addressFeedback?.getBoundingClientRect().height ?? 0,
      addressSearchFeedbackText: addressFeedback?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      baseAddressValue: baseAddressInput instanceof HTMLInputElement ? baseAddressInput.value : "",
      clientWidth: document.documentElement.clientWidth,
      detailAddressValue: detailAddressInput instanceof HTMLInputElement ? detailAddressInput.value : "",
      emailPlaceholder: emailInput instanceof HTMLInputElement ? emailInput.placeholder : "",
      landlinePrefixHeight: landlinePrefix?.getBoundingClientRect().height ?? 0,
      optionalDetailsCount: document.querySelectorAll('[data-testid="payment-payer-optional-details"]').length,
      optionalDetailsHeight: optionalDetails?.getBoundingClientRect().height ?? 0,
      optionalToggleExpanded: optionalToggle?.getAttribute("aria-expanded") ?? null,
      scrollWidth: document.documentElement.scrollWidth,
      zipValue: zipInput instanceof HTMLInputElement ? zipInput.value : "",
    };
  });

  assert.equal(layout.optionalDetailsCount, 1, `${label} must render optional payer details after toggle`);
  assert.equal(layout.optionalToggleExpanded, "true", `${label} optional payer details toggle must reflect expanded state`);
  assert(layout.optionalDetailsHeight > 0, `${label} optional payer details must occupy visible space after expansion`);
  assert(layout.addressSearchHeight >= 44, `${label} address search must keep a 44px touch target`);
  assert(layout.addressSearchFeedbackHeight > 0, `${label} address search must show manual-entry feedback`);
  assert.match(layout.addressSearchFeedbackText, /직접 입력/, `${label} address search feedback must guide direct entry`);
  assert.doesNotMatch(
    layout.addressSearchFeedbackText,
    /API|연동 전|연결 전|준비 중|샘플|예시|테스트|더미|06164|서울 강남구 테헤란로/i,
    `${label} address search feedback must avoid internal/sample copy`,
  );
  assert.equal(layout.zipValue, "", `${label} address search must not inject a sample zip code`);
  assert.equal(layout.baseAddressValue, "", `${label} address search must not inject a sample base address`);
  assert.equal(layout.detailAddressValue, "", `${label} address search must not inject a sample detail address`);
  assert(layout.landlinePrefixHeight >= 44, `${label} landline prefix select must keep a 44px touch target`);
  assert.equal(layout.emailPlaceholder, "이메일 주소 입력", `${label} must use natural email input placeholder copy`);
  assert.doesNotMatch(
    layout.emailPlaceholder,
    /example|sample|\.test|샘플|예시/i,
    `${label} email placeholder must not expose sample/test copy`,
  );
  assert.equal(layout.scrollWidth, layout.clientWidth, `${label} optional payer details must not create horizontal overflow`);

  return layout;
}

async function collectWooriWonPayModalLayout(page, label) {
  const layout = await page.evaluate(() => {
    const modal = document.querySelector('[data-testid="payment-wooriwonpay-modal"]')?.getBoundingClientRect();
    const panel = document.querySelector('[data-testid="payment-wooriwonpay-panel"]')?.getBoundingClientRect();
    const close = document.querySelector('[data-testid="payment-wooriwonpay-close"]')?.getBoundingClientRect();
    const primaryTab = document.querySelector('[data-testid="payment-wooriwonpay-tab-primary"]')?.getBoundingClientRect();
    const secondaryTab = document.querySelector('[data-testid="payment-wooriwonpay-tab-secondary"]')?.getBoundingClientRect();
    const cardApp = document.querySelector('[data-testid="payment-wooriwonpay-card-app"]')?.getBoundingClientRect();
    const bankApp = document.querySelector('[data-testid="payment-wooriwonpay-bank-app"]')?.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    return {
      bankAppHeight: Math.round(bankApp?.height ?? 0),
      cardAppHeight: Math.round(cardApp?.height ?? 0),
      clientWidth: document.documentElement.clientWidth,
      closeHeight: Math.round(close?.height ?? 0),
      closeWidth: Math.round(close?.width ?? 0),
      modalBottom: Math.round(modal?.bottom ?? 0),
      modalTop: Math.round(modal?.top ?? 0),
      panelBottom: Math.round(panel?.bottom ?? 0),
      panelHeight: Math.round(panel?.height ?? 0),
      panelTop: Math.round(panel?.top ?? 0),
      primaryTabHeight: Math.round(primaryTab?.height ?? 0),
      scrollWidth: document.documentElement.scrollWidth,
      secondaryTabHeight: Math.round(secondaryTab?.height ?? 0),
      viewportHeight,
    };
  });

  assert(layout.panelHeight > 0, `${label} must render the WooriWON Pay panel`);
  assert(layout.closeHeight >= 44, `${label} close action must keep a 44px touch target; got ${layout.closeHeight}px`);
  assert(layout.closeWidth >= 44, `${label} close action must keep a 44px width target; got ${layout.closeWidth}px`);
  assert(layout.primaryTabHeight >= 44, `${label} primary tab must keep a 44px touch target`);
  assert(layout.secondaryTabHeight >= 44, `${label} secondary tab must keep a 44px touch target`);
  assert(layout.cardAppHeight >= 96, `${label} Woori Card app choice must stay easy to tap`);
  assert(layout.bankAppHeight >= 96, `${label} Woori Bank app choice must stay easy to tap`);
  assert(layout.panelTop >= 16, `${label} modal panel must keep top breathing room`);
  assert(layout.panelBottom <= layout.viewportHeight - 16, `${label} modal panel must keep bottom breathing room`);
  assert.equal(layout.scrollWidth, layout.clientWidth, `${label} modal must not create horizontal overflow`);

  return layout;
}

async function collectAccountMethodPanel(page, methodTestId, label, options = {}) {
  await page.getByTestId(methodTestId).click();
  await page.waitForSelector('[data-testid="payment-account-method-panel"]', { timeout: 10000 });

  const layout = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="payment-account-method-panel"]');
    const rect = panel?.getBoundingClientRect();

    return {
      height: Math.round(rect?.height ?? 0),
      text: panel?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      top: Math.round(rect?.top ?? 0),
      width: Math.round(rect?.width ?? 0),
    };
  });

  assert(layout.height >= 80, `${label} account method panel must remain readable`);
  if (options.expectVisible) {
    assert(layout.top >= 0 && layout.top <= 520, `${label} account method panel must be visible after hash navigation`);
  }
  assert.match(layout.text, /이 화면에서만 확인할 수 있습니다/, `${label} must disclose that the selection is not persisted`);
  assert.match(layout.text, /도장 안내 후 진행합니다/, `${label} must use user-facing payment guidance`);
  assert.doesNotMatch(
    layout.text,
    /운영 결제 설정|설정이 완료|전용 화면|연동 전|연결 전|API|준비 중|테스트|샘플|더미/i,
    `${label} must avoid internal setup or implementation-state copy`,
  );

  return layout;
}

async function collectConfirmationFeedbackA11y(page, label) {
  const layout = await page.evaluate(() => {
    const feedback = document.querySelector('[data-testid="payment-confirm-feedback"]');

    return {
      ariaLive: feedback?.getAttribute("aria-live") ?? "",
      id: feedback?.getAttribute("id") ?? "",
      role: feedback?.getAttribute("role") ?? "",
      text: feedback?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  });

  assert.equal(layout.role, "status", `${label} confirmation feedback must announce as a status message`);
  assert.equal(layout.ariaLive, "polite", `${label} confirmation feedback must use polite live-region timing`);
  assert.equal(layout.id, "payment-confirm-feedback", `${label} confirmation feedback must keep a stable id`);
  assert.match(layout.text, /선택 내용을 확인했습니다/, `${label} confirmation feedback must describe a local review rather than a submitted request`);
  assert.match(layout.text, /저장되거나 담당자에게 전달되지 않으며/, `${label} confirmation feedback must expose the unsaved state`);

  return layout;
}

async function collectBottomNavigationClearance(page, label) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);

  const layout = await page.evaluate(() => {
    const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect();
    const confirmButtonElement = document.querySelector('[data-testid="payment-confirm-draft-button"]');
    const providerStatusElement = document.querySelector('[data-testid="payment-checkout-provider-status"]');
    const confirmButton = confirmButtonElement?.getBoundingClientRect();
    const providerStatus = providerStatusElement?.getBoundingClientRect();
    const confirmButtonText = confirmButtonElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const providerStatusText = providerStatusElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const viewportHeight = window.innerHeight;
    const navTop = bottomNav?.top ?? viewportHeight;

    return {
      confirmButtonBottom: confirmButton?.bottom ?? 0,
      confirmButtonNavClearance: navTop - (confirmButton?.bottom ?? 0),
      confirmButtonText,
      navTop,
      providerStatusBottom: providerStatus?.bottom ?? 0,
      providerStatusNavClearance: navTop - (providerStatus?.bottom ?? 0),
      providerStatusText,
      scrollY: window.scrollY,
      viewportHeight,
    };
  });

  assert(layout.confirmButtonBottom > 0, `${label} must render the checkout confirmation action`);
  assert(layout.providerStatusBottom > 0, `${label} must render the payment provider status block`);
  assert(
    layout.confirmButtonNavClearance >= 24,
    `${label} confirmation action must clear the mobile bottom navigation by at least 24px`,
  );
  assert(
    layout.providerStatusNavClearance >= 24,
    `${label} provider status must clear the mobile bottom navigation by at least 24px`,
  );
  assert.match(layout.confirmButtonText, /입력 내용 확인/, `${label} confirm action must avoid implying a submitted request`);
  assert.doesNotMatch(layout.confirmButtonText, /결제 진행하기/, `${label} confirm action must not imply live payment approval`);
  assert.match(layout.providerStatusText, /결제 정보 확인 단계/, `${label} provider status must describe the current confirmation step`);
  assert.match(layout.providerStatusText, /저장·전달되지 않습니다/, `${label} provider status must avoid implying a persisted request`);
  assert.doesNotMatch(
    layout.providerStatusText,
    /온라인 결제 준비|실제 승인은|승인 완료|결제 완료/i,
    `${label} provider status must not imply live payment approval`,
  );

  return layout;
}

function cleanPaymentCheckoutOutputDir() {
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

function screenshotSize(path) {
  return statSync(path).size;
}

mkdirSync(outDir, { recursive: true });
const cleanedOutputFiles = cleanPaymentCheckoutOutputDir();

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
  const memberOptionalPayerDetails = await collectOptionalPayerDetails(page, "adult member checkout optional payer details");
  const memberOptionalScreenshotPath = join(outDir, "member-optional-payer-details-mobile.png");
  await page.getByTestId("payment-payer-optional-details").scrollIntoViewIfNeeded();
  await page.screenshot({ path: memberOptionalScreenshotPath, fullPage: false });

  await page.getByTestId("payment-card-issuer-woori").click();
  await page.waitForSelector('[data-testid="payment-wooriwonpay-modal"]', { timeout: 10000 });
  const wooriModalScreenshotPath = join(outDir, "wooriwonpay-modal-mobile.png");
  const wooriModalText = await page.getByTestId("payment-wooriwonpay-modal").innerText();
  assert.match(wooriModalText, /우리WON페이/, "Woori modal must show WooriWON Pay tab copy");
  assert.match(wooriModalText, /다른 수단/, "Woori modal must describe alternate methods without live-payment wording");
  assert.match(wooriModalText, /우리WON페이 선택을 확인합니다/, "Woori modal must frame the app choice as a selection confirmation");
  assert.match(wooriModalText, /앱 선택은 입력 내용 확인에만 사용됩니다/, "Woori modal must explain that app selection remains local confirmation");
  assert.match(wooriModalText, /우리카드 앱/, "Woori modal must show Woori Card app option");
  assert.match(wooriModalText, /우리은행 앱/, "Woori modal must show Woori Bank app option");
  assert.match(wooriModalText, /선택 확인/, "Woori modal app choices must confirm selection instead of claiming payment");
  assert.doesNotMatch(
    wooriModalText,
    /빠르고 간편하게 결제|우리WON페이 결제|즉시 결제|결제 완료|승인 완료|앱 연결은 도장 안내/i,
    "Woori modal must not imply live payment completion before provider connection",
  );
  const wooriModalLayout = await collectWooriWonPayModalLayout(page, "WooriWON Pay modal");
  const primaryWooriTab = page.getByTestId("payment-wooriwonpay-tab-primary");
  const secondaryWooriTab = page.getByTestId("payment-wooriwonpay-tab-secondary");
  await primaryWooriTab.focus();
  await primaryWooriTab.press("ArrowRight");
  assert.equal(await secondaryWooriTab.getAttribute("aria-selected"), "true", "Woori modal ArrowRight must select the next tab");
  assert.equal(
    await secondaryWooriTab.evaluate((tab) => tab === document.activeElement),
    true,
    "Woori modal ArrowRight must move focus with selection",
  );
  await secondaryWooriTab.press("Home");
  assert.equal(await primaryWooriTab.getAttribute("aria-selected"), "true", "Woori modal Home must restore the first tab");
  await page.screenshot({ path: wooriModalScreenshotPath, fullPage: false });
  await page.getByTestId("payment-wooriwonpay-close").click();
  await page.waitForSelector('[data-testid="payment-wooriwonpay-modal"]', { state: "detached", timeout: 10000 });

  const cardGuideButton = page.getByTestId("payment-card-guide-button").first();
  await cardGuideButton.click();
  const cardGuideFeedback = page.getByTestId("payment-card-guide-feedback");
  assert.equal(await cardGuideFeedback.getAttribute("role"), "status", "card guide feedback must announce as a status message");
  assert.match(await cardGuideFeedback.innerText(), /이 화면에서는 인증이나 결제가 진행되지 않습니다/, "card guide must explain its non-payment scope");

  await page.getByTestId("payment-method-radio-bankTransfer").click();
  await page.waitForSelector('[data-testid="payment-bank-transfer-panel"]', { timeout: 10000 });
  const bankPanelText = await page.getByTestId("payment-bank-transfer-panel").innerText();
  assert.match(bankPanelText, /입금은행/, "bank transfer panel must show bank selector label");
  assert.match(bankPanelText, /입금자명/, "bank transfer panel must show depositor name label");
  await page.getByTestId("payment-confirm-draft-button").click();
  await page.waitForSelector('[data-testid="payment-confirm-feedback"]', { timeout: 10000 });
  const confirmationFeedbackA11y = await collectConfirmationFeedbackA11y(page, "adult member bank transfer checkout");
  const bankFeedback = await page.getByTestId("payment-confirm-feedback").innerText();
  assert.match(bankFeedback, /우리은행/, "bank transfer confirmation must summarize the selected bank");
  assert.match(bankFeedback, /선택 내용을 확인했습니다/, "bank transfer confirmation must describe local input review rather than submission");
  assert.match(bankFeedback, /저장되거나 담당자에게 전달되지 않으며/, "bank transfer confirmation must expose the unsaved state");
  assert.match(bankFeedback, /실제 결제나 출금도 진행되지 않습니다/, "bank transfer confirmation must not imply immediate approval");
  assert.doesNotMatch(
    bankFeedback,
    /실제 결제 승인은|승인 완료|결제 완료/i,
    "bank transfer confirmation must avoid live approval copy",
  );
  await page.getByTestId("payment-payer-name-input").fill("최민재 확인");
  assert.equal(
    await page.getByTestId("payment-confirm-feedback").getAttribute("data-confirmation-state"),
    "changed",
    "editing confirmed payer info must invalidate the prior confirmation",
  );
  assert.match(
    await page.getByTestId("payment-confirm-feedback").innerText(),
    /현재 내용으로 다시 확인해 주세요/,
    "invalidated confirmation must ask for a fresh review",
  );
  await page.getByTestId("payment-confirm-draft-button").click();
  assert.equal(
    await page.getByTestId("payment-confirm-feedback").getAttribute("data-confirmation-state"),
    "current",
    "reconfirming edited payer info must restore the current state",
  );
  const virtualAccountPanel = await collectAccountMethodPanel(
    page,
    "payment-method-radio-virtualAccount",
    "adult member virtual account checkout",
  );
  const accountTransferPanel = await collectAccountMethodPanel(
    page,
    "payment-method-radio-accountTransfer",
    "adult member account transfer checkout",
  );
  const bankScreenshotPath = join(outDir, "member-bank-method-mobile.png");
  await page.screenshot({ path: bankScreenshotPath, fullPage: false });
  const memberBottomNavigationClearance = await collectBottomNavigationClearance(page, "adult member checkout bottom");
  const memberBottomScreenshotPath = join(outDir, "member-bottom-clearance-mobile.png");
  await page.screenshot({ path: memberBottomScreenshotPath, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 0));

  await gotoCheckout(page, "member", "pay-minjae", "#payment-payer-address");
  const memberAddressDeepLink = await collectAddressDeepLinkDetails(page, "adult member address deep link");
  const memberAddressDeepLinkScreenshotPath = join(outDir, "member-address-deeplink-mobile.png");
  await page.screenshot({ path: memberAddressDeepLinkScreenshotPath, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 0));

  await gotoCheckout(page, "member", "pay-minjae", "#payment-account-method-panel", "accountTransfer");
  const accountTransferDeepLinkPanel = await collectAccountMethodPanel(
    page,
    "payment-method-radio-accountTransfer",
    "adult member account transfer deep link checkout",
    { expectVisible: true },
  );
  const accountTransferDeepLinkScreenshotPath = join(outDir, "member-account-transfer-deeplink-mobile.png");
  await page.screenshot({ path: accountTransferDeepLinkScreenshotPath, fullPage: false });

  await gotoCheckout(page, "guardian", "pay-yuna");
  const guardianLayout = await collectCheckoutLayout(page, "guardian child checkout");
  const guardianBottomNavigationClearance = await collectBottomNavigationClearance(page, "guardian child checkout bottom");
  await page.evaluate(() => window.scrollTo(0, 0));
  const guardianScreenshotPath = join(outDir, "guardian-child-card-method-mobile.png");
  await page.screenshot({ path: guardianScreenshotPath, fullPage: false });
  await page.getByTestId("payment-confirm-draft-button").click();
  await page.getByTestId("payment-collection-request-submit").click();
  await page.waitForSelector('[data-testid="payment-collection-request-pending"]', { timeout: 10000 });
  const collectionRequestText = await page.getByTestId("payment-collection-request-pending").innerText();
  assert.match(collectionRequestText, /접수 완료/, "family payment request must persist and render a pending state");
  assert.match(collectionRequestText, /담당자가 확인 후 안내합니다/, "family payment request must explain the staff follow-up");
  const collectionRequestScreenshotPath = join(outDir, "guardian-collection-request-pending-mobile.png");
  await page.screenshot({ path: collectionRequestScreenshotPath, fullPage: false });

  assert.deepEqual(messages, [], "payment checkout method flow must not emit console warnings/errors");

  const report = {
    ok: true,
    appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
    baseUrl,
    viewport: "390x844",
    outputCleanup: {
      outDir,
      removedCount: cleanedOutputFiles.length,
      removedFiles: cleanedOutputFiles,
    },
    checked: [
      "adult member checkout renders payer info and payment method selection",
      "card issuer grid renders Woori card app handoff modal",
      "WooriWON Pay modal copy confirms app selection without implying live payment",
      "WooriWON Pay modal keeps 44px close and tab touch targets",
      "WooriWON Pay tabs support roving keyboard focus",
      "card payment guide actions provide explicit non-payment feedback",
      "bank transfer method renders bank and depositor inputs",
      "virtual account and account transfer panels avoid internal setup copy",
      "guardian child checkout uses the same payment input flow",
      "guardian payment request persists and returns as a staff follow-up pending state",
      "payer email placeholder avoids sample/test account copy",
      "checkout summary stays compact before payer information",
      "optional payer address landline and email details stay collapsed until requested",
      "address search avoids sample autofill before provider integration",
      "address hash opens the manual address section without implementation-state copy",
      "payment method query can open account transfer guidance directly",
      "checkout confirmation and payer receipt status clear the mobile bottom navigation",
      "checkout action and status copy avoid implying live payment approval before provider connection",
      "checkout confirmation feedback announces through a polite status live region",
      "editing reviewed payer data invalidates stale confirmation until reviewed again",
      "unimplemented reusable payment information controls stay hidden",
      "mobile checkout screens stay nonblank, overflow-free, and console-clean",
    ],
    consoleMessages: messages,
    bottomNavigationClearance: {
      guardian: guardianBottomNavigationClearance,
      member: memberBottomNavigationClearance,
    },
    layouts: {
      guardian: guardianLayout,
      memberAddressDeepLink,
      member: memberLayout,
      memberOptionalPayerDetails,
      confirmationFeedbackA11y,
      virtualAccountPanel,
      accountTransferPanel,
      accountTransferDeepLinkPanel,
      wooriModal: wooriModalLayout,
    },
    resetBefore,
    resetAfter: await resetDevData("after"),
    screenshots: {
      memberCardMethod: {
        path: memberScreenshotPath,
        sizeBytes: screenshotSize(memberScreenshotPath),
      },
      memberOptionalPayerDetails: {
        path: memberOptionalScreenshotPath,
        sizeBytes: screenshotSize(memberOptionalScreenshotPath),
      },
      wooriWonPayModal: {
        path: wooriModalScreenshotPath,
        sizeBytes: screenshotSize(wooriModalScreenshotPath),
      },
      memberBankMethod: {
        path: bankScreenshotPath,
        sizeBytes: screenshotSize(bankScreenshotPath),
      },
      memberBottomClearance: {
        path: memberBottomScreenshotPath,
        sizeBytes: screenshotSize(memberBottomScreenshotPath),
      },
      memberAddressDeepLink: {
        path: memberAddressDeepLinkScreenshotPath,
        sizeBytes: screenshotSize(memberAddressDeepLinkScreenshotPath),
      },
      memberAccountTransferDeepLink: {
        path: accountTransferDeepLinkScreenshotPath,
        sizeBytes: screenshotSize(accountTransferDeepLinkScreenshotPath),
      },
      guardianChildCardMethod: {
        path: guardianScreenshotPath,
        sizeBytes: screenshotSize(guardianScreenshotPath),
      },
      guardianCollectionRequestPending: {
        path: collectionRequestScreenshotPath,
        sizeBytes: screenshotSize(collectionRequestScreenshotPath),
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
