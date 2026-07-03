import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const smokeBaseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const serverManagedChecks = new Set([
  "npm run test:routes",
  "npm run test:e2e",
  "npm run test:notice-delete-ui",
  "npm run test:guardian-age-policy-ui",
  "npm run test:admin-user-guardian-bottom-safe-area",
  "npm run test:payment-checkout-method-flow",
  "npm run test:visible-app-copy-stability",
  "npm run test:smoke",
  "npm run test:attendance-speed",
]);
const checks = [
  ["run", "lint"],
  ["run", "build"],
  ["audit", "--audit-level=moderate"],
  ["run", "test:unit"],
  ["run", "test:role-csv-export-gates"],
  ["run", "test:deleted-request-surface"],
  ["run", "test:store"],
  ["run", "test:admin-user-management-api"],
  ["run", "test:dashboard-priority-kpi"],
  ["run", "test:member-profile-guardian-edit"],
  ["run", "test:guardian-age-policy-ui"],
  ["run", "test:admin-user-guardian-bottom-safe-area"],
  ["run", "test:api-auth-order"],
  ["run", "test:auth-production-guard"],
  ["run", "test:dev-reset-guard"],
  ["run", "test:env-readiness"],
  ["run", "test:deployment-handoff-draft"],
  ["run", "test:deployment-handoff"],
  ["run", "test:a11y-static"],
  ["run", "test:mobile-install"],
  ["run", "test:android-packaging"],
  ["run", "test:android-role-apks"],
  ["run", "android:twa:doctor"],
  ["run", "test:ios-capacitor-connection"],
  ["run", "ios:ipa:doctor"],
  ["run", "test:ios-provisioning-runbook"],
  ["run", "test:android-release-handoff-draft"],
  ["run", "test:android-release-handoff"],
  ["run", "test:notification-readiness"],
  ["run", "test:pilot"],
  ["run", "test:pilot-readiness-contract"],
  ["run", "test:pilot-import"],
  ["run", "test:pilot-prelaunch-draft"],
  ["run", "test:pilot-launch-package"],
  ["run", "test:pilot-launch-command"],
  ["run", "test:pilot-readiness-evidence"],
  ["run", "test:pilot-readiness-evidence-apply"],
  ["run", "test:pilot-password-rotation"],
  ["run", "test:preflight"],
  ["run", "test:preflight-runtime"],
  ["run", "test:pilot-evidence"],
  ["run", "test:pilot-field-evidence-draft"],
  ["run", "test:pilot-field-evidence"],
  ["run", "test:pilot-closeout-package"],
  ["run", "test:pilot-artifact-manifest"],
  ["run", "test:pilot-archive-artifacts"],
  ["run", "test:pilot-storage-receipt-draft"],
  ["run", "test:pilot-storage-receipt"],
  ["run", "test:pilot-final-handoff"],
  ["run", "test:pilot-status"],
  ["run", "test:pilot-operator-support"],
  ["run", "test:p1-handoff-draft"],
  ["run", "test:p1-handoff-checklist"],
  ["run", "test:p1-handoff-bundle"],
  ["run", "test:p1-handoff-dispatch"],
  ["run", "test:p1-handoff-dispatch-apply-csv"],
  ["run", "test:p1-handoff-issues"],
  ["run", "test:p1-github-connector-readiness"],
  ["run", "test:p1-handoff-issue-receipt"],
  ["run", "test:p1-evidence-intake-draft"],
  ["run", "test:p1-evidence-intake-apply-csv"],
  ["run", "test:p1-evidence-intake"],
  ["run", "test:p1-readiness"],
  ["run", "test:p1-operator-status"],
  ["run", "test:p1-operator-status-apply-external-blockers-csv"],
  ["run", "test:p1-completion-evidence"],
  ["run", "test:p1-completion-evidence-apply-csv"],
  ["run", "test:p1-release-package"],
  ["run", "test:p1-release-archive"],
  ["run", "test:p1-release-storage-receipt"],
  ["run", "test:owner-report-trends"],
  ["run", "test:owner-progress-report"],
  ["run", "test:owner-progress-report-draft"],
  ["run", "test:owner-decision-register"],
  ["run", "test:owner-decision-register-apply-csv"],
  ["run", "test:owner-briefing-package"],
  ["run", "test:payment-lifecycle"],
  ["run", "test:online-payments"],
  ["run", "test:family-payment-checkout"],
  ["run", "test:payment-checkout-method-flow"],
  ["run", "test:recurring-billing"],
  ["run", "test:payment-provider-handoff-draft"],
  ["run", "test:payment-provider-handoff"],
  ["run", "test:notification-push-handoff-draft"],
  ["run", "test:notification-push-handoff"],
  ["run", "test:team-agent-prompts"],
  ["run", "test:implementation-backlog"],
  ["run", "test:qa-plan"],
  ["run", "test:release-docs"],
  ["run", "test:admin-settings-gates"],
  ["run", "test:p3-operations"],
  ["run", "test:p5-p10-internal-readiness"],
  ["run", "test:notice-delete-ui"],
  ["run", "test:visible-app-copy-stability"],
  ["run", "test:routes"],
  ["run", "test:e2e"],
  ["run", "test:smoke"],
  ["run", "test:attendance-speed"],
  ["run", "test:postgres-doctor"],
  ["run", "test:db"],
  ["run", "test:postgres-store"],
];

