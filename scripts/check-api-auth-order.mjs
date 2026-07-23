import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const apiRoot = path.join("src", "app", "api", "v1");
const bootstrapRoutePath = path.join(apiRoot, "me", "bootstrap", "route.ts");
const deletedRequestRoutePaths = [
  path.join(apiRoot, "requests", "route.ts"),
  path.join(apiRoot, "requests", "[requestId]", "approve", "route.ts"),
  path.join(apiRoot, "requests", "[requestId]", "reject", "route.ts"),
];
const branchClassRoutePath = path.join(apiRoot, "branches", "[branchId]", "classes", "route.ts");
const classRoutePath = path.join(apiRoot, "classes", "[classId]", "route.ts");
const attendanceRoutePath = path.join(apiRoot, "class-sessions", "[sessionId]", "attendance", "route.ts");
const attendanceReasonRoutePath = path.join(
  apiRoot,
  "class-sessions",
  "[sessionId]",
  "attendance",
  "[memberId]",
  "reason",
  "route.ts",
);
const branchPaymentRoutePath = path.join(apiRoot, "branches", "[branchId]", "payments", "route.ts");
const paymentManageRoutePath = path.join(apiRoot, "payments", "[paymentId]", "route.ts");
const paymentRefundRoutePath = path.join(apiRoot, "payments", "[paymentId]", "refund", "route.ts");
const onlineCheckoutRoutePath = path.join(apiRoot, "payments", "[paymentId]", "online-checkout", "route.ts");
const collectionRequestRoutePath = path.join(apiRoot, "payments", "[paymentId]", "collection-request", "route.ts");
const recurringAgreementRoutePath = path.join(apiRoot, "payments", "[paymentId]", "recurring-agreement", "route.ts");
const branchMemberRoutePath = path.join(apiRoot, "branches", "[branchId]", "members", "route.ts");
const memberRoutePath = path.join(apiRoot, "members", "[memberId]", "route.ts");
const guardianLinkRoutePath = path.join(apiRoot, "members", "[memberId]", "guardians", "route.ts");
const counselingNoteRoutePath = path.join(
  apiRoot,
  "branches",
  "[branchId]",
  "members",
  "[memberId]",
  "counseling-notes",
  "route.ts",
);
const counselingNoteMutationRoutePath = path.join(
  apiRoot,
  "branches",
  "[branchId]",
  "members",
  "[memberId]",
  "counseling-notes",
  "[noteId]",
  "route.ts",
);
const branchNoticeRoutePath = path.join(apiRoot, "branches", "[branchId]", "notices", "route.ts");
const noticePushRoutePath = path.join(apiRoot, "branches", "[branchId]", "notices", "[noticeId]", "push", "route.ts");
const adminBranchRoutePath = path.join(apiRoot, "admin", "branches", "route.ts");
const adminBranchUpdateRoutePath = path.join(apiRoot, "admin", "branches", "[branchId]", "route.ts");
const adminBranchOwnerRoutePath = path.join(apiRoot, "admin", "branches", "[branchId]", "owner", "route.ts");
const adminInvitationRoutePath = path.join(apiRoot, "admin", "users", "invitations", "route.ts");
const adminUserRoutePath = path.join(apiRoot, "admin", "users", "[userId]", "route.ts");
const adminUserInvitationApproveRoutePath = path.join(apiRoot, "admin", "users", "[userId]", "approve-invitation", "route.ts");
const adminUserInvitationLinkRoutePath = path.join(apiRoot, "admin", "users", "[userId]", "invitation-link", "route.ts");
const adminUserRoleRoutePath = path.join(apiRoot, "admin", "users", "[userId]", "roles", "route.ts");
const adminUserPasswordRoutePath = path.join(apiRoot, "admin", "users", "[userId]", "password", "route.ts");
const adminPilotReadinessRoutePath = path.join(apiRoot, "admin", "pilot-readiness", "route.ts");
const adminPilotIncidentRoutePath = path.join(apiRoot, "admin", "pilot-incidents", "route.ts");
const adminPilotIncidentUpdateRoutePath = path.join(apiRoot, "admin", "pilot-incidents", "[incidentId]", "route.ts");
const adminPilotOperationRoutePath = path.join(apiRoot, "admin", "pilot-operations", "route.ts");
const publicBodyRoutes = new Set([
  path.join(apiRoot, "auth", "invitations", "[token]", "accept", "route.ts"),
  path.join(apiRoot, "auth", "login", "route.ts"),
  path.join(apiRoot, "auth", "password-reset", "route.ts"),
  path.join(apiRoot, "auth", "register", "route.ts"),
  path.join(apiRoot, "payments", "webhook", "route.ts"),
]);

function listRouteFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listRouteFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name === "route.ts") {
      files.push(fullPath);
    }
  }

  return files;
}

function lineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function hasSelectedBranchScopeGuard(content) {
  return /requireSelectedBranchScope\(request,\s*(?:user|latestSession\.user),\s*(?:db|latestDb)\)/.test(content);
}

function getAsyncFunctions(content) {
  const matches = [...content.matchAll(/(export\s+)?async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? content.length;

    return {
      exported: Boolean(match[1]),
      name: match[2],
      source: content.slice(start, end),
      start,
    };
  });
}

function getExportedHandlers(content) {
  const functions = getAsyncFunctions(content);

  return functions
    .filter(
      (candidate) =>
        candidate.exported && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(candidate.name),
    )
    .map((handler) => {
      const delegatedName = handler.source.match(
        /withServerDbLock\([^,]+,\s*\(\)\s*=>\s*([A-Za-z_$][\w$]*)\(request,\s*context\)\)/,
      )?.[1];
      const delegatedHandler = delegatedName
        ? functions.find((candidate) => !candidate.exported && candidate.name === delegatedName)
        : null;

      return {
        method: handler.name,
        source: delegatedHandler ? `${handler.source}\n${delegatedHandler.source}` : handler.source,
        start: handler.start,
      };
    });
}

const routeFiles = listRouteFiles(apiRoot).sort();
const bootstrapRouteSource = readFileSync(bootstrapRoutePath, "utf8");
const operationalMutationRouteSources = [
  branchClassRoutePath,
  classRoutePath,
  attendanceRoutePath,
  attendanceReasonRoutePath,
  branchPaymentRoutePath,
  paymentManageRoutePath,
  paymentRefundRoutePath,
  onlineCheckoutRoutePath,
  collectionRequestRoutePath,
  recurringAgreementRoutePath,
].map((routePath) => [routePath, readFileSync(routePath, "utf8")]);
const memberNoticeMutationRouteSources = [
  branchMemberRoutePath,
  memberRoutePath,
  guardianLinkRoutePath,
  counselingNoteRoutePath,
  branchNoticeRoutePath,
  noticePushRoutePath,
].map((routePath) => [routePath, readFileSync(routePath, "utf8")]);
const adminMutationRouteSources = [
  adminBranchRoutePath,
  adminBranchUpdateRoutePath,
  adminBranchOwnerRoutePath,
  adminInvitationRoutePath,
  adminUserRoutePath,
  adminUserInvitationApproveRoutePath,
  adminUserInvitationLinkRoutePath,
  adminUserRoleRoutePath,
  adminUserPasswordRoutePath,
  adminPilotReadinessRoutePath,
  adminPilotIncidentRoutePath,
  adminPilotIncidentUpdateRoutePath,
  adminPilotOperationRoutePath,
].map((routePath) => [routePath, readFileSync(routePath, "utf8")]);
const violations = [];
const checkedProtectedHandlers = [];
const allowedPublicHandlers = [];

for (const routeFile of routeFiles) {
  const content = readFileSync(routeFile, "utf8");
  const routeIsPublicBody = publicBodyRoutes.has(routeFile);

  for (const handler of getExportedHandlers(content)) {
    const firstBodyRead = handler.source.indexOf("request.json()");

    if (firstBodyRead === -1) {
      continue;
    }

    if (routeIsPublicBody) {
      allowedPublicHandlers.push(`${routeFile} ${handler.method}`);
      continue;
    }

    const authGuardIndexes = [
      handler.source.indexOf("requireSession("),
      handler.source.indexOf("requireManualPaymentRequestContext("),
      handler.source.indexOf("requireRefundRequestContext("),
      handler.source.indexOf("requireCollectionRequestContext("),
      handler.source.indexOf("requireGuardianLinkRequestContext("),
      handler.source.indexOf("requireBranchCreateRequestContext("),
      handler.source.indexOf("requireBranchUpdateRequestContext("),
      handler.source.indexOf("requireBranchOwnerRequestContext("),
    ].filter((index) => index >= 0);

    if (authGuardIndexes.length === 0) {
      violations.push({
        file: routeFile,
        line: lineNumber(content, handler.start + firstBodyRead),
        method: handler.method,
        reason: "request body is read in a non-public API handler without an approved session guard",
      });
      continue;
    }

    if (firstBodyRead < Math.min(...authGuardIndexes)) {
      violations.push({
        file: routeFile,
        line: lineNumber(content, handler.start + firstBodyRead),
        method: handler.method,
        reason: "request body is read before the approved session guard",
      });
      continue;
    }

    checkedProtectedHandlers.push(`${routeFile} ${handler.method}`);
  }
}

