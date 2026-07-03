import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
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
    allowApiOriginWebapp: process.env.FINAL_JUDO_ALLOW_API_ORIGIN_WEBAPP === "1",
    bundleId: null,
    releaseConfig: process.env.IOS_RELEASE_CONFIG ?? DEFAULT_IOS_RELEASE_CONFIG_PATH,
    strict: false,
    teamId: null,
    useDeployedOrigin: process.env.FINAL_JUDO_DISABLE_DEPLOYED_ORIGIN_FALLBACK !== "1",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    if (arg === "--allow-api-origin-webapp") {
      args.allowApiOriginWebapp = true;
      continue;
    }

    if (arg === "--no-deployed-origin") {
      args.useDeployedOrigin = false;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--out") {
      args.out = value;
    } else if (key === "--markdown") {
      args.markdown = value;
    } else if (key === "--origin") {
      args.origin = value;
    } else if (key === "--team-id" || key === "--xcode-team-id") {
      args.teamId = value;
    } else if (key === "--bundle-id") {
      args.bundleId = value;
    } else if (key === "--release-config" || key === "--ios-release-config") {
      args.releaseConfig = value;
    } else if (key === "--profiles-dir" || key === "--provisioning-profiles-dir") {
      args.profilesDir = value;
    }
  }

  return args;
}

function commandCheck(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const firstLine = output.split(/\r?\n/).find(Boolean);

  return {
    command,
    ok: result.status === 0,
    ...(firstLine ? { version: firstLine.slice(0, 180) } : {}),
    ...(result.error ? { reason: result.error.message } : {}),
    ...(result.status !== 0 && !result.error ? { reason: `exit code ${result.status}` } : {}),
  };
}

function codeSigningIdentityCheck() {
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const validIdentityCount = Number(output.match(/^\s*(\d+)\s+valid identities found/m)?.[1] ?? 0);
  const firstIdentity = output.split(/\r?\n/).find((line) => /^\s*\d+\)/.test(line));

  return {
    command: "security",
    ok: result.status === 0 && validIdentityCount > 0,
    ...(firstIdentity ? { version: firstIdentity.trim().slice(0, 180) } : {}),
    value: `${validIdentityCount} valid identities`,
    ...(result.error ? { reason: result.error.message } : {}),
    ...(result.status !== 0 && !result.error ? { reason: `exit code ${result.status}` } : {}),
    ...(result.status === 0 && validIdentityCount === 0 ? { reason: "0 valid codesigning identities found" } : {}),
  };
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
  const matchesTeam = teamIdentifiers.includes(teamId);
  const matchesBundle = appIdentifier === expectedIdentifier || appIdentifier === wildcardIdentifier;
  const hasRegisteredDevices = provisionedDevices.length > 0 || provisionsAllDevices === true;

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
    ...(provisionsAllDevices !== null ? { provisionsAllDevices } : {}),
  };
}

