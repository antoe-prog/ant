import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const directory = await mkdtemp(path.join(os.tmpdir(), "final-judo-p1-evidence-intake-"));
const workspace = path.join(directory, "workspace");

async function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${script} exited ${code}\n${stdout}\n${stderr}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function parseJsonOutput(stdout) {
  const start = stdout.indexOf("{");
  assert.notEqual(start, -1, "script must print JSON");
  return JSON.parse(stdout.slice(start));
}

await runNode("scripts/create-p1-handoff-draft-workspace.mjs", [`--out-dir=${workspace}`, "--github-repo=antoe-prog/ant"]);
const draftRun = await runNode("scripts/create-p1-evidence-intake-draft.mjs", [`--workspace=${workspace}`]);
const draftReport = parseJsonOutput(draftRun.stdout);

assert.equal(draftReport.releaseDecision, "blocked");
assert.equal(draftReport.summary.total, 7);
assert.equal(draftReport.summary.missing, 0);
assert.equal(draftReport.summary.blocked, 7);
assert.equal(draftReport.rows.length, 7);
assert.deepEqual(
  draftReport.rows.map((row) => row.key),
  ["deployment", "android", "iosIpa", "paymentProvider", "notificationPush", "issueRegistration", "pilot"],
);
assert.deepEqual(
  draftReport.rows.map((row) => row.lane),
  ["DevOps/총괄 PM", "Android/Release", "iOS/Release", "Backend/Data", "Frontend/QA", "Product Lead", "QA/Release"],
);
assert(draftReport.rows.every((row) => row.intake.evidenceOwner === "TODO owner name"));
assert(draftReport.rows.every((row) => row.strictCommand.includes("npm run ")));
assert(draftReport.outputs.json.endsWith("p1-evidence-intake-draft.json"));
assert(draftReport.outputs.csv.endsWith("p1-evidence-intake-draft.csv"));
assert(draftReport.outputs.markdown.endsWith("p1-evidence-intake-draft.md"));

const jsonSource = await readFile(path.join(workspace, "p1-evidence-intake-draft.json"), "utf8");
const csvSource = await readFile(path.join(workspace, "p1-evidence-intake-draft.csv"), "utf8");
const markdownSource = await readFile(path.join(workspace, "p1-evidence-intake-draft.md"), "utf8");

assert(jsonSource.includes('"requiredEvidence"'));
assert(csvSource.startsWith("key,label,lane,status,releaseDecision"));
assert(csvSource.includes("Android/Release"));
assert(csvSource.includes("iOS/Release"));
assert(markdownSource.includes("# P1 Evidence Intake Draft"));
assert(markdownSource.includes("7"));
assert(markdownSource.includes("DevOps/총괄 PM"));
assert(markdownSource.includes("p1-handoff-issue-registration-receipt.json"));

const secretWorkspace = path.join(directory, "secret-workspace");
const secretReadiness = path.join(secretWorkspace, "p1-readiness.json");
await mkdir(secretWorkspace, { recursive: true });
await writeFile(
  secretReadiness,
  JSON.stringify(
    {
      releaseDecision: "blocked",
      requirements: {
        deployment: {
          status: "blocked",
          path: path.join(secretWorkspace, "deployment-handoff.report.json"),
          nextAction: "Store whsec_live_SUPERSECRET and FinalJudoPilot!2026 before signoff",
          releaseDecision: "blocked",
          blockerCount: 1,
          blockerCodes: ["DEPLOYMENT_SECRET"],
        },
      },
    },
    null,
    2,
  ),
);
await runNode("scripts/create-p1-evidence-intake-draft.mjs", [`--workspace=${secretWorkspace}`]);
const secretOutput = [
  await readFile(path.join(secretWorkspace, "p1-evidence-intake-draft.json"), "utf8"),
  await readFile(path.join(secretWorkspace, "p1-evidence-intake-draft.csv"), "utf8"),
  await readFile(path.join(secretWorkspace, "p1-evidence-intake-draft.md"), "utf8"),
].join("\n");

assert(!secretOutput.includes("whsec_live_SUPERSECRET"));
assert(!secretOutput.includes("FinalJudoPilot!2026"));
assert(secretOutput.includes("[redacted-secret]"));
assert(secretOutput.includes("[redacted-password]"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "P1 evidence intake draft creates JSON/CSV/Markdown from readiness workspace",
        "seven final readiness requirements are mapped to team lanes",
        "operator intake TODO fields are preserved",
        "secret-like values are redacted from generated intake outputs",
      ],
      rows: draftReport.rows.length,
    },
    null,
    2,
  ),
);
