import { parseCsv } from "./pilot-data-utils.mjs";

const { pilotReadinessDefinitions, prePilotReadinessIds } = await import("../src/lib/pilot-readiness.ts");

export const allowedReadinessEvidenceStatuses = new Set(["pending", "verified", "blocked"]);
export const requiredReadinessEvidenceHeaders = ["id", "category", "label", "owner", "status", "evidence"];
export const readinessEvidencePlaceholderPattern = /\b(todo|tbd|placeholder)\b|미정|확인 필요/i;

export function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function addReadinessEvidenceIssue(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

export function readinessDefinitionsForPhase(phase) {
  if (phase === "pre-pilot") {
    return pilotReadinessDefinitions.filter((definition) => prePilotReadinessIds.includes(definition.id));
  }

  if (phase === "post-pilot" || phase === "all") {
    return pilotReadinessDefinitions;
  }

  throw new Error("--phase must be pre-pilot, post-pilot, or all.");
}

export function rowObjectsFromReadinessEvidenceCsv(csv) {
  const [headers, ...rows] = csv ? parseCsv(csv) : [];

  if (!headers) {
    return { headers: [], records: [] };
  }

  const normalizedHeaders = headers.map((header) => header.trim());

  return {
    headers: normalizedHeaders,
    records: rows.map((record, index) => ({
      row: Object.fromEntries(normalizedHeaders.map((header, headerIndex) => [header, record[headerIndex]?.trim() ?? ""])),
      rowNumber: index + 2,
    })),
  };
}

export function validateReadinessEvidenceCsv(csv, { filePath, phase }) {
  const blockers = [];
  const { headers, records } = rowObjectsFromReadinessEvidenceCsv(csv);
  const missingHeaders = requiredReadinessEvidenceHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_HEADERS_MISSING", "pilot readiness evidence CSV is missing required headers.", {
      missingHeaders,
    });
  }

  const requiredDefinitions = readinessDefinitionsForPhase(phase);
  const definitionsById = new Map(pilotReadinessDefinitions.map((definition) => [definition.id, definition]));
  const requiredIds = requiredDefinitions.map((definition) => definition.id);
  const rowsById = new Map();
  const duplicateIds = [];

  for (const { row, rowNumber } of records) {
    const id = text(row.id);
    const status = text(row.status);
    const evidence = text(row.evidence);
    const owner = text(row.owner);
    const definition = definitionsById.get(id);

    if (!id) {
      addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_ID_MISSING", "readiness evidence row must include id.", { rowNumber });
      continue;
    }

    if (rowsById.has(id)) {
      duplicateIds.push(id);
    }
    rowsById.set(id, row);

    if (!definition) {
      addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_ID_UNKNOWN", "readiness evidence row id is not part of the shared readiness contract.", {
        id,
        rowNumber,
      });
      continue;
    }

    if (text(row.category) !== definition.category) {
      addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_CATEGORY_MISMATCH", "readiness evidence category must match the shared contract.", {
        id,
        expected: definition.category,
        actual: row.category ?? null,
      });
    }

    if (text(row.label) !== definition.label) {
      addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_LABEL_MISMATCH", "readiness evidence label must match the shared contract.", {
        id,
        expected: definition.label,
        actual: row.label ?? null,
      });
    }

    if (!owner || readinessEvidencePlaceholderPattern.test(owner)) {
      addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_OWNER_MISSING", "readiness evidence owner must be filled.", { id, rowNumber });
    }

    if (!allowedReadinessEvidenceStatuses.has(status)) {
      addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_STATUS_INVALID", "readiness evidence status must be pending, verified, or blocked.", {
        id,
        status,
        rowNumber,
      });
    }

    if ((status === "verified" || status === "blocked") && (evidence.length < 5 || readinessEvidencePlaceholderPattern.test(evidence))) {
      addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_PROOF_MISSING", "verified/blocked readiness rows require final evidence.", {
        id,
        status,
        rowNumber,
      });
    }
  }

  if (duplicateIds.length > 0) {
    addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_ID_DUPLICATE", "readiness evidence CSV must not duplicate ids.", { duplicateIds });
  }

  const missingIds = requiredIds.filter((id) => !rowsById.has(id));
  if (missingIds.length > 0) {
    addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_REQUIRED_ID_MISSING", "readiness evidence CSV is missing required readiness ids.", {
      phase,
      missingIds,
    });
  }

  const statusCounts = records.reduce((counts, { row }) => {
    const status = text(row.status) || "missing";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    ok: blockers.length === 0,
    file: filePath,
    phase,
    headers,
    records,
    statusCounts,
    requiredIds,
    blockers,
    checked: [
      "required readiness evidence CSV headers",
      "shared readiness contract ids/categories/labels",
      "owner and status fields",
      "verified/blocked evidence proof",
    ],
  };
}
