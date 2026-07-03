import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const issueDraftsPath = path.resolve(args.issueDrafts ?? ".data/p1-handoff-issue-drafts/issue-drafts.json");
const responsesPath = path.resolve(args.responses ?? ".data/p1-handoff-issue-drafts/github-connector-issue-responses.json");
const outPath = path.resolve(args.out ?? ".data/p1-handoff-issue-drafts/github-issue-create-results.json");

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
  return !text(value) || /TODO|TBD|placeholder|example|sample|yyyy|미정|예시|샘플|<[^>]+>/i.test(text(value));
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

function parseJson(source, blockers, label, filePath) {
  try {
    return JSON.parse(source);
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_JSON_INVALID", `${label} must be valid JSON.`, {
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
      addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_SECRET_LIKE_VALUE", `${label} must not include raw secret-like values.`, {
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
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_FILE_UNREADABLE", `${label} must be readable.`, {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return { buffer: Buffer.from(""), json: null, path: rel(filePath), sha256: null, sizeBytes: 0 };
  }
}

function responseRows(document) {
  if (Array.isArray(document)) {
    return document;
  }

  for (const key of ["responses", "issues", "createdIssues", "results", "registrations"]) {
    if (Array.isArray(document?.[key])) {
      return document[key];
    }
  }

  return document && typeof document === "object" ? [document] : [];
}

function unwrapIssue(row) {
  return row?.issue ?? row?.data ?? row?.result ?? row?.external ?? row;
}

function labelsFromIssue(issue) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : Array.isArray(issue?.labels?.nodes) ? issue.labels.nodes : [];

  if (!Array.isArray(labels)) {
    return [];
  }

  return labels.map((label) => text(label?.name ?? label)).filter(Boolean);
}

function assigneeFromIssue(issue, issueDraft) {
  const assignees = Array.isArray(issue?.assignees)
    ? issue.assignees
    : Array.isArray(issue?.assignees?.nodes)
      ? issue.assignees.nodes
      : [];
  const assignee = assignees.map((item) => text(item?.login ?? item?.name ?? item)).find(Boolean);

  return assignee || text(issue?.assignee?.login ?? issue?.assignee) || text(issueDraft.assignedToContact) || text(issueDraft.assignedToName);
}

function issueTitle(issue) {
  return text(issue?.title ?? issue?.display_title ?? issue?.displayTitle ?? issue?.name);
}

