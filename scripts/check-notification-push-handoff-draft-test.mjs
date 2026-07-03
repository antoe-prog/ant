import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-notification-push-draft-"));

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
assert.equal(pending.draft.vapid.privateKeyStored, false);
assert.equal(pending.draft.devices[0].device, "TODO_ANDROID_DEVICE");
assert(pending.report.pendingEvidence.includes("vapid.evidence"));
const pendingStrict = await expectStrictFailure(pending.out);
assert(pendingStrict.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_VAPID_PRIVATE_KEY_STORED"));
assert(pendingStrict.blockers.some((blocker) => blocker.code === "NOTIFICATION_PUSH_HANDOFF_DEVICE_FIELD"));

const rawPrivateKey = "-----BEGIN PRIVATE KEY-----\nsecret-value-that-should-not-be-written\n-----END PRIVATE KEY-----";
const inferred = await runDraft(
  ["--production-origin=https://app.finaljudo.kr", "--vapid-subject=mailto:ops@finaljudo.kr"],
  {
    FINAL_JUDO_VAPID_PUBLIC_KEY: "BK_pub_configured_for_test",
    FINAL_JUDO_VAPID_PRIVATE_KEY: rawPrivateKey,
  },
);
const inferredSource = await readFile(inferred.out, "utf8");
assert.equal(inferred.draft.production.origin, "https://app.finaljudo.kr");
assert.equal(inferred.draft.vapid.privateKeyStored, true);
assert.equal(inferred.draft.vapid.privateKeySecretName, "FINAL_JUDO_VAPID_PRIVATE_KEY");
assert(!inferredSource.includes(rawPrivateKey), "draft must not write raw VAPID private key values");

const ready = await runDraft(
  [
    "--production-origin=https://app.finaljudo.kr",
    "--production-evidence=https://evidence.finaljudo.kr/push/production-origin",
    "--vapid-stored",
    "--vapid-subject=mailto:ops@finaljudo.kr",
    "--vapid-evidence=drive://final-judo/evidence/push/vapid-secret-store",
    "--device-verified",
    "--android-device=Pixel 8 / Android 15",
    "--android-browser=Chrome Android installed PWA",
    "--user-email=coach@finaljudo.kr",
    "--android-evidence=https://evidence.finaljudo.kr/push/android-device-recording",
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
    "--signed-off-at=2026-07-18T06:00:00.000Z",
    "--signoff-evidence=https://evidence.finaljudo.kr/push/signoff",
  ],
  {
    FINAL_JUDO_VAPID_PRIVATE_KEY: rawPrivateKey,
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
        "env inference without raw VAPID private key output",
        "operator-completed draft passes strict handoff",
      ],
    },
    null,
    2,
  ),
);
