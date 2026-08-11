import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createMockData } from "../src/lib/mock-data.ts";
import {
  googlePlayReviewBranchId,
  googlePlayReviewPhones,
  googlePlayReviewUserIds,
} from "../src/lib/google-play-review-access.ts";
import { provisionGooglePlayReviewAccess } from "../src/server/google-play-review-provisioning.ts";

const passwords = {
  admin: "FJ-Play-admin-api-2026",
  coach: "FJ-Play-coach-api-2026",
  guardian: "FJ-Play-guardian-api-2026",
  member: "FJ-Play-member-api-2026",
  owner: "FJ-Play-owner-api-2026",
};
const dataDirectory = path.resolve(`.data/google-play-review-api-${process.pid}`);
const runtimeStamp = `${process.pid}-${Date.now()}`;
const managedDistDir = `.next-google-play-review-api-${runtimeStamp}`;
const managedTsconfigPath = `.tsconfig.google-play-review-api-${runtimeStamp}.json`;
let appServer = null;
let serverOutput = "";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseUrl, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (appServer?.exitCode !== null) {
      throw new Error(
        `Google Play review API server exited with code ${appServer?.exitCode}\n${serverOutput.slice(-4000)}`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // Keep waiting for the owned local server.
    }

    await delay(400);
  }

  throw new Error("Timed out waiting for the Google Play review API server.");
}

async function login(baseUrl, role) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keepSignedIn: true,
      phone: googlePlayReviewPhones[role],
      password: passwords[role],
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200, `${role} review account must log in`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie, `${role} review login must set a session cookie`);
  return { cookie, payload };
}

async function stopServer() {
  if (!appServer || appServer.exitCode !== null) {
    return;
  }

  appServer.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => appServer.once("exit", resolve)),
    delay(5_000),
  ]);
  if (appServer.exitCode === null) {
    appServer.kill("SIGKILL");
  }
}

