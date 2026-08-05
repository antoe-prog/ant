import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-handoff-checklist-"));
const emptyProfilesDirectory = path.join(directory, "empty-provisioning-profiles");
const rawPaymentSecret = "sk_live_finaljudo_payment_secret_that_must_not_be_written";
const rawVapidPrivateKey = "-----BEGIN PRIVATE KEY-----\nfinal-judo-vapid-private-key\n-----END PRIVATE KEY-----";

await mkdir(emptyProfilesDirectory, { recursive: true });

await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-draft-workspace.mjs",
    `--out-dir=${directory}`,
    "--production-origin=https://app.finaljudo.kr",
    "--payment-checkout-base-url=https://pay.finaljudo.kr",
    `--profiles-dir=${emptyProfilesDirectory}`,
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: rawPaymentSecret,
      FINAL_JUDO_VAPID_PUBLIC_KEY: "configured-test-public-key",
      FINAL_JUDO_VAPID_PRIVATE_KEY: rawVapidPrivateKey,
      FINAL_JUDO_VAPID_SUBJECT: "mailto:ops@finaljudo.kr",
    },
  },
);

const { stdout } = await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-action-checklist.mjs",
    `--workspace=${directory}`,
    `--json=${path.join(directory, "checklist.json")}`,
    `--csv=${path.join(directory, "checklist.csv")}`,
    `--markdown=${path.join(directory, "checklist.md")}`,
    `--brief=${path.join(directory, "brief.md")}`,
    `--owner-package-index=${path.join(directory, "owner-package-index.md")}`,
    `--owner-briefs-dir=${path.join(directory, "owner-briefs")}`,
    `--owner-packages-dir=${path.join(directory, "owner-packages")}`,
  ],
  { cwd: process.cwd() },
);

const jsonSource = await readFile(path.join(directory, "checklist.json"), "utf8");
const stdoutReport = JSON.parse(stdout);
const report = JSON.parse(jsonSource);
const csvSource = await readFile(path.join(directory, "checklist.csv"), "utf8");
const markdownSource = await readFile(path.join(directory, "checklist.md"), "utf8");
const briefSource = await readFile(path.join(directory, "brief.md"), "utf8");
const ownerPackageIndexSource = await readFile(path.join(directory, "owner-package-index.md"), "utf8");
const ownerBriefNames = await readdir(path.join(directory, "owner-briefs"));
const ownerBriefSources = await Promise.all(
  ownerBriefNames.map((name) => readFile(path.join(directory, "owner-briefs", name), "utf8")),
);
const ownerPackageNames = await readdir(path.join(directory, "owner-packages"));
const ownerPackageEntries = await Promise.all(
  ownerPackageNames.map(async (name) => {
    const packageDir = path.join(directory, "owner-packages", name);
    const files = await readdir(packageDir);
    const sources = await Promise.all(files.map((fileName) => readFile(path.join(packageDir, fileName), "utf8")));
    const manifest = JSON.parse(await readFile(path.join(packageDir, "package-manifest.json"), "utf8"));

    return { name, files, sources, manifest };
  }),
);
const ownerPackageSources = ownerPackageEntries.flatMap((entry) => entry.sources);
const combinedOutput = [jsonSource, csvSource, markdownSource, briefSource, ownerPackageIndexSource, ...ownerBriefSources, ...ownerPackageSources].join("\n");
const areaKeys = new Set(report.checklist.map((row) => row.areaKey));
const teamAgents = new Set(report.checklist.flatMap((row) => row.teamAgent.split(" + ")));

