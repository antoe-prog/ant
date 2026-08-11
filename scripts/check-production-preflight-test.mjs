import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const { createPasswordHash, defaultPilotPassword } = await import("../src/server/auth-password.ts");

const nodeArgs = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/check-production-preflight.mjs",
];

function createVerifiedCheck(id, category, label) {
  return {
    id,
    category,
    label,
    status: "verified",
    owner: "운영 검증",
    evidence: `${label} 증빙`,
    checkedAt: "2026-06-14T00:00:00.000Z",
    checkedByUserId: "user-admin",
  };
}

function createVerifiedOperationLog(dayIndex, overrides = {}) {
  const date = new Date("2026-06-01T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + dayIndex);

  return {
    id: `pilot-operation-${dayIndex + 1}`,
    branchId: "branch-pilot",
    date: date.toISOString().slice(0, 10),
    status: "verified",
    owner: "운영 검증",
    evidence: `파일럿 ${dayIndex + 1}일차 출석/결제 상태 확인`,
    classesChecked: 2,
    attendanceRecords: 8,
    paymentChecks: dayIndex === 0 ? 3 : 1,
    noticeFollowupChecks: dayIndex % 3 === 0 ? 1 : 0,
    noticeChecks: dayIndex % 2 === 0 ? 1 : 0,
    mobileAttendanceDurationSeconds: 22,
    mobileAttendanceEvidence: `파일럿 ${dayIndex + 1}일차 모바일 출석 22초 녹화`,
    checkedAt: "2026-06-14T10:00:00.000Z",
    checkedByUserId: "user-admin",
    ...overrides,
  };
}

function createRuntimeDb() {
  const rotatedPasswordHash = createPasswordHash("RotatedPilot!2026", "preflight-rotated-password");

  return {
    branches: [
      {
        id: "branch-pilot",
        name: "파일럿 본관",
        district: "서울",
        status: "active",
        timezone: "Asia/Seoul",
      },
    ],
    users: [
      { id: "user-admin", email: "admin@finaljudo.kr", name: "총괄", role: "admin", title: "총괄 어드민", branchIds: ["branch-pilot"], passwordHash: rotatedPasswordHash },
      { id: "user-owner", email: "owner@finaljudo.kr", name: "대표", role: "owner", title: "대표", branchIds: ["branch-pilot"], passwordHash: rotatedPasswordHash },
      { id: "user-coach", email: "coach@finaljudo.kr", name: "코치", role: "coach", title: "코치", branchIds: ["branch-pilot"], passwordHash: rotatedPasswordHash },
      { id: "user-guardian", email: "guardian@finaljudo.kr", name: "학부모", role: "guardian", title: "학부모", branchIds: ["branch-pilot"], childMemberIds: ["member-jun"], passwordHash: rotatedPasswordHash },
      { id: "user-member", email: "member@finaljudo.kr", name: "회원", role: "member", title: "회원", branchIds: ["branch-pilot"], memberIds: ["member-min"], passwordHash: rotatedPasswordHash },
    ],
    members: [
      {
        id: "member-jun",
        branchId: "branch-pilot",
        name: "김준",
        status: "active",
        ageGroup: "kids",
        level: "초급",
        belt: "노란띠",
        guardianIds: ["user-guardian"],
        primaryCoachId: "user-coach",
        emergencyContact: "010-3482-6159",
        alerts: [],
      },
      {
        id: "member-min",
        branchId: "branch-pilot",
        name: "박민",
        status: "active",
        ageGroup: "adult",
        level: "중급",
        belt: "초록띠",
        guardianIds: [],
        primaryCoachId: "user-coach",
        emergencyContact: "010-9274-3068",
        alerts: [],
      },
    ],
    classes: [
      {
        id: "class-pilot-kids",
        branchId: "branch-pilot",
        name: "파일럿 유소년반",
        level: "초급",
        ageGroup: "kids",
        coachId: "user-coach",
        startsAt: "2026-06-14T09:00:00.000Z",
        endsAt: "2026-06-14T10:00:00.000Z",
        room: "1관",
        capacity: 20,
        enrolledMemberIds: ["member-jun"],
      },
    ],
    attendance: [
      {
        id: "attendance-pilot-jun",
        sessionId: "class-pilot-kids",
        memberId: "member-jun",
        status: "present",
        confirmedAt: "2026-06-14T09:05:00.000Z",
      },
    ],
    payments: [
      {
        id: "payment-pilot-jun",
        branchId: "branch-pilot",
        memberId: "member-jun",
        planName: "월 12회",
        status: "paid",
        amount: 180000,
        dueDate: "2026-06-01",
        expiresAt: "2026-06-30",
      },
    ],
    notices: [],
    authSessions: [],
    pushSubscriptions: [],
    pushDispatchJobs: [],
    pilotReadinessChecks: [
      createVerifiedCheck("pilot-branches", "scope", "운영 준비 지점 1-2곳과 2주 기간 확정"),
      createVerifiedCheck("pilot-accounts", "scope", "대표/코치/학부모/회원 운영 계정 확정"),
      createVerifiedCheck("pilot-password-rotation", "security", "계정별 비밀번호 교체와 전달 채널 확인"),
      createVerifiedCheck("pilot-data", "data", "실제 시간표, 회원권, 결제 상태 데이터 입력 후 운영 데이터 재확인"),
      createVerifiedCheck("pilot-mobile-attendance", "device", "현장 코치 모바일 기기에서 수업별 출석 30초 처리 계측"),
      createVerifiedCheck("pilot-screenreader", "accessibility", "접근성 현장 확인"),
      createVerifiedCheck("pilot-incident-channel", "incident", "장애 보고 채널과 운영 중단 기준 확정"),
      {
        id: "pilot-retro",
        category: "operation",
        label: "파일럿 종료 후 피드백 기록과 개선 우선순위 확정",
        status: "pending",
        owner: "총괄 PM",
        evidence: "",
      },
    ],
    pilotIncidents: [],
    pilotOperationLogs: [],
    counselingNotes: [],
    auditLogs: [],
  };
}

function parseReport(stdout) {
  const report = JSON.parse(stdout.trim());
  assert.equal(typeof report.ok, "boolean", "preflight report must include ok");
  assert(Array.isArray(report.blockers), "preflight report must include blockers");
  assert(Array.isArray(report.warnings), "preflight report must include warnings");
  return report;
}

async function runPreflight(filePath, extraArgs = [], extraEnv = {}) {
  const args = [...nodeArgs, `--file=${filePath}`, ...extraArgs];
  const env = {
    ...process.env,
    NODE_ENV: "production",
    FINAL_JUDO_ENABLE_DEMO_LOGIN: "0",
    ENABLE_DEMO_LOGIN: "0",
    FINAL_JUDO_ENABLE_DEV_RESET: "0",
    ENABLE_DEV_RESET: "0",
    FINAL_JUDO_PAYMENT_PROVIDER: "external",
    FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "https://payments.finaljudo.kr",
    FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "final-judo-preflight-0123456789-ABCDEF",
    FINAL_JUDO_PUSH_ENABLED: "0",
    FINAL_JUDO_APNS_ENVIRONMENT: "",
    FINAL_JUDO_APNS_KEY_ID: "",
    FINAL_JUDO_APNS_PRIVATE_KEY: "",
    FINAL_JUDO_APNS_TEAM_ID: "",
    FINAL_JUDO_APNS_TOPIC: "",
    FINAL_JUDO_FIREBASE_CLIENT_EMAIL: "",
    FINAL_JUDO_FIREBASE_PRIVATE_KEY: "",
    FINAL_JUDO_FIREBASE_PROJECT_ID: "",
    FINAL_JUDO_VAPID_PUBLIC_KEY: "",
    FINAL_JUDO_VAPID_PRIVATE_KEY: "",
    FINAL_JUDO_VAPID_SUBJECT: "",
    CRON_SECRET: "",
    ...extraEnv,
  };

  try {
    const result = await execFile(process.execPath, args, {
      cwd: process.cwd(),
      env,
      maxBuffer: 1024 * 1024,
    });

    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      code: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

function blockerCodes(report) {
  return new Set(report.blockers.map((blocker) => blocker.code));
}

const directory = await mkdtemp(path.join(tmpdir(), "final-judo-preflight-"));

try {
  const validFile = path.join(directory, "valid-runtime.json");
  const blockedFile = path.join(directory, "blocked-runtime.json");
  const brokenReferencesFile = path.join(directory, "broken-references-runtime.json");
  const sensitiveFile = path.join(directory, "sensitive-runtime.json");
  const invalidOperationFile = path.join(directory, "invalid-operation-runtime.json");
  const postPilotFile = path.join(directory, "post-pilot-runtime.json");
  const incompletePostPilotFile = path.join(directory, "incomplete-post-pilot-runtime.json");
  const validPreflightOutFile = path.join(directory, "valid-preflight-artifact.json");
  const blockedPreflightOutFile = path.join(directory, "blocked-preflight-artifact.json");
  const validDb = createRuntimeDb();
  const blockedDb = structuredClone(validDb);
  const brokenReferencesDb = structuredClone(validDb);
  const sensitiveDb = structuredClone(validDb);
  const invalidOperationDb = structuredClone(validDb);
  const postPilotDb = structuredClone(validDb);
  const incompletePostPilotDb = structuredClone(validDb);

  blockedDb.users[0].passwordHash = createPasswordHash(defaultPilotPassword, "legacy-shared-password-random-salt");
  blockedDb.pilotReadinessChecks[0] = {
    ...blockedDb.pilotReadinessChecks[0],
    status: "pending",
    evidence: "",
  };
  blockedDb.pilotIncidents.push({
    id: "incident-p0-open",
    branchId: "branch-pilot",
    severity: "p0",
    status: "open",
    title: "출석 저장 불가",
    description: "현장 출석 저장이 되지 않는 문제",
    role: "coach",
    screen: "/app/classes",
    workaround: "수기 명단 기록",
    owner: "총괄 PM",
    reportedByUserId: "user-coach",
    createdAt: "2026-06-14T09:10:00.000Z",
    updatedAt: "2026-06-14T09:10:00.000Z",
  });

  brokenReferencesDb.users[1].branchIds = ["branch-missing"];
  brokenReferencesDb.users.find((user) => user.id === "user-coach").invitationStatus = "pending";
  brokenReferencesDb.members.find((member) => member.id === "member-min").primaryCoachId = "";
  brokenReferencesDb.users[3].childMemberIds = ["member-min"];
  brokenReferencesDb.classes[0].enrolledMemberIds = ["member-jun", "member-missing"];
  brokenReferencesDb.notices.push({
    id: "notice-broken-target",
    branchId: "branch-pilot",
    title: "깨진 대상",
    body: "대상 회원 참조 검증",
    audience: ["guardian"],
    createdAt: "2026-06-14T08:30:00.000Z",
    readByUserIds: [],
    targetMemberIds: ["member-missing"],
  });
  brokenReferencesDb.counselingNotes.push({
    id: "note-broken-author",
    branchId: "branch-pilot",
    memberId: "member-jun",
    authorUserId: "user-missing",
    body: "작성자 참조 검증",
    createdAt: "2026-06-14T08:40:00.000Z",
    noteType: "general",
    visibility: "coach_visible",
  });
  sensitiveDb.members[0].alerts = ["주민등록번호 900101-1234567 반입 금지"];
  sensitiveDb.counselingNotes.push({
    id: "note-sensitive-medical",
    branchId: "branch-pilot",
    memberId: "member-jun",
    authorUserId: "user-coach",
    body: "진단명 상세 기록은 MVP에 저장하지 않음",
    createdAt: "2026-06-14T08:50:00.000Z",
    noteType: "caution",
    visibility: "coach_visible",
  });
  invalidOperationDb.pilotOperationLogs.push(
    createVerifiedOperationLog(0, {
      id: "pilot-operation-invalid-date",
      date: "2026-02-31",
    }),
    createVerifiedOperationLog(1, {
      id: "pilot-operation-blocked-without-summary",
      status: "blocked",
      blockerSummary: "",
    }),
    createVerifiedOperationLog(2, {
      id: "pilot-operation-mobile-missing",
      mobileAttendanceDurationSeconds: undefined,
      mobileAttendanceEvidence: "",
    }),
    createVerifiedOperationLog(3, {
      id: "pilot-operation-mobile-too-slow",
      mobileAttendanceDurationSeconds: 35,
    }),
  );
  postPilotDb.pilotReadinessChecks = postPilotDb.pilotReadinessChecks.map((check) =>
    check.id === "pilot-retro"
      ? createVerifiedCheck("pilot-retro", "operation", "파일럿 종료 후 피드백 기록과 개선 우선순위 확정")
      : check,
  );
  postPilotDb.pilotOperationLogs = Array.from({ length: 14 }, (_, index) => createVerifiedOperationLog(index));

  incompletePostPilotDb.pilotReadinessChecks = incompletePostPilotDb.pilotReadinessChecks.map((check) =>
    check.id === "pilot-retro"
      ? createVerifiedCheck("pilot-retro", "operation", "파일럿 종료 후 피드백 기록과 개선 우선순위 확정")
      : check,
  );
  incompletePostPilotDb.pilotOperationLogs = Array.from({ length: 13 }, (_, index) =>
    createVerifiedOperationLog(index, { paymentChecks: 0 }),
  );

  await writeFile(validFile, `${JSON.stringify(validDb, null, 2)}\n`, "utf8");
  await writeFile(blockedFile, `${JSON.stringify(blockedDb, null, 2)}\n`, "utf8");
  await writeFile(brokenReferencesFile, `${JSON.stringify(brokenReferencesDb, null, 2)}\n`, "utf8");
  await writeFile(sensitiveFile, `${JSON.stringify(sensitiveDb, null, 2)}\n`, "utf8");
  await writeFile(invalidOperationFile, `${JSON.stringify(invalidOperationDb, null, 2)}\n`, "utf8");
  await writeFile(postPilotFile, `${JSON.stringify(postPilotDb, null, 2)}\n`, "utf8");
  await writeFile(incompletePostPilotFile, `${JSON.stringify(incompletePostPilotDb, null, 2)}\n`, "utf8");

  const validRun = await runPreflight(validFile);
  assert.equal(validRun.code, 0, validRun.stderr);
  const validReport = parseReport(validRun.stdout);
  assert.equal(validReport.ok, true, "verified runtime fixture must pass strict preflight");
  assert.equal(validReport.blockers.length, 0, "verified runtime fixture must not have blockers");

  const validOutRun = await runPreflight(validFile, [`--out=${validPreflightOutFile}`]);
  assert.equal(validOutRun.code, 0, validOutRun.stderr);
  const validOutReport = parseReport(validOutRun.stdout);
  const writtenValidOutReport = JSON.parse(await readFile(validPreflightOutFile, "utf8"));
  assert.deepEqual(writtenValidOutReport, validOutReport, "preflight --out must write the same ready report emitted to stdout");

  const blockedRun = await runPreflight(blockedFile, [`--out=${blockedPreflightOutFile}`]);
  assert.notEqual(blockedRun.code, 0, "blocked runtime fixture must fail strict preflight");
  const blockedReport = parseReport(blockedRun.stdout);
  const writtenBlockedReport = JSON.parse(await readFile(blockedPreflightOutFile, "utf8"));
  assert.deepEqual(writtenBlockedReport, blockedReport, "preflight --out must write blocked reports before exiting nonzero");
  const blockedCodes = blockerCodes(blockedReport);
  assert.equal(blockedReport.ok, false, "blocked runtime fixture must report ok=false");
  assert(blockedCodes.has("DEFAULT_PASSWORD_ACTIVE"), "preflight must catch default temporary passwords");
  assert(blockedCodes.has("PILOT_READINESS_INCOMPLETE"), "preflight must catch incomplete pilot readiness evidence");
  assert(blockedCodes.has("P0_INCIDENT_OPEN"), "preflight must catch unresolved P0 pilot incidents");

  const auditRun = await runPreflight(blockedFile, ["--allow-incomplete"]);
  assert.equal(auditRun.code, 0, auditRun.stderr);
  const auditReport = parseReport(auditRun.stdout);
  assert.equal(auditReport.ok, false, "audit mode must still report blockers");
  assert(blockerCodes(auditReport).has("DEFAULT_PASSWORD_ACTIVE"), "audit mode must keep blocker details");

  const brokenReferencesRun = await runPreflight(brokenReferencesFile);
  assert.notEqual(brokenReferencesRun.code, 0, "broken references fixture must fail strict preflight");
  const brokenReferenceCodes = blockerCodes(parseReport(brokenReferencesRun.stdout));
  assert(brokenReferenceCodes.has("USER_BRANCH_MISSING"), "preflight must catch missing user branch scopes");
  assert(brokenReferenceCodes.has("GUARDIAN_LINK_NOT_RECIPROCAL"), "preflight must catch one-way guardian links");
  assert(brokenReferenceCodes.has("CLASS_MEMBER_MISSING"), "preflight must catch missing class members");
  assert(brokenReferenceCodes.has("MEMBER_COACH_INVITATION_PENDING"), "preflight must reject pending member assignees");
  assert(brokenReferenceCodes.has("MEMBER_COACH_REQUIRED"), "preflight must reject empty member assignees");
  assert(brokenReferenceCodes.has("CLASS_COACH_INVITATION_PENDING"), "preflight must reject pending class assignees");
  assert(brokenReferenceCodes.has("NOTICE_MEMBER_MISSING"), "preflight must catch missing notice member targets");
  assert(brokenReferenceCodes.has("COUNSELING_NOTE_AUTHOR_MISSING"), "preflight must catch missing counseling note authors");

  const sensitiveRun = await runPreflight(sensitiveFile);
  assert.notEqual(sensitiveRun.code, 0, "sensitive runtime fixture must fail strict preflight");
  const sensitiveReport = parseReport(sensitiveRun.stdout);
  const sensitiveCodes = blockerCodes(sensitiveReport);
  assert(sensitiveCodes.has("SENSITIVE_DATA_DETECTED"), "preflight must catch sensitive runtime data patterns");
  const sensitiveBlocker = sensitiveReport.blockers.find((blocker) => blocker.code === "SENSITIVE_DATA_DETECTED");
  assert(sensitiveBlocker?.detail?.findings?.some((finding) => finding.label === "resident registration number"));
  assert(sensitiveBlocker?.detail?.findings?.some((finding) => finding.label === "highly sensitive medical detail"));

  const invalidOperationRun = await runPreflight(invalidOperationFile);
  assert.notEqual(invalidOperationRun.code, 0, "invalid pilot operation fixture must fail strict preflight");
  const invalidOperationCodes = blockerCodes(parseReport(invalidOperationRun.stdout));
  assert(invalidOperationCodes.has("PILOT_OPERATION_DATE_INVALID"), "preflight must catch impossible operation dates");
  assert(
    invalidOperationCodes.has("PILOT_OPERATION_BLOCKER_SUMMARY_MISSING"),
    "preflight must require blocked operation summary",
  );
  assert(
    invalidOperationCodes.has("PILOT_OPERATION_MOBILE_ATTENDANCE_EVIDENCE_MISSING"),
    "preflight must require mobile attendance timing evidence for verified attendance operation logs",
  );
  assert(
    invalidOperationCodes.has("PILOT_OPERATION_MOBILE_ATTENDANCE_DURATION_INVALID"),
    "preflight must block mobile attendance timing evidence over 30 seconds",
  );

  const postPilotRun = await runPreflight(postPilotFile, ["--require-retro"]);
  assert.equal(postPilotRun.code, 0, postPilotRun.stderr);
  const postPilotReport = parseReport(postPilotRun.stdout);
  assert.equal(postPilotReport.ok, true, "post-pilot fixture must pass --require-retro preflight");
  assert.equal(postPilotReport.counts.pilotOperationLogs, 14, "post-pilot report must count operation logs");

  const incompletePostPilotRun = await runPreflight(incompletePostPilotFile, ["--require-retro"]);
  assert.notEqual(incompletePostPilotRun.code, 0, "incomplete post-pilot fixture must fail --require-retro preflight");
  const incompletePostPilotCodes = blockerCodes(parseReport(incompletePostPilotRun.stdout));
  assert(
    incompletePostPilotCodes.has("PILOT_OPERATION_DAYS_INCOMPLETE"),
    "post-pilot preflight must require 14 verified operation days",
  );
  assert(
    incompletePostPilotCodes.has("PILOT_OPERATION_PAYMENT_MISSING"),
    "post-pilot preflight must require payment state checks",
  );

  const demoFlagRun = await runPreflight(validFile, [], { FINAL_JUDO_ENABLE_DEMO_LOGIN: "1" });
  assert.notEqual(demoFlagRun.code, 0, "production demo login override must fail strict preflight");
  assert(blockerCodes(parseReport(demoFlagRun.stdout)).has("DEMO_LOGIN_ENABLED"), "preflight must catch enabled production demo login");

  const resetFlagRun = await runPreflight(validFile, [], { FINAL_JUDO_ENABLE_DEV_RESET: "1" });
  assert.notEqual(resetFlagRun.code, 0, "production reset override must fail strict preflight");
  assert(blockerCodes(parseReport(resetFlagRun.stdout)).has("DEV_RESET_ENABLED"), "preflight must catch enabled production reset API");

  const missingPaymentProviderRun = await runPreflight(validFile, [], { FINAL_JUDO_PAYMENT_PROVIDER: "" });
  assert.notEqual(missingPaymentProviderRun.code, 0, "production missing payment provider must fail strict preflight");
  assert(
    blockerCodes(parseReport(missingPaymentProviderRun.stdout)).has("PAYMENT_PROVIDER_NOT_CONFIGURED"),
    "preflight must catch missing production payment provider",
  );

  const invalidPaymentProviderRun = await runPreflight(validFile, [], {
    FINAL_JUDO_PAYMENT_PROVIDER: "externla",
  });
  assert.notEqual(invalidPaymentProviderRun.code, 0, "production invalid payment provider must fail strict preflight");
  assert(
    blockerCodes(parseReport(invalidPaymentProviderRun.stdout)).has("PAYMENT_PROVIDER_INVALID"),
    "preflight must catch unsupported production payment provider values",
  );

  const missingPaymentCheckoutRun = await runPreflight(validFile, [], { FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "" });
  assert.notEqual(missingPaymentCheckoutRun.code, 0, "production missing payment checkout base URL must fail strict preflight");
  assert(
    blockerCodes(parseReport(missingPaymentCheckoutRun.stdout)).has("PAYMENT_CHECKOUT_BASE_URL_MISSING"),
    "preflight must catch missing production payment checkout base URL",
  );

  const invalidPaymentCheckoutRun = await runPreflight(validFile, [], {
    FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL: "http://user:secret@payments.finaljudo.kr/path?token=unsafe",
  });
  assert.notEqual(invalidPaymentCheckoutRun.code, 0, "production invalid payment checkout base URL must fail strict preflight");
  assert(
    blockerCodes(parseReport(invalidPaymentCheckoutRun.stdout)).has("PAYMENT_CHECKOUT_BASE_URL_INVALID"),
    "preflight must catch insecure or non-origin production payment checkout base URLs",
  );

  const missingPaymentWebhookRun = await runPreflight(validFile, [], { FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: "" });
  assert.notEqual(missingPaymentWebhookRun.code, 0, "production missing payment webhook secret must fail strict preflight");
  assert(
    blockerCodes(parseReport(missingPaymentWebhookRun.stdout)).has("PAYMENT_WEBHOOK_SECRET_MISSING"),
    "preflight must catch missing production payment webhook secret",
  );

  for (const weakWebhookSecret of ["secret", "replace-with-provider-webhook-secret"]) {
    const weakPaymentWebhookRun = await runPreflight(validFile, [], {
      FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: weakWebhookSecret,
    });
    assert.notEqual(weakPaymentWebhookRun.code, 0, "production weak payment webhook secrets must fail strict preflight");
    assert(
      blockerCodes(parseReport(weakPaymentWebhookRun.stdout)).has("PAYMENT_WEBHOOK_SECRET_WEAK"),
      "preflight must catch short and placeholder production payment webhook secrets",
    );
  }

  const missingPushSecretsRun = await runPreflight(validFile, [], { FINAL_JUDO_PUSH_ENABLED: "1" });
  assert.notEqual(missingPushSecretsRun.code, 0, "enabled production push without a provider or cron secret must fail");
  const missingPushCodes = blockerCodes(parseReport(missingPushSecretsRun.stdout));
  assert(missingPushCodes.has("PUSH_PROVIDER_MISSING"));
  assert(missingPushCodes.has("PUSH_CRON_SECRET_MISSING"));

  const configuredPushRun = await runPreflight(validFile, [], {
    FINAL_JUDO_PUSH_ENABLED: "1",
    FINAL_JUDO_VAPID_PUBLIC_KEY: "BPublicKeyFixture1234567890",
    FINAL_JUDO_VAPID_PRIVATE_KEY: "PrivateKeyFixture1234567890",
    FINAL_JUDO_VAPID_SUBJECT: "mailto:push-ops@finaljudo.kr",
    CRON_SECRET: "cron-secret-fixture-1234567890",
  });
  assert.equal(configuredPushRun.code, 0, configuredPushRun.stderr);

  const configuredNativePushRun = await runPreflight(validFile, [], {
    FINAL_JUDO_PUSH_ENABLED: "1",
    FINAL_JUDO_APNS_ENVIRONMENT: "production",
    FINAL_JUDO_APNS_KEY_ID: "FF3G2D5GMS",
    FINAL_JUDO_APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nNativeApnsFixture1234567890\\n-----END PRIVATE KEY-----",
    FINAL_JUDO_APNS_TEAM_ID: "CA7A5SP5G5",
    FINAL_JUDO_APNS_TOPIC: "kr.co.finaljudo.multigym",
    FINAL_JUDO_FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@final-judo.iam.gserviceaccount.com",
    FINAL_JUDO_FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nNativeFcmFixture1234567890\\n-----END PRIVATE KEY-----",
    FINAL_JUDO_FIREBASE_PROJECT_ID: "final-judo",
    CRON_SECRET: "cron-secret-fixture-1234567890",
  });
  assert.equal(
    configuredNativePushRun.code,
    0,
    `native APNs/FCM configuration must not require unused Web Push VAPID settings: ${configuredNativePushRun.stdout}`,
  );

  const runtimePushDb = structuredClone(validDb);
  runtimePushDb.pushSubscriptions.push({
    id: "push-runtime-fixture",
    userId: "user-guardian",
    branchIds: ["branch-pilot"],
    endpoint: "https://push.example/runtime-fixture",
    keys: { auth: "fixture-auth", p256dh: "fixture-p256dh" },
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  });
  const runtimePushFile = path.join(directory, "runtime-push.json");
  await writeFile(runtimePushFile, `${JSON.stringify(runtimePushDb, null, 2)}\n`, "utf8");
  const runtimePushMissingConfigRun = await runPreflight(runtimePushFile);
  assert.notEqual(runtimePushMissingConfigRun.code, 0, "active runtime subscriptions must require push secrets");
  const runtimePushMissingCodes = blockerCodes(parseReport(runtimePushMissingConfigRun.stdout));
  assert(runtimePushMissingCodes.has("PUSH_VAPID_PUBLIC_KEY_MISSING"));
  assert(runtimePushMissingCodes.has("PUSH_VAPID_PRIVATE_KEY_MISSING"));
  assert(runtimePushMissingCodes.has("PUSH_VAPID_SUBJECT_INVALID"));
  assert(runtimePushMissingCodes.has("PUSH_CRON_SECRET_MISSING"));

  const cliSecret = "postgresql://preflight_user:raw-secret-must-not-leak@localhost:5432/final_judo";
  const cliSecretRun = await runPreflight(validFile, [`--postgres-url=${cliSecret}`]);
  assert.notEqual(cliSecretRun.code, 0, "strict production preflight must reject --postgres-url");
  const cliSecretReport = parseReport(cliSecretRun.stdout);
  assert(blockerCodes(cliSecretReport).has("POSTGRES_URL_CLI_ARGUMENT"));
  assert(!cliSecretRun.stdout.includes("raw-secret-must-not-leak"), "preflight output must not echo a CLI secret");

  const cliSecretAuditRun = await runPreflight(validFile, ["--allow-incomplete", `--postgres-url=${cliSecret}`]);
  assert.equal(cliSecretAuditRun.code, 0, cliSecretAuditRun.stderr);
  const cliSecretAuditReport = parseReport(cliSecretAuditRun.stdout);
  assert(cliSecretAuditReport.warnings.some((warning) => warning.code === "POSTGRES_URL_CLI_ARGUMENT"));
  assert(!cliSecretAuditRun.stdout.includes("raw-secret-must-not-leak"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "strict preflight passes verified runtime fixture",
          "strict preflight writes ready artifact with --out",
          "strict preflight blocks default temporary password",
          "strict preflight blocks incomplete pilot readiness evidence",
          "strict preflight blocks unresolved P0 incidents",
          "strict preflight writes blocked artifact with --out",
          "audit mode exits successfully while preserving blockers",
          "strict preflight blocks broken user/member/class/notice/note references",
          "strict preflight blocks sensitive runtime data patterns",
          "strict preflight blocks invalid pilot operation logs",
          "strict preflight blocks missing or slow mobile attendance timing evidence",
          "post-pilot preflight requires 14-day operation evidence",
          "production demo-login flag blocks preflight",
          "production dev-reset flag blocks preflight",
          "production payment provider settings block preflight when missing",
          "production push use requires at least one complete provider and cron secret",
          "native APNs/FCM production push does not require unused Web Push VAPID settings",
          "runtime push state activates strict push preflight",
          "strict preflight rejects CLI Postgres secrets without echoing them",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
