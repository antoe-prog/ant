import { promises as fs } from "fs";
import path from "path";

const STORE_PATH = path.resolve(process.cwd(), ".email-password-store.json");

type PasswordStore = Record<string, string>;

async function readStore(): Promise<PasswordStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PasswordStore;
  } catch {
    return {};
  }
}

async function writeStore(store: PasswordStore): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function getPasswordHashByEmail(email: string): Promise<string | null> {
  const store = await readStore();
  return store[email.trim().toLowerCase()] ?? null;
}

export async function setPasswordHashByEmail(email: string, passwordHash: string): Promise<void> {
  const store = await readStore();
  store[email.trim().toLowerCase()] = passwordHash;
  await writeStore(store);
}
