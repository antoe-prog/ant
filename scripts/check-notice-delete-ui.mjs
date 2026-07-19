import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import {
  prepareStandaloneSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const outDir = process.env.NOTICE_DELETE_UI_OUT_DIR ?? ".data/mobile-builds/ios/notice-delete-ui-20260701";
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
let managedAppServerMode = null;

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
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
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
      throw new Error(`Managed notice delete UI app server exited before ${baseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed notice delete UI app server at ${baseUrl}`);
}

async function ensureLocalAppServer() {
  assert(canMutateLocalDevData(), "notice delete UI check only runs against a local dev app server");
  await prepareStandaloneSmokeEnvironment({
    baseUrl,
    env: process.env,
    label: "notice delete UI check",
  });

  if (await canReachAppServer()) {
    usingExistingAppServer = true;
    return;
  }

  const appUrl = new URL(baseUrl);
  const appPort = appUrl.port || "3000";
  managedAppServerMode = process.env.NOTICE_DELETE_UI_SERVER_MODE === "start" ? "start" : "dev";
  const serverArgs =
    managedAppServerMode === "start"
      ? ["run", "start", "--", "--hostname", appUrl.hostname, "--port", appPort]
      : ["run", "dev", "--", "--webpack", "--hostname", appUrl.hostname, "--port", appPort];

  managedAppServer = spawn(npmCommand, serverArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  managedAppServer.stdout?.on("data", (chunk) => {
    if (process.env.NOTICE_DELETE_UI_SERVER_LOGS === "1") {
      process.stdout.write(`[notice-delete-ui server] ${chunk}`);
    }
  });
  managedAppServer.stderr?.on("data", (chunk) => {
    if (process.env.NOTICE_DELETE_UI_SERVER_LOGS === "1") {
      process.stderr.write(`[notice-delete-ui server] ${chunk}`);
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
  assert(canMutateLocalDevData(), "notice delete UI check only mutates local dev data");
  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `notice delete UI ${label} dev reset`,
  }).catch((error) => {
    throw new Error(`Cannot reach ${baseUrl} for notice delete UI checks. ${error.message}`);
  });
  const payload = await response.json().catch(() => ({}));

  assert(response.ok, `notice delete UI ${label} dev reset failed with ${response.status}`);

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
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });

  return messages;
}

async function collectScreenState(page, screenTestId) {
  return page.evaluate((testId) => {
    const screen = document.querySelector(`[data-testid="${testId}"]`);
    const bodyText = document.body?.innerText ?? "";

    return {
      bodyTextLength: bodyText.length,
      clientWidth: document.documentElement.clientWidth,
      deleteActionCount: document.querySelectorAll(
        '[data-testid="notice-delivery-delete-action"], [data-testid="notification-notice-delete-action"]',
      ).length,
      frameworkOverlayCount:
        document.querySelectorAll("[data-nextjs-dialog]").length +
        Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0).length,
      heading: document.querySelector("main h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      screenVisible: Boolean(screen),
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, screenTestId);
}

async function loginTo(page, role, nextPath) {
  const loginUrl = new URL("/login", baseUrl);
  loginUrl.searchParams.set("autoLogin", "1");
  loginUrl.searchParams.set("role", role);
  loginUrl.searchParams.set("next", nextPath);

  await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
  try {
    await page.waitForURL((url) => url.pathname === nextPath, { timeout: 30000 });
  } catch (error) {
    const bodyText = (await page.locator("body").innerText().catch(() => "")).trim().slice(0, 500);
    throw new Error(
      `Notice delete UI auto-login failed for ${role}: expected ${nextPath}, got ${page.url()}; body=${JSON.stringify(bodyText)}`,
      { cause: error },
    );
  }
}

async function createNoticeFromCurrentSession(page, title, body) {
  const result = await page.evaluate(
    async ({ noticeBody, noticeTitle }) => {
      const response = await fetch("/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: ["member", "guardian"],
          body: noticeBody,
          important: true,
          title: noticeTitle,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      return {
        ok: response.ok,
        payload,
        status: response.status,
      };
    },
    {
      noticeBody: body,
      noticeTitle: title,
    },
  );

  assert(result.ok, `notice API seed failed with ${result.status}: ${JSON.stringify(result.payload)}`);
  assert(result.payload?.data?.notice?.id, "notice API seed must return the created notice id");

  return result.payload.data.notice.id;
}

async function requestFromCurrentSession(page, path, { body, method = "GET" } = {}) {
  return page.evaluate(
    async ({ requestBody, requestMethod, requestPath }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        ...(requestBody === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            }),
      });
      const payload = await response.json().catch(() => ({}));

      return {
        ok: response.ok,
        payload,
        status: response.status,
      };
    },
    {
      requestBody: body,
      requestMethod: method,
      requestPath: path,
    },
  );
}

