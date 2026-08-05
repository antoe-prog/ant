import { NextRequest } from "next/server";
import type { AuditLog, Payment, PaymentRecurringAgreement } from "@/lib/domain";
import { createFamilySafeRecurringAgreement } from "@/lib/family-payment-privacy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { appendPaymentStatusHistory, createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import {
  createProviderAgreementId,
  getBillingDayOfMonth,
  getNextBillingDateFromExpiry,
  getOnlinePaymentRuntimeReadiness,
} from "@/server/online-payments";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";
import { RuntimeStateMergeConflictError } from "@/server/runtime-state-merge";

export const runtime = "nodejs";

type RecurringAgreementAction = "create" | "cancel";

function isDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);

  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function canCreateRecurringAgreement(payment: Payment) {
  return ["paid", "scheduled", "overdue", "expiringSoon", "partially_refunded"].includes(payment.status);
}

async function readRecurringAgreementBody(request: NextRequest) {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return { body: {} as Record<string, unknown> } as const;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { response: jsonError(400, "VALIDATION_ERROR", "정기결제 요청 형식이 올바르지 않습니다.") } as const;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { response: jsonError(400, "VALIDATION_ERROR", "정기결제 요청 형식이 올바르지 않습니다.") } as const;
  }

  return { body: parsed as Record<string, unknown> } as const;
}

function validateCreateBody(payment: Payment, body: Record<string, unknown>) {
  const requestedDate = body.nextBillingDate;
  const requestedBillingDay = body.billingDayOfMonth;

  if (requestedDate !== undefined && (typeof requestedDate !== "string" || !isDateOnly(requestedDate))) {
    return { response: jsonError(400, "VALIDATION_ERROR", "다음 청구일은 실제 달력의 YYYY-MM-DD 형식이어야 합니다.") } as const;
  }

  if (
    requestedBillingDay !== undefined &&
    (typeof requestedBillingDay !== "number" ||
      !Number.isInteger(requestedBillingDay) ||
      requestedBillingDay < 1 ||
      requestedBillingDay > 28)
  ) {
    return { response: jsonError(400, "VALIDATION_ERROR", "청구일은 1일부터 28일까지의 정수여야 합니다.") } as const;
  }

  const nextBillingDate = requestedDate ?? getNextBillingDateFromExpiry(payment.expiresAt);
  const billingDayOfMonth = requestedBillingDay ?? getBillingDayOfMonth(nextBillingDate);

  if (!isDateOnly(nextBillingDate)) {
    return { response: jsonError(400, "VALIDATION_ERROR", "다음 청구일은 실제 달력의 YYYY-MM-DD 형식이어야 합니다.") } as const;
  }

  return { billingDayOfMonth, nextBillingDate } as const;
}

function validateCancelBody(body: Record<string, unknown>) {
  if (body.reason !== undefined && typeof body.reason !== "string") {
    return { response: jsonError(400, "VALIDATION_ERROR", "정기결제 해지 사유 형식이 올바르지 않습니다.") } as const;
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!reason || reason.length > 500) {
    return { response: jsonError(400, "VALIDATION_ERROR", "정기결제 해지 사유를 500자 이내로 입력해 주세요.") } as const;
  }

  return { reason } as const;
}

