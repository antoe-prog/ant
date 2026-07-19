import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  FINAL_COMMON_FEE_POLICY_SCOPE,
  addMonthsToDateKey,
  finalCommonFeePolicy,
  finalCommonFeePolicyVersion,
  finalCommonFeeProducts,
  getFinalCommonFeeProduct,
  getFinalCommonPublicServiceDuration,
  getFinalCommonRegularMembershipPlan,
  isFinalCommonMembershipProductId,
  quoteFinalCommonFeeProduct,
} from "../src/lib/final-common-fee-policy.ts";
import {
  canRefundPaymentAmount,
  getPaymentNetAmount,
  getPaymentRemainingRefundableAmount,
} from "../src/lib/payment-amounts.ts";

assert.equal(FINAL_COMMON_FEE_POLICY_SCOPE, "all_branches");
assert.equal(finalCommonFeePolicy.scope, "all_branches");
assert.equal(finalCommonFeePolicyVersion, "2026-03");
assert.equal(getFinalCommonRegularMembershipPlan.length, 2, "common plan lookup must not accept a branch argument");
assert.equal(getFinalCommonRegularMembershipPlan(2, 3)?.priceKrw, 427_500);
assert.deepEqual(
  finalCommonFeePolicy.regularMembershipPlans.map((plan) => [
    plan.trainingDaysPerWeek,
    plan.durationMonths,
    plan.priceKrw,
  ]),
  [
    [5, 1, 180_000],
    [3, 1, 160_000],
    [2, 1, 150_000],
    [5, 3, 513_000],
    [3, 3, 456_000],
    [2, 3, 427_500],
    [5, 6, 918_000],
    [3, 6, 816_000],
    [2, 6, 765_000],
    [5, 12, 1_728_000],
    [3, 12, 1_536_000],
    [2, 12, 1_440_000],
  ],
);
assert.deepEqual(
  finalCommonFeePolicy.regularMembershipPlans
    .filter((plan) => plan.pauseAllowance)
    .map((plan) => [plan.durationMonths, plan.pauseAllowance?.maxPauses, plan.pauseAllowance?.maxDaysPerPause]),
  [
    [3, 1, 30],
    [3, 1, 30],
    [3, 1, 30],
    [6, 2, 30],
    [6, 2, 30],
    [6, 2, 30],
    [12, 3, 30],
    [12, 3, 30],
    [12, 3, 30],
  ],
);
assert.deepEqual(getFinalCommonPublicServiceDuration(6), {
  bonusMonths: 6,
  registeredMonths: 6,
  totalMonths: 12,
});
assert.deepEqual(finalCommonFeePolicy.publicServiceBenefit.eligibleOccupations, ["police", "military", "firefighter"]);
assert.equal(finalCommonFeePolicy.lifetimeMembership.priceKrw, 7_500_000);
assert.equal(finalCommonFeePolicy.lifetimeMembership.directQuoteAvailable, false);
assert.deepEqual(
  finalCommonFeePolicy.monthlyProgramFees.map((program) => [program.id, program.durationMonths, program.priceKrw]),
  [
    ["entrance-exam", 1, 600_000],
    ["athlete-middle-school", 1, 300_000],
    ["athlete-high-school", 1, 350_000],
    ["dan-preparation", 1, 250_000],
  ],
);
assert.deepEqual(
  finalCommonFeePolicy.dayPassFees.map((pass) => [pass.dayType, pass.priceKrw]),
  [
    ["weekday", 30_000],
    ["weekend", 35_000],
  ],
);
assert.deepEqual(
  finalCommonFeePolicy.uniformFees.map((uniform) => [uniform.category, uniform.color, uniform.priceKrw]),
  [
    ["athlete", "blue", 370_000],
    ["athlete", "white", 350_000],
    ["training", "blue", 90_000],
    ["training", "black", 90_000],
    ["training", "red", 90_000],
    ["training", "white", 90_000],
  ],
);
assert.deepEqual(
  finalCommonFeePolicy.discountReferences.map((discount) => discount.id),
  ["member-2-years", "companion-first-month", "family-monthly", "dan-3-plus", "final-origin-dan-3-plus"],
);
assert.equal(finalCommonFeePolicy.newMemberBenefits.threeMonthUniform.freeUniformQuantity, 1);
assert.equal(finalCommonFeeProducts.length, 25);
assert.ok(
  finalCommonFeeProducts.every(
    (product) =>
      typeof product.id === "string" &&
      typeof product.label === "string" &&
      typeof product.category === "string" &&
      typeof product.amount === "number" &&
      "registeredMonths" in product &&
      typeof product.directlyQuoteable === "boolean",
  ),
);
assert.equal(getFinalCommonFeeProduct("regular-2d-3m")?.amount, 427_500);
assert.equal(isFinalCommonMembershipProductId("regular-2d-3m"), true);
assert.equal(isFinalCommonMembershipProductId("athlete-middle-school"), true);
assert.equal(isFinalCommonMembershipProductId("day-pass-weekday"), false);
assert.equal(isFinalCommonMembershipProductId("training-white"), false);
assert.equal(isFinalCommonMembershipProductId("missing-product"), false);
assert.deepEqual(
  quoteFinalCommonFeeProduct({
    benefitCode: "public-service-one-plus-one",
    productId: "regular-2d-3m",
    startDate: "2026-01-31",
  }),
  {
    amount: 427_500,
    benefitCode: "public-service-one-plus-one",
    expiresAt: "2026-07-31",
    planName: "주 2일 3개월",
    policyVersion: "2026-03",
    registeredMonths: 3,
    serviceMonths: 6,
  },
);
assert.throws(
  () => quoteFinalCommonFeeProduct({ productId: "lifetime", startDate: "2026-01-31" }),
  /not directly quoteable/,
);
assert.equal(
  quoteFinalCommonFeeProduct({ productId: "day-pass-weekday", startDate: "2026-02-03" }).expiresAt,
  "2026-02-03",
);
assert.equal(
  quoteFinalCommonFeeProduct({ productId: "training-white", startDate: "2026-02-03" }).expiresAt,
  "2026-02-03",
);
assert.throws(
  () =>
    quoteFinalCommonFeeProduct({
      benefitCode: "public-service-one-plus-one",
      productId: "day-pass-weekday",
      startDate: "2026-02-03",
    }),
  /not available for product/,
);
assert.throws(
  () =>
    quoteFinalCommonFeeProduct({
      benefitCode: "public-service-one-plus-one",
      productId: "training-white",
      startDate: "2026-02-03",
    }),
  /not available for product/,
);
assert.equal(
  quoteFinalCommonFeeProduct({
    benefitCode: "public-service-one-plus-one",
    productId: "dan-preparation",
    startDate: "2026-02-03",
  }).serviceMonths,
  2,
);
assert.equal(addMonthsToDateKey("2024-01-31", 1), "2024-02-29");
assert.equal(addMonthsToDateKey("2025-03-31", -1), "2025-02-28");
assert.throws(() => addMonthsToDateKey("0099-01-31", 1), /between 1900 and 9999/);
assert.throws(() => addMonthsToDateKey("9999-12-31", 1), /between 1900 and 9999/);
assert.doesNotMatch(JSON.stringify(finalCommonFeePolicy), /bank|account/i);

