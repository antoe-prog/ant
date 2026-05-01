import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { requestNotificationPermissions } from "@/lib/notifications";

type OperationTask = {
  id: string;
  title: string;
  count: number;
  severity: "critical" | "warning" | "info";
};

type OperationSummary = {
  today: string;
  totals: {
    totalTasks: number;
    critical: number;
    warning: number;
    todayAttendanceMissing: number;
    paymentAttention: number;
    longAbsence: number;
    upcomingPromotions: number;
    tournamentAttention: number;
  };
  tasks: OperationTask[];
};

const DAILY_SENT_KEY_PREFIX = "manager_ops_critical_sent";
const DAILY_SCHEDULE_KEY_PREFIX = "manager_ops_daily_scheduled";

function nextMorningAt(hour: number, minute = 0): Date {
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target <= new Date()) target.setDate(target.getDate() + 1);
  return target;
}

function buildSummaryBody(summary: OperationSummary): string {
  const parts = [
    summary.totals.paymentAttention > 0 ? `납부 ${summary.totals.paymentAttention}건` : "",
    summary.totals.longAbsence > 0 ? `장기 미출석 ${summary.totals.longAbsence}명` : "",
    summary.totals.upcomingPromotions > 0 ? `승급 ${summary.totals.upcomingPromotions}건` : "",
    summary.totals.tournamentAttention > 0 ? `대회 ${summary.totals.tournamentAttention}건` : "",
    summary.totals.todayAttendanceMissing > 0 ? `출석 미기록 ${summary.totals.todayAttendanceMissing}명` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "오늘 처리할 운영 항목이 없습니다.";
}

async function cancelScheduledManagerOpsNotifications() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => {
        const type = item.content.data?.type;
        return type === "manager_ops_daily" || type === "manager_ops_critical";
      })
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}

export async function syncManagerOperationNotifications(summary: OperationSummary): Promise<void> {
  if (Platform.OS === "web") return;
  if (summary.totals.totalTasks <= 0) return;

  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    const body = buildSummaryBody(summary);
    const todayKey = summary.today;
    const criticalKey = `${DAILY_SENT_KEY_PREFIX}:${todayKey}`;
    const scheduleKey = `${DAILY_SCHEDULE_KEY_PREFIX}:${todayKey}`;
    const [criticalSent, dailyScheduled] = await Promise.all([
      AsyncStorage.getItem(criticalKey),
      AsyncStorage.getItem(scheduleKey),
    ]);

    if (summary.totals.critical > 0 && criticalSent !== "1") {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `긴급 운영 확인 ${summary.totals.critical}건`,
          body,
          data: { type: "manager_ops_critical", today: todayKey },
          sound: "default",
          ...(Platform.OS === "android" ? { channelId: "judo-manager" } : {}),
        },
        trigger: null,
      });
      await AsyncStorage.setItem(criticalKey, "1");
    }

    if (dailyScheduled !== "1") {
      await cancelScheduledManagerOpsNotifications();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `유도관 운영 요약 ${summary.totals.totalTasks}건`,
          body,
          data: { type: "manager_ops_daily", today: todayKey },
          sound: "default",
          ...(Platform.OS === "android" ? { channelId: "judo-manager" } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: nextMorningAt(9),
        },
      });
      await AsyncStorage.setItem(scheduleKey, "1");
    }
  } catch (error) {
    console.warn("[Notifications] syncManagerOperationNotifications failed:", error);
  }
}
