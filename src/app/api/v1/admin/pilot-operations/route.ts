import { NextRequest } from "next/server";
import type { AuditLog, PilotOperationLog, PilotReadinessStatus } from "@/lib/domain";
import { exceedsPilotInputLimit, pilotOperationsInputLimits } from "@/lib/pilot-operations-input-policy";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { pilotOperationsStateLockKey } from "@/server/pilot-operations-state";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const allowedStatuses = new Set<PilotReadinessStatus>(["pending", "verified", "blocked"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type PilotOperationLogBody = {
  attendanceRecords?: number;
  blockerSummary?: string;
  branchId?: string | null;
  classesChecked?: number;
  date?: string;
  evidence?: string;
  mobileAttendanceDurationSeconds?: number | string;
  mobileAttendanceEvidence?: string;
  noticeChecks?: number;
  owner?: string;
  paymentChecks?: number;
  noticeFollowupChecks?: number;
  status?: PilotReadinessStatus;
};

function getPilotOperationBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "운영 기록 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  if (body.branchId !== undefined && body.branchId !== null && typeof body.branchId !== "string") {
    return "운영 기록 지점 값의 형식이 올바르지 않습니다.";
  }

  for (const field of ["blockerSummary", "date", "evidence", "mobileAttendanceEvidence", "owner", "status"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return "운영 기록 값의 형식이 올바르지 않습니다.";
    }
  }

  for (const field of ["attendanceRecords", "classesChecked", "noticeChecks", "noticeFollowupChecks", "paymentChecks"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "number") {
      return "운영 수치 값의 형식이 올바르지 않습니다.";
    }
  }

  if (
    body.mobileAttendanceDurationSeconds !== undefined &&
    typeof body.mobileAttendanceDurationSeconds !== "number" &&
    typeof body.mobileAttendanceDurationSeconds !== "string"
  ) {
    return "모바일 출석 처리 시간의 형식이 올바르지 않습니다.";
  }

  return null;
}

function parseNonNegativeInteger(value: unknown) {
  const number = Number(value ?? 0);

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return Math.trunc(number);
}

function parseOptionalPositiveNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return number;
}