async function verifyNoticeUpdateContract(browser) {
  const adminContext = await browser.newContext();
  const guardianContext = await browser.newContext();
  const coachContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const guardianPage = await guardianContext.newPage();
  const coachPage = await coachContext.newPage();
  const stamp = Date.now();

  try {
    await loginTo(adminPage, "admin", "/app/notices");
    await adminPage.waitForSelector('[data-testid="notices-screen"]', { timeout: 15000 });

    const originalTitle = `공지 수정 계약 ${stamp}`;
    const originalBody = "공지 수정 전 본문입니다.";
    const createResult = await requestFromCurrentSession(
      adminPage,
      "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam",
      {
        method: "POST",
        body: {
          audience: ["guardian"],
          body: originalBody,
          important: false,
          targetMemberIds: ["member-jun"],
          title: originalTitle,
        },
      },
    );
    const noticeId = createResult.payload?.data?.notice?.id;
    const createdNotice = createResult.payload?.data?.db?.notices?.find((notice) => notice.id === noticeId);
    const publishDispatchAudit = createResult.payload?.data?.db?.auditLogs?.find(
      (log) => log.action === "notification.dispatch" && log.targetId === noticeId,
    );
    const dispatchAuditCountBeforeUpdate = createResult.payload?.data?.db?.auditLogs?.filter(
      (log) => log.action === "notification.dispatch" && log.targetId === noticeId,
    ).length;

    assert.equal(createResult.status, 200, "admin notice update fixture must be created");
    assert(noticeId, "admin notice update fixture must return a notice id");
    assert(createdNotice, "notice creation must persist the notice before returning dispatch feedback");
    assert(publishDispatchAudit, "notice creation must retain its publish-time dispatch audit");
    assert.notEqual(
      publishDispatchAudit.after?.dispatchState,
      "requested",
      "successful notice creation must finalize the durable dispatch request marker",
    );
    assert(publishDispatchAudit.after?.requestedAt, "publish-time dispatch audit must retain the durable request timestamp");
    assert(publishDispatchAudit.after?.completedAt, "publish-time dispatch audit must retain the completion timestamp");

    await loginTo(guardianPage, "guardian", "/app/notifications");
    await guardianPage.waitForSelector('[data-testid="notifications-screen"]', { timeout: 15000 });

    const readResult = await requestFromCurrentSession(
      guardianPage,
      "/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam",
      {
        method: "POST",
        body: { noticeIds: [noticeId] },
      },
    );
    const readNotice = readResult.payload?.data?.db?.notices?.find((notice) => notice.id === noticeId);

    assert.equal(readResult.status, 200, "guardian must be able to mark the notice read before an edit");
    assert(readNotice?.readByUserIds?.includes("user-guardian"), "guardian read state must persist before an edit");

    const updatedTitle = `${originalTitle} 수정`;
    const updatedBody = "공지 수정 후 본문입니다.";
    const updateResult = await requestFromCurrentSession(
      adminPage,
      `/api/v1/branches/branch-gangnam/notices/${noticeId}?selectedBranchId=branch-gangnam`,
      {
        method: "PATCH",
        body: {
          body: updatedBody,
          important: true,
          title: updatedTitle,
        },
      },
    );
    const updatedNotice = updateResult.payload?.data?.db?.notices?.find((notice) => notice.id === noticeId);
    const resetAudit = updateResult.payload?.data?.db?.auditLogs?.find(
      (log) => log.action === "notice.update" && log.targetId === noticeId && log.after?.readStateReset === true,
    );

    assert.equal(updateResult.status, 200, "admin must be able to edit a notice");
    assert.deepEqual(updatedNotice?.readByUserIds, [], "visible notice edits must reset prior read state");
    assert(resetAudit, "visible notice edits must record the read-state reset in audit history");
    assert.equal(resetAudit.before?.body, undefined, "notice update audit must not retain the previous body");
    assert.equal(resetAudit.after?.body, undefined, "notice update audit must not retain the updated body");
    assert.equal(resetAudit.before?.bodyLength, originalBody.length, "notice update audit must retain the previous body length");
    assert.equal(resetAudit.after?.bodyLength, updatedBody.length, "notice update audit must retain the updated body length");
    assert.equal(resetAudit.after?.bodyChanged, true, "notice update audit must identify a body change");
    assert.equal(
      updateResult.payload?.data?.db?.auditLogs?.filter(
        (log) => log.action === "notification.dispatch" && log.targetId === noticeId,
      ).length,
      dispatchAuditCountBeforeUpdate,
      "notice updates must not automatically dispatch another push notification",
    );

    const guardianBootstrap = await requestFromCurrentSession(
      guardianPage,
      "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
    );
    const guardianUpdatedNotice = guardianBootstrap.payload?.data?.db?.notices?.find((notice) => notice.id === noticeId);

    assert.equal(guardianBootstrap.status, 200, "guardian bootstrap must remain available after a notice edit");
    assert(
      guardianUpdatedNotice && !guardianUpdatedNotice.readByUserIds.includes("user-guardian"),
      "edited notice must return to unread for the guardian",
    );

    const rereadResult = await requestFromCurrentSession(
      guardianPage,
      "/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam",
      {
        method: "POST",
        body: { noticeIds: [noticeId] },
      },
    );

    assert.equal(rereadResult.status, 200, "guardian must be able to read the edited notice again");

    const noChangeResult = await requestFromCurrentSession(
      adminPage,
      `/api/v1/branches/branch-gangnam/notices/${noticeId}?selectedBranchId=branch-gangnam`,
      {
        method: "PATCH",
        body: {
          body: updatedBody,
          important: true,
          title: updatedTitle,
        },
      },
    );
    const unchangedNotice = noChangeResult.payload?.data?.db?.notices?.find((notice) => notice.id === noticeId);
    const preserveAudit = noChangeResult.payload?.data?.db?.auditLogs?.find(
      (log) => log.action === "notice.update" && log.targetId === noticeId && log.after?.readStateReset === false,
    );

    assert.equal(noChangeResult.status, 200, "an idempotent notice edit must remain valid");
    assert(
      unchangedNotice?.readByUserIds?.includes("user-guardian"),
      "an idempotent notice edit must preserve the current read state",
    );
    assert(preserveAudit, "an idempotent notice edit must record that read state was preserved");

    for (const [label, invalidBody] of [
      ["null title", { title: null }],
      ["object audience", { audience: {} }],
      ["string important flag", { important: "true" }],
    ]) {
      const invalidUpdate = await requestFromCurrentSession(
        adminPage,
        `/api/v1/branches/branch-gangnam/notices/${noticeId}?selectedBranchId=branch-gangnam`,
        {
          method: "PATCH",
          body: invalidBody,
        },
      );

      assert.equal(invalidUpdate.status, 400, `notice updates must reject ${label} with a validation response`);
    }

    const immutableTargetUpdate = await requestFromCurrentSession(
      adminPage,
      `/api/v1/branches/branch-gangnam/notices/${noticeId}?selectedBranchId=branch-gangnam`,
      {
        method: "PATCH",
        body: { targetMemberIds: ["member-seo"] },
      },
    );

    assert.equal(immutableTargetUpdate.status, 400, "notice updates must reject unsupported class/member target changes");

    await loginTo(coachPage, "coach", "/app/notices");
    await coachPage.waitForSelector('[data-testid="notices-screen"]', { timeout: 15000 });

    const coachCreateResult = await requestFromCurrentSession(
      coachPage,
      "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam",
      {
        method: "POST",
        body: {
          audience: ["member", "guardian"],
          body: "코치 공지 수정 전 본문입니다.",
          targetMemberIds: ["member-jun"],
          title: `코치 공지 수정 계약 ${stamp}`,
        },
      },
    );
    const coachNoticeId = coachCreateResult.payload?.data?.notice?.id;

    assert.equal(coachCreateResult.status, 200, "coach notice update fixture must be created");
    assert(coachNoticeId, "coach notice update fixture must return a notice id");

    const coachEquivalentAudience = await requestFromCurrentSession(
      coachPage,
      `/api/v1/branches/branch-gangnam/notices/${coachNoticeId}?selectedBranchId=branch-gangnam`,
      {
        method: "PATCH",
        body: { audience: ["guardian", "member", "member"] },
      },
    );

    assert.equal(coachEquivalentAudience.status, 200, "coach updates must accept an equivalent reordered audience set");

    const coachAudienceChange = await requestFromCurrentSession(
      coachPage,
      `/api/v1/branches/branch-gangnam/notices/${coachNoticeId}?selectedBranchId=branch-gangnam`,
      {
        method: "PATCH",
        body: { audience: ["all"] },
      },
    );

    assert.equal(coachAudienceChange.status, 403, "coach notice updates must not expand the existing audience");

    const coachTargetChange = await requestFromCurrentSession(
      coachPage,
      `/api/v1/branches/branch-gangnam/notices/${coachNoticeId}?selectedBranchId=branch-gangnam`,
      {
        method: "PATCH",
        body: { targetMemberIds: ["member-seo"] },
      },
    );

    assert.equal(coachTargetChange.status, 400, "coach notice updates must not silently accept member target changes");

    const coachBodyChange = await requestFromCurrentSession(
      coachPage,
      `/api/v1/branches/branch-gangnam/notices/${coachNoticeId}?selectedBranchId=branch-gangnam`,
      {
        method: "PATCH",
        body: { body: "코치 공지 수정 후 본문입니다." },
      },
    );
    const coachUpdatedNotice = coachBodyChange.payload?.data?.db?.notices?.find((notice) => notice.id === coachNoticeId);

    assert.equal(coachBodyChange.status, 200, "coach must still be able to edit the body of an own notice");
    assert.deepEqual(
      coachUpdatedNotice?.audience,
      ["member", "guardian"],
      "coach body edits must preserve the original audience",
    );

    const concurrentCreate = await requestFromCurrentSession(
      adminPage,
      "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam",
      {
        method: "POST",
        body: {
          audience: ["guardian"],
          body: "동시 읽음 검증 전 본문입니다.",
          targetMemberIds: ["member-jun"],
          title: `공지 동시성 계약 ${stamp}`,
        },
      },
    );
    const concurrentNoticeId = concurrentCreate.payload?.data?.notice?.id;

    assert.equal(concurrentCreate.status, 200, "notice concurrency fixture must be created");
    assert(concurrentNoticeId, "notice concurrency fixture must return a notice id");

    const [concurrentUpdate, concurrentRead] = await Promise.all([
      requestFromCurrentSession(
        adminPage,
        `/api/v1/branches/branch-gangnam/notices/${concurrentNoticeId}?selectedBranchId=branch-gangnam`,
        {
          method: "PATCH",
          body: { body: "동시 읽음 검증 후 본문입니다." },
        },
      ),
      requestFromCurrentSession(
        guardianPage,
        "/api/v1/me/notices/bulk-read?selectedBranchId=branch-gangnam",
        {
          method: "POST",
          body: { noticeIds: [concurrentNoticeId] },
        },
      ),
    ]);

    assert.equal(concurrentUpdate.status, 200, "concurrent notice edit must complete without a lost-update error");
    assert.equal(concurrentRead.status, 200, "concurrent notice read must complete without a lost-update error");

    const concurrentBootstrap = await requestFromCurrentSession(
      adminPage,
      "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam",
    );
    const concurrentNotice = concurrentBootstrap.payload?.data?.db?.notices?.find(
      (notice) => notice.id === concurrentNoticeId,
    );
    const latestConcurrentAction = concurrentBootstrap.payload?.data?.db?.auditLogs?.find(
      (log) =>
        log.targetId === concurrentNoticeId && (log.action === "notice.read" || log.action === "notice.update"),
    )?.action;

    assert(
      latestConcurrentAction === "notice.read" || latestConcurrentAction === "notice.update",
      "concurrent notice operations must leave an ordered audit result",
    );
    assert.equal(
      concurrentNotice?.readByUserIds?.includes("user-guardian") ?? false,
      latestConcurrentAction === "notice.read",
      "final notice read state must match the last serialized read or visible edit operation",
    );

    return {
      auditBodyStored: false,
      coachAudienceChangeStatus: coachAudienceChange.status,
      coachBodyChangeStatus: coachBodyChange.status,
      concurrentReadEditSerialized: true,
      idempotentEditPreservedReadState: true,
      invalidUpdateStatus: 400,
      targetChangeStatus: immutableTargetUpdate.status,
      visibleEditResetReadState: true,
    };
  } finally {
    await adminContext.close();
    await guardianContext.close();
    await coachContext.close();
  }
}

