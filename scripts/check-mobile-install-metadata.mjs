import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const manifestModule = await import("../src/app/manifest.ts");
const manifest = manifestModule.default();
const layoutSource = await readFile("src/app/layout.tsx", "utf8");
const providersSource = await readFile("src/app/providers.tsx", "utf8");
const serviceWorkerRegistration = await readFile("src/components/pwa/service-worker-registration.tsx", "utf8");
const installActionSource = await readFile("src/components/pwa/install-app-action.tsx", "utf8");
const accountScreenSource = await readFile("src/components/screens/account-screen.tsx", "utf8");
const serviceWorkerSource = await readFile("public/sw.js", "utf8");
const androidCapBuildSource = await readFile("scripts/build-android-capacitor-apk.mjs", "utf8");
const androidStrategyDoc = await readFile("docs/ANDROID_PACKAGING_STRATEGY.md", "utf8");
const readmeSource = await readFile("README.md", "utf8");
const qaPlanSource = await readFile("docs/QA_TEST_PLAN.md", "utf8");
const releaseChecklistSource = await readFile("docs/RELEASE_CHECKLIST.md", "utf8");
const svgIcon = await readFile("public/icons/final-judo-icon.svg", "utf8");
const png192 = await readFile("public/icons/final-judo-icon-192.png");
const png512 = await readFile("public/icons/final-judo-icon-512.png");
const appShellDeclaration = serviceWorkerSource.match(/const APP_SHELL_URLS = \[[\s\S]*?\];/)?.[0] ?? "";
const execFile = promisify(execFileCallback);

