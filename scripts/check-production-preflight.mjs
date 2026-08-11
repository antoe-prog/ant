import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { canUseDemoRoleLogin } = await import("../src/server/auth-policy.ts");
const { canResetDevData } = await import("../src/server/dev-reset-policy.ts");
const { defaultPilotPassword, verifyPassword } = await import("../src/server/auth-password.ts");
const { getOnlinePaymentRuntimeReadiness } = await import("../src/server/online-payments.ts");
const { prePilotReadinessIds } = await import("../src/lib/pilot-readiness.ts");
const { sensitivePatterns } = await import("./pilot-data-utils.mjs");

const requiredCollections = [
  "branches",
  "users",
  "members",
  "classes",
  "attendance",
  "payments",
  "notices",
  "authSessions",
  "pushSubscriptions",
  "pushDispatchJobs",
  "pilotReadinessChecks",
  "pilotIncidents",
  "pilotOperationLogs",
  "counselingNotes",
  "auditLogs",
];
const requiredRoles = ["admin", "owner", "coach", "guardian", "member"];
const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const requireRetro = args.includes("--require-retro");
const explicitDriver = args.find((arg) => arg.startsWith("--driver="))?.slice("--driver=".length);
const explicitFile = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length);
const explicitPostgresUrlArgument = args.find((arg) => arg.startsWith("--postgres-url="));
const explicitPostgresUrl = explicitPostgresUrlArgument?.slice("--postgres-url=".length);
const explicitStateKey = args.find((arg) => arg.startsWith("--state-key="))?.slice("--state-key=".length);
const explicitTable = args.find((arg) => arg.startsWith("--table="))?.slice("--table=".length);
const explicitOutFile = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);

const driver = explicitDriver ?? (process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");
const jsonFile = path.resolve(explicitFile ?? process.env.PILOT_DB_FILE ?? ".data/final-judo-db.json");
const rejectCliPostgresSecret = Boolean(
  explicitPostgresUrlArgument && process.env.NODE_ENV === "production" && !allowIncomplete,
);
const postgresUrl = (rejectCliPostgresSecret ? undefined : explicitPostgresUrl)
  ?? process.env.FINAL_JUDO_POSTGRES_URL
  ?? process.env.DATABASE_URL;
const postgresStateKey = explicitStateKey ?? process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp";
const postgresTable = explicitTable ?? process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state";

if (driver !== "json" && driver !== "postgres") {
  throw new Error(`Unsupported preflight driver: ${driver}`);
}

function isSafeIdentifier(value) {
  return /^[a-z_][a-z0-9_]*$/.test(value);
}

function redactConnectionString(connectionString) {
  if (!connectionString) {
    return null;
  }

  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "********";
    }
    return url.toString();
  } catch {
    return "configured";
  }
}

function addIssue(list, code, message, detail = null) {
  list.push({ code, message, ...(detail ? { detail } : {}) });
}

function hasNonPlaceholderValue(value, minimumLength = 1) {
  const normalized = value?.trim() ?? "";

  if (normalized.length < minimumLength) {
    return false;
  }

  return !/(change[-_ ]?me|replace[-_ ]?me|placeholder|example|todo)/i.test(normalized);
}

function pushFeatureIsUsed(db) {
  const explicitlyEnabled = ["1", "true", "yes", "on"].includes(
    process.env.FINAL_JUDO_PUSH_ENABLED?.trim().toLowerCase() ?? "",
  );
  const hasPushEnvironment = [
    process.env.FINAL_JUDO_APNS_KEY_ID,
    process.env.FINAL_JUDO_APNS_PRIVATE_KEY,
    process.env.FINAL_JUDO_APNS_TEAM_ID,
    process.env.FINAL_JUDO_FIREBASE_CLIENT_EMAIL,
    process.env.FINAL_JUDO_FIREBASE_PRIVATE_KEY,
    process.env.FINAL_JUDO_FIREBASE_PROJECT_ID,
    process.env.FINAL_JUDO_VAPID_PUBLIC_KEY,
    process.env.FINAL_JUDO_VAPID_PRIVATE_KEY,
    process.env.FINAL_JUDO_VAPID_SUBJECT,
    process.env.CRON_SECRET,
  ].some((value) => Boolean(value?.trim()));
  const hasRuntimePushState = Boolean(
    db?.pushSubscriptions?.some((subscription) => !subscription.disabledAt)
      || db?.pushDispatchJobs?.some((job) => !["sent", "disabled", "dead", "cancelled"].includes(job.status)),
  );

  return explicitlyEnabled || hasPushEnvironment || hasRuntimePushState;
}

