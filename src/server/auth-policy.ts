type AuthEnv = {
  ENABLE_DEMO_LOGIN?: string;
  FINAL_JUDO_ENABLE_DEMO_LOGIN?: string;
  NODE_ENV?: string;
};

export const standardSessionMaxAgeSeconds = 60 * 60 * 8;
export const rememberedSessionMaxAgeSeconds = 60 * 60 * 24 * 30;

function isTruthyFlag(value: string | undefined) {
  return value === "1" || value === "true" || value === "TRUE";
}

export function canUseDemoRoleLogin(env: AuthEnv = process.env) {
  if (env.NODE_ENV !== "production") {
    return true;
  }

  return isTruthyFlag(env.FINAL_JUDO_ENABLE_DEMO_LOGIN) || isTruthyFlag(env.ENABLE_DEMO_LOGIN);
}

export function createSessionCookieOptions(
  env: AuthEnv = process.env,
  options: { keepSignedIn?: boolean } = {},
) {
  return {
    httpOnly: true,
    maxAge: options.keepSignedIn ? rememberedSessionMaxAgeSeconds : standardSessionMaxAgeSeconds,
    path: "/",
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
  };
}

export function createExpiredSessionCookieOptions(env: AuthEnv = process.env) {
  return {
    ...createSessionCookieOptions(env),
    maxAge: 0,
  };
}
