import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const handoffPath = path.resolve(args.file ?? ".data/notification-push-handoff.json");
const outPath = args.out ? path.resolve(args.out) : null;

const allowedPlatforms = new Set(["android", "ios", "desktop"]);
const evidenceReferencePattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;
const forbiddenValueKeys = new Set([
  "authorization",
  "authorizationheader",
  "bearer",
  "password",
  "plaintext",
  "privatekey",
  "privatekeyvalue",
  "secret",
  "secretvalue",
  "token",
  "value",
  "vapidprivatekey",
]);

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

    if (key === "--file") {
      parsed.file = value;
    } else if (key === "--out") {
      parsed.out = value;
    }
  }

  return parsed;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function addIssue(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
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

function parseDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text(value))) {
    return null;
  }

  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validateHttpsOrigin(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && !isPlaceholderProductionHost(url.hostname) && !isPlaceholder(value)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function isPlaceholderProductionHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return (
    ["localhost", "127.0.0.1", "0.0.0.0"].includes(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".test") ||
    host.endsWith(".example") ||
    host.endsWith(".example.com") ||
    host.includes("todo") ||
    host.includes("placeholder") ||
    host.includes("sample")
  );
}

function validateMailtoContact(value) {
  const contact = text(value);
  if (!contact.startsWith("mailto:") || isPlaceholder(contact)) {
    return false;
  }

  const address = contact.slice("mailto:".length);
  const [, domain = ""] = address.split("@");
  return Boolean(address && domain && !isPlaceholderProductionHost(domain));
}

function validateEvidence(blockers, code, label, value) {
  const evidence = text(value);
  if (!evidence || isPlaceholder(evidence) || !evidenceReferencePattern.test(evidence)) {
    addIssue(blockers, code, `${label} evidence must be an HTTPS URL or provider storage URI.`, { evidence: value ?? null });
  }
}

function isEvidenceReference(value) {
  const evidence = text(value);
  return Boolean(evidence && !isPlaceholder(evidence) && evidenceReferencePattern.test(evidence));
}

function isApiOrigin(value) {
  try {
    const host = new URL(text(value)).hostname.toLowerCase();
    return host === "api.finaljudo.co.kr" || host.startsWith("api.");
  } catch {
    return false;
  }
}

function validatePassedCheck(blockers, key, check, expectedCommand) {
  if (!check || typeof check !== "object") {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_CHECK_MISSING", "notification push handoff is missing a required check.", { key });
    return;
  }

  if (text(check.command) !== expectedCommand) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_CHECK_COMMAND", "notification push handoff check command does not match the release contract.", {
      key,
      command: check.command ?? null,
      expectedCommand,
    });
  }

  if (check.passed !== true) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_CHECK_NOT_PASSED", "notification push handoff check must be marked passed only after it succeeds.", {
      key,
    });
  }

  validateEvidence(blockers, "NOTIFICATION_PUSH_HANDOFF_CHECK_EVIDENCE", `${key} check`, check.evidence);
}

async function readJson(filePath) {
  const source = await readFile(filePath, "utf8");
  return JSON.parse(source);
}

function assertNoRawSecretValues(value, blockers, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawSecretValues(item, blockers, [...trail, String(index)]));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childTrail = [...trail, key];
    const normalizedKey = key.toLowerCase();

    if (typeof child === "string") {
      if (normalizedKey.endsWith("secretname") || child === "FINAL_JUDO_VAPID_PRIVATE_KEY") {
        assertNoRawSecretValues(child, blockers, childTrail);
        continue;
      }

      const looksLikePrivateKey = child.includes("-----BEGIN") || (/^[A-Za-z0-9_-]{80,}$/.test(child) && normalizedKey.includes("key"));
      const referenceOrPlaceholderEvidence = normalizedKey === "evidence" && (isPlaceholder(child) || isEvidenceReference(child));
      const looksLikeSecret = !referenceOrPlaceholderEvidence && /(?:secret|token|vapid|bearer)_[A-Za-z0-9_-]{8,}/i.test(child);

      if (forbiddenValueKeys.has(normalizedKey) || looksLikePrivateKey || looksLikeSecret) {
        addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_RAW_SECRET_VALUE", "notification push handoff must not contain raw secret values.", {
          path: childTrail.join("."),
        });
      }
    }

    assertNoRawSecretValues(child, blockers, childTrail);
  }
}

