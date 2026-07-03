import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

type OwnerAssignBody = {
  ownerUserId?: string;
};

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string }> },
) {
  const { branchId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 지점 대표를 배정할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 대표만 배정할 수 있습니다.");
  }

  const body = (await request.json().catch(() => null)) as OwnerAssignBody | null;
  const ownerUserId = body?.ownerUserId?.trim() ?? "";

  if (!ownerUserId) {
    return jsonError(400, "VALIDATION_ERROR", "대표 사용자 ID가 필요합니다.");
  }

  const branch = db.branches.find((candidate) => candidate.id === branchId);

  if (!branch) {
    return jsonError(404, "NOT_FOUND", "지점을 찾을 수 없습니다.");
  }

  const owner = db.users.find((candidate) => candidate.id === ownerUserId);

  if (!owner) {
    return jsonError(404, "NOT_FOUND", "대표로 배정할 사용자를 찾을 수 없습니다.");
  }

  if (owner.role !== "owner") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "대표 역할 사용자만 지점 대표로 배정할 수 있습니다.");
  }

  const previousOwnerIds = db.users
    .filter((candidate) => candidate.role === "owner" && candidate.branchIds.includes(branchId))
    .map((candidate) => candidate.id);
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "branch.owner.assign",
    targetType: "branch",
    targetId: branchId,
    before: { ownerUserIds: previousOwnerIds },
    after: { ownerUserId: owner.id },
    result: "success",
    message: "지점 대표를 배정했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    users: db.users.map((candidate) =>
      candidate.id === owner.id
        ? { ...candidate, branchIds: [...new Set([...candidate.branchIds, branchId])] }
        : candidate,
    ),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId));
}
