import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = args.workspace ? path.resolve(args.workspace) : null;
const intakePath = path.resolve(args.file ?? (workspace ? path.join(workspace, "p1-evidence-intake-draft.json") : ".data/p1-evidence-intake-draft.json"));
const outPath = args.out ? path.resolve(args.out) : null;

const expectedRows = [
  {
    key: "deployment",
    label: "운영 배포 handoff",
    lane: "DevOps/총괄 PM",
    strictCommand: "npm run deployment:handoff -- --file=.data/deployment-handoff.json --out=.data/deployment-handoff.report.json",
  },
  {
    key: "android",
    label: "Android release handoff",
    lane: "Android/Release",
    strictCommand: "npm run android:release-handoff -- --file=.data/android-release-handoff.json --out=.data/android-release-handoff.report.json",
  },
  {
    key: "iosIpa",
    label: "iOS IPA build/provisioning",
    lane: "iOS/Release",
    strictCommand:
      "APPLE_TEAM_ID=<TEAM_ID> FINAL_JUDO_IOS_API_ORIGIN=https://<api-origin> npm run ios:ipa:doctor -- --team-id=<TEAM_ID> --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md",
  },
  {
    key: "paymentProvider",
    label: "결제 provider handoff",
    lane: "Backend/Data",
    strictCommand:
      "npm run payment-provider:handoff -- --file=.data/payment-provider-handoff.json --out=.data/payment-provider-handoff.report.json",
  },
  {
    key: "notificationPush",
    label: "운영 푸시 handoff",
    lane: "Frontend/QA",
    strictCommand:
      "npm run notification-push:handoff -- --file=.data/notification-push-handoff.json --out=.data/notification-push-handoff.report.json",
  },
  {
    key: "issueRegistration",
    label: "P1 handoff issue registration receipt",
    lane: "Product Lead",
    strictCommand:
      "npm run p1:handoff-issue-receipt -- --file=.data/p1-handoff-issue-registration-receipt.json --issue-drafts=.data/p1-handoff-issue-drafts/issue-drafts.json --out=.data/p1-handoff-issue-registration-report.json",
  },
  {
    key: "pilot",
    label: "파일럿 최종 status",
    lane: "QA/Release",
    strictCommand: "npm run pilot:status -- --strict --out=.data/pilot-status.json",
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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function addBlocker(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function parseDateTime(value) {
  const source = text(value);

  if (!/^\d{4}-\d{2}-\d{2}T/.test(source)) {
    return null;
  }

  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function placeholder(value) {
  const source = text(value);
  return !source || /\b(TODO|TBD|placeholder|sample|example|dummy)\b/i.test(source) || /<[^>]+>/.test(source);
}

function evidenceReference(value) {
  const source = text(value);
  return /^(https?:\/\/|s3:\/\/|gs:\/\/|file:\/\/|\/|\.data\/|\.\/)/.test(source);
}

function secretHits(value) {
  const source = text(value);
  const hits = [];

  if (/-----BEGIN[\s\S]*?-----END [^-]+-----/.test(source)) {
    hits.push("private-key");
  }

  if (/\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source)) {
    hits.push("provider-secret");
  }

  if (/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(source)) {
    hits.push("token");
  }

  if (/FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)) {
    hits.push("default-password");
  }

  return hits;
}

function scanSecrets(value, currentPath = "$", hits = []) {
  if (typeof value === "string") {
    for (const hit of secretHits(value)) {
      hits.push({ path: currentPath, type: hit });
    }
    return hits;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSecrets(item, `${currentPath}[${index}]`, hits));
    return hits;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      scanSecrets(nested, `${currentPath}.${key}`, hits);
    }
  }

  return hits;
}

