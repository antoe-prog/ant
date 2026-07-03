import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-handoff-draft-"));
const rawPaymentSecret = "sk_live_finaljudo_payment_secret_that_must_not_be_written";
const rawPostgresPassword = "postgres_super_secret_that_must_not_be_written";
const rawPostgresUrl = `postgresql://pilot:${rawPostgresPassword}@db.finaljudo.test:5432/final_judo`;
const rawVapidPrivateKey = "-----BEGIN PRIVATE KEY-----\nfinal-judo-vapid-private-key\n-----END PRIVATE KEY-----";

const { stdout } = await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-draft-workspace.mjs",
    `--out-dir=${directory}`,
    "--production-origin=https://app.finaljudo.kr",
    "--payment-checkout-base-url=https://pay.finaljudo.kr",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: rawPaymentSecret,
      FINAL_JUDO_POSTGRES_DOCTOR_MOCK_DOCKER: "daemon-down",
      FINAL_JUDO_POSTGRES_STATE_KEY: "pilot-runtime",
      FINAL_JUDO_POSTGRES_TABLE: "app_runtime_state",
      FINAL_JUDO_POSTGRES_URL: rawPostgresUrl,
      FINAL_JUDO_VAPID_PUBLIC_KEY: "configured-test-public-key",
      FINAL_JUDO_VAPID_PRIVATE_KEY: rawVapidPrivateKey,
      FINAL_JUDO_VAPID_SUBJECT: "mailto:ops@finaljudo.kr",
      GITHUB_REPOSITORY: "antoe-prog/ant",
    },
  },
);

const summary = JSON.parse(stdout);
const summaryFile = path.join(directory, "p1-handoff-draft-workspace.json");
const summarySource = await readFile(summaryFile, "utf8");
const expectedFiles = [
  "deployment-handoff.json",
  "deployment-handoff.report.json",
  "postgres-docker-readiness.json",
  "postgres-docker-readiness.md",
  "android-twa-doctor.json",
  "android-twa-doctor.md",
  "android-release-handoff.json",
  "android-release-handoff.report.json",
  "mobile-builds/ios/ios-capacitor-connection.json",
  "mobile-builds/ios/ios-capacitor-connection.md",
  "mobile-builds/ios/ios-ipa-doctor.json",
  "mobile-builds/ios/ios-ipa-doctor.md",
  "mobile-builds/ios/ios-ipa-build-report.json",
  "payment-provider-handoff.json",
  "payment-provider-handoff.report.json",
  "notification-push-handoff.json",
  "notification-push-handoff.report.json",
  "p1-handoff-action-checklist.csv",
  "p1-handoff-action-checklist.json",
  "p1-handoff-action-checklist.md",
  "p1-handoff-action-brief.md",
  "p1-handoff-owner-package-index.md",
  "p1-handoff-bundle-manifest.json",
  "p1-handoff-dispatch-receipt.json",
  "p1-handoff-dispatch-report.json",
  "p1-handoff-dispatch-receipt.md",
  "p1-handoff-dispatch-receipt.csv",
  "p1-handoff-issue-drafts/github-connector-issue-responses.template.json",
  "p1-handoff-issue-drafts/github-connector-runbook.md",
  "p1-handoff-issue-drafts/github-issue-create-results.template.csv",
  "p1-handoff-issue-registration-receipt.json",
  "p1-handoff-issue-registration-report.json",
  "p1-handoff-issue-registration-receipt.md",
  "p1-evidence-intake-draft.json",
  "p1-evidence-intake-draft.csv",
  "p1-evidence-intake-draft.md",
  "p1-evidence-intake-report.json",
  "pilot-status.json",
  "p1-readiness.json",
  "p1-handoff-draft-workspace.json",
];

async function readJson(name) {
  return JSON.parse(await readFile(path.join(directory, name), "utf8"));
}

