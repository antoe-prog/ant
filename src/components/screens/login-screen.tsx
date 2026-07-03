"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { getDefaultRoute, roleLabels } from "@/lib/roles";
import type { UserRole } from "@/lib/domain";
import { useAppStore } from "@/store/app-store";
import { FinalWordmark } from "@/components/brand/final-wordmark";

const localShortcutRoles: UserRole[] = ["owner", "coach", "guardian", "member", "admin"];
const localAutoLoginHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function getSafeNextPath(params: URLSearchParams, fallback: string) {
  const next = params.get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return fallback;
  }

  return next;
}

function subscribeLocationSearch() {
  return () => undefined;
}

function getLocationSearch() {
  return window.location.search;
}

function getServerLocationSearch() {
  return "";
}

function normalizePhoneQuery(value: string) {
  return value.replace(/[^\d]/g, "").slice(0, 11);
}

export function LoginScreen({ initialRole = null }: { initialRole?: UserRole | null }) {
  const router = useRouter();
  const { hydrated, user, signIn, signOut, authPending, authError } = useAppStore();
  const requestedRole = initialRole;
  const [manualPhone, setManualPhone] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const autoLoginAttempted = useRef(false);
  const locationSearch = useSyncExternalStore(subscribeLocationSearch, getLocationSearch, getServerLocationSearch);
  const locationParams = new URLSearchParams(locationSearch);
  const registered = locationParams.get("registered") === "1";
  const registeredPhone = normalizePhoneQuery(locationParams.get("phone") ?? "");
  const phone = manualPhone ?? registeredPhone;
  const showLocalShortcuts =
    hydrated &&
    typeof window !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    localAutoLoginHosts.has(window.location.hostname) &&
    new URLSearchParams(window.location.search).get("quickLogin") === "1";
  const visibleRoles = requestedRole ? [requestedRole] : localShortcutRoles;
  const loginTitle = requestedRole ? `${roleLabels[requestedRole]} 계정 로그인` : "파이널 로그인";

  useEffect(() => {
    const isLocalAutoLoginHost = localAutoLoginHosts.has(window.location.hostname);

    if (
      !requestedRole ||
      !hydrated ||
      autoLoginAttempted.current ||
      (process.env.NODE_ENV === "production" && !isLocalAutoLoginHost)
    ) {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    if (params.get("autoLogin") !== "1") {
      return;
    }

    autoLoginAttempted.current = true;
    const nextPath = getSafeNextPath(params, getDefaultRoute(requestedRole));

    if (user?.role === requestedRole) {
      router.replace(nextPath);
      return;
    }

    void (async () => {
      const ok = await signIn(requestedRole);

      if (ok) {
        router.replace(nextPath);
      }
    })();
  }, [hydrated, requestedRole, router, signIn, user?.role]);

  async function handleLogin(role: UserRole) {
    const ok = await signIn(role);

    if (!ok) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    router.replace(getSafeNextPath(params, getDefaultRoute(role)));
  }

  async function handleCredentialLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const ok = await signIn({ phone, password, keepSignedIn });

    if (!ok) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const nextPath = getSafeNextPath(params, "/app/dashboard");
    router.replace(nextPath);
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-start gap-5 pt-6 sm:pt-10">
        <div>
          <FinalWordmark />
        </div>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">{loginTitle}</h2>
            </div>
          </div>

          {registered ? (
            <p className="mt-4 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700" role="status">
              회원가입이 완료되었습니다. 휴대폰 번호와 비밀번호로 로그인해 주세요.
            </p>
          ) : null}

          {authError ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
              {authError}
            </p>
          ) : null}

          {user ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p className="font-semibold">현재 {roleLabels[user.role]} 계정으로 로그인되어 있습니다.</p>
              <p className="mt-1 text-xs leading-5">
                다른 역할을 보려면 아래 계정으로 다시 로그인하거나 로그아웃 후 새 계정을 선택하세요.
              </p>
              <button
                className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
                type="button"
                onClick={signOut}
              >
                로그아웃하고 계정 전환
              </button>
            </div>
          ) : null}

          <form className="mt-5 grid gap-3" onSubmit={handleCredentialLogin}>
            <label className="grid gap-1 text-sm font-semibold text-zinc-800">
              휴대폰 번호
              <input
                className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                autoComplete="tel"
                inputMode="tel"
                placeholder="휴대폰 번호 입력"
                required
                type="tel"
                value={phone}
                onChange={(event) => setManualPhone(event.target.value)}
              />
            </label>
            <div className="grid gap-1 text-sm font-semibold text-zinc-800">
              <label htmlFor="login-password-input">비밀번호</label>
              <span className="relative block">
                <input
                  className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 pr-11 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  autoComplete="current-password"
                  id="login-password-input"
                  placeholder="비밀번호"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                  data-testid="login-password-visibility-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </span>
            </div>
            <label className="flex min-h-11 items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm font-medium text-zinc-800">
              <input
                checked={keepSignedIn}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-teal-700 focus:ring-teal-500"
                data-testid="login-keep-signed-in-checkbox"
                type="checkbox"
                onChange={(event) => setKeepSignedIn(event.target.checked)}
              />
              <span className="grid gap-0.5 leading-5">
                <span className="font-semibold text-zinc-900">로그인 상태 유지</span>
                <span className="text-xs text-zinc-500">30일 동안 다시 로그인하지 않습니다.</span>
              </span>
            </label>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={authPending}
              type="submit"
            >
              {authPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              로그인
            </button>
          </form>

          {showLocalShortcuts ? (
            <>
              <div className="mt-5 border-t border-zinc-100 pt-5">
                <p className="text-xs font-semibold uppercase text-zinc-500">역할 바로 시작</p>
              </div>

              <div className="mt-3 grid gap-2">
                {visibleRoles.map((role) => (
                  <button
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-left transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={authPending}
                    key={role}
                    type="button"
                    onClick={() => void handleLogin(role)}
                  >
                    <span className="min-w-0 break-words text-sm font-semibold text-zinc-950">{roleLabels[role]}로 시작</span>
                    {authPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <Link className="text-sm font-semibold text-teal-700 hover:text-teal-800" data-testid="login-signup-link" href="/signup">
              회원가입
            </Link>
            <Link className="text-sm font-semibold text-teal-700 hover:text-teal-800" href="/reset-password">
              비밀번호 재설정 요청
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
