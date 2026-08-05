import { hasValidSmokeDataOwnership } from "./smoke-server-attestation.ts";

type PasswordResetSmsReadiness =
  | { ready: true; mode: "development" | "webhook"; webhookUrl?: string; webhookToken?: string }
  | { ready: false };

export type PasswordResetSmsResult =
  | { ok: true; developmentCode?: string }
  | { ok: false };

export async function getPasswordResetSmsReadiness(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PasswordResetSmsReadiness> {
  const developmentCodeEnabled = env.FINAL_JUDO_ENABLE_DEV_SMS_CODE === "1";
  const isolatedSmokeCodeEnabled =
    env.NODE_ENV === "production" && developmentCodeEnabled && (await hasValidSmokeDataOwnership(env));

  if ((env.NODE_ENV !== "production" && developmentCodeEnabled) || isolatedSmokeCodeEnabled) {
    return { ready: true, mode: "development" };
  }

  const webhookUrl = env.FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_URL?.trim();
  const webhookToken = env.FINAL_JUDO_PASSWORD_RESET_SMS_WEBHOOK_TOKEN?.trim();

  if (!webhookUrl || !webhookToken) {
    return { ready: false };
  }

  try {
    const parsed = new URL(webhookUrl);

    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
      return { ready: false };
    }
  } catch {
    return { ready: false };
  }

  return { ready: true, mode: "webhook", webhookUrl, webhookToken };
}

export async function sendPasswordResetSms(
  readiness: Extract<PasswordResetSmsReadiness, { ready: true }>,
  input: { phone: string; code: string; purpose?: "password_reset" | "signup" },
): Promise<PasswordResetSmsResult> {
  if (readiness.mode === "development") {
    return { ok: true, developmentCode: input.code };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const purpose = input.purpose ?? "password_reset";
    const message = purpose === "signup"
      ? `[파이널유도멀티짐] 회원가입 인증번호는 ${input.code}입니다. 10분 안에 입력해 주세요.`
      : `[파이널유도멀티짐] 비밀번호 변경 인증번호는 ${input.code}입니다. 10분 안에 입력해 주세요.`;
    const response = await fetch(readiness.webhookUrl!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${readiness.webhookToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        purpose,
        to: input.phone,
      }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });

    return response.ok ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeoutId);
  }
}
