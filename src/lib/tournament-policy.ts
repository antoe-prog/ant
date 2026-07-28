import type { AppUser, Tournament } from "@/lib/domain";
import { hasGlobalAdminDataAccess } from "./google-play-review-access.ts";

export type TournamentAccess = {
  scope: "global" | "branch";
  branchId: string | null;
  createdByUserId: string | null;
};

type TournamentActor = Pick<AppUser, "accountPurpose" | "id" | "role">;

export type TournamentCreateAccess =
  | { ok: false; status: 400 | 403; error: string }
  | { ok: true; scope: "global" | "branch"; branchId: string | null };

export function resolveTournamentAccess(tournament: Tournament): TournamentAccess {
  const branchId = typeof tournament.branchId === "string" && tournament.branchId.trim()
    ? tournament.branchId.trim()
    : null;
  const createdByUserId = typeof tournament.createdByUserId === "string" && tournament.createdByUserId.trim()
    ? tournament.createdByUserId.trim()
    : null;

  // Legacy tournaments were visible system-wide. Keep them readable, but only admins may mutate them.
  if (tournament.scope !== "branch" || !branchId) {
    return { scope: "global", branchId: null, createdByUserId };
  }

  return { scope: "branch", branchId, createdByUserId };
}

export function canViewTournament(tournament: Tournament, branchIds: readonly string[]) {
  const access = resolveTournamentAccess(tournament);
  return access.scope === "global" || (access.branchId !== null && branchIds.includes(access.branchId));
}

export function getTournamentCreateAccess(
  actor: TournamentActor,
  selectedBranchId: string | null,
  accessibleBranchIds: readonly string[],
): TournamentCreateAccess {
  if (actor.role !== "admin" && actor.role !== "owner" && actor.role !== "coach") {
    return { ok: false, status: 403, error: "대회 공지를 등록할 권한이 없습니다." };
  }

  if (selectedBranchId) {
    if (!accessibleBranchIds.includes(selectedBranchId)) {
      return { ok: false, status: 403, error: "선택한 지점에 접근할 수 없습니다." };
    }

    return { ok: true, scope: "branch", branchId: selectedBranchId };
  }

  if (hasGlobalAdminDataAccess(actor)) {
    return { ok: true, scope: "global", branchId: null };
  }

  return { ok: false, status: 400, error: "대회를 등록할 지점을 먼저 선택해 주세요." };
}

export function canMutateTournament(
  actor: TournamentActor,
  tournament: Tournament,
  accessibleBranchIds: readonly string[],
) {
  if (tournament.source === "korea_judo_association") {
    return false;
  }

  if (hasGlobalAdminDataAccess(actor)) {
    return true;
  }

  const access = resolveTournamentAccess(tournament);

  if (access.scope !== "branch" || !access.branchId || !accessibleBranchIds.includes(access.branchId)) {
    return false;
  }

  if (actor.role === "owner" || actor.role === "admin") {
    return true;
  }

  return actor.role === "coach" && access.createdByUserId === actor.id;
}
