import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  cleanupReleaseSmokeEnvironment,
  getFreePort,
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

let baseUrl = process.env.SMOKE_BASE_URL?.trim() || null;
const outDir = process.env.MOBILE_NOTIFICATION_INBOX_OUT_DIR ?? ".data/mobile-builds/ios/mobile-notification-inbox-20260701";
const serverStartupTimeoutMs = (() => {
  const configured = Number.parseInt(process.env.MOBILE_NOTIFICATION_INBOX_SERVER_TIMEOUT_MS ?? "", 10);

  return Number.isFinite(configured) && configured >= 30_000 ? configured : 90_000;
})();
const chromeCandidates = [
  process.env.E2E_CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const familyCases = [
  {
    id: "member",
    role: "member",
    currentUserSubscribed: true,
    hasExistingBrowserSubscription: true,
  },
  {
    id: "guardian",
    role: "guardian",
    currentUserSubscribed: false,
    hasExistingBrowserSubscription: false,
  },
];
const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
let managedAppServer = null;
const managedAppServerLogs = [];
let managedDistDir = null;
let managedTsconfigPath = null;
let smokeEnvironmentPlan = null;

function findChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate));
}

function signalManagedAppServer(signal) {
  if (!managedAppServer || managedAppServer.exitCode !== null) {
    return;
  }

  if (process.platform !== "win32" && managedAppServer.pid) {
    try {
      process.kill(-managedAppServer.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when its process group has already exited.
    }
  }

  managedAppServer.kill(signal);
}

function cleanupOrphanedManagedArtifacts() {
  for (const entry of readdirSync(".")) {
    const match = entry.match(/^\.(?:next-mobile-notification|tmp-mobile-notification-tsconfig)-(\d+)-\d+(?:\.json)?$/);

    if (!match) {
      continue;
    }

    const ownerPid = Number.parseInt(match[1], 10);
    let ownerIsRunning = false;

    try {
      process.kill(ownerPid, 0);
      ownerIsRunning = true;
    } catch (error) {
      ownerIsRunning = error?.code === "EPERM";
    }

    if (!ownerIsRunning) {
      rmSync(entry, { force: true, recursive: true });
    }
  }
}

function canResetDevData() {
  const { hostname, protocol } = new URL(baseUrl);

  return protocol === "http:" && ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname);
}

async function canReachAppServer() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(baseUrl, { method: "GET", redirect: "manual", signal: controller.signal });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureLocalAppServer() {
  assert(baseUrl, "mobile notification inbox check requires a resolved local base URL");
  smokeEnvironmentPlan = await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "mobile notification inbox check",
  });

  if (await canReachAppServer()) {
    return "existing";
  }

  const target = new URL(baseUrl);
  const hostname = target.hostname.replace(/^\[(.*)\]$/, "$1");
  const port = target.port || "3000";
  cleanupOrphanedManagedArtifacts();
  const runId = `${process.pid}-${Date.now()}`;
  managedDistDir = `.next-mobile-notification-${runId}`;
  managedTsconfigPath = `.tmp-mobile-notification-tsconfig-${runId}.json`;
  writeFileSync(
    managedTsconfigPath,
    `${JSON.stringify({
      extends: "./tsconfig.json",
      include: [
        "next-env.d.ts",
        "next.config.ts",
        "src/**/*.ts",
        "src/**/*.tsx",
        `${managedDistDir}/types/**/*.ts`,
        `${managedDistDir}/dev/types/**/*.ts`,
      ],
    }, null, 2)}\n`,
  );

  managedAppServer = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", hostname, "--port", port],
    {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        FINAL_JUDO_NEXT_DIST_DIR: managedDistDir,
        FINAL_JUDO_NEXT_TSCONFIG_PATH: managedTsconfigPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const captureServerLog = (chunk) => {
    managedAppServerLogs.push(...String(chunk).split("\n").filter(Boolean));
    if (managedAppServerLogs.length > 120) {
      managedAppServerLogs.splice(0, managedAppServerLogs.length - 120);
    }
  };

  managedAppServer.stdout.on("data", captureServerLog);
  managedAppServer.stderr.on("data", captureServerLog);

  const startedAt = Date.now();
  while (Date.now() - startedAt < serverStartupTimeoutMs) {
    if (await canReachAppServer()) {
      return "managed-next-dev-webpack";
    }
    if (managedAppServer.exitCode !== null) {
      throw new Error(
        `Mobile notification inbox server exited before ${baseUrl} became reachable.\n${managedAppServerLogs.slice(-40).join("\n")}`,
      );
    }
    await sleep(500);
  }

  throw new Error(
    `Timed out after ${serverStartupTimeoutMs}ms waiting for mobile notification inbox server at ${baseUrl}.\n${managedAppServerLogs.slice(-40).join("\n")}`,
  );
}

