import Expo, { ExpoPushMessage } from "expo-server-sdk";
import { getAllPushTokens } from "./db";

const expo = new Expo();

/**
 * 특정 userId 목록에게 푸시 알림 발송
 */
export async function sendPushNotifications(
  userIds: number[] | "all",
  payload: { title: string; body: string; data?: Record<string, unknown> }
) {
  try {
    // 토큰 조회
    const allTokens = await getAllPushTokens();
    const targets =
      userIds === "all"
        ? allTokens
        : allTokens.filter((t) => userIds.includes(t.userId));

    if (targets.length === 0) {
      // 가장 흔한 무음 실패 케이스: 수신자에 해당하는 푸시 토큰이 DB에 없음.
      // (회원이 한 번도 로그인 안 함 / 권한 거부 / EAS projectId 누락 / 시뮬레이터 등)
      console.warn(
        `[Push] No tokens for recipients (userIds=${userIds === "all" ? "all" : userIds.join(",")}, total=${allTokens.length}). "${payload.title}"`,
      );
      return { sent: 0, errors: 0 };
    }

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

    if (messages.length === 0) {
      console.warn(
        `[Push] Recipients had no valid Expo tokens (targets=${targets.length}). "${payload.title}"`,
      );
      return { sent: 0, errors: 0 };
    }

    // 청크 단위로 발송 (Expo 권장)
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
