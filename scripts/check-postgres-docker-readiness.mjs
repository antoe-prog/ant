#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const generatedAt = new Date().toISOString();

function parseArgs(argv) {
  const options = {
    dockerBin: "docker",
    markdown: null,
    mockDocker: process.env.FINAL_JUDO_POSTGRES_DOCTOR_MOCK_DOCKER ?? null,
    out: null,
    requirePostgresEnv: false,
    strict: false,
  };

  for (const arg of argv) {
    if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--require-postgres-env") {
      options.requirePostgresEnv = true;
    } else if (arg.startsWith("--docker-bin=")) {
      options.dockerBin = arg.slice("--docker-bin=".length);
    } else if (arg.startsWith("--mock-docker=")) {
      options.mockDocker = arg.slice("--mock-docker=".length);
    } else if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
    } else if (arg.startsWith("--markdown=")) {
      options.markdown = arg.slice("--markdown=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function redactPostgresUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "REDACTED";
    }
    return url.toString();
  } catch {
    return String(value).replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, "$1REDACTED$3");
  }
}

function assertNoSecretLeak(label, source) {
  const forbiddenPatterns = [
    /FinalJudoPilot!2026/i,
    /postgres(?:ql)?:\/\/[^:\s/@]+:(?!REDACTED@)[^@\s]+@/i,
    /FINAL_JUDO_(?:PAYMENT_WEBHOOK_SECRET|VAPID_PRIVATE_KEY)=\S+/i,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) {
      throw new Error(`${label} includes a raw secret-like value`);
    }
  }
}

