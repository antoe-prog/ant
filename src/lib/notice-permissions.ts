import type { AppUser, MockDatabase, Notice, UserRole } from "@/lib/domain";
import { canReadNotice } from "@/lib/mock-api";

export const noticePublisherRoles = new Set<UserRole>(["owner", "admin", "coach"]);

export function canDeleteNotice(user: AppUser, db: MockDatabase, notice: Notice) {
  if (!noticePublisherRoles.has(user.role) || !canReadNotice(user, db, notice)) {
    return false;
  }

  if (user.role === "owner" || user.role === "admin") {
    return true;
  }

  return notice.createdByUserId === user.id;
}
