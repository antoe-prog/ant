import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const artifactKeys = [
  "prePilotPreflight",
  "prePilotEvidence",
  "prePilotMarkdown",
  "prePilotReadinessEvidence",
  "launchPackage",
  "passwordRotationEvidence",
  "postPilotPreflight",
  "postPilotEvidence",
  "postPilotMarkdown",
  "fieldEvidence",
  "closeoutPackage",
];

async function runStatus(paths, extraArgs = []) {
  const args = [
    "scripts/check-pilot-status.mjs",
    `--db=${paths.db}`,
    `--preflight-pre=${paths.preflightPre}`,
    `--evidence-pre=${paths.evidencePre}`,
    `--evidence-pre-markdown=${paths.prePilotMarkdown}`,
    `--readiness-evidence=${paths.readinessEvidence}`,
    `--launch-package=${paths.launchPackage}`,
    `--password-rotation=${paths.passwordRotation}`,
    `--preflight-post=${paths.preflightPost}`,
    `--evidence-post=${paths.evidencePost}`,
    `--field=${paths.field}`,
    `--closeout=${paths.closeout}`,
    `--artifact-manifest=${paths.artifactManifest}`,
    `--archive-manifest=${paths.archiveManifest}`,
    `--storage-receipt=${paths.storageReceipt}`,
    `--final-handoff=${paths.finalHandoff}`,
    ...extraArgs,
  ];

  try {
    const result = await execFile(process.execPath, args, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function writeText(filePath, body) {
  const buffer = Buffer.from(body, "utf8");
  await writeFile(filePath, buffer);
  return {
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
  };
}

async function setupPaths(label) {
  const root = await mkdtemp(join(tmpdir(), `final-judo-pilot-status-${label}-`));
  const archiveDir = join(root, "archive");
  await mkdir(archiveDir, { recursive: true });

  return {
    root,
    db: join(root, "runtime.json"),
    preflightPre: join(root, "pilot-preflight.pre-pilot.json"),
    evidencePre: join(root, "pilot-evidence.json"),
    prePilotMarkdown: join(root, "pilot-evidence.pre-pilot.md"),
    readinessEvidence: join(root, "pilot-readiness-evidence.csv"),
    launchPackage: join(root, "pilot-launch-package.json"),
    passwordRotation: join(root, "pilot-password-rotation.csv"),
    preflightPost: join(root, "pilot-preflight.post-pilot.json"),
    evidencePost: join(root, "pilot-evidence.post-pilot.json"),
    field: join(root, "pilot-field-evidence.json"),
    closeout: join(root, "pilot-closeout-package.json"),
    artifactManifest: join(root, "pilot-artifact-manifest.json"),
    archiveManifest: join(archiveDir, "pilot-archive-manifest.json"),
    storageReceipt: join(root, "pilot-storage-receipt.json"),
    finalHandoff: join(root, "pilot-final-handoff.json"),
  };
}

function readyPreflight(extra = {}) {
  return {
    ok: true,
    mode: "strict",
    generatedAt: "2026-07-15T02:00:00.000Z",
    blockers: [],
    warnings: [],
    checked: ["fixture strict preflight"],
    ...extra,
  };
}

function readyEvidence(mode, counts = {}) {
  return {
    generatedAt: "2026-07-15T02:05:00.000Z",
    mode,
    releaseDecision: "ready",
    preflight: { blockerCodes: [] },
    counts,
  };
}

function readyPasswordUser() {
  return {
    id: "user-admin",
    email: "admin@finaljudo.test",
    name: "관리자",
    role: "admin",
    branchIds: ["branch-gangnam", "branch-songpa"],
    passwordHash: "pbkdf2_sha256$120000$status-fixture$abcdef",
    passwordUpdatedAt: "2026-06-30T09:05:00.000Z",
  };
}

function readyPasswordAuditLog() {
  return {
    id: "audit-auth-password-reset-admin",
    action: "auth.password_reset.complete",
    targetId: "user-admin",
    result: "success",
    createdAt: "2026-06-30T09:05:00.000Z",
    after: {
      reason: "fixture password rotation",
    },
  };
}

function readyPasswordRotationCsv() {
  return [
    "userId,email,name,role,branchIds,usesDefaultPassword,hasPasswordHash,lastPasswordAuditAt,rotationStatus,evidence,rotatedAt,notes",
    "user-admin,admin@finaljudo.test,관리자,admin,branch-gangnam|branch-songpa,false,true,2026-06-30T09:05:00.000Z,verified,auth.password_reset.complete audit-auth-password-reset-admin channel receipt,2026-06-30T09:05:00.000Z,secure channel receipt archived",
    "",
  ].join("\n");
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csvRow(values) {
  return values.map(csvCell).join(",");
}

function readyReadinessEvidenceCsv() {
  const rows = [
    ["id", "category", "label", "owner", "status", "evidence", "checkedAt", "notes"],
    ["pilot-branches", "scope", "운영 준비 지점 1-2곳과 2주 기간 확정", "총괄 PM", "verified", "branch approval memo and pilot calendar", "2026-06-30T09:00:00.000Z", ""],
    ["pilot-accounts", "scope", "대표/코치/학부모/회원 운영 계정 확정", "총괄 어드민", "verified", "account roster and login verification screenshots", "2026-06-30T09:01:00.000Z", ""],
    ["pilot-password-rotation", "security", "계정별 비밀번호 교체와 전달 채널 확인", "총괄 어드민", "verified", "password rotation CSV and secure channel receipt", "2026-06-30T09:02:00.000Z", ""],
    ["pilot-data", "data", "실제 시간표, 회원권, 결제 상태 입력 후 운영 현황 재확인", "운영 담당자", "verified", "masked import dry-run and production preflight output", "2026-06-30T09:03:00.000Z", ""],
    ["pilot-mobile-attendance", "device", "현장 코치 모바일 기기에서 수업별 출석 30초 처리 계측", "코치 리드", "verified", "ios android tablet attendance timing evidence", "2026-06-30T09:04:00.000Z", ""],
    ["pilot-screenreader", "accessibility", "접근성 현장 확인", "QA", "verified", "VoiceOver TalkBack keyboard smoke notes", "2026-06-30T09:05:00.000Z", ""],
    ["pilot-incident-channel", "incident", "장애 보고 채널과 운영 중단 기준 확정", "총괄 PM", "verified", "incident channel owner confirmation and stop criteria", "2026-06-30T09:06:00.000Z", ""],
  ];

  return `${rows.map(csvRow).join("\n")}\n`;
}

function readyArtifactManifest() {
  const artifacts = {};
  for (const key of artifactKeys) {
    artifacts[key] = {
      path: `/tmp/${key}`,
      sha256: "a".repeat(64),
      sizeBytes: 12,
    };
  }
  return { ok: true, generatedAt: "2026-07-15T02:20:00.000Z", releaseDecision: "ready", blockers: [], artifacts };
}

function readyArchiveManifest() {
  const artifacts = {};
  for (const key of artifactKeys) {
    artifacts[key] = {
      archivedPath: `/tmp/archive/${key}`,
      sha256: "b".repeat(64),
      sizeBytes: 12,
    };
  }
  return { ok: true, generatedAt: "2026-07-15T02:25:00.000Z", releaseDecision: "ready", blockers: [], artifacts };
}

async function writeReadyChain(paths) {
  await writeJson(paths.db, {
    users: [readyPasswordUser()],
    auditLogs: [readyPasswordAuditLog()],
    pilotReadinessChecks: [
      { id: "pilot-scope", status: "verified" },
      { id: "pilot-password-rotation", status: "verified" },
    ],
    pilotIncidents: [],
    pilotOperationLogs: Array.from({ length: 14 }, (_, index) => ({
      id: `op-${index}`,
      status: "verified",
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    })),
  });
  await writeJson(paths.preflightPre, readyPreflight());
  await writeJson(paths.evidencePre, readyEvidence("pre-pilot"));
  await writeFile(
    paths.prePilotMarkdown,
    "# Final Judo Pilot Evidence Report\n\n- Mode: pre-pilot\n- Decision: ready\n\n## Readiness\n\n## Operations\n",
    "utf8",
  );
  await writeFile(paths.readinessEvidence, readyReadinessEvidenceCsv(), "utf8");
  await writeFile(paths.passwordRotation, readyPasswordRotationCsv(), "utf8");
  await writeJson(paths.launchPackage, {
    ok: true,
    generatedAt: "2026-07-15T02:08:00.000Z",
    mode: "strict",
    releaseDecision: "ready",
    blockers: [],
    artifacts: {
      preflightPre: { ok: true, mode: "strict", blockerCodes: [] },
      evidencePre: { mode: "pre-pilot", releaseDecision: "ready", blockerCodes: [] },
      evidenceMarkdown: { includesReadiness: true, includesOperations: true },
      readinessEvidence: { ok: true, phase: "pre-pilot", blockerCodes: [] },
      passwordRotation: { ok: true, users: 1, blockerCodes: [] },
    },
  });
  await writeJson(
    paths.preflightPost,
    readyPreflight({
      checked: [
        "fixture strict preflight",
        "14-day pilot operation evidence when --require-retro is set",
        "mobile attendance timing evidence in pilot operation logs",
      ],
    }),
  );
  await writeJson(paths.evidencePost, readyEvidence("post-pilot", { operationDays: 14, verifiedOperationDays: 14 }));
  await writeJson(paths.field, {
    version: 1,
    pilot: {
      signedOffBy: "A0 PM",
      signedOffAt: "2026-07-15T03:00:00.000Z",
    },
  });
  await writeJson(paths.closeout, { ok: true, generatedAt: "2026-07-15T03:05:00.000Z", releaseDecision: "ready", blockers: [] });
  await writeJson(paths.artifactManifest, readyArtifactManifest());
  await writeJson(paths.archiveManifest, readyArchiveManifest());
  await writeJson(paths.storageReceipt, {
    version: 1,
    uploadedAt: "2026-07-15T03:10:00.000Z",
    uploadedBy: "A0 PM",
    storageProvider: "Cloud Archive",
    storageLocation: "https://storage.example.com/final-judo/",
    retentionPolicy: { minimumRetentionDays: 365 },
    uploadedArtifacts: Array.from({ length: artifactKeys.length + 1 }, (_, index) => ({ key: `artifact-${index}` })),
  });
  await writeJson(paths.finalHandoff, { ok: true, generatedAt: "2026-07-15T03:15:00.000Z", releaseDecision: "ready", blockers: [] });
}

async function writeStrictReadyChain(paths) {
  const archiveArtifactsDir = join(paths.root, "archive", "artifacts");
  const archivedArtifactManifestPath = join(paths.root, "archive", "pilot-artifact-manifest.json");
  const markdownPath = join(paths.root, "pilot-evidence.md");
  await mkdir(archiveArtifactsDir, { recursive: true });

  await writeJson(paths.db, {
    users: [readyPasswordUser()],
    auditLogs: [readyPasswordAuditLog()],
    pilotReadinessChecks: [
      { id: "pilot-scope", status: "verified" },
      { id: "pilot-password-rotation", status: "verified" },
    ],
    pilotIncidents: [],
    pilotOperationLogs: Array.from({ length: 14 }, (_, index) => ({
      id: `op-${index}`,
      status: "verified",
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    })),
  });

  const prePilotMarkdownBody = "# Final Judo Pilot Evidence Report\n\n- Mode: pre-pilot\n- Decision: ready\n\n## Readiness\n\n## Operations\n";
  const readinessEvidenceBody = readyReadinessEvidenceCsv();
  const passwordRotationBody = readyPasswordRotationCsv();
  const launchPackageBody = `${JSON.stringify(
    {
      ok: true,
      generatedAt: "2026-07-15T03:12:00.000Z",
      mode: "strict",
      releaseDecision: "ready",
      blockers: [],
      artifacts: {
        preflightPre: {
          path: paths.preflightPre,
          ok: true,
          mode: "strict",
          blockerCodes: [],
        },
        evidencePre: {
          path: paths.evidencePre,
          mode: "pre-pilot",
          releaseDecision: "ready",
          blockerCodes: [],
        },
        evidenceMarkdown: {
          path: paths.prePilotMarkdown,
          bytes: Buffer.byteLength(prePilotMarkdownBody, "utf8"),
          includesReadiness: true,
          includesOperations: true,
        },
        readinessEvidence: {
          path: paths.readinessEvidence,
          ok: true,
          phase: "pre-pilot",
          statusCounts: { verified: 7 },
          blockerCodes: [],
        },
        passwordRotation: {
          path: paths.passwordRotation,
          ok: true,
          users: 1,
          statusCounts: { verified: 1 },
          blockerCodes: [],
        },
        launchPackage: {
          path: paths.launchPackage,
        },
      },
    },
    null,
    2,
  )}\n`;

  const sourceFiles = {
    prePilotPreflight: {
      path: paths.preflightPre,
      body: `${JSON.stringify(readyPreflight(), null, 2)}\n`,
      type: "json",
    },
    prePilotEvidence: {
      path: paths.evidencePre,
      body: `${JSON.stringify(readyEvidence("pre-pilot"), null, 2)}\n`,
      type: "json",
    },
    prePilotMarkdown: {
      path: paths.prePilotMarkdown,
      body: prePilotMarkdownBody,
      type: "text",
    },
    prePilotReadinessEvidence: {
      path: paths.readinessEvidence,
      body: readinessEvidenceBody,
      type: "text",
    },
    launchPackage: {
      path: paths.launchPackage,
      body: launchPackageBody,
      type: "json",
    },
    passwordRotationEvidence: {
      path: paths.passwordRotation,
      body: passwordRotationBody,
      type: "text",
    },
    postPilotPreflight: {
      path: paths.preflightPost,
      body: `${JSON.stringify(
        readyPreflight({
          checked: [
            "fixture strict preflight",
            "14-day pilot operation evidence when --require-retro is set",
            "mobile attendance timing evidence in pilot operation logs",
          ],
        }),
        null,
        2,
      )}\n`,
      type: "json",
    },
    postPilotEvidence: {
      path: paths.evidencePost,
      body: `${JSON.stringify(readyEvidence("post-pilot", { operationDays: 14, verifiedOperationDays: 14 }), null, 2)}\n`,
      type: "json",
    },
    postPilotMarkdown: {
      path: markdownPath,
      body: "# Final Judo Pilot Evidence Report\n\n- Mode: post-pilot\n- Decision: ready\n\n## Operations\n",
      type: "text",
    },
    fieldEvidence: {
      path: paths.field,
      body: `${JSON.stringify({ version: 1, pilot: { signedOffBy: "A0 PM", signedOffAt: "2026-07-15T03:00:00.000Z" } }, null, 2)}\n`,
      type: "json",
    },
    closeoutPackage: {
      path: paths.closeout,
      body: `${JSON.stringify({ ok: true, generatedAt: "2026-07-15T03:05:00.000Z", releaseDecision: "ready", blockers: [] }, null, 2)}\n`,
      type: "json",
    },
  };

  const artifactEntries = {};
  const archiveEntries = {};
  for (const [index, key] of artifactKeys.entries()) {
    const source = sourceFiles[key];
    const extension = key === "prePilotReadinessEvidence" || key === "passwordRotationEvidence" ? ".csv" : source.type === "text" ? ".md" : ".json";
    const archivedPath = join(archiveArtifactsDir, `${String(index + 1).padStart(2, "0")}-${key}${extension}`);
    const stats = await writeText(source.path, source.body);
    await writeText(archivedPath, source.body);
    artifactEntries[key] = {
      label: key,
      path: source.path,
      type: source.type,
      sizeBytes: stats.sizeBytes,
      sha256: stats.sha256,
    };
    archiveEntries[key] = {
      label: key,
      type: source.type,
      sourcePath: source.path,
      archivedPath,
      sizeBytes: stats.sizeBytes,
      sha256: stats.sha256,
    };
  }

  const artifactManifest = {
    ok: true,
    generatedAt: "2026-07-15T03:20:00.000Z",
    releaseDecision: "ready",
    artifacts: artifactEntries,
    checked: ["strict status fixture artifact manifest"],
    blockers: [],
  };
  const artifactManifestStats = await writeText(paths.artifactManifest, `${JSON.stringify(artifactManifest, null, 2)}\n`);
  await writeText(archivedArtifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`);

  const archiveManifest = {
    ok: true,
    generatedAt: "2026-07-15T03:25:00.000Z",
    releaseDecision: "ready",
    sourceManifest: {
      sourcePath: paths.artifactManifest,
      archivedPath: archivedArtifactManifestPath,
      sizeBytes: artifactManifestStats.sizeBytes,
      sha256: artifactManifestStats.sha256,
    },
    archiveDir: join(paths.root, "archive"),
    archiveManifestPath: paths.archiveManifest,
    artifacts: archiveEntries,
    checked: ["strict status fixture archive manifest"],
    blockers: [],
  };
  const archiveManifestStats = await writeText(paths.archiveManifest, `${JSON.stringify(archiveManifest, null, 2)}\n`);

  const storageLocation = "https://storage.example.com/final-judo/status-fixture/";
  await writeJson(paths.storageReceipt, {
    version: 1,
    archiveManifest: paths.archiveManifest,
    archiveManifestSha256: archiveManifestStats.sha256,
    archiveManifestSizeBytes: archiveManifestStats.sizeBytes,
    uploadedAt: "2026-07-15T03:30:00.000Z",
    uploadedBy: "A0 PM",
    storageProvider: "Cloud Archive",
    storageLocation,
    evidence: `${storageLocation}receipt-proof.png`,
    retentionPolicy: {
      minimumRetentionDays: 365,
      owner: "A0 PM",
      accessReviewDueOn: "2027-07-15",
      evidence: `${storageLocation}retention-policy.pdf`,
    },
    uploadedArtifacts: [
      {
        key: "pilotArtifactManifest",
        archivedPath: archivedArtifactManifestPath,
        sizeBytes: artifactManifestStats.sizeBytes,
        sha256: artifactManifestStats.sha256,
        storageLocation: `${storageLocation}pilot-artifact-manifest.json`,
      },
      ...Object.entries(archiveEntries).map(([key, artifact]) => ({
        key,
        archivedPath: artifact.archivedPath,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        storageLocation: `${storageLocation}${key}`,
      })),
    ],
  });

  const result = await execFile(
    process.execPath,
    [
      "scripts/check-pilot-final-handoff.mjs",
      `--artifact-manifest=${paths.artifactManifest}`,
      `--archive-manifest=${paths.archiveManifest}`,
      `--storage-receipt=${paths.storageReceipt}`,
      `--out=${paths.finalHandoff}`,
    ],
    {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    },
  );
  const finalHandoff = JSON.parse(result.stdout);
  assert.equal(finalHandoff.ok, true, "strict ready fixture final handoff must be ready");

  return { archiveEntries };
}

const missingPaths = await setupPaths("missing");
const missingRun = await runStatus(missingPaths);
assert.equal(missingRun.code, 0, missingRun.stderr);
const missingReport = JSON.parse(missingRun.stdout);
assert.equal(missingReport.ok, false);
assert.equal(missingReport.releaseDecision, "blocked");
assert.equal(missingReport.phase, "runtime");
assert.match(missingReport.nextAction, /런타임 DB/);
assert(
  missingReport.blockers.some((blocker) => blocker.code === "PILOT_STATUS_RUNTIME_NOT_READY" && blocker.status === "missing"),
  "missing runtime must be listed as a non-ready blocker",
);

const waitingPaths = await setupPaths("waiting");
await writeJson(waitingPaths.db, {
  pilotReadinessChecks: [{ id: "pilot-scope", status: "pending" }],
  pilotIncidents: [],
  pilotOperationLogs: [],
});
const waitingRun = await runStatus(waitingPaths);
assert.equal(waitingRun.code, 0, waitingRun.stderr);
const waitingReport = JSON.parse(waitingRun.stdout);
assert.equal(waitingReport.ok, false);
assert.equal(waitingReport.phase, "runtime");
assert.equal(waitingReport.artifacts.runtime.status, "waiting");
assert.match(waitingReport.nextAction, /pilot:prelaunch-draft/);
assert.match(waitingReport.nextAction, /admin\/settings/);
assert(
  waitingReport.blockers.some((blocker) => blocker.code === "PILOT_STATUS_RUNTIME_NOT_READY" && blocker.status === "waiting"),
  "waiting runtime must be listed as a non-ready blocker",
);

const readinessMissingPaths = await setupPaths("readiness-missing");
await writeJson(readinessMissingPaths.db, {
  users: [readyPasswordUser()],
  auditLogs: [readyPasswordAuditLog()],
  pilotReadinessChecks: [
    { id: "pilot-scope", status: "verified" },
    { id: "pilot-password-rotation", status: "verified" },
  ],
  pilotIncidents: [],
  pilotOperationLogs: [],
});
await writeJson(readinessMissingPaths.preflightPre, readyPreflight());
await writeJson(readinessMissingPaths.evidencePre, readyEvidence("pre-pilot"));
await writeFile(
  readinessMissingPaths.prePilotMarkdown,
  "# Final Judo Pilot Evidence Report\n\n- Mode: pre-pilot\n- Decision: ready\n\n## Readiness\n\n## Operations\n",
  "utf8",
);
const readinessMissingRun = await runStatus(readinessMissingPaths);
assert.equal(readinessMissingRun.code, 0, readinessMissingRun.stderr);
const readinessMissingReport = JSON.parse(readinessMissingRun.stdout);
assert.equal(readinessMissingReport.ok, false);
assert.equal(readinessMissingReport.phase, "readinessEvidence");
assert.equal(readinessMissingReport.artifacts.readinessEvidence.status, "missing");
assert.match(readinessMissingReport.nextAction, /pilot:prelaunch-draft/);
assert.match(readinessMissingReport.nextAction, /pilot:readiness-evidence/);
assert(
  readinessMissingReport.blockers.some((blocker) => blocker.code === "PILOT_STATUS_READINESSEVIDENCE_NOT_READY" && blocker.status === "missing"),
  "missing readiness evidence must be listed as a non-ready blocker",
);

const passwordMissingPaths = await setupPaths("password-missing");
await writeJson(passwordMissingPaths.db, {
  users: [readyPasswordUser()],
  auditLogs: [readyPasswordAuditLog()],
  pilotReadinessChecks: [
    { id: "pilot-scope", status: "verified" },
    { id: "pilot-password-rotation", status: "verified" },
  ],
  pilotIncidents: [],
  pilotOperationLogs: [],
});
await writeJson(passwordMissingPaths.preflightPre, readyPreflight());
await writeJson(passwordMissingPaths.evidencePre, readyEvidence("pre-pilot"));
await writeFile(
  passwordMissingPaths.prePilotMarkdown,
  "# Final Judo Pilot Evidence Report\n\n- Mode: pre-pilot\n- Decision: ready\n\n## Readiness\n\n## Operations\n",
  "utf8",
);
await writeFile(passwordMissingPaths.readinessEvidence, readyReadinessEvidenceCsv(), "utf8");
const passwordMissingRun = await runStatus(passwordMissingPaths);
assert.equal(passwordMissingRun.code, 0, passwordMissingRun.stderr);
const passwordMissingReport = JSON.parse(passwordMissingRun.stdout);
assert.equal(passwordMissingReport.ok, false);
assert.equal(passwordMissingReport.phase, "passwordRotation");
assert.equal(passwordMissingReport.artifacts.passwordRotation.status, "missing");
assert.match(passwordMissingReport.nextAction, /pilot:password-rotation/);
assert(
  passwordMissingReport.blockers.some((blocker) => blocker.code === "PILOT_STATUS_PASSWORDROTATION_NOT_READY" && blocker.status === "missing"),
  "missing password rotation evidence must be listed as a non-ready blocker",
);

const readyPaths = await setupPaths("ready");
await writeReadyChain(readyPaths);
const readyRun = await runStatus(readyPaths);
assert.equal(readyRun.code, 0, readyRun.stderr);
const readyReport = JSON.parse(readyRun.stdout);
assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert.equal(readyReport.phase, "final-handoff-ready");
assert.equal(readyReport.artifacts.readinessEvidence.status, "ready");
assert.equal(readyReport.artifacts.passwordRotation.status, "ready");
assert.equal(readyReport.artifacts.finalHandoff.status, "ready");
assert.deepEqual(readyReport.blockers, [], "ready status must not contain non-ready blockers");
assert(readyReport.checked.includes("pre-pilot readiness evidence status"));
assert(readyReport.checked.includes("password rotation evidence status"));
assert(readyReport.checked.includes("non-ready artifact blocker coverage"));

const statusOutPath = join(readyPaths.root, "pilot-status.json");
const readyOutRun = await runStatus(readyPaths, [`--out=${statusOutPath}`]);
assert.equal(readyOutRun.code, 0, readyOutRun.stderr);
const writtenReadyStatus = JSON.parse(await readFile(statusOutPath, "utf8"));
assert.deepEqual(writtenReadyStatus, JSON.parse(readyOutRun.stdout), "pilot:status --out must write the same ready report emitted to stdout");

const strictReadyPaths = await setupPaths("strict-ready");
await writeStrictReadyChain(strictReadyPaths);
const strictReadyRun = await runStatus(strictReadyPaths, ["--strict"]);
assert.equal(strictReadyRun.code, 0, strictReadyRun.stderr || strictReadyRun.stdout);
const strictReadyReport = JSON.parse(strictReadyRun.stdout);
assert.equal(strictReadyReport.ok, true);
assert.equal(strictReadyReport.releaseDecision, "ready");
assert.equal(strictReadyReport.artifacts.strictFinalHandoffValidation.status, "ready");
assert(strictReadyReport.checked.includes("strict final handoff validator rerun"));

const blockedPaths = await setupPaths("blocked");
await writeReadyChain(blockedPaths);
await writeJson(blockedPaths.evidencePost, readyEvidence("post-pilot", { operationDays: 13, verifiedOperationDays: 13 }));
const blockedRun = await runStatus(blockedPaths);
assert.equal(blockedRun.code, 0, blockedRun.stderr);
const blockedReport = JSON.parse(blockedRun.stdout);
assert.equal(blockedReport.ok, false);
assert.equal(blockedReport.phase, "evidencePost");
assert.equal(blockedReport.artifacts.evidencePost.status, "blocked");
assert(blockedReport.blockers.some((blocker) => blocker.code === "PILOT_STATUS_EVIDENCEPOST_NOT_READY"));

const strictRun = await runStatus(blockedPaths, ["--strict"]);
assert.notEqual(strictRun.code, 0, "strict pilot status must fail until final handoff is ready");

const blockedStatusOutPath = join(missingPaths.root, "pilot-status.blocked.json");
const strictOutRun = await runStatus(missingPaths, ["--strict", `--out=${blockedStatusOutPath}`]);
assert.notEqual(strictOutRun.code, 0, "strict pilot status with --out must still fail when status is not ready");
const writtenBlockedStatus = JSON.parse(await readFile(blockedStatusOutPath, "utf8"));
assert.deepEqual(writtenBlockedStatus, JSON.parse(strictOutRun.stdout), "pilot:status --out must preserve the blocked strict report before exiting");

const tamperedStrictPaths = await setupPaths("strict-tampered");
const tamperedFixture = await writeStrictReadyChain(tamperedStrictPaths);
await writeFile(tamperedFixture.archiveEntries.postPilotEvidence.archivedPath, "{\"tampered\":true}\n", "utf8");
const tamperedStrictRun = await runStatus(tamperedStrictPaths, ["--strict"]);
assert.notEqual(tamperedStrictRun.code, 0, "strict pilot status must fail when archived artifacts are tampered");
const tamperedStrictReport = JSON.parse(tamperedStrictRun.stdout);
assert.equal(tamperedStrictReport.artifacts.strictFinalHandoffValidation.status, "blocked");
assert(tamperedStrictReport.blockers.some((blocker) => blocker.code === "PILOT_STATUS_STRICTFINALHANDOFFVALIDATION_NOT_READY"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "missing runtime reports first next action",
        "missing runtime is listed as a non-ready blocker",
        "pending readiness reports prelaunch draft and admin settings next action",
        "pending readiness is listed as a non-ready blocker",
        "missing readiness evidence CSV reports prelaunch draft and dedicated next action",
        "missing readiness evidence is listed as a non-ready blocker",
        "ready readiness evidence CSV reports dedicated status",
        "missing password rotation CSV reports dedicated next action",
        "missing password rotation is listed as a non-ready blocker",
        "ready final handoff reports release ready",
        "status command writes ready JSON output",
        "strict ready status reruns final handoff validator",
        "post-pilot evidence with fewer than 14 days blocks status",
        "strict mode exits nonzero when status is not ready",
        "status command writes blocked strict JSON output",
        "strict status blocks tampered archived artifacts",
      ],
    },
    null,
    2,
  ),
);
