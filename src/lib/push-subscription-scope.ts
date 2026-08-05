import type { AppUser, MockDatabase, Notice, PushSubscriptionRecord } from "./domain.ts";
import { isNoticeRecipient } from "./mock-api.ts";

export function getNoticeRecipients(db: MockDatabase, notice: Notice) {
  return db.users.filter((user) => isNoticeRecipient(user, db, notice));
}

export function getNoticePushSubscriptions(db: MockDatabase, notice: Notice) {
  const recipientIds = new Set(getNoticeRecipients(db, notice).map((user) => user.id));

  return db.pushSubscriptions.filter(
    (subscription) => !subscription.disabledAt && recipientIds.has(subscription.userId),
  );
}

export function isPushSubscriptionOwnedByRecipient(
  subscription: PushSubscriptionRecord,
  recipientUserId: string,
) {
  return subscription.userId === recipientUserId;
}

export function getVisibleActivePushSubscriptionCount(db: MockDatabase, user: AppUser) {
  const activeSubscriptions = db.pushSubscriptions.filter((subscription) => !subscription.disabledAt);

  if (user.role === "owner" || user.role === "admin") {
    const branchIds = new Set(user.branchIds);

    return activeSubscriptions.filter((subscription) => {
      const subscriber = db.users.find((candidate) => candidate.id === subscription.userId);

      return Boolean(
        subscriber &&
        (user.role === "admin" || subscriber.branchIds.some((branchId) => branchIds.has(branchId))),
      );
    }).length;
  }

  return activeSubscriptions.filter((subscription) => subscription.userId === user.id).length;
}
