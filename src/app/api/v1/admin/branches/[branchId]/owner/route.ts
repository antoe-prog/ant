import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { getBranchOwnerBodyError } from "@/lib/branch-input-policy";
import { branchManagementStateLockKey } from "@/server/branch-management";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

async function requireBranchOwnerRequestContext(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string }> },
) {
  const { branchId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { context: null, response };
  }

  if (user.role !== "admin") {
    return {
      context: null,
      response: jsonError(403, "FORBIDDEN", "총괄 어드민만 지점 대표를 배정할 수 있습니다."),
    };
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { context: null, response: selectedScope.response };
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return {
      context: null,
      response: jsonError(403, "FORBIDDEN", "선택한 지점의 대표만 배정할 수 있습니다."),
    };
  }

  return {
    context: { branchId, db, selectedBranchId: selectedScope.selectedBranchId, user },
    response: null,
  };
}

async function assignBranchOwner(
  request: NextRequest,
  routeContext: { params: Promise<{ branchId: string }> },
  ownerUserId: string,
) {
  const currentContext = await requireBranchOwnerRequestContext(request, routeContext);

  if (!currentContext.context) {
    return currentContext.response;
  }

  const { branchId, db, selectedBranchId, user } = currentContext.context;

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

  if (owner.branchIds.includes(branchId)) {
    return jsonOk(createBootstrapPayload(db, user, selectedBranchId));
  }

  const previousOwnerIds = db.users
    .filter((candidate) => candidate.role === "owner" && candidate.branchIds.includes(branchId))
    .map((candidate) => candidate.id);
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
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

  return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId));
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ branchId: string }> },
) {
  const initialContext = await requireBranchOwnerRequestContext(request, context);

  if (!initialContext.context) {
    return initialContext.response;
  }

  const rawBody = await request.json().catch(() => null);
  const bodyError = getBranchOwnerBodyError(rawBody);

  if (bodyError) {
    return jsonError(400, "VALIDATION_ERROR", bodyError);
  }

  const ownerUserId = (rawBody as { ownerUserId?: string }).ownerUserId?.trim() ?? "";

  if (!ownerUserId) {
    return jsonError(400, "VALIDATION_ERROR", "대표 사용자 ID가 필요합니다.");
  }

  return withServerDbLock(branchManagementStateLockKey, () =>
    assignBranchOwner(request, context, ownerUserId),
  );
}
