import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const { prePilotReadinessIds } = await import("../src/lib/pilot-readiness.ts");

const args = process.argv.slice(2);
const formatArg = args.find((arg) => arg.startsWith("--format="))?.slice("--format=".length) ?? "json";
const outputArg = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
const requireRetro = args.includes("--require-retro");
const explicitDriver = args.find((arg) => arg.startsWith("--driver="))?.slice("--driver=".length);
const explicitFile = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length);
const explicitPostgresUrl = args.find((arg) => arg.startsWith("--postgres-url="))?.slice("--postgres-url=".length);
const explicitStateKey = args.find((arg) => arg.startsWith("--state-key="))?.slice("--state-key=".length);
const explicitTable = args.find((arg) => arg.startsWith("--table="))?.slice("--table=".length);
const driver = explicitDriver ?? (process.env.FINAL_JUDO_DB_DRIVER === "postgres" ? "postgres" : "json");
const jsonFile = path.resolve(explicitFile ?? process.env.PILOT_DB_FILE ?? ".data/final-judo-db.json");
const postgresUrl = explicitPostgresUrl ?? process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL;
const postgresStateKey = explicitStateKey ?? process.env.FINAL_JUDO_POSTGRES_STATE_KEY ?? "mvp";
const postgresTable = explicitTable ?? process.env.FINAL_JUDO_POSTGRES_TABLE ?? "app_runtime_state";

if (formatArg !== "json" && formatArg !== "markdown") {
  throw new Error(`Unsupported evidence format: ${formatArg}`);
}

if (driver !== "json" && driver !== "postgres") {
  throw new Error(`Unsupported evidence driver: ${driver}`);
}

function assertSafeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }

  return value;
}

function redactConnectionString(connectionString) {
  if (!connectionString) {
    return null;
  }

  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "********";
    }
    return url.toString();
  } catch {
    return "configured";
  }
}

function countBy(values, key) {
  return values.reduce((acc, value) => {
    const group = value[key] ?? "unknown";
    acc[group] = (acc[group] ?? 0) + 1;
    return acc;
  }, {});
}

function sum(values, key) {
  return values.reduce((total, value) => total + (Number(value[key]) || 0), 0);
}

function byId(values) {
  return new Map(values.map((value) => [value.id, value]));
}

async function readRuntimeDb() {
  if (driver === "json") {
    const raw = await readFile(jsonFile, "utf8");
    return {
      db: JSON.parse(raw),
      runtime: {
        driver,
        file: jsonFile,
      },
    };
  }

  if (!postgresUrl) {
    throw new Error("FINAL_JUDO_DB_DRIVER=postgres requires FINAL_JUDO_POSTGRES_URL or DATABASE_URL.");
  }

  const { Pool } = await import("pg");
  const tableName = assertSafeIdentifier(postgresTable);
  const pool = new Pool({ connectionString: postgresUrl, max: 1 });

  try {
    const result = await pool.query(`SELECT data, revision, updated_at FROM ${tableName} WHERE key = $1`, [postgresStateKey]);
    const row = result.rows[0];

    if (!row) {
      throw new Error(`No runtime state found in ${tableName} for key ${postgresStateKey}`);
    }

    return {
      db: row.data,
      runtime: {
        driver,
        tableName,
        key: postgresStateKey,
        connectionString: redactConnectionString(postgresUrl),
        revision: Number(row.revision),
        updatedAt: row.updated_at?.toISOString?.() ?? null,
      },
    };
  } finally {
    await pool.end();
  }
}

async function runPreflightAudit() {
  const nodeArgs = [
    "--experimental-transform-types",
    "--disable-warning=ExperimentalWarning",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "scripts/check-production-preflight.mjs",
    "--allow-incomplete",
    ...(requireRetro ? ["--require-retro"] : []),
    ...(explicitDriver ? [`--driver=${explicitDriver}`] : []),
    ...(explicitFile ? [`--file=${explicitFile}`] : []),
    ...(explicitPostgresUrl ? [`--postgres-url=${explicitPostgresUrl}`] : []),
    ...(explicitStateKey ? [`--state-key=${explicitStateKey}`] : []),
    ...(explicitTable ? [`--table=${explicitTable}`] : []),
  ];
  const result = await execFile(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024,
  });

  return JSON.parse(result.stdout.trim());
}

