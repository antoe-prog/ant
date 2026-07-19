import { NextRequest } from "next/server";
import type { AppUser, AuditLog, MockDatabase, Payment, PaymentStatus } from "@/lib/domain";
import {
  getManualPaymentDateRangeError,
  manualPaymentInputLimits,
  manualPaymentCreatableStatuses,
  requiresManualPaymentCreateReason,
} from "@/lib/manual-payment-management";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import {
  createPaymentCreateFingerprint,
  createPaymentCreateSnapshot,
  parsePaymentCreateIdempotencyKey,
  resolvePaymentCreateReplay,
  type PaymentCreateSnapshot,
} from "@/lib/payment-create-idempotency";
import { createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import { getPaymentNetAmount } from "@/lib/payment-amounts";
import {
  finalCommonPublicServiceBenefit,
  quoteFinalCommonFeeProduct,
  type FinalCommonFeeBenefitCode,
} from "@/lib/final-common-fee-policy";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { isNonNegativeSafeIntegerPaymentAmount } from "@/server/payment-mutation-policy";
import { createRuntimeId } from "@/server/runtime-id";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

type PaymentBody = {
  memberId?: string;
  planName?: string;
  status?: PaymentStatus;
  amount?: number;
  discountAmount?: number;
  discountReason?: string;
  feeProductId?: string;
  benefitCode?: FinalCommonFeeBenefitCode;
  benefitVerificationReason?: string;
  dueDate?: string;
  expiresAt?: string;
  reason?: string;
};

function getPaymentBodyTypeError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "결제 등록 정보가 올바른 JSON 객체가 아닙니다.";
  }

  const body = value as Record<string, unknown>;
  const stringFields = [
    ["memberId", "회원"],
    ["planName", "회원권명"],
    ["status", "결제 상태"],
    ["discountReason", "할인 근거"],
    ["feeProductId", "공통 회비 상품"],
    ["benefitCode", "등록 혜택"],
    ["benefitVerificationReason", "1+1 자격 확인 근거"],
    ["dueDate", "납부일"],
    ["expiresAt", "만료일"],
    ["reason", "등록 사유"],
  ] as const;

  for (const [field, label] of stringFields) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return `${label} 값의 형식이 올바르지 않습니다.`;
    }
  }

  for (const [field, label] of [
    ["amount", "결제 금액"],
    ["discountAmount", "할인 금액"],
  ] as const) {
    if (body[field] !== undefined && typeof body[field] !== "number") {
      return `${label} 값의 형식이 올바르지 않습니다.`;
    }
  }

  return null;
}

