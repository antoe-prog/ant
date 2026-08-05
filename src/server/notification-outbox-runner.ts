import { createHash, randomBytes } from "node:crypto";
import type { AuditLog, MockDatabase, Notice, PushDispatchJob } from "@/lib/domain";
import { getGuardianFamilyMemberIds } from "@/lib/family-members";
import { isNoticeRecipient } from "@/lib/mock-api";
import { isNoticeRelevantToMember } from "@/lib/notices";
import { isPushSubscriptionOwnedByRecipient } from "@/lib/push-subscription-scope";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import {
  beginPushDispatchProviderCall,
  cancelPushDispatchJob,
  createNoticePushPayloadSnapshot,
  enqueuePushDispatchJob,
  getNotificationOutboxDispatchSummary,
  leasePushDispatchJob,
  notificationOutboxLockKey,
  settlePushDispatchJob,
} from "@/server/notification-outbox";
import {
  completeNoticePushDispatchAuditLog,
  getNoticePushSubscriptions,
  getPushConfig,
  sendPushPayloadToSubscription,
  runPushDeliveryWithTimeout,
  type PushDeliveryResult,
} from "@/server/push-notifications";
import { createRuntimeId } from "@/server/runtime-id";
import { runNotificationOutboxWorkerPool } from "@/server/notification-outbox-workers";

const defaultLeaseDurationMs = 5 * 60_000;
const defaultMaxAttempts = 5;
const manualPushCompatibilityWindowMs = 5 * 60_000;

export const notificationOutboxExecutionPolicy = {
  interactive: {
    concurrency: 10,
    limit: 20,
  },
  scheduled: {
    concurrency: 10,
    limit: 50,
  },
} as const;

export type ManualPushIdempotency = {
  ok: true;
  digest: string;
  policy: "explicit" | "compatibility_window";
  windowExpiresAt: string | null;
} | {
  ok: false;
  reason: string;
};

export function resolveManualPushIdempotency(input: {
  rawKey: string | null;
  actorUserId: string;
  branchId: string;
  noticeId: string;
  now: string;
}): ManualPushIdempotency {
  const rawKey = input.rawKey?.trim() ?? "";
  const requestedAt = Date.parse(input.now);

  if (!Number.isFinite(requestedAt)) {
    throw new Error("Manual push idempotency requires a valid timestamp.");
  }

  if (rawKey && (rawKey.length < 16 || rawKey.length > 128 || !/^[\x21-\x7E]+$/.test(rawKey))) {
    return {
      ok: false,
      reason: "Idempotency-Key는 공백 없는 ASCII 16~128자로 보내야 합니다.",
    };
  }

  const policy = rawKey ? "explicit" : "compatibility_window";
  const window = Math.floor(requestedAt / manualPushCompatibilityWindowMs);
  const material = rawKey || `compatibility-window:${window}`;
  const digest = createHash("sha256")
    .update(["notice-push-v1", input.actorUserId, input.branchId, input.noticeId, material].join("\u0000"))
    .digest("hex");

  return {
    ok: true,
    digest,
    policy,
    windowExpiresAt: policy === "compatibility_window"
      ? new Date((window + 1) * manualPushCompatibilityWindowMs).toISOString()
      : null,
  };
}

export function findManualPushDispatchAudit(
  db: MockDatabase,
  input: { actorUserId: string; branchId: string; noticeId: string; digest: string },
) {
  return db.auditLogs.find(
    (auditLog) =>
      auditLog.action === "notification.dispatch" &&
      auditLog.targetType === "notice" &&
      auditLog.targetId === input.noticeId &&
      auditLog.branchId === input.branchId &&
      auditLog.actorUserId === input.actorUserId &&
      auditLog.after?.manualDispatch === true &&
      auditLog.after?.idempotencyDigest === input.digest,
  ) ?? null;
}

function samePayload(left: PushDispatchJob["payloadSnapshot"], right: PushDispatchJob["payloadSnapshot"]) {
  return left.title === right.title && left.body === right.body && left.tag === right.tag && left.url === right.url;
}

function createNoticeDeepLink(db: MockDatabase, notice: Notice, recipientUserId: string) {
  const recipient = db.users.find((user) => user.id === recipientUserId);
  const candidateMemberIds =
    recipient?.role === "guardian"
      ? getGuardianFamilyMemberIds(recipient, db)
      : recipient?.role === "member"
        ? recipient.memberIds ?? []
        : [];
  const matchingMemberIds = candidateMemberIds.filter((memberId) =>
    isNoticeRelevantToMember(notice, memberId, db.classes),
  );
  const params = new URLSearchParams({ highlight: notice.id });

  if (matchingMemberIds.length === 1) {
    params.set("memberId", matchingMemberIds[0]);
  }

  return `/app/notifications?${params.toString()}`;
}

