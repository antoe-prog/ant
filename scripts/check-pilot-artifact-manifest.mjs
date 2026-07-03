import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);
const transformArgs = ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

const artifactInputs = [
  {
    key: "prePilotPreflight",
    label: "pre-pilot strict preflight JSON",
    path: path.resolve(args.find((arg) => arg.startsWith("--preflight-pre="))?.slice("--preflight-pre=".length) ?? ".data/pilot-preflight.pre-pilot.json"),
    type: "json",
  },
  {
    key: "prePilotEvidence",
    label: "pre-pilot pilot:evidence JSON",
    path: path.resolve(args.find((arg) => arg.startsWith("--evidence-pre="))?.slice("--evidence-pre=".length) ?? ".data/pilot-evidence.json"),
    type: "json",
  },
  {
    key: "prePilotMarkdown",
    label: "pre-pilot pilot:evidence Markdown",
    path: path.resolve(
      args.find((arg) => arg.startsWith("--evidence-pre-markdown="))?.slice("--evidence-pre-markdown=".length) ?? ".data/pilot-evidence.pre-pilot.md",
    ),
    type: "text",
  },
  {
    key: "prePilotReadinessEvidence",
    label: "pre-pilot readiness evidence CSV",
    path: path.resolve(args.find((arg) => arg.startsWith("--readiness-evidence="))?.slice("--readiness-evidence=".length) ?? ".data/pilot-readiness-evidence.csv"),
    type: "text",
  },
  {
    key: "launchPackage",
    label: "pre-pilot launch package",
    path: path.resolve(args.find((arg) => arg.startsWith("--launch-package="))?.slice("--launch-package=".length) ?? ".data/pilot-launch-package.json"),
    type: "json",
  },
  {
    key: "passwordRotationEvidence",
    label: "pre-pilot password rotation evidence CSV",
    path: path.resolve(args.find((arg) => arg.startsWith("--password-rotation="))?.slice("--password-rotation=".length) ?? ".data/pilot-password-rotation.csv"),
    type: "text",
  },
  {
    key: "postPilotPreflight",
    label: "post-pilot strict preflight JSON",
    path: path.resolve(args.find((arg) => arg.startsWith("--preflight-post="))?.slice("--preflight-post=".length) ?? ".data/pilot-preflight.post-pilot.json"),
    type: "json",
  },
  {
    key: "postPilotEvidence",
    label: "post-pilot pilot:evidence JSON",
    path: path.resolve(args.find((arg) => arg.startsWith("--evidence-post="))?.slice("--evidence-post=".length) ?? ".data/pilot-evidence.post-pilot.json"),
    type: "json",
  },
  {
    key: "postPilotMarkdown",
    label: "post-pilot pilot:evidence Markdown",
    path: path.resolve(args.find((arg) => arg.startsWith("--evidence-markdown="))?.slice("--evidence-markdown=".length) ?? ".data/pilot-evidence.md"),
    type: "text",
  },
  {
    key: "fieldEvidence",
    label: "pilot field evidence manifest",
    path: path.resolve(args.find((arg) => arg.startsWith("--field="))?.slice("--field=".length) ?? ".data/pilot-field-evidence.json"),
    type: "json",
  },
  {
    key: "closeoutPackage",
    label: "pilot closeout package",
    path: path.resolve(args.find((arg) => arg.startsWith("--closeout="))?.slice("--closeout=".length) ?? ".data/pilot-closeout-package.json"),
    type: "json",
  },
];
const outFile = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);

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

