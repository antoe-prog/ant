import type { Payment, PaymentStatus } from "@/lib/domain";

export const manualPaymentEditableStatuses = [
  "scheduled",
  "paid",
  "overdue",
  "expiringSoon",
  "cancelled",
] as const satisfies readonly PaymentStatus[];

export const manualPaymentCreatableStatuses = [
  "paid",
  "scheduled",
  "overdue",
  "expiringSoon",
  "cancelled",
  "refunded",
] as const satisfies readonly PaymentStatus[];

export function requiresManualPaymentCreateReason(status: PaymentStatus) {
  return status === "cancelled" || status === "refunded";
}

export type ManualPaymentUpdatePayload = Pick<
  Payment,
  "amount" | "dueDate" | "expiresAt" | "planName" | "status"
> & {
  discountAmount: number;
  reason: string;
};

type ManualPaymentUpdateValidation =
  | { ok: true; value: ManualPaymentUpdatePayload }
  | { ok: false; message: string };

function isDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);

  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function getManualPaymentDateRangeError(dueDate: string, expiresAt: string) {
  if (!isDateOnly(dueDate) || !isDateOnly(expiresAt)) {
    return "납부일과 만료일을 확인해 주세요.";
  }

  if (expiresAt < dueDate) {
    return "만료일은 납부일과 같거나 이후여야 합니다.";
  }

  return null;
}

export function getManualPaymentManagementBlockReason(payment: Payment) {
  if (payment.onlinePayment) {
    return "온라인 결제 이력이 있어 수정하거나 삭제할 수 없습니다.";
  }

  if (payment.recurringAgreement) {
    return "정기결제 약정 이력이 있어 수정하거나 삭제할 수 없습니다.";
  }

  if (
    payment.status === "refunded" ||
    payment.status === "partially_refunded" ||
    (payment.refundedAmount ?? 0) > 0
  ) {
    return "환불 이력이 있어 수정하거나 삭제할 수 없습니다.";
  }

  return null;
}

export function canManageManualPayment(payment: Payment) {
  return getManualPaymentManagementBlockReason(payment) === null;
}

export function validateManualPaymentUpdate(input: unknown): ManualPaymentUpdateValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, message: "변경할 수기 결제 정보가 필요합니다." };
  }

  const candidate = input as Record<string, unknown>;
  const planName = typeof candidate.planName === "string" ? candidate.planName.trim() : "";
  const status = candidate.status;
  const amount = candidate.amount;
  const discountAmount = candidate.discountAmount;
  const dueDate = typeof candidate.dueDate === "string" ? candidate.dueDate : "";
  const expiresAt = typeof candidate.expiresAt === "string" ? candidate.expiresAt : "";
  const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";

  if (!planName) {
    return { ok: false, message: "회원권명을 입력해 주세요." };
  }

  if (!manualPaymentEditableStatuses.includes(status as (typeof manualPaymentEditableStatuses)[number])) {
    return { ok: false, message: "변경할 결제 상태가 올바르지 않습니다." };
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return { ok: false, message: "결제 금액은 0원 이상의 숫자여야 합니다." };
  }

  if (
    typeof discountAmount !== "number" ||
    !Number.isFinite(discountAmount) ||
    discountAmount < 0 ||
    discountAmount > amount
  ) {
    return { ok: false, message: "할인 금액은 결제 금액 이하의 0원 이상 숫자여야 합니다." };
  }

  const dateRangeError = getManualPaymentDateRangeError(dueDate, expiresAt);

  if (dateRangeError) {
    return { ok: false, message: dateRangeError };
  }

  if (!reason) {
    return { ok: false, message: "수정 사유를 입력해 주세요." };
  }

  return {
    ok: true,
    value: {
      amount: Math.round(amount),
      discountAmount: Math.round(discountAmount),
      dueDate,
      expiresAt,
      planName,
      reason,
      status: status as PaymentStatus,
    },
  };
}
