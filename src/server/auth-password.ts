import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import {
  defaultPilotPasswordHash,
  isLegacyDefaultPilotPasswordHash,
} from "../lib/pilot-password-contract.ts";

const algorithm = "pbkdf2_sha256";
const defaultIterations = 120_000;
const maximumSupportedIterations = 1_000_000;
const keyLength = 32;
const digest = "sha256";
const encodedHashPattern = new RegExp(`^[a-f0-9]{${keyLength * 2}}$`, "i");
const authenticationDummyPasswordHash =
  "pbkdf2_sha256$120000$final-judo-login-timing-equalizer$9f8f2e0c8ea647717083c46801acd44cf09ba14bb12a9c2a071dfd4bef8a0a31";

export const defaultPilotPassword = "FinalJudoPilot!2026";
export { defaultPilotPasswordHash, isLegacyDefaultPilotPasswordHash };

export class SharedDemoPasswordError extends Error {
  constructor() {
    super("The retired shared demo password cannot be stored for a user account.");
    this.name = "SharedDemoPasswordError";
  }
}

export function assertPasswordIsNotSharedDemoPassword(password: string) {
  if (password === defaultPilotPassword) {
    throw new SharedDemoPasswordError();
  }
}

export function createPasswordHash(password: string, salt = "final-judo-mvp-pilot") {
  const hash = pbkdf2Sync(password, salt, defaultIterations, keyLength, digest).toString("hex");

  return `${algorithm}$${defaultIterations}$${salt}$${hash}`;
}

export function createRandomPasswordHash(password: string) {
  assertPasswordIsNotSharedDemoPassword(password);
  return createPasswordHash(password, randomBytes(16).toString("hex"));
}

export function generateTemporaryPassword() {
  return `FJ-${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}-${randomBytes(8).toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string | undefined) {
  if (!storedHash) {
    return false;
  }

  const [storedAlgorithm, iterationsText, salt, hash] = storedHash.split("$");
  const iterations = Number(iterationsText);

  if (
    storedAlgorithm !== algorithm ||
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    iterations > maximumSupportedIterations ||
    !salt ||
    !encodedHashPattern.test(hash)
  ) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = pbkdf2Sync(password, salt, iterations, keyLength, digest);

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function verifyAuthenticationPassword(password: string, storedHash: string | undefined) {
  const usesStoredHash = isSupportedPasswordHash(storedHash);
  const matches = verifyPassword(password, usesStoredHash ? storedHash : authenticationDummyPasswordHash);

  return usesStoredHash && matches;
}

export function runPasswordHashTimingEqualizer(value: string) {
  verifyPassword(value, authenticationDummyPasswordHash);
}

function isSupportedPasswordHash(storedHash: string | undefined): storedHash is string {
  if (!storedHash) {
    return false;
  }

  const [storedAlgorithm, iterationsText, salt, hash] = storedHash.split("$");
  const iterations = Number(iterationsText);

  return (
    storedAlgorithm === algorithm &&
    Number.isInteger(iterations) &&
    iterations > 0 &&
    iterations <= maximumSupportedIterations &&
    Boolean(salt) &&
    encodedHashPattern.test(hash)
  );
}
