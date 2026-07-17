import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [appShell, accountScreen] = await Promise.all([
  readFile("src/components/shell/app-shell.tsx", "utf8"),
  readFile("src/components/screens/account-screen.tsx", "utf8"),
]);

for (const snippet of [
  "SafeSignOutContext",
  "attendanceSync.queue.length === 0",
  'data-testid="attendance-logout-warning-dialog"',
  'data-testid="attendance-sync-before-logout"',
  'data-testid="attendance-preserve-and-logout"',
  'document.querySelectorAll<HTMLElement>("[data-app-shell-background]")',
  'event.key === "Escape"',
  'event.key !== "Tab"',
]) {
  assert(appShell.includes(snippet), `safe sign-out flow must include ${snippet}`);
}

assert(
  (appShell.match(/onClick=\{requestSignOut\}/g) ?? []).length >= 2,
  "desktop and mobile shell logout actions must use the guarded sign-out flow",
);
assert(accountScreen.includes("useSafeSignOut()"), "account logout must use the shell sign-out guard");
assert(accountScreen.includes("onClick={requestSignOut}"), "account logout must call the guarded sign-out action");
assert(!accountScreen.includes("useAppStore"), "account logout must not bypass the shell guard through the store");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "attendance queue guard across logout entry points",
    "sync and preserve fallback actions",
    "modal focus containment and background inert state",
  ],
}, null, 2));
