import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const p5P10AuditPaths = {
  json: ".data/p5-p10-internal-audit.json",
  markdown: ".data/p5-p10-internal-audit.md",
};

const paymentCheckoutEvidencePath = ".data/mobile-builds/ios/payment-checkout-prep-20260628/evidence.json";

const reportFiles = {
  p1Readiness: ".data/p1-readiness.json",
  p1OperatorStatus: ".data/p1-operator-status.json",
  p1CompletionEvidence: ".data/p1-completion-evidence.json",
  androidTwaDoctor: ".data/android-twa-doctor.json",
  iosIpaDoctor: ".data/mobile-builds/ios/ios-ipa-doctor.json",
};

const expandedVisibleCopyScreenshots = [
  ["admin", "/app/dashboard", "admin-dashboard"],
  ["admin", "/app/classes", "admin-classes"],
  ["admin", "/app/members", "admin-members"],
  ["admin", "/app/payments", "admin-payments"],
  ["admin", "/app/notices", "admin-notices"],
  ["admin", "/app/account", "admin-account"],
  ["admin", "/app/admin/branches", "admin-branches"],
  ["admin", "/app/admin/users", "admin-users"],
  ["admin", "/app/admin/roles", "admin-roles"],
  ["admin", "/app/admin/audit-logs", "admin-audit"],
  ["admin", "/app/admin/settings", "admin-settings"],
  ["owner", "/app/dashboard", "owner-dashboard"],
  ["owner", "/app/classes", "owner-classes"],
  ["owner", "/app/members", "owner-members"],
  ["owner", "/app/payments", "owner-payments"],
  ["owner", "/app/notices", "owner-notices"],
  ["owner", "/app/account", "owner-account"],
  ["owner", "/app/owner/branches", "owner-branches"],
  ["owner", "/app/owner/reports", "owner-reports"],
  ["coach", "/app/dashboard", "coach-dashboard"],
  ["coach", "/app/classes", "coach-classes"],
  ["coach", "/app/members", "coach-members"],
  ["coach", "/app/notices", "coach-notices"],
  ["coach", "/app/account", "coach-account"],
  ["member", "/app/dashboard", "member-dashboard"],
  ["member", "/app/classes", "member-classes"],
  ["member", "/app/members", "member-members"],
  ["member", "/app/payments", "member-payments"],
  ["member", "/app/notices", "member-notices"],
  ["member", "/app/account", "member-account"],
  ["guardian", "/app/dashboard", "guardian-dashboard"],
  ["guardian", "/app/classes", "guardian-classes"],
  ["guardian", "/app/members", "guardian-members"],
  ["guardian", "/app/payments", "guardian-payments"],
  ["guardian", "/app/notices", "guardian-notices"],
  ["guardian", "/app/account", "guardian-account"],
].map(([role, route, name]) => ({
  path: `.data/mobile-builds/ios/visible-copy-expanded/${name}.png`,
  role,
  route,
}));

const screenshotFiles = [
  {
    path: ".data/mobile-builds/ios/p5-p10-simulator-screenshots/admin-settings-p5-p10.jpg",
    role: "admin",
    route: "/app/admin/settings#p5-p10-internal-readiness-heading",
  },
  {
    path: ".data/mobile-builds/ios/p5-p10-simulator-screenshots/coach-classes-p5.jpg",
    role: "coach",
    route: "/app/classes",
  },
  {
    path: ".data/mobile-builds/ios/p5-p10-simulator-screenshots/member-dashboard-p5.jpg",
    role: "member",
    route: "/app/dashboard",
  },
  {
    path: ".data/mobile-builds/ios/p5-p10-simulator-screenshots/guardian-dashboard-p5.jpg",
    role: "guardian",
    route: "/app/dashboard",
  },
  {
    path: ".data/mobile-builds/ios/stale-seed-date-roll/member-dashboard-date-roll.png",
    role: "member",
    route: "/app/dashboard",
  },
  {
    path: ".data/mobile-builds/ios/member-summary-cleanup/member-dashboard-no-summary-heading-browser.png",
    role: "member",
    route: "/app/dashboard",
  },
  {
    path: ".data/mobile-builds/ios/user-copy-compact-20260621/coach-classes-compact-copy-browser.png",
    role: "coach",
    route: "/app/classes",
  },
  {
    path: ".data/mobile-builds/ios/user-copy-compact-20260621/coach-account-compact-copy-browser.png",
    role: "coach",
    route: "/app/account",
  },
  {
    path: ".data/mobile-builds/ios/compact-empty-copy-20260621/member-payments-filter-empty-compact-copy-browser.png",
    role: "member",
    route: "/app/payments",
  },
  {
    path: ".data/mobile-builds/ios/payment-checkout-prep-20260628/member-payments-card.jpg",
    role: "member",
    route: "/app/payments",
  },
  {
    path: ".data/mobile-builds/ios/payment-checkout-prep-20260628/member-checkout-safearea.jpg",
    role: "member",
    route: "/app/payments/checkout?paymentId=pay-minjae",
  },
  {
    path: ".data/mobile-builds/ios/payment-checkout-prep-20260628/guardian-payments-card.jpg",
    role: "guardian",
    route: "/app/payments",
  },
  {
    path: ".data/mobile-builds/ios/payment-checkout-prep-20260628/guardian-checkout-ready.jpg",
    role: "guardian",
    route: "/app/payments/checkout?paymentId=pay-yuna",
  },
  {
    path: ".data/mobile-builds/ios/compact-empty-copy-20260621/owner-branches-compact-copy-browser.png",
    role: "owner",
    route: "/app/owner/branches",
  },
  {
    path: ".data/mobile-builds/ios/visible-text-audit-20260621-recheck/admin-app_admin_audit-logs.png",
    role: "admin",
    route: "/app/admin/audit-logs",
  },
  {
    path: ".data/mobile-builds/ios/visible-text-audit-20260621-recheck/coach-app_members.png",
    role: "coach",
    route: "/app/members",
  },
  ...expandedVisibleCopyScreenshots,
];

