import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveGitHubRepository } from "./lib/github-repository.mjs";

const execFile = promisify(execFileCallback);
const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.outDir ?? ".data");
const summaryPath = path.resolve(args.summary ?? path.join(outDir, "p1-handoff-draft-workspace.json"));

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    const normalizedKey = key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[normalizedKey] = value;
  }

  return parsed;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function maybeArg(name, value) {
  return text(value) ? [`--${name}=${text(value)}`] : [];
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function runNode(label, script, scriptArgs = []) {
  const command = [process.execPath, script, ...scriptArgs];
  const startedAt = Date.now();
  const { stdout } = await execFile(command[0], command.slice(1), { cwd: process.cwd(), env: process.env });

  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = null;
  }

  return {
    label,
    command: `node ${[script, ...scriptArgs].join(" ")}`,
    durationMs: Date.now() - startedAt,
    ok: json?.ok ?? true,
    releaseDecision: json?.releaseDecision ?? null,
    blockerCount: Array.isArray(json?.blockers) ? json.blockers.length : null,
    actionCount: json?.checklistCount ?? json?.summary?.totalActions ?? null,
    nextAction: json?.nextAction ?? json?.nextActions?.[0] ?? null,
    out: json?.out ?? json?.file ?? json?.source ?? null,
  };
}

async function runNodeAllowFailure(label, script, scriptArgs = []) {
  const command = [process.execPath, script, ...scriptArgs];
  const startedAt = Date.now();
  let stdout = "";
  let exitCode = 0;

  try {
    const result = await execFile(command[0], command.slice(1), { cwd: process.cwd(), env: process.env });
    stdout = result.stdout;
  } catch (error) {
    exitCode = typeof error?.code === "number" ? error.code : 1;
    stdout = typeof error?.stdout === "string" ? error.stdout : "";
  }

  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = null;
  }

  return {
    label,
    command: `node ${[script, ...scriptArgs].join(" ")}`,
    durationMs: Date.now() - startedAt,
    ok: exitCode === 0 ? (json?.ok ?? true) : (json?.ok ?? false),
    exitCode,
    expectedFailure: exitCode !== 0,
    releaseDecision: json?.releaseDecision ?? null,
    blockerCount: Array.isArray(json?.blockers) ? json.blockers.length : null,
    actionCount: json?.checklistCount ?? json?.summary?.totalActions ?? null,
    nextAction: json?.nextAction ?? json?.nextActions?.[0] ?? null,
    out: json?.out ?? json?.file ?? json?.source ?? null,
  };
}

function reportSummary(label, filePath, document) {
  return {
    label,
    path: rel(filePath),
    ok: document?.ok ?? null,
    releaseDecision: document?.releaseDecision ?? null,
    blockerCount: Array.isArray(document?.blockers) ? document.blockers.length : null,
    nextAction: document?.nextAction ?? document?.nextActions?.[0] ?? null,
  };
}

await mkdir(outDir, { recursive: true });

