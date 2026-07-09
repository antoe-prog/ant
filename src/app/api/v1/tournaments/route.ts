import { NextRequest } from "next/server";
import type { AuditLog, Tournament } from "@/lib/domain";
import { canManageTournaments, validateTournamentBody, type TournamentBody } from "@/server/tournaments";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!canManageTournaments(user.role)) {
    return jsonError(403, "FORBIDDEN", "대회 공지를 등록할 권한이 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const body = (await request.json().catch(() => null)) as TournamentBody | null;

  if (!body) {
    return jsonError(400, "VALIDATION_ERROR", "등록할 대회 정보가 없습니다.");
  }

  const validated = validateTournamentBody(body);

  if (!validated.ok) {
    return jsonError(400, "VALIDATION_ERROR", validated.error);
  }

  const now = new Date().toISOString();
  const tournament: Tournament = {
    id: `tournament-${Date.now()}`,
    ...validated.value,
    createdByUserId: user.id,
    createdAt: now,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: null,
    actorUserId: user.id,
    action: "tournament.create",
    targetType: "tournament",
    targetId: tournament.id,
    before: null,
    after: { title: tournament.title, organizer: tournament.organizer, eventDate: tournament.eventDate },
    result: "success",
    message: "대회 공지를 등록했습니다.",
    createdAt: now,
  };
  const persisted = await writeServerDb({
    ...db,
    tournaments: [tournament, ...(db.tournaments ?? [])],
    auditLogs: [...db.auditLogs, auditLog],
  });

  return jsonOk(createBootstrapPayload(persisted, user, selectedScope.selectedBranchId ?? null));
}
