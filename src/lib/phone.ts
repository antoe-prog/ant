export function normalizePhoneNumber(value: string) {
  const digits = value.trim().replace(/\D/g, "");

  if (digits.startsWith("82") && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }

  return digits;
}

export function isValidKoreanMobileNumber(value: string) {
  return /^01\d{8,9}$/.test(normalizePhoneNumber(value));
}

export function samePhoneNumber(left?: string, right?: string) {
  const normalizedLeft = normalizePhoneNumber(left ?? "");
  const normalizedRight = normalizePhoneNumber(right ?? "");

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}
