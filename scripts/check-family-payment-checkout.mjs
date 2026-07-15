import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { getFamilyPaymentCheckoutAccess, getFamilyPaymentPlanLine, getPaymentCheckoutAmount } = await import(
  "../src/lib/payment-checkout-access.ts"
);
const { getAccessibleMemberIds } = await import("../src/lib/mock-api.ts");

const adultUser = {
  branchIds: ["branch-gangnam"],
  id: "user-member",
  memberIds: ["member-minjae"],
  name: "최민재",
  role: "member",
  title: "성인 회원",
};
const guardianUser = {
  branchIds: ["branch-gangnam"],
  childMemberIds: ["member-yuna"],
  id: "user-guardian",
  name: "이하린",
  role: "guardian",
  title: "학부모",
};
const adultMember = {
  ageGroup: "adult",
  alerts: [],
  belt: "초록띠",
  branchId: "branch-gangnam",
  emergencyContact: "010-9364-5827",
  guardianIds: [],
  id: "member-minjae",
  level: "중급",
  name: "최민재",
  primaryCoachId: "user-coach",
  status: "active",
};
const youthMember = {
  ageGroup: "teen",
  alerts: [],
  belt: "흰띠",
  branchId: "branch-gangnam",
  emergencyContact: "010-6815-4072",
  guardianIds: ["user-guardian"],
  id: "member-yuna",
  level: "체험",
  name: "한유나",
  primaryCoachId: "user-coach",
  status: "trial",
};
const adultPayment = {
  amount: 170000,
  branchId: "branch-gangnam",
  discountAmount: 0,
  dueDate: "2026-06-25",
  expiresAt: "2026-07-25",
  id: "pay-minjae",
  memberId: "member-minjae",
  planName: "성인 월 회원권",
  status: "overdue",
};
const youthPayment = {
  amount: 30000,
  branchId: "branch-gangnam",
  dueDate: "2026-06-28",
  expiresAt: "2026-07-04",
  id: "pay-yuna",
  memberId: "member-yuna",
  planName: "체험권",
  status: "scheduled",
};
const otherPaidPayment = {
  amount: 190000,
  branchId: "branch-gangnam",
  dueDate: "2026-06-20",
  expiresAt: "2026-07-20",
  id: "pay-other-paid",
  memberId: "member-other",
  planName: "타 회원권",
  status: "paid",
};
const otherMember = {
  ...adultMember,
  guardianIds: [],
  id: "member-other",
  name: "권한 외 회원",
};

const adultAccess = getFamilyPaymentCheckoutAccess(adultUser, {
  ...adultPayment,
  member: adultMember,
});

assert.equal(adultAccess.canOpen, true, "adult member must be able to open checkout preparation");
assert.equal(adultAccess.label, "납부 요청", "adult member checkout action label must avoid live payment copy");
assert.equal(getPaymentCheckoutAmount(adultPayment), 170000, "adult checkout amount mismatch");
assert.equal(
  getFamilyPaymentPlanLine(adultPayment.planName, "teen"),
  "청소년 · 월 회원권",
  "family payment display must replace stale age prefixes with the current member age group",
);
assert.equal(
  getFamilyPaymentPlanLine("체험권", "kids"),
  "유소년 · 체험권",
  "family payment display must prepend the current age group when the plan name has no age prefix",
);

const guardianAccess = getFamilyPaymentCheckoutAccess(guardianUser, {
  ...youthPayment,
  member: youthMember,
});

assert.equal(guardianAccess.canOpen, true, "guardian must be able to open child checkout preparation");
assert.equal(guardianAccess.label, "납부 요청", "guardian checkout action label must avoid live payment copy");
const guardianPendingAccess = getFamilyPaymentCheckoutAccess(guardianUser, {
  ...youthPayment,
  member: youthMember,
  onlinePayment: {
    amount: 30000,
    checkoutUrl: "/app/payments?checkout=fj_pay_yuna",
    provider: "mock",
    providerPaymentId: "fj_pay_yuna",
    requestedAt: "2026-06-28T09:00:00.000Z",
    requestedByUserId: "user-owner",
    status: "pending",
  },
});
assert.equal(guardianPendingAccess.label, "납부 확인 중", "pending family checkout action must avoid live-payment progress copy");
assert.deepEqual(
  getAccessibleMemberIds(
    { ...guardianUser, childMemberIds: ["member-yuna", "member-stale-child"] },
    {
      members: [youthMember, { ...otherMember, id: "member-stale-child", guardianIds: ["user-other-guardian"] }],
    },
    ["branch-gangnam"],
  ),
  ["member-yuna"],
  "guardian payment/member scope must require both user.childMemberIds and member.guardianIds",
);

