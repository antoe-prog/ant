import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const jsonPath = path.resolve(args.json ?? path.join(workspace, "p1-operator-status.json"));
const csvPath = path.resolve(args.csv ?? path.join(workspace, "p1-operator-status-external-blockers.csv"));
const outPath = path.resolve(args.out ?? path.join(workspace, "p1-operator-status-external-blockers.completed.json"));
const markdownPath = args.markdown ? path.resolve(args.markdown) : null;

const requiredHeaders = [
  "key",
  "label",
  "status",
  "blockerCount",
  "ownerLane",
  "evidenceType",
  "requiredEvidence",
  "path",
  "command",
  "nextAction",
  "formatGuardrails",
  "evidenceOwner",
  "evidenceUrl",
  "checkedAt",
  "signoff",
  "notes",
];
const readOnlyFields = [
  "label",
  "status",
  "blockerCount",
  "ownerLane",
  "evidenceType",
  "requiredEvidence",
  "path",
  "command",
  "nextAction",
  "formatGuardrails",
];
const operatorFields = ["evidenceOwner", "evidenceUrl", "checkedAt", "signoff"];

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    parsed[key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }

  return parsed;
}

function text(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function addBlocker(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function hasPlaceholder(value) {
  const source = text(value);
  return !source || /\b(TODO|TBD|placeholder|sample|example|dummy)\b|yyyy|미정|예시|샘플|<[^>]+>/i.test(source);
}

function evidenceReference(value) {
  const source = text(value);
  return /^(https:\/\/|s3:\/\/|gs:\/\/|drive:\/\/|notion:\/\/|slack:\/\/|github:\/\/|file:\/\/|\/|\.data\/|\.\/)/.test(source);
}

function parseDateTime(value) {
  const source = text(value);

  if (!/^\d{4}-\d{2}-\d{2}T/.test(source)) {
    return null;
  }

  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? parsed : null;
}

function secretHits(value) {
  const source = text(value);
  const hits = [];

  if (/-----BEGIN[\s\S]*?-----END [^-]+-----/.test(source)) {
    hits.push("private-key");
  }

  if (/\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source)) {
    hits.push("provider-secret");
  }

  if (/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(source)) {
    hits.push("token");
  }

  if (/FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)) {
    hits.push("default-password");
  }

  return hits;
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) {
    throw new Error("CSV has an unterminated quoted field.");
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((fieldValue) => text(fieldValue)));
}

function rowsFromCsv(source, blockers) {
  let parsedRows = [];

  try {
    parsedRows = parseCsv(source);
  } catch (error) {
    addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_PARSE_ERROR", "External blockers CSV must be parseable.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (parsedRows.length < 2) {
    addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_EMPTY", "External blockers CSV must include a header and blocker rows.");
    return [];
  }

  const headers = parsedRows[0].map(text);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_HEADERS_MISSING", "External blockers CSV is missing required headers.", {
      missingHeaders,
    });
  }

  return parsedRows.slice(1).map((values, rowIndex) => {
    const row = {};

    headers.forEach((header, index) => {
      row[header] = text(values[index]);
    });

    return { ...row, rowNumber: rowIndex + 2 };
  });
}

function expectedCsvRow(report, blocker) {
  const guardrails = Array.isArray(report.evidenceFormatGuardrails)
    ? report.evidenceFormatGuardrails.map((guardrail) => `${text(guardrail?.label)}: ${text(guardrail?.rule)}`).join(" | ")
    : "";

  return {
    key: text(blocker.key),
    label: text(blocker.label),
    status: text(blocker.status),
    blockerCount: blocker.blockerCount === null || blocker.blockerCount === undefined ? "" : text(blocker.blockerCount),
    ownerLane: text(blocker.ownerLane),
    evidenceType: text(blocker.evidenceType),
    requiredEvidence: Array.isArray(blocker.requiredEvidence) ? blocker.requiredEvidence.map(text).join(" | ") : text(blocker.requiredEvidence),
    path: text(blocker.path),
    command: text(blocker.command),
    nextAction: text(blocker.nextAction),
    formatGuardrails: guardrails,
  };
}

