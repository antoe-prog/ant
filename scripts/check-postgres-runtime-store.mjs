import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseCsv } from "./pilot-data-utils.mjs";

const execFile = promisify(execFileCallback);
const image = process.env.POSTGRES_IMAGE ?? "postgres:16-alpine";
const container = `final-judo-postgres-runtime-${Date.now()}`;
const database = process.env.POSTGRES_DB ?? "final_judo";
const user = process.env.POSTGRES_USER ?? "postgres";
const password = process.env.POSTGRES_PASSWORD ?? "postgres";
let closeServerDbFn = null;
let verificationPool = null;

async function getAvailablePort() {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  assert(address && typeof address === "object", "PostgreSQL payment route smoke must allocate a local port");
  return address.port;
}

async function removeNextRuntimeArtifacts(distDir, tsconfigPath) {
  await Promise.all([
    rm(distDir, { recursive: true, force: true }),
    rm(tsconfigPath, { force: true }),
  ]);
}

async function startPostgresAppServer(connectionString, distDir, tsconfigPath) {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const appServer = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FINAL_JUDO_DB_DRIVER: "postgres",
        FINAL_JUDO_NEXT_DIST_DIR: distDir,
        FINAL_JUDO_NEXT_TSCONFIG_PATH: tsconfigPath,
        FINAL_JUDO_POSTGRES_STATE_KEY: "postgres-payment-route-smoke",
        FINAL_JUDO_POSTGRES_URL: connectionString,
        FINAL_JUDO_ROLL_DEMO_DATES: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  appServer.stdout.on("data", (chunk) => output.push(chunk.toString()));
  appServer.stderr.on("data", (chunk) => output.push(chunk.toString()));

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (appServer.exitCode !== null) {
      await removeNextRuntimeArtifacts(distDir, tsconfigPath);
      throw new Error(`PostgreSQL payment route server exited before ready.\n${output.join("").slice(-4000)}`);
    }

    const response = await fetch(`${baseUrl}/login`).catch(() => null);

    if (response?.ok) {
      return { appServer, baseUrl, output };
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  appServer.kill("SIGTERM");
  await removeNextRuntimeArtifacts(distDir, tsconfigPath);
  throw new Error(`PostgreSQL payment route server did not become ready.\n${output.join("").slice(-4000)}`);
}

async function stopAppServer(appServer) {
  if (appServer.exitCode !== null) {
    return;
  }

  const closed = new Promise((resolve) => appServer.once("close", resolve));

  appServer.kill("SIGINT");
  await Promise.race([
    closed,
    new Promise((resolve) =>
      setTimeout(() => {
        if (appServer.exitCode === null) {
          appServer.kill("SIGTERM");
        }
        resolve();
      }, 5000),
    ),
  ]);
}

async function verifyPostgresPaymentRouteIdempotency(connectionString) {
  const runtimeStamp = `${process.pid}-${Date.now()}`;
  const distDir = `.next-postgres-runtime-${runtimeStamp}`;
  const tsconfigPath = `.tsconfig-postgres-runtime-${runtimeStamp}.json`;

  await writeFile(
    tsconfigPath,
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const { appServer, baseUrl, output } = await startPostgresAppServer(
    connectionString,
    distDir,
    tsconfigPath,
  );
  const { Pool } = await import("pg");

  try {
    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@finaljudo.kr", password: "FinalJudoPilot!2026" }),
    });
    const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];

    assert(loginResponse.ok && cookie, "PostgreSQL payment route owner login must return a session cookie");

    const registrationStamp = String(Date.now() % 100000000).padStart(8, "0");
    const registrationPhone = `010${registrationStamp}`;
    const registrationBody = JSON.stringify({
      branchId: "branch-gangnam",
      name: "PostgreSQL 동시 가입",
      password: `FJ-Postgres-${registrationStamp}!`,
      phone: registrationPhone,
    });
    const register = () =>
      fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: registrationBody,
      });
    const registrationResponses = await Promise.all([register(), register()]);
    assert.deepEqual(
      registrationResponses.map((response) => response.status).sort((left, right) => left - right),
      [200, 409],
      "PostgreSQL concurrent registration must persist one account and reject the duplicate",
    );
    const registrationPool = new Pool({ connectionString, max: 1 });
    try {
      const registrationState = await registrationPool.query(
        "select data from app_runtime_state where key = $1",
        ["postgres-payment-route-smoke"],
      );
      assert.equal(
        registrationState.rows[0]?.data?.users.filter((candidate) => candidate.phone === registrationPhone).length,
        1,
        "PostgreSQL runtime state must contain one user for a concurrently registered phone",
      );
      const registrationDb = registrationState.rows[0]?.data;
      const attendanceSession = registrationDb?.classes.find((candidate) => candidate.id === "class-kids-am");

      assert(attendanceSession, "PostgreSQL runtime state must contain the attendance smoke session");
      attendanceSession.startsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      attendanceSession.endsAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      await registrationPool.query(
        "update app_runtime_state set data = $2::jsonb, revision = revision + 1, updated_at = now() where key = $1",
        ["postgres-payment-route-smoke", JSON.stringify(registrationDb)],
      );
    } finally {
      await registrationPool.end();
    }

    const stamp = Date.now();
    const idempotencyKey = `manual.postgres.${stamp}`;
    const planName = `PostgreSQL 동시 등록 ${stamp}`;
    const paymentBody = JSON.stringify({
      amount: 175000,
      discountAmount: 5000,
      discountReason: "PostgreSQL 동시 등록 할인 검증",
      dueDate: "2026-07-13",
      expiresAt: "2026-08-13",
      memberId: "member-seo",
      planName,
      status: "scheduled",
    });
    const createPayment = () =>
      fetch(`${baseUrl}/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          "Idempotency-Key": idempotencyKey,
        },
        body: paymentBody,
      });
    const responses = await Promise.all([createPayment(), createPayment()]);
    const payloads = await Promise.all(responses.map((response) => response.json()));

    assert(responses.every((response) => response.ok), "PostgreSQL concurrent payment route requests must both succeed");
    assert(
      responses.some((response) => response.headers.get("idempotency-replayed") === "true"),
      "PostgreSQL concurrent payment route must mark one response as replayed",
    );
    const finalDb = payloads.at(-1)?.data?.db;

    assert.equal(
      finalDb?.payments.filter((payment) => payment.planName === planName).length,
      1,
      "PostgreSQL concurrent payment route must persist one payment",
    );
    assert.equal(
      finalDb?.auditLogs.filter(
        (log) => log.action === "payment.create" && log.after?.idempotencyKey === idempotencyKey,
      ).length,
      1,
      "PostgreSQL concurrent payment route must persist one payment.create audit log",
    );

    const warmAttendanceResponse = await fetch(
      `${baseUrl}/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-gangnam`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ items: [] }),
      },
    );

    assert.equal(warmAttendanceResponse.status, 400, "PostgreSQL cross-domain smoke must warm the attendance route");

    const barrierPool = new Pool({ connectionString, max: 1 });
    const barrierClient = await barrierPool.connect();
    let barrierCommitted = false;

    try {
      await barrierClient.query("BEGIN");
      await barrierClient.query("SELECT revision FROM app_runtime_state WHERE key = $1 FOR UPDATE", [
        "postgres-payment-route-smoke",
      ]);

      const crossDomainStamp = Date.now();
      const crossDomainPlanName = `PostgreSQL 교차 저장 ${crossDomainStamp}`;
      const crossDomainPayment = fetch(
        `${baseUrl}/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-gangnam`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
            "Idempotency-Key": `manual.postgres.cross.${crossDomainStamp}`,
          },
          body: JSON.stringify({
            amount: 165000,
            discountAmount: 0,
            dueDate: "2026-07-14",
            expiresAt: "2026-08-14",
            memberId: "member-jun",
            planName: crossDomainPlanName,
            status: "scheduled",
          }),
        },
      );
      const crossDomainAttendance = fetch(
        `${baseUrl}/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-gangnam`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({
            items: [{ memberId: "member-jun", status: "late", note: "교차 저장 검증" }],
            reason: "교차 저장 검증",
          }),
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 500));
      await barrierClient.query("COMMIT");
      barrierCommitted = true;

      const crossDomainResponses = await Promise.all([crossDomainPayment, crossDomainAttendance]);

      assert(
        crossDomainResponses.every((response) => response.ok),
        "PostgreSQL cross-domain stale revision requests must both succeed",
      );

      const bootstrapResponse = await fetch(
        `${baseUrl}/api/v1/me/bootstrap?selectedBranchId=branch-gangnam`,
        { headers: { Cookie: cookie } },
      );
      const bootstrapPayload = await bootstrapResponse.json();
      const mergedDb = bootstrapPayload.data?.db;

      assert(bootstrapResponse.ok, "PostgreSQL cross-domain smoke must read the merged bootstrap");
      assert(
        mergedDb?.payments.some((payment) => payment.planName === crossDomainPlanName),
        "PostgreSQL stale revision merge must preserve the concurrent payment",
      );
      assert(
        mergedDb?.attendance.some(
          (record) => record.sessionId === "class-kids-am" && record.memberId === "member-jun" && record.status === "late",
        ),
        "PostgreSQL stale revision merge must preserve the concurrent attendance update",
      );
      assert(
        mergedDb?.auditLogs.some(
          (log) => log.action === "payment.create" && log.after?.planName === crossDomainPlanName,
        ) &&
          mergedDb?.auditLogs.some(
            (log) => log.action === "attendance.update" && log.after?.note === "교차 저장 검증",
          ),
        "PostgreSQL stale revision merge must preserve both domain audit logs",
      );
    } finally {
      if (!barrierCommitted) {
        await barrierClient.query("ROLLBACK").catch(() => undefined);
      }
      barrierClient.release();
      await barrierPool.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`${message}\n${output.join("").slice(-4000)}`);
  } finally {
    await stopAppServer(appServer);
    await removeNextRuntimeArtifacts(distDir, tsconfigPath);
  }
}

function csvCell(value) {
  const stringValue = value == null ? "" : String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

function serializeCsv(headers, records) {
  return `${[headers, ...records.map((record) => headers.map((header) => record[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

function recordsFromCsv(csv) {
  const [headers, ...rows] = parseCsv(csv);
  return {
    headers,
    records: rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))),
  };
}

function mergeAuditStoreState(base, requested, latest) {
  const baseIds = new Set(base.auditLogs.map((log) => log.id));
  const additions = requested.auditLogs.filter((log) => !baseIds.has(log.id));

  return {
    ...latest,
    auditLogs: [...additions, ...latest.auditLogs],
  };
}

async function runNodeScript(script, args, env) {
  return execFile(process.execPath, ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], {
    cwd: process.cwd(),
    env,
    maxBuffer: 1024 * 1024,
  });
}

async function docker(args, options = {}) {
  const result = await execFile("docker", args, {
    maxBuffer: 1024 * 1024,
    ...options,
  });

  return result.stdout.trim();
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      await docker(["exec", container, "pg_isready", "-U", user, "-d", database]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const logs = await docker(["logs", container]).catch((error) => error.message);
  throw new Error(`PostgreSQL runtime store smoke did not become ready.\n${logs}`);
}

async function waitForHostConnection(connectionString) {
  const { Pool } = await import("pg");

  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const pool = new Pool({ connectionString, max: 1 });

    try {
      await pool.query("select 1");
      await pool.end();
      return;
    } catch {
      await pool.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const logs = await docker(["logs", container]).catch((error) => error.message);
  throw new Error(`PostgreSQL host connection did not become ready.\n${logs}`);
}

async function main() {
  await docker(["info"]).catch(() => {
    throw new Error("Docker daemon is not running. Start Docker Desktop and retry.");
  });

  await docker([
    "run",
    "--name",
    container,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    `POSTGRES_DB=${database}`,
    "-p",
    "127.0.0.1::5432",
    "-d",
    image,
  ]);

  await waitForPostgres();

  const portOutput = await docker(["port", container, "5432/tcp"]);
  const port = portOutput.split(":").at(-1);
  const connectionString = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;

  await waitForHostConnection(connectionString);
  await runNodeScript("scripts/check-store-write-validation.mjs", [], {
    ...process.env,
    STORE_WRITE_VALIDATION_POSTGRES_URL: connectionString,
  });

  process.env.FINAL_JUDO_DB_DRIVER = "postgres";
  process.env.FINAL_JUDO_POSTGRES_URL = connectionString;
  process.env.FINAL_JUDO_POSTGRES_STATE_KEY = "runtime-smoke";

  const { Pool } = await import("pg");
  const { createMockData } = await import("../src/lib/mock-data.ts");
  const { createPostgresJsonStore } = await import("../src/server/postgres-store.ts");
  const { createPasswordHash } = await import("../src/server/auth-password.ts");
  const store = createPostgresJsonStore({
    connectionString,
    key: "runtime-smoke",
    createDefault: () => ({
      branches: [{ id: "branch-gangnam" }, { id: "branch-songpa" }],
      users: [{ id: "user-admin" }],
      auditLogs: [],
    }),
    validate: (value) => {
      assert.equal(typeof value, "object", "runtime value must be an object");
      assert.notEqual(value, null, "runtime value must not be null");
      assert(Array.isArray(value.branches), "runtime branches must be an array");
      assert(Array.isArray(value.users), "runtime users must be an array");
      assert(Array.isArray(value.auditLogs), "runtime auditLogs must be an array");
      return value;
    },
  });
  closeServerDbFn = store.close;

  const secondStore = createPostgresJsonStore({
    connectionString,
    key: "runtime-smoke",
    createDefault: () => ({
      branches: [],
      users: [],
      auditLogs: [],
    }),
    validate: (value) => value,
  });

  try {
    const lockEvents = [];
    let markFirstLockStarted;
    const firstLockStarted = new Promise((resolve) => {
      markFirstLockStarted = resolve;
    });
    const firstLock = store.withLock("payment-create:user-owner:branch-gangnam:key", async () => {
      lockEvents.push("first:start");
      markFirstLockStarted();
      await new Promise((resolve) => setTimeout(resolve, 150));
      lockEvents.push("first:end");
    });

    await firstLockStarted;
    const secondLock = secondStore.withLock("payment-create:user-owner:branch-gangnam:key", async () => {
      lockEvents.push("second:start");
      lockEvents.push("second:end");
    });

    await Promise.all([firstLock, secondLock]);
    assert.deepEqual(
      lockEvents,
      ["first:start", "first:end", "second:start", "second:end"],
      "PostgreSQL advisory locks must serialize the same key across store instances",
    );
  } finally {
    await secondStore.close();
  }

  const mergeStoreA = createPostgresJsonStore({
    connectionString,
    key: "runtime-merge-smoke",
    createDefault: () => ({ branches: [], users: [], auditLogs: [] }),
    validate: (value) => value,
    merge: mergeAuditStoreState,
  });
  const mergeStoreB = createPostgresJsonStore({
    connectionString,
    key: "runtime-merge-smoke",
    createDefault: () => ({ branches: [], users: [], auditLogs: [] }),
    validate: (value) => value,
    merge: mergeAuditStoreState,
  });

  try {
    await mergeStoreA.reset();
    const [mergeBaseA, mergeBaseB] = await Promise.all([mergeStoreA.read(), mergeStoreB.read()]);
    const mergeAuditA = { id: "audit-merge-a" };
    const mergeAuditB = { id: "audit-merge-b" };

    await Promise.all([
      mergeStoreA.write({ ...mergeBaseA, auditLogs: [mergeAuditA, ...mergeBaseA.auditLogs] }),
      mergeStoreB.write({ ...mergeBaseB, auditLogs: [mergeAuditB, ...mergeBaseB.auditLogs] }),
    ]);
    assert.deepEqual(
      new Set((await mergeStoreA.read()).auditLogs.map((log) => log.id)),
      new Set([mergeAuditA.id, mergeAuditB.id]),
      "PostgreSQL stale snapshot writes must merge disjoint additions",
    );
  } finally {
    await Promise.all([mergeStoreA.close(), mergeStoreB.close()]);
  }

  const baseline = await store.reset();
  assert.equal(baseline.branches.length, 2, "PostgreSQL reset must seed two branches");
  assert.equal(baseline.users.length, 1, "PostgreSQL reset must seed users");

  const committedLockAuditId = `audit-lock-commit-${Date.now()}`;
  await store.withLock("payment-create:transaction-commit", async () => {
    const current = await store.read();

    await store.write({
      ...current,
      auditLogs: [
        {
          id: committedLockAuditId,
          branchId: "branch-gangnam",
          actorUserId: "user-admin",
          action: "payment.create",
          targetType: "payment",
          targetId: "payment-lock-commit",
          before: null,
          after: { lock: "transaction" },
          result: "success",
          message: "Transaction lock commit proof.",
          createdAt: new Date().toISOString(),
        },
        ...current.auditLogs,
      ],
    });
  });
  assert(
    (await store.read()).auditLogs.some((log) => log.id === committedLockAuditId),
    "locked PostgreSQL writes must commit on successful operations",
  );

  const rolledBackLockAuditId = `audit-lock-rollback-${Date.now()}`;
  await assert.rejects(
    store.withLock("payment-create:transaction-rollback", async () => {
      const current = await store.read();

      await store.write({
        ...current,
        auditLogs: [
          {
            id: rolledBackLockAuditId,
            branchId: "branch-gangnam",
            actorUserId: "user-admin",
            action: "payment.create",
            targetType: "payment",
            targetId: "payment-lock-rollback",
            before: null,
            after: { lock: "transaction" },
            result: "failed",
            message: "Transaction lock rollback proof.",
            createdAt: new Date().toISOString(),
          },
          ...current.auditLogs,
        ],
      });
      throw new Error("expected locked transaction rollback");
    }),
    /expected locked transaction rollback/,
    "locked PostgreSQL operations must surface operation failures",
  );
  assert(
    !(await store.read()).auditLogs.some((log) => log.id === rolledBackLockAuditId),
    "locked PostgreSQL writes must roll back when the operation fails",
  );

  const smokeAuditLog = {
    id: `audit-postgres-runtime-${Date.now()}`,
    branchId: null,
    actorUserId: "user-admin",
    action: "auth.login",
    targetType: "auth",
    targetId: "user-admin",
    before: null,
    after: { driver: "postgres" },
    result: "success",
    message: "PostgreSQL runtime store smoke.",
    createdAt: new Date().toISOString(),
  };
  const currentAfterLockProof = await store.read();
  await store.write({
    ...currentAfterLockProof,
    auditLogs: [smokeAuditLog, ...currentAfterLockProof.auditLogs],
  });

  const persisted = await store.read();
  assert.equal(persisted.auditLogs[0]?.id, smokeAuditLog.id, "PostgreSQL runtime write must persist and read back");

  const status = await store.status();
  assert.equal(status.key, "runtime-smoke", "runtime status must report state key");
  assert(status.revision >= 2, "runtime revision must increment after reset and write");

  const pool = new Pool({ connectionString });
  verificationPool = pool;
  const dbResult = await pool.query(
    "select revision, jsonb_array_length(data->'branches') as branches, jsonb_array_length(data->'auditLogs') as audit_logs from app_runtime_state where key = $1",
    ["runtime-smoke"],
  );

  assert.equal(Number(dbResult.rows[0]?.branches), 2, "runtime JSONB row must contain branches");
  assert.equal(
    Number(dbResult.rows[0]?.audit_logs),
    2,
    "runtime JSONB row must preserve the committed lock proof and smoke audit logs",
  );

  await store.reset(createMockData());
  await verifyPostgresPaymentRouteIdempotency(connectionString);

  await runNodeScript(
    "scripts/import-pilot-data.mjs",
    [
      "--write",
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );

  const importResult = await pool.query(
    `
      select
        jsonb_array_length(data->'branches') as branches,
        jsonb_array_length(data->'users') as users,
        jsonb_array_length(data->'members') as members,
        jsonb_array_length(data->'classes') as classes,
        jsonb_array_length(data->'payments') as payments,
        jsonb_array_length(data->'notices') as notices,
        jsonb_array_length(data->'pilotReadinessChecks') as pilot_readiness_checks,
        jsonb_array_length(data->'pilotIncidents') as pilot_incidents,
        jsonb_array_length(data->'pilotOperationLogs') as pilot_operation_logs
      from app_runtime_state
      where key = $1
    `,
    ["pilot-import-smoke"],
  );

  assert.equal(Number(importResult.rows[0]?.branches), 2, "pilot import must write two branches to PostgreSQL");
  assert.equal(Number(importResult.rows[0]?.users), 8, "pilot import must write pilot users to PostgreSQL");
  assert.equal(Number(importResult.rows[0]?.members), 4, "pilot import must write pilot members to PostgreSQL");
  assert.equal(Number(importResult.rows[0]?.classes), 4, "pilot import must write pilot classes to PostgreSQL");
  assert.equal(Number(importResult.rows[0]?.payments), 4, "pilot import must write pilot payments to PostgreSQL");
  assert.equal(Number(importResult.rows[0]?.notices), 2, "pilot import must write pilot notices to PostgreSQL");
  assert.equal(Number(importResult.rows[0]?.pilot_readiness_checks), 8, "pilot import must write readiness checks to PostgreSQL");
  assert.equal(Number(importResult.rows[0]?.pilot_incidents), 0, "pilot import must initialize pilot incidents in PostgreSQL");
  assert.equal(Number(importResult.rows[0]?.pilot_operation_logs), 0, "pilot import must initialize operation logs in PostgreSQL");

  const importedStateResult = await pool.query("select data from app_runtime_state where key = $1", ["pilot-import-smoke"]);
  const importedDb = importedStateResult.rows[0]?.data;
  const seededReadinessDb = {
    ...importedDb,
    pilotReadinessChecks: importedDb.pilotReadinessChecks.map((check) =>
      check.id === "pilot-data"
        ? {
            ...check,
            owner: "PostgreSQL 기존 담당자",
            status: "blocked",
            evidence: "PostgreSQL 기존 데이터 검수 blocker evidence",
            checkedAt: "2026-06-30T09:00:00.000Z",
          }
        : check,
    ),
  };
  await pool.query(
    `
      update app_runtime_state
      set data = $2::jsonb, revision = revision + 1, updated_at = now()
      where key = $1
    `,
    ["pilot-import-smoke", JSON.stringify(seededReadinessDb)],
  );

  const directory = await mkdtemp(join(tmpdir(), "final-judo-postgres-readiness-"));
  const readinessDraftPath = join(directory, "pilot-readiness-evidence.csv");
  await runNodeScript(
    "scripts/create-pilot-readiness-evidence-draft.mjs",
    [
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
      "--phase=pre-pilot",
      `--out=${readinessDraftPath}`,
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );
  const readinessCsv = recordsFromCsv(await readFile(readinessDraftPath, "utf8"));
  const prefilledReadinessRow = readinessCsv.records.find((record) => record.id === "pilot-data");
  assert.equal(prefilledReadinessRow?.owner, "PostgreSQL 기존 담당자", "readiness draft must prefill owner from PostgreSQL runtime");
  assert.equal(prefilledReadinessRow?.status, "blocked", "readiness draft must prefill status from PostgreSQL runtime");
  assert.equal(
    prefilledReadinessRow?.evidence,
    "PostgreSQL 기존 데이터 검수 blocker evidence",
    "readiness draft must prefill evidence from PostgreSQL runtime",
  );
  assert.equal(
    prefilledReadinessRow?.checkedAt,
    "2026-06-30T09:00:00.000Z",
    "readiness draft must prefill checkedAt from PostgreSQL runtime",
  );
  const readinessReadyPath = join(directory, "pilot-readiness-evidence.ready.csv");
  const readyRecords = readinessCsv.records.map((record) => ({
    ...record,
    owner: `${record.owner} PostgreSQL 확인자`,
    status: "verified",
    evidence: `${record.id} PostgreSQL runtime evidence`,
    checkedAt: "2026-07-01T09:00:00+09:00",
  }));
  await writeFile(readinessReadyPath, serializeCsv(readinessCsv.headers, readyRecords));

  await runNodeScript(
    "scripts/apply-pilot-readiness-evidence.mjs",
    [
      "--write",
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
      `--file=${readinessReadyPath}`,
      "--phase=pre-pilot",
      "--actor-user-id=user-admin",
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );

  const readinessResult = await pool.query("select data from app_runtime_state where key = $1", ["pilot-import-smoke"]);
  const readinessDb = readinessResult.rows[0]?.data;
  assert.equal(
    readinessDb.pilotReadinessChecks.filter((check) => check.status === "verified").length,
    7,
    "PostgreSQL readiness apply must verify pre-pilot readiness checks",
  );
  assert.equal(
    readinessDb.pilotReadinessChecks.find((check) => check.id === "pilot-retro")?.status,
    "pending",
    "PostgreSQL readiness apply must leave pilot-retro pending in pre-pilot phase",
  );
  assert.equal(
    readinessDb.auditLogs.filter((log) => log.action === "pilot_readiness.update").length,
    7,
    "PostgreSQL readiness apply must write readiness audit logs",
  );

  const rotatedAt = "2026-07-01T10:00:00.000+09:00";
  const passwordAuditLogs = readinessDb.users
    .filter((user) => user.email)
    .map((user, index) => ({
      id: `audit-postgres-password-${index}`,
      branchId: user.branchIds?.[0] ?? null,
      actorUserId: "user-admin",
      action: "auth.password_reset.complete",
      targetType: "user",
      targetId: user.id,
      before: { passwordUpdatedAt: user.passwordUpdatedAt ?? null },
      after: { issuedAt: rotatedAt, mode: "generated", reason: "PostgreSQL 파일럿 계정별 임시 비밀번호 교체" },
      result: "success",
      message: "임시 비밀번호를 발급했습니다.",
      createdAt: rotatedAt,
    }));
  const rotatedDb = {
    ...readinessDb,
    users: readinessDb.users.map((user, index) =>
      user.email
        ? {
            ...user,
            passwordHash: createPasswordHash(`postgres-pilot-password-${index}`, `postgres-pilot-${index}`),
            passwordUpdatedAt: rotatedAt,
          }
        : user,
    ),
    auditLogs: [...passwordAuditLogs, ...readinessDb.auditLogs],
  };
  await pool.query(
    `
      update app_runtime_state
      set data = $2::jsonb, revision = revision + 1, updated_at = now()
      where key = $1
    `,
    ["pilot-import-smoke", JSON.stringify(rotatedDb)],
  );

  const passwordRotationDraftPath = join(directory, "pilot-password-rotation.csv");
  await runNodeScript(
    "scripts/create-pilot-password-rotation-draft.mjs",
    [
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
      `--out=${passwordRotationDraftPath}`,
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );
  const passwordRotationResult = await runNodeScript(
    "scripts/check-pilot-password-rotation.mjs",
    [
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
      `--file=${passwordRotationDraftPath}`,
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );
  const passwordRotationReport = JSON.parse(passwordRotationResult.stdout.trim());
  assert.equal(passwordRotationReport.ok, true, "PostgreSQL password rotation evidence must pass after password audit logs");
  assert.equal(passwordRotationReport.runtime.driver, "postgres", "password rotation report must read PostgreSQL runtime");
  assert.equal(passwordRotationReport.users, 8, "PostgreSQL password rotation report must include pilot email users");
  assert.equal(passwordRotationReport.statusCounts.verified, 8, "PostgreSQL password rotation draft must prefill verified users");

  const launchPackagePath = join(directory, "pilot-launch-package.postgres.json");
  const launchEvidencePath = join(directory, "pilot-launch-package-evidence.json");
  const launchEvidenceMarkdownPath = join(directory, "pilot-launch-package-evidence.md");
  const launchPreflightPath = join(directory, "pilot-launch-package-preflight.json");
  const launchPackageResult = await runNodeScript(
    "scripts/create-pilot-launch-package.mjs",
    [
      "--allow-incomplete",
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
      `--postgres-url=${connectionString}`,
      `--readiness-evidence=${readinessReadyPath}`,
      `--password-rotation=${passwordRotationDraftPath}`,
      `--out=${launchPackagePath}`,
      `--evidence-out=${launchEvidencePath}`,
      `--evidence-markdown=${launchEvidenceMarkdownPath}`,
      `--preflight-out=${launchPreflightPath}`,
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );
  const launchPackageText = await readFile(launchPackagePath, "utf8");
  const launchPackageReport = JSON.parse(launchPackageResult.stdout.trim());
  const rawPostgresCredential = `${user}:${password}@`;
  const redactedPostgresUrl = connectionString.replace(rawPostgresCredential, `${user}:REDACTED@`);

  assert(!launchPackageResult.stdout.includes(rawPostgresCredential), "PostgreSQL launch package stdout must redact database passwords");
  assert(!launchPackageText.includes(rawPostgresCredential), "PostgreSQL launch package file must redact database passwords");
  assert.equal(launchPackageReport.runtime.driver, "postgres", "PostgreSQL launch package must record runtime driver");
  assert.equal(launchPackageReport.runtime.stateKey, "pilot-import-smoke", "PostgreSQL launch package must record runtime state key");
  assert.equal(launchPackageReport.runtime.table, "app_runtime_state", "PostgreSQL launch package must record runtime table");
  assert.equal(launchPackageReport.runtime.connectionString, redactedPostgresUrl, "PostgreSQL launch package must record only the redacted connection string");
  assert.equal(launchPackageReport.csv.readinessEvidence.ok, true, "PostgreSQL launch package must validate readiness evidence");
  assert.equal(launchPackageReport.security.passwordRotation.ok, true, "PostgreSQL launch package must validate password rotation evidence");
  assert.equal(launchPackageReport.artifacts.evidencePre.mode, "pre-pilot", "PostgreSQL launch package must write pre-pilot evidence");
  assert(launchPackageReport.commands.launchPackage.includes("--driver=postgres"), "PostgreSQL launch package command must include runtime driver");
  assert(
    launchPackageReport.commands.launchPackage.includes(`--postgres-url=${redactedPostgresUrl}`),
    "PostgreSQL launch package command must include redacted runtime URL",
  );

  const pilotStatusResult = await runNodeScript(
    "scripts/check-pilot-status.mjs",
    [
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
      `--postgres-url=${connectionString}`,
      `--preflight-pre=${join(directory, "pilot-status-preflight-pre.json")}`,
      `--evidence-pre=${join(directory, "pilot-status-evidence-pre.json")}`,
      `--evidence-pre-markdown=${join(directory, "pilot-status-evidence-pre.md")}`,
      `--readiness-evidence=${readinessReadyPath}`,
      `--launch-package=${join(directory, "pilot-status-launch-package.json")}`,
      `--password-rotation=${passwordRotationDraftPath}`,
      `--preflight-post=${join(directory, "pilot-status-preflight-post.json")}`,
      `--evidence-post=${join(directory, "pilot-status-evidence-post.json")}`,
      `--field=${join(directory, "pilot-status-field.json")}`,
      `--closeout=${join(directory, "pilot-status-closeout.json")}`,
      `--artifact-manifest=${join(directory, "pilot-status-artifact-manifest.json")}`,
      `--archive-manifest=${join(directory, "pilot-status-archive-manifest.json")}`,
      `--storage-receipt=${join(directory, "pilot-status-storage-receipt.json")}`,
      `--final-handoff=${join(directory, "pilot-status-final-handoff.json")}`,
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );
  const pilotStatusReport = JSON.parse(pilotStatusResult.stdout.trim());
  assert.equal(pilotStatusReport.artifacts.runtime.status, "waiting", "pilot status must read PostgreSQL runtime state and detect pending retro readiness");
  assert.equal(pilotStatusReport.artifacts.runtime.runtime.driver, "postgres", "pilot status must report PostgreSQL driver");
  assert.equal(pilotStatusReport.artifacts.runtime.runtime.key, "pilot-import-smoke", "pilot status must report PostgreSQL state key");
  assert.equal(pilotStatusReport.artifacts.runtime.counts.pendingReadinessChecks, 1, "pilot status must report pending PostgreSQL readiness checks");
  assert.equal(pilotStatusReport.artifacts.readinessEvidence.status, "ready", "pilot status must validate readiness evidence CSV");
  assert.equal(pilotStatusReport.artifacts.passwordRotation.status, "ready", "pilot status must validate password rotation CSV against PostgreSQL");
  assert.equal(pilotStatusReport.phase, "runtime", "pilot status should stop first on the pending runtime readiness gate");
  assert(
    pilotStatusReport.checked.includes("runtime source driver: postgres"),
    "pilot status must record the PostgreSQL runtime source check",
  );

  const prelaunchDraftDir = join(directory, "pilot-prelaunch-postgres");
  const prelaunchSummaryPath = join(prelaunchDraftDir, "pilot-prelaunch-draft.json");
  const prelaunchResult = await runNodeScript(
    "scripts/create-pilot-prelaunch-draft.mjs",
    [
      `--out-dir=${prelaunchDraftDir}`,
      `--summary-out=${prelaunchSummaryPath}`,
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
      `--postgres-url=${connectionString}`,
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );
  const prelaunchSummaryText = await readFile(prelaunchSummaryPath, "utf8");
  const prelaunchSummary = JSON.parse(prelaunchResult.stdout.trim());
  const prelaunchStatusText = await readFile(prelaunchSummary.artifacts.status.path, "utf8");
  const prelaunchLaunchPackageText = await readFile(prelaunchSummary.artifacts.launchPackage.path, "utf8");

  assert(!prelaunchResult.stdout.includes(rawPostgresCredential), "PostgreSQL prelaunch draft stdout must redact database passwords");
  assert(!prelaunchSummaryText.includes(rawPostgresCredential), "PostgreSQL prelaunch draft summary must redact database passwords");
  assert(!prelaunchStatusText.includes(rawPostgresCredential), "PostgreSQL prelaunch draft status artifact must redact database passwords");
  assert(!prelaunchLaunchPackageText.includes(rawPostgresCredential), "PostgreSQL prelaunch draft launch package must redact database passwords");
  assert.equal(prelaunchSummary.runtime.driver, "postgres", "PostgreSQL prelaunch draft must report runtime driver");
  assert.equal(prelaunchSummary.runtime.stateKey, "pilot-import-smoke", "PostgreSQL prelaunch draft must report runtime state key");
  assert.equal(prelaunchSummary.runtime.connectionString, redactedPostgresUrl, "PostgreSQL prelaunch draft must report only the redacted connection string");
  assert.equal(prelaunchSummary.artifacts.status.releaseDecision, "blocked", "PostgreSQL prelaunch draft should preserve blocked status until post-pilot evidence");
  assert(
    prelaunchSummary.commands.statusStrict.includes(`--postgres-url=${redactedPostgresUrl}`),
    "PostgreSQL prelaunch draft status command must include redacted runtime URL",
  );
  assert(
    prelaunchSummary.commands.launchPackageAudit.includes("--driver=postgres"),
    "PostgreSQL prelaunch draft launch package command must include runtime driver",
  );
  assert(
    prelaunchSummary.commands.launchPackageAudit.includes(`--postgres-url=${redactedPostgresUrl}`),
    "PostgreSQL prelaunch draft launch package command must include redacted runtime URL",
  );

  await pool.end();
  verificationPool = null;

  const evidenceResult = await runNodeScript(
    "scripts/export-pilot-evidence.mjs",
    [
      "--format=json",
      "--driver=postgres",
      "--state-key=pilot-import-smoke",
    ],
    {
      ...process.env,
      FINAL_JUDO_POSTGRES_URL: connectionString,
    },
  );
  const evidenceReport = JSON.parse(evidenceResult.stdout.trim());

  assert.equal(evidenceReport.runtime.driver, "postgres", "pilot evidence must read PostgreSQL runtime state");
  assert.equal(evidenceReport.runtime.key, "pilot-import-smoke", "pilot evidence must report PostgreSQL state key");
  assert.equal(evidenceReport.counts.branches, 2, "pilot evidence must include PostgreSQL branch count");
  assert.equal(evidenceReport.counts.users, 8, "pilot evidence must include PostgreSQL pilot users");
  assert.equal(evidenceReport.counts.requiredReadiness, 7, "pilot evidence must include pre-pilot readiness count");
  assert.equal(evidenceReport.counts.requiredReadinessVerified, 7, "pilot evidence must include PostgreSQL readiness apply results");
  assert(
    !evidenceReport.preflight.blockerCodes.includes("PILOT_READINESS_INCOMPLETE"),
    "pilot evidence must not report readiness blockers after PostgreSQL readiness apply",
  );
  assert(
    !evidenceReport.preflight.blockerCodes.includes("DEFAULT_PASSWORD_ACTIVE"),
    "pilot evidence must clear default password blockers after PostgreSQL password rotation evidence",
  );

  await store.reset();
  await store.close();
  closeServerDbFn = null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "Docker PostgreSQL connection",
          "runtime table bootstrap",
          "runtime store reset on PostgreSQL",
          "runtime store write/read persistence",
          "cross-instance PostgreSQL advisory lock",
          "PostgreSQL validateWrite previous-state and stale-merge enforcement",
          "locked PostgreSQL read/write commit and rollback",
          "cross-instance stale snapshot merge",
          "concurrent phone registration uniqueness on PostgreSQL runtime",
          "concurrent payment route idempotency on PostgreSQL runtime",
          "cross-domain payment and attendance stale revision merge",
          "revision status",
          "JSONB row verification",
          "pilot CSV import to PostgreSQL runtime store",
          "pilot readiness evidence draft from PostgreSQL runtime store",
          "pilot readiness evidence apply to PostgreSQL runtime store",
          "pilot password rotation evidence against PostgreSQL runtime store",
          "pilot launch package against PostgreSQL runtime store",
          "pilot status report from PostgreSQL runtime store",
          "pilot prelaunch draft against PostgreSQL runtime store",
          "pilot evidence report from PostgreSQL runtime store",
        ],
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (verificationPool) {
      await verificationPool.end().catch(() => undefined);
      verificationPool = null;
    }
    if (closeServerDbFn) {
      await closeServerDbFn().catch(() => undefined);
    }
    await docker(["rm", "-f", container]).catch(() => undefined);
    if (process.exitCode) {
      process.exit(process.exitCode);
    }
  });
