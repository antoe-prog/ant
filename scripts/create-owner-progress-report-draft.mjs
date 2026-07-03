#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const operatorStatusPath = path.resolve(args.operatorStatus ?? path.join(workspace, "p1-operator-status.json"));
const completionEvidencePath = path.resolve(args.completionEvidence ?? path.join(workspace, "p1-completion-evidence.json"));
const outPath = path.resolve(args.out ?? path.join(workspace, "p1-owner-progress-report.md"));
const jsonPath = path.resolve(args.json ?? path.join(workspace, "p1-owner-progress-report.json"));

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
    /postgres(?:ql)?:\/\/[^:\s/@]+:(?!REDACTED@)[^@\s]+@/i.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

async function readJsonArtifact(label, filePath) {
  try {
    const source = await readFile(filePath, "utf8");

    if (hasSecretLikeSource(source)) {
      return {
        exists: true,
        json: null,
        error: "secret-like value",
        blocker: {
          code: "OWNER_PROGRESS_REPORT_SECRET_LIKE_VALUE",
          message: `${label} 산출물에 원문 secret-like 값이 포함되어 대표 보고서 초안을 만들 수 없습니다.`,
          path: rel(filePath),
        },
      };
    }

    return { exists: true, json: JSON.parse(source), error: null, blocker: null };
  } catch (error) {
    return {
      exists: false,
      json: null,
      error: error instanceof Error ? error.message : String(error),
      blocker: {
        code: "OWNER_PROGRESS_REPORT_SOURCE_MISSING",
        message: `${label} 산출물을 읽을 수 없어 현재 P1 상태를 대표 보고서에 반영할 수 없습니다.`,
        path: rel(filePath),
      },
    };
  }
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function statusCounts(criteria) {
  return criteria.reduce((counts, criterion) => {
    const status = text(criterion?.status) || "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizeExternalBlockers(operatorStatus) {
  const rows = Array.isArray(operatorStatus?.externalBlockers) ? operatorStatus.externalBlockers : [];

  return rows.map((row) => ({
    key: text(row?.key),
    label: text(row?.label) || text(row?.key),
    status: text(row?.status) || "blocked",
    ownerLane: text(row?.ownerLane) || "담당 lane 미정",
    evidenceType: text(row?.evidenceType) || "외부 운영 증빙",
    requiredEvidence: Array.isArray(row?.requiredEvidence) ? row.requiredEvidence.map(text).filter(Boolean) : [],
    nextAction: text(row?.nextAction),
  }));
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeOwnerDecisionRegister(operatorStatus) {
  const source = operatorStatus?.ownerDecisionRegister;
  const state = text(source?.state) || "register_missing";
  const labels = {
    register_missing: "대표 의사결정 등록표 생성 전",
    needs_owner_input: "대표 결정 입력 대기",
    decisions_recorded: "대표 결정 기록 완료",
  };
  const fallbackNextAction =
    state === "decisions_recorded"
      ? "대표 결정 입력은 기록됐습니다. 각 외부 증빙 handoff와 P1 readiness strict 통과를 이어서 확인합니다."
      : state === "needs_owner_input"
        ? "대표가 .data/p1-owner-decision-register.csv의 담당자, 기한, 증빙 책임자, 증빙 URL, 확인 시각, signoff를 채운 뒤 owner:decision-register:apply-csv를 실행합니다."
        : "npm run owner:decision-register -- --workspace=.data --out=.data/p1-owner-decision-register.json --markdown=.data/p1-owner-decision-register.md --csv=.data/p1-owner-decision-register.csv로 대표 의사결정 등록표를 먼저 생성합니다.";

  return {
    state,
    label: labels[state] ?? state,
    ready: source?.ready === true,
    sourcePath: text(source?.sourcePath) || null,
    completedPath: text(source?.completedPath) || null,
    decisionRows: numberOrNull(source?.decisionRows) ?? 0,
    completedDecisionRows: numberOrNull(source?.completedDecisionRows) ?? 0,
    nextAction: text(source?.nextAction) || fallbackNextAction,
  };
}

function buildRemainingExternalPrep(externalBlockers) {
  if (externalBlockers.length === 0) {
    return ["현재 P1 상태판 기준 외부 blocker는 남아 있지 않습니다. 최종 release custody와 운영 signoff를 확인합니다."];
  }

  return externalBlockers.map((blocker) => {
    const evidence = blocker.requiredEvidence.length > 0 ? `: ${blocker.requiredEvidence.join(", ")}` : "";
    return `${blocker.label} (${blocker.ownerLane})${evidence}`;
  });
}

function buildOwnerDecisions(externalBlockers, ownerDecisionRegister) {
  const defaults = [
    "파일럿을 진행할 실제 지점과 시작일",
    "운영 도메인과 배포 환경",
    "결제사를 실제로 붙일 시점과 담당자",
    "Android 앱을 먼저 배포할지, PWA 파일럿 후 APK/AAB를 만들지",
    "파일럿 현장 담당자와 장애 보고 채널",
  ];
  const registerDecision =
    ownerDecisionRegister.state === "decisions_recorded"
      ? ""
      : "대표 의사결정 등록표의 담당자, 기한, 증빙 책임자 입력";
  const blockerDecisions = externalBlockers.map((blocker) => `${blocker.label} 증빙 담당자와 완료 예정일`);
  return unique([...defaults, registerDecision, ...blockerDecisions]);
}

function buildNextActions(operatorStatus, completionEvidence, externalBlockers, ownerDecisionRegister) {
  return unique([
    ownerDecisionRegister.state === "decisions_recorded" ? "" : ownerDecisionRegister.nextAction,
    ...externalBlockers.map((blocker) => blocker.nextAction),
    ...(Array.isArray(completionEvidence?.nextActions) ? completionEvidence.nextActions : []),
    ...(Array.isArray(operatorStatus?.nextActions) ? operatorStatus.nextActions : []),
    "운영 서버/도메인과 DB 환경을 확정합니다.",
    "실제 지점 파일럿 계정과 샘플 데이터를 준비합니다.",
    "파일럿 지점에서 2주 운영 증빙을 쌓습니다.",
  ]).slice(0, 8);
}

function buildReport({ operatorRead, completionRead }) {
  const blockers = [operatorRead.blocker, completionRead.blocker].filter(Boolean);
  const operatorStatus = operatorRead.json;
  const completionEvidence = completionRead.json;
  const criteria = Array.isArray(completionEvidence?.criteria) ? completionEvidence.criteria : [];
  const counts = statusCounts(criteria);
  const externalBlockers = normalizeExternalBlockers(operatorStatus);
  const ownerDecisionRegister = normalizeOwnerDecisionRegister(operatorStatus);

  if (externalBlockers.length > 0) {
    blockers.push({
      code: "OWNER_PROGRESS_REPORT_EXTERNAL_PREP_PENDING",
      message: "대표 보고서 초안은 만들 수 있지만, 운영 전 외부 준비 항목이 남아 있습니다.",
      externalBlockerKeys: externalBlockers.map((blocker) => blocker.key).filter(Boolean),
    });
  }

  if (operatorStatus?.ok !== true || completionEvidence?.ok !== true) {
    blockers.push({
      code: "OWNER_PROGRESS_REPORT_P1_NOT_STRICT_READY",
      message: "P1 상태판 또는 완료 기준 매트릭스가 아직 strict-ready가 아닙니다.",
      operatorReleaseDecision: text(operatorStatus?.releaseDecision) || "missing",
      completionReleaseDecision: text(completionEvidence?.releaseDecision) || "missing",
    });
  }

  const releaseDecision = blockers.length === 0 ? "ready" : "blocked";
  const summary = {
    completionCriteria: criteria.length,
    readyCriteria: (counts.ready ?? 0) + (counts.ready_internal ?? 0),
    blockedExternalCriteria: counts.blocked_external ?? 0,
    needsEvidenceCriteria: counts.needs_evidence ?? 0,
    externalBlockers: externalBlockers.length,
    releaseCustodyReady: operatorStatus?.releaseCustody?.ready === true,
    ownerDecisionRegisterState: ownerDecisionRegister.state,
    ownerDecisionRows: ownerDecisionRegister.decisionRows,
    ownerDecisionCompletedRows: ownerDecisionRegister.completedDecisionRows,
  };
  const nextActions = buildNextActions(operatorStatus, completionEvidence, externalBlockers, ownerDecisionRegister);
  const ownerMessage =
    releaseDecision === "ready"
      ? "대표님, 현재 핵심 기능 개발과 운영 전 증빙이 모두 준비됐고 최종 배포 판단만 남았습니다."
      : "대표님, 현재 핵심 기능 개발은 완료됐고 실제 운영에 필요한 검증과 배포 준비 단계에 들어갔습니다. 지금은 앱을 새로 만드는 단계가 아니라, 파일럿 지점에서 문제 없이 쓸 수 있도록 운영 DB, Android 앱 패키징, 결제/알림 설정, 배포 체크리스트를 정리하고 검증하는 단계입니다.";

  return {
    ok: releaseDecision === "ready",
    releaseDecision,
    generatedAt: new Date().toISOString(),
    workspace: rel(workspace),
    source: {
      operatorStatus: rel(operatorStatusPath),
      completionEvidence: rel(completionEvidencePath),
    },
    checked: [
      "P1 operator status to owner-facing report draft",
      "P1 completion evidence summary",
      "external blockers translated into owner decisions",
      "owner decision register status translated into owner-facing next action",
      "anti-overclaiming language for operation, APK/AAB, iOS IPA, payment provider, and push status",
      "secret-like value guard for source artifacts and generated report",
    ],
    stage: "MVP 기능 개발 완료, 파일럿 운영 및 앱 배포 전 최종 준비 단계",
    summary,
    completedItems: [
      "역할별 로그인과 권한 구분",
      "회원, 학부모, 코치, 대표, 총괄 어드민 주요 화면",
      "코치 모바일 출석 체크",
      "회원/학부모 수업, 출석, 결제 상태 확인",
      "대표 지점 현황, 운영 지표, 기간별 리포트",
      "총괄 어드민 사용자, 지점, 권한, 시스템 설정, 감사 로그 관리",
      "모바일 반응형 화면과 PWA 설치 흐름",
      "공지/알림 준비 흐름과 결제 상태 이력",
      "파일럿 운영 체크리스트, 릴리즈 체크리스트, QA 문서",
      "GitHub 연결과 P1 handoff 산출물 관리 흐름",
    ],
    remainingExternalPrep: buildRemainingExternalPrep(externalBlockers),
    ownerDecisions: buildOwnerDecisions(externalBlockers, ownerDecisionRegister),
    ownerDecisionRegister,
    nextActions,
    antiOverclaiming: [
      '"운영 오픈 완료"가 아니라 "운영 전 최종 준비 단계"입니다.',
      '"APK/AAB 생성 완료"가 아니라 "Android 패키징 전략과 검증 흐름 준비 완료, 실제 산출은 외부 빌드 환경 준비 후 진행"입니다.',
      '"iOS IPA 배포 가능"이 아니라 "iOS Simulator 실행과 IPA 배포 가능 상태를 분리했고, 실제 iPhone 등록/provisioning profile 증빙 대기"입니다.',
      '"결제사 실연동 완료"가 아니라 "결제/환불/정기결제 흐름과 provider-neutral 검증 완료, 실제 PG/VAN 증빙 대기"입니다.',
      '"푸시 알림 운영 완료"가 아니라 "푸시 구조와 검증 흐름 준비 완료, 운영 VAPID 키와 실기기 증빙 대기"입니다.',
    ],
    ownerMessage,
    externalBlockers,
    blockers,
  };
}

function markdownList(items) {
  if (items.length === 0) {
    return "- 없음";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function ownerDecisionRegisterMarkdown(ownerDecisionRegister) {
  return [
    `- 상태: ${ownerDecisionRegister.label} (\`${ownerDecisionRegister.state}\`)`,
    `- 등록 대상 결정 항목: ${ownerDecisionRegister.decisionRows}개`,
    `- 완료 입력 항목: ${ownerDecisionRegister.completedDecisionRows}개`,
    ownerDecisionRegister.sourcePath ? `- 원본 등록표: \`${ownerDecisionRegister.sourcePath}\`` : "- 원본 등록표: 아직 없음",
    ownerDecisionRegister.completedPath
      ? `- completed 등록표: \`${ownerDecisionRegister.completedPath}\``
      : "- completed 등록표: 아직 없음",
    `- 다음 액션: ${ownerDecisionRegister.nextAction}`,
    ownerDecisionRegister.state === "decisions_recorded"
      ? "- 주의: 이 상태는 대표 결정 기록 완료를 뜻하며, P1 ready는 외부 증빙과 strict 검증 통과 후에만 판단합니다."
      : "- 주의: 대표 결정 입력 대기 상태는 개발 미완성이 아니라 운영 의사결정 대기입니다.",
  ].join("\n");
}

function createMarkdown(report) {
  const lines = [
    "# P1 대표 진행 보고서 초안",
    "",
    `보고 기준일: ${report.generatedAt.slice(0, 10)}`,
    "대상: 비개발자 대표 공유용",
    `생성 상태: ${report.releaseDecision}`,
    "",
    "## 비개발자 대표에게 전달할 한 줄",
    "",
    report.ownerMessage,
    "",
    "## 현재 단계",
    "",
    `${report.stage}입니다.`,
    "",
    "현재 단계는 새로 만드는 단계가 아니라 실제 지점에서 안전하게 쓰기 전 검증과 외부 운영 준비를 채우는 단계입니다.",
    "",
    "## 완료된 것",
    "",
    markdownList(report.completedItems),
    "",
    "## 남은 외부 준비",
    "",
    "아래 항목은 개발 미완성이 아니라 운영 전 외부 준비입니다.",
    "",
    markdownList(report.remainingExternalPrep),
    "",
    "## 대표 확인/결정 필요",
    "",
    markdownList(report.ownerDecisions),
    "",
    "## 대표 의사결정 등록표 상태",
    "",
    ownerDecisionRegisterMarkdown(report.ownerDecisionRegister),
    "",
    "## 다음 진행 순서",
    "",
    markdownList(report.nextActions.map((action, index) => `${index + 1}. ${action}`)),
    "",
    "## 과장해서 말하지 말 것",
    "",
    markdownList(report.antiOverclaiming),
    "",
    "## 자동 생성 근거",
    "",
    `- Operator status: \`${report.source.operatorStatus}\``,
    `- Completion evidence: \`${report.source.completionEvidence}\``,
    `- Completion criteria: ${report.summary.readyCriteria}/${report.summary.completionCriteria} ready or internal-ready`,
    `- External blockers: ${report.summary.externalBlockers}`,
    `- Release custody ready: ${report.summary.releaseCustodyReady ? "yes" : "no"}`,
    `- Owner decision register: ${report.ownerDecisionRegister.label} (${report.ownerDecisionRegister.state})`,
    "",
    "## 대표 보고 문안",
    "",
    report.ownerMessage,
    "",
  ];

  return `${lines.join("\n")}\n`;
}

const operatorRead = await readJsonArtifact("P1 operator status", operatorStatusPath);
const completionRead = await readJsonArtifact("P1 completion evidence", completionEvidencePath);
const report = buildReport({ operatorRead, completionRead });
const markdown = createMarkdown(report);
const json = `${JSON.stringify(report, null, 2)}\n`;

if (hasSecretLikeSource(markdown) || hasSecretLikeSource(json)) {
  throw new Error("Generated owner progress report draft contains secret-like values.");
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, markdown);
await mkdir(path.dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, json);

console.log(JSON.stringify(report, null, 2));

if (report.blockers.some((blocker) => blocker.code === "OWNER_PROGRESS_REPORT_SECRET_LIKE_VALUE")) {
  process.exit(1);
}

if (!args.allowPending && report.blockers.length > 0) {
  process.exit(1);
}
