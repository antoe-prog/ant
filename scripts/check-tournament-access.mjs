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
  createFamilySafeTournament,
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

const familySafeTournament = createFamilySafeTournament(
  {
    id: "tournament-family-safe",
    scope: "global",
    title: "가족 공개 대회",
    organizer: "대한유도회",
    eventDate: "2026-08-01",
    createdByUserId: "user-admin",
    createdAt: "2026-07-01T00:00:00.000Z",
    registrations: [
      {
        id: "registration-family-safe",
        memberId: "member-jun",
        division: "중등부",
        weightClass: "-55kg",
        status: "confirmed",
        appliedByUserId: "user-guardian",
        appliedAt: "2026-07-02T00:00:00.000Z",
        reviewedByUserId: "user-coach",
      },
      {
        id: "registration-other-family",
        memberId: "member-seo",
        division: "중등부",
        weightClass: "-60kg",
        status: "pending",
        appliedByUserId: "user-other-guardian",
        appliedAt: "2026-07-02T00:00:00.000Z",
      },
    ],
  },
  ["member-jun"],
);
assert.equal(familySafeTournament.createdByUserId, undefined, "family tournaments must hide the internal creator ID");
assert.deepEqual(
  familySafeTournament.registrations?.map(({ appliedByUserId, memberId, reviewedByUserId }) => ({
    appliedByUserId,
    memberId,
    reviewedByUserId,
  })),
  [{ appliedByUserId: "", memberId: "member-jun", reviewedByUserId: undefined }],
  "family tournaments must keep only authorized registrations and remove operator identities",
);

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

    const tournamentCountBeforeInvalidCreate = (await readDb(dbFile)).tournaments.length;
    result = await apiRequest(baseUrl, "/api/v1/tournaments?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      body: { ...payload, title: { value: "잘못된 대회명" } },
    });
    assert.equal(result.response.status, 400, "object-valued tournament fields must be rejected without a server error");

    result = await apiRequest(baseUrl, "/api/v1/tournaments?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      body: { ...payload, eventDate: "2026-02-30" },
    });
    assert.equal(result.response.status, 400, "impossible tournament calendar dates must be rejected");
    assert.equal(
      (await readDb(dbFile)).tournaments.length,
      tournamentCountBeforeInvalidCreate,
      "invalid tournament creates must not mutate persisted state",
    );

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

    const concurrentCreateTitles = ["동시 등록 대회 A", "동시 등록 대회 B"];
    const concurrentCreateResults = await Promise.all(
      concurrentCreateTitles.map((title) =>
        apiRequest(baseUrl, "/api/v1/tournaments?selectedBranchId=branch-gangnam", {
          userId: "user-coach",
          body: { ...payload, title },
        }),
      ),
    );
    assert.deepEqual(
      concurrentCreateResults.map(({ response }) => response.status),
      [200, 200],
      "concurrent tournament creates must both succeed",
    );

    result = await apiRequest(baseUrl, `/api/v1/tournaments/${createdCoachTournament.id}?selectedBranchId=branch-gangnam`, {
      userId: "user-coach",
      method: "PATCH",
      body: { unsupported: "ignored before" },
    });
    assert.equal(result.response.status, 400, "tournament patches without a supported field must be rejected");

    const concurrentPatchResults = await Promise.all([
      apiRequest(baseUrl, `/api/v1/tournaments/${createdCoachTournament.id}?selectedBranchId=branch-gangnam`, {
        userId: "user-coach",
        method: "PATCH",
        body: { title: "동시 수정 대회" },
      }),
      apiRequest(baseUrl, `/api/v1/tournaments/${createdCoachTournament.id}?selectedBranchId=branch-gangnam`, {
        userId: "user-coach",
        method: "PATCH",
        body: { location: "동시성 검증 체육관" },
      }),
    ]);
    assert.deepEqual(
      concurrentPatchResults.map(({ response }) => response.status),
      [200, 200],
      "concurrent tournament patches must both succeed",
    );
    const tournamentAfterConcurrentPatch = (await readDb(dbFile)).tournaments.find(
      (item) => item.id === createdCoachTournament.id,
    );
    assert.equal(tournamentAfterConcurrentPatch.title, "동시 수정 대회", "concurrent title update must persist");
    assert.equal(
      tournamentAfterConcurrentPatch.location,
      "동시성 검증 체육관",
      "concurrent location update must preserve the other patch",
    );

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

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      body: { memberId: "member-jun", division: "중등부", weightClass: "-55kg" },
    });
    assert.equal(result.response.status, 403, "staff accounts must not submit family tournament registrations");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      body: { memberId: "member-jun", division: "중등부", weightClass: "-55kg" },
    });
    assert.equal(result.response.status, 404, "members must not register another family's member");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      body: { memberId: "member-minjae", division: "임의 종별", weightClass: "-73kg" },
    });
    assert.equal(result.response.status, 400, "registration must reject unsupported divisions");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      body: { memberId: "member-minjae", division: "일반부", weightClass: "" },
    });
    assert.equal(result.response.status, 400, "registration must require a weight class");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-guardian",
      body: { memberId: "member-jun", division: "중등부", weightClass: "-55kg" },
    });
    assert.equal(result.response.status, 200, "guardians must register a linked child");
    assert.equal(result.payload.data.registration.status, "applied");
    assert.equal(result.payload.data.registration.operation, "apply");
    assert.equal(
      result.payload.data.db.tournaments
        .find((item) => item.id === "tournament-global")
        .registrations.find((registration) => registration.memberId === "member-jun")
        .status,
      "pending",
      "new tournament registrations must start in pending review",
    );

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      body: { memberId: "member-minjae", division: "일반부", weightClass: "-73kg" },
    });
    assert.equal(result.response.status, 200, "members must register their own profile");
    assert.equal(result.payload.data.registration.unchanged, false);
    const memberTournamentSnapshot = result.payload.data.db.tournaments.find((item) => item.id === "tournament-global");
    assert.deepEqual(
      memberTournamentSnapshot.registrations.map((registration) => ({
        division: registration.division,
        memberId: registration.memberId,
        weightClass: registration.weightClass,
      })),
      [{ division: "일반부", memberId: "member-minjae", weightClass: "-73kg" }],
      "family snapshots must not reveal other families' tournament registrations",
    );

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      method: "PATCH",
      body: { memberId: "member-minjae", status: "confirmed" },
    });
    assert.equal(result.response.status, 403, "family accounts must not review their own tournament registration");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      method: "PATCH",
      body: { memberId: "member-jun", status: "rejected" },
    });
    assert.equal(result.response.status, 400, "registration rejection must require an operator reason");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      method: "PATCH",
      body: { memberIds: ["member-jun", "member-harin"], status: "confirmed" },
    });
    assert.equal(result.response.status, 404, "batch review must reject a member outside the coach scope");
    assert.equal(
      (await readDb(dbFile)).tournaments
        .find((item) => item.id === "tournament-global")
        .registrations.find((registration) => registration.memberId === "member-jun")
        .status,
      "pending",
      "a rejected batch must not partially update accessible registrations",
    );

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      method: "PATCH",
      body: { memberId: "member-jun", status: "confirmed" },
    });
    assert.equal(result.response.status, 200, "coaches must review registrations for assigned members");
    assert.equal(result.payload.data.registration.status, "confirmed");
    assert.equal(result.payload.data.registration.operation, "review");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-guardian",
      body: { memberId: "member-jun", division: "중등부", weightClass: "-55kg" },
    });
    assert.equal(result.response.status, 200, "guardians must see an unchanged confirmed registration");
    assert.equal(result.payload.data.registration.unchanged, true);
    const guardianReviewedRegistration = result.payload.data.db.tournaments
      .find((item) => item.id === "tournament-global")
      .registrations.find((registration) => registration.memberId === "member-jun");
    assert.equal(
      guardianReviewedRegistration.status,
      "confirmed",
      "family snapshots must expose the operator review status for their own registration",
    );
    assert.equal(
      guardianReviewedRegistration.reviewedByUserId,
      undefined,
      "family snapshots must not expose the internal reviewer user ID",
    );
    const guardianReviewNotice = result.payload.data.db.notices.find(
      (notice) => notice.title === "대회 참가 확정" && notice.targetMemberIds?.includes("member-jun"),
    );
    assert(guardianReviewNotice, "operator review must create a family-visible targeted notice");
    assert.deepEqual(
      guardianReviewNotice.audience,
      ["member", "guardian"],
      "registration review notices must stay limited to family roles",
    );
    const registrationReviewDispatchAudit = (await readDb(dbFile)).auditLogs.find(
      (auditLog) =>
        auditLog.action === "notification.dispatch" &&
        auditLog.targetType === "notice" &&
        auditLog.targetId === guardianReviewNotice.id,
    );
    assert(
      registrationReviewDispatchAudit?.after?.autoDispatchedOnCreate === true,
      "registration review notices must enter the durable push dispatch path",
    );

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      method: "PATCH",
      body: { memberId: "member-jun", status: "rejected", note: "체급 증빙을 확인해 다시 신청해 주세요." },
    });
    assert.equal(result.response.status, 200, "coaches must reject an assigned member registration with a reason");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-guardian",
      body: { memberId: "member-jun", division: "중등부", weightClass: "-55kg" },
    });
    assert.equal(result.response.status, 200, "guardians must resubmit a rejected registration without changing accurate details");
    assert.equal(result.payload.data.registration.unchanged, false);
    const resubmittedRegistration = result.payload.data.db.tournaments
      .find((item) => item.id === "tournament-global")
      .registrations.find((registration) => registration.memberId === "member-jun");
    assert.equal(resubmittedRegistration.status, "pending", "rejected registrations must return to pending on resubmission");
    assert.equal(resubmittedRegistration.reviewNote, undefined, "resubmission must clear the previous rejection reason");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-guardian",
      body: { memberId: "member-jun", division: "중등부", weightClass: "-60kg" },
    });
    assert.equal(result.response.status, 200, "guardians must update their linked child's registration details");
    assert.equal(result.payload.data.registration.operation, "update");
    assert.equal(
      result.payload.data.db.tournaments
        .find((item) => item.id === "tournament-global")
        .registrations.find((registration) => registration.memberId === "member-jun")
        .status,
      "pending",
      "editing a reviewed registration must return it to pending review",
    );

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      body: { memberId: "member-minjae", division: "일반부", weightClass: "-73kg" },
    });
    assert.equal(result.response.status, 200, "duplicate tournament registration must be idempotent");
    assert.equal(result.payload.data.registration.unchanged, true);
    assert.equal(
      (await readDb(dbFile)).tournaments
        .find((item) => item.id === "tournament-global")
        .registrations.filter((registration) => registration.memberId === "member-minjae").length,
      1,
      "duplicate registration must not persist twice",
    );

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      body: { memberId: "member-minjae", division: "생활체육부", weightClass: "-81kg" },
    });
    assert.equal(result.response.status, 200, "members must update their existing tournament registration details");
    assert.equal(result.payload.data.registration.operation, "update");
    assert.equal(result.payload.data.registration.unchanged, false);
    const updatedRegistration = (await readDb(dbFile)).tournaments
      .find((item) => item.id === "tournament-global")
      .registrations.find((registration) => registration.memberId === "member-minjae");
    assert.equal(updatedRegistration.division, "생활체육부", "registration update must persist the selected division");
    assert.equal(updatedRegistration.weightClass, "-81kg", "registration update must persist the selected weight class");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-member",
      method: "DELETE",
      body: { memberId: "member-minjae" },
    });
    assert.equal(result.response.status, 200, "members must cancel their own tournament registration");
    assert.equal(result.payload.data.registration.status, "cancelled");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-guardian",
      body: { memberId: "member-seo", division: "초등부", weightClass: "-40kg" },
    });
    assert.equal(result.response.status, 200, "guardians must register another linked child for batch review");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      method: "PATCH",
      body: {
        memberIds: ["member-jun", "member-seo"],
        note: "보호자 확인 및 참가비 안내 완료",
        status: "confirmed",
      },
    });
    assert.equal(result.response.status, 200, "coaches must confirm multiple accessible registrations atomically");
    assert.equal(result.payload.data.registration.updatedCount, 2, "batch confirmation must report its mutation count");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      method: "PATCH",
      body: {
        memberIds: ["member-jun", "member-seo"],
        note: "대한유도회 제출 명단 반영",
        status: "submitted",
      },
    });
    assert.equal(result.response.status, 200, "confirmed registrations must support a batch submitted transition");
    assert.equal(result.payload.data.registration.updatedCount, 2, "batch submission must report its mutation count");
    const submittedRegistrations = (await readDb(dbFile)).tournaments
      .find((item) => item.id === "tournament-global")
      .registrations.filter((registration) => ["member-jun", "member-seo"].includes(registration.memberId));
    assert(
      submittedRegistrations.every(
        (registration) =>
          registration.status === "submitted" &&
          registration.reviewNote === "대한유도회 제출 명단 반영",
      ),
      "batch submission must persist status and the operator note for every selected member",
    );

    result = await apiRequest(baseUrl, "/api/v1/me/bootstrap?selectedBranchId=branch-gangnam", {
      userId: "user-guardian",
      method: "GET",
    });
    const guardianSubmittedRegistration = result.payload.data.db.tournaments
      .find((item) => item.id === "tournament-global")
      .registrations.find((registration) => registration.memberId === "member-jun");
    assert.equal(
      guardianSubmittedRegistration.reviewNote,
      "대한유도회 제출 명단 반영",
      "families must see the operator guidance for their submitted registration",
    );
    assert.equal(
      guardianSubmittedRegistration.reviewedByUserId,
      undefined,
      "family guidance must not expose the internal reviewer ID",
    );

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-guardian",
      body: { memberId: "member-jun", division: "중등부", weightClass: "-66kg" },
    });
    assert.equal(result.response.status, 422, "families must not edit a registration after association submission");

    result = await apiRequest(baseUrl, "/api/v1/tournaments/tournament-global/registrations?selectedBranchId=branch-gangnam", {
      userId: "user-guardian",
      method: "DELETE",
      body: { memberId: "member-jun" },
    });
    assert.equal(result.response.status, 422, "families must not cancel a registration after association submission");
    assert.equal(
      (await readDb(dbFile)).tournaments
        .find((item) => item.id === "tournament-global")
        .registrations.find((registration) => registration.memberId === "member-jun")
        .status,
      "submitted",
      "blocked family mutations must preserve the submitted registration",
    );

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
    const concurrentCreateRecords = persisted.tournaments.filter((item) => concurrentCreateTitles.includes(item.title));
    const concurrentCreateAudits = tournamentAudits.filter(
      (log) => log.action === "tournament.create" && concurrentCreateTitles.includes(log.after?.title),
    );
    const concurrentPatchAudits = tournamentAudits.filter(
      (log) => log.action === "tournament.update" && log.targetId === createdCoachTournament.id,
    );
    const registrationAudits = tournamentAudits.filter(
      (log) => log.action === "tournament.registration.update" && log.targetId === "tournament-global",
    );
    assert.equal(concurrentCreateRecords.length, 2, "concurrent tournament creates must both persist");
    assert.equal(new Set(concurrentCreateRecords.map((item) => item.id)).size, 2, "concurrent tournament IDs must be unique");
    assert.equal(concurrentCreateAudits.length, 2, "concurrent tournament creates must preserve both audits");
    assert.equal(new Set(concurrentCreateAudits.map((log) => log.id)).size, 2, "concurrent create audit IDs must be unique");
    assert.equal(concurrentPatchAudits.length, 3, "concurrent and serial tournament patches must preserve every audit");
    assert.equal(new Set(concurrentPatchAudits.map((log) => log.id)).size, 3, "tournament update audit IDs must be unique");
    assert.equal(coachCreateAudit?.branchId, "branch-gangnam", "branch create audit must use resource branchId");
    assert.equal(coachUpdateAudit?.branchId, "branch-gangnam", "branch update audit must use resource branchId");
    assert.equal(globalCreateAudit?.branchId, null, "global create audit must keep null branchId");
    assert.equal(songpaCreateAudit?.branchId, "branch-songpa", "admin branch create audit must use selected branchId");
    assert.equal(songpaDeleteAudit?.branchId, "branch-songpa", "admin branch delete audit must use the resource branchId");
    assert.equal(
      registrationAudits.length,
      13,
      "family apply/update/cancel and individual or batch operator mutations must preserve registration audits",
    );
    assert(
      registrationAudits.every((log) => log.branchId === "branch-gangnam"),
      "global tournament registration audits must use the participant branch",
    );

    const executablePath = chromeCandidates.find(existsSync);
    assert(executablePath, "Chrome is required for tournament mobile deletion verification");
    browser = await chromium.launch({ executablePath, headless: true });
    const browserContext = await browser.newContext({
      extraHTTPHeaders: { "x-user-id": "user-coach" },
      viewport: { width: 390, height: 844 },
    });
    const page = await browserContext.newPage();
    await page.goto(`${baseUrl}/app/dashboard`, { waitUntil: "networkidle" });
    const dashboardTournamentQueueLink = page.getByRole("link", { name: /대회 신청/ });
    await dashboardTournamentQueueLink.waitFor({ state: "visible" });
    assert.equal(
      await dashboardTournamentQueueLink.getAttribute("href"),
      "/app/tournaments#registration-queue",
      "coach dashboard must link tournament registration work to the pending queue",
    );

    await page.goto(`${baseUrl}/app/tournaments`, { waitUntil: "networkidle" });
    const managementButton = page.getByTestId("tournament-registration-manage-tournament-global");
    await managementButton.waitFor({ state: "visible" });
    const managementButtonBox = await managementButton.boundingBox();
    assert(managementButtonBox && managementButtonBox.height >= 44, "registration management trigger must be at least 44px high");
    await managementButton.click();
    const managementDialog = page.getByTestId("tournament-registration-management-dialog");
    await managementDialog.waitFor({ state: "visible" });
    const managementRow = page.getByTestId("tournament-registration-management-row-member-jun");
    await managementRow.waitFor({ state: "visible" });
    await managementRow.getByText("중등부 · -60kg", { exact: false }).waitFor({ state: "visible" });
    await page.getByTestId("tournament-registration-management-search").fill("이서");
    await page.getByTestId("tournament-registration-management-status-filter").selectOption("submitted");
    await page.getByTestId("tournament-registration-management-row-member-seo").waitFor({ state: "visible" });
    await managementRow.waitFor({ state: "hidden" });
    await page.getByTestId("tournament-registration-management-search").fill("");
    await page.getByTestId("tournament-registration-management-status-filter").selectOption("all");
    await managementRow.waitFor({ state: "visible" });
    const confirmRegistrationButton = page.getByTestId("tournament-registration-review-member-jun-confirmed");
    const confirmRegistrationButtonBox = await confirmRegistrationButton.boundingBox();
    assert(
      confirmRegistrationButtonBox && confirmRegistrationButtonBox.height >= 44,
      "registration review controls must be at least 44px high",
    );
    await confirmRegistrationButton.click();
    await page.getByText("1명의 대회 참가 신청을 확정했습니다.").waitFor({ state: "visible" });
    assert.equal(
      (await readDb(dbFile)).tournaments
        .find((item) => item.id === "tournament-global")
        .registrations.find((registration) => registration.memberId === "member-jun")
        .status,
      "confirmed",
      "coach registration management must persist the selected status",
    );
    await page.getByRole("button", { name: "참가 신청 관리 창 닫기" }).click();
    await managementDialog.waitFor({ state: "hidden" });

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

    const memberBrowserContext = await browser.newContext({
      extraHTTPHeaders: { "x-user-id": "user-member" },
      viewport: { width: 390, height: 844 },
    });
    const memberPage = await memberBrowserContext.newPage();
    await memberPage.goto(`${baseUrl}/app/tournaments`, { waitUntil: "networkidle" });
    const registrationButton = memberPage.getByTestId("tournament-registration-open-tournament-global");
    await registrationButton.waitFor({ state: "visible" });
    const registrationButtonBox = await registrationButton.boundingBox();
    const registrationCardBox = await registrationButton.locator("xpath=ancestor::li").boundingBox();
    assert(registrationButtonBox && registrationButtonBox.height >= 44, "mobile registration trigger must be at least 44px high");
    assert(
      registrationButtonBox && registrationCardBox && registrationButtonBox.x > registrationCardBox.x + registrationCardBox.width / 2,
      "registration trigger must stay in the card's bottom-right action area",
    );

    await registrationButton.click();
    const registrationDialog = memberPage.getByTestId("tournament-registration-dialog");
    await registrationDialog.waitFor({ state: "visible" });
    await memberPage.getByTestId("tournament-registration-member-member-minjae").check();
    await memberPage.getByTestId("tournament-registration-division").selectOption("일반부");
    await memberPage.getByTestId("tournament-registration-weight-class").fill("-73kg");
    const registrationSubmit = memberPage.getByTestId("tournament-registration-submit");
    const registrationSubmitBox = await registrationSubmit.boundingBox();
    assert(registrationSubmitBox && registrationSubmitBox.height >= 44, "registration decision control must be at least 44px high");
    await registrationSubmit.click();
    await memberPage.getByText("대회 참가를 신청했습니다.").waitFor({ state: "visible" });
    const mobileRegistration = (await readDb(dbFile)).tournaments
      .find((item) => item.id === "tournament-global")
      .registrations.find((registration) => registration.memberId === "member-minjae");
    assert.equal(mobileRegistration?.division, "일반부", "mobile registration dialog must persist the selected division");
    assert.equal(mobileRegistration?.weightClass, "-73kg", "mobile registration dialog must persist the selected weight class");
    await memberPage.getByRole("button", { name: "참가 신청 창 닫기" }).click();
    await registrationDialog.waitFor({ state: "hidden" });
    await registrationButton.click();
    await registrationDialog.waitFor({ state: "visible" });
    await memberPage.getByText("검토 중 상태입니다.", { exact: false }).waitFor({ state: "visible" });
    const memberLayout = await memberPage.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(memberLayout.scrollWidth <= memberLayout.clientWidth, "390px registration dialog must not overflow horizontally");
    await memberBrowserContext.close();

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "role x branch x author mutation matrix",
        "legacy global compatibility",
        "global and branch creation scope",
        "input type and exact calendar validation",
        "serialized concurrent create and update audit integrity",
        "server-side snapshot visibility",
        "family registration authorization and privacy",
        "duplicate registration idempotency, cancellation, and submitted-state locking",
        "coach individual and atomic batch review authorization",
        "operator review reasons, filters, and family-visible status",
        "coach dashboard registration queue entry",
        "registration audit trail",
        "390px family registration and staff management dialogs",
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
