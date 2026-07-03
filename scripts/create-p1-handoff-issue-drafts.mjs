import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveGitHubRepository } from "./lib/github-repository.mjs";

const args = parseArgs(process.argv.slice(2));
const receiptPath = path.resolve(args.receipt ?? ".data/p1-handoff-dispatch-receipt.json");
const outDir = path.resolve(args.outDir ?? ".data/p1-handoff-issue-drafts");
const githubRepo = await resolveGitHubRepository(args.githubRepo, { env: process.env });

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
  return typeof value === "string" ? value.trim() : "";
}

function packageName(packageDir) {
  return path.basename(packageDir);
}

function hasPlaceholder(value) {
  return !text(value) || /TODO|TBD|placeholder|example|sample|yyyy|미정|예시|샘플|<[^>]+>/i.test(text(value));
}

function shellQuote(value) {
  return `'${text(value).replace(/'/g, "'\"'\"'")}'`;
}

function csvEscape(value) {
  const source = text(value);

  if (/[",\n\r]/.test(source)) {
    return `"${source.replace(/"/g, '""')}"`;
  }

  return source;
}

function markdownCell(value) {
  return text(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
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

function parseJson(source, blockers, label, filePath) {
  try {
    return JSON.parse(source);
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_DRAFT_JSON_INVALID", `${label} must be valid JSON.`, {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function readReceipt(blockers) {
  try {
    const source = await readFile(receiptPath, "utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_DRAFT_SECRET_LIKE_VALUE", "Dispatch receipt must not include raw secret-like values.", {
        path: rel(receiptPath),
      });
      return null;
    }

    return parseJson(source, blockers, "P1 handoff dispatch receipt", receiptPath);
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_DRAFT_RECEIPT_MISSING", "Dispatch receipt must exist before creating issue drafts.", {
      path: rel(receiptPath),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function validateReceipt(receipt, blockers) {
  if (!receipt) {
    return;
  }

  if (receipt.bundleManifest?.releaseDecision !== "ready") {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_DRAFT_BUNDLE_NOT_READY", "Issue drafts require a ready handoff bundle.", {
      releaseDecision: receipt.bundleManifest?.releaseDecision ?? null,
    });
  }

  if (!Array.isArray(receipt.ownerPackages) || receipt.ownerPackages.length === 0) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_DRAFT_OWNER_PACKAGE_COUNT", "Issue drafts require owner packages.", {
      count: Array.isArray(receipt.ownerPackages) ? receipt.ownerPackages.length : null,
    });
    return;
  }

  for (const ownerPackage of receipt.ownerPackages) {
    const packageDir = ownerPackage.packageDir;

    for (const [field, value] of Object.entries({
      assignedToName: ownerPackage.assignment?.assignedToName,
      assignedToContact: ownerPackage.assignment?.assignedToContact,
      channel: ownerPackage.assignment?.channel,
      dueAt: ownerPackage.assignment?.dueAt,
      assignmentEvidence: ownerPackage.assignment?.evidence,
      acknowledgementEvidence: ownerPackage.acknowledgement?.evidence,
    })) {
      if (hasPlaceholder(value)) {
        addBlocker(blockers, "P1_HANDOFF_ISSUE_DRAFT_ASSIGNMENT_PENDING", "Owner issue drafts are publishable only after real assignment and acknowledgement fields are filled.", {
          packageDir,
          field,
        });
      }
    }

    if (ownerPackage.acknowledgement?.status !== "acknowledged") {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_DRAFT_ACK_PENDING", "Owner acknowledgement must be complete before publishing issue drafts.", {
        packageDir,
        status: ownerPackage.acknowledgement?.status ?? null,
      });
    }

    if (!Array.isArray(ownerPackage.strictCommands) || ownerPackage.strictCommands.length === 0) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_DRAFT_STRICT_COMMAND_MISSING", "Owner issue drafts must include strict validation commands.", {
        packageDir,
      });
    }
  }
}

