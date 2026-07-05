import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    allowApiOriginWebapp: process.env.FINAL_JUDO_ALLOW_API_ORIGIN_WEBAPP === "1",
    build: false,
    outDir: "mobile/android/generated",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--build") {
      args.build = true;
      continue;
    }

    if (arg === "--allow-api-origin-webapp") {
      args.allowApiOriginWebapp = true;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--origin") {
      args.origin = value;
    } else if (key === "--sha256") {
      args.sha256 = value;
    } else if (key === "--out-dir") {
      args.outDir = value;
    }
  }

  return args;
}

function assertHttpsOrigin(origin, { allowApiOriginWebapp = false } = {}) {
  assert(origin, "--origin=https://<webapp-origin> is required");
  const url = new URL(origin);
  assert.equal(url.protocol, "https:", "TWA origin must use HTTPS");
  assert(!isPlaceholderProductionHost(url.hostname) && !isPlaceholderOriginValue(origin), "TWA origin must be a real production host, not localhost/example/TODO");
  assert(
    allowApiOriginWebapp || !isLikelyApiOnlyHost(url.hostname),
    "TWA origin must serve the web app routes (/login and /app/dashboard), not only API routes; pass --allow-api-origin-webapp only after verifying the api.* host serves the web app",
  );
  return url.origin;
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

function isLikelyApiOnlyHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return host === "api" || host.startsWith("api.") || host.includes(".api.");
}

function assertSha256Fingerprint(value) {
  assert(value, "--sha256=<release-key-fingerprint> is required");
  const normalized = value.toUpperCase();
  assert(
    /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(normalized),
    "release key fingerprint must be 32 colon-separated SHA-256 hex bytes",
  );
  return normalized;
}

function uniqueTruthy(values) {
  return [...new Set(values.filter(Boolean))];
}

function executablePath(rootDir, segments) {
  return path.join(rootDir, ...segments);
}

function resolveJavaHome(rootDir) {
  return uniqueTruthy([
    process.env.JAVA_HOME,
    executablePath(rootDir, [".data", "toolchains", "jdk", "Contents", "Home"]),
    path.join(os.homedir(), "java", "jdk-21.0.5+11", "Contents", "Home"),
  ]).find((candidate) => existsSync(path.join(candidate, "bin", "java")) && existsSync(path.join(candidate, "bin", "keytool"))) ?? null;
}

function resolveAndroidHome(rootDir) {
  return uniqueTruthy([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    executablePath(rootDir, [".data", "toolchains", "android-sdk"]),
    path.join(os.homedir(), "Library", "Android", "sdk"),
  ]).find((candidate) => existsSync(candidate)) ?? null;
}

function createToolchainContext(rootDir) {
  const javaHome = resolveJavaHome(rootDir);
  const androidHome = resolveAndroidHome(rootDir);
  const pathEntries = uniqueTruthy([
    javaHome ? path.join(javaHome, "bin") : null,
    androidHome ? path.join(androidHome, "cmdline-tools", "latest", "bin") : null,
    androidHome ? path.join(androidHome, "platform-tools") : null,
    androidHome ? path.join(androidHome, "build-tools", "35.0.0") : null,
    process.env.PATH ?? "",
  ]);

  return {
    javaHome,
    androidHome,
    env: {
      ...process.env,
      ...(javaHome ? { JAVA_HOME: javaHome } : {}),
      ...(androidHome ? { ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome } : {}),
      PATH: pathEntries.join(path.delimiter),
    },
  };
}

function firstExistingCommand(candidates) {
  return candidates.find((candidate) => candidate && (candidate.includes(path.sep) ? existsSync(candidate) : true));
}

