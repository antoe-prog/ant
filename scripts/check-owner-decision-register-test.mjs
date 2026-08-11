#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-owner-decision-register-"));

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function run(args, options = {}) {
  return execFile(process.execPath, ["scripts/create-owner-decision-register.mjs", ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 4,
    ...options,
  });
}

async function writeWorkspace(workspace, { ready = false, secret = false } = {}) {
  await mkdir(workspace, { recursive: true });

  const externalBlockers = ready
    ? []
    : [
        {
          key: "deployment",
          label: "운영 배포 handoff",
          status: "blocked",
          blockerCount: 4,
          ownerLane: "DevOps/총괄 PM",
          evidenceType: "운영 배포/secret store",
          requiredEvidence: ["운영 HTTPS origin", "배포 플랫폼 secret store", "production preflight/release report"],
          path: path.join(workspace, "deployment-handoff.report.json"),
          command: "npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json",
          nextAction: "운영 secret store와 production preflight 증빙을 채웁니다.",
        },
        {
          key: "android",
          label: "Android release handoff",
          status: "blocked",
          blockerCount: 3,
          ownerLane: "Android/Release",
          evidenceType: "Android APK/AAB release",
          requiredEvidence: ["운영 HTTPS 웹앱 origin", "release SHA-256 fingerprint", "APK/AAB artifact"],
          path: path.join(workspace, "android-release-handoff.report.json"),
          command: "npm run android:release-handoff -- --file=.data/android-release-handoff.json --out=.data/android-release-handoff.report.json",
          nextAction: "운영 HTTPS 웹앱 origin, release SHA-256, JDK/Android SDK, APK/AAB 산출물을 준비합니다.",
        },
        {
          key: "iosIpa",
          label: "iOS IPA build/provisioning",
          status: "blocked",
          blockerCount: 1,
          ownerLane: "iOS/Release",
          evidenceType: "iOS IPA/provisioning",
          requiredEvidence: ["운영 HTTPS 웹앱 origin", "Apple Team ID", "등록된 iPhone UDID", "matching provisioning profile"],
          path: path.join(workspace, "mobile-builds", "ios", "ios-ipa-build-report.json"),
          command:
            "APPLE_TEAM_ID=<TEAM_ID> FINAL_JUDO_IOS_API_ORIGIN=https://<api-origin> npm run ios:ipa:doctor -- --team-id=<TEAM_ID> --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md",
          nextAction:
            "Register a real iPhone UDID in Apple Developer and create/download a provisioning profile for kr.co.finaljudo.multigym.",
        },
      ];

  await writeFile(
    path.join(workspace, "p1-operator-status.json"),
    json({
      ok: ready,
      releaseDecision: ready ? "ready" : "blocked",
      externalBlockers,
      leaked: secret ? "FinalJudoPilot!2026" : undefined,
    }),
  );
  await writeFile(
    path.join(workspace, "p1-owner-progress-report.json"),
    json({
      ok: ready,
      releaseDecision: ready ? "ready" : "blocked",
      ownerDecisions: ready
        ? []
        : ["파일럿을 진행할 실제 지점과 시작일", "운영 도메인과 배포 환경", "Android release handoff 증빙 담당자와 완료 예정일"],
      externalBlockers,
    }),
  );
}

const pendingWorkspace = path.join(directory, "pending");
await writeWorkspace(pendingWorkspace);
const pendingOut = path.join(pendingWorkspace, "p1-owner-decision-register.json");
const pendingMarkdown = path.join(pendingWorkspace, "p1-owner-decision-register.md");
const pendingCsv = path.join(pendingWorkspace, "p1-owner-decision-register.csv");
const pendingGuide = path.join(pendingWorkspace, "p1-owner-decision-register.guide.md");
const pending = await run([
  `--workspace=${pendingWorkspace}`,
  `--out=${pendingOut}`,
  `--markdown=${pendingMarkdown}`,
  `--csv=${pendingCsv}`,
  `--guide=${pendingGuide}`,
]);
const pendingReport = JSON.parse(pending.stdout);
const pendingJson = await readFile(pendingOut, "utf8");
const pendingMarkdownSource = await readFile(pendingMarkdown, "utf8");
const pendingCsvSource = await readFile(pendingCsv, "utf8");
const pendingGuideSource = await readFile(pendingGuide, "utf8");

