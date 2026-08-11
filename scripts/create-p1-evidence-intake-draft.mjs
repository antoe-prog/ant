import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const readinessPath = path.resolve(args.readiness ?? path.join(workspace, "p1-readiness.json"));
const outputs = {
  csv: path.resolve(args.csv ?? path.join(workspace, "p1-evidence-intake-draft.csv")),
  json: path.resolve(args.json ?? path.join(workspace, "p1-evidence-intake-draft.json")),
  markdown: path.resolve(args.markdown ?? path.join(workspace, "p1-evidence-intake-draft.md")),
};

const requirementMeta = [
  {
    key: "deployment",
    label: "운영 배포 handoff",
    lane: "DevOps/총괄 PM",
    requiredEvidence: "운영 origin, 배포 플랫폼 secret store, production preflight, release gate, 최종 signoff",
    evidenceDraft: ".data/deployment-handoff.json",
    strictCommand: "npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json",
  },
  {
    key: "android",
    label: "Android release handoff",
    lane: "Android/Release",
    requiredEvidence: "운영 HTTPS 웹앱 origin, release SHA-256, APK/AAB, Digital Asset Links, Android 설치 smoke",
    evidenceDraft: ".data/android-release-handoff.json",
    strictCommand: "npm run android:release-handoff -- --file=.data/android-release-handoff.json --out=.data/android-release-handoff.report.json",
  },
  {
    key: "iosIpa",
    label: "iOS IPA build/provisioning",
    lane: "iOS/Release",
    requiredEvidence: "서명된 로컬 UI 번들, 운영 HTTPS API origin, Apple Team ID, matching provisioning profile, IPA archive/export report",
    evidenceDraft: ".data/mobile-builds/ios/ios-ipa-build-report.json",
    strictCommand:
      "APPLE_TEAM_ID=<TEAM_ID> FINAL_JUDO_IOS_API_ORIGIN=https://<api-origin> npm run ios:ipa:doctor -- --team-id=<TEAM_ID> --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md",
  },
  {
    key: "paymentProvider",
    label: "결제 provider handoff",
    lane: "Backend/Data",
    requiredEvidence: "실 PG/VAN 계약, checkout, webhook 서명/idempotency, billing key/mandate 보관, 영수증 URL",
    evidenceDraft: ".data/payment-provider-handoff.json",
    strictCommand:
      "npm run payment-provider:handoff -- --file=.data/payment-provider-handoff.json --out=.data/payment-provider-handoff.report.json",
  },
  {
    key: "notificationPush",
    label: "운영 푸시 handoff",
    lane: "Frontend/QA",
    requiredEvidence: "운영 VAPID secret store, Android 실기기 구독/수신/클릭, 공지 push 발송 감사 로그",
    evidenceDraft: ".data/notification-push-handoff.json",
    strictCommand:
      "npm run notification-push:handoff -- --file=.data/notification-push-handoff.json --out=.data/notification-push-handoff.report.json",
  },
  {
    key: "issueRegistration",
    label: "P1 handoff issue registration receipt",
    lane: "Product Lead",
    requiredEvidence: "GitHub/Slack issue URL, 담당자, labels, issue body SHA-256, owner acknowledgement",
    evidenceDraft: ".data/p1-handoff-issue-registration-receipt.json",
    strictCommand:
      "npm run p1:handoff-issue-receipt -- --file=.data/p1-handoff-issue-registration-receipt.json --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-report.json",
  },
  {
    key: "pilot",
    label: "파일럿 최종 status",
    lane: "QA/Release",
    requiredEvidence: "준비 증빙, 비밀번호 교체, 14일 운영 로그, archive, storage receipt, final handoff",
    evidenceDraft: ".data/pilot-status.json",
    strictCommand: "npm run pilot:status -- --strict --out=.data/pilot-status.json",
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
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/g, "[redacted-password]");
}

