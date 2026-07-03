import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeGitHubRepository } from "./lib/github-repository.mjs";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const outPath = args.out ? path.resolve(args.out) : null;
const markdownPath = args.markdown ? path.resolve(args.markdown) : null;
const externalBlockersCsvPath = args.externalBlockersCsv ? path.resolve(args.externalBlockersCsv) : null;

const artifactPaths = {
  actionChecklist: path.join(workspace, "p1-handoff-action-checklist.json"),
  androidDoctor: path.join(workspace, "android-twa-doctor.json"),
  androidDoctorMarkdown: path.join(workspace, "android-twa-doctor.md"),
  androidRoleApks: path.join(workspace, "mobile-builds", "role-apks-20260617", "role-apk-build-report.json"),
  bundleManifest: path.join(workspace, "p1-handoff-bundle-manifest.json"),
  dispatchReport: path.join(workspace, "p1-handoff-dispatch-report.json"),
  evidenceIntakeReport: path.join(workspace, "p1-evidence-intake-report.json"),
  githubConnectorAccess: path.join(workspace, "p1-github-connector-access.json"),
  githubConnectorPayloads: path.join(workspace, "p1-handoff-issue-drafts", "github-connector-issue-payloads.json"),
  issueRegistrationReport: path.join(workspace, "p1-handoff-issue-registration-report.json"),
  iosCapacitorConnection: path.join(workspace, "mobile-builds", "ios", "ios-capacitor-connection.json"),
  iosIpaDoctor: path.join(workspace, "mobile-builds", "ios", "ios-ipa-doctor.json"),
  iosIpaDoctorMarkdown: path.join(workspace, "mobile-builds", "ios", "ios-ipa-doctor.md"),
  ownerDecisionRegister: path.join(workspace, "p1-owner-decision-register.json"),
  ownerDecisionRegisterCompleted: path.join(workspace, "p1-owner-decision-register.completed.json"),
  p1Readiness: path.join(workspace, "p1-readiness.json"),
  releaseArchiveManifest: path.join(workspace, "p1-release-archives", "final-judo-p1-20260715", "p1-release-archive-manifest.json"),
  releasePackage: path.join(workspace, "p1-release-package.json"),
  releaseStorageReceipt: path.join(workspace, "p1-release-storage-receipt.json"),
};

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

    parsed[key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
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

function hasPlaceholder(value) {
  return !text(value) || /TODO|TBD|placeholder|example|sample|yyyy|미정|예시|샘플|<[^>]+>/i.test(text(value));
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

function addBlocker(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

async function readJsonArtifact(key, filePath, blockers, { blockWhenPresent = false, required = true } = {}) {
  try {
    const source = await readFile(filePath, "utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_OPERATOR_STATUS_SECRET_LIKE_VALUE", "P1 operator status artifacts must not include raw secret-like values.", {
        artifact: key,
        path: rel(filePath),
      });
      return { exists: true, json: null, error: "secret-like value" };
    }

    return { exists: true, json: JSON.parse(source), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingFile = error && typeof error === "object" && "code" in error && error.code === "ENOENT";

    if (required || (blockWhenPresent && !missingFile)) {
      addBlocker(blockers, "P1_OPERATOR_STATUS_ARTIFACT_MISSING", "P1 operator status requires the generated P1 handoff workspace artifact.", {
        artifact: key,
        path: rel(filePath),
        error: message,
      });
    }

    return { exists: !missingFile, json: null, error: message };
  }
}

async function readTextArtifact(key, filePath, blockers, { required = true } = {}) {
  try {
    const source = await readFile(filePath, "utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_OPERATOR_STATUS_SECRET_LIKE_VALUE", "P1 operator status artifacts must not include raw secret-like values.", {
        artifact: key,
        path: rel(filePath),
      });
      return { exists: true, source: null, error: "secret-like value" };
    }

    return { exists: true, source, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (required) {
      addBlocker(blockers, "P1_OPERATOR_STATUS_ARTIFACT_MISSING", "P1 operator status requires the generated P1 handoff workspace artifact.", {
        artifact: key,
        path: rel(filePath),
        error: message,
      });
    }

    return { exists: false, source: null, error: message };
  }
}

function releaseDecision(document) {
  return text(document?.releaseDecision) || (document?.ok === true ? "ready" : "blocked");
}

function isReady(document) {
  return document?.ok === true && releaseDecision(document) === "ready" && (document?.blockers?.length ?? 0) === 0;
}

function storageReceiptReady(document) {
  return (
    document?.version === 1 &&
    !hasPlaceholder(document.uploadedAt) &&
    !hasPlaceholder(document.uploadedBy) &&
    !hasPlaceholder(document.storageProvider) &&
    !hasPlaceholder(document.storageLocation) &&
    !hasPlaceholder(document.evidence) &&
    !hasPlaceholder(document.retentionPolicy?.owner) &&
    !hasPlaceholder(document.retentionPolicy?.accessReviewDueOn) &&
    !hasPlaceholder(document.retentionPolicy?.evidence) &&
    Number(document.retentionPolicy?.minimumRetentionDays) >= 365 &&
    Array.isArray(document.uploadedArtifacts) &&
    document.uploadedArtifacts.length >= 9 &&
    document.uploadedArtifacts.every(
      (artifact) =>
        !hasPlaceholder(artifact?.key) &&
        !hasPlaceholder(artifact?.archivedPath) &&
        !hasPlaceholder(artifact?.sha256) &&
        !hasPlaceholder(artifact?.storageLocation) &&
        Number(artifact?.sizeBytes) > 0,
    )
  );
}

function nestedNextActions(document) {
  return Array.isArray(document?.nextActions) ? document.nextActions.map(text).filter(Boolean) : [];
}

function requirementRows(readiness) {
  if (!readiness) {
    return [];
  }

  if (readiness.requirements && typeof readiness.requirements === "object") {
    return Object.values(readiness.requirements).map((requirement) => ({
      key: text(requirement?.key),
      label: text(requirement?.label),
      status: text(requirement?.status) || (requirement?.releaseDecision === "ready" ? "ready" : "blocked"),
      blockerCount: Array.isArray(requirement?.blockerCodes) && requirement.blockerCodes.length > 0
        ? requirement.blockerCodes.length
        : typeof requirement?.blockerCount === "number"
          ? requirement.blockerCount
          : requirement?.status === "ready"
            ? 0
            : null,
      nextAction: text(requirement?.nextAction),
      path: text(requirement?.path),
      command: text(requirement?.command),
    }));
  }

  if (Array.isArray(readiness.requirements)) {
    return readiness.requirements.map((requirement) => ({
      key: text(requirement?.key),
      label: text(requirement?.label),
      status: text(requirement?.status),
      blockerCount: typeof requirement?.blockerCount === "number" ? requirement.blockerCount : null,
      nextAction: text(requirement?.nextAction),
      path: text(requirement?.path),
      command: text(requirement?.command),
    }));
  }

  return [];
}

function defaultNextActionForArtifact(key) {
  const actions = {
    releaseArchiveManifest:
      "npm run p1:release-archive -- --package=.data/p1-release-package.json --archive-dir=.data/p1-release-archives/final-judo-p1-20260715",
    releasePackage: "npm run p1:release-package -- --workspace=.data --out=.data/p1-release-package.json",
    releaseStorageReceipt:
      "npm run p1:release-storage-receipt:draft -- --archive=.data/p1-release-archives/final-judo-p1-20260715/p1-release-archive-manifest.json --out=.data/p1-release-storage-receipt.json",
  };

  return actions[key] ?? "npm run p1:handoff-draft -- --out-dir=.data";
}

function releaseCustodyPrerequisiteAction() {
  return "P1 readiness와 evidence intake가 strict-ready가 된 뒤 release package/archive/storage receipt 보관 단계를 실행합니다.";
}

function summarizeDocument(key, label, readResult) {
  if (!readResult.exists) {
    return {
      key,
      label,
      status: "missing",
      releaseDecision: "missing",
      path: rel(artifactPaths[key]),
      blockerCount: 1,
      nextAction: defaultNextActionForArtifact(key),
    };
  }

  const document = readResult.json;

  return {
    key,
    label,
    status: isReady(document) ? "ready" : "blocked",
    releaseDecision: releaseDecision(document),
    generatedAt: document?.generatedAt ?? null,
    path: rel(artifactPaths[key]),
    blockerCount: Array.isArray(document?.blockers) ? document.blockers.length : releaseDecision(document) === "ready" ? 0 : null,
    nextAction: nestedNextActions(document)[0] ?? "",
  };
}

function summarizeAndroidDoctorMarkdown(readResult) {
  if (!readResult.exists) {
    return {
      key: "androidDoctorMarkdown",
      label: "Android TWA doctor Markdown",
      status: "missing",
      releaseDecision: "missing",
      path: rel(artifactPaths.androidDoctorMarkdown),
      blockerCount: 1,
      nextAction: "npm run p1:handoff-draft -- --out-dir=.data",
    };
  }

  const source = readResult.source ?? "";
  const valid = source.includes("# Android TWA Doctor") && source.includes("| Check | Status | Detail |") && source.includes("## Next Actions");

  return {
    key: "androidDoctorMarkdown",
    label: "Android TWA doctor Markdown",
    status: valid ? "ready" : "blocked",
    releaseDecision: valid ? "ready" : "blocked",
    path: rel(artifactPaths.androidDoctorMarkdown),
    blockerCount: valid ? 0 : 1,
    nextAction: valid
      ? ""
      : "npm run android:twa:doctor -- --out=.data/android-twa-doctor.json --markdown=.data/android-twa-doctor.md",
  };
}

function summarizeAndroidDoctor(readResult) {
  if (!readResult.exists) {
    return {
      key: "androidDoctor",
      label: "Android TWA doctor status",
      status: "missing",
      releaseDecision: "missing",
      path: rel(artifactPaths.androidDoctor),
      blockerCount: 1,
      nextAction: "npm run android:twa:doctor -- --out=.data/android-twa-doctor.json --markdown=.data/android-twa-doctor.md",
    };
  }

  const document = readResult.json;
  const ready = document?.ok === true && (document?.blockers?.length ?? 0) === 0;
  const nextActions = nestedNextActions(document);
  const blockerChecks = Array.isArray(document?.blockers)
    ? document.blockers.map((blocker) => text(blocker?.check)).filter(Boolean)
    : [];

  return {
    key: "androidDoctor",
    label: "Android TWA doctor status",
    status: ready ? "ready" : "blocked",
    releaseDecision: ready ? "ready" : "blocked",
    generatedAt: document?.generatedAt ?? null,
    path: rel(artifactPaths.androidDoctor),
    blockerCount: Array.isArray(document?.blockers) ? document.blockers.length : ready ? 0 : 1,
    blockerChecks,
    nextAction: nextActions.length > 0
      ? nextActions.join(" ")
      : ready
        ? ""
        : "실제 HTTPS 운영 origin, release signing SHA-256, JDK/Android SDK를 준비한 뒤 android:twa:doctor를 다시 실행합니다.",
  };
}

function summarizeAndroidRoleApks(readResult) {
  if (!readResult.exists) {
    return {
      key: "androidRoleApks",
      label: "Android role APK build report",
      status: "missing",
      releaseDecision: "missing",
      path: rel(artifactPaths.androidRoleApks),
      blockerCount: 1,
      nextAction: "npm run test:android-role-apks -- --write",
    };
  }

  const document = readResult.json;
  const outputs = Array.isArray(document?.outputs) ? document.outputs : [];
  const expectedRoles = new Set(["member", "guardian", "coach", "owner"]);
  const outputRoles = new Set(outputs.map((output) => text(output?.role)).filter(Boolean));
  const ready =
    document?.ok === true &&
    outputs.length === 4 &&
    [...expectedRoles].every((role) => outputRoles.has(role)) &&
    outputs.every((output) => text(output?.apk) && Number(output?.bytes) > 0 && /^[a-f0-9]{64}$/.test(text(output?.sha256)));

  return {
    key: "androidRoleApks",
    label: "Android role APK build report",
    status: ready ? "ready" : "blocked",
    releaseDecision: ready ? document?.releaseDecision ?? "artifact_ready_release_blocked" : "blocked",
    generatedAt: document?.generatedAt ?? null,
    path: rel(artifactPaths.androidRoleApks),
    blockerCount: ready ? 0 : 1,
    roleCount: outputs.length,
    nextAction: ready ? "" : "npm run test:android-role-apks -- --write",
  };
}

function summarizeIosCapacitorConnection(readResult) {
  if (!readResult.exists) {
    return {
      key: "iosCapacitorConnection",
      label: "iOS Capacitor service connection",
      status: "missing",
      releaseDecision: "missing",
      path: rel(artifactPaths.iosCapacitorConnection),
      blockerCount: 1,
      nextAction:
        "npm run ios:cap:connection -- --out=.data/mobile-builds/ios/ios-capacitor-connection.json --markdown=.data/mobile-builds/ios/ios-capacitor-connection.md",
    };
  }

  const document = readResult.json;
  const ready =
    document?.ok === true &&
    text(document?.serviceRoute) === "/app/dashboard" &&
    text(document?.bundleId) === "kr.co.finaljudo.multigym" &&
    text(document?.releaseDecision) !== "ready";

  return {
    key: "iosCapacitorConnection",
    label: "iOS Capacitor service connection",
    status: ready ? "ready" : "blocked",
    releaseDecision: ready ? document?.releaseDecision ?? "simulator_connected_release_blocked" : "blocked",
    generatedAt: document?.generatedAt ?? null,
    path: rel(artifactPaths.iosCapacitorConnection),
    blockerCount: Array.isArray(document?.blockers) ? document.blockers.length : ready ? 0 : 1,
    mode: text(document?.checks?.generatedServerUrl?.mode) || null,
    serviceRoute: text(document?.serviceRoute) || null,
    nextAction: ready ? "" : "npm run test:ios-capacitor-connection",
  };
}

function summarizeIosIpaDoctor(readResult) {
  if (!readResult.exists) {
    return {
      key: "iosIpaDoctor",
      label: "iOS IPA doctor status",
      status: "missing",
      releaseDecision: "missing",
      path: rel(artifactPaths.iosIpaDoctor),
      blockerCount: 1,
      nextAction:
        "APPLE_TEAM_ID=<TEAM_ID> FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:doctor -- --team-id=<TEAM_ID> --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md",
    };
  }

  const document = readResult.json;
  const profileInventory = summarizeIosProvisioningProfileInventory(document);
  const ready = document?.ok === true && (document?.blockers?.length ?? 0) === 0 && releaseDecision(document) === "ready";
  const blockerChecks = Array.isArray(document?.blockers)
    ? document.blockers.map((blocker) => text(blocker?.check)).filter(Boolean)
    : [];
  const nextActions = nestedNextActions(document);
  const rerun = text(document?.resolutionHints?.rerun);

  return {
    key: "iosIpaDoctor",
    label: "iOS IPA doctor status",
    status: ready ? "ready" : "blocked",
    releaseDecision: releaseDecision(document),
    generatedAt: document?.generatedAt ?? null,
    path: rel(artifactPaths.iosIpaDoctor),
    blockerCount: Array.isArray(document?.blockers) ? document.blockers.length : ready ? 0 : 1,
    blockerChecks,
    bundleId: text(document?.bundleId) || null,
    profileInventory,
    nextAction: nextActions.length > 0
      ? nextActions.join(" ")
      : rerun || (ready ? "" : "운영 HTTPS 웹앱 origin과 실제 iPhone provisioning profile을 준비한 뒤 ios:ipa:doctor를 다시 실행합니다."),
  };
}

function summarizeIosProvisioningProfileInventory(document) {
  const inventory = document?.checks?.provisioningProfile?.inventory;

  return {
    directory: text(inventory?.directory) || null,
    totalProfileFiles: Number(inventory?.totalProfileFiles ?? 0),
    readableProfileFiles: Number(inventory?.readableProfileFiles ?? 0),
    unreadableProfileFiles: Number(inventory?.unreadableProfileFiles ?? 0),
    matchingTeamProfiles: Number(inventory?.matchingTeamProfiles ?? 0),
    matchingBundleProfiles: Number(inventory?.matchingBundleProfiles ?? 0),
    matchingProfiles: Number(inventory?.matchingProfiles ?? 0),
    matchingProfilesWithRegisteredDevices: Number(inventory?.matchingProfilesWithRegisteredDevices ?? 0),
    rawUdidWritten: false,
  };
}

function summarizeIosIpaDoctorMarkdown(readResult) {
  if (!readResult.exists) {
    return {
      key: "iosIpaDoctorMarkdown",
      label: "iOS IPA doctor Markdown",
      status: "missing",
      releaseDecision: "missing",
      path: rel(artifactPaths.iosIpaDoctorMarkdown),
      blockerCount: 1,
      nextAction:
        "APPLE_TEAM_ID=<TEAM_ID> FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:doctor -- --team-id=<TEAM_ID> --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md",
    };
  }

  const source = readResult.source ?? "";
  const valid =
    source.includes("# iOS IPA Doctor") &&
    source.includes("| Check | Status | Detail |") &&
    source.includes("## Provisioning Hints") &&
    source.includes("FINAL_JUDO_IOS_SERVER_URL");

  return {
    key: "iosIpaDoctorMarkdown",
    label: "iOS IPA doctor Markdown",
    status: valid ? "ready" : "blocked",
    releaseDecision: valid ? "ready" : "blocked",
    path: rel(artifactPaths.iosIpaDoctorMarkdown),
    blockerCount: valid ? 0 : 1,
    nextAction: valid
      ? ""
      : "APPLE_TEAM_ID=<TEAM_ID> FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:doctor -- --team-id=<TEAM_ID> --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md",
  };
}

function summarizeStorageReceipt(readResult) {
  if (!readResult.exists) {
    return {
      key: "releaseStorageReceipt",
      label: "P1 release storage receipt",
      status: "missing",
      releaseDecision: "missing",
      path: rel(artifactPaths.releaseStorageReceipt),
      blockerCount: 1,
      nextAction:
        "npm run p1:release-storage-receipt:draft -- --archive=.data/p1-release-archives/final-judo-p1-20260715/p1-release-archive-manifest.json --out=.data/p1-release-storage-receipt.json",
    };
  }

  const ready = storageReceiptReady(readResult.json);

  return {
    key: "releaseStorageReceipt",
    label: "P1 release storage receipt",
    status: ready ? "ready" : "blocked",
    releaseDecision: ready ? "ready" : "blocked",
    generatedAt: readResult.json?.uploadedAt ?? null,
    path: rel(artifactPaths.releaseStorageReceipt),
    blockerCount: ready ? 0 : 1,
    nextAction: ready
      ? ""
      : "storage upload/retention 필드를 모두 채운 뒤 `npm run p1:release-storage-receipt -- --file=.data/p1-release-storage-receipt.json --archive=.data/p1-release-archives/final-judo-p1-20260715/p1-release-archive-manifest.json`를 실행합니다.",
  };
}

function summarizeOwnerDecisionRegister(sourceRead, completedRead) {
  const source = sourceRead.json;
  const completed = completedRead.json;
  const decisionRows = Number(source?.summary?.decisionRows ?? source?.decisionRows?.length ?? 0) || null;
  const completedRows = Number(completed?.summary?.completedDecisionRows ?? completed?.decisionRows?.length ?? 0) || 0;
  const completedReady =
    completedRead.exists &&
    completed?.ownerDecisionRegisterCompleted === true &&
    text(completed?.registerDecision) === "decisions_recorded" &&
    completedRows > 0 &&
    (decisionRows === null || completedRows === decisionRows);

  if (completedReady) {
    return {
      state: "decisions_recorded",
      ready: true,
      sourcePath: sourceRead.exists ? rel(artifactPaths.ownerDecisionRegister) : null,
      completedPath: rel(artifactPaths.ownerDecisionRegisterCompleted),
      registerDecision: text(completed.registerDecision),
      decisionRows,
      completedDecisionRows: completedRows,
      nextAction: "대표 결정은 기록되었습니다. 각 외부 handoff 증빙을 수집하고 strict 검증 명령을 실행합니다.",
    };
  }

  if (sourceRead.exists) {
    return {
      state: "needs_owner_input",
      ready: false,
      sourcePath: rel(artifactPaths.ownerDecisionRegister),
      completedPath: completedRead.exists ? rel(artifactPaths.ownerDecisionRegisterCompleted) : null,
      registerDecision: text(source?.registerDecision) || "needs_owner_input",
      decisionRows,
      completedDecisionRows: completedRows,
      nextAction:
        "대표가 .data/p1-owner-decision-register.csv의 담당자/기한/증빙 책임자를 채운 뒤 npm run owner:decision-register:apply-csv를 실행합니다.",
    };
  }

  return {
    state: "register_missing",
    ready: false,
    sourcePath: null,
    completedPath: null,
    registerDecision: null,
    decisionRows: null,
    completedDecisionRows: 0,
    nextAction:
      "npm run owner:decision-register -- --workspace=.data --out=.data/p1-owner-decision-register.json --markdown=.data/p1-owner-decision-register.md --csv=.data/p1-owner-decision-register.csv",
  };
}

function withReleaseCustodyPrerequisite(artifact, releasePrerequisitesReady) {
  if (releasePrerequisitesReady || !["releasePackage", "releaseArchiveManifest", "releaseStorageReceipt"].includes(artifact.key)) {
    return artifact;
  }

  if (artifact.status !== "ready") {
    return {
      ...artifact,
      status: "deferred",
      releaseDecision: "deferred_prerequisites_blocked",
      blockerCount: 0,
      nextAction: releaseCustodyPrerequisiteAction(),
    };
  }

  return {
    ...artifact,
    nextAction: artifact.nextAction,
  };
}

function releaseCustodyNextActions(releasePrerequisitesReady, releaseCustody) {
  if (!releasePrerequisitesReady) {
    return [releaseCustodyPrerequisiteAction()];
  }

  if (!releaseCustody.packageReady) {
    return ["npm run p1:release-package -- --workspace=.data --out=.data/p1-release-package.json"];
  }

  if (!releaseCustody.archiveReady) {
    return [
      "npm run p1:release-archive -- --package=.data/p1-release-package.json --archive-dir=.data/p1-release-archives/final-judo-p1-20260715",
    ];
  }

  if (!releaseCustody.storageReceiptReady) {
    return [
      "npm run p1:release-storage-receipt:draft -- --archive=.data/p1-release-archives/final-judo-p1-20260715/p1-release-archive-manifest.json --out=.data/p1-release-storage-receipt.json",
    ];
  }

  return [];
}

function parseConnectorAccessRepository(document) {
  return document?.repository ?? document?.result ?? document;
}

function validIsoTimestamp(value) {
  return !hasPlaceholder(value) && /^\d{4}-\d{2}-\d{2}T/.test(text(value)) && Number.isFinite(Date.parse(value));
}

function summarizeGitHubConnectorAccess(readResult, expectedRepo, blockers, { required }) {
  const summary = {
    key: "githubConnectorAccess",
    label: "GitHub connector access receipt",
    status: "missing",
    releaseDecision: "missing",
    path: rel(artifactPaths.githubConnectorAccess),
    blockerCount: required ? 1 : 0,
    nextAction:
      "GitHub connector _get_repo 출력을 .data/p1-github-connector-access.json에 저장한 뒤 npm run test:p1-github-connector-readiness를 실행합니다.",
    connector: null,
    repositoryFullName: null,
    defaultBranch: null,
    permissions: null,
    ready: false,
  };

  if (!readResult.exists) {
    if (required) {
      addBlocker(blockers, "P1_OPERATOR_STATUS_GITHUB_ACCESS_NOT_READY", "Publishable GitHub issue payloads require a verified connector access receipt.", {
        path: rel(artifactPaths.githubConnectorAccess),
        repo: expectedRepo || null,
      });
    }

    return summary;
  }

  const document = readResult.json;
  const repository = parseConnectorAccessRepository(document);
  const repoFullName = normalizeGitHubRepository(
    repository?.repository_full_name ?? repository?.full_name ?? repository?.fullName,
  );
  const permissions = repository?.permissions ?? {};
  const validationErrors = [];

  if (document?.schemaVersion !== undefined && document.schemaVersion !== 1) {
    validationErrors.push("schemaVersion must be 1");
  }

  if (document?.connector !== undefined && document.connector !== "mcp__codex_apps__github._get_repo") {
    validationErrors.push("connector must be mcp__codex_apps__github._get_repo");
  }

  if (document?.checkedAt !== undefined && !validIsoTimestamp(document.checkedAt)) {
    validationErrors.push("checkedAt must be an ISO timestamp");
  }

  if (!repoFullName || repoFullName !== expectedRepo) {
    validationErrors.push(`repository must match ${expectedRepo || "the GitHub issue payload repo"}`);
  }

  if (repository?.clone_url && repository.clone_url !== `https://github.com/${expectedRepo}.git`) {
    validationErrors.push("clone_url must match the GitHub issue payload repo");
  }

  if (!text(repository?.default_branch)) {
    validationErrors.push("default_branch is required");
  }

  if (repository?.archived === true) {
    validationErrors.push("repository must not be archived");
  }

  if (permissions.pull !== true) {
    validationErrors.push("pull permission is required");
  }

  if (!(permissions.push === true || permissions.triage === true || permissions.maintain === true || permissions.admin === true)) {
    validationErrors.push("push, triage, maintain, or admin permission is required");
  }

  if (validationErrors.length > 0 && required) {
    addBlocker(blockers, "P1_OPERATOR_STATUS_GITHUB_ACCESS_NOT_READY", "GitHub connector access receipt is present but not valid for issue publication.", {
      path: rel(artifactPaths.githubConnectorAccess),
      repo: expectedRepo || null,
      validationErrors,
    });
  }

  const ready = validationErrors.length === 0;

  return {
    ...summary,
    status: ready ? "ready" : "blocked",
    releaseDecision: ready ? "ready" : "blocked",
    blockerCount: validationErrors.length,
    nextAction: ready ? "" : summary.nextAction,
    connector: text(document?.connector) || null,
    checkedAt: document?.checkedAt ?? null,
    repositoryFullName: repoFullName,
    defaultBranch: text(repository?.default_branch) || null,
    permissions: {
      admin: permissions.admin === true,
      maintain: permissions.maintain === true,
      pull: permissions.pull === true,
      push: permissions.push === true,
      triage: permissions.triage === true,
    },
    ready,
  };
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

const externalRequirementProfiles = {
  deployment: {
    ownerLane: "DevOps/총괄 PM",
    evidenceType: "운영 배포/secret store",
    requiredEvidence: ["운영 HTTPS origin", "배포 플랫폼 secret store", "production preflight/release report"],
  },
  android: {
    ownerLane: "Android/Release",
    evidenceType: "Android APK/AAB release",
    requiredEvidence: ["운영 HTTPS 웹앱 origin", "release SHA-256 fingerprint", "APK/AAB artifact", "Android 실기기 smoke"],
  },
  iosIpa: {
    ownerLane: "iOS/Release",
    evidenceType: "iOS IPA/provisioning",
    requiredEvidence: ["운영 HTTPS 웹앱 origin", "Apple Team ID", "등록된 iPhone UDID", "matching provisioning profile", "IPA archive/export report"],
  },
  paymentProvider: {
    ownerLane: "Backend/Data",
    evidenceType: "실 PG/VAN provider",
    requiredEvidence: ["PG/VAN 계약", "checkout/webhook mapping", "billing key custody", "영수증 URL"],
  },
  notificationPush: {
    ownerLane: "Frontend/QA",
    evidenceType: "운영 VAPID/실기기 push",
    requiredEvidence: ["VAPID secret store", "Android 기기 구독/수신/클릭", "공지 발송 감사 로그"],
  },
  issueRegistration: {
    ownerLane: "Product Lead/QA",
    evidenceType: "외부 issue/acknowledgement",
    requiredEvidence: ["GitHub/Slack issue URL", "담당자 acknowledgement", "issue body SHA-256"],
  },
  pilot: {
    ownerLane: "Product Lead/현장 운영",
    evidenceType: "파일럿 현장 증빙",
    requiredEvidence: ["실제 지점/계정", "14일 운영 로그", "스크린리더/모바일 출석 증빙", "archive/storage receipt"],
  },
};

const evidenceFormatGuardrails = [
  {
    label: "증빙 참조 형식",
    rule: "evidence/signoff/upload 위치는 HTTPS URL 또는 provider URI로 기록합니다.",
    verifier: "deployment/payment/android/iOS/notification handoff, p1:evidence-intake, storage receipt",
  },
  {
    label: "시간 형식",
    rule: "generatedAt, checkedAt, signedOffAt, uploadedAt은 ISO timestamp로 기록합니다.",
    verifier: "external handoff, dispatch, issue receipt, evidence intake",
  },
  {
    label: "승인 시간순서",
    rule: "signedOffAt과 acknowledgement 시각은 생성/게시 시각 이후여야 합니다.",
    verifier: "deployment/payment/android/iOS/notification handoff, issue receipt",
  },
  {
    label: "placeholder 제거",
    rule: "TODO, *_EVIDENCE_URI, localhost/.example/.test/.local origin, sample/example mailto subject 값은 completed JSON/CSV에 남기지 않습니다.",
    verifier: "dispatch CSV, issue results CSV/JSON, evidence intake CSV",
  },
  {
    label: "원문 secret 금지",
    rule: "DB URL 비밀번호, webhook secret, VAPID private key, billing key 원문은 파일에 쓰지 않습니다.",
    verifier: "handoff draft, release package/archive/storage receipt, operator status",
  },
];

function deferredExternalPrepRows(requirements, iosProvisioningProfileInventory) {
  const blockedRequirementKeys = new Set(requirements.filter((requirement) => requirement.status !== "ready").map((requirement) => requirement.key));
  const rows = [];

  if (["deployment", "android", "iosIpa"].some((key) => blockedRequirementKeys.has(key))) {
    rows.push({
      key: "webappOrigin",
      label: "운영 웹앱 origin 확정",
      status: "사용자 보류",
      ownerLane: "DevOps/총괄 PM · Android/iOS Release",
      blockedScope: "Android TWA origin, iOS IPA origin, 운영 배포 URL handoff",
      affectedRequirements: ["deployment", "android", "iosIpa"].filter((key) => blockedRequirementKeys.has(key)),
      reason:
        "`https://api.finaljudo.co.kr`처럼 API-only origin으로 보이는 host는 앱 화면 origin으로 ready 처리하지 않습니다. `/login`과 `/app/dashboard`가 직접 열리는 HTTPS 웹앱 origin이 필요합니다.",
      resumeCondition:
        "사용자 보류가 해제되면 Android/iOS doctor를 운영 HTTPS 웹앱 origin으로 다시 실행하고, strict handoff 증빙을 채웁니다.",
      readinessTreatment: "readiness에서는 blocked 유지",
    });
  }

  if (blockedRequirementKeys.has("iosIpa")) {
    const registeredProfileCount = Number(iosProvisioningProfileInventory?.matchingProfilesWithRegisteredDevices ?? 0);

    rows.push({
      key: "iosProvisioningProfile",
      label: "iOS 실제 iPhone/provisioning profile",
      status: "사용자 보류",
      ownerLane: "iOS/Release",
      blockedScope: "iOS IPA archive/export, TestFlight/App Store 배포 handoff",
      affectedRequirements: ["iosIpa"],
      reason:
        `Simulator 성공은 앱 실행 증빙일 뿐 IPA ready가 아닙니다. 현재 등록 기기 포함 profile inventory ${registeredProfileCount} 상태에서는 실제 iPhone/provisioning profile 확인 전 ready 처리하지 않습니다.`,
      resumeCondition:
        "사용자 보류가 해제되면 Apple Developer에서 실제 iPhone UDID를 등록하고 Team ID 5GWZ792DWH/bundle id kr.co.finaljudo.multigym matching provisioning profile을 Xcode Download Manual Profiles로 내려받은 뒤 doctor/build를 재실행합니다.",
      readinessTreatment: "readiness에서는 blocked 유지",
    });
  }

  return rows;
}

function externalBlockerRows(requirements) {
  return requirements
    .filter((requirement) => requirement.status !== "ready")
    .map((requirement) => {
      const profile = externalRequirementProfiles[requirement.key] ?? {
        ownerLane: "QA/Release",
        evidenceType: "외부 운영 증빙",
        requiredEvidence: ["ready report", "operator signoff"],
      };

      return {
        key: requirement.key,
        label: requirement.label || requirement.key,
        status: requirement.status || "blocked",
        blockerCount: requirement.blockerCount ?? null,
        ownerLane: profile.ownerLane,
        evidenceType: profile.evidenceType,
        requiredEvidence: profile.requiredEvidence,
        path: requirement.path,
        command: requirement.command,
        nextAction: requirement.nextAction,
      };
    });
}

function csvCell(value) {
  const normalized = text(value).replace(/\r?\n/g, " ");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function createExternalBlockersCsv(report) {
  const fields = [
    "key",
    "label",
    "status",
    "blockerCount",
    "ownerLane",
    "evidenceType",
    "requiredEvidence",
    "path",
    "command",
    "nextAction",
    "formatGuardrails",
    "evidenceOwner",
    "evidenceUrl",
    "checkedAt",
    "signoff",
    "notes",
  ];
  const guardrails = report.evidenceFormatGuardrails.map((guardrail) => `${guardrail.label}: ${guardrail.rule}`).join(" | ");
  const rows = report.externalBlockers.map((blocker) => ({
    key: blocker.key,
    label: blocker.label,
    status: blocker.status,
    blockerCount: blocker.blockerCount ?? "",
    ownerLane: blocker.ownerLane,
    evidenceType: blocker.evidenceType,
    requiredEvidence: blocker.requiredEvidence.join(" | "),
    path: blocker.path,
    command: blocker.command,
    nextAction: blocker.nextAction,
    formatGuardrails: guardrails,
    evidenceOwner: "",
    evidenceUrl: "",
    checkedAt: "",
    signoff: "",
    notes: "",
  }));

  return `${[fields.join(","), ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(","))].join("\n")}\n`;
}

function createMarkdown(report) {
  const githubPermissions = Object.entries(report.githubConnectorAccess.permissions ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key)
    .join(", ");
  const releaseCustodyActions = releaseCustodyNextActions(report.releaseCustody.prerequisitesReady, report.releaseCustody);

  const lines = [
    "# P1 Operator Status",
    "",
    `- Release decision: \`${report.releaseDecision}\``,
    `- Workspace: \`${report.workspace}\``,
    `- Ready requirements: ${report.summary.readyRequirements}/${report.summary.totalRequirements}`,
    `- External blockers: ${report.summary.externalBlockers}`,
    `- External actions: ${report.summary.totalActions}`,
    `- GitHub issue publish ready: ${report.githubIssuePublish.ready ? "yes" : "no"}`,
    `- GitHub connector access ready: ${report.githubConnectorAccess.ready ? "yes" : "no"}`,
    `- Owner decision register: \`${report.ownerDecisionRegister.state}\``,
    `- Release custody prerequisites ready: ${report.releaseCustody.prerequisitesReady ? "yes" : "no"}`,
    `- Release custody ready: ${report.releaseCustody.ready ? "yes" : "no"}`,
    "",
    "## Requirements",
    "",
    "| Requirement | Status | Blockers | Next action |",
    "| --- | --- | ---: | --- |",
  ];

  for (const requirement of report.requirements) {
    lines.push(
      `| ${requirement.label || requirement.key} | ${requirement.status} | ${requirement.blockerCount ?? ""} | ${requirement.nextAction || ""} |`,
    );
  }

  lines.push("", "## External Blockers", "");

  if (report.externalBlockers.length === 0) {
    lines.push("- No external evidence blockers.");
  } else {
    lines.push("| Requirement | Owner lane | Evidence | Next action |", "| --- | --- | --- | --- |");

    for (const blocker of report.externalBlockers) {
      lines.push(
        `| ${blocker.label} | ${blocker.ownerLane} | ${blocker.requiredEvidence.join(", ")} | ${blocker.nextAction || ""} |`,
      );
    }

    if (report.externalBlockersCsv) {
      lines.push("", `- CSV handoff template: \`${report.externalBlockersCsv}\``);
    }
  }

  lines.push("", "## Evidence Format Guardrails", "", "| Guardrail | Rule | Verifier |", "| --- | --- | --- |");

  for (const guardrail of report.evidenceFormatGuardrails) {
    lines.push(`| ${guardrail.label} | ${guardrail.rule} | ${guardrail.verifier} |`);
  }

  lines.push("", "## Deferred External Prep", "");

  if (report.deferredExternalPrep.length === 0) {
    lines.push("- No deferred external prep.");
  } else {
    lines.push(
      "보류 중인 외부 준비는 내부 스냅샷/문서/테스트 갱신과 별개이며 readiness에서는 blocked 상태를 유지합니다.",
      "",
      "| Prep | Status | Blocked scope | Resume condition |",
      "| --- | --- | --- | --- |",
    );

    for (const item of report.deferredExternalPrep) {
      lines.push(`| ${item.label} | ${item.status} | ${item.blockedScope} | ${item.resumeCondition} |`);
      lines.push(`| ${item.label} reason | ${item.readinessTreatment} | ${item.reason} | affected: ${item.affectedRequirements.join(", ")} |`);
    }
  }

  lines.push("", "## Support Artifacts", "", "| Artifact | Status | Decision | Path |", "| --- | --- | --- | --- |");

  for (const artifact of report.supportArtifacts) {
    lines.push(`| ${artifact.label} | ${artifact.status} | ${artifact.releaseDecision} | \`${artifact.path}\` |`);
  }

  if (report.iosProvisioningProfileInventory) {
    const inventory = report.iosProvisioningProfileInventory;
    lines.push(
      "",
      "## iOS Local Profile Inventory",
      "",
      `- Directory: ${inventory.directory ? `\`${inventory.directory}\`` : "not found"}`,
      `- Profile files: ${inventory.totalProfileFiles}`,
      `- Readable profiles: ${inventory.readableProfileFiles}`,
      `- Matching Team ID profiles: ${inventory.matchingTeamProfiles}`,
      `- Matching bundle id profiles: ${inventory.matchingBundleProfiles}`,
      `- Matching profiles with registered devices: ${inventory.matchingProfilesWithRegisteredDevices}`,
      "- Raw iPhone UDIDs are not written to this status board.",
    );
  }

  lines.push(
    "",
    "## GitHub Connector",
    "",
    `- Repository: ${report.githubIssuePublish.repo ? `\`${report.githubIssuePublish.repo}\`` : "missing"}`,
    `- Access receipt: ${report.githubConnectorAccess.ready ? "ready" : report.githubConnectorAccess.status}`,
    `- Access checked at: ${report.githubConnectorAccess.checkedAt ?? "not recorded"}`,
    `- Default branch: ${report.githubConnectorAccess.defaultBranch ? `\`${report.githubConnectorAccess.defaultBranch}\`` : "unknown"}`,
    `- Permissions: ${githubPermissions || "none"}`,
    `- Issue payloads: ${report.githubIssuePublish.payloadCount}`,
    `- Issue publish ready: ${report.githubIssuePublish.ready ? "yes" : "no"}`,
  );

  lines.push(
    "",
    "## Owner Decision Register",
    "",
    `- State: \`${report.ownerDecisionRegister.state}\``,
    `- Source: ${report.ownerDecisionRegister.sourcePath ? `\`${report.ownerDecisionRegister.sourcePath}\`` : "missing"}`,
    `- Completed: ${report.ownerDecisionRegister.completedPath ? `\`${report.ownerDecisionRegister.completedPath}\`` : "missing"}`,
    `- Decision rows: ${report.ownerDecisionRegister.decisionRows ?? "unknown"}`,
    `- Completed rows: ${report.ownerDecisionRegister.completedDecisionRows}`,
    `- Next action: ${report.ownerDecisionRegister.nextAction}`,
  );

  lines.push(
    "",
    "## Release Custody",
    "",
    `- Prerequisites ready: ${report.releaseCustody.prerequisitesReady ? "yes" : "no"}`,
    `- Package ready: ${report.releaseCustody.packageReady ? "yes" : "no"}`,
    `- Archive ready: ${report.releaseCustody.archiveReady ? "yes" : "no"}`,
    `- Storage receipt ready: ${report.releaseCustody.storageReceiptReady ? "yes" : "no"}`,
    `- Next action: ${releaseCustodyActions[0] ?? "남은 release custody 작업이 없습니다."}`,
  );

  lines.push("", "## Next Actions", "");

  if (report.nextActions.length === 0) {
    lines.push("- No remaining operator actions.");
  } else {
    for (const action of report.nextActions) {
      lines.push(`- ${action}`);
    }
  }

  lines.push("");

  return `${lines.join("\n")}\n`;
}

const blockers = [];
const artifacts = {
  actionChecklist: await readJsonArtifact("actionChecklist", artifactPaths.actionChecklist, blockers),
  androidDoctor: await readJsonArtifact("androidDoctor", artifactPaths.androidDoctor, blockers, { required: false }),
  androidDoctorMarkdown: await readTextArtifact("androidDoctorMarkdown", artifactPaths.androidDoctorMarkdown, blockers),
  androidRoleApks: await readJsonArtifact("androidRoleApks", artifactPaths.androidRoleApks, blockers, { required: false }),
  bundleManifest: await readJsonArtifact("bundleManifest", artifactPaths.bundleManifest, blockers),
  dispatchReport: await readJsonArtifact("dispatchReport", artifactPaths.dispatchReport, blockers),
  evidenceIntakeReport: await readJsonArtifact("evidenceIntakeReport", artifactPaths.evidenceIntakeReport, blockers),
  githubConnectorAccess: await readJsonArtifact("githubConnectorAccess", artifactPaths.githubConnectorAccess, blockers, {
    required: false,
  }),
  githubConnectorPayloads: await readJsonArtifact("githubConnectorPayloads", artifactPaths.githubConnectorPayloads, blockers),
  issueRegistrationReport: await readJsonArtifact("issueRegistrationReport", artifactPaths.issueRegistrationReport, blockers),
  iosCapacitorConnection: await readJsonArtifact("iosCapacitorConnection", artifactPaths.iosCapacitorConnection, blockers, {
    required: false,
  }),
  iosIpaDoctor: await readJsonArtifact("iosIpaDoctor", artifactPaths.iosIpaDoctor, blockers, { required: false }),
  iosIpaDoctorMarkdown: await readTextArtifact("iosIpaDoctorMarkdown", artifactPaths.iosIpaDoctorMarkdown, blockers, {
    required: false,
  }),
  ownerDecisionRegister: await readJsonArtifact("ownerDecisionRegister", artifactPaths.ownerDecisionRegister, blockers, {
    required: false,
    blockWhenPresent: true,
  }),
  ownerDecisionRegisterCompleted: await readJsonArtifact(
    "ownerDecisionRegisterCompleted",
    artifactPaths.ownerDecisionRegisterCompleted,
    blockers,
    { required: false, blockWhenPresent: true },
  ),
  p1Readiness: await readJsonArtifact("p1Readiness", artifactPaths.p1Readiness, blockers),
  releaseArchiveManifest: await readJsonArtifact("releaseArchiveManifest", artifactPaths.releaseArchiveManifest, blockers, {
    required: false,
    blockWhenPresent: true,
  }),
  releasePackage: await readJsonArtifact("releasePackage", artifactPaths.releasePackage, blockers, {
    required: false,
    blockWhenPresent: true,
  }),
  releaseStorageReceipt: await readJsonArtifact("releaseStorageReceipt", artifactPaths.releaseStorageReceipt, blockers, {
    required: false,
    blockWhenPresent: true,
  }),
};

const readiness = artifacts.p1Readiness.json;
const requirements = requirementRows(readiness);
const readyRequirements = requirements.filter((requirement) => requirement.status === "ready").length;
const totalRequirements = requirements.length || 7;
const actionCount = Number(artifacts.actionChecklist.json?.summary?.totalActions ?? artifacts.bundleManifest.json?.summary?.actionCount ?? 0);
const githubPayload = artifacts.githubConnectorPayloads.json;
const githubRepo = text(githubPayload?.githubRepo);
const githubIssuePublish = {
  connector: text(githubPayload?.connector),
  payloadCount: Array.isArray(githubPayload?.issuePayloads) ? githubPayload.issuePayloads.length : 0,
  ready: githubPayload?.publishReady === true && !hasPlaceholder(githubRepo),
  repo: githubRepo || null,
};
const githubConnectorAccess = summarizeGitHubConnectorAccess(artifacts.githubConnectorAccess, githubRepo, blockers, {
  required: githubIssuePublish.ready,
});
const ownerDecisionRegister = summarizeOwnerDecisionRegister(
  artifacts.ownerDecisionRegister,
  artifacts.ownerDecisionRegisterCompleted,
);
const releaseCustody = {
  packageReady: isReady(artifacts.releasePackage.json),
  archiveReady: isReady(artifacts.releaseArchiveManifest.json),
  storageReceiptReady: storageReceiptReady(artifacts.releaseStorageReceipt.json),
};

releaseCustody.ready = releaseCustody.packageReady && releaseCustody.archiveReady && releaseCustody.storageReceiptReady;
releaseCustody.prerequisitesReady = isReady(readiness) && isReady(artifacts.evidenceIntakeReport.json);
releaseCustody.prerequisiteAction = releaseCustodyPrerequisiteAction();
const androidDoctorSummary = summarizeAndroidDoctor(artifacts.androidDoctor);
const androidDoctorMarkdownSummary = summarizeAndroidDoctorMarkdown(artifacts.androidDoctorMarkdown);
const androidRoleApksSummary = summarizeAndroidRoleApks(artifacts.androidRoleApks);
const iosCapacitorConnectionSummary = summarizeIosCapacitorConnection(artifacts.iosCapacitorConnection);
const iosIpaDoctorSummary = summarizeIosIpaDoctor(artifacts.iosIpaDoctor);
const iosIpaDoctorMarkdownSummary = summarizeIosIpaDoctorMarkdown(artifacts.iosIpaDoctorMarkdown);

if (androidDoctorSummary.status !== "ready") {
  addBlocker(blockers, "P1_OPERATOR_STATUS_ANDROID_DOCTOR_NOT_READY", "Android TWA doctor JSON must be ready or explicitly blocked for mobile release handoff.", {
    path: rel(artifactPaths.androidDoctor),
    status: androidDoctorSummary.status,
    blockerCount: androidDoctorSummary.blockerCount,
    nextAction: androidDoctorSummary.nextAction,
  });
}

if (androidDoctorMarkdownSummary.status !== "ready") {
  addBlocker(blockers, "P1_OPERATOR_STATUS_ANDROID_DOCTOR_MARKDOWN_NOT_READY", "Android TWA doctor Markdown must be available for mobile release handoff.", {
    path: rel(artifactPaths.androidDoctorMarkdown),
    status: androidDoctorMarkdownSummary.status,
  });
}

if (iosIpaDoctorSummary.status !== "ready") {
  addBlocker(blockers, "P1_OPERATOR_STATUS_IOS_IPA_DOCTOR_NOT_READY", "iOS IPA doctor JSON must expose current origin/provisioning readiness for mobile release handoff.", {
    path: rel(artifactPaths.iosIpaDoctor),
    status: iosIpaDoctorSummary.status,
    blockerCount: iosIpaDoctorSummary.blockerCount,
    blockerChecks: iosIpaDoctorSummary.blockerChecks,
    nextAction: iosIpaDoctorSummary.nextAction,
  });
}

if (iosIpaDoctorMarkdownSummary.status !== "ready") {
  addBlocker(blockers, "P1_OPERATOR_STATUS_IOS_IPA_DOCTOR_MARKDOWN_NOT_READY", "iOS IPA doctor Markdown must be available for operator handoff.", {
    path: rel(artifactPaths.iosIpaDoctorMarkdown),
    status: iosIpaDoctorMarkdownSummary.status,
  });
}

if (!isReady(readiness)) {
  addBlocker(blockers, "P1_OPERATOR_STATUS_READINESS_BLOCKED", "P1 readiness is not ready yet.", {
    releaseDecision: releaseDecision(readiness),
    readyRequirements,
    totalRequirements,
  });
}

if (requirements.length > 0 && readyRequirements !== requirements.length) {
  for (const requirement of requirements.filter((item) => item.status !== "ready")) {
    addBlocker(blockers, "P1_OPERATOR_STATUS_REQUIREMENT_BLOCKED", "A P1 readiness requirement still needs external evidence.", {
      key: requirement.key,
      label: requirement.label,
      status: requirement.status,
      nextAction: requirement.nextAction,
    });
  }
}

if (releaseDecision(artifacts.bundleManifest.json) !== "ready") {
  addBlocker(blockers, "P1_OPERATOR_STATUS_BUNDLE_NOT_READY", "P1 owner handoff bundle must be ready before external dispatch.", {
    path: rel(artifactPaths.bundleManifest),
  });
}

if (actionCount === 0 && !isReady(readiness)) {
  addBlocker(blockers, "P1_OPERATOR_STATUS_ACTIONS_MISSING", "Blocked P1 readiness must have operator action checklist rows.", {
    path: rel(artifactPaths.actionChecklist),
  });
}

if (!githubIssuePublish.ready) {
  addBlocker(blockers, "P1_OPERATOR_STATUS_GITHUB_ISSUES_NOT_PUBLISHABLE", "GitHub issue connector payloads are not publishable yet.", {
    path: rel(artifactPaths.githubConnectorPayloads),
    repo: githubRepo || null,
    publishReady: githubPayload?.publishReady ?? null,
    payloadCount: githubIssuePublish.payloadCount,
  });
}

if (releaseCustody.prerequisitesReady && !releaseCustody.packageReady) {
  addBlocker(blockers, "P1_OPERATOR_STATUS_RELEASE_PACKAGE_NOT_READY", "P1 release package must be ready before final custody.", {
    path: rel(artifactPaths.releasePackage),
    exists: artifacts.releasePackage.exists,
    releaseDecision: releaseDecision(artifacts.releasePackage.json),
  });
}

if (releaseCustody.prerequisitesReady && !releaseCustody.archiveReady) {
  addBlocker(blockers, "P1_OPERATOR_STATUS_RELEASE_ARCHIVE_NOT_READY", "P1 release archive manifest must be ready before final custody.", {
    path: rel(artifactPaths.releaseArchiveManifest),
    exists: artifacts.releaseArchiveManifest.exists,
    releaseDecision: releaseDecision(artifacts.releaseArchiveManifest.json),
  });
}

if (releaseCustody.prerequisitesReady && !releaseCustody.storageReceiptReady) {
  addBlocker(blockers, "P1_OPERATOR_STATUS_RELEASE_STORAGE_RECEIPT_NOT_READY", "P1 release storage receipt must be completed and strict-validated before final custody.", {
    path: rel(artifactPaths.releaseStorageReceipt),
    exists: artifacts.releaseStorageReceipt.exists,
  });
}

const supportArtifacts = [
  summarizeDocument("actionChecklist", "P1 handoff action checklist", artifacts.actionChecklist),
  androidDoctorSummary,
  androidDoctorMarkdownSummary,
  androidRoleApksSummary,
  iosCapacitorConnectionSummary,
  iosIpaDoctorSummary,
  iosIpaDoctorMarkdownSummary,
  summarizeDocument("bundleManifest", "P1 handoff bundle manifest", artifacts.bundleManifest),
  summarizeDocument("dispatchReport", "P1 handoff dispatch report", artifacts.dispatchReport),
  githubConnectorAccess,
  summarizeDocument("githubConnectorPayloads", "GitHub connector issue payloads", artifacts.githubConnectorPayloads),
  summarizeDocument("issueRegistrationReport", "P1 issue registration report", artifacts.issueRegistrationReport),
  summarizeDocument("evidenceIntakeReport", "P1 evidence intake report", artifacts.evidenceIntakeReport),
  summarizeDocument("p1Readiness", "P1 readiness report", artifacts.p1Readiness),
  summarizeDocument("releasePackage", "P1 release package", artifacts.releasePackage),
  summarizeDocument("releaseArchiveManifest", "P1 release archive manifest", artifacts.releaseArchiveManifest),
  summarizeStorageReceipt(artifacts.releaseStorageReceipt),
].map((artifact) => withReleaseCustodyPrerequisite(artifact, releaseCustody.prerequisitesReady));

const externalBlockers = externalBlockerRows(requirements);
const iosProvisioningProfileInventory = iosIpaDoctorSummary.profileInventory ?? null;
const deferredExternalPrep = deferredExternalPrepRows(requirements, iosProvisioningProfileInventory);

const nextActions = unique([
  ...requirements.map((requirement) => requirement.nextAction),
  ...supportArtifacts.map((artifact) => artifact.nextAction),
  ...nestedNextActions(readiness),
  "npm run p1:handoff-draft -- --out-dir=.data",
  githubConnectorAccess.nextAction,
  ...releaseCustodyNextActions(releaseCustody.prerequisitesReady, releaseCustody),
]);

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  workspace: rel(workspace),
  checked: [
    "P1 readiness report status",
    "Android TWA doctor JSON status",
    "Android TWA doctor Markdown availability",
    "Android role APK build report integrity",
    "iOS IPA doctor JSON status",
    "iOS IPA doctor Markdown availability",
    "iOS local provisioning profile inventory summary",
    "owner action checklist availability",
    "owner handoff bundle readiness",
    "dispatch receipt report status",
    "GitHub connector repository access receipt",
    "GitHub connector Markdown status section",
    "GitHub connector issue payload publish guard",
    "owner decision register status and completed CSV follow-up",
    "issue registration and evidence intake status",
    "P1 release package, archive manifest, and storage receipt status",
    "release custody next actions wait for readiness and evidence intake",
    "release custody Markdown status section",
    "evidence format guardrails JSON and Markdown section",
    "external blockers CSV handoff template",
    "secret-like value guard for operator artifacts",
  ],
  summary: {
    readyRequirements,
    blockedRequirements: totalRequirements - readyRequirements,
    totalRequirements,
    externalBlockers: externalBlockers.length,
    totalActions: actionCount,
    ownerPackages: Number(artifacts.bundleManifest.json?.summary?.ownerPackages ?? artifacts.dispatchReport.json?.summary?.ownerPackages ?? 0),
    acknowledgedOwnerPackages: Number(artifacts.dispatchReport.json?.summary?.acknowledged ?? 0),
    githubConnectorAccessReady: githubConnectorAccess.ready,
    ownerDecisionRegisterState: ownerDecisionRegister.state,
    releaseCustodyPrerequisitesReady: releaseCustody.prerequisitesReady,
    releaseCustodyReady: releaseCustody.ready,
    deferredExternalPrep: deferredExternalPrep.length,
  },
  githubIssuePublish,
  githubConnectorAccess,
  ownerDecisionRegister,
  releaseCustody,
  requirements,
  externalBlockers,
  externalBlockersCsv: externalBlockersCsvPath ? rel(externalBlockersCsvPath) : null,
  deferredExternalPrep,
  evidenceFormatGuardrails,
  supportArtifacts,
  iosProvisioningProfileInventory,
  nextActions,
  blockers,
};

if (outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (markdownPath) {
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, createMarkdown(report));
}

if (externalBlockersCsvPath) {
  await mkdir(path.dirname(externalBlockersCsvPath), { recursive: true });
  await writeFile(externalBlockersCsvPath, createExternalBlockersCsv(report));
}

console.log(JSON.stringify(report, null, 2));

if (!args.allowPending && blockers.length > 0) {
  process.exit(1);
}
