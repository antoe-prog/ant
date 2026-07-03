import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { defaultPilotDataFile } from "./pilot-data-utils.mjs";

const execFile = promisify(execFileCallback);
const transformArgs = ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const explicitCsv = args.find((arg) => arg.startsWith("--csv="))?.slice("--csv=".length);
const positionalCsv = args.find((arg) => !arg.startsWith("--"));
const explicitOut = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
const explicitEvidenceOut = args.find((arg) => arg.startsWith("--evidence-out="))?.slice("--evidence-out=".length);
const explicitEvidenceMarkdown = args.find((arg) => arg.startsWith("--evidence-markdown="))?.slice("--evidence-markdown=".length);
const explicitPreflightOut = args.find((arg) => arg.startsWith("--preflight-out="))?.slice("--preflight-out=".length);
const explicitReadinessEvidence = args.find((arg) => arg.startsWith("--readiness-evidence="))?.slice("--readiness-evidence=".length);
const explicitPasswordRotation = args.find((arg) => arg.startsWith("--password-rotation="))?.slice("--password-rotation=".length);
const explicitDriver = args.find((arg) => arg.startsWith("--driver="))?.slice("--driver=".length);
const explicitRuntimeFile = args.find((arg) => arg.startsWith("--runtime-file="))?.slice("--runtime-file=".length);
const explicitPostgresUrl = args.find((arg) => arg.startsWith("--postgres-url="))?.slice("--postgres-url=".length);
const explicitStateKey = args.find((arg) => arg.startsWith("--state-key="))?.slice("--state-key=".length);
const explicitTable = args.find((arg) => arg.startsWith("--table="))?.slice("--table=".length);
const csvPath = path.resolve(explicitCsv ?? positionalCsv ?? process.env.PILOT_DATA_FILE ?? defaultPilotDataFile);
const outPath = path.resolve(explicitOut ?? ".data/pilot-launch-package.json");
const evidenceOutPath = path.resolve(explicitEvidenceOut ?? ".data/pilot-evidence.json");
const evidenceMarkdownPath = path.resolve(explicitEvidenceMarkdown ?? ".data/pilot-evidence.pre-pilot.md");
const preflightOutPath = path.resolve(explicitPreflightOut ?? ".data/pilot-preflight.pre-pilot.json");
const readinessEvidencePath = path.resolve(explicitReadinessEvidence ?? ".data/pilot-readiness-evidence.csv");
const passwordRotationPath = path.resolve(explicitPasswordRotation ?? ".data/pilot-password-rotation.csv");
const runtimeDriver = explicitDriver ?? process.env.FINAL_JUDO_DB_DRIVER ?? "json";
const runtimePostgresUrl = explicitPostgresUrl ?? process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL ?? "";
const runtimeStateKey = explicitStateKey ?? process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp";
const runtimeTable = explicitTable ?? process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state";

if (explicitDriver && explicitDriver !== "json" && explicitDriver !== "postgres") {
  throw new Error(`Unsupported launch package driver: ${explicitDriver}`);
}

function relativeOrAbsolute(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath) ? relativePath : filePath;
}

function redactConnectionString(value) {
  const connectionString = typeof value === "string" ? value.trim() : "";

  if (!connectionString) {
    return "";
  }

  try {
    const url = new URL(connectionString);

    if (url.password) {
      url.password = "REDACTED";
    }

    return url.toString();
  } catch {
    return "<redacted-postgres-url>";
  }
}

function displayArg(arg) {
  if (arg.startsWith("--postgres-url=")) {
    return `--postgres-url=${redactConnectionString(arg.slice("--postgres-url=".length))}`;
  }

  for (const key of [
    "--csv",
    "--evidence-markdown",
    "--evidence-out",
    "--file",
    "--out",
    "--password-rotation",
    "--preflight-out",
    "--readiness-evidence",
    "--runtime",
    "--runtime-file",
  ]) {
    if (arg.startsWith(`${key}=`)) {
      return `${key}=${relativeOrAbsolute(path.resolve(arg.slice(key.length + 1)))}`;
    }
  }

  return path.isAbsolute(arg) ? relativeOrAbsolute(arg) : arg;
}

function displayArgs(args) {
  return args.map(displayArg).join(" ");
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`${label} did not emit parseable JSON: ${error.message}`);
  }
}

