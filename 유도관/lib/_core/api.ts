import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "./auth";

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

export async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Determine the auth method:
  // - Native platform: use stored session token as Bearer auth
  // - Web (including iframe): use cookie-based auth (browser handles automatically)
  if (Platform.OS !== "web") {
    const sessionToken = await Auth.getSessionToken();
    if (sessionToken) {
      headers["Authorization"] = `Bearer ${sessionToken}`;
    }
  }

  const baseUrl = getApiBaseUrl();
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = baseUrl ? `${cleanBaseUrl}${cleanEndpoint}` : endpoint;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorText;
      } catch {
        // Not JSON, use text as is
      }
      throw new Error(errorMessage || `API call failed: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return await response.json() as T;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unknown error occurred");
  }
}

/**
 * 로그아웃 — 서버 쿠키 정리.
 * 이전의 OAuth 교환/세션 수립 헬퍼(exchangeOAuthCode, establishSession)는
 * 자체 이메일+비밀번호 인증으로 전환되어 제거되었습니다.
 */
export async function logout(): Promise<void> {
  try {
    await apiCall<void>("/api/logout", { method: "POST" });
  } catch {
    // 쿠키가 이미 없는 경우 등은 무시
  }
}

/**
 * 현재 로그인된 사용자 정보 조회 (쿠키 또는 Bearer 토큰).
 * tRPC auth.me 쿼리를 HTTP GET으로 호출한다.
 */
export async function getMe(): Promise<{
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: string;
  role: "member" | "manager" | "admin";
  avatarUrl: string | null;
} | null> {
  try {
    // tRPC GET query with superjson input format
    const result = await apiCall<{
      result: { data: { json?: any } | any };
    }>("/api/trpc/auth.me?input=" + encodeURIComponent(JSON.stringify({})));
    const raw = (result as any)?.result?.data;
    const user = raw?.json ?? raw;
    if (!user || typeof user.id !== "number") return null;
    return {
      id: user.id,
      openId: user.openId ?? "",
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      lastSignedIn: user.lastSignedIn ?? new Date().toISOString(),
      role: (user.role as "member" | "manager" | "admin") ?? "member",
      avatarUrl: user.avatarUrl ?? null,
    };
  } catch {
    return null;
  }
}
