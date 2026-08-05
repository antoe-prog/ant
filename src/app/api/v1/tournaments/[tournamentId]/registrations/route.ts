import { after, NextRequest } from "next/server";
import {
  tournamentDivisions,
  tournamentRegistrationStatuses,
  type AuditLog,
  type MockDatabase,
  type Notice,
  type Tournament,
  type TournamentDivision,
  type TournamentRegistrationStatus,
} from "@/lib/domain";
import { formatDateKey } from "@/lib/format";
import { getAccessibleMemberIds } from "@/lib/mock-api";
import { canViewTournament, resolveTournamentAccess } from "@/lib/tournament-policy";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import {
  prepareNoticePushDispatchJobs,
  notificationOutboxExecutionPolicy,
  processNotificationOutbox,
} from "@/server/notification-outbox-runner";
import {
  createNoticePushDispatchRequestAuditLog,
  getNoticeFamilyRecipientCount,
  getNoticePushSubscriptions,
} from "@/server/push-notifications";
import { createRuntimeId } from "@/server/runtime-id";
import { tournamentStateLockKey } from "@/server/tournaments";

export const runtime = "nodejs";

type RegistrationCancelBody = { memberId: string };
type RegistrationApplyBody = RegistrationCancelBody & {
  division: TournamentDivision;
  weightClass: string;
};
type RegistrationReviewBody = {
  memberIds: string[];
  note?: string;
  status: TournamentRegistrationStatus;
};
type RegistrationUpdate =
  | { operation: "apply"; body: RegistrationApplyBody }
  | { operation: "cancel"; body: RegistrationCancelBody };

function parseMemberId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const memberId = value.trim();
  return memberId && memberId.length <= 200 ? memberId : null;
}

function parseRegistrationApplyBody(value: unknown): RegistrationApplyBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;

  if (Object.keys(body).length !== 3) {
    return null;
  }

  const memberId = parseMemberId(body.memberId);
  const division = typeof body.division === "string" && tournamentDivisions.includes(body.division as TournamentDivision)
    ? body.division as TournamentDivision
    : null;
  const weightClass = typeof body.weightClass === "string" ? body.weightClass.trim() : "";

  if (
    !memberId ||
    !division ||
    !weightClass ||
    weightClass.length > 30 ||
    /[\u0000-\u001f\u007f]/.test(weightClass)
  ) {
    return null;
  }

  return { memberId, division, weightClass };
}

function parseRegistrationCancelBody(value: unknown): RegistrationCancelBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const memberId = parseMemberId(body.memberId);

  return Object.keys(body).length === 1 && memberId ? { memberId } : null;
}

function parseRegistrationReviewBody(value: unknown): RegistrationReviewBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;
  const singleMemberId = parseMemberId(body.memberId);
  const memberIds = Array.isArray(body.memberIds)
    ? [...new Set(body.memberIds.map(parseMemberId))]
    : singleMemberId
      ? [singleMemberId]
      : [];
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const status =
    typeof body.status === "string" &&
    tournamentRegistrationStatuses.includes(body.status as TournamentRegistrationStatus)
      ? body.status as TournamentRegistrationStatus
      : null;
  const allowedKeys = new Set(singleMemberId ? ["memberId", "note", "status"] : ["memberIds", "note", "status"]);

  if (
    !status ||
    memberIds.length === 0 ||
    memberIds.length > 100 ||
    memberIds.some((memberId) => memberId === null) ||
    Object.keys(body).some((key) => !allowedKeys.has(key)) ||
    note.length > 300 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note) ||
    (status === "rejected" && !note)
  ) {
    return null;
  }

  return {
    memberIds: memberIds as string[],
    ...(note ? { note } : {}),
    status,
  };
}

