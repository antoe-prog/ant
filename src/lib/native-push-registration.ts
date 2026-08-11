import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications, type ActionPerformed, type PermissionStatus, type Token } from "@capacitor/push-notifications";
import { apiClient } from "@/lib/api-client";
import type { BrowserPushConnectionStatus } from "@/lib/browser-push-subscription";

export type NativePushConnectionStatus = BrowserPushConnectionStatus | "unavailable";

const registrationTimeoutMs = 15_000;
let actionListenerStarted = false;
let actionListenerPromise: Promise<void> | null = null;
let nativeTokenRegistrationPromise: Promise<string> | null = null;
const nativeSubscriptionPromises = new Map<string, Promise<NativePushConnectionStatus>>();

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

async function registerNativePushToken() {
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

async function waitForNativePushToken() {
  if (nativeTokenRegistrationPromise) {
    return nativeTokenRegistrationPromise;
  }

  nativeTokenRegistrationPromise = registerNativePushToken();

  try {
    return await nativeTokenRegistrationPromise;
  } finally {
    nativeTokenRegistrationPromise = null;
  }
}

export async function connectCurrentNativePushRegistration({
  requestPermission,
  userId,
}: {
  requestPermission: boolean;
  userId: string;
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
  const connectionKey = `${userId}\0${platform}\0${requestPermission ? "explicit" : "passive"}\0${token}`;
  const pendingSubscription = nativeSubscriptionPromises.get(connectionKey);
  if (pendingSubscription) {
    return pendingSubscription;
  }

  const subscriptionPromise = (async () => {
    const result = await apiClient.subscribeToNativePush(
      token,
      platform,
      typeof navigator === "undefined" ? `Capacitor/${platform}` : `Capacitor/${platform} ${navigator.userAgent}`,
      requestPermission,
      userId,
    );

    if (result.reactivationRequired || result.subscription.disabledAt) {
      return "prompt" as const;
    }

    const config = await apiClient.getPushConfig();
    const providerReady = platform === "android" ? config.providers.fcm : config.providers.apns;
    return providerReady ? "ready" as const : "unavailable" as const;
  })();
  nativeSubscriptionPromises.set(connectionKey, subscriptionPromise);

  try {
    return await subscriptionPromise;
  } finally {
    if (nativeSubscriptionPromises.get(connectionKey) === subscriptionPromise) {
      nativeSubscriptionPromises.delete(connectionKey);
    }
  }
}

export async function disconnectCurrentNativePushRegistration() {
  if (!isNativeMobileApp()) {
    return;
  }

  await Promise.allSettled([PushNotifications.removeAllDeliveredNotifications()]);
  await PushNotifications.unregister();
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

  if (actionListenerPromise) {
    return actionListenerPromise;
  }

  actionListenerPromise = (async () => {
    await PushNotifications.addListener("pushNotificationActionPerformed", openNotificationTarget);
    actionListenerStarted = true;
  })();

  try {
    await actionListenerPromise;
  } finally {
    actionListenerPromise = null;
  }
}
