"use client";

import Link from "next/link";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, CreditCard, Download, PlusCircle, ReceiptText, RefreshCcw, Repeat2, WalletCards, X } from "lucide-react";
import type { OnlinePaymentStatus, Payment, PaymentStatus, RecurringBillingStatus } from "@/lib/domain";
import { useApiContext } from "@/hooks/use-api-context";
import { useGuardianChildSelection } from "@/hooks/use-guardian-child-selection";
import { useResource } from "@/hooks/use-resource";
import { useUrlSyncedTextParam } from "@/hooks/use-url-synced-text-param";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { ChildSwitcher } from "@/components/domain/child-switcher";
import { ManualPaymentManagement } from "@/components/domain/manual-payment-management";
import { formatCurrency, formatDate, formatDateKey, formatDateTime } from "@/lib/format";
import { canManageManualPayment, getManualPaymentDateRangeError } from "@/lib/manual-payment-management";
import { matchesMemberSearch, normalizeMemberSearchText } from "@/lib/notice-member-search";
import { getFamilyPaymentCheckoutAccess, getFamilyPaymentPlanLine, getPaymentCheckoutAmount } from "@/lib/payment-checkout-access";
import { getLatestPaymentStatusChange } from "@/lib/payment-lifecycle";
import { paymentStatusLabels } from "@/lib/roles";
import { useAppStore } from "@/store/app-store";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-blocks";
import { Button, PaymentStatusBadge, SectionHeader } from "@/components/ui/primitives";

const paymentStatusOptions: PaymentStatus[] = ["paid", "scheduled", "overdue", "expiringSoon", "cancelled", "refunded"];
const paymentFilterOptions: Array<{ label: string; value: PaymentStatus | "all" | "risk" }> = [
  { label: "전체", value: "all" },
  { label: "미납/만료 예정", value: "risk" },
  { label: "결제 완료", value: "paid" },
  { label: "납부 예정", value: "scheduled" },
  { label: "미납", value: "overdue" },
  { label: "만료 예정", value: "expiringSoon" },
  { label: "부분 환불", value: "partially_refunded" },
  { label: "전액 환불", value: "refunded" },
  { label: "취소", value: "cancelled" },
];

// 새로고침·딥링크(?filter=risk 등)에서 결제 필터 상태를 복원한다.
function getInitialPaymentFilter(): PaymentStatus | "all" | "risk" {
  if (typeof window === "undefined") {
    return "all";
  }

  const value = new URLSearchParams(window.location.search).get("filter");

  return paymentFilterOptions.some((option) => option.value === value) ? (value as PaymentStatus | "risk") : "all";
}

function syncPaymentFilterToUrl(value: PaymentStatus | "all" | "risk") {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (value === "all") {
    url.searchParams.delete("filter");
  } else {
    url.searchParams.set("filter", value);
  }

  window.history.replaceState(window.history.state, "", url);
}
const familyPaymentFilterLabels: Partial<Record<PaymentStatus | "all" | "risk", string>> = {
  all: "전체",
  expiringSoon: "만료",
  overdue: "미납",
  paid: "완료",
  risk: "주의",
  scheduled: "예정",
};
const staffOnlyPaymentFilterValues: Array<PaymentStatus | "all" | "risk"> = ["partially_refunded", "refunded", "cancelled"];
const familyPaymentFilterValues: Array<PaymentStatus | "all" | "risk"> = ["all", "risk", "paid"];
const onlinePaymentStatusLabels: Record<OnlinePaymentStatus, string> = {
  cancelled: "온라인 취소",
  failed: "온라인 실패",
  paid: "온라인 완료",
  pending: "온라인 대기",
  refunded: "온라인 환불",
};
const familyOnlinePaymentStatusLabels: Record<OnlinePaymentStatus, string> = {
  cancelled: "납부 취소",
  failed: "납부 확인 필요",
  paid: "납부 완료",
  pending: "납부 확인 중",
  refunded: "환불 반영",
};
const onlinePaymentStatusStyles: Record<OnlinePaymentStatus, string> = {
  cancelled: "border-zinc-200 bg-zinc-50 text-zinc-600",
  failed: "border-red-200 bg-red-50 text-red-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  refunded: "border-blue-200 bg-blue-50 text-blue-700",
};
const recurringAgreementStatusLabels: Record<RecurringBillingStatus, string> = {
  active: "정기결제 활성",
  cancelled: "정기결제 해지",
  failed: "정기결제 실패",
  pending: "정기결제 대기",
};
const familyRecurringAgreementStatusLabels: Record<RecurringBillingStatus, string> = {
  active: "자동 납부 등록",
  cancelled: "자동 납부 해지",
  failed: "자동 납부 확인 필요",
  pending: "자동 납부 확인 중",
};
const recurringAgreementStatusStyles: Record<RecurringBillingStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-zinc-200 bg-zinc-50 text-zinc-600",
  failed: "border-red-200 bg-red-50 text-red-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
};
type PaymentAdjustmentDraft = {
  amount: string;
  feedback?: string;
  reason: string;
};

type PaymentCreateFeedback = {
  message: string;
  tone: "error" | "success";
};

type PaymentOperationsMetric = {
  detail: string;
  label: string;
  tone: "amber" | "red" | "teal" | "zinc";
  value: string;
};

type PaymentActionQueueItem = {
  amount: number;
  branchName: string;
  detail: string;
  id: string;
  label: string;
  memberName: string;
  paymentId: string;
  score: number;
  tone: "amber" | "red" | "teal";
};

function isStaffOnlyPaymentFilter(value: PaymentStatus | "all" | "risk") {
  return staffOnlyPaymentFilterValues.includes(value);
}

function isFamilyPaymentFilter(value: PaymentStatus | "all" | "risk") {
  return familyPaymentFilterValues.includes(value) && !isStaffOnlyPaymentFilter(value);
}

function dateInputValue(dayOffset: number) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);

  return formatDateKey(date);
}

