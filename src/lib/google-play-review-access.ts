import type { Branch, MockDatabase, UserRole } from "./domain.ts";

export const googlePlayReviewBranchId = "branch-demo-gangseo-central";

export const googlePlayReviewUserIds = {
  admin: "user-demo-gangseo-admin",
  coach: "user-demo-gangseo-coach",
  guardian: "user-demo-gangseo-guardian",
  member: "user-demo-gangseo-member",
  owner: "user-demo-gangseo-owner",
} as const satisfies Record<UserRole, string>;

export const googlePlayReviewPhones = {
  admin: "01000009105",
  coach: "01000009103",
  guardian: "01000009102",
  member: "01000009101",
  owner: "01000009104",
} as const satisfies Record<UserRole, string>;

export const googlePlayReviewMemberIds = {
  adult: "member-demo-gangseo-adult",
  child: "member-demo-gangseo-child",
  guardian: "member-demo-gangseo-guardian",
} as const;

export function isPublicSignupBranch(branch: Pick<Branch, "dataMode" | "status">) {
  return branch.status !== "inactive" && branch.dataMode !== "demo";
}

type RelativeDateTime = {
  dayOffset: number;
  hour: number;
  minute?: number;
};

function at({ dayOffset, hour, minute = 0 }: RelativeDateTime, now: Date) {
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString();
}

function dateOnly(dayOffset: number, now: Date) {
  return at({ dayOffset, hour: 9 }, now).slice(0, 10);
}

export function rollGooglePlayReviewDates(db: MockDatabase, now = new Date()): MockDatabase {
  if (!db.branches.some((branch) => branch.id === googlePlayReviewBranchId)) {
    return db;
  }

  const classTimes = new Map([
    ["class-demo-gangseo-kids", { startsAt: at({ dayOffset: 0, hour: 16 }, now), endsAt: at({ dayOffset: 0, hour: 16, minute: 50 }, now) }],
    ["class-demo-gangseo-adult", { startsAt: at({ dayOffset: 0, hour: 20 }, now), endsAt: at({ dayOffset: 0, hour: 21 }, now) }],
    ["class-demo-gangseo-tomorrow", { startsAt: at({ dayOffset: 1, hour: 18 }, now), endsAt: at({ dayOffset: 1, hour: 18, minute: 50 }, now) }],
  ]);
  const attendanceTimes = new Map([
    ["attendance-demo-gangseo-child", at({ dayOffset: 0, hour: 16, minute: 4 }, now)],
    ["attendance-demo-gangseo-adult", at({ dayOffset: 0, hour: 20, minute: 6 }, now)],
  ]);

  return {
    ...db,
    attendance: db.attendance.map((record) => {
      const confirmedAt = attendanceTimes.get(record.id);
      return confirmedAt ? { ...record, confirmedAt } : record;
    }),
    classes: db.classes.map((session) => {
      const times = classTimes.get(session.id);
      return times ? { ...session, ...times } : session;
    }),
    counselingNotes: db.counselingNotes.map((note) =>
      note.id === "note-demo-gangseo-progress"
        ? { ...note, createdAt: at({ dayOffset: -1, hour: 18 }, now) }
        : note,
    ),
    notices: db.notices.map((notice) =>
      notice.id === "notice-demo-gangseo-training"
        ? { ...notice, createdAt: at({ dayOffset: -1, hour: 12 }, now) }
        : notice,
    ),
    payments: db.payments.map((payment) => {
      if (payment.id === "payment-demo-gangseo-child") {
        return { ...payment, dueDate: dateOnly(20, now), expiresAt: dateOnly(35, now) };
      }
      if (payment.id === "payment-demo-gangseo-adult") {
        return { ...payment, dueDate: dateOnly(-2, now), expiresAt: dateOnly(5, now) };
      }
      if (payment.id === "payment-demo-gangseo-guardian") {
        return { ...payment, dueDate: dateOnly(5, now), expiresAt: dateOnly(12, now) };
      }
      return payment;
    }),
    promotions: db.promotions.map((promotion) =>
      promotion.id === "promotion-demo-gangseo-child"
        ? { ...promotion, examDate: dateOnly(14, now) }
        : promotion,
    ),
    tournaments: db.tournaments.map((tournament) =>
      tournament.id === "tournament-demo-gangseo-summer"
        ? {
            ...tournament,
            eventDate: dateOnly(30, now),
            registrationDeadline: dateOnly(14, now),
            updatedAt: at({ dayOffset: -1, hour: 11 }, now),
          }
        : tournament,
    ),
  };
}
