import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  activityLogs,
  announcementReads,
  announcements,
  attendance,
  inviteTokens,
  memberMemoHistory,
  members,
  payments,
  promotionChecklistProgress,
  promotionChecklistTemplates,
  promotions,
  pushTokens,
  users,
  type InsertActivityLog,
  type InsertAnnouncement,
  type InsertAttendance,
  type InsertInviteToken,
  type InsertMember,
  type InsertMemberMemoHistory,
  type InsertPayment,
  type InsertPromotion,
  type InsertUser,
} from "../drizzle/schema";
import { calcParticipationRate, isAnnouncementPinnedEffective } from "../lib/judo-utils";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// Users
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const f of textFields) {
    if (user[f] !== undefined) { values[f] = user[f] ?? null; updateSet[f] = user[f] ?? null; }
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalized = normalizeEmail(email);
  const result = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  return result[0];
}

export async function createEmailUser(input: { email: string; name: string }): Promise<{ id: number; openId: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const email = normalizeEmail(input.email);
  const openId = `email:${email}`;

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    throw new Error("이미 가입된 이메일입니다.");
  }

  const now = new Date();
  const isOwner = openId === ENV.ownerOpenId || email === (ENV.ownerOpenId ?? "").toLowerCase();
  const adminCount = await getAdminCount();
  const role: "member" | "manager" | "admin" =
    isOwner || adminCount === 0 ? "admin" : "member";

  await db.insert(users).values({
    openId,
    name: input.name,
    email,
    loginMethod: "email",
    role,
    lastSignedIn: now,
  });

  const created = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!created[0]) throw new Error("사용자 생성 후 조회 실패");
  return { id: created[0].id, openId };
}

export async function touchUserSignIn(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? null;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    avatarUrl: users.avatarUrl,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(users.name);
}

export async function getAdminCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, "admin"));
  return Number(result[0]?.count ?? 0);
}

export async function updateUserRole(id: number, role: "member" | "manager" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ role }).where(eq(users.id, id));
}

// Members
export async function getAllMembers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(members).orderBy(desc(members.createdAt));
}

export async function getActiveMembers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(members).where(eq(members.status, "active")).orderBy(members.name);
}

export async function getMemberById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return result[0] ?? null;
}

export async function getMemberByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(members).where(eq(members.userId, userId)).limit(1);
  return result[0] ?? null;
}

export async function createMember(data: InsertMember): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(members).values(data);
  return (result[0] as any).insertId as number;
}

export async function updateMember(id: number, data: Partial<InsertMember>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(members).set(data).where(eq(members.id, id));
}

export async function deleteMember(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(members).where(eq(members.id, id));
}

// Attendance
export async function getAttendanceByDate(date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: attendance.id,
    memberId: attendance.memberId,
    attendanceDate: attendance.attendanceDate,
    checkInTime: attendance.checkInTime,
    type: attendance.type,
    checkResult: attendance.checkResult,
    recordedBy: attendance.recordedBy,
    notes: attendance.notes,
    createdAt: attendance.createdAt,
    member: {
      id: members.id,
      name: members.name,
      beltRank: members.beltRank,
    },
  }).from(attendance).leftJoin(members, eq(attendance.memberId, members.id)).where(eq(attendance.attendanceDate, date));
}

export async function getAttendanceByMember(memberId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(attendance).where(eq(attendance.memberId, memberId)).orderBy(desc(attendance.attendanceDate));
}

