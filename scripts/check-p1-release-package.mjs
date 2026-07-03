import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outPath = args.out ? path.resolve(args.out) : null;
const workspacePath = args.workspace ? path.resolve(args.workspace) : null;

function defaultArtifactPath(fileName) {
  return path.resolve(workspacePath ? path.join(workspacePath, fileName) : path.join(".data", fileName));
}

const artifactInputs = [
  {
    key: "p1Readiness",
    label: "P1 readiness report",
    path: args.readiness ? path.resolve(args.readiness) : defaultArtifactPath("p1-readiness.json"),
    requirementKey: null,
  },
  {
    key: "p1EvidenceIntake",
    label: "P1 evidence intake report",
    path: args.evidenceIntakeReport ? path.resolve(args.evidenceIntakeReport) : defaultArtifactPath("p1-evidence-intake-report.json"),
    requirementKey: null,
  },
  {
    key: "deploymentHandoff",
    label: "production deployment handoff report",
    path: args.deploymentReport ? path.resolve(args.deploymentReport) : defaultArtifactPath("deployment-handoff.report.json"),
    requirementKey: "deployment",
  },
  {
    key: "androidReleaseHandoff",
    label: "Android APK/AAB release handoff report",
    path: args.androidReport ? path.resolve(args.androidReport) : defaultArtifactPath("android-release-handoff.report.json"),
    requirementKey: "android",
  },
  {
    key: "iosIpaBuild",
    label: "iOS IPA build/provisioning report",
    path: args.iosIpaReport ? path.resolve(args.iosIpaReport) : defaultArtifactPath(path.join("mobile-builds", "ios", "ios-ipa-build-report.json")),
    requirementKey: "iosIpa",
  },
  {
    key: "paymentProviderHandoff",
    label: "real PG/VAN payment provider handoff report",
    path: args.paymentProviderReport ? path.resolve(args.paymentProviderReport) : defaultArtifactPath("payment-provider-handoff.report.json"),
    requirementKey: "paymentProvider",
  },
  {
    key: "notificationPushHandoff",
    label: "production notification push handoff report",
    path: args.notificationPushReport ? path.resolve(args.notificationPushReport) : defaultArtifactPath("notification-push-handoff.report.json"),
    requirementKey: "notificationPush",
  },
  {
    key: "issueRegistrationReceipt",
    label: "P1 handoff issue registration receipt report",
    path: args.issueRegistrationReport
      ? path.resolve(args.issueRegistrationReport)
      : defaultArtifactPath("p1-handoff-issue-registration-report.json"),
    requirementKey: "issueRegistration",
  },
  {
    key: "pilotFinalStatus",
    label: "strict pilot final status report",
    path: args.pilotStatus ? path.resolve(args.pilotStatus) : defaultArtifactPath("pilot-status.json"),
    requirementKey: "pilot",
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

    if (key === "--out") {
      parsed.out = value;
    } else if (key === "--workspace") {
      parsed.workspace = value;
    } else if (key === "--readiness") {
      parsed.readiness = value;
    } else if (key === "--evidence-intake-report") {
      parsed.evidenceIntakeReport = value;
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

function addIssue(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDateTime(value) {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readyDocument(document) {
  const decision = text(document?.releaseDecision);
  return document?.ok === true && (!decision || decision === "ready") && (document?.blockers?.length ?? 0) === 0;
}

async function readArtifact(input, blockers) {
  try {
    const buffer = await readFile(input.path);
    const parsed = JSON.parse(buffer.toString("utf8"));

    return {
      input,
      parsed,
      sizeBytes: buffer.byteLength,
      sha256: sha256(buffer),
    };
  } catch (error) {
    addIssue(blockers, "P1_RELEASE_PACKAGE_ARTIFACT_UNREADABLE", `${input.label} must be readable JSON.`, {
      key: input.key,
      path: input.path,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      input,
      parsed: null,
      sizeBytes: 0,
      sha256: null,
    };
  }
}

function validateReadyArtifact(artifact, blockers) {
  if (!artifact.parsed) {
    return;
  }

  if (!readyDocument(artifact.parsed)) {
    addIssue(blockers, "P1_RELEASE_PACKAGE_ARTIFACT_NOT_READY", `${artifact.input.label} must be ready with no blockers.`, {
      key: artifact.input.key,
      ok: artifact.parsed.ok ?? null,
      releaseDecision: artifact.parsed.releaseDecision ?? null,
      blockers: artifact.parsed.blockers ?? null,
    });
  }

  if (!parseDateTime(artifact.parsed.generatedAt)) {
    addIssue(blockers, "P1_RELEASE_PACKAGE_ARTIFACT_GENERATED_AT_INVALID", `${artifact.input.label} must include a valid generatedAt timestamp.`, {
      key: artifact.input.key,
      generatedAt: artifact.parsed.generatedAt ?? null,
    });
  }
}

function validateReadinessReport(readinessArtifact, artifacts, blockers) {
  const readiness = readinessArtifact.parsed;

  if (!readiness) {
    return;
  }

  if (!readyDocument(readiness)) {
    addIssue(blockers, "P1_RELEASE_PACKAGE_READINESS_NOT_READY", "P1 readiness report must be strict-ready before packaging.", {
      ok: readiness.ok ?? null,
      releaseDecision: readiness.releaseDecision ?? null,
      blockers: readiness.blockers ?? null,
    });
  }

  const expectedRequirementCount = artifactInputs.filter((input) => input.requirementKey).length;
  if (Number(readiness.summary?.ready) !== expectedRequirementCount || Number(readiness.summary?.total) !== expectedRequirementCount) {
    addIssue(blockers, "P1_RELEASE_PACKAGE_READINESS_SUMMARY_INCOMPLETE", "P1 readiness summary must cover all seven required reports.", {
      summary: readiness.summary ?? null,
    });
  }

  const readinessGeneratedAt = parseDateTime(readiness.generatedAt);

  for (const artifact of artifacts.filter((item) => item.input.requirementKey)) {
    const requirement = readiness.requirements?.[artifact.input.requirementKey];

    if (!requirement) {
      addIssue(blockers, "P1_RELEASE_PACKAGE_READINESS_REQUIREMENT_MISSING", "P1 readiness report is missing a required requirement entry.", {
        requirementKey: artifact.input.requirementKey,
      });
      continue;
    }

    if (requirement.status !== "ready") {
      addIssue(blockers, "P1_RELEASE_PACKAGE_READINESS_REQUIREMENT_NOT_READY", "P1 readiness requirement must be ready.", {
        requirementKey: artifact.input.requirementKey,
        status: requirement.status ?? null,
      });
    }

    if (path.resolve(text(requirement.path)) !== artifact.input.path) {
      addIssue(blockers, "P1_RELEASE_PACKAGE_READINESS_PATH_MISMATCH", "P1 readiness report must reference the same handoff report being packaged.", {
        requirementKey: artifact.input.requirementKey,
        readinessPath: requirement.path ?? null,
        packagePath: artifact.input.path,
      });
    }

    const reportGeneratedAt = parseDateTime(artifact.parsed?.generatedAt);
    if (readinessGeneratedAt && reportGeneratedAt && readinessGeneratedAt < reportGeneratedAt) {
      addIssue(blockers, "P1_RELEASE_PACKAGE_STALE_READINESS_REPORT", "P1 readiness report must be generated after the handoff reports it packages.", {
        requirementKey: artifact.input.requirementKey,
        readinessGeneratedAt: readiness.generatedAt,
        reportGeneratedAt: artifact.parsed.generatedAt,
      });
    }
  }
}

function validateEvidenceIntakeReport(evidenceIntakeArtifact, readinessArtifact, blockers) {
  const evidenceIntake = evidenceIntakeArtifact?.parsed;
  const readiness = readinessArtifact?.parsed;

  if (!evidenceIntake || !readiness) {
    return;
  }

  const intakeReadinessPath = text(evidenceIntake.artifacts?.readiness?.path);
  if (!intakeReadinessPath || path.resolve(intakeReadinessPath) !== readinessArtifact.input.path) {
    addIssue(blockers, "P1_RELEASE_PACKAGE_EVIDENCE_INTAKE_READINESS_PATH_MISMATCH", "P1 evidence intake report must validate the same P1 readiness report being packaged.", {
      intakeReadinessPath: intakeReadinessPath || null,
      packageReadinessPath: readinessArtifact.input.path,
    });
  }

  const readinessGeneratedAt = parseDateTime(readiness.generatedAt);
  const evidenceIntakeGeneratedAt = parseDateTime(evidenceIntake.generatedAt);

  if (readinessGeneratedAt && evidenceIntakeGeneratedAt && evidenceIntakeGeneratedAt < readinessGeneratedAt) {
    addIssue(blockers, "P1_RELEASE_PACKAGE_STALE_EVIDENCE_INTAKE_REPORT", "P1 evidence intake report must be generated after the P1 readiness report it validates.", {
      readinessGeneratedAt: readiness.generatedAt,
      evidenceIntakeGeneratedAt: evidenceIntake.generatedAt,
    });
  }
}

function nextActions(blockers) {
  if (blockers.length === 0) {
    return [];
  }

  return [
    "운영 배포, Android release, iOS IPA/provisioning, 결제 provider, 운영 푸시, P1 handoff issue registration receipt, 파일럿 최종 status 리포트를 모두 ready로 만든 뒤 `npm run p1:readiness -- --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md`를 다시 실행합니다.",
    "ready P1 readiness 리포트가 생성되면 `npm run p1:evidence-intake:draft -- --workspace=.data --readiness=.data/p1-readiness.json`로 intake를 재생성하고 운영자 signoff 입력 후 `npm run p1:evidence-intake -- --file=.data/p1-evidence-intake-draft.json --readiness=.data/p1-readiness.json --out=.data/p1-evidence-intake-report.json`를 통과시킵니다.",
    "ready P1 evidence intake 리포트까지 생성되면 `npm run p1:release-package -- --out=.data/p1-release-package.json`로 최종 패키지 manifest를 보관합니다.",
  ];
}

const blockers = [];
const artifactReads = await Promise.all(artifactInputs.map((input) => readArtifact(input, blockers)));

for (const artifact of artifactReads) {
  validateReadyArtifact(artifact, blockers);
}

validateReadinessReport(
  artifactReads.find((artifact) => artifact.input.key === "p1Readiness"),
  artifactReads,
  blockers,
);
validateEvidenceIntakeReport(
  artifactReads.find((artifact) => artifact.input.key === "p1EvidenceIntake"),
  artifactReads.find((artifact) => artifact.input.key === "p1Readiness"),
  blockers,
);

const artifacts = Object.fromEntries(
  artifactReads.map((artifact) => [
    artifact.input.key,
    {
      label: artifact.input.label,
      path: artifact.input.path,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      generatedAt: artifact.parsed?.generatedAt ?? null,
      releaseDecision: artifact.parsed?.releaseDecision ?? null,
    },
  ]),
);

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  workspace: workspacePath ? path.relative(process.cwd(), workspacePath) || "." : null,
  checked: [
    "strict P1 readiness report is ready",
    "P1 evidence intake report is packaged",
    "production deployment handoff report is packaged",
    "Android APK/AAB release handoff report is packaged",
    "iOS IPA build/provisioning report is packaged",
    "real PG/VAN payment provider handoff report is packaged",
    "production notification push handoff report is packaged",
    "P1 handoff issue registration receipt report is packaged",
    "strict pilot final status report is packaged",
    "packaged artifact SHA-256 hashes and byte sizes are recorded",
  ],
  artifacts,
  summary: {
    totalArtifacts: artifactInputs.length,
    readyArtifacts: artifactReads.filter((artifact) => readyDocument(artifact.parsed)).length,
    sizeBytes: artifactReads.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
  },
  nextActions: nextActions(blockers),
  blockers,
};

if (outPath) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
