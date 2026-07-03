import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outPath = args.out ? path.resolve(args.out) : null;
const markdownPath = args.markdown ? path.resolve(args.markdown) : null;
const workspacePath = args.workspace ? path.resolve(args.workspace) : null;

function defaultReportPath(fileName) {
  return path.resolve(workspacePath ? path.join(workspacePath, fileName) : path.join(".data", fileName));
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

const requirements = [
  {
    key: "deployment",
    label: "운영 배포 handoff",
    path: args.deploymentReport ? path.resolve(args.deploymentReport) : defaultReportPath("deployment-handoff.report.json"),
    command: "npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json",
    nextAction:
      "운영 secret store와 production preflight 증빙을 채운 뒤 `npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json`를 실행합니다.",
  },
  {
    key: "android",
    label: "Android release handoff",
    path: args.androidReport ? path.resolve(args.androidReport) : defaultReportPath("android-release-handoff.report.json"),
    command: "npm run android:release-handoff -- --file=.data/android-release-handoff.json --out=.data/android-release-handoff.report.json",
    nextAction:
      "운영 HTTPS 웹앱 origin, release SHA-256, JDK/Android SDK, APK/AAB 산출물과 주소창/공유/더보기 브라우저 UI가 없는 Android 실기기 smoke 증빙을 준비한 뒤 `npm run android:release-handoff -- --file=.data/android-release-handoff.json --out=.data/android-release-handoff.report.json`를 실행합니다.",
  },
  {
    key: "iosIpa",
    label: "iOS IPA build/provisioning",
    path: args.iosIpaReport ? path.resolve(args.iosIpaReport) : defaultReportPath(path.join("mobile-builds", "ios", "ios-ipa-build-report.json")),
    command:
      "APPLE_TEAM_ID=<TEAM_ID> FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:doctor -- --team-id=<TEAM_ID> --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md && APPLE_TEAM_ID=<TEAM_ID> FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:build -- --team-id=<TEAM_ID> --allow-provisioning-updates",
    nextAction:
      "실제 iPhone UDID를 Apple Developer에 등록하고 kr.co.finaljudo.multigym provisioning profile을 생성한 뒤 `npm run ios:ipa:doctor`와 `npm run ios:ipa:build`를 실제 운영 HTTPS 웹앱 origin/Apple Team ID로 재실행합니다.",
  },
  {
    key: "paymentProvider",
    label: "결제 provider handoff",
    path: args.paymentProviderReport ? path.resolve(args.paymentProviderReport) : defaultReportPath("payment-provider-handoff.report.json"),
    command: "npm run payment-provider:handoff -- --file=.data/payment-provider-handoff.json --out=.data/payment-provider-handoff.report.json",
    nextAction:
      "실 PG/VAN 계약, checkout, webhook 서명/idempotency, billing key 보관 증빙을 채운 뒤 `npm run payment-provider:handoff -- --file=.data/payment-provider-handoff.json --out=.data/payment-provider-handoff.report.json`를 실행합니다.",
  },
  {
    key: "notificationPush",
    label: "운영 푸시 handoff",
    path: args.notificationPushReport ? path.resolve(args.notificationPushReport) : defaultReportPath("notification-push-handoff.report.json"),
    command: "npm run notification-push:handoff -- --file=.data/notification-push-handoff.json --out=.data/notification-push-handoff.report.json",
    nextAction:
      "운영 VAPID secret store, Android 실기기 구독/수신/클릭, 공지 push 발송 증빙을 채운 뒤 `npm run notification-push:handoff -- --file=.data/notification-push-handoff.json --out=.data/notification-push-handoff.report.json`를 실행합니다.",
  },
  {
    key: "issueRegistration",
    label: "P1 handoff issue registration receipt",
    path: args.issueRegistrationReport
      ? path.resolve(args.issueRegistrationReport)
      : defaultReportPath("p1-handoff-issue-registration-report.json"),
    command:
      "npm run p1:handoff-issue-receipt -- --file=.data/p1-handoff-issue-registration-receipt.json --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-report.json",
    nextAction:
      "외부 GitHub/Slack issue 등록 URL, 담당자, body hash, acknowledgement 증빙을 채운 뒤 `npm run p1:handoff-issue-receipt -- --file=.data/p1-handoff-issue-registration-receipt.json --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-report.json`를 실행합니다.",
  },
  {
    key: "pilot",
    label: "파일럿 최종 status",
    path: args.pilotStatus ? path.resolve(args.pilotStatus) : defaultReportPath("pilot-status.json"),
    command: "npm run pilot:status -- --strict --out=.data/pilot-status.json",
    nextAction:
      "파일럿 준비/비밀번호 교체/현장 증빙/archive/storage/final handoff 산출물을 채운 뒤 `npm run pilot:status -- --strict --out=.data/pilot-status.json`를 실행합니다.",
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

    if (key === "--out") {
      parsed.out = value;
    } else if (key === "--markdown") {
      parsed.markdown = value;
    } else if (key === "--workspace") {
      parsed.workspace = value;
    } else if (key === "--deployment-report") {
      parsed.deploymentReport = value;
    } else if (key === "--android-report") {
      parsed.androidReport = value;
    } else if (key === "--ios-ipa-report") {
      parsed.iosIpaReport = value;
    } else if (key === "--payment-provider-report") {
      parsed.paymentProviderReport = value;
    } else if (key === "--notification-push-report") {
      parsed.notificationPushReport = value;
    } else if (key === "--issue-registration-report") {
      parsed.issueRegistrationReport = value;
    } else if (key === "--pilot-status") {
      parsed.pilotStatus = value;
    }
  }

  return parsed;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function markdownCell(value) {
  const normalized = text(value).replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
  return normalized || "-";
}

function markdownStatus(status) {
  if (status === "ready") {
    return "ready";
  }

  if (status === "missing") {
    return "missing";
  }

  return "blocked";
}

function partialOrigin(partial) {
  return partial.productionOrigin ?? partial.origin ?? "-";
}

function partialUrl(partial) {
  return partial.deploymentUrl ?? partial.assetLinksUrl ?? partial.url ?? partial.endpoint ?? partial.productionOrigin ?? "-";
}

function partialEvidence(partial) {
  if (text(partial.evidence)) {
    return partial.evidence;
  }

  if (partial.ready === true) {
    return "origin guard passed";
  }

  return Array.isArray(partial.blockerCodes) ? partial.blockerCodes.join(", ") : "-";
}

function buildMarkdownReport(report) {
  const requirementRows = Object.values(report.requirements);
  const partialRows = requirementRows.flatMap((requirement) => {
    return Object.entries(requirement.partial ?? {})
      .filter(([, partial]) => partial && typeof partial === "object" && "ready" in partial)
      .map(([partialKey, partial]) => [
        requirement.label,
        partialKey,
        partial.ready ? "ready" : "blocked",
        partialOrigin(partial),
        partialUrl(partial),
        partialEvidence(partial),
      ]);
  });
  const lines = [
    "# P1 Readiness",
    "",
    `- Release decision: \`${report.releaseDecision}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Workspace: \`${report.workspace ?? ".data"}\``,
    `- Summary: ${report.summary.ready}/${report.summary.total} ready, ${report.summary.missing} missing, ${report.summary.blocked} blocked`,
    "",
    "## Requirements",
    "",
    "| Requirement | Status | Blockers | Report | Next action |",
    "| --- | --- | ---: | --- | --- |",
  ];

  for (const requirement of requirementRows) {
    lines.push(
      [
        markdownCell(requirement.label),
        `\`${markdownStatus(requirement.status)}\``,
        markdownCell(String(requirement.blockerCount ?? (requirement.status === "ready" ? 0 : "-"))),
        markdownCell(rel(requirement.path)),
        markdownCell(requirement.nextAction),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }

  lines.push("", "## Blockers", "");

  if (report.blockers.length === 0) {
    lines.push("- None");
  } else {
    lines.push("| Key | Code | Message | Next action |", "| --- | --- | --- | --- |");

    for (const blocker of report.blockers) {
      lines.push(
        [
          markdownCell(blocker.key),
          markdownCell(blocker.code),
          markdownCell(blocker.message),
          markdownCell(blocker.nextAction),
        ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
      );
    }
  }

  if (partialRows.length > 0) {
    lines.push("", "## Partial Evidence", "", "| Requirement | Partial | Status | Origin | URL | Evidence |", "| --- | --- | --- | --- | --- | --- |");

    for (const row of partialRows) {
      lines.push(row.map(markdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }

  lines.push("", "## Next Actions", "");

  if (report.nextActions.length === 0) {
    lines.push("- None");
  } else {
    report.nextActions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action}`);
    });
  }

  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function writeTextFile(filePath, source) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}

function readyDocument(document) {
  const decision = text(document?.releaseDecision);
  return document?.ok === true && (!decision || decision === "ready") && (document?.blockers?.length ?? 0) === 0;
}

function nestedBlockerCodes(document) {
  return Array.isArray(document?.blockers)
    ? document.blockers.map((blocker) => text(blocker?.code) || text(blocker?.check)).filter(Boolean)
    : [];
}

function nestedNextActions(document) {
  return Array.isArray(document?.nextActions) ? document.nextActions.map(text).filter(Boolean) : [];
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

async function classifyRequirement(requirement) {
  const readResult = await readJson(requirement.path);

  if (!readResult.exists) {
    const missing = /ENOENT|no such file/i.test(readResult.error ?? "");

    return {
      key: requirement.key,
      label: requirement.label,
      path: requirement.path,
      command: requirement.command,
      status: missing ? "missing" : "blocked",
      message: missing ? "필수 P1 readiness 리포트가 아직 없습니다." : "필수 P1 readiness 리포트를 읽을 수 없습니다.",
      nextAction: requirement.nextAction,
      error: readResult.error,
    };
  }

  if (!readyDocument(readResult.json)) {
    return {
      key: requirement.key,
      label: requirement.label,
      path: requirement.path,
      command: requirement.command,
      status: "blocked",
      message: "리포트가 ready 상태가 아닙니다.",
      nextAction: nestedNextActions(readResult.json)[0] ?? requirement.nextAction,
      generatedAt: readResult.json?.generatedAt ?? null,
      releaseDecision: readResult.json?.releaseDecision ?? null,
      blockerCodes: nestedBlockerCodes(readResult.json),
      blockerCount: Array.isArray(readResult.json?.blockers) ? readResult.json.blockers.length : null,
      ...(readResult.json?.partial ? { partial: readResult.json.partial } : {}),
    };
  }

  return {
    key: requirement.key,
    label: requirement.label,
    path: requirement.path,
    command: requirement.command,
    status: "ready",
    message: "ready 상태입니다.",
    generatedAt: readResult.json?.generatedAt ?? null,
    checked: readResult.json?.checked ?? [],
    ...(readResult.json?.partial ? { partial: readResult.json.partial } : {}),
  };
}

function blockerForRequirement(requirement) {
  const code =
    requirement.status === "missing"
      ? "P1_READINESS_REPORT_MISSING"
      : requirement.error
        ? "P1_READINESS_REPORT_UNREADABLE"
        : "P1_READINESS_REPORT_BLOCKED";

  return {
    code,
    key: requirement.key,
    label: requirement.label,
    path: requirement.path,
    status: requirement.status,
    message: requirement.message,
    nextAction: requirement.nextAction,
    ...(requirement.error ? { error: requirement.error } : {}),
    ...(requirement.blockerCodes?.length ? { blockerCodes: requirement.blockerCodes } : {}),
    ...(requirement.partial ? { partial: requirement.partial } : {}),
  };
}

const classified = await Promise.all(requirements.map(classifyRequirement));
const blockers = classified.filter((requirement) => requirement.status !== "ready").map(blockerForRequirement);
const nextActions = [...new Set(blockers.map((blocker) => blocker.nextAction).filter(Boolean))];

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  workspace: workspacePath ? rel(workspacePath) : null,
  checked: [
    "production deployment handoff report",
    "Android APK/AAB release handoff report with no browser address bar smoke evidence",
    "iOS IPA archive/provisioning report",
    "real PG/VAN payment provider handoff report",
    "production VAPID and real-device notification push handoff report",
    "external GitHub/Slack issue registration receipt report",
    "strict pilot final status report",
  ],
  requirements: Object.fromEntries(classified.map((requirement) => [requirement.key, requirement])),
  summary: {
    ready: classified.filter((requirement) => requirement.status === "ready").length,
    missing: classified.filter((requirement) => requirement.status === "missing").length,
    blocked: classified.filter((requirement) => requirement.status === "blocked").length,
    total: classified.length,
  },
  nextActions,
  blockers,
};

if (outPath) {
  await writeTextFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (markdownPath) {
  await writeTextFile(markdownPath, buildMarkdownReport(report));
}

console.log(JSON.stringify(report, null, 2));

if (!args.allowPending && blockers.length > 0) {
  process.exit(1);
}