function getRegistrationContext(
  request: NextRequest,
  db: MockDatabase,
  tournamentId: string,
  memberId: string,
) {
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { ok: false as const, response };
  }

  if (user.role !== "member" && user.role !== "guardian") {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", "회원 또는 학부모 계정에서만 대회 참가를 신청할 수 있습니다."),
    };
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { ok: false as const, response: selectedScope.response };
  }

  const tournament = db.tournaments.find((candidate) => candidate.id === tournamentId);

  if (!tournament || !canViewTournament(tournament, selectedScope.branchIds)) {
    return { ok: false as const, response: jsonError(404, "NOT_FOUND", "대회를 찾을 수 없습니다.") };
  }

  const member = db.members.find((candidate) => candidate.id === memberId);
  const accessibleMemberIds = getAccessibleMemberIds(user, db, selectedScope.branchIds);

  if (
    !member ||
    !selectedScope.branchIds.includes(member.branchId) ||
    !accessibleMemberIds.includes(member.id)
  ) {
    return { ok: false as const, response: jsonError(404, "NOT_FOUND", "신청할 회원을 찾을 수 없습니다.") };
  }

  const tournamentAccess = resolveTournamentAccess(tournament);

  if (tournamentAccess.scope === "branch" && tournamentAccess.branchId !== member.branchId) {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", "회원이 등록된 지점의 대회만 신청할 수 있습니다."),
    };
  }

  return {
    db,
    member,
    ok: true as const,
    selectedBranchId: selectedScope.selectedBranchId,
    tournament,
    user,
  };
}

function getApplicationBlockReason(tournament: Tournament, memberStatus: string, todayKey: string) {
  if (memberStatus !== "active" && memberStatus !== "trial") {
    return "활성 또는 체험 상태인 회원만 대회 참가를 신청할 수 있습니다.";
  }

  if (tournament.registrationDeadline && tournament.registrationDeadline < todayKey) {
    return "대회 참가 신청 기간이 마감되었습니다.";
  }

  if ((tournament.eventEndDate ?? tournament.eventDate) < todayKey) {
    return "종료된 대회에는 참가를 신청할 수 없습니다.";
  }

  return null;
}

function prepareRegistrationStatusNoticePush(
  db: MockDatabase,
  notices: Notice[],
  actorUserId: string,
  requestedAt: string,
) {
  let nextDb = db;
  let enqueuedCount = 0;

  for (const notice of notices) {
    const dispatchAudit = createNoticePushDispatchRequestAuditLog({
      auditId: createRuntimeId("audit"),
      branchId: notice.branchId,
      actorUserId,
      noticeId: notice.id,
      candidateCount: getNoticePushSubscriptions(nextDb, notice).length,
      recipientCount: getNoticeFamilyRecipientCount(nextDb, notice),
      requestedAt,
      autoDispatchedOnCreate: true,
    });
    const prepared = prepareNoticePushDispatchJobs(
      { ...nextDb, auditLogs: [dispatchAudit, ...nextDb.auditLogs] },
      notice,
      dispatchAudit,
      requestedAt,
    );

    nextDb = prepared.db;
    enqueuedCount += prepared.enqueued;
  }

  return { db: nextDb, enqueuedCount };
}

