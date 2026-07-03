import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const manifestModule = await import("../src/app/manifest.ts");
const manifest = manifestModule.default();

const [
  twaConfigSource,
  twaProjectManifestSource,
  twaAppGradleSource,
  twaAndroidManifestSource,
  twaStringsSource,
  assetLinksSource,
  publicAssetLinksSource,
  strategyDoc,
  packageJsonSource,
  releaseRunnerSource,
  serviceWorkerSource,
  twaDoctorSource,
  twaBuildSource,
  roleApkBuildSource,
  twaWorkflowSource,
  capacitorConfigSource,
  androidCapManifestSource,
  androidCapBuildSource,
  androidCapUnitTestSource,
  androidCapInstrumentedTestSource,
  androidLauncherAssetsSource,
] = await Promise.all([
  readFile("mobile/android/twa-config.template.json", "utf8"),
  readFile("mobile/android/twa/twa-manifest.json", "utf8"),
  readFile("mobile/android/twa/app/build.gradle", "utf8"),
  readFile("mobile/android/twa/app/src/main/AndroidManifest.xml", "utf8"),
  readFile("mobile/android/twa/app/src/main/res/values/strings.xml", "utf8"),
  readFile("mobile/android/assetlinks.template.json", "utf8"),
  readFile("public/.well-known/assetlinks.json", "utf8"),
  readFile("docs/ANDROID_PACKAGING_STRATEGY.md", "utf8"),
  readFile("package.json", "utf8"),
  readFile("scripts/run-release-checks.mjs", "utf8"),
  readFile("public/sw.js", "utf8"),
  readFile("scripts/check-android-twa-doctor.mjs", "utf8"),
  readFile("scripts/build-android-twa.mjs", "utf8"),
  readFile("scripts/build-android-role-apks.mjs", "utf8"),
  readFile(".github/workflows/android-twa.yml", "utf8"),
  readFile("capacitor.config.ts", "utf8"),
  readFile("mobile/android-cap/app/src/main/AndroidManifest.xml", "utf8"),
  readFile("scripts/build-android-capacitor-apk.mjs", "utf8"),
  readFile("mobile/android-cap/app/src/test/java/kr/co/finaljudo/multigym/FinalJudoPackageTest.java", "utf8"),
  readFile("mobile/android-cap/app/src/androidTest/java/kr/co/finaljudo/multigym/FinalJudoInstrumentedTest.java", "utf8"),
  readFile("scripts/generate-android-launcher-assets.mjs", "utf8"),
]);

const twaConfig = JSON.parse(twaConfigSource);
const twaProjectManifest = JSON.parse(twaProjectManifestSource);
const assetLinks = JSON.parse(assetLinksSource);
const publicAssetLinks = JSON.parse(publicAssetLinksSource);
const packageJson = JSON.parse(packageJsonSource);
const doctorOutputDir = await mkdtemp(path.join(tmpdir(), "final-judo-android-doctor-"));
const doctorJsonPath = path.join(doctorOutputDir, "android-twa-doctor.json");
const doctorMarkdownPath = path.join(doctorOutputDir, "android-twa-doctor.md");
const blockedDoctorJsonPath = path.join(doctorOutputDir, "android-twa-doctor.blocked-origin.json");
const blockedDoctorMarkdownPath = path.join(doctorOutputDir, "android-twa-doctor.blocked-origin.md");
const apiOriginDoctorJsonPath = path.join(doctorOutputDir, "android-twa-doctor.api-origin.json");
const buildOutputDir = path.join(doctorOutputDir, "twa-build");
const sampleSha256 = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

await execFile(
  process.execPath,
  [
    "scripts/check-android-twa-doctor.mjs",
    "--origin=https://app.finaljudo.kr",
    `--sha256=${sampleSha256}`,
    `--out=${doctorJsonPath}`,
    `--markdown=${doctorMarkdownPath}`,
  ],
  { cwd: process.cwd() },
);
const doctorReport = JSON.parse(await readFile(doctorJsonPath, "utf8"));
const doctorMarkdown = await readFile(doctorMarkdownPath, "utf8");