function validateDevice(blockers, device, index) {
  if (!device || typeof device !== "object") {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_DEVICE_INVALID", "device verification entry must be an object.", { index });
    return;
  }

  if (!allowedPlatforms.has(text(device.platform))) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_DEVICE_PLATFORM", "device platform must be android, ios, or desktop.", {
      index,
      platform: device.platform ?? null,
    });
  }

  for (const key of ["device", "browser", "userEmail"]) {
    if (isPlaceholder(device[key])) {
      addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_DEVICE_FIELD", "device verification must identify the real device, browser, and user.", {
        index,
        key,
        value: device[key] ?? null,
      });
    }
  }

  for (const key of ["permissionGranted", "subscriptionStored", "noticePushReceived", "clickOpenedNotices"]) {
    if (device[key] !== true) {
      addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_DEVICE_VERIFICATION", "device verification must confirm permission, subscription, delivery, and click behavior.", {
        index,
        key,
        value: device[key] ?? null,
      });
    }
  }

  validateEvidence(blockers, "NOTIFICATION_PUSH_HANDOFF_DEVICE_EVIDENCE", `device ${index + 1}`, device.evidence);
}

function validateDevices(blockers, devices) {
  if (!Array.isArray(devices) || devices.length === 0) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_DEVICE_MISSING", "notification push handoff must include at least one mobile device verification.");
    return;
  }

  devices.forEach((device, index) => validateDevice(blockers, device, index));

  const hasAndroid = devices.some((device) => text(device?.platform) === "android" && device?.noticePushReceived === true);
  if (!hasAndroid) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_ANDROID_DEVICE", "at least one Android device must receive and open a real notice push.");
  }
}

async function validateHandoff(document, blockers) {
  if (document.schemaVersion !== 1) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_SCHEMA_VERSION", "notification push handoff schemaVersion must be 1.", {
      schemaVersion: document.schemaVersion ?? null,
    });
  }

  const generatedAt = parseDateTime(document.generatedAt);
  if (!generatedAt || isPlaceholder(document.generatedAt)) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_GENERATED_AT", "generatedAt must be a real ISO timestamp.", {
      generatedAt: document.generatedAt ?? null,
    });
  }

  const production = document.production ?? {};
  const productionOrigin = validateHttpsOrigin(production.origin);
  if (!productionOrigin) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_PRODUCTION_ORIGIN", "production.origin must be a real HTTPS origin.", {
      origin: production.origin ?? null,
    });
  } else if (isApiOrigin(productionOrigin)) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_API_ORIGIN", "production.origin must be the user-facing web app origin, not an API origin.", {
      origin: production.origin ?? null,
    });
  }
  validateEvidence(blockers, "NOTIFICATION_PUSH_HANDOFF_PRODUCTION_EVIDENCE", "production deployment", production.evidence);

  const vapid = document.vapid ?? {};
  if (vapid.publicKeyConfigured !== true) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_VAPID_PUBLIC_KEY", "VAPID public key must be configured in production.");
  }
  if (text(vapid.privateKeySecretName) !== "FINAL_JUDO_VAPID_PRIVATE_KEY") {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_VAPID_PRIVATE_KEY_SECRET", "VAPID private key must be referenced by secret name only.", {
      privateKeySecretName: vapid.privateKeySecretName ?? null,
    });
  }
  if (vapid.privateKeyStored !== true) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_VAPID_PRIVATE_KEY_STORED", "VAPID private key must be stored in a deployment secret store.");
  }
  if (!validateMailtoContact(vapid.subject)) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_VAPID_SUBJECT", "VAPID subject must be a mailto contact.", {
      subject: vapid.subject ?? null,
    });
  }
  validateEvidence(blockers, "NOTIFICATION_PUSH_HANDOFF_VAPID_EVIDENCE", "VAPID configuration", vapid.evidence);

  const subscriptions = document.subscriptions ?? {};
  if (text(subscriptions.configEndpoint) !== "/api/v1/notifications/push-config") {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_CONFIG_ENDPOINT", "push config endpoint must match the implemented route.", {
      configEndpoint: subscriptions.configEndpoint ?? null,
    });
  }
  if (text(subscriptions.subscriptionEndpoint) !== "/api/v1/notifications/subscriptions") {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_SUBSCRIPTION_ENDPOINT", "push subscription endpoint must match the implemented route.", {
      subscriptionEndpoint: subscriptions.subscriptionEndpoint ?? null,
    });
  }
  if (subscriptions.unsubscribeVerified !== true || subscriptions.auditLogged !== true) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_SUBSCRIPTION_VERIFICATION", "push subscribe/unsubscribe and audit log behavior must be verified.");
  }
  validateEvidence(blockers, "NOTIFICATION_PUSH_HANDOFF_SUBSCRIPTION_EVIDENCE", "push subscription", subscriptions.evidence);

  validateDevices(blockers, document.devices);

  const dispatch = document.noticeDispatch ?? {};
  if (isPlaceholder(dispatch.noticeId) || isPlaceholder(dispatch.noticeTitle)) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_NOTICE_TARGET", "noticeDispatch must identify the real pilot notice used for push verification.");
  }
  if (!Array.isArray(dispatch.targetRoles) || dispatch.targetRoles.length === 0) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_TARGET_ROLES", "noticeDispatch.targetRoles must include at least one real target role.");
  }
  for (const key of ["targetingVerified", "deliverySummaryCaptured", "expiredSubscriptionHandled", "dispatchAuditLogged"]) {
    if (dispatch[key] !== true) {
      addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_DISPATCH_VERIFICATION", "notice push dispatch targeting, delivery, expiry, and audit behavior must be verified.", {
        key,
        value: dispatch[key] ?? null,
      });
    }
  }
  validateEvidence(blockers, "NOTIFICATION_PUSH_HANDOFF_DISPATCH_EVIDENCE", "notice push dispatch", dispatch.evidence);

  const security = document.security ?? {};
  for (const key of ["rawSecretsNotCommitted", "permissionDeniedStateVerified", "unsupportedBrowserStateVerified"]) {
    if (security[key] !== true) {
      addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_SECURITY_VERIFICATION", "notification permission and secret handling must be verified.", {
        key,
        value: security[key] ?? null,
      });
    }
  }
  validateEvidence(blockers, "NOTIFICATION_PUSH_HANDOFF_SECURITY_EVIDENCE", "notification security", security.evidence);

  validatePassedCheck(blockers, "notificationReadiness", document.checks?.notificationReadiness, "npm run test:notification-readiness");
  validatePassedCheck(blockers, "smoke", document.checks?.smoke, "npm run test:smoke");

  const signoff = document.signoff ?? {};
  if (isPlaceholder(signoff.signedOffBy)) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_SIGNOFF_OWNER", "signoff.signedOffBy must be filled.");
  }
  const signedOffAt = parseDateTime(signoff.signedOffAt);
  if (!signedOffAt || isPlaceholder(signoff.signedOffAt)) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_SIGNOFF_AT", "signoff.signedOffAt must be a real ISO timestamp.", {
      signedOffAt: signoff.signedOffAt ?? null,
    });
  }
  if (generatedAt && signedOffAt && signedOffAt < generatedAt) {
    addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_SIGNOFF_TIMELINE", "signoff.signedOffAt must be at or after generatedAt.", {
      generatedAt: document.generatedAt ?? null,
      signedOffAt: signoff.signedOffAt ?? null,
    });
  }
  validateEvidence(blockers, "NOTIFICATION_PUSH_HANDOFF_SIGNOFF_EVIDENCE", "notification signoff", signoff.evidence);

  assertNoRawSecretValues(document, blockers);
}

