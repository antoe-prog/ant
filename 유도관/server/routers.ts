import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { calcParticipationRate, getBeltLabel, suggestNextPaymentDate, type BeltRank } from "../lib/judo-utils";
import {
  checkAttendance,
  getAttendanceStatsByMember,
  createAnnouncement,
  createEmailUser,
  createMember,
  createPayment,
  createPromotion,
  deleteAnnouncement,
  deleteAttendance,
  deleteMember,
  deletePayment,
  deletePromotion,
  getActiveMembers,
  getAllMembers,
  getAnnouncementsWithReadState,
  markAnnouncementRead,
  getAttendanceByMember,
  getAttendanceByMemberAndMonth,
  getAttendancePhotosByMemberAndDate,
  getAttendancePhotosByMemberAndMonth,
  getDashboardStats,
  getManagerOperationsSummary,
  getMemberById,
  getNotifyUserIdsForMember,
  getNotifyUserIdsForMembers,
  getMemberActivityTimeline,
  getMemberOverviewSnapshot,
  getMemberByUserId,
  getChildrenByParentUserId,
  getPrimaryChildByParentUserId,
  getMonthlyAttendanceCount,
  getMonthlyRevenue,
  getPaymentsByMember,
  getPromotions,
  getActivePromotionChecklistTemplates,
  getPromotionChecklistProgressRows,
  getPromotionsByMember,
  getPromotionsByMonth,
  getRecentPayments,
  getTodayAttendance,
  getDailyAttendanceThisMonth,
  getExpiringSoonMembers,
  getUnpaidMembers,
  getUpcomingPromotions,
  getUserByEmail,
  seedDemoData,
  togglePromotionChecklistItem,
  touchUserSignIn,
  updateAnnouncement,
  updateMember,
  updatePromotion,
  updateUserRole,
  getAllUsers,
  getAdminCount,
  linkMemberToUser,
  unlinkMemberFromUser,
  getParentChildLinksForAdmin,
  linkParentToMember,
  unlinkParentFromMember,
  createActivityLog,
  createAttendancePhoto,
  getActivityLogs,
  createInviteToken,
  getInviteToken,
  useInviteToken,
  getInviteTokensByCreator,
  getMemoHistory,
  saveMemoHistory,
  deleteMemoHistoryItem,
  clearMemoHistory,
  deleteAttendancePhotoForUser,
  upsertPushToken,
  deletePushToken,
  getAllTournaments,
  getUpcomingTournaments,
  getTournamentById,
  getTournamentWithParticipants,
  getTournamentsByMember,
  createTournament,
  updateTournament,
  deleteTournament,
  upsertTournamentParticipant,
  removeTournamentParticipant,
  getNotificationPreferencesForAdmin,
  setNotificationPreference,
  getNotificationDefaultPreferences,
  setNotificationDefaultPreference,
  applyNotificationDefaultsToAllUsers,
  createDatabaseBackup,
  importMembersFromBackup,
  getMonthlyOperationalReport,
  getManagerTasks,
  createManagerTask,
  updateManagerTask,
  setManagerTaskDone,
  archiveManagerTask,
} from "./db";
import { storagePut } from "./storage";
import { sendPushNotifications } from "./push";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { hashPassword, verifyPassword } from "./_core/password";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, authedProcedure, managerProcedure, publicProcedure, router } from "./_core/trpc";

// 서버에서도 띠를 한국어로 표기하기 위한 짧은 래퍼. getBeltLabel 인자 타입에 맞춰 캐스팅한다.
function beltKo(belt: string): string {
  return getBeltLabel(belt as BeltRank);
}

const EMAIL_SCHEMA = z
  .string()
  .trim()
  .toLowerCase()
  .email("올바른 이메일 형식이 아닙니다.");
const PASSWORD_SCHEMA = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다.")
  .max(200, "비밀번호가 너무 깁니다.");

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return (
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d)
  );
}

const DATE_SCHEMA = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다.")
  .refine(isValidDateOnly, "존재하지 않는 날짜입니다.");

const NOTIFICATION_CATEGORY_SCHEMA = z.enum([
  "announcement",
  "attendance",
  "payment",
  "promotion",
  "tournament",
  "manager_ops",
]);

function parseImageDataUrl(value: string): { buffer: Buffer; mimeType: string; ext: string } {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(value);
  if (!match) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "이미지 파일만 업로드할 수 있습니다." });
  }
  const subtype = match[1].toLowerCase();
  const ext = subtype === "jpeg" ? "jpg" : subtype;
  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType: `image/${subtype === "jpg" ? "jpeg" : subtype}`,
    ext,
  };
}

async function issueSession(opts: {
  ctx: { res: import("express").Response; req: import("express").Request };
  openId: string;
  name: string;
}) {
  const sessionToken = await sdk.createSessionToken(opts.openId, {
    name: opts.name,
    expiresInMs: ONE_YEAR_MS,
  });
  const cookieOptions = getSessionCookieOptions(opts.ctx.req);
  opts.ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
  return sessionToken;
}

const authRouter = router({
  me: authedProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.user.id,
      openId: ctx.user.openId,
      name: ctx.user.name,
      email: ctx.user.email,
      role: ctx.user.role,
      accountType: ctx.user.accountType ?? "student",
      loginMethod: ctx.user.loginMethod,
      avatarUrl: ctx.user.avatarUrl,
      lastSignedIn: ctx.user.lastSignedIn,
    };
  }),
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
  /**
   * 이메일 + 비밀번호 자체 회원가입.
   * - 이미 존재하는 이메일이면 실패
   * - 성공 시 세션 쿠키 설정 + 네이티브용 토큰(app_session_id) 반환
   */
  register: publicProcedure
    .input(
      z.object({
        email: EMAIL_SCHEMA,
        password: PASSWORD_SCHEMA,
        name: z.string().trim().min(1, "이름을 입력해 주세요.").max(64),
        accountType: z.enum(["student", "parent"]).default("student"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getUserByEmail(input.email);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "이미 가입된 이메일입니다." });
      }
      const passwordHash = await hashPassword(input.password);
      const { id, openId } = await createEmailUser({
        email: input.email,
        name: input.name,
        passwordHash,
        accountType: input.accountType,
      });
      const sessionToken = await issueSession({ ctx, openId, name: input.name });
      return {
        app_session_id: sessionToken,
        user: {
          id,
          openId,
          name: input.name,
          email: input.email,
          role: "member" as const,
          accountType: input.accountType,
          loginMethod: "email",
        },
      };
    }),
  /**
   * 이메일 + 비밀번호 로그인.
   */
  login: publicProcedure
    .input(z.object({ email: EMAIL_SCHEMA, password: PASSWORD_SCHEMA }))
    .mutation(async ({ ctx, input }) => {
      const user = await getUserByEmail(input.email);
      const INVALID = new TRPCError({ code: "UNAUTHORIZED", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
      if (!user || !user.passwordHash) throw INVALID;
      const ok = await verifyPassword(input.password, user.passwordHash);
      if (!ok) throw INVALID;
      await touchUserSignIn(user.id);
      const sessionToken = await issueSession({
        ctx,
        openId: user.openId,
        name: user.name ?? "",
      });
      return {
        app_session_id: sessionToken,
        user: {
          id: user.id,
          openId: user.openId,
          name: user.name,
          email: user.email,
          role: user.role,
          accountType: user.accountType ?? "student",
          loginMethod: user.loginMethod,
        },
      };
  }),
});

