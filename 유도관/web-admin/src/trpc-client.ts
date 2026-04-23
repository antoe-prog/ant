import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../server/routers";

const TOKEN_KEY = "yudogwan_web_admin_token";

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setStoredToken(token: string) {
  if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
  else localStorage.removeItem(TOKEN_KEY);
}

export function createWebAdminTrpc(apiBase: string) {
  const base = apiBase.replace(/\/$/, "");
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${base}/api/trpc`,
        transformer: superjson,
        headers() {
          const t = getStoredToken();
          return t ? { Authorization: `Bearer ${t}` } : {};
        },
        fetch(url, opts) {
          return fetch(url, { ...opts, credentials: "include" });
        },
      }),
    ],
  });
}
