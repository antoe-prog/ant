import { NextRequest } from "next/server";
import { clearAttendance, getAccessibleBranchIds } from "@/lib/mock-api";
import { attendanceStateLockKey, hasAttendanceWindowOpened } from "@/server/attendance-policy";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; memberId: string }> },
) {
  const { sessionId, memberId } = await params;
  return withServerDbLock(attendanceStateLockKey, async () => {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return response;
    }

    if (!["coach", "owner", "admin"].includes(user.role)) {
      return jsonError(403, "FORBIDDEN", "출석을 미처리로 되돌릴 권한이 없습니다.");
    }

    const session = db.classes.find((item) => item.id === sessionId);

    if (!session) {
      return jsonError(404, "NOT_FOUND", "수업 회차를 찾을 수 없습니다.");
    }

    if (!getAccessibleBranchIds(user, db).includes(session.branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다.");
    }

    if (user.role === "coach" && session.coachId !== user.id) {
      return jsonError(403, "FORBIDDEN", "담당 수업만 출석을 수정할 수 있습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== session.branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 수업만 출석을 수정할 수 있습니다.");
    }

    if (!hasAttendanceWindowOpened(session.startsAt)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "수업 시작 전에는 출석을 수정할 수 없습니다.");
    }

    if (!session.enrolledMemberIds.includes(memberId)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "수업에 등록되지 않은 회원입니다.", { memberId });
    }

    // DELETE is intentionally idempotent so an offline retry is safe after a lost response.
    const persisted = await writeServerDb(clearAttendance(db, sessionId, memberId, user.id));

    return jsonOk(createBootstrapPayload(persisted, user, selectedScope.selectedBranchId ?? session.branchId));
  });
}
