import { createSign } from "node:crypto";
import { connect, type ClientHttp2Stream } from "node:http2";
import type { PushDispatchPayloadSnapshot } from "@/lib/domain";
import type { PushDeliveryResult } from "@/server/push-notifications";

type FirebaseConfig = {
  clientEmail: string;
  privateKey: string;
  projectId: string;
};

type ApnsConfig = {
  environment: "production" | "sandbox";
  keyId: string;
  privateKey: string;
  teamId: string;
  topic: string;
};

type ApnsPushDependencies = {
  connectImpl?: typeof connect;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type FcmTokenCache = {
  accessToken: string;
  expiresAt: number;
  identity: string;
};

let fcmTokenCache: FcmTokenCache | null = null;

const defaultApnsTtlSeconds = 24 * 60 * 60;
const maximumApnsTtlSeconds = 30 * 24 * 60 * 60;
const minimumFcmRateLimitRetryMs = 60_000;
const minimumApnsServerRetryMs = 15 * 60_000;

const expiredApnsTokenErrorCodes = new Set([
  "APNS_BAD_DEVICE_TOKEN",
  "APNS_DEVICE_TOKEN_NOT_FOR_TOPIC",
  "APNS_EXPIRED_TOKEN",
  "APNS_UNREGISTERED",
]);
const expiredFcmTokenErrorCodes = new Set([
  "FCM_INVALID_REGISTRATION_TOKEN",
  "FCM_SENDER_ID_MISMATCH",
  "FCM_UNREGISTERED",
]);

function envValue(env: NodeJS.ProcessEnv, name: string) {
  return env[name]?.trim() || null;
}

function privateKey(value: string | null) {
  return value?.replace(/\\n/g, "\n") ?? null;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function providerErrorCode(prefix: "APNS" | "FCM", value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return normalized && normalized.length <= 80 ? `${prefix}_${normalized}` : fallback;
}

export function parseRetryAfterMs(value: string | null, now = new Date()) {
  const normalized = value?.trim();
  const nowMs = now.getTime();
  if (!normalized || !Number.isFinite(nowMs)) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    const milliseconds = Number(normalized) * 1_000;
    return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
  }

  const milliseconds = Date.parse(normalized) - nowMs;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
}

export function parseFcmPushFailure(statusCode: number, payload: unknown) {
  const error = payload && typeof payload === "object" && "error" in payload
    ? (payload as { error?: unknown }).error
    : null;
  const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const details = Array.isArray(errorRecord?.details) ? errorRecord.details : [];
  const fcmDetail = details.find((detail) =>
    detail &&
    typeof detail === "object" &&
    (detail as Record<string, unknown>)["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError"
  ) as Record<string, unknown> | undefined;
  const providerCode = providerErrorCode(
    "FCM",
    fcmDetail?.errorCode ?? errorRecord?.status,
    statusCode ? `FCM_HTTP_${statusCode}` : "FCM_DELIVERY_FAILED",
  );
  const errorCode = fcmDetail && providerCode === "FCM_INVALID_ARGUMENT"
    ? "FCM_INVALID_REGISTRATION_TOKEN"
    : providerCode;

  return {
    errorCode,
    message: expiredFcmTokenErrorCodes.has(errorCode)
      ? "Android 앱 알림 등록이 만료됐습니다."
      : "Android 앱 알림 발송 상태를 다시 확인해야 합니다.",
  };
}

export function parseApnsPushFailure(
  statusCode: number,
  responseBody: string,
  retryAfterHeader: string | null = null,
  now = new Date(),
) {
  let reason: unknown;
  try {
    const payload = JSON.parse(responseBody) as { reason?: unknown };
    reason = payload?.reason;
  } catch {
    reason = undefined;
  }

  const errorCode = providerErrorCode(
    "APNS",
    reason,
    statusCode ? `APNS_HTTP_${statusCode}` : "APNS_DELIVERY_FAILED",
  );
  const providerRetryAfterMs = parseRetryAfterMs(retryAfterHeader, now);
  const retryAfterMs = statusCode >= 500 && statusCode <= 599
    ? Math.max(providerRetryAfterMs ?? 0, minimumApnsServerRetryMs)
    : providerRetryAfterMs;

  return {
    errorCode,
    message: expiredApnsTokenErrorCodes.has(errorCode)
      ? "iPhone 앱 알림 등록이 만료됐습니다."
      : "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
    ...(retryAfterMs ? { retryAfterMs } : {}),
  };
}

function signedJwt(header: object, payload: object, key: string, algorithm: "RSA-SHA256" | "SHA256") {
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign(algorithm);
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign({ key, dsaEncoding: "ieee-p1363" }, "base64url")}`;
}

export function getFirebasePushConfig(env: NodeJS.ProcessEnv = process.env): FirebaseConfig | null {
  const clientEmail = envValue(env, "FINAL_JUDO_FIREBASE_CLIENT_EMAIL");
  const projectId = envValue(env, "FINAL_JUDO_FIREBASE_PROJECT_ID");
  const key = privateKey(envValue(env, "FINAL_JUDO_FIREBASE_PRIVATE_KEY"));

  return clientEmail && projectId && key ? { clientEmail, privateKey: key, projectId } : null;
}

export function getApnsPushConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const teamId = envValue(env, "FINAL_JUDO_APNS_TEAM_ID");
  const keyId = envValue(env, "FINAL_JUDO_APNS_KEY_ID");
  const topic = envValue(env, "FINAL_JUDO_APNS_TOPIC") ?? "kr.co.finaljudo.multigym";
  const key = privateKey(envValue(env, "FINAL_JUDO_APNS_PRIVATE_KEY"));
  const environment = envValue(env, "FINAL_JUDO_APNS_ENVIRONMENT") === "sandbox" ? "sandbox" : "production";

  return teamId && keyId && topic && key
    ? { environment, keyId, privateKey: key, teamId, topic }
    : null;
}

export function getNativePushProviderReadiness(env: NodeJS.ProcessEnv = process.env) {
  return {
    apns: Boolean(getApnsPushConfig(env)),
    fcm: Boolean(getFirebasePushConfig(env)),
  };
}

export function createApnsExpirationHeader(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(nowSeconds)) {
    throw new Error("APNs expiration requires a valid current time.");
  }

  const configured = Number(env.FINAL_JUDO_APNS_TTL_SECONDS);
  const ttlSeconds = Number.isSafeInteger(configured) && (
    configured === 0 ||
    (configured >= 60 && configured <= maximumApnsTtlSeconds)
  )
    ? configured
    : defaultApnsTtlSeconds;

  return ttlSeconds === 0 ? "0" : String(nowSeconds + ttlSeconds);
}

async function getFirebaseAccessToken(
  config: FirebaseConfig,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
) {
  const now = Math.floor(Date.now() / 1_000);
  const identity = `${config.projectId}:${config.clientEmail}`;
  if (fcmTokenCache?.identity === identity && fcmTokenCache.expiresAt > now + 60) {
    return fcmTokenCache.accessToken;
  }

  const assertion = signedJwt(
    { alg: "RS256", typ: "JWT" },
    {
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3_600,
      iat: now,
      iss: config.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    },
    config.privateKey,
    "RSA-SHA256",
  );
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      assertion,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal,
  });
  const result = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  const accessToken = typeof result?.access_token === "string" ? result.access_token : "";
  const expiresIn = Number(result?.expires_in);
  if (!response.ok || !accessToken) {
    throw new Error("FCM access token request failed.");
  }

  fcmTokenCache = {
    accessToken,
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3_600),
    identity,
  };
  return accessToken;
}

function invalidateFirebaseAccessToken(config: FirebaseConfig, rejectedAccessToken: string) {
  const identity = `${config.projectId}:${config.clientEmail}`;
  if (
    fcmTokenCache?.identity === identity &&
    fcmTokenCache.accessToken === rejectedAccessToken
  ) {
    fcmTokenCache = null;
  }
}

function sendFcmMessage(
  config: FirebaseConfig,
  accessToken: string,
  deviceToken: string,
  payload: PushDispatchPayloadSnapshot,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
) {
  return fetchImpl(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
    {
      body: JSON.stringify({
        message: {
          data: { tag: payload.tag, url: payload.url },
          notification: { body: payload.body, title: payload.title },
          token: deviceToken,
        },
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    },
  );
}

export async function sendFcmPush(
  deviceToken: string,
  payload: PushDispatchPayloadSnapshot,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PushDeliveryResult> {
  const config = getFirebasePushConfig();
  if (!config) {
    return {
      outcome: "failed",
      errorCode: "FCM_NOT_CONFIGURED",
      message: "Android 앱 알림 발송 설정을 확인해야 합니다.",
    };
  }

  const authenticationFailure = (): PushDeliveryResult => ({
    outcome: "failed",
    errorCode: "FCM_AUTHENTICATION_FAILED",
    message: "Android 앱 알림 인증 정보를 다시 확인해야 합니다.",
  });
  const uncertainDeliveryFailure = (): PushDeliveryResult => ({
    outcome: "failed",
    errorCode: "FCM_DELIVERY_FAILED",
    message: "Android 앱 알림 발송 상태를 다시 확인해야 합니다.",
    deliveryUncertain: true,
  });

  let accessToken: string;
  try {
    accessToken = await getFirebaseAccessToken(config, fetchImpl, signal);
  } catch {
    return authenticationFailure();
  }

  let response: Response;
  try {
    response = await sendFcmMessage(config, accessToken, deviceToken, payload, fetchImpl, signal);
  } catch {
    return uncertainDeliveryFailure();
  }

  if (response.status === 401) {
    invalidateFirebaseAccessToken(config, accessToken);
    try {
      accessToken = await getFirebaseAccessToken(config, fetchImpl, signal);
    } catch {
      return authenticationFailure();
    }
    try {
      response = await sendFcmMessage(config, accessToken, deviceToken, payload, fetchImpl, signal);
    } catch {
      return uncertainDeliveryFailure();
    }
  }

  if (response.ok) {
    return { outcome: "sent" };
  }
  const failure = parseFcmPushFailure(response.status, await response.json().catch(() => null));
  const providerRetryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  const retryAfterMs = response.status === 429
    ? Math.max(providerRetryAfterMs ?? 0, minimumFcmRateLimitRetryMs)
    : providerRetryAfterMs;
  return {
    outcome: "failed",
    statusCode: response.status,
    ...failure,
    ...(retryAfterMs ? { retryAfterMs } : {}),
  };
}

function createApnsProviderToken(config: ApnsConfig) {
  return signedJwt(
    { alg: "ES256", kid: config.keyId },
    { iss: config.teamId, iat: Math.floor(Date.now() / 1_000) },
    config.privateKey,
    "SHA256",
  );
}

export async function sendApnsPush(
  deviceToken: string,
  payload: PushDispatchPayloadSnapshot,
  dependencies: ApnsPushDependencies = {},
): Promise<PushDeliveryResult> {
  const config = getApnsPushConfig(dependencies.env);
  if (!config) {
    return {
      outcome: "failed",
      errorCode: "APNS_NOT_CONFIGURED",
      message: "iPhone 앱 알림 발송 설정을 확인해야 합니다.",
    };
  }

  let providerToken: string;
  try {
    providerToken = createApnsProviderToken(config);
  } catch {
    return {
      outcome: "failed",
      errorCode: "APNS_AUTHENTICATION_FAILED",
      message: "iPhone 앱 알림 인증 정보를 다시 확인해야 합니다.",
    };
  }
  if (dependencies.signal?.aborted) {
    return {
      outcome: "failed",
      errorCode: "APNS_PROVIDER_TIMEOUT",
      message: "iPhone 앱 알림 provider 응답 시간이 초과됐습니다.",
      deliveryUncertain: true,
    };
  }

  const authority = config.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const client = (() => {
    try {
      return (dependencies.connectImpl ?? connect)(authority);
    } catch {
      return null;
    }
  })();
  if (!client) {
    return {
      outcome: "failed",
      errorCode: "APNS_CONNECTION_FAILED",
      message: "iPhone 앱 알림 발송 서버에 연결하지 못했습니다.",
    };
  }

  return new Promise<PushDeliveryResult>((resolve) => {
    const requestRef: { current?: ClientHttp2Stream } = {};
    let settled = false;
    const finish = (result: PushDeliveryResult, abortConnection = false) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      dependencies.signal?.removeEventListener("abort", abortRequest);
      if (abortConnection) {
        requestRef.current?.destroy();
        client.destroy();
      } else {
        client.close();
      }
      resolve(result);
    };
    const timeoutFailure = (): PushDeliveryResult => ({
      outcome: "failed",
      errorCode: "APNS_PROVIDER_TIMEOUT",
      message: "iPhone 앱 알림 provider 응답 시간이 초과됐습니다.",
      deliveryUncertain: true,
    });
    const abortRequest = () => finish(timeoutFailure(), true);
    const timer = setTimeout(() => {
      finish(timeoutFailure(), true);
    }, dependencies.timeoutMs ?? 15_000);
    dependencies.signal?.addEventListener("abort", abortRequest, { once: true });

    client.once("error", () => {
      finish({
        outcome: "failed",
        errorCode: "APNS_DELIVERY_FAILED",
        message: "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
        deliveryUncertain: true,
      }, true);
    });
    const request = (() => {
      try {
        return client.request({
          ":method": "POST",
          ":path": `/3/device/${deviceToken}`,
          authorization: `bearer ${providerToken}`,
          "apns-expiration": createApnsExpirationHeader(),
          "apns-priority": "10",
          "apns-push-type": "alert",
          "apns-topic": config.topic,
        });
      } catch {
        return null;
      }
    })();
    if (!request) {
      finish({
        outcome: "failed",
        errorCode: "APNS_REQUEST_FAILED",
        message: "iPhone 앱 알림 요청을 시작하지 못했습니다.",
      }, true);
      return;
    }
    requestRef.current = request;
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      const statusCode = Number(headers[":status"] ?? 0);
      let responseBody = "";
      request.on("data", (chunk: string) => {
        if (responseBody.length < 4_096) {
          responseBody += chunk.slice(0, 4_096 - responseBody.length);
        }
      });
      request.once("end", () => {
        if (statusCode === 200) {
          finish({ outcome: "sent" });
          return;
        }
        const rawRetryAfter = headers["retry-after"];
        const retryAfterHeader = Array.isArray(rawRetryAfter)
          ? rawRetryAfter[0] ?? null
          : typeof rawRetryAfter === "string"
            ? rawRetryAfter
            : null;
        const failure = parseApnsPushFailure(statusCode, responseBody, retryAfterHeader);
        finish({
          outcome: "failed",
          ...(statusCode ? { statusCode } : {}),
          ...failure,
        });
      });
    });
    request.once("error", () => {
      finish({
        outcome: "failed",
        errorCode: "APNS_DELIVERY_FAILED",
        message: "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
        deliveryUncertain: true,
      }, true);
    });
    try {
      request.end(JSON.stringify({
        aps: {
          alert: { body: payload.body, title: payload.title },
          sound: "default",
        },
        tag: payload.tag,
        url: payload.url,
      }));
    } catch {
      finish({
        outcome: "failed",
        errorCode: "APNS_DELIVERY_FAILED",
        message: "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
        deliveryUncertain: true,
      }, true);
    }
  });
}
