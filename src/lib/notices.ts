import type { Notice, NoticeAudience } from "./domain";

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

export function sortNoticesForDisplay<T extends SortableNotice>(notices: T[]) {
  return [...notices].sort(
    (a, b) => Number(Boolean(b.important)) - Number(Boolean(a.important)) || b.createdAt.localeCompare(a.createdAt),
  );
}
