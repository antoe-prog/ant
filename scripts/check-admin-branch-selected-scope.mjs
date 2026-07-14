import assert from "node:assert/strict";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { resetOwnedSmokeServer } from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.ADMIN_BRANCH_SELECTED_SCOPE_OUT_DIR ?? ".data/mobile-builds/ios/admin-branch-selected-scope-20260701";
const selectedBranchId = process.env.ADMIN_BRANCH_SELECTED_SCOPE_BRANCH_ID ?? "branch-gangnam";
const chromeCandidates = [
  process.env.E2E_CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate));
}

function canResetDevData() {
  const { hostname, protocol } = new URL(baseUrl);

  return protocol === "http:" && ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname);
}

async function resetDevData() {
  if (!canResetDevData()) {
    return {
      attempted: false,
      reason: "non-local-base-url",
    };
  }

  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: "admin branch selected-scope dev reset",
  });
  const payload = await response.json().catch(() => ({}));

  return {
    attempted: true,
    ok: response.ok,
    status: response.status,
    counts: payload?.data?.counts ?? null,
  };
}

async function main() {
  const executablePath = findChromeExecutable();

  assert(executablePath, "Chrome or Chromium is required for admin branch selected-scope proof");
  mkdirSync(outDir, { recursive: true });

  const resetBefore = await resetDevData();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await context.addInitScript(
    ({ branchId }) => {
      window.localStorage.setItem("final-judo-mvp-session", JSON.stringify({ userId: "user-admin", selectedBranchId: branchId }));
    },
    { branchId: selectedBranchId },
  );
  const page = await context.newPage();
  const screenshotPath = join(outDir, "admin-branches-selected-scope-browser.png");
  const summaryPath = join(outDir, "summary.json");
  const messages = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      messages.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });

  try {
    const loginUrl = new URL("/login", baseUrl);
    loginUrl.searchParams.set("autoLogin", "1");
    loginUrl.searchParams.set("role", "admin");
    loginUrl.searchParams.set("next", "/app/admin/branches");
    await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="admin-branch-summary-grid"]', { timeout: 10000 });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const state = await page.evaluate(() => {
      const branchCards = Array.from(document.querySelectorAll('[data-testid="admin-branch-card"]'));
      const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

      return {
        title: text("main h1"),
        summaryText: text('[data-testid="admin-branch-summary-grid"]'),
        branchCardCount: branchCards.length,
        branchCardText: branchCards.map((card) => card.textContent?.replace(/\s+/g, " ").trim() ?? "").join(" | "),
        createPanelCount: document.querySelectorAll('[data-testid="admin-branch-create-panel"]').length,
        createToggleCount: document.querySelectorAll('[data-testid="admin-branch-create-toggle"]').length,
        ownerToggleCount: document.querySelectorAll('[data-testid="admin-branch-owner-toggle"]').length,
        settingsToggleCount: document.querySelectorAll('[data-testid="admin-branch-settings-toggle"]').length,
        summaryTotalText: text('[data-testid="admin-branch-summary-total"]'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    const screenshotSizeBytes = statSync(screenshotPath).size;
    const summary = {
      ok: true,
      baseUrl,
      selectedBranchId,
      resetBefore,
      screenshotPath,
      screenshotSizeBytes,
      messages,
      state,
    };

    assert.equal(messages.length, 0, `admin selected branch scope must not log console/page errors: ${messages.join(" | ")}`);
    assert(screenshotSizeBytes > 10_000, `admin selected branch screenshot must be non-empty, got ${screenshotSizeBytes} bytes`);
    assert.equal(state.scrollWidth, state.clientWidth, "admin selected branch scope must not overflow horizontally");
    assert.equal(state.title, "선택 지점 관리", "admin selected branch scope must show selected-scope title");
    assert(state.summaryTotalText.includes("선택"), "admin selected branch summary must label the total as selected scope");
    assert.equal(state.branchCardCount, 1, "admin selected branch scope must render only one branch card");
    assert(state.branchCardText.includes("강남 본관"), "admin selected branch scope must render the selected branch");
    assert(!state.branchCardText.includes("송파 도장"), "admin selected branch scope must hide non-selected branches");
    assert.equal(state.createPanelCount, 0, "admin selected branch scope must hide branch creation controls");
    assert.equal(state.createToggleCount, 0, "admin selected branch scope must hide the branch creation toggle");
    assert.equal(state.ownerToggleCount, 1, "admin selected branch scope must keep selected branch owner action");
    assert.equal(state.settingsToggleCount, 1, "admin selected branch scope must keep selected branch settings action");

    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
