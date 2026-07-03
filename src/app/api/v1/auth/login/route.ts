import { NextRequest } from "next/server";
import type { AppUser, AuditLog, MockDatabase, UserRole } from "@/lib/domain";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, sessionCookieName } from "@/server/api";
import { canUseDemoRoleLogin, createSessionCookieOptions } from "@/server/auth-policy";
import { verifyPassword } from "@/server/auth-password";
import { normalizePhoneNumber, samePhoneNumber } from "@/lib/phone";

export const runtime = "nodejs";

type LoginBody = {
  email?: string;
  keepSignedIn?: boolean;
  loginId?: string;
  password?: string;
  phone?: string;
  role?: UserRole;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as LoginBody | null;
  const loginId = (body?.phone ?? body?.loginId ?? body?.email ?? "").trim();
  const emailFallback = loginId.toLowerCase();
  const phone = normalizePhoneNumber(loginId);
  const password = body?.password ?? "";
  const db = await readServerDb();

  if (loginId || password) {
    if (!loginId || !password) {
      return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호와 비밀번호를 입력해 주세요.");
    }

    const user =
      db.users.find((candidate) => samePhoneNumber(candidate.phone, loginId)) ??
      (loginId.includes("@")
        ? db.users.find((candidate) => candidate.email?.toLowerCase() === emailFallback)
        : null);

    if (user?.invitationStatus === "pending") {
      const failedAuditLog: AuditLog = {
        id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
        branchId: user.branchIds[0] ?? null,
        actorUserId: user.id,
        action: "auth.login",
        targetType: "auth",
        targetId: user.id,
        before: null,
        after: { phone: phone || loginId, reason: "pending_invitation" },
        result: "failed",
        message: "로그인에 실패했습니다.",
        createdAt: new Date().toISOString(),
      };

      await writeServerDb({
        ...db,
        auditLogs: [failedAuditLog, ...db.auditLogs],
      });

      return jsonError(403, "ACCOUNT_PENDING", "초대 가입이 완료되지 않았습니다. 받은 초대 링크에서 비밀번호 설정을 마쳐 주세요.");
    }

    if (!user || !verifyPassword(password, user.passwordHash)) {
      const failedAuditLog: AuditLog | null = user
        ? {
            id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
            branchId: user.branchIds[0] ?? null,
            actorUserId: user.id,
            action: "auth.login" as const,
            targetType: "auth" as const,
            targetId: user.id,
            before: null,
            after: { phone: phone || loginId, reason: "invalid_credentials" },
            result: "failed" as const,
            message: "로그인에 실패했습니다.",
            createdAt: new Date().toISOString(),
          }
        : null;

      if (failedAuditLog) {
        await writeServerDb({
          ...db,
          auditLogs: [failedAuditLog, ...db.auditLogs],
        });
      }

      return jsonError(401, "UNAUTHENTICATED", "휴대폰 번호 또는 비밀번호가 올바르지 않습니다.");
    }

    return createLoginResponse(db, user, body?.keepSignedIn === true);
  }

  if (!body?.role) {
    return jsonError(400, "VALIDATION_ERROR", "휴대폰 번호 또는 역할을 선택해 주세요.");
  }

  if (!canUseDemoRoleLogin()) {
    return jsonError(403, "FORBIDDEN", "운영 환경에서는 역할 바로 시작이 비활성화되어 있습니다.");
  }

  const demoUserId = `user-${body.role}`;
  const user =
    db.users.find(
      (candidate) =>
        candidate.id === demoUserId &&
        candidate.role === body.role &&
        candidate.invitationStatus !== "pending",
    ) ??
    db.users.find((candidate) => candidate.role === body.role && candidate.invitationStatus !== "pending") ??
    db.users.find((candidate) => candidate.role === body.role);

  if (!user) {
    return jsonError(404, "NOT_FOUND", "선택한 역할의 계정을 찾을 수 없습니다.");
  }

  return createLoginResponse(db, user);
}

async function createLoginResponse(db: MockDatabase, user: AppUser, keepSignedIn = false) {
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: null,
    actorUserId: user.id,
    action: "auth.login",
    targetType: "auth",
    targetId: user.id,
    before: null,
    after: { role: user.role },
    result: "success",
    message: "로그인했습니다.",
    createdAt: new Date().toISOString(),
  };
  const nextDb = await writeServerDb({
    ...db,
    auditLogs: [auditLog, ...db.auditLogs],
  });
  const response = jsonOk(createBootstrapPayload(nextDb, user, null));

  response.cookies.set(sessionCookieName, user.id, createSessionCookieOptions(process.env, { keepSignedIn }));

  return response;
}
