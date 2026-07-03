import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-android-handoff-"));
const validProductionOrigin = "https://app.finaljudo.kr";
const validReleaseSha256 = "10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F:20:21:22:23:24:25:26:27:28:29:2A:2B:2C:2D:2E:2F";

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

async function runHandoff(filePath, extraArgs = []) {
  const { stdout } = await execFile(process.execPath, ["scripts/check-android-release-handoff.mjs", `--file=${filePath}`, ...extraArgs], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

async function expectFailure(filePath) {
  try {
    await runHandoff(filePath);
  } catch (error) {
    assert.notEqual(error.code, 0, "invalid handoff should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid handoff unexpectedly passed");
}

function collectEvidenceTemplateValues(value, values = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEvidenceTemplateValues(item, values);
    }
    return values;
  }

  if (!value || typeof value !== "object") {
    return values;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "evidence") {
      values.push(child);
    }
    collectEvidenceTemplateValues(child, values);
  }

  return values;
}

async function assertEvidenceUriTemplate(filePath) {
  const template = JSON.parse(await readFile(filePath, "utf8"));
  const evidenceValues = collectEvidenceTemplateValues(template);
  assert(evidenceValues.length > 0, `${filePath} should include evidence placeholders`);
  assert(
    evidenceValues.every((value) => typeof value === "string" && /^TODO_[A-Z0-9_]+_EVIDENCE_URI$/.test(value)),
    `${filePath} evidence placeholders must point operators to URI evidence fields`,
  );
}

const doctorReport = await writeFixture(
  "android-twa-doctor.json",
  JSON.stringify(
    {
      ok: true,
      checks: {
        origin: { ok: true, value: validProductionOrigin },
        sha256: { ok: true, value: validReleaseSha256 },
      },
      blockers: [],
    },
    null,
    2,
  ),
);
const assetLinks = await writeFixture("assetlinks.json", JSON.stringify([{ relation: ["delegate_permission/common.handle_all_urls"] }], null, 2));
const buildPlan = await writeFixture("build-plan.json", JSON.stringify({ outputs: ["apk", "aab"] }, null, 2));
const apk = await writeFixture("app-release-signed.apk", "signed apk fixture");
const aab = await writeFixture("app-release-bundle.aab", "signed aab fixture");

const validHandoff = {
  schemaVersion: 1,
  generatedAt: "2026-07-16T02:20:00.000Z",
  packageName: "kr.co.finaljudo.multigym",
  productionOrigin: validProductionOrigin,
  releaseSha256: validReleaseSha256,
  workflow: {
    source: "github-actions",
    runUrl: "https://github.com/antoe-prog/ant/actions/runs/123456789",
    artifactName: "final-judo-android-twa",
    buildArtifacts: true,
    evidence: "https://github.com/antoe-prog/ant/actions/runs/123456789",
  },
  artifacts: {
    doctorReport,
    assetLinks,
    buildPlan,
    apk,
    aab,
  },
  digitalAssetLinks: {
    deployedUrl: `${validProductionOrigin}/.well-known/assetlinks.json`,
    verified: true,
    evidence: "https://evidence.finaljudo.kr/android/assetlinks-curl",
  },
  signing: {
    playAppSigningDecision: "google-play-app-signing",
    keystoreCustody: "secret-store",
    uploadKeyOwner: "정유진",
    keystoreNotCommitted: true,
    evidence: "drive://final-judo/evidence/android/signing-custody",
  },
  deviceSmoke: {
    device: "Galaxy S24 Chrome installed TWA",
    installed: true,
    loginVerified: true,
    coachAttendanceVerified: true,
    notificationPermissionChecked: true,
    noBrowserAddressBar: true,
    noHorizontalOverflow: true,
    evidence: "https://evidence.finaljudo.kr/android/device-smoke-recording",
  },
  signoff: {
    signedOffBy: "정유진",
    signedOffAt: "2026-07-16T03:00:00.000Z",
    evidence: "https://evidence.finaljudo.kr/android/signoff",
  },
};

