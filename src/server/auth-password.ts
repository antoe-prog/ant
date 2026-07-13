import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { defaultPilotPasswordHash } from "../lib/pilot-password-contract.ts";

const algorithm = "pbkdf2_sha256";
const defaultIterations = 120_000;
const keyLength = 32;
const digest = "sha256";

export const defaultPilotPassword = "FinalJudoPilot!2026";
export { defaultPilotPasswordHash };

export function createPasswordHash(password: string, salt = "final-judo-mvp-pilot") {
  const hash = pbkdf2Sync(password, salt, defaultIterations, keyLength, digest).toString("hex");

  return `${algorithm}$${defaultIterations}$${salt}$${hash}`;
}

export function createRandomPasswordHash(password: string) {
  return createPasswordHash(password, randomBytes(16).toString("hex"));
}

export function generateTemporaryPassword() {
  return `FJ-${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string | undefined) {
  if (!storedHash) {
    return false;
  }

  const [storedAlgorithm, iterationsText, salt, hash] = storedHash.split("$");
  const iterations = Number(iterationsText);

  if (storedAlgorithm !== algorithm || !Number.isInteger(iterations) || iterations <= 0 || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, digest);

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