export async function getAttendanceByMemberAndMonth(memberId: number, year: number, month: number) {
  const db = await getDb();
  if (!db) return [];
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-31`;
  return db.select().from(attendance).where(and(eq(attendance.memberId, memberId), gte(attendance.attendanceDate, startDate), lte(attendance.attendanceDate, endDate))).orderBy(attendance.attendanceDate);
}

export async function getTodayAttendance() {
  const today = new Date().toISOString().split("T")[0];
  return getAttendanceByDate(today);
}

export async function checkAttendance(data: InsertAttendance): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(attendance).where(and(eq(attendance.memberId, data.memberId), eq(attendance.attendanceDate, data.attendanceDate))).limit(1);
  if (existing.length > 0) return existing[0].id;
  const result = await db.insert(attendance).values(data);
  return (result[0] as any).insertId as number;
}

export async function deleteAttendance(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(attendance).where(eq(attendance.id, id));
}

export async function getAttendanceStatsByMember(memberId: number) {
  const db = await getDb();
  if (!db) return [];
  // 理쒓렐 6媛쒖썡 ?붾퀎 異쒖꽍 ??吏묎퀎
  const results: { year: number; month: number; count: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = `${year}-${String(month).padStart(2, "0")}-31`;
    const rows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(attendance)
      .where(
        and(
          eq(attendance.memberId, memberId),
          gte(attendance.attendanceDate, startDate),
          lte(attendance.attendanceDate, endDate),
          inArray(attendance.checkResult, ["present", "late"]),
        ),
      );
    results.push({ year, month, count: Number(rows[0]?.count ?? 0) });
  }
  return results;
}

/** ?뚯썝 ?곸꽭 ?곷떒 ?뚰븳?덉뿉?? 理쒓렐 異쒖꽍 1嫄? 理쒓렐 30??異쒖꽍 ?잛닔, ?湲?以??밴툒 ?ъ궗 1嫄?*/
export async function getMemberOverviewSnapshot(memberId: number) {
  const db = await getDb();
  const empty = {
    lastAttendance: null as null | {
      attendanceDate: string;
      type: "regular" | "makeup" | "trial";
      checkResult: "present" | "late" | "absent";
      checkInTime: Date | null;
    },
    attendanceCount30d: 0,
    pendingPromotion: null as null | {
      id: number;
      examDate: string;
      currentBelt: string;
      targetBelt: string;
    },
  };
  if (!db) return empty;

  const lastRows = await db
    .select()
    .from(attendance)
    .where(eq(attendance.memberId, memberId))
    .orderBy(desc(attendance.attendanceDate))
    .limit(1);
  const last = lastRows[0];
  const lastAttendance = last
    ? {
        attendanceDate: last.attendanceDate,
        type: last.type,
        checkResult: last.checkResult,
        checkInTime: last.checkInTime,
      }
    : null;

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().split("T")[0];
  const countRows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(attendance)
    .where(
      and(
        eq(attendance.memberId, memberId),
        gte(attendance.attendanceDate, sinceStr),
        inArray(attendance.checkResult, ["present", "late"]),
      ),
    );
  const attendanceCount30d = Number(countRows[0]?.c ?? 0);

  const promoRows = await db
    .select({
      id: promotions.id,
      examDate: promotions.examDate,
      currentBelt: promotions.currentBelt,
      targetBelt: promotions.targetBelt,
    })
    .from(promotions)
    .where(and(eq(promotions.memberId, memberId), eq(promotions.result, "pending")))
    .orderBy(promotions.examDate)
    .limit(1);
  const pr = promoRows[0];
  const pendingPromotion = pr
    ? {
        id: pr.id,
        examDate: pr.examDate,
        currentBelt: pr.currentBelt,
        targetBelt: pr.targetBelt,
      }
    : null;

  return { lastAttendance, attendanceCount30d, pendingPromotion };
}

/** 異쒖꽍쨌?⑸?쨌?밴툒 ?ъ궗瑜?????꾨씪?몄쑝濡?(理쒖떊?? */
export type MemberTimelineEvent =
  | {
      kind: "attendance";
      id: number;
      at: string;
      attendanceDate: string;
      type: "regular" | "makeup" | "trial";
      checkResult: "present" | "late" | "absent";
      notes: string | null;
    }
  | {
      kind: "payment";
      id: number;
      at: string;
      amount: number;
      method: "cash" | "card" | "transfer";
      periodStart: string | null;
      periodEnd: string | null;
      notes: string | null;
    }
  | {
      kind: "promotion";
      id: number;
      at: string;
      examDate: string;
      currentBelt: string;
      targetBelt: string;
      result: "pending" | "passed" | "failed";
      notes: string | null;
    };

export async function getMemberActivityTimeline(memberId: number, limit = 80) {
  const db = await getDb();
  if (!db) return [];

  const [attRows, payRows, promoRows] = await Promise.all([
    db.select().from(attendance).where(eq(attendance.memberId, memberId)),
    db.select().from(payments).where(eq(payments.memberId, memberId)),
    db.select().from(promotions).where(eq(promotions.memberId, memberId)),
  ]);

  const events: MemberTimelineEvent[] = [];

  for (const a of attRows) {
    const at =
      a.checkInTime != null
        ? new Date(a.checkInTime).toISOString()
        : a.createdAt
          ? new Date(a.createdAt).toISOString()
          : `${a.attendanceDate}T15:00:00.000Z`;
    events.push({
      kind: "attendance",
      id: a.id,
      at,
      attendanceDate: a.attendanceDate,
      type: a.type,
      checkResult: a.checkResult,
      notes: a.notes ?? null,
    });
  }

  for (const p of payRows) {
    events.push({
      kind: "payment",
      id: p.id,
      at: new Date(p.paidAt).toISOString(),
      amount: p.amount,
      method: p.method,
      periodStart: p.periodStart ?? null,
      periodEnd: p.periodEnd ?? null,
      notes: p.notes ?? null,
    });
  }

  for (const pr of promoRows) {
    const examMs = new Date(`${pr.examDate}T12:00:00`).getTime();
    events.push({
      kind: "promotion",
      id: pr.id,
      at: new Date(examMs).toISOString(),
      examDate: pr.examDate,
      currentBelt: pr.currentBelt,
      targetBelt: pr.targetBelt,
      result: pr.result,
      notes: pr.notes ?? null,
    });
  }

  events.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  return events.slice(0, limit);
}

export async function getMonthlyAttendanceCount(year: number, month: number) {
  const db = await getDb();
  if (!db) return [];
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-31`;
  return db
    .select({ memberId: attendance.memberId, count: sql<number>`COUNT(*)` })
    .from(attendance)
    .where(
      and(
        gte(attendance.attendanceDate, startDate),
        lte(attendance.attendanceDate, endDate),
        inArray(attendance.checkResult, ["present", "late"]),
      ),
    )
    .groupBy(attendance.memberId);
}

