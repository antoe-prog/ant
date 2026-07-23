import { NextRequest } from "next/server";
import { getCounselingNoteBodyLimitError } from "@/lib/counseling-note-input-policy";
import { canManageCounselingNote } from "@/lib/counseling-note-visibility";
import type {
  AppUser,
  AuditLog,
  CounselingNote,
  CounselingNoteVisibility,
  MockDatabase,
} from "@/lib/domain";
import { getAccessibleBranchIds, getAccessibleMemberIds } from "@/lib/mock-api";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const counselingNoteStateLockKey = "counseling-notes";
const noteVisibilities: CounselingNoteVisibility[] = [
  "staff_only",
  "coach_visible",
  "guardian_visible",
  "member_visible",
];
const noteTypes: CounselingNote["noteType"][] = ["general", "caution", "progress", "follow_up"];

type CounselingNoteUpdateBody = {
  body?: string;
  noteType?: CounselingNote["noteType"];
  visibility?: CounselingNoteVisibility;
};

function getCounselingNoteBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "상담/주의 메모 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;
  const fields = [
    ["body", "메모 내용"],
    ["noteType", "메모 유형"],
    ["visibility", "공개 범위"],
  ] as const;

  for (const [field, label] of fields) {
    if (typeof body[field] !== "string") {
      return `${label} 값의 형식이 올바르지 않습니다.`;
    }
  }

  return null;
}