async function verifyNoticesScreenDelete(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const title = `UI 삭제 확인 ${Date.now()}`;
  const confirmScreenshotPath = join(outDir, "desktop-notices-delete-confirm.png");
  const afterScreenshotPath = join(outDir, "desktop-notices-delete-after.png");

	try {
	  await loginTo(page, "admin", "/app/notices");
	  await page.waitForSelector('[data-testid="notices-screen"]', { timeout: 15000 });
	  await page.getByTestId("notice-create-toggle").click();
	  await page.getByTestId("notice-create-title-input").waitFor({ state: "visible", timeout: 5000 });

	  const initialState = await collectScreenState(page, "notices-screen");

    assert.equal(initialState.screenVisible, true, "admin notices screen must render");
    assert.equal(initialState.frameworkOverlayCount, 0, "admin notices screen must not show a framework overlay");
    assert(initialState.bodyTextLength > 100, "admin notices screen must not be blank");

    await page.getByTestId("notice-create-title-input").fill(title);
    await page.locator('textarea[placeholder="공지 내용"]').fill("공지 삭제 UI 회귀 검증용 임시 공지입니다.");
    await page.getByTestId("notice-create-submit").click();
    await page.getByTestId("notice-create-confirmation").waitFor({ state: "visible", timeout: 5000 });
    await page.getByTestId("notice-create-submit").click();

    const createdCard = page.getByTestId("notice-delivery-compact-card").filter({ hasText: title }).first();

    await createdCard.waitFor({ state: "visible", timeout: 15000 });
    await createdCard.getByTestId("notice-delivery-more-menu-toggle").click();
    await createdCard.getByTestId("notice-delivery-delete-action").click();
    await createdCard.getByTestId("notice-delete-confirm").waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ fullPage: false, path: confirmScreenshotPath });
    await createdCard.getByTestId("notice-delete-confirm-action").click();
    await page.getByTestId("notice-delete-feedback").waitFor({ state: "visible", timeout: 10000 });
    await createdCard.waitFor({ state: "detached", timeout: 10000 });
    await page.screenshot({ fullPage: false, path: afterScreenshotPath });

    const feedbackText = await page.getByTestId("notice-delete-feedback").innerText();
    const afterState = await collectScreenState(page, "notices-screen");

    assert(feedbackText.includes("공지를 삭제했습니다"), "admin notices screen must confirm deletion");
    assert.equal(await page.getByTestId("notice-delivery-compact-card").filter({ hasText: title }).count(), 0, "deleted notice must disappear from notices screen");
    assert.equal(afterState.frameworkOverlayCount, 0, "admin notices screen must stay free of framework overlays after delete");
    assert.equal(afterState.scrollWidth, afterState.clientWidth, "admin notices screen must not overflow horizontally after delete");
    assert.equal(messages.length, 0, `admin notices screen must not log console/page warnings: ${messages.join(" | ")}`);
    assert(statSync(confirmScreenshotPath).size > 10_000, "desktop notices confirm screenshot must be non-empty");
    assert(statSync(afterScreenshotPath).size > 10_000, "desktop notices after screenshot must be non-empty");

    return {
      afterScreenshotPath,
      afterScreenshotSizeBytes: statSync(afterScreenshotPath).size,
      afterState,
      confirmScreenshotPath,
      confirmScreenshotSizeBytes: statSync(confirmScreenshotPath).size,
      feedbackText,
      initialState,
      messages,
      title,
      url: page.url(),
      viewport: "1280x900",
    };
  } finally {
    await context.close();
  }
}