function validateCsvRows(csvRows, report, blockers) {
  if (!Array.isArray(report.externalBlockers)) {
    addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_JSON_ROWS_MISSING", "Operator status JSON must include externalBlockers before CSV can be applied.");
    return new Map();
  }

  const expectedKeys = new Set(report.externalBlockers.map((blocker) => text(blocker.key)));
  const seenKeys = new Set();
  const byKey = new Map();

  for (const row of csvRows) {
    const key = text(row.key);

    if (!expectedKeys.has(key)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_ROW_UNKNOWN", "External blockers CSV contains an unknown key.", {
        rowNumber: row.rowNumber,
        key,
      });
      continue;
    }

    if (seenKeys.has(key)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_ROW_DUPLICATE", "External blockers CSV contains a duplicate key.", {
        rowNumber: row.rowNumber,
        key,
      });
      continue;
    }

    seenKeys.add(key);
    byKey.set(key, row);
  }

  for (const expectedKey of expectedKeys) {
    if (!seenKeys.has(expectedKey)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_ROW_MISSING", "External blockers CSV is missing a required key.", {
        key: expectedKey,
      });
    }
  }

  for (const blocker of report.externalBlockers) {
    const expectedRow = expectedCsvRow(report, blocker);
    const csvRow = byKey.get(expectedRow.key);
    if (!csvRow) {
      continue;
    }

    for (const field of readOnlyFields) {
      if (field in csvRow && text(csvRow[field]) !== expectedRow[field]) {
        addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_READONLY_MISMATCH", "External blockers CSV can only edit operator evidence fields.", {
          key: expectedRow.key,
          rowNumber: csvRow.rowNumber,
          field,
          csvValue: csvRow[field],
          expectedValue: expectedRow[field],
        });
      }
    }

    for (const field of operatorFields) {
      if (hasPlaceholder(csvRow[field])) {
        addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_FIELD_PLACEHOLDER", "External blockers CSV must replace every operator evidence field before applying.", {
          key: expectedRow.key,
          rowNumber: csvRow.rowNumber,
          field,
        });
      }

      for (const hit of secretHits(csvRow[field])) {
        addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_SECRET_VALUE", "External blockers CSV must not contain raw secret-like values.", {
          key: expectedRow.key,
          rowNumber: csvRow.rowNumber,
          field,
          type: hit,
        });
      }
    }

    for (const hit of secretHits(csvRow.notes)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_SECRET_VALUE", "External blockers CSV notes must not contain raw secret-like values.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        field: "notes",
        type: hit,
      });
    }

    if (text(csvRow.notes) && hasPlaceholder(csvRow.notes)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_FIELD_PLACEHOLDER", "External blockers CSV notes must not contain placeholder text.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        field: "notes",
      });
    }

    if (!hasPlaceholder(csvRow.evidenceUrl) && !evidenceReference(csvRow.evidenceUrl)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_EVIDENCE_INVALID", "External blockers CSV evidenceUrl must be an HTTPS URL or storage URI.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        evidenceUrl: csvRow.evidenceUrl,
      });
    }

    if (!hasPlaceholder(csvRow.signoff) && !evidenceReference(csvRow.signoff)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_SIGNOFF_INVALID", "External blockers CSV signoff must be an HTTPS URL or storage URI.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        signoff: csvRow.signoff,
      });
    }

    if (!hasPlaceholder(csvRow.checkedAt) && !parseDateTime(csvRow.checkedAt)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_CHECKED_AT_INVALID", "External blockers CSV checkedAt must be an ISO timestamp.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        checkedAt: csvRow.checkedAt,
      });
    }
  }

  return byKey;
}

async function readJsonArtifact(filePath, blockers) {
  try {
    const buffer = await readFile(filePath);
    const source = buffer.toString("utf8");
    const hits = secretHits(source);

    if (hits.length > 0) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_JSON_SECRET_VALUE", "Operator status JSON must not contain raw secret-like values.", {
        path: rel(filePath),
        types: hits,
      });
      return { json: null, sha256: sha256(buffer), sizeBytes: buffer.byteLength };
    }

    return {
      json: JSON.parse(source),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_JSON_UNREADABLE", "Operator status JSON must be readable before CSV can be applied.", {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { json: null, sha256: null, sizeBytes: 0 };
  }
}

async function readCsvArtifact(filePath, blockers) {
  try {
    const buffer = await readFile(filePath);
    const source = buffer.toString("utf8");

    for (const hit of secretHits(source)) {
      addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_SECRET_VALUE", "External blockers CSV must not contain raw secret-like values.", {
        type: hit,
      });
    }

    return {
      source,
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_OPERATOR_EXTERNAL_BLOCKERS_CSV_UNREADABLE", "External blockers CSV must be readable.", {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { source: "", sha256: null, sizeBytes: 0 };
  }
}