function commandAvailable(command, args = ["--version"], { candidates = [command], env = process.env } = {}) {
  return new Promise((resolve) => {
    const resolvedCommand = firstExistingCommand(candidates) ?? command;
    const child = spawn(resolvedCommand, args, { env, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function checkLocalBuildEnvironment() {
  const rootDir = process.cwd();
  const toolchain = createToolchainContext(rootDir);

  return {
    java: await commandAvailable("java", ["-version"], {
      candidates: [toolchain.javaHome ? path.join(toolchain.javaHome, "bin", "java") : null, "java"],
      env: toolchain.env,
    }),
    keytool: await commandAvailable("keytool", ["-help"], {
      candidates: [toolchain.javaHome ? path.join(toolchain.javaHome, "bin", "keytool") : null, "keytool"],
      env: toolchain.env,
    }),
    sdkmanager: await commandAvailable("sdkmanager", ["--version"], {
      candidates: [
        toolchain.androidHome ? path.join(toolchain.androidHome, "cmdline-tools", "latest", "bin", "sdkmanager") : null,
        "sdkmanager",
      ],
      env: toolchain.env,
    }),
    adb: await commandAvailable("adb", ["version"], {
      candidates: [toolchain.androidHome ? path.join(toolchain.androidHome, "platform-tools", "adb") : null, "adb"],
      env: toolchain.env,
    }),
    npx: await commandAvailable("npx", ["--version"], { env: toolchain.env }),
    androidHome: Boolean(toolchain.androidHome),
    androidHomeValue: toolchain.androidHome,
    javaHomeValue: toolchain.javaHome,
  };
}

function localBuildBlockers(environment) {
  const checks = [
    ["java", "Java Runtime is required before running Bubblewrap build."],
    ["keytool", "keytool is required to inspect Android signing material."],
    ["sdkmanager", "Android SDK command line tools are required before running Bubblewrap build."],
    ["adb", "adb platform-tools are required before Android device smoke and release handoff."],
    ["npx", "npx is required to invoke Bubblewrap without committing the CLI."],
    ["androidHome", "ANDROID_HOME or ANDROID_SDK_ROOT must point to the Android SDK."],
  ];

  return checks
    .filter(([key]) => !environment[key])
    .map(([check, reason]) => ({ check, reason }));
}

async function run(command, args, { env = process.env } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

const args = parseArgs(process.argv.slice(2));
const toolchain = createToolchainContext(process.cwd());
const origin = assertHttpsOrigin(args.origin, { allowApiOriginWebapp: args.allowApiOriginWebapp });
const sha256 = assertSha256Fingerprint(args.sha256);

const template = JSON.parse(await readFile("mobile/android/twa-config.template.json", "utf8"));
const assetLinksTemplate = JSON.parse(await readFile("mobile/android/assetlinks.template.json", "utf8"));
const outDir = path.resolve(args.outDir);
await mkdir(outDir, { recursive: true });

const manifestUrl = `${origin}${template.web.manifestPath}`;
const startUrl = `${origin}${template.web.startUrl}`;
const assetLinks = assetLinksTemplate.map((entry) => ({
  ...entry,
  target: {
    ...entry.target,
    sha256_cert_fingerprints: [sha256],
  },
}));

const bubblewrapManifest = {
  packageId: template.packageName,
  host: new URL(origin).hostname,
  name: template.appName,
  launcherName: template.launcherName,
  startUrl,
  manifestUrl,
  display: "standalone",
  fallbackType: template.build.fallbackType,
  orientation: "portrait",
  minSdkVersion: template.build.minSdk,
  targetSdkVersion: template.build.targetSdk,
};

const buildPlan = {
  strategy: template.strategy,
  generatedAt: new Date().toISOString(),
  origin,
  manifestUrl,
  startUrl,
  packageName: template.packageName,
  fallbackType: template.build.fallbackType,
  assetLinksDeployPath: `${origin}/.well-known/assetlinks.json`,
  outputs: template.build.outputs,
  commands: {
    init: `npx @bubblewrap/cli init --manifest=${manifestUrl} --directory=${template.build.androidProjectDir}`,
    build: `npx @bubblewrap/cli build --directory=${template.build.androidProjectDir}`,
  },
};

await writeFile(path.join(outDir, "assetlinks.json"), `${JSON.stringify(assetLinks, null, 2)}\n`);
await writeFile(path.join(outDir, "bubblewrap-manifest.json"), `${JSON.stringify(bubblewrapManifest, null, 2)}\n`);
await writeFile(path.join(outDir, "build-plan.json"), `${JSON.stringify(buildPlan, null, 2)}\n`);

const localBuildEnvironment = await checkLocalBuildEnvironment();
const buildBlockers = localBuildBlockers(localBuildEnvironment);

if (args.build) {
  assert.equal(
    buildBlockers.length,
    0,
    buildBlockers.map((blocker) => `${blocker.check}: ${blocker.reason}`).join("\n"),
  );
  await run("npx", ["@bubblewrap/cli", "init", `--manifest=${manifestUrl}`, `--directory=${template.build.androidProjectDir}`], {
    env: toolchain.env,
  });
  await run("npx", ["@bubblewrap/cli", "build", `--directory=${template.build.androidProjectDir}`], { env: toolchain.env });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      generated: [
        path.join(outDir, "assetlinks.json"),
        path.join(outDir, "bubblewrap-manifest.json"),
        path.join(outDir, "build-plan.json"),
      ],
      buildAttempted: args.build,
      buildReady: buildBlockers.length === 0,
      buildBlockers,
      localBuildEnvironment,
      nextAction: args.build
        ? "Android project directory 아래의 Bubblewrap 출력을 확인합니다."
        : buildBlockers.length === 0
          ? "assetlinks.json을 운영 host에 배포하고 release signing 준비가 끝나면 npm run android:twa:build를 실행합니다."
          : "assetlinks.json을 운영 host에 배포하고 buildBlockers를 해결한 뒤 npm run android:twa:build를 실행합니다.",
    },
    null,
    2,
  ),
);
