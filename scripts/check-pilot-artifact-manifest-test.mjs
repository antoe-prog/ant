import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(join(tmpdir(), "final-judo-artifact-manifest-"));
const preflightPrePath = join(directory, "pilot-preflight.pre-pilot.json");
const preflightPostPath = join(directory, "pilot-preflight.post-pilot.json");
const prePilotEvidencePath = join(directory, "pilot-evidence.json");
const prePilotMarkdownPath = join(directory, "pilot-evidence.pre-pilot.md");
const readinessEvidencePath = join(directory, "pilot-readiness-evidence.csv");
const launchPackagePath = join(directory, "pilot-launch-package.json");
const tamperedLaunchPackagePath = join(directory, "pilot-launch-package.tampered.json");
const passwordRotationPath = join(directory, "pilot-password-rotation.csv");
const postPilotEvidencePath = join(directory, "pilot-evidence.post-pilot.json");
const markdownPath = join(directory, "pilot-evidence.md");
const fieldPath = join(directory, "pilot-field-evidence.json");
const closeoutPath = join(directory, "pilot-closeout-package.json");
const tamperedCloseoutPath = join(directory, "pilot-closeout-package.tampered.json");
const manifestOutPath = join(directory, "pilot-artifact-manifest.json");

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
    evidenceReport: prePilotEvidencePath,
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
    postPilotEvidenceJson: postPilotEvidencePath,
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

const prePilotPreflight = {
  generatedAt: "2026-06-30T08:50:00.000Z",
  ok: true,
  mode: "strict",
  runtime: { driver: "postgres" },
  counts: {
    pilotOperationLogs: 0,
  },
  blockers: [],
  warnings: [],
  checked: ["production demo-login/reset flags", "runtime DB readability"],
};

const postPilotPreflight = {
  generatedAt: "2026-07-15T01:04:00.000Z",
  ok: true,
  mode: "strict",
  runtime: { driver: "postgres" },
  counts: {
    pilotOperationLogs: 14,
  },
  blockers: [],
  warnings: [],
  checked: ["14-day pilot operation evidence when --require-retro is set", "mobile attendance timing evidence in pilot operation logs"],
};

