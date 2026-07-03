import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = args.workspace ? path.resolve(args.workspace) : null;
const jsonPath = path.resolve(args.json ?? (workspace ? path.join(workspace, "p1-evidence-intake-draft.json") : ".data/p1-evidence-intake-draft.json"));
const csvPath = path.resolve(args.csv ?? (workspace ? path.join(workspace, "p1-evidence-intake-draft.csv") : ".data/p1-evidence-intake-draft.csv"));
const outPath = path.resolve(args.out ?? (workspace ? path.join(workspace, "p1-evidence-intake.completed.json") : ".data/p1-evidence-intake.completed.json"));

const intakeFields = ["evidenceOwner", "evidenceUrl", "checkedAt", "signoff"];
const readOnlyFields = ["label", "lane", "status", "releaseDecision", "evidenceDraft", "sourceReport", "strictCommand"];

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    const normalizedKey = key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[normalizedKey] = value;
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

function parseDateTime(value) {
  const source = text(value);

  if (!/^\d{4}-\d{2}-\d{2}T/.test(source)) {
    return null;
  }

  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function placeholder(value) {
  const source = text(value);
  return !source || /\b(TODO|TBD|placeholder|sample|example|dummy)\b/i.test(source) || /<[^>]+>/.test(source);
}

function evidenceReference(value) {
  const source = text(value);
  return /^(https?:\/\/|s3:\/\/|gs:\/\/|file:\/\/|\/|\.data\/|\.\/)/.test(source);
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
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_PARSE_ERROR", "Evidence intake CSV must be parseable.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (parsedRows.length < 2) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_EMPTY", "Evidence intake CSV must include a header and seven rows.");
    return [];
  }

  const headers = parsedRows[0].map(text);
  const missingHeaders = ["key", ...intakeFields].filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_HEADERS_MISSING", "Evidence intake CSV is missing required headers.", {
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

function validateCsvRows(csvRows, intake, blockers) {
  if (!Array.isArray(intake.rows)) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_JSON_ROWS_MISSING", "Evidence intake JSON must include rows before CSV can be applied.");
    return new Map();
  }

  const expectedKeys = new Set(intake.rows.map((row) => row.key));
  const seenKeys = new Set();
  const byKey = new Map();

  for (const row of csvRows) {
    const key = text(row.key);

    if (!expectedKeys.has(key)) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_ROW_UNKNOWN", "Evidence intake CSV contains an unknown row key.", {
        rowNumber: row.rowNumber,
        key,
      });
      continue;
    }

    if (seenKeys.has(key)) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_ROW_DUPLICATE", "Evidence intake CSV contains a duplicate row key.", {
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
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_ROW_MISSING", "Evidence intake CSV is missing a required row key.", {
        key: expectedKey,
      });
    }
  }

  for (const jsonRow of intake.rows) {
    const csvRow = byKey.get(jsonRow.key);
    if (!csvRow) {
      continue;
    }

    for (const field of readOnlyFields) {
      if (field in csvRow && text(csvRow[field]) !== text(jsonRow[field])) {
        addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_READONLY_MISMATCH", "Evidence intake CSV can only edit operator intake fields.", {
          key: jsonRow.key,
          field,
          csvValue: csvRow[field],
          jsonValue: jsonRow[field] ?? null,
        });
      }
    }

    for (const field of intakeFields) {
      if (placeholder(csvRow[field])) {
        addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_FIELD_PLACEHOLDER", "Evidence intake CSV must replace every operator TODO field before applying.", {
          key: jsonRow.key,
          field,
        });
      }

      for (const hit of secretHits(csvRow[field])) {
        addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_SECRET_VALUE", "Evidence intake CSV must not contain raw secret-like values.", {
          key: jsonRow.key,
          field,
          type: hit,
        });
      }
    }

    if (!placeholder(csvRow.evidenceUrl) && !evidenceReference(csvRow.evidenceUrl)) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_EVIDENCE_URL_INVALID", "Evidence intake CSV evidenceUrl must be a real URL or storage path.", {
        key: jsonRow.key,
        evidenceUrl: csvRow.evidenceUrl,
      });
    }

    if (!placeholder(csvRow.checkedAt) && !parseDateTime(csvRow.checkedAt)) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_CHECKED_AT_INVALID", "Evidence intake CSV checkedAt must be an ISO timestamp.", {
        key: jsonRow.key,
        checkedAt: csvRow.checkedAt,
      });
    }

    if (!placeholder(csvRow.signoff) && !evidenceReference(csvRow.signoff)) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_SIGNOFF_INVALID", "Evidence intake CSV signoff must be a real permalink or storage path.", {
        key: jsonRow.key,
        signoff: csvRow.signoff,
      });
    }
  }

  return byKey;
}

