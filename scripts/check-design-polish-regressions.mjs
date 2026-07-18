import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  notificationsScreen,
  auditLogsScreen,
  promotionsScreen,
  loginScreen,
  signupScreen,
  inviteAcceptScreen,
  appShell,
] = await Promise.all([
  readFile("src/components/screens/notifications-screen.tsx", "utf8"),
  readFile("src/components/screens/admin-audit-logs-screen.tsx", "utf8"),
  readFile("src/components/screens/promotions-screen.tsx", "utf8"),
  readFile("src/components/screens/login-screen.tsx", "utf8"),
  readFile("src/components/screens/signup-screen.tsx", "utf8"),
  readFile("src/components/screens/invite-accept-screen.tsx", "utf8"),
  readFile("src/components/shell/app-shell.tsx", "utf8"),
]);

assert(
  notificationsScreen.includes('"공지 전체 읽음"') && notificationsScreen.includes('"현재 보기 읽음"'),
  "bulk read must distinguish the all-notice scope from the current filtered view",
);
assert(notificationsScreen.includes('"공지 읽음 완료"'), "bulk read completion must name its notice scope");
assert(
  notificationsScreen.includes('readNotice ? "line-clamp-1 text-zinc-600" : "line-clamp-2 text-zinc-700"'),
  "unread notice bodies must remain visible on mobile",
);
assert(notificationsScreen.includes('data-testid="notification-meta"'), "notification metadata must expose a stable test hook");
assert(!notificationsScreen.includes('data-testid="notification-bottom-safe-area"'), "notification inbox must not duplicate shell bottom spacing");

assert(
  auditLogsScreen.includes('className="mt-3 flex flex-wrap gap-1.5"'),
  "active audit filters must wrap instead of clipping horizontally",
);
assert(promotionsScreen.includes('data-testid="promotion-member-search"'), "promotion member selection must provide search");
assert(promotionsScreen.includes("filteredSelectableMembers.map"), "promotion member options must follow the search result");

for (const [name, source] of [
  ["login", loginScreen],
  ["signup", signupScreen],
  ["invite", inviteAcceptScreen],
]) {
  assert(source.includes("text-zinc-600"), `${name} password visibility control must keep sufficient icon contrast`);
  assert(!source.includes("rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"), `${name} must not restore the low-contrast password icon`);
}

assert(appShell.includes('aria-current={isAccountRoute ? "page" : undefined}'), "desktop account entry must expose its active state");
assert(appShell.includes('? "min-w-0 px-0.5 text-xs"'), "fixed mobile navigation labels must use readable text sizing");
assert(appShell.includes('? "min-w-12 shrink-0 snap-center px-0.5 text-[11px]"'), "dense mobile navigation labels must not fall below 11px");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "notification mobile readability and spacing",
    "audit filter wrapping",
    "promotion member search",
    "password control contrast",
    "account and mobile navigation state",
  ],
}, null, 2));
