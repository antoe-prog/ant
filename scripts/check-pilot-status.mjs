import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const execFile = promisify(execFileCallback);
const outFile = rawArgValue("--out", null);

function rawArgValue(name, fallback) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

function pathArgValue(name, fallback) {
  return path.resolve(rawArgValue(name, fallback));
}

const runtimeDriver = rawArgValue("--driver", process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");
const postgresUrl = rawArgValue("--postgres-url", process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL ?? "");
const postgresStateKey = rawArgValue("--state-key", process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp");
const postgresTable = rawArgValue("--table", process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state");

const paths = {
  db: pathArgValue("--db", ".data/final-judo-db.json"),
  preflightPre: pathArgValue("--preflight-pre", ".data/pilot-preflight.pre-pilot.json"),
  evidencePre: pathArgValue("--evidence-pre", ".data/pilot-evidence.json"),
  prePilotMarkdown: pathArgValue("--evidence-pre-markdown", ".data/pilot-evidence.pre-pilot.md"),
  readinessEvidence: pathArgValue("--readiness-evidence", ".data/pilot-readiness-evidence.csv"),
  launchPackage: pathArgValue("--launch-package", ".data/pilot-launch-package.json"),
  passwordRotation: pathArgValue("--password-rotation", ".data/pilot-password-rotation.csv"),
  preflightPost: pathArgValue("--preflight-post", ".data/pilot-preflight.post-pilot.json"),
  evidencePost: pathArgValue("--evidence-post", ".data/pilot-evidence.post-pilot.json"),
  field: pathArgValue("--field", ".data/pilot-field-evidence.json"),
  closeout: pathArgValue("--closeout", ".data/pilot-closeout-package.json"),
  artifactManifest: pathArgValue("--artifact-manifest", ".data/pilot-artifact-manifest.json"),
  archiveManifest: pathArgValue("--archive-manifest", ".data/pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json"),
  storageReceipt: pathArgValue("--storage-receipt", ".data/pilot-storage-receipt.json"),
  finalHandoff: pathArgValue("--final-handoff", ".data/pilot-final-handoff.json"),
};

const requiredArtifactKeys = [
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

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDateTime(value) {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readyDocument(document) {
  return document?.ok === true && document?.releaseDecision === "ready" && (document?.blockers?.length ?? 0) === 0;
}

function readyPreflight(document, requireRetro = false) {
  if (document?.ok !== true || document?.mode !== "strict" || (document?.blockers?.length ?? 0) > 0) {
    return false;
  }

  const checked = Array.isArray(document.checked) ? document.checked : [];
  if (!requireRetro) {
    return true;
  }

  return ["14-day pilot operation evidence when --require-retro is set", "mobile attendance timing evidence in pilot operation logs"].every((item) =>
    checked.includes(item),
  );
}

function readyEvidence(document, expectedMode) {
  if (document?.releaseDecision !== "ready" || document?.mode !== expectedMode || (document?.preflight?.blockerCodes?.length ?? 0) > 0) {
    return false;
  }

  if (expectedMode !== "post-pilot") {
    return true;
  }

  return Number(document.counts?.operationDays) >= 14 && Number(document.counts?.verifiedOperationDays) >= 14;
}

function readyPrePilotMarkdown(markdown) {
  return ["# Final Judo Pilot Evidence Report", "- Mode: pre-pilot", "- Decision: ready", "## Readiness", "## Operations"].every((expected) =>
    markdown.includes(expected),
  );
}

function readyLaunchPackage(document) {
  return (
    document?.ok === true &&
    document?.mode === "strict" &&
    document?.releaseDecision === "ready" &&
    (document?.blockers?.length ?? 0) === 0 &&
    document?.artifacts?.preflightPre?.ok === true &&
    document?.artifacts?.preflightPre?.mode === "strict" &&
    (document?.artifacts?.preflightPre?.blockerCodes?.length ?? 0) === 0 &&
    document?.artifacts?.evidencePre?.mode === "pre-pilot" &&
    document?.artifacts?.evidencePre?.releaseDecision === "ready" &&
    (document?.artifacts?.evidencePre?.blockerCodes?.length ?? 0) === 0 &&
    document?.artifacts?.evidenceMarkdown?.includesReadiness === true &&
    document?.artifacts?.evidenceMarkdown?.includesOperations === true &&
    document?.artifacts?.readinessEvidence?.ok === true &&
    document?.artifacts?.readinessEvidence?.phase === "pre-pilot" &&
    (document?.artifacts?.readinessEvidence?.blockerCodes?.length ?? 0) === 0 &&
    document?.artifacts?.passwordRotation?.ok === true &&
    (document?.artifacts?.passwordRotation?.blockerCodes?.length ?? 0) === 0 &&
    Number(document?.artifacts?.passwordRotation?.users) > 0
  );
}

async function readJson(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return { exists: true, json: JSON.parse(raw), error: null };
  } catch (error) {
    return {
      exists: false,
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function assertSafeIdentifier(value, label) {
  const identifier = text(value);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`${label} must be a safe SQL identifier.`);
  }
  return identifier;
}

function redactConnectionString(value) {
  const connectionString = text(value);
  if (!connectionString) {
    return "";
  }

  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "<redacted-postgres-url>";
  }
}

function runtimeSource() {
  if (runtimeDriver === "postgres") {
    return {
      driver: "postgres",
      key: text(postgresStateKey) || "mvp",
      table: text(postgresTable) || "app_runtime_state",
      connectionString: redactConnectionString(postgresUrl),
    };
  }

  return {
    driver: "json",
    path: paths.db,
  };
}

function runtimePathLabel() {
  if (runtimeDriver === "postgres") {
    const source = runtimeSource();
    return `${source.table}:${source.key}`;
  }

  return paths.db;
}

async function readPostgresRuntime() {
  const source = runtimeSource();

  if (!postgresUrl) {
    return {
      exists: false,
      json: null,
      error: "PostgreSQL runtime requires --postgres-url or FINAL_JUDO_POSTGRES_URL.",
      runtime: source,
    };
  }

  try {
    const tableName = assertSafeIdentifier(source.table, "--table");
    const pg = await import("pg");
    const Client = pg.Client ?? pg.default?.Client;
    if (!Client) {
      throw new Error("The pg Client export is unavailable.");
    }
    const client = new Client({ connectionString: postgresUrl });

    await client.connect();
    try {
      const result = await client.query(`select data, revision, updated_at from ${tableName} where key = $1`, [source.key]);
      const row = result.rows[0];

      if (!row) {
        return {
          exists: false,
          json: null,
          error: `PostgreSQL runtime row was not found for state key "${source.key}".`,
          runtime: source,
        };
      }

      const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      return {
        exists: true,
        json: data,
        error: null,
        runtime: {
          ...source,
          revision: Number(row.revision ?? 0),
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        },
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch (error) {
    return {
      exists: false,
      json: null,
      error: error instanceof Error ? error.message : String(error),
      runtime: source,
    };
  }
}

async function readRuntime() {
  if (runtimeDriver === "postgres") {
    return readPostgresRuntime();
  }

  if (runtimeDriver !== "json") {
    return {
      exists: false,
      json: null,
      error: `Unsupported runtime driver "${runtimeDriver}". Use "json" or "postgres".`,
      runtime: { driver: runtimeDriver },
    };
  }

  const readResult = await readJson(paths.db);
  return {
    ...readResult,
    runtime: runtimeSource(),
  };
}

async function readText(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return { exists: true, text: raw, error: null };
  } catch (error) {
    return {
      exists: false,
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function classify(label, filePath, readResult, validator, blockedMessage) {
  if (!readResult.exists) {
    return {
      label,
      path: filePath,
      status: "missing",
      message: "파일이 아직 없습니다.",
    };
  }

  if (!validator(readResult.json)) {
    return {
      label,
      path: filePath,
      status: "blocked",
      message: blockedMessage,
    };
  }

  return {
    label,
    path: filePath,
    status: "ready",
    message: "ready 상태입니다.",
    generatedAt: readResult.json?.generatedAt ?? null,
  };
}

function classifyText(label, filePath, readResult, validator, blockedMessage) {
  if (!readResult.exists) {
    return {
      label,
      path: filePath,
      status: "missing",
      message: "파일이 아직 없습니다.",
    };
  }

  if (!validator(readResult.text)) {
    return {
      label,
      path: filePath,
      status: "blocked",
      message: blockedMessage,
    };
  }

  return {
    label,
    path: filePath,
    status: "ready",
    message: "ready 상태입니다.",
  };
}

function classifyRuntime(filePath, readResult) {
  const metadata = readResult.runtime ?? { driver: "json", path: filePath };

  if (!readResult.exists) {
    return {
      label: "runtime data",
      path: filePath,
      status: "missing",
      message: "파일럿 런타임 데이터가 없습니다.",
      runtime: metadata,
      error: readResult.error ?? null,
    };
  }

  const db = readResult.json;
  const checks = Array.isArray(db?.pilotReadinessChecks) ? db.pilotReadinessChecks : [];
  const incidents = Array.isArray(db?.pilotIncidents) ? db.pilotIncidents : [];
  const operations = Array.isArray(db?.pilotOperationLogs) ? db.pilotOperationLogs : [];
  const pendingChecks = checks.filter((check) => check.status !== "verified");
  const openP0Incidents = incidents.filter((incident) => incident.severity === "p0" && incident.status !== "resolved");

  if (openP0Incidents.length > 0) {
    return {
      label: "runtime data",
      path: filePath,
      status: "blocked",
      message: "해결되지 않은 P0 파일럿 이슈가 있습니다.",
      runtime: metadata,
      counts: {
        readinessChecks: checks.length,
        pendingReadinessChecks: pendingChecks.length,
        openP0Incidents: openP0Incidents.length,
        operationLogs: operations.length,
      },
    };
  }

  if (checks.length === 0 || pendingChecks.length > 0) {
    return {
      label: "runtime data",
      path: filePath,
      status: "waiting",
      message: "파일럿 준비 항목의 담당자/상태/증빙을 더 채워야 합니다.",
      runtime: metadata,
      counts: {
        readinessChecks: checks.length,
        pendingReadinessChecks: pendingChecks.length,
        openP0Incidents: openP0Incidents.length,
        operationLogs: operations.length,
      },
    };
  }

  return {
    label: "runtime data",
    path: filePath,
    status: "ready",
    message: "파일럿 준비 항목이 모두 확인 상태입니다.",
    runtime: metadata,
    counts: {
      readinessChecks: checks.length,
      pendingReadinessChecks: 0,
      openP0Incidents: 0,
      operationLogs: operations.length,
    },
  };
}

function parsePasswordRotationOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function parseReadinessEvidenceOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function passwordRotationRuntimeArgs() {
  if (runtimeDriver === "postgres") {
    return [
      "--driver=postgres",
      `--state-key=${postgresStateKey}`,
      `--table=${postgresTable}`,
      ...(postgresUrl ? [`--postgres-url=${postgresUrl}`] : []),
    ];
  }

  return [`--runtime=${paths.db}`];
}

async function classifyReadinessEvidence(filePath, readResult) {
  if (!readResult.exists) {
    return {
      label: "pre-pilot readiness evidence",
      path: filePath,
      status: "missing",
      message: "파일럿 준비 증빙 CSV가 아직 없습니다.",
    };
  }

  const commandArgs = [
    "--experimental-transform-types",
    "--disable-warning=ExperimentalWarning",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "scripts/check-pilot-readiness-evidence.mjs",
    `--file=${filePath}`,
    "--phase=pre-pilot",
  ];

  try {
    const result = await execFile(process.execPath, commandArgs, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    const parsed = parseReadinessEvidenceOutput(result.stdout);

    if (!parsed?.ok) {
      return {
        label: "pre-pilot readiness evidence",
        path: filePath,
        status: "blocked",
        message: "파일럿 준비 증빙 CSV가 ready 상태가 아닙니다.",
        result: parsed,
        blockerCodes: parsed?.blockers?.map((blocker) => blocker.code).filter(Boolean) ?? [],
      };
    }

    return {
      label: "pre-pilot readiness evidence",
      path: filePath,
      status: "ready",
      message: "파일럿 준비 증빙 CSV가 ready 상태입니다.",
      phase: parsed.phase,
      statusCounts: parsed.statusCounts,
      requiredIds: parsed.requiredIds,
      checked: parsed.checked,
    };
  } catch (error) {
    const parsed = parseReadinessEvidenceOutput(error.stdout ?? "");
    const blockerCodes = parsed?.blockers?.map((blocker) => blocker.code).filter(Boolean) ?? [];

    return {
      label: "pre-pilot readiness evidence",
      path: filePath,
      status: "blocked",
      message: "파일럿 준비 증빙 CSV 검증이 실패했습니다.",
      result: parsed,
      blockerCodes,
      error: {
        exitCode: error.code ?? null,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      },
    };
  }
}

async function classifyPasswordRotation(filePath, readResult) {
  if (!readResult.exists) {
    return {
      label: "password rotation evidence",
      path: filePath,
      status: "missing",
      message: "계정별 비밀번호 교체 CSV가 아직 없습니다.",
    };
  }

  const commandArgs = [
    "--experimental-transform-types",
    "--disable-warning=ExperimentalWarning",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "scripts/check-pilot-password-rotation.mjs",
    ...passwordRotationRuntimeArgs(),
    `--file=${filePath}`,
  ];

  try {
    const result = await execFile(process.execPath, commandArgs, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    const parsed = parsePasswordRotationOutput(result.stdout);

    if (!parsed?.ok) {
      return {
        label: "password rotation evidence",
        path: filePath,
        status: "blocked",
        message: "계정별 비밀번호 교체 CSV가 ready 상태가 아닙니다.",
        result: parsed,
        blockerCodes: parsed?.blockers?.map((blocker) => blocker.code).filter(Boolean) ?? [],
      };
    }

    return {
      label: "password rotation evidence",
      path: filePath,
      status: "ready",
      message: "계정별 비밀번호 교체 CSV가 ready 상태입니다.",
      users: parsed.users,
      statusCounts: parsed.statusCounts,
      checked: parsed.checked,
    };
  } catch (error) {
    const parsed = parsePasswordRotationOutput(error.stdout ?? "");
    const blockerCodes = parsed?.blockers?.map((blocker) => blocker.code).filter(Boolean) ?? [];

    return {
      label: "password rotation evidence",
      path: filePath,
      status: "blocked",
      message: "계정별 비밀번호 교체 CSV 검증이 실패했습니다.",
      result: parsed,
      blockerCodes,
      error: {
        exitCode: error.code ?? null,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      },
    };
  }
}

function fieldEvidenceReady(document) {
  return document?.version === 1 && Boolean(text(document?.pilot?.signedOffBy)) && parseDateTime(document?.pilot?.signedOffAt);
}

function artifactManifestReady(document) {
  if (!readyDocument(document)) {
    return false;
  }

  return requiredArtifactKeys.every((key) => Boolean(document.artifacts?.[key]?.sha256));
}

function archiveManifestReady(document) {
  if (!readyDocument(document)) {
    return false;
  }

  return requiredArtifactKeys.every((key) => Boolean(document.artifacts?.[key]?.archivedPath));
}

function storageReceiptReady(document) {
  return (
    document?.version === 1 &&
    Boolean(text(document?.uploadedAt)) &&
    Boolean(text(document?.uploadedBy)) &&
    Boolean(text(document?.storageProvider)) &&
    Boolean(text(document?.storageLocation)) &&
    Number(document?.retentionPolicy?.minimumRetentionDays) >= 365 &&
    Array.isArray(document?.uploadedArtifacts) &&
    document.uploadedArtifacts.length >= requiredArtifactKeys.length + 1
  );
}

function samePath(left, right) {
  return path.resolve(text(left)) === path.resolve(text(right));
}

function handoffOutputMatchesValidation(document, validation) {
  const current = validation?.result;
  if (!readyDocument(document) || validation?.status !== "ready" || !current) {
    return false;
  }

  return (
    samePath(document.artifacts?.artifactManifest?.path, current.artifacts?.artifactManifest?.path) &&
    samePath(document.artifacts?.archiveManifest?.path, current.artifacts?.archiveManifest?.path) &&
    text(document.artifacts?.artifactManifest?.sha256) === text(current.artifacts?.artifactManifest?.sha256) &&
    text(document.artifacts?.archiveManifest?.sha256) === text(current.artifacts?.archiveManifest?.sha256) &&
    Number(document.artifacts?.artifactManifest?.sizeBytes) === Number(current.artifacts?.artifactManifest?.sizeBytes) &&
    Number(document.artifacts?.archiveManifest?.sizeBytes) === Number(current.artifacts?.archiveManifest?.sizeBytes) &&
    document.storageReceiptValidation?.ok === true
  );
}

async function validateFinalHandoffNow(artifacts) {
  const requiredInputs = ["artifactManifest", "archiveManifest", "storageReceipt"];
  const waitingOn = requiredInputs.filter((key) => artifacts[key]?.status !== "ready");

  if (waitingOn.length > 0) {
    return {
      label: "strict final handoff validation",
      path: paths.finalHandoff,
      status: "waiting",
      message: "artifact manifest, archive manifest, storage receipt가 ready일 때 최종 handoff 검증을 실행합니다.",
      waitingOn,
    };
  }

  try {
    const result = await execFile(
      process.execPath,
      [
        "scripts/check-pilot-final-handoff.mjs",
        `--artifact-manifest=${paths.artifactManifest}`,
        `--archive-manifest=${paths.archiveManifest}`,
        `--storage-receipt=${paths.storageReceipt}`,
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024,
      },
    );
    const parsed = JSON.parse(result.stdout);

    if (parsed.ok !== true || parsed.releaseDecision !== "ready" || parsed.blockers?.length > 0) {
      return {
        label: "strict final handoff validation",
        path: paths.finalHandoff,
        status: "blocked",
        message: "현재 artifact/archive/storage receipt 입력으로 final handoff 검증이 ready가 아닙니다.",
        result: parsed,
      };
    }

    return {
      label: "strict final handoff validation",
      path: paths.finalHandoff,
      status: "ready",
      message: "현재 artifact/archive/storage receipt 입력으로 final handoff 검증을 재실행했습니다.",
      generatedAt: parsed.generatedAt ?? null,
      result: parsed,
    };
  } catch (error) {
    let parsed = null;
    try {
      parsed = JSON.parse(error.stdout ?? "{}");
    } catch {
      parsed = null;
    }

    return {
      label: "strict final handoff validation",
      path: paths.finalHandoff,
      status: "blocked",
      message: "현재 artifact/archive/storage receipt 입력으로 final handoff 검증이 실패했습니다.",
      result: parsed,
      error: {
        exitCode: error.code ?? null,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      },
    };
  }
}

function prelaunchDraftCommand() {
  if (runtimeDriver === "postgres") {
    return "npm run pilot:prelaunch-draft -- --out-dir=.data --driver=postgres --state-key=<key> --postgres-url=<url>";
  }

  return "npm run pilot:prelaunch-draft -- --out-dir=.data";
}

function nextActionFor(artifactKey, artifact) {
  if (artifactKey === "runtime") {
    if (artifact.status === "missing") {
      if (runtimeDriver === "postgres") {
        return "파일럿 CSV import 또는 운영 seed로 PostgreSQL 런타임 DB row를 만든다. 예: npm run pilot:import:postgres -- docs/pilot-templates/pilot-data-intake.csv";
      }

      return "파일럿 CSV import 또는 데모 seed로 런타임 DB를 만든다.";
    }
    return `${prelaunchDraftCommand()}로 준비 증빙 CSV, 계정별 비밀번호 교체 CSV, audit launch package, pre-pilot evidence/preflight/status 초안을 만든 뒤 pilot:readiness-evidence/check/apply 또는 /app/admin/settings에서 파일럿 준비 항목 상태/담당자/증빙과 P0 이슈를 정리한다.`;
  }

  const passwordRotationCommand =
    runtimeDriver === "postgres"
      ? "npm run pilot:password-rotation:draft -- --driver=postgres --state-key=<key> --postgres-url=<url> --out=.data/pilot-password-rotation.csv로 CSV 초안을 만든 뒤 /app/admin/users 감사 로그와 전달 채널 증빙을 채우고 npm run pilot:password-rotation -- --driver=postgres --state-key=<key> --postgres-url=<url> --file=.data/pilot-password-rotation.csv 실행"
      : "npm run pilot:password-rotation:draft -- --runtime=.data/final-judo-db.json --out=.data/pilot-password-rotation.csv로 CSV 초안을 만든 뒤 /app/admin/users 감사 로그와 전달 채널 증빙을 채우고 npm run pilot:password-rotation -- --runtime=.data/final-judo-db.json --file=.data/pilot-password-rotation.csv 실행";

  const actions = {
    preflightPre: "실제 파일럿 데이터 반영 후 NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json 실행",
    evidencePre: "npm run pilot:evidence -- --out=.data/pilot-evidence.json 실행",
    prePilotMarkdown: "npm run pilot:evidence -- --format=markdown --out=.data/pilot-evidence.pre-pilot.md 실행",
    readinessEvidence:
      `${prelaunchDraftCommand()} 또는 npm run pilot:readiness-evidence:draft -- --phase=pre-pilot --out=.data/pilot-readiness-evidence.csv로 CSV 초안을 만든 뒤 owner/status/evidence를 채우고 npm run pilot:readiness-evidence -- --file=.data/pilot-readiness-evidence.csv --phase=pre-pilot 실행`,
    passwordRotation: passwordRotationCommand,
    launchPackage:
      "npm run pilot:launch-package -- --csv=docs/pilot-templates/pilot-data-intake.csv --readiness-evidence=.data/pilot-readiness-evidence.csv --password-rotation=.data/pilot-password-rotation.csv --out=.data/pilot-launch-package.json 실행",
    preflightPost: "파일럿 2주 운영 후 NODE_ENV=production npm run preflight:pilot -- --require-retro --out=.data/pilot-preflight.post-pilot.json 실행",
    evidencePost: "npm run pilot:evidence -- --require-retro --out=.data/pilot-evidence.post-pilot.json 실행",
    field: "pilot:field-evidence:draft로 source CSV/리포트 기반 초안을 만든 뒤 현장 증빙을 채우고 pilot:field-evidence 실행",
    closeout: "npm run pilot:closeout-package로 post-pilot 산출물을 ready 판단 패키지로 묶는다.",
    artifactManifest: "npm run pilot:artifact-manifest로 업로드 대상 산출물의 SHA-256 manifest를 만든다.",
    archiveManifest: "npm run pilot:archive-artifacts로 fresh archive 폴더와 archive manifest를 만든다.",
    storageReceipt:
      "pilot:storage-receipt:draft로 archive manifest 기반 receipt 초안을 만든 뒤 장기 보관소 업로드 위치/증빙을 채우고 pilot:storage-receipt를 실행한다.",
    finalHandoff: "npm run pilot:final-handoff로 최종 인수인계 JSON을 만든다.",
  };

  return actions[artifactKey];
}

async function main() {
  const [
    runtimeRead,
    preflightPreRead,
    evidencePreRead,
    prePilotMarkdownRead,
    readinessEvidenceRead,
    launchPackageRead,
    passwordRotationRead,
    preflightPostRead,
    evidencePostRead,
    fieldRead,
    closeoutRead,
    artifactManifestRead,
    archiveManifestRead,
    storageReceiptRead,
    finalHandoffRead,
  ] = await Promise.all([
    readRuntime(),
    readJson(paths.preflightPre),
    readJson(paths.evidencePre),
    readText(paths.prePilotMarkdown),
    readText(paths.readinessEvidence),
    readJson(paths.launchPackage),
    readText(paths.passwordRotation),
    readJson(paths.preflightPost),
    readJson(paths.evidencePost),
    readJson(paths.field),
    readJson(paths.closeout),
    readJson(paths.artifactManifest),
    readJson(paths.archiveManifest),
    readJson(paths.storageReceipt),
    readJson(paths.finalHandoff),
  ]);

  const readinessEvidenceArtifact = await classifyReadinessEvidence(paths.readinessEvidence, readinessEvidenceRead);
  const passwordRotationArtifact = await classifyPasswordRotation(paths.passwordRotation, passwordRotationRead);
  const artifacts = {
    runtime: classifyRuntime(runtimePathLabel(), runtimeRead),
    preflightPre: classify("pre-pilot preflight", paths.preflightPre, preflightPreRead, (document) => readyPreflight(document), "pre-pilot strict preflight가 ready 상태가 아닙니다."),
    evidencePre: classify("pre-pilot evidence", paths.evidencePre, evidencePreRead, (document) => readyEvidence(document, "pre-pilot"), "pre-pilot evidence가 ready 상태가 아닙니다."),
    prePilotMarkdown: classifyText("pre-pilot evidence Markdown", paths.prePilotMarkdown, prePilotMarkdownRead, readyPrePilotMarkdown, "pre-pilot Markdown evidence가 ready 상태가 아닙니다."),
    readinessEvidence: readinessEvidenceArtifact,
    passwordRotation: passwordRotationArtifact,
    launchPackage: classify("pre-pilot launch package", paths.launchPackage, launchPackageRead, readyLaunchPackage, "pre-pilot launch package가 strict ready 상태가 아닙니다."),
    preflightPost: classify("post-pilot preflight", paths.preflightPost, preflightPostRead, (document) => readyPreflight(document, true), "post-pilot strict preflight가 14일 운영/모바일 출석 증빙까지 ready 상태가 아닙니다."),
    evidencePost: classify("post-pilot evidence", paths.evidencePost, evidencePostRead, (document) => readyEvidence(document, "post-pilot"), "post-pilot evidence가 14일 운영 ready 상태가 아닙니다."),
    field: classify("field evidence", paths.field, fieldRead, fieldEvidenceReady, "현장 증빙 manifest에 총괄 signoff 또는 필수 버전 정보가 부족합니다."),
    closeout: classify("closeout package", paths.closeout, closeoutRead, readyDocument, "closeout package가 ready 상태가 아닙니다."),
    artifactManifest: classify("artifact manifest", paths.artifactManifest, artifactManifestRead, artifactManifestReady, "artifact manifest가 ready 상태이거나 필수 산출물 해시를 모두 포함하지 않습니다."),
    archiveManifest: classify("archive manifest", paths.archiveManifest, archiveManifestRead, archiveManifestReady, "archive manifest가 ready 상태이거나 필수 archive 경로를 모두 포함하지 않습니다."),
    storageReceipt: classify("storage receipt", paths.storageReceipt, storageReceiptRead, storageReceiptReady, "장기 보관 receipt가 필수 업로드/보존 정보를 모두 포함하지 않습니다."),
    finalHandoff: classify("final handoff", paths.finalHandoff, finalHandoffRead, readyDocument, "final handoff가 ready 상태가 아닙니다."),
  };

  if (strict) {
    artifacts.strictFinalHandoffValidation = await validateFinalHandoffNow(artifacts);
    if (artifacts.finalHandoff.status === "ready" && !handoffOutputMatchesValidation(finalHandoffRead.json, artifacts.strictFinalHandoffValidation)) {
      artifacts.finalHandoff = {
        ...artifacts.finalHandoff,
        status: "blocked",
        message: "저장된 final handoff JSON이 현재 artifact/archive/storage receipt 검증 결과와 일치하지 않습니다. pilot:final-handoff를 다시 실행해 주세요.",
      };
    }
  }

  const order = [
    "runtime",
    "preflightPre",
    "evidencePre",
    "prePilotMarkdown",
    "readinessEvidence",
    "passwordRotation",
    "launchPackage",
    "preflightPost",
    "evidencePost",
    "field",
    "closeout",
    "artifactManifest",
    "archiveManifest",
    "storageReceipt",
    ...(strict ? ["strictFinalHandoffValidation"] : []),
    "finalHandoff",
  ];
  const firstIncompleteKey = order.find((key) => artifacts[key].status !== "ready");
  const ready = !firstIncompleteKey;
  const incomplete = order
    .filter((key) => artifacts[key].status !== "ready")
    .map((key) => ({
      code: `PILOT_STATUS_${key.toUpperCase()}_NOT_READY`,
      status: artifacts[key].status,
      label: artifacts[key].label,
      message: artifacts[key].message,
      path: artifacts[key].path,
    }));

  const report = {
    ok: ready,
    generatedAt: new Date().toISOString(),
    releaseDecision: ready ? "ready" : "blocked",
    phase: ready ? "final-handoff-ready" : firstIncompleteKey,
    nextAction: ready ? "최종 파일럿 handoff ready. 외부 제출/운영 승인 기록으로 마감한다." : nextActionFor(firstIncompleteKey, artifacts[firstIncompleteKey]),
    artifacts,
    blockers: incomplete,
    checked: [
      "runtime pilot readiness summary",
      `runtime source driver: ${runtimeDriver}`,
      "pre-pilot strict preflight artifact status",
      "pre-pilot evidence status",
      "pre-pilot Markdown evidence status",
      "pre-pilot readiness evidence status",
      "password rotation evidence status",
      "pre-pilot launch package status",
      "post-pilot strict preflight artifact status",
      "post-pilot evidence status",
      "field evidence manifest status",
      "closeout package status",
      "artifact manifest status",
      "archive manifest status",
      "storage receipt status",
      "non-ready artifact blocker coverage",
      ...(strict ? ["strict final handoff validator rerun", "stored final handoff digest match"] : []),
      "final handoff status",
    ],
  };

  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;

  if (outFile) {
    const outPath = path.resolve(outFile);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, serializedReport, "utf8");
  }

  process.stdout.write(serializedReport);

  if (strict && !ready) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
