import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

import { attachStoreVersion, getStoreVersion, type StoreVersion } from "./store-version.ts";

export type JsonValidator<T> = (value: unknown) => T;
export type JsonWriteValidator<T> = (next: T, previous: T | null) => T;

export type JsonStoreOptions<T> = {
  directory: string;
  fileName: string;
  createDefault: () => T;
  validate?: JsonValidator<T>;
  validateWrite?: JsonWriteValidator<T>;
  backupLimit?: number;
  merge?: (base: T, requested: T, latest: T) => T;
};

export type JsonStoreReadSource = "primary" | "backup" | "default";

function defaultValidate<T>(value: unknown) {
  return value as T;
}

function backupStamp() {
  const isoStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `${isoStamp}-${process.pid}-${random}`;
}

function parseJson<T>(raw: string, validate: JsonValidator<T>) {
  return validate(JSON.parse(raw));
}

function toSerializableValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function lockName(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createJsonStore<T>(options: JsonStoreOptions<T>) {
  const backupLimit = Math.max(0, options.backupLimit ?? 10);
  const validate = options.validate ?? defaultValidate<T>;
  const dataFile = path.join(options.directory, options.fileName);
  const backupDirectory = path.join(options.directory, "backups");
  const lockDirectory = path.join(options.directory, ".locks");
  const writeLock = path.join(lockDirectory, `${lockName(dataFile)}.write.lock`);

  let cache: T | null = null;
  let revision = 0;
  let writeQueue = Promise.resolve();
  const locks = new Map<string, Promise<void>>();

  async function ensureDirectories() {
    await mkdir(options.directory, { recursive: true });
    await mkdir(lockDirectory, { recursive: true });
    if (backupLimit > 0) {
      await mkdir(backupDirectory, { recursive: true });
    }
  }

  async function acquireFileLock(target: string) {
    const waitUntil = Date.now() + 15_000;

    while (true) {
      try {
        await mkdir(target);
        return async () => rm(target, { recursive: true, force: true });
      } catch (error) {
        const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;

        if (code !== "EEXIST") {
          throw error;
        }

        try {
          const lockStatus = await stat(target);
          if (Date.now() - lockStatus.mtimeMs > 120_000) {
            await rm(target, { recursive: true, force: true });
            continue;
          }
        } catch (statusError) {
          const statusCode = statusError instanceof Error && "code" in statusError
            ? (statusError as NodeJS.ErrnoException).code
            : undefined;
          if (statusCode === "ENOENT") {
            continue;
          }
          throw statusError;
        }

        if (Date.now() >= waitUntil) {
          throw new Error(`Timed out waiting for JSON runtime lock ${path.basename(target)}.`);
        }

        await delay(20 + Math.floor(Math.random() * 20));
      }
    }
  }

  async function withFileLock<Result>(target: string, operation: () => Promise<Result>) {
    await ensureDirectories();
    const release = await acquireFileLock(target);

    try {
      return await operation();
    } finally {
      await release();
    }
  }

  async function listBackupFiles() {
    if (backupLimit <= 0) {
      return [];
    }

    try {
      const files = await readdir(backupDirectory);
      return files
        .filter((file) => file.startsWith(`${options.fileName}.`) && file.endsWith(".bak"))
        .sort()
        .map((file) => path.join(backupDirectory, file));
    } catch {
      return [];
    }
  }

  async function pruneBackups() {
    const backups = await listBackupFiles();
    const stale = backups.slice(0, Math.max(0, backups.length - backupLimit));
    await Promise.all(stale.map((file) => rm(file, { force: true })));
  }

  async function persist(value: T) {
    await ensureDirectories();

    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    const temporaryFile = path.join(options.directory, `${options.fileName}.${backupStamp()}.tmp`);

    if (backupLimit > 0) {
      const backupFile = path.join(backupDirectory, `${options.fileName}.${backupStamp()}.bak`);
      await writeFile(backupFile, serialized, "utf8");
    }

    await writeFile(temporaryFile, serialized, "utf8");
    await rename(temporaryFile, dataFile);
    // The primary file is already committed; backup housekeeping must not make the write appear to fail.
    await pruneBackups().catch(() => undefined);
  }

  async function readPrimary() {
    const raw = await readFile(dataFile, "utf8");
    return parseJson(raw, validate);
  }

  async function recoverFromBackup() {
    const backups = (await listBackupFiles()).reverse();

    for (const backup of backups) {
      try {
        const raw = await readFile(backup, "utf8");
        const recovered = parseJson(raw, validate);
        return enqueueWrite(recovered, null, true);
      } catch {
        // Keep looking for the newest valid snapshot.
      }
    }

    return null;
  }

  async function enqueueWrite(
    value: T,
    version: StoreVersion<T> | null = null,
    replaceInvalidPrimary = false,
  ) {
    const nextWrite = writeQueue.then(
      () =>
        withFileLock(writeLock, async () => {
          let latest: T | null = null;

          try {
            latest = await readPrimary();
          } catch (error) {
            const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
            if (code !== "ENOENT" && !replaceInvalidPrimary) {
              throw error;
            }
          }

          const baseChangedOnDisk = Boolean(
            version && latest && !isDeepStrictEqual(toSerializableValue(version.baseValue), latest),
          );
          const stale = Boolean(version && (version.revision !== revision || baseChangedOnDisk));
          const next = stale
            ? options.merge && latest
              ? validate(options.merge(version!.baseValue, value, latest))
              : (() => {
                  throw new Error("JSON runtime state changed before this write completed.");
                })()
            : value;
          const validatedNext = options.validateWrite ? options.validateWrite(next, latest) : next;

          await persist(validatedNext);
          revision += 1;
          cache = attachStoreVersion(validatedNext, revision);
          return cache;
        }),
    );

    writeQueue = nextWrite.then(
      () => undefined,
      () => undefined,
    );

    return nextWrite;
  }

  async function read() {
    await writeQueue;

    try {
      const primary = await withFileLock(writeLock, readPrimary);

      if (!cache || !isDeepStrictEqual(toSerializableValue(cache), primary)) {
        revision += 1;
        cache = attachStoreVersion(primary, revision);
      }

      return cache;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;

      if (code !== "ENOENT") {
        const recovered = await recoverFromBackup();
        if (recovered) {
          return recovered;
        }

        throw new Error(`Cannot read ${dataFile}; primary JSON is invalid and no valid backup was found.`);
      }

      return enqueueWrite(options.createDefault());
    }
  }

  async function write(value: T) {
    const version = getStoreVersion(value);

    return enqueueWrite(validate(value), version);
  }

  async function reset() {
    return write(options.createDefault());
  }

  async function status() {
    const backups = await listBackupFiles();
    return {
      dataFile,
      backupDirectory,
      backupLimit,
      backupCount: backups.length,
      latestBackup: backups.at(-1) ?? null,
    };
  }

  async function withLock<Result>(key: string, operation: () => Promise<Result>) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => gate);

    locks.set(key, current);
    await previous;

    try {
      return await withFileLock(
        path.join(lockDirectory, `${lockName(`${dataFile}:${key}`)}.operation.lock`),
        operation,
      );
    } finally {
      release();
      if (locks.get(key) === current) {
        locks.delete(key);
      }
    }
  }

  return {
    paths: {
      dataFile,
      backupDirectory,
    },
    read,
    write,
    reset,
    status,
    withLock,
  };
}
