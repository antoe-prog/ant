import type { CapacitorConfig } from "@capacitor/cli";

const iosServerUrl = process.env.FINAL_JUDO_IOS_SERVER_URL?.trim();
const androidServerUrl = process.env.FINAL_JUDO_ANDROID_SERVER_URL?.trim();
const activeServerUrl = androidServerUrl ?? iosServerUrl;
const allowLocalCleartext = activeServerUrl ? /^http:\/\//.test(activeServerUrl) : false;
const iosLocalBundle = process.env.FINAL_JUDO_IOS_LOCAL_BUNDLE === "1";

const config: CapacitorConfig = {
  appId: "kr.co.finaljudo.multigym",
  appName: "파이널 유도",
  webDir: "mobile/ios-web",
  ios: {
    path: "mobile/ios",
  },
  android: {
    path: "mobile/android-cap",
  },
  plugins: {
    CapacitorHttp: {
      enabled: iosLocalBundle,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  ...(activeServerUrl
    ? {
        server: {
          url: activeServerUrl,
          cleartext: allowLocalCleartext,
          ...(allowLocalCleartext ? { allowNavigation: ["localhost", "127.0.0.1", "10.0.2.2", "192.168.35.22"] } : {}),
        },
      }
    : {}),
};

export default config;