async function getReadableMemberForUser(
  user: NonNullable<import("./_core/context").TrpcContext["user"]>,
  memberId?: number,
) {
  if (user.accountType === "parent") {
    if (memberId) {
      const children = await getChildrenByParentUserId(user.id);
      const child = children.find((item) => item.id === memberId);
      if (!child) {
        throw new TRPCError({ code: "FORBIDDEN", message: "연결된 자녀 정보만 조회할 수 있습니다." });
      }
      return child;
    }
    return getPrimaryChildByParentUserId(user.id);
  }
  const member = await getMemberByUserId(user.id);
  if (memberId && member?.id !== memberId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "본인 회원 정보만 조회할 수 있습니다." });
  }
  return member;
}

const membersRouter = router({
  list: managerProcedure.query(async () => getAllMembers()),
  activeList: managerProcedure.query(async () => getActiveMembers()),
  byId: managerProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const member = await getMemberById(input.id);
    if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "회원을 찾을 수 없습니다." });
    const pays = await getPaymentsByMember(input.id);
    const last = pays[0];
    const suggestedNextPaymentDate = suggestNextPaymentDate({
      joinDate: member.joinDate,
      nextPaymentDate: member.nextPaymentDate,
      lastPaidAt: last?.paidAt ?? null,
      lastPeriodEnd: last?.periodEnd ?? null,
    });
    return { ...member, suggestedNextPaymentDate };
  }),
  /** 회원 상세 「한눈에」 요약 (출석·심사 예정) */
  overview: managerProcedure.input(z.object({ memberId: z.number() })).query(async ({ input }) => {
    return getMemberOverviewSnapshot(input.memberId);
  }),
  /** 출석·납부·승급 심사 통합 타임라인 (최신순) */
  activityTimeline: managerProcedure
    .input(z.object({ memberId: z.number(), limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ input }) => getMemberActivityTimeline(input.memberId, input.limit ?? 80)),
  myProfile: authedProcedure
    .input(z.object({ memberId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => getReadableMemberForUser(ctx.user, input?.memberId)),
  myChildren: authedProcedure.query(async ({ ctx }) => {
    if (ctx.user.accountType !== "parent") return [];
    return getChildrenByParentUserId(ctx.user.id);
  }),
  updateMyProfile: authedProcedure.input(z.object({
    name: z.string().trim().min(1).max(128).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
    birthDate: DATE_SCHEMA.nullable().optional(),
    emergencyContact: z.string().trim().max(128).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    if (ctx.user.accountType === "parent") {
      throw new TRPCError({ code: "FORBIDDEN", message: "학부모 계정은 자녀 정보를 직접 수정할 수 없습니다." });
    }
    const member = await getMemberByUserId(ctx.user.id);
    if (!member) {
      throw new TRPCError({ code: "NOT_FOUND", message: "연결된 회원 정보가 없습니다." });
    }
    const patch: Parameters<typeof updateMember>[1] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.phone !== undefined) patch.phone = input.phone || null;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.birthDate !== undefined) patch.birthDate = input.birthDate || null;
    if (input.emergencyContact !== undefined) patch.emergencyContact = input.emergencyContact || null;
    await updateMember(member.id, patch);
    return { success: true };
  }),
  create: managerProcedure.input(z.object({
    name: z.string().trim().min(1).max(128),
    phone: z.string().trim().max(20).optional(),
    email: EMAIL_SCHEMA.optional(),
    birthDate: DATE_SCHEMA.optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    beltRank: z.enum(["white", "yellow", "orange", "green", "blue", "brown", "black"]).default("white"),
    beltDegree: z.number().int().min(1).max(9).default(1),
    status: z.enum(["active", "suspended", "withdrawn"]).default("active"),
    joinDate: DATE_SCHEMA,
    monthlyFee: z.number().int().min(0).default(0),
    nextPaymentDate: DATE_SCHEMA.optional(),
    emergencyContact: z.string().trim().max(128).optional(),
    notes: z.string().trim().max(2000).optional(),
  })).mutation(async ({ input }) => {
    const id = await createMember(input);
    return { id };
  }),
  update: managerProcedure.input(z.object({
    id: z.number(),
    name: z.string().trim().min(1).max(128).optional(),
    phone: z.string().trim().max(20).optional(),
    email: EMAIL_SCHEMA.optional(),
    birthDate: DATE_SCHEMA.optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    beltRank: z.enum(["white", "yellow", "orange", "green", "blue", "brown", "black"]).optional(),
    beltDegree: z.number().int().min(1).max(9).optional(),
    status: z.enum(["active", "suspended", "withdrawn"]).optional(),
    monthlyFee: z.number().int().min(0).optional(),
    nextPaymentDate: DATE_SCHEMA.nullable().optional(),
    emergencyContact: z.string().trim().max(128).optional(),
    notes: z.string().trim().max(2000).optional(),
  })).mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;
    // notes가 업데이트될 때 이전 메모를 이력에 저장 후 notesUpdatedAt 자동 설정
    const updateData: Record<string, unknown> = { ...data };
    if (data.notes !== undefined) {
      // 기존 메모를 이력 테이블에 저장
      const existing = await getMemberById(id);
      if (existing && existing.notes && existing.notes.trim().length > 0) {
        await saveMemoHistory({ memberId: id, content: existing.notes, savedBy: ctx.user.id });
      }
      updateData.notesUpdatedAt = new Date();
    }
    await updateMember(id, updateData as Parameters<typeof updateMember>[1]);
    return { success: true };
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deleteMember(input.id);
    return { success: true };
  }),
  // 회원 본인 승급심사 이력 조회
  myPromotions: authedProcedure.input(z.object({ memberId: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
    const member = await getReadableMemberForUser(ctx.user, input?.memberId);
    if (!member) return [];
    return getPromotionsByMember(member.id);
  }),
  // 회원 본인 납부 이력 조회
  myPayments: authedProcedure.input(z.object({ memberId: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
    const member = await getReadableMemberForUser(ctx.user, input?.memberId);
    if (!member) return [];
    return getPaymentsByMember(member.id);
  }),
  // 회원 본인 월별 출석 조회
  myAttendanceByMonth: authedProcedure.input(z.object({ year: z.number(), month: z.number(), memberId: z.number().optional() })).query(async ({ ctx, input }) => {
    const member = await getReadableMemberForUser(ctx.user, input.memberId);
    if (!member) return [];
    return getAttendanceByMemberAndMonth(member.id, input.year, input.month);
  }),
  // 회원 본인 전체 출석 이력 (달력용)
  myAttendanceAll: authedProcedure.input(z.object({ memberId: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
    const member = await getReadableMemberForUser(ctx.user, input?.memberId);
    if (!member) return [];
    return getAttendanceByMember(member.id);
  }),
  myAttendancePhotosByMonth: authedProcedure
    .input(z.object({ year: z.number(), month: z.number().min(1).max(12), memberId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const member = await getReadableMemberForUser(ctx.user, input.memberId);
      if (!member) return [];
      return getAttendancePhotosByMemberAndMonth(member.id, input.year, input.month);
    }),
  myAttendancePhotosByDate: authedProcedure
    .input(z.object({ attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), memberId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const member = await getReadableMemberForUser(ctx.user, input.memberId);
      if (!member) return [];
      return getAttendancePhotosByMemberAndDate(member.id, input.attendanceDate);
    }),
  addAttendancePhoto: authedProcedure
    .input(z.object({
      attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      imageData: z
        .string()
        .max(3_500_000, "사진 용량이 너무 큽니다. 더 작은 사진을 선택해 주세요.")
        .refine((value) => /^data:image\/(png|jpe?g|webp);base64,/i.test(value), "이미지 파일만 업로드할 수 있습니다."),
      caption: z.string().trim().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.accountType === "parent") {
        throw new TRPCError({ code: "FORBIDDEN", message: "학부모 계정은 자녀 출석 사진을 직접 추가할 수 없습니다." });
      }
      const member = await getMemberByUserId(ctx.user.id);
      if (!member) {
        throw new TRPCError({ code: "NOT_FOUND", message: "연결된 회원 정보가 없습니다." });
      }
      const parsed = parseImageDataUrl(input.imageData);
      let imageData: string | null = null;
      let imageUrl: string | null = null;
      let storageKey: string | null = null;
      try {
        const key = `attendance-photos/member-${member.id}/${input.attendanceDate}-${Date.now()}.${parsed.ext}`;
        const stored = await storagePut(key, parsed.buffer, parsed.mimeType);
        imageUrl = stored.url;
        storageKey = stored.key;
      } catch (error) {
        // 저장소 환경변수가 없는 로컬 개발 환경에서는 기존 base64 방식으로 안전하게 폴백한다.
        console.warn("[AttendancePhoto] storage upload failed; falling back to DB imageData:", error);
        imageData = input.imageData;
      }
      const id = await createAttendancePhoto({
        userId: ctx.user.id,
        memberId: member.id,
        attendanceDate: input.attendanceDate,
        imageData,
        imageUrl,
        storageKey,
        caption: input.caption || null,
      });
      return { id };
    }),
  deleteAttendancePhoto: authedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteAttendancePhotoForUser(input.id, ctx.user.id);
      return { success: true };
    }),
  /** 회원 본인 앞으로의 일정 (승급 심사 예정·납부 예정일) */
  mySchedule: authedProcedure
    .input(z.object({ days: z.number().min(7).max(365).optional(), memberId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const member = await getReadableMemberForUser(ctx.user, input.memberId);
      if (!member) {
        return { hasMemberProfile: false as const, items: [] };
      }
      const days = input.days ?? 120;
      const todayStr = new Date().toISOString().split("T")[0];
      const end = new Date();
      end.setDate(end.getDate() + days);
      const endStr = end.toISOString().split("T")[0];

      const promos = await getPromotionsByMember(member.id);
      const promoItems = promos
        .filter((p) => p.result === "pending" && p.examDate >= todayStr && p.examDate <= endStr)
        .map((p) => ({
          kind: "promotion" as const,
          sortDate: p.examDate,
          id: p.id,
          examDate: p.examDate,
          currentBelt: p.currentBelt,
          targetBelt: p.targetBelt,
        }));

      const items: (
        | (typeof promoItems)[number]
        | { kind: "paymentDue"; sortDate: string; date: string; amount: number }
      )[] = [...promoItems];
      if (
        member.nextPaymentDate &&
        member.nextPaymentDate >= todayStr &&
        member.nextPaymentDate <= endStr &&
        member.status === "active"
      ) {
        items.push({
          kind: "paymentDue",
          sortDate: member.nextPaymentDate,
          date: member.nextPaymentDate,
          amount: member.monthlyFee,
        });
      }
      items.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
      return { hasMemberProfile: true as const, memberName: member.name, items };
    }),
  // 아바타 이미지 업로드 (base64)
  uploadAvatar: managerProcedure.input(z.object({
    memberId: z.number(),
    base64: z.string(),
    mimeType: z.string().default("image/jpeg"),
  })).mutation(async ({ input }) => {
    const base64Data = input.base64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const ext = input.mimeType.split("/")[1] || "jpg";
    const key = `avatars/member-${input.memberId}-${Date.now()}.${ext}`;
    const { url } = await storagePut(key, buffer, input.mimeType);
    await updateMember(input.memberId, { avatarUrl: url });
    return { url };
  }),
});

const attendanceRouter = router({
  today: managerProcedure.query(async () => getTodayAttendance()),
  byMember: managerProcedure.input(z.object({ memberId: z.number() })).query(async ({ input }) => getAttendanceByMember(input.memberId)),
  byMemberMonth: managerProcedure.input(z.object({ memberId: z.number(), year: z.number(), month: z.number() })).query(async ({ input }) => getAttendanceByMemberAndMonth(input.memberId, input.year, input.month)),
  monthlyCount: managerProcedure.input(z.object({ year: z.number(), month: z.number() })).query(async ({ input }) => getMonthlyAttendanceCount(input.year, input.month)),
  check: managerProcedure.input(z.object({
    memberId: z.number(),
    attendanceDate: DATE_SCHEMA,
    type: z.enum(["regular", "makeup", "trial"]).default("regular"),
    checkResult: z.enum(["present", "late", "absent"]).default("present"),
    notes: z.string().trim().max(500).optional(),
  })).mutation(async ({ ctx, input }) => {
    const { id, isNew } = await checkAttendance({
      memberId: input.memberId,
      attendanceDate: input.attendanceDate,
      checkInTime: input.checkResult === "absent" ? null : new Date(),
      type: input.type,
      checkResult: input.checkResult,
      recordedBy: ctx.user.id,
      notes: input.notes,
    });
    // 중복 출석이면 푸시 알림은 생략한다.
    if (isNew && input.checkResult !== "absent") {
      getNotifyUserIdsForMember(input.memberId).then((userIds) => {
        if (userIds.length > 0) {
          const typeLabel = input.type === "regular" ? "일반" : input.type === "makeup" ? "보강" : "체험";
          const resultLabel = input.checkResult === "late" ? "지각" : "출석";
          sendPushNotifications(userIds, {
            title: "회원님, 오늘 출석이 등록되었습니다! 🏆",
            body: `${input.attendanceDate} ${typeLabel} ${resultLabel}이(가) 기록되었습니다.`,
            data: { type: "attendance", memberId: input.memberId, attendanceDate: input.attendanceDate },
          });
        }
      }).catch(() => {});
    }
    return { id, isNew };
  }),
  delete: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deleteAttendance(input.id);
    return { success: true };
  }),
  // 일괄 출석 체크
  checkBulk: managerProcedure.input(z.object({
    memberIds: z.array(z.number()).min(1),
    attendanceDate: DATE_SCHEMA,
    type: z.enum(["regular", "makeup", "trial"]).default("regular"),
    checkResult: z.enum(["present", "late", "absent"]).default("present"),
    notes: z.string().trim().max(500).optional(),
  })).mutation(async ({ ctx, input }) => {
    const bulkNote = input.notes?.trim() || (input.checkResult === "absent" ? "일괄 결석" : "일괄 출석");
    const results = await Promise.allSettled(
      input.memberIds.map(memberId =>
        checkAttendance({
          memberId,
          attendanceDate: input.attendanceDate,
          checkInTime: input.checkResult === "absent" ? null : new Date(),
          type: input.type,
          checkResult: input.checkResult,
          recordedBy: ctx.user.id,
          notes: bulkNote,
        }),
      ),
    );
    const succeeded = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;
    if (input.checkResult !== "absent") {
      getNotifyUserIdsForMembers(input.memberIds).then((userIds) => {
        if (userIds.length > 0) {
          sendPushNotifications(userIds, {
            title: "회원님, 오늘 출석이 등록되었습니다! 🏆",
            body: `${input.attendanceDate} 출석이 완료되었습니다.`,
            data: { type: "attendance", attendanceDate: input.attendanceDate },
          });
        }
      }).catch(() => {});
    }
    return { succeeded, failed, total: input.memberIds.length };
  }),
  statsByMember: managerProcedure.input(z.object({ memberId: z.number() })).query(async ({ input }) => getAttendanceStatsByMember(input.memberId)),
  // QR 코드 스캔으로 출석 체크
  checkByQr: managerProcedure.input(z.object({
    memberId: z.number(),
    type: z.enum(["regular", "makeup", "trial"]).default("regular"),
  })).mutation(async ({ ctx, input }) => {
    // 서버 호스트 타임존이 아닌 한국 시간(KST, UTC+9) 기준 오늘 날짜를 계산한다.
    // (서버가 UTC 리전에 배포된 경우 00~09시 사이 '전날'로 기록되는 버그 방지)
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const today = kst.toISOString().split("T")[0];
    const { id, isNew } = await checkAttendance({
      memberId: input.memberId,
      attendanceDate: today,
      checkInTime: new Date(),
      type: input.type,
      checkResult: "present",
      recordedBy: ctx.user.id,
      notes: "QR 코드 스캔",
    });
    console.log(
      `[Attendance] QR scan memberId=${input.memberId} date=${today} isNew=${isNew} by user=${ctx.user.id}`,
    );
    // 최초 기록된 경우에만 회원에게 푸시 알림
    if (isNew) {
      getNotifyUserIdsForMember(input.memberId).then((userIds) => {
        if (userIds.length > 0) {
          sendPushNotifications(userIds, {
            title: "QR 출석 완료! 📱",
            body: `${today} 출석이 등록되었습니다.`,
            data: { type: "attendance", memberId: input.memberId, attendanceDate: today },
          });
        }
      }).catch(() => {});
    }
    return { id, attendanceDate: today, isNew };
  }),
});

