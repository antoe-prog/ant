import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const expectedBundleId = "kr.co.finaljudo.multigym";
const expectedDashboardRoute = "/app/dashboard";
const expectedSimulatorRole = "admin";

function parseArgs(argv) {
  const args = { strict: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--strict") {
      args.strict = true;
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
    }
  }

  return args;
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function rel(filePath) {
  return path.relative(process.cwd(), path.resolve(filePath)) || ".";
}

function isPlaceholderHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();

  return (
    ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(host) ||
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

function isLikelyApiOnlyHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return host === "api" || host.startsWith("api.") || host.includes(".api.");
}

function generatedServerUrlCheck(serverUrl) {
  if (!serverUrl) {
    return {
      ok: true,
      mode: "bundled_local",
      value: "No server.url; UI loads from the signed app bundle",
    };
  }

  try {
    const url = new URL(serverUrl);
    const next = url.searchParams.get("next");
    const isLocalSimulator =
      url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const isProductionHttps = url.protocol === "https:" && !isPlaceholderHost(url.hostname);
    const pointsAtServiceDashboard =
      url.pathname === "/login" && next === expectedDashboardRoute && url.searchParams.get("autoLogin") === "1";
    const pointsAtSimulatorDashboard =
      pointsAtServiceDashboard && url.searchParams.get("role") === expectedSimulatorRole;

    if (isLocalSimulator) {
      return {
        ok: pointsAtSimulatorDashboard,
        mode: "local_simulator",
        value: serverUrl,
        serviceRoute: next,
        simulatorRole: url.searchParams.get("role"),
        reason: pointsAtSimulatorDashboard
          ? undefined
          : `local simulator URL must auto-login role=${expectedSimulatorRole} and open ${expectedDashboardRoute} through /login`,
      };
    }

    if (isProductionHttps) {
      if (isLikelyApiOnlyHost(url.hostname)) {
        return {
          ok: false,
          mode: "api_origin_unverified",
          value: url.origin,
          reason:
            "production server.url looks like an API host; use the web app origin that serves /login and /app/dashboard before treating the iOS app as service-screen connected",
        };
      }

      return {
        ok: true,
        mode: "production_https",
        value: url.origin,
        serviceRoute: url.pathname,
      };
    }

    return {
      ok: false,
      mode: "unsupported",
      value: serverUrl,
      reason: "server.url must be a localhost simulator URL or a real HTTPS production origin",
    };
  } catch (error) {
    return {
      ok: false,
      mode: "invalid",
      value: serverUrl,
      reason: error instanceof Error ? error.message : "invalid URL",
    };
  }
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function createMarkdown(report) {
  const lines = [
    "# iOS Capacitor Service Connection",
    "",
    `- Generated: \`${report.generatedAt}\``,
    `- Status: \`${report.ok ? "connected" : "blocked"}\``,
    `- Release decision: \`${report.releaseDecision}\``,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
  ];

  for (const [key, check] of Object.entries(report.checks)) {
    lines.push(
      `| ${markdownCell(key)} | ${check.ok ? "ready" : "blocked"} | ${markdownCell(check.value ?? check.reason ?? check.mode ?? "")} |`,
    );
  }

  lines.push("", "## Release Caveats", "");
  for (const blocker of report.releaseBlockers) {
    lines.push(`- \`${blocker.code}\`: ${blocker.message}`);
  }

  lines.push("", "## Next Actions", "");
  for (const action of report.nextActions) {
    lines.push(`- ${action}`);
  }

  return `${lines.join("\n")}\n`;
}

const args = parseArgs(process.argv.slice(2));
const rootConfigPath = "capacitor.config.ts";
const generatedConfigPath = path.join("mobile", "ios", "App", "App", "capacitor.config.json");
const storyboardPath = path.join("mobile", "ios", "App", "App", "Base.lproj", "Main.storyboard");
const appDelegatePath = path.join("mobile", "ios", "App", "App", "AppDelegate.swift");
const bundledIndexPath = path.join("mobile", "ios", "App", "App", "public", "index.html");
const bundledLoginPath = path.join("mobile", "ios", "App", "App", "public", "login", "index.html");
const bundledDashboardPath = path.join("mobile", "ios", "App", "App", "public", "app", "dashboard", "index.html");
const dashboardRoutePath = path.join("src", "app", "(app)", "app", "dashboard", "page.tsx");

const [rootConfig, generatedConfig, storyboard, appDelegate, bundledIndex] = await Promise.all([
  readText(rootConfigPath),
  readJson(generatedConfigPath),
  readText(storyboardPath),
  readText(appDelegatePath),
  readText(bundledIndexPath),
]);
const generatedServer = generatedServerUrlCheck(generatedConfig?.server?.url);
const serviceConnected = generatedServer.ok && ["bundled_local", "local_simulator", "production_https"].includes(generatedServer.mode);
const usesDefaultCapacitorBridge =
  storyboard.includes('customClass="CAPBridgeViewController"') && storyboard.includes('customModule="Capacitor"');
const usesRegisteredAppBridge =
  storyboard.includes('customClass="FinalJudoBridgeViewController"') &&
  storyboard.includes('customModule="App"') &&
  appDelegate.includes("class FinalJudoBridgeViewController: CAPBridgeViewController") &&
  appDelegate.includes("bridge?.registerPluginInstance(AppPermissionsPlugin())");
const releaseBlockers =
  generatedServer.mode === "production_https" || generatedServer.mode === "bundled_local"
    ? [
        {
          code: "IOS_PROVISIONING_STILL_REQUIRED",
          message: "Production HTTPS connection is configured, but IPA release still requires ios:ipa:doctor and provisioning profile evidence.",
        },
      ]
    : [
        {
          code: "IOS_SIMULATOR_CONNECTION_ONLY",
          message: "Generated iOS config points to a localhost simulator URL; this proves app-screen connection, not IPA distribution readiness.",
        },
        {
          code: "IOS_PRODUCTION_ORIGIN_REQUIRED",
          message: "Set FINAL_JUDO_IOS_API_ORIGIN or --origin to a real HTTPS API origin before Capacitor sync/build for IPA.",
        },
      ];

const checks = {
  rootCapacitorConfig: {
    ok: rootConfig.includes(`appId: "${expectedBundleId}"`) && rootConfig.includes('webDir: "mobile/ios-web"'),
    value: rootConfigPath,
    ...(!(rootConfig.includes(`appId: "${expectedBundleId}"`) && rootConfig.includes('webDir: "mobile/ios-web"'))
      ? { reason: "capacitor.config.ts must define the Final Judo bundle id and iOS webDir" }
      : {}),
  },
  generatedCapacitorConfig: {
    ok: Boolean(generatedConfig),
    value: generatedConfigPath,
    ...(!generatedConfig ? { reason: "missing generated iOS capacitor.config.json; run npm run ios:cap:sync" } : {}),
  },
  bundledNativeHttp: {
    ok: generatedServer.mode !== "bundled_local" || generatedConfig?.plugins?.CapacitorHttp?.enabled === true,
    value: "CapacitorHttp.enabled",
    ...(generatedServer.mode === "bundled_local" && generatedConfig?.plugins?.CapacitorHttp?.enabled !== true
      ? { reason: "bundled iOS UI must enable CapacitorHttp for remote API requests" }
      : {}),
  },
  nativeBridge: {
    ok: usesDefaultCapacitorBridge || usesRegisteredAppBridge,
    value: usesRegisteredAppBridge
      ? `${storyboardPath} -> ${appDelegatePath}`
      : storyboardPath,
    ...(!(usesDefaultCapacitorBridge || usesRegisteredAppBridge)
      ? { reason: "Main.storyboard must use the Capacitor bridge directly or an app bridge subclass that registers native plugins" }
      : {}),
  },
  serviceDashboardRoute: {
    ok: existsSync(dashboardRoutePath),
    value: `${expectedDashboardRoute} -> ${dashboardRoutePath}`,
    ...(!existsSync(dashboardRoutePath) ? { reason: `missing Next route for ${expectedDashboardRoute}` } : {}),
  },
  generatedServerUrl: generatedServer,
  bundledWebUi: {
    ok: generatedServer.mode !== "bundled_local" || (
      existsSync(bundledLoginPath) &&
      existsSync(bundledDashboardPath) &&
      bundledIndex.includes("/_next/") &&
      !bundledIndex.includes("FINAL_JUDO_IOS_SERVER_URL")
    ),
    value: bundledIndexPath,
    ...(generatedServer.mode === "bundled_local" && !(
      existsSync(bundledLoginPath) &&
      existsSync(bundledDashboardPath) &&
      bundledIndex.includes("/_next/") &&
      !bundledIndex.includes("FINAL_JUDO_IOS_SERVER_URL")
    )
      ? { reason: "generated iOS public assets must contain the bundled login/dashboard UI, not the operator fallback" }
      : {}),
  },
};

const blockers = Object.entries(checks)
  .filter(([, check]) => !check.ok)
  .map(([check, result]) => ({
    check,
    reason: result.reason ?? "missing",
  }));

const report = {
  ok: blockers.length === 0 && serviceConnected,
  releaseDecision: generatedServer.mode === "bundled_local"
    ? "bundled_ui_configured"
    : generatedServer.mode === "production_https"
      ? "production_connection_configured"
      : "simulator_connected_release_blocked",
  generatedAt: new Date().toISOString(),
  bundleId: expectedBundleId,
  serviceRoute: expectedDashboardRoute,
  checked: [
    "Capacitor root config bundle id and webDir",
    "generated iOS Capacitor config",
    "Capacitor native bridge or registered app bridge subclass",
    "Next service dashboard route",
    "release config contains no remote server.url",
    "signed app bundle contains login and dashboard UI assets",
    "native HTTP bridge is enabled for the production API",
    "Simulator connection separated from IPA distribution readiness",
  ],
  checks,
  blockers,
  releaseBlockers,
  nextActions: [
    "Keep localhost simulator connection evidence separate from iOS IPA release readiness.",
    "Build the local UI with FINAL_JUDO_IOS_API_ORIGIN set to the production API and run npm run ios:cap:sync with FINAL_JUDO_IOS_LOCAL_BUNDLE=1.",
    "Run npm run ios:ipa:doctor and npm run ios:ipa:build only after real iPhone registration/provisioning profile evidence is ready.",
  ],
};

if (args.out) {
  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`);
}

if (args.markdown) {
  await mkdir(path.dirname(path.resolve(args.markdown)), { recursive: true });
  await writeFile(path.resolve(args.markdown), createMarkdown(report));
}

console.log(JSON.stringify({ ...report, generatedConfig: rel(generatedConfigPath) }, null, 2));

if (args.strict) {
  assert.equal(blockers.length, 0, blockers.map((blocker) => `${blocker.check}: ${blocker.reason}`).join("\n"));
}
