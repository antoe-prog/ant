export const FINAL_COMMON_FEE_POLICY_SCOPE = "all_branches" as const;
export const finalCommonFeePolicyVersion = "2026-03" as const;

export type FinalCommonTrainingDaysPerWeek = 2 | 3 | 5;
export type FinalCommonMembershipDurationMonths = 1 | 3 | 6 | 12;

export type FinalCommonPauseAllowance = {
  maxDaysPerPause: 30;
  maxPauses: 1 | 2 | 3;
};

export type FinalCommonRegularMembershipPlan = {
  durationMonths: FinalCommonMembershipDurationMonths;
  id: string;
  pauseAllowance: FinalCommonPauseAllowance | null;
  priceKrw: number;
  trainingDaysPerWeek: FinalCommonTrainingDaysPerWeek;
};

export const finalCommonRegularMembershipPlans = [
  { id: "regular-5d-1m", trainingDaysPerWeek: 5, durationMonths: 1, priceKrw: 180_000, pauseAllowance: null },
  { id: "regular-3d-1m", trainingDaysPerWeek: 3, durationMonths: 1, priceKrw: 160_000, pauseAllowance: null },
  { id: "regular-2d-1m", trainingDaysPerWeek: 2, durationMonths: 1, priceKrw: 150_000, pauseAllowance: null },
  {
    id: "regular-5d-3m",
    trainingDaysPerWeek: 5,
    durationMonths: 3,
    priceKrw: 513_000,
    pauseAllowance: { maxPauses: 1, maxDaysPerPause: 30 },
  },
  {
    id: "regular-3d-3m",
    trainingDaysPerWeek: 3,
    durationMonths: 3,
    priceKrw: 456_000,
    pauseAllowance: { maxPauses: 1, maxDaysPerPause: 30 },
  },
  {
    id: "regular-2d-3m",
    trainingDaysPerWeek: 2,
    durationMonths: 3,
    priceKrw: 427_500,
    pauseAllowance: { maxPauses: 1, maxDaysPerPause: 30 },
  },
  {
    id: "regular-5d-6m",
    trainingDaysPerWeek: 5,
    durationMonths: 6,
    priceKrw: 918_000,
    pauseAllowance: { maxPauses: 2, maxDaysPerPause: 30 },
  },
  {
    id: "regular-3d-6m",
    trainingDaysPerWeek: 3,
    durationMonths: 6,
    priceKrw: 816_000,
    pauseAllowance: { maxPauses: 2, maxDaysPerPause: 30 },
  },
  {
    id: "regular-2d-6m",
    trainingDaysPerWeek: 2,
    durationMonths: 6,
    priceKrw: 765_000,
    pauseAllowance: { maxPauses: 2, maxDaysPerPause: 30 },
  },
  {
    id: "regular-5d-12m",
    trainingDaysPerWeek: 5,
    durationMonths: 12,
    priceKrw: 1_728_000,
    pauseAllowance: { maxPauses: 3, maxDaysPerPause: 30 },
  },
  {
    id: "regular-3d-12m",
    trainingDaysPerWeek: 3,
    durationMonths: 12,
    priceKrw: 1_536_000,
    pauseAllowance: { maxPauses: 3, maxDaysPerPause: 30 },
  },
  {
    id: "regular-2d-12m",
    trainingDaysPerWeek: 2,
    durationMonths: 12,
    priceKrw: 1_440_000,
    pauseAllowance: { maxPauses: 3, maxDaysPerPause: 30 },
  },
] as const satisfies readonly FinalCommonRegularMembershipPlan[];

export const finalCommonLifetimeMembership = {
  directQuoteAvailable: false,
  id: "lifetime",
  priceKrw: 7_500_000,
} as const;

export const finalCommonMonthlyProgramFees = [
  { durationMonths: 1, id: "entrance-exam", priceKrw: 600_000 },
  { durationMonths: 1, id: "athlete-middle-school", priceKrw: 300_000 },
  { durationMonths: 1, id: "athlete-high-school", priceKrw: 350_000 },
  { durationMonths: 1, id: "dan-preparation", priceKrw: 250_000 },
] as const;

export const finalCommonDayPassFees = [
  { dayType: "weekday", id: "day-pass-weekday", priceKrw: 30_000 },
  { dayType: "weekend", id: "day-pass-weekend", priceKrw: 35_000 },
] as const;

export const finalCommonUniformFees = [
  { category: "athlete", color: "blue", id: "athlete-blue", priceKrw: 370_000 },
  { category: "athlete", color: "white", id: "athlete-white", priceKrw: 350_000 },
  { category: "training", color: "blue", id: "training-blue", priceKrw: 90_000 },
  { category: "training", color: "black", id: "training-black", priceKrw: 90_000 },
  { category: "training", color: "red", id: "training-red", priceKrw: 90_000 },
  { category: "training", color: "white", id: "training-white", priceKrw: 90_000 },
] as const;