async function verifyMobileNoticesScreenActionLayout(browser) {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const screenshotPath = join(outDir, "mobile-notices-action-row-compact.png");
  const readFeedbackScreenshotPath = join(outDir, "mobile-notices-read-feedback.png");
  const bottomScreenshotPath = join(outDir, "mobile-notices-bottom-safe-area.png");
  const readTitle = `모바일 공지 읽음 ${Date.now()}`;

  try {
    await loginTo(page, "admin", "/app/notices");
    await page.waitForSelector('[data-testid="notices-screen"]', { timeout: 15000 });
    await createNoticeFromCurrentSession(page, readTitle, "모바일 공지 단일 읽음 피드백 회귀 검증용 임시 공지입니다.");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('[data-testid="notices-screen"]', { timeout: 15000 });

    const firstCard = page.getByTestId("notice-delivery-compact-card").filter({ hasText: readTitle }).first();

    await firstCard.waitFor({ state: "visible", timeout: 15000 });

    const layoutState = await firstCard.evaluate((card) => {
      const title = card.querySelector("h3");
      const actionRow = card.querySelector('[data-testid="notice-delivery-action-row"]');
      const buttons = actionRow ? Array.from(actionRow.querySelectorAll("button")) : [];
      const visibleButtons = buttons.filter((button) => {
        const rect = button.getBoundingClientRect();

        return rect.width > 0 && rect.height > 0;
      });
      const moreMenuToggle = actionRow?.querySelector('[data-testid="notice-delivery-more-menu-toggle"]');
      const moreMenuToggleRect = moreMenuToggle?.getBoundingClientRect();
      const titleRect = title?.getBoundingClientRect();
      const actionRect = actionRow?.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      return {
        actionButtonWidths: visibleButtons.map((button) => button.getBoundingClientRect().width),
        actionButtonVisibleCount: visibleButtons.length,
        actionLayout: actionRow?.getAttribute("data-notice-action-layout") ?? "",
        actionRight: actionRect?.right ?? 0,
        actionTop: actionRect?.top ?? 0,
        bodyTextLength: document.body?.innerText.length ?? 0,
        cardHeight: Math.round(cardRect.height),
        cardRight: cardRect.right,
        clientWidth: document.documentElement.clientWidth,
        frameworkOverlayCount:
          document.querySelectorAll("[data-nextjs-dialog]").length +
          Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim().length > 0).length,
        moreMenuToggleHeight: moreMenuToggleRect?.height ?? 0,
        moreMenuToggleWidth: moreMenuToggleRect?.width ?? 0,
        noticeDeliveryBodyVisibleCount: Array.from(document.querySelectorAll('[data-testid="notice-delivery-body"]')).filter((body) => {
          const rect = body.getBoundingClientRect();
          const style = getComputedStyle(body);

          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        }).length,
        noticeDeliveryBodyMaxHeight: Math.max(
          0,
          ...Array.from(document.querySelectorAll('[data-testid="notice-delivery-body"]')).map((body) =>
            Math.round(body.getBoundingClientRect().height),
          ),
        ),
        secondaryActionVisibleCount: buttons.filter((button) =>
          ["notice-delivery-edit-action", "notice-delivery-delete-action"].includes(button.getAttribute("data-testid") ?? "") &&
          button.getBoundingClientRect().width > 0 &&
          button.getBoundingClientRect().height > 0,
        ).length,
        scrollWidth: document.documentElement.scrollWidth,
        titleBottom: titleRect?.bottom ?? 0,
      };
    });

    assert.equal(layoutState.frameworkOverlayCount, 0, "admin mobile notices screen must not show a framework overlay");
    assert(layoutState.bodyTextLength > 100, "admin mobile notices screen must not be blank");
    assert.equal(layoutState.actionLayout, "stacked-mobile", "admin mobile notices action row must use the compact stacked layout");
    assert(
      layoutState.actionTop >= layoutState.titleBottom - 2,
      `admin mobile notices action row must sit below the title row; titleBottom=${layoutState.titleBottom}, actionTop=${layoutState.actionTop}`,
    );
    assert.equal(layoutState.actionButtonVisibleCount, 2, "admin mobile notices must show only read and push buttons before opening more actions");
    assert(
      layoutState.actionButtonWidths.every((width) => width <= 112),
      `admin mobile notices primary action buttons must stay compact; widths=${layoutState.actionButtonWidths.join(", ")}`,
    );
    assert(layoutState.moreMenuToggleWidth >= 44 && layoutState.moreMenuToggleHeight >= 44, "admin mobile notices more menu must keep a 44px touch target");
    assert.equal(layoutState.secondaryActionVisibleCount, 0, "admin mobile notices edit and delete actions must stay hidden before opening more actions");
    assert(layoutState.noticeDeliveryBodyVisibleCount > 0, "admin mobile notices must show a body preview before delivery metadata");
    assert(layoutState.noticeDeliveryBodyMaxHeight <= 40, "admin mobile notice body previews must stay within two text lines");
    assert(layoutState.cardHeight <= 188, `admin mobile notices card with preview must stay at or below 188px; got ${layoutState.cardHeight}px`);
    assert(layoutState.actionRight <= layoutState.cardRight + 1, "admin mobile notices action row must stay inside the card");
    assert.equal(layoutState.scrollWidth, layoutState.clientWidth, "admin mobile notices screen must not overflow horizontally");
    assert.equal(messages.length, 0, `admin mobile notices screen must not log console/page warnings: ${messages.join(" | ")}`);

    await page.screenshot({ fullPage: false, path: screenshotPath });
    assert(statSync(screenshotPath).size > 10_000, "mobile notices action row screenshot must be non-empty");

    await firstCard.getByTestId("notice-delivery-read-action").click();
    await page.getByTestId("notice-read-feedback").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(
      (title) => {
        const cards = Array.from(document.querySelectorAll('[data-testid="notice-delivery-compact-card"]'));
        const card = cards.find((item) => (item.textContent ?? "").includes(title));

        return (
          card?.getAttribute("data-notice-read-state") === "read" &&
          !card.querySelector('[data-testid="notice-delivery-read-action"]')
        );
      },
      readTitle,
      { timeout: 10000 },
    );
    await page.screenshot({ fullPage: false, path: readFeedbackScreenshotPath });

    const readState = await firstCard.evaluate((card) => ({
      readActionCount: card.querySelectorAll('[data-testid="notice-delivery-read-action"]').length,
      readState: card.getAttribute("data-notice-read-state") ?? "",
      text: card.textContent ?? "",
    }));
    const readFeedbackText = await page.getByTestId("notice-read-feedback").innerText();

    assert.equal(readFeedbackText, "공지 확인을 저장했습니다.", "admin mobile notices single read action must show persistence feedback");
    assert.equal(readState.readState, "read", "admin mobile notices single read action must tone down the card");
    assert.equal(readState.readActionCount, 0, "admin mobile notices single read action must disappear after read");
    assert(readState.text.includes("읽음"), "admin mobile notices read card must show the read state label");
    assert(statSync(readFeedbackScreenshotPath).size > 10_000, "mobile notices read feedback screenshot must be non-empty");

    await firstCard.getByTestId("notice-delivery-push-action").click();
    await page.getByTestId("notice-push-confirmation-dialog").waitFor({ state: "visible", timeout: 5000 });
    await page.getByTestId("notice-push-confirmation-submit").click();
    await page.getByTestId("notice-push-feedback").waitFor({ state: "visible", timeout: 10000 });

    const manualDispatchProof = await page.evaluate(async (title) => {
      const response = await fetch("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
      const payload = await response.json();
      const notice = payload?.data?.db?.notices?.find((candidate) => candidate.title === title);
      const dispatchAudits = payload?.data?.db?.auditLogs?.filter(
        (log) => log.action === "notification.dispatch" && log.targetId === notice?.id,
      );
      const latestAudit = dispatchAudits?.[0];

      return {
        auditCount: dispatchAudits?.length ?? 0,
        completedAt: latestAudit?.after?.completedAt ?? null,
        dispatchState: latestAudit?.after?.dispatchState ?? null,
        requestedAt: latestAudit?.after?.requestedAt ?? null,
        status: response.status,
      };
    }, readTitle);

    assert.equal(manualDispatchProof.status, 200, "manual dispatch proof must reload persisted notice state");
    assert(manualDispatchProof.auditCount >= 2, "manual resend must retain both publish-time and resend dispatch audits");
    assert.notEqual(
      manualDispatchProof.dispatchState,
      "requested",
      "successful manual resend must finalize the durable dispatch request marker",
    );
    assert(manualDispatchProof.requestedAt, "manual resend audit must retain the durable request timestamp");
    assert(manualDispatchProof.completedAt, "manual resend audit must retain the completion timestamp");

    const feedbackResetState = await page.evaluate(() => ({
      createFeedbackCount: document.querySelectorAll('[data-testid="notice-create-feedback"]').length,
      deleteFeedbackCount: document.querySelectorAll('[data-testid="notice-delete-feedback"]').length,
      pushFeedbackText: document.querySelector('[data-testid="notice-push-feedback"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      readFeedbackCount: document.querySelectorAll('[data-testid="notice-read-feedback"]').length,
    }));

    assert(
      feedbackResetState.pushFeedbackText.length > 0,
      "admin mobile notices push action must show the current push feedback",
    );
    assert.equal(
      feedbackResetState.readFeedbackCount,
      0,
      "admin mobile notices push action must clear stale single-read feedback",
    );
    assert.equal(
      feedbackResetState.deleteFeedbackCount,
      0,
      "admin mobile notices push action must not leave stale delete feedback beside push feedback",
    );
    assert.equal(
      feedbackResetState.createFeedbackCount,
      0,
      "admin mobile notices push action must not leave stale create feedback beside push feedback",
    );

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);

    const bottomState = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="notice-delivery-compact-card"]'));
      const lastCard = cards.at(-1);
      const lastCardRect = lastCard?.getBoundingClientRect();
      const navRect = document.querySelector('[data-testid="mobile-bottom-navigation"]')?.getBoundingClientRect();
      const safeAreaRect = document.querySelector('[data-testid="notice-bottom-safe-area"]')?.getBoundingClientRect();

      return {
        bottomClearance: navRect && lastCardRect ? navRect.top - lastCardRect.bottom : 0,
        cardCount: cards.length,
        clientWidth: document.documentElement.clientWidth,
        lastCardBottom: lastCardRect?.bottom ?? 0,
        navTop: navRect?.top ?? 0,
        safeAreaCount: document.querySelectorAll('[data-testid="notice-bottom-safe-area"]').length,
        safeAreaHeight: safeAreaRect?.height ?? 0,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    assert.equal(bottomState.safeAreaCount, 1, "admin mobile notices screen must render one bottom safe-area spacer");
    assert(bottomState.safeAreaHeight >= 112, `admin mobile notices bottom safe-area spacer must be at least 112px; got ${bottomState.safeAreaHeight}px`);
    assert(bottomState.cardCount > 0, "admin mobile notices bottom check needs at least one notice card");
    assert(
      bottomState.bottomClearance >= 96,
      `admin mobile notices last card must clear the bottom nav by at least 96px; got ${bottomState.bottomClearance}px`,
    );
    assert.equal(bottomState.scrollWidth, bottomState.clientWidth, "admin mobile notices screen must not overflow horizontally at scroll end");
    await page.screenshot({ fullPage: false, path: bottomScreenshotPath });
    assert(statSync(bottomScreenshotPath).size > 10_000, "mobile notices bottom safe-area screenshot must be non-empty");

    return {
      bottomScreenshotPath,
      bottomScreenshotSizeBytes: statSync(bottomScreenshotPath).size,
      bottomState,
      feedbackResetState,
      layoutState,
      manualDispatchProof,
      messages,
      readFeedbackScreenshotPath,
      readFeedbackScreenshotSizeBytes: statSync(readFeedbackScreenshotPath).size,
      readFeedbackText,
      readState,
      screenshotPath,
      screenshotSizeBytes: statSync(screenshotPath).size,
      url: page.url(),
      viewport: "390x844",
    };
  } finally {
    await context.close();
  }
}