// Payments
export async function getPaymentsByMember(memberId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payments).where(eq(payments.memberId, memberId)).orderBy(desc(payments.paidAt));
}

export async function getRecentPayments(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payments).orderBy(desc(payments.paidAt)).limit(limit);
}

export async function createPayment(data: InsertPayment): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(payments).values(data);
  return (result[0] as any).insertId as number;
}

export async function deletePayment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(payments).where(eq(payments.id, id));
}

export async function getMonthlyRevenue(year: number, month: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);
  const result = await db.select({ total: sql<number>`COALESCE(SUM(amount), 0)` }).from(payments).where(and(gte(payments.paidAt, startDate), lte(payments.paidAt, endDate)));
  return Number(result[0]?.total ?? 0);
}

export async function getUnpaidMembers() {
  const db = await getDb();
  if (!db) return [];
  const today = new Date().toISOString().split("T")[0];
  return db.select().from(members).where(and(eq(members.status, "active"), lte(members.nextPaymentDate, today))).orderBy(members.nextPaymentDate);
}

export async function getExpiringSoonMembers(days = 7) {
  const db = await getDb();
  if (!db) return [];
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + days);
  const todayStr = today.toISOString().split("T")[0];
  const futureStr = future.toISOString().split("T")[0];
  // ?ㅻ뒛 ?댄썑 ~ days???대궡 ?⑸? ?덉젙 (留뚮즺 ?꾨컯)
  return db.select().from(members)
    .where(and(
      eq(members.status, "active"),
      gte(members.nextPaymentDate, todayStr),
      lte(members.nextPaymentDate, futureStr)
    ))
    .orderBy(members.nextPaymentDate);
}