const paymentsRouter = router({
  byMember: managerProcedure.input(z.object({ memberId: z.number() })).query(async ({ input }) => getPaymentsByMember(input.memberId)),
  recent: managerProcedure.input(z.object({ limit: z.number().default(20) })).query(async ({ input }) => getRecentPayments(input.limit)),
  unpaid: managerProcedure.query(async () => getUnpaidMembers()),
  expiringSoon: managerProcedure.input(z.object({ days: z.number().default(7) })).query(async ({ input }) => getExpiringSoonMembers(input.days)),
  monthlyRevenue: managerProcedure.input(z.object({ year: z.number(), month: z.number() })).query(async ({ input }) => getMonthlyRevenue(input.year, input.month)),
  create: managerProcedure.input(z.object({
    memberId: z.number(),
    amount: z.number().int().min(1, "납부 금액은 1원 이상이어야 합니다."),
    method: z.enum(["cash", "card", "transfer"]).default("cash"),
    periodStart: DATE_SCHEMA.optional(),
    periodEnd: DATE_SCHEMA.optional(),
    notes: z.string().trim().max(500).optional(),
  })).mutation(async ({ ctx, input }) => {
    if ((input.periodStart && !input.periodEnd) || (!input.periodStart && input.periodEnd)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "등록기간은 시작일과 종료일을 함께 입력해 주세요." });
    }
    if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "등록기간 시작일은 종료일보다 늦을 수 없습니다." });
    }
    const member = await getMemberById(input.memberId);
    if (!member) {
      throw new TRPCError({ code: "NOT_FOUND", message: "회원을 찾을 수 없습니다." });
    }
    const id = await createPayment({
      memberId: input.memberId,
      amount: input.amount,
      paidAt: new Date(),
      method: input.method,
      periodStart: (input.periodStart ?? null) as string | null,
      periodEnd: (input.periodEnd ?? null) as string | null,
      notes: input.notes,
      recordedBy: ctx.user.id,
    });
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    const nextPaymentDateStr = input.periodEnd ?? nextDate.toISOString().split("T")[0];
    // nextPaymentDate를 한 달 뒤로 갱신 → 스케줄러의 만료 알림 대상에서 자동 제외됨
    await updateMember(input.memberId, { nextPaymentDate: nextPaymentDateStr });
    // 납부 완료 즉시 회원에게 확인 알림 발송 (비동기)
    getNotifyUserIdsForMember(input.memberId).then((userIds) => {
      if (userIds.length > 0) {
        const methodLabel: Record<string, string> = { cash: "현금", card: "카드", transfer: "계좌이체" };
        const amountFormatted = input.amount.toLocaleString("ko-KR");
        sendPushNotifications(userIds, {
          title: "납부 완료 ✅",
          body: `${amountFormatted}원 납부가 완료되었습니다. 다음 납부일: ${nextPaymentDateStr}`,
          data: { type: "payment_complete", memberId: input.memberId, method: methodLabel[input.method] ?? input.method, nextPaymentDate: nextPaymentDateStr },
        });
      }
    }).catch(() => {});
    return { id };
  }),
  delete: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deletePayment(input.id);
    return { success: true };
  }),
  // 월별 납부 리포트
  monthlyReport: managerProcedure.input(z.object({ year: z.number(), month: z.number() })).query(async ({ input }) => {
    const payments = await getRecentPayments(500);
    const filtered = payments.filter((p: any) => {
      const d = new Date(p.paidAt);
      return d.getFullYear() === input.year && d.getMonth() + 1 === input.month;
    });
    const totalRevenue = filtered.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
    const byMethod = filtered.reduce((acc: Record<string, number>, p: any) => {
      acc[p.method] = (acc[p.method] || 0) + Number(p.amount);
      return acc;
    }, {});
    return { payments: filtered, totalRevenue, byMethod, year: input.year, month: input.month };
  }),
});

const announcementsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => getAnnouncementsWithReadState(ctx.user.id)),
  markRead: authedProcedure.input(z.object({ announcementId: z.number() })).mutation(async ({ ctx, input }) => {
    await markAnnouncementRead(ctx.user.id, input.announcementId);
    return { success: true as const };
  }),
  create: managerProcedure.input(z.object({
    title: z.string().min(1),
    content: z.string().min(1),
    isPinned: z.boolean().default(false),
    pinnedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  })).mutation(async ({ ctx, input }) => {
    const pinnedUntil = input.isPinned && input.pinnedUntil ? input.pinnedUntil : null;
    const id = await createAnnouncement({
      title: input.title,
      content: input.content,
      isPinned: input.isPinned,
      pinnedUntil,
      createdBy: ctx.user.id,
    });
    // 전체 회원에게 푸시 알림 발송 (비동기, 실패해도 공지 등록은 성공)
    sendPushNotifications("all", {
      title: `📢 ${input.isPinned ? "[중요] " : ""}${input.title}`,
      body: input.content.length > 80 ? input.content.slice(0, 80) + "..." : input.content,
      data: { type: "announcement", id },
    })
      .then(({ sent, errors }) => {
        console.log(`[Push] Announcement #${id} delivered: sent=${sent}, errors=${errors}`);
      })
      .catch((err) => console.error("[Push] Announcement notification failed:", err));
    return { id };
  }),
  update: managerProcedure.input(z.object({
    id: z.number(),
    title: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    isPinned: z.boolean().optional(),
    pinnedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })).mutation(async ({ input }) => {
    const { id, title, content, isPinned, pinnedUntil } = input;
    const patch: Partial<Parameters<typeof updateAnnouncement>[1]> = {};
    if (title !== undefined) patch.title = title;
    if (content !== undefined) patch.content = content;
    if (isPinned !== undefined) {
      patch.isPinned = isPinned;
      if (!isPinned) patch.pinnedUntil = null;
    }
    if (pinnedUntil !== undefined && isPinned !== false) {
      patch.pinnedUntil = pinnedUntil || null;
    }
    await updateAnnouncement(id, patch);
    return { success: true };
  }),
  delete: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deleteAnnouncement(input.id);
    return { success: true };
  }),
});

