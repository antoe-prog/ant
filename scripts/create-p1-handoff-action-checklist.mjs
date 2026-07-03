import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const ownerBriefsDir = path.resolve(args.ownerBriefsDir ?? path.join(workspace, "p1-handoff-owner-briefs"));
const ownerPackagesDir = path.resolve(args.ownerPackagesDir ?? path.join(workspace, "p1-handoff-owner-packages"));
const teamAgentPromptsSource = rel(path.resolve(args.teamAgentPrompts ?? "docs/TEAM_AGENT_PROMPTS.md"));
const fileOutputs = {
  brief: path.resolve(args.brief ?? path.join(workspace, "p1-handoff-action-brief.md")),
  csv: path.resolve(args.csv ?? path.join(workspace, "p1-handoff-action-checklist.csv")),
  json: path.resolve(args.json ?? path.join(workspace, "p1-handoff-action-checklist.json")),
  markdown: path.resolve(args.markdown ?? path.join(workspace, "p1-handoff-action-checklist.md")),
  ownerPackageIndex: path.resolve(args.ownerPackageIndex ?? path.join(workspace, "p1-handoff-owner-package-index.md")),
};
const outputs = {
  ...fileOutputs,
  ownerBriefsDir,
  ownerPackagesDir,
};

const sources = [
  {
    key: "deployment",
    label: "운영 배포 handoff",
    ownerRole: "DevOps/총괄 PM",
    priorityBase: 10,
    teamAgent: "Product Lead + QA/Release",
    report: path.join(workspace, "deployment-handoff.report.json"),
    draft: path.join(workspace, "deployment-handoff.json"),
    strictCommand:
      "npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json",
    nextAction: "운영 secret store, production preflight, 배포 URL, signoff 증빙을 채웁니다.",
  },
  {
    key: "android",
    label: "Android release handoff",
    ownerRole: "Mobile/Release",
    priorityBase: 20,
    teamAgent: "Frontend + QA/Release",
    report: path.join(workspace, "android-release-handoff.report.json"),
    draft: path.join(workspace, "android-release-handoff.json"),
    strictCommand:
      "npm run android:release-handoff -- --file=.data/android-release-handoff.json --out=.data/android-release-handoff.report.json",
    nextAction: "운영 HTTPS 웹앱 origin, release SHA-256, JDK/Android SDK, APK/AAB, 실기기 smoke 증빙을 채웁니다.",
  },
  {
    key: "iosIpa",
    label: "iOS IPA build/provisioning",
    ownerRole: "iOS/Release",
    priorityBase: 30,
    teamAgent: "Frontend + QA/Release",
    report: path.join(workspace, "mobile-builds", "ios", "ios-ipa-build-report.json"),
    draft: path.join(workspace, "mobile-builds", "ios", "ios-ipa-doctor.json"),
    strictCommand:
      "npm run ios:ipa:doctor -- --team-id=<TEAM_ID> --origin=https://<webapp-origin> --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md && npm run ios:ipa:build -- --team-id=<TEAM_ID> --origin=https://<webapp-origin> --xcode-export-method=release-testing --allow-provisioning-updates --out-dir=.data/mobile-builds/ios",
    nextAction:
      "운영 HTTPS 웹앱 origin, 실제 iPhone UDID 등록, provisioning profile 설치, IPA archive/export 증빙을 채웁니다.",
  },
  {
    key: "paymentProvider",
    label: "결제 provider handoff",
    ownerRole: "Finance/Backend",
    priorityBase: 40,
    teamAgent: "Backend/Data + QA/Release",
    report: path.join(workspace, "payment-provider-handoff.report.json"),
    draft: path.join(workspace, "payment-provider-handoff.json"),
    strictCommand:
      "npm run payment-provider:handoff -- --file=.data/payment-provider-handoff.json --out=.data/payment-provider-handoff.report.json",
    nextAction: "실 PG/VAN 계약, checkout, webhook 서명/idempotency, billing key 보관 증빙을 채웁니다.",
  },
  {
    key: "notificationPush",
    label: "운영 푸시 handoff",
    ownerRole: "Ops/Frontend",
    priorityBase: 50,
    teamAgent: "Frontend + Backend/Data",
    report: path.join(workspace, "notification-push-handoff.report.json"),
    draft: path.join(workspace, "notification-push-handoff.json"),
    strictCommand:
      "npm run notification-push:handoff -- --file=.data/notification-push-handoff.json --out=.data/notification-push-handoff.report.json",
    nextAction: "운영 VAPID secret store, Android 실기기 구독/수신/클릭, 공지 push 발송 증빙을 채웁니다.",
  },
  {
    key: "pilot",
    label: "파일럿 최종 status",
    ownerRole: "Pilot PM/현장 운영",
    priorityBase: 60,
    teamAgent: "Product Lead + UX/IA + QA/Release",
    report: path.join(workspace, "pilot-status.json"),
    draft: path.join(workspace, "pilot-status.json"),
    strictCommand: "npm run pilot:status -- --strict --out=.data/pilot-status.json",
    nextAction: "파일럿 준비, 비밀번호 교체, 14일 운영 로그, archive/storage/final handoff 산출물을 채웁니다.",
  },
];

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    const normalizedKey = key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[normalizedKey] = value;
  }

  return parsed;
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

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function redactString(value) {
  return text(value)
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, "[redacted-private-key]")
    .replace(/\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/g, "[redacted-secret]")
    .replace(/FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/g, "[redacted-password]");
}

