import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_URL = "https://final-judo.vercel.app/login";
const WEBVIEW_APK_NAME = "final-judo-native-webview-debug.apk";
const FIELD_INSTALL_APK_NAME = "INSTALL_ONLY_final-judo-native-webview-debug.apk";
const INSTALL_GUIDE_NAME = "INSTALL_ANDROID_WEBVIEW_APK.txt";
const WRONG_ARTIFACT_MARKER_NAME = "DO_NOT_INSTALL_FOR_FIELD_WEBVIEW.txt";
const LAUNCHER_ICON_ENTRY = "res/mipmap-xxxhdpi-v4/ic_launcher.png";
const ADAPTIVE_ICON_ENTRY = "res/mipmap-anydpi-v26/ic_launcher.xml";
const ADAPTIVE_ROUND_ICON_ENTRY = "res/mipmap-anydpi-v26/ic_launcher_round.xml";
const ADAPTIVE_FOREGROUND_ENTRY = "res/mipmap-xxxhdpi-v4/ic_launcher_foreground.png";
const SOURCE_LAUNCHER_ICON = "mobile/android-cap/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png";
const SOURCE_ADAPTIVE_FOREGROUND = "mobile/android-cap/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png";
const LAUNCHER_ICON_PROOF_NAME = "apk-ic_launcher-xxxhdpi.png";
const ADAPTIVE_FOREGROUND_PROOF_NAME = "apk-ic_launcher_foreground-xxxhdpi.png";
const WRONG_ARTIFACT_PATHS = [
  "mobile/android/twa/app-release-signed.apk",
  "mobile/android/twa/app-release-unsigned-aligned.apk",
  "mobile/android/twa/app-release-bundle.aab",
  "mobile/android/twa/app/build/outputs/apk/debug/app-debug.apk",
  "mobile/android/twa/app/build/outputs/apk/release/app-release-unsigned.apk",
  "mobile/android/twa/**/*.apk",
];

function parseArgs(argv) {
  const parsed = {
    url: process.env.FINAL_JUDO_ANDROID_SERVER_URL ?? DEFAULT_URL,
    outDir: null,
    desktopCopy: path.join(os.homedir(), "Desktop/final-judo-native-webview-debug.apk"),
    skipSync: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--skip-sync") {
      parsed.skipSync = true;
      continue;
    }

    if (arg === "--no-desktop-copy") {
      parsed.desktopCopy = null;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--url") {
      parsed.url = value;
    } else if (key === "--out-dir") {
      parsed.outDir = value;
    } else if (key === "--desktop-copy") {
      parsed.desktopCopy = value;
    }
  }

  return parsed;
}

function validateWebAppUrl(value) {
  const url = new URL(String(value ?? "").trim());
  const hostname = url.hostname.toLowerCase();

  assert.equal(url.protocol, "https:", "Android WebView APK URL must use HTTPS.");
  assert(!["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname), "Android WebView APK URL must not use a local host.");
  assert(!hostname.endsWith(".example"), "Android WebView APK URL must not use an example host.");
  assert(!hostname.startsWith("api."), "Android WebView APK URL must point to the web app origin, not an API-only origin.");

  return url.toString();
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? "inherit",
    });

    let stdout = "";
    let stderr = "";

    if (options.stdio === "pipe") {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stderr}`));
    });
  });
}

function runBinary(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stderr}`));
    });
  });
}

