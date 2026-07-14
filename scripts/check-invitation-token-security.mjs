import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createInvitationToken,
  findUserByInvitationToken,
  getInvitationPasswordRateLimit,
  hashInvitationToken,
  invitationSecurityLockKey,
  invitationLifetimeMs,
  isInvitationExpired,
  secureStoredInvitationTokens,
} from "../src/server/invitation-token.ts";
import { authSecurityLockKey } from "../src/server/auth-session.ts";

const nextBin = "node_modules/next/dist/bin/next";
const stamp = Date.now();
let phoneSequence = stamp % 100000000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPhone() {
  phoneSequence = (phoneSequence + 1) % 100000000;
  return `010${String(phoneSequence).padStart(8, "0")}`;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;

      server.close(() => port ? resolve(port) : reject(new Error("Could not allocate a local port.")));
    });
  });
}

async function waitForServer(baseUrl, child, timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error("Invitation security test server exited before it became reachable.");
    }

    try {
      const response = await fetch(baseUrl, { redirect: "manual" });

      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // Wait for the isolated Next server to bind its port.
    }

    await sleep(300);
  }

  throw new Error(`Timed out waiting for the isolated invitation security server at ${baseUrl}.`);
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  const sendSignal = (signal) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall back to the direct child when its process group already exited.
      }
    }

    child.kill(signal);
  };

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        sendSignal("SIGTERM");
      }
      resolve();
    }, 5_000);

    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    sendSignal("SIGINT");
  });
}

function createClient(baseUrl) {
  let cookie = "";

  return {
    async request(pathname, init = {}) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
      });
      const setCookie = response.headers.get("set-cookie");

      if (setCookie) {
        cookie = setCookie.split(";")[0];
      }

      return {
        payload: await response.json().catch(() => ({})),
        response,
      };
    },
  };
}

async function readRuntimeDb(dbFile) {
  return JSON.parse(await readFile(dbFile, "utf8"));
}

async function createInvite(admin, suffix) {
  const result = await admin.request("/api/v1/admin/users/invitations", {
    method: "POST",
    body: JSON.stringify({
      branchIds: ["branch-gangnam"],
      email: `invite-security-${suffix}-${stamp}@example.com`,
      name: `초대 보안 ${suffix}`,
      phone: createPhone(),
      role: "member",
    }),
  });

  assert.equal(result.response.status, 200, `invitation ${suffix} must be created`);
  assert(
    result.payload.data.db.users.every((user) => !user.invitationToken),
    "invitation hashes must not be exposed through the bootstrap portion of the one-time response",
  );
  return result.payload.data.invitation;
}

function runHelperAssertions() {
  assert.equal(invitationSecurityLockKey, authSecurityLockKey, "invitation acceptance and account mutations must share one lock");
  const issued = createInvitationToken();

  assert.equal(Buffer.from(issued.token, "base64url").length, 32, "invitation token must contain 256 random bits");
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/, "invitation token must be base64url");
  assert.equal(issued.tokenHash, hashInvitationToken(issued.token));
  assert.match(issued.tokenHash, /^[a-f0-9]{64}$/);

  const legacyUser = {
    id: "legacy-invitee",
    name: "Legacy Invitee",
    role: "member",
    title: "pending",
    branchIds: ["branch-gangnam"],
    invitationStatus: "pending",
    invitationToken: issued.token,
    invitedAt: "2026-07-14T00:00:00.000Z",
  };
  assert.equal(findUserByInvitationToken([legacyUser], issued.token)?.id, legacyUser.id);
  assert.equal(secureStoredInvitationTokens([legacyUser])[0].invitationToken, issued.tokenHash);
  assert.equal(isInvitationExpired(legacyUser.invitedAt, new Date(Date.parse(legacyUser.invitedAt) + invitationLifetimeMs - 1)), false);
  assert.equal(isInvitationExpired(legacyUser.invitedAt, new Date(Date.parse(legacyUser.invitedAt) + invitationLifetimeMs)), true);
  assert.equal(findUserByInvitationToken([legacyUser], randomBytes(32).toString("base64url")), null);
  const futurePasswordFailure = {
    id: "audit-future-invite-password",
    branchId: "branch-gangnam",
    actorUserId: legacyUser.id,
    action: "auth.invite.accept",
    targetType: "auth",
    targetId: legacyUser.id,
    before: null,
    after: { failureKind: "password_validation" },
    result: "failed",
    message: "future clock skew",
    createdAt: "2026-07-14T00:01:00.000Z",
  };
  assert.equal(
    getInvitationPasswordRateLimit([futurePasswordFailure], legacyUser.id, new Date("2026-07-14T00:00:00.000Z")).failureCount,
    0,
    "future-dated audit rows must not activate an invitation password limit",
  );
}

