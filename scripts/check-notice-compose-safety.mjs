import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import webPush from "web-push";
import {
  cleanupReleaseSmokeEnvironment,
  createReleaseSmokeEnvironment,
  resetOwnedSmokeServer,
} from "./lib/release-smoke-environment.mjs";

const screenshotPath = "/tmp/final-judo-notice-compose-safety-20260716.png";
const chromeCandidates = [
  process.env.E2E_CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const serverLogs = [];

function findChromeExecutable() {
  return chromeCandidates.find((candidate) => existsSync(candidate));
}

async function waitForServer(server, baseUrl, timeoutMs = 60_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (server.exitCode !== null) {
      throw new Error(`notice compose server exited early with ${server.exitCode}: ${serverLogs.slice(-20).join(" | ")}`);
    }

    try {
      const response = await fetch(new URL("/api/v1/dev/smoke-attestation", baseUrl));

      if (response.ok) {
        return;
      }
    } catch {
      // The owned server is still compiling.
    }

    await sleep(400);
  }

  throw new Error(`notice compose server did not start at ${baseUrl}`);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) {
    return;
  }

  const closed = new Promise((resolve) => server.once("close", resolve));

  if (process.platform !== "win32" && server.pid) {
    process.kill(-server.pid, "SIGINT");
  } else {
    server.kill("SIGINT");
  }

  await Promise.race([
    closed,
    sleep(5_000).then(() => {
      if (server.exitCode === null) {
        if (process.platform !== "win32" && server.pid) {
          process.kill(-server.pid, "SIGTERM");
        } else {
          server.kill("SIGTERM");
        }
      }
    }),
  ]);
}

async function loginTo(page, baseUrl, role, nextPath) {
  const loginUrl = new URL("/api/v1/dev/auto-login", baseUrl);
  loginUrl.searchParams.set("role", role);
  loginUrl.searchParams.set("next", nextPath);
  const loginResponse = await page.context().request.get(loginUrl.toString(), { maxRedirects: 0 });

  assert([302, 303, 307, 308].includes(loginResponse.status()), `${role} demo login must redirect`);
  await page.goto(new URL(nextPath, baseUrl).toString(), { waitUntil: "domcontentloaded" });
}

async function requestFromPage(page, path, { body, headers = {}, method = "GET" } = {}) {
  return page.evaluate(
    async ({ requestBody, requestHeaders, requestMethod, requestPath }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
      });

      return {
        body: await response.json().catch(() => ({})),
        idempotencyReplayed: response.headers.get("idempotency-replayed"),
        status: response.status,
      };
    },
    {
      requestBody: body,
      requestHeaders: headers,
      requestMethod: method,
      requestPath: path,
    },
  );
}

async function waitForInputValue(page, testId, expected) {
  await page.waitForFunction(
    ({ expectedValue, targetTestId }) =>
      document.querySelector(`[data-testid="${targetTestId}"]`)?.value === expectedValue,
    { expectedValue: expected, targetTestId: testId },
  );
}

function readRuntimeDb(plan) {
  return JSON.parse(readFileSync(plan.env.PILOT_DB_FILE, "utf8"));
}

