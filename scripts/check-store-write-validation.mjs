import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { createJsonStore } = await import("../src/server/json-store.ts");

const root = await mkdtemp(path.join(os.tmpdir(), "final-judo-store-write-validation-"));

async function verifyPostgresWriteValidation(connectionString) {
  const { createPostgresJsonStore } = await import("../src/server/postgres-store.ts");
  const stamp = `${Date.now()}-${process.pid}`;
  const key = `write-validation-${stamp}`;
  const observations = [];
  const options = {
    connectionString,
    key,
    createDefault: () => ({ left: 0, right: 0, validated: false }),
    validateWrite(next, previous) {
      observations.push({ next: structuredClone(next), previous: previous ? structuredClone(previous) : null });
      if (previous && next.left < previous.left) {
        throw new Error("left cannot decrease");
      }
      return { ...next, validated: true };
    },
    merge(base, requested, latest) {
      return {
        ...latest,
        left: requested.left === base.left ? latest.left : requested.left,
        right: requested.right === base.right ? latest.right : requested.right,
        validated: false,
      };
    },
  };
  const storeA = createPostgresJsonStore(options);
  const storeB = createPostgresJsonStore(options);

  try {
    const first = await storeA.write({ left: 1, right: 0, validated: false });
    assert.equal(first.validated, true, "PostgreSQL must persist the validateWrite return value");
    assert.deepEqual(observations[0], {
      next: { left: 1, right: 0, validated: false },
      previous: null,
    });

    await assert.rejects(
      storeB.write({ left: 0, right: 0, validated: false }),
      /left cannot decrease/,
      "a versionless PostgreSQL write must validate against the row read in its transaction",
    );
    assert.equal((await storeA.read()).left, 1, "a rejected PostgreSQL write must not change the row");

    const [baseA, baseB] = await Promise.all([storeA.read(), storeB.read()]);
    await storeA.write({ ...baseA, left: 2 });
    const merged = await storeB.write({ ...baseB, right: 1 });

    assert.deepEqual(
      { left: merged.left, right: merged.right, validated: merged.validated },
      { left: 2, right: 1, validated: true },
      "PostgreSQL must validate and persist the final stale-merge result",
    );
    assert.deepEqual(observations.at(-1), {
      next: { left: 2, right: 1, validated: false },
      previous: { left: 2, right: 0, validated: true },
    });
  } finally {
    await Promise.all([storeA.close(), storeB.close()]);
  }
}

try {
  const normalDirectory = path.join(root, "normal");
  const normalCalls = [];
  const normalStore = createJsonStore({
    directory: normalDirectory,
    fileName: "state.json",
    createDefault: () => ({ count: 0, normalized: false }),
    validateWrite(next, previous) {
      normalCalls.push({ next: structuredClone(next), previous: previous ? structuredClone(previous) : null });
      return { ...next, normalized: true };
    },
  });

  const normalized = await normalStore.write({ count: 1, normalized: false });
  assert.equal(normalized.normalized, true, "validateWrite return value must become the returned state");
  assert.deepEqual(normalCalls, [
    { next: { count: 1, normalized: false }, previous: null },
  ]);
  assert.equal(
    JSON.parse(await readFile(path.join(normalDirectory, "state.json"), "utf8")).normalized,
    true,
    "validateWrite return value must be persisted",
  );

  const rejectDirectory = path.join(root, "reject");
  const rejectStore = createJsonStore({
    directory: rejectDirectory,
    fileName: "state.json",
    createDefault: () => ({ count: 0 }),
    validateWrite(next, previous) {
      if (previous && next.count < previous.count) {
        throw new Error("count cannot decrease");
      }
      return next;
    },
  });

  await rejectStore.write({ count: 2 });
  await assert.rejects(rejectStore.write({ count: 1 }), /count cannot decrease/);
  assert.equal((await rejectStore.read()).count, 2, "a rejected write must leave persisted state unchanged");

  const mergeDirectory = path.join(root, "merge");
  const mergeObservations = [];
  const mergeOptions = {
    directory: mergeDirectory,
    fileName: "state.json",
    createDefault: () => ({ left: 0, right: 0, validated: false }),
    merge(base, requested, latest) {
      return {
        ...latest,
        left: requested.left === base.left ? latest.left : requested.left,
        right: requested.right === base.right ? latest.right : requested.right,
        validated: false,
      };
    },
    validateWrite(next, previous) {
      mergeObservations.push({ next: structuredClone(next), previous: previous ? structuredClone(previous) : null });
      if (previous && next.left < previous.left) {
        throw new Error("merged state regressed");
      }
      return { ...next, validated: true };
    },
  };
  const mergeStoreA = createJsonStore(mergeOptions);
  const mergeStoreB = createJsonStore(mergeOptions);
  const baseA = await mergeStoreA.read();
  const baseB = await mergeStoreB.read();

  await mergeStoreA.write({ ...baseA, left: 1 });
  const merged = await mergeStoreB.write({ ...baseB, right: 1 });

  assert.deepEqual(
    { left: merged.left, right: merged.right, validated: merged.validated },
    { left: 1, right: 1, validated: true },
    "validateWrite must receive and persist the final stale-merge result",
  );
  assert.deepEqual(
    mergeObservations.at(-1),
    {
      next: { left: 1, right: 1, validated: false },
      previous: { left: 1, right: 0, validated: true },
    },
    "stale merge validation must compare the final next value with the latest persisted value",
  );

  console.log("Store write validation checks passed.");

  if (process.env.STORE_WRITE_VALIDATION_POSTGRES_URL) {
    await verifyPostgresWriteValidation(process.env.STORE_WRITE_VALIDATION_POSTGRES_URL);
    console.log("PostgreSQL store write validation checks passed.");
  } else {
    console.log("PostgreSQL store write validation checks skipped: no test database URL configured.");
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
