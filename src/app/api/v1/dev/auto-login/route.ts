import { NextRequest, NextResponse } from "next/server";

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

export function GET(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role");
  const userId = localAutoLoginUserIds[role as keyof typeof localAutoLoginUserIds];

  if (!localAutoLoginHosts.has(request.nextUrl.hostname) || !userId) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const response = NextResponse.redirect(new URL(getSafeNextPath(request), request.url));

  response.cookies.set(sessionCookieName, userId, {
    httpOnly: true,
    maxAge: 60 * 60 * 8,
    path: "/",
    sameSite: "lax",
    secure: false,
  });

  return response;
}
