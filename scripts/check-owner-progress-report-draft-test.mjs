#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-owner-progress-report-"));

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function run(args, options = {}) {
  return execFile(process.execPath, ["scripts/create-owner-progress-report-draft.mjs", ...args], {
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
          key: "android",
          label: "Android release",
          status: "blocked",
          ownerLane: "Android/Release",
          evidenceType: "APK/AAB release evidence",
          requiredEvidence: [
            "운영 HTTPS 웹앱 origin",
            "release signing SHA-256",
            "APK/AAB artifact",
            "주소창/공유/더보기 브라우저 UI가 없는 Android 실기기 smoke",
          ],
          nextAction:
            "npm run android:release-handoff:draft -- --device-smoke-passed --out=.data/android-release-handoff.json && npm run android:release-handoff -- --file=.data/android-release-handoff.json --out=.data/android-release-handoff.report.json",
        },
        {
          key: "iosIpa",
          label: "iOS IPA build/provisioning",
          status: "blocked",
          ownerLane: "iOS/Release",
          evidenceType: "iOS IPA/provisioning evidence",
          requiredEvidence: ["운영 HTTPS 웹앱 origin", "등록된 iPhone UDID", "matching provisioning profile", "IPA archive/export report"],
          nextAction:
            "Register a real iPhone UDID in Apple Developer and create/download a provisioning profile for kr.co.finaljudo.multigym.",
        },
        {
          key: "paymentProvider",
          label: "결제 provider",
          status: "blocked",
          ownerLane: "Backend/Data",
          evidenceType: "실 PG/VAN 계약 증빙",
          requiredEvidence: ["checkout URL", "webhook secret store", "실 영수증 URL"],
          nextAction: "npm run payment-provider:handoff:draft -- --out=.data/payment-provider-handoff.json",
        },
      ];
  const operatorStatus = {
    ok: ready,
    releaseDecision: ready ? "ready" : "blocked",
    summary: {
      externalBlockers: externalBlockers.length,
      releaseCustodyReady: ready,
    },
    ownerDecisionRegister: ready
      ? {
          state: "decisions_recorded",
          label: "대표 결정 기록 완료",
          ready: true,
          sourcePath: ".data/p1-owner-decision-register.json",
          completedPath: ".data/p1-owner-decision-register.completed.json",
          decisionRows: 7,
          completedDecisionRows: 7,
          nextAction:
            "대표 결정 입력은 기록됐습니다. 각 외부 증빙 handoff와 P1 readiness strict 통과를 이어서 확인합니다.",
        }
      : {
          state: "needs_owner_input",
          label: "대표 결정 입력 대기",
          ready: false,
          sourcePath: ".data/p1-owner-decision-register.json",
          completedPath: null,
          decisionRows: 7,
          completedDecisionRows: 0,
          nextAction:
            "대표가 .data/p1-owner-decision-register.csv의 담당자, 기한, 증빙 책임자, 증빙 URL, 확인 시각, signoff를 채운 뒤 owner:decision-register:apply-csv를 실행합니다.",
        },
    releaseCustody: {
      ready,
      prerequisitesReady: ready,
      packageReady: ready,
      archiveReady: ready,
      storageReceiptReady: ready,
    },
    externalBlockers,
    nextActions: ready ? [] : ["운영 서버/도메인과 DB 환경을 확정합니다."],
  };
  const completionEvidence = {
    ok: ready,
    releaseDecision: ready ? "ready" : "blocked",
    summary: {
      totalCriteria: 10,
      ready: ready ? 10 : 0,
      readyInternal: ready ? 0 : 6,
      blockedExternal: ready ? 0 : 4,
      externalBlockers: externalBlockers.length,
    },
    criteria: Array.from({ length: 10 }, (_, index) => ({
      key: `criterion-${index + 1}`,
      label: `P1 완료 기준 ${index + 1}`,
      status: ready ? "ready" : index < 6 ? "ready_internal" : "blocked_external",
      nextAction: ready ? "" : externalBlockers[index % externalBlockers.length]?.nextAction,
    })),
    nextActions: ready ? [] : ["파일럿 지점에서 2주 운영 증빙을 쌓습니다."],
  };

  if (secret) {
    operatorStatus.leaked = "FinalJudoPilot!2026";
  }

  await writeFile(path.join(workspace, "p1-operator-status.json"), json(operatorStatus));
  await writeFile(path.join(workspace, "p1-completion-evidence.json"), json(completionEvidence));
}

const pendingWorkspace = path.join(directory, "pending");
await writeWorkspace(pendingWorkspace);
const pendingMarkdown = path.join(pendingWorkspace, "p1-owner-progress-report.md");
const pendingJson = path.join(pendingWorkspace, "p1-owner-progress-report.json");
const pending = await run([
  `--workspace=${pendingWorkspace}`,
  "--allow-pending",
  `--out=${pendingMarkdown}`,
  `--json=${pendingJson}`,
]);
const pendingReport = JSON.parse(pending.stdout);
const pendingMarkdownSource = await readFile(pendingMarkdown, "utf8");
const pendingJsonSource = await readFile(pendingJson, "utf8");

