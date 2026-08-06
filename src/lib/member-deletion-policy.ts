import type { Payment } from "./domain.ts";

export function getMemberDeletionRecurringAgreementBlockers(
  payments: readonly Payment[],
  memberId: string,
) {
  return payments.filter(
    (payment) =>
      payment.memberId === memberId &&
      payment.recurringAgreement &&
      payment.recurringAgreement.status !== "cancelled",
  );
}

export function getMemberDeletionPendingOnlinePaymentBlockers(
  payments: readonly Payment[],
  memberId: string,
) {
  return payments.filter(
    (payment) =>
      payment.memberId === memberId &&
      payment.onlinePayment?.status === "pending",
  );
}