async function readJson(filePath, label, blockers) {
  try {
    const buffer = await readFile(filePath);
    return {
      ok: true,
      json: JSON.parse(buffer.toString("utf8")),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_UNREADABLE", `${label} must be readable JSON.`, {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });

    return { ok: false, json: null, sha256: null, sizeBytes: 0 };
  }
}

function resolveReadinessPath(intake) {
  if (args.readiness) {
    return path.resolve(args.readiness);
  }

  const source = text(intake?.source?.readiness);

  if (source) {
    return path.resolve(source);
  }

  return path.resolve(workspace ? path.join(workspace, "p1-readiness.json") : ".data/p1-readiness.json");
}

function readyDocument(document) {
  return document?.ok === true && document?.releaseDecision === "ready" && (document?.blockers?.length ?? 0) === 0;
}

function validateReadiness(readiness, blockers) {
  if (!readiness) {
    return;
  }

  if (!readyDocument(readiness)) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_READINESS_NOT_READY", "P1 readiness must be strict-ready before evidence intake can pass.", {
      ok: readiness.ok ?? null,
      releaseDecision: readiness.releaseDecision ?? null,
      summary: readiness.summary ?? null,
    });
  }

  if (Number(readiness.summary?.ready) !== expectedRows.length || Number(readiness.summary?.total) !== expectedRows.length) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_READINESS_SUMMARY_INCOMPLETE", "P1 readiness summary must include seven ready requirements.", {
      summary: readiness.summary ?? null,
    });
  }
}

function validateIntakeShape(intake, readiness, blockers) {
  if (!intake) {
    return;
  }

  if (!Array.isArray(intake.rows)) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_ROWS_MISSING", "Evidence intake must include a rows array.");
    return;
  }

  if (intake.rows.length !== expectedRows.length) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_ROW_COUNT", "Evidence intake must include exactly seven final readiness rows.", {
      expected: expectedRows.length,
      actual: intake.rows.length,
    });
  }

  for (const expected of expectedRows) {
    const row = intake.rows.find((candidate) => candidate?.key === expected.key);
    const requirement = readiness?.requirements?.[expected.key];

    if (!row) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_ROW_MISSING", "Evidence intake is missing a required row.", {
        key: expected.key,
      });
      continue;
    }

    if (text(row.label) !== expected.label || text(row.lane) !== expected.lane) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_ROW_IDENTITY_MISMATCH", "Evidence intake row label/lane must match the fixed P1 contract.", {
        key: expected.key,
        label: row.label ?? null,
        lane: row.lane ?? null,
      });
    }

    if (text(row.strictCommand) !== expected.strictCommand) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_STRICT_COMMAND_MISMATCH", "Evidence intake row strict command must match the fixed P1 contract.", {
        key: expected.key,
        strictCommand: row.strictCommand ?? null,
      });
    }

    if (text(row.status) !== "ready" || text(row.releaseDecision) !== "ready") {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_ROW_NOT_READY", "Evidence intake rows must be regenerated from ready P1 readiness.", {
        key: expected.key,
        status: row.status ?? null,
        releaseDecision: row.releaseDecision ?? null,
      });
    }

    if (Number(row.blockerCount ?? 0) !== 0 || (Array.isArray(row.blockerCodes) && row.blockerCodes.length > 0)) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_ROW_HAS_BLOCKERS", "Ready evidence intake rows must not carry blockers.", {
        key: expected.key,
        blockerCount: row.blockerCount ?? null,
        blockerCodes: row.blockerCodes ?? null,
      });
    }

    if (requirement && text(requirement.status) !== "ready") {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_READINESS_REQUIREMENT_NOT_READY", "The source readiness requirement must be ready.", {
        key: expected.key,
        status: requirement.status ?? null,
      });
    }

    if (requirement?.path && row.sourceReport && path.resolve(text(row.sourceReport)) !== path.resolve(text(requirement.path))) {
      addBlocker(blockers, "P1_EVIDENCE_INTAKE_SOURCE_REPORT_MISMATCH", "Evidence intake row must point at the same report as P1 readiness.", {
        key: expected.key,
        rowSourceReport: row.sourceReport,
        readinessPath: requirement.path,
      });
    }

    validateIntakeFields(row, blockers);
  }
}

