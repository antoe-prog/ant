export type AuditDateBoundary = "from" | "to";

export const auditLogQueryLimits = {
  branchId: 200,
  query: 120,
  reason: 500,
} as const;

const koreaUtcOffsetMs = 9 * 60 * 60 * 1_000;

function parseKoreanDateOnly(value: string, boundary: AuditDateBoundary) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    return "invalid" as const;
  }

  const localTime =
    boundary === "from"
      ? Date.UTC(year, month - 1, day, 0, 0, 0, 0)
      : Date.UTC(year, month - 1, day, 23, 59, 59, 999);

  return new Date(localTime - koreaUtcOffsetMs);
}

export function parseAuditDateParam(value: string | null, boundary: AuditDateBoundary) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  const dateOnly = parseKoreanDateOnly(normalizedValue, boundary);

  if (dateOnly) {
    return dateOnly;
  }

  const date = new Date(normalizedValue);

  return Number.isNaN(date.getTime()) ? ("invalid" as const) : date;
}

export function isAuditDateRangeValid(from: Date | null, to: Date | null) {
  return !from || !to || from.getTime() <= to.getTime();
}
