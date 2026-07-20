import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  assertOwnedSmokeServer,
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir =
  process.env.CLASS_MANAGEMENT_TOUCH_TARGETS_OUT_DIR ??
  ".data/mobile-builds/ios/class-management-touch-targets-20260705";
const roleScreenTimeoutMs = 30_000;
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

async function waitForManagedAppServer(timeoutMs = 60000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await canReachAppServer()) {
      return;
    }

    if (managedAppServer?.exitCode !== null) {
      throw new Error(`Managed class management app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed class management app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "class management touch-target check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "class management touch-target check",
  });

  if (await canReachAppServer()) {
    await assertOwnedSmokeServer({
      baseUrl,
      env: process.env,
      label: "class management touch-target check",
    });
    usingExistingAppServer = true;
    return;
  }

  const target = new URL(baseUrl);
  managedAppServer = spawn(
    npmCommand,
    ["run", "dev", "--", "--webpack", "--hostname", target.hostname, "--port", target.port],
    {
      cwd: process.cwd(),
      env: { ...process.env, FINAL_JUDO_ROLL_DEMO_DATES: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  managedAppServer.stdout?.on("data", (chunk) => {
    if (process.env.CLASS_MANAGEMENT_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stdout.write(`[class-management-touch-targets server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.CLASS_MANAGEMENT_TOUCH_TARGETS_SERVER_LOGS === "1") {
      process.stderr.write(`[class-management-touch-targets server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "class management touch-target check only mutates local dev data");
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `class management touch-target ${label} reset`,
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `class management touch-target ${label} reset failed with ${response.status}`);

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

    const shouldRemove = entry.name.endsWith(".png") || entry.name === "summary.json";

    if (!shouldRemove) {
      continue;
    }

    unlinkSync(join(outDir, entry.name));
    removed.push(entry.name);
  }

  return removed.sort();
}

async function gotoRole(page, role, nextPath) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);
  loginUrl.searchParams.set("next", nextPath);

  await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => url.pathname === nextPath, {
    timeout: 30000,
    waitUntil: "domcontentloaded",
  });
}

async function prepareStartedAttendanceSessions(context) {
  const page = await context.newPage();

  try {
    await gotoRole(page, "owner", "/app/classes");
    await page.waitForSelector('[data-testid="class-create-toggle"]', { timeout: roleScreenTimeoutMs });
    await page.waitForLoadState("networkidle", { timeout: roleScreenTimeoutMs });
    const now = Date.now();
    const updates = [
      {
        classId: "class-kids-am",
        endsAt: new Date(now + 48 * 60_000).toISOString(),
        startsAt: new Date(now - 2 * 60_000).toISOString(),
      },
      {
        classId: "class-adult-night",
        endsAt: new Date(now + 79 * 60_000).toISOString(),
        startsAt: new Date(now - 60_000).toISOString(),
      },
    ];
    const results = await page.evaluate(async (items) => {
      const bootstrapResponse = await fetch("/api/v1/me/bootstrap");
      const bootstrapPayload = await bootstrapResponse.json().catch(() => null);
      const classes = bootstrapPayload?.data?.db?.classes ?? [];

      const results = [];

      for (const item of items) {
        const targetClass = classes.find((candidate) => candidate.id === item.classId);

        if (!targetClass?.branchId) {
          results.push({ classId: item.classId, status: null });
          continue;
        }

        const response = await fetch(
          `/api/v1/classes/${encodeURIComponent(item.classId)}?selectedBranchId=${encodeURIComponent(targetClass.branchId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startsAt: item.startsAt, endsAt: item.endsAt }),
          },
        );

        results.push({ classId: item.classId, status: response.status });
      }

      return results;
    }, updates);

    assert.deepEqual(
      results,
      updates.map((item) => ({ classId: item.classId, status: 200 })),
      "class management touch-target check must prepare deterministic started attendance sessions",
    );
  } finally {
    await page.close();
  }
}

async function readHeights(page, selector) {
  return page.evaluate((targetSelector) => {
    return Array.from(document.querySelectorAll(targetSelector)).map((element) =>
      Math.round(element.getBoundingClientRect().height),
    );
  }, selector);
}

