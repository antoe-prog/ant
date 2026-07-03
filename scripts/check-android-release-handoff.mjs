import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const handoffPath = path.resolve(args.file ?? ".data/android-release-handoff.json");
const outPath = args.out ? path.resolve(args.out) : null;
const evidenceReferencePattern = /^(https:\/\/|s3:\/\/|gs:\/\/|az:\/\/|drive:\/\/|sharepoint:\/\/|box:\/\/|file:\/\/).+/i;

function parseArgs(argv) {
  const parsed = {
    allowPending: false,
  };

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

function addIssue(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
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
    normalized.includes("PLACEHOLDER") ||
    normalized.includes("SAMPLE") ||
    normalized.includes("EXAMPLE") ||
    normalized.includes("YYYY") ||
    normalized.includes("OWNER/REPO") ||
    normalized.includes("RUN_ID") ||
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

function validateHttpsProductionOrigin(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && !isPlaceholderProductionHost(url.hostname) && !isPlaceholder(value) ? url.origin : null;
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

function isLikelyApiOnlyHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return host === "api" || host.startsWith("api.") || host.includes(".api.");
}

function validateSha256Fingerprint(value) {
  return /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(text(value).toUpperCase());
}

function isPlaceholderSha256Fingerprint(value) {
  const normalized = text(value).toUpperCase();
  return normalized === "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
}

function validateSha256Digest(value) {
  return /^[a-f0-9]{64}$/.test(text(value).toLowerCase());
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readJson(filePath) {
  const buffer = await readFile(filePath);
  return JSON.parse(buffer.toString("utf8"));
}

async function verifyArtifact(key, artifact, blockers) {
  if (!artifact || typeof artifact !== "object") {
    addIssue(blockers, "ANDROID_HANDOFF_ARTIFACT_MISSING", "Android release handoff is missing a required artifact entry.", { key });
    return;
  }

  const artifactPath = text(artifact.path);
  const expectedSha = text(artifact.sha256).toLowerCase();
  const expectedSize = Number(artifact.sizeBytes);

  if (isPlaceholder(artifactPath)) {
    addIssue(blockers, "ANDROID_HANDOFF_ARTIFACT_PATH_PLACEHOLDER", "artifact path must be filled with a real file path.", { key, path: artifact.path ?? null });
    return;
  }

  if (!validateSha256Digest(expectedSha)) {
    addIssue(blockers, "ANDROID_HANDOFF_ARTIFACT_SHA_INVALID", "artifact SHA-256 must be a 64-character lowercase hex digest.", { key, sha256: artifact.sha256 ?? null });
  }

  if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
    addIssue(blockers, "ANDROID_HANDOFF_ARTIFACT_SIZE_INVALID", "artifact sizeBytes must be greater than zero.", { key, sizeBytes: artifact.sizeBytes ?? null });
  }

  try {
    const buffer = await readFile(path.resolve(artifactPath));
    const actualSha = sha256(buffer);

    if (validateSha256Digest(expectedSha) && actualSha !== expectedSha) {
      addIssue(blockers, "ANDROID_HANDOFF_ARTIFACT_SHA_MISMATCH", "artifact SHA-256 does not match the file.", { key, path: artifactPath, expectedSha, actualSha });
    }

    if (Number.isFinite(expectedSize) && expectedSize > 0 && buffer.byteLength !== expectedSize) {
      addIssue(blockers, "ANDROID_HANDOFF_ARTIFACT_SIZE_MISMATCH", "artifact sizeBytes does not match the file.", {
        key,
        path: artifactPath,
        expectedSize,
        actualSize: buffer.byteLength,
      });
    }
  } catch (error) {
    addIssue(blockers, "ANDROID_HANDOFF_ARTIFACT_UNREADABLE", "artifact file must be readable before Android release handoff.", {
      key,
      path: artifactPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function validateDoctorReport(document, blockers) {
  const doctorPath = text(document?.artifacts?.doctorReport?.path);
  if (isPlaceholder(doctorPath)) {
    return;
  }

  let doctor = null;
  try {
    doctor = await readJson(path.resolve(doctorPath));
  } catch (error) {
    addIssue(blockers, "ANDROID_HANDOFF_DOCTOR_UNREADABLE", "doctor report artifact must be readable JSON.", {
      path: doctorPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const origin = validateHttpsProductionOrigin(document.productionOrigin);
  const releaseSha256 = text(document.releaseSha256).toUpperCase();
  const doctorOrigin = text(doctor?.checks?.origin?.value);
  const doctorSha256 = text(doctor?.checks?.sha256?.value).toUpperCase();

  if (doctor?.ok !== true || (doctor?.blockers?.length ?? 0) > 0) {
    addIssue(blockers, "ANDROID_HANDOFF_DOCTOR_NOT_READY", "Android TWA doctor report must pass before Android release handoff.", {
      ok: doctor?.ok ?? null,
      blockerCount: doctor?.blockers?.length ?? null,
    });
  }

  if (origin && (doctor?.checks?.origin?.ok !== true || doctorOrigin !== origin)) {
    addIssue(blockers, "ANDROID_HANDOFF_DOCTOR_ORIGIN", "doctor report origin must match the Android handoff productionOrigin.", {
      expected: origin,
      actual: doctorOrigin || null,
    });
  }

  if (doctor?.checks?.sha256?.ok !== true || doctorSha256 !== releaseSha256) {
    addIssue(blockers, "ANDROID_HANDOFF_DOCTOR_RELEASE_FINGERPRINT", "doctor report release SHA-256 must match the Android handoff fingerprint.", {
      expected: releaseSha256 || null,
      actual: doctorSha256 || null,
    });
  }
}

function validateEvidence(blockers, code, label, value) {
  const evidence = text(value);
  if (!isEvidenceReference(evidence)) {
    addIssue(blockers, code, `${label} evidence must be an HTTPS URL or provider storage URI.`, { evidence: value ?? null });
  }
}

function isEvidenceReference(value) {
  const evidence = text(value);
  return Boolean(evidence && !isPlaceholder(evidence) && evidenceReferencePattern.test(evidence));
}

function validateHandoff(document, blockers) {
  if (document.schemaVersion !== 1) {
    addIssue(blockers, "ANDROID_HANDOFF_SCHEMA_VERSION", "Android release handoff schemaVersion must be 1.", { schemaVersion: document.schemaVersion ?? null });
  }

  const generatedAt = parseDateTime(document.generatedAt);
  if (!generatedAt || isPlaceholder(document.generatedAt)) {
    addIssue(blockers, "ANDROID_HANDOFF_GENERATED_AT", "generatedAt must be a real ISO timestamp.", { generatedAt: document.generatedAt ?? null });
  }

  if (document.packageName !== "kr.co.finaljudo.multigym") {
    addIssue(blockers, "ANDROID_HANDOFF_PACKAGE_NAME", "packageName must match the Android TWA package.", { packageName: document.packageName ?? null });
  }

  const origin = validateHttpsProductionOrigin(document.productionOrigin);
  if (!origin || isPlaceholder(document.productionOrigin)) {
    addIssue(blockers, "ANDROID_HANDOFF_ORIGIN", "productionOrigin must be a real HTTPS web app production origin.", {
      productionOrigin: document.productionOrigin ?? null,
    });
  } else if (isLikelyApiOnlyHost(new URL(origin).hostname)) {
    addIssue(
      blockers,
      "ANDROID_HANDOFF_API_ORIGIN",
      "productionOrigin must be the HTTPS web app origin that serves /login and /app/dashboard, not an API-only-looking host.",
      { productionOrigin: document.productionOrigin ?? null },
    );
  }

  if (!validateSha256Fingerprint(document.releaseSha256) || isPlaceholder(document.releaseSha256) || isPlaceholderSha256Fingerprint(document.releaseSha256)) {
    addIssue(blockers, "ANDROID_HANDOFF_RELEASE_FINGERPRINT", "releaseSha256 must be a release signing certificate SHA-256 fingerprint.", {
      releaseSha256: document.releaseSha256 ?? null,
    });
  }

  const workflow = document.workflow ?? {};
  if (!["github-actions", "local"].includes(text(workflow.source))) {
    addIssue(blockers, "ANDROID_HANDOFF_WORKFLOW_SOURCE", "workflow.source must be github-actions or local.", { source: workflow.source ?? null });
  }

  if (text(workflow.source) === "github-actions" && (!text(workflow.runUrl).startsWith("https://github.com/") || isPlaceholder(workflow.runUrl))) {
    addIssue(blockers, "ANDROID_HANDOFF_WORKFLOW_RUN_URL", "GitHub Actions handoff must include the workflow run URL.", { runUrl: workflow.runUrl ?? null });
  }

  if (text(workflow.artifactName) !== "final-judo-android-twa") {
    addIssue(blockers, "ANDROID_HANDOFF_WORKFLOW_ARTIFACT", "workflow artifactName must be final-judo-android-twa.", {
      artifactName: workflow.artifactName ?? null,
    });
  }

  if (workflow.buildArtifacts !== true) {
    addIssue(blockers, "ANDROID_HANDOFF_WORKFLOW_BUILD_ARTIFACTS", "buildArtifacts must be true for APK/AAB release handoff.");
  }

  validateEvidence(blockers, "ANDROID_HANDOFF_WORKFLOW_EVIDENCE", "workflow", workflow.evidence);

  const assetLinks = document.digitalAssetLinks ?? {};
  if (origin && text(assetLinks.deployedUrl) !== `${origin}/.well-known/assetlinks.json`) {
    addIssue(blockers, "ANDROID_HANDOFF_ASSETLINKS_URL", "digitalAssetLinks.deployedUrl must match the production origin.", {
      deployedUrl: assetLinks.deployedUrl ?? null,
      expected: `${origin}/.well-known/assetlinks.json`,
    });
  }

  if (assetLinks.verified !== true) {
    addIssue(blockers, "ANDROID_HANDOFF_ASSETLINKS_VERIFIED", "Digital Asset Links deployment must be verified.");
  }
  validateEvidence(blockers, "ANDROID_HANDOFF_ASSETLINKS_EVIDENCE", "Digital Asset Links", assetLinks.evidence);

  const signing = document.signing ?? {};
  if (!["google-play-app-signing", "self-managed"].includes(text(signing.playAppSigningDecision))) {
    addIssue(blockers, "ANDROID_HANDOFF_SIGNING_DECISION", "signing.playAppSigningDecision must be google-play-app-signing or self-managed.", {
      playAppSigningDecision: signing.playAppSigningDecision ?? null,
    });
  }
  if (!["secret-store", "hardware-token", "offline-vault"].includes(text(signing.keystoreCustody))) {
    addIssue(blockers, "ANDROID_HANDOFF_KEYSTORE_CUSTODY", "signing.keystoreCustody must describe a safe custody location.", {
      keystoreCustody: signing.keystoreCustody ?? null,
    });
  }
  if (signing.keystoreNotCommitted !== true) {
    addIssue(blockers, "ANDROID_HANDOFF_KEYSTORE_COMMITTED", "release keystore must not be committed to the repository.");
  }
  if (text(signing.uploadKeyOwner).length < 2 || isPlaceholder(signing.uploadKeyOwner)) {
    addIssue(blockers, "ANDROID_HANDOFF_UPLOAD_KEY_OWNER", "uploadKeyOwner must be filled.");
  }
  validateEvidence(blockers, "ANDROID_HANDOFF_SIGNING_EVIDENCE", "signing", signing.evidence);

  const smoke = document.deviceSmoke ?? {};
  for (const key of [
    "installed",
    "loginVerified",
    "coachAttendanceVerified",
    "notificationPermissionChecked",
    "noBrowserAddressBar",
    "noHorizontalOverflow",
  ]) {
    if (smoke[key] !== true) {
      addIssue(blockers, "ANDROID_HANDOFF_DEVICE_SMOKE", "installed Android app smoke test must pass every required check.", { key, value: smoke[key] ?? null });
    }
  }
  if (text(smoke.device).length < 3 || isPlaceholder(smoke.device)) {
    addIssue(blockers, "ANDROID_HANDOFF_DEVICE_NAME", "deviceSmoke.device must name the tested Android device/browser.");
  }
  validateEvidence(blockers, "ANDROID_HANDOFF_DEVICE_EVIDENCE", "device smoke", smoke.evidence);

  const signoff = document.signoff ?? {};
  if (text(signoff.signedOffBy).length < 2 || isPlaceholder(signoff.signedOffBy)) {
    addIssue(blockers, "ANDROID_HANDOFF_SIGNOFF_OWNER", "signoff.signedOffBy must be filled.");
  }
  const signedOffAt = parseDateTime(signoff.signedOffAt);
  if (!signedOffAt || isPlaceholder(signoff.signedOffAt)) {
    addIssue(blockers, "ANDROID_HANDOFF_SIGNOFF_AT", "signoff.signedOffAt must be a real ISO timestamp.", { signedOffAt: signoff.signedOffAt ?? null });
  }
  if (generatedAt && signedOffAt && signedOffAt < generatedAt) {
    addIssue(blockers, "ANDROID_HANDOFF_SIGNOFF_TIMELINE", "signoff.signedOffAt must be at or after generatedAt.", {
      generatedAt: document.generatedAt ?? null,
      signedOffAt: signoff.signedOffAt ?? null,
    });
  }
  validateEvidence(blockers, "ANDROID_HANDOFF_SIGNOFF_EVIDENCE", "signoff", signoff.evidence);
}

function buildPartialStatus(document, blockers) {
  const assetLinks = document?.digitalAssetLinks ?? {};
  const origin = validateHttpsProductionOrigin(document?.productionOrigin);
  const expectedAssetLinksUrl = origin ? `${origin}/.well-known/assetlinks.json` : null;
  const originBlockerCodes = new Set(["ANDROID_HANDOFF_ORIGIN", "ANDROID_HANDOFF_API_ORIGIN", "ANDROID_HANDOFF_ASSETLINKS_URL"]);
  const originBlockers = blockers.filter((blocker) => originBlockerCodes.has(blocker.code));
  const apiOnlyOrigin = origin ? isLikelyApiOnlyHost(new URL(origin).hostname) : false;

  return {
    webAppOrigin: {
      ready:
        originBlockers.length === 0 &&
        Boolean(origin) &&
        !apiOnlyOrigin &&
        text(assetLinks.deployedUrl) === expectedAssetLinksUrl,
      productionOrigin: origin,
      assetLinksUrl: text(assetLinks.deployedUrl) || null,
      expectedAssetLinksUrl,
      blockerCodes: originBlockers.map((blocker) => blocker.code),
    },
  };
}

const blockers = [];
let handoff = null;

try {
  handoff = await readJson(handoffPath);
} catch (error) {
  addIssue(blockers, "ANDROID_HANDOFF_UNREADABLE", "Android release handoff JSON must be readable.", {
    path: handoffPath,
    error: error instanceof Error ? error.message : String(error),
  });
}

if (handoff) {
  validateHandoff(handoff, blockers);
  await validateDoctorReport(handoff, blockers);

  for (const key of ["doctorReport", "assetLinks", "buildPlan", "apk", "aab"]) {
    await verifyArtifact(key, handoff.artifacts?.[key], blockers);
  }
}

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  file: handoffPath,
  partial: buildPartialStatus(handoff, blockers),
  checked: [
    "Android package name and production origin",
    "release signing SHA-256 fingerprint",
    "Android TWA doctor origin and release fingerprint",
    "GitHub Actions/local build provenance",
    "doctor, assetlinks, build-plan, APK, and AAB artifact hashes",
    "Digital Asset Links deployment evidence",
    "Play/App signing and keystore custody evidence",
    "installed Android app smoke evidence including no browser address bar",
    "release signoff",
  ],
  blockers,
};

if (outPath) {
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));

if (!args.allowPending && blockers.length > 0) {
  process.exit(1);
}
