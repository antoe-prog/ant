import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function assertAppearsAfter(source, needle, earlierNeedle, message) {
  const needleIndex = source.indexOf(needle);
  const earlierIndex = source.indexOf(earlierNeedle);

  assert(needleIndex >= 0, `${message}: missing ${needle}`);
  assert(earlierIndex >= 0, `${message}: missing ${earlierNeedle}`);
  assert(needleIndex > earlierIndex, message);
}

const [
  membersScreenSource,
  adminUsersScreenSource,
  memberRouteSource,
  memberCreateRouteSource,
  guardianRouteSource,
  memberGuardianInputPolicySource,
  adminUserRouteSource,
  memberAgePolicySource,
  memberInputPolicySource,
  counselingNotePolicySource,
  counselingNoteRouteSource,
  smokeApiSource,
  adminUserManagementApiSource,
  packageJsonSource,
  releaseRunnerSource,
  readmeSource,
  qaPlanSource,
  releaseChecklistSource,
] = await Promise.all([
  readFile("src/components/screens/members-screen.tsx", "utf8"),
  readFile("src/components/screens/admin-users-screen.tsx", "utf8"),
  readFile("src/app/api/v1/members/[memberId]/route.ts", "utf8"),
  readFile("src/app/api/v1/branches/[branchId]/members/route.ts", "utf8"),
  readFile("src/app/api/v1/members/[memberId]/guardians/route.ts", "utf8"),
  readFile("src/lib/member-guardian-input-policy.ts", "utf8"),
  readFile("src/app/api/v1/admin/users/[userId]/route.ts", "utf8"),
  readFile("src/lib/member-age-policy.ts", "utf8"),
  readFile("src/lib/member-input-policy.ts", "utf8"),
  readFile("src/lib/counseling-note-input-policy.ts", "utf8"),
  readFile("src/app/api/v1/branches/[branchId]/members/[memberId]/counseling-notes/route.ts", "utf8"),
  readFile("scripts/smoke-api.mjs", "utf8"),
  readFile("scripts/check-admin-user-management-api.mjs", "utf8"),
  readFile("package.json", "utf8"),
  readFile("scripts/run-release-checks.mjs", "utf8"),
  readFile("README.md", "utf8"),
  readFile("docs/QA_TEST_PLAN.md", "utf8"),
  readFile("docs/RELEASE_CHECKLIST.md", "utf8"),
]);
const packageJson = JSON.parse(packageJsonSource);

