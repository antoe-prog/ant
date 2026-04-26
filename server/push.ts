import Expo, { ExpoPushMessage } from "expo-server-sdk";
import { getAllPushTokens } from "./db";

const expo = new Expo();

/**
 * ?뱀젙 userId 紐⑸줉?먭쾶 ?몄떆 ?뚮┝ 諛쒖넚
 */
export async function sendPushNotifications(
  userIds: number[] | "all",
  payload: { title: string; body: string; data?: Record<string, unknown> }
) {
  try {
    // ?좏겙 議고쉶
    const allTokens = await getAllPushTokens();
    const targets =
      userIds === "all"
        ? allTokens
        : allTokens.filter((t) => userIds.includes(t.userId));

    if (targets.length === 0) return { sent: 0, errors: 0 };

    // 유효한 Expo 토큰만 필터링
    const messages: ExpoPushMessage[] = targets
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => ({
        to: t.token,
        sound: "default" as const,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
      }));

    if (messages.length === 0) return { sent: 0, errors: 0 };

    // 泥?겕 ?⑥쐞濡?諛쒖넚 (Expo 沅뚯옣)
    const chunks = expo.chunkPushNotifications(messages);
    let sent = 0;
    let errors = 0;

    for (const chunk of chunks) {
      try {
        const receipts = await expo.sendPushNotificationsAsync(chunk);
        for (const receipt of receipts) {
          if (receipt.status === "ok") sent++;
          else errors++;
        }
      } catch {
        errors += chunk.length;
      }
    }

    return { sent, errors };
  } catch (err) {
    console.error("[Push] Failed to send notifications:", err);
    return { sent: 0, errors: 1 };
  }
}

