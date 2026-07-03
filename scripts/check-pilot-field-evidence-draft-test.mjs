import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-field-evidence-draft-"));
const sourceCsv = "docs/pilot-templates/pilot-data-intake.csv";
const prePilotReportPath = join(directory, "pilot-evidence.pre.json");
const postPilotReportPath = join(directory, "pilot-evidence.post.json");
const postPilotMarkdownPath = join(directory, "pilot-evidence.post.md");
const draftPath = join(directory, "pilot-field-evidence.draft.json");
const readyPath = join(directory, "pilot-field-evidence.ready.json");

const prePilotReport = {
  generatedAt: "2026-06-30T09:00:00.000Z",
  mode: "pre-pilot",
  releaseDecision: "ready",
  preflight: {
    blockerCodes: [],
  },
  counts: {
    branches: 2,
    users: 8,
    members: 4,
    classes: 4,
    payments: 4,
    notices: 2,
  },
};

const postPilotReport = {
  generatedAt: "2026-07-15T01:05:00.000Z",
  mode: "post-pilot",
  releaseDecision: "ready",
  preflight: {
    blockerCodes: [],
  },
  counts: {
    operationDays: 14,
    verifiedOperationDays: 14,
    attendanceRecordsLogged: 120,
    paymentChecksLogged: 28,
    noticeFollowupChecksLogged: 18,
    noticeChecksLogged: 14,
    unresolvedIncidents: 0,
  },
};

const postPilotMarkdown = [
  "# Final Judo Pilot Evidence Report",
  "",
  "- Generated: 2026-07-15T01:00:00.000Z",
  "- Mode: post-pilot",
  "- Decision: ready",
  "- Runtime: postgres",
  "- Preflight blockers: none",
  "- Preflight warnings: none",
  "",
  "## Operations",
  "",
  "- Operation days: 14",
  "- Verified operation days: 14",
  "- Attendance records logged: 120",
  "- Payment checks logged: 28",
  "- Notice follow-up checks logged: 18",
  "- Notice checks logged: 14",
  "",
].join("\n");