await execFile(
  process.execPath,
  [
    "scripts/check-android-twa-doctor.mjs",
    "--origin=https://ops.finaljudo.example",
    `--sha256=${sampleSha256}`,
    `--out=${blockedDoctorJsonPath}`,
    `--markdown=${blockedDoctorMarkdownPath}`,
  ],
  { cwd: process.cwd() },
);
const blockedDoctorReport = JSON.parse(await readFile(blockedDoctorJsonPath, "utf8"));

await execFile(
  process.execPath,
  [
    "scripts/check-android-twa-doctor.mjs",
    "--origin=https://api.finaljudo.co.kr",
    `--sha256=${sampleSha256}`,
    `--out=${apiOriginDoctorJsonPath}`,
  ],
  { cwd: process.cwd() },
);
const apiOriginDoctorReport = JSON.parse(await readFile(apiOriginDoctorJsonPath, "utf8"));

await execFile(
  process.execPath,
  [
    "scripts/build-android-twa.mjs",
    "--origin=https://app.finaljudo.kr",
    `--sha256=${sampleSha256}`,
    `--out-dir=${buildOutputDir}`,
  ],
  { cwd: process.cwd() },
);

await execFile(process.execPath, ["scripts/generate-android-launcher-assets.mjs", "--check"], { cwd: process.cwd() });

for (const removedTemplateIconPath of [
  "mobile/android-cap/app/src/main/res/drawable/ic_launcher_background.xml",
  "mobile/android-cap/app/src/main/res/drawable-v24/ic_launcher_foreground.xml",
]) {
  await assert.rejects(
    readFile(removedTemplateIconPath, "utf8"),
    /ENOENT/,
    `${removedTemplateIconPath} must not keep the old Capacitor template launcher artwork`,
  );
}

await assert.rejects(
  execFile(
    process.execPath,
    [
      "scripts/build-android-twa.mjs",
      "--origin=https://ops.finaljudo.example",
      `--sha256=${sampleSha256}`,
      `--out-dir=${path.join(doctorOutputDir, "blocked-twa-build")}`,
    ],
    { cwd: process.cwd() },
  ),
  /real production host/,
  "TWA prepare/build helper must reject .example placeholder origins",
);

await assert.rejects(
  execFile(
    process.execPath,
    [
      "scripts/build-android-twa.mjs",
      "--origin=https://api.finaljudo.co.kr",
      `--sha256=${sampleSha256}`,
      `--out-dir=${path.join(doctorOutputDir, "blocked-api-origin-twa-build")}`,
    ],
    { cwd: process.cwd() },
  ),
  /web app routes/,
  "TWA prepare/build helper must reject API-only-looking origins unless explicitly verified",
);

