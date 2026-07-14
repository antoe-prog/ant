import { NextRequest } from "next/server";
import type { AuditLog, Notice, NoticeAudience } from "@/lib/domain";
import { userRoles } from "@/lib/domain";
import { getAccessibleBranchIds, getAccessibleMemberIds } from "@/lib/mock-api";
import { noticePublisherRoles } from "@/lib/notice-permissions";
import { noticeStateLockKey } from "@/lib/notices";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import {
  createNoticePushDispatchRequestAuditLog,
  getNoticeFamilyRecipientCount,
  getNoticePushSubscriptions,
} from "@/server/push-notifications";
import {
  prepareNoticePushDispatchJobs,
  processNotificationOutbox,
} from "@/server/notification-outbox-runner";
import { getNotificationOutboxDispatchSummary } from "@/server/notification-outbox";

export const runtime = "nodejs";

type NoticeCreateBody = {
  title?: string;
  body?: string;
  important?: boolean;
  audience?: NoticeAudience[];
  targetClassIds?: string[];
  targetMemberIds?: string[];
};

function isValidAudience(value: string): value is NoticeAudience {
  return value === "all" || userRoles.includes(value as (typeof userRoles)[number]);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string }> },
) {
  const { branchId } = await params;
  const initialDb = await readServerDb();
  const { user: initialUser, response } = requireSession(request, initialDb);

  if (!initialUser) {
    return response;
  }

  if (!noticePublisherRoles.has(initialUser.role)) {
    return jsonError(403, "FORBIDDEN", "공지 작성 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(initialUser, initialDb).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 공지를 작성할 수 없습니다.");
  }

  const initialSelectedScope = requireSelectedBranchScope(request, initialUser, initialDb);

  if (initialSelectedScope.response) {
    return initialSelectedScope.response;
  }

  if (initialSelectedScope.selectedBranchId && initialSelectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 공지를 작성할 수 없습니다.");
  }

  const body = (await request.json().catch(() => null)) as NoticeCreateBody | null;
  const title = body?.title?.trim() ?? "";
  const noticeBody = body?.body?.trim() ?? "";
  const important = body?.important === true;
  const audience = [...new Set(body?.audience ?? [])];
  const targetClassIds = [...new Set(body?.targetClassIds ?? [])].filter(Boolean);
  const requestedTargetMemberIds = [...new Set(body?.targetMemberIds ?? [])].filter(Boolean);

  if (!title || !noticeBody) {
    return jsonError(400, "VALIDATION_ERROR", "공지 제목과 본문이 필요합니다.");
  }

  if (audience.length === 0 || audience.some((item) => !isValidAudience(item))) {
    return jsonError(400, "VALIDATION_ERROR", "공지 대상이 올바르지 않습니다.");
  }

  const creation = await withServerDbLock(noticeStateLockKey, async () => {
    const db = await readServerDb();
    const { user, response: lockedResponse } = requireSession(request, db);

    if (!user) {
      return lockedResponse;
    }

    if (!noticePublisherRoles.has(user.role)) {
      return jsonError(403, "FORBIDDEN", "공지 작성 권한이 없습니다.");
    }

    if (!getAccessibleBranchIds(user, db).includes(branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점에 공지를 작성할 수 없습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점에 공지를 작성할 수 없습니다.");
    }

    if (!db.branches.some((candidate) => candidate.id === branchId)) {
      return jsonError(404, "NOT_FOUND", "지점을 찾을 수 없습니다.");
    }

    const invalidClassIds = targetClassIds.filter(
      (classId) => !db.classes.some((session) => session.id === classId && session.branchId === branchId),
    );
    const invalidMemberIds = requestedTargetMemberIds.filter(
      (memberId) => !db.members.some((member) => member.id === memberId && member.branchId === branchId),
    );

    if (invalidClassIds.length > 0 || invalidMemberIds.length > 0) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "공지 대상 반/회원이 선택한 지점에 속하지 않습니다.", {
        invalidClassIds,
        invalidMemberIds,
      });
    }

    let targetMemberIds = requestedTargetMemberIds;

    if (user.role === "coach") {
      const coachClassIds = new Set(
        db.classes
          .filter((session) => session.branchId === branchId && session.coachId === user.id)
          .map((session) => session.id),
      );
      const coachMemberIds = new Set(getAccessibleMemberIds(user, db, [branchId]));
      const outOfScopeClassIds = targetClassIds.filter((classId) => !coachClassIds.has(classId));
      const outOfScopeMemberIds = targetMemberIds.filter((memberId) => !coachMemberIds.has(memberId));

      if (outOfScopeClassIds.length > 0 || outOfScopeMemberIds.length > 0) {
        return jsonError(403, "FORBIDDEN", "담당 수업과 담당 회원에게만 공지를 발행할 수 있습니다.", {
          outOfScopeClassIds,
          outOfScopeMemberIds,
        });
      }

      if (targetClassIds.length === 0 && targetMemberIds.length === 0) {
        targetMemberIds = [...coachMemberIds];
      }

      if (targetClassIds.length === 0 && targetMemberIds.length === 0) {
        return jsonError(422, "BUSINESS_RULE_FAILED", "공지 받을 담당 회원이 없습니다.");
      }
    }

    const now = new Date().toISOString();
    const noticeId = `notice-${Date.now()}`;
    const nextNotice: Notice = {
      id: noticeId,
      branchId,
      title,
      body: noticeBody,
      important,
      audience,
      createdByUserId: user.id,
      createdAt: now,
      readByUserIds: [],
      ...(targetClassIds.length > 0 ? { targetClassIds } : {}),
      ...(targetMemberIds.length > 0 ? { targetMemberIds } : {}),
    };
    const dbWithNotice = {
      ...db,
      notices: [nextNotice, ...db.notices],
    };
    const recipientCount = getNoticeFamilyRecipientCount(dbWithNotice, nextNotice);
    const candidateCount = getNoticePushSubscriptions(dbWithNotice, nextNotice).length;
    const noticeAuditLog: AuditLog = {
      id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
      branchId,
      actorUserId: user.id,
      action: "notice.create",
      targetType: "notice",
      targetId: noticeId,
      before: null,
      after: {
        title,
        important,
        audience,
        createdByUserId: user.id,
        targetClassIds,
        targetMemberIds,
      },
      result: "success",
      message: "공지를 작성했습니다.",
      createdAt: now,
    };
    const dispatchRequestAuditLog = createNoticePushDispatchRequestAuditLog({
      auditId: `audit-${Date.now()}-${db.auditLogs.length + 2}`,
      branchId,
      actorUserId: user.id,
      noticeId,
      candidateCount,
      recipientCount,
      requestedAt: now,
      autoDispatchedOnCreate: true,
    });
    const dbWithAudits = {
      ...dbWithNotice,
      auditLogs: [dispatchRequestAuditLog, noticeAuditLog, ...db.auditLogs],
    };
    const prepared = prepareNoticePushDispatchJobs(dbWithAudits, nextNotice, dispatchRequestAuditLog, now);
    await writeServerDb(prepared.db);

    return {
      actorUserId: user.id,
      auditLogId: dispatchRequestAuditLog.id,
      candidateCount,
      noticeId,
      recipientCount,
      selectedBranchId: selectedScope.selectedBranchId ?? branchId,
    };
  });

  if (creation instanceof Response) {
    return creation;
  }

  try {
    await processNotificationOutbox({ auditLogId: creation.auditLogId, limit: Math.max(creation.candidateCount, 1) });
  } catch {
    // The durable jobs remain pending or leased for the scheduled worker.
  }

  const responseDb = await readServerDb();
  const actor = responseDb.users.find((candidate) => candidate.id === creation.actorUserId) ?? initialUser;
  const summary = getNotificationOutboxDispatchSummary(responseDb, creation.auditLogId);
  const requestAudit = responseDb.auditLogs.find((auditLog) => auditLog.id === creation.auditLogId);

  return jsonOk({
    ...createBootstrapPayload(responseDb, actor, creation.selectedBranchId),
    notice: { id: creation.noticeId },
    push: {
      ...summary,
      recipientCount: creation.recipientCount,
      message: requestAudit?.message ?? "공지 알림을 대기열에 저장했습니다.",
    },
  });
}