function pngSize(buffer) {
  assert(buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "icon must be a PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function iconFor(src) {
  return manifest.icons?.find((icon) => icon.src === src);
}

function validateWebAppLaunchUrl(value) {
  const url = new URL(String(value ?? "").trim());
  const hostname = url.hostname.toLowerCase();

  assert.equal(url.protocol, "https:", "Android native WebView launch URL must use HTTPS");
  assert(!["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname), "Android native WebView launch URL must not use localhost");
  assert(!hostname.endsWith(".example"), "Android native WebView launch URL must not use an example host");
  assert(!hostname.startsWith("api."), "Android native WebView launch URL must point to the web app origin");

  return url;
}

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function latestAndroidWebViewReport() {
  const buildsRoot = ".data/mobile-builds";
  let entries = [];

  try {
    entries = await readdir(buildsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^android-capacitor-webview-\d{8}$/.test(entry.name)) {
      continue;
    }

    const reportPath = path.join(buildsRoot, entry.name, "android-capacitor-webview-report.json");

    try {
      const reportStats = await stat(reportPath);
      candidates.push({ dirName: entry.name, reportPath, mtimeMs: reportStats.mtimeMs });
    } catch {
      // A partially generated directory should not make the static install metadata gate fail.
    }
  }

  candidates.sort((a, b) => b.dirName.localeCompare(a.dirName) || b.mtimeMs - a.mtimeMs);
  const latest = candidates[0];

  if (!latest) {
    return null;
  }

  return {
    ...latest,
    report: JSON.parse(await readFile(latest.reportPath, "utf8")),
  };
}

async function validateAndroidWebViewReport(reportEntry) {
  if (!reportEntry) {
    return null;
  }

  const { report, reportPath } = reportEntry;
  const preferredApk = report.installInstructions?.preferredApk;
  const reportedApk = report.artifacts?.apk;
  const fieldInstallApk = report.artifacts?.fieldInstallApk;
  const installGuide = report.artifacts?.installGuide;
  const resolvedApk = path.resolve(String(preferredApk ?? ""));

  assert.equal(report.ok, true, "Android native WebView report must be ok");
  assert.equal(report.packaging, "capacitor-native-webview", "Android install report must identify the native WebView packaging path");
  assert.equal(report.packageId, "kr.co.finaljudo.multigym", "Android native WebView report must keep the FINAL package id");
  validateWebAppLaunchUrl(report.launchUrl);
  assert.equal(preferredApk, fieldInstallApk, "Android install instructions must prefer the explicit field-install WebView APK alias");
  assert.equal(report.installInstructions?.equivalentApk, reportedApk, "Android install instructions must keep the generated native WebView APK as an equivalent artifact");
  assert.equal(path.basename(String(preferredApk)), "INSTALL_ONLY_final-judo-native-webview-debug.apk", "Android install handoff must point to the explicit field-install APK file");
  assert.equal(path.basename(String(reportedApk)), "final-judo-native-webview-debug.apk", "Android report must still keep the generated native WebView APK file");
  assert.equal(path.basename(String(report.artifacts?.desktopCopy)), "final-judo-native-webview-debug.apk", "Android desktop copy must use the native WebView APK file name");
  assert.equal(
    path.basename(String(report.artifacts?.desktopFieldInstallCopy)),
    "INSTALL_ONLY_final-judo-native-webview-debug.apk",
    "Android desktop copy must expose an explicit field-install APK alias",
  );
  assert.equal(path.basename(String(installGuide)), "INSTALL_ANDROID_WEBVIEW_APK.txt", "Android install handoff must include a human-readable install guide");
  assert.equal(
    report.artifacts?.capacitorConfig,
    "mobile/android-cap/app/src/main/assets/capacitor.config.json",
    "Android native WebView report must reference the generated Capacitor config",
  );
  assert.equal(report.artifacts?.androidProject, "mobile/android-cap", "Android native WebView report must reference the Capacitor Android project");
  assert(report.checks?.includes("APK does not include androidbrowserhelper or TWA Custom Tabs runtime"), "Android native WebView report must prove TWA runtime absence");
  assert(report.checks?.includes("APK application icon points to the FINAL adaptive icon"), "Android native WebView report must prove the application launcher icon path");
  assert(report.checks?.includes("APK launcher icon matches generated FINAL PNG resource"), "Android native WebView report must prove the packaged launcher icon");
  assert(report.checks?.includes("APK adaptive foreground icon matches generated FINAL PNG resource"), "Android native WebView report must prove the packaged adaptive foreground icon");
  assert(report.signing?.verified === true, "Android native WebView debug APK must be signed and installable");
  assert.equal(report.launcherIcon?.sourceIcon, "public/icons/final-judo-icon-512.png", "Android native WebView report must record the FINAL PNG launcher source");
  assert.equal(
    report.launcherIcon?.sourceAndroidResource,
    "mobile/android-cap/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
    "Android native WebView report must record the source Android launcher resource",
  );
  assert.equal(
    report.launcherIcon?.sourceAdaptiveForegroundResource,
    "mobile/android-cap/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png",
    "Android native WebView report must record the source Android adaptive foreground resource",
  );
  assert.equal(report.launcherIcon?.adaptiveIconEntry, "res/mipmap-anydpi-v26/ic_launcher.xml", "Android native WebView report must record the adaptive launcher entry");
  assert.equal(
    report.launcherIcon?.adaptiveRoundIconEntry,
    "res/mipmap-anydpi-v26/ic_launcher_round.xml",
    "Android native WebView report must record the adaptive round launcher entry",
  );
  assert.equal(
    report.launcherIcon?.adaptiveForegroundEntry,
    "res/mipmap-xxxhdpi-v4/ic_launcher_foreground.png",
    "Android native WebView report must record the adaptive foreground entry",
  );
  assert.equal(report.launcherIcon?.apkEntry, "res/mipmap-xxxhdpi-v4/ic_launcher.png", "Android native WebView report must record the packaged launcher entry");
  assert.equal(report.artifacts?.launcherIconProof, report.launcherIcon?.proof, "Android native WebView report must expose the extracted launcher icon proof artifact");
  assert.equal(
    report.launcherIcon?.adaptiveForegroundProof,
    `${path.dirname(String(report.launcherIcon?.proof ?? ""))}/apk-ic_launcher_foreground-xxxhdpi.png`,
    "Android native WebView report must expose the extracted adaptive foreground icon proof artifact",
  );
  assert(report.installInstructions?.installOnly?.includes("INSTALL_ONLY_final-judo-native-webview-debug.apk"), "Android install instructions must say which APK is the only field install artifact");
  assert(
    report.installInstructions?.doNotInstall?.includes("mobile/android/twa/app/build/outputs/apk/debug/app-debug.apk"),
    "Android install instructions must explicitly forbid the ambiguous TWA debug APK",
  );
  assert(
    report.installInstructions?.doNotInstall?.includes("mobile/android/twa/app-release-signed.apk"),
    "Android install instructions must explicitly forbid the stale top-level TWA release APK",
  );
  assert(report.installInstructions?.qualityCheck?.includes("must not show the Android browser URL bar"), "Android install instructions must include the no-address-bar quality check");
  assert(report.installInstructions?.wrongArtifactWarning?.includes("not this native WebView APK"), "Android install instructions must warn about browser/TWA wrong artifacts");
  assert(report.installInstructions?.beforeInstall?.includes("launcher icon cache"), "Android install instructions must tell testers to clear old launcher icon cache");
  assert(Array.isArray(report.artifacts?.wrongArtifactMarkers), "Android native WebView report must include wrong-artifact marker paths");
  assert(report.limitations?.some((item) => item.includes("debug signing")), "Android native WebView report must not imply release signing is complete");

  const apkStats = await stat(resolvedApk);
  assert.equal(apkStats.size, report.bytes, "Android native WebView APK byte size must match the report");
  assert.equal(await sha256File(resolvedApk), report.sha256, "Android native WebView APK SHA-256 must match the report");
  assert.equal(await sha256File(path.resolve(String(reportedApk ?? ""))), report.sha256, "Android equivalent native WebView APK SHA-256 must match the report");
  const sourceLauncherIconSha256 = await sha256File(path.resolve(String(report.launcherIcon?.sourceAndroidResource ?? "")));
  const sourceAdaptiveForegroundSha256 = await sha256File(path.resolve(String(report.launcherIcon?.sourceAdaptiveForegroundResource ?? "")));
  assert.equal(report.launcherIcon?.expectedSha256, sourceLauncherIconSha256, "Android launcher expected SHA-256 must match the source Android resource");
  assert.equal(report.launcherIcon?.sha256, sourceLauncherIconSha256, "Android packaged launcher SHA-256 must match the source Android resource");
  assert.equal(
    report.launcherIcon?.expectedAdaptiveForegroundSha256,
    sourceAdaptiveForegroundSha256,
    "Android adaptive foreground expected SHA-256 must match the source Android resource",
  );
  assert.equal(
    report.launcherIcon?.adaptiveForegroundSha256,
    sourceAdaptiveForegroundSha256,
    "Android packaged adaptive foreground SHA-256 must match the source Android resource",
  );
  assert.equal(await sha256File(path.resolve(String(report.launcherIcon?.proof ?? ""))), report.launcherIcon?.sha256, "Android launcher icon proof file must match the report");
  assert.equal(
    await sha256File(path.resolve(String(report.launcherIcon?.adaptiveForegroundProof ?? ""))),
    report.launcherIcon?.adaptiveForegroundSha256,
    "Android adaptive foreground icon proof file must match the report",
  );
  const { stdout: packagedLauncherIcon } = await execFile(
    "unzip",
    ["-p", resolvedApk, String(report.launcherIcon?.apkEntry ?? "")],
    { encoding: "buffer", maxBuffer: 1024 * 1024 },
  );
  assert.equal(sha256Buffer(packagedLauncherIcon), report.launcherIcon?.sha256, "Android APK packaged launcher icon must match the report proof");
  const { stdout: packagedAdaptiveForeground } = await execFile(
    "unzip",
    ["-p", resolvedApk, String(report.launcherIcon?.adaptiveForegroundEntry ?? "")],
    { encoding: "buffer", maxBuffer: 1024 * 1024 },
  );
  assert.equal(
    sha256Buffer(packagedAdaptiveForeground),
    report.launcherIcon?.adaptiveForegroundSha256,
    "Android APK packaged adaptive foreground icon must match the report proof",
  );

  const installGuideSource = await readFile(path.resolve(String(installGuide ?? "")), "utf8");
  assert(installGuideSource.includes("Install this APK only"), "Android install guide must name the preferred install path");
  assert(installGuideSource.includes("INSTALL_ONLY_final-judo-native-webview-debug.apk"), "Android install guide must make the preferred field APK unmistakable");
  assert(installGuideSource.includes("Equivalent generated APK"), "Android install guide must distinguish the generated equivalent APK");
  assert(installGuideSource.includes("Do not install these TWA/Bubblewrap artifacts"), "Android install guide must warn against TWA/Bubblewrap APKs");
  assert(installGuideSource.includes("old launcher icon cache"), "Android install guide must tell testers to uninstall before checking the app icon");
  assert(installGuideSource.includes("Wrong-artifact marker files"), "Android install guide must list wrong-artifact marker files when present");
  assert(installGuideSource.includes("mobile/android/twa/app/build/outputs/apk/debug/app-debug.apk"), "Android install guide must list the ambiguous TWA debug APK path");
  assert(installGuideSource.includes(report.sha256), "Android install guide must include the APK SHA-256");
  assert(installGuideSource.includes("final-judo.vercel.app is visible in a top browser bar"), "Android install guide must diagnose the address-bar symptom");

  const desktopCopy = String(report.artifacts?.desktopCopy ?? "");
  if (desktopCopy) {
    assert.equal(await sha256File(path.resolve(desktopCopy)), report.sha256, "Android native WebView desktop copy must match the reported APK SHA-256");
  }

  const desktopFieldInstallCopy = String(report.artifacts?.desktopFieldInstallCopy ?? "");
  if (desktopFieldInstallCopy) {
    assert.equal(
      await sha256File(path.resolve(desktopFieldInstallCopy)),
      report.sha256,
      "Android explicit field-install desktop copy must match the reported APK SHA-256",
    );
  }

  for (const markerPath of report.artifacts?.wrongArtifactMarkers ?? []) {
    const markerSource = await readFile(path.resolve(String(markerPath)), "utf8");
    assert(markerSource.includes("DO NOT INSTALL THIS FOLDER'S APK"), "Android wrong-artifact marker must warn installers immediately");
    assert(markerSource.includes("top URL/search bar"), "Android wrong-artifact marker must name the address/search-bar symptom");
    assert(markerSource.includes(String(preferredApk)), "Android wrong-artifact marker must point to the preferred field-install APK");
    assert(markerSource.includes(report.sha256), "Android wrong-artifact marker must include the preferred APK SHA-256");
  }

  const desktopInstallGuide = String(report.artifacts?.desktopInstallGuide ?? "");
  if (desktopInstallGuide) {
    assert.equal(await readFile(path.resolve(desktopInstallGuide), "utf8"), installGuideSource, "Android desktop install guide must match the reported install guide");
  }

  return {
    reportPath,
    preferredApk,
    sha256: report.sha256,
    bytes: report.bytes,
    launcherIconSha256: report.launcherIcon?.sha256,
  };
}

const androidWebViewInstallReport = await validateAndroidWebViewReport(await latestAndroidWebViewReport());

assert.equal(manifest.name, "파이널 유도 멀티짐", "manifest must expose the full app name");
assert.equal(manifest.short_name, "파이널 유도", "manifest must expose a compact app name for iOS/Android");
assert.equal(manifest.start_url, "/app", "installed app must open the role-based app shell");
assert.equal(manifest.scope, "/", "manifest scope must include all app routes");
assert.equal(manifest.display, "standalone", "manifest must enable standalone app display");
assert.equal(manifest.orientation, "portrait", "mobile app should prefer portrait operation");
assert.equal(manifest.background_color, "#f7f9fb", "manifest background color must match the design system app background");
assert.equal(manifest.theme_color, "#102a43", "manifest theme color must match the brand navy token");
assert.equal(iconFor("/icons/final-judo-icon.svg"), undefined, "manifest must not expose the stale SVG icon path to Android installers");
assert.equal(iconFor("/icons/final-judo-icon-192.png")?.sizes, "192x192", "manifest must include Android 192px PNG icon");
assert(String(iconFor("/icons/final-judo-icon-512.png")?.purpose ?? "").includes("maskable"), "manifest must include maskable 512px PNG icon");
assert(manifest.shortcuts?.some((shortcut) => shortcut.url === "/app/classes"), "manifest must include attendance shortcut");
assert(manifest.shortcuts?.some((shortcut) => shortcut.url === "/app/dashboard"), "manifest must include dashboard shortcut");

assert(layoutSource.includes("export const viewport: Viewport"), "layout must use the Next viewport export");
assert(layoutSource.includes('themeColor: "#102a43"'), "layout viewport must set mobile browser theme color");
assert(layoutSource.includes('viewportFit: "cover"'), "layout viewport must support iOS safe-area display");
assert(!layoutSource.includes("maximumScale"), "layout viewport must not block user zoom with maximumScale");
assert(!layoutSource.includes("userScalable"), "layout viewport must not disable user zoom");
assert(layoutSource.includes('manifest: "/manifest.webmanifest"'), "metadata must link the web app manifest");
assert(!layoutSource.includes("final-judo-icon.svg"), "metadata must not prefer the stale SVG app icon");
assert(layoutSource.includes("appleWebApp"), "metadata must include iOS web app hints");
assert(layoutSource.includes('capable: true'), "metadata must mark the app as iOS web-app capable");
assert(layoutSource.includes("formatDetection"), "metadata must control mobile auto-detection");
assert(providersSource.includes("<ServiceWorkerRegistration />"), "root providers must register the PWA service worker");
assert(serviceWorkerRegistration.includes('navigator.serviceWorker.register("/sw.js"'), "service worker registration must target /sw.js");
assert(serviceWorkerRegistration.includes('scope: "/"'), "service worker registration must use root scope");
assert(serviceWorkerRegistration.includes('updateViaCache: "none"'), "service worker registration must bypass stale update checks");
assert(serviceWorkerRegistration.includes("controllerchange"), "service worker registration must refresh controlled app tabs after a worker update");
assert(serviceWorkerRegistration.includes("FINAL_JUDO_SKIP_WAITING"), "service worker registration must ask waiting workers to activate promptly");
assert(serviceWorkerRegistration.includes('process.env.NODE_ENV !== "production"'), "service worker registration must stay out of development mode");
assert(serviceWorkerRegistration.includes("getRegistrations()"), "development mode must unregister stale service workers");
assert(serviceWorkerRegistration.includes('key.startsWith("final-judo-mobile-shell")'), "development mode must clear stale app shell caches");
assert(accountScreenSource.includes("<InstallAppAction />"), "account screen must expose the mobile app install action");
assert(!accountScreenSource.includes('data-testid="mobile-account-session-panel"'), "account screen must not show duplicate mobile session guidance");
assert(!accountScreenSource.includes("mobileSessionChecks"), "account screen must avoid duplicate mobile session summary cards");
assert(!accountScreenSource.includes("앱 이용 상태"), "account screen must keep installed-app guidance compact");
assert(accountScreenSource.includes("이용 지점"), "account screen must keep branch scope visible for mobile users");
assert(installActionSource.includes('"beforeinstallprompt"'), "install action must listen for the browser install prompt");
assert(installActionSource.includes("event.preventDefault()"), "install action must defer the browser install prompt until the user taps install");
assert(installActionSource.includes("installPrompt.prompt()"), "install action must call the browser install prompt");
assert(installActionSource.includes("installPrompt.userChoice"), "install action must handle accepted and dismissed install choices");
assert(installActionSource.includes('"(display-mode: standalone)"'), "install action must detect standalone display mode");
assert(installActionSource.includes("navigatorWithStandalone.standalone"), "install action must detect iOS standalone mode");
assert(installActionSource.includes('aria-live="polite"'), "install action must announce install state changes accessibly");
assert(installActionSource.includes('data-testid="pwa-install-action"'), "install action must be targetable by mobile QA");
assert(installActionSource.includes('manual: "기기 메뉴 사용"'), "manual install state must use device-centered copy");
assert(
  installActionSource.includes('installState === "checking" || installState === "manual" || installState === "dismissed"'),
  "install action must stay hidden until it can show an actionable install state",
);
assert(!installActionSource.includes("홈 화면 추가 안내"), "install action must not repeat the install title as helper copy");
assert(!installActionSource.includes("브라우저 메뉴 사용"), "install action must not expose browser-centered manual install copy");
assert(serviceWorkerSource.includes('"/app"'), "service worker must precache the role-based app shell");
assert(!appShellDeclaration.includes('"/login"'), "service worker must not precache auth entry screens");
assert(
  serviceWorkerSource.includes('const NETWORK_ONLY_NAVIGATION_PREFIXES = ["/login", "/signup", "/reset-password", "/select-role", "/invite"];'),
  "service worker must keep auth entry screens network-only",
);
assert(serviceWorkerSource.includes("isNetworkOnlyNavigation(requestUrl.pathname)"), "service worker must bypass navigation cache for auth entry screens");
assert(serviceWorkerSource.includes('"/manifest.webmanifest"'), "service worker must cache the web app manifest");
assert(!appShellDeclaration.includes('"/icons/final-judo-icon.svg"'), "service worker app shell must not precache the stale SVG icon path");
assert(serviceWorkerSource.includes('pathname.startsWith("/api/")'), "service worker must not cache operational API responses");
assert(serviceWorkerSource.includes('const CACHE_VERSION = "final-judo-mobile-shell-v4"'), "service worker cache version must rotate after app icon cache policy changes");
assert(serviceWorkerSource.includes("function isNextStaticAsset"), "service worker must classify Next static chunks separately from icon assets");
assert(serviceWorkerSource.includes("if (isNextStaticAsset(requestUrl.pathname))"), "service worker must use a dedicated Next static chunk strategy");
assert(serviceWorkerSource.indexOf("if (isNextStaticAsset(requestUrl.pathname))") < serviceWorkerSource.indexOf("if (isStaticAsset(requestUrl.pathname))"), "service worker must handle Next static chunks before cache-first icon assets");
assert(serviceWorkerSource.includes('request.mode === "navigate"'), "service worker must provide a navigation fallback");
assert(serviceWorkerSource.includes('cache.match("/app")'), "service worker must fall back to the app shell while offline");
assert(svgIcon.includes('href="/icons/final-judo-icon-512.png"'), "SVG fallback must reference the FINAL PNG icon source");
assert(!svgIcon.includes("#102A43") && !svgIcon.includes("#D64545"), "SVG fallback must not keep the old colored icon artwork");
assert.deepEqual(pngSize(png192), { width: 192, height: 192 }, "192px app icon must have the correct dimensions");
assert.deepEqual(pngSize(png512), { width: 512, height: 512 }, "512px app icon must have the correct dimensions");
assert(androidCapBuildSource.includes('packaging: "capacitor-native-webview"'), "Android Capacitor APK builder must report native WebView packaging");
assert(androidCapBuildSource.includes("wrongArtifactWarning"), "Android Capacitor APK builder must warn when a browser/TWA artifact is installed");
assert(androidCapBuildSource.includes("INSTALL_ONLY_final-judo-native-webview-debug.apk"), "Android Capacitor APK builder must create an unmistakable field-install APK alias");
assert(androidCapBuildSource.includes("DO_NOT_INSTALL_FOR_FIELD_WEBVIEW.txt"), "Android Capacitor APK builder must write warning markers next to ambiguous TWA APKs");
assert(androidCapBuildSource.includes("final-judo-native-webview-debug.apk"), "Android Capacitor APK builder must name the preferred APK explicitly");
assert(androidCapBuildSource.includes("INSTALL_ANDROID_WEBVIEW_APK.txt"), "Android Capacitor APK builder must generate a human-readable install guide");
assert(androidCapBuildSource.includes("doNotInstall"), "Android Capacitor APK builder must report forbidden TWA install artifacts");
assert(androidCapBuildSource.includes("launcherIconProof"), "Android Capacitor APK builder must report the extracted launcher icon proof");
assert(androidCapBuildSource.includes("APK launcher icon matches generated FINAL PNG resource"), "Android Capacitor APK builder must verify the packaged launcher icon");
assert(androidCapBuildSource.includes("res/mipmap-anydpi-v26/ic_launcher.xml"), "Android Capacitor APK builder must inspect the adaptive launcher icon entry");
assert(androidCapBuildSource.includes("res/mipmap-xxxhdpi-v4/ic_launcher_foreground.png"), "Android Capacitor APK builder must inspect the adaptive foreground icon entry");
assert(androidCapBuildSource.includes("APK application icon points to the FINAL adaptive icon"), "Android Capacitor APK builder must verify the application icon path");
assert(
  androidCapBuildSource.includes("APK adaptive foreground icon matches generated FINAL PNG resource"),
  "Android Capacitor APK builder must verify the packaged adaptive foreground icon",
);
assert(androidStrategyDoc.includes("final-judo-native-webview-debug.apk"), "Android strategy doc must point field installs to the native WebView APK");
assert(androidStrategyDoc.includes("Chrome 주소창"), "Android strategy doc must document the Chrome address-bar failure mode");
assert(androidStrategyDoc.includes("INSTALL_ANDROID_WEBVIEW_APK.txt"), "Android strategy doc must mention the install guide artifact");
assert(readmeSource.includes("android-capacitor-webview-report.json"), "README must document the Android native WebView report");
assert(readmeSource.includes("final-judo-native-webview-debug.apk"), "README must document the preferred Android native WebView APK");
assert(qaPlanSource.includes("android-capacitor-webview-report.json"), "QA plan must document the Android native WebView report check");
assert(releaseChecklistSource.includes("final-judo-native-webview-debug.apk"), "release checklist must document the Android native WebView APK handoff");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "Next App Router web app manifest",
        "iOS apple web app metadata",
        "Android standalone manifest metadata",
        "PWA icons and dimensions",
        "mobile shortcuts to attendance and dashboard",
        "production service worker registration",
        "development stale service worker cleanup",
        "account screen compact install action",
        "browser beforeinstallprompt install flow",
        "standalone and iOS installed-state detection",
        "offline app shell cache without API response caching",
        "Android native WebView install report and APK integrity when present",
        "Android native WebView no-address-bar handoff documentation",
      ],
      androidWebViewInstallReport,
    },
    null,
    2,
  ),
);
