import { NextRequest, NextResponse } from "next/server";
import type { AuditLog } from "@/lib/domain";
import { createSessionCookieOptions } from "@/server/auth-policy";
import { createAuthSession } from "@/server/auth-session";
import { readServerDb, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const sessionCookieName = "final-judo-session";
const localAutoLoginHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const localAutoLoginUserIds = {
  admin: "user-admin",
  coach: "user-coach",
  guardian: "user-guardian",
  member: "user-member",
  owner: "user-owner",
} as const;

function getSafeNextPath(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/app/dashboard";
  }

  return next;
}

function getLocalRedirectOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https:" : "http:";

  if (requestHost) {
    try {
      const origin = new URL(`${protocol}//${requestHost}`);

      if (localAutoLoginHosts.has(origin.hostname)) {
        return origin.origin;
      }
    } catch {
      // Invalid forwarded hosts fall back to Next's validated request origin.
    }
  }

  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role");
  const userId = localAutoLoginUserIds[role as keyof typeof localAutoLoginUserIds];

  if (!localAutoLoginHosts.has(request.nextUrl.hostname) || !userId) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const db = await readServerDb();
  const user = db.users.find((candidate) => candidate.id === userId && candidate.invitationStatus !== "pending");

  if (!user) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const now = new Date();
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId: null,
    actorUserId: user.id,
    action: "auth.login",
    targetType: "auth",
    targetId: user.id,
    before: null,
    after: { localAutoLogin: true, role: user.role },
    result: "success",
    message: "로컬 자동 로그인했습니다.",
    createdAt: now.toISOString(),
  };
  const cookieOptions = createSessionCookieOptions({ NODE_ENV: "development" });
  const issuedSession = createAuthSession(
    { ...db, auditLogs: [auditLog, ...db.auditLogs] },
    user.id,
    cookieOptions.maxAge,
    now,
  );
  await writeServerDb(issuedSession.db);
  const response = NextResponse.redirect(new URL(getSafeNextPath(request), getLocalRedirectOrigin(request)));

  response.cookies.set(sessionCookieName, issuedSession.token, cookieOptions);

  return response;
}
