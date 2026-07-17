import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildGlobalSearchResults } from "../src/lib/global-search.ts";
import { createUrlWithTextParam } from "../src/lib/url-search-params.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");

const owner = {
  id: "user-owner",
  name: "대표",
  role: "owner",
  title: "대표",
  branchIds: ["branch-a", "branch-b"],
};

const coach = {
  id: "user-coach",
  name: "코치",
  role: "coach",
  title: "코치",
  branchIds: ["branch-a"],
};

const guardian = {
  id: "user-guardian",
  name: "김보호",
  role: "guardian",
  title: "학부모",
  branchIds: ["branch-a"],
  childMemberIds: ["member-a"],
  email: "guardian@example.com",
  phone: "010-9999-8888",
};

const admin = {
  id: "user-admin",
  name: "총괄 관리자",
  role: "admin",
  title: "총괄 어드민",
  branchIds: ["branch-a", "branch-b"],
};

const db = {
  branches: [
    { id: "branch-a", name: "목동 본관", district: "양천구" },
    { id: "branch-b", name: "등촌관", district: "강서구" },
  ],
  users: [owner, coach, guardian, admin],
  members: [
    {
      id: "member-a",
      branchId: "branch-a",
      name: "김하늘",
      status: "active",
      ageGroup: "kids",
      level: "입문",
      belt: "흰띠",
      guardianIds: [guardian.id],
      primaryCoachId: coach.id,
      emergencyContact: "010-1111-2222",
      alerts: [],
    },
    {
      id: "member-b",
      branchId: "branch-b",
      name: "이바다",
      status: "active",
      ageGroup: "adult",
      level: "선수부",
      belt: "갈색띠",
      guardianIds: [],
      primaryCoachId: coach.id,
      emergencyContact: "010-3333-4444",
      alerts: [],
    },
  ],
  classes: [
    {
      id: "class-a",
      branchId: "branch-a",
      name: "유소년 입문",
      level: "입문",
      ageGroup: "kids",
      coachId: coach.id,
      startsAt: "2026-07-10T09:00:00+09:00",
      endsAt: "2026-07-10T10:00:00+09:00",
      room: "1관",
      capacity: 20,
      enrolledMemberIds: ["member-a"],
    },
  ],
  attendance: [],
  counselingNotes: [],
  promotions: [],
  tournaments: [],
  payments: [
    {
      id: "payment-a",
      branchId: "branch-a",
      memberId: "member-a",
      planName: "주3회 1개월",
      status: "overdue",
      amount: 180000,
      dueDate: "2026-07-10",
      expiresAt: "2026-08-10",
    },
    {
      id: "payment-b",
      branchId: "branch-b",
      memberId: "member-b",
      planName: "선수부 1개월",
      status: "paid",
      amount: 220000,
      dueDate: "2026-07-10",
      expiresAt: "2026-08-10",
    },
  ],
  notices: [
    {
      id: "notice-a",
      branchId: "branch-a",
      title: "여름방학 수련 안내",
      body: "유소년 수련 시간을 확인해 주세요.",
      important: true,
      audience: ["guardian"],
      createdAt: "2026-07-10T08:00:00+09:00",
      createdByUserId: owner.id,
      readByUserIds: [],
      targetMemberIds: ["member-a"],
    },
    {
      id: "notice-b",
      branchId: "branch-b",
      title: "선수부 합동훈련",
      body: "등촌관 선수부 대상입니다.",
      audience: ["all"],
      createdAt: "2026-07-09T08:00:00+09:00",
      createdByUserId: owner.id,
      readByUserIds: [],
    },
  ],
  pushSubscriptions: [],
  pilotReadinessChecks: [],
  pilotIncidents: [],
  pilotOperationLogs: [],
  auditLogs: [],
};

function search(user, query, selectedBranchId = null) {
  return buildGlobalSearchResults({ db, query, selectedBranchId, user });
}

const ownerBranchSearch = search(owner, "김하늘", "branch-a");
assert(ownerBranchSearch.some((result) => result.id === "member-member-a"), "선택 지점 회원을 검색해야 합니다.");
assert(!ownerBranchSearch.some((result) => result.id === "member-member-b"), "다른 지점 회원을 노출하면 안 됩니다.");

const initialSearch = search(owner, "ㄱㅎㄴ", "branch-a");
assert(initialSearch.some((result) => result.id === "member-member-a"), "회원 이름 초성 검색을 지원해야 합니다.");

const guardianPaymentSearch = search(guardian, "주3회");
assert(guardianPaymentSearch.some((result) => result.id === "payment-payment-a"), "학부모는 연결 자녀 결제를 검색할 수 있어야 합니다.");
assert(!guardianPaymentSearch.some((result) => result.id === "payment-payment-b"), "학부모에게 다른 회원 결제를 노출하면 안 됩니다.");
const guardianMemberResult = search(guardian, "김하늘").find((result) => result.id === "member-member-a");
assert(guardianMemberResult, "학부모는 연결 자녀 회원 결과를 검색할 수 있어야 합니다.");
assert.equal(
  guardianMemberResult.href,
  "/app/members?q=%EA%B9%80%ED%95%98%EB%8A%98&memberId=member-a",
  "학부모 회원 검색 결과는 이름과 접근 검증된 memberId를 함께 전달해야 합니다.",
);
assert.equal(
  search(guardian, "010-9999-8888").some((result) => result.id === "member-member-a"),
  false,
  "가족 역할은 보호자 연락처를 회원 검색 키로 사용하면 안 됩니다.",
);
assert.equal(
  search(owner, "010-9999-8888").some((result) => result.id === "member-member-a"),
  true,
  "운영 역할은 회원 관리에 필요한 보호자 연락처 검색을 유지해야 합니다.",
);

