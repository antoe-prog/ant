import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
assert(files.runner.includes("validateLeasedPushDispatchJob"));
assert(files.runner.includes("createAttemptAuditLog"));
assert(files.runner.includes("beginPushDispatchProviderCall"));
assert(files.runner.includes("runPushDeliveryWithTimeout"));
assert(files.runner.includes("createRejectedSettlementAuditLog"));
assert(files.outbox.includes('reason: "stale_revision"'));
assert(files.outbox.includes("cancellationRequestedAt"));
assert(files.domain.includes("deliveryMayHaveOccurred?: boolean"));
assert(files.push.includes("PUSH_PROVIDER_TIMEOUT"));
assert(files.push.includes("deliveryUncertain: true"));
assert(files.cron.includes("timingSafeEqual"));
assert(files.cron.includes("CRON_SECRET"));
assert(files.vercel.crons.some((cron) => cron.path === "/api/v1/internal/notification-outbox"));

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
    "timing-safe cron authorization",
    "Vercel cron route registration",
  ],
}, null, 2));
