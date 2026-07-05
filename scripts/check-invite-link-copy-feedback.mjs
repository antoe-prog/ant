import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.INVITE_LINK_COPY_OUT_DIR ?? ".data/mobile-builds/ios/invite-link-copy-feedback-20260705";
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
let activeBrowser = null;

function findChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate));
}

function assertLocalBaseUrl() {
  const { hostname, protocol } = new URL(baseUrl);

  assert(protocol === "http:", "invite link copy feedback check only runs against a local HTTP app server");
  assert(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname), "invite link copy feedback check only mutates local dev data");
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

  if (await canReachAppServer()) {
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
  const response = await fetch(`${baseUrl}/api/v1/dev/reset`, { method: "POST" });

  assert.equal(response.status, 200, `${label} dev reset must succeed`);
}

async function main() {
  const executablePath = findChromeExecutable();

  assert(executablePath, "Chrome/Chromium executable is required for invite link copy feedback check");
  mkdirSync(outDir, { recursive: true });
  await ensureLocalAppServer();
  await resetDevData("before");

  const browser = await chromium.launch({ executablePath, headless: true });
  activeBrowser = browser;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("clipboard blocked for evidence")),
      },
    });
  });

  await page.goto(`${baseUrl}/api/v1/dev/auto-login?role=admin&next=%2Fapp%2Fadmin%2Froles%3Finvite%3D1`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('[data-testid="admin-role-invite-toggle"]', { timeout: 15000 });
  await page.waitForSelector("#admin-role-invite-form", { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="admin-role-invite-toggle"]')?.getAttribute("aria-expanded") === "true");
  await page.locator('#admin-role-invite-form input[placeholder="이름"]').fill("초대복사확인");
  await page.locator('#admin-role-invite-form input[placeholder="휴대폰 번호"]').fill("01077889900");
  await page.locator('#admin-role-invite-form input[type="checkbox"]').first().check();
  await page.locator('#admin-role-invite-form button[type="submit"]').click();
  await page.waitForSelector('[data-testid="admin-role-invite-link-actions"]', { timeout: 15000 });
  await page.getByTestId("admin-role-invite-link-copy").click();
  await page.waitForFunction(() => document.body.textContent?.includes("복사를 완료하지 못했습니다. 링크 열기로 확인해 주세요."));

  const screenshotPath = join(outDir, "admin-role-invite-copy-fallback-mobile.png");
  await page.screenshot({ path: screenshotPath, fullPage: false, caret: "initial" });

  const layout = await page.evaluate(() => {
    const readRect = (selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();

      return rect
        ? {
            height: Math.round(rect.height),
            width: Math.round(rect.width),
          }
        : null;
    };

    return {
      feedbackText: document.body.textContent?.includes("복사를 완료하지 못했습니다. 링크 열기로 확인해 주세요.")
        ? "복사를 완료하지 못했습니다. 링크 열기로 확인해 주세요."
        : "",
      hasOldAddressCopy: document.body.textContent?.includes("주소를 복사") ?? false,
      inviteOpenAction: readRect('[data-testid="admin-role-invite-link-open"]'),
      inviteCopyAction: readRect('[data-testid="admin-role-invite-link-copy"]'),
      inviteFormControlMinHeight: Math.min(
        ...Array.from(document.querySelectorAll('#admin-role-invite-form input:not([type="checkbox"]), #admin-role-invite-form select, #admin-role-invite-form button'))
          .map((element) => Math.round(element.getBoundingClientRect().height))
          .filter((height) => height > 0),
      ),
      inviteBranchLabelMinHeight: Math.min(
        ...Array.from(document.querySelectorAll("#admin-role-invite-form fieldset label"))
          .map((element) => Math.round(element.getBoundingClientRect().height))
          .filter((height) => height > 0),
      ),
      inviteQueryOpen: new URL(window.location.href).searchParams.get("invite") === "1",
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });

  assert.equal(layout.feedbackText, "복사를 완료하지 못했습니다. 링크 열기로 확인해 주세요.");
  assert.equal(layout.hasOldAddressCopy, false, "invite copy fallback must not mention address copying");
  assert(layout.inviteOpenAction?.height >= 44, "invite link open action must keep 44px touch height");
  assert(layout.inviteCopyAction?.height >= 44, "invite link copy action must keep 44px touch height");
  assert(layout.inviteFormControlMinHeight >= 44, "admin role invite form controls must keep 44px touch height");
  assert(layout.inviteBranchLabelMinHeight >= 44, "admin role invite branch labels must keep 44px touch height");
  assert.equal(layout.inviteQueryOpen, true, "admin role invite form must open from invite=1 query");
  assert.equal(layout.overflowX, 0, "admin role invite copy fallback screen must not overflow horizontally");
  assert(statSync(screenshotPath).size > 10_000, "invite copy fallback screenshot must be non-empty");

  await browser.close();
  activeBrowser = null;
  await resetDevData("after");

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    baseUrl,
    viewport: { width: 390, height: 844 },
    browserPath: "playwright-chrome",
    screenshotPath,
    layout,
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