const paths = {
  androidDoctor: path.join(outDir, "android-twa-doctor.json"),
  androidDoctorMarkdown: path.join(outDir, "android-twa-doctor.md"),
  androidHandoff: path.join(outDir, "android-release-handoff.json"),
  androidReport: path.join(outDir, "android-release-handoff.report.json"),
  deploymentHandoff: path.join(outDir, "deployment-handoff.json"),
  deploymentReport: path.join(outDir, "deployment-handoff.report.json"),
  iosBuildsDir: path.join(outDir, "mobile-builds", "ios"),
  iosCapacitorConnection: path.join(outDir, "mobile-builds", "ios", "ios-capacitor-connection.json"),
  iosCapacitorConnectionMarkdown: path.join(outDir, "mobile-builds", "ios", "ios-capacitor-connection.md"),
  iosIpaDoctor: path.join(outDir, "mobile-builds", "ios", "ios-ipa-doctor.json"),
  iosIpaDoctorMarkdown: path.join(outDir, "mobile-builds", "ios", "ios-ipa-doctor.md"),
  iosIpaBuildReport: path.join(outDir, "mobile-builds", "ios", "ios-ipa-build-report.json"),
  postgresDockerReadiness: path.join(outDir, "postgres-docker-readiness.json"),
  postgresDockerReadinessMarkdown: path.join(outDir, "postgres-docker-readiness.md"),
  notificationPushHandoff: path.join(outDir, "notification-push-handoff.json"),
  notificationPushReport: path.join(outDir, "notification-push-handoff.report.json"),
  paymentProviderHandoff: path.join(outDir, "payment-provider-handoff.json"),
  paymentProviderReport: path.join(outDir, "payment-provider-handoff.report.json"),
  p1ActionChecklistCsv: path.join(outDir, "p1-handoff-action-checklist.csv"),
  p1ActionChecklistJson: path.join(outDir, "p1-handoff-action-checklist.json"),
  p1ActionChecklistMarkdown: path.join(outDir, "p1-handoff-action-checklist.md"),
  p1ActionBriefMarkdown: path.join(outDir, "p1-handoff-action-brief.md"),
  p1OwnerPackageIndexMarkdown: path.join(outDir, "p1-handoff-owner-package-index.md"),
  p1OwnerBriefsDir: path.join(outDir, "p1-handoff-owner-briefs"),
  p1OwnerPackagesDir: path.join(outDir, "p1-handoff-owner-packages"),
  p1BundleManifest: path.join(outDir, "p1-handoff-bundle-manifest.json"),
  p1DispatchReceipt: path.join(outDir, "p1-handoff-dispatch-receipt.json"),
  p1DispatchReport: path.join(outDir, "p1-handoff-dispatch-report.json"),
  p1DispatchMarkdown: path.join(outDir, "p1-handoff-dispatch-receipt.md"),
  p1DispatchCsv: path.join(outDir, "p1-handoff-dispatch-receipt.csv"),
  p1IssueDraftsDir: path.join(outDir, "p1-handoff-issue-drafts"),
  p1IssueDraftsJson: path.join(outDir, "p1-handoff-issue-drafts", "issue-drafts.json"),
  p1IssueDraftsIndex: path.join(outDir, "p1-handoff-issue-drafts", "index.md"),
  p1IssueGithubCommands: path.join(outDir, "p1-handoff-issue-drafts", "github-issue-create-commands.sh"),
  p1IssueGithubConnectorPayloads: path.join(outDir, "p1-handoff-issue-drafts", "github-connector-issue-payloads.json"),
  p1IssueGithubConnectorResponsesTemplate: path.join(outDir, "p1-handoff-issue-drafts", "github-connector-issue-responses.template.json"),
  p1IssueGithubConnectorRunbook: path.join(outDir, "p1-handoff-issue-drafts", "github-connector-runbook.md"),
  p1IssueGithubResultsTemplate: path.join(outDir, "p1-handoff-issue-drafts", "github-issue-create-results.template.json"),
  p1IssueGithubResultsCsvTemplate: path.join(outDir, "p1-handoff-issue-drafts", "github-issue-create-results.template.csv"),
  p1IssueRegistrationPlan: path.join(outDir, "p1-handoff-issue-drafts", "issue-registration-plan.json"),
  p1IssueRegistrationReceipt: path.join(outDir, "p1-handoff-issue-registration-receipt.json"),
  p1IssueRegistrationMarkdown: path.join(outDir, "p1-handoff-issue-registration-receipt.md"),
  p1IssueRegistrationReport: path.join(outDir, "p1-handoff-issue-registration-report.json"),
  p1EvidenceIntakeJson: path.join(outDir, "p1-evidence-intake-draft.json"),
  p1EvidenceIntakeCsv: path.join(outDir, "p1-evidence-intake-draft.csv"),
  p1EvidenceIntakeMarkdown: path.join(outDir, "p1-evidence-intake-draft.md"),
  p1EvidenceIntakeReport: path.join(outDir, "p1-evidence-intake-report.json"),
  pilotStatus: path.join(outDir, "pilot-status.json"),
  p1Readiness: path.join(outDir, "p1-readiness.json"),
};

const productionOrigin = text(args.productionOrigin) || text(process.env.FINAL_JUDO_PRODUCTION_ORIGIN);
const releaseSha256 = text(args.releaseSha256);
const appleTeamId = text(args.appleTeamId) || text(process.env.APPLE_TEAM_ID) || text(process.env.IOS_TEAM_ID);
const profilesDir = text(args.profilesDir);
const githubRepo = await resolveGitHubRepository(args.githubRepo, { env: process.env });
const commands = [];

