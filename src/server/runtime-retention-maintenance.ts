import type { MockDatabase } from "@/lib/domain";
import { pruneExpiredMemberDeletionAuditLogs } from "@/lib/audit-log-retention";
import { pruneExpiredRetainedPaymentTransactions } from "@/lib/payment-transaction-retention";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";

export const runtimeRetentionMaintenanceLockKey = "runtime-retention-maintenance";

export function applyRuntimeRetentionMaintenance(db: MockDatabase, now = new Date().toISOString()) {
  const beforeAuditLogs = db.auditLogs;
  const beforePaymentTransactions = db.retainedPaymentTransactions ?? [];
  const auditLogs = pruneExpiredMemberDeletionAuditLogs(beforeAuditLogs, now);
  const retainedPaymentTransactions = pruneExpiredRetainedPaymentTransactions(beforePaymentTransactions, now);
  const prunedAuditLogCount = beforeAuditLogs.length - auditLogs.length;
  const prunedPaymentTransactionCount = beforePaymentTransactions.length - retainedPaymentTransactions.length;

  return {
    db: prunedAuditLogCount === 0 && prunedPaymentTransactionCount === 0
      ? db
      : { ...db, auditLogs, retainedPaymentTransactions },
    prunedAuditLogCount,
    prunedPaymentTransactionCount,
  };
}

export function pruneExpiredRuntimeRetentionRecords(now = new Date().toISOString()) {
  return withServerDbLock(runtimeRetentionMaintenanceLockKey, async () => {
    const current = await readServerDb();
    const maintenance = applyRuntimeRetentionMaintenance(current, now);

    if (maintenance.prunedAuditLogCount === 0 && maintenance.prunedPaymentTransactionCount === 0) {
      return { prunedAuditLogCount: 0, prunedPaymentTransactionCount: 0 };
    }

    await writeServerDb(maintenance.db);
    return {
      prunedAuditLogCount: maintenance.prunedAuditLogCount,
      prunedPaymentTransactionCount: maintenance.prunedPaymentTransactionCount,
    };
  });
}
