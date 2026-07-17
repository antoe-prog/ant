import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { resetOwnedSmokeServer } from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const skipDevReset = process.env.E2E_SKIP_DEV_RESET === "1";
const note = `Mobile E2E attendance ${Date.now()}`;
const offlineNote = `Mobile E2E offline queue ${Date.now()}`;
const coachPhone = "01031967428";
const coachPassword = process.env.SMOKE_COACH_PASSWORD ?? "FinalJudoPilot!2026";
const attendanceQueueKeyPrefix = "final-judo-pending-attendance:";
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

async function resetDemoData(phase) {
  if (skipDevReset) {
    return;
  }

  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `${phase} mobile E2E reset`,
  }).catch((error) => {
    throw new Error(`Cannot reset demo data ${phase} mobile E2E. ${error.message}`);
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Cannot reset demo data ${phase} mobile E2E: ${response.status} ${payload.error?.code ?? ""} ${payload.error?.message ?? ""}`.trim(),
    );
  }

  assert.equal(payload.data?.counts?.branches, 2, `demo data reset ${phase} mobile E2E must restore baseline branches`);
}

async function loginWithCredentials(page, phone) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("휴대폰 번호").fill(phone);
  await page.getByLabel("비밀번호", { exact: true }).fill(coachPassword);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL("**/app/dashboard", { timeout: 10000 });
}

async function loginWithRoleShortcut(page, role) {
  await page.context().clearCookies();
  const next = encodeURIComponent("/app/dashboard");
  await page.goto(`${baseUrl}/api/v1/dev/auto-login?role=${role}&next=${next}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/app/dashboard", { timeout: 10000 });
}

async function logoutWithApi(page) {
  await page.evaluate(() => {
    window.localStorage.removeItem("final-judo-mvp-session");
  });
  await page.context().clearCookies();
  await page.goto("about:blank");
}

async function getCurrentUserId(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/me/bootstrap");
    const payload = await response.json();

    return payload.data?.user?.id ?? null;
  });
}

function getAttendanceQueueKey(userId) {
  return `${attendanceQueueKeyPrefix}${encodeURIComponent(userId)}`;
}

async function verifyFamilyMobilePriorityPanel(page, roleLabel) {
  await page.waitForURL("**/app/dashboard", { timeout: 10000 });
  const mainContent = page.getByRole("main");

  if (roleLabel === "guardian") {
    const learningPanel = page.getByTestId("guardian-learning-summary-panel");
    await learningPanel.waitFor({ timeout: 10000 });
    const mainContentText = await mainContent.textContent();
    const retiredGuidancePattern =
      /다음 행동 큐|오늘 확인 브리프|주간 확인 리듬|오늘 복귀 안내 레일|수업 전 준비 보드|확인 리마인드 큐|24시간 팔로업 큐|우선순위 타임라인|확인 마감 슬롯|7일 유지 신호|재방문 약속 큐|확인 누락 방지 보드|오늘 마감 액션 보드|3분 복귀 체크 보드|유지 루틴/;

    for (const label of ["단계별 수련 수준", "코치 피드백", "심사결과", "대회"]) {
      await learningPanel.getByText(label, { exact: true }).first().waitFor({ timeout: 10000 });
    }

    const learningPanelBox = await learningPanel.boundingBox();
    const learningPanelText = await learningPanel.textContent();

    assert(learningPanelBox, "guardian learning summary panel must have a visible bounding box");
    assert(learningPanelBox.width <= 390, `guardian learning summary panel must fit the viewport, got width ${learningPanelBox.width}`);
    assert(!/CSV/.test(learningPanelText ?? ""), "guardian learning summary panel must not expose CSV wording");
    assert(
      !retiredGuidancePattern.test(mainContentText ?? ""),
      "guardian dashboard must not expose internal operations guidance anywhere in the main content",
    );
    assert.equal(
      await page.getByTestId("member-guardian-mobile-priority-panel").count(),
      0,
      "guardian dashboard must not show the today summary panel",
    );
    for (const removedText of [
      "학부모 홈",
      "자녀별 수업, 출석, 결제 상태와 공지를 한 화면에서 확인합니다.",
      "오늘 요약",
      "등록 수업",
      "출석 기록",
      "회원권 상태",
      "자녀 수업",
    ]) {
      assert.equal(await page.getByText(removedText, { exact: true }).count(), 0, `guardian dashboard must not show ${removedText}`);
    }
    assert.equal(
      await mainContent.getByRole("link", { name: "보강 요청" }).count(),
      0,
      "guardian dashboard must not show the makeup request CTA above the learning summary",
    );

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    assert.equal(layout.scrollWidth, layout.clientWidth, "guardian learning dashboard must not overflow horizontally");
    return;
  }

  const panel = page.getByTestId("member-guardian-mobile-priority-panel");
  await panel.waitFor({ timeout: 10000 });

  for (const label of ["다음 수업", "출석", "결제 상태", "공지"]) {
    await panel.getByText(label, { exact: true }).first().waitFor({ timeout: 10000 });
  }

  assert.equal(
    await page.getByTestId("guardian-learning-summary-panel").count(),
    0,
    `${roleLabel} dashboard must not show the guardian-only learning summary panel`,
  );

  const panelBox = await panel.boundingBox();
  const actionLinks = panel.locator('[data-testid^="member-guardian-mobile-action-"]');
  const actionCount = await actionLinks.count();
  const panelText = await panel.textContent();
  const mainContentText = await mainContent.textContent();
  const csvExportLinkCount = await panel.locator('a[href*="/api/v1/exports"], a[href*="exports"]').count();
  const retiredGuidancePattern =
    /다음 행동 큐|오늘 확인 브리프|주간 확인 리듬|오늘 복귀 안내 레일|수업 전 준비 보드|확인 리마인드 큐|24시간 팔로업 큐|우선순위 타임라인|확인 마감 슬롯|7일 유지 신호|재방문 약속 큐|확인 누락 방지 보드|오늘 마감 액션 보드|3분 복귀 체크 보드|유지 루틴/;
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  assert(panelBox, `${roleLabel} mobile priority panel must have a visible bounding box`);
  assert(panelBox.width <= 390, `${roleLabel} mobile priority panel must fit the viewport, got width ${panelBox.width}`);
  assert.equal(actionCount, 0, `${roleLabel} mobile priority panel must not duplicate summary actions above the detail cards`);
  assert(!/CSV/.test(panelText ?? ""), `${roleLabel} mobile priority panel must not expose CSV wording`);
  assert(!retiredGuidancePattern.test(panelText ?? ""), `${roleLabel} mobile priority panel must not expose internal operations guidance`);
  assert(
    !retiredGuidancePattern.test(mainContentText ?? ""),
    `${roleLabel} dashboard must not expose internal operations guidance anywhere in the main content`,
  );
  assert.equal(csvExportLinkCount, 0, `${roleLabel} mobile priority panel must not expose CSV export links`);
  assert.equal(layout.scrollWidth, layout.clientWidth, `${roleLabel} dashboard mobile priority panel must not overflow horizontally`);

  for (const duplicateHeading of ["회원 홈", "오늘 요약", "오늘 수업", "보강 요청", "결제 확인"]) {
    assert.equal(
      await page.getByRole("heading", { name: duplicateHeading, exact: true }).count(),
      0,
      `${roleLabel} dashboard must not duplicate the compact summary with ${duplicateHeading}`,
    );
  }

  for (let index = 0; index < actionCount; index += 1) {
    const box = await actionLinks.nth(index).boundingBox();

    assert(box, `${roleLabel} mobile priority action ${index + 1} must have a visible bounding box`);
    assert(
      box.height >= 40 && box.width >= 120,
      `${roleLabel} mobile priority action ${index + 1} must be touchable, got ${box.width}x${box.height}`,
    );
  }
}

