import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [paymentsScreen, classesScreen, promotionsScreen, feeReference, scheduleReference, promotionReference, skillsImage, periodsImage] =
  await Promise.all([
    readFile("src/components/screens/payments-screen.tsx", "utf8"),
    readFile("src/components/screens/classes-screen.tsx", "utf8"),
    readFile("src/components/screens/promotions-screen.tsx", "utf8"),
    readFile("src/components/domain/final-common-fee-reference.tsx", "utf8"),
    readFile("src/components/domain/final-main-schedule-reference.tsx", "utf8"),
    readFile("src/components/domain/final-promotion-policy-reference.tsx", "utf8"),
    readFile("public/reference/final-judo-promotion-skills-2026-03.png"),
    readFile("public/reference/final-judo-promotion-periods-2026-03.png"),
  ]);

assert.match(paymentsScreen, /payment-create-fee-product-select/);
assert.match(paymentsScreen, /payment-create-public-service-benefit/);
assert.match(paymentsScreen, /payment-create-benefit-verification-reason/);
assert.match(paymentsScreen, /payment-create-discount-reason-input/);
assert.match(paymentsScreen, /discountReason/);
assert.match(paymentsScreen, /feeProductId: newPaymentFeeProductId/);
assert.match(paymentsScreen, /benefitCode: finalCommonPublicServiceBenefit\.id/);
assert.match(paymentsScreen, /benefitVerificationReason,/);
assert.match(paymentsScreen, /민감한 번호는 입력하지 마세요/);
assert.match(paymentsScreen, /clearPublicServiceBenefitForMemberChange\(\)/);
assert.match(paymentsScreen, /newPaymentPublicServiceBenefit && !newPaymentBenefitVerificationReason\.trim\(\)/);
assert.doesNotMatch(paymentsScreen, /isFinalMainBranch/);
const paymentFilterGridStart = paymentsScreen.indexOf("md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]");
assert.ok(paymentFilterGridStart >= 0, "The desktop payment filter grid must be present.");
assert.doesNotMatch(paymentsScreen.slice(paymentFilterGridStart, paymentFilterGridStart + 240), /xl:col-span-2/);
assert.match(feeReference, /전 지점 공통 회비 기준/);
assert.match(feeReference, /등록 개월만큼 기간 추가/);

assert.match(classesScreen, /isFinalMainBranch\(activePolicyBranch\)/);
assert.match(classesScreen, /FinalMainScheduleReference/);
assert.match(classesScreen, /activePolicyBranch && isFinalMainBranch\(activePolicyBranch\)/);
assert.ok(
  classesScreen.lastIndexOf("<FinalMainScheduleReference") > classesScreen.indexOf("visibleSessions.length === 0"),
  "The reference schedule must render after the operational class and attendance flow.",
);
assert.match(scheduleReference, /final-main-schedule-policy/);
assert.match(scheduleReference, /<details/);
assert.match(scheduleReference, /middle_school_second_block_may_vary/);
assert.match(scheduleReference, /중등 선수부 2부/);
assert.doesNotMatch(scheduleReference, /전 지점 공통 시간표/);

assert.match(promotionsScreen, /FinalPromotionPolicyReference/);
assert.match(promotionsScreen, /getExactNextCompatiblePromotionBelt/);
assert.match(promotionsScreen, /promotion-create-target-belt/);
assert.match(promotionsScreen, /promotion-create-error/);
assert.match(promotionsScreen, /disabled=\{pending \|\| !suggestedBelt\}/);
assert.doesNotMatch(promotionsScreen, /judoBelts\.map/);
assert.doesNotMatch(promotionsScreen, /isFinalMainBranch/);
assert.doesNotMatch(promotionsScreen, /자격 충족/);
assert.match(promotionReference, /전 지점 공통 승급 기준/);
assert.match(promotionReference, /maximumRecognizedHoursPerDay/);
assert.match(promotionReference, /final-promotion-reference-details/);
assert.match(promotionReference, /final-promotion-reference-scroll-region/);
assert.match(promotionReference, /overflow-x-auto/);
assert.match(promotionReference, /tabIndex=\{0\}/);
assert.match(promotionReference, /ArrowRight/);
assert.match(promotionReference, /<table className="sr-only">/);
assert.match(promotionReference, /finalCommonPromotionPolicy\.periodRules/);

assert.equal(skillsImage.subarray(1, 4).toString("ascii"), "PNG");
assert.equal(skillsImage.readUInt32BE(16), 708);
assert.equal(skillsImage.readUInt32BE(20), 529);
assert.equal(periodsImage.subarray(1, 4).toString("ascii"), "PNG");
assert.equal(periodsImage.readUInt32BE(16), 711);
assert.equal(periodsImage.readUInt32BE(20), 539);

console.log("final policy UI checks passed");
