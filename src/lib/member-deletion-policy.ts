import type { AppUser, Member, Payment } from "./domain.ts";

export function getMemberDeletionSecurityAffectedUserIds(
  users: readonly AppUser[],
  member: Pick<Member, "guardianIds" | "id">,
) {
  const guardianIds = new Set(member.guardianIds);

  return users
    .filter(
      (user) =>
        guardianIds.has(user.id) ||
        (user.memberIds ?? []).includes(member.id) ||
        (user.childMemberIds ?? []).includes(member.id),
    )
    .map((user) => user.id);
}

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
