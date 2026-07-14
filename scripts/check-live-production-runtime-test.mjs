import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  assessLiveProductionRuntime,
  createMinimumDataFingerprint,
  inspectLiveProductionRuntime,
  parsePostgresConnectionIdentity,
} from "./check-live-production-runtime.mjs";

const connectionString = "postgresql://runtime_user:never-print-this@ep-safe.neon.tech/final_judo";
const connectionIdentity = parsePostgresConnectionIdentity(connectionString);
const expectedInstallationId = "final-judo-production-01";
const safePasswordHash = (() => {
  const salt = "safe-test-salt";
  const iterations = 120_000;
  const hash = pbkdf2Sync("UniqueProductionPassword!42", salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
})();
const legacyDefaultHash =
  "pbkdf2_sha256$120000$final-judo-mvp-pilot$135f6e2970d7f8641323bed2c55add3696cc473e1b9d21ab286077be22ed7cf0";

function runtimeFixture() {
  return {
    branches: [{ id: "branch-1", status: "active" }],
    users: [{
      id: "admin-1",
      role: "admin",
      branchIds: ["branch-1"],
      passwordHash: safePasswordHash,
    }],
    members: [{ id: "member-1" }],
    classes: [{ id: "class-1" }],
    attendance: [{ id: "attendance-1" }],
    payments: [{ id: "payment-1" }],
    notices: [{ id: "notice-1" }],
    authSessions: [],
    auditLogs: [],
  };
}

class MockReadOnlyClient {
  constructor({ db = runtimeFixture(), revision = "41", installationId = expectedInstallationId, failStateRead = false } = {}) {
    this.db = db;
    this.revision = revision;
    this.installationId = installationId;
    this.failStateRead = failStateRead;
    this.queries = [];
  }

  async query(text, values = []) {
    const sql = text.replace(/\s+/g, " ").trim();
    this.queries.push({ sql, values });

    if (sql.includes("current_database()")) {
      return {
        rows: [{
          database_name: "final_judo",
          database_user: "runtime_user",
          transaction_read_only: "on",
        }],
      };
    }
    if (sql.includes("FROM app_runtime_state")) {
      if (this.failStateRead) {
        throw new Error("mock state read failed");
      }
      return {
        rows: this.db === null
          ? []
          : [{
              data: this.db,
              revision: this.revision,
              installation_id: this.installationId,
              updated_at: new Date("2026-07-15T00:00:00.000Z"),
            }],
      };
    }

    return { rows: [] };
  }
}

const client = new MockReadOnlyClient();
const report = await inspectLiveProductionRuntime({
  client,
  connectionIdentity,
  stateTable: "app_runtime_state",
  stateKey: "mvp",
  expectedInstallationId,
  expectedRevision: 41,
  checkedAt: new Date("2026-07-15T01:00:00.000Z"),
});

assert.equal(report.ok, true, JSON.stringify(report.blockers));
assert.equal(report.runtime.state.revision, 41);
assert.equal(report.runtime.identity.databaseName, "final_judo");
assert.equal(report.runtime.identity.installationIdentityVerified, true);
assert.equal(report.counts.activeBranches, 1);
assert.match(report.runtime.identity.fingerprint, /^[a-f0-9]{64}$/);
assert.match(report.minimumDataFingerprint.value, /^[a-f0-9]{64}$/);
assert.match(client.queries[0].sql, /REPEATABLE READ READ ONLY$/);
assert.equal(client.queries.at(-1).sql, "COMMIT");
assert(client.queries.some(({ sql }) => sql.includes("set_config('statement_timeout'")));
assert(client.queries.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql)));

const serializedReport = JSON.stringify(report);
assert(!serializedReport.includes("never-print-this"));
assert(!serializedReport.includes(connectionString));
assert(!serializedReport.includes("FinalJudoPilot!2026"));
assert(!serializedReport.includes(safePasswordHash));
assert(!serializedReport.includes("admin-1"));
assert(!serializedReport.includes(expectedInstallationId));

const expectedIdentityClient = new MockReadOnlyClient();
const expectedIdentityReport = await inspectLiveProductionRuntime({
  client: expectedIdentityClient,
  connectionIdentity,
  expectedInstallationId,
  expectedRuntimeIdentity: report.runtime.identity.fingerprint,
});
assert.equal(expectedIdentityReport.ok, true);

const expectedDataClient = new MockReadOnlyClient();
const expectedDataReport = await inspectLiveProductionRuntime({
  client: expectedDataClient,
  connectionIdentity,
  expectedInstallationId,
  expectedDataFingerprint: report.minimumDataFingerprint.value,
});
assert.equal(expectedDataReport.ok, true);

