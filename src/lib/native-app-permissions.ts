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

export function isNativeMobilePermissionBridge() {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (platform === "android" || platform === "ios");
}

export async function getNativeAppPermissionStatus(permission: NativeAppPermission) {
  if (!isNativeMobilePermissionBridge()) {
    return null;
  }

  try {
    const status = await AppPermissions.getPermissionStatus();
    return status[permission];
  } catch {
    return null;
  }
}

export async function requestNativeAppPermission(permission: NativeAppPermission) {
  if (!isNativeMobilePermissionBridge()) {
    return null;
  }

  try {
    const status = await AppPermissions.requestPermission({ permission });
    return status[permission];
  } catch {
    return null;
  }
}

export async function openNativeAppSettings() {
  if (!isNativeMobilePermissionBridge()) {
    return false;
  }

  try {
    await AppPermissions.openAppSettings();
    return true;
  } catch {
    return false;
  }
}
