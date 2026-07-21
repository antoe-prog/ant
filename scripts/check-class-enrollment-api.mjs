import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockData } from "../src/lib/mock-data.ts";
import { formatDateKey } from "../src/lib/format.ts";

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
      server.close(() => typeof address === "object" && address?.port
        ? resolve(address.port)
        : reject(new Error("Could not allocate a class enrollment test port.")));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (child.exitCode !== null) throw new Error("Class enrollment test server exited before startup.");
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Wait for the isolated server.
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

async function request(baseUrl, pathName, { body, method = "GET", userId } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(userId ? { "x-user-id": userId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "final-judo-class-enrollment-api-"));
  const dbFile = path.join(tempDir, "final-judo-db.json");
  const stamp = `${process.pid}-${Date.now()}`;
  const distDir = `.next-class-enrollment-api-${stamp}`;
  const tsconfigPath = `.tsconfig.class-enrollment-api-${stamp}.json`;
  const initialDb = createMockData();
  const now = Date.now();
  const latestSeedClassEnd = initialDb.classes.reduce(
    (latest, session) => Math.max(latest, Date.parse(session.endsAt)),
    now,
  );
  const startsAt = new Date(latestSeedClassEnd + 24 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(latestSeedClassEnd + 25 * 60 * 60 * 1000).toISOString();

  await Promise.all([
    writeFile(dbFile, `${JSON.stringify(initialDb, null, 2)}\n`, "utf8"),
    writeFile(tsconfigPath, `${JSON.stringify({
      extends: "./tsconfig.json",
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", `${distDir}/types/**/*.ts`, `${distDir}/dev/types/**/*.ts`],
    }, null, 2)}\n`, "utf8"),
  ]);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [nextBin, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      FINAL_JUDO_DB_DRIVER: "json",
      FINAL_JUDO_NEXT_DIST_DIR: distDir,
      FINAL_JUDO_NEXT_TSCONFIG_PATH: tsconfigPath,
      FINAL_JUDO_ROLL_DEMO_DATES: "0",
      PILOT_DB_FILE: dbFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    await waitForServer(baseUrl, child);

    let result = await request(baseUrl, "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam", {
      method: "POST",
      userId: "user-coach",
      body: {
        name: "코치 생성 검증 수업",
        level: "초급",
        ageGroup: "all",
        coachId: "user-coach",
        startsAt,
        endsAt,
        room: "매트 C",
        capacity: 4,
        enrolledMemberIds: [],
      },
    });
    assert.equal(result.response.status, 200, "coach must create a self-assigned class");
    const coachClass = result.payload.data.db.classes.find((session) => session.name === "코치 생성 검증 수업");
    assert(coachClass, "coach-created class must persist");

    result = await request(baseUrl, `/api/v1/classes/${coachClass.id}?selectedBranchId=branch-gangnam`, {
      method: "PATCH",
      userId: "user-coach",
      body: { coachId: "user-owner" },
    });
    assert.equal(result.response.status, 403, "coach must not reassign the class to another operator");

    result = await request(baseUrl, "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-gangnam", {
      method: "POST",
      userId: "user-owner",
      body: {
        name: "회원 신청 정원 검증",
        level: "초급",
        ageGroup: "kids",
        coachId: "user-coach",
        startsAt,
        endsAt,
        room: "매트 D",
        capacity: 1,
        enrolledMemberIds: [],
      },
    });
    assert.equal(result.response.status, 200);
    const registrationClass = result.payload.data.db.classes.find((session) => session.name === "회원 신청 정원 검증");
    assert(registrationClass);

    const month = formatDateKey(startsAt).slice(0, 7);
    result = await request(
      baseUrl,
      `/api/v1/classes/registration-options?memberId=member-jun&month=${month}&selectedBranchId=branch-gangnam`,
      { userId: "user-guardian" },
    );
    assert.equal(result.response.status, 200);
    assert(result.payload.data.options.some((option) => option.id === registrationClass.id && option.canRegister));
    assert(!JSON.stringify(result.payload.data).includes("enrolledMemberIds"), "family options must not expose rosters");

    const race = await Promise.all(
      ["member-jun", "member-seo"].map((memberId) =>
        request(baseUrl, `/api/v1/classes/${registrationClass.id}/enrollment?selectedBranchId=branch-gangnam`, {
          method: "POST",
          userId: "user-guardian",
          body: { memberId },
        }),
      ),
    );
    assert.deepEqual(race.map(({ response }) => response.status).sort(), [200, 422]);

    result = await request(baseUrl, `/api/v1/classes/${registrationClass.id}/roster-candidates?selectedBranchId=branch-gangnam`, {
      userId: "user-coach",
    });
    assert.equal(result.response.status, 200, "assigned coach must load roster candidates");
    assert(result.payload.data.candidates.some((candidate) => candidate.id === "member-jun"));

    result = await request(baseUrl, `/api/v1/classes/${registrationClass.id}/roster-candidates?selectedBranchId=branch-gangnam`, {
      userId: "user-member",
    });
    assert.equal(result.response.status, 403, "members must not load operator roster candidates");

    const winnerId = race.find(({ response }) => response.status === 200)?.payload.data.enrollment.memberId;
    assert(winnerId);
    result = await request(baseUrl, `/api/v1/classes/${registrationClass.id}?selectedBranchId=branch-gangnam`, {
      method: "PATCH",
      userId: "user-owner",
      body: { ageGroup: "adult" },
    });
    assert.equal(result.response.status, 422, "operators must not make an enrolled class age-incompatible");
    result = await request(baseUrl, `/api/v1/classes/${registrationClass.id}/enrollment?selectedBranchId=branch-gangnam`, {
      method: "DELETE",
      userId: "user-guardian",
      body: { memberId: winnerId },
    });
    assert.equal(result.response.status, 200, "guardian must cancel a future registration");

    console.log(JSON.stringify({
      ok: true,
      checked: [
        "coach self-assigned class creation and reassignment denial",
        "family registration option privacy",
        "atomic capacity enforcement",
        "operator roster candidate RBAC",
        "enrolled member age compatibility on class updates",
        "future registration cancellation",
      ],
    }, null, 2));
  } catch (error) {
    if (output.length > 0) console.error(output.join(""));
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
