import { NextRequest } from "next/server";
import type { AuditLog, Notice, NoticeAudience } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { canDeleteNotice, canEditNotice, noticePublisherRoles } from "@/lib/notice-permissions";
import {
  getNoticeStringListLimitError,
  getNoticeTextLimitError,
  noticeInputLimits,
} from "@/lib/notice-input-policy";
import { hasNoticeVisibleContentChanged, hasSameNoticeAudience, noticeStateLockKey } from "@/lib/notices";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { cancelPendingNoticePushJobs } from "@/server/notification-outbox-runner";

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
  const initialDb = await readServerDb();
  const { user: initialUser, response } = requireSession(request, initialDb);

  if (!initialUser) {
    return response;
  }

  if (!noticePublisherRoles.has(initialUser.role)) {
    return jsonError(403, "FORBIDDEN", "공지 수정 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(initialUser, initialDb).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 공지만 수정할 수 있습니다.");
  }

  const rawBody = await request.json().catch(() => null);

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return jsonError(400, "VALIDATION_ERROR", "공지 수정 정보가 올바르지 않습니다.");
  }

  const rawUpdate = rawBody as Record<string, unknown>;

  if (
    (rawUpdate.title !== undefined && typeof rawUpdate.title !== "string") ||
    (rawUpdate.body !== undefined && typeof rawUpdate.body !== "string") ||
    (rawUpdate.important !== undefined && typeof rawUpdate.important !== "boolean") ||
    (rawUpdate.audience !== undefined &&
      (!Array.isArray(rawUpdate.audience) || rawUpdate.audience.some((item) => typeof item !== "string")))
  ) {
    return jsonError(400, "VALIDATION_ERROR", "공지 수정 정보가 올바르지 않습니다.");
  }

  const inputLimitError =
    getNoticeTextLimitError({
      body: rawUpdate.body as string | undefined,
      title: rawUpdate.title as string | undefined,
    }) ??
    getNoticeStringListLimitError(rawUpdate.audience, {
      label: "공지 대상",
      maximumItems: noticeInputLimits.audienceItems,
    });

  if (inputLimitError) {
    return jsonError(400, "VALIDATION_ERROR", inputLimitError);
  }

  if (
    Object.prototype.hasOwnProperty.call(rawUpdate, "targetClassIds") ||
    Object.prototype.hasOwnProperty.call(rawUpdate, "targetMemberIds")
  ) {
    return jsonError(400, "VALIDATION_ERROR", "공지의 반/개인 대상은 생성 후 수정할 수 없습니다.");
  }

  const body: NoticeUpdateBody = {
    ...(rawUpdate.title !== undefined ? { title: rawUpdate.title as string } : {}),
    ...(rawUpdate.body !== undefined ? { body: rawUpdate.body as string } : {}),
    ...(rawUpdate.important !== undefined ? { important: rawUpdate.important as boolean } : {}),
    ...(rawUpdate.audience !== undefined ? { audience: rawUpdate.audience as NoticeAudience[] } : {}),
  };

  return withServerDbLock(noticeStateLockKey, async () => {
    const db = await readServerDb();
    const { user, response: lockedResponse } = requireSession(request, db);

    if (!user) {
      return lockedResponse;
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

    const title = body.title !== undefined ? body.title.trim() : notice.title;
    const noticeBody = body.body !== undefined ? body.body.trim() : notice.body;
    const important = body.important !== undefined ? body.important : notice.important === true;
    const requestedAudience = body.audience !== undefined ? [...new Set(body.audience)] : notice.audience;

    if (!title || !noticeBody) {
      return jsonError(400, "VALIDATION_ERROR", "공지 제목과 본문이 필요합니다.");
    }

    if (requestedAudience.length === 0 || requestedAudience.some((item) => !isValidAudience(item))) {
      return jsonError(400, "VALIDATION_ERROR", "공지 대상이 올바르지 않습니다.");
    }

    const audienceChanged = !hasSameNoticeAudience(notice.audience, requestedAudience);

    if (user.role === "coach" && audienceChanged) {
      return jsonError(403, "FORBIDDEN", "코치는 기존 공지 대상을 변경할 수 없습니다.");
    }

    const audience = audienceChanged ? requestedAudience : notice.audience;

    const now = new Date().toISOString();
    const visibleContentChanged = hasNoticeVisibleContentChanged(notice, {
      title,
      body: noticeBody,
      important,
      audience,
    });
    const readByUserIds = visibleContentChanged ? [] : (notice.readByUserIds ?? []);
    const nextNotice: Notice = {
      ...notice,
      title,
      body: noticeBody,
      important,
      audience,
      readByUserIds,
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
        bodyLength: notice.body.length,
        important: notice.important ?? false,
        audience: notice.audience,
        readCount: notice.readByUserIds?.length ?? 0,
      },
      after: {
        title,
        bodyChanged: noticeBody !== notice.body,
        bodyLength: noticeBody.length,
        important,
        audience,
        readCount: readByUserIds.length,
        readStateReset: visibleContentChanged,
      },
      result: "success",
      message: "공지를 수정했습니다.",
      createdAt: now,
    };
    const updatedDb = {
      ...db,
      notices: db.notices.map((candidate) => (candidate.id === notice.id ? nextNotice : candidate)),
      auditLogs: [auditLog, ...db.auditLogs],
    };
    const nextDb = await writeServerDb(
      visibleContentChanged
        ? cancelPendingNoticePushJobs(updatedDb, notice.id, "공지 내용이 변경되어 이전 발송 요청을 취소했습니다.", now)
        : updatedDb,
    );

    return jsonOk({
      ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId),
      notice: {
        id: notice.id,
        updatedAt: now,
      },
    });
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
  const nextDb = await writeServerDb(cancelPendingNoticePushJobs({
    ...db,
    notices: db.notices.filter((candidate) => candidate.id !== notice.id),
    auditLogs: [auditLog, ...db.auditLogs],
  }, notice.id, "공지가 삭제되어 대기 중인 발송 요청을 취소했습니다.", now));

  return jsonOk({
    ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId),
    notice: {
      deletedAt: now,
      id: notice.id,
    },
  });
}
