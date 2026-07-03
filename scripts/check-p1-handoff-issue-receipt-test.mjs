import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-handoff-issue-receipt-"));
const rawPaymentSecret = "sk_live_finaljudo_issue_registration_secret_that_must_not_be_written";
const csvHeaders = [
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

function csvEscape(value) {
  const source = typeof value === "string" ? value : String(value ?? "");

  if (/[",\n\r]/.test(source)) {
    return `"${source.replace(/"/g, '""')}"`;
  }

  return source;
}

async function writeIssueResultsCsv(filePath, rows, headers = csvHeaders) {
  const source = `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n")}\n`;

  await writeFile(filePath, source);
}

function createIssueResultsRows(issueDrafts, overrides = () => ({})) {
  return issueDrafts.map((issueDraft, index) => ({
    packageDir: issueDraft.packageDir,
    title: issueDraft.title,
    issueDraftPath: issueDraft.path,
    system: "GitHub issue",
    postedBy: "product-lead@finaljudo.kr",
    postedAt: "2026-07-01T11:00:00.000Z",
    url: `https://github.com/antoe-prog/ant/issues/${401 + index}`,
    id: `${401 + index}`,
    assignee: `owner-${index + 1}@finaljudo.kr`,
    evidence: `https://github.com/antoe-prog/ant/issues/${401 + index}`,
    acknowledgementStatus: "acknowledged",
    acknowledgedAt: "2026-07-01T12:00:00.000Z",
    acknowledgementEvidence: `https://github.com/antoe-prog/ant/issues/${401 + index}#issuecomment-${9401 + index}`,
    ...overrides(issueDraft, index),
  }));
}

await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-draft-workspace.mjs",
    `--out-dir=${directory}`,
    "--production-origin=https://app.finaljudo.kr",
    "--payment-checkout-base-url=https://pay.finaljudo.kr",
  ],
  { cwd: process.cwd() },
);

const bundlePath = path.join(directory, "p1-handoff-bundle-manifest.json");
await execFile(process.execPath, ["scripts/check-p1-handoff-bundle.mjs", `--workspace=${directory}`, `--out=${bundlePath}`], {
  cwd: process.cwd(),
});

const blockedIssueDraftManifestPath = path.join(directory, "p1-handoff-issue-drafts", "issue-drafts.json");
const blockedReceiptPath = path.join(directory, "p1-handoff-issue-registration-receipt.blocked.json");
const blockedMarkdownPath = path.join(directory, "p1-handoff-issue-registration-receipt.blocked.md");
const blockedDraftResult = await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-issue-receipt-draft.mjs",
    `--issue-drafts=${blockedIssueDraftManifestPath}`,
    `--out=${blockedReceiptPath}`,
    `--markdown=${blockedMarkdownPath}`,
  ],
  { cwd: process.cwd() },
);
const blockedDraft = JSON.parse(blockedDraftResult.stdout);
const blockedMarkdown = await readFile(blockedMarkdownPath, "utf8");

assert.equal(blockedDraft.issueDraftManifest.releaseDecision, "blocked");
assert.equal(blockedDraft.issueDraftManifest.publishReady, false);
assert.equal(blockedDraft.issueDraftManifest.blockerCount > 0, true);
assert(blockedDraft.nextActions[0].includes("등록하지 않습니다"));
assert(!blockedDraft.nextActions[0].includes("각 Markdown draft"));
assert(blockedDraft.nextActions.some((action) => action.includes("p1:handoff-dispatch:apply-csv")));
assert(blockedDraft.nextActions.some((action) => action.includes("publishReady=true")));
assert(blockedMarkdown.includes("## Blocked State"));
assert(blockedMarkdown.includes("등록하지 않습니다"));

let blockedReportFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-handoff-issue-receipt.mjs",
      `--file=${blockedReceiptPath}`,
      `--issue-drafts=${blockedIssueDraftManifestPath}`,
      `--out=${path.join(directory, "p1-handoff-issue-registration-report.blocked.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  blockedReportFailed = true;
  const blockedReport = JSON.parse(error?.stdout?.toString() ?? "{}");
  assert(blockedReport.blockers.some((blocker) => blocker.code === "P1_HANDOFF_ISSUE_RECEIPT_DRAFTS_NOT_READY"));
  assert(blockedReport.blockers.some((blocker) => blocker.code === "P1_HANDOFF_ISSUE_RECEIPT_DRAFTS_NOT_PUBLISH_READY"));
  assert(!blockedReport.blockers.some((blocker) => blocker.code === "P1_HANDOFF_ISSUE_RECEIPT_DUPLICATE_EXTERNAL_URL"));
  assert(!blockedReport.blockers.some((blocker) => blocker.code === "P1_HANDOFF_ISSUE_RECEIPT_EXTERNAL_FIELD_MISSING"));
  assert(blockedReport.nextActions[0].includes("등록하지 않습니다"));
  assert(blockedReport.nextActions.some((action) => action.includes("p1:handoff-dispatch:apply-csv")));
  assert(blockedReport.nextActions.some((action) => action.includes("publishReady=true")));
}
assert.equal(blockedReportFailed, true, "blocked issue draft report must stop before external issue publication");

const dispatchReceiptPath = path.join(directory, "p1-handoff-dispatch-receipt.json");
await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-dispatch-draft.mjs",
    `--bundle=${bundlePath}`,
    `--out=${dispatchReceiptPath}`,
    `--markdown=${path.join(directory, "p1-handoff-dispatch-receipt.md")}`,
  ],
  { cwd: process.cwd() },
);

const dispatchReceipt = JSON.parse(await readFile(dispatchReceiptPath, "utf8"));
const completedDispatchReceipt = {
  ...dispatchReceipt,
  releaseDecision: "ready",
  ownerPackages: dispatchReceipt.ownerPackages.map((ownerPackage, index) => ({
    ...ownerPackage,
    assignment: {
      assignedToName: `${ownerPackage.ownerRole} 실무 담당자`,
      assignedToContact: `owner-${index + 1}@finaljudo.kr`,
      channel: "GitHub issue and Slack channel",
      assignedAt: "2026-07-01T09:00:00.000Z",
      dueAt: "2026-07-02T18:00:00.000Z",
      evidence: `https://github.com/antoe-prog/ant/issues/${201 + index}`,
    },
    acknowledgement: {
      status: "acknowledged",
      acknowledgedAt: "2026-07-01T10:00:00.000Z",
      evidence: `https://github.com/antoe-prog/ant/issues/${201 + index}#issuecomment-${9201 + index}`,
    },
  })),
};
await writeFile(dispatchReceiptPath, `${JSON.stringify(completedDispatchReceipt, null, 2)}\n`);

const readyIssuesDir = path.join(directory, "ready-issues");
await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-issue-drafts.mjs",
    `--receipt=${dispatchReceiptPath}`,
    `--out-dir=${readyIssuesDir}`,
    "--github-repo=antoe-prog/ant",
  ],
  { cwd: process.cwd() },
);

const issueDraftManifestPath = path.join(readyIssuesDir, "issue-drafts.json");
const issueDraftManifest = JSON.parse(await readFile(issueDraftManifestPath, "utf8"));
const expectedIssueCount = issueDraftManifest.issueDrafts.length;
const githubResultsTemplateCsvPath = path.join(readyIssuesDir, "github-issue-create-results.template.csv");
const githubResultsTemplateCsv = await readFile(githubResultsTemplateCsvPath, "utf8");
const connectorResponsesPath = path.join(readyIssuesDir, "github-connector-issue-responses.json");
const connectorResultsPath = path.join(readyIssuesDir, "github-issue-create-results.connector.json");
const receiptPath = path.join(directory, "p1-handoff-issue-registration-receipt.json");
const markdownPath = path.join(directory, "p1-handoff-issue-registration-receipt.md");
const draftResult = await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-issue-receipt-draft.mjs",
    `--issue-drafts=${issueDraftManifestPath}`,
    `--out=${receiptPath}`,
    `--markdown=${markdownPath}`,
  ],
  { cwd: process.cwd() },
);
const draft = JSON.parse(draftResult.stdout);

assert.equal(draft.releaseDecision, "blocked");
assert.equal(draft.issueDraftManifest.releaseDecision, "ready");
assert.equal(draft.issueDraftManifest.publishReady, true);
assert.equal(draft.registrations.length, expectedIssueCount);
assert.equal(draft.summary.registered, 0);
assert(draft.nextActions[0].includes("각 Markdown draft"));
assert((await readFile(markdownPath, "utf8")).includes("P1 Handoff Issue Registration Receipt"));
assert(githubResultsTemplateCsv.includes("packageDir,title,issueDraftPath,system,postedBy,postedAt,url,id,assignee,evidence,acknowledgementStatus,acknowledgedAt,acknowledgementEvidence"));
assert(githubResultsTemplateCsv.includes("TODO operator account"));
assert.equal(githubResultsTemplateCsv.trim().split("\n").length, expectedIssueCount + 1);

let draftFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-handoff-issue-receipt.mjs",
      `--file=${receiptPath}`,
      `--issue-drafts=${issueDraftManifestPath}`,
      `--out=${path.join(directory, "issue-registration-draft-report.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  draftFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_ISSUE_RECEIPT_EXTERNAL_FIELD_MISSING"));
  assert(stdoutSource.includes("P1_HANDOFF_ISSUE_RECEIPT_ACK_PENDING"));
  assert(!stdoutSource.includes("P1_HANDOFF_ISSUE_RECEIPT_DUPLICATE_EXTERNAL_URL"));
  assert(!stdoutSource.includes("P1_HANDOFF_ISSUE_RECEIPT_DUPLICATE_EXTERNAL_ID"));
}

assert.equal(draftFailed, true, "issue registration receipt draft must stay blocked until external evidence is filled");

const connectorResponsesDocument = {
  connector: "mcp__codex_apps__github._create_issue",
  githubRepo: "antoe-prog/ant",
  responses: issueDraftManifest.issueDrafts.map((issueDraft, index) => ({
    title: issueDraft.title,
    number: 501 + index,
    html_url: `https://github.com/antoe-prog/ant/issues/${501 + index}`,
    created_at: "2026-07-01T11:00:00.000Z",
    user: { login: "codex-operator" },
    assignees: [{ login: `owner-${index + 1}` }],
    labels: issueDraft.labels.map((label) => ({ name: label })),
    acknowledgement: {
      status: "acknowledged",
      acknowledgedAt: `2026-07-01T12:0${index}:00.000Z`,
      evidence: `https://github.com/antoe-prog/ant/issues/${501 + index}#issuecomment-${9501 + index}`,
    },
  })),
};
await writeFile(connectorResponsesPath, `${JSON.stringify(connectorResponsesDocument, null, 2)}\n`);

