import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-handoff-bundle-"));
const emptyProfilesDirectory = path.join(directory, "empty-provisioning-profiles");
const rawPaymentSecret = "sk_live_finaljudo_payment_secret_that_must_not_be_written";
const rawVapidPrivateKey = "-----BEGIN PRIVATE KEY-----\nfinal-judo-vapid-private-key\n-----END PRIVATE KEY-----";

await mkdir(emptyProfilesDirectory, { recursive: true });

await execFile(
  process.execPath,
  [
    "scripts/create-p1-handoff-draft-workspace.mjs",
    `--out-dir=${directory}`,
    "--production-origin=https://app.finaljudo.kr",
    "--payment-checkout-base-url=https://pay.finaljudo.kr",
    `--profiles-dir=${emptyProfilesDirectory}`,
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: rawPaymentSecret,
      FINAL_JUDO_VAPID_PUBLIC_KEY: "configured-test-public-key",
      FINAL_JUDO_VAPID_PRIVATE_KEY: rawVapidPrivateKey,
      FINAL_JUDO_VAPID_SUBJECT: "mailto:ops@finaljudo.kr",
    },
  },
);

const bundleOut = path.join(directory, "p1-handoff-bundle-manifest.json");
const { stdout } = await execFile(
  process.execPath,
  ["scripts/check-p1-handoff-bundle.mjs", `--workspace=${directory}`, `--out=${bundleOut}`],
  { cwd: process.cwd() },
);

const report = JSON.parse(stdout);
const reportSource = await readFile(bundleOut, "utf8");

assert.equal(report.ok, true);
assert.equal(report.releaseDecision, "ready");
assert.equal(report.p1ReleaseDecision, "blocked");
assert.equal(report.summary.ownerBriefs, 6);
assert.equal(report.summary.ownerPackages, 6);
assert(report.summary.actionCount > 100);
assert(report.summary.totalArtifacts >= 30);
assert.equal(report.ownerPackages.length, 6);
assert(report.ownerPackages.some((item) => item.packageDir.endsWith("02-mobile-release")));
assert(report.ownerPackages.some((item) => item.packageDir.endsWith("03-ios-release")));
assert(report.ownerPackages.every((item) => item.teamAgentPrompts?.path?.endsWith("team-agent-prompts.md")));
assert(report.artifacts.some((artifact) => artifact.path.endsWith("team-agent-prompts.md")));
assert(report.artifacts.some((artifact) => artifact.key === "ownerPackageIndex"));
assert(report.artifacts.every((artifact) => artifact.sha256?.length === 64));
assert(report.artifacts.every((artifact) => artifact.sizeBytes > 0));
assert(!reportSource.includes(rawPaymentSecret), "bundle manifest must not include raw payment webhook secret");
assert(!reportSource.includes(rawVapidPrivateKey), "bundle manifest must not include raw VAPID private key");

const tamperedBrief = path.join(directory, "p1-handoff-owner-packages", "04-finance-backend", "brief.md");
await writeFile(tamperedBrief, `${await readFile(tamperedBrief, "utf8")}\n${rawPaymentSecret}\n`);

let failed = false;
try {
  await execFile(
    process.execPath,
    ["scripts/check-p1-handoff-bundle.mjs", `--workspace=${directory}`, `--out=${path.join(directory, "tampered-bundle.json")}`],
    { cwd: process.cwd() },
  );
} catch (error) {
  failed = true;
  const stdoutSource = error?.stdout?.toString() ?? "";
  assert(stdoutSource.includes("P1_HANDOFF_BUNDLE_SECRET_LIKE_VALUE"));
}

assert.equal(failed, true, "bundle validator must reject raw secret-like values inside owner packages");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "P1 handoff bundle manifest records owner briefs and package artifacts",
        "P1 team agent prompt is required in every owner package",
        "bundle manifest records SHA-256 hashes and byte sizes",
        "bundle can be ready while underlying P1 release remains blocked by external handoffs",
        "raw webhook and VAPID secrets are not written to the bundle manifest",
        "raw secret-like values inside owner packages are rejected",
      ],
      totalArtifacts: report.summary.totalArtifacts,
    },
    null,
    2,
  ),
);
