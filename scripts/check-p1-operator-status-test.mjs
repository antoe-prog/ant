import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-operator-status-"));

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, json(value));
}

async function runStatus(workspace, extraArgs = []) {
  const result = await execFile(
    process.execPath,
    ["scripts/check-p1-operator-status.mjs", `--workspace=${workspace}`, ...extraArgs],
    { cwd: process.cwd() },
  );

  return JSON.parse(result.stdout);
}

const pendingWorkspace = path.join(directory, "pending");
const pendingProfilesDir = path.join(directory, "pending-profiles");
await mkdir(pendingProfilesDir, { recursive: true });
await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-draft-workspace.mjs",
    `--out-dir=${pendingWorkspace}`,
    `--profiles-dir=${pendingProfilesDir}`,
    "--github-repo=antoe-prog/ant",
  ],
  { cwd: process.cwd() },
);

const pendingOut = path.join(pendingWorkspace, "p1-operator-status.json");
const pendingMarkdown = path.join(pendingWorkspace, "p1-operator-status.md");
const pendingExternalBlockersCsv = path.join(pendingWorkspace, "p1-operator-status-external-blockers.csv");
const pendingReport = await runStatus(pendingWorkspace, [
  "--allow-pending",
  `--out=${pendingOut}`,
  `--markdown=${pendingMarkdown}`,
  `--external-blockers-csv=${pendingExternalBlockersCsv}`,
]);
const pendingOutReport = JSON.parse(await readFile(pendingOut, "utf8"));
const pendingMarkdownSource = await readFile(pendingMarkdown, "utf8");
const pendingExternalBlockersCsvSource = await readFile(pendingExternalBlockersCsv, "utf8");

