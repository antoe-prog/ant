import { NextRequest } from "next/server";
import type { AuditLog, OnlinePaymentRequest, Payment, PaymentStatus } from "@/lib/domain";
import { appendPaymentStatusHistory, createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import {
  createPaymentReceipt,
  getOnlinePaymentAmount,
  getWebhookSecret,
  type PaymentWebhookBody,
  type PaymentWebhookEvent,
} from "@/server/online-payments";
import { jsonError, jsonOk } from "@/server/api";
import { readServerDb, writeServerDb } from "@/server/db";

export const runtime = "nodejs";

const webhookEvents: PaymentWebhookEvent[] = ["paid", "failed", "refunded"];
const webhookActorUserId = "system-payment-webhook";

function isIsoDate(value: string | undefined) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
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
  const remainingRefundable = Math.max(payment.amount - previousRefunded, 0);
  const requestedRefund = typeof body.amount === "number" && Number.isFinite(body.amount)
    ? Math.round(body.amount)
    : remainingRefundable;
  const nextRefundedAmount = previousRefunded + Math.min(Math.max(requestedRefund, 0), remainingRefundable);
  const nextStatus: PaymentStatus = nextRefundedAmount >= payment.amount ? "refunded" : "partially_refunded";
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

  if (request.headers.get("x-final-judo-payment-webhook-secret") !== webhookSecret) {
    return jsonError(401, "UNAUTHENTICATED", "결제 연동 인증에 실패했습니다.");
  }

  const body = (await request.json().catch(() => null)) as PaymentWebhookBody | null;
  const providerPaymentId = body?.providerPaymentId?.trim() ?? "";
  const providerEventId =
    body?.providerEventId?.trim() || request.headers.get("x-final-judo-payment-event-id")?.trim() || undefined;
  const event = body?.event;

  if (!body || !providerPaymentId || !event || !webhookEvents.includes(event)) {
    return jsonError(400, "VALIDATION_ERROR", "결제 연동 식별자와 처리 이벤트가 필요합니다.");
  }

  const db = await readServerDb();
  const payment = db.payments.find((candidate) => candidate.onlinePayment?.providerPaymentId === providerPaymentId);

  if (!payment || !payment.onlinePayment) {
    return jsonError(404, "NOT_FOUND", "결제 요청을 찾을 수 없습니다.");
  }

  if (providerEventId && payment.onlinePayment.processedWebhookEventIds?.includes(providerEventId)) {
    return jsonOk({
      duplicate: true,
      ok: true,
      payment,
      providerEventId,
    });
  }

  if (event === "refunded" && getOnlinePaymentAmount(payment) <= 0 && (payment.refundedAmount ?? 0) >= payment.amount) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "이미 전액 환불된 결제입니다.");
  }

  const webhookBody: PaymentWebhookBody = {
    ...body,
    ...(providerEventId ? { providerEventId } : {}),
  };
  const occurredAtInput = webhookBody.occurredAt;
  const occurredAt = isIsoDate(occurredAtInput) ? new Date(occurredAtInput as string).toISOString() : new Date().toISOString();
  const nextPayment = createWebhookUpdatedPayment(payment, webhookBody, occurredAt);
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
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
}
