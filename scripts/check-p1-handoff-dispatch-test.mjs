import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-handoff-dispatch-"));
const rawPaymentSecret = "sk_live_finaljudo_dispatch_secret_that_must_not_be_written";

await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-draft-workspace.mjs",
    `--out-dir=${directory}`,
    "--production-origin=https://app.finaljudo.kr",
    "--payment-checkout-base-url=https://pay.finaljudo.kr",
  ],
  { cwd: process.cwd() },
);

const bundlePath = path.join(directory, "p1-handoff-bundle-manifest.json");
await execFile(process.execPath, ["scripts/check-p1-handoff-bundle.mjs", `--workspace=${directory}`, `--out=${bundlePath}`], {
  cwd: process.cwd(),
});

const receiptPath = path.join(directory, "p1-handoff-dispatch-receipt.json");
const markdownPath = path.join(directory, "p1-handoff-dispatch-receipt.md");
const csvPath = path.join(directory, "p1-handoff-dispatch-receipt.csv");
const draftResult = await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-dispatch-draft.mjs",
    `--bundle=${bundlePath}`,
    `--out=${receiptPath}`,
    `--markdown=${markdownPath}`,
    `--csv=${csvPath}`,
  ],
  { cwd: process.cwd() },
);
const draft = JSON.parse(draftResult.stdout);

assert.equal(draft.releaseDecision, "blocked");
assert.equal(draft.ownerPackages.length, 6);
assert.equal(draft.summary.acknowledged, 0);
assert.equal(draft.bundleManifest.releaseDecision, "ready");
assert.equal(draft.bundleManifest.p1ReleaseDecision, "blocked");
assert.equal(draft.outputPaths.csv, path.relative(process.cwd(), csvPath));
assert.equal(draft.outputPaths.completedReceipt, path.relative(process.cwd(), path.join(directory, "p1-handoff-dispatch-receipt.completed.json")));
assert((await readFile(markdownPath, "utf8")).includes("P1 Handoff Dispatch Receipt"));
const csvSource = await readFile(csvPath, "utf8");
assert(csvSource.includes("packageDir,ownerRole,totalActions,packageManifestSha256,packageManifestSizeBytes"));
assert(csvSource.includes("TODO real owner name"));
assert.equal(csvSource.trim().split("\n").length, 7);

let draftFailed = false;
try {
  await execFile(
    process.execPath,
    ["scripts/check-p1-handoff-dispatch.mjs", `--file=${receiptPath}`, `--bundle=${bundlePath}`, `--out=${path.join(directory, "draft-report.json")}`],
    { cwd: process.cwd() },
  );
} catch (error) {
  draftFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_DISPATCH_ASSIGNMENT_FIELD_MISSING"));
  assert(stdoutSource.includes("P1_HANDOFF_DISPATCH_ACKNOWLEDGEMENT_PENDING"));
}

assert.equal(draftFailed, true, "dispatch draft must stay blocked until owner delivery evidence is filled");

const completed = {
  ...draft,
  releaseDecision: "ready",
  ownerPackages: draft.ownerPackages.map((ownerPackage, index) => ({
    ...ownerPackage,
    assignment: {
      assignedToName: `${ownerPackage.ownerRole} 실무 담당자`,
      assignedToContact: `owner-${index + 1}@finaljudo.kr`,
      channel: "GitHub issue and Slack channel",
      assignedAt: "2026-07-01T09:00:00.000Z",
      dueAt: "2026-07-02T18:00:00.000Z",
      evidence: `https://github.com/antoe-prog/ant/issues/${101 + index}`,
    },
    acknowledgement: {
      status: "acknowledged",
      acknowledgedAt: "2026-07-01T10:00:00.000Z",
      evidence: `https://github.com/antoe-prog/ant/issues/${101 + index}#issuecomment-${9001 + index}`,
    },
  })),
};

await writeFile(receiptPath, `${JSON.stringify(completed, null, 2)}\n`);