commands.push(
  await runNode("deployment handoff draft", "scripts/create-deployment-handoff-draft.mjs", [
    `--out=${paths.deploymentHandoff}`,
    `--preflight-report=${path.join(outDir, "pilot-preflight.pre-pilot.json")}`,
    ...maybeArg("production-origin", productionOrigin),
  ]),
);
commands.push(
  await runNode("deployment handoff report", "scripts/check-deployment-handoff.mjs", [
    `--file=${paths.deploymentHandoff}`,
    `--out=${paths.deploymentReport}`,
    "--allow-pending",
  ]),
);

commands.push(
  await runNode("PostgreSQL Docker doctor", "scripts/check-postgres-docker-readiness.mjs", [
    `--out=${paths.postgresDockerReadiness}`,
    `--markdown=${paths.postgresDockerReadinessMarkdown}`,
  ]),
);

commands.push(
  await runNode("Android TWA doctor", "scripts/check-android-twa-doctor.mjs", [
    `--out=${paths.androidDoctor}`,
    `--markdown=${paths.androidDoctorMarkdown}`,
    ...maybeArg("origin", productionOrigin),
    ...maybeArg("sha256", releaseSha256),
  ]),
);
commands.push(
  await runNode("Android release handoff draft", "scripts/create-android-release-handoff-draft.mjs", [
    `--out=${paths.androidHandoff}`,
    `--doctor=${paths.androidDoctor}`,
    ...maybeArg("origin", productionOrigin),
    ...maybeArg("sha256", releaseSha256),
  ]),
);
commands.push(
  await runNode("Android release handoff report", "scripts/check-android-release-handoff.mjs", [
    `--file=${paths.androidHandoff}`,
    `--out=${paths.androidReport}`,
    "--allow-pending",
  ]),
);

commands.push(
  await runNode("iOS Capacitor service connection", "scripts/check-ios-capacitor-connection.mjs", [
    `--out=${paths.iosCapacitorConnection}`,
    `--markdown=${paths.iosCapacitorConnectionMarkdown}`,
  ]),
);
commands.push(
  await runNode("iOS IPA doctor", "scripts/check-ios-ipa-doctor.mjs", [
    `--out=${paths.iosIpaDoctor}`,
    `--markdown=${paths.iosIpaDoctorMarkdown}`,
    ...maybeArg("origin", productionOrigin),
    ...maybeArg("team-id", appleTeamId),
    ...maybeArg("profiles-dir", profilesDir),
  ]),
);
commands.push(
  await runNodeAllowFailure("iOS IPA doctor/build report", "scripts/build-ios-ipa.mjs", [
    "--doctor-only",
    `--out-dir=${paths.iosBuildsDir}`,
    ...maybeArg("origin", productionOrigin),
    ...maybeArg("team-id", appleTeamId),
    ...maybeArg("profiles-dir", profilesDir),
  ]),
);

commands.push(
  await runNode("payment provider handoff draft", "scripts/create-payment-provider-handoff-draft.mjs", [
    `--out=${paths.paymentProviderHandoff}`,
    ...maybeArg("checkout-base-url", args.paymentCheckoutBaseUrl),
  ]),
);
commands.push(
  await runNode("payment provider handoff report", "scripts/check-payment-provider-handoff.mjs", [
    `--file=${paths.paymentProviderHandoff}`,
    `--out=${paths.paymentProviderReport}`,
    "--allow-pending",
  ]),
);

commands.push(
  await runNode("notification push handoff draft", "scripts/create-notification-push-handoff-draft.mjs", [
    `--out=${paths.notificationPushHandoff}`,
    ...maybeArg("production-origin", productionOrigin),
  ]),
);
commands.push(
  await runNode("notification push handoff report", "scripts/check-notification-push-handoff.mjs", [
    `--file=${paths.notificationPushHandoff}`,
    `--out=${paths.notificationPushReport}`,
    "--allow-pending",
  ]),
);

