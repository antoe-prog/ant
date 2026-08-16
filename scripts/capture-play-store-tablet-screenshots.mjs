import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { createMockData } from "../src/lib/mock-data.ts";
import {
  demoAccessPhones,
} from "../src/server/demo-access-identity.ts";
import { provisionGooglePlayReviewAccess } from "../src/server/google-play-review-provisioning.ts";

const appStoreCapturePasswords = {
  admin: "FJ-AppStore-admin-capture",
  coach: "FJ-AppStore-coach-capture",
  guardian: "FJ-AppStore-guardian-capture",
  member: "FJ-AppStore-member-capture",
  owner: "FJ-AppStore-owner-capture",
};

const captureProfiles = {
  phone: {
    label: "phone",
    outputDirectory: "mobile/android/play-store/phone",
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
    dimensions: { width: 1080, height: 1920 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36",
  },
  tablet: {
    label: "tablet",
    outputDirectory: "mobile/android/play-store/tablet-10-inch",
    viewport: { width: 720, height: 1280 },
    deviceScaleFactor: 1.5,
    dimensions: { width: 1080, height: 1920 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  },
  ipad13: {
    label: "ipad13",
    outputDirectory: "mobile/ios/app-store/ipad-13-inch",
    viewport: { width: 1032, height: 1376 },
    deviceScaleFactor: 2,
    dimensions: { width: 2064, height: 2752 },
    expectedMobileNavigationCount: null,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  iphone65: {
    label: "iphone65",
    outputDirectory: "mobile/ios/app-store/iphone-6.5-inch",
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 3,
    dimensions: { width: 1242, height: 2688 },
    expectedMobileNavigationCount: null,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
};
const profileArgument = process.argv.find((argument) => argument.startsWith("--profile="));
const profileId = profileArgument?.slice("--profile=".length) || "tablet";
const captureProfile = captureProfiles[profileId];
const isAppStoreProfile = profileId === "ipad13" || profileId === "iphone65";

assert(captureProfile, `unknown screenshot profile: ${profileId}`);

const outputDirectory = path.resolve(captureProfile.outputDirectory);
const dataDirectory = path.resolve(`.data/play-store-${profileId}-screenshots-${process.pid}`);
const chromeCandidates = [
  process.env.E2E_CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const screenshots = [
  {
    fileName: "01-member-home.png",
    role: "member",
    route: "/app/dashboard",
    label: "회원 홈",
  },
  {
    fileName: "02-member-classes.png",
    role: "member",
    route: "/app/classes",
    label: "회원 수업 달력",
  },
  {
    fileName: "03-guardian-home.png",
    role: "guardian",
    route: "/app/dashboard",
    label: "학부모 홈",
  },
  {
    fileName: "04-guardian-payments.png",
    role: "guardian",
    route: "/app/payments",
    label: "학부모 결제",
  },
  {
    fileName: "05-guardian-notifications.png",
    role: "guardian",
    route: "/app/notifications",
    label: "학부모 알림",
  },
];

let appServer = null;
let browser = null;

function findChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      assert(address && typeof address === "object", "failed to allocate a local screenshot port");
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl, serverErrors, timeoutMs = 90_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });

      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // The dev server is still starting.
    }

    if (appServer?.exitCode !== null) {
      throw new Error(`screenshot server exited before startup\n${serverErrors()}`);
    }

    await sleep(500);
  }

  throw new Error(`timed out waiting for the screenshot server\n${serverErrors()}`);
}

async function stopServer() {
  if (!appServer || appServer.exitCode !== null) {
    return;
  }

  const closed = new Promise((resolve) => appServer.once("close", resolve));

  appServer.kill("SIGINT");
  await Promise.race([
    closed,
    sleep(5_000).then(() => {
      if (appServer?.exitCode === null) {
        appServer.kill("SIGTERM");
      }
    }),
  ]);
}

function isIgnorableConsoleMessage(message) {
  const text = message.text();

  return (
    (message.type() === "warning" && text.includes("[Fast Refresh]")) ||
    text.includes("Download the React DevTools")
  );
}