assert(
  /data-testid=\{`member-profile-age-summary-\$\{member\.id\}`\}/.test(membersScreenSource) &&
    /data-testid=\{`member-profile-contact-summary-\$\{member\.id\}`\}/.test(membersScreenSource),
  "member profile summary must expose stable age/contact hooks for saved-value UI regression checks",
);
assert(
  membersScreenSource.includes('data-testid={`member-payment-summary-${member.id}`}') &&
    membersScreenSource.includes('data-testid={`member-payment-summary-link-${member.id}`}') &&
    membersScreenSource.includes("getCurrentMemberPayment(payments)") &&
    membersScreenSource.includes('context.user.role !== "coach"') &&
    membersScreenSource.includes('context.user.role !== "guardian" || member.status !== "withdrawn"') &&
    membersScreenSource.includes("canManageMembers ? (") &&
    membersScreenSource.includes("focusPayment=${encodeURIComponent(currentPayment.id)}"),
  "member detail must show a scoped payment summary, preserve family amount privacy, hide it from coaches, and keep withdrawn guardian history out of checkout navigation",
);
assert(
  membersScreenSource.includes('data-testid={`member-age-group-select-${member.id}`}') &&
    membersScreenSource.includes('ageGroup: event.target.value as Member["ageGroup"]') &&
    membersScreenSource.includes('data-testid={`member-profile-submit-${member.id}`}'),
  "member profile form must keep age editing wired to the saved profile submit action",
);
assert(
  membersScreenSource.includes('data-testid={`member-primary-coach-summary-${member.id}`}') &&
    membersScreenSource.includes('data-testid={`member-primary-coach-select-${member.id}`}') &&
    membersScreenSource.includes("primaryCoachId: draft.primaryCoachId") &&
    membersScreenSource.includes('candidate.role === "coach"') &&
    membersScreenSource.includes("candidate.branchIds.includes(member.branchId)"),
  "member profile must expose a same-branch accepted-coach assignment control and submit it with profile changes",
);
assert(
  membersScreenSource.includes("getProfileMemberSignature(member)") &&
    membersScreenSource.includes("sourceMemberSignature") &&
    membersScreenSource.includes("dirty: false") &&
    membersScreenSource.includes('feedback: saved ? "회원 기본 정보를 저장했습니다."'),
  "member profile draft must resync saved server snapshots without losing save feedback",
);
assert(
  /data-testid=\{`member-profile-feedback-\$\{member\.id\}`\}[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(membersScreenSource),
  "member profile save feedback must stay announced as a polite status message",
);
assert(
  membersScreenSource.includes('data-testid={`member-guardian-search-input-${member.id}`}') &&
    membersScreenSource.includes('data-testid={`member-guardian-search-result-${member.id}`}') &&
    membersScreenSource.includes('data-testid={`member-guardian-submit-${member.id}`}') &&
    membersScreenSource.includes('data-testid={`member-guardian-current-${member.id}-${guardianId}`}') &&
    membersScreenSource.includes('data-testid={`member-guardian-unlink-${member.id}-${guardianId}`}'),
  "member guardian edit UI must keep searchable select, current-link, submit, and unlink hooks",
);
assert(
  /data-testid=\{`member-emergency-contact-call-\$\{member\.id\}`\}[\s\S]{0,240}href=\{`tel:\$\{member\.emergencyContact/.test(membersScreenSource) &&
    /data-testid=\{`member-guardian-phone-call-\$\{member\.id\}-\$\{guardianId\}`\}[\s\S]{0,240}href=\{`tel:\$\{guardian\.phone/.test(membersScreenSource) &&
    /className="[^"]*min-h-11[^"]*"[\s\S]{0,260}data-testid=\{`member-emergency-contact-call-\$\{member\.id\}`\}/.test(membersScreenSource) &&
    /className="[^"]*min-h-11[^"]*"[\s\S]{0,260}data-testid=\{`member-guardian-phone-call-\$\{member\.id\}-\$\{guardianId\}`\}/.test(membersScreenSource),
  "member and guardian phone links must stay as 44px touch-sized tel actions",
);
assert(
  membersScreenSource.includes('member.guardianIds.length > 0 ? "변경할 학부모 검색" : "학부모 검색"') &&
    membersScreenSource.includes('member.guardianIds.length > 0 ? "변경" : "연결"') &&
    membersScreenSource.includes("replaceGuardian(member.id, { guardianUserId: draft.guardianUserId })") &&
    membersScreenSource.includes("unlinkGuardian(member.id, { guardianUserId })"),
  "member guardian edit UI must allow changing and unlinking an existing guardian after first registration",
);
assert(
  /data-testid=\{`member-guardian-feedback-\$\{member\.id\}`\}[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(membersScreenSource),
  "member guardian link feedback must stay announced as a polite status message",
);
assert(
  membersScreenSource.includes("const showAlertSection = !isFamilyRole && member.alerts.length > 0;") &&
    membersScreenSource.includes("isFamilyRole && member.alerts.length > 0") &&
    membersScreenSource.includes('data-testid="family-member-alert-strip"') &&
    !membersScreenSource.includes("등록된 주의사항 없음") &&
    !membersScreenSource.includes("아직 상담/주의 메모가 없습니다.") &&
    !membersScreenSource.includes("아직 코치 피드백이 없습니다."),
  "member profile cards must show real family warnings while keeping zero-count states quiet",
);
assert(
  /data-testid="member-invite-feedback"[\s\S]*aria-live="polite"[\s\S]*role="status"/.test(membersScreenSource),
  "member invitation feedback must stay announced as a polite status message",
);
assert(
  membersScreenSource.includes("updateGuardianLinkDraft(member, {") &&
    membersScreenSource.includes("guardianSearch: event.target.value") &&
    membersScreenSource.includes('guardianUserId: ""') &&
    membersScreenSource.includes("getGuardianSearchResults(member)") &&
    !/<select[\s\S]{0,360}guardianUserId/.test(membersScreenSource),
  "member guardian edit UI must use search results instead of regressing to a scroll-only select",
);
assert(
  memberAgePolicySource.includes('member.ageGroup !== "adult"') &&
    membersScreenSource.includes("canMemberHaveGuardianLink(member)") &&
    membersScreenSource.includes('data-testid={!canMemberHaveGuardianLink(member) ? `member-guardian-ineligible-${member.id}` : undefined}') &&
    membersScreenSource.includes("성인 회원은 학부모 연결 대상이 아닙니다.") &&
    adminUsersScreenSource.includes("canMemberHaveGuardianLink(member)") &&
    adminUsersScreenSource.includes('placeholder="유소년/청소년 이름, 연락처, 지점 검색"'),
  "guardian link UI must hide adult members from guardian-child linking surfaces",
);
assert(
  memberRouteSource.includes('Pick<Member, "ageGroup"') &&
    memberRouteSource.includes("getAccessibleMemberIds(user, db, [member.branchId]).includes(member.id)") &&
    memberRouteSource.includes("const initialCanReadMember = getAccessibleMemberIds(") &&
    memberRouteSource.includes("const canReadMember = getAccessibleMemberIds(user, db, accessibleBranchIds).includes(member.id)") &&
    memberRouteSource.includes("hasRestrictedProfileFields") &&
    memberRouteSource.includes("canManageMember") &&
    memberRouteSource.includes("patch.ageGroup = body.ageGroup") &&
    memberRouteSource.includes('message: canManageMember ? "회원 정보를 변경했습니다." : "회원 긴급 연락처를 변경했습니다."'),
  "member update API must keep manager-only age/profile editing and family contact-only editing",
);
assert(
  memberRouteSource.includes('"primaryCoachId"') &&
    memberRouteSource.includes('primaryCoach.invitationStatus === "pending"') &&
    memberRouteSource.includes('!["coach", "owner", "admin"].includes(primaryCoach.role)') &&
    memberRouteSource.includes("!primaryCoach.branchIds.includes(member.branchId)") &&
    memberRouteSource.includes("patch.primaryCoachId = primaryCoachId"),
  "member update API must validate and audit same-branch operational assignments",
);
assert(
  memberInputPolicySource.includes("nameLength: 30") &&
    memberInputPolicySource.includes("emergencyContactLength: 40") &&
    memberInputPolicySource.includes("alertItems: 8") &&
    memberInputPolicySource.includes("alertLength: 80") &&
    memberCreateRouteSource.includes("memberInputLimits.nameLength") &&
    memberCreateRouteSource.includes("memberInputLimits.emergencyContactLength") &&
    memberRouteSource.includes("memberInputLimits.nameLength") &&
    membersScreenSource.includes("maxLength={memberInputLimits.nameLength}") &&
    membersScreenSource.includes("maxLength={memberInputLimits.alertsTextLength}"),
  "member create/edit UI and APIs must share bounded profile and alert input policy",
);
assert(
  counselingNotePolicySource.includes("bodyLength: 2_000") &&
    counselingNoteRouteSource.includes("getCounselingNoteBodyLimitError(body.body)") &&
    membersScreenSource.includes("maxLength={counselingNoteInputLimits.bodyLength}") &&
    membersScreenSource.includes('data-testid="member-note-body"'),
  "counseling note API and editor must share a bounded body policy",
);
assert(
  (memberRouteSource.match(/if \(!(?:initialCanReadMember|canReadMember)\) \{[\s\S]{0,160}jsonError\(404, "NOT_FOUND", "회원을 찾을 수 없습니다\."\)/g)?.length ?? 0) === 2,
  "member update API must conceal inaccessible member targets before and inside the mutation lock",
);
assertAppearsAfter(
  memberRouteSource,
  "request.json()",
  "if (!initialCanManageMember && !initialCanUpdateOwnContact)",
  "member update API must authorize member/profile edits before reading request body",
);
assert(
  guardianRouteSource.includes("export async function POST") &&
    guardianRouteSource.includes("export async function PUT") &&
    guardianRouteSource.includes("export async function DELETE") &&
    guardianRouteSource.includes("canMemberHaveGuardianLink(member)") &&
    guardianRouteSource.includes("syncAffectedGuardianUsers") &&
    guardianRouteSource.includes("syncGuardianUserLinks") &&
    guardianRouteSource.includes("parseGuardianLinkInput") &&
    guardianRouteSource.includes('createRuntimeId("audit")') &&
    guardianRouteSource.includes('const guardianLinkStateLockKey = "member-guardian-links"') &&
    (guardianRouteSource.match(/withServerDbLock\(guardianLinkStateLockKey/g)?.length ?? 0) === 3 &&
    (guardianRouteSource.match(/await requireGuardianLinkRequestContext\(/g)?.length ?? 0) === 6 &&
    (guardianRouteSource.match(/parseGuardianLinkInput\(await request\.json\(\)/g)?.length ?? 0) === 3 &&
    guardianRouteSource.includes("guardian.branchIds.includes(memberBranchId)") &&
    (guardianRouteSource.match(/!canAssignGuardian\(user, guardian, member\.branchId\)/g)?.length ?? 0) === 2 &&
    guardianRouteSource.includes('message: "보호자-자녀 연결을 변경했습니다."'),
  "guardian link API must keep scoped add/replace/delete handlers without disclosing inaccessible members or unavailable guardian accounts",
);
assert(
  guardianRouteSource.includes("async function requireGuardianLinkRequestContext") &&
    guardianRouteSource.includes("requireSession(request, db)") &&
    guardianRouteSource.indexOf("request.json()") < guardianRouteSource.indexOf("withServerDbLock(guardianLinkStateLockKey"),
  "guardian link API must authenticate before body parsing and parse the body before taking the shared mutation lock",
);
assert(
  memberGuardianInputPolicySource.includes("guardianUserIdLength: 200") &&
    memberGuardianInputPolicySource.includes("guardianUserId.length > memberGuardianInputLimits.guardianUserIdLength"),
  "guardian link API must reject oversized guardian identifiers through the shared input policy",
);
assert(
  guardianRouteSource.includes("성인 회원은 학부모 계정에 연결할 수 없습니다.") &&
    adminUserRouteSource.includes("findAdultGuardianChildMemberIds") &&
    adminUserRouteSource.includes("성인 회원은 학부모 자녀로 연결할 수 없습니다."),
  "guardian link APIs must reject adult members as guardian-child links",
);
assertAppearsAfter(
  guardianRouteSource,
  "request.json()",
  "if (selectedScope.response)",
  "guardian link API must verify selected branch scope before reading request body",
);

for (const snippet of [
  "owner member age group update did not persist",
  "owner member profile update did not sync linked user name",
  "owner primary coach assignment did not persist",
  "primary coach assignment audit log is missing",
  "primary coach assignment must immediately expose the member to the assigned coach",
  "member assignment must reject a non-operational account",
  "oversized member create input must be rejected",
  "oversized member create input must not create audit records",
  "guardian must not discover another family member profile",
  "member update must not disclose whether an inaccessible member exists",
  "guardian replace must atomically replace member guardian ids",
  "guardian replace must remove previous guardian child ids",
  "guardian replace must update next guardian child ids",
  "guardian unlink did not update member guardian ids",
  "guardian unlink did not update guardian child ids",
  "concurrent guardian links must both succeed",
  "concurrent guardian links must preserve both member links",
  "concurrent guardian links must preserve both guardian child links",
  "concurrent guardian links must preserve both audit records",
  "concurrent guardian link audit IDs must be unique",
  "malformed guardian links must not mutate member guardian ids",
  "malformed guardian replace/unlink must preserve the existing relationship",
  "oversized guardian links must be rejected",
  "slow guardian body parsing must not hold the shared guardian link lock",
  "owner must not connect a guardian who is outside the member branch",
  "guardian replacement must not disclose whether an unavailable guardian account exists",
  "guardian unlink must be idempotent without disclosing an unlinked account's existence",
  "blocked cross-branch guardian replacement must not mutate member guardian ids",
  "blocked cross-branch guardian replacement must not mutate guardian child ids",
  "adult member guardian link must be rejected",
  "adult member guardian link rejection must not mutate guardian ids",
]) {
  assert(smokeApiSource.includes(snippet), `smoke API must keep runtime regression coverage: ${snippet}`);
}
assert(
  adminUserManagementApiSource.includes("admin user update must reject adult member ids as guardian children") &&
    adminUserManagementApiSource.includes('childMemberIds: ["member-jiho"]'),
  "admin user management API test must keep adult guardian-child rejection coverage",
);

assert.equal(
  packageJson.scripts["test:member-profile-guardian-edit"],
  "node scripts/check-member-profile-guardian-edit.mjs",
  "package.json must expose test:member-profile-guardian-edit",
);
assert.equal(
  packageJson.scripts["test:guardian-age-policy-ui"],
  "node scripts/check-guardian-age-policy-ui.mjs",
  "package.json must expose the rendered guardian age policy UI check",
);
assert.equal(
  packageJson.scripts["test:admin-user-guardian-bottom-safe-area"],
  "node scripts/check-admin-user-guardian-bottom-safe-area.mjs",
  "package.json must expose the admin guardian edit bottom safe-area UI check",
);
assert(
  releaseRunnerSource.includes('["run", "test:member-profile-guardian-edit"]') &&
    releaseRunnerSource.includes('["run", "test:guardian-age-policy-ui"]') &&
    releaseRunnerSource.includes('["run", "test:admin-user-guardian-bottom-safe-area"]') &&
    releaseRunnerSource.includes('"npm run test:guardian-age-policy-ui"') &&
    releaseRunnerSource.includes('"npm run test:admin-user-guardian-bottom-safe-area"'),
  "test:release must run member profile/guardian edit and rendered guardian age policy guards",
);

for (const [label, source] of [
  ["README", readmeSource],
  ["QA plan", qaPlanSource],
  ["release checklist", releaseChecklistSource],
]) {
  assert(source.includes("npm run test:member-profile-guardian-edit"), `${label} must document test:member-profile-guardian-edit`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "manager member age edits stay visible in the saved profile summary",
        "member/guardian contact-only profile edits remain restricted",
        "stale adult guardian-child links cannot authorize guardian member profile edits",
        "guardian link UI supports search, replace, and unlink after first registration",
        "member profile cards keep quiet zero-count note/warning states",
        "guardian link UI/API rejects adult members as guardian-child links",
        "rendered guardian age policy UI check is wired into release",
        "admin guardian edit bottom safe-area UI check is wired into release",
        "guardian link API keeps reciprocal member.guardianIds and user.childMemberIds updates",
        "smoke API covers runtime profile and guardian link persistence",
        "release/docs include the focused regression guard",
      ],
    },
    null,
    2,
  ),
);