function issueNumber(issue) {
  const explicit = text(issue?.number ?? issue?.issue_number ?? issue?.issueNumber);
  if (explicit) {
    return explicit;
  }

  const url = text(
    issue?.html_url ??
      issue?.htmlUrl ??
      issue?.display_url ??
      issue?.displayUrl ??
      issue?.web_url ??
      issue?.webUrl ??
      issue?.permalink ??
      issue?.browser_url ??
      issue?.browserUrl ??
      issue?.external_url ??
      issue?.externalUrl ??
      issue?.issue_url ??
      issue?.issueUrl ??
      issue?.url,
  );
  const urlMatch = url.match(/\/issues\/(\d+)(?:[#/?]|$)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  const id = text(issue?.id);
  return /^\d+$/.test(id) ? id : "";
}

function issueUrl(issue, githubRepo) {
  const directUrl = text(
    issue?.html_url ??
      issue?.htmlUrl ??
      issue?.display_url ??
      issue?.displayUrl ??
      issue?.web_url ??
      issue?.webUrl ??
      issue?.permalink ??
      issue?.browser_url ??
      issue?.browserUrl ??
      issue?.external_url ??
      issue?.externalUrl ??
      issue?.issue_url ??
      issue?.issueUrl,
  );
  if (directUrl) {
    return directUrl;
  }

  const url = text(issue?.url);
  if (url.startsWith("https://github.com/")) {
    return url;
  }

  const apiIssueMatch = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)(?:[#/?]|$)/);
  if (apiIssueMatch) {
    return `https://github.com/${apiIssueMatch[1]}/issues/${apiIssueMatch[2]}`;
  }

  const number = issueNumber(issue);
  const repo =
    text(githubRepo) ||
    text(
      issue?.repository_full_name ??
        issue?.repositoryFullName ??
        issue?.repository?.full_name ??
        issue?.repository?.fullName ??
        issue?.repository?.nameWithOwner,
    );
  if (number && repo && !hasPlaceholder(repo)) {
    return `https://github.com/${repo}/issues/${number}`;
  }

  return "";
}

async function githubRepoFromConnectorPayload(issueDrafts) {
  const payloadPath = text(issueDrafts?.githubIssueConnectorPayloads);
  if (!payloadPath) {
    return "";
  }

  try {
    const payload = JSON.parse(await readFile(path.resolve(payloadPath), "utf8"));
    return text(payload.githubRepo) || text(payload.issuePayloads?.[0]?.createIssueInput?.repository_full_name);
  } catch {
    return "";
  }
}

function findResponse(issueDraft, responses, usedIndexes) {
  const candidates = responses.map((row, index) => ({ index, issue: unwrapIssue(row), row }));

  for (const candidate of candidates) {
    if (usedIndexes.has(candidate.index)) {
      continue;
    }

    if (issueTitle(candidate.issue) === text(issueDraft.title)) {
      usedIndexes.add(candidate.index);
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (usedIndexes.has(candidate.index)) {
      continue;
    }

    if (text(candidate.row?.packageDir) === text(issueDraft.packageDir)) {
      usedIndexes.add(candidate.index);
      return candidate;
    }
  }

  return null;
}

function acknowledgementFromResponse(row, issue) {
  const acknowledgement = row?.acknowledgement ?? issue?.acknowledgement ?? {};
  const status =
    text(
      acknowledgement.status ??
        row?.acknowledgementStatus ??
        row?.acknowledgement_status ??
        issue?.acknowledgementStatus ??
        args.acknowledgementStatus,
    ) || "pending";

  return {
    status: status.toLowerCase(),
    acknowledgedAt: text(
      acknowledgement.acknowledgedAt ??
        acknowledgement.acknowledged_at ??
        row?.acknowledgedAt ??
        row?.acknowledged_at ??
        issue?.acknowledgedAt ??
        args.acknowledgedAt,
    ),
    evidence: text(
      acknowledgement.evidence ??
        acknowledgement.url ??
        row?.acknowledgementEvidence ??
        row?.acknowledgement_evidence ??
        issue?.acknowledgementEvidence ??
        args.acknowledgementEvidence,
    ),
  };
}

function postedAtFromResponse(row, issue) {
  return (
    text(issue?.created_at ?? issue?.createdAt) ||
    text(row?.postedAt ?? row?.posted_at ?? row?.created_at ?? row?.createdAt) ||
    text(args.postedAt) ||
    new Date().toISOString()
  );
}

function postedByFromResponse(row, issue) {
  return (
    text(issue?.user?.login ?? issue?.author?.login) ||
    text(row?.postedBy ?? row?.posted_by ?? row?.user?.login ?? row?.author?.login) ||
    text(args.postedBy) ||
    "GitHub connector"
  );
}

function validateHttps(
  value,
  blockers,
  packageDir,
  field,
  code = "P1_HANDOFF_ISSUE_CONNECTOR_URL_INVALID",
  label = "Connector issue URL",
) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:") {
      addBlocker(blockers, code, `${label} must use HTTPS.`, {
        packageDir,
        field,
        value,
      });
    }
  } catch {
    addBlocker(blockers, code, `${label} must be parseable.`, {
      packageDir,
      field,
      value,
    });
  }
}

function validateTimestamp(value, blockers, packageDir, field, code) {
  if (hasPlaceholder(value)) {
    addBlocker(blockers, code, "Connector timestamps must use real ISO timestamps.", {
      packageDir,
      field,
    });
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(text(value))) {
    addBlocker(blockers, code, "Connector timestamps must use ISO date-time format.", {
      packageDir,
      field,
      value,
    });
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addBlocker(blockers, code, "Connector timestamps must be parseable ISO timestamps.", {
      packageDir,
      field,
      value,
    });
    return null;
  }

  return parsed;
}

function validateConnectorRegistration(registration, blockers) {
  const packageDir = registration.packageDir;
  const postedAt = validateTimestamp(
    registration.postedAt,
    blockers,
    packageDir,
    "postedAt",
    "P1_HANDOFF_ISSUE_CONNECTOR_POSTED_AT_INVALID",
  );
  const acknowledgement = registration.acknowledgement ?? {};

  if (!["pending", "acknowledged"].includes(acknowledgement.status)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_ACK_STATUS_INVALID", "Connector acknowledgement status must be pending or acknowledged.", {
      packageDir,
      status: acknowledgement.status ?? null,
    });
    return;
  }

  if (acknowledgement.status !== "acknowledged") {
    return;
  }

  if (hasPlaceholder(acknowledgement.evidence)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_ACK_EVIDENCE_MISSING", "Connector acknowledged rows must include owner acknowledgement evidence.", {
      packageDir,
    });
  } else {
    validateHttps(
      acknowledgement.evidence,
      blockers,
      packageDir,
      "acknowledgement.evidence",
      "P1_HANDOFF_ISSUE_CONNECTOR_ACK_EVIDENCE_INVALID",
      "Connector acknowledgement evidence URL",
    );
  }

  const acknowledgedAt = validateTimestamp(
    acknowledgement.acknowledgedAt,
    blockers,
    packageDir,
    "acknowledgement.acknowledgedAt",
    "P1_HANDOFF_ISSUE_CONNECTOR_ACK_AT_INVALID",
  );

  if (postedAt !== null && acknowledgedAt !== null && acknowledgedAt < postedAt) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_ACK_BEFORE_POST", "Connector acknowledgement time must be after posting time.", {
      packageDir,
    });
  }
}

