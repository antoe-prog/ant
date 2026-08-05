import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/server/api";
import {
  notificationOutboxExecutionPolicy,
  processNotificationOutbox,
} from "@/server/notification-outbox-runner";

export const runtime = "nodejs";

function hasValidCronAuthorization(request: NextRequest, secret: string) {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const actualBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return jsonError(503, "CRON_NOT_CONFIGURED", "알림 재시도 작업이 설정되지 않았습니다.");
  }

  if (!hasValidCronAuthorization(request, cronSecret)) {
    return jsonError(401, "UNAUTHENTICATED", "작업 실행 권한이 없습니다.");
  }

  const result = await processNotificationOutbox({
    concurrency: notificationOutboxExecutionPolicy.scheduled.concurrency,
    limit: notificationOutboxExecutionPolicy.scheduled.limit,
  });
  return jsonOk({ ok: true, processed: result.processed });
}
