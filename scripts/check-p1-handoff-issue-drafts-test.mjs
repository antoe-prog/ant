import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-handoff-issues-"));
const rawPaymentSecret = "sk_live_finaljudo_issue_secret_that_must_not_be_written";

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

const receiptPath = path.join(directory, "p1-handoff-dispatch-receipt.json");
await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-dispatch-draft.mjs",
    `--bundle=${bundlePath}`,
    `--out=${receiptPath}`,
    `--markdown=${path.join(directory, "p1-handoff-dispatch-receipt.md")}`,
  ],
  { cwd: process.cwd() },
);

const pendingIssuesDir = path.join(directory, "pending-issues");
const pendingResult = await execFile(
  process.execPath,
  ["scripts/create-p1-handoff-issue-drafts.mjs", `--receipt=${receiptPath}`, `--out-dir=${pendingIssuesDir}`],
  { cwd: process.cwd() },
);
const pendingReport = JSON.parse(pendingResult.stdout);
const pendingManifest = JSON.parse(await readFile(path.join(pendingIssuesDir, "issue-drafts.json"), "utf8"));
const pendingGithubCommands = await readFile(path.join(pendingIssuesDir, "github-issue-create-commands.sh"), "utf8");
const pendingGithubConnectorPayloads = JSON.parse(await readFile(path.join(pendingIssuesDir, "github-connector-issue-payloads.json"), "utf8"));
const pendingGithubConnectorResponsesTemplate = JSON.parse(
  await readFile(path.join(pendingIssuesDir, "github-connector-issue-responses.template.json"), "utf8"),
);
const pendingGithubConnectorRunbook = await readFile(path.join(pendingIssuesDir, "github-connector-runbook.md"), "utf8");
const pendingGithubResultsTemplate = JSON.parse(await readFile(path.join(pendingIssuesDir, "github-issue-create-results.template.json"), "utf8"));
const pendingGithubResultsCsvTemplate = await readFile(path.join(pendingIssuesDir, "github-issue-create-results.template.csv"), "utf8");
const pendingRegistrationPlan = JSON.parse(await readFile(path.join(pendingIssuesDir, "issue-registration-plan.json"), "utf8"));

assert.equal(pendingReport.ok, false);
assert.equal(pendingReport.releaseDecision, "blocked");
assert.equal(pendingReport.summary.issueDrafts, 6);
assert.equal(pendingManifest.publishReady, false);
assert.equal(pendingManifest.blockers.length > 0, true);
assert.equal(pendingReport.outputs.githubIssueCreateCommands.endsWith("github-issue-create-commands.sh"), true);
assert.equal(pendingReport.outputs.githubIssueConnectorPayloads.endsWith("github-connector-issue-payloads.json"), true);
assert.equal(pendingReport.outputs.githubIssueConnectorResponsesTemplate.endsWith("github-connector-issue-responses.template.json"), true);
assert.equal(pendingReport.outputs.githubIssueConnectorRunbook.endsWith("github-connector-runbook.md"), true);
assert.equal(pendingReport.outputs.githubIssueCreateResultsTemplate.endsWith("github-issue-create-results.template.json"), true);
assert.equal(pendingReport.outputs.githubIssueCreateResultsCsvTemplate.endsWith("github-issue-create-results.template.csv"), true);
assert.equal(pendingReport.outputs.issueRegistrationPlan.endsWith("issue-registration-plan.json"), true);
assert.equal(pendingRegistrationPlan.publishReady, false);
assert.equal(pendingRegistrationPlan.publishGuard, "blocked_until_dispatch_receipt_ready");
assert(pendingRegistrationPlan.nextActions[0].includes("아직 발행하지 않습니다") || pendingRegistrationPlan.nextActions[0].includes("--github-repo"));
assert(pendingRegistrationPlan.nextActions.some((action) => action.includes("p1-handoff-dispatch-receipt.json")));
assert.equal(pendingRegistrationPlan.commands.githubResultsCsvTemplate.endsWith("github-issue-create-results.template.csv"), true);
assert(pendingGithubCommands.includes("publishReady=false"));
assert(pendingGithubCommands.includes("exit 1"));
assert(!pendingGithubCommands.includes("gh issue create"));
assert.equal(pendingGithubConnectorPayloads.publishReady, false);
assert.equal(pendingGithubConnectorPayloads.publishGuard, "blocked_until_dispatch_receipt_ready");
assert.equal(pendingGithubConnectorPayloads.outputs.connectorResponsesTemplate.endsWith("github-connector-issue-responses.template.json"), true);
assert(pendingGithubConnectorPayloads.instructions[0].includes("아직 호출하지 않습니다"));
assert.equal(pendingGithubConnectorResponsesTemplate.publishReady, false);
assert.equal(pendingGithubConnectorResponsesTemplate.responses.length, 6);
assert.equal(pendingGithubConnectorResponsesTemplate.responses[0].html_url.includes("TODO"), true);
assert(pendingGithubConnectorRunbook.includes("# P1 GitHub Connector Runbook"));
assert(pendingGithubConnectorRunbook.includes("Publish ready: `false`"));
assert(pendingGithubConnectorRunbook.includes("Do not call the GitHub connector yet."));
assert(pendingGithubConnectorRunbook.includes("github-connector-issue-responses.json"));
assert(pendingGithubConnectorRunbook.includes("## Payload Rows"));
assert.equal(pendingGithubResultsTemplate.publishReady, false);
assert(pendingGithubResultsTemplate.instructions[0].includes("아직 만들지 않습니다"));
assert(pendingGithubResultsCsvTemplate.includes("packageDir,title,issueDraftPath,system,postedBy,postedAt,url,id,assignee,evidence,acknowledgementStatus,acknowledgedAt,acknowledgementEvidence"));
assert(pendingGithubResultsCsvTemplate.includes("TODO operator account"));
assert.equal(pendingGithubResultsCsvTemplate.trim().split("\n").length, 7);
assert(pendingReport.blockers.some((blocker) => blocker.code === "P1_HANDOFF_ISSUE_DRAFT_ASSIGNMENT_PENDING"));
assert((await readFile(path.join(pendingIssuesDir, "index.md"), "utf8")).includes("P1 Handoff Issue Draft Index"));

