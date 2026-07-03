import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const receiptPath = path.resolve(args.receipt ?? args.file ?? ".data/p1-handoff-dispatch-receipt.json");
const csvPath = path.resolve(args.csv ?? ".data/p1-handoff-dispatch-receipt.csv");
const outPath = path.resolve(args.out ?? ".data/p1-handoff-dispatch-receipt.completed.json");
const markdownPath = args.markdown ? path.resolve(args.markdown) : null;

const requiredHeaders = [
  "packageDir",
  "ownerRole",
  "assignedToName",
  "assignedToContact",
  "channel",
  "assignedAt",
  "dueAt",
  "assignmentEvidence",
  "acknowledgementStatus",
  "acknowledgedAt",
  "acknowledgementEvidence",
];
const editableFields = [
  "assignedToName",
  "assignedToContact",
  "channel",
  "assignedAt",
  "dueAt",
  "assignmentEvidence",
  "acknowledgementStatus",
  "acknowledgedAt",
  "acknowledgementEvidence",
];
const readOnlyFields = ["ownerRole", "totalActions", "packageManifestSha256", "packageManifestSizeBytes"];

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
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_PARSE_ERROR", "Dispatch CSV must be parseable.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (parsedRows.length < 2) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_EMPTY", "Dispatch CSV must include a header and owner package rows.");
    return [];
  }

  const headers = parsedRows[0].map(text);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_HEADERS_MISSING", "Dispatch CSV is missing required headers.", {
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

function validateTimestamp(row, field, blockers) {
  const value = text(row[field]);

  if (hasPlaceholder(value)) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_TIMESTAMP_INVALID", "Dispatch CSV timestamps must be real ISO timestamps.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
    });
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_TIMESTAMP_INVALID", "Dispatch CSV timestamps must use ISO date-time format.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
      value,
    });
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_TIMESTAMP_INVALID", "Dispatch CSV timestamps must be parseable ISO timestamps.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
      value,
    });
    return null;
  }

  return parsed;
}

function validateEvidenceReference(row, field, blockers) {
  const value = text(row[field]);

  if (!hasPlaceholder(value) && !evidenceReference(value)) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_EVIDENCE_INVALID", "Dispatch CSV evidence fields must be URLs or storage paths.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
      value,
    });
  }
}

function validateCsvRows(csvRows, receipt, blockers) {
  if (!Array.isArray(receipt.ownerPackages)) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_JSON_OWNER_PACKAGES_MISSING", "Dispatch receipt must include ownerPackages before CSV can be applied.");
    return new Map();
  }

  const expectedDirs = new Set(receipt.ownerPackages.map((ownerPackage) => ownerPackage.packageDir));
  const seenDirs = new Set();
  const rowsByPackageDir = new Map();

  for (const row of csvRows) {
    const packageDir = text(row.packageDir);

    if (!expectedDirs.has(packageDir)) {
      addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_ROW_UNKNOWN", "Dispatch CSV contains an unknown packageDir.", {
        rowNumber: row.rowNumber,
        packageDir,
      });
      continue;
    }

    if (seenDirs.has(packageDir)) {
      addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_ROW_DUPLICATE", "Dispatch CSV contains a duplicate packageDir.", {
        rowNumber: row.rowNumber,
        packageDir,
      });
      continue;
    }

    seenDirs.add(packageDir);
    rowsByPackageDir.set(packageDir, row);
  }

  for (const expectedDir of expectedDirs) {
    if (!seenDirs.has(expectedDir)) {
      addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_ROW_MISSING", "Dispatch CSV is missing a required packageDir.", {
        packageDir: expectedDir,
      });
    }
  }

  for (const ownerPackage of receipt.ownerPackages) {
    const row = rowsByPackageDir.get(ownerPackage.packageDir);
    if (!row) {
      continue;
    }

    for (const field of readOnlyFields) {
      if (field in row && text(row[field]) && text(row[field]) !== text(ownerPackage[field])) {
        addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_READONLY_MISMATCH", "Dispatch CSV can only edit assignment and acknowledgement fields.", {
          packageDir: ownerPackage.packageDir,
          rowNumber: row.rowNumber,
          field,
          csvValue: row[field],
          receiptValue: ownerPackage[field] ?? null,
        });
      }
    }

    for (const field of editableFields) {
      if (hasPlaceholder(row[field])) {
        addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_FIELD_PLACEHOLDER", "Dispatch CSV must replace every assignment and acknowledgement TODO field before applying.", {
          packageDir: ownerPackage.packageDir,
          rowNumber: row.rowNumber,
          field,
        });
      }

      for (const hit of secretHits(row[field])) {
        addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_SECRET_VALUE", "Dispatch CSV must not contain raw secret-like values.", {
          packageDir: ownerPackage.packageDir,
          rowNumber: row.rowNumber,
          field,
          type: hit,
        });
      }
    }

    if (text(row.acknowledgementStatus) !== "acknowledged") {
      addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_ACK_STATUS_INVALID", "Dispatch CSV acknowledgementStatus must be acknowledged before applying.", {
        packageDir: ownerPackage.packageDir,
        rowNumber: row.rowNumber,
        status: row.acknowledgementStatus,
      });
    }

    const assignedAt = validateTimestamp(row, "assignedAt", blockers);
    const dueAt = validateTimestamp(row, "dueAt", blockers);
    const acknowledgedAt = validateTimestamp(row, "acknowledgedAt", blockers);
    validateEvidenceReference(row, "assignmentEvidence", blockers);
    validateEvidenceReference(row, "acknowledgementEvidence", blockers);

    if (assignedAt !== null && dueAt !== null && dueAt < assignedAt) {
      addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_DUE_BEFORE_ASSIGNMENT", "Dispatch CSV dueAt must be after assignedAt.", {
        packageDir: ownerPackage.packageDir,
        rowNumber: row.rowNumber,
      });
    }

    if (assignedAt !== null && acknowledgedAt !== null && acknowledgedAt < assignedAt) {
      addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_ACK_BEFORE_ASSIGNMENT", "Dispatch CSV acknowledgedAt must be after assignedAt.", {
        packageDir: ownerPackage.packageDir,
        rowNumber: row.rowNumber,
      });
    }
  }

  return rowsByPackageDir;
}