function createCurrentNoticePayload(db: MockDatabase, notice: Notice, recipientUserId: string) {
  return createNoticePushPayloadSnapshot({
    noticeId: notice.id,
    title: notice.title,
    body: notice.body,
    important: notice.important,
    url: createNoticeDeepLink(db, notice, recipientUserId),
  });
}

export function prepareNoticePushDispatchJobs(
  db: MockDatabase,
  notice: Notice,
  requestAuditLog: AuditLog,
  now = requestAuditLog.createdAt,
) {
  const subscriptions = getNoticePushSubscriptions(db, notice);
  const configured = getPushConfig().configured;
  let nextDb: MockDatabase = {
    ...db,
    auditLogs: db.auditLogs.map((auditLog) =>
      auditLog.id === requestAuditLog.id
        ? { ...auditLog, after: { ...auditLog.after, configured } }
        : auditLog,
    ),
  };

  if (!configured || subscriptions.length === 0) {
    const completed = completeNoticePushDispatchAuditLog(requestAuditLog, {
      configured,
      attempted: 0,
      disabled: 0,
      failed: 0,
      sent: 0,
    }, now);
    return {
      db: {
        ...nextDb,
        auditLogs: nextDb.auditLogs.map((auditLog) => auditLog.id === completed.id ? completed : auditLog),
      },
      enqueued: 0,
    };
  }

  for (const subscription of subscriptions) {
    const payloadSnapshot = createCurrentNoticePayload(db, notice, subscription.userId);
    const result = enqueuePushDispatchJob(nextDb, {
      id: `push-job-${requestAuditLog.id}-${subscription.id}`,
      auditLogId: requestAuditLog.id,
      branchId: notice.branchId,
      noticeId: notice.id,
      subscriptionId: subscription.id,
      recipientUserId: subscription.userId,
      maxAttempts: defaultMaxAttempts,
      now,
      payloadSnapshot,
    });

    if (!result.ok) {
      throw new Error(`Push outbox enqueue failed: ${result.reason}`);
    }
    nextDb = result.db;
  }

  return { db: nextDb, enqueued: subscriptions.length };
}

export function validateLeasedPushDispatchJob(db: MockDatabase, job: PushDispatchJob) {
  const subscription = db.pushSubscriptions.find((candidate) => candidate.id === job.subscriptionId);
  const notice = db.notices.find((candidate) => candidate.id === job.noticeId && candidate.branchId === job.branchId);
  const recipient = db.users.find((candidate) => candidate.id === job.recipientUserId);

  if (!subscription || subscription.disabledAt) {
    return { ok: false as const, reason: "알림 수신 등록이 없거나 비활성화됐습니다." };
  }
  if (!isPushSubscriptionOwnedByRecipient(subscription, job.recipientUserId)) {
    return { ok: false as const, reason: "알림 수신 등록의 사용자가 변경됐습니다." };
  }
  if (!notice || !recipient || !isNoticeRecipient(recipient, db, notice)) {
    return { ok: false as const, reason: "공지 또는 수신 대상이 변경됐습니다." };
  }
  if (!samePayload(job.payloadSnapshot, createCurrentNoticePayload(db, notice, job.recipientUserId))) {
    return { ok: false as const, reason: "공지 내용이 변경되어 이전 발송 요청을 취소했습니다." };
  }

  return { ok: true as const, subscription };
}

function createAttemptAuditLog(
  db: MockDatabase,
  job: PushDispatchJob,
  result: PushDeliveryResult | { outcome: "cancelled"; reason: string },
  now: string,
): AuditLog {
  const requestAudit = db.auditLogs.find((candidate) => candidate.id === job.auditLogId);
  const failed = result.outcome === "failed";

  return {
    id: createRuntimeId("audit-push-attempt"),
    branchId: job.branchId,
    actorUserId: requestAudit?.actorUserId ?? job.recipientUserId,
    action: "notification.dispatch",
    targetType: "notification",
    targetId: job.id,
    before: null,
    after: {
      attempt: job.attemptCount,
      dispatchJobId: job.id,
      jobRevision: job.revision,
      noticeId: job.noticeId,
      outcome: result.outcome,
      providerOutcome: job.providerOutcome ?? null,
      cancellationRequestedAt: job.cancellationRequestedAt ?? null,
      providerCallStartedAt: job.providerCallStartedAt ?? null,
      deliveryMayHaveOccurred: job.deliveryMayHaveOccurred === true,
      ...(failed && result.statusCode ? { statusCode: result.statusCode } : {}),
      ...(failed ? { errorCode: result.errorCode } : {}),
    },
    result: result.outcome === "sent" ? "success" : result.outcome === "cancelled" ? "blocked" : "failed",
    message: result.outcome === "sent"
      ? "휴대폰 푸시 발송을 완료했습니다."
      : result.outcome === "cancelled"
        ? result.reason
        : result.message,
    createdAt: now,
  };
}

