import type { MockDatabase } from "../lib/domain";

type TimeSpec = {
  dayOffset: number;
  hour: number;
  minute?: number;
};

type ClassScheduleSpec = {
  end: TimeSpec;
  start: TimeSpec;
};

const seededDemoUserIds = ["user-admin", "user-owner", "user-coach", "user-guardian", "user-member"];

const seededClassSchedules: Record<string, ClassScheduleSpec> = {
  "class-adult-night": {
    end: { dayOffset: 0, hour: 21, minute: 20 },
    start: { dayOffset: 0, hour: 20 },
  },
  "class-kids-am": {
    end: { dayOffset: 0, hour: 10, minute: 50 },
    start: { dayOffset: 0, hour: 10 },
  },
  "class-kids-tomorrow": {
    end: { dayOffset: 1, hour: 16, minute: 50 },
    start: { dayOffset: 1, hour: 16 },
  },
  "class-songpa-kids": {
    end: { dayOffset: 0, hour: 15, minute: 50 },
    start: { dayOffset: 0, hour: 15 },
  },
  "class-teen-pm": {
    end: { dayOffset: 0, hour: 17, minute: 50 },
    start: { dayOffset: 0, hour: 17 },
  },
};

const seededAttendanceTimes: Record<string, TimeSpec> = {
  "att-jun-am": { dayOffset: 0, hour: 10, minute: 8 },
  "att-minjae-night": { dayOffset: 0, hour: 20, minute: 4 },
  "att-seo-am": { dayOffset: 0, hour: 10, minute: 15 },
};

const seededCounselingNoteTimes: Record<string, TimeSpec> = {
  "note-jun-caution": { dayOffset: -2, hour: 17, minute: 20 },
  "note-jun-progress": { dayOffset: -1, hour: 18, minute: 10 },
  "note-minjae-staff": { dayOffset: -3, hour: 15, minute: 30 },
  "note-seo-progress": { dayOffset: -1, hour: 18, minute: 5 },
};

const seededPaymentDates: Record<string, { dueDateOffset: number; expiresAtOffset: number; historyDayOffset: number }> = {
  "pay-harin": { dueDateOffset: 25, expiresAtOffset: 40, historyDayOffset: -8 },
  "pay-jun": { dueDateOffset: 20, expiresAtOffset: 35, historyDayOffset: -10 },
  "pay-minjae": { dueDateOffset: -2, expiresAtOffset: 2, historyDayOffset: -32 },
  "pay-seo": { dueDateOffset: 5, expiresAtOffset: 6, historyDayOffset: -25 },
  "pay-yuna": { dueDateOffset: 1, expiresAtOffset: 7, historyDayOffset: -1 },
};

const seededNoticeTimes: Record<string, TimeSpec> = {
  "notice-payment": { dayOffset: -2, hour: 16 },
  "notice-promotion-result-jun": { dayOffset: -1, hour: 14 },
  "notice-songpa": { dayOffset: -1, hour: 10 },
  "notice-summer": { dayOffset: -1, hour: 12 },
  "notice-youth-tournament": { dayOffset: -1, hour: 15 },
};

const seededNoticeCopy: Record<string, Pick<MockDatabase["notices"][number], "body" | "title">> = {
  "notice-promotion-result-jun": {
    body: "노란띠 대상자는 낙법과 기본 잡기 기준을 통과했습니다. 보완 항목은 코치가 다음 피드백으로 안내합니다.",
    title: "승급 심사 결과 안내",
  },
  "notice-summer": {
    body: "심사 대상자는 출석률과 기본기 체크 항목을 담당 코치와 확인해 주세요.",
    title: "승급 심사 준비 안내",
  },
};

function relativeDateTime({ dayOffset, hour, minute = 0 }: TimeSpec) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

function relativeDate(dayOffset: number) {
  return relativeDateTime({ dayOffset, hour: 9 }).slice(0, 10);
}

function shouldRollSeededDemoDates(db: MockDatabase) {
  if (process.env.NODE_ENV === "production" || process.env.FINAL_JUDO_ROLL_DEMO_DATES === "0") {
    return false;
  }

  return seededDemoUserIds.every((userId) => db.users.some((user) => user.id === userId));
}

export function rollSeededDemoDates(db: MockDatabase): MockDatabase {
  if (!shouldRollSeededDemoDates(db)) {
    return db;
  }

  return {
    ...db,
    auditLogs: db.auditLogs.map((log) =>
      log.message === "감사 로그를 조회했습니다." ? { ...log, message: "변경 기록을 조회했습니다." } : log,
    ),
    attendance: db.attendance.map((record) => {
      const confirmedAt = seededAttendanceTimes[record.id];
      return confirmedAt ? { ...record, confirmedAt: relativeDateTime(confirmedAt) } : record;
    }),
    classes: db.classes.map((session) => {
      const schedule = seededClassSchedules[session.id];
      return schedule
        ? {
            ...session,
            endsAt: relativeDateTime(schedule.end),
            startsAt: relativeDateTime(schedule.start),
          }
        : session;
    }),
    counselingNotes: db.counselingNotes.map((note) => {
      const createdAt = seededCounselingNoteTimes[note.id];
      return createdAt ? { ...note, createdAt: relativeDateTime(createdAt) } : note;
    }),
    notices: db.notices.map((notice) => {
      const createdAt = seededNoticeTimes[notice.id];
      const copy = seededNoticeCopy[notice.id];
      return {
        ...notice,
        ...(copy ?? {}),
        ...(createdAt ? { createdAt: relativeDateTime(createdAt) } : {}),
      };
    }),
    payments: db.payments.map((payment) => {
      const dateSpec = seededPaymentDates[payment.id];
      return dateSpec
        ? {
            ...payment,
            dueDate: relativeDate(dateSpec.dueDateOffset),
            expiresAt: relativeDate(dateSpec.expiresAtOffset),
            statusHistory: (payment.statusHistory ?? []).map((history) => ({
              ...history,
              changedAt: relativeDateTime({ dayOffset: dateSpec.historyDayOffset, hour: 12 }),
            })),
          }
        : payment;
    }),
  };
}