function buildReport(db, runtime, preflight) {
  const checksById = byId(db.pilotReadinessChecks);
  const requiredReadinessIds = requireRetro ? [...prePilotReadinessIds, "pilot-retro"] : prePilotReadinessIds;
  const requiredReadiness = requiredReadinessIds.map((id) => {
    const check = checksById.get(id);
    return {
      id,
      label: check?.label ?? id,
      category: check?.category ?? "unknown",
      status: check?.status ?? "missing",
      owner: check?.owner ?? "",
      hasEvidence: Boolean(check?.evidence?.trim()),
      checkedAt: check?.checkedAt ?? null,
    };
  });
  const operationLogs = db.pilotOperationLogs ?? [];
  const incidents = db.pilotIncidents ?? [];
  const unresolvedIncidents = incidents.filter((incident) => incident.status !== "resolved");
  const operationDates = new Set(operationLogs.map((log) => log.date));
  const releaseDecision =
    preflight.blockers.length > 0 ? "blocked" : preflight.warnings.length > 0 ? "review_required" : "ready";

  return {
    generatedAt: new Date().toISOString(),
    mode: requireRetro ? "post-pilot" : "pre-pilot",
    releaseDecision,
    runtime,
    preflight: {
      ok: preflight.ok,
      mode: preflight.mode,
      blockerCodes: preflight.blockers.map((issue) => issue.code),
      warningCodes: preflight.warnings.map((issue) => issue.code),
      blockers: preflight.blockers,
      warnings: preflight.warnings,
      checked: preflight.checked,
    },
    counts: {
      ...preflight.counts,
      unresolvedIncidents: unresolvedIncidents.length,
      requiredReadiness: requiredReadiness.length,
      requiredReadinessVerified: requiredReadiness.filter((check) => check.status === "verified" && check.hasEvidence).length,
      operationDays: operationDates.size,
      verifiedOperationDays: operationLogs.filter((log) => log.status === "verified").length,
      attendanceRecordsLogged: sum(operationLogs, "attendanceRecords"),
      paymentChecksLogged: sum(operationLogs, "paymentChecks"),
      noticeFollowupChecksLogged: sum(operationLogs, "noticeFollowupChecks"),
      noticeChecksLogged: sum(operationLogs, "noticeChecks"),
    },
    readiness: {
      requiredIds: requiredReadinessIds,
      statusCounts: countBy(db.pilotReadinessChecks, "status"),
      required: requiredReadiness,
    },
    incidents: {
      statusCounts: countBy(incidents, "status"),
      severityCounts: countBy(incidents, "severity"),
      unresolved: unresolvedIncidents.map((incident) => ({
        id: incident.id,
        severity: incident.severity,
        status: incident.status,
        title: incident.title,
        owner: incident.owner,
        branchId: incident.branchId,
      })),
    },
    operations: {
      statusCounts: countBy(operationLogs, "status"),
      days: operationDates.size,
      attendanceRecords: sum(operationLogs, "attendanceRecords"),
      paymentChecks: sum(operationLogs, "paymentChecks"),
      noticeFollowupChecks: sum(operationLogs, "noticeFollowupChecks"),
      noticeChecks: sum(operationLogs, "noticeChecks"),
      latest: operationLogs.slice(0, 14).map((log) => ({
        id: log.id,
        branchId: log.branchId,
        date: log.date,
        status: log.status,
        owner: log.owner,
        attendanceRecords: log.attendanceRecords,
        paymentChecks: log.paymentChecks,
        mobileAttendanceDurationSeconds: log.mobileAttendanceDurationSeconds ?? null,
        mobileAttendanceEvidence: log.mobileAttendanceEvidence ?? null,
      })),
    },
  };
}

function toMarkdown(report) {
  const blockers = report.preflight.blockerCodes.length > 0 ? report.preflight.blockerCodes.join(", ") : "none";
  const warnings = report.preflight.warningCodes.length > 0 ? report.preflight.warningCodes.join(", ") : "none";

  return [
    "# Final Judo Pilot Evidence Report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Decision: ${report.releaseDecision}`,
    `- Runtime: ${report.runtime.driver}`,
    `- Preflight blockers: ${blockers}`,
    `- Preflight warnings: ${warnings}`,
    "",
    "## Readiness",
    "",
    `- Required verified: ${report.counts.requiredReadinessVerified}/${report.counts.requiredReadiness}`,
    ...report.readiness.required.map(
      (check) => `- ${check.id}: ${check.status}, owner=${check.owner || "none"}, evidence=${check.hasEvidence ? "yes" : "no"}`,
    ),
    "",
    "## Incidents",
    "",
    `- Unresolved incidents: ${report.counts.unresolvedIncidents}`,
    ...report.incidents.unresolved.map((incident) => `- ${incident.severity}/${incident.status}: ${incident.title} (${incident.owner})`),
    "",
    "## Operations",
    "",
    `- Operation days: ${report.counts.operationDays}`,
    `- Verified operation days: ${report.counts.verifiedOperationDays}`,
    `- Attendance records logged: ${report.counts.attendanceRecordsLogged}`,
    `- Payment checks logged: ${report.counts.paymentChecksLogged}`,
    `- Notice follow-up checks logged: ${report.counts.noticeFollowupChecksLogged}`,
    `- Notice checks logged: ${report.counts.noticeChecksLogged}`,
    "",
  ].join("\n");
}

async function main() {
  const [{ db, runtime }, preflight] = await Promise.all([readRuntimeDb(), runPreflightAudit()]);
  const report = buildReport(db, runtime, preflight);
  const output = formatArg === "json" ? `${JSON.stringify(report, null, 2)}\n` : `${toMarkdown(report)}\n`;

  if (outputArg) {
    const outputPath = path.resolve(outputArg);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, "utf8");
  }

  process.stdout.write(output);
}

await main();
