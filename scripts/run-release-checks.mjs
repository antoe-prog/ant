import { spawn } from "node:child_process";

import {
  canReachHttpOrigin,
  cleanupReleaseSmokeEnvironment,
  createReleaseSmokeEnvironment,
} from "./lib/release-smoke-environment.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
let smokeBaseUrl = process.env.SMOKE_BASE_URL?.trim() || null;
const serverManagedChecks = new Set([
  "npm run test:routes",
  "npm run test:e2e",
  "npm run test:notice-delete-ui",
  "npm run test:guardian-age-policy-ui",
  "npm run test:admin-user-guardian-bottom-safe-area",
  "npm run test:payment-checkout-method-flow",
  "npm run test:payment-create-touch-targets",
  "npm run test:class-management-touch-targets",
  "npm run test:member-management-touch-targets",
  "npm run test:admin-user-management-touch-targets",
  "npm run test:operator-list-search",
  "npm run test:admin-role-search",
  "npm run test:admin-user-search",
  "npm run test:admin-audit-search",
  "npm run test:visible-app-copy-stability",
  "npm run test:smoke",
  "npm run test:attendance-speed",
]);
const checks = [
  ["run", "lint"],
  ["run", "test:production-runtime-environment"],
  ["run", "test:postgres-runtime-identity"],
  ["run", "test:live-production-runtime"],
  ["run", "test:production-recovery-manifest"],
  ["run", "test:admin-credential-recovery"],
  ["run", "build"],
  ["audit", "--audit-level=moderate"],
  ["run", "test:next-build-readiness"],
  ["run", "test:release-smoke-isolation"],
  ["run", "test:unit"],
  ["run", "test:final-common-fee-policy"],
  ["run", "test:final-main-schedule-policy"],
  ["run", "test:final-common-promotion-policy"],
  ["run", "test:promotion-api-integrity"],
  ["run", "test:final-policy-ui"],
  ["run", "test:role-csv-export-gates"],
  ["run", "test:deleted-request-surface"],
  ["run", "test:store"],
  ["run", "test:store-write-validation"],
  ["run", "test:runtime-state-integrity"],
  ["run", "test:runtime-state-tools"],
  ["run", "test:admin-user-management-api"],
  ["run", "test:dashboard-priority-kpi"],
  ["run", "test:member-profile-guardian-edit"],
  ["run", "test:guardian-age-policy-ui"],
  ["run", "test:admin-user-guardian-bottom-safe-area"],
  ["run", "test:api-auth-order"],
  ["run", "test:auth-production-guard"],
  ["run", "test:auth-session-security"],
  ["run", "test:invitation-token-security"],
  ["run", "test:local-demo-password-rotation"],
  ["run", "test:dev-reset-guard"],
  ["run", "test:env-readiness"],
  ["run", "test:deployment-handoff-draft"],
  ["run", "test:deployment-handoff"],
  ["run", "test:a11y-static"],
  ["run", "test:mobile-install"],
  ["run", "test:android-packaging"],
  ["run", "test:android-play-release-artifacts"],
  ["run", "test:android-role-apks"],
  ["run", "android:twa:doctor"],
  ["run", "test:ios-capacitor-connection"],
  ["run", "ios:ipa:doctor"],
  ["run", "test:ios-provisioning-runbook"],
  ["run", "test:android-release-handoff-draft"],
  ["run", "test:android-release-handoff"],
  ["run", "test:notification-readiness"],
  ["run", "test:notification-outbox"],
  ["run", "test:notification-outbox-integration"],
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
  ["run", "test:payment-create-touch-targets"],
  ["run", "test:class-management-touch-targets"],
  ["run", "test:member-management-touch-targets"],
  ["run", "test:admin-user-management-touch-targets"],
  ["run", "test:operator-list-search"],
  ["run", "test:global-search"],
  ["run", "test:admin-role-search"],
  ["run", "test:admin-user-search"],
  ["run", "test:admin-audit-search"],
  ["run", "test:audit-action-contract"],
  ["run", "test:audit-log-privacy"],
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
  ["run", "test:visible-app-copy-stability"],
  ["run", "test:p5-p10-internal-readiness"],
  ["run", "test:notice-delete-ui"],
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
let smokePlan = null;
let smokeEnvironment = null;

function labelFor(args) {
  return `npm ${args.join(" ")}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function canReachServer() {
  return smokeBaseUrl ? canReachHttpOrigin(smokeBaseUrl) : false;
}

async function prepareManagedSmokeEnvironment() {
  smokePlan = await createReleaseSmokeEnvironment({ baseUrl: smokeBaseUrl, env: process.env });
  smokeBaseUrl = smokePlan.baseUrl;
  smokeEnvironment = smokePlan.env;
  return smokePlan;
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

  const target = await prepareManagedSmokeEnvironment();

  console.log(
    `\nStarting isolated production server at ${smokeBaseUrl} for smoke/E2E checks with next start.`,
  );

  managedServer = spawn(
    npmCommand,
    ["run", "start", "--", "--hostname", target.hostname, "--port", String(target.port)],
    {
      env: smokeEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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
  if (!managedServer) {
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

async function cleanupManagedSmokeEnvironment() {
  await stopManagedServer();
  await cleanupReleaseSmokeEnvironment(smokePlan);
  smokePlan = null;
}

function runCheck(args, env = process.env) {
  const label = labelFor(args);
  const startedAt = Date.now();

  console.log(`\n▶ ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      env,
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

      results.push(await runCheck(args, serverManagedChecks.has(label) ? smokeEnvironment : process.env));
    }
  } finally {
    await cleanupManagedSmokeEnvironment();
  }

  console.log(
    `\n${JSON.stringify(
      {
        ok: true,
        smokeBaseUrl,
        managedSmokeServer: Boolean(managedServer),
        isolatedSmokeData: Boolean(smokeEnvironment?.FINAL_JUDO_DATA_DIR),
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