const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const completed = {
  ...receipt,
  releaseDecision: "ready",
  ownerPackages: receipt.ownerPackages.map((ownerPackage, index) => ({
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

await writeFile(receiptPath, `${JSON.stringify(completed, null, 2)}\n`);

const readyIssuesDir = path.join(directory, "ready-issues");
const readyResult = await execFile(
  process.execPath,
  ["scripts/create-p1-handoff-issue-drafts.mjs", `--receipt=${receiptPath}`, `--out-dir=${readyIssuesDir}`, "--github-repo=antoe-prog/ant"],
  { cwd: process.cwd() },
);
const readyReport = JSON.parse(readyResult.stdout);
const readyIndex = await readFile(path.join(readyIssuesDir, "index.md"), "utf8");
const readyJson = JSON.parse(await readFile(path.join(readyIssuesDir, "issue-drafts.json"), "utf8"));
const readyGithubCommands = await readFile(path.join(readyIssuesDir, "github-issue-create-commands.sh"), "utf8");
const readyGithubConnectorPayloads = JSON.parse(await readFile(path.join(readyIssuesDir, "github-connector-issue-payloads.json"), "utf8"));
const readyGithubConnectorResponsesTemplate = JSON.parse(
  await readFile(path.join(readyIssuesDir, "github-connector-issue-responses.template.json"), "utf8"),
);
const readyGithubConnectorRunbook = await readFile(path.join(readyIssuesDir, "github-connector-runbook.md"), "utf8");
const readyGithubResultsTemplate = JSON.parse(await readFile(path.join(readyIssuesDir, "github-issue-create-results.template.json"), "utf8"));
const readyGithubResultsCsvTemplate = await readFile(path.join(readyIssuesDir, "github-issue-create-results.template.csv"), "utf8");
const readyRegistrationPlan = JSON.parse(await readFile(path.join(readyIssuesDir, "issue-registration-plan.json"), "utf8"));
const markdownFiles = (await readdir(readyIssuesDir)).filter(
  (name) => name.endsWith(".md") && !["github-connector-runbook.md", "index.md"].includes(name),
);

assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert.equal(readyReport.summary.issueDrafts, 6);
assert(readyReport.summary.totalActions > 100);
assert.equal(markdownFiles.length, 6);
assert.equal(readyJson.issueDrafts.length, 6);
assert.equal(readyJson.publishReady, true);
assert.equal(readyJson.githubIssueCreateCommands.endsWith("github-issue-create-commands.sh"), true);
assert.equal(readyJson.githubIssueConnectorPayloads.endsWith("github-connector-issue-payloads.json"), true);
assert.equal(readyJson.githubIssueConnectorResponsesTemplate.endsWith("github-connector-issue-responses.template.json"), true);
assert.equal(readyJson.githubIssueConnectorRunbook.endsWith("github-connector-runbook.md"), true);
assert.equal(readyJson.githubIssueCreateResultsTemplate.endsWith("github-issue-create-results.template.json"), true);
assert.equal(readyJson.githubIssueCreateResultsCsvTemplate.endsWith("github-issue-create-results.template.csv"), true);
assert.equal(readyJson.issueRegistrationPlan.endsWith("issue-registration-plan.json"), true);
assert.equal(readyRegistrationPlan.publishReady, true);
assert.equal(readyRegistrationPlan.publishGuard, "ready");
assert.equal(readyRegistrationPlan.githubRepo, "antoe-prog/ant");
assert.equal(readyRegistrationPlan.issueDrafts.length, 6);
assert.equal(readyRegistrationPlan.commands.githubConnectorPayloads.endsWith("github-connector-issue-payloads.json"), true);
assert.equal(readyRegistrationPlan.commands.githubConnectorResponsesTemplate.endsWith("github-connector-issue-responses.template.json"), true);
assert.equal(readyRegistrationPlan.commands.githubResultsCsvTemplate.endsWith("github-issue-create-results.template.csv"), true);
assert.equal(readyGithubConnectorPayloads.publishReady, true);
assert.equal(readyGithubConnectorPayloads.publishGuard, "ready");
assert.equal(readyGithubConnectorPayloads.connector, "mcp__codex_apps__github._create_issue");
assert.equal(readyGithubConnectorPayloads.githubRepo, "antoe-prog/ant");
assert.equal(readyGithubConnectorPayloads.issuePayloads.length, 6);
assert.equal(readyGithubConnectorPayloads.issuePayloads[0].createIssueInput.repository_full_name, "antoe-prog/ant");
assert.equal(readyGithubConnectorPayloads.issuePayloads[0].createIssueInput.labels.includes("pilot-release"), true);
assert.equal(readyGithubConnectorPayloads.issuePayloads[0].bodySha256.length, 64);
assert(readyGithubConnectorPayloads.issuePayloads[0].createIssueInput.body.includes("## Done When"));
assert.equal(readyGithubConnectorPayloads.outputs.connectorResponsesTemplate.endsWith("github-connector-issue-responses.template.json"), true);
assert.equal(readyGithubConnectorPayloads.outputs.resultsCsvTemplate.endsWith("github-issue-create-results.template.csv"), true);
assert.equal(readyGithubConnectorResponsesTemplate.publishReady, true);
assert.equal(readyGithubConnectorResponsesTemplate.responses.length, 6);
assert.equal(readyGithubConnectorResponsesTemplate.responses[0].title, readyJson.issueDrafts[0].title);
assert.equal(readyGithubConnectorResponsesTemplate.responses[0].labels.some((label) => label.name === "pilot-release"), true);
assert.equal(readyGithubConnectorResponsesTemplate.instructions.join("\n").includes("connector-results"), true);
assert(readyGithubConnectorRunbook.includes("Publish ready: `true`"));
assert(readyGithubConnectorRunbook.includes("## Connector Steps"));
assert(readyGithubConnectorRunbook.includes("mcp__codex_apps__github._create_issue"));
assert(readyGithubConnectorRunbook.includes("p1:handoff-issue-receipt:connector-results"));
assert(readyGithubConnectorRunbook.includes("p1:handoff-issue-receipt -- --file"));
assert(readyGithubConnectorRunbook.includes("Body SHA-256"));
assert.equal(readyGithubResultsTemplate.registrations.length, 6);
assert.equal(readyGithubResultsTemplate.githubRepo, "antoe-prog/ant");
assert.equal(readyGithubResultsTemplate.registrations[0].external.url.includes("TODO"), true);
assert(readyGithubResultsCsvTemplate.includes("GitHub issue"));
assert(readyGithubResultsCsvTemplate.includes("TODO https://github.com/<owner>/<repo>/issues/<number>"));
assert.equal(readyGithubResultsCsvTemplate.trim().split("\n").length, 7);
assert(readyGithubCommands.includes("gh issue create"));
assert(readyGithubCommands.includes("--repo 'antoe-prog/ant'"));
assert(readyGithubCommands.includes("--body-file"));
assert(readyGithubCommands.includes("--label 'pilot-release'"));
assert(readyJson.issueDrafts.every((issueDraft) => issueDraft.title.startsWith("[P1 Handoff]")));
assert(readyJson.issueDrafts.every((issueDraft) => issueDraft.strictCommands.length > 0));
assert(readyIndex.includes("Mobile/Release"));
assert(readyIndex.includes("owner-2@finaljudo.kr"));

const mobileIssue = await readFile(path.join(readyIssuesDir, "02-mobile-release.md"), "utf8");
assert(mobileIssue.includes("## Required Strict Commands"));
assert(mobileIssue.includes("npm run android:release-handoff"));
assert(mobileIssue.includes("## Done When"));
assert(!mobileIssue.includes("TODO"));

const iosIssue = await readFile(path.join(readyIssuesDir, "03-ios-release.md"), "utf8");
assert(iosIssue.includes("## Required Strict Commands"));
assert(iosIssue.includes("npm run ios:ipa:doctor"));
assert(iosIssue.includes("npm run ios:ipa:build"));
assert(iosIssue.includes("## Done When"));
assert(!iosIssue.includes("TODO"));

const inferredRepo = path.join(directory, "inferred-git-repo");
const inferredIssuesDir = path.join(directory, "ready-issues-inferred");
await mkdir(inferredRepo);
await execFile("git", ["init"], { cwd: inferredRepo });
await execFile("git", ["remote", "add", "origin", "git@github.com:final-judo/inferred-ops.git"], { cwd: inferredRepo });
await execFile(
  process.execPath,
  [path.join(process.cwd(), "scripts/create-p1-handoff-issue-drafts.mjs"), `--receipt=${receiptPath}`, `--out-dir=${inferredIssuesDir}`],
  {
    cwd: inferredRepo,
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "",
    },
  },
);
const inferredGithubCommands = await readFile(path.join(inferredIssuesDir, "github-issue-create-commands.sh"), "utf8");
const inferredGithubConnectorPayloads = JSON.parse(await readFile(path.join(inferredIssuesDir, "github-connector-issue-payloads.json"), "utf8"));
const inferredRegistrationPlan = JSON.parse(await readFile(path.join(inferredIssuesDir, "issue-registration-plan.json"), "utf8"));
assert.equal(inferredGithubConnectorPayloads.githubRepo, "final-judo/inferred-ops");
assert.equal(inferredGithubConnectorPayloads.issuePayloads[0].createIssueInput.repository_full_name, "final-judo/inferred-ops");
assert.equal(inferredRegistrationPlan.githubRepo, "final-judo/inferred-ops");
assert(inferredGithubCommands.includes("--repo 'final-judo/inferred-ops'"));

const tampered = {
  ...completed,
  ownerPackages: completed.ownerPackages.map((ownerPackage, index) =>
    index === 0
      ? {
          ...ownerPackage,
          assignment: {
            ...ownerPackage.assignment,
            evidence: rawPaymentSecret,
          },
        }
      : ownerPackage,
  ),
};
await writeFile(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`);

let secretFailed = false;
try {
  await execFile(
    process.execPath,
    ["scripts/create-p1-handoff-issue-drafts.mjs", `--receipt=${receiptPath}`, `--out-dir=${path.join(directory, "secret-issues")}`],
    { cwd: process.cwd() },
  );
} catch (error) {
  secretFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_ISSUE_DRAFT_SECRET_LIKE_VALUE"));
}

assert.equal(secretFailed, true, "issue draft generator must reject raw secret-like values");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "pending dispatch receipt creates blocked local issue drafts",
        "completed dispatch receipt creates six publishable owner issue drafts",
        "issue drafts preserve strict commands, owner assignments, due dates, and done criteria",
        "issue draft index and JSON manifest are generated",
        "blocked issue drafts guard GitHub CLI and connector publication until publishReady=true",
        "GitHub CLI issue creation command file, connector payload, connector runbook, connector response template, JSON/CSV result templates, and registration plan are generated",
        "GitHub repository can be inferred from local git remote origin when no explicit repo is passed",
        "raw secret-like values inside dispatch receipt are rejected before draft generation",
      ],
      issueDrafts: readyReport.summary.issueDrafts,
    },
    null,
    2,
  ),
);