function redactDetail(value, key = "") {
  if (value === null || value === undefined) {
    return value;
  }

  if (/secret|private|password|token/i.test(key)) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDetail(item, key));
  }

  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactDetail(entryValue, entryKey)]));
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  return value;
}

function detailSummary(detail) {
  if (detail === null || detail === undefined) {
    return "";
  }

  return JSON.stringify(redactDetail(detail));
}

async function readJson(filePath) {
  try {
    const source = await readFile(filePath, "utf8");
    return { exists: true, json: JSON.parse(source), error: null };
  } catch (error) {
    return {
      exists: false,
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function nextActionFor(source, document, blocker) {
  return (
    text(blocker?.nextAction) ||
    text(document?.nextAction) ||
    (Array.isArray(document?.nextActions) ? document.nextActions.map(text).find(Boolean) : "") ||
    source.nextAction
  );
}

function rowFor(source, document, blocker, index) {
  const status = text(blocker?.status) || (document?.releaseDecision === "ready" ? "ready" : "blocked");
  const blockerCode = text(blocker?.code) || text(blocker?.check) || `${source.key.toUpperCase()}_REPORT_NOT_READY`;
  const blockerMessage =
    text(blocker?.message) || text(blocker?.reason) || text(blocker?.description) || "리포트가 ready 상태가 아닙니다.";

  return {
    id: `${source.key}-${String(index + 1).padStart(3, "0")}`,
    priority: source.priorityBase * 1000 + index + 1,
    status,
    areaKey: source.key,
    areaLabel: source.label,
    ownerRole: source.ownerRole,
    teamAgent: source.teamAgent,
    blockerCode,
    blockerMessage: redactString(blockerMessage),
    detail: detailSummary(blocker?.detail),
    evidenceDraft: rel(source.draft),
    sourceReport: rel(source.report),
    strictCommand: source.strictCommand,
    nextAction: nextActionFor(source, document, blocker),
  };
}

async function collectRows(source) {
  const readResult = await readJson(source.report);

  if (!readResult.exists) {
    return {
      source: {
        key: source.key,
        label: source.label,
        status: "missing",
        report: rel(source.report),
        blockerCount: 1,
      },
      rows: [
        rowFor(
          source,
          { releaseDecision: "blocked", nextAction: source.nextAction },
          {
            code: `${source.key.toUpperCase()}_REPORT_MISSING`,
            message: "필수 P1 handoff 리포트가 아직 없습니다.",
            status: "missing",
            detail: { path: rel(source.report), error: readResult.error },
          },
          0,
        ),
      ],
    };
  }

  const blockers = Array.isArray(readResult.json?.blockers) ? readResult.json.blockers : [];

  if (blockers.length === 0 && readResult.json?.releaseDecision !== "ready") {
    blockers.push({
      code: `${source.key.toUpperCase()}_REPORT_BLOCKED_WITHOUT_BLOCKERS`,
      message: "리포트가 ready 상태가 아니지만 blocker 목록이 비어 있습니다.",
    });
  }

  return {
    source: {
      key: source.key,
      label: source.label,
      status: readResult.json?.releaseDecision === "ready" && blockers.length === 0 ? "ready" : "blocked",
      generatedAt: readResult.json?.generatedAt ?? null,
      report: rel(source.report),
      blockerCount: blockers.length,
    },
    rows: blockers.map((blocker, index) => rowFor(source, readResult.json, blocker, index)),
  };
}

function csvCell(value) {
  const normalized = text(value).replace(/\r?\n/g, " ");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function toCsv(rows) {
  const fields = [
    "id",
    "priority",
    "status",
    "areaKey",
    "areaLabel",
    "ownerRole",
    "teamAgent",
    "blockerCode",
    "blockerMessage",
    "detail",
    "evidenceDraft",
    "sourceReport",
    "strictCommand",
    "nextAction",
  ];

  return `${fields.join(",")}\n${rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")).join("\n")}\n`;
}

function markdownCell(value) {
  return text(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function teamSummaryFor(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = row.ownerRole;
    const group =
      groups.get(key) ??
      {
        ownerRole: row.ownerRole,
        teamAgents: [],
        areaLabels: [],
        evidenceDrafts: [],
        sourceReports: [],
        strictCommands: [],
        totalActions: 0,
        topActions: [],
      };

    group.teamAgents.push(row.teamAgent);
    group.areaLabels.push(row.areaLabel);
    group.evidenceDrafts.push(row.evidenceDraft);
    group.sourceReports.push(row.sourceReport);
    group.strictCommands.push(row.strictCommand);
    group.totalActions += 1;

    if (group.topActions.length < 3) {
      group.topActions.push({
        id: row.id,
        priority: row.priority,
        status: row.status,
        blockerCode: row.blockerCode,
        blockerMessage: row.blockerMessage,
        nextAction: row.nextAction,
      });
    }

    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    teamAgents: unique(group.teamAgents),
    areaLabels: unique(group.areaLabels),
    evidenceDrafts: unique(group.evidenceDrafts),
    sourceReports: unique(group.sourceReports),
    strictCommands: unique(group.strictCommands),
  }));
}

function toBriefMarkdown(report) {
  const lines = [
    "# P1 Handoff Action Brief",
    "",
    `- 생성 시각: ${report.generatedAt}`,
    `- Workspace: \`${report.workspace}\``,
    `- Release decision: \`${report.releaseDecision}\``,
    `- 남은 action: ${report.summary.totalActions}`,
    "",
    "## 6인 팀 실행 순서",
    "",
  ];

  if (report.summary.totalActions === 0) {
    lines.push(
      "- 남은 handoff action이 없습니다. bundle/dispatch/issue registration receipt를 보관한 뒤 `npm run p1:readiness -- --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md` strict 통과 후 release package를 생성합니다.",
    );
  } else {
    lines.push(
      `1. Product Lead: ${report.summary.sources}개 handoff/IPA 리포트의 release decision과 차단 순서를 확정합니다.`,
      "2. QA/Release: 각 owner가 채운 증빙 파일을 strict 명령으로 재검증합니다.",
      "3. Backend/Data: 운영 secret store, PostgreSQL, 결제 provider, webhook/idempotency 증빙을 먼저 닫습니다.",
      "4. Frontend: Android TWA, PWA push, 모바일 설치/알림 실기기 증빙을 닫습니다.",
      "5. UX/IA: 현장 운영자가 빠뜨린 파일럿 증빙과 14일 운영 로그 공백을 확인합니다.",
      "6. UI/Design System: 관리자 설정 화면의 상태 배지와 문구가 실제 운영 상태와 어긋나지 않는지 확인합니다.",
    );
  }

  lines.push("", "## 담당자별 우선 처리", "");

  for (const group of report.teamSummary) {
    lines.push(`### ${group.ownerRole}`, "");
    lines.push(`- 6인 팀 lane: ${group.teamAgents.join(", ")}`);
    lines.push(`- 영역: ${group.areaLabels.join(", ")}`);
    lines.push(`- 남은 action: ${group.totalActions}`);
    lines.push(`- 증빙 초안: ${group.evidenceDrafts.map((item) => `\`${item}\``).join(", ")}`);
    lines.push(`- strict 명령: ${group.strictCommands.map((item) => `\`${item}\``).join(", ")}`);
    lines.push("");
    lines.push("| Priority | Blocker | Next Action |");
    lines.push("| ---: | --- | --- |");

    for (const action of group.topActions) {
      lines.push(
        `| ${action.priority} | \`${markdownCell(action.blockerCode)}\` ${markdownCell(action.blockerMessage)} | ${markdownCell(action.nextAction)} |`,
      );
    }

    lines.push("");
  }

  lines.push("## 다음 검증", "");
  lines.push("- 각 handoff JSON의 증빙 필드를 채운 뒤 담당 영역별 strict 명령을 먼저 실행합니다.");
  lines.push("- 모든 handoff/IPA 리포트가 ready가 되면 bundle/dispatch/issue registration receipt를 생성하고 검증합니다.");
  lines.push("- issue registration receipt 리포트까지 ready가 되면 `npm run p1:readiness -- --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md`를 실행합니다.");
  lines.push("- P1 readiness가 ready가 되면 `npm run p1:release-package -- --out=.data/p1-release-package.json`로 최종 보관 manifest를 생성합니다.");

  return `${lines.join("\n")}\n`;
}

