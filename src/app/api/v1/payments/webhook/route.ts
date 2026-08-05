import { NextRequest } from "next/server";
import type { AuditLog, OnlinePaymentRequest, Payment, PaymentStatus } from "@/lib/domain";
import { appendPaymentStatusHistory, createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import {
  canRefundPaymentAmount,
  getPaymentNetAmount,
  getPaymentRemainingRefundableAmount,
} from "@/lib/payment-amounts";
import {
  createPaymentReceipt,
  getWebhookSecret,
  isValidPaymentReceiptUrl,
  matchesPaymentWebhookSecret,
  paymentReceiptUrlMaxLength,
  type PaymentWebhookBody,
  type PaymentWebhookEvent,
} from "@/server/online-payments";
import { jsonError, jsonOk } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import {
  isPositiveSafeIntegerPaymentAmount,
  paymentWebhookStateLockKey,
  validatePaymentWebhookOccurredAt,
  validatePaymentWebhookTransition,
} from "@/server/payment-mutation-policy";
import { createRuntimeId } from "@/server/runtime-id";
import { RuntimeStateMergeConflictError } from "@/server/runtime-state-merge";

export const runtime = "nodejs";

const webhookEvents: PaymentWebhookEvent[] = ["paid", "failed", "refunded"];
const webhookActorUserId = "system-payment-webhook";
const providerPaymentIdMaxLength = 160;
const providerEventIdMaxLength = 160;
const receiptIdMaxLength = 160;

function isIsoDate(value: unknown): value is string {
  return Boolean(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !Number.isNaN(Date.parse(value)),
  );
}

function appendProcessedWebhookEventId(
  onlinePayment: OnlinePaymentRequest,
  providerEventId: string | undefined,
): OnlinePaymentRequest {
  if (!providerEventId) {
    return onlinePayment;
  }

  const processedWebhookEventIds = [...(onlinePayment.processedWebhookEventIds ?? []), providerEventId]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(-100);

  return {
    ...onlinePayment,
    processedWebhookEventIds,
  };
}

function findPaymentByProcessedWebhookEventId(db: { payments: Payment[] }, providerEventId: string) {
  return db.payments.find(
    (payment) =>
      payment.onlinePayment?.processedWebhookEventIds?.includes(providerEventId) ||
      payment.statusHistory?.some(
        (entry) => entry.event === "webhook" && entry.providerEventId === providerEventId,
      ),
  );
}

function createWebhookUpdatedPayment(payment: Payment, body: PaymentWebhookBody, occurredAt: string): Payment {
  const event = body.event;
  const onlinePayment = payment.onlinePayment;

  if (!onlinePayment || !event) {
    return payment;
  }

  if (event === "paid") {
    const receipt = createPaymentReceipt(payment, body, occurredAt);

    return appendPaymentStatusHistory(
      {
        ...payment,
        status: "paid",
        onlinePayment: appendProcessedWebhookEventId(
          {
            ...onlinePayment,
            paidAt: occurredAt,
            receipt,
            status: "paid",
          },
          body.providerEventId,
        ),
      },
      createPaymentStatusHistoryEntry({
        actorUserId: webhookActorUserId,
        changedAt: occurredAt,
        event: "webhook",
        providerEventId: body.providerEventId,
        reason: "온라인 결제 입금 확인",
        status: "paid",
      }),
    );
  }

  if (event === "failed") {
    const reason = "결제 승인 상태를 확인해 주세요.";

    return appendPaymentStatusHistory(
      {
        ...payment,
        onlinePayment: appendProcessedWebhookEventId(
          {
            ...onlinePayment,
            failedAt: occurredAt,
            failureReason: reason,
            status: "failed",
          },
          body.providerEventId,
        ),
      },
      createPaymentStatusHistoryEntry({
        actorUserId: webhookActorUserId,
        changedAt: occurredAt,
        event: "webhook",
        providerEventId: body.providerEventId,
        reason,
        status: payment.status,
      }),
    );
  }

  const previousRefunded = payment.refundedAmount ?? 0;
  const remainingRefundable = getPaymentRemainingRefundableAmount(payment);
  if (!isPositiveSafeIntegerPaymentAmount(body.amount)) {
    throw new TypeError("Validated refund amount is required before applying a refund webhook.");
  }
  const requestedRefund = body.amount;
  const nextRefundedAmount = previousRefunded + Math.min(Math.max(requestedRefund, 0), remainingRefundable);
  const nextStatus: PaymentStatus = nextRefundedAmount >= getPaymentNetAmount(payment) ? "refunded" : "partially_refunded";
  const reason = "결제 환불 상태가 반영되었습니다.";

  return appendPaymentStatusHistory(
    {
      ...payment,
      refundedAmount: nextRefundedAmount,
      refundedAt: occurredAt,
      refundReason: reason,
      status: nextStatus,
      onlinePayment: appendProcessedWebhookEventId(
        {
          ...onlinePayment,
          status: "refunded",
        },
        body.providerEventId,
      ),
    },
    createPaymentStatusHistoryEntry({
      actorUserId: webhookActorUserId,
      changedAt: occurredAt,
      event: "webhook",
      providerEventId: body.providerEventId,
      reason,
      status: nextStatus,
    }),
  );
}

export async function POST(request: NextRequest) {
  const webhookSecret = getWebhookSecret();

  if (!webhookSecret) {
    return jsonError(503, "PAYMENT_WEBHOOK_NOT_CONFIGURED", "운영 결제 연동 인증 정보가 설정되지 않았습니다.");
  }

  if (!matchesPaymentWebhookSecret(request.headers.get("x-final-judo-payment-webhook-secret"), webhookSecret)) {
    return jsonError(401, "UNAUTHENTICATED", "결제 연동 인증에 실패했습니다.");
  }

  const rawBody = await request.json().catch(() => null);
  const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
    ? rawBody as PaymentWebhookBody
    : null;
  const providerPaymentId = typeof body?.providerPaymentId === "string" ? body.providerPaymentId.trim() : "";
  const bodyProviderEventId = typeof body?.providerEventId === "string" ? body.providerEventId.trim() : "";
  const headerProviderEventId = request.headers.get("x-final-judo-payment-event-id")?.trim() || "";

  if (bodyProviderEventId && headerProviderEventId && bodyProviderEventId !== headerProviderEventId) {
    return jsonError(400, "VALIDATION_ERROR", "본문과 헤더의 결제 이벤트 식별자가 일치하지 않습니다.");
  }

  const providerEventId = bodyProviderEventId || headerProviderEventId || undefined;
  const event = body?.event;

  if (!body || !providerPaymentId || !providerEventId || !event || !webhookEvents.includes(event)) {
    return jsonError(400, "VALIDATION_ERROR", "결제·이벤트 식별자와 처리 이벤트가 필요합니다.");
  }

  if (providerPaymentId.length > providerPaymentIdMaxLength || providerEventId.length > providerEventIdMaxLength) {
    return jsonError(400, "VALIDATION_ERROR", "결제 또는 이벤트 식별자가 너무 깁니다.");
  }

  const occurredAtInput = body.occurredAt;
  const hasOccurredAt = occurredAtInput !== undefined;
  const hasValidOccurredAt = isIsoDate(occurredAtInput);

  if (hasOccurredAt && !hasValidOccurredAt) {
    return jsonError(400, "VALIDATION_ERROR", "결제 이벤트 발생 시각이 올바르지 않습니다.");
  }

  if (body.receiptId !== undefined && typeof body.receiptId !== "string") {
    return jsonError(400, "VALIDATION_ERROR", "영수증 식별자가 올바르지 않습니다.");
  }

  const receiptId = body.receiptId?.trim() || undefined;

  if (receiptId && receiptId.length > receiptIdMaxLength) {
    return jsonError(400, "VALIDATION_ERROR", "영수증 식별자가 너무 깁니다.");
  }

  if (body.receiptUrl !== undefined && typeof body.receiptUrl !== "string") {
    return jsonError(400, "VALIDATION_ERROR", "영수증 주소가 올바르지 않습니다.");
  }

  const receiptUrl = body.receiptUrl?.trim() || undefined;

  if (receiptUrl && !isValidPaymentReceiptUrl(receiptUrl)) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      `영수증 주소는 ${paymentReceiptUrlMaxLength}자 이하의 HTTPS 주소여야 합니다.`,
    );
  }

  if (event === "paid" && !isPositiveSafeIntegerPaymentAmount(body.amount)) {
    return jsonError(400, "VALIDATION_ERROR", "승인 금액은 1원 이상의 원 단위 정수여야 합니다.");
  }

  if (event === "refunded" && !isPositiveSafeIntegerPaymentAmount(body.amount)) {
    return jsonError(400, "VALIDATION_ERROR", "환불 금액은 1원 이상의 원 단위 정수여야 합니다.");
  }

  const initialDb = await readServerDb();
  const initialPayment = initialDb.payments.find(
    (candidate) => candidate.onlinePayment?.providerPaymentId === providerPaymentId,
  );

  if (!initialPayment?.onlinePayment) {
    return jsonError(404, "NOT_FOUND", "결제 요청을 찾을 수 없습니다.");
  }

  const paymentId = initialPayment.id;

  const webhookBody: PaymentWebhookBody = {
    ...body,
    providerPaymentId,
    providerEventId,
    receiptId,
    receiptUrl,
  };
  const receivedAt = new Date();
  const occurredAt = hasValidOccurredAt ? new Date(occurredAtInput as string).toISOString() : receivedAt.toISOString();

  try {
    return await withServerDbLock(paymentWebhookStateLockKey, () =>
      withServerDbLock(`payment-mutation:${paymentId}`, async () => {
      const db = await readServerDb();
      const payment = db.payments.find(
        (candidate) =>
          candidate.id === paymentId && candidate.onlinePayment?.providerPaymentId === providerPaymentId,
      );

      if (!payment?.onlinePayment) {
        return jsonError(404, "NOT_FOUND", "결제 요청을 찾을 수 없습니다.");
      }

      const processedByPayment = findPaymentByProcessedWebhookEventId(db, providerEventId);

      if (processedByPayment?.id === payment.id) {
        return jsonOk({
          duplicate: true,
          ok: true,
          payment,
          providerEventId,
        });
      }

      if (processedByPayment) {
        return jsonError(
          409,
          "PROVIDER_EVENT_CONFLICT",
          "이미 다른 결제에 처리된 결제 이벤트입니다.",
        );
      }

      if (event === "paid" && webhookBody.amount !== payment.onlinePayment.amount) {
        return jsonError(422, "PAYMENT_AMOUNT_MISMATCH", "승인 금액이 결제 요청 금액과 일치하지 않습니다.");
      }

      if (!hasValidOccurredAt && payment.statusHistory?.some((entry) => entry.event === "webhook")) {
        return jsonError(400, "VALIDATION_ERROR", "후속 결제 연동 이벤트에는 유효한 발생 시각이 필요합니다.");
      }

      const occurrence = validatePaymentWebhookOccurredAt(payment, occurredAt, receivedAt);

      if (!occurrence.ok) {
        return jsonError(400, occurrence.code, occurrence.message);
      }

      if (event === "refunded") {
        const remainingRefundable = getPaymentRemainingRefundableAmount(payment);

        if (remainingRefundable <= 0) {
          return jsonError(422, "BUSINESS_RULE_FAILED", "이미 전액 환불된 결제입니다.");
        }

        if (webhookBody.amount !== undefined && !canRefundPaymentAmount(payment, webhookBody.amount)) {
          return jsonError(422, "BUSINESS_RULE_FAILED", "환불 금액이 남은 결제 금액을 초과합니다.");
        }
      }

      const transition = validatePaymentWebhookTransition(payment, event, occurredAt);

      if (!transition.ok) {
        return jsonError(409, transition.code, transition.message);
      }

      const nextPayment = createWebhookUpdatedPayment(payment, webhookBody, occurredAt);
      const auditLog: AuditLog = {
        id: createRuntimeId("audit"),
        branchId: payment.branchId,
        actorUserId: webhookActorUserId,
        action: "payment.webhook",
        targetType: "payment",
        targetId: payment.id,
        before: {
          onlinePayment: payment.onlinePayment,
          refundedAmount: payment.refundedAmount ?? 0,
          status: payment.status,
        },
        after: {
          event,
          onlinePayment: nextPayment.onlinePayment,
          refundedAmount: nextPayment.refundedAmount ?? 0,
          status: nextPayment.status,
          statusHistory: nextPayment.statusHistory,
        },
        result: "success",
        message: "결제 연동 이벤트를 처리했습니다.",
        createdAt: occurredAt,
      };
      const nextDb = await writeServerDb({
        ...db,
        payments: db.payments.map((candidate) => (candidate.id === payment.id ? nextPayment : candidate)),
        auditLogs: [auditLog, ...db.auditLogs],
      });

      return jsonOk({
        ok: true,
        payment: nextDb.payments.find((candidate) => candidate.id === payment.id),
      });
      }),
    );
  } catch (error) {
    if (error instanceof RuntimeStateMergeConflictError) {
      return jsonError(409, "CONCURRENT_MODIFICATION", "결제 상태가 동시에 변경되었습니다. 다시 시도해 주세요.");
    }

    throw error;
  }
}
