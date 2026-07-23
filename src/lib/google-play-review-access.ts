import type { AppUser, MockDatabase, UserRole } from "./domain.ts";

export const googlePlayReviewAccountPurpose = "google_play_review" as const;
export const googlePlayReviewBranchId = "branch-google-play-review";

export const googlePlayReviewUserIds = {
  admin: "user-google-play-review-admin",
  coach: "user-google-play-review-coach",
  guardian: "user-google-play-review-guardian",
  member: "user-google-play-review-member",
  owner: "user-google-play-review-owner",
} as const satisfies Record<UserRole, string>;

export const googlePlayReviewPhones = {
  admin: "01000009105",
  coach: "01000009103",
  guardian: "01000009102",
  member: "01000009101",
  owner: "01000009104",
} as const satisfies Record<UserRole, string>;

export const googlePlayReviewMemberIds = {
  adult: "member-google-play-review-adult",
  child: "member-google-play-review-child",
  guardian: "member-google-play-review-guardian",
} as const;

export function isGooglePlayReviewAccount(user: Pick<AppUser, "accountPurpose"> | null | undefined) {
  return user?.accountPurpose === googlePlayReviewAccountPurpose;
}

export function hasGlobalAdminDataAccess(user: Pick<AppUser, "accountPurpose" | "role">) {
  return user.role === "admin" && !isGooglePlayReviewAccount(user);
}

export function shouldBlockGooglePlayReviewAdminMutation(
  user: Pick<AppUser, "accountPurpose" | "role">,
  method: string,
) {
  const normalizedMethod = method.toUpperCase();
  const safeMethod = normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS";

  return isGooglePlayReviewAccount(user) &&
    user.role === "admin" &&
    !safeMethod;
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
    ["class-google-play-review-kids", { startsAt: at({ dayOffset: 0, hour: 16 }, now), endsAt: at({ dayOffset: 0, hour: 16, minute: 50 }, now) }],
    ["class-google-play-review-adult", { startsAt: at({ dayOffset: 0, hour: 20 }, now), endsAt: at({ dayOffset: 0, hour: 21 }, now) }],
    ["class-google-play-review-tomorrow", { startsAt: at({ dayOffset: 1, hour: 18 }, now), endsAt: at({ dayOffset: 1, hour: 18, minute: 50 }, now) }],
  ]);
  const attendanceTimes = new Map([
    ["attendance-google-play-review-child", at({ dayOffset: 0, hour: 16, minute: 4 }, now)],
    ["attendance-google-play-review-adult", at({ dayOffset: 0, hour: 20, minute: 6 }, now)],
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
      note.id === "note-google-play-review-progress"
        ? { ...note, createdAt: at({ dayOffset: -1, hour: 18 }, now) }
        : note,
    ),
    notices: db.notices.map((notice) =>
      notice.id === "notice-google-play-review"
        ? { ...notice, createdAt: at({ dayOffset: -1, hour: 12 }, now) }
        : notice,
    ),
    payments: db.payments.map((payment) => {
      if (payment.id === "payment-google-play-review-child") {
        return { ...payment, dueDate: dateOnly(20, now), expiresAt: dateOnly(35, now) };
      }
      if (payment.id === "payment-google-play-review-adult") {
        return { ...payment, dueDate: dateOnly(-2, now), expiresAt: dateOnly(5, now) };
      }
      if (payment.id === "payment-google-play-review-guardian") {
        return { ...payment, dueDate: dateOnly(5, now), expiresAt: dateOnly(12, now) };
      }
      return payment;
    }),
    promotions: db.promotions.map((promotion) =>
      promotion.id === "promotion-google-play-review-child"
        ? { ...promotion, examDate: dateOnly(14, now) }
        : promotion,
    ),
    tournaments: db.tournaments.map((tournament) =>
      tournament.id === "tournament-google-play-review"
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
