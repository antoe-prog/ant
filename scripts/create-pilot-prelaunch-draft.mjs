import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { defaultPilotDataFile } from "./pilot-data-utils.mjs";

const execFile = promisify(execFileCallback);
const transformArgs = ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
const args = process.argv.slice(2);
const generatedAt = new Date().toISOString();

function argValue(name, fallback = null) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
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
    "--archive-manifest",
    "--artifact-manifest",
    "--closeout",
    "--csv",
    "--db",
    "--evidence-markdown",
    "--evidence-out",
    "--evidence-post",
    "--evidence-pre",
    "--evidence-pre-markdown",
    "--field",
    "--file",
    "--final-handoff",
    "--launch-package",
    "--out",
    "--password-rotation",
    "--preflight-out",
    "--preflight-post",
    "--preflight-pre",
    "--readiness-evidence",
    "--runtime",
    "--runtime-file",
    "--storage-receipt",
  ]) {
    if (arg.startsWith(`${key}=`)) {
      return `${key}=${relativeOrAbsolute(path.resolve(arg.slice(key.length + 1)))}`;
    }
  }

  return path.isAbsolute(arg) ? relativeOrAbsolute(arg) : arg;
}

function displayArgs(commandArgs) {
  return commandArgs.map(displayArg).join(" ");
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`${label} did not emit parseable JSON: ${error.message}`);
  }
}

