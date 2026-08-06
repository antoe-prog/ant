import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { createMockData } from "../src/lib/mock-data.ts";

const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "final-judo-runtime-retention-"));
process.env.FINAL_JUDO_DATA_DIR = dataDirectory;
process.env.FINAL_JUDO_DB_DRIVER = "json";

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(process.cwd(), "src") },
});
const {
  closeServerDb,
  readServerDb,
  serverDbPaths,
  writeServerDb,
} = await jiti.import("../src/server/db.ts");
const { pruneExpiredRuntimeRetentionRecords } = await jiti.import(
  "../src/server/runtime-retention-maintenance.ts",
);
const {
  getMemberDeletionAuditRetentionExpiresAt,
  pruneExpiredMemberDeletionAuditLogs,
} = await jiti.import("../src/lib/audit-log-retention.ts");
const { pruneExpiredRetainedPaymentTransactions } = await jiti.import(
  "../src/lib/payment-transaction-retention.ts",
);

const deletionAudit = (id, createdAt) => ({
  id,
  branchId: "branch-main",
  actorUserId: "user-admin",
  action: "member.delete",
  targetType: "member",
  targetId: `deleted-${id}`,
  before: { ageGroup: "adult", branchId: "branch-main", status: "active" },
  after: { reasonRecorded: true },
  result: "success",
  message: "회원과 연결된 운영 기록을 삭제했습니다.",
  createdAt,
});
const expiredDeletionAudit = deletionAudit("audit-member-delete-expired", "2020-01-01T00:00:00.000Z");
const activeDeletionAudit = deletionAudit("audit-member-delete-active", "2026-01-01T00:00:00.000Z");
const oldGeneralAudit = {
  ...deletionAudit("audit-member-update-old", "2020-01-01T00:00:00.000Z"),
  action: "member.update",
};

const expiredRecord = {
  id: "retained-expired-test",
  branchId: "branch-main",
  memberReference: "deleted-member-expired",
  sourcePaymentId: "payment-expired",
  deletionAuditLogId: "audit-expired",
  planName: "만료 거래",
  status: "paid",
  amount: 1000,
  dueDate: "2019-01-01",
  expiresAt: "2019-02-01",
  statusHistory: [],
  retainedAt: "2020-01-01T00:00:00.000Z",
  retentionExpiresAt: "2025-01-01T00:00:00.000Z",
  legalBasis: "ecommerce_transaction_record_5y",
};
const activeRecord = {
  ...expiredRecord,
  id: "retained-active-test",
  memberReference: "deleted-member-active",
  sourcePaymentId: "payment-active",
  deletionAuditLogId: "audit-active",
  retainedAt: "2026-01-01T00:00:00.000Z",
  retentionExpiresAt: "2031-01-01T00:00:00.000Z",
};
const statutoryRecordOutlivingAudit = {
  ...expiredRecord,
  id: "retained-outliving-audit-test",
  memberReference: "deleted-member-outliving-audit",
  sourcePaymentId: "payment-outliving-audit",
  deletionAuditLogId: "audit-member-delete-outlived",
  retainedAt: "2024-01-01T00:00:00.000Z",
  retentionExpiresAt: "2029-01-01T00:00:00.000Z",
};
const outlivedDeletionAudit = deletionAudit("audit-member-delete-outlived", "2024-01-01T00:00:00.000Z");
const malformedRetentionRecord = {
  ...activeRecord,
  id: "retained-malformed-expiry-test",
  retentionExpiresAt: "not-a-retention-date",
};

