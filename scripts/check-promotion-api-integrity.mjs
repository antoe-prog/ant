import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { getFinalPromotionExamKind } from "../src/lib/final-common-promotion-policy.ts";
import { formatDateKey } from "../src/lib/format.ts";
import { createMockData } from "../src/lib/mock-data.ts";

const nextBin = "node_modules/next/dist/bin/next";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function moveDateKey(dateKey, dayOffset) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + dayOffset, 12));
  return date.toISOString().slice(0, 10);
}

function findDateKey(startDateKey, direction, predicate) {
  for (let offset = direction; Math.abs(offset) <= 370; offset += direction) {
    const candidate = moveDateKey(startDateKey, offset);

    if (predicate(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not find a matching promotion test date.");
}

async function waitForServer(baseUrl, child, timeoutMs = 45_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error("Promotion API test server exited before it became reachable.");
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

  throw new Error(`Timed out waiting for the isolated promotion API server at ${baseUrl}.`);
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    child.kill("SIGTERM");
  } else {
    process.kill(-child.pid, "SIGTERM");
  }

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5_000).then(() => {
      if (child.exitCode === null) {
        if (process.platform === "win32") {
          child.kill("SIGKILL");
        } else {
          process.kill(-child.pid, "SIGKILL");
        }
      }
    }),
  ]);
}

async function apiRequest(baseUrl, pathName, { body, method = "POST", userId = "user-owner" } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  return { payload, response };
}

async function readDb(dbFile) {
  return JSON.parse(await readFile(dbFile, "utf8"));
}

