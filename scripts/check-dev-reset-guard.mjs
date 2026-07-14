import assert from "node:assert/strict";
import { canResetDevData } from "../src/server/dev-reset-policy.ts";
import {
  hasValidSmokeDataOwnership,
  hasValidSmokeOwnershipToken,
} from "../src/server/smoke-server-attestation.ts";
import {
  cleanupReleaseSmokeEnvironment,
  createReleaseSmokeEnvironment,
} from "./lib/release-smoke-environment.mjs";

const cases = [
  {
    env: { NODE_ENV: "development" },
    expected: true,
    label: "development environment allows reset",
  },
  {
    env: { NODE_ENV: "test" },
    expected: true,
    label: "test environment allows reset",
  },
  {
    env: { NODE_ENV: "production" },
    expected: false,
    label: "production blocks reset by default",
  },
  {
    env: { NODE_ENV: "production", FINAL_JUDO_ENABLE_DEV_RESET: "1" },
    expected: true,
    label: "production allows reset only with final-judo override",
  },
  {
    env: { NODE_ENV: "production", FINAL_JUDO_ENABLE_DEV_RESET: "true" },
    expected: true,
    label: "production accepts true override",
  },
  {
    env: { NODE_ENV: "production", ENABLE_DEV_RESET: "1" },
    expected: true,
    label: "production keeps legacy override compatibility",
  },
  {
    env: { NODE_ENV: "production", FINAL_JUDO_ENABLE_DEV_RESET: "0", ENABLE_DEV_RESET: "0" },
    expected: false,
    label: "production rejects disabled override values",
  },
];

for (const testCase of cases) {
  assert.equal(canResetDevData(testCase.env), testCase.expected, testCase.label);
}

const ownedDataPlan = await createReleaseSmokeEnvironment({ env: {} });
const ownershipToken = ownedDataPlan.env.FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN;
const ownershipEnv = { FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN: ownershipToken };

assert.equal(
  hasValidSmokeOwnershipToken(new Headers({ "x-final-judo-smoke-ownership-token": ownershipToken }), ownershipEnv),
  true,
  "matching smoke ownership token allows reset",
);
assert.equal(
  hasValidSmokeOwnershipToken(new Headers({ "x-final-judo-smoke-ownership-token": "b".repeat(64) }), ownershipEnv),
  false,
  "mismatched smoke ownership token blocks reset",
);
assert.equal(hasValidSmokeOwnershipToken(new Headers(), ownershipEnv), false, "missing request token blocks reset");
assert.equal(
  hasValidSmokeOwnershipToken(new Headers({ "x-final-judo-smoke-ownership-token": ownershipToken }), {}),
  false,
  "server without an ownership token blocks reset",
);
assert.equal(
  hasValidSmokeOwnershipToken(new Headers({ "x-final-judo-smoke-ownership-token": "x" }), {
    FINAL_JUDO_SMOKE_OWNERSHIP_TOKEN: "x",
  }),
  false,
  "weak matching ownership tokens block reset",
);

try {
  assert.equal(
    await hasValidSmokeDataOwnership(ownedDataPlan.env),
    true,
    "run-owned temporary JSON data allows reset",
  );
  assert.equal(
    await hasValidSmokeDataOwnership({ ...ownedDataPlan.env, FINAL_JUDO_DATA_DIR: ".data" }),
    false,
    "shared workspace JSON data blocks reset",
  );
  assert.equal(
    await hasValidSmokeDataOwnership({ ...ownedDataPlan.env, PILOT_DB_FILE: ".data/final-judo-db.json" }),
    false,
    "shared PILOT_DB_FILE blocks reset even when FINAL_JUDO_DATA_DIR is isolated",
  );
  assert.equal(
    await hasValidSmokeDataOwnership({ ...ownedDataPlan.env, FINAL_JUDO_DB_DRIVER: "postgres" }),
    false,
    "non-JSON databases block the dev reset route",
  );
} finally {
  await cleanupReleaseSmokeEnvironment(ownedDataPlan);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        ...cases.map((testCase) => testCase.label),
        "matching smoke ownership token allows reset",
        "missing, mismatched, or unconfigured ownership tokens block reset",
        "weak ownership tokens block reset",
        "only run-owned temporary JSON data allows reset",
      ],
    },
    null,
    2,
  ),
);