assert.equal(pendingReport.ok, false);
assert.equal(pendingReport.releaseDecision, "blocked");
assert.equal(pendingReport.githubIssuePublish.repo, "antoe-prog/ant");
assert.equal(pendingReport.githubIssuePublish.ready, false);
assert.equal(pendingReport.githubConnectorAccess.ready, false);
assert.equal(pendingReport.githubConnectorAccess.status, "missing");
assert.equal(pendingReport.ownerDecisionRegister.state, "register_missing");
assert.equal(pendingReport.summary.ownerDecisionRegisterState, "register_missing");
assert.equal(pendingReport.releaseCustody.ready, false);
assert.equal(pendingReport.releaseCustody.prerequisitesReady, false);
assert.equal(pendingReport.summary.releaseCustodyPrerequisitesReady, false);
assert(pendingReport.summary.totalActions > 100);
assert.equal(pendingReport.summary.externalBlockers, 7);
assert.equal(pendingReport.externalBlockers.length, 7);
assert.equal(pendingReport.summary.deferredExternalPrep, 2);
assert.equal(pendingReport.deferredExternalPrep.length, 2);
assert(pendingReport.deferredExternalPrep.some((item) => item.key === "webappOrigin" && item.status === "사용자 보류"));
assert(pendingReport.deferredExternalPrep.some((item) => item.key === "iosProvisioningProfile" && item.status === "사용자 보류"));
assert(pendingReport.deferredExternalPrep.some((item) => item.reason.includes("/login") && item.reason.includes("/app/dashboard")));
assert(pendingReport.deferredExternalPrep.some((item) => item.reason.includes("호환 profile inventory 0")));
assert(pendingReport.deferredExternalPrep.every((item) => item.readinessTreatment === "readiness에서는 blocked 유지"));
assert.equal(pendingReport.externalBlockersCsv.endsWith("p1-operator-status-external-blockers.csv"), true);
assert.equal(pendingReport.iosProvisioningProfileInventory?.totalProfileFiles, 0);
assert.equal(pendingReport.iosProvisioningProfileInventory?.matchingProfilesWithRegisteredDevices, 0);
assert.equal(pendingReport.iosProvisioningProfileInventory?.matchingExportMethodProfiles, 0);
assert.equal(pendingReport.iosProvisioningProfileInventory?.rawUdidWritten, false);
assert.equal(pendingReport.evidenceFormatGuardrails.length, 5);
assert(pendingReport.evidenceFormatGuardrails.some((guardrail) => guardrail.label === "증빙 참조 형식"));
assert(pendingReport.evidenceFormatGuardrails.some((guardrail) => guardrail.rule.includes("HTTPS URL 또는 provider URI")));
assert(pendingReport.evidenceFormatGuardrails.some((guardrail) => guardrail.rule.includes("ISO timestamp")));
assert(pendingReport.evidenceFormatGuardrails.some((guardrail) => guardrail.rule.includes("TODO, *_EVIDENCE_URI")));
assert(pendingReport.evidenceFormatGuardrails.some((guardrail) => guardrail.rule.includes("localhost/.example/.test/.local origin")));
assert(pendingReport.evidenceFormatGuardrails.some((guardrail) => guardrail.rule.includes("원문은 파일에 쓰지 않습니다")));
assert(pendingReport.externalBlockers.some((blocker) => blocker.key === "android" && blocker.ownerLane === "Android/Release"));
assert(pendingReport.externalBlockers.some((blocker) => blocker.key === "iosIpa" && blocker.ownerLane === "iOS/Release"));
assert(pendingReport.externalBlockers.some((blocker) => blocker.key === "paymentProvider" && blocker.evidenceType === "실 PG/VAN provider"));
assert(pendingReport.externalBlockers.every((blocker) => blocker.requiredEvidence.length >= 3));
const pendingIssueRegistrationBlocker = pendingReport.externalBlockers.find((blocker) => blocker.key === "issueRegistration");
assert(pendingIssueRegistrationBlocker?.nextAction.includes("등록하지 않습니다"));
assert(!pendingIssueRegistrationBlocker?.nextAction.includes("GitHub connector `_create_issue`를 사용했다면"));
assert(!pendingIssueRegistrationBlocker?.nextAction.includes("If GitHub connector"));
const pendingDispatchArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "dispatchReport");
assert(pendingDispatchArtifact?.nextAction.includes("dispatch receipt 초안"));
assert(!pendingDispatchArtifact?.nextAction.includes("fill every owner"));
const pendingAndroidDoctorArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "androidDoctor");
const pendingAndroidDoctorMarkdownArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "androidDoctorMarkdown");
const pendingAndroidPlayReleaseArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "androidPlayRelease");
const pendingAndroidRoleApksArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "androidRoleApks");
const pendingIosCapacitorConnectionArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "iosCapacitorConnection");
const pendingIosIpaDoctorArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "iosIpaDoctor");
const pendingIosIpaDoctorMarkdownArtifact = pendingReport.supportArtifacts.find(
  (artifact) => artifact.key === "iosIpaDoctorMarkdown",
);
assert.equal(pendingAndroidDoctorArtifact?.status, "blocked");
assert.equal(pendingAndroidDoctorArtifact?.path.endsWith("android-twa-doctor.json"), true);
assert(Number(pendingAndroidDoctorArtifact?.blockerCount) > 0);
assert(Array.isArray(pendingAndroidDoctorArtifact?.blockerChecks));
// 운영 origin은 확정되어 blocker에서 빠질 수 있으므로 항상 막혀 있는 sha256 서명 지문으로 검증한다.
assert(pendingAndroidDoctorArtifact?.blockerChecks.includes("sha256"));
assert(pendingAndroidDoctorArtifact?.nextAction.includes("origin"));
assert(pendingAndroidDoctorArtifact?.nextAction.includes("APK/AAB"));
assert.equal(pendingAndroidDoctorMarkdownArtifact?.status, "ready");
assert.equal(pendingAndroidDoctorMarkdownArtifact?.path.endsWith("android-twa-doctor.md"), true);
assert.equal(pendingAndroidPlayReleaseArtifact?.status, "missing");
assert.equal(pendingAndroidPlayReleaseArtifact?.path.endsWith("google-play-release-report.json"), true);
assert(pendingAndroidPlayReleaseArtifact?.nextAction.includes("android:play:build"));
assert.equal(pendingAndroidRoleApksArtifact?.status, "missing");
assert.equal(pendingAndroidRoleApksArtifact?.path.endsWith("role-apk-build-report.json"), true);
assert.equal(pendingIosCapacitorConnectionArtifact?.status, "ready");
assert.equal(pendingIosCapacitorConnectionArtifact?.releaseDecision, "bundled_ui_configured");
assert.equal(pendingIosCapacitorConnectionArtifact?.mode, "bundled_local");
assert.equal(pendingIosCapacitorConnectionArtifact?.path.endsWith("ios-capacitor-connection.json"), true);
assert.equal(pendingIosIpaDoctorArtifact?.status, "blocked");
assert.equal(pendingIosIpaDoctorArtifact?.path.endsWith("ios-ipa-doctor.json"), true);
assert(Number(pendingIosIpaDoctorArtifact?.blockerCount) > 0);
assert(Array.isArray(pendingIosIpaDoctorArtifact?.blockerChecks));
// 서버 URL(origin)은 확정될 수 있으므로 선택한 export method용 provisioning profile 부재로 검증한다.
assert(pendingIosIpaDoctorArtifact?.blockerChecks.includes("provisioningProfile"));
assert(pendingIosIpaDoctorArtifact?.nextAction.includes("App Store distribution"));
assert(pendingIosIpaDoctorArtifact?.nextAction.includes("provisioning profile"));
assert.equal(pendingIosIpaDoctorMarkdownArtifact?.status, "ready");
assert.equal(pendingIosIpaDoctorMarkdownArtifact?.path.endsWith("ios-ipa-doctor.md"), true);
assert.equal(pendingIosIpaDoctorMarkdownArtifact?.nextAction, "");
const pendingReleasePackageArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "releasePackage");
const pendingReleaseArchiveArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "releaseArchiveManifest");
const pendingStorageReceiptArtifact = pendingReport.supportArtifacts.find((artifact) => artifact.key === "releaseStorageReceipt");
assert.equal(pendingReleasePackageArtifact?.status, "deferred");
assert.equal(pendingReleaseArchiveArtifact?.status, "deferred");
assert.equal(pendingStorageReceiptArtifact?.status, "deferred");
assert.equal(pendingReleasePackageArtifact?.releaseDecision, "deferred_prerequisites_blocked");
assert.equal(pendingReleaseArchiveArtifact?.releaseDecision, "deferred_prerequisites_blocked");
assert.equal(pendingStorageReceiptArtifact?.releaseDecision, "deferred_prerequisites_blocked");
assert(pendingReleasePackageArtifact?.nextAction.includes("P1 readiness와 evidence intake가 strict-ready"));
assert(pendingReleaseArchiveArtifact?.nextAction.includes("P1 readiness와 evidence intake가 strict-ready"));
assert(pendingStorageReceiptArtifact?.nextAction.includes("P1 readiness와 evidence intake가 strict-ready"));
assert(!pendingReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_STATUS_RELEASE_PACKAGE_NOT_READY"));
assert(!pendingReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_STATUS_RELEASE_ARCHIVE_NOT_READY"));
assert(!pendingReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_STATUS_RELEASE_STORAGE_RECEIPT_NOT_READY"));
assert(
  !pendingReport.nextActions.includes("npm run p1:release-package -- --workspace=.data --out=.data/p1-release-package.json"),
  "blocked readiness must not put release packaging before readiness/evidence intake",
);
assert.equal(pendingOutReport.summary.totalActions, pendingReport.summary.totalActions);
assert(pendingMarkdownSource.includes("# P1 Operator Status"));
assert(pendingMarkdownSource.includes("Android TWA doctor status"));
assert(pendingMarkdownSource.includes("Android TWA doctor Markdown"));
assert(pendingMarkdownSource.includes("Android Play AAB/APK release report"));
assert(pendingMarkdownSource.includes("Android role APK build report"));
assert(pendingMarkdownSource.includes("iOS Capacitor service connection"));
assert(pendingMarkdownSource.includes("iOS IPA doctor status"));
assert(pendingMarkdownSource.includes("iOS IPA doctor Markdown"));
assert(pendingMarkdownSource.includes("android-twa-doctor.json"));
assert(pendingMarkdownSource.includes("android-twa-doctor.md"));
assert(pendingMarkdownSource.includes("google-play-release-report.json"));
assert(pendingMarkdownSource.includes("role-apk-build-report.json"));
assert(pendingMarkdownSource.includes("ios-capacitor-connection.json"));
assert(pendingMarkdownSource.includes("ios-ipa-doctor.json"));
assert(pendingMarkdownSource.includes("ios-ipa-doctor.md"));
assert(pendingMarkdownSource.includes("## iOS Local Profile Inventory"));
assert(pendingMarkdownSource.includes("Profile files: 0"));
assert(pendingMarkdownSource.includes("Matching profiles with registered devices: 0"));
assert(pendingMarkdownSource.includes("Raw iPhone UDIDs are not written"));
assert(pendingMarkdownSource.includes("GitHub issue publish ready: no"));
assert(pendingMarkdownSource.includes("GitHub connector access ready: no"));
assert(pendingMarkdownSource.includes("## GitHub Connector"));
assert(pendingMarkdownSource.includes("Repository: `antoe-prog/ant`"));
assert(pendingMarkdownSource.includes("Access receipt: missing"));
assert(pendingMarkdownSource.includes("Issue publish ready: no"));
assert(pendingMarkdownSource.includes("## Owner Decision Register"));
assert(pendingMarkdownSource.includes("State: `register_missing`"));
assert(pendingMarkdownSource.includes("owner:decision-register -- --workspace=.data"));
assert(pendingMarkdownSource.includes("Release custody prerequisites ready: no"));
assert(pendingMarkdownSource.includes("Release custody ready: no"));
assert(pendingMarkdownSource.includes("## Release Custody"));
assert(pendingMarkdownSource.includes("Prerequisites ready: no"));
assert(pendingMarkdownSource.includes("Package ready: no"));
assert(pendingMarkdownSource.includes("Archive ready: no"));
assert(pendingMarkdownSource.includes("Storage receipt ready: no"));
assert(pendingMarkdownSource.includes("Next action: P1 readiness와 evidence intake가 strict-ready"));
assert(pendingMarkdownSource.includes("P1 readiness와 evidence intake가 strict-ready"));
assert(!pendingMarkdownSource.includes("- npm run p1:release-package -- --workspace=.data --out=.data/p1-release-package.json"));
assert(pendingMarkdownSource.includes("## External Blockers"));
assert(pendingMarkdownSource.includes("Android/Release"));
assert(pendingMarkdownSource.includes("CSV handoff template"));
assert(pendingMarkdownSource.includes("## Evidence Format Guardrails"));
assert(pendingMarkdownSource.includes("HTTPS URL 또는 provider URI"));
assert(pendingMarkdownSource.includes("ISO timestamp"));
assert(pendingMarkdownSource.includes("TODO, *_EVIDENCE_URI"));
assert(pendingMarkdownSource.includes("localhost/.example/.test/.local origin"));
assert(pendingMarkdownSource.includes("원문 secret 금지"));
assert(pendingMarkdownSource.includes("## Deferred External Prep"));
assert(pendingMarkdownSource.includes("보류 중인 외부 준비"));
assert(pendingMarkdownSource.includes("사용자 보류"));
assert(pendingMarkdownSource.includes("readiness에서는 blocked 유지"));
assert(pendingMarkdownSource.includes("운영 웹앱 origin 확정"));
assert(pendingMarkdownSource.includes("/login"));
assert(pendingMarkdownSource.includes("/app/dashboard"));
assert(pendingMarkdownSource.includes("iOS export-method provisioning profile"));
assert(pendingMarkdownSource.includes("호환 profile inventory 0"));
assert(pendingMarkdownSource.includes("등록하지 않습니다"));
assert(!pendingMarkdownSource.includes("GitHub connector `_create_issue`를 사용했다면"));
assert(!pendingMarkdownSource.includes("If GitHub connector"));
assert(pendingMarkdownSource.includes("dispatch receipt 초안"));
assert(!pendingMarkdownSource.includes("fill every owner"));
assert(pendingReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_STATUS_READINESS_BLOCKED"));
assert(pendingReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_STATUS_GITHUB_ISSUES_NOT_PUBLISHABLE"));
assert(pendingReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_STATUS_IOS_IPA_DOCTOR_NOT_READY"));
assert(!pendingReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_STATUS_IOS_IPA_DOCTOR_MARKDOWN_NOT_READY"));
assert(pendingExternalBlockersCsvSource.includes("key,label,status,blockerCount,ownerLane,evidenceType,requiredEvidence"));
assert(pendingExternalBlockersCsvSource.includes("evidenceOwner,evidenceUrl,checkedAt,signoff,notes"));
assert.equal(pendingExternalBlockersCsvSource.trim().split("\n").length, 8);
assert(pendingExternalBlockersCsvSource.includes("deployment"));
assert(pendingExternalBlockersCsvSource.includes("Android/Release"));
assert(pendingExternalBlockersCsvSource.includes("iOS/Release"));
assert(pendingExternalBlockersCsvSource.includes("HTTPS URL 또는 provider URI"));
assert(pendingExternalBlockersCsvSource.includes("ISO timestamp"));
assert(pendingExternalBlockersCsvSource.includes("원문은 파일에 쓰지 않습니다"));

let strictFailed = false;
try {
  await runStatus(pendingWorkspace);
} catch (error) {
  strictFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_OPERATOR_STATUS_READINESS_BLOCKED"));
}

assert.equal(strictFailed, true, "strict P1 operator status must fail while external evidence is blocked");

const readyWorkspace = path.join(directory, "ready");
await mkdir(path.join(readyWorkspace, "p1-handoff-issue-drafts"), { recursive: true });

const readyRequirements = Object.fromEntries(
  [
    ["deployment", "운영 배포 handoff"],
    ["android", "Android release handoff"],
    ["iosIpa", "iOS IPA build/provisioning"],
    ["paymentProvider", "결제 provider handoff"],
    ["notificationPush", "운영 푸시 handoff"],
    ["issueRegistration", "P1 handoff issue registration receipt"],
    ["pilot", "파일럿 최종 status"],
  ].map(([key, label]) => [
    key,
    {
      key,
      label,
      status: "ready",
      path: `${key}.json`,
      command: `npm run ${key}:strict`,
    },
  ]),
);

await writeJson(path.join(readyWorkspace, "p1-readiness.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:00:00.000Z",
  requirements: readyRequirements,
  blockers: [],
  nextActions: [],
});
await writeFile(
  path.join(readyWorkspace, "android-twa-doctor.md"),
  [
    "# Android TWA Doctor",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    "| origin | ready | https://app.finaljudo.kr |",
    "",
    "## Next Actions",
    "",
    "- APK/AAB 산출물을 생성합니다.",
    "",
  ].join("\n"),
);
await writeJson(path.join(readyWorkspace, "android-twa-doctor.json"), {
  ok: true,
  generatedAt: "2026-07-15T03:00:30.000Z",
  packageName: "kr.co.finaljudo.multigym",
  checks: {
    origin: { ok: true, value: "https://app.finaljudo.kr" },
    sha256: { ok: true, value: "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA" },
  },
  blockers: [],
  nextActions: ["android:twa:prepare를 실행하고 assetlinks.json을 배포한 뒤 android:twa:build를 실행합니다."],
});
await mkdir(path.join(readyWorkspace, "mobile-builds", "role-apks-20260617"), { recursive: true });
await writeJson(path.join(readyWorkspace, "mobile-builds", "role-apks-20260617", "role-apk-build-report.json"), {
  ok: true,
  releaseDecision: "artifact_ready_release_blocked",
  generatedAt: "2026-07-15T03:00:45.000Z",
  origin: "https://app.finaljudo.kr",
  outputs: ["member", "guardian", "coach", "owner"].map((role, index) => ({
    role,
    packageId: `kr.co.finaljudo.multigym.${role}`,
    apk: `mobile-builds/role-apks-20260617/final-judo-${role}.apk`,
    bytes: 1000 + index,
    sha256: String(index + 1).padStart(64, "a"),
  })),
});
await writeJson(path.join(readyWorkspace, "mobile-builds", "android-play-release-20260715030045", "google-play-release-report.json"), {
  ok: true,
  generatedAt: "2026-07-15T03:00:46.000Z",
  packageName: "kr.co.finaljudo.multigym",
  versionCode: 22,
  versionName: "1.0.21",
  launchUrl: "https://app.finaljudo.kr/login",
  artifacts: {
    aab: path.join(readyWorkspace, "mobile-builds", "android-play-release-20260715030045", "final-judo-play-release.aab"),
    apk: path.join(readyWorkspace, "mobile-builds", "android-play-release-20260715030045", "final-judo-release.apk"),
    desktopAab: "/Users/operator/Desktop/final-judo-play-release.aab",
    desktopApk: "/Users/operator/Desktop/final-judo-release.apk",
  },
  sizes: {
    aabBytes: 3131035,
    apkBytes: 3312688,
  },
  sha256: {
    aab: "b".repeat(64),
    apk: "c".repeat(64),
    desktopAab: "b".repeat(64),
    desktopApk: "c".repeat(64),
  },
  signing: {
    uploadKeyAlias: "finaljudo-upload",
    aabVerified: true,
    apkVerified: true,
  },
});
await writeJson(path.join(readyWorkspace, "mobile-builds", "ios", "ios-capacitor-connection.json"), {
  ok: true,
  releaseDecision: "bundled_ui_configured",
  generatedAt: "2026-07-15T03:00:50.000Z",
  bundleId: "kr.co.finaljudo.multigym",
  serviceRoute: "/app/dashboard",
  checks: {
    generatedServerUrl: { ok: true, mode: "bundled_local", value: "No server.url; UI loads from the signed app bundle" },
  },
  blockers: [],
});
await writeJson(path.join(readyWorkspace, "mobile-builds", "ios", "ios-ipa-doctor.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:00:55.000Z",
  requestedArtifact: "iOS IPA",
  bundleId: "kr.co.finaljudo.multigym",
  teamId: "CA7A5SP5G5",
  exportMethod: "app-store-connect",
  checks: {
    origin: { ok: true, value: "https://app.finaljudo.kr" },
    provisioningProfile: {
      ok: true,
      value: "1 profile ready for app-store-connect",
      inventory: {
        directory: "/Users/operator/Library/MobileDevice/Provisioning Profiles",
        totalProfileFiles: 2,
        readableProfileFiles: 2,
        unreadableProfileFiles: 0,
        matchingTeamProfiles: 1,
        matchingBundleProfiles: 1,
        matchingProfiles: 1,
        matchingProfilesWithRegisteredDevices: 0,
        matchingAppStoreProfiles: 1,
        matchingDistributionReadyProfiles: 1,
        matchingExportMethodProfiles: 1,
        profiles: [
          {
            name: "Final Judo App Store Connect",
            uuid: "READY-PROFILE-UUID",
            teamIdentifierCount: 1,
            matchesTeam: true,
            matchesBundle: true,
            provisionedDeviceCount: 0,
          },
        ],
      },
    },
  },
  blockers: [],
  resolutionHints: {
    rerun:
      "APPLE_TEAM_ID=CA7A5SP5G5 FINAL_JUDO_IOS_API_ORIGIN=https://app.finaljudo.kr npm run ios:ipa:doctor -- --team-id=CA7A5SP5G5 --strict",
  },
  nextActions: [],
});
await writeFile(
  path.join(readyWorkspace, "mobile-builds", "ios", "ios-ipa-doctor.md"),
  [
    "# iOS IPA Doctor",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    "| origin | ready | https://app.finaljudo.kr |",
    "| provisioningProfile | ready | 1 matching profile with registered devices |",
    "",
    "## Provisioning Hints",
    "",
    "### Local Profile Inventory",
    "",
    "- Profile files: 2",
    "- Matching profiles with registered devices: 1",
    "- Device UDIDs are intentionally not written to this report.",
    "",
    "### Environment",
    "",
    "- export FINAL_JUDO_IOS_API_ORIGIN=https://app.finaljudo.kr",
    "",
  ].join("\n"),
);
await writeJson(path.join(readyWorkspace, "p1-handoff-action-checklist.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:01:00.000Z",
  summary: { totalActions: 0 },
  blockers: [],
});
await writeJson(path.join(readyWorkspace, "p1-handoff-bundle-manifest.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:02:00.000Z",
  summary: { actionCount: 0, ownerPackages: 5 },
  blockers: [],
});
await writeJson(path.join(readyWorkspace, "p1-handoff-dispatch-report.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:03:00.000Z",
  summary: { ownerPackages: 5, acknowledged: 5, totalActions: 0 },
  blockers: [],
});
await writeJson(path.join(readyWorkspace, "p1-handoff-issue-registration-report.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:04:00.000Z",
  blockers: [],
});
await writeJson(path.join(readyWorkspace, "p1-evidence-intake-report.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:05:00.000Z",
  summary: { rows: 7, readyRows: 7, totalRequiredRows: 7 },
  blockers: [],
});
await writeJson(path.join(readyWorkspace, "p1-release-package.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:07:00.000Z",
  summary: { artifacts: 8 },
  blockers: [],
});
await writeJson(path.join(readyWorkspace, "p1-release-archives", "final-judo-p1-20260715", "p1-release-archive-manifest.json"), {
  ok: true,
  releaseDecision: "ready",
  generatedAt: "2026-07-15T03:08:00.000Z",
  summary: { archivedArtifacts: 9 },
  blockers: [],
});
await writeJson(path.join(readyWorkspace, "p1-release-storage-receipt.json"), {
  version: 1,
  archiveManifest: path.join(
    readyWorkspace,
    "p1-release-archives",
    "final-judo-p1-20260715",
    "p1-release-archive-manifest.json",
  ),
  uploadedAt: "2026-07-15T03:09:00.000Z",
  uploadedBy: "qa-release@finaljudo.kr",
  storageProvider: "Google Drive",
  storageLocation: "drive://final-judo/releases/p1/final-judo-p1-20260715",
  evidence: "https://github.com/antoe-prog/ant/issues/501#issuecomment-9501",
  retentionPolicy: {
    minimumRetentionDays: 365,
    owner: "qa-release@finaljudo.kr",
    accessReviewDueOn: "2027-07-15",
    evidence: "https://github.com/antoe-prog/ant/issues/501#issuecomment-9502",
  },
  uploadedArtifacts: Array.from({ length: 9 }, (_, index) => ({
    key: index === 0 ? "p1ReleasePackage" : `artifact-${index}`,
    archivedPath: path.join(readyWorkspace, "p1-release-archives", "final-judo-p1-20260715", `artifact-${index}.json`),
    sha256: String(index + 1).padStart(64, "a"),
    sizeBytes: 100 + index,
    storageLocation: `drive://final-judo/releases/p1/final-judo-p1-20260715/artifact-${index}.json`,
  })),
});
await writeJson(path.join(readyWorkspace, "p1-handoff-issue-drafts", "github-connector-issue-payloads.json"), {
  schemaVersion: 1,
  generatedAt: "2026-07-15T03:06:00.000Z",
  releaseDecision: "ready",
  githubRepo: "antoe-prog/ant",
  publishReady: true,
  connector: "mcp__codex_apps__github._create_issue",
  issuePayloads: Array.from({ length: 5 }, (_, index) => ({
    bodySha256: String(index).padStart(64, "a"),
    createIssueInput: {
      repository_full_name: "antoe-prog/ant",
      title: `[P1 Handoff] ready-${index + 1}`,
      body: `Ready owner package ${index + 1}`,
      labels: ["p1", "handoff", "pilot-release"],
      assignees: [],
    },
  })),
});
await writeJson(path.join(readyWorkspace, "p1-github-connector-access.json"), {
  schemaVersion: 1,
  connector: "mcp__codex_apps__github._get_repo",
  checkedAt: "2026-07-15T03:06:30.000Z",
  repository: {
    repository_full_name: "antoe-prog/ant",
    clone_url: "https://github.com/antoe-prog/ant.git",
    default_branch: "main",
    archived: false,
    permissions: {
      admin: true,
      maintain: true,
      pull: true,
      push: true,
      triage: true,
    },
  },
});
await writeJson(path.join(readyWorkspace, "p1-owner-decision-register.json"), {
  ok: true,
  registerDecision: "needs_owner_input",
  generatedAt: "2026-07-15T03:06:40.000Z",
  summary: { decisionRows: 7 },
  decisionRows: Array.from({ length: 7 }, (_, index) => ({ key: `decision-${index + 1}` })),
});
await writeJson(path.join(readyWorkspace, "p1-owner-decision-register.completed.json"), {
  ok: true,
  registerDecision: "decisions_recorded",
  ownerDecisionRegisterCompleted: true,
  generatedAt: "2026-07-15T03:06:50.000Z",
  summary: { decisionRows: 7, completedDecisionRows: 7 },
  decisionRows: Array.from({ length: 7 }, (_, index) => ({
    key: `decision-${index + 1}`,
    ownerDecision: {
      decisionOwner: `대표 지정 책임자 ${index + 1}`,
      dueDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
      evidenceOwner: `evidence-owner-${index + 1}@finaljudo.test`,
    },
  })),
});

const readyMarkdown = path.join(readyWorkspace, "p1-operator-status.md");
const readyExternalBlockersCsv = path.join(readyWorkspace, "p1-operator-status-external-blockers.csv");
const readyReport = await runStatus(readyWorkspace, [
  `--out=${path.join(readyWorkspace, "p1-operator-status.json")}`,
  `--markdown=${readyMarkdown}`,
  `--external-blockers-csv=${readyExternalBlockersCsv}`,
]);
const readyMarkdownSource = await readFile(readyMarkdown, "utf8");
const readyExternalBlockersCsvSource = await readFile(readyExternalBlockersCsv, "utf8");

assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert.equal(readyReport.summary.readyRequirements, 7);
assert.equal(readyReport.summary.externalBlockers, 0);
assert.equal(readyReport.externalBlockers.length, 0);
assert.equal(readyReport.summary.deferredExternalPrep, 0);
assert.equal(readyReport.deferredExternalPrep.length, 0);
assert.equal(readyReport.externalBlockersCsv.endsWith("p1-operator-status-external-blockers.csv"), true);
assert.equal(readyReport.evidenceFormatGuardrails.length, 5);
assert(readyReport.evidenceFormatGuardrails.every((guardrail) => guardrail.label && guardrail.rule && guardrail.verifier));
assert.equal(readyReport.githubIssuePublish.ready, true);
assert.equal(readyReport.githubConnectorAccess.ready, true);
assert.equal(readyReport.githubConnectorAccess.repositoryFullName, "antoe-prog/ant");
assert.equal(readyReport.summary.githubConnectorAccessReady, true);
assert.equal(readyReport.ownerDecisionRegister.state, "decisions_recorded");
assert.equal(readyReport.ownerDecisionRegister.completedDecisionRows, 7);
assert.equal(readyReport.summary.ownerDecisionRegisterState, "decisions_recorded");
assert.equal(readyReport.releaseCustody.ready, true);
assert.equal(readyReport.releaseCustody.prerequisitesReady, true);
assert.equal(readyReport.summary.releaseCustodyPrerequisitesReady, true);
assert.equal(readyReport.summary.releaseCustodyReady, true);
assert.equal(readyReport.iosProvisioningProfileInventory?.totalProfileFiles, 2);
assert.equal(readyReport.iosProvisioningProfileInventory?.matchingProfilesWithRegisteredDevices, 0);
assert.equal(readyReport.iosProvisioningProfileInventory?.matchingExportMethodProfiles, 1);
assert.equal(readyReport.iosProvisioningProfileInventory?.rawUdidWritten, false);
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "androidDoctor" && artifact.status === "ready"));
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "androidDoctorMarkdown" && artifact.status === "ready"));
assert(
  readyReport.supportArtifacts.some(
    (artifact) =>
      artifact.key === "androidPlayRelease" &&
      artifact.status === "ready" &&
      artifact.packageName === "kr.co.finaljudo.multigym" &&
      artifact.versionCode === 22 &&
      artifact.versionName === "1.0.21",
  ),
);
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "androidRoleApks" && artifact.status === "ready"));
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "iosCapacitorConnection" && artifact.status === "ready"));
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "iosIpaDoctor" && artifact.status === "ready"));
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "iosIpaDoctorMarkdown" && artifact.status === "ready"));
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "releasePackage" && artifact.status === "ready"));
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "releaseArchiveManifest" && artifact.status === "ready"));
assert(readyReport.supportArtifacts.some((artifact) => artifact.key === "releaseStorageReceipt" && artifact.status === "ready"));
assert.equal(readyReport.blockers.length, 0);
assert(readyMarkdownSource.includes("## GitHub Connector"));
assert(readyMarkdownSource.includes("Repository: `antoe-prog/ant`"));
assert(readyMarkdownSource.includes("Access receipt: ready"));
assert(readyMarkdownSource.includes("Access checked at: 2026-07-15T03:06:30.000Z"));
assert(readyMarkdownSource.includes("Default branch: `main`"));
assert(readyMarkdownSource.includes("Permissions: admin, maintain, pull, push, triage"));
assert(readyMarkdownSource.includes("Issue publish ready: yes"));
assert(readyMarkdownSource.includes("Android Play AAB/APK release report"));
assert(readyMarkdownSource.includes("iOS IPA doctor status"));
assert(readyMarkdownSource.includes("iOS IPA doctor Markdown"));
assert(readyMarkdownSource.includes("## iOS Local Profile Inventory"));
assert(readyMarkdownSource.includes("Profile files: 2"));
assert(readyMarkdownSource.includes("Matching profiles with registered devices: 0"));
assert(readyMarkdownSource.includes("Raw iPhone UDIDs are not written"));
assert(readyMarkdownSource.includes("## Owner Decision Register"));
assert(readyMarkdownSource.includes("State: `decisions_recorded`"));
assert(readyMarkdownSource.includes("Completed rows: 7"));
assert(readyMarkdownSource.includes("Release custody prerequisites ready: yes"));
assert(readyMarkdownSource.includes("## Evidence Format Guardrails"));
assert(readyMarkdownSource.includes("HTTPS URL 또는 provider URI"));
assert(readyMarkdownSource.includes("ISO timestamp"));
assert(readyMarkdownSource.includes("TODO, *_EVIDENCE_URI"));
assert(readyMarkdownSource.includes("localhost/.example/.test/.local origin"));
assert(readyMarkdownSource.includes("## Deferred External Prep"));
assert(readyMarkdownSource.includes("No deferred external prep."));
assert(readyMarkdownSource.includes("## Release Custody"));
assert(readyMarkdownSource.includes("Prerequisites ready: yes"));
assert(readyMarkdownSource.includes("Package ready: yes"));
assert(readyMarkdownSource.includes("Archive ready: yes"));
assert(readyMarkdownSource.includes("Storage receipt ready: yes"));
assert(readyMarkdownSource.includes("Next action: 남은 release custody 작업이 없습니다."));
assert.equal(readyExternalBlockersCsvSource.trim().split("\n").length, 1);
assert(readyExternalBlockersCsvSource.includes("evidenceOwner,evidenceUrl,checkedAt,signoff,notes"));

