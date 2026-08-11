import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-notification-push-handoff-"));

function outPath(name) {
  return path.join(directory, name);
}

async function runHandoff(filePath) {
  const { stdout } = await execFile(process.execPath, ["scripts/check-notification-push-handoff.mjs", `--file=${filePath}`], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

async function expectHandoffFailure(filePath) {
  try {
    await runHandoff(filePath);
  } catch (error) {
    assert.notEqual(error.code, 0, "invalid notification push handoff must fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid notification push handoff unexpectedly passed");
}

function collectEvidenceTemplateValues(value, values = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEvidenceTemplateValues(item, values);
    }
    return values;
  }

  if (!value || typeof value !== "object") {
    return values;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "evidence") {
      values.push(child);
    }
    collectEvidenceTemplateValues(child, values);
  }

  return values;
}

async function assertEvidenceUriTemplate(filePath) {
  const template = JSON.parse(await readFile(filePath, "utf8"));
  const evidenceValues = collectEvidenceTemplateValues(template);
  assert(evidenceValues.length > 0, `${filePath} should include evidence placeholders`);
  assert(
    evidenceValues.every((value) => typeof value === "string" && /^TODO_[A-Z0-9_]+_EVIDENCE_URI$/.test(value)),
    `${filePath} evidence placeholders must point operators to URI evidence fields`,
  );
}

function readyHandoff(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-18T05:00:00.000Z",
    production: {
      origin: "https://app.finaljudo.kr",
      evidence: "https://evidence.finaljudo.kr/push/production-origin",
    },
    vapid: {
      publicKeyConfigured: true,
      privateKeySecretName: "FINAL_JUDO_VAPID_PRIVATE_KEY",
      privateKeyStored: true,
      subject: "mailto:ops@finaljudo.kr",
      evidence: "drive://final-judo/evidence/push/vapid-secret-store",
    },
    subscriptions: {
      configEndpoint: "/api/v1/notifications/push-config",
      subscriptionEndpoint: "/api/v1/notifications/subscriptions",
      unsubscribeVerified: true,
      auditLogged: true,
      evidence: "https://evidence.finaljudo.kr/push/subscription-audit",
    },
    devices: [
      {
        platform: "android",
        device: "Pixel 8 / Android 15",
        browser: "Chrome Android 126 installed PWA",
        userEmail: "coach@finaljudo.kr",
        permissionGranted: true,
        subscriptionStored: true,
        noticePushReceived: true,
        clickOpenedNotices: true,
        installedMode: "standalone",
        evidence: "https://evidence.finaljudo.kr/push/android-device-recording",
      },
    ],
    noticeDispatch: {
      noticeId: "notice-pilot-important",
      noticeTitle: "파일럿 중요 공지",
      targetRoles: ["coach", "guardian"],
      targetingVerified: true,
      deliverySummaryCaptured: true,
      expiredSubscriptionHandled: true,
      dispatchAuditLogged: true,
      evidence: "https://evidence.finaljudo.kr/push/notice-dispatch",
    },
    security: {
      rawSecretsNotCommitted: true,
      permissionDeniedStateVerified: true,
      unsupportedBrowserStateVerified: true,
      evidence: "https://evidence.finaljudo.kr/push/security-states",
    },
    checks: {
      notificationReadiness: {
        command: "npm run test:notification-readiness",
        passed: true,
        evidence: "https://github.com/antoe-prog/ant/actions/runs/410",
      },
      smoke: {
        command: "npm run test:smoke",
        passed: true,
        evidence: "https://github.com/antoe-prog/ant/actions/runs/411",
      },
    },
    signoff: {
      signedOffBy: "정유진",
      signedOffAt: "2026-07-18T06:00:00.000Z",
      evidence: "https://evidence.finaljudo.kr/push/signoff",
    },
    ...overrides,
  };
}

