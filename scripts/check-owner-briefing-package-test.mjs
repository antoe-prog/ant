#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-owner-briefing-package-"));

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function run(args, options = {}) {
  return execFile(process.execPath, ["scripts/create-owner-briefing-package.mjs", ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 4,
    ...options,
  });
}

async function writeFixture(workspace, { completedDecisionRegister = false, secret = false } = {}) {
  await mkdir(workspace, { recursive: true });

  await writeFile(
    path.join(workspace, "static-owner-report.md"),
    "# P1 대표 진행 보고서\n\nMVP 기능 개발 완료, 파일럿 운영 및 앱 배포 전 최종 준비 단계입니다.\n",
  );
  await writeFile(
    path.join(workspace, "team-agent-prompts.md"),
    "# 파이널 유도 멀티짐 P1 6인 팀 에이전트 목표 프롬프트\n\nP0 MVP 개발은 완료된 상태이며, P1은 P0를 다시 만드는 작업이 아닙니다. Android APK artifact와 iOS Simulator/IPA release 상태, 7개 외부 blocker를 구분합니다.\n",
  );
  await writeFile(
    path.join(workspace, "p1-owner-progress-report.md"),
    "# P1 대표 진행 보고서 초안\n\n대표님, 현재 핵심 기능 개발은 완료됐고 실제 운영에 필요한 검증과 배포 준비 단계입니다.\n",
  );
  await writeFile(
    path.join(workspace, "p1-owner-progress-report.json"),
    json({
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-06-16T00:00:00.000Z",
      externalBlockers: [{ key: "android" }, { key: "deployment" }],
      blockers: [{ code: "OWNER_PROGRESS_REPORT_EXTERNAL_PREP_PENDING" }],
      leaked: secret ? "FinalJudoPilot!2026" : undefined,
    }),
  );
  await writeFile(
    path.join(workspace, "p1-owner-decision-register.md"),
    "# P1 Owner Decision Register\n\n대표 결정 필요\n",
  );
  await writeFile(
    path.join(workspace, "p1-owner-decision-register.json"),
    json({
      ok: true,
      registerDecision: "needs_owner_input",
      generatedAt: "2026-06-16T00:00:00.500Z",
      summary: { externalBlockers: 2, decisionRows: 2 },
      decisionRows: [{ key: "android" }, { key: "deployment" }],
    }),
  );
  await writeFile(
    path.join(workspace, "p1-owner-decision-register.csv"),
    "sequence,key,label,decisionOwner,dueDate,evidenceOwner,evidenceUrl,checkedAt,signoff\n1,android,Android release,,,,,,\n",
  );
  await writeFile(
    path.join(workspace, "p1-owner-decision-register.guide.md"),
    "# 대표 의사결정 등록표 CSV 작성 안내\n\n- `decisionOwner`, `dueDate`, `evidenceOwner`를 채웁니다.\n",
  );
  if (completedDecisionRegister) {
    await writeFile(
      path.join(workspace, "p1-owner-decision-register.completed.md"),
      "# P1 Owner Decision Register Completed\n\n- Register decision: `decisions_recorded`\n",
    );
    await writeFile(
      path.join(workspace, "p1-owner-decision-register.completed.json"),
      json({
        ok: true,
        registerDecision: "decisions_recorded",
        ownerDecisionRegisterCompleted: true,
        generatedAt: "2026-06-16T00:00:00.750Z",
        summary: { decisionRows: 2, completedDecisionRows: 2 },
        decisionRows: [
          {
            key: "android",
            ownerDecision: {
              decisionOwner: "대표 지정 책임자",
              dueDate: "2026-07-01",
              evidenceOwner: "release-owner@finaljudo.test",
            },
          },
          {
            key: "deployment",
            ownerDecision: {
              decisionOwner: "대표 지정 책임자",
              dueDate: "2026-07-02",
              evidenceOwner: "deploy-owner@finaljudo.test",
            },
          },
        ],
      }),
    );
  }
  await writeFile(path.join(workspace, "p1-operator-status.md"), "# P1 Operator Status\n\nExternal blockers: 2\n");
  await writeFile(
    path.join(workspace, "p1-operator-status.json"),
    json({
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-06-16T00:00:01.000Z",
      externalBlockers: [{ key: "android" }, { key: "deployment" }],
      blockers: [{ code: "P1_OPERATOR_STATUS_READINESS_BLOCKED" }],
    }),
  );
  await writeFile(path.join(workspace, "p1-completion-evidence.md"), "# P1 Completion Evidence Matrix\n\n6/10 internal-ready\n");
  await writeFile(
    path.join(workspace, "p1-completion-evidence.json"),
    json({
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-06-16T00:00:02.000Z",
      blockers: [{ code: "P1_COMPLETION_EXTERNAL_BLOCKERS" }],
    }),
  );
  await writeFile(
    path.join(workspace, "p1-completion-evidence.csv"),
    "criterionKey,criterionLabel,status,evidenceOwner,evidenceUrl,checkedAt,signoff\np0,P0 핵심 기능 유지,ready_internal,,,,\n",
  );
  await writeFile(
    path.join(workspace, "p1-operator-status-external-blockers.csv"),
    "key,label,status,evidenceOwner,evidenceUrl,checkedAt,signoff\nandroid,Android release,blocked,,,,\n",
  );
}

