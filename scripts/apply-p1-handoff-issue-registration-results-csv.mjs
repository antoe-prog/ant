import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const issueDraftsPath = path.resolve(args.issueDrafts ?? ".data/p1-handoff-issue-drafts/issue-drafts.json");
const csvPath = path.resolve(args.csv ?? ".data/p1-handoff-issue-drafts/github-issue-create-results.csv");
const outPath = path.resolve(args.out ?? ".data/p1-handoff-issue-registration-receipt.json");
const markdownPath = path.resolve(
  args.markdown ?? path.join(path.dirname(outPath), "p1-handoff-issue-registration-receipt.md"),
);

const requiredHeaders = [
  "packageDir",
  "title",
  "issueDraftPath",
  "system",
  "postedBy",
  "postedAt",
  "url",
  "id",
  "assignee",
  "evidence",
  "acknowledgementStatus",
  "acknowledgedAt",
  "acknowledgementEvidence",
];
const editableFields = [
  "system",
  "postedBy",
  "postedAt",
  "url",
  "id",
  "assignee",
  "evidence",
  "acknowledgementStatus",
  "acknowledgedAt",
  "acknowledgementEvidence",
];

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

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
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

function hasSecretLikeSource(source) {
  return secretHits(source).length > 0 || /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source);
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
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_PARSE_ERROR", "Issue registration results CSV must be parseable.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (parsedRows.length < 2) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_EMPTY", "Issue registration results CSV must include a header and issue rows.");
    return [];
  }

  const headers = parsedRows[0].map(text);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_HEADERS_MISSING", "Issue registration results CSV is missing required headers.", {
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

function parseJson(source, blockers, label, filePath) {
  try {
    return JSON.parse(source);
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_INVALID", `${label} must be valid JSON.`, {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function readJsonArtifact(filePath, blockers, label) {
  try {
    const buffer = await readFile(filePath);
    const source = buffer.toString("utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_SECRET_LIKE_VALUE", `${label} must not include raw secret-like values.`, {
        path: rel(filePath),
      });
    }

    return {
      buffer,
      json: parseJson(source, blockers, label, filePath),
      path: rel(filePath),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_MANIFEST_UNREADABLE", `${label} must be readable before CSV can be applied.`, {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { buffer: Buffer.from(""), json: null, path: rel(filePath), sha256: null, sizeBytes: 0 };
  }
}

async function readCsvArtifact(filePath, blockers) {
  try {
    const buffer = await readFile(filePath);
    const source = buffer.toString("utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_SECRET_VALUE", "Issue registration results CSV must not contain raw secret-like values.", {
        path: rel(filePath),
      });
    }

    return {
      source,
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_UNREADABLE", "Issue registration results CSV must be readable.", {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { source: "", sha256: null, sizeBytes: 0 };
  }
}

async function readMarkdownArtifact(filePath, blockers) {
  try {
    const buffer = await readFile(filePath);
    const source = buffer.toString("utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_SECRET_LIKE_VALUE", "Issue draft Markdown must not include raw secret-like values.", {
        path: rel(filePath),
      });
    }

    return {
      buffer,
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_DRAFT_UNREADABLE", "Issue draft Markdown must be readable before CSV can be applied.", {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function validateTimestamp(row, field, blockers) {
  const value = text(row[field]);

  if (hasPlaceholder(value)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_TIMESTAMP_INVALID", "Issue registration CSV timestamps must be real ISO timestamps.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
    });
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_TIMESTAMP_INVALID", "Issue registration CSV timestamps must use ISO date-time format.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
      value,
    });
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_TIMESTAMP_INVALID", "Issue registration CSV timestamps must be parseable ISO timestamps.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
      value,
    });
    return null;
  }

  return parsed;
}

function validateHttpsUrl(row, field, blockers) {
  const value = text(row[field]);

  if (hasPlaceholder(value)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_URL_INVALID", "Issue registration CSV URL must be a real HTTPS permalink.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
    });
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_URL_INVALID", "Issue registration CSV URL must use HTTPS.", {
        packageDir: row.packageDir,
        rowNumber: row.rowNumber,
        field,
        value,
      });
    }
  } catch {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_URL_INVALID", "Issue registration CSV URL must be parseable.", {
      packageDir: row.packageDir,
      rowNumber: row.rowNumber,
      field,
      value,
    });
  }
}