async function javaMajor(javaHome) {
  const javaBin = path.join(javaHome, "bin/java");
  const { stderr, stdout } = await run(javaBin, ["-version"], { stdio: "pipe" });
  const output = `${stdout}\n${stderr}`;
  const match = output.match(/version "(\d+)/);
  return match ? Number(match[1]) : 0;
}

async function findJavaHome(rootDir) {
  const candidates = [
    process.env.JAVA_HOME,
    path.join(os.homedir(), "java/jdk-21.0.5+11/Contents/Home"),
    path.join(rootDir, ".data/toolchains/jdk21/Contents/Home"),
    path.join(rootDir, ".data/toolchains/jdk/Contents/Home"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if ((await javaMajor(candidate)) >= 21) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Android Capacitor APK build requires JDK 21 or newer.");
}

function buildEnv(rootDir, javaHome) {
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(rootDir, ".data/toolchains/android-sdk");

  return {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    PATH: [
      path.join(javaHome, "bin"),
      path.join(androidHome, "cmdline-tools/latest/bin"),
      path.join(androidHome, "platform-tools"),
      path.join(androidHome, "build-tools/35.0.0"),
      path.join(androidHome, "build-tools/34.0.0"),
      process.env.PATH ?? "",
    ].join(path.delimiter),
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

function sha256Buffer(buffer) {
  const hash = createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

function relativePosix(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function installGuidePathFor(apkPath) {
  const extension = path.extname(apkPath);
  const basePath = extension ? apkPath.slice(0, -extension.length) : apkPath;
  return `${basePath}-INSTALL.txt`;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatInstallGuide(report) {
  return `${[
    "FINAL Judo Android WebView APK install guide",
    "",
    "Install this APK only:",
    `- ${report.installInstructions.preferredApk}`,
    "",
    "Equivalent generated APK:",
    `- ${report.artifacts.apk}`,
    "",
    "Desktop copy:",
    `- ${report.artifacts.desktopFieldInstallCopy ?? "not generated"}`,
    "",
    "Equivalent desktop copy:",
    `- ${report.artifacts.desktopCopy ?? "not generated"}`,
    "",
    "Do not install these TWA/Bubblewrap artifacts for field verification:",
    ...WRONG_ARTIFACT_PATHS.map((artifactPath) => `- ${artifactPath}`),
    "",
    "Wrong-artifact marker files:",
    ...(report.artifacts.wrongArtifactMarkers.length > 0
      ? report.artifacts.wrongArtifactMarkers.map((markerPath) => `- ${markerPath}`)
      : ["- not generated because TWA APK output folders were not present"]),
    "",
    "No-address-bar quality check:",
    "- The app must open without an Android browser URL bar, share button, or overflow menu above the FINAL app header.",
    "- If final-judo.vercel.app is visible in a top browser bar, uninstall that app and install the WebView APK listed above.",
    "",
    "Before install:",
    "- Uninstall any previous FINAL Judo app with package kr.co.finaljudo.multigym first so Android clears the old launcher icon cache.",
    "- If Android reports a signature conflict, uninstall any previous app with package kr.co.finaljudo.multigym.",
    "",
    `Package: ${report.packageId}`,
    `Launch URL: ${report.launchUrl}`,
    `SHA-256: ${report.sha256}`,
    `Bytes: ${report.bytes}`,
  ].join("\n")}\n`;
}

function formatWrongArtifactMarker(report) {
  return `${[
    "DO NOT INSTALL THIS FOLDER'S APK FOR FIELD WEBVIEW QA",
    "",
    "The APKs in this TWA/Bubblewrap output folder can open through a browser/TWA/Custom Tab path.",
    "That is the path that can show an Android top URL/search bar such as final-judo.vercel.app.",
    "",
    "Install this APK instead:",
    `- ${report.installInstructions.preferredApk}`,
    "",
    "Desktop copy:",
    `- ${report.artifacts.desktopFieldInstallCopy ?? report.artifacts.desktopCopy ?? "not generated"}`,
    "",
    `Package: ${report.packageId}`,
    `SHA-256: ${report.sha256}`,
  ].join("\n")}\n`;
}

async function writeWrongArtifactMarkers(rootDir, report) {
  const markerPaths = [];
  const markerSource = formatWrongArtifactMarker(report);
  const writtenMarkerPaths = new Set();

  for (const artifactPath of WRONG_ARTIFACT_PATHS.filter((value) => !value.includes("*"))) {
    const artifactDir = path.join(rootDir, path.dirname(artifactPath));

    if (!(await pathExists(artifactDir))) {
      continue;
    }

    const markerPath = path.join(artifactDir, WRONG_ARTIFACT_MARKER_NAME);
    const relativeMarkerPath = relativePosix(rootDir, markerPath);

    if (writtenMarkerPaths.has(relativeMarkerPath)) {
      continue;
    }

    await writeFile(markerPath, markerSource, "utf8");
    markerPaths.push(relativeMarkerPath);
    writtenMarkerPaths.add(relativeMarkerPath);
  }

  return markerPaths;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const launchUrl = validateWebAppUrl(args.url);
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const outDir = path.resolve(args.outDir ?? path.join(".data/mobile-builds", `android-capacitor-webview-${today}`));
  const javaHome = await findJavaHome(rootDir);
  const env = {
    ...buildEnv(rootDir, javaHome),
    FINAL_JUDO_ANDROID_SERVER_URL: launchUrl,
  };
  const androidDir = path.join(rootDir, "mobile/android-cap");
  const apkSource = path.join(androidDir, "app/build/outputs/apk/debug/app-debug.apk");
  const apkOut = path.join(outDir, WEBVIEW_APK_NAME);
  const fieldInstallApkOut = path.join(outDir, FIELD_INSTALL_APK_NAME);
  const launcherIconProofDir = path.join(outDir, "icon-proof");
  const launcherIconProofPath = path.join(launcherIconProofDir, LAUNCHER_ICON_PROOF_NAME);
  const adaptiveForegroundProofPath = path.join(launcherIconProofDir, ADAPTIVE_FOREGROUND_PROOF_NAME);
  const reportPath = path.join(outDir, "android-capacitor-webview-report.json");
  const installGuidePath = path.join(outDir, INSTALL_GUIDE_NAME);
  const resolvedDesktopCopy = args.desktopCopy ? path.resolve(args.desktopCopy) : null;
  const desktopFieldInstallCopyPath = resolvedDesktopCopy ? path.join(path.dirname(resolvedDesktopCopy), FIELD_INSTALL_APK_NAME) : null;
  const desktopInstallGuidePath = resolvedDesktopCopy ? installGuidePathFor(resolvedDesktopCopy) : null;
  const aapt = path.join(env.ANDROID_HOME, "build-tools/35.0.0/aapt");
  const apksigner = path.join(env.ANDROID_HOME, "build-tools/35.0.0/apksigner");

  await mkdir(outDir, { recursive: true });

  await run(process.execPath, ["scripts/generate-android-launcher-assets.mjs"], {
    cwd: rootDir,
    env,
  });

  if (!args.skipSync) {
    await run(process.execPath, ["node_modules/@capacitor/cli/bin/capacitor", "sync", "android"], {
      cwd: rootDir,
      env,
    });
  }

  await run("./gradlew", [":app:assembleDebug", "--console=plain"], { cwd: androidDir, env });
  await copyFile(apkSource, apkOut);
  await copyFile(apkSource, fieldInstallApkOut);

  if (resolvedDesktopCopy) {
    await copyFile(apkSource, resolvedDesktopCopy);
    await copyFile(apkSource, desktopFieldInstallCopyPath);
  }

  const [apkStats, sha256, badging, signing, listing, capacitorConfigSource, expectedLauncherIconSha256, expectedAdaptiveForegroundSha256] = await Promise.all([
    stat(apkOut),
    sha256File(apkOut),
    run(aapt, ["dump", "badging", apkOut], { env, stdio: "pipe" }).then((result) => result.stdout),
    run(apksigner, ["verify", "--print-certs", apkOut], { env, stdio: "pipe" }).then((result) => `${result.stdout}\n${result.stderr}`),
    run("unzip", ["-l", apkOut], { env, stdio: "pipe" }).then((result) => result.stdout),
    readFile(path.join(androidDir, "app/src/main/assets/capacitor.config.json"), "utf8"),
    sha256File(path.join(rootDir, SOURCE_LAUNCHER_ICON)),
    sha256File(path.join(rootDir, SOURCE_ADAPTIVE_FOREGROUND)),
  ]);
  const capacitorConfig = JSON.parse(capacitorConfigSource);
  const hasTwaRuntime = /androidbrowserhelper|customtabs\.trusted|TrustedWebActivity/i.test(`${badging}\n${listing}`);
  const apkLauncherIcon = await runBinary("unzip", ["-p", apkOut, LAUNCHER_ICON_ENTRY], { env });
  const apkLauncherIconSha256 = sha256Buffer(apkLauncherIcon);

  assert.equal(capacitorConfig.server?.url, launchUrl, "generated Capacitor config must launch the requested URL.");
  assert(badging.includes("launchable-activity: name='kr.co.finaljudo.multigym.MainActivity'"), "APK must launch the Capacitor MainActivity.");
  assert.equal(hasTwaRuntime, false, "Capacitor APK must not include the TWA/Custom Tabs runtime.");
  assert(badging.includes(`application: label='파이널유도멀티짐' icon='${ADAPTIVE_ICON_ENTRY}'`), "APK application icon must point at the FINAL adaptive icon.");
  assert(badging.includes(`application-icon-640:'${ADAPTIVE_ICON_ENTRY}'`), "APK launcher density icons must resolve through the FINAL adaptive icon.");
  assert(listing.includes(ADAPTIVE_ICON_ENTRY), "Capacitor APK must package the adaptive launcher icon XML.");
  assert(listing.includes(ADAPTIVE_ROUND_ICON_ENTRY), "Capacitor APK must package the adaptive round launcher icon XML.");
  assert(listing.includes(ADAPTIVE_FOREGROUND_ENTRY), "Capacitor APK must package the adaptive launcher foreground PNG.");
  assert(listing.includes(LAUNCHER_ICON_ENTRY), "Capacitor APK must package the xxxhdpi launcher icon.");
  assert.equal(apkLauncherIconSha256, expectedLauncherIconSha256, "APK launcher icon must match the generated FINAL PNG Android resource.");
  const apkAdaptiveForeground = await runBinary("unzip", ["-p", apkOut, ADAPTIVE_FOREGROUND_ENTRY], { env });
  const apkAdaptiveForegroundSha256 = sha256Buffer(apkAdaptiveForeground);
  assert.equal(
    apkAdaptiveForegroundSha256,
    expectedAdaptiveForegroundSha256,
    "APK adaptive foreground icon must match the generated FINAL PNG Android resource.",
  );

  await mkdir(launcherIconProofDir, { recursive: true });
  await writeFile(launcherIconProofPath, apkLauncherIcon);
  await writeFile(adaptiveForegroundProofPath, apkAdaptiveForeground);

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    packaging: "capacitor-native-webview",
    packageId: "kr.co.finaljudo.multigym",
    launchUrl,
    artifacts: {
      apk: relativePosix(rootDir, apkOut),
      fieldInstallApk: relativePosix(rootDir, fieldInstallApkOut),
      ...(resolvedDesktopCopy ? { desktopCopy: resolvedDesktopCopy, desktopFieldInstallCopy: desktopFieldInstallCopyPath } : {}),
      installGuide: relativePosix(rootDir, installGuidePath),
      ...(desktopInstallGuidePath ? { desktopInstallGuide: desktopInstallGuidePath } : {}),
      wrongArtifactMarkers: [],
      launcherIconProof: relativePosix(rootDir, launcherIconProofPath),
      capacitorConfig: "mobile/android-cap/app/src/main/assets/capacitor.config.json",
      androidProject: "mobile/android-cap",
    },
    bytes: apkStats.size,
    sha256,
    signing: {
      verified: signing.includes("Signer #1 certificate SHA-256 digest"),
      certificate: signing
        .split("\n")
        .filter((line) => line.includes("Signer #1 certificate"))
        .map((line) => line.trim()),
    },
    checks: [
      "Capacitor Android project builds a debug APK",
      "server.url points to the web app launch URL",
      "APK launchable activity is kr.co.finaljudo.multigym.MainActivity",
      "APK does not include androidbrowserhelper or TWA Custom Tabs runtime",
      "APK application icon points to the FINAL adaptive icon",
      "APK launcher icon matches generated FINAL PNG resource",
      "APK adaptive foreground icon matches generated FINAL PNG resource",
      "debug APK is signed and installable",
    ],
    launcherIcon: {
      sourceIcon: "public/icons/final-judo-icon-512.png",
      sourceAndroidResource: SOURCE_LAUNCHER_ICON,
      sourceAdaptiveForegroundResource: SOURCE_ADAPTIVE_FOREGROUND,
      adaptiveIconEntry: ADAPTIVE_ICON_ENTRY,
      adaptiveRoundIconEntry: ADAPTIVE_ROUND_ICON_ENTRY,
      adaptiveForegroundEntry: ADAPTIVE_FOREGROUND_ENTRY,
      apkEntry: LAUNCHER_ICON_ENTRY,
      proof: relativePosix(rootDir, launcherIconProofPath),
      adaptiveForegroundProof: relativePosix(rootDir, adaptiveForegroundProofPath),
      sha256: apkLauncherIconSha256,
      expectedSha256: expectedLauncherIconSha256,
      adaptiveForegroundSha256: apkAdaptiveForegroundSha256,
      expectedAdaptiveForegroundSha256,
    },
    installInstructions: {
      preferredApk: relativePosix(rootDir, fieldInstallApkOut),
      equivalentApk: relativePosix(rootDir, apkOut),
      installOnly: `Install ${FIELD_INSTALL_APK_NAME}; do not install ambiguous app-debug.apk files from TWA/Bubblewrap build directories.`,
      doNotInstall: WRONG_ARTIFACT_PATHS,
      desktopCopy: resolvedDesktopCopy,
      desktopFieldInstallCopy: desktopFieldInstallCopyPath,
      packageId: "kr.co.finaljudo.multigym",
      beforeInstall:
        "Uninstall any previous app with package kr.co.finaljudo.multigym before installing this debug APK so Android clears old launcher icon cache and avoids signature conflicts.",
      qualityCheck:
        "A correct Capacitor WebView install must not show the Android browser URL bar, share button, or overflow menu above the FINAL app header.",
      wrongArtifactWarning:
        "If final-judo.vercel.app is visible in a top browser bar, the installed artifact is a browser/TWA/Custom Tab path, not this native WebView APK.",
    },
    limitations: [
      "debug APK uses Android debug signing; uninstall any differently signed previous APK with the same package before installing",
      "for Play Store release, produce a release-signed build and complete Android release handoff",
    ],
  };

  report.artifacts.wrongArtifactMarkers = await writeWrongArtifactMarkers(rootDir, report);

  const installGuide = formatInstallGuide(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(installGuidePath, installGuide, "utf8");
  if (desktopInstallGuidePath) {
    await writeFile(desktopInstallGuidePath, installGuide, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