async function cleanupLocalAppServer() {
  if (managedAppServer?.exitCode === null) {
    const closed = new Promise((resolve) => managedAppServer.once("close", resolve));
    signalManagedAppServer("SIGINT");
    await Promise.race([
      closed,
      sleep(5000).then(() => {
        if (managedAppServer?.exitCode === null) {
          signalManagedAppServer("SIGTERM");
        }
      }),
    ]);

    if (managedAppServer.exitCode === null) {
      await Promise.race([closed, sleep(5000)]);
    }

    if (managedAppServer.exitCode === null) {
      signalManagedAppServer("SIGKILL");
      await Promise.race([closed, sleep(5000)]);
    }
  }

  if (smokeEnvironmentPlan?.created) {
    await cleanupReleaseSmokeEnvironment({ dataDir: smokeEnvironmentPlan.dataDir });
  }

  if (managedDistDir) {
    rmSync(managedDistDir, { force: true, recursive: true });
  }
  if (managedTsconfigPath) {
    rmSync(managedTsconfigPath, { force: true });
  }
}

async function prewarmLocalAppRoutes() {
  const routes = [
    { path: "/login", statuses: [200] },
    { path: "/app/dashboard", statuses: [200] },
    { path: "/api/v1/me/bootstrap?optional=1", statuses: [200] },
    {
      path: "/api/v1/me/notices/prewarm/read",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      statuses: [401],
    },
  ];

  for (const route of routes) {
    const response = await fetch(new URL(route.path, baseUrl), { redirect: "manual", ...route.init });

    assert(
      route.statuses.includes(response.status),
      `mobile notification inbox prewarm failed for ${route.path} with ${response.status}`,
    );
  }
}

async function resetDevData(label) {
  if (!canResetDevData()) {
    return {
      attempted: false,
      label,
      reason: "non-local-base-url",
    };
  }

  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `mobile notification inbox ${label} reset`,
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `mobile notification inbox ${label} dev reset failed with ${response.status}`);

  return {
    attempted: true,
    label,
    ok: response.ok,
    status: response.status,
    counts: payload?.data?.counts ?? null,
  };
}

