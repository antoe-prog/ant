/**
 * admin-web과 동일한 GenAI Gateway(FastAPI) /v1/auth/* 를 유도관 앱에서도
 * "미러" 방식으로 사용하기 위한 헬퍼.
 *
 * - 유도관 자체 로그인/가입이 성공한 직후 동일한 이메일/비밀번호로 gateway에도
 *   자동 등록(409면 로그인)을 시도한다.
 * - gateway가 비활성(EXPO_PUBLIC_GATEWAY_BASE_URL 미설정)이거나 연결 실패여도
 *   유도관 앱은 정상 동작한다.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  GATEWAY_BASE_URL,
  GATEWAY_SESSION_TOKEN_KEY,
  GATEWAY_USER_INFO_KEY,
} from "@/constants/oauth";

export type GatewayUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export type GatewayAuthResult = {
  token: string;
  user: GatewayUser;
};

export function isGatewayConfigured(): boolean {
  return GATEWAY_BASE_URL.trim().length > 0;
}

function baseUrl(): string {
  return GATEWAY_BASE_URL.replace(/\/$/, "");
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail: string = `${res.status}`;
    try {
      const json = (await res.json()) as { detail?: string };
      if (typeof json.detail === "string") detail = json.detail;
    } catch {
      /* ignore */
    }
    const err = new Error(detail);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

async function webSetItem(key: string, value: string) {
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function webGetItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function webDeleteItem(key: string) {
  if (Platform.OS === "web") {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export async function getGatewayToken(): Promise<string | null> {
  return webGetItem(GATEWAY_SESSION_TOKEN_KEY);
}

export async function getGatewayUser(): Promise<GatewayUser | null> {
  const raw = await webGetItem(GATEWAY_USER_INFO_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GatewayUser;
  } catch {
    return null;
  }
}

export async function clearGatewaySession(): Promise<void> {
  await webDeleteItem(GATEWAY_SESSION_TOKEN_KEY);
  await webDeleteItem(GATEWAY_USER_INFO_KEY);
}

async function persistGatewaySession(result: GatewayAuthResult) {
  await webSetItem(GATEWAY_SESSION_TOKEN_KEY, result.token);
  await webSetItem(GATEWAY_USER_INFO_KEY, JSON.stringify(result.user));
}

/**
 * 유도관 register/login 성공 후 같은 자격증명으로 gateway에도 가입/로그인한다.
 * 실패(네트워크, 잘못된 URL 등)는 조용히 삼키고 null을 반환한다.
 */
export async function mirrorAuthToGateway(input: {
  email: string;
  password: string;
  name?: string;
  mode: "login" | "register";
}): Promise<GatewayAuthResult | null> {
  if (!isGatewayConfigured()) return null;
  const email = input.email.trim().toLowerCase();

  try {
    if (input.mode === "register") {
      try {
        const r = await postJson<GatewayAuthResult>("/v1/auth/register", {
          email,
          password: input.password,
          name: input.name ?? email.split("@")[0],
        });
        await persistGatewaySession(r);
        return r;
      } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status !== 409) return null;
      }
    }

    const r = await postJson<GatewayAuthResult>("/v1/auth/login", {
      email,
      password: input.password,
    });
    await persistGatewaySession(r);
    return r;
  } catch {
    return null;
  }
}
