import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const issueDraftsPath = path.resolve(args.issueDrafts ?? ".data/p1-handoff-issue-drafts/issue-drafts.json");
const resultsPath = path.resolve(args.results ?? ".data/p1-handoff-issue-drafts/github-issue-create-results.json");
const outPath = path.resolve(args.out ?? ".data/p1-handoff-issue-registration-receipt.json");
const markdownPath = path.resolve(
  args.markdown ?? path.join(path.dirname(outPath), "p1-handoff-issue-registration-receipt.md"),
);

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

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function hasPlaceholder(value) {
  return !text(value) || /TODO|TBD|placeholder|example|sample|yyyy|미정|예시|샘플|<[^>]+>/i.test(text(value));
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

function addBlocker(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readSafeFile(filePath, label) {
  const buffer = await readFile(filePath);
  const source = buffer.toString("utf8");

  if (hasSecretLikeSource(source)) {
    throw new Error(`${label} must not include raw secret-like values: ${rel(filePath)}`);
  }

  return { buffer, source };
}

function issueIdFromUrl(url) {
  const match = text(url).match(/\/issues\/(\d+)(?:[#/?].*)?$/);
  return match?.[1] ?? "";
}

function findResultForIssue(issueDraft, results) {
  const rows = Array.isArray(results.registrations) ? results.registrations : [];

  return (
    rows.find((row) => text(row.packageDir) === issueDraft.packageDir) ??
    rows.find((row) => text(row.title) === issueDraft.title) ??
    rows.find((row) => text(row.issueDraft?.path) === issueDraft.path) ??
    null
  );
}

function resultField(row, key, fallback = "") {
  return text(row?.external?.[key]) || text(row?.[key]) || text(fallback);
}

function issueDraftPathField(row) {
  return text(row?.issueDraft?.path ?? row?.issueDraftPath);
}

function validateTimestamp(value, blockers, packageDir, field) {
  if (hasPlaceholder(value)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_TIMESTAMP_INVALID", "Issue registration results JSON timestamps must be real ISO timestamps.", {
      packageDir,
      field,
    });
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(text(value))) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_TIMESTAMP_INVALID", "Issue registration results JSON timestamps must use ISO date-time format.", {
      packageDir,
      field,
      value,
    });
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_TIMESTAMP_INVALID", "Issue registration results JSON timestamps must be parseable ISO timestamps.", {
      packageDir,
      field,
      value,
    });
    return null;
  }

  return parsed;
}

function validateHttpsUrl(value, blockers, packageDir, field) {
  if (hasPlaceholder(value)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_URL_INVALID", "Issue registration results JSON URL must be a real HTTPS permalink.", {
      packageDir,
      field,
    });
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_URL_INVALID", "Issue registration results JSON URL must use HTTPS.", {
        packageDir,
        field,
        value,
      });
    }
  } catch {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_URL_INVALID", "Issue registration results JSON URL must be parseable.", {
      packageDir,
      field,
      value,
    });
  }
}

function validateResultsRows(results, issueDrafts, blockers) {
  const issueDraftRows = Array.isArray(issueDrafts.issueDrafts) ? issueDrafts.issueDrafts : [];
  const rows = Array.isArray(results.registrations) ? results.registrations : [];

  if (issueDrafts.releaseDecision !== "ready") {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_DRAFTS_NOT_READY", "Issue registration results JSON requires ready issue drafts.", {
      releaseDecision: issueDrafts.releaseDecision ?? null,
    });
  }

  const expectedByPackage = new Map(issueDraftRows.map((issueDraft) => [issueDraft.packageDir, issueDraft]));
  const seenDirs = new Set();

  for (const [index, row] of rows.entries()) {
    const packageDir = text(row?.packageDir);
    const rowNumber = index + 1;
    const issueDraft = expectedByPackage.get(packageDir);

    if (!issueDraft) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_ROW_UNKNOWN", "Issue registration results JSON contains an unknown packageDir.", {
        rowNumber,
        packageDir,
      });
      continue;
    }

    if (seenDirs.has(packageDir)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_ROW_DUPLICATE", "Issue registration results JSON contains a duplicate packageDir.", {
        rowNumber,
        packageDir,
      });
      continue;
    }

    seenDirs.add(packageDir);

    if (text(row.title) && text(row.title) !== text(issueDraft.title)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_READONLY_MISMATCH", "Issue registration results JSON can only edit external result fields.", {
        packageDir,
        rowNumber,
        field: "title",
        jsonValue: row.title ?? null,
        expected: issueDraft.title,
      });
    }

    const rowDraftPath = issueDraftPathField(row);
    if (rowDraftPath && rowDraftPath !== text(issueDraft.path)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_READONLY_MISMATCH", "Issue registration results JSON can only edit external result fields.", {
        packageDir,
        rowNumber,
        field: "issueDraft.path",
        jsonValue: rowDraftPath,
        expected: issueDraft.path,
      });
    }
  }

  for (const issueDraft of issueDraftRows) {
    if (!findResultForIssue(issueDraft, results)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_ROW_MISSING", "Issue registration results JSON is missing a required packageDir.", {
        packageDir: issueDraft.packageDir,
      });
    }
  }
}

