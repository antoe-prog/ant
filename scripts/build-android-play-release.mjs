import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_URL = "https://final-judo.vercel.app/login";
const DEFAULT_KEY_DIR = ".data/mobile-builds/android-play-aab-20260630-170515";
const DEFAULT_KEYSTORE_NAME = "final-judo-upload-keystore.jks";
const DEFAULT_PASSWORD_FILE_NAME = "final-judo-upload-key-password.txt";
const DEFAULT_ALIAS = "finaljudo-upload";
const REPORT_FILE_NAMES = new Set(["google-play-release-report.json", "google-play-aab-report.json", "android-play-release-report.json"]);

function parseArgs(argv) {
  const parsed = {
    alias: DEFAULT_ALIAS,
    allowSameVersion: false,
    desktopAab: path.join(os.homedir(), "Desktop/final-judo-play-release.aab"),
    desktopApk: path.join(os.homedir(), "Desktop/final-judo-release.apk"),
    keystore: null,
    outDir: null,
    passwordFile: null,
    skipClean: false,
    skipSync: false,
    url: process.env.FINAL_JUDO_ANDROID_SERVER_URL ?? DEFAULT_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--allow-same-version") {
      parsed.allowSameVersion = true;
      continue;
    }
    if (arg === "--skip-clean") {
      parsed.skipClean = true;
      continue;
    }
    if (arg === "--skip-sync") {
      parsed.skipSync = true;
      continue;
    }
    if (arg === "--no-desktop-copy") {
      parsed.desktopAab = null;
      parsed.desktopApk = null;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--alias") parsed.alias = value;
    else if (key === "--desktop-aab") parsed.desktopAab = value;
    else if (key === "--desktop-apk") parsed.desktopApk = value;
    else if (key === "--keystore") parsed.keystore = value;
    else if (key === "--out-dir") parsed.outDir = value;
    else if (key === "--password-file") parsed.passwordFile = value;
    else if (key === "--url") parsed.url = value;
  }

  return parsed;
}

function validateWebAppUrl(value) {
  const url = new URL(String(value ?? "").trim());
  const hostname = url.hostname.toLowerCase();

  assert.equal(url.protocol, "https:", "Android Play release URL must use HTTPS.");
  assert(!["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname), "Android Play release URL must not use a local host.");
  assert(!hostname.endsWith(".example"), "Android Play release URL must not use an example host.");
  assert(!hostname.startsWith("api."), "Android Play release URL must point to the web app origin, not an API-only origin.");

  return url.toString();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.stdio ?? "pipe",
  });

  if (result.status === 0) {
    return result;
  }

  throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

function javaMajor(javaHome) {
  const javaBin = path.join(javaHome, "bin/java");
  const result = run(javaBin, ["-version"]);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/version "(\d+)/);

  return match ? Number(match[1]) : 0;
}

function findJavaHome(rootDir) {
  const candidates = [
    process.env.JAVA_HOME,
    path.join(os.homedir(), "java/jdk-21.0.5+11/Contents/Home"),
    path.join(rootDir, ".data/toolchains/jdk21/Contents/Home"),
    path.join(rootDir, ".data/toolchains/jdk/Contents/Home"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (javaMajor(candidate) >= 21) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Android Play release build requires JDK 21 or newer.");
}

function findAndroidHome(rootDir) {
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(rootDir, ".data/toolchains/android-sdk");
  const buildToolsDir = path.join(androidHome, "build-tools/35.0.0");

  assert(existsSync(path.join(buildToolsDir, "aapt")), "Android build-tools 35.0.0/aapt is required.");
  assert(existsSync(path.join(buildToolsDir, "apksigner")), "Android build-tools 35.0.0/apksigner is required.");
  assert(existsSync(path.join(buildToolsDir, "zipalign")), "Android build-tools 35.0.0/zipalign is required.");

  return androidHome;
}

function parsePasswords(source) {
  const entries = Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.match(/^(storePassword|keyPassword)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );

  assert(entries.storePassword, "Upload password file must include storePassword.");
  assert(entries.keyPassword, "Upload password file must include keyPassword.");

  return entries;
}

function parseGradleVersion(buildGradleSource) {
  const versionCode = Number(buildGradleSource.match(/versionCode\s+(\d+)/)?.[1] ?? 0);
  const versionName = buildGradleSource.match(/versionName\s+"([^"]+)"/)?.[1] ?? "";

  assert(versionCode > 0, "mobile/android-cap/app/build.gradle must define a positive versionCode.");
  assert(versionName, "mobile/android-cap/app/build.gradle must define versionName.");

  return { versionCode, versionName };
}

function collectReportPaths(dir, acc = []) {
  if (!existsSync(dir)) {
    return acc;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectReportPaths(entryPath, acc);
    } else if (REPORT_FILE_NAMES.has(entry.name)) {
      acc.push(entryPath);
    }
  }

  return acc;
}

function parseVersionCodeValue(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return null;
}

function findFirstVersionCode(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object") {
    if ("versionCode" in value) {
      const found = parseVersionCodeValue(value.versionCode);

      if (found !== null) {
        return found;
      }
    }

    const items = Array.isArray(value) ? value : Object.values(value);

    for (const item of items) {
      const found = findFirstVersionCode(item);

      if (found !== null) {
        return found;
      }
    }
  }

  return null;
}

