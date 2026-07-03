type DevResetEnv = {
  ENABLE_DEV_RESET?: string;
  FINAL_JUDO_ENABLE_DEV_RESET?: string;
  NODE_ENV?: string;
};

function isTruthyFlag(value: string | undefined) {
  return value === "1" || value === "true" || value === "TRUE";
}

export function canResetDevData(env: DevResetEnv = process.env) {
  if (env.NODE_ENV !== "production") {
    return true;
  }

  return isTruthyFlag(env.FINAL_JUDO_ENABLE_DEV_RESET) || isTruthyFlag(env.ENABLE_DEV_RESET);
}