function hasAnyConfiguredValue(names) {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

function validatePushConfiguration(db, blockers) {
  if (process.env.NODE_ENV !== "production" || !pushFeatureIsUsed(db)) {
    return;
  }

  const activeTransports = new Set(
    (db.pushSubscriptions ?? [])
      .filter((subscription) => !subscription.disabledAt)
      .map((subscription) => subscription.transport ?? "web"),
  );
  const webVariables = [
    "FINAL_JUDO_VAPID_PUBLIC_KEY",
    "FINAL_JUDO_VAPID_PRIVATE_KEY",
    "FINAL_JUDO_VAPID_SUBJECT",
  ];
  const apnsVariables = [
    "FINAL_JUDO_APNS_TEAM_ID",
    "FINAL_JUDO_APNS_KEY_ID",
    "FINAL_JUDO_APNS_PRIVATE_KEY",
  ];
  const fcmVariables = [
    "FINAL_JUDO_FIREBASE_PROJECT_ID",
    "FINAL_JUDO_FIREBASE_CLIENT_EMAIL",
    "FINAL_JUDO_FIREBASE_PRIVATE_KEY",
  ];
  const validateWeb = activeTransports.has("web") || hasAnyConfiguredValue(webVariables);
  const validateApns = activeTransports.has("apns") || hasAnyConfiguredValue(apnsVariables);
  const validateFcm = activeTransports.has("fcm") || hasAnyConfiguredValue(fcmVariables);
  const webConfigured = webVariables.every((name) => hasNonPlaceholderValue(process.env[name], name === "FINAL_JUDO_VAPID_SUBJECT" ? 1 : 16));
  const apnsConfigured = apnsVariables.every((name) => hasNonPlaceholderValue(process.env[name], 8));
  const fcmConfigured = fcmVariables.every((name) => hasNonPlaceholderValue(process.env[name], 8));

  if (!webConfigured && !apnsConfigured && !fcmConfigured) {
    addIssue(
      blockers,
      "PUSH_PROVIDER_MISSING",
      "푸시 기능은 Web Push, APNs, FCM 중 하나 이상의 완전한 운영 설정이 필요합니다.",
    );
  }

  if (validateWeb) {
    if (!hasNonPlaceholderValue(process.env.FINAL_JUDO_VAPID_PUBLIC_KEY, 16)) {
      addIssue(blockers, "PUSH_VAPID_PUBLIC_KEY_MISSING", "Web Push 사용 중 VAPID 공개키가 없거나 placeholder입니다.");
    }
    if (!hasNonPlaceholderValue(process.env.FINAL_JUDO_VAPID_PRIVATE_KEY, 16)) {
      addIssue(blockers, "PUSH_VAPID_PRIVATE_KEY_MISSING", "Web Push 사용 중 VAPID 비공개키가 없거나 placeholder입니다.");
    }

    const subject = process.env.FINAL_JUDO_VAPID_SUBJECT?.trim() ?? "";
    if (!hasNonPlaceholderValue(subject) || !/^mailto:[^@\s]+@[^@\s]+$/i.test(subject)) {
      addIssue(blockers, "PUSH_VAPID_SUBJECT_INVALID", "Web Push 사용 중 VAPID subject가 유효한 mailto 주소가 아닙니다.");
    }
  }

  if (validateApns) {
    if (!hasNonPlaceholderValue(process.env.FINAL_JUDO_APNS_TEAM_ID, 8)) {
      addIssue(blockers, "PUSH_APNS_TEAM_ID_MISSING", "iPhone 앱 푸시용 APNs Team ID가 없거나 placeholder입니다.");
    }
    if (!hasNonPlaceholderValue(process.env.FINAL_JUDO_APNS_KEY_ID, 8)) {
      addIssue(blockers, "PUSH_APNS_KEY_ID_MISSING", "iPhone 앱 푸시용 APNs Key ID가 없거나 placeholder입니다.");
    }
    if (!hasNonPlaceholderValue(process.env.FINAL_JUDO_APNS_PRIVATE_KEY, 16)) {
      addIssue(blockers, "PUSH_APNS_PRIVATE_KEY_MISSING", "iPhone 앱 푸시용 APNs 비공개키가 없거나 placeholder입니다.");
    }
    const apnsEnvironment = process.env.FINAL_JUDO_APNS_ENVIRONMENT?.trim() || "production";
    if (apnsEnvironment !== "production") {
      addIssue(blockers, "PUSH_APNS_ENVIRONMENT_INVALID", "운영 사전 점검의 APNs 환경은 production이어야 합니다.");
    }
  }

  if (validateFcm) {
    if (!hasNonPlaceholderValue(process.env.FINAL_JUDO_FIREBASE_PROJECT_ID, 8)) {
      addIssue(blockers, "PUSH_FCM_PROJECT_ID_MISSING", "Android 앱 푸시용 Firebase Project ID가 없거나 placeholder입니다.");
    }
    const clientEmail = process.env.FINAL_JUDO_FIREBASE_CLIENT_EMAIL?.trim() ?? "";
    if (!hasNonPlaceholderValue(clientEmail, 8) || !/^[^@\s]+@[^@\s]+$/.test(clientEmail)) {
      addIssue(blockers, "PUSH_FCM_CLIENT_EMAIL_INVALID", "Android 앱 푸시용 Firebase Client Email이 유효하지 않습니다.");
    }
    if (!hasNonPlaceholderValue(process.env.FINAL_JUDO_FIREBASE_PRIVATE_KEY, 16)) {
      addIssue(blockers, "PUSH_FCM_PRIVATE_KEY_MISSING", "Android 앱 푸시용 Firebase 비공개키가 없거나 placeholder입니다.");
    }
  }

  if (!hasNonPlaceholderValue(process.env.CRON_SECRET, 16)) {
    addIssue(blockers, "PUSH_CRON_SECRET_MISSING", "푸시 재시도 worker용 CRON_SECRET이 없거나 너무 짧거나 placeholder입니다.");
  }
}

function ids(values) {
  return new Set(values.map((value) => value.id).filter(Boolean));
}

function scanSensitiveData(value, currentPath = "runtime", findings = []) {
  if (findings.length >= 25) {
    return findings;
  }

  if (typeof value === "string") {
    for (const sensitive of sensitivePatterns) {
      if (sensitive.pattern.test(value)) {
        findings.push({
          path: currentPath,
          label: sensitive.label,
        });
        break;
      }
    }
    return findings;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scanSensitiveData(item, `${currentPath}[${index}]`, findings);
    });
    return findings;
  }

  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      scanSensitiveData(nestedValue, `${currentPath}.${key}`, findings);
    }
  }

  return findings;
}

