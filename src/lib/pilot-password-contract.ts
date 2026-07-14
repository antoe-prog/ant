/**
 * Detection-only fingerprint for legacy demo accounts. New password hashes must
 * never be created from the shared demo password represented by this value.
 */
export const legacyDefaultPilotPasswordHash =
  "pbkdf2_sha256$120000$final-judo-mvp-pilot$135f6e2970d7f8641323bed2c55add3696cc473e1b9d21ab286077be22ed7cf0";

// Compatibility alias used by seed and preflight code while legacy demo data exists.
export const defaultPilotPasswordHash = legacyDefaultPilotPasswordHash;

export function isLegacyDefaultPilotPasswordHash(value: string | undefined) {
  return value === legacyDefaultPilotPasswordHash;
}
