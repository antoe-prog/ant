import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_IOS_RELEASE_CONFIG_PATH,
  readIosReleaseConfig,
  resolveIosBundleId,
  resolveIosTeamId,
  text,
} from "./lib/ios-release-config.mjs";

function parseArgs(argv) {
  const args = {
    allowProvisioningUpdates: false,
    bundleId: null,
    configuration: "Release",
    doctorOnly: false,
    exportMethod: process.env.IOS_EXPORT_METHOD ?? null,
    outDir: ".data/mobile-builds/ios",
    project: null,
    provisioningProfile: process.env.IOS_PROVISIONING_PROFILE ?? null,
    releaseConfig: process.env.IOS_RELEASE_CONFIG ?? DEFAULT_IOS_RELEASE_CONFIG_PATH,
    scheme: null,
    signingCertificate: process.env.IOS_SIGNING_CERTIFICATE ?? null,
    signingStyle: process.env.IOS_SIGNING_STYLE ?? null,
    skipSync: false,
    teamId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--doctor-only") {
      args.doctorOnly = true;
      continue;
    }

    if (arg === "--allow-provisioning-updates") {
      args.allowProvisioningUpdates = true;
      continue;
    }

    if (arg === "--allow-api-origin-webapp") {
      // Deprecated compatibility flag. The local bundle expects an API origin.
      continue;
    }

    if (arg === "--skip-sync") {
      args.skipSync = true;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--archive-path") {
      args.archivePath = value;
    } else if (key === "--configuration") {
      args.configuration = value;
    } else if (key === "--bundle-id") {
      args.bundleId = value;
    } else if (key === "--export-method" || key === "--xcode-export-method") {
      args.exportMethod = value;
    } else if (key === "--origin") {
      args.origin = value;
    } else if (key === "--out-dir") {
      args.outDir = value;
    } else if (key === "--project") {
      args.project = value;
    } else if (key === "--provisioning-profile") {
      args.provisioningProfile = value;
    } else if (key === "--scheme") {
      args.scheme = value;
    } else if (key === "--signing-certificate") {
      args.signingCertificate = value;
    } else if (key === "--signing-style") {
      args.signingStyle = value;
    } else if (key === "--team-id" || key === "--xcode-team-id") {
      args.teamId = value;
    } else if (key === "--release-config" || key === "--ios-release-config") {
      args.releaseConfig = value;
    } else if (key === "--profiles-dir" || key === "--provisioning-profiles-dir") {
      args.profilesDir = value;
    }
  }

  return args;
}

function isPlaceholderOriginValue(value) {
  return /TODO|TBD|placeholder|sample|example|localhost|<[^>]+>/i.test(String(value ?? ""));
}

function isPlaceholderProductionHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();

  return (
    ["localhost", "127.0.0.1", "0.0.0.0"].includes(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".test") ||
    host.endsWith(".example") ||
    host.endsWith(".example.com") ||
    host.includes("todo") ||
    host.includes("placeholder") ||
    host.includes("sample")
  );
}

function validateHttpsOrigin(originValue) {
  const origin = originValue ?? process.env.FINAL_JUDO_IOS_API_ORIGIN ?? process.env.FINAL_JUDO_IOS_SERVER_URL;

  if (!origin) {
    return { ok: false, reason: "missing --origin or FINAL_JUDO_IOS_API_ORIGIN" };
  }

  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") {
      return { ok: false, reason: "origin must use https" };
    }

    if (isPlaceholderProductionHost(url.hostname) || isPlaceholderOriginValue(origin)) {
      return { ok: false, reason: "origin must be a real production host, not localhost/example/TODO" };
    }

    return { ok: true, value: url.origin };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "invalid origin" };
  }
}

