import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-android-handoff-draft-"));
const releaseSha256 = "10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F:20:21:22:23:24:25:26:27:28:29:2A:2B:2C:2D:2E:2F";
const productionOrigin = "https://app.finaljudo.kr";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function writeFixture(relativePath, content) {
  const filePath = path.join(directory, relativePath);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  await writeFile(filePath, buffer);
  return {
    path: filePath,
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
  };
}

async function runScript(script, args) {
  const { stdout } = await execFile(process.execPath, [script, ...args], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

const doctor = await writeFixture(
  "android-twa-doctor.json",
  JSON.stringify(
    {
      ok: true,
      checks: {
        origin: { ok: true, value: productionOrigin },
        sha256: { ok: true, value: releaseSha256 },
      },
      blockers: [],
    },
    null,
    2,
  ),
);
const assetLinks = await writeFixture(
  "assetlinks.json",
  JSON.stringify(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "kr.co.finaljudo.multigym",
          sha256_cert_fingerprints: [releaseSha256],
        },
      },
    ],
    null,
    2,
  ),
);
const buildPlan = await writeFixture(
  "build-plan.json",
  JSON.stringify({ origin: productionOrigin, packageName: "kr.co.finaljudo.multigym", outputs: ["apk", "aab"] }, null, 2),
);
const apk = await writeFixture("app-release-signed.apk", "signed apk fixture");
const aab = await writeFixture("app-release-bundle.aab", "signed aab fixture");
const draftPath = path.join(directory, "android-release-handoff.json");

const draftReport = await runScript("scripts/create-android-release-handoff-draft.mjs", [
  `--doctor=${doctor.path}`,
  `--assetlinks=${assetLinks.path}`,
  `--build-plan=${buildPlan.path}`,
  `--apk=${apk.path}`,
  `--aab=${aab.path}`,
  `--out=${draftPath}`,
  "--workflow-run-url=https://github.com/antoe-prog/ant/actions/runs/123456789",
  "--workflow-evidence=https://github.com/antoe-prog/ant/actions/runs/123456789",
  "--assetlinks-verified",
  "--assetlinks-evidence=https://evidence.finaljudo.kr/android/assetlinks-curl",
  "--upload-key-owner=정유진",
  "--signing-evidence=drive://final-judo/evidence/android/signing-custody",
  "--device=Galaxy S24 Chrome installed TWA",
  "--device-smoke-passed",
  "--device-evidence=https://evidence.finaljudo.kr/android/device-smoke-recording",
  "--signed-off-by=정유진",
  "--signed-off-at=2026-07-16T03:00:00.000Z",
  "--signoff-evidence=https://evidence.finaljudo.kr/android/signoff",
]);
assert.equal(draftReport.ok, true);
assert.deepEqual(draftReport.missingArtifacts, []);

const draft = JSON.parse(await readFile(draftPath, "utf8"));
assert.equal(draft.productionOrigin, productionOrigin);
assert.equal(draft.releaseSha256, releaseSha256);
assert.equal(draft.workflow.source, "github-actions");
assert.equal(draft.artifacts.apk.sha256, apk.sha256);
assert.equal(draft.artifacts.aab.sizeBytes, aab.sizeBytes);
assert.equal(draft.deviceSmoke.noBrowserAddressBar, true);

const handoffReport = await runScript("scripts/check-android-release-handoff.mjs", [`--file=${draftPath}`]);
assert.equal(handoffReport.ok, true);
assert.equal(handoffReport.releaseDecision, "ready");

const missingDraftPath = path.join(directory, "android-release-handoff.missing.json");
const missingDraftReport = await runScript("scripts/create-android-release-handoff-draft.mjs", [
  `--doctor=${doctor.path}`,
  `--assetlinks=${assetLinks.path}`,
  `--build-plan=${buildPlan.path}`,
  `--apk=${path.join(directory, "missing.apk")}`,
  `--aab=${path.join(directory, "missing.aab")}`,
  `--out=${missingDraftPath}`,
]);
assert.deepEqual(missingDraftReport.missingArtifacts, ["apk", "aab"]);

const missingDraft = JSON.parse(await readFile(missingDraftPath, "utf8"));
assert.equal(missingDraft.artifacts.apk.sha256, "TODO_SHA256");
assert.equal(missingDraft.artifacts.aab.sizeBytes, 0);

const missingFingerprintDoctor = await writeFixture(
  "android-twa-doctor-missing-fingerprint.json",
  JSON.stringify(
    {
      ok: false,
      checks: {
        origin: { ok: true, value: productionOrigin },
        sha256: { ok: false, reason: "missing --sha256=<release-key-fingerprint>" },
      },
      blockers: [{ check: "sha256", reason: "missing --sha256=<release-key-fingerprint>" }],
    },
    null,
    2,
  ),
);
const missingFingerprintAssetLinks = await writeFixture(
  "assetlinks-missing-fingerprint.json",
  JSON.stringify([{ relation: ["delegate_permission/common.handle_all_urls"] }], null, 2),
);
const missingFingerprintDraftPath = path.join(directory, "android-release-handoff.missing-fingerprint.json");
await runScript("scripts/create-android-release-handoff-draft.mjs", [
  `--doctor=${missingFingerprintDoctor.path}`,
  `--assetlinks=${missingFingerprintAssetLinks.path}`,
  `--build-plan=${buildPlan.path}`,
  `--apk=${apk.path}`,
  `--aab=${aab.path}`,
  `--out=${missingFingerprintDraftPath}`,
]);
const missingFingerprintDraft = JSON.parse(await readFile(missingFingerprintDraftPath, "utf8"));
assert.equal(missingFingerprintDraft.releaseSha256, "TODO_RELEASE_SHA256");
const missingFingerprintHandoffReport = await runScript("scripts/check-android-release-handoff.mjs", [
  `--file=${missingFingerprintDraftPath}`,
  "--allow-pending",
]);
assert.equal(missingFingerprintHandoffReport.ok, false);
assert(missingFingerprintHandoffReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_RELEASE_FINGERPRINT"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "draft inferred origin and fingerprint",
        "artifact hash and size population",
        "draft can pass strict handoff when evidence is supplied",
        "missing APK/AAB draft placeholders",
        "missing release fingerprint remains blocked",
      ],
    },
    null,
    2,
  ),
);
