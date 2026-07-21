import { isDeepStrictEqual } from "node:util";
import type { MockDatabase } from "@/lib/domain";

const runtimeCollectionKeys = [
  "branches",
  "users",
  "members",
  "classes",
  "attendance",
  "counselingNotes",
  "promotions",
  "tournaments",
  "payments",
  "notices",
  "authSessions",
  "attendanceQrChallenges",
  "pushSubscriptions",
  "pushDispatchJobs",
  "pilotReadinessChecks",
  "pilotIncidents",
  "pilotOperationLogs",
  "auditLogs",
] as const satisfies readonly (keyof MockDatabase)[];

type RuntimeCollectionKey = (typeof runtimeCollectionKeys)[number];
type RuntimeItem = { id: string } & Record<string, unknown>;

export class RuntimeStateMergeConflictError extends Error {
  collection: RuntimeCollectionKey;
  targetId: string;

  constructor(collection: RuntimeCollectionKey, targetId: string) {
    super(`Concurrent runtime state conflict in ${collection}:${targetId}`);
    this.name = "RuntimeStateMergeConflictError";
    this.collection = collection;
    this.targetId = targetId;
  }
}

function indexItems(items: RuntimeItem[], collection: RuntimeCollectionKey) {
  const indexed = new Map<string, RuntimeItem>();

  for (const item of items) {
    if (indexed.has(item.id)) {
      throw new RuntimeStateMergeConflictError(collection, item.id);
    }
    indexed.set(item.id, item);
  }

  return indexed;
}

function mergeChangedItem(
  baseItem: RuntimeItem,
  requestedItem: RuntimeItem,
  latestItem: RuntimeItem,
  collection: RuntimeCollectionKey,
) {
  const merged: RuntimeItem = { ...latestItem };
  const keys = new Set([...Object.keys(baseItem), ...Object.keys(requestedItem), ...Object.keys(latestItem)]);

  for (const key of keys) {
    const baseValue = baseItem[key];
    const requestedValue = requestedItem[key];
    const latestValue = latestItem[key];

    if (isDeepStrictEqual(requestedValue, baseValue)) {
      continue;
    }
    if (isDeepStrictEqual(latestValue, baseValue) || isDeepStrictEqual(latestValue, requestedValue)) {
      if (requestedValue === undefined) {
        delete merged[key];
      } else {
        merged[key] = requestedValue;
      }
      continue;
    }

    throw new RuntimeStateMergeConflictError(collection, baseItem.id);
  }

  return merged;
}

function mergeCollection(
  baseItems: RuntimeItem[],
  requestedItems: RuntimeItem[],
  latestItems: RuntimeItem[],
  collection: RuntimeCollectionKey,
) {
  const baseById = indexItems(baseItems, collection);
  const requestedById = indexItems(requestedItems, collection);
  const latestById = indexItems(latestItems, collection);
  const changedIds = new Set<string>();

  for (const id of new Set([...baseById.keys(), ...requestedById.keys()])) {
    if (!isDeepStrictEqual(baseById.get(id), requestedById.get(id))) {
      changedIds.add(id);
    }
  }

  const mergedById = new Map(latestById);

  for (const id of changedIds) {
    const baseItem = baseById.get(id);
    const requestedItem = requestedById.get(id);
    const latestItem = latestById.get(id);

    if (isDeepStrictEqual(latestItem, requestedItem)) {
      continue;
    }

    if (isDeepStrictEqual(latestItem, baseItem)) {
      if (requestedItem) {
        mergedById.set(id, requestedItem);
      } else {
        mergedById.delete(id);
      }
      continue;
    }

    if (collection === "payments" && baseItem && requestedItem && latestItem) {
      throw new RuntimeStateMergeConflictError(collection, id);
    }

    if (baseItem && requestedItem && latestItem) {
      mergedById.set(id, mergeChangedItem(baseItem, requestedItem, latestItem, collection));
      continue;
    }

    throw new RuntimeStateMergeConflictError(collection, id);
  }

  const requestedAdditions = requestedItems.filter((item) => !baseById.has(item.id));
  const additionIds = new Set(requestedAdditions.map((item) => item.id));
  const latestOrder = latestItems.filter((item) => !additionIds.has(item.id) && mergedById.has(item.id));

  return [
    ...requestedAdditions.map((item) => mergedById.get(item.id) ?? item),
    ...latestOrder.map((item) => mergedById.get(item.id) ?? item),
  ];
}

export function mergeRuntimeState(base: MockDatabase, requested: MockDatabase, latest: MockDatabase): MockDatabase {
  return Object.fromEntries(
    runtimeCollectionKeys.map((collection) => [
      collection,
      mergeCollection(
        (base[collection] ?? []) as RuntimeItem[],
        (requested[collection] ?? []) as RuntimeItem[],
        (latest[collection] ?? []) as RuntimeItem[],
        collection,
      ),
    ]),
  ) as MockDatabase;
}
