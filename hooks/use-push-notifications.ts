import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import type { Router } from "expo-router";

// 포그라운드에서도 알림 배너 표시
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushNotificationsAsync(): Promise<string | null> {
  // 실제 기기에서만 동작 (시뮬레이터 제외)
  if (!Device.isDevice) return null;

  // Android 채널 설정
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "기본 알림",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1565C0",
    });
  }

  // 권한 요청
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  // Expo 푸시 토큰 발급
  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    if (!projectId) {
      console.warn("[Push] EAS projectId not found, skipping push token registration");
      return null;
    }
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenData.data;
  } catch (err) {
    console.warn("[Push] Failed to get push token:", err);
    return null;
  }
}

/**
 * 앱 시작 시 푸시 토큰을 서버에 등록하고
 * 알림 수신/탭 이벤트를 처리하는 훅
 */
export function usePushNotifications(isAuthenticated: boolean) {
  const router = useRouter();
  const registerMutation = trpc.pushTokens.register.useMutation();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    // 토큰 등록
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        registerMutation.mutate({ token, platform: Platform.OS });
      }
    });

    // 포그라운드 알림 수신 리스너
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        // 필요 시 인앱 알림 UI 처리 가능
        console.log("[Push] Notification received:", notification.request.content.title);
      }
    );

    // 알림 탭 리스너 - 공지사항 탭 시 공지 화면으로 이동
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        if (data?.type === "announcement") {
          // 공지사항 탭으로 이동
          router.push("/(tabs)/announcements");
        } else if (data?.type === "attendance") {
          // 홈 탭으로 이동
          router.push("/(tabs)");
        } else if (data?.type === "payment_expiry") {
          // 홈 탭으로 이동 (납부 안내)
          router.push("/(tabs)");
        }
      }
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isAuthenticated]);
}
