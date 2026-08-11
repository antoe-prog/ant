import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockData } from "../src/lib/mock-data.ts";
import { getAccessibleBranchIds } from "../src/lib/mock-api.ts";
import {
  googlePlayReviewBranchId,
  googlePlayReviewPhones,
  googlePlayReviewUserIds,
} from "../src/lib/google-play-review-access.ts";
import {
  canAdminManageUser,
  hasAdminAccessToBranchIds,
  hasGlobalAdminDataAccess,
} from "../src/lib/admin-access.ts";
import { verifyPassword } from "../src/server/auth-password.ts";
import {
  createGooglePlayReviewConsoleEntries,
  createGooglePlayReviewPasswords,
  parseGooglePlayReviewPasswordsReport,
  provisionGooglePlayReviewAccess,
} from "../src/server/google-play-review-provisioning.ts";
import { inspectRuntimeStateIntegrity } from "../src/server/runtime-state-integrity.ts";

const passwords = {
  admin: "FJ-Play-admin-2026-safe",
  coach: "FJ-Play-coach-2026-safe",
  guardian: "FJ-Play-guardian-2026-safe",
  member: "FJ-Play-member-2026-safe",
  owner: "FJ-Play-owner-2026-safe",
};
const now = new Date("2026-07-22T03:00:00.000Z");
const original = createMockData();
const originalUserHashes = new Map(original.users.map((user) => [user.id, user.passwordHash]));
const provisioned = provisionGooglePlayReviewAccess(original, passwords, now);
const reprovisioned = provisionGooglePlayReviewAccess(provisioned, passwords, now);
const reviewAdmin = provisioned.users.find((user) => user.id === googlePlayReviewUserIds.admin);
const regularAdmin = provisioned.users.find((user) => user.id === "user-admin");

assert(reviewAdmin, "review admin must be provisioned");
assert(regularAdmin, "regular admin must remain available");
assert.equal(provisioned.branches.length, original.branches.length + 1, "provisioning must add one isolated branch");
assert.equal(provisioned.users.length, original.users.length + 5, "provisioning must add five role accounts");
assert.equal(reprovisioned.branches.length, provisioned.branches.length, "reprovisioning must not duplicate the review branch");
assert.equal(reprovisioned.users.length, provisioned.users.length, "reprovisioning must not duplicate review accounts");
assert.throws(
  () => provisionGooglePlayReviewAccess({
    ...original,
    users: [{
      ...original.users[0],
      id: googlePlayReviewUserIds.admin,
      phone: googlePlayReviewPhones.admin,
    }, ...original.users.slice(1)],
  }, passwords, now),
  /Refusing to replace non-review user data/,
  "provisioning must not overwrite an existing non-review entity that reuses a fixed review ID",
);
assert.deepEqual(
  getAccessibleBranchIds(reviewAdmin, provisioned),
  [googlePlayReviewBranchId],
  "review admin must only access the synthetic review branch",
);
assert.equal(
  getAccessibleBranchIds(regularAdmin, provisioned).length,
  provisioned.branches.length,
  "regular admin must retain global branch access",
);
assert.equal(hasGlobalAdminDataAccess(reviewAdmin), false, "review admin must not receive global admin data");
assert.equal(hasGlobalAdminDataAccess(regularAdmin), true, "regular admin must retain global data access");
assert.equal(reviewAdmin.adminScope, "assigned_branches", "review admin must use the generic branch-scoped admin policy");
const equivalentBranchAdmin = {
  ...reviewAdmin,
  id: "user-branch-admin-contract-test",
};
assert.deepEqual(
  getAccessibleBranchIds(reviewAdmin, provisioned),
  getAccessibleBranchIds(equivalentBranchAdmin, provisioned),
  "review metadata must not change the generic admin branch scope",
);
assert.equal(hasAdminAccessToBranchIds(reviewAdmin, [googlePlayReviewBranchId]), true);
assert.equal(hasAdminAccessToBranchIds(reviewAdmin, ["branch-gangnam"]), false);
assert.equal(canAdminManageUser(reviewAdmin, provisioned.users.find((user) => user.id === googlePlayReviewUserIds.member)), true);
assert.equal(canAdminManageUser(reviewAdmin, regularAdmin), false);

for (const [role, userId] of Object.entries(googlePlayReviewUserIds)) {
  const user = provisioned.users.find((candidate) => candidate.id === userId);
  assert(user, `${role} review account must exist`);
  assert.equal("accountPurpose" in user, false, "review identity must not be stored on the user record");
  assert.deepEqual(user.branchIds, [googlePlayReviewBranchId]);
  assert.equal(user.phone, googlePlayReviewPhones[role]);
  assert.equal(verifyPassword(passwords[role], user.passwordHash), true, `${role} review password must verify`);
}

for (const [userId, passwordHash] of originalUserHashes) {
  assert.equal(
    provisioned.users.find((user) => user.id === userId)?.passwordHash,
    passwordHash,
    `provisioning must preserve existing credential ${userId}`,
  );
}

