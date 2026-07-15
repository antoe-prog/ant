"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { FullPageLoading } from "@/components/ui/state-blocks";
import { canAccessPath, getRouteByPath, roleLabels } from "@/lib/roles";
import { useAppStore } from "@/store/app-store";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { hydrated, user, signOut } = useAppStore();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!hydrated || user) {
      return;
    }

    const query = window.location.search;
    const next = encodeURIComponent(`${pathname}${query}`);
    router.replace(`/login?next=${next}`);
  }, [hydrated, pathname, router, user]);

  if (!hydrated || !user) {
    return <FullPageLoading />;
  }

  if (!canAccessPath(user.role, pathname)) {
    const route = getRouteByPath(pathname);

    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-lg rounded-lg border border-amber-200 bg-white p-6 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <ShieldAlert className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-zinc-950">접근할 수 없는 화면입니다</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            이 계정으로는 {route?.label ?? "요청한 화면"} 화면에 접근할 수 없습니다.{" "}
            {route?.roles.map((role) => roleLabels[role]).join(", ")} 계정으로 전환하거나 대시보드로 돌아가세요.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
              href="/app/dashboard"
            >
              대시보드로 이동
            </Link>
            <button
              className="inline-flex min-h-11 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100"
              type="button"
              onClick={signOut}
            >
              다른 계정으로 로그인
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
