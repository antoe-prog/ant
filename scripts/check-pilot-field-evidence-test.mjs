import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const nodeArgs = ["scripts/check-pilot-field-evidence.mjs"];
const directory = await mkdtemp(join(tmpdir(), "final-judo-field-evidence-"));
const validPath = join(directory, "valid-field-evidence.json");
const invalidPath = join(directory, "invalid-field-evidence.json");
const unreadableMarkdownPath = join(directory, "unreadable-markdown-field-evidence.json");
const earlySignoffPath = join(directory, "early-signoff-field-evidence.json");
const mismatchedSourceScopePath = join(directory, "mismatched-source-scope-field-evidence.json");
const invalidSourceCsvPath = join(directory, "broken-pilot-data.csv");
const validPrePilotReportPath = join(directory, "valid-pre-pilot-evidence-report.json");
const invalidPrePilotReportPath = join(directory, "invalid-pre-pilot-evidence-report.json");
const mismatchedPrePilotReportPath = join(directory, "mismatched-pre-pilot-evidence-report.json");
const mismatchedPrePilotEvidencePath = join(directory, "mismatched-pre-pilot-field-evidence.json");
const validReportPath = join(directory, "valid-pilot-evidence-report.json");
const invalidReportPath = join(directory, "invalid-pilot-evidence-report.json");
const validMarkdownPath = join(directory, "valid-pilot-evidence-report.md");
const invalidMarkdownPath = join(directory, "invalid-pilot-evidence-report.md");
const templatePath = "docs/pilot-templates/pilot-field-evidence.template.json";