function resolveMutableCounselingNote(
  user: AppUser,
  db: MockDatabase,
  branchId: string,
  memberId: string,
  noteId: string,
) {
  if (!["coach", "owner", "admin"].includes(user.role)) {
    return { response: jsonError(403, "FORBIDDEN", "상담/주의 메모를 변경할 권한이 없습니다.") };
  }

  if (!getAccessibleBranchIds(user, db).includes(branchId)) {
    return { response: jsonError(403, "FORBIDDEN", "선택한 지점의 상담/주의 메모를 변경할 수 없습니다.") };
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member || member.branchId !== branchId) {
    return { response: jsonError(404, "NOT_FOUND", "회원을 찾을 수 없습니다.") };
  }

  if (user.role === "coach" && !getAccessibleMemberIds(user, db, [branchId]).includes(member.id)) {
    return { response: jsonError(403, "FORBIDDEN", "담당 회원의 상담/주의 메모만 변경할 수 있습니다.") };
  }

  const note = (db.counselingNotes ?? []).find(
    (candidate) =>
      candidate.id === noteId &&
      candidate.branchId === branchId &&
      candidate.memberId === memberId,
  );

  if (!note) {
    return { response: jsonError(404, "NOT_FOUND", "상담/주의 메모를 찾을 수 없습니다.") };
  }

  if (!canManageCounselingNote(user, note)) {
    return { response: jsonError(403, "FORBIDDEN", "다른 작성자의 상담/주의 메모는 변경할 수 없습니다.") };
  }

  return { member, note, response: null };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string; memberId: string; noteId: string }> },
) {
  const { branchId, memberId, noteId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 상담/주의 메모를 변경할 수 없습니다.");
  }

  const access = resolveMutableCounselingNote(user, db, branchId, memberId, noteId);

  if (access.response) {
    return access.response;
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getCounselingNoteBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as CounselingNoteUpdateBody;
  const bodyLimitError = getCounselingNoteBodyLimitError(body.body);

  if (bodyLimitError) {
    return jsonError(400, "VALIDATION_ERROR", bodyLimitError);
  }

  if (!body.body?.trim()) {
    return jsonError(400, "VALIDATION_ERROR", "상담/주의 메모 내용이 필요합니다.");
  }

  if (!body.visibility || !noteVisibilities.includes(body.visibility)) {
    return jsonError(400, "VALIDATION_ERROR", "메모를 볼 수 있는 대상이 올바르지 않습니다.");
  }

  if (!body.noteType || !noteTypes.includes(body.noteType)) {
    return jsonError(400, "VALIDATION_ERROR", "메모 유형이 올바르지 않습니다.");
  }

  if (user.role === "coach" && body.visibility === "staff_only") {
    return jsonError(403, "FORBIDDEN", "운영진 전용 메모는 대표 또는 총괄 어드민만 설정할 수 있습니다.");
  }

  const nextBody = body.body.trim();
  const nextNoteType = body.noteType;
  const nextVisibility = body.visibility;

  return withServerDbLock(counselingNoteStateLockKey, async () => {
    const latestDb = await readServerDb();
    const latestSession = requireSession(request, latestDb);

    if (!latestSession.user) {
      return latestSession.response;
    }

    const latestScope = requireSelectedBranchScope(request, latestSession.user, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    if (latestScope.selectedBranchId && latestScope.selectedBranchId !== branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 상담/주의 메모를 변경할 수 없습니다.");
    }

    const latestAccess = resolveMutableCounselingNote(
      latestSession.user,
      latestDb,
      branchId,
      memberId,
      noteId,
    );

    if (latestAccess.response) {
      return latestAccess.response;
    }

    if (latestSession.user.role === "coach" && nextVisibility === "staff_only") {
      return jsonError(403, "FORBIDDEN", "운영진 전용 메모는 대표 또는 총괄 어드민만 설정할 수 있습니다.");
    }

    const currentNote = latestAccess.note;
    const now = new Date().toISOString();
    const nextNote: CounselingNote = {
      ...currentNote,
      body: nextBody,
      noteType: nextNoteType,
      visibility: nextVisibility,
      updatedAt: now,
    };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId,
      actorUserId: latestSession.user.id,
      action: "counseling_note.update",
      targetType: "counseling_note",
      targetId: noteId,
      before: {
        memberId,
        noteType: currentNote.noteType,
        visibility: currentNote.visibility,
        bodyLength: currentNote.body.length,
      },
      after: {
        memberId,
        noteType: nextNote.noteType,
        visibility: nextNote.visibility,
        bodyLength: nextNote.body.length,
        bodyChanged: nextNote.body !== currentNote.body,
      },
      result: "success",
      message: "상담/주의 메모를 수정했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...latestDb,
      counselingNotes: (latestDb.counselingNotes ?? []).map((candidate) =>
        candidate.id === noteId ? nextNote : candidate,
      ),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(
      createBootstrapPayload(nextDb, latestSession.user, latestScope.selectedBranchId ?? branchId),
    );
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string; memberId: string; noteId: string }> },
) {
  const { branchId, memberId, noteId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 상담/주의 메모를 삭제할 수 없습니다.");
  }

  const access = resolveMutableCounselingNote(user, db, branchId, memberId, noteId);

  if (access.response) {
    return access.response;
  }

  return withServerDbLock(counselingNoteStateLockKey, async () => {
    const latestDb = await readServerDb();
    const latestSession = requireSession(request, latestDb);

    if (!latestSession.user) {
      return latestSession.response;
    }

    const latestScope = requireSelectedBranchScope(request, latestSession.user, latestDb);

    if (latestScope.response) {
      return latestScope.response;
    }

    if (latestScope.selectedBranchId && latestScope.selectedBranchId !== branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 상담/주의 메모를 삭제할 수 없습니다.");
    }

    const latestAccess = resolveMutableCounselingNote(
      latestSession.user,
      latestDb,
      branchId,
      memberId,
      noteId,
    );

    if (latestAccess.response) {
      return latestAccess.response;
    }

    const currentNote = latestAccess.note;
    const now = new Date().toISOString();
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId,
      actorUserId: latestSession.user.id,
      action: "counseling_note.delete",
      targetType: "counseling_note",
      targetId: noteId,
      before: {
        memberId,
        noteType: currentNote.noteType,
        visibility: currentNote.visibility,
        bodyLength: currentNote.body.length,
      },
      after: {
        memberId,
        deletedAt: now,
      },
      result: "success",
      message: "상담/주의 메모를 삭제했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...latestDb,
      counselingNotes: (latestDb.counselingNotes ?? []).filter((candidate) => candidate.id !== noteId),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk(
      createBootstrapPayload(nextDb, latestSession.user, latestScope.selectedBranchId ?? branchId),
    );
  });
}
