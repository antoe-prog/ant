import { NextRequest } from "next/server";
import type { AuditLog, BeltPromotion } from "@/lib/domain";
import { judoBelts } from "@/lib/domain";
import {
  canCoachManagePromotionMember,
  finalPromotionStateLockKey,
  getFinalPromotionExamKind,
  isExactNextCompatiblePromotionBelt,
} from "@/lib/final-common-promotion-policy";
import { formatDateKey } from "@/lib/format";
import { isSchedulablePromotionExamDate, promotionInputLimits } from "@/lib/promotions";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

type PromotionCreateBody = {
  memberId?: string;
  toBelt?: string;
  examDate?: string;
  note?: string;
};

function getPromotionCreateBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "승급 심사 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;
  const fields = [
    ["memberId", "회원"],
    ["toBelt", "목표 띠"],
    ["examDate", "심사일"],
    ["note", "메모"],
  ] as const;

  for (const [field, label] of fields) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return `${label} 값의 형식이 올바르지 않습니다.`;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const authDb = await readServerDb();
  const initialSession = requireSession(request, authDb);

  if (!initialSession.user) {
    return initialSession.response;
  }

  if (initialSession.user.role !== "coach" && initialSession.user.role !== "owner" && initialSession.user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "승급 심사를 등록할 권한이 없습니다.");
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getPromotionCreateBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as PromotionCreateBody;
  const memberId = body?.memberId?.trim() ?? "";
  const toBelt = body?.toBelt?.trim() ?? "";
  const examDate = body?.examDate?.trim() ?? "";
  const note = body?.note?.trim() || undefined;

  if (!memberId || !toBelt || !examDate) {
    return jsonError(400, "VALIDATION_ERROR", "회원, 목표 띠, 심사일을 입력해 주세요.");
  }

  if (memberId.length > promotionInputLimits.memberId) {
    return jsonError(400, "VALIDATION_ERROR", "회원 식별자가 너무 깁니다.");
  }

  if (note && note.length > promotionInputLimits.note) {
    return jsonError(400, "VALIDATION_ERROR", `공개 메모는 ${promotionInputLimits.note}자 이하로 입력해 주세요.`);
  }

  if (!judoBelts.includes(toBelt as (typeof judoBelts)[number])) {
    return jsonError(400, "VALIDATION_ERROR", "목표 띠가 올바르지 않습니다.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
    return jsonError(400, "VALIDATION_ERROR", "심사일 형식이 올바르지 않습니다.");
  }

  if (!isSchedulablePromotionExamDate(examDate, formatDateKey(new Date()))) {
    return jsonError(400, "VALIDATION_ERROR", "심사일은 오늘 이후로 선택해 주세요.");
  }

  if (!getFinalPromotionExamKind(examDate)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "심사일은 둘째 또는 넷째 금요일만 선택할 수 있습니다.");
  }

  return withServerDbLock(finalPromotionStateLockKey, async () => {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return response;
    }

    if (user.role !== "coach" && user.role !== "owner" && user.role !== "admin") {
      return jsonError(403, "FORBIDDEN", "승급 심사를 등록할 권한이 없습니다.");
    }

    const member = db.members.find((candidate) => candidate.id === memberId);

    if (!member) {
      return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
    }

    if (!getAccessibleBranchIds(user, db).includes(member.branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 회원의 지점에 접근할 수 없습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== member.branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 회원만 승급 심사를 등록할 수 있습니다.");
    }

    if (user.role === "coach" && !canCoachManagePromotionMember(user, db, member)) {
      return jsonError(403, "FORBIDDEN", "담당 수업 또는 담당 회원의 승급 심사만 등록할 수 있습니다.");
    }

    if (!isExactNextCompatiblePromotionBelt(member.belt, toBelt)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "현재 띠의 정확한 다음 단계만 승급 심사로 등록할 수 있습니다.");
    }

    const hasOpenExam = (db.promotions ?? []).some(
      (promotion) => promotion.memberId === member.id && promotion.result === "scheduled",
    );

    if (hasOpenExam) {
      return jsonError(409, "CONFLICT", "이미 진행 중인 승급 심사가 있습니다.");
    }

    const now = new Date().toISOString();
    const promotion: BeltPromotion = {
      id: createRuntimeId("promotion"),
      branchId: member.branchId,
      memberId: member.id,
      fromBelt: member.belt,
      toBelt,
      examDate,
      result: "scheduled",
      evaluatorUserId: user.id,
      createdByUserId: user.id,
      createdAt: now,
      ...(note ? { note } : {}),
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: member.branchId,
      actorUserId: user.id,
      action: "promotion.create",
      targetType: "promotion",
      targetId: promotion.id,
      before: null,
      after: { memberId: member.id, fromBelt: promotion.fromBelt, toBelt, examDate },
      result: "success",
      message: "승급 심사를 등록했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...db,
      promotions: [promotion, ...(db.promotions ?? [])],
      auditLogs: [auditLog, ...db.auditLogs],
    });

    return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? member.branchId));
  });
}