assert.equal(twaConfig.strategy, "trusted-web-activity", "Android packaging strategy must be TWA");
assert.equal(twaConfig.packageName, "kr.co.finaljudo.multigym", "TWA package name must be stable");
assert.equal(twaConfig.build.tool, "bubblewrap", "TWA packaging must use Bubblewrap");
assert.deepEqual(twaConfig.build.outputs, ["apk", "aab"], "Android packaging must target APK and AAB outputs");
assert.equal(twaConfig.build.fallbackType, "webview", "TWA fallback must remain configured while Digital Asset Links is required for fullscreen TWA release quality");
assert.equal(twaConfig.web.productionOrigin, "https://TODO_PRODUCTION_HOST", "template must not hard-code an unverified production host");
assert.equal(twaConfig.web.manifestPath, "/manifest.webmanifest", "TWA must use the Next web app manifest URL");
assert.equal(twaConfig.web.startUrl, "/app", "TWA must launch into the role-based app shell");
assert.equal(twaConfig.web.scope, "/", "TWA scope must cover all protected app routes");
assert.equal(twaConfig.verification.requiresHttps, true, "TWA release must require HTTPS");
assert.equal(twaConfig.verification.requiresDigitalAssetLinks, true, "TWA release must require Digital Asset Links");
assert.equal(twaConfig.verification.requiresJdkAndAndroidSdk, true, "APK/AAB build must require native Android tooling");
assert.equal(twaProjectManifest.fallbackType, "webview", "generated TWA manifest must keep WebView fallback configured");
assert.equal(twaProjectManifest.host, "final-judo.vercel.app", "generated TWA manifest must target the deployed web app host used by installable APKs");
assert.equal(twaProjectManifest.startUrl, "/login", "generated TWA manifest must start at login for installable APKs");
assert(twaAppGradleSource.includes("fallbackType: 'webview'"), "TWA Gradle project must keep WebView fallback configured");
assert(!twaAppGradleSource.includes("fallbackType: 'customtabs'"), "TWA Gradle project must not use the Chrome Custom Tab fallback");
assert(twaAppGradleSource.includes("hostName: 'final-judo.vercel.app'"), "TWA Gradle project must target final-judo.vercel.app");
assert(twaAppGradleSource.includes("launchUrl: '/login'"), "TWA Gradle project must launch at login");
assert(twaStringsSource.includes('\\"site\\": \\"https://final-judo.vercel.app\\"'), "TWA asset statement must target final-judo.vercel.app");
assert(!`${twaProjectManifestSource}\n${twaAppGradleSource}\n${twaStringsSource}`.includes("loca.lt"), "TWA project must not keep temporary tunnel hosts");
assert(twaAndroidManifestSource.includes('android.permission.INTERNET'), "TWA WebView fallback must declare Android internet permission");

assert.equal(manifest.start_url, twaConfig.web.startUrl, "Next manifest start_url must match the TWA launch URL");
assert.equal(manifest.scope, twaConfig.web.scope, "Next manifest scope must match the TWA route scope");
assert.equal(manifest.display, "standalone", "Next manifest must provide standalone display for TWA/PWA");
assert.equal(manifest.orientation, "portrait", "Next manifest must keep the mobile operations portrait orientation");
assert(!manifest.icons?.some((icon) => icon.src === "/icons/final-judo-icon.svg"), "Next manifest must not expose the stale SVG icon path to Android installers");
assert(
  manifest.icons?.some((icon) => icon.src === "/icons/final-judo-icon-512.png" && String(icon.purpose ?? "").includes("maskable")),
  "TWA needs a maskable 512px icon",
);
assert(serviceWorkerSource.includes('pathname.startsWith("/api/")'), "service worker must not cache operational APIs inside Android app shells");
assert(serviceWorkerSource.includes("function isNextStaticAsset"), "service worker must keep Next app chunks out of cache-first app shell handling");
assert(serviceWorkerSource.indexOf("if (isNextStaticAsset(requestUrl.pathname))") < serviceWorkerSource.indexOf("if (isStaticAsset(requestUrl.pathname))"), "service worker must fetch Next app chunks before falling back to cache");

