import type { MockDatabase } from "@/lib/domain";
import { getPaymentRemainingRefundableAmount } from "./payment-amounts.ts";

export type OwnerTrendRow = {
  attendanceRatePercent: number;
  attendanceRecords: number;
  classes: number;
  enrolledSlots: number;
  key: string;
  label: string;
  memberChangeEvents: number;
  netMemberChange: number;
  newMembers: number;
  paidRevenue: number;
  paymentRiskCount: number;
  withdrawnMembers: number;
};

function monthKey(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${year}년 ${Number(month)}월`;
}

function addMonths(key: string, delta: number) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function percent(done: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((done / total) * 100);
}

function createEmptyTrendRow(key: string): OwnerTrendRow {
  return {
    attendanceRatePercent: 0,
    attendanceRecords: 0,
    classes: 0,
    enrolledSlots: 0,
    key,
    label: monthLabel(key),
    memberChangeEvents: 0,
    netMemberChange: 0,
    newMembers: 0,
    paidRevenue: 0,
    paymentRiskCount: 0,
    withdrawnMembers: 0,
  };
}

function paymentTrendDate(payment: MockDatabase["payments"][number]) {
  if (payment.status === "paid" || payment.status === "partially_refunded") {
    const paidHistory = [...(payment.statusHistory ?? [])]
      .filter((entry) => entry.status === "paid")
      .sort((left, right) => right.changedAt.localeCompare(left.changedAt))[0];

    return paidHistory?.changedAt ?? payment.dueDate;
  }

  if (payment.status === "expiringSoon") {
    return payment.expiresAt;
  }

  return payment.dueDate;
}

export function buildOwnerTrendRows(db: MockDatabase, branchIds: string[], periodCount = 6): OwnerTrendRow[] {
  const scopedBranchIds = new Set(branchIds);
  const classes = db.classes.filter((session) => scopedBranchIds.has(session.branchId));
  const classById = new Map(classes.map((session) => [session.id, session]));
  const payments = db.payments.filter((payment) => scopedBranchIds.has(payment.branchId));
  const members = db.members.filter((member) => scopedBranchIds.has(member.branchId));
  const attendance = db.attendance.filter((record) => classById.has(record.sessionId));
  const memberAuditLogs = db.auditLogs.filter(
    (log) =>
      scopedBranchIds.has(String(log.branchId ?? "")) &&
      (log.action === "member.create" || log.action === "member.update"),
  );
  const memberAuditLogsByTarget = new Map(
    members.map((member) => [
      member.id,
      memberAuditLogs.filter((log) => log.targetId === member.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ]),
  );
  const observedKeys = [
    ...classes.map((session) => monthKey(session.startsAt)),
    ...attendance.map((record) => monthKey(record.confirmedAt ?? classById.get(record.sessionId)?.startsAt)),
    ...payments.map((payment) => monthKey(paymentTrendDate(payment))),
    ...members.map((member) => monthKey(member.createdAt)),
    ...members.map((member) => monthKey(member.withdrawnAt ?? (member.status === "withdrawn" ? member.statusChangedAt : undefined))),
    ...memberAuditLogs.map((log) => monthKey(log.createdAt)),
    monthKey(new Date().toISOString()),
  ].filter((key): key is string => Boolean(key));
  const todayKey = monthKey(new Date().toISOString()) ?? "1970-01";
  const latestObservedKey = observedKeys.sort().at(-1) ?? todayKey;
  const anchorKey = latestObservedKey > todayKey ? todayKey : latestObservedKey;
  const periodKeys = Array.from({ length: periodCount }, (_, index) => addMonths(anchorKey, index - periodCount + 1));
  const rows = new Map(periodKeys.map((key) => [key, createEmptyTrendRow(key)]));

  for (const session of classes) {
    const key = monthKey(session.startsAt);
    const row = key ? rows.get(key) : null;

    if (!row) {
      continue;
    }

    row.classes += 1;
    row.enrolledSlots += session.enrolledMemberIds.length;
  }

  for (const record of attendance) {
    const session = classById.get(record.sessionId);
    const key = monthKey(record.confirmedAt ?? session?.startsAt);
    const row = key ? rows.get(key) : null;

    if (!row) {
      continue;
    }

    row.attendanceRecords += 1;
  }

  for (const payment of payments) {
    const key = monthKey(paymentTrendDate(payment));
    const row = key ? rows.get(key) : null;

    if (!row) {
      continue;
    }

    if (payment.status === "paid" || payment.status === "partially_refunded") {
      row.paidRevenue += getPaymentRemainingRefundableAmount(payment);
    }

    if (payment.status === "overdue" || payment.status === "expiringSoon") {
      row.paymentRiskCount += 1;
    }
  }

  for (const log of memberAuditLogs) {
    const key = monthKey(log.createdAt);
    const row = key ? rows.get(key) : null;

    if (!row) {
      continue;
    }

    row.memberChangeEvents += 1;
  }

  for (const member of members) {
    const logs = memberAuditLogsByTarget.get(member.id) ?? [];
    const createdKey = monthKey(member.createdAt) ?? monthKey(logs.find((log) => log.action === "member.create")?.createdAt);
    const withdrawnAuditLog = logs.find(
      (log) => log.action === "member.update" && log.after?.status === "withdrawn",
    );
    const withdrawnKey =
      monthKey(member.withdrawnAt) ??
      monthKey(member.status === "withdrawn" ? member.statusChangedAt : undefined) ??
      monthKey(withdrawnAuditLog?.createdAt);
    const createdRow = createdKey ? rows.get(createdKey) : null;
    const withdrawnRow = withdrawnKey ? rows.get(withdrawnKey) : null;

    if (createdRow) {
      createdRow.newMembers += 1;
    }

    if (withdrawnRow) {
      withdrawnRow.withdrawnMembers += 1;
    }
  }

  return [...rows.values()].map((row) => ({
    ...row,
    attendanceRatePercent: percent(row.attendanceRecords, row.enrolledSlots),
    netMemberChange: row.newMembers - row.withdrawnMembers,
  }));
}
