import type { AppUser, Member, Payment } from "@/lib/domain";

type PaymentWithMember = Payment & {
  member?: Member;
};

export type FamilyPaymentCheckoutState =
  | "ready"
  | "paid"
  | "pending"
  | "not_payable"
  | "guardian_required"
  | "forbidden";

export type FamilyPaymentCheckoutAccess = {
  canOpen: boolean;
  label: string;
  reason: string;
  state: FamilyPaymentCheckoutState;
};

const payablePaymentStatuses: Payment["status"][] = ["scheduled", "overdue", "expiringSoon", "partially_refunded"];
export const familyPaymentAgeGroupLabels: Record<Member["ageGroup"], string> = {
  adult: "성인",
  kids: "유소년",
  teen: "청소년",
};
const planNameAgePrefixes = /^(성인|유소년|청소년)\s+/;

export function getPaymentCheckoutAmount(payment: Payment) {
  return Math.max(payment.amount - (payment.discountAmount ?? 0) - (payment.refundedAmount ?? 0), 0);
}

export function getFamilyPaymentPlanLine(planName: string, ageGroup: Member["ageGroup"]) {
  const trimmedPlanName = planName.trim();
  const normalizedPlanName = trimmedPlanName.replace(planNameAgePrefixes, "").trim() || trimmedPlanName;

  return `${familyPaymentAgeGroupLabels[ageGroup]} · ${normalizedPlanName}`;
}

function paymentClosedAccess(payment: Payment): FamilyPaymentCheckoutAccess | null {
  if (payment.status === "paid" || payment.onlinePayment?.status === "paid") {
    return {
      canOpen: false,
      label: "결제 완료",
      reason: "이미 완료된 결제입니다.",
      state: "paid",
    };
  }

  if (!payablePaymentStatuses.includes(payment.status) || getPaymentCheckoutAmount(payment) <= 0) {
    return {
      canOpen: false,
      label: "결제 불가",
      reason: "현재 상태에서는 결제를 진행할 수 없습니다.",
      state: "not_payable",
    };
  }

  return null;
}

function authorizedPaymentCheckoutAccess(payment: Payment, reason: string): FamilyPaymentCheckoutAccess {
  const closedAccess = paymentClosedAccess(payment);

  if (closedAccess) {
    return closedAccess;
  }

  return {
    canOpen: true,
    label: payment.onlinePayment?.status === "pending" ? "납부 확인 중" : "납부 정보 확인",
    reason,
    state: payment.onlinePayment?.status === "pending" ? "pending" : "ready",
  };
}

export function getFamilyPaymentCheckoutAccess(
  user: AppUser,
  payment: PaymentWithMember,
  member = payment.member,
): FamilyPaymentCheckoutAccess {
  if (!member) {
    return {
      canOpen: false,
      label: "회원 확인 필요",
      reason: "결제 대상 회원 정보를 확인할 수 없습니다.",
      state: "forbidden",
    };
  }

  if (user.role === "member") {
    const isOwnPayment = (user.memberIds ?? []).includes(payment.memberId);

    if (!isOwnPayment) {
      return {
        canOpen: false,
        label: "결제 불가",
        reason: "본인 결제만 진행할 수 있습니다.",
        state: "forbidden",
      };
    }

    if (member.ageGroup !== "adult") {
      const closedAccess = paymentClosedAccess(payment);

      if (closedAccess) {
        return closedAccess;
      }

      return {
        canOpen: false,
        label: "학부모 결제",
        reason: "유소년/청소년 회원 결제는 학부모 계정에서 진행합니다.",
        state: "guardian_required",
      };
    }

    return authorizedPaymentCheckoutAccess(payment, "성인 회원 본인 결제 대상입니다.");
  }

  if (user.role === "guardian") {
    const canPayForChild =
      member.ageGroup !== "adult" &&
      (user.childMemberIds ?? []).includes(payment.memberId) &&
      member.guardianIds.includes(user.id);

    if (!canPayForChild) {
      return {
        canOpen: false,
        label: "결제 불가",
        reason: "연결된 유소년/청소년 회원 결제만 진행할 수 있습니다.",
        state: "forbidden",
      };
    }

    return authorizedPaymentCheckoutAccess(payment, "학부모 결제 대상입니다.");
  }

  return {
    canOpen: false,
    label: "운영 확인",
    reason: "회원 또는 학부모 계정에서 결제를 진행합니다.",
    state: "forbidden",
  };
}
