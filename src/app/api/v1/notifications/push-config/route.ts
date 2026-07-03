import { NextRequest } from "next/server";
import { readServerDb } from "@/server/db";
import { jsonOk, requireSession } from "@/server/api";
import { getPushConfig, getVisibleActivePushSubscriptionCount } from "@/server/push-notifications";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  return jsonOk({
    ...getPushConfig(),
    activeSubscriptionCount: getVisibleActivePushSubscriptionCount(db, user),
    currentUserSubscribed: db.pushSubscriptions.some(
      (subscription) => !subscription.disabledAt && subscription.userId === user.id,
    ),
  });
}