function createIssueBody(ownerPackage) {
  const name = packageName(ownerPackage.packageDir);
  const title = `[P1 Handoff] ${ownerPackage.ownerRole} - ${name}`;
  const strictCommands = ownerPackage.strictCommands?.length
    ? ownerPackage.strictCommands.map((command) => `- \`${command}\``).join("\n")
    : "- TODO strict command";
  const body = [
    `# ${title}`,
    "",
    "## Owner",
    "",
    `- Role: ${ownerPackage.ownerRole}`,
    `- Assignee: ${ownerPackage.assignment?.assignedToName ?? "TODO real owner name"}`,
    `- Contact: ${ownerPackage.assignment?.assignedToContact ?? "TODO owner contact"}`,
    `- Delivery channel: ${ownerPackage.assignment?.channel ?? "TODO delivery channel"}`,
    `- Due: ${ownerPackage.assignment?.dueAt ?? "TODO ISO timestamp"}`,
    `- Assignment evidence: ${ownerPackage.assignment?.evidence ?? "TODO assignment evidence"}`,
    `- Acknowledgement: ${ownerPackage.acknowledgement?.status ?? "pending"} at ${ownerPackage.acknowledgement?.acknowledgedAt ?? "TODO ISO timestamp"}`,
    `- Acknowledgement evidence: ${ownerPackage.acknowledgement?.evidence ?? "TODO acknowledgement evidence"}`,
    "",
    "## Package",
    "",
    `- Package dir: \`${ownerPackage.packageDir}\``,
    `- Actions: ${ownerPackage.totalActions}`,
    `- Package manifest SHA-256: \`${ownerPackage.packageManifestSha256}\``,
    `- Package manifest size: ${ownerPackage.packageManifestSizeBytes} bytes`,
    "",
    "## Required Strict Commands",
    "",
    strictCommands,
    "",
    "## Done When",
    "",
    "- [ ] `evidence-draft.json` has been filled with real operational evidence.",
    "- [ ] The strict command above has been run and the report artifact is attached.",
    "- [ ] Any remaining blockers have a named owner, due date, and mitigation.",
    "- [ ] Product Lead/QA has verified the resulting report path and hash before P1 readiness.",
    "",
  ].join("\n");

  return {
    body,
    fileName: `${name}.md`,
    labels: ["p1", "handoff", "pilot-release", name],
    title,
  };
}

function createIndex(issueDrafts, receipt, releaseDecision) {
  const lines = [
    "# P1 Handoff Issue Draft Index",
    "",
    `- Receipt: \`${rel(receiptPath)}\``,
    `- Bundle manifest: \`${receipt.bundleManifest?.path ?? ""}\``,
    `- Draft decision: \`${releaseDecision}\``,
    `- Owner packages: ${issueDrafts.length}`,
    "",
    "| Issue draft | Owner role | Actions | Assignee | Contact | Channel | Due |",
    "| --- | --- | ---: | --- | --- | --- | --- |",
  ];

  for (const issueDraft of issueDrafts) {
    lines.push(
      `| [${issueDraft.fileName}](./${issueDraft.fileName}) | ${issueDraft.ownerRole} | ${issueDraft.totalActions} | ${issueDraft.assignedToName} | ${issueDraft.assignedToContact} | ${issueDraft.channel} | ${issueDraft.dueAt} |`,
    );
  }

  lines.push("", "These files are local publish drafts only. Review before posting to GitHub, Slack, or Drive.", "");

  return `${lines.join("\n")}\n`;
}

const blockers = [];
const receipt = await readReceipt(blockers);

validateReceipt(receipt, blockers);

