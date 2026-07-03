import { NextRequest } from "next/server";
import type { AuditLog, PilotOperationLog, PilotReadinessStatus } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

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

  const body = (await request.json().catch(() => null)) as PilotOperationLogBody | null;
  const branchId = body?.branchId?.trim() || null;
  const date = body?.date?.trim() ?? "";
  const status = body?.status;
  const owner = body?.owner?.trim() ?? "";
  const evidence = body?.evidence?.trim() ?? "";
  const blockerSummary = body?.blockerSummary?.trim() ?? "";
  const mobileAttendanceEvidence = body?.mobileAttendanceEvidence?.trim() ?? "";
  const mobileAttendanceDurationSeconds = parseOptionalPositiveNumber(body?.mobileAttendanceDurationSeconds);
  const classesChecked = parseNonNegativeInteger(body?.classesChecked);
  const attendanceRecords = parseNonNegativeInteger(body?.attendanceRecords);
  const paymentChecks = parseNonNegativeInteger(body?.paymentChecks);
  const noticeFollowupChecks = parseNonNegativeInteger(body?.noticeFollowupChecks);
  const noticeChecks = parseNonNegativeInteger(body?.noticeChecks);

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

  if (branchId && !db.branches.some((branch) => branch.id === branchId)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "존재하지 않는 지점입니다.", { branchId });
  }

  const now = new Date().toISOString();
  const existingLog = db.pilotOperationLogs.find((log) => log.date === date && (log.branchId ?? null) === branchId);
  const nextLog: PilotOperationLog = {
    id: existingLog?.id ?? `pilot-operation-${Date.now()}`,
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
    checkedByUserId: status === "pending" ? undefined : user.id,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
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
    ? db.pilotOperationLogs.map((log) => (log.id === existingLog.id ? nextLog : log))
    : [nextLog, ...db.pilotOperationLogs];
  const nextDb = await writeServerDb({
    ...db,
    pilotOperationLogs: nextOperationLogs.sort((a, b) => b.date.localeCompare(a.date)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId));
}