async function persistPayment({
  branchId,
  db,
  idempotencyFingerprint,
  idempotencyKey,
  selectedBranchId,
  snapshot,
  user,
}: {
  branchId: string;
  db: MockDatabase;
  idempotencyFingerprint: string | null;
  idempotencyKey: string | null;
  selectedBranchId: string | null;
  snapshot: PaymentCreateSnapshot;
  user: AppUser;
}) {
  if (idempotencyKey && idempotencyFingerprint) {
    const replay = resolvePaymentCreateReplay({
      actorUserId: user.id,
      auditLogs: db.auditLogs,
      branchId,
      fingerprint: idempotencyFingerprint,
      idempotencyKey,
      payments: db.payments,
    });

    if (replay.kind === "replay") {
      return jsonOk(createBootstrapPayload(db, user, selectedBranchId ?? branchId), {
        headers: { "Idempotency-Replayed": "true" },
      });
    }

    if (replay.kind === "conflict") {
      return jsonError(
        409,
        "IDEMPOTENCY_CONFLICT",
        replay.reason === "deleted"
          ? "이미 삭제된 결제 등록 요청입니다. 새 등록 화면에서 다시 시작해 주세요."
          : "같은 결제 등록 키로 다른 내용을 저장할 수 없습니다. 새 등록 화면에서 다시 시작해 주세요.",
      );
    }
  }

  const member = db.members.find((candidate) => candidate.id === snapshot.memberId);

  if (!member || member.branchId !== branchId || member.status === "withdrawn") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "선택한 지점의 활성 회원에게만 결제 기록을 등록할 수 있습니다.");
  }

  const paymentId = createRuntimeId("pay");
  const now = new Date().toISOString();
  const { reason: terminalReason, benefitVerificationReason, discountReason, ...paymentSnapshot } = snapshot;
  const isCancelled = snapshot.status === "cancelled";
  const isRefunded = snapshot.status === "refunded";
  const historyReason = isRefunded
    ? `수기 환불 완료 등록: ${terminalReason}`
    : isCancelled
      ? `수기 취소 등록: ${terminalReason}`
      : "수기 결제 등록";
  const nextPayment: Payment = {
    id: paymentId,
    branchId,
    ...paymentSnapshot,
    refundedAmount: isRefunded ? getPaymentNetAmount(snapshot) : 0,
    ...(isCancelled || isRefunded
      ? {
          refundedAt: now,
          refundReason: terminalReason,
        }
      : {}),
    statusHistory: [
      createPaymentStatusHistoryEntry({
        actorUserId: user.id,
        changedAt: now,
        event: "created",
        reason: historyReason,
        status: snapshot.status,
      }),
    ],
  };
  const auditLog: AuditLog = {
    id: createRuntimeId("audit"),
    branchId,
    actorUserId: user.id,
    action: "payment.create",
    targetType: "payment",
    targetId: paymentId,
    before: null,
    after: {
      ...paymentSnapshot,
      ...(terminalReason ? { reason: terminalReason } : {}),
      ...(discountReason
        ? {
            discountVerification: {
              reason: discountReason,
              verifiedByUserId: user.id,
            },
          }
        : {}),
      ...(snapshot.benefitCode
        ? {
            benefitVerification: {
              reason: benefitVerificationReason,
              verifiedByUserId: user.id,
            },
          }
        : {}),
      ...(idempotencyKey && idempotencyFingerprint ? { idempotencyFingerprint, idempotencyKey } : {}),
      statusHistory: nextPayment.statusHistory,
    },
    result: "success",
    message: "수기 결제 기록을 등록했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    payments: [nextPayment, ...db.payments],
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId ?? branchId));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ branchId: string }> },
) {
  const { branchId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "결제 기록을 등록할 권한이 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 결제 기록을 등록할 수 없습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점에 결제 기록을 등록할 수 없습니다.");
  }

  const parsedIdempotencyKey = parsePaymentCreateIdempotencyKey(request.headers.get("idempotency-key"));

  if (!parsedIdempotencyKey.ok) {
    return jsonError(400, "VALIDATION_ERROR", parsedIdempotencyKey.message);
  }

  const rawBody = await request.json().catch(() => null);
  const bodyTypeError = getPaymentBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const body = rawBody as PaymentBody;

  const memberId = body?.memberId?.trim() ?? "";
  let planName = body?.planName?.trim() ?? "";
  const status = body?.status;
  let amount = body?.amount;
  const discountAmount = body?.discountAmount ?? 0;
  const discountReason = body?.discountReason?.trim() ?? "";
  const dueDate = body?.dueDate ?? "";
  let expiresAt = body?.expiresAt ?? "";
  const reason = body?.reason?.trim() ?? "";
  const benefitVerificationReason = body?.benefitVerificationReason?.trim() ?? "";
  const feeProductId = body?.feeProductId?.trim() ?? "";
  const benefitCode = body?.benefitCode;
  let feeQuote: ReturnType<typeof quoteFinalCommonFeeProduct> | null = null;

  if (memberId.length > manualPaymentInputLimits.externalId) {
    return jsonError(400, "VALIDATION_ERROR", "회원 식별자가 너무 깁니다.");
  }

  if (planName.length > manualPaymentInputLimits.planName) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      `회원권명은 ${manualPaymentInputLimits.planName}자 이하로 입력해 주세요.`,
    );
  }

  if (feeProductId.length > manualPaymentInputLimits.externalId) {
    return jsonError(400, "VALIDATION_ERROR", "공통 회비 상품 식별자가 너무 깁니다.");
  }

  if (reason.length > manualPaymentInputLimits.reason) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      `취소 또는 환불 완료 등록 사유는 ${manualPaymentInputLimits.reason}자 이하로 입력해 주세요.`,
    );
  }

  if (benefitCode && benefitCode !== finalCommonPublicServiceBenefit.id) {
    return jsonError(400, "VALIDATION_ERROR", "등록 혜택이 올바르지 않습니다.");
  }

  if (benefitCode && !feeProductId) {
    return jsonError(400, "VALIDATION_ERROR", "공통 회비 상품을 선택해야 1+1 혜택을 적용할 수 있습니다.");
  }

  if (benefitCode && !benefitVerificationReason) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "경찰·군인·소방 1+1 혜택은 자격을 확인한 근거와 사유를 입력해야 합니다.",
    );
  }

  if (benefitVerificationReason.length > manualPaymentInputLimits.verificationReason) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      `1+1 자격 확인 근거는 ${manualPaymentInputLimits.verificationReason}자 이하로 입력해 주세요.`,
    );
  }

  if (feeProductId) {
    try {
      feeQuote = quoteFinalCommonFeeProduct({
        productId: feeProductId,
        startDate: dueDate,
        ...(benefitCode ? { benefitCode } : {}),
      });
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "공통 회비 상품과 적용 기간을 확인해 주세요.");
    }

    planName = feeQuote.planName;
    amount = feeQuote.amount;
    expiresAt = feeQuote.expiresAt ?? "";
  }

  if (!memberId || !planName) {
    return jsonError(400, "VALIDATION_ERROR", "회원과 회원권명이 필요합니다.");
  }

  if (!status || !manualPaymentCreatableStatuses.includes(status as (typeof manualPaymentCreatableStatuses)[number])) {
    return jsonError(400, "VALIDATION_ERROR", "결제 상태가 올바르지 않습니다.");
  }

  if (requiresManualPaymentCreateReason(status) && !reason) {
    return jsonError(400, "VALIDATION_ERROR", "취소 또는 환불 완료 등록 사유를 입력해 주세요.");
  }

  if (!isNonNegativeSafeIntegerPaymentAmount(amount)) {
    return jsonError(400, "VALIDATION_ERROR", "금액은 0원 이상의 원 단위 정수여야 합니다.");
  }

  if (!isNonNegativeSafeIntegerPaymentAmount(discountAmount) || discountAmount > amount) {
    return jsonError(400, "VALIDATION_ERROR", "할인 금액은 결제 금액 이하의 0원 이상 원 단위 정수여야 합니다.");
  }

  if (discountAmount > 0 && !discountReason) {
    return jsonError(400, "VALIDATION_ERROR", "할인 금액을 적용하려면 할인 근거를 입력해 주세요.");
  }

  if (discountReason.length > manualPaymentInputLimits.verificationReason) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      `할인 근거는 ${manualPaymentInputLimits.verificationReason}자 이하로 입력해 주세요.`,
    );
  }

  const dateRangeError = getManualPaymentDateRangeError(dueDate, expiresAt);

  if (dateRangeError) {
    return jsonError(400, "VALIDATION_ERROR", dateRangeError);
  }

  const snapshot = {
    ...createPaymentCreateSnapshot({
      memberId,
      planName,
      status,
      amount,
      discountAmount,
      ...(discountReason ? { discountReason } : {}),
      dueDate,
      expiresAt,
      ...(feeQuote
        ? {
            feeProductId,
            policyVersion: feeQuote.policyVersion,
            ...(feeQuote.registeredMonths ? { registeredMonths: feeQuote.registeredMonths } : {}),
            ...(feeQuote.serviceMonths ? { serviceMonths: feeQuote.serviceMonths } : {}),
            ...(feeQuote.benefitCode ? { benefitCode: feeQuote.benefitCode } : {}),
            ...(feeQuote.benefitCode ? { benefitVerificationReason } : {}),
          }
        : {}),
      ...(reason ? { reason } : {}),
    }),
  };
  const idempotencyKey = parsedIdempotencyKey.value;
  const idempotencyFingerprint = await createPaymentCreateFingerprint(snapshot);

  return withServerDbLock(`payment-create:${user.id}:${branchId}:${idempotencyKey}`, async () => {
    const latestDb = await readServerDb();
    const latestSession = requireSession(request, latestDb);

    if (!latestSession.user) {
      return latestSession.response;
    }

    if (!["owner", "admin"].includes(latestSession.user.role)) {
      return jsonError(403, "FORBIDDEN", "결제 기록을 등록할 권한이 없습니다.");
    }

    if (!getAccessibleBranchIds(latestSession.user, latestDb).includes(branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점에 결제 기록을 등록할 수 없습니다.");
    }

    const latestSelectedScope = requireSelectedBranchScope(request, latestSession.user, latestDb);

    if (latestSelectedScope.response) {
      return latestSelectedScope.response;
    }

    if (latestSelectedScope.selectedBranchId && latestSelectedScope.selectedBranchId !== branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점에 결제 기록을 등록할 수 없습니다.");
    }

    return persistPayment({
      branchId,
      db: latestDb,
      idempotencyFingerprint,
      idempotencyKey,
      selectedBranchId: latestSelectedScope.selectedBranchId,
      snapshot,
      user: latestSession.user,
    });
  });
}
