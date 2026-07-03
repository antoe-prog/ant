export const defaultPilotDataFile = "docs/pilot-templates/pilot-data-intake.csv";

export const requiredHeaders = [
  "type",
  "branch_name",
  "name",
  "email",
  "phone",
  "role",
  "member_name",
  "guardian_name",
  "class_name",
  "age_group",
  "level",
  "belt",
  "coach_name",
  "starts_at",
  "ends_at",
  "capacity",
  "membership_name",
  "payment_status",
  "amount_krw",
  "expires_on",
  "notes",
];

export const requiredRoles = ["admin", "owner", "coach", "guardian", "member"];

const allowedTypes = new Set(["branch", "user", "member", "class", "notice"]);
const allowedRoles = new Set(requiredRoles);
const allowedAgeGroups = new Set(["kids", "teen", "adult"]);
const allowedPaymentStatuses = new Set(["scheduled", "paid", "overdue", "cancelled", "refunded", "partially_refunded", "expiringSoon"]);
export const sensitivePatterns = [
  { label: "resident registration number", pattern: /\b\d{6}-[1-4]\d{6}\b/ },
  { label: "resident registration keyword", pattern: /주민등록|주민번호/ },
  { label: "highly sensitive medical detail", pattern: /진단명|처방전|투약|수술명|병력 상세/ },
  { label: "biometric data", pattern: /지문|홍채|생체정보|유전자/ },
];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function isDateLike(value) {
  return value && !Number.isNaN(Date.parse(value));
}

function requireValue(row, field, errors, rowNumber) {
  if (!row[field]) {
    errors.push(`row ${rowNumber}: ${field} is required`);
  }
}