const connectorResult = await execFile(
  process.execPath,
  [
    "scripts/apply-p1-handoff-issue-connector-responses.mjs",
    `--issue-drafts=${issueDraftManifestPath}`,
    `--responses=${connectorResponsesPath}`,
    `--out=${connectorResultsPath}`,
  ],
  { cwd: process.cwd() },
);
const connectorReport = JSON.parse(connectorResult.stdout);
const connectorResults = JSON.parse(await readFile(connectorResultsPath, "utf8"));

assert.equal(connectorReport.ok, true);
assert.equal(connectorReport.releaseDecision, "ready");
assert.equal(connectorReport.summary.connectorResponses, expectedIssueCount);
assert.equal(connectorResults.source, "github-connector");
assert.equal(connectorResults.githubRepo, "antoe-prog/ant");
assert.equal(connectorResults.registrations[0].external.url, "https://github.com/antoe-prog/ant/issues/501");
assert.equal(connectorResults.registrations[0].external.assignee, "owner-1");
assert.equal(connectorResults.registrations[0].acknowledgement.status, "acknowledged");
assert.equal(connectorResults.registrations[0].acknowledgement.evidence, "https://github.com/antoe-prog/ant/issues/501#issuecomment-9501");
assert.equal(connectorResults.registrations[4].acknowledgement.evidence, "https://github.com/antoe-prog/ant/issues/505#issuecomment-9505");

const connectorAppliedResult = await execFile(
  process.execPath,
  [
    "scripts/apply-p1-handoff-issue-registration-results.mjs",
    `--issue-drafts=${issueDraftManifestPath}`,
    `--results=${connectorResultsPath}`,
    `--out=${receiptPath}`,
    `--markdown=${markdownPath}`,
  ],
  { cwd: process.cwd() },
);
const connectorApplied = JSON.parse(connectorAppliedResult.stdout);
assert.equal(connectorApplied.releaseDecision, "ready");
assert.equal(connectorApplied.summary.registered, expectedIssueCount);
assert.equal(connectorApplied.registrations[0].external.bodySha256, connectorApplied.registrations[0].issueDraft.bodySha256);

const connectorAppliedReadyResult = await execFile(
  process.execPath,
  [
    "scripts/check-p1-handoff-issue-receipt.mjs",
    `--file=${receiptPath}`,
    `--issue-drafts=${issueDraftManifestPath}`,
    `--out=${path.join(directory, "issue-registration-connector-applied-report.json")}`,
  ],
  { cwd: process.cwd() },
);
const connectorAppliedReadyReport = JSON.parse(connectorAppliedReadyResult.stdout);
assert.equal(connectorAppliedReadyReport.ok, true);
assert.equal(connectorAppliedReadyReport.summary.registered, expectedIssueCount);

const normalizedConnectorResponsesPath = path.join(readyIssuesDir, "github-connector-issue-responses.normalized.json");
const normalizedConnectorResultsPath = path.join(readyIssuesDir, "github-issue-create-results.connector-normalized.json");
const normalizedConnectorResponsesDocument = {
  connector: "mcp__codex_apps__github._create_issue",
  responses: issueDraftManifest.issueDrafts.map((issueDraft, index) => ({
    result: {
      displayTitle: issueDraft.title,
      url: `https://api.github.com/repos/antoe-prog/ant/issues/${701 + index}`,
      createdAt: "2026-07-01T11:00:00.000Z",
      author: { login: "codex-operator" },
      repository: { fullName: "antoe-prog/ant" },
      assignees: { nodes: [{ login: `owner-${index + 1}` }] },
      labels: { nodes: issueDraft.labels.map((label) => ({ name: label })) },
    },
    acknowledgement: {
      status: "acknowledged",
      acknowledgedAt: `2026-07-01T12:1${index}:00.000Z`,
      evidence: `https://github.com/antoe-prog/ant/issues/${701 + index}#issuecomment-${9701 + index}`,
    },
  })),
};
await writeFile(normalizedConnectorResponsesPath, `${JSON.stringify(normalizedConnectorResponsesDocument, null, 2)}\n`);

const normalizedConnectorResult = await execFile(
  process.execPath,
  [
    "scripts/apply-p1-handoff-issue-connector-responses.mjs",
    `--issue-drafts=${issueDraftManifestPath}`,
    `--responses=${normalizedConnectorResponsesPath}`,
    `--out=${normalizedConnectorResultsPath}`,
  ],
  { cwd: process.cwd() },
);
const normalizedConnectorReport = JSON.parse(normalizedConnectorResult.stdout);
const normalizedConnectorResults = JSON.parse(await readFile(normalizedConnectorResultsPath, "utf8"));