const blockers = [];
const issueDraftsArtifact = await readJsonArtifact(issueDraftsPath, blockers, "P1 handoff issue draft manifest");
const responsesArtifact = await readJsonArtifact(responsesPath, blockers, "GitHub connector issue responses");
const issueDrafts = issueDraftsArtifact.json ?? {};
const responses = responseRows(responsesArtifact.json);
const githubRepo =
  text(args.githubRepo) ||
  text(responsesArtifact.json?.githubRepo) ||
  text(responsesArtifact.json?.repository_full_name) ||
  (await githubRepoFromConnectorPayload(issueDrafts));

if (issueDrafts.releaseDecision !== "ready") {
  addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_DRAFTS_NOT_READY", "Connector responses can only be applied to ready issue drafts.", {
    releaseDecision: issueDrafts.releaseDecision ?? null,
  });
}

if (!Array.isArray(issueDrafts.issueDrafts) || issueDrafts.issueDrafts.length === 0) {
  addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_DRAFTS_EMPTY", "Issue draft manifest must include issueDrafts.");
}

const usedIndexes = new Set();
const registrations = [];

for (const issueDraft of issueDrafts.issueDrafts ?? []) {
  const match = findResponse(issueDraft, responses, usedIndexes);

  if (!match) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_RESPONSE_MISSING", "Every issue draft must have a matching connector response.", {
      packageDir: issueDraft.packageDir,
      title: issueDraft.title,
    });
    continue;
  }

  const issue = match.issue;
  const url = issueUrl(issue, githubRepo);
  const id = issueNumber(issue);

  if (hasPlaceholder(url)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_URL_MISSING", "Connector response must include or derive the GitHub issue URL.", {
      packageDir: issueDraft.packageDir,
      title: issueDraft.title,
    });
  } else {
    validateHttps(url, blockers, issueDraft.packageDir, "url");
  }

  if (hasPlaceholder(id)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_ID_MISSING", "Connector response must include an issue number or id.", {
      packageDir: issueDraft.packageDir,
      title: issueDraft.title,
    });
  }

  const acknowledgement = acknowledgementFromResponse(match.row, issue);
  const postedAt = postedAtFromResponse(match.row, issue);
  const postedBy = postedByFromResponse(match.row, issue);

  const registration = {
    packageDir: issueDraft.packageDir,
    title: issueDraft.title,
    issueDraft: {
      path: issueDraft.path,
    },
    external: {
      system: "GitHub issue",
      url: url || "TODO GitHub issue URL",
      id: id || "TODO issue number",
      assignee: assigneeFromIssue(issue, issueDraft) || "TODO external assignee",
      labels: labelsFromIssue(issue).length > 0 ? labelsFromIssue(issue) : issueDraft.labels ?? [],
      evidence: url || "TODO permalink or screenshot evidence",
    },
    postedAt,
    postedBy,
    acknowledgement: {
      status: acknowledgement.status,
      acknowledgedAt: acknowledgement.acknowledgedAt || "TODO ISO timestamp",
      evidence: acknowledgement.evidence || "TODO owner acknowledgement permalink",
    },
  };

  validateConnectorRegistration(registration, blockers);
  registrations.push(registration);
}