async function collectInboxState(page) {
  return page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const rectFor = (element) => {
      const rect = element?.getBoundingClientRect();

      return rect
        ? {
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
          }
        : null;
    };
    const boxes = Array.from(document.querySelectorAll("button, a")).map((element) => {
      const rect = element.getBoundingClientRect();

      return {
        height: Math.round(rect.height),
        testId: element.getAttribute("data-testid") ?? "",
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? element.getAttribute("aria-label") ?? "",
        visible: rect.width > 0 && rect.height > 0,
        width: Math.round(rect.width),
      };
    });
    const undersizedVisibleTargets = boxes.filter(
      (box) =>
        box.visible &&
        box.testId &&
        [
          "notification-filter-all",
          "notification-filter-unread",
          "notification-filter-important",
          "notification-filter-payment",
          "notification-filter-promotion",
          "notification-bulk-read-filtered",
          "notification-read-action",
          "family-push-enable-action",
        ].includes(box.testId) &&
        (box.width < 44 || box.height < 44),
    );
    const bottomNav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
    const bottomNavRect = rectFor(bottomNav);
    const filterToolbar = document.querySelector('[data-testid="notification-filter-toolbar"]');
    const filterToolbarRect = rectFor(filterToolbar);
    const filterToolbarElement = filterToolbar instanceof HTMLElement ? filterToolbar : null;
    const filterToolbarButtons = filterToolbar ? Array.from(filterToolbar.querySelectorAll("button")) : [];
    const nestedFilterFrames = filterToolbar
      ? Array.from(filterToolbar.querySelectorAll("div")).filter((element) => {
          const className = typeof element.className === "string" ? element.className : "";

          return className.includes("border") && className.includes("bg-white") && className.includes("p-0.5");
        })
      : [];
    const lastCard = Array.from(document.querySelectorAll('[data-testid="notification-inbox-card"]')).at(-1);
    const lastAction = lastCard?.querySelector('[data-testid="notification-detail-link"], [data-testid="notification-read-action"]');
    const lastCardRect = rectFor(lastCard);
    const lastActionRect = rectFor(lastAction);
    const safeAreaRect = rectFor(document.querySelector('[data-testid="notification-bottom-safe-area"]'));
    const viewportHeight = window.innerHeight;
    const contentBottomBoundary = bottomNavRect?.top ?? viewportHeight;
    const intersectsViewport = (rect) => Boolean(rect && rect.bottom > 0 && rect.top < viewportHeight);

    return {
      actionableSummary: text('[data-testid="notification-actionable-count-summary"]'),
      bulkReadButtonState: document.querySelector('[data-testid="notification-bulk-read-filtered"]')?.getAttribute("data-notification-bulk-read-state") ?? "",
      cardCount: document.querySelectorAll('[data-testid="notification-inbox-card"]').length,
      deleteActionCount: document.querySelectorAll('[data-testid="notification-notice-delete-action"]').length,
      frameworkOverlayCount:
        document.querySelectorAll("[data-nextjs-dialog]").length +
        Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0).length,
      heading: text("main h1"),
      filterToolbarButtonCount: filterToolbarButtons.length,
      filterToolbarHeight: filterToolbarRect?.height ?? 0,
      filterToolbarNestedFrameCount: nestedFilterFrames.length,
      filterToolbarOverflow: filterToolbarElement ? filterToolbarElement.scrollWidth - filterToolbarElement.clientWidth : 0,
      filterToolbarVisible: Boolean(filterToolbarRect && filterToolbarRect.height > 0),
      importantFilterText: text('[data-testid="notification-filter-important"]'),
      inboxText: text('[data-testid="notifications-screen"]'),
      noticeCardHeights: Array.from(document.querySelectorAll('[data-notification-kind="notice"][data-testid="notification-inbox-card"]'))
        .map((card) => Math.round(card.getBoundingClientRect().height))
        .filter((height) => height > 0),
      noticeMetaLabels: Array.from(
        document.querySelectorAll('[data-notification-kind="notice"] [data-testid="notification-meta"]'),
      )
        .map((meta) => meta.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean),
      paymentActionLabels: Array.from(document.querySelectorAll('[data-notification-kind="payment"] [data-testid="notification-detail-link"]'))
        .map((link) => link.getAttribute("data-notification-action-label") ?? link.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean),
      paymentTitles: Array.from(document.querySelectorAll('[data-notification-kind="payment"] h2'))
        .map((heading) => heading.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean),
      readActionCount: document.querySelectorAll('[data-testid="notification-read-action"]').length,
      readActionWidths: boxes
        .filter((box) => box.testId === "notification-read-action" && box.visible)
        .map((box) => box.width),
      readCardCount: document.querySelectorAll('[data-notification-read-state="read"]').length,
      readFeedback: text('[data-testid="notification-read-feedback"]'),
      familyPushConnectionVisible: Boolean(document.querySelector('[data-testid="family-push-connection-row"]')),
      familyPushEnableLabel: text('[data-testid="family-push-enable-action"]'),
      safeAreaCount: document.querySelectorAll('[data-testid="notification-bottom-safe-area"]').length,
      safeAreaHeight: safeAreaRect?.height ?? 0,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth,
      viewportHeight,
      bottomCardClearance: lastCardRect ? contentBottomBoundary - lastCardRect.bottom : null,
      bottomActionClearance: lastActionRect ? contentBottomBoundary - lastActionRect.bottom : null,
      lastActionIntersectsViewport: intersectsViewport(lastActionRect),
      lastCardIntersectsViewport: intersectsViewport(lastCardRect),
      undersizedVisibleTargets,
      unreadFilterText: text('[data-testid="notification-filter-unread"]'),
    };
  });
}

