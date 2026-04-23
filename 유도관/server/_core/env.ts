export const ENV = {
  appId: process.env.VITE_APP_ID ?? "yudogwan-dojo",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

const REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "EXPO_PUBLIC_API_BASE_URL",
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

function isMissingValue(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === "changeme" || normalized === "your_value_here";
}

export function getMissingRequiredEnvKeys(): RequiredEnvKey[] {
  return REQUIRED_ENV_KEYS.filter((key) => isMissingValue(process.env[key]));
}

export function logRequiredEnvDiagnostics(): void {
  const diagnostics = getEnvDiagnostics();
  if (diagnostics.ok) {
    console.log(`[env] required env vars loaded (${diagnostics.requiredTotal}/${diagnostics.requiredTotal})`);
    return;
  }

  if (diagnostics.missing.length > 0) {
    console.warn(`[env] missing required env vars (${diagnostics.missing.length}): ${diagnostics.missing.join(", ")}`);
  }
  if (diagnostics.invalid.length > 0) {
    for (const issue of diagnostics.invalid) {
      console.warn(`[env] invalid value for ${issue.key}: ${issue.reason}`);
    }
  }
  console.warn("[env] copy .env.example to .env and fill values before testing signup/login.");
}

type EnvValidationIssue = {
  key: RequiredEnvKey;
  reason: string;
};

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateRequiredEnvValues(): EnvValidationIssue[] {
  const issues: EnvValidationIssue[] = [];
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  const jwtSecret = process.env.JWT_SECRET;

  if (apiBase && !isMissingValue(apiBase) && !isValidHttpUrl(apiBase)) {
    issues.push({ key: "EXPO_PUBLIC_API_BASE_URL", reason: "must be a valid http(s) URL" });
  }
  if (jwtSecret && !isMissingValue(jwtSecret) && jwtSecret.trim().length < 16) {
    issues.push({ key: "JWT_SECRET", reason: "must be at least 16 characters" });
  }

  return issues;
}

export function getEnvDiagnostics() {
  const missing = getMissingRequiredEnvKeys();
  const issues = validateRequiredEnvValues();
  return {
    requiredTotal: REQUIRED_ENV_KEYS.length,
    missing,
    invalid: issues,
    ok: missing.length === 0 && issues.length === 0,
  };
}