export const finalCommonNewMemberBenefits = {
  threeMonthUniform: {
    eligibleDurationMonths: 3,
    freeUniformQuantity: 1,
    requiresNewMember: true,
  },
} as const;

export const finalCommonDiscountReferences = [
  {
    amountKrw: 10_000,
    id: "member-2-years",
    kind: "monthly_fixed_discount",
    minimumMembershipYears: 2,
  },
  {
    id: "companion-first-month",
    kind: "first_month_rate_discount",
    rate: 0.1,
  },
  {
    id: "family-monthly",
    kind: "monthly_rate_discount",
    rate: 0.1,
  },
  {
    id: "dan-3-plus",
    kind: "monthly_fixed_price",
    minimumDanRank: 3,
    priceKrw: 130_000,
  },
  {
    id: "final-origin-dan-3-plus",
    kind: "monthly_fixed_price",
    minimumDanRank: 3,
    priceKrw: 100_000,
    requiresFinalOrigin: true,
  },
] as const;

export const finalCommonPublicServiceBenefit = {
  bonusMonthsPerRegisteredMonth: 1,
  eligibleOccupations: ["police", "military", "firefighter"],
  id: "public-service-one-plus-one",
} as const;

export type FinalCommonFeeProductCategory =
  | "regular_membership"
  | "lifetime_membership"
  | "monthly_program"
  | "day_pass"
  | "uniform";

export type FinalCommonFeeProduct = {
  amount: number;
  category: FinalCommonFeeProductCategory;
  directlyQuoteable: boolean;
  id: string;
  label: string;
  pauseCount?: number;
  pauseMaxDays?: number;
  registeredMonths: number | null;
  weeklyDays?: number;
};

const finalCommonMonthlyProgramLabels: Record<(typeof finalCommonMonthlyProgramFees)[number]["id"], string> = {
  "entrance-exam": "입시반 1개월",
  "athlete-middle-school": "선수부 중등 1개월",
  "athlete-high-school": "선수부 고등 1개월",
  "dan-preparation": "단 준비 1개월",
};

const finalCommonDayPassLabels: Record<(typeof finalCommonDayPassFees)[number]["id"], string> = {
  "day-pass-weekday": "평일 일일권",
  "day-pass-weekend": "주말 일일권",
};

const finalCommonUniformLabels: Record<(typeof finalCommonUniformFees)[number]["id"], string> = {
  "athlete-blue": "선수용 도복 청",
  "athlete-white": "선수용 도복 백",
  "training-blue": "수련용 도복 청",
  "training-black": "수련용 도복 흑",
  "training-red": "수련용 도복 적",
  "training-white": "수련용 도복 백",
};

export const finalCommonFeeProducts: readonly FinalCommonFeeProduct[] = [
  ...finalCommonRegularMembershipPlans.map((plan) => ({
    amount: plan.priceKrw,
    category: "regular_membership" as const,
    directlyQuoteable: true,
    id: plan.id,
    label: `주 ${plan.trainingDaysPerWeek}일 ${plan.durationMonths}개월`,
    ...(plan.pauseAllowance
      ? {
          pauseCount: plan.pauseAllowance.maxPauses,
          pauseMaxDays: plan.pauseAllowance.maxDaysPerPause,
        }
      : {}),
    registeredMonths: plan.durationMonths,
    weeklyDays: plan.trainingDaysPerWeek,
  })),
  {
    amount: finalCommonLifetimeMembership.priceKrw,
    category: "lifetime_membership",
    directlyQuoteable: finalCommonLifetimeMembership.directQuoteAvailable,
    id: finalCommonLifetimeMembership.id,
    label: "평생 회원권",
    registeredMonths: null,
  },
  ...finalCommonMonthlyProgramFees.map((program) => ({
    amount: program.priceKrw,
    category: "monthly_program" as const,
    directlyQuoteable: true,
    id: program.id,
    label: finalCommonMonthlyProgramLabels[program.id],
    registeredMonths: program.durationMonths,
  })),
  ...finalCommonDayPassFees.map((pass) => ({
    amount: pass.priceKrw,
    category: "day_pass" as const,
    directlyQuoteable: true,
    id: pass.id,
    label: finalCommonDayPassLabels[pass.id],
    registeredMonths: null,
  })),
  ...finalCommonUniformFees.map((uniform) => ({
    amount: uniform.priceKrw,
    category: "uniform" as const,
    directlyQuoteable: true,
    id: uniform.id,
    label: finalCommonUniformLabels[uniform.id],
    registeredMonths: null,
  })),
];

export const finalCommonFeePolicy = {
  scope: FINAL_COMMON_FEE_POLICY_SCOPE,
  dayPassFees: finalCommonDayPassFees,
  discountReferences: finalCommonDiscountReferences,
  lifetimeMembership: finalCommonLifetimeMembership,
  monthlyProgramFees: finalCommonMonthlyProgramFees,
  newMemberBenefits: finalCommonNewMemberBenefits,
  publicServiceBenefit: finalCommonPublicServiceBenefit,
  products: finalCommonFeeProducts,
  regularMembershipPlans: finalCommonRegularMembershipPlans,
  uniformFees: finalCommonUniformFees,
  version: finalCommonFeePolicyVersion,
} as const;

