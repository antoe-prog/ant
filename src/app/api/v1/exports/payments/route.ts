import { NextRequest, NextResponse } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { getAccessibleMemberIds } from "@/lib/mock-api";
import { getLatestPaymentStatusChange } from "@/lib/payment-lifecycle";
import { readServerDb, writeServerDb } from "@/server/db";
import { jsonError, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}

export async function GET(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "결제 내보내기 권한이 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const { branchIds, selectedBranchId } = selectedScope;
  const memberIds = new Set(getAccessibleMemberIds(user, db, branchIds));
  const scopedPayments = db.payments.filter(
    (payment) => branchIds.includes(payment.branchId) && memberIds.has(payment.memberId),
  );
  const rows = [
    [
      "branch",
      "member",
      "plan",
      "status",
      "amount_krw",
      "discount_krw",
      "refunded_krw",
      "refund_reason",
      "due_date",
      "expires_at",
      "status_history_count",
      "last_status_changed_at",
      "last_status_reason",
      "online_payment_status",
      "online_provider_payment_id",
      "online_requested_at",
      "online_paid_at",
      "receipt_id",
      "receipt_url",
      "recurring_status",
      "recurring_provider_agreement_id",
      "recurring_next_billing_date",
      "recurring_cancelled_at",
      "recurring_cancel_reason",
    ],
    ...scopedPayments.map((payment) => {
      const branch = db.branches.find((candidate) => candidate.id === payment.branchId);
      const member = db.members.find((candidate) => candidate.id === payment.memberId);
      const latestStatusChange = getLatestPaymentStatusChange(payment);

      return [
        branch?.name ?? payment.branchId,
        member?.name ?? payment.memberId,
        payment.planName,
        payment.status,
        payment.amount,
        payment.discountAmount ?? 0,
        payment.refundedAmount ?? 0,
        payment.refundReason ?? "",
        payment.dueDate,
        payment.expiresAt,
        payment.statusHistory?.length ?? 0,
        latestStatusChange?.changedAt ?? "",
        latestStatusChange?.reason ?? "",
        payment.onlinePayment?.status ?? "",
        payment.onlinePayment?.providerPaymentId ?? "",
        payment.onlinePayment?.requestedAt ?? "",
        payment.onlinePayment?.paidAt ?? "",
        payment.onlinePayment?.receipt?.id ?? "",
        payment.onlinePayment?.receipt?.receiptUrl ?? "",
        payment.recurringAgreement?.status ?? "",
        payment.recurringAgreement?.providerAgreementId ?? "",
        payment.recurringAgreement?.nextBillingDate ?? "",
        payment.recurringAgreement?.cancelledAt ?? "",
        payment.recurringAgreement?.cancelReason ?? "",
      ];
    }),
  ];
  const csv = `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: selectedBranchId,
    actorUserId: user.id,
    action: "export.create",
    targetType: "export",
    targetId: `payments-${Date.now()}`,
    before: null,
    after: {
      type: "payments",
      branchIds,
      rowCount: scopedPayments.length,
    },
    result: "success",
    message: "결제 내보내기를 완료했습니다.",
    createdAt: new Date().toISOString(),
  };

  await writeServerDb({
    ...db,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Disposition": "attachment; filename=final-judo-payments.csv",
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
