import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const jsonPath = path.resolve(args.json ?? path.join(workspace, "p1-completion-evidence.json"));
const csvPath = path.resolve(args.csv ?? path.join(workspace, "p1-completion-evidence.csv"));
const outPath = path.resolve(args.out ?? path.join(workspace, "p1-completion-evidence.completed.json"));
const markdownPath = args.markdown ? path.resolve(args.markdown) : null;

const requiredHeaders = [
  "criterionKey",
  "criterionLabel",
  "status",
  "statusLabel",
  "message",
  "externalBlockers",
  "supportArtifacts",
  "evidenceCommands",
  "evidenceFiles",
  "releaseCustodyReady",
  "nextAction",
  "evidenceOwner",
  "evidenceUrl",
  "checkedAt",
  "signoff",
  "notes",
];
const readOnlyFields = [
  "criterionLabel",
  "status",
  "statusLabel",
  "message",
  "externalBlockers",
  "supportArtifacts",
  "evidenceCommands",
  "evidenceFiles",
  "releaseCustodyReady",
  "nextAction",
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
    addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_PARSE_ERROR", "Completion evidence CSV must be parseable.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (parsedRows.length < 2) {
    addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_EMPTY", "Completion evidence CSV must include a header and criterion rows.");
    return [];
  }

  const headers = parsedRows[0].map(text);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_HEADERS_MISSING", "Completion evidence CSV is missing required headers.", {
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

function expectedCsvRow(report, criterion) {
  const externalBlockers = Array.isArray(criterion.externalBlockers) ? criterion.externalBlockers : [];
  const supportArtifacts = Array.isArray(criterion.supportArtifacts) ? criterion.supportArtifacts : [];
  const evidenceCommands = Array.isArray(criterion.evidenceCommands) ? criterion.evidenceCommands : [];
  const evidenceFiles = Array.isArray(criterion.evidenceFiles) ? criterion.evidenceFiles : [];

  return {
    criterionKey: text(criterion.key),
    criterionLabel: text(criterion.label),
    status: text(criterion.status),
    statusLabel: text(criterion.statusLabel),
    message: text(criterion.message),
    externalBlockers: externalBlockers.map((blocker) => `${text(blocker?.key)}:${text(blocker?.status)}`).join(" | "),
    supportArtifacts: supportArtifacts.map((artifact) => `${text(artifact?.key)}:${text(artifact?.status)}`).join(" | "),
    evidenceCommands: evidenceCommands.map(text).join(" | "),
    evidenceFiles: evidenceFiles.map(text).join(" | "),
    releaseCustodyReady: report.releaseCustody?.ready === true ? "yes" : "no",
    nextAction: text(criterion.nextAction),
  };
}

function validateCsvRows(csvRows, report, blockers) {
  if (!Array.isArray(report.criteria)) {
    addBlocker(blockers, "P1_COMPLETION_EVIDENCE_JSON_CRITERIA_MISSING", "Completion evidence JSON must include criteria before CSV can be applied.");
    return new Map();
  }

  const expectedKeys = new Set(report.criteria.map((criterion) => text(criterion.key)));
  const seenKeys = new Set();
  const byKey = new Map();

  for (const row of csvRows) {
    const key = text(row.criterionKey);

    if (!expectedKeys.has(key)) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_ROW_UNKNOWN", "Completion evidence CSV contains an unknown criterionKey.", {
        rowNumber: row.rowNumber,
        criterionKey: key,
      });
      continue;
    }

    if (seenKeys.has(key)) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_ROW_DUPLICATE", "Completion evidence CSV contains a duplicate criterionKey.", {
        rowNumber: row.rowNumber,
        criterionKey: key,
      });
      continue;
    }

    seenKeys.add(key);
    byKey.set(key, row);
  }

  for (const expectedKey of expectedKeys) {
    if (!seenKeys.has(expectedKey)) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_ROW_MISSING", "Completion evidence CSV is missing a required criterionKey.", {
        criterionKey: expectedKey,
      });
    }
  }

  for (const criterion of report.criteria) {
    const expectedRow = expectedCsvRow(report, criterion);
    const csvRow = byKey.get(expectedRow.criterionKey);
    if (!csvRow) {
      continue;
    }

    for (const field of readOnlyFields) {
      if (field in csvRow && text(csvRow[field]) !== expectedRow[field]) {
        addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_READONLY_MISMATCH", "Completion evidence CSV can only edit operator evidence fields.", {
          criterionKey: expectedRow.criterionKey,
          rowNumber: csvRow.rowNumber,
          field,
          csvValue: csvRow[field],
          expectedValue: expectedRow[field],
        });
      }
    }

    for (const field of operatorFields) {
      if (hasPlaceholder(csvRow[field])) {
        addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_FIELD_PLACEHOLDER", "Completion evidence CSV must replace every operator evidence field before applying.", {
          criterionKey: expectedRow.criterionKey,
          rowNumber: csvRow.rowNumber,
          field,
        });
      }

      for (const hit of secretHits(csvRow[field])) {
        addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_SECRET_VALUE", "Completion evidence CSV must not contain raw secret-like values.", {
          criterionKey: expectedRow.criterionKey,
          rowNumber: csvRow.rowNumber,
          field,
          type: hit,
        });
      }
    }

    for (const hit of secretHits(csvRow.notes)) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_SECRET_VALUE", "Completion evidence CSV notes must not contain raw secret-like values.", {
        criterionKey: expectedRow.criterionKey,
        rowNumber: csvRow.rowNumber,
        field: "notes",
        type: hit,
      });
    }

    if (text(csvRow.notes) && hasPlaceholder(csvRow.notes)) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_FIELD_PLACEHOLDER", "Completion evidence CSV notes must not contain placeholder text.", {
        criterionKey: expectedRow.criterionKey,
        rowNumber: csvRow.rowNumber,
        field: "notes",
      });
    }

    if (!hasPlaceholder(csvRow.evidenceUrl) && !evidenceReference(csvRow.evidenceUrl)) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_EVIDENCE_INVALID", "Completion evidence CSV evidenceUrl must be an HTTPS URL or storage URI.", {
        criterionKey: expectedRow.criterionKey,
        rowNumber: csvRow.rowNumber,
        evidenceUrl: csvRow.evidenceUrl,
      });
    }

    if (!hasPlaceholder(csvRow.signoff) && !evidenceReference(csvRow.signoff)) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_SIGNOFF_INVALID", "Completion evidence CSV signoff must be an HTTPS URL or storage URI.", {
        criterionKey: expectedRow.criterionKey,
        rowNumber: csvRow.rowNumber,
        signoff: csvRow.signoff,
      });
    }

    if (!hasPlaceholder(csvRow.checkedAt) && !parseDateTime(csvRow.checkedAt)) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_CHECKED_AT_INVALID", "Completion evidence CSV checkedAt must be an ISO timestamp.", {
        criterionKey: expectedRow.criterionKey,
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
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_JSON_SECRET_VALUE", "Completion evidence JSON must not contain raw secret-like values.", {
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
    addBlocker(blockers, "P1_COMPLETION_EVIDENCE_JSON_UNREADABLE", "Completion evidence JSON must be readable before CSV can be applied.", {
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
    const hits = secretHits(source);

    for (const hit of hits) {
      addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_SECRET_VALUE", "Completion evidence CSV must not contain raw secret-like values.", {
        type: hit,
      });
    }

    return {
      source,
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_COMPLETION_EVIDENCE_CSV_UNREADABLE", "Completion evidence CSV must be readable.", {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { source: "", sha256: null, sizeBytes: 0 };
  }
}