assert.equal(summary.ok, true);
assert.equal(summary.draftMode, true);
assert.equal(summary.releaseDecision, "blocked");
assert.equal(summary.p1Summary.total, 7);
assert.equal(summary.p1Summary.ready, 0);
assert.equal(summary.p1Summary.missing, 0);
assert.equal(summary.p1Summary.blocked, 7);
assert.equal(summary.commands.length, 24);
assert.equal(summary.checklist.releaseDecision, "blocked");
assert(summary.checklist.summary.totalActions > 100);
assert.equal(summary.checklist.outputs.json.endsWith("p1-handoff-action-checklist.json"), true);
assert.equal(summary.checklist.outputs.brief.endsWith("p1-handoff-action-brief.md"), true);
assert.equal(summary.checklist.outputs.ownerPackageIndex.endsWith("p1-handoff-owner-package-index.md"), true);
assert.equal(summary.checklist.outputs.ownerBriefsDir.endsWith("p1-handoff-owner-briefs"), true);
assert.equal(summary.checklist.outputs.ownerPackagesDir.endsWith("p1-handoff-owner-packages"), true);
assert.equal(summary.artifacts.p1OwnerPackageIndexMarkdown.endsWith("p1-handoff-owner-package-index.md"), true);
assert.equal(summary.artifacts.p1OwnerBriefsDir.endsWith("p1-handoff-owner-briefs"), true);
assert.equal(summary.artifacts.p1OwnerPackagesDir.endsWith("p1-handoff-owner-packages"), true);
assert.equal(summary.artifacts.postgresDockerReadiness.endsWith("postgres-docker-readiness.json"), true);
assert.equal(summary.artifacts.postgresDockerReadinessMarkdown.endsWith("postgres-docker-readiness.md"), true);
assert.equal(summary.artifacts.androidDoctorMarkdown.endsWith("android-twa-doctor.md"), true);
assert.equal(summary.artifacts.iosCapacitorConnection.endsWith("mobile-builds/ios/ios-capacitor-connection.json"), true);
assert.equal(summary.artifacts.iosCapacitorConnectionMarkdown.endsWith("mobile-builds/ios/ios-capacitor-connection.md"), true);
assert.equal(summary.artifacts.iosIpaDoctor.endsWith("mobile-builds/ios/ios-ipa-doctor.json"), true);
assert.equal(summary.artifacts.iosIpaDoctorMarkdown.endsWith("mobile-builds/ios/ios-ipa-doctor.md"), true);
assert.equal(summary.artifacts.iosIpaBuildReport.endsWith("mobile-builds/ios/ios-ipa-build-report.json"), true);
assert.equal(summary.artifacts.p1BundleManifest.endsWith("p1-handoff-bundle-manifest.json"), true);
assert.equal(summary.artifacts.p1DispatchReceipt.endsWith("p1-handoff-dispatch-receipt.json"), true);
assert.equal(summary.artifacts.p1DispatchCsv.endsWith("p1-handoff-dispatch-receipt.csv"), true);
assert.equal(summary.artifacts.p1IssueDraftsDir.endsWith("p1-handoff-issue-drafts"), true);
assert.equal(summary.artifacts.p1IssueGithubCommands.endsWith("github-issue-create-commands.sh"), true);
assert.equal(summary.artifacts.p1IssueGithubConnectorPayloads.endsWith("github-connector-issue-payloads.json"), true);
assert.equal(summary.artifacts.p1IssueGithubConnectorResponsesTemplate.endsWith("github-connector-issue-responses.template.json"), true);
assert.equal(summary.artifacts.p1IssueGithubConnectorRunbook.endsWith("github-connector-runbook.md"), true);
assert.equal(summary.artifacts.p1IssueGithubResultsTemplate.endsWith("github-issue-create-results.template.json"), true);
assert.equal(summary.artifacts.p1IssueGithubResultsCsvTemplate.endsWith("github-issue-create-results.template.csv"), true);
assert.equal(summary.artifacts.p1IssueRegistrationPlan.endsWith("issue-registration-plan.json"), true);
assert.equal(summary.artifacts.p1IssueRegistrationReport.endsWith("p1-handoff-issue-registration-report.json"), true);
assert.equal(summary.artifacts.p1EvidenceIntakeJson.endsWith("p1-evidence-intake-draft.json"), true);
assert.equal(summary.artifacts.p1EvidenceIntakeCsv.endsWith("p1-evidence-intake-draft.csv"), true);
assert.equal(summary.artifacts.p1EvidenceIntakeMarkdown.endsWith("p1-evidence-intake-draft.md"), true);
assert.equal(summary.artifacts.p1EvidenceIntakeReport.endsWith("p1-evidence-intake-report.json"), true);
assert.equal(summary.reports.issueRegistration.releaseDecision, "blocked");
assert.equal(summary.reports.evidenceIntake.releaseDecision, "blocked");
assert.equal(summary.reports.postgresDocker.releaseDecision, "blocked");
assert.equal(summary.reports.postgresDocker.blockerCount, 1);
assert.equal(summary.reports.iosCapacitorConnection.releaseDecision, "simulator_connected_release_blocked");
assert.equal(summary.reports.iosIpaDoctor.releaseDecision, "blocked");
assert(summary.nextActions.length > 0);
assert(!summarySource.includes(rawPaymentSecret), "workspace summary must not include raw payment webhook secret");
assert(!summarySource.includes(rawPostgresPassword), "workspace summary must not include raw Postgres password");
assert(!summarySource.includes(rawPostgresUrl), "workspace summary must not include raw Postgres URL");
assert(!summarySource.includes(rawVapidPrivateKey), "workspace summary must not include raw VAPID private key");

