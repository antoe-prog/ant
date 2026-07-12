import type { AuditLog } from "@/lib/domain";

export const auditReadDeduplicationWindowMs = 5_000;

function createAuditReadFingerprint(log: AuditLog) {
  const payload = log.after ?? {};

  return JSON.stringify({
    action: payload.action ?? null,
    branchId: payload.branchId ?? null,
    from: payload.from ?? null,
    limit: payload.limit ?? null,
    query: payload.query ?? null,
    reason: payload.reason ?? null,
    result: payload.result ?? null,
    to: payload.to ?? null,
  });
}

export function isDuplicateAuditRead(
  existingLogs: AuditLog[],
  candidate: AuditLog,
  windowMs = auditReadDeduplicationWindowMs,
) {
  if (candidate.action !== "audit_logs.read") {
    return false;
  }

  const candidateTime = Date.parse(candidate.createdAt);

  if (!Number.isFinite(candidateTime)) {
    return false;
  }

  const candidateFingerprint = createAuditReadFingerprint(candidate);

  return existingLogs.some((log) => {
    if (
      log.action !== "audit_logs.read" ||
      log.actorUserId !== candidate.actorUserId ||
      log.result !== candidate.result ||
      log.targetType !== candidate.targetType
    ) {
      return false;
    }

    const existingTime = Date.parse(log.createdAt);
    const elapsedMs = candidateTime - existingTime;

    return (
      Number.isFinite(existingTime) &&
      elapsedMs >= 0 &&
      elapsedMs <= windowMs &&
      createAuditReadFingerprint(log) === candidateFingerprint
    );
  });
}