const youthMemberUser = {
  ...adultUser,
  id: "user-youth-member",
  memberIds: [youthPayment.memberId],
  role: "member",
};
const youthMemberAccess = getFamilyPaymentCheckoutAccess(youthMemberUser, {
  ...youthPayment,
  member: youthMember,
});

assert.equal(youthMemberAccess.canOpen, false, "youth member must not directly open checkout preparation");
assert.equal(youthMemberAccess.state, "guardian_required", "youth member must require guardian checkout");
assert.equal(youthMemberAccess.label, "학부모 결제", "youth member checkout block must point to guardian checkout");

const otherPaidAccess = getFamilyPaymentCheckoutAccess(adultUser, {
  ...otherPaidPayment,
  member: otherMember,
});

assert.equal(otherPaidAccess.canOpen, false, "unauthorized paid payment must not open checkout preparation");
assert.equal(otherPaidAccess.state, "forbidden", "unauthorized payment status must not be disclosed before ownership checks");

const [
  paymentCheckoutAccessSource,
  mockApiSource,
  paymentsScreenSource,
  notificationsScreenSource,
  dashboardScreenSource,
  checkoutScreenSource,
  checkoutPageSource,
] = await Promise.all([
  readFile("src/lib/payment-checkout-access.ts", "utf8"),
  readFile("src/lib/mock-api.ts", "utf8"),
  readFile("src/components/screens/payments-screen.tsx", "utf8"),
  readFile("src/components/screens/notifications-screen.tsx", "utf8"),
  readFile("src/components/screens/dashboard-screen.tsx", "utf8"),
  readFile("src/components/screens/payment-checkout-screen.tsx", "utf8"),
  readFile("src/app/(app)/app/payments/checkout/page.tsx", "utf8"),
]);
const paymentNotificationTargetSource = notificationsScreenSource.slice(
  notificationsScreenSource.indexOf("function paymentNotificationTarget"),
  notificationsScreenSource.indexOf("function buildPaymentNotification"),
);