const dashboardRouter = router({
  stats: managerProcedure.query(async () => getDashboardStats()),
  operationsSummary: managerProcedure.query(async () => getManagerOperationsSummary()),
  monthlyReport: managerProcedure
    .input(z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }))
    .query(async ({ input }) => getMonthlyOperationalReport(input.year, input.month)),
  monthlyStats: managerProcedure.query(async () => {
    // 최근 6개월: 매출, 출석 횟수, 도장 전체 추정 출석률(활성 회원×월 22일 기준, 대시보드 카드와 동일)
    const dash = await getDashboardStats();
    const activeN = dash.activeMembers;
    const denom = activeN * 22;
    const results = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const [revenue, attendanceRows] = await Promise.all([
        getMonthlyRevenue(year, month),
        getMonthlyAttendanceCount(year, month),
      ]);
      const totalAttendance = attendanceRows.reduce((sum: number, r: { count: number }) => sum + Number(r.count), 0);
      const attendanceRate = calcParticipationRate(totalAttendance, denom);
      results.push({ year, month, revenue, attendance: totalAttendance, attendanceRate });
    }
    return results;
  }),
  dailyAttendance: managerProcedure.query(async () => getDailyAttendanceThisMonth()),
  seed: managerProcedure.mutation(async ({ ctx }) => {
    await seedDemoData(ctx.user.id);
    return { success: true };
  }),
});

