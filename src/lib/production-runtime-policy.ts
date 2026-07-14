export type RuntimeEnvironment = Record<string, string | undefined>;

export type ProductionRuntimeAssessment = {
  enforced: boolean;
  blockerCodes: string[];
  expectedInstallationId: string | null;
  stateKey: string;
  tableName: string;
};

const postgresSchemes = new Set(["postgres:", "postgresql:"]);
const placeholderPattern = /(?:\buser\b|\bpassword\b|\bhost\b|example|replace|todo|tbd|[<>])/i;
const installationIdPattern = /^[a-z0-9][a-z0-9._-]{7,127}$/i;
const safeTablePattern = /^[a-z_][a-z0-9_]*$/;
const productionStateKey = "mvp";
const productionTableName = "app_runtime_state";

function isProductionTarget(env: RuntimeEnvironment) {
  return env.VERCEL_ENV === "production" ||
    env.VERCEL_TARGET_ENV === "production" ||
    env.FINAL_JUDO_REQUIRE_PERSISTENT_RUNTIME === "1";
}

function hasUsablePostgresUrl(rawValue: string | undefined) {
  const value = rawValue?.trim() ?? "";

  if (!value || placeholderPattern.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);

    return postgresSchemes.has(url.protocol) &&
      Boolean(url.hostname) &&
      Boolean(url.username) &&
      Boolean(url.password) &&
      url.pathname.length > 1;
  } catch {
    return false;
  }
}

export function assessProductionRuntimeEnvironment(env: RuntimeEnvironment): ProductionRuntimeAssessment {
  const enforced = isProductionTarget(env);
  const blockerCodes: string[] = [];
  const expectedInstallationId = env.FINAL_JUDO_INSTALLATION_ID?.trim() || null;
  const stateKey = env.FINAL_JUDO_POSTGRES_STATE_KEY?.trim() || productionStateKey;
  const tableName = env.FINAL_JUDO_POSTGRES_TABLE?.trim() || productionTableName;

  if (!enforced) {
    return { enforced, blockerCodes, expectedInstallationId, stateKey, tableName };
  }

  if (env.FINAL_JUDO_DB_DRIVER !== "postgres") {
    blockerCodes.push("PRODUCTION_RUNTIME_DRIVER_NOT_POSTGRES");
  }

  if (!hasUsablePostgresUrl(env.FINAL_JUDO_POSTGRES_URL ?? env.DATABASE_URL)) {
    blockerCodes.push("PRODUCTION_RUNTIME_POSTGRES_URL_INVALID");
  }

  if (!expectedInstallationId) {
    blockerCodes.push("PRODUCTION_RUNTIME_INSTALLATION_ID_MISSING");
  } else if (!installationIdPattern.test(expectedInstallationId) || placeholderPattern.test(expectedInstallationId)) {
    blockerCodes.push("PRODUCTION_RUNTIME_INSTALLATION_ID_INVALID");
  }

  if (!stateKey || stateKey.length > 128) {
    blockerCodes.push("PRODUCTION_RUNTIME_STATE_KEY_INVALID");
  } else if (stateKey !== productionStateKey) {
    blockerCodes.push("PRODUCTION_RUNTIME_STATE_KEY_MISMATCH");
  }

  if (!safeTablePattern.test(tableName)) {
    blockerCodes.push("PRODUCTION_RUNTIME_TABLE_INVALID");
  } else if (tableName !== productionTableName) {
    blockerCodes.push("PRODUCTION_RUNTIME_TABLE_MISMATCH");
  }

  return { enforced, blockerCodes, expectedInstallationId, stateKey, tableName };
}

export function assertProductionRuntimeEnvironment(env: RuntimeEnvironment) {
  const assessment = assessProductionRuntimeEnvironment(env);

  if (assessment.blockerCodes.length > 0) {
    throw new Error(`Unsafe production runtime configuration: ${assessment.blockerCodes.join(", ")}`);
  }

  return assessment;
}