function readyNativeHandoff(overrides = {}) {
  const handoff = readyHandoff({
    schemaVersion: 2,
    providers: {
      apns: {
        enabled: true,
        environment: "production",
        keyIdConfigured: true,
        privateKeySecretName: "FINAL_JUDO_APNS_PRIVATE_KEY",
        privateKeyStored: true,
        teamIdConfigured: true,
        topicConfigured: true,
        evidence: "drive://final-judo/evidence/push/apns-secret-store",
      },
      fcm: {
        clientEmailConfigured: true,
        enabled: true,
        privateKeySecretName: "FINAL_JUDO_FIREBASE_PRIVATE_KEY",
        privateKeyStored: true,
        projectIdConfigured: true,
        evidence: "drive://final-judo/evidence/push/fcm-secret-store",
      },
      web: { enabled: false },
    },
    retryWorker: {
      endpoint: "/api/v1/internal/notification-outbox",
      authorizationSecretName: "CRON_SECRET",
      secretStored: true,
      scheduler: "external",
      maxIntervalMinutes: 5,
      scheduleSupportedByPlan: true,
      invocationVerified: true,
      evidence: "drive://final-judo/evidence/push/retry-worker",
    },
    devices: [
      {
        platform: "android",
        device: "Pixel 8 / Android 15",
        browser: "Final Judo 1.0 native app",
        userEmail: "coach@finaljudo.kr",
        permissionGranted: true,
        subscriptionStored: true,
        noticePushReceived: true,
        clickOpenedNotices: true,
        installedMode: "native",
        evidence: "https://evidence.finaljudo.kr/push/android-native-recording",
      },
      {
        platform: "ios",
        device: "iPhone 15 / iOS 18",
        browser: "Final Judo 1.0 native app",
        userEmail: "guardian@finaljudo.kr",
        permissionGranted: true,
        subscriptionStored: true,
        noticePushReceived: true,
        clickOpenedNotices: true,
        installedMode: "native",
        evidence: "https://evidence.finaljudo.kr/push/ios-native-recording",
      },
    ],
  });
  delete handoff.vapid;
  return { ...handoff, ...overrides };
}