async function runDockerProbe(dockerBin) {
  const docker = {
    binary: dockerBin,
    cliAvailable: false,
    clientVersion: null,
    daemonRunning: false,
    serverVersion: null,
    errors: [],
  };

  try {
    const { stdout } = await execFile(dockerBin, ["--version"], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    docker.cliAvailable = true;
    docker.clientVersion = stdout.trim().replace(/^Docker version\s+/i, "").replace(/,\s*build\s+.+$/i, "") || "unknown";
  } catch (error) {
    docker.errors.push(`docker --version failed: ${error.code === "ENOENT" ? "command not found" : error.message}`);
    return docker;
  }

  try {
    const { stdout } = await execFile(dockerBin, ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    docker.daemonRunning = true;
    docker.serverVersion = stdout.trim() || "unknown";
  } catch (error) {
    docker.errors.push(`docker info failed: ${error.message}`);
  }

  return docker;
}

function mockDockerProbe(mode, dockerBin) {
  if (mode === "ready") {
    return {
      binary: dockerBin,
      cliAvailable: true,
      clientVersion: "mock-client-26.0.0",
      daemonRunning: true,
      errors: [],
      serverVersion: "mock-server-26.0.0",
    };
  }

  if (mode === "daemon-down") {
    return {
      binary: dockerBin,
      cliAvailable: true,
      clientVersion: "mock-client-26.0.0",
      daemonRunning: false,
      errors: ["docker info failed: Docker daemon is not running"],
      serverVersion: null,
    };
  }

  if (mode === "cli-missing") {
    return {
      binary: dockerBin,
      cliAvailable: false,
      clientVersion: null,
      daemonRunning: false,
      errors: ["docker version failed: command not found"],
      serverVersion: null,
    };
  }

  throw new Error(`Unknown --mock-docker value: ${mode}`);
}

function buildReport(options, docker) {
  const dbDriver = process.env.FINAL_JUDO_DB_DRIVER || "json";
  const rawPostgresUrl = process.env.FINAL_JUDO_POSTGRES_URL || "";
  const postgresUrl = redactPostgresUrl(rawPostgresUrl);
  const stateKey = process.env.FINAL_JUDO_POSTGRES_STATE_KEY || "final-judo-runtime";
  const table = process.env.FINAL_JUDO_POSTGRES_TABLE || "app_runtime_state";
  const blockers = [];
  const warnings = [];

  if (!docker.cliAvailable) {
    blockers.push({
      code: "POSTGRES_DOCKER_CLI_MISSING",
      message: "Docker CLI를 찾을 수 없어 PostgreSQL migration/seed smoke와 runtime store smoke를 실행할 수 없습니다.",
      nextAction: "Docker Desktop을 설치하거나 PATH에 docker CLI가 잡히는 shell에서 다시 실행합니다.",
    });
  } else if (!docker.daemonRunning) {
    blockers.push({
      code: "POSTGRES_DOCKER_DAEMON_DOWN",
      message: "Docker CLI는 있지만 Docker daemon이 실행 중이 아니어서 PostgreSQL smoke 컨테이너를 띄울 수 없습니다.",
      nextAction: "Docker Desktop을 시작한 뒤 `npm run test:db`, `npm run test:postgres-store`, `npm run test:release`를 다시 실행합니다.",
    });
  }

  if (options.requirePostgresEnv) {
    if (dbDriver !== "postgres") {
      blockers.push({
        code: "POSTGRES_ENV_DRIVER_NOT_POSTGRES",
        message: "운영 DB 모드 검증에는 FINAL_JUDO_DB_DRIVER=postgres가 필요합니다.",
        nextAction: ".env.production 또는 배포 secret store에 FINAL_JUDO_DB_DRIVER=postgres를 설정합니다.",
      });
    }

    if (!rawPostgresUrl) {
      blockers.push({
        code: "POSTGRES_ENV_URL_MISSING",
        message: "운영 DB 모드 검증에는 FINAL_JUDO_POSTGRES_URL이 필요합니다.",
        nextAction: "배포 platform secret store에 PostgreSQL URL을 저장하고 원문 값 대신 secret 이름/증빙 URI를 handoff에 기록합니다.",
      });
    }
  } else if (dbDriver !== "postgres") {
    warnings.push({
      code: "POSTGRES_ENV_DRIVER_NOT_ACTIVE",
      message: "현재 shell은 FINAL_JUDO_DB_DRIVER=postgres가 아니므로 local Docker smoke 전용 상태만 확인합니다.",
    });
  }

  if (rawPostgresUrl && !postgresUrl?.includes("REDACTED") && /postgres(?:ql)?:\/\/[^@\s]+@/i.test(rawPostgresUrl)) {
    warnings.push({
      code: "POSTGRES_URL_NO_PASSWORD",
      message: "FINAL_JUDO_POSTGRES_URL은 설정되어 있으나 password redaction 대상이 없는 형태입니다.",
    });
  }

  const releaseDecision = blockers.length === 0 ? "ready" : "blocked";
  const nextActions =
    releaseDecision === "ready"
      ? ["`npm run test:db`와 `npm run test:postgres-store`를 실행해 실제 PostgreSQL smoke를 완료합니다."]
      : [...new Set(blockers.map((blocker) => blocker.nextAction))];

  return {
    generatedAt,
    releaseDecision,
    strict: options.strict,
    docker,
    environment: {
      dbDriver,
      postgresUrlConfigured: Boolean(rawPostgresUrl),
      postgresUrl,
      stateKey,
      table,
      requirePostgresEnv: options.requirePostgresEnv,
    },
    commands: {
      doctor:
        "npm run postgres:doctor -- --out=.data/postgres-docker-readiness.json --markdown=.data/postgres-docker-readiness.md",
      strictDoctor:
        "npm run postgres:doctor -- --strict --out=.data/postgres-docker-readiness.json --markdown=.data/postgres-docker-readiness.md",
      strictProductionDoctor:
        "npm run postgres:doctor -- --strict --require-postgres-env --out=.data/postgres-docker-readiness.json --markdown=.data/postgres-docker-readiness.md",
      dbSmoke: "npm run test:db",
      runtimeStoreSmoke: "npm run test:postgres-store",
      release: "npm run test:release",
    },
    blockers,
    warnings,
    nextActions,
  };
}

function renderMarkdown(report) {
  const rows = [
    ["Release decision", report.releaseDecision],
    ["Docker CLI", report.docker.cliAvailable ? `ready (${report.docker.clientVersion})` : "missing"],
    ["Docker daemon", report.docker.daemonRunning ? `ready (${report.docker.serverVersion})` : "not running"],
    ["DB driver", report.environment.dbDriver],
    ["Postgres URL", report.environment.postgresUrlConfigured ? report.environment.postgresUrl : "not configured"],
    ["State key", report.environment.stateKey],
    ["Runtime table", report.environment.table],
  ];

  const blockerLines =
    report.blockers.length === 0
      ? "- none"
      : report.blockers.map((blocker) => `- ${blocker.code}: ${blocker.message}`).join("\n");
  const warningLines =
    report.warnings.length === 0
      ? "- none"
      : report.warnings.map((warning) => `- ${warning.code}: ${warning.message}`).join("\n");
  const nextActionLines = report.nextActions.map((action) => `- ${action}`).join("\n");

  return `# PostgreSQL Docker Readiness

Generated: ${report.generatedAt}

| Item | Value |
| --- | --- |
${rows.map(([label, value]) => `| ${label} | ${value} |`).join("\n")}

## Blockers

${blockerLines}

## Warnings

${warningLines}

## Commands

- Doctor: \`${report.commands.doctor}\`
- Strict doctor: \`${report.commands.strictDoctor}\`
- Production strict doctor: \`${report.commands.strictProductionDoctor}\`
- DB smoke: \`${report.commands.dbSmoke}\`
- Runtime store smoke: \`${report.commands.runtimeStoreSmoke}\`
- Release: \`${report.commands.release}\`

## Next Actions

${nextActionLines}
`;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const source = `${JSON.stringify(value, null, 2)}\n`;
  assertNoSecretLeak(path, source);
  await writeFile(path, source);
}

async function writeMarkdown(path, source) {
  await mkdir(dirname(path), { recursive: true });
  assertNoSecretLeak(path, source);
  await writeFile(path, source);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const docker = options.mockDocker
    ? mockDockerProbe(options.mockDocker, options.dockerBin)
    : await runDockerProbe(options.dockerBin);
  const report = buildReport(options, docker);
  const jsonSource = JSON.stringify(report, null, 2);

  assertNoSecretLeak("PostgreSQL Docker readiness report", jsonSource);

  if (options.out) {
    await writeJson(options.out, report);
  }

  if (options.markdown) {
    await writeMarkdown(options.markdown, renderMarkdown(report));
  }

  console.log(
    JSON.stringify(
      {
        ok: report.releaseDecision === "ready",
        releaseDecision: report.releaseDecision,
        docker: {
          cliAvailable: report.docker.cliAvailable,
          daemonRunning: report.docker.daemonRunning,
        },
        out: options.out ? relative(process.cwd(), options.out) : null,
        markdown: options.markdown ? relative(process.cwd(), options.markdown) : null,
        blockers: report.blockers.map((blocker) => blocker.code),
        warnings: report.warnings.map((warning) => warning.code),
        nextActions: report.nextActions,
      },
      null,
      2,
    ),
  );

  if (options.strict && report.releaseDecision !== "ready") {
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
