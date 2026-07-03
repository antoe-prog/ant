import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type JsonValidator<T> = (value: unknown) => T;

export type JsonStoreOptions<T> = {
  directory: string;
  fileName: string;
  createDefault: () => T;
  validate?: JsonValidator<T>;
  backupLimit?: number;
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

export function createJsonStore<T>(options: JsonStoreOptions<T>) {
  const backupLimit = Math.max(0, options.backupLimit ?? 10);
  const validate = options.validate ?? defaultValidate<T>;
  const dataFile = path.join(options.directory, options.fileName);
  const backupDirectory = path.join(options.directory, "backups");

  let cache: T | null = null;
  let writeQueue = Promise.resolve();

  async function ensureDirectories() {
    await mkdir(options.directory, { recursive: true });
    if (backupLimit > 0) {
      await mkdir(backupDirectory, { recursive: true });
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
    await pruneBackups();
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
        await enqueueWrite(recovered);
        return recovered;
      } catch {
        // Keep looking for the newest valid snapshot.
      }
    }

    return null;
  }

  async function enqueueWrite(value: T) {
    const nextWrite = writeQueue.then(
      async () => {
        await persist(value);
        return value;
      },
      async () => {
        await persist(value);
        return value;
      },
    );

    writeQueue = nextWrite.then(
      () => undefined,
      () => undefined,
    );

    return nextWrite;
  }

  async function read() {
    if (cache) {
      return cache;
    }

    try {
      cache = await readPrimary();
      return cache;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;

      if (code !== "ENOENT") {
        const recovered = await recoverFromBackup();
        if (recovered) {
          cache = recovered;
          return cache;
        }

        throw new Error(`Cannot read ${dataFile}; primary JSON is invalid and no valid backup was found.`);
      }

      cache = options.createDefault();
      await enqueueWrite(cache);
      return cache;
    }
  }

  async function write(value: T) {
    const persisted = await enqueueWrite(validate(value));
    cache = persisted;
    return persisted;
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

  return {
    paths: {
      dataFile,
      backupDirectory,
    },
    read,
    write,
    reset,
    status,
  };
}
