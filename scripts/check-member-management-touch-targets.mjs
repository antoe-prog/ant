import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir =
  process.env.MEMBER_MANAGEMENT_TOUCH_TARGETS_OUT_DIR ??
  ".data/mobile-builds/ios/member-management-touch-targets-20260705";
const iosSummaryPath = join(outDir, "ios-sim-summary.json");
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
      throw new Error(`Managed member management app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed member management app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "member management touch-target check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "member management touch-target check",
  });

  if (await canReachAppServer()) {
    usingExistingAppServer = true;
    return;
  }

  const appUrl = new URL(baseUrl);
  const appPort = appUrl.port || "3000";
  const serverMode = process.env.MEMBER_MANAGEMENT_TOUCH_TARGETS_SERVER_MODE === "start" ? "start" : "dev";
  const serverArgs =
    serverMode === "start"
      ? ["run", "start", "--", "--hostname", appUrl.hostname, "--port", appPort]
      : ["run", "dev", "--", "--webpack", "--hostname", appUrl.hostname, "--port", appPort];
  managedAppServer = spawn(
    npmCommand,
    serverArgs,
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  managedAppServer.stdout?.on("data", (chunk) => {
    if (process.env.MEMBER_MANAGEMENT_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stdout.write(`[member-management-touch-targets server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.MEMBER_MANAGEMENT_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stderr.write(`[member-management-touch-targets server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "member management touch-target check only mutates local dev data");
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `member management touch-target ${label} reset`,
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `member management touch-target ${label} reset failed with ${response.status}`);

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

function cleanOutputDir() {
  if (!existsSync(outDir)) {
    return [];
  }

  const removed = [];

  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const shouldRemove = (entry.name.endsWith(".png") && !entry.name.includes("-ios-sim")) || entry.name === "summary.json";

    if (!shouldRemove) {
      continue;
    }

    unlinkSync(join(outDir, entry.name));
    removed.push(entry.name);
  }

  return removed.sort();
}

function assertStaticContracts() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const releaseRunner = readFileSync("scripts/run-release-checks.mjs", "utf8");
  const membersScreen = readFileSync("src/components/screens/members-screen.tsx", "utf8");

  assert.equal(
    packageJson.scripts?.["test:member-management-touch-targets"],
    "node scripts/check-member-management-touch-targets.mjs",
    "package.json must expose test:member-management-touch-targets",
  );
  assert(
    releaseRunner.includes('["run", "test:member-management-touch-targets"]'),
    "test:release must include member management touch-target proof",
  );

  for (const snippet of [
    'data-testid="member-invite-field"',
    'data-testid="member-invite-submit"',
    'data-testid="member-create-field"',
    'data-testid="member-create-submit"',
    'data-testid="member-status-select"',
    'data-touch-target="member-profile-field"',
    'data-testid="member-note-field"',
    'data-testid="member-note-submit"',
    'data-testid={`member-guardian-search-input-${member.id}`}',
    'data-testid={`member-guardian-submit-${member.id}`}',
    'data-testid={`member-payment-summary-${member.id}`}',
    'data-testid={`member-payment-summary-link-${member.id}`}',
  ]) {
    assert(membersScreen.includes(snippet), `members screen must include ${snippet}`);
  }

  for (const forbidden of [
    'className="h-10 w-full',
    'className="inline-flex h-10',
    'className="inline-flex min-h-10',
  ]) {
    assert(!membersScreen.includes(forbidden), `members screen must not keep 40px controls: ${forbidden}`);
  }
}

async function gotoOwnerMembers(page) {
  const next = "/app/members";
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", "owner");
  loginUrl.searchParams.set("next", next);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === next, { timeout: 15000 });
  await page.waitForSelector('[data-testid="member-create-toggle"]', { timeout: 15000 });
}

async function gotoMembersAsRole(page, role) {
  const next = "/app/members";
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);
  loginUrl.searchParams.set("next", next);

  await page.goto(loginUrl.toString(), { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.pathname === next, { timeout: 15000 });
  await page.waitForSelector("[data-member-id]", { timeout: 15000 });
}

async function readHeights(page, selector) {
  return page.evaluate((targetSelector) => {
    return Array.from(document.querySelectorAll(targetSelector)).map((element) =>
      Math.round(element.getBoundingClientRect().height),
    );
  }, selector);
}

function assertHeightsAtLeast(label, heights, min = 44) {
  assert(heights.length > 0, `${label} must render at least one measurable control`);

  for (const [index, height] of heights.entries()) {
    assert(height >= min, `${label} ${index + 1} must stay ${min}px tall; got ${height}px`);
  }
}

async function collectPageHealth(page) {
  return page.evaluate(() => {
    const frameworkOverlayCount =
      document.querySelectorAll("[data-nextjs-dialog]").length +
      Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0)
        .length;

    return {
      bodyTextLength: document.body?.innerText.length ?? 0,
      clientWidth: document.documentElement.clientWidth,
      frameworkOverlayCount,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

function minMeasuredHeight(groups) {
  return Math.min(...Object.values(groups).flat().filter((height) => Number.isFinite(height)));
}

function readIosSimulatorProof() {
  if (!existsSync(iosSummaryPath)) {
    return {
      ok: false,
      reason: "ios-sim-summary-missing",
      path: iosSummaryPath,
    };
  }

  const parsed = JSON.parse(readFileSync(iosSummaryPath, "utf8"));

  return {
    ok: parsed.ok === true && parsed.noBrowserChrome === true,
    ...parsed,
  };
}

async function captureOwnerMembers(context) {
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const collapsedScreenshotPath = join(outDir, "owner-members-management-collapsed-mobile.png");
  const openScreenshotPath = join(outDir, "owner-members-management-open-mobile.png");

  try {
    await gotoOwnerMembers(page);

    const collapsedLayout = {
      createFormCount: await page.locator("#member-create-form").count(),
      createToggleHeights: await readHeights(page, '[data-testid="member-create-toggle"]'),
      health: await collectPageHealth(page),
      inviteFormCount: await page.locator("#member-invite-form").count(),
      inviteToggleHeights: await readHeights(page, '[data-testid="member-invite-toggle"]'),
    };

    assert.equal(collapsedLayout.health.frameworkOverlayCount, 0, "owner members must not show a framework overlay");
    assert(collapsedLayout.health.bodyTextLength > 100, "owner members must not render a blank page");
    assert.equal(collapsedLayout.health.horizontalOverflow, 0, "owner members must not overflow horizontally");
    assert.equal(collapsedLayout.inviteFormCount, 0, "member invite form must stay collapsed by default");
    assert.equal(collapsedLayout.createFormCount, 0, "member create form must stay collapsed by default");
    assertHeightsAtLeast("member invite toggle", collapsedLayout.inviteToggleHeights);
    assertHeightsAtLeast("member create toggle", collapsedLayout.createToggleHeights);
    await page.screenshot({ fullPage: false, path: collapsedScreenshotPath });

    await page.getByTestId("member-invite-toggle").click();
    await page.waitForSelector("#member-invite-form", { timeout: 15000 });
    await page.getByTestId("member-create-toggle").click();
    await page.waitForSelector("#member-create-form", { timeout: 15000 });

    // 회원 상세는 오버레이 다이얼로그로 한 번에 하나씩 열린다.
    // 보호자 검색 입력이 있는 카드를 찾을 때까지 순서대로 열어 본다.
    const detailToggles = page.locator('[data-testid^="member-detail-toggle-"]');
    const detailToggleCount = await detailToggles.count();
    let guardianDialogFound = false;
    for (let index = 0; index < detailToggleCount && !guardianDialogFound; index += 1) {
      await detailToggles.nth(index).click();
      await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
      guardianDialogFound =
        (await page.locator('[data-testid^="member-guardian-search-input-"]').count()) > 0;
      if (!guardianDialogFound) {
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0, { timeout: 15000 });
      }
    }
    assert(guardianDialogFound, "at least one member detail dialog must expose a guardian search input");

    const firstGuardianSearch = page.locator('[data-testid^="member-guardian-search-input-"]').first();
    await firstGuardianSearch.waitFor({ state: "visible", timeout: 15000 });
    await firstGuardianSearch.fill("010");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="member-guardian-search-result-"]').length > 0, {
      timeout: 15000,
    });
    await page.locator('[data-testid^="member-guardian-search-result-"]').first().click();

    const firstNoteToggle = page.locator('[data-testid^="member-note-editor-toggle-"]').first();
    await firstNoteToggle.waitFor({ state: "visible", timeout: 15000 });
    await firstNoteToggle.click();
    await page.waitForSelector('[data-testid="member-note-field"]', { timeout: 15000 });

    const openControlHeights = {
      createFields: await readHeights(page, '[data-testid="member-create-field"]'),
      createSubmit: await readHeights(page, '[data-testid="member-create-submit"]'),
      guardianSearchInputs: await readHeights(page, '[data-testid^="member-guardian-search-input-"]'),
      guardianSelected: await readHeights(page, '[data-testid^="member-guardian-selected-"]'),
      guardianSubmit: await readHeights(page, '[data-testid^="member-guardian-submit-"]'),
      inviteFields: await readHeights(page, '[data-testid="member-invite-field"]'),
      inviteSubmit: await readHeights(page, '[data-testid="member-invite-submit"]'),
      noteFields: await readHeights(page, '[data-testid="member-note-field"]'),
      noteSubmit: await readHeights(page, '[data-testid="member-note-submit"]'),
      profileFields: await readHeights(page, '[data-touch-target="member-profile-field"]'),
      statusSelects: await readHeights(page, '[data-testid="member-status-select"]'),
    };
    const openHealth = await collectPageHealth(page);

    assert.equal(openHealth.frameworkOverlayCount, 0, "owner members opened forms must not show a framework overlay");
    assert(openHealth.bodyTextLength > 100, "owner members opened forms must not render a blank page");
    assert.equal(openHealth.horizontalOverflow, 0, "owner members opened forms must not overflow horizontally");
    for (const [label, heights] of Object.entries(openControlHeights)) {
      assertHeightsAtLeast(`member management ${label}`, heights);
    }
    await page.screenshot({ fullPage: false, path: openScreenshotPath });

    assert.deepEqual(messages, [], "member management touch-target flow must not emit console warnings/errors");

    return {
      collapsedLayout,
      messages,
      openControlHeights,
      openHealth,
      screenshots: [
        { label: "owner members collapsed", path: collapsedScreenshotPath, sizeBytes: statSync(collapsedScreenshotPath).size },
        { label: "owner members open", path: openScreenshotPath, sizeBytes: statSync(openScreenshotPath).size },
      ],
    };
  } finally {
    await page.close();
  }
}

async function openOwnerPaymentSummary(page) {
  const detailToggles = page.locator('[data-testid^="member-detail-toggle-"]');
  const detailToggleCount = await detailToggles.count();

  for (let index = 0; index < detailToggleCount; index += 1) {
    await detailToggles.nth(index).click();
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 });

    if ((await page.locator('[data-testid^="member-payment-summary-link-"]').count()) > 0) {
      return;
    }

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0, { timeout: 15000 });
  }

  assert.fail("owner members must expose at least one member detail with payment history");
}

async function captureMemberPaymentSummaryRoles(context) {
  const roleResults = {};
  const screenshots = [];

  for (const role of ["owner", "member", "guardian", "coach"]) {
    const page = await context.newPage();
    const messages = collectConsoleMessages(page);

    try {
      await gotoMembersAsRole(page, role);

      if (role === "owner") {
        await openOwnerPaymentSummary(page);
      }

      const summaries = page.locator('[data-testid^="member-payment-summary-"]:not([data-testid*="-link-"])');
      const links = page.locator('[data-testid^="member-payment-summary-link-"]');
      const summaryCount = await summaries.count();
      const linkCount = await links.count();
      const health = await collectPageHealth(page);

      assert.equal(health.frameworkOverlayCount, 0, `${role} member payment summary must not show a framework overlay`);
      assert(health.bodyTextLength > 100, `${role} member payment summary must not render a blank page`);
      assert.equal(health.horizontalOverflow, 0, `${role} member payment summary must not overflow horizontally`);

      if (role === "coach") {
        assert.equal(summaryCount, 0, "coach members must not render payment summaries");
        assert.equal(linkCount, 0, "coach members must not render payment detail links");
        roleResults[role] = { health, linkCount, messages, summaryCount };
        assert.deepEqual(messages, [], "coach member payment privacy flow must not emit console warnings/errors");
        continue;
      }

      assert(summaryCount > 0, `${role} members must render a payment summary`);
      assert(linkCount > 0, `${role} members must render a payment detail link`);

      const firstSummary = summaries.first();
      const firstLink = links.first();
      await firstSummary.scrollIntoViewIfNeeded();
      const summaryText = (await firstSummary.innerText()).trim();
      const linkLayout = await firstLink.evaluate((element) => {
        const rect = element.getBoundingClientRect();

        return {
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      });

      assert(summaryText.includes("결제·회원권"), `${role} summary must identify the payment membership section`);
      assert(summaryText.includes("납부") && summaryText.includes("만료"), `${role} summary must show due and expiry dates`);
      if (role === "owner") {
        assert(/₩[\d,]+/.test(summaryText), "owner summary must show the scoped effective amount");
      } else {
        assert(!/₩[\d,]+/.test(summaryText), `${role} summary must not reintroduce amount-centered family cards`);
      }
      assert(linkLayout.height >= 44, `${role} payment detail link must stay 44px tall; got ${linkLayout.height}px`);

      if (role === "owner" || role === "guardian") {
        const screenshotPath = join(outDir, `${role}-member-payment-summary-mobile.png`);
        await page.screenshot({ fullPage: false, path: screenshotPath });
        screenshots.push({ label: `${role} member payment summary`, path: screenshotPath, sizeBytes: statSync(screenshotPath).size });
      }

      let deepLink = null;
      if (role === "guardian") {
        const href = await firstLink.getAttribute("href");
        assert(href, "guardian member payment summary link must have an href");
        const targetUrl = new URL(href, baseUrl);
        const requestedMemberId = targetUrl.searchParams.get("memberId");
        const focusedPaymentId = targetUrl.searchParams.get("focusPayment");

        assert(requestedMemberId, "guardian member payment summary link must identify the child");
        assert(focusedPaymentId, "guardian member payment summary link must identify the payment");

        await firstLink.click();
        await page.waitForURL((url) => url.pathname === "/app/payments", { timeout: 15000 });
        await page.waitForSelector(`[data-payment-id="${focusedPaymentId}"]`, { timeout: 15000 });
        const renderedFocusedPaymentCount = await page.locator(`[data-payment-id="${focusedPaymentId}"]`).count();

        assert.equal(renderedFocusedPaymentCount, 1, "guardian payment deep link must render the exact payment card");

        const unselectedChildChip = page.locator('[data-testid="guardian-child-chip"][aria-pressed="false"]').first();
        const hasAlternativeChild = (await unselectedChildChip.count()) > 0;
        let manualSelectionAfterDeepLink = null;

        if (hasAlternativeChild) {
          const alternativeChildName = (await unselectedChildChip.locator("span").first().innerText()).trim();

          await unselectedChildChip.click();
          await page.waitForTimeout(250);
          const selectedAlternativeChildChip = page
            .locator('[data-testid="guardian-child-chip"]')
            .filter({ hasText: alternativeChildName })
            .first();

          manualSelectionAfterDeepLink = {
            alternativeChildName,
            remainedSelected: await selectedAlternativeChildChip.getAttribute("aria-pressed"),
          };
          assert.equal(
            manualSelectionAfterDeepLink.remainedSelected,
            "true",
            "guardian deep link must not pin the requested child after a manual selection",
          );
        }

        deepLink = {
          focusedPaymentId,
          manualSelectionAfterDeepLink,
          renderedFocusedPaymentCount,
          requestedMemberId,
          selectedChildChipCount: await page.locator('[data-testid="guardian-child-chip"][aria-pressed="true"]').count(),
          url: page.url(),
        };

        assert.equal(deepLink.selectedChildChipCount, 1, "guardian payment deep link must select exactly one child");
      }

      assert.deepEqual(messages, [], `${role} member payment summary flow must not emit console warnings/errors`);
      roleResults[role] = { deepLink, health, linkCount, linkLayout, messages, summaryCount, summaryText };
    } finally {
      await page.close();
    }
  }

  return { roles: roleResults, screenshots };
}

async function main() {
  assertStaticContracts();
  mkdirSync(outDir, { recursive: true });
  const removed = cleanOutputDir();
  const chromeExecutable = findChromeExecutable();
  assert(chromeExecutable, "Chrome or Chromium executable is required for member management touch-target proof");

  await ensureLocalAppServer();
  const resetBefore = await resetDevData("before");
  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  try {
    const ownerMembers = await captureOwnerMembers(context);
    const memberPaymentSummary = await captureMemberPaymentSummaryRoles(context);
    const iosSimulator = readIosSimulatorProof();
    const toggleTouchHeight = minMeasuredHeight({
      ...(ownerMembers.collapsedLayout.inviteToggleHeights.length ? { inviteToggle: ownerMembers.collapsedLayout.inviteToggleHeights } : {}),
      ...(ownerMembers.collapsedLayout.createToggleHeights.length ? { createToggle: ownerMembers.collapsedLayout.createToggleHeights } : {}),
    });
    const minOpenTouchHeight = minMeasuredHeight(ownerMembers.openControlHeights);
    const report = {
      ok: true,
      baseUrl,
      browserMode: "Browser runtime unavailable / Playwright with system Chrome",
      viewport: { width: 390, height: 844 },
      removed,
      verified: {
        allTouchTargetsAtLeast44: minOpenTouchHeight >= 44,
        createFormCollapsedByDefault: ownerMembers.collapsedLayout.createFormCount === 0,
        horizontalOverflow: ownerMembers.openHealth.horizontalOverflow,
        inviteFormCollapsedByDefault: ownerMembers.collapsedLayout.inviteFormCount === 0,
        iosSimulatorNoBrowserChrome: iosSimulator.ok === true,
        memberPaymentSummaryRoles: Object.keys(memberPaymentSummary.roles).length,
        coachPaymentSummaryCount: memberPaymentSummary.roles.coach.summaryCount,
        guardianFocusedPaymentCount: memberPaymentSummary.roles.guardian.deepLink?.renderedFocusedPaymentCount ?? 0,
        minOpenTouchHeight,
        openFormsStillRenderInputs:
          ownerMembers.openControlHeights.inviteFields.length > 0 &&
          ownerMembers.openControlHeights.createFields.length > 0 &&
          ownerMembers.openControlHeights.profileFields.length > 0,
        toggleTouchHeight,
      },
      memberPaymentSummary,
      ownerMembers,
      screenshots: [...ownerMembers.screenshots, ...memberPaymentSummary.screenshots],
      iosSimulator,
      resetBefore,
      resetAfter: await resetDevData("after"),
    };

    writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
    await browser.close();
    await stopManagedAppServer();
  }
}

main().catch(async (error) => {
  await stopManagedAppServer();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
