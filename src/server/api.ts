import { NextResponse, type NextRequest } from "next/server";
import type { AppUser, CounselingNote, MockDatabase } from "@/lib/domain";
import {
  canReadNotice,
  getAccessibleBranchIds,
  getAccessibleMemberIds,
  getSelectedBranchIds,
} from "@/lib/mock-api";

export const sessionCookieName = "final-judo-session";

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
  const cookieUserId = request.cookies.get(sessionCookieName)?.value;
  const localHeaderUserId = process.env.NODE_ENV !== "production" ? request.headers.get("x-user-id") : null;
  const userId = cookieUserId ?? localHeaderUserId ?? undefined;

  if (!userId) {
    return null;
  }

  return db.users.find((user) => user.id === userId) ?? null;
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
  const selectedBranchId = getSelectedBranchId(request);
  const accessibleBranchIds = getAccessibleBranchIds(user, db);

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

function createSafeUser(user: AppUser, db?: MockDatabase, viewerRole: AppUser["role"] = user.role) {
  const safeUser = { ...user };

  delete safeUser.passwordHash;

  if (viewerRole !== "admin") {
    delete safeUser.invitationToken;
    delete safeUser.invitedAt;
    delete safeUser.acceptedAt;
    delete safeUser.passwordResetRequestedAt;
    delete safeUser.passwordUpdatedAt;
  }

  if (db && safeUser.role === "guardian") {
    const allowedChildMemberIds = new Set(getAccessibleMemberIds(safeUser, db));

    safeUser.childMemberIds = (safeUser.childMemberIds ?? []).filter((memberId) => allowedChildMemberIds.has(memberId));
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
  const members = db.members.filter((member) => allowedMemberIds.has(member.id) && branchIds.includes(member.branchId));
  const attendance = db.attendance.filter((record) => classIds.has(record.sessionId) && allowedMemberIds.has(record.memberId));
  const counselingNotes = (db.counselingNotes ?? [])
    .filter((note) => branchIds.includes(note.branchId) && allowedMemberIds.has(note.memberId))
    .filter((note) => canReadCounselingNote(user, note));
  const promotions = (db.promotions ?? []).filter(
    (promotion) => branchIds.includes(promotion.branchId) && allowedMemberIds.has(promotion.memberId),
  );
  const scopedPayments = db.payments.filter((payment) => branchIds.includes(payment.branchId) && allowedMemberIds.has(payment.memberId));
  const payments = user.role === "coach" ? [] : scopedPayments;
  const notices = db.notices.filter((notice) => canReadNotice(user, db, notice, branchIds));
  const referencedUserIds = new Set<string>([user.id]);

  classes.forEach((session) => referencedUserIds.add(session.coachId));
  members.forEach((member) => {
    referencedUserIds.add(member.primaryCoachId);
    member.guardianIds.forEach((guardianId) => referencedUserIds.add(guardianId));
  });
  counselingNotes.forEach((note) => referencedUserIds.add(note.authorUserId));

  const scopedUsers = user.role === "admin"
    ? db.users
    : user.role === "owner"
      ? db.users.filter(
          (candidate) =>
            referencedUserIds.has(candidate.id) ||
            candidate.branchIds.some((branchId) => branchIds.includes(branchId)),
        )
      : db.users.filter((candidate) => referencedUserIds.has(candidate.id));
  const users = scopedUsers.map((candidate) => createSafeUser(candidate, db, user.role));
  const auditLogs = user.role === "admin"
    ? db.auditLogs
    : user.role === "owner"
      ? db.auditLogs.filter((log) => log.branchId === null || branchIds.includes(log.branchId))
      : db.auditLogs.filter((log) => log.actorUserId === user.id);
  const pushSubscriptions = db.pushSubscriptions
    .filter((subscription) => {
      if (user.role === "admin") {
        return true;
      }

      if (user.role === "owner") {
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
    tournaments: db.tournaments ?? [],
    payments,
    notices,
    pushSubscriptions,
    pilotReadinessChecks: user.role === "admin" ? db.pilotReadinessChecks : [],
    pilotIncidents: user.role === "admin" ? db.pilotIncidents : [],
    pilotOperationLogs: user.role === "admin" ? db.pilotOperationLogs : [],
    auditLogs,
  };
}

function canReadCounselingNote(user: AppUser, note: CounselingNote) {
  if (user.role === "admin" || user.role === "owner") {
    return true;
  }

  if (user.role === "coach") {
    return note.visibility === "coach_visible" || note.visibility === "guardian_visible";
  }

  return note.visibility === "guardian_visible";
}

export function createBootstrapPayload(db: MockDatabase, user: AppUser, requestedBranchId: string | null) {
  const selectedBranchId = createSelectedBranchId(user, db, requestedBranchId);

  return {
    user: createSafeUser(user, db, user.role),
    selectedBranchId,
    db: createSafeSnapshot(db, user, selectedBranchId),
  };
}