async function runApiAssertions(baseUrl, dbFile) {
  const admin = createClient(baseUrl);
  const login = await admin.request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ role: "admin" }),
  });
  assert.equal(login.response.status, 200, "admin demo login must be available only in the isolated test server");

  const rateLimitedInvite = await createInvite(admin, "rate-limit");
  const persistedAfterCreate = await readRuntimeDb(dbFile);
  const persistedRateUser = persistedAfterCreate.users.find((user) => user.id === rateLimitedInvite.userId);
  assert.equal(persistedRateUser.invitationToken, hashInvitationToken(rateLimitedInvite.token));
  assert.notEqual(persistedRateUser.invitationToken, rateLimitedInvite.token);
  assert(!JSON.stringify(persistedAfterCreate.auditLogs).includes(rateLimitedInvite.token), "audit logs must not contain raw invitation tokens");
  assert(!JSON.stringify(persistedAfterCreate.auditLogs).includes(persistedRateUser.invitationToken), "audit logs must not contain invitation token hashes");

  const reissueInvite = await createInvite(admin, "reissue");
  const member = createClient(baseUrl);
  const memberLogin = await member.request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ role: "member" }),
  });
  assert.equal(memberLogin.response.status, 200);
  const forbiddenReissue = await member.request(`/api/v1/admin/users/${reissueInvite.userId}/invitation-link`, {
    method: "POST",
  });
  assert.equal(forbiddenReissue.response.status, 403, "members must not reissue invitation links");
  const invalidScopeReissue = await admin.request(
    `/api/v1/admin/users/${reissueInvite.userId}/invitation-link?selectedBranchId=branch-missing`,
    { method: "POST" },
  );
  assert.equal(invalidScopeReissue.response.status, 403, "reissue must reject an inaccessible selected branch");
  const reissued = await admin.request(`/api/v1/admin/users/${reissueInvite.userId}/invitation-link`, {
    method: "POST",
  });
  assert.equal(reissued.response.status, 200, "pending invitation links must be reissuable");
  const reissuedToken = reissued.payload.data.invitation.token;
  assert.notEqual(reissuedToken, reissueInvite.token, "reissuing must rotate the raw token");
  assert(reissued.payload.data.db.users.every((user) => !user.invitationToken), "reissue bootstrap must not expose token hashes");
  const afterReissueDb = await readRuntimeDb(dbFile);
  const reissuedUser = afterReissueDb.users.find((user) => user.id === reissueInvite.userId);
  assert.equal(reissuedUser.invitationToken, hashInvitationToken(reissuedToken));
  assert(!JSON.stringify(afterReissueDb).includes(reissuedToken), "reissued raw tokens must not persist");
  const oldReissuedLink = await createClient(baseUrl).request(
    `/api/v1/auth/invitations/${reissueInvite.token}/accept`,
    { method: "POST", body: JSON.stringify({ password: `Old-Reissued-${stamp}!` }) },
  );
  assert.equal(oldReissuedLink.response.status, 404, "reissuing must invalidate the previous invitation link");

  const beforeMismatch = persistedAfterCreate.auditLogs.filter((log) => log.action === "auth.invite.accept").length;
  const mismatch = await createClient(baseUrl).request(`/api/v1/auth/invitations/${randomBytes(32).toString("base64url")}/accept`, {
    method: "POST",
    body: JSON.stringify({ password: `Unmatched-${stamp}!` }),
  });
  assert.equal(mismatch.response.status, 404, "unmatched random tokens must be rejected before password hashing");
  const afterMismatchDb = await readRuntimeDb(dbFile);
  assert.equal(
    afterMismatchDb.auditLogs.filter((log) => log.action === "auth.invite.accept").length,
    beforeMismatch,
    "unmatched tokens must not create target-bearing password failure audit logs",
  );

  const rejectedPasswords = Array.from(
    { length: 5 },
    (_, index) => ` Rejected-Invite-${stamp}-${index}! `,
  );
  for (const password of rejectedPasswords) {
    const rejected = await createClient(baseUrl).request(`/api/v1/auth/invitations/${rateLimitedInvite.token}/accept`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    assert.equal(rejected.response.status, 400, "the first five invalid password attempts must be rejected and audited");
  }

  const limited = await createClient(baseUrl).request(`/api/v1/auth/invitations/${rateLimitedInvite.token}/accept`, {
    method: "POST",
    body: JSON.stringify({ password: `Valid-After-Limit-${stamp}!` }),
  });
  assert.equal(limited.response.status, 429, "the sixth password attempt in the window must be rate limited");
  assert(Number(limited.response.headers.get("retry-after")) >= 1, "429 responses must include Retry-After");

  const rateLimitedDb = await readRuntimeDb(dbFile);
  const failureAudits = rateLimitedDb.auditLogs.filter(
    (log) => log.action === "auth.invite.accept" && log.targetId === rateLimitedInvite.userId && log.result === "failed",
  );
  assert.equal(failureAudits.length, 5, "rate limiting must use the target user's five recent failure audit records");
  const serializedRateDb = JSON.stringify(rateLimitedDb);
  for (const secret of [rateLimitedInvite.token, ...rejectedPasswords]) {
    assert(!serializedRateDb.includes(secret), "runtime state must not persist raw invitation tokens or rejected passwords");
  }
  assert(!failureAudits.some((log) => "ip" in (log.after ?? {})), "failure audit records must not persist client IP addresses");

  const concurrentInvite = await createInvite(admin, "concurrent");
  const acceptBody = JSON.stringify({ password: `Concurrent-Accept-${stamp}!` });
  const concurrentResults = await Promise.all([
    createClient(baseUrl).request(`/api/v1/auth/invitations/${concurrentInvite.token}/accept`, { method: "POST", body: acceptBody }),
    createClient(baseUrl).request(`/api/v1/auth/invitations/${concurrentInvite.token}/accept`, { method: "POST", body: acceptBody }),
  ]);
  assert.deepEqual(
    concurrentResults.map((result) => result.response.status).sort((left, right) => left - right),
    [200, 409],
    "two concurrent accepts for one token must produce exactly one success",
  );

  const finalDb = await readRuntimeDb(dbFile);
  const acceptedUser = finalDb.users.find((user) => user.id === concurrentInvite.userId);
  const successAudits = finalDb.auditLogs.filter(
    (log) => log.action === "auth.invite.accept" && log.targetId === concurrentInvite.userId && log.result === "success",
  );
  assert.equal(acceptedUser.invitationStatus, "accepted");
  assert.equal(acceptedUser.invitationToken, hashInvitationToken(concurrentInvite.token));
  assert.equal(successAudits.length, 1, "single-use acceptance must persist one success audit");
  assert.equal(finalDb.authSessions.filter((session) => session.userId === concurrentInvite.userId && !session.revokedAt).length, 1);
  assert(!JSON.stringify(finalDb).includes(concurrentInvite.token), "accepted token plaintext must not persist anywhere");
  assert(!JSON.stringify(finalDb).includes(`Concurrent-Accept-${stamp}!`), "accepted password plaintext must not persist anywhere");
}

