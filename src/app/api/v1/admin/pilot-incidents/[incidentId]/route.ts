import { NextRequest } from "next/server";
import type { AuditLog, PilotIncidentStatus } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const statusValues = new Set<PilotIncidentStatus>(["open", "monitoring", "resolved"]);

type PilotIncidentUpdateBody = {
  owner?: string;
  status?: PilotIncidentStatus;
  workaround?: string;
};

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

  const body = (await request.json().catch(() => null)) as PilotIncidentUpdateBody | null;
  const status = body?.status;
  const owner = body?.owner?.trim();
  const workaround = body?.workaround?.trim();

  if (status && !statusValues.has(status)) {
    return jsonError(400, "VALIDATION_ERROR", "운영 이슈 상태가 올바르지 않습니다.");
  }

  const nextStatus = status ?? targetIncident.status;
  const nextWorkaround = workaround ?? targetIncident.workaround;

  if ((nextStatus === "monitoring" || nextStatus === "resolved") && nextWorkaround.trim().length < 5) {
    return jsonError(400, "VALIDATION_ERROR", "모니터링 또는 해결 상태에는 5자 이상의 우회책/조치 메모가 필요합니다.");
  }

  const now = new Date().toISOString();
  const nextIncident = {
    ...targetIncident,
    owner: owner || targetIncident.owner,
    status: nextStatus,
    workaround: nextWorkaround,
    updatedAt: now,
    resolvedAt: nextStatus === "resolved" ? now : undefined,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: targetIncident.branchId,
    actorUserId: user.id,
    action: "pilot_incident.update",
    targetType: "pilot_incident",
    targetId: targetIncident.id,
    before: {
      owner: targetIncident.owner,
      status: targetIncident.status,
      workaround: targetIncident.workaround || null,
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
    ...db,
    pilotIncidents: db.pilotIncidents.map((incident) => (incident.id === incidentId ? nextIncident : incident)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId));
}
