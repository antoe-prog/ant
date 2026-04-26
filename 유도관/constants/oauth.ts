/**
 * API 기본 URL 및 세션 저장 키.
 * 이전의 OAuth 포털/딥링크 관련 유틸리티는 자체 이메일+비밀번호 가입 방식으로 전환되어 제거되었습니다.
 */
import * as ReactNative from "react-native";
import Constants from "expo-constants";
import { PUBLIC_DOJO_API_BASE_URL } from "@/shared/const";

const env = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  gatewayBaseUrl: process.env.EXPO_PUBLIC_GATEWAY_BASE_URL ?? "",
};

export const API_BASE_URL = env.apiBaseUrl;

/**
 * GenAI Gateway(자체 회원가입 + /v1/chat 등)을 유도관 앱에서도 같은 계정으로 쓰기 위한 URL.
 * 비어 있으면 통합(mirror) 인증이 비활성화된다.
 */
export const GATEWAY_BASE_URL = env.gatewayBaseUrl;
export const GATEWAY_SESSION_TOKEN_KEY = "gateway_session_token";
export const GATEWAY_USER_INFO_KEY = "gateway-user-info";

/**
 * Get the API base URL, deriving from current hostname if not set.
 * Metro runs on 8081, API server runs on 3000.
 */
export function getApiBaseUrl(): string {
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/\/$/, "");
  }

  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const { origin, protocol, hostname, port } = window.location;
    const apiHostname = hostname.replace(/^8081-/, "3000-");
    if (apiHostname !== hostname) {
      return `${protocol}//${apiHostname}`;
    }
    if (port === "8081") {
      return `${protocol}//${hostname}:3000`;
    }
    return origin.replace(/\/$/, "");
  }

  if (ReactNative.Platform.OS === "android") {
    // Android emulator loopback to host machine.
    return "http://10.0.2.2:3000";
  }

  // Native (real device/dev client): derive host from Expo runtime (LAN), then point to :3000.
  const hostCandidates = [
    (Constants as any)?.expoConfig?.hostUri as string | undefined,
    (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost as string | undefined,
    (Constants as any)?.manifest?.debuggerHost as string | undefined,
  ];
  const host = hostCandidates
    .find((v) => typeof v === "string" && v.trim().length > 0)
    ?.split(":")[0];
  if (host) {
    return `http://${host}:3000`;
  }

  return PUBLIC_DOJO_API_BASE_URL.replace(/\/$/, "");
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "app-user-info";
