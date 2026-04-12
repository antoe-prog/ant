import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { suggestNextPaymentDate } from "../lib/judo-utils";
import {
  checkAttendance,
  getAttendanceStatsByMember,
  createAnnouncement,
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
  getDashboardStats,
  getMemberById,
  getMemberActivityTimeline,
  getMemberOverviewSnapshot,
  getMemberByUserId,
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
  seedDemoData,
  togglePromotionChecklistItem,
  updateAnnouncement,
  updateMember,
  updatePromotion,
  updateUserRole,
  getAllUsers,
  getAdminCount,
  linkMemberToUser,
  unlinkMemberFromUser,
  createActivityLog,
  getActivityLogs,
  createInviteToken,
  getInviteToken,
  useInviteToken,
  getInviteTokensByCreator,
  getMemoHistory,
  saveMemoHistory,
  deleteMemoHistoryItem,
  clearMemoHistory,
  upsertPushToken,
  deletePushToken,
} from "./db";
import { storagePut } from "./storage";
import { sendPushNotifications } from "./push";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, authedProcedure, managerProcedure, publicProcedure, router } from "./_core/trpc";

const authRouter = router({
  me: authedProcedure.query(async ({ ctx }) => {
    return { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role, avatarUrl: ctx.user.avatarUrl };
  }),
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
});

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
  myProfile: authedProcedure.query(async ({ ctx }) => getMemberByUserId(ctx.user.id)),
  create: managerProcedure.input(z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    birthDate: z.string().optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    beltRank: z.enum(["white", "yellow", "orange", "green", "blue", "brown", "black"]).default("white"),
    beltDegree: z.number().int().min(1).max(9).default(1),
    status: z.enum(["active", "suspended", "withdrawn"]).default("active"),
    joinDate: z.string(),
    monthlyFee: z.number().int().min(0).default(0),
    nextPaymentDate: z.string().optional(),
    emergencyContact: z.string().optional(),
    notes: z.string().optional(),
  })).mutation(async ({ input }) => {
    const id = await createMember(input);
    return { id };
  }),
  update: managerProcedure.input(z.object({
    id: z.number(),
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    birthDate: z.string().optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    beltRank: z.enum(["white", "yellow", "orange", "green", "blue", "brown", "black"]).optional(),
    beltDegree: z.number().int().min(1).max(9).optional(),
    status: z.enum(["active", "suspended", "withdrawn"]).optional(),
    monthlyFee: z.number().int().min(0).optional(),
    nextPaymentDate: z.string().nullable().optional(),
    emergencyContact: z.string().optional(),
    notes: z.string().optional(),
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
  myPromotions: authedProcedure.query(async ({ ctx }) => {
    const member = await getMemberByUserId(ctx.user.id);
    if (!member) return [];
    return getPromotionsByMember(member.id);
  }),
  // 회원 본인 납부 이력 조회
  myPayments: authedProcedure.query(async ({ ctx }) => {
    const member = await getMemberByUserId(ctx.user.id);
    if (!member) return [];
    return getPaymentsByMember(member.id);
  }),
  // 회원 본인 월별 출석 조회
  myAttendanceByMonth: authedProcedure.input(z.object({ year: z.number(), month: z.number() })).query(async ({ ctx, input }) => {
    const member = await getMemberByUserId(ctx.user.id);
    if (!member) return [];
    return getAttendanceByMemberAndMonth(member.id, input.year, input.month);
  }),
  // 회원 본인 전체 출석 이력 (달력용)
  myAttendanceAll: authedProcedure.query(async ({ ctx }) => {
    const member = await getMemberByUserId(ctx.user.id);
    if (!member) return [];
    return getAttendanceByMember(member.id);
  }),
  /** 회원 본인 앞으로의 일정 (승급 심사 예정·납부 예정일) */
  mySchedule: authedProcedure
    .input(z.object({ days: z.number().min(7).max(365).optional() }))
    .query(async ({ ctx, input }) => {
      const member = await getMemberByUserId(ctx.user.id);
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
    attendanceDate: z.string(),
    type: z.enum(["regular", "makeup", "trial"]).default("regular"),
    checkResult: z.enum(["present", "late", "absent"]).default("present"),
    notes: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await checkAttendance({
      memberId: input.memberId,
      attendanceDate: input.attendanceDate,
      checkInTime: input.checkResult === "absent" ? null : new Date(),
      type: input.type,
      checkResult: input.checkResult,
      recordedBy: ctx.user.id,
      notes: input.notes,
    });
    if (input.checkResult !== "absent") {
      getMemberById(input.memberId).then((member) => {
        if (member?.userId) {
          const typeLabel = input.type === "regular" ? "일반" : input.type === "makeup" ? "보강" : "체험";
          const resultLabel = input.checkResult === "late" ? "지각" : "출석";
          sendPushNotifications([member.userId], {
            title: "회원님, 오늘 출석이 등록되었습니다! 🏆",
            body: `${input.attendanceDate} ${typeLabel} ${resultLabel}이(가) 기록되었습니다.`,
            data: { type: "attendance", memberId: input.memberId, attendanceDate: input.attendanceDate },
          });
        }
      }).catch(() => {});
    }
    return { id };
  }),
  delete: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await deleteAttendance(input.id);
    return { success: true };
  }),
  // 일괄 출석 체크
  checkBulk: managerProcedure.input(z.object({
    memberIds: z.array(z.number()).min(1),
    attendanceDate: z.string(),
    type: z.enum(["regular", "makeup", "trial"]).default("regular"),
    checkResult: z.enum(["present", "late", "absent"]).default("present"),
    notes: z.string().optional(),
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
      Promise.all(input.memberIds.map(memberId => getMemberById(memberId))).then((memberList) => {
        const userIds = memberList.filter(m => m?.userId).map(m => m!.userId!);
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
    const today = new Date().toISOString().split("T")[0];
    const id = await checkAttendance({
      memberId: input.memberId,
      attendanceDate: today,
      checkInTime: new Date(),
      type: input.type,
      checkResult: "present",
      recordedBy: ctx.user.id,
      notes: "QR 코드 스캔",
    });
    // QR 출석 후 해당 회원에게 푸시 알림 발송 (비동기)
    getMemberById(input.memberId).then((member) => {
      if (member?.userId) {
        sendPushNotifications([member.userId], {
          title: "QR 출석 완료! 📱",
          body: `${today} 출석이 등록되었습니다.`,
          data: { type: "attendance", memberId: input.memberId, attendanceDate: today },
        });
      }
    }).catch(() => {});
    return { id, attendanceDate: today };
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
    amount: z.number().int().min(0),
    method: z.enum(["cash", "card", "transfer"]).default("cash"),
    periodStart: z.string().optional(),
    periodEnd: z.string().optional(),
    notes: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await createPayment({ memberId: input.memberId, amount: input.amount, paidAt: new Date(), method: input.method, periodStart: (input.periodStart ?? null) as string | null, periodEnd: (input.periodEnd ?? null) as string | null, notes: input.notes, recordedBy: ctx.user.id });
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    const nextPaymentDateStr = nextDate.toISOString().split("T")[0];
    // nextPaymentDate를 한 달 뒤로 갱신 → 스케줄러의 만료 알림 대상에서 자동 제외됨
    await updateMember(input.memberId, { nextPaymentDate: nextPaymentDateStr });
    // 납부 완료 즉시 회원에게 확인 알림 발송 (비동기)
    getMemberById(input.memberId).then((member) => {
      if (member?.userId) {
        const methodLabel: Record<string, string> = { cash: "현금", card: "카드", transfer: "계좌이체" };
        const amountFormatted = input.amount.toLocaleString("ko-KR");
        sendPushNotifications([member.userId], {
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
    }).catch((err) => console.error("[Push] Announcement notification failed:", err));
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
  monthlyStats: managerProcedure.query(async () => {
    // 최근 6개월 매월 매출 + 출석수 반환
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
      results.push({ year, month, revenue, attendance: totalAttendance });
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
    examDate: z.string(),
    currentBelt: z.enum(["white", "yellow", "orange", "green", "blue", "brown", "black"]),
    targetBelt: z.enum(["white", "yellow", "orange", "green", "blue", "brown", "black"]),
    result: z.enum(["pending", "passed", "failed"]).default("pending"),
    notes: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const id = await createPromotion({ ...input, recordedBy: ctx.user.id });
    return { id };
  }),
  updateResult: managerProcedure.input(z.object({
    id: z.number(),
    result: z.enum(["pending", "passed", "failed"]),
    notes: z.string().optional(),
  })).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await updatePromotion(id, data);
    // 합격 시 회원 띠 자동 업그레이드
    if (data.result === "passed") {
      const all = await getPromotions();
      const p = all.find(x => x.id === id);
      if (p) await updateMember(p.memberId, { beltRank: p.targetBelt });
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
  activityLogs: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).optional(),
      action: z.string().optional(),
    }))
    .query(async ({ input }) => getActivityLogs(input.limit ?? 150, input.action)),
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
  pushTokens: pushTokensRouter,
});

export type AppRouter = typeof appRouter;
