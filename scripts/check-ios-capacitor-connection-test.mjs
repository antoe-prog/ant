import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const generatedConfigPath = "mobile/ios/App/App/capacitor.config.json";

const { stdout } = await execFileAsync(process.execPath, ["scripts/check-ios-capacitor-connection.mjs"], {
  cwd: process.cwd(),
  env: process.env,
});
const report = JSON.parse(stdout);

assert.equal(report.ok, true, "iOS Capacitor connection must load the service dashboard through the native bridge");
assert.equal(report.bundleId, "kr.co.finaljudo.multigym");
assert.equal(report.serviceRoute, "/app/dashboard");
assert.equal(report.checks.nativeBridge.ok, true, "iOS Main.storyboard must use CAPBridgeViewController");
assert.equal(report.checks.serviceDashboardRoute.ok, true, "Next /app/dashboard route must exist");
assert.equal(report.checks.generatedServerUrl.ok, true, "generated iOS config must point at a service screen");
assert(
  ["local_simulator", "production_https"].includes(report.checks.generatedServerUrl.mode),
  "generated iOS connection must be either local simulator or real production HTTPS",
);
if (report.checks.generatedServerUrl.mode === "local_simulator") {
  assert.equal(
    report.checks.generatedServerUrl.simulatorRole,
    "admin",
    "local iOS Simulator connection must use an admin role auto-login URL so it reaches /app/dashboard",
  );
}
assert.notEqual(
  report.releaseDecision,
  "ready",
  "iOS service-screen connection must not be treated as IPA distribution readiness",
);
assert(
  report.releaseBlockers.some((blocker) => blocker.code === "IOS_SIMULATOR_CONNECTION_ONLY") ||
    report.releaseBlockers.some((blocker) => blocker.code === "IOS_PROVISIONING_STILL_REQUIRED"),
  "connection report must keep Simulator/provisioning caveat visible",
);

const originalGeneratedConfig = await readFile(generatedConfigPath, "utf8");
try {
  const apiGeneratedConfig = JSON.parse(originalGeneratedConfig);
  apiGeneratedConfig.server = {
    url: "https://api.finaljudo.co.kr",
  };
  await writeFile(generatedConfigPath, `${JSON.stringify(apiGeneratedConfig, null, 2)}\n`);

  const { stdout: apiOriginStdout } = await execFileAsync(process.execPath, ["scripts/check-ios-capacitor-connection.mjs"], {
    cwd: process.cwd(),
    env: process.env,
  });
  const apiOriginReport = JSON.parse(apiOriginStdout);
  assert.equal(apiOriginReport.ok, false, "iOS Capacitor connection must reject api.* as unverified app-screen origin");
  assert.equal(apiOriginReport.checks.generatedServerUrl.mode, "api_origin_unverified");
  assert.match(
    apiOriginReport.checks.generatedServerUrl.reason,
    /web app origin/,
    "api-origin connection blocker must explain the web app origin requirement",
  );
} finally {
  await writeFile(generatedConfigPath, originalGeneratedConfig);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "iOS Capacitor native bridge uses CAPBridgeViewController",
        "generated iOS config opens the real service dashboard route",
        "generated iOS config rejects unverified api.* service origin",
        "local Simulator connection is not treated as IPA release readiness",
        "production HTTPS/provisioning caveat remains visible",
      ],
      releaseDecision: report.releaseDecision,
      mode: report.checks.generatedServerUrl.mode,
    },
    null,
    2,
  ),
);
