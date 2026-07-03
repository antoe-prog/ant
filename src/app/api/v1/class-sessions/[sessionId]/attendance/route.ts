import { NextRequest } from "next/server";
import type { AttendanceStatus } from "@/lib/domain";
import { getAccessibleBranchIds, upsertAttendance } from "@/lib/mock-api";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const attendanceStatuses: AttendanceStatus[] = ["present", "absent", "late", "excused"];

function cleanOptionalText(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["coach", "owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "출석을 수정할 권한이 없습니다.");
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

  const body = (await request.json().catch(() => null)) as
    | { items?: Array<{ memberId?: string; status?: AttendanceStatus; note?: string | null }>; reason?: string | null }
    | null;

  if (!body?.items?.length) {
    return jsonError(400, "VALIDATION_ERROR", "출석 항목이 필요합니다.");
  }

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

  return jsonOk(createBootstrapPayload(persisted, user, selectedScope.selectedBranchId ?? session.branchId));
}