async function verifyNotificationInboxDelete(browser) {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const messages = collectConsoleMessages(page);
  const title = `모바일 알림 삭제 ${Date.now()}`;
  const confirmScreenshotPath = join(outDir, "mobile-notifications-delete-confirm.png");
  const afterScreenshotPath = join(outDir, "mobile-notifications-delete-after.png");

  try {
    await loginTo(page, "admin", "/app/notifications");
    await page.waitForSelector('[data-testid="notifications-screen"]', { timeout: 15000 });
    await createNoticeFromCurrentSession(page, title, "모바일 알림함 삭제 UI 회귀 검증용 임시 공지입니다.");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('[data-testid="notifications-screen"]', { timeout: 15000 });

    const seededCard = page.getByTestId("notification-inbox-card").filter({ hasText: title }).first();
    const initialState = await collectScreenState(page, "notifications-screen");

    assert.equal(initialState.screenVisible, true, "admin notification inbox must render");
    assert.equal(initialState.frameworkOverlayCount, 0, "admin notification inbox must not show a framework overlay");
    assert(initialState.deleteActionCount > 0, "admin notification inbox must expose notice delete actions");
    await seededCard.waitFor({ state: "visible", timeout: 15000 });
    const mobileDeleteButtonBox = await seededCard.getByTestId("notification-notice-delete-action").boundingBox();

    assert(mobileDeleteButtonBox, "admin mobile notification inbox notice delete action must be measurable");
    assert(
      mobileDeleteButtonBox.width <= 56,
      `admin mobile notification inbox notice delete action must stay compact; got ${mobileDeleteButtonBox.width}px`,
    );
    await seededCard.getByTestId("notification-notice-delete-action").click();
    await seededCard.getByTestId("notification-notice-delete-confirm").waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ fullPage: false, path: confirmScreenshotPath });
    await seededCard.getByTestId("notification-notice-delete-confirm-action").click();
    await page.getByTestId("notification-delete-feedback").waitFor({ state: "visible", timeout: 10000 });
    await seededCard.waitFor({ state: "detached", timeout: 10000 });
    await page.screenshot({ fullPage: false, path: afterScreenshotPath });

    const feedbackText = await page.getByTestId("notification-delete-feedback").innerText();
    const afterState = await collectScreenState(page, "notifications-screen");

    assert(feedbackText.includes("공지를 삭제했습니다"), "admin notification inbox must confirm deletion");
    assert.equal(await page.getByTestId("notification-inbox-card").filter({ hasText: title }).count(), 0, "deleted notice must disappear from notification inbox");
    assert.equal(afterState.frameworkOverlayCount, 0, "admin notification inbox must stay free of framework overlays after delete");
    assert.equal(afterState.scrollWidth, afterState.clientWidth, "admin notification inbox must not overflow horizontally after delete");
    assert.equal(messages.length, 0, `admin notification inbox must not log console/page warnings: ${messages.join(" | ")}`);
    assert(statSync(confirmScreenshotPath).size > 10_000, "mobile notifications confirm screenshot must be non-empty");
    assert(statSync(afterScreenshotPath).size > 10_000, "mobile notifications after screenshot must be non-empty");

    return {
      afterScreenshotPath,
      afterScreenshotSizeBytes: statSync(afterScreenshotPath).size,
      afterState,
      confirmScreenshotPath,
      confirmScreenshotSizeBytes: statSync(confirmScreenshotPath).size,
      feedbackText,
      initialState,
      messages,
      mobileDeleteButtonWidth: mobileDeleteButtonBox.width,
      title,
      url: page.url(),
      viewport: "390x844",
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const executablePath = findChromeExecutable();
  let browser = null;
  let resetAfter = null;

  assert(executablePath, `Chrome/Chromium is required for notice delete UI proof against ${baseUrl}`);
  mkdirSync(outDir, { recursive: true });

  try {
    await ensureLocalAppServer();

    const resetBefore = await resetDevData("before");
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      executablePath,
      headless: true,
    });

    const noticesScreen = await verifyNoticesScreenDelete(browser);
    const mobileNoticesActionLayout = await verifyMobileNoticesScreenActionLayout(browser);
    const notificationInbox = await verifyNotificationInboxDelete(browser);
    const noticeUpdateContract = await verifyNoticeUpdateContract(browser);

    resetAfter = await resetDevData("after");

    const summaryPath = join(outDir, "summary.json");
    const previousSummary = existsSync(summaryPath)
      ? JSON.parse(readFileSync(summaryPath, "utf8"))
      : {};
    const summary = {
      ok: true,
      baseUrl,
      appServer: usingExistingAppServer ? "existing" : `managed-next-${managedAppServerMode}`,
      browserAvailability: "Browser skill present but node_repl js tool unavailable; Playwright fallback used",
      checked: [
        "admin notices screen delete button opens a confirm step",
        "admin notices screen confirmed delete removes the notice and shows feedback",
        "admin mobile notices screen action row stacks below the title row",
        "admin mobile notices screen single read action shows feedback and tones down the card",
        "admin mobile notices screen clears stale read/create/delete feedback when push feedback appears",
        "admin mobile notices screen bottom safe-area keeps the last notice above the bottom navigation",
        "admin mobile notification inbox delete button opens a confirm step",
        "admin mobile notification inbox delete action stays compact on 390px screens",
        "admin mobile notification inbox confirmed delete removes the notice and shows feedback",
        "visible notice edits reset recipient read state while idempotent edits preserve it",
        "coach notice edits cannot expand the existing audience",
        "notice edit and read writes serialize without stale read-state merges",
        "notice updates reject malformed values and unsupported class/member target changes",
        "notice update audit history stores body length and change flags without body content",
        "notice create and manual resend finalize durable pre-dispatch audit markers",
        "delete UI screens stay nonblank, overlay-free, console-clean, and horizontally contained",
      ],
      iosSimulator: previousSummary.iosSimulator ?? null,
      mobileNoticesActionLayout,
      noticeUpdateContract,
      notificationInbox,
      noticesScreen,
      resetAfter,
      resetBefore,
    };

    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  } finally {
    await browser?.close();
    if (!resetAfter && (await canReachAppServer())) {
      await resetDevData("after-failure").catch(() => null);
    }
    await stopManagedAppServer();
  }
}

main().catch((error) => {
  console.error(`notice delete UI check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
