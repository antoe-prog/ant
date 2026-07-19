import type { Payment } from "@/lib/domain";
import type { PaymentWebhookEvent } from "@/server/online-payments";

export const paymentWebhookStateLockKey = "payment-webhook-state";

export type PaymentWebhookTransitionResult =
  | { ok: true }
  | {
      code: "INVALID_TRANSITION" | "OUT_OF_ORDER";
      message: string;
      ok: false;
    };

export function isPositiveSafeIntegerPaymentAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeSafeIntegerPaymentAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function getLatestWebhookOccurredAt(payment: Payment) {
  return (payment.statusHistory ?? [])
    .filter((entry) => entry.event === "webhook")
    .reduce<number | null>((latest, entry) => {
      const occurredAt = Date.parse(entry.changedAt);

      if (Number.isNaN(occurredAt)) {
        return latest;
      }

      return latest === null || occurredAt > latest ? occurredAt : latest;
    }, null);
}

export function validatePaymentWebhookTransition(
  payment: Payment,
  event: PaymentWebhookEvent,
  occurredAt: string,
): PaymentWebhookTransitionResult {
  const latestWebhookOccurredAt = getLatestWebhookOccurredAt(payment);
  const incomingOccurredAt = Date.parse(occurredAt);

  if (latestWebhookOccurredAt !== null && incomingOccurredAt < latestWebhookOccurredAt) {
    return {
      code: "OUT_OF_ORDER",
      message: "이미 더 최신인 결제 연동 이벤트가 처리되었습니다.",
      ok: false,
    };
  }

  const onlineStatus = payment.onlinePayment?.status;
  const hasRefund = (payment.refundedAmount ?? 0) > 0 || payment.status === "partially_refunded";
  const isTerminal = payment.status === "refunded" || payment.status === "cancelled";

  if (isTerminal) {
    return {
      code: "INVALID_TRANSITION",
      message: "환불 또는 취소가 완료된 결제 상태는 변경할 수 없습니다.",
      ok: false,
    };
  }

  if (event === "paid" && (hasRefund || onlineStatus === "refunded" || onlineStatus === "cancelled")) {
    return {
      code: "INVALID_TRANSITION",
      message: "환불 또는 취소 이력이 있는 결제를 결제 완료로 변경할 수 없습니다.",
      ok: false,
    };
  }

  if (
    event === "failed" &&
    (payment.status === "paid" || hasRefund || onlineStatus === "paid" || onlineStatus === "refunded" || onlineStatus === "cancelled")
  ) {
    return {
      code: "INVALID_TRANSITION",
      message: "결제 완료 또는 환불 이후에는 결제 실패 상태로 변경할 수 없습니다.",
      ok: false,
    };
  }

  if (event === "refunded" && payment.status !== "paid" && payment.status !== "partially_refunded") {
    return {
      code: "INVALID_TRANSITION",
      message: "결제 완료된 결제만 환불 상태로 변경할 수 있습니다.",
      ok: false,
    };
  }

  return { ok: true };
}
