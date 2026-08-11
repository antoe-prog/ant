import type {
  AuditLog,
  MockDatabase,
  PushDispatchJob,
  PushDispatchJobStatus,
  PushDispatchPayloadSnapshot,
} from "../lib/domain";
import { noticeStateLockKey } from "../lib/notices.ts";

// Notice content, recipient reads, cancellation, and delivery fencing share one state transition.
export const notificationOutboxLockKey = noticeStateLockKey;
export const notificationOutboxStatuses = [
  "pending",
  "leased",
  "retry_scheduled",
  "sent",
  "disabled",
  "dead",
  "cancelled",
] as const;

export type NotificationOutboxDatabase = MockDatabase;

export type NotificationOutboxRetryPolicy = {
  baseDelayMs: number;
  maxDelayMs: number;
};

type EnqueuePushDispatchJobInput = Omit<
  PushDispatchJob,
  | "status"
  | "revision"
  | "attemptCount"
  | "nextAttemptAt"
  | "createdAt"
  | "updatedAt"
  | "lastAttemptAt"
  | "completedAt"
  | "leaseToken"
  | "leaseExpiresAt"
  | "cancellationRequestedAt"
  | "cancellationReason"
  | "providerCallStartedAt"
  | "providerCallCompletedAt"
  | "providerFenceExpiresAt"
  | "providerOutcome"
  | "deliveryMayHaveOccurred"
  | "lastFailureReason"
> & {
  now: string;
};

type LeasePushDispatchJobInput = {
  leaseToken: string;
  leaseDurationMs: number;
  now: string;
  jobId?: string;
  retryPolicy?: NotificationOutboxRetryPolicy;
};

type SettlePushDispatchJobInput = {
  jobId: string;
  leaseToken: string;
  expectedRevision: number;
  now: string;
  result:
    | { outcome: "sent" }
    | { outcome: "cancelled"; reason: string }
    | {
        outcome: "failed";
        statusCode?: number;
        errorCode?: string;
        message?: string;
        deliveryUncertain?: boolean;
        retryAfterMs?: number;
      };
  retryPolicy?: NotificationOutboxRetryPolicy;
};

type BeginPushDispatchProviderCallInput = {
  jobId: string;
  leaseToken: string;
  expectedRevision: number;
  now: string;
};

export type NotificationOutboxMutationFailure = {
  ok: false;
  db: NotificationOutboxDatabase;
  reason:
    | "audit_not_found"
    | "idempotency_conflict"
    | "job_not_found"
    | "job_not_leased"
    | "job_leased"
    | "provider_call_not_started"
    | "stale_revision"
    | "stale_lease";
};

function hasActivePushProviderFence(job: PushDispatchJob, nowMs: number) {
  if (!job.providerCallStartedAt) {
    return false;
  }

  const fallbackFence = job.providerOutcome === "uncertain" ? job.nextAttemptAt : "";
  const fenceExpiresAt = Date.parse(job.providerFenceExpiresAt ?? job.leaseExpiresAt ?? fallbackFence);

  if (job.status === "leased" && !job.providerCallCompletedAt) {
    return !Number.isFinite(fenceExpiresAt) || fenceExpiresAt > nowMs;
  }

  return job.providerOutcome === "uncertain" && Number.isFinite(fenceExpiresAt) && fenceExpiresAt > nowMs;
}

export function hasInFlightPushDispatchForSubscription(
  db: NotificationOutboxDatabase,
  subscriptionId: string,
  now = new Date(),
) {
  const nowMs = now.getTime();

  return db.pushDispatchJobs.some(
    (job) => job.subscriptionId === subscriptionId && hasActivePushProviderFence(job, nowMs),
  );
}

export function hasInFlightPushDispatchForUser(
  db: NotificationOutboxDatabase,
  userId: string,
  now = new Date(),
) {
  return db.pushSubscriptions
    .filter((subscription) => subscription.userId === userId)
    .some((subscription) => hasInFlightPushDispatchForSubscription(db, subscription.id, now));
}

export function preparePushDispatchJobsForUserDeletion(
  db: NotificationOutboxDatabase,
  userId: string,
  input: { now: string; reason: string },
):
  | { ok: true; db: NotificationOutboxDatabase; cancelledJobCount: number }
  | { ok: false; db: NotificationOutboxDatabase; reason: "push_delivery_in_flight" } {
  const subscriptionIds = new Set(
    db.pushSubscriptions
      .filter((subscription) => subscription.userId === userId)
      .map((subscription) => subscription.id),
  );
  if (hasInFlightPushDispatchForUser(db, userId, new Date(input.now))) {
    return { ok: false, db, reason: "push_delivery_in_flight" };
  }

  const cancellableJobIds = new Set(
    db.pushDispatchJobs
      .filter((job) => subscriptionIds.has(job.subscriptionId) && !terminal(job.status))
      .map((job) => job.id),
  );
  const nextDb = cancelPushDispatchJobsForSubscriptions(db, subscriptionIds, input);
  const cancelledJobCount = nextDb.pushDispatchJobs.filter(
    (job) => cancellableJobIds.has(job.id) && (job.status === "cancelled" || Boolean(job.cancellationRequestedAt)),
  ).length;

  return { ok: true, db: nextDb, cancelledJobCount };
}