function buildRuntimeArgs() {
  return [
    ...(explicitDriver ? [`--driver=${explicitDriver}`] : []),
    ...(explicitRuntimeFile ? [`--file=${explicitRuntimeFile}`] : []),
    ...(explicitPostgresUrl ? [`--postgres-url=${explicitPostgresUrl}`] : []),
    ...(explicitStateKey ? [`--state-key=${explicitStateKey}`] : []),
    ...(explicitTable ? [`--table=${explicitTable}`] : []),
  ];
}

function buildImportArgs() {
  return [
    ...(explicitDriver ? [`--driver=${explicitDriver}`] : []),
    ...(explicitPostgresUrl ? [`--postgres-url=${explicitPostgresUrl}`] : []),
    ...(explicitStateKey ? [`--state-key=${explicitStateKey}`] : []),
    ...(explicitTable ? [`--table=${explicitTable}`] : []),
    csvPath,
  ];
}

function buildPasswordRotationArgs() {
  return [
    `--file=${passwordRotationPath}`,
    ...(explicitDriver ? [`--driver=${explicitDriver}`] : []),
    ...(explicitRuntimeFile ? [`--runtime=${explicitRuntimeFile}`] : []),
    ...(explicitPostgresUrl ? [`--postgres-url=${explicitPostgresUrl}`] : []),
    ...(explicitStateKey ? [`--state-key=${explicitStateKey}`] : []),
    ...(explicitTable ? [`--table=${explicitTable}`] : []),
  ];
}

function buildReadinessEvidenceArgs() {
  return [`--file=${readinessEvidencePath}`, "--phase=pre-pilot"];
}

function buildLaunchPackageArgs() {
  return [
    `--csv=${csvPath}`,
    `--readiness-evidence=${readinessEvidencePath}`,
    `--password-rotation=${passwordRotationPath}`,
    `--out=${outPath}`,
    `--evidence-out=${evidenceOutPath}`,
    `--evidence-markdown=${evidenceMarkdownPath}`,
    `--preflight-out=${preflightOutPath}`,
    ...(explicitDriver ? [`--driver=${explicitDriver}`] : []),
    ...(explicitRuntimeFile ? [`--runtime-file=${explicitRuntimeFile}`] : []),
    ...(explicitPostgresUrl ? [`--postgres-url=${explicitPostgresUrl}`] : []),
    ...(explicitStateKey ? [`--state-key=${explicitStateKey}`] : []),
    ...(explicitTable ? [`--table=${explicitTable}`] : []),
    ...(allowIncomplete ? ["--allow-incomplete"] : []),
  ];
}

function buildRuntimeReport() {
  return {
    driver: runtimeDriver,
    ...(runtimeDriver === "postgres"
      ? {
          stateKey: runtimeStateKey,
          table: runtimeTable,
          ...(runtimePostgresUrl ? { connectionString: redactConnectionString(runtimePostgresUrl) } : {}),
        }
      : {}),
    ...(runtimeDriver !== "postgres" && explicitRuntimeFile ? { file: path.resolve(explicitRuntimeFile) } : {}),
  };
}

function redactSerializedPackage(serializedPackage) {
  return [explicitPostgresUrl, process.env.FINAL_JUDO_POSTGRES_URL, process.env.DATABASE_URL]
    .filter((value) => typeof value === "string" && value.trim())
    .reduce((content, secret) => content.split(secret).join(redactConnectionString(secret)), serializedPackage);
}

async function runNode(args, label, options = {}) {
  try {
    const result = await execFile(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: options.nodeEnv ?? process.env.NODE_ENV,
      },
      maxBuffer: 1024 * 1024 * 5,
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    if (options.allowFailure) {
      return {
        ok: false,
        exitCode: typeof error.code === "number" ? error.code : 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
      };
    }

    throw new Error(`${label} failed: ${error.stderr || error.message}`);
  }
}

async function readJsonFile(filePath, label) {
  return parseJson(await readFile(filePath, "utf8"), label);
}