for (let index = 0; index < responses.length; index += 1) {
  if (!usedIndexes.has(index)) {
    const issue = unwrapIssue(responses[index]);
    addBlocker(blockers, "P1_HANDOFF_ISSUE_CONNECTOR_RESPONSE_UNKNOWN", "Connector responses must not contain unmatched issues.", {
      index,
      title: issue?.title ?? null,
      url: issueUrl(issue, githubRepo) || null,
    });
  }
}

const registered = registrations.filter((registration) => !hasPlaceholder(registration.external.url)).length;
const acknowledged = registrations.filter((registration) => registration.acknowledgement.status === "acknowledged").length;
const releaseDecision =
  blockers.length === 0 && registered === registrations.length && acknowledged === registrations.length ? "ready" : "blocked";
const results = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  releaseDecision,
  source: "github-connector",
  connector: "mcp__codex_apps__github._create_issue",
  githubRepo: githubRepo || null,
  system: "GitHub issue",
  postedBy: registrations[0]?.postedBy ?? "GitHub connector",
  postedAt: registrations[0]?.postedAt ?? new Date().toISOString(),
  sourceArtifacts: {
    issueDrafts: {
      path: rel(issueDraftsPath),
      sha256: issueDraftsArtifact.sha256,
      sizeBytes: issueDraftsArtifact.sizeBytes,
    },
    responses: {
      path: rel(responsesPath),
      sha256: responsesArtifact.sha256,
      sizeBytes: responsesArtifact.sizeBytes,
    },
  },
  registrations: registrations.map((registration) => ({
    packageDir: registration.packageDir,
    title: registration.title,
    issueDraft: registration.issueDraft,
    external: {
      ...registration.external,
      postedAt: registration.postedAt,
      postedBy: registration.postedBy,
    },
    acknowledgement: registration.acknowledgement,
  })),
  summary: {
    issueDrafts: Array.isArray(issueDrafts.issueDrafts) ? issueDrafts.issueDrafts.length : 0,
    connectorResponses: responses.length,
    registered,
    acknowledged,
  },
  nextActions:
    releaseDecision === "ready"
      ? [
          `Run \`npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=${rel(issueDraftsPath)} --results=${rel(outPath)} --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md\`.`,
        ]
      : [
          "Add owner acknowledgement status, acknowledgedAt, and acknowledgement evidence after the GitHub issues are reviewed by each owner.",
          "Fix any connector response mismatch blockers, rerun this command, then apply the generated results JSON.",
        ],
};

if (blockers.length === 0) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`);
}

const report = {
  ok: blockers.length === 0,
  releaseDecision,
  generatedAt: new Date().toISOString(),
  checked: [
    "GitHub connector issue responses are parsed",
    "connector response titles or packageDir values match the issue draft manifest",
    "GitHub issue URLs, numbers, assignees, labels, postedAt, and postedBy are normalized",
    "owner acknowledgement fields are preserved for strict receipt validation",
    "raw secret-like values are not written to generated results",
  ],
  artifacts: {
    issueDrafts: { path: rel(issueDraftsPath), sha256: issueDraftsArtifact.sha256, sizeBytes: issueDraftsArtifact.sizeBytes },
    responses: { path: rel(responsesPath), sha256: responsesArtifact.sha256, sizeBytes: responsesArtifact.sizeBytes },
    out: { path: rel(outPath), written: blockers.length === 0 },
  },
  summary: results.summary,
  nextActions: results.nextActions,
  blockers,
};

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