async function main() {
  const tempRoot = path.join(process.cwd(), ".data", "test-runs");
  await mkdir(tempRoot, { recursive: true });
  const tempDir = await mkdtemp(path.join(tempRoot, "promotion-api-"));
  const dbFile = path.join(tempDir, "final-judo-db.json");
  const runtimeStamp = `${process.pid}-${Date.now()}`;
  const distDir = `.next-promotion-api-${runtimeStamp}`;
  const tsconfigPath = `.tsconfig.promotion-api-${runtimeStamp}.json`;
  const today = formatDateKey(new Date());
  const pastPolicyDate = findDateKey(today, -1, (candidate) => getFinalPromotionExamKind(candidate) !== null);
  const futurePolicyDate = findDateKey(today, 1, (candidate) => getFinalPromotionExamKind(candidate) !== null);
  const nonPolicyFutureDate = findDateKey(today, 1, (candidate) => getFinalPromotionExamKind(candidate) === null);
  const db = createMockData();
  const createdAt = new Date().toISOString();

  db.classes = db.classes.map((session) => ({
    ...session,
    enrolledMemberIds: session.enrolledMemberIds.filter((memberId) => memberId !== "member-yuna"),
  }));
  db.promotions = [
    {
      id: "promotion-past-valid",
      branchId: "branch-gangnam",
      memberId: "member-jun",
      fromBelt: "노란띠",
      toBelt: "주황띠",
      examDate: pastPolicyDate,
      result: "scheduled",
      evaluatorUserId: "user-owner",
      createdByUserId: "user-owner",
      createdAt,
    },
    {
      id: "promotion-legacy-skip",
      branchId: "branch-gangnam",
      memberId: "member-seo",
      fromBelt: "흰띠",
      toBelt: "초록띠",
      examDate: pastPolicyDate,
      result: "scheduled",
      evaluatorUserId: "user-owner",
      createdByUserId: "user-owner",
      createdAt,
    },
    {
      id: "promotion-concurrent-result",
      branchId: "branch-gangnam",
      memberId: "member-jiho",
      fromBelt: "노란띠",
      toBelt: "주황띠",
      examDate: pastPolicyDate,
      result: "scheduled",
      evaluatorUserId: "user-owner",
      createdByUserId: "user-owner",
      createdAt,
    },
    {
      id: "promotion-future-result",
      branchId: "branch-gangnam",
      memberId: "member-minjae",
      fromBelt: "초록띠",
      toBelt: "파란띠",
      examDate: futurePolicyDate,
      result: "scheduled",
      evaluatorUserId: "user-owner",
      createdByUserId: "user-owner",
      createdAt,
    },
  ];

  await Promise.all([
    writeFile(dbFile, `${JSON.stringify(db, null, 2)}\n`, "utf8"),
    writeFile(
      tsconfigPath,
      `${JSON.stringify({
        extends: "./tsconfig.json",
        include: [
          "next-env.d.ts",
          "**/*.ts",
          "**/*.tsx",
          ".next/types/**/*.ts",
          ".next/dev/types/**/*.ts",
          "**/*.mts",
          `${distDir}/types/**/*.ts`,
          `${distDir}/dev/types/**/*.ts`,
        ],
      }, null, 2)}\n`,
      "utf8",
    ),
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

  try {
    await waitForServer(baseUrl, child);

    let result = await apiRequest(baseUrl, "/api/v1/promotions?selectedBranchId=branch-songpa", {
      body: { memberId: "member-harin", toBelt: "주황띠", examDate: nonPolicyFutureDate },
    });
    assert.equal(result.response.status, 422, "non-policy grading dates must be rejected");

    result = await apiRequest(baseUrl, "/api/v1/promotions?selectedBranchId=branch-gangnam", {
      userId: "user-coach",
      body: { memberId: "member-yuna", toBelt: "노란띠", examDate: futurePolicyDate },
    });
    assert.equal(result.response.status, 200, "primary coach must create an exam without a current class enrollment");
    let persisted = await readDb(dbFile);
    const coachPromotion = persisted.promotions.find(
      (promotion) => promotion.memberId === "member-yuna" && promotion.result === "scheduled",
    );
    assert(coachPromotion, "primary-coach promotion must persist");

    result = await apiRequest(
      baseUrl,
      `/api/v1/promotions/${coachPromotion.id}?selectedBranchId=branch-gangnam`,
      { userId: "user-coach", method: "PATCH", body: { result: "cancelled" } },
    );
    assert.equal(result.response.status, 200, "primary coach must cancel a future assigned exam");

    result = await apiRequest(
      baseUrl,
      "/api/v1/promotions/promotion-future-result?selectedBranchId=branch-gangnam",
      { method: "PATCH", body: { result: "passed" } },
    );
    assert.equal(result.response.status, 422, "future grading results must be rejected");

    result = await apiRequest(
      baseUrl,
      "/api/v1/promotions/promotion-legacy-skip?selectedBranchId=branch-gangnam",
      { method: "PATCH", body: { result: "passed" } },
    );
    assert.equal(result.response.status, 409, "legacy skipped-belt exams must not be passed");

    result = await apiRequest(
      baseUrl,
      "/api/v1/promotions/promotion-past-valid?selectedBranchId=branch-gangnam",
      { method: "PATCH", body: { result: "passed" } },
    );
    assert.equal(result.response.status, 200, "a reached exact-next grading must be passable");

    const concurrentDecisions = await Promise.all([
      apiRequest(baseUrl, "/api/v1/promotions/promotion-concurrent-result?selectedBranchId=branch-gangnam", {
        method: "PATCH",
        body: { result: "passed" },
      }),
      apiRequest(baseUrl, "/api/v1/promotions/promotion-concurrent-result?selectedBranchId=branch-gangnam", {
        method: "PATCH",
        body: { result: "failed" },
      }),
    ]);
    assert.deepEqual(
      concurrentDecisions.map(({ response }) => response.status).sort(),
      [200, 409],
      "concurrent decisions must commit exactly once",
    );

    const concurrentCreates = await Promise.all([
      apiRequest(baseUrl, "/api/v1/promotions?selectedBranchId=branch-songpa", {
        body: { memberId: "member-harin", toBelt: "주황띠", examDate: futurePolicyDate },
      }),
      apiRequest(baseUrl, "/api/v1/promotions?selectedBranchId=branch-songpa", {
        body: { memberId: "member-harin", toBelt: "주황띠", examDate: futurePolicyDate },
      }),
    ]);
    assert.deepEqual(
      concurrentCreates.map(({ response }) => response.status).sort(),
      [200, 409],
      "concurrent creates must persist exactly one open exam",
    );

    persisted = await readDb(dbFile);
    assert.equal(
      persisted.promotions.filter((promotion) => promotion.memberId === "member-harin" && promotion.result === "scheduled").length,
      1,
      "a member must have at most one scheduled exam after concurrent writes",
    );
    assert.equal(
      persisted.promotions.filter((promotion) => promotion.id === "promotion-concurrent-result" && promotion.result !== "scheduled").length,
      1,
      "a scheduled exam must have exactly one committed result",
    );

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "second- or fourth-Friday registration",
        "primary-coach create and cancel without class enrollment",
        "future-result rejection",
        "legacy skipped-belt rejection",
        "successful reached exact-next result",
        "atomic concurrent create and result decisions",
      ],
    }, null, 2));
  } catch (error) {
    if (output.length > 0) {
      console.error(output.join(""));
    }
    throw error;
  } finally {
    await stopServer(child);
    await Promise.all([
      rm(tempDir, { force: true, recursive: true }),
      rm(distDir, { force: true, recursive: true }),
      rm(tsconfigPath, { force: true }),
    ]);
  }
}

await main();