if (blockers.some((blocker) => blocker.code === "P1_HANDOFF_ISSUE_DRAFT_SECRET_LIKE_VALUE")) {
  const report = {
    ok: false,
    releaseDecision: "blocked",
    generatedAt: new Date().toISOString(),
    receipt: rel(receiptPath),
    issueDraftsDir: rel(outDir),
    checked: ["dispatch receipt does not include raw secret-like values"],
    summary: { issueDrafts: 0 },
    blockers,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const issueDrafts = (receipt?.ownerPackages ?? []).map((ownerPackage) => {
  const issueDraft = createIssueBody(ownerPackage);
  return {
    ...issueDraft,
    assignedToName: ownerPackage.assignment?.assignedToName ?? "",
    assignedToContact: ownerPackage.assignment?.assignedToContact ?? "",
    channel: ownerPackage.assignment?.channel ?? "",
    dueAt: ownerPackage.assignment?.dueAt ?? "",
    ownerRole: ownerPackage.ownerRole ?? "",
    packageDir: ownerPackage.packageDir ?? "",
    packageManifestSha256: ownerPackage.packageManifestSha256 ?? "",
    strictCommands: ownerPackage.strictCommands ?? [],
    totalActions: ownerPackage.totalActions ?? 0,
  };
});

function createIssueDraftSummary(issueDraft) {
  return {
    assignedToContact: issueDraft.assignedToContact,
    assignedToName: issueDraft.assignedToName,
    channel: issueDraft.channel,
    dueAt: issueDraft.dueAt,
    fileName: issueDraft.fileName,
    labels: issueDraft.labels,
    ownerRole: issueDraft.ownerRole,
    packageDir: issueDraft.packageDir,
    packageManifestSha256: issueDraft.packageManifestSha256,
    path: rel(path.join(outDir, issueDraft.fileName)),
    strictCommands: issueDraft.strictCommands,
    title: issueDraft.title,
    totalActions: issueDraft.totalActions,
  };
}

function ghCreateCommand(issueDraft) {
  const labelArgs = issueDraft.labels.map((label) => `--label ${shellQuote(label)}`).join(" ");

  return [
    "gh issue create",
    `--repo ${shellQuote(githubRepo)}`,
    `--title ${shellQuote(issueDraft.title)}`,
    `--body-file ${shellQuote(rel(path.join(outDir, issueDraft.fileName)))}`,
    labelArgs,
  ]
    .filter(Boolean)
    .join(" ");
}

function isPublishReady(releaseDecision) {
  return releaseDecision === "ready" && !hasPlaceholder(githubRepo);
}

function createGithubCommands(issueDrafts, releaseDecision) {
  const publishReady = isPublishReady(releaseDecision);
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    `# Generated by scripts/create-p1-handoff-issue-drafts.mjs`,
    `# Issue draft decision: ${releaseDecision}`,
    `# GitHub repo: ${githubRepo}`,
    `# Publish ready: ${publishReady ? "true" : "false"}`,
  ];

  if (hasPlaceholder(githubRepo)) {
    lines.push("# 실행 전 TODO_OWNER/TODO_REPO를 바꾸거나, GITHUB_REPOSITORY를 설정하거나, GitHub origin remote를 추가하거나, --github-repo=<owner/repo>로 다시 실행합니다.");
  }

  if (!publishReady) {
    lines.push(
      "",
      "echo 'P1 handoff issue draft는 아직 publishReady=false입니다. 외부 이슈를 만들기 전에 dispatch receipt의 담당자, 채널, due date, acknowledgement 필드를 먼저 채웁니다.' >&2",
      "exit 1",
      "",
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "command -v gh >/dev/null 2>&1 || { echo 'GitHub CLI gh is required.' >&2; exit 1; }", "");

  for (const issueDraft of issueDrafts) {
    lines.push(`echo "Creating ${issueDraft.title}"`);
    lines.push(ghCreateCommand(issueDraft));
    lines.push("");
  }

  lines.push(
    "echo '생성 후 각 issue URL을 github-issue-create-results.csv 또는 github-issue-create-results.json에 옮기고 results apply를 실행한 뒤 npm run p1:handoff-issue-receipt를 다시 실행합니다.'",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function createRegistrationPlan(
  issueDrafts,
  commandsPath,
  connectorPayloadPath,
  connectorResponsesTemplatePath,
  resultsTemplatePath,
  resultsCsvTemplatePath,
  releaseDecision,
) {
  const publishReady = isPublishReady(releaseDecision);
  const nextActions = publishReady
    ? [
        "모든 draft를 검토한 뒤 생성된 GitHub CLI command file을 실행하거나 GitHub connector payload JSON을 사용합니다.",
        "생성된 GitHub issue URL, issue number, assignee, posting evidence, owner acknowledgement evidence를 CSV template에서 만든 `github-issue-create-results.csv`에 채웁니다. 구조화된 연동이 이미 JSON을 내보내면 JSON template을 사용합니다.",
        "`npm run p1:handoff-issue-receipt:apply-results-csv -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --csv=.data/p1-handoff-issue-drafts/github-issue-create-results.csv --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md`를 실행합니다.",
        "`npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --results=.data/p1-handoff-issue-drafts/github-issue-create-results.json --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md`를 실행합니다.",
        "최종 P1 readiness 전에 `npm run p1:handoff-issue-receipt -- --file=.data/p1-handoff-issue-registration-receipt.json --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-report.json`를 실행합니다.",
      ]
    : [
        hasPlaceholder(githubRepo)
          ? "이슈 발행 전 `--github-repo=<owner/repo>`, `GITHUB_REPOSITORY`, 또는 GitHub `git remote origin`을 설정합니다."
          : "생성된 GitHub CLI command file 또는 connector payload는 아직 발행하지 않습니다.",
        "`p1-handoff-dispatch-receipt.json`에 실제 owner assignment, delivery channel, due date, assignment evidence, acknowledgement evidence를 채웁니다.",
        "외부 이슈를 만들기 전에 `npm run p1:handoff-issues:draft -- --receipt=.data/p1-handoff-dispatch-receipt.json --out-dir=.data/p1-handoff-issue-drafts`를 다시 실행하고 `publishReady=true`를 확인합니다.",
      ];

  return {
    generatedAt: new Date().toISOString(),
    releaseDecision,
    githubRepo,
    publishReady,
    publishGuard: publishReady ? "ready" : "blocked_until_dispatch_receipt_ready",
    commands: {
      githubCli: rel(commandsPath),
      githubConnectorPayloads: rel(connectorPayloadPath),
      githubConnectorResponsesTemplate: rel(connectorResponsesTemplatePath),
      githubResultsTemplate: rel(resultsTemplatePath),
      githubResultsCsvTemplate: rel(resultsCsvTemplatePath),
    },
    nextActions,
    issueDrafts: issueDrafts.map((issueDraft) => ({
      title: issueDraft.title,
      ownerRole: issueDraft.ownerRole,
      packageDir: issueDraft.packageDir,
      bodyFile: rel(path.join(outDir, issueDraft.fileName)),
      labels: issueDraft.labels,
      ghCommand: ghCreateCommand(issueDraft),
    })),
  };
}

function createGithubConnectorPayloads(
  issueDrafts,
  connectorPayloadPath,
  connectorResponsesTemplatePath,
  resultsTemplatePath,
  resultsCsvTemplatePath,
  releaseDecision,
) {
  const publishReady = isPublishReady(releaseDecision);
  const instructions = publishReady
    ? [
        "GitHub CLI를 사용할 수 없고 GitHub connector가 연결되어 있을 때 이 파일을 사용합니다.",
        "외부 GitHub issue를 만들기 전에 모든 issue body를 검토합니다.",
        "각 issuePayloads row마다 createIssueInput으로 connector를 호출합니다.",
        `생성 후 connector 응답을 ${rel(connectorResponsesTemplatePath).replace(/\.template\.json$/, ".json")}에 붙여 넣고 \`npm run p1:handoff-issue-receipt:connector-results\`를 실행하거나, issue URL과 acknowledgement evidence를 ${rel(resultsCsvTemplatePath).replace(/\.template\.csv$/, ".csv")} / ${rel(resultsTemplatePath).replace(/\.template\.json$/, ".json")}에 옮깁니다.`,
        "이후 `npm run p1:handoff-issue-receipt:apply-results-csv` 또는 `npm run p1:handoff-issue-receipt:apply-results`를 실행하고, 마지막으로 `npm run p1:handoff-issue-receipt`를 실행합니다.",
      ]
    : [
        "이 payload로 GitHub connector를 아직 호출하지 않습니다.",
        "source dispatch receipt가 아직 blocked 상태이거나 GitHub repository가 placeholder입니다.",
        "owner assignment, delivery, due date, acknowledgement evidence를 채운 뒤 이 payload를 재생성하고 publishReady=true를 확인합니다.",
      ];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseDecision,
    githubRepo,
    publishReady,
    publishGuard: publishReady ? "ready" : "blocked_until_dispatch_receipt_ready",
    connector: "mcp__codex_apps__github._create_issue",
    instructions,
    outputs: {
      connectorPayloads: rel(connectorPayloadPath),
      connectorResponsesTemplate: rel(connectorResponsesTemplatePath),
      resultsTemplate: rel(resultsTemplatePath),
      resultsCsvTemplate: rel(resultsCsvTemplatePath),
    },
    issuePayloads: issueDrafts.map((issueDraft) => {
      const bodyFile = rel(path.join(outDir, issueDraft.fileName));

      return {
        packageDir: issueDraft.packageDir,
        ownerRole: issueDraft.ownerRole,
        assignedToName: issueDraft.assignedToName,
        assignedToContact: issueDraft.assignedToContact,
        dueAt: issueDraft.dueAt,
        bodyFile,
        bodySha256: sha256Text(issueDraft.body),
        bodySizeBytes: Buffer.byteLength(issueDraft.body),
        createIssueInput: {
          repository_full_name: githubRepo,
          title: issueDraft.title,
          body: issueDraft.body,
          labels: issueDraft.labels,
          assignees: [],
        },
      };
    }),
  };
}

function createGithubConnectorResponsesTemplate(issueDrafts, releaseDecision) {
  const publishReady = isPublishReady(releaseDecision);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceIssueDraftDecision: releaseDecision,
    publishReady,
    githubRepo,
    connector: "mcp__codex_apps__github._create_issue",
    instructions: publishReady
      ? [
          "각 `_create_issue` connector 호출 후 반환된 normalized issue snapshot을 일치하는 responses row에 붙여 넣습니다.",
          "`p1:handoff-issue-receipt:connector-results`가 응답을 local issue draft와 매칭할 수 있도록 packageDir/title은 변경하지 않습니다.",
          "owner가 생성된 issue를 확인하면 acknowledgement 필드를 채웁니다.",
          "`npm run p1:handoff-issue-receipt:connector-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --responses=.data/p1-handoff-issue-drafts/github-connector-issue-responses.json --out=.data/p1-handoff-issue-drafts/github-issue-create-results.json`를 실행한 뒤 `npm run p1:handoff-issue-receipt:apply-results`를 실행합니다.",
        ]
      : [
          "이 template로 외부 GitHub issue를 아직 만들지 않습니다.",
          "dispatch owner assignment와 acknowledgement 필드를 채운 뒤 publishReady=true 상태로 issue draft를 재생성합니다.",
        ],
    responses: issueDrafts.map((issueDraft) => ({
      packageDir: issueDraft.packageDir,
      title: issueDraft.title,
      number: "TODO issue number",
      html_url: "TODO https://github.com/<owner>/<repo>/issues/<number>",
      created_at: "TODO ISO timestamp",
      user: {
        login: "TODO operator account",
      },
      assignees: [
        {
          login: "TODO external assignee",
        },
      ],
      labels: issueDraft.labels.map((label) => ({ name: label })),
      acknowledgement: {
        status: "pending",
        acknowledgedAt: "TODO ISO timestamp",
        evidence: "TODO owner acknowledgement permalink",
      },
    })),
  };
}

function createGithubConnectorRunbook(
  issueDrafts,
  registrationPlan,
  githubConnectorPayloads,
  connectorPayloadPath,
  connectorResponsesTemplatePath,
  resultsTemplatePath,
  resultsCsvTemplatePath,
  releaseDecision,
) {
  const publishReady = registrationPlan.publishReady;
  const payloadRows = new Map(
    (githubConnectorPayloads.issuePayloads ?? []).map((row) => [
      row.packageDir,
      {
        bodySha256: row.bodySha256,
        bodySizeBytes: row.bodySizeBytes,
      },
    ]),
  );
  const lines = [
    "# P1 GitHub Connector Runbook",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- GitHub repo: \`${githubRepo}\``,
    `- Issue draft decision: \`${releaseDecision}\``,
    `- Publish ready: \`${publishReady ? "true" : "false"}\``,
    `- Publish guard: \`${registrationPlan.publishGuard}\``,
    "",
    "## Files",
    "",
    `- Connector payloads: \`${rel(connectorPayloadPath)}\``,
    `- Connector response template: \`${rel(connectorResponsesTemplatePath)}\``,
    `- Connector response target: \`${rel(connectorResponsesTemplatePath).replace(/\.template\.json$/, ".json")}\``,
    `- Results JSON template: \`${rel(resultsTemplatePath)}\``,
    `- Results CSV template: \`${rel(resultsCsvTemplatePath)}\``,
    `- Registration plan: \`${rel(path.join(outDir, "issue-registration-plan.json"))}\``,
    "",
  ];

  if (publishReady) {
    lines.push(
      "## Connector Steps",
      "",
      "1. Review every local issue draft Markdown file and the `bodySha256` values below.",
      "2. Open `github-connector-issue-payloads.json` and call `mcp__codex_apps__github._create_issue` once per `issuePayloads[].createIssueInput` row.",
      "3. Copy each normalized connector response into `github-connector-issue-responses.json` using the template structure.",
      "4. Fill each row's `acknowledgement.status`, `acknowledgement.acknowledgedAt`, and `acknowledgement.evidence` after the owner confirms the created issue.",
      "5. Run `npm run p1:handoff-issue-receipt:connector-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --responses=.data/p1-handoff-issue-drafts/github-connector-issue-responses.json --out=.data/p1-handoff-issue-drafts/github-issue-create-results.json`.",
      "6. Run `npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --results=.data/p1-handoff-issue-drafts/github-issue-create-results.json --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md`.",
      "7. Run `npm run p1:handoff-issue-receipt -- --file=.data/p1-handoff-issue-registration-receipt.json --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-report.json`.",
      "",
    );
  } else {
    lines.push(
      "## Blocked State",
      "",
      "- Do not call the GitHub connector yet.",
      "- Fill the dispatch receipt with real owner assignment, delivery channel, due date, assignment evidence, and acknowledgement evidence.",
      "- Regenerate issue drafts and confirm `publishReady=true` before creating external GitHub issues.",
      "",
    );
  }

  lines.push(
    "## Payload Rows",
    "",
    "| Package | Owner role | Title | Labels | Body SHA-256 | Body bytes |",
    "| --- | --- | --- | --- | --- | ---: |",
  );

  for (const issueDraft of issueDrafts) {
    const payload = payloadRows.get(issueDraft.packageDir) ?? {};
    lines.push(
      `| ${markdownCell(issueDraft.packageDir)} | ${markdownCell(issueDraft.ownerRole)} | ${markdownCell(issueDraft.title)} | ${markdownCell(issueDraft.labels.join(", "))} | \`${payload.bodySha256 ?? sha256Text(issueDraft.body)}\` | ${payload.bodySizeBytes ?? Buffer.byteLength(issueDraft.body)} |`,
    );
  }

  lines.push("", "## Next Actions", "");
  for (const action of registrationPlan.nextActions) {
    lines.push(`- ${action}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function createGithubResultsTemplate(issueDrafts, releaseDecision) {
  const publishReady = isPublishReady(releaseDecision);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseDecision: "blocked",
    sourceIssueDraftDecision: releaseDecision,
    publishReady,
    githubRepo,
    system: "GitHub issue",
    postedBy: "TODO operator account",
    postedAt: "TODO ISO timestamp",
    instructions: publishReady
      ? [
          "검토가 끝난 GitHub CLI command file을 실행하거나 동등한 외부 issue를 생성합니다.",
          "아래 모든 TODO 필드를 생성된 issue URL, issue id/number, assignee, posting evidence, acknowledgement evidence로 교체합니다.",
          "`npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --results=.data/p1-handoff-issue-drafts/github-issue-create-results.json --out=.data/p1-handoff-issue-registration-receipt.json --markdown=.data/p1-handoff-issue-registration-receipt.md`를 실행합니다.",
        ]
      : [
          "이 template로 외부 issue를 아직 만들지 않습니다.",
          "dispatch receipt의 owner assignment, delivery channel, due date, acknowledgement evidence를 채운 뒤 publishReady=true 상태로 issue draft를 재생성합니다.",
        ],
    registrations: issueDrafts.map((issueDraft) => ({
      packageDir: issueDraft.packageDir,
      title: issueDraft.title,
      issueDraft: {
        path: rel(path.join(outDir, issueDraft.fileName)),
      },
      external: {
        url: "TODO https://github.com/<owner>/<repo>/issues/<number>",
        id: "TODO issue number",
        assignee: "TODO external assignee",
        evidence: "TODO permalink or screenshot evidence",
      },
      acknowledgement: {
        status: "pending",
        acknowledgedAt: "TODO ISO timestamp",
        evidence: "TODO owner acknowledgement permalink",
      },
    })),
  };
}

function createGithubResultsCsvTemplate(issueDrafts) {
  const headers = [
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

  const rows = issueDrafts.map((issueDraft) => [
    issueDraft.packageDir,
    issueDraft.title,
    rel(path.join(outDir, issueDraft.fileName)),
    "GitHub issue",
    "TODO operator account",
    "TODO ISO timestamp",
    "TODO https://github.com/<owner>/<repo>/issues/<number>",
    "TODO issue number",
    "TODO external assignee",
    "TODO permalink or screenshot evidence",
    "pending",
    "TODO ISO timestamp",
    "TODO owner acknowledgement permalink",
  ]);

  return `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

await mkdir(outDir, { recursive: true });
for (const issueDraft of issueDrafts) {
  await writeFile(path.join(outDir, issueDraft.fileName), issueDraft.body);
}

const releaseDecision = blockers.length === 0 ? "ready" : "blocked";
const indexPath = path.join(outDir, "index.md");
const jsonPath = path.join(outDir, "issue-drafts.json");
const githubCommandsPath = path.join(outDir, "github-issue-create-commands.sh");
const githubConnectorPayloadPath = path.join(outDir, "github-connector-issue-payloads.json");
const githubConnectorResponsesTemplatePath = path.join(outDir, "github-connector-issue-responses.template.json");
const githubConnectorRunbookPath = path.join(outDir, "github-connector-runbook.md");
const registrationPlanPath = path.join(outDir, "issue-registration-plan.json");
const githubResultsTemplatePath = path.join(outDir, "github-issue-create-results.template.json");
const githubResultsCsvTemplatePath = path.join(outDir, "github-issue-create-results.template.csv");
const registrationPlan = createRegistrationPlan(
  issueDrafts,
  githubCommandsPath,
  githubConnectorPayloadPath,
  githubConnectorResponsesTemplatePath,
  githubResultsTemplatePath,
  githubResultsCsvTemplatePath,
  releaseDecision,
);
const githubConnectorPayloads = createGithubConnectorPayloads(
  issueDrafts,
  githubConnectorPayloadPath,
  githubConnectorResponsesTemplatePath,
  githubResultsTemplatePath,
  githubResultsCsvTemplatePath,
  releaseDecision,
);
const githubConnectorResponsesTemplate = createGithubConnectorResponsesTemplate(issueDrafts, releaseDecision);
const githubConnectorRunbook = createGithubConnectorRunbook(
  issueDrafts,
  registrationPlan,
  githubConnectorPayloads,
  githubConnectorPayloadPath,
  githubConnectorResponsesTemplatePath,
  githubResultsTemplatePath,
  githubResultsCsvTemplatePath,
  releaseDecision,
);
const githubResultsTemplate = createGithubResultsTemplate(issueDrafts, releaseDecision);
const githubResultsCsvTemplate = createGithubResultsCsvTemplate(issueDrafts);
await writeFile(indexPath, createIndex(issueDrafts, receipt ?? {}, releaseDecision));
await writeFile(githubCommandsPath, createGithubCommands(issueDrafts, releaseDecision));
await chmod(githubCommandsPath, 0o755);
await writeFile(githubConnectorPayloadPath, `${JSON.stringify(githubConnectorPayloads, null, 2)}\n`);
await writeFile(githubConnectorResponsesTemplatePath, `${JSON.stringify(githubConnectorResponsesTemplate, null, 2)}\n`);
await writeFile(githubConnectorRunbookPath, githubConnectorRunbook);
await writeFile(registrationPlanPath, `${JSON.stringify(registrationPlan, null, 2)}\n`);
await writeFile(githubResultsTemplatePath, `${JSON.stringify(githubResultsTemplate, null, 2)}\n`);
await writeFile(githubResultsCsvTemplatePath, githubResultsCsvTemplate);
await writeFile(
  jsonPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      receipt: rel(receiptPath),
      releaseDecision,
      issueDrafts: issueDrafts.map(createIssueDraftSummary),
      index: rel(indexPath),
      githubIssueConnectorPayloads: rel(githubConnectorPayloadPath),
      githubIssueConnectorResponsesTemplate: rel(githubConnectorResponsesTemplatePath),
      githubIssueConnectorRunbook: rel(githubConnectorRunbookPath),
      githubIssueCreateResultsTemplate: rel(githubResultsTemplatePath),
      githubIssueCreateResultsCsvTemplate: rel(githubResultsCsvTemplatePath),
      githubIssueCreateCommands: rel(githubCommandsPath),
      issueRegistrationPlan: rel(registrationPlanPath),
      publishReady: registrationPlan.publishReady,
      blockers,
    },
    null,
    2,
  )}\n`,
);

const report = {
  ok: blockers.length === 0,
  releaseDecision,
  generatedAt: new Date().toISOString(),
  receipt: rel(receiptPath),
  issueDraftsDir: rel(outDir),
  checked: [
    `${issueDrafts.length} owner package issue drafts are generated`,
    "issue drafts include assignee, delivery evidence, due date, strict commands, and done criteria",
    "issue drafts remain local publish drafts and are not posted externally",
    "blocked issue drafts guard GitHub CLI and connector publication until publishReady=true",
    "GitHub CLI commands, connector payloads, connector runbook, connector response template, JSON/CSV results templates, and registration plan are generated for reviewed drafts",
    "raw secret-like values are not written to issue drafts",
  ],
  summary: {
    issueDrafts: issueDrafts.length,
    totalActions: issueDrafts.reduce((sum, issueDraft) => sum + issueDraft.totalActions, 0),
  },
  outputs: {
    githubIssueConnectorRunbook: rel(githubConnectorRunbookPath),
    githubIssueConnectorResponsesTemplate: rel(githubConnectorResponsesTemplatePath),
    githubIssueConnectorPayloads: rel(githubConnectorPayloadPath),
    githubIssueCreateCommands: rel(githubCommandsPath),
    githubIssueCreateResultsCsvTemplate: rel(githubResultsCsvTemplatePath),
    githubIssueCreateResultsTemplate: rel(githubResultsTemplatePath),
    index: rel(indexPath),
    issueRegistrationPlan: rel(registrationPlanPath),
    json: rel(jsonPath),
  },
  blockers,
};

console.log(JSON.stringify(report, null, 2));
