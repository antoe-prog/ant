import {
  getAllUsers,
  getExpiringSoonMembers,
  getManagerOperationsSummary,
  getManagerTaskReminderSummary,
  getMemberById,
  getTournamentWithParticipants,
  getUpcomingPromotions,
  getUpcomingTournaments,
  getUnpaidMembers,
} from "./db";
import { sendPushNotifications } from "./push";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS = new Set([0, 1, 3]);

let schedulerStarted = false;
const sentTodayKeys = new Set<string>();
let sentKeyDate = toDateKeyLocal(new Date());

function toDateKeyLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateKeyToLocalDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function calcDaysLeft(dateKey: string | null | undefined): number {
  if (!dateKey) return 999;
  const today = dateKeyToLocalDate(toDateKeyLocal(new Date()));
  const target = dateKeyToLocalDate(dateKey);
  return Math.ceil((target.getTime() - today.getTime()) / DAY_MS);
}

function oncePerDay(key: string): boolean {
  const today = toDateKeyLocal(new Date());
  if (sentKeyDate !== today) {
    sentTodayKeys.clear();
    sentKeyDate = today;
  }
  const dailyKey = `${today}:${key}`;
  if (sentTodayKeys.has(dailyKey)) return false;
  sentTodayKeys.add(dailyKey);
  return true;
}

function msUntilNextTime(hour: number, minute = 0): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleDailyJob(name: string, hour: number, minute: number, job: () => Promise<void>) {
  const waitMs = msUntilNextTime(hour, minute);
  console.log(`[Scheduler] ${name} scheduled - first run in ${Math.round(waitMs / 60000)} minutes`);
  setTimeout(() => {
    void job();
    setInterval(() => void job(), DAY_MS);
  }, waitMs);
}

function beltKo(rank: string | null | undefined) {
  switch (rank) {
    case "white":
      return "흰띠";
    case "yellow":
      return "노란띠";
    case "orange":
      return "주황띠";
    case "green":
      return "초록띠";
    case "blue":
      return "파란띠";
    case "brown":
      return "갈색띠";
    case "black":
      return "검은띠";
    default:
      return "띠";
  }
}

function daysLabel(daysLeft: number) {
  if (daysLeft === 0) return "오늘";
  if (daysLeft === 1) return "내일";
  return `${daysLeft}일 후`;
}

async function getManagerUserIds(): Promise<number[]> {
  const users = await getAllUsers();
  return users
    .filter((user) => user.role === "manager" || user.role === "admin")
    .map((user) => user.id);
}

function buildOperationsBody(summary: Awaited<ReturnType<typeof getManagerOperationsSummary>>) {
  const parts = [
    summary.totals.critical > 0 ? `긴급 ${summary.totals.critical}건` : "",
    summary.totals.warning > 0 ? `주의 ${summary.totals.warning}건` : "",
    summary.totals.info > 0 ? `확인 ${summary.totals.info}건` : "",
  ].filter(Boolean);
  const topTasks = summary.tasks.slice(0, 3).map((task) => task.title).join(", ");
  return `${parts.join(" · ")}${topTasks ? ` / ${topTasks}` : ""}`;
}

async function runManagerOperationsDigest() {
  try {
    const [managerIds, summary] = await Promise.all([
      getManagerUserIds(),
      getManagerOperationsSummary(),
    ]);
    if (managerIds.length === 0 || summary.totals.totalTasks === 0) {
      console.log("[Scheduler] manager operations digest skipped");
      return;
    }
    if (!oncePerDay("manager-operations-digest")) return;

    const result = await sendPushNotifications(managerIds, {
      title: `오늘 운영 체크 ${summary.totals.totalTasks}건`,
      body: buildOperationsBody(summary),
      data: {
        type: "manager_ops_daily",
        totalTasks: summary.totals.totalTasks,
        critical: summary.totals.critical,
        warning: summary.totals.warning,
      },
    });
    console.log(`[Scheduler] manager operations digest sent=${result.sent}, errors=${result.errors}`);
  } catch (err) {
    console.error("[Scheduler] manager operations digest failed:", err);
  }
}

