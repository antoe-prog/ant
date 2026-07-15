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
assert.match(paymentsScreen, /feeProductId: newPaymentFeeProductId/);
assert.match(paymentsScreen, /benefitCode: finalCommonPublicServiceBenefit\.id/);
assert.doesNotMatch(paymentsScreen, /isFinalMainBranch/);
assert.match(feeReference, /전 지점 공통 회비 기준/);
assert.match(feeReference, /등록 개월만큼 기간 추가/);

assert.match(classesScreen, /isFinalMainBranch\(activePolicyBranch\)/);
assert.match(classesScreen, /FinalMainScheduleReference/);
assert.match(classesScreen, /activePolicyBranch && isFinalMainBranch\(activePolicyBranch\)/);
assert.match(scheduleReference, /final-main-schedule-policy/);
assert.doesNotMatch(scheduleReference, /전 지점 공통 시간표/);

assert.match(promotionsScreen, /FinalPromotionPolicyReference/);
assert.doesNotMatch(promotionsScreen, /isFinalMainBranch/);
assert.doesNotMatch(promotionsScreen, /자격 충족/);
assert.match(promotionReference, /전 지점 공통 승급 기준/);
assert.match(promotionReference, /maximumRecognizedHoursPerDay/);
assert.match(promotionReference, /final-promotion-reference-details/);

assert.equal(skillsImage.subarray(1, 4).toString("ascii"), "PNG");
assert.equal(skillsImage.readUInt32BE(16), 708);
assert.equal(skillsImage.readUInt32BE(20), 529);
assert.equal(periodsImage.subarray(1, 4).toString("ascii"), "PNG");
assert.equal(periodsImage.readUInt32BE(16), 711);
assert.equal(periodsImage.readUInt32BE(20), 539);

console.log("final policy UI checks passed");
