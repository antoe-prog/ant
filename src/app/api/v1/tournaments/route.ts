import { NextRequest } from "next/server";
import type { AuditLog, Tournament } from "@/lib/domain";
import { getTournamentCreateAccess } from "@/lib/tournament-policy";
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

export async function POST(request: NextRequest) {
  const authDb = await readServerDb();
  const { user, response } = requireSession(request, authDb);

  if (!user) {
    return response;
  }

  if (!canManageTournaments(user.role)) {
    return jsonError(403, "FORBIDDEN", "대회 공지를 등록할 권한이 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, authDb);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const existingBranchIds = new Set(authDb.branches.map((branch) => branch.id));
  const accessibleTournamentBranchIds = selectedScope.branchIds.filter((branchId) => existingBranchIds.has(branchId));
  const tournamentAccess = getTournamentCreateAccess(user, selectedScope.selectedBranchId, accessibleTournamentBranchIds);

  if (!tournamentAccess.ok) {
    return jsonError(tournamentAccess.status, tournamentAccess.status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR", tournamentAccess.error);
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getTournamentBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as TournamentBody;
  const validated = validateTournamentBody(body);

  if (!validated.ok) {
    return jsonError(400, "VALIDATION_ERROR", validated.error);
  }

  return withServerDbLock(tournamentStateLockKey, async () => {
    const db = await readServerDb();
    const latestSession = requireSession(request, db);

    if (!latestSession.user) {
      return latestSession.response;
    }

    if (!canManageTournaments(latestSession.user.role)) {
      return jsonError(403, "FORBIDDEN", "대회 공지를 등록할 권한이 없습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestSession.user, db);

    if (latestScope.response) {
      return latestScope.response;
    }

    const latestBranchIds = new Set(db.branches.map((branch) => branch.id));
    const latestAccessibleBranchIds = latestScope.branchIds.filter((branchId) => latestBranchIds.has(branchId));
    const latestAccess = getTournamentCreateAccess(
      latestSession.user,
      latestScope.selectedBranchId,
      latestAccessibleBranchIds,
    );

    if (!latestAccess.ok) {
      return jsonError(
        latestAccess.status,
        latestAccess.status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR",
        latestAccess.error,
      );
    }

    const now = new Date().toISOString();
    const tournament: Tournament = {
      id: createRuntimeId("tournament"),
      scope: latestAccess.scope,
      branchId: latestAccess.branchId,
      ...validated.value,
      createdByUserId: latestSession.user.id,
      createdAt: now,
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: tournament.branchId ?? null,
      actorUserId: latestSession.user.id,
      action: "tournament.create",
      targetType: "tournament",
      targetId: tournament.id,
      before: null,
      after: {
        title: tournament.title,
        organizer: tournament.organizer,
        eventDate: tournament.eventDate,
        scope: tournament.scope,
        branchId: tournament.branchId,
      },
      result: "success",
      message: "대회 공지를 등록했습니다.",
      createdAt: now,
    };
    const persisted = await writeServerDb({
      ...db,
      tournaments: [tournament, ...(db.tournaments ?? [])],
      auditLogs: [...db.auditLogs, auditLog],
    });

    return jsonOk(createBootstrapPayload(persisted, latestSession.user, latestScope.selectedBranchId ?? null));
  });
}
