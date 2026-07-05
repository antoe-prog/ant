import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const mobileBuildsDir = path.join(rootDir, ".data", "mobile-builds");
const androidBuildGradlePath = path.join(rootDir, "mobile", "android-cap", "app", "build.gradle");
const capacitorConfigPath = path.join(
  rootDir,
  "mobile",
  "android-cap",
  "app",
  "src",
  "main",
  "assets",
  "capacitor.config.json",
);
const playReleaseDocPaths = [
  "docs/ANDROID_PACKAGING_STRATEGY.md",
  "docs/QA_TEST_PLAN.md",
  "docs/RELEASE_CHECKLIST.md",
  "docs/IMPLEMENTATION_BACKLOG.md",
];
const expectedPackageName = "kr.co.finaljudo.multigym";
const expectedLaunchUrl = "https://final-judo.vercel.app/login";

function rel(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/") || ".";
}

function resolveArtifactPath(value) {
  assert.equal(typeof value, "string", "Play release report artifact paths must be strings.");
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function findLatestPlayReleaseReport() {
  const entries = await readdir(mobileBuildsDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && /^android-play-release-\d{14}$/.test(entry.name))
    .map((entry) => path.join(mobileBuildsDir, entry.name, "google-play-release-report.json"))
    .filter((candidate) => existsSync(candidate))
    .sort((left, right) => right.localeCompare(left));

  assert(candidates.length > 0, "At least one Android Play release report must exist after android:play:build.");
  return candidates[0];
}

function parseGradleVersion(source) {
  const versionCode = Number(source.match(/versionCode\s+(\d+)/)?.[1] ?? 0);
  const versionName = source.match(/versionName\s+"([^"]+)"/)?.[1] ?? "";

  assert(versionCode > 0, "mobile/android-cap/app/build.gradle must define a positive versionCode.");
  assert(versionName, "mobile/android-cap/app/build.gradle must define versionName.");

  return { versionCode, versionName };
}

async function assertFileShaAndSize(filePath, expectedSha, expectedSize, label) {
  const stats = await stat(filePath);
  const actualSha = await sha256File(filePath);

  assert.equal(actualSha, expectedSha, `${label} SHA-256 must match the latest Play release report.`);
  assert.equal(stats.size, expectedSize, `${label} byte size must match the latest Play release report.`);

  return { path: filePath, sizeBytes: stats.size, sha256: actualSha };
}

const reportPath = await findLatestPlayReleaseReport();
const [reportSource, gradleSource, capacitorConfigSource, ...playReleaseDocSources] = await Promise.all([
  readFile(reportPath, "utf8"),
  readFile(androidBuildGradlePath, "utf8"),
  readFile(capacitorConfigPath, "utf8"),
  ...playReleaseDocPaths.map((docPath) => readFile(path.join(rootDir, docPath), "utf8")),
]);
const report = JSON.parse(reportSource);
const gradleVersion = parseGradleVersion(gradleSource);
const capacitorConfig = JSON.parse(capacitorConfigSource);
const reportRelPath = rel(reportPath);
const reportDirName = path.basename(path.dirname(reportPath));
const reportStamp = reportDirName.replace(/^android-play-release-/, "");

assert.equal(report.ok, true, "Latest Android Play release report must be ok.");
assert.equal(report.packageName, expectedPackageName, "Latest Android Play release package name must stay stable.");
assert.equal(report.launchUrl, expectedLaunchUrl, "Latest Android Play release must launch the production login URL.");
assert.equal(report.versionCode, gradleVersion.versionCode, "Latest Android Play report versionCode must match Gradle.");
assert.equal(report.versionName, gradleVersion.versionName, "Latest Android Play report versionName must match Gradle.");
assert.equal(capacitorConfig.server?.url, expectedLaunchUrl, "Synced Android Capacitor config must target production login URL.");

const aabPath = resolveArtifactPath(report.artifacts?.aab);
const apkPath = resolveArtifactPath(report.artifacts?.apk);
const desktopAabPath = resolveArtifactPath(report.artifacts?.desktopAab);
const desktopApkPath = resolveArtifactPath(report.artifacts?.desktopApk);
const verificationAabPath = resolveArtifactPath(report.artifacts?.verificationAab);
const verificationApkPath = resolveArtifactPath(report.artifacts?.verificationApk);
const fileListPath = resolveArtifactPath(report.artifacts?.fileList);
const apkBadgingPath = resolveArtifactPath(report.artifacts?.apkBadging);

