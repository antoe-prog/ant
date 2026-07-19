import { NextRequest } from "next/server";
import {
  attendanceInputLimits,
  getAttendanceNoteLengthError,
} from "@/lib/attendance-policy";
import type { AttendanceStatus } from "@/lib/domain";
import { getAccessibleBranchIds, upsertAttendance } from "@/lib/mock-api";
import { attendanceStateLockKey, hasAttendanceWindowOpened } from "@/server/attendance-policy";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const attendanceStatuses: AttendanceStatus[] = ["present", "absent", "late", "excused"];

type AttendanceUpdateBody = {
  items: Array<{ memberId: string; status: AttendanceStatus; note?: string | null }>;
  reason?: string | null;
};

function getAttendanceUpdateBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "출석 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return "출석 항목이 필요합니다.";
  }

  if (body.items.length > attendanceInputLimits.itemsPerRequest) {
    return `한 번에 저장할 수 있는 출석 항목은 ${attendanceInputLimits.itemsPerRequest}건까지입니다.`;
  }

  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string") {
    return "출석 공통 사유 값의 형식이 올바르지 않습니다.";
  }

  const reasonLengthError = getAttendanceNoteLengthError(body.reason, "출석 공통 사유");

  if (reasonLengthError) {
    return reasonLengthError;
  }

  const memberIds = new Set<string>();

  for (const item of body.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "출석 항목 값의 형식이 올바르지 않습니다.";
    }

    const candidate = item as Record<string, unknown>;

    if (typeof candidate.memberId !== "string" || typeof candidate.status !== "string") {
      return "출석 회원과 상태 값의 형식이 올바르지 않습니다.";
    }

    if (
      candidate.memberId.trim().length === 0 ||
      candidate.memberId.length > attendanceInputLimits.memberIdLength
    ) {
      return `출석 회원 ID는 ${attendanceInputLimits.memberIdLength}자 이하의 문자열이어야 합니다.`;
    }

    if (candidate.note !== undefined && candidate.note !== null && typeof candidate.note !== "string") {
      return "출석 메모 값의 형식이 올바르지 않습니다.";
    }

    const noteLengthError = getAttendanceNoteLengthError(candidate.note);

    if (noteLengthError) {
      return noteLengthError;
    }

    if (memberIds.has(candidate.memberId)) {
      return "같은 회원의 출석 항목을 한 요청에 중복해서 보낼 수 없습니다.";
    }

    memberIds.add(candidate.memberId);
  }

  return null;
}

function cleanOptionalText(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  async function requireAttendanceUpdateContext() {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return { ok: false as const, response };
    }

    if (!["coach", "owner", "admin"].includes(user.role)) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "출석을 수정할 권한이 없습니다."),
      };
    }

    const session = db.classes.find((item) => item.id === sessionId);

    if (!session) {
      return {
        ok: false as const,
        response: jsonError(404, "NOT_FOUND", "수업 회차를 찾을 수 없습니다."),
      };
    }

    if (!getAccessibleBranchIds(user, db).includes(session.branchId)) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다."),
      };
    }

    if (user.role === "coach" && session.coachId !== user.id) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "담당 수업만 출석을 수정할 수 있습니다."),
      };
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return { ok: false as const, response: selectedScope.response };
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== session.branchId) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "선택한 지점의 수업만 출석을 수정할 수 있습니다."),
      };
    }

    if (!hasAttendanceWindowOpened(session.startsAt)) {
      return {
        ok: false as const,
        response: jsonError(422, "BUSINESS_RULE_FAILED", "수업 시작 전에는 출석을 기록할 수 없습니다."),
      };
    }

    return {
      db,
      ok: true as const,
      selectedBranchId: selectedScope.selectedBranchId ?? session.branchId,
      session,
      user,
    };
  }

  const initialContext = await requireAttendanceUpdateContext();

  if (!initialContext.ok) {
    return initialContext.response;
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getAttendanceUpdateBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as AttendanceUpdateBody;

  return withServerDbLock(attendanceStateLockKey, async () => {
    const currentContext = await requireAttendanceUpdateContext();

    if (!currentContext.ok) {
      return currentContext.response;
    }

    const { db, selectedBranchId, session, user } = currentContext;
    let nextDb = db;
    const requestReason = cleanOptionalText(body.reason);

    for (const item of body.items) {
      if (!item.memberId || !item.status || !attendanceStatuses.includes(item.status)) {
        return jsonError(400, "VALIDATION_ERROR", "출석 상태가 올바르지 않습니다.");
      }

      if (!session.enrolledMemberIds.includes(item.memberId)) {
        return jsonError(422, "BUSINESS_RULE_FAILED", "수업에 등록되지 않은 회원입니다.", {
          memberId: item.memberId,
        });
      }

      const itemNote = cleanOptionalText(item.note) || requestReason;

      nextDb = upsertAttendance(nextDb, session.id, item.memberId, item.status, user.id, itemNote);
    }

    const persisted = await writeServerDb(nextDb);

    return jsonOk(createBootstrapPayload(persisted, user, selectedBranchId));
  });
}