const workspace = path.join(directory, "ready-to-share");
await writeFixture(workspace);
const outPath = path.join(workspace, "owner-briefing-package.json");
const markdownPath = path.join(workspace, "owner-briefing-package.md");
const packageDir = path.join(workspace, "owner-briefing-package");
const result = await run([
  `--workspace=${workspace}`,
  `--static-report=${path.join(workspace, "static-owner-report.md")}`,
  `--team-agent-prompts=${path.join(workspace, "team-agent-prompts.md")}`,
  `--out=${outPath}`,
  `--markdown=${markdownPath}`,
  `--package-dir=${packageDir}`,
]);
const report = JSON.parse(result.stdout);
const manifestSource = await readFile(outPath, "utf8");
const markdownSource = await readFile(markdownPath, "utf8");
const copiedOwnerDraft = await readFile(path.join(packageDir, "reports", "p1-owner-progress-report.md"), "utf8");
const copiedTeamPrompts = await readFile(path.join(packageDir, "docs", "TEAM_AGENT_PROMPTS.md"), "utf8");
const packageReadme = await readFile(path.join(packageDir, "README.md"), "utf8");

assert.equal(report.ok, true);
assert.equal(report.shareDecision, "ready_to_share");
assert.equal(report.summary.totalArtifacts, 14);
assert.equal(report.summary.readyArtifacts, 14);
assert.equal(report.summary.optionalArtifacts, 2);
assert.equal(report.summary.readyOptionalArtifacts, 0);
assert.equal(report.summary.missingOptionalArtifacts, 2);
assert.equal(report.summary.packageReadmeReady, true);
assert.equal(report.packageReadme.targetPath, "README.md");
assert(report.packageReadme.sha256);
assert(report.packageReadme.sizeBytes > 0);
assert(report.checked.includes("P1 6인 팀 목표 프롬프트"));
assert(report.checked.includes("owner decision register CSV guide"));
assert.equal(report.ownerDecisionRegisterStatus.state, "needs_owner_input");
assert.equal(report.sourceStatus.releaseDecision, "blocked");
assert.equal(report.sourceStatus.externalBlockers, 2);
assert(report.artifacts.filter((artifact) => !artifact.optional).every((artifact) => artifact.sha256 && artifact.sizeBytes > 0));
assert(markdownSource.includes("# P1 대표 공유 패키지 요약"));
assert(markdownSource.includes("ready_to_share"));
assert(markdownSource.includes("teamAgentPrompts"));
assert(markdownSource.includes("ownerDecisionRegisterMarkdown"));
assert(markdownSource.includes("ownerDecisionRegisterGuide"));
assert(markdownSource.includes("needs_owner_input"));
assert(markdownSource.includes("패키지 README"));
assert(markdownSource.includes("## 산출물 목록"));
assert(markdownSource.includes("## 대표 결정 후속 조치"));
assert(markdownSource.includes("패키지 차단 항목은 없습니다"));
assert(copiedOwnerDraft.includes("대표님"));
assert(copiedTeamPrompts.includes("P1 6인 팀"));
assert(packageReadme.includes("# P1 대표 공유 패키지 먼저 읽기"));
assert(packageReadme.includes("먼저 읽을 순서"));
assert(packageReadme.includes("대표 결정 입력 대기"));
assert(packageReadme.includes("reports/p1-owner-progress-report.md"));
assert(packageReadme.includes("docs/TEAM_AGENT_PROMPTS.md"));
assert(packageReadme.includes("handoff/p1-owner-decision-register.csv"));
assert(packageReadme.includes("handoff/p1-owner-decision-register.guide.md"));
assert(!manifestSource.includes("FinalJudoPilot!2026"));
assert(!markdownSource.includes("FinalJudoPilot!2026"));
assert(!packageReadme.includes("FinalJudoPilot!2026"));