async function revealCoachClassList(page) {
  const classListToggle = page.getByTestId("coach-class-list-toggle");

  if ((await classListToggle.count()) > 0 && (await classListToggle.getAttribute("aria-expanded")) !== "true") {
    await classListToggle.click();
  }
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
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

async function captureOwnerClasses(context) {
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const collapsedScreenshotPath = join(outDir, "owner-classes-create-collapsed-mobile.png");
  const openScreenshotPath = join(outDir, "owner-classes-create-open-mobile.png");
  const weeklyScreenshotPath = join(outDir, "owner-classes-create-weekly-mobile.png");

  try {
    await gotoRole(page, "owner", "/app/classes");
    await page.waitForSelector('[data-testid="class-create-toggle"]', { timeout: roleScreenTimeoutMs });

    const collapsedLayout = {
      health: await collectPageHealth(page),
      formCount: await page.locator('[data-testid="class-create-form"]').count(),
      toggleHeight: (await readHeights(page, '[data-testid="class-create-toggle"]'))[0] ?? 0,
    };

    assert.equal(collapsedLayout.health.frameworkOverlayCount, 0, "owner classes must not show a framework overlay");
    assert(collapsedLayout.health.bodyTextLength > 100, "owner classes must not render a blank page");
    assert.equal(collapsedLayout.health.scrollWidth, collapsedLayout.health.clientWidth, "owner classes must not overflow horizontally");
    assert.equal(collapsedLayout.formCount, 0, "class create form must stay collapsed by default");
    assert(collapsedLayout.toggleHeight >= 44, `class create toggle must stay 44px tall; got ${collapsedLayout.toggleHeight}px`);
    await page.screenshot({ fullPage: false, path: collapsedScreenshotPath });

    await page.getByTestId("class-create-toggle").click();
    await page.waitForSelector('[data-testid="class-create-form"]', { timeout: 15000 });

    const openLayout = {
      health: await collectPageHealth(page),
      createTextMaxLengths: {
        level: Number(await page.getByLabel("레벨", { exact: true }).getAttribute("maxlength")),
        name: Number(await page.getByLabel("수업명", { exact: true }).getAttribute("maxlength")),
        room: Number(await page.getByLabel("장소", { exact: true }).getAttribute("maxlength")),
      },
      createFieldHeights: await readHeights(page, '[data-testid="class-create-field"]'),
      createSubmitHeights: await readHeights(page, '[data-testid="class-create-submit"]'),
      editRoomMaxLengths: await page
        .getByLabel("장소 수정", { exact: true })
        .evaluateAll((inputs) => inputs.map((input) => Number(input.getAttribute("maxlength")))),
      editInputHeights: await readHeights(page, '[data-testid="class-edit-input"]'),
      editSubmitHeights: await readHeights(page, '[data-testid="class-edit-submit"]'),
      formCount: await page.locator('[data-testid="class-create-form"]').count(),
    };

    assert.equal(openLayout.health.frameworkOverlayCount, 0, "owner classes open form must not show a framework overlay");
    assert.equal(openLayout.health.scrollWidth, openLayout.health.clientWidth, "owner classes open form must not overflow horizontally");
    assert.equal(openLayout.formCount, 1, "class create form must open after tapping the toggle");
    assertHeightsAtLeast("class create field", openLayout.createFieldHeights);
    assertHeightsAtLeast("class create submit", openLayout.createSubmitHeights);
    assertHeightsAtLeast("class edit input", openLayout.editInputHeights);
    assertHeightsAtLeast("class edit submit", openLayout.editSubmitHeights);
    assert.deepEqual(
      openLayout.createTextMaxLengths,
      { level: 40, name: 80, room: 80 },
      "class create fields must expose the server text limits",
    );
    assert(
      openLayout.editRoomMaxLengths.length > 0 && openLayout.editRoomMaxLengths.every((value) => value === 80),
      "class edit room fields must expose the server room limit",
    );
    assert.equal(messages.length, 0, `owner classes must not log console/page warnings: ${messages.join(" | ")}`);
    await page.screenshot({ fullPage: false, path: openScreenshotPath });

    const branchSelect = page.getByLabel("지점", { exact: true });
    if (await branchSelect.count()) {
      await branchSelect.selectOption("branch-gangnam");
    }
    await page.getByTestId("class-create-mode-weekly").click();
    await page.waitForSelector('[data-testid="class-create-weekdays"]', { timeout: 15000 });
    await page.getByTestId("class-create-main-schedule").scrollIntoViewIfNeeded();
    const weeklyLayout = {
      health: await collectPageHealth(page),
      mainScheduleHeights: await readHeights(page, '[data-testid="class-create-main-schedule"]'),
      mainScheduleSelectCount: await page.getByTestId("class-create-main-schedule").count(),
      modeHeights: await readHeights(page, '[data-testid^="class-create-mode-"]'),
      occurrenceSummary: await page.locator('[data-testid="class-create-form"]').getByText(/선택한 기간에 \d+회 수업을 등록합니다\./).count(),
      weekdayHeights: await readHeights(page, '[data-testid="class-create-weekday"]'),
    };

    assert.equal(weeklyLayout.health.frameworkOverlayCount, 0, "weekly class form must not show a framework overlay");
    assert.equal(weeklyLayout.health.scrollWidth, weeklyLayout.health.clientWidth, "weekly class form must not overflow horizontally");
    assert.equal(weeklyLayout.mainScheduleSelectCount, 1, "main branch weekly registration must expose the official timetable");
    assert.equal(weeklyLayout.occurrenceSummary, 1, "weekly class form must show the generated class count");
    assertHeightsAtLeast("class create main timetable", weeklyLayout.mainScheduleHeights);
    assertHeightsAtLeast("class create schedule mode", weeklyLayout.modeHeights);
    assertHeightsAtLeast("class create weekday", weeklyLayout.weekdayHeights);
    await page.screenshot({ fullPage: false, path: weeklyScreenshotPath });

    assert(statSync(collapsedScreenshotPath).size > 10_000, "owner classes collapsed screenshot must be non-empty");
    assert(statSync(openScreenshotPath).size > 10_000, "owner classes open screenshot must be non-empty");
    assert(statSync(weeklyScreenshotPath).size > 10_000, "owner classes weekly screenshot must be non-empty");

    return {
      collapsedLayout,
      messages,
      openLayout,
      weeklyLayout,
      screenshots: {
        collapsed: collapsedScreenshotPath,
        open: openScreenshotPath,
        weekly: weeklyScreenshotPath,
      },
      screenshotSizeBytes: {
        collapsed: statSync(collapsedScreenshotPath).size,
        open: statSync(openScreenshotPath).size,
        weekly: statSync(weeklyScreenshotPath).size,
      },
      url: page.url(),
    };
  } finally {
    await page.close();
  }
}

async function captureCoachAttendanceNote(context) {
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const screenshotPath = join(outDir, "coach-classes-note-open-mobile.png");

  try {
    await gotoRole(page, "coach", "/app/classes");
    await page.waitForSelector('[data-testid^="coach-class-card-"]', { timeout: roleScreenTimeoutMs });
    await revealCoachClassList(page);
    const rosterToggle = page.getByTestId("coach-class-roster-toggle-class-kids-am");
    if ((await rosterToggle.getAttribute("aria-expanded")) !== "true") {
      await rosterToggle.click();
    }
    const noteToggle = page.getByTestId("attendance-note-toggle-class-kids-am-member-jun");
    await noteToggle.waitFor({ timeout: 15000 });
    const noteToggleState = await noteToggle.evaluate(async (element) => {
      const bootstrapResponse = await fetch("/api/v1/me/bootstrap");
      const bootstrapPayload = await bootstrapResponse.json().catch(() => null);
      const targetClass = bootstrapPayload?.data?.db?.classes?.find((candidate) => candidate.id === "class-kids-am");

      return {
        ariaDescribedBy: element.getAttribute("aria-describedby"),
        disabled: element.matches(":disabled"),
        startsAt: targetClass?.startsAt ?? null,
      };
    });
    assert.equal(
      noteToggleState.disabled,
      false,
      `started class attendance note must be actionable: ${JSON.stringify(noteToggleState)}`,
    );
    await noteToggle.click();
    await page.getByTestId("attendance-note-editor-class-kids-am-member-jun").waitFor({ timeout: 15000 });
    const noteInput = page.getByTestId("attendance-note-class-kids-am-member-jun");

    const layout = {
      health: await collectPageHealth(page),
      noteInputMaxLength: await noteInput.getAttribute("maxlength"),
      noteInputHeights: await readHeights(page, 'input[data-testid^="attendance-note-"]'),
      notePresetHeights: await readHeights(page, '[data-testid^="attendance-note-preset-"]'),
      noteSaveHeights: await readHeights(page, '[data-testid^="attendance-note-save-"]'),
      noteToggleHeights: await readHeights(page, '[data-testid^="attendance-note-toggle-"]'),
    };

    assert.equal(layout.health.frameworkOverlayCount, 0, "coach classes note flow must not show a framework overlay");
    assert(layout.health.bodyTextLength > 100, "coach classes note flow must not render a blank page");
    assert.equal(layout.health.scrollWidth, layout.health.clientWidth, "coach classes note flow must not overflow horizontally");
    assert.equal(layout.noteInputMaxLength, "80", "coach attendance note must expose the shared 80-character limit");
    assertHeightsAtLeast("attendance note toggle", layout.noteToggleHeights);
    assertHeightsAtLeast("attendance note input", layout.noteInputHeights);
    assertHeightsAtLeast("attendance note preset", layout.notePresetHeights);
    assertHeightsAtLeast("attendance note save", layout.noteSaveHeights);
    assert.equal(messages.length, 0, `coach classes note flow must not log console/page warnings: ${messages.join(" | ")}`);
    await page.screenshot({ fullPage: false, path: screenshotPath });
    assert(statSync(screenshotPath).size > 10_000, "coach classes note screenshot must be non-empty");

    return {
      layout,
      messages,
      screenshotPath,
      screenshotSizeBytes: statSync(screenshotPath).size,
      url: page.url(),
    };
  } finally {
    await page.close();
  }
}

async function captureCoachBulkAttendance(context) {
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const confirmationScreenshotPath = join(outDir, "coach-classes-bulk-confirm-mobile.png");
  const restoredScreenshotPath = join(outDir, "coach-classes-bulk-restored-mobile.png");

  try {
    await gotoRole(page, "coach", "/app/classes");
    await page.waitForSelector('[data-testid^="attendance-bulk-request-"]', { timeout: roleScreenTimeoutMs });
    await revealCoachClassList(page);

    const bulkRequest = page.locator('[data-testid^="attendance-bulk-request-"]:not([disabled])').first();
    assert.equal(await bulkRequest.count(), 1, "coach bulk attendance check needs one actionable class");
    const requestTestId = await bulkRequest.getAttribute("data-testid");
    const sessionId = requestTestId?.replace("attendance-bulk-request-", "") ?? "";
    assert(sessionId, "coach bulk attendance request must identify its class session");

    const rosterToggle = page.getByTestId(`coach-class-roster-toggle-${sessionId}`);
    if ((await rosterToggle.getAttribute("aria-expanded")) !== "true") {
      await rosterToggle.click();
    }

    const initialStatuses = await page.evaluate((targetSessionId) => {
      const panel = document.querySelector(`[data-testid="coach-class-roster-panel-${targetSessionId}"]`);
      const presentButtons = Array.from(
        panel?.querySelectorAll(`button[data-testid^="attendance-${targetSessionId}-"][data-testid$="-present"]`) ?? [],
      );

      return presentButtons.map((presentButton) => {
        const presentTestId = presentButton.getAttribute("data-testid") ?? "";
        const baseTestId = presentTestId.slice(0, -"-present".length);
        const pressedButton = Array.from(panel?.querySelectorAll(`button[data-testid^="${baseTestId}-"]`) ?? [])
          .find((button) => button.getAttribute("aria-pressed") === "true");

        return {
          presentTestId,
          previousTestId: pressedButton?.getAttribute("data-testid") ?? null,
        };
      });
    }, sessionId);
    const changedStatuses = initialStatuses.filter((item) => item.previousTestId !== item.presentTestId);

    assert(changedStatuses.length > 0, "coach bulk attendance check needs at least one non-present member");
    assert((await readHeights(page, `[data-testid="${requestTestId}"]`))[0] >= 44, "bulk attendance request must stay 44px tall");

    await bulkRequest.click();
    await page.waitForSelector('[data-testid="attendance-bulk-confirm-dialog"]', { timeout: 15000 });

    const confirmation = {
      cancelHeight: (await readHeights(page, '[data-testid="attendance-bulk-confirm-cancel"]'))[0] ?? 0,
      dialogCount: await page.locator('[data-testid="attendance-bulk-confirm-dialog"]').count(),
      impactText: (await page.getByTestId("attendance-bulk-confirm-impact").innerText()).replace(/\s+/g, " ").trim(),
      submitHeight: (await readHeights(page, '[data-testid="attendance-bulk-confirm-submit"]'))[0] ?? 0,
      submitText: (await page.getByTestId("attendance-bulk-confirm-submit").innerText()).trim(),
    };

    assert.equal(confirmation.dialogCount, 1, "bulk attendance must require one confirmation dialog");
    assert(confirmation.impactText.includes(`변경 인원 ${changedStatuses.length}명`), "bulk attendance confirmation must show the affected count");
    assert(confirmation.submitText.includes(`${changedStatuses.length}명`), "bulk attendance confirmation action must repeat the affected count");
    assert(confirmation.cancelHeight >= 44, `bulk attendance cancel must stay 44px tall; got ${confirmation.cancelHeight}px`);
    assert(confirmation.submitHeight >= 44, `bulk attendance submit must stay 44px tall; got ${confirmation.submitHeight}px`);
    await page.screenshot({ fullPage: false, path: confirmationScreenshotPath });

    const batchResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/api/v1/class-sessions/${sessionId}/attendance`),
      { timeout: 15000 },
    );
    await page.getByTestId("attendance-bulk-confirm-submit").click();
    const batchResponse = await batchResponsePromise;
    const batchPayload = await batchResponse.json();
    assert(batchResponse.ok(), `bulk attendance API must succeed; got ${batchResponse.status()} ${JSON.stringify(batchPayload)}`);
    for (const item of changedStatuses) {
      const memberId = item.presentTestId.slice(`attendance-${sessionId}-`.length, -"-present".length);
      const persistedRecord = batchPayload?.data?.db?.attendance?.find(
        (record) => record.sessionId === sessionId && record.memberId === memberId,
      );
      assert.equal(
        persistedRecord?.status,
        "present",
        `bulk attendance response must persist ${memberId}; got ${JSON.stringify(persistedRecord)}`,
      );
    }
    await page.waitForSelector('[data-testid="attendance-bulk-confirm-dialog"]', { state: "detached", timeout: 15000 });
    await page.waitForSelector('[data-testid="attendance-bulk-undo-mobile"]', { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="attendance-bulk-undo-mobile"]')?.hasAttribute("disabled"), null, { timeout: 15000 });

    const updatedClassCard = page.getByTestId(`coach-class-card-${sessionId}`);
    if ((await updatedClassCard.getAttribute("data-coach-class-mobile-state")) === "hidden") {
      const classListToggle = page.getByTestId("coach-class-list-toggle");
      if ((await classListToggle.getAttribute("aria-expanded")) !== "true") {
        await classListToggle.click();
      }
    }
    const updatedRosterToggle = page.getByTestId(`coach-class-roster-toggle-${sessionId}`);
    if ((await updatedRosterToggle.getAttribute("aria-expanded")) !== "true") {
      await updatedRosterToggle.click();
    }

    for (const item of changedStatuses) {
      try {
        await page.waitForFunction(
          (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute("aria-pressed") === "true",
          item.presentTestId,
          { timeout: 15000 },
        );
      } catch {
        const diagnostic = await page.evaluate((testId) => {
          const button = document.querySelector(`[data-testid="${testId}"]`);

          return {
            ariaPressed: button?.getAttribute("aria-pressed") ?? null,
            operationError: document.querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, " ").trim() ?? null,
            testId,
            url: window.location.href,
          };
        }, item.presentTestId);
        throw new Error(`bulk attendance UI did not refresh after a successful response: ${JSON.stringify(diagnostic)}`);
      }
      assert.equal(
        await page.getByTestId(item.presentTestId).getAttribute("aria-pressed"),
        "true",
        `bulk attendance must mark ${item.presentTestId} present`,
      );
    }
    assert.equal(await page.locator('[data-testid="attendance-undo-last-mobile"]').count(), 0, "bulk attendance must not expose the single-member undo action");

    const bulkUndoHeight = (await readHeights(page, '[data-testid="attendance-bulk-undo-mobile"]'))[0] ?? 0;
    assert(bulkUndoHeight >= 44, `bulk attendance undo must stay 44px tall; got ${bulkUndoHeight}px`);
    await page.getByTestId("attendance-bulk-undo-mobile").click();
    await page.waitForSelector('[data-testid="attendance-bulk-undo-mobile"]', { state: "detached", timeout: 15000 });

    for (const item of changedStatuses) {
      if (item.previousTestId) {
        await page.waitForFunction(
          (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute("aria-pressed") === "true",
          item.previousTestId,
          { timeout: 15000 },
        );
      } else {
        await page.waitForFunction(
          (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute("aria-pressed") !== "true",
          item.presentTestId,
          { timeout: 15000 },
        );
      }
    }

    const health = await collectPageHealth(page);
    assert.equal(health.frameworkOverlayCount, 0, "coach bulk attendance flow must not show a framework overlay");
    assert.equal(health.scrollWidth, health.clientWidth, "coach bulk attendance flow must not overflow horizontally");
    assert.equal(messages.length, 0, `coach bulk attendance flow must not log console/page warnings: ${messages.join(" | ")}`);
    await page.screenshot({ fullPage: false, path: restoredScreenshotPath });
    assert(statSync(confirmationScreenshotPath).size > 10_000, "bulk attendance confirmation screenshot must be non-empty");
    assert(statSync(restoredScreenshotPath).size > 10_000, "bulk attendance restored screenshot must be non-empty");

    return {
      bulkUndoHeight,
      changedCount: changedStatuses.length,
      confirmation,
      health,
      messages,
      requestTestId,
      screenshots: {
        confirmation: confirmationScreenshotPath,
        restored: restoredScreenshotPath,
      },
      url: page.url(),
    };
  } finally {
    await page.close();
  }
}

function mockBrowserTime(page, hour) {
  const referenceTime = new Date();
  referenceTime.setHours(hour, 0, 0, 0);

  return page.addInitScript(({ now }) => {
    const RealDate = Date;

    class FixedDate extends RealDate {
      constructor(...args) {
        super(...(args.length === 0 ? [now] : args));
      }

      static now() {
        return now;
      }
    }

    window.Date = FixedDate;
  }, { now: referenceTime.getTime() });
}

async function captureGuardianClassPeriods(context) {
  const overviewPage = await context.newPage();
  const missingPage = await context.newPage();
  const overviewMessages = collectConsoleMessages(overviewPage);
  const missingMessages = collectConsoleMessages(missingPage);
  const overviewScreenshotPath = join(outDir, "guardian-classes-upcoming-past-mobile.png");
  const missingScreenshotPath = join(outDir, "guardian-classes-missing-attendance-mobile.png");

  try {
    await mockBrowserTime(overviewPage, 12);
    await gotoRole(overviewPage, "guardian", "/app/classes");
    await overviewPage.waitForSelector('[data-testid="family-upcoming-classes-heading"]', { timeout: roleScreenTimeoutMs });
    await overviewPage.waitForSelector('[data-testid="family-past-classes-heading"]', { timeout: roleScreenTimeoutMs });

    const overview = await overviewPage.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid^="family-class-card-"]'));

      return {
        firstCardPeriod: cards[0]?.getAttribute("data-family-class-period") ?? null,
        health: {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        },
        pastHeadingCount: document.querySelectorAll('[data-testid="family-past-classes-heading"]').length,
        upcomingHeadingCount: document.querySelectorAll('[data-testid="family-upcoming-classes-heading"]').length,
      };
    });

    assert.equal(overview.upcomingHeadingCount, 1, "guardian classes must render one upcoming section heading");
    assert.equal(overview.pastHeadingCount, 1, "guardian classes must render one past section heading");
    assert.equal(overview.firstCardPeriod, "upcoming", "guardian classes must put upcoming sessions before past sessions");
    assert.equal(overview.health.scrollWidth, overview.health.clientWidth, "guardian class period overview must not overflow horizontally");
    await overviewPage.screenshot({ fullPage: false, path: overviewScreenshotPath });

    await mockBrowserTime(missingPage, 19);
    await gotoRole(missingPage, "guardian", "/app/classes");
    await missingPage.getByTestId("guardian-child-chip").filter({ hasText: "한유나" }).click();
    await missingPage.waitForSelector('[data-testid^="family-attendance-status-"]', { timeout: roleScreenTimeoutMs });
    const missingStatusText = (await missingPage.locator('[data-testid^="family-attendance-status-"]').first().innerText()).trim();
    const selectedCardPeriod = await missingPage.locator('[data-testid^="family-class-card-"]').first().getAttribute("data-family-class-period");

    assert.equal(selectedCardPeriod, "past", "ended guardian class must be identified as a past class");
    assert.equal(missingStatusText, "미기록 · 확인 필요", "ended class without attendance must not be labeled scheduled");
    assert.equal(await missingPage.locator('[data-testid="family-upcoming-classes-heading"]').count(), 0, "selected child without future classes must not show an empty upcoming section");
    assert.equal(await missingPage.locator('[data-testid="family-past-classes-heading"]').count(), 1, "selected child past classes must keep one past section heading");
    assert.equal(overviewMessages.length, 0, `guardian class period overview must not log console/page warnings: ${overviewMessages.join(" | ")}`);
    assert.equal(missingMessages.length, 0, `guardian missing attendance flow must not log console/page warnings: ${missingMessages.join(" | ")}`);
    await missingPage.screenshot({ fullPage: false, path: missingScreenshotPath });
    assert(statSync(overviewScreenshotPath).size > 10_000, "guardian class period screenshot must be non-empty");
    assert(statSync(missingScreenshotPath).size > 10_000, "guardian missing attendance screenshot must be non-empty");

    return {
      missingStatusText,
      overview,
      screenshots: {
        missingAttendance: missingScreenshotPath,
        upcomingPast: overviewScreenshotPath,
      },
      selectedCardPeriod,
      urls: [overviewPage.url(), missingPage.url()],
    };
  } finally {
    await Promise.all([overviewPage.close(), missingPage.close()]);
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const removedOutputFiles = cleanOutputDir();

  await ensureLocalAppServer();

  const chromeExecutable = findChromeExecutable();

  assert(chromeExecutable, "Google Chrome/Chromium executable is required for class management touch-target checks");

  const browser = await chromium.launch({ executablePath: chromeExecutable });

  try {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });

    try {
      const beforeReset = await resetDevData("before");
      await prepareStartedAttendanceSessions(context);
      const coachNote = await captureCoachAttendanceNote(context);
      const coachBulk = await captureCoachBulkAttendance(context);
      const familyReset = await resetDevData("before-family");
      await context.clearCookies();
      await context.addInitScript(() => {
        window.localStorage.removeItem("final-judo-mvp-session");
      });
      const family = await captureGuardianClassPeriods(context);
      const owner = await captureOwnerClasses(context);
      const summary = {
        appServer: usingExistingAppServer ? "existing" : "managed-next-dev-webpack",
        baseUrl,
        browserExecutable: chromeExecutable,
        browserMode: "Browser runtime unavailable / Playwright with system Chrome",
        devReset: { before: beforeReset, beforeFamily: familyReset },
        flow:
          "coach bulk attendance confirmation/undo + guardian upcoming/past class states + class management controls keep 44px touch targets",
        removedOutputFiles,
        result: {
          coachBulk,
          coachNote,
          family,
          owner,
        },
        viewport: "390x844",
      };
      const summaryPath = join(outDir, "summary.json");

      writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
      console.log(JSON.stringify({ ok: true, summaryPath, ...summary }, null, 2));
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    await stopManagedAppServer();
  }
}

main().catch(async (error) => {
  await stopManagedAppServer();
  console.error(error);
  process.exit(1);
});
