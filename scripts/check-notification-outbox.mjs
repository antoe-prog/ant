import assert from "node:assert/strict";

const {
  beginPushDispatchProviderCall,
  calculateNotificationOutboxBackoffMs,
  cancelPushDispatchJob,
  createNoticePushPayloadSnapshot,
  enqueuePushDispatchJob,
  isPermanentPushSubscriptionFailure,
  leasePushDispatchJob,
  notificationOutboxLockKey,
  recoverExpiredPushDispatchLeases,
  settlePushDispatchJob,
} = await import("../src/server/notification-outbox.ts");
const { noticeStateLockKey } = await import("../src/lib/notices.ts");

const start = "2026-07-14T00:00:00.000Z";
const retryPolicy = { baseDelayMs: 1_000, maxDelayMs: 8_000 };

assert.equal(notificationOutboxLockKey, noticeStateLockKey, "notice edits and outbox transitions must share one lock");

function addMs(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function createDb(suffix) {
  return {
    branches: [],
    users: [],
    members: [],
    classes: [],
    attendance: [],
    counselingNotes: [],
    promotions: [],
    tournaments: [],
    payments: [],
    notices: [],
    pushDispatchJobs: [],
    pushSubscriptions: [
      {
        id: `push-${suffix}`,
        userId: `user-${suffix}`,
        branchIds: ["branch-a"],
        endpoint: `https://push.example/${suffix}`,
        keys: { auth: "auth", p256dh: "p256dh" },
        createdAt: start,
        updatedAt: start,
      },
    ],
    pilotReadinessChecks: [],
    pilotIncidents: [],
    pilotOperationLogs: [],
    auditLogs: [
      {
        id: `audit-${suffix}`,
        branchId: "branch-a",
        actorUserId: "owner-a",
        action: "notification.dispatch",
        targetType: "notice",
        targetId: `notice-${suffix}`,
        before: null,
        after: { candidateCount: 1, dispatchState: "requested" },
        result: "blocked",
        message: "공지 알림 발송 요청을 저장했습니다.",
        createdAt: start,
      },
    ],
  };
}

function enqueue(db, suffix, options = {}) {
  return enqueuePushDispatchJob(db, {
    id: `push-job-${suffix}`,
    auditLogId: `audit-${suffix}`,
    noticeId: `notice-${suffix}`,
    branchId: "branch-a",
    subscriptionId: `push-${suffix}`,
    recipientUserId: `user-${suffix}`,
    payloadSnapshot:
      options.payloadSnapshot ??
      createNoticePushPayloadSnapshot({
        noticeId: `notice-${suffix}`,
        title: "휴관 안내",
        body: "이번 주 토요일은 휴관입니다.",
        important: true,
      }),
    maxAttempts: options.maxAttempts ?? 3,
    now: options.now ?? start,
  });
}

function lease(db, suffix, now, leaseToken = `lease-${suffix}`) {
  return leasePushDispatchJob(db, {
    jobId: `push-job-${suffix}`,
    leaseToken,
    leaseDurationMs: 5_000,
    now,
    retryPolicy,
  });
}

assert.equal(calculateNotificationOutboxBackoffMs(1, retryPolicy), 1_000);
assert.equal(calculateNotificationOutboxBackoffMs(4, retryPolicy), 8_000);
assert.equal(isPermanentPushSubscriptionFailure(404), true);
assert.equal(isPermanentPushSubscriptionFailure(410), true);
assert.equal(isPermanentPushSubscriptionFailure(503), false);

const successQueued = enqueue(createDb("success"), "success");
assert.equal(successQueued.ok, true);
assert.equal(successQueued.created, true);
assert.equal(successQueued.job.payloadSnapshot.tag, "final-judo-notice-notice-success");
assert.equal(successQueued.db.auditLogs[0].after.outboxJobCount, 1);
const successDuplicate = enqueue(successQueued.db, "success");
assert.equal(successDuplicate.ok, true);
assert.equal(successDuplicate.created, false, "the same job id and immutable payload must be idempotent");
assert.equal(successDuplicate.db.pushDispatchJobs.length, 1);
const successConflict = enqueue(successQueued.db, "success", {
  payloadSnapshot: createNoticePushPayloadSnapshot({
    noticeId: "notice-success",
    title: "변경된 제목",
    body: "이번 주 토요일은 휴관입니다.",
  }),
});
assert.equal(successConflict.ok, false);
assert.equal(successConflict.reason, "idempotency_conflict");
const successLeased = lease(successQueued.db, "success", start);
assert.equal(successLeased.job.status, "leased");
assert.equal(successLeased.job.attemptCount, 1);
assert.equal(
  lease(successLeased.db, "success", addMs(start, 10), "lease-competing-worker").job,
  null,
  "a persisted active lease must prevent a second worker from claiming the same job",
);
const successSettled = settlePushDispatchJob(successLeased.db, {
  jobId: "push-job-success",
  leaseToken: "lease-success",
  expectedRevision: successLeased.job.revision,
  now: addMs(start, 100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(successSettled.ok, true);
assert.equal(successSettled.job.status, "sent");
assert.equal(successSettled.db.auditLogs[0].result, "success");
assert.equal(successSettled.db.auditLogs[0].after.dispatchState, "completed");

const retryQueued = enqueue(createDb("retry"), "retry");
const retryLeased = lease(retryQueued.db, "retry", start);
const retryScheduled = settlePushDispatchJob(retryLeased.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry",
  expectedRevision: retryLeased.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 503, errorCode: "PUSH_UNAVAILABLE" },
  retryPolicy,
});
assert.equal(retryScheduled.ok, true);
assert.equal(retryScheduled.job.status, "retry_scheduled");
assert.equal(retryScheduled.job.nextAttemptAt, addMs(start, 1_100));
assert.equal(lease(retryScheduled.db, "retry", addMs(start, 1_000), "lease-too-early").job, null);
const retryLeasedAgain = lease(retryScheduled.db, "retry", addMs(start, 1_100), "lease-retry-2");
assert.equal(retryLeasedAgain.job.attemptCount, 2);
const retryCompleted = settlePushDispatchJob(retryLeasedAgain.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry-2",
  expectedRevision: retryLeasedAgain.job.revision,
  now: addMs(start, 1_200),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(retryCompleted.ok, true);
assert.equal(retryCompleted.job.status, "sent");

const deadQueued = enqueue(createDb("dead"), "dead", { maxAttempts: 2 });
const deadLeased1 = lease(deadQueued.db, "dead", start, "lease-dead-1");
const deadRetry = settlePushDispatchJob(deadLeased1.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-1",
  expectedRevision: deadLeased1.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 500 },
  retryPolicy,
});
const deadLeased2 = lease(deadRetry.db, "dead", deadRetry.job.nextAttemptAt, "lease-dead-2");
const deadSettled = settlePushDispatchJob(deadLeased2.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-2",
  expectedRevision: deadLeased2.job.revision,
  now: addMs(deadRetry.job.nextAttemptAt, 100),
  result: { outcome: "failed", statusCode: 500 },
  retryPolicy,
});
assert.equal(deadSettled.ok, true);
assert.equal(deadSettled.job.status, "dead");
assert.equal(deadSettled.db.auditLogs[0].result, "failed");

