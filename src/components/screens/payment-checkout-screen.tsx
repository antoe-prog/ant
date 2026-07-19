"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
import { formatCurrency, formatDate, formatDateTime, formatPhoneNumber } from "@/lib/format";
import { familyPaymentRequestInputLimits } from "@/lib/family-payment-request-policy";
import {
  familyPaymentAgeGroupLabels,
  getFamilyPaymentCheckoutAccess,
  getFamilyPaymentPlanLine,
  getPaymentCheckoutAmount,
} from "@/lib/payment-checkout-access";
import { roleLabels } from "@/lib/roles";
import { useAppStore } from "@/store/app-store";
import { ErrorState } from "@/components/ui/state-blocks";
import { PaymentStatusBadge } from "@/components/ui/primitives";

type PaymentCheckoutScreenProps = {
  initialPaymentMethod?: string;
  paymentId: string;
};

const paymentMethodIds = ["bankTransfer", "card", "virtualAccount", "accountTransfer"] as const;
type PaymentMethod = (typeof paymentMethodIds)[number];

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
const manualAddressEntryMessage = "우편번호와 주소를 직접 입력해 주세요.";

function getInitialPaymentMethod(value?: string): PaymentMethod {
  return paymentMethodIds.find((method) => method === value) ?? "card";
}

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

function getSelectedPaymentMethodSummary(method: PaymentMethod, cardIssuer: string, bank: string) {
  if (method === "card") {
    return cardIssuer;
  }

  if (method === "bankTransfer") {
    return bank;
  }

  return method === "virtualAccount" ? "가상계좌" : "계좌이체";
}