// Announcements
export async function getAnnouncementsWithReadState(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const todayStr = new Date().toISOString().split("T")[0];
  const rows = await db.select().from(announcements).orderBy(desc(announcements.createdAt));
  const ids = rows.map((r) => r.id);
  const readMap = new Map<number, Date>();
  if (ids.length > 0) {
    const reads = await db
      .select()
      .from(announcementReads)
      .where(and(eq(announcementReads.userId, userId), inArray(announcementReads.announcementId, ids)));
    for (const r of reads) {
      readMap.set(r.announcementId, r.readAt as Date);
    }
  }
  const enriched = rows.map((r) => ({
    ...r,
    readAt: readMap.get(r.id) ?? null,
    isPinnedEffective: isAnnouncementPinnedEffective(r.isPinned, r.pinnedUntil ?? null, todayStr),
  }));
  enriched.sort((a, b) => {
    if (a.isPinnedEffective !== b.isPinnedEffective) return a.isPinnedEffective ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return enriched;
}

export async function markAnnouncementRead(userId: number, announcementId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  await db
    .insert(announcementReads)
    .values({ userId, announcementId, readAt: now })
    .onDuplicateKeyUpdate({ set: { readAt: now } });
}

export async function createAnnouncement(data: InsertAnnouncement): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(announcements).values(data);
  return (result[0] as any).insertId as number;
}

export async function updateAnnouncement(id: number, data: Partial<InsertAnnouncement>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(announcements).set(data).where(eq(announcements.id, id));
}

export async function deleteAnnouncement(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(announcements).where(eq(announcements.id, id));
}

// Dashboard Stats
export async function getDashboardStats() {
  const db = await getDb();
  if (!db) {
    return {
      totalMembers: 0,
      activeMembers: 0,
      todayAttendance: 0,
      unpaidCount: 0,
      monthlyRevenue: 0,
      expiringSoonCount: 0,
      monthlyAttendanceCount: 0,
      newMembersThisMonth: 0,
      pendingPromotionsCount: 0,
      todayAttendanceRate: 0,
    };
  }
  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const endOfMonth = `${year}-${String(month).padStart(2, "0")}-31`;
  // 7????留뚮즺 ?꾨컯
  const future7 = new Date(now);
  future7.setDate(future7.getDate() + 7);
  const future7Str = future7.toISOString().split("T")[0];
  const future30 = new Date(now);
  future30.setDate(future30.getDate() + 30);
  const future30Str = future30.toISOString().split("T")[0];

  const [totalResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(members);
  const [activeResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(members).where(eq(members.status, "active"));
  const [todayResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(attendance).where(eq(attendance.attendanceDate, today));
  const [unpaidResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(members).where(and(eq(members.status, "active"), lte(members.nextPaymentDate, today)));
  const [expiringSoonResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(members).where(and(eq(members.status, "active"), gte(members.nextPaymentDate, today), lte(members.nextPaymentDate, future7Str)));
  const [monthlyAttendanceResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(attendance).where(and(gte(attendance.attendanceDate, startOfMonth), lte(attendance.attendanceDate, endOfMonth)));
  const [newMembersResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(members)
    .where(and(gte(members.joinDate, startOfMonth), lte(members.joinDate, endOfMonth)));
  const [pendingPromoResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(promotions)
    .where(
      and(
        eq(promotions.result, "pending"),
        gte(promotions.examDate, today),
        lte(promotions.examDate, future30Str),
      ),
    );
  const revenue = await getMonthlyRevenue(year, month);
  const activeN = Number(activeResult?.count ?? 0);
  const todayN = Number(todayResult?.count ?? 0);
  return {
    totalMembers: Number(totalResult?.count ?? 0),
    activeMembers: activeN,
    todayAttendance: todayN,
    unpaidCount: Number(unpaidResult?.count ?? 0),
    monthlyRevenue: revenue,
    expiringSoonCount: Number(expiringSoonResult?.count ?? 0),
    monthlyAttendanceCount: Number(monthlyAttendanceResult?.count ?? 0),
    newMembersThisMonth: Number(newMembersResult?.count ?? 0),
    pendingPromotionsCount: Number(pendingPromoResult?.count ?? 0),
    todayAttendanceRate: calcParticipationRate(todayN, activeN),
  };
}

// ?대쾲 ???쇰퀎 異쒖꽍 異붿씠 (爰얠???洹몃옒?꾩슜)
export async function getDailyAttendanceThisMonth(): Promise<{ day: number; count: number }[]> {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-31`;
  const rows = await db
    .select({
      day: sql<number>`DAY(attendance_date)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(attendance)
    .where(and(gte(attendance.attendanceDate, startDate), lte(attendance.attendanceDate, endDate)))
    .groupBy(sql`DAY(attendance_date)`)
    .orderBy(sql`DAY(attendance_date)`);
  return rows.map(r => ({ day: Number(r.day), count: Number(r.count) }));
}

// Seed Demo Data
export async function seedDemoData(adminUserId: number) {
  const db = await getDb();
  if (!db) return;
  const existing = await getAllMembers();
  if (existing.length > 0) return;
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const demoMembers: InsertMember[] = [
    { name: "김태권", phone: "010-1234-5678", email: "taekwon@example.com", beltRank: "black", beltDegree: 2, status: "active", joinDate: fmt(new Date(today.getFullYear() - 3, 0, 15)), monthlyFee: 80000, nextPaymentDate: fmt(new Date(today.getFullYear(), today.getMonth() + 1, 1)), gender: "male" },
    { name: "이지훈", phone: "010-2345-6789", beltRank: "brown", beltDegree: 1, status: "active", joinDate: fmt(new Date(today.getFullYear() - 2, 3, 10)), monthlyFee: 70000, nextPaymentDate: fmt(new Date(today.getFullYear(), today.getMonth() + 1, 1)), gender: "male" },
    { name: "박수연", phone: "010-3456-7890", beltRank: "blue", beltDegree: 1, status: "active", joinDate: fmt(new Date(today.getFullYear() - 1, 6, 20)), monthlyFee: 60000, nextPaymentDate: fmt(new Date(today.getFullYear(), today.getMonth(), 5)), gender: "female" },
    { name: "최강민", phone: "010-4567-8901", beltRank: "green", beltDegree: 1, status: "active", joinDate: fmt(new Date(today.getFullYear() - 1, 9, 1)), monthlyFee: 60000, nextPaymentDate: fmt(new Date(today.getFullYear(), today.getMonth() + 1, 1)), gender: "male" },
    { name: "정하은", phone: "010-5678-9012", beltRank: "white", beltDegree: 1, status: "active", joinDate: fmt(new Date(today.getFullYear(), today.getMonth() - 2, 15)), monthlyFee: 50000, nextPaymentDate: fmt(new Date(today.getFullYear(), today.getMonth(), 15)), gender: "female" },
    { name: "강노아", phone: "010-6789-0123", beltRank: "yellow", beltDegree: 1, status: "active", joinDate: fmt(new Date(today.getFullYear(), today.getMonth() - 4, 5)), monthlyFee: 55000, nextPaymentDate: fmt(new Date(today.getFullYear(), today.getMonth() + 1, 1)), gender: "male" },
    { name: "서주원", phone: "010-7890-1234", beltRank: "orange", beltDegree: 1, status: "suspended", joinDate: fmt(new Date(today.getFullYear() - 1, 2, 10)), monthlyFee: 55000, nextPaymentDate: null, gender: "female" },
  ];
  const memberIds: number[] = [];
  for (const m of demoMembers) { const id = await createMember(m); memberIds.push(id); }
  for (const id of memberIds.slice(0, 4)) {
    await checkAttendance({
      memberId: id,
      attendanceDate: fmt(today),
      checkInTime: new Date(),
      type: "regular",
      checkResult: "present",
      recordedBy: adminUserId,
    });
  }
  for (const id of memberIds.slice(0, 5)) { await createPayment({ memberId: id, amount: 70000, paidAt: new Date(today.getFullYear(), today.getMonth(), 3), periodStart: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), periodEnd: fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0)), method: "card", recordedBy: adminUserId }); }
  await createAnnouncement({ title: "4???꾩옣 ?댁쁺 ?덈궡", content: "4?????ш컙 ?뺤긽 ?댁쁺?⑸땲?? 怨듯쑕??4/5 ?앸ぉ??? ?닿??낅땲??", isPinned: true, createdBy: adminUserId });
  await createAnnouncement({ title: "?밴툒 ?ъ궗 ?쇱젙 ?덈궡", content: "4??20???? ?ㅼ쟾 10?쒖뿉 ?밴툒 ?ъ궗媛 吏꾪뻾?⑸땲?? ?대떦 ?뚯썝? 誘몃━ ?좎껌??二쇱꽭??", isPinned: false, createdBy: adminUserId });
}

// ??? Promotions (?밴툒 ?ъ궗) ???????????????????????????????????????????????????
export async function getPromotions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(promotions).orderBy(desc(promotions.examDate));
}

export async function getPromotionsByMonth(year: number, month: number) {
  const db = await getDb();
  if (!db) return [];
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const rows = await db
    .select({
      id: promotions.id,
      memberId: promotions.memberId,
      memberName: members.name,
      memberBeltRank: members.beltRank,
      examDate: promotions.examDate,
      currentBelt: promotions.currentBelt,
      targetBelt: promotions.targetBelt,
      result: promotions.result,
      notes: promotions.notes,
      recordedBy: promotions.recordedBy,
      createdAt: promotions.createdAt,
    })
    .from(promotions)
    .leftJoin(members, eq(promotions.memberId, members.id))
    .where(and(gte(promotions.examDate, startDate), lte(promotions.examDate, endDate)))
    .orderBy(promotions.examDate);
  return rows;
}

export async function getPromotionsByMember(memberId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(promotions)
    .where(eq(promotions.memberId, memberId))
    .orderBy(desc(promotions.examDate));
}

export async function createPromotion(data: InsertPromotion) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(promotions).values(data);
  return (result as any).insertId as number;
}

export async function updatePromotion(id: number, data: Partial<InsertPromotion>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(promotions).set(data).where(eq(promotions.id, id));
}

export async function deletePromotion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(promotions).where(eq(promotions.id, id));
}

export async function getActivePromotionChecklistTemplates() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(promotionChecklistTemplates)
    .where(eq(promotionChecklistTemplates.isActive, true))
    .orderBy(asc(promotionChecklistTemplates.sortOrder), asc(promotionChecklistTemplates.id));
}

export async function getPromotionChecklistProgressRows(promotionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(promotionChecklistProgress)
    .where(eq(promotionChecklistProgress.promotionId, promotionId));
}

export async function togglePromotionChecklistItem(
  promotionId: number,
  templateId: number,
  completedByUserId: number
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db
    .select()
    .from(promotionChecklistProgress)
    .where(
      and(
        eq(promotionChecklistProgress.promotionId, promotionId),
        eq(promotionChecklistProgress.templateId, templateId)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .delete(promotionChecklistProgress)
      .where(
        and(
          eq(promotionChecklistProgress.promotionId, promotionId),
          eq(promotionChecklistProgress.templateId, templateId)
        )
      );
    return { completed: false as const };
  }
  await db.insert(promotionChecklistProgress).values({
    promotionId,
    templateId,
    completedBy: completedByUserId,
    completedAt: new Date(),
  });
  return { completed: true as const };
}

export async function getUpcomingPromotions(days = 30) {
  const db = await getDb();
  if (!db) return [];
  const today = new Date().toISOString().split("T")[0];
  const future = new Date(Date.now() + days * 86400000).toISOString().split("T")[0];
  return db
    .select({
      id: promotions.id,
      memberId: promotions.memberId,
      memberName: members.name,
      memberBeltRank: members.beltRank,
      examDate: promotions.examDate,
      currentBelt: promotions.currentBelt,
      targetBelt: promotions.targetBelt,
      result: promotions.result,
      notes: promotions.notes,
      recordedBy: promotions.recordedBy,
      createdAt: promotions.createdAt,
    })
    .from(promotions)
    .leftJoin(members, eq(promotions.memberId, members.id))
    .where(and(gte(promotions.examDate, today), lte(promotions.examDate, future), eq(promotions.result, "pending")))
    .orderBy(promotions.examDate);
}

// ??? Members - 怨꾩젙 ?곌껐 ??????????????????????????????????????????????????????
export async function linkMemberToUser(memberId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(members).set({ userId }).where(eq(members.id, memberId));
}

export async function unlinkMemberFromUser(memberId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(members).set({ userId: null }).where(eq(members.id, memberId));
}

// ??? ActivityLogs ?????????????????????????????????????????????????????????????
export async function createActivityLog(data: InsertActivityLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(activityLogs).values(data);
}

export async function getActivityLogs(limit = 50, actionFilter?: string) {
  const db = await getDb();
  if (!db) return [];
  const sel = db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      action: activityLogs.action,
      targetType: activityLogs.targetType,
      targetId: activityLogs.targetId,
      description: activityLogs.description,
      createdAt: activityLogs.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id));
  const q = actionFilter
    ? sel.where(eq(activityLogs.action, actionFilter)).orderBy(desc(activityLogs.createdAt)).limit(limit)
    : sel.orderBy(desc(activityLogs.createdAt)).limit(limit);
  return q;
}

// ??? InviteTokens ?????????????????????????????????????????????????????????????
export async function createInviteToken(data: InsertInviteToken) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(inviteTokens).values(data);
  return (result as any).insertId as number;
}