await rm(path.join(readyWorkspace, "p1-handoff-issue-drafts", "github-connector-issue-payloads.json"));

let missingPayloadFailed = false;
try {
  await runStatus(readyWorkspace);
} catch (error) {
  missingPayloadFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_OPERATOR_STATUS_ARTIFACT_MISSING"));
}

assert.equal(missingPayloadFailed, true, "missing GitHub connector payload must block operator status");

await writeJson(path.join(readyWorkspace, "p1-handoff-issue-drafts", "github-connector-issue-payloads.json"), {
  schemaVersion: 1,
  releaseDecision: "ready",
  githubRepo: "antoe-prog/ant",
  publishReady: true,
  connector: "mcp__codex_apps__github._create_issue",
  issuePayloads: Array.from({ length: 5 }, (_, index) => ({
    createIssueInput: {
      repository_full_name: "antoe-prog/ant",
      title: `[P1 Handoff] access-required-${index + 1}`,
      body: "Ready owner package",
      labels: ["p1", "handoff", "pilot-release"],
    },
  })),
});
await rm(path.join(readyWorkspace, "p1-github-connector-access.json"));

let missingAccessFailed = false;
try {
  await runStatus(readyWorkspace);
} catch (error) {
  missingAccessFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_OPERATOR_STATUS_GITHUB_ACCESS_NOT_READY"));
}