async function runNode(script, commandArgs, label, { allowFailure = false, nodeEnv = process.env.NODE_ENV } = {}) {
  try {
    const result = await execFile(process.execPath, [...transformArgs, script, ...commandArgs], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: nodeEnv,
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
    if (allowFailure) {
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

async function fileSummary(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return {
      path: filePath,
      exists: true,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      bytes: 0,
    };
  }
}

const outDir = path.resolve(argValue("--out-dir", ".data"));
const csvPath = path.resolve(argValue("--csv", process.env.PILOT_DATA_FILE ?? defaultPilotDataFile));
const runtimePath = path.resolve(argValue("--runtime", ".data/final-judo-db.json"));
const driver = argValue("--driver", process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");
const postgresUrl = argValue("--postgres-url", process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL ?? "");
const stateKey = argValue("--state-key", process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp");
const table = argValue("--table", process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state");

if (driver !== "json" && driver !== "postgres") {
  throw new Error("--driver must be json or postgres.");
}

const paths = {
  readinessEvidence: path.resolve(argValue("--readiness-evidence", path.join(outDir, "pilot-readiness-evidence.csv"))),
  passwordRotation: path.resolve(argValue("--password-rotation", path.join(outDir, "pilot-password-rotation.csv"))),
  launchPackage: path.resolve(argValue("--launch-package", path.join(outDir, "pilot-launch-package.json"))),
  evidencePre: path.resolve(argValue("--evidence-pre", path.join(outDir, "pilot-evidence.json"))),
  evidencePreMarkdown: path.resolve(argValue("--evidence-pre-markdown", path.join(outDir, "pilot-evidence.pre-pilot.md"))),
  preflightPre: path.resolve(argValue("--preflight-pre", path.join(outDir, "pilot-preflight.pre-pilot.json"))),
  status: path.resolve(argValue("--status-out", path.join(outDir, "pilot-status.json"))),
  preflightPost: path.resolve(argValue("--preflight-post", path.join(outDir, "pilot-preflight.post-pilot.json"))),
  evidencePost: path.resolve(argValue("--evidence-post", path.join(outDir, "pilot-evidence.post-pilot.json"))),
  field: path.resolve(argValue("--field", path.join(outDir, "pilot-field-evidence.json"))),
  closeout: path.resolve(argValue("--closeout", path.join(outDir, "pilot-closeout-package.json"))),
  artifactManifest: path.resolve(argValue("--artifact-manifest", path.join(outDir, "pilot-artifact-manifest.json"))),
  archiveManifest: path.resolve(argValue("--archive-manifest", path.join(outDir, "pilot-archives/final-judo-pilot-20260715/pilot-archive-manifest.json"))),
  storageReceipt: path.resolve(argValue("--storage-receipt", path.join(outDir, "pilot-storage-receipt.json"))),
  finalHandoff: path.resolve(argValue("--final-handoff", path.join(outDir, "pilot-final-handoff.json"))),
  summary: path.resolve(argValue("--summary-out", path.join(outDir, "pilot-prelaunch-draft.json"))),
};

function runtimeDraftArgs({ forLaunchPackage = false, forStatus = false } = {}) {
  if (driver === "json") {
    return [`--driver=json`, forLaunchPackage ? `--runtime-file=${runtimePath}` : forStatus ? `--db=${runtimePath}` : `--runtime=${runtimePath}`];
  }

  return [
    "--driver=postgres",
    `--state-key=${stateKey}`,
    `--table=${table}`,
    ...(postgresUrl ? [`--postgres-url=${postgresUrl}`] : []),
  ];
}

function runtimeReport() {
  if (driver === "postgres") {
    return {
      driver,
      stateKey,
      table,
      ...(postgresUrl ? { connectionString: redactConnectionString(postgresUrl) } : {}),
    };
  }

  return {
    driver,
    file: runtimePath,
  };
}

async function main() {
  await Promise.all([
    mkdir(outDir, { recursive: true }),
    mkdir(path.dirname(paths.archiveManifest), { recursive: true }),
    ...Object.values(paths).map((filePath) => mkdir(path.dirname(filePath), { recursive: true })),
  ]);

  const readinessDraftArgs = [...runtimeDraftArgs(), "--phase=pre-pilot", `--out=${paths.readinessEvidence}`];
  const passwordRotationDraftArgs = [...runtimeDraftArgs(), `--out=${paths.passwordRotation}`];
  const launchPackageArgs = [
    `--csv=${csvPath}`,
    `--readiness-evidence=${paths.readinessEvidence}`,
    `--password-rotation=${paths.passwordRotation}`,
    `--out=${paths.launchPackage}`,
    `--evidence-out=${paths.evidencePre}`,
    `--evidence-markdown=${paths.evidencePreMarkdown}`,
    `--preflight-out=${paths.preflightPre}`,
    ...runtimeDraftArgs({ forLaunchPackage: true }),
    "--allow-incomplete",
  ];
  const statusArgs = [
    "--strict",
    `--out=${paths.status}`,
    `--preflight-pre=${paths.preflightPre}`,
    `--evidence-pre=${paths.evidencePre}`,
    `--evidence-pre-markdown=${paths.evidencePreMarkdown}`,
    `--readiness-evidence=${paths.readinessEvidence}`,
    `--password-rotation=${paths.passwordRotation}`,
    `--launch-package=${paths.launchPackage}`,
    `--preflight-post=${paths.preflightPost}`,
    `--evidence-post=${paths.evidencePost}`,
    `--field=${paths.field}`,
    `--closeout=${paths.closeout}`,
    `--artifact-manifest=${paths.artifactManifest}`,
    `--archive-manifest=${paths.archiveManifest}`,
    `--storage-receipt=${paths.storageReceipt}`,
    `--final-handoff=${paths.finalHandoff}`,
    ...runtimeDraftArgs({ forStatus: true }),
  ];

  await runNode("scripts/create-pilot-readiness-evidence-draft.mjs", readinessDraftArgs, "pre-pilot readiness evidence draft", { nodeEnv: "production" });
  await runNode("scripts/create-pilot-password-rotation-draft.mjs", passwordRotationDraftArgs, "password rotation evidence draft", { nodeEnv: "production" });

  const launchPackageResult = await runNode("scripts/create-pilot-launch-package.mjs", launchPackageArgs, "prelaunch audit package", {
    nodeEnv: "production",
  });
  const launchPackage = parseJson(launchPackageResult.stdout, "prelaunch audit package");

  const statusResult = await runNode("scripts/check-pilot-status.mjs", statusArgs, "prelaunch status", {
    allowFailure: true,
    nodeEnv: "production",
  });
  const status = statusResult.stdout.trim() ? parseJson(statusResult.stdout, "prelaunch status") : parseJson(await readFile(paths.status, "utf8"), "prelaunch status file");

  const summary = {
    ok: true,
    generatedAt,
    mode: "draft",
    releaseDecision: status.releaseDecision ?? "blocked",
    runtime: runtimeReport(),
    artifacts: {
      readinessEvidence: await fileSummary(paths.readinessEvidence),
      passwordRotation: await fileSummary(paths.passwordRotation),
      evidencePre: await fileSummary(paths.evidencePre),
      evidencePreMarkdown: await fileSummary(paths.evidencePreMarkdown),
      preflightPre: await fileSummary(paths.preflightPre),
      launchPackage: {
        ...(await fileSummary(paths.launchPackage)),
        ok: launchPackage.ok,
        mode: launchPackage.mode,
        releaseDecision: launchPackage.releaseDecision,
        blockerCodes: (launchPackage.blockers ?? []).map((issue) => issue.code),
      },
      status: {
        ...(await fileSummary(paths.status)),
        ok: status.ok,
        phase: status.phase,
        releaseDecision: status.releaseDecision,
        blockerCount: status.blockers?.length ?? 0,
        nextAction: status.nextAction,
      },
    },
    commands: {
      readinessEvidenceDraft: `npm run pilot:readiness-evidence:draft -- ${displayArgs(readinessDraftArgs)}`,
      readinessEvidenceCheck: `npm run pilot:readiness-evidence -- --file=${relativeOrAbsolute(paths.readinessEvidence)} --phase=pre-pilot`,
      passwordRotationDraft: `npm run pilot:password-rotation:draft -- ${displayArgs(passwordRotationDraftArgs)}`,
      passwordRotationCheck: `npm run pilot:password-rotation -- ${displayArgs([...runtimeDraftArgs(), `--file=${paths.passwordRotation}`])}`,
      launchPackageAudit: `npm run pilot:launch-package -- ${displayArgs(launchPackageArgs)}`,
      launchPackageStrict: `npm run pilot:launch-package -- ${displayArgs(launchPackageArgs.filter((arg) => arg !== "--allow-incomplete"))}`,
      statusStrict: `npm run pilot:status -- ${displayArgs(statusArgs)}`,
    },
    nextActions: [
      "준비 증빙 CSV의 owner/status/evidence/checkedAt을 채운 뒤 pilot:readiness-evidence를 통과시킨다.",
      "/app/admin/users에서 계정별 임시 비밀번호를 발급하고 password rotation CSV의 감사 로그/전달 증빙을 채운다.",
      "검증된 readiness/password CSV를 런타임에 반영한 뒤 launchPackageStrict 명령을 실행한다.",
      "현장 2주 운영 후 post-pilot evidence, field evidence, closeout, archive/storage/final handoff를 이어서 생성한다.",
    ],
    checked: [
      "pre-pilot readiness evidence draft",
      "password rotation evidence draft",
      "prelaunch audit launch package",
      "strict pilot status report",
      "redacted command summary",
    ],
  };
  const serializedSummary = `${JSON.stringify(summary, null, 2)}\n`;

  await writeFile(paths.summary, serializedSummary, "utf8");
  process.stdout.write(serializedSummary);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
