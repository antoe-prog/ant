import { NextRequest } from "next/server";
import { getAccessibleBranchIds, updateAttendanceNote } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; memberId: string }> },
) {
  const { sessionId, memberId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["coach", "owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "출석 사유를 기록할 권한이 없습니다.");
  }

  const session = db.classes.find((item) => item.id === sessionId);

  if (!session) {
    return jsonError(404, "NOT_FOUND", "수업 회차를 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(session.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 수업의 지점에 접근할 수 없습니다.");
  }

  if (user.role === "coach" && session.coachId !== user.id) {
    return jsonError(403, "FORBIDDEN", "담당 수업만 출석 사유를 기록할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "수정 사유가 필요합니다.");
  }

  if (!session.enrolledMemberIds.includes(memberId)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "수업에 등록되지 않은 회원입니다.", { memberId });
  }

  const existing = db.attendance.find((record) => record.sessionId === session.id && record.memberId === memberId);

  if (!existing) {
    return jsonError(404, "NOT_FOUND", "출석 기록을 찾을 수 없습니다.");
  }

  const persisted = await writeServerDb(updateAttendanceNote(db, session.id, memberId, user.id, reason));

  return jsonOk(createBootstrapPayload(persisted, user, selectedScope.selectedBranchId ?? session.branchId));
}