const [aab, apk, desktopAab, desktopApk, aabVerify, apkVerify, fileList, apkBadging] = await Promise.all([
  assertFileShaAndSize(aabPath, report.sha256?.aab, report.sizes?.aabBytes, "Timestamped AAB"),
  assertFileShaAndSize(apkPath, report.sha256?.apk, report.sizes?.apkBytes, "Timestamped APK"),
  assertFileShaAndSize(desktopAabPath, report.sha256?.aab, report.sizes?.aabBytes, "Desktop AAB"),
  assertFileShaAndSize(desktopApkPath, report.sha256?.apk, report.sizes?.apkBytes, "Desktop APK"),
  readFile(verificationAabPath, "utf8"),
  readFile(verificationApkPath, "utf8"),
  readFile(fileListPath, "utf8"),
  readFile(apkBadgingPath, "utf8"),
]);

assert.equal(report.sha256?.desktopAab, report.sha256?.aab, "Desktop AAB hash in report must equal timestamped AAB hash.");
assert.equal(report.sha256?.desktopApk, report.sha256?.apk, "Desktop APK hash in report must equal timestamped APK hash.");
assert.match(aabVerify, /jar verified\./, "AAB jarsigner verification file must prove the bundle is verified.");
assert.match(apkVerify, /Signer #1 certificate SHA-256 digest/, "APK apksigner verification file must include signer SHA-256.");
assert.match(apkBadging, /package: name='kr\.co\.finaljudo\.multigym'/, "APK badging must keep the Google Play package name.");
assert.match(apkBadging, new RegExp(`versionCode='${gradleVersion.versionCode}'`), "APK badging must keep the current versionCode.");
assert.match(apkBadging, new RegExp(`versionName='${gradleVersion.versionName}'`), "APK badging must keep the current versionName.");
assert.doesNotMatch(fileList, /androidbrowserhelper|customtabs\.trusted|TrustedWebActivity/i, "Play release AAB must not include TWA/Custom Tabs runtime entries.");

for (const [index, source] of playReleaseDocSources.entries()) {
  const docPath = playReleaseDocPaths[index];
  assert(
    source.includes(reportRelPath),
    `${docPath} must reference the latest Android Play release report ${reportRelPath}.`,
  );
  assert(
    source.includes(`versionCode ${gradleVersion.versionCode}`),
    `${docPath} must reference the current Android Play versionCode ${gradleVersion.versionCode}.`,
  );
  assert(
    source.includes(`versionName ${gradleVersion.versionName}`),
    `${docPath} must reference the current Android Play versionName ${gradleVersion.versionName}.`,
  );
}

const combinedPlayReleaseDocs = playReleaseDocSources.join("\n");
const staleReportPattern = new RegExp(`android-play-release-(?!${reportStamp})\\d{14}`);
const staleVersionCodePattern = new RegExp(`versionCode (?!${gradleVersion.versionCode}\\b)\\d+`);
const staleVersionNamePattern = new RegExp(`versionName (?!${gradleVersion.versionName.replaceAll(".", "\\.")}\\b)\\d+\\.\\d+\\.\\d+`);

assert.doesNotMatch(
  combinedPlayReleaseDocs,
  staleReportPattern,
  "Android Play docs must not keep stale timestamped release report paths that can mislead upload selection.",
);
assert.doesNotMatch(
  combinedPlayReleaseDocs,
  staleVersionCodePattern,
  "Android Play docs must not keep stale versionCode values that can mislead upload selection.",
);
assert.doesNotMatch(
  combinedPlayReleaseDocs,
  staleVersionNamePattern,
  "Android Play docs must not keep stale versionName values that can mislead upload selection.",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "latest timestamped Android Play release report exists",
        "Gradle versionCode/versionName match latest report",
        "Capacitor Android server.url targets deployed production login",
        "timestamped AAB/APK sizes and SHA-256 match report",
        "Desktop AAB/APK copies match timestamped artifacts",
        "AAB jarsigner verification and APK apksigner verification exist",
        "APK badging keeps package name and version",
        "AAB listing has no TWA/Custom Tabs runtime entries",
        "Android Play docs reference the latest report and current version only",
      ],
      report: {
        path: reportRelPath,
        generatedAt: report.generatedAt,
        packageName: report.packageName,
        versionCode: report.versionCode,
        versionName: report.versionName,
        launchUrl: report.launchUrl,
      },
      artifacts: {
        aab: { path: rel(aab.path), sizeBytes: aab.sizeBytes, sha256: aab.sha256 },
        apk: { path: rel(apk.path), sizeBytes: apk.sizeBytes, sha256: apk.sha256 },
        desktopAab: { path: desktopAab.path, sizeBytes: desktopAab.sizeBytes, sha256: desktopAab.sha256 },
        desktopApk: { path: desktopApk.path, sizeBytes: desktopApk.sizeBytes, sha256: desktopApk.sha256 },
      },
      releaseDecision: "artifact_ready_release_handoff_still_required",
    },
    null,
    2,
  ),
);
