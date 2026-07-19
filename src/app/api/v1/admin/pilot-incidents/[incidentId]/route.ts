import { NextRequest } from "next/server";
import type { AuditLog, PilotIncidentStatus } from "@/lib/domain";
import { exceedsPilotInputLimit, pilotOperationsInputLimits } from "@/lib/pilot-operations-input-policy";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { pilotOperationsStateLockKey } from "@/server/pilot-operations-state";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const statusValues = new Set<PilotIncidentStatus>(["open", "monitoring", "resolved"]);

type PilotIncidentUpdateBody = {
  owner?: string;
  status?: PilotIncidentStatus;
  workaround?: string;
};

function getPilotIncidentUpdateBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "운영 이슈 변경 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  for (const field of ["owner", "status", "workaround"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return "운영 이슈 변경 값의 형식이 올바르지 않습니다.";
    }
  }

  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  const { incidentId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 이슈 상태를 변경할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const targetIncident = db.pilotIncidents.find((incident) => incident.id === incidentId);

  if (!targetIncident) {
    return jsonError(404, "NOT_FOUND", "운영 이슈를 찾을 수 없습니다.");
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getPilotIncidentUpdateBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as PilotIncidentUpdateBody;

  if (
    exceedsPilotInputLimit(body.owner, pilotOperationsInputLimits.owner) ||
    exceedsPilotInputLimit(body.workaround, pilotOperationsInputLimits.workaround)
  ) {
    return jsonError(400, "VALIDATION_ERROR", "운영 이슈 변경 입력이 허용 길이를 초과했습니다.");
  }

  const status = body.status;
  const owner = body.owner?.trim();
  const workaround = body.workaround?.trim();

  if (status && !statusValues.has(status)) {
    return jsonError(400, "VALIDATION_ERROR", "운영 이슈 상태가 올바르지 않습니다.");
  }

  return withServerDbLock(pilotOperationsStateLockKey, async () => {
    const latestDb = await readServerDb();
    const { user: latestUser, response: latestResponse } = requireSession(request, latestDb);

    if (!latestUser) {
      return latestResponse;
    }

    if (latestUser.role !== "admin") {
      return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 이슈 상태를 변경할 수 있습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestUser, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    const latestIncident = latestDb.pilotIncidents.find((incident) => incident.id === incidentId);

    if (!latestIncident) {
      return jsonError(404, "NOT_FOUND", "운영 이슈를 찾을 수 없습니다.");
    }

    const nextStatus = status ?? latestIncident.status;
    const nextWorkaround = workaround ?? latestIncident.workaround;

    if ((nextStatus === "monitoring" || nextStatus === "resolved") && nextWorkaround.trim().length < 5) {
      return jsonError(400, "VALIDATION_ERROR", "모니터링 또는 해결 상태에는 5자 이상의 우회책/조치 메모가 필요합니다.");
    }

    const now = new Date().toISOString();
    const nextIncident = {
      ...latestIncident,
      owner: owner || latestIncident.owner,
      status: nextStatus,
      workaround: nextWorkaround,
      updatedAt: now,
      resolvedAt: nextStatus === "resolved" ? now : undefined,
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: latestIncident.branchId,
      actorUserId: latestUser.id,
      action: "pilot_incident.update",
      targetType: "pilot_incident",
      targetId: latestIncident.id,
      before: {
        owner: latestIncident.owner,
        status: latestIncident.status,
        workaround: latestIncident.workaround || null,
      },
      after: {
        owner: nextIncident.owner,
        status: nextIncident.status,
        workaround: nextIncident.workaround || null,
      },
      result: "success",
      message: "운영 이슈 상태를 변경했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...latestDb,
      pilotIncidents: latestDb.pilotIncidents.map((incident) => (incident.id === incidentId ? nextIncident : incident)),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(createBootstrapPayload(nextDb, latestUser, latestScope.selectedBranchId));
  });
}
