/**
 * 소셜 로그인 OAuth 라우터
 * - 카카오: /api/oauth/kakao → /api/oauth/kakao/callback
 * - 인스타그램(Facebook): /api/oauth/instagram → /api/oauth/instagram/callback
 * - 구글: /api/oauth/google → /api/oauth/google/callback
 *
 * API 키가 없으면 "설정 필요" 에러를 반환하고, 키 입력 후 즉시 동작합니다.
 */

import type { Express, Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const.js";
import { upsertUser, getUserByOpenId } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";

// ─────────────────────────────────────────────
// 환경변수 헬퍼
// ─────────────────────────────────────────────
function getEnv(key: string): string {
  return process.env[key] ?? "";
}

function getFrontendUrl(): string {
  return (
    process.env.EXPO_WEB_PREVIEW_URL ||
    process.env.EXPO_PACKAGER_PROXY_URL ||
    "http://localhost:8081"
  );
}

// ─────────────────────────────────────────────
// 공통: DB에 소셜 유저 저장 후 세션 토큰 발급
// ─────────────────────────────────────────────
async function createSocialSession(userInfo: {
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string;
}): Promise<string> {
  await upsertUser({
    openId: userInfo.openId,
    name: userInfo.name,
    email: userInfo.email,
    loginMethod: userInfo.loginMethod,
    lastSignedIn: new Date(),
  });

  return sdk.createSessionToken(userInfo.openId, {
    name: userInfo.name || "",
    expiresInMs: ONE_YEAR_MS,
  });
}

function buildUserResponse(user: any) {
  return {
    id: user?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: user?.loginMethod ?? null,
    role: user?.role ?? "user",
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
  };
}

// ─────────────────────────────────────────────
// 카카오 OAuth
// ─────────────────────────────────────────────
function getKakaoAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getEnv("KAKAO_REST_API_KEY"),
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `https://kauth.kakao.com/oauth/authorize?${params}`;
}

async function exchangeKakaoCode(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string }> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: getEnv("KAKAO_REST_API_KEY"),
    redirect_uri: redirectUri,
    code,
  });
  const clientSecret = getEnv("KAKAO_CLIENT_SECRET");
  if (clientSecret) params.set("client_secret", clientSecret);

  const res = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Kakao token exchange failed: ${await res.text()}`);
  return res.json();
}

async function getKakaoUserInfo(accessToken: string) {
  const res = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Kakao user info failed: ${await res.text()}`);
  const data: any = await res.json();
  return {
    openId: `kakao:${data.id}`,
    name: data.kakao_account?.profile?.nickname ?? data.properties?.nickname ?? null,
    email: data.kakao_account?.email ?? null,
    loginMethod: "kakao",
  };
}

// ─────────────────────────────────────────────
// 인스타그램(Facebook) OAuth
// ─────────────────────────────────────────────
function getInstagramAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getEnv("INSTAGRAM_APP_ID"),
    redirect_uri: redirectUri,
    scope: "instagram_basic,instagram_content_publish",
    response_type: "code",
    state,
  });
  return `https://api.instagram.com/oauth/authorize?${params}`;
}