function ownerSlug(ownerRole, index) {
  const slug = text(ownerRole)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${String(index + 1).padStart(2, "0")}-${slug || `owner-${index + 1}`}`;
}

function ownerBriefSlug(ownerRole, index) {
  return `${ownerSlug(ownerRole, index)}.md`;
}

function toOwnerBriefMarkdown(report, group, rows) {
  const lines = [
    `# P1 Handoff Owner Brief - ${group.ownerRole}`,
    "",
    `- 생성 시각: ${report.generatedAt}`,
    `- Workspace: \`${report.workspace}\``,
    `- Release decision: \`${report.releaseDecision}\``,
    `- 6인 팀 lane: ${group.teamAgents.join(", ")}`,
    `- 영역: ${group.areaLabels.join(", ")}`,
    `- 남은 action: ${group.totalActions}`,
    "",
    "## 바로 열 파일",
    "",
    ...group.evidenceDrafts.map((item) => `- 증빙 초안: \`${item}\``),
    ...group.sourceReports.map((item) => `- blocked 리포트: \`${item}\``),
    "",
    "## 실행 명령",
    "",
    ...group.strictCommands.map((item) => `- \`${item}\``),
    "",
    "## 우선 action",
    "",
    "| Priority | Status | Blocker | Next Action |",
    "| ---: | --- | --- | --- |",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.priority} | ${markdownCell(row.status)} | \`${markdownCell(row.blockerCode)}\` ${markdownCell(row.blockerMessage)} | ${markdownCell(row.nextAction)} |`,
    );
  }

  lines.push("", "## 완료 후", "");
  lines.push("- 증빙 초안 JSON을 실제 운영 값으로 채운 뒤 위 strict 명령을 실행합니다.");
  lines.push("- strict 명령이 ready가 되면 `npm run p1:handoff-checklist -- --workspace=.data`로 담당자별 목록을 다시 생성합니다.");
  lines.push("- 모든 handoff/IPA 리포트가 ready가 되면 bundle/dispatch/issue registration receipt를 생성하고 검증합니다.");
  lines.push("- issue registration receipt 리포트까지 ready가 되면 `npm run p1:readiness -- --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md`를 실행합니다.");

  return `${lines.join("\n")}\n`;
}

