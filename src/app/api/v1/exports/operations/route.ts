import { NextRequest, NextResponse } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { buildOwnerTrendRows, getRecognizedPaymentRevenue } from "@/lib/owner-reporting";
import { isMembershipPayment } from "@/lib/payment-lifecycle";
import { authSecurityLockKey } from "@/server/auth-session";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { jsonError, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}

function percent(done: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((done / total) * 100);
}

export async function GET(request: NextRequest) {
  const authDb = await readServerDb();
  const { user, response } = requireSession(request, authDb);

  if (!user) {
    return response;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "운영 리포트 내보내기 권한이 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, authDb);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  return withServerDbLock(authSecurityLockKey, () => exportOperations(request));
}

async function exportOperations(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "운영 리포트 내보내기 권한이 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const { branchIds, selectedBranchId } = selectedScope;
  const branches = db.branches.filter((branch) => branchIds.includes(branch.id));
  const branchRows = branches.map((branch) => {
    const members = db.members.filter((member) => member.branchId === branch.id);
    const classes = db.classes.filter((session) => session.branchId === branch.id);
    const classIds = new Set(classes.map((session) => session.id));
    const attendance = db.attendance.filter((record) => classIds.has(record.sessionId));
    const enrolledSlots = classes.reduce((sum, session) => sum + session.enrolledMemberIds.length, 0);
    const payments = db.payments.filter((payment) => payment.branchId === branch.id);
    const overduePayments = payments.filter((payment) => isMembershipPayment(payment) && payment.status === "overdue");
    const expiringPayments = payments.filter(
      (payment) => isMembershipPayment(payment) && payment.status === "expiringSoon",
    );
    const riskPayments = [...overduePayments, ...expiringPayments];
    const attendanceGapSlots = Math.max(enrolledSlots - attendance.length, 0);
    const pausedMembers = members.filter((member) => member.status === "paused").length;
    const pilotPriorityScore = attendanceGapSlots + riskPayments.length * 3 + pausedMembers;

    return [
      branch.name,
      branch.district,
      branch.status ?? "active",
      members.filter((member) => member.status === "active").length,
      members.filter((member) => member.status === "trial").length,
      members.filter((member) => member.status === "paused").length,
      members.filter((member) => member.status === "withdrawn").length,
      classes.length,
      enrolledSlots,
      attendance.length,
      percent(attendance.length, enrolledSlots),
      attendanceGapSlots,
      payments.reduce((sum, payment) => sum + getRecognizedPaymentRevenue(payment), 0),
      overduePayments.length,
      expiringPayments.length,
      riskPayments.length,
      riskPayments.reduce((sum, payment) => sum + payment.amount, 0),
      pilotPriorityScore,
    ];
  });
  const trendRows = buildOwnerTrendRows(db, branchIds, 6);
  const rows = [
    [
      "branch",
      "district",
      "status",
      "active_members",
      "trial_members",
      "paused_members",
      "withdrawn_members",
      "classes",
      "enrolled_slots",
      "attendance_records",
      "attendance_rate_percent",
      "attendance_gap_slots",
      "paid_revenue_krw",
      "overdue_payments",
      "expiring_payments",
      "payment_risk_count",
      "payment_risk_krw",
      "pilot_priority_score",
    ],
    ...branchRows,
    [],
    [
      "trend_period",
      "period_label",
      "classes",
      "enrolled_slots",
      "attendance_records",
      "attendance_rate_percent",
      "paid_revenue_krw",
      "payment_risk_count",
      "new_members",
      "withdrawn_members",
      "net_member_change",
      "member_change_events",
    ],
    ...trendRows.map((row) => [
      row.key,
      row.label,
      row.classes,
      row.enrolledSlots,
      row.attendanceRecords,
      row.attendanceRatePercent,
      row.paidRevenue,
      row.paymentRiskCount,
      row.newMembers,
      row.withdrawnMembers,
      row.netMemberChange,
      row.memberChangeEvents,
    ]),
  ];
  const csv = `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: selectedBranchId,
    actorUserId: user.id,
    action: "export.create",
    targetType: "export",
    targetId: createRuntimeId("operations-export"),
    before: null,
    after: {
      type: "operations",
      branchIds,
      rowCount: branches.length,
      trendPeriods: trendRows.length,
    },
    result: "success",
    message: "운영 리포트 내보내기를 완료했습니다.",
    createdAt: new Date().toISOString(),
  };

  await writeServerDb({
    ...db,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Disposition": "attachment; filename=final-judo-operations.csv",
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