async function verifyCreateIdempotency(browser, plan) {
  const adminContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const memberPage = await memberContext.newPage();
  const stamp = Date.now();
  const idempotencyKey = `notice.integration.${stamp}`;
  const title = `공지 멱등성 ${stamp}`;
  const path = "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam";
  const payload = {
    audience: ["member"],
    body: "동일한 요청은 한 번만 발행되어야 합니다.",
    important: true,
    targetMemberIds: ["member-minjae"],
    title,
  };

  try {
    await loginTo(memberPage, plan.baseUrl, "member", "/app/notices");
    const subscription = await requestFromPage(memberPage, "/api/v1/notifications/subscriptions", {
      method: "POST",
      body: {
        subscription: {
          endpoint: `https://push.example.test/notice-idempotency-${stamp}`,
          keys: { auth: "notice-idempotency-auth", p256dh: "notice-idempotency-p256dh" },
        },
        userAgent: "notice-compose-safety",
      },
    });
    assert.equal(subscription.status, 200, "member push subscription fixture must persist");

    const forbidden = await requestFromPage(memberPage, path, {
      body: payload,
      headers: { "Idempotency-Key": idempotencyKey },
      method: "POST",
    });
    assert.equal(forbidden.status, 403, "member must not consume a notice idempotency key");

    await loginTo(adminPage, plan.baseUrl, "admin", "/app/notices");
    const duplicateResults = await adminPage.evaluate(
      async ({ key, requestPath, requestPayload }) => {
        const send = async () => {
          const response = await fetch(requestPath, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": key },
            body: JSON.stringify(requestPayload),
          });

          return {
            body: await response.json().catch(() => ({})),
            replayed: response.headers.get("idempotency-replayed"),
            status: response.status,
          };
        };

        return Promise.all([send(), send(), send(), send()]);
      },
      { key: idempotencyKey, requestPath: path, requestPayload: payload },
    );

    assert(
      duplicateResults.every((result) => result.status === 200),
      "duplicate notice requests must all succeed",
    );
    const duplicateRuntimeDb = readRuntimeDb(plan);
    const duplicateDiagnostics = {
      notices: duplicateRuntimeDb.notices
        .filter((notice) => notice.title === title)
        .map((notice) => ({ createdAt: notice.createdAt, id: notice.id })),
      createAudits: duplicateRuntimeDb.auditLogs
        .filter((auditLog) => auditLog.action === "notice.create" && auditLog.after?.title === title)
        .map((auditLog) => ({ createdAt: auditLog.createdAt, id: auditLog.id, targetId: auditLog.targetId })),
      dispatchAudits: duplicateRuntimeDb.auditLogs
        .filter(
          (auditLog) =>
            auditLog.action === "notification.dispatch" &&
            duplicateRuntimeDb.notices.some((notice) => notice.title === title && notice.id === auditLog.targetId),
        )
        .map((auditLog) => ({ createdAt: auditLog.createdAt, id: auditLog.id, targetId: auditLog.targetId })),
      responseNoticeIds: duplicateResults.map((result) => result.body.data.notice.id),
    };
    assert.equal(
      duplicateResults[0].body.data.notice.id,
      duplicateResults[1].body.data.notice.id,
      `duplicate notice requests must return the same notice: ${JSON.stringify(duplicateDiagnostics)}`,
    );
    assert.deepEqual(
      duplicateResults.map((result) => result.replayed).sort(),
      ["false", "true", "true", "true"],
      "one duplicate response must create the notice and the remaining responses must identify the replay",
    );

    const noticeId = duplicateResults[0].body.data.notice.id;
    const db = readRuntimeDb(plan);
    const notices = db.notices.filter((notice) => notice.id === noticeId || notice.title === title);
    const createAudits = db.auditLogs.filter(
      (auditLog) => auditLog.action === "notice.create" && auditLog.targetId === noticeId,
    );
    const dispatchAudits = db.auditLogs.filter(
      (auditLog) =>
        auditLog.action === "notification.dispatch" &&
        auditLog.targetId === noticeId &&
        auditLog.after?.autoDispatchedOnCreate === true,
    );
    const outboxJobs = db.pushDispatchJobs.filter((job) => job.noticeId === noticeId);

    assert.equal(notices.length, 1, "duplicate requests must create one notice");
    assert.equal(createAudits.length, 1, "duplicate requests must create one notice.create audit");
    assert.equal(dispatchAudits.length, 1, "duplicate requests must create one automatic dispatch audit");
    assert.equal(outboxJobs.length, 1, "duplicate requests must enqueue one outbox job for one subscription");
    assert(!JSON.stringify(createAudits).includes(idempotencyKey), "raw notice idempotency keys must not be persisted");

    const conflict = await requestFromPage(adminPage, path, {
      body: { ...payload, body: "같은 키에 다른 본문입니다." },
      headers: { "Idempotency-Key": idempotencyKey },
      method: "POST",
    });
    assert.equal(conflict.status, 409, "the same notice key must reject a different payload");
    assert.equal(conflict.body.error?.code, "IDEMPOTENCY_CONFLICT", "notice conflict must use a stable error code");

    return {
      automaticDispatchAuditCount: dispatchAudits.length,
      createAuditCount: createAudits.length,
      noticeCount: notices.length,
      noticeId,
      outboxJobCount: outboxJobs.length,
      replayHeaders: duplicateResults.map((result) => result.replayed),
    };
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
}

