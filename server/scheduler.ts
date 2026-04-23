import { getExpiringSoonMembers, getUnpaidMembers } from "./db";
import { sendPushNotifications } from "./push";

/**
 * 납부 만료 알림 스케줄러
 * - 매일 오전 9시: D-1 회원에게 긴급 알림
 * - 매일 오전 10시: D-7 이내 회원에게 만료 안내 알림
 * - 매일 오전 11시: 미납(기한 경과) 회원에게 연체 안내 푸시 (계정 연결된 회원만)
 */

let schedulerStarted = false;

/** 오늘 날짜 기준 남은 일수 계산 */
function calcDaysLeft(nextPaymentDate: string | null | undefined): number {
  if (!nextPaymentDate) return 999;
  const today = new Date().toISOString().split("T")[0];
  return Math.ceil(
    (new Date(nextPaymentDate).getTime() - new Date(today).getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

/** D-7 알림: 만료 2~7일 남은 회원 (D-1은 별도 처리) */
async function runD7Notifications() {
  try {
    const expiringMembers = await getExpiringSoonMembers(7);
    // D-1은 별도 알림이 있으므로 2~7일 남은 회원만 처리
    const targets = expiringMembers.filter((m: any) => {
      const days = calcDaysLeft(m.nextPaymentDate);
      return days >= 2 && days <= 7;
    });

    if (targets.length === 0) {
      console.log("[Scheduler] D-7 알림 대상 없음");
      return;
    }

    let sent = 0;
    for (const member of targets) {
      if (!member.userId) continue;
      const daysLeft = calcDaysLeft(member.nextPaymentDate);
      await sendPushNotifications([member.userId], {
        title: "납부 만료 안내 💳",
        body: `납부 기한이 ${daysLeft}일 후(${member.nextPaymentDate}) 만료됩니다. 미리 갱신해 주세요.`,
        data: {
          type: "payment_expiry",
          memberId: member.id,
          nextPaymentDate: member.nextPaymentDate,
          daysLeft,
        },
      });
      sent++;
    }
    console.log(`[Scheduler] D-7 납부 만료 알림 발송 완료: ${sent}명`);
  } catch (err) {
    console.error("[Scheduler] D-7 알림 실패:", err);
  }
}

/** D-1 긴급 알림: 만료 1일 전 또는 당일 회원 */
async function runD1UrgentNotifications() {
  try {
    // 오늘~내일 만료 회원 조회 (days=1)
    const expiringMembers = await getExpiringSoonMembers(1);
    const targets = expiringMembers.filter((m: any) => {
      const days = calcDaysLeft(m.nextPaymentDate);
      return days >= 0 && days <= 1;
    });

    if (targets.length === 0) {
      console.log("[Scheduler] D-1 긴급 알림 대상 없음");
      return;
    }

    let sent = 0;
    for (const member of targets) {
      if (!member.userId) continue;
      const daysLeft = calcDaysLeft(member.nextPaymentDate);
      const isToday = daysLeft === 0;

      await sendPushNotifications([member.userId], {
        title: isToday ? "⚠️ 오늘 납부 기한 만료!" : "⚠️ 내일 납부 기한 만료!",
        body: isToday
          ? `오늘(${member.nextPaymentDate})이 납부 마감일입니다. 지금 바로 갱신해 주세요!`
          : `내일(${member.nextPaymentDate})이 납부 마감일입니다. 빠른 갱신 부탁드립니다.`,
        data: {
          type: "payment_expiry",
          memberId: member.id,
          nextPaymentDate: member.nextPaymentDate,
          daysLeft,
          urgent: true,
        },
      });
      sent++;
    }
    console.log(`[Scheduler] D-1 긴급 납부 알림 발송 완료: ${sent}명`);
  } catch (err) {
    console.error("[Scheduler] D-1 긴급 알림 실패:", err);
  }
}

/** 미납(납부일 경과) 회원에게 일 1회 알림 */
async function runUnpaidOverdueNotifications() {
  try {
    const unpaid = await getUnpaidMembers();
    if (unpaid.length === 0) {
      console.log("[Scheduler] 미납(연체) 알림 대상 없음");
      return;
    }
    let sent = 0;
    for (const member of unpaid as { id: number; name: string; userId: number | null; nextPaymentDate: string | null }[]) {
      if (!member.userId) continue;
      await sendPushNotifications([member.userId], {
        title: "회비 납부 안내 💳",
        body: `${member.name}님, 납부 기한이 지났습니다. 앱에서 납부 일정을 확인해 주세요.`,
        data: {
          type: "payment_overdue",
          memberId: member.id,
          nextPaymentDate: member.nextPaymentDate ?? "",
        },
      });
      sent++;
    }
    console.log(`[Scheduler] 미납(연체) 푸시 알림 발송 완료: ${sent}명`);
  } catch (err) {
    console.error("[Scheduler] 미납 알림 실패:", err);
  }
}

/** 다음 특정 시각(hour, minute)까지 남은 ms 계산 */
function msUntilNextTime(hour: number, minute = 0): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * 스케줄러 시작 - 서버 시작 시 1회 호출
 * - 매일 오전 9시: D-1 긴급 알림
 * - 매일 오전 10시: D-7 만료 안내 알림
 * - 매일 오전 11시: 미납(연체) 알림
 */
export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // D-1 긴급 알림: 매일 오전 9시
  const msUntil9am = msUntilNextTime(9, 0);
  console.log(
    `[Scheduler] D-1 긴급 알림 스케줄러 시작 - 첫 실행까지 ${Math.round(msUntil9am / 1000 / 60)}분 대기`
  );
  setTimeout(() => {
    runD1UrgentNotifications();
    setInterval(runD1UrgentNotifications, 24 * 60 * 60 * 1000);
  }, msUntil9am);

  // D-7 만료 안내 알림: 매일 오전 10시
  const msUntil10am = msUntilNextTime(10, 0);
  console.log(
    `[Scheduler] D-7 만료 알림 스케줄러 시작 - 첫 실행까지 ${Math.round(msUntil10am / 1000 / 60)}분 대기`
  );
  setTimeout(() => {
    runD7Notifications();
    setInterval(runD7Notifications, 24 * 60 * 60 * 1000);
  }, msUntil10am);

  const msUntil11am = msUntilNextTime(11, 0);
  console.log(
    `[Scheduler] 미납(연체) 알림 스케줄러 시작 - 첫 실행까지 ${Math.round(msUntil11am / 1000 / 60)}분 대기`
  );
  setTimeout(() => {
    runUnpaidOverdueNotifications();
    setInterval(runUnpaidOverdueNotifications, 24 * 60 * 60 * 1000);
  }, msUntil11am);
}