let managedServer = null;
let serverReady = false;
let usingExistingServer = false;

function labelFor(args) {
  return `npm ${args.join(" ")}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function canReachServer() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(smokeBaseUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });

    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForServer(timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await canReachServer()) {
      return;
    }

    if (managedServer?.exitCode !== null) {
      throw new Error(`Managed app server exited before ${smokeBaseUrl} became reachable`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for managed app server at ${smokeBaseUrl}`);
}

async function ensureServerForSmokeChecks() {
  if (serverReady) {
    return;
  }

  if (await canReachServer()) {
    serverReady = true;
    usingExistingServer = true;
    console.log(`\nUsing existing app server at ${smokeBaseUrl} for smoke/E2E checks.`);
    return;
  }

  console.log(`\nStarting managed app server at ${smokeBaseUrl} for smoke/E2E checks with next dev --webpack.`);

  managedServer = spawn(npmCommand, ["run", "dev", "--", "--webpack"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  managedServer.stdout.on("data", (chunk) => {
    process.stdout.write(`[app-server] ${chunk}`);
  });
  managedServer.stderr.on("data", (chunk) => {
    process.stderr.write(`[app-server] ${chunk}`);
  });

  await waitForServer();
  serverReady = true;
}

async function stopManagedServer() {
  if (!managedServer || usingExistingServer) {
    return;
  }

  await new Promise((resolve) => {
    const done = () => resolve();
    const killTimer = setTimeout(() => {
      if (managedServer.exitCode === null) {
        managedServer.kill("SIGTERM");
      }
      resolve();
    }, 5000);

    managedServer.once("close", () => {
      clearTimeout(killTimer);
      done();
    });
    managedServer.kill("SIGINT");
  });
}

function runCheck(args) {
  const label = labelFor(args);
  const startedAt = Date.now();

  console.log(`\n▶ ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(new Error(`${label} could not start: ${error.message}`));
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startedAt;

      if (code === 0) {
        resolve({ label, durationMs });
        return;
      }

      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  const results = [];

  try {
    for (const args of checks) {
      const label = labelFor(args);

      if (serverManagedChecks.has(label)) {
        await ensureServerForSmokeChecks();
      }

      results.push(await runCheck(args));
    }
  } finally {
    await stopManagedServer();
  }

  console.log(
    `\n${JSON.stringify(
      {
        ok: true,
        smokeBaseUrl,
        managedSmokeServer: Boolean(managedServer),
        usingExistingSmokeServer: usingExistingServer,
        checked: results.map((result) => ({
          command: result.label,
          durationMs: result.durationMs,
        })),
      },
      null,
      2,
    )}`,
  );
}

main().catch((error) => {
  console.error(`\nRelease check failed: ${error.message}`);
  process.exit(1);
});