const mismatchedDataReport = await inspectLiveProductionRuntime({
  client: new MockReadOnlyClient(),
  connectionIdentity,
  expectedInstallationId,
  expectedDataFingerprint: "f".repeat(64),
});
assert.equal(mismatchedDataReport.ok, false);
assert(mismatchedDataReport.blockers.some(({ code }) => code === "EXPECTED_DATA_FINGERPRINT_MATCH"));

const mismatchedInstallationReport = await inspectLiveProductionRuntime({
  client: new MockReadOnlyClient({ installationId: "other-production-install-01" }),
  connectionIdentity,
  expectedInstallationId,
});
assert.equal(mismatchedInstallationReport.ok, false);
assert(mismatchedInstallationReport.blockers.some(({ code }) => code === "INSTALLATION_IDENTITY_MATCH"));
assert(!JSON.stringify(mismatchedInstallationReport).includes("other-production-install-01"));
assert(!JSON.stringify(mismatchedInstallationReport).includes(expectedInstallationId));

const mismatchedIdentityReport = assessLiveProductionRuntime({
  connectionIdentity,
  databaseIdentity: {
    database_name: "final_judo",
    database_user: "runtime_user",
    transaction_read_only: "on",
  },
  stateRow: { data: runtimeFixture(), revision: "41", updated_at: "2026-07-15T00:00:00.000Z" },
  expectedInstallationId,
  expectedRuntimeIdentity: "0".repeat(64),
});
assert.equal(mismatchedIdentityReport.ok, false);
assert(mismatchedIdentityReport.blockers.some(({ code }) => code === "EXPECTED_RUNTIME_IDENTITY_MATCH"));

const sharedPasswordDb = runtimeFixture();
sharedPasswordDb.users[0].passwordHash = legacyDefaultHash;
const sharedPasswordReport = await inspectLiveProductionRuntime({
  client: new MockReadOnlyClient({ db: sharedPasswordDb }),
  connectionIdentity,
  expectedInstallationId,
});
assert.equal(sharedPasswordReport.ok, false);
assert(sharedPasswordReport.blockers.some(({ code }) => code === "SHARED_DEFAULT_PASSWORD_RETIRED"));
assert(!JSON.stringify(sharedPasswordReport).includes(legacyDefaultHash));

const sparseDb = runtimeFixture();
sparseDb.members = [];
sparseDb.users = [{ id: "member-user", role: "member", branchIds: ["branch-1"], passwordHash: safePasswordHash }];
const sparseReport = await inspectLiveProductionRuntime({
  client: new MockReadOnlyClient({ db: sparseDb }),
  connectionIdentity,
  expectedInstallationId,
});
assert.equal(sparseReport.ok, false);
assert(sparseReport.blockers.some(({ code }) => code === "MINIMUM_DATA_COUNTS"));
assert(sparseReport.blockers.some(({ code }) => code === "REQUIRED_ADMIN_PRESENT"));

const absentStateReport = await inspectLiveProductionRuntime({
  client: new MockReadOnlyClient({ db: null }),
  connectionIdentity,
  expectedInstallationId,
});
assert.equal(absentStateReport.ok, false);
assert(absentStateReport.blockers.some(({ code }) => code === "RUNTIME_STATE_ROW_PRESENT"));

const failingClient = new MockReadOnlyClient({ failStateRead: true });
await assert.rejects(
  inspectLiveProductionRuntime({ client: failingClient, connectionIdentity, expectedInstallationId }),
  /mock state read failed/,
);
assert.equal(failingClient.queries.at(-1).sql, "ROLLBACK");

const reorderedDb = runtimeFixture();
reorderedDb.members = [{ id: "member-2" }, { id: "member-1" }];
const inverseDb = runtimeFixture();
inverseDb.members = [{ id: "member-1" }, { id: "member-2" }];
assert.equal(createMinimumDataFingerprint(reorderedDb).value, createMinimumDataFingerprint(inverseDb).value);

assert.deepEqual(connectionIdentity, {
  databaseName: "final_judo",
  databaseUser: "runtime_user",
  host: "ep-safe.neon.tech",
  port: 5432,
});

const rejectedSecretArgument = spawnSync(
  process.execPath,
  ["scripts/check-live-production-runtime.mjs", "--postgres-url=postgresql://user:cli-secret@host/db"],
  { cwd: process.cwd(), encoding: "utf8" },
);
assert.notEqual(rejectedSecretArgument.status, 0);
assert(!rejectedSecretArgument.stdout.includes("cli-secret"));
assert(!rejectedSecretArgument.stderr.includes("cli-secret"));

console.log(JSON.stringify({
  ok: true,
  checked: [
    "repeatable-read read-only SQL only",
    "configured and connected runtime identity",
    "state row revision and minimum data fingerprint",
    "accepted credentialed administrator",
    "retired shared password rejection without hash disclosure",
    "rollback after mocked read failure",
    "CLI database secret rejection",
  ],
}, null, 2));