async function runNode(script, args = []) {
  try {
    const result = await execFile(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function fillReadyEvidence(draft) {
  const ready = structuredClone(draft);

  ready.pilot.branches = ready.pilot.branches.map((branch) => ({
    ...branch,
    owner: "정유진",
    evidence: `${branch.name} 파일럿 승인 회의록`,
  }));
  ready.pilot.signedOffBy = "정유진";
  ready.pilot.signedOffAt = "2026-07-15T10:10:00+09:00";

  ready.accounts = ready.accounts.map((account) => ({
    ...account,
    passwordRotated: true,
    loginVerified: true,
    evidence: `${account.email} password rotation and login screenshot`,
  }));

  ready.dataImport.sensitiveDataReviewed = true;
  ready.dataImport.verified = true;
  ready.dataImport.evidence = "masked CSV review and pre-pilot command output";

  ready.fieldChecks.mobileAttendance = [
    {
      deviceKind: "ios",
      device: "iPhone 15 Safari",
      browser: "Safari",
      route: "/app/classes",
      durationSeconds: 22,
      touchTargetsVerified: true,
      noHorizontalOverflow: true,
      offlineQueueVerified: true,
      evidence: "ios attendance screen recording",
    },
    {
      deviceKind: "android",
      device: "Galaxy Chrome",
      browser: "Chrome",
      route: "/app/classes",
      durationSeconds: 24,
      touchTargetsVerified: true,
      noHorizontalOverflow: true,
      offlineQueueVerified: true,
      evidence: "android attendance screen recording",
    },
    {
      deviceKind: "tablet",
      device: "iPad Safari",
      browser: "Safari",
      route: "/app/classes",
      durationSeconds: 20,
      touchTargetsVerified: true,
      noHorizontalOverflow: true,
      offlineQueueVerified: false,
      evidence: "tablet attendance screenshot",
    },
  ];
  ready.fieldChecks.screenReader = [
    {
      tool: "VoiceOver",
      role: "coach",
      route: "/app/classes",
      target: "attendance-status",
      expectedAnnouncement: "출석 상태 버튼과 현재 상태가 함께 읽힘",
      actualAnnouncement: "출석, 버튼, 선택됨 상태가 순서대로 읽힘",
      passed: true,
      issueFree: true,
      notes: "모바일 출석 상태 변경 후 선택 상태가 즉시 낭독됨",
      evidence: "VoiceOver attendance note",
    },
    {
      tool: "TalkBack",
      role: "guardian",
      route: "/app/notices",
      target: "notice-read-state",
      expectedAnnouncement: "공지 제목과 읽음 상태가 함께 읽힘",
      actualAnnouncement: "공지 제목, 읽음, 버튼 상태가 순서대로 읽힘",
      passed: true,
      issueFree: true,
      notes: "읽음 처리 후 상태 텍스트가 갱신되어 낭독됨",
      evidence: "TalkBack notice read state note",
    },
  ];
  ready.fieldChecks.keyboardNavigation = {
    passed: true,
    evidence: "keyboard route pass note",
  };
  ready.fieldChecks.privacyMaskingVerified = true;
  ready.fieldChecks.incidentChannel = {
    name: "Final Judo pilot incident channel",
    owner: "정유진",
    verified: true,
    evidence: "channel link and owner confirmation",
  };

  ready.operations.feedbackCollected = true;
  ready.operations.verified = true;
  ready.operations.evidence = "14-day operation logs and post-pilot markdown report";
  ready.environment = {
    productionPreflightPassed: true,
    demoLoginDisabled: true,
    devResetDisabled: true,
    evidence: "deployment env screenshot and preflight output",
  };

  return ready;
}

await writeFile(prePilotReportPath, `${JSON.stringify(prePilotReport, null, 2)}\n`);
await writeFile(postPilotReportPath, `${JSON.stringify(postPilotReport, null, 2)}\n`);
await writeFile(postPilotMarkdownPath, `${postPilotMarkdown}\n`);

const draftRun = await runNode("scripts/create-pilot-field-evidence-draft.mjs", [
  `--source-csv=${sourceCsv}`,
  `--pre-pilot-evidence=${prePilotReportPath}`,
  `--post-pilot-evidence=${postPilotReportPath}`,
  `--post-pilot-markdown=${postPilotMarkdownPath}`,
  `--out=${draftPath}`,
  "--starts-on=2026-07-01",
  "--ends-on=2026-07-14",
]);
assert.equal(draftRun.code, 0, draftRun.stderr);
const draft = JSON.parse(draftRun.stdout);
const writtenDraft = JSON.parse(await readFile(draftPath, "utf8"));
assert.deepEqual(writtenDraft, draft, "field evidence draft --out must write stdout JSON");
assert.deepEqual(
  draft.pilot.branches.map((branch) => branch.name).sort(),
  ["강남 본관", "송파 도장"],
  "draft must copy source CSV branch rows",
);
assert.equal(draft.accounts.length, 8, "draft must copy every source CSV account");
assert(draft.accounts.some((account) => account.email === "coach.songpa@finaljudo.kr"), "draft must include Songpa coach account");
assert.equal(draft.operations.operationLogCount, 14, "draft must copy operation day count from post-pilot report");
assert.equal(draft.operations.attendanceRecords, 120, "draft must copy attendance count from post-pilot report");
assert.equal(draft.dataImport.sourceCsv, sourceCsv, "draft must preserve source CSV path");
assert(draft.dataImport.dryRunCommand.includes(sourceCsv), "draft dry-run command must reference source CSV");
assert.equal(draft.draftMeta.prePilotEvidenceFound, true, "draft metadata must record pre-pilot report availability");
assert.equal(draft.draftMeta.postPilotEvidenceFound, true, "draft metadata must record post-pilot report availability");

const shapeRun = await runNode("scripts/check-pilot-field-evidence.mjs", [`--file=${draftPath}`, "--allow-template"]);
assert.equal(shapeRun.code, 0, shapeRun.stderr || shapeRun.stdout);

const blockedRun = await runNode("scripts/check-pilot-field-evidence.mjs", [`--file=${draftPath}`, `--report=${postPilotReportPath}`]);
assert.notEqual(blockedRun.code, 0, "draft must remain blocked until field-only evidence is filled");
const blockedResult = JSON.parse(blockedRun.stdout);
const blockedCodes = blockedResult.blockers.map((blocker) => blocker.code);
assert(blockedCodes.includes("ACCOUNT_PASSWORD_NOT_ROTATED"), "draft must require account password rotation");
assert(blockedCodes.includes("MOBILE_ATTENDANCE_TOO_SLOW"), "draft must require measured mobile attendance duration");
assert(blockedCodes.includes("SCREEN_READER_NOT_PASSED"), "draft must require screen reader pass confirmation");
assert(blockedCodes.includes("PRODUCTION_PREFLIGHT_NOT_PASSED"), "draft must require production environment confirmation");

await writeFile(readyPath, `${JSON.stringify(fillReadyEvidence(draft), null, 2)}\n`);
const readyRun = await runNode("scripts/check-pilot-field-evidence.mjs", [`--file=${readyPath}`, `--report=${postPilotReportPath}`]);
assert.equal(readyRun.code, 0, readyRun.stderr || readyRun.stdout);
const readyResult = JSON.parse(readyRun.stdout);
assert.equal(readyResult.ok, true, "operator-completed field evidence draft must pass validator");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "field evidence draft copies source CSV branches/accounts",
        "field evidence draft copies post-pilot operation counts",
        "placeholder draft validates as template shape but blocks strict release",
        "operator-completed draft passes field evidence validator",
      ],
    },
    null,
    2,
  ),
);