async function requireRecurringAgreementContext(request: NextRequest, paymentId: string, action: RecurringAgreementAction) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);
  const creating = action === "create";

  if (!user) {
    return { response } as const;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return {
      response: jsonError(403, "FORBIDDEN", creating ? "정기결제 약정 생성 권한이 없습니다." : "정기결제 약정 해지 권한이 없습니다."),
    } as const;
  }

  const payment = db.payments.find((candidate) => candidate.id === paymentId);

  if (!payment) {
    return { response: jsonError(404, "NOT_FOUND", "결제 기록을 찾을 수 없습니다.") } as const;
  }

  if (!getAccessibleBranchIds(user, db).includes(payment.branchId)) {
    return {
      response: jsonError(
        403,
        "FORBIDDEN",
        creating ? "선택한 지점의 결제만 정기결제로 전환할 수 있습니다." : "선택한 지점의 정기결제 약정만 해지할 수 있습니다.",
      ),
    } as const;
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { response: selectedScope.response } as const;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== payment.branchId) {
    return {
      response: jsonError(
        403,
        "FORBIDDEN",
        creating ? "선택한 지점의 결제만 정기결제로 전환할 수 있습니다." : "선택한 지점의 정기결제 약정만 해지할 수 있습니다.",
      ),
    } as const;
  }

  if (creating) {
    if (!canCreateRecurringAgreement(payment)) {
      return {
        response: jsonError(
          422,
          "BUSINESS_RULE_FAILED",
          "완료, 납부 예정, 미납, 만료 예정 또는 부분 환불 결제만 정기결제 약정을 만들 수 있습니다.",
        ),
      } as const;
    }

    if (payment.recurringAgreement && payment.recurringAgreement.status !== "cancelled") {
      return {
        response: jsonError(409, "BUSINESS_RULE_FAILED", "이미 활성 또는 대기 중인 정기결제 약정이 있습니다.", {
          providerAgreementId: payment.recurringAgreement.providerAgreementId,
          status: payment.recurringAgreement.status,
        }),
      } as const;
    }
  } else if (!payment.recurringAgreement || payment.recurringAgreement.status === "cancelled") {
    return { response: jsonError(422, "BUSINESS_RULE_FAILED", "해지할 활성 정기결제 약정이 없습니다.") } as const;
  }

  return { db, payment, selectedBranchId: selectedScope.selectedBranchId, user } as const;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const initialContext = await requireRecurringAgreementContext(request, paymentId, "create");

  if ("response" in initialContext) {
    return initialContext.response;
  }

  const parsedBody = await readRecurringAgreementBody(request);

  if ("response" in parsedBody) {
    return parsedBody.response;
  }

  const initialValidation = validateCreateBody(initialContext.payment, parsedBody.body);

  if ("response" in initialValidation) {
    return initialValidation.response;
  }

  try {
    return await withServerDbLock(`payment-mutation:${paymentId}`, async () => {
      const context = await requireRecurringAgreementContext(request, paymentId, "create");

      if ("response" in context) {
        return context.response;
      }

      const validation = validateCreateBody(context.payment, parsedBody.body);

      if ("response" in validation) {
        return validation.response;
      }

      const paymentRuntime = getOnlinePaymentRuntimeReadiness();

      if (!paymentRuntime.ok) {
        return jsonError(503, "PAYMENT_RUNTIME_NOT_READY", "온라인 결제 설정 확인이 필요합니다.");
      }

      const { db, payment, selectedBranchId, user } = context;
      const { billingDayOfMonth, nextBillingDate } = validation;
      const now = new Date().toISOString();
      const provider = paymentRuntime.provider;
      const recurringAgreement: PaymentRecurringAgreement = {
        billingDayOfMonth,
        interval: "monthly",
        nextBillingDate,
        provider,
        providerAgreementId: createProviderAgreementId(payment.id),
        requestedAt: now,
        requestedByUserId: user.id,
        status: provider === "mock" ? "active" : "pending",
        ...(provider === "mock" ? { activatedAt: now } : {}),
      };
      const nextPayment = appendPaymentStatusHistory(
        {
          ...payment,
          recurringAgreement,
        },
        createPaymentStatusHistoryEntry({
          actorUserId: user.id,
          changedAt: now,
          event: "recurring_agreement",
          reason: provider === "mock" ? "정기결제 약정 활성화" : "정기결제 약정 요청",
          status: payment.status,
        }),
      );
      const auditLog: AuditLog = {
        id: createRuntimeId("audit"),
        branchId: payment.branchId,
        actorUserId: user.id,
        action: "payment.recurring_agreement.create",
        targetType: "payment",
        targetId: payment.id,
        before: {
          recurringAgreement: payment.recurringAgreement ?? null,
          status: payment.status,
        },
        after: {
          recurringAgreement,
          status: nextPayment.status,
        },
        result: "success",
        message: "정기결제 약정을 생성했습니다.",
        createdAt: now,
      };
      const nextDb = await writeServerDb({
        ...db,
        payments: db.payments.map((candidate) => (candidate.id === payment.id ? nextPayment : candidate)),
        auditLogs: [auditLog, ...db.auditLogs],
      });

      return jsonOk({
        ...createBootstrapPayload(nextDb, user, selectedBranchId ?? payment.branchId),
        recurringAgreement: createFamilySafeRecurringAgreement(recurringAgreement),
      });
    });
  } catch (error) {
    if (error instanceof RuntimeStateMergeConflictError) {
      return jsonError(409, "CONCURRENT_MODIFICATION", "결제 상태가 동시에 변경되었습니다. 다시 시도해 주세요.");
    }

    throw error;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const initialContext = await requireRecurringAgreementContext(request, paymentId, "cancel");

  if ("response" in initialContext) {
    return initialContext.response;
  }

  const parsedBody = await readRecurringAgreementBody(request);

  if ("response" in parsedBody) {
    return parsedBody.response;
  }

  const validation = validateCancelBody(parsedBody.body);

  if ("response" in validation) {
    return validation.response;
  }

  try {
    return await withServerDbLock(`payment-mutation:${paymentId}`, async () => {
      const context = await requireRecurringAgreementContext(request, paymentId, "cancel");

      if ("response" in context) {
        return context.response;
      }

      const { db, payment, selectedBranchId, user } = context;

      if (!payment.recurringAgreement || payment.recurringAgreement.status === "cancelled") {
        return jsonError(422, "BUSINESS_RULE_FAILED", "해지할 활성 정기결제 약정이 없습니다.");
      }

      const now = new Date().toISOString();
      const recurringAgreement: PaymentRecurringAgreement = {
        ...payment.recurringAgreement,
        cancelReason: validation.reason,
        cancelledAt: now,
        status: "cancelled",
      };
      const nextPayment = appendPaymentStatusHistory(
        {
          ...payment,
          recurringAgreement,
        },
        createPaymentStatusHistoryEntry({
          actorUserId: user.id,
          changedAt: now,
          event: "recurring_agreement",
          reason: validation.reason,
          status: payment.status,
        }),
      );
      const auditLog: AuditLog = {
        id: createRuntimeId("audit"),
        branchId: payment.branchId,
        actorUserId: user.id,
        action: "payment.recurring_agreement.cancel",
        targetType: "payment",
        targetId: payment.id,
        before: {
          recurringAgreement: payment.recurringAgreement,
          status: payment.status,
        },
        after: {
          recurringAgreement,
          status: nextPayment.status,
        },
        result: "success",
        message: "정기결제 약정을 해지했습니다.",
        createdAt: now,
      };
      const nextDb = await writeServerDb({
        ...db,
        payments: db.payments.map((candidate) => (candidate.id === payment.id ? nextPayment : candidate)),
        auditLogs: [auditLog, ...db.auditLogs],
      });

      return jsonOk({
        ...createBootstrapPayload(nextDb, user, selectedBranchId ?? payment.branchId),
        recurringAgreement: createFamilySafeRecurringAgreement(recurringAgreement),
      });
    });
  } catch (error) {
    if (error instanceof RuntimeStateMergeConflictError) {
      return jsonError(409, "CONCURRENT_MODIFICATION", "결제 상태가 동시에 변경되었습니다. 다시 시도해 주세요.");
    }

    throw error;
  }
}
