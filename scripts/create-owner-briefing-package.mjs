#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const outPath = path.resolve(args.out ?? path.join(workspace, "p1-owner-briefing-package.json"));
const markdownPath = args.markdown ? path.resolve(args.markdown) : null;
const packageDir = args.packageDir ? path.resolve(args.packageDir) : null;

const artifactInputs = [
  {
    key: "staticOwnerReport",
    label: "정적 대표 진행 보고서",
    source: path.resolve(args.staticReport ?? "docs/P1_OWNER_PROGRESS_REPORT.md"),
    target: "docs/P1_OWNER_PROGRESS_REPORT.md",
    type: "markdown",
  },
  {
    key: "teamAgentPrompts",
    label: "P1 6인 팀 목표 프롬프트",
    source: path.resolve(args.teamAgentPrompts ?? "docs/TEAM_AGENT_PROMPTS.md"),
    target: "docs/TEAM_AGENT_PROMPTS.md",
    type: "markdown",
  },
  {
    key: "ownerDraftMarkdown",
    label: "현재 상태 기반 대표 보고 초안 Markdown",
    source: path.resolve(args.ownerDraftMarkdown ?? path.join(workspace, "p1-owner-progress-report.md")),
    target: "reports/p1-owner-progress-report.md",
    type: "markdown",
  },
  {
    key: "ownerDraftJson",
    label: "현재 상태 기반 대표 보고 초안 JSON",
    source: path.resolve(args.ownerDraftJson ?? path.join(workspace, "p1-owner-progress-report.json")),
    target: "reports/p1-owner-progress-report.json",
    type: "json",
  },
  {
    key: "ownerDecisionRegisterMarkdown",
    label: "대표 의사결정 등록표 Markdown",
    source: path.resolve(args.ownerDecisionRegisterMarkdown ?? path.join(workspace, "p1-owner-decision-register.md")),
    target: "reports/p1-owner-decision-register.md",
    type: "markdown",
  },
  {
    key: "ownerDecisionRegisterJson",
    label: "대표 의사결정 등록표 JSON",
    source: path.resolve(args.ownerDecisionRegisterJson ?? path.join(workspace, "p1-owner-decision-register.json")),
    target: "reports/p1-owner-decision-register.json",
    type: "json",
  },
  {
    key: "ownerDecisionRegisterCsv",
    label: "대표 의사결정 등록표 CSV",
    source: path.resolve(args.ownerDecisionRegisterCsv ?? path.join(workspace, "p1-owner-decision-register.csv")),
    target: "handoff/p1-owner-decision-register.csv",
    type: "csv",
  },
  {
    key: "ownerDecisionRegisterGuide",
    label: "대표 의사결정 CSV 작성 안내",
    source: path.resolve(args.ownerDecisionRegisterGuide ?? path.join(workspace, "p1-owner-decision-register.guide.md")),
    target: "handoff/p1-owner-decision-register.guide.md",
    type: "markdown",
  },
  {
    key: "ownerDecisionRegisterCompletedMarkdown",
    label: "대표 의사결정 completed 등록표 Markdown",
    source: path.resolve(args.ownerDecisionRegisterCompletedMarkdown ?? path.join(workspace, "p1-owner-decision-register.completed.md")),
    target: "reports/p1-owner-decision-register.completed.md",
    type: "markdown",
    optional: true,
  },
  {
    key: "ownerDecisionRegisterCompletedJson",
    label: "대표 의사결정 completed 등록표 JSON",
    source: path.resolve(args.ownerDecisionRegisterCompletedJson ?? path.join(workspace, "p1-owner-decision-register.completed.json")),
    target: "reports/p1-owner-decision-register.completed.json",
    type: "json",
    optional: true,
  },
  {
    key: "operatorStatusMarkdown",
    label: "P1 운영자 상태판 Markdown",
    source: path.resolve(args.operatorStatusMarkdown ?? path.join(workspace, "p1-operator-status.md")),
    target: "reports/p1-operator-status.md",
    type: "markdown",
  },
  {
    key: "operatorStatusJson",
    label: "P1 운영자 상태판 JSON",
    source: path.resolve(args.operatorStatusJson ?? path.join(workspace, "p1-operator-status.json")),
    target: "reports/p1-operator-status.json",
    type: "json",
  },
  {
    key: "completionEvidenceMarkdown",
    label: "P1 완료 기준 매트릭스 Markdown",
    source: path.resolve(args.completionEvidenceMarkdown ?? path.join(workspace, "p1-completion-evidence.md")),
    target: "reports/p1-completion-evidence.md",
    type: "markdown",
  },
  {
    key: "completionEvidenceJson",
    label: "P1 완료 기준 매트릭스 JSON",
    source: path.resolve(args.completionEvidenceJson ?? path.join(workspace, "p1-completion-evidence.json")),
    target: "reports/p1-completion-evidence.json",
    type: "json",
  },
  {
    key: "completionEvidenceCsv",
    label: "P1 완료 기준 증빙 CSV",
    source: path.resolve(args.completionEvidenceCsv ?? path.join(workspace, "p1-completion-evidence.csv")),
    target: "handoff/p1-completion-evidence.csv",
    type: "csv",
  },
  {
    key: "externalBlockersCsv",
    label: "P1 외부 blocker 증빙 CSV",
    source: path.resolve(args.externalBlockersCsv ?? path.join(workspace, "p1-operator-status-external-blockers.csv")),
    target: "handoff/p1-operator-status-external-blockers.csv",
    type: "csv",
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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function jsonSummary(source) {
  try {
    const parsed = JSON.parse(source);

    return {
      ok: parsed?.ok ?? null,
      releaseDecision: text(parsed?.releaseDecision) || null,
      generatedAt: text(parsed?.generatedAt) || null,
      blockerCount: Array.isArray(parsed?.blockers) ? parsed.blockers.length : null,
      externalBlockers: Array.isArray(parsed?.externalBlockers) ? parsed.externalBlockers.length : null,
      registerDecision: text(parsed?.registerDecision) || null,
      ownerDecisionRegisterCompleted: parsed?.ownerDecisionRegisterCompleted === true,
      completedDecisionRows: Number.isFinite(Number(parsed?.summary?.completedDecisionRows))
        ? Number(parsed.summary.completedDecisionRows)
        : null,
      decisionRows: Number.isFinite(Number(parsed?.summary?.decisionRows)) ? Number(parsed.summary.decisionRows) : null,
    };
  } catch {
    return {
      parseError: true,
    };
  }
}

async function readArtifact(input) {
  try {
    const buffer = await readFile(input.source);
    const source = buffer.toString("utf8");
    const secretBlocked = hasSecretLikeSource(source);

    return {
      key: input.key,
      label: input.label,
      type: input.type,
      sourcePath: rel(input.source),
      targetPath: input.target,
      optional: input.optional === true,
      exists: true,
      sizeBytes: buffer.byteLength,
      sha256: sha256(buffer),
      lineCount: source.split(/\r?\n/).length,
      summary: input.type === "json" ? jsonSummary(source) : null,
      secretBlocked,
      error: secretBlocked ? "secret-like value" : null,
    };
  } catch (error) {
    return {
      key: input.key,
      label: input.label,
      type: input.type,
      sourcePath: rel(input.source),
      targetPath: input.target,
      optional: input.optional === true,
      exists: false,
      sizeBytes: 0,
      sha256: null,
      lineCount: 0,
      summary: null,
      secretBlocked: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function blockerForArtifact(artifact) {
  if (!artifact.exists) {
    if (artifact.optional) {
      return null;
    }

    return {
      code: "OWNER_BRIEFING_PACKAGE_ARTIFACT_MISSING",
      message: "대표 공유 패키지에 필요한 산출물이 없습니다.",
      artifact: artifact.key,
      path: artifact.sourcePath,
    };
  }

  if (artifact.secretBlocked) {
    return {
      code: "OWNER_BRIEFING_PACKAGE_SECRET_LIKE_VALUE",
      message: "대표 공유 패키지 산출물에 원문 secret-like 값이 포함되어 있습니다.",
      artifact: artifact.key,
      path: artifact.sourcePath,
    };
  }

  if (artifact.type === "json" && artifact.summary?.parseError === true) {
    return {
      code: "OWNER_BRIEFING_PACKAGE_JSON_INVALID",
      message: "대표 공유 패키지 JSON 산출물을 파싱할 수 없습니다.",
      artifact: artifact.key,
      path: artifact.sourcePath,
    };
  }

  return null;
}

async function copyArtifacts(artifacts) {
  if (!packageDir) {
    return null;
  }

  await mkdir(packageDir, { recursive: true });

  for (const artifact of artifacts.filter((item) => item.exists && !item.secretBlocked)) {
    const targetPath = path.join(packageDir, artifact.targetPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(path.resolve(artifact.sourcePath), targetPath);
  }

  return rel(packageDir);
}

async function writePackageReadme(report) {
  if (!packageDir || report.blockers.length > 0) {
    return null;
  }

  const targetPath = path.join(packageDir, "README.md");
  const source = createPackageReadme(report);

  if (hasSecretLikeSource(source)) {
    throw new Error("Generated owner briefing package README contains secret-like values.");
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, source);

  const buffer = await readFile(targetPath);

  return {
    targetPath: "README.md",
    sizeBytes: buffer.byteLength,
    sha256: sha256(buffer),
    lineCount: source.split(/\r?\n/).length,
  };
}

function stateLabel(state) {
  const labels = {
    ready_to_share: "대표 공유 가능",
    blocked: "공유 차단",
    needs_owner_input: "대표 결정 입력 대기",
    decisions_recorded: "대표 결정 기록 완료",
  };

  return labels[state] ?? state;
}

function createPackageReadme(report) {
  const decisionState = report.ownerDecisionRegisterStatus.state;
  const decisionNextAction = report.ownerDecisionRegisterStatus.nextAction;
  const completedRows = report.ownerDecisionRegisterStatus.completedDecisionRows ?? 0;
  const decisionRows = report.ownerDecisionRegisterStatus.decisionRows ?? "unknown";
  const externalBlockers = report.sourceStatus.externalBlockers ?? "unknown";

  const lines = [
    "# P1 대표 공유 패키지 먼저 읽기",
    "",
    `생성 시각: ${report.generatedAt}`,
    `공유 상태: ${stateLabel(report.shareDecision)} (\`${report.shareDecision}\`)`,
    "",
    "## 먼저 읽을 순서",
    "",
    "1. `reports/p1-owner-progress-report.md` - 대표에게 보고할 현재 개발 단계와 남은 외부 준비",
    "2. `docs/TEAM_AGENT_PROMPTS.md` - 6인 팀이 같은 P1 목표와 외부 blocker 기준으로 움직이기 위한 실행 프롬프트",
    "3. `reports/p1-owner-decision-register.md` - 대표가 담당자/기한/증빙 책임자를 정해야 하는 항목",
    "4. `handoff/p1-owner-decision-register.csv` - 대표 입력용 CSV 원본",
    "5. `handoff/p1-owner-decision-register.guide.md` - CSV 컬럼 작성 방법과 검증 전 확인 사항",
    "6. `reports/p1-operator-status.md` - 운영자가 볼 상세 상태판",
    "7. `reports/p1-completion-evidence.md` - P1 완료 기준별 증빙 매트릭스",
    "",
    "## 현재 판단",
    "",
    `- P1 release decision: \`${report.sourceStatus.releaseDecision ?? "unknown"}\``,
    `- 외부 준비 항목: ${externalBlockers}개`,
    `- 대표 의사결정 등록표 상태: ${stateLabel(decisionState)} (\`${decisionState}\`)`,
    `- 대표 결정 입력: ${completedRows}/${decisionRows}개`,
    "",
    "## 대표가 바로 결정할 일",
    "",
    `- ${decisionNextAction}`,
  ];

  if (decisionState !== "decisions_recorded") {
    lines.push(
      "- CSV를 채운 뒤 운영자가 `npm run owner:decision-register:apply-csv`를 실행해 completed 등록표를 만듭니다.",
      "- completed 등록표가 없어도 패키지는 공유 가능하지만, P1 ready 판단은 계속 blocked로 유지됩니다.",
    );
  } else {
    lines.push(
      "- completed 등록표가 포함되어 있습니다.",
      "- 이 상태는 대표 결정 기록 완료를 뜻하며, 실제 외부 증빙과 strict 검증 통과 전에는 운영 오픈 완료로 말하지 않습니다.",
    );
  }

  lines.push(
    "",
    "## 말하면 안 되는 표현",
    "",
    "- 운영 오픈 완료",
    "- APK/AAB 생성 완료",
    "- 결제사 실연동 완료",
    "- 푸시 알림 운영 완료",
    "",
    "## 패키지 검증",
    "",
    `- 필수 산출물: ${report.summary.readyArtifacts}/${report.summary.totalArtifacts}개 ready`,
    `- optional completed 결정표: ${report.summary.readyOptionalArtifacts}/${report.summary.optionalArtifacts}개 ready`,
    "- 원문 DB 비밀번호, webhook secret, VAPID private key, 임시 비밀번호는 이 패키지에 포함하지 않습니다.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function createMarkdown(report) {
  const lines = [
    "# P1 대표 공유 패키지 요약",
    "",
    `- 공유 판단: ${stateLabel(report.shareDecision)} (\`${report.shareDecision}\`)`,
    `- 작업 폴더: \`${report.workspace}\``,
    `- 패키지 폴더: ${report.packageDir ? `\`${report.packageDir}\`` : "복사 안 됨"}`,
    `- 필수 산출물: ${report.summary.readyArtifacts}/${report.summary.totalArtifacts}개 ready`,
    `- 선택 산출물: ${report.summary.readyOptionalArtifacts}/${report.summary.optionalArtifacts}개 ready`,
    `- 패키지 README: ${report.packageReadme ? `\`${report.packageReadme.targetPath}\`` : "생성 안 됨"}`,
    `- 대표 결정 후속 상태: ${stateLabel(report.ownerDecisionRegisterStatus.state)} (\`${report.ownerDecisionRegisterStatus.state}\`)`,
    `- 원본 P1 release decision: \`${report.sourceStatus.releaseDecision}\``,
    `- 원본 외부 준비 항목: ${report.sourceStatus.externalBlockers}`,
    "",
    "## 산출물 목록",
    "",
    "| Key | 필수 여부 | Type | Size | SHA-256 | Source | Target |",
    "| --- | --- | --- | ---: | --- | --- | --- |",
  ];

  for (const artifact of report.artifacts) {
    lines.push(
      `| ${artifact.key} | ${artifact.optional ? "선택" : "필수"} | ${artifact.type} | ${artifact.sizeBytes} | ${artifact.sha256 ?? ""} | \`${artifact.sourcePath}\` | \`${artifact.targetPath}\` |`,
    );
  }

  lines.push(
    "",
    "## 대표 결정 후속 조치",
    "",
    `- 상태: ${stateLabel(report.ownerDecisionRegisterStatus.state)} (\`${report.ownerDecisionRegisterStatus.state}\`)`,
    `- 필요한 결정 항목: ${report.ownerDecisionRegisterStatus.decisionRows ?? "unknown"}`,
    `- 완료된 결정 항목: ${report.ownerDecisionRegisterStatus.completedDecisionRows ?? 0}`,
    `- 다음 액션: ${report.ownerDecisionRegisterStatus.nextAction}`,
  );

  lines.push("", "## 패키지 차단 항목", "");

  if (report.blockers.length === 0) {
    lines.push("- 패키지 차단 항목은 없습니다. 대표에게 공유할 수 있습니다.");
  } else {
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker.code}: ${blocker.message} (${blocker.path ?? blocker.artifact ?? ""})`);
    }
  }

  lines.push(
    "",
    "## 공유 시 주의",
    "",
    "- 이 패키지는 운영 오픈 완료나 APK/AAB 생성 완료를 주장하지 않습니다.",
    "- 외부 운영 증빙이 남아 있으면 대표 보고 초안과 상태판에 blocked로 남겨 공유합니다.",
    "- 원문 DB 비밀번호, webhook secret, VAPID private key, 임시 비밀번호는 패키지에 포함하지 않습니다.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

const artifacts = await Promise.all(artifactInputs.map(readArtifact));
const blockers = artifacts.map(blockerForArtifact).filter(Boolean);
const packageDirRelative = blockers.length === 0 ? await copyArtifacts(artifacts) : null;
const ownerDraftJson = artifacts.find((artifact) => artifact.key === "ownerDraftJson");
const ownerDecisionRegisterJson = artifacts.find((artifact) => artifact.key === "ownerDecisionRegisterJson");
const ownerDecisionRegisterCompletedJson = artifacts.find((artifact) => artifact.key === "ownerDecisionRegisterCompletedJson");
const requiredArtifacts = artifacts.filter((artifact) => !artifact.optional);
const optionalArtifacts = artifacts.filter((artifact) => artifact.optional);
const readyArtifact = (artifact) => artifact.exists && !artifact.secretBlocked && artifact.summary?.parseError !== true;
const completedDecisionRegisterReady =
  readyArtifact(ownerDecisionRegisterCompletedJson ?? {}) &&
  ownerDecisionRegisterCompletedJson.summary?.ownerDecisionRegisterCompleted === true;

const baseReport = {
  ok: blockers.length === 0,
  shareDecision: blockers.length === 0 ? "ready_to_share" : "blocked",
  generatedAt: new Date().toISOString(),
  workspace: rel(workspace),
  packageDir: packageDirRelative,
  out: rel(outPath),
  markdown: markdownPath ? rel(markdownPath) : null,
  checked: [
    "static and generated owner progress reports",
    "P1 6인 팀 목표 프롬프트",
    "owner decision register Markdown/JSON/CSV",
    "owner decision register CSV guide",
    "optional completed owner decision register Markdown/JSON when owner decisions have been applied",
    "P1 operator status Markdown/JSON",
    "P1 completion evidence Markdown/JSON/CSV",
    "external blockers CSV handoff template",
    "SHA-256 and byte-size manifest for owner sharing",
    "secret-like value guard for owner briefing package",
  ],
  summary: {
    totalArtifacts: requiredArtifacts.length,
    readyArtifacts: requiredArtifacts.filter(readyArtifact).length,
    optionalArtifacts: optionalArtifacts.length,
    readyOptionalArtifacts: optionalArtifacts.filter(readyArtifact).length,
    missingArtifacts: requiredArtifacts.filter((artifact) => !artifact.exists).length,
    missingOptionalArtifacts: optionalArtifacts.filter((artifact) => !artifact.exists).length,
    secretBlockedArtifacts: artifacts.filter((artifact) => artifact.secretBlocked).length,
  },
  sourceStatus: {
    ok: ownerDraftJson?.summary?.ok ?? null,
    releaseDecision: ownerDraftJson?.summary?.releaseDecision ?? null,
    generatedAt: ownerDraftJson?.summary?.generatedAt ?? null,
    blockerCount: ownerDraftJson?.summary?.blockerCount ?? null,
    externalBlockers: ownerDraftJson?.summary?.externalBlockers ?? null,
  },
  ownerDecisionRegisterStatus: {
    state: completedDecisionRegisterReady ? "decisions_recorded" : "needs_owner_input",
    sourceRegisterDecision: ownerDecisionRegisterJson?.summary?.registerDecision ?? null,
    completedRegisterDecision: ownerDecisionRegisterCompletedJson?.summary?.registerDecision ?? null,
    decisionRows: ownerDecisionRegisterJson?.summary?.decisionRows ?? null,
    completedDecisionRows: ownerDecisionRegisterCompletedJson?.summary?.completedDecisionRows ?? null,
    nextAction: completedDecisionRegisterReady
      ? "completed 등록표가 포함되어 있습니다. 이제 실제 외부 handoff 증빙을 수집하고 각 strict 검증 명령을 실행합니다."
      : "대표가 p1-owner-decision-register.csv의 담당자/기한/증빙 책임자를 채운 뒤 npm run owner:decision-register:apply-csv를 실행합니다.",
  },
  artifacts,
  blockers,
};
const packageReadme = await writePackageReadme(baseReport);
const report = {
  ...baseReport,
  packageReadme,
  checked: packageReadme
    ? [...baseReport.checked, "owner package README reading order and next-action guide"]
    : baseReport.checked,
  summary: {
    ...baseReport.summary,
    packageReadmeReady: packageReadme !== null,
  },
};
const manifest = `${JSON.stringify(report, null, 2)}\n`;
const markdown = createMarkdown(report);

if (hasSecretLikeSource(manifest) || hasSecretLikeSource(markdown)) {
  throw new Error("Generated owner briefing package manifest contains secret-like values.");
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, manifest);

if (markdownPath) {
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, markdown);
}

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