assert.equal(missingAccessFailed, true, "publishable GitHub payloads must require connector access receipt");

await writeJson(path.join(readyWorkspace, "p1-github-connector-access.json"), {
  schemaVersion: 1,
  connector: "mcp__codex_apps__github._get_repo",
  checkedAt: "2026-07-15T03:06:30.000Z",
  repository: {
    repository_full_name: "antoe-prog/ant",
    clone_url: "https://github.com/antoe-prog/ant.git",
    default_branch: "main",
    archived: false,
    permissions: {
      admin: true,
      maintain: true,
      pull: true,
      push: true,
      triage: true,
    },
  },
});

await writeJson(path.join(readyWorkspace, "p1-handoff-issue-drafts", "github-connector-issue-payloads.json"), {
  schemaVersion: 1,
  releaseDecision: "ready",
  githubRepo: "TODO_OWNER/TODO_REPO",
  publishReady: true,
  connector: "mcp__codex_apps__github._create_issue",
  issuePayloads: [],
});

const placeholderReport = await runStatus(readyWorkspace, ["--allow-pending"]);
assert.equal(placeholderReport.githubIssuePublish.ready, false);
assert(placeholderReport.blockers.some((blocker) => blocker.code === "P1_OPERATOR_STATUS_GITHUB_ISSUES_NOT_PUBLISHABLE"));

