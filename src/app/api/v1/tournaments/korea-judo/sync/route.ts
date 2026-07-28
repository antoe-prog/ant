import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { hasGlobalAdminDataAccess } from "@/lib/google-play-review-access";
import {
  fetchKoreaJudoTournaments,
  koreaJudoAssociationTournamentSource,
  mergeKoreaJudoTournaments,
} from "@/server/korea-judo-tournaments";
import { tournamentStateLockKey } from "@/server/tournaments";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import {
  createBootstrapPayload,
  jsonError,
  jsonOk,
  requireSelectedBranchScope,
  requireSession,
} from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

function readSyncYear(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const year = (value as Record<string, unknown>).year;

  return typeof year === "number" && Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : null;
}

export async function POST(request: NextRequest) {
  const authDb = await readServerDb();
  const { user, response } = requireSession(request, authDb);

  if (!user) {
    return response;
  }

  if (!hasGlobalAdminDataAccess(user)) {
    return jsonError(403, "FORBIDDEN", "대한유도회 일정을 동기화할 권한이 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, authDb);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const rawBody = await request.json().catch(() => null);
  const year = readSyncYear(rawBody);

  if (!year) {
    return jsonError(400, "VALIDATION_ERROR", "동기화할 연도를 올바르게 입력해 주세요.");
  }

  let sourceResult: Awaited<ReturnType<typeof fetchKoreaJudoTournaments>>;

  try {
    sourceResult = await fetchKoreaJudoTournaments(year);
  } catch (error) {
    return jsonError(
      502,
      "TOURNAMENT_SOURCE_UNAVAILABLE",
      error instanceof Error ? error.message : "대한유도회 일정을 불러오지 못했습니다.",
    );
  }

  return withServerDbLock(tournamentStateLockKey, async () => {
    const db = await readServerDb();
    const latestSession = requireSession(request, db);

    if (!latestSession.user) {
      return latestSession.response;
    }

    if (!hasGlobalAdminDataAccess(latestSession.user)) {
      return jsonError(403, "FORBIDDEN", "대한유도회 일정을 동기화할 권한이 없습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestSession.user, db);

    if (latestScope.response) {
      return latestScope.response;
    }

    const syncedAt = new Date().toISOString();
    const mergeResult = mergeKoreaJudoTournaments(
      db.tournaments ?? [],
      sourceResult.records,
      year,
      latestSession.user.id,
      syncedAt,
    );
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: null,
      actorUserId: latestSession.user.id,
      action: "tournament.sync",
      targetType: "tournament",
      targetId: `${koreaJudoAssociationTournamentSource}:${year}`,
      before: null,
      after: {
        createdCount: mergeResult.createdCount,
        importedCount: sourceResult.records.length,
        skippedCount: sourceResult.skippedCount,
        unchangedCount: mergeResult.unchangedCount,
        updatedCount: mergeResult.updatedCount,
        year,
      },
      result: "success",
      message: `${year}년 대한유도회 대회 일정을 동기화했습니다.`,
      createdAt: syncedAt,
    };
    const persisted = await writeServerDb({
      ...db,
      tournaments: mergeResult.tournaments,
      auditLogs: [...db.auditLogs, auditLog],
    });

    return jsonOk({
      ...createBootstrapPayload(persisted, latestSession.user, latestScope.selectedBranchId ?? null),
      sync: {
        createdCount: mergeResult.createdCount,
        importedCount: sourceResult.records.length,
        skippedCount: sourceResult.skippedCount,
        syncedAt,
        unchangedCount: mergeResult.unchangedCount,
        updatedCount: mergeResult.updatedCount,
        year,
      },
    });
  });
}
