import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { rollSeededDemoDates } = await import("../src/server/demo-date-roll.ts");
const { createJsonStore } = await import("../src/server/json-store.ts");
const { mergeRuntimeState, RuntimeStateMergeConflictError } = await import("../src/server/runtime-state-merge.ts");
const { RuntimeStateIntegrityError, validateRuntimeStateIntegrity } = await import("../src/server/runtime-state-integrity.ts");
const { findOwnerCoverageBlockers, reassignUserOperationalLinks } = await import("../src/server/user-operational-reassignment.ts");

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

async function waitForFile(file, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await access(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  throw new Error(`Timed out waiting for ${file}`);
}

async function waitForProcess(child, label) {
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  assert.equal(exitCode, 0, `${label} failed: ${output.join("")}`);
}

function createEmptyRuntimeState() {
  return {
    branches: [],
    users: [],
    members: [],
    classes: [],
    attendance: [],
    counselingNotes: [],
    promotions: [],
    tournaments: [],
    payments: [],
    notices: [],
    pushSubscriptions: [],
    pilotReadinessChecks: [],
    pilotIncidents: [],
    pilotOperationLogs: [],
    auditLogs: [],
  };
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
  assert.deepEqual(
    JSON.parse(JSON.stringify(seeded)),
    createDefaultStoreData(),
    "missing store must create default serializable data",
  );

  await store.write({ version: 2, rows: ["alpha"] });
  await store.write({ version: 3, rows: ["alpha", "beta"] });
  await store.write({ version: 4, rows: ["alpha", "beta", "gamma"] });
  await store.write({ version: 5, rows: ["alpha", "beta", "gamma", "delta"] });

  const lockEvents = [];
  let markFirstLockStarted;
  const firstLockStarted = new Promise((resolve) => {
    markFirstLockStarted = resolve;
  });
  const firstLock = store.withLock("payment-create:user-owner:branch-gangnam:key", async () => {
    lockEvents.push("first:start");
    markFirstLockStarted();
    await new Promise((resolve) => setTimeout(resolve, 30));
    lockEvents.push("first:end");
  });

  await firstLockStarted;
  const secondLock = store.withLock("payment-create:user-owner:branch-gangnam:key", async () => {
    lockEvents.push("second:start");
    lockEvents.push("second:end");
  });

  await Promise.all([firstLock, secondLock]);
  assert.deepEqual(
    lockEvents,
    ["first:start", "first:end", "second:start", "second:end"],
    "JSON runtime locks must serialize operations with the same key",
  );

  const mergeStore = createJsonStore({
    directory,
    fileName: "merge-store.json",
    createDefault: createDefaultStoreData,
    validate: validateStoreData,
    backupLimit: 0,
    merge: (base, requested, latest) => ({
      ...latest,
      rows: [
        ...requested.rows.filter((row) => !base.rows.includes(row)),
        ...latest.rows,
      ],
      version: Math.max(requested.version, latest.version),
    }),
  });
  const sharedMergeBase = await mergeStore.read();

  await Promise.all([
    mergeStore.write({ ...sharedMergeBase, rows: ["request-a"], version: 2 }),
    mergeStore.write({ ...sharedMergeBase, rows: ["request-b"], version: 3 }),
  ]);
  assert.deepEqual(
    new Set((await mergeStore.read()).rows),
    new Set(["request-a", "request-b"]),
    "JSON runtime writes from the same base revision must merge instead of dropping a request",
  );
  assert.doesNotMatch(
    await readFile(mergeStore.paths.dataFile, "utf8"),
    /store-revision|store-base-value/,
    "runtime store revision metadata must not be serialized",
  );

  const crossInstanceOptions = {
    directory,
    fileName: "cross-instance-store.json",
    createDefault: createDefaultStoreData,
    validate: validateStoreData,
    backupLimit: 0,
    merge: (base, requested, latest) => ({
      ...latest,
      rows: [
        ...requested.rows.filter((row) => !base.rows.includes(row)),
        ...latest.rows,
      ],
      version: Math.max(requested.version, latest.version),
    }),
  };
  const crossInstanceStoreA = createJsonStore(crossInstanceOptions);
  const crossInstanceBaseA = await crossInstanceStoreA.read();
  const crossInstanceStoreB = createJsonStore(crossInstanceOptions);
  const crossInstanceBaseB = await crossInstanceStoreB.read();
  const crossInstanceObserver = createJsonStore(crossInstanceOptions);
  await crossInstanceObserver.read();

  await Promise.all([
    crossInstanceStoreA.write({ ...crossInstanceBaseA, rows: ["instance-a"], version: 2 }),
    crossInstanceStoreB.write({ ...crossInstanceBaseB, rows: ["instance-b"], version: 3 }),
  ]);
  const crossInstanceReader = createJsonStore(crossInstanceOptions);
  assert.deepEqual(
    new Set((await crossInstanceReader.read()).rows),
    new Set(["instance-a", "instance-b"]),
    "separate JSON store instances must merge stale file snapshots instead of losing a write",
  );
  assert.deepEqual(
    new Set((await crossInstanceObserver.read()).rows),
    new Set(["instance-a", "instance-b"]),
    "a cached JSON store instance must refresh changes written by other instances",
  );

  const crossInstanceLockEvents = [];
  let markCrossInstanceLockStarted;
  const crossInstanceLockStarted = new Promise((resolve) => {
    markCrossInstanceLockStarted = resolve;
  });
  const crossInstanceLockA = crossInstanceStoreA.withLock("shared-operation", async () => {
    crossInstanceLockEvents.push("a:start");
    markCrossInstanceLockStarted();
    await new Promise((resolve) => setTimeout(resolve, 30));
    crossInstanceLockEvents.push("a:end");
  });
  await crossInstanceLockStarted;
  const crossInstanceLockB = crossInstanceStoreB.withLock("shared-operation", async () => {
    crossInstanceLockEvents.push("b:start");
    crossInstanceLockEvents.push("b:end");
  });
  await Promise.all([crossInstanceLockA, crossInstanceLockB]);
  assert.deepEqual(
    crossInstanceLockEvents,
    ["a:start", "a:end", "b:start", "b:end"],
    "separate JSON store instances must share operation locks",
  );

  const processStoreOptions = {
    ...crossInstanceOptions,
    fileName: "cross-process-store.json",
  };
  const processStore = createJsonStore(processStoreOptions);
  await processStore.read();
  const workerPath = path.join(directory, "json-store-worker.mjs");
  const processReadyA = path.join(directory, "process-a.ready");
  const processReadyB = path.join(directory, "process-b.ready");
  const processGo = path.join(directory, "process.go");
  const jsonStoreModuleUrl = pathToFileURL(path.resolve("src/server/json-store.ts")).href;
  await writeFile(
    workerPath,
    `
      import { access, writeFile } from "node:fs/promises";
      import { setTimeout as delay } from "node:timers/promises";
      const [moduleUrl, directory, row, readyFile, goFile] = process.argv.slice(2);
      const { createJsonStore } = await import(moduleUrl);
      const validate = (value) => {
        if (!value || typeof value.version !== "number" || !Array.isArray(value.rows)) throw new Error("invalid worker state");
        return value;
      };
      const store = createJsonStore({
        directory,
        fileName: "cross-process-store.json",
        createDefault: () => ({ version: 1, rows: [] }),
        validate,
        backupLimit: 0,
        merge: (base, requested, latest) => ({
          ...latest,
          rows: [...requested.rows.filter((value) => !base.rows.includes(value)), ...latest.rows],
          version: Math.max(requested.version, latest.version),
        }),
      });
      const base = await store.read();
      await writeFile(readyFile, "ready");
      while (true) {
        try { await access(goFile); break; } catch { await delay(10); }
      }
      await store.write({ ...base, rows: [row], version: row === "process-a" ? 2 : 3 });
    `,
    "utf8",
  );
  const workerArgs = [
    "--experimental-transform-types",
    "--disable-warning=ExperimentalWarning",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    workerPath,
    jsonStoreModuleUrl,
    directory,
  ];
  const processA = spawn(process.execPath, [...workerArgs, "process-a", processReadyA, processGo], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const processB = spawn(process.execPath, [...workerArgs, "process-b", processReadyB, processGo], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await Promise.all([waitForFile(processReadyA), waitForFile(processReadyB)]);
  await writeFile(processGo, "go", "utf8");
  await Promise.all([waitForProcess(processA, "JSON worker A"), waitForProcess(processB, "JSON worker B")]);
  const processReader = createJsonStore(processStoreOptions);
  assert.deepEqual(
    new Set((await processReader.read()).rows),
    new Set(["process-a", "process-b"]),
    "independent JSON store processes must merge stale file snapshots instead of losing a write",
  );

  const mergeBase = {
    ...createEmptyRuntimeState(),
    users: [{ id: "user-owner", name: "기존 이름", phone: "010-1111-2222" }],
  };
  const mergeRequested = {
    ...mergeBase,
    payments: [{ id: "pay-a", memberId: "member-a", amount: 100000 }],
    users: [{ ...mergeBase.users[0], name: "변경 이름" }],
  };
  const mergeLatest = {
    ...mergeBase,
    attendance: [{ id: "attendance-a", memberId: "member-a", status: "present" }],
    users: [{ ...mergeBase.users[0], phone: "010-3333-4444" }],
  };
  const mergedRuntime = mergeRuntimeState(mergeBase, mergeRequested, mergeLatest);

  assert.equal(mergedRuntime.payments[0]?.id, "pay-a", "runtime merge must preserve requested additions");
  assert.equal(mergedRuntime.attendance[0]?.id, "attendance-a", "runtime merge must preserve concurrent additions");
  assert.deepEqual(
    mergedRuntime.users[0],
    { id: "user-owner", name: "변경 이름", phone: "010-3333-4444" },
    "runtime merge must combine disjoint field changes on the same record",
  );
  assert.throws(
    () =>
      mergeRuntimeState(
        mergeBase,
        { ...mergeBase, users: [{ ...mergeBase.users[0], name: "요청 이름" }] },
        { ...mergeBase, users: [{ ...mergeBase.users[0], name: "동시 변경 이름" }] },
      ),
    RuntimeStateMergeConflictError,
    "runtime merge must reject conflicting changes to the same field",
  );
  const paymentMergeBase = {
    ...createEmptyRuntimeState(),
    payments: [{ id: "pay-protected", amount: 100000, status: "scheduled" }],
  };
  assert.throws(
    () =>
      mergeRuntimeState(
        paymentMergeBase,
        { ...paymentMergeBase, payments: [{ ...paymentMergeBase.payments[0], amount: 110000 }] },
        {
          ...paymentMergeBase,
          payments: [{ ...paymentMergeBase.payments[0], onlinePayment: { amount: 100000, status: "pending" } }],
        },
      ),
    RuntimeStateMergeConflictError,
    "runtime merge must never combine concurrent changes to the same payment record",
  );

  const integrityBase = {
    ...createEmptyRuntimeState(),
    branches: [{ id: "branch-a" }],
    users: [
      { id: "coach-a", branchIds: ["branch-a"], email: "coach@example.test", phone: "01011112222", role: "coach" },
      { id: "owner-a", branchIds: ["branch-a"], email: "owner@example.test", phone: "01022223333", role: "owner" },
      {
        id: "member-user-a",
        branchIds: ["branch-a"],
        email: "member@example.test",
        memberIds: ["member-a"],
        phone: "01033334444",
        role: "member",
      },
    ],
    members: [{ id: "member-a", branchId: "branch-a", guardianIds: [], primaryCoachId: "coach-a" }],
    classes: [{ id: "class-a", branchId: "branch-a", coachId: "coach-a", enrolledMemberIds: ["member-a"] }],
    attendance: [{ id: "attendance-a", sessionId: "class-a", memberId: "member-a" }],
    payments: [{ id: "payment-a", branchId: "branch-a", memberId: "member-a" }],
  };
  assert.equal(validateRuntimeStateIntegrity(integrityBase), integrityBase, "valid runtime references must pass integrity checks");
  assert.throws(
    () =>
      validateRuntimeStateIntegrity({
        ...integrityBase,
        users: [
          ...integrityBase.users,
          { id: "duplicate-phone", branchIds: ["branch-a"], phone: "+82 10-3333-4444", role: "member" },
        ],
      }),
    RuntimeStateIntegrityError,
    "runtime integrity must reject normalized duplicate phone accounts",
  );
  assert.throws(
    () => validateRuntimeStateIntegrity({ ...integrityBase, users: integrityBase.users.slice(1) }),
    RuntimeStateIntegrityError,
    "runtime integrity must reject classes and members that reference a deleted coach",
  );
  assert.throws(
    () =>
      validateRuntimeStateIntegrity(
        mergeRuntimeState(
          integrityBase,
          {
            ...integrityBase,
            users: integrityBase.users.filter((user) => user.id !== "coach-a"),
            members: integrityBase.members.map((member) => ({ ...member, primaryCoachId: "owner-a" })),
            classes: integrityBase.classes.map((session) => ({ ...session, coachId: "owner-a" })),
          },
          {
            ...integrityBase,
            classes: [
              { id: "class-concurrent", branchId: "branch-a", coachId: "coach-a", enrolledMemberIds: [] },
              ...integrityBase.classes,
            ],
          },
        ),
      ),
    RuntimeStateIntegrityError,
    "runtime integrity must reject a class concurrently added for a deleted coach",
  );
  assert.throws(
    () =>
      validateRuntimeStateIntegrity(
        mergeRuntimeState(
          integrityBase,
          {
            ...integrityBase,
            users: [
              { id: "signup-a", branchIds: ["branch-a"], phone: "01099998888", role: "member" },
              ...integrityBase.users,
            ],
          },
          {
            ...integrityBase,
            users: [
              { id: "signup-b", branchIds: ["branch-a"], phone: "+82 10-9999-8888", role: "member" },
              ...integrityBase.users,
            ],
          },
        ),
      ),
    RuntimeStateIntegrityError,
    "runtime integrity must reject stale additions with different IDs and the same normalized phone",
  );
  const demotedUsers = integrityBase.users.map((user) =>
    user.id === "coach-a" ? { ...user, role: "member" } : user,
  );
  const demotedOperationalLinks = reassignUserOperationalLinks({
    actorUserId: "owner-a",
    db: { ...integrityBase, users: demotedUsers },
    nextBranchIds: ["branch-a"],
    nextRole: "member",
    targetUserId: "coach-a",
  });
  assert.equal(demotedOperationalLinks.classes[0]?.coachId, "owner-a", "coach role removal must reassign classes");
  assert.equal(demotedOperationalLinks.members[0]?.primaryCoachId, "owner-a", "coach role removal must reassign members");
  assert.equal(demotedOperationalLinks.reassignedClassCount, 1, "coach role removal must count reassigned classes");
  assert.equal(demotedOperationalLinks.reassignedMemberCount, 1, "coach role removal must count reassigned members");
  validateRuntimeStateIntegrity({
    ...integrityBase,
    users: demotedUsers,
    classes: demotedOperationalLinks.classes,
    members: demotedOperationalLinks.members,
  });
  assert.deepEqual(
    findOwnerCoverageBlockers(integrityBase.users.find((user) => user.id === "owner-a"), "member", ["branch-a"], integrityBase),
    ["branch-a"],
    "a sole branch owner must not be demoted before another owner is assigned",
  );

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
          "same-key runtime operation lock",
          "stale JSON snapshot merge without serialized metadata",
          "cross-instance JSON file merge, cache refresh, and operation lock",
          "cross-process JSON file merge",
          "runtime collection additions and disjoint field merge",
          "same-field runtime conflict rejection",
          "same-payment concurrent change rejection",
          "runtime identity uniqueness and reference integrity",
          "role change operational reassignment and owner coverage",
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
