import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-payment-provider-draft-"));
const signedOffAt = new Date(Date.now() + 60_000).toISOString();

function outPath(name) {
  return path.join(directory, name);
}

async function runDraft(extraArgs = [], env = {}) {
  const out = outPath(`payment-provider-handoff-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const { stdout } = await execFile(
    process.execPath,
    ["scripts/create-payment-provider-handoff-draft.mjs", `--out=${out}`, ...extraArgs],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    },
  );
  return { out, report: JSON.parse(stdout), draft: JSON.parse(await readFile(out, "utf8")) };
}

async function runStrictHandoff(filePath) {
  const { stdout } = await execFile(process.execPath, ["scripts/check-payment-provider-handoff.mjs", `--file=${filePath}`], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout);
}

async function expectStrictFailure(filePath) {
  try {
    await runStrictHandoff(filePath);
  } catch (error) {
    assert.notEqual(error.code, 0, "pending payment provider handoff must fail strict validation");
    return JSON.parse(error.stdout);
  }

  assert.fail("pending payment provider handoff unexpectedly passed strict validation");
}

const pending = await runDraft();
assert.equal(pending.report.ok, true);
assert.equal(pending.draft.provider.name, "TODO_PROVIDER_NAME");
assert.equal(pending.draft.webhook.secretStored, false);
assert(pending.report.pendingEvidence.includes("provider.contractEvidence"));
const pendingStrict = await expectStrictFailure(pending.out);
assert(pendingStrict.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_PROVIDER_NAME"));
assert(pendingStrict.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_SECRET_STORED"));

for (const weakSecret of ["secret", "replace-with-provider-webhook-secret"]) {
  const weakSecretDraft = await runDraft([], { FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: weakSecret });
  assert.equal(weakSecretDraft.draft.webhook.secretStored, false, "weak webhook secrets must not satisfy handoff storage readiness");
}

const rawSecret = "sk_live_finaljudo_super_secret_value";
const inferred = await runDraft(
  ["--provider-name=Final Pay PG", "--checkout-base-url=https://pay.finaljudo.kr", "--signature-header=x-final-pay-signature"],
  {
    FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: rawSecret,
  },
);
const inferredSource = await readFile(inferred.out, "utf8");
assert.equal(inferred.draft.provider.name, "Final Pay PG");
assert.equal(inferred.draft.checkout.baseUrl, "https://pay.finaljudo.kr");
assert.equal(inferred.draft.webhook.secretStored, true);
assert.equal(inferred.draft.webhook.secretName, "FINAL_JUDO_PAYMENT_WEBHOOK_SECRET");
assert(!inferredSource.includes(rawSecret), "draft must not write raw webhook secret values");

const ready = await runDraft(
  [
    "--provider-name=Final Pay PG",
    "--contract-status=pilot-contract",
    "--owner=정유진",
    "--contract-evidence=https://evidence.finaljudo.kr/payment/provider-contract",
    "--checkout-base-url=https://pay.finaljudo.kr",
    "--checkout-verified",
    "--checkout-evidence=https://evidence.finaljudo.kr/payment/checkout-capture",
    "--webhook-secret-stored",
    "--webhook-verified",
    "--signature-header=x-final-pay-signature",
    "--signature-algorithm=HMAC-SHA256 over raw body",
    "--event-id-field=providerEventId",
    "--status-field=event",
    "--amount-field=amount",
    "--receipt-url-field=receiptUrl",
    "--test-event-ids=evt_final_pay_0001,evt_final_pay_0002",
    "--webhook-evidence=https://evidence.finaljudo.kr/payment/webhook-replay",
    "--recurring-verified",
    "--billing-key-field=billingKey",
    "--mandate-id-field=mandateId",
    "--next-charge-date-policy=provider-schedule-after-membership-expiry",
    "--billing-key-custody=provider-vault",
    "--recurring-evidence=drive://final-judo/evidence/payment/recurring-billing",
    "--security-verified",
    "--security-evidence=https://evidence.finaljudo.kr/payment/security-audit",
    "--checks-passed",
    "--online-payment-check-evidence=https://github.com/antoe-prog/ant/actions/runs/310",
    "--recurring-billing-check-evidence=https://github.com/antoe-prog/ant/actions/runs/311",
    "--smoke-check-evidence=https://github.com/antoe-prog/ant/actions/runs/312",
    "--signed-off-by=정유진",
    `--signed-off-at=${signedOffAt}`,
    "--signoff-evidence=https://evidence.finaljudo.kr/payment/signoff",
  ],
  {
    FINAL_JUDO_PAYMENT_WEBHOOK_SECRET: rawSecret,
  },
);
const readyStrict = await runStrictHandoff(ready.out);
assert.equal(readyStrict.ok, true);
assert.equal(readyStrict.releaseDecision, "ready");
assert.equal(ready.report.nextAction, `Run npm run payment-provider:handoff -- --file=${ready.out}`);

const missingMapping = await runDraft(
  [
    "--provider-name=Final Pay PG",
    "--owner=정유진",
    "--contract-evidence=https://evidence.finaljudo.kr/payment/provider-contract",
    "--checkout-base-url=https://pay.finaljudo.kr",
    "--checkout-verified",
    "--checkout-evidence=https://evidence.finaljudo.kr/payment/checkout-capture",
    "--webhook-secret-stored",
    "--webhook-verified",
    "--signature-header=x-final-pay-signature",
    "--signature-algorithm=HMAC-SHA256",
    "--test-event-ids=evt_final_pay_0001",
    "--webhook-evidence=https://evidence.finaljudo.kr/payment/webhook-replay",
    "--recurring-verified",
    "--billing-key-field=billingKey",
    "--mandate-id-field=mandateId",
    "--recurring-evidence=drive://final-judo/evidence/payment/recurring-billing",
    "--security-verified",
    "--security-evidence=https://evidence.finaljudo.kr/payment/security-audit",
    "--checks-passed",
    "--online-payment-check-evidence=https://github.com/antoe-prog/ant/actions/runs/310",
    "--recurring-billing-check-evidence=https://github.com/antoe-prog/ant/actions/runs/311",
    "--smoke-check-evidence=https://github.com/antoe-prog/ant/actions/runs/312",
    "--signed-off-by=정유진",
    `--signed-off-at=${signedOffAt}`,
    "--signoff-evidence=https://evidence.finaljudo.kr/payment/signoff",
  ],
);
const missingMappingStrict = await expectStrictFailure(missingMapping.out);
assert(missingMappingStrict.blockers.some((blocker) => blocker.code === "PAYMENT_PROVIDER_HANDOFF_WEBHOOK_FIELD_MAPPING"));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "pending payment provider draft with strict blockers",
        "env inference without raw webhook secret output",
        "operator-completed draft passes strict handoff",
        "missing webhook field mapping remains blocked",
      ],
    },
    null,
    2,
  ),
);
