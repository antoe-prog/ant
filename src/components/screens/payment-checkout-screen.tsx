"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Landmark,
  Mail,
  MapPin,
  Phone,
  Smartphone,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useApiContext } from "@/hooks/use-api-context";
import { formatCurrency, formatDate, formatPhoneNumber } from "@/lib/format";
import {
  familyPaymentAgeGroupLabels,
  getFamilyPaymentCheckoutAccess,
  getFamilyPaymentPlanLine,
  getPaymentCheckoutAmount,
} from "@/lib/payment-checkout-access";
import { roleLabels } from "@/lib/roles";
import { ErrorState } from "@/components/ui/state-blocks";
import { PaymentStatusBadge } from "@/components/ui/primitives";

type PaymentCheckoutScreenProps = {
  paymentId: string;
};

type PaymentMethod = "bankTransfer" | "card" | "virtualAccount" | "accountTransfer";

const paymentMethods: Array<{ id: PaymentMethod; label: string; helper: string }> = [
  { id: "bankTransfer", label: "무통장입금", helper: "안내 계좌로 직접 입금" },
  { id: "card", label: "신용카드", helper: "카드사 선택 후 진행" },
  { id: "virtualAccount", label: "가상계좌", helper: "전용 입금 계좌 발급" },
  { id: "accountTransfer", label: "계좌이체", helper: "은행 앱으로 이체" },
];

const bankOptions = ["국민은행", "신한은행", "우리은행", "하나은행", "농협은행", "기업은행", "카카오뱅크", "토스뱅크"];
const installmentOptions = ["일시불", "2개월", "3개월", "6개월", "12개월"];
const cardIssuers = [
  "신한카드",
  "비씨카드",
  "우리카드",
  "KB국민카드",
  "롯데카드",
  "현대카드",
  "삼성카드",
  "NH카드",
  "하나카드",
  "씨티카드",
  "카카오뱅크",
  "광주카드",
  "전북카드",
  "수협카드",
  "제주카드",
  "신협카드",
  "우체국체크카드",
  "새마을금고",
  "저축은행카드",
  "KDB산업체크카드",
];

function splitPhoneNumber(value?: string) {
  const digits = value?.replace(/\D/g, "") ?? "";

  if (digits.length === 11) {
    return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7)] as const;
  }

  if (digits.length === 10 && digits.startsWith("02")) {
    return [digits.slice(0, 2), digits.slice(2, 6), digits.slice(6)] as const;
  }

  return ["010", "", ""] as const;
}

function compactPhone(parts: readonly string[]) {
  return parts.filter(Boolean).join("-");
}

function getSelectedPaymentMethodSummary(method: PaymentMethod, cardIssuer: string, bank: string) {
  if (method === "card") {
    return cardIssuer;
  }

  if (method === "bankTransfer") {
    return bank;
  }

  return method === "virtualAccount" ? "가상계좌" : "계좌이체";
}