function createMarkdown(report, sourceJsonPath) {
  const lines = [
    "# P1 Operator External Blockers Evidence",
    "",
    `- Source operator status: \`${sourceJsonPath}\``,
    `- Applied CSV: \`${report.appliedExternalBlockersCsv.path}\``,
    `- Operator status decision remains: \`${report.releaseDecision}\``,
    `- Completed external blocker rows: ${report.summary.completedExternalBlockers}/${report.summary.externalBlockers}`,
    "",
    "## External Blockers",
    "",
    "| Key | Owner lane | Status | Evidence owner | Evidence URL | Checked at | Signoff |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const blocker of report.externalBlockers) {
    lines.push(
      `| ${blocker.key} | ${blocker.ownerLane} | ${blocker.status} | ${blocker.operatorEvidence.evidenceOwner} | ${blocker.operatorEvidence.evidenceUrl} | ${blocker.operatorEvidence.checkedAt} | ${blocker.operatorEvidence.signoff} |`,
    );
  }

  lines.push(
    "",
    "## Next Action",
    "",
    "- Keep this completed external blocker evidence with the P1 handoff package, then update the strict handoff reports when each external owner actually resolves its blocker.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

const blockers = [];
const jsonRead = await readJsonArtifact(jsonPath, blockers);
const csvRead = await readCsvArtifact(csvPath, blockers);
const csvRows = rowsFromCsv(csvRead.source, blockers);
const rowsByKey = validateCsvRows(csvRows, jsonRead.json ?? {}, blockers);

let output = null;
if (blockers.length === 0 && jsonRead.json) {
  const externalBlockers = jsonRead.json.externalBlockers.map((blocker) => {
    const row = rowsByKey.get(text(blocker.key));

    return {
      ...blocker,
      operatorEvidence: {
        evidenceOwner: text(row.evidenceOwner),
        evidenceUrl: text(row.evidenceUrl),
        checkedAt: text(row.checkedAt),
        signoff: text(row.signoff),
        notes: text(row.notes),
      },
    };
  });

  output = {
    ...jsonRead.json,
    externalBlockerEvidenceReady: true,
    appliedExternalBlockersCsv: {
      path: rel(csvPath),
      sha256: csvRead.sha256,
      sizeBytes: csvRead.sizeBytes,
      appliedAt: new Date().toISOString(),
    },
    outputs: {
      ...(jsonRead.json.outputs ?? {}),
      externalBlockersCompletedJson: rel(outPath),
      externalBlockersCompletedMarkdown: markdownPath ? rel(markdownPath) : null,
    },
    checked: [
      ...(Array.isArray(jsonRead.json.checked) ? jsonRead.json.checked : []),
      "operator external blocker CSV fields are applied to a completed evidence record",
    ],
    summary: {
      ...(jsonRead.json.summary ?? {}),
      externalBlockers: externalBlockers.length,
      operatorExternalBlockerEvidenceRows: externalBlockers.length,
      completedExternalBlockers: externalBlockers.filter((blocker) =>
        operatorFields.every((field) => text(blocker.operatorEvidence?.[field])),
      ).length,
    },
    externalBlockers,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);

  if (markdownPath) {
    await mkdir(path.dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, createMarkdown(output, rel(jsonPath)));
  }
}

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  checked: [
    "operator external blockers CSV is parsed",
    "CSV keys match the operator status externalBlockers exactly",
    "read-only external blocker fields must match the generated operator status JSON",
    "operator evidence fields must be non-placeholder and secret-free",
    "evidenceUrl/signoff must be HTTPS URLs or storage URIs and checkedAt must be ISO",
    "completed external blocker evidence JSON is written separately from the generated status",
  ],
  artifacts: {
    csv: { path: rel(csvPath), sha256: csvRead.sha256, sizeBytes: csvRead.sizeBytes },
    json: { path: rel(jsonPath), sha256: jsonRead.sha256, sizeBytes: jsonRead.sizeBytes },
    out: { path: rel(outPath), written: Boolean(output) },
    markdown: markdownPath ? { path: rel(markdownPath), written: Boolean(output) } : null,
  },
  summary: {
    csvRows: csvRows.length,
    externalBlockers: Array.isArray(jsonRead.json?.externalBlockers) ? jsonRead.json.externalBlockers.length : 0,
    appliedRows: output?.externalBlockers.length ?? 0,
    completedExternalBlockers: output?.summary.completedExternalBlockers ?? 0,
  },
  nextActions:
    blockers.length === 0
      ? [
          "Attach the completed external blocker evidence JSON/Markdown to the P1 handoff package.",
          "Do not mark P1 ready until each underlying handoff report and P1 readiness are strict-ready.",
        ]
      : [
          "Fill every evidenceOwner, evidenceUrl, checkedAt, and signoff cell in the external blockers CSV.",
          "Use HTTPS URLs or storage URIs for evidenceUrl/signoff and ISO timestamps for checkedAt.",
          "Do not edit generated read-only columns such as status, ownerLane, requiredEvidence, command, nextAction, or formatGuardrails.",
          `Rerun \`npm run p1:operator-status:apply-external-blockers-csv -- --csv=${rel(csvPath)} --json=${rel(jsonPath)} --out=${rel(outPath)}${markdownPath ? ` --markdown=${rel(markdownPath)}` : ""}\`.`,
        ],
  blockers,
};

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
