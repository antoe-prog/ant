import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const sourceRoots = ["src"];
const prohibitedRouteDirs = [
  "src/app/(app)/app/requests",
  "src/app/(app)/requests",
  "src/app/api/v1/requests",
  "src/components/screens/requests-screen.tsx",
];
const prohibitedSourceFragments = [
  "/app/requests",
  "/api/v1/requests",
  'data-mobile-route-id="requests"',
  'data-testid="requests-screen"',
  'data-notification-kind="request"',
  'request${"Checks"}',
  "requestChecks",
  "보강",
];

function listFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const entries = readdirSync(root).flatMap((entry) => {
    const absolutePath = path.join(root, entry);
    const stat = statSync(absolutePath);

    if (stat.isDirectory()) {
      return listFiles(absolutePath);
    }

    return absolutePath;
  });

  return entries.filter((entry) => /\.(?:ts|tsx|js|jsx)$/.test(entry));
}

for (const deletedPath of prohibitedRouteDirs) {
  assert(!existsSync(deletedPath), `deleted request feature path must not exist: ${deletedPath}`);
}

for (const filePath of sourceRoots.flatMap(listFiles)) {
  const source = readFileSync(filePath, "utf8");

  for (const fragment of prohibitedSourceFragments) {
    assert(!source.includes(fragment), `${filePath} must not reintroduce deleted request/remedial surface: ${fragment}`);
  }
}

const visibleCopyTestSource = readFileSync("scripts/check-visible-app-copy-stability.mjs", "utf8");
const smokeApiSource = readFileSync("scripts/smoke-api.mjs", "utf8");
const releaseRunnerSource = readFileSync("scripts/run-release-checks.mjs", "utf8");
const auditLogRouteSource = readFileSync("src/app/api/v1/admin/audit-logs/route.ts", "utf8");
const readmeSource = readFileSync("README.md", "utf8");
const qaPlanSource = readFileSync("docs/QA_TEST_PLAN.md", "utf8");
const releaseChecklistSource = readFileSync("docs/RELEASE_CHECKLIST.md", "utf8");
const apiContractSource = readFileSync("docs/API_CONTRACT.md", "utf8");
const accessibilityAuditSource = readFileSync("docs/ACCESSIBILITY_AUDIT.md", "utf8");
const pilotRunbookSource = readFileSync("docs/PILOT_OPERATIONS_RUNBOOK.md", "utf8");
const backendSchemaSource = readFileSync("docs/BACKEND_DB_SCHEMA.md", "utf8");
const implementationBacklogSource = readFileSync("docs/IMPLEMENTATION_BACKLOG.md", "utf8");
const recentVerificationHeading = "\n## 최근 검증 기록";
const currentImplementationBacklogSource = implementationBacklogSource.includes(recentVerificationHeading)
  ? implementationBacklogSource.slice(0, implementationBacklogSource.indexOf(recentVerificationHeading))
  : implementationBacklogSource;

assert(
  visibleCopyTestSource.includes("family bottom navigation must remove deleted request actions"),
  "visible copy stability test must keep bottom navigation request-removal coverage",
);
assert(
  visibleCopyTestSource.includes("notificationRequestDetailLinkCount"),
  "visible copy stability test must keep notification request-link removal coverage",
);
assert(
  visibleCopyTestSource.includes('!layout.ownerBranchHealthText.includes("보강")'),
  "visible copy stability test must keep deleted remedial graph-copy coverage",
);
assert(
  smokeApiSource.includes("/api/v1/requests?selectedBranchId=branch-gangnam") &&
    smokeApiSource.includes("must stay deleted and return 404"),
  "smoke API test must keep deleted request endpoint 404 coverage",
);
assert(
  releaseRunnerSource.includes('["run", "test:deleted-request-surface"]'),
  "release runner must execute the deleted request surface guard",
);
assert(
  auditLogRouteSource.includes('String(log.action).startsWith("request.")') && auditLogRouteSource.includes("return false;"),
  "audit logs must continue hiding legacy request.* rows",
);

assert(
  readmeSource.includes("/app/requests`와 `/requests`는 제공하지 않아 직접 접근 시 `404`"),
  "README must describe deleted request routes as 404, not redirect or disabled feature",
);
assert(
  readmeSource.includes("요청 기능 삭제") && readmeSource.includes("직접 접근 시 `404`를 반환"),
  "README API section must describe deleted request APIs as 404",
);
for (const [label, source] of [
  ["README", readmeSource],
  ["QA plan", qaPlanSource],
  ["release checklist", releaseChecklistSource],
]) {
  assert(source.includes("npm run test:deleted-request-surface"), `${label} must document the deleted request surface guard`);
}
assert(!qaPlanSource.includes("대기 요청"), "QA plan must not keep stale pending request wording after request removal");

for (const fragment of [
  "CREATE TYPE enrollment_type AS ENUM ('regular', 'trial', 'makeup')",
  "CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'makeup', 'makeup_present', 'excused')",
  "makeupWindowDays",
  "monthlyMakeupLimit",
  "allowNoShowMakeup",
]) {
  assert(!backendSchemaSource.includes(fragment), `backend schema must not keep deleted remedial request contract: ${fragment}`);
}

assert(
  backendSchemaSource.includes("CREATE TYPE enrollment_type AS ENUM ('regular', 'trial')") &&
    backendSchemaSource.includes("CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused')") &&
    backendSchemaSource.includes('settings jsonb NOT NULL DEFAULT \'{"attendanceEditRequiresReason":true}\'::jsonb'),
  "backend schema must document the current request-free attendance/settings contract",
);

for (const fragment of ["대기 요청", "요청 생성일"]) {
  assert(!apiContractSource.includes(fragment), `API contract must not keep deleted request export wording: ${fragment}`);
}

for (const fragment of ["출석 미처리 슬롯", "대표 우선 점수", "trend_period"]) {
  assert(apiContractSource.includes(fragment), `API contract must document current operations export wording: ${fragment}`);
}

assert(
  implementationBacklogSource.includes("요청 기능과 요청 카드는 2026-06-28 삭제가 현재 기준"),
  "implementation backlog must state that deleted request/remedial worklog entries are historical only",
);

for (const fragment of [
  "결제/보강 요청 알림 후보",
  "보강/결석 요청 알림",
  "/app/requests?status=pending",
  "대기 요청, 휴면 회원",
  "요청 생성일",
  "보강 요청, 휴면 회원",
]) {
  assert(
    !currentImplementationBacklogSource.includes(fragment),
    `implementation backlog current criteria must not keep stale deleted request target: ${fragment}`,
  );
}

for (const fragment of [
  "결제 알림 후보",
  "삭제된 요청 알림 제거",
  "요청 deep link 삭제 유지",
  "공지 미확인, 휴면 회원",
  "공지 발행일",
]) {
  assert(
    currentImplementationBacklogSource.includes(fragment),
    `implementation backlog must document the current request-free criteria: ${fragment}`,
  );
}

for (const [label, source] of [
  ["README", readmeSource],
  ["API contract", apiContractSource],
  ["accessibility audit", accessibilityAuditSource],
  ["pilot runbook", pilotRunbookSource],
  ["backend schema", backendSchemaSource],
]) {
  for (const fragment of [
    "대시보드로 돌려",
    "대시보드로 redirect",
    "410 FEATURE_DISABLED",
    "결석/보강 요청 생성과 승인/반려",
    "보강 출석",
  ]) {
    assert(!source.includes(fragment), `${label} must not keep stale deleted request documentation: ${fragment}`);
  }
}

console.log("deleted request surface guard passed");