function buildPartial(document, blockers) {
  if (!document || typeof document !== "object") {
    return null;
  }

  const production = document.production ?? {};
  const productionOrigin = validateHttpsOrigin(production.origin);
  const webPushOriginBlockers = blockers
    .map((blocker) => text(blocker?.code))
    .filter((code) =>
      [
        "NOTIFICATION_PUSH_HANDOFF_PRODUCTION_ORIGIN",
        "NOTIFICATION_PUSH_HANDOFF_API_ORIGIN",
        "NOTIFICATION_PUSH_HANDOFF_PRODUCTION_EVIDENCE",
      ].includes(code),
    );

  return {
    webPushOrigin: {
      ready: Boolean(productionOrigin && webPushOriginBlockers.length === 0),
      productionOrigin: productionOrigin ?? text(production.origin) ?? null,
      evidence: production.evidence ?? null,
      blockerCodes: webPushOriginBlockers,
    },
  };
}

const blockers = [];
let handoffDocument = null;

try {
  handoffDocument = await readJson(handoffPath);
  await validateHandoff(handoffDocument, blockers);
} catch (error) {
  addIssue(blockers, "NOTIFICATION_PUSH_HANDOFF_UNREADABLE", "notification push handoff JSON must be readable.", {
    file: handoffPath,
    error: error instanceof Error ? error.message : String(error),
  });
}

const partial = buildPartial(handoffDocument, blockers);
const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  source: handoffPath,
  ...(partial ? { partial } : {}),
  checked: [
    "production HTTPS origin for web push",
    "VAPID public key config and private key secret custody",
    "push config and subscription endpoints",
    "Android real-device push subscription and click-through",
    "targeted notice push dispatch evidence",
    "expired subscription and permission fallback handling",
    "notification readiness and smoke checks",
    "raw secret value redaction",
  ],
  blockers,
  nextActions:
    blockers.length === 0
      ? []
      : [
          "운영 VAPID public/private key와 mailto subject를 배포 환경에 설정합니다.",
          "Android Chrome 또는 TWA 설치형 앱에서 알림 권한 허용, 구독 저장, 공지 push 수신, 클릭 후 공지함 이동을 캡처합니다.",
          "`npm run notification-push:handoff -- --file=.data/notification-push-handoff.json --out=.data/notification-push-handoff.report.json`를 다시 실행합니다.",
        ],
};

if (outPath) {
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));

if (!args.allowPending && blockers.length > 0) {
  process.exit(1);
}
