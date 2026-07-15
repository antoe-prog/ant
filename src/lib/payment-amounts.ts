export type PaymentAmountSource = {
  amount: number;
  discountAmount?: number;
  refundedAmount?: number;
};

function nonNegativeAmount(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : 0;
}

export function getPaymentNetAmount(payment: PaymentAmountSource) {
  const amount = nonNegativeAmount(payment.amount);
  const discountAmount = Math.min(nonNegativeAmount(payment.discountAmount), amount);

  return amount - discountAmount;
}

export function getPaymentRemainingRefundableAmount(payment: PaymentAmountSource) {
  return Math.max(getPaymentNetAmount(payment) - nonNegativeAmount(payment.refundedAmount), 0);
}

export function canRefundPaymentAmount(payment: PaymentAmountSource, refundAmount: number) {
  return (
    Number.isSafeInteger(refundAmount) &&
    refundAmount > 0 &&
    refundAmount <= getPaymentRemainingRefundableAmount(payment)
  );
}