async function updateRegistration(
  request: NextRequest,
  tournamentId: string,
  update: RegistrationUpdate,
) {
  const { body, operation } = update;
  const initialDb = await readServerDb();
  const initialContext = getRegistrationContext(request, initialDb, tournamentId, body.memberId);

  if (!initialContext.ok) {
    return initialContext.response;
  }

  return withServerDbLock(tournamentStateLockKey, async () => {
    const db = await readServerDb();
    const context = getRegistrationContext(request, db, tournamentId, body.memberId);

    if (!context.ok) {
      return context.response;
    }

    const { member, selectedBranchId, tournament, user } = context;
    const registrations = tournament.registrations ?? [];
    const existing = registrations.find((registration) => registration.memberId === member.id);

    if (existing?.status === "submitted") {
      return jsonError(
        422,
        "BUSINESS_RULE_FAILED",
        "협회에 제출된 참가 신청은 직접 수정하거나 취소할 수 없습니다. 담당 코치에게 문의해 주세요.",
      );
    }

    if (operation === "cancel" && !existing) {
      return jsonOk({
        ...createBootstrapPayload(db, user, selectedBranchId ?? member.branchId),
        registration: {
          memberId: member.id,
          operation: "cancel",
          status: "cancelled",
          tournamentId: tournament.id,
          unchanged: true,
        },
      });
    }

    if (operation === "apply") {
      const blockReason = getApplicationBlockReason(tournament, member.status, formatDateKey(new Date()));

      if (blockReason) {
        return jsonError(422, "BUSINESS_RULE_FAILED", blockReason);
      }

      if (
        existing &&
        existing.status !== "rejected" &&
        existing.division === body.division &&
        existing.weightClass === body.weightClass
      ) {
        return jsonOk({
          ...createBootstrapPayload(db, user, selectedBranchId ?? member.branchId),
          registration: {
            memberId: member.id,
            operation: "apply",
            status: "applied",
            tournamentId: tournament.id,
            unchanged: true,
          },
        });
      }
    }

    const now = new Date().toISOString();
    const resolvedOperation = operation === "apply" && existing ? "update" : operation;
    const nextRegistrations =
      operation === "apply"
        ? existing
          ? registrations.map((registration) =>
              registration.memberId === member.id
                ? {
                    ...registration,
                    division: body.division,
                    reviewedAt: undefined,
                    reviewedByUserId: undefined,
                    reviewNote: undefined,
                    status: "pending" as const,
                    weightClass: body.weightClass,
                    updatedAt: now,
                  }
                : registration,
            )
          : [
              ...registrations,
              {
                id: createRuntimeId("tournament-registration"),
                memberId: member.id,
                division: body.division,
                status: "pending" as const,
                weightClass: body.weightClass,
                appliedByUserId: user.id,
                appliedAt: now,
              },
            ]
        : registrations.filter((registration) => registration.memberId !== member.id);
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: member.branchId,
      actorUserId: user.id,
      action: "tournament.registration.update",
      targetType: "tournament",
      targetId: tournament.id,
      before: {
        memberId: member.id,
        registration: existing
          ? {
              division: existing.division,
              status: existing.status ?? "pending",
              weightClass: existing.weightClass,
            }
          : null,
        registrationCount: registrations.length,
      },
      after: {
        ...(operation === "apply"
          ? {
              registration: {
                division: body.division,
                status: "pending",
                weightClass: body.weightClass,
              },
            }
          : { registration: null }),
        memberId: member.id,
        operation: resolvedOperation,
        registrationCount: nextRegistrations.length,
      },
      result: "success",
      message:
        resolvedOperation === "apply"
          ? "대회 참가를 신청했습니다."
          : resolvedOperation === "update"
            ? "대회 참가 신청 정보를 수정했습니다."
            : "대회 참가 신청을 취소했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...db,
      tournaments: db.tournaments.map((candidate) =>
        candidate.id === tournament.id ? { ...candidate, registrations: nextRegistrations } : candidate,
      ),
      auditLogs: [auditLog, ...db.auditLogs],
    });

    return jsonOk({
      ...createBootstrapPayload(nextDb, user, selectedBranchId ?? member.branchId),
      registration: {
        memberId: member.id,
        operation: resolvedOperation,
        status: operation === "apply" ? "applied" : "cancelled",
        tournamentId: tournament.id,
        unchanged: false,
      },
    });
  });
}

function getRegistrationReviewBatchContext(
  request: NextRequest,
  db: MockDatabase,
  tournamentId: string,
  memberIds: string[],
) {
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { ok: false as const, response };
  }

  if (user.role !== "coach" && user.role !== "owner" && user.role !== "admin") {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", "코치, 대표 또는 총괄 어드민만 참가 신청을 처리할 수 있습니다."),
    };
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { ok: false as const, response: selectedScope.response };
  }

  const tournament = db.tournaments.find((candidate) => candidate.id === tournamentId);

  if (!tournament || !canViewTournament(tournament, selectedScope.branchIds)) {
    return { ok: false as const, response: jsonError(404, "NOT_FOUND", "대회를 찾을 수 없습니다.") };
  }

  const tournamentAccess = resolveTournamentAccess(tournament);
  const accessibleMemberIds = new Set(getAccessibleMemberIds(user, db, selectedScope.branchIds));
  const memberById = new Map(db.members.map((member) => [member.id, member]));
  const registrationByMemberId = new Map(
    (tournament.registrations ?? []).map((registration) => [registration.memberId, registration]),
  );
  const contexts = [];

  for (const memberId of memberIds) {
    const member = memberById.get(memberId);

    if (
      !member ||
      !selectedScope.branchIds.includes(member.branchId) ||
      !accessibleMemberIds.has(member.id)
    ) {
      return { ok: false as const, response: jsonError(404, "NOT_FOUND", "처리할 참가 회원을 찾을 수 없습니다.") };
    }

    if (tournamentAccess.scope === "branch" && tournamentAccess.branchId !== member.branchId) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "회원이 등록된 지점의 대회 신청만 처리할 수 있습니다."),
      };
    }

    const registration = registrationByMemberId.get(member.id);

    if (!registration) {
      return {
        ok: false as const,
        response: jsonError(404, "NOT_FOUND", "처리할 대회 참가 신청을 찾을 수 없습니다."),
      };
    }

    contexts.push({ member, registration });
  }

  return {
    contexts,
    ok: true as const,
    selectedBranchId: selectedScope.selectedBranchId,
    tournament,
    user,
  };
}