function createRejectedSettlementAuditLog(
  db: MockDatabase,
  claimedJob: PushDispatchJob,
  result: PushDeliveryResult,
  reason: string,
  now: string,
): AuditLog {
  const currentJob = db.pushDispatchJobs.find((candidate) => candidate.id === claimedJob.id);
  const requestAudit = db.auditLogs.find((candidate) => candidate.id === claimedJob.auditLogId);
  const deliveryMayHaveOccurred = Boolean(
    claimedJob.deliveryMayHaveOccurred ||
    currentJob?.deliveryMayHaveOccurred ||
    result.outcome === "sent" ||
    (result.outcome === "failed" && result.deliveryUncertain === true),
  );

  return {
    id: createRuntimeId("audit-push-stale-settlement"),
    branchId: claimedJob.branchId,
    actorUserId: requestAudit?.actorUserId ?? claimedJob.recipientUserId,
    action: "notification.dispatch",
    targetType: "notification",
    targetId: claimedJob.id,
    before: null,
    after: {
      dispatchJobId: claimedJob.id,
      noticeId: claimedJob.noticeId,
      outcome: result.outcome,
      settlementState: "rejected",
      rejectionReason: reason,
      claimedRevision: claimedJob.revision,
      currentRevision: currentJob?.revision ?? null,
      currentStatus: currentJob?.status ?? null,
      cancellationRequestedAt: currentJob?.cancellationRequestedAt ?? null,
      providerCallStartedAt: claimedJob.providerCallStartedAt ?? null,
      deliveryMayHaveOccurred,
      ...(result.outcome === "failed" ? { errorCode: result.errorCode } : {}),
    },
    result: "failed",
    message: deliveryMayHaveOccurred
      ? "발송 호출 후 작업 revision이 변경되어 결과를 반영하지 못했습니다. 단말 수신 가능성을 배제할 수 없습니다."
      : "작업 revision이 변경되어 발송 결과를 반영하지 못했습니다.",
    createdAt: now,
  };
}

async function claimNextJob(auditLogId?: string) {
  return withServerDbLock(notificationOutboxLockKey, async () => {
    const db = await readServerDb();
    const now = new Date().toISOString();
    const candidate = auditLogId
      ? db.pushDispatchJobs.find((job) =>
          job.auditLogId === auditLogId &&
          (job.status === "pending" || job.status === "retry_scheduled") &&
          Date.parse(job.nextAttemptAt) <= Date.parse(now),
        )
      : undefined;
    const leased = leasePushDispatchJob(db, {
      leaseToken: randomBytes(24).toString("base64url"),
      leaseDurationMs: defaultLeaseDurationMs,
      now,
      ...(candidate ? { jobId: candidate.id } : auditLogId ? { jobId: "no-due-job" } : {}),
    });

    if (!leased.job) {
      if (leased.db !== db) {
        await writeServerDb(leased.db);
      }
      return null;
    }

    const validation = validateLeasedPushDispatchJob(leased.db, leased.job);

    if (!validation.ok) {
      const settled = settlePushDispatchJob(leased.db, {
        jobId: leased.job.id,
        leaseToken: leased.job.leaseToken!,
        expectedRevision: leased.job.revision,
        now,
        result: { outcome: "cancelled", reason: validation.reason },
      });
      if (!settled.ok) {
        throw new Error(`Push outbox cancellation failed: ${settled.reason}`);
      }
      const attemptAudit = createAttemptAuditLog(settled.db, settled.job, {
        outcome: "cancelled",
        reason: validation.reason,
      }, now);
      await writeServerDb({ ...settled.db, auditLogs: [attemptAudit, ...settled.db.auditLogs] });
      return { cancelled: true as const };
    }

    await writeServerDb(leased.db);
    return { cancelled: false as const, job: leased.job, subscription: validation.subscription };
  });
}

