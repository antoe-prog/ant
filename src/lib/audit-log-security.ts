import type { AuditLog } from "@/lib/domain";

const protectedValue = "[보호됨]";
const sensitiveContentValue = "[민감 내용]";
const sensitiveContentKeys = new Set([
  "alerts",
  "content",
  "evidence",
  "mobileattendanceevidence",
  "useragent",
  "workaround",
]);
const memberDeletionBeforeKeys = new Set(["ageGroup", "branchId", "status"]);

function maskEmail(value: string) {
  if (value.includes("*")) {
    return value;
  }

  const separatorIndex = value.indexOf("@");

  if (separatorIndex <= 0) {
    return protectedValue;
  }

  return `${value.slice(0, 1)}***${value.slice(separatorIndex)}`;
}

function maskPhone(value: string) {
  if (value.includes("*")) {
    return value;
  }

  const digits = value.replace(/\D/g, "");

  if (digits.length < 7) {
    return protectedValue;
  }

  const localDigits = digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
  const prefix = localDigits.slice(0, 3);
  const suffix = localDigits.slice(-4);

  return `${prefix}-****-${suffix}`;
}

function maskIdentifier(value: string) {
  if (value.includes("@")) {
    return maskEmail(value);
  }

  if (/(?:\+82|0)1[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(value)) {
    return maskPhone(value);
  }

  if (value.length <= 2) {
    return protectedValue;
  }

  return `${value.slice(0, 1)}***${value.slice(-1)}`;
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\b(?:sk|pk|whsec)_(?:live|test)_[A-Za-z0-9_=-]+\b/g, protectedValue)
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, protectedValue)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => maskEmail(email))
    .replace(/(?:\+82[-\s]?1[016789]|01[016789])[-\s]?\d{3,4}[-\s]?\d{4}/g, (phone) => maskPhone(phone));
}

function isProtectedKey(key: string) {
  const normalizedKey = key.toLowerCase();

  return (
    normalizedKey === "authorization" ||
    normalizedKey === "cookie" ||
    normalizedKey === "endpoint" ||
    normalizedKey === "password" ||
    normalizedKey === "temporarypassword" ||
    normalizedKey.includes("hash") ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("token")
  );
}

function summarizeSensitiveContent(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? [] : `[민감 내용 ${value.length}건]`;
  }

  return sensitiveContentValue;
}

function sanitizeAuditValue(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase();

  if (isProtectedKey(key)) {
    return value === null || value === undefined ? value : protectedValue;
  }

  if (sensitiveContentKeys.has(normalizedKey)) {
    return summarizeSensitiveContent(value);
  }

  if (typeof value === "string") {
    if (normalizedKey.includes("email")) {
      return maskEmail(value);
    }

    if (normalizedKey.includes("phone") || normalizedKey.includes("mobile") || normalizedKey === "emergencycontact") {
      return maskPhone(value);
    }

    if (normalizedKey === "identifier") {
      return maskIdentifier(value);
    }

    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(key, item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeAuditValue(entryKey, entryValue)]),
    );
  }

  return value;
}

export function sanitizeAuditPayload(payload: AuditLog["before"] | AuditLog["after"]) {
  if (!payload) {
    return payload;
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, sanitizeAuditValue(key, value)]),
  );
}

function sanitizeMemberDeletionBefore(payload: AuditLog["before"]) {
  if (!payload) {
    return payload;
  }

  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => memberDeletionBeforeKeys.has(key))
      .map(([key, value]) => [key, sanitizeAuditValue(key, value)]),
  );
}

function sanitizeMemberDeletionAfter(payload: AuditLog["after"]) {
  const sanitized = sanitizeAuditPayload(payload);

  if (!sanitized) {
    return sanitized;
  }

  const { reason, ...operationalState } = sanitized;

  return {
    ...operationalState,
    ...(reason !== null && reason !== undefined && reason !== "" ? { reasonRecorded: true } : {}),
  };
}

export function sanitizeAuditLog(log: AuditLog): AuditLog {
  return {
    ...log,
    before: log.action === "member.delete"
      ? sanitizeMemberDeletionBefore(log.before)
      : sanitizeAuditPayload(log.before),
    after: log.action === "member.delete"
      ? sanitizeMemberDeletionAfter(log.after)
      : sanitizeAuditPayload(log.after),
  };
}