async function reviewRegistration(
  request: NextRequest,
  tournamentId: string,
  body: RegistrationReviewBody,
) {
  const initialDb = await readServerDb();
  const initialContext = getRegistrationReviewBatchContext(request, initialDb, tournamentId, body.memberIds);

  if (!initialContext.ok) {
    return initialContext.response;
  }

  if (
    body.status === "submitted" &&
    initialContext.contexts.some(
      (context) =>
        (context.registration.status ?? "pending") !== "confirmed" && context.registration.status !== "submitted",
    )
  ) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "참가 확정된 회원만 협회 제출 상태로 변경할 수 있습니다.");
  }

  const reviewResult = await withServerDbLock(tournamentStateLockKey, async () => {
    const db = await readServerDb();
    const context = getRegistrationReviewBatchContext(request, db, tournamentId, body.memberIds);

    if (!context.ok) {
      return context.response;
    }

    if (
      body.status === "submitted" &&
      context.contexts.some(
        (item) =>
          (item.registration.status ?? "pending") !== "confirmed" && item.registration.status !== "submitted",
      )
    ) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "참가 확정된 회원만 협회 제출 상태로 변경할 수 있습니다.");
    }

    const { contexts, selectedBranchId, tournament, user } = context;
    const now = new Date().toISOString();
    const nextNote = body.status === "pending" ? undefined : body.note;
    const changedContexts = contexts.filter((context) => {
      const currentStatus = context.registration.status ?? "pending";
      return currentStatus !== body.status || (context.registration.reviewNote ?? undefined) !== nextNote;
    });

    if (changedContexts.length === 0) {
      return jsonOk({
        ...createBootstrapPayload(db, user, selectedBranchId),
        registration: {
          memberId: body.memberIds[0],
          memberIds: body.memberIds,
          operation: "review",
          status: body.status,
          tournamentId: tournament.id,
          unchanged: true,
          unchangedCount: body.memberIds.length,
          updatedCount: 0,
        },
      });
    }

    const statusLabel =
      body.status === "confirmed"
        ? "참가 확정"
        : body.status === "rejected"
          ? "신청 반려"
          : body.status === "submitted"
            ? "협회 제출 완료"
            : "재검토";
    const noticeTitle =
      body.status === "confirmed"
        ? "대회 참가 확정"
        : body.status === "rejected"
          ? "대회 참가 신청 반려"
          : body.status === "submitted"
            ? "대회 참가 명단 제출"
            : "대회 참가 재검토";
    const nextRegistrationsByMemberId = new Map(
      changedContexts.map(({ member, registration }) => [
        member.id,
        {
          ...registration,
          reviewedAt: body.status === "pending" ? undefined : now,
          reviewedByUserId: body.status === "pending" ? undefined : user.id,
          reviewNote: nextNote,
          status: body.status,
          updatedAt: now,
        },
      ]),
    );
    const statusNotices: Notice[] = changedContexts.map(({ member, registration }) => ({
      id: createRuntimeId("notice"),
      branchId: member.branchId,
      title: noticeTitle,
      body: `${member.name} 회원의 ${tournament.title} 참가 신청이 ${statusLabel} 상태로 변경되었습니다. 종별 ${registration.division}, 체급 ${registration.weightClass}.${body.note ? ` 안내: ${body.note}` : ""}`,
      audience: ["member", "guardian"],
      createdAt: now,
      createdByUserId: user.id,
      readByUserIds: [],
      targetMemberIds: [member.id],
    }));
    const noticeIdByMemberId = new Map(
      changedContexts.map(({ member }, index) => [member.id, statusNotices[index].id]),
    );
    const auditLogs: AuditLog[] = changedContexts.map(({ member, registration }) => ({
      id: createRuntimeId("audit"),
      branchId: member.branchId,
      actorUserId: user.id,
      action: "tournament.registration.update",
      targetType: "tournament",
      targetId: tournament.id,
      before: {
        memberId: member.id,
        status: registration.status ?? "pending",
      },
      after: {
        memberId: member.id,
        noticeId: noticeIdByMemberId.get(member.id),
        noteProvided: Boolean(body.note),
        operation: "review",
        status: body.status,
      },
      result: "success",
      message:
        body.status === "confirmed"
          ? "대회 참가 신청을 확정했습니다."
          : body.status === "rejected"
            ? "대회 참가 신청을 반려했습니다."
            : body.status === "submitted"
              ? "대회 참가 명단을 협회 제출 상태로 변경했습니다."
              : "대회 참가 신청을 검토 중 상태로 변경했습니다.",
      createdAt: now,
    }));
    const dbWithStatusNotices = {
      ...db,
      tournaments: db.tournaments.map((candidate) =>
        candidate.id === tournament.id
          ? {
              ...candidate,
              registrations: (candidate.registrations ?? []).map((candidateRegistration) =>
                nextRegistrationsByMemberId.get(candidateRegistration.memberId) ?? candidateRegistration,
              ),
            }
          : candidate,
      ),
      notices: [...statusNotices, ...db.notices],
      auditLogs: [...auditLogs, ...db.auditLogs],
    };
    const preparedPush = prepareRegistrationStatusNoticePush(
      dbWithStatusNotices,
      statusNotices,
      user.id,
      now,
    );
    const nextDb = await writeServerDb(preparedPush.db);

    return {
      enqueuedPushCount: preparedPush.enqueuedCount,
      response: jsonOk({
        ...createBootstrapPayload(nextDb, user, selectedBranchId),
        registration: {
          memberId: body.memberIds[0],
          memberIds: body.memberIds,
          operation: "review",
          status: body.status,
          tournamentId: tournament.id,
          unchanged: changedContexts.length === 0,
          unchangedCount: body.memberIds.length - changedContexts.length,
          updatedCount: changedContexts.length,
        },
      }),
    };
  });

  if (reviewResult instanceof Response) {
    return reviewResult;
  }

  if (reviewResult.enqueuedPushCount > 0) {
    after(async () => {
      try {
        await processNotificationOutbox({
          concurrency: notificationOutboxExecutionPolicy.interactive.concurrency,
          limit: Math.min(
            reviewResult.enqueuedPushCount,
            notificationOutboxExecutionPolicy.interactive.limit,
          ),
        });
      } catch {
        // Durable jobs remain available for the scheduled outbox worker.
      }
    });
  }

  return reviewResult.response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> },
) {
  const initialDb = await readServerDb();
  const initialSession = requireSession(request, initialDb);

  if (!initialSession.user) {
    return initialSession.response;
  }

  const body = parseRegistrationApplyBody(await request.json().catch(() => null));

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "참가 회원, 종별, 체급을 올바르게 입력해 주세요.");
  }

  const { tournamentId } = await params;
  return updateRegistration(request, tournamentId, { operation: "apply", body });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> },
) {
  const initialDb = await readServerDb();
  const initialSession = requireSession(request, initialDb);

  if (!initialSession.user) {
    return initialSession.response;
  }

  const body = parseRegistrationCancelBody(await request.json().catch(() => null));

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "취소할 회원 정보가 올바르지 않습니다.");
  }

  const { tournamentId } = await params;
  return updateRegistration(request, tournamentId, { operation: "cancel", body });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> },
) {
  const initialDb = await readServerDb();
  const initialSession = requireSession(request, initialDb);

  if (!initialSession.user) {
    return initialSession.response;
  }

  const body = parseRegistrationReviewBody(await request.json().catch(() => null));

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "참가 회원, 처리 상태와 사유를 올바르게 입력해 주세요. 반려 시 사유가 필요합니다.");
  }

  const { tournamentId } = await params;
  return reviewRegistration(request, tournamentId, body);
}
