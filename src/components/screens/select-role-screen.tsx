"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, LoaderCircle, UsersRound } from "lucide-react";
import { getDefaultRoute, roleLabels } from "@/lib/roles";
import type { UserRole } from "@/lib/domain";
import { useAppStore } from "@/store/app-store";
import { Button, RoleBadge } from "@/components/ui/primitives";
import { FinalWordmark } from "@/components/brand/final-wordmark";

const selectableRoles: UserRole[] = ["owner", "coach", "guardian", "member", "admin"];

export function SelectRoleScreen() {
  const router = useRouter();
  const { hydrated, user, signIn, signOut, authPending, authError } = useAppStore();
  const showRoleShortcuts = process.env.NODE_ENV !== "production";

  async function handleRoleSelect(role: UserRole) {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");

    if (user?.role === role) {
      router.replace(next ?? getDefaultRoute(role));
      return;
    }

    const ok = await signIn(role);

    if (ok) {
      router.replace(next ?? getDefaultRoute(role));
    }
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl flex-col justify-start gap-5 pt-6 sm:pt-10">
        <div>
          <FinalWordmark />
        </div>

        <section className="w-full rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 border-b border-zinc-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                <UsersRound className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-semibold text-teal-700">계정 변경</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">계정 전환</h1>
              </div>
            </div>
            {hydrated && user ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold text-zinc-500">현재 세션</p>
                <p className="mt-1 text-sm font-semibold text-zinc-950">{user.name}</p>
                <div className="mt-2">
                  <RoleBadge role={user.role} />
                </div>
              </div>
            ) : null}
          </div>

          {authError ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
              {authError}
            </p>
          ) : null}

          {showRoleShortcuts ? (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {selectableRoles.map((role) => {
                const active = user?.role === role;

                return (
                  <button
                    className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      active ? "border-teal-300 bg-teal-50" : "border-zinc-200 bg-white hover:border-teal-300 hover:bg-teal-50"
                    }`}
                    disabled={authPending || !hydrated}
                    key={role}
                    type="button"
                    onClick={() => void handleRoleSelect(role)}
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-zinc-950">
                        {roleLabels[role]}
                        {active ? " 유지" : " 선택"}
                      </span>
                    </span>
                    {authPending ? (
                      <LoaderCircle className="mt-1 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    ) : active ? (
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-teal-700" aria-hidden />
                    ) : (
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-4">
              <p className="text-sm font-semibold text-zinc-950">휴대폰 번호 로그인으로 계정을 변경합니다.</p>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                다른 계정을 사용하려면 현재 세션을 종료한 뒤 로그인 화면에서 휴대폰 번호와 비밀번호를 입력해 주세요.
              </p>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-100 pt-5">
            {user ? (
              <Button variant="secondary" onClick={signOut}>
                로그아웃
              </Button>
            ) : null}
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50"
              href="/login"
            >
              로그인 화면
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
