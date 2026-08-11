import { NextRequest } from "next/server";
import { hasGlobalAdminDataAccess } from "@/lib/admin-access";
import type { AuditLog, PilotReadinessStatus } from "@/lib/domain";
import { exceedsPilotInputLimit, pilotOperationsInputLimits } from "@/lib/pilot-operations-input-policy";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { pilotOperationsStateLockKey } from "@/server/pilot-operations-state";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const allowedStatuses = new Set<PilotReadinessStatus>(["pending", "verified", "blocked"]);

type PilotReadinessUpdateBody = {
  checkId?: string;
  evidence?: string;
  owner?: string;
  status?: PilotReadinessStatus;
};

function getPilotReadinessBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "운영 확인 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  for (const field of ["checkId", "evidence", "owner", "status"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return "운영 확인 값의 형식이 올바르지 않습니다.";
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!hasGlobalAdminDataAccess(user)) {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 준비 상태를 조회할 수 있습니다.");
  }

  return jsonOk({
    checks: db.pilotReadinessChecks,
    summary: {
      blocked: db.pilotReadinessChecks.filter((check) => check.status === "blocked").length,
      pending: db.pilotReadinessChecks.filter((check) => check.status === "pending").length,
      verified: db.pilotReadinessChecks.filter((check) => check.status === "verified").length,
      total: db.pilotReadinessChecks.length,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!hasGlobalAdminDataAccess(user)) {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 준비 상태를 변경할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getPilotReadinessBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as PilotReadinessUpdateBody;

  if (
    exceedsPilotInputLimit(body.checkId, pilotOperationsInputLimits.checkId) ||
    exceedsPilotInputLimit(body.evidence, pilotOperationsInputLimits.evidence) ||
    exceedsPilotInputLimit(body.owner, pilotOperationsInputLimits.owner)
  ) {
    return jsonError(400, "VALIDATION_ERROR", "운영 확인 입력이 허용 길이를 초과했습니다.");
  }

  const checkId = body.checkId?.trim() ?? "";
  const status = body.status;
  const evidence = body.evidence?.trim() ?? "";
  const owner = body.owner?.trim() ?? "";

  if (!checkId || !status || !allowedStatuses.has(status)) {
    return jsonError(400, "VALIDATION_ERROR", "운영 확인 항목과 상태가 필요합니다.");
  }

  if (status !== "pending" && evidence.length < 5) {
    return jsonError(400, "VALIDATION_ERROR", "확인 또는 확인 필요 상태에는 5자 이상의 확인 메모가 필요합니다.");
  }

  return withServerDbLock(pilotOperationsStateLockKey, async () => {
    const latestDb = await readServerDb();
    const { user: latestUser, response: latestResponse } = requireSession(request, latestDb);

    if (!latestUser) {
      return latestResponse;
    }

    if (!hasGlobalAdminDataAccess(latestUser)) {
      return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 준비 상태를 변경할 수 있습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestUser, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    const targetCheck = latestDb.pilotReadinessChecks.find((check) => check.id === checkId);

    if (!targetCheck) {
      return jsonError(404, "NOT_FOUND", "운영 확인 항목을 찾을 수 없습니다.");
    }

    const now = new Date().toISOString();
    const nextCheck = {
      ...targetCheck,
      status,
      evidence,
      owner: owner || targetCheck.owner,
      checkedAt: status === "pending" ? undefined : now,
      checkedByUserId: status === "pending" ? undefined : latestUser.id,
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: null,
      actorUserId: latestUser.id,
      action: "pilot_readiness.update",
      targetType: "pilot_readiness",
      targetId: checkId,
      before: {
        evidence: targetCheck.evidence || null,
        owner: targetCheck.owner,
        status: targetCheck.status,
      },
      after: {
        evidence: nextCheck.evidence || null,
        owner: nextCheck.owner,
        status: nextCheck.status,
      },
      result: "success",
      message: "운영 준비 상태를 변경했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...latestDb,
      pilotReadinessChecks: latestDb.pilotReadinessChecks.map((check) => (check.id === checkId ? nextCheck : check)),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(createBootstrapPayload(nextDb, latestUser, latestScope.selectedBranchId));
  });
}
