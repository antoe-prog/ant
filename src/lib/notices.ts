import type { Notice } from "./domain";

export type SortableNotice = {
  createdAt: string;
  important?: boolean;
};

export function getNoticeReadByUserIds(notice: Pick<Notice, "readByUserIds">) {
  return notice.readByUserIds ?? [];
}

export function getNoticeReadCount(notice: Pick<Notice, "readByUserIds">) {
  return getNoticeReadByUserIds(notice).length;
}

export function isNoticeReadByUser(notice: Pick<Notice, "readByUserIds">, userId: string) {
  return getNoticeReadByUserIds(notice).includes(userId);
}

export function sortNoticesForDisplay<T extends SortableNotice>(notices: T[]) {
  return [...notices].sort(
    (a, b) => Number(Boolean(b.important)) - Number(Boolean(a.important)) || b.createdAt.localeCompare(a.createdAt),
  );
}