async function writeRedactedSourceFile(sourceRelPath, targetPath) {
  const sourcePath = path.resolve(process.cwd(), sourceRelPath);

  try {
    const source = await readFile(sourcePath, "utf8");
    let output = "";

    try {
      output = `${JSON.stringify(redactDetail(JSON.parse(source)), null, 2)}\n`;
    } catch {
      output = `${redactString(source)}${source.endsWith("\n") ? "" : "\n"}`;
    }

    await writeFile(targetPath, output);

    return {
      exists: true,
      source: sourceRelPath,
      path: rel(targetPath),
      redacted: true,
    };
  } catch (error) {
    const fallback = {
      exists: false,
      source: sourceRelPath,
      path: rel(targetPath),
      redacted: true,
      error: error instanceof Error ? error.message : String(error),
    };

    await writeFile(targetPath, `${JSON.stringify(fallback, null, 2)}\n`);
    return fallback;
  }
}

function toOwnerPackageManifest(report, group, rows, files) {
  return {
    generatedAt: report.generatedAt,
    releaseDecision: report.releaseDecision,
    workspace: report.workspace,
    ownerRole: group.ownerRole,
    teamAgents: group.teamAgents,
    areaLabels: group.areaLabels,
    totalActions: group.totalActions,
    packageDir: group.packageDir,
    briefPath: files.briefPath,
    evidenceDrafts: files.evidenceDrafts,
    sourceReports: files.sourceReports,
    teamAgentPrompts: files.teamAgentPrompts,
    strictCommands: group.strictCommands,
    nextActions: unique(rows.map((row) => row.nextAction)),
    topActions: rows.slice(0, 10).map((row) => ({
      id: row.id,
      priority: row.priority,
      status: row.status,
      blockerCode: row.blockerCode,
      blockerMessage: row.blockerMessage,
      nextAction: row.nextAction,
    })),
    checked: [
      "owner handoff brief is included",
      "evidence draft copy is included with secret-like values redacted",
      "blocked report copy is included with secret-like values redacted",
      "P1 6인 팀 목표 프롬프트 is included for shared execution context",
      "strict validation commands are preserved for the owner",
    ],
  };
}