function isValidDateOnly(value: string) {
  if (!datePattern.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function summarizePilotOperations(logs: PilotOperationLog[]) {
  const verifiedLogs = logs.filter((log) => log.status === "verified");
  const uniqueVerifiedDays = new Set(verifiedLogs.map((log) => `${log.branchId ?? "system"}:${log.date}`));

  return {
    blocked: logs.filter((log) => log.status === "blocked").length,
    pending: logs.filter((log) => log.status === "pending").length,
    verified: verifiedLogs.length,
    total: logs.length,
    uniqueVerifiedDays: uniqueVerifiedDays.size,
    attendanceRecords: verifiedLogs.reduce((sum, log) => sum + log.attendanceRecords, 0),
    paymentChecks: verifiedLogs.reduce((sum, log) => sum + log.paymentChecks, 0),
  };
}

export async function GET(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 기록을 조회할 수 있습니다.");
  }

  return jsonOk({
    logs: db.pilotOperationLogs,
    summary: summarizePilotOperations(db.pilotOperationLogs),
  });
}

export async function POST(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (user.role !== "admin") {
    return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 기록을 저장할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getPilotOperationBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as PilotOperationLogBody;

  if (
    exceedsPilotInputLimit(body.branchId, pilotOperationsInputLimits.branchId) ||
    exceedsPilotInputLimit(body.blockerSummary, pilotOperationsInputLimits.blockerSummary) ||
    exceedsPilotInputLimit(body.evidence, pilotOperationsInputLimits.evidence) ||
    exceedsPilotInputLimit(body.mobileAttendanceEvidence, pilotOperationsInputLimits.mobileAttendanceEvidence) ||
    exceedsPilotInputLimit(body.owner, pilotOperationsInputLimits.owner)
  ) {
    return jsonError(400, "VALIDATION_ERROR", "운영 기록 입력이 허용 길이를 초과했습니다.");
  }

  const branchId = body.branchId?.trim() || null;
  const date = body.date?.trim() ?? "";
  const status = body.status;
  const owner = body.owner?.trim() ?? "";
  const evidence = body.evidence?.trim() ?? "";
  const blockerSummary = body.blockerSummary?.trim() ?? "";
  const mobileAttendanceEvidence = body.mobileAttendanceEvidence?.trim() ?? "";
  const mobileAttendanceDurationSeconds = parseOptionalPositiveNumber(body.mobileAttendanceDurationSeconds);
  const classesChecked = parseNonNegativeInteger(body.classesChecked);
  const attendanceRecords = parseNonNegativeInteger(body.attendanceRecords);
  const paymentChecks = parseNonNegativeInteger(body.paymentChecks);
  const noticeFollowupChecks = parseNonNegativeInteger(body.noticeFollowupChecks);
  const noticeChecks = parseNonNegativeInteger(body.noticeChecks);

  if (!isValidDateOnly(date) || !status || !allowedStatuses.has(status) || !owner) {
    return jsonError(400, "VALIDATION_ERROR", "운영 일자, 상태, 담당자가 필요합니다.");
  }

  if ([classesChecked, attendanceRecords, paymentChecks, noticeFollowupChecks, noticeChecks].some((value) => value === null)) {
    return jsonError(400, "VALIDATION_ERROR", "운영 수치는 0 이상의 숫자여야 합니다.");
  }

  if (status !== "pending" && evidence.length < 5) {
    return jsonError(400, "VALIDATION_ERROR", "확인 또는 확인 필요 상태에는 5자 이상의 확인 메모가 필요합니다.");
  }

  if (status === "blocked" && blockerSummary.length < 5) {
    return jsonError(400, "VALIDATION_ERROR", "확인 필요 상태에는 5자 이상의 확인 필요/특이사항 기록이 필요합니다.");
  }

  if (mobileAttendanceDurationSeconds === null || (mobileAttendanceDurationSeconds !== undefined && mobileAttendanceDurationSeconds > 30)) {
    return jsonError(400, "VALIDATION_ERROR", "모바일 출석 처리 시간은 0초 초과 30초 이하여야 합니다.");
  }

  if (mobileAttendanceEvidence && mobileAttendanceDurationSeconds === undefined) {
    return jsonError(400, "VALIDATION_ERROR", "모바일 출석 확인 기록에는 처리 시간이 필요합니다.");
  }

  if (mobileAttendanceDurationSeconds !== undefined && mobileAttendanceEvidence.length < 5) {
    return jsonError(400, "VALIDATION_ERROR", "모바일 출석 처리 시간에는 5자 이상의 확인 메모가 필요합니다.");
  }

  const activityCount = classesChecked! + attendanceRecords! + paymentChecks! + noticeFollowupChecks! + noticeChecks!;
  if (status === "verified" && activityCount === 0) {
    return jsonError(400, "VALIDATION_ERROR", "확인 상태에는 출석, 결제, 공지 중 하나 이상의 운영 수치가 필요합니다.");
  }

  if (status === "verified" && attendanceRecords! > 0 && (mobileAttendanceDurationSeconds === undefined || mobileAttendanceEvidence.length < 5)) {
    return jsonError(400, "VALIDATION_ERROR", "출석 기록이 있는 확인 운영 로그에는 모바일 30초 계측 시간과 증빙이 필요합니다.");
  }

  return withServerDbLock(pilotOperationsStateLockKey, async () => {
    const latestDb = await readServerDb();
    const { user: latestUser, response: latestResponse } = requireSession(request, latestDb);

    if (!latestUser) {
      return latestResponse;
    }

    if (latestUser.role !== "admin") {
      return jsonError(403, "FORBIDDEN", "총괄 어드민만 운영 기록을 저장할 수 있습니다.");
    }

    const latestScope = requireSelectedBranchScope(request, latestUser, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    if (branchId && !latestDb.branches.some((branch) => branch.id === branchId)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "존재하지 않는 지점입니다.", { branchId });
    }

    const now = new Date().toISOString();
    const existingLog = latestDb.pilotOperationLogs.find((log) => log.date === date && (log.branchId ?? null) === branchId);
    const nextLog: PilotOperationLog = {
      id: existingLog?.id ?? createRuntimeId("pilot-operation"),
      branchId,
      date,
      status,
      owner,
      evidence,
      classesChecked: classesChecked!,
      attendanceRecords: attendanceRecords!,
      paymentChecks: paymentChecks!,
      noticeFollowupChecks: noticeFollowupChecks!,
      noticeChecks: noticeChecks!,
      ...(mobileAttendanceDurationSeconds !== undefined
        ? {
            mobileAttendanceDurationSeconds,
            mobileAttendanceEvidence,
          }
        : {}),
      ...(blockerSummary ? { blockerSummary } : {}),
      checkedAt: status === "pending" ? undefined : now,
      checkedByUserId: status === "pending" ? undefined : latestUser.id,
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId,
      actorUserId: latestUser.id,
      action: "pilot_operation.update",
      targetType: "pilot_operation",
      targetId: nextLog.id,
      before: existingLog
        ? {
            attendanceRecords: existingLog.attendanceRecords,
            date: existingLog.date,
            evidence: existingLog.evidence || null,
            mobileAttendanceDurationSeconds: existingLog.mobileAttendanceDurationSeconds ?? null,
            mobileAttendanceEvidence: existingLog.mobileAttendanceEvidence ?? null,
            owner: existingLog.owner,
            paymentChecks: existingLog.paymentChecks,
            noticeFollowupChecks: existingLog.noticeFollowupChecks,
            status: existingLog.status,
          }
        : null,
      after: {
        attendanceRecords: nextLog.attendanceRecords,
        branchId,
        classesChecked: nextLog.classesChecked,
        date: nextLog.date,
        evidence: nextLog.evidence || null,
        mobileAttendanceDurationSeconds: nextLog.mobileAttendanceDurationSeconds ?? null,
        mobileAttendanceEvidence: nextLog.mobileAttendanceEvidence ?? null,
        noticeFollowupChecks: nextLog.noticeFollowupChecks,
        noticeChecks: nextLog.noticeChecks,
        owner: nextLog.owner,
        paymentChecks: nextLog.paymentChecks,
        status: nextLog.status,
      },
      result: "success",
      message: "일일 운영 기록을 저장했습니다.",
      createdAt: now,
    };
    const nextOperationLogs = existingLog
      ? latestDb.pilotOperationLogs.map((log) => (log.id === existingLog.id ? nextLog : log))
      : [nextLog, ...latestDb.pilotOperationLogs];
    const nextDb = await writeServerDb({
      ...latestDb,
      pilotOperationLogs: nextOperationLogs.sort((a, b) => b.date.localeCompare(a.date)),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(createBootstrapPayload(nextDb, latestUser, latestScope.selectedBranchId));
  });
}
