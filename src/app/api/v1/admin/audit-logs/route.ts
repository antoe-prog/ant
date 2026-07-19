import { NextRequest } from "next/server";
import { isDuplicateAuditRead } from "@/lib/audit-read-deduplication";
import { auditLogQueryLimits, isAuditDateRangeValid, parseAuditDateParam } from "@/lib/audit-log-query";
import { auditActions, auditResults } from "@/lib/audit-log-presentation";
import type { AuditAction, AuditLog } from "@/lib/domain";
import { authSecurityLockKey } from "@/server/auth-session";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { jsonError, jsonOk, requireSession } from "@/server/api";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

function parseLimit(value: string | null) {
  const limit = Number(value ?? 50);

  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

function isAuditReadLog(log: AuditLog) {
  return log.action === "audit_logs.read" && log.targetType === "audit";
}

type AuditLogRequestFilters = {
  action: AuditAction | null;
  branchId: string;
  from: Date | null;
  limit: number;
  query: string;
  reason: string;
  result: AuditLog["result"] | null;
  to: Date | null;
};

function parseAuditLogRequestFilters(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawAction = searchParams.get("action") || null;
  const rawResult = searchParams.get("result") || null;
  const branchId = searchParams.get("branchId") || "all";
  const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
  const reason = searchParams.get("reason")?.trim() ?? "";
  const from = parseAuditDateParam(searchParams.get("from"), "from");
  const to = parseAuditDateParam(searchParams.get("to"), "to");

  if (!reason) {
    return { response: jsonError(400, "VALIDATION_ERROR", "변경 기록 조회 사유가 필요합니다.") } as const;
  }

  if (reason.length > auditLogQueryLimits.reason) {
    return {
      response: jsonError(400, "VALIDATION_ERROR", `변경 기록 조회 사유는 ${auditLogQueryLimits.reason}자 이하로 입력해 주세요.`),
    } as const;
  }

  if (query.length > auditLogQueryLimits.query) {
    return {
      response: jsonError(400, "VALIDATION_ERROR", `변경 기록 검색어는 ${auditLogQueryLimits.query}자 이하로 입력해 주세요.`),
    } as const;
  }

  if (branchId.length > auditLogQueryLimits.branchId) {
    return { response: jsonError(400, "VALIDATION_ERROR", "지점 필터 식별자가 너무 깁니다.") } as const;
  }

  if (rawAction && !auditActions.includes(rawAction as AuditAction)) {
    return { response: jsonError(400, "VALIDATION_ERROR", "변경 기록 처리 항목 필터가 올바르지 않습니다.") } as const;
  }

  if (rawResult && !auditResults.includes(rawResult as AuditLog["result"])) {
    return { response: jsonError(400, "VALIDATION_ERROR", "변경 기록 결과 필터가 올바르지 않습니다.") } as const;
  }

  if (from === "invalid" || to === "invalid") {
    return { response: jsonError(400, "VALIDATION_ERROR", "날짜 필터가 올바르지 않습니다.") } as const;
  }

  if (!isAuditDateRangeValid(from, to)) {
    return { response: jsonError(400, "VALIDATION_ERROR", "시작일은 종료일보다 늦을 수 없습니다.") } as const;
  }

  return {
    filters: {
      action: rawAction as AuditAction | null,
      branchId,
      from,
      limit: parseLimit(searchParams.get("limit")),
      query,
      reason,
      result: rawResult as AuditLog["result"] | null,
      to,
    } satisfies AuditLogRequestFilters,
  } as const;
}

export async function GET(request: NextRequest) {
  const authDb = await readServerDb();
  const { user, response } = requireSession(request, authDb);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 변경 기록을 조회할 수 있습니다.");
  }

  const parsed = parseAuditLogRequestFilters(request);

  if ("response" in parsed) {
    return parsed.response;
  }

  return withServerDbLock(authSecurityLockKey, () => getAuditLogs(request, parsed.filters));
}

async function getAuditLogs(request: NextRequest, filters: AuditLogRequestFilters) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 변경 기록을 조회할 수 있습니다.");
  }

  const { action, branchId, from, limit, query, reason, result, to } = filters;
  const includeAuditReadLogs = action === "audit_logs.read";

  if (branchId !== "all" && branchId !== "system" && !db.branches.some((branch) => branch.id === branchId)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "존재하지 않는 지점 필터입니다.", { branchId });
  }


  function matches(log: AuditLog) {
    if (!includeAuditReadLogs && isAuditReadLog(log)) {
      return false;
    }

    if (String(log.action).startsWith("request.")) {
      return false;
    }

    if (action && log.action !== action) {
      return false;
    }

    if (result && log.result !== result) {
      return false;
    }

    if (branchId === "system" && log.branchId !== null) {
      return false;
    }

    if (branchId !== "all" && branchId !== "system" && log.branchId !== branchId) {
      return false;
    }

    const createdAt = new Date(log.createdAt);

    if (from instanceof Date && createdAt < from) {
      return false;
    }

    if (to instanceof Date && createdAt > to) {
      return false;
    }

    if (!query) {
      return true;
    }

    const actor = db.users.find((candidate) => candidate.id === log.actorUserId);
    const branch = db.branches.find((candidate) => candidate.id === log.branchId);
    const searchable = [
      log.action,
      log.targetType,
      log.targetId,
      log.message,
      log.result,
      actor?.name,
      actor?.email,
      branch?.name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(query);
  }

  const previewLogs = db.auditLogs.filter(matches);
  const readAuditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: null,
    actorUserId: user.id,
    action: "audit_logs.read",
    targetType: "audit",
    targetId: "audit-logs",
    before: null,
    after: {
      action: action ?? "all",
      branchId,
      from: from instanceof Date ? from.toISOString() : null,
      limit,
      query: query || null,
      reason,
      result: result ?? "all",
      rowCount: previewLogs.length,
      to: to instanceof Date ? to.toISOString() : null,
    },
    result: "success",
    message: "변경 기록을 조회했습니다.",
    createdAt: new Date().toISOString(),
  };
  const persisted = isDuplicateAuditRead(db.auditLogs, readAuditLog)
    ? db
    : await writeServerDb({
        ...db,
        auditLogs: [readAuditLog, ...db.auditLogs],
      });
  const filteredLogs = persisted.auditLogs.filter(matches);
  const logs = filteredLogs.slice(0, limit);
  const totalCount = persisted.auditLogs.filter((log) => includeAuditReadLogs || !isAuditReadLog(log)).length;
  const summary = {
    blockedCount: filteredLogs.filter((log) => log.result === "blocked").length,
    exportCount: filteredLogs.filter((log) => log.action === "export.create").length,
    failedCount: filteredLogs.filter((log) => log.result === "failed").length,
    filteredCount: filteredLogs.length,
    returnedCount: logs.length,
    successCount: filteredLogs.filter((log) => log.result === "success").length,
    totalCount,
  };

  return jsonOk({
    filters: {
      action,
      branchId,
      from: from instanceof Date ? from.toISOString() : null,
      limit,
      query,
      result,
      to: to instanceof Date ? to.toISOString() : null,
    },
    logs,
    summary,
  });
}
