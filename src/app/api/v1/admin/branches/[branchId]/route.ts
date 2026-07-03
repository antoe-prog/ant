import { NextRequest } from "next/server";
import type { AuditLog, BranchSettings, BranchStatus } from "@/lib/domain";
import { normalizeBranchSettings } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

type BranchUpdateBody = {
  district?: unknown;
  name?: unknown;
  reason?: unknown;
  settings?: Partial<Record<keyof BranchSettings, unknown>>;
  status?: unknown;
  timezone?: unknown;
};

const branchStatuses: BranchStatus[] = ["active", "inactive"];

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(
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
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 지점을 수정할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 정보만 수정할 수 있습니다.");
  }

  const body = (await request.json().catch(() => null)) as BranchUpdateBody | null;
  const reason = cleanText(body?.reason);

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "지점 수정 사유가 필요합니다.");
  }

  const branch = db.branches.find((candidate) => candidate.id === branchId);

  if (!branch) {
    return jsonError(404, "NOT_FOUND", "지점을 찾을 수 없습니다.");
  }

  const nextName = body && "name" in body ? cleanText(body.name) : branch.name;
  const nextDistrict = body && "district" in body ? cleanText(body.district) : branch.district;
  const nextTimezone = body && "timezone" in body ? cleanText(body.timezone) || "Asia/Seoul" : branch.timezone ?? "Asia/Seoul";
  const nextStatus = body && "status" in body ? body.status : branch.status ?? "active";

  if (!nextName || !nextDistrict) {
    return jsonError(400, "VALIDATION_ERROR", "지점명과 지역은 비워둘 수 없습니다.");
  }

  if (!branchStatuses.includes(nextStatus as BranchStatus)) {
    return jsonError(400, "VALIDATION_ERROR", "지점 상태가 올바르지 않습니다.");
  }

  if (db.branches.some((candidate) => candidate.id !== branchId && candidate.name === nextName)) {
    return jsonError(409, "CONFLICT", "같은 이름의 지점이 이미 있습니다.");
  }

  const currentSettings = normalizeBranchSettings(branch.settings);
  const nextSettings: BranchSettings = {
    attendanceEditRequiresReason:
      typeof body?.settings?.attendanceEditRequiresReason === "boolean"
        ? body.settings.attendanceEditRequiresReason
        : currentSettings.attendanceEditRequiresReason,
  };
  const nextBranch = {
    ...branch,
    district: nextDistrict,
    name: nextName,
    settings: nextSettings,
    status: nextStatus as BranchStatus,
    timezone: nextTimezone,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "branch.update",
    targetType: "branch",
    targetId: branchId,
    before: {
      district: branch.district,
      name: branch.name,
      settings: currentSettings,
      status: branch.status ?? "active",
      timezone: branch.timezone ?? "Asia/Seoul",
    },
    after: {
      district: nextBranch.district,
      name: nextBranch.name,
      reason,
      settings: nextBranch.settings,
      status: nextBranch.status,
      timezone: nextBranch.timezone,
    },
    result: "success",
    message: nextBranch.status === "inactive" ? "지점을 비활성화했습니다." : "지점 정보를 수정했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    branches: db.branches.map((candidate) => (candidate.id === branchId ? nextBranch : candidate)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId));
}
