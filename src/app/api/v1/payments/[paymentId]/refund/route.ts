import { NextRequest } from "next/server";
import type { AuditLog, Payment } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { appendPaymentStatusHistory, createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

type RefundBody = {
  amount?: number;
  cancel?: boolean;
  reason?: string;
};

function createRefundedPayment(payment: Payment, amount: number, reason: string, actorUserId: string, changedAt: string): Payment {
  const previousRefunded = payment.refundedAmount ?? 0;
  const refundedAmount = previousRefunded + amount;
  const remainingAfterRefund = Math.max(payment.amount - refundedAmount, 0);
  const status = remainingAfterRefund === 0 ? "refunded" : "partially_refunded";

  return appendPaymentStatusHistory({
    ...payment,
    refundedAmount,
    refundedAt: changedAt,
    refundReason: reason,
    status,
  }, createPaymentStatusHistoryEntry({
    actorUserId,
    changedAt,
    event: "refund",
    reason,
    status,
  }));
}

function createCancelledPayment(payment: Payment, reason: string, actorUserId: string, changedAt: string): Payment {
  return appendPaymentStatusHistory({
    ...payment,
    refundedAt: changedAt,
    refundReason: reason,
    status: "cancelled",
  }, createPaymentStatusHistoryEntry({
    actorUserId,
    changedAt,
    event: "cancel",
    reason,
    status: "cancelled",
  }));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "환불/취소 처리 권한이 없습니다.");
  }

  const payment = db.payments.find((candidate) => candidate.id === paymentId);

  if (!payment) {
    return jsonError(404, "NOT_FOUND", "결제 기록을 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(payment.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 결제 기록만 처리할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== payment.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 결제 기록만 처리할 수 있습니다.");
  }

  if (payment.status === "refunded" || payment.status === "cancelled") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "이미 환불 또는 취소된 결제입니다.");
  }

  const body = (await request.json().catch(() => null)) as RefundBody | null;
  const reason = body?.reason?.trim() ?? "";
  const amount = body?.amount;
  const cancel = body?.cancel === true;

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "환불/취소 사유가 필요합니다.");
  }

  let nextPayment: Payment;
  const now = new Date().toISOString();

  if (cancel) {
    nextPayment = createCancelledPayment(payment, reason, user.id, now);
  } else {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return jsonError(400, "VALIDATION_ERROR", "환불 금액은 0원보다 커야 합니다.");
    }

    const remainingRefundable = payment.amount - (payment.refundedAmount ?? 0);

    if (amount > remainingRefundable) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "환불 금액이 남은 결제 금액을 초과합니다.");
    }

    nextPayment = createRefundedPayment(payment, Math.round(amount), reason, user.id, now);
  }

  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: payment.branchId,
    actorUserId: user.id,
    action: "payment.refund",
    targetType: "payment",
    targetId: payment.id,
    before: {
      status: payment.status,
      refundedAmount: payment.refundedAmount ?? 0,
      refundReason: payment.refundReason ?? null,
    },
    after: {
      status: nextPayment.status,
      refundedAmount: nextPayment.refundedAmount ?? 0,
      refundReason: nextPayment.refundReason ?? null,
      cancel,
      statusHistory: nextPayment.statusHistory,
    },
    result: "success",
    message: cancel ? "결제 기록을 취소했습니다." : "환불 기록을 처리했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    payments: db.payments.map((candidate) => (candidate.id === payment.id ? nextPayment : candidate)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? payment.branchId));
}