export function PaymentsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const context = useApiContext();
  const {
    cancelRecurringAgreement,
    createOnlinePaymentCheckout,
    createPayment,
    createRecurringAgreement,
    deleteManualPayment,
    refundPayment,
    updateManualPayment,
  } = useAppStore();
  const canManagePayments = context.user.role === "owner" || context.user.role === "admin";
  const showPaymentOperationsMeta = canManagePayments;
  const showPaymentsScreenHeader = context.user.role !== "member" && context.user.role !== "guardian";
  const [paymentListSearch, setPaymentListSearch] = useUrlSyncedTextParam("q");
  const [newPaymentBranchId, setNewPaymentBranchId] = useState("");
  const [newPaymentMemberId, setNewPaymentMemberId] = useState(
    () => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("payMemberId")?.trim() ?? ""),
  );
  const [paymentMemberSearch, setPaymentMemberSearch] = useState(
    () => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("payMemberSearch")?.trim() ?? ""),
  );
  const [paymentCreateOpen, setPaymentCreateOpen] = useState(() => Boolean(searchParams.get("payMemberId")?.trim()));
  const [paymentCreateFeedback, setPaymentCreateFeedback] = useState<PaymentCreateFeedback | null>(null);
  const [paymentCreatePending, setPaymentCreatePending] = useState(false);

  // 회원 카드 "결제 등록" 바로가기처럼 클라이언트 내비게이션으로 진입해도 회원 프리셋이 적용되게 한다.
  useEffect(() => {
    const presetMemberId = searchParams.get("payMemberId")?.trim();

    if (presetMemberId) {
      const presetMemberSearch = searchParams.get("payMemberSearch")?.trim() ?? "";
      let cancelled = false;

      queueMicrotask(() => {
        if (cancelled) {
          return;
        }

        setNewPaymentMemberId(presetMemberId);
        setPaymentMemberSearch(presetMemberSearch);
        setPaymentCreateFeedback(null);
        setPaymentCreateOpen(true);
      });

      return () => {
        cancelled = true;
      };
    }
  }, [searchParams]);
  const [newPaymentPlanName, setNewPaymentPlanName] = useState("월 회원권");
  const [newPaymentStatus, setNewPaymentStatus] = useState<PaymentStatus>("paid");
  const [newPaymentAmount, setNewPaymentAmount] = useState("180000");
  const [newPaymentDiscountAmount, setNewPaymentDiscountAmount] = useState("0");
  const [newPaymentDueDate, setNewPaymentDueDate] = useState(() => dateInputValue(0));
  const [newPaymentExpiresAt, setNewPaymentExpiresAt] = useState(() => dateInputValue(30));
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [paymentFilter, setPaymentFilterState] = useState<PaymentStatus | "all" | "risk">(getInitialPaymentFilter);
  function setPaymentFilter(value: PaymentStatus | "all" | "risk") {
    setPaymentFilterState(value);
    syncPaymentFilterToUrl(value);
  }

  const [selectedChildId, setSelectedChildId] = useGuardianChildSelection(context.user.id);
  const [paymentAdjustmentDrafts, setPaymentAdjustmentDrafts] = useState<Record<string, PaymentAdjustmentDraft>>({});
  const [paymentActionQueueOpen, setPaymentActionQueueOpen] = useState(false);
  const [activeFocusedPaymentId, setActiveFocusedPaymentId] = useState<string | null>(null);
  const { data, loading, error, reload } = useResource(
    () => apiClient.getPayments(context),
    [context.user.id, context.selectedBranchId, context.version],
  );
  const focusedPaymentId = searchParams.get("focusPayment")?.trim() ?? "";
  const focusedPaymentAvailable = Boolean(focusedPaymentId && data?.some((payment) => payment.id === focusedPaymentId));

  useEffect(() => {
    if (!focusedPaymentAvailable) {
      return;
    }

    // 작업목록 딥링크가 준비되면 해당 카드로 이동하고 한 번만 강조한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveFocusedPaymentId(focusedPaymentId);
    const scrollTimer = window.setTimeout(() => {
      document
        .querySelector(`[data-payment-id="${CSS.escape(focusedPaymentId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    const clearTimer = window.setTimeout(() => setActiveFocusedPaymentId(null), 3500);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [focusedPaymentAvailable, focusedPaymentId]);
  const selectedPaymentBranchId = newPaymentBranchId || context.selectedBranchId || context.db.branches[0]?.id || "";
  const paymentMembers = useMemo(
    () =>
      context.db.members.filter(
        (member) => member.branchId === selectedPaymentBranchId && member.status !== "withdrawn",
      ),
    [context.db.members, selectedPaymentBranchId],
  );
  const selectedPaymentMember = paymentMembers.find((member) => member.id === newPaymentMemberId) ?? null;
  const selectedPaymentMemberId = selectedPaymentMember?.id ?? "";
  const guardianPaymentChildren = useMemo(
    () =>
      context.user.role === "guardian"
        ? context.db.members.filter(
            (member) =>
              (context.user.childMemberIds ?? []).includes(member.id) &&
              member.guardianIds.includes(context.user.id) &&
              member.status !== "withdrawn",
          )
        : [],
    [context.db.members, context.user.childMemberIds, context.user.id, context.user.role],
  );
  const prioritizedGuardianPaymentChild =
    context.user.role === "guardian"
      ? guardianPaymentChildren.find((child) =>
          data?.some(
            (payment) =>
              payment.memberId === child.id &&
              getFamilyPaymentCheckoutAccess(context.user, payment).canOpen,
          ),
        )
      : null;
  const selectedGuardianPaymentChild =
    context.user.role === "guardian"
      ? guardianPaymentChildren.find((member) => member.id === selectedChildId) ??
        prioritizedGuardianPaymentChild ??
        guardianPaymentChildren[0] ??
        null
      : null;
  const selectedGuardianPaymentChildId = selectedGuardianPaymentChild?.id ?? null;
  const paymentMemberSearchQuery = normalizeMemberSearchText(paymentMemberSearch);
  const paymentMemberSearchResults = useMemo(() => {
    if (!paymentMemberSearchQuery) {
      return [];
    }

    return paymentMembers.filter((member) => {
      const guardianLabels = member.guardianIds
        .map((guardianId) => {
          const guardian = context.db.users.find((user) => user.id === guardianId);

          return guardian ? `${guardian.name} ${guardian.phone ?? ""}` : "";
        })
        .filter(Boolean);

      return matchesMemberSearch(paymentMemberSearch, [
        member.name,
        member.emergencyContact,
        member.level,
        member.belt,
        ...guardianLabels,
      ]);
    });
  }, [context.db.users, paymentMemberSearch, paymentMemberSearchQuery, paymentMembers]);
  const showPaymentMemberSearchResults =
    !selectedPaymentMember || paymentMemberSearch.trim() !== selectedPaymentMember.name;

  function handlePaymentMemberSearchChange(value: string) {
    setPaymentMemberSearch(value);

    if (selectedPaymentMember && value.trim() !== selectedPaymentMember.name) {
      setNewPaymentMemberId("");
    }
  }

  function handlePaymentCreateToggle() {
    if (!paymentCreateOpen) {
      setPaymentCreateFeedback(null);
    }

    setPaymentCreateOpen((open) => !open);
  }

  async function handleCreatePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (paymentCreatePending) {
      return;
    }

    const amount = Number(newPaymentAmount);
    const discountAmount = Number(newPaymentDiscountAmount || 0);

    if (!selectedPaymentBranchId || !selectedPaymentMemberId) {
      setPaymentCreateFeedback({ message: "결제를 등록할 회원을 선택해 주세요.", tone: "error" });
      return;
    }

    if (!newPaymentPlanName.trim()) {
      setPaymentCreateFeedback({ message: "회원권명을 입력해 주세요.", tone: "error" });
      return;
    }

    if (!newPaymentAmount.trim() || !Number.isFinite(amount) || amount < 0) {
      setPaymentCreateFeedback({ message: "결제 금액은 0원 이상의 숫자로 입력해 주세요.", tone: "error" });
      return;
    }

    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > amount) {
      setPaymentCreateFeedback({ message: "할인 금액은 결제 금액 이하로 입력해 주세요.", tone: "error" });
      return;
    }

    const dateRangeError = getManualPaymentDateRangeError(newPaymentDueDate, newPaymentExpiresAt);

    if (dateRangeError) {
      setPaymentCreateFeedback({ message: dateRangeError, tone: "error" });
      return;
    }

    setPaymentCreatePending(true);
    setPaymentCreateFeedback(null);
    const result = await createPayment(selectedPaymentBranchId, {
      memberId: selectedPaymentMemberId,
      planName: newPaymentPlanName.trim(),
      status: newPaymentStatus,
      amount,
      discountAmount,
      dueDate: newPaymentDueDate,
      expiresAt: newPaymentExpiresAt,
    });
    setPaymentCreatePending(false);
    setPaymentCreateFeedback({ message: result.message, tone: result.ok ? "success" : "error" });

    if (result.ok) {
      setNewPaymentMemberId("");
      setPaymentMemberSearch("");
      setNewPaymentPlanName("월 회원권");
      setNewPaymentStatus("paid");
      setNewPaymentAmount("180000");
      setNewPaymentDiscountAmount("0");
      setNewPaymentDueDate(dateInputValue(0));
      setNewPaymentExpiresAt(dateInputValue(30));
      setPaymentCreateOpen(false);
    }
  }

  function getRemainingRefundable(payment: Payment) {
    return Math.max(payment.amount - (payment.refundedAmount ?? 0), 0);
  }

  function getOnlinePaymentAmount(payment: Payment) {
    return Math.max(payment.amount - (payment.discountAmount ?? 0) - (payment.refundedAmount ?? 0), 0);
  }

  function getPaymentAdjustmentDraft(payment: Payment) {
    return paymentAdjustmentDrafts[payment.id] ?? {
      amount: String(getRemainingRefundable(payment)),
      reason: "",
    };
  }

  function updatePaymentAdjustmentDraft(payment: Payment, patch: Partial<PaymentAdjustmentDraft>) {
    setPaymentAdjustmentDrafts((current) => ({
      ...current,
      [payment.id]: {
        ...(current[payment.id] ?? {
          amount: String(getRemainingRefundable(payment)),
          reason: "",
        }),
        ...patch,
      },
    }));
  }

  async function handleRefundPayment(event: FormEvent<HTMLFormElement>, payment: Payment) {
    event.preventDefault();

    const draft = getPaymentAdjustmentDraft(payment);
    const amount = Number(draft.amount);

    if (!draft.reason.trim()) {
      updatePaymentAdjustmentDraft(payment, { feedback: "환불 사유를 입력해 주세요." });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      updatePaymentAdjustmentDraft(payment, { feedback: "환불 금액을 확인해 주세요." });
      return;
    }

    const ok = await refundPayment(payment.id, {
      amount,
      reason: draft.reason.trim(),
    });

    updatePaymentAdjustmentDraft(payment, {
      amount: ok ? "0" : draft.amount,
      feedback: ok ? "환불 처리를 저장했습니다." : "환불 처리를 저장하지 못했습니다.",
      reason: ok ? "" : draft.reason,
    });
  }

  async function handleCancelPayment(payment: Payment) {
    const draft = getPaymentAdjustmentDraft(payment);

    if (!draft.reason.trim()) {
      updatePaymentAdjustmentDraft(payment, { feedback: "취소 사유를 입력해 주세요." });
      return;
    }

    const ok = await refundPayment(payment.id, {
      cancel: true,
      reason: draft.reason.trim(),
    });

    updatePaymentAdjustmentDraft(payment, {
      feedback: ok ? "결제 취소를 저장했습니다." : "결제 취소를 저장하지 못했습니다.",
      reason: ok ? "" : draft.reason,
    });
  }

  async function handleCreateOnlinePaymentCheckout(payment: Payment) {
    const ok = await createOnlinePaymentCheckout(payment.id);

    setExportStatus(ok ? "온라인 결제 요청을 생성했습니다." : "온라인 결제 요청을 생성하지 못했습니다.");
  }

  async function handleCreateRecurringAgreement(payment: Payment) {
    const ok = await createRecurringAgreement(payment.id, {});

    setExportStatus(ok ? "정기결제 약정을 생성했습니다." : "정기결제 약정을 생성하지 못했습니다.");
  }

  async function handleCancelRecurringAgreement(payment: Payment) {
    const draft = getPaymentAdjustmentDraft(payment);

    if (!draft.reason.trim()) {
      updatePaymentAdjustmentDraft(payment, { feedback: "정기결제 해지 사유를 입력해 주세요." });
      return;
    }

    const ok = await cancelRecurringAgreement(payment.id, {
      reason: draft.reason.trim(),
    });

    updatePaymentAdjustmentDraft(payment, {
      feedback: ok ? "정기결제 약정을 해지했습니다." : "정기결제 약정을 해지하지 못했습니다.",
      reason: ok ? "" : draft.reason,
    });
  }

  async function handleExportPayments() {
    try {
      const csv = await apiClient.exportPaymentsCsv(context.selectedBranchId);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "final-judo-payments.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportStatus("결제 내보내기를 완료했습니다.");
    } catch (error) {
      setExportStatus(error instanceof ApiClientError ? error.message : "내보내기에 실패했습니다.");
    }
  }

  function handlePrefillRenewal(payment: Payment) {
    const renewalMember = context.db.members.find((member) => member.id === payment.memberId);

    setNewPaymentBranchId(payment.branchId);
    setNewPaymentMemberId(payment.memberId);
    setPaymentMemberSearch(renewalMember?.name ?? "");
    setNewPaymentPlanName(payment.planName);
    setNewPaymentStatus("scheduled");
    setNewPaymentAmount(String(payment.amount));
    setNewPaymentDiscountAmount(String(payment.discountAmount ?? 0));
    setNewPaymentDueDate(dateInputValue(0));
    setNewPaymentExpiresAt(dateInputValue(30));
    setPaymentCreateFeedback(null);
    setPaymentCreateOpen(true);
    setExportStatus("재등록 입력값을 불러왔습니다.");
  }

  function openFamilyPaymentCheckout(paymentId: string) {
    router.push(`/app/payments/checkout?paymentId=${encodeURIComponent(paymentId)}`);
  }

  function handleFamilyPaymentCardKeyDown(event: KeyboardEvent<HTMLElement>, paymentId: string) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openFamilyPaymentCheckout(paymentId);
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState description={error ?? "결제 내역을 불러오지 못했습니다."} onRetry={reload} />;
  }

  const scopedPayments =
    context.user.role === "guardian"
      ? selectedGuardianPaymentChildId
        ? data.filter((payment) => payment.memberId === selectedGuardianPaymentChildId)
        : []
      : data;
  const effectivePaymentFilter = !showPaymentOperationsMeta && !isFamilyPaymentFilter(paymentFilter) ? "all" : paymentFilter;
  const visiblePaymentFilterOptions = showPaymentOperationsMeta
    ? paymentFilterOptions
    : paymentFilterOptions.filter((option) => isFamilyPaymentFilter(option.value));
  const paymentSearchKeyword = paymentListSearch.trim();
  const filteredPayments = scopedPayments.filter((payment) => {
    if (
      paymentSearchKeyword &&
      !matchesMemberSearch(paymentSearchKeyword, [payment.member.name, payment.planName, payment.member.emergencyContact])
    ) {
      return false;
    }

    if (effectivePaymentFilter === "all") {
      return true;
    }

    if (effectivePaymentFilter === "risk") {
      return payment.status === "overdue" || payment.status === "expiringSoon";
    }

    return payment.status === effectivePaymentFilter;
  });
  const familyPaymentFilterCounts: Partial<Record<PaymentStatus | "all" | "risk", number>> = {
    all: scopedPayments.length,
    paid: scopedPayments.filter((payment) => payment.status === "paid").length,
    risk: scopedPayments.filter((payment) => payment.status === "overdue" || payment.status === "expiringSoon").length,
  };
  const paymentFilterLabel = showPaymentOperationsMeta ? "상태 필터" : "결제 보기";
  const paymentListStatusLabel = showPaymentOperationsMeta
    ? `${filteredPayments.length}/${scopedPayments.length}건 표시`
    : `결제 ${filteredPayments.length}건`;
  const showPaymentSearchEmptyState =
    showPaymentOperationsMeta && paymentSearchKeyword.length > 0 && scopedPayments.length > 0 && filteredPayments.length === 0;
  const filteredDue = filteredPayments
    .filter((payment) => payment.status === "scheduled" || payment.status === "overdue" || payment.status === "expiringSoon")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const totalDue = scopedPayments
    .filter((payment) => payment.status === "scheduled" || payment.status === "overdue" || payment.status === "expiringSoon")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const overdueCount = scopedPayments.filter((payment) => payment.status === "overdue").length;
  const filteredOverdueCount = filteredPayments.filter((payment) => payment.status === "overdue").length;
  const renewalCandidateCount = filteredPayments.filter((payment) => payment.status === "expiringSoon").length;
  const discountedPaymentCount = filteredPayments.filter((payment) => (payment.discountAmount ?? 0) > 0).length;
  const refundedPaymentCount = filteredPayments.filter((payment) => (payment.refundedAmount ?? 0) > 0).length;
  const lifecycleEventCount = filteredPayments.reduce((sum, payment) => sum + (payment.statusHistory?.length ?? 0), 0);
  const onlinePaymentRequestCount = filteredPayments.filter((payment) => payment.onlinePayment).length;
  const recurringAgreementCount = filteredPayments.filter((payment) => payment.recurringAgreement).length;
  const paymentHistoryByMember = new Map<string, Payment[]>();

  for (const payment of scopedPayments) {
    paymentHistoryByMember.set(payment.memberId, [...(paymentHistoryByMember.get(payment.memberId) ?? []), payment]);
  }

  const paymentActionQueue = filteredPayments
    .flatMap((payment) => {
      const actions: PaymentActionQueueItem[] = [];
      const memberName = payment.member.name;
      const branchName = payment.branch.name;
      const netAmount = Math.max(payment.amount - (payment.discountAmount ?? 0) - (payment.refundedAmount ?? 0), 0);
      const actionContext = { branchName, memberName, paymentId: payment.id };

      if (payment.status === "overdue") {
        actions.push({
          ...actionContext,
          amount: netAmount,
          detail: `${formatDate(payment.dueDate)} 납부 예정 · ${formatCurrency(netAmount)}`,
          id: `${payment.id}-overdue`,
          label: "미납 연락",
          score: 100 + Math.round(netAmount / 10000),
          tone: "red",
        });
      }

      if (payment.status === "expiringSoon") {
        actions.push({
          ...actionContext,
          amount: netAmount,
          detail: `${formatDate(payment.expiresAt)} 만료 · ${payment.planName}`,
          id: `${payment.id}-expiring`,
          label: "재등록 안내",
          score: 70 + Math.round(netAmount / 20000),
          tone: "amber",
        });
      }

      if (payment.onlinePayment?.status === "failed") {
        actions.push({
          ...actionContext,
          amount: payment.onlinePayment.amount,
          detail: payment.onlinePayment.failureReason ?? "온라인 결제 실패",
          id: `${payment.id}-online-failed`,
          label: "온라인 결제 재요청",
          score: 90 + Math.round(payment.onlinePayment.amount / 10000),
          tone: "red",
        });
      }

      if (payment.onlinePayment?.status === "pending") {
        actions.push({
          ...actionContext,
          amount: payment.onlinePayment.amount,
          detail: `${formatDateTime(payment.onlinePayment.requestedAt)} 요청 · ${formatCurrency(payment.onlinePayment.amount)}`,
          id: `${payment.id}-online-pending`,
          label: "온라인 결제 확인",
          score: 50 + Math.round(payment.onlinePayment.amount / 20000),
          tone: "teal",
        });
      }

      if (payment.recurringAgreement?.status === "failed") {
        actions.push({
          ...actionContext,
          amount: netAmount,
          detail: payment.recurringAgreement.lastFailureReason ?? "정기결제 실패",
          id: `${payment.id}-recurring-failed`,
          label: "정기결제 실패 확인",
          score: 95 + Math.round(netAmount / 10000),
          tone: "red",
        });
      }

      return actions;
    })
    .sort((left, right) => right.score - left.score || right.amount - left.amount || left.memberName.localeCompare(right.memberName))
    .slice(0, 5);
  const paymentOperationsMetrics: PaymentOperationsMetric[] = [
    {
      detail: `${formatCurrency(filteredDue)} 확인 필요`,
      label: "미납 회수",
      tone: "red",
      value: `${filteredOverdueCount}건`,
    },
    {
      detail: "재등록 안내 우선 대상",
      label: "만료/재등록",
      tone: "amber",
      value: `${renewalCandidateCount}건`,
    },
    {
      detail: `할인 ${discountedPaymentCount}건 · 환불 ${refundedPaymentCount}건`,
      label: "환불/할인 점검",
      tone: "teal",
      value: `${discountedPaymentCount + refundedPaymentCount}건`,
    },
    {
      detail: "생성, 환불, 취소, 정기결제 기록",
      label: "상태 이력",
      tone: "zinc",
      value: `${lifecycleEventCount}건`,
    },
  ];

  return (
    <div>
      {showPaymentsScreenHeader ? (
        <SectionHeader
          title="결제 상태"
          action={
            canManagePayments ? (
              <button
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100"
                data-testid="payment-export-button"
                type="button"
                onClick={() => void handleExportPayments()}
              >
                <Download className="h-4 w-4" aria-hidden />
                결제 내보내기
              </button>
            ) : null
          }
        />
      ) : null}

      {exportStatus ? (
        <p className="mb-4 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900">
          {exportStatus}
        </p>
      ) : null}

      {context.user.role === "guardian" ? (
        <ChildSwitcher
          items={guardianPaymentChildren.map((child) => ({
            id: child.id,
            name: child.name,
            meta: `${child.belt} · ${child.level}`,
          }))}
          selectedChildId={selectedGuardianPaymentChildId}
          onSelect={setSelectedChildId}
        />
      ) : null}

      <section
        className={
          showPaymentOperationsMeta
            ? "mb-4 rounded-lg border border-zinc-200 bg-white p-4"
            : "mb-3"
        }
        aria-label="결제 필터"
      >
        {showPaymentOperationsMeta ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] md:items-end">
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">{paymentFilterLabel}</span>
              <select
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="payment-status-filter"
                value={effectivePaymentFilter}
                onChange={(event) => setPaymentFilter(event.target.value as PaymentStatus | "all" | "risk")}
              >
                {visiblePaymentFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="relative block">
              <span className="mb-1 block text-xs font-semibold text-zinc-500">회원/회원권 검색</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 pr-12 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="payment-list-search-input"
                placeholder="회원 이름, 회원권, 연락처"
                value={paymentListSearch}
                onChange={(event) => setPaymentListSearch(event.target.value)}
              />
              {paymentListSearch ? (
                <button
                  aria-label="검색어 지우기"
                  className="absolute bottom-0 right-0 inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                  data-testid="payment-list-search-clear"
                  type="button"
                  onClick={() => setPaymentListSearch("")}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </label>
            <p className="flex min-h-11 items-center rounded-md bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700" data-testid="payment-list-status-label">
              {paymentListStatusLabel}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <div
              className="rounded-md border border-zinc-200 bg-white p-0.5"
              data-testid="member-payment-filter-chips"
              role="group"
              aria-label={`${paymentFilterLabel} · ${paymentListStatusLabel}`}
            >
              <div className="grid grid-cols-3 gap-0.5">
                {visiblePaymentFilterOptions.map((option) => {
                  const selected = effectivePaymentFilter === option.value;
                  const familyLabel = familyPaymentFilterLabels[option.value] ?? option.label;
                  const familyCount = familyPaymentFilterCounts[option.value] ?? 0;

                  return (
                    <button
                      aria-label={`${familyLabel} ${familyCount}건`}
                      aria-pressed={selected}
                      className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-[5px] px-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-1 ${
                        selected
                          ? "bg-teal-700 text-white"
                          : "text-zinc-600 hover:bg-zinc-50"
                      }`}
                      data-testid="member-payment-filter-chip"
                      key={option.value}
                      type="button"
                      onClick={() => setPaymentFilter(option.value)}
                    >
                      <span>{familyLabel}</span>
                      <span
                        className={`rounded-full px-1.5 text-[10px] leading-4 tabular-nums ${
                          selected ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500"
                        }`}
                        data-testid="member-payment-filter-chip-count"
                      >
                        {familyCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <p className="flex min-h-11 items-center break-words rounded-md bg-zinc-50 px-2 py-1 text-[11px] font-medium leading-4 text-zinc-600">
                미납 {effectivePaymentFilter === "all" ? overdueCount : filteredOverdueCount}건
              </p>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-zinc-950">
                {formatCurrency(effectivePaymentFilter === "all" ? totalDue : filteredDue)}
              </p>
            </div>
          </div>
        )}
      </section>

      {canManagePayments && !showPaymentSearchEmptyState ? (
        <form
          className="mb-3 rounded-lg border border-zinc-200 bg-white p-2.5"
          data-testid="payment-create-form"
          aria-busy={paymentCreatePending}
          onSubmit={(event) => void handleCreatePayment(event)}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <PlusCircle className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold leading-5 text-zinc-950">수기 결제 등록</h2>
                <p className="line-clamp-1 text-[11px] font-medium leading-4 text-zinc-500">
                  {selectedPaymentMemberId ? `${paymentMembers.find((member) => member.id === selectedPaymentMemberId)?.name ?? "회원"} · ${newPaymentPlanName}` : "회원권 등록"}
                </p>
              </div>
            </div>
            <button
              aria-expanded={paymentCreateOpen}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              data-testid="payment-create-toggle"
              disabled={paymentCreatePending}
              type="button"
              onClick={handlePaymentCreateToggle}
            >
              {paymentCreateOpen ? "접기" : "등록 열기"}
            </button>
          </div>
          {paymentCreateOpen ? (
          <div
            className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[0.9fr_1fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_auto]"
            data-testid="payment-create-fields"
          >
            {context.db.branches.length > 1 ? (
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">지점</span>
                <select
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  value={selectedPaymentBranchId}
                  onChange={(event) => {
                    setNewPaymentBranchId(event.target.value);
                    setNewPaymentMemberId("");
                    setPaymentMemberSearch("");
                  }}
                >
                  {context.db.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="grid gap-2 md:col-span-2 xl:col-span-2" data-testid="payment-create-member-search">
              <label>
                <span className="mb-1 block text-xs font-semibold text-zinc-500">회원 검색</span>
                <input
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="payment-create-member-search-input"
                  placeholder="회원 이름, 연락처, 보호자 검색"
                  value={paymentMemberSearch}
                  onChange={(event) => handlePaymentMemberSearchChange(event.target.value)}
                />
              </label>

              {selectedPaymentMember ? (
                <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2" data-testid="payment-create-selected-member">
                  <p className="text-xs font-semibold text-teal-700">선택 회원</p>
                  <p className="mt-0.5 text-sm font-semibold text-zinc-950">{selectedPaymentMember.name}</p>
                </div>
              ) : null}

              {showPaymentMemberSearchResults ? (
                <div
                  aria-label="결제 등록 회원 검색 결과"
                  className="max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white"
                  data-testid="payment-create-member-results"
                  role="listbox"
                >
                  {paymentMembers.length === 0 ? (
                    <p className="px-3 py-3 text-sm font-medium text-zinc-500">선택 가능한 회원 없음</p>
                  ) : paymentMemberSearchQuery.length === 0 ? (
                    <p className="px-3 py-3 text-sm font-medium text-zinc-500">회원 이름 또는 연락처를 검색해 주세요.</p>
                  ) : paymentMemberSearchResults.length === 0 ? (
                    <p className="px-3 py-3 text-sm font-medium text-zinc-500">검색 결과 없음</p>
                  ) : (
                    paymentMemberSearchResults.map((member) => {
                      const guardians = member.guardianIds
                        .map((guardianId) => context.db.users.find((user) => user.id === guardianId)?.name)
                        .filter(Boolean)
                        .join(", ");
                      const selected = member.id === selectedPaymentMemberId;

                      return (
                        <button
                          aria-selected={selected}
                          className={`grid min-h-11 w-full gap-1 border-b border-zinc-100 px-3 py-2 text-left text-sm transition last:border-b-0 ${
                            selected ? "bg-teal-50 text-teal-900" : "bg-white text-zinc-800 hover:bg-zinc-50"
                          }`}
                          data-testid="payment-create-member-result"
                          key={member.id}
                          role="option"
                          type="button"
                          onClick={() => {
                            setNewPaymentMemberId(member.id);
                            setPaymentMemberSearch(member.name);
                            // 직전 결제 기준으로 회원권명·금액을 미리 채운다 (이력이 없으면 기존 입력 유지)
                            const lastPayment = (data ?? [])
                              .filter((payment) => payment.memberId === member.id)
                              .sort((left, right) => right.dueDate.localeCompare(left.dueDate))[0];
                            if (lastPayment) {
                              setNewPaymentPlanName(lastPayment.planName);
                              setNewPaymentAmount(String(lastPayment.amount));
                            }
                          }}
                        >
                          <span className="font-semibold">{member.name}</span>
                          <span className="text-xs font-medium text-zinc-500">
                            {[member.level, member.belt, guardians ? `보호자 ${guardians}` : null].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">회원권명</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="payment-create-plan-input"
                required
                value={newPaymentPlanName}
                onChange={(event) => setNewPaymentPlanName(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">상태</span>
              <select
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="payment-create-status-select"
                value={newPaymentStatus}
                onChange={(event) => setNewPaymentStatus(event.target.value as PaymentStatus)}
              >
                {paymentStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {paymentStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">금액</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="payment-create-amount-input"
                min={0}
                required
                step={100}
                type="number"
                value={newPaymentAmount}
                onChange={(event) => setNewPaymentAmount(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">할인</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="payment-create-discount-input"
                min={0}
                step={100}
                type="number"
                value={newPaymentDiscountAmount}
                onChange={(event) => setNewPaymentDiscountAmount(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">납부일</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="payment-create-due-date-input"
                max={newPaymentExpiresAt || undefined}
                required
                type="date"
                value={newPaymentDueDate}
                onChange={(event) => setNewPaymentDueDate(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-zinc-500">만료일</span>
              <input
                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                data-testid="payment-create-expiry-date-input"
                min={newPaymentDueDate || undefined}
                required
                type="date"
                value={newPaymentExpiresAt}
                onChange={(event) => setNewPaymentExpiresAt(event.target.value)}
              />
            </label>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="payment-create-submit"
              disabled={
                paymentCreatePending ||
                !selectedPaymentBranchId ||
                !selectedPaymentMemberId ||
                !newPaymentPlanName.trim()
              }
              type="submit"
            >
              {paymentCreatePending ? "등록 중" : "등록"}
            </button>
          </div>
          ) : null}
          {paymentCreateFeedback ? (
            <p
              className={`mt-2 rounded-md px-3 py-2 text-sm font-medium ${
                paymentCreateFeedback.tone === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border border-red-200 bg-red-50 text-red-800"
              }`}
              data-testid="payment-create-feedback"
              role="status"
            >
              {paymentCreateFeedback.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {canManagePayments && !showPaymentSearchEmptyState ? (
        <section className="mb-3 grid grid-cols-3 overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-label="결제 요약">
          <div className="flex min-h-14 min-w-0 flex-col justify-center px-2 py-2 text-center">
            <p className="truncate text-[11px] font-semibold text-zinc-500">조회 건수</p>
            <p className="mt-1 text-xl font-semibold leading-6 tabular-nums text-zinc-950">{filteredPayments.length}</p>
          </div>
          <div className="flex min-h-14 min-w-0 flex-col justify-center border-l border-zinc-200 bg-red-50 px-2 py-2 text-center">
            <p className="truncate text-[11px] font-semibold text-red-700">미납</p>
            <p className="mt-1 text-xl font-semibold leading-6 tabular-nums text-zinc-950">{filteredOverdueCount}</p>
          </div>
          <div className="flex min-h-14 min-w-0 flex-col justify-center border-l border-zinc-200 bg-amber-50 px-2 py-2 text-center">
            <p className="truncate text-[11px] font-semibold text-amber-700">확인 금액</p>
            <p className="mt-1 truncate text-base font-semibold leading-6 tabular-nums text-zinc-950">{formatCurrency(filteredDue)}</p>
          </div>
        </section>
      ) : null}

      {canManagePayments && !showPaymentSearchEmptyState ? (
        <section className="mb-3 rounded-lg border border-blue-200 bg-blue-50/70 px-2 py-2" data-testid="p2-payment-membership-ops-board">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-blue-200 bg-white text-blue-700">
                <WalletCards className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold leading-5 text-zinc-950">결제/회원권 요약</h2>
                <p className="line-clamp-1 text-[11px] font-medium leading-4 text-blue-800">
                  온라인/정기결제 {onlinePaymentRequestCount + recurringAgreementCount}건
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-semibold text-blue-800">
              회원권 상태
            </span>
          </div>
          <div className="mt-2 -mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max gap-1.5">
            {paymentOperationsMetrics.map((metric) => {
              const toneClass =
                metric.tone === "red"
                  ? "border-red-200 bg-white text-red-700"
                  : metric.tone === "amber"
                    ? "border-amber-200 bg-white text-amber-700"
                    : metric.tone === "teal"
                      ? "border-teal-200 bg-white text-teal-700"
                      : "border-zinc-200 bg-white text-zinc-700";

              return (
                <div
                  aria-label={`${metric.label} ${metric.value}, ${metric.detail}`}
                  className={`inline-flex min-h-11 min-w-[7.5rem] items-center justify-between gap-2 rounded-md border px-2 py-1 ${toneClass}`}
                  data-testid="payment-operations-metric"
                  key={metric.label}
                >
                  <p className="truncate text-[11px] font-semibold">{metric.label}</p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-zinc-950">{metric.value}</p>
                </div>
              );
            })}
            </div>
          </div>
        </section>
      ) : null}

      {canManagePayments && !showPaymentSearchEmptyState ? (
        <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-2.5" data-testid="payment-action-queue">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <WalletCards className="h-4 w-4 shrink-0 text-teal-700" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold leading-5 text-zinc-950">확인할 결제</h2>
                <p className="line-clamp-1 text-[11px] font-medium leading-4 text-zinc-500">
                  {paymentActionQueue.length > 0
                    ? `${paymentActionQueue[0].label} · ${paymentActionQueue[0].memberName}`
                    : "확인할 결제가 없습니다."}
                </p>
              </div>
            </div>
            <button
              aria-expanded={paymentActionQueueOpen}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              type="button"
              onClick={() => setPaymentActionQueueOpen((open) => !open)}
            >
              {paymentActionQueueOpen ? "접기" : "보기"}
            </button>
          </div>
          {paymentActionQueueOpen ? (
            paymentActionQueue.length === 0 ? (
              <p className="mt-2 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-600">확인할 결제가 없습니다.</p>
            ) : (
              <ol className="mt-2 grid gap-2 lg:grid-cols-2">
                {paymentActionQueue.map((action, index) => {
                  const toneClass =
                    action.tone === "red"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : action.tone === "amber"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-teal-200 bg-teal-50 text-teal-700";

                  const paymentCardHref = `/app/payments?q=${encodeURIComponent(action.memberName)}&focusPayment=${encodeURIComponent(action.paymentId)}`;

                  return (
                    <li key={action.id}>
                      <Link
                        className="block rounded-md border border-zinc-200 p-2.5 transition hover:border-teal-300 hover:bg-teal-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                        data-testid="payment-action-queue-link"
                        href={paymentCardHref}
                        onNavigate={() => setPaymentActionQueueOpen(false)}
                      >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-950">
                            {index + 1}. {action.label}
                          </p>
                          <p className="mt-1 text-sm text-zinc-600">
                            {action.memberName} · {action.branchName}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${toneClass}`}>
                          {index === 0 ? "먼저" : "확인"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-zinc-700">{action.detail}</p>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )
          ) : null}
        </section>
      ) : null}

      {filteredPayments.length === 0 ? (
        <EmptyState
          title={
            paymentSearchKeyword
              ? "검색 결과가 없습니다"
              : scopedPayments.length === 0
              ? selectedGuardianPaymentChild
                ? `${selectedGuardianPaymentChild.name} 결제 내역이 없습니다`
                : "결제 내역이 없습니다"
              : "선택한 보기의 결제가 없습니다"
          }
          description={
            paymentSearchKeyword ? `"${paymentSearchKeyword}"와 일치하는 회원 또는 회원권이 없습니다.` : undefined
          }
          action={
            paymentSearchKeyword ? (
              <Button data-testid="payment-list-search-empty-clear" size="lg" variant="secondary" onClick={() => setPaymentListSearch("")}>
                <X className="h-4 w-4" aria-hidden />
                검색어 지우기
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          className={canManagePayments ? "overflow-hidden rounded-lg border border-zinc-200 bg-white" : "grid gap-3"}
          data-testid={canManagePayments ? undefined : "member-guardian-payment-status-list"}
        >
          {canManagePayments ? (
            <div className="hidden grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.8fr] border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500 md:grid">
              <span>회원</span>
              <span>회원권</span>
              <span>상태</span>
              <span>납부일</span>
              <span className="text-right">금액</span>
            </div>
          ) : null}
          <div className={canManagePayments ? "divide-y divide-zinc-100" : "grid gap-3"}>
            {filteredPayments.map((payment) => {
              const remainingRefundable = getRemainingRefundable(payment);
              const draft = getPaymentAdjustmentDraft(payment);
              const canRefund = canManagePayments && ["paid", "partially_refunded"].includes(payment.status) && remainingRefundable > 0;
              const canCancel =
                canManagePayments && ["scheduled", "overdue", "expiringSoon"].includes(payment.status);
              const onlinePayment = payment.onlinePayment;
              const recurringAgreement = payment.recurringAgreement;
              const canRequestOnlineCheckout =
                canManagePayments &&
                ["scheduled", "overdue", "expiringSoon", "partially_refunded"].includes(payment.status) &&
                onlinePayment?.status !== "pending" &&
                getOnlinePaymentAmount(payment) > 0;
              const canCreateRecurringAgreement =
                canManagePayments &&
                ["paid", "scheduled", "overdue", "expiringSoon", "partially_refunded"].includes(payment.status) &&
                (!recurringAgreement || recurringAgreement.status === "cancelled");
              const canCancelRecurringAgreement =
                canManagePayments &&
                recurringAgreement !== undefined &&
                recurringAgreement.status !== "cancelled";
              const memberHistory = paymentHistoryByMember.get(payment.memberId) ?? [];
              const latestExpiresAt = memberHistory
                .map((item) => item.expiresAt)
                .sort()
                .at(-1);
              const statusHistory = [...(payment.statusHistory ?? [])].sort((left, right) =>
                right.changedAt.localeCompare(left.changedAt),
              );
              const latestStatusChange = getLatestPaymentStatusChange(payment);
              const staffOnlinePaymentDetails = onlinePayment ? (
                <div className="mt-2 flex flex-col gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span
                      className={`w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${onlinePaymentStatusStyles[onlinePayment.status]}`}
                    >
                      {onlinePaymentStatusLabels[onlinePayment.status]}
                    </span>
                    <span className="text-xs text-zinc-500">
                      온라인 결제{showPaymentOperationsMeta ? ` · ${formatCurrency(onlinePayment.amount)}` : ""} · 요청 {formatDateTime(onlinePayment.requestedAt)}
                    </span>
                    {onlinePayment.failureReason ? (
                      <span className="text-xs font-medium text-red-700">{onlinePayment.failureReason}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {onlinePayment.checkoutUrl ? (
                      <a
                        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        data-testid="payment-online-checkout-link"
                        href={onlinePayment.checkoutUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <CreditCard className="h-3.5 w-3.5" aria-hidden />
                        결제 링크
                      </a>
                    ) : null}
                    {onlinePayment.receipt?.receiptUrl ? (
                      <a
                        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        data-testid="payment-receipt-link"
                        href={onlinePayment.receipt.receiptUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ReceiptText className="h-3.5 w-3.5" aria-hidden />
                        영수증
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null;
              const staffRecurringAgreementDetails = recurringAgreement ? (
                <div className="mt-2 flex flex-col gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span
                      className={`w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${recurringAgreementStatusStyles[recurringAgreement.status]}`}
                    >
                      {recurringAgreementStatusLabels[recurringAgreement.status]}
                    </span>
                    <span className="text-xs text-zinc-500">
                      매월 {recurringAgreement.billingDayOfMonth}일 · 다음 청구 {formatDate(recurringAgreement.nextBillingDate)}
                    </span>
                    {recurringAgreement.cancelReason ? (
                      <span className="text-xs font-medium text-zinc-600">해지 사유 {recurringAgreement.cancelReason}</span>
                    ) : null}
                    {recurringAgreement.lastFailureReason ? (
                      <span className="text-xs font-medium text-red-700">{recurringAgreement.lastFailureReason}</span>
                    ) : null}
                  </div>
                  {canCancelRecurringAgreement ? (
                    <button
                      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                      data-testid="payment-recurring-cancel-button"
                      type="button"
                      onClick={() => void handleCancelRecurringAgreement(payment)}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden />
                      정기결제 해지
                    </button>
                  ) : null}
                </div>
              ) : null;
              const familyPaymentStatusNotes = [
                onlinePayment && onlinePayment.status !== "paid" ? familyOnlinePaymentStatusLabels[onlinePayment.status] : null,
                recurringAgreement && recurringAgreement.status !== "cancelled"
                  ? familyRecurringAgreementStatusLabels[recurringAgreement.status]
                  : null,
                (payment.refundedAmount ?? 0) > 0 ? "환불 반영" : null,
              ].filter(Boolean);
              const familyCheckoutAccess = canManagePayments
                ? null
                : getFamilyPaymentCheckoutAccess(context.user, payment);
              const familyCheckoutCanOpen = familyCheckoutAccess?.canOpen ?? false;
              const familyCheckoutOpenToneClass = "border-teal-200 bg-teal-50 text-teal-800";
              const familyCheckoutStateToneClass =
                familyCheckoutAccess?.state === "guardian_required"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : familyCheckoutAccess?.state === "paid"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-zinc-200 bg-zinc-50 text-zinc-600";
              const familyCheckoutStateHelper =
                familyCheckoutAccess?.state === "guardian_required" ? "학부모 계정에서 진행" : null;
              const familyPaymentPlanLine = getFamilyPaymentPlanLine(payment.planName, payment.member.ageGroup);

              return (
                <article
                  aria-label={
                    familyCheckoutCanOpen
                      ? `${payment.member.name} ${familyPaymentPlanLine} ${familyCheckoutAccess?.label}`
                      : undefined
                  }
                  className={
                    canManagePayments
                      ? `grid scroll-mt-24 gap-3 px-4 py-4 transition md:grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.8fr] md:items-center ${
                          focusedPaymentAvailable && activeFocusedPaymentId === payment.id
                            ? "bg-teal-50/40 ring-2 ring-inset ring-teal-400"
                            : ""
                        }`
                      : `rounded-lg border border-zinc-200 bg-white p-2 ${
                          familyCheckoutCanOpen
                            ? "cursor-pointer transition hover:border-teal-300 hover:bg-teal-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
                            : ""
                        }`
                  }
                  data-payment-checkout-state={familyCheckoutAccess?.state}
                  data-payment-id={payment.id}
                  data-testid={canManagePayments ? undefined : "member-payment-compact-card"}
                  id={`payment-${payment.id}`}
                  key={payment.id}
                  role={familyCheckoutCanOpen ? "link" : undefined}
                  tabIndex={familyCheckoutCanOpen ? 0 : undefined}
                  onClick={familyCheckoutCanOpen ? () => openFamilyPaymentCheckout(payment.id) : undefined}
                  onKeyDown={
                    familyCheckoutCanOpen
                      ? (event) => handleFamilyPaymentCardKeyDown(event, payment.id)
                      : undefined
                  }
                >
                  {canManagePayments ? (
                    <>
                      <div>
                        <Link
                          className="font-semibold text-zinc-950 underline-offset-4 transition hover:text-teal-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                          data-testid="payment-member-profile-link"
                          href={`/app/members?q=${encodeURIComponent(payment.member.name)}`}
                        >
                          {payment.member.name}
                        </Link>
                        <p className="mt-1 text-sm text-zinc-500">{payment.branch.name}</p>
                        {showPaymentOperationsMeta ? (
                          <p className="mt-1 text-xs text-zinc-500">
                            이력 {memberHistory.length}건{latestExpiresAt ? ` · 최근 만료 ${formatDate(latestExpiresAt)}` : ""}
                          </p>
                        ) : null}
                      </div>
                      <p className="text-sm font-medium text-zinc-700">{payment.planName}</p>
                      <div>
                        <PaymentStatusBadge status={payment.status} />
                      </div>
                      <p className="text-sm text-zinc-600">{formatDate(payment.dueDate)}</p>
                      {showPaymentOperationsMeta ? (
                        <p className="text-sm font-semibold text-zinc-950 md:text-right">{formatCurrency(payment.amount)}</p>
                      ) : null}
                      <div className="rounded-md bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-600 md:col-span-5">
                        <span>만료일 {formatDate(payment.expiresAt)}</span>
                        {(payment.discountAmount ?? 0) > 0 ? (
                          <span className="ml-3 font-medium text-teal-700"> 할인 {formatCurrency(payment.discountAmount ?? 0)}</span>
                        ) : null}
                        {(payment.refundedAmount ?? 0) > 0 ? (
                          <span className="ml-3 font-medium text-red-700"> 환불 {formatCurrency(payment.refundedAmount ?? 0)}</span>
                        ) : null}
                        {payment.refundReason ? <span className="ml-3"> 사유 {payment.refundReason}</span> : null}
                        {latestStatusChange ? (
                          <span className="ml-3"> 최근 변경 {formatDateTime(latestStatusChange.changedAt)} · {latestStatusChange.reason}</span>
                        ) : null}
                        <button
                          className="ml-0 mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 sm:ml-3 sm:mt-0"
                          data-testid="payment-renewal-prefill"
                          type="button"
                          onClick={() => handlePrefillRenewal(payment)}
                        >
                          <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
                          재등록
                        </button>
                        {canRequestOnlineCheckout ? (
                          <button
                            className="ml-0 mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-200 bg-white px-3 text-xs font-semibold text-teal-800 transition hover:bg-teal-50 sm:ml-2 sm:mt-0"
                            data-testid="payment-online-request-button"
                            type="button"
                            onClick={() => void handleCreateOnlinePaymentCheckout(payment)}
                          >
                            <CreditCard className="h-3.5 w-3.5" aria-hidden />
                            온라인 요청
                          </button>
                        ) : null}
                        {canCreateRecurringAgreement ? (
                          <button
                            className="ml-0 mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-800 transition hover:bg-blue-50 sm:ml-2 sm:mt-0"
                            data-testid="payment-recurring-create-button"
                            type="button"
                            onClick={() => void handleCreateRecurringAgreement(payment)}
                          >
                            <Repeat2 className="h-3.5 w-3.5" aria-hidden />
                            정기결제 약정
                          </button>
                        ) : null}
                        {staffOnlinePaymentDetails}
                        {staffRecurringAgreementDetails}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-5 text-zinc-950">{payment.member.name}</p>
                          <p className="mt-0.5 truncate text-xs leading-4 text-zinc-600" data-testid="member-payment-plan-line">
                            {familyPaymentPlanLine} · {payment.branch.name}
                            {familyPaymentStatusNotes.length > 0 ? ` · ${familyPaymentStatusNotes.join(" · ")}` : ""}
                          </p>
                        </div>
                        <PaymentStatusBadge status={payment.status} />
                      </div>
                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                        <p
                          className="flex min-h-11 items-center break-words rounded-md bg-zinc-50 px-2 py-1 text-[11px] font-medium leading-4 text-zinc-600"
                          data-testid="member-payment-date-line"
                        >
                          납부 {formatDate(payment.dueDate)} · 만료 {formatDate(payment.expiresAt)}
                        </p>
                        {familyCheckoutAccess ? (
                          <div className="flex min-w-0 flex-col items-end gap-1">
                            {familyCheckoutCanOpen ? (
                              <div
                                className={`flex min-h-11 min-w-[118px] max-w-[150px] flex-col justify-center gap-0.5 rounded-md border px-2 py-1 text-[11px] font-semibold leading-4 ${familyCheckoutOpenToneClass}`}
                                data-testid="member-payment-checkout-action"
                              >
                                <span className="inline-flex min-w-0 items-center gap-1">
                                  <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  <span className="truncate">{familyCheckoutAccess.label}</span>
                                </span>
                                <span className="shrink-0 tabular-nums">{formatCurrency(getPaymentCheckoutAmount(payment))}</span>
                              </div>
                            ) : (
                              <div
                                className={`inline-flex h-8 min-w-[104px] max-w-[154px] items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold leading-4 ${familyCheckoutStateToneClass}`}
                                data-testid="member-payment-checkout-state-badge"
                                title={`${familyCheckoutAccess.label}${familyCheckoutStateHelper ? ` · ${familyCheckoutStateHelper}` : ""}`}
                              >
                                <span className="inline-flex min-w-0 items-center gap-1">
                                  <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  <span className="truncate">{familyCheckoutAccess.label}</span>
                                </span>
                              </div>
                            )}
                            {familyCheckoutStateHelper ? (
                              <p
                                className="max-w-[154px] text-right text-[10px] font-medium leading-3 text-amber-700"
                                data-testid="member-payment-checkout-state-helper"
                              >
                                {familyCheckoutStateHelper}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}

                  {canManagePayments && canManageManualPayment(payment) ? (
                    <ManualPaymentManagement
                      payment={payment}
                      onDelete={(paymentId, reason) => deleteManualPayment(paymentId, { reason })}
                      onUpdate={updateManualPayment}
                    />
                  ) : null}
                  {canManagePayments ? (
                    <div className="rounded-md border border-zinc-100 bg-white px-3 py-2 md:col-span-5">
                      <p className="text-xs font-semibold text-zinc-500">상태 변경 이력</p>
                      {statusHistory.length === 0 ? (
                        <p className="mt-1 text-sm text-zinc-500">아직 기록된 상태 변경 이력이 없습니다.</p>
                      ) : (
                        <ol className="mt-2 grid gap-2">
                          {statusHistory.slice(0, 3).map((entry) => (
                            <li className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between" key={entry.id}>
                              <div>
                                <span className="font-semibold text-zinc-800">{paymentStatusLabels[entry.status]}</span>
                                {entry.reason ? <span className="ml-2 text-zinc-500">{entry.reason}</span> : null}
                              </div>
                              <span className="text-xs text-zinc-500">{formatDateTime(entry.changedAt)}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ) : null}
                  {canRefund || canCancel ? (
                    <form
                      className={`grid gap-2 rounded-md border border-zinc-100 bg-zinc-50 p-3 md:col-span-5 lg:items-end ${
                        canRefund
                          ? "lg:grid-cols-[minmax(12rem,0.8fr)_auto_minmax(18rem,1.4fr)_auto]"
                          : "lg:grid-cols-[minmax(0,1fr)_auto]"
                      }`}
                      data-testid="payment-adjustment-form"
                      onSubmit={(event) => void handleRefundPayment(event, payment)}
                    >
                      {canRefund ? (
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-zinc-500">환불 금액</span>
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                            data-testid="payment-refund-amount-input"
                            max={remainingRefundable}
                            min={100}
                            step={100}
                            type="number"
                            value={draft.amount}
                            onChange={(event) =>
                              updatePaymentAdjustmentDraft(payment, { amount: event.target.value, feedback: undefined })
                            }
                          />
                        </label>
                      ) : null}
                      {canRefund ? (
                        <button
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-teal-700 transition hover:border-teal-300 hover:bg-teal-50 lg:w-auto lg:whitespace-nowrap"
                          data-testid={`payment-refund-full-amount-${payment.id}`}
                          type="button"
                          onClick={() => updatePaymentAdjustmentDraft(payment, { amount: String(remainingRefundable), feedback: undefined })}
                        >
                          전액 입력
                        </button>
                      ) : null}
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">처리 사유</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                          data-testid="payment-adjustment-reason-input"
                          placeholder="환불/취소 사유"
                          value={draft.reason}
                          onChange={(event) =>
                            updatePaymentAdjustmentDraft(payment, { reason: event.target.value, feedback: undefined })
                          }
                        />
                      </label>
                      {canRefund ? (
                        <Button
                          className="self-end"
                          data-testid="payment-refund-submit"
                          disabled={!draft.reason.trim()}
                          size="lg"
                          type="submit"
                          variant="danger"
                        >
                          환불 처리
                        </Button>
                      ) : null}
                      {canCancel ? (
                        <Button
                          className="self-end"
                          data-testid="payment-cancel-submit"
                          disabled={!draft.reason.trim()}
                          size="lg"
                          type="button"
                          variant="secondary"
                          onClick={() => void handleCancelPayment(payment)}
                        >
                          취소 처리
                        </Button>
                      ) : null}
                      {draft.feedback ? (
                        <p className="text-xs font-medium text-zinc-600 lg:col-span-full">{draft.feedback}</p>
                      ) : null}
                    </form>
                  ) : canCancelRecurringAgreement ? (
                    <form
                      className="grid gap-2 rounded-md border border-zinc-100 bg-zinc-50 p-3 md:col-span-5 lg:grid-cols-[1fr_auto]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleCancelRecurringAgreement(payment);
                      }}
                    >
                      <label>
                        <span className="mb-1 block text-xs font-semibold text-zinc-500">정기결제 해지 사유</span>
                        <input
                          className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                          placeholder="해지 요청 사유"
                          value={draft.reason}
                          onChange={(event) =>
                            updatePaymentAdjustmentDraft(payment, { reason: event.target.value, feedback: undefined })
                          }
                        />
                      </label>
                      <Button
                        className="self-end"
                        data-testid="payment-recurring-cancel-submit"
                        disabled={!draft.reason.trim()}
                        size="lg"
                        type="submit"
                        variant="secondary"
                      >
                        해지 저장
                      </Button>
                      {draft.feedback ? (
                        <p className="text-xs font-medium text-zinc-600 lg:col-span-2">{draft.feedback}</p>
                      ) : null}
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
