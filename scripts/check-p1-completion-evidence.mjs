import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const operatorStatusPath = path.resolve(args.operatorStatus ?? path.join(workspace, "p1-operator-status.json"));
const outPath = args.out ? path.resolve(args.out) : null;
const markdownPath = args.markdown ? path.resolve(args.markdown) : null;
const csvPath = args.csv ? path.resolve(args.csv) : null;

const criteriaDefinitions = [
  {
    key: "p0Regression",
    label: "P0 핵심 기능 유지",
    evidenceCommands: [
      "npm run test:unit",
      "npm run test:role-csv-export-gates",
      "npm run test:routes",
      "npm run test:e2e",
      "npm run test:smoke",
      "npm run test:db",
      "npm run test:postgres-store",
    ],
    evidenceFiles: ["docs/QA_TEST_PLAN.md", "docs/RELEASE_CHECKLIST.md"],
    evidenceNotes: ["회원/학부모 CSV export API 403 smoke 증거"],
  },
  {
    key: "mobileAccount",
    label: "모바일 로그인/로그아웃/계정 전환",
    evidenceCommands: ["npm run test:e2e", "npm run test:mobile-install"],
    evidenceFiles: ["src/components/shell/app-shell.tsx", "src/components/screens/account-screen.tsx"],
  },
  {
    key: "androidPackaging",
    label: "Android 앱 패키징 전략/APK-AAB",
    evidenceCommands: [
      "npm run test:android-packaging",
      "npm run test:android-role-apks",
      "npm run android:twa:doctor",
      "npm run test:android-release-handoff-draft",
      "npm run test:android-release-handoff",
    ],
    evidenceFiles: [
      "docs/ANDROID_PACKAGING_STRATEGY.md",
      "mobile/android",
      "mobile/android/release-handoff.template.json",
      ".github/workflows/android-twa.yml",
    ],
    evidenceNotes: ["Android release handoff는 주소창/공유/더보기 브라우저 UI 비노출 smoke 증빙이 필요함"],
    externalBlockerKeys: ["android"],
    supportArtifactKeys: ["androidDoctor", "androidDoctorMarkdown", "androidRoleApks"],
  },
  {
    key: "pwaInstall",
    label: "PWA/모바일 앱 설치 흐름",
    evidenceCommands: ["npm run test:mobile-install", "npm run test:ios-capacitor-connection", "npm run ios:ipa:doctor"],
    evidenceFiles: [
      "src/app/manifest.ts",
      "public/sw.js",
      "src/components/pwa/install-app-action.tsx",
      "mobile/ios/App/App.xcodeproj",
      ".data/mobile-builds/ios/ios-capacitor-connection.json",
      ".data/mobile-builds/ios/ios-ipa-doctor.json",
      ".data/mobile-builds/ios/ios-ipa-doctor.md",
      ".data/mobile-builds/ios/ios-ipa-build-report.json",
    ],
    externalBlockerKeys: ["iosIpa"],
    supportArtifactKeys: ["iosCapacitorConnection", "iosIpaDoctor", "iosIpaDoctorMarkdown"],
  },
  {
    key: "ownerReports",
    label: "대표 리포트 운영 판단 고도화",
    evidenceCommands: ["npm run test:owner-report-trends"],
    evidenceFiles: ["src/components/screens/owner-reports-screen.tsx", "src/lib/owner-reporting.ts"],
  },
  {
    key: "paymentsMembership",
    label: "결제/회원권 상태 관리 실무 개선",
    evidenceCommands: [
      "npm run test:payment-lifecycle",
      "npm run test:online-payments",
      "npm run test:recurring-billing",
      "npm run test:payment-provider-handoff",
    ],
    evidenceFiles: ["src/components/screens/payments-screen.tsx", "src/lib/payment-lifecycle.ts", "docs/payment-provider-handoff.template.json"],
    externalBlockerKeys: ["paymentProvider"],
  },
  {
    key: "noticesNotifications",
    label: "공지/알림 흐름 개선",
    evidenceCommands: ["npm run test:notification-readiness", "npm run test:notification-push-handoff"],
    evidenceFiles: ["src/components/screens/notices-screen.tsx", "src/server/push-notifications.ts", "docs/notification-push-handoff.template.json"],
    externalBlockerKeys: ["notificationPush"],
  },
  {
    key: "pilotOperationsSupport",
    label: "파일럿 운영 지원 UI/문서 보강",
    evidenceCommands: ["npm run test:pilot-operator-support", "npm run test:pilot-status", "npm run test:p1-operator-status"],
    evidenceFiles: ["src/components/screens/admin-settings-screen.tsx", "docs/QA_TEST_PLAN.md", "docs/RELEASE_CHECKLIST.md"],
    externalBlockerKeys: ["deployment", "issueRegistration", "pilot"],
  },
  {
    key: "rbacScopeAudit",
    label: "권한/지점 스코프/감사 로그 원칙 유지",
    evidenceCommands: [
      "npm run test:unit",
      "npm run test:role-csv-export-gates",
      "npm run test:auth-production-guard",
      "npm run test:smoke",
      "npm run test:admin-settings-gates",
    ],
    evidenceFiles: ["src/server/api.ts", "src/lib/roles.ts", "src/app/api/v1/admin/audit-logs/route.ts"],
    evidenceNotes: ["회원/학부모 CSV export API 403 smoke 증거"],
  },
  {
    key: "p1TestsDocsBuild",
    label: "P1 테스트/문서/최종 빌드 게이트",
    evidenceCommands: [
      "npm run lint",
      "npm run build",
      "npm run test:release",
      "npm run test:p1-readiness",
      "npm run test:p1-operator-status",
      "npm run test:release-docs",
    ],
    evidenceFiles: ["README.md", "docs/IMPLEMENTATION_BACKLOG.md", "docs/QA_TEST_PLAN.md", "docs/RELEASE_CHECKLIST.md"],
  },
];