const defaultRetryPolicy: NotificationOutboxRetryPolicy = {
  baseDelayMs: 30_000,
  maxDelayMs: 30 * 60_000,
};

function timestamp(value: string, field: string) {
  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid ISO timestamp.`);
  }

  return parsed;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }

  return value;
}

function jobs(db: NotificationOutboxDatabase) {
  return db.pushDispatchJobs;
}

function terminal(status: PushDispatchJobStatus) {
  return status === "sent" || status === "disabled" || status === "dead" || status === "cancelled";
}

function revision(job: PushDispatchJob) {
  return Number.isSafeInteger(job.revision) && job.revision > 0 ? job.revision : 0;
}

function withoutLease(job: PushDispatchJob) {
  const nextJob = { ...job };
  delete nextJob.leaseToken;
  delete nextJob.leaseExpiresAt;
  return nextJob;
}

function withoutProviderAttempt(job: PushDispatchJob) {
  const nextJob = { ...job };
  delete nextJob.providerCallStartedAt;
  delete nextJob.providerCallCompletedAt;
  delete nextJob.providerFenceExpiresAt;
  delete nextJob.providerOutcome;
  return nextJob;
}

function withoutProviderFence(job: PushDispatchJob) {
  const nextJob = { ...job };
  delete nextJob.providerFenceExpiresAt;
  return nextJob;
}

function replaceJob(db: NotificationOutboxDatabase, job: PushDispatchJob): NotificationOutboxDatabase {
  return {
    ...db,
    pushDispatchJobs: jobs(db).map((candidate) => (candidate.id === job.id ? job : candidate)),
  };
}

function syncDispatchAudit(db: NotificationOutboxDatabase, auditLogId: string, now: string) {
  const auditJobs = jobs(db).filter((job) => job.auditLogId === auditLogId);

  if (auditJobs.length === 0) {
    return db;
  }

  const sent = auditJobs.filter((job) => job.status === "sent").length;
  const disabled = auditJobs.filter((job) => job.status === "disabled").length;
  const dead = auditJobs.filter((job) => job.status === "dead").length;
  const cancelled = auditJobs.filter((job) => job.status === "cancelled").length;
  const cancellationRequested = auditJobs.filter((job) => job.status === "leased" && job.cancellationRequestedAt).length;
  const deliveryUncertain = auditJobs.filter((job) => job.deliveryMayHaveOccurred).length;
  const pending = auditJobs.length - sent - disabled - dead - cancelled;
  const attempted = auditJobs.reduce((sum, job) => sum + job.attemptCount, 0);
  const retryScheduledJobs = auditJobs.filter((job) => job.status === "retry_scheduled");
  const nextAttemptAt = retryScheduledJobs
    .map((job) => job.nextAttemptAt)
    .sort((left, right) => left.localeCompare(right))[0];
  const requestAudit = db.auditLogs.find((auditLog) => auditLog.id === auditLogId);
  const candidateCount = Number(requestAudit?.after?.candidateCount ?? auditJobs.length);
  const configuredCandidateCount = Number(requestAudit?.after?.dispatchableCount);
  const expectedJobCount = Number.isSafeInteger(configuredCandidateCount) && configuredCandidateCount >= 0
    ? configuredCandidateCount
    : candidateCount;
  const recordedUnconfiguredCount = Number(requestAudit?.after?.unconfiguredCount);
  const unconfigured = Number.isSafeInteger(recordedUnconfiguredCount) && recordedUnconfiguredCount >= 0
    ? recordedUnconfiguredCount
    : Number.isSafeInteger(candidateCount) && Number.isSafeInteger(expectedJobCount)
      ? Math.max(candidateCount - expectedJobCount, 0)
      : 0;
  const complete = pending === 0 && auditJobs.length >= expectedJobCount;
  const result: AuditLog["result"] = !complete
    ? "blocked"
    : dead > 0 || disabled > 0 || unconfigured > 0
      ? "failed"
      : cancelled > 0
        ? "blocked"
        : "success";
  const dispatchState = !complete
    ? cancellationRequested > 0
      ? "cancellation_requested"
      : retryScheduledJobs.length > 0
      ? "retry_scheduled"
      : "requested"
    : result === "success"
      ? "completed"
      : result === "blocked"
        ? "blocked"
        : "failed";
  const message = !complete
    ? cancellationRequested > 0
      ? `provider 호출 경계에 있는 ${cancellationRequested}건의 취소 결과를 확인하고 있습니다.`
      : retryScheduledJobs.length > 0
      ? `휴대폰 푸시 ${sent}건 발송, ${retryScheduledJobs.length}건 재시도 예정입니다.`
      : `공지 알림 ${auditJobs.length}건을 대기열에서 처리하고 있습니다.`
    : result === "success"
      ? `휴대폰 푸시 ${sent}건 발송을 완료했습니다.`
      : result === "blocked"
        ? `휴대폰 푸시 ${sent}건 발송, ${cancelled}건 취소${deliveryUncertain > 0 ? `, 전달 가능성 확인 필요 ${deliveryUncertain}건` : ""}입니다.`
        : `휴대폰 푸시 ${sent}건 발송, 만료 구독 ${disabled}건, 최종 실패 ${dead}건${unconfigured > 0 ? `, 제공자 설정 미완료 ${unconfigured}건` : ""}${cancelled > 0 ? `, 취소 ${cancelled}건` : ""}${deliveryUncertain > 0 ? `, 전달 가능성 확인 필요 ${deliveryUncertain}건` : ""}입니다.`;

  return {
    ...db,
    auditLogs: db.auditLogs.map((auditLog) =>
      auditLog.id === auditLogId
        ? {
            ...auditLog,
            after: {
              ...auditLog.after,
              dispatchState,
              outboxJobCount: auditJobs.length,
              attempted,
              pending,
              sent,
              disabled,
              dead,
              unconfiguredCount: unconfigured,
              cancelled,
              cancellationRequested,
              deliveryUncertain,
              ...(nextAttemptAt ? { nextAttemptAt } : {}),
              ...(complete ? { completedAt: now } : {}),
            },
            result,
            message,
          }
        : auditLog,
    ),
  };
}

export function getNotificationOutboxDispatchSummary(db: NotificationOutboxDatabase, auditLogId: string) {
  const auditJobs = jobs(db).filter((job) => job.auditLogId === auditLogId);
  const auditLog = db.auditLogs.find((candidate) => candidate.id === auditLogId);
  const pending = auditJobs.filter(
    (job) => job.status === "pending" || job.status === "leased" || job.status === "retry_scheduled",
  ).length;

  return {
    configured: Boolean(auditLog?.after?.configured ?? auditJobs.length > 0),
    attempted: auditJobs.reduce((sum, job) => sum + job.attemptCount, 0),
    sent: auditJobs.filter((job) => job.status === "sent").length,
    disabled: auditJobs.filter((job) => job.status === "disabled").length,
    failed: auditJobs.filter((job) => job.status === "dead" || job.status === "disabled").length,
    unconfigured: Number.isSafeInteger(Number(auditLog?.after?.unconfiguredCount))
      ? Math.max(Number(auditLog?.after?.unconfiguredCount), 0)
      : 0,
    pending,
    dead: auditJobs.filter((job) => job.status === "dead").length,
    cancelled: auditJobs.filter((job) => job.status === "cancelled").length,
    cancellationRequested: auditJobs.filter((job) => job.status === "leased" && job.cancellationRequestedAt).length,
    deliveryUncertain: auditJobs.filter((job) => job.deliveryMayHaveOccurred).length,
    nextAttemptAt:
      auditJobs
        .filter((job) => job.status === "retry_scheduled")
        .map((job) => job.nextAttemptAt)
        .sort((left, right) => left.localeCompare(right))[0] ?? null,
  };
}

function replaceJobAndSyncAudit(db: NotificationOutboxDatabase, job: PushDispatchJob) {
  return syncDispatchAudit(replaceJob(db, job), job.auditLogId, job.updatedAt);
}

function validateRetryPolicy(policy: NotificationOutboxRetryPolicy | undefined) {
  const resolved = policy ?? defaultRetryPolicy;
  positiveInteger(resolved.baseDelayMs, "baseDelayMs");
  positiveInteger(resolved.maxDelayMs, "maxDelayMs");
  return resolved;
}

function immutableFingerprint(input: EnqueuePushDispatchJobInput) {
  return JSON.stringify({
    auditLogId: input.auditLogId,
    branchId: input.branchId,
    maxAttempts: input.maxAttempts,
    noticeId: input.noticeId,
    payloadSnapshot: input.payloadSnapshot,
    recipientUserId: input.recipientUserId,
    subscriptionId: input.subscriptionId,
  });
}

function existingFingerprint(job: PushDispatchJob) {
  return JSON.stringify({
    auditLogId: job.auditLogId,
    branchId: job.branchId,
    maxAttempts: job.maxAttempts,
    noticeId: job.noticeId,
    payloadSnapshot: job.payloadSnapshot,
    recipientUserId: job.recipientUserId,
    subscriptionId: job.subscriptionId,
  });
}

function hasMatchingRequestAudit(db: NotificationOutboxDatabase, input: EnqueuePushDispatchJobInput) {
  return db.auditLogs.some(
    (auditLog) =>
      auditLog.id === input.auditLogId &&
      auditLog.action === "notification.dispatch" &&
      auditLog.targetType === "notice" &&
      auditLog.targetId === input.noticeId &&
      auditLog.branchId === input.branchId,
  );
}

export function createNoticePushTag(noticeId: string) {
  const normalized = noticeId.trim();

  if (!normalized) {
    throw new Error("noticeId is required.");
  }

  return `final-judo-notice-${normalized}`;
}

export const noticePushTitleMaxBytes = 256;
export const noticePushBodyMaxBytes = 1_200;

function truncateUtf8Preview(value: string, maxBytes: number) {
  const normalized = value.trim();

  if (Buffer.byteLength(normalized, "utf8") <= maxBytes) {
    return normalized;
  }

  const ellipsis = "…";
  const byteBudget = maxBytes - Buffer.byteLength(ellipsis, "utf8");
  const characters: string[] = [];
  let usedBytes = 0;

  for (const character of normalized) {
    const characterBytes = Buffer.byteLength(character, "utf8");

    if (usedBytes + characterBytes > byteBudget) {
      break;
    }

    characters.push(character);
    usedBytes += characterBytes;
  }

  return `${characters.join("").trimEnd()}${ellipsis}`;
}

// Store only the user-visible payload that was approved with the request audit. This keeps retries deterministic
// after notice edits or deletion without duplicating subscription endpoints, keys, or other delivery credentials.
export function createNoticePushPayloadSnapshot(input: {
  noticeId: string;
  title: string;
  body: string;
  important?: boolean;
  url?: string;
}): PushDispatchPayloadSnapshot {
  const title = input.title.trim();
  const body = input.body.trim();

  if (!title || !body) {
    throw new Error("title and body are required.");
  }

  const visibleTitle = input.important ? `[중요] ${title}` : title;

  return {
    // Native push providers enforce byte-based payload limits. Keep the full notice in the app and send a bounded preview.
    title: truncateUtf8Preview(visibleTitle, noticePushTitleMaxBytes),
    body: truncateUtf8Preview(body, noticePushBodyMaxBytes),
    tag: createNoticePushTag(input.noticeId),
    url: input.url?.trim() || "/app/notifications",
  };
}

export function calculateNotificationOutboxBackoffMs(
  attemptCount: number,
  policy: NotificationOutboxRetryPolicy = defaultRetryPolicy,
) {
  positiveInteger(attemptCount, "attemptCount");
  const resolved = validateRetryPolicy(policy);
  return Math.min(resolved.maxDelayMs, resolved.baseDelayMs * 2 ** Math.min(attemptCount - 1, 30));
}

export function isPermanentPushSubscriptionFailure(
  statusCode: number | undefined,
  errorCode?: string,
) {
  if (errorCode?.startsWith("APNS_")) {
    return [
      "APNS_BAD_DEVICE_TOKEN",
      "APNS_DEVICE_TOKEN_NOT_FOR_TOPIC",
      "APNS_EXPIRED_TOKEN",
      "APNS_UNREGISTERED",
    ].includes(errorCode);
  }

  if (errorCode?.startsWith("FCM_")) {
    return [
      "FCM_INVALID_REGISTRATION_TOKEN",
      "FCM_SENDER_ID_MISMATCH",
      "FCM_UNREGISTERED",
    ].includes(errorCode);
  }

  return statusCode === 404 || statusCode === 410;
}

const nonRetryablePushDispatchErrorCodes = new Set([
  "APNS_FORBIDDEN",
  "APNS_PAYLOAD_EMPTY",
  "APNS_PAYLOAD_TOO_LARGE",
  "FCM_INVALID_ARGUMENT",
]);

export function isNonRetryablePushDispatchFailure(
  statusCode: number | undefined,
  errorCode?: string,
) {
  if (errorCode && nonRetryablePushDispatchErrorCodes.has(errorCode)) {
    return true;
  }

  return statusCode === 413;
}

const expiredPushSubscriptionReason = "알림 수신 등록이 만료되어 비활성화했습니다.";
const expiredPushSubscriptionCancellationReason =
  "알림 수신 등록이 만료되어 같은 기기의 남은 발송을 취소했습니다.";

export function enqueuePushDispatchJob(
  db: NotificationOutboxDatabase,
  input: EnqueuePushDispatchJobInput,
):
  | { ok: true; db: NotificationOutboxDatabase; job: PushDispatchJob; created: boolean }
  | NotificationOutboxMutationFailure {
  timestamp(input.now, "now");
  positiveInteger(input.maxAttempts, "maxAttempts");
  const id = input.id.trim();

  if (!id || !input.auditLogId.trim() || !input.subscriptionId.trim() || !input.recipientUserId.trim()) {
    throw new Error("id, auditLogId, subscriptionId, and recipientUserId are required.");
  }

  if (input.payloadSnapshot.tag !== createNoticePushTag(input.noticeId)) {
    throw new Error("payloadSnapshot.tag must be stable for the notice id.");
  }

  if (!hasMatchingRequestAudit(db, input)) {
    return { ok: false, db, reason: "audit_not_found" };
  }

  const existing = jobs(db).find(
    (job) => job.id === id || (job.auditLogId === input.auditLogId && job.subscriptionId === input.subscriptionId),
  );

  if (existing) {
    if (existing.id !== id || existingFingerprint(existing) !== immutableFingerprint(input)) {
      return { ok: false, db, reason: "idempotency_conflict" };
    }

    return { ok: true, db, job: existing, created: false };
  }

  const job: PushDispatchJob = {
    id,
    auditLogId: input.auditLogId,
    noticeId: input.noticeId,
    branchId: input.branchId,
    subscriptionId: input.subscriptionId,
    recipientUserId: input.recipientUserId,
    status: "pending",
    revision: 1,
    attemptCount: 0,
    maxAttempts: input.maxAttempts,
    nextAttemptAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
    payloadSnapshot: { ...input.payloadSnapshot },
  };
  const nextDb = syncDispatchAudit(
    {
      ...db,
      pushDispatchJobs: [...jobs(db), job],
    },
    job.auditLogId,
    input.now,
  );

  return { ok: true, db: nextDb, job, created: true };
}

function expireLease(job: PushDispatchJob, now: string, retryPolicy: NotificationOutboxRetryPolicy) {
  const leaseExpiredAt = job.leaseExpiresAt ?? now;
  const cancellationRequested = Boolean(job.cancellationRequestedAt);
  const exhausted = job.attemptCount >= job.maxAttempts;
  const nextAttemptAt = new Date(
    timestamp(leaseExpiredAt, "leaseExpiresAt") + calculateNotificationOutboxBackoffMs(job.attemptCount, retryPolicy),
  ).toISOString();

  return {
    ...withoutLease(job),
    status: cancellationRequested
      ? ("cancelled" as const)
      : exhausted
        ? ("dead" as const)
        : ("retry_scheduled" as const),
    revision: revision(job) + 1,
    nextAttemptAt,
    updatedAt: now,
    lastFailureReason: cancellationRequested
      ? job.cancellationReason || "취소 요청 후 작업 lease가 만료됐습니다."
      : "작업 lease가 만료되어 발송 결과를 확정하지 못했습니다.",
    ...(job.providerCallStartedAt
      ? {
          providerCallCompletedAt: now,
          ...(job.providerFenceExpiresAt || job.leaseExpiresAt
            ? { providerFenceExpiresAt: job.providerFenceExpiresAt ?? job.leaseExpiresAt }
            : {}),
          providerOutcome: "uncertain" as const,
          deliveryMayHaveOccurred: true,
        }
      : cancellationRequested
        ? { providerOutcome: "not_started" as const }
        : {}),
    ...(exhausted || cancellationRequested ? { completedAt: now } : {}),
  };
}

export function recoverExpiredPushDispatchLeases(
  db: NotificationOutboxDatabase,
  now: string,
  retryPolicy?: NotificationOutboxRetryPolicy,
) {
  const nowMs = timestamp(now, "now");
  const policy = validateRetryPolicy(retryPolicy);
  let nextDb = db;
  const expired = jobs(db).filter(
    (job) => job.status === "leased" && job.leaseExpiresAt && timestamp(job.leaseExpiresAt, "leaseExpiresAt") <= nowMs,
  );

  for (const job of expired) {
    nextDb = replaceJobAndSyncAudit(nextDb, expireLease(job, now, policy));
  }

  return nextDb;
}

// Web Push cannot provide exactly-once delivery. If sending succeeds and persistence crashes, the lease expires and
// the same immutable payload may be sent again. The stable notice tag lets clients replace the visible notification.
// Persist enqueue, lease, and settlement under one database transaction or this shared lock; lease tokens only reject stale workers.
export function leasePushDispatchJob(
  db: NotificationOutboxDatabase,
  input: LeasePushDispatchJobInput,
): { db: NotificationOutboxDatabase; job: PushDispatchJob | null } {
  const nowMs = timestamp(input.now, "now");
  const leaseDurationMs = positiveInteger(input.leaseDurationMs, "leaseDurationMs");
  const leaseToken = input.leaseToken.trim();

  if (!leaseToken) {
    throw new Error("leaseToken is required.");
  }

  const recoveredDb = recoverExpiredPushDispatchLeases(db, input.now, input.retryPolicy);
  const selected = jobs(recoveredDb)
    .filter(
      (job) =>
        (!input.jobId || job.id === input.jobId) &&
        (job.status === "pending" || job.status === "retry_scheduled") &&
        timestamp(job.nextAttemptAt, "nextAttemptAt") <= nowMs &&
        !hasActivePushProviderFence(job, nowMs),
    )
    .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt) || left.createdAt.localeCompare(right.createdAt))[0];

  if (!selected) {
    return { db: recoveredDb, job: null };
  }

  const leasedJob: PushDispatchJob = {
    ...withoutProviderAttempt(selected),
    status: "leased",
    revision: revision(selected) + 1,
    attemptCount: selected.attemptCount + 1,
    leaseToken,
    leaseExpiresAt: new Date(nowMs + leaseDurationMs).toISOString(),
    lastAttemptAt: input.now,
    updatedAt: input.now,
  };

  return { db: replaceJobAndSyncAudit(recoveredDb, leasedJob), job: leasedJob };
}

export function beginPushDispatchProviderCall(
  db: NotificationOutboxDatabase,
  input: BeginPushDispatchProviderCallInput,
):
  | { ok: true; db: NotificationOutboxDatabase; job: PushDispatchJob; shouldSend: boolean }
  | NotificationOutboxMutationFailure {
  const job = jobs(db).find((candidate) => candidate.id === input.jobId);

  if (!job) {
    return { ok: false, db, reason: "job_not_found" };
  }

  if (job.status !== "leased") {
    return { ok: false, db, reason: "job_not_leased" };
  }

  if (
    job.leaseToken !== input.leaseToken ||
    !job.leaseExpiresAt ||
    timestamp(job.leaseExpiresAt, "leaseExpiresAt") <= timestamp(input.now, "now")
  ) {
    return { ok: false, db, reason: "stale_lease" };
  }

  if (job.cancellationRequestedAt) {
    const cancelledJob: PushDispatchJob = {
      ...withoutLease(job),
      status: "cancelled",
      revision: revision(job) + 1,
      updatedAt: input.now,
      completedAt: input.now,
      providerOutcome: "not_started",
      lastFailureReason: job.cancellationReason || "provider 호출 전에 발송이 취소됐습니다.",
    };
    return {
      ok: true,
      db: replaceJobAndSyncAudit(db, cancelledJob),
      job: cancelledJob,
      shouldSend: false,
    };
  }

  if (revision(job) !== input.expectedRevision) {
    return { ok: false, db, reason: "stale_revision" };
  }

  const startedJob: PushDispatchJob = {
    ...job,
    revision: revision(job) + 1,
    providerCallStartedAt: input.now,
    providerFenceExpiresAt: job.leaseExpiresAt,
    updatedAt: input.now,
  };

  return {
    ok: true,
    db: replaceJobAndSyncAudit(db, startedJob),
    job: startedJob,
    shouldSend: true,
  };
}

function failureReason(result: Extract<SettlePushDispatchJobInput["result"], { outcome: "failed" }>) {
  return (result.errorCode?.trim() || result.message?.trim() || (result.statusCode ? `HTTP ${result.statusCode}` : "unknown")).slice(0, 240);
}

export function settlePushDispatchJob(
  db: NotificationOutboxDatabase,
  input: SettlePushDispatchJobInput,
): { ok: true; db: NotificationOutboxDatabase; job: PushDispatchJob } | NotificationOutboxMutationFailure {
  const job = jobs(db).find((candidate) => candidate.id === input.jobId);

  if (!job) {
    return { ok: false, db, reason: "job_not_found" };
  }

  if (job.status !== "leased") {
    return { ok: false, db, reason: "job_not_leased" };
  }

  if (
    job.leaseToken !== input.leaseToken ||
    !job.leaseExpiresAt ||
    timestamp(job.leaseExpiresAt, "leaseExpiresAt") <= timestamp(input.now, "now")
  ) {
    return { ok: false, db, reason: "stale_lease" };
  }

  if (input.result.outcome !== "cancelled" && !job.providerCallStartedAt) {
    return { ok: false, db, reason: "provider_call_not_started" };
  }

  if (job.cancellationRequestedAt) {
    const providerOutcome =
      input.result.outcome === "sent"
        ? ("accepted" as const)
        : input.result.outcome === "failed" && input.result.deliveryUncertain
          ? ("uncertain" as const)
          : input.result.outcome === "failed"
            ? ("failed" as const)
            : job.providerCallStartedAt
              ? ("uncertain" as const)
              : ("not_started" as const);
    const deliveryMayHaveOccurred = Boolean(
      job.deliveryMayHaveOccurred ||
      (job.providerCallStartedAt && (input.result.outcome === "sent" || providerOutcome === "uncertain")),
    );
    const cancellationBase = providerOutcome === "uncertain"
      ? withoutLease(job)
      : withoutProviderFence(withoutLease(job));
    const cancelledJob: PushDispatchJob = {
      ...cancellationBase,
      status: "cancelled",
      revision: revision(job) + 1,
      updatedAt: input.now,
      completedAt: input.now,
      ...(job.providerCallStartedAt ? { providerCallCompletedAt: input.now } : {}),
      providerOutcome,
      deliveryMayHaveOccurred,
      lastFailureReason: deliveryMayHaveOccurred
        ? `${job.cancellationReason || "발송이 취소됐습니다."} provider 호출이 이미 시작되어 단말 수신 가능성을 배제할 수 없습니다.`
        : job.cancellationReason || "발송이 취소됐습니다.",
    };
    const cancelledDb = replaceJobAndSyncAudit(db, cancelledJob);
    return { ok: true, db: cancelledDb, job: cancelledJob };
  }

  if (revision(job) !== input.expectedRevision) {
    return { ok: false, db, reason: "stale_revision" };
  }

  const permanentSubscriptionFailure =
    input.result.outcome === "failed" &&
    isPermanentPushSubscriptionFailure(input.result.statusCode, input.result.errorCode);
  const nonRetryableDispatchFailure =
    input.result.outcome === "failed" &&
    !permanentSubscriptionFailure &&
    isNonRetryablePushDispatchFailure(input.result.statusCode, input.result.errorCode);
  let nextSubscriptions = db.pushSubscriptions;
  let nextJob: PushDispatchJob;

  if (input.result.outcome === "sent") {
    nextSubscriptions = nextSubscriptions.map((subscription) =>
      subscription.id === job.subscriptionId
        ? {
            ...subscription,
            lastSentAt: input.now,
            lastFailureAt: undefined,
            lastFailureReason: undefined,
            updatedAt: input.now,
          }
        : subscription,
    );
    nextJob = {
      ...withoutProviderFence(withoutLease(job)),
      status: "sent",
      revision: revision(job) + 1,
      updatedAt: input.now,
      completedAt: input.now,
      providerCallCompletedAt: input.now,
      providerOutcome: "accepted",
      lastFailureReason: undefined,
    };
  } else if (input.result.outcome === "cancelled") {
    const providerOutcome = job.providerCallStartedAt ? "uncertain" : "not_started";
    const cancellationBase = providerOutcome === "uncertain"
      ? withoutLease(job)
      : withoutProviderFence(withoutLease(job));
    nextJob = {
      ...cancellationBase,
      status: "cancelled",
      revision: revision(job) + 1,
      updatedAt: input.now,
      completedAt: input.now,
      ...(job.providerCallStartedAt ? { providerCallCompletedAt: input.now } : {}),
      providerOutcome,
      deliveryMayHaveOccurred: Boolean(job.deliveryMayHaveOccurred || job.providerCallStartedAt),
      lastFailureReason: input.result.reason.trim().slice(0, 240) || "발송 대상에서 제외됐습니다.",
    };
  } else if (permanentSubscriptionFailure) {
    nextSubscriptions = nextSubscriptions.map((subscription) =>
      subscription.id === job.subscriptionId
        ? {
            ...subscription,
            disabledAt: input.now,
            disabledReason: "provider_invalid" as const,
            lastFailureAt: input.now,
            lastFailureReason: expiredPushSubscriptionReason,
            updatedAt: input.now,
          }
        : subscription,
    );
    nextJob = {
      ...withoutProviderFence(withoutLease(job)),
      status: "disabled",
      revision: revision(job) + 1,
      updatedAt: input.now,
      completedAt: input.now,
      providerCallCompletedAt: input.now,
      providerOutcome: "failed",
      lastFailureReason: expiredPushSubscriptionReason,
    };
  } else if (nonRetryableDispatchFailure) {
    nextJob = {
      ...withoutProviderFence(withoutLease(job)),
      status: "dead",
      revision: revision(job) + 1,
      updatedAt: input.now,
      completedAt: input.now,
      providerCallCompletedAt: input.now,
      providerOutcome: "failed",
      lastFailureReason: failureReason(input.result),
    };
  } else {
    const exhausted = job.attemptCount >= job.maxAttempts;
    const nowMs = timestamp(input.now, "now");
    const backoffAttemptAtMs = nowMs + calculateNotificationOutboxBackoffMs(job.attemptCount, input.retryPolicy);
    const providerRetryAfterMs = Number.isSafeInteger(input.result.retryAfterMs) && input.result.retryAfterMs! > 0
      ? input.result.retryAfterMs!
      : 0;
    const providerAttemptAtMs = nowMs + providerRetryAfterMs;
    const providerFenceExpiresAt = input.result.deliveryUncertain
      ? job.providerFenceExpiresAt ?? job.leaseExpiresAt
      : undefined;
    const providerFenceExpiresAtMs = providerFenceExpiresAt
      ? timestamp(providerFenceExpiresAt, "providerFenceExpiresAt")
      : 0;
    const nextAttemptAtMs = Math.max(backoffAttemptAtMs, providerAttemptAtMs, providerFenceExpiresAtMs);
    if (!Number.isFinite(nextAttemptAtMs) || nextAttemptAtMs > 8_640_000_000_000_000) {
      throw new Error("nextAttemptAt exceeds the supported timestamp range.");
    }
    const nextAttemptAt = new Date(nextAttemptAtMs).toISOString();
    const failureBase = input.result.deliveryUncertain
      ? withoutLease(job)
      : withoutProviderFence(withoutLease(job));
    nextJob = {
      ...failureBase,
      status: exhausted ? "dead" : "retry_scheduled",
      revision: revision(job) + 1,
      nextAttemptAt,
      updatedAt: input.now,
      providerCallCompletedAt: input.now,
      ...(providerFenceExpiresAt ? { providerFenceExpiresAt } : {}),
      providerOutcome: input.result.deliveryUncertain ? "uncertain" : "failed",
      deliveryMayHaveOccurred: Boolean(job.deliveryMayHaveOccurred || input.result.deliveryUncertain),
      lastFailureReason: failureReason(input.result),
      ...(exhausted ? { completedAt: input.now } : {}),
    };
  }

  const settledDb = replaceJobAndSyncAudit(
    {
      ...db,
      pushSubscriptions: nextSubscriptions,
    },
    nextJob,
  );
  const nextDb = permanentSubscriptionFailure
    ? cancelPushDispatchJobsForSubscriptions(settledDb, new Set([job.subscriptionId]), {
        now: input.now,
        reason: expiredPushSubscriptionCancellationReason,
      })
    : settledDb;

  return { ok: true, db: nextDb, job: nextJob };
}

export function cancelPushDispatchJob(
  db: NotificationOutboxDatabase,
  input: { jobId: string; now: string; reason: string },
): { ok: true; db: NotificationOutboxDatabase; job: PushDispatchJob } | NotificationOutboxMutationFailure {
  const nowMs = timestamp(input.now, "now");
  const job = jobs(db).find((candidate) => candidate.id === input.jobId);

  if (!job) {
    return { ok: false, db, reason: "job_not_found" };
  }

  if (job.status === "leased") {
    const reason = input.reason.trim().slice(0, 240) || "발송 요청을 취소했습니다.";

    if (job.cancellationRequestedAt && job.cancellationReason === reason) {
      return { ok: true, db, job };
    }

    const cancellationRequestedJob: PushDispatchJob = {
      ...job,
      revision: revision(job) + 1,
      cancellationRequestedAt: input.now,
      cancellationReason: reason,
      deliveryMayHaveOccurred: Boolean(job.deliveryMayHaveOccurred || job.providerCallStartedAt),
      updatedAt: input.now,
    };
    return {
      ok: true,
      db: replaceJobAndSyncAudit(db, cancellationRequestedJob),
      job: cancellationRequestedJob,
    };
  }

  if (terminal(job.status)) {
    return { ok: true, db, job };
  }

  const providerFenceActive = hasActivePushProviderFence(job, nowMs);
  const cancellationBase = providerFenceActive
    ? withoutLease(job)
    : withoutProviderFence(withoutLease(job));
  const cancelledJob: PushDispatchJob = {
    ...cancellationBase,
    status: "cancelled",
    revision: revision(job) + 1,
    updatedAt: input.now,
    completedAt: input.now,
    cancellationRequestedAt: input.now,
    cancellationReason: input.reason.trim().slice(0, 240) || "발송 요청을 취소했습니다.",
    providerOutcome: providerFenceActive ? "uncertain" : "not_started",
    deliveryMayHaveOccurred: Boolean(job.deliveryMayHaveOccurred || providerFenceActive),
    lastFailureReason: input.reason.trim().slice(0, 240) || "발송 요청을 취소했습니다.",
  };

  return { ok: true, db: replaceJobAndSyncAudit(db, cancelledJob), job: cancelledJob };
}

export function cancelPushDispatchJobsForSubscriptions(
  db: NotificationOutboxDatabase,
  subscriptionIds: ReadonlySet<string>,
  input: { now: string; reason: string },
): NotificationOutboxDatabase {
  let nextDb = db;

  for (const job of jobs(db)) {
    if (!subscriptionIds.has(job.subscriptionId)) {
      continue;
    }

    const cancelled = cancelPushDispatchJob(nextDb, {
      jobId: job.id,
      now: input.now,
      reason: input.reason,
    });

    if (cancelled.ok) {
      nextDb = cancelled.db;
    }
  }

  return nextDb;
}