await writeJson(path.join(readyWorkspace, "p1-handoff-issue-drafts", "github-connector-issue-payloads.json"), {
  schemaVersion: 1,
  releaseDecision: "ready",
  githubRepo: "antoe-prog/ant",
  publishReady: true,
  connector: "mcp__codex_apps__github._create_issue",
  issuePayloads: Array.from({ length: 5 }, (_, index) => ({
    createIssueInput: {
      repository_full_name: "antoe-prog/ant",
      title: `[P1 Handoff] restored-${index + 1}`,
      body: "Ready owner package",
      labels: ["p1", "handoff", "pilot-release"],
    },
  })),
});
await writeJson(path.join(readyWorkspace, "p1-release-storage-receipt.json"), {
  version: 1,
  uploadedAt: "TODO: 2026-07-15T03:09:00.000Z",
  uploadedBy: "qa-release@finaljudo.kr",
  storageProvider: "Google Drive",
  storageLocation: "drive://final-judo/releases/p1/final-judo-p1-20260715",
  evidence: "https://github.com/antoe-prog/ant/issues/501#issuecomment-9501",
  retentionPolicy: {
    minimumRetentionDays: 365,
    owner: "qa-release@finaljudo.kr",
    accessReviewDueOn: "2027-07-15",
    evidence: "https://github.com/antoe-prog/ant/issues/501#issuecomment-9502",
  },
  uploadedArtifacts: [],
});