assert.equal(pendingReport.ok, true);
assert.equal(pendingReport.registerDecision, "needs_owner_input");
assert.equal(pendingReport.summary.decisionRows, 3);
assert.equal(pendingReport.summary.ownerDecisionCount, 5);
assert(pendingReport.decisionRows.some((row) => row.decisionNeeded.includes("운영 도메인/배포 환경")));
assert(pendingReport.decisionRows.some((row) => row.decisionNeeded.includes("Android 앱을 먼저 배포")));
assert(pendingReport.decisionRows.some((row) => row.decisionNeeded.includes("실제 iPhone 기기 등록")));
assert(pendingReport.ownerDecisions.some((decision) => decision.includes("iOS IPA build/provisioning")));
assert(pendingMarkdownSource.includes("# P1 Owner Decision Register"));
assert(pendingMarkdownSource.includes("대표 결정 필요"));
assert(pendingMarkdownSource.includes("iOS IPA build/provisioning"));
assert(pendingMarkdownSource.includes("완료 예정일"));
assert(pendingMarkdownSource.includes("Verification Command"));
assert(pendingCsvSource.includes("decisionOwner,dueDate,evidenceOwner,evidenceUrl,checkedAt,signoff"));
assert(pendingGuideSource.includes("# 대표 의사결정 등록표 CSV 작성 안내"));
assert(pendingGuideSource.includes("대표가 채울 컬럼"));
assert(pendingGuideSource.includes("수정하면 안 되는 컬럼"));
assert(pendingGuideSource.includes("owner:decision-register:apply-csv"));
assert(!pendingJson.includes("FinalJudoPilot!2026"));
assert(!pendingMarkdownSource.includes("FinalJudoPilot!2026"));
assert(!pendingCsvSource.includes("FinalJudoPilot!2026"));
assert(!pendingGuideSource.includes("FinalJudoPilot!2026"));

const readyWorkspace = path.join(directory, "ready");
await writeWorkspace(readyWorkspace, { ready: true });
const ready = await run([`--workspace=${readyWorkspace}`]);
const readyReport = JSON.parse(ready.stdout);
assert.equal(readyReport.ok, true);
assert.equal(readyReport.registerDecision, "ready");
assert.equal(readyReport.summary.decisionRows, 0);

const secretWorkspace = path.join(directory, "secret");
await writeWorkspace(secretWorkspace, { secret: true });
await assert.rejects(run([`--workspace=${secretWorkspace}`]), /Command failed/);

const missingWorkspace = path.join(directory, "missing");
await mkdir(missingWorkspace, { recursive: true });
await assert.rejects(run([`--workspace=${missingWorkspace}`]), /Command failed/);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const releaseRunner = await readFile("scripts/run-release-checks.mjs", "utf8");
const adminSettings = await readFile("src/components/screens/admin-settings-screen.tsx", "utf8");
const readme = await readFile("README.md", "utf8");
const qaPlan = await readFile("docs/QA_TEST_PLAN.md", "utf8");
const releaseChecklist = await readFile("docs/RELEASE_CHECKLIST.md", "utf8");

assert.equal(packageJson.scripts["owner:decision-register"], "node scripts/create-owner-decision-register.mjs");
assert.equal(packageJson.scripts["test:owner-decision-register"], "node scripts/check-owner-decision-register-test.mjs");
assert(releaseRunner.includes('["run", "test:owner-decision-register"]'));
assert(!adminSettings.includes("npm run test:owner-decision-register"), "admin settings must not embed automated gate commands in app source");
assert(!adminSettings.includes("npm run owner:decision-register"), "admin settings must not embed automated gate commands in app source");
assert(!adminSettings.includes("p1-owner-decision-register.guide.md"), "admin settings must not expose internal artifact paths");

for (const source of [readme, qaPlan, releaseChecklist]) {
  assert(source.includes("npm run test:owner-decision-register"));
  assert(source.includes("owner:decision-register"));
  assert(source.includes("p1-owner-decision-register.guide.md"));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "owner decision register generation from P1 operator status and owner report",
        "decision rows include owner lane, required evidence, verification command, and operator input columns",
        "owner-facing CSV guide explains editable fields and apply command",
        "ready fixture produces no remaining decision rows",
        "missing source and secret-like source artifacts are blocked",
        "package, release, admin settings, README, QA, release checklist references exist",
      ],
    },
    null,
    2,
  ),
);
