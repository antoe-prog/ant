import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient as createVanillaTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
function buildLink() {
  return httpBatchLink({
    url: `${getApiBaseUrl()}/api/trpc`,
    // tRPC v11: transformer MUST be inside httpBatchLink, not at root
    transformer: superjson,
    async headers() {
      const token = await Auth.getSessionToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    // Custom fetch to include credentials for cookie-based auth
    fetch(url, options) {
      return fetch(url, {
        ...options,
        credentials: "include",
      });
    },
  });
}

export function createTRPCClient() {
  return trpc.createClient({
    links: [buildLink()],
  });
}

/**
 * React 훅 밖(로그아웃 처리 등)에서 호출할 수 있는 vanilla 클라이언트.
 * 세션 토큰이 아직 살아있을 때 호출해야 인증이 필요한 프로시저가 동작한다.
 */
export const vanillaTrpc = createVanillaTRPCClient<AppRouter>({
  links: [buildLink()],
});