async function waitForAppScreen(page, route) {
  await page.waitForURL((url) => url.pathname === route, { timeout: 90_000, waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor({ state: "visible", timeout: 90_000 });
  if (captureProfile.expectedMobileNavigationCount !== null) {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="mobile-bottom-navigation"] [data-mobile-route-id]').length >= 5,
      undefined,
      { timeout: 30_000 },
    );
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(1_000);
}

async function createCaptureContext() {
  return browser.newContext({
    viewport: captureProfile.viewport,
    deviceScaleFactor: captureProfile.deviceScaleFactor,
    hasTouch: true,
    isMobile: true,
    locale: "ko-KR",
    colorScheme: "light",
    userAgent: captureProfile.userAgent,
  });
}

async function captureScreenshot(baseUrl, screenshot, context, hasSession) {
  const page = await context.newPage();
  const consoleMessages = [];

  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type()) || isIgnorableConsoleMessage(message)) {
      return;
    }

    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    consoleMessages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });

  const targetUrl = new URL(hasSession || isAppStoreProfile ? screenshot.route : "/login", baseUrl);

  if (!hasSession && isAppStoreProfile) {
    await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
    const loginResult = await page.evaluate(async ({ password, phone }) => {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keepSignedIn: true, password, phone }),
      });
      return { ok: response.ok, status: response.status };
    }, {
      password: appStoreCapturePasswords[screenshot.role],
      phone: demoAccessPhones[screenshot.role],
    });
    assert.equal(loginResult.ok, true, `${screenshot.role} App Store capture account must log in (${loginResult.status})`);
  } else if (!hasSession) {
    targetUrl.searchParams.set("role", screenshot.role);
    targetUrl.searchParams.set("autoLogin", "1");
    targetUrl.searchParams.set("next", screenshot.route);
  }
  await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForAppScreen(page, screenshot.route);

  const layout = await page.evaluate(() => ({
    bodyText: document.body.innerText.trim(),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mobileNavigationCount: document.querySelectorAll(
      '[data-testid="mobile-bottom-navigation"] [data-mobile-route-id]',
    ).length,
    hasFrameworkOverlay:
      document.body.innerText.includes("Unhandled Runtime Error") ||
      document.body.innerText.includes("Application error") ||
      document.body.innerText.includes("Build Error"),
  }));

  assert(layout.bodyText.length > 100, `${screenshot.label} must render meaningful app content`);
  assert(!layout.bodyText.includes("파이널 로그인"), `${screenshot.label} must not capture the login screen`);
  assert(!layout.hasFrameworkOverlay, `${screenshot.label} must not show a framework error overlay`);
  if (captureProfile.expectedMobileNavigationCount !== null) {
    assert.equal(
      layout.mobileNavigationCount,
      captureProfile.expectedMobileNavigationCount ?? 5,
      `${screenshot.label} must show the complete mobile navigation`,
    );
  }
  assert(
    layout.scrollWidth <= layout.clientWidth + 1,
    `${screenshot.label} has horizontal overflow: ${layout.scrollWidth}px > ${layout.clientWidth}px`,
  );
  assert.deepEqual(consoleMessages, [], `${screenshot.label} emitted browser errors:\n${consoleMessages.join("\n")}`);

  const screenshotPath = path.join(outputDirectory, screenshot.fileName);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: screenshotPath,
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    type: "png",
  });
  await page.close();

  const metadata = await sharp(screenshotPath).metadata();
  const fileStats = await stat(screenshotPath);

  assert.equal(metadata.format, "png", `${screenshot.fileName} must be a PNG`);
  assert.equal(metadata.width, captureProfile.dimensions.width, `${screenshot.fileName} has an invalid width`);
  assert.equal(metadata.height, captureProfile.dimensions.height, `${screenshot.fileName} has an invalid height`);
  assert(fileStats.size <= 8 * 1024 * 1024, `${screenshot.fileName} must be 8MB or smaller`);

  return {
    file: screenshot.fileName,
    label: screenshot.label,
    role: screenshot.role,
    route: screenshot.route,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: fileStats.size,
    horizontalOverflow: layout.scrollWidth - layout.clientWidth,
    consoleErrors: consoleMessages,
  };
}

