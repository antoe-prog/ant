"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  BarChart3,
  Building2,
  CalendarCheck,
  ChevronDown,
  CreditCard,
  Ellipsis,
  History,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Settings2,
  Users,
  X,
  UserCircle,
  Medal,
  Trophy,
} from "lucide-react";
import type { AppRouteId } from "@/lib/roles";
import {
  getMobileSecondaryRoutes,
  getMobileVisibleRoutes,
  getRouteLabel,
  getVisibleRoutes,
  isRouteActive,
  roleLabels,
} from "@/lib/roles";
import { formatNotificationActionableLabel, getNotificationAlertCounts } from "@/lib/notification-alerts";
import { useGuardianChildSelection } from "@/hooks/use-guardian-child-selection";
import { useAppStore } from "@/store/app-store";
import { FinalWordmark } from "@/components/brand/final-wordmark";
import { GlobalSearch } from "@/components/shell/global-search";
import { RoleBadge } from "@/components/ui/primitives";

const navIcons: Record<AppRouteId, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  classes: CalendarCheck,
  members: Users,
  payments: CreditCard,
  promotions: Medal,
  tournaments: Trophy,
  notices: Bell,
  account: UserCircle,
  ownerBranches: Building2,
  ownerReports: BarChart3,
  adminBranches: Building2,
  adminUsers: Users,
  adminRoles: ShieldCheck,
  adminAuditLogs: History,
  adminSettings: Settings2,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    user,
    db,
    selectedBranchId,
    accessibleBranchIds,
    branchSelectionPending,
    operationError,
    clearOperationError,
    selectBranch,
    signOut,
  } = useAppStore();
  const pathname = usePathname();
  const mobileNavScrollRef = useRef<HTMLDivElement | null>(null);
  const activeMobileNavRef = useRef<HTMLAnchorElement | null>(null);
  const mobileAccountMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileAccountMenuToggleRef = useRef<HTMLButtonElement | null>(null);
  const [mobileAccountMenuPath, setMobileAccountMenuPath] = useState<string | null>(null);
  const guardianChildIds =
    user?.role === "guardian"
      ? db.members.filter((member) => user.childMemberIds?.includes(member.id)).map((member) => member.id)
      : undefined;
  const [selectedGuardianChildId] = useGuardianChildSelection(user?.id ?? "anonymous", guardianChildIds);

  useEffect(() => {
    if (!user) {
      return;
    }

    const scroller = mobileNavScrollRef.current;
    const activeItem = activeMobileNavRef.current;

    if (scroller && activeItem) {
      const targetLeft = activeItem.offsetLeft - (scroller.clientWidth - activeItem.clientWidth) / 2;
      scroller.scrollTo({ left: Math.max(0, targetLeft), behavior: "auto" });
    } else if (scroller) {
      scroller.scrollTo({ left: 0, behavior: "auto" });
    }

    activeMobileNavRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
  }, [pathname, user]);

  useEffect(() => {
    if (!mobileAccountMenuPath) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && !mobileAccountMenuRef.current?.contains(target)) {
        setMobileAccountMenuPath(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setMobileAccountMenuPath(null);
      mobileAccountMenuToggleRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileAccountMenuPath]);

  if (!user) {
    return children;
  }

  const routes = getVisibleRoutes(user.role);
  const mobileRoutes = getMobileVisibleRoutes(user.role, pathname);
  const mobileSecondaryRoutes = getMobileSecondaryRoutes(user.role);
  const denseMobileNav = mobileRoutes.length > 5;
  const fixedMobileNav = mobileRoutes.length <= 5;
  const branches = db.branches.filter((branch) => accessibleBranchIds.includes(branch.id));
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) ?? branches[0];
  const branchScopeLabel = selectedBranchId ? selectedBranch?.name : "전체 지점";
  const roleSwitchHref = `/select-role?next=${encodeURIComponent(pathname || "/app/dashboard")}`;
  const showMobileAccountMenu = true;
  const mobileAccountMenuOpen = mobileAccountMenuPath === pathname;
  const isAccountRoute = pathname === "/app/account" || pathname.startsWith("/app/account/");
  const mobileSecondaryRouteActive =
    isAccountRoute || mobileSecondaryRoutes.some((route) => isRouteActive(route, pathname));
  const isNotificationRoute = pathname === "/app/notifications" || pathname.startsWith("/app/notifications/");
  const mobileSecondaryGroupLabel = user.role === "member" || user.role === "guardian" ? "추가 메뉴" : "관리 메뉴";
  const notificationScopeUser =
    user.role === "guardian" && selectedGuardianChildId
      ? { ...user, childMemberIds: [selectedGuardianChildId] }
      : user;
  const notificationCounts = getNotificationAlertCounts({ db, selectedBranchId, user: notificationScopeUser });
  const notificationAlertCount = notificationCounts.actionableCount;
  const hasNotificationAlerts = notificationAlertCount > 0;
  const unreadNoticeCount = notificationCounts.unreadNoticeCount;
  const hasUnreadNotices = unreadNoticeCount > 0;
  const notificationAlertLabel = notificationAlertCount > 99 ? "99+" : `${notificationAlertCount}`;
  const unreadNoticeLabel = unreadNoticeCount > 99 ? "99+" : `${unreadNoticeCount}`;
  const notificationActionableLabel = formatNotificationActionableLabel(notificationCounts);
  const renderNotificationBadge = (
    testId = "notice-unread-badge",
    placement: "header" | "mobile" = "header",
    noticeOnly = false,
  ) => {
    const visible = noticeOnly ? hasUnreadNotices : hasNotificationAlerts;
    const countLabel = noticeOnly ? unreadNoticeLabel : notificationAlertLabel;

    return visible ? (
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border border-white bg-amber-500 px-1 text-[10px] font-bold leading-none text-white after:content-[attr(data-count)] ${
          placement === "mobile" ? "right-1 top-1" : "-right-1 -top-1"
        }`}
        data-count={countLabel}
        data-payment-alert-count={noticeOnly ? 0 : notificationCounts.paymentAlertCount}
        data-testid={testId}
        data-unread-notice-count={notificationCounts.unreadNoticeCount}
      />
    ) : null;
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950 lg:flex">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-zinc-200 bg-white lg:flex lg:flex-col">
        <div className="border-b border-zinc-200 px-5 py-5">
          <Link className="inline-flex min-h-11 items-center" href="/app/dashboard" aria-label="FINAL 대시보드로 이동">
            <FinalWordmark size="sm" ariaHidden />
          </Link>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="주요 메뉴">
          {routes.map((route) => {
            const Icon = navIcons[route.id];
            const active = isNotificationRoute && route.id === "notices" ? false : isRouteActive(route, pathname);
            const routeLabel = getRouteLabel(route, user.role);

            return (
              <Link
                className={`relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition ${
                  active ? "bg-teal-700 text-white shadow-sm" : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
                }`}
                href={route.href}
                aria-current={active ? "page" : undefined}
                key={route.id}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span>{routeLabel}</span>
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-zinc-200 p-4">
          <Link
            aria-label={`내 계정 보기: ${user.name}`}
            className="block rounded-lg border border-zinc-200 bg-zinc-50 p-3 transition hover:border-teal-200 hover:bg-teal-50"
            href="/app/account"
          >
            <p className="text-sm font-semibold text-zinc-950">{user.name}</p>
            <p className="mt-1 text-xs text-zinc-500">{user.title}</p>
            <div className="mt-3">
              <RoleBadge role={user.role} />
            </div>
          </Link>
          <button
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100"
            type="button"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            로그아웃
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur lg:pt-0">
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 sm:min-h-16 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <Link className="inline-flex min-h-11 items-center" href="/app/dashboard" aria-label="FINAL 대시보드로 이동">
                <FinalWordmark ariaHidden />
              </Link>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <GlobalSearch db={db} selectedBranchId={selectedBranchId} user={user} />
              {branches.length > 1 ? (
                <label className="relative hidden sm:block">
                  <span className="sr-only">지점 선택</span>
                  <select
                    aria-busy={branchSelectionPending}
                    className="h-11 appearance-none rounded-md border border-zinc-200 bg-white pl-3 pr-8 text-sm font-medium text-zinc-800 outline-none transition focus:border-teal-500"
                    disabled={branchSelectionPending}
                    value={selectedBranchId ?? "all"}
                    onChange={(event) => void selectBranch(event.target.value === "all" ? null : event.target.value)}
                  >
                    <option value="all">전체 지점</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-3 h-4 w-4 text-zinc-500" aria-hidden />
                </label>
              ) : (
                <span className="hidden rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 sm:inline-flex">
                  {branchScopeLabel}
                </span>
              )}
              <Link
                className={`relative inline-flex h-11 w-11 items-center justify-center rounded-md border transition ${
                  isNotificationRoute
                    ? "border-teal-700 bg-teal-700 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
                aria-label={hasNotificationAlerts ? `알림함, ${notificationActionableLabel}` : "알림함"}
                aria-current={isNotificationRoute ? "page" : undefined}
                data-testid="app-header-notice-link"
                href="/app/notifications"
              >
                <Bell className="h-4 w-4" aria-hidden />
                {renderNotificationBadge()}
              </Link>
              {showMobileAccountMenu ? (
                <div className="relative lg:hidden" ref={mobileAccountMenuRef}>
                  <button
                    aria-controls="mobile-account-menu"
                    aria-expanded={mobileAccountMenuOpen}
                    aria-label="더보기 메뉴"
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-md border transition ${
                      mobileSecondaryRouteActive
                        ? "border-teal-700 bg-teal-700 text-white"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                    }`}
                    data-testid="mobile-account-menu-toggle"
                    data-active-mobile-menu={mobileSecondaryRouteActive ? "true" : undefined}
                    ref={mobileAccountMenuToggleRef}
                    title="더보기"
                    type="button"
                    onClick={() => setMobileAccountMenuPath((current) => (current === pathname ? null : pathname))}
                  >
                    <Ellipsis className="h-5 w-5" aria-hidden />
                  </button>
                  {mobileAccountMenuOpen ? (
                    <div
                      className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-64 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl"
                      data-testid="mobile-account-menu"
                      id="mobile-account-menu"
                    >
                      <div className="border-b border-zinc-100 px-2 py-2">
                        <p className="truncate text-sm font-semibold text-zinc-950">{user.name}</p>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {roleLabels[user.role]} · {branchScopeLabel}
                        </p>
                      </div>
                      {branches.length > 1 ? (
                        <label className="grid gap-1 border-b border-zinc-100 px-2 py-2 text-xs font-semibold text-zinc-600">
                          지점 선택
                          <span className="relative">
                            <select
                              aria-busy={branchSelectionPending}
                              className="h-11 w-full appearance-none rounded-md border border-zinc-200 bg-white pl-3 pr-8 text-sm font-medium text-zinc-800 outline-none transition focus:border-teal-500"
                              data-testid="mobile-branch-selector"
                              disabled={branchSelectionPending}
                              value={selectedBranchId ?? "all"}
                              onChange={(event) => void selectBranch(event.target.value === "all" ? null : event.target.value)}
                            >
                              <option value="all">전체 지점</option>
                              {branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                  {branch.name}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2 top-3.5 h-4 w-4 text-zinc-500" aria-hidden />
                          </span>
                        </label>
                      ) : null}
                      {mobileSecondaryRoutes.length > 0 ? (
                        <div className="border-b border-zinc-100 py-1" data-testid="mobile-account-secondary-routes">
                          <p className="px-2 py-1 text-[11px] font-semibold text-zinc-500">{mobileSecondaryGroupLabel}</p>
                          {mobileSecondaryRoutes.map((route) => {
                            const Icon = navIcons[route.id];
                            const active = isRouteActive(route, pathname);

                            return (
                              <Link
                                aria-current={active ? "page" : undefined}
                                className={`flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold transition ${
                                  active ? "bg-teal-700 text-white" : "text-zinc-800 hover:bg-zinc-100"
                                }`}
                                data-testid={`mobile-account-secondary-route-${route.id}`}
                                href={route.href}
                                key={route.id}
                                onClick={() => setMobileAccountMenuPath(null)}
                              >
                                <Icon className={`h-4 w-4 ${active ? "text-white" : "text-zinc-500"}`} aria-hidden />
                                {getRouteLabel(route, user.role)}
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                      <Link
                        aria-label={`내 계정 보기: ${user.name}, ${roleLabels[user.role]}, ${branchScopeLabel}`}
                        aria-current={isAccountRoute ? "page" : undefined}
                        className={`mt-1 flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold transition ${
                          isAccountRoute ? "bg-teal-700 text-white" : "text-zinc-800 hover:bg-zinc-100"
                        }`}
                        href="/app/account"
                        onClick={() => setMobileAccountMenuPath(null)}
                      >
                        <UserCircle className={`h-4 w-4 ${isAccountRoute ? "text-white" : "text-teal-700"}`} aria-hidden />
                        내 계정
                      </Link>
                      <Link
                        className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
                        data-testid="mobile-session-role-switch"
                        href={roleSwitchHref}
                        onClick={() => setMobileAccountMenuPath(null)}
                      >
                        <Users className="h-4 w-4 text-zinc-500" aria-hidden />
                        계정 전환
                      </Link>
                      <button
                        aria-label="로그아웃"
                        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
                        data-testid="mobile-session-logout-button"
                        type="button"
                        onClick={() => {
                          setMobileAccountMenuPath(null);
                          signOut();
                        }}
                      >
                        <LogOut className="h-4 w-4 text-zinc-500" aria-hidden />
                        로그아웃
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="hidden sm:block">
                <RoleBadge role={user.role} />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 pb-[calc(6.25rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-8 lg:pb-8">
          {operationError ? (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-900" role="alert">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{operationError.title}</p>
                <p className="mt-1 text-sm leading-6 text-red-700">
                  {operationError.message}
                </p>
              </div>
              <button
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-red-700 transition hover:bg-red-100"
                type="button"
                aria-label="오류 닫기"
                onClick={clearOperationError}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
          {children}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white px-2 py-2 shadow-[0_-8px_20px_rgba(24,24,27,0.08)] lg:hidden"
          aria-label="모바일 메뉴"
          data-testid="mobile-bottom-navigation"
          style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
        >
          <div
            className={`mx-auto w-full max-w-[22.25rem] pb-1 ${
              fixedMobileNav
                ? "grid gap-1"
                : `flex snap-x overflow-x-auto scroll-px-4 [-webkit-overflow-scrolling:touch] ${denseMobileNav ? "gap-0.5" : "gap-1"}`
            }`}
            data-testid="mobile-bottom-navigation-scroller"
            ref={mobileNavScrollRef}
            style={fixedMobileNav ? { gridTemplateColumns: `repeat(${mobileRoutes.length}, minmax(0, 1fr))` } : undefined}
          >
            {mobileRoutes.map((route) => {
              const Icon = navIcons[route.id];
              const active =
                route.id === "notices" && pathname.startsWith("/app/notifications")
                  ? false
                  : isRouteActive(route, pathname);
              const routeLabel = getRouteLabel(route, user.role);
              const mobileRouteHref = route.href;
              const mobileRouteLabel = routeLabel;
              const mobileRouteAriaLabel =
                route.id === "notices" && hasUnreadNotices
                  ? `${mobileRouteLabel}, 미확인 공지 ${unreadNoticeCount}건`
                  : undefined;

              return (
                <Link
                  ref={active ? activeMobileNavRef : undefined}
                  className={`relative flex h-14 flex-col items-center justify-center gap-1 rounded-md font-semibold transition ${
                    fixedMobileNav
                      ? "min-w-0 px-0.5 text-[11px]"
                      : denseMobileNav
                        ? "min-w-12 shrink-0 snap-center px-0.5 text-[10px]"
                        : "min-w-[3.5rem] shrink-0 snap-center px-1 text-[11px]"
                  } ${
                    active ? "bg-teal-700 text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                  href={mobileRouteHref}
                  data-mobile-route-id={route.id}
                  data-active-mobile-nav={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  aria-label={mobileRouteAriaLabel}
                  key={route.id}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="block max-w-full truncate text-center leading-none">{mobileRouteLabel}</span>
                  {route.id === "notices" ? renderNotificationBadge("mobile-notice-unread-badge", "mobile", true) : null}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