const readyResult = await execFile(
  process.execPath,
  ["scripts/check-p1-handoff-dispatch.mjs", `--file=${receiptPath}`, `--bundle=${bundlePath}`, `--out=${path.join(directory, "ready-report.json")}`],
  { cwd: process.cwd() },
);
const readyReport = JSON.parse(readyResult.stdout);

assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert.equal(readyReport.p1ReleaseDecision, "blocked");
assert.equal(readyReport.summary.ownerPackages, 6);
assert.equal(readyReport.summary.acknowledged, 6);
assert(readyReport.summary.totalActions > 100);

const looseTimestamp = {
  ...completed,
  ownerPackages: completed.ownerPackages.map((ownerPackage, index) =>
    index === 0
      ? {
          ...ownerPackage,
          assignment: {
            ...ownerPackage.assignment,
            assignedAt: "July 1, 2026 09:00",
          },
        }
      : ownerPackage,
  ),
};
await writeFile(receiptPath, `${JSON.stringify(looseTimestamp, null, 2)}\n`);

let looseTimestampFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-handoff-dispatch.mjs",
      `--file=${receiptPath}`,
      `--bundle=${bundlePath}`,
      `--out=${path.join(directory, "loose-timestamp-report.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  looseTimestampFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_DISPATCH_ASSIGNED_AT_INVALID"));
}

assert.equal(looseTimestampFailed, true, "dispatch receipt validator must reject non-ISO date-time values");

const invalidEvidence = {
  ...completed,
  ownerPackages: completed.ownerPackages.map((ownerPackage, index) =>
    index === 0
      ? {
          ...ownerPackage,
          assignment: {
            ...ownerPackage.assignment,
            evidence: "delivered verbally",
          },
          acknowledgement: {
            ...ownerPackage.acknowledgement,
            evidence: "acknowledged verbally",
          },
        }
      : ownerPackage,
  ),
};
await writeFile(receiptPath, `${JSON.stringify(invalidEvidence, null, 2)}\n`);

let invalidEvidenceFailed = false;
try {
  await execFile(
    process.execPath,
    [
      "scripts/check-p1-handoff-dispatch.mjs",
      `--file=${receiptPath}`,
      `--bundle=${bundlePath}`,
      `--out=${path.join(directory, "invalid-evidence-report.json")}`,
    ],
    { cwd: process.cwd() },
  );
} catch (error) {
  invalidEvidenceFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_DISPATCH_ASSIGNMENT_EVIDENCE_INVALID"));
  assert(stdoutSource.includes("P1_HANDOFF_DISPATCH_ACK_EVIDENCE_INVALID"));
}

assert.equal(invalidEvidenceFailed, true, "dispatch receipt validator must reject non-reference evidence values");

const tampered = {
  ...completed,
  ownerPackages: completed.ownerPackages.map((ownerPackage, index) =>
    index === 0
      ? {
          ...ownerPackage,
          acknowledgement: {
            ...ownerPackage.acknowledgement,
            evidence: rawPaymentSecret,
          },
        }
      : ownerPackage,
  ),
};
await writeFile(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`);

let secretFailed = false;
try {
  await execFile(
    process.execPath,
    ["scripts/check-p1-handoff-dispatch.mjs", `--file=${receiptPath}`, `--bundle=${bundlePath}`, `--out=${path.join(directory, "secret-report.json")}`],
    { cwd: process.cwd() },
  );
} catch (error) {
  secretFailed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_DISPATCH_SECRET_LIKE_VALUE"));
}

assert.equal(secretFailed, true, "dispatch receipt validator must reject raw secret-like values");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "dispatch draft is generated from a ready handoff bundle",
        "draft receipt remains blocked until every owner assignment and acknowledgement is filled",
        "completed dispatch receipt passes with six acknowledged owner packages",
        "bundle/package manifest hashes are preserved",
        "non-ISO timestamps and non-reference evidence values are rejected",
        "raw secret-like values inside dispatch receipt are rejected",
      ],
      ownerPackages: readyReport.summary.ownerPackages,
      acknowledged: readyReport.summary.acknowledged,
    },
    null,
    2,
  ),
);