assert.equal(normalizedConnectorReport.ok, true);
assert.equal(normalizedConnectorReport.releaseDecision, "ready");
assert.equal(normalizedConnectorResults.registrations[0].external.url, "https://github.com/antoe-prog/ant/issues/701");
assert.equal(normalizedConnectorResults.registrations[0].external.id, "701");
assert.equal(normalizedConnectorResults.registrations[0].external.assignee, "owner-1");
assert.equal(normalizedConnectorResults.registrations[0].external.labels.includes("pilot-release"), true);
assert.equal(normalizedConnectorResults.registrations[4].acknowledgement.evidence, "https://github.com/antoe-prog/ant/issues/705#issuecomment-9705");

const missingConnectorResponsesPath = path.join(readyIssuesDir, "github-connector-issue-responses.missing.json");
await writeFile(
  missingConnectorResponsesPath,
  `${JSON.stringify(
    {
      githubRepo: "antoe-prog/ant",
      responses: issueDraftManifest.issueDrafts.slice(1).map((issueDraft, index) => ({
        title: issueDraft.title,
        number: 601 + index,
        html_url: `https://github.com/antoe-prog/ant/issues/${601 + index}`,
      })),
    },
    null,
    2,
  )}\n`,
);

let missingConnectorFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/apply-p1-handoff-issue-connector-responses.mjs",
      `--issue-drafts=${issueDraftManifestPath}`,
      `--responses=${missingConnectorResponsesPath}`,
      `--out=${path.join(readyIssuesDir, "github-issue-create-results.connector-missing.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  missingConnectorFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_ISSUE_CONNECTOR_RESPONSE_MISSING"));
}
assert.equal(missingConnectorFailed, true, "connector response conversion must reject missing issue responses");

async function expectConnectorConversionFailure(name, document, expectedCode) {
  const fixturePath = path.join(readyIssuesDir, `github-connector-issue-responses.${name}.json`);
  await writeFile(fixturePath, `${JSON.stringify(document, null, 2)}\n`);

  let failed = false;

  try {
    await execFile(
      process.execPath,
      [
        "scripts/apply-p1-handoff-issue-connector-responses.mjs",
        `--issue-drafts=${issueDraftManifestPath}`,
        `--responses=${fixturePath}`,
        `--out=${path.join(readyIssuesDir, `github-issue-create-results.connector-${name}.json`)}`,
      ],
      { cwd: process.cwd() },
    );
  } catch (error) {
    failed = true;
    const stdoutSource = error?.stdout?.toString() ?? "";
    assert(stdoutSource.includes(expectedCode), `${name} must fail with ${expectedCode}`);
  }

  assert.equal(failed, true, `${name} connector response fixture must fail`);
}

await expectConnectorConversionFailure(
  "ack-missing-evidence",
  {
    ...connectorResponsesDocument,
    responses: connectorResponsesDocument.responses.map((response, index) =>
      index === 0
        ? {
            ...response,
            acknowledgement: {
              ...response.acknowledgement,
              evidence: "TODO owner acknowledgement permalink",
            },
          }
        : response,
    ),
  },
  "P1_HANDOFF_ISSUE_CONNECTOR_ACK_EVIDENCE_MISSING",
);
await expectConnectorConversionFailure(
  "ack-http-evidence",
  {
    ...connectorResponsesDocument,
    responses: connectorResponsesDocument.responses.map((response, index) =>
      index === 0
        ? {
            ...response,
            acknowledgement: {
              ...response.acknowledgement,
              evidence: "http://github.com/antoe-prog/ant/issues/501#issuecomment-9501",
            },
          }
        : response,
    ),
  },
  "P1_HANDOFF_ISSUE_CONNECTOR_ACK_EVIDENCE_INVALID",
);
await expectConnectorConversionFailure(
  "ack-before-post",
  {
    ...connectorResponsesDocument,
    responses: connectorResponsesDocument.responses.map((response, index) =>
      index === 0
        ? {
            ...response,
            acknowledgement: {
              ...response.acknowledgement,
              acknowledgedAt: "2026-07-01T10:59:00.000Z",
            },
          }
        : response,
    ),
  },
  "P1_HANDOFF_ISSUE_CONNECTOR_ACK_BEFORE_POST",
);
await expectConnectorConversionFailure(
  "loose-posted-at",
  {
    ...connectorResponsesDocument,
    responses: connectorResponsesDocument.responses.map((response, index) =>
      index === 0
        ? {
            ...response,
            created_at: "July 1, 2026 11:00",
          }
        : response,
    ),
  },
  "P1_HANDOFF_ISSUE_CONNECTOR_POSTED_AT_INVALID",
);

