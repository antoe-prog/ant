import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const releaseRunnerPath = "scripts/run-release-checks.mjs";
const adminSettingsPath = "src/components/screens/admin-settings-screen.tsx";
const requiredAdminGateCommands = [
  "npm run test:release",
  "npm run test:role-csv-export-gates",
  "npm run test:deleted-request-surface",
  "npm audit --audit-level=moderate",
  "npm run test:env-readiness",
  "npm run test:deployment-handoff-draft",
  "npm run test:deployment-handoff",
  "npm run test:preflight-runtime",
  "npm run test:pilot-evidence",
  "npm run test:pilot-field-evidence-draft",
  "npm run test:pilot-field-evidence",
  "npm run test:pilot-closeout-package",
  "npm run test:pilot-artifact-manifest",
  "npm run test:pilot-archive-artifacts",
  "npm run test:pilot-storage-receipt-draft",
  "npm run test:pilot-storage-receipt",
  "npm run test:pilot-final-handoff",
  "npm run test:pilot-status",
  "npm run test:pilot-operator-support",
  "npm run test:p1-handoff-draft",
  "npm run test:p1-handoff-checklist",
  "npm run test:p1-handoff-bundle",
  "npm run test:p1-handoff-dispatch",
  "npm run test:p1-handoff-dispatch-apply-csv",
  "npm run test:p1-handoff-issues",
  "npm run test:p1-github-connector-readiness",
  "npm run test:p1-handoff-issue-receipt",
  "npm run test:p1-evidence-intake-draft",
  "npm run test:p1-evidence-intake-apply-csv",
  "npm run test:p1-evidence-intake",
  "npm run test:p1-readiness",
  "npm run test:p1-operator-status",
  "npm run test:p1-operator-status-apply-external-blockers-csv",
  "npm run test:p1-completion-evidence",
  "npm run test:p1-completion-evidence-apply-csv",
  "npm run test:p1-release-package",
  "npm run test:p1-release-archive",
  "npm run test:p1-release-storage-receipt",
  "npm run test:owner-report-trends",
  "npm run test:owner-progress-report",
  "npm run test:owner-progress-report-draft",
  "npm run test:owner-briefing-package",
  "npm run test:payment-lifecycle",
  "npm run test:online-payments",
  "npm run test:recurring-billing",
  "npm run test:payment-provider-handoff-draft",
  "npm run test:payment-provider-handoff",
  "npm run test:notification-push-handoff-draft",
  "npm run test:notification-push-handoff",
  "npm run test:implementation-backlog",
  "npm run test:qa-plan",
  "npm run test:release-docs",
  "npm run test:p5-p10-internal-readiness",
  "npm run test:postgres-doctor",
  "npm run test:postgres-store",
  "npm run test:pilot",
  "npm run test:pilot-prelaunch-draft",
  "npm run test:pilot-launch-package",
  "npm run test:pilot-launch-command",
  "npm run test:pilot-readiness-evidence",
  "npm run test:pilot-readiness-evidence-apply",
  "npm run test:pilot-password-rotation",
  "npm run test:pilot-readiness-contract",
  "npm run test:attendance-speed",
  "npm run test:a11y-static",
  "npm run test:mobile-install",
  "npm run test:android-packaging",
  "npm run test:android-role-apks",
  "npm run android:twa:doctor",
  "npm run test:ios-capacitor-connection",
  "npm run ios:ipa:doctor",
  "npm run test:ios-provisioning-runbook",
  "npm run test:android-release-handoff-draft",
  "npm run test:android-release-handoff",
  "npm run test:notification-readiness",
];

function parseReleaseCommands(source) {
  const commands = new Set();
  const tuplePattern = /\[\s*"([^"]+)"\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?\s*\]/g;
  let match = tuplePattern.exec(source);

  while (match) {
    commands.add(["npm", match[1], match[2], match[3]].filter(Boolean).join(" "));
    match = tuplePattern.exec(source);
  }

  return commands;
}

function parseAdminGateCommands(source) {
  return new Set([...source.matchAll(/command:\s*"([^"]+)"/g)].map((match) => match[1]));
}

const [releaseRunnerSource, adminSettingsSource] = await Promise.all([
  readFile(releaseRunnerPath, "utf8"),
  readFile(adminSettingsPath, "utf8"),
]);
const releaseCommands = parseReleaseCommands(releaseRunnerSource);
const adminGateCommands = parseAdminGateCommands(adminSettingsSource);

assert.equal(adminGateCommands.size, 0, "/app/admin/settings must not embed automated gate commands in app source");
for (const snippet of [
  "showInternalReadinessPanels",
  "npm run",
  ".data/",
  "handoff",
  "doctor",
  "release blocker",
  "P3 운영 점검",
  "시뮬레이터 사용성 점검",
]) {
  assert(!adminSettingsSource.includes(snippet), `/app/admin/settings must not expose internal command wording: ${snippet}`);
}
assert(
  requiredAdminGateCommands.includes("npm run test:p5-p10-internal-readiness") &&
    releaseCommands.has("npm run test:p5-p10-internal-readiness") &&
    releaseCommands.has("npm run test:admin-settings-gates"),
  "test:release must keep admin settings and visible-copy readiness gates outside the app UI",
);
assert(
  adminSettingsSource.includes('data-testid="admin-settings-operation-header-summary"') &&
    !adminSettingsSource.includes("출석 {operationSummary.attendanceRecords}건") &&
    !adminSettingsSource.includes("결제 확인 {operationSummary.paymentChecks}건"),
  "/app/admin/settings operation header must stay a compact status line instead of multiple metric chips",
);
assert(
  adminSettingsSource.includes("다음 확인 {operationCoverage.nextRecommendedDate.slice(5)}") &&
    !adminSettingsSource.includes('<p className="text-[10px] font-semibold text-zinc-500">추천일</p>'),
  "/app/admin/settings operation summary must not return to dense three-card metric tiles",
);
assert(
  adminSettingsSource.includes('data-testid="admin-settings-incident-header-summary"') &&
    adminSettingsSource.includes("<p>새 이슈는 기록 버튼에서 추가</p>"),
  "/app/admin/settings incident area must avoid duplicate status summary cards by default",
);
assert(
  adminSettingsSource.includes('data-testid="admin-settings-policy-tab"') &&
    adminSettingsSource.includes('data-testid="admin-settings-operations-tab"') &&
    adminSettingsSource.includes('data-testid="admin-settings-policy-view"') &&
    adminSettingsSource.includes('data-testid="admin-settings-operations-view"'),
  "/app/admin/settings must separate policy and field-operation views",
);
for (const actionLabel of ["권한 기준 보기", "지점 정책 보기", "기록 항목 보기"]) {
  assert(adminSettingsSource.includes(actionLabel), `/app/admin/settings must use a specific detail action label: ${actionLabel}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "admin settings does not embed automated gate commands",
        "test:release keeps admin settings and visible-copy readiness gates outside the app UI",
        "raw npm, .data, handoff, doctor, release blocker, and simulator-only labels stay out of admin settings",
        "operation and incident defaults stay compact instead of dense cards",
        "policy and field-operation settings stay separated with specific detail actions",
      ],
      adminGateCommands: [...adminGateCommands],
    },
    null,
    2,
  ),
);
