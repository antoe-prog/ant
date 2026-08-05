import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { canMutateTournament, resolveTournamentAccess } from "@/lib/tournament-policy";
import {
  canManageTournaments,
  getTournamentBodyTypeError,
  tournamentStateLockKey,
  validateTournamentBody,
  type TournamentBody,
} from "@/server/tournaments";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!canManageTournaments(user.role)) {
    return jsonError(403, "FORBIDDEN", "대회 공지를 수정할 권한이 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const tournament = (db.tournaments ?? []).find((candidate) => candidate.id === tournamentId);

  if (!tournament) {
    return jsonError(404, "NOT_FOUND", "대회 공지를 찾을 수 없습니다.");
  }

  const existingBranchIds = new Set(db.branches.map((branch) => branch.id));
  const accessibleTournamentBranchIds = selectedScope.branchIds.filter((branchId) => existingBranchIds.has(branchId));

  if (!canMutateTournament(user, tournament, accessibleTournamentBranchIds)) {
    return jsonError(403, "FORBIDDEN", "이 대회 공지를 수정할 권한이 없습니다.");
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getTournamentBodyTypeError(rawBody, true);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as TournamentBody;

  return withServerDbLock(tournamentStateLockKey, async () => {
    const latestDb = await readServerDb();
    const latestSession = requireSession(request, latestDb);

    if (!latestSession.user) {
      return latestSession.response;
    }

    if (!canManageTournaments(latestSession.user.role)) {
      return jsonError(403, "FORBIDDEN", "대회 공지를 수정할 권한이 없습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestSession.user, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    const latestTournament = (latestDb.tournaments ?? []).find((candidate) => candidate.id === tournamentId);

    if (!latestTournament) {
      return jsonError(404, "NOT_FOUND", "대회 공지를 찾을 수 없습니다.");
    }

    const latestBranchIds = new Set(latestDb.branches.map((branch) => branch.id));
    const latestAccessibleBranchIds = latestScope.branchIds.filter((branchId) => latestBranchIds.has(branchId));

    if (!canMutateTournament(latestSession.user, latestTournament, latestAccessibleBranchIds)) {
      return jsonError(403, "FORBIDDEN", "이 대회 공지를 수정할 권한이 없습니다.");
    }

    const validated = validateTournamentBody({
      title: body.title ?? latestTournament.title,
      organizer: body.organizer ?? latestTournament.organizer,
      eventDate: body.eventDate ?? latestTournament.eventDate,
      location: body.location ?? latestTournament.location,
      registrationDeadline: body.registrationDeadline ?? latestTournament.registrationDeadline,
      sourceUrl: body.sourceUrl ?? latestTournament.sourceUrl,
      description: body.description ?? latestTournament.description,
    });

    if (!validated.ok) {
      return jsonError(400, "VALIDATION_ERROR", validated.error);
    }

    const now = new Date().toISOString();
    const tournamentAccess = resolveTournamentAccess(latestTournament);
    const nextTournament = {
      ...latestTournament,
      scope: tournamentAccess.scope,
      branchId: tournamentAccess.branchId,
      ...validated.value,
      updatedAt: now,
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: tournamentAccess.branchId,
      actorUserId: latestSession.user.id,
      action: "tournament.update",
      targetType: "tournament",
      targetId: latestTournament.id,
      before: {
        title: latestTournament.title,
        organizer: latestTournament.organizer,
        eventDate: latestTournament.eventDate,
        scope: tournamentAccess.scope,
        branchId: tournamentAccess.branchId,
      },
      after: {
        title: nextTournament.title,
        organizer: nextTournament.organizer,
        eventDate: nextTournament.eventDate,
        scope: nextTournament.scope,
        branchId: nextTournament.branchId,
      },
      result: "success",
      message: "대회 공지를 수정했습니다.",
      createdAt: now,
    };
    const persisted = await writeServerDb({
      ...latestDb,
      tournaments: (latestDb.tournaments ?? []).map((candidate) =>
        candidate.id === latestTournament.id ? nextTournament : candidate,
      ),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(createBootstrapPayload(persisted, latestSession.user, latestScope.selectedBranchId ?? null));
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!canManageTournaments(user.role)) {
    return jsonError(403, "FORBIDDEN", "대회 공지를 삭제할 권한이 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const tournament = (db.tournaments ?? []).find((candidate) => candidate.id === tournamentId);

  if (!tournament) {
    return jsonError(404, "NOT_FOUND", "대회 공지를 찾을 수 없습니다.");
  }

  const existingBranchIds = new Set(db.branches.map((branch) => branch.id));
  const accessibleTournamentBranchIds = selectedScope.branchIds.filter((branchId) => existingBranchIds.has(branchId));

  if (!canMutateTournament(user, tournament, accessibleTournamentBranchIds)) {
    return jsonError(403, "FORBIDDEN", "이 대회 공지를 삭제할 권한이 없습니다.");
  }

  return withServerDbLock(tournamentStateLockKey, async () => {
    const latestDb = await readServerDb();
    const latestSession = requireSession(request, latestDb);

    if (!latestSession.user) {
      return latestSession.response;
    }

    if (!canManageTournaments(latestSession.user.role)) {
      return jsonError(403, "FORBIDDEN", "대회 공지를 삭제할 권한이 없습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestSession.user, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    const latestTournament = (latestDb.tournaments ?? []).find((candidate) => candidate.id === tournamentId);

    if (!latestTournament) {
      return jsonError(404, "NOT_FOUND", "대회 공지를 찾을 수 없습니다.");
    }

    const latestBranchIds = new Set(latestDb.branches.map((branch) => branch.id));
    const latestAccessibleBranchIds = latestScope.branchIds.filter((branchId) => latestBranchIds.has(branchId));

    if (!canMutateTournament(latestSession.user, latestTournament, latestAccessibleBranchIds)) {
      return jsonError(403, "FORBIDDEN", "이 대회 공지를 삭제할 권한이 없습니다.");
    }

    const now = new Date().toISOString();
    const tournamentAccess = resolveTournamentAccess(latestTournament);
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: tournamentAccess.branchId,
      actorUserId: latestSession.user.id,
      action: "tournament.delete",
      targetType: "tournament",
      targetId: latestTournament.id,
      before: {
        title: latestTournament.title,
        organizer: latestTournament.organizer,
        eventDate: latestTournament.eventDate,
        scope: tournamentAccess.scope,
        branchId: tournamentAccess.branchId,
      },
      after: null,
      result: "success",
      message: "대회 공지를 삭제했습니다.",
      createdAt: now,
    };
    const persisted = await writeServerDb({
      ...latestDb,
      tournaments: (latestDb.tournaments ?? []).filter((candidate) => candidate.id !== latestTournament.id),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(createBootstrapPayload(persisted, latestSession.user, latestScope.selectedBranchId ?? null));
  });
}