async function main() {
  runHelperAssertions();
  const acceptRouteSource = await readFile("src/app/api/v1/auth/invitations/[token]/accept/route.ts", "utf8");
  const tokenMatchIndex = acceptRouteSource.indexOf("const invitedUser = findUserByInvitationToken");
  const passwordHashIndex = acceptRouteSource.indexOf("passwordHash: createRandomPasswordHash");
  assert(tokenMatchIndex >= 0 && passwordHashIndex > tokenMatchIndex, "token hash matching must precede PBKDF2 password hashing");
  const tempDir = await mkdtemp(path.join(tmpdir(), "final-judo-invitation-security-"));
  const dbFile = path.join(tempDir, "runtime-db.json");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [nextBin, "dev", "--webpack", "--port", String(port), "--hostname", "127.0.0.1"], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      FINAL_JUDO_DB_DRIVER: "json",
      FINAL_JUDO_ENABLE_DEMO_LOGIN: "1",
      PILOT_DB_FILE: dbFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    await waitForServer(baseUrl, child);
    await runApiAssertions(baseUrl, dbFile);
    console.log(JSON.stringify({
      ok: true,
      checked: [
        "256-bit base64url token and SHA-256-only persistence",
        "seven-day expiration boundary",
        "unmatched token rejection before password work",
        "target audit-based password failure throttling with Retry-After",
        "future-dated audit rows excluded from password throttling",
        "atomic single-use acceptance and opaque session issuance",
        "authorized one-time invitation link reissue with scope checks and prior-link invalidation",
        "raw token, password, and IP audit redaction",
      ],
    }, null, 2));
  } catch (error) {
    if (output.length > 0) {
      console.error(output.join(""));
    }
    throw error;
  } finally {
    await stopServer(child);
    await rm(tempDir, { force: true, recursive: true });
  }
}

await main();