assert.equal(report.ok, false);
assert.equal(report.releaseDecision, "blocked");
assert.equal(report.summary.sources, 6);
assert.equal(report.summary.readySources, 0);
assert.equal(report.summary.blockedSources, 6);
assert(report.summary.totalActions > 100, "fixture should expose detailed external handoff actions");
assert.equal(report.checklist.length, report.summary.totalActions);
assert.equal(stdoutReport.checklistCount, report.summary.totalActions);
assert.equal(stdoutReport.checklist, undefined);
assert.deepEqual([...areaKeys].sort(), ["android", "deployment", "iosIpa", "notificationPush", "paymentProvider", "pilot"]);
assert([...teamAgents].includes("Product Lead"));
assert([...teamAgents].includes("Frontend"));
assert([...teamAgents].includes("Backend/Data"));
assert([...teamAgents].includes("QA/Release"));
assert(report.nextActions.length >= 6);
assert(report.outputs.json.endsWith("checklist.json"));
assert(report.outputs.brief.endsWith("brief.md"));
assert(report.outputs.ownerPackageIndex.endsWith("owner-package-index.md"));
assert(report.outputs.ownerBriefsDir.endsWith("owner-briefs"));
assert(report.outputs.ownerPackagesDir.endsWith("owner-packages"));
assert.equal(report.teamSummary.length, 6);
assert(stdoutReport.teamSummary.length === report.teamSummary.length);
assert.equal(ownerBriefNames.length, 6);
assert.equal(ownerPackageNames.length, 6);
assert(report.teamSummary.every((item) => item.briefPath.includes("owner-briefs")));
assert(report.teamSummary.every((item) => item.packageDir.includes("owner-packages")));
assert(report.teamSummary.every((item) => item.packageManifest.includes("package-manifest.json")));
assert(
  ownerPackageEntries.every((entry) =>
    ["blocked-report.json", "brief.md", "team-agent-prompts.md", "evidence-draft.json", "package-manifest.json"].every((fileName) =>
      entry.files.includes(fileName),
    ),
  ),
);
assert(ownerPackageEntries.every((entry) => entry.manifest.evidenceDrafts.length > 0));
assert(ownerPackageEntries.every((entry) => entry.manifest.sourceReports.length > 0));
assert(ownerPackageEntries.every((entry) => entry.manifest.teamAgentPrompts?.path?.endsWith("team-agent-prompts.md")));
assert(ownerPackageEntries.every((entry) => entry.manifest.strictCommands.every((command) => command.startsWith("npm run "))));

assert(csvSource.startsWith("id,priority,status,areaKey,areaLabel,ownerRole,teamAgent,blockerCode"));
assert(csvSource.includes("deployment,"));
assert(csvSource.includes("iosIpa,"));
assert(csvSource.includes("notificationPush,"));
assert(markdownSource.includes("# P1 Handoff Action Checklist"));
assert(markdownSource.includes("운영 배포 handoff"));
assert(markdownSource.includes("Android release handoff"));
assert(markdownSource.includes("iOS IPA build/provisioning"));
assert(markdownSource.includes("운영 푸시 handoff"));
assert(markdownSource.includes("파일럿 최종 status"));
assert(briefSource.includes("# P1 Handoff Action Brief"));
assert(briefSource.includes("## 6인 팀 실행 순서"));
assert(briefSource.includes("Product Lead"));
assert(briefSource.includes("QA/Release"));
assert(briefSource.includes("담당자별 우선 처리"));
assert(ownerPackageIndexSource.includes("# P1 Handoff Owner Package Index"));
assert(ownerPackageIndexSource.includes("## Package 목록"));
assert(ownerPackageIndexSource.includes("01-devops-pm"));
assert(ownerPackageIndexSource.includes("03-ios-release"));
assert(ownerPackageIndexSource.includes("npm run deployment:handoff"));
assert(ownerPackageIndexSource.includes("npm run ios:ipa:doctor"));
assert(ownerBriefSources.some((source) => source.includes("# P1 Handoff Owner Brief - DevOps/총괄 PM")));
assert(ownerBriefSources.some((source) => source.includes("# P1 Handoff Owner Brief - iOS/Release")));
assert(ownerBriefSources.every((source) => source.includes("## 우선 action")));
assert(ownerBriefSources.every((source) => source.includes("## 실행 명령")));
assert(ownerPackageSources.some((source) => source.includes("# P1 Handoff Owner Brief - Mobile/Release")));
assert(ownerPackageSources.some((source) => source.includes("# P1 Handoff Owner Brief - iOS/Release")));
assert(ownerPackageSources.some((source) => source.includes("파이널 유도 멀티짐 11팀 하위 에이전트 운영 프롬프트")));
assert(ownerPackageSources.some((source) => source.includes('"checked"')));

assert(!combinedOutput.includes(rawPaymentSecret), "checklist outputs must not include raw payment webhook secret");
assert(!combinedOutput.includes(rawVapidPrivateKey), "checklist outputs must not include raw VAPID private key");
assert(report.checklist.every((row) => row.strictCommand.startsWith("npm run ")));
assert(report.checklist.every((row) => row.evidenceDraft.length > 0));
assert(report.checklist.every((row) => row.teamAgent.length > 0));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "P1 handoff blocked reports are converted to JSON/CSV/Markdown action checklist",
        "all six P1 handoff/IPA areas are represented",
        "raw webhook and VAPID secrets are not written to checklist outputs",
        "operator owner roles, evidence drafts, strict commands, and next actions are preserved",
        "6-person team action brief is generated from the checklist",
        "per-owner Markdown action briefs are generated from the checklist",
        "per-owner handoff package folders are generated from the checklist",
        "P1 team agent prompt is copied into every owner handoff package",
        "owner package index is generated from the checklist",
      ],
      totalActions: report.summary.totalActions,
    },
    null,
    2,
  ),
);