function latestRecordedVersionCode(rootDir) {
  return collectReportPaths(path.join(rootDir, ".data/mobile-builds"))
    .map((reportPath) => {
      try {
        const parsed = JSON.parse(readFileSync(reportPath, "utf8"));
        const versionCode = findFirstVersionCode(parsed);

        return versionCode ? { reportPath, versionCode } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.versionCode - left.versionCode)[0] ?? null;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writeCommandOutput(filePath, result) {
  writeFileSync(filePath, `${result.stdout ?? ""}${result.stderr ?? ""}`, "utf8");
}

function relativePosix(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const launchUrl = validateWebAppUrl(args.url);
  const androidDir = path.join(rootDir, "mobile/android-cap");
  const keyDir = path.join(rootDir, DEFAULT_KEY_DIR);
  const keystore = path.resolve(args.keystore ?? path.join(keyDir, DEFAULT_KEYSTORE_NAME));
  const passwordFile = path.resolve(args.passwordFile ?? path.join(keyDir, DEFAULT_PASSWORD_FILE_NAME));
  const buildGradlePath = path.join(androidDir, "app/build.gradle");
  const version = parseGradleVersion(readFileSync(buildGradlePath, "utf8"));
  const latestVersion = latestRecordedVersionCode(rootDir);

  if (!args.allowSameVersion && latestVersion && version.versionCode <= latestVersion.versionCode) {
    throw new Error(
      `Android Play versionCode must be greater than the latest recorded Play build. current=${version.versionCode}, latest=${latestVersion.versionCode} (${relativePosix(rootDir, latestVersion.reportPath)})`,
    );
  }

  const javaHome = findJavaHome(rootDir);
  const androidHome = findAndroidHome(rootDir);
  const buildToolsDir = path.join(androidHome, "build-tools/35.0.0");
  const passwords = parsePasswords(readFileSync(passwordFile, "utf8"));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const outDir = path.resolve(args.outDir ?? path.join(".data/mobile-builds", `android-play-release-${stamp}`));
  const unsignedAab = path.join(androidDir, "app/build/outputs/bundle/release/app-release.aab");
  const unsignedApk = path.join(androidDir, "app/build/outputs/apk/release/app-release-unsigned.apk");
  const copiedUnsignedAab = path.join(outDir, "final-judo-play-release-unsigned.aab");
  const alignedUnsignedApk = path.join(outDir, "final-judo-release-aligned-unsigned.apk");
  const signedAab = path.join(outDir, "final-judo-play-release.aab");
  const signedApk = path.join(outDir, "final-judo-release.apk");
  const verificationAab = path.join(outDir, "aab-jarsigner-verify.txt");
  const verificationApk = path.join(outDir, "apk-apksigner-verify.txt");
  const fileList = path.join(outDir, "aab-file-list.txt");
  const apkBadgingPath = path.join(outDir, "apk-aapt-badging.txt");
  const reportPath = path.join(outDir, "google-play-release-report.json");
  const env = {
    ...process.env,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    FINAL_JUDO_ANDROID_SERVER_URL: launchUrl,
    FINAL_JUDO_UPLOAD_KEYPASS: passwords.keyPassword,
    FINAL_JUDO_UPLOAD_STOREPASS: passwords.storePassword,
    JAVA_HOME: javaHome,
    PATH: [path.join(javaHome, "bin"), buildToolsDir, path.join(androidHome, "platform-tools"), process.env.PATH ?? ""].join(path.delimiter),
  };

  mkdirSync(outDir, { recursive: true });

  run(process.execPath, ["scripts/generate-android-launcher-assets.mjs"], { cwd: rootDir, env, stdio: "inherit" });
  if (!args.skipSync) {
    run(process.execPath, ["node_modules/@capacitor/cli/bin/capacitor", "sync", "android"], { cwd: rootDir, env, stdio: "inherit" });
  }

  run("./gradlew", [...(args.skipClean ? [] : ["clean"]), ":app:assembleRelease", ":app:bundleRelease", "--console=plain"], {
    cwd: androidDir,
    env,
    stdio: "inherit",
  });
  copyFileSync(unsignedAab, copiedUnsignedAab);

  run(
    path.join(javaHome, "bin/jarsigner"),
    [
      "-sigalg",
      "SHA384withRSA",
      "-digestalg",
      "SHA-384",
      "-keystore",
      keystore,
      "-storepass:env",
      "FINAL_JUDO_UPLOAD_STOREPASS",
      "-keypass:env",
      "FINAL_JUDO_UPLOAD_KEYPASS",
      "-signedjar",
      signedAab,
      copiedUnsignedAab,
      args.alias,
    ],
    { env },
  );
  run(path.join(buildToolsDir, "zipalign"), ["-p", "-f", "4", unsignedApk, alignedUnsignedApk], { env });
  run(
    path.join(buildToolsDir, "apksigner"),
    [
      "sign",
      "--ks",
      keystore,
      "--ks-key-alias",
      args.alias,
      "--ks-pass",
      "env:FINAL_JUDO_UPLOAD_STOREPASS",
      "--key-pass",
      "env:FINAL_JUDO_UPLOAD_KEYPASS",
      "--out",
      signedApk,
      alignedUnsignedApk,
    ],
    { env },
  );

  const aabVerify = run(path.join(javaHome, "bin/jarsigner"), ["-verify", "-verbose", "-certs", signedAab], { env });
  const apkVerify = run(path.join(buildToolsDir, "apksigner"), ["verify", "--print-certs", signedApk], { env });
  const aabListing = run("unzip", ["-l", signedAab], { env });
  const aabConfig = run("unzip", ["-p", signedAab, "base/assets/capacitor.config.json"], { env }).stdout;
  const apkBadging = run(path.join(buildToolsDir, "aapt"), ["dump", "badging", signedApk], { env }).stdout;
  const capacitorConfig = JSON.parse(aabConfig);
  const hasTwaRuntime = /androidbrowserhelper|customtabs\.trusted|TrustedWebActivity/i.test(aabListing.stdout);

  assert.equal(capacitorConfig.server?.url, launchUrl, "generated AAB must launch the requested production web app URL.");
  assert.equal(hasTwaRuntime, false, "Capacitor Play AAB must not include the TWA/Custom Tabs runtime.");
  assert(apkBadging.includes("package: name='kr.co.finaljudo.multigym'"), "signed APK must keep the stable package name.");
  assert(apkBadging.includes(`versionCode='${version.versionCode}'`), "signed APK must use the source versionCode.");
  assert(apkBadging.includes(`versionName='${version.versionName}'`), "signed APK must use the source versionName.");
  assert(aabVerify.stdout.includes("jar verified."), "signed AAB must pass jarsigner verification.");
  assert(apkVerify.stdout.includes("Signer #1 certificate SHA-256 digest"), "signed APK must pass apksigner verification.");

  writeCommandOutput(verificationAab, aabVerify);
  writeCommandOutput(verificationApk, apkVerify);
  writeFileSync(fileList, aabListing.stdout, "utf8");
  writeFileSync(apkBadgingPath, apkBadging, "utf8");

  const desktopAab = args.desktopAab ? path.resolve(args.desktopAab) : null;
  const desktopApk = args.desktopApk ? path.resolve(args.desktopApk) : null;

  if (desktopAab) {
    copyFileSync(signedAab, desktopAab);
  }
  if (desktopApk) {
    copyFileSync(signedApk, desktopApk);
  }

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    packageName: "kr.co.finaljudo.multigym",
    versionCode: version.versionCode,
    versionName: version.versionName,
    launchUrl,
    artifacts: {
      aab: signedAab,
      apk: signedApk,
      ...(desktopAab ? { desktopAab } : {}),
      ...(desktopApk ? { desktopApk } : {}),
      unsignedAab: copiedUnsignedAab,
      alignedUnsignedApk,
      verificationAab,
      verificationApk,
      fileList,
      apkBadging: apkBadgingPath,
      report: reportPath,
    },
    sizes: {
      aabBytes: statSync(signedAab).size,
      apkBytes: statSync(signedApk).size,
    },
    sha256: {
      aab: sha256File(signedAab),
      apk: sha256File(signedApk),
      ...(desktopAab ? { desktopAab: sha256File(desktopAab) } : {}),
      ...(desktopApk ? { desktopApk: sha256File(desktopApk) } : {}),
    },
    signing: {
      uploadKeyAlias: args.alias,
      aabVerified: true,
      apkVerified: true,
      apkCertificate: apkVerify.stdout
        .split("\n")
        .filter((line) => line.includes("Signer #1 certificate"))
        .map((line) => line.trim()),
    },
    checks: [
      "Gradle :app:assembleRelease completed",
      "Gradle :app:bundleRelease completed",
      "AAB signed with Final Judo upload key",
      "APK zipaligned and signed with Final Judo upload key",
      "Capacitor server.url points to deployed production login URL",
      "No TWA/androidbrowserhelper/customtabs.trusted entries detected in AAB listing",
      "Desktop AAB/APK copies refreshed",
      "versionCode is greater than latest recorded Play build unless --allow-same-version is used",
    ],
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        desktopAab,
        desktopApk,
        versionCode: version.versionCode,
        versionName: version.versionName,
        aabBytes: report.sizes.aabBytes,
        apkBytes: report.sizes.apkBytes,
        aabSha256: report.sha256.aab,
        apkSha256: report.sha256.apk,
        launchUrl,
        reportPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
