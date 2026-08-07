import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications, type ActionPerformed, type PermissionStatus, type Token } from "@capacitor/push-notifications";
import { apiClient } from "@/lib/api-client";
import type { BrowserPushConnectionStatus } from "@/lib/browser-push-subscription";

export type NativePushConnectionStatus = BrowserPushConnectionStatus | "unavailable";

const registrationTimeoutMs = 15_000;
let actionListenerStarted = false;

export function isNativeMobileApp() {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (platform === "android" || platform === "ios");
}

function nativePlatform() {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios" ? platform : null;
}

function permissionState(status: PermissionStatus) {
  if (status.receive === "denied") {
    return "blocked" as const;
  }
  if (status.receive !== "granted") {
    return "prompt" as const;
  }
  return "ready" as const;
}

async function waitForNativePushToken() {
  let resolveToken!: (token: string) => void;
  let rejectToken!: (error: Error) => void;
  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let registrationListener: PluginListenerHandle | null = null;
  let errorListener: PluginListenerHandle | null = null;
  const finish = async (result: { token?: string; error?: Error }) => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
    }
    await Promise.allSettled([
      registrationListener?.remove(),
      errorListener?.remove(),
    ]);
    if (result.token) {
      resolveToken(result.token);
    } else {
      rejectToken(result.error ?? new Error("기기 알림 토큰을 등록하지 못했습니다."));
    }
  };

  try {
    registrationListener = await PushNotifications.addListener("registration", (token: Token) => {
      const value = token.value.trim();
      void finish(value ? { token: value } : { error: new Error("기기 알림 토큰이 비어 있습니다.") });
    });
    errorListener = await PushNotifications.addListener("registrationError", (error) => {
      void finish({ error: new Error(error.error || "기기 알림 서비스 등록에 실패했습니다.") });
    });
    timer = setTimeout(() => {
      void finish({ error: new Error("기기 알림 서비스 응답 시간이 초과됐습니다.") });
    }, registrationTimeoutMs);
    await PushNotifications.register();
  } catch (error) {
    await finish({ error: error instanceof Error ? error : new Error("기기 알림 서비스 등록에 실패했습니다.") });
  }

  return tokenPromise;
}

export async function connectCurrentNativePushRegistration({
  requestPermission,
}: {
  requestPermission: boolean;
}): Promise<NativePushConnectionStatus> {
  const platform = nativePlatform();
  if (!platform) {
    return "hidden";
  }

  let permission = await PushNotifications.checkPermissions();
  if (
    (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") &&
    requestPermission
  ) {
    permission = await PushNotifications.requestPermissions();
  }

  const currentState = permissionState(permission);
  if (currentState !== "ready") {
    return currentState;
  }

  const token = await waitForNativePushToken();
  const result = await apiClient.subscribeToNativePush(
    token,
    platform,
    typeof navigator === "undefined" ? `Capacitor/${platform}` : `Capacitor/${platform} ${navigator.userAgent}`,
    requestPermission,
  );

  if (result.reactivationRequired || result.subscription.disabledAt) {
    return "prompt";
  }

  const config = await apiClient.getPushConfig();
  const providerReady = platform === "android" ? config.providers.fcm : config.providers.apns;
  return providerReady ? "ready" : "unavailable";
}

function openNotificationTarget(event: ActionPerformed) {
  const rawUrl = typeof event.notification.data?.url === "string" ? event.notification.data.url : "";
  if (!rawUrl || typeof window === "undefined") {
    return;
  }

  const target = new URL(rawUrl, window.location.origin);
  if (target.origin === window.location.origin && target.pathname.startsWith("/app/")) {
    window.history.pushState({}, "", `${target.pathname}${target.search}${target.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export async function initializeNativePushNotificationActions() {
  if (!isNativeMobileApp() || actionListenerStarted) {
    return;
  }

  actionListenerStarted = true;
  await PushNotifications.addListener("pushNotificationActionPerformed", openNotificationTarget);
}
