import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-notification-push-draft-"));
const signedOffAt = new Date(Date.now() + 60_000).toISOString();

function outPath(name) {
  return path.join(directory, name);
}

async function runDraft(extraArgs = [], env = {}) {
  const out = outPath(`notification-push-handoff-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const { stdout } = await execFile(
    process.execPath,
    ["scripts/create-notification-push-handoff-draft.mjs", `--out=${out}`, ...extraArgs],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    },
  );
  return { out, report: JSON.parse(stdout), draft: JSON.parse(await readFile(out, "utf8")) };
}

async function runStrictHandoff(filePath) {
  const { stdout } = await execFile(process.execPath, ["scripts/check-notification-push-handoff.mjs", `--file=${filePath}`], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

async function expectStrictFailure(filePath) {
  try {
    await runStrictHandoff(filePath);
  } catch (error) {
    assert.notEqual(error.code, 0, "pending notification push handoff must fail strict validation");
    return JSON.parse(error.stdout);
  }

  assert.fail("pending notification push handoff unexpectedly passed strict validation");
}

const pending = await runDraft();
assert.equal(pending.report.ok, true);
assert.equal(pending.draft.schemaVersion, 2);
assert.equal(pending.draft.providers.apns.privateKeyStored, false);
assert.equal(pending.draft.providers.fcm.privateKeyStored, false);
assert.equal(pending.draft.providers.web.enabled, false);
assert.equal(pending.draft.retryWorker.secretStored, false);
assert.equal(pending.draft.retryWorker.invocationVerified, false);
assert.equal(pending.draft.devices[0].device, "TODO_ANDROID_DEVICE");
assert.equal(pending.draft.devices[1].device, "TODO_IOS_DEVICE");
assert(pending.report.pendingEvidence.includes("providers.apns.evidence"));
assert(pending.report.pendingEvidence.includes("providers.fcm.evidence"));
assert(pending.report.pendingEvidence.includes("retryWorker.evidence"));
const pendingStrict = await expectStrictFailure(pending.out);
assert(pendingStrict.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_APNS_PRIVATE_KEY"));
assert(pendingStrict.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_FCM_PRIVATE_KEY"));
assert(pendingStrict.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_DEVICE_FIELD"));

const rawApnsPrivateKey = "-----BEGIN PRIVATE KEY-----\napns-secret-value-that-should-not-be-written\n-----END PRIVATE KEY-----";
const rawFcmPrivateKey = "-----BEGIN PRIVATE KEY-----\nfcm-secret-value-that-should-not-be-written\n-----END PRIVATE KEY-----";
const inferred = await runDraft(
  ["--production-origin=https://app.finaljudo.kr"],
  {
    FINAL_JUDO_APNS_KEY_ID: "APNSKEY1",
    FINAL_JUDO_APNS_PRIVATE_KEY: rawApnsPrivateKey,
    FINAL_JUDO_APNS_TEAM_ID: "TEAMID1",
    FINAL_JUDO_APNS_TOPIC: "kr.co.finaljudo.multigym",
    FINAL_JUDO_FIREBASE_CLIENT_EMAIL: "firebase@finaljudo.test",
    FINAL_JUDO_FIREBASE_PRIVATE_KEY: rawFcmPrivateKey,
    FINAL_JUDO_FIREBASE_PROJECT_ID: "final-judo-test",
  },
);
const inferredSource = await readFile(inferred.out, "utf8");
assert.equal(inferred.draft.production.origin, "https://app.finaljudo.kr");
assert.equal(inferred.draft.providers.apns.privateKeyStored, true);
assert.equal(inferred.draft.providers.apns.privateKeySecretName, "FINAL_JUDO_APNS_PRIVATE_KEY");
assert.equal(inferred.draft.providers.fcm.privateKeyStored, true);
assert.equal(inferred.draft.providers.fcm.privateKeySecretName, "FINAL_JUDO_FIREBASE_PRIVATE_KEY");
assert(!inferredSource.includes(rawApnsPrivateKey), "draft must not write raw APNs private key values");
assert(!inferredSource.includes(rawFcmPrivateKey), "draft must not write raw Firebase private key values");

const ready = await runDraft(
  [
    "--production-origin=https://app.finaljudo.kr",
    "--production-evidence=https://evidence.finaljudo.kr/push/production-origin",
    "--apns-stored",
    "--apns-configured",
    "--apns-evidence=drive://final-judo/evidence/push/apns-secret-store",
    "--fcm-stored",
    "--fcm-configured",
    "--fcm-evidence=drive://final-judo/evidence/push/fcm-secret-store",
    "--retry-worker-verified",
    "--retry-worker-secret-stored",
    "--retry-scheduler=external",
    "--retry-max-interval-minutes=5",
    "--retry-schedule-supported-by-plan",
    "--retry-worker-evidence=drive://final-judo/evidence/push/retry-worker",
    "--device-verified",
    "--android-device=Pixel 8 / Android 15",
    "--android-client=Final Judo 1.0 native app",
    "--android-user-email=coach@finaljudo.kr",
    "--android-evidence=https://evidence.finaljudo.kr/push/android-device-recording",
    "--ios-device=iPhone 15 / iOS 18",
    "--ios-client=Final Judo 1.0 native app",
    "--ios-user-email=guardian@finaljudo.kr",
    "--ios-evidence=https://evidence.finaljudo.kr/push/ios-device-recording",
    "--subscription-evidence=https://evidence.finaljudo.kr/push/subscription-audit",
    "--dispatch-verified",
    "--notice-id=notice-pilot-important",
    "--notice-title=파일럿 중요 공지",
    "--target-roles=coach,guardian",
    "--dispatch-evidence=https://evidence.finaljudo.kr/push/notice-dispatch",
    "--security-verified",
    "--security-evidence=https://evidence.finaljudo.kr/push/security-states",
    "--checks-passed",
    "--notification-readiness-evidence=https://github.com/antoe-prog/ant/actions/runs/410",
    "--smoke-check-evidence=https://github.com/antoe-prog/ant/actions/runs/411",
    "--signed-off-by=정유진",
    `--signed-off-at=${signedOffAt}`,
    "--signoff-evidence=https://evidence.finaljudo.kr/push/signoff",
  ],
  {
    FINAL_JUDO_APNS_PRIVATE_KEY: rawApnsPrivateKey,
    FINAL_JUDO_FIREBASE_PRIVATE_KEY: rawFcmPrivateKey,
  },
);
const readyStrict = await runStrictHandoff(ready.out);
assert.equal(readyStrict.ok, true);
assert.equal(readyStrict.releaseDecision, "ready");
assert.equal(ready.report.nextAction, `Run npm run notification-push:handoff -- --file=${ready.out}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "pending notification push draft with strict blockers",
        "env inference without raw APNs or Firebase private key output",
        "operator-completed draft with authenticated timely retry worker passes strict handoff",
      ],
    },
    null,
    2,
  ),
);
