import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);
const fieldFile = path.resolve(args.find((arg) => arg.startsWith("--field="))?.slice("--field=".length) ?? ".data/pilot-field-evidence.json");
const preflightFile = path.resolve(args.find((arg) => arg.startsWith("--preflight="))?.slice("--preflight=".length) ?? ".data/pilot-preflight.post-pilot.json");
const reportFile = path.resolve(args.find((arg) => arg.startsWith("--report="))?.slice("--report=".length) ?? ".data/pilot-evidence.post-pilot.json");
const markdownFile = path.resolve(args.find((arg) => arg.startsWith("--markdown="))?.slice("--markdown=".length) ?? ".data/pilot-evidence.md");
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

function parseDateOnly(value) {
  const stringValue = text(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return null;
  }

  const parsed = new Date(`${stringValue}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function readJson(file, label, blockers, code) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    addIssue(blockers, code, `${label} must be readable JSON.`, {
      file,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function readText(file, label, blockers, code) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    addIssue(blockers, code, `${label} must be readable.`, {
      file,
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

async function runFieldEvidence(blockers) {
  try {
    const result = await execFile(process.execPath, ["scripts/check-pilot-field-evidence.mjs", `--file=${fieldFile}`, `--report=${reportFile}`], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    const stdout = text(error.stdout);
    let parsed = null;

    try {
      parsed = stdout ? JSON.parse(stdout) : null;
    } catch {
      // Fall through to the generic blocker below.
    }

    if (parsed?.blockers?.length) {
      addIssue(blockers, "FIELD_EVIDENCE_BLOCKED", "pilot field evidence must pass before closeout packaging.", {
        blockers: parsed.blockers,
      });
      return parsed;
    }

    addIssue(blockers, "FIELD_EVIDENCE_UNREADABLE", "pilot field evidence checker must emit parseable JSON.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return parsed;
  }
}

function validatePreflight(preflight, manifest, blockers) {
  if (!preflight) {
    return;
  }

  if (preflight.ok !== true || preflight.mode !== "strict" || preflight.blockers?.length > 0) {
    addIssue(blockers, "POST_PILOT_PREFLIGHT_NOT_READY", "post-pilot strict preflight artifact must be ready with no blockers.", {
      ok: preflight.ok ?? null,
      mode: preflight.mode ?? null,
      blockers: preflight.blockers ?? null,
    });
  }

  const checked = Array.isArray(preflight.checked) ? preflight.checked : [];
  for (const requiredCheck of ["14-day pilot operation evidence when --require-retro is set", "mobile attendance timing evidence in pilot operation logs"]) {
    if (!checked.includes(requiredCheck)) {
      addIssue(blockers, "POST_PILOT_PREFLIGHT_SCOPE_INCOMPLETE", "post-pilot preflight artifact is missing a required checked scope.", {
        requiredCheck,
      });
    }
  }

  const generatedAt = parseDateTime(preflight.generatedAt);
  const pilotPeriodEnd = parseDateOnly(manifest?.pilot?.period?.endsOn);
  if (!generatedAt) {
    addIssue(blockers, "POST_PILOT_PREFLIGHT_GENERATED_AT_INVALID", "post-pilot preflight artifact must include a valid generatedAt timestamp.");
  } else if (pilotPeriodEnd && generatedAt < pilotPeriodEnd) {
    addIssue(blockers, "POST_PILOT_PREFLIGHT_STALE", "post-pilot preflight artifact must be generated on or after the pilot period ends.", {
      generatedAt: generatedAt.toISOString(),
      pilotPeriodEndsOn: text(manifest?.pilot?.period?.endsOn),
    });
  }
}

function validateReport(report, blockers) {
  if (!report) {
    return;
  }

  if (report.mode !== "post-pilot" || report.releaseDecision !== "ready" || report.preflight?.blockerCodes?.length > 0) {
    addIssue(blockers, "POST_PILOT_EVIDENCE_NOT_READY", "post-pilot pilot:evidence JSON must be ready with no preflight blockers.", {
      mode: report.mode ?? null,
      releaseDecision: report.releaseDecision ?? null,
      blockerCodes: report.preflight?.blockerCodes ?? null,
    });
  }

  if (Number(report.counts?.operationDays) < 14 || Number(report.counts?.verifiedOperationDays) < 14) {
    addIssue(blockers, "POST_PILOT_EVIDENCE_OPERATION_DAYS_INCOMPLETE", "post-pilot pilot:evidence JSON must include 14 operation days.", {
      operationDays: report.counts?.operationDays ?? null,
      verifiedOperationDays: report.counts?.verifiedOperationDays ?? null,
    });
  }
}

function validateMarkdown(markdown, blockers) {
  for (const expected of ["# Final Judo Pilot Evidence Report", "- Mode: post-pilot", "- Decision: ready", "## Operations"]) {
    if (!markdown.includes(expected)) {
      addIssue(blockers, "POST_PILOT_MARKDOWN_SUMMARY_INCOMPLETE", "post-pilot Markdown evidence report is missing required closeout content.", {
        expected,
      });
    }
  }
}

function validateArtifactPaths(manifest, blockers) {
  const manifestJson = path.resolve(text(manifest?.operations?.postPilotEvidenceJson));
  const manifestMarkdown = path.resolve(text(manifest?.operations?.postPilotEvidenceMarkdown));

  if (manifestJson !== reportFile) {
    addIssue(blockers, "CLOSEOUT_JSON_REPORT_PATH_MISMATCH", "closeout --report must match operations.postPilotEvidenceJson.", {
      manifestJson,
      reportFile,
    });
  }

  if (manifestMarkdown !== markdownFile) {
    addIssue(blockers, "CLOSEOUT_MARKDOWN_REPORT_PATH_MISMATCH", "closeout --markdown must match operations.postPilotEvidenceMarkdown.", {
      manifestMarkdown,
      markdownFile,
    });
  }
}

async function main() {
  const blockers = [];
  const [manifest, preflight, report, markdown] = await Promise.all([
    readJson(fieldFile, "field evidence manifest", blockers, "FIELD_EVIDENCE_UNREADABLE"),
    readJson(preflightFile, "post-pilot preflight artifact", blockers, "POST_PILOT_PREFLIGHT_UNREADABLE"),
    readJson(reportFile, "post-pilot pilot:evidence JSON", blockers, "POST_PILOT_EVIDENCE_UNREADABLE"),
    readText(markdownFile, "post-pilot Markdown evidence report", blockers, "POST_PILOT_MARKDOWN_UNREADABLE"),
  ]);
  const fieldEvidence = await runFieldEvidence(blockers);

  validatePreflight(preflight, manifest, blockers);
  validateReport(report, blockers);
  validateMarkdown(markdown, blockers);
  if (manifest) {
    validateArtifactPaths(manifest, blockers);
  }

  const packageResult = {
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    releaseDecision: blockers.length === 0 ? "ready" : "blocked",
    artifacts: {
      preflight: preflightFile,
      postPilotEvidenceJson: reportFile,
      postPilotEvidenceMarkdown: markdownFile,
      fieldEvidence: fieldFile,
    },
    pilot: {
      branches: manifest?.pilot?.branches?.map((branch) => branch.name) ?? [],
      startsOn: manifest?.pilot?.period?.startsOn ?? null,
      endsOn: manifest?.pilot?.period?.endsOn ?? null,
      signedOffBy: manifest?.pilot?.signedOffBy ?? null,
      signedOffAt: manifest?.pilot?.signedOffAt ?? null,
    },
    counts: {
      operationDays: report?.counts?.operationDays ?? null,
      verifiedOperationDays: report?.counts?.verifiedOperationDays ?? null,
      attendanceRecordsLogged: report?.counts?.attendanceRecordsLogged ?? null,
      paymentChecksLogged: report?.counts?.paymentChecksLogged ?? null,
      noticeFollowupChecksLogged: report?.counts?.noticeFollowupChecksLogged ?? null,
      noticeChecksLogged: report?.counts?.noticeChecksLogged ?? null,
    },
    checked: [
      "post-pilot strict preflight artifact",
      "post-pilot pilot:evidence JSON readiness",
      "post-pilot Markdown evidence summary",
      "field evidence manifest validation",
      "artifact path consistency",
      "final PM signoff carried into closeout package",
    ],
    fieldEvidenceChecked: fieldEvidence?.checked ?? [],
    blockers,
  };

  if (outFile) {
    await writeFile(path.resolve(outFile), `${JSON.stringify(packageResult, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(packageResult, null, 2));

  if (blockers.length > 0) {
    process.exitCode = 1;
  }
}

await main();