async function provisioningProfileCheck({ bundleId, profilesDir, teamId }) {
  const profileDirectory =
    profilesDir ?? process.env.IOS_PROVISIONING_PROFILES_DIR ?? path.join(os.homedir(), "Library", "MobileDevice", "Provisioning Profiles");
  const inventory = {
    directory: profileDirectory,
    totalProfileFiles: 0,
    readableProfileFiles: 0,
    unreadableProfileFiles: 0,
    matchingTeamProfiles: 0,
    matchingBundleProfiles: 0,
    matchingProfiles: 0,
    matchingProfilesWithRegisteredDevices: 0,
    profiles: [],
  };

  if (!teamId) {
    return {
      ok: false,
      reason: "missing --team-id or APPLE_TEAM_ID",
      value: profileDirectory,
      inventory,
    };
  }

  if (!bundleId) {
    return {
      ok: false,
      reason: "missing bundle identifier",
      value: profileDirectory,
      inventory,
    };
  }

  let entries = [];
  try {
    entries = await readdir(profileDirectory, { withFileTypes: true });
  } catch {
    return {
      ok: false,
      reason: "no local provisioning profile directory found",
      value: profileDirectory,
      inventory,
    };
  }

  const profileFiles = entries
    .filter((entry) => entry.isFile() && /\.(mobileprovision|provisionprofile)$/i.test(entry.name))
    .map((entry) => path.join(profileDirectory, entry.name));
  inventory.totalProfileFiles = profileFiles.length;
  const matchingProfiles = [];
  const expectedIdentifier = `${teamId}.${bundleId}`;
  const wildcardIdentifier = `${teamId}.*`;

  if (profileFiles.length === 0) {
    return {
      ok: false,
      reason: "no local provisioning profile files found",
      value: profileDirectory,
      inventory,
    };
  }

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

  const profilesWithDevices = matchingProfiles.filter((profile) => profile.hasRegisteredDevices);

  if (profilesWithDevices.length === 0) {
    return {
      ok: false,
      reason: "matching provisioning profile has no registered iPhone devices",
      value: `${matchingProfiles.length} matching profiles`,
      inventory,
    };
  }

  return {
    ok: true,
    value: `${profilesWithDevices.length} matching profiles with registered devices`,
    inventory,
  };
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

function validateHttpsOrigin(origin, { allowApiOriginWebapp = false } = {}) {
  if (!origin) {
    return {
      ok: false,
      reason: "missing --origin or FINAL_JUDO_IOS_SERVER_URL",
    };
  }

  try {
    const url = new URL(origin);

    if (url.protocol !== "https:") {
      return {
        ok: false,
        reason: "origin must use https",
      };
    }

    if (isPlaceholderProductionHost(url.hostname) || isPlaceholderOriginValue(origin)) {
      return {
        ok: false,
        reason: "origin must be a real production host, not localhost/example/TODO",
      };
    }

    if (isLikelyApiOnlyHost(url.hostname) && !allowApiOriginWebapp) {
      return {
        ok: false,
        reason:
          "origin looks like an API host; use the web app origin that serves /login and /app/dashboard, or pass --allow-api-origin-webapp after verifying it serves the web app",
      };
    }

    return {
      ok: true,
      value: url.origin,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "invalid origin",
    };
  }
}

function isLikelyApiOnlyHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return host === "api" || host.startsWith("api.") || host.includes(".api.");
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(path.resolve(filePath), "utf8"));
  } catch {
    return null;
  }
}