function validateCsvRows(csvRows, issueDrafts, blockers) {
  const issueDraftRows = Array.isArray(issueDrafts.issueDrafts) ? issueDrafts.issueDrafts : [];

  if (issueDrafts.releaseDecision !== "ready") {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_DRAFTS_NOT_READY", "Issue registration results CSV requires ready issue drafts.", {
      releaseDecision: issueDrafts.releaseDecision ?? null,
    });
  }

  const expectedByPackage = new Map(issueDraftRows.map((issueDraft) => [issueDraft.packageDir, issueDraft]));
  const seenDirs = new Set();
  const rowsByPackageDir = new Map();

  for (const row of csvRows) {
    const packageDir = text(row.packageDir);
    const issueDraft = expectedByPackage.get(packageDir);

    if (!issueDraft) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_ROW_UNKNOWN", "Issue registration CSV contains an unknown packageDir.", {
        rowNumber: row.rowNumber,
        packageDir,
      });
      continue;
    }

    if (seenDirs.has(packageDir)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_ROW_DUPLICATE", "Issue registration CSV contains a duplicate packageDir.", {
        rowNumber: row.rowNumber,
        packageDir,
      });
      continue;
    }

    seenDirs.add(packageDir);
    rowsByPackageDir.set(packageDir, row);

    for (const [field, expected] of Object.entries({ title: issueDraft.title, issueDraftPath: issueDraft.path })) {
      if (text(row[field]) !== text(expected)) {
        addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_READONLY_MISMATCH", "Issue registration CSV can only edit external result fields.", {
          packageDir,
          rowNumber: row.rowNumber,
          field,
          csvValue: row[field] ?? null,
          expected,
        });
      }
    }

    for (const field of editableFields) {
      if (hasPlaceholder(row[field])) {
        addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_FIELD_PLACEHOLDER", "Issue registration CSV must replace every TODO external result field before applying.", {
          packageDir,
          rowNumber: row.rowNumber,
          field,
        });
      }

      for (const hit of secretHits(row[field])) {
        addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_SECRET_VALUE", "Issue registration CSV must not contain raw secret-like values.", {
          packageDir,
          rowNumber: row.rowNumber,
          field,
          type: hit,
        });
      }
    }

    if (text(row.acknowledgementStatus) !== "acknowledged") {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_ACK_STATUS_INVALID", "Issue registration CSV acknowledgementStatus must be acknowledged before applying.", {
        packageDir,
        rowNumber: row.rowNumber,
        status: row.acknowledgementStatus,
      });
    }

    validateHttpsUrl(row, "url", blockers);
    validateHttpsUrl(row, "evidence", blockers);
    validateHttpsUrl(row, "acknowledgementEvidence", blockers);

    const postedAt = validateTimestamp(row, "postedAt", blockers);
    const acknowledgedAt = validateTimestamp(row, "acknowledgedAt", blockers);

    if (postedAt !== null && acknowledgedAt !== null && acknowledgedAt < postedAt) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_ACK_BEFORE_POST", "Issue registration CSV acknowledgedAt must be after postedAt.", {
        packageDir,
        rowNumber: row.rowNumber,
      });
    }
  }

  for (const expectedPackageDir of expectedByPackage.keys()) {
    if (!seenDirs.has(expectedPackageDir)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_CSV_ROW_MISSING", "Issue registration CSV is missing a required packageDir.", {
        packageDir: expectedPackageDir,
      });
    }
  }

  return rowsByPackageDir;
}

function createMarkdown(receipt) {
  const lines = [
    "# P1 Handoff Issue Registration Receipt",
    "",
    `- Issue draft manifest: \`${receipt.issueDraftManifest.path}\``,
    `- Issue draft manifest SHA-256: \`${receipt.issueDraftManifest.sha256}\``,
    `- Issue draft decision: \`${receipt.issueDraftManifest.releaseDecision}\``,
    `- Results source: \`${receipt.results.path}\``,
    `- Results source type: \`${receipt.results.source}\``,
    `- Receipt decision: \`${receipt.releaseDecision}\``,
    "",
    "## Registrations",
    "",
    "| Issue draft | Owner role | External URL | Assignee | Ack status |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const registration of receipt.registrations) {
    lines.push(
      `| \`${registration.issueDraft.path}\` | ${registration.ownerRole} | ${registration.external.url} | ${registration.external.assignee} | ${registration.acknowledgement.status} |`,
    );
  }

  lines.push(
    "",
    "## Strict Validation",
    "",
    `최종 P1 readiness 전에 \`npm run p1:handoff-issue-receipt -- --file=${receipt.outputPaths.receipt} --issue-drafts=${receipt.issueDraftManifest.path} --out=${receipt.outputPaths.report}\`를 실행합니다.`,
    "",
  );

  return `${lines.join("\n")}\n`;
}

const blockers = [];
const issueDraftsArtifact = await readJsonArtifact(issueDraftsPath, blockers, "P1 handoff issue draft manifest");
const csvArtifact = await readCsvArtifact(csvPath, blockers);
const csvRows = rowsFromCsv(csvArtifact.source, blockers);
const rowsByPackageDir = validateCsvRows(csvRows, issueDraftsArtifact.json ?? {}, blockers);