const promotionsRouter = router({
  list: managerProcedure.query(async () => getPromotions()),
  byMonth: managerProcedure.input(z.object({ year: z.number(), month: z.number() })).query(async ({ input }) => getPromotionsByMonth(input.year, input.month)),
  byMember: managerProcedure.input(z.object({ memberId: z.number() })).query(async ({ input }) => getPromotionsByMember(input.memberId)),
  upcoming: managerProcedure.input(z.object({ days: z.number().default(30) })).query(async ({ input }) => getUpcomingPromotions(input.days)),
  create: managerProcedure.input(z.object({
    memberId: z.number(),
    examDate: DATE_SCHEMA,
    currentBelt: z.enum(["white", "yellow", "orange", "green", "blue", "brown", "black"]),
    targetBelt: z.enum(["white", "yellow", "orange", "green", "blue", "brown", "black"]),
    result: z.enum(["pending", "passed", "failed"]).default("pending"),
    notes: z.string().trim().max(500).optional(),
  })).mutation(async ({ ctx, input }) => {
    if (input.currentBelt === input.targetBelt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "현재 띠와 목표 띠는 달라야 합니다." });
    }
    const id = await createPromotion({ ...input, recordedBy: ctx.user.id });
    // 대상 회원에게 심사 등록 알림 (회원 계정이 연결되어 있고 푸시 토큰이 있을 때만 전달)
    void (async () => {
      try {
        const userIds = await getNotifyUserIdsForMember(input.memberId);
        if (userIds.length === 0) return;
        const currentLabel = beltKo(input.currentBelt);
        const targetLabel = beltKo(input.targetBelt);
        sendPushNotifications(userIds, {
          title: `🥋 승급 심사 예정`,
          body: `${input.examDate}에 ${currentLabel} → ${targetLabel} 심사가 등록되었습니다.`,
          data: { type: "promotion", id, examDate: input.examDate, memberId: input.memberId },
        }).catch((err) => console.error("[Push] Promotion create notification failed:", err));
      } catch (err) {
        console.error("[Push] Promotion notification lookup failed:", err);
      }
    })();
    return { id };
  }),
  updateResult: managerProcedure.input(z.object({
    id: z.number(),
    result: z.enum(["pending", "passed", "failed"]),
    notes: z.string().optional(),
  })).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await updatePromotion(id, data);
    // 합격 시 회원 띠 자동 업그레이드 + 축하 알림
    if (data.result === "passed") {
      const all = await getPromotions();
      const p = all.find(x => x.id === id);
      if (p) {
        await updateMember(p.memberId, { beltRank: p.targetBelt });
        void (async () => {
          try {
            const userIds = await getNotifyUserIdsForMember(p.memberId);
            if (userIds.length === 0) return;
            sendPushNotifications(userIds, {
              title: `🎉 승급 심사 합격`,
              body: `축하합니다! ${beltKo(p.currentBelt)} → ${beltKo(p.targetBelt)} 승급이 완료되었습니다.`,
              data: { type: "promotion", id, memberId: p.memberId },
            }).catch((err) => console.error("[Push] Promotion result notification failed:", err));
          } catch (err) {
            console.error("[Push] Promotion result lookup failed:", err);
          }
        })();
      }
    }
    return { success: true };
  }),
  delete: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deletePromotion(input.id);
    return { success: true };
  }),
  /** 승급 심사 준비 체크리스트 (전역 템플릿 + 해당 심사 완료 여부) */
  checklist: managerProcedure.input(z.object({ promotionId: z.number() })).query(async ({ input }) => {
    const templates = await getActivePromotionChecklistTemplates();
    const progress = await getPromotionChecklistProgressRows(input.promotionId);
    const done = new Map(progress.map((p) => [p.templateId, p]));
    return {
      items: templates.map((t) => ({
        templateId: t.id,
        label: t.label,
        sortOrder: t.sortOrder,
        completed: done.has(t.id),
        completedAt: done.get(t.id)?.completedAt ?? null,
      })),
      completedCount: progress.length,
      totalCount: templates.length,
    };
  }),
  toggleChecklist: managerProcedure
    .input(z.object({ promotionId: z.number(), templateId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await togglePromotionChecklistItem(input.promotionId, input.templateId, ctx.user.id);
      return { success: true };
    }),
});

const adminRouter = router({
  users: adminProcedure.query(async () => getAllUsers()),
  adminCount: authedProcedure.query(async () => getAdminCount()),
  updateRole: adminProcedure.input(z.object({ userId: z.number(), role: z.enum(["member", "manager", "admin"]) })).mutation(async ({ input, ctx }) => {
    if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "자신의 역할은 변경할 수 없습니다." });
    const targetUser = (await getAllUsers()).find(u => u.id === input.userId);
    await updateUserRole(input.userId, input.role);
    await createActivityLog({ userId: ctx.user.id, action: "updateRole", targetType: "user", targetId: input.userId, description: `${targetUser?.name ?? input.userId}의 역할을 ${input.role}(으)로 변경` });
    return { success: true };
  }),
  claimAdmin: authedProcedure.mutation(async ({ ctx }) => {
    const count = await getAdminCount();
    if (count > 0) throw new TRPCError({ code: "FORBIDDEN", message: "이미 관리자가 존재합니다." });
    await updateUserRole(ctx.user.id, "admin");
    await createActivityLog({ userId: ctx.user.id, action: "claimAdmin", description: "최초 관리자로 설정" });
    return { success: true };
  }),
  // 회원-계정 연결
  linkMember: adminProcedure.input(z.object({ memberId: z.number(), userId: z.number() })).mutation(async ({ input, ctx }) => {
    await linkMemberToUser(input.memberId, input.userId);
    await createActivityLog({ userId: ctx.user.id, action: "linkMember", targetType: "member", targetId: input.memberId, description: `회원 #${input.memberId}에 사용자 #${input.userId} 연결` });
    return { success: true };
  }),
  unlinkMember: adminProcedure.input(z.object({ memberId: z.number() })).mutation(async ({ input, ctx }) => {
    await unlinkMemberFromUser(input.memberId);
    await createActivityLog({ userId: ctx.user.id, action: "unlinkMember", targetType: "member", targetId: input.memberId, description: `회원 #${input.memberId} 계정 연결 해제` });
    return { success: true };
  }),
  // 활동 로그
  parentChildLinks: adminProcedure.query(async () => getParentChildLinksForAdmin()),
  linkParentChild: adminProcedure
    .input(z.object({ parentUserId: z.number(), memberId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const targetUser = (await getAllUsers()).find((u) => u.id === input.parentUserId);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "학부모 계정을 찾을 수 없습니다." });
      }
      if (targetUser.accountType !== "parent") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "학부모 유형으로 가입한 계정만 자녀와 연결할 수 있습니다." });
      }
      await linkParentToMember({
        parentUserId: input.parentUserId,
        memberId: input.memberId,
        createdBy: ctx.user.id,
      });
      await createActivityLog({
        userId: ctx.user.id,
        action: "linkParentChild",
        targetType: "member",
        targetId: input.memberId,
        description: `학부모 #${input.parentUserId}와 자녀 회원 #${input.memberId} 연결`,
      });
      return { success: true };
    }),
  unlinkParentChild: adminProcedure
    .input(z.object({ parentUserId: z.number(), memberId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await unlinkParentFromMember(input.parentUserId, input.memberId);
      await createActivityLog({
        userId: ctx.user.id,
        action: "unlinkParentChild",
        targetType: "member",
        targetId: input.memberId,
        description: `학부모 #${input.parentUserId}와 자녀 회원 #${input.memberId} 연결 해제`,
      });
      return { success: true };
    }),
  activityLogs: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).optional(),
      action: z.string().optional(),
    }))
    .query(async ({ input }) => getActivityLogs(input.limit ?? 150, input.action)),
  notificationPreferences: adminProcedure.query(async () => getNotificationPreferencesForAdmin()),
  notificationDefaults: adminProcedure.query(async () => getNotificationDefaultPreferences()),
  setNotificationPreference: adminProcedure
    .input(z.object({
      userId: z.number(),
      category: NOTIFICATION_CATEGORY_SCHEMA,
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await setNotificationPreference(input.userId, input.category, input.enabled, ctx.user.id);
      await createActivityLog({
        userId: ctx.user.id,
        action: "setNotificationPreference",
        targetType: "user",
        targetId: input.userId,
        description: `알림 ${input.category} ${input.enabled ? "허용" : "차단"}`,
      });
      return { success: true };
    }),
  setNotificationDefault: adminProcedure
    .input(z.object({
      category: NOTIFICATION_CATEGORY_SCHEMA,
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await setNotificationDefaultPreference(input.category, input.enabled, ctx.user.id);
      await createActivityLog({
        userId: ctx.user.id,
        action: "setNotificationDefault",
        targetType: "notification",
        description: `신규 알림 기본값 ${input.category} ${input.enabled ? "ON" : "OFF"}`,
      });
      return { success: true };
    }),
  applyNotificationDefaults: adminProcedure.mutation(async ({ ctx }) => {
    const result = await applyNotificationDefaultsToAllUsers(ctx.user.id);
    await createActivityLog({
      userId: ctx.user.id,
      action: "applyNotificationDefaults",
      targetType: "notification",
      description: `알림 기본 정책 전체 적용: 사용자 ${result.users}명, 설정 ${result.preferences}개`,
    });
    return result;
  }),
  createBackup: adminProcedure.mutation(async ({ ctx }) => {
    const backup = await createDatabaseBackup();
    await createActivityLog({
      userId: ctx.user.id,
      action: "createBackup",
      description: "DB 백업 JSON 생성",
    });
    return backup;
  }),
  importBackupMembers: adminProcedure
    .input(z.object({ backupJson: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.backupJson);
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "백업 JSON 형식이 올바르지 않습니다." });
      }
      const result = await importMembersFromBackup(parsed);
      await createActivityLog({
        userId: ctx.user.id,
        action: "importBackupMembers",
        description: `백업 회원 가져오기: 생성 ${result.created}명, 건너뜀 ${result.skipped}명`,
      });
      return result;
    }),
  // 초대 링크
  createInvite: adminProcedure.input(z.object({ memberId: z.number().optional() })).mutation(async ({ input, ctx }) => {
    const crypto = await import("crypto");
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일 유효
    await createInviteToken({ token, memberId: input.memberId ?? null, createdBy: ctx.user.id, expiresAt });
    await createActivityLog({ userId: ctx.user.id, action: "createInvite", targetType: "member", targetId: input.memberId, description: `초대 링크 생성${input.memberId ? ` (회원 #${input.memberId})` : ""}` });
    return { token };
  }),
  myInvites: adminProcedure.query(async ({ ctx }) => {
    return getInviteTokensByCreator(ctx.user.id);
  }),
  acceptInvite: authedProcedure.input(z.object({ token: z.string() })).mutation(async ({ input, ctx }) => {
    const invite = await getInviteToken(input.token);
    if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "유효하지 않은 초대 링크입니다." });
    if (invite.usedBy) throw new TRPCError({ code: "BAD_REQUEST", message: "이미 사용된 초대 링크입니다." });
    if (new Date(invite.expiresAt) < new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "만료된 초대 링크입니다." });
    await useInviteToken(input.token, ctx.user.id);
    if (invite.memberId) await linkMemberToUser(invite.memberId, ctx.user.id);
    await createActivityLog({ userId: ctx.user.id, action: "acceptInvite", targetType: "member", targetId: invite.memberId ?? undefined, description: "초대 링크로 회원 연결 완료" });
    return { success: true, memberId: invite.memberId };
  }),
});