async function runManagerTaskDueDigest() {
  try {
    const [managerIds, summary] = await Promise.all([
      getManagerUserIds(),
      getManagerTaskReminderSummary(),
    ]);
    if (managerIds.length === 0 || summary.dueCount === 0) {
      console.log("[Scheduler] manager task due digest skipped");
      return;
    }
    if (!oncePerDay("manager-task-due-digest")) return;

    const topTasks = summary.tasks.slice(0, 3).map((task) => task.title).join(", ");
    const result = await sendPushNotifications(managerIds, {
      title: `운영 할 일 마감 ${summary.dueCount}건`,
      body: `${summary.highDueCount > 0 ? `중요 ${summary.highDueCount}건 · ` : ""}${topTasks || "마감 항목을 확인해 주세요."}`,
      data: {
        type: "manager_task_due",
        dueCount: summary.dueCount,
        highDueCount: summary.highDueCount,
      },
    });
    console.log(`[Scheduler] manager task due digest sent=${result.sent}, errors=${result.errors}`);
  } catch (err) {
    console.error("[Scheduler] manager task due digest failed:", err);
  }
}

async function runD7PaymentNotifications() {
  try {
    const targets = (await getExpiringSoonMembers(7)).filter((member: any) => {
      const days = calcDaysLeft(member.nextPaymentDate);
      return days >= 2 && days <= 7;
    });
    if (targets.length === 0) {
      console.log("[Scheduler] D-7 payment notifications skipped");
      return;
    }

    let sent = 0;
    for (const member of targets) {
      if (!member.userId) continue;
      const daysLeft = calcDaysLeft(member.nextPaymentDate);
      if (!oncePerDay(`payment-expiring:${member.id}:${daysLeft}`)) continue;
      const result = await sendPushNotifications([member.userId], {
        title: "등록 기간 만료 안내",
        body: `등록 기간이 ${daysLeft}일 후(${member.nextPaymentDate}) 만료됩니다. 갱신을 준비해 주세요.`,
        data: {
          type: "payment_expiry",
          memberId: member.id,
          nextPaymentDate: member.nextPaymentDate,
          daysLeft,
        },
      });
      sent += result.sent;
    }
    console.log(`[Scheduler] D-7 payment notifications sent=${sent}`);
  } catch (err) {
    console.error("[Scheduler] D-7 payment notifications failed:", err);
  }
}

async function runD1PaymentNotifications() {
  try {
    const targets = (await getExpiringSoonMembers(1)).filter((member: any) => {
      const days = calcDaysLeft(member.nextPaymentDate);
      return days >= 0 && days <= 1;
    });
    if (targets.length === 0) {
      console.log("[Scheduler] D-1 payment notifications skipped");
      return;
    }

    let sent = 0;
    for (const member of targets) {
      if (!member.userId) continue;
      const daysLeft = calcDaysLeft(member.nextPaymentDate);
      if (!oncePerDay(`payment-urgent:${member.id}:${daysLeft}`)) continue;
      const isToday = daysLeft === 0;
      const result = await sendPushNotifications([member.userId], {
        title: isToday ? "오늘 등록 기간이 만료됩니다" : "내일 등록 기간이 만료됩니다",
        body: isToday
          ? `오늘(${member.nextPaymentDate}) 등록 기간이 끝납니다. 도장에서 갱신 일정을 확인해 주세요.`
          : `내일(${member.nextPaymentDate}) 등록 기간이 끝납니다. 갱신을 준비해 주세요.`,
        data: {
          type: "payment_expiry",
          memberId: member.id,
          nextPaymentDate: member.nextPaymentDate,
          daysLeft,
          urgent: true,
        },
      });
      sent += result.sent;
    }
    console.log(`[Scheduler] D-1 payment notifications sent=${sent}`);
  } catch (err) {
    console.error("[Scheduler] D-1 payment notifications failed:", err);
  }
}

