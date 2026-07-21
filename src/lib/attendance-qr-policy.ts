import type { ClassSession } from "./domain.ts";
import { formatDateKey } from "./format.ts";

export const attendanceQrPayloadPrefix = "final-judo:attendance:";
export const attendanceQrLifetimeMs = 5 * 60 * 1_000;
export const attendanceQrEarlyWindowMs = 30 * 60 * 1_000;
export const attendanceQrLateWindowMs = 2 * 60 * 60 * 1_000;
export const attendanceQrPayloadMaxLength = 160;

export function isAttendanceQrWindowOpen(session: Pick<ClassSession, "startsAt" | "endsAt">, now = new Date()) {
  const startsAt = Date.parse(session.startsAt);
  const endsAt = Date.parse(session.endsAt);
  const nowMs = now.getTime();

  return (
    Number.isFinite(startsAt) &&
    Number.isFinite(endsAt) &&
    formatDateKey(session.startsAt) === formatDateKey(now) &&
    nowMs >= startsAt - attendanceQrEarlyWindowMs &&
    nowMs <= endsAt + attendanceQrLateWindowMs
  );
}
