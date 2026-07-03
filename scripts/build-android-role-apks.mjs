import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ROLE_VARIANTS = [
  {
    id: "unified",
    role: "unified",
    label: "통합",
    packageId: "kr.co.finaljudo.multigym",
    appName: "파이널 유도",
    launcherName: "파이널 유도",
    startUrl: "/login",
    versionCode: 100,
    versionName: "0.1.0",
  },
  {
    id: "member",
    role: "member",
    label: "회원",
    packageId: "kr.co.finaljudo.multigym.member",
    appName: "파이널 유도 회원",
    launcherName: "유도 회원",
    startUrl: "/login?role=member&next=%2Fapp%2Fdashboard",
    versionCode: 101,
    versionName: "0.1.0-member.1",
  },
  {
    id: "guardian",
    role: "guardian",
    label: "학부모",
    packageId: "kr.co.finaljudo.multigym.guardian",
    appName: "파이널 유도 학부모",
    launcherName: "유도 학부모",
    startUrl: "/login?role=guardian&next=%2Fapp%2Fdashboard",
    versionCode: 102,
    versionName: "0.1.0-guardian.1",
  },
  {
    id: "coach",
    role: "coach",
    label: "코치",
    packageId: "kr.co.finaljudo.multigym.coach",
    appName: "파이널 유도 코치",
    launcherName: "유도 코치",
    startUrl: "/login?role=coach&next=%2Fapp%2Fclasses",
    versionCode: 103,
    versionName: "0.1.0-coach.1",
  },
  {
    id: "owner",
    role: "owner",
    label: "대표",
    packageId: "kr.co.finaljudo.multigym.owner",
    appName: "파이널 유도 대표",
    launcherName: "유도 대표",
    startUrl: "/login?role=owner&next=%2Fapp%2Fowner%2Freports",
    versionCode: 104,
    versionName: "0.1.0-owner.1",
  },
];

const DEFAULT_SHA256 =
  "3C:94:19:E9:5B:14:C1:9C:94:A3:2C:5C:8A:D1:3D:AE:AE:E1:64:9E:06:ED:58:7C:F0:D6:E4:2C:5E:C9:37:3B";

function parseArgs(argv) {
  const args = {
    origin: process.env.ANDROID_TWA_ORIGIN ?? null,
    outDir: null,
    roles: ROLE_VARIANTS.map((variant) => variant.id),
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--skip-build") {
      args.skipBuild = true;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--origin") {
      args.origin = value;
    } else if (key === "--out-dir") {
      args.outDir = value;
    } else if (key === "--roles") {
      args.roles = value.split(",").map((role) => role.trim()).filter(Boolean);
    }
  }

  return args;
}

function replaceRequired(contents, pattern, replacement, label) {
  assert(pattern.test(contents), `Could not find ${label}`);
  return contents.replace(pattern, replacement);
}

function shell(command, args, options = {}) {
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

async function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

function workspacePath(rootDir, filePath) {
  const relative = path.relative(rootDir, filePath);

  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }

  return filePath;
}

function normalizeSha256Fingerprint(value) {
  const compact = String(value ?? "").replace(/[^0-9a-f]/gi, "").toUpperCase();

  assert.equal(compact.length, 64, "Android signing SHA-256 fingerprint must contain 32 bytes");

  return compact.match(/.{2}/g).join(":");
}

function signerSha256FromVerification(value) {
  const match = String(value).match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f:]+)/i);

  assert(match, "Could not read signer SHA-256 digest from apksigner verification output");

  return normalizeSha256Fingerprint(match[1]);
}