function createMarkdown(report, sourceJsonPath) {
  const lines = [
    "# P1 Completion Evidence Applied",
    "",
    `- Source matrix: \`${sourceJsonPath}\``,
    `- Applied CSV: \`${report.appliedCompletionEvidenceCsv.path}\``,
    `- P1 completion decision remains: \`${report.releaseDecision}\``,
    `- Operator evidence rows: ${report.summary.completedEvidenceRows}/${report.summary.totalCriteria}`,
    "",
    "## Criteria",
    "",
    "| Criterion | Status | Evidence owner | Evidence URL | Checked at | Signoff |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const criterion of report.criteria) {
    lines.push(
      `| ${criterion.label} | ${criterion.status} | ${criterion.operatorEvidence.evidenceOwner} | ${criterion.operatorEvidence.evidenceUrl} | ${criterion.operatorEvidence.checkedAt} | ${criterion.operatorEvidence.signoff} |`,
    );
  }

  lines.push(
    "",
    "## Next Action",
    "",
    "- Keep this completed JSON/Markdown with the P1 release package, then update the underlying operator status when external blockers are actually resolved.",
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
  const criteria = jsonRead.json.criteria.map((criterion) => {
    const row = rowsByKey.get(text(criterion.key));

    return {
      ...criterion,
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
    operatorEvidenceReady: true,
    appliedCompletionEvidenceCsv: {
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
      "operator completion evidence CSV fields are applied to a completed evidence record",
    ],
    summary: {
      ...(jsonRead.json.summary ?? {}),
      totalCriteria: criteria.length,
      operatorEvidenceRows: criteria.length,
      completedEvidenceRows: criteria.filter((criterion) => operatorFields.every((field) => text(criterion.operatorEvidence?.[field]))).length,
    },
    criteria,
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
    "completion evidence CSV is parsed",
    "CSV criterionKey rows match the JSON completion criteria exactly",
    "read-only completion matrix fields must match the generated JSON",
    "operator evidence fields must be non-placeholder and secret-free",
    "evidenceUrl/signoff must be HTTPS URLs or storage URIs and checkedAt must be ISO",
    "completed completion evidence JSON is written separately from the generated matrix",
  ],
  artifacts: {
    csv: { path: rel(csvPath), sha256: csvRead.sha256, sizeBytes: csvRead.sizeBytes },
    json: { path: rel(jsonPath), sha256: jsonRead.sha256, sizeBytes: jsonRead.sizeBytes },
    out: { path: rel(outPath), written: Boolean(output) },
    markdown: markdownPath ? { path: rel(markdownPath), written: Boolean(output) } : null,
  },
  summary: {
    csvRows: csvRows.length,
    criteria: Array.isArray(jsonRead.json?.criteria) ? jsonRead.json.criteria.length : 0,
    appliedRows: output?.criteria.length ?? 0,
    completedEvidenceRows: output?.summary.completedEvidenceRows ?? 0,
  },
  nextActions:
    blockers.length === 0
      ? [
          "Attach the completed completion evidence JSON/Markdown to the P1 release package.",
          "Do not mark P1 ready until the underlying operator status and external blockers are also ready.",
        ]
      : [
          "Fill every evidenceOwner, evidenceUrl, checkedAt, and signoff cell in the completion evidence CSV.",
          "Use HTTPS URLs or storage URIs for evidenceUrl/signoff and ISO timestamps for checkedAt.",
          "Do not edit generated read-only columns such as status, evidenceCommands, supportArtifacts, or nextAction.",
          `Rerun \`npm run p1:completion-evidence:apply-csv -- --csv=${rel(csvPath)} --json=${rel(jsonPath)} --out=${rel(outPath)}${markdownPath ? ` --markdown=${rel(markdownPath)}` : ""}\`.`,
        ],
  blockers,
};

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