async function verifyDraftScopingAndPendingUi(browser, plan) {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const consoleMessages = [];

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));

  try {
    const memberUrl = (memberId, memberName) =>
      `/app/notices?noticeCompose=1&noticeTarget=member&noticeTargetMemberId=${memberId}&noticeMemberSearch=${encodeURIComponent(memberName)}`;

    await loginTo(page, plan.baseUrl, "admin", memberUrl("member-jun", "이준"));
    await page.getByTestId("notice-create-title-input").waitFor({ state: "visible" });
    await page.getByTestId("notice-create-title-input").fill("이준 개인 초안");
    await page.locator('textarea[placeholder="공지 내용"]').fill("이준에게만 복원될 내용");
    await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.endsWith(":member:member-jun")));

    await page.goto(new URL(memberUrl("member-seo", "이서"), plan.baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForInputValue(page, "notice-create-title-input", "");
    assert.equal(await page.locator('textarea[placeholder="공지 내용"]').inputValue(), "", "member A body must not enter member B draft");

    await page.goto(new URL(memberUrl("member-jun", "이준"), plan.baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await waitForInputValue(page, "notice-create-title-input", "이준 개인 초안");
    assert.equal(
      await page.locator('textarea[placeholder="공지 내용"]').inputValue(),
      "이준에게만 복원될 내용",
      "member A draft must restore only for member A",
    );

    await page.goto(new URL("/app/notices?noticeCompose=1", plan.baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await page.getByTestId("notice-create-title-input").waitFor({ state: "visible" });
    await page.getByTestId("notice-create-branch-select").selectOption("branch-gangnam");
    await page.getByLabel("지점 전체").check();
    await page.getByTestId("notice-create-title-input").fill("강남 지점 초안");
    await page.locator('textarea[placeholder="공지 내용"]').fill("강남 지점에만 복원될 내용");
    await page.getByTestId("notice-create-branch-select").selectOption("branch-songpa");
    await waitForInputValue(page, "notice-create-title-input", "");
    await page.getByTestId("notice-create-branch-select").selectOption("branch-gangnam");
    await waitForInputValue(page, "notice-create-title-input", "강남 지점 초안");

    await page.getByLabel("반 대상").check();
    await waitForInputValue(page, "notice-create-title-input", "");
    const classSelect = page.getByTestId("notice-create-class-select");
    const classValues = await classSelect.locator("option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
    assert(classValues.length >= 2, "draft scope check requires two classes in the selected branch");
    await page.getByTestId("notice-create-title-input").fill("첫 반 초안");
    await page.locator('textarea[placeholder="공지 내용"]').fill("첫 반에만 복원될 내용");
    await classSelect.selectOption(classValues[1]);
    await waitForInputValue(page, "notice-create-title-input", "");
    await classSelect.selectOption(classValues[0]);
    await waitForInputValue(page, "notice-create-title-input", "첫 반 초안");

    await page.getByLabel("지점 전체").check();
    await waitForInputValue(page, "notice-create-title-input", "강남 지점 초안");
    const publishedNoticeTitle = `UI 발행 잠금 ${Date.now()}`;
    await page.getByTestId("notice-create-title-input").fill(publishedNoticeTitle);
    await page.locator('textarea[placeholder="공지 내용"]').fill("발행 중에는 중복 제출할 수 없어야 합니다.");

    let createRequestCount = 0;
    await page.route(/\/api\/v1\/branches\/[^/]+\/notices(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      createRequestCount += 1;
      await sleep(650);
      await route.continue();
    });

    const submit = page.getByTestId("notice-create-submit");
    await submit.click();
    await page.getByTestId("notice-create-confirmation").waitFor({ state: "visible" });
    assert.equal(createRequestCount, 0, "notice review step must not publish before explicit confirmation");
    assert.equal((await submit.innerText()).replace(/\s+/g, " ").trim(), "확인 후 발행", "notice submit must name the confirm action");
    await submit.click();
    await page.getByText("공지를 발행하고 알림을 준비하는 중입니다.").waitFor({ state: "visible" });
    assert.equal(await submit.isDisabled(), true, "notice submit must be disabled while publishing");
    assert.equal((await submit.innerText()).replace(/\s+/g, " ").trim(), "발행 중", "notice submit must expose pending feedback");
    assert.equal(await page.getByTestId("notice-create-form").getAttribute("aria-busy"), "true", "notice form must expose busy state");
    const submitBox = await submit.boundingBox();
    assert(submitBox && submitBox.height >= 44, "notice submit must remain at least 44px high while disabled");
    await submit.evaluate((button) => button.click());
    await page.getByTestId("notice-create-form").waitFor({ state: "detached", timeout: 15_000 });
    assert.equal(createRequestCount, 1, "disabled notice submit must not send a second request");

    await page.getByTestId("notices-screen").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("notice-create-toggle").waitFor({ state: "visible", timeout: 15_000 });
    const publishedNoticeCard = page.getByTestId("notice-delivery-compact-card").filter({ hasText: publishedNoticeTitle }).first();
    await publishedNoticeCard.waitFor({ state: "visible", timeout: 15_000 });

    let pushRequestCount = 0;
    await page.route(/\/api\/v1\/branches\/[^/]+\/notices\/[^/]+\/push(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      pushRequestCount += 1;
      await sleep(650);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { push: { message: "격리 환경 알림 발송 확인" } } }),
      });
    });

    const pushAction = publishedNoticeCard.getByTestId("notice-delivery-push-action");
    assert.equal((await pushAction.innerText()).replace(/\s+/g, " ").trim(), "알림 발송", "mobile push action must expose a visible label");
    const pushActionBox = await pushAction.boundingBox();
    assert(pushActionBox && pushActionBox.height >= 44, "notice push action must remain at least 44px high");

    await pushAction.click();
    const pushDialog = page.getByTestId("notice-push-confirmation-dialog");
    await pushDialog.waitFor({ state: "visible" });
    assert.equal(pushRequestCount, 0, "opening push confirmation must not call the dispatch API");
    assert.equal(await page.getByTestId("notice-push-confirmation-notice-title").innerText(), publishedNoticeTitle);
    assert.match(await page.getByTestId("notice-push-confirmation-audience").innerText(), /회원|학부모/);
    assert.match(await page.getByTestId("notice-push-confirmation-target").innerText(), /지점 전체/);
    assert.match(await page.getByTestId("notice-push-confirmation-recipient-count").innerText(), /앱 알림함 \d+명/);
    assert.match(await pushDialog.innerText(), /중복 표시될 수 있습니다/);
    assert.equal(
      await page.getByTestId("notice-push-confirmation-cancel").evaluate((button) => button === document.activeElement),
      true,
      "push confirmation must focus the safe cancel action first",
    );
    await page.getByTestId("notice-push-confirmation-cancel").click();
    await pushDialog.waitFor({ state: "detached" });
    assert.equal(pushRequestCount, 0, "cancelling push confirmation must not call the dispatch API");

    await pushAction.click();
    await pushDialog.waitFor({ state: "visible" });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const pushSubmit = page.getByTestId("notice-push-confirmation-submit");
    await pushSubmit.click();
    await page.getByText("발송 요청 중").waitFor({ state: "visible" });
    assert.equal(await pushSubmit.isDisabled(), true, "push confirm must disable while dispatch is pending");
    assert.equal(await pushSubmit.getAttribute("aria-busy"), "true", "push confirm must expose pending state");
    await pushSubmit.evaluate((button) => button.click());
    await page.getByTestId("notice-push-feedback").filter({ hasText: "격리 환경 알림 발송 확인" }).waitFor({ state: "visible" });
    assert.equal(pushRequestCount, 1, "confirmed push dispatch must call the API only once");

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      frameworkOverlayCount:
        document.querySelectorAll("[data-nextjs-dialog]").length +
        Array.from(document.querySelectorAll("nextjs-portal")).filter((portal) => (portal.textContent ?? "").trim()).length,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    const draftKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes("final-judo-notice-draft%3Av2")));

    assert.equal(layout.frameworkOverlayCount, 0, "notice compose UI must not show a framework overlay");
    assert.equal(layout.scrollWidth, layout.clientWidth, "notice compose UI must not overflow at 390px");
    assert.equal(consoleMessages.length, 0, `notice compose UI must stay console-clean: ${consoleMessages.join(" | ")}`);
    assert(statSync(screenshotPath).size > 10_000, "notice compose screenshot must be non-empty");

    return {
      consoleMessages,
      createRequestCount,
      pushActionHeight: pushActionBox.height,
      pushRequestCount,
      draftKeyCount: draftKeys.length,
      layout,
      screenshotPath,
      submitHeight: submitBox.height,
      viewport: "390x844",
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const executablePath = findChromeExecutable();
  const plan = await createReleaseSmokeEnvironment();
  const vapidKeys = webPush.generateVAPIDKeys();
  let browser = null;
  let server = null;

  assert(executablePath, "Chrome/Chromium is required for notice compose safety checks");
  plan.env.FINAL_JUDO_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  plan.env.FINAL_JUDO_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  plan.env.FINAL_JUDO_VAPID_SUBJECT = "mailto:notice-compose-safety@finaljudo.test";

  try {
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--webpack",
        "--hostname",
        plan.hostname,
        "--port",
        String(plan.port),
      ],
      {
        cwd: process.cwd(),
        detached: process.platform !== "win32",
        env: plan.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout?.on("data", (chunk) => serverLogs.push(String(chunk).trim()));
    server.stderr?.on("data", (chunk) => serverLogs.push(String(chunk).trim()));
    await waitForServer(server, plan.baseUrl);
    const resetResponse = await resetOwnedSmokeServer({ baseUrl: plan.baseUrl, env: plan.env, label: "notice compose safety" });
    assert(resetResponse.ok, `notice compose safety reset failed with ${resetResponse.status}`);

    browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const idempotency = await verifyCreateIdempotency(browser, plan);
    const ui = await verifyDraftScopingAndPendingUi(browser, plan);

    console.log(JSON.stringify({
      ok: true,
      baseUrl: plan.baseUrl,
      browserAvailability: "Browser skill is listed, but node_repl/browser runtime tools are unavailable; isolated Playwright fallback used",
      idempotency,
      ui,
    }, null, 2));
  } finally {
    await browser?.close();
    await stopServer(server);
    await cleanupReleaseSmokeEnvironment(plan);
  }
}

await main();
