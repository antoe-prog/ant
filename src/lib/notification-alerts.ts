import type { AppUser, MockDatabase, Payment, UserRole } from "./domain.ts";
import { canReadNotice, getAccessibleBranchIds, getAccessibleMemberIds } from "./mock-api.ts";
import { isNoticeReadByUser } from "./notices.ts";

export function canShowPaymentNotificationForRole(role: UserRole) {
  return role !== "coach";
}

export function isPaymentNotificationCandidate(payment: Pick<Payment, "collectionRequest" | "onlinePayment" | "status">) {
  return (
    payment.status === "overdue" ||
    payment.status === "expiringSoon" ||
    payment.collectionRequest?.status === "pending" ||
    payment.onlinePayment?.status === "pending"
  );
}

export function getNotificationScopeBranchIds(user: AppUser, db: MockDatabase, selectedBranchId: string | null) {
  const accessibleBranchIds = getAccessibleBranchIds(user, db);

  return selectedBranchId && accessibleBranchIds.includes(selectedBranchId) ? [selectedBranchId] : accessibleBranchIds;
}

export const promotionAlertWindowDays = 7;

export function isUpcomingPromotionExam(examDate: string, result: string, now = new Date()) {
  if (result !== "scheduled") {
    return false;
  }

  const exam = new Date(`${examDate.slice(0, 10)}T00:00:00`);

  if (Number.isNaN(exam.getTime())) {
    return false;
  }

  const currentDay = new Date(now);
  currentDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((exam.getTime() - currentDay.getTime()) / (1000 * 60 * 60 * 24));

  return diffDays >= 0 && diffDays <= promotionAlertWindowDays;
}

export function getNotificationAlertCounts({
  db,
  selectedBranchId,
  user,
}: {
  db: MockDatabase;
  selectedBranchId: string | null;
  user: AppUser;
}) {
  const scopeBranchIds = getNotificationScopeBranchIds(user, db, selectedBranchId);
  const memberIds = new Set(getAccessibleMemberIds(user, db, scopeBranchIds));
  const unreadNoticeCount = db.notices.filter(
    (notice) => canReadNotice(user, db, notice, scopeBranchIds) && !isNoticeReadByUser(notice, user.id),
  ).length;
  const paymentAlertCount = canShowPaymentNotificationForRole(user.role)
    ? db.payments.filter(
        (payment) =>
          scopeBranchIds.includes(payment.branchId) &&
          memberIds.has(payment.memberId) &&
          isPaymentNotificationCandidate(payment),
      ).length
    : 0;

  const promotionAlertCount = (db.promotions ?? []).filter(
    (promotion) =>
      scopeBranchIds.includes(promotion.branchId) &&
      memberIds.has(promotion.memberId) &&
      isUpcomingPromotionExam(promotion.examDate, promotion.result),
  ).length;

  return {
    actionableCount: unreadNoticeCount + paymentAlertCount + promotionAlertCount,
    paymentAlertCount,
    promotionAlertCount,
    scopeBranchIds,
    unreadNoticeCount,
  };
}

export function formatNotificationActionableLabel({
  paymentAlertCount,
  promotionAlertCount = 0,
  unreadNoticeCount,
}: {
  paymentAlertCount: number;
  promotionAlertCount?: number;
  unreadNoticeCount: number;
}, separator = ", ") {
  return [
    unreadNoticeCount > 0 ? `미확인 공지 ${unreadNoticeCount}건` : null,
    paymentAlertCount > 0 ? `확인 필요 결제 ${paymentAlertCount}건` : null,
    promotionAlertCount > 0 ? `임박 승급 심사 ${promotionAlertCount}건` : null,
  ]
    .filter(Boolean)
    .join(separator);
}