for (const fileName of expectedFiles) {
  const filePath = path.join(directory, fileName);
  const source = await readFile(filePath, "utf8");
  assert(source.length > 0, `${fileName} must be written`);
  assert(!source.includes(rawPaymentSecret), `${fileName} must not contain raw payment webhook secret`);
  assert(!source.includes(rawPostgresPassword), `${fileName} must not contain raw Postgres password`);
  assert(!source.includes(rawPostgresUrl), `${fileName} must not contain raw Postgres URL`);
  assert(!source.includes(rawVapidPrivateKey), `${fileName} must not contain raw VAPID private key`);
}

const readiness = await readJson("p1-readiness.json");
assert.equal(readiness.ok, false);
assert.equal(readiness.releaseDecision, "blocked");
assert.equal(readiness.summary.total, 7);
assert.equal(readiness.summary.missing, 0);
assert.equal(readiness.summary.blocked, 7);
assert.equal(readiness.requirements.issueRegistration.status, "blocked");
assert.equal(readiness.requirements.notificationPush.status, "blocked");
assert.equal(readiness.requirements.paymentProvider.status, "blocked");
assert.equal(readiness.requirements.android.status, "blocked");
assert.equal(readiness.requirements.iosIpa.status, "blocked");

const androidDoctorMarkdown = await readFile(path.join(directory, "android-twa-doctor.md"), "utf8");
assert(androidDoctorMarkdown.includes("# Android TWA Doctor"));
assert(androidDoctorMarkdown.includes("| Check | Status | Detail |"));
assert(androidDoctorMarkdown.includes("## Next Actions"));
assert(!androidDoctorMarkdown.includes(rawPaymentSecret), "Android doctor Markdown must not contain raw payment webhook secret");
assert(!androidDoctorMarkdown.includes(rawVapidPrivateKey), "Android doctor Markdown must not contain raw VAPID private key");

const iosCapacitorConnection = await readJson("mobile-builds/ios/ios-capacitor-connection.json");
const iosCapacitorConnectionMarkdown = await readFile(path.join(directory, "mobile-builds", "ios", "ios-capacitor-connection.md"), "utf8");
assert.equal(iosCapacitorConnection.ok, true);
assert.equal(iosCapacitorConnection.serviceRoute, "/app/dashboard");
assert.equal(iosCapacitorConnection.releaseDecision, "simulator_connected_release_blocked");
assert.equal(iosCapacitorConnection.checks.nativeBridge.ok, true);
assert(iosCapacitorConnectionMarkdown.includes("# iOS Capacitor Service Connection"));
assert(iosCapacitorConnectionMarkdown.includes("IOS_SIMULATOR_CONNECTION_ONLY"));
assert(!iosCapacitorConnectionMarkdown.includes(rawPaymentSecret), "iOS connection Markdown must not contain raw payment webhook secret");
assert(!iosCapacitorConnectionMarkdown.includes(rawVapidPrivateKey), "iOS connection Markdown must not contain raw VAPID private key");

