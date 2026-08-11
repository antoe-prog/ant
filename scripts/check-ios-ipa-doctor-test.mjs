import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const outputDir = await mkdtemp(path.join(tmpdir(), "final-judo-ios-ipa-doctor-"));
const profilesDir = path.join(outputDir, "profiles");
const profilesWithoutPushDir = path.join(outputDir, "profiles-without-push");
const reportPath = path.join(outputDir, "ios-ipa-doctor.json");
const markdownPath = path.join(outputDir, "ios-ipa-doctor.md");
const apiOriginReportPath = path.join(outputDir, "ios-ipa-doctor.api-origin.json");
const defaultConfigReportPath = path.join(outputDir, "ios-ipa-doctor-default-config.json");
const noPushReportPath = path.join(outputDir, "ios-ipa-doctor-no-push.json");
const buildReportDir = path.join(outputDir, "build-report");
const buildApiOriginReportDir = path.join(outputDir, "build-report-api-origin");
const buildDefaultConfigReportDir = path.join(outputDir, "build-report-default-config");
const buildReportPath = path.join(buildReportDir, "ios-ipa-build-report.json");
const buildApiOriginReportPath = path.join(buildApiOriginReportDir, "ios-ipa-build-report.json");
const buildDefaultConfigReportPath = path.join(buildDefaultConfigReportDir, "ios-ipa-build-report.json");
await mkdir(profilesDir, { recursive: true });
await mkdir(profilesWithoutPushDir, { recursive: true });
const doctorSource = await readFile("scripts/check-ios-ipa-doctor.mjs", "utf8");

const matchingProfile = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Name</key><string>Final Judo Development</string>
  <key>UUID</key><string>00000000-0000-0000-0000-000000000000</string>
  <key>TeamIdentifier</key>
  <array>
    <string>5GWZ792DWH</string>
  </array>
  <key>ExpirationDate</key><date>2027-06-18T00:00:00Z</date>
  <key>Entitlements</key>
  <dict>
    <key>application-identifier</key><string>5GWZ792DWH.kr.co.finaljudo.multigym</string>
    <key>aps-environment</key><string>development</string>
  </dict>
  <key>ProvisionedDevices</key>
  <array>
    <string>00008030-001C2D3E0A000000</string>
  </array>
</dict>
</plist>`;
const appStoreProfile = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Name</key><string>kr.co.finaljudo.multigym App Store Connect</string>
  <key>UUID</key><string>11111111-1111-1111-1111-111111111111</string>
  <key>TeamIdentifier</key>
  <array>
    <string>5GWZ792DWH</string>
  </array>
  <key>ExpirationDate</key><date>2027-08-05T00:00:00Z</date>
  <key>Entitlements</key>
  <dict>
    <key>application-identifier</key><string>5GWZ792DWH.kr.co.finaljudo.multigym</string>
    <key>aps-environment</key><string>production</string>
    <key>get-task-allow</key><false/>
  </dict>
</dict>
</plist>`;
const mismatchedProfile = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Name</key><string>Other App</string>
  <key>TeamIdentifier</key>
  <array>
    <string>5GWZ792DWH</string>
  </array>
  <key>Entitlements</key>
  <dict>
    <key>application-identifier</key><string>5GWZ792DWH.kr.co.finaljudo.other</string>
  </dict>