function validateIntakeFields(row, blockers) {
  const intake = row.intake ?? {};

  if (placeholder(intake.evidenceOwner)) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_OWNER_MISSING", "Each evidence intake row must name the evidence owner.", {
      key: row.key,
    });
  }

  if (placeholder(intake.evidenceUrl) || !evidenceReference(intake.evidenceUrl)) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_EVIDENCE_URL_MISSING", "Each evidence intake row must include a real evidence URL or storage path.", {
      key: row.key,
      evidenceUrl: intake.evidenceUrl ?? null,
    });
  }

  if (!parseDateTime(intake.checkedAt)) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_CHECKED_AT_INVALID", "Each evidence intake row must include an ISO checkedAt timestamp.", {
      key: row.key,
      checkedAt: intake.checkedAt ?? null,
    });
  }

  if (placeholder(intake.signoff) || !evidenceReference(intake.signoff)) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_SIGNOFF_MISSING", "Each evidence intake row must include a real signoff permalink or storage path.", {
      key: row.key,
      signoff: intake.signoff ?? null,
    });
  }
}

function nextActions(blockers) {
  if (blockers.length === 0) {
    return [];
  }

  return [
    "운영 배포, Android release, iOS IPA/provisioning, 결제 provider, 운영 푸시, P1 issue registration, 파일럿 status를 모두 strict-ready로 만든 뒤 `npm run p1:readiness -- --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md`를 다시 실행합니다.",
    "`npm run p1:evidence-intake:draft -- --workspace=.data --readiness=.data/p1-readiness.json`로 intake를 재생성한 뒤 각 row의 evidenceOwner, evidenceUrl, checkedAt, signoff를 실제값으로 채웁니다.",
    "최종 확인은 `npm run p1:evidence-intake -- --file=.data/p1-evidence-intake-draft.json --readiness=.data/p1-readiness.json --out=.data/p1-evidence-intake-report.json`로 수행합니다.",
  ];
}

const blockers = [];
const intakeRead = await readJson(intakePath, "P1 evidence intake", blockers);
const readinessPath = resolveReadinessPath(intakeRead.json);
const readinessRead = await readJson(readinessPath, "P1 readiness", blockers);

if (intakeRead.json) {
  for (const hit of scanSecrets(intakeRead.json)) {
    addBlocker(blockers, "P1_EVIDENCE_INTAKE_SECRET_VALUE", "Evidence intake must not contain raw secret-like values.", hit);
  }
}

validateReadiness(readinessRead.json, blockers);
validateIntakeShape(intakeRead.json, readinessRead.json, blockers);

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  workspace: workspace ? rel(workspace) : null,
  checked: [
    "P1 readiness is strict-ready before evidence intake approval",
    "seven fixed P1 evidence intake rows are present",
    "row status, lane, strict command, and source report match readiness",
    "operator evidenceOwner/evidenceUrl/checkedAt/signoff fields are complete",
    "raw secret-like values are rejected",
  ],
  artifacts: {
    intake: {
      path: intakePath,
      sha256: intakeRead.sha256,
      sizeBytes: intakeRead.sizeBytes,
    },
    readiness: {
      path: readinessPath,
      sha256: readinessRead.sha256,
      sizeBytes: readinessRead.sizeBytes,
    },
  },
  summary: {
    rows: Array.isArray(intakeRead.json?.rows) ? intakeRead.json.rows.length : 0,
    readyRows: Array.isArray(intakeRead.json?.rows) ? intakeRead.json.rows.filter((row) => row.status === "ready").length : 0,
    totalRequiredRows: expectedRows.length,
  },
  nextActions: nextActions(blockers),
  blockers,
};

if (outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));

if (!args.allowPending && blockers.length > 0) {
  process.exit(1);
}
