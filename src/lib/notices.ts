import type { ClassSession, Notice, NoticeAudience } from "./domain";

export type SortableNotice = {
  createdAt: string;
  important?: boolean;
};

export const noticeStateLockKey = "notice-state";

export function getNoticeReadByUserIds(notice: Pick<Notice, "readByUserIds">) {
  return notice.readByUserIds ?? [];
}

export function getNoticeReadCount(notice: Pick<Notice, "readByUserIds">) {
  return getNoticeReadByUserIds(notice).length;
}

export function isNoticeReadByUser(notice: Pick<Notice, "readByUserIds">, userId: string) {
  return getNoticeReadByUserIds(notice).includes(userId);
}

export function hasSameNoticeAudience(left: readonly NoticeAudience[], right: readonly NoticeAudience[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return leftSet.size === rightSet.size && [...leftSet].every((item) => rightSet.has(item));
}

export function hasNoticeVisibleContentChanged(
  current: Pick<Notice, "audience" | "body" | "important" | "title">,
  next: Pick<Notice, "audience" | "body" | "important" | "title">,
) {
  return (
    current.title !== next.title ||
    current.body !== next.body ||
    (current.important === true) !== (next.important === true) ||
    !hasSameNoticeAudience(current.audience, next.audience)
  );
}

export function isNoticeRelevantToMember(
  notice: Pick<Notice, "targetClassIds" | "targetMemberIds">,
  memberId: string,
  classes: readonly Pick<ClassSession, "enrolledMemberIds" | "id">[],
) {
  const targetClassIds = notice.targetClassIds ?? [];
  const targetMemberIds = notice.targetMemberIds ?? [];

  if (targetClassIds.length === 0 && targetMemberIds.length === 0) {
    return true;
  }

  if (targetMemberIds.includes(memberId)) {
    return true;
  }

  const memberClassIds = new Set(
    classes.filter((session) => session.enrolledMemberIds.includes(memberId)).map((session) => session.id),
  );

  return targetClassIds.some((classId) => memberClassIds.has(classId));
}

export function sortNoticesForDisplay<T extends SortableNotice>(notices: T[]) {
  return [...notices].sort(
    (a, b) => Number(Boolean(b.important)) - Number(Boolean(a.important)) || b.createdAt.localeCompare(a.createdAt),
  );
}
