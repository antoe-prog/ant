import {
  boolean,
  date,
  int,
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
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["member", "manager", "admin"]).default("member").notNull(),
  avatarUrl: text("avatarUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

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