function toOwnerPackageIndexMarkdown(report) {
  const lines = [
    "# P1 Handoff Owner Package Index",
    "",
    `- 생성 시각: ${report.generatedAt}`,
    `- Workspace: \`${report.workspace}\``,
    `- Release decision: \`${report.releaseDecision}\``,
    `- 담당자 package: ${report.teamSummary.length}`,
    `- 남은 action: ${report.summary.totalActions}`,
    "",
    "## 전달 순서",
    "",
    `1. Product Lead가 아래 ${report.teamSummary.length}개 package를 담당자에게 배정합니다.`,
    "2. 각 담당자는 자기 package의 `brief.md`를 먼저 읽고 `evidence-draft.json`을 실제 운영 증빙으로 채웁니다.",
    "3. 담당자는 `package-manifest.json`의 strict 명령을 실행해 blocked report를 ready로 갱신합니다.",
    "4. QA/Release는 모든 담당자 package가 ready가 된 뒤 bundle/dispatch/issue registration receipt를 검증하고 `npm run p1:readiness -- --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md`를 실행합니다.",
    "",
    "## Package 목록",
    "",
    "| Owner | Team lane | Actions | Package | Manifest | Strict command |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];

  for (const group of report.teamSummary) {
    lines.push(
      `| ${markdownCell(group.ownerRole)} | ${markdownCell(group.teamAgents.join(", "))} | ${group.totalActions} | \`${markdownCell(group.packageDir)}\` | \`${markdownCell(group.packageManifest)}\` | ${group.strictCommands.map((item) => `\`${markdownCell(item)}\``).join("<br>")} |`,
    );
  }

  lines.push("", "## 포함 파일", "");
  lines.push("- `brief.md`: 담당자별 바로 실행할 action과 파일/명령 안내");
  lines.push("- `team-agent-prompts.md`: 모든 담당자가 같은 P1 목표와 외부 blocker 기준으로 움직이기 위한 6인 팀 실행 프롬프트");
  lines.push("- `evidence-draft.json`: 담당자가 채울 운영 증빙 초안, secret-like 값은 redacted 상태로 복사");
  lines.push("- `blocked-report.json`: 현재 차단 리포트, secret-like 값은 redacted 상태로 복사");
  lines.push("- `package-manifest.json`: package 경로, strict 명령, top action, next action 구조화 요약");
  lines.push("", "## 다음 검증", "");
  lines.push("- 각 package 처리 후 `npm run p1:handoff-checklist -- --workspace=.data`로 index와 package를 재생성합니다.");
  lines.push("- 모든 handoff/IPA 리포트와 issue registration receipt가 ready가 되면 `npm run p1:release-package -- --out=.data/p1-release-package.json`로 최종 보관 manifest를 생성합니다.");

  return `${lines.join("\n")}\n`;
}

function toMarkdown(report) {
  const lines = [
    "# P1 Handoff Action Checklist",
    "",
    `- 생성 시각: ${report.generatedAt}`,
    `- Workspace: \`${report.workspace}\``,
    `- Release decision: \`${report.releaseDecision}\``,
    `- 남은 action: ${report.summary.totalActions}`,
    "",
    "## Area Summary",
    "",
    "| Area | Status | Blockers | Owner | Report |",
    "| --- | --- | ---: | --- | --- |",
  ];

  for (const source of report.sources) {
    const owner = sources.find((item) => item.key === source.key)?.ownerRole ?? "";
    lines.push(
      `| ${markdownCell(source.label)} | ${markdownCell(source.status)} | ${source.blockerCount} | ${markdownCell(owner)} | \`${markdownCell(source.report)}\` |`,
    );
  }

  lines.push("", "## Top Next Actions", "");
  report.nextActions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action}`);
  });

  lines.push("", "## Checklist", "", "| Priority | Area | Owner | Team | Blocker | Next Action |", "| ---: | --- | --- | --- | --- | --- |");

  for (const row of report.checklist) {
    lines.push(
      `| ${row.priority} | ${markdownCell(row.areaLabel)} | ${markdownCell(row.ownerRole)} | ${markdownCell(row.teamAgent)} | \`${markdownCell(row.blockerCode)}\` ${markdownCell(row.blockerMessage)} | ${markdownCell(row.nextAction)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

const collected = await Promise.all(sources.map(collectRows));
const checklist = collected.flatMap((item) => item.rows).sort((a, b) => a.priority - b.priority);
const nextActions = [...new Set(checklist.map((row) => row.nextAction).filter(Boolean))];
const teamSummary = teamSummaryFor(checklist).map((group, index) => ({
  ...group,
  briefPath: rel(path.join(ownerBriefsDir, ownerBriefSlug(group.ownerRole, index))),
  packageDir: rel(path.join(ownerPackagesDir, ownerSlug(group.ownerRole, index))),
  packageManifest: rel(path.join(ownerPackagesDir, ownerSlug(group.ownerRole, index), "package-manifest.json")),
}));

const report = {
  ok: checklist.length === 0,
  releaseDecision: checklist.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  workspace: rel(workspace),
  outputs: Object.fromEntries(Object.entries(outputs).map(([key, filePath]) => [key, rel(filePath)])),
  checked: [
    "P1 handoff reports are readable",
    "blocked handoff evidence gaps are converted to operator actions",
    "secret-like detail values are redacted before writing checklist outputs",
    "CSV, Markdown, JSON, and owner brief handoff action outputs are generated",
    "per-owner Markdown action briefs are generated for handoff owners",
    "per-owner handoff package folders are generated with redacted evidence drafts and blocked reports",
    "P1 6인 팀 목표 프롬프트 is copied into every owner package",
    "owner package index Markdown is generated for PM handoff routing",
  ],
  summary: {
    sources: collected.length,
    readySources: collected.filter((item) => item.source.status === "ready").length,
    blockedSources: collected.filter((item) => item.source.status === "blocked").length,
    missingSources: collected.filter((item) => item.source.status === "missing").length,
    totalActions: checklist.length,
  },
  sources: collected.map((item) => item.source),
  nextActions,
  teamSummary,
  checklist,
};

await Promise.all(Object.values(fileOutputs).map((filePath) => mkdir(path.dirname(filePath), { recursive: true })));
await rm(ownerBriefsDir, { force: true, recursive: true });
await mkdir(ownerBriefsDir, { recursive: true });
await rm(ownerPackagesDir, { force: true, recursive: true });
await mkdir(ownerPackagesDir, { recursive: true });
await writeFile(fileOutputs.json, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(fileOutputs.csv, toCsv(checklist));
await writeFile(fileOutputs.markdown, toMarkdown(report));
await writeFile(fileOutputs.brief, toBriefMarkdown(report));
await writeFile(fileOutputs.ownerPackageIndex, toOwnerPackageIndexMarkdown(report));

await Promise.all(
  teamSummary.map((group, index) => {
    const rows = checklist.filter((row) => row.ownerRole === group.ownerRole);
    return writeFile(path.join(ownerBriefsDir, ownerBriefSlug(group.ownerRole, index)), toOwnerBriefMarkdown(report, group, rows));
  }),
);

await Promise.all(
  teamSummary.map(async (group, index) => {
    const rows = checklist.filter((row) => row.ownerRole === group.ownerRole);
    const packageDir = path.join(ownerPackagesDir, ownerSlug(group.ownerRole, index));
    const packageBriefPath = path.join(packageDir, "brief.md");
    const packageManifestPath = path.join(packageDir, "package-manifest.json");
    const teamAgentPromptsPath = path.join(packageDir, "team-agent-prompts.md");

    await mkdir(packageDir, { recursive: true });
    await writeFile(packageBriefPath, toOwnerBriefMarkdown(report, group, rows));
    const teamAgentPrompts = await writeRedactedSourceFile(teamAgentPromptsSource, teamAgentPromptsPath);

    const evidenceDrafts = await Promise.all(
      group.evidenceDrafts.map((sourceRelPath, sourceIndex) =>
        writeRedactedSourceFile(
          sourceRelPath,
          path.join(packageDir, group.evidenceDrafts.length === 1 ? "evidence-draft.json" : `evidence-draft-${sourceIndex + 1}.json`),
        ),
      ),
    );
    const sourceReports = await Promise.all(
      group.sourceReports.map((sourceRelPath, sourceIndex) =>
        writeRedactedSourceFile(
          sourceRelPath,
          path.join(packageDir, group.sourceReports.length === 1 ? "blocked-report.json" : `blocked-report-${sourceIndex + 1}.json`),
        ),
      ),
    );

    await writeFile(
      packageManifestPath,
      `${JSON.stringify(
        toOwnerPackageManifest(report, group, rows, {
          briefPath: rel(packageBriefPath),
          evidenceDrafts,
          sourceReports,
          teamAgentPrompts,
        }),
        null,
        2,
      )}\n`,
    );
  }),
);

const stdoutReport = {
  ...report,
  checklistCount: checklist.length,
};
delete stdoutReport.checklist;

console.log(JSON.stringify(stdoutReport, null, 2));
