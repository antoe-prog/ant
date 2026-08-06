import type { MockDatabase } from "@/lib/domain";
import { pruneExpiredRetainedPaymentTransactions } from "@/lib/payment-transaction-retention";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";

export const runtimeRetentionMaintenanceLockKey = "runtime-retention-maintenance";

export function applyRuntimeRetentionMaintenance(db: MockDatabase, now = new Date().toISOString()) {
  const before = db.retainedPaymentTransactions ?? [];
  const retainedPaymentTransactions = pruneExpiredRetainedPaymentTransactions(before, now);

  return {
    db: retainedPaymentTransactions.length === before.length
      ? db
      : { ...db, retainedPaymentTransactions },
    prunedPaymentTransactionCount: before.length - retainedPaymentTransactions.length,
  };
}

export function pruneExpiredRuntimeRetentionRecords(now = new Date().toISOString()) {
  return withServerDbLock(runtimeRetentionMaintenanceLockKey, async () => {
    const current = await readServerDb();
    const maintenance = applyRuntimeRetentionMaintenance(current, now);

    if (maintenance.prunedPaymentTransactionCount === 0) {
      return { prunedPaymentTransactionCount: 0 };
    }

    await writeServerDb(maintenance.db);
    return { prunedPaymentTransactionCount: maintenance.prunedPaymentTransactionCount };
  });
}
