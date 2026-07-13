const storeRevisionSymbol = Symbol.for("final-judo.store-revision");
const storeBaseValueSymbol = Symbol.for("final-judo.store-base-value");

type VersionedStoreValue<T> = T & {
  [storeRevisionSymbol]?: number;
  [storeBaseValueSymbol]?: T;
};

export type StoreVersion<T> = {
  baseValue: T;
  revision: number;
};

export function attachStoreVersion<T>(value: T, revision: number): T {
  if (!value || typeof value !== "object") {
    return value;
  }

  Object.defineProperties(value, {
    [storeRevisionSymbol]: {
      configurable: true,
      enumerable: true,
      value: revision,
    },
    [storeBaseValueSymbol]: {
      configurable: true,
      enumerable: true,
      value,
    },
  });

  return value;
}

export function getStoreVersion<T>(value: T): StoreVersion<T> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const versioned = value as VersionedStoreValue<T>;

  return typeof versioned[storeRevisionSymbol] === "number" && versioned[storeBaseValueSymbol]
    ? {
        baseValue: versioned[storeBaseValueSymbol],
        revision: versioned[storeRevisionSymbol],
      }
    : null;
}