function validateReferences(db, blockers) {
  const branchIds = ids(db.branches);
  const userIds = ids(db.users);
  const usersById = new Map(db.users.map((user) => [user.id, user]));
  const membersById = new Map(db.members.map((member) => [member.id, member]));
  const classesById = new Map(db.classes.map((session) => [session.id, session]));

  for (const user of db.users) {
    const userBranchIds = user.branchIds ?? [];

    if (user.role !== "admin" && userBranchIds.length === 0) {
      addIssue(blockers, "USER_BRANCH_SCOPE_EMPTY", `사용자 ${user.id}의 지점 범위가 비어 있습니다.`, { role: user.role });
    }

    for (const branchId of userBranchIds) {
      if (!branchIds.has(branchId)) {
        addIssue(blockers, "USER_BRANCH_MISSING", `사용자 ${user.id}의 지점 범위가 존재하지 않습니다.`, { branchId });
      }
    }

    for (const childMemberId of user.childMemberIds ?? []) {
      const childMember = membersById.get(childMemberId);
      if (!childMember) {
        addIssue(blockers, "USER_CHILD_MEMBER_MISSING", `학부모 ${user.id}의 연결 자녀가 존재하지 않습니다.`, { memberId: childMemberId });
        continue;
      }
      if (user.role !== "guardian") {
        addIssue(blockers, "USER_CHILD_SCOPE_ROLE_MISMATCH", `학부모가 아닌 사용자 ${user.id}에 자녀 범위가 있습니다.`, {
          role: user.role,
          memberId: childMemberId,
        });
      }
      if (!childMember.guardianIds.includes(user.id)) {
        addIssue(blockers, "GUARDIAN_LINK_NOT_RECIPROCAL", `학부모 ${user.id}와 자녀 ${childMemberId} 연결이 상호 반영되지 않았습니다.`);
      }
      if (!userBranchIds.includes(childMember.branchId)) {
        addIssue(blockers, "GUARDIAN_CHILD_BRANCH_MISMATCH", `학부모 ${user.id}의 지점 범위에 자녀 ${childMemberId}의 지점이 없습니다.`, {
          branchId: childMember.branchId,
        });
      }
    }

    for (const memberId of user.memberIds ?? []) {
      const member = membersById.get(memberId);
      if (!member) {
        addIssue(blockers, "USER_MEMBER_SCOPE_MISSING", `회원 사용자 ${user.id}의 본인 회원 프로필이 존재하지 않습니다.`, { memberId });
        continue;
      }
      if (user.role !== "member") {
        addIssue(blockers, "USER_MEMBER_SCOPE_ROLE_MISMATCH", `회원이 아닌 사용자 ${user.id}에 본인 회원 범위가 있습니다.`, {
          role: user.role,
          memberId,
        });
      }
      if (!userBranchIds.includes(member.branchId)) {
        addIssue(blockers, "USER_MEMBER_BRANCH_MISMATCH", `회원 사용자 ${user.id}의 지점 범위에 회원 ${memberId}의 지점이 없습니다.`, {
          branchId: member.branchId,
        });
      }
    }
  }

  for (const member of db.members) {
    if (!branchIds.has(member.branchId)) {
      addIssue(blockers, "MEMBER_BRANCH_MISSING", `회원 ${member.id}의 지점이 존재하지 않습니다.`, { branchId: member.branchId });
    }
    const coach = usersById.get(member.primaryCoachId);
    if (!member.primaryCoachId) {
      addIssue(blockers, "MEMBER_COACH_REQUIRED", `회원 ${member.id}의 담당 운영자가 지정되지 않았습니다.`);
    } else if (!coach) {
      addIssue(blockers, "MEMBER_COACH_MISSING", `회원 ${member.id}의 담당 코치 계정이 존재하지 않습니다.`, {
        coachId: member.primaryCoachId,
      });
    }
    if (coach && !["coach", "owner", "admin"].includes(coach.role)) {
      addIssue(blockers, "MEMBER_COACH_ROLE_INVALID", `회원 ${member.id}의 담당자가 코치/대표/어드민 역할이 아닙니다.`, {
        coachId: coach.id,
        role: coach.role,
      });
    }
    if (coach?.invitationStatus === "pending") {
      addIssue(blockers, "MEMBER_COACH_INVITATION_PENDING", `회원 ${member.id}의 담당자 초대가 승인되지 않았습니다.`, {
        coachId: coach.id,
      });
    }
    if (coach && !coach.branchIds.includes(member.branchId)) {
      addIssue(blockers, "MEMBER_COACH_BRANCH_MISMATCH", `회원 ${member.id}의 담당 코치가 회원 지점 범위에 없습니다.`, {
        coachId: coach.id,
        branchId: member.branchId,
      });
    }
    if (["kids", "teen"].includes(member.ageGroup) && (member.guardianIds ?? []).length === 0) {
      addIssue(blockers, "MINOR_GUARDIAN_MISSING", `미성년 회원 ${member.id}에 보호자 연결이 없습니다.`, { ageGroup: member.ageGroup });
    }
    for (const guardianId of member.guardianIds ?? []) {
      const guardian = usersById.get(guardianId);
      if (!guardian) {
        addIssue(blockers, "MEMBER_GUARDIAN_MISSING", `회원 ${member.id}의 보호자 계정이 존재하지 않습니다.`, { guardianId });
        continue;
      }
      if (guardian.role !== "guardian") {
        addIssue(blockers, "MEMBER_GUARDIAN_ROLE_INVALID", `회원 ${member.id}의 보호자 계정이 학부모 역할이 아닙니다.`, {
          guardianId,
          role: guardian.role,
        });
      }
      if (!(guardian.childMemberIds ?? []).includes(member.id)) {
        addIssue(blockers, "MEMBER_GUARDIAN_NOT_RECIPROCAL", `회원 ${member.id}와 보호자 ${guardianId} 연결이 상호 반영되지 않았습니다.`);
      }
      if (!guardian.branchIds.includes(member.branchId)) {
        addIssue(blockers, "MEMBER_GUARDIAN_BRANCH_MISMATCH", `회원 ${member.id}의 보호자가 회원 지점 범위에 없습니다.`, {
          guardianId,
          branchId: member.branchId,
        });
      }
    }
  }

  for (const session of db.classes) {
    if (!branchIds.has(session.branchId)) {
      addIssue(blockers, "CLASS_BRANCH_MISSING", `수업 ${session.id}의 지점이 존재하지 않습니다.`, { branchId: session.branchId });
    }
    const coach = usersById.get(session.coachId);
    if (!coach) {
      addIssue(blockers, "CLASS_COACH_MISSING", `수업 ${session.id}의 담당 코치 계정이 존재하지 않습니다.`, { coachId: session.coachId });
    }
    if (coach && !["coach", "owner", "admin"].includes(coach.role)) {
      addIssue(blockers, "CLASS_COACH_ROLE_INVALID", `수업 ${session.id}의 담당자가 코치/대표/어드민 역할이 아닙니다.`, {
        coachId: coach.id,
        role: coach.role,
      });
    }
    if (coach?.invitationStatus === "pending") {
      addIssue(blockers, "CLASS_COACH_INVITATION_PENDING", `수업 ${session.id}의 담당자 초대가 승인되지 않았습니다.`, {
        coachId: coach.id,
      });
    }
    if (coach && !coach.branchIds.includes(session.branchId)) {
      addIssue(blockers, "CLASS_COACH_BRANCH_MISMATCH", `수업 ${session.id}의 담당 코치가 수업 지점 범위에 없습니다.`, {
        coachId: coach.id,
        branchId: session.branchId,
      });
    }
    for (const memberId of session.enrolledMemberIds ?? []) {
      const member = membersById.get(memberId);
      if (!member) {
        addIssue(blockers, "CLASS_MEMBER_MISSING", `수업 ${session.id}의 수강 회원이 존재하지 않습니다.`, { memberId });
        continue;
      }
      if (member.branchId !== session.branchId) {
        addIssue(blockers, "CLASS_MEMBER_BRANCH_MISMATCH", `수업 ${session.id}의 수강 회원 ${memberId}가 다른 지점 소속입니다.`, {
          classBranchId: session.branchId,
          memberBranchId: member.branchId,
        });
      }
    }
  }

  for (const attendance of db.attendance) {
    const session = classesById.get(attendance.sessionId);
    const member = membersById.get(attendance.memberId);
    if (!session) {
      addIssue(blockers, "ATTENDANCE_CLASS_MISSING", `출석 ${attendance.id}의 수업이 존재하지 않습니다.`, {
        sessionId: attendance.sessionId,
      });
    }
    if (!member) {
      addIssue(blockers, "ATTENDANCE_MEMBER_MISSING", `출석 ${attendance.id}의 회원이 존재하지 않습니다.`, {
        memberId: attendance.memberId,
      });
    }
    if (session && member && member.branchId !== session.branchId) {
      addIssue(blockers, "ATTENDANCE_BRANCH_MISMATCH", `출석 ${attendance.id}의 수업과 회원 지점이 다릅니다.`, {
        sessionBranchId: session.branchId,
        memberBranchId: member.branchId,
      });
    }
  }

  for (const payment of db.payments) {
    if (!branchIds.has(payment.branchId)) {
      addIssue(blockers, "PAYMENT_BRANCH_MISSING", `결제 ${payment.id}의 지점이 존재하지 않습니다.`, { branchId: payment.branchId });
    }
    const member = membersById.get(payment.memberId);
    if (!member) {
      addIssue(blockers, "PAYMENT_MEMBER_MISSING", `결제 ${payment.id}의 회원이 존재하지 않습니다.`, { memberId: payment.memberId });
    } else if (member.branchId !== payment.branchId) {
      addIssue(blockers, "PAYMENT_MEMBER_BRANCH_MISMATCH", `결제 ${payment.id}의 지점과 회원 지점이 다릅니다.`, {
        paymentBranchId: payment.branchId,
        memberBranchId: member.branchId,
      });
    }
  }

  for (const notice of db.notices) {
    if (!branchIds.has(notice.branchId)) {
      addIssue(blockers, "NOTICE_BRANCH_MISSING", `공지 ${notice.id}의 지점이 존재하지 않습니다.`, { branchId: notice.branchId });
    }
    for (const classId of notice.targetClassIds ?? []) {
      const session = classesById.get(classId);
      if (!session) {
        addIssue(blockers, "NOTICE_CLASS_MISSING", `공지 ${notice.id}의 대상 수업이 존재하지 않습니다.`, { classId });
      } else if (session.branchId !== notice.branchId) {
        addIssue(blockers, "NOTICE_CLASS_BRANCH_MISMATCH", `공지 ${notice.id}의 대상 수업이 공지 지점과 다릅니다.`, {
          classId,
          noticeBranchId: notice.branchId,
          classBranchId: session.branchId,
        });
      }
    }
    for (const memberId of notice.targetMemberIds ?? []) {
      const member = membersById.get(memberId);
      if (!member) {
        addIssue(blockers, "NOTICE_MEMBER_MISSING", `공지 ${notice.id}의 대상 회원이 존재하지 않습니다.`, { memberId });
      } else if (member.branchId !== notice.branchId) {
        addIssue(blockers, "NOTICE_MEMBER_BRANCH_MISMATCH", `공지 ${notice.id}의 대상 회원이 공지 지점과 다릅니다.`, {
          memberId,
          noticeBranchId: notice.branchId,
          memberBranchId: member.branchId,
        });
      }
    }
    for (const readByUserId of notice.readByUserIds ?? []) {
      if (!userIds.has(readByUserId)) {
        addIssue(blockers, "NOTICE_READ_USER_MISSING", `공지 ${notice.id}의 읽음 사용자 계정이 존재하지 않습니다.`, { readByUserId });
      }
    }
  }

  for (const note of db.counselingNotes) {
    if (!branchIds.has(note.branchId)) {
      addIssue(blockers, "COUNSELING_NOTE_BRANCH_MISSING", `상담 메모 ${note.id}의 지점이 존재하지 않습니다.`, { branchId: note.branchId });
    }
    const member = membersById.get(note.memberId);
    if (!member) {
      addIssue(blockers, "COUNSELING_NOTE_MEMBER_MISSING", `상담 메모 ${note.id}의 회원이 존재하지 않습니다.`, { memberId: note.memberId });
    } else if (member.branchId !== note.branchId) {
      addIssue(blockers, "COUNSELING_NOTE_MEMBER_BRANCH_MISMATCH", `상담 메모 ${note.id}의 지점과 회원 지점이 다릅니다.`, {
        noteBranchId: note.branchId,
        memberBranchId: member.branchId,
      });
    }
    if (!userIds.has(note.authorUserId)) {
      addIssue(blockers, "COUNSELING_NOTE_AUTHOR_MISSING", `상담 메모 ${note.id}의 작성자 계정이 존재하지 않습니다.`, {
        authorUserId: note.authorUserId,
      });
    }
  }

  for (const log of db.pilotOperationLogs ?? []) {
    if (log.branchId && !branchIds.has(log.branchId)) {
      addIssue(blockers, "PILOT_OPERATION_BRANCH_MISSING", `파일럿 운영 로그 ${log.id}의 지점이 존재하지 않습니다.`, {
        branchId: log.branchId,
      });
    }
    if (log.checkedByUserId && !userIds.has(log.checkedByUserId)) {
      addIssue(blockers, "PILOT_OPERATION_CHECKER_MISSING", `파일럿 운영 로그 ${log.id}의 확인자 계정이 존재하지 않습니다.`, {
        checkedByUserId: log.checkedByUserId,
      });
    }
  }
}

function isDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validatePilotOperationLogs(db, blockers, warnings) {
  const logs = db.pilotOperationLogs ?? [];
  const requiredCountFields = ["classesChecked", "attendanceRecords", "paymentChecks", "noticeFollowupChecks", "noticeChecks"];

  for (const log of logs) {
    if (!isDateOnly(log.date)) {
      addIssue(blockers, "PILOT_OPERATION_DATE_INVALID", `파일럿 운영 로그 ${log.id}의 일자가 올바르지 않습니다.`, {
        date: log.date ?? null,
      });
    }
    if (!["pending", "verified", "blocked"].includes(log.status)) {
      addIssue(blockers, "PILOT_OPERATION_STATUS_INVALID", `파일럿 운영 로그 ${log.id}의 상태가 올바르지 않습니다.`, {
        status: log.status ?? null,
      });
    }
    if (!log.owner?.trim()) {
      addIssue(blockers, "PILOT_OPERATION_OWNER_MISSING", `파일럿 운영 로그 ${log.id}에 담당자가 없습니다.`);
    }
    for (const field of requiredCountFields) {
      if (!isNonNegativeInteger(log[field])) {
        addIssue(blockers, "PILOT_OPERATION_COUNT_INVALID", `파일럿 운영 로그 ${log.id}의 운영 수치가 올바르지 않습니다.`, {
          field,
          value: log[field] ?? null,
        });
      }
    }
    if (log.status !== "pending" && !log.evidence?.trim()) {
      addIssue(blockers, "PILOT_OPERATION_EVIDENCE_MISSING", `파일럿 운영 로그 ${log.id}에 증빙 메모가 없습니다.`);
    }
    if (log.status === "blocked" && !log.blockerSummary?.trim()) {
      addIssue(blockers, "PILOT_OPERATION_BLOCKER_SUMMARY_MISSING", `파일럿 운영 로그 ${log.id}에 차단/특이사항 기록이 없습니다.`);
    }
    const hasMobileAttendanceMetric = log.mobileAttendanceDurationSeconds !== undefined || Boolean(log.mobileAttendanceEvidence?.trim());
    if (hasMobileAttendanceMetric) {
      if (!isPositiveNumber(log.mobileAttendanceDurationSeconds) || log.mobileAttendanceDurationSeconds > 30) {
        addIssue(blockers, "PILOT_OPERATION_MOBILE_ATTENDANCE_DURATION_INVALID", `파일럿 운영 로그 ${log.id}의 모바일 출석 처리 시간이 올바르지 않습니다.`, {
          durationSeconds: log.mobileAttendanceDurationSeconds ?? null,
        });
      }
      if (!log.mobileAttendanceEvidence?.trim()) {
        addIssue(blockers, "PILOT_OPERATION_MOBILE_ATTENDANCE_EVIDENCE_MISSING", `파일럿 운영 로그 ${log.id}에 모바일 출석 계측 증빙이 없습니다.`);
      }
    }
    if (log.status === "verified" && Number(log.attendanceRecords) > 0) {
      if (!isPositiveNumber(log.mobileAttendanceDurationSeconds) || log.mobileAttendanceDurationSeconds > 30 || !log.mobileAttendanceEvidence?.trim()) {
        addIssue(blockers, "PILOT_OPERATION_MOBILE_ATTENDANCE_EVIDENCE_MISSING", `출석 기록이 있는 운영 로그 ${log.id}에 30초 이하 모바일 출석 계측 증빙이 없습니다.`, {
          durationSeconds: log.mobileAttendanceDurationSeconds ?? null,
          hasEvidence: Boolean(log.mobileAttendanceEvidence?.trim()),
        });
      }
    }
  }

  if (!requireRetro) {
    const blockedLogs = logs.filter((log) => log.status === "blocked");
    if (blockedLogs.length > 0) {
      addIssue(warnings, "PILOT_OPERATION_BLOCKED", "차단 상태의 파일럿 운영 로그가 있습니다.", {
        logs: blockedLogs.map((log) => ({ id: log.id, date: log.date, branchId: log.branchId ?? null })),
      });
    }
    return;
  }

  const verifiedLogs = logs.filter((log) => log.status === "verified");
  const verifiedDates = new Set(verifiedLogs.map((log) => log.date));
  const attendanceRecords = verifiedLogs.reduce((sum, log) => sum + (Number.isInteger(log.attendanceRecords) ? log.attendanceRecords : 0), 0);
  const paymentChecks = verifiedLogs.reduce((sum, log) => sum + (Number.isInteger(log.paymentChecks) ? log.paymentChecks : 0), 0);

  if (verifiedDates.size < 14) {
    addIssue(blockers, "PILOT_OPERATION_DAYS_INCOMPLETE", "파일럿 2주 운영 로그가 14개 운영일을 채우지 못했습니다.", {
      verifiedDays: verifiedDates.size,
      requiredDays: 14,
    });
  }

  if (attendanceRecords <= 0) {
    addIssue(blockers, "PILOT_OPERATION_ATTENDANCE_MISSING", "파일럿 운영 로그에 실제 출석 기록 수치가 없습니다.");
  }

  if (paymentChecks <= 0) {
    addIssue(blockers, "PILOT_OPERATION_PAYMENT_MISSING", "파일럿 운영 로그에 결제 상태 확인 수치가 없습니다.");
  }

  const blockedLogs = logs.filter((log) => log.status === "blocked");
  if (blockedLogs.length > 0) {
    addIssue(blockers, "PILOT_OPERATION_BLOCKED", "차단 상태의 파일럿 운영 로그가 남아 있습니다.", {
      logs: blockedLogs.map((log) => ({ id: log.id, date: log.date, branchId: log.branchId ?? null })),
    });
  }
}