const disabledQueued = enqueue(createDb("disabled"), "disabled");
const disabledLeased = lease(disabledQueued.db, "disabled", start);
const disabledSettled = settlePushDispatchJob(disabledLeased.db, {
  jobId: "push-job-disabled",
  leaseToken: "lease-disabled",
  expectedRevision: disabledLeased.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 410 },
  retryPolicy,
});
assert.equal(disabledSettled.ok, true);
assert.equal(disabledSettled.job.status, "disabled");
assert.equal(disabledSettled.db.pushSubscriptions[0].disabledAt, addMs(start, 100));

const cancelledQueued = enqueue(createDb("cancelled"), "cancelled");
const cancelled = cancelPushDispatchJob(cancelledQueued.db, {
  jobId: "push-job-cancelled",
  now: addMs(start, 100),
  reason: "공지가 삭제됐습니다.",
});
assert.equal(cancelled.ok, true);
assert.equal(cancelled.job.status, "cancelled");

const crashQueued = enqueue(createDb("crash"), "crash");
const crashLeased = lease(crashQueued.db, "crash", start, "lease-before-crash");
const firstPayload = structuredClone(crashLeased.job.payloadSnapshot);
// Simulate Web Push success followed by a process crash before the sent status is persisted.
const recoveredCrashDb = recoverExpiredPushDispatchLeases(crashLeased.db, addMs(start, 5_000), retryPolicy);
const recoveredCrash = recoveredCrashDb.pushDispatchJobs[0];
assert.equal(recoveredCrash.status, "retry_scheduled");
assert.equal(recoveredCrash.nextAttemptAt, addMs(start, 6_000));
const staleSettlement = settlePushDispatchJob(recoveredCrashDb, {
  jobId: "push-job-crash",
  leaseToken: "lease-before-crash",
  expectedRevision: crashLeased.job.revision,
  now: addMs(start, 5_100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(staleSettlement.ok, false);
assert.equal(staleSettlement.reason, "job_not_leased");
const crashReLeased = lease(recoveredCrashDb, "crash", addMs(start, 6_000), "lease-after-crash");
assert.equal(crashReLeased.job.attemptCount, 2);
assert.deepEqual(crashReLeased.job.payloadSnapshot, firstPayload, "at-least-once retry must reuse the immutable payload snapshot");
assert.equal(
  crashReLeased.job.payloadSnapshot.tag,
  "final-judo-notice-notice-crash",
  "at-least-once retries must keep a stable notification tag so the client can replace the visible notification",
);

const beforeProviderQueued = enqueue(createDb("cancel-before-provider"), "cancel-before-provider");
const beforeProviderLeased = lease(beforeProviderQueued.db, "cancel-before-provider", start);
const beforeProviderCancellation = cancelPushDispatchJob(beforeProviderLeased.db, {
  jobId: "push-job-cancel-before-provider",
  now: addMs(start, 25),
  reason: "공지가 수정됐습니다.",
});
assert.equal(beforeProviderCancellation.ok, true);
assert.equal(beforeProviderCancellation.job.status, "leased");
assert.equal(beforeProviderCancellation.job.cancellationRequestedAt, addMs(start, 25));
const beforeProviderBegin = beginPushDispatchProviderCall(beforeProviderCancellation.db, {
  jobId: "push-job-cancel-before-provider",
  leaseToken: "lease-cancel-before-provider",
  expectedRevision: beforeProviderLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(beforeProviderBegin.ok, true);
assert.equal(beforeProviderBegin.shouldSend, false, "a cancellation observed before provider start must prevent delivery");
assert.equal(beforeProviderBegin.job.status, "cancelled");
assert.equal(beforeProviderBegin.job.providerOutcome, "not_started");
assert.equal(beforeProviderBegin.job.deliveryMayHaveOccurred, false);

const afterProviderQueued = enqueue(createDb("cancel-after-provider"), "cancel-after-provider");
const afterProviderLeased = lease(afterProviderQueued.db, "cancel-after-provider", start);
const afterProviderBegin = beginPushDispatchProviderCall(afterProviderLeased.db, {
  jobId: "push-job-cancel-after-provider",
  leaseToken: "lease-cancel-after-provider",
  expectedRevision: afterProviderLeased.job.revision,
  now: addMs(start, 25),
});
assert.equal(afterProviderBegin.ok, true);
assert.equal(afterProviderBegin.shouldSend, true);
const staleRevisionSettlement = settlePushDispatchJob(afterProviderBegin.db, {
  jobId: "push-job-cancel-after-provider",
  leaseToken: "lease-cancel-after-provider",
  expectedRevision: afterProviderLeased.job.revision,
  now: addMs(start, 30),
  result: { outcome: "sent" },
});
assert.equal(staleRevisionSettlement.ok, false);
assert.equal(staleRevisionSettlement.reason, "stale_revision");
const afterProviderCancellation = cancelPushDispatchJob(afterProviderBegin.db, {
  jobId: "push-job-cancel-after-provider",
  now: addMs(start, 40),
  reason: "공지가 삭제됐습니다.",
});
assert.equal(afterProviderCancellation.ok, true);
assert.equal(afterProviderCancellation.job.deliveryMayHaveOccurred, true);
const afterProviderSettlement = settlePushDispatchJob(afterProviderCancellation.db, {
  jobId: "push-job-cancel-after-provider",
  leaseToken: "lease-cancel-after-provider",
  expectedRevision: afterProviderBegin.job.revision,
  now: addMs(start, 60),
  result: { outcome: "sent" },
});
assert.equal(afterProviderSettlement.ok, true);
assert.equal(afterProviderSettlement.job.status, "cancelled");
assert.equal(afterProviderSettlement.job.providerOutcome, "accepted");
assert.equal(afterProviderSettlement.job.deliveryMayHaveOccurred, true);
assert.match(afterProviderSettlement.job.lastFailureReason, /수신 가능성/);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
    "job-id idempotency and immutable payload conflict",
    "notice and outbox state transitions share one lock",
        "request/completion audit linkage",
        "successful send",
        "transient failure exponential retry",
        "maximum-attempt dead letter",
        "404/410 subscription disable",
        "pending cancellation",
        "expired lease recovery",
        "revision fencing and stale settlement rejection",
        "leased cancellation before and after provider start",
        "at-least-once retry with stable notification tag",
      ],
    },
    null,
    2,
  ),
);
