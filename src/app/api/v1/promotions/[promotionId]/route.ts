import { NextRequest } from "next/server";
import type { AuditLog, BeltPromotionResult } from "@/lib/domain";
import { canCoachManagePromotionMember } from "@/lib/final-common-promotion-policy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const decidableResults: BeltPromotionResult[] = ["passed", "failed", "cancelled"];

type PromotionPatchBody = {
  result?: BeltPromotionResult;
  score?: number;
  note?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ promotionId: string }> },
) {
  const { promotionId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "coach" && user.role !== "owner" && user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "승급 심사 결과를 기록할 권한이 없습니다.");
  }

  const promotion = (db.promotions ?? []).find((candidate) => candidate.id === promotionId);

  if (!promotion) {
    return jsonError(404, "NOT_FOUND", "승급 심사를 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(promotion.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 심사의 지점에 접근할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== promotion.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 승급 심사만 처리할 수 있습니다.");
  }

  const member = db.members.find((candidate) => candidate.id === promotion.memberId);

  if (!member || member.branchId !== promotion.branchId) {
    return jsonError(409, "CONFLICT", "심사 회원의 현재 소속 정보를 확인할 수 없습니다.");
  }

  if (user.role === "coach" && !canCoachManagePromotionMember(user, db, member)) {
    return jsonError(403, "FORBIDDEN", "담당 수업 또는 담당 회원의 승급 심사만 처리할 수 있습니다.");
  }

  if (promotion.result !== "scheduled") {
    return jsonError(409, "CONFLICT", "이미 결과가 기록된 심사입니다.");
  }

  const body = (await request.json().catch(() => null)) as PromotionPatchBody | null;
  const result = body?.result;

  if (!result || !decidableResults.includes(result)) {
    return jsonError(400, "VALIDATION_ERROR", "심사 결과(승급/보류/취소)를 선택해 주세요.");
  }

  if (body?.score !== undefined && (typeof body.score !== "number" || body.score < 0 || body.score > 100)) {
    return jsonError(400, "VALIDATION_ERROR", "심사 점수는 0~100 사이여야 합니다.");
  }

  if (result === "passed" && member.belt !== promotion.fromBelt) {
    return jsonError(409, "CONFLICT", "심사 등록 후 회원의 띠가 변경되어 승급을 확정할 수 없습니다.");
  }

  const note = body?.note?.trim() || undefined;
  const now = new Date().toISOString();
  const nextPromotion = {
    ...promotion,
    result,
    decidedAt: now,
    evaluatorUserId: user.id,
    ...(body?.score !== undefined ? { score: body.score } : {}),
    ...(note ? { note } : {}),
  };
  const shouldUpdateBelt = result === "passed";
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: promotion.branchId,
    actorUserId: user.id,
    action: "promotion.update",
    targetType: "promotion",
    targetId: promotion.id,
    before: { result: promotion.result },
    after: { result, ...(shouldUpdateBelt ? { belt: promotion.toBelt } : {}) },
    result: "success",
    message: shouldUpdateBelt ? `${promotion.toBelt} 승급을 확정했습니다.` : "승급 심사 결과를 기록했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    promotions: (db.promotions ?? []).map((candidate) => (candidate.id === promotion.id ? nextPromotion : candidate)),
    members: shouldUpdateBelt
      ? db.members.map((candidate) =>
          candidate.id === promotion.memberId ? { ...candidate, belt: promotion.toBelt } : candidate,
        )
      : db.members,
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? promotion.branchId));
}
