import {
  boolean,
  date,
  int,
  longtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * role: admin/manager = 관리자, member = 회원
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  /** 이메일+비밀번호 자체 가입용 해시. OAuth 계정은 null. */
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["member", "manager", "admin"]).default("member").notNull(),
  accountType: mysqlEnum("accountType", ["student", "parent"]).default("student").notNull(),
  avatarUrl: text("avatarUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type AccountType = User["accountType"];

// ─── Members (회원 프로필) ────────────────────────────────────────────────────
export const members = mysqlTable("members", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  name: varchar("name", { length: 128 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  birthDate: date("birthDate", { mode: "string" }),
  gender: mysqlEnum("gender", ["male", "female", "other"]),
  beltRank: mysqlEnum("beltRank", [
    "white", "yellow", "orange", "green", "blue", "brown", "black"
  ]).default("white").notNull(),
  beltDegree: int("beltDegree").default(1).notNull(),
  status: mysqlEnum("status", ["active", "suspended", "withdrawn"]).default("active").notNull(),
  joinDate: date("joinDate", { mode: "string" }).notNull(),
  monthlyFee: int("monthlyFee").default(0).notNull(),
  nextPaymentDate: date("nextPaymentDate", { mode: "string" }),
  emergencyContact: varchar("emergencyContact", { length: 128 }),
  notes: text("notes"),
  notesUpdatedAt: timestamp("notesUpdatedAt"),
  avatarUrl: text("avatarUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Member = typeof members.$inferSelect;
export type InsertMember = typeof members.$inferInsert;

// ─── Attendance (출석) ────────────────────────────────────────────────────────
export const attendance = mysqlTable("attendance", {
  id: int("id").autoincrement().primaryKey(),
  memberId: int("memberId").notNull(),
  attendanceDate: date("attendanceDate", { mode: "string" }).notNull(),
  checkInTime: timestamp("checkInTime"),
  type: mysqlEnum("type", ["regular", "makeup", "trial"]).default("regular").notNull(),
  /** 정시 출석 / 지각 / 결석(노쇼) */
  checkResult: mysqlEnum("checkResult", ["present", "late", "absent"]).default("present").notNull(),
  recordedBy: int("recordedBy"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Attendance = typeof attendance.$inferSelect;
export type InsertAttendance = typeof attendance.$inferInsert;

// ─── AttendancePhotos (회원 출석 사진 기록) ─────────────────────────────────────
export const attendancePhotos = mysqlTable("attendance_photos", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  memberId: int("memberId").notNull(),
  attendanceDate: date("attendanceDate", { mode: "string" }).notNull(),
  imageData: longtext("imageData"),
  imageUrl: text("imageUrl"),
  storageKey: varchar("storageKey", { length: 512 }),
  caption: varchar("caption", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AttendancePhoto = typeof attendancePhotos.$inferSelect;
export type InsertAttendancePhoto = typeof attendancePhotos.$inferInsert;

// ─── Payments (납부) ──────────────────────────────────────────────────────────
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  memberId: int("memberId").notNull(),
  amount: int("amount").notNull(),
  paidAt: timestamp("paidAt").defaultNow().notNull(),
  periodStart: date("periodStart", { mode: "string" }),
  periodEnd: date("periodEnd", { mode: "string" }),
  method: mysqlEnum("method", ["cash", "card", "transfer"]).default("cash").notNull(),
  notes: text("notes"),
  recordedBy: int("recordedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

// ─── Announcements (공지사항) ─────────────────────────────────────────────────
export const announcements = mysqlTable("announcements", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  isPinned: boolean("isPinned").default(false).notNull(),
  /** 고정 만료일(해당 날짜까지 상단 고정, null이면 무기한) */
  pinnedUntil: date("pinnedUntil", { mode: "string" }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Announcement = typeof announcements.$inferSelect;
export type InsertAnnouncement = typeof announcements.$inferInsert;

export const announcementReads = mysqlTable(
  "announcement_reads",
  {
    userId: int("userId").notNull(),
    announcementId: int("announcementId").notNull(),
    readAt: timestamp("readAt").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.announcementId] }),
  })
);

export type AnnouncementRead = typeof announcementReads.$inferSelect;
export type InsertAnnouncementRead = typeof announcementReads.$inferInsert;

// ─── Promotions (승급 심사) ───────────────────────────────────────────────────
export const promotions = mysqlTable("promotions", {
  id: int("id").autoincrement().primaryKey(),
  memberId: int("memberId").notNull(),
  examDate: date("examDate", { mode: "string" }).notNull(),
  currentBelt: mysqlEnum("currentBelt", [
    "white", "yellow", "orange", "green", "blue", "brown", "black"
  ]).notNull(),
  targetBelt: mysqlEnum("targetBelt", [
    "white", "yellow", "orange", "green", "blue", "brown", "black"
  ]).notNull(),
  result: mysqlEnum("result", ["pending", "passed", "failed"]).default("pending").notNull(),
  notes: text("notes"),
  recordedBy: int("recordedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Promotion = typeof promotions.$inferSelect;
export type InsertPromotion = typeof promotions.$inferInsert;

// ─── 승급 심사 준비 체크리스트 (전역 템플릿 + 심사별 완료) ─────────────────────────
export const promotionChecklistTemplates = mysqlTable("promotion_checklist_templates", {
  id: int("id").autoincrement().primaryKey(),
  label: varchar("label", { length: 255 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
});

export type PromotionChecklistTemplate = typeof promotionChecklistTemplates.$inferSelect;
export type InsertPromotionChecklistTemplate = typeof promotionChecklistTemplates.$inferInsert;

export const promotionChecklistProgress = mysqlTable(
  "promotion_checklist_progress",
  {
    promotionId: int("promotionId").notNull(),
    templateId: int("templateId").notNull(),
    completedAt: timestamp("completedAt").defaultNow().notNull(),
    completedBy: int("completedBy"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.promotionId, t.templateId] }),
  })
);

export type PromotionChecklistProgress = typeof promotionChecklistProgress.$inferSelect;
export type InsertPromotionChecklistProgress = typeof promotionChecklistProgress.$inferInsert;

// ─── ActivityLogs (관리자 활동 로그) ────────────────────────────────────────────
export const activityLogs = mysqlTable("activityLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  targetType: varchar("targetType", { length: 32 }),
  targetId: int("targetId"),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

// ─── InviteTokens (회원 초대 링크) ──────────────────────────────────────────────
export const inviteTokens = mysqlTable("inviteTokens", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  memberId: int("memberId"),
  createdBy: int("createdBy").notNull(),
  usedBy: int("usedBy"),
  usedAt: timestamp("usedAt"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InviteToken = typeof inviteTokens.$inferSelect;
export type InsertInviteToken = typeof inviteTokens.$inferInsert;

// ─── MemberMemoHistory (회원 메모 수정 이력) ─────────────────────────────────────
export const memberMemoHistory = mysqlTable("memberMemoHistory", {
  id: int("id").autoincrement().primaryKey(),
  memberId: int("memberId").notNull(),
  content: text("content").notNull(),
  savedBy: int("savedBy").notNull(),
  savedAt: timestamp("savedAt").defaultNow().notNull(),
});
export type MemberMemoHistory = typeof memberMemoHistory.$inferSelect;
export type InsertMemberMemoHistory = typeof memberMemoHistory.$inferInsert;

// ─── PushTokens (회원 푸시 알림 토큰) ────────────────────────────────────────────
export const pushTokens = mysqlTable("pushTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 512 }).notNull(),
  platform: varchar("platform", { length: 16 }).notNull().default("unknown"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = typeof pushTokens.$inferInsert;

// ─── NotificationPreferences (관리자 승인형 알림 설정) ─────────────────────────
export const notificationPreferences = mysqlTable(
  "notification_preferences",
  {
    userId: int("userId").notNull(),
    category: mysqlEnum("category", [
      "announcement",
      "attendance",
      "payment",
      "promotion",
      "tournament",
      "manager_ops",
    ]).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    approvedBy: int("approvedBy"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.category] }),
  }),
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferences.$inferInsert;

export const notificationDefaultPreferences = mysqlTable("notification_default_preferences", {
  category: mysqlEnum("category", [
    "announcement",
    "attendance",
    "payment",
    "promotion",
    "tournament",
    "manager_ops",
  ]).primaryKey().notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NotificationDefaultPreference = typeof notificationDefaultPreferences.$inferSelect;
export type InsertNotificationDefaultPreference = typeof notificationDefaultPreferences.$inferInsert;

// ─── ParentChildLinks (학부모-자녀 연결) ─────────────────────────────────────────
export const parentChildLinks = mysqlTable(
  "parent_child_links",
  {
    parentUserId: int("parentUserId").notNull(),
    memberId: int("memberId").notNull(),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.parentUserId, t.memberId] }),
  }),
);

export type ParentChildLink = typeof parentChildLinks.$inferSelect;
export type InsertParentChildLink = typeof parentChildLinks.$inferInsert;

// ─── ManagerTasks (관리자 운영 할 일/메모) ─────────────────────────────────────
export const managerTasks = mysqlTable("manager_tasks", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["open", "done", "archived"]).default("open").notNull(),
  priority: mysqlEnum("priority", ["low", "normal", "high"]).default("normal").notNull(),
  dueDate: date("dueDate", { mode: "string" }),
  memberId: int("memberId"),
  createdBy: int("createdBy").notNull(),
  assignedTo: int("assignedTo"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ManagerTask = typeof managerTasks.$inferSelect;
export type InsertManagerTask = typeof managerTasks.$inferInsert;

// ─── Tournaments (대회) ───────────────────────────────────────────────────────
export const tournaments = mysqlTable("tournaments", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  eventDate: date("eventDate", { mode: "string" }).notNull(),
  location: varchar("location", { length: 255 }),
  /** 참가 신청 마감일 (null이면 상시 등록) */
  registrationDeadline: date("registrationDeadline", { mode: "string" }),
  /** 참가비. 0이면 무료 또는 미정으로 표시한다. */
  entryFee: int("entryFee").default(0).notNull(),
  description: text("description"),
  /** 회원에게 노출할 준비물·계좌·집합 시간 등 기타 안내사항. */
  notice: text("notice"),
  status: mysqlEnum("status", ["upcoming", "ongoing", "completed", "cancelled"])
    .default("upcoming")
    .notNull(),
  recordedBy: int("recordedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournament = typeof tournaments.$inferInsert;

// ─── TournamentParticipants (대회 참가자 · 체급/부문/결과) ──────────────────────
export const tournamentParticipants = mysqlTable(
  "tournament_participants",
  {
    tournamentId: int("tournamentId").notNull(),
    memberId: int("memberId").notNull(),
    /** 체급 (예: -73kg, -60kg). 자유 텍스트로 보관. */
    weightClass: varchar("weightClass", { length: 64 }),
    /** 부문 (예: 초등/중등/고등/성인). 자유 텍스트. */
    division: varchar("division", { length: 64 }),
    /** 결과: pending=대기, participated=참가(입상 없음), gold/silver/bronze=입상, absent=불참 */
    result: mysqlEnum("result", [
      "pending",
      "participated",
      "gold",
      "silver",
      "bronze",
      "absent",
    ])
      .default("pending")
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tournamentId, t.memberId] }),
  }),
);

export type TournamentParticipant = typeof tournamentParticipants.$inferSelect;
export type InsertTournamentParticipant = typeof tournamentParticipants.$inferInsert;