</dict>
</plist>`;

await writeFile(path.join(profilesDir, "matching.mobileprovision"), matchingProfile);
await writeFile(path.join(profilesDir, "app-store.mobileprovision"), appStoreProfile);
await writeFile(path.join(profilesDir, "mismatched.mobileprovision"), mismatchedProfile);
await writeFile(
  path.join(profilesWithoutPushDir, "app-store-without-push.mobileprovision"),
  appStoreProfile.replace("    <key>aps-environment</key><string>production</string>\n", ""),
);

await execFile(
  process.execPath,
  [
    "scripts/check-ios-ipa-doctor.mjs",
    "--team-id=5GWZ792DWH",
    "--bundle-id=kr.co.finaljudo.multigym",
    "--no-deployed-origin",
    `--profiles-dir=${profilesDir}`,
    `--out=${reportPath}`,
    `--markdown=${markdownPath}`,
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, FINAL_JUDO_IOS_API_ORIGIN: "", FINAL_JUDO_IOS_SERVER_URL: "" },
  },
);

const report = JSON.parse(await readFile(reportPath, "utf8"));
const markdown = await readFile(markdownPath, "utf8");

assert.equal(report.ok, false, "doctor fixture without a production origin must stay blocked");
assert(doctorSource.includes("--no-deployed-origin"), "doctor must support disabling deployed-origin fallback for missing-origin fixtures");
assert(doctorSource.includes(".data/deployment-handoff.report.json"), "doctor must reuse deployment handoff origin when CLI/env origin is absent");
assert(doctorSource.includes(".data/p1-readiness.json"), "doctor must reuse P1 readiness origin when CLI/env origin is absent");
assert.equal(report.releaseDecision, "blocked", "doctor must not mark IPA ready without all release checks");
assert.equal(report.bundleId, "kr.co.finaljudo.multigym", "doctor must preserve the bundle id");
assert.equal(report.checks.appleTeamId.ok, true, "doctor must accept the supplied Apple Team ID");
assert.equal(report.checks.provisioningProfile.ok, true, "matching test provisioning profile must satisfy profile check");
assert.equal(
  report.checks.provisioningProfile.inventory.totalProfileFiles,
  3,
  "doctor must count scanned local provisioning profile files",
);
assert.equal(
  report.checks.provisioningProfile.inventory.matchingAppStoreProfiles,
  1,
  "doctor must recognize App Store distribution profiles without registered devices",
);
assert.equal(
  report.checks.provisioningProfile.inventory.matchingExportMethodProfiles,
  1,
  "doctor must select a profile compatible with the configured App Store export method",
);
assert.equal(
  report.checks.provisioningProfile.inventory.matchingPushEnabledProfiles,
  2,
  "doctor must count matching profiles that include the Push Notifications entitlement",
);
assert.equal(
  report.checks.provisioningProfile.inventory.matchingProfilesWithRegisteredDevices,
  1,
  "doctor must count matching profiles with registered devices",
);
assert(
  report.checks.provisioningProfile.inventory.profiles.every((profile) => !JSON.stringify(profile).includes("00008030")),
  "doctor must not write raw device UDIDs into the profile inventory",
);
assert(
  report.blockers.some((blocker) => blocker.check === "origin"),
  "doctor must block when FINAL_JUDO_IOS_API_ORIGIN/--origin is missing",
);

await execFile(
  process.execPath,
  [
    "scripts/check-ios-ipa-doctor.mjs",
    "--team-id=5GWZ792DWH",
    "--bundle-id=kr.co.finaljudo.multigym",
    "--origin=https://final-judo.vercel.app",
    `--profiles-dir=${profilesWithoutPushDir}`,
    `--out=${noPushReportPath}`,
  ],
  { cwd: process.cwd() },
);
const noPushReport = JSON.parse(await readFile(noPushReportPath, "utf8"));
assert.equal(
  noPushReport.checks.provisioningProfile.ok,
  false,
  "doctor must reject an otherwise matching profile that lacks Push Notifications",
);
assert.match(
  noPushReport.checks.provisioningProfile.reason,
  /aps-environment/,
  "doctor must explain the missing Push Notifications entitlement",
);
assert(Array.isArray(report.resolutionHints.appleDeveloper), "doctor report must expose Apple Developer hints");
assert(Array.isArray(report.resolutionHints.xcode), "doctor report must expose Xcode hints");
assert(Array.isArray(report.resolutionHints.environment), "doctor report must expose environment hints");
assert(
  report.resolutionHints.appleDeveloper.some((hint) => hint.includes("iPhone UDID")),
  "Apple Developer hints must tell the operator to register the real iPhone UDID",
);
assert(
  report.resolutionHints.environment.includes("export APPLE_TEAM_ID=5GWZ792DWH"),
  "environment hints must include the Apple Team ID export",
);
assert.equal(
  report.releaseConfig.path,
  "mobile/ios/release-config.json",
  "doctor report must record the default iOS release config path",
);
assert.equal(report.releaseConfig.appleTeamIdConfigured, true, "doctor report must record configured Apple Team ID metadata");
assert.equal(report.releaseConfig.bundleIdConfigured, true, "doctor report must record configured bundle id metadata");
assert(
  report.resolutionHints.environment.includes("export FINAL_JUDO_IOS_API_ORIGIN=https://<api-origin>"),
  "environment hints must include the production API origin export",
);
assert(report.resolutionHints.rerun.includes("ios:ipa:doctor"), "doctor report must include a strict rerun command");
assert(report.resolutionHints.rerun.includes("--strict"), "doctor rerun command must use strict mode");
assert(report.resolutionHints.build.includes("ios:ipa:build"), "doctor report must include the IPA build command");
assert(
  report.resolutionHints.build.includes("--allow-provisioning-updates"),
  "doctor build command must include provisioning update allowance",
);
assert(markdown.includes("# iOS IPA Doctor"), "doctor Markdown must include a title");
assert(markdown.includes("## Operator Snapshot"), "doctor Markdown must include an operator snapshot");
assert(markdown.includes("### IPA Ready Gate"), "doctor Markdown must include a ready gate summary");
assert(
  markdown.includes("Simulator launch success is not IPA distribution readiness"),
  "doctor Markdown must explicitly separate Simulator success from IPA readiness",
);
assert(markdown.includes("| Apple Team ID | 5GWZ792DWH |"), "doctor Markdown must summarize the Apple Team ID");
assert(markdown.includes("| Local profile files | 3 |"), "doctor Markdown must summarize local profile inventory");
assert(
  markdown.includes("| Profiles with registered iPhone devices | 1 |"),
  "doctor Markdown must summarize registered-device profile count",
);
assert(
  markdown.includes("a provisioning profile appropriate for the selected export method"),
  "doctor Markdown must describe export-method-specific provisioning",
);
assert(
  markdown.includes("| App Store distribution profiles | 1 |"),
  "doctor Markdown must report App Store distribution profile count",
);
assert(markdown.includes("## Provisioning Hints"), "doctor Markdown must include provisioning hints");
assert(markdown.includes("### Local Profile Inventory"), "doctor Markdown must include profile inventory");
assert(markdown.includes("Profile files: `3`"), "doctor Markdown must include scanned profile count");
assert(
  markdown.includes("Device UDIDs are intentionally not written to this report."),
  "doctor Markdown must explain that UDIDs are redacted",
);
assert(markdown.includes("### Apple Developer"), "doctor Markdown must include Apple Developer hints");
assert(markdown.includes("### Xcode"), "doctor Markdown must include Xcode hints");
assert(markdown.includes("FINAL_JUDO_IOS_API_ORIGIN=https://<api-origin>"), "doctor Markdown must include API origin setup");
assert(markdown.includes("must not contain `server.url`"), "doctor Markdown must require a bundled UI without server.url");
assert(markdown.includes("ios:ipa:build"), "doctor Markdown must include build command");
assert(!markdown.includes("PRIVATE KEY"), "doctor Markdown must not expose secret-like signing material");
assert(!markdown.includes("00008030"), "doctor Markdown must not expose raw device UDIDs");

await execFile(
  process.execPath,
  [
    "scripts/check-ios-ipa-doctor.mjs",
    "--team-id=5GWZ792DWH",
    "--bundle-id=kr.co.finaljudo.multigym",
    `--profiles-dir=${profilesDir}`,
    "--origin=https://api.finaljudo.co.kr",
    `--out=${apiOriginReportPath}`,
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, FINAL_JUDO_IOS_API_ORIGIN: "", FINAL_JUDO_IOS_SERVER_URL: "" },
  },
);
const apiOriginReport = JSON.parse(await readFile(apiOriginReportPath, "utf8"));
assert.equal(apiOriginReport.checks.origin.ok, true, "doctor must accept an HTTPS API origin for the bundled UI");
assert.equal(apiOriginReport.checks.origin.value, "https://api.finaljudo.co.kr");
assert.equal(
  apiOriginReport.blockers.some((blocker) => blocker.check === "origin"),
  false,
  "an HTTPS API host must not be treated as a remote app-screen origin",
);

await execFile(
  process.execPath,
  [
    "scripts/check-ios-ipa-doctor.mjs",
    `--profiles-dir=${profilesDir}`,
    `--out=${defaultConfigReportPath}`,
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APPLE_TEAM_ID: "",
      IOS_TEAM_ID: "",
      IOS_BUNDLE_ID: "",
      FINAL_JUDO_IOS_API_ORIGIN: "",
      FINAL_JUDO_IOS_SERVER_URL: "",
    },
  },
);
const defaultConfigReport = JSON.parse(await readFile(defaultConfigReportPath, "utf8"));
assert.equal(
  defaultConfigReport.checks.appleTeamId.value,
  "CA7A5SP5G5",
  "doctor must fall back to non-secret mobile/ios/release-config.json Apple Team ID",
);
assert.equal(
  defaultConfigReport.bundleId,
  "kr.co.finaljudo.multigym",
  "doctor must fall back to non-secret mobile/ios/release-config.json bundle id",
);
assert(
  defaultConfigReport.blockers.every((blocker) => blocker.check !== "appleTeamId"),
  "default release config must prevent an Apple Team ID false blocker",
);

let buildDoctorExitCode = 0;
try {
  await execFile(
    process.execPath,
    [
      "scripts/build-ios-ipa.mjs",
      "--doctor-only",
      "--team-id=5GWZ792DWH",
      "--bundle-id=kr.co.finaljudo.multigym",
      `--profiles-dir=${profilesDir}`,
      `--out-dir=${buildReportDir}`,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, FINAL_JUDO_IOS_API_ORIGIN: "", FINAL_JUDO_IOS_SERVER_URL: "" },
    },
  );
} catch (error) {
  buildDoctorExitCode = Number(error.code);
}

assert.equal(buildDoctorExitCode, 1, "build doctor-only report must exit nonzero while production origin is missing");
const buildReport = JSON.parse(await readFile(buildReportPath, "utf8"));
assert.equal(buildReport.releaseDecision, "blocked", "build report must stay blocked without production origin");
assert.equal(buildReport.signingStyle, "manual", "App Store build must use the configured manual signing style");
assert.equal(
  buildReport.signingCertificate,
  "Apple Distribution",
  "App Store build must use the configured distribution certificate",
);
assert.equal(
  buildReport.provisioningProfile,
  "kr.co.finaljudo.multigym App Store Connect",
  "App Store build must use the configured distribution profile",
);
assert.equal(
  buildReport.checks.signingConfiguration.ok,
  true,
  "manual signing must be ready when the matching profile and certificate configuration exist",
);
assert.equal(
  buildReport.checks.provisioningProfile.inventory.totalProfileFiles,
  3,
  "build report must include local provisioning profile inventory",
);
assert.equal(
  buildReport.checks.provisioningProfile.inventory.matchingAppStoreProfiles,
  1,
  "build report must recognize App Store distribution profiles without device UDIDs",
);
assert.equal(
  buildReport.checks.provisioningProfile.inventory.matchingProfilesWithRegisteredDevices,
  1,
  "build report must count matching profiles with registered devices",
);
assert(!JSON.stringify(buildReport).includes("00008030"), "build report must not expose raw device UDIDs");

let buildApiOriginExitCode = 0;
try {
  await execFile(
    process.execPath,
    [
      "scripts/build-ios-ipa.mjs",
      "--doctor-only",
      "--team-id=5GWZ792DWH",
      "--bundle-id=kr.co.finaljudo.multigym",
      `--profiles-dir=${profilesDir}`,
      "--origin=https://api.finaljudo.co.kr",
      `--out-dir=${buildApiOriginReportDir}`,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, FINAL_JUDO_IOS_API_ORIGIN: "", FINAL_JUDO_IOS_SERVER_URL: "" },
    },
  );
} catch (error) {
  buildApiOriginExitCode = Number(error.code);
}

assert.equal(buildApiOriginExitCode, 0, "build doctor-only report must accept an HTTPS API origin for the bundled UI");
const buildApiOriginReport = JSON.parse(await readFile(buildApiOriginReportPath, "utf8"));
assert.equal(buildApiOriginReport.checks.origin.ok, true, "build report must accept an HTTPS API origin");
assert.equal(buildApiOriginReport.webDistribution, "bundled_web_ui");

let buildDefaultConfigExitCode = 0;
try {
  await execFile(
    process.execPath,
    [
      "scripts/build-ios-ipa.mjs",
      "--doctor-only",
      `--profiles-dir=${profilesDir}`,
      `--out-dir=${buildDefaultConfigReportDir}`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APPLE_TEAM_ID: "",
        IOS_TEAM_ID: "",
        IOS_BUNDLE_ID: "",
        FINAL_JUDO_IOS_API_ORIGIN: "",
        FINAL_JUDO_IOS_SERVER_URL: "",
      },
    },
  );
} catch (error) {
  buildDefaultConfigExitCode = Number(error.code);
}

assert.equal(buildDefaultConfigExitCode, 1, "build doctor-only default-config report must stay blocked without origin");
const buildDefaultConfigReport = JSON.parse(await readFile(buildDefaultConfigReportPath, "utf8"));
assert.equal(
  buildDefaultConfigReport.checks.appleTeamId.value,
  "CA7A5SP5G5",
  "build doctor-only report must fall back to the non-secret iOS release config Apple Team ID",
);
assert(
  buildDefaultConfigReport.blockers.every((blocker) => blocker.check !== "appleTeamId"),
  "build doctor-only default release config must prevent an Apple Team ID false blocker",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "iOS IPA doctor blocked state without production origin",
        "Apple Team ID and bundle id report fields",
        "local provisioning profile inventory and matching profile counts",
        "raw device UDID redaction",
        "iOS IPA build report profile inventory and UDID redaction",
        "manual App Store signing configuration",
        "default iOS release config Apple Team ID fallback",
        "default iOS release config build doctor fallback",
        "bundled UI HTTPS API origin acceptance",
        "Apple Developer provisioning hints",
        "Xcode/manual profile hints",
        "environment and strict rerun commands",
        "IPA build command with provisioning updates",
        "Markdown provisioning hints",
      ],
    },
    null,
    2,
  ),
);