const githubResultsPath = path.join(readyIssuesDir, "github-issue-create-results.json");
const githubResultsDocument = {
  schemaVersion: 1,
  releaseDecision: "ready",
  system: "GitHub issue",
  postedAt: "2026-07-01T11:00:00.000Z",
  postedBy: "product-lead@finaljudo.kr",
  registrations: issueDraftManifest.issueDrafts.map((issueDraft, index) => ({
    packageDir: issueDraft.packageDir,
    title: issueDraft.title,
    external: {
      url: `https://github.com/antoe-prog/ant/issues/${301 + index}`,
      id: `${301 + index}`,
      assignee: `owner-${index + 1}@finaljudo.kr`,
      evidence: `https://github.com/antoe-prog/ant/issues/${301 + index}`,
    },
    acknowledgement: {
      status: "acknowledged",
      acknowledgedAt: "2026-07-01T12:00:00.000Z",
      evidence: `https://github.com/antoe-prog/ant/issues/${301 + index}#issuecomment-${9301 + index}`,
    },
  })),
};
await writeFile(githubResultsPath, `${JSON.stringify(githubResultsDocument, null, 2)}\n`);

const appliedResult = await execFile(
  process.execPath,
  [
    "scripts/apply-p1-handoff-issue-registration-results.mjs",
    `--issue-drafts=${issueDraftManifestPath}`,
    `--results=${githubResultsPath}`,
    `--out=${receiptPath}`,
    `--markdown=${markdownPath}`,
  ],
  { cwd: process.cwd() },
);
const applied = JSON.parse(appliedResult.stdout);

assert.equal(applied.releaseDecision, "ready");
assert.equal(applied.summary.registered, expectedIssueCount);
assert.equal(applied.summary.acknowledged, expectedIssueCount);
assert.equal(applied.registrations[0].external.bodySha256, applied.registrations[0].issueDraft.bodySha256);
assert.equal(applied.registrations[0].external.labels.includes("pilot-release"), true);
assert((await readFile(markdownPath, "utf8")).includes("Results source"));

const appliedReadyResult = await execFile(
  process.execPath,
  [
    "scripts/check-p1-handoff-issue-receipt.mjs",
    `--file=${receiptPath}`,
    `--issue-drafts=${issueDraftManifestPath}`,
    `--out=${path.join(directory, "issue-registration-applied-report.json")}`,
  ],
  { cwd: process.cwd() },
);
const appliedReadyReport = JSON.parse(appliedReadyResult.stdout);

assert.equal(appliedReadyReport.ok, true);
assert.equal(appliedReadyReport.summary.registered, expectedIssueCount);
assert.equal(appliedReadyReport.summary.acknowledged, expectedIssueCount);

const duplicateExternalReceiptPath = path.join(directory, "p1-handoff-issue-registration-receipt.duplicate-external.json");
const duplicateExternalReceipt = JSON.parse(JSON.stringify(applied));
duplicateExternalReceipt.registrations[1].external.url = duplicateExternalReceipt.registrations[0].external.url;
duplicateExternalReceipt.registrations[1].external.id = duplicateExternalReceipt.registrations[0].external.id;
duplicateExternalReceipt.registrations[1].external.system = duplicateExternalReceipt.registrations[0].external.system;
await writeFile(duplicateExternalReceiptPath, `${JSON.stringify(duplicateExternalReceipt, null, 2)}\n`);

let duplicateExternalFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-handoff-issue-receipt.mjs",
      `--file=${duplicateExternalReceiptPath}`,
      `--issue-drafts=${issueDraftManifestPath}`,
      `--out=${path.join(directory, "issue-registration-duplicate-external-report.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  duplicateExternalFailed = true;
  const duplicateReport = JSON.parse(error?.stdout?.toString() ?? "{}");
  const duplicateUrlBlockers = duplicateReport.blockers.filter(
    (blocker) => blocker.code === "P1_HANDOFF_ISSUE_RECEIPT_DUPLICATE_EXTERNAL_URL",
  );
  const duplicateIdBlockers = duplicateReport.blockers.filter(
    (blocker) => blocker.code === "P1_HANDOFF_ISSUE_RECEIPT_DUPLICATE_EXTERNAL_ID",
  );
  assert.equal(duplicateUrlBlockers.length, 1);
  assert.equal(duplicateIdBlockers.length, 1);
  assert.equal(duplicateUrlBlockers[0].detail.count, 2);
  assert(duplicateUrlBlockers[0].detail.packageDirs[0].endsWith("p1-handoff-owner-packages/01-devops-pm"));
  assert(duplicateUrlBlockers[0].detail.packageDirs[1].endsWith("p1-handoff-owner-packages/02-mobile-release"));
}
assert.equal(duplicateExternalFailed, true, "duplicate external URLs and IDs must fail as grouped blockers");

async function expectJsonApplyFailure(name, document, expectedCode) {
  const fixturePath = path.join(readyIssuesDir, `github-issue-create-results.${name}.json`);
  await writeFile(fixturePath, `${JSON.stringify(document, null, 2)}\n`);

  let failed = false;

  try {
    await execFile(
      process.execPath,
      [
        "scripts/apply-p1-handoff-issue-registration-results.mjs",
        `--issue-drafts=${issueDraftManifestPath}`,
        `--results=${fixturePath}`,
        `--out=${path.join(directory, `p1-handoff-issue-registration-receipt.${name}.json`)}`,
        `--markdown=${path.join(directory, `p1-handoff-issue-registration-receipt.${name}.md`)}`,
      ],
      { cwd: process.cwd() },
    );
  } catch (error) {
    failed = true;
    const stdoutSource = error?.stdout?.toString() ?? "";
    assert(stdoutSource.includes(expectedCode), `${name} must fail with ${expectedCode}`);
  }

  assert.equal(failed, true, `${name} JSON fixture must fail`);
}

await expectJsonApplyFailure(
  "json-missing-row",
  {
    ...githubResultsDocument,
    registrations: githubResultsDocument.registrations.slice(1),
  },
  "P1_HANDOFF_ISSUE_RESULTS_JSON_ROW_MISSING",
);
await expectJsonApplyFailure(
  "json-duplicate-row",
  {
    ...githubResultsDocument,
    registrations: [...githubResultsDocument.registrations, { ...githubResultsDocument.registrations[0] }],
  },
  "P1_HANDOFF_ISSUE_RESULTS_JSON_ROW_DUPLICATE",
);
await expectJsonApplyFailure(
  "json-unknown-row",
  {
    ...githubResultsDocument,
    registrations: githubResultsDocument.registrations.map((registration, index) =>
      index === 0 ? { ...registration, packageDir: "unknown-package" } : registration,
    ),
  },
  "P1_HANDOFF_ISSUE_RESULTS_JSON_ROW_UNKNOWN",
);
await expectJsonApplyFailure(
  "json-readonly-title",
  {
    ...githubResultsDocument,
    registrations: githubResultsDocument.registrations.map((registration, index) =>
      index === 0 ? { ...registration, title: "[P1 Handoff] Tampered" } : registration,
    ),
  },
  "P1_HANDOFF_ISSUE_RESULTS_JSON_READONLY_MISMATCH",
);
await expectJsonApplyFailure(
  "json-http-url",
  {
    ...githubResultsDocument,
    registrations: githubResultsDocument.registrations.map((registration, index) =>
      index === 0
        ? {
            ...registration,
            external: {
              ...registration.external,
              url: "http://github.com/antoe-prog/ant/issues/301",
            },
          }
        : registration,
    ),
  },
  "P1_HANDOFF_ISSUE_RESULTS_JSON_URL_INVALID",
);
await expectJsonApplyFailure(
  "json-pending-ack",
  {
    ...githubResultsDocument,
    registrations: githubResultsDocument.registrations.map((registration, index) =>
      index === 0
        ? {
            ...registration,
            acknowledgement: {
              ...registration.acknowledgement,
              status: "pending",
            },
          }
        : registration,
    ),
  },
  "P1_HANDOFF_ISSUE_RESULTS_JSON_ACK_STATUS_INVALID",
);
await expectJsonApplyFailure(
  "json-ack-before-post",
  {
    ...githubResultsDocument,
    registrations: githubResultsDocument.registrations.map((registration, index) =>
      index === 0
        ? {
            ...registration,
            acknowledgement: {
              ...registration.acknowledgement,
              acknowledgedAt: "2026-07-01T10:00:00.000Z",
            },
          }
        : registration,
    ),
  },
  "P1_HANDOFF_ISSUE_RESULTS_JSON_ACK_BEFORE_POST",
);
await expectJsonApplyFailure(
  "json-loose-posted-at",
  {
    ...githubResultsDocument,
    registrations: githubResultsDocument.registrations.map((registration, index) =>
      index === 0
        ? {
            ...registration,
            external: {
              ...registration.external,
              postedAt: "July 1, 2026 11:00",
            },
          }
        : registration,
    ),
  },
  "P1_HANDOFF_ISSUE_RESULTS_JSON_TIMESTAMP_INVALID",
);

const githubResultsCsvPath = path.join(readyIssuesDir, "github-issue-create-results.csv");
const completedCsvRows = createIssueResultsRows(issueDraftManifest.issueDrafts);
await writeIssueResultsCsv(githubResultsCsvPath, completedCsvRows);

const csvAppliedResult = await execFile(
  process.execPath,
  [
    "scripts/apply-p1-handoff-issue-registration-results-csv.mjs",
    `--issue-drafts=${issueDraftManifestPath}`,
    `--csv=${githubResultsCsvPath}`,
    `--out=${receiptPath}`,
    `--markdown=${markdownPath}`,
  ],
  { cwd: process.cwd() },
);
const csvAppliedReport = JSON.parse(csvAppliedResult.stdout);
const csvAppliedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));

assert.equal(csvAppliedReport.ok, true);
assert.equal(csvAppliedReport.summary.registered, expectedIssueCount);
assert.equal(csvAppliedReport.summary.acknowledged, expectedIssueCount);
assert.equal(csvAppliedReport.artifacts.out.written, true);
assert.equal(csvAppliedReceipt.releaseDecision, "ready");
assert.equal(csvAppliedReceipt.results.source, "csv");
assert.equal(csvAppliedReceipt.summary.registered, expectedIssueCount);
assert.equal(csvAppliedReceipt.registrations[0].external.bodySha256, csvAppliedReceipt.registrations[0].issueDraft.bodySha256);
assert.equal(csvAppliedReceipt.registrations[0].external.labels.includes("pilot-release"), true);
assert((await readFile(markdownPath, "utf8")).includes("Results source type: `csv`"));

const csvAppliedReadyResult = await execFile(
  process.execPath,
  [
    "scripts/check-p1-handoff-issue-receipt.mjs",
    `--file=${receiptPath}`,
    `--issue-drafts=${issueDraftManifestPath}`,
    `--out=${path.join(directory, "issue-registration-csv-applied-report.json")}`,
  ],
  { cwd: process.cwd() },
);
const csvAppliedReadyReport = JSON.parse(csvAppliedReadyResult.stdout);

assert.equal(csvAppliedReadyReport.ok, true);
assert.equal(csvAppliedReadyReport.summary.registered, expectedIssueCount);
assert.equal(csvAppliedReadyReport.summary.acknowledged, expectedIssueCount);

async function expectCsvApplyFailure(name, rowsOrPath, expectedCode, headers = csvHeaders) {
  const fixturePath =
    typeof rowsOrPath === "string" ? rowsOrPath : path.join(readyIssuesDir, `github-issue-create-results.${name}.csv`);

  if (typeof rowsOrPath !== "string") {
    await writeIssueResultsCsv(fixturePath, rowsOrPath, headers);
  }

  let failed = false;

  try {
    await execFile(
      process.execPath,
      [
        "scripts/apply-p1-handoff-issue-registration-results-csv.mjs",
        `--issue-drafts=${issueDraftManifestPath}`,
        `--csv=${fixturePath}`,
        `--out=${path.join(directory, `p1-handoff-issue-registration-receipt.${name}.json`)}`,
        `--markdown=${path.join(directory, `p1-handoff-issue-registration-receipt.${name}.md`)}`,
      ],
      { cwd: process.cwd() },
    );
  } catch (error) {
    failed = true;
    const stdoutSource = error?.stdout?.toString() ?? "";
    assert(stdoutSource.includes(expectedCode), `${name} must fail with ${expectedCode}`);
  }

  assert.equal(failed, true, `${name} CSV fixture must fail`);
}

await expectCsvApplyFailure(
  "template",
  githubResultsTemplateCsvPath,
  "P1_HANDOFF_ISSUE_RESULTS_CSV_FIELD_PLACEHOLDER",
);
await expectCsvApplyFailure(
  "duplicate",
  [...completedCsvRows, { ...completedCsvRows[0], id: "999", url: "https://github.com/antoe-prog/ant/issues/999" }],
  "P1_HANDOFF_ISSUE_RESULTS_CSV_ROW_DUPLICATE",
);
await expectCsvApplyFailure(
  "unknown",
  completedCsvRows.map((row, index) => (index === 0 ? { ...row, packageDir: "unknown-package" } : row)),
  "P1_HANDOFF_ISSUE_RESULTS_CSV_ROW_UNKNOWN",
);
await expectCsvApplyFailure(
  "missing-header",
  completedCsvRows,
  "P1_HANDOFF_ISSUE_RESULTS_CSV_HEADERS_MISSING",
  csvHeaders.filter((header) => header !== "assignee"),
);
await expectCsvApplyFailure(
  "readonly",
  createIssueResultsRows(issueDraftManifest.issueDrafts, (_issueDraft, index) =>
    index === 0 ? { title: "[P1 Handoff] Tampered" } : {},
  ),
  "P1_HANDOFF_ISSUE_RESULTS_CSV_READONLY_MISMATCH",
);
await expectCsvApplyFailure(
  "secret",
  createIssueResultsRows(issueDraftManifest.issueDrafts, (_issueDraft, index) =>
    index === 0 ? { evidence: rawPaymentSecret } : {},
  ),
  "P1_HANDOFF_ISSUE_RESULTS_CSV_SECRET_VALUE",
);
await expectCsvApplyFailure(
  "pending",
  createIssueResultsRows(issueDraftManifest.issueDrafts, (_issueDraft, index) =>
    index === 0 ? { acknowledgementStatus: "pending" } : {},
  ),
  "P1_HANDOFF_ISSUE_RESULTS_CSV_ACK_STATUS_INVALID",
);
await expectCsvApplyFailure(
  "http-url",
  createIssueResultsRows(issueDraftManifest.issueDrafts, (_issueDraft, index) =>
    index === 0 ? { url: "http://github.com/antoe-prog/ant/issues/401" } : {},
  ),
  "P1_HANDOFF_ISSUE_RESULTS_CSV_URL_INVALID",
);
await expectCsvApplyFailure(
  "ack-before-post",
  createIssueResultsRows(issueDraftManifest.issueDrafts, (_issueDraft, index) =>
    index === 0 ? { acknowledgedAt: "2026-07-01T10:00:00.000Z" } : {},
  ),
  "P1_HANDOFF_ISSUE_RESULTS_CSV_ACK_BEFORE_POST",
);
await expectCsvApplyFailure(
  "loose-posted-at",
  createIssueResultsRows(issueDraftManifest.issueDrafts, (_issueDraft, index) =>
    index === 0 ? { postedAt: "July 1, 2026 11:00" } : {},
  ),
  "P1_HANDOFF_ISSUE_RESULTS_CSV_TIMESTAMP_INVALID",
);

const completed = {
  ...draft,
  releaseDecision: "ready",
  registrations: draft.registrations.map((registration, index) => ({
    ...registration,
    external: {
      system: "GitHub issue",
      url: `https://github.com/antoe-prog/ant/issues/${301 + index}`,
      id: `${301 + index}`,
      postedAt: "2026-07-01T11:00:00.000Z",
      postedBy: "product-lead@finaljudo.kr",
      assignee: `owner-${index + 1}@finaljudo.kr`,
      labels: registration.issueDraft.labels,
      bodySha256: registration.issueDraft.bodySha256,
      evidence: `https://github.com/antoe-prog/ant/issues/${301 + index}`,
    },
    acknowledgement: {
      status: "acknowledged",
      acknowledgedAt: "2026-07-01T12:00:00.000Z",
      evidence: `https://github.com/antoe-prog/ant/issues/${301 + index}#issuecomment-${9301 + index}`,
    },
  })),
};

