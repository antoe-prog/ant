import assert from "node:assert/strict";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { resetOwnedSmokeServer } from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.GUARDIAN_AGE_POLICY_OUT_DIR ?? ".data/mobile-builds/ios/guardian-age-policy-ui-20260701";
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

async function resetDevData(label) {
  if (!canResetDevData()) {
    return { attempted: false, label, reason: "non-local-base-url" };
  }

  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `guardian age policy ${label} reset`,
  });
  const bodyText = await response.text();
  const body = JSON.parse(bodyText);
  const resetData = body?.data ?? body;

  assert(response.ok, `guardian age policy ${label} reset failed with ${response.status}: ${bodyText}`);
  assert.equal(resetData?.ok, true, `guardian age policy ${label} reset must return ok=true`);

  return {
    attempted: true,
    label,
    ok: true,
    status: response.status,
    counts: resetData.counts ?? null,
  };
}

function screenshotSize(path) {
  return statSync(path).size;
}

async function gotoApp(page, role, next) {
  const loginUrl = new URL("/login", baseUrl);
  const expectedOrigin = loginUrl.origin;
  loginUrl.searchParams.set("next", next);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);

  await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => url.origin === expectedOrigin && url.pathname === next, { timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 });
}

mkdirSync(outDir, { recursive: true });

const chromeExecutable = findChromeExecutable();
assert(chromeExecutable, "Chrome or Chromium executable is required for guardian age policy UI proof");

const resetBefore = await resetDevData("before");
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const messages = [];

page.setDefaultTimeout(15_000);
page.setDefaultNavigationTimeout(15_000);

page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    const text = message.text();

    if (message.type() === "warning" && text.includes("[Fast Refresh] performing full reload")) {
      return;
    }

    messages.push(`${message.type()}: ${text}`);
  }
});

try {
	  await gotoApp(page, "owner", "/app/members");
	  await page.getByTestId("member-search-input").fill("오지호");
	  await page.waitForSelector('[data-member-id="member-jiho"]', { timeout: 10000 });
	  const memberSearchClearBox = await page.getByTestId("member-search-clear").boundingBox();
	  assert(memberSearchClearBox, "member search clear control must be visible after typing");
	  assert(
	    memberSearchClearBox.height >= 44 && memberSearchClearBox.width >= 44,
	    `member search clear control must keep a 44px touch target, got ${memberSearchClearBox.width}x${memberSearchClearBox.height}`,
	  );

	  const adultMemberCard = page.locator('[data-member-id="member-jiho"]');
  // 관리자 카드가 요약 상태로 접혀 있으므로 상세를 먼저 펼친다.
  await page.getByTestId("member-detail-toggle-member-jiho").click();
  const ineligibleCopy = page.getByTestId("member-guardian-ineligible-member-jiho");
  const adultGuardianSearchCount = await adultMemberCard.getByTestId("member-guardian-search-input-member-jiho").count();
  const memberScreenshotPath = join(outDir, "owner-member-adult-guardian-ineligible.png");

  await expectVisible(ineligibleCopy, "adult member ineligible copy must be visible");
  assert.equal(adultGuardianSearchCount, 0, "adult member card must not render guardian search input");
  await ineligibleCopy.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({ path: memberScreenshotPath, fullPage: false });

  await gotoApp(page, "admin", "/app/admin/users");
  await page.locator("#admin-user-search").fill("이하린");
  await page.getByTestId("admin-user-edit-toggle-user-guardian").click();
  await page.waitForSelector('[data-testid="admin-user-guardian-child-search-input-user-guardian"]', { timeout: 10000 });
  await page.getByTestId("admin-user-guardian-child-search-input-user-guardian").fill("오지호");
  await page.waitForSelector('[data-testid="admin-user-guardian-child-results-user-guardian"]', { timeout: 10000 });

  const adultResultCount = await page.getByTestId("admin-user-guardian-child-result-user-guardian").count();
  const adultEmptyText = await page.getByText("검색 결과가 없습니다.").count();
  const adminAdultScreenshotPath = join(outDir, "admin-user-guardian-adult-search-empty.png");

  assert.equal(adultResultCount, 0, "admin guardian-child search must not return adult members");
  assert(adultEmptyText > 0, "admin guardian-child adult search must show an empty state");
  await page.getByTestId("admin-user-guardian-child-results-user-guardian").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({ path: adminAdultScreenshotPath, fullPage: false });

  await page.getByTestId("admin-user-guardian-child-search-input-user-guardian").fill("이준");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-user-guardian-child-result-user-guardian"]').length > 0);

  const youthResultText = await page.getByTestId("admin-user-guardian-child-results-user-guardian").innerText();
  const adminYouthScreenshotPath = join(outDir, "admin-user-guardian-youth-search-result.png");

  assert.match(youthResultText, /이준/, "admin guardian-child search must still return youth members");
  assert.doesNotMatch(youthResultText, /오지호/, "admin guardian-child youth search must not leak adult member result");
  await page.getByTestId("admin-user-guardian-child-results-user-guardian").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({ path: adminYouthScreenshotPath, fullPage: false });

  const report = {
    ok: true,
    baseUrl,
    browserAvailability: "Browser MCP unavailable; Playwright fallback used",
    viewport: "390x844",
    checked: [
	      "owner member screen hides guardian search for adult members",
	      "owner member screen explains adult members are not guardian-link targets",
	      "owner member search clear control keeps a 44px touch target",
	      "admin guardian-child search excludes adult members",
      "admin guardian-child search still returns youth members",
      "screens stay nonblank and console-clean for the checked flow",
    ],
    consoleMessages: messages,
    screenshots: {
      memberAdultIneligible: {
        path: memberScreenshotPath,
        sizeBytes: screenshotSize(memberScreenshotPath),
      },
      adminAdultSearchEmpty: {
        path: adminAdultScreenshotPath,
        sizeBytes: screenshotSize(adminAdultScreenshotPath),
      },
      adminYouthSearchResult: {
        path: adminYouthScreenshotPath,
        sizeBytes: screenshotSize(adminYouthScreenshotPath),
      },
    },
    resetBefore,
    resetAfter: await resetDevData("after"),
  };

  assert.deepEqual(messages, [], "guardian age policy UI flow must not emit console warnings/errors");
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

async function expectVisible(locator, message) {
  await locator.waitFor({ state: "visible", timeout: 10000 });
  assert(await locator.isVisible(), message);
}
