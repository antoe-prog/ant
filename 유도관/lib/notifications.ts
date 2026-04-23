import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * 알림 권한 요청 및 Android 채널 설정
 * 앱 최초 실행 시 또는 로그인 후 호출
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  // 웹은 expo-notifications 미지원
  if (Platform.OS === "web") return false;

  try {
    // Android 알림 채널 설정 (Android 8.0+ 필수)
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("judo-manager", {
        name: "유도장 관리",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#1565C0",
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: false,
          allowCriticalAlerts: false,
          provideAppNotificationSettings: false,
          allowProvisional: false,
        },
      });
      finalStatus = status;
    }

    return finalStatus === "granted";
  } catch (e) {
    console.warn("[Notifications] requestNotificationPermissions failed:", e);
    return false;
  }
}

/**
 * 납부 만료 알림 스케줄링
 * nextPaymentDate 기준 3일 전 오전 9시에 알림
 * 이미 지난 날짜면 당일 즉시 알림으로 폴백
 */
export async function schedulePaymentReminderNotification(params: {
  memberName: string;
  nextPaymentDate: string; // YYYY-MM-DD
  memberId: number;
}): Promise<string | null> {
  if (Platform.OS === "web") return null;

  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return null;

    const { memberName, nextPaymentDate, memberId } = params;

    // YYYY-MM-DD 파싱 시 로컬 타임존 기준으로 처리 (UTC 변환 방지)
    const [year, month, day] = nextPaymentDate.split("-").map(Number);
    const dueDate = new Date(year, month - 1, day, 9, 0, 0, 0);

    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - 3); // 3일 전 오전 9시

    const now = new Date();

    // 기존 알림 취소 후 재등록
    await cancelPaymentReminderNotification(memberId);

    // 3일 전이 이미 지났으면 → 만료 당일 오전 9시로 폴백
    // 만료 당일도 지났으면 → 즉시 알림
    let triggerDate = reminderDate;
    if (triggerDate <= now) {
      triggerDate = dueDate;
    }

    if (triggerDate <= now) {
      // 만료일도 지났으면 즉시 알림 (이미 연체)
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "💳 납부 만료",
          body: `${memberName} 회원의 납부 기한이 지났습니다. 확인해 주세요.`,
          data: { type: "payment_reminder", memberId },
          sound: "default",
          ...(Platform.OS === "android" ? { channelId: "judo-manager" } : {}),
        },
        trigger: null, // 즉시 발송
      });
      return "immediate";
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "💳 납부 만료 임박",
        body: `${memberName} 회원의 납부 기한이 3일 후(${nextPaymentDate})입니다.`,
        data: { type: "payment_reminder", memberId },
        sound: "default",
        ...(Platform.OS === "android" ? { channelId: "judo-manager" } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });

    return id;
  } catch (e) {
    console.warn("[Notifications] schedulePaymentReminderNotification failed:", e);
    return null;
  }
}

/**
 * 특정 회원의 납부 알림 취소
 */
export async function cancelPaymentReminderNotification(memberId: number): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (
        notif.content.data?.type === "payment_reminder" &&
        notif.content.data?.memberId === memberId
      ) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }
  } catch (e) {
    console.warn("[Notifications] cancelPaymentReminderNotification failed:", e);
  }
}

/**
 * 공지사항 등록 시 즉시 로컬 알림 발송
 * 관리자가 공지를 등록하면 앱을 사용 중인 모든 기기에 즉시 표시
 */
export async function sendAnnouncementNotification(params: {
  title: string;
  content: string;
}): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    const body = params.content.length > 100
      ? params.content.slice(0, 100) + "..."
      : params.content;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `📢 ${params.title}`,
        body,
        data: { type: "announcement" },
        sound: "default",
        ...(Platform.OS === "android" ? { channelId: "judo-manager" } : {}),
      },
      trigger: null, // 즉시 발송
    });
  } catch (e) {
    console.warn("[Notifications] sendAnnouncementNotification failed:", e);
  }
}

/**
 * 등록 만료 7일 전 알림 스케줄링 (회원용)
 * nextPaymentDate 기준 7일 전 오전 9시에 알림
 */
export async function scheduleRegistrationExpiryNotification(params: {
  nextPaymentDate: string; // YYYY-MM-DD
}): Promise<string | null> {
  if (Platform.OS === "web") return null;

  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return null;

    const { nextPaymentDate } = params;
    const [year, month, day] = nextPaymentDate.split("-").map(Number);
    const dueDate = new Date(year, month - 1, day, 9, 0, 0, 0);

    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - 7); // 7일 전 오전 9시

    const now = new Date();

    // 이미 지났으면 만료 당일로 폴백
    let triggerDate = reminderDate;
    if (triggerDate <= now) {
      triggerDate = dueDate;
    }
    if (triggerDate <= now) return null; // 만료일도 지났으면 스킵

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "📅 등록 만료 임박",
        body: `등록 기간이 7일 후(${nextPaymentDate}) 만료됩니다. 갱신을 준비해 주세요.`,
        data: { type: "registration_expiry" },
        sound: "default",
        ...(Platform.OS === "android" ? { channelId: "judo-manager" } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });

    return id;
  } catch (e) {
    console.warn("[Notifications] scheduleRegistrationExpiryNotification failed:", e);
    return null;
  }
}

/**
 * 테스트용: 즉시 알림 발송 (개발/디버깅용)
 */
export async function sendTestNotification(): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      console.warn("[Notifications] 알림 권한이 없습니다.");
      return;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "🥋 JudoManager 알림 테스트",
        body: "알림이 정상적으로 작동합니다!",
        data: { type: "test" },
        sound: "default",
        ...(Platform.OS === "android" ? { channelId: "judo-manager" } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.warn("[Notifications] sendTestNotification failed:", e);
  }
}
