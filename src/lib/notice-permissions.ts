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

// 수정 권한은 삭제 권한과 동일: 대표/총괄은 전체, 코치는 본인이 작성한 공지만
export function canEditNotice(user: AppUser, db: MockDatabase, notice: Notice) {
  return canDeleteNotice(user, db, notice);
}
