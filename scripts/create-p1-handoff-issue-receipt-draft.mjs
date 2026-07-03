import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const issueDraftsPath = path.resolve(args.issueDrafts ?? ".data/p1-handoff-issue-drafts/issue-drafts.json");
const issueResultsPath = path.join(path.dirname(issueDraftsPath), "github-issue-create-results.json");
const issueResultsCsvPath = path.join(path.dirname(issueDraftsPath), "github-issue-create-results.csv");
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
  return typeof value === "string" ? value.trim() : "";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
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

function createMarkdown(receipt) {
  const lines = [
    "# P1 Handoff Issue Registration Receipt",
    "",
    `- Issue draft manifest: \`${receipt.issueDraftManifest.path}\``,
    `- Issue draft manifest SHA-256: \`${receipt.issueDraftManifest.sha256}\``,
    `- Issue draft decision: \`${receipt.issueDraftManifest.releaseDecision}\``,
    `- Issue draft publish ready: \`${receipt.issueDraftManifest.publishReady}\``,
    `- Receipt decision: \`${receipt.releaseDecision}\``,
    "",
  ];

  if (receipt.issueDraftManifest.releaseDecision !== "ready" || receipt.issueDraftManifest.publishReady === false) {
    lines.push(
      "## Blocked State",
      "",
      "- 담당자 전달/acknowledgement가 완료될 때까지 GitHub connector 또는 GitHub/Slack 외부 이슈를 등록하지 않습니다.",
      `- 먼저 dispatch receipt를 completed 상태로 만들고 \`${receipt.issueDraftManifest.path}\`를 다시 생성해 \`publishReady=true\`를 확인합니다.`,
      "",
    );
  }

  lines.push(
    "## Registrations",
    "",
    "| Issue draft | Owner role | External URL | Assignee | Ack status |",
    "| --- | --- | --- | --- | --- |",
  );

  for (const registration of receipt.registrations) {
    lines.push(
      `| \`${registration.issueDraft.path}\` | ${registration.ownerRole} | ${registration.external.url} | ${registration.external.assignee} | ${registration.acknowledgement.status} |`,
    );
  }

  lines.push(
    "",
    "## Strict Validation",
    "",
    `Prefer \`npm run p1:handoff-issue-receipt:apply-results-csv -- --issue-drafts=${receipt.issueDraftManifest.path} --csv=${rel(issueResultsCsvPath)} --out=${receipt.outputPaths.receipt} --markdown=${receipt.outputPaths.markdown}\` after filling the GitHub/Slack results CSV.`,
    `Use \`npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=${receipt.issueDraftManifest.path} --results=${rel(issueResultsPath)} --out=${receipt.outputPaths.receipt} --markdown=${receipt.outputPaths.markdown}\` when a structured integration emits the results JSON.`,
    `모든 TODO 필드를 실제 GitHub/Slack issue URL, assignee, body hash, acknowledgement evidence로 교체한 뒤 \`npm run p1:handoff-issue-receipt -- --file=${receipt.outputPaths.receipt} --issue-drafts=${receipt.issueDraftManifest.path} --out=${receipt.outputPaths.report}\`를 실행합니다.`,
    "",
  );

  return `${lines.join("\n")}\n`;
}

function isIssueDraftManifestReady(manifest) {
  return manifest?.releaseDecision === "ready" && manifest?.publishReady !== false;
}

