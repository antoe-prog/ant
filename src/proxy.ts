import { NextResponse, type NextRequest } from "next/server";
import { normalizeLocalAutoLoginNextPath } from "@/lib/local-auto-login";

const localAutoLoginHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const localAutoLoginRoles = new Set(["admin", "coach", "guardian", "member", "owner"]);

export function proxy(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role");

  if (
    process.env.NODE_ENV === "production" ||
    request.nextUrl.searchParams.get("autoLogin") !== "1" ||
    !localAutoLoginHosts.has(request.nextUrl.hostname) ||
    !role ||
    !localAutoLoginRoles.has(role)
  ) {
    return NextResponse.next();
  }

  const autoLoginUrl = new URL("/api/v1/dev/auto-login", request.url);
  autoLoginUrl.searchParams.set("role", role);
  autoLoginUrl.searchParams.set("next", normalizeLocalAutoLoginNextPath(request.nextUrl.searchParams.get("next")));
  return NextResponse.redirect(autoLoginUrl);
}

export const config = {
  matcher: "/login",
};