function commandCheck(command, args) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ command, ok: false, reason: error.message });
    });
    child.on("close", (code) => {
      const output = `${stdout}${stderr}`.trim();
      const firstLine = output.split(/\r?\n/).find(Boolean);

      resolve({
        command,
        ok: code === 0,
        ...(firstLine ? { version: firstLine.slice(0, 180) } : {}),
        ...(code !== 0 ? { reason: `exit code ${code}` } : {}),
      });
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const shouldCapture = options.captureOutput || options.stdio === "pipe";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: shouldCapture ? ["ignore", "pipe", "pipe"] : options.stdio ?? "inherit",
    });

    let stdout = "";
    let stderr = "";

    if (shouldCapture) {
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (options.captureOutput) {
          process.stdout.write(text);
        }
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (options.captureOutput) {
          process.stderr.write(text);
        }
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const output = `${stdout}${stderr}`.trim();
      const tail = output.split(/\r?\n/).slice(-80).join("\n");
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}${tail ? `\n${tail}` : ""}`));
    });
  });
}

async function packageHasCapacitorIos() {
  try {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    return Boolean(packageJson.devDependencies?.["@capacitor/ios"] || packageJson.dependencies?.["@capacitor/ios"]);
  } catch {
    return false;
  }
}

async function capacitorAppId() {
  try {
    const source = await readFile("capacitor.config.ts", "utf8");
    return source.match(/appId:\s*["']([^"']+)["']/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function plistValue(source, key) {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`);
  return source.match(pattern)?.[1] ?? null;
}

function plistArrayValues(source, key) {
  const arraySource = source.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1] ?? "";
  return [...arraySource.matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1]);
}

function plistDateValue(source, key) {
  return source.match(new RegExp(`<key>${key}</key>\\s*<date>([^<]+)</date>`))?.[1] ?? null;
}

function plistBooleanValue(source, key) {
  const match = source.match(new RegExp(`<key>${key}</key>\\s*<(true|false)\\s*/>`));
  return match ? match[1] === "true" : null;
}

async function decodeProvisioningProfile(profileFile) {
  const result = spawnSync("security", ["cms", "-D", "-i", profileFile], { encoding: "utf8" });

  if (result.status === 0 && result.stdout.includes("<plist")) {
    return result.stdout;
  }

  const raw = await readFile(profileFile, "utf8");
  const plistStart = raw.indexOf("<plist");
  const plistEnd = raw.lastIndexOf("</plist>");

  if (plistStart >= 0 && plistEnd > plistStart) {
    return raw.slice(plistStart, plistEnd + "</plist>".length);
  }

  throw new Error(result.error?.message ?? result.stderr?.trim() ?? `security cms exit code ${result.status}`);
}

function summarizeProfile({ file, plist, expectedIdentifier, wildcardIdentifier, teamId }) {
  const appIdentifier = plistValue(plist, "application-identifier");
  const name = plistValue(plist, "Name");
  const uuid = plistValue(plist, "UUID");
  const expirationDate = plistDateValue(plist, "ExpirationDate");
  const teamIdentifiers = plistArrayValues(plist, "TeamIdentifier");
  const provisionedDevices = plistArrayValues(plist, "ProvisionedDevices");
  const provisionsAllDevices = plistBooleanValue(plist, "ProvisionsAllDevices");
  const getTaskAllow = plistBooleanValue(plist, "get-task-allow");
  const matchesTeam = teamIdentifiers.includes(teamId);
  const matchesBundle = appIdentifier === expectedIdentifier || appIdentifier === wildcardIdentifier;
  const hasRegisteredDevices = provisionedDevices.length > 0 || provisionsAllDevices === true;
  const isAppStoreDistribution =
    getTaskAllow === false && provisionedDevices.length === 0 && provisionsAllDevices !== true;
  const isDistributionReady = hasRegisteredDevices || isAppStoreDistribution;

  return {
    fileName: path.basename(file),
    ...(name ? { name } : {}),
    ...(uuid ? { uuid } : {}),
    ...(expirationDate ? { expirationDate } : {}),
    appIdentifier,
    teamIdentifiers,
    matchesTeam,
    matchesBundle,
    provisionedDeviceCount: provisionedDevices.length,
    hasRegisteredDevices,
    isAppStoreDistribution,
    isDistributionReady,
    ...(getTaskAllow !== null ? { getTaskAllow } : {}),
    ...(provisionsAllDevices !== null ? { provisionsAllDevices } : {}),
  };
}

function profileSupportsExportMethod(profile, exportMethod) {
  if (["app-store", "app-store-connect"].includes(exportMethod)) {
    return profile.isAppStoreDistribution;
  }

  if (exportMethod === "enterprise") {
    return profile.provisionsAllDevices === true;
  }

  if (["ad-hoc", "debugging", "development", "release-testing"].includes(exportMethod)) {
    return profile.hasRegisteredDevices;
  }

  return profile.isDistributionReady;
}

function provisioningProfileDirectories(profilesDir) {
  const explicitDirectory = profilesDir ?? process.env.IOS_PROVISIONING_PROFILES_DIR;

  if (explicitDirectory) {
    return [explicitDirectory];
  }

  return [
    path.join(os.homedir(), "Library", "MobileDevice", "Provisioning Profiles"),
    path.join(os.homedir(), "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"),
  ];
}

