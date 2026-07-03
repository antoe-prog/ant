import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(args.out ?? ".data/android-release-handoff.json");

function parseArgs(argv) {
  const parsed = {
    artifactName: "final-judo-android-twa",
    assetLinksPath: "mobile/android/generated/assetlinks.json",
    buildArtifacts: true,
    buildPlanPath: "mobile/android/generated/build-plan.json",
    doctorPath: ".data/android-twa-doctor.json",
    apkPath: "mobile/android/twa/app-release-signed.apk",
    aabPath: "mobile/android/twa/app-release-bundle.aab",
    keystoreCustody: "secret-store",
    signingDecision: "google-play-app-signing",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--assetlinks-verified") {
      parsed.assetLinksVerified = true;
      continue;
    }

    if (arg === "--device-smoke-passed") {
      parsed.deviceInstalled = true;
      parsed.loginVerified = true;
      parsed.coachAttendanceVerified = true;
      parsed.notificationPermissionChecked = true;
      parsed.noBrowserAddressBar = true;
      parsed.noHorizontalOverflow = true;
      continue;
    }

    if (arg === "--build-artifacts=false") {
      parsed.buildArtifacts = false;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--out") {
      parsed.out = value;
    } else if (key === "--origin") {
      parsed.origin = value;
    } else if (key === "--sha256") {
      parsed.sha256 = value;
    } else if (key === "--doctor") {
      parsed.doctorPath = value;
    } else if (key === "--assetlinks") {
      parsed.assetLinksPath = value;
    } else if (key === "--build-plan") {
      parsed.buildPlanPath = value;
    } else if (key === "--apk") {
      parsed.apkPath = value;
    } else if (key === "--aab") {
      parsed.aabPath = value;
    } else if (key === "--workflow-source") {
      parsed.workflowSource = value;
    } else if (key === "--workflow-run-url") {
      parsed.workflowRunUrl = value;
    } else if (key === "--workflow-evidence") {
      parsed.workflowEvidence = value;
    } else if (key === "--artifact-name") {
      parsed.artifactName = value;
    } else if (key === "--assetlinks-evidence") {
      parsed.assetLinksEvidence = value;
    } else if (key === "--signing-decision") {
      parsed.signingDecision = value;
    } else if (key === "--keystore-custody") {
      parsed.keystoreCustody = value;
    } else if (key === "--upload-key-owner") {
      parsed.uploadKeyOwner = value;
    } else if (key === "--signing-evidence") {
      parsed.signingEvidence = value;
    } else if (key === "--device") {
      parsed.device = value;
    } else if (key === "--device-evidence") {
      parsed.deviceEvidence = value;
    } else if (key === "--signed-off-by") {
      parsed.signedOffBy = value;
    } else if (key === "--signed-off-at") {
      parsed.signedOffAt = value;
    } else if (key === "--signoff-evidence") {
      parsed.signoffEvidence = value;
    }
  }

  return parsed;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readJsonIfPresent(filePath) {
  try {
    const buffer = await readFile(path.resolve(filePath));
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

async function artifactEntry(key, filePath, missingArtifacts) {
  const resolved = path.resolve(filePath);

  try {
    const buffer = await readFile(resolved);
    return {
      path: filePath,
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch {
    missingArtifacts.push(key);
    return {
      path: filePath,
      sha256: "TODO_SHA256",
      sizeBytes: 0,
    };
  }
}

function inferOrigin({ explicitOrigin, doctor, buildPlan }) {
  return (
    text(explicitOrigin) ||
    text(doctor?.checks?.origin?.value) ||
    text(buildPlan?.origin) ||
    "TODO_PRODUCTION_ORIGIN"
  );
}

function inferSha256({ explicitSha256, doctor, assetLinks }) {
  const explicit = text(explicitSha256);
  if (explicit) {
    return explicit;
  }

  const doctorSha256 = text(doctor?.checks?.sha256?.value);
  if (doctor?.checks?.sha256?.ok === true && doctorSha256) {
    return doctorSha256;
  }

  if (!doctor) {
    return text(assetLinks?.[0]?.target?.sha256_cert_fingerprints?.[0]) || "TODO_RELEASE_SHA256";
  }

  return "TODO_RELEASE_SHA256";
}

const [doctor, assetLinks, buildPlan] = await Promise.all([
  readJsonIfPresent(args.doctorPath),
  readJsonIfPresent(args.assetLinksPath),
  readJsonIfPresent(args.buildPlanPath),
]);
const productionOrigin = inferOrigin({ explicitOrigin: args.origin, doctor, buildPlan });
const releaseSha256 = inferSha256({ explicitSha256: args.sha256, doctor, assetLinks });
const missingArtifacts = [];
const artifacts = {
  doctorReport: await artifactEntry("doctorReport", args.doctorPath, missingArtifacts),
  assetLinks: await artifactEntry("assetLinks", args.assetLinksPath, missingArtifacts),
  buildPlan: await artifactEntry("buildPlan", args.buildPlanPath, missingArtifacts),
  apk: await artifactEntry("apk", args.apkPath, missingArtifacts),
  aab: await artifactEntry("aab", args.aabPath, missingArtifacts),
};
const workflowSource = text(args.workflowSource) || (text(args.workflowRunUrl) ? "github-actions" : "local");
const handoff = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  packageName: "kr.co.finaljudo.multigym",
  productionOrigin,
  releaseSha256,
  workflow: {
    source: workflowSource,
    runUrl: text(args.workflowRunUrl) || (workflowSource === "github-actions" ? "https://github.com/OWNER/REPO/actions/runs/RUN_ID" : "local-build"),
    artifactName: args.artifactName,
    buildArtifacts: args.buildArtifacts,
    evidence: text(args.workflowEvidence) || "TODO_WORKFLOW_OR_LOCAL_BUILD_EVIDENCE",
  },
  artifacts,
  digitalAssetLinks: {
    deployedUrl: `${productionOrigin}/.well-known/assetlinks.json`,
    verified: args.assetLinksVerified === true,
    evidence: text(args.assetLinksEvidence) || "TODO_ASSETLINKS_DEPLOYMENT_EVIDENCE",
  },
  signing: {
    playAppSigningDecision: args.signingDecision,
    keystoreCustody: args.keystoreCustody,
    uploadKeyOwner: text(args.uploadKeyOwner) || "TODO_UPLOAD_KEY_OWNER",
    keystoreNotCommitted: true,
    evidence: text(args.signingEvidence) || "TODO_SIGNING_AND_KEYSTORE_EVIDENCE",
  },
  deviceSmoke: {
    device: text(args.device) || "TODO_ANDROID_DEVICE",
    installed: args.deviceInstalled === true,
    loginVerified: args.loginVerified === true,
    coachAttendanceVerified: args.coachAttendanceVerified === true,
    notificationPermissionChecked: args.notificationPermissionChecked === true,
    noBrowserAddressBar: args.noBrowserAddressBar === true,
    noHorizontalOverflow: args.noHorizontalOverflow === true,
    evidence: text(args.deviceEvidence) || "TODO_ANDROID_DEVICE_SMOKE_EVIDENCE",
  },
  signoff: {
    signedOffBy: text(args.signedOffBy) || "TODO_SIGNOFF_OWNER",
    signedOffAt: text(args.signedOffAt) || "YYYY-MM-DDTHH:mm:ssZ",
    evidence: text(args.signoffEvidence) || "TODO_SIGNOFF_EVIDENCE",
  },
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(handoff, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      inferred: {
        productionOrigin,
        releaseSha256,
        workflowSource,
      },
      missingArtifacts,
      nextAction:
        missingArtifacts.length === 0
          ? `Run npm run android:release-handoff -- --file=${outPath}`
          : "누락된 Android 산출물을 생성한 뒤 이 초안 명령을 다시 실행합니다.",
    },
    null,
    2,
  ),
);