assert(
  mockApiSource.includes("member.guardianIds.includes(user.id)") &&
    mockApiSource.includes("childMemberIds.has(member.id)"),
  "guardian data scope must enforce bidirectional guardian-child links before returning payments",
);
assert(
    paymentsScreenSource.includes("guardianPaymentChildren") &&
    paymentsScreenSource.includes("prioritizedGuardianPaymentChild") &&
    paymentsScreenSource.includes("selectedGuardianPaymentChildId") &&
    paymentsScreenSource.includes("<ChildSwitcher") &&
    paymentsScreenSource.includes("scopedPayments") &&
    paymentsScreenSource.includes("data.filter((payment) => payment.memberId === selectedGuardianPaymentChildId)") &&
    paymentsScreenSource.includes("${selectedGuardianPaymentChild.name} 결제 내역이 없습니다"),
  "guardian payments screen must expose child switching and filter payment cards/counts to the selected child",
);
assert(
  paymentsScreenSource.includes("/app/payments/checkout?paymentId="),
  "payment cards must route to the internal checkout preparation page",
);
assert(
  paymentsScreenSource.includes("member-payment-checkout-action"),
  "family payment cards must render a checkout action affordance",
);
assert(
  paymentsScreenSource.includes("{familyCheckoutAccess.label}") && !paymentsScreenSource.includes("결제하기"),
  "family payment card action copy must come from the shared checkout access label and avoid live payment wording",
);
assert(
  paymentsScreenSource.includes("member-payment-checkout-state-badge"),
  "family payment cards must render blocked checkout states as passive badges",
);
assert(
  paymentsScreenSource.includes("inline-flex h-8 min-w-[104px]") &&
    paymentsScreenSource.includes("data-testid=\"member-payment-checkout-state-badge\""),
  "family payment blocked checkout states must stay compact passive badges",
);
assert(
  paymentsScreenSource.includes("data-payment-checkout-state"),
  "family payment cards must expose checkout state for regression checks",
);
assert(
  paymentsScreenSource.includes("familyCheckoutStateHelper") &&
    paymentsScreenSource.includes("학부모 계정에서 진행") &&
    paymentsScreenSource.includes('data-testid="member-payment-checkout-state-helper"'),
  "family payment cards must explain guardian-required checkout states inline",
);
assert(
  /data-testid="member-payment-checkout-state-helper"[\s\S]{0,180}\{familyCheckoutStateHelper\}/.test(paymentsScreenSource) &&
    !/className="sr-only"[\s\S]{0,120}data-testid="member-payment-checkout-state-helper"/.test(paymentsScreenSource),
  "family payment guardian-required helper must remain visible, not screen-reader-only",
);
assert(
  paymentCheckoutAccessSource.includes("getFamilyPaymentPlanLine") &&
    paymentCheckoutAccessSource.includes("planNameAgePrefixes") &&
    paymentCheckoutAccessSource.includes("familyPaymentAgeGroupLabels[ageGroup]") &&
    paymentsScreenSource.includes('data-testid="member-payment-plan-line"') &&
    paymentsScreenSource.includes("${payment.member.name} ${familyPaymentPlanLine} ${familyCheckoutAccess?.label}"),
  "family payment display helper must show the member age group separately from age-prefixed plan names",
);
assert(
  paymentsScreenSource.includes("getFamilyPaymentPlanLine") &&
    dashboardScreenSource.includes("personalPaymentPlanLine") &&
    dashboardScreenSource.includes("getFamilyPaymentPlanLine") &&
    notificationsScreenSource.includes("paymentPlanLine") &&
    notificationsScreenSource.includes("getFamilyPaymentPlanLine") &&
    checkoutScreenSource.includes("familyPaymentPlanLine") &&
    checkoutScreenSource.includes("getFamilyPaymentPlanLine"),
  "family payment plan display must be shared across payment list, dashboard, notifications, and checkout screens",
);
assert(
  paymentsScreenSource.includes('role={familyCheckoutCanOpen ? "link" : undefined}') &&
    paymentsScreenSource.includes("familyCheckoutCanOpen ? (") &&
    paymentsScreenSource.includes("data-testid=\"member-payment-checkout-state-badge\""),
  "family payment cards must only expose link behavior for payable checkout states",
);
assert(
  paymentsScreenSource.includes("onClick={familyCheckoutCanOpen ? () => openFamilyPaymentCheckout(payment.id) : undefined}") &&
    paymentsScreenSource.includes("handleFamilyPaymentCardKeyDown(event, payment.id)") &&
    paymentsScreenSource.includes('tabIndex={familyCheckoutCanOpen ? 0 : undefined}'),
  "payable family payment cards must open checkout preparation from the full card by click and keyboard",
);
assert(
  notificationsScreenSource.includes("getFamilyPaymentCheckoutAccess") &&
    notificationsScreenSource.includes("paymentNotificationTarget") &&
    notificationsScreenSource.includes("/app/payments/checkout?paymentId="),
  "payable family payment notifications must deep-link to checkout preparation",
);
assert(
  paymentNotificationTargetSource.includes('actionLabel: checkoutAccess.label') &&
    paymentNotificationTargetSource.includes('checkoutAccess.state === "guardian_required" ? "학부모 확인" : "납부 확인"') &&
    !paymentNotificationTargetSource.includes('actionLabel: "보기"') &&
    !notificationsScreenSource.includes("결제 진행 필요"),
  "payment notifications must split checkout action copy from non-payable confirmation fallback",
);
assert(
  dashboardScreenSource.includes("getFamilyPaymentCheckoutAccess") &&
    dashboardScreenSource.includes("personalPaymentCheckoutAccess") &&
    dashboardScreenSource.includes("personalPaymentActionHref") &&
    dashboardScreenSource.includes("/app/payments/checkout?paymentId="),
  "member and guardian dashboard payment actions must reuse family checkout access rules",
);
assert(
  dashboardScreenSource.includes("personalPaymentCheckoutAccess?.canOpen") &&
    dashboardScreenSource.includes("encodeURIComponent(personalPrimaryPayment.id)") &&
    dashboardScreenSource.includes('href: personalPaymentActionHref'),
  "dashboard payment actions must deep-link only payable family payments to checkout preparation",
);
assert(
  dashboardScreenSource.includes("personalPaymentActionStatus") &&
    dashboardScreenSource.includes("personalPaymentCheckoutAccess?.label") &&
    dashboardScreenSource.includes('status: personalPaymentActionStatus'),
  "member dashboard payment card must expose checkout state copy from the shared family rule",
);
assert(
	  checkoutScreenSource.includes("payment-checkout-ready") &&
	    checkoutScreenSource.includes("payment-checkout-unavailable") &&
	    checkoutScreenSource.includes("checkoutStateLabel") &&
	    checkoutScreenSource.includes("요청 가능"),
  "checkout screen must render ready and unavailable states with status copy instead of a detail CTA",
);
assert(
  checkoutScreenSource.includes("payment-checkout-guardian-required") &&
    checkoutScreenSource.includes('checkoutAccess.state === "guardian_required"') &&
    checkoutScreenSource.indexOf('checkoutAccess.state === "guardian_required"') < checkoutScreenSource.indexOf("getPaymentCheckoutAmount(payment)"),
  "checkout screen must hide amount details before rendering youth member direct checkout routes",
);
assert(
  checkoutScreenSource.includes("payment-checkout-forbidden") &&
    checkoutScreenSource.includes('checkoutAccess.state === "forbidden"'),
  "checkout screen must hide payment details for forbidden direct checkout routes",
);
assert(
	  checkoutScreenSource.includes("payment-checkout-provider-status") &&
	    checkoutScreenSource.includes("납부 방법 안내 상태") &&
		    checkoutScreenSource.includes("결제 정보 확인 단계") &&
	    checkoutScreenSource.includes("저장·전달되지 않습니다") &&
	    !checkoutScreenSource.includes("결제 진행하기"),
	"checkout screen must explain the request-only payment state without exposing unfinished copy",
);
assert(
  checkoutScreenSource.includes('data-testid="payment-checkout-payer-info"') &&
	    checkoutScreenSource.includes("요청자 정보") &&
    checkoutScreenSource.includes("주소검색") &&
    checkoutScreenSource.includes("휴대전화") &&
    checkoutScreenSource.includes("이메일") &&
    !checkoutScreenSource.includes('type="password"'),
  "checkout screen must collect payer contact details without asking for account passwords",
);
assert(
	  checkoutScreenSource.includes('data-testid="payment-checkout-method-section"') &&
	    checkoutScreenSource.includes("무통장입금") &&
	    checkoutScreenSource.includes("신용카드") &&
	    checkoutScreenSource.includes("가상계좌") &&
	    checkoutScreenSource.includes("계좌이체") &&
	    !checkoutScreenSource.includes('data-testid="payment-save-method-checkbox"'),
	  "checkout screen must expose selectable payment methods without pretending to persist reusable payment data",
);
assert(
  checkoutScreenSource.includes('data-testid="payment-card-issuer-grid"') &&
    checkoutScreenSource.includes("우리카드") &&
    checkoutScreenSource.includes("KB국민카드") &&
    checkoutScreenSource.includes("KDB산업체크카드") &&
    checkoutScreenSource.includes('data-testid="payment-card-installment-select"') &&
    checkoutScreenSource.includes('data-testid="payment-wooriwonpay-modal"'),
  "checkout screen must include card issuer selection, installment controls, and Woori app handoff modal",
);
assert(
  checkoutScreenSource.includes('data-testid="payment-bank-transfer-panel"') &&
    checkoutScreenSource.includes("입금은행") &&
    checkoutScreenSource.includes("입금자명") &&
    checkoutScreenSource.includes("getSelectedPaymentMethodSummary") &&
    checkoutScreenSource.includes('data-testid="payment-confirm-draft-button"'),
  "checkout screen must prepare bank transfer/card method summaries without calling a live payment provider",
);
assert(
  !checkoutScreenSource.includes("결제 연결 전") &&
    !checkoutScreenSource.includes("실 결제 연결 전") &&
	    !checkoutScreenSource.includes("결제 연동") &&
    !checkoutScreenSource.includes("온라인 결제 준비") &&
    !checkoutScreenSource.includes("온라인 결제 준비 중") &&
    !checkoutScreenSource.includes("납부 안내 대기") &&
    !checkoutScreenSource.includes("온라인 납부 방법이 열리면"),
  "checkout screen must not show unfinished payment integration copy",
);
assert(
	  checkoutScreenSource.includes("납부 안내") &&
	    checkoutScreenSource.includes("납부 요청 안내") &&
	    checkoutScreenSource.includes("실제 결제나 출금이 진행되지 않습니다."),
	  "checkout screen must make the request-only state explicit before collecting a payment method request",
);
assert(
  !checkoutScreenSource.includes("paymentStatusLabels[payment.status]") &&
    !checkoutScreenSource.includes("ShieldCheck"),
  "checkout screen must not duplicate the payment status in a bottom action row that can collide with mobile navigation",
);
assert(
  checkoutPageSource.includes("PaymentCheckoutScreen"),
  "checkout route must render the payment checkout screen",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "adult member direct checkout preparation",
        "guardian child checkout preparation",
        "guardian bidirectional child scope",
        "guardian payment child switcher scope",
        "youth member direct checkout block",
        "youth member direct checkout detail suppression",
        "forbidden direct checkout route hides payment details",
        "blocked checkout state passive badge",
        "whole-card click and keyboard checkout entry",
        "payment notification checkout entry",
        "dashboard payment checkout entry",
        "payment card route and checkout preparation page",
        "checkout page avoids duplicated bottom status row",
      ],
    },
    null,
    2,
  ),
);