await writeFile(receiptPath, `${JSON.stringify(completed, null, 2)}\n`);

const readyResult = await execFile(
  process.execPath,
  [
    "scripts/check-p1-handoff-issue-receipt.mjs",
    `--file=${receiptPath}`,
    `--issue-drafts=${issueDraftManifestPath}`,
    `--out=${path.join(directory, "issue-registration-ready-report.json")}`,
  ],
  { cwd: process.cwd() },
);
const readyReport = JSON.parse(readyResult.stdout);

assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert.equal(readyReport.summary.issueDrafts, expectedIssueCount);
assert.equal(readyReport.summary.registered, expectedIssueCount);
assert.equal(readyReport.summary.acknowledged, expectedIssueCount);

const looseTimestampReceipt = {
  ...completed,
  registrations: completed.registrations.map((registration, index) =>
    index === 0
      ? {
          ...registration,
          external: {
            ...registration.external,
            postedAt: "July 1, 2026 11:00",
          },
        }
      : registration,
  ),
};
await writeFile(receiptPath, `${JSON.stringify(looseTimestampReceipt, null, 2)}\n`);

let looseTimestampFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-handoff-issue-receipt.mjs",
      `--file=${receiptPath}`,
      `--issue-drafts=${issueDraftManifestPath}`,
      `--out=${path.join(directory, "issue-registration-loose-timestamp-report.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  looseTimestampFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_ISSUE_RECEIPT_POSTED_AT_INVALID"));
}

assert.equal(looseTimestampFailed, true, "issue registration receipt validator must reject non-ISO timestamps");

const secretReceipt = {
  ...completed,
  registrations: completed.registrations.map((registration, index) =>
    index === 0
      ? {
          ...registration,
          external: {
            ...registration.external,
            evidence: rawPaymentSecret,
          },
        }
      : registration,
  ),
};
await writeFile(receiptPath, `${JSON.stringify(secretReceipt, null, 2)}\n`);

let secretFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-handoff-issue-receipt.mjs",
      `--file=${receiptPath}`,
      `--issue-drafts=${issueDraftManifestPath}`,
      `--out=${path.join(directory, "issue-registration-secret-report.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  secretFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_ISSUE_RECEIPT_SECRET_LIKE_VALUE"));
}