function firstNonEmptyString(values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function readDeployedWebAppOrigin() {
  const deploymentHandoff = readJsonFile(".data/deployment-handoff.report.json");
  const p1Readiness = readJsonFile(".data/p1-readiness.json");

  return firstNonEmptyString([
    deploymentHandoff?.partial?.webDeployment?.productionOrigin,
    deploymentHandoff?.productionOrigin,
    p1Readiness?.requirements?.deployment?.partial?.webDeployment?.productionOrigin,
    p1Readiness?.requirements?.android?.partial?.webAppOrigin?.productionOrigin,
    p1Readiness?.requirements?.notificationPush?.partial?.webPushOrigin?.productionOrigin,
  ]);
}

function resolveOriginValue(args) {
  const explicitOrigin = firstNonEmptyString([args.origin, process.env.FINAL_JUDO_IOS_SERVER_URL]);

  if (explicitOrigin) {
    return explicitOrigin;
  }

  return args.useDeployedOrigin ? readDeployedWebAppOrigin() : null;
}

function createResolutionHints({ bundleId, teamId }) {
  const resolvedTeamId = teamId ?? "<APPLE_TEAM_ID>";
  const resolvedBundleId = bundleId ?? "<BUNDLE_ID>";
  const productionOrigin = "https://<webapp-origin>";

  return {
    appleDeveloper: [
      `Register the real iPhone UDID in Apple Developer > Certificates, Identifiers & Profiles > Devices for Team ID ${resolvedTeamId}.`,
      `Create or refresh an iOS App Development or Ad Hoc provisioning profile for bundle id ${resolvedBundleId}.`,
      "Download and install the provisioning profile on this Mac so it appears in ~/Library/MobileDevice/Provisioning Profiles.",
    ],
    xcode: [
      `In Xcode Settings > Accounts, select team ${resolvedTeamId} and use Download Manual Profiles after the profile exists.`,
      `Open mobile/ios/App/App.xcodeproj and confirm Signing & Capabilities uses team ${resolvedTeamId} with bundle id ${resolvedBundleId}.`,
      "Do not treat a Simulator launch as IPA ready; a provisioning profile with at least one registered iPhone is still required.",
    ],
    environment: [
      `export APPLE_TEAM_ID=${resolvedTeamId}`,
      `export FINAL_JUDO_IOS_SERVER_URL=${productionOrigin}`,
      "Use a web app origin that serves /login and /app/dashboard; API-only hosts are blocked by default.",
      "If an api.* host intentionally serves the web app, rerun with --allow-api-origin-webapp after verifying those routes.",
      "npm run ios:cap:sync",
    ],
    rerun: `APPLE_TEAM_ID=${resolvedTeamId} FINAL_JUDO_IOS_SERVER_URL=${productionOrigin} npm run ios:ipa:doctor -- --team-id=${resolvedTeamId} --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md`,
    build: `APPLE_TEAM_ID=${resolvedTeamId} FINAL_JUDO_IOS_SERVER_URL=${productionOrigin} npm run ios:ipa:build -- --team-id=${resolvedTeamId} --xcode-export-method=release-testing --allow-provisioning-updates`,
  };
}

function appendHintList(lines, title, hints) {
  lines.push(`### ${title}`, "");

  for (const hint of hints) {
    lines.push(`- ${hint}`);
  }

  lines.push("");
}

function profileInventorySummary(report) {
  const inventory = report.checks.provisioningProfile?.inventory;

  if (!inventory) {
    return {
      matchingProfiles: "unknown",
      matchingProfilesWithRegisteredDevices: "unknown",
      profileFiles: "unknown",
    };
  }

  return {
    matchingProfiles: String(inventory.matchingProfiles ?? 0),
    matchingProfilesWithRegisteredDevices: String(inventory.matchingProfilesWithRegisteredDevices ?? 0),
    profileFiles: String(inventory.totalProfileFiles ?? 0),
  };
}

function createMarkdown(report) {
  const inventory = profileInventorySummary(report);
  const lines = [
    "# iOS IPA Doctor",
    "",
    `- Generated: \`${report.generatedAt}\``,
    `- Status: \`${report.ok ? "ready" : "blocked"}\``,
    "- Requested artifact: `IPA` (iOS does not build APK files)",
    "- Release rule: Simulator launch success is not IPA distribution readiness.",
    "",
    "## Operator Snapshot",
    "",
    "| Item | Value |",
    "| --- | --- |",
    `| Release decision | ${markdownCell(report.releaseDecision)} |`,
    `| Bundle ID | ${markdownCell(report.bundleId)} |`,
    `| Apple Team ID | ${markdownCell(report.checks.appleTeamId?.value ?? "missing")} |`,
    `| Production origin | ${report.checks.origin?.ok ? markdownCell(report.checks.origin.value) : `blocked: ${markdownCell(report.checks.origin?.reason)}`} |`,
    `| Local profile files | ${markdownCell(inventory.profileFiles)} |`,
    `| Matching team/bundle profiles | ${markdownCell(inventory.matchingProfiles)} |`,
    `| Profiles with registered iPhone devices | ${markdownCell(inventory.matchingProfilesWithRegisteredDevices)} |`,
    "",
    "### IPA Ready Gate",
    "",
    "- The IPA remains blocked until both a real HTTPS web app production origin and a local provisioning profile with a registered iPhone are present.",
    "- API-only hosts such as `api.*` are not accepted as the app origin unless an operator explicitly verifies they also serve `/login` and `/app/dashboard`.",
    "- Keep the Simulator result as a runtime smoke signal only; do not mark IPA distribution ready from Simulator evidence.",
    "- After registering the iPhone and downloading the profile, rerun the strict doctor before `ios:ipa:build`.",
    "",
    "## Checks",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
  ];

  for (const [key, check] of Object.entries(report.checks)) {
    const status = check.ok ? "ready" : "blocked";
    const detail = check.value ?? check.version ?? check.reason ?? "";
    lines.push(`| ${markdownCell(key)} | ${status} | ${markdownCell(detail)} |`);
  }

  lines.push("", "## Blockers", "");
  if (report.blockers.length === 0) {
    lines.push("- None");
  } else {
    for (const blocker of report.blockers) {
      lines.push(`- \`${blocker.check}\`: ${blocker.reason}`);
    }
  }

  lines.push("", "## Provisioning Hints", "");
  if (report.checks.provisioningProfile?.inventory) {
    const inventory = report.checks.provisioningProfile.inventory;
    lines.push(
      "### Local Profile Inventory",
      "",
      `- Directory: \`${inventory.directory}\``,
      `- Profile files: \`${inventory.totalProfileFiles}\``,
      `- Readable profiles: \`${inventory.readableProfileFiles}\``,
      `- Matching team profiles: \`${inventory.matchingTeamProfiles}\``,
      `- Matching bundle profiles: \`${inventory.matchingBundleProfiles}\``,
      `- Matching profiles with registered devices: \`${inventory.matchingProfilesWithRegisteredDevices}\``,
      "- Device UDIDs are intentionally not written to this report.",
      "",
    );
  }
  appendHintList(lines, "Apple Developer", report.resolutionHints.appleDeveloper);
  appendHintList(lines, "Xcode", report.resolutionHints.xcode);
  appendHintList(lines, "Environment", report.resolutionHints.environment);
  lines.push(
    "### Rerun",
    "",
    `- \`${report.resolutionHints.rerun}\``,
    "",
    "### Build",
    "",
    `- \`${report.resolutionHints.build}\``,
  );

  lines.push(
    "",
    "## Commands",
    "",
    "- `FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:cap:sync`",
    "- `FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:build -- --xcode-team-id=<TEAM_ID> --xcode-export-method=release-testing`",
    "",
  );

  return `${lines.join("\n")}\n`;
}

async function packageHasCapacitorIos() {
  try {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    return Boolean(packageJson.devDependencies?.["@capacitor/ios"] || packageJson.dependencies?.["@capacitor/ios"]);
  } catch {
    return false;
  }
}

const args = parseArgs(process.argv.slice(2));
const releaseConfig = await readIosReleaseConfig(args.releaseConfig);
const originValue = resolveOriginValue(args);
const origin = validateHttpsOrigin(originValue, { allowApiOriginWebapp: args.allowApiOriginWebapp });
const codeSigningIdentity = codeSigningIdentityCheck();
const capacitorBundleId = await capacitorAppId();
const bundleId = resolveIosBundleId({ cliBundleId: args.bundleId, config: releaseConfig, fallbackBundleId: capacitorBundleId });
const teamId = resolveIosTeamId({ cliTeamId: args.teamId, config: releaseConfig });

const checks = {
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
    ok: existsSync(path.join("mobile", "ios", "App", "App.xcodeproj", "project.pbxproj")),
    value: "mobile/ios/App/App.xcodeproj",
    ...(!existsSync(path.join("mobile", "ios", "App", "App.xcodeproj", "project.pbxproj"))
      ? { reason: "missing iOS Xcode project; run npm run ios:cap:add" }
      : {}),
  },
  xcodebuild: commandCheck("xcodebuild", ["-version"]),
  simctl: commandCheck("xcrun", ["simctl", "list", "devices", "available"]),
  codeSigningIdentity: {
    ...codeSigningIdentity,
  },
  appleTeamId: {
    ok: Boolean(teamId),
    value: teamId ?? null,
    ...(!teamId ? { reason: "missing --team-id, APPLE_TEAM_ID, or mobile/ios/release-config.json appleTeamId" } : {}),
  },
  provisioningProfile: await provisioningProfileCheck({ bundleId, profilesDir: args.profilesDir, teamId }),
};