export function validateRows(rows) {
  const errors = [];
  const warnings = [];
  const [headers, ...records] = rows;

  if (!headers) {
    return { errors: ["CSV is empty"], warnings, records: [] };
  }

  const normalizedHeaders = headers.map((header) => header.trim());
  const missingHeaders = requiredHeaders.filter((header) => !normalizedHeaders.includes(header));

  if (missingHeaders.length > 0) {
    errors.push(`missing required headers: ${missingHeaders.join(", ")}`);
  }

  const normalizedRecords = records.map((record, index) => {
    const row = Object.fromEntries(normalizedHeaders.map((header, headerIndex) => [header, record[headerIndex]?.trim() ?? ""]));
    return { row, rowNumber: index + 2 };
  });

  const rowsByType = new Map();
  const userRoles = new Set();
  const userEmails = new Set();
  const coachNames = new Set();
  const guardianNames = new Set();
  const memberNames = new Set();
  const branchNames = new Set();

  for (const { row, rowNumber } of normalizedRecords) {
    if (!row.type) {
      errors.push(`row ${rowNumber}: type is required`);
      continue;
    }

    if (!allowedTypes.has(row.type)) {
      errors.push(`row ${rowNumber}: unsupported type "${row.type}"`);
    }

    if (!row.branch_name) {
      errors.push(`row ${rowNumber}: branch_name is required`);
    } else {
      branchNames.add(row.branch_name);
    }

    rowsByType.set(row.type, (rowsByType.get(row.type) ?? 0) + 1);

    if (row.type === "branch") {
      requireValue(row, "branch_name", errors, rowNumber);
    }

    if (row.type === "user") {
      requireValue(row, "name", errors, rowNumber);
      requireValue(row, "email", errors, rowNumber);
      requireValue(row, "role", errors, rowNumber);

      if (row.email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
          errors.push(`row ${rowNumber}: email is invalid`);
        }

        if (userEmails.has(row.email)) {
          errors.push(`row ${rowNumber}: duplicate email "${row.email}"`);
        }
        userEmails.add(row.email);
      }

      if (row.role && !allowedRoles.has(row.role)) {
        errors.push(`row ${rowNumber}: unsupported role "${row.role}"`);
      }

      if (row.role) {
        userRoles.add(row.role);
      }

      if (row.role === "coach") {
        coachNames.add(row.name);
      }

      if (row.role === "guardian") {
        guardianNames.add(row.name);
      }
    }

    if (row.type === "member") {
      requireValue(row, "member_name", errors, rowNumber);
      requireValue(row, "age_group", errors, rowNumber);
      requireValue(row, "level", errors, rowNumber);
      requireValue(row, "belt", errors, rowNumber);
      requireValue(row, "coach_name", errors, rowNumber);
      requireValue(row, "membership_name", errors, rowNumber);
      requireValue(row, "payment_status", errors, rowNumber);
      requireValue(row, "amount_krw", errors, rowNumber);
      requireValue(row, "expires_on", errors, rowNumber);

      if (row.member_name) {
        memberNames.add(row.member_name);
      }

      if (row.age_group && !allowedAgeGroups.has(row.age_group)) {
        errors.push(`row ${rowNumber}: age_group must be kids, teen, or adult`);
      }

      if ((row.age_group === "kids" || row.age_group === "teen") && !row.guardian_name) {
        errors.push(`row ${rowNumber}: guardian_name is required for kids/teen members`);
      }

      if (row.coach_name && !coachNames.has(row.coach_name)) {
        errors.push(`row ${rowNumber}: coach_name "${row.coach_name}" must match a coach user row`);
      }

      if (row.guardian_name && !guardianNames.has(row.guardian_name)) {
        errors.push(`row ${rowNumber}: guardian_name "${row.guardian_name}" must match a guardian user row`);
      }

      if (row.payment_status && !allowedPaymentStatuses.has(row.payment_status)) {
        errors.push(`row ${rowNumber}: payment_status "${row.payment_status}" is unsupported`);
      }

      if (row.amount_krw && (!Number.isInteger(Number(row.amount_krw)) || Number(row.amount_krw) < 0)) {
        errors.push(`row ${rowNumber}: amount_krw must be a non-negative integer`);
      }

      if (row.expires_on && !isDateLike(row.expires_on)) {
        errors.push(`row ${rowNumber}: expires_on must be a valid date`);
      }
    }

    if (row.type === "class") {
      requireValue(row, "class_name", errors, rowNumber);
      requireValue(row, "age_group", errors, rowNumber);
      requireValue(row, "level", errors, rowNumber);
      requireValue(row, "coach_name", errors, rowNumber);
      requireValue(row, "starts_at", errors, rowNumber);
      requireValue(row, "ends_at", errors, rowNumber);
      requireValue(row, "capacity", errors, rowNumber);

      if (row.coach_name && !coachNames.has(row.coach_name)) {
        errors.push(`row ${rowNumber}: class coach_name "${row.coach_name}" must match a coach user row`);
      }

      if (row.age_group && !allowedAgeGroups.has(row.age_group)) {
        errors.push(`row ${rowNumber}: class age_group must be kids, teen, or adult`);
      }

      if (row.starts_at && !isDateLike(row.starts_at)) {
        errors.push(`row ${rowNumber}: starts_at must be a valid datetime`);
      }

      if (row.ends_at && !isDateLike(row.ends_at)) {
        errors.push(`row ${rowNumber}: ends_at must be a valid datetime`);
      }

      if (isDateLike(row.starts_at) && isDateLike(row.ends_at) && Date.parse(row.ends_at) <= Date.parse(row.starts_at)) {
        errors.push(`row ${rowNumber}: ends_at must be after starts_at`);
      }

      if (row.capacity && (!Number.isInteger(Number(row.capacity)) || Number(row.capacity) <= 0)) {
        errors.push(`row ${rowNumber}: capacity must be a positive integer`);
      }
    }

    if (row.type === "notice") {
      requireValue(row, "notes", errors, rowNumber);
    }

    const joinedValues = Object.values(row).join(" ");
    for (const sensitive of sensitivePatterns) {
      if (sensitive.pattern.test(joinedValues)) {
        errors.push(`row ${rowNumber}: remove ${sensitive.label} before pilot import`);
      }
    }
  }

  for (const type of ["branch", "user", "member", "class", "notice"]) {
    if (!rowsByType.has(type)) {
      errors.push(`missing required row type "${type}"`);
    }
  }

  for (const role of requiredRoles) {
    if (!userRoles.has(role)) {
      errors.push(`missing pilot user role "${role}"`);
    }
  }

  if (branchNames.size === 1) {
    warnings.push("only one pilot branch is present; the second branch is optional but useful for scope regression checks");
  }

  if (memberNames.size < 2) {
    warnings.push("fewer than two members are present; add another member if guardian/member comparison testing is needed");
  }

  return { errors, warnings, records: normalizedRecords };
}
