import { NextRequest } from "next/server";
import { canReadNotice, getAccessibleBranchIds } from "@/lib/mock-api";
import { noticePublisherRoles } from "@/lib/notice-permissions";
import { noticeStateLockKey } from "@/lib/notices";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import {
  createNoticePushDispatchRequestAuditLog,
  getNoticeFamilyRecipientCount,
  getNoticePushSubscriptions,
} from "@/server/push-notifications";
import { getNotificationOutboxDispatchSummary } from "@/server/notification-outbox";
import {
  findManualPushDispatchAudit,
  prepareNoticePushDispatchJobs,
  processNotificationOutbox,
  resolveManualPushIdempotency,
} from "@/server/notification-outbox-runner";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string; noticeId: string }> },
) {
  const { branchId, noticeId } = await params;
  const dispatch = await withServerDbLock(noticeStateLockKey, async () => {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return response;
    }

    if (!noticePublisherRoles.has(user.role)) {
      return jsonError(403, "FORBIDDEN", "공지 알림을 보낼 수 없습니다.");
    }

    if (!getAccessibleBranchIds(user, db).includes(branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 공지를 발송할 수 없습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 공지를 발송할 수 없습니다.");
    }

    const notice = db.notices.find((item) => item.id === noticeId && item.branchId === branchId);

    if (!notice) {
      return jsonError(404, "NOT_FOUND", "발송할 공지를 찾을 수 없습니다.");
    }

    if (user.role === "coach" && !canReadNotice(user, db, notice, [branchId])) {
      return jsonError(403, "FORBIDDEN", "담당 범위의 공지만 알림을 보낼 수 있습니다.");
    }

    const requestedAt = new Date().toISOString();
    const idempotency = resolveManualPushIdempotency({
      rawKey: request.headers.get("idempotency-key"),
      actorUserId: user.id,
      branchId,
      noticeId: notice.id,
      now: requestedAt,
    });

    if (!idempotency.ok) {
      return jsonError(400, "INVALID_IDEMPOTENCY_KEY", idempotency.reason);
    }

    const replayAudit = findManualPushDispatchAudit(db, {
      actorUserId: user.id,
      branchId,
      noticeId: notice.id,
      digest: idempotency.digest,
    });

    if (replayAudit) {
      return {
        actorUserId: user.id,
        auditLogId: replayAudit.id,
        candidateCount: Number(replayAudit.after?.candidateCount ?? 0),
        recipientCount: Number(replayAudit.after?.recipientCount ?? 0),
        selectedBranchId: selectedScope.selectedBranchId ?? branchId,
        idempotencyPolicy: idempotency.policy,
        replayed: true,
      };
    }

    const recipientCount = getNoticeFamilyRecipientCount(db, notice);
    const candidateCount = getNoticePushSubscriptions(db, notice).length;
    const baseDispatchRequestAuditLog = createNoticePushDispatchRequestAuditLog({
      auditId: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
      branchId,
      actorUserId: user.id,
      noticeId: notice.id,
      candidateCount,
      recipientCount,
      requestedAt,
    });
    const dispatchRequestAuditLog = {
      ...baseDispatchRequestAuditLog,
      after: {
        ...baseDispatchRequestAuditLog.after,
        manualDispatch: true,
        idempotencyDigest: idempotency.digest,
        idempotencyPolicy: idempotency.policy,
        ...(idempotency.windowExpiresAt ? { idempotencyWindowExpiresAt: idempotency.windowExpiresAt } : {}),
      },
    };
    const dbWithAudit = {
      ...db,
      auditLogs: [dispatchRequestAuditLog, ...db.auditLogs],
    };
    const prepared = prepareNoticePushDispatchJobs(dbWithAudit, notice, dispatchRequestAuditLog, requestedAt);
    await writeServerDb(prepared.db);

    return {
      actorUserId: user.id,
      auditLogId: dispatchRequestAuditLog.id,
      candidateCount,
      recipientCount,
      selectedBranchId: selectedScope.selectedBranchId ?? branchId,
      idempotencyPolicy: idempotency.policy,
      replayed: false,
    };
  });

  if (dispatch instanceof Response) {
    return dispatch;
  }

  try {
    await processNotificationOutbox({ auditLogId: dispatch.auditLogId, limit: Math.max(dispatch.candidateCount, 1) });
  } catch {
    // The scheduled worker will retry durable jobs after transient request failures.
  }

  const responseDb = await readServerDb();
  const actor = responseDb.users.find((candidate) => candidate.id === dispatch.actorUserId);

  if (!actor) {
    return jsonError(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }

  const summary = getNotificationOutboxDispatchSummary(responseDb, dispatch.auditLogId);
  const requestAudit = responseDb.auditLogs.find((auditLog) => auditLog.id === dispatch.auditLogId);

  return jsonOk({
    ...createBootstrapPayload(responseDb, actor, dispatch.selectedBranchId),
    push: {
      ...summary,
      recipientCount: dispatch.recipientCount,
      message: requestAudit?.message ?? "공지 알림을 대기열에 저장했습니다.",
    },
    idempotency: {
      policy: dispatch.idempotencyPolicy,
      replayed: dispatch.replayed,
    },
  });
}