function csvEscape(value) {
  const stringValue = text(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

function markdownEscape(value) {
  return redactString(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
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

function rowFor(meta, readiness) {
  const requirement = readiness?.requirements?.[meta.key] ?? {};
  const status = text(requirement.status) || "missing";
  const nextAction = redactString(
    text(requirement.nextAction) ||
      text(requirement.command) ||
      `Fill ${meta.evidenceDraft}, then run ${meta.strictCommand}.`,
  );
  const sourceReport = text(requirement.path) ? rel(path.resolve(requirement.path)) : "";

  return {
    key: meta.key,
    label: meta.label,
    lane: meta.lane,
    status,
    releaseDecision: text(requirement.releaseDecision) || (status === "ready" ? "ready" : "blocked"),
    blockerCount: typeof requirement.blockerCount === "number" ? requirement.blockerCount : status === "ready" ? 0 : null,
    blockerCodes: Array.isArray(requirement.blockerCodes) ? requirement.blockerCodes.map(text).filter(Boolean) : [],
    requiredEvidence: meta.requiredEvidence,
    evidenceDraft: meta.evidenceDraft,
    sourceReport,
    strictCommand: meta.strictCommand,
    nextAction,
    intake: {
      evidenceOwner: "TODO owner name",
      evidenceUrl: "TODO evidence URL or storage path",
      checkedAt: "TODO ISO timestamp",
      signoff: "TODO approver and permalink",
    },
  };
}

function createCsv(rows) {
  const headers = [
    "key",
    "label",
    "lane",
    "status",
    "releaseDecision",
    "blockerCount",
    "requiredEvidence",
    "evidenceDraft",
    "sourceReport",
    "strictCommand",
    "nextAction",
    "evidenceOwner",
    "evidenceUrl",
    "checkedAt",
    "signoff",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.key,
        row.label,
        row.lane,
        row.status,
        row.releaseDecision,
        row.blockerCount ?? "",
        row.requiredEvidence,
        row.evidenceDraft,
        row.sourceReport,
        row.strictCommand,
        row.nextAction,
        row.intake.evidenceOwner,
        row.intake.evidenceUrl,
        row.intake.checkedAt,
        row.intake.signoff,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function createMarkdown(report) {
  const lines = [
    "# P1 Evidence Intake Draft",
    "",
    `- Source readiness: \`${markdownEscape(report.source.readiness)}\``,
    `- Source decision: \`${markdownEscape(report.source.releaseDecision)}\``,
    `- Summary: ready ${report.summary.ready} / blocked ${report.summary.blocked} / missing ${report.summary.missing} / total ${report.summary.total}`,
    "",
    "| Lane | Requirement | Status | Required evidence | Draft | Next action |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.rows.map((row) =>
      [
        markdownEscape(row.lane),
        markdownEscape(row.label),
        markdownEscape(row.status),
        markdownEscape(row.requiredEvidence),
        `\`${markdownEscape(row.evidenceDraft)}\``,
        markdownEscape(row.nextAction),
      ].join(" | "),
    ),
    "",
    "## Intake Fields",
    "",
    "최종 P1 readiness 전에 JSON/CSV의 `evidenceOwner`, `evidenceUrl`, `checkedAt`, `signoff`를 채웁니다.",
  ];

  return `${lines.join("\n")}\n`;
}

const readiness = await readJson(readinessPath);
const rows = requirementMeta.map((meta) => rowFor(meta, readiness.json));
const summary = {
  ready: rows.filter((row) => row.status === "ready").length,
  missing: rows.filter((row) => row.status === "missing").length,
  blocked: rows.filter((row) => row.status === "blocked").length,
  total: rows.length,
};
const report = {
  ok: false,
  releaseDecision: "blocked",
  generatedAt: new Date().toISOString(),
  workspace: rel(workspace),
  source: {
    readiness: rel(readinessPath),
    exists: readiness.exists,
    releaseDecision: text(readiness.json?.releaseDecision) || "unreadable",
    error: readiness.error ? redactString(readiness.error) : null,
  },
  outputs: {
    csv: rel(outputs.csv),
    json: rel(outputs.json),
    markdown: rel(outputs.markdown),
  },
  checked: [
    "seven final P1 readiness requirements mapped to evidence intake rows",
    "team lane, evidence draft, strict command, and next action are preserved",
    "operator intake fields are left as explicit TODO placeholders",
    "secret-like values are redacted from generated intake outputs",
  ],
  summary,
  rows,
  nextActions: [...new Set(rows.filter((row) => row.status !== "ready").map((row) => row.nextAction).filter(Boolean))],
};

await Promise.all(Object.values(outputs).map((filePath) => mkdir(path.dirname(filePath), { recursive: true })));
await writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(outputs.csv, createCsv(rows));
await writeFile(outputs.markdown, createMarkdown(report));

console.log(JSON.stringify(report, null, 2));
