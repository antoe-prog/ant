import { Capacitor, registerPlugin } from "@capacitor/core";

export type NativeAppPermission = "camera" | "notifications";
export type NativeAppPermissionState = "denied" | "granted" | "prompt" | "prompt-with-rationale";

type NativeAppPermissionStatus = Record<NativeAppPermission, NativeAppPermissionState>;

type AppPermissionsPlugin = {
  getPermissionStatus(): Promise<NativeAppPermissionStatus>;
  openAppSettings(): Promise<void>;
  requestPermission(options: { permission: NativeAppPermission }): Promise<NativeAppPermissionStatus>;
};

const AppPermissions = registerPlugin<AppPermissionsPlugin>("AppPermissions");

export function isNativeAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function getNativeAppPermissionStatus(permission: NativeAppPermission) {
  if (!isNativeAndroidApp()) {
    return null;
  }

  const status = await AppPermissions.getPermissionStatus();
  return status[permission];
}

export async function requestNativeAppPermission(permission: NativeAppPermission) {
  if (!isNativeAndroidApp()) {
    return null;
  }

  const status = await AppPermissions.requestPermission({ permission });
  return status[permission];
}

export async function openNativeAppSettings() {
  if (!isNativeAndroidApp()) {
    return false;
  }

  await AppPermissions.openAppSettings();
  return true;
}
