import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { chromium } from "playwright-core";
import { createMockData } from "../src/lib/mock-data.ts";
import {
  canMutateTournament,
  getTournamentCreateAccess,
  resolveTournamentAccess,
} from "../src/lib/tournament-policy.ts";

const nextBin = "node_modules/next/dist/bin/next";
const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address?.port
        ? resolve(address.port)
        : reject(new Error("Could not allocate a tournament test port.")));
    });
  });
}

async function waitForServer(baseUrl, child, timeoutMs = 45_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error("Tournament test server exited before it became reachable.");
    }

    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Wait for the isolated server to bind its port.
    }

    await sleep(300);
  }

  throw new Error(`Timed out waiting for ${baseUrl}.`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;

  if (process.platform === "win32") child.kill("SIGTERM");
  else process.kill(-child.pid, "SIGTERM");

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5_000).then(() => {
      if (child.exitCode === null) {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      }
    }),
  ]);
}

async function apiRequest(baseUrl, pathName, { body, method = "POST", userId } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, payload: await response.json() };
}

async function readDb(dbFile) {
  return JSON.parse(await readFile(dbFile, "utf8"));
}

const payload = {
  title: "2026 권한 검증 대회",
  organizer: "대한유도회",
  eventDate: "2026-12-12",
};

async function main() {
  const legacyTournament = {
    id: "tournament-legacy-global",
    title: "레거시 전역 대회",
    organizer: "대한유도회",
    eventDate: "2026-10-10",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  assert.deepEqual(
    resolveTournamentAccess(legacyTournament),
    { scope: "global", branchId: null, createdByUserId: null },
    "legacy records must remain global and ownerless",
  );
  assert.equal(
    canMutateTournament({ id: "owner", role: "owner" }, legacyTournament, ["branch-gangnam"]),
    false,
    "legacy global records must be admin-managed only",
  );
  assert.deepEqual(
    getTournamentCreateAccess({ id: "admin", role: "admin" }, null, ["branch-gangnam"]),
    { ok: true, scope: "global", branchId: null },
    "admin all-branch creation must create a global tournament",
  );

  const tempRoot = path.join(process.cwd(), ".data", "test-runs");
  await mkdir(tempRoot, { recursive: true });
  const tempDir = await mkdtemp(path.join(tempRoot, "tournament-access-"));
  const dbFile = path.join(tempDir, "final-judo-db.json");
  const stamp = `${process.pid}-${Date.now()}`;
  const distDir = `.next-tournament-access-${stamp}`;
  const tsconfigPath = `.tsconfig.tournament-access-${stamp}.json`;
  const db = createMockData();
  db.users.push(
    {
      id: "user-owner-gangnam",
      name: "강남 대표",
      role: "owner",
      title: "대표",
      branchIds: ["branch-gangnam"],
    },
    {
      id: "user-coach-other",
      name: "다른 코치",
      role: "coach",
      title: "코치",
      branchIds: ["branch-gangnam"],
    },
    {
      id: "user-coach-stale",
      name: "이전 지점 코치",
      role: "coach",
      title: "코치",
      branchIds: ["branch-removed"],
    },
  );
  db.tournaments = [
    legacyTournament,
    {
      id: "tournament-global",
      scope: "global",
      branchId: null,
      title: "관리자 전역 대회",
      organizer: "대한유도회",
      eventDate: "2026-11-01",
      createdByUserId: "user-admin",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "tournament-owner-gangnam",
      scope: "branch",
      branchId: "branch-gangnam",
      title: "강남 대표 대회",
      organizer: "대한유도회",
      eventDate: "2026-11-02",
      createdByUserId: "user-owner-gangnam",
      createdAt: "2026-01-03T00:00:00.000Z",
    },
    {
      id: "tournament-coach-gangnam",
      scope: "branch",
      branchId: "branch-gangnam",
      title: "코치 작성 대회",
      organizer: "대한유도회",
      eventDate: "2026-11-03",
      createdByUserId: "user-coach",
      createdAt: "2026-01-04T00:00:00.000Z",
    },
    {
      id: "tournament-coach-ui",
      scope: "branch",
      branchId: "branch-gangnam",
      title: "삭제 확인 UI 대회",
      organizer: "대한유도회",
      eventDate: "2026-11-04",
      createdByUserId: "user-coach",
      createdAt: "2026-01-05T00:00:00.000Z",
    },
    {
      id: "tournament-other-coach",
      scope: "branch",
      branchId: "branch-gangnam",
      title: "다른 코치 대회",
      organizer: "대한유도회",
      eventDate: "2026-11-05",
      createdByUserId: "user-coach-other",
      createdAt: "2026-01-06T00:00:00.000Z",
    },
    {
      id: "tournament-owner-songpa",
      scope: "branch",
      branchId: "branch-songpa",
      title: "송파 대표 대회",
      organizer: "대한유도회",
      eventDate: "2026-11-06",
      createdByUserId: "user-owner",
      createdAt: "2026-01-07T00:00:00.000Z",
    },
  ];

  await Promise.all([
    writeFile(dbFile, `${JSON.stringify(db, null, 2)}\n`, "utf8"),
    writeFile(tsconfigPath, `${JSON.stringify({
      extends: "./tsconfig.json",
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", `${distDir}/types/**/*.ts`, `${distDir}/dev/types/**/*.ts`],
    }, null, 2)}\n`, "utf8"),
  ]);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [nextBin, "dev", "--webpack", "--port", String(port), "--hostname", "127.0.0.1"], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      FINAL_JUDO_DB_DRIVER: "json",
      FINAL_JUDO_NEXT_DIST_DIR: distDir,
      FINAL_JUDO_NEXT_TSCONFIG_PATH: tsconfigPath,
      PILOT_DB_FILE: dbFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  let browser;

  try {
    await waitForServer(baseUrl, child);

    let result = await apiRequest(baseUrl, "/api/v1/tournaments?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      body: payload,
    });
    assert.equal(result.response.status, 403, "members must not create tournaments");

    result = await apiRequest(baseUrl, "/api/v1/tournaments?selectedBranchId=branch-songpa", {
      userId: "user-coach",
      body: payload,
    });
    assert.equal(result.response.status, 403, "coaches must not create in an unassigned branch");

    result = await apiRequest(baseUrl, "/api/v1/tournaments?selectedBranchId=branch-removed", {
      userId: "user-coach-stale",
      body: payload,
    });
    assert.equal(result.response.status, 403, "stale user branch assignments must not create tournaments");

    result = await apiRequest(baseUrl, "/api/v1/tournaments", { userId: "user-coach", body: payload });
    assert.equal(result.response.status, 400, "coaches must select a branch before creation");

    result = await apiRequest(baseUrl, "/api/v1/tournaments?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      body: payload,
    });
    assert.equal(result.response.status, 200, "coaches must create in an assigned branch");
    assert(result.payload.data.db.tournaments.every((item) => item.branchId !== "branch-songpa"), "coach snapshot must exclude other branches");
    const createdCoachTournament = result.payload.data.db.tournaments.find((item) => item.title === payload.title);
    assert.equal(createdCoachTournament.scope, "branch");
    assert.equal(createdCoachTournament.branchId, "branch-gangnam");
    assert.equal(createdCoachTournament.createdByUserId, "user-coach");

    result = await apiRequest(baseUrl, `/api/v1/tournaments/${createdCoachTournament.id}?selectedBranchId=branch-gangnam`, {
      userId: "user-coach",
      method: "PATCH",
      body: { title: "코치 수정 대회" },
    });
    assert.equal(result.response.status, 200, "coaches must update their own branch tournament");

    for (const targetId of ["tournament-owner-gangnam", "tournament-other-coach", "tournament-global"]) {
      result = await apiRequest(baseUrl, `/api/v1/tournaments/${targetId}?selectedBranchId=branch-gangnam`, {
        userId: "user-coach",
        method: "DELETE",
      });
      assert.equal(result.response.status, 403, `coach must not delete ${targetId}`);
    }

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-other-coach?selectedBranchId=branch-gangnam", {
      userId: "user-owner-gangnam",
      method: "PATCH",
      body: { title: "대표가 수정한 대회" },
    });
    assert.equal(result.response.status, 200, "owners must manage any author in an accessible branch");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-owner-songpa?selectedBranchId=branch-gangnam", {
      userId: "user-owner-gangnam",
      method: "DELETE",
    });
    assert.equal(result.response.status, 403, "owners must not manage an inaccessible branch");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global?selectedBranchId=branch-gangnam", {
      userId: "user-owner-gangnam",
      method: "PATCH",
      body: { title: "대표 전역 변경 시도" },
    });
    assert.equal(result.response.status, 403, "owners must not mutate global tournaments");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-legacy-global", {
      userId: "user-admin",
      method: "PATCH",
      body: { title: "관리자가 정규화한 레거시 대회" },
    });
    assert.equal(result.response.status, 200, "admins must manage legacy global tournaments");

    result = await apiRequest(baseUrl, "/api/v1/tournaments", { userId: "user-admin", body: { ...payload, title: "신규 전역 대회" } });
    assert.equal(result.response.status, 200, "admins must create global tournaments in all-branch scope");

    result = await apiRequest(baseUrl, "/api/v1/tournaments?selectedBranchId=branch-songpa", {
      userId: "user-admin",
      body: { ...payload, title: "신규 송파 대회" },
    });
    assert.equal(result.response.status, 200, "admins must create branch tournaments in selected scope");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-owner-songpa?selectedBranchId=branch-songpa", {
      userId: "user-admin",
      method: "DELETE",
    });
    assert.equal(result.response.status, 200, "admins must delete tournaments across accessible branches");

    const persisted = await readDb(dbFile);
    const normalizedLegacy = persisted.tournaments.find((item) => item.id === "tournament-legacy-global");
    assert.equal(normalizedLegacy.scope, "global", "an edited legacy record must persist its conservative scope");
    assert.equal(normalizedLegacy.branchId, null, "an edited legacy global record must persist null branchId");
    const tournamentAudits = persisted.auditLogs.filter((log) => log.targetType === "tournament");
    const coachCreateAudit = tournamentAudits.find((log) => log.action === "tournament.create" && log.targetId === createdCoachTournament.id);
    const coachUpdateAudit = tournamentAudits.find((log) => log.action === "tournament.update" && log.targetId === createdCoachTournament.id);
    const globalCreateAudit = tournamentAudits.find((log) => log.action === "tournament.create" && log.after?.title === "신규 전역 대회");
    const songpaCreateAudit = tournamentAudits.find((log) => log.action === "tournament.create" && log.after?.title === "신규 송파 대회");
    const songpaDeleteAudit = tournamentAudits.find(
      (log) => log.action === "tournament.delete" && log.targetId === "tournament-owner-songpa",
    );
    assert.equal(coachCreateAudit?.branchId, "branch-gangnam", "branch create audit must use resource branchId");
    assert.equal(coachUpdateAudit?.branchId, "branch-gangnam", "branch update audit must use resource branchId");
    assert.equal(globalCreateAudit?.branchId, null, "global create audit must keep null branchId");
    assert.equal(songpaCreateAudit?.branchId, "branch-songpa", "admin branch create audit must use selected branchId");
    assert.equal(songpaDeleteAudit?.branchId, "branch-songpa", "admin branch delete audit must use the resource branchId");

    const executablePath = chromeCandidates.find(existsSync);
    assert(executablePath, "Chrome is required for tournament mobile deletion verification");
    browser = await chromium.launch({ executablePath, headless: true });
    const browserContext = await browser.newContext({
      extraHTTPHeaders: { "x-user-id": "user-coach" },
      viewport: { width: 390, height: 844 },
    });
    const page = await browserContext.newPage();
    await page.goto(`${baseUrl}/app/tournaments`, { waitUntil: "networkidle" });
    const deleteButton = page.getByTestId("tournament-delete-tournament-coach-ui");
    await deleteButton.waitFor({ state: "visible" });
    const deleteBox = await deleteButton.boundingBox();
    assert(deleteBox && deleteBox.height >= 44, "mobile delete trigger must be at least 44px high");

    await deleteButton.click();
    const confirmation = page.getByTestId("tournament-delete-confirmation-tournament-coach-ui");
    await confirmation.waitFor({ state: "visible" });
    const cancelButton = page.getByTestId("tournament-delete-cancel-tournament-coach-ui");
    const confirmButton = page.getByTestId("tournament-delete-confirm-tournament-coach-ui");
    for (const button of [cancelButton, confirmButton]) {
      const box = await button.boundingBox();
      assert(box && box.height >= 44, "mobile deletion decision controls must be at least 44px high");
    }
    await cancelButton.click();
    await confirmation.waitFor({ state: "hidden" });
    assert((await readDb(dbFile)).tournaments.some((item) => item.id === "tournament-coach-ui"), "cancel must preserve tournament");

    await deleteButton.click();
    await confirmButton.click();
    await page.getByText("대회 공지를 삭제했습니다.").waitFor({ state: "visible" });
    const afterConfirmedDelete = await readDb(dbFile);
    assert(!afterConfirmedDelete.tournaments.some((item) => item.id === "tournament-coach-ui"), "confirm must delete tournament");
    assert.equal(
      afterConfirmedDelete.auditLogs.find(
        (log) => log.action === "tournament.delete" && log.targetId === "tournament-coach-ui",
      )?.branchId,
      "branch-gangnam",
      "confirmed branch deletion audit must use the resource branchId",
    );
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(layout.scrollWidth <= layout.clientWidth, "390px tournament screen must not overflow horizontally");
    await browserContext.close();

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "role x branch x author mutation matrix",
        "legacy global compatibility",
        "global and branch creation scope",
        "server-side snapshot visibility",
        "resource branchId audit accuracy",
        "390px delete cancel and confirm",
        "44px deletion touch targets",
      ],
    }, null, 2));
  } catch (error) {
    if (output.length > 0) console.error(output.join(""));
    throw error;
  } finally {
    await browser?.close();
    await stopServer(child);
    await Promise.all([
      rm(tempDir, { force: true, recursive: true }),
      rm(distDir, { force: true, recursive: true }),
      rm(tsconfigPath, { force: true }),
    ]);
  }
}

await main();