const externalBlockerKeys = [
  "deployment",
  "android",
  "iosIpa",
  "paymentProvider",
  "notificationPush",
  "issueRegistration",
  "pilot",
];

const phases = [
  {
    id: "P5",
    name: "모바일 사용성",
    decision: "internal-audited",
    evidence: [
      "admin/coach/member/guardian iOS Simulator screenshots",
      "role CSV and coach payment visibility guards",
      "safe-area header and coach save-status bottom inset guards",
      "coach save-status panel reserved mobile scroll space",
      "internal release/audit cards kept out of the app UI",
      "Next dev indicator disabled for clean simulator bottom navigation evidence",
      "autoLogin same-session deep links land on real service screens",
      "request route files stay deleted without request cards, forms, or actions",
      "expanded 36 route/role visible copy sweep has non-empty evidence",
      "stale local seed dates roll to current demo service dates without resetting runtime data",
      "member dashboard removes the extra summary heading and keeps the four status cards",
      "admin change record rendered copy uses app-safe wording instead of audit-log wording",
      "member/guardian payment cards route to internal checkout preparation without external PG/API integration",
    ],
  },
  {
    id: "P6",
    name: "역할별 운영 흐름",
    decision: "internal-audited",
    evidence: [
      "internal audit docs/artifacts",
      "coach classes flow",
      "member/guardian dashboard flow",
      "adult member direct payment and guardian child payment preparation flow",
    ],
  },
  {
    id: "P7",
    name: "파일럿 리허설",
    decision: "internal-audited-final-approval-blocked",
    evidence: ["pilot operator support gate", "pilot final approval kept as an external blocker"],
  },
  {
    id: "P8",
    name: "운영 안정성/자동화",
    decision: "internal-audited",
    evidence: ["release runner/admin settings gate alignment", "P3/P4/P5-P10 gates"],
  },
  {
    id: "P9",
    name: "배포 준비 패키지",
    decision: "internal-audited-handoff-blocked",
    evidence: ["Android TWA doctor blocked", "iOS App Store upload ready", "handoff locations documented"],
  },
  {
    id: "P10",
    name: "최종 내부 readiness audit",
    decision: "internal-audit-ready-release-blocked",
    evidence: [p5P10AuditPaths.json, p5P10AuditPaths.markdown, "P1 readiness tracks 7 external requirements"],
  },
];

function readJsonIfExists(file) {
  if (!existsSync(file)) {
    return null;
  }

  return JSON.parse(readFileSync(file, "utf8"));
}

function screenshotEvidence() {
  return screenshotFiles.map((screenshot) => {
    const exists = existsSync(screenshot.path);
    const stats = exists ? statSync(screenshot.path) : null;

    return {
      ...screenshot,
      exists,
      bytes: stats?.size ?? 0,
      updatedAt: stats?.mtime.toISOString() ?? null,
    };
  });
}

function reportEvidence() {
  return Object.fromEntries(
    Object.entries(reportFiles).map(([key, path]) => {
      const json = readJsonIfExists(path);

      return [
        key,
        {
          exists: Boolean(json),
          generatedAt: json?.generatedAt ?? null,
          ok: json?.ok ?? null,
          path,
          releaseDecision: json?.releaseDecision ?? null,
          summary: json?.summary ?? null,
        },
      ];
    }),
  );
}

