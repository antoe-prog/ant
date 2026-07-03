#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const registerPath = path.resolve(args.json ?? path.join(workspace, "p1-owner-decision-register.json"));
const csvPath = path.resolve(args.csv ?? path.join(workspace, "p1-owner-decision-register.csv"));
const outPath = path.resolve(args.out ?? path.join(workspace, "p1-owner-decision-register.completed.json"));
const markdownPath = args.markdown ? path.resolve(args.markdown) : path.join(workspace, "p1-owner-decision-register.completed.md");

const requiredHeaders = [
  "sequence",
  "key",
  "label",
  "status",
  "blockerCount",
  "ownerLane",
  "decisionNeeded",
  "requiredEvidence",
  "decisionOwner",
  "dueDate",
  "evidenceOwner",
  "evidenceUrl",
  "checkedAt",
  "signoff",
  "verificationCommand",
  "nextAction",
  "notes",
];
const readOnlyFields = [
  "sequence",
  "label",
  "status",
  "blockerCount",
  "ownerLane",
  "decisionNeeded",
  "requiredEvidence",
  "verificationCommand",
  "nextAction",
];
const requiredDecisionFields = ["decisionOwner", "dueDate", "evidenceOwner"];

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

function parseDateOnly(value) {
  const source = text(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return null;
  }

  const parsed = Date.parse(`${source}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10) === source ? parsed : null;
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
    addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_PARSE_ERROR", "Decision register CSV must be parseable.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (parsedRows.length < 2) {
    addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_EMPTY", "Decision register CSV must include a header and decision rows.");
    return [];
  }

  const headers = parsedRows[0].map(text);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_HEADERS_MISSING", "Decision register CSV is missing required headers.", {
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

function expectedCsvRow(decisionRow) {
  return {
    sequence: text(decisionRow.sequence),
    key: text(decisionRow.key),
    label: text(decisionRow.label),
    status: text(decisionRow.status),
    blockerCount: decisionRow.blockerCount === null || decisionRow.blockerCount === undefined ? "" : text(decisionRow.blockerCount),
    ownerLane: text(decisionRow.ownerLane),
    decisionNeeded: text(decisionRow.decisionNeeded),
    requiredEvidence: Array.isArray(decisionRow.requiredEvidence)
      ? decisionRow.requiredEvidence.map(text).join(" | ")
      : text(decisionRow.requiredEvidence),
    verificationCommand: text(decisionRow.verificationCommand),
    nextAction: text(decisionRow.nextAction),
  };
}

function validateCsvRows(csvRows, register, blockers) {
  if (!Array.isArray(register.decisionRows)) {
    addBlocker(blockers, "OWNER_DECISION_REGISTER_JSON_ROWS_MISSING", "Decision register JSON must include decisionRows before CSV can be applied.");
    return new Map();
  }

  const expectedKeys = new Set(register.decisionRows.map((row) => text(row.key)));
  const seenKeys = new Set();
  const byKey = new Map();

  for (const row of csvRows) {
    const key = text(row.key);

    if (!expectedKeys.has(key)) {
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_ROW_UNKNOWN", "Decision register CSV contains an unknown key.", {
        rowNumber: row.rowNumber,
        key,
      });
      continue;
    }

    if (seenKeys.has(key)) {
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_ROW_DUPLICATE", "Decision register CSV contains a duplicate key.", {
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
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_ROW_MISSING", "Decision register CSV is missing a required key.", {
        key: expectedKey,
      });
    }
  }

  for (const decisionRow of register.decisionRows) {
    const expectedRow = expectedCsvRow(decisionRow);
    const csvRow = byKey.get(expectedRow.key);
    if (!csvRow) {
      continue;
    }

    for (const field of readOnlyFields) {
      if (field in csvRow && text(csvRow[field]) !== expectedRow[field]) {
        addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_READONLY_MISMATCH", "Decision register CSV can only edit decision input fields.", {
          key: expectedRow.key,
          rowNumber: csvRow.rowNumber,
          field,
          csvValue: csvRow[field],
          expectedValue: expectedRow[field],
        });
      }
    }

    for (const field of requiredDecisionFields) {
      if (hasPlaceholder(csvRow[field])) {
        addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_FIELD_PLACEHOLDER", "Decision register CSV must replace every required decision field before applying.", {
          key: expectedRow.key,
          rowNumber: csvRow.rowNumber,
          field,
        });
      }
    }

    if (!hasPlaceholder(csvRow.dueDate) && !parseDateOnly(csvRow.dueDate)) {
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_DUE_DATE_INVALID", "Decision register CSV dueDate must use YYYY-MM-DD.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        dueDate: csvRow.dueDate,
      });
    }

    if (text(csvRow.evidenceUrl) && (hasPlaceholder(csvRow.evidenceUrl) || !evidenceReference(csvRow.evidenceUrl))) {
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_EVIDENCE_INVALID", "Decision register CSV evidenceUrl must be blank or an HTTPS URL/storage URI.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        evidenceUrl: csvRow.evidenceUrl,
      });
    }

    if (text(csvRow.signoff) && (hasPlaceholder(csvRow.signoff) || !evidenceReference(csvRow.signoff))) {
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_SIGNOFF_INVALID", "Decision register CSV signoff must be blank or an HTTPS URL/storage URI.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        signoff: csvRow.signoff,
      });
    }

    if (text(csvRow.checkedAt) && (hasPlaceholder(csvRow.checkedAt) || !parseDateTime(csvRow.checkedAt))) {
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_CHECKED_AT_INVALID", "Decision register CSV checkedAt must be blank or an ISO timestamp.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        checkedAt: csvRow.checkedAt,
      });
    }

    for (const field of ["decisionOwner", "evidenceOwner", "evidenceUrl", "checkedAt", "signoff", "notes"]) {
      for (const hit of secretHits(csvRow[field])) {
        addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_SECRET_VALUE", "Decision register CSV must not contain raw secret-like values.", {
          key: expectedRow.key,
          rowNumber: csvRow.rowNumber,
          field,
          type: hit,
        });
      }
    }

    if (text(csvRow.notes) && hasPlaceholder(csvRow.notes)) {
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_FIELD_PLACEHOLDER", "Decision register CSV notes must not contain placeholder text.", {
        key: expectedRow.key,
        rowNumber: csvRow.rowNumber,
        field: "notes",
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
      addBlocker(blockers, "OWNER_DECISION_REGISTER_JSON_SECRET_VALUE", "Decision register JSON must not contain raw secret-like values.", {
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
    addBlocker(blockers, "OWNER_DECISION_REGISTER_JSON_UNREADABLE", "Decision register JSON must be readable before CSV can be applied.", {
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
      addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_SECRET_VALUE", "Decision register CSV must not contain raw secret-like values.", {
        type: hit,
      });
    }

    return {
      source,
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "OWNER_DECISION_REGISTER_CSV_UNREADABLE", "Decision register CSV must be readable.", {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { source: "", sha256: null, sizeBytes: 0 };
  }
}

function createMarkdown(report, sourceJsonPath) {
  const lines = [
    "# P1 Owner Decision Register Completed",
    "",
    `- Source decision register: \`${sourceJsonPath}\``,
    `- Applied CSV: \`${report.appliedDecisionRegisterCsv.path}\``,
    `- Register decision: \`${report.registerDecision}\``,
    `- Completed decision rows: ${report.summary.completedDecisionRows}/${report.summary.decisionRows}`,
    "",
    "## Decisions",
    "",
    "| Key | Lane | Decision owner | Due date | Evidence owner | Evidence URL | Checked at | Signoff |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of report.decisionRows) {
    lines.push(
      `| ${row.key} | ${row.ownerLane} | ${row.ownerDecision.decisionOwner} | ${row.ownerDecision.dueDate} | ${row.ownerDecision.evidenceOwner} | ${row.ownerDecision.evidenceUrl} | ${row.ownerDecision.checkedAt} | ${row.ownerDecision.signoff} |`,
    );
  }

  lines.push(
    "",
    "## Next Action",
    "",
    "- Share this completed decision register with external owners, then collect the actual handoff evidence and run each row's verification command.",
    "- This completed register records owner decisions only; it does not make P1 readiness strict-ready by itself.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

const blockers = [];
const jsonRead = await readJsonArtifact(registerPath, blockers);
const csvRead = await readCsvArtifact(csvPath, blockers);
const csvRows = rowsFromCsv(csvRead.source, blockers);
const rowsByKey = validateCsvRows(csvRows, jsonRead.json ?? {}, blockers);

let output = null;
if (blockers.length === 0 && jsonRead.json) {
  const decisionRows = jsonRead.json.decisionRows.map((decisionRow) => {
    const row = rowsByKey.get(text(decisionRow.key));

    return {
      ...decisionRow,
      ownerDecision: {
        decisionOwner: text(row.decisionOwner),
        dueDate: text(row.dueDate),
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
    ownerDecisionRegisterCompleted: true,
    registerDecision: "decisions_recorded",
    appliedDecisionRegisterCsv: {
      path: rel(csvPath),
      sha256: csvRead.sha256,
      sizeBytes: csvRead.sizeBytes,
      appliedAt: new Date().toISOString(),
    },
    outputs: {
      ...(jsonRead.json.outputs ?? {}),
      completedJson: rel(outPath),
      completedMarkdown: markdownPath ? rel(markdownPath) : null,
    },
    checked: [
      ...(Array.isArray(jsonRead.json.checked) ? jsonRead.json.checked : []),
      "owner decision CSV fields are applied to a completed decision register",
    ],
    summary: {
      ...(jsonRead.json.summary ?? {}),
      decisionRows: decisionRows.length,
      completedDecisionRows: decisionRows.filter((row) =>
        requiredDecisionFields.every((field) => text(row.ownerDecision?.[field])),
      ).length,
    },
    decisionRows,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);

  if (markdownPath) {
    await mkdir(path.dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, createMarkdown(output, rel(registerPath)));
  }
}

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  checked: [
    "owner decision register CSV is parsed",
    "CSV keys match the generated decision register exactly",
    "read-only decision register fields must match the generated JSON",
    "decisionOwner, dueDate, and evidenceOwner must be non-placeholder and secret-free",
    "dueDate must use YYYY-MM-DD, optional evidenceUrl/signoff must be HTTPS/storage references, optional checkedAt must be ISO",
    "completed decision register JSON is written separately from the generated register",
  ],
  artifacts: {
    csv: { path: rel(csvPath), sha256: csvRead.sha256, sizeBytes: csvRead.sizeBytes },
    json: { path: rel(registerPath), sha256: jsonRead.sha256, sizeBytes: jsonRead.sizeBytes },
    out: { path: rel(outPath), written: Boolean(output) },
    markdown: markdownPath ? { path: rel(markdownPath), written: Boolean(output) } : null,
  },
  summary: {
    csvRows: csvRows.length,
    decisionRows: Array.isArray(jsonRead.json?.decisionRows) ? jsonRead.json.decisionRows.length : 0,
    appliedRows: output?.decisionRows.length ?? 0,
    completedDecisionRows: output?.summary.completedDecisionRows ?? 0,
  },
  nextActions:
    blockers.length === 0
      ? [
          "Share the completed decision register with the owner and external evidence owners.",
          "Collect actual handoff evidence, then run the verification command for each row.",
          "Do not mark P1 ready until each underlying handoff report and P1 readiness are strict-ready.",
        ]
      : [
          "Fill every decisionOwner, dueDate, and evidenceOwner cell in the decision register CSV.",
          "Use YYYY-MM-DD for dueDate.",
          "Do not edit generated read-only columns such as status, ownerLane, decisionNeeded, verificationCommand, or nextAction.",
          `Rerun \`npm run owner:decision-register:apply-csv -- --csv=${rel(csvPath)} --json=${rel(registerPath)} --out=${rel(outPath)}${markdownPath ? ` --markdown=${rel(markdownPath)}` : ""}\`.`,
        ],
  blockers,
};

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