function createNextActions(receipt, manifest) {
  if (!isIssueDraftManifestReady(manifest)) {
    const dispatchReceipt = text(manifest?.receipt) || ".data/p1-handoff-dispatch-receipt.json";
    const dispatchDirectory = path.dirname(dispatchReceipt);
    const dispatchCsv = path.join(dispatchDirectory, "p1-handoff-dispatch-receipt.csv");
    const completedReceipt = path.join(dispatchDirectory, "p1-handoff-dispatch-receipt.completed.json");
    const completedMarkdown = path.join(dispatchDirectory, "p1-handoff-dispatch-receipt.completed.md");
    const dispatchReport = path.join(dispatchDirectory, "p1-handoff-dispatch-report.json");

    return [
      "담당자 전달/acknowledgement가 완료될 때까지 GitHub connector 또는 GitHub/Slack 외부 이슈를 등록하지 않습니다.",
      `먼저 \`${dispatchCsv}\`에 실제 담당자, 전달 채널, due date, assignment evidence, acknowledgement evidence를 채운 뒤 \`npm run p1:handoff-dispatch:apply-csv -- --receipt=${dispatchReceipt} --csv=${dispatchCsv} --out=${completedReceipt} --markdown=${completedMarkdown}\`를 실행합니다.`,
      `completed dispatch receipt를 \`npm run p1:handoff-dispatch -- --file=${completedReceipt} --bundle=.data/p1-handoff-bundle-manifest.json --out=${dispatchReport}\`로 검증합니다.`,
      `그 다음 \`npm run p1:handoff-issues:draft -- --receipt=${completedReceipt} --out-dir=${path.dirname(receipt.issueDraftManifest.path)}\`를 다시 실행해 \`publishReady=true\`를 확인합니다.`,
    ];
  }

  return [
    "각 Markdown draft를 GitHub Issues 또는 합의된 Slack workflow에 등록합니다.",
    `\`github-issue-create-results.template.csv\`를 기준으로 \`${rel(issueResultsCsvPath)}\`를 채운 뒤 \`npm run p1:handoff-issue-receipt:apply-results-csv -- --issue-drafts=${rel(issueDraftsPath)} --csv=${rel(issueResultsCsvPath)} --out=${rel(outPath)} --markdown=${rel(markdownPath)}\`를 실행합니다.`,
    `구조화된 연동이 이미 JSON을 내보내면 \`github-issue-create-results.template.json\`를 기준으로 \`${rel(issueResultsPath)}\`를 채운 뒤 \`npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=${rel(issueDraftsPath)} --results=${rel(issueResultsPath)} --out=${rel(outPath)} --markdown=${rel(markdownPath)}\`를 실행합니다.`,
    "외부 workflow가 GitHub CLI 기반이 아니면 모든 TODO 필드를 external URL, assignee, posting evidence, body hash, owner acknowledgement evidence로 교체합니다.",
    `최종 P1 readiness 전에 \`npm run p1:handoff-issue-receipt -- --file=${rel(outPath)} --issue-drafts=${rel(issueDraftsPath)} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-issue-registration-report.json"))}\`를 실행합니다.`,
  ];
}

const issueDraftsArtifact = await readSafeFile(issueDraftsPath, "P1 handoff issue draft manifest");
const issueDrafts = parseJson(issueDraftsArtifact.source, "P1 handoff issue draft manifest");
const generatedAt = new Date().toISOString();

const registrations = [];

for (const issueDraft of issueDrafts.issueDrafts ?? []) {
  const draftPath = path.resolve(issueDraft.path);
  const draftArtifact = await readSafeFile(draftPath, "P1 handoff issue draft Markdown");

  registrations.push({
    ownerRole: issueDraft.ownerRole ?? "TODO owner role",
    packageDir: issueDraft.packageDir,
    title: issueDraft.title,
    issueDraft: {
      path: rel(draftPath),
      bodySha256: sha256(draftArtifact.buffer),
      sizeBytes: draftArtifact.buffer.byteLength,
      labels: issueDraft.labels ?? [],
      strictCommands: issueDraft.strictCommands ?? [],
      totalActions: issueDraft.totalActions ?? 0,
    },
    external: {
      system: "TODO GitHub issue or Slack workflow",
      url: "TODO https URL",
      id: "TODO issue number or message timestamp",
      postedAt: "TODO ISO timestamp",
      postedBy: "TODO operator account",
      assignee: "TODO external assignee",
      labels: issueDraft.labels ?? [],
      bodySha256: sha256(draftArtifact.buffer),
      evidence: "TODO permalink or screenshot evidence",
    },
    acknowledgement: {
      status: "pending",
      acknowledgedAt: "TODO ISO timestamp",
      evidence: "TODO owner acknowledgement permalink",
    },
  });
}

const receipt = {
  schemaVersion: 1,
  generatedAt,
  releaseDecision: "blocked",
  issueDraftManifest: {
    path: rel(issueDraftsPath),
    sha256: sha256(issueDraftsArtifact.buffer),
    sizeBytes: issueDraftsArtifact.buffer.byteLength,
    releaseDecision: issueDrafts.releaseDecision ?? null,
    publishReady: issueDrafts.publishReady ?? null,
    publishGuard: issueDrafts.publishGuard ?? null,
    blockerCount: Array.isArray(issueDrafts.blockers) ? issueDrafts.blockers.length : null,
    generatedAt: issueDrafts.generatedAt ?? null,
    index: issueDrafts.index ?? null,
  },
  outputPaths: {
    receipt: rel(outPath),
    markdown: rel(markdownPath),
    report: rel(path.join(path.dirname(outPath), "p1-handoff-issue-registration-report.json")),
  },
  registrations,
  summary: {
    issueDrafts: registrations.length,
    registered: 0,
    acknowledged: 0,
    totalActions: registrations.reduce((sum, registration) => sum + registration.issueDraft.totalActions, 0),
  },
  checked: [
    "issue draft manifest path and hashes are captured",
    `${registrations.length} owner issue registrations are present`,
    "external issue body hash matches the generated Markdown draft",
    "external URL, assignee, labels, and acknowledgement evidence are filled",
    "raw secret-like values are not written to the issue registration receipt",
  ],
};

receipt.nextActions = createNextActions(receipt, issueDrafts);

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
await mkdir(path.dirname(markdownPath), { recursive: true });
await writeFile(markdownPath, createMarkdown(receipt));

console.log(JSON.stringify(receipt, null, 2));