function buildEnv(rootDir) {
  const javaHome = process.env.JAVA_HOME || path.join(rootDir, ".data/toolchains/jdk/Contents/Home");
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

function applyVariantFiles(files, variant, origin) {
  const originUrl = new URL(origin);
  const originRoot = `${originUrl.origin}/`;
  const packagePattern = /^package\s+[\w.]+;/m;

  const twaManifest = JSON.parse(files.twaManifest);
  twaManifest.packageId = variant.packageId;
  twaManifest.host = originUrl.hostname;
  twaManifest.name = variant.appName;
  twaManifest.launcherName = variant.launcherName;
  twaManifest.startUrl = variant.startUrl;
  twaManifest.fullScopeUrl = originRoot;
  twaManifest.fallbackType = "webview";
  twaManifest.appVersionName = variant.versionName;
  twaManifest.appVersion = variant.versionName;
  twaManifest.appVersionCode = variant.versionCode;

  let appGradle = files.appGradle;
  appGradle = replaceRequired(appGradle, /applicationId:\s*'[^']+'/m, `applicationId: '${variant.packageId}'`, "twaManifest applicationId");
  appGradle = replaceRequired(appGradle, /hostName:\s*'[^']+'/m, `hostName: '${originUrl.hostname}'`, "twaManifest hostName");
  appGradle = replaceRequired(appGradle, /launchUrl:\s*'[^']*'/m, `launchUrl: '${variant.startUrl}'`, "twaManifest launchUrl");
  appGradle = replaceRequired(appGradle, /name:\s*'[^']*'/m, `name: '${variant.appName}'`, "twaManifest name");
  appGradle = replaceRequired(appGradle, /launcherName:\s*'[^']*'/m, `launcherName: '${variant.launcherName}'`, "twaManifest launcherName");
  appGradle = replaceRequired(appGradle, /fallbackType:\s*'[^']*'/m, "fallbackType: 'webview'", "TWA fallback strategy");
  appGradle = replaceRequired(appGradle, /namespace\s+"[^"]+"/m, `namespace "${variant.packageId}"`, "android namespace");
  appGradle = replaceRequired(appGradle, /applicationId\s+"[^"]+"/m, `applicationId "${variant.packageId}"`, "defaultConfig applicationId");
  appGradle = replaceRequired(appGradle, /versionCode\s+\d+/m, `versionCode ${variant.versionCode}`, "versionCode");
  appGradle = replaceRequired(appGradle, /versionName\s+"[^"]+"/m, `versionName "${variant.versionName}"`, "versionName");
  appGradle = replaceRequired(appGradle, /resValue "string", "fullScopeUrl", '[^']+'/m, `resValue "string", "fullScopeUrl", '${originRoot}'`, "fullScopeUrl");

  const androidManifest = replaceRequired(
    files.androidManifest,
    /package="[^"]+"/m,
    `package="${variant.packageId}"`,
    "AndroidManifest package",
  );

  return {
    twaManifest: `${JSON.stringify(twaManifest, null, 2)}\n`,
    appGradle,
    androidManifest,
    launcherActivity: files.launcherActivity.replace(packagePattern, `package ${variant.packageId};`),
    application: files.application.replace(packagePattern, `package ${variant.packageId};`),
    delegationService: files.delegationService.replace(packagePattern, `package ${variant.packageId};`),
  };
}