const pushTokensRouter = router({
  register: authedProcedure
    .input(z.object({ token: z.string().min(1), platform: z.string().default("unknown") }))
    .mutation(async ({ ctx, input }) => {
      await upsertPushToken(ctx.user.id, input.token, input.platform);
      return { success: true };
    }),
  unregister: authedProcedure.mutation(async ({ ctx }) => {
    await deletePushToken(ctx.user.id);
    return { success: true };
  }),
});

const memoHistoryRouter = router({
  list: managerProcedure.input(z.object({ memberId: z.number() })).query(async ({ input }) => {
    return getMemoHistory(input.memberId);
  }),
  deleteItem: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deleteMemoHistoryItem(input.id);
    return { success: true };
  }),
  clearAll: managerProcedure.input(z.object({ memberId: z.number() })).mutation(async ({ input }) => {
    await clearMemoHistory(input.memberId);
    return { success: true };
  }),
});

const managerTasksRouter = router({
  list: managerProcedure
    .input(z.object({
      includeDone: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ input }) => getManagerTasks(input)),
  create: managerProcedure
    .input(z.object({
      title: z.string().trim().min(1, "할 일 제목을 입력해 주세요.").max(255),
      description: z.string().trim().max(2000).optional(),
      priority: z.enum(["low", "normal", "high"]).default("normal"),
      dueDate: DATE_SCHEMA.optional(),
      memberId: z.number().optional(),
      assignedTo: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await createManagerTask({
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        memberId: input.memberId ?? null,
        assignedTo: input.assignedTo ?? null,
        createdBy: ctx.user.id,
      });
      return { id };
    }),
  update: managerProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().trim().min(1).max(255).optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      priority: z.enum(["low", "normal", "high"]).optional(),
      dueDate: DATE_SCHEMA.nullable().optional(),
      memberId: z.number().nullable().optional(),
      assignedTo: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await updateManagerTask(id, patch);
      return { success: true };
    }),
  setDone: managerProcedure
    .input(z.object({ id: z.number(), done: z.boolean() }))
    .mutation(async ({ input }) => {
      await setManagerTaskDone(input.id, input.done);
      return { success: true };
    }),
  archive: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await archiveManagerTask(input.id);
      return { success: true };
    }),
});

// ─── Tournaments (대회) ─────────────────────────────────────────────────────

const TOURNAMENT_STATUS = ["upcoming", "ongoing", "completed", "cancelled"] as const;
const PARTICIPANT_RESULT = ["pending", "participated", "gold", "silver", "bronze", "absent"] as const;
function resultKo(r: (typeof PARTICIPANT_RESULT)[number]) {
  switch (r) {
    case "gold":
      return "금메달 🥇";
    case "silver":
      return "은메달 🥈";
    case "bronze":
      return "동메달 🥉";
    case "participated":
      return "참가";
    case "absent":
      return "불참";
    default:
      return "예정";
  }
}

