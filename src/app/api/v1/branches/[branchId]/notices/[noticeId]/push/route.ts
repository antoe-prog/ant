import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { canReadNotice, getAccessibleBranchIds } from "@/lib/mock-api";
import { noticePublisherRoles } from "@/lib/notice-permissions";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, writeServerDb } from "@/server/db";
import {
  createNoticePushDispatchMessage,
  dispatchNoticePushNotifications,
  getNoticeFamilyRecipientCount,
  getNoticePushSubscriptions,
} from "@/server/push-notifications";

export const runtime = "nodejs";

export async function POST(
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

  const recipientCount = getNoticeFamilyRecipientCount(db, notice);
  const candidateCount = getNoticePushSubscriptions(db, notice).length;
  const { db: dbWithDispatchResult, summary } = await dispatchNoticePushNotifications(db, notice);
  const result: AuditLog["result"] = !summary.configured || candidateCount === 0 ? "blocked" : summary.failed > 0 ? "failed" : "success";
  const auditMessage = createNoticePushDispatchMessage({ candidateCount, recipientCount, summary });
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "notification.dispatch",
    targetType: "notice",
    targetId: notice.id,
    before: null,
    after: {
      configured: summary.configured,
      attempted: summary.attempted,
      recipientCount,
      sent: summary.sent,
      failed: summary.failed,
      disabled: summary.disabled,
    },
    result,
    message: auditMessage,
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...dbWithDispatchResult,
    auditLogs: [auditLog, ...dbWithDispatchResult.auditLogs],
  });

  return jsonOk({
    ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? branchId),
    push: {
      ...summary,
      recipientCount,
      message: auditMessage,
    },
  });
}