function parseArgs(argv) {
  const parsed = { allowPending: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--allow-pending") {
      parsed.allowPending = true;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    parsed[key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }

  return parsed;
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function text(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

async function readJson(filePath) {
  try {
    const source = await readFile(filePath, "utf8");

    if (hasSecretLikeSource(source)) {
      return { exists: true, json: null, error: "secret-like value" };
    }

    return { exists: true, json: JSON.parse(source), error: null };
  } catch (error) {
    return {
      exists: false,
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function supportArtifactsByKey(operatorStatus) {
  const supportArtifacts = Array.isArray(operatorStatus?.supportArtifacts) ? operatorStatus.supportArtifacts : [];
  return new Map(supportArtifacts.map((artifact) => [text(artifact?.key), artifact]));
}

const diagnosticSupportArtifactKeys = new Set(["androidDoctor", "iosIpaDoctor"]);

function isDiagnosticBlockedSupportArtifact(artifact) {
  return (
    diagnosticSupportArtifactKeys.has(text(artifact?.key)) &&
    text(artifact?.status) === "blocked" &&
    (Array.isArray(artifact?.blockerChecks) ? artifact.blockerChecks.length > 0 : Number(artifact?.blockerCount ?? 0) > 0)
  );
}

function classifyCriterion(definition, operatorStatus, operatorReadResult) {
  if (!operatorReadResult.exists || !operatorStatus) {
    return {
      ...definition,
      status: "needs_evidence",
      statusLabel: "상태판 필요",
      externalBlockers: [],
      supportArtifacts: [],
      message: "P1 operator status 산출물이 없어 완료 기준을 판정할 수 없습니다.",
      nextAction:
        "npm run p1:operator-status -- --workspace=.data --allow-pending --out=.data/p1-operator-status.json --markdown=.data/p1-operator-status.md --external-blockers-csv=.data/p1-operator-status-external-blockers.csv",
    };
  }

  const externalBlockers = Array.isArray(operatorStatus.externalBlockers) ? operatorStatus.externalBlockers : [];
  const supportArtifacts = supportArtifactsByKey(operatorStatus);
  const matchedExternalBlockers = externalBlockers.filter((blocker) =>
    (definition.externalBlockerKeys ?? []).includes(text(blocker?.key)),
  );
  const matchedSupportArtifacts = (definition.supportArtifactKeys ?? []).map(
    (key) =>
      supportArtifacts.get(key) ?? {
        key,
        label: key,
        status: "missing",
        releaseDecision: "missing",
        nextAction: "필수 support artifact를 생성한 뒤 P1 operator status를 다시 실행합니다.",
      },
  );
  const blockedSupportArtifacts = matchedSupportArtifacts.filter((artifact) => text(artifact?.status) !== "ready");
  const hardBlockedSupportArtifacts = blockedSupportArtifacts.filter((artifact) => !isDiagnosticBlockedSupportArtifact(artifact));

  if (hardBlockedSupportArtifacts.length > 0) {
    return {
      ...definition,
      status: "blocked_internal",
      statusLabel: "내부 산출물 보강",
      externalBlockers: matchedExternalBlockers,
      supportArtifacts: matchedSupportArtifacts,
      message: "완료 기준에 연결된 내부 support artifact가 아직 ready가 아닙니다.",
      nextAction:
        hardBlockedSupportArtifacts.map((artifact) => text(artifact?.nextAction)).find(Boolean) ??
        "관련 support artifact를 ready 상태로 만든 뒤 다시 실행합니다.",
    };
  }

  if (matchedExternalBlockers.length > 0) {
    const diagnosticBlocked = blockedSupportArtifacts.some((artifact) => isDiagnosticBlockedSupportArtifact(artifact));

    return {
      ...definition,
      status: "blocked_external",
      statusLabel: "외부 증빙 대기",
      externalBlockers: matchedExternalBlockers,
      supportArtifacts: matchedSupportArtifacts,
      message: diagnosticBlocked
        ? "진단 산출물은 생성됐고 실제 운영 증빙/릴리즈 환경 준비가 아직 남아 있습니다."
        : "내부 구현/검증 경로는 있으나 실제 운영 증빙이 아직 남아 있습니다.",
      nextAction:
        matchedExternalBlockers.map((blocker) => text(blocker?.nextAction)).find(Boolean) ??
        "외부 handoff 증빙을 채운 뒤 P1 readiness를 재실행합니다.",
    };
  }

  if (blockedSupportArtifacts.length > 0) {
    return {
      ...definition,
      status: "blocked_internal",
      statusLabel: "내부 산출물 보강",
      externalBlockers: matchedExternalBlockers,
      supportArtifacts: matchedSupportArtifacts,
      message: "완료 기준에 연결된 진단 support artifact가 blocked이며 대응할 외부 blocker가 없습니다.",
      nextAction:
        blockedSupportArtifacts.map((artifact) => text(artifact?.nextAction)).find(Boolean) ??
        "관련 support artifact를 ready 상태로 만든 뒤 다시 실행합니다.",
    };
  }

  const operatorReady = operatorStatus.ok === true && operatorStatus.releaseDecision === "ready";

  return {
    ...definition,
    status: operatorReady ? "ready" : "ready_internal",
    statusLabel: operatorReady ? "완료" : "내부 완료",
    externalBlockers: [],
    supportArtifacts: matchedSupportArtifacts,
    message: operatorReady ? "P1 operator status 기준 최종 ready입니다." : "코드/문서/자동 검증 기준 내부 완료이며 외부 blocker 해소 후 최종 ready로 승격됩니다.",
    nextAction: operatorReady ? "" : "남은 외부 blocker를 해소한 뒤 P1 operator status와 completion evidence를 strict 모드로 다시 실행합니다.",
  };
}

function blockerForCriterion(criterion) {
  const code =
    criterion.status === "needs_evidence"
      ? "P1_COMPLETION_OPERATOR_STATUS_MISSING"
      : criterion.status === "blocked_internal"
        ? "P1_COMPLETION_INTERNAL_ARTIFACT_BLOCKED"
        : "P1_COMPLETION_EXTERNAL_BLOCKERS";

  return {
    code,
    key: criterion.key,
    label: criterion.label,
    status: criterion.status,
    message: criterion.message,
    nextAction: criterion.nextAction,
    externalBlockerKeys: criterion.externalBlockers.map((blocker) => text(blocker?.key)).filter(Boolean),
  };
}

function statusCounts(criteria) {
  return criteria.reduce((counts, criterion) => {
    counts[criterion.status] = (counts[criterion.status] ?? 0) + 1;
    return counts;
  }, {});
}

function csvCell(value) {
  const normalized = text(value).replace(/\r?\n/g, " ");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function createCsv(report) {
  const fields = [
    "criterionKey",
    "criterionLabel",
    "status",
    "statusLabel",
    "message",
    "externalBlockers",
    "supportArtifacts",
    "evidenceCommands",
    "evidenceFiles",
    "releaseCustodyReady",
    "nextAction",
    "evidenceOwner",
    "evidenceUrl",
    "checkedAt",
    "signoff",
    "notes",
  ];
  const rows = report.criteria.map((criterion) => ({
    criterionKey: criterion.key,
    criterionLabel: criterion.label,
    status: criterion.status,
    statusLabel: criterion.statusLabel,
    message: criterion.message,
    externalBlockers: criterion.externalBlockers.map((blocker) => `${blocker.key}:${blocker.status}`).join(" | "),
    supportArtifacts: criterion.supportArtifacts.map((artifact) => `${artifact.key}:${artifact.status}`).join(" | "),
    evidenceCommands: criterion.evidenceCommands.join(" | "),
    evidenceFiles: criterion.evidenceFiles.join(" | "),
    releaseCustodyReady: report.releaseCustody.ready ? "yes" : "no",
    nextAction: criterion.nextAction,
    evidenceOwner: "",
    evidenceUrl: "",
    checkedAt: "",
    signoff: "",
    notes: (criterion.evidenceNotes ?? []).join(" | "),
  }));

  return `${[fields.join(","), ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(","))].join("\n")}\n`;
}

function createMarkdown(report) {
  const lines = [
    "# P1 Completion Evidence Matrix",
    "",
    `- Release decision: \`${report.releaseDecision}\``,
    `- P1 completion ready: ${report.ok ? "yes" : "no"}`,
    `- Criteria: ${report.summary.ready}/${report.summary.totalCriteria} ready, ${report.summary.readyInternal} internal-ready, ${report.summary.blockedInternal} internal-blocked, ${report.summary.blockedExternal} external-blocked`,
    `- Operator status: \`${report.operatorStatusPath}\``,
    `- External blockers: ${report.summary.externalBlockers}`,
    `- Release custody ready: ${report.releaseCustody.ready ? "yes" : "no"}`,
    "",
    "## Criteria",
    "",
    "| Criterion | Status | External blockers | Support artifacts | Evidence commands | Evidence files | Evidence notes | Next action |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const criterion of report.criteria) {
    lines.push(
      `| ${criterion.label} | ${criterion.status} | ${criterion.externalBlockers.map((blocker) => blocker.key).join(", ") || "-"} | ${criterion.supportArtifacts.map((artifact) => `${artifact.key}:${artifact.status}`).join("<br>") || "-"} | ${criterion.evidenceCommands.join("<br>")} | ${criterion.evidenceFiles.join("<br>") || "-"} | ${(criterion.evidenceNotes ?? []).join("<br>") || "-"} | ${criterion.nextAction || "-"} |`,
    );
  }

  lines.push("", "## External Blockers", "");

  if (report.externalBlockers.length === 0) {
    lines.push("- No external blockers remain.");
  } else {
    lines.push("| Key | Owner lane | Evidence type | Next action |", "| --- | --- | --- | --- |");

    for (const blocker of report.externalBlockers) {
      lines.push(
        `| ${blocker.key} | ${blocker.ownerLane ?? ""} | ${blocker.evidenceType ?? ""} | ${blocker.nextAction ?? ""} |`,
      );
    }
  }

  lines.push("", "## Next Actions", "");

  if (report.nextActions.length === 0) {
    lines.push("- No remaining P1 completion actions.");
  } else {
    for (const action of report.nextActions) {
      lines.push(`- ${action}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

const operatorReadResult = await readJson(operatorStatusPath);
const operatorStatus = operatorReadResult.json;
const criteria = criteriaDefinitions.map((definition) => classifyCriterion(definition, operatorStatus, operatorReadResult));
const blockers = criteria
  .filter((criterion) => ["needs_evidence", "blocked_internal", "blocked_external"].includes(criterion.status))
  .map(blockerForCriterion);
const counts = statusCounts(criteria);
const externalBlockers = Array.isArray(operatorStatus?.externalBlockers) ? operatorStatus.externalBlockers : [];
const nextActions = [
  ...new Set(
    [
      ...criteria.filter((criterion) => criterion.status !== "ready").map((criterion) => criterion.nextAction),
      ...(Array.isArray(operatorStatus?.nextActions) ? operatorStatus.nextActions : []),
    ]
      .map(text)
      .filter(Boolean),
  ),
];

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  workspace: rel(workspace),
  operatorStatusPath: rel(operatorStatusPath),
  csv: csvPath ? rel(csvPath) : null,
  checked: [
    "10 P1 completion criteria mapped to authoritative evidence",
    "completion evidence CSV handoff matrix",
    "P0 regression, role CSV export gate, and member/guardian CSV API 403 smoke evidence commands",
    "mobile account, PWA install, iOS Capacitor, and iOS IPA doctor evidence commands",
    "Android strategy, role APK report, doctor JSON/Markdown, and APK/AAB external evidence blocker",
    "owner reports, payment lifecycle, notices, pilot support evidence",
    "RBAC/branch scope/audit, role CSV export, and member/guardian CSV API 403 smoke evidence",
    "P1 docs/tests/build release gate evidence",
    "P1 operator status external blockers and release custody state",
    "secret-like value guard for completion evidence input",
  ],
  summary: {
    totalCriteria: criteria.length,
    ready: counts.ready ?? 0,
    readyInternal: counts.ready_internal ?? 0,
    blockedExternal: counts.blocked_external ?? 0,
    blockedInternal: counts.blocked_internal ?? 0,
    needsEvidence: counts.needs_evidence ?? 0,
    externalBlockers: externalBlockers.length,
  },
  releaseCustody: {
    prerequisitesReady: operatorStatus?.releaseCustody?.prerequisitesReady === true,
    ready: operatorStatus?.releaseCustody?.ready === true,
    packageReady: operatorStatus?.releaseCustody?.packageReady === true,
    archiveReady: operatorStatus?.releaseCustody?.archiveReady === true,
    storageReceiptReady: operatorStatus?.releaseCustody?.storageReceiptReady === true,
  },
  criteria,
  externalBlockers,
  nextActions,
  blockers,
};

if (outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (markdownPath) {
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, createMarkdown(report));
}

if (csvPath) {
  await mkdir(path.dirname(csvPath), { recursive: true });
  await writeFile(csvPath, createCsv(report));
}

console.log(JSON.stringify(report, null, 2));

if (!args.allowPending && blockers.length > 0) {
  process.exit(1);
}
