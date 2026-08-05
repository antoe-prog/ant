import { apiClient } from "@/lib/api-client";

export type BrowserPushConnectionStatus = "blocked" | "hidden" | "prompt" | "ready";

function decodeVapidPublicKey(publicKey: string) {
  const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
  const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = window.atob(base64);

  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

export async function connectCurrentBrowserPushSubscription({
  requestPermission,
}: {
  requestPermission: boolean;
}): Promise<BrowserPushConnectionStatus> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return "hidden";
  }

  const config = await apiClient.getPushConfig();

  if (!config.configured || !config.publicKey) {
    return "hidden";
  }

  let permission = Notification.permission;

  if (permission === "default" && requestPermission) {
    permission = await Notification.requestPermission();
  }

  if (permission === "denied") {
    return "blocked";
  }

  if (permission !== "granted") {
    return "prompt";
  }

  const registration =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }));
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      applicationServerKey: decodeVapidPublicKey(config.publicKey),
      userVisibleOnly: true,
    }));

  // Account-level state cannot prove which signed-in user owns this browser endpoint.
  const result = await apiClient.subscribeToPush(
    subscription.toJSON(),
    window.navigator.userAgent,
    requestPermission,
  );

  if (result.reactivationRequired || result.subscription.disabledAt) {
    return "prompt";
  }

  return "ready";
}
