import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appShell = fs.readFileSync(path.join(root, "src/components/shell/app-shell.tsx"), "utf8");
const dashboardScreen = fs.readFileSync(path.join(root, "src/components/screens/dashboard-screen.tsx"), "utf8");

assert(
  appShell.includes('const usesMobileMenuNavigation = user.role === "member" || user.role === "guardian"'),
  "member and guardian roles must use the mobile header menu",
);
assert(
  appShell.includes("const mobileMenuRoutes = usesMobileMenuNavigation") &&
    appShell.includes("[...mobileRoutes, ...mobileSecondaryRoutes]"),
  "family mobile header menu must include primary and secondary destinations",
);
assert(
  appShell.includes("const showMobileBottomNavigation = !usesMobileMenuNavigation") &&
    appShell.includes("{showMobileBottomNavigation ? ("),
  "family roles must not duplicate destinations in a bottom navigation",
);
assert(
  appShell.includes('data-testid={`mobile-account-secondary-route-${route.id}`}') &&
    appShell.includes("mobileMenuRoutes.map((route)"),
  "combined family destinations must render as accessible header menu links",
);
assert(
  appShell.includes("const hideFamilyMobileContext =") &&
    appShell.includes('["/app/dashboard", "/app/classes", "/app/members", "/app/payments", "/app/promotions", "/app/tournaments"].includes(pathname)') &&
    appShell.includes("const visibleMobileContextLabel = hideFamilyMobileContext ? null : mobileContextLabel"),
  "family primary screens must not repeat role and route labels below the mobile header",
);
assert(
  dashboardScreen.includes('data-testid="dashboard-updates"') &&
    dashboardScreen.includes('data-testid="dashboard-update-notice-list"') &&
    dashboardScreen.includes('data-testid="dashboard-update-tournament-list"'),
  "dashboards must render notice and tournament update regions",
);
assert(
  dashboardScreen.includes("isNoticeRelevantToMember") &&
    dashboardScreen.includes("canViewTournament") &&
    dashboardScreen.includes(".slice(0, 3)"),
  "dashboard updates must be scoped to the selected profile and remain concise",
);
assert.equal(
  (dashboardScreen.match(/<DashboardUpdates/g) ?? []).length,
  4,
  "guardian, member, owner, and admin/coach dashboards must render the shared update cards",
);
assert(
  dashboardScreen.includes('noticeHref="/app/notices"') &&
    !dashboardScreen.includes(">공지와 대회 일정</h2>") &&
    !dashboardScreen.includes("도장에서 전달한 최신 소식"),
  "staff updates must link to notice management without the redundant group heading",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "family header menu consolidation",
        "family bottom navigation removal",
        "profile-scoped notice list",
        "branch-scoped upcoming tournament list",
        "staff dashboard update cards",
      ],
    },
    null,
    2,
  ),
);