assert.equal(secretFailed, true, "issue registration receipt validator must reject raw secret-like values");

await writeFile(receiptPath, `${JSON.stringify(completed, null, 2)}\n`);
await writeFile(path.join(readyIssuesDir, "02-mobile-release.md"), "# Tampered issue body\n");

let tamperFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-handoff-issue-receipt.mjs",
      `--file=${receiptPath}`,
      `--issue-drafts=${issueDraftManifestPath}`,
      `--out=${path.join(directory, "issue-registration-tamper-report.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  tamperFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_ISSUE_RECEIPT_DRAFT_HASH_MISMATCH"));
}

assert.equal(tamperFailed, true, "issue registration receipt validator must reject tampered issue draft bodies");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "blocked issue draft receipt warns not to publish external issues before dispatch acknowledgement",
        "blocked issue draft strict report keeps issue publication behind dispatch acknowledgement",
        "issue registration receipt draft is generated from ready issue drafts",
        "pending external registration fields keep the receipt blocked",
        "GitHub issue creation results can be applied into a strict-ready receipt",
        "GitHub issue creation results JSON rejects missing, duplicate, unknown, read-only mismatch, HTTP URL, pending acknowledgement, and invalid timing fixtures",
        "GitHub connector issue responses can be converted into results JSON and applied into a strict-ready receipt",
        "GitHub connector normalized issue snapshots derive issue URLs from API URLs and GraphQL-style fields",
        "GitHub connector issue responses reject missing acknowledgement evidence, HTTP evidence URLs, non-ISO timestamps, and invalid acknowledgement timing",
        "GitHub issue creation results CSV can be applied into a strict-ready receipt",
        "GitHub issue creation results CSV rejects template TODOs, duplicate/unknown rows, read-only mismatch, secrets, pending acknowledgement, HTTP URLs, non-ISO timestamps, and invalid acknowledgement timing",
        "completed GitHub/Slack-style registration receipt passes strict validation",
        "non-ISO timestamps inside registration receipt are rejected",
        "raw secret-like values inside registration receipt are rejected",
        "tampered issue draft body hashes are rejected",
      ],
      registrations: readyReport.summary.registrations,
      acknowledged: readyReport.summary.acknowledged,
    },
    null,
    2,
  ),
);
