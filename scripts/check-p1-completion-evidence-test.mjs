import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-completion-evidence-"));

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha(seed) {
  return seed.padEnd(64, seed).slice(0, 64);
}

async function runCompletion(workspace, extraArgs = []) {
  const result = await execFile(
    process.execPath,
    ["scripts/check-p1-completion-evidence.mjs", `--workspace=${workspace}`, ...extraArgs],
    { cwd: process.cwd() },
  );

  return JSON.parse(result.stdout);
}

try {
  const pendingWorkspace = path.join(directory, "pending");
  await execFile(
    process.execPath,
    ["scripts/create-p1-handoff-draft-workspace.mjs", `--out-dir=${pendingWorkspace}`, "--github-repo=antoe-prog/ant"],
    { cwd: process.cwd() },
  );
  const pendingRoleApksDir = path.join(pendingWorkspace, "mobile-builds", "role-apks-20260617");
  await mkdir(pendingRoleApksDir, { recursive: true });
  await writeFile(
    path.join(pendingRoleApksDir, "role-apk-build-report.json"),
    json({
      ok: true,
      releaseDecision: "artifact_ready_release_blocked",
      outputs: ["member", "guardian", "coach", "owner"].map((role, index) => ({
        role,
        apk: `${role}.apk`,
        bytes: 1024 + index,
        sha256: sha(String(index + 1)),
      })),
    }),
  );
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-operator-status.mjs",
      `--workspace=${pendingWorkspace}`,
      "--allow-pending",
      `--out=${path.join(pendingWorkspace, "p1-operator-status.json")}`,
      `--markdown=${path.join(pendingWorkspace, "p1-operator-status.md")}`,
      `--external-blockers-csv=${path.join(pendingWorkspace, "p1-operator-status-external-blockers.csv")}`,
    ],
    { cwd: process.cwd() },
  );

  const pendingOut = path.join(pendingWorkspace, "p1-completion-evidence.json");
  const pendingMarkdown = path.join(pendingWorkspace, "p1-completion-evidence.md");
  const pendingCsv = path.join(pendingWorkspace, "p1-completion-evidence.csv");
  const pendingReport = await runCompletion(pendingWorkspace, [
    "--allow-pending",
    `--out=${pendingOut}`,
    `--markdown=${pendingMarkdown}`,
    `--csv=${pendingCsv}`,
  ]);
  const pendingOutReport = JSON.parse(await readFile(pendingOut, "utf8"));
  const pendingMarkdownSource = await readFile(pendingMarkdown, "utf8");
  const pendingCsvSource = await readFile(pendingCsv, "utf8");

  assert.equal(pendingReport.ok, false);
  assert.equal(pendingReport.releaseDecision, "blocked");
  assert.equal(pendingReport.summary.totalCriteria, 10);
  assert.equal(pendingReport.summary.readyInternal, 5);
  assert.equal(pendingReport.summary.blockedExternal, 5);
  assert.equal(pendingReport.summary.blockedInternal, 0);
  assert.equal(pendingReport.summary.externalBlockers, 7);
  assert.equal(pendingReport.releaseCustody.ready, false);
  assert.equal(pendingReport.operatorStatusPath.endsWith("p1-operator-status.json"), true);
  assert.equal(pendingReport.csv.endsWith("p1-completion-evidence.csv"), true);
  assert.equal(pendingOutReport.summary.totalCriteria, 10);
  assert(pendingReport.checked.includes("10 P1 completion criteria mapped to authoritative evidence"));
  assert(pendingReport.checked.includes("completion evidence CSV handoff matrix"));
  assert(
    pendingReport.checked.includes(
      "P0 regression, role CSV export gate, and member/guardian CSV API 403 smoke evidence commands",
    ),
  );
  assert(
    pendingReport.checked.includes(
      "RBAC/branch scope/audit, role CSV export, and member/guardian CSV API 403 smoke evidence",
    ),
  );
  assert(pendingReport.checked.includes("mobile account, PWA install, iOS Capacitor, and iOS IPA doctor evidence commands"));

  const criteriaByKey = new Map(pendingReport.criteria.map((criterion) => [criterion.key, criterion]));
  assert.equal(criteriaByKey.get("p0Regression")?.status, "ready_internal");
  assert(
    criteriaByKey.get("p0Regression")?.evidenceNotes?.includes("회원/학부모 CSV export API 403 smoke 증거"),
  );
  assert.equal(criteriaByKey.get("mobileAccount")?.status, "ready_internal");
  assert.equal(criteriaByKey.get("pwaInstall")?.status, "blocked_external");
  assert.equal(criteriaByKey.get("ownerReports")?.status, "ready_internal");
  assert.equal(criteriaByKey.get("rbacScopeAudit")?.status, "ready_internal");
  assert(
    criteriaByKey.get("rbacScopeAudit")?.evidenceNotes?.includes("회원/학부모 CSV export API 403 smoke 증거"),
  );
  assert.equal(criteriaByKey.get("p1TestsDocsBuild")?.status, "ready_internal");
  assert.equal(criteriaByKey.get("androidPackaging")?.status, "blocked_external");
  assert(
    criteriaByKey
      .get("androidPackaging")
      ?.evidenceCommands.includes("npm run test:android-release-handoff-draft"),
  );
  assert(
    criteriaByKey
      .get("androidPackaging")
      ?.evidenceNotes?.includes("Android release handoff는 주소창/공유/더보기 브라우저 UI 비노출 smoke 증빙이 필요함"),
  );
  assert(
    criteriaByKey
      .get("androidPackaging")
      ?.evidenceFiles.includes("mobile/android/release-handoff.template.json"),
  );
  assert(criteriaByKey.get("androidPackaging")?.supportArtifacts.some((artifact) => artifact.key === "androidDoctor" && artifact.status === "blocked"));
  assert(criteriaByKey.get("androidPackaging")?.supportArtifacts.some((artifact) => artifact.key === "androidRoleApks" && artifact.status === "ready"));
  assert(criteriaByKey.get("pwaInstall")?.supportArtifacts.some((artifact) => artifact.key === "iosCapacitorConnection" && artifact.status === "ready"));
  assert(criteriaByKey.get("pwaInstall")?.supportArtifacts.some((artifact) => artifact.key === "iosIpaDoctor" && artifact.status === "blocked"));
  assert(criteriaByKey.get("pwaInstall")?.supportArtifacts.some((artifact) => artifact.key === "iosIpaDoctorMarkdown" && artifact.status === "ready"));
  assert.deepEqual(criteriaByKey.get("pwaInstall")?.externalBlockers.map((blocker) => blocker.key), ["iosIpa"]);
  assert.equal(criteriaByKey.get("paymentsMembership")?.status, "blocked_external");
  assert.equal(criteriaByKey.get("noticesNotifications")?.status, "blocked_external");
  assert.equal(criteriaByKey.get("pilotOperationsSupport")?.status, "blocked_external");
  assert.deepEqual(
    criteriaByKey.get("pilotOperationsSupport")?.externalBlockers.map((blocker) => blocker.key).sort(),
    ["deployment", "issueRegistration", "pilot"],
  );
  assert(pendingReport.blockers.some((blocker) => blocker.code === "P1_COMPLETION_EXTERNAL_BLOCKERS"));
  assert(!pendingReport.blockers.some((blocker) => blocker.code === "P1_COMPLETION_INTERNAL_ARTIFACT_BLOCKED"));
  assert(pendingMarkdownSource.includes("# P1 Completion Evidence Matrix"));
  assert(pendingMarkdownSource.includes("P1 completion ready: no"));
  assert(pendingMarkdownSource.includes("Android 앱 패키징 전략/APK-AAB"));
  assert(pendingMarkdownSource.includes("npm run test:android-release-handoff-draft"));
  assert(pendingMarkdownSource.includes("주소창/공유/더보기 브라우저 UI 비노출 smoke 증빙"));
  assert(pendingMarkdownSource.includes("mobile/android/release-handoff.template.json"));
  assert(pendingMarkdownSource.includes("androidDoctor:blocked"));
  assert(pendingMarkdownSource.includes("androidRoleApks"));
  assert(pendingMarkdownSource.includes("iosCapacitorConnection:ready"));
  assert(pendingMarkdownSource.includes("iosIpaDoctor:blocked"));
  assert(pendingMarkdownSource.includes("iosIpaDoctorMarkdown:ready"));
  assert(pendingMarkdownSource.includes("paymentProvider"));
  assert(pendingMarkdownSource.includes("npm run test:role-csv-export-gates"));
  assert(pendingMarkdownSource.includes("npm run test:smoke"));
  assert(pendingMarkdownSource.includes("회원/학부모 CSV export API 403 smoke 증거"));
  assert(pendingMarkdownSource.includes("npm run test:release"));
  assert(!pendingMarkdownSource.includes("FinalJudoPilot!2026"));
  assert(pendingCsvSource.includes("criterionKey,criterionLabel,status,statusLabel,message,externalBlockers"));
  assert(pendingCsvSource.includes("evidenceOwner,evidenceUrl,checkedAt,signoff,notes"));
  assert.equal(pendingCsvSource.trim().split("\n").length, 11);
  assert(pendingCsvSource.includes("androidPackaging"));
  assert(pendingCsvSource.includes("npm run test:android-release-handoff-draft"));
  assert(pendingCsvSource.includes("주소창/공유/더보기 브라우저 UI 비노출 smoke 증빙"));
  assert(pendingCsvSource.includes("mobile/android/release-handoff.template.json"));
  assert(!pendingCsvSource.includes("blocked_internal"));
  assert(pendingCsvSource.includes("blocked_external"));
  assert(pendingCsvSource.includes("androidDoctor:blocked"));
  assert(pendingCsvSource.includes("androidRoleApks"));
  assert(pendingCsvSource.includes("iosCapacitorConnection:ready"));
  assert(pendingCsvSource.includes("iosIpaDoctor:blocked"));
  assert(pendingCsvSource.includes("iosIpaDoctorMarkdown:ready"));
  assert(pendingCsvSource.includes("paymentProvider:blocked"));
  assert(pendingCsvSource.includes("npm run test:role-csv-export-gates"));
  assert(pendingCsvSource.includes("npm run test:smoke"));
  assert(pendingCsvSource.includes("회원/학부모 CSV export API 403 smoke 증거"));
  assert(pendingCsvSource.includes("npm run test:release"));
  assert(!pendingCsvSource.includes("FinalJudoPilot!2026"));

  let strictFailed = false;
  try {
    await runCompletion(pendingWorkspace);
  } catch (error) {
    strictFailed = true;
    const stdoutSource = error?.stdout?.toString() ?? "";
    assert(stdoutSource.includes("P1_COMPLETION_EXTERNAL_BLOCKERS"));
  }

  assert.equal(strictFailed, true, "strict P1 completion evidence must fail while external blockers remain");

  const readyWorkspace = path.join(directory, "ready");
  await mkdir(readyWorkspace, { recursive: true });
  await writeFile(
    path.join(readyWorkspace, "p1-operator-status.json"),
    json({
      ok: true,
      releaseDecision: "ready",
      generatedAt: "2026-07-15T03:10:00.000Z",
      workspace: "ready",
      summary: {
        readyRequirements: 7,
        blockedRequirements: 0,
        totalRequirements: 7,
        externalBlockers: 0,
        releaseCustodyReady: true,
      },
      releaseCustody: {
        prerequisitesReady: true,
        ready: true,
        packageReady: true,
        archiveReady: true,
        storageReceiptReady: true,
      },
      supportArtifacts: [
        "androidDoctor",
        "androidDoctorMarkdown",
        "androidRoleApks",
        "iosCapacitorConnection",
        "iosIpaDoctor",
        "iosIpaDoctorMarkdown",
        "p1Readiness",
        "evidenceIntakeReport",
        "releasePackage",
        "releaseArchiveManifest",
        "releaseStorageReceipt",
      ].map((key) => ({
        key,
        label: key,
        status: "ready",
        releaseDecision: "ready",
        path: `${key}.json`,
        blockerCount: 0,
      })),
      requirements: [
        "deployment",
        "android",
        "iosIpa",
        "paymentProvider",
        "notificationPush",
        "issueRegistration",
        "pilot",
      ].map((key) => ({
        key,
        label: key,
        status: "ready",
        blockerCount: 0,
      })),
      externalBlockers: [],
      nextActions: [],
      blockers: [],
    }),
  );

  const readyMarkdown = path.join(readyWorkspace, "p1-completion-evidence.md");
  const readyCsv = path.join(readyWorkspace, "p1-completion-evidence.csv");
  const readyReport = await runCompletion(readyWorkspace, [`--markdown=${readyMarkdown}`, `--csv=${readyCsv}`]);
  const readyMarkdownSource = await readFile(readyMarkdown, "utf8");
  const readyCsvSource = await readFile(readyCsv, "utf8");

  assert.equal(readyReport.ok, true);
  assert.equal(readyReport.releaseDecision, "ready");
  assert.equal(readyReport.summary.totalCriteria, 10);
  assert.equal(readyReport.summary.ready, 10);
  assert.equal(readyReport.summary.readyInternal, 0);
  assert.equal(readyReport.summary.blockedExternal, 0);
  assert(readyReport.criteria.every((criterion) => criterion.status === "ready"));
  assert(readyMarkdownSource.includes("P1 completion ready: yes"));
  assert(readyMarkdownSource.includes("No external blockers remain."));
  assert.equal(readyCsvSource.trim().split("\n").length, 11);
  assert(readyCsvSource.includes("ready"));

  const secretWorkspace = path.join(directory, "secret");
  await mkdir(secretWorkspace, { recursive: true });
  await writeFile(path.join(secretWorkspace, "p1-operator-status.json"), json({ ok: true, leaked: "FinalJudoPilot!2026" }));

  let secretFailed = false;
  try {
    await runCompletion(secretWorkspace);
  } catch (error) {
    secretFailed = true;
    const stdoutSource = error?.stdout?.toString() ?? "";
    assert(stdoutSource.includes("P1_COMPLETION_OPERATOR_STATUS_MISSING"));
  }

  assert.equal(secretFailed, true, "completion evidence must reject secret-like operator status input");

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "pending P1 completion evidence matrix maps 10 criteria",
          "completion evidence CSV handoff matrix includes operator input columns",
          "member/guardian CSV export API 403 smoke evidence is exposed in matrix notes",
          "external blockers are grouped by P1 completion criteria",
          "diagnostic Android/iOS doctor support artifacts stay visible under external blockers",
          "ready fixture marks all criteria ready",
          "strict mode fails while external blockers or secret-like input remain",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