const requiredChecks = [
  "origin",
  "capacitorConfig",
  "capacitorIosPackage",
  "iosProject",
  "xcodebuild",
  "simctl",
  "codeSigningIdentity",
  "appleTeamId",
  "provisioningProfile",
];
const blockers = requiredChecks
  .filter((key) => !checks[key].ok)
  .map((key) => ({
    check: key,
    reason: checks[key].reason ?? "missing",
  }));

function nextActionsForBlockers(blockers) {
  const blockerChecks = new Set(blockers.map((blocker) => blocker.check));
  const actions = [];

  if (blockerChecks.has("provisioningProfile")) {
    actions.push(
      "Register a real iPhone UDID in Apple Developer and create/download a provisioning profile for kr.co.finaljudo.multigym.",
    );
  }

  if (blockerChecks.has("origin")) {
    actions.push("Set FINAL_JUDO_IOS_SERVER_URL or --origin to the real HTTPS web app origin before sync/build.");
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

  return [...new Set(actions)];
}

const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  requestedArtifact: "iOS IPA",
  bundleId,
  releaseConfig: {
    path: text(args.releaseConfig) ?? DEFAULT_IOS_RELEASE_CONFIG_PATH,
    appleTeamIdConfigured: Boolean(text(releaseConfig.appleTeamId)),
    bundleIdConfigured: Boolean(text(releaseConfig.bundleId)),
  },
  checks,
  blockers,
  resolutionHints: createResolutionHints({ bundleId, teamId }),
  nextActions:
    blockers.length === 0
      ? ["Run Capacitor sync/build with production HTTPS origin and Apple signing options."]
      : nextActionsForBlockers(blockers),
};

if (args.out) {
  await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`);
}

if (args.markdown) {
  await writeFile(path.resolve(args.markdown), createMarkdown(report));
}

console.log(JSON.stringify(report, null, 2));

if (args.strict) {
  assert.equal(blockers.length, 0, blockers.map((blocker) => `${blocker.check}: ${blocker.reason}`).join("\n"));
}