commands.push(await runNode("pilot final status audit", "scripts/check-pilot-status.mjs", [`--out=${paths.pilotStatus}`]));
commands.push(
  await runNode("P1 handoff action checklist", "scripts/create-p1-handoff-action-checklist.mjs", [
    `--workspace=${outDir}`,
    `--json=${paths.p1ActionChecklistJson}`,
    `--csv=${paths.p1ActionChecklistCsv}`,
    `--markdown=${paths.p1ActionChecklistMarkdown}`,
    `--brief=${paths.p1ActionBriefMarkdown}`,
    `--owner-package-index=${paths.p1OwnerPackageIndexMarkdown}`,
    `--owner-briefs-dir=${paths.p1OwnerBriefsDir}`,
    `--owner-packages-dir=${paths.p1OwnerPackagesDir}`,
  ]),
);
commands.push(
  await runNode("P1 handoff bundle manifest", "scripts/check-p1-handoff-bundle.mjs", [
    `--workspace=${outDir}`,
    `--out=${paths.p1BundleManifest}`,
  ]),
);
commands.push(
  await runNode("P1 handoff dispatch receipt draft", "scripts/create-p1-handoff-dispatch-draft.mjs", [
    `--bundle=${paths.p1BundleManifest}`,
    `--out=${paths.p1DispatchReceipt}`,
    `--markdown=${paths.p1DispatchMarkdown}`,
    `--csv=${paths.p1DispatchCsv}`,
  ]),
);
commands.push(
  await runNodeAllowFailure("P1 handoff dispatch receipt blocked report", "scripts/check-p1-handoff-dispatch.mjs", [
    `--file=${paths.p1DispatchReceipt}`,
    `--bundle=${paths.p1BundleManifest}`,
    `--out=${paths.p1DispatchReport}`,
  ]),
);
commands.push(
  await runNode("P1 handoff issue drafts", "scripts/create-p1-handoff-issue-drafts.mjs", [
    `--receipt=${paths.p1DispatchReceipt}`,
    `--out-dir=${paths.p1IssueDraftsDir}`,
    ...maybeArg("github-repo", githubRepo),
  ]),
);
commands.push(
  await runNode("P1 handoff issue registration receipt draft", "scripts/create-p1-handoff-issue-receipt-draft.mjs", [
    `--issue-drafts=${paths.p1IssueDraftsJson}`,
    `--out=${paths.p1IssueRegistrationReceipt}`,
    `--markdown=${paths.p1IssueRegistrationMarkdown}`,
  ]),
);
commands.push(
  await runNodeAllowFailure("P1 handoff issue registration blocked report", "scripts/check-p1-handoff-issue-receipt.mjs", [
    `--file=${paths.p1IssueRegistrationReceipt}`,
    `--issue-drafts=${paths.p1IssueDraftsJson}`,
    `--out=${paths.p1IssueRegistrationReport}`,
  ]),
);
commands.push(
  await runNode("P1 readiness audit", "scripts/check-p1-readiness.mjs", [
    `--deployment-report=${paths.deploymentReport}`,
    `--android-report=${paths.androidReport}`,
    `--ios-ipa-report=${paths.iosIpaBuildReport}`,
    `--payment-provider-report=${paths.paymentProviderReport}`,
    `--notification-push-report=${paths.notificationPushReport}`,
    `--issue-registration-report=${paths.p1IssueRegistrationReport}`,
    `--pilot-status=${paths.pilotStatus}`,
    `--out=${paths.p1Readiness}`,
    "--allow-pending",
  ]),
);
commands.push(
  await runNode("P1 evidence intake draft", "scripts/create-p1-evidence-intake-draft.mjs", [
    `--workspace=${outDir}`,
    `--readiness=${paths.p1Readiness}`,
    `--json=${paths.p1EvidenceIntakeJson}`,
    `--csv=${paths.p1EvidenceIntakeCsv}`,
    `--markdown=${paths.p1EvidenceIntakeMarkdown}`,
  ]),
);
commands.push(
  await runNode("P1 evidence intake blocked report", "scripts/check-p1-evidence-intake.mjs", [
    `--workspace=${outDir}`,
    `--file=${paths.p1EvidenceIntakeJson}`,
    `--readiness=${paths.p1Readiness}`,
    `--out=${paths.p1EvidenceIntakeReport}`,
    "--allow-pending",
  ]),
);

