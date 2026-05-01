export function onlyDigits(value: string): string {
  return value.replace(/[^\d]/g, "");
}

export function formatDateInput(value: string): string {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function formatPhoneInput(value: string): string {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function formatWonInput(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "";
  return Number(digits).toLocaleString("ko-KR");
}

export function parseWonInput(value: string): number {
  const amount = Number.parseInt(onlyDigits(value), 10);
  return Number.isFinite(amount) ? amount : 0;
}