async function run() {
  const executablePath = findChromeExecutable();

  assert(
    executablePath,
    `Chrome/Chromium executable was not found. Set E2E_CHROME_EXECUTABLE or install Google Chrome to run mobile E2E against ${baseUrl}.`,
  );

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
  const page = await context.newPage();
  let attendanceFailureBudget = 0;

  await page.route(/\/api\/v1\/class-sessions\/[^/]+\/attendance(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "PUT" && attendanceFailureBudget > 0) {
      attendanceFailureBudget -= 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "TEST_ATTENDANCE_SAVE_FAILURE",
            message: "출석 저장 테스트 실패",
          },
        }),
      });
      return;
    }

    await route.continue();
  });

  try {
    await loginWithRoleShortcut(page, "member");
    await verifyFamilyMobilePriorityPanel(page, "member");
    await logoutWithApi(page);

    await loginWithRoleShortcut(page, "guardian");
    await verifyFamilyMobilePriorityPanel(page, "guardian");
    await logoutWithApi(page);

    await loginWithCredentials(page, coachPhone);
    const coachUserId = await getCurrentUserId(page);

    assert(coachUserId, "credential login must expose the current coach user id");
    const coachAttendanceQueueKey = getAttendanceQueueKey(coachUserId);
    const mainContent = page.getByRole("main");
    await mainContent.getByRole("heading", { name: "대시보드", exact: true }).waitFor({ timeout: 10000 });
    const coachDashboardFollowUpPanel = page.getByTestId("coach-dashboard-follow-up-panel");
    await coachDashboardFollowUpPanel.waitFor({ timeout: 10000 });
    await coachDashboardFollowUpPanel.getByRole("heading", { name: "상담/주의 회원", exact: true }).waitFor({ timeout: 10000 });
    const coachDashboardText = await mainContent.textContent();
    const coachDashboardPanelText = await coachDashboardFollowUpPanel.textContent();
    const coachDashboardLayout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    assert(!/결제\/만료 경고|확인할 결제 경고|확인할 결제 항목|결제 상태 확인/.test(coachDashboardText ?? ""), "coach dashboard must not expose payment warning operations");
    assert(!/₩|[0-9][0-9,]*원/.test(coachDashboardPanelText ?? ""), "coach dashboard follow-up panel must not expose payment amounts");
    assert.equal(coachDashboardLayout.scrollWidth, coachDashboardLayout.clientWidth, "coach dashboard follow-up panel must not overflow horizontally");

    await page.goto(`${baseUrl}/app/notices`, { waitUntil: "load" });
    await mainContent.getByRole("heading", { name: "공지", exact: true }).waitFor({ timeout: 10000 });
    await page.getByTestId("notice-filter-all").waitFor({ timeout: 10000 });
    await page.getByTestId("notice-filter-unread").waitFor({ timeout: 10000 });
    await page.getByTestId("notice-filter-important").waitFor({ timeout: 10000 });
    const noticeCreatePanelBox = await page.getByTestId("notice-create-panel").boundingBox();
    const firstNoticeDeliveryCardBox = await page.getByTestId("notice-delivery-compact-card").first().boundingBox();

    assert(
      noticeCreatePanelBox && firstNoticeDeliveryCardBox && noticeCreatePanelBox.y < firstNoticeDeliveryCardBox.y,
      "mobile notice composer must appear before notice delivery cards for publishing roles",
    );

    await page.getByTestId("notice-create-toggle").click();
    await page.getByLabel("개인 대상").check();
    const noticeMemberSearchInput = page.getByTestId("notice-create-member-search-input");
    await noticeMemberSearchInput.waitFor({ timeout: 10000 });
    await noticeMemberSearchInput.fill("이준");
    const noticeMemberSearchResult = page.getByTestId("notice-create-member-result").filter({ hasText: "이준" }).first();
    await noticeMemberSearchResult.waitFor({ timeout: 10000 });
    await noticeMemberSearchResult.click();
    await page.getByTestId("notice-create-selected-member").getByText("이준", { exact: true }).waitFor({ timeout: 10000 });
    await noticeMemberSearchInput.fill("없는회원");
    await page.getByText("검색 결과 없음").waitFor({ timeout: 10000 });
    assert.equal(
      await page.getByTestId("notice-create-selected-member").count(),
      0,
      "notice composer must clear the selected personal target when the search text changes",
    );
    await noticeMemberSearchInput.fill("01072483619");
    const noticeMemberSearchResultAfterClear = page.getByTestId("notice-create-member-result").filter({ hasText: "이준" }).first();
    await noticeMemberSearchResultAfterClear.waitFor({ timeout: 10000 });
    await noticeMemberSearchResultAfterClear.click();
    await page.getByTestId("notice-create-selected-member").getByText("이준", { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(
      await page.getByTestId("notice-create-member-select").count(),
      0,
      "notice composer must not render the retired personal target scroll select",
    );
    assert.equal(
      await page.getByTestId("notice-create-member-search").locator("select").count(),
      0,
      "notice composer personal targeting must stay search-based",
    );

    await page.waitForFunction(() => document.querySelectorAll('[data-testid="notice-unread-badge"]').length >= 1, {
      timeout: 10000,
    });
    const initialNoticeState = await page.evaluate(() => {
      const noticeLink = document.querySelector('[data-testid="app-header-notice-link"]');
      const requestLinks = Array.from(document.querySelectorAll('a[href="/app/requests"]'));

      return {
        badgeCount: document.querySelectorAll('[data-testid="notice-unread-badge"]').length,
        hasRequestsAlertAria: requestLinks.some((link) => link.getAttribute("aria-label")?.includes("확인할 알림")),
        noticeAriaLabel: noticeLink?.getAttribute("aria-label") ?? "",
      };
    });

    assert(
      initialNoticeState.badgeCount >= 1,
      `notification alert badge must render in top notice action before bulk read, got ${initialNoticeState.badgeCount}`,
    );
    assert(initialNoticeState.noticeAriaLabel.includes("알림함, 미확인 공지"), "top notice action must expose unread notice count");
    assert(!initialNoticeState.hasRequestsAlertAria, "notices navigation must not expose deleted request alerts");

    const unreadNoticeFilter = page.getByTestId("notice-filter-unread");
    const importantNoticeFilter = page.getByTestId("notice-filter-important");
    const unreadNoticeFilterBox = await unreadNoticeFilter.boundingBox();

    assert(unreadNoticeFilterBox, "mobile unread notice filter must have a visible bounding box");
    assert(
      unreadNoticeFilterBox.height >= 40 && unreadNoticeFilterBox.width >= 64,
      `mobile unread notice filter must be touchable, got ${unreadNoticeFilterBox.width}x${unreadNoticeFilterBox.height}`,
    );

    await unreadNoticeFilter.click();
    assert.equal(await unreadNoticeFilter.getAttribute("aria-pressed"), "true", "unread notice filter must expose pressed state");
    await page.getByText("승급 심사 준비 안내").waitFor({ timeout: 10000 });
    await importantNoticeFilter.click();
    assert.equal(await importantNoticeFilter.getAttribute("aria-pressed"), "true", "important notice filter must expose pressed state");
    await page.getByText("승급 심사 준비 안내").waitFor({ timeout: 10000 });

    assert.equal(await page.getByTestId("notice-operations-panel").count(), 0, "coach notices must not show owner/admin notice operations");
    assert.equal(await page.getByTestId("notice-action-queue").count(), 0, "coach notices must not show owner/admin notice queues");
    assert((await page.getByTestId("notice-delivery-compact-card").count()) > 0, "coach notices must show readable notice delivery cards");

    const noticeBulkReadButton = page.getByTestId("notice-bulk-read-filtered");
    const noticeBulkReadButtonBox = await noticeBulkReadButton.boundingBox();

    assert(noticeBulkReadButtonBox, "mobile notice bulk read button must have a visible bounding box");
    assert(
      noticeBulkReadButtonBox.height >= 40 && noticeBulkReadButtonBox.width >= 96,
      `mobile notice bulk read button must be touchable, got ${noticeBulkReadButtonBox.width}x${noticeBulkReadButtonBox.height}`,
    );

    await noticeBulkReadButton.click();
    await page.getByText(/(현재 공지|보이는 미읽음 공지) \d+건을 읽음 처리했습니다\./).waitFor({ timeout: 10000 });
    await unreadNoticeFilter.click();
    await page.getByText("선택한 보기의 공지가 없습니다").waitFor({ timeout: 10000 });

    const noticeFilterVerification = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      hasFilteredCount: /미읽음\s*0/.test(document.body.innerText),
      noticeAriaLabel: document.querySelector('[data-testid="app-header-notice-link"]')?.getAttribute("aria-label") ?? "",
    }));

    assert.equal(noticeFilterVerification.scrollWidth, noticeFilterVerification.clientWidth, "notices screen filters must not overflow horizontally");
    assert.equal(noticeFilterVerification.hasFilteredCount, true, "notices screen must show filtered count summary");
    assert(!noticeFilterVerification.noticeAriaLabel.includes("미확인 공지"), "global notification badge must not describe request follow-ups as unread notices");

    await page.goto(`${baseUrl}/app/classes`, { waitUntil: "load" });
    await mainContent.getByRole("heading", { name: "수업/출석" }).waitFor({ timeout: 10000 });
    await mainContent.getByRole("heading", { name: "출석 처리" }).waitFor({ timeout: 10000 });
    await page.getByTestId("mobile-account-menu-toggle").waitFor({ timeout: 10000 });

    const coachMobileSpeedPanel = page.getByTestId("coach-mobile-speed-panel");
    await coachMobileSpeedPanel.waitFor({ timeout: 10000 });
    assert.equal(await coachMobileSpeedPanel.getAttribute("aria-label"), "빠른 조치", "coach mobile speed panel must expose its accessible label");
    await page.getByTestId("coach-mobile-speed-unchecked-action").waitFor({ timeout: 10000 });
    await page.getByTestId("coach-mobile-speed-reason-action").waitFor({ timeout: 10000 });
    await page.getByTestId("coach-mobile-speed-attention-action").waitFor({ timeout: 10000 });

    const coachMobileSpeedPanelBox = await coachMobileSpeedPanel.boundingBox();
    const coachSpeedUncheckedAction = page.getByTestId("coach-mobile-speed-unchecked-action");
    const coachSpeedReasonAction = page.getByTestId("coach-mobile-speed-reason-action");
    const coachSpeedAttentionAction = page.getByTestId("coach-mobile-speed-attention-action");
    const coachSpeedResetAction = page.getByTestId("coach-mobile-speed-reset-action");
    const coachSpeedUncheckedText = await coachSpeedUncheckedAction.textContent();
    const coachSpeedReasonText = await coachSpeedReasonAction.textContent();
    const coachSpeedAttentionText = await coachSpeedAttentionAction.textContent();
    const coachSpeedUncheckedBox = await coachSpeedUncheckedAction.boundingBox();
    const coachSpeedReasonBox = await coachSpeedReasonAction.boundingBox();
    const coachSpeedAttentionBox = await coachSpeedAttentionAction.boundingBox();

    assert(coachMobileSpeedPanelBox, "coach mobile speed panel must have a visible bounding box");
    assert(
      coachMobileSpeedPanelBox.width <= 390,
      `coach mobile speed panel must fit the viewport, got width ${coachMobileSpeedPanelBox.width}`,
    );
    assert.match(coachSpeedUncheckedText ?? "", /^미처리\s+\d+$/, "coach mobile speed unchecked action must show its count");
    assert.match(coachSpeedReasonText ?? "", /^사유 필요\s+\d+$/, "coach mobile speed reason action must show its count and scope");
    assert.match(coachSpeedAttentionText ?? "", /^주의\s+\d+$/, "coach mobile speed attention action must show its count");
    for (const [label, box] of [
      ["unchecked", coachSpeedUncheckedBox],
      ["reason", coachSpeedReasonBox],
      ["attention", coachSpeedAttentionBox],
    ]) {
      assert(box, `coach mobile speed ${label} action must have a visible bounding box`);
      assert(
        box.height >= 40 && box.width >= 72,
        `coach mobile speed ${label} action must be touchable, got ${box.width}x${box.height}`,
      );
    }

    await coachSpeedUncheckedAction.click();
    assert.equal(
      await page.getByTestId("attendance-unchecked-filter").isChecked(),
      true,
      "coach mobile speed unchecked action must enable the unchecked attendance filter",
    );
    await coachSpeedResetAction.waitFor({ timeout: 10000 });
    const coachSpeedResetBox = await coachSpeedResetAction.boundingBox();
    assert(coachSpeedResetBox, "coach mobile speed reset action must have a visible bounding box");
    assert(
      coachSpeedResetBox.height >= 40 && coachSpeedResetBox.width >= 72,
      `coach mobile speed reset action must be touchable, got ${coachSpeedResetBox.width}x${coachSpeedResetBox.height}`,
    );
    await coachSpeedResetAction.click();
    assert.equal(
      await page.getByTestId("attendance-unchecked-filter").isChecked(),
      false,
      "coach mobile speed reset action must clear the unchecked attendance filter",
    );

    const coachSpeedVerification = await page.evaluate(() => ({
      hasPaymentAmountText: /₩|[0-9][0-9,]*원/.test(document.querySelector('[data-testid="coach-mobile-speed-panel"]')?.textContent ?? ""),
      hasInternalGuardrailText: /결제 금액 비노출 유지|코치 화면 금액 미노출/.test(
        document.querySelector('[data-testid="coach-mobile-speed-panel"]')?.textContent ?? "",
      ),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    assert.equal(coachSpeedVerification.hasPaymentAmountText, false, "coach mobile speed panel must not expose payment amounts");
    assert.equal(coachSpeedVerification.hasInternalGuardrailText, false, "coach mobile speed panel must not expose internal guardrail wording");
    assert.equal(
      coachSpeedVerification.scrollWidth,
      coachSpeedVerification.clientWidth,
      "coach mobile speed panel must not introduce horizontal overflow",
    );

    const accountMenuToggle = page.getByTestId("mobile-account-menu-toggle");
    await accountMenuToggle.click();
    const roleSwitchLink = page.getByRole("link", { name: "계정 전환" });
    await roleSwitchLink.waitFor({ timeout: 10000 });
    const roleSwitchHref = await roleSwitchLink.getAttribute("href");

    assert(
      roleSwitchHref?.includes("/select-role?next=%2Fapp%2Fclasses"),
      `mobile role switch link must preserve current route, got ${roleSwitchHref}`,
    );

    const mobileLogoutButton = page.getByRole("button", { name: "로그아웃" });
    await mobileLogoutButton.waitFor({ timeout: 10000 });
    const mobileLogoutBox = await mobileLogoutButton.boundingBox();

    assert(mobileLogoutBox, "mobile logout button must have a visible bounding box");
    assert(mobileLogoutBox.height >= 44, `mobile logout button height must be at least 44px, got ${mobileLogoutBox.height}`);
    assert(mobileLogoutBox.width >= 64, `mobile logout button width must be at least 64px, got ${mobileLogoutBox.width}`);
    await accountMenuToggle.click();
    assert.equal(await accountMenuToggle.getAttribute("aria-expanded"), "false", "mobile account menu must close after inspection");

    const mobileNav = page.getByTestId("mobile-bottom-navigation");
    await mobileNav.waitFor({ timeout: 10000 });
    const mobileNavBox = await mobileNav.boundingBox();
    const activeMobileNavLink = page.getByRole("link", { name: "수업/출석", current: "page" });
    const activeMobileNavBox = await activeMobileNavLink.boundingBox();
    const mobileNoticesNavLink = page.locator('nav[data-testid="mobile-bottom-navigation"] a[data-mobile-route-id="notices"]');
    await mobileNoticesNavLink.waitFor({ timeout: 10000 });
    const mobileRequestsNavLink = page.locator('nav[data-testid="mobile-bottom-navigation"] a[href="/app/requests"]');
    assert.equal(await mobileRequestsNavLink.count(), 0, "mobile bottom navigation must not expose deleted request routes");
    const notificationAlertBadgeCount = await page.getByTestId("notice-unread-badge").count();
    const mobileNoticeAriaLabelAfterBulkRead = (await mobileNoticesNavLink.getAttribute("aria-label")) ?? "";
    const mobileNavMetrics = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="mobile-bottom-navigation"]');
      const main = document.querySelector("main");
      const navStyle = nav ? window.getComputedStyle(nav) : null;
      const mainStyle = main ? window.getComputedStyle(main) : null;

      return {
        navPosition: navStyle?.position ?? "",
        navPaddingBottomStyle: nav?.getAttribute("style") ?? "",
        navZIndex: navStyle?.zIndex ?? "",
        mainPaddingBottom: Number.parseFloat(mainStyle?.paddingBottom ?? "0"),
      };
    });

    assert(mobileNavBox, "mobile bottom navigation must have a visible bounding box");
    assert(activeMobileNavBox, "active mobile nav link must have a visible bounding box");
    assert(notificationAlertBadgeCount <= 1, `global notification alert badge must not duplicate, got ${notificationAlertBadgeCount}`);
    assert(
      !mobileNoticeAriaLabelAfterBulkRead.includes("미확인 공지") && !mobileNoticeAriaLabelAfterBulkRead.includes("미읽음 공지"),
      "bulk read must not leave notice-only unread wording on the global notification badge",
    );
    assert.equal(mobileNavMetrics.navPosition, "fixed", "mobile bottom navigation must stay fixed");
    assert(
      mobileNavMetrics.navPaddingBottomStyle.includes("safe-area-inset-bottom"),
      "mobile bottom navigation must reserve bottom safe area",
    );
    assert(Number(mobileNavMetrics.navZIndex) >= 30, `mobile bottom navigation z-index must stay above content, got ${mobileNavMetrics.navZIndex}`);
    assert(activeMobileNavBox.height >= 48, `active mobile nav link height must be at least 48px, got ${activeMobileNavBox.height}`);
    assert(
      mobileNavMetrics.mainPaddingBottom >= mobileNavBox.height,
      `main bottom padding must keep content above mobile nav, got ${mobileNavMetrics.mainPaddingBottom}px for ${mobileNavBox.height}px nav`,
    );
    assert(
      Math.abs(mobileNavBox.y + mobileNavBox.height - 844) <= 2,
      `mobile bottom navigation must be anchored to viewport bottom, got y=${mobileNavBox.y} height=${mobileNavBox.height}`,
    );

    const attendanceProgress = page.getByTestId("attendance-progress-class-kids-am");
    const attendanceUnchecked = page.getByTestId("attendance-unchecked-class-kids-am");

    await attendanceProgress.waitFor({ timeout: 10000 });
    await attendanceUnchecked.waitFor({ timeout: 10000 });

	    const initialProgressValue = Number(await attendanceProgress.getAttribute("aria-valuenow"));
	    const initialProgressLabel = await attendanceProgress.getAttribute("aria-label");
    const initialUncheckedText = await attendanceUnchecked.textContent();
    const initialUncheckedLabel = await attendanceUnchecked.getAttribute("aria-label");

	    assert(
	      Number.isFinite(initialProgressValue) && initialProgressValue >= 0 && initialProgressValue <= 100,
	      `mobile attendance progress must expose a 0-100 aria value, got ${initialProgressValue}`,
	    );
	    assert.match(
	      initialProgressLabel ?? "",
	      /^.+ 출석 처리율 \d+%$/,
	      `mobile attendance progress must expose its class and percentage, got ${initialProgressLabel}`,
	    );
    assert(
      /^\d+(명)?$/.test(initialUncheckedText?.trim() ?? "") && /^미처리 \d+명$/.test(initialUncheckedLabel ?? ""),
      `mobile attendance unchecked count must expose a people count, got text=${initialUncheckedText} aria=${initialUncheckedLabel}`,
    );

    const uncheckedFilter = page.getByTestId("attendance-unchecked-filter");
    const kidsClassCard = page.locator("article").filter({ has: page.getByTestId("attendance-unchecked-class-kids-am") });
    const adultClassCard = page.locator("article").filter({ has: page.getByTestId("attendance-unchecked-class-adult-night") });
    const kidsRosterToggle = page.getByTestId("coach-class-roster-toggle-class-kids-am");
    const adultRosterToggle = page.getByTestId("coach-class-roster-toggle-class-adult-night");

    await kidsRosterToggle.waitFor({ timeout: 10000 });
    // 모바일에서는 첫 수업만 보이므로 접힌 수업 목록을 먼저 펼친다.
    const coachClassListToggle = page.getByTestId("coach-class-list-toggle");
    if ((await coachClassListToggle.count()) > 0 && (await coachClassListToggle.getAttribute("aria-expanded")) !== "true") {
      await coachClassListToggle.click();
    }
    await adultRosterToggle.waitFor({ timeout: 10000 });
    if ((await adultRosterToggle.getAttribute("aria-expanded")) !== "true") {
      await adultRosterToggle.click();
    }
    await page.getByTestId("coach-class-roster-panel-class-adult-night").waitFor({ timeout: 10000 });

    await adultClassCard.getByText("최민재").waitFor({ timeout: 10000 });
    await adultClassCard.getByText("오지호").waitFor({ timeout: 10000 });
    await uncheckedFilter.check();
    if ((await kidsRosterToggle.getAttribute("aria-expanded")) !== "true") {
      await kidsRosterToggle.click();
    }
    await adultClassCard.getByText("오지호").waitFor({ timeout: 10000 });
    await page.getByTestId("attendance-filter-empty-class-kids-am").waitFor({ timeout: 10000 });

    const filteredCoachRoster = await page.evaluate(() => {
      const adultCard = document.querySelector('[data-testid="attendance-unchecked-class-adult-night"]')?.closest("article");
      const filterLabel = document.querySelector('[data-testid="attendance-unchecked-filter"]')?.closest("label");
      const labelBox = filterLabel?.getBoundingClientRect();

      return {
        adultText: adultCard?.textContent ?? "",
        filterHeight: labelBox?.height ?? 0,
        filterWidth: labelBox?.width ?? 0,
      };
    });

    assert(filteredCoachRoster.adultText.includes("오지호"), "unchecked filter must keep unchecked roster members visible");
    assert(!filteredCoachRoster.adultText.includes("최민재"), "unchecked filter must hide already checked roster members");
    assert(
      filteredCoachRoster.filterHeight >= 40 && filteredCoachRoster.filterWidth >= 72,
      `unchecked filter must be a touchable control, got ${filteredCoachRoster.filterWidth}x${filteredCoachRoster.filterHeight}`,
    );

    await uncheckedFilter.uncheck();
    await adultClassCard.getByText("최민재").waitFor({ timeout: 10000 });

    const rosterSearch = page.getByTestId("attendance-roster-search");
    if ((await rosterSearch.count()) === 0 || !(await rosterSearch.isVisible())) {
      await page.getByTestId("attendance-roster-search-toggle").click();
    }
    await rosterSearch.waitFor({ timeout: 10000 });
    const rosterSearchBox = await rosterSearch.boundingBox();

    assert(rosterSearchBox, "mobile attendance roster search must have a visible bounding box");
    assert(
      rosterSearchBox.height >= 40 && rosterSearchBox.width >= 160,
      `mobile attendance roster search must be touchable, got ${rosterSearchBox.width}x${rosterSearchBox.height}`,
    );

    await rosterSearch.fill("오지호");
    await adultClassCard.getByText("오지호").waitFor({ timeout: 10000 });
    await page.getByTestId("attendance-filter-empty-class-kids-am").waitFor({ timeout: 10000 });

    const rosterSearchVerification = await page.evaluate(() => {
      const adultCard = document.querySelector('[data-testid="attendance-unchecked-class-adult-night"]')?.closest("article");
      const searchInput = document.querySelector('[data-testid="attendance-roster-search"]');
      const searchCount = document.querySelector('[data-testid="attendance-roster-search-count"]');

      return {
        adultText: adultCard?.textContent ?? "",
        searchValue: searchInput instanceof HTMLInputElement ? searchInput.value : "",
        searchCountText: searchCount?.textContent ?? "",
        hasSearchEmptyState: document.body.innerText.includes("검색 조건에 맞는 회원 없음"),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    assert.equal(rosterSearchVerification.searchValue, "오지호", "attendance roster search must keep the typed query");
    assert(rosterSearchVerification.searchCountText.includes("표시 1/"), "attendance roster search must show filtered count");
    assert(rosterSearchVerification.adultText.includes("오지호"), "attendance roster search must keep matching roster members visible");
    assert(!rosterSearchVerification.adultText.includes("최민재"), "attendance roster search must hide non-matching roster members");
    assert.equal(rosterSearchVerification.hasSearchEmptyState, true, "attendance roster search must show an empty state for non-matching classes");
    assert.equal(
      rosterSearchVerification.scrollWidth,
      rosterSearchVerification.clientWidth,
      "attendance roster search state must not overflow horizontally",
    );

	    const rosterSearchClear = page.getByTestId("attendance-roster-search-clear");
	    const rosterSearchClearBox = await rosterSearchClear.boundingBox();
	    assert(rosterSearchClearBox, "attendance roster search clear control must be visible after typing");
	    assert(
	      rosterSearchClearBox.height >= 44 && rosterSearchClearBox.width >= 44,
	      `attendance roster search clear control must keep a 44px touch target, got ${rosterSearchClearBox.width}x${rosterSearchClearBox.height}`,
	    );
	    await rosterSearchClear.click();
    await adultClassCard.getByText("최민재").waitFor({ timeout: 10000 });

    const lateStatusFilter = page.getByTestId("attendance-status-filter-late");
    await lateStatusFilter.waitFor({ timeout: 10000 });
    const lateStatusFilterBox = await lateStatusFilter.boundingBox();

    assert(lateStatusFilterBox, "mobile attendance status filter must have a visible bounding box");
    assert(
      lateStatusFilterBox.height >= 40 && lateStatusFilterBox.width >= 44,
      `mobile attendance status filter must be touchable, got ${lateStatusFilterBox.width}x${lateStatusFilterBox.height}`,
    );

    await lateStatusFilter.click();
    await kidsClassCard.getByText("이서").waitFor({ timeout: 10000 });
    await page.getByTestId("attendance-filter-empty-class-adult-night").waitFor({ timeout: 10000 });

    const statusFilterVerification = await page.evaluate(() => {
      const kidsCard = document.querySelector('[data-testid="attendance-unchecked-class-kids-am"]')?.closest("article");
      const adultCard = document.querySelector('[data-testid="attendance-unchecked-class-adult-night"]')?.closest("article");
      const lateFilter = document.querySelector('[data-testid="attendance-status-filter-late"]');
      const statusCount = document.querySelector('[data-testid="attendance-status-filter-count"]');

      return {
        kidsText: kidsCard?.textContent ?? "",
        adultText: adultCard?.textContent ?? "",
        latePressed: lateFilter?.getAttribute("aria-pressed") ?? "",
        statusCountText: statusCount?.textContent ?? "",
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    assert.equal(statusFilterVerification.latePressed, "true", "attendance status filter must expose the selected pressed state");
    assert(statusFilterVerification.statusCountText.includes("지각 1명"), "attendance status filter must show the selected status count");
    assert(statusFilterVerification.kidsText.includes("이서"), "attendance status filter must keep matching members visible");
    assert(!statusFilterVerification.kidsText.includes("이준"), "attendance status filter must hide non-matching members");
    assert(
      statusFilterVerification.adultText.includes("지각 상태 회원 없음"),
      "attendance status filter must show a status-specific empty state",
    );
    assert.equal(
      statusFilterVerification.scrollWidth,
      statusFilterVerification.clientWidth,
      "attendance status filter state must not overflow horizontally",
    );

    await page.getByTestId("attendance-status-filter-all").click();
    await kidsClassCard.getByText("이준").waitFor({ timeout: 10000 });

    await page.getByTestId("attendance-class-adult-night-member-jiho-absent").click();
    await page.waitForFunction(
      () => /사유 필요\s+2/.test(document.querySelector('[data-testid="coach-mobile-speed-reason-action"]')?.textContent ?? ""),
      null,
      { timeout: 10000 },
    );
    await coachSpeedReasonAction.click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="attendance-status-filter-count"]')?.textContent?.includes("사유 필요 2명"),
      null,
      { timeout: 10000 },
    );
    await kidsClassCard.getByText("이서").waitFor({ timeout: 10000 });
    await adultClassCard.getByText("오지호").waitFor({ timeout: 10000 });

    const reasonRequiredFilterVerification = await page.evaluate(() => {
      const kidsCard = document.querySelector('[data-testid="attendance-unchecked-class-kids-am"]')?.closest("article");
      const adultCard = document.querySelector('[data-testid="attendance-unchecked-class-adult-night"]')?.closest("article");
      const reasonAction = document.querySelector('[data-testid="coach-mobile-speed-reason-action"]');
      const lateFilter = document.querySelector('[data-testid="attendance-status-filter-late"]');
      const searchCount = document.querySelector('[data-testid="attendance-roster-search-count"]');
      const statusCount = document.querySelector('[data-testid="attendance-status-filter-count"]');

      return {
        adultText: adultCard?.textContent ?? "",
        kidsText: kidsCard?.textContent ?? "",
        latePressed: lateFilter?.getAttribute("aria-pressed") ?? "",
        reasonPressed: reasonAction?.getAttribute("aria-pressed") ?? "",
        searchCountText: searchCount?.textContent ?? "",
        statusCountText: statusCount?.textContent ?? "",
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    assert.equal(reasonRequiredFilterVerification.reasonPressed, "true", "coach reason quick action must expose pressed state");
    assert.equal(reasonRequiredFilterVerification.latePressed, "false", "coach reason quick action must not reuse a single late-status filter");
    assert(
      reasonRequiredFilterVerification.searchCountText.includes("사유 필요 2/2명"),
      "coach reason quick action must show all reason-required records in the roster count",
    );
    assert(
      reasonRequiredFilterVerification.statusCountText.includes("사유 필요 2명"),
      "coach reason quick action must show the reason-required count in filter metadata",
    );
    assert(reasonRequiredFilterVerification.kidsText.includes("이서"), "coach reason quick action must keep the late member visible");
    assert(!reasonRequiredFilterVerification.kidsText.includes("이준"), "coach reason quick action must hide members without missing reasons");
    assert(reasonRequiredFilterVerification.adultText.includes("오지호"), "coach reason quick action must include absent members with missing reasons");
    assert(!reasonRequiredFilterVerification.adultText.includes("최민재"), "coach reason quick action must hide members without missing reasons");
    assert.equal(
      reasonRequiredFilterVerification.scrollWidth,
      reasonRequiredFilterVerification.clientWidth,
      "coach reason quick action state must not overflow horizontally",
    );

    await coachSpeedResetAction.click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="coach-mobile-speed-reason-action"]')?.getAttribute("aria-pressed") === "false",
      null,
      { timeout: 10000 },
    );
    await kidsClassCard.getByText("이준").waitFor({ timeout: 10000 });

    const layoutBefore = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    assert.equal(layoutBefore.clientWidth, 390, "mobile viewport width must be 390px");
    assert.equal(layoutBefore.scrollWidth, layoutBefore.clientWidth, "classes screen must not overflow horizontally before attendance update");

    const wholeClassButtons = page.getByRole("button", { name: "전체 출석", exact: true });
    const wholeClassButtonCount = await wholeClassButtons.count();

    assert(wholeClassButtonCount > 0, "whole-class attendance buttons must render");

    const firstWholeClassButton = wholeClassButtons.first();
    const wholeClassButtonBox = await firstWholeClassButton.boundingBox();

    assert(wholeClassButtonBox, "whole-class attendance button must have a visible bounding box");
    assert(wholeClassButtonBox.height >= 44, `whole-class attendance button height must be at least 44px, got ${wholeClassButtonBox.height}`);

    attendanceFailureBudget = 1;
    await firstWholeClassButton.click();
    await page.waitForFunction(
      (queueKey) => {
        const sync = document.querySelector('[data-testid="attendance-sync-status-mobile"]');
        const queue = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");

        return sync?.getAttribute("data-attendance-sync-state") === "failed" && Array.isArray(queue) && queue.length > 1;
      },
      coachAttendanceQueueKey,
      { timeout: 10000 },
    );

    const batchFailureVerification = await page.evaluate(async (queueKey) => {
      const response = await fetch("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
      const payload = await response.json();
      const db = payload.data?.db;
      const session = db?.classes?.find((item) => item.id === "class-kids-am");
      const records = db?.attendance?.filter(
        (record) => record.sessionId === "class-kids-am" && session?.enrolledMemberIds?.includes(record.memberId),
      ) ?? [];
      const queue = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");

      return {
        enrolledCount: session?.enrolledMemberIds?.length ?? 0,
        serverPresentCount: records.filter((record) => record.status === "present").length,
        queuedCount: Array.isArray(queue)
          ? queue.filter((item) => item.sessionId === "class-kids-am" && item.status === "present").length
          : 0,
        localJunPresent:
          document.querySelector('[data-testid="attendance-class-kids-am-member-jun-present"]')?.getAttribute("aria-pressed") === "true",
        localSeoPresent:
          document.querySelector('[data-testid="attendance-class-kids-am-member-seo-present"]')?.getAttribute("aria-pressed") === "true",
        failureCopyVisible: document.body.innerText.includes("저장 실패") && document.body.innerText.includes("건 대기"),
      };
    }, coachAttendanceQueueKey);

    assert(
      batchFailureVerification.serverPresentCount < batchFailureVerification.enrolledCount,
      "failed whole-class attendance must not appear persisted in the server snapshot",
    );
    assert.equal(
      batchFailureVerification.queuedCount,
      batchFailureVerification.enrolledCount,
      "failed whole-class attendance must retain every member in the retry queue",
    );
    assert.equal(batchFailureVerification.localJunPresent, true, "failed whole-class attendance must keep the queued local state explicit");
    assert.equal(batchFailureVerification.localSeoPresent, true, "failed whole-class attendance must keep all queued members explicit");
    assert.equal(batchFailureVerification.failureCopyVisible, true, "failed whole-class attendance must show failure and pending copy");

    const batchRetryButton = page.getByTestId("attendance-retry-mobile");
    await batchRetryButton.waitFor({ timeout: 10000 });
    await batchRetryButton.click();
    await page.waitForFunction(
      () => {
        const junPresent = document.querySelector('[data-testid="attendance-class-kids-am-member-jun-present"]');
        const seoPresent = document.querySelector('[data-testid="attendance-class-kids-am-member-seo-present"]');
        const sync = document.querySelector('[data-testid="attendance-sync-status"]');

        return (
          junPresent?.getAttribute("aria-pressed") === "true" &&
          seoPresent?.getAttribute("aria-pressed") === "true" &&
          sync?.getAttribute("data-attendance-sync-state") === "saved"
        );
      },
      null,
      { timeout: 10000 },
    );
    await page.waitForFunction(() => document.querySelectorAll("button[aria-pressed]").length > 0, null, { timeout: 10000 });

    const bulkVerification = await page.evaluate(async () => {
      const response = await fetch("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
      const payload = await response.json();
      const db = payload.data?.db;
      const session = db?.classes?.find((item) => item.id === "class-kids-am");
      const records = db?.attendance?.filter(
        (record) => record.sessionId === "class-kids-am" && session?.enrolledMemberIds?.includes(record.memberId),
      ) ?? [];
      const auditLogs = db?.auditLogs?.filter(
        (log) => log.action === "attendance.update" && log.after?.status === "present" && log.targetType === "attendance",
      ) ?? [];

      return {
        enrolledCount: session?.enrolledMemberIds?.length ?? 0,
        presentCount: records.filter((record) => record.status === "present").length,
        auditCount: auditLogs.length,
      };
    });

    assert.equal(bulkVerification.presentCount, bulkVerification.enrolledCount, "whole-class attendance must mark every enrolled member present");
    assert(
      bulkVerification.auditCount >= bulkVerification.enrolledCount,
      "whole-class attendance must create audit logs for enrolled members",
    );

    const completedProgressValue = Number(await attendanceProgress.getAttribute("aria-valuenow"));
    const completedUncheckedText = await attendanceUnchecked.textContent();
    const completedUncheckedLabel = await attendanceUnchecked.getAttribute("aria-label");

    assert.equal(completedProgressValue, 100, `whole-class attendance must update mobile progress to 100%, got ${completedProgressValue}`);
    assert(
      completedUncheckedText?.trim() === "0" && completedUncheckedLabel === "미처리 0명",
      `whole-class attendance must clear mobile unchecked count, got text=${completedUncheckedText} aria=${completedUncheckedLabel}`,
    );
    await page.waitForFunction(() => document.querySelectorAll("button[aria-pressed]").length > 0, null, { timeout: 10000 });

    const firstAttendanceButton = page.getByTestId("attendance-class-kids-am-member-jun-present");
    const buttonCount = await firstAttendanceButton.count();

    assert.equal(buttonCount, 1, "target attendance status button must render");
    const buttonBox = await firstAttendanceButton.boundingBox();

    assert(buttonBox, "first attendance button must have a visible bounding box");
    assert(buttonBox.width >= 48, `attendance button width must be at least 48px, got ${buttonBox.width}`);
    assert(buttonBox.height >= 48, `attendance button height must be at least 48px, got ${buttonBox.height}`);

    const lateAttendanceButton = page.getByTestId("attendance-class-kids-am-member-jun-late");
    const noteToggle = page.getByTestId("attendance-note-toggle-class-kids-am-member-jun");
    await noteToggle.waitFor({ timeout: 10000 });
    const noteToggleBox = await noteToggle.boundingBox();

    assert(noteToggleBox, "attendance note toggle must have a visible bounding box");
    assert(noteToggleBox.height >= 40, `attendance note toggle must be touchable, got ${noteToggleBox.height}`);
    await noteToggle.click();

    const quickNotePreset = page.getByTestId("attendance-note-preset-class-kids-am-member-jun-late-arrival");
    await quickNotePreset.waitFor({ timeout: 10000 });
    const quickNotePresetBox = await quickNotePreset.boundingBox();

    await page.getByTestId("attendance-note-class-kids-am-member-jun").fill(note);
    assert(quickNotePresetBox, "attendance quick note preset must have a visible bounding box");
    assert(
      quickNotePresetBox.height >= 40 && quickNotePresetBox.width >= 64,
      `attendance quick note preset must be touchable, got ${quickNotePresetBox.width}x${quickNotePresetBox.height}`,
    );
    await quickNotePreset.click();
    const noteWithPreset = `${note} · 늦게 도착`;

    const quickNoteVerification = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="attendance-note-class-kids-am-member-jun"]');
      return {
        noteValue: input instanceof HTMLInputElement ? input.value : "",
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    assert.equal(quickNoteVerification.noteValue, noteWithPreset, "attendance quick note preset must append to the note input");
    assert.equal(
      quickNoteVerification.scrollWidth,
      quickNoteVerification.clientWidth,
      "attendance quick note presets must not overflow horizontally",
    );

    attendanceFailureBudget = 1;
    await lateAttendanceButton.click();
    await page.waitForFunction(
      (queueKey) => {
        const sync = document.querySelector('[data-testid="attendance-sync-status-mobile"]');
        const queue = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");

        return sync?.getAttribute("data-attendance-sync-state") === "failed" && Array.isArray(queue) && queue.length === 1;
      },
      coachAttendanceQueueKey,
      { timeout: 10000 },
    );

    const singleFailureVerification = await page.evaluate(async ({ expectedNote, queueKey }) => {
      const response = await fetch("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
      const payload = await response.json();
      const db = payload.data?.db;
      const queue = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");
      const serverAttendanceRecord = db?.attendance?.find(
        (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun",
      );

      return {
        serverHasFailedValue: serverAttendanceRecord?.status === "late" && serverAttendanceRecord?.note === expectedNote,
        queuedCount: Array.isArray(queue) ? queue.length : 0,
        localLatePressed:
          document.querySelector('[data-testid="attendance-class-kids-am-member-jun-late"]')?.getAttribute("aria-pressed") === "true",
        failureCopyVisible: document.body.innerText.includes("저장 실패") && document.body.innerText.includes("1건 대기"),
      };
    }, { expectedNote: noteWithPreset, queueKey: coachAttendanceQueueKey });

    assert.equal(singleFailureVerification.serverHasFailedValue, false, "failed single attendance must not look persisted on the server");
    assert.equal(singleFailureVerification.queuedCount, 1, "failed single attendance must remain in the retry queue");
    assert.equal(singleFailureVerification.localLatePressed, true, "failed single attendance must keep its queued local value explicit");
    assert.equal(singleFailureVerification.failureCopyVisible, true, "failed single attendance must show failure and pending copy");

    const singleRetryButton = page.getByTestId("attendance-retry-mobile");
    await singleRetryButton.waitFor({ timeout: 10000 });
    const singleRetryButtonBox = await singleRetryButton.boundingBox();
    assert(singleRetryButtonBox, "failed single attendance retry action must be visible");
    assert(singleRetryButtonBox.height >= 44, `failed single attendance retry action must be 44px high, got ${singleRetryButtonBox.height}`);
    await singleRetryButton.click();
    let verification = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      verification = await page.evaluate(async (expectedNote) => {
        const response = await fetch("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
        const payload = await response.json();
        const db = payload.data?.db;
        const attendanceRecord = db?.attendance?.find(
          (record) =>
            record.sessionId === "class-kids-am" &&
            record.memberId === "member-jun" &&
            record.status === "late" &&
            record.note === expectedNote,
        );
        const auditLog = db?.auditLogs?.find(
          (log) => log.action === "attendance.update" && log.after?.note === expectedNote && log.targetType === "attendance",
        );

        return {
          attendanceSaved: Boolean(attendanceRecord),
          auditLogged: Boolean(auditLog),
          paymentCount: db?.payments?.length ?? 0,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      }, noteWithPreset);

      if (verification.attendanceSaved && verification.auditLogged) {
        break;
      }

      await page.waitForTimeout(500);
    }

    assert.equal(verification.attendanceSaved, true, "attendance update must persist through server API");
    assert.equal(verification.auditLogged, true, "attendance update must create an audit log");
    assert.equal(verification.paymentCount, 0, "coach bootstrap must not include payment records");
    assert.equal(verification.scrollWidth, verification.clientWidth, "classes screen must not overflow horizontally after attendance update");

    const undoAttendanceButton = page.getByTestId("attendance-undo-last-mobile");
    await undoAttendanceButton.waitFor({ timeout: 10000 });
    const undoAttendanceButtonBox = await undoAttendanceButton.boundingBox();

    assert(undoAttendanceButtonBox, "mobile attendance undo button must have a visible bounding box");
    assert(
      undoAttendanceButtonBox.height >= 40 && undoAttendanceButtonBox.width >= 160,
      `mobile attendance undo button must be touchable, got ${undoAttendanceButtonBox.width}x${undoAttendanceButtonBox.height}`,
    );

    await undoAttendanceButton.click();

    let undoVerification = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      undoVerification = await page.evaluate(async () => {
        const response = await fetch("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
        const payload = await response.json();
        const db = payload.data?.db;
        const attendanceRecord = db?.attendance?.find(
          (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun",
        );
        const undoAuditLog = db?.auditLogs?.find(
          (log) =>
            log.action === "attendance.update" &&
            log.targetType === "attendance" &&
            log.after?.status === "present" &&
            log.before?.status === "late",
        );

        return {
          status: attendanceRecord?.status ?? null,
          auditLogged: Boolean(undoAuditLog),
          undoPanelVisible: Boolean(document.querySelector('[data-testid="attendance-undo-last-mobile"]')),
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });

      if (undoVerification.status === "present" && undoVerification.auditLogged && !undoVerification.undoPanelVisible) {
        break;
      }

      await page.waitForTimeout(500);
    }

    assert.equal(undoVerification.status, "present", "attendance undo must restore the previous status");
    assert.equal(undoVerification.auditLogged, true, "attendance undo must create an audit log");
    assert.equal(undoVerification.undoPanelVisible, false, "attendance undo panel must clear after undo");
    assert.equal(undoVerification.scrollWidth, undoVerification.clientWidth, "attendance undo state must not overflow horizontally");

    await page.evaluate(() => window.localStorage.setItem("final-judo-force-offline", "1"));
    const offlineNoteInput = page.getByTestId("attendance-note-class-kids-am-member-jun");
    if ((await offlineNoteInput.count()) === 0 || !(await offlineNoteInput.isVisible())) {
      await page.getByTestId("attendance-note-toggle-class-kids-am-member-jun").click();
    }
    await offlineNoteInput.fill(offlineNote);
    await firstAttendanceButton.click();
    await page.waitForFunction(
      () => document.body.innerText.includes("저장 대기") && document.body.innerText.includes("대기 1건"),
      null,
      { timeout: 10000 },
    );
    await page.reload({ waitUntil: "load" });
    await mainContent.getByRole("heading", { name: "수업/출석" }).waitFor({ timeout: 10000 });
    await page.waitForFunction(
      () => document.body.innerText.includes("저장 대기") && document.body.innerText.includes("대기 1건"),
      null,
      { timeout: 10000 },
    );

    const queuedBeforeSync = await page.evaluate(async ({ expectedNote, queueKey }) => {
      const response = await fetch("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
      const payload = await response.json();
      const db = payload.data?.db;
      const queue = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");
      const serverAttendanceRecord = db?.attendance?.find(
        (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun" && record.note === expectedNote,
      );
      const serverAuditLog = db?.auditLogs?.find(
        (log) => log.action === "attendance.update" && log.after?.note === expectedNote && log.targetType === "attendance",
      );

      return {
        persistedQueueCount: Array.isArray(queue) ? queue.length : 0,
        serverAttendanceSaved: Boolean(serverAttendanceRecord),
        serverAuditLogged: Boolean(serverAuditLog),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    }, { expectedNote: offlineNote, queueKey: coachAttendanceQueueKey });

    assert.equal(queuedBeforeSync.persistedQueueCount, 1, "offline attendance queue must survive a page reload");
    assert.equal(queuedBeforeSync.serverAttendanceSaved, false, "offline attendance must remain client queued before retry");
    assert.equal(queuedBeforeSync.serverAuditLogged, false, "offline attendance must not create audit log before retry");
    assert.equal(queuedBeforeSync.scrollWidth, queuedBeforeSync.clientWidth, "offline queue state must not overflow horizontally");

    await loginWithRoleShortcut(page, "guardian");
    await page.getByRole("main").getByRole("heading").first().waitFor({ timeout: 10000 });
    const guardianUserId = await getCurrentUserId(page);

    assert(guardianUserId, "account switch must expose the guardian user id");
    const guardianAttendanceQueueKey = getAttendanceQueueKey(guardianUserId);
    const guardianIsolation = await page.evaluate(({ coachQueueKey, guardianQueueKey }) => {
      const coachQueue = JSON.parse(window.localStorage.getItem(coachQueueKey) ?? "[]");
      const guardianQueue = JSON.parse(window.localStorage.getItem(guardianQueueKey) ?? "[]");

      return {
        coachQueueCount: Array.isArray(coachQueue) ? coachQueue.length : 0,
        guardianQueueCount: Array.isArray(guardianQueue) ? guardianQueue.length : 0,
        hasCoachPendingCopy: document.body.innerText.includes("대기 1건"),
      };
    }, { coachQueueKey: coachAttendanceQueueKey, guardianQueueKey: guardianAttendanceQueueKey });

    assert.equal(guardianIsolation.coachQueueCount, 1, "account switch must preserve the previous coach queue");
    assert.equal(guardianIsolation.guardianQueueCount, 0, "account switch must not copy a coach queue into the guardian account");
    assert.equal(guardianIsolation.hasCoachPendingCopy, false, "another account must not render the coach pending attendance state");

    await page.getByTestId("mobile-account-menu-toggle").click();
    await page.getByTestId("mobile-session-logout-button").click();
    await page.waitForURL("**/login?next=**", { timeout: 10000 });
    assert.equal(
      await page.getByTestId("attendance-logout-warning-dialog").count(),
      0,
      "an account without queued attendance must log out without seeing another user's warning",
    );

    await loginWithCredentials(page, coachPhone);
    await page.goto(`${baseUrl}/app/classes`, { waitUntil: "load" });
    await page.getByRole("main").getByRole("heading", { name: "수업/출석" }).waitFor({ timeout: 10000 });
    await page.waitForFunction(
      () => document.body.innerText.includes("저장되지 않은 출석 1건을 복구했습니다.") && document.body.innerText.includes("대기 1건"),
      null,
      { timeout: 10000 },
    );

    await page.getByTestId("mobile-account-menu-toggle").click();
    await page.getByTestId("mobile-session-logout-button").click();
    const logoutWarningDialog = page.getByTestId("attendance-logout-warning-dialog");
    await logoutWarningDialog.waitFor({ timeout: 10000 });
    await logoutWarningDialog.getByText("저장 대기 출석이 있습니다", { exact: true }).waitFor({ timeout: 10000 });
    await logoutWarningDialog.getByText(/출석 1건/).waitFor({ timeout: 10000 });

    for (const actionTestId of ["attendance-sync-before-logout", "attendance-preserve-and-logout"]) {
      const actionBox = await page.getByTestId(actionTestId).boundingBox();

      assert(actionBox, `${actionTestId} must have a visible bounding box`);
      assert(actionBox.height >= 44, `${actionTestId} must keep a 44px touch target, got ${actionBox.height}`);
    }

    await page.screenshot({ path: "/tmp/final-judo-attendance-logout-warning-mobile.png", fullPage: false });
    await page.getByTestId("attendance-sync-before-logout").click();
    await logoutWarningDialog.getByRole("alert").waitFor({ timeout: 10000 });
    assert.equal(await logoutWarningDialog.isVisible(), true, "failed pre-logout sync must keep the safe-choice dialog open");

    await page.getByTestId("attendance-preserve-and-logout").click();
    await page.waitForURL("**/login?next=**", { timeout: 10000 });
    const preservedAfterLogout = await page.evaluate((queueKey) => {
      const queue = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");

      return Array.isArray(queue) ? queue.length : 0;
    }, coachAttendanceQueueKey);

    assert.equal(preservedAfterLogout, 1, "explicit preserve logout must retain the current user's queue");

    await loginWithCredentials(page, coachPhone);
    await page.goto(`${baseUrl}/app/classes`, { waitUntil: "load" });
    await page.getByRole("main").getByRole("heading", { name: "수업/출석" }).waitFor({ timeout: 10000 });
    await page.waitForFunction(
      () => document.body.innerText.includes("저장되지 않은 출석 1건을 복구했습니다.") && document.body.innerText.includes("대기 1건"),
      null,
      { timeout: 10000 },
    );

    await page.evaluate(() => window.localStorage.removeItem("final-judo-force-offline"));
    await page.getByRole("button", { name: /대기 출석 (저장 )?재시도/ }).last().click();
    await page.waitForFunction(
      () => document.body.innerText.includes("대기 출석 1건을 다시 저장했습니다.") || document.body.innerText.includes("저장됨"),
      null,
      { timeout: 10000 },
    );

    const offlineVerification = await page.evaluate(async ({ expectedNote, queueKey }) => {
      const response = await fetch("/api/v1/me/bootstrap?selectedBranchId=branch-gangnam");
      const payload = await response.json();
      const db = payload.data?.db;
      const queue = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");
      const attendanceRecord = db?.attendance?.find(
        (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun" && record.note === expectedNote,
      );
      const auditLog = db?.auditLogs?.find(
        (log) => log.action === "attendance.update" && log.after?.note === expectedNote && log.targetType === "attendance",
      );

      return {
        attendanceSaved: Boolean(attendanceRecord),
        auditLogged: Boolean(auditLog),
        hasPendingText: document.body.innerText.includes("대기 1건"),
        persistedQueueCount: Array.isArray(queue) ? queue.length : 0,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    }, { expectedNote: offlineNote, queueKey: coachAttendanceQueueKey });

    assert.equal(offlineVerification.attendanceSaved, true, "retry sync must persist queued offline attendance");
    assert.equal(offlineVerification.auditLogged, true, "retry sync must create attendance audit log");
    assert.equal(offlineVerification.hasPendingText, false, "retry sync must clear pending attendance count");
    assert.equal(offlineVerification.persistedQueueCount, 0, "retry sync must clear persisted attendance queue");
    assert.equal(offlineVerification.scrollWidth, offlineVerification.clientWidth, "synced attendance state must not overflow horizontally");
  } finally {
    await page.evaluate(() => window.localStorage.removeItem("final-judo-force-offline")).catch(() => undefined);
    await context.close();
    await browser.close();
  }
}

async function main() {
  await resetDemoData("before");

  try {
    await run();
  } finally {
    await resetDemoData("after");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        viewport: "390x844",
        checked: [
          "coach credential UI login",
          "credential login form submit",
          "member mobile priority dashboard panel",
          "guardian mobile priority dashboard panel",
          "member/guardian mobile dashboard without CSV export wording",
          "coach dashboard follow-up instead of payment warning",
          "mobile classes route render",
          "no horizontal overflow",
        "mobile account menu",
          "mobile role switch action",
          "mobile logout action",
          "coach mobile speed panel",
          "coach mobile speed quick filters",
          "coach mobile attention and counseling summary",
          "mobile top notice unread badge",
          "mobile notice unread and important filters",
          "coach notice reader without operations queue",
          "mobile notice filtered bulk read",
          "mobile bottom navigation safe area",
          "mobile active nav aria-current",
          "mobile attendance progress summary",
          "mobile attendance unchecked count",
          "mobile unchecked-only attendance filter",
          "mobile attendance roster search",
          "mobile attendance status filter",
          "mobile attendance quick note presets",
          "attendance button 48px touch target",
          "sticky save state",
          "whole-class attendance button",
          "whole-class attendance progress update",
          "whole-class attendance failure retry queue",
          "whole-class attendance persistence",
          "single attendance failure retry queue",
          "attendance persistence",
          "mobile attendance undo last change",
          "attendance audit log",
          "offline attendance queue",
          "offline queue reload recovery",
          "attendance queue account isolation",
          "attendance queue logout warning",
          "attendance queue logout preservation",
          "attendance queue same-user login recovery",
          "pending attendance retry sync",
          "coach payment redaction",
          "demo data reset",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
