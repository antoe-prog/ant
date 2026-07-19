import { NextRequest } from "next/server";
import { getAttendanceNoteLengthError } from "@/lib/attendance-policy";
import { getAccessibleBranchIds, updateAttendanceNote } from "@/lib/mock-api";
import { attendanceStateLockKey, hasAttendanceWindowOpened } from "@/server/attendance-policy";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; memberId: string }> },
) {
  const { sessionId, memberId } = await params;

  async function requireAttendanceReasonContext() {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return { ok: false as const, response };
    }

    if (!["coach", "owner", "admin"].includes(user.role)) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "출석 사유를 기록할 권한이 없습니다."),
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
        response: jsonError(403, "FORBIDDEN", "담당 수업만 출석 사유를 기록할 수 있습니다."),
      };
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return { ok: false as const, response: selectedScope.response };
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== session.branchId) {
      return {
        ok: false as const,
        response: jsonError(403, "FORBIDDEN", "선택한 지점의 수업만 출석 사유를 수정할 수 있습니다."),
      };
    }

    if (!hasAttendanceWindowOpened(session.startsAt)) {
      return {
        ok: false as const,
        response: jsonError(422, "BUSINESS_RULE_FAILED", "수업 시작 전에는 출석 사유를 수정할 수 없습니다."),
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

  const initialContext = await requireAttendanceReasonContext();

  if (!initialContext.ok) {
    return initialContext.response;
  }

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reasonLengthError = getAttendanceNoteLengthError(body?.reason, "수정 사유");

  if (reasonLengthError) {
    return jsonError(400, "VALIDATION_ERROR", reasonLengthError);
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "수정 사유가 필요합니다.");
  }

  return withServerDbLock(attendanceStateLockKey, async () => {
    const currentContext = await requireAttendanceReasonContext();

    if (!currentContext.ok) {
      return currentContext.response;
    }

    const { db, selectedBranchId, session, user } = currentContext;

    if (!session.enrolledMemberIds.includes(memberId)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "수업에 등록되지 않은 회원입니다.", { memberId });
    }

    const existing = db.attendance.find((record) => record.sessionId === session.id && record.memberId === memberId);

    if (!existing) {
      return jsonError(404, "NOT_FOUND", "출석 기록을 찾을 수 없습니다.");
    }

    const persisted = await writeServerDb(updateAttendanceNote(db, session.id, memberId, user.id, reason));

    return jsonOk(createBootstrapPayload(persisted, user, selectedBranchId));
  });
}
