import type { MockDatabase } from "@/lib/domain";
import { applyRuntimeRetentionPolicy } from "@/lib/runtime-retention";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";

export const runtimeRetentionMaintenanceLockKey = "runtime-retention-maintenance";

export function applyRuntimeRetentionMaintenance(db: MockDatabase, now = new Date().toISOString()) {
  return applyRuntimeRetentionPolicy(db, now);
}

export function pruneExpiredRuntimeRetentionRecords(now = new Date().toISOString()) {
  return withServerDbLock(runtimeRetentionMaintenanceLockKey, async () => {
    const current = await readServerDb({ enforceRuntimeRetention: false });
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