const completedWorkspace = path.join(directory, "completed-decision-register");
await writeFixture(completedWorkspace, { completedDecisionRegister: true });
const completedOutPath = path.join(completedWorkspace, "owner-briefing-package.json");
const completedMarkdownPath = path.join(completedWorkspace, "owner-briefing-package.md");
const completedPackageDir = path.join(completedWorkspace, "owner-briefing-package");
const completedResult = await run([
  `--workspace=${completedWorkspace}`,
  `--static-report=${path.join(completedWorkspace, "static-owner-report.md")}`,
  `--team-agent-prompts=${path.join(completedWorkspace, "team-agent-prompts.md")}`,
  `--out=${completedOutPath}`,
  `--markdown=${completedMarkdownPath}`,
  `--package-dir=${completedPackageDir}`,
]);
const completedReport = JSON.parse(completedResult.stdout);
const completedMarkdownSource = await readFile(completedMarkdownPath, "utf8");
const completedPackageReadme = await readFile(path.join(completedPackageDir, "README.md"), "utf8");
const copiedCompletedRegister = await readFile(
  path.join(completedPackageDir, "reports", "p1-owner-decision-register.completed.json"),
  "utf8",
);

assert.equal(completedReport.ok, true);
assert.equal(completedReport.summary.totalArtifacts, 14);
assert.equal(completedReport.summary.readyArtifacts, 14);
assert.equal(completedReport.summary.optionalArtifacts, 2);
assert.equal(completedReport.summary.readyOptionalArtifacts, 2);
assert.equal(completedReport.summary.packageReadmeReady, true);
assert.equal(completedReport.ownerDecisionRegisterStatus.state, "decisions_recorded");
assert.equal(completedReport.ownerDecisionRegisterStatus.completedDecisionRows, 2);
assert(completedMarkdownSource.includes("decisions_recorded"));
assert(completedMarkdownSource.includes("대표 결정 기록 완료"));
assert(completedPackageReadme.includes("대표 결정 기록 완료"));
assert(completedPackageReadme.includes("completed 등록표가 포함"));
assert(copiedCompletedRegister.includes("ownerDecisionRegisterCompleted"));

const missingWorkspace = path.join(directory, "missing");
await mkdir(missingWorkspace, { recursive: true });
await assert.rejects(
  run([
    `--workspace=${missingWorkspace}`,
    `--static-report=${path.join(workspace, "static-owner-report.md")}`,
    `--out=${path.join(missingWorkspace, "owner-briefing-package.json")}`,
  ]),
  /Command failed/,
);

const secretWorkspace = path.join(directory, "secret");
await writeFixture(secretWorkspace, { secret: true });
await assert.rejects(
  run([
    `--workspace=${secretWorkspace}`,
    `--static-report=${path.join(secretWorkspace, "static-owner-report.md")}`,
    `--team-agent-prompts=${path.join(secretWorkspace, "team-agent-prompts.md")}`,
    `--out=${path.join(secretWorkspace, "owner-briefing-package.json")}`,
  ]),
  /Command failed/,
);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const releaseRunner = await readFile("scripts/run-release-checks.mjs", "utf8");
const adminSettings = await readFile("src/components/screens/admin-settings-screen.tsx", "utf8");
const readme = await readFile("README.md", "utf8");
const qaPlan = await readFile("docs/QA_TEST_PLAN.md", "utf8");
const releaseChecklist = await readFile("docs/RELEASE_CHECKLIST.md", "utf8");

assert.equal(packageJson.scripts["owner:briefing-package"], "node scripts/create-owner-briefing-package.mjs");
assert.equal(packageJson.scripts["test:owner-briefing-package"], "node scripts/check-owner-briefing-package-test.mjs");
assert(releaseRunner.includes('["run", "test:owner-briefing-package"]'));
assert(!adminSettings.includes("npm run test:owner-briefing-package"), "admin settings must not embed automated gate commands in app source");
assert(!adminSettings.includes("npm run owner:briefing-package"), "admin settings must not embed automated gate commands in app source");
assert(!adminSettings.includes("패키지 README"), "admin settings must not expose internal packaging wording");
assert(!adminSettings.includes("docs/TEAM_AGENT_PROMPTS.md"), "admin settings must not expose internal doc paths");

for (const source of [readme, qaPlan, releaseChecklist]) {
  assert(source.includes("npm run test:owner-briefing-package"));
  assert(source.includes("owner:briefing-package"));
  assert(source.includes("docs/TEAM_AGENT_PROMPTS.md"));
  assert(source.includes("p1-owner-decision-register.completed"));
  assert(source.includes("패키지 README"));
  assert(source.includes("p1-owner-decision-register.guide.md"));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "owner briefing package manifest generation",
        "shareable package directory copy",
        "package README reading order and next action generation",
        "Korean owner-facing package Markdown summary",
        "owner decision register CSV guide is included in package manifest and README order",
        "SHA-256 and byte-size coverage",
        "optional completed owner decision register is copied when present",
        "blocked P1 source state can still be shared safely",
        "missing artifact and secret-like fixture blocked",
        "package, release, admin settings, README, QA, release checklist references exist",
      ],
    },
    null,
    2,
  ),
);