const reports = {
  deployment: reportSummary("운영 배포 handoff", paths.deploymentReport, await readJsonIfPresent(paths.deploymentReport)),
  postgresDocker: reportSummary(
    "PostgreSQL Docker readiness",
    paths.postgresDockerReadiness,
    await readJsonIfPresent(paths.postgresDockerReadiness),
  ),
  android: reportSummary("Android release handoff", paths.androidReport, await readJsonIfPresent(paths.androidReport)),
  iosCapacitorConnection: reportSummary(
    "iOS Capacitor service connection",
    paths.iosCapacitorConnection,
    await readJsonIfPresent(paths.iosCapacitorConnection),
  ),
  iosIpaDoctor: reportSummary("iOS IPA doctor", paths.iosIpaDoctor, await readJsonIfPresent(paths.iosIpaDoctor)),
  iosIpa: reportSummary("iOS IPA build/provisioning", paths.iosIpaBuildReport, await readJsonIfPresent(paths.iosIpaBuildReport)),
  paymentProvider: reportSummary("결제 provider handoff", paths.paymentProviderReport, await readJsonIfPresent(paths.paymentProviderReport)),
  notificationPush: reportSummary("운영 푸시 handoff", paths.notificationPushReport, await readJsonIfPresent(paths.notificationPushReport)),
  handoffDispatch: reportSummary("P1 handoff dispatch receipt", paths.p1DispatchReport, await readJsonIfPresent(paths.p1DispatchReport)),
  issueRegistration: reportSummary(
    "P1 handoff issue registration receipt",
    paths.p1IssueRegistrationReport,
    await readJsonIfPresent(paths.p1IssueRegistrationReport),
  ),
  pilot: reportSummary("파일럿 최종 status", paths.pilotStatus, await readJsonIfPresent(paths.pilotStatus)),
  p1Readiness: reportSummary("P1 readiness audit", paths.p1Readiness, await readJsonIfPresent(paths.p1Readiness)),
  evidenceIntake: reportSummary(
    "P1 evidence intake",
    paths.p1EvidenceIntakeReport,
    await readJsonIfPresent(paths.p1EvidenceIntakeReport),
  ),
};
const p1Readiness = await readJsonIfPresent(paths.p1Readiness);
const p1ActionChecklist = await readJsonIfPresent(paths.p1ActionChecklistJson);

const summary = {
  ok: true,
  releaseDecision: p1Readiness?.releaseDecision ?? "blocked",
  generatedAt: new Date().toISOString(),
  draftMode: true,
  outDir: rel(outDir),
  checked: [
    "deployment handoff draft and blocked report",
    "PostgreSQL Docker doctor JSON/Markdown readiness artifact",
    "Android doctor JSON/Markdown, release handoff draft, and blocked report",
    "iOS Capacitor service connection JSON/Markdown report",
    "iOS IPA doctor JSON/Markdown and build blocked report",
    "payment provider handoff draft and blocked report",
    "notification push handoff draft and blocked report",
    "pilot final status audit report",
    "P1 readiness allow-pending audit report",
    "P1 handoff action checklist JSON/CSV/Markdown outputs",
    "P1 handoff owner action brief output",
    "P1 handoff per-owner action brief outputs",
    "P1 handoff per-owner package outputs",
    "P1 handoff owner package index output",
    "P1 handoff bundle manifest output",
    "P1 handoff dispatch receipt draft and blocked report",
    "P1 handoff issue draft, GitHub command/connector/runbook/connector response template/JSON and CSV results templates, and registration plan outputs",
    "P1 handoff issue registration receipt draft and blocked report",
    "P1 readiness allow-pending audit includes blocked issue registration report",
    "P1 final evidence intake JSON/CSV/Markdown outputs",
    "P1 final evidence intake blocked report",
  ],
  artifacts: Object.fromEntries(Object.entries(paths).map(([key, filePath]) => [key, rel(filePath)])),
  reports,
  checklist: {
    ok: p1ActionChecklist?.ok ?? null,
    releaseDecision: p1ActionChecklist?.releaseDecision ?? null,
    outputs: p1ActionChecklist?.outputs ?? {
      csv: rel(paths.p1ActionChecklistCsv),
      json: rel(paths.p1ActionChecklistJson),
      markdown: rel(paths.p1ActionChecklistMarkdown),
    },
    summary: p1ActionChecklist?.summary ?? null,
  },
  p1Summary: p1Readiness?.summary ?? null,
  nextActions:
    p1Readiness?.nextActions?.length > 0
      ? p1Readiness.nextActions
      : [
          "각 handoff JSON의 TODO/증빙 필드를 실제 운영 값으로 채웁니다.",
          "모든 handoff/IPA 리포트와 이슈 등록 receipt 리포트를 ready로 만든 뒤 `npm run p1:readiness -- --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md`를 strict 통과시킵니다.",
        ],
  commands,
};

await mkdir(path.dirname(summaryPath), { recursive: true });
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify({ ...summary, summaryPath: rel(summaryPath) }, null, 2));