try {
  await rm(dataDirectory, { force: true, recursive: true });
  await mkdir(dataDirectory, { recursive: true });
  const sourceDb = createMockData();
  sourceDb.tournaments = [{
    id: "tournament-real-global",
    scope: "global",
    branchId: null,
    title: "Real global tournament",
    organizer: "Real operator",
    eventDate: "2026-12-01",
    createdAt: "2026-07-01T00:00:00.000Z",
  }];
  const signupBurstCreatedAt = new Date();
  sourceDb.auditLogs = [
    ...Array.from({ length: 60 }, (_, index) => ({
      id: `audit-public-signup-burst-${index}`,
      branchId: "branch-gangnam",
      actorUserId: `user-public-signup-burst-${index}`,
      action: "member.create",
      targetType: "member",
      targetId: `member-public-signup-burst-${index}`,
      before: null,
      after: { accountCreated: true },
      result: "success",
      message: "public signup fixture",
      createdAt: new Date(signupBurstCreatedAt.getTime() - index * 30_000).toISOString(),
    })),
    ...sourceDb.auditLogs,
  ];
  const db = provisionGooglePlayReviewAccess(sourceDb, passwords, new Date("2026-07-22T03:00:00.000Z"));
  for (const user of db.users) {
    if (Object.values(googlePlayReviewUserIds).includes(user.id)) {
      user.accountPurpose = "google_play_review";
    }
  }
  await writeFile(path.join(dataDirectory, "final-judo-db.json"), `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await writeFile(
    managedTsconfigPath,
    `${JSON.stringify({
      extends: "./tsconfig.json",
      include: [
        "next-env.d.ts",
        "**/*.ts",
        "**/*.tsx",
        `${managedDistDir}/types/**/*.ts`,
        `${managedDistDir}/dev/types/**/*.ts`,
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  appServer = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FINAL_JUDO_DATA_DIR: dataDirectory,
        FINAL_JUDO_ENABLE_DEMO_LOGIN: "0",
        FINAL_JUDO_ENABLE_DEV_RESET: "0",
        FINAL_JUDO_NEXT_DIST_DIR: managedDistDir,
        FINAL_JUDO_NEXT_TSCONFIG_PATH: managedTsconfigPath,
        FINAL_JUDO_ROLL_DEMO_DATES: "0",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let serverErrors = "";
  appServer.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  appServer.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    serverErrors += text;
    serverOutput += text;
  });
  await waitForServer(baseUrl);

  const publicSignupBranchesResponse = await fetch(`${baseUrl}/api/v1/auth/register`);
  const publicSignupBranchesPayload = await publicSignupBranchesResponse.json();
  assert.equal(publicSignupBranchesResponse.status, 200, "public signup branch lookup must remain available");
  assert.equal(
    publicSignupBranchesPayload.data.branches.some((branch) => branch.id === googlePlayReviewBranchId),
    false,
    "synthetic review branch must not appear in public signup",
  );

  const blockedReviewBranchSignup = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      branchId: googlePlayReviewBranchId,
      name: "Public signup must not enter review data",
      password: "FJ-Public-review-blocked-2026",
      phone: "01012341234",
    }),
  });
  const blockedReviewBranchSignupPayload = await blockedReviewBranchSignup.json();
  assert.equal(blockedReviewBranchSignup.status, 400, "public signup must reject the synthetic review branch");
  assert.equal(
    blockedReviewBranchSignupPayload.error?.code,
    "VALIDATION_ERROR",
    "review branch signup rejection must use the public validation contract",
  );

  const throttledPublicSignup = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      branchId: "branch-gangnam",
      name: "Public signup burst probe",
      password: "FJ-Public-burst-blocked-2026",
      phone: "01012345678",
    }),
  });
  const throttledPublicSignupPayload = await throttledPublicSignup.json();
  assert.equal(throttledPublicSignup.status, 429, "public signup bursts must be bounded per branch");
  assert.equal(throttledPublicSignupPayload.error?.code, "RATE_LIMITED");
  assert.match(throttledPublicSignup.headers.get("retry-after") ?? "", /^\d+$/);

  const sessions = {};
  for (const role of Object.keys(googlePlayReviewUserIds)) {
    sessions[role] = await login(baseUrl, role);
    const snapshot = sessions[role].payload.data.db;
    assert.deepEqual(snapshot.branches.map((branch) => branch.id), [googlePlayReviewBranchId]);
    assert.equal(snapshot.members.every((member) => member.branchId === googlePlayReviewBranchId), true);
    assert.deepEqual(
      snapshot.tournaments.map((tournament) => tournament.id).sort(),
      ["tournament-google-play-review", "tournament-real-global"].sort(),
      `${role} account must receive the same global and branch tournaments as an ordinary branch user`,
    );
    assert.equal("accountPurpose" in sessions[role].payload.data.user, false);
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /Google Play 검토|Play 검토|합성 검토|검토용|검토 지점|검토 매트|검토 체육관/i,
      `${role} snapshot must not expose review-only labels`,
    );
  }

  const adminSnapshot = sessions.admin.payload.data.db;
  assert.equal(adminSnapshot.users.length, 5, "review admin must only receive synthetic branch users");
  assert.equal(adminSnapshot.users.some((user) => user.id === "user-admin"), false, "real admin must not leak to review admin");
  assert.deepEqual(adminSnapshot.pilotReadinessChecks, [], "global pilot readiness data must not leak");
  assert.equal(
    adminSnapshot.auditLogs.every((log) => log.branchId === googlePlayReviewBranchId),
    true,
    "review admin audit logs must stay in the synthetic branch",
  );

  const blockedAdminWrite = await fetch(`${baseUrl}/api/v1/admin/branches`, {
    method: "POST",
    headers: { cookie: sessions.admin.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Blocked branch", district: "blocked", timezone: "Asia/Seoul" }),
  });
  assert.equal(blockedAdminWrite.status, 403, "branch-scoped admin must not mutate global admin resources");

  const allowedBranchWrite = await fetch(
    `${baseUrl}/api/v1/branches/${googlePlayReviewBranchId}/notices?selectedBranchId=${googlePlayReviewBranchId}`,
    {
      method: "POST",
      headers: { cookie: sessions.admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        audience: ["all"],
        body: "일반 지점 총괄 권한으로 등록한 운영 공지입니다.",
        targetType: "branch",
        title: "지점 운영 공지",
      }),
    },
  );
  assert.equal(allowedBranchWrite.status, 200, "review metadata must not make the branch admin read-only");

  const blockedTournamentWrite = await fetch(`${baseUrl}/api/v1/tournaments/tournament-real-global`, {
    method: "PATCH",
    headers: { cookie: sessions.admin.cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: "blocked" }),
  });
  assert.equal(blockedTournamentWrite.status, 403, "branch-scoped admin must not edit a tournament outside the assigned branch");

  const crossBranchWrite = await fetch(
    `${baseUrl}/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-gangnam`,
    {
      method: "POST",
      headers: { cookie: sessions.owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ audience: ["all"], body: "blocked", targetType: "branch", title: "blocked" }),
    },
  );
  assert.equal(crossBranchWrite.status, 403, "review owner must not mutate a real branch by direct API call");

  const forcedScope = await fetch(`${baseUrl}/api/v1/me/bootstrap?selectedBranchId=branch-gangnam`, {
    headers: { cookie: sessions.admin.cookie },
  });
  assert.equal(forcedScope.status, 403, "review admin must not select a real branch by URL manipulation");

  assert.equal(serverErrors.includes("Error"), false, `review API server emitted errors: ${serverErrors}`);
  console.log("Google Play review API checks passed: five logins, generic branch mutations, isolated snapshots, blocked global writes, and forced branch scope.");
} finally {
  await stopServer();
  await rm(dataDirectory, { force: true, recursive: true });
  await rm(managedDistDir, { force: true, recursive: true });
  await rm(managedTsconfigPath, { force: true });
}