try {
  assert.equal(
    getMemberDeletionAuditRetentionExpiresAt("2024-08-06T00:00:00.000Z"),
    "2026-08-06T00:00:00.000Z",
    "member deletion audit retention must use a two-calendar-year boundary",
  );
  assert.equal(
    pruneExpiredMemberDeletionAuditLogs(
      [deletionAudit("audit-boundary", "2024-08-06T00:00:00.000Z")],
      "2026-08-05T23:59:59.999Z",
    ).length,
    1,
    "member deletion audit must remain available until its retention boundary",
  );
  assert.equal(
    pruneExpiredMemberDeletionAuditLogs(
      [deletionAudit("audit-boundary", "2024-08-06T00:00:00.000Z")],
      "2026-08-06T00:00:00.000Z",
    ).length,
    0,
    "member deletion audit must be removed at its retention boundary",
  );
  assert.equal(
    pruneExpiredRetainedPaymentTransactions(
      [malformedRetentionRecord],
      "2026-08-06T00:00:00.000Z",
    ).length,
    1,
    "malformed statutory records must be preserved for explicit integrity handling",
  );

  const seeded = createMockData();
  await writeServerDb({
    ...seeded,
    auditLogs: [
      expiredDeletionAudit,
      outlivedDeletionAudit,
      activeDeletionAudit,
      oldGeneralAudit,
      ...seeded.auditLogs,
    ],
    retainedPaymentTransactions: [expiredRecord, statutoryRecordOutlivingAudit, activeRecord],
  });

  const afterWrite = await readServerDb();
  assert(!afterWrite.auditLogs.some((log) => log.id === expiredDeletionAudit.id));
  assert(!afterWrite.auditLogs.some((log) => log.id === outlivedDeletionAudit.id));
  assert(afterWrite.auditLogs.some((log) => log.id === activeDeletionAudit.id));
  assert(
    afterWrite.auditLogs.some((log) => log.id === oldGeneralAudit.id),
    "retention cleanup must not delete unrelated audit actions for active operations",
  );
  assert.deepEqual(
    afterWrite.retainedPaymentTransactions?.map((record) => record.id),
    [statutoryRecordOutlivingAudit.id, activeRecord.id],
    "every DB write must persistently remove expired transaction records",
  );
  assert(
    afterWrite.retainedPaymentTransactions?.some((record) => record.id === statutoryRecordOutlivingAudit.id),
    "the five-year statutory ledger must outlive its two-year member deletion audit",
  );
  await assert.rejects(
    () => writeServerDb({
      ...afterWrite,
      retainedPaymentTransactions: [malformedRetentionRecord, ...afterWrite.retainedPaymentTransactions],
    }),
    /retainedPaymentTransactions\.format/,
    "malformed statutory records must fail integrity validation instead of disappearing",
  );

  const staleSnapshot = afterWrite;
  assert(serverDbPaths?.dataFile, "isolated JSON test must expose its data file");
  const raw = JSON.parse(await readFile(serverDbPaths.dataFile, "utf8"));
  raw.auditLogs.push(expiredDeletionAudit);
  raw.retainedPaymentTransactions.push(expiredRecord);
  await writeFile(serverDbPaths.dataFile, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  await writeServerDb(staleSnapshot);
  const afterStaleWrite = await readServerDb({ enforceRuntimeRetention: false });
  assert(!afterStaleWrite.auditLogs.some((log) => log.id === expiredDeletionAudit.id));
  assert(!afterStaleWrite.retainedPaymentTransactions.some((record) => record.id === expiredRecord.id));

  const rawBeforeReadCleanup = JSON.parse(await readFile(serverDbPaths.dataFile, "utf8"));
  rawBeforeReadCleanup.auditLogs.push(expiredDeletionAudit);
  rawBeforeReadCleanup.retainedPaymentTransactions.push(expiredRecord);
  await writeFile(serverDbPaths.dataFile, `${JSON.stringify(rawBeforeReadCleanup, null, 2)}\n`, "utf8");

  const unfilteredRead = await readServerDb({ enforceRuntimeRetention: false });
  assert(unfilteredRead.auditLogs.some((log) => log.id === expiredDeletionAudit.id));
  assert(unfilteredRead.retainedPaymentTransactions.some((record) => record.id === expiredRecord.id));

  const afterReadCleanup = await readServerDb();
  assert(!afterReadCleanup.auditLogs.some((log) => log.id === expiredDeletionAudit.id));
  assert(!afterReadCleanup.retainedPaymentTransactions.some((record) => record.id === expiredRecord.id));

  const persistedAfterReadCleanup = JSON.parse(await readFile(serverDbPaths.dataFile, "utf8"));
  assert(!persistedAfterReadCleanup.auditLogs.some((log) => log.id === expiredDeletionAudit.id));
  assert(!persistedAfterReadCleanup.retainedPaymentTransactions.some((record) => record.id === expiredRecord.id));

  persistedAfterReadCleanup.auditLogs.push(expiredDeletionAudit);
  persistedAfterReadCleanup.retainedPaymentTransactions.push(expiredRecord);
  await writeFile(serverDbPaths.dataFile, `${JSON.stringify(persistedAfterReadCleanup, null, 2)}\n`, "utf8");

  const maintenance = await pruneExpiredRuntimeRetentionRecords("2026-08-06T00:00:00.000Z");
  assert.equal(maintenance.prunedAuditLogCount, 1);
  assert.equal(maintenance.prunedPaymentTransactionCount, 1);

  const persisted = JSON.parse(await readFile(serverDbPaths.dataFile, "utf8"));
  assert(!persisted.auditLogs.some((log) => log.id === expiredDeletionAudit.id));
  assert(persisted.auditLogs.some((log) => log.id === activeDeletionAudit.id));
  assert(persisted.auditLogs.some((log) => log.id === oldGeneralAudit.id));
  assert.deepEqual(
    persisted.retainedPaymentTransactions.map((record) => record.id),
    [statutoryRecordOutlivingAudit.id, activeRecord.id],
    "scheduled maintenance must remove expired records from the source file, not only from memory",
  );

  const repeated = await pruneExpiredRuntimeRetentionRecords("2026-08-06T00:00:00.000Z");
  assert.equal(repeated.prunedAuditLogCount, 0, "audit retention cleanup must be idempotent");
  assert.equal(repeated.prunedPaymentTransactionCount, 0, "retention cleanup must be idempotent");

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "two-year member deletion audit retention boundary",
      "expired deletion audit pruning before every DB write",
      "post-merge pruning for stale runtime writes",
      "persisted cleanup on ordinary runtime reads",
      "unrelated audit action preservation",
      "five-year statutory ledger survival after two-year deletion audit expiry",
      "malformed statutory ledger integrity rejection without silent deletion",
      "expired payment transaction pruning before every DB write",
      "daily cleanup persistence in the source store",
      "active statutory transaction retention",
      "idempotent repeated cleanup",
    ],
  }, null, 2));
} finally {
  await closeServerDb();
  await rm(dataDirectory, { recursive: true, force: true });
}