const guardianNoticeSearch = search(guardian, "여름방학");
assert(guardianNoticeSearch.some((result) => result.id === "notice-notice-a"), "학부모 대상 공지를 검색해야 합니다.");
assert(!search(guardian, "합동훈련").some((result) => result.id === "notice-notice-b"), "다른 지점 공지를 노출하면 안 됩니다.");

assert(!search(coach, "주3회").some((result) => result.kind === "payment"), "결제 권한이 없는 코치에게 결제 결과를 노출하면 안 됩니다.");
assert(search(admin, "코치").some((result) => result.id === "user-user-coach"), "총괄 어드민은 사용자를 검색할 수 있어야 합니다.");
assert(!search(owner, "코치").some((result) => result.kind === "user"), "사용자 관리 권한이 없는 역할에는 사용자 결과를 노출하면 안 됩니다.");
assert(search(owner, "결제").some((result) => result.id === "menu-payments"), "메뉴명 검색 결과를 제공해야 합니다.");
assert(search(owner, "").some((result) => result.kind === "menu"), "빈 검색에서는 바로가기 메뉴를 제공해야 합니다.");

assert.equal(
  createUrlWithTextParam("https://final.test/app/members?status=active#member-list", "q", " 김하늘 "),
  "/app/members?status=active&q=%EA%B9%80%ED%95%98%EB%8A%98#member-list",
  "검색 URL 갱신은 다른 필터와 해시를 보존해야 합니다.",
);
assert.equal(
  createUrlWithTextParam("https://final.test/app/members?q=%EA%B9%80%ED%95%98%EB%8A%98&status=active", "q", " "),
  "/app/members?status=active",
  "빈 검색어는 q 파라미터만 제거해야 합니다.",
);

const [appShellSource, globalSearchSource, globalSearchDataSource, membersSource, noticesSource, paymentsSource, rolesSource] = await Promise.all([
  readFile(path.join(projectRoot, "src/components/shell/app-shell.tsx"), "utf8"),
  readFile(path.join(projectRoot, "src/components/shell/global-search.tsx"), "utf8"),
  readFile(path.join(projectRoot, "src/lib/global-search.ts"), "utf8"),
  readFile(path.join(projectRoot, "src/components/screens/members-screen.tsx"), "utf8"),
  readFile(path.join(projectRoot, "src/components/screens/notices-screen.tsx"), "utf8"),
  readFile(path.join(projectRoot, "src/components/screens/payments-screen.tsx"), "utf8"),
  readFile(path.join(projectRoot, "src/components/screens/admin-roles-screen.tsx"), "utf8"),
]);

assert(appShellSource.includes("<GlobalSearch"), "앱 상단 셸에 통합 검색을 연결해야 합니다.");
assert(globalSearchSource.includes('event.key.toLowerCase() === "k"'), "키보드 검색 단축키를 유지해야 합니다.");
assert(globalSearchSource.includes('aria-modal="true"'), "검색 대화상자는 모달 접근성을 제공해야 합니다.");
assert(globalSearchSource.includes('data-testid="global-search-trigger"'), "통합 검색 진입점 회귀 검증 식별자가 필요합니다.");
assert(
  globalSearchDataSource.includes('user.role === "member" || user.role === "guardian"') &&
    globalSearchDataSource.includes("? [guardian.name]"),
  "가족 역할 전역 검색은 제3자 연락처를 회원 검색 키로 사용하면 안 됩니다.",
);
for (const [label, source] of [
  ["회원", membersSource],
  ["공지", noticesSource],
  ["결제", paymentsSource],
  ["권한", rolesSource],
]) {
  assert(source.includes('useUrlSyncedTextParam("q")'), `${label} 검색은 공통 URL 동기화 훅을 사용해야 합니다.`);
}
assert(noticesSource.includes("highlightedNoticeAvailable"), "공지 딥링크 강조는 항목 존재 여부의 원시 값에만 의존해야 합니다.");
assert(!noticesSource.includes("[highlightNoticeId, notices]"), "공지 데이터 갱신이 딥링크 강조를 반복 실행하면 안 됩니다.");
assert(
  membersSource.includes("guardianChildIds?.includes(requestedMemberId)") &&
    membersSource.includes("setSelectedChildId(requestedMemberId)"),
  "회원 화면은 URL memberId가 연결 자녀일 때만 선택 자녀를 전환해야 합니다.",
);

console.log("Global search scope, Korean initials, navigation, and accessibility checks passed.");