async function readJsonArtifact(filePath, blockers) {
  try {
    const buffer = await readFile(filePath);
    return {
      json: JSON.parse(buffer.toString("utf8")),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_JSON_UNREADABLE", "Dispatch receipt JSON must be readable before CSV can be applied.", {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { json: null, sha256: null, sizeBytes: 0 };
  }
}

async function readCsvArtifact(filePath, blockers) {
  try {
    const buffer = await readFile(filePath);
    return {
      source: buffer.toString("utf8"),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_CSV_UNREADABLE", "Dispatch CSV must be readable.", {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { source: "", sha256: null, sizeBytes: 0 };
  }
}

function packageName(packageDir) {
  return path.basename(packageDir);
}

function createMarkdown(receipt, sourceReceiptPath) {
  const lines = [
    "# P1 Handoff Dispatch Receipt",
    "",
    `- Source receipt: \`${sourceReceiptPath}\``,
    `- Bundle manifest: \`${receipt.bundleManifest.path}\``,
    `- Dispatch decision: \`${receipt.releaseDecision}\``,
    `- Applied CSV: \`${receipt.appliedDispatchCsv.path}\``,
    "",
    "## Owner Packages",
    "",
    "| Package | Owner role | Actions | Assigned to | Channel | Due at | Ack status |",
    "| --- | --- | ---: | --- | --- | --- | --- |",
  ];

  for (const ownerPackage of receipt.ownerPackages) {
    lines.push(
      `| \`${packageName(ownerPackage.packageDir)}\` | ${ownerPackage.ownerRole} | ${ownerPackage.totalActions} | ${ownerPackage.assignment.assignedToName} | ${ownerPackage.assignment.channel} | ${ownerPackage.assignment.dueAt} | ${ownerPackage.acknowledgement.status} |`,
    );
  }

  lines.push(
    "",
    "## Strict Validation",
    "",
    `Run \`npm run p1:handoff-dispatch -- --file=${receipt.outputPaths.receipt} --bundle=${receipt.bundleManifest.path} --out=${receipt.outputPaths.report}\` before creating owner issue drafts.`,
    "",
  );

  return `${lines.join("\n")}\n`;
}

const blockers = [];
const receiptRead = await readJsonArtifact(receiptPath, blockers);
const csvRead = await readCsvArtifact(csvPath, blockers);
const csvRows = rowsFromCsv(csvRead.source, blockers);
const rowsByPackageDir = validateCsvRows(csvRows, receiptRead.json ?? {}, blockers);

let output = null;
if (blockers.length === 0 && receiptRead.json) {
  const ownerPackages = receiptRead.json.ownerPackages.map((ownerPackage) => {
    const row = rowsByPackageDir.get(ownerPackage.packageDir);

    return {
      ...ownerPackage,
      assignment: {
        assignedToName: text(row.assignedToName),
        assignedToContact: text(row.assignedToContact),
        channel: text(row.channel),
        assignedAt: text(row.assignedAt),
        dueAt: text(row.dueAt),
        evidence: text(row.assignmentEvidence),
      },
      acknowledgement: {
        status: text(row.acknowledgementStatus),
        acknowledgedAt: text(row.acknowledgedAt),
        evidence: text(row.acknowledgementEvidence),
      },
    };
  });

  output = {
    ...receiptRead.json,
    releaseDecision: "ready",
    appliedDispatchCsv: {
      path: rel(csvPath),
      sha256: csvRead.sha256,
      sizeBytes: csvRead.sizeBytes,
      appliedAt: new Date().toISOString(),
    },
    outputPaths: {
      ...(receiptRead.json.outputPaths ?? {}),
      receipt: rel(outPath),
      markdown: markdownPath ? rel(markdownPath) : receiptRead.json.outputPaths?.markdown,
      report: rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-report.json")),
    },
    ownerPackages,
    summary: {
      ownerPackages: ownerPackages.length,
      totalActions: ownerPackages.reduce((sum, ownerPackage) => sum + (Number(ownerPackage.totalActions) || 0), 0),
      acknowledged: ownerPackages.filter((ownerPackage) => ownerPackage.acknowledgement.status === "acknowledged").length,
    },
    checked: [
      ...(Array.isArray(receiptRead.json.checked) ? receiptRead.json.checked : []),
      "operator CSV dispatch fields are applied to a completed dispatch receipt",
    ],
    nextActions: [
      `Run \`npm run p1:handoff-dispatch -- --file=${rel(outPath)} --bundle=${receiptRead.json.bundleManifest?.path ?? ".data/p1-handoff-bundle-manifest.json"} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-report.json"))}\` to validate the completed dispatch receipt.`,
      "Only create GitHub/Slack owner issue drafts after the strict dispatch report is ready.",
    ],
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);

  if (markdownPath) {
    await mkdir(path.dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, createMarkdown(output, rel(receiptPath)));
  }
}

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  checked: [
    "dispatch CSV is parsed",
    "CSV packageDir rows match the dispatch receipt owner packages exactly",
    "only assignment and acknowledgement fields are applied",
    "operator CSV fields must be non-placeholder, acknowledged, timestamp-valid, and secret-free",
    "assignment and acknowledgement evidence must be URLs or storage paths",
    "completed dispatch receipt is written separately from the draft",
  ],
  artifacts: {
    csv: { path: rel(csvPath), sha256: csvRead.sha256, sizeBytes: csvRead.sizeBytes },
    receipt: { path: rel(receiptPath), sha256: receiptRead.sha256, sizeBytes: receiptRead.sizeBytes },
    out: { path: rel(outPath), written: Boolean(output) },
    markdown: markdownPath ? { path: rel(markdownPath), written: Boolean(output) } : null,
  },
  summary: {
    csvRows: csvRows.length,
    ownerPackages: Array.isArray(receiptRead.json?.ownerPackages) ? receiptRead.json.ownerPackages.length : 0,
    appliedRows: output?.ownerPackages.length ?? 0,
    acknowledged: output?.summary.acknowledged ?? 0,
  },
  nextActions:
    blockers.length === 0
      ? [
          `Run \`npm run p1:handoff-dispatch -- --file=${rel(outPath)} --bundle=${receiptRead.json?.bundleManifest?.path ?? ".data/p1-handoff-bundle-manifest.json"} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-report.json"))}\`.`,
        ]
      : [
          "CSV blocker를 수정한 뒤 이 apply 명령을 다시 실행하고 strict dispatch receipt 검증기를 실행합니다.",
          "Use ISO date-time values for assignedAt/dueAt/acknowledgedAt and URL/storage paths for assignmentEvidence/acknowledgementEvidence.",
        ],
  blockers,
};

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