assert(Array.isArray(assetLinks) && assetLinks.length === 1, "assetlinks template must contain one Android app relation");
assert.deepEqual(assetLinks[0].relation, ["delegate_permission/common.handle_all_urls"], "assetlinks must delegate URL handling");
assert.equal(assetLinks[0].target.namespace, "android_app", "assetlinks target must be an Android app");
assert.equal(assetLinks[0].target.package_name, twaConfig.packageName, "assetlinks package must match TWA package");
assert.equal(
  assetLinks[0].target.sha256_cert_fingerprints[0],
  "TODO_RELEASE_CERT_SHA256_FINGERPRINT",
  "assetlinks template must require a release signing certificate fingerprint",
);
const publicAssetLinkPackages = new Map(
  publicAssetLinks.map((entry) => [entry?.target?.package_name, entry?.target?.sha256_cert_fingerprints?.[0]]),
);
for (const packageName of [
  "kr.co.finaljudo.multigym",
  "kr.co.finaljudo.multigym.member",
  "kr.co.finaljudo.multigym.guardian",
  "kr.co.finaljudo.multigym.coach",
  "kr.co.finaljudo.multigym.owner",
]) {
  assert(publicAssetLinkPackages.has(packageName), `public assetlinks must include ${packageName}`);
  assert.match(
    publicAssetLinkPackages.get(packageName),
    /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    `${packageName} public assetlinks fingerprint must be a normalized SHA-256 certificate fingerprint`,
  );
}
assert(publicAssetLinksSource.includes("C8:9C:B8:66:FE:3F:57:21:68:5A:BC:7F:F2:45:CE:11:EC:A5:5A:DC:9A:8F:7E:EA:A0:65:2A:36:15:2A:1C:11"), "public assetlinks must match the current installable APK signing certificate");
assert(roleApkBuildSource.includes("signerSha256FromVerification"), "role APK build must derive assetlinks fingerprints from the signed APK");
assert(roleApkBuildSource.includes("signerSha256ByPackage"), "role APK build must write assetlinks from signer verification output");

