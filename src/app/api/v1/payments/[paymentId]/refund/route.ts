import { NextRequest } from "next/server";
import type { AuditLog, Payment } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { manualPaymentInputLimits } from "@/lib/manual-payment-management";
import { appendPaymentStatusHistory, createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import { canRefundPaymentAmount, getPaymentRemainingRefundableAmount } from "@/lib/payment-amounts";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { isPositiveSafeIntegerPaymentAmount } from "@/server/payment-mutation-policy";
import { createRuntimeId } from "@/server/runtime-id";
import { RuntimeStateMergeConflictError } from "@/server/runtime-state-merge";

export const runtime = "nodejs";

type RefundBody = {
  amount?: number;
  cancel?: boolean;
  reason?: string;
};

function getRefundBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "환불/취소 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  if (body.reason !== undefined && typeof body.reason !== "string") {
    return "환불/취소 사유 값의 형식이 올바르지 않습니다.";
  }

  if (body.amount !== undefined && typeof body.amount !== "number") {
    return "환불 금액 값의 형식이 올바르지 않습니다.";
  }

  if (body.cancel !== undefined && typeof body.cancel !== "boolean") {
    return "취소 여부 값의 형식이 올바르지 않습니다.";
  }

  return null;
}

function createRefundedPayment(payment: Payment, amount: number, reason: string, actorUserId: string, changedAt: string): Payment {
  const previousRefunded = payment.refundedAmount ?? 0;
  const refundedAmount = previousRefunded + amount;
  const remainingAfterRefund = getPaymentRemainingRefundableAmount({ ...payment, refundedAmount });
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

async function requireRefundRequestContext(request: NextRequest, paymentId: string) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { response } as const;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return { response: jsonError(403, "FORBIDDEN", "환불/취소 처리 권한이 없습니다.") } as const;
  }

  const payment = db.payments.find((candidate) => candidate.id === paymentId);

  if (!payment) {
    return { response: jsonError(404, "NOT_FOUND", "결제 기록을 찾을 수 없습니다.") } as const;
  }

  if (!getAccessibleBranchIds(user, db).includes(payment.branchId)) {
    return { response: jsonError(403, "FORBIDDEN", "선택한 지점의 결제 기록만 처리할 수 있습니다.") } as const;
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { response: selectedScope.response } as const;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== payment.branchId) {
    return { response: jsonError(403, "FORBIDDEN", "선택한 지점의 결제 기록만 처리할 수 있습니다.") } as const;
  }

  if (payment.status === "refunded" || payment.status === "cancelled") {
    return { response: jsonError(422, "BUSINESS_RULE_FAILED", "이미 환불 또는 취소된 결제입니다.") } as const;
  }

  return { db, payment, selectedBranchId: selectedScope.selectedBranchId, user } as const;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const context = await requireRefundRequestContext(request, paymentId);

  if ("response" in context) {
    return context.response;
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getRefundBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as RefundBody;
  const reason = body.reason?.trim() ?? "";
  const amount = body?.amount;
  const cancel = body?.cancel === true;
  const validatedRefundAmount = isPositiveSafeIntegerPaymentAmount(amount) ? amount : null;

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "환불/취소 사유가 필요합니다.");
  }

  if (reason.length > manualPaymentInputLimits.reason) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      `환불/취소 사유는 ${manualPaymentInputLimits.reason}자 이하로 입력해 주세요.`,
    );
  }

  if (!cancel && validatedRefundAmount === null) {
    return jsonError(400, "VALIDATION_ERROR", "환불 금액은 1원 이상의 정수여야 합니다.");
  }

  try {
    return await withServerDbLock(`payment-mutation:${paymentId}`, async () => {
      const latestContext = await requireRefundRequestContext(request, paymentId);

      if ("response" in latestContext) {
        return latestContext.response;
      }

      const { db, payment, selectedBranchId, user } = latestContext;
      const now = new Date().toISOString();
      let nextPayment: Payment;

      if (cancel) {
        if (!["scheduled", "overdue", "expiringSoon"].includes(payment.status)) {
          return jsonError(422, "BUSINESS_RULE_FAILED", "미납 또는 납부 예정 결제만 취소할 수 있습니다.");
        }

        nextPayment = createCancelledPayment(payment, reason, user.id, now);
      } else {
        if (!["paid", "partially_refunded"].includes(payment.status)) {
          return jsonError(422, "BUSINESS_RULE_FAILED", "납부 완료된 결제만 환불할 수 있습니다.");
        }

        if (validatedRefundAmount === null) {
          return jsonError(400, "VALIDATION_ERROR", "환불 금액은 1원 이상의 정수여야 합니다.");
        }

        const refundAmount = validatedRefundAmount;
        if (!canRefundPaymentAmount(payment, refundAmount)) {
          return jsonError(422, "BUSINESS_RULE_FAILED", "환불 금액이 남은 결제 금액을 초과합니다.");
        }

        nextPayment = createRefundedPayment(payment, refundAmount, reason, user.id, now);
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

      return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId ?? payment.branchId));
    });
  } catch (error) {
    if (error instanceof RuntimeStateMergeConflictError) {
      return jsonError(409, "CONCURRENT_MODIFICATION", "결제 상태가 동시에 변경되었습니다. 다시 시도해 주세요.");
    }

    throw error;
  }
}