const validEvidence = {
  version: 1,
  pilot: {
    branches: [
      {
        name: "강남 본관",
        owner: "김도윤",
        evidence: "운영 승인 회의록 2026-07-01",
      },
      {
        name: "송파 도장",
        owner: "김도윤",
        evidence: "송파 도장 파일럿 승인 회의록 2026-07-01",
      },
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
    {
      role: "admin",
      email: "admin@finaljudo.kr",
      branchScope: "all",
      passwordRotated: true,
      loginVerified: true,
      evidence: "admin login screenshot",
    },
    {
      role: "owner",
      email: "owner@finaljudo.kr",
      branchScope: "강남 본관",
      passwordRotated: true,
      loginVerified: true,
      evidence: "owner login screenshot",
    },
    {
      role: "coach",
      email: "coach@finaljudo.kr",
      branchScope: "강남 본관",
      passwordRotated: true,
      loginVerified: true,
      evidence: "coach login screenshot",
    },
    {
      role: "guardian",
      email: "guardian@finaljudo.kr",
      branchScope: "강남 본관 child scope",
      passwordRotated: true,
      loginVerified: true,
      evidence: "guardian login screenshot",
    },
    {
      role: "member",
      email: "member@finaljudo.kr",
      branchScope: "강남 본관 self",
      passwordRotated: true,
      loginVerified: true,
      evidence: "member login screenshot",
    },
    {
      role: "coach",
      email: "coach.songpa@finaljudo.kr",
      branchScope: "송파 도장",
      passwordRotated: true,
      loginVerified: true,
      evidence: "songpa coach login screenshot",
    },
    {
      role: "guardian",
      email: "guardian.songpa@finaljudo.kr",
      branchScope: "송파 도장 child scope",
      passwordRotated: true,
      loginVerified: true,
      evidence: "songpa guardian login screenshot",
    },
    {
      role: "member",
      email: "member.songpa@finaljudo.kr",
      branchScope: "송파 도장 self",
      passwordRotated: true,
      loginVerified: true,
      evidence: "songpa member login screenshot",
    },
  ],
  dataImport: {
    sourceCsv: "docs/pilot-templates/pilot-data-intake.csv",
    dryRunCommand: "npm run test:pilot-import -- docs/pilot-templates/pilot-data-intake.csv",
    importCommand: "npm run pilot:import:postgres -- docs/pilot-templates/pilot-data-intake.csv",
    preflightCommand: "NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json",
    evidenceReport: validPrePilotReportPath,
    sensitiveDataReviewed: true,
    verified: true,
    evidence: "masked CSV review and production preflight output",
  },
  fieldChecks: {
    mobileAttendance: [
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
    keyboardNavigation: {
      passed: true,
      evidence: "keyboard route pass note",
    },
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
    postPilotEvidenceJson: validReportPath,
    postPilotEvidenceMarkdown: validMarkdownPath,
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

const validPilotReport = {
  generatedAt: "2026-07-15T01:05:00.000Z",
  mode: "post-pilot",
  releaseDecision: "ready",
  preflight: {
    blockerCodes: [],
  },
  counts: {
    operationDays: validEvidence.operations.operationLogCount,
    verifiedOperationDays: validEvidence.operations.operationLogCount,
    attendanceRecordsLogged: validEvidence.operations.attendanceRecords,
    paymentChecksLogged: validEvidence.operations.paymentChecks,
    noticeFollowupChecksLogged: validEvidence.operations.noticeFollowupChecks,
    noticeChecksLogged: validEvidence.operations.noticeChecks,
  },
};

const validPrePilotReport = {
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

const invalidPrePilotReport = {
  ...validPrePilotReport,
  generatedAt: "2026-07-02T00:00:00.000Z",
  mode: "post-pilot",
  releaseDecision: "blocked",
  preflight: {
    blockerCodes: ["PILOT_READINESS_INCOMPLETE"],
  },
};

const mismatchedPrePilotReport = {
  ...validPrePilotReport,
  counts: {
    ...validPrePilotReport.counts,
    users: 7,
  },
};

const invalidPilotReport = {
  ...validPilotReport,
  generatedAt: "2026-07-01T00:00:00.000Z",
  releaseDecision: "blocked",
  preflight: {
    blockerCodes: ["PILOT_OPERATION_NOTICES_MISSING"],
  },
  counts: {
    ...validPilotReport.counts,
    operationDays: 13,
    noticeFollowupChecksLogged: 17,
    noticeChecksLogged: 0,
  },
};

const validMarkdownReport = [
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
  `- Operation days: ${validEvidence.operations.operationLogCount}`,
  `- Verified operation days: ${validEvidence.operations.operationLogCount}`,
  `- Attendance records logged: ${validEvidence.operations.attendanceRecords}`,
  `- Payment checks logged: ${validEvidence.operations.paymentChecks}`,
  `- Notice follow-up checks logged: ${validEvidence.operations.noticeFollowupChecks}`,
  `- Notice checks logged: ${validEvidence.operations.noticeChecks}`,
  "",
].join("\n");

const invalidMarkdownReport = [
  "# Final Judo Pilot Evidence Report",
  "",
  "- Generated: 2026-07-01T00:00:00.000Z",
  "- Mode: pre-pilot",
  "- Decision: blocked",
  "",
  "## Operations",
  "",
  "- Verified operation days: 13",
  "- Notice follow-up checks logged: 17",
  "- Notice checks logged: 0",
  "",
].join("\n");

async function runValidator(args) {
  try {
    const result = await execFile(process.execPath, [...nodeArgs, ...args], {
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

await writeFile(validPath, JSON.stringify(validEvidence, null, 2));
await writeFile(validPrePilotReportPath, JSON.stringify(validPrePilotReport, null, 2));
await writeFile(invalidPrePilotReportPath, JSON.stringify(invalidPrePilotReport, null, 2));
await writeFile(mismatchedPrePilotReportPath, JSON.stringify(mismatchedPrePilotReport, null, 2));
await writeFile(validReportPath, JSON.stringify(validPilotReport, null, 2));
await writeFile(invalidReportPath, JSON.stringify(invalidPilotReport, null, 2));
await writeFile(validMarkdownPath, validMarkdownReport);
await writeFile(invalidMarkdownPath, invalidMarkdownReport);
await writeFile(invalidSourceCsvPath, "type,branch_name\nbranch,강남 본관\n");

const unreadableMarkdownEvidence = structuredClone(validEvidence);
unreadableMarkdownEvidence.operations.postPilotEvidenceMarkdown = join(directory, "missing-pilot-evidence-report.md");
await writeFile(unreadableMarkdownPath, JSON.stringify(unreadableMarkdownEvidence, null, 2));

const earlySignoffEvidence = structuredClone(validEvidence);
earlySignoffEvidence.pilot.signedOffAt = "2026-07-15T00:30:00+09:00";
await writeFile(earlySignoffPath, JSON.stringify(earlySignoffEvidence, null, 2));

const mismatchedSourceScopeEvidence = structuredClone(validEvidence);
mismatchedSourceScopeEvidence.pilot.branches = mismatchedSourceScopeEvidence.pilot.branches.slice(0, 1);
mismatchedSourceScopeEvidence.accounts = mismatchedSourceScopeEvidence.accounts
  .filter((account) => account.email !== "guardian.songpa@finaljudo.kr")
  .map((account) => {
    if (account.email === "member.songpa@finaljudo.kr") {
      return { ...account, role: "coach" };
    }

    if (account.email === "coach@finaljudo.kr") {
      return { ...account, branchScope: "송파 도장" };
    }

    return account;
  });
mismatchedSourceScopeEvidence.accounts.push({
  role: "coach",
  email: "not-in-source@finaljudo.kr",
  branchScope: "송파 도장",
  passwordRotated: true,
  loginVerified: true,
  evidence: "wrong extra account evidence",
});
await writeFile(mismatchedSourceScopePath, JSON.stringify(mismatchedSourceScopeEvidence, null, 2));

const mismatchedPrePilotEvidence = structuredClone(validEvidence);
mismatchedPrePilotEvidence.dataImport.evidenceReport = mismatchedPrePilotReportPath;
await writeFile(mismatchedPrePilotEvidencePath, JSON.stringify(mismatchedPrePilotEvidence, null, 2));

const invalidEvidence = structuredClone(validEvidence);
invalidEvidence.fieldChecks.mobileAttendance = invalidEvidence.fieldChecks.mobileAttendance.filter((check) => check.deviceKind === "ios");
invalidEvidence.fieldChecks.screenReader = [
  {
    tool: "VoiceOver",
    role: "guardian",
    route: "/app/classes",
    target: "attendance-status",
    expectedAnnouncement: "",
    actualAnnouncement: "",
    passed: false,
    issueFree: false,
    notes: "",
    evidence: "incomplete VoiceOver note",
  },
];
invalidEvidence.dataImport.sourceCsv = invalidSourceCsvPath;
invalidEvidence.dataImport.dryRunCommand = "npm run test:pilot-import -- docs/pilot-templates/pilot-data-intake.csv";
invalidEvidence.dataImport.importCommand = "npm run pilot:import:postgres -- docs/pilot-templates/pilot-data-intake.csv";
invalidEvidence.dataImport.preflightCommand = "NODE_ENV=production npm run preflight:pilot";
invalidEvidence.dataImport.verified = false;
invalidEvidence.operations.operationLogCount = 13;
invalidEvidence.operations.noticeFollowupChecks = 0;
invalidEvidence.operations.noticeChecks = 0;
invalidEvidence.operations.unresolvedP0Count = 1;
invalidEvidence.operations.postPilotPreflightCommand = "NODE_ENV=production npm run preflight:pilot -- --require-retro";
invalidEvidence.operations.postPilotEvidenceJson = join(directory, "wrong-pilot-evidence.json");
invalidEvidence.operations.postPilotEvidenceMarkdown = invalidMarkdownPath;
invalidEvidence.dataImport.evidenceReport = invalidPrePilotReportPath;
await writeFile(invalidPath, JSON.stringify(invalidEvidence, null, 2));

const templateRun = await runValidator([`--file=${templatePath}`, "--allow-template"]);
assert.equal(templateRun.code, 0, `template field evidence shape should validate: ${templateRun.stderr}`);

const missingReportRun = await runValidator([`--file=${validPath}`]);
assert.notEqual(missingReportRun.code, 0, "strict field evidence should require a post-pilot pilot:evidence report");
const missingReport = JSON.parse(missingReportRun.stdout);
assert(
  missingReport.blockers.some((blocker) => blocker.code === "PILOT_EVIDENCE_REPORT_NOT_PROVIDED"),
  "missing pilot:evidence report must block field evidence",
);

const validRun = await runValidator([`--file=${validPath}`, `--report=${validReportPath}`]);
assert.equal(validRun.code, 0, `valid field evidence should pass: ${validRun.stderr || validRun.stdout}`);
const validReport = JSON.parse(validRun.stdout);
assert.equal(validReport.ok, true, "valid field evidence should be ok");

const unreadableMarkdownRun = await runValidator([`--file=${unreadableMarkdownPath}`, `--report=${validReportPath}`]);
assert.notEqual(unreadableMarkdownRun.code, 0, "strict field evidence should require a readable post-pilot Markdown report");
const unreadableMarkdownReport = JSON.parse(unreadableMarkdownRun.stdout);
assert(
  unreadableMarkdownReport.blockers.some((blocker) => blocker.code === "POST_PILOT_MARKDOWN_REPORT_UNREADABLE"),
  "missing post-pilot Markdown report must block field evidence",
);

const earlySignoffRun = await runValidator([`--file=${earlySignoffPath}`, `--report=${validReportPath}`]);
assert.notEqual(earlySignoffRun.code, 0, "strict field evidence should require final signoff after post-pilot reports");
const earlySignoffReport = JSON.parse(earlySignoffRun.stdout);
const earlySignoffBlockerCodes = earlySignoffReport.blockers.map((blocker) => blocker.code);
assert(
  earlySignoffBlockerCodes.includes("PILOT_SIGNOFF_BEFORE_JSON_REPORT"),
  "final signoff before post-pilot JSON report must block field evidence",
);
assert(
  earlySignoffBlockerCodes.includes("PILOT_SIGNOFF_BEFORE_MARKDOWN_REPORT"),
  "final signoff before post-pilot Markdown report must block field evidence",
);

const mismatchedSourceScopeRun = await runValidator([`--file=${mismatchedSourceScopePath}`, `--report=${validReportPath}`]);
assert.notEqual(mismatchedSourceScopeRun.code, 0, "strict field evidence should compare source CSV branches/accounts with manifest");
const mismatchedSourceScopeReport = JSON.parse(mismatchedSourceScopeRun.stdout);
const mismatchedSourceScopeCodes = mismatchedSourceScopeReport.blockers.map((blocker) => blocker.code);
assert(
  mismatchedSourceScopeCodes.includes("PILOT_BRANCH_SOURCE_MISMATCH"),
  "pilot branches must match source CSV branch rows",
);
assert(
  mismatchedSourceScopeCodes.includes("ACCOUNT_SOURCE_MISSING"),
  "source CSV accounts missing from manifest must block field evidence",
);
assert(
  mismatchedSourceScopeCodes.includes("ACCOUNT_SOURCE_EXTRA"),
  "manifest accounts outside source CSV must block field evidence",
);
assert(
  mismatchedSourceScopeCodes.includes("ACCOUNT_SOURCE_ROLE_MISMATCH"),
  "manifest account roles must match source CSV user rows",
);
assert(
  mismatchedSourceScopeCodes.includes("ACCOUNT_SOURCE_BRANCH_SCOPE_MISMATCH"),
  "manifest account branchScope must include the source CSV user branch",
);

const mismatchedPrePilotRun = await runValidator([`--file=${mismatchedPrePilotEvidencePath}`, `--report=${validReportPath}`]);
assert.notEqual(mismatchedPrePilotRun.code, 0, "strict field evidence should compare source CSV counts with pre-pilot evidence");
const mismatchedPrePilotResult = JSON.parse(mismatchedPrePilotRun.stdout);
assert(
  mismatchedPrePilotResult.blockers.some((blocker) => blocker.code === "DATA_IMPORT_EVIDENCE_REPORT_COUNT_MISMATCH"),
  "pre-pilot evidence count mismatch must block field evidence",
);

const invalidRun = await runValidator([`--file=${invalidPath}`, `--report=${invalidReportPath}`]);
assert.notEqual(invalidRun.code, 0, "invalid field evidence should fail strict validation");
const invalidReport = JSON.parse(invalidRun.stdout);
const blockerCodes = invalidReport.blockers.map((blocker) => blocker.code);
assert(blockerCodes.includes("MOBILE_DEVICE_COVERAGE_INCOMPLETE"), "missing Android/tablet field checks must block release evidence");
assert(blockerCodes.includes("SCREEN_READER_COVERAGE_INCOMPLETE"), "missing screen reader target coverage must block release evidence");
assert(blockerCodes.includes("SCREEN_READER_EXPECTED_ANNOUNCEMENT_MISSING"), "missing expected screen reader announcement must block release evidence");
assert(blockerCodes.includes("SCREEN_READER_ACTUAL_ANNOUNCEMENT_MISSING"), "missing actual screen reader announcement must block release evidence");
assert(blockerCodes.includes("SCREEN_READER_NOTES_MISSING"), "missing screen reader notes must block release evidence");
assert(blockerCodes.includes("SCREEN_READER_NOT_PASSED"), "failed screen reader check must block release evidence");
assert(blockerCodes.includes("SCREEN_READER_ISSUE_OPEN"), "open screen reader issue must block release evidence");
assert(blockerCodes.includes("DATA_IMPORT_NOT_VERIFIED"), "unverified pilot data import must block release evidence");
assert(blockerCodes.includes("DATA_IMPORT_DRY_RUN_SOURCE_MISMATCH"), "dry-run command must reference the source CSV");
assert(blockerCodes.includes("DATA_IMPORT_COMMAND_SOURCE_MISMATCH"), "import command must reference the source CSV");
assert(blockerCodes.includes("DATA_IMPORT_PREFLIGHT_ARTIFACT_MISSING"), "pre-pilot preflight command must write an artifact");
assert(blockerCodes.includes("DATA_IMPORT_SOURCE_INVALID"), "invalid source CSV must block release evidence");
assert(blockerCodes.includes("DATA_IMPORT_EVIDENCE_REPORT_LATE"), "pre-pilot evidence generated after pilot start must block release evidence");
assert(blockerCodes.includes("DATA_IMPORT_EVIDENCE_REPORT_MODE_INVALID"), "post-pilot report cannot be used as pre-pilot evidence");
assert(blockerCodes.includes("DATA_IMPORT_EVIDENCE_REPORT_NOT_READY"), "blocked pre-pilot evidence report must block release evidence");
assert(blockerCodes.includes("DATA_IMPORT_EVIDENCE_REPORT_HAS_BLOCKERS"), "pre-pilot evidence blockers must block release evidence");
assert(blockerCodes.includes("PILOT_OPERATION_DAYS_INCOMPLETE"), "less than 14 operation days must block release evidence");
assert(blockerCodes.includes("PILOT_OPERATION_NOTICE_FOLLOWUPS_MISSING"), "missing notice follow-up checks must block release evidence");
assert(blockerCodes.includes("PILOT_OPERATION_NOTICES_MISSING"), "missing notice checks must block release evidence");
assert(blockerCodes.includes("P0_INCIDENTS_UNRESOLVED"), "unresolved P0 incidents must block release evidence");
assert(blockerCodes.includes("POST_PILOT_PREFLIGHT_ARTIFACT_MISSING"), "post-pilot preflight command must write an artifact");
assert(blockerCodes.includes("PILOT_EVIDENCE_REPORT_NOT_READY"), "blocked pilot:evidence report must block field evidence");
assert(blockerCodes.includes("PILOT_EVIDENCE_REPORT_HAS_BLOCKERS"), "pilot:evidence preflight blockers must block field evidence");
assert(blockerCodes.includes("PILOT_EVIDENCE_REPORT_COUNT_MISMATCH"), "pilot:evidence count mismatch must block field evidence");
assert(blockerCodes.includes("PILOT_EVIDENCE_REPORT_PATH_MISMATCH"), "manifest report path must match --report argument");
assert(blockerCodes.includes("PILOT_EVIDENCE_REPORT_STALE"), "pilot:evidence report generated before pilot end must block field evidence");
assert(blockerCodes.includes("POST_PILOT_MARKDOWN_REPORT_INVALID"), "stale or blocked Markdown report must block field evidence");
assert(blockerCodes.includes("POST_PILOT_MARKDOWN_REPORT_STALE"), "Markdown report generated before pilot end must block field evidence");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "pilot field evidence template shape validation",
        "strict field evidence requires post-pilot pilot:evidence report",
        "strict field evidence requires readable post-pilot Markdown report",
        "strict field evidence requires final signoff after post-pilot reports",
        "strict field evidence compares source CSV branches/accounts with manifest",
        "strict field evidence compares source CSV counts with pre-pilot evidence",
        "strict field evidence pass fixture",
        "strict field evidence failure fixture",
        "mobile coverage/screen reader quality/source CSV/data import/pre-pilot report/14-day unique operation day/notice follow-up/notice/P0/report/path/freshness/Markdown blockers",
      ],
    },
    null,
    2,
  ),
);
