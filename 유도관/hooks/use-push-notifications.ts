import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { IS_ADMIN_APP } from "@/constants/app-variant";
import type { Router } from "expo-router";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidChannels() {
  if (Platform.OS !== "android") return;
  await Promise.all([
    Notifications.setNotificationChannelAsync("default", {
      name: "기본 알림",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1565C0",
    }),
    Notifications.setNotificationChannelAsync("judo-manager", {
      name: "유도관 운영 알림",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1565C0",
      sound: "default",
      enableVibrate: true,
      showBadge: true,
    }),
  ]);
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) return null;

  try {
    await ensureAndroidChannels();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;

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

function navigateFromNotification(router: Router, data: Record<string, unknown>) {
  const type = String(data?.type ?? "");

  if (type === "announcement") {
    router.push("/(tabs)/announcements");
    return;
  }

  if (type === "attendance") {
    // 관리자 앱은 출석 관리 탭으로, 회원/학부모 앱은 홈(출석 현황)으로 이동
    router.push(IS_ADMIN_APP ? ("/(tabs)/attendance" as never) : "/(tabs)");
    return;
  }

  if (
    type === "payment_expiry" ||
    type === "payment_overdue" ||
    type === "payment_complete" ||
    type === "registration_expiry"
  ) {
    router.push(IS_ADMIN_APP ? ("/(tabs)/payments" as never) : ("/my-registration" as never));
    return;
  }

  if (type === "promotion" || type === "promotion_reminder") {
    router.push(IS_ADMIN_APP ? ("/(tabs)/promotions" as never) : "/my-promotions");
    return;
  }

  if (
    type === "tournament" ||
    type === "tournament_register" ||
    type === "tournament_result" ||
    type === "tournament_reminder"
  ) {
    const id = data?.id ?? data?.tournamentId;
    if (id != null) {
      router.push({ pathname: "/tournament-detail", params: { id: String(id) } } as never);
    } else {
      router.push("/(tabs)/tournaments" as never);
    }
    return;
  }

  if (type === "manager_ops_daily" || type === "manager_ops_critical" || type === "manager_task_due") {
    // 운영 요약·할 일 위젯은 관리자 홈에 있다
    router.push("/(tabs)" as never);
    return;
  }
}

export function usePushNotifications(userId: number | null) {
  const router = useRouter();
  const registerMutation = trpc.pushTokens.register.useMutation();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  // 계정별로 토큰을 다시 묶는다: 같은 기기에서 다른 계정으로 로그인하면 재등록 필요
  const registeredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (userId == null) return;

    registerForPushNotificationsAsync().then((token) => {
      if (!token) {
        console.warn("[Push] Token not obtained. Check real device, notification permission, and EAS projectId.");
        return;
      }
      const key = `${userId}:${token}`;
      if (registeredKeyRef.current === key) return;
      registeredKeyRef.current = key;
      registerMutation.mutate(
        { token, platform: Platform.OS },
        {
          onError: (err) => console.warn("[Push] Server token register failed:", err.message),
        },
      );
    });

    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log("[Push] Notification received:", notification.request.content.title);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      navigateFromNotification(router, data);
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registerMutation은 렌더마다 새 객체라 제외
  }, [userId, router]);
}
