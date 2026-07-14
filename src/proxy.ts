import { NextResponse, type NextRequest } from "next/server";

const localAutoLoginHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const localAutoLoginRoles = new Set(["admin", "coach", "guardian", "member", "owner"]);

function getSafeNextPath(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/app/dashboard";
  }

  return next;
}

export function proxy(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role");

  if (
    request.nextUrl.searchParams.get("autoLogin") !== "1" ||
    !localAutoLoginHosts.has(request.nextUrl.hostname) ||
    !role ||
    !localAutoLoginRoles.has(role)
  ) {
    return NextResponse.next();
  }

  const autoLoginUrl = new URL("/api/v1/dev/auto-login", request.url);
  autoLoginUrl.searchParams.set("role", role);
  autoLoginUrl.searchParams.set("next", getSafeNextPath(request));
  return NextResponse.redirect(autoLoginUrl);
}

export const config = {
  matcher: "/login",
};
