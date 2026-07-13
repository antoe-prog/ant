import { NextRequest } from "next/server";
import type { AuditLog, Notice, NoticeAudience } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { canDeleteNotice, canEditNotice, noticePublisherRoles } from "@/lib/notice-permissions";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, writeServerDb } from "@/server/db";

export const runtime = "nodejs";

type NoticeUpdateBody = {
  title?: string;
  body?: string;
  important?: boolean;
  audience?: NoticeAudience[];
};

function isValidAudience(value: string): value is NoticeAudience {
  return value === "all" || userRoles.includes(value as (typeof userRoles)[number]);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string; noticeId: string }> },
) {
  const { branchId, noticeId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!noticePublisherRoles.has(user.role)) {
    return jsonError(403, "FORBIDDEN", "공지 수정 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 공지만 수정할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 공지만 수정할 수 있습니다.");
  }

  const notice = db.notices.find((candidate) => candidate.id === noticeId && candidate.branchId === branchId);

  if (!notice) {
    return jsonError(404, "NOT_FOUND", "수정할 공지를 찾을 수 없습니다.");
  }

  if (!canEditNotice(user, db, notice)) {
    return jsonError(403, "FORBIDDEN", "본인이 관리할 수 있는 공지만 수정할 수 있습니다.");
  }

  const body = (await request.json().catch(() => null)) as NoticeUpdateBody | null;
  const title = body?.title !== undefined ? body.title.trim() : notice.title;
  const noticeBody = body?.body !== undefined ? body.body.trim() : notice.body;
  const important = body?.important !== undefined ? body.important === true : notice.important === true;
  const audience = body?.audience !== undefined ? [...new Set(body.audience)] : notice.audience;

  if (!title || !noticeBody) {
    return jsonError(400, "VALIDATION_ERROR", "공지 제목과 본문이 필요합니다.");
  }

  if (audience.length === 0 || audience.some((item) => !isValidAudience(item))) {
    return jsonError(400, "VALIDATION_ERROR", "공지 대상이 올바르지 않습니다.");
  }

  const now = new Date().toISOString();
  const nextNotice: Notice = {
    ...notice,
    title,
    body: noticeBody,
    important,
    audience,
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "notice.update",
    targetType: "notice",
    targetId: notice.id,
    before: {
      title: notice.title,
      body: notice.body,
      important: notice.important ?? false,
      audience: notice.audience,
    },
    after: {
      title,
      body: noticeBody,
      important,
      audience,
    },
    result: "success",
    message: "공지를 수정했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    notices: db.notices.map((candidate) => (candidate.id === notice.id ? nextNotice : candidate)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk({
    ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId),
    notice: {
      id: notice.id,
      updatedAt: now,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string; noticeId: string }> },
) {
  const { branchId, noticeId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!noticePublisherRoles.has(user.role)) {
    return jsonError(403, "FORBIDDEN", "공지 삭제 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 공지만 삭제할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 공지만 삭제할 수 있습니다.");
  }

  const notice = db.notices.find((candidate) => candidate.id === noticeId && candidate.branchId === branchId);

  if (!notice) {
    return jsonError(404, "NOT_FOUND", "삭제할 공지를 찾을 수 없습니다.");
  }

  if (!canDeleteNotice(user, db, notice)) {
    return jsonError(403, "FORBIDDEN", "본인이 관리할 수 있는 공지만 삭제할 수 있습니다.");
  }

  const now = new Date().toISOString();
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "notice.delete",
    targetType: "notice",
    targetId: notice.id,
    before: {
      title: notice.title,
      important: notice.important,
      audience: notice.audience,
      createdByUserId: notice.createdByUserId ?? null,
      targetClassIds: notice.targetClassIds ?? [],
      targetMemberIds: notice.targetMemberIds ?? [],
      readByUserIds: notice.readByUserIds ?? [],
    },
    after: null,
    result: "success",
    message: "공지를 삭제했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    notices: db.notices.filter((candidate) => candidate.id !== notice.id),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk({
    ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId),
    notice: {
      deletedAt: now,
      id: notice.id,
    },
  });
}