function doctorBlockers(doctor) {
  return (doctor?.blockers ?? []).map((blocker) => blocker.key ?? blocker.check ?? blocker.id ?? blocker.requirement);
}

function p1Blockers(p1Readiness) {
  return (p1Readiness?.blockers ?? []).map((blocker) => blocker.key ?? blocker.check ?? blocker.id ?? blocker.requirement);
}

function paymentCheckoutEvidenceSummary(evidence) {
  return {
    path: paymentCheckoutEvidencePath,
    exists: Boolean(evidence),
    generatedAt: evidence?.generatedAt ?? null,
    updatedAt: evidence?.updatedAt ?? null,
    apiIntegration: evidence?.apiIntegration ?? null,
    screenshotCount: evidence?.screenshots?.length ?? 0,
    screenshotFiles: (evidence?.screenshots ?? []).map((screenshot) => screenshot.file),
    safeAreaFix: evidence?.safeAreaFix ?? null,
    caveats: evidence?.caveats ?? [],
  };
}

function buildMarkdown(audit) {
  const phaseRows = audit.phases
    .map((phase) => `| ${phase.id} | ${phase.name} | ${phase.decision} | ${phase.evidence.join("<br>")} |`)
    .join("\n");
  const screenshotRows = audit.evidence.screenshots
    .map(
      (screenshot) =>
        `| ${screenshot.role} | ${screenshot.route} | ${screenshot.exists ? "present" : "missing"} | ${screenshot.bytes} | ${screenshot.path} |`,
    )
    .join("\n");
  const blockerRows = audit.externalBlockers
    .map((blocker) => `| ${blocker.key} | ${blocker.status} | ${blocker.nextAction} |`)
    .join("\n");

  return `# P5~P10 내부 readiness audit

- Generated at: ${audit.generatedAt}
- Internal decision: ${audit.internalDecision}
- Release decision: ${audit.releaseDecision}
- P1 release decision: ${audit.p1.releaseDecision}
- Strict boundary: ${audit.strictBoundary}

## Phases

| Phase | Name | Decision | Evidence |
| --- | --- | --- | --- |
${phaseRows}

## Simulator Evidence

| Role | Route | State | Bytes | Path |
| --- | --- | --- | ---: | --- |
${screenshotRows}

## External Blockers

| Key | Status | Next action |
| --- | --- | --- |
${blockerRows}

## Guarded Assertions

${audit.guardedAssertions.map((assertion) => `- ${assertion}`).join("\n")}
`;
}

