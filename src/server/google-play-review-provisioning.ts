import { randomBytes } from "node:crypto";
import type {
  AppUser,
  AttendanceRecord,
  AuditLog,
  BeltPromotion,
  Branch,
  ClassSession,
  CounselingNote,
  Member,
  MockDatabase,
  Notice,
  Payment,
  Tournament,
  UserRole,
} from "../lib/domain.ts";
import { userRoles } from "../lib/domain.ts";
import {
  googlePlayReviewAccountPurpose,
  googlePlayReviewBranchId,
  googlePlayReviewMemberIds,
  googlePlayReviewPhones,
  googlePlayReviewUserIds,
  rollGooglePlayReviewDates,
} from "../lib/google-play-review-access.ts";
import { createRandomPasswordHash } from "./auth-password.ts";

export type GooglePlayReviewPasswords = Record<UserRole, string>;

export type GooglePlayReviewConsoleEntry = {
  name: string;
  otherAccessInformation: string;
  password: string;
  role: UserRole;
  username: string;
};

export function createGooglePlayReviewPasswords(): GooglePlayReviewPasswords {
  return Object.fromEntries(
    userRoles.map((role) => [
      role,
      `FJ-Play-${randomBytes(8).toString("hex")}-${randomBytes(8).toString("hex")}`,
    ]),
  ) as GooglePlayReviewPasswords;
}

const roleNames: Record<UserRole, string> = {
  admin: "System Admin",
  coach: "Coach",
  guardian: "Guardian",
  member: "Member",
  owner: "Branch Owner",
};

function at(now: Date, dayOffset: number, hour: number, minute = 0) {
  const value = new Date(now);
  value.setHours(hour, minute, 0, 0);
  value.setDate(value.getDate() + dayOffset);
  return value.toISOString();
}

function dateOnly(now: Date, dayOffset: number) {
  return at(now, dayOffset, 9).slice(0, 10);
}

function replaceById<T extends { id: string }>(current: T[], replacements: T[]) {
  const replacementIds = new Set(replacements.map((item) => item.id));
  return [...replacements, ...current.filter((item) => !replacementIds.has(item.id))];
}

function assertOwnedReplacementIds<T extends { id: string }>(
  collectionName: string,
  current: T[],
  replacements: T[],
  isReviewOwned: (item: T) => boolean,
) {
  const replacementIds = new Set(replacements.map((item) => item.id));
  const collision = current.find((item) => replacementIds.has(item.id) && !isReviewOwned(item));

  if (collision) {
    throw new Error(`Refusing to replace non-review ${collectionName} data with ID ${collision.id}.`);
  }
}

function assertPasswords(passwords: GooglePlayReviewPasswords) {
  for (const role of Object.keys(googlePlayReviewUserIds) as UserRole[]) {
    const password = passwords[role];

    if (typeof password !== "string" || password.length < 16 || password.length > 100) {
      throw new Error(`Google Play review password for ${role} must contain 16 to 100 characters.`);
    }
  }
}

export function createGooglePlayReviewConsoleEntries(
  passwords: GooglePlayReviewPasswords,
): GooglePlayReviewConsoleEntry[] {
  assertPasswords(passwords);

  return (Object.keys(googlePlayReviewUserIds) as UserRole[]).map((role) => {
    const roleName = roleNames[role];
    const roleDetail = role === "guardian"
      ? "The account includes a synthetic adult profile and one synthetic child."
      : role === "coach"
        ? "The account includes synthetic classes, members, and attendance records."
        : role === "owner"
          ? "The account includes synthetic branch operations, payments, and notices."
          : role === "admin"
            ? "The account provides a read-only system administration view of synthetic review data."
            : "The account includes synthetic classes, attendance, payments, and notices.";
    const otherAccessInformation = [
      "Open the app and sign in with the phone number and password above.",
      "No SMS, OTP, QR code, subscription, location restriction, or additional setup is required.",
      `${roleDetail} Please do not change the password.`,
    ].join(" ");

    if (otherAccessInformation.length > 500) {
      throw new Error(`Google Play review instructions for ${role} exceed 500 characters.`);
    }

    return {
      name: `Final Judo - ${roleName} Review Account`,
      otherAccessInformation,
      password: passwords[role],
      role,
      username: googlePlayReviewPhones[role],
    };
  });
}