async function exchangeInstagramCode(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; user_id: number }> {
  const params = new URLSearchParams({
    client_id: getEnv("INSTAGRAM_APP_ID"),
    client_secret: getEnv("INSTAGRAM_APP_SECRET"),
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Instagram token exchange failed: ${await res.text()}`);
  return res.json();
}

async function getInstagramUserInfo(accessToken: string, userId: number) {
  const res = await fetch(
    `https://graph.instagram.com/${userId}?fields=id,username&access_token=${accessToken}`,
  );
  if (!res.ok) throw new Error(`Instagram user info failed: ${await res.text()}`);
  const data: any = await res.json();
  return {
    openId: `instagram:${data.id}`,
    name: data.username ?? null,
    email: null,
    loginMethod: "instagram",
  };
}

// ─────────────────────────────────────────────
// 구글 OAuth
// ─────────────────────────────────────────────
function getGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; id_token: string }> {
  const params = new URLSearchParams({
    code,
    client_id: getEnv("GOOGLE_CLIENT_ID"),
    client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json();
}

async function getGoogleUserInfo(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google user info failed: ${await res.text()}`);
  const data: any = await res.json();
  return {
    openId: `google:${data.id}`,
    name: data.name ?? null,
    email: data.email ?? null,
    loginMethod: "google",
  };
}

// ─────────────────────────────────────────────
// 라우터 등록
// ─────────────────────────────────────────────
export function registerSocialOAuthRoutes(app: Express) {
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "";

  // ── 카카오 시작 ──────────────────────────────
  app.get("/api/oauth/kakao", (req: Request, res: Response) => {
    const kakaoKey = getEnv("KAKAO_REST_API_KEY");
    if (!kakaoKey) {
      res.status(503).json({ error: "KAKAO_REST_API_KEY not configured" });
      return;
    }
    const redirectUri = `${apiBase}/api/oauth/kakao/callback`;
    const state = req.query.state as string || "web";
    res.redirect(302, getKakaoAuthUrl(redirectUri, state));
  });

  // ── 카카오 콜백 ──────────────────────────────
  app.get("/api/oauth/kakao/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    if (!code) { res.status(400).json({ error: "code required" }); return; }

    try {
      const redirectUri = `${apiBase}/api/oauth/kakao/callback`;
      const tokenData = await exchangeKakaoCode(code, redirectUri);
      const userInfo = await getKakaoUserInfo(tokenData.access_token);
      const sessionToken = await createSocialSession(userInfo);

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // 네이티브 딥링크 콜백인 경우 JSON 응답, 웹인 경우 리다이렉트
      if (state && state.startsWith("manus")) {
        const user = await getUserByOpenId(userInfo.openId);
        res.json({ app_session_id: sessionToken, user: buildUserResponse(user) });
      } else {
        res.redirect(302, getFrontendUrl());
      }
    } catch (err) {
      console.error("[OAuth/Kakao] Callback failed", err);
      res.redirect(302, `${getFrontendUrl()}?error=kakao_failed`);
    }
  });

  // ── 인스타그램 시작 ──────────────────────────
  app.get("/api/oauth/instagram", (req: Request, res: Response) => {
    const igId = getEnv("INSTAGRAM_APP_ID");
    if (!igId) {
      res.status(503).json({ error: "INSTAGRAM_APP_ID not configured" });
      return;
    }
    const redirectUri = `${apiBase}/api/oauth/instagram/callback`;
    const state = req.query.state as string || "web";
    res.redirect(302, getInstagramAuthUrl(redirectUri, state));
  });

  // ── 인스타그램 콜백 ──────────────────────────
  app.get("/api/oauth/instagram/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    if (!code) { res.status(400).json({ error: "code required" }); return; }

    try {
      const redirectUri = `${apiBase}/api/oauth/instagram/callback`;
      const tokenData = await exchangeInstagramCode(code, redirectUri);
      const userInfo = await getInstagramUserInfo(tokenData.access_token, tokenData.user_id);
      const sessionToken = await createSocialSession(userInfo);

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      if (state && state.startsWith("manus")) {
        const user = await getUserByOpenId(userInfo.openId);
        res.json({ app_session_id: sessionToken, user: buildUserResponse(user) });
      } else {
        res.redirect(302, getFrontendUrl());
      }
    } catch (err) {
      console.error("[OAuth/Instagram] Callback failed", err);
      res.redirect(302, `${getFrontendUrl()}?error=instagram_failed`);
    }
  });

  // ── 구글 시작 ────────────────────────────────
  app.get("/api/oauth/google", (req: Request, res: Response) => {
    const googleId = getEnv("GOOGLE_CLIENT_ID");
    if (!googleId) {
      res.status(503).json({ error: "GOOGLE_CLIENT_ID not configured" });
      return;
    }
    const redirectUri = `${apiBase}/api/oauth/google/callback`;
    const state = req.query.state as string || "web";
    res.redirect(302, getGoogleAuthUrl(redirectUri, state));
  });

  // ── 구글 콜백 ────────────────────────────────
  app.get("/api/oauth/google/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    if (!code) { res.status(400).json({ error: "code required" }); return; }

    try {
      const redirectUri = `${apiBase}/api/oauth/google/callback`;
      const tokenData = await exchangeGoogleCode(code, redirectUri);
      const userInfo = await getGoogleUserInfo(tokenData.access_token);
      const sessionToken = await createSocialSession(userInfo);

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      if (state && state.startsWith("manus")) {
        const user = await getUserByOpenId(userInfo.openId);
        res.json({ app_session_id: sessionToken, user: buildUserResponse(user) });
      } else {
        res.redirect(302, getFrontendUrl());
      }
    } catch (err) {
      console.error("[OAuth/Google] Callback failed", err);
      res.redirect(302, `${getFrontendUrl()}?error=google_failed`);
    }
  });
}