function validateRegistration(registration, blockers) {
  const packageDir = registration.packageDir;
  const external = registration.external ?? {};
  const acknowledgement = registration.acknowledgement ?? {};

  for (const [field, value] of Object.entries({
    system: external.system,
    id: external.id,
    postedBy: external.postedBy,
    assignee: external.assignee,
    evidence: external.evidence,
  })) {
    if (hasPlaceholder(value)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_FIELD_PLACEHOLDER", "Issue registration results JSON must replace every TODO external result field before applying.", {
        packageDir,
        field,
      });
    }
  }

  if (acknowledgement.status !== "acknowledged") {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_ACK_STATUS_INVALID", "Issue registration results JSON acknowledgement status must be acknowledged before applying.", {
      packageDir,
      status: acknowledgement.status ?? null,
    });
  }

  validateHttpsUrl(external.url, blockers, packageDir, "external.url");
  validateHttpsUrl(external.evidence, blockers, packageDir, "external.evidence");
  validateHttpsUrl(acknowledgement.evidence, blockers, packageDir, "acknowledgement.evidence");

  const postedAt = validateTimestamp(external.postedAt, blockers, packageDir, "external.postedAt");
  const acknowledgedAt = validateTimestamp(acknowledgement.acknowledgedAt, blockers, packageDir, "acknowledgement.acknowledgedAt");

  if (postedAt !== null && acknowledgedAt !== null && acknowledgedAt < postedAt) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RESULTS_JSON_ACK_BEFORE_POST", "Issue registration results JSON acknowledgedAt must be after postedAt.", {
      packageDir,
    });
  }
}

