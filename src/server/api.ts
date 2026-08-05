import { NextResponse, type NextRequest } from "next/server";
import { canReadCounselingNote } from "@/lib/counseling-note-visibility";
import type { AppUser, MemberMembershipSummary, MockDatabase, Payment } from "@/lib/domain";
import {
  canReadNotice,
  getAccessibleBranchIds,
  getAccessibleMemberIds,
  getSelectedBranchIds,
} from "@/lib/mock-api";
import { canViewTournament, createFamilySafeTournament, resolveTournamentAccess } from "@/lib/tournament-policy";
import { getCurrentMemberPayment } from "@/lib/payment-lifecycle";
import {
  createFamilySafeMember,
  createFamilySafeReferencedUser,
  createGuardianFamilyLinkProjection,
} from "@/lib/family-members";
import { createFamilySafePayment } from "@/lib/family-payment-privacy";
import { createFamilySafeAttendanceRecord } from "@/lib/attendance-policy";
import { createFamilySafeNotice } from "@/lib/notices";
import { createFamilySafePromotion } from "@/lib/promotions";
import {
  hasGlobalAdminDataAccess,
  isGooglePlayReviewAccount,
  shouldBlockGooglePlayReviewAdminMutation,
} from "@/lib/google-play-review-access";
import { formatDateKey } from "../lib/format.ts";
import { findAuthSessionUser } from "@/server/auth-session";

export const sessionCookieName = "final-judo-session";

function createCoachMembershipSummary(payments: Payment[]): MemberMembershipSummary {
  const current = getCurrentMemberPayment(payments);

  if (!current) {
    return { status: "none" };
  }

  if (current.expiresAt < formatDateKey(new Date())) {
    return { status: "inactive", expiresAt: current.expiresAt };
  }

  const status = current.status === "paid"
    ? "active"
    : current.status === "expiringSoon"
      ? "expiring"
      : current.status === "cancelled" || current.status === "refunded"
        ? "inactive"
        : "attention";

  return { status, expiresAt: current.expiresAt };
}

function createEndpointHint(endpoint: string) {
  return endpoint.length <= 16 ? endpoint : `...${endpoint.slice(-16)}`;
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
      },
    },
    init,
  );
}

export function jsonError(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details,
      },
      meta: {
        generatedAt: new Date().toISOString(),
      },
    },
    { status },
  );
}

export function getSessionUser(request: NextRequest, db: MockDatabase) {
  const sessionToken = request.cookies.get(sessionCookieName)?.value;
  const localHeaderUserId = process.env.NODE_ENV !== "production" ? request.headers.get("x-user-id") : null;
  return findAuthSessionUser(db, sessionToken) ??
    (localHeaderUserId ? db.users.find((user) => user.id === localHeaderUserId) ?? null : null);
}

export function getSelectedBranchId(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("selectedBranchId");

  return branchId && branchId !== "all" ? branchId : null;
}

export function requireSession(request: NextRequest, db: MockDatabase) {
  const user = getSessionUser(request, db);

  if (!user) {
    return {
      user: null,
      response: jsonError(401, "UNAUTHENTICATED", "로그인이 필요합니다."),
    };
  }

  if (shouldBlockGooglePlayReviewAdminMutation(user, request.method)) {
    return {
      user: null,
      response: jsonError(
        403,
        "FORBIDDEN",
        "Google Play 검토용 총괄 계정은 데이터를 변경할 수 없습니다.",
      ),
    };
  }

  return { user, response: null };
}

export function createSelectedBranchId(user: AppUser, db: MockDatabase, requestedBranchId: string | null) {
  const accessibleBranchIds = getAccessibleBranchIds(user, db);

  if (requestedBranchId && accessibleBranchIds.includes(requestedBranchId)) {
    return requestedBranchId;
  }

  return accessibleBranchIds.length > 1 ? null : accessibleBranchIds[0] ?? null;
}

export function requireSelectedBranchScope(request: NextRequest, user: AppUser, db: MockDatabase) {
  const accessibleBranchIds = getAccessibleBranchIds(user, db);
  const requestedBranchId = getSelectedBranchId(request);
  const selectedBranchId = requestedBranchId ??
    (isGooglePlayReviewAccount(user) && accessibleBranchIds.length === 1 ? accessibleBranchIds[0] : null);

  if (selectedBranchId && !accessibleBranchIds.includes(selectedBranchId)) {
    return {
      branchIds: [],
      response: jsonError(403, "FORBIDDEN", "선택한 지점에 접근할 수 없습니다."),
      selectedBranchId,
    };
  }

  return {
    branchIds: getSelectedBranchIds({ db, user, selectedBranchId }),
    response: null,
    selectedBranchId,
  };
}