async function createContactSheet(results) {
  const columns = 3;
  const gap = 16;
  const padding = 16;
  const thumbnailWidth = 300;
  const thumbnailHeight = Math.round(
    captureProfile.dimensions.height * (thumbnailWidth / captureProfile.dimensions.width),
  );
  const rows = Math.ceil(results.length / columns);
  const width = padding * 2 + columns * thumbnailWidth + (columns - 1) * gap;
  const height = padding * 2 + rows * thumbnailHeight + (rows - 1) * gap;
  const composite = [];

  for (const [index, result] of results.entries()) {
    composite.push({
      input: await sharp(path.join(outputDirectory, result.file))
        .resize({ width: thumbnailWidth, height: thumbnailHeight, fit: "fill" })
        .png()
        .toBuffer(),
      left: padding + (index % columns) * (thumbnailWidth + gap),
      top: padding + Math.floor(index / columns) * (thumbnailHeight + gap),
    });
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#f4f4f5",
    },
  })
    .composite(composite)
    .png()
    .toFile(path.join(outputDirectory, "contact-sheet.png"));
}

async function main() {
  const executablePath = findChromeExecutable();

  assert(executablePath, `Chrome or Chromium is required to capture Play Store ${captureProfile.label} screenshots`);
  await rm(dataDirectory, { force: true, recursive: true });
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  if (isAppStoreProfile) {
    const db = provisionGooglePlayReviewAccess(
      createMockData(),
      appStoreCapturePasswords,
      new Date("2026-08-17T00:00:00+09:00"),
    );
    await writeFile(path.join(dataDirectory, "final-judo-db.json"), `${JSON.stringify(db, null, 2)}\n`, "utf8");
  }

  for (const file of await readdir(outputDirectory)) {
    if (/^\d{2}-.*\.png$/.test(file) || file === "contact-sheet.png" || file === "manifest.json") {
      await rm(path.join(outputDirectory, file), { force: true });
    }
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverErrors = "";

  appServer = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FINAL_JUDO_DATA_DIR: dataDirectory,
        FINAL_JUDO_ENABLE_DEMO_LOGIN: isAppStoreProfile ? "0" : "1",
        FINAL_JUDO_ENABLE_DEV_RESET: "0",
        FINAL_JUDO_ROLL_DEMO_DATES: isAppStoreProfile ? "0" : "1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  appServer.stderr.on("data", (chunk) => {
    serverErrors += chunk.toString();
  });
  await waitForServer(baseUrl, () => serverErrors);

  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const results = [];
  let activeRole = null;
  let activeContext = null;
  let activeContextHasSession = false;

  for (const screenshot of screenshots) {
    if (activeRole !== screenshot.role) {
      if (activeContext) {
        await activeContext.close();
      }

      activeRole = screenshot.role;
      activeContext = await createCaptureContext();
      activeContextHasSession = false;
    }

    results.push(await captureScreenshot(baseUrl, screenshot, activeContext, activeContextHasSession));
    activeContextHasSession = true;
  }

  if (activeContext) {
    await activeContext.close();
  }

  const storeRequirements =
    isAppStoreProfile
      ? {
          appStoreRequirements: {
            maxCount: 10,
            maxFileSizeBytes: 8 * 1024 * 1024,
            orientation: profileId === "ipad13" ? "portrait 3:4" : "portrait",
            dimensions: `${captureProfile.dimensions.width}x${captureProfile.dimensions.height}`,
          },
        }
      : {
          googlePlayRequirements: {
            maxCount: 8,
            maxFileSizeBytes: 8 * 1024 * 1024,
            orientation: "portrait 9:16",
            dimensions: `${captureProfile.dimensions.width}x${captureProfile.dimensions.height}`,
          },
        };
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: isAppStoreProfile
      ? "isolated fixed demo tenant using ordinary role authentication"
      : "isolated local demo data",
    profile: profileId,
    ...storeRequirements,
    screenshots: results,
  };

  await createContactSheet(results);
  await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Created ${results.length} Play Store ${captureProfile.label} screenshots in ${outputDirectory}`);
  for (const result of results) {
    console.log(`${result.file}: ${result.width}x${result.height}, ${result.sizeBytes} bytes`);
  }
}

try {
  await main();
} finally {
  if (browser) {
    await browser.close();
  }
  await stopServer();
  await rm(dataDirectory, { force: true, recursive: true });
}
