import { authSecurityLockKey } from "./auth-session.ts";
import { withServerDbLock } from "./db.ts";
import { notificationOutboxLockKey } from "./notification-outbox.ts";

// Keep this order stable so account-security and push-delivery mutations cannot deadlock.
export function withAuthAndNotificationStateLock<Result>(operation: () => Promise<Result>) {
  return withServerDbLock(authSecurityLockKey, () =>
    withServerDbLock(notificationOutboxLockKey, operation),
  );
}