async function runUnpaidOverdueNotifications() {
  try {
    const unpaid = await getUnpaidMembers();
    if (unpaid.length === 0) {
      console.log("[Scheduler] overdue payment notifications skipped");
      return;
    }

    let sent = 0;
    for (const member of unpaid as { id: number; name: string; userId: number | null; nextPaymentDate: string | null }[]) {
      if (!member.userId) continue;
      if (!oncePerDay(`payment-overdue:${member.id}`)) continue;
      const result = await sendPushNotifications([member.userId], {
        title: "납부 확인 안내",
        body: `${member.name}님의 등록/납부 기한이 지났습니다. 도장에서 납부 일정을 확인해 주세요.`,
        data: {
          type: "payment_overdue",
          memberId: member.id,
          nextPaymentDate: member.nextPaymentDate ?? "",
        },
      });
      sent += result.sent;
    }
    console.log(`[Scheduler] overdue payment notifications sent=${sent}`);
  } catch (err) {
    console.error("[Scheduler] overdue payment notifications failed:", err);
  }
}

async function runPromotionReminderNotifications() {
  try {
    const promotions = await getUpcomingPromotions(3);
    let sent = 0;
    for (const promotion of promotions) {
      const daysLeft = calcDaysLeft(promotion.examDate);
      if (!REMINDER_DAYS.has(daysLeft)) continue;
      const member = await getMemberById(promotion.memberId);
      if (!member?.userId) continue;
      if (!oncePerDay(`promotion:${promotion.id}:${member.userId}:${daysLeft}`)) continue;

      const result = await sendPushNotifications([member.userId], {
        title: `승급 심사 ${daysLabel(daysLeft)}`,
        body: `${promotion.examDate} ${beltKo(promotion.currentBelt)} → ${beltKo(promotion.targetBelt)} 심사가 예정되어 있습니다.`,
        data: {
          type: "promotion_reminder",
          id: promotion.id,
          memberId: promotion.memberId,
          examDate: promotion.examDate,
          daysLeft,
        },
      });
      sent += result.sent;
    }
    console.log(`[Scheduler] promotion reminders sent=${sent}`);
  } catch (err) {
    console.error("[Scheduler] promotion reminders failed:", err);
  }
}

async function runTournamentReminderNotifications() {
  try {
    const tournaments = await getUpcomingTournaments(3);
    let sent = 0;

    for (const tournament of tournaments) {
      const daysLeft = calcDaysLeft(tournament.eventDate);
      if (!REMINDER_DAYS.has(daysLeft)) continue;

      const detail = await getTournamentWithParticipants(tournament.id);
      const participantIds = detail?.participants?.map((participant) => participant.memberId) ?? [];
      const recipientIds = new Set<number>();

      for (const memberId of participantIds) {
        const member = await getMemberById(memberId);
        if (member?.userId) recipientIds.add(member.userId);
      }

      if (recipientIds.size === 0) continue;
      if (!oncePerDay(`tournament:${tournament.id}:${daysLeft}`)) continue;

      const result = await sendPushNotifications([...recipientIds], {
        title: `대회 일정 ${daysLabel(daysLeft)}`,
        body: `${tournament.eventDate} ${tournament.title}${tournament.location ? ` · ${tournament.location}` : ""}`,
        data: {
          type: "tournament_reminder",
          id: tournament.id,
          eventDate: tournament.eventDate,
          daysLeft,
        },
      });
      sent += result.sent;
    }

    console.log(`[Scheduler] tournament reminders sent=${sent}`);
  } catch (err) {
    console.error("[Scheduler] tournament reminders failed:", err);
  }
}

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  scheduleDailyJob("manager operations digest", 8, 30, runManagerOperationsDigest);
  scheduleDailyJob("manager task due digest", 8, 45, runManagerTaskDueDigest);
  scheduleDailyJob("D-1 payment notifications", 9, 0, runD1PaymentNotifications);
  scheduleDailyJob("promotion reminders", 9, 20, runPromotionReminderNotifications);
  scheduleDailyJob("tournament reminders", 9, 40, runTournamentReminderNotifications);
  scheduleDailyJob("D-7 payment notifications", 10, 0, runD7PaymentNotifications);
  scheduleDailyJob("overdue payment notifications", 11, 0, runUnpaidOverdueNotifications);
}