let storageReceiptFailed = false;
try {
  await runStatus(readyWorkspace);
} catch (error) {
  storageReceiptFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_OPERATOR_STATUS_RELEASE_STORAGE_RECEIPT_NOT_READY"));
  assert(stdoutSource.includes("storage upload/retention 필드를 모두 채운 뒤"));
  assert(!stdoutSource.includes("Fill storage upload/retention fields"));
}

assert.equal(storageReceiptFailed, true, "placeholder storage receipt must block operator status");

await writeFile(
  path.join(readyWorkspace, "p1-handoff-issue-drafts", "github-connector-issue-payloads.json"),
  json({
    schemaVersion: 1,
    releaseDecision: "ready",
    githubRepo: "antoe-prog/ant",
    publishReady: true,
    connector: "mcp__codex_apps__github._create_issue",
    issuePayloads: [{ createIssueInput: { body: "sk_live_SHOULD_NOT_APPEAR" } }],
  }),
);

let secretFailed = false;
try {
  await runStatus(readyWorkspace);
} catch (error) {
  secretFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_OPERATOR_STATUS_SECRET_LIKE_VALUE"));
}

assert.equal(secretFailed, true, "operator status must reject secret-like values in source artifacts");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "blocked P1 handoff workspace produces operator status JSON and Markdown",
        "Android TWA doctor JSON status is exposed in operator status artifacts",
        "Android TWA doctor Markdown is exposed in operator status artifacts",
        "Android Play AAB/APK release report is exposed in operator status artifacts",
        "iOS IPA doctor JSON status is exposed in operator status artifacts",
        "iOS IPA doctor Markdown is exposed in operator status artifacts",
        "iOS local provisioning profile inventory is exposed without raw UDIDs",
        "strict mode fails while external evidence is pending",
        "ready fixture passes with seven requirements and publishable GitHub payloads",
        "publishable GitHub payloads require a verified connector access receipt",
        "operator status Markdown exposes GitHub connector repo, access time, permissions, and publish state",
        "operator status Markdown exposes owner decision register follow-up state",
        "blocked readiness gates release custody next actions behind readiness and evidence intake",
        "operator status Markdown exposes release custody prerequisite/package/archive/storage receipt state",
        "operator status exposes external blockers by 6-person lane",
        "operator status writes external blockers CSV handoff template",
        "operator status exposes deferred external prep for user-held webapp origin and iOS provisioning work",
        "operator status exposes evidence format guardrails",
        "issue registration next action is Korean operator guidance",
        "dispatch next action is Korean operator guidance",
        "ready fixture requires P1 release package, archive manifest, and storage receipt custody",
        "missing GitHub connector payload blocks operator status",
        "placeholder GitHub repository keeps issue publishing blocked",
        "placeholder P1 release storage receipt keeps final custody blocked",
        "raw secret-like values are rejected from operator status artifacts",
      ],
    },
    null,
    2,
  ),
);