async function readArtifact(input, blockers) {
  try {
    const buffer = await readFile(input.path);
    let parsed = null;

    if (input.type === "json") {
      parsed = JSON.parse(buffer.toString("utf8"));
    }

    return {
      key: input.key,
      label: input.label,
      path: input.path,
      type: input.type,
      sizeBytes: buffer.byteLength,
      sha256: sha256(buffer),
      parsed,
      text: input.type === "text" ? buffer.toString("utf8") : null,
    };
  } catch (error) {
    addIssue(blockers, "PILOT_ARTIFACT_UNREADABLE", `${input.label} must be readable.`, {
      key: input.key,
      path: input.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      key: input.key,
      label: input.label,
      path: input.path,
      type: input.type,
      sizeBytes: 0,
      sha256: null,
      parsed: null,
      text: null,
    };
  }
}

function artifactMap(artifacts) {
  return new Map(artifacts.map((artifact) => [artifact.key, artifact]));
}

function validatePreflightArtifact(artifact, expectedMode, blockers) {
  const report = artifact.parsed;
  if (!report) {
    return;
  }

  if (report.ok !== true || report.mode !== "strict" || report.blockers?.length > 0) {
    addIssue(blockers, "PREFLIGHT_ARTIFACT_NOT_READY", `${artifact.label} must be strict and ready.`, {
      key: artifact.key,
      ok: report.ok ?? null,
      mode: report.mode ?? null,
      blockers: report.blockers ?? null,
    });
  }

  if (!parseDateTime(report.generatedAt)) {
    addIssue(blockers, "PREFLIGHT_ARTIFACT_GENERATED_AT_INVALID", `${artifact.label} must include a valid generatedAt timestamp.`, {
      key: artifact.key,
      generatedAt: report.generatedAt ?? null,
    });
  }

  const checked = Array.isArray(report.checked) ? report.checked : [];
  if (expectedMode === "post-pilot") {
    for (const requiredCheck of ["14-day pilot operation evidence when --require-retro is set", "mobile attendance timing evidence in pilot operation logs"]) {
      if (!checked.includes(requiredCheck)) {
        addIssue(blockers, "POST_PILOT_PREFLIGHT_SCOPE_INCOMPLETE", "post-pilot preflight artifact is missing a required checked scope.", {
          requiredCheck,
        });
      }
    }
  }
}

function validateEvidenceArtifact(artifact, expectedMode, blockers) {
  const report = artifact.parsed;
  if (!report) {
    return;
  }

  if (report.mode !== expectedMode || report.releaseDecision !== "ready" || report.preflight?.blockerCodes?.length > 0) {
    addIssue(blockers, "PILOT_EVIDENCE_ARTIFACT_NOT_READY", `${artifact.label} must be ready in ${expectedMode} mode.`, {
      key: artifact.key,
      mode: report.mode ?? null,
      releaseDecision: report.releaseDecision ?? null,
      blockerCodes: report.preflight?.blockerCodes ?? null,
    });
  }

  if (!parseDateTime(report.generatedAt)) {
    addIssue(blockers, "PILOT_EVIDENCE_ARTIFACT_GENERATED_AT_INVALID", `${artifact.label} must include a valid generatedAt timestamp.`, {
      key: artifact.key,
      generatedAt: report.generatedAt ?? null,
    });
  }

  if (expectedMode === "post-pilot" && (Number(report.counts?.operationDays) < 14 || Number(report.counts?.verifiedOperationDays) < 14)) {
    addIssue(blockers, "POST_PILOT_EVIDENCE_OPERATION_DAYS_INCOMPLETE", "post-pilot pilot:evidence JSON must include 14 operation days.", {
      operationDays: report.counts?.operationDays ?? null,
      verifiedOperationDays: report.counts?.verifiedOperationDays ?? null,
    });
  }
}

function validatePostPilotMarkdownArtifact(artifact, blockers) {
  const markdown = artifact.text ?? "";
  for (const expected of ["# Final Judo Pilot Evidence Report", "- Mode: post-pilot", "- Decision: ready", "## Operations"]) {
    if (!markdown.includes(expected)) {
      addIssue(blockers, "POST_PILOT_MARKDOWN_ARTIFACT_INCOMPLETE", "post-pilot Markdown evidence report is missing required content.", {
        expected,
      });
    }
  }
}

function validatePrePilotMarkdownArtifact(artifact, blockers) {
  const markdown = artifact.text ?? "";
  for (const expected of ["# Final Judo Pilot Evidence Report", "- Mode: pre-pilot", "- Decision: ready", "## Readiness", "## Operations"]) {
    if (!markdown.includes(expected)) {
      addIssue(blockers, "PRE_PILOT_MARKDOWN_ARTIFACT_INCOMPLETE", "pre-pilot Markdown evidence report is missing required content.", {
        expected,
      });
    }
  }
}

async function validateReadinessEvidenceArtifact(artifact, blockers) {
  if (!artifact || artifact.sizeBytes <= 0 || !artifact.sha256) {
    return;
  }

  try {
    const result = await execFile(
      process.execPath,
      [...transformArgs, "scripts/check-pilot-readiness-evidence.mjs", `--file=${artifact.path}`, "--phase=pre-pilot"],
      {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024,
      },
    );
    const readinessEvidence = JSON.parse(result.stdout.trim());

    if (readinessEvidence.ok !== true || readinessEvidence.phase !== "pre-pilot" || readinessEvidence.blockers?.length > 0) {
      addIssue(blockers, "READINESS_EVIDENCE_ARTIFACT_NOT_READY", "pre-pilot readiness evidence CSV must be verified before archiving.", {
        ok: readinessEvidence.ok ?? null,
        phase: readinessEvidence.phase ?? null,
        blockers: readinessEvidence.blockers ?? null,
      });
    }
  } catch (error) {
    const stdout = text(error.stdout);
    let parsed = null;
    try {
      parsed = stdout ? JSON.parse(stdout) : null;
    } catch {
      // Keep the generic validation blocker below.
    }

    addIssue(blockers, "READINESS_EVIDENCE_ARTIFACT_VALIDATION_FAILED", "pre-pilot readiness evidence CSV must revalidate from the artifact file.", {
      blockers: parsed?.blockers ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateLaunchPackageArtifact(artifact, artifacts, blockers) {
  const report = artifact.parsed;
  if (!report) {
    return;
  }

  if (report.ok !== true || report.mode !== "strict" || report.releaseDecision !== "ready" || report.blockers?.length > 0) {
    addIssue(blockers, "LAUNCH_PACKAGE_NOT_READY", "pre-pilot launch package must be strict and ready with no blockers.", {
      ok: report.ok ?? null,
      mode: report.mode ?? null,
      releaseDecision: report.releaseDecision ?? null,
      blockers: report.blockers ?? null,
    });
  }

  if (!parseDateTime(report.generatedAt)) {
    addIssue(blockers, "LAUNCH_PACKAGE_GENERATED_AT_INVALID", "pre-pilot launch package must include a valid generatedAt timestamp.", {
      generatedAt: report.generatedAt ?? null,
    });
  }

  const expectedPaths = {
    preflightPre: artifacts.get("prePilotPreflight")?.path,
    evidencePre: artifacts.get("prePilotEvidence")?.path,
    evidenceMarkdown: artifacts.get("prePilotMarkdown")?.path,
    readinessEvidence: artifacts.get("prePilotReadinessEvidence")?.path,
    passwordRotation: artifacts.get("passwordRotationEvidence")?.path,
    launchPackage: artifacts.get("launchPackage")?.path,
  };

  for (const [key, expectedPath] of Object.entries(expectedPaths)) {
    const actualPath = path.resolve(text(report.artifacts?.[key]?.path));
    if (actualPath !== expectedPath) {
      addIssue(blockers, "LAUNCH_PACKAGE_ARTIFACT_PATH_MISMATCH", "launch package artifact path must match artifact manifest input.", {
        key,
        actualPath,
        expectedPath,
      });
    }
  }

  const preflight = report.artifacts?.preflightPre;
  if (preflight?.ok !== true || preflight?.mode !== "strict" || preflight?.blockerCodes?.length > 0) {
    addIssue(blockers, "LAUNCH_PACKAGE_PREFLIGHT_NOT_READY", "launch package preflight summary must be strict and ready.", {
      ok: preflight?.ok ?? null,
      mode: preflight?.mode ?? null,
      blockerCodes: preflight?.blockerCodes ?? null,
    });
  }

  const evidence = report.artifacts?.evidencePre;
  if (evidence?.mode !== "pre-pilot" || evidence?.releaseDecision !== "ready" || evidence?.blockerCodes?.length > 0) {
    addIssue(blockers, "LAUNCH_PACKAGE_EVIDENCE_NOT_READY", "launch package evidence summary must be pre-pilot ready.", {
      mode: evidence?.mode ?? null,
      releaseDecision: evidence?.releaseDecision ?? null,
      blockerCodes: evidence?.blockerCodes ?? null,
    });
  }

  const markdown = report.artifacts?.evidenceMarkdown;
  if (Number(markdown?.bytes) !== Number(artifacts.get("prePilotMarkdown")?.sizeBytes) || markdown?.includesReadiness !== true || markdown?.includesOperations !== true) {
    addIssue(blockers, "LAUNCH_PACKAGE_MARKDOWN_NOT_READY", "launch package Markdown summary must match the pre-pilot Markdown artifact.", {
      packageBytes: markdown?.bytes ?? null,
      artifactBytes: artifacts.get("prePilotMarkdown")?.sizeBytes ?? null,
      includesReadiness: markdown?.includesReadiness ?? null,
      includesOperations: markdown?.includesOperations ?? null,
    });
  }

  const readinessEvidence = report.artifacts?.readinessEvidence;
  if (readinessEvidence?.ok !== true || readinessEvidence?.phase !== "pre-pilot" || readinessEvidence?.blockerCodes?.length > 0) {
    addIssue(blockers, "LAUNCH_PACKAGE_READINESS_EVIDENCE_NOT_READY", "launch package readiness evidence summary must be pre-pilot ready.", {
      ok: readinessEvidence?.ok ?? null,
      phase: readinessEvidence?.phase ?? null,
      blockerCodes: readinessEvidence?.blockerCodes ?? null,
    });
  }

  const passwordRotation = report.artifacts?.passwordRotation;
  if (passwordRotation?.ok !== true || passwordRotation?.blockerCodes?.length > 0 || Number(passwordRotation?.users) <= 0) {
    addIssue(blockers, "LAUNCH_PACKAGE_PASSWORD_ROTATION_NOT_READY", "launch package password rotation summary must be ready.", {
      ok: passwordRotation?.ok ?? null,
      users: passwordRotation?.users ?? null,
      blockerCodes: passwordRotation?.blockerCodes ?? null,
    });
  }
}

function validateFieldEvidenceArtifact(artifact, artifacts, blockers) {
  const manifest = artifact.parsed;
  if (!manifest) {
    return;
  }

  if (manifest.version !== 1) {
    addIssue(blockers, "FIELD_EVIDENCE_VERSION_INVALID", "pilot field evidence manifest version must be 1.", {
      version: manifest.version ?? null,
    });
  }

  const postEvidencePath = path.resolve(text(manifest.operations?.postPilotEvidenceJson));
  const markdownPath = path.resolve(text(manifest.operations?.postPilotEvidenceMarkdown));
  if (postEvidencePath !== artifacts.get("postPilotEvidence")?.path) {
    addIssue(blockers, "FIELD_EVIDENCE_POST_JSON_PATH_MISMATCH", "field evidence postPilotEvidenceJson must match the artifact manifest input.", {
      manifestPath: postEvidencePath,
      artifactPath: artifacts.get("postPilotEvidence")?.path ?? null,
    });
  }

  if (markdownPath !== artifacts.get("postPilotMarkdown")?.path) {
    addIssue(blockers, "FIELD_EVIDENCE_MARKDOWN_PATH_MISMATCH", "field evidence postPilotEvidenceMarkdown must match the artifact manifest input.", {
      manifestPath: markdownPath,
      artifactPath: artifacts.get("postPilotMarkdown")?.path ?? null,
    });
  }
}

function validateCloseoutArtifact(artifact, artifacts, blockers) {
  const closeout = artifact.parsed;
  if (!closeout) {
    return;
  }

  if (closeout.ok !== true || closeout.releaseDecision !== "ready" || closeout.blockers?.length > 0) {
    addIssue(blockers, "CLOSEOUT_PACKAGE_NOT_READY", "pilot closeout package must be ready with no blockers.", {
      ok: closeout.ok ?? null,
      releaseDecision: closeout.releaseDecision ?? null,
      blockers: closeout.blockers ?? null,
    });
  }

  const expectedPaths = {
    preflight: artifacts.get("postPilotPreflight")?.path,
    postPilotEvidenceJson: artifacts.get("postPilotEvidence")?.path,
    postPilotEvidenceMarkdown: artifacts.get("postPilotMarkdown")?.path,
    fieldEvidence: artifacts.get("fieldEvidence")?.path,
  };

  for (const [key, expectedPath] of Object.entries(expectedPaths)) {
    const actualPath = path.resolve(text(closeout.artifacts?.[key]));
    if (actualPath !== expectedPath) {
      addIssue(blockers, "CLOSEOUT_PACKAGE_ARTIFACT_PATH_MISMATCH", "closeout package artifact path must match artifact manifest input.", {
        key,
        actualPath,
        expectedPath,
      });
    }
  }
}

async function runCloseoutValidation(artifacts, blockers) {
  try {
    const result = await execFile(
      process.execPath,
      [
        "scripts/check-pilot-closeout-package.mjs",
        `--field=${artifacts.get("fieldEvidence")?.path}`,
        `--preflight=${artifacts.get("postPilotPreflight")?.path}`,
        `--report=${artifacts.get("postPilotEvidence")?.path}`,
        `--markdown=${artifacts.get("postPilotMarkdown")?.path}`,
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024,
      },
    );
    const closeout = JSON.parse(result.stdout.trim());
    if (closeout.ok !== true) {
      addIssue(blockers, "CLOSEOUT_REVALIDATION_BLOCKED", "closeout revalidation must be ready.", {
        blockers: closeout.blockers ?? [],
      });
    }
  } catch (error) {
    const stdout = text(error.stdout);
    let parsed = null;
    try {
      parsed = stdout ? JSON.parse(stdout) : null;
    } catch {
      // Keep the generic blocker below.
    }

    addIssue(blockers, "CLOSEOUT_REVALIDATION_FAILED", "closeout package must revalidate from artifact files.", {
      blockers: parsed?.blockers ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main() {
  const blockers = [];
  const artifacts = await Promise.all(artifactInputs.map((input) => readArtifact(input, blockers)));
  const artifactsByKey = artifactMap(artifacts);

  validatePreflightArtifact(artifactsByKey.get("prePilotPreflight"), "pre-pilot", blockers);
  validatePreflightArtifact(artifactsByKey.get("postPilotPreflight"), "post-pilot", blockers);
  validateEvidenceArtifact(artifactsByKey.get("prePilotEvidence"), "pre-pilot", blockers);
  validateEvidenceArtifact(artifactsByKey.get("postPilotEvidence"), "post-pilot", blockers);
  validatePrePilotMarkdownArtifact(artifactsByKey.get("prePilotMarkdown"), blockers);
  await validateReadinessEvidenceArtifact(artifactsByKey.get("prePilotReadinessEvidence"), blockers);
  validateLaunchPackageArtifact(artifactsByKey.get("launchPackage"), artifactsByKey, blockers);
  validatePostPilotMarkdownArtifact(artifactsByKey.get("postPilotMarkdown"), blockers);
  validateFieldEvidenceArtifact(artifactsByKey.get("fieldEvidence"), artifactsByKey, blockers);
  validateCloseoutArtifact(artifactsByKey.get("closeoutPackage"), artifactsByKey, blockers);
  await runCloseoutValidation(artifactsByKey, blockers);

  const result = {
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    releaseDecision: blockers.length === 0 ? "ready" : "blocked",
    artifacts: Object.fromEntries(
      artifacts.map((artifact) => [
        artifact.key,
        {
          label: artifact.label,
          path: artifact.path,
          type: artifact.type,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
        },
      ]),
    ),
    checked: [
      "pre-pilot and post-pilot strict preflight artifacts",
      "pre-pilot and post-pilot pilot:evidence artifacts",
      "pre-pilot Markdown evidence artifact",
      "pre-pilot readiness evidence CSV artifact",
      "pre-pilot launch package ready decision, readiness/password evidence, and artifact paths",
      "post-pilot Markdown evidence artifact",
      "field evidence artifact path consistency",
      "closeout package ready decision and artifact paths",
      "closeout package revalidation from artifact files",
      "SHA-256 and byte-size manifest for every release artifact",
    ],
    blockers,
  };

  if (outFile) {
    await writeFile(path.resolve(outFile), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(result, null, 2));

  if (blockers.length > 0) {
    process.exitCode = 1;
  }
}

await main();