async function readJsonRuntime() {
  const raw = await readFile(jsonFile, "utf8");
  return {
    db: JSON.parse(raw),
    status: {
      driver: "json",
      file: jsonFile,
    },
  };
}

async function readPostgresRuntime() {
  if (!postgresUrl) {
    throw new Error("FINAL_JUDO_DB_DRIVER=postgres requires FINAL_JUDO_POSTGRES_URL or DATABASE_URL.");
  }
  if (!isSafeIdentifier(postgresTable)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${postgresTable}`);
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: postgresUrl, max: 1 });

  try {
    const result = await pool.query(
      `SELECT data, revision, updated_at FROM ${postgresTable} WHERE key = $1`,
      [postgresStateKey],
    );

    if (!result.rowCount || !result.rows[0]) {
      throw new Error(`Runtime state row not found: ${postgresTable}.${postgresStateKey}`);
    }

    return {
      db: result.rows[0].data,
      status: {
        driver: "postgres",
        table: postgresTable,
        key: postgresStateKey,
        revision: Number(result.rows[0].revision),
        updatedAt: result.rows[0].updated_at?.toISOString?.() ?? null,
        connectionString: redactConnectionString(postgresUrl),
      },
    };
  } finally {
    await pool.end();
  }
}

async function readRuntime() {
  return driver === "postgres" ? readPostgresRuntime() : readJsonRuntime();
}

async function main() {
  const blockers = [];
  const warnings = [];
  let runtime = null;

  if (explicitPostgresUrlArgument) {
    const target = process.env.NODE_ENV === "production" && !allowIncomplete ? blockers : warnings;
    addIssue(
      target,
      "POSTGRES_URL_CLI_ARGUMENT",
      process.env.NODE_ENV === "production" && !allowIncomplete
        ? "strict production preflight에서는 --postgres-url 사용을 거부합니다. secret store 환경 변수를 사용하세요."
        : "--postgres-url은 프로세스 목록과 셸 기록에 노출될 수 있습니다. FINAL_JUDO_POSTGRES_URL 환경 변수를 사용하세요.",
    );
  }

  if (process.env.NODE_ENV !== "production") {
    addIssue(warnings, "NODE_ENV_NOT_PRODUCTION", "파일럿/운영 preflight는 NODE_ENV=production에서 실행하는 것을 권장합니다.", {
      nodeEnv: process.env.NODE_ENV ?? null,
    });
  }

  if (process.env.NODE_ENV === "production" && canUseDemoRoleLogin(process.env)) {
    addIssue(blockers, "DEMO_LOGIN_ENABLED", "production에서 데모 역할 로그인이 열려 있습니다.");
  }

  if (process.env.NODE_ENV === "production" && canResetDevData(process.env)) {
    addIssue(blockers, "DEV_RESET_ENABLED", "production에서 개발/테스트 reset API가 열려 있습니다.");
  }

  if (process.env.NODE_ENV === "production" && driver === "json") {
    addIssue(warnings, "JSON_RUNTIME_IN_PRODUCTION", "production에서 JSON 파일 저장소를 사용 중입니다. 파일럿 운영 DB 정책과 백업 위치를 확인하세요.");
  }

  if (process.env.NODE_ENV === "production") {
    const paymentRuntime = getOnlinePaymentRuntimeReadiness(process.env);

    for (const blocker of paymentRuntime.blockers) {
      addIssue(blockers, blocker, "production 온라인 결제 설정이 확인되지 않았습니다.", {
        required: "FINAL_JUDO_PAYMENT_PROVIDER, FINAL_JUDO_PAYMENT_CHECKOUT_BASE_URL, FINAL_JUDO_PAYMENT_WEBHOOK_SECRET",
      });
    }
  }

  try {
    runtime = await readRuntime();
  } catch (error) {
    addIssue(blockers, "RUNTIME_READ_FAILED", "런타임 DB를 읽을 수 없습니다.", {
      driver,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (runtime) {
    const db = runtime.db;

    for (const collection of requiredCollections) {
      if (!Array.isArray(db?.[collection])) {
        addIssue(blockers, "COLLECTION_MISSING", `런타임 DB collection "${collection}"이 배열이 아닙니다.`);
      }
    }

    const hasRequiredShape = requiredCollections.every((collection) => Array.isArray(db?.[collection]));

    if (hasRequiredShape) {
      validatePushConfiguration(db, blockers);
      const activeBranches = db.branches.filter((branch) => (branch.status ?? "active") === "active");
      if (activeBranches.length < 1) {
        addIssue(blockers, "NO_ACTIVE_BRANCH", "활성 파일럿 지점이 없습니다.");
      }

      for (const role of requiredRoles) {
        if (!db.users.some((user) => user.role === role && user.invitationStatus !== "pending")) {
          addIssue(blockers, "ROLE_ACCOUNT_MISSING", `파일럿 ${role} 계정이 없습니다.`);
        }
      }

      const defaultPasswordUsers = db.users.filter((user) => verifyPassword(defaultPilotPassword, user.passwordHash));
      if (defaultPasswordUsers.length > 0) {
        addIssue(blockers, "DEFAULT_PASSWORD_ACTIVE", "기본 임시 비밀번호가 남아 있는 계정이 있습니다.", {
          users: defaultPasswordUsers.map((user) => ({ id: user.id, email: user.email ?? null, role: user.role })),
        });
      }

      const missingPasswordUsers = db.users.filter((user) => user.email && !user.passwordHash);
      if (missingPasswordUsers.length > 0) {
        addIssue(blockers, "PASSWORD_HASH_MISSING", "이메일 로그인 계정에 passwordHash가 없습니다.", {
          users: missingPasswordUsers.map((user) => ({ id: user.id, email: user.email, role: user.role })),
        });
      }

      const testEmailUsers = db.users.filter((user) => typeof user.email === "string" && user.email.endsWith(".test"));
      if (testEmailUsers.length > 0) {
        const target = process.env.NODE_ENV === "production" ? blockers : warnings;
        addIssue(target, "TEST_EMAIL_ACCOUNTS", "테스트 도메인 계정이 남아 있습니다.", {
          users: testEmailUsers.map((user) => ({ id: user.id, email: user.email, role: user.role })),
        });
      }

      const readinessIds = requireRetro ? [...prePilotReadinessIds, "pilot-retro"] : prePilotReadinessIds;
      for (const checkId of readinessIds) {
        const check = db.pilotReadinessChecks.find((item) => item.id === checkId);
        if (!check) {
          addIssue(blockers, "PILOT_READINESS_MISSING", `파일럿 준비 항목 ${checkId}이 없습니다.`);
          continue;
        }
        if (check.status !== "verified" || !check.evidence?.trim() || !check.owner?.trim()) {
          addIssue(blockers, "PILOT_READINESS_INCOMPLETE", `파일럿 준비 항목이 완료되지 않았습니다: ${check.label}`, {
            id: check.id,
            status: check.status,
            owner: check.owner,
            hasEvidence: Boolean(check.evidence?.trim()),
          });
        }
      }

      const unresolvedP0 = db.pilotIncidents.filter((incident) => incident.severity === "p0" && incident.status !== "resolved");
      if (unresolvedP0.length > 0) {
        addIssue(blockers, "P0_INCIDENT_OPEN", "해결되지 않은 P0 파일럿 이슈가 있습니다.", {
          incidents: unresolvedP0.map((incident) => ({ id: incident.id, title: incident.title, status: incident.status })),
        });
      }

      const unresolvedLowerIncidents = db.pilotIncidents.filter((incident) => incident.severity !== "p0" && incident.status !== "resolved");
      if (unresolvedLowerIncidents.length > 0) {
        addIssue(warnings, "NON_P0_INCIDENT_OPEN", "해결되지 않은 P1/P2 파일럿 이슈가 있습니다.", {
          incidents: unresolvedLowerIncidents.map((incident) => ({
            id: incident.id,
            severity: incident.severity,
            title: incident.title,
            status: incident.status,
          })),
        });
      }

      validateReferences(db, blockers);
      validatePilotOperationLogs(db, blockers, warnings);
      const sensitiveFindings = scanSensitiveData(db);
      if (sensitiveFindings.length > 0) {
        addIssue(blockers, "SENSITIVE_DATA_DETECTED", "런타임 DB에 반입 금지 민감정보 패턴이 있습니다.", {
          findings: sensitiveFindings,
          truncated: sensitiveFindings.length >= 25,
        });
      }
    }
  }

  const ok = blockers.length === 0;
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    mode: allowIncomplete ? "audit" : "strict",
    runtime: runtime?.status ?? { driver },
    counts: runtime
      ? {
          branches: runtime.db?.branches?.length ?? 0,
          users: runtime.db?.users?.length ?? 0,
          members: runtime.db?.members?.length ?? 0,
          classes: runtime.db?.classes?.length ?? 0,
          attendance: runtime.db?.attendance?.length ?? 0,
          payments: runtime.db?.payments?.length ?? 0,
          notices: runtime.db?.notices?.length ?? 0,
          pilotReadinessChecks: runtime.db?.pilotReadinessChecks?.length ?? 0,
          pilotIncidents: runtime.db?.pilotIncidents?.length ?? 0,
          pilotOperationLogs: runtime.db?.pilotOperationLogs?.length ?? 0,
        }
      : null,
    blockers,
    warnings,
    checked: [
      "production demo-login/reset flags",
      "production push provider/cron configuration when push is enabled or runtime push state exists",
      "Postgres secret environment transport (no strict production --postgres-url)",
      "runtime DB readability",
      "required runtime collections",
      "five pilot roles",
      "default temporary password rotation",
      "pilot readiness evidence",
      "open P0 pilot incidents",
      "branch/member/class/payment references",
      "user branch and self/guardian scope references",
      "notice and counseling note references",
      "pilot operation log references",
      "mobile attendance timing evidence in pilot operation logs",
      "14-day pilot operation evidence when --require-retro is set",
      "runtime sensitive data guardrails",
    ],
  };

  const serializedReport = JSON.stringify(report, null, 2);

  if (explicitOutFile) {
    await writeFile(path.resolve(explicitOutFile), `${serializedReport}\n`, "utf8");
  }

  console.log(serializedReport);

  if (!ok && !allowIncomplete) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