async function beginClaimedProviderCall(claimed: Extract<Awaited<ReturnType<typeof claimNextJob>>, { cancelled: false }>) {
  return withServerDbLock(notificationOutboxLockKey, async () => {
    const db = await readServerDb();
    const now = new Date().toISOString();
    const currentJob = db.pushDispatchJobs.find((candidate) => candidate.id === claimed.job.id);

    if (!currentJob) {
      const rejectedAudit = createRejectedSettlementAuditLog(
        db,
        claimed.job,
        {
          outcome: "failed",
          errorCode: "PUSH_JOB_MISSING_BEFORE_PROVIDER",
          message: "provider 호출 전에 작업을 찾을 수 없습니다.",
        },
        "job_not_found",
        now,
      );
      await writeServerDb({ ...db, auditLogs: [rejectedAudit, ...db.auditLogs] });
      return null;
    }

    const validation = validateLeasedPushDispatchJob(db, currentJob);

    if (!validation.ok) {
      const settled = settlePushDispatchJob(db, {
        jobId: currentJob.id,
        leaseToken: currentJob.leaseToken!,
        expectedRevision: currentJob.revision,
        now,
        result: { outcome: "cancelled", reason: validation.reason },
      });

      if (!settled.ok) {
        const rejectedAudit = createRejectedSettlementAuditLog(
          db,
          claimed.job,
          {
            outcome: "failed",
            errorCode: "PUSH_VALIDATION_SETTLEMENT_REJECTED",
            message: validation.reason,
          },
          settled.reason,
          now,
        );
        await writeServerDb({ ...db, auditLogs: [rejectedAudit, ...db.auditLogs] });
        return null;
      }

      const attemptAudit = createAttemptAuditLog(
        settled.db,
        settled.job,
        { outcome: "cancelled", reason: validation.reason },
        now,
      );
      await writeServerDb({ ...settled.db, auditLogs: [attemptAudit, ...settled.db.auditLogs] });
      return null;
    }

    const begun = beginPushDispatchProviderCall(db, {
      jobId: currentJob.id,
      leaseToken: currentJob.leaseToken!,
      expectedRevision: claimed.job.revision,
      now,
    });

    if (!begun.ok) {
      const rejectedAudit = createRejectedSettlementAuditLog(
        db,
        claimed.job,
        {
          outcome: "failed",
          errorCode: "PUSH_PROVIDER_FENCE_REJECTED",
          message: "provider 호출 fencing에 실패했습니다.",
        },
        begun.reason,
        now,
      );
      await writeServerDb({ ...db, auditLogs: [rejectedAudit, ...db.auditLogs] });
      return null;
    }

    if (!begun.shouldSend) {
      const attemptAudit = createAttemptAuditLog(
        begun.db,
        begun.job,
        { outcome: "cancelled", reason: begun.job.lastFailureReason || "provider 호출 전에 발송이 취소됐습니다." },
        now,
      );
      await writeServerDb({ ...begun.db, auditLogs: [attemptAudit, ...begun.db.auditLogs] });
      return null;
    }

    await writeServerDb(begun.db);
    return { job: begun.job, subscription: validation.subscription };
  });
}

export async function processNotificationOutbox({
  auditLogId,
  concurrency = 1,
  limit = 20,
  send = sendPushPayloadToSubscription,
}: {
  auditLogId?: string;
  concurrency?: number;
  limit?: number;
  send?: typeof sendPushPayloadToSubscription;
} = {}) {
  const processed = await runNotificationOutboxWorkerPool({
    concurrency,
    limit,
    processNext: async () => {
      const claimed = await claimNextJob(auditLogId);
      if (!claimed) {
        return false;
      }
      if (claimed.cancelled) {
        return true;
      }

      const begun = await beginClaimedProviderCall(claimed);

      if (!begun) {
        return true;
      }

      const deliveryResult = await runPushDeliveryWithTimeout(() => send(begun.subscription, begun.job.payloadSnapshot));
      await withServerDbLock(notificationOutboxLockKey, async () => {
        const db = await readServerDb();
        const now = new Date().toISOString();
        const settled = settlePushDispatchJob(db, {
          jobId: begun.job.id,
          leaseToken: begun.job.leaseToken!,
          expectedRevision: begun.job.revision,
          now,
          result: deliveryResult,
        });

        if (!settled.ok) {
          const rejectedAudit = createRejectedSettlementAuditLog(db, begun.job, deliveryResult, settled.reason, now);
          await writeServerDb({ ...db, auditLogs: [rejectedAudit, ...db.auditLogs] });
          return;
        }

        const attemptAudit = createAttemptAuditLog(settled.db, settled.job, deliveryResult, now);
        await writeServerDb({ ...settled.db, auditLogs: [attemptAudit, ...settled.db.auditLogs] });
      });
      return true;
    },
  });

  const db = await readServerDb();
  return {
    processed,
    ...(auditLogId ? { summary: getNotificationOutboxDispatchSummary(db, auditLogId) } : {}),
  };
}

export function cancelPendingNoticePushJobs(db: MockDatabase, noticeId: string, reason: string, now: string) {
  let nextDb = db;

  for (const job of db.pushDispatchJobs.filter((candidate) => candidate.noticeId === noticeId)) {
    const result = cancelPushDispatchJob(nextDb, { jobId: job.id, now, reason });
    if (result.ok) {
      nextDb = result.db;
    }
  }

  return nextDb;
}
