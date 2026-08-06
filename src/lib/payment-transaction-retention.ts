import type { Payment, RetainedPaymentTransaction } from "./domain.ts";

const transactionRetentionYears = 5;

export function getTransactionRetentionExpiresAt(retainedAt: string) {
  const expiresAt = new Date(retainedAt);

  if (!Number.isFinite(expiresAt.getTime())) {
    throw new Error("거래 기록 보존 시작 시각이 올바르지 않습니다.");
  }

  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + transactionRetentionYears);
  return expiresAt.toISOString();
}

export function createRetainedPaymentTransactions({
  payments,
  memberId,
  branchId,
  deletionAuditLogId,
  retainedAt,
}: {
  payments: readonly Payment[];
  memberId: string;
  branchId: string;
  deletionAuditLogId: string;
  retainedAt: string;
}): RetainedPaymentTransaction[] {
  const retentionExpiresAt = getTransactionRetentionExpiresAt(retainedAt);

  return payments
    .filter((payment) => payment.memberId === memberId)
    .map((payment) => ({
      id: `retained-${deletionAuditLogId}-${payment.id}`,
      branchId,
      memberReference: memberId,
      sourcePaymentId: payment.id,
      deletionAuditLogId,
      planName: payment.planName,
      status: payment.status,
      amount: payment.amount,
      ...(payment.discountAmount !== undefined ? { discountAmount: payment.discountAmount } : {}),
      dueDate: payment.dueDate,
      expiresAt: payment.expiresAt,
      ...(payment.refundedAmount !== undefined ? { refundedAmount: payment.refundedAmount } : {}),
      ...(payment.refundedAt ? { refundedAt: payment.refundedAt } : {}),
      ...(payment.onlinePayment
        ? {
            onlinePayment: {
              provider: payment.onlinePayment.provider,
              providerPaymentId: payment.onlinePayment.providerPaymentId,
              status: payment.onlinePayment.status,
              amount: payment.onlinePayment.amount,
              requestedAt: payment.onlinePayment.requestedAt,
              ...(payment.onlinePayment.paidAt ? { paidAt: payment.onlinePayment.paidAt } : {}),
              ...(payment.onlinePayment.failedAt ? { failedAt: payment.onlinePayment.failedAt } : {}),
              ...(payment.onlinePayment.receipt
                ? {
                    receiptId: payment.onlinePayment.receipt.id,
                    receiptIssuedAt: payment.onlinePayment.receipt.issuedAt,
                  }
                : {}),
            },
          }
        : {}),
      ...(payment.recurringAgreement
        ? {
            recurringAgreement: {
              provider: payment.recurringAgreement.provider,
              providerAgreementId: payment.recurringAgreement.providerAgreementId,
              status: payment.recurringAgreement.status,
              requestedAt: payment.recurringAgreement.requestedAt,
              ...(payment.recurringAgreement.activatedAt
                ? { activatedAt: payment.recurringAgreement.activatedAt }
                : {}),
              ...(payment.recurringAgreement.cancelledAt
                ? { cancelledAt: payment.recurringAgreement.cancelledAt }
                : {}),
            },
          }
        : {}),
      statusHistory: (payment.statusHistory ?? []).map((entry) => ({
        status: entry.status,
        changedAt: entry.changedAt,
        actorUserId: entry.actorUserId,
        event: entry.event,
        ...(entry.providerEventId ? { providerEventId: entry.providerEventId } : {}),
      })),
      retainedAt,
      retentionExpiresAt,
      legalBasis: "ecommerce_transaction_record_5y" as const,
    }));
}

export function pruneExpiredRetainedPaymentTransactions(
  records: readonly RetainedPaymentTransaction[],
  now = new Date().toISOString(),
) {
  const nowTimestamp = Date.parse(now);

  if (!Number.isFinite(nowTimestamp)) {
    throw new Error("거래 기록 정리 기준 시각이 올바르지 않습니다.");
  }

  return records.filter((record) => {
    const expiresAtTimestamp = Date.parse(record.retentionExpiresAt);

    // Malformed statutory records must reach integrity validation instead of being silently deleted.
    if (!Number.isFinite(expiresAtTimestamp)) {
      return true;
    }

    return expiresAtTimestamp > nowTimestamp;
  });
}
