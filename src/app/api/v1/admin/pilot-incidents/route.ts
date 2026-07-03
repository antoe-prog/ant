import { NextRequest } from "next/server";
import type { AuditLog, PilotIncident, PilotIncidentSeverity, UserRole } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const severityValues = new Set<PilotIncidentSeverity>(["p0", "p1", "p2"]);
const incidentRoles = new Set<UserRole | "unknown">([...userRoles, "unknown"]);

type PilotIncidentCreateBody = {
  branchId?: string | null;
  description?: string;
  owner?: string;
  role?: UserRole | "unknown";
  screen?: string;
  severity?: PilotIncidentSeverity;
  title?: string;
  workaround?: string;
};

export async function GET(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 이슈 로그를 조회할 수 있습니다.");
  }

  return jsonOk({
    incidents: db.pilotIncidents,
    summary: {
      open: db.pilotIncidents.filter((incident) => incident.status === "open").length,
      monitoring: db.pilotIncidents.filter((incident) => incident.status === "monitoring").length,
      resolved: db.pilotIncidents.filter((incident) => incident.status === "resolved").length,
      p0: db.pilotIncidents.filter((incident) => incident.severity === "p0").length,
      total: db.pilotIncidents.length,
    },
  });
}

export async function POST(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 이슈를 기록할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const body = (await request.json().catch(() => null)) as PilotIncidentCreateBody | null;
  const title = body?.title?.trim() ?? "";
  const description = body?.description?.trim() ?? "";
  const owner = body?.owner?.trim() ?? "";
  const screen = body?.screen?.trim() ?? "";
  const workaround = body?.workaround?.trim() ?? "";
  const severity = body?.severity;
  const role = body?.role ?? "unknown";
  const branchId = body?.branchId?.trim() || null;

  if (!title || !description || !owner || !severity || !severityValues.has(severity)) {
    return jsonError(400, "VALIDATION_ERROR", "이슈 제목, 상세, 담당자, 심각도가 필요합니다.");
  }

  if (!incidentRoles.has(role)) {
    return jsonError(400, "VALIDATION_ERROR", "이슈 역할이 올바르지 않습니다.");
  }

  if (branchId && !db.branches.some((branch) => branch.id === branchId)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "존재하지 않는 지점입니다.", { branchId });
  }

  const now = new Date().toISOString();
  const incident: PilotIncident = {
    id: `pilot-incident-${Date.now()}`,
    branchId,
    severity,
    status: "open",
    title,
    description,
    role,
    screen,
    workaround,
    owner,
    reportedByUserId: user.id,
    createdAt: now,
    updatedAt: now,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "pilot_incident.create",
    targetType: "pilot_incident",
    targetId: incident.id,
    before: null,
    after: {
      branchId,
      owner,
      role,
      screen: screen || null,
      severity,
      status: incident.status,
      title,
    },
    result: "success",
    message: "운영 이슈를 기록했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    pilotIncidents: [incident, ...db.pilotIncidents],
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId));
}
