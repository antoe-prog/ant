import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  AdminCredentialRecoveryError,
  prepareAdminCredentialRecovery,
  recoverAdminCredential,
} from "./recover-admin-credential.mjs";
import { parsePostgresConnectionIdentity } from "./check-live-production-runtime.mjs";

const recoveryPassword = "RecoveryOnly!2026-Strong";
const reason = "P0 operator-approved administrator credential recovery";
const expectedInstallationId = "final-judo-production-01";
const connectionIdentity = parsePostgresConnectionIdentity(
  "postgresql://runtime_user:database-secret@ep-runtime.neon.tech/final_judo",
);

function runtimeFixture() {
  return {
    branches: [{ id: "branch-1" }],
    users: [
      {
        id: "admin-actor",
        role: "admin",
        branchIds: ["branch-1"],
        passwordHash: "actor-existing-hash",
      },
      {
        id: "admin-target",
        role: "admin",
        branchIds: ["branch-1"],
        passwordHash: "target-existing-hash",
        passwordResetRequestedAt: "2026-07-14T00:00:00.000Z",
        passwordUpdatedAt: "2026-07-13T00:00:00.000Z",
      },
      {
        id: "member-1",
        role: "member",
        branchIds: ["branch-1"],
        passwordHash: "member-existing-hash",
      },
    ],
    authSessions: [
      { id: "session-active", userId: "admin-target", tokenHash: "hash-1" },
      { id: "session-old", userId: "admin-target", tokenHash: "hash-2", revokedAt: "2026-07-12T00:00:00.000Z" },
      { id: "session-actor", userId: "admin-actor", tokenHash: "hash-3" },
    ],
    auditLogs: [],
  };
}

class MockRecoveryClient {
  constructor({ db = runtimeFixture(), revision = 73, updateRevision = 74, installationId = expectedInstallationId } = {}) {
    this.db = db;
    this.revision = revision;
    this.updateRevision = updateRevision;
    this.installationId = installationId;
    this.queries = [];
    this.updatedDb = null;
  }

  async query(text, values = []) {
    const sql = text.replace(/\s+/g, " ").trim();
    this.queries.push({ sql, values });

    if (sql.includes("current_database()")) {
      return { rows: [{ database_name: "final_judo", database_user: "runtime_user" }] };
    }
    if (sql.includes("FROM app_runtime_state") && sql.endsWith("FOR UPDATE")) {
      return {
        rows: this.db === null
          ? []
          : [{
              data: this.db,
              revision: String(this.revision),
              installation_id: this.installationId,
              updated_at: new Date("2026-07-15T00:00:00.000Z"),
            }],
      };
    }
    if (sql.startsWith("UPDATE app_runtime_state")) {
      this.updatedDb = JSON.parse(values[1]);
      return { rows: [{ revision: String(this.updateRevision), updated_at: new Date("2026-07-15T01:00:00.000Z") }] };
    }

    return { rows: [] };
  }
}

