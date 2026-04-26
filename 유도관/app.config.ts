// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "space.manus.onboarding.workflow.t20260403001927";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Extract timestamp from bundle ID and prefix with "manus" for deep link scheme
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;
const appVariant = process.env.EXPO_PUBLIC_APP_VARIANT === "admin" ? "admin" : "member";
const variantScheme = `${schemeFromBundleId}${appVariant}`;
const variantPackageSuffix = appVariant === "admin" ? ".admin" : ".member";

/**
 * OAuth·소셜 콜백 + 초대 딥링크.
 * `judomanager`는 기존 배포·문서·초대 링크와의 호환을 위해 유지한다.
 * 스킴을 바꾸면 이미 설치된 앱의 초대/로그인 콜백이 깨질 수 있으므로 변경 시 마이그레이션 공지가 필요하다.
 */
const urlSchemes =
  appVariant === "admin"
    ? ([variantScheme, "judokanadmin"] as const)
    : ([variantScheme, "judokanmember", "judomanager"] as const);

const env = {
  // App branding - update these values directly (do not use env vars)
  // 표시 이름 "유도관" = 도장 브랜드. (난관·의료 앱 아님.)
  appName: appVariant === "admin" ? "유도관 관리자" : "유도관 회원",
  appSlug: "judokan",
  logoUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310519663509240657/KGSotH7p7S8bVPSzf9bZAR/judogi-icon-PjwDNEuwTYophGHYk6DoiB.png",
  scheme: urlSchemes,
  iosBundleId: `${bundleId}${variantPackageSuffix}`,
  androidPackage: `${bundleId}${variantPackageSuffix}`,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  owner: "anttoes-organization",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: [...env.scheme],
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
  },
  android: {
    // @ts-expect-error Expo app config accepts this field even though the local type is narrower.
    usesCleartextTraffic: true,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: env.scheme.map((scheme) => ({
          scheme,
          host: "*",
        })),
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-asset",
    // 푸시 알림: projectId·권한·아이콘 설정. 추가한 뒤에는 빌드를 다시 만들어야 반영된다.
    [
      "expo-notifications",
      {
        icon: "./assets/images/icon.png",
        color: "#1565C0",
      },
    ],
    [
      "expo-camera",
      {
        "cameraPermission": "출석 QR 코드 스캔을 위해 카메라 접근이 필요합니다."
      }
    ],
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],
  extra: {
    eas: {
      projectId: "87edd3e7-6e23-406f-a871-6c2c38849cd3",
    },
  },
  // EAS Update: `eas build`가 동적 config라 자동 주입 못해 수동 삽입.
  // 값은 프로젝트 ID와 연결돼 있으므로 projectId와 함께 유지된다.
  updates: {
    url: "https://u.expo.dev/87edd3e7-6e23-406f-a871-6c2c38849cd3",
  },
  runtimeVersion: {
    policy: "appVersion",
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: false,
  },
};

export default config;
