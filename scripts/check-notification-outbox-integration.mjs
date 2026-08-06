import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  notificationOutboxWorkerLimits,
  runNotificationOutboxWorkerPool,
} from "../src/server/notification-outbox-workers.ts";

const files = {
  create: await readFile("src/app/api/v1/branches/[branchId]/notices/route.ts", "utf8"),
  dispatch: await readFile("src/app/api/v1/branches/[branchId]/notices/[noticeId]/push/route.ts", "utf8"),
  edit: await readFile("src/app/api/v1/branches/[branchId]/notices/[noticeId]/route.ts", "utf8"),
  cron: await readFile("src/app/api/v1/internal/notification-outbox/route.ts", "utf8"),
  domain: await readFile("src/lib/domain.ts", "utf8"),
  outbox: await readFile("src/server/notification-outbox.ts", "utf8"),
  push: await readFile("src/server/push-notifications.ts", "utf8"),
  runner: await readFile("src/server/notification-outbox-runner.ts", "utf8"),
  tournamentRegistrations: await readFile("src/app/api/v1/tournaments/[tournamentId]/registrations/route.ts", "utf8"),
  tournaments: await readFile("src/server/tournaments.ts", "utf8"),
  vercel: JSON.parse(await readFile("vercel.json", "utf8")),
};

assert(files.create.includes("prepareNoticePushDispatchJobs"));
assert(files.create.includes("processNotificationOutbox"));
assert(!files.create.includes("dispatchNoticePushNotifications"));
assert(files.dispatch.includes("prepareNoticePushDispatchJobs"));
assert(!files.dispatch.includes("dispatchNoticePushNotifications"));
assert(files.dispatch.includes('request.headers.get("idempotency-key")'));
assert(files.dispatch.includes("resolveManualPushIdempotency"));
assert(files.dispatch.includes("findManualPushDispatchAudit"));
assert(files.runner.includes("idempotencyDigest"));
assert(!files.runner.includes("idempotencyKey:"), "raw manual push idempotency keys must not be persisted");
assert(files.runner.includes("rawKey.length > 128"), "manual push idempotency keys must follow the documented 128-character maximum");
assert(files.runner.includes("ASCII 16~128자"));
assert(files.outbox.includes("notificationOutboxLockKey = noticeStateLockKey"));
assert(files.tournaments.includes("tournamentStateLockKey = noticeStateLockKey"));
assert(files.tournamentRegistrations.includes("prepareRegistrationStatusNoticePush"));
assert(files.tournamentRegistrations.includes("prepareNoticePushDispatchJobs"));
assert(files.tournamentRegistrations.includes("processNotificationOutbox"));
assert(files.edit.includes("cancelPendingNoticePushJobs"));
const noticeDeleteRoute = files.edit.slice(files.edit.indexOf("export async function DELETE"));
assert(
  noticeDeleteRoute.includes("return withServerDbLock(noticeStateLockKey"),
  "notice deletion and outbox cancellation must run under the shared notice lock",
);
assert(files.runner.includes("validateLeasedPushDispatchJob"));
assert(files.runner.includes("createAttemptAuditLog"));
assert(files.runner.includes("beginPushDispatchProviderCall"));
assert(files.runner.includes("runPushDeliveryWithTimeout"));
assert(files.runner.includes("createRejectedSettlementAuditLog"));
assert(files.runner.includes("claimedJob.deliveryMayHaveOccurred"));
assert(files.runner.includes("currentJob?.deliveryMayHaveOccurred"));
assert(files.outbox.includes('reason: "stale_revision"'));
assert(files.outbox.includes("cancellationRequestedAt"));
assert(files.domain.includes("deliveryMayHaveOccurred?: boolean"));
assert(files.domain.includes("providerFenceExpiresAt?: string"));
assert(files.outbox.includes("hasActivePushProviderFence"));
assert(files.outbox.includes('reason: "provider_call_not_started"'));
assert(files.outbox.includes('input.result.outcome !== "cancelled" && !job.providerCallStartedAt'));
assert(files.outbox.includes('...(job.providerCallStartedAt ? { providerCallCompletedAt: input.now } : {})'));
assert(files.outbox.includes(': job.providerCallStartedAt\n              ? ("uncertain" as const)'));
assert(files.push.includes("PUSH_PROVIDER_TIMEOUT"));
assert(files.push.includes("deliveryUncertain: true"));
assert(files.cron.includes("timingSafeEqual"));
assert(files.cron.includes("CRON_SECRET"));
assert(files.vercel.crons.some((cron) => cron.path === "/api/v1/internal/notification-outbox"));
assert(files.create.includes('import { after, NextRequest } from "next/server"'));
assert(files.create.includes("notificationOutboxExecutionPolicy.interactive"));
assert(files.create.includes("after(async () =>"));
assert(files.dispatch.includes('import { after, NextRequest } from "next/server"'));
assert(files.dispatch.includes("notificationOutboxExecutionPolicy.interactive"));
assert(files.dispatch.includes("after(async () =>"));
assert(files.tournamentRegistrations.includes('import { after, NextRequest } from "next/server"'));
assert(files.tournamentRegistrations.includes("notificationOutboxExecutionPolicy.interactive"));
assert(files.tournamentRegistrations.includes("after(async () =>"));
assert(files.cron.includes("notificationOutboxExecutionPolicy.scheduled"));
assert(files.cron.includes("pruneExpiredRuntimeRetentionRecords"));
assert(files.cron.includes("prunedPaymentTransactionCount"));
assert(files.runner.includes("runNotificationOutboxWorkerPool"));

