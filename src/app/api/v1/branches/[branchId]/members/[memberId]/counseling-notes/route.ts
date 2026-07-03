import { NextRequest } from "next/server";
import type { AuditLog, CounselingNote, CounselingNoteVisibility } from "@/lib/domain";
import { getAccessibleBranchIds, getAccessibleMemberIds } from "@/lib/mock-api";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, writeServerDb } from "@/server/db";

export const runtime = "nodejs";

const noteVisibilities: CounselingNoteVisibility[] = ["staff_only", "coach_visible", "guardian_visible"];
const noteTypes: CounselingNote["noteType"][] = ["general", "caution", "progress", "follow_up"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string; memberId: string }> },
) {
  const { branchId, memberId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["coach", "owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "상담/주의 메모 작성 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 상담/주의 메모를 작성할 수 없습니다.");
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member || member.branchId !== branchId) {
    return jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.");
  }

  if (user.role === "coach" && !getAccessibleMemberIds(user, db, [branchId]).includes(member.id)) {
    return jsonError(403, "FORBIDDEN", "담당 회원에게만 상담/주의 메모를 작성할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 상담/주의 메모를 작성할 수 없습니다.");
  }

  const body = (await request.json().catch(() => null)) as {
    body?: string;
    noteType?: CounselingNote["noteType"];
    visibility?: CounselingNoteVisibility;
  } | null;

  if (!body?.body?.trim()) {
    return jsonError(400, "VALIDATION_ERROR", "상담/주의 메모 내용이 필요합니다.");
  }

  const visibility = body.visibility ?? "coach_visible";
  const noteType = body.noteType ?? "general";

  if (!noteVisibilities.includes(visibility)) {
    return jsonError(400, "VALIDATION_ERROR", "메모를 볼 수 있는 대상이 올바르지 않습니다.");
  }

  if (!noteTypes.includes(noteType)) {
    return jsonError(400, "VALIDATION_ERROR", "메모 유형이 올바르지 않습니다.");
  }

  if (user.role === "coach" && visibility === "staff_only") {
    return jsonError(403, "FORBIDDEN", "운영진 전용 메모는 대표 또는 총괄 어드민만 작성할 수 있습니다.");
  }

  const noteId = `note-${Date.now()}`;
  const nextNote: CounselingNote = {
    id: noteId,
    branchId,
    memberId: member.id,
    authorUserId: user.id,
    body: body.body.trim(),
    createdAt: new Date().toISOString(),
    noteType,
    visibility,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "counseling_note.create",
    targetType: "counseling_note",
    targetId: noteId,
    before: null,
    after: {
      memberId: member.id,
      noteType,
      visibility,
    },
    result: "success",
    message: "상담/주의 메모를 작성했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    counselingNotes: [nextNote, ...(db.counselingNotes ?? [])],
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? branchId));
}