export type FinalCommonFeeBenefitCode = typeof finalCommonPublicServiceBenefit.id;

export type FinalCommonFeeQuote = {
  amount: number;
  benefitCode?: FinalCommonFeeBenefitCode;
  expiresAt: string | null;
  planName: string;
  policyVersion: typeof finalCommonFeePolicyVersion;
  registeredMonths: number | null;
  serviceMonths: number | null;
};

const finalCommonPublicServiceEligibleCategories: readonly FinalCommonFeeProductCategory[] = [
  "regular_membership",
  "monthly_program",
];

const finalCommonMembershipProductCategories: readonly FinalCommonFeeProductCategory[] = [
  "regular_membership",
  "lifetime_membership",
  "monthly_program",
];

export function getFinalCommonFeeProduct(productId: string) {
  return finalCommonFeeProducts.find((product) => product.id === productId);
}

export function isFinalCommonMembershipProductId(productId: string) {
  const product = getFinalCommonFeeProduct(productId);

  return Boolean(product && finalCommonMembershipProductCategories.includes(product.category));
}

export function getFinalCommonRegularMembershipPlan(
  trainingDaysPerWeek: FinalCommonTrainingDaysPerWeek,
  durationMonths: FinalCommonMembershipDurationMonths,
) {
  return finalCommonRegularMembershipPlans.find(
    (plan) => plan.trainingDaysPerWeek === trainingDaysPerWeek && plan.durationMonths === durationMonths,
  );
}

export function getFinalCommonPublicServiceDuration(registeredMonths: number) {
  if (!Number.isSafeInteger(registeredMonths) || registeredMonths <= 0) {
    throw new RangeError("registeredMonths must be a positive integer");
  }

  const bonusMonths = registeredMonths * finalCommonPublicServiceBenefit.bonusMonthsPerRegisteredMonth;

  return {
    bonusMonths,
    registeredMonths,
    totalMonths: registeredMonths + bonusMonths,
  };
}

export function addMonthsToDateKey(dateKey: string, months: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isSafeInteger(months)) {
    throw new RangeError("dateKey must be YYYY-MM-DD and months must be an integer");
  }

  const sourceYear = Number(dateKey.slice(0, 4));

  if (sourceYear < 1900 || sourceYear > 9999) {
    throw new RangeError("dateKey year must be between 1900 and 9999");
  }

  const source = new Date(`${dateKey}T00:00:00.000Z`);

  if (Number.isNaN(source.getTime()) || source.toISOString().slice(0, 10) !== dateKey) {
    throw new RangeError("dateKey must be a valid calendar date");
  }

  const targetMonth = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));

  if (
    Number.isNaN(targetMonth.getTime()) ||
    targetMonth.getUTCFullYear() < 1900 ||
    targetMonth.getUTCFullYear() > 9999
  ) {
    throw new RangeError("calculated date year must be between 1900 and 9999");
  }

  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  targetMonth.setUTCDate(Math.min(source.getUTCDate(), lastDayOfTargetMonth));

  return targetMonth.toISOString().slice(0, 10);
}

export function quoteFinalCommonFeeProduct({
  benefitCode,
  productId,
  startDate,
}: {
  benefitCode?: FinalCommonFeeBenefitCode;
  productId: string;
  startDate: string;
}): FinalCommonFeeQuote {
  const product = getFinalCommonFeeProduct(productId);

  if (!product) {
    throw new RangeError(`Unknown final common fee product: ${productId}`);
  }

  if (!product.directlyQuoteable) {
    throw new RangeError(`Final common fee product is not directly quoteable: ${productId}`);
  }

  const normalizedStartDate = addMonthsToDateKey(startDate, 0);
  let serviceMonths = product.registeredMonths;

  if (benefitCode !== undefined) {
    if (benefitCode !== finalCommonPublicServiceBenefit.id) {
      throw new RangeError(`Unknown final common fee benefit: ${benefitCode}`);
    }

    if (
      product.registeredMonths === null ||
      !finalCommonPublicServiceEligibleCategories.includes(product.category)
    ) {
      throw new RangeError(`Final common fee benefit is not available for product: ${productId}`);
    }

    serviceMonths = getFinalCommonPublicServiceDuration(product.registeredMonths).totalMonths;
  }

  return {
    amount: product.amount,
    ...(benefitCode ? { benefitCode } : {}),
    expiresAt: serviceMonths === null ? normalizedStartDate : addMonthsToDateKey(normalizedStartDate, serviceMonths),
    planName: product.label,
    policyVersion: finalCommonFeePolicyVersion,
    registeredMonths: product.registeredMonths,
    serviceMonths,
  };
}