async function main() {
  await Promise.all([
    mkdir(path.dirname(outPath), { recursive: true }),
    mkdir(path.dirname(evidenceOutPath), { recursive: true }),
    mkdir(path.dirname(evidenceMarkdownPath), { recursive: true }),
    mkdir(path.dirname(preflightOutPath), { recursive: true }),
  ]);

  const runtimeArgs = buildRuntimeArgs();
  const importArgs = buildImportArgs();
  const readinessEvidenceArgs = buildReadinessEvidenceArgs();
  const passwordRotationArgs = buildPasswordRotationArgs();
  const launchPackageArgs = buildLaunchPackageArgs();
  const commands = {
    csvValidation: `npm run test:pilot -- ${relativeOrAbsolute(csvPath)}`,
    importDryRun: `npm run test:pilot-import -- ${displayArgs(importArgs)}`,
    readinessEvidence: `npm run pilot:readiness-evidence -- ${displayArgs(readinessEvidenceArgs)}`,
    passwordRotation: `npm run pilot:password-rotation -- ${displayArgs(passwordRotationArgs)}`,
    evidenceJson: `npm run pilot:evidence -- ${displayArgs([...runtimeArgs, `--out=${evidenceOutPath}`])}`,
    evidenceMarkdown: `npm run pilot:evidence -- ${displayArgs([...runtimeArgs, "--format=markdown", `--out=${evidenceMarkdownPath}`])}`,
    preflightPre: `NODE_ENV=production npm run preflight:pilot -- ${displayArgs([...runtimeArgs, ...(allowIncomplete ? ["--allow-incomplete"] : []), `--out=${preflightOutPath}`])}`,
    launchPackage: `npm run pilot:launch-package -- ${displayArgs(launchPackageArgs)}`,
  };

  const csvValidation = parseJson((await runNode(["scripts/check-pilot-readiness.mjs", csvPath], "pilot CSV validation")).stdout, "pilot CSV validation");
  const importDryRun = parseJson((await runNode([...transformArgs, "scripts/import-pilot-data.mjs", ...importArgs], "pilot import dry-run")).stdout, "pilot import dry-run");
  const readinessEvidenceResult = await runNode(
    [...transformArgs, "scripts/check-pilot-readiness-evidence.mjs", ...readinessEvidenceArgs],
    "pre-pilot readiness evidence",
    { allowFailure: true, nodeEnv: "production" },
  );
  const readinessEvidence = readinessEvidenceResult.stdout.trim()
    ? parseJson(readinessEvidenceResult.stdout, "pre-pilot readiness evidence")
    : {
        ok: false,
        file: readinessEvidencePath,
        blockers: [
          {
            code: "READINESS_EVIDENCE_CHECK_FAILED",
            message: "pre-pilot readiness evidence check did not emit JSON.",
            detail: {
              exitCode: readinessEvidenceResult.exitCode,
              stderr: readinessEvidenceResult.stderr,
            },
          },
        ],
        checked: [],
      };
  const passwordRotationResult = await runNode(
    [...transformArgs, "scripts/check-pilot-password-rotation.mjs", ...passwordRotationArgs],
    "password rotation evidence",
    { allowFailure: true, nodeEnv: "production" },
  );
  const passwordRotation = passwordRotationResult.stdout.trim()
    ? parseJson(passwordRotationResult.stdout, "password rotation evidence")
    : {
        ok: false,
        file: passwordRotationPath,
        blockers: [
          {
            code: "PASSWORD_ROTATION_CHECK_FAILED",
            message: "password rotation evidence check did not emit JSON.",
            detail: {
              exitCode: passwordRotationResult.exitCode,
              stderr: passwordRotationResult.stderr,
            },
          },
        ],
        checked: [],
      };
  const evidenceJson = parseJson(
    (await runNode([...transformArgs, "scripts/export-pilot-evidence.mjs", ...runtimeArgs, `--out=${evidenceOutPath}`], "pre-pilot evidence JSON", { nodeEnv: "production" })).stdout,
    "pre-pilot evidence JSON",
  );
  await runNode([...transformArgs, "scripts/export-pilot-evidence.mjs", ...runtimeArgs, "--format=markdown", `--out=${evidenceMarkdownPath}`], "pre-pilot evidence Markdown", {
    nodeEnv: "production",
  });
  const evidenceMarkdown = await readFile(evidenceMarkdownPath, "utf8");
  const preflightResult = await runNode(
    [...transformArgs, "scripts/check-production-preflight.mjs", ...runtimeArgs, ...(allowIncomplete ? ["--allow-incomplete"] : []), `--out=${preflightOutPath}`],
    "pre-pilot production preflight",
    { allowFailure: true, nodeEnv: "production" },
  );
  const preflight = preflightResult.stdout.trim() ? parseJson(preflightResult.stdout, "pre-pilot preflight") : await readJsonFile(preflightOutPath, "written pre-pilot preflight");
  const writtenPreflight = await readJsonFile(preflightOutPath, "written pre-pilot preflight");
  const writtenEvidence = await readJsonFile(evidenceOutPath, "written pre-pilot evidence JSON");
  const releaseDecision = preflight.ok && evidenceJson.releaseDecision !== "blocked" && readinessEvidence.ok && passwordRotation.ok ? evidenceJson.releaseDecision : "blocked";
  const ok = releaseDecision === "ready";
  const readinessEvidenceBlockers = Array.isArray(readinessEvidence.blockers) ? readinessEvidence.blockers : [];
  const passwordRotationBlockers = Array.isArray(passwordRotation.blockers) ? passwordRotation.blockers : [];
  const packageJson = {
    ok,
    generatedAt: new Date().toISOString(),
    mode: allowIncomplete ? "audit" : "strict",
    releaseDecision,
    runtime: buildRuntimeReport(),
    csv: {
      file: csvPath,
      validation: {
        ok: csvValidation.ok,
        rows: csvValidation.rows,
        warnings: csvValidation.warnings,
      },
      importDryRun: {
        ok: importDryRun.ok,
        mode: importDryRun.mode,
        driver: importDryRun.driver,
        counts: importDryRun.counts,
        warnings: importDryRun.warnings,
      },
      readinessEvidence: {
        ok: readinessEvidence.ok === true,
        file: readinessEvidencePath,
        phase: readinessEvidence.phase ?? "pre-pilot",
        statusCounts: readinessEvidence.statusCounts ?? {},
        blockerCodes: readinessEvidenceBlockers.map((issue) => issue.code),
      },
    },
    security: {
      passwordRotation: {
        ok: passwordRotation.ok === true,
        file: passwordRotationPath,
        users: passwordRotation.users ?? 0,
        statusCounts: passwordRotation.statusCounts ?? {},
        blockerCodes: passwordRotationBlockers.map((issue) => issue.code),
      },
    },
    artifacts: {
      preflightPre: {
        path: preflightOutPath,
        ok: writtenPreflight.ok,
        mode: writtenPreflight.mode,
        blockerCodes: writtenPreflight.blockers.map((issue) => issue.code),
        warningCodes: writtenPreflight.warnings.map((issue) => issue.code),
      },
      evidencePre: {
        path: evidenceOutPath,
        mode: writtenEvidence.mode,
        releaseDecision: writtenEvidence.releaseDecision,
        blockerCodes: writtenEvidence.preflight.blockerCodes,
        warningCodes: writtenEvidence.preflight.warningCodes,
      },
      evidenceMarkdown: {
        path: evidenceMarkdownPath,
        bytes: Buffer.byteLength(evidenceMarkdown, "utf8"),
        includesReadiness: evidenceMarkdown.includes("## Readiness"),
        includesOperations: evidenceMarkdown.includes("## Operations"),
      },
      readinessEvidence: {
        path: readinessEvidencePath,
        ok: readinessEvidence.ok === true,
        phase: readinessEvidence.phase ?? "pre-pilot",
        statusCounts: readinessEvidence.statusCounts ?? {},
        blockerCodes: readinessEvidenceBlockers.map((issue) => issue.code),
      },
      passwordRotation: {
        path: passwordRotationPath,
        ok: passwordRotation.ok === true,
        users: passwordRotation.users ?? 0,
        statusCounts: passwordRotation.statusCounts ?? {},
        blockerCodes: passwordRotationBlockers.map((issue) => issue.code),
      },
      launchPackage: {
        path: outPath,
      },
    },
    commands,
    blockers: [...writtenPreflight.blockers, ...readinessEvidenceBlockers, ...passwordRotationBlockers],
    warnings: writtenPreflight.warnings,
    checked: [
      "pilot CSV validation",
      "pilot import dry-run without runtime writes",
      "pre-pilot readiness evidence CSV",
      "account password rotation evidence CSV",
      "pre-pilot evidence JSON artifact",
      "pre-pilot evidence Markdown artifact",
      "production pre-pilot preflight artifact",
      "launch package JSON artifact",
    ],
  };

  const serializedPackage = redactSerializedPackage(`${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(outPath, serializedPackage, "utf8");
  process.stdout.write(serializedPackage);

  if (!ok && !allowIncomplete) {
    process.exit(1);
  }
}

await main();
