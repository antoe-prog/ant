import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(args.out ?? ".data/notification-push-handoff.json");
const evidenceReferencePattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apns-stored") {
      parsed.apnsStored = true;
      continue;
    }

    if (arg === "--apns-configured") {
      parsed.apnsConfigured = true;
      continue;
    }

    if (arg === "--fcm-stored") {
      parsed.fcmStored = true;
      continue;
    }

    if (arg === "--fcm-configured") {
      parsed.fcmConfigured = true;
      continue;
    }

    if (arg === "--web-enabled") {
      parsed.webEnabled = true;
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

    if (arg === "--retry-worker-verified") {
      parsed.retryWorkerVerified = true;
      continue;
    }

    if (arg === "--retry-worker-secret-stored") {
      parsed.retryWorkerSecretStored = true;
      continue;
    }

    if (arg === "--retry-schedule-supported-by-plan") {
      parsed.retryScheduleSupportedByPlan = true;
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

function configuredEnv(names) {
  return names.every((name) => text(process.env[name]) && !isPlaceholder(process.env[name]));
}

function apnsStored() {
  return (
    args.apnsStored === true ||
    configuredEnv(["FINAL_JUDO_APNS_PRIVATE_KEY"])
  );
}

function apnsConfigured() {
  return args.apnsConfigured === true || configuredEnv([
    "FINAL_JUDO_APNS_KEY_ID",
    "FINAL_JUDO_APNS_TEAM_ID",
    "FINAL_JUDO_APNS_TOPIC",
  ]);
}

function fcmStored() {
  return args.fcmStored === true || configuredEnv(["FINAL_JUDO_FIREBASE_PRIVATE_KEY"]);
}

function fcmConfigured() {
  return args.fcmConfigured === true || configuredEnv([
    "FINAL_JUDO_FIREBASE_CLIENT_EMAIL",
    "FINAL_JUDO_FIREBASE_PROJECT_ID",
  ]);
}

function webStored() {
  return configuredEnv([
    "FINAL_JUDO_VAPID_PUBLIC_KEY",
    "FINAL_JUDO_VAPID_PRIVATE_KEY",
    "FINAL_JUDO_VAPID_SUBJECT",
  ]);
}

function productionOrigin() {
  return text(args.productionOrigin) || text(process.env.FINAL_JUDO_PRODUCTION_ORIGIN) || "https://TODO-PRODUCTION-HOST";
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

const androidDeviceVerified = args.deviceVerified === true || args.androidDeviceVerified === true;
const iosDeviceVerified = args.deviceVerified === true || args.iosDeviceVerified === true;
const dispatchVerified = args.dispatchVerified === true;
const securityVerified = args.securityVerified === true;
const checksPassed = args.checksPassed === true;
const apnsPrivateKeyStored = apnsStored();
const apnsProductionConfigured = apnsConfigured();
const fcmPrivateKeyStored = fcmStored();
const fcmProductionConfigured = fcmConfigured();
const webPushEnabled = args.webEnabled === true || webStored();
const webPushStored = webStored();
const retryWorkerVerified = args.retryWorkerVerified === true;
const retryWorkerSecretStored = args.retryWorkerSecretStored === true || configuredEnv(["CRON_SECRET"]);
const retryMaxIntervalMinutes = Number(text(args.retryMaxIntervalMinutes));

const draft = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  production: {
    origin: productionOrigin(),
    evidence: text(args.productionEvidence) || "TODO_PRODUCTION_ORIGIN_EVIDENCE",
  },
  providers: {
    apns: {
      enabled: true,
      environment: text(args.apnsEnvironment) || text(process.env.FINAL_JUDO_APNS_ENVIRONMENT) || "production",
      keyIdConfigured: apnsProductionConfigured,
      privateKeySecretName: "FINAL_JUDO_APNS_PRIVATE_KEY",
      privateKeyStored: apnsPrivateKeyStored,
      teamIdConfigured: apnsProductionConfigured,
      topicConfigured: apnsProductionConfigured,
      evidence: text(args.apnsEvidence) || "TODO_APNS_SECRET_STORE_EVIDENCE_URI",
    },
    fcm: {
      clientEmailConfigured: fcmProductionConfigured,
      enabled: true,
      privateKeySecretName: "FINAL_JUDO_FIREBASE_PRIVATE_KEY",
      privateKeyStored: fcmPrivateKeyStored,
      projectIdConfigured: fcmProductionConfigured,
      evidence: text(args.fcmEvidence) || "TODO_FCM_SECRET_STORE_EVIDENCE_URI",
    },
    web: {
      enabled: webPushEnabled,
      publicKeyConfigured: webPushStored,
      privateKeySecretName: "FINAL_JUDO_VAPID_PRIVATE_KEY",
      privateKeyStored: webPushStored,
      subject: text(args.vapidSubject) || text(process.env.FINAL_JUDO_VAPID_SUBJECT) || "mailto:TODO-PUSH-OWNER@example.com",
      evidence: text(args.vapidEvidence) || "TODO_VAPID_SECRET_STORE_EVIDENCE_URI",
    },
  },
  retryWorker: {
    endpoint: "/api/v1/internal/notification-outbox",
    authorizationSecretName: "CRON_SECRET",
    secretStored: retryWorkerSecretStored,
    scheduler: text(args.retryScheduler) || "TODO_RETRY_SCHEDULER",
    maxIntervalMinutes: Number.isSafeInteger(retryMaxIntervalMinutes) && retryMaxIntervalMinutes > 0
      ? retryMaxIntervalMinutes
      : 0,
    scheduleSupportedByPlan: args.retryScheduleSupportedByPlan === true,
    invocationVerified: retryWorkerVerified,
    evidence: text(args.retryWorkerEvidence) || "TODO_RETRY_WORKER_EVIDENCE_URI",
  },
  subscriptions: {
    configEndpoint: "/api/v1/notifications/push-config",
    subscriptionEndpoint: "/api/v1/notifications/subscriptions",
    unsubscribeVerified: androidDeviceVerified && iosDeviceVerified,
    auditLogged: androidDeviceVerified && iosDeviceVerified,
    evidence: text(args.subscriptionEvidence) || "TODO_SUBSCRIPTION_EVIDENCE",
  },
  devices: [
    {
      platform: "android",
      device: text(args.androidDevice) || "TODO_ANDROID_DEVICE",
      browser: text(args.androidClient) || text(args.androidBrowser) || "Final Judo Android native app",
      userEmail: text(args.androidUserEmail) || text(args.userEmail) || "TODO_ANDROID_USER_EMAIL",
      permissionGranted: androidDeviceVerified,
      subscriptionStored: androidDeviceVerified,
      noticePushReceived: androidDeviceVerified,
      clickOpenedNotices: androidDeviceVerified,
      installedMode: "native",
      evidence: text(args.androidEvidence) || "TODO_ANDROID_PUSH_EVIDENCE_URI",
    },
    {
      platform: "ios",
      device: text(args.iosDevice) || "TODO_IOS_DEVICE",
      browser: text(args.iosClient) || "Final Judo iOS native app",
      userEmail: text(args.iosUserEmail) || text(args.userEmail) || "TODO_IOS_USER_EMAIL",
      permissionGranted: iosDeviceVerified,
      subscriptionStored: iosDeviceVerified,
      noticePushReceived: iosDeviceVerified,
      clickOpenedNotices: iosDeviceVerified,
      installedMode: "native",
      evidence: text(args.iosEvidence) || "TODO_IOS_PUSH_EVIDENCE_URI",
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
  ["providers.apns.evidence", draft.providers.apns.evidence],
  ["providers.fcm.evidence", draft.providers.fcm.evidence],
  ...(draft.providers.web.enabled ? [["providers.web.evidence", draft.providers.web.evidence]] : []),
  ["retryWorker.evidence", draft.retryWorker.evidence],
  ["subscriptions.evidence", draft.subscriptions.evidence],
  ["devices[0].evidence", draft.devices[0].evidence],
  ["devices[1].evidence", draft.devices[1].evidence],
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
        apnsConfigured: draft.providers.apns.keyIdConfigured && draft.providers.apns.privateKeyStored,
        fcmConfigured: draft.providers.fcm.projectIdConfigured && draft.providers.fcm.privateKeyStored,
        webPushEnabled: draft.providers.web.enabled,
        retryWorkerReady:
          draft.retryWorker.secretStored &&
          draft.retryWorker.invocationVerified &&
          draft.retryWorker.scheduleSupportedByPlan &&
          draft.retryWorker.maxIntervalMinutes >= 1 &&
          draft.retryWorker.maxIntervalMinutes <= 30,
        deviceCount: draft.devices.length,
      },
      pendingEvidence: pendingEvidence.map(([key]) => key),
      nextAction:
        pendingEvidence.length === 0 &&
        apnsPrivateKeyStored &&
        apnsProductionConfigured &&
        fcmPrivateKeyStored &&
        fcmProductionConfigured &&
        retryWorkerSecretStored &&
        retryWorkerVerified &&
        args.retryScheduleSupportedByPlan === true &&
        draft.retryWorker.maxIntervalMinutes >= 1 &&
        draft.retryWorker.maxIntervalMinutes <= 30 &&
        androidDeviceVerified &&
        iosDeviceVerified &&
        dispatchVerified
          ? `Run npm run notification-push:handoff -- --file=${outPath}`
          : "strict handoff 전에 APNs/FCM secret-store 증빙, 30분 이내 인증된 retry worker, iOS/Android 실기기 push 캡처, 공지 발송 결과, fallback 상태 증빙, signoff를 채웁니다.",
    },
    null,
    2,
  ),
);
