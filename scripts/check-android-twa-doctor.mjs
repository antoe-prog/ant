import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    allowApiOriginWebapp: process.env.FINAL_JUDO_ALLOW_API_ORIGIN_WEBAPP === "1",
    strict: false,
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

    if (key === "--origin") {
      args.origin = value;
    } else if (key === "--sha256") {
      args.sha256 = value;
    } else if (key === "--out") {
      args.out = value;
    } else if (key === "--markdown") {
      args.markdown = value;
    }
  }

  return args;
}

function validateHttpsOrigin(origin, { allowApiOriginWebapp = false } = {}) {
  if (!origin) {
    return {
      ok: false,
      reason: "missing --origin=https://<webapp-origin>",
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

function validateSha256Fingerprint(value) {
  if (!value) {
    return {
      ok: false,
      reason: "missing --sha256=<release-key-fingerprint>",
    };
  }

  const normalized = value.toUpperCase();
  const ok = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(normalized);

  return ok
    ? { ok: true, value: normalized }
    : { ok: false, reason: "release key fingerprint must be 32 colon-separated SHA-256 hex bytes" };
}

function checkCommand(name, args) {
  return new Promise((resolve) => {
    const child = spawn(name, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, 5000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        command: name,
        ok: false,
        reason: error.message,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const firstLine = output.trim().split(/\r?\n/).find(Boolean);

      resolve({
        command: name,
        ok: code === 0,
        ...(firstLine ? { version: firstLine.slice(0, 180) } : {}),
        ...(signal ? { reason: `terminated by ${signal}` } : {}),
        ...(code !== 0 && !signal ? { reason: `exit code ${code}` } : {}),
      });
    });
  });
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
  if (typeof args.origin === "string" && args.origin.trim()) {
    return args.origin.trim();
  }

  return args.useDeployedOrigin ? readDeployedWebAppOrigin() : null;
}

function createInstallHints({ origin, sha256, checks }) {
  const macos = [];
  const environment = [];
  const ci = [];

  if (!checks.java.ok || !checks.keytool.ok) {
    macos.push("Install a JDK, for example `brew install --cask temurin`, then reopen the terminal.");
  }

  if (!checks.sdkmanager.ok || !checks.adb.ok || !checks.androidHome.ok) {
    macos.push("Install Android Studio or Android SDK Command-line Tools, then install platform-tools and build-tools.");
    environment.push('export ANDROID_HOME="$HOME/Library/Android/sdk"');
    environment.push('export ANDROID_SDK_ROOT="$ANDROID_HOME"');
    environment.push('export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"');
    environment.push('sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"');
  }

  if (!origin.ok) {
    environment.push("Replace `--origin` with the final HTTPS web app production origin.");
    environment.push("Use a web app origin that serves /login and /app/dashboard; API-only hosts are blocked by default.");
    environment.push("If an api.* host intentionally serves the web app, rerun with --allow-api-origin-webapp after verifying those routes.");
  }

  if (!sha256.ok) {
    environment.push("Replace `--sha256` with the release signing certificate SHA-256 fingerprint.");
  }

  ci.push("Use `.github/workflows/android-twa.yml` after production_origin and release_sha256 are final.");
  ci.push("Set `build_artifacts=true` only after strict doctor passes and signing custody is ready.");

  return {
    macos,
    environment,
    ci,
    rerun: "npm run android:twa:doctor -- --strict --origin=<webapp-origin> --sha256=<release-sha256> --out=.data/android-twa-doctor.json --markdown=.data/android-twa-doctor.md",
  };
}

function createMarkdown(report) {
  const statusLabel = report.ok ? "ready" : "blocked";
  const lines = [
    "# Android TWA Doctor",
    "",
    `- Generated: \`${report.generatedAt}\``,
    `- Package: \`${report.packageName}\``,
    `- Status: \`${statusLabel}\``,
    `- Blockers: ${report.blockers.length}`,
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

  lines.push("", "## Next Actions", "");
  for (const action of report.nextActions) {
    lines.push(`- ${action}`);
  }

  if (report.blockers.length > 0) {
    lines.push("", "## Blockers", "");
    for (const blocker of report.blockers) {
      lines.push(`- \`${blocker.check}\`: ${blocker.reason}`);
    }
  }

  lines.push("", "## Install Hints", "");

  if (report.installHints.macos.length > 0) {
    lines.push("### macOS", "");
    for (const hint of report.installHints.macos) {
      lines.push(`- ${hint}`);
    }
    lines.push("");
  }

  if (report.installHints.environment.length > 0) {
    lines.push("### Environment", "");
    for (const hint of report.installHints.environment) {
      lines.push(`- \`${hint}\``);
    }
    lines.push("");
  }

  lines.push("### CI", "");
  for (const hint of report.installHints.ci) {
    lines.push(`- ${hint}`);
  }
  lines.push("", `- Rerun: \`${report.installHints.rerun}\``);

  lines.push(
    "",
    "## Commands",
    "",
    `- Prepare: \`${report.commands.prepare}\``,
    `- Build: \`${report.commands.build}\``,
    "",
  );

  return `${lines.join("\n")}\n`;
}

const args = parseArgs(process.argv.slice(2));
const originValue = resolveOriginValue(args);
const origin = validateHttpsOrigin(originValue, { allowApiOriginWebapp: args.allowApiOriginWebapp });
const sha256 = validateSha256Fingerprint(args.sha256);
const checks = {
  origin,
  sha256,
  java: await checkCommand("java", ["-version"]),
  keytool: await checkCommand("keytool", ["-help"]),
  sdkmanager: await checkCommand("sdkmanager", ["--version"]),
  adb: await checkCommand("adb", ["version"]),
  npx: await checkCommand("npx", ["--version"]),
  androidHome: {
    ok: Boolean(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT),
    value: process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null,
  },
};
const requiredChecks = ["origin", "sha256", "java", "keytool", "sdkmanager", "adb", "npx", "androidHome"];
const blockers = requiredChecks
  .filter((key) => !checks[key].ok)
  .map((key) => ({
    check: key,
    reason: checks[key].reason ?? "missing",
  }));
const installHints = createInstallHints({ origin, sha256, checks });
const nextActions = [];

if (!origin.ok || !sha256.ok) {
  nextActions.push("실제 HTTPS 운영 웹앱 origin과 release signing SHA-256 fingerprint를 설정합니다.");
}

if (!checks.java.ok || !checks.keytool.ok || !checks.sdkmanager.ok || !checks.adb.ok || !checks.androidHome.ok) {
  nextActions.push("JDK, Android SDK command line tools, platform-tools를 설치하고 ANDROID_HOME 또는 ANDROID_SDK_ROOT를 설정합니다.");
}

if (blockers.length > 0) {
  nextActions.push("APK/AAB 생성을 시도하기 전에 --origin과 --sha256을 지정해 이 doctor를 다시 실행합니다.");
}

const report = {
  ok: blockers.length === 0,
  generatedAt: new Date().toISOString(),
  packageName: "kr.co.finaljudo.multigym",
  checks,
  blockers,
  installHints,
  commands: {
    prepare: "npm run android:twa:prepare -- --origin=<webapp-origin> --sha256=<release-sha256>",
    build: "npm run android:twa:build -- --origin=<webapp-origin> --sha256=<release-sha256>",
  },
  nextActions: blockers.length === 0
    ? ["android:twa:prepare를 실행하고 assetlinks.json을 배포한 뒤 android:twa:build를 실행합니다."]
    : nextActions,
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