export function buildP5P10InternalAudit() {
  const p1Readiness = readJsonIfExists(reportFiles.p1Readiness);
  const androidTwaDoctor = readJsonIfExists(reportFiles.androidTwaDoctor);
  const iosIpaDoctor = readJsonIfExists(reportFiles.iosIpaDoctor);
  const paymentCheckoutEvidence = readJsonIfExists(paymentCheckoutEvidencePath);
  const screenshots = screenshotEvidence();
  const androidBlockerSet = new Set(doctorBlockers(androidTwaDoctor));
  const iosBlockerSet = new Set(doctorBlockers(iosIpaDoctor));
  const paymentCheckoutScreenshotFiles = new Set(
    (paymentCheckoutEvidence?.screenshots ?? []).map((screenshot) => screenshot.file),
  );
  const paymentCheckoutEvidenceReady =
    paymentCheckoutEvidence?.apiIntegration === false &&
    paymentCheckoutScreenshotFiles.has("member-payments-card.jpg") &&
    paymentCheckoutScreenshotFiles.has("member-checkout-ready.jpg") &&
    paymentCheckoutScreenshotFiles.has("member-checkout-safearea.jpg") &&
    paymentCheckoutScreenshotFiles.has("guardian-payments-card.jpg") &&
    paymentCheckoutScreenshotFiles.has("guardian-checkout-ready.jpg") &&
    paymentCheckoutEvidence?.safeAreaFix?.file === "member-checkout-safearea.jpg" &&
    (paymentCheckoutEvidence?.caveats ?? []).some((caveat) =>
      caveat.includes("not IPA ready or payment provider ready"),
    );

  const externalRequirements = externalBlockerKeys.map((key) => ({
    key,
    status: p1Readiness?.requirements?.[key]?.status ?? "missing-from-p1-readiness",
    nextAction: p1Readiness?.requirements?.[key]?.nextAction ?? "",
  }));
  const externalBlockers = externalRequirements.filter((requirement) => requirement.status === "blocked");
  const readinessCountsReconcile =
    (p1Readiness?.summary?.ready ?? 0) +
      (p1Readiness?.summary?.missing ?? 0) +
      (p1Readiness?.summary?.blocked ?? 0) ===
    p1Readiness?.summary?.total;

  const requiredInternalEvidenceReady =
    p1Readiness?.releaseDecision === "blocked" &&
    p1Readiness?.summary?.total === 7 &&
    readinessCountsReconcile &&
    (p1Readiness?.summary?.blocked ?? 0) > 0 &&
    p1Readiness?.requirements?.iosIpa?.status === "ready" &&
    externalRequirements.every((requirement) => ["ready", "blocked"].includes(requirement.status)) &&
    externalBlockers.every((blocker) => blocker.status === "blocked") &&
    screenshots.every((screenshot) => screenshot.exists && screenshot.bytes > 10_000) &&
    paymentCheckoutEvidenceReady &&
    androidTwaDoctor?.ok === false &&
    androidTwaDoctor?.checks?.origin?.ok === true &&
    androidTwaDoctor?.checks?.origin?.value === "https://final-judo.vercel.app" &&
    !androidBlockerSet.has("origin") &&
    androidBlockerSet.has("sha256") &&
    iosIpaDoctor?.releaseDecision === "ready" &&
    iosIpaDoctor?.checks?.origin?.ok === true &&
    iosIpaDoctor?.checks?.origin?.value === "https://final-judo.vercel.app" &&
    !iosBlockerSet.has("origin") &&
    !iosBlockerSet.has("provisioningProfile") &&
    (iosIpaDoctor?.checks?.provisioningProfile?.inventory?.matchingExportMethodProfiles ?? 0) > 0;

  return {
    ok: requiredInternalEvidenceReady,
    generatedAt: new Date().toISOString(),
    internalDecision: requiredInternalEvidenceReady
      ? "p5_p10_internal_audit_ready_release_blocked"
      : "p5_p10_internal_audit_needs_attention_release_blocked",
    releaseDecision: "blocked",
    strictBoundary:
      "P5~P10 내부 audit 통과는 출시 완료나 운영 ready를 뜻하지 않으며, 해결된 iOS 업로드와 남은 P1 외부 blocker를 구분한다.",
    p1: {
      blockerKeys: p1Blockers(p1Readiness),
      releaseDecision: p1Readiness?.releaseDecision ?? null,
      summary: p1Readiness?.summary ?? null,
    },
    externalRequirements,
    externalBlockers,
    phases,
    evidence: {
      reports: reportEvidence(),
      screenshots,
      androidDoctorBlockers: [...androidBlockerSet],
      iosIpaDoctorBlockers: [...iosBlockerSet],
      paymentCheckout: paymentCheckoutEvidenceSummary(paymentCheckoutEvidence),
    },
    guardedAssertions: [
      "iOS Simulator 성공을 IPA ready로 보지 않음",
      "Android 역할 APK 산출을 Android release handoff ready로 보지 않음",
      "결제 준비 흐름은 내부 화면까지만 확인하며 외부 PG/API 연결 완료로 보지 않음",
      "회원/학부모 CSV 내보내기 비노출 유지",
      "코치 화면 결제 금액/민감 운영정보 비노출 유지",
      "P5~P10 내부 release/audit 카드는 실제 앱 UI에 노출하지 않음",
      "코치 모바일 저장 상태 패널이 하단 내비게이션과 iOS safe area를 침범하지 않음",
      "코치 모바일 저장 상태 패널 아래 콘텐츠가 가려지지 않도록 모바일 스크롤 여백을 확보함",
      "Next 개발 표시 배지가 모바일 하단 내비게이션 캡처를 가리지 않음",
      "역할별 autoLogin deep link가 이미 로그인된 같은 역할 세션에서도 실제 서비스 화면으로 이동함",
      "관리자 변경 기록 화면은 감사 로그 문구 대신 변경 기록 문구를 렌더링함",
      "judokan.store 참고값을 finaljudo 확정값으로 자동 치환하지 않음",
      "운영 URL, PG, 운영 푸시, issue receipt, 파일럿 최종 승인 증빙 전 ready 처리 금지",
      "요청 라우트/API 파일 삭제를 유지하고 요청 카드/작성 폼/승인 액션을 노출하지 않음",
    ],
  };
}

export function writeP5P10InternalAudit({ quiet = false } = {}) {
  const audit = buildP5P10InternalAudit();
  const markdown = buildMarkdown(audit);

  mkdirSync(dirname(p5P10AuditPaths.json), { recursive: true });
  writeFileSync(p5P10AuditPaths.json, `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(p5P10AuditPaths.markdown, `${markdown}\n`);

  if (!quiet) {
    console.log(JSON.stringify({ ok: audit.ok, paths: p5P10AuditPaths, releaseDecision: audit.releaseDecision }, null, 2));
  }

  return audit;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  writeP5P10InternalAudit({ quiet: process.argv.includes("--quiet") });
}
