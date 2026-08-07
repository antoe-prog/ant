import { createSign } from "node:crypto";
import { connect } from "node:http2";
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

type FcmTokenCache = {
  accessToken: string;
  expiresAt: number;
  identity: string;
};

let fcmTokenCache: FcmTokenCache | null = null;

function envValue(env: NodeJS.ProcessEnv, name: string) {
  return env[name]?.trim() || null;
}

function privateKey(value: string | null) {
  return value?.replace(/\\n/g, "\n") ?? null;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
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

async function getFirebaseAccessToken(config: FirebaseConfig, fetchImpl: typeof fetch) {
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

export async function sendFcmPush(
  deviceToken: string,
  payload: PushDispatchPayloadSnapshot,
  fetchImpl: typeof fetch = fetch,
): Promise<PushDeliveryResult> {
  const config = getFirebasePushConfig();
  if (!config) {
    return {
      outcome: "failed",
      errorCode: "FCM_NOT_CONFIGURED",
      message: "Android 앱 알림 발송 설정을 확인해야 합니다.",
    };
  }

  try {
    const accessToken = await getFirebaseAccessToken(config, fetchImpl);
    const response = await fetchImpl(
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
      },
    );
    if (response.ok) {
      return { outcome: "sent" };
    }
    return {
      outcome: "failed",
      statusCode: response.status,
      errorCode: `FCM_HTTP_${response.status}`,
      message: response.status === 404
        ? "Android 앱 알림 등록이 만료됐습니다."
        : "Android 앱 알림 발송 상태를 다시 확인해야 합니다.",
    };
  } catch {
    return {
      outcome: "failed",
      errorCode: "FCM_DELIVERY_FAILED",
      message: "Android 앱 알림 발송 상태를 다시 확인해야 합니다.",
      deliveryUncertain: true,
    };
  }
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
): Promise<PushDeliveryResult> {
  const config = getApnsPushConfig();
  if (!config) {
    return {
      outcome: "failed",
      errorCode: "APNS_NOT_CONFIGURED",
      message: "iPhone 앱 알림 발송 설정을 확인해야 합니다.",
    };
  }

  const authority = config.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  return new Promise<PushDeliveryResult>((resolve) => {
    const client = connect(authority);
    let settled = false;
    const finish = (result: PushDeliveryResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      client.close();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        outcome: "failed",
        errorCode: "APNS_PROVIDER_TIMEOUT",
        message: "iPhone 앱 알림 provider 응답 시간이 초과됐습니다.",
        deliveryUncertain: true,
      });
    }, 15_000);

    client.once("error", () => {
      finish({
        outcome: "failed",
        errorCode: "APNS_DELIVERY_FAILED",
        message: "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
        deliveryUncertain: true,
      });
    });
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${createApnsProviderToken(config)}`,
      "apns-expiration": "0",
      "apns-priority": "10",
      "apns-push-type": "alert",
      "apns-topic": config.topic,
    });
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      const statusCode = Number(headers[":status"] ?? 0);
      request.resume();
      request.once("end", () => {
        if (statusCode === 200) {
          finish({ outcome: "sent" });
          return;
        }
        finish({
          outcome: "failed",
          ...(statusCode ? { statusCode } : {}),
          errorCode: statusCode ? `APNS_HTTP_${statusCode}` : "APNS_DELIVERY_FAILED",
          message: statusCode === 410
            ? "iPhone 앱 알림 등록이 만료됐습니다."
            : "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
        });
      });
    });
    request.once("error", () => {
      finish({
        outcome: "failed",
        errorCode: "APNS_DELIVERY_FAILED",
        message: "iPhone 앱 알림 발송 상태를 다시 확인해야 합니다.",
        deliveryUncertain: true,
      });
    });
    request.end(JSON.stringify({
      aps: {
        alert: { body: payload.body, title: payload.title },
        sound: "default",
      },
      tag: payload.tag,
      url: payload.url,
    }));
  });
}