export async function getInviteToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token)).limit(1);
  return rows[0] ?? null;
}

export async function useInviteToken(token: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(inviteTokens)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(eq(inviteTokens.token, token));
}

export async function getInviteTokensByCreator(createdBy: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: inviteTokens.id,
    token: inviteTokens.token,
    memberId: inviteTokens.memberId,
    createdBy: inviteTokens.createdBy,
    usedBy: inviteTokens.usedBy,
    usedAt: inviteTokens.usedAt,
    expiresAt: inviteTokens.expiresAt,
    createdAt: inviteTokens.createdAt,
    memberName: members.name,
  })
    .from(inviteTokens)
    .leftJoin(members, eq(inviteTokens.memberId, members.id))
    .where(eq(inviteTokens.createdBy, createdBy))
    .orderBy(desc(inviteTokens.createdAt))
    .limit(50);
}

// ??? MemberMemoHistory (?뚯썝 硫붾え ?섏젙 ?대젰) ?????????????????????????????????????
export async function saveMemoHistory(data: InsertMemberMemoHistory) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(memberMemoHistory).values(data);
}

export async function getMemoHistory(memberId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: memberMemoHistory.id,
    memberId: memberMemoHistory.memberId,
    content: memberMemoHistory.content,
    savedBy: memberMemoHistory.savedBy,
    savedAt: memberMemoHistory.savedAt,
    savedByName: users.name,
  })
    .from(memberMemoHistory)
    .leftJoin(users, eq(memberMemoHistory.savedBy, users.id))
    .where(eq(memberMemoHistory.memberId, memberId))
    .orderBy(desc(memberMemoHistory.savedAt))
    .limit(50);
}

export async function deleteMemoHistoryItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memberMemoHistory).where(eq(memberMemoHistory.id, id));
}

export async function clearMemoHistory(memberId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memberMemoHistory).where(eq(memberMemoHistory.memberId, memberId));
}

// ??? Push Tokens ?????????????????????????????????????????????????????????????

export async function upsertPushToken(userId: number, token: string, platform: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // 湲곗〈 ?좏겙???덉쑝硫??낅뜲?댄듃, ?놁쑝硫??쎌엯
  const existing = await db
    .select()
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(pushTokens)
      .set({ token, platform })
      .where(eq(pushTokens.userId, userId));
  } else {
    await db.insert(pushTokens).values({ userId, token, platform });
  }
}

export async function getAllPushTokens(): Promise<{ userId: number; token: string }[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ userId: pushTokens.userId, token: pushTokens.token }).from(pushTokens);
}

export async function deletePushToken(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(pushTokens).where(eq(pushTokens.userId, userId));
}

