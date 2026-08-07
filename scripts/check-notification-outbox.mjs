import assert from "node:assert/strict";

const {
  beginPushDispatchProviderCall,
  calculateNotificationOutboxBackoffMs,
  cancelPushDispatchJob,
  cancelPushDispatchJobsForSubscriptions,
  createNoticePushPayloadSnapshot,
  enqueuePushDispatchJob,
  hasInFlightPushDispatchForSubscription,
  hasInFlightPushDispatchForUser,
  isPermanentPushSubscriptionFailure,
  leasePushDispatchJob,
  noticePushBodyMaxBytes,
  noticePushTitleMaxBytes,
  notificationOutboxLockKey,
  preparePushDispatchJobsForUserDeletion,
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

const boundedKoreanPayload = createNoticePushPayloadSnapshot({
  noticeId: "notice-byte-limit",
  title: "중요한 공지 ".repeat(100),
  body: "회원과 학부모에게 전달할 긴 공지입니다. ".repeat(500),
  important: true,
});
assert.ok(
  Buffer.byteLength(boundedKoreanPayload.title, "utf8") <= noticePushTitleMaxBytes,
  "push titles must remain within the byte budget",
);
assert.ok(
  Buffer.byteLength(boundedKoreanPayload.body, "utf8") <= noticePushBodyMaxBytes,
  "push bodies must remain within the byte budget",
);
assert.match(boundedKoreanPayload.title, /…$/, "truncated titles must make truncation visible");
assert.match(boundedKoreanPayload.body, /…$/, "truncated bodies must make truncation visible");

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
const userDeletionQueued = enqueue(createDb("user-delete"), "user-delete");
const preparedUserDeletion = preparePushDispatchJobsForUserDeletion(
  userDeletionQueued.db,
  "user-user-delete",
  { now: addMs(start, 25), reason: "사용자 계정 삭제" },
);
assert.equal(preparedUserDeletion.ok, true);
assert.equal(preparedUserDeletion.cancelledJobCount, 1);
assert.equal(
  preparedUserDeletion.db.pushDispatchJobs.find((job) => job.id === "push-job-user-delete")?.status,
  "cancelled",
  "account deletion must cancel queued device work before removing the subscription",
);
const successLeased = lease(successQueued.db, "success", start);
assert.equal(successLeased.job.status, "leased");
assert.equal(successLeased.job.attemptCount, 1);
assert.equal(
  lease(successLeased.db, "success", addMs(start, 10), "lease-competing-worker").job,
  null,
  "a persisted active lease must prevent a second worker from claiming the same job",
);
const successWithoutProvider = settlePushDispatchJob(successLeased.db, {
  jobId: "push-job-success",
  leaseToken: "lease-success",
  expectedRevision: successLeased.job.revision,
  now: addMs(start, 100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(successWithoutProvider.ok, false);
assert.equal(successWithoutProvider.reason, "provider_call_not_started");
const successProviderStarted = beginPushDispatchProviderCall(successLeased.db, {
  jobId: "push-job-success",
  leaseToken: "lease-success",
  expectedRevision: successLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(successProviderStarted.ok, true);
const successSettled = settlePushDispatchJob(successProviderStarted.db, {
  jobId: "push-job-success",
  leaseToken: "lease-success",
  expectedRevision: successProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(successSettled.ok, true);
assert.equal(successSettled.job.status, "sent");
assert.equal(successSettled.db.auditLogs[0].result, "success");
assert.equal(successSettled.db.auditLogs[0].after.dispatchState, "completed");

const partialDb = createDb("partial");
partialDb.auditLogs[0].after.candidateCount = 2;
partialDb.pushSubscriptions.push({
  ...partialDb.pushSubscriptions[0],
  id: "push-partial-cancelled",
  userId: "user-partial-cancelled",
  endpoint: "https://push.example/partial-cancelled",
});
const partialSentQueued = enqueue(partialDb, "partial");
const partialCancelledQueued = enqueuePushDispatchJob(partialSentQueued.db, {
  id: "push-job-partial-cancelled",
  auditLogId: "audit-partial",
  noticeId: "notice-partial",
  branchId: "branch-a",
  subscriptionId: "push-partial-cancelled",
  recipientUserId: "user-partial-cancelled",
  payloadSnapshot: createNoticePushPayloadSnapshot({
    noticeId: "notice-partial",
    title: "휴관 안내",
    body: "이번 주 토요일은 휴관입니다.",
    important: true,
  }),
  maxAttempts: 3,
  now: start,
});
assert.equal(partialCancelledQueued.ok, true);
const partialSentLeased = lease(partialCancelledQueued.db, "partial", start, "lease-partial");
const partialSentProviderStarted = beginPushDispatchProviderCall(partialSentLeased.db, {
  jobId: "push-job-partial",
  leaseToken: "lease-partial",
  expectedRevision: partialSentLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(partialSentProviderStarted.ok, true);
const partialSentSettled = settlePushDispatchJob(partialSentProviderStarted.db, {
  jobId: "push-job-partial",
  leaseToken: "lease-partial",
  expectedRevision: partialSentProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(partialSentSettled.ok, true);
const partialCancelled = cancelPushDispatchJob(partialSentSettled.db, {
  jobId: "push-job-partial-cancelled",
  now: addMs(start, 150),
  reason: "공지 대상에서 제외됐습니다.",
});
assert.equal(partialCancelled.ok, true);
assert.equal(partialCancelled.db.auditLogs[0].result, "blocked");
assert.equal(partialCancelled.db.auditLogs[0].after.dispatchState, "blocked");
assert.equal(partialCancelled.db.auditLogs[0].after.sent, 1);
assert.equal(partialCancelled.db.auditLogs[0].after.cancelled, 1);
assert.match(partialCancelled.db.auditLogs[0].message, /1건 발송, 1건 취소/);

const retryQueued = enqueue(createDb("retry"), "retry");
const retryLeased = lease(retryQueued.db, "retry", start);
const retryProviderStartedFirst = beginPushDispatchProviderCall(retryLeased.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry",
  expectedRevision: retryLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(retryProviderStartedFirst.ok, true);
const retryScheduled = settlePushDispatchJob(retryProviderStartedFirst.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry",
  expectedRevision: retryProviderStartedFirst.job.revision,
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
assert.equal(retryLeasedAgain.job.providerCallCompletedAt, undefined);
assert.equal(retryLeasedAgain.job.providerOutcome, undefined);
const retryProviderStarted = beginPushDispatchProviderCall(retryLeasedAgain.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry-2",
  expectedRevision: retryLeasedAgain.job.revision,
  now: addMs(start, 1_150),
});
assert.equal(retryProviderStarted.ok, true);
assert.equal(
  hasInFlightPushDispatchForSubscription(retryProviderStarted.db, "push-retry", new Date(addMs(start, 1_160))),
  true,
  "a retried provider call must block subscription ownership changes while it is in flight",
);
const retryCompleted = settlePushDispatchJob(retryProviderStarted.db, {
  jobId: "push-job-retry",
  leaseToken: "lease-retry-2",
  expectedRevision: retryProviderStarted.job.revision,
  now: addMs(start, 1_200),
  result: { outcome: "sent" },
  retryPolicy,
});
assert.equal(retryCompleted.ok, true);
assert.equal(retryCompleted.job.status, "sent");
assert.equal(retryCompleted.job.lastFailureReason, undefined, "a successful retry must not retain a stale failure reason");

const uncertainRetryQueued = enqueue(createDb("uncertain-retry"), "uncertain-retry");
const uncertainRetryLeased = lease(uncertainRetryQueued.db, "uncertain-retry", start);
const uncertainRetryProviderStarted = beginPushDispatchProviderCall(uncertainRetryLeased.db, {
  jobId: "push-job-uncertain-retry",
  leaseToken: "lease-uncertain-retry",
  expectedRevision: uncertainRetryLeased.job.revision,
  now: addMs(start, 25),
});
const uncertainRetryScheduled = settlePushDispatchJob(uncertainRetryProviderStarted.db, {
  jobId: "push-job-uncertain-retry",
  leaseToken: "lease-uncertain-retry",
  expectedRevision: uncertainRetryProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", errorCode: "PUSH_PROVIDER_TIMEOUT", deliveryUncertain: true },
  retryPolicy,
});
assert.equal(uncertainRetryScheduled.ok, true);
assert.equal(uncertainRetryScheduled.job.providerFenceExpiresAt, addMs(start, 5_000));
assert.equal(
  uncertainRetryScheduled.job.nextAttemptAt,
  addMs(start, 5_000),
  "an uncertain provider call must not retry before its original lease fence expires",
);
assert.equal(
  hasInFlightPushDispatchForSubscription(uncertainRetryScheduled.db, "push-uncertain-retry", new Date(addMs(start, 200))),
  true,
  "a timed-out provider promise must keep subscription ownership fenced",
);
assert.equal(
  lease(uncertainRetryScheduled.db, "uncertain-retry", addMs(start, 1_100), "lease-uncertain-too-early").job,
  null,
  "an uncertain provider promise must not be retried at the normal backoff boundary",
);
const uncertainRetryCancelledBeforeFence = cancelPushDispatchJob(uncertainRetryScheduled.db, {
  jobId: "push-job-uncertain-retry",
  now: addMs(start, 250),
  reason: "보안 변경으로 남은 발송을 취소합니다.",
});
assert.equal(uncertainRetryCancelledBeforeFence.ok, true);
assert.equal(uncertainRetryCancelledBeforeFence.job.status, "cancelled");
assert.equal(uncertainRetryCancelledBeforeFence.job.providerOutcome, "uncertain");
assert.equal(uncertainRetryCancelledBeforeFence.job.deliveryMayHaveOccurred, true);
assert.equal(
  hasInFlightPushDispatchForSubscription(
    uncertainRetryCancelledBeforeFence.db,
    "push-uncertain-retry",
    new Date(addMs(start, 300)),
  ),
  true,
  "cancelling a timed-out call must not release its subscription ownership fence early",
);
assert.equal(
  hasInFlightPushDispatchForSubscription(
    uncertainRetryCancelledBeforeFence.db,
    "push-uncertain-retry",
    new Date(addMs(start, 5_000)),
  ),
  false,
  "the bounded provider fence may release at the original lease expiry",
);
const uncertainRetryLeasedAgain = lease(
  uncertainRetryScheduled.db,
  "uncertain-retry",
  uncertainRetryScheduled.job.nextAttemptAt,
  "lease-uncertain-retry-2",
);
assert.equal(uncertainRetryLeasedAgain.job.deliveryMayHaveOccurred, true);
assert.equal(uncertainRetryLeasedAgain.job.providerFenceExpiresAt, undefined);
const uncertainRetryCancelled = settlePushDispatchJob(uncertainRetryLeasedAgain.db, {
  jobId: "push-job-uncertain-retry",
  leaseToken: "lease-uncertain-retry-2",
  expectedRevision: uncertainRetryLeasedAgain.job.revision,
  now: addMs(uncertainRetryScheduled.job.nextAttemptAt, 10),
  result: { outcome: "cancelled", reason: "재시도 전에 공지 대상이 변경됐습니다." },
});
assert.equal(uncertainRetryCancelled.ok, true);
assert.equal(uncertainRetryCancelled.job.status, "cancelled");
assert.equal(
  uncertainRetryCancelled.job.deliveryMayHaveOccurred,
  true,
  "cancelling a later attempt must preserve uncertainty from an earlier provider call",
);

const deadQueued = enqueue(createDb("dead"), "dead", { maxAttempts: 2 });
const deadLeased1 = lease(deadQueued.db, "dead", start, "lease-dead-1");
const deadProviderStarted1 = beginPushDispatchProviderCall(deadLeased1.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-1",
  expectedRevision: deadLeased1.job.revision,
  now: addMs(start, 50),
});
assert.equal(deadProviderStarted1.ok, true);
const deadRetry = settlePushDispatchJob(deadProviderStarted1.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-1",
  expectedRevision: deadProviderStarted1.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 500 },
  retryPolicy,
});
const deadLeased2 = lease(deadRetry.db, "dead", deadRetry.job.nextAttemptAt, "lease-dead-2");
const deadProviderStarted2 = beginPushDispatchProviderCall(deadLeased2.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-2",
  expectedRevision: deadLeased2.job.revision,
  now: addMs(deadRetry.job.nextAttemptAt, 50),
});
assert.equal(deadProviderStarted2.ok, true);
const deadSettled = settlePushDispatchJob(deadProviderStarted2.db, {
  jobId: "push-job-dead",
  leaseToken: "lease-dead-2",
  expectedRevision: deadProviderStarted2.job.revision,
  now: addMs(deadRetry.job.nextAttemptAt, 100),
  result: { outcome: "failed", statusCode: 500 },
  retryPolicy,
});
assert.equal(deadSettled.ok, true);
assert.equal(deadSettled.job.status, "dead");
assert.equal(deadSettled.db.auditLogs[0].result, "failed");

const disabledQueued = enqueue(createDb("disabled"), "disabled");
const disabledLeased = lease(disabledQueued.db, "disabled", start);
const disabledProviderStarted = beginPushDispatchProviderCall(disabledLeased.db, {
  jobId: "push-job-disabled",
  leaseToken: "lease-disabled",
  expectedRevision: disabledLeased.job.revision,
  now: addMs(start, 50),
});
assert.equal(disabledProviderStarted.ok, true);
const disabledSettled = settlePushDispatchJob(disabledProviderStarted.db, {
  jobId: "push-job-disabled",
  leaseToken: "lease-disabled",
  expectedRevision: disabledProviderStarted.job.revision,
  now: addMs(start, 100),
  result: { outcome: "failed", statusCode: 410 },
  retryPolicy,
});
assert.equal(disabledSettled.ok, true);
assert.equal(disabledSettled.job.status, "disabled");
assert.equal(disabledSettled.db.pushSubscriptions[0].disabledAt, addMs(start, 100));

const expiredPrimaryQueued = enqueue(createDb("expired-primary"), "expired-primary");
const expiredPendingQueued = enqueue(createDb("expired-pending"), "expired-pending");
const expiredInFlightQueued = enqueue(createDb("expired-in-flight"), "expired-in-flight");
const expiredOtherQueued = enqueue(createDb("expired-other"), "expired-other");
const expiredDb = {
  ...expiredPrimaryQueued.db,
  pushSubscriptions: [
    ...expiredPrimaryQueued.db.pushSubscriptions,
    ...expiredPendingQueued.db.pushSubscriptions,
    ...expiredInFlightQueued.db.pushSubscriptions,
    ...expiredOtherQueued.db.pushSubscriptions,
  ],
  pushDispatchJobs: [
    ...expiredPrimaryQueued.db.pushDispatchJobs,
    ...expiredPendingQueued.db.pushDispatchJobs,
    ...expiredInFlightQueued.db.pushDispatchJobs,
    ...expiredOtherQueued.db.pushDispatchJobs,
  ].map((job) =>
    job.id === "push-job-expired-pending" || job.id === "push-job-expired-in-flight"
      ? {
          ...job,
          subscriptionId: "push-expired-primary",
          recipientUserId: "user-expired-primary",
        }
      : job,
  ),
  auditLogs: [
    ...expiredPrimaryQueued.db.auditLogs,
    ...expiredPendingQueued.db.auditLogs,
    ...expiredInFlightQueued.db.auditLogs,
    ...expiredOtherQueued.db.auditLogs,
  ],
};
const expiredInFlightLeased = lease(expiredDb, "expired-in-flight", start);
const expiredProviderStarted = beginPushDispatchProviderCall(expiredInFlightLeased.db, {
  jobId: "push-job-expired-in-flight",
  leaseToken: "lease-expired-in-flight",
  expectedRevision: expiredInFlightLeased.job.revision,
  now: addMs(start, 20),
});
assert.equal(expiredProviderStarted.ok, true);
const expiredPrimaryLeased = lease(expiredProviderStarted.db, "expired-primary", addMs(start, 25));
const expiredPrimaryProviderStarted = beginPushDispatchProviderCall(expiredPrimaryLeased.db, {
  jobId: "push-job-expired-primary",
  leaseToken: "lease-expired-primary",
  expectedRevision: expiredPrimaryLeased.job.revision,
  now: addMs(start, 30),
});
assert.equal(expiredPrimaryProviderStarted.ok, true);
const expiredPrimarySettled = settlePushDispatchJob(expiredPrimaryProviderStarted.db, {
  jobId: "push-job-expired-primary",
  leaseToken: "lease-expired-primary",
  expectedRevision: expiredPrimaryProviderStarted.job.revision,
  now: addMs(start, 40),
  result: { outcome: "failed", statusCode: 410 },
  retryPolicy,
});
assert.equal(expiredPrimarySettled.ok, true);
assert.equal(expiredPrimarySettled.job.status, "disabled");
assert.equal(
  expiredPrimarySettled.db.pushDispatchJobs.find((job) => job.id === "push-job-expired-pending")?.status,
  "cancelled",
  "a permanent subscription failure must drain queued work for the same device",
);
const expiredInFlightJob = expiredPrimarySettled.db.pushDispatchJobs.find(
  (job) => job.id === "push-job-expired-in-flight",
);
assert.equal(expiredInFlightJob?.status, "leased");
assert.equal(expiredInFlightJob?.cancellationRequestedAt, addMs(start, 40));
assert.equal(expiredInFlightJob?.deliveryMayHaveOccurred, true);
assert.equal(
  expiredPrimarySettled.db.pushDispatchJobs.find((job) => job.id === "push-job-expired-other")?.status,
  "pending",
  "a permanent failure must not mutate another device's work",
);
const expiredInFlightSettled = settlePushDispatchJob(expiredPrimarySettled.db, {
  jobId: "push-job-expired-in-flight",
  leaseToken: "lease-expired-in-flight",
  expectedRevision: expiredProviderStarted.job.revision,
  now: addMs(start, 60),
  result: { outcome: "failed", statusCode: 410 },
});
assert.equal(expiredInFlightSettled.ok, true);
assert.equal(expiredInFlightSettled.job.status, "cancelled");
assert.equal(expiredInFlightSettled.job.deliveryMayHaveOccurred, true);

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
assert.equal(beforeProviderBegin.job.providerCallCompletedAt, undefined);

const preProviderSettlementQueued = enqueue(createDb("settle-cancel-before-provider"), "settle-cancel-before-provider");
const preProviderSettlementLeased = lease(preProviderSettlementQueued.db, "settle-cancel-before-provider", start);
const preProviderSettlementCancellation = cancelPushDispatchJob(preProviderSettlementLeased.db, {
  jobId: "push-job-settle-cancel-before-provider",
  now: addMs(start, 25),
  reason: "공지 발송 대상이 변경됐습니다.",
});
const preProviderSettlement = settlePushDispatchJob(preProviderSettlementCancellation.db, {
  jobId: "push-job-settle-cancel-before-provider",
  leaseToken: "lease-settle-cancel-before-provider",
  expectedRevision: preProviderSettlementLeased.job.revision,
  now: addMs(start, 50),
  result: { outcome: "cancelled", reason: "provider 호출 전에 발송이 취소됐습니다." },
});
assert.equal(preProviderSettlement.ok, true);
assert.equal(preProviderSettlement.job.providerOutcome, "not_started");
assert.equal(preProviderSettlement.job.providerCallCompletedAt, undefined);
assert.equal(preProviderSettlement.job.deliveryMayHaveOccurred, false);

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
assert.equal(
  hasInFlightPushDispatchForSubscription(afterProviderBegin.db, "push-cancel-after-provider", new Date(addMs(start, 30))),
  true,
  "subscription ownership must not transfer while a provider call can still deliver the old user's payload",
);
assert.equal(
  hasInFlightPushDispatchForUser(afterProviderBegin.db, "user-cancel-after-provider", new Date(addMs(start, 30))),
  true,
  "authorization changes must detect provider calls through the user's subscriptions",
);
const blockedUserDeletion = preparePushDispatchJobsForUserDeletion(
  afterProviderBegin.db,
  "user-cancel-after-provider",
  { now: addMs(start, 30), reason: "사용자 계정 삭제" },
);
assert.equal(blockedUserDeletion.ok, false, "account deletion must wait while a provider call can still deliver");
assert.equal(blockedUserDeletion.reason, "push_delivery_in_flight");
assert.equal(
  hasInFlightPushDispatchForSubscription(afterProviderBegin.db, "push-cancel-after-provider", new Date(addMs(start, 5_001))),
  false,
  "an expired provider-call lease must not block subscription ownership forever",
);
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

const cancelledOutcomeQueued = enqueue(createDb("cancelled-outcome-after-provider"), "cancelled-outcome-after-provider");
const cancelledOutcomeLeased = lease(cancelledOutcomeQueued.db, "cancelled-outcome-after-provider", start);
const cancelledOutcomeBegin = beginPushDispatchProviderCall(cancelledOutcomeLeased.db, {
  jobId: "push-job-cancelled-outcome-after-provider",
  leaseToken: "lease-cancelled-outcome-after-provider",
  expectedRevision: cancelledOutcomeLeased.job.revision,
  now: addMs(start, 25),
});
assert.equal(cancelledOutcomeBegin.ok, true);
const cancelledOutcomeCancellation = cancelPushDispatchJob(cancelledOutcomeBegin.db, {
  jobId: "push-job-cancelled-outcome-after-provider",
  now: addMs(start, 40),
  reason: "공지 발송이 취소됐습니다.",
});
assert.equal(cancelledOutcomeCancellation.ok, true);
const cancelledOutcomeSettlement = settlePushDispatchJob(cancelledOutcomeCancellation.db, {
  jobId: "push-job-cancelled-outcome-after-provider",
  leaseToken: "lease-cancelled-outcome-after-provider",
  expectedRevision: cancelledOutcomeBegin.job.revision,
  now: addMs(start, 60),
  result: { outcome: "cancelled", reason: "provider 결과를 확인할 수 없습니다." },
});
assert.equal(cancelledOutcomeSettlement.ok, true);
assert.equal(cancelledOutcomeSettlement.job.providerOutcome, "uncertain");
assert.equal(cancelledOutcomeSettlement.job.deliveryMayHaveOccurred, true);
assert.equal(cancelledOutcomeSettlement.job.providerCallCompletedAt, addMs(start, 60));
assert.equal(
  cancelledOutcomeSettlement.job.providerFenceExpiresAt,
  cancelledOutcomeBegin.job.providerFenceExpiresAt,
  "a cancelled result after provider start must retain the bounded provider fence",
);
assert.equal(
  hasInFlightPushDispatchForSubscription(cancelledOutcomeSettlement.db, "push-cancelled-outcome-after-provider", new Date(addMs(start, 70))),
  true,
);

const bulkPendingQueued = enqueue(createDb("bulk-pending"), "bulk-pending");
const bulkInFlightQueued = enqueue(createDb("bulk-in-flight"), "bulk-in-flight");
const bulkOtherQueued = enqueue(createDb("bulk-other"), "bulk-other");
const bulkDb = {
  ...bulkPendingQueued.db,
  pushSubscriptions: [
    ...bulkPendingQueued.db.pushSubscriptions,
    ...bulkInFlightQueued.db.pushSubscriptions,
    ...bulkOtherQueued.db.pushSubscriptions,
  ],
  pushDispatchJobs: [
    ...bulkPendingQueued.db.pushDispatchJobs,
    ...bulkInFlightQueued.db.pushDispatchJobs,
    ...bulkOtherQueued.db.pushDispatchJobs,
  ],
  auditLogs: [
    ...bulkPendingQueued.db.auditLogs,
    ...bulkInFlightQueued.db.auditLogs,
    ...bulkOtherQueued.db.auditLogs,
  ],
};
const bulkInFlightLeased = lease(bulkDb, "bulk-in-flight", start);
const bulkProviderStarted = beginPushDispatchProviderCall(bulkInFlightLeased.db, {
  jobId: "push-job-bulk-in-flight",
  leaseToken: "lease-bulk-in-flight",
  expectedRevision: bulkInFlightLeased.job.revision,
  now: addMs(start, 25),
});
assert.equal(bulkProviderStarted.ok, true);
const bulkCancelledDb = cancelPushDispatchJobsForSubscriptions(
  bulkProviderStarted.db,
  new Set(["push-bulk-pending", "push-bulk-in-flight"]),
  {
    now: addMs(start, 40),
    reason: "푸시 알림 구독이 해지되어 대기 발송을 취소했습니다.",
  },
);
const bulkPendingJob = bulkCancelledDb.pushDispatchJobs.find((job) => job.id === "push-job-bulk-pending");
const bulkInFlightJob = bulkCancelledDb.pushDispatchJobs.find((job) => job.id === "push-job-bulk-in-flight");
const bulkOtherJob = bulkCancelledDb.pushDispatchJobs.find((job) => job.id === "push-job-bulk-other");
assert.equal(bulkPendingJob?.status, "cancelled", "unsubscribe must cancel queued work immediately");
assert.equal(bulkInFlightJob?.status, "leased", "provider-started work must retain its lease until settlement");
assert.equal(bulkInFlightJob?.cancellationRequestedAt, addMs(start, 40));
assert.equal(bulkInFlightJob?.deliveryMayHaveOccurred, true);
assert.equal(bulkOtherJob?.status, "pending", "unsubscribe must not mutate a different subscription's work");

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: [
        "job-id idempotency and immutable payload conflict",
        "notice and outbox state transitions share one lock",
        "request/completion audit linkage",
        "successful send",
        "provider outcomes require an explicit provider-start fence",
        "partial cancellation remains visible in the request audit",
        "transient failure exponential retry",
        "retry attempts reset provider fences and retain ownership protection",
        "later cancellation preserves uncertainty from an earlier delivery attempt",
        "maximum-attempt dead letter",
        "404/410 subscription disable",
        "permanent subscription failure drains same-device work and preserves in-flight uncertainty",
        "pending cancellation",
        "expired lease recovery",
        "revision fencing and stale settlement rejection",
        "leased cancellation before and after provider start preserves truthful provider state",
        "subscription-scoped cancellation preserves other subscriptions and in-flight uncertainty",
        "in-flight provider call blocks push subscription ownership transfer",
        "account deletion cancels queued pushes and waits for in-flight provider calls",
        "at-least-once retry with stable notification tag",
      ],
    },
    null,
    2,
  ),
);
