const dateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Seoul",
  year: "numeric",
});

export function formatDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = Object.fromEntries(dateKeyFormatter.formatToParts(date).map((part) => [part.type, part.value]));

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDaysToDateKey(dateInput: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);

  if (!match) {
    return formatDateKey(new Date());
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatDateKey(parsed);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTimeRange(startsAt: string, endsAt: string) {
  return `${formatTime(startsAt)} - ${formatTime(endsAt)}`;
}

export function formatCompactTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatCompactTimeRange(startsAt: string, endsAt: string) {
  return `${formatCompactTime(startsAt)}-${formatCompactTime(endsAt)}`;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPhoneNumber(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("010")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 12 && digits.startsWith("8210")) {
    return `010-${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  return trimmed;
}