const validPath = path.join(directory, "android-release-handoff.valid.json");
const validReportPath = path.join(directory, "android-release-handoff.report.json");
await writeFile(validPath, `${JSON.stringify(validHandoff, null, 2)}\n`);

const validReport = await runHandoff(validPath, [`--out=${validReportPath}`]);
assert.equal(validReport.ok, true);
assert.equal(validReport.releaseDecision, "ready");
assert.equal(validReport.partial.webAppOrigin.ready, true);
assert.equal(validReport.partial.webAppOrigin.productionOrigin, validHandoff.productionOrigin);
assert.equal(validReport.partial.webAppOrigin.assetLinksUrl, validHandoff.digitalAssetLinks.deployedUrl);
assert.equal(JSON.parse(await readFile(validReportPath, "utf8")).ok, true);

const partialWebOriginPath = path.join(directory, "android-release-handoff.partial-web-origin.json");
const partialWebOriginHandoff = structuredClone(validHandoff);
partialWebOriginHandoff.releaseSha256 = "TODO_RELEASE_SHA256";
partialWebOriginHandoff.deviceSmoke.installed = false;
partialWebOriginHandoff.deviceSmoke.loginVerified = false;
partialWebOriginHandoff.deviceSmoke.coachAttendanceVerified = false;
partialWebOriginHandoff.deviceSmoke.notificationPermissionChecked = false;
partialWebOriginHandoff.deviceSmoke.noBrowserAddressBar = false;
partialWebOriginHandoff.deviceSmoke.noHorizontalOverflow = false;
partialWebOriginHandoff.signoff.signedOffBy = "TODO_SIGNOFF_OWNER";
partialWebOriginHandoff.signoff.signedOffAt = "YYYY-MM-DDTHH:mm:ssZ";
await writeFile(partialWebOriginPath, `${JSON.stringify(partialWebOriginHandoff, null, 2)}\n`);
const partialWebOriginReport = await runHandoff(partialWebOriginPath, ["--allow-pending"]);
assert.equal(partialWebOriginReport.ok, false);
assert.equal(partialWebOriginReport.releaseDecision, "blocked");
assert.equal(partialWebOriginReport.partial.webAppOrigin.ready, true);
assert(partialWebOriginReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_RELEASE_FINGERPRINT"));
assert(partialWebOriginReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_DEVICE_SMOKE"));

const placeholderOriginPath = path.join(directory, "android-release-handoff.placeholder-origin.json");
const placeholderOriginHandoff = structuredClone(validHandoff);
placeholderOriginHandoff.productionOrigin = "https://ops.finaljudo.example";
placeholderOriginHandoff.digitalAssetLinks.deployedUrl = "https://ops.finaljudo.example/.well-known/assetlinks.json";
await writeFile(placeholderOriginPath, `${JSON.stringify(placeholderOriginHandoff, null, 2)}\n`);
const placeholderOriginReport = await expectFailure(placeholderOriginPath);
assert(placeholderOriginReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_ORIGIN"));
assert.equal(placeholderOriginReport.partial.webAppOrigin.ready, false);

const apiOriginPath = path.join(directory, "android-release-handoff.api-origin.json");
const apiOriginHandoff = structuredClone(validHandoff);
apiOriginHandoff.productionOrigin = "https://api.finaljudo.co.kr";
apiOriginHandoff.digitalAssetLinks.deployedUrl = "https://api.finaljudo.co.kr/.well-known/assetlinks.json";
await writeFile(apiOriginPath, `${JSON.stringify(apiOriginHandoff, null, 2)}\n`);
const apiOriginReport = await expectFailure(apiOriginPath);
assert(apiOriginReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_API_ORIGIN"));
assert.equal(apiOriginReport.partial.webAppOrigin.ready, false);
assert.match(
  apiOriginReport.blockers.find((blocker) => blocker.code === "ANDROID_HANDOFF_API_ORIGIN")?.message ?? "",
  /web app origin/,
);

const missingAabPath = path.join(directory, "android-release-handoff.missing-aab.json");
const missingAabHandoff = structuredClone(validHandoff);
delete missingAabHandoff.artifacts.aab;
await writeFile(missingAabPath, `${JSON.stringify(missingAabHandoff, null, 2)}\n`);
const missingAabReport = await expectFailure(missingAabPath);
assert(missingAabReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_ARTIFACT_MISSING" && blocker.detail?.key === "aab"));

const wrongHashPath = path.join(directory, "android-release-handoff.bad-hash.json");
const wrongHashHandoff = structuredClone(validHandoff);
wrongHashHandoff.artifacts.apk.sha256 = "0".repeat(64);
await writeFile(wrongHashPath, `${JSON.stringify(wrongHashHandoff, null, 2)}\n`);
const wrongHashReport = await expectFailure(wrongHashPath);
assert(wrongHashReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_ARTIFACT_SHA_MISMATCH"));

const templateReport = await runHandoff("mobile/android/release-handoff.template.json", ["--allow-pending"]);
assert.equal(templateReport.ok, false);
assert(templateReport.blockers.some((blocker) => blocker.code.startsWith("ANDROID_HANDOFF_")));
await assertEvidenceUriTemplate("mobile/android/release-handoff.template.json");

const looseEvidencePath = path.join(directory, "android-release-handoff.loose-evidence.json");
const looseEvidenceHandoff = structuredClone(validHandoff);
looseEvidenceHandoff.deviceSmoke.evidence = "Android installation and coach attendance screen recording";
await writeFile(looseEvidencePath, `${JSON.stringify(looseEvidenceHandoff, null, 2)}\n`);
const looseEvidenceReport = await expectFailure(looseEvidencePath);
assert(looseEvidenceReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_DEVICE_EVIDENCE"));

const browserAddressBarPath = path.join(directory, "android-release-handoff.browser-address-bar.json");
const browserAddressBarHandoff = structuredClone(validHandoff);
browserAddressBarHandoff.deviceSmoke.noBrowserAddressBar = false;
await writeFile(browserAddressBarPath, `${JSON.stringify(browserAddressBarHandoff, null, 2)}\n`);
const browserAddressBarReport = await expectFailure(browserAddressBarPath);
assert(
  browserAddressBarReport.blockers.some(
    (blocker) => blocker.code === "ANDROID_HANDOFF_DEVICE_SMOKE" && blocker.detail?.key === "noBrowserAddressBar",
  ),
);

const looseTimestampPath = path.join(directory, "android-release-handoff.loose-timestamp.json");
const looseTimestampHandoff = structuredClone(validHandoff);
looseTimestampHandoff.generatedAt = "July 16, 2026 02:20";
looseTimestampHandoff.signoff.signedOffAt = "July 16, 2026 03:00";
await writeFile(looseTimestampPath, `${JSON.stringify(looseTimestampHandoff, null, 2)}\n`);
const looseTimestampReport = await expectFailure(looseTimestampPath);
assert(looseTimestampReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_GENERATED_AT"));
assert(looseTimestampReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_SIGNOFF_AT"));

const signoffBeforeGeneratedPath = path.join(directory, "android-release-handoff.signoff-before-generated.json");
const signoffBeforeGeneratedHandoff = structuredClone(validHandoff);
signoffBeforeGeneratedHandoff.signoff.signedOffAt = "2026-07-16T02:19:59.000Z";
await writeFile(signoffBeforeGeneratedPath, `${JSON.stringify(signoffBeforeGeneratedHandoff, null, 2)}\n`);
const signoffBeforeGeneratedReport = await expectFailure(signoffBeforeGeneratedPath);
assert(signoffBeforeGeneratedReport.blockers.some((blocker) => blocker.code === "ANDROID_HANDOFF_SIGNOFF_TIMELINE"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "valid Android release handoff",
        "report output",
        "partial web app origin evidence while strict Android handoff remains blocked",
        "placeholder production origin blocker",
        "API-only-looking production origin blocker",
        "missing AAB blocker",
        "artifact hash mismatch blocker",
        "template pending blocker coverage",
        "template evidence URI placeholders",
        "non-reference evidence blocker",
        "browser address bar smoke blocker",
        "non-ISO timestamp blocker",
        "signoff before generatedAt blocker",
      ],
    },
    null,
    2,
  ),
);
