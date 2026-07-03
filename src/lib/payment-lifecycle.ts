import type { Payment, PaymentStatus, PaymentStatusHistoryEntry } from "@/lib/domain";

type PaymentStatusHistoryInput = {
  actorUserId: string;
  changedAt?: string;
  event: PaymentStatusHistoryEntry["event"];
  providerEventId?: string;
  reason: string;
  status: PaymentStatus;
};

export function createPaymentStatusHistoryEntry(input: PaymentStatusHistoryInput): PaymentStatusHistoryEntry {
  const changedAt = input.changedAt ?? new Date().toISOString();

  return {
    id: `payment-status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actorUserId: input.actorUserId,
    changedAt,
    event: input.event,
    ...(input.providerEventId ? { providerEventId: input.providerEventId } : {}),
    reason: input.reason,
    status: input.status,
  };
}

export function appendPaymentStatusHistory(payment: Payment, entry: PaymentStatusHistoryEntry): Payment {
  return {
    ...payment,
    statusHistory: [...(payment.statusHistory ?? []), entry],
  };
}

export function getLatestPaymentStatusChange(payment: Payment) {
  return [...(payment.statusHistory ?? [])].sort((left, right) => right.changedAt.localeCompare(left.changedAt)).at(0);
}
