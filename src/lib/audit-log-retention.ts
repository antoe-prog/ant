import type { AuditLog } from "./domain.ts";

const memberDeletionAuditRetentionYears = 2;

export function getMemberDeletionAuditRetentionExpiresAt(createdAt: string) {
  const expiresAt = new Date(createdAt);

  if (!Number.isFinite(expiresAt.getTime())) {
    throw new Error("회원 삭제 감사 기록 생성 시각이 올바르지 않습니다.");
  }

  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + memberDeletionAuditRetentionYears);
  return expiresAt.toISOString();
}

export function pruneExpiredMemberDeletionAuditLogs(
  logs: readonly AuditLog[],
  now = new Date().toISOString(),
) {
  const nowTimestamp = Date.parse(now);

  if (!Number.isFinite(nowTimestamp)) {
    throw new Error("회원 삭제 감사 기록 정리 기준 시각이 올바르지 않습니다.");
  }

  return logs.filter((log) => {
    if (log.action !== "member.delete") {
      return true;
    }

    const createdAtTimestamp = Date.parse(log.createdAt);

    // Invalid audit timestamps need explicit integrity handling, not silent deletion.
    if (!Number.isFinite(createdAtTimestamp)) {
      return true;
    }

    return Date.parse(getMemberDeletionAuditRetentionExpiresAt(log.createdAt)) > nowTimestamp;
  });
}
