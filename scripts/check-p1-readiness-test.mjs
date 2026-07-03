import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-p1-readiness-"));

function reportPath(name) {
  return path.join(directory, name);
}

function argsFor(paths) {
  return [
    `--deployment-report=${paths.deployment}`,
    `--android-report=${paths.android}`,
    `--ios-ipa-report=${paths.iosIpa}`,
    `--payment-provider-report=${paths.paymentProvider}`,
    `--notification-push-report=${paths.notificationPush}`,
    `--issue-registration-report=${paths.issueRegistration}`,
    `--pilot-status=${paths.pilot}`,
  ];
}

async function runReadiness(paths, extraArgs = []) {
  const { stdout } = await execFile(process.execPath, ["scripts/check-p1-readiness.mjs", ...argsFor(paths), ...extraArgs], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

async function runWorkspaceReadiness(workspace, extraArgs = []) {
  const { stdout } = await execFile(process.execPath, ["scripts/check-p1-readiness.mjs", `--workspace=${workspace}`, ...extraArgs], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

async function expectFailure(paths, extraArgs = []) {
  try {
    await runReadiness(paths, extraArgs);
  } catch (error) {
    assert.notEqual(error.code, 0, "invalid P1 readiness should fail with a non-zero exit code");
    return JSON.parse(error.stdout);
  }

  assert.fail("invalid P1 readiness unexpectedly passed");
}

async function writeReadyReport(filePath, label) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        ok: true,
        releaseDecision: "ready",
        generatedAt: "2026-07-20T05:00:00.000Z",
        checked: [`${label} ready fixture`],
        blockers: [],
      },
      null,
      2,
    )}\n`,
  );
}

const paths = {
  deployment: reportPath("deployment-handoff.report.json"),
  android: reportPath("android-release-handoff.report.json"),
  iosIpa: reportPath(path.join("mobile-builds", "ios", "ios-ipa-build-report.json")),
  paymentProvider: reportPath("payment-provider-handoff.report.json"),
  notificationPush: reportPath("notification-push-handoff.report.json"),
  issueRegistration: reportPath("p1-handoff-issue-registration-report.json"),
  pilot: reportPath("pilot-status.json"),
};

for (const [label, filePath] of Object.entries(paths)) {
  await writeReadyReport(filePath, label);
}

const readyOut = reportPath("p1-readiness.ready.json");
const readyMarkdown = reportPath("p1-readiness.ready.md");
const readyReport = await runReadiness(paths, [`--out=${readyOut}`, `--markdown=${readyMarkdown}`]);
assert.equal(readyReport.ok, true);
assert.equal(readyReport.releaseDecision, "ready");
assert.equal(readyReport.summary.ready, 7);
assert.equal(JSON.parse(await readFile(readyOut, "utf8")).ok, true);
const readyMarkdownSource = await readFile(readyMarkdown, "utf8");
assert(readyMarkdownSource.includes("# P1 Readiness"));
assert(readyMarkdownSource.includes("Release decision: `ready`"));
assert(readyMarkdownSource.includes("운영 배포 handoff"));
assert(readyMarkdownSource.includes("iOS IPA build/provisioning"));
assert(readyMarkdownSource.includes("| 결제 provider handoff | `ready` | 0 |"));

const workspaceReport = await runWorkspaceReadiness(directory);
assert.equal(workspaceReport.ok, true);
assert.equal(workspaceReport.releaseDecision, "ready");
assert.equal(workspaceReport.workspace, path.relative(process.cwd(), directory));
assert.equal(workspaceReport.requirements.deployment.path, paths.deployment);

const partialDeploymentPath = reportPath("deployment-handoff.partial-web-deployment.report.json");
await writeFile(
  partialDeploymentPath,
  `${JSON.stringify(
    {
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-07-20T05:03:00.000Z",
      partial: {
        webDeployment: {
          ready: true,
          platform: "Vercel production project",
          productionOrigin: "https://final-judo.vercel.app",
          deploymentUrl: "https://final-judo-prod.vercel.app/",
          commitSha: "abcdef123456",
          evidence: "https://vercel.com/finaljudo13/final-judo/dpl_partial",
          blockerCodes: [],
        },
      },
      blockers: [{ code: "DEPLOYMENT_HANDOFF_ENV_NOT_CONFIGURED", message: "secret missing" }],
    },
    null,
    2,
  )}\n`,
);
const partialDeploymentReport = await expectFailure({ ...paths, deployment: partialDeploymentPath });
assert.equal(partialDeploymentReport.requirements.deployment.status, "blocked");
assert.equal(partialDeploymentReport.requirements.deployment.partial.webDeployment.ready, true);
assert.equal(partialDeploymentReport.blockers[0].partial.webDeployment.productionOrigin, "https://final-judo.vercel.app");

const partialDeploymentMarkdown = reportPath("p1-readiness.partial-deployment.md");
const partialDeploymentPendingReport = await runReadiness(
  { ...paths, deployment: partialDeploymentPath },
  ["--allow-pending", `--markdown=${partialDeploymentMarkdown}`],
);
assert.equal(partialDeploymentPendingReport.requirements.deployment.partial.webDeployment.ready, true);
const partialDeploymentMarkdownSource = await readFile(partialDeploymentMarkdown, "utf8");
assert(partialDeploymentMarkdownSource.includes("## Partial Evidence"));
assert(partialDeploymentMarkdownSource.includes("webDeployment"));
assert(partialDeploymentMarkdownSource.includes("https://final-judo.vercel.app"));

const partialAndroidPath = reportPath("android-release-handoff.partial-web-origin.report.json");
await writeFile(
  partialAndroidPath,
  `${JSON.stringify(
    {
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-07-20T05:04:00.000Z",
      partial: {
        webAppOrigin: {
          ready: true,
          productionOrigin: "https://final-judo.vercel.app",
          assetLinksUrl: "https://final-judo.vercel.app/.well-known/assetlinks.json",
          expectedAssetLinksUrl: "https://final-judo.vercel.app/.well-known/assetlinks.json",
          blockerCodes: [],
        },
      },
      blockers: [{ code: "ANDROID_HANDOFF_RELEASE_FINGERPRINT", message: "release SHA-256 missing" }],
    },
    null,
    2,
  )}\n`,
);
const partialAndroidMarkdown = reportPath("p1-readiness.partial-android.md");
const partialAndroidReport = await runReadiness(
  { ...paths, android: partialAndroidPath },
  ["--allow-pending", `--markdown=${partialAndroidMarkdown}`],
);
assert.equal(partialAndroidReport.requirements.android.partial.webAppOrigin.ready, true);
const partialAndroidMarkdownSource = await readFile(partialAndroidMarkdown, "utf8");
assert(partialAndroidMarkdownSource.includes("webAppOrigin"));
assert(partialAndroidMarkdownSource.includes("https://final-judo.vercel.app/.well-known/assetlinks.json"));

const partialNotificationPath = reportPath("notification-push-handoff.partial-web-push-origin.report.json");
await writeFile(
  partialNotificationPath,
  `${JSON.stringify(
    {
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-07-20T05:05:00.000Z",
      partial: {
        webPushOrigin: {
          ready: true,
          productionOrigin: "https://final-judo.vercel.app",
          evidence: "https://vercel.com/finaljudo13/final-judo/dpl_push_partial",
          blockerCodes: [],
        },
      },
      blockers: [{ code: "NOTIFICATION_PUSH_HANDOFF_VAPID_PRIVATE_KEY_STORED", message: "VAPID private key missing" }],
    },
    null,
    2,
  )}\n`,
);
const partialNotificationMarkdown = reportPath("p1-readiness.partial-notification.md");
const partialNotificationReport = await runReadiness(
  { ...paths, notificationPush: partialNotificationPath },
  ["--allow-pending", `--markdown=${partialNotificationMarkdown}`],
);
assert.equal(partialNotificationReport.requirements.notificationPush.partial.webPushOrigin.ready, true);
const partialNotificationMarkdownSource = await readFile(partialNotificationMarkdown, "utf8");
assert(partialNotificationMarkdownSource.includes("webPushOrigin"));
assert(partialNotificationMarkdownSource.includes("https://vercel.com/finaljudo13/final-judo/dpl_push_partial"));

const missingAndroidPaths = {
  ...paths,
  android: reportPath("missing-android-release-handoff.report.json"),
};
const missingAndroidReport = await expectFailure(missingAndroidPaths);
assert.equal(missingAndroidReport.ok, false);
assert.equal(missingAndroidReport.requirements.android.status, "missing");
assert(missingAndroidReport.blockers.some((blocker) => blocker.code === "P1_READINESS_REPORT_MISSING" && blocker.key === "android"));
assert(missingAndroidReport.nextActions.some((action) => action.includes("android:release-handoff")));
assert(missingAndroidReport.nextActions.some((action) => action.includes("주소창/공유/더보기")));

const missingIosPaths = {
  ...paths,
  iosIpa: reportPath("missing-ios-ipa-build-report.json"),
};
const missingIosReport = await expectFailure(missingIosPaths);
assert.equal(missingIosReport.requirements.iosIpa.status, "missing");
assert(missingIosReport.blockers.some((blocker) => blocker.code === "P1_READINESS_REPORT_MISSING" && blocker.key === "iosIpa"));
assert(missingIosReport.nextActions.some((action) => action.includes("ios:ipa:doctor")));

const blockedPaymentPath = reportPath("payment-provider-handoff.blocked.json");
await writeFile(
  blockedPaymentPath,
  `${JSON.stringify(
    {
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-07-20T05:10:00.000Z",
      blockers: [{ code: "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_VERIFICATION", message: "signature missing" }],
      nextActions: ["PG/VAN provider webhook 서명 검증을 완료합니다."],
    },
    null,
    2,
  )}\n`,
);
const blockedPaymentReport = await expectFailure({ ...paths, paymentProvider: blockedPaymentPath });
assert.equal(blockedPaymentReport.requirements.paymentProvider.status, "blocked");
assert(blockedPaymentReport.blockers.some((blocker) => blocker.blockerCodes?.includes("PAYMENT_PROVIDER_HANDOFF_WEBHOOK_VERIFICATION")));
assert(blockedPaymentReport.nextActions.includes("PG/VAN provider webhook 서명 검증을 완료합니다."));

const blockedNotificationPath = reportPath("notification-push-handoff.blocked.json");
await writeFile(
  blockedNotificationPath,
  `${JSON.stringify(
    {
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-07-20T05:12:00.000Z",
      blockers: [{ code: "NOTIFICATION_PUSH_HANDOFF_ANDROID_DEVICE", message: "Android device push missing" }],
      nextActions: ["Android 실기기 push 수신 증빙을 완료합니다."],
    },
    null,
    2,
  )}\n`,
);
const blockedNotificationReport = await expectFailure({ ...paths, notificationPush: blockedNotificationPath });
assert.equal(blockedNotificationReport.requirements.notificationPush.status, "blocked");
assert(
  blockedNotificationReport.blockers.some((blocker) =>
    blocker.blockerCodes?.includes("NOTIFICATION_PUSH_HANDOFF_ANDROID_DEVICE"),
  ),
);
assert(blockedNotificationReport.nextActions.includes("Android 실기기 push 수신 증빙을 완료합니다."));

const blockedIosPath = reportPath(path.join("mobile-builds", "ios", "ios-ipa-build-report.blocked.json"));
await writeFile(
  blockedIosPath,
  `${JSON.stringify(
    {
      ok: false,
      releaseDecision: "blocked",
      generatedAt: "2026-07-20T05:13:00.000Z",
      blockers: [{ check: "provisioningProfile", reason: "no local provisioning profile directory found" }],
      nextActions: [
        "Register a real iPhone UDID in Apple Developer and create/download a provisioning profile for kr.co.finaljudo.multigym.",
      ],
    },
    null,
    2,
  )}\n`,
);
const blockedIosReport = await expectFailure({ ...paths, iosIpa: blockedIosPath });
assert.equal(blockedIosReport.requirements.iosIpa.status, "blocked");
assert(blockedIosReport.blockers.some((blocker) => blocker.blockerCodes?.includes("provisioningProfile")));
assert(
  blockedIosReport.nextActions.includes(
    "Register a real iPhone UDID in Apple Developer and create/download a provisioning profile for kr.co.finaljudo.multigym.",
  ),
);

const missingIssueRegistrationPaths = {
  ...paths,
  issueRegistration: reportPath("missing-p1-handoff-issue-registration-report.json"),
};
const missingIssueRegistrationReport = await expectFailure(missingIssueRegistrationPaths);
assert.equal(missingIssueRegistrationReport.requirements.issueRegistration.status, "missing");
assert(
  missingIssueRegistrationReport.blockers.some(
    (blocker) => blocker.code === "P1_READINESS_REPORT_MISSING" && blocker.key === "issueRegistration",
  ),
);
assert(missingIssueRegistrationReport.nextActions.some((action) => action.includes("p1:handoff-issue-receipt")));

const unreadablePilotPath = reportPath("pilot-status.unreadable.json");
await writeFile(unreadablePilotPath, "{ not json }\n");
const unreadablePilotReport = await expectFailure({ ...paths, pilot: unreadablePilotPath });
assert(unreadablePilotReport.blockers.some((blocker) => blocker.code === "P1_READINESS_REPORT_UNREADABLE" && blocker.key === "pilot"));

const pendingMarkdown = reportPath("p1-readiness.pending.md");
const pendingReport = await runReadiness(missingAndroidPaths, ["--allow-pending", `--markdown=${pendingMarkdown}`]);
assert.equal(pendingReport.ok, false);
assert.equal(pendingReport.releaseDecision, "blocked");
assert.equal(pendingReport.requirements.android.status, "missing");
const pendingMarkdownSource = await readFile(pendingMarkdown, "utf8");
assert(pendingMarkdownSource.includes("Release decision: `blocked`"));
assert(pendingMarkdownSource.includes("Android release handoff"));
assert(pendingMarkdownSource.includes("P1_READINESS_REPORT_MISSING"));
assert(pendingMarkdownSource.includes("android:release-handoff"));

const iosBuildScriptSource = await readFile("scripts/build-ios-ipa.mjs", "utf8");
assert(
  iosBuildScriptSource.includes("async function provisioningProfileCheck"),
  "ios:ipa:build must keep a provisioning profile check so doctor-only cannot mark an unprovisioned IPA as ready",
);
assert(
  /provisioningProfile:\s*await provisioningProfileCheck/.test(iosBuildScriptSource),
  "ios:ipa:build checks must include provisioningProfile before archive/export",
);
assert(
  iosBuildScriptSource.includes("matching provisioning profile has no registered iPhone devices"),
  "ios:ipa:build must distinguish Simulator success from a real-device provisioning profile",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "ready P1 aggregate report",
        "JSON output writing",
        "Markdown output writing",
        "missing Android release report blocker",
        "missing iOS IPA build/provisioning report blocker",
        "blocked payment provider report blocker and next action",
        "blocked notification push report blocker and next action",
        "blocked iOS IPA provisioning report blocker and next action",
        "missing issue registration receipt report blocker",
        "unreadable pilot status report blocker",
        "allow-pending audit mode",
        "workspace report defaults",
        "iOS IPA build doctor requires real-device provisioning profile",
      ],
    },
    null,
    2,
  ),
);
