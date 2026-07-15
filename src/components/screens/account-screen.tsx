"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, LogOut, MapPin, Repeat2, ShieldCheck, UserCircle } from "lucide-react";
import { useApiContext } from "@/hooks/use-api-context";
import { formatPhoneNumber } from "@/lib/format";
import { roleLabels } from "@/lib/roles";
import { getVisibleUserEmail } from "@/lib/user-display";
import { useAppStore } from "@/store/app-store";
import { InstallAppAction } from "@/components/pwa/install-app-action";
import { SectionHeader, RoleBadge } from "@/components/ui/primitives";

export function AccountScreen() {
  const context = useApiContext();
  const pathname = usePathname();
  const { signOut } = useAppStore();
  const branches = context.user.role === "admin"
    ? context.db.branches
    : context.db.branches.filter((branch) => context.user.branchIds.includes(branch.id));
  const branchScopeLabel =
    branches.length === 0
      ? "지점 미배정"
      : branches.length === 1
        ? branches[0].name
        : context.user.role === "admin"
          ? "전체 지점"
          : `${branches.length}개 지점`;
  const displayEmail = getVisibleUserEmail(context.user.email);
  const displayPhone = context.user.phone ? formatPhoneNumber(context.user.phone) : null;
  const showAccountStatus = context.user.invitationStatus === "pending";
  const accountStatusLabel = showAccountStatus ? "초대 대기" : null;
  const accountMetaGridClassName = showAccountStatus ? "mt-4 grid grid-cols-3 gap-2" : "mt-4 grid grid-cols-2 gap-2";
  const roleSwitchHref = `/select-role?next=${encodeURIComponent(pathname || "/app/dashboard")}`;

  return (
    <div>
      <SectionHeader title="내 계정" />

      <section className="rounded-lg border border-zinc-200 bg-white p-4" data-testid="account-summary-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <UserCircle className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-950">{context.user.name}</h2>
              <p className="mt-1 text-sm text-zinc-600">{context.user.title}</p>
              {displayPhone ? <p className="mt-1 text-sm font-semibold text-zinc-700">{displayPhone}</p> : null}
              {displayEmail ? <p className="mt-1 text-sm text-zinc-500">{displayEmail}</p> : null}
            </div>
          </div>
          <RoleBadge role={context.user.role} />
        </div>

        <div className={accountMetaGridClassName} data-testid="account-summary-grid">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3">
            <div className="flex items-center gap-1.5 text-teal-700">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              <p className="text-xs font-semibold">유형</p>
            </div>
            <p className="mt-2 break-words text-sm font-semibold text-zinc-950">{roleLabels[context.user.role]}</p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3">
            <div className="flex items-center gap-1.5 text-teal-700">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              <p className="text-xs font-semibold">지점</p>
            </div>
            <p className="mt-2 break-words text-sm font-semibold text-zinc-950">{branchScopeLabel}</p>
          </div>
          {showAccountStatus ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3" data-testid="account-status-card">
              <div className="flex items-center gap-1.5 text-amber-700">
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
                <p className="text-xs font-semibold">상태</p>
              </div>
              <p className="mt-2 break-words text-sm font-semibold text-zinc-950">{accountStatusLabel}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-3 grid grid-cols-2 gap-2" aria-label="계정 작업" data-testid="account-action-panel">
          <Link
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
            data-testid="account-role-switch-link"
            href={roleSwitchHref}
          >
            <Repeat2 className="h-4 w-4" aria-hidden />
            계정 전환
          </Link>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
            data-testid="account-logout-button"
            type="button"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            로그아웃
          </button>
      </section>

      <section className="mt-4">
        <InstallAppAction />
      </section>

      {branches.length > 1 ? (
      <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-teal-700" aria-hidden />
          <h2 className="text-base font-semibold text-zinc-950">이용 지점</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {branches.map((branch) => (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3" key={branch.id}>
              <p className="text-sm font-semibold text-zinc-950">{branch.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{branch.district}</p>
            </div>
          ))}
        </div>
      </section>
      ) : null}
    </div>
  );
}