if (violations.length > 0) {
  console.error(JSON.stringify({ ok: false, violations }, null, 2));
  process.exit(1);
}

assert(checkedProtectedHandlers.length > 0, "expected at least one protected body-reading API handler");
assert(allowedPublicHandlers.length === publicBodyRoutes.size, "public body route allowlist should match discovered handlers");
assert(
  bootstrapRouteSource.includes("requireSelectedBranchScope(request, user, db)"),
  "bootstrap route must reject invalid selectedBranchId before returning a scoped snapshot",
);
const paymentManageRouteSource = readFileSync(paymentManageRoutePath, "utf8");
assert(
  paymentManageRouteSource.includes("async function requireManualPaymentRequestContext") &&
    paymentManageRouteSource.includes("requireSession(request, db)"),
  "manual payment management helper must authenticate before returning payment context",
);
const paymentRefundRouteSource = readFileSync(paymentRefundRoutePath, "utf8");
assert(
  paymentRefundRouteSource.includes("async function requireRefundRequestContext") &&
    paymentRefundRouteSource.includes("requireSession(request, db)"),
  "payment refund helper must authenticate before returning payment context",
);
const collectionRequestRouteSource = readFileSync(collectionRequestRoutePath, "utf8");
assert(
  collectionRequestRouteSource.includes("async function requireCollectionRequestContext") &&
    collectionRequestRouteSource.includes("requireSession(request, db)"),
  "family collection request helper must authenticate before returning payment context",
);
const guardianLinkRouteSource = readFileSync(guardianLinkRoutePath, "utf8");
assert(
  guardianLinkRouteSource.includes("async function requireGuardianLinkRequestContext") &&
    guardianLinkRouteSource.includes("requireSession(request, db)"),
  "guardian link request helper must authenticate before returning member context",
);
for (const [routePath, helperName] of [
  [adminBranchRoutePath, "requireBranchCreateRequestContext"],
  [adminBranchUpdateRoutePath, "requireBranchUpdateRequestContext"],
  [adminBranchOwnerRoutePath, "requireBranchOwnerRequestContext"],
]) {
  const routeSource = readFileSync(routePath, "utf8");

  assert(
    routeSource.includes(`async function ${helperName}`) && routeSource.includes("requireSession(request, db)"),
    `${routePath} must authenticate in ${helperName} before returning branch context`,
  );
  assert(
    routeSource.indexOf("request.json()") < routeSource.indexOf("withServerDbLock(branchManagementStateLockKey"),
    `${routePath} must parse and validate its request body before taking the shared branch lock`,
  );
}
const branchInputPolicySource = readFileSync("src/lib/branch-input-policy.ts", "utf8");
const adminBranchesScreenSource = readFileSync("src/components/screens/admin-branches-screen.tsx", "utf8");
const branchSmokeApiSource = readFileSync("scripts/smoke-api.mjs", "utf8");
for (const expectedLimit of [
  "districtLength: 100",
  "nameLength: 80",
  "reasonLength: 500",
  "timezoneLength: 64",
  "userIdLength: 200",
]) {
  assert(branchInputPolicySource.includes(expectedLimit), `branch input policy must keep ${expectedLimit}`);
}
for (const expectedUiLimit of [
  "maxLength={branchInputLimits.nameLength}",
  "maxLength={branchInputLimits.districtLength}",
  "maxLength={branchInputLimits.reasonLength}",
]) {
  assert(adminBranchesScreenSource.includes(expectedUiLimit), `admin branch forms must keep ${expectedUiLimit}`);
}
for (const expectedSmokeCoverage of [
  "oversized branch create values must be rejected",
  "oversized branch update values must be rejected",
  "oversized branch owner values must be rejected",
  "slow body parsing must not hold the shared branch lock",
]) {
  assert(branchSmokeApiSource.includes(expectedSmokeCoverage), `smoke API must cover ${expectedSmokeCoverage}`);
}
assert(
  readFileSync("scripts/smoke-api.mjs", "utf8").includes("/api/v1/me/bootstrap?selectedBranchId=branch-missing"),
  "smoke API must cover invalid selectedBranchId on bootstrap",
);
for (const routePath of deletedRequestRoutePaths) {
  assert(!existsSync(routePath), `${routePath} must stay deleted`);
}
assert(
  !readFileSync("scripts/smoke-api.mjs", "utf8").includes("/api/v1/requests?selectedBranchId=branch-missing"),
  "smoke API must not keep deleted request selectedBranchId coverage",
);
for (const [routePath, routeSource] of operationalMutationRouteSources) {
  assert(
    hasSelectedBranchScopeGuard(routeSource),
    `${routePath} must reject invalid selectedBranchId before returning operational scoped data`,
  );
}
const smokeApiSource = readFileSync("scripts/smoke-api.mjs", "utf8");
for (const expected of [
  "/api/v1/class-sessions/class-kids-am/attendance?selectedBranchId=branch-missing",
  "/api/v1/class-sessions/class-kids-am/attendance/member-jun/reason?selectedBranchId=branch-missing",
  "/api/v1/branches/branch-gangnam/classes?selectedBranchId=branch-missing",
  "/api/v1/branches/branch-gangnam/payments?selectedBranchId=branch-missing",
  "/refund?selectedBranchId=branch-missing",
  "/online-checkout?selectedBranchId=branch-missing",
  "/recurring-agreement?selectedBranchId=branch-missing",
]) {
  assert(smokeApiSource.includes(expected), `smoke API must cover invalid selectedBranchId for ${expected}`);
}
for (const [routePath, routeSource] of memberNoticeMutationRouteSources) {
  assert(
    hasSelectedBranchScopeGuard(routeSource),
    `${routePath} must reject invalid selectedBranchId before returning member/notice scoped data`,
  );
}
for (const routePath of [
  branchClassRoutePath,
  classRoutePath,
  branchPaymentRoutePath,
  paymentManageRoutePath,
  paymentRefundRoutePath,
  onlineCheckoutRoutePath,
  collectionRequestRoutePath,
  recurringAgreementRoutePath,
  branchMemberRoutePath,
  memberRoutePath,
  guardianLinkRoutePath,
  counselingNoteRoutePath,
  counselingNoteMutationRoutePath,
]) {
  const routeSource = readFileSync(routePath, "utf8");

  assert(
    routeSource.includes("selectedScope.selectedBranchId !== branchId") ||
      routeSource.includes("selectedScope.selectedBranchId !== member.branchId") ||
      routeSource.includes("selectedScope.selectedBranchId !== existing.branchId") ||
      routeSource.includes("selectedScope.selectedBranchId !== payment.branchId") ||
      routeSource.includes("!selectedScope.branchIds.includes(payment.branchId)"),
    `${routePath} must reject selectedBranchId mismatches before reading the request body or mutating scoped data`,
  );
}
for (const expected of [
  "/api/v1/branches/branch-gangnam/members?selectedBranchId=branch-missing",
  "/api/v1/members/member-minjae?selectedBranchId=branch-missing",
  "/guardians?selectedBranchId=branch-missing",
  "/api/v1/branches/branch-gangnam/members/member-jun/counseling-notes?selectedBranchId=branch-missing",
  "/api/v1/branches/branch-gangnam/notices?selectedBranchId=branch-missing",
  "/push?selectedBranchId=branch-missing",
]) {
  assert(smokeApiSource.includes(expected), `smoke API must cover invalid selectedBranchId for ${expected}`);
}
for (const expected of [
  "member create must reject a selected branch mismatch before validation",
  "selected branch mismatch must not create the member",
  "class create must reject a selected branch mismatch before validation",
  "selected branch mismatch must not create the class",
  "payment create must reject a selected branch mismatch before validation",
  "selected branch mismatch must not create the payment",
  "manual payment update must reject an invalid selected branch before validation",
  "manual payment update must reject a selected branch mismatch before validation",
  "counseling note create must reject a selected branch mismatch before validation",
  "selected branch mismatch must not create the counseling note",
  "member update must reject a selected branch mismatch before validation",
  "selected branch mismatch must not update the member",
  "guardian link must reject a selected branch mismatch before validation",
  "selected branch mismatch must not link the guardian",
  "class update must reject a selected branch mismatch before validation",
  "selected branch mismatch must not update the class",
  "payment refund must reject a selected branch mismatch before validation",
  "selected branch mismatch must not refund the payment",
  "online checkout must reject a selected branch mismatch before provider preparation",
  "selected branch mismatch must not create an online checkout",
  "recurring agreement create must reject a selected branch mismatch before validation",
  "selected branch mismatch must not create a recurring agreement",
  "recurring agreement cancel must reject a selected branch mismatch before validation",
  "selected branch mismatch must not cancel the recurring agreement",
]) {
  assert(smokeApiSource.includes(expected), `smoke API must cover selectedBranchId mismatch guard for ${expected}`);
}
for (const [routePath, routeSource] of adminMutationRouteSources) {
  assert(
    hasSelectedBranchScopeGuard(routeSource),
    `${routePath} must reject invalid selectedBranchId before returning admin scoped data`,
  );
}
for (const [routePath, expectedGuard] of [
  [adminBranchUpdateRoutePath, "selectedScope.selectedBranchId !== branchId"],
  [adminBranchOwnerRoutePath, "selectedScope.selectedBranchId !== branchId"],
  [adminInvitationRoutePath, "branchIds.some((branchId) => branchId !== selectedScope.selectedBranchId)"],
  [adminUserInvitationApproveRoutePath, "!targetUser.branchIds.includes(selectedScope.selectedBranchId)"],
  [adminUserInvitationLinkRoutePath, "!targetUser.branchIds.includes(selectedScope.selectedBranchId)"],
  [adminUserPasswordRoutePath, "!targetUser.branchIds.includes(selectedScope.selectedBranchId)"],
  [adminUserRoleRoutePath, "!targetUser.branchIds.includes(selectedScope.selectedBranchId)"],
]) {
  assert(
    readFileSync(routePath, "utf8").includes(expectedGuard),
    `${routePath} must reject selectedBranchId mismatches before mutating admin scoped data`,
  );
}
const adminUserRouteSource = readFileSync(adminUserRoutePath, "utf8");
assert(
  adminUserRouteSource.includes("!targetUser.branchIds.includes(selectedScope.selectedBranchId)") &&
    adminUserRouteSource.includes("!nextBranchIds.includes(selectedScope.selectedBranchId)"),
  `${adminUserRoutePath} must reject selectedBranchId mismatches for target lookup and branch reassignment`,
);
for (const expected of [
  "/api/v1/admin/branches?selectedBranchId=branch-missing",
  "/api/v1/admin/branches/${createdBranch.id}?selectedBranchId=branch-missing",
  "/owner?selectedBranchId=branch-missing",
  "/api/v1/admin/users/invitations?selectedBranchId=branch-missing",
  "/approve-invitation?selectedBranchId=branch-missing",
  "/password?selectedBranchId=branch-missing",
  "/api/v1/admin/users/${invitedUser.id}?selectedBranchId=branch-missing",
  "/api/v1/admin/users/user-coach?selectedBranchId=branch-missing",
  "/roles?selectedBranchId=branch-missing",
  "/api/v1/admin/pilot-readiness?selectedBranchId=branch-missing",
  "/api/v1/admin/pilot-incidents?selectedBranchId=branch-missing",
  "/api/v1/admin/pilot-incidents/${createdIncident.id}?selectedBranchId=branch-missing",
  "/api/v1/admin/pilot-operations?selectedBranchId=branch-missing",
]) {
  assert(smokeApiSource.includes(expected), `smoke API must cover invalid selectedBranchId for ${expected}`);
}
for (const expected of [
  "admin branch update must reject a selected branch mismatch",
  "selected branch mismatch must not update the admin branch",
  "admin branch owner assignment must reject a selected branch mismatch",
  "selected branch mismatch must not assign the branch owner",
  "admin invitation create must reject a selected branch mismatch",
  "selected branch mismatch must not create the invitation",
  "admin invitation approval must reject a selected branch mismatch",
  "admin password issue must reject a selected branch mismatch",
  "selected branch mismatch must not issue a password",
  "admin user update must reject a selected branch mismatch",
  "selected branch mismatch must not update the admin user",
  "admin role update must reject a selected branch mismatch",
  "selected branch mismatch must not update the user role",
  "admin user delete must reject a selected branch mismatch",
  "selected branch mismatch must not delete the user",
]) {
  assert(smokeApiSource.includes(expected), `smoke API must cover admin selectedBranchId mismatch guard for ${expected}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "protected API body reads happen after requireSession",
        "public body-reading routes are explicit",
        "bootstrap rejects invalid selectedBranchId before returning scoped data",
        "deleted request mutation routes stay removed",
        "attendance, class, and payment mutations reject invalid selectedBranchId before returning scoped data",
        "branch-scoped create/update APIs reject selectedBranchId mismatches before mutation",
        "member, guardian, counseling, and notice mutations reject invalid selectedBranchId before returning scoped data",
        "admin branch, user, and pilot mutations reject invalid selectedBranchId before returning scoped data",
      ],
      protectedBodyHandlerCount: checkedProtectedHandlers.length,
      publicBodyHandlers: allowedPublicHandlers,
      routeCount: routeFiles.length,
    },
    null,
    2,
  ),
);
