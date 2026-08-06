import type { MockDatabase } from "./domain.ts";
import { pruneExpiredMemberDeletionAuditLogs } from "./audit-log-retention.ts";
import { pruneExpiredRetainedPaymentTransactions } from "./payment-transaction-retention.ts";

export function applyRuntimeRetentionPolicy(db: MockDatabase, now = new Date().toISOString()) {
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
