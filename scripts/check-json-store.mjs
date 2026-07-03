import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { rollSeededDemoDates } = await import("../src/server/demo-date-roll.ts");
const { createJsonStore } = await import("../src/server/json-store.ts");

function createDefaultStoreData() {
  return {
    version: 1,
    rows: [],
  };
}

function validateStoreData(value) {
  assert.equal(typeof value, "object", "store value must be an object");
  assert.notEqual(value, null, "store value must not be null");
  assert.equal(typeof value.version, "number", "store version must be a number");
  assert(Array.isArray(value.rows), "store rows must be an array");
  return value;
}

const directory = await mkdtemp(path.join(tmpdir(), "final-judo-json-store-"));

function relativeDateTime(dayOffset, hour, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

function relativeDate(dayOffset) {
  return relativeDateTime(dayOffset, 9).slice(0, 10);
}

try {
  const store = createJsonStore({
    directory,
    fileName: "store.json",
    createDefault: createDefaultStoreData,
    validate: validateStoreData,
    backupLimit: 3,
  });

  const seeded = await store.read();
  assert.deepEqual(seeded, createDefaultStoreData(), "missing store must create default data");

  await store.write({ version: 2, rows: ["alpha"] });
  await store.write({ version: 3, rows: ["alpha", "beta"] });
  await store.write({ version: 4, rows: ["alpha", "beta", "gamma"] });
  await store.write({ version: 5, rows: ["alpha", "beta", "gamma", "delta"] });

  const persisted = JSON.parse(await readFile(store.paths.dataFile, "utf8"));
  assert.equal(persisted.version, 5, "primary store must contain the latest write");

  const status = await store.status();
  assert.equal(status.backupCount, 3, "backup pruning must keep the configured backup limit");
  assert(status.latestBackup?.endsWith(".bak"), "latest backup path must point to a backup file");

  await writeFile(store.paths.dataFile, "{ invalid json", "utf8");

  const recoveredStore = createJsonStore({
    directory,
    fileName: "store.json",
    createDefault: createDefaultStoreData,
    validate: validateStoreData,
    backupLimit: 3,
  });
  const recovered = await recoveredStore.read();
  assert.equal(recovered.version, 5, "corrupt primary must recover the latest valid backup");
  assert.deepEqual(recovered.rows, ["alpha", "beta", "gamma", "delta"], "recovered rows must match the latest backup");

  await writeFile(store.paths.dataFile, JSON.stringify({ version: 6, rows: "not-array" }), "utf8");
  const shapeRecoveredStore = createJsonStore({
    directory,
    fileName: "store.json",
    createDefault: createDefaultStoreData,
    validate: validateStoreData,
    backupLimit: 3,
  });
  const shapeRecovered = await shapeRecoveredStore.read();
  assert.equal(shapeRecovered.version, 5, "invalid store shape must also recover from backup");

  process.env.FINAL_JUDO_ROLL_DEMO_DATES = "1";
  const rolledSeedRuntime = rollSeededDemoDates({
    branches: [],
    users: [
      { id: "user-admin" },
      { id: "user-owner" },
      { id: "user-coach" },
      { id: "user-guardian" },
      { id: "user-member" },
    ],
    members: [],
    classes: [
      {
        id: "class-kids-am",
        endsAt: "2020-01-01T01:50:00.000Z",
        startsAt: "2020-01-01T01:00:00.000Z",
      },
    ],
    attendance: [],
    payments: [
      {
        id: "pay-minjae",
        dueDate: "2020-01-01",
        expiresAt: "2020-01-03",
        statusHistory: [{ changedAt: "2020-01-01T03:00:00.000Z" }],
      },
    ],
    notices: [],
    pushSubscriptions: [],
    pilotReadinessChecks: [],
    pilotIncidents: [],
    pilotOperationLogs: [],
    counselingNotes: [],
    auditLogs: [],
  });

  const rolledAuditCopyRuntime = rollSeededDemoDates({
    branches: [],
    users: [
      { id: "user-admin" },
      { id: "user-owner" },
      { id: "user-coach" },
      { id: "user-guardian" },
      { id: "user-member" },
    ],
    members: [],
    classes: [],
    attendance: [],
    payments: [],
    notices: [],
    pushSubscriptions: [],
    pilotReadinessChecks: [],
    pilotIncidents: [],
    pilotOperationLogs: [],
    counselingNotes: [],
    auditLogs: [{ id: "audit-read", message: "감사 로그를 조회했습니다." }],
  });

  process.env.FINAL_JUDO_ROLL_DEMO_DATES = "0";
  const unrolledSeedRuntime = rollSeededDemoDates({
    branches: [],
    users: [
      { id: "user-admin" },
      { id: "user-owner" },
      { id: "user-coach" },
      { id: "user-guardian" },
      { id: "user-member" },
    ],
    members: [],
    classes: [
      {
        id: "class-kids-am",
        endsAt: "2020-01-01T01:50:00.000Z",
        startsAt: "2020-01-01T01:00:00.000Z",
      },
    ],
    attendance: [],
    payments: [],
    notices: [],
    pushSubscriptions: [],
    pilotReadinessChecks: [],
    pilotIncidents: [],
    pilotOperationLogs: [],
    counselingNotes: [],
    auditLogs: [],
  });

  const rolledKidsClass = rolledSeedRuntime.classes.find((session) => session.id === "class-kids-am");
  const rolledMemberPayment = rolledSeedRuntime.payments.find((payment) => payment.id === "pay-minjae");

  assert.equal(rolledKidsClass?.startsAt, relativeDateTime(0, 10), "seeded runtime class date must roll to today");
  assert.equal(rolledKidsClass?.endsAt, relativeDateTime(0, 10, 50), "seeded runtime class end date must roll to today");
  assert.equal(rolledMemberPayment?.dueDate, relativeDate(-2), "seeded runtime payment due date must roll relatively");
  assert.equal(rolledMemberPayment?.expiresAt, relativeDate(2), "seeded runtime payment expiry date must roll relatively");
  assert.equal(
    rolledMemberPayment?.statusHistory.at(0)?.changedAt,
    relativeDateTime(-32, 12),
    "seeded runtime payment history date must roll relatively",
  );
  assert.equal(
    unrolledSeedRuntime.classes.find((session) => session.id === "class-kids-am")?.startsAt,
    "2020-01-01T01:00:00.000Z",
    "demo date rolling must be disabled by FINAL_JUDO_ROLL_DEMO_DATES=0",
  );
  assert.equal(
    rolledAuditCopyRuntime.auditLogs.at(0)?.message,
    "변경 기록을 조회했습니다.",
    "seeded runtime audit log copy must use app-safe change record wording",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "default data bootstrap",
          "atomic primary write",
          "backup snapshot pruning",
          "corrupt JSON recovery",
          "invalid shape recovery",
          "stale seeded runtime dates roll without resetting the DB",
          "stale seeded runtime audit copy uses change record wording",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
