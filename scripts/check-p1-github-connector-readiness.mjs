import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PLACEHOLDER_GITHUB_REPO,
  inferGitHubRepositoryFromOrigin,
  normalizeGitHubRepository,
} from "./lib/github-repository.mjs";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  if (exact) {
    return exact.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }

  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasPlaceholder(value) {
  return /\bTODO\b|<[^>]+>|미정|확인 필요/i.test(text(value));
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

function issueDraftByPackage(issueDrafts) {
  return new Map(asArray(issueDrafts.issueDrafts).map((issueDraft) => [issueDraft.packageDir, issueDraft]));
}

function normalizeLabels(value) {
  return [...asArray(value).map(text).filter(Boolean)].sort();
}

async function readOptionalJson(filePath, { required }) {
  try {
    return {
      json: JSON.parse(await readFile(filePath, "utf8")),
      path: path.relative(process.cwd(), filePath),
    };
  } catch (error) {
    if (!required && error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function repoMetadataFromReceipt(receipt) {
  return receipt?.repository ?? receipt?.result ?? receipt;
}

function validateIsoTimestamp(value, label) {
  assert(!hasPlaceholder(value), `${label} must be a real ISO timestamp`);
  assert(/^\d{4}-\d{2}-\d{2}T/.test(text(value)), `${label} must use ISO date-time format`);
  assert(Number.isFinite(Date.parse(value)), `${label} must be parseable`);
}

function validateConnectorRepoReceipt(receiptArtifact, expectedRepo) {
  const receipt = receiptArtifact.json;
  const repo = repoMetadataFromReceipt(receipt);
  const repoFullName = normalizeGitHubRepository(repo?.repository_full_name ?? repo?.full_name ?? repo?.fullName);
  const permissions = repo?.permissions ?? {};

  if (receipt?.schemaVersion !== undefined) {
    assert.equal(receipt.schemaVersion, 1, "GitHub connector access receipt schemaVersion must be 1");
  }

  if (receipt?.connector !== undefined) {
    assert.equal(
      receipt.connector,
      "mcp__codex_apps__github._get_repo",
      "GitHub connector access receipt must come from the _get_repo tool",
    );
  }

  if (receipt?.checkedAt !== undefined) {
    validateIsoTimestamp(receipt.checkedAt, "GitHub connector access receipt checkedAt");
  }

  assert.equal(repoFullName, expectedRepo, `GitHub connector access repo ${repoFullName} must match ${expectedRepo}`);
  assert.equal(repo?.clone_url, `https://github.com/${expectedRepo}.git`, "GitHub connector access clone_url must match repo");
  assert(text(repo?.default_branch), "GitHub connector access receipt must include default_branch");
  assert.notEqual(repo?.archived, true, "GitHub connector access repo must not be archived");
  assert.equal(permissions.pull, true, "GitHub connector access must include pull permission");
  assert(
    permissions.push === true || permissions.triage === true || permissions.maintain === true || permissions.admin === true,
    "GitHub connector access must include issue-capable permissions",
  );

  return {
    provided: true,
    path: receiptArtifact.path,
    connector: receipt?.connector ?? "unknown",
    checkedAt: receipt?.checkedAt ?? null,
    repositoryFullName: repoFullName,
    defaultBranch: repo.default_branch,
    permissions: {
      admin: permissions.admin === true,
      maintain: permissions.maintain === true,
      pull: permissions.pull === true,
      push: permissions.push === true,
      triage: permissions.triage === true,
    },
  };
}

function validateConnectorRunbook({ issuePayloads, issueDrafts, payloads, payloadRepo, runbookPath, source }) {
  const publishReadyText = payloads.publishReady ? "true" : "false";
  const publishGuard = payloads.publishReady ? "ready" : payloads.publishGuard;
  const runbookRelPath = path.relative(process.cwd(), runbookPath);

  assert(!hasSecretLikeSource(source), "GitHub connector runbook must not include raw secret-like values");
  assert(source.includes("# P1 GitHub Connector Runbook"), "GitHub connector runbook must include the expected title");
  assert(source.includes(`GitHub repo: \`${payloadRepo}\``), "GitHub connector runbook repo must match connector payload");
  assert(source.includes(`Publish ready: \`${publishReadyText}\``), "GitHub connector runbook publishReady must match connector payload");
  assert(source.includes(`Publish guard: \`${publishGuard}\``), "GitHub connector runbook publishGuard must match connector payload");
  assert(source.includes("github-connector-issue-payloads.json"), "GitHub connector runbook must point to connector payloads");
  assert(source.includes("github-connector-issue-responses.json"), "GitHub connector runbook must point to connector response target");
  assert(source.includes("github-issue-create-results"), "GitHub connector runbook must point to issue creation results");
  assert(source.includes("## Payload Rows"), "GitHub connector runbook must include payload row hashes");

  for (const issuePayload of issuePayloads) {
    assert(source.includes(text(issuePayload.packageDir)), `GitHub connector runbook must include package ${issuePayload.packageDir}`);
    assert(source.includes(text(issuePayload.bodySha256)), `GitHub connector runbook must include body hash for ${issuePayload.packageDir}`);
  }

  if (payloads.publishReady) {
    assert(source.includes("## Connector Steps"), "publish-ready GitHub connector runbook must include connector steps");
    assert(source.includes("mcp__codex_apps__github._create_issue"), "publish-ready runbook must name the connector issue tool");
    assert(
      source.includes("p1:handoff-issue-receipt:connector-results"),
      "publish-ready runbook must include connector results conversion command",
    );
    assert(source.includes("p1:handoff-issue-receipt -- --file"), "publish-ready runbook must include final receipt check command");
  } else {
    assert(source.includes("## Blocked State"), "blocked GitHub connector runbook must include blocked state guidance");
    assert(source.includes("Do not call the GitHub connector yet."), "blocked runbook must prevent connector calls");
  }

  assert.equal(
    asArray(issuePayloads).length,
    asArray(issueDrafts.issueDrafts).length,
    `GitHub connector runbook ${runbookRelPath} must cover every issue payload`,
  );

  return {
    path: runbookRelPath,
    publishReady: payloads.publishReady === true,
    publishGuard,
  };
}

const payloadPath = path.resolve(argValue("--payloads", ".data/p1-handoff-issue-drafts/github-connector-issue-payloads.json"));
const issueDraftsPath = path.resolve(argValue("--issue-drafts", ".data/p1-handoff-issue-drafts/issue-drafts.json"));
const runbookPath = path.resolve(
  argValue("--runbook", path.join(path.dirname(payloadPath), "github-connector-runbook.md")),
);
const connectorRepoReceiptArg = argValue("--connector-repo-receipt", "");
const connectorRepoReceiptPath = path.resolve(connectorRepoReceiptArg || ".data/p1-github-connector-access.json");
const connectorRepoReceiptRequired = Boolean(connectorRepoReceiptArg);
const outPath = argValue("--out", "");

const [payloads, issueDrafts, runbookSource, connectorRepoReceipt] = await Promise.all([
  readFile(payloadPath, "utf8").then(JSON.parse),
  readFile(issueDraftsPath, "utf8").then(JSON.parse),
  readFile(runbookPath, "utf8"),
  readOptionalJson(connectorRepoReceiptPath, { required: connectorRepoReceiptRequired }),
]);
const originRepo = await inferGitHubRepositoryFromOrigin();
const payloadRepo = normalizeGitHubRepository(payloads.githubRepo);
const localBlockers = [];
const checked = [
  "GitHub connector payload schema and tool name",
  "GitHub connector payload repository matches local origin",
  "issue draft manifest and connector payload publish state match",
  "each issue payload targets the connected repository",
  "blocked publish payload preserves operator guardrails",
];

assert.equal(payloads.schemaVersion, 1, "GitHub connector payload schemaVersion must be 1");
assert.equal(
  payloads.connector,
  "mcp__codex_apps__github._create_issue",
  "P1 handoff must target the GitHub connector issue creation tool",
);
assert(payloadRepo, "GitHub connector payload must include a valid githubRepo");
assert.notEqual(payloadRepo, PLACEHOLDER_GITHUB_REPO, "GitHub connector payload must not use a placeholder repository");
assert.equal(
  normalizeGitHubRepository(originRepo),
  payloadRepo,
  `GitHub connector payload repo ${payloadRepo} must match local origin ${originRepo}`,
);
assert.equal(
  payloads.publishReady,
  issueDrafts.publishReady,
  "GitHub connector payload publishReady must match issue draft manifest",
);
assert.equal(
  payloads.releaseDecision,
  issueDrafts.releaseDecision,
  "GitHub connector payload releaseDecision must match issue draft manifest",
);

const draftMap = issueDraftByPackage(issueDrafts);
const issuePayloads = asArray(payloads.issuePayloads);
assert(issuePayloads.length > 0, "GitHub connector payload must include issuePayloads");
assert.equal(issuePayloads.length, draftMap.size, "GitHub connector payload count must match issue draft count");

for (const issuePayload of issuePayloads) {
  const packageDir = text(issuePayload.packageDir);
  const draft = draftMap.get(packageDir);
  const createIssueInput = issuePayload.createIssueInput ?? {};

  assert(draft, `GitHub connector payload references unknown packageDir ${packageDir}`);
  assert.equal(createIssueInput.repository_full_name, payloadRepo, `${packageDir} must target ${payloadRepo}`);
  assert.equal(createIssueInput.title, draft.title, `${packageDir} title must match issue draft manifest`);
  assert.equal(issuePayload.bodyFile, draft.path, `${packageDir} bodyFile must match issue draft path`);
  assert.deepEqual(
    normalizeLabels(createIssueInput.labels),
    normalizeLabels(draft.labels),
    `${packageDir} labels must match issue draft labels`,
  );
  assert(text(createIssueInput.body).length > 200, `${packageDir} connector body must include the owner package brief`);

  if (payloads.publishReady) {
    for (const [field, value] of [
      ["assignedToName", issuePayload.assignedToName],
      ["assignedToContact", issuePayload.assignedToContact],
      ["dueAt", issuePayload.dueAt],
      ["body", createIssueInput.body],
    ]) {
      assert(!hasPlaceholder(value), `${packageDir} publish-ready payload must not include placeholder ${field}`);
    }
  }
}

if (payloads.publishReady) {
  assert.equal(payloads.releaseDecision, "ready", "publish-ready connector payload must have ready releaseDecision");
  assert(!payloads.publishGuard, "publish-ready connector payload must not include a publishGuard");
} else {
  assert.notEqual(payloads.releaseDecision, "ready", "blocked connector payload must not report ready releaseDecision");
  assert(payloads.publishGuard, "blocked connector payload must include a publishGuard");
  assert(
    asArray(payloads.instructions).some((instruction) => text(instruction).includes("아직 호출하지 않습니다")),
    "blocked connector payload must warn operators not to call the GitHub connector yet",
  );
  localBlockers.push({
    code: "P1_GITHUB_CONNECTOR_PUBLISH_BLOCKED",
    message: "GitHub connector payload is wired to the repo, but dispatch owner assignment and acknowledgement evidence are still pending.",
    detail: {
      publishGuard: payloads.publishGuard,
      issueDraftBlockers: asArray(issueDrafts.blockers).length,
    },
  });
}

const runbook = validateConnectorRunbook({
  issuePayloads,
  issueDrafts,
  payloads,
  payloadRepo,
  runbookPath,
  source: runbookSource,
});
checked.push("GitHub connector runbook matches payload publish state, repo, response targets, and body hashes");

const connectorAccess = connectorRepoReceipt
  ? validateConnectorRepoReceipt(connectorRepoReceipt, payloadRepo)
  : {
      provided: false,
      path: path.relative(process.cwd(), connectorRepoReceiptPath),
      nextAction:
        "GitHub connector _get_repo 출력을 이 receipt 경로에 저장한 뒤 --connector-repo-receipt로 다시 실행해 live connector access를 검증합니다.",
    };

if (connectorRepoReceipt) {
  checked.push("GitHub connector _get_repo access receipt");
}

const nextActions = payloads.publishReady
  ? [
      "GitHub connector create issue tool을 issuePayloads[].createIssueInput으로 호출합니다.",
      "connector 응답을 github-connector-issue-responses.json에 저장하고 p1:handoff-issue-receipt:connector-results를 실행합니다.",
    ]
  : [
      ".data/p1-handoff-dispatch-receipt.csv에 실제 owner, delivery, due date, assignment evidence, acknowledgement evidence를 채웁니다.",
      "publishReady=true가 될 때까지 p1:handoff-dispatch:apply-csv, p1:handoff-dispatch, p1:handoff-issues:draft를 다시 실행합니다.",
    ];
assert(
  nextActions.every((action) => !/^(Use|Save|Complete|Run)\b/.test(action)),
  "GitHub connector readiness nextActions must use Korean operator guidance",
);
checked.push("GitHub connector readiness next actions use Korean operator guidance");

const report = {
  ok: true,
  checked,
  payloads: path.relative(process.cwd(), payloadPath),
  issueDrafts: path.relative(process.cwd(), issueDraftsPath),
  runbook,
  githubRepo: payloadRepo,
  localOriginRepo: originRepo,
  connectorAccess,
  publishReady: payloads.publishReady === true,
  releaseDecision: payloads.releaseDecision,
  issuePayloads: issuePayloads.length,
  blockers: localBlockers,
  nextActions,
};

if (outPath) {
  await writeFile(path.resolve(outPath), `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