let receipt = null;
if (blockers.length === 0 && issueDraftsArtifact.json) {
  const registrations = [];

  for (const issueDraft of issueDraftsArtifact.json.issueDrafts ?? []) {
    const row = rowsByPackageDir.get(issueDraft.packageDir);
    const draftPath = path.resolve(issueDraft.path);
    const draftArtifact = await readMarkdownArtifact(draftPath, blockers);

    if (!row || !draftArtifact) {
      continue;
    }

    registrations.push({
      ownerRole: issueDraft.ownerRole,
      packageDir: issueDraft.packageDir,
      title: issueDraft.title,
      issueDraft: {
        path: rel(draftPath),
        bodySha256: draftArtifact.sha256,
        sizeBytes: draftArtifact.sizeBytes,
        labels: issueDraft.labels ?? [],
        strictCommands: issueDraft.strictCommands ?? [],
        totalActions: issueDraft.totalActions ?? 0,
      },
      external: {
        system: text(row.system),
        url: text(row.url),
        id: text(row.id),
        postedAt: text(row.postedAt),
        postedBy: text(row.postedBy),
        assignee: text(row.assignee),
        labels: issueDraft.labels ?? [],
        bodySha256: draftArtifact.sha256,
        evidence: text(row.evidence),
      },
      acknowledgement: {
        status: text(row.acknowledgementStatus),
        acknowledgedAt: text(row.acknowledgedAt),
        evidence: text(row.acknowledgementEvidence),
      },
    });
  }

  if (blockers.length === 0) {
    const generatedAt = new Date().toISOString();

    receipt = {
      schemaVersion: 1,
      generatedAt,
      releaseDecision: "ready",
      issueDraftManifest: {
        path: rel(issueDraftsPath),
        sha256: issueDraftsArtifact.sha256,
        sizeBytes: issueDraftsArtifact.sizeBytes,
        releaseDecision: issueDraftsArtifact.json.releaseDecision ?? null,
        generatedAt: issueDraftsArtifact.json.generatedAt ?? null,
        index: issueDraftsArtifact.json.index ?? null,
      },
      results: {
        path: rel(csvPath),
        source: "csv",
        sha256: csvArtifact.sha256,
        sizeBytes: csvArtifact.sizeBytes,
        releaseDecision: "ready",
      },
      appliedResultsCsv: {
        path: rel(csvPath),
        sha256: csvArtifact.sha256,
        sizeBytes: csvArtifact.sizeBytes,
        appliedAt: generatedAt,
      },
      outputPaths: {
        receipt: rel(outPath),
        markdown: rel(markdownPath),
        report: rel(path.join(path.dirname(outPath), "p1-handoff-issue-registration-report.json")),
      },
      registrations,
      summary: {
        issueDrafts: registrations.length,
        registered: registrations.length,
        acknowledged: registrations.filter((registration) => registration.acknowledgement.status === "acknowledged").length,
        totalActions: registrations.reduce((sum, registration) => sum + (Number(registration.issueDraft?.totalActions) || 0), 0),
      },
      checked: [
        "issue draft manifest path and hashes are captured",
        "GitHub issue creation results CSV rows match issue drafts exactly",
        "issue body SHA-256 values are recalculated from local Markdown drafts",
        "raw secret-like values are not written to the issue registration receipt",
      ],
      nextActions: [
        `최종 P1 readiness 전에 \`npm run p1:handoff-issue-receipt -- --file=${rel(outPath)} --issue-drafts=${rel(issueDraftsPath)} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-issue-registration-report.json"))}\`를 실행합니다.`,
      ],
    };

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await mkdir(path.dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, createMarkdown(receipt));
  }
}

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  checked: [
    "issue registration results CSV is parsed",
    "CSV packageDir rows match the issue draft manifest exactly",
    "title and issueDraftPath remain read-only",
    "external URL, assignee, posting evidence, and acknowledgement evidence are filled",
    "postedAt and acknowledgedAt must use ISO date-time values",
    "completed issue registration receipt is written separately from the CSV template",
  ],
  artifacts: {
    csv: { path: rel(csvPath), sha256: csvArtifact.sha256, sizeBytes: csvArtifact.sizeBytes },
    issueDrafts: { path: rel(issueDraftsPath), sha256: issueDraftsArtifact.sha256, sizeBytes: issueDraftsArtifact.sizeBytes },
    out: { path: rel(outPath), written: Boolean(receipt) },
    markdown: { path: rel(markdownPath), written: Boolean(receipt) },
  },
  summary: {
    csvRows: csvRows.length,
    issueDrafts: Array.isArray(issueDraftsArtifact.json?.issueDrafts) ? issueDraftsArtifact.json.issueDrafts.length : 0,
    registered: receipt?.summary.registered ?? 0,
    acknowledged: receipt?.summary.acknowledged ?? 0,
  },
  nextActions:
    blockers.length === 0
      ? [
          `\`npm run p1:handoff-issue-receipt -- --file=${rel(outPath)} --issue-drafts=${rel(issueDraftsPath)} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-issue-registration-report.json"))}\`를 실행합니다.`,
        ]
      : [
          "CSV blocker를 수정한 뒤 이 apply 명령을 다시 실행하고 strict 이슈 등록 receipt 검증기를 실행합니다.",
          "URL 필드는 HTTPS permalink를 사용하고 postedAt/acknowledgedAt은 ISO date-time 값을 사용합니다.",
        ],
  blockers,
};

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