assert(capacitorConfigSource.includes('androidServerUrl = process.env.FINAL_JUDO_ANDROID_SERVER_URL?.trim()'), "Capacitor config must support an Android-specific server URL");
assert(capacitorConfigSource.includes('path: "mobile/android-cap"'), "Capacitor config must point Android builds at mobile/android-cap");
assert(androidCapManifestSource.includes('android:name=".MainActivity"'), "Capacitor Android manifest must launch MainActivity");
assert(!androidCapManifestSource.includes("android.support.customtabs.trusted"), "Capacitor Android manifest must not include TWA Custom Tabs metadata");
for (const [label, source] of [
  ["Capacitor Android unit test", androidCapUnitTestSource],
  ["Capacitor Android instrumented test", androidCapInstrumentedTestSource],
]) {
  assert(source.includes("kr.co.finaljudo.multigym"), `${label} must use the FINAL app package`);
  assert(!source.includes("com.getcapacitor.myapp"), `${label} must not keep the Capacitor template package`);
  assert(!source.includes("com.getcapacitor.app"), `${label} must not keep the Capacitor template applicationId`);
}
assert(androidCapUnitTestSource.includes("FinalJudoPackageTest.class.getPackage().getName()"), "Capacitor Android unit test must verify the FINAL source package");
assert(androidCapInstrumentedTestSource.includes("getTargetContext()"), "Capacitor Android instrumented test must verify the installed app context");
assert(androidCapBuildSource.includes('packaging: "capacitor-native-webview"'), "Capacitor APK builder must report native WebView packaging");
assert(androidCapBuildSource.includes("FINAL_JUDO_ANDROID_SERVER_URL"), "Capacitor APK builder must sync the Android server URL before building");
assert(androidCapBuildSource.includes("androidbrowserhelper|customtabs"), "Capacitor APK builder must reject TWA/Custom Tabs runtime leakage");
assert(androidCapBuildSource.includes("wrongArtifactWarning"), "Capacitor APK builder must warn when a browser/TWA artifact was installed instead");
assert(androidCapBuildSource.includes("INSTALL_ONLY_final-judo-native-webview-debug.apk"), "Capacitor APK builder must create an unmistakable field-install APK alias");
assert(androidCapBuildSource.includes("DO_NOT_INSTALL_FOR_FIELD_WEBVIEW.txt"), "Capacitor APK builder must drop warning markers next to ambiguous TWA APK outputs");
assert(androidCapBuildSource.includes("INSTALL_ANDROID_WEBVIEW_APK.txt"), "Capacitor APK builder must generate a human-readable install guide");
assert(androidCapBuildSource.includes("mobile/android/twa/app/build/outputs/apk/debug/app-debug.apk"), "Capacitor APK builder must name the ambiguous TWA debug APK as a forbidden install artifact");
assert(androidCapBuildSource.includes("doNotInstall"), "Capacitor APK builder report must expose forbidden TWA/Bubblewrap install paths");
assert(androidCapBuildSource.includes('["scripts/generate-android-launcher-assets.mjs"]'), "Capacitor APK builder must regenerate FINAL launcher assets before syncing/building");
assert(androidCapBuildSource.includes("launcherIconProof"), "Capacitor APK builder report must expose the extracted launcher icon proof");
assert(androidCapBuildSource.includes("res/mipmap-xxxhdpi-v4/ic_launcher.png"), "Capacitor APK builder must inspect the packaged launcher icon entry");
assert(androidCapBuildSource.includes("APK launcher icon matches generated FINAL PNG resource"), "Capacitor APK builder must verify the packaged launcher icon");
assert(androidCapBuildSource.includes("res/mipmap-anydpi-v26/ic_launcher.xml"), "Capacitor APK builder must inspect the packaged adaptive launcher icon entry");
assert(androidCapBuildSource.includes("res/mipmap-xxxhdpi-v4/ic_launcher_foreground.png"), "Capacitor APK builder must inspect the packaged adaptive foreground icon entry");
assert(androidCapBuildSource.includes("APK application icon points to the FINAL adaptive icon"), "Capacitor APK builder must verify the launcher uses the FINAL adaptive icon");
assert(
  androidCapBuildSource.includes("APK adaptive foreground icon matches generated FINAL PNG resource"),
  "Capacitor APK builder must verify the packaged adaptive foreground icon",
);
assert(androidCapBuildSource.includes("must not show the Android browser URL bar"), "Capacitor APK report must include the no-address-bar quality check");
assert(androidCapBuildSource.includes("JDK 21 or newer"), "Capacitor APK builder must require the Java version used by the Android project");
assert(androidLauncherAssetsSource.includes("public/icons/final-judo-icon-512.png"), "Android launcher asset generator must use the FINAL PNG source icon");
assert(!androidLauncherAssetsSource.includes("public/icons/final-judo-icon.svg"), "Android launcher asset generator must not use the alternate SVG artwork");
assert(androidLauncherAssetsSource.includes("mobile/android-cap/app/src/main/res"), "Android launcher asset generator must update Capacitor native resources");
assert(androidLauncherAssetsSource.includes("mobile/android/twa/app/src/main/res"), "Android launcher asset generator must update TWA resources");
assert(androidLauncherAssetsSource.includes("mobile/android/twa/store_icon.png"), "Android launcher asset generator must update the TWA store icon");
assert(androidLauncherAssetsSource.includes("ic_launcher_foreground.png"), "Android launcher asset generator must update adaptive foreground icons");
assert(androidLauncherAssetsSource.includes("splash.png"), "Android launcher asset generator must update old splash assets");

for (const script of [
  "test:android-packaging",
  "android:icons",
  "android:twa:doctor",
  "android:twa:prepare",
  "android:twa:build",
  "android:cap:sync",
  "android:cap:build",
]) {
  assert(packageJson.scripts?.[script], `package.json must expose ${script}`);
}

