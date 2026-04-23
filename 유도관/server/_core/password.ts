import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;
const SALT_BYTES = 16;

/**
 * 비밀번호를 salt와 함께 scrypt로 해싱한다.
 * 형식: "scrypt$<saltHex>$<hashHex>"
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("비밀번호는 8자 이상이어야 합니다.");
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * 저장된 해시와 평문 비밀번호를 상수시간 비교로 검증한다.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || typeof password !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length !== KEY_LEN) return false;
  const derived = await scrypt(password, salt, KEY_LEN);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
