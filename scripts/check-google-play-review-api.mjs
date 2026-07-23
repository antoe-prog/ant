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
let appServer = null;

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
      throw new Error(`Google Play review API server exited with code ${appServer?.exitCode}`);
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
  const db = provisionGooglePlayReviewAccess(sourceDb, passwords, new Date("2026-07-22T03:00:00.000Z"));
  await writeFile(path.join(dataDirectory, "final-judo-db.json"), `${JSON.stringify(db, null, 2)}\n`, "utf8");

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
        FINAL_JUDO_ROLL_DEMO_DATES: "0",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let serverErrors = "";
  appServer.stderr.on("data", (chunk) => {
    serverErrors += chunk.toString();
  });
  await waitForServer(baseUrl);

  const sessions = {};
  for (const role of Object.keys(googlePlayReviewUserIds)) {
    sessions[role] = await login(baseUrl, role);
    const snapshot = sessions[role].payload.data.db;
    assert.deepEqual(snapshot.branches.map((branch) => branch.id), [googlePlayReviewBranchId]);
    assert.equal(snapshot.members.every((member) => member.branchId === googlePlayReviewBranchId), true);
    assert.deepEqual(
      snapshot.tournaments.map((tournament) => tournament.id),
      ["tournament-google-play-review"],
      `${role} review snapshot must not include real global tournaments`,
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
  assert.equal(blockedAdminWrite.status, 403, "review admin must not mutate global admin resources");

  const blockedTournamentWrite = await fetch(`${baseUrl}/api/v1/tournaments/tournament-real-global`, {
    method: "PATCH",
    headers: { cookie: sessions.admin.cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: "blocked" }),
  });
  assert.equal(blockedTournamentWrite.status, 403, "review admin must remain read-only outside /api/v1/admin routes");

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
  console.log("Google Play review API checks passed: five logins, isolated snapshots, blocked global writes, and forced branch scope.");
} finally {
  await stopServer();
  await rm(dataDirectory, { force: true, recursive: true });
}