async function seedGuardianPendingOnlinePayment(page) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", "owner");
  loginUrl.searchParams.set("next", "/app/payments");
  await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
  try {
    await page.waitForURL((url) => url.pathname === "/app/payments", { timeout: 15000 });
    await page.getByRole("heading", { name: "결제 상태" }).waitFor({ timeout: 10000 });
  } catch (error) {
    const diagnostic = {
      bodyText: (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500),
      url: page.url(),
    };
    throw new Error(`Owner payment seed login did not complete: ${JSON.stringify(diagnostic)}`, { cause: error });
  }

  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/payments/pay-yuna/online-checkout?selectedBranchId=branch-gangnam", {
      method: "POST",
    });
    const payload = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      checkoutStatus: payload?.data?.checkout?.status ?? null,
      provider: payload?.data?.checkout?.provider ?? null,
    };
  });

  assert.equal(result.ok, true, `guardian pending payment seed must create a local online checkout: ${JSON.stringify(result)}`);
  assert.equal(result.checkoutStatus, "pending", "guardian pending payment seed must produce a pending checkout state");

  return result;
}

async function verifyFamilyPushOwnershipAtAppEntry(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await context.addInitScript(() => {
    const testState = {
      permissionRequestCount: 0,
      serviceWorkerRegisterCount: 0,
      subscriptionCreateCount: 0,
    };
    const subscription = {
      endpoint: "https://push.example.test/shared-family-device",
      expirationTime: null,
      keys: {
        auth: "shared-auth-key",
        p256dh: "shared-p256dh-key",
      },
    };
    const browserSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      toJSON: () => subscription,
    };
    const pushManager = {
      getSubscription: async () => browserSubscription,
      subscribe: async () => {
        testState.subscriptionCreateCount += 1;
        return browserSubscription;
      },
    };
    const registration = {
      installing: null,
      pushManager,
      unregister: async () => true,
      update: async () => {},
      waiting: null,
    };

    Object.defineProperty(window, "__finalPushAppEntryTestState", {
      configurable: true,
      value: testState,
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "granted",
        requestPermission: async () => {
          testState.permissionRequestCount += 1;
          return "granted";
        },
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class PushManager {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: () => {},
        getRegistration: async () => registration,
        getRegistrations: async () => [registration],
        register: async () => {
          testState.serviceWorkerRegisterCount += 1;
          return registration;
        },
        removeEventListener: () => {},
      },
    });
  });
  const page = await context.newPage();
  const messages = [];
  const pushSubscriptionRequests = [];
  let pushConfigRequestCount = 0;
  const screenshotPath = join(outDir, "member-app-entry-push-ownership.png");

  page.on("console", (message) => {
    if (message.type() === "error") {
      messages.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });
  await page.route("**/api/v1/notifications/push-config", async (route) => {
    pushConfigRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          activeSubscriptionCount: 1,
          configured: true,
          currentUserSubscribed: true,
          publicKey: "AQIDBA",
          subject: "mailto:qa@example.test",
        },
      }),
    });
  });
  await page.route("**/api/v1/notifications/subscriptions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    pushSubscriptionRequests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          activeSubscriptionCount: 1,
          subscription: {
            disabledAt: null,
            endpointHint: "...device",
            id: "push-member-app-entry",
          },
        },
      }),
    });
  });

  try {
    const loginUrl = new URL("/login", baseUrl);
    loginUrl.searchParams.set("autoLogin", "1");
    loginUrl.searchParams.set("role", "member");
    loginUrl.searchParams.set("next", "/app/dashboard");

    try {
      await page.goto(loginUrl.toString(), { timeout: 60_000, waitUntil: "domcontentloaded" });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nManaged app server log:\n${managedAppServerLogs.slice(-60).join("\n")}`,
      );
    }
    await page.waitForURL("**/app/dashboard", { timeout: 30_000 });
    try {
      await page.waitForSelector('[data-testid="mobile-account-menu-toggle"]', { timeout: 60_000 });
    } catch (error) {
      const diagnosticState = await page.evaluate(() => ({
        bodyText: document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) ?? "",
        testState: window.__finalPushAppEntryTestState,
        url: window.location.href,
      }));

      throw new Error(
        `Family app entry did not finish rendering: ${JSON.stringify({
          diagnosticState,
          managedAppServerLogs: managedAppServerLogs.slice(-60),
          messages,
          pushConfigRequestCount,
          pushSubscriptionRequestCount: pushSubscriptionRequests.length,
        })}`,
        { cause: error },
      );
    }
    const requestDeadline = Date.now() + 20_000;

    while (pushSubscriptionRequests.length === 0 && Date.now() < requestDeadline) {
      await sleep(250);
    }

    if (pushSubscriptionRequests.length === 0) {
      const diagnosticState = await page.evaluate(() => ({
        bodyText: document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) ?? "",
        testState: window.__finalPushAppEntryTestState,
        url: window.location.href,
      }));

      assert.fail(
        `family app entry did not reconcile the existing browser endpoint: ${JSON.stringify({
          diagnosticState,
          messages,
          pushConfigRequestCount,
        })}`,
      );
    }
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const state = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      testState: window.__finalPushAppEntryTestState,
      url: window.location.href,
    }));

    assert.equal(messages.length, 0, `family app entry must not log console/page errors: ${messages.join(" | ")}`);
    assert.equal(pushSubscriptionRequests.length, 1, "family app entry must reconcile exactly one existing browser endpoint");
    assert.equal(
      pushSubscriptionRequests[0]?.subscription?.endpoint,
      "https://push.example.test/shared-family-device",
      "family app entry must persist the existing shared-browser endpoint for the signed-in member",
    );
    assert.equal(
      pushSubscriptionRequests[0]?.allowReactivation,
      false,
      "family app entry must not reactivate a push credential disabled by a security-context change",
    );
    assert.equal(state.testState.permissionRequestCount, 0, "family app entry must not request notification permission");
    assert.equal(state.testState.subscriptionCreateCount, 0, "family app entry must reuse an existing browser subscription");
    assert.equal(state.testState.serviceWorkerRegisterCount, 0, "family app entry must reuse an existing service worker registration");
    assert.equal(state.scrollWidth, state.clientWidth, "family app entry dashboard must not overflow horizontally");
    assert(statSync(screenshotPath).size > 10_000, "family app entry screenshot must be non-empty");

    return {
      allowReactivation: pushSubscriptionRequests[0]?.allowReactivation,
      messages,
      pushSubscriptionRequestCount: pushSubscriptionRequests.length,
      screenshotPath,
      screenshotSizeBytes: statSync(screenshotPath).size,
      state,
    };
  } finally {
    await context.close();
  }
}

async function verifyFamilyCase(browser, testCase) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await context.addInitScript(({ hasExistingBrowserSubscription }) => {
    let permission = "default";
    const subscription = {
      endpoint: "https://push.example.test/final-judo-device",
      expirationTime: null,
      keys: {
        auth: "test-auth-key",
        p256dh: "test-p256dh-key",
      },
    };
    const browserSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      toJSON: () => subscription,
    };
    const pushManager = {
      getSubscription: async () => (hasExistingBrowserSubscription ? browserSubscription : null),
      subscribe: async () => browserSubscription,
    };

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        get permission() {
          return permission;
        },
        requestPermission: async () => {
          permission = "granted";
          return permission;
        },
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class PushManager {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: () => {},
        getRegistration: async () => null,
        getRegistrations: async () => [],
        register: async () => ({ pushManager }),
        removeEventListener: () => {},
      },
    });
  }, { hasExistingBrowserSubscription: testCase.hasExistingBrowserSubscription });
  const page = await context.newPage();
  const messages = [];
  const pushSubscriptionRequests = [];
  const beforeScreenshotPath = join(outDir, `${testCase.id}-notifications-mobile-browser-before.png`);
  const afterPushScreenshotPath = join(outDir, `${testCase.id}-notifications-mobile-browser-after-push.png`);
  const afterReadScreenshotPath = join(outDir, `${testCase.id}-notifications-mobile-browser-after-read.png`);
  const scrollEndScreenshotPath = join(outDir, `${testCase.id}-notifications-mobile-browser-scroll-end.png`);
  const pendingPaymentSeed = testCase.role === "guardian" ? await seedGuardianPendingOnlinePayment(page) : null;

  page.on("console", (message) => {
    if (message.type() === "error") {
      messages.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });
  await page.route("**/api/v1/notifications/push-config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          activeSubscriptionCount: testCase.currentUserSubscribed ? 1 : 0,
          configured: true,
          currentUserSubscribed: testCase.currentUserSubscribed,
          publicKey: "AQIDBA",
          subject: "mailto:qa@example.test",
        },
      }),
    });
  });
  await page.route("**/api/v1/notifications/subscriptions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    pushSubscriptionRequests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          activeSubscriptionCount: 1,
          subscription: {
            disabledAt: null,
            endpointHint: "...device",
            id: `push-${testCase.id}`,
          },
        },
      }),
    });
  });

  try {
    const loginUrl = new URL("/login", baseUrl);
    loginUrl.searchParams.set("autoLogin", "1");
    loginUrl.searchParams.set("role", testCase.role);
    loginUrl.searchParams.set(
      "next",
      testCase.role === "guardian" ? "/app/notifications?memberId=member-yuna" : "/app/notifications",
    );
    await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
    try {
      await page.waitForSelector('[data-testid="notifications-screen"]', { timeout: 10000 });
    } catch (error) {
      const diagnostic = {
        bodyText: (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500),
        messages,
        role: testCase.role,
        url: page.url(),
      };
      throw new Error(`Notification inbox did not render: ${JSON.stringify(diagnostic)}`, { cause: error });
    }
    if (testCase.role === "guardian") {
      const targetChild = page.getByTestId("guardian-child-chip").filter({ hasText: "한유나" });
      await targetChild.click();
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll('[data-testid="guardian-child-chip"]'))
            .some((element) => element.getAttribute("aria-pressed") === "true" && element.textContent?.includes("한유나")),
        null,
        { timeout: 10000 },
      );
    }
    await page.waitForSelector('[data-testid="family-push-connection-row"]', { timeout: 10000 });
    await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
    const beforeState = await collectInboxState(page);

    assert.equal(messages.length, 0, `${testCase.id} notifications must not log console/page errors: ${messages.join(" | ")}`);
    assert.equal(beforeState.frameworkOverlayCount, 0, `${testCase.id} notifications must not show a framework error overlay`);
    assert.equal(beforeState.heading, "알림함", `${testCase.id} notifications must render the inbox heading`);
    assert.equal(beforeState.familyPushConnectionVisible, true, `${testCase.id} notifications must offer device push activation`);
    assert.equal(beforeState.familyPushEnableLabel, "알림 켜기", `${testCase.id} notifications must use a clear push activation label`);
    assert(beforeState.cardCount > 0, `${testCase.id} notifications must render at least one inbox card`);
    assert(
      Math.max(0, ...beforeState.noticeCardHeights) <= 132,
      `${testCase.id} notifications must keep mobile notice cards compact: ${JSON.stringify(beforeState.noticeCardHeights)}`,
    );
    assert(beforeState.readActionCount > 0, `${testCase.id} notifications must start with at least one unread notice action`);
    assert.equal(beforeState.deleteActionCount, 0, `${testCase.id} notifications must not expose notice delete actions to family roles`);
    assert(
      beforeState.noticeMetaLabels.every(
        (label) =>
          !/(^| · |, )(대표|코치|학부모|회원|총괄 어드민)( · |, |$)/.test(label) &&
          /(본관|관|지점 미지정) · /.test(label),
      ),
      `${testCase.id} notice metadata must show branch/target/time without internal audience roles: ${JSON.stringify(beforeState.noticeMetaLabels)}`,
    );
    assert.doesNotMatch(
      beforeState.inboxText,
      /결제 진행 필요|결제 진행 중|결제하기/,
      `${testCase.id} notifications must not imply live payment progress before provider connection`,
    );
    if (testCase.role === "guardian") {
      const guardianPaymentDiagnostic = await page.evaluate(async () => {
        const response = await fetch("/api/v1/me/bootstrap");
        const payload = await response.json().catch(() => null);
        const payment = payload?.data?.db?.payments?.find((item) => item.id === "pay-yuna");
        const selectedChild = Array.from(document.querySelectorAll('[data-testid="guardian-child-chip"]'))
          .find((element) => element.getAttribute("aria-pressed") === "true");

        return {
          payment: payment
            ? {
                collectionRequestStatus: payment.collectionRequest?.status ?? null,
                id: payment.id,
                memberId: payment.memberId,
                onlinePaymentStatus: payment.onlinePayment?.status ?? null,
                status: payment.status,
              }
            : null,
          selectedChild: selectedChild?.textContent?.replace(/\s+/g, " ").trim() ?? null,
        };
      });
      assert(
        beforeState.paymentTitles.some((title) => title.includes("한유나 납부 요청 접수")),
        `guardian notifications must show pending payment request copy: ${JSON.stringify({ paymentTitles: beforeState.paymentTitles, guardianPaymentDiagnostic })}`,
      );
      assert(
        beforeState.paymentActionLabels.includes("납부 확인 중"),
        `guardian pending payment action must use payment-confirmation copy: ${JSON.stringify(beforeState.paymentActionLabels)}`,
      );
    } else {
      assert(
        beforeState.paymentActionLabels.includes("납부 요청"),
        `${testCase.id} payable payment notification action must use request copy: ${JSON.stringify(beforeState.paymentActionLabels)}`,
      );
    }
    assert(
      beforeState.readActionWidths.every((width) => width <= 56),
      `${testCase.id} notifications must keep mobile read actions compact: ${JSON.stringify(beforeState.readActionWidths)}`,
    );
    assert.equal(beforeState.filterToolbarVisible, true, `${testCase.id} notifications must render a flat filter toolbar`);
    assert(beforeState.filterToolbarButtonCount >= 3, `${testCase.id} notifications must render filter buttons inside the toolbar`);
    assert.equal(
      beforeState.filterToolbarNestedFrameCount,
      0,
      `${testCase.id} notifications must not put filter controls inside a nested bordered card frame`,
    );
    assert(beforeState.filterToolbarHeight <= 112, `${testCase.id} notifications filter toolbar must stay compact: ${beforeState.filterToolbarHeight}`);
    assert(beforeState.filterToolbarOverflow <= 0, `${testCase.id} notifications filter toolbar must not overflow horizontally: ${beforeState.filterToolbarOverflow}`);
    assert.equal(beforeState.safeAreaCount, 0, `${testCase.id} notifications must not duplicate the shell mobile safe area`);
    assert.equal(beforeState.safeAreaHeight, 0, `${testCase.id} notifications must avoid a second bottom spacer`);
    assert.equal(beforeState.scrollWidth, beforeState.clientWidth, `${testCase.id} notifications must not overflow horizontally`);
    assert.equal(
      beforeState.undersizedVisibleTargets.length,
      0,
      `${testCase.id} notifications must keep visible filter/read targets at least 44px: ${JSON.stringify(beforeState.undersizedVisibleTargets)}`,
    );

    await page.getByTestId("family-push-enable-action").click();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="family-push-connection-row"]'),
      null,
      { timeout: 10000 },
    );
    await page.screenshot({ path: afterPushScreenshotPath, fullPage: true });
    const afterPushState = await collectInboxState(page);

    assert.equal(afterPushState.familyPushConnectionVisible, false, `${testCase.id} notifications must clear activation guidance after subscribing`);
    assert.equal(pushSubscriptionRequests.length, 1, `${testCase.id} notifications must persist one device push subscription`);
    assert.equal(
      pushSubscriptionRequests[0]?.subscription?.endpoint,
      "https://push.example.test/final-judo-device",
      `${testCase.id} notifications must persist the subscription returned by PushManager`,
    );
    assert.equal(
      pushSubscriptionRequests[0]?.allowReactivation,
      true,
      `${testCase.id} explicit notification activation must allow a security-disabled push credential to reconnect`,
    );
    assert.equal(afterPushState.scrollWidth, afterPushState.clientWidth, `${testCase.id} notifications must not overflow after push activation`);

    const readResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/v1\/me\/notices\/[^/]+\/read$/.test(new URL(response.url()).pathname),
      { timeout: 30_000 },
    );

    await page.locator('[data-testid="notification-read-action"]').first().click();
    const readResponse = await readResponsePromise;

    assert.equal(
      readResponse.ok(),
      true,
      `${testCase.id} notice read request must succeed: ${readResponse.status()} ${readResponse.statusText()}`,
    );
    await page.waitForFunction(
      (previousReadActionCount) =>
        document.querySelectorAll('[data-testid="notification-read-action"]').length === previousReadActionCount - 1 &&
        (document.querySelector('[data-testid="notification-read-feedback"]')?.textContent ?? "").includes("공지 확인을 저장했습니다."),
      beforeState.readActionCount,
      { timeout: 10000 },
    );
    await page.screenshot({ path: afterReadScreenshotPath, fullPage: true });
    const afterReadState = await collectInboxState(page);

    assert.equal(afterReadState.readFeedback, "공지 확인을 저장했습니다.", `${testCase.id} notifications must confirm single notice read`);
    assert.equal(
      afterReadState.readActionCount,
      beforeState.readActionCount - 1,
      `${testCase.id} notifications must remove exactly one read action after confirming a notice`,
    );
    assert(
      afterReadState.readCardCount >= beforeState.readCardCount + 1,
      `${testCase.id} notifications must tone down the read notice card after confirmation`,
    );
    assert.equal(afterReadState.deleteActionCount, 0, `${testCase.id} notifications must still not expose delete actions after reading`);
    assert(
      afterReadState.readActionWidths.every((width) => width <= 56),
      `${testCase.id} notifications must keep remaining mobile read actions compact after reading: ${JSON.stringify(afterReadState.readActionWidths)}`,
    );
    assert.equal(afterReadState.scrollWidth, afterReadState.clientWidth, `${testCase.id} notifications must not overflow horizontally after reading`);
    if (afterReadState.scrollHeight <= afterReadState.viewportHeight + 1 && afterReadState.lastCardIntersectsViewport) {
      assert(
        afterReadState.bottomCardClearance !== null && afterReadState.bottomCardClearance >= 40,
        `${testCase.id} visible bottom notification card must keep breathing room after read feedback: ${afterReadState.bottomCardClearance}`,
      );
    }
    if (afterReadState.scrollHeight <= afterReadState.viewportHeight + 1 && afterReadState.lastActionIntersectsViewport) {
      assert(
        afterReadState.bottomActionClearance !== null && afterReadState.bottomActionClearance >= 64,
        `${testCase.id} visible bottom notification action must keep breathing room after read feedback: ${afterReadState.bottomActionClearance}`,
      );
    }
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement?.scrollHeight ?? document.body.scrollHeight));
    await page.waitForTimeout(250);
    await page.screenshot({ path: scrollEndScreenshotPath, fullPage: false });
    const scrollEndState = await collectInboxState(page);

    assert(
      scrollEndState.bottomCardClearance !== null && scrollEndState.bottomCardClearance >= 24,
      `${testCase.id} bottom notification card must clear the mobile bottom navigation at scroll end: ${scrollEndState.bottomCardClearance}`,
    );
    assert(
      scrollEndState.bottomActionClearance !== null && scrollEndState.bottomActionClearance >= 24,
      `${testCase.id} bottom notification action must clear the mobile bottom navigation at scroll end: ${scrollEndState.bottomActionClearance}`,
    );
    assert(statSync(scrollEndScreenshotPath).size > 10_000, `${testCase.id} scroll-end screenshot must be non-empty`);
    assert(statSync(beforeScreenshotPath).size > 10_000, `${testCase.id} before screenshot must be non-empty`);
    assert(statSync(afterPushScreenshotPath).size > 10_000, `${testCase.id} after-push screenshot must be non-empty`);
    assert(statSync(afterReadScreenshotPath).size > 10_000, `${testCase.id} after-read screenshot must be non-empty`);

    return {
      id: testCase.id,
      role: testCase.role,
      beforeScreenshotPath,
      afterPushScreenshotPath,
      afterReadScreenshotPath,
      scrollEndScreenshotPath,
      beforeScreenshotSizeBytes: statSync(beforeScreenshotPath).size,
      afterPushScreenshotSizeBytes: statSync(afterPushScreenshotPath).size,
      afterReadScreenshotSizeBytes: statSync(afterReadScreenshotPath).size,
      scrollEndScreenshotSizeBytes: statSync(scrollEndScreenshotPath).size,
      messages,
      beforeState,
      afterPushState,
      afterReadState,
      allowReactivation: pushSubscriptionRequests[0]?.allowReactivation,
      pushSubscriptionRequestCount: pushSubscriptionRequests.length,
      pendingPaymentSeed,
      scrollEndState,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const executablePath = findChromeExecutable();
  const summaryPath = join(outDir, "summary.json");
  let appServer = null;
  let browser = null;
  let resetAfter = null;
  let resetBefore = null;

  assert(executablePath, "Chrome or Chromium is required for mobile notification inbox proof");
  baseUrl ||= `http://127.0.0.1:${await getFreePort()}`;
  mkdirSync(outDir, { recursive: true });

  try {
    appServer = await ensureLocalAppServer();
    resetBefore = await resetDevData("before");
    await prewarmLocalAppRoutes();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const appEntryPushOwnership = await verifyFamilyPushOwnershipAtAppEntry(browser);
    const cases = [];

    for (const testCase of familyCases) {
      cases.push(await verifyFamilyCase(browser, testCase));
    }

    resetAfter = await resetDevData("after");
    const summary = {
      ok: true,
      appServer,
      baseUrl,
      browserPath: "repository-managed Playwright mobile regression",
      resetBefore,
      resetAfter,
      appEntryPushOwnership,
      cases,
    };

    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (!resetAfter && appServer) {
      await resetDevData("after-failure").catch(() => null);
    }
    await browser?.close();
    await cleanupLocalAppServer();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