const prepared = prepareAdminCredentialRecovery({
  db: runtimeFixture(),
  actorUserId: "admin-actor",
  targetUserId: "admin-target",
  reason,
  password: recoveryPassword,
  expectedRevision: 73,
  recoveredAt: new Date("2026-07-15T00:30:00.000Z"),
  auditId: "audit-recovery-fixed",
  passwordHash: "pbkdf2_sha256$120000$fixed$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});
const preparedTarget = prepared.nextDb.users.find(({ id }) => id === "admin-target");
const preparedAudit = prepared.nextDb.auditLogs[0];

assert.equal(preparedTarget.passwordResetRequestedAt, undefined);
assert.equal(preparedTarget.passwordUpdatedAt, "2026-07-15T00:30:00.000Z");
assert.equal(prepared.revokedSessions, 1);
assert.equal(prepared.nextDb.authSessions.find(({ id }) => id === "session-active").revokedAt, "2026-07-15T00:30:00.000Z");
assert.equal(prepared.nextDb.authSessions.find(({ id }) => id === "session-old").revokedAt, "2026-07-12T00:00:00.000Z");
assert.equal(prepared.nextDb.authSessions.find(({ id }) => id === "session-actor").revokedAt, undefined);
assert.equal(preparedAudit.actorUserId, "admin-actor");
assert.equal(preparedAudit.targetId, "admin-target");
assert.equal(preparedAudit.after.reason, reason);
assert.equal(preparedAudit.after.expectedRevision, 73);
assert.equal(preparedAudit.after.sessionsRevoked, 1);
assert(!JSON.stringify(preparedAudit).includes(recoveryPassword));
assert(!Object.hasOwn(preparedAudit.before, "passwordHash"));
assert(!Object.hasOwn(preparedAudit.after, "passwordHash"));

const validateClient = new MockRecoveryClient();
const validateReport = await recoverAdminCredential({
  client: validateClient,
  connectionIdentity,
  expectedInstallationId,
  actorUserId: "admin-actor",
  targetUserId: "admin-target",
  reason,
  password: recoveryPassword,
  expectedRevision: 73,
  recoveredAt: new Date("2026-07-15T00:30:00.000Z"),
  auditId: "audit-validate",
  passwordHash: "pbkdf2_sha256$120000$fixed$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
});

assert.equal(validateReport.mode, "validate-only");
assert.equal(validateReport.applied, false);
assert.equal(validateReport.runtime.lockedRevision, 73);
assert.equal(validateReport.runtime.wouldBecomeRevision, 74);
assert.equal(validateClient.updatedDb, null);
assert.equal(validateClient.queries.at(-1).sql, "ROLLBACK");
assert(validateClient.queries.some(({ sql }) => sql.includes("pg_advisory_xact_lock")));
assert(validateClient.queries.some(({ sql }) => sql.endsWith("FOR UPDATE")));
assert(!JSON.stringify(validateReport).includes(recoveryPassword));
assert(!JSON.stringify(validateReport).includes("database-secret"));
assert(!JSON.stringify(validateReport).includes(expectedInstallationId));

const approvalClient = new MockRecoveryClient();
await assert.rejects(
  recoverAdminCredential({
    client: approvalClient,
    connectionIdentity,
    expectedInstallationId,
    actorUserId: "admin-actor",
    targetUserId: "admin-target",
    reason,
    password: recoveryPassword,
    expectedRevision: 73,
    mode: "apply",
  }),
  (error) => error instanceof AdminCredentialRecoveryError && error.code === "RECOVERY_APPROVAL_REQUIRED",
);
assert.equal(approvalClient.queries.length, 0);

const weakPasswordClient = new MockRecoveryClient();
await assert.rejects(
  recoverAdminCredential({
    client: weakPasswordClient,
    connectionIdentity,
    expectedInstallationId,
    actorUserId: "admin-actor",
    targetUserId: "admin-target",
    reason,
    password: "short",
    expectedRevision: 73,
  }),
  (error) => error instanceof AdminCredentialRecoveryError && error.code === "WEAK_RECOVERY_PASSWORD",
);
assert.equal(weakPasswordClient.queries.length, 0);

const applyClient = new MockRecoveryClient();
const applyReport = await recoverAdminCredential({
  client: applyClient,
  connectionIdentity,
  expectedInstallationId,
  actorUserId: "admin-actor",
  targetUserId: "admin-target",
  reason,
  password: recoveryPassword,
  expectedRevision: 73,
  mode: "apply",
  approved: true,
  recoveredAt: new Date("2026-07-15T00:45:00.000Z"),
  auditId: "audit-apply",
  passwordHash: "pbkdf2_sha256$120000$fixed$cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
});

assert.equal(applyReport.applied, true);
assert.equal(applyReport.runtime.resultingRevision, 74);
assert.equal(applyClient.queries.at(-1).sql, "COMMIT");
assert(applyClient.updatedDb);
assert.equal(applyClient.updatedDb.auditLogs[0].actorUserId, "admin-actor");
assert.equal(applyClient.updatedDb.auditLogs[0].after.reason, reason);
assert.equal(applyClient.updatedDb.authSessions.find(({ id }) => id === "session-active").revokedAt, "2026-07-15T00:45:00.000Z");
assert.equal(applyClient.queries.find(({ sql }) => sql.startsWith("UPDATE app_runtime_state")).values[2], 73);
assert(!JSON.stringify(applyClient.updatedDb.auditLogs[0]).includes(recoveryPassword));

const revisionClient = new MockRecoveryClient({ revision: 74 });
await assert.rejects(
  recoverAdminCredential({
    client: revisionClient,
    connectionIdentity,
    expectedInstallationId,
    actorUserId: "admin-actor",
    targetUserId: "admin-target",
    reason,
    password: recoveryPassword,
    expectedRevision: 73,
    mode: "apply",
    approved: true,
  }),
  (error) => error instanceof AdminCredentialRecoveryError && error.code === "RUNTIME_REVISION_MISMATCH",
);
assert.equal(revisionClient.updatedDb, null);
assert.equal(revisionClient.queries.at(-1).sql, "ROLLBACK");

const installationClient = new MockRecoveryClient({ installationId: "other-production-install-01" });
await assert.rejects(
  recoverAdminCredential({
    client: installationClient,
    connectionIdentity,
    expectedInstallationId,
    actorUserId: "admin-actor",
    targetUserId: "admin-target",
    reason,
    password: recoveryPassword,
    expectedRevision: 73,
  }),
  (error) => error instanceof AdminCredentialRecoveryError && error.code === "INSTALLATION_IDENTITY_MISMATCH",
);
assert.equal(installationClient.updatedDb, null);
assert.equal(installationClient.queries.at(-1).sql, "ROLLBACK");

const nonAdminTargetDb = runtimeFixture();
nonAdminTargetDb.users.find(({ id }) => id === "admin-target").role = "owner";
const nonAdminClient = new MockRecoveryClient({ db: nonAdminTargetDb });
await assert.rejects(
  recoverAdminCredential({
    client: nonAdminClient,
    connectionIdentity,
    expectedInstallationId,
    actorUserId: "admin-actor",
    targetUserId: "admin-target",
    reason,
    password: recoveryPassword,
    expectedRevision: 73,
  }),
  (error) => error instanceof AdminCredentialRecoveryError && error.code === "RECOVERY_TARGET_NOT_ADMIN",
);
assert.equal(nonAdminClient.queries.at(-1).sql, "ROLLBACK");

const rejectedPasswordArgument = spawnSync(
  process.execPath,
  ["scripts/recover-admin-credential.mjs", "--password=cli-password-secret"],
  { cwd: process.cwd(), encoding: "utf8" },
);
assert.notEqual(rejectedPasswordArgument.status, 0);
assert(!rejectedPasswordArgument.stdout.includes("cli-password-secret"));
assert(!rejectedPasswordArgument.stderr.includes("cli-password-secret"));

console.log(JSON.stringify({
  ok: true,
  checked: [
    "validate-only default with advisory and row locks",
    "separate apply approval requirement",
    "12-character minimum and retired shared password guard",
    "expected revision compare-and-update",
    "atomic password, session revocation, and audit mutation",
    "exact actor and reason audit fields",
    "rollback on revision or role mismatch",
    "secret-free reports and CLI validation",
  ],
}, null, 2));