let activeWorkers = 0;
let maximumActiveWorkers = 0;
let processedCalls = 0;
const processed = await runNotificationOutboxWorkerPool({
  concurrency: 3,
  limit: 7,
  processNext: async () => {
    processedCalls += 1;
    activeWorkers += 1;
    maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers);
    await delay(10);
    activeWorkers -= 1;
    return true;
  },
});

assert.equal(processed, 7);
assert.equal(processedCalls, 7);
assert.equal(maximumActiveWorkers, 3);

let cappedCalls = 0;
let cappedActiveWorkers = 0;
let cappedMaximumActiveWorkers = 0;
const cappedProcessed = await runNotificationOutboxWorkerPool({
  concurrency: 50,
  limit: 150,
  processNext: async () => {
    cappedCalls += 1;
    cappedActiveWorkers += 1;
    cappedMaximumActiveWorkers = Math.max(cappedMaximumActiveWorkers, cappedActiveWorkers);
    await delay(1);
    cappedActiveWorkers -= 1;
    return true;
  },
});

assert.equal(cappedProcessed, notificationOutboxWorkerLimits.maximumBatchSize);
assert.equal(cappedCalls, notificationOutboxWorkerLimits.maximumBatchSize);
assert.equal(cappedMaximumActiveWorkers, notificationOutboxWorkerLimits.maximumConcurrency);

let availableJobs = 2;
const exhaustedProcessed = await runNotificationOutboxWorkerPool({
  concurrency: 4,
  limit: 20,
  processNext: async () => {
    if (availableJobs <= 0) {
      return false;
    }
    availableJobs -= 1;
    await delay(1);
    return true;
  },
});

assert.equal(exhaustedProcessed, 2);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "notice create and manual resend enqueue before delivery",
    "notice edits and deletion cancel pending jobs",
    "send-time recipient and subscription validation",
    "immutable per-attempt audit creation",
    "manual resend idempotency digest and replay path without raw key persistence",
    "notice mutations and outbox transitions share one lock domain",
    "tournament registration status notices share the durable notice/outbox lock domain",
    "revision fencing and leased cancellation boundary",
    "provider timeout and rejected stale-settlement audit",
    "provider timeout retains a bounded ownership fence before retry",
    "provider outcomes cannot settle before the provider-start fence",
    "cancelled settlement preserves truthful pre-provider and in-flight provider state",
    "timing-safe cron authorization",
    "Vercel cron route registration",
    "daily persisted payment retention cleanup",
    "bounded concurrent delivery with batch and worker caps",
    "request-triggered delivery deferred until after the response",
    "scheduled delivery uses the larger worker policy",
  ],
}, null, 2));