export function provisionGooglePlayReviewAccess(
  db: MockDatabase,
  passwords: GooglePlayReviewPasswords,
  now = new Date(),
): MockDatabase {
  assertPasswords(passwords);

  const createdAt = at(now, -30, 10);
  const passwordUpdatedAt = now.toISOString();
  const branch: Branch = {
    id: googlePlayReviewBranchId,
    name: "Google Play 검토 지점",
    district: "합성 검토 데이터",
    settings: { attendanceEditRequiresReason: true },
    status: "active",
    timezone: "Asia/Seoul",
  };
  const commonUser = {
    accountPurpose: googlePlayReviewAccountPurpose,
    branchIds: [googlePlayReviewBranchId],
    invitationStatus: "accepted" as const,
    passwordUpdatedAt,
  };
  const users: AppUser[] = [
    {
      ...commonUser,
      id: googlePlayReviewUserIds.member,
      email: "member@play-review.finaljudo.invalid",
      name: "Play 검토 회원",
      passwordHash: createRandomPasswordHash(passwords.member),
      phone: googlePlayReviewPhones.member,
      role: "member",
      title: "합성 성인 회원",
      memberIds: [googlePlayReviewMemberIds.adult],
    },
    {
      ...commonUser,
      id: googlePlayReviewUserIds.guardian,
      childMemberIds: [googlePlayReviewMemberIds.child],
      email: "guardian@play-review.finaljudo.invalid",
      name: "Play 검토 학부모",
      passwordHash: createRandomPasswordHash(passwords.guardian),
      phone: googlePlayReviewPhones.guardian,
      role: "guardian",
      title: "합성 학부모·성인 회원",
      memberIds: [googlePlayReviewMemberIds.guardian],
    },
    {
      ...commonUser,
      id: googlePlayReviewUserIds.coach,
      email: "coach@play-review.finaljudo.invalid",
      name: "Play 검토 코치",
      passwordHash: createRandomPasswordHash(passwords.coach),
      phone: googlePlayReviewPhones.coach,
      role: "coach",
      title: "합성 검토 수업 코치",
    },
    {
      ...commonUser,
      id: googlePlayReviewUserIds.owner,
      email: "owner@play-review.finaljudo.invalid",
      name: "Play 검토 대표",
      passwordHash: createRandomPasswordHash(passwords.owner),
      phone: googlePlayReviewPhones.owner,
      role: "owner",
      title: "합성 검토 지점 대표",
    },
    {
      ...commonUser,
      id: googlePlayReviewUserIds.admin,
      email: "admin@play-review.finaljudo.invalid",
      name: "Play 검토 총괄",
      passwordHash: createRandomPasswordHash(passwords.admin),
      phone: googlePlayReviewPhones.admin,
      role: "admin",
      title: "합성 데이터 전용 읽기 검토",
    },
  ];
  const members: Member[] = [
    {
      id: googlePlayReviewMemberIds.adult,
      alerts: [],
      ageGroup: "adult",
      belt: "초록띠",
      branchId: googlePlayReviewBranchId,
      createdAt,
      emergencyContact: googlePlayReviewPhones.member,
      guardianIds: [],
      level: "중급",
      name: "Play 검토 성인 회원",
      primaryCoachId: googlePlayReviewUserIds.coach,
      status: "active",
      statusChangedAt: createdAt,
    },
    {
      id: googlePlayReviewMemberIds.guardian,
      alerts: [],
      ageGroup: "adult",
      belt: "노란띠",
      branchId: googlePlayReviewBranchId,
      createdAt,
      emergencyContact: googlePlayReviewPhones.guardian,
      guardianIds: [],
      level: "초급",
      name: "Play 검토 학부모 본인",
      primaryCoachId: googlePlayReviewUserIds.coach,
      status: "active",
      statusChangedAt: createdAt,
    },
    {
      id: googlePlayReviewMemberIds.child,
      alerts: [],
      ageGroup: "kids",
      belt: "노란띠",
      branchId: googlePlayReviewBranchId,
      createdAt,
      emergencyContact: googlePlayReviewPhones.guardian,
      guardianIds: [googlePlayReviewUserIds.guardian],
      level: "초급",
      name: "Play 검토 자녀",
      primaryCoachId: googlePlayReviewUserIds.coach,
      status: "active",
      statusChangedAt: createdAt,
    },
  ];
  const classes: ClassSession[] = [
    {
      id: "class-google-play-review-kids",
      ageGroup: "kids",
      branchId: googlePlayReviewBranchId,
      capacity: 12,
      coachId: googlePlayReviewUserIds.coach,
      enrolledMemberIds: [googlePlayReviewMemberIds.child],
      endsAt: at(now, 0, 16, 50),
      level: "입문-초급",
      name: "유소년 유도 기초반",
      room: "검토 매트 A",
      startsAt: at(now, 0, 16),
    },
    {
      id: "class-google-play-review-adult",
      ageGroup: "adult",
      branchId: googlePlayReviewBranchId,
      capacity: 16,
      coachId: googlePlayReviewUserIds.coach,
      enrolledMemberIds: [googlePlayReviewMemberIds.adult, googlePlayReviewMemberIds.guardian],
      endsAt: at(now, 0, 21),
      level: "초급-중급",
      name: "성인 직장인반",
      room: "검토 매트 B",
      startsAt: at(now, 0, 20),
    },
    {
      id: "class-google-play-review-tomorrow",
      ageGroup: "all",
      branchId: googlePlayReviewBranchId,
      capacity: 20,
      coachId: googlePlayReviewUserIds.coach,
      enrolledMemberIds: Object.values(googlePlayReviewMemberIds),
      endsAt: at(now, 1, 18, 50),
      level: "모두 가능",
      name: "공통 낙법 클리닉",
      room: "검토 매트 A",
      startsAt: at(now, 1, 18),
    },
  ];
  const attendance: AttendanceRecord[] = [
    {
      id: "attendance-google-play-review-child",
      confirmedAt: at(now, 0, 16, 4),
      memberId: googlePlayReviewMemberIds.child,
      sessionId: "class-google-play-review-kids",
      status: "present",
    },
    {
      id: "attendance-google-play-review-adult",
      confirmedAt: at(now, 0, 20, 6),
      memberId: googlePlayReviewMemberIds.adult,
      sessionId: "class-google-play-review-adult",
      status: "absent",
    },
  ];
  const counselingNotes: CounselingNote[] = [
    {
      id: "note-google-play-review-progress",
      authorUserId: googlePlayReviewUserIds.coach,
      body: "낙법 동작이 안정되었고 다음 수업에서 발기술 연결을 연습합니다.",
      branchId: googlePlayReviewBranchId,
      createdAt: at(now, -1, 18),
      memberId: googlePlayReviewMemberIds.child,
      noteType: "progress",
      visibility: "guardian_visible",
    },
  ];
  const payments: Payment[] = [
    {
      id: "payment-google-play-review-child",
      amount: 180000,
      branchId: googlePlayReviewBranchId,
      dueDate: dateOnly(now, 20),
      expiresAt: dateOnly(now, 35),
      memberId: googlePlayReviewMemberIds.child,
      planName: "유소년 주 3회 1개월",
      status: "paid",
      statusHistory: [{
        id: "payment-history-google-play-review-child",
        actorUserId: googlePlayReviewUserIds.owner,
        changedAt: at(now, -5, 12),
        event: "created",
        reason: "Google Play 합성 검토 결제",
        status: "paid",
      }],
    },
    {
      id: "payment-google-play-review-adult",
      amount: 170000,
      branchId: googlePlayReviewBranchId,
      dueDate: dateOnly(now, -2),
      expiresAt: dateOnly(now, 5),
      memberId: googlePlayReviewMemberIds.adult,
      planName: "성인 월 회비",
      status: "overdue",
      statusHistory: [{
        id: "payment-history-google-play-review-adult",
        actorUserId: googlePlayReviewUserIds.owner,
        changedAt: at(now, -2, 12),
        event: "created",
        reason: "Google Play 합성 미납 상태",
        status: "overdue",
      }],
    },
    {
      id: "payment-google-play-review-guardian",
      amount: 160000,
      branchId: googlePlayReviewBranchId,
      dueDate: dateOnly(now, 5),
      expiresAt: dateOnly(now, 12),
      memberId: googlePlayReviewMemberIds.guardian,
      planName: "성인 주 2회 1개월",
      status: "scheduled",
      statusHistory: [{
        id: "payment-history-google-play-review-guardian",
        actorUserId: googlePlayReviewUserIds.owner,
        changedAt: at(now, -1, 12),
        event: "created",
        reason: "Google Play 합성 결제 예정",
        status: "scheduled",
      }],
    },
  ];
  const notices: Notice[] = [
    {
      id: "notice-google-play-review",
      audience: ["all"],
      body: "이 공지는 Google Play 심사용 합성 데이터입니다.",
      branchId: googlePlayReviewBranchId,
      createdAt: at(now, -1, 12),
      createdByUserId: googlePlayReviewUserIds.owner,
      important: true,
      readByUserIds: [],
      title: "검토 지점 수업 안내",
    },
  ];
  const promotions: BeltPromotion[] = [
    {
      id: "promotion-google-play-review-child",
      branchId: googlePlayReviewBranchId,
      createdAt: now.toISOString(),
      createdByUserId: googlePlayReviewUserIds.coach,
      evaluatorUserId: googlePlayReviewUserIds.coach,
      examDate: dateOnly(now, 14),
      fromBelt: "노란띠",
      memberId: googlePlayReviewMemberIds.child,
      note: "낙법과 기본 잡기 항목 확인",
      result: "scheduled",
      toBelt: "주황띠",
    },
  ];
  const tournaments: Tournament[] = [
    {
      id: "tournament-google-play-review",
      branchId: googlePlayReviewBranchId,
      createdAt: now.toISOString(),
      createdByUserId: googlePlayReviewUserIds.owner,
      description: "Google Play 검토용 합성 대회 안내",
      eventDate: dateOnly(now, 30),
      location: "검토 체육관",
      organizer: "파이널유도멀티짐",
      registrationDeadline: dateOnly(now, 14),
      scope: "branch",
      title: "Google Play 검토 교류전",
      updatedAt: now.toISOString(),
    },
  ];
  const auditLog: AuditLog = {
    id: `audit-google-play-review-provision-${now.getTime()}`,
    action: "branch.create",
    actorUserId: googlePlayReviewUserIds.admin,
    after: { accountCount: users.length, branchId: googlePlayReviewBranchId, syntheticData: true },
    before: null,
    branchId: googlePlayReviewBranchId,
    createdAt: now.toISOString(),
    message: "Google Play 검토용 합성 지점과 계정을 준비했습니다.",
    result: "success",
    targetId: googlePlayReviewBranchId,
    targetType: "branch",
  };
  const reviewUserIdSet = new Set<string>(Object.values(googlePlayReviewUserIds));
  const reviewMemberIdSet = new Set<string>(Object.values(googlePlayReviewMemberIds));
  const existingBranch = db.branches.find((candidate) => candidate.id === googlePlayReviewBranchId);

  if (existingBranch && (
    existingBranch.name !== branch.name ||
    existingBranch.district !== branch.district
  )) {
    throw new Error(`Refusing to replace non-review branch data with ID ${googlePlayReviewBranchId}.`);
  }

  assertOwnedReplacementIds("user", db.users, users, (item) => item.accountPurpose === googlePlayReviewAccountPurpose);
  assertOwnedReplacementIds("member", db.members, members, (item) => item.branchId === googlePlayReviewBranchId);
  assertOwnedReplacementIds("class", db.classes, classes, (item) => item.branchId === googlePlayReviewBranchId);
  assertOwnedReplacementIds(
    "attendance",
    db.attendance,
    attendance,
    (item) => reviewMemberIdSet.has(item.memberId),
  );
  assertOwnedReplacementIds("counseling note", db.counselingNotes, counselingNotes, (item) => item.branchId === googlePlayReviewBranchId);
  assertOwnedReplacementIds("notice", db.notices, notices, (item) => item.branchId === googlePlayReviewBranchId);
  assertOwnedReplacementIds("payment", db.payments, payments, (item) => item.branchId === googlePlayReviewBranchId);
  assertOwnedReplacementIds("promotion", db.promotions, promotions, (item) => item.branchId === googlePlayReviewBranchId);
  assertOwnedReplacementIds("tournament", db.tournaments, tournaments, (item) => item.branchId === googlePlayReviewBranchId);

  return rollGooglePlayReviewDates({
    ...db,
    attendance: replaceById(db.attendance, attendance),
    attendanceQrChallenges: db.attendanceQrChallenges.filter(
      (challenge) => challenge.branchId !== googlePlayReviewBranchId && !reviewUserIdSet.has(challenge.userId),
    ),
    auditLogs: [auditLog, ...db.auditLogs],
    authSessions: db.authSessions.filter((session) => !reviewUserIdSet.has(session.userId)),
    branches: replaceById(db.branches, [branch]),
    classes: replaceById(db.classes, classes),
    counselingNotes: replaceById(db.counselingNotes, counselingNotes),
    members: replaceById(db.members, members),
    notices: replaceById(db.notices, notices),
    payments: replaceById(db.payments, payments),
    promotions: replaceById(db.promotions, promotions),
    pushDispatchJobs: db.pushDispatchJobs.filter((job) => job.branchId !== googlePlayReviewBranchId),
    pushSubscriptions: db.pushSubscriptions.filter(
      (subscription) => !reviewUserIdSet.has(subscription.userId) && !subscription.branchIds.includes(googlePlayReviewBranchId),
    ),
    tournaments: replaceById(db.tournaments, tournaments),
    users: replaceById(db.users, users),
  }, now);
}
