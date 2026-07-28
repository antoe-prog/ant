import type { Tournament } from "./domain.ts";
import { formatDateKey } from "./format.ts";

export function getTournamentDateKeys(tournament: Pick<Tournament, "eventDate" | "eventEndDate">) {
  const start = new Date(`${tournament.eventDate}T12:00:00Z`);
  const end = new Date(`${tournament.eventEndDate ?? tournament.eventDate}T12:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }

  const dateKeys: string[] = [];
  const cursor = new Date(start);

  // 외부 원본 오류가 달력을 과도하게 확장하지 않도록 한 대회는 최대 31일만 표시한다.
  while (cursor <= end && dateKeys.length < 31) {
    dateKeys.push(formatDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dateKeys;
}