const iosIpaDoctor = await readJson("mobile-builds/ios/ios-ipa-doctor.json");
const iosIpaDoctorMarkdown = await readFile(path.join(directory, "mobile-builds", "ios", "ios-ipa-doctor.md"), "utf8");
assert.equal(iosIpaDoctor.ok, false);
assert.equal(iosIpaDoctor.releaseDecision, "blocked");
assert(iosIpaDoctor.blockers.length > 0);
assert(iosIpaDoctorMarkdown.includes("# iOS IPA Doctor"));
assert(iosIpaDoctorMarkdown.includes("## Provisioning Hints"));
assert(iosIpaDoctorMarkdown.includes("FINAL_JUDO_IOS_SERVER_URL"));
assert(!iosIpaDoctorMarkdown.includes(rawPaymentSecret), "iOS IPA doctor Markdown must not contain raw payment webhook secret");
assert(!iosIpaDoctorMarkdown.includes(rawVapidPrivateKey), "iOS IPA doctor Markdown must not contain raw VAPID private key");

const postgresDockerReadiness = await readJson("postgres-docker-readiness.json");
const postgresDockerReadinessMarkdown = await readFile(path.join(directory, "postgres-docker-readiness.md"), "utf8");
assert.equal(postgresDockerReadiness.releaseDecision, "blocked");
assert.equal(postgresDockerReadiness.docker.cliAvailable, true);
assert.equal(postgresDockerReadiness.docker.daemonRunning, false);
assert(postgresDockerReadiness.blockers.some((blocker) => blocker.code === "POSTGRES_DOCKER_DAEMON_DOWN"));
assert(postgresDockerReadinessMarkdown.includes("# PostgreSQL Docker Readiness"));
assert(postgresDockerReadinessMarkdown.includes("Docker daemon"));
assert(postgresDockerReadinessMarkdown.includes("npm run test:postgres-store"));
assert(postgresDockerReadinessMarkdown.includes("REDACTED"));
assert(!postgresDockerReadinessMarkdown.includes(rawPaymentSecret), "Postgres doctor Markdown must not contain raw payment webhook secret");
assert(!postgresDockerReadinessMarkdown.includes(rawPostgresPassword), "Postgres doctor Markdown must not contain raw Postgres password");
assert(!postgresDockerReadinessMarkdown.includes(rawPostgresUrl), "Postgres doctor Markdown must not contain raw Postgres URL");
assert(!postgresDockerReadinessMarkdown.includes(rawVapidPrivateKey), "Postgres doctor Markdown must not contain raw VAPID private key");