const tournamentsRouter = router({
  /** 전체 대회 목록 (최신순). manager+ */
  list: managerProcedure.query(async () => getAllTournaments()),

  /** 향후 N일 내 예정 대회. manager+ (홈 카드/목록 공용) */
  upcoming: managerProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(60) }))
    .query(async ({ input }) => getUpcomingTournaments(input.days)),

  /** 상세 + 참가자 (관리자 전용) */
  byId: managerProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const row = await getTournamentWithParticipants(input.id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "대회를 찾을 수 없습니다." });
    return row;
  }),

  /**
   * 회원용 공개 정보: 대회 기본 정보 + 본인 참가 내역만.
   * 참가자 전체 명단·타인 결과는 노출하지 않는다.
   */
  publicInfo: authedProcedure.input(z.object({ id: z.number(), memberId: z.number().optional() })).query(async ({ ctx, input }) => {
    const row = await getTournamentWithParticipants(input.id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "대회를 찾을 수 없습니다." });
    const { participants, ...tournament } = row;
    const me = await getReadableMemberForUser(ctx.user, input.memberId);
    const mine = me ? participants.find((p) => p.memberId === me.id) ?? null : null;
    return { ...tournament, myEntry: mine, participantCount: participants.length };
  }),

  /** 내 대회 (연결된 회원 기준) — 회원/관리자 공용 */
  myTournaments: authedProcedure.input(z.object({ memberId: z.number().optional() }).optional()).query(async ({ ctx, input }) => {
    const me = await getReadableMemberForUser(ctx.user, input?.memberId);
    if (!me) return [];
    return getTournamentsByMember(me.id);
  }),

  /** 대회 생성 */
  create: managerProcedure
    .input(
      z.object({
        title: z.string().min(1),
        eventDate: DATE_SCHEMA,
        location: z.string().optional(),
        registrationDeadline: DATE_SCHEMA.optional().nullable(),
        entryFee: z.number().int().min(0).default(0),
        description: z.string().optional(),
        notice: z.string().optional(),
        status: z.enum(TOURNAMENT_STATUS).default("upcoming"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.registrationDeadline && input.registrationDeadline > input.eventDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "신청 마감일은 대회일보다 늦을 수 없습니다." });
      }
      const id = await createTournament({
        title: input.title,
        eventDate: input.eventDate,
        location: input.location ?? null,
        registrationDeadline: input.registrationDeadline ?? null,
        entryFee: input.entryFee,
        description: input.description ?? null,
        notice: input.notice ?? null,
        status: input.status,
        recordedBy: ctx.user.id,
      });
      console.log(`[Tournament] created id=${id} "${input.title}" by user=${ctx.user.id}`);
      return { id };
    }),

  /** 대회 수정 */
  update: managerProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        eventDate: DATE_SCHEMA.optional(),
        location: z.string().nullable().optional(),
        registrationDeadline: DATE_SCHEMA.nullable().optional(),
        entryFee: z.number().int().min(0).optional(),
        description: z.string().nullable().optional(),
        notice: z.string().nullable().optional(),
        status: z.enum(TOURNAMENT_STATUS).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      if (patch.registrationDeadline && patch.eventDate && patch.registrationDeadline > patch.eventDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "신청 마감일은 대회일보다 늦을 수 없습니다." });
      }
      if (patch.registrationDeadline && !patch.eventDate) {
        const existing = await getTournamentById(id);
        if (existing && patch.registrationDeadline > existing.eventDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "신청 마감일은 대회일보다 늦을 수 없습니다." });
        }
      }
      if (patch.eventDate && patch.registrationDeadline === undefined) {
        const existing = await getTournamentById(id);
        if (existing?.registrationDeadline && existing.registrationDeadline > patch.eventDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "기존 신청 마감일이 새 대회일보다 늦습니다. 마감일도 함께 수정해 주세요." });
        }
      }
      await updateTournament(id, patch);
      return { success: true };
    }),

  /** 대회 삭제 (참가자 포함) */
  delete: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deleteTournament(input.id);
    return { success: true };
  }),

  /**
   * 참가자 등록 또는 업데이트. 최초 등록일 때만 푸시 알림 발송.
   */
  registerParticipant: managerProcedure
    .input(
      z.object({
        tournamentId: z.number(),
        memberId: z.number(),
        weightClass: z.string().optional(),
        division: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { isNew } = await upsertTournamentParticipant({
        tournamentId: input.tournamentId,
        memberId: input.memberId,
        weightClass: input.weightClass ?? null,
        division: input.division ?? null,
        notes: input.notes ?? null,
      });
      // 최초 등록 시 회원에게 푸시 알림
      if (isNew) {
        void (async () => {
          try {
            const [userIds, tournament] = await Promise.all([
              getNotifyUserIdsForMember(input.memberId),
              getTournamentById(input.tournamentId),
            ]);
            if (userIds.length === 0 || !tournament) return;
            sendPushNotifications(userIds, {
              title: `🏆 대회 참가 등록`,
              body: `${tournament.eventDate} ${tournament.title}에 참가자로 등록되었습니다.`,
              data: {
                type: "tournament",
                tournamentId: input.tournamentId,
                memberId: input.memberId,
              },
            }).catch((err) => console.error("[Push] Tournament register notification failed:", err));
          } catch (err) {
            console.error("[Push] Tournament register lookup failed:", err);
          }
        })();
      }
      return { isNew };
    }),

  /**
   * 참가자 결과 업데이트. 결과가 `pending`·`absent` 이외로 확정되면 축하 알림.
   */
  updateParticipantResult: managerProcedure
    .input(
      z.object({
        tournamentId: z.number(),
        memberId: z.number(),
        weightClass: z.string().nullable().optional(),
        division: z.string().nullable().optional(),
        result: z.enum(PARTICIPANT_RESULT),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await upsertTournamentParticipant({
        tournamentId: input.tournamentId,
        memberId: input.memberId,
        weightClass: input.weightClass === undefined ? undefined : input.weightClass || null,
        division: input.division === undefined ? undefined : input.division || null,
        result: input.result,
        notes: input.notes === undefined ? undefined : input.notes || null,
      });
      if (input.result === "gold" || input.result === "silver" || input.result === "bronze") {
        void (async () => {
          try {
            const [userIds, tournament] = await Promise.all([
              getNotifyUserIdsForMember(input.memberId),
              getTournamentById(input.tournamentId),
            ]);
            if (userIds.length === 0 || !tournament) return;
            sendPushNotifications(userIds, {
              title: `🎉 대회 결과`,
              body: `축하합니다! ${tournament.title}에서 ${resultKo(input.result)}을(를) 획득했습니다.`,
              data: {
                type: "tournament",
                tournamentId: input.tournamentId,
                memberId: input.memberId,
              },
            }).catch((err) => console.error("[Push] Tournament result notification failed:", err));
          } catch (err) {
            console.error("[Push] Tournament result lookup failed:", err);
          }
        })();
      }
      return { success: true };
    }),

  /** 참가자 해제 */
  removeParticipant: managerProcedure
    .input(z.object({ tournamentId: z.number(), memberId: z.number() }))
    .mutation(async ({ input }) => {
      await removeTournamentParticipant(input.tournamentId, input.memberId);
      return { success: true };
    }),
});

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  members: membersRouter,
  attendance: attendanceRouter,
  payments: paymentsRouter,
  announcements: announcementsRouter,
  promotions: promotionsRouter,
  dashboard: dashboardRouter,
  admin: adminRouter,
  memoHistory: memoHistoryRouter,
  managerTasks: managerTasksRouter,
  pushTokens: pushTokensRouter,
  tournaments: tournamentsRouter,
});

export type AppRouter = typeof appRouter;