async function provisioningProfileCheck({ bundleId, exportMethod, profilesDir, teamId }) {
  const profileDirectories = provisioningProfileDirectories(profilesDir);
  const inventory = {
    directory: profileDirectories.join(", "),
    directories: profileDirectories,
    totalProfileFiles: 0,
    readableProfileFiles: 0,
    unreadableProfileFiles: 0,
    matchingTeamProfiles: 0,
    matchingBundleProfiles: 0,
    matchingProfiles: 0,
    matchingProfilesWithRegisteredDevices: 0,
    matchingAppStoreProfiles: 0,
    matchingDistributionReadyProfiles: 0,
    matchingExportMethodProfiles: 0,
    profiles: [],
  };

  if (!teamId) {
    return {
      ok: false,
      reason: "missing --team-id or APPLE_TEAM_ID",
      value: inventory.directory,
      inventory,
    };
  }

  if (!bundleId) {
    return {
      ok: false,
      reason: "missing bundle identifier",
      value: inventory.directory,
      inventory,
    };
  }

  const profileFiles = [];

  for (const profileDirectory of profileDirectories) {
    let entries = [];
    try {
      entries = await readdir(profileDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    profileFiles.push(
      ...entries
        .filter((entry) => entry.isFile() && /\.(mobileprovision|provisionprofile)$/i.test(entry.name))
        .map((entry) => path.join(profileDirectory, entry.name)),
    );
  }

  if (profileFiles.length === 0) {
    return {
      ok: false,
      reason: "no local provisioning profile files found",
      value: inventory.directory,
      inventory,
    };
  }

  inventory.totalProfileFiles = profileFiles.length;
  const matchingProfiles = [];
  const expectedIdentifier = `${teamId}.${bundleId}`;
  const wildcardIdentifier = `${teamId}.*`;

  for (const profileFile of profileFiles) {
    let plist;
    try {
      plist = await decodeProvisioningProfile(profileFile);
    } catch {
      inventory.unreadableProfileFiles += 1;
      continue;
    }

    inventory.readableProfileFiles += 1;
    const profile = summarizeProfile({ file: profileFile, plist, expectedIdentifier, wildcardIdentifier, teamId });
    inventory.profiles.push(profile);

    if (profile.matchesTeam) {
      inventory.matchingTeamProfiles += 1;
    }

    if (profile.matchesBundle) {
      inventory.matchingBundleProfiles += 1;
    }

    if (profile.matchesBundle && profile.matchesTeam) {
      matchingProfiles.push(profile);
    }
  }

  inventory.matchingProfiles = matchingProfiles.length;
  inventory.matchingProfilesWithRegisteredDevices = matchingProfiles.filter((profile) => profile.hasRegisteredDevices).length;
  inventory.matchingAppStoreProfiles = matchingProfiles.filter((profile) => profile.isAppStoreDistribution).length;
  inventory.matchingDistributionReadyProfiles = matchingProfiles.filter((profile) => profile.isDistributionReady).length;
  const exportMethodProfiles = matchingProfiles.filter((profile) => profileSupportsExportMethod(profile, exportMethod));
  inventory.matchingExportMethodProfiles = exportMethodProfiles.length;

  if (inventory.readableProfileFiles === 0) {
    return {
      ok: false,
      reason: "no readable local provisioning profile files found",
      value: `${profileFiles.length} profiles scanned`,
      inventory,
    };
  }

  if (matchingProfiles.length === 0) {
    return {
      ok: false,
      reason: `no local provisioning profile matches ${teamId}.${bundleId}`,
      value: `${profileFiles.length} profiles scanned`,
      inventory,
    };
  }

  if (exportMethodProfiles.length === 0) {
    const requirement = ["app-store", "app-store-connect"].includes(exportMethod)
      ? "matching App Store Connect distribution profile"
      : "matching provisioning profile with registered devices";
    return {
      ok: false,
      reason: `no ${requirement} found for export method ${exportMethod}`,
      value: `${matchingProfiles.length} matching profiles`,
      inventory,
    };
  }

  return {
    ok: true,
    value: `${exportMethodProfiles.length} profiles ready for ${exportMethod}`,
    inventory,
  };
}

async function codeSigningIdentityCheck() {
  const child = spawn("security", ["find-identity", "-v", "-p", "codesigning"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolve) => {
    child.on("error", (error) => {
      resolve({ command: "security", ok: false, reason: error.message });
    });
    child.on("close", (code) => {
      const output = `${stdout}${stderr}`.trim();
      const validIdentityCount = Number(output.match(/^\s*(\d+)\s+valid identities found/m)?.[1] ?? 0);
      const firstIdentity = output.split(/\r?\n/).find((line) => /^\s*\d+\)/.test(line));

      resolve({
        command: "security",
        ok: code === 0 && validIdentityCount > 0,
        ...(firstIdentity ? { version: firstIdentity.trim().slice(0, 180) } : {}),
        value: `${validIdentityCount} valid identities`,
        ...(code !== 0 ? { reason: `exit code ${code}` } : {}),
        ...(code === 0 && validIdentityCount === 0 ? { reason: "0 valid codesigning identities found" } : {}),
      });
    });
  });
}

async function createChecks(args, origin, bundleId) {
  const xcodebuild = await commandCheck("xcodebuild", ["-version"]);
  const provisioningProfile = await provisioningProfileCheck({
    bundleId,
    exportMethod: args.exportMethod,
    profilesDir: args.profilesDir,
    teamId: args.teamId,
  });
  const manualProfile = provisioningProfile.inventory?.profiles?.find(
    (profile) =>
      profile.name === args.provisioningProfile &&
      profile.matchesBundle &&
      profile.matchesTeam &&
      profileSupportsExportMethod(profile, args.exportMethod),
  );
  const validSigningStyle = ["automatic", "manual"].includes(args.signingStyle);
  const manualSigningReady =
    args.signingStyle !== "manual" ||
    (Boolean(args.provisioningProfile) && Boolean(args.signingCertificate) && Boolean(manualProfile));

  return {
    origin,
    capacitorConfig: {
      ok: existsSync("capacitor.config.ts"),
      value: "capacitor.config.ts",
      ...(!existsSync("capacitor.config.ts") ? { reason: "missing capacitor.config.ts" } : {}),
    },
    capacitorIosPackage: {
      ok: await packageHasCapacitorIos(),
      value: "@capacitor/ios",
    },
    iosProject: {
      ok: existsSync(path.join(args.project, "project.pbxproj")),
      value: args.project,
      ...(!existsSync(path.join(args.project, "project.pbxproj")) ? { reason: "missing iOS Xcode project" } : {}),
    },
    xcodebuild,
    simctl: await commandCheck("xcrun", ["simctl", "list", "devices", "available"]),
    codeSigningIdentity: await codeSigningIdentityCheck(),
    appleTeamId: {
      ok: Boolean(args.teamId),
      value: args.teamId ?? null,
      ...(!args.teamId ? { reason: "missing --team-id or APPLE_TEAM_ID" } : {}),
    },
    provisioningProfile,
    signingConfiguration: {
      ok: validSigningStyle && manualSigningReady,
      value: args.signingStyle,
      ...(!validSigningStyle
        ? { reason: "signing style must be automatic or manual" }
        : !manualSigningReady
          ? { reason: "manual signing requires a matching provisioning profile and signing certificate" }
          : {}),
    },
  };
}

function blockersFromChecks(checks) {
  return Object.entries(checks)
    .filter(([, check]) => !check.ok)
    .map(([check, result]) => ({
      check,
      reason: result.reason ?? "missing",
    }));
}

function nextActionsForBlockers(blockers, { bundleId, exportMethod }) {
  const blockerChecks = new Set(blockers.map((blocker) => blocker.check));
  const actions = [];

  if (blockerChecks.has("provisioningProfile")) {
    if (["app-store", "app-store-connect"].includes(exportMethod)) {
      actions.push(`Create/download an App Store distribution provisioning profile for ${bundleId}.`);
    } else if (["ad-hoc", "debugging", "development", "release-testing"].includes(exportMethod)) {
      actions.push(`Register the test iPhone in Apple Developer and create/download a device-backed provisioning profile for ${bundleId}.`);
    } else {
      actions.push(`Create/download a provisioning profile compatible with ${exportMethod} for ${bundleId}.`);
    }
  }

  if (blockerChecks.has("origin")) {
    actions.push("Set FINAL_JUDO_IOS_API_ORIGIN or --origin to the real HTTPS API origin before bundling and sync.");
  }

  if (blockerChecks.has("appleTeamId")) {
    actions.push("Pass --team-id=<APPLE_TEAM_ID> or set APPLE_TEAM_ID to the 10-character Apple Team ID.");
  }

  if (blockerChecks.has("codeSigningIdentity")) {
    actions.push("Install an Apple Developer code signing certificate for the selected team in Xcode Settings > Accounts.");
  }

  if (blockerChecks.has("xcodebuild") || blockerChecks.has("simctl")) {
    actions.push("Install full Xcode and select it with xcode-select.");
  }

  if (blockerChecks.has("capacitorConfig") || blockerChecks.has("capacitorIosPackage") || blockerChecks.has("iosProject")) {
    actions.push("Run npm install and npm run ios:cap:add/ios:cap:sync so the Capacitor iOS project is present.");
  }

  actions.push("Run npm run ios:ipa:build again with --allow-provisioning-updates after signing/provisioning is ready.");
  return [...new Set(actions)];
}

function exportOptionsPlist({ bundleId, exportMethod, provisioningProfile, signingCertificate, signingStyle, teamId }) {
  const teamEntry = teamId ? `\n  <key>teamID</key>\n  <string>${teamId}</string>` : "";
  const signingEntries = signingStyle === "manual"
    ? `
  <key>signingStyle</key>
  <string>manual</string>
  <key>signingCertificate</key>
  <string>${signingCertificate}</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${bundleId}</key>
    <string>${provisioningProfile}</string>
  </dict>`
    : `
  <key>signingStyle</key>
  <string>automatic</string>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${exportMethod}</string>
  ${signingEntries}${teamEntry}
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>uploadSymbols</key>
  <true/>
  <key>destination</key>
  <string>export</string>
</dict>
</plist>
`;
}

async function findIpa(exportPath) {
  const entries = await readdir(exportPath, { withFileTypes: true });
  const ipa = entries.find((entry) => entry.isFile() && entry.name.endsWith(".ipa"));

  return ipa ? path.join(exportPath, ipa.name) : null;
}

function capacitorCliArgs(...args) {
  return [path.resolve("node_modules", "@capacitor", "cli", "bin", "capacitor"), ...args];
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const releaseConfig = await readIosReleaseConfig(args.releaseConfig);
args.teamId = resolveIosTeamId({ cliTeamId: args.teamId, config: releaseConfig });
args.exportMethod = text(args.exportMethod) ?? text(releaseConfig.exportMethod) ?? "app-store-connect";
args.project = text(args.project) ?? text(releaseConfig.project) ?? "mobile/ios/App/App.xcodeproj";
args.scheme = text(args.scheme) ?? text(releaseConfig.scheme) ?? "App";
args.signingStyle = (text(args.signingStyle) ?? text(releaseConfig.signingStyle) ?? "automatic").toLowerCase();
args.signingCertificate = text(args.signingCertificate) ?? text(releaseConfig.signingCertificate);
args.provisioningProfile = text(args.provisioningProfile) ?? text(releaseConfig.provisioningProfile);
const origin = validateHttpsOrigin(args.origin);
const outDir = path.resolve(args.outDir);
const archivePath = path.resolve(args.archivePath ?? path.join(args.outDir, "final-judo.xcarchive"));
const exportPath = path.resolve(path.join(args.outDir, "ipa"));
const exportOptionsPath = path.resolve(path.join(args.outDir, "ExportOptions.plist"));
const reportPath = path.resolve(path.join(args.outDir, "ios-ipa-build-report.json"));
const bundleId = resolveIosBundleId({
  cliBundleId: args.bundleId,
  config: releaseConfig,
  fallbackBundleId: await capacitorAppId(),
});
const checks = await createChecks(args, origin, bundleId);
const blockers = blockersFromChecks(checks);

const baseReport = {
  ok: false,
  generatedAt: new Date().toISOString(),
  requestedArtifact: "iOS IPA",
  bundleId,
  releaseConfig: {
    path: text(args.releaseConfig) ?? DEFAULT_IOS_RELEASE_CONFIG_PATH,
    appleTeamIdConfigured: Boolean(text(releaseConfig.appleTeamId)),
    bundleIdConfigured: Boolean(text(releaseConfig.bundleId)),
  },
  origin: origin.value ?? null,
  webDistribution: "bundled_web_ui",
  outDir,
  archivePath,
  exportPath,
  exportOptionsPath,
  project: args.project,
  scheme: args.scheme,
  configuration: args.configuration,
  exportMethod: args.exportMethod,
  signingCertificate: args.signingCertificate,
  signingStyle: args.signingStyle,
  provisioningProfile: args.provisioningProfile,
  allowProvisioningUpdates: args.allowProvisioningUpdates,
  checks,
  blockers,
};

if (blockers.length > 0 || args.doctorOnly) {
  const report = {
    ...baseReport,
    ok: blockers.length === 0,
    releaseDecision: blockers.length === 0 ? "ready" : "blocked",
    nextActions:
      blockers.length > 0
        ? nextActionsForBlockers(blockers, { bundleId, exportMethod: args.exportMethod })
        : ["Run npm run ios:ipa:build without --doctor-only to archive and export the IPA."],
  };
  await writeReport(reportPath, report);
  console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
  process.exit(blockers.length > 0 ? 1 : 0);
}

assert(origin.ok && origin.value, "origin must be valid before iOS build");
await mkdir(outDir, { recursive: true });

try {
  if (!args.skipSync) {
    await run(process.execPath, ["scripts/build-ios-local-web.mjs", `--api-origin=${origin.value}`], {
      captureOutput: true,
    });
    await run(process.execPath, capacitorCliArgs("sync", "ios"), {
      env: {
        ...process.env,
        FINAL_JUDO_ANDROID_SERVER_URL: "",
        FINAL_JUDO_IOS_API_ORIGIN: origin.value,
        FINAL_JUDO_IOS_LOCAL_BUNDLE: "1",
        FINAL_JUDO_IOS_SERVER_URL: "",
      },
      captureOutput: true,
    });

    const generatedCapacitorConfig = JSON.parse(
      await readFile(path.join("mobile", "ios", "App", "App", "capacitor.config.json"), "utf8"),
    );
    assert(!generatedCapacitorConfig.server?.url, "Release iOS config must not contain server.url.");
    assert.equal(
      generatedCapacitorConfig.plugins?.CapacitorHttp?.enabled,
      true,
      "Bundled iOS UI must use CapacitorHttp for the remote API origin.",
    );
  }

  await writeFile(
    exportOptionsPath,
    exportOptionsPlist({
      bundleId,
      exportMethod: args.exportMethod,
      provisioningProfile: args.provisioningProfile,
      signingCertificate: args.signingCertificate,
      signingStyle: args.signingStyle,
      teamId: args.teamId,
    }),
  );

  const archiveArgs = [
    "-project",
    args.project,
    "-scheme",
    args.scheme,
    "-configuration",
    args.configuration,
    "-archivePath",
    archivePath,
    "archive",
    `CODE_SIGN_STYLE=${args.signingStyle === "manual" ? "Manual" : "Automatic"}`,
    `DEVELOPMENT_TEAM=${args.teamId}`,
  ];

  if (args.signingStyle === "manual") {
    archiveArgs.push(
      `CODE_SIGN_IDENTITY=${args.signingCertificate}`,
      `PROVISIONING_PROFILE_SPECIFIER=${args.provisioningProfile}`,
    );
  }

  if (args.allowProvisioningUpdates) {
    archiveArgs.push("-allowProvisioningUpdates");
  }

  await run("xcodebuild", archiveArgs, { captureOutput: true });
  const exportArgs = ["-exportArchive", "-archivePath", archivePath, "-exportPath", exportPath, "-exportOptionsPlist", exportOptionsPath];
  if (args.allowProvisioningUpdates) {
    exportArgs.push("-allowProvisioningUpdates");
  }

  await run("xcodebuild", exportArgs, { captureOutput: true });

  const ipa = await findIpa(exportPath);
  assert(ipa, `No .ipa file found in ${exportPath}`);

  const ipaStat = await stat(ipa);
  const report = {
    ...baseReport,
    ok: true,
    releaseDecision: "ready",
    blockers: [],
    ipa,
    bytes: ipaStat.size,
  };

  await writeReport(reportPath, report);
  console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const report = {
    ...baseReport,
    ok: false,
    releaseDecision: "blocked",
    blockers: [
      {
        check: "iosArchiveExport",
        reason,
      },
    ],
    nextActions: [
      "Add the Apple Developer account for the selected team in Xcode Settings > Accounts.",
      "Ensure the account can create or download provisioning profiles for kr.co.finaljudo.multigym.",
      "Re-run with --allow-provisioning-updates, the real HTTPS API origin, and the 10-character Apple Team ID.",
    ],
  };

  await writeReport(reportPath, report);
  console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
  process.exit(1);
}
