import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { getSessionUser, jsonOk, sessionCookieName } from "@/server/api";
import { createExpiredSessionCookieOptions } from "@/server/auth-policy";
import { authSecurityLockKey, revokeAuthSession } from "@/server/auth-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get(sessionCookieName)?.value;
  const response = await withServerDbLock(authSecurityLockKey, async () => {
    const db = await readServerDb();
    const user = getSessionUser(request, db);
    const revokedDb = revokeAuthSession(db, sessionToken);

    if (user) {
      const auditLog: AuditLog = {
        id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
        branchId: null,
        actorUserId: user.id,
        action: "auth.logout",
        targetType: "auth",
        targetId: user.id,
        before: null,
        after: { role: user.role },
        result: "success",
        message: "로그아웃했습니다.",
        createdAt: new Date().toISOString(),
      };

      await writeServerDb({
        ...revokedDb,
        auditLogs: [auditLog, ...revokedDb.auditLogs],
      });
    } else if (revokedDb !== db) {
      await writeServerDb(revokedDb);
    }

    return jsonOk({ ok: true });
  });
  response.cookies.set(sessionCookieName, "", createExpiredSessionCookieOptions());

  return response;
}