const discountedPayment = {
  amount: 180_000,
  discountAmount: 20_000,
  refundedAmount: 30_000,
};
assert.equal(getPaymentNetAmount(discountedPayment), 160_000);
assert.equal(getPaymentRemainingRefundableAmount(discountedPayment), 130_000);
assert.equal(canRefundPaymentAmount(discountedPayment, 130_000), true);
assert.equal(canRefundPaymentAmount(discountedPayment, 130_001), false);

const [refundRoute, webhookRoute, manualCreateRoute] = await Promise.all([
  readFile(new URL("../src/app/api/v1/payments/[paymentId]/refund/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/v1/payments/webhook/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/v1/branches/[branchId]/payments/route.ts", import.meta.url), "utf8"),
]);

assert.match(refundRoute, /canRefundPaymentAmount\(payment, refundAmount\)/);
assert.match(webhookRoute, /canRefundPaymentAmount\(payment, webhookBody\.amount\)/);
assert.match(manualCreateRoute, /refundedAmount: isRefunded \? getPaymentNetAmount\(snapshot\) : 0/);
assert.match(manualCreateRoute, /feeQuote = quoteFinalCommonFeeProduct\(/);
assert.match(manualCreateRoute, /planName = feeQuote\.planName/);
assert.match(manualCreateRoute, /amount = feeQuote\.amount/);
assert.match(manualCreateRoute, /expiresAt = feeQuote\.expiresAt \?\? ""/);
assert.match(manualCreateRoute, /\["feeProductId", "공통 회비 상품"\]/);
assert.match(manualCreateRoute, /typeof body\[field\] !== "string"/);
assert.match(manualCreateRoute, /benefitCode && !benefitVerificationReason/);
assert.match(manualCreateRoute, /benefitVerification/);
assert.match(manualCreateRoute, /verifiedByUserId: user\.id/);
assert.doesNotMatch(manualCreateRoute, /isFinalMainBranch/, "common fee quoting must not be limited to the main branch");

console.log("final common fee policy checks passed");