async function writeVariantFiles(paths, files) {
  await writeFile(paths.twaManifest, files.twaManifest);
  await writeFile(paths.appGradle, files.appGradle);
  await writeFile(paths.androidManifest, files.androidManifest);
  await writeFile(paths.launcherActivity, files.launcherActivity);
  await writeFile(paths.application, files.application);
  await writeFile(paths.delegationService, files.delegationService);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const projectDir = path.join(rootDir, "mobile/android/twa");
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const outDir = path.resolve(args.outDir ?? path.join(".data/mobile-builds", `role-apks-${today}`));
  const env = buildEnv(rootDir);
  const androidHome = env.ANDROID_HOME;
  const buildToolsDir = path.join(androidHome, "build-tools/35.0.0");
  const zipalign = path.join(buildToolsDir, "zipalign");
  const apksigner = path.join(buildToolsDir, "apksigner");
  const keystorePath = path.resolve(process.env.ANDROID_KEYSTORE_PATH ?? ".data/android-test-keystore.jks");
  const keyAlias = process.env.ANDROID_KEY_ALIAS ?? "finaljudo-test";
  const keystorePassword = process.env.ANDROID_KEYSTORE_PASSWORD;
  const keyPassword = process.env.ANDROID_KEY_PASSWORD ?? keystorePassword;

  const baseManifest = JSON.parse(await readFile(path.join(projectDir, "twa-manifest.json"), "utf8"));
  const origin = args.origin ?? `https://${baseManifest.host}`;
  const originUrl = new URL(origin);
  assert.equal(originUrl.protocol, "https:", "Android TWA origin must be HTTPS");

  const selectedVariants = args.roles.map((role) => {
    const variant = ROLE_VARIANTS.find((item) => item.id === role || item.role === role);
    assert(variant, `Unknown role variant: ${role}`);
    return variant;
  });

  assert(args.skipBuild || keystorePassword, "ANDROID_KEYSTORE_PASSWORD is required to sign APKs");
  assert(args.skipBuild || keyPassword, "ANDROID_KEY_PASSWORD is required to sign APKs");

  await mkdir(outDir, { recursive: true });

  const paths = {
    twaManifest: path.join(projectDir, "twa-manifest.json"),
    appGradle: path.join(projectDir, "app/build.gradle"),
    androidManifest: path.join(projectDir, "app/src/main/AndroidManifest.xml"),
    launcherActivity: path.join(projectDir, "app/src/main/java/kr/co/finaljudo/multigym/LauncherActivity.java"),
    application: path.join(projectDir, "app/src/main/java/kr/co/finaljudo/multigym/Application.java"),
    delegationService: path.join(projectDir, "app/src/main/java/kr/co/finaljudo/multigym/DelegationService.java"),
  };

  const originalFiles = {
    twaManifest: await readFile(paths.twaManifest, "utf8"),
    appGradle: await readFile(paths.appGradle, "utf8"),
    androidManifest: await readFile(paths.androidManifest, "utf8"),
    launcherActivity: await readFile(paths.launcherActivity, "utf8"),
    application: await readFile(paths.application, "utf8"),
    delegationService: await readFile(paths.delegationService, "utf8"),
  };

  const outputs = [];
  try {
    for (const variant of selectedVariants) {
      console.log(`\n==> Building ${variant.label} APK (${variant.packageId})`);
      await writeVariantFiles(paths, applyVariantFiles(originalFiles, variant, originUrl.origin));

      if (args.skipBuild) {
        continue;
      }

      await shell("./gradlew", ["clean", ":app:assembleRelease"], { cwd: projectDir, env });

      const unsignedApk = path.join(projectDir, "app/build/outputs/apk/release/app-release-unsigned.apk");
      const alignedApk = path.join(outDir, `final-judo-${variant.id}-${variant.versionName}-unsigned-aligned.apk`);
      const signedApk = path.join(outDir, `final-judo-${variant.id}-${variant.versionName}.apk`);

      await shell(zipalign, ["-f", "-p", "4", unsignedApk, alignedApk], { env });
      await shell(
        apksigner,
        [
          "sign",
          "--ks",
          keystorePath,
          "--ks-key-alias",
          keyAlias,
          "--ks-pass",
          `pass:${keystorePassword}`,
          "--key-pass",
          `pass:${keyPassword}`,
          "--out",
          signedApk,
          alignedApk,
        ],
        { env },
      );

      const verification = await shell(apksigner, ["verify", "--print-certs", signedApk], { env, stdio: "pipe" });
      const signerSha256 = signerSha256FromVerification(verification.stdout);
      const fileStat = await stat(signedApk);
      await unlink(alignedApk);

      outputs.push({
        role: variant.role,
        label: variant.label,
        packageId: variant.packageId,
        appName: variant.appName,
        launcherName: variant.launcherName,
        startUrl: `${originUrl.origin}${variant.startUrl}`,
        versionCode: variant.versionCode,
        versionName: variant.versionName,
        apk: workspacePath(rootDir, signedApk),
        bytes: fileStat.size,
        sha256: await sha256File(signedApk),
        signerSha256,
        verification: verification.stdout.trim().split("\n").slice(0, 8),
      });
    }
  } finally {
    await writeVariantFiles(paths, originalFiles);
  }

  const signerSha256ByPackage = new Map(outputs.map((output) => [output.packageId, output.signerSha256]));
  const fallbackSha256 = normalizeSha256Fingerprint(process.env.ANDROID_TWA_SHA256 ?? DEFAULT_SHA256);
  const assetlinks = selectedVariants.map((variant) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: variant.packageId,
      sha256_cert_fingerprints: [signerSha256ByPackage.get(variant.packageId) ?? fallbackSha256],
    },
  }));

  await writeFile(path.join(outDir, "assetlinks.json"), `${JSON.stringify(assetlinks, null, 2)}\n`);

  const report = {
    ok: !args.skipBuild,
    generatedAt: new Date().toISOString(),
    origin: originUrl.origin,
    outDir: workspacePath(rootDir, outDir),
    assetlinks: workspacePath(rootDir, path.join(outDir, "assetlinks.json")),
    outputs,
    releaseDecision: "artifact_ready_release_blocked",
    releaseBlockers: [
      "stable HTTPS production origin",
      "release signing key/SHA-256 fingerprint",
      "Digital Asset Links deployed on the production origin",
      "Android real-device smoke and release signoff",
    ],
    note:
      "These role APKs are installable Android TWA wrappers. Use a stable HTTPS production origin and release signing key before Play Store distribution.",
  };

  await writeFile(path.join(outDir, "role-apk-build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

await main();
