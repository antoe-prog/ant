import type { AppUser, CounselingNote } from "./domain.ts";

type CounselingNoteViewer = Pick<AppUser, "memberIds" | "role">;
type CounselingNoteTarget = Pick<CounselingNote, "memberId" | "visibility">;
type CounselingNoteManager = Pick<AppUser, "id" | "role">;
type ManageableCounselingNote = Pick<CounselingNote, "authorUserId">;

export function canReadCounselingNote(viewer: CounselingNoteViewer, note: CounselingNoteTarget) {
  if (viewer.role === "admin" || viewer.role === "owner") {
    return true;
  }

  if (viewer.role === "coach") {
    return note.visibility !== "staff_only";
  }

  if (viewer.role === "member") {
    return note.visibility === "member_visible";
  }

  if (viewer.role === "guardian") {
    const isSelfProfile = (viewer.memberIds ?? []).includes(note.memberId);
    return isSelfProfile
      ? note.visibility === "member_visible"
      : note.visibility === "guardian_visible";
  }

  return false;
}

export function canManageCounselingNote(manager: CounselingNoteManager, note: ManageableCounselingNote) {
  if (manager.role === "admin" || manager.role === "owner") {
    return true;
  }

  return manager.role === "coach" && note.authorUserId === manager.id;
}
