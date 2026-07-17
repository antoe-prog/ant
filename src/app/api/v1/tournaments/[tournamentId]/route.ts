import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { canMutateTournament, resolveTournamentAccess } from "@/lib/tournament-policy";
import { canManageTournaments, validateTournamentBody, type TournamentBody } from "@/server/tournaments";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

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

  const body = (await request.json().catch(() => null)) as TournamentBody | null;

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "변경할 대회 정보가 없습니다.");
  }

  const validated = validateTournamentBody({
    title: body.title ?? tournament.title,
    organizer: body.organizer ?? tournament.organizer,
    eventDate: body.eventDate ?? tournament.eventDate,
    location: body.location ?? tournament.location,
    registrationDeadline: body.registrationDeadline ?? tournament.registrationDeadline,
    sourceUrl: body.sourceUrl ?? tournament.sourceUrl,
    description: body.description ?? tournament.description,
  });

  if (!validated.ok) {
    return jsonError(400, "VALIDATION_ERROR", validated.error);
  }

  const now = new Date().toISOString();
  const tournamentAccess = resolveTournamentAccess(tournament);
  const nextTournament = {
    ...tournament,
    scope: tournamentAccess.scope,
    branchId: tournamentAccess.branchId,
    ...validated.value,
    updatedAt: now,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: tournamentAccess.branchId,
    actorUserId: user.id,
    action: "tournament.update",
    targetType: "tournament",
    targetId: tournament.id,
    before: {
      title: tournament.title,
      organizer: tournament.organizer,
      eventDate: tournament.eventDate,
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
    ...db,
    tournaments: (db.tournaments ?? []).map((candidate) => (candidate.id === tournament.id ? nextTournament : candidate)),
    auditLogs: [...db.auditLogs, auditLog],
  });

  return jsonOk(createBootstrapPayload(persisted, user, selectedScope.selectedBranchId ?? null));
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

  const now = new Date().toISOString();
  const tournamentAccess = resolveTournamentAccess(tournament);
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: tournamentAccess.branchId,
    actorUserId: user.id,
    action: "tournament.delete",
    targetType: "tournament",
    targetId: tournament.id,
    before: {
      title: tournament.title,
      organizer: tournament.organizer,
      eventDate: tournament.eventDate,
      scope: tournamentAccess.scope,
      branchId: tournamentAccess.branchId,
    },
    after: null,
    result: "success",
    message: "대회 공지를 삭제했습니다.",
    createdAt: now,
  };
  const persisted = await writeServerDb({
    ...db,
    tournaments: (db.tournaments ?? []).filter((candidate) => candidate.id !== tournament.id),
    auditLogs: [...db.auditLogs, auditLog],
  });

  return jsonOk(createBootstrapPayload(persisted, user, selectedScope.selectedBranchId ?? null));
}