function createMarkdown(receipt, results) {
  const lines = [
    "# P1 Handoff Issue Registration Receipt",
    "",
    `- Issue draft manifest: \`${receipt.issueDraftManifest.path}\``,
    `- Issue draft manifest SHA-256: \`${receipt.issueDraftManifest.sha256}\``,
    `- Issue draft decision: \`${receipt.issueDraftManifest.releaseDecision}\``,
    `- Results source: \`${rel(resultsPath)}\``,
    `- Results decision: \`${results.releaseDecision ?? "unknown"}\``,
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

const issueDraftsArtifact = await readSafeFile(issueDraftsPath, "P1 handoff issue draft manifest");
const resultsArtifact = await readSafeFile(resultsPath, "P1 handoff issue creation results");
const issueDrafts = parseJson(issueDraftsArtifact.source, "P1 handoff issue draft manifest");
const results = parseJson(resultsArtifact.source, "P1 handoff issue creation results");
const generatedAt = new Date().toISOString();
const blockers = [];

validateResultsRows(results, issueDrafts, blockers);
const registrations = [];

for (const issueDraft of issueDrafts.issueDrafts ?? []) {
  const draftPath = path.resolve(issueDraft.path);
  const draftArtifact = await readSafeFile(draftPath, "P1 handoff issue draft Markdown");
  const row = findResultForIssue(issueDraft, results);
  const externalUrl = resultField(row, "url", "TODO https URL");
  const acknowledgement = row?.acknowledgement ?? {};
  const externalSystem = resultField(row, "system", results.system ?? "GitHub issue");
  const issueDraftHash = sha256(draftArtifact.buffer);

  const registration = {
    ownerRole: issueDraft.ownerRole ?? "TODO owner role",
    packageDir: issueDraft.packageDir,
    title: issueDraft.title,
    issueDraft: {
      path: rel(draftPath),
      bodySha256: issueDraftHash,
      sizeBytes: draftArtifact.buffer.byteLength,
      labels: issueDraft.labels ?? [],
      strictCommands: issueDraft.strictCommands ?? [],
      totalActions: issueDraft.totalActions ?? 0,
    },
    external: {
      system: externalSystem,
      url: externalUrl,
      id: resultField(row, "id", resultField(row, "number", issueIdFromUrl(externalUrl) || "TODO issue number")),
      postedAt: resultField(row, "postedAt", results.postedAt ?? "TODO ISO timestamp"),
      postedBy: resultField(row, "postedBy", results.postedBy ?? "TODO operator account"),
      assignee: resultField(row, "assignee", results.assignee ?? "TODO external assignee"),
      labels: Array.isArray(row?.external?.labels)
        ? row.external.labels
        : Array.isArray(row?.labels)
          ? row.labels
          : issueDraft.labels ?? [],
      bodySha256: issueDraftHash,
      evidence: resultField(row, "evidence", externalUrl || "TODO permalink or screenshot evidence"),
    },
    acknowledgement: {
      status: text(acknowledgement.status) || text(results.acknowledgement?.status) || "pending",
      acknowledgedAt:
        text(acknowledgement.acknowledgedAt) || text(results.acknowledgement?.acknowledgedAt) || "TODO ISO timestamp",
      evidence: text(acknowledgement.evidence) || text(results.acknowledgement?.evidence) || "TODO owner acknowledgement permalink",
    },
  };

  validateRegistration(registration, blockers);
  registrations.push(registration);
}

const registered = registrations.filter((registration) => !hasPlaceholder(registration.external.url)).length;
const acknowledged = registrations.filter((registration) => registration.acknowledgement.status === "acknowledged").length;
const readyLike =
  blockers.length === 0 && issueDrafts.releaseDecision === "ready" && registered === registrations.length && acknowledged === registrations.length;
const receipt = {
  schemaVersion: 1,
  generatedAt,
  releaseDecision: readyLike ? "ready" : "blocked",
  issueDraftManifest: {
    path: rel(issueDraftsPath),
    sha256: sha256(issueDraftsArtifact.buffer),
    sizeBytes: issueDraftsArtifact.buffer.byteLength,
    releaseDecision: issueDrafts.releaseDecision ?? null,
    generatedAt: issueDrafts.generatedAt ?? null,
    index: issueDrafts.index ?? null,
  },
  results: {
    path: rel(resultsPath),
    sha256: sha256(resultsArtifact.buffer),
    sizeBytes: resultsArtifact.buffer.byteLength,
    releaseDecision: results.releaseDecision ?? null,
  },
  outputPaths: {
    receipt: rel(outPath),
    markdown: rel(markdownPath),
    report: rel(path.join(path.dirname(outPath), "p1-handoff-issue-registration-report.json")),
  },
  registrations,
  summary: {
    issueDrafts: registrations.length,
    registered,
    acknowledged,
    totalActions: registrations.reduce((sum, registration) => sum + registration.issueDraft.totalActions, 0),
  },
  checked: [
    "issue draft manifest path and hashes are captured",
    "GitHub/Slack creation results are mapped by package, title, or draft path",
    "issue body SHA-256 values are recalculated from local Markdown drafts",
    "raw secret-like values are not written to the issue registration receipt",
  ],
  nextActions:
    readyLike
      ? [
          `최종 P1 readiness 전에 \`npm run p1:handoff-issue-receipt -- --file=${rel(outPath)} --issue-drafts=${rel(issueDraftsPath)} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-issue-registration-report.json"))}\`를 실행합니다.`,
        ]
      : [
          "GitHub/Slack results JSON의 모든 TODO 필드를 채운 뒤 이 apply 명령을 다시 실행합니다.",
          `이후 \`npm run p1:handoff-issue-receipt -- --file=${rel(outPath)} --issue-drafts=${rel(issueDraftsPath)} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-issue-registration-report.json"))}\`를 실행합니다.`,
  ],
};

if (blockers.length > 0) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        releaseDecision: "blocked",
        generatedAt,
        checked: [
          "issue registration results JSON rows match the issue draft manifest exactly",
          "external URL, assignee, posting evidence, and acknowledgement evidence are filled",
          "acknowledgement timestamps are valid and after posting time",
          "completed issue registration receipt is not written until JSON blockers are fixed",
        ],
        artifacts: {
          results: { path: rel(resultsPath), sha256: sha256(resultsArtifact.buffer), sizeBytes: resultsArtifact.buffer.byteLength },
          issueDrafts: { path: rel(issueDraftsPath), sha256: sha256(issueDraftsArtifact.buffer), sizeBytes: issueDraftsArtifact.buffer.byteLength },
          out: { path: rel(outPath), written: false },
          markdown: { path: rel(markdownPath), written: false },
        },
        summary: {
          resultRows: Array.isArray(results.registrations) ? results.registrations.length : 0,
          issueDrafts: Array.isArray(issueDrafts.issueDrafts) ? issueDrafts.issueDrafts.length : 0,
          registered,
          acknowledged,
        },
        nextActions: ["JSON results blocker를 수정한 뒤 이 apply 명령을 다시 실행하고 strict 이슈 등록 receipt 검증기를 실행합니다."],
        blockers,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
await mkdir(path.dirname(markdownPath), { recursive: true });
await writeFile(markdownPath, createMarkdown(receipt, results));

console.log(JSON.stringify(receipt, null, 2));