export function PaymentCheckoutScreen({ initialPaymentMethod, paymentId }: PaymentCheckoutScreenProps) {
  const context = useApiContext();
  const { createFamilyPaymentRequest } = useAppStore();
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
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>(
    getInitialPaymentMethod(initialPaymentMethod),
  );
  const [selectedBank, setSelectedBank] = useState("우리은행");
  const [depositorName, setDepositorName] = useState(context.user.name);
  const [selectedCardIssuer, setSelectedCardIssuer] = useState("우리카드");
  const [installment, setInstallment] = useState("일시불");
  const [payerOptionalOpen, setPayerOptionalOpen] = useState(false);
  const [wooriPayOpen, setWooriPayOpen] = useState(false);
  const [wooriPayTab, setWooriPayTab] = useState<"primary" | "other">("primary");
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const [confirmedInputFingerprint, setConfirmedInputFingerprint] = useState("");
  const [collectionRequestError, setCollectionRequestError] = useState("");
  const [requestPending, setRequestPending] = useState(false);
  const [cardGuideMessage, setCardGuideMessage] = useState("");
  const [addressSearchMessage, setAddressSearchMessage] = useState("");
  const wooriPayDialogRef = useRef<HTMLDivElement>(null);
  const wooriPayPrimaryTabRef = useRef<HTMLButtonElement>(null);
  const wooriPayOtherTabRef = useRef<HTMLButtonElement>(null);

  const mobilePhoneDigits = `${mobilePrefix}${mobileMiddle}${mobileLast}`.replace(/\D/g, "");
  const mobilePhoneValid = /^01\d{8,9}$/.test(mobilePhoneDigits);
  const inputFingerprint = [
    payerName,
    payerEmail,
    zipCode,
    baseAddress,
    detailAddress,
    landlinePrefix,
    landlineMiddle,
    landlineLast,
    mobilePrefix,
    mobileMiddle,
    mobileLast,
    selectedPaymentMethod,
    selectedBank,
    depositorName,
    selectedCardIssuer,
    installment,
  ].join("\u001f");
  const confirmationIsCurrent = Boolean(confirmationMessage && confirmedInputFingerprint === inputFingerprint);

  async function handleCreateCollectionRequest() {
    if (!payerName.trim() || !mobilePhoneValid || requestPending) {
      return;
    }

    setRequestPending(true);
    setCollectionRequestError("");
    const ok = await createFamilyPaymentRequest(paymentId, {
      method: selectedPaymentMethod,
      methodLabel: getSelectedPaymentMethodSummary(selectedPaymentMethod, selectedCardIssuer, selectedBank),
      payerName: payerName.trim(),
      payerPhone: mobilePhoneDigits,
    });
    setRequestPending(false);

    if (!ok) {
      setCollectionRequestError("납부 요청을 접수하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.");
      return;
    }

    setConfirmedInputFingerprint(inputFingerprint);
    setCollectionRequestError("");
    setConfirmationMessage("납부 요청을 접수했습니다. 담당자가 확인한 뒤 안내합니다.");
  }

  useEffect(() => {
    if (window.location.hash === "#payment-payer-address") {
      const openFrame = requestAnimationFrame(() => {
        setPayerOptionalOpen(true);
        setAddressSearchMessage(manualAddressEntryMessage);

        requestAnimationFrame(() => {
          document.getElementById("payment-payer-address")?.scrollIntoView({ block: "center" });
        });
      });
      return () => cancelAnimationFrame(openFrame);
    }

    if (window.location.hash === "#payment-checkout-provider-status") {
      requestAnimationFrame(() => {
        document.getElementById("payment-checkout-provider-status")?.scrollIntoView({ block: "center" });
      });
    }

    if (window.location.hash === "#payment-account-method-panel") {
      requestAnimationFrame(() => {
        document.getElementById("payment-account-method-panel")?.scrollIntoView({ block: "center" });
      });
    }

    if (window.location.hash === "#payment-wooriwonpay-modal") {
      requestAnimationFrame(() => {
        setSelectedPaymentMethod("card");
        setSelectedCardIssuer("우리카드");
        setWooriPayTab("primary");
        setWooriPayOpen(true);
      });
    }
  }, []);

  useEffect(() => {
    if (!wooriPayOpen) {
      return;
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      wooriPayPrimaryTabRef.current?.focus();
    }, 0);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setWooriPayOpen(false);
        return;
      }

      if (event.key !== "Tab" || !wooriPayDialogRef.current) {
        return;
      }

      const focusable = Array.from(
        wooriPayDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [wooriPayOpen]);

  function selectCardIssuer(issuer: string) {
    setSelectedCardIssuer(issuer);

    if (issuer === "우리카드") {
      setWooriPayTab("primary");
      setWooriPayOpen(true);
    }
  }

  function handleWooriPayTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const nextTab =
      event.key === "ArrowRight" || event.key === "End"
        ? "other"
        : event.key === "ArrowLeft" || event.key === "Home"
          ? "primary"
          : null;

    if (!nextTab) {
      return;
    }

    event.preventDefault();
    (nextTab === "primary" ? wooriPayPrimaryTabRef.current : wooriPayOtherTabRef.current)?.focus();
    setWooriPayTab(nextTab);
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

  if (checkoutAccess.state === "pending" && payment.collectionRequest) {
    return (
      <div className="mx-auto max-w-2xl" data-testid="payment-collection-request-pending">
        <div className="mb-3">
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            href="/app/payments"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            목록
          </Link>
        </div>
        <section className="rounded-lg border border-teal-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-teal-700">접수 완료</p>
              <h1 className="mt-1 text-xl font-semibold text-zinc-950">납부 요청을 확인하고 있습니다</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {member.name} · {branch.name} · {payment.collectionRequest.methodLabel}
              </p>
            </div>
          </div>
          <dl className="mt-4 grid gap-2 rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-zinc-500">요청자</dt>
              <dd className="mt-1 font-semibold text-zinc-900">{payment.collectionRequest.payerName}</dd>
            </div>
            {payment.collectionRequest.payerPhone ? (
              <div>
                <dt className="text-xs font-semibold text-zinc-500">연락처</dt>
                <dd className="mt-1 font-semibold text-zinc-900">{formatPhoneNumber(payment.collectionRequest.payerPhone)}</dd>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-zinc-500">접수 시각</dt>
              <dd className="mt-1 font-semibold text-zinc-900">{formatDateTime(payment.collectionRequest.requestedAt)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            실제 결제나 출금은 진행되지 않았습니다. 담당자가 확인 후 안내합니다.
          </p>
        </section>
      </div>
    );
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
  const checkoutStateLabel = checkoutAccess.state === "ready" ? "요청 가능" : checkoutAccess.label;

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
        <div data-testid="payment-checkout-summary">
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

          <dl
            className="mt-3 grid grid-cols-2 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
            data-testid="payment-checkout-summary-grid"
          >
            <div className="grid min-h-14 gap-1 border-r border-b border-zinc-200 px-3 py-2">
              <dt className="text-xs font-semibold text-zinc-500">금액</dt>
              <dd className="min-w-0 text-right text-lg font-semibold tabular-nums text-zinc-950">
                {formatCurrency(checkoutAmount)}
              </dd>
            </div>
            <div className="grid min-h-14 gap-1 border-b border-zinc-200 px-3 py-2">
              <dt className="text-xs font-semibold text-zinc-500">상태</dt>
              <dd className="min-w-0 text-right">
                <PaymentStatusBadge status={payment.status} />
              </dd>
            </div>
            <div className="grid min-h-14 gap-1 border-r border-zinc-200 px-3 py-2">
              <dt className="text-xs font-semibold text-zinc-500">대상</dt>
              <dd className="min-w-0 text-right text-sm font-semibold text-zinc-950">
                {familyPaymentAgeGroupLabels[member.ageGroup]} · {roleLabels[context.user.role]}
              </dd>
            </div>
            <div className="grid min-h-14 gap-1 px-3 py-2">
              <dt className="text-xs font-semibold text-zinc-500">기간</dt>
              <dd className="min-w-0 break-keep text-right text-xs font-semibold leading-5 text-zinc-950">
                납부 {formatDate(payment.dueDate)} · 만료 {formatDate(payment.expiresAt)}
              </dd>
            </div>
          </dl>
        </div>

        {canPrepareCheckout ? (
          <div
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900"
            data-testid="payment-checkout-preview-notice"
            role="note"
          >
            <p className="font-semibold">납부 요청 안내</p>
            <p className="mt-0.5 text-xs leading-5">
              지금은 실제 결제나 출금이 진행되지 않습니다. 희망 납부 방법을 접수하면 담당자가 확인 후 안내합니다.
            </p>
          </div>
        ) : null}

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

        <p
          className={`mt-2 text-sm font-medium leading-6 ${
            canPrepareCheckout ? "text-teal-900" : "text-amber-900"
          }`}
        >
          {checkoutAccess.reason}
        </p>

        <section className="mt-3 min-w-0 rounded-md border border-zinc-200 bg-white" data-testid="payment-checkout-payer-info">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <UserRound className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
              <h2 className="text-sm font-semibold text-zinc-950">요청자 정보</h2>
            </div>
            <span className="text-xs font-semibold text-red-600">이름·휴대전화 필수</span>
          </div>

          <div className="grid min-w-0 gap-2 p-3">
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-zinc-700">
              이름
              <input
                className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                data-testid="payment-payer-name-input"
                maxLength={familyPaymentRequestInputLimits.payerNameLength}
                value={payerName}
                onChange={(event) => setPayerName(event.target.value)}
              />
            </label>

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
                  maxLength={4}
                  value={mobileMiddle}
                  onChange={(event) => setMobileMiddle(event.target.value)}
                />
                <input
                  aria-label="휴대전화 끝자리"
                  className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  data-testid="payment-payer-phone-last-input"
                  inputMode="numeric"
                  maxLength={4}
                  value={mobileLast}
                  onChange={(event) => setMobileLast(event.target.value)}
                />
              </div>
            </div>

            <button
              aria-expanded={payerOptionalOpen}
              className="inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
              data-testid="payment-payer-optional-toggle"
              type="button"
              onClick={() => setPayerOptionalOpen((open) => !open)}
            >
              <span className="min-w-0 truncate">주소·이메일 추가</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-zinc-500 transition ${payerOptionalOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>

            {payerOptionalOpen ? (
              <div
                className="grid min-w-0 gap-3 border-t border-zinc-100 pt-3"
                data-testid="payment-payer-optional-details"
              >
                <div className="grid min-w-0 gap-2" id="payment-payer-address">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-700">
                    <MapPin className="h-4 w-4 text-zinc-500" aria-hidden />
                    주소
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                    <input
                      aria-label="우편번호"
                      className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                      data-testid="payment-payer-zip-input"
                      placeholder="우편번호"
                      value={zipCode}
                      onChange={(event) => setZipCode(event.target.value)}
                    />
                    <button
                      className="min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
                      data-testid="payment-payer-address-search"
                      type="button"
                      onClick={() => setAddressSearchMessage(manualAddressEntryMessage)}
                    >
                      주소검색
                    </button>
                  </div>
                  {addressSearchMessage ? (
                    <p
                      aria-live="polite"
                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-900"
                      data-testid="payment-payer-address-search-feedback"
                    >
                      {addressSearchMessage}
                    </p>
                  ) : null}
                  <input
                    aria-label="기본주소"
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    data-testid="payment-payer-base-address-input"
                    placeholder="기본주소"
                    value={baseAddress}
                    onChange={(event) => setBaseAddress(event.target.value)}
                  />
                  <input
                    aria-label="상세주소"
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    data-testid="payment-payer-detail-address-input"
                    placeholder="나머지 주소"
                    value={detailAddress}
                    onChange={(event) => setDetailAddress(event.target.value)}
                  />
                </div>

                <div className="grid min-w-0 gap-1.5">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-700">
                    <Phone className="h-4 w-4 text-zinc-500" aria-hidden />
                    일반전화
                  </div>
                  <div className="grid min-w-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5">
                    <select
                      aria-label="일반전화 앞자리"
                      className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                      data-testid="payment-payer-landline-prefix"
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

                <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-zinc-700">
                  <span className="flex min-w-0 items-center gap-2">
                    <Mail className="h-4 w-4 text-zinc-500" aria-hidden />
                    이메일
                  </span>
                  <input
                    className="min-h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    data-testid="payment-payer-email-input"
                    inputMode="email"
                    placeholder="이메일 주소 입력"
                    value={payerEmail}
                    onChange={(event) => setPayerEmail(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-2 min-w-0 rounded-md border border-zinc-200 bg-white" data-testid="payment-checkout-method-section">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <WalletCards className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
              <h2 className="text-sm font-semibold text-zinc-950">희망 납부 방법</h2>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          </div>

          <div className="grid min-w-0 gap-3 p-3">
            <div className="grid gap-2" role="radiogroup" aria-label="희망 납부 방법 선택">
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
                      aria-pressed={cardGuideMessage.startsWith(label)}
                      className="min-h-11 rounded-md border border-zinc-300 bg-zinc-50 px-2 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-100"
                      data-testid="payment-card-guide-button"
                      key={label}
                      type="button"
                      onClick={() =>
                        setCardGuideMessage(
                          `${label}: 카드사 또는 은행 앱의 안내를 확인해 주세요. 이 화면에서는 인증이나 결제가 진행되지 않습니다.`,
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {cardGuideMessage ? (
                  <p
                    className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium leading-5 text-blue-900"
                    data-testid="payment-card-guide-feedback"
                    role="status"
                  >
                    {cardGuideMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            {selectedPaymentMethod === "virtualAccount" || selectedPaymentMethod === "accountTransfer" ? (
              <div
                className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm leading-6 text-zinc-700"
                data-testid="payment-account-method-panel"
                id="payment-account-method-panel"
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
                  선택한 납부 방식은 이 화면에서만 확인할 수 있습니다. 실제 입금·인증 절차는 도장 안내 후 진행합니다.
                </p>
              </div>
            ) : null}

          </div>
        </section>

        <div className="mt-4 grid gap-2">
          <button
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-zinc-950 bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="payment-confirm-draft-button"
            disabled={!payerName.trim() || !mobilePhoneValid}
            type="button"
            onClick={() => {
              setCollectionRequestError("");
              setConfirmedInputFingerprint(inputFingerprint);
              setConfirmationMessage(
                `${payerName.trim()}님 ${formatPhoneNumber(mobilePhoneDigits)} 정보와 ${getSelectedPaymentMethodSummary(
                  selectedPaymentMethod,
                  selectedCardIssuer,
                  selectedBank,
                )} 선택 내용을 확인했습니다. 이 정보는 아직 저장되거나 담당자에게 전달되지 않으며 실제 결제나 출금도 진행되지 않습니다.`,
              );
            }}
          >
            <CreditCard className="h-4 w-4" aria-hidden />
            입력 내용 확인
          </button>
          {!mobilePhoneValid && (mobileMiddle || mobileLast) ? (
            <p className="text-xs font-medium text-red-600" role="alert">
              휴대전화 번호를 확인해 주세요.
            </p>
          ) : null}
          {confirmationMessage ? (
            <p
              aria-live="polite"
              className={`rounded-md border px-3 py-2 text-sm font-medium leading-6 ${
                confirmationIsCurrent
                  ? "border-teal-200 bg-teal-50 text-teal-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
              data-confirmation-state={confirmationIsCurrent ? "current" : "changed"}
              data-testid="payment-confirm-feedback"
              id="payment-confirm-feedback"
              role="status"
            >
              {confirmationIsCurrent ? confirmationMessage : "입력 내용이 변경되었습니다. 현재 내용으로 다시 확인해 주세요."}
            </p>
          ) : null}
          {confirmationIsCurrent ? (
            <button
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-teal-700 bg-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="payment-collection-request-submit"
              disabled={requestPending}
              type="button"
              onClick={() => void handleCreateCollectionRequest()}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {requestPending ? "접수 중" : "납부 요청 접수"}
            </button>
          ) : null}
          {collectionRequestError ? (
            <div
              aria-live="assertive"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm font-medium leading-6 text-red-700"
              data-testid="payment-collection-request-error"
              role="alert"
            >
              <p>{collectionRequestError}</p>
              <p className="mt-1 text-xs">입력 내용은 유지되었습니다. 같은 내용으로 다시 접수할 수 있습니다.</p>
            </div>
          ) : null}
        </div>

        <div
          aria-label="납부 방법 안내 상태"
          className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
          data-testid="payment-checkout-provider-status"
          id="payment-checkout-provider-status"
        >
          <CreditCard className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold text-zinc-800">결제 정보 확인 단계</p>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500">
              현재 입력 내용은 확인용이며 저장·전달되지 않습니다.
            </p>
          </div>
        </div>
      </section>

      {wooriPayOpen ? (
        <div
          aria-labelledby="payment-wooriwonpay-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          data-testid="payment-wooriwonpay-modal"
          role="dialog"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setWooriPayOpen(false);
            }
          }}
        >
          <div
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-md bg-white shadow-xl"
            data-testid="payment-wooriwonpay-panel"
            ref={wooriPayDialogRef}
          >
            <div className="flex min-h-12 items-center justify-between border-b border-zinc-100 px-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-700" id="payment-wooriwonpay-title">
                <CreditCard className="h-4 w-4" aria-hidden />
                우리카드 X 우리은행
              </div>
              <button
                aria-label="우리WON페이 닫기"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100"
                data-testid="payment-wooriwonpay-close"
                type="button"
                onClick={() => setWooriPayOpen(false)}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-2 border-b border-zinc-100 text-sm font-semibold" role="tablist" aria-label="우리WON페이 결제 방식">
              <button
                aria-controls="payment-wooriwonpay-primary-panel"
                aria-selected={wooriPayTab === "primary"}
                className={`min-h-12 border-b-2 ${wooriPayTab === "primary" ? "border-blue-600 text-blue-700" : "border-transparent text-zinc-500"}`}
                data-testid="payment-wooriwonpay-tab-primary"
                id="payment-wooriwonpay-tab-primary"
                ref={wooriPayPrimaryTabRef}
                role="tab"
                tabIndex={wooriPayTab === "primary" ? 0 : -1}
                type="button"
                onKeyDown={handleWooriPayTabKeyDown}
                onClick={() => setWooriPayTab("primary")}
              >
                우리WON페이
              </button>
              <button
                aria-controls="payment-wooriwonpay-other-panel"
                aria-selected={wooriPayTab === "other"}
                className={`min-h-12 border-b-2 ${wooriPayTab === "other" ? "border-blue-600 text-blue-700" : "border-transparent text-zinc-500"}`}
                data-testid="payment-wooriwonpay-tab-secondary"
                id="payment-wooriwonpay-tab-secondary"
                ref={wooriPayOtherTabRef}
                role="tab"
                tabIndex={wooriPayTab === "other" ? 0 : -1}
                type="button"
                onKeyDown={handleWooriPayTabKeyDown}
                onClick={() => setWooriPayTab("other")}
              >
                다른 수단
              </button>
            </div>
            <div
              className="p-5"
              hidden={wooriPayTab !== "primary"}
              id="payment-wooriwonpay-primary-panel"
              aria-labelledby="payment-wooriwonpay-tab-primary"
              role="tabpanel"
            >
              <h3 className="text-lg font-semibold leading-7 text-zinc-950">우리WON페이 선택을 확인합니다</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-600">앱 선택은 입력 내용 확인에만 사용됩니다.</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {["우리카드 앱", "우리은행 앱"].map((label) => (
                  <button
                    className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-center text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                    data-testid={label === "우리카드 앱" ? "payment-wooriwonpay-card-app" : "payment-wooriwonpay-bank-app"}
                    key={label}
                    type="button"
                    onClick={() => setWooriPayOpen(false)}
                  >
                    <Smartphone className="h-6 w-6" aria-hidden />
                    <span>{label}</span>
                    <span className="text-xs font-medium text-zinc-500">선택 확인</span>
                  </button>
                ))}
              </div>
            </div>
            <div
              className="p-5"
              hidden={wooriPayTab !== "other"}
              id="payment-wooriwonpay-other-panel"
              aria-labelledby="payment-wooriwonpay-tab-secondary"
              role="tabpanel"
            >
              <h3 className="text-lg font-semibold leading-7 text-zinc-950">다른 결제수단</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-600">이 창을 닫고 결제수단 목록에서 원하는 방식을 선택해 주세요.</p>
              <button
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                type="button"
                onClick={() => setWooriPayOpen(false)}
              >
                결제수단 선택으로 돌아가기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