async function writeJson(name, value) {
  const filePath = outPath(name);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

const readyFile = await writeJson("notification-push-handoff.ready.json", readyHandoff());
const readyReport = await runHandoff(readyFile);
assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert(readyReport.checked.includes("Android real-device push subscription and click-through"));
await assertEvidenceUriTemplate("docs/notification-push-handoff.template.json");

const readyNativeFile = await writeJson("notification-push-handoff.native-ready.json", readyNativeHandoff());
const readyNativeReport = await runHandoff(readyNativeFile);
assert.equal(readyNativeReport.ok, true, "native APNs/FCM handoff must not require disabled Web Push VAPID settings");
assert.equal(readyNativeReport.releaseDecision, "ready");
assert(!readyNativeReport.blockers.some((blocker) => blocker.code.includes("VAPID")));
assert(readyNativeReport.checked.includes("APNs and FCM production provider custody"));
assert(readyNativeReport.checked.includes("authenticated push retry worker within 30 minutes"));

const nativeMissingRetryWorker = readyNativeHandoff();
delete nativeMissingRetryWorker.retryWorker;
const nativeMissingRetryWorkerFile = await writeJson(
  "notification-push-handoff.native-missing-retry-worker.json",
  nativeMissingRetryWorker,
);
const nativeMissingRetryWorkerReport = await expectHandoffFailure(nativeMissingRetryWorkerFile);
assert(nativeMissingRetryWorkerReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_RETRY_WORKER_MISSING"));

const nativeMissingProviders = readyNativeHandoff();
delete nativeMissingProviders.providers;
const nativeMissingProvidersFile = await writeJson(
  "notification-push-handoff.native-missing-providers.json",
  nativeMissingProviders,
);
const nativeMissingProvidersReport = await expectHandoffFailure(nativeMissingProvidersFile);
assert(nativeMissingProvidersReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_PROVIDERS_MISSING"));
assert(!nativeMissingProvidersReport.blockers.some((blocker) => blocker.code.includes("VAPID")));

const nativeSlowRetryWorker = readyNativeHandoff();
nativeSlowRetryWorker.retryWorker.maxIntervalMinutes = 1_440;
nativeSlowRetryWorker.retryWorker.scheduleSupportedByPlan = false;
const nativeSlowRetryWorkerFile = await writeJson(
  "notification-push-handoff.native-slow-retry-worker.json",
  nativeSlowRetryWorker,
);
const nativeSlowRetryWorkerReport = await expectHandoffFailure(nativeSlowRetryWorkerFile);
assert(nativeSlowRetryWorkerReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_RETRY_WORKER_INTERVAL"));
assert(nativeSlowRetryWorkerReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_RETRY_WORKER_PLAN"));

const nativeMissingApnsCustody = readyNativeHandoff();
nativeMissingApnsCustody.providers.apns.privateKeyStored = false;
const nativeMissingApnsCustodyFile = await writeJson(
  "notification-push-handoff.native-missing-apns-custody.json",
  nativeMissingApnsCustody,
);
const nativeMissingApnsCustodyReport = await expectHandoffFailure(nativeMissingApnsCustodyFile);
assert(nativeMissingApnsCustodyReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_APNS_PRIVATE_KEY"));
assert(!nativeMissingApnsCustodyReport.blockers.some((blocker) => blocker.code.includes("VAPID")));

const nativeMissingIosDevice = readyNativeHandoff();
nativeMissingIosDevice.devices = nativeMissingIosDevice.devices.filter((device) => device.platform !== "ios");
const nativeMissingIosDeviceFile = await writeJson(
  "notification-push-handoff.native-missing-ios-device.json",
  nativeMissingIosDevice,
);
const nativeMissingIosDeviceReport = await expectHandoffFailure(nativeMissingIosDeviceFile);
assert(nativeMissingIosDeviceReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_IOS_DEVICE"));

const pendingFile = await writeJson(
  "notification-push-handoff.pending.json",
  readyHandoff({
    production: { origin: "https://TODO-PRODUCTION-HOST", evidence: "TODO_PRODUCTION_ORIGIN_EVIDENCE" },
    vapid: {
      publicKeyConfigured: false,
      privateKeySecretName: "FINAL_JUDO_VAPID_PRIVATE_KEY",
      privateKeyStored: false,
      subject: "mailto:TODO-PUSH-OWNER@example.com",
      evidence: "TODO_VAPID_SECRET_STORE_EVIDENCE",
    },
  }),
);
const pendingReport = await expectHandoffFailure(pendingFile);
assert(pendingReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_PRODUCTION_ORIGIN"));
assert(pendingReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_VAPID_PRIVATE_KEY_STORED"));
assert(pendingReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_VAPID_SUBJECT"));
assert(!pendingReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_RAW_SECRET_VALUE"));

const placeholderOriginFile = await writeJson(
  "notification-push-handoff.placeholder-origin.json",
  readyHandoff({
    production: {
      origin: "https://ops.finaljudo.example",
      evidence: "https://evidence.finaljudo.kr/push/production-origin",
    },
    vapid: {
      publicKeyConfigured: true,
      privateKeySecretName: "FINAL_JUDO_VAPID_PRIVATE_KEY",
      privateKeyStored: true,
      subject: "mailto:ops@example.com",
      evidence: "drive://final-judo/evidence/push/vapid-secret-store",
    },
  }),
);
const placeholderOriginReport = await expectHandoffFailure(placeholderOriginFile);
assert(placeholderOriginReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_PRODUCTION_ORIGIN"));
assert(placeholderOriginReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_VAPID_SUBJECT"));

const apiOriginFile = await writeJson(
  "notification-push-handoff.api-origin.json",
  readyHandoff({
    production: {
      origin: "https://api.finaljudo.co.kr",
      evidence: "https://evidence.finaljudo.kr/push/production-origin",
    },
  }),
);
const apiOriginReport = await expectHandoffFailure(apiOriginFile);
assert(apiOriginReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_API_ORIGIN"));
assert.equal(apiOriginReport.partial.webPushOrigin.ready, false);

const partialWebPushOriginFile = await writeJson(
  "notification-push-handoff.partial-web-push-origin.json",
  readyHandoff({
    vapid: {
      publicKeyConfigured: false,
      privateKeySecretName: "FINAL_JUDO_VAPID_PRIVATE_KEY",
      privateKeyStored: false,
      subject: "mailto:TODO-PUSH-OWNER@example.com",
      evidence: "TODO_VAPID_SECRET_STORE_EVIDENCE",
    },
  }),
);
const partialWebPushOriginReport = await expectHandoffFailure(partialWebPushOriginFile);
assert.equal(partialWebPushOriginReport.partial.webPushOrigin.ready, true);
assert.equal(partialWebPushOriginReport.partial.webPushOrigin.productionOrigin, "https://app.finaljudo.kr");

const noAndroidFile = await writeJson(
  "notification-push-handoff.no-android.json",
  readyHandoff({
    devices: [
      {
        platform: "ios",
        device: "iPhone 15",
        browser: "Safari",
        userEmail: "guardian@finaljudo.kr",
        permissionGranted: true,
        subscriptionStored: true,
        noticePushReceived: true,
        clickOpenedNotices: true,
        evidence: "iOS push capture",
      },
    ],
  }),
);
const noAndroidReport = await expectHandoffFailure(noAndroidFile);
assert(noAndroidReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_ANDROID_DEVICE"));

const rawSecretFile = await writeJson(
  "notification-push-handoff.raw-secret.json",
  readyHandoff({
    vapid: {
      publicKeyConfigured: true,
      privateKeySecretName: "FINAL_JUDO_VAPID_PRIVATE_KEY",
      privateKeyStored: true,
      subject: "mailto:ops@finaljudo.kr",
      evidence: "secret store",
      privateKeyValue: "-----BEGIN PRIVATE KEY-----\nraw-secret\n-----END PRIVATE KEY-----",
    },
  }),
);
const rawSecretReport = await expectHandoffFailure(rawSecretFile);
assert(rawSecretReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_RAW_SECRET_VALUE"));

const looseEvidenceFile = await writeJson("notification-push-handoff.loose-evidence.json", (() => {
  const handoff = readyHandoff();
  handoff.production.evidence = "production deployment screenshot and TLS cert check";
  return handoff;
})());
const looseEvidenceReport = await expectHandoffFailure(looseEvidenceFile);
assert(looseEvidenceReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_PRODUCTION_EVIDENCE"));

const looseTimestampFile = await writeJson(
  "notification-push-handoff.loose-timestamp.json",
  readyHandoff({
    generatedAt: "July 18, 2026 05:00",
    signoff: {
      signedOffBy: "정유진",
      signedOffAt: "July 18, 2026 06:00",
      evidence: "https://evidence.finaljudo.kr/push/signoff",
    },
  }),
);
const looseTimestampReport = await expectHandoffFailure(looseTimestampFile);
assert(looseTimestampReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_GENERATED_AT"));
assert(looseTimestampReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_SIGNOFF_AT"));

const signoffBeforeGeneratedFile = await writeJson(
  "notification-push-handoff.signoff-before-generated.json",
  readyHandoff({
    signoff: {
      signedOffBy: "정유진",
      signedOffAt: "2026-07-18T04:59:59.000Z",
      evidence: "https://evidence.finaljudo.kr/push/signoff",
    },
  }),
);
const signoffBeforeGeneratedReport = await expectHandoffFailure(signoffBeforeGeneratedFile);
assert(signoffBeforeGeneratedReport.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_SIGNOFF_TIMELINE"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready notification push handoff",
        "native APNs/FCM handoff without disabled Web Push requirements",
        "native APNs custody and iOS real-device evidence are required",
        "native push retry worker secret, cadence, plan support, and invocation evidence are required",
        "template evidence URI placeholders",
        "pending production/VAPID blockers",
        "placeholder production origin and VAPID subject blockers",
        "API origins are rejected for web push",
        "partial web push origin evidence while VAPID remains blocked",
        "Android device evidence is required",
        "raw VAPID private key values are rejected",
        "non-reference evidence blocker",
        "non-ISO timestamp blocker",
        "signoff before generatedAt blocker",
      ],
    },
    null,
    2,
  ),
);