async function readJson(filePath, blockers) {
  try {
    const buffer = await readFile(filePath);
    return {
      json: JSON.parse(buffer.toString("utf8")),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_JSON_UNREADABLE", "Evidence intake JSON must be readable before CSV can be applied.", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { json: null, sha256: null, sizeBytes: 0 };
  }
}

async function readCsv(filePath, blockers) {
  try {
    const buffer = await readFile(filePath);
    return {
      source: buffer.toString("utf8"),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_CSV_UNREADABLE", "Evidence intake CSV must be readable.", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { source: "", sha256: null, sizeBytes: 0 };
  }
}

const blockers = [];
const jsonRead = await readJson(jsonPath, blockers);
const csvRead = await readCsv(csvPath, blockers);
const csvRows = rowsFromCsv(csvRead.source, blockers);
const rowsByKey = validateCsvRows(csvRows, jsonRead.json ?? {}, blockers);

let output = null;
if (blockers.length === 0 && jsonRead.json) {
  output = {
    ...jsonRead.json,
    releaseDecision: jsonRead.json.rows?.every((row) => row.status === "ready") ? "ready" : jsonRead.json.releaseDecision,
    generatedAt: jsonRead.json.generatedAt ?? new Date().toISOString(),
    appliedIntakeCsv: {
      path: rel(csvPath),
      sha256: csvRead.sha256,
      sizeBytes: csvRead.sizeBytes,
      appliedAt: new Date().toISOString(),
    },
    outputs: {
      ...(jsonRead.json.outputs ?? {}),
      completedJson: rel(outPath),
    },
    checked: [
      ...(Array.isArray(jsonRead.json.checked) ? jsonRead.json.checked : []),
      "operator CSV intake fields are applied to a completed JSON intake submission",
    ],
    rows: jsonRead.json.rows.map((row) => {
      const csvRow = rowsByKey.get(row.key);
      return {
        ...row,
        intake: {
          evidenceOwner: text(csvRow.evidenceOwner),
          evidenceUrl: text(csvRow.evidenceUrl),
          checkedAt: text(csvRow.checkedAt),
          signoff: text(csvRow.signoff),
        },
      };
    }),
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
}

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  checked: [
    "evidence intake CSV is parsed",
    "CSV row keys match the JSON intake rows exactly",
    "only operator intake fields are applied",
    "operator intake fields must be non-placeholder and secret-free",
    "operator evidenceUrl/signoff fields must be evidence references and checkedAt must be ISO",
    "completed JSON intake submission is written separately from the draft",
  ],
  artifacts: {
    csv: { path: rel(csvPath), sha256: csvRead.sha256, sizeBytes: csvRead.sizeBytes },
    json: { path: rel(jsonPath), sha256: jsonRead.sha256, sizeBytes: jsonRead.sizeBytes },
    out: { path: rel(outPath), written: Boolean(output) },
  },
  summary: {
    csvRows: csvRows.length,
    jsonRows: Array.isArray(jsonRead.json?.rows) ? jsonRead.json.rows.length : 0,
    appliedRows: output?.rows?.length ?? 0,
  },
  nextActions:
    blockers.length === 0
      ? [
          `Run \`npm run p1:evidence-intake -- --file=${rel(outPath)} --readiness=${text(args.readiness) || ".data/p1-readiness.json"} --out=${rel(path.join(path.dirname(outPath), "p1-evidence-intake-report.json"))}\` before final release packaging.`,
        ]
      : [
          "Fill every evidenceOwner, evidenceUrl, checkedAt, and signoff cell in the evidence intake CSV.",
          "Use a URL/storage path for evidenceUrl/signoff and an ISO timestamp for checkedAt.",
          "Do not edit fixed columns such as lane, status, evidenceDraft, sourceReport, or strictCommand.",
          `Rerun \`npm run p1:evidence-intake:apply-csv -- --csv=${rel(csvPath)} --json=${rel(jsonPath)} --out=${rel(outPath)}\`.`,
        ],
  blockers,
};

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