assert.equal(pendingReport.ok, false);
assert.equal(pendingReport.releaseDecision, "blocked");
assert.equal(pendingReport.summary.externalBlockers, 3);
assert.equal(pendingReport.summary.ownerDecisionRegisterState, "needs_owner_input");
assert.equal(pendingReport.ownerDecisionRegister.completedDecisionRows, 0);
assert(pendingReport.ownerDecisions.some((decision) => decision.includes("iOS IPA build/provisioning")));
assert(pendingMarkdownSource.includes("# P1 대표 진행 보고서 초안"));
assert(pendingMarkdownSource.includes("MVP 기능 개발 완료"));
assert(pendingMarkdownSource.includes("파일럿 운영 및 앱 배포 전 최종 준비 단계"));
assert(pendingMarkdownSource.includes("개발 미완성이 아니라 운영 전 외부 준비"));
assert(pendingMarkdownSource.includes("Android release"));
assert(pendingMarkdownSource.includes("주소창/공유/더보기 브라우저 UI가 없는 Android 실기기 smoke"));
assert(pendingMarkdownSource.includes("android:release-handoff:draft"));
assert(pendingReport.remainingExternalPrep.some((item) => item.includes("주소창/공유/더보기 브라우저 UI")));
assert(pendingMarkdownSource.includes("iOS IPA build/provisioning"));
assert(pendingMarkdownSource.includes("결제 provider"));
assert(pendingMarkdownSource.includes("## 대표 의사결정 등록표 상태"));
assert(pendingMarkdownSource.includes("대표 결정 입력 대기"));
assert(pendingMarkdownSource.includes("needs_owner_input"));
assert(pendingMarkdownSource.includes("대표가 .data/p1-owner-decision-register.csv"));
assert(pendingMarkdownSource.includes("과장해서 말하지 말 것"));
assert(pendingMarkdownSource.includes("iOS Simulator 실행과 IPA 배포 가능 상태를 분리"));
assert(pendingReport.antiOverclaiming.some((item) => item.includes("iOS IPA 배포 가능")));
assert(!pendingMarkdownSource.includes("FinalJudoPilot!2026"));
assert(!pendingJsonSource.includes("FinalJudoPilot!2026"));

await assert.rejects(
  run([`--workspace=${pendingWorkspace}`, `--out=${path.join(pendingWorkspace, "strict.md")}`]),
  /Command failed/,
);

const readyWorkspace = path.join(directory, "ready");
await writeWorkspace(readyWorkspace, { ready: true });
const ready = await run([`--workspace=${readyWorkspace}`]);
const readyReport = JSON.parse(ready.stdout);
const readyMarkdown = await readFile(path.join(readyWorkspace, "p1-owner-progress-report.md"), "utf8");
assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert.equal(readyReport.summary.ownerDecisionRegisterState, "decisions_recorded");
assert.equal(readyReport.ownerDecisionRegister.completedDecisionRows, 7);
assert(readyMarkdown.includes("최종 배포 판단만 남았습니다"));
assert(readyMarkdown.includes("대표 결정 기록 완료"));
assert(readyMarkdown.includes("P1 ready는 외부 증빙과 strict 검증 통과 후에만 판단합니다"));

const secretWorkspace = path.join(directory, "secret");
await writeWorkspace(secretWorkspace, { secret: true });
await assert.rejects(run([`--workspace=${secretWorkspace}`, "--allow-pending"]), /Command failed/);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const releaseRunner = await readFile("scripts/run-release-checks.mjs", "utf8");
const adminSettings = await readFile("src/components/screens/admin-settings-screen.tsx", "utf8");
const readme = await readFile("README.md", "utf8");
const qaPlan = await readFile("docs/QA_TEST_PLAN.md", "utf8");
const releaseChecklist = await readFile("docs/RELEASE_CHECKLIST.md", "utf8");

assert.equal(
  packageJson.scripts["owner:progress-report:draft"],
  "node scripts/create-owner-progress-report-draft.mjs",
  "package.json must expose owner:progress-report:draft",
);
assert.equal(
  packageJson.scripts["test:owner-progress-report-draft"],
  "node scripts/check-owner-progress-report-draft-test.mjs",
  "package.json must expose test:owner-progress-report-draft",
);
assert(releaseRunner.includes('["run", "test:owner-progress-report-draft"]'));
assert(!adminSettings.includes("npm run test:owner-progress-report-draft"));
assert(!adminSettings.includes("npm run owner:progress-report:draft"));

for (const source of [readme, qaPlan, releaseChecklist]) {
  assert(source.includes("npm run test:owner-progress-report-draft"));
  assert(source.includes("owner:progress-report:draft"));
  assert(source.includes("대표 의사결정 등록표 상태"));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "owner progress report draft generation from P1 operator/completion artifacts",
        "pending report separates external preparation from development completion",
        "owner decision register state appears in owner-facing report next actions",
        "strict mode fails while external blockers remain",
        "ready fixture produces owner-ready report",
        "secret-like source artifact is blocked",
        "package, release, README, QA, release checklist references exist while app UI hides internal commands",
      ],
    },
    null,
    2,
  ),
);
