import { NextRequest } from "next/server";
import type { AuditLog, PilotIncident, PilotIncidentSeverity, UserRole } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { exceedsPilotInputLimit, pilotOperationsInputLimits } from "@/lib/pilot-operations-input-policy";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { pilotOperationsStateLockKey } from "@/server/pilot-operations-state";
import { createRuntimeId } from "@/server/runtime-id";

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

function getPilotIncidentCreateBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "운영 이슈 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  if (body.branchId !== undefined && body.branchId !== null && typeof body.branchId !== "string") {
    return "운영 이슈 지점 값의 형식이 올바르지 않습니다.";
  }

  for (const field of ["description", "owner", "role", "screen", "severity", "title", "workaround"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return "운영 이슈 값의 형식이 올바르지 않습니다.";
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

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getPilotIncidentCreateBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as PilotIncidentCreateBody;

  if (
    exceedsPilotInputLimit(body.branchId, pilotOperationsInputLimits.branchId) ||
    exceedsPilotInputLimit(body.description, pilotOperationsInputLimits.description) ||
    exceedsPilotInputLimit(body.owner, pilotOperationsInputLimits.owner) ||
    exceedsPilotInputLimit(body.screen, pilotOperationsInputLimits.screen) ||
    exceedsPilotInputLimit(body.title, pilotOperationsInputLimits.title) ||
    exceedsPilotInputLimit(body.workaround, pilotOperationsInputLimits.workaround)
  ) {
    return jsonError(400, "VALIDATION_ERROR", "운영 이슈 입력이 허용 길이를 초과했습니다.");
  }

  const title = body.title?.trim() ?? "";
  const description = body.description?.trim() ?? "";
  const owner = body.owner?.trim() ?? "";
  const screen = body.screen?.trim() ?? "";
  const workaround = body.workaround?.trim() ?? "";
  const severity = body.severity;
  const role = body.role ?? "unknown";
  const branchId = body.branchId?.trim() || null;

  if (!title || !description || !owner || !severity || !severityValues.has(severity)) {
    return jsonError(400, "VALIDATION_ERROR", "이슈 제목, 상세, 담당자, 심각도가 필요합니다.");
  }

  if (!incidentRoles.has(role)) {
    return jsonError(400, "VALIDATION_ERROR", "이슈 역할이 올바르지 않습니다.");
  }

  return withServerDbLock(pilotOperationsStateLockKey, async () => {
    const latestDb = await readServerDb();
    const { user: latestUser, response: latestResponse } = requireSession(request, latestDb);

    if (!latestUser) {
      return latestResponse;
    }

    if (latestUser.role !== "admin") {
      return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 이슈를 기록할 수 있습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestUser, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    if (branchId && !latestDb.branches.some((branch) => branch.id === branchId)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "존재하지 않는 지점입니다.", { branchId });
    }

    const now = new Date().toISOString();
    const incident: PilotIncident = {
      id: createRuntimeId("pilot-incident"),
      branchId,
      severity,
      status: "open",
      title,
      description,
      role,
      screen,
      workaround,
      owner,
      reportedByUserId: latestUser.id,
      createdAt: now,
      updatedAt: now,
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId,
      actorUserId: latestUser.id,
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
      ...latestDb,
      pilotIncidents: [incident, ...latestDb.pilotIncidents],
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(createBootstrapPayload(nextDb, latestUser, latestScope.selectedBranchId));
  });
}
