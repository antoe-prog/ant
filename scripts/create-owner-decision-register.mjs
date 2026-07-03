#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const operatorStatusPath = path.resolve(args.operatorStatus ?? path.join(workspace, "p1-operator-status.json"));
const ownerReportPath = path.resolve(args.ownerReport ?? path.join(workspace, "p1-owner-progress-report.json"));
const outPath = path.resolve(args.out ?? path.join(workspace, "p1-owner-decision-register.json"));
const markdownPath = args.markdown ? path.resolve(args.markdown) : path.join(workspace, "p1-owner-decision-register.md");
const csvPath = args.csv ? path.resolve(args.csv) : path.join(workspace, "p1-owner-decision-register.csv");
const guidePath = args.guide ? path.resolve(args.guide) : path.join(workspace, "p1-owner-decision-register.guide.md");

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    /postgres(?:ql)?:\/\/[^:\s/@]+:(?!REDACTED@)[^@\s]+@/i.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

async function readJsonArtifact(label, filePath) {
  try {
    const source = await readFile(filePath, "utf8");

    if (hasSecretLikeSource(source)) {
      return {
        json: null,
        blocker: {
          code: "OWNER_DECISION_REGISTER_SECRET_LIKE_VALUE",
          message: `${label} 산출물에 원문 secret-like 값이 포함되어 의사결정 등록표를 만들 수 없습니다.`,
          path: rel(filePath),
        },
      };
    }

    return { json: JSON.parse(source), blocker: null };
  } catch (error) {
    return {
      json: null,
      blocker: {
        code: "OWNER_DECISION_REGISTER_SOURCE_MISSING",
        message: `${label} 산출물을 읽을 수 없어 대표 의사결정 등록표를 만들 수 없습니다.`,
        path: rel(filePath),
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function normalizeExternalBlockers(operatorStatus) {
  const rows = Array.isArray(operatorStatus?.externalBlockers) ? operatorStatus.externalBlockers : [];

  return rows.map((row) => ({
    key: text(row?.key),
    label: text(row?.label) || text(row?.key),
    status: text(row?.status) || "blocked",
    blockerCount: Number.isFinite(row?.blockerCount) ? row.blockerCount : null,
    ownerLane: text(row?.ownerLane) || "담당 lane 미정",
    evidenceType: text(row?.evidenceType) || "외부 운영 증빙",
    requiredEvidence: Array.isArray(row?.requiredEvidence) ? row.requiredEvidence.map(text).filter(Boolean) : [],
    path: text(row?.path),
    verificationCommand: text(row?.command),
    nextAction: text(row?.nextAction),
  }));
}

function decisionPrompt(blocker) {
  const key = blocker.key;

  if (key === "deployment") {
    return "운영 도메인/배포 환경, secret store 담당자, production preflight 완료 예정일을 확정";
  }

  if (key === "android") {
    return "Android 앱을 먼저 배포할지, PWA 파일럿 후 APK/AAB로 갈지와 release signing 담당자를 확정";
  }

  if (key === "iosIpa") {
    return "iOS IPA 배포를 진행할 실제 iPhone 기기 등록, provisioning profile 생성, Apple Team 담당자를 확정";
  }

  if (key === "paymentProvider") {
    return "실 PG/VAN 연동 시점, 계약/정산 담당자, webhook/billing key 보관 담당자를 확정";
  }

  if (key === "notificationPush") {
    return "운영 푸시 허용 범위, VAPID secret store 담당자, Android 실기기 수신 검증 담당자를 확정";
  }

  if (key === "issueRegistration") {
    return "담당자별 package 전달 채널, GitHub/Slack 등록 담당자, acknowledgement 방식을 확정";
  }

  if (key === "pilot") {
    return "파일럿 지점, 시작일, 현장 담당자, 14일 운영 증빙과 archive/storage 보관 담당자를 확정";
  }

  return `${blocker.label} 담당자, 완료 예정일, 증빙 보관 위치를 확정`;
}

function normalizeOwnerDecisions(ownerReport) {
  const decisions = Array.isArray(ownerReport?.ownerDecisions) ? ownerReport.ownerDecisions : [];
  return [...new Set(decisions.map(text).filter(Boolean))];
}

function buildOwnerDecisionSummary(ownerReport, externalBlockers) {
  const ownerDecisions = normalizeOwnerDecisions(ownerReport);
  const blockerDecisions = externalBlockers.map((blocker) => `${blocker.label} 증빙 담당자와 완료 예정일`);

  return [...new Set([...ownerDecisions, ...blockerDecisions].map(text).filter(Boolean))];
}

function buildRows(externalBlockers) {
  return externalBlockers.map((blocker, index) => ({
    sequence: index + 1,
    key: blocker.key,
    label: blocker.label,
    status: blocker.status,
    blockerCount: blocker.blockerCount,
    ownerLane: blocker.ownerLane,
    evidenceType: blocker.evidenceType,
    decisionNeeded: decisionPrompt(blocker),
    requiredEvidence: blocker.requiredEvidence,
    sourceReport: blocker.path,
    verificationCommand: blocker.verificationCommand,
    nextAction: blocker.nextAction,
    decisionOwner: "",
    dueDate: "",
    evidenceOwner: "",
    evidenceUrl: "",
    checkedAt: "",
    signoff: "",
    notes: "",
  }));
}

function createReport({ operatorRead, ownerRead }) {
  const blockers = [operatorRead.blocker, ownerRead.blocker].filter(Boolean);
  const externalBlockers = blockers.length === 0 ? normalizeExternalBlockers(operatorRead.json) : [];
  const decisionRows = buildRows(externalBlockers);
  const ownerDecisions = blockers.length === 0 ? buildOwnerDecisionSummary(ownerRead.json, externalBlockers) : [];
  const registerDecision = blockers.length > 0 ? "blocked" : decisionRows.length > 0 ? "needs_owner_input" : "ready";

  return {
    ok: blockers.length === 0,
    registerDecision,
    generatedAt: new Date().toISOString(),
    workspace: rel(workspace),
    source: {
      operatorStatus: rel(operatorStatusPath),
      ownerReport: rel(ownerReportPath),
    },
    checked: [
      "P1 owner decision register from operator status external blockers",
      "owner decision prompts for deployment, Android, iOS, payment, push, issue registration, and pilot blockers",
      "operator input columns for owner, due date, evidence URL, checkedAt, signoff, and notes",
      "owner-facing CSV guide for editable columns, fixed columns, and apply command",
      "secret-like value guard for source artifacts and generated register",
    ],
    summary: {
      ownerDecisionCount: ownerDecisions.length,
      externalBlockers: externalBlockers.length,
      decisionRows: decisionRows.length,
      readyToShare: blockers.length === 0,
    },
    ownerDecisions,
    decisionRows,
    blockers,
  };
}

function csvEscape(value) {
  const source = Array.isArray(value) ? value.join(" | ") : text(value);

  if (/[",\n\r]/.test(source)) {
    return `"${source.replaceAll('"', '""')}"`;
  }

  return source;
}

function createCsv(report) {
  const headers = [
    "sequence",
    "key",
    "label",
    "status",
    "blockerCount",
    "ownerLane",
    "decisionNeeded",
    "requiredEvidence",
    "decisionOwner",
    "dueDate",
    "evidenceOwner",
    "evidenceUrl",
    "checkedAt",
    "signoff",
    "verificationCommand",
    "nextAction",
    "notes",
  ];
  const rows = report.decisionRows.map((row) => headers.map((header) => csvEscape(row[header])).join(","));
  return `${headers.join(",")}\n${rows.join("\n")}${rows.length > 0 ? "\n" : ""}`;
}

function createMarkdown(report) {
  const lines = [
    "# P1 Owner Decision Register",
    "",
    `- Register decision: \`${report.registerDecision}\``,
    `- Generated at: ${report.generatedAt}`,
    `- Workspace: \`${report.workspace}\``,
    `- External blockers: ${report.summary.externalBlockers}`,
    `- Decision rows: ${report.summary.decisionRows}`,
    "",
    "## 대표 결정 필요",
    "",
  ];

  if (report.ownerDecisions.length === 0) {
    lines.push("- 현재 대표 결정 필요 항목은 없습니다.");
  } else {
    for (const decision of report.ownerDecisions) {
      lines.push(`- ${decision}`);
    }
  }

  lines.push(
    "",
    "## Decision Rows",
    "",
    "| # | Key | Lane | Decision Needed | Required Evidence | Verification Command |",
    "| ---: | --- | --- | --- | --- | --- |",
  );

  if (report.decisionRows.length === 0) {
    lines.push("| 0 | ready | - | 남은 외부 blocker 없음 | - | - |");
  } else {
    for (const row of report.decisionRows) {
      lines.push(
        `| ${row.sequence} | ${row.key} | ${row.ownerLane} | ${row.decisionNeeded} | ${row.requiredEvidence.join("<br>")} | \`${row.verificationCommand}\` |`,
      );
    }
  }

  lines.push(
    "",
    "## Operator Input Columns",
    "",
    "- `decisionOwner`: 대표가 지정한 의사결정 책임자",
    "- `dueDate`: 완료 예정일, `YYYY-MM-DD` 권장",
    "- `evidenceOwner`: 실제 증빙 입력 담당자",
    "- `evidenceUrl`: HTTPS URL 또는 provider URI",
    "- `checkedAt`: ISO timestamp",
    "- `signoff`: HTTPS URL 또는 provider URI",
    "- `notes`: 외부 담당자에게 전달할 메모",
    "",
    "## Guardrails",
    "",
    "- 이 register는 외부 blocker를 ready로 바꾸지 않습니다.",
    "- TODO, localhost, .example, .test, .local, 원문 secret-like 값은 최종 completed 증빙에 남기지 않습니다.",
    "- 담당자/기한/증빙을 채운 뒤 각 row의 verification command를 실행하고 P1 상태판을 다시 생성합니다.",
  );

  if (report.blockers.length > 0) {
    lines.push("", "## Blockers", "");
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker.code}: ${blocker.message} (${blocker.path})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function createGuideMarkdown(report) {
  const lines = [
    "# 대표 의사결정 등록표 CSV 작성 안내",
    "",
    `생성 시각: ${report.generatedAt}`,
    `현재 상태: \`${report.registerDecision}\``,
    `작성 대상 행: ${report.summary.decisionRows}개`,
    "",
    "## 대표가 채울 컬럼",
    "",
    "| 컬럼 | 필수 | 작성 방법 | 예시 |",
    "| --- | --- | --- | --- |",
    "| `decisionOwner` | 예 | 대표가 지정한 결정 책임자 이름 또는 역할 | `대표 홍길동` |",
    "| `dueDate` | 예 | 완료 예정일, `YYYY-MM-DD` 형식 | `2026-07-01` |",
    "| `evidenceOwner` | 예 | 실제 증빙을 모아 입력할 담당자 | `운영팀 김코치` |",
    "| `evidenceUrl` | 아니오 | 이미 준비된 증빙 URL 또는 storage URI | `https://...`, `drive://...` |",
    "| `checkedAt` | 아니오 | 증빙 확인 시각, ISO timestamp | `2026-07-01T09:00:00.000Z` |",
    "| `signoff` | 아니오 | 최종 승인 링크 또는 보관 URI | `https://...`, `github://...` |",
    "| `notes` | 아니오 | 담당자에게 전달할 짧은 메모 | `운영 도메인 확정 후 진행` |",
    "",
    "## 수정하면 안 되는 컬럼",
    "",
    "- `sequence`, `key`, `label`, `status`, `blockerCount`, `ownerLane`, `decisionNeeded`, `requiredEvidence`, `verificationCommand`, `nextAction`",
    "- 위 컬럼은 검증기가 원본 JSON과 대조합니다. 바뀌면 completed 등록표 생성이 차단됩니다.",
    "",
    "## 행별 작성 기준",
    "",
  ];

  if (report.decisionRows.length === 0) {
    lines.push("- 현재 대표가 채울 decision row는 없습니다.");
  } else {
    for (const row of report.decisionRows) {
      lines.push(
        `- ${row.sequence}. ${row.label}: ${row.decisionNeeded} / 필수 증빙: ${row.requiredEvidence.join(", ") || "없음"}`,
      );
    }
  }

  lines.push(
    "",
    "## 검증 전 확인",
    "",
    "- 빈 `decisionOwner`, `dueDate`, `evidenceOwner`는 차단됩니다.",
    "- `dueDate`는 `YYYY-MM-DD` 형식이어야 합니다.",
    "- `evidenceUrl`, `signoff`는 비워두거나 `https://`, `s3://`, `gs://`, `drive://`, `notion://`, `slack://`, `github://`, `file://`, `/`, `.data/`, `./`로 시작해야 합니다.",
    "- `checkedAt`은 비워두거나 ISO timestamp여야 합니다.",
    "- TODO, 미정, 예시, 샘플, localhost, `.example`, 원문 secret, 기본 임시 비밀번호는 넣지 않습니다.",
    "",
    "## 적용 명령",
    "",
    "```bash",
    "npm run owner:decision-register:apply-csv -- --workspace=.data --csv=.data/p1-owner-decision-register.csv --json=.data/p1-owner-decision-register.json --out=.data/p1-owner-decision-register.completed.json --markdown=.data/p1-owner-decision-register.completed.md",
    "```",
    "",
    "completed 등록표는 대표 결정 기록일 뿐이며, P1 ready 판단은 각 외부 handoff strict 검증과 P1 readiness 통과 후에만 가능합니다.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const [operatorRead, ownerRead] = await Promise.all([
    readJsonArtifact("P1 operator status", operatorStatusPath),
    readJsonArtifact("owner progress report", ownerReportPath),
  ]);
  const report = createReport({ operatorRead, ownerRead });
  const jsonSource = `${JSON.stringify(report, null, 2)}\n`;
  const markdownSource = createMarkdown(report);
  const csvSource = createCsv(report);
  const guideSource = createGuideMarkdown(report);

  if (
    hasSecretLikeSource(jsonSource) ||
    hasSecretLikeSource(markdownSource) ||
    hasSecretLikeSource(csvSource) ||
    hasSecretLikeSource(guideSource)
  ) {
    report.ok = false;
    report.registerDecision = "blocked";
    report.blockers.push({
      code: "OWNER_DECISION_REGISTER_OUTPUT_SECRET_LIKE_VALUE",
      message: "대표 의사결정 등록표 출력물에 원문 secret-like 값이 포함되어 있습니다.",
    });
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await mkdir(path.dirname(csvPath), { recursive: true });
  await mkdir(path.dirname(guidePath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, createMarkdown(report));
  await writeFile(csvPath, createCsv(report));
  await writeFile(guidePath, createGuideMarkdown(report));

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
