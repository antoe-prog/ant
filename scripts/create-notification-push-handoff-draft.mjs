import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(args.out ?? ".data/notification-push-handoff.json");
const evidenceReferencePattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--vapid-stored") {
      parsed.vapidStored = true;
      continue;
    }

    if (arg === "--device-verified") {
      parsed.deviceVerified = true;
      continue;
    }

    if (arg === "--dispatch-verified") {
      parsed.dispatchVerified = true;
      continue;
    }

    if (arg === "--security-verified") {
      parsed.securityVerified = true;
      continue;
    }

    if (arg === "--checks-passed") {
      parsed.checksPassed = true;
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
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholder(value) {
  const normalized = text(value).toUpperCase();
  return (
    !normalized ||
    normalized.includes("TODO") ||
    normalized.includes("TBD") ||
    normalized.includes("REPLACE-WITH") ||
    normalized.includes("PLACEHOLDER") ||
    normalized.includes("SAMPLE") ||
    normalized.includes("EXAMPLE") ||
    normalized.includes("LOCALHOST") ||
    normalized.includes("PASSWORD") ||
    normalized.includes("USER:") ||
    /<[^>]+>/.test(text(value))
  );
}

function evidenceReady(value) {
  const evidence = text(value);
  return Boolean(evidence && !isPlaceholder(evidence) && evidenceReferencePattern.test(evidence));
}

function vapidStored() {
  return (
    args.vapidStored === true ||
    Boolean(
      text(process.env.FINAL_JUDO_VAPID_PUBLIC_KEY) &&
        !isPlaceholder(process.env.FINAL_JUDO_VAPID_PUBLIC_KEY) &&
        text(process.env.FINAL_JUDO_VAPID_PRIVATE_KEY) &&
        !isPlaceholder(process.env.FINAL_JUDO_VAPID_PRIVATE_KEY),
    )
  );
}

function productionOrigin() {
  return text(args.productionOrigin) || text(process.env.FINAL_JUDO_PRODUCTION_ORIGIN) || "https://TODO-PRODUCTION-HOST";
}

function vapidSubject() {
  return text(args.vapidSubject) || text(process.env.FINAL_JUDO_VAPID_SUBJECT) || "mailto:TODO-PUSH-OWNER@example.com";
}

function owner() {
  return text(args.owner) || "TODO_OWNER";
}

function signoffTimestamp() {
  if (text(args.signedOffAt)) {
    return text(args.signedOffAt);
  }

  return owner() === "TODO_OWNER" ? "TODO_ISO_TIMESTAMP" : new Date().toISOString();
}

function splitList(value, fallback) {
  const values = text(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

const deviceVerified = args.deviceVerified === true;
const dispatchVerified = args.dispatchVerified === true;
const securityVerified = args.securityVerified === true;
const checksPassed = args.checksPassed === true;
const stored = vapidStored();

const draft = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  production: {
    origin: productionOrigin(),
    evidence: text(args.productionEvidence) || "TODO_PRODUCTION_ORIGIN_EVIDENCE",
  },
  vapid: {
    publicKeyConfigured: stored,
    privateKeySecretName: "FINAL_JUDO_VAPID_PRIVATE_KEY",
    privateKeyStored: stored,
    subject: vapidSubject(),
    evidence: text(args.vapidEvidence) || "TODO_VAPID_SECRET_STORE_EVIDENCE",
  },
  subscriptions: {
    configEndpoint: "/api/v1/notifications/push-config",
    subscriptionEndpoint: "/api/v1/notifications/subscriptions",
    unsubscribeVerified: deviceVerified,
    auditLogged: deviceVerified,
    evidence: text(args.subscriptionEvidence) || "TODO_SUBSCRIPTION_EVIDENCE",
  },
  devices: [
    {
      platform: "android",
      device: text(args.androidDevice) || "TODO_ANDROID_DEVICE",
      browser: text(args.androidBrowser) || "Chrome Android 또는 TWA",
      userEmail: text(args.userEmail) || "TODO_USER_EMAIL",
      permissionGranted: deviceVerified,
      subscriptionStored: deviceVerified,
      noticePushReceived: deviceVerified,
      clickOpenedNotices: deviceVerified,
      installedMode: text(args.installedMode) || "standalone-or-browser",
      evidence: text(args.androidEvidence) || "TODO_ANDROID_PUSH_EVIDENCE",
    },
  ],
  noticeDispatch: {
    noticeId: text(args.noticeId) || "TODO_NOTICE_ID",
    noticeTitle: text(args.noticeTitle) || "TODO_NOTICE_TITLE",
    targetRoles: splitList(args.targetRoles, ["coach", "guardian"]),
    targetingVerified: dispatchVerified,
    deliverySummaryCaptured: dispatchVerified,
    expiredSubscriptionHandled: dispatchVerified,
    dispatchAuditLogged: dispatchVerified,
    evidence: text(args.dispatchEvidence) || "TODO_NOTICE_PUSH_DISPATCH_EVIDENCE",
  },
  security: {
    rawSecretsNotCommitted: securityVerified,
    permissionDeniedStateVerified: securityVerified,
    unsupportedBrowserStateVerified: securityVerified,
    evidence: text(args.securityEvidence) || "TODO_NOTIFICATION_SECURITY_EVIDENCE",
  },
  checks: {
    notificationReadiness: {
      command: "npm run test:notification-readiness",
      passed: checksPassed,
      evidence: text(args.notificationReadinessEvidence) || "TODO_NOTIFICATION_READINESS_EVIDENCE",
    },
    smoke: {
      command: "npm run test:smoke",
      passed: checksPassed,
      evidence: text(args.smokeCheckEvidence) || "TODO_SMOKE_CHECK_EVIDENCE",
    },
  },
  signoff: {
    signedOffBy: text(args.signedOffBy) || owner(),
    signedOffAt: signoffTimestamp(),
    evidence: text(args.signoffEvidence) || "TODO_SIGNOFF_EVIDENCE",
  },
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(draft, null, 2)}\n`);

const pendingEvidence = [
  ["production.evidence", draft.production.evidence],
  ["vapid.evidence", draft.vapid.evidence],
  ["subscriptions.evidence", draft.subscriptions.evidence],
  ["devices[0].evidence", draft.devices[0].evidence],
  ["noticeDispatch.evidence", draft.noticeDispatch.evidence],
  ["security.evidence", draft.security.evidence],
  ["signoff.evidence", draft.signoff.evidence],
].filter(([, value]) => !evidenceReady(value));

console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      inferred: {
        productionOrigin: draft.production.origin,
        vapidSubject: draft.vapid.subject,
        vapidStored: draft.vapid.privateKeyStored,
        deviceCount: draft.devices.length,
      },
      pendingEvidence: pendingEvidence.map(([key]) => key),
      nextAction:
        pendingEvidence.length === 0 && draft.vapid.privateKeyStored && deviceVerified && dispatchVerified
          ? `Run npm run notification-push:handoff -- --file=${outPath}`
          : "strict handoff 전에 VAPID secret-store 증빙, Android 실기기 push 캡처, 공지 발송 결과, fallback 상태 증빙, signoff를 채웁니다.",
    },
    null,
    2,
  ),
);
