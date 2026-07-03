import assert from "node:assert/strict";
import { canResetDevData } from "../src/server/dev-reset-policy.ts";

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

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: cases.map((testCase) => testCase.label),
    },
    null,
    2,
  ),
);