assert.equal(
  inspectRuntimeStateIntegrity(provisioned).filter((issue) =>
    issue.targetId.includes("demo-gangseo") ||
    ("branchId" in issue.details && issue.details.branchId === googlePlayReviewBranchId),
  ).length,
  0,
  "synthetic review data must satisfy runtime integrity rules",
);

const entries = createGooglePlayReviewConsoleEntries(passwords);
assert.deepEqual(
  parseGooglePlayReviewPasswordsReport({ accounts: entries }),
  passwords,
  "existing App Store review credentials must be reusable without password rotation",
);
assert.deepEqual(
  parseGooglePlayReviewPasswordsReport({ consoleEntries: entries }),
  passwords,
  "existing Play Console review credentials must be reusable without password rotation",
);
assert.throws(
  () => parseGooglePlayReviewPasswordsReport({ accounts: entries.slice(1) }),
  /exactly 5 accounts/,
);
assert.throws(
  () => parseGooglePlayReviewPasswordsReport({
    accounts: entries.map((entry, index) => index === 0 ? { ...entry, username: "01000000000" } : entry),
  }),
  /username does not match/,
);
const generatedPasswords = createGooglePlayReviewPasswords();
assert.equal(new Set(Object.values(generatedPasswords)).size, 5, "generated review passwords must be unique by role");
for (const generatedPassword of Object.values(generatedPasswords)) {
  assert.match(generatedPassword, /^FJ-Play-[a-f0-9]{16}-[a-f0-9]{16}$/);
}
assert.equal(entries.length, 5, "Play Console must receive one entry for every app role");
assert.equal(new Set(entries.map((entry) => entry.username)).size, 5, "review usernames must be unique");
for (const entry of entries) {
  assert.match(entry.name, /^Final Judo - .+ Review Account$/);
  assert(entry.otherAccessInformation.length <= 500, "Play Console instructions must fit the 500 character limit");
  assert(!/[\u3131-\uD79D]/.test(entry.otherAccessInformation), "Play Console instructions must be written in English");
  assert(!entry.otherAccessInformation.includes("a1234"), "review instructions must not expose an operator password");
}

const serverApiSource = readFileSync("src/server/api.ts", "utf8");
const serverDbSource = readFileSync("src/server/db.ts", "utf8");
const provisionScriptSource = readFileSync("scripts/provision-google-play-review.mjs", "utf8");
const reviewAccessSource = readFileSync("src/lib/google-play-review-access.ts", "utf8");
const domainSource = readFileSync("src/lib/domain.ts", "utf8");

const visibleFixtureText = [
  ...provisioned.branches
    .filter((branch) => branch.id === googlePlayReviewBranchId)
    .flatMap((branch) => [branch.name, branch.district]),
  ...provisioned.users
    .filter((user) => Object.values(googlePlayReviewUserIds).includes(user.id))
    .flatMap((user) => [user.name, user.title, user.email ?? ""]),
  ...provisioned.members
    .filter((member) => member.branchId === googlePlayReviewBranchId)
    .map((member) => member.name),
  ...provisioned.classes
    .filter((session) => session.branchId === googlePlayReviewBranchId)
    .flatMap((session) => [session.name, session.room]),
  ...provisioned.notices
    .filter((notice) => notice.branchId === googlePlayReviewBranchId)
    .flatMap((notice) => [notice.title, notice.body]),
  ...provisioned.tournaments
    .filter((tournament) => tournament.branchId === googlePlayReviewBranchId)
    .flatMap((tournament) => [tournament.title, tournament.description ?? "", tournament.location ?? ""]),
].join("\n");

assert(serverApiSource.includes("hasGlobalAdminDataAccess"));
assert(!serverApiSource.includes("isGooglePlayReviewAccount"));
assert(!serverApiSource.includes("shouldBlockGooglePlayReviewAdminMutation"));
assert(!reviewAccessSource.includes("hasGlobalAdminDataAccess"));
assert(!reviewAccessSource.includes("shouldBlockGooglePlayReviewAdminMutation"));
assert(!domainSource.includes("accountPurpose"), "review identity must not be part of the user domain contract");
assert.doesNotMatch(
  visibleFixtureText,
  /Google Play|Play 검토|합성 검토|검토용|검토 지점|검토 매트|검토 체육관/i,
  "review accounts must receive ordinary app-facing names and content",
);
assert(serverDbSource.includes("rollGooglePlayReviewDates"), "review dates must remain current in production");
assert(provisionScriptSource.includes("FINAL_JUDO_INSTALLATION_ID"), "production provisioning must verify installation identity");
assert(provisionScriptSource.includes("FINAL_JUDO_REVIEW_CREDENTIALS_FILE"), "production provisioning must support password-preserving repair");
assert(provisionScriptSource.includes("credentialsPrinted: false"), "provisioning output must not print passwords");
assert(provisionScriptSource.includes("mode: 0o600"), "credential report must be owner-readable only");
assert(!provisionScriptSource.includes("console.log(JSON.stringify(report"), "provisioning stdout must not expose Play credentials");

console.log("Google Play review access checks passed: generic RBAC parity, isolated branch scope, synthetic data, and secret handling.");
