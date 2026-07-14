import { NextRequest } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { jsonOk } from "@/server/api";
import { authSecurityLockKey, hasReachedPasswordResetRequestLimit } from "@/server/auth-session";

export const runtime = "nodejs";

type PasswordResetBody = {
  identifier?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as PasswordResetBody | null;
  const identifier = body?.identifier?.trim().toLowerCase() ?? "";
  const phone = normalizePhoneNumber(identifier);
  return withServerDbLock(authSecurityLockKey, async () => {
    const db = await readServerDb();
    const user = identifier
      ? db.users.find((candidate) =>
          [candidate.id, candidate.email?.toLowerCase(), candidate.name.toLowerCase()].filter(Boolean).includes(identifier) ||
          samePhoneNumber(candidate.phone, phone),
        )
      : null;

    if (!user) {
      return jsonOk({ ok: true });
    }

    const now = new Date();

    if (hasReachedPasswordResetRequestLimit(db, user.id, now)) {
      return jsonOk({ ok: true });
    }

    const createdAt = now.toISOString();
    const auditLog: AuditLog = {
      id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
      branchId: user.branchIds[0] ?? null,
      actorUserId: user.id,
      action: "auth.password_reset.request",
      targetType: "auth",
      targetId: user.id,
      before: null,
      after: { requestRecorded: true },
      result: "success",
      message: "비밀번호 재설정 요청을 기록했습니다.",
      createdAt,
    };

    await writeServerDb({
      ...db,
      users: db.users.map((candidate) =>
        candidate.id === user.id ? { ...candidate, passwordResetRequestedAt: createdAt } : candidate,
      ),
      auditLogs: [auditLog, ...db.auditLogs],
    });

    return jsonOk({ ok: true });
  });
}