assert(releaseRunnerSource.includes('["run", "test:android-packaging"]'), "test:release must include Android packaging readiness");
assert(releaseRunnerSource.includes('["run", "android:twa:doctor"]'), "test:release must include Android TWA doctor readiness");
assert(strategyDoc.includes("Trusted Web Activity"), "Android strategy doc must explain the selected TWA approach");
assert(strategyDoc.includes("Capacitor Android WebView"), "Android strategy doc must record the Capacitor WebView install path");
assert(strategyDoc.includes("Chrome 주소창"), "Android strategy doc must document the top address-bar failure mode");
assert(strategyDoc.includes("android:icons"), "Android strategy doc must document the launcher icon generation command");
assert(strategyDoc.includes("public/icons/final-judo-icon-512.png"), "Android strategy doc must document the FINAL PNG launcher icon source");
assert(strategyDoc.includes("android:cap:build"), "Android strategy doc must document the address-bar-free Capacitor APK command");
assert(strategyDoc.includes("INSTALL_ANDROID_WEBVIEW_APK.txt"), "Android strategy doc must document the generated WebView install guide");
assert(strategyDoc.includes("mobile/android/twa/app/build/outputs/apk/debug/app-debug.apk"), "Android strategy doc must explicitly forbid the ambiguous TWA debug APK for field installs");
assert(strategyDoc.includes("Digital Asset Links"), "Android strategy doc must document assetlinks requirements");
assert(strategyDoc.includes("JDK"), "Android strategy doc must record the current local APK blocker");
assert(strategyDoc.includes("android:twa:doctor"), "Android strategy doc must document the TWA doctor command");
assert(strategyDoc.includes("--strict"), "Android strategy doc must document strict doctor mode");
assert(twaDoctorSource.includes("sdkmanager"), "TWA doctor must check Android SDK command line tools");
assert(twaDoctorSource.includes("ANDROID_HOME"), "TWA doctor must check Android SDK environment variables");
assert(twaDoctorSource.includes("--strict"), "TWA doctor must expose strict mode for real APK/AAB builds");
assert(twaDoctorSource.includes("--out"), "TWA doctor must write a shareable JSON report");
assert(twaDoctorSource.includes("--markdown"), "TWA doctor must write a shareable Markdown report");
assert(twaDoctorSource.includes("--no-deployed-origin"), "TWA doctor must support disabling deployed-origin fallback for missing-origin fixtures");
assert(twaDoctorSource.includes(".data/deployment-handoff.report.json"), "TWA doctor must reuse deployment handoff origin when CLI origin is absent");
assert(twaDoctorSource.includes(".data/p1-readiness.json"), "TWA doctor must reuse P1 readiness origin when CLI origin is absent");
assert(twaDoctorSource.includes("real production host"), "TWA doctor must reject localhost/example/TODO origins");
assert.equal(doctorReport.checks.origin.ok, true, "doctor fixture must accept HTTPS production origin");
assert.equal(doctorReport.checks.sha256.value, sampleSha256, "doctor fixture must normalize release SHA-256 fingerprint");
assert(Array.isArray(doctorReport.installHints.macos), "doctor report must expose macOS install hints");
assert(Array.isArray(doctorReport.installHints.environment), "doctor report must expose environment setup hints");
assert(Array.isArray(doctorReport.installHints.ci), "doctor report must expose CI packaging hints");
assert(doctorReport.installHints.rerun.includes("android:twa:doctor"), "doctor report must include a strict rerun command");
assert.equal(blockedDoctorReport.checks.origin.ok, false, "doctor fixture must reject .example placeholder origin");
assert.match(blockedDoctorReport.checks.origin.reason, /real production host/, "doctor blocked origin reason must explain production host requirement");
assert.equal(apiOriginDoctorReport.checks.origin.ok, false, "doctor fixture must reject API-only-looking origin");
assert.match(apiOriginDoctorReport.checks.origin.reason, /web app origin/, "API origin blocker must explain web app origin requirement");
assert.equal(doctorReport.commands.prepare.includes("android:twa:prepare"), true, "doctor report must include prepare command");
assert(doctorMarkdown.includes("# Android TWA Doctor"), "doctor Markdown must include a title");
assert(doctorMarkdown.includes("| Check | Status | Detail |"), "doctor Markdown must include check table");
assert(doctorMarkdown.includes("## Next Actions"), "doctor Markdown must include next actions");
assert(doctorMarkdown.includes("## Install Hints"), "doctor Markdown must include install hints");
assert(doctorMarkdown.includes("### CI"), "doctor Markdown must include CI packaging hints");
assert(doctorMarkdown.includes("android:twa:doctor"), "doctor Markdown must include a strict rerun command");
assert(!doctorMarkdown.includes("PRIVATE KEY"), "doctor Markdown must not expose secret-like signing material");
assert(twaBuildSource.includes("keytool"), "TWA build script must guard Android signing inspection tooling");
assert(twaBuildSource.includes("adb"), "TWA build script must guard Android device tooling before APK/AAB builds");
assert(twaBuildSource.includes("ANDROID_HOME"), "TWA build script must require Android SDK home before APK/AAB builds");
assert(twaBuildSource.includes("ANDROID_SDK_ROOT"), "TWA build script must support ANDROID_SDK_ROOT");
assert(twaBuildSource.includes("buildReady"), "TWA build script must expose buildReady in prepare output");
assert(twaBuildSource.includes("buildBlockers"), "TWA build script must expose build blockers in prepare output");
assert(twaBuildSource.includes("fallbackType: template.build.fallbackType"), "TWA build script must carry fallbackType into generated inputs");
assert(twaBuildSource.includes("fallbackType: template.build.fallbackType,"), "TWA build plan must record the configured fallback type");
assert(twaBuildSource.includes("real production host"), "TWA build script must reject localhost/example/TODO origins");
assert(twaWorkflowSource.includes("workflow_dispatch"), "Android TWA workflow must be manually dispatchable");
assert(twaWorkflowSource.includes("production_origin"), "Android TWA workflow must request the production origin");
assert(twaWorkflowSource.includes("release_sha256"), "Android TWA workflow must request the release SHA-256 fingerprint");
assert(twaWorkflowSource.includes("build_artifacts"), "Android TWA workflow must make APK/AAB build explicit");
assert(twaWorkflowSource.includes("actions/checkout@v6"), "Android TWA workflow must use the current checkout action");
assert(twaWorkflowSource.includes("actions/setup-node@v6"), "Android TWA workflow must set up Node.js");
assert(twaWorkflowSource.includes("node-version: 24"), "Android TWA workflow must match the local Node.js major version");
assert(twaWorkflowSource.includes("actions/setup-java@v5"), "Android TWA workflow must set up a JDK");
assert(twaWorkflowSource.includes("actions/upload-artifact@v6"), "Android TWA workflow must upload generated artifacts");
assert(twaWorkflowSource.includes("npm run android:twa:doctor --"), "Android TWA workflow must run the doctor command");
assert(twaWorkflowSource.includes("--strict"), "Android TWA workflow must use strict doctor mode");
assert(twaWorkflowSource.includes("npm run android:twa:prepare --"), "Android TWA workflow must generate TWA inputs");
assert(twaWorkflowSource.includes("npm run android:twa:build --"), "Android TWA workflow must expose the Bubblewrap build path");
assert(twaWorkflowSource.includes("mobile/android/generated/**"), "Android TWA workflow must upload generated TWA inputs");
assert(twaWorkflowSource.includes("mobile/android/twa/**/*.apk"), "Android TWA workflow must upload APK outputs when present");
assert(twaWorkflowSource.includes("mobile/android/twa/**/*.aab"), "Android TWA workflow must upload AAB outputs when present");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "TWA strategy template",
        "TWA fallback configuration",
        "Capacitor native WebView install APK path",
        "Digital Asset Links template",
        "public assetlinks for current installable APKs",
        "Next PWA manifest compatibility",
        "service worker API cache exclusion",
        "Android packaging npm scripts",
        "Android TWA doctor",
        "Android TWA API-origin guard",
        "Android TWA doctor Markdown report",
        "Android TWA build environment guard",
        "Android TWA GitHub Actions workflow",
        "release gate inclusion",
        "Android packaging strategy documentation",
      ],
      apkBuildReady: false,
      blocker: "TWA release still requires production Digital Asset Links and release signing; internal address-bar-free APKs use android:cap:build.",
    },
    null,
    2,
  ),
);
