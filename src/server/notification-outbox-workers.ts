export const notificationOutboxWorkerLimits = {
  maximumBatchSize: 100,
  maximumConcurrency: 10,
} as const;

function normalizePositiveInteger(value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    return 1;
  }

  return Math.min(value, maximum);
}

export async function runNotificationOutboxWorkerPool({
  concurrency,
  limit,
  processNext,
}: {
  concurrency: number;
  limit: number;
  processNext: () => Promise<boolean>;
}) {
  const batchSize = normalizePositiveInteger(limit, notificationOutboxWorkerLimits.maximumBatchSize);
  const workerCount = Math.min(
    batchSize,
    normalizePositiveInteger(concurrency, notificationOutboxWorkerLimits.maximumConcurrency),
  );
  let exhausted = false;
  let nextSlot = 0;
  let processed = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (!exhausted) {
      if (nextSlot >= batchSize) {
        return;
      }
      nextSlot += 1;

      const didProcess = await processNext();

      if (!didProcess) {
        exhausted = true;
        return;
      }
      processed += 1;
    }
  });
  const results = await Promise.allSettled(workers);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");

  if (failure) {
    throw failure.reason;
  }

  return processed;
}
