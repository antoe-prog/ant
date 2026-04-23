import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";

// 알림 핸들러: 포그라운드에서도 알림 표시 (웹 제외)
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

// 인증 상태 감지 후 푸시 토큰 서버 등록
function PushNotificationSetup() {
  const { isAuthenticated } = useAuth();
  usePushNotifications(isAuthenticated);
  return null;
}

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  const router = useRouter();

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  // 알림 권한 요청 (앱 시작 시, 약간 지연하여 UI 안정화 후 실행)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const timer = setTimeout(() => {
      import("@/lib/notifications").then(({ requestNotificationPermissions }) => {
        requestNotificationPermissions().then(granted => {
          if (!granted) console.warn("[Notifications] 알림 권한이 거부되었습니다.");
        });
      });
    }, 1500); // 1.5초 후 요청 (앱 로딩 완료 후)
    return () => clearTimeout(timer);
  }, []);

  // Handle deep links: judomanager://invite/TOKEN, scheme://invite?token=...
  useEffect(() => {
    const extractInviteToken = (url: string): string | null => {
      try {
        const parsed = Linking.parse(url);
        const q = parsed.queryParams?.token;
        if (q != null && String(q).trim() !== "") return String(q);
        const path = (parsed.path ?? "").replace(/^\/+/, "");
        if (path.startsWith("invite/")) {
          const rest = path.slice("invite/".length).split("?")[0];
          if (rest) return decodeURIComponent(rest);
        }
        const m = url.match(/[/]invite[/]([^/?#]+)/i);
        if (m?.[1]) return decodeURIComponent(m[1]);
        return null;
      } catch {
        return null;
      }
    };

    const handleUrl = (event: { url: string }) => {
      const token = extractInviteToken(event.url);
      if (token) {
        router.push({ pathname: "/invite", params: { token } });
      }
    };
    // Handle cold start deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });
    // Handle deep link when app is already open
    const subscription = Linking.addEventListener("url", handleUrl);
    return () => subscription.remove();
  }, [router]);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
          {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
          {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
          <PushNotificationSetup />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="login" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="oauth/callback" />
            <Stack.Screen name="member-detail" options={{ presentation: "card" }} />
            <Stack.Screen name="invite" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="my-promotions" options={{ presentation: "card" }} />
            <Stack.Screen name="my-registration" options={{ presentation: "card" }} />
            <Stack.Screen name="my-attendance-calendar" options={{ presentation: "card" }} />
            <Stack.Screen name="my-schedule" options={{ presentation: "card" }} />
          </Stack>
          <StatusBar style="auto" />
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
    </ThemeProvider>
  );
}
