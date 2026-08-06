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

try {
  const seeded = createMockData();
  await writeServerDb({
    ...seeded,
    retainedPaymentTransactions: [expiredRecord, activeRecord],
  });

  const afterWrite = await readServerDb();
  assert.deepEqual(
    afterWrite.retainedPaymentTransactions?.map((record) => record.id),
    [activeRecord.id],
    "every DB write must persistently remove expired transaction records",
  );

  assert(serverDbPaths?.dataFile, "isolated JSON test must expose its data file");
  const raw = JSON.parse(await readFile(serverDbPaths.dataFile, "utf8"));
  raw.retainedPaymentTransactions.push(expiredRecord);
  await writeFile(serverDbPaths.dataFile, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const maintenance = await pruneExpiredRuntimeRetentionRecords("2026-08-06T00:00:00.000Z");
  assert.equal(maintenance.prunedPaymentTransactionCount, 1);

  const persisted = JSON.parse(await readFile(serverDbPaths.dataFile, "utf8"));
  assert.deepEqual(
    persisted.retainedPaymentTransactions.map((record) => record.id),
    [activeRecord.id],
    "scheduled maintenance must remove expired records from the source file, not only from memory",
  );

  const repeated = await pruneExpiredRuntimeRetentionRecords("2026-08-06T00:00:00.000Z");
  assert.equal(repeated.prunedPaymentTransactionCount, 0, "retention cleanup must be idempotent");

  console.log(JSON.stringify({
    ok: true,
    checked: [
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
