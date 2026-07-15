import type {
  AppUser,
  AuditAction,
  AuditLog,
  AttendanceStatus,
  DashboardSummary,
  EnrichedClassSession,
  EnrichedPayment,
  Member,
  MockDatabase,
  Notice,
  UserRole,
} from "@/lib/domain";
import { canMemberHaveGuardianLink } from "./member-age-policy.ts";
import { getNoticeReadByUserIds, isNoticeReadByUser } from "./notices.ts";

type ApiContext = {
  db: MockDatabase;
  user: AppUser;
  selectedBranchId: string | null;
};

const latency = 180;
const mockApiDateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Seoul",
  year: "numeric",
});

function sleep() {
  return new Promise((resolve) => window.setTimeout(resolve, latency));
}

async function respond<T>(producer: () => T): Promise<T> {
  if (typeof window === "undefined") {
    return producer();
  }

  await sleep();

  if (window.localStorage.getItem("final-judo-force-error") === "1") {
    throw new Error("정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  return producer();
}

function dateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = Object.fromEntries(mockApiDateKeyFormatter.formatToParts(date).map((part) => [part.type, part.value]));

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getAccessibleBranchIds(user: AppUser, db: MockDatabase) {
  if (user.role === "admin") {
    return db.branches.map((branch) => branch.id);
  }

  return user.branchIds;
}

export function getSelectedBranchIds(context: ApiContext) {
  const accessible = getAccessibleBranchIds(context.user, context.db);

  if (context.selectedBranchId && accessible.includes(context.selectedBranchId)) {
    return [context.selectedBranchId];
  }

  return accessible;
}

export function getAccessibleMemberIds(user: AppUser, db: MockDatabase, branchIds = getAccessibleBranchIds(user, db)) {
  if (user.role === "member") {
    return user.memberIds ?? [];
  }

  if (user.role === "guardian") {
    const childMemberIds = new Set(user.childMemberIds ?? []);

    return db.members
      .filter(
        (member) =>
          childMemberIds.has(member.id) &&
          member.guardianIds.includes(user.id) &&
          canMemberHaveGuardianLink(member),
      )
      .map((member) => member.id);
  }

  if (user.role === "coach") {
    return [
      ...new Set(
        db.classes
          .filter((session) => session.coachId === user.id && branchIds.includes(session.branchId))
          .flatMap((session) => session.enrolledMemberIds),
      ),
    ];
  }

  return db.members.filter((member) => branchIds.includes(member.branchId)).map((member) => member.id);
}

function enrichClass(db: MockDatabase, sessionId: string): EnrichedClassSession | null {
  const session = db.classes.find((item) => item.id === sessionId);
  if (!session) {
    return null;
  }

  const branch = db.branches.find((item) => item.id === session.branchId);
  const coach = db.users.find((item) => item.id === session.coachId);

  if (!branch || !coach) {
    return null;
  }

  return {
    ...session,
    branch,
    coach,
    enrolledMembers: db.members.filter((member) => session.enrolledMemberIds.includes(member.id)),
    attendance: db.attendance.filter((record) => record.sessionId === session.id),
  };
}

function enrichPayment(db: MockDatabase, paymentId: string): EnrichedPayment | null {
  const payment = db.payments.find((item) => item.id === paymentId);
  if (!payment) {
    return null;
  }

  const member = db.members.find((item) => item.id === payment.memberId);
  const branch = db.branches.find((item) => item.id === payment.branchId);

  if (!member || !branch) {
    return null;
  }

  return { ...payment, member, branch };
}

function scopedClasses(context: ApiContext) {
  const branchIds = getSelectedBranchIds(context);
  const memberIds = getAccessibleMemberIds(context.user, context.db, branchIds);

  return context.db.classes
    .filter((session) => branchIds.includes(session.branchId))
    .filter((session) => {
      if (context.user.role === "coach") {
        return session.coachId === context.user.id;
      }

      if (context.user.role === "member" || context.user.role === "guardian") {
        return session.enrolledMemberIds.some((memberId) => memberIds.includes(memberId));
      }

      return true;
    })
    .map((session) => enrichClass(context.db, session.id))
    .filter(Boolean) as EnrichedClassSession[];
}

function scopedMembers(context: ApiContext) {
  const branchIds = getSelectedBranchIds(context);
  const memberIds = getAccessibleMemberIds(context.user, context.db, branchIds);

  return context.db.members
    .filter((member) => branchIds.includes(member.branchId))
    .filter((member) => memberIds.includes(member.id));
}

function scopedPayments(context: ApiContext) {
  const branchIds = getSelectedBranchIds(context);
  const memberIds = getAccessibleMemberIds(context.user, context.db, branchIds);

  return context.db.payments
    .filter((payment) => branchIds.includes(payment.branchId))
    .filter((payment) => memberIds.includes(payment.memberId))
    .map((payment) => enrichPayment(context.db, payment.id))
    .filter(Boolean) as EnrichedPayment[];
}

function redactPaymentAmountsForRole(context: ApiContext, payments: EnrichedPayment[]) {
  if (context.user.role !== "coach") {
    return payments;
  }

  return [];
}

export function getNoticeTargetMemberIds(db: MockDatabase, notice: Notice) {
  const targetMemberIds = new Set(notice.targetMemberIds ?? []);

  for (const classId of notice.targetClassIds ?? []) {
    const session = db.classes.find((item) => item.id === classId);

    session?.enrolledMemberIds.forEach((memberId) => targetMemberIds.add(memberId));
  }

  return targetMemberIds;
}

export function isNoticeRecipient(user: AppUser, db: MockDatabase, notice: Notice) {
  const inBranch = user.role === "admin" || user.branchIds.includes(notice.branchId);
  const inAudience = notice.audience.includes("all") || notice.audience.includes(user.role);

  if (!inBranch || !inAudience) {
    return false;
  }

  const targetMemberIds = getNoticeTargetMemberIds(db, notice);

  if (targetMemberIds.size === 0) {
    return true;
  }

  if (user.role === "coach") {
    const coachedMemberIds = getAccessibleMemberIds(user, db, [notice.branchId]);

    return coachedMemberIds.some((memberId) => targetMemberIds.has(memberId));
  }

  if (user.role === "guardian") {
    const linkedChildMemberIds = getAccessibleMemberIds(user, db, [notice.branchId]);

    return linkedChildMemberIds.some((memberId) => targetMemberIds.has(memberId));
  }

  if (user.role === "member") {
    return (user.memberIds ?? []).some((memberId) => targetMemberIds.has(memberId));
  }

  return true;
}

export function canReadNotice(user: AppUser, db: MockDatabase, notice: Notice, branchIds = getAccessibleBranchIds(user, db)) {
  if (!branchIds.includes(notice.branchId)) {
    return false;
  }

  if (user.role === "admin" || user.role === "owner") {
    return true;
  }

  if (notice.createdByUserId === user.id) {
    return true;
  }

  return isNoticeRecipient(user, db, notice);
}

function scopedNotices(context: ApiContext) {
  const branchIds = getSelectedBranchIds(context);

  return context.db.notices.filter((notice) => canReadNotice(context.user, context.db, notice, branchIds));
}

function createAuditLog({
  db,
  branchId,
  actorUserId,
  action,
  targetType,
  targetId,
  before,
  after,
  result = "success",
  message,
}: {
  db: MockDatabase;
  branchId: string | null;
  actorUserId: string;
  action: AuditAction;
  targetType: AuditLog["targetType"];
  targetId: string;
  before: AuditLog["before"];
  after: AuditLog["after"];
  result?: AuditLog["result"];
  message: string;
}): AuditLog {
  return {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId,
    action,
    targetType,
    targetId,
    before,
    after,
    result,
    message,
    createdAt: new Date().toISOString(),
  };
}

function withAuditLog(db: MockDatabase, auditLog: AuditLog): MockDatabase {
  return {
    ...db,
    auditLogs: [auditLog, ...db.auditLogs],
  };
}

export const mockApi = {
  signIn(role: UserRole, db: MockDatabase) {
    return respond(() => {
      const demoUserId = `user-${role}`;
      const user =
        db.users.find(
          (candidate) =>
            candidate.id === demoUserId &&
            candidate.role === role &&
            candidate.invitationStatus !== "pending",
        ) ??
        db.users.find((candidate) => candidate.role === role && candidate.invitationStatus !== "pending") ??
        db.users.find((candidate) => candidate.role === role);

      if (!user) {
        throw new Error("선택한 역할의 계정을 찾을 수 없습니다.");
      }

      return user;
    });
  },

  getDashboard(context: ApiContext): Promise<DashboardSummary> {
    return respond(() => {
      const classes = scopedClasses(context);
      const today = dateKey(new Date());
      const todaysClasses = classes.filter((session) => dateKey(session.startsAt) === today);
      const members = scopedMembers(context);
      const payments = redactPaymentAmountsForRole(context, scopedPayments(context));
      const expiringPayments = payments.filter((payment) => payment.status === "overdue" || payment.status === "expiringSoon");
      const attendanceCount = todaysClasses.flatMap((session) => session.attendance).length;
      const enrolledCount = todaysClasses.flatMap((session) => session.enrolledMemberIds).length || 1;
      const activeMemberHelper = context.user.role === "coach" ? "담당 회원 명단" : "현재 등록 회원";

      return {
        metrics: [
          {
            label: "오늘 수업",
            value: String(todaysClasses.length),
            tone: "neutral",
            helper: "오늘 배정된 수업",
          },
          {
            label: "활성 회원",
            value: String(members.filter((member) => member.status === "active").length),
            tone: "good",
            helper: activeMemberHelper,
          },
          {
            label: "출석 처리율",
            value: `${Math.round((attendanceCount / enrolledCount) * 100)}%`,
            tone: attendanceCount === enrolledCount ? "good" : "warning",
            helper: "오늘 출석 처리",
          },
        ],
        todaysClasses,
        expiringPayments,
        notices: scopedNotices(context),
      };
    });
  },

  getClasses(context: ApiContext) {
    return respond(() => scopedClasses(context).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
  },

  getMembers(context: ApiContext): Promise<Member[]> {
    return respond(() => scopedMembers(context));
  },

  getPayments(context: ApiContext) {
    return respond(() =>
      redactPaymentAmountsForRole(context, scopedPayments(context)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    );
  },

  getNotices(context: ApiContext): Promise<Notice[]> {
    return respond(() => scopedNotices(context).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },
};

export function upsertAttendance(
  db: MockDatabase,
  sessionId: string,
  memberId: string,
  status: AttendanceStatus,
  actorUserId: string,
  note?: string | null,
): MockDatabase {
  const existing = db.attendance.find((record) => record.sessionId === sessionId && record.memberId === memberId);
  const session = db.classes.find((item) => item.id === sessionId);
  const targetId = existing?.id ?? `att-${sessionId}-${memberId}`;
  const before = existing ? { status: existing.status, confirmedAt: existing.confirmedAt, note: existing.note } : null;
  const cleanNote = note?.trim();
  const persistedNote = cleanNote || existing?.note;
  const after: { status: AttendanceStatus; confirmedAt: string; note?: string } = {
    status,
    confirmedAt: new Date().toISOString(),
  };

  if (persistedNote) {
    after.note = persistedNote;
  }

  if (existing) {
    const nextDb = {
      ...db,
      attendance: db.attendance.map((record) =>
        record.id === existing.id ? { ...record, status, confirmedAt: after.confirmedAt, note: after.note } : record,
      ),
    };

    return withAuditLog(
      nextDb,
      createAuditLog({
        db,
        branchId: session?.branchId ?? null,
        actorUserId,
        action: "attendance.update",
        targetType: "attendance",
        targetId,
        before,
        after,
        message: "출석 상태를 수정했습니다.",
      }),
    );
  }

  const nextDb = {
    ...db,
    attendance: [
      ...db.attendance,
      {
        id: targetId,
        sessionId,
        memberId,
        status,
        confirmedAt: after.confirmedAt,
        note: after.note,
      },
    ],
  };

  return withAuditLog(
    nextDb,
    createAuditLog({
      db,
      branchId: session?.branchId ?? null,
      actorUserId,
      action: "attendance.update",
      targetType: "attendance",
      targetId,
      before,
      after,
      message: "출석 상태를 기록했습니다.",
    }),
  );
}

export function updateAttendanceNote(
  db: MockDatabase,
  sessionId: string,
  memberId: string,
  actorUserId: string,
  note: string,
): MockDatabase {
  const existing = db.attendance.find((record) => record.sessionId === sessionId && record.memberId === memberId);
  const session = db.classes.find((item) => item.id === sessionId);

  if (!existing) {
    return db;
  }

  const cleanNote = note.trim();
  const before = { status: existing.status, confirmedAt: existing.confirmedAt, note: existing.note };
  const after = { status: existing.status, confirmedAt: existing.confirmedAt, note: cleanNote };
  const nextDb = {
    ...db,
    attendance: db.attendance.map((record) => (record.id === existing.id ? { ...record, note: cleanNote } : record)),
  };

  return withAuditLog(
    nextDb,
    createAuditLog({
      db,
      branchId: session?.branchId ?? null,
      actorUserId,
      action: "attendance.update",
      targetType: "attendance",
      targetId: existing.id,
      before,
      after,
      message: "출석 수정 사유를 기록했습니다.",
    }),
  );
}

export function markNoticeRead(db: MockDatabase, noticeId: string, actorUserId: string): MockDatabase {
  const notice = db.notices.find((item) => item.id === noticeId);
  const readByUserIds = notice ? getNoticeReadByUserIds(notice) : [];

  if (!notice || isNoticeReadByUser(notice, actorUserId)) {
    return db;
  }

  const nextDb = {
    ...db,
    notices: db.notices.map((item) =>
      item.id === noticeId ? { ...item, readByUserIds: [...readByUserIds, actorUserId] } : item,
    ),
  };

  return withAuditLog(
    nextDb,
    createAuditLog({
      db,
      branchId: notice.branchId,
      actorUserId,
      action: "notice.read",
      targetType: "notice",
      targetId: noticeId,
      before: { readByUserIds },
      after: { readByUserIds: [...readByUserIds, actorUserId] },
      message: "공지 읽음 상태를 기록했습니다.",
    }),
  );
}
