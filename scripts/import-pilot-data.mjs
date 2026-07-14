import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultPilotDataFile, parseCsv, validateRows } from "./pilot-data-utils.mjs";

const { createJsonStore } = await import("../src/server/json-store.ts");
const { createPostgresJsonStore } = await import("../src/server/postgres-store.ts");
const { defaultPilotPasswordHash } = await import("../src/server/auth-password.ts");
const { createDefaultPilotReadinessChecks } = await import("../src/lib/pilot-readiness.ts");
const {
  assertNoNewRuntimeStateIntegrityIssues,
  validateRuntimeStateIntegrity,
} = await import("../src/server/runtime-state-integrity.ts");

const defaultBranchSettings = {
  attendanceEditRequiresReason: true,
};

const roleTitles = {
  admin: "총괄 운영 관리자",
  owner: "지점 대표",
  coach: "코치",
  guardian: "학부모",
  member: "회원",
};

const args = process.argv.slice(2);
const writeMode = args.includes("--write");
const explicitDriver = args.find((arg) => arg.startsWith("--driver="))?.slice("--driver=".length);
const explicitOutput = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
const explicitPostgresUrl = args.find((arg) => arg.startsWith("--postgres-url="))?.slice("--postgres-url=".length);
const explicitStateKey = args.find((arg) => arg.startsWith("--state-key="))?.slice("--state-key=".length);
const explicitTable = args.find((arg) => arg.startsWith("--table="))?.slice("--table=".length);
const inputArg = args.find((arg) => !arg.startsWith("--"));
const filePath = path.resolve(inputArg ?? process.env.PILOT_DATA_FILE ?? defaultPilotDataFile);
const driver = explicitDriver ?? (process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");
const outputFile = path.resolve(explicitOutput ?? process.env.PILOT_DB_FILE ?? ".data/final-judo-db.json");
const postgresUrl = explicitPostgresUrl ?? process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL;
const postgresStateKey = explicitStateKey ?? process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp";
const postgresTable = explicitTable ?? process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state";

if (driver !== "json" && driver !== "postgres") {
  throw new Error(`Unsupported pilot import driver: ${driver}`);
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

function stableId(prefix, value) {
  const hash = createHash("sha1").update(value).digest("hex").slice(0, 10);
  return `${prefix}-${hash}`;
}

function groupRecords(records, type) {
  return records.filter(({ row }) => row.type === type).map(({ row }) => row);
}

function relativeIso(dayOffset, hour, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

function validateImportedDb(value) {
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
    "promotions",
    "tournaments",
    "auditLogs",
  ];

  if (!value || typeof value !== "object") {
    throw new Error("Imported pilot DB must be an object.");
  }

  for (const collection of requiredCollections) {
    if (!Array.isArray(value[collection])) {
      throw new Error(`Imported pilot DB collection "${collection}" must be an array.`);
    }
  }

  return validateRuntimeStateIntegrity(value);
}

function validateImportedWrite(next, previous) {
  return assertNoNewRuntimeStateIntegrityIssues(previous, next);
}

function buildPilotDb(records) {
  const branchRows = groupRecords(records, "branch");
  const userRows = groupRecords(records, "user");
  const memberRows = groupRecords(records, "member");
  const classRows = groupRecords(records, "class");
  const noticeRows = groupRecords(records, "notice");

  const branchIdsByName = new Map();
  const branches = branchRows.map((row, index) => {
    const id = index === 0 ? "branch-gangnam" : index === 1 ? "branch-songpa" : stableId("branch", row.branch_name);
    branchIdsByName.set(row.branch_name, id);

    return {
      id,
      name: row.branch_name,
      district: row.branch_name,
      settings: defaultBranchSettings,
      status: "active",
      timezone: "Asia/Seoul",
    };
  });

  const branchIds = branches.map((branch) => branch.id);
  const roleCounts = new Map();
  const usersByNameAndBranch = new Map();
  const users = userRows.map((row) => {
    const roleCount = roleCounts.get(row.role) ?? 0;
    roleCounts.set(row.role, roleCount + 1);

    const branchId = branchIdsByName.get(row.branch_name) ?? branchIds[0];
    const id = roleCount === 0 ? `user-${row.role}` : stableId("user", `${row.email}:${row.role}`);
    const user = {
      id,
      email: row.email,
      name: row.name,
      passwordHash: defaultPilotPasswordHash,
      role: row.role,
      title: roleTitles[row.role] ?? row.role,
      branchIds: row.role === "admin" ? branchIds : [branchId],
    };

    usersByNameAndBranch.set(`${row.branch_name}:${row.name}`, user);
    return user;
  });

  const memberUsersByName = new Map(users.filter((user) => user.role === "member").map((user) => [user.name, user]));
  const members = memberRows.map((row, index) => {
    const branchId = branchIdsByName.get(row.branch_name) ?? branchIds[0];
    const coach = usersByNameAndBranch.get(`${row.branch_name}:${row.coach_name}`);
    const guardian = row.guardian_name
      ? usersByNameAndBranch.get(`${row.branch_name}:${row.guardian_name}`)
      : null;

    if (!coach || !["coach", "owner", "admin"].includes(coach.role)) {
      throw new Error(`Pilot member ${row.member_name} requires an accepted operator in branch ${row.branch_name}.`);
    }
    if (row.guardian_name && (!guardian || guardian.role !== "guardian")) {
      throw new Error(`Pilot member ${row.member_name} guardian must belong to branch ${row.branch_name}.`);
    }
    const id = index === 0 ? "member-jun" : index === 1 ? "member-minjae" : stableId("member", `${row.branch_name}:${row.member_name}`);

    return {
      id,
      branchId,
      name: row.member_name,
      status: "active",
      ageGroup: row.age_group,
      level: row.level,
      belt: row.belt,
      guardianIds: guardian ? [guardian.id] : [],
      primaryCoachId: coach.id,
      emergencyContact: row.phone || "연락처 등록 전",
      alerts: row.notes ? [row.notes] : [],
    };
  });

  for (const user of users) {
    if (user.role === "guardian") {
      const childMemberIds = members.filter((member) => member.guardianIds.includes(user.id)).map((member) => member.id);
      if (childMemberIds.length > 0) {
        user.childMemberIds = childMemberIds;
      }
    }

    if (user.role === "member") {
      const linkedMember = members.find((member) => memberUsersByName.get(member.name)?.id === user.id);
      if (linkedMember) {
        user.memberIds = [linkedMember.id];
      }
    }
  }

  const classes = classRows.map((row, index) => {
    const branchId = branchIdsByName.get(row.branch_name) ?? branchIds[0];
    const coach = usersByNameAndBranch.get(`${row.branch_name}:${row.coach_name}`);

    if (!coach || !["coach", "owner", "admin"].includes(coach.role)) {
      throw new Error(`Pilot class ${row.class_name} requires an accepted operator in branch ${row.branch_name}.`);
    }
    const capacity = Number(row.capacity);
    const enrolledMemberIds = members
      .filter((member) => member.branchId === branchId && member.ageGroup === row.age_group && member.primaryCoachId === coach?.id)
      .slice(0, capacity)
      .map((member) => member.id);

    return {
      id: index === 0 ? "class-kids-am" : stableId("class", `${row.branch_name}:${row.class_name}:${row.starts_at}`),
      branchId,
      name: row.class_name,
      level: row.level,
      ageGroup: row.age_group,
      coachId: coach.id,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      room: "메인 매트",
      capacity,
      enrolledMemberIds,
    };
  });

  const payments = memberRows.map((row, index) => {
    const member = members[index];

    return {
      id: stableId("pay", `${row.branch_name}:${row.member_name}:${row.membership_name}`),
      branchId: member.branchId,
      memberId: member.id,
      planName: row.membership_name,
      status: row.payment_status,
      amount: Number(row.amount_krw),
      discountAmount: 0,
      dueDate: row.expires_on,
      expiresAt: row.expires_on,
    };
  });

  const counselingNotes = members
    .filter((member) => member.alerts.length > 0)
    .flatMap((member, index) => {
      const notes = [
        {
          id: stableId("note", `${member.id}:${member.alerts[0]}`),
          branchId: member.branchId,
          memberId: member.id,
          authorUserId: member.primaryCoachId,
          noteType: "caution",
          visibility: "coach_visible",
          body: member.alerts[0],
          createdAt: relativeIso(-2, 18, 10),
        },
      ];

      if (index === 0) {
        notes.push({
          id: stableId("note", `${member.id}:coach-feedback`),
          branchId: member.branchId,
          memberId: member.id,
          authorUserId: member.primaryCoachId,
          noteType: "progress",
          visibility: "guardian_visible",
          body: "낙법 후 일어서는 속도가 좋아졌고, 다음 수업은 발기술 연결을 연습합니다.",
          createdAt: relativeIso(-1, 18, 10),
        });
      }

      return notes;
    });

  const notices = noticeRows.map((row) => {
    const branchId = branchIdsByName.get(row.branch_name) ?? branchIds[0];
    const body =
      row.notes === "승급 심사 준비 안내"
        ? "승급 심사 결과 안내: 통과 안내 대상입니다. 보완 항목은 코치가 다음 피드백으로 안내합니다. 강남 유소년 교류전 대회 참가 안내도 함께 확인해 주세요. 보호자 확인 후 체급과 출전 가능 시간을 확인해 주세요. 승급 심사 준비 안내: 심사 대상자는 출석률과 기본기 체크 항목을 담당 코치와 확인해 주세요. 회원권 만료 안내: 만료 7일 전부터 결제 상태에서 확인하세요."
        : row.notes;

    return {
      id: stableId("notice", `${row.branch_name}:${row.notes}`),
      branchId,
      title: row.notes,
      body,
      audience: ["all"],
      createdAt: new Date().toISOString(),
      readByUserIds: [],
    };
  });

  const adminUser = users.find((user) => user.role === "admin") ?? users[0];
  const ownerUser = users.find((user) => user.role === "owner") ?? adminUser;
  const primaryNotice = notices[0];
  const auditLogs = [
    {
      id: "audit-pilot-notice-create",
      branchId: primaryNotice?.branchId ?? branchIds[0] ?? null,
      actorUserId: ownerUser?.id ?? "user-owner",
      action: "notice.create",
      targetType: "notice",
      targetId: primaryNotice?.id ?? "notice-pilot",
      before: null,
      after: {
        audience: primaryNotice?.audience ?? ["all"],
        title: primaryNotice?.title ?? "공지",
      },
      result: "success",
      message: "공지사항을 작성했습니다.",
      createdAt: relativeIso(-1, 16, 5),
    },
    {
      id: "audit-pilot-auth-login",
      branchId: null,
      actorUserId: adminUser?.id ?? "user-admin",
      action: "auth.login",
      targetType: "auth",
      targetId: adminUser?.id ?? "user-admin",
      before: null,
      after: { role: adminUser?.role ?? "admin" },
      result: "success",
      message: "로그인했습니다.",
      createdAt: relativeIso(-1, 9, 0),
    },
  ];

  return {
    branches,
    users,
    members,
    classes,
    attendance: [],
    counselingNotes,
    promotions: [],
    tournaments: [],
    payments,
    notices,
    authSessions: [],
    pushSubscriptions: [],
    pushDispatchJobs: [],
    pilotReadinessChecks: createDefaultPilotReadinessChecks(),
    pilotIncidents: [],
    pilotOperationLogs: [],
    auditLogs,
  };
}

async function main() {
  const text = await readFile(filePath, "utf8").catch((error) => {
    throw new Error(`Cannot read pilot data file: ${filePath}. ${error.message}`);
  });
  const parsed = parseCsv(text);
  const { errors, warnings, records } = validateRows(parsed);

  if (errors.length > 0) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          file: filePath,
          errors,
          warnings,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const db = validateImportedDb(buildPilotDb(records));
  const counts = {
    branches: db.branches.length,
    users: db.users.length,
    members: db.members.length,
    classes: db.classes.length,
    payments: db.payments.length,
    notices: db.notices.length,
    counselingNotes: db.counselingNotes.length,
    pilotReadinessChecks: db.pilotReadinessChecks.length,
    pilotIncidents: db.pilotIncidents.length,
    pilotOperationLogs: db.pilotOperationLogs.length,
  };

  if (writeMode && driver === "json") {
    const store = createJsonStore({
      directory: path.dirname(outputFile),
      fileName: path.basename(outputFile),
      createDefault: () => db,
      validate: validateImportedDb,
      validateWrite: validateImportedWrite,
      backupLimit: 20,
    });
    await store.write(db);
  }

  if (writeMode && driver === "postgres") {
    if (!postgresUrl) {
      throw new Error("PostgreSQL pilot import requires --postgres-url, FINAL_JUDO_POSTGRES_URL, or DATABASE_URL.");
    }

    const store = createPostgresJsonStore({
      connectionString: postgresUrl,
      key: postgresStateKey,
      tableName: postgresTable,
      createDefault: () => db,
      validate: validateImportedDb,
      validateWrite: validateImportedWrite,
    });

    try {
      await store.write(db);
    } finally {
      await store.close();
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: writeMode ? "write" : "dry-run",
        driver,
        file: filePath,
        target:
          driver === "postgres"
            ? {
                connectionString: redactConnectionString(postgresUrl),
                stateKey: postgresStateKey,
                table: postgresTable,
              }
            : { outputFile },
        counts,
        warnings,
        checked: [
          "pilot CSV validation",
          "branch/user/member/class/payment/notice transform",
          "guardian child links",
          "member account links",
          "class roster enrollment",
          `${driver === "postgres" ? "PostgreSQL runtime" : "JSON"} store write guarded by --write`,
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
