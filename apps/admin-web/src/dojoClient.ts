import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

export const DOJO_API_KEY = "adminweb.dojo.apiBase";
export const DOJO_TOKEN_KEY = "adminweb.dojo.token";

const DEFAULT_DOJO_API = "https://api.judokan.store";

export function readDojoApiBase(): string {
  return (
    localStorage.getItem(DOJO_API_KEY) ||
    import.meta.env.VITE_DOJO_API_BASE_URL ||
    DEFAULT_DOJO_API
  );
}

export function readDojoToken(): string {
  return localStorage.getItem(DOJO_TOKEN_KEY) || "";
}

export function writeDojoApiBase(base: string): void {
  localStorage.setItem(DOJO_API_KEY, base.trim());
}

export function writeDojoToken(token: string): void {
  const v = token.trim();
  if (!v) localStorage.removeItem(DOJO_TOKEN_KEY);
  else localStorage.setItem(DOJO_TOKEN_KEY, v);
}

export function createDojoTrpcClient(apiBase: string, token: string): any {
  const base = apiBase.replace(/\/$/, "");
  return createTRPCProxyClient<any>({
    links: [
      httpBatchLink({
        url: `${base}/api/trpc`,
        transformer: superjson,
        headers() {
          const t = token.trim();
          return t ? { Authorization: `Bearer ${t}` } : {};
        },
        fetch(url, opts) {
          return fetch(url, { ...opts, credentials: "include" });
        },
      }),
    ],
  });
}