export function PaymentCheckoutScreen({ paymentId }: PaymentCheckoutScreenProps) {
  const context = useApiContext();
  const payment = context.db.payments.find((candidate) => candidate.id === paymentId);
  const member = payment ? context.db.members.find((candidate) => candidate.id === payment.memberId) : undefined;
  const payerPhoneSource = context.user.phone || member?.emergencyContact;
  const defaultMobilePhoneParts = splitPhoneNumber(payerPhoneSource);
  const [payerName, setPayerName] = useState(context.user.name);
  const [payerEmail, setPayerEmail] = useState(context.user.email ?? "");
  const [zipCode, setZipCode] = useState("");
  const [baseAddress, setBaseAddress] = useState("");
  const [detailAddress, setDetailAddress] = useState("");
  const [landlinePrefix, setLandlinePrefix] = useState("02");
  const [landlineMiddle, setLandlineMiddle] = useState("");
  const [landlineLast, setLandlineLast] = useState("");
  const [mobilePrefix, setMobilePrefix] = useState(defaultMobilePhoneParts[0]);
  const [mobileMiddle, setMobileMiddle] = useState(defaultMobilePhoneParts[1]);
  const [mobileLast, setMobileLast] = useState(defaultMobilePhoneParts[2]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("card");
  const [selectedBank, setSelectedBank] = useState("우리은행");
  const [depositorName, setDepositorName] = useState(context.user.name);
  const [selectedCardIssuer, setSelectedCardIssuer] = useState("우리카드");
  const [installment, setInstallment] = useState("일시불");
  const [savePaymentInfo, setSavePaymentInfo] = useState(true);
  const [wooriPayOpen, setWooriPayOpen] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState("");

  function selectCardIssuer(issuer: string) {
    setSelectedCardIssuer(issuer);

    if (issuer === "우리카드") {
      setWooriPayOpen(true);
    }
  }

  if (!payment) {
    return <ErrorState description="결제 정보를 찾을 수 없습니다." />;
  }

  const checkoutAccess = getFamilyPaymentCheckoutAccess(context.user, payment, member);

  if (checkoutAccess.state === "forbidden") {
    return (
      <div data-testid="payment-checkout-forbidden">
        <ErrorState description="이 결제는 현재 계정에서 열 수 없습니다." title="결제 권한을 확인해 주세요" />
      </div>
    );
  }

  const branch = context.db.branches.find((candidate) => candidate.id === payment.branchId);

  if (!member || !branch) {
    return <ErrorState description="결제 대상 정보를 확인할 수 없습니다." />;
  }

  const familyPaymentPlanLine = getFamilyPaymentPlanLine(payment.planName, member.ageGroup);

  if (checkoutAccess.state === "guardian_required") {
    return (
      <div className="mx-auto max-w-2xl" data-testid="payment-checkout-guardian-required">
        <div className="mb-3">
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            href="/app/payments"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            목록
          </Link>
        </div>

        <section className="rounded-lg border border-amber-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-700">학부모 확인</p>
              <h1 className="mt-1 break-words text-xl font-semibold tracking-normal text-zinc-950">
                {checkoutAccess.label}
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-700">{checkoutAccess.reason}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                {member.name} · {familyPaymentPlanLine} · {branch.name}
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const checkoutAmount = getPaymentCheckoutAmount(payment);
  const canPrepareCheckout = checkoutAccess.canOpen;
  const checkoutStateLabel = checkoutAccess.state === "ready" ? "결제 대상" : checkoutAccess.label;

  return (
    <div className="mx-auto max-w-2xl" data-testid="payment-checkout-page">
      <div className="mb-3">
        <Link
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          href="/app/payments"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          목록
        </Link>
      </div>

      <section
        className={`rounded-lg border bg-white p-4 ${
          canPrepareCheckout ? "border-teal-200" : "border-amber-200"
        }`}
        data-testid={canPrepareCheckout ? "payment-checkout-ready" : "payment-checkout-unavailable"}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-500">납부 안내</p>
            <h1 className="mt-1 break-words text-2xl font-semibold tracking-normal text-zinc-950">
              {familyPaymentPlanLine}
            </h1>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              {member.name} · {branch.name}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${
              canPrepareCheckout
                ? "border-teal-200 bg-teal-50 text-teal-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {canPrepareCheckout ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            )}
            {checkoutStateLabel}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-xs font-semibold text-zinc-500">결제 금액</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{formatCurrency(checkoutAmount)}</p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-xs font-semibold text-zinc-500">상태</p>
            <div className="mt-1">
              <PaymentStatusBadge status={payment.status} />
            </div>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-xs font-semibold text-zinc-500">대상</p>
            <p className="mt-1 text-sm font-semibold text-zinc-950">
              {familyPaymentAgeGroupLabels[member.ageGroup]} · {roleLabels[context.user.role]}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-xs font-semibold text-zinc-500">기간</p>
            <p className="mt-1 text-sm font-semibold text-zinc-950">
              납부 {formatDate(payment.dueDate)} · 만료 {formatDate(payment.expiresAt)}
            </p>
          </div>
        </div>

        {(payment.discountAmount ?? 0) > 0 || (payment.refundedAmount ?? 0) > 0 ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-700">
            {(payment.discountAmount ?? 0) > 0 ? (
              <span className="font-medium text-teal-700">할인 {formatCurrency(payment.discountAmount ?? 0)}</span>
            ) : null}
            {(payment.refundedAmount ?? 0) > 0 ? (
              <span className="ml-3 font-medium text-red-700">환불 {formatCurrency(payment.refundedAmount ?? 0)}</span>
            ) : null}
          </div>
        ) : null}

        <div
          className={`mt-4 rounded-md border px-3 py-2 text-sm font-medium leading-6 ${
            canPrepareCheckout
              ? "border-teal-200 bg-teal-50 text-teal-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {checkoutAccess.reason}
        </div>

        <section className="mt-4 min-w-0 rounded-md border border-zinc-200 bg-white" data-testid="payment-checkout-payer-info">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <UserRound className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
              <h2 className="text-sm font-semibold text-zinc-950">결제자 정보</h2>
            </div>
            <span className="text-xs font-semibold text-red-600">필수 입력</span>
          </div>

          <div className="grid min-w-0 gap-3 p-3">
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-zinc-700">
              이름
              <input
                className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                data-testid="payment-payer-name-input"
                value={payerName}
                onChange={(event) => setPayerName(event.target.value)}
              />
            </label>

            <div className="grid min-w-0 gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-700">
                <MapPin className="h-4 w-4 text-zinc-500" aria-hidden />
                주소
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  aria-label="우편번호"
                  className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  placeholder="우편번호"
                  value={zipCode}
                  onChange={(event) => setZipCode(event.target.value)}
                />
                <button
                  className="min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
                  type="button"
                  onClick={() => {
                    setZipCode("06164");
                    setBaseAddress("서울 강남구 테헤란로");
                  }}
                >
                  주소검색
                </button>
              </div>
              <input
                aria-label="기본주소"
                className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                placeholder="기본주소"
                value={baseAddress}
                onChange={(event) => setBaseAddress(event.target.value)}
              />
              <input
                aria-label="상세주소"
                className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                placeholder="나머지 주소"
                value={detailAddress}
                onChange={(event) => setDetailAddress(event.target.value)}
              />
            </div>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="grid min-w-0 gap-1.5">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-700">
                  <Phone className="h-4 w-4 text-zinc-500" aria-hidden />
                  일반전화
                </div>
                <div className="grid min-w-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5">
                  <select
                    aria-label="일반전화 앞자리"
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    value={landlinePrefix}
                    onChange={(event) => setLandlinePrefix(event.target.value)}
                  >
                    {["02", "031", "032", "051", "053", "062", "선택"].map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                  <input
                    aria-label="일반전화 가운데자리"
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    inputMode="numeric"
                    value={landlineMiddle}
                    onChange={(event) => setLandlineMiddle(event.target.value)}
                  />
                  <input
                    aria-label="일반전화 끝자리"
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    inputMode="numeric"
                    value={landlineLast}
                    onChange={(event) => setLandlineLast(event.target.value)}
                  />
                </div>
              </div>

              <div className="grid min-w-0 gap-1.5">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-700">
                  <Smartphone className="h-4 w-4 text-zinc-500" aria-hidden />
                  휴대전화
                </div>
                <div className="grid min-w-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5">
                  <select
                    aria-label="휴대전화 앞자리"
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    value={mobilePrefix}
                    onChange={(event) => setMobilePrefix(event.target.value)}
                  >
                    {["010", "011", "016", "017", "018", "019"].map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                  <input
                    aria-label="휴대전화 가운데자리"
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    data-testid="payment-payer-phone-middle-input"
                    inputMode="numeric"
                    value={mobileMiddle}
                    onChange={(event) => setMobileMiddle(event.target.value)}
                  />
                  <input
                    aria-label="휴대전화 끝자리"
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    data-testid="payment-payer-phone-last-input"
                    inputMode="numeric"
                    value={mobileLast}
                    onChange={(event) => setMobileLast(event.target.value)}
                  />
                </div>
              </div>
            </div>

            <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-zinc-700">
              <span className="flex min-w-0 items-center gap-2">
                <Mail className="h-4 w-4 text-zinc-500" aria-hidden />
                이메일
              </span>
              <input
                className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                data-testid="payment-payer-email-input"
                inputMode="email"
                placeholder="example@finaljudo.kr"
                value={payerEmail}
                onChange={(event) => setPayerEmail(event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="mt-4 min-w-0 rounded-md border border-zinc-200 bg-white" data-testid="payment-checkout-method-section">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <WalletCards className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
              <h2 className="text-sm font-semibold text-zinc-950">결제수단</h2>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          </div>

          <div className="grid min-w-0 gap-3 p-3">
            <div className="grid gap-2" role="radiogroup" aria-label="결제수단 선택">
              {paymentMethods.map((method) => (
                <label
                  className={`flex min-h-12 cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition ${
                    selectedPaymentMethod === method.id
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300"
                  }`}
                  data-testid={`payment-method-radio-${method.id}`}
                  key={method.id}
                >
                  <input
                    className="mt-1 h-4 w-4 accent-teal-600"
                    checked={selectedPaymentMethod === method.id}
                    name="payment-method"
                    type="radio"
                    onChange={() => setSelectedPaymentMethod(method.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{method.label}</span>
                    <span
                      className={`mt-0.5 block text-xs leading-5 ${
                        selectedPaymentMethod === method.id ? "text-zinc-200" : "text-zinc-500"
                      }`}
                    >
                      {method.helper}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {selectedPaymentMethod === "bankTransfer" ? (
              <div className="grid min-w-0 gap-3 border-l-2 border-zinc-200 pl-3" data-testid="payment-bank-transfer-panel">
                <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-zinc-700">
                  입금은행
                  <select
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    value={selectedBank}
                    onChange={(event) => setSelectedBank(event.target.value)}
                  >
                    {bankOptions.map((bank) => (
                      <option key={bank}>{bank}</option>
                    ))}
                  </select>
                </label>
                <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-zinc-700">
                  입금자명
                  <input
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    value={depositorName}
                    onChange={(event) => setDepositorName(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {selectedPaymentMethod === "card" ? (
              <div className="grid min-w-0 gap-3 border-l-2 border-zinc-200 pl-3" data-testid="payment-card-panel">
                <div className="grid min-w-0 gap-2">
                  <p className="text-sm font-semibold text-zinc-700">카드선택</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="payment-card-issuer-grid">
                    {cardIssuers.map((issuer) => (
                      <button
                        className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border px-2 text-center text-xs font-semibold transition ${
                          selectedCardIssuer === issuer
                            ? "border-teal-500 bg-teal-50 text-teal-900"
                            : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50"
                        }`}
                        data-testid={issuer === "우리카드" ? "payment-card-issuer-woori" : undefined}
                        key={issuer}
                        type="button"
                        aria-pressed={selectedCardIssuer === issuer}
                        onClick={() => selectCardIssuer(issuer)}
                      >
                        <CreditCard className="h-4 w-4" aria-hidden />
                        <span className="break-keep leading-4">{issuer}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-zinc-700">
                  할부기간
                  <select
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    data-testid="payment-card-installment-select"
                    value={installment}
                    onChange={(event) => setInstallment(event.target.value)}
                  >
                    {installmentOptions.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-2 sm:grid-cols-3" aria-label="결제 안내">
                  {["공인인증서 발급안내", "안심클릭안내", "안전결제 안내"].map((label) => (
                    <button
                      className="min-h-10 rounded-md border border-zinc-300 bg-zinc-50 px-2 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-100"
                      key={label}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedPaymentMethod === "virtualAccount" || selectedPaymentMethod === "accountTransfer" ? (
              <div
                className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm leading-6 text-zinc-700"
                data-testid="payment-account-method-panel"
              >
                <div className="flex items-center gap-2 font-semibold text-zinc-900">
                  {selectedPaymentMethod === "virtualAccount" ? (
                    <Landmark className="h-4 w-4 text-zinc-600" aria-hidden />
                  ) : (
                    <Building2 className="h-4 w-4 text-zinc-600" aria-hidden />
                  )}
                  {selectedPaymentMethod === "virtualAccount" ? "가상계좌 안내" : "계좌이체 안내"}
                </div>
                <p className="text-xs leading-5 text-zinc-500">
                  선택한 납부 정보는 저장만 되며, 운영 결제 설정이 완료된 뒤 전용 화면으로 이어집니다.
                </p>
              </div>
            ) : null}

            <label className="flex min-h-11 items-center gap-2 border-t border-zinc-100 pt-3 text-sm font-medium text-zinc-700">
              <input
                className="h-4 w-4 rounded border-zinc-300 accent-teal-600"
                checked={savePaymentInfo}
                data-testid="payment-save-method-checkbox"
                type="checkbox"
                onChange={(event) => setSavePaymentInfo(event.target.checked)}
              />
              결제수단과 입력정보를 다음에도 사용
            </label>
          </div>
        </section>

        <div className="mt-4 grid gap-2">
          <button
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-zinc-950 bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="payment-confirm-draft-button"
            disabled={!payerName.trim() || !mobileMiddle.trim() || !mobileLast.trim()}
            type="button"
            onClick={() =>
              setConfirmationMessage(
                `${payerName.trim()}님 ${formatPhoneNumber(compactPhone([mobilePrefix, mobileMiddle, mobileLast]))} 정보로 ${getSelectedPaymentMethodSummary(
                  selectedPaymentMethod,
                  selectedCardIssuer,
                  selectedBank,
                )} 납부 요청을 준비했습니다.`,
              )
            }
          >
            <CreditCard className="h-4 w-4" aria-hidden />
            결제 진행하기
          </button>
          {confirmationMessage ? (
            <p
              className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium leading-6 text-teal-900"
              data-testid="payment-confirm-feedback"
            >
              {confirmationMessage}
            </p>
          ) : null}
        </div>

        <div
          aria-label="납부 방법 안내 상태"
          className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
          data-testid="payment-checkout-provider-status"
        >
          <CreditCard className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold text-zinc-800">납부 방법 안내</p>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500">
              도장에서 안내한 납부 방법을 확인한 뒤 진행해 주세요.
            </p>
          </div>
        </div>
      </section>

      {wooriPayOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          data-testid="payment-wooriwonpay-modal"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-md bg-white shadow-xl">
            <div className="flex min-h-12 items-center justify-between border-b border-zinc-100 px-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                <CreditCard className="h-4 w-4" aria-hidden />
                우리카드 X 우리은행
              </div>
              <button
                aria-label="우리WON페이 닫기"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100"
                data-testid="payment-wooriwonpay-close"
                type="button"
                onClick={() => setWooriPayOpen(false)}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-2 border-b border-zinc-100 text-sm font-semibold">
              <button className="min-h-12 border-b-2 border-blue-600 text-blue-700" type="button">
                우리WON페이
              </button>
              <button className="min-h-12 text-zinc-500" type="button">
                다른결제
              </button>
            </div>
            <div className="p-5">
              <h3 className="text-lg font-semibold leading-7 text-zinc-950">우리WON페이로 빠르고 간편하게 결제</h3>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {["우리카드 앱", "우리은행 앱"].map((label) => (
                  <button
                    className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-center text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                    key={label}
                    type="button"
                    onClick={() => setWooriPayOpen(false)}
                  >
                    <Smartphone className="h-6 w-6" aria-hidden />
                    <span>{label}</span>
                    <span className="text-xs font-medium text-zinc-500">우리WON페이 결제</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
