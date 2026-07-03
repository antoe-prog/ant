import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { getSessionUser, jsonOk, sessionCookieName } from "@/server/api";
import { createExpiredSessionCookieOptions } from "@/server/auth-policy";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const db = await readServerDb();
  const user = getSessionUser(request, db);

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
      ...db,
      auditLogs: [auditLog, ...db.auditLogs],
    });
  }

  const response = jsonOk({ ok: true });
  response.cookies.set(sessionCookieName, "", createExpiredSessionCookieOptions());

  return response;
}
