import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-closeout-package-"));
const fieldPath = join(directory, "pilot-field-evidence.json");
const preflightPath = join(directory, "pilot-preflight.post-pilot.json");
const blockedPreflightPath = join(directory, "pilot-preflight.blocked.json");
const prePilotReportPath = join(directory, "pilot-evidence.pre-pilot.json");
const reportPath = join(directory, "pilot-evidence.post-pilot.json");
const markdownPath = join(directory, "pilot-evidence.md");
const outPath = join(directory, "pilot-closeout-package.json");

const fieldEvidence = {
  version: 1,
  pilot: {
    branches: [
      { name: "강남 본관", owner: "김도윤", evidence: "강남 본관 승인 회의록" },
      { name: "송파 도장", owner: "김도윤", evidence: "송파 도장 승인 회의록" },
    ],
    period: {
      startsOn: "2026-07-01",
      endsOn: "2026-07-14",
      operatingDays: 14,
    },
    signedOffBy: "정유진",
    signedOffAt: "2026-07-15T10:10:00+09:00",
  },
  accounts: [
    { role: "admin", email: "admin@finaljudo.kr", branchScope: "all", passwordRotated: true, loginVerified: true, evidence: "admin login screenshot" },
    { role: "owner", email: "owner@finaljudo.kr", branchScope: "강남 본관", passwordRotated: true, loginVerified: true, evidence: "owner login screenshot" },
    { role: "coach", email: "coach@finaljudo.kr", branchScope: "강남 본관", passwordRotated: true, loginVerified: true, evidence: "coach login screenshot" },
    { role: "guardian", email: "guardian@finaljudo.kr", branchScope: "강남 본관 child scope", passwordRotated: true, loginVerified: true, evidence: "guardian login screenshot" },
    { role: "member", email: "member@finaljudo.kr", branchScope: "강남 본관 self", passwordRotated: true, loginVerified: true, evidence: "member login screenshot" },
    { role: "coach", email: "coach.songpa@finaljudo.kr", branchScope: "송파 도장", passwordRotated: true, loginVerified: true, evidence: "songpa coach login screenshot" },
    { role: "guardian", email: "guardian.songpa@finaljudo.kr", branchScope: "송파 도장 child scope", passwordRotated: true, loginVerified: true, evidence: "songpa guardian login screenshot" },
    { role: "member", email: "member.songpa@finaljudo.kr", branchScope: "송파 도장 self", passwordRotated: true, loginVerified: true, evidence: "songpa member login screenshot" },
  ],
  dataImport: {
    sourceCsv: "docs/pilot-templates/pilot-data-intake.csv",
    dryRunCommand: "npm run test:pilot-import -- docs/pilot-templates/pilot-data-intake.csv",
    importCommand: "npm run pilot:import:postgres -- docs/pilot-templates/pilot-data-intake.csv",
    preflightCommand: "NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json",
    evidenceReport: prePilotReportPath,
    sensitiveDataReviewed: true,
    verified: true,
    evidence: "masked CSV review and production preflight output",
  },
  fieldChecks: {
    mobileAttendance: [
      {
        deviceKind: "ios",
        device: "iPhone Safari",
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
    ],
    screenReader: [
      {
        tool: "VoiceOver",
        role: "guardian",
        route: "/app/classes",
        target: "attendance-status",
        expectedAnnouncement: "출석 상태 버튼과 현재 상태가 함께 읽힘",
        actualAnnouncement: "출석, 버튼, 선택됨 상태가 순서대로 읽힘",
        passed: true,
        issueFree: true,
        notes: "모바일 출석 상태 변경 후 선택 상태가 즉시 낭독됨",
        evidence: "VoiceOver smoke note",
      },
      {
        tool: "TalkBack",
        role: "member",
        route: "/app/notices",
        target: "notice-read-state",
        expectedAnnouncement: "공지 제목과 읽음 상태가 함께 읽힘",
        actualAnnouncement: "공지 제목, 읽음, 버튼 상태가 순서대로 읽힘",
        passed: true,
        issueFree: true,
        notes: "읽음 처리 후 상태 텍스트가 갱신되어 낭독됨",
        evidence: "TalkBack notice read state note",
      },
    ],
    keyboardNavigation: { passed: true, evidence: "keyboard route pass note" },
    privacyMaskingVerified: true,
    incidentChannel: {
      name: "Final Judo pilot incident channel",
      owner: "정유진",
      verified: true,
      evidence: "channel link and owner confirmation",
    },
  },
  operations: {
    operationLogCount: 14,
    attendanceRecords: 120,
    paymentChecks: 28,
    noticeFollowupChecks: 18,
    noticeChecks: 14,
    unresolvedP0Count: 0,
    postPilotPreflightCommand: "NODE_ENV=production npm run preflight:pilot -- --require-retro --out=.data/pilot-preflight.post-pilot.json",
    postPilotEvidenceJson: reportPath,
    postPilotEvidenceMarkdown: markdownPath,
    feedbackCollected: true,
    verified: true,
    evidence: "14-day operation logs and post-pilot markdown report",
  },
  environment: {
    productionPreflightPassed: true,
    demoLoginDisabled: true,
    devResetDisabled: true,
    evidence: "deployment env screenshot and preflight output",
  },
};

const prePilotReport = {
  generatedAt: "2026-06-30T09:00:00.000Z",
  mode: "pre-pilot",
  releaseDecision: "ready",
  preflight: { blockerCodes: [] },
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
  preflight: { blockerCodes: [] },
  counts: {
    operationDays: 14,
    verifiedOperationDays: 14,
    attendanceRecordsLogged: 120,
    paymentChecksLogged: 28,
    noticeFollowupChecksLogged: 18,
    noticeChecksLogged: 14,
  },
};

const preflightReport = {
  generatedAt: "2026-07-15T01:04:00.000Z",
  ok: true,
  mode: "strict",
  counts: {
    pilotOperationLogs: 14,
  },
  blockers: [],
  warnings: [],
  checked: ["14-day pilot operation evidence when --require-retro is set", "mobile attendance timing evidence in pilot operation logs"],
};

const markdownReport = [
  "# Final Judo Pilot Evidence Report",
  "",
  "- Generated: 2026-07-15T01:00:00.000Z",
  "- Mode: post-pilot",
  "- Decision: ready",
  "- Runtime: postgres",
  "- Preflight blockers: none",
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

async function runCloseout(args) {
  try {
    const result = await execFile(
      process.execPath,
      [
        "scripts/check-pilot-closeout-package.mjs",
        `--field=${fieldPath}`,
        `--preflight=${preflightPath}`,
        `--report=${reportPath}`,
        `--markdown=${markdownPath}`,
        ...args,
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

await writeFile(fieldPath, `${JSON.stringify(fieldEvidence, null, 2)}\n`, "utf8");
await writeFile(prePilotReportPath, `${JSON.stringify(prePilotReport, null, 2)}\n`, "utf8");
await writeFile(preflightPath, `${JSON.stringify(preflightReport, null, 2)}\n`, "utf8");
await writeFile(reportPath, `${JSON.stringify(postPilotReport, null, 2)}\n`, "utf8");
await writeFile(markdownPath, markdownReport, "utf8");

const validRun = await runCloseout([`--out=${outPath}`]);
assert.equal(validRun.code, 0, validRun.stderr);
const validPackage = JSON.parse(validRun.stdout);
assert.equal(validPackage.ok, true, "valid closeout package must be ready");
assert.equal(validPackage.releaseDecision, "ready", "valid closeout package must have ready decision");
assert.equal(validPackage.counts.operationDays, 14, "closeout package must carry operation day count");
assert(validPackage.checked.includes("field evidence manifest validation"), "closeout package must include field evidence validation");

const writtenPackage = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(writtenPackage.releaseDecision, "ready", "closeout package must write the ready artifact");

await writeFile(
  blockedPreflightPath,
  `${JSON.stringify({ ...preflightReport, ok: false, blockers: [{ code: "P0_INCIDENT_OPEN" }] }, null, 2)}\n`,
  "utf8",
);
const blockedRun = await execFile(
  process.execPath,
  [
    "scripts/check-pilot-closeout-package.mjs",
    `--field=${fieldPath}`,
    `--preflight=${blockedPreflightPath}`,
    `--report=${reportPath}`,
    `--markdown=${markdownPath}`,
  ],
  {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  },
).catch((error) => ({ code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
assert.notEqual(blockedRun.code ?? 0, 0, "blocked preflight closeout package must fail");
const blockedPackage = JSON.parse(blockedRun.stdout);
assert(
  blockedPackage.blockers.some((blocker) => blocker.code === "POST_PILOT_PREFLIGHT_NOT_READY"),
  "closeout package must block when post-pilot preflight is not ready",
);

const staleRun = await execFile(
  process.execPath,
  [
    "scripts/check-pilot-closeout-package.mjs",
    `--field=${fieldPath}`,
    `--preflight=${preflightPath}`,
    `--report=${reportPath}`,
    `--markdown=${join(directory, "missing.md")}`,
  ],
  {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  },
).catch((error) => ({ code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
assert.notEqual(staleRun.code ?? 0, 0, "missing markdown closeout package must fail");
const stalePackage = JSON.parse(staleRun.stdout);
assert(
  stalePackage.blockers.some((blocker) => blocker.code === "POST_PILOT_MARKDOWN_UNREADABLE" || blocker.code === "FIELD_EVIDENCE_BLOCKED"),
  "closeout package must block when the Markdown artifact is missing",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "valid post-pilot closeout package artifact",
        "closeout package writes release decision JSON",
        "blocked post-pilot preflight blocks closeout",
        "missing Markdown evidence blocks closeout",
      ],
    },
    null,
    2,
  ),
);
