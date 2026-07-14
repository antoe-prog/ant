import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const {
  inspectRuntimeStateIntegrity,
  validateRuntimeStateIntegrity,
} = await import("../src/server/runtime-state-integrity.ts");

const args = process.argv.slice(2);
const snapshotArg = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length);
const outArg = args.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
const allowIssues = args.includes("--allow-issues");

if (!snapshotArg) {
  throw new Error("A read-only runtime snapshot is required: --file=/path/to/final-judo-db.json");
}

const snapshotFile = path.resolve(snapshotArg);
const outFile = outArg ? path.resolve(outArg) : null;
const requiredCollections = [
  "branches",
  "users",
  "members",
  "classes",
  "attendance",
  "counselingNotes",
  "promotions",
  "tournaments",
  "payments",
  "notices",
  "authSessions",
  "pushSubscriptions",
  "pushDispatchJobs",
  "pilotReadinessChecks",
  "pilotIncidents",
  "pilotOperationLogs",
  "auditLogs",
];

async function assertSeparateOutput() {
  if (!outFile) {
    return;
  }
  if (outFile === snapshotFile) {
    throw new Error("The report output must not overwrite the runtime snapshot.");
  }
  const sourceRealPath = await realpath(snapshotFile);
  const outputRealPath = await realpath(outFile).catch(() => null);
  if (outputRealPath === sourceRealPath) {
    throw new Error("The report output must not resolve to the runtime snapshot.");
  }
  const sourceStat = await stat(snapshotFile);
  const outputStat = await stat(outFile).catch(() => null);
  if (outputStat && outputStat.dev === sourceStat.dev && outputStat.ino === sourceStat.ino) {
    throw new Error("The report output must not be a hard link to the runtime snapshot.");
  }
}

await assertSeparateOutput();
const raw = await readFile(snapshotFile, "utf8");
const parsed = JSON.parse(raw);
let structuralError = null;
let issues = [];
const missingCollections = requiredCollections.filter((collection) => !(collection in parsed));
const invalidCollections = requiredCollections.filter(
  (collection) => collection in parsed && !Array.isArray(parsed[collection]),
);

if (missingCollections.length > 0 || invalidCollections.length > 0) {
  structuralError = {
    name: "RuntimeStateSchemaError",
    missingCollections,
    invalidCollections,
  };
} else {
  try {
    validateRuntimeStateIntegrity(parsed);
    issues = inspectRuntimeStateIntegrity(parsed);
  } catch (error) {
    structuralError = error && typeof error === "object" && "rule" in error
      ? { name: "RuntimeStateIntegrityError", rule: error.rule }
      : { name: error instanceof Error ? error.name : "UnknownError" };
  }
}

function summarizeIssues(values) {
  const byRule = new Map();
  for (const issue of values) {
    const summary = byRule.get(issue.rule) ?? {
      blockerCount: 0,
      count: 0,
      repairableCount: 0,
      warningCount: 0,
    };
    summary.count += 1;
    summary.repairableCount += issue.repairable ? 1 : 0;
    summary.blockerCount += issue.severity === "blocker" ? 1 : 0;
    summary.warningCount += issue.severity === "warning" ? 1 : 0;
    byRule.set(issue.rule, summary);
  }
  return Object.fromEntries([...byRule.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

const blockerCount = issues.filter((issue) => issue.severity === "blocker").length;
const report = {
  ok: structuralError === null && blockerCount === 0,
  generatedAt: new Date().toISOString(),
  mode: "read-only-snapshot",
  source: path.basename(snapshotFile),
  sourceModified: false,
  counts: structuralError
    ? null
    : {
        branches: parsed.branches.length,
        users: parsed.users.length,
        members: parsed.members.length,
        classes: parsed.classes.length,
        attendance: parsed.attendance.length,
        payments: parsed.payments.length,
        issues: issues.length,
        blockers: blockerCount,
        warnings: issues.filter((issue) => issue.severity === "warning").length,
        repairable: issues.filter((issue) => issue.repairable).length,
      },
  issueSummary: summarizeIssues(issues),
  structuralError,
  checked: [
    "runtime collection identity and required branch references",
    "normalized user phone and email uniqueness",
    "operator assignments and branch scope",
    "member, guardian, class, notice, and push references",
    "preserved attendance and payment history references",
    "aggregate-only report without record identifiers or personal data",
  ],
};

const output = `${JSON.stringify(report, null, 2)}\n`;
if (outFile) {
  await writeFile(outFile, output, "utf8");
}
process.stdout.write(output);

if (!report.ok && !allowIssues) {
  process.exitCode = 1;
}