const prePilotEvidence = {
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

const postPilotEvidence = {
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

const prePilotMarkdownReport = [
  "# Final Judo Pilot Evidence Report",
  "",
  "- Generated: 2026-06-30T09:00:00.000Z",
  "- Mode: pre-pilot",
  "- Decision: ready",
  "- Runtime: postgres",
  "- Preflight blockers: none",
  "",
  "## Readiness",
  "",
  "- Required readiness: complete",
  "",
  "## Operations",
  "",
  "- Operation days: 0",
  "",
].join("\n");

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csvRow(values) {
  return values.map(csvCell).join(",");
}

function readyReadinessEvidenceCsv() {
  const rows = [
    ["id", "category", "label", "owner", "status", "evidence", "checkedAt", "notes"],
    ["pilot-branches", "scope", "운영 준비 지점 1-2곳과 2주 기간 확정", "총괄 PM", "verified", "branch approval memo and pilot calendar", "2026-06-30T09:00:00.000Z", ""],
    ["pilot-accounts", "scope", "대표/코치/학부모/회원 운영 계정 확정", "총괄 어드민", "verified", "account roster and login verification screenshots", "2026-06-30T09:01:00.000Z", ""],
    ["pilot-password-rotation", "security", "계정별 비밀번호 교체와 전달 채널 확인", "총괄 어드민", "verified", "password rotation CSV and secure channel receipt", "2026-06-30T09:02:00.000Z", ""],
    ["pilot-data", "data", "실제 시간표, 회원권, 결제 상태 입력 후 운영 현황 재확인", "운영 담당자", "verified", "masked import dry-run and production preflight output", "2026-06-30T09:03:00.000Z", ""],
    ["pilot-mobile-attendance", "device", "현장 코치 모바일 기기에서 수업별 출석 30초 처리 계측", "코치 리드", "verified", "ios android tablet attendance timing evidence", "2026-06-30T09:04:00.000Z", ""],
    ["pilot-screenreader", "accessibility", "접근성 현장 확인", "QA", "verified", "VoiceOver TalkBack keyboard smoke notes", "2026-06-30T09:05:00.000Z", ""],
    ["pilot-incident-channel", "incident", "장애 보고 채널과 운영 중단 기준 확정", "총괄 PM", "verified", "incident channel owner confirmation and stop criteria", "2026-06-30T09:06:00.000Z", ""],
  ];

  return `${rows.map(csvRow).join("\n")}\n`;
}

const launchPackage = {
  ok: true,
  generatedAt: "2026-06-30T09:10:00.000Z",
  mode: "strict",
  releaseDecision: "ready",
  artifacts: {
    preflightPre: {
      path: preflightPrePath,
      ok: true,
      mode: "strict",
      blockerCodes: [],
      warningCodes: [],
    },
    evidencePre: {
      path: prePilotEvidencePath,
      mode: "pre-pilot",
      releaseDecision: "ready",
      blockerCodes: [],
      warningCodes: [],
    },
    evidenceMarkdown: {
      path: prePilotMarkdownPath,
      bytes: Buffer.byteLength(prePilotMarkdownReport, "utf8"),
      includesReadiness: true,
      includesOperations: true,
    },
    readinessEvidence: {
      path: readinessEvidencePath,
      ok: true,
      phase: "pre-pilot",
      statusCounts: { verified: 7 },
      blockerCodes: [],
    },
    passwordRotation: {
      path: passwordRotationPath,
      ok: true,
      users: 8,
      statusCounts: { verified: 8 },
      blockerCodes: [],
    },
    launchPackage: {
      path: launchPackagePath,
    },
  },
  blockers: [],
  warnings: [],
};

async function runArtifactManifest(extraArgs = {}) {
  const args = [
    "scripts/check-pilot-artifact-manifest.mjs",
    `--preflight-pre=${extraArgs.preflightPrePath ?? preflightPrePath}`,
    `--preflight-post=${preflightPostPath}`,
    `--evidence-pre=${prePilotEvidencePath}`,
    `--evidence-pre-markdown=${prePilotMarkdownPath}`,
    `--readiness-evidence=${readinessEvidencePath}`,
    `--launch-package=${extraArgs.launchPackagePath ?? launchPackagePath}`,
    `--password-rotation=${passwordRotationPath}`,
    `--evidence-post=${postPilotEvidencePath}`,
    `--evidence-markdown=${markdownPath}`,
    `--field=${fieldPath}`,
    `--closeout=${extraArgs.closeoutPath ?? closeoutPath}`,
    ...(extraArgs.outPath ? [`--out=${extraArgs.outPath}`] : []),
  ];

  try {
    const result = await execFile(process.execPath, args, {
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

await writeFile(fieldPath, `${JSON.stringify(fieldEvidence, null, 2)}\n`, "utf8");
await writeFile(preflightPrePath, `${JSON.stringify(prePilotPreflight, null, 2)}\n`, "utf8");
await writeFile(preflightPostPath, `${JSON.stringify(postPilotPreflight, null, 2)}\n`, "utf8");
await writeFile(prePilotEvidencePath, `${JSON.stringify(prePilotEvidence, null, 2)}\n`, "utf8");
await writeFile(prePilotMarkdownPath, prePilotMarkdownReport, "utf8");
await writeFile(readinessEvidencePath, readyReadinessEvidenceCsv(), "utf8");
await writeFile(launchPackagePath, `${JSON.stringify(launchPackage, null, 2)}\n`, "utf8");
await writeFile(
  passwordRotationPath,
  "userId,email,name,role,branchIds,usesDefaultPassword,hasPasswordHash,lastPasswordAuditAt,rotationStatus,evidence,rotatedAt,notes\nuser-admin,admin@finaljudo.kr,관리자,admin,branch-gangnam|branch-songpa,false,true,2026-06-30T09:05:00.000Z,verified,audit-auth-password-reset-admin,2026-06-30T09:05:00.000Z,channel evidence\n",
  "utf8",
);
await writeFile(postPilotEvidencePath, `${JSON.stringify(postPilotEvidence, null, 2)}\n`, "utf8");
await writeFile(markdownPath, markdownReport, "utf8");

await execFile(
  process.execPath,
  [
    "scripts/check-pilot-closeout-package.mjs",
    `--field=${fieldPath}`,
    `--preflight=${preflightPostPath}`,
    `--report=${postPilotEvidencePath}`,
    `--markdown=${markdownPath}`,
    `--out=${closeoutPath}`,
  ],
  {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  },
);

const validRun = await runArtifactManifest({ outPath: manifestOutPath });
assert.equal(validRun.code, 0, validRun.stderr);
const validManifest = JSON.parse(validRun.stdout);
assert.equal(validManifest.ok, true, "valid artifact manifest must be ready");
assert.equal(validManifest.releaseDecision, "ready", "valid artifact manifest must have ready decision");
assert.equal(Object.keys(validManifest.artifacts).length, 11, "artifact manifest must include every required artifact");
assert.match(validManifest.artifacts.closeoutPackage.sha256, /^[a-f0-9]{64}$/, "artifact manifest must include SHA-256 hashes");
assert.match(validManifest.artifacts.launchPackage.sha256, /^[a-f0-9]{64}$/, "artifact manifest must include launch package SHA-256 hash");
assert.match(validManifest.artifacts.prePilotReadinessEvidence.sha256, /^[a-f0-9]{64}$/, "artifact manifest must include readiness evidence SHA-256 hash");
assert.match(validManifest.artifacts.passwordRotationEvidence.sha256, /^[a-f0-9]{64}$/, "artifact manifest must include password rotation evidence SHA-256 hash");
assert(validManifest.artifacts.closeoutPackage.sizeBytes > 0, "artifact manifest must include byte sizes");

const writtenManifest = JSON.parse(await readFile(manifestOutPath, "utf8"));
assert.deepEqual(writtenManifest, validManifest, "artifact manifest --out must write the same JSON emitted to stdout");

const readyCloseout = JSON.parse(await readFile(closeoutPath, "utf8"));
await writeFile(
  tamperedCloseoutPath,
  `${JSON.stringify({ ...readyCloseout, ok: false, releaseDecision: "blocked", blockers: [{ code: "MANUAL_TAMPER" }] }, null, 2)}\n`,
  "utf8",
);
const tamperedRun = await runArtifactManifest({ closeoutPath: tamperedCloseoutPath });
assert.notEqual(tamperedRun.code, 0, "tampered closeout package must block artifact manifest");
const tamperedManifest = JSON.parse(tamperedRun.stdout);
assert(
  tamperedManifest.blockers.some((blocker) => blocker.code === "CLOSEOUT_PACKAGE_NOT_READY"),
  "artifact manifest must block when closeout package is not ready",
);

await writeFile(
  tamperedLaunchPackagePath,
  `${JSON.stringify({ ...launchPackage, ok: false, releaseDecision: "blocked", blockers: [{ code: "MANUAL_TAMPER" }] }, null, 2)}\n`,
  "utf8",
);
const tamperedLaunchRun = await runArtifactManifest({ launchPackagePath: tamperedLaunchPackagePath });
assert.notEqual(tamperedLaunchRun.code, 0, "tampered launch package must block artifact manifest");
const tamperedLaunchManifest = JSON.parse(tamperedLaunchRun.stdout);
assert(
  tamperedLaunchManifest.blockers.some((blocker) => blocker.code === "LAUNCH_PACKAGE_NOT_READY"),
  "artifact manifest must block when launch package is not ready",
);

const missingRun = await runArtifactManifest({ preflightPrePath: join(directory, "missing-preflight.json") });
assert.notEqual(missingRun.code, 0, "missing release artifact must block artifact manifest");
const missingManifest = JSON.parse(missingRun.stdout);
assert(
  missingManifest.blockers.some((blocker) => blocker.code === "PILOT_ARTIFACT_UNREADABLE"),
  "artifact manifest must block unreadable artifacts",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready pilot artifact manifest with SHA-256 hashes",
        "artifact manifest validates pre-pilot readiness evidence CSV",
        "artifact manifest writes JSON output",
        "tampered closeout package blocks artifact manifest",
        "tampered launch package blocks artifact manifest",
        "missing release artifact blocks artifact manifest",
      ],
    },
    null,
    2,
  ),
);