const evidenceIntake = await readJson("p1-evidence-intake-draft.json");
const evidenceIntakeCsv = await readFile(path.join(directory, "p1-evidence-intake-draft.csv"), "utf8");
const evidenceIntakeMarkdown = await readFile(path.join(directory, "p1-evidence-intake-draft.md"), "utf8");
const evidenceIntakeReport = await readJson("p1-evidence-intake-report.json");
assert.equal(evidenceIntake.releaseDecision, "blocked");
assert.equal(evidenceIntake.summary.total, 7);
assert.equal(evidenceIntake.summary.blocked, 7);
assert.deepEqual(
  evidenceIntake.rows.map((row) => row.lane),
  ["DevOps/총괄 PM", "Android/Release", "iOS/Release", "Backend/Data", "Frontend/QA", "Product Lead", "QA/Release"],
);
assert(evidenceIntake.rows.every((row) => row.intake.evidenceOwner === "TODO owner name"));
assert(evidenceIntakeCsv.includes("key,label,lane,status"));
assert(evidenceIntakeMarkdown.includes("# P1 Evidence Intake Draft"));
assert(evidenceIntakeMarkdown.includes("P1 handoff issue registration receipt"));
assert.equal(evidenceIntakeReport.releaseDecision, "blocked");
assert.equal(evidenceIntakeReport.summary.rows, 7);
assert(evidenceIntakeReport.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_READINESS_NOT_READY"));
assert(evidenceIntakeReport.blockers.some((blocker) => blocker.code === "P1_EVIDENCE_INTAKE_OWNER_MISSING"));

const actionChecklist = await readJson("p1-handoff-action-checklist.json");
assert.equal(actionChecklist.releaseDecision, "blocked");
assert.equal(actionChecklist.summary.sources, 6);
assert.equal(actionChecklist.summary.readySources, 0);
assert(actionChecklist.summary.totalActions > 100);
assert.equal(actionChecklist.checklist.length, actionChecklist.summary.totalActions);
assert.equal(actionChecklist.outputs.brief.endsWith("p1-handoff-action-brief.md"), true);
assert.equal(actionChecklist.outputs.ownerPackageIndex.endsWith("p1-handoff-owner-package-index.md"), true);
assert.equal(actionChecklist.outputs.ownerBriefsDir.endsWith("p1-handoff-owner-briefs"), true);
assert.equal(actionChecklist.outputs.ownerPackagesDir.endsWith("p1-handoff-owner-packages"), true);
assert.equal(actionChecklist.teamSummary.length, 6);
assert(actionChecklist.teamSummary.some((item) => item.teamAgents.includes("Product Lead + QA/Release")));
assert(actionChecklist.teamSummary.every((item) => item.briefPath.includes("p1-handoff-owner-briefs")));
assert(actionChecklist.teamSummary.every((item) => item.packageDir.includes("p1-handoff-owner-packages")));
assert(actionChecklist.teamSummary.every((item) => item.packageManifest.includes("package-manifest.json")));
assert.deepEqual(
  [...new Set(actionChecklist.checklist.map((row) => row.areaKey))].sort(),
  ["android", "deployment", "iosIpa", "notificationPush", "paymentProvider", "pilot"],
);

const actionBrief = await readFile(path.join(directory, "p1-handoff-action-brief.md"), "utf8");
const ownerPackageIndex = await readFile(path.join(directory, "p1-handoff-owner-package-index.md"), "utf8");
const ownerBriefNames = await readdir(path.join(directory, "p1-handoff-owner-briefs"));
const ownerBriefSources = await Promise.all(
  ownerBriefNames.map((name) => readFile(path.join(directory, "p1-handoff-owner-briefs", name), "utf8")),
);
const ownerPackageNames = await readdir(path.join(directory, "p1-handoff-owner-packages"));
const ownerPackageEntries = await Promise.all(
  ownerPackageNames.map(async (name) => {
    const packageDir = path.join(directory, "p1-handoff-owner-packages", name);
    const files = await readdir(packageDir);
    const sources = await Promise.all(files.map((fileName) => readFile(path.join(packageDir, fileName), "utf8")));
    const manifest = JSON.parse(await readFile(path.join(packageDir, "package-manifest.json"), "utf8"));

    return { name, files, sources, manifest };
  }),
);
const ownerPackageSources = ownerPackageEntries.flatMap((entry) => entry.sources);
assert(actionBrief.includes("# P1 Handoff Action Brief"));
assert(actionBrief.includes("## 6인 팀 실행 순서"));
assert(actionBrief.includes("담당자별 우선 처리"));
assert(actionBrief.includes("Product Lead"));
assert(actionBrief.includes("QA/Release"));
assert(ownerPackageIndex.includes("# P1 Handoff Owner Package Index"));
assert(ownerPackageIndex.includes("## Package 목록"));
assert(ownerPackageIndex.includes("02-mobile-release"));
assert(ownerPackageIndex.includes("03-ios-release"));
assert(ownerPackageIndex.includes("npm run android:release-handoff"));
assert(ownerPackageIndex.includes("npm run ios:ipa:doctor"));
assert.equal(ownerBriefNames.length, 6);
assert(ownerBriefSources.some((source) => source.includes("# P1 Handoff Owner Brief - Mobile/Release")));
assert(ownerBriefSources.some((source) => source.includes("# P1 Handoff Owner Brief - iOS/Release")));
assert(ownerBriefSources.every((source) => source.includes("## 바로 열 파일")));
assert(ownerBriefSources.every((source) => source.includes("## 완료 후")));
assert.equal(ownerPackageNames.length, 6);
assert(
  ownerPackageEntries.every((entry) =>
    ["blocked-report.json", "brief.md", "evidence-draft.json", "package-manifest.json"].every((fileName) => entry.files.includes(fileName)),
  ),
);
assert(ownerPackageEntries.some((entry) => entry.name === "02-mobile-release"));
assert(ownerPackageEntries.some((entry) => entry.name === "03-ios-release"));
assert(ownerPackageEntries.every((entry) => entry.manifest.evidenceDrafts.length > 0));
assert(ownerPackageEntries.every((entry) => entry.manifest.sourceReports.length > 0));
assert(ownerPackageSources.some((source) => source.includes("# P1 Handoff Owner Brief - Mobile/Release")));
assert(ownerPackageSources.some((source) => source.includes("# P1 Handoff Owner Brief - iOS/Release")));
assert(!ownerPackageSources.join("\n").includes(rawPaymentSecret), "owner packages must not contain raw payment webhook secret");
assert(!ownerPackageSources.join("\n").includes(rawVapidPrivateKey), "owner packages must not contain raw VAPID private key");

const bundleManifest = await readJson("p1-handoff-bundle-manifest.json");
assert.equal(bundleManifest.releaseDecision, "ready");
assert.equal(bundleManifest.p1ReleaseDecision, "blocked");
assert.equal(bundleManifest.ownerPackages.length, 6);

const dispatchReport = await readJson("p1-handoff-dispatch-report.json");
assert.equal(dispatchReport.releaseDecision, "blocked");
assert.equal(dispatchReport.summary.ownerPackages, 6);
assert.equal(dispatchReport.summary.acknowledged, 0);

const issueDraftManifest = await readJson("p1-handoff-issue-drafts/issue-drafts.json");
const issueDraftIndex = await readFile(path.join(directory, "p1-handoff-issue-drafts", "index.md"), "utf8");
const issueDraftCommands = await readFile(path.join(directory, "p1-handoff-issue-drafts", "github-issue-create-commands.sh"), "utf8");
const issueDraftConnectorPayloads = await readJson("p1-handoff-issue-drafts/github-connector-issue-payloads.json");
const issueDraftConnectorResponsesTemplate = await readJson("p1-handoff-issue-drafts/github-connector-issue-responses.template.json");
const issueDraftConnectorRunbook = await readFile(path.join(directory, "p1-handoff-issue-drafts", "github-connector-runbook.md"), "utf8");
const issueDraftResultsTemplate = await readJson("p1-handoff-issue-drafts/github-issue-create-results.template.json");
const issueDraftResultsCsvTemplate = await readFile(path.join(directory, "p1-handoff-issue-drafts", "github-issue-create-results.template.csv"), "utf8");
const issueRegistrationPlan = await readJson("p1-handoff-issue-drafts/issue-registration-plan.json");
assert.equal(issueDraftManifest.releaseDecision, "blocked");
assert.equal(issueDraftManifest.issueDrafts.length, 6);
assert.equal(issueDraftManifest.githubIssueCreateCommands.endsWith("github-issue-create-commands.sh"), true);
assert.equal(issueDraftManifest.githubIssueConnectorPayloads.endsWith("github-connector-issue-payloads.json"), true);
assert.equal(issueDraftManifest.githubIssueConnectorResponsesTemplate.endsWith("github-connector-issue-responses.template.json"), true);
assert.equal(issueDraftManifest.githubIssueConnectorRunbook.endsWith("github-connector-runbook.md"), true);
assert.equal(issueDraftManifest.githubIssueCreateResultsTemplate.endsWith("github-issue-create-results.template.json"), true);
assert.equal(issueDraftManifest.githubIssueCreateResultsCsvTemplate.endsWith("github-issue-create-results.template.csv"), true);
assert.equal(issueDraftManifest.issueRegistrationPlan.endsWith("issue-registration-plan.json"), true);
assert.equal(issueDraftManifest.publishReady, false);
assert(issueDraftIndex.includes("# P1 Handoff Issue Draft Index"));
assert(issueDraftCommands.includes("publishReady=false"));
assert(issueDraftCommands.includes("exit 1"));
assert(!issueDraftCommands.includes("gh issue create"));
assert.equal(issueDraftConnectorPayloads.issuePayloads.length, 6);
assert.equal(issueDraftConnectorPayloads.publishReady, false);
assert.equal(issueDraftConnectorPayloads.publishGuard, "blocked_until_dispatch_receipt_ready");
assert.equal(issueDraftConnectorPayloads.connector, "mcp__codex_apps__github._create_issue");
assert.equal(issueDraftConnectorPayloads.githubRepo, "antoe-prog/ant");
assert.equal(issueDraftConnectorPayloads.issuePayloads[0].createIssueInput.repository_full_name, "antoe-prog/ant");
assert.equal(issueDraftConnectorPayloads.outputs.connectorResponsesTemplate.endsWith("github-connector-issue-responses.template.json"), true);
assert(issueDraftConnectorPayloads.instructions[0].includes("아직 호출하지 않습니다"));
assert.equal(issueDraftConnectorResponsesTemplate.responses.length, 6);
assert.equal(issueDraftConnectorResponsesTemplate.publishReady, false);
assert.equal(issueDraftConnectorResponsesTemplate.responses[0].html_url.includes("TODO"), true);
assert.equal(issueDraftConnectorResponsesTemplate.responses[0].acknowledgement.status, "pending");
assert(issueDraftConnectorRunbook.includes("# P1 GitHub Connector Runbook"));
assert(issueDraftConnectorRunbook.includes("Publish ready: `false`"));
assert(issueDraftConnectorRunbook.includes("Do not call the GitHub connector yet."));
assert(issueDraftConnectorRunbook.includes("github-connector-issue-responses.json"));
assert.equal(issueDraftResultsTemplate.registrations.length, 6);
assert.equal(issueDraftResultsTemplate.publishReady, false);
assert(issueDraftResultsTemplate.instructions[0].includes("아직 만들지 않습니다"));
assert.equal(issueDraftResultsTemplate.registrations[0].external.url.includes("TODO"), true);
assert(issueDraftResultsCsvTemplate.includes("packageDir,title,issueDraftPath,system,postedBy,postedAt,url,id,assignee,evidence,acknowledgementStatus,acknowledgedAt,acknowledgementEvidence"));
assert(issueDraftResultsCsvTemplate.includes("TODO operator account"));
assert.equal(issueRegistrationPlan.publishReady, false);
assert.equal(issueRegistrationPlan.publishGuard, "blocked_until_dispatch_receipt_ready");
assert(issueRegistrationPlan.nextActions[0].includes("아직 발행하지 않습니다"));
assert.equal(issueRegistrationPlan.issueDrafts.length, 6);

const issueRegistrationReport = await readJson("p1-handoff-issue-registration-report.json");
assert.equal(issueRegistrationReport.releaseDecision, "blocked");
assert.equal(issueRegistrationReport.summary.issueDrafts, 6);
assert.equal(issueRegistrationReport.summary.registrations, 6);
assert.equal(issueRegistrationReport.summary.registered, 0);
assert.equal(issueRegistrationReport.summary.acknowledged, 0);

const notificationDraft = await readJson("notification-push-handoff.json");
assert.equal(notificationDraft.production.origin, "https://app.finaljudo.kr");
assert.equal(notificationDraft.vapid.privateKeyStored, true);
assert.equal(notificationDraft.vapid.privateKeySecretName, "FINAL_JUDO_VAPID_PRIVATE_KEY");

const paymentDraft = await readJson("payment-provider-handoff.json");
assert.equal(paymentDraft.checkout.baseUrl, "https://pay.finaljudo.kr");
assert.equal(paymentDraft.webhook.secretStored, true);
assert.equal(paymentDraft.webhook.secretName, "FINAL_JUDO_PAYMENT_WEBHOOK_SECRET");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "P1 handoff draft workspace writes all draft/report artifacts",
        "P1 readiness allow-pending summary includes seven final readiness requirements",
        "operator env values are inferred without writing raw secrets",
        "PostgreSQL Docker doctor JSON/Markdown readiness artifacts are generated with the draft workspace",
        "Android TWA doctor Markdown report is generated with the draft workspace",
        "iOS Capacitor service connection report is generated with the draft workspace",
        "iOS IPA doctor JSON/Markdown report is generated with the draft workspace",
        "iOS IPA build/provisioning report is generated with the draft workspace",
        "blocked handoff reports remain visible for next actions",
        "handoff action checklist JSON/CSV/Markdown outputs are generated with the draft workspace",
        "handoff owner action brief is generated with the draft workspace",
        "per-owner handoff action briefs are generated with the draft workspace",
        "per-owner handoff packages are generated with the draft workspace",
        "owner package index is generated with the draft workspace",
        "handoff bundle, dispatch receipt, issue draft, and issue registration blocked reports are generated with the draft workspace",
        "GitHub issue creation command file, connector payload, connector runbook, JSON/CSV results templates, and issue registration plan are generated with the draft workspace",
        "P1 evidence intake strict blocked report is generated with the draft workspace",
      ],
    },
    null,
    2,
  ),
);