function createSafeUser(
  user: AppUser,
  db?: MockDatabase,
  viewerRole: AppUser["role"] = user.role,
  viewerUserId: string = user.id,
  viewerBranchIds: readonly string[] = user.branchIds,
) {
  const safeUser = { ...user };
  const redactFamilyLinks =
    (viewerRole === "member" || viewerRole === "guardian") && safeUser.id !== viewerUserId;

  delete safeUser.passwordHash;
  delete safeUser.invitationToken;

  if (viewerRole !== "admin") {
    delete safeUser.invitedAt;
    delete safeUser.acceptedAt;
    delete safeUser.passwordResetRequestedAt;
    delete safeUser.passwordUpdatedAt;
  }

  if (redactFamilyLinks) {
    return createFamilySafeReferencedUser(safeUser, viewerBranchIds);
  }

  const guardianFamilyLinks = db
    ? createGuardianFamilyLinkProjection(safeUser, db, { redactFamilyLinks })
    : null;

  if (guardianFamilyLinks) {
    safeUser.memberIds = guardianFamilyLinks.memberIds;
    safeUser.childMemberIds = guardianFamilyLinks.childMemberIds;
  }

  return safeUser;
}

export function createSafeSnapshot(db: MockDatabase, user: AppUser, selectedBranchId: string | null): MockDatabase {
  const context = { db, user, selectedBranchId };
  const branchIds = getSelectedBranchIds(context);
  const accessibleBranchIds = getAccessibleBranchIds(user, db);
  const memberIds = new Set(getAccessibleMemberIds(user, db, branchIds));
  const branches = db.branches.filter((branch) => accessibleBranchIds.includes(branch.id));

  const classes = db.classes
    .filter((session) => branchIds.includes(session.branchId))
    .filter((session) => {
      if (user.role === "coach") {
        return session.coachId === user.id;
      }

      if (user.role === "member" || user.role === "guardian") {
        return session.enrolledMemberIds.some((memberId) => memberIds.has(memberId));
      }

      return true;
    })
    .map((session) => ({
      ...session,
      enrolledMemberIds:
        user.role === "member" || user.role === "guardian" || user.role === "coach"
          ? session.enrolledMemberIds.filter((memberId) => memberIds.has(memberId))
          : session.enrolledMemberIds,
    }));
  const classIds = new Set(classes.map((session) => session.id));
  const classesMemberIds = new Set(classes.flatMap((session) => session.enrolledMemberIds));
  const allowedMemberIds = new Set([...memberIds, ...classesMemberIds]);
  const scopedPayments = db.payments.filter((payment) => branchIds.includes(payment.branchId) && allowedMemberIds.has(payment.memberId));
  const members = db.members
    .filter((member) => allowedMemberIds.has(member.id) && branchIds.includes(member.branchId))
    .map((member) =>
      user.role === "member" || user.role === "guardian"
        ? createFamilySafeMember(member, user)
        : user.role === "coach"
          ? {
              ...member,
              membershipSummary: createCoachMembershipSummary(
                scopedPayments.filter((payment) => payment.memberId === member.id),
              ),
            }
          : member,
    );
  const scopedAttendance = db.attendance.filter(
    (record) => classIds.has(record.sessionId) && allowedMemberIds.has(record.memberId),
  );
  const attendance = user.role === "member" || user.role === "guardian"
    ? scopedAttendance.map(createFamilySafeAttendanceRecord)
    : scopedAttendance;
  const counselingNotes = (db.counselingNotes ?? [])
    .filter((note) => branchIds.includes(note.branchId) && allowedMemberIds.has(note.memberId))
    .filter((note) => canReadCounselingNote(user, note));
  const scopedPromotions = (db.promotions ?? []).filter(
    (promotion) => branchIds.includes(promotion.branchId) && allowedMemberIds.has(promotion.memberId),
  );
  const promotions = user.role === "member" || user.role === "guardian"
    ? scopedPromotions.map(createFamilySafePromotion)
    : scopedPromotions;
  const payments = user.role === "coach"
    ? []
    : user.role === "member" || user.role === "guardian"
      ? scopedPayments.map((payment) => createFamilySafePayment(payment, user.id))
      : scopedPayments;
  const scopedNotices = db.notices.filter((notice) => canReadNotice(user, db, notice, branchIds));
  const notices = user.role === "member" || user.role === "guardian"
    ? scopedNotices.map((notice) => createFamilySafeNotice(notice, user.id, allowedMemberIds, classIds))
    : scopedNotices;
  const globalAdminDataAccess = hasGlobalAdminDataAccess(user);
  const referencedUserIds = new Set<string>([user.id]);

  classes.forEach((session) => referencedUserIds.add(session.coachId));
  members.forEach((member) => {
    referencedUserIds.add(member.primaryCoachId);
    member.guardianIds.forEach((guardianId) => referencedUserIds.add(guardianId));
  });
  counselingNotes.forEach((note) => referencedUserIds.add(note.authorUserId));
  scopedPromotions.forEach((promotion) => referencedUserIds.add(promotion.evaluatorUserId));

  const scopedUsers = globalAdminDataAccess
    ? db.users
    : user.role === "owner" || user.role === "admin"
      ? db.users.filter(
          (candidate) =>
            referencedUserIds.has(candidate.id) ||
            candidate.branchIds.some((branchId) => branchIds.includes(branchId)),
        )
      : db.users.filter((candidate) => referencedUserIds.has(candidate.id));
  const users = scopedUsers.map((candidate) =>
    createSafeUser(candidate, db, user.role, user.id, branchIds)
  );
  const auditLogs = globalAdminDataAccess
    ? db.auditLogs
    : user.role === "owner" || user.role === "admin"
      ? db.auditLogs.filter((log) => log.branchId !== null && branchIds.includes(log.branchId))
      : user.role === "coach"
        ? db.auditLogs.filter(
            (log) =>
              log.actorUserId === user.id &&
              log.targetType === "attendance" &&
              log.branchId !== null &&
              branchIds.includes(log.branchId),
          )
        : [];
  const pushSubscriptions = db.pushSubscriptions
    .filter((subscription) => {
      if (globalAdminDataAccess) {
        return true;
      }

      if (user.role === "owner" || user.role === "admin") {
        return subscription.branchIds.some((branchId) => branchIds.includes(branchId));
      }

      return subscription.userId === user.id;
    })
    .map((subscription) => ({
      ...subscription,
      endpoint: createEndpointHint(subscription.endpoint),
      keys: {
        auth: "masked",
        p256dh: "masked",
      },
    }));

  return {
    branches,
    users,
    members,
    classes,
    attendance,
    counselingNotes,
    promotions,
    tournaments: (db.tournaments ?? [])
      .filter((tournament) => {
        if (isGooglePlayReviewAccount(user)) {
          const access = resolveTournamentAccess(tournament);
          return access.scope === "branch" && access.branchId !== null && branchIds.includes(access.branchId);
        }

        return canViewTournament(tournament, branchIds);
      })
      .map((tournament) =>
        user.role === "member" || user.role === "guardian"
          ? createFamilySafeTournament(tournament, allowedMemberIds)
          : {
              ...tournament,
              registrations: (tournament.registrations ?? [])
                .filter((registration) => allowedMemberIds.has(registration.memberId)),
            },
      ),
    payments,
    notices,
    authSessions: [],
    passwordResetChallenges: [],
    phoneSignupChallenges: [],
    attendanceQrChallenges: [],
    pushSubscriptions,
    pushDispatchJobs: [],
    pilotReadinessChecks: globalAdminDataAccess ? db.pilotReadinessChecks : [],
    pilotIncidents: globalAdminDataAccess ? db.pilotIncidents : [],
    pilotOperationLogs: globalAdminDataAccess ? db.pilotOperationLogs : [],
    auditLogs,
  };
}

export function createBootstrapPayload(db: MockDatabase, user: AppUser, requestedBranchId: string | null) {
  const selectedBranchId = createSelectedBranchId(user, db, requestedBranchId);

  return {
    user: createSafeUser(user, db, user.role, user.id),
    selectedBranchId,
    db: createSafeSnapshot(db, user, selectedBranchId),
  };
}
