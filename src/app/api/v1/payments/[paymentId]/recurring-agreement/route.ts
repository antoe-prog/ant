import { NextRequest } from "next/server";
import type { AuditLog, Payment, PaymentRecurringAgreement } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { appendPaymentStatusHistory, createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import {
  createProviderAgreementId,
  getBillingDayOfMonth,
  getNextBillingDateFromExpiry,
  getOnlinePaymentRuntimeReadiness,
} from "@/server/online-payments";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, writeServerDb } from "@/server/db";

export const runtime = "nodejs";

type RecurringAgreementBody = {
  billingDayOfMonth?: number;
  nextBillingDate?: string;
  reason?: string;
};

function isDateOnly(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`)));
}

function canCreateRecurringAgreement(payment: Payment) {
  return ["paid", "scheduled", "overdue", "expiringSoon", "partially_refunded"].includes(payment.status);
}

function resolveNextBillingDate(payment: Payment, body: RecurringAgreementBody | null) {
  if (body?.nextBillingDate && isDateOnly(body.nextBillingDate)) {
    return body.nextBillingDate;
  }

  return getNextBillingDateFromExpiry(payment.expiresAt);
}

function resolveBillingDay(nextBillingDate: string, body: RecurringAgreementBody | null) {
  if (
    typeof body?.billingDayOfMonth === "number" &&
    Number.isInteger(body.billingDayOfMonth) &&
    body.billingDayOfMonth >= 1 &&
    body.billingDayOfMonth <= 28
  ) {
    return body.billingDayOfMonth;
  }

  return getBillingDayOfMonth(nextBillingDate);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "정기결제 약정 생성 권한이 없습니다.");
  }

  const payment = db.payments.find((candidate) => candidate.id === paymentId);

  if (!payment) {
    return jsonError(404, "NOT_FOUND", "결제 기록을 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(payment.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 결제만 정기결제로 전환할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== payment.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 결제만 정기결제로 전환할 수 있습니다.");
  }

  if (!canCreateRecurringAgreement(payment)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "완료, 납부 예정, 미납, 만료 예정 또는 부분 환불 결제만 정기결제 약정을 만들 수 있습니다.");
  }

  if (payment.recurringAgreement && payment.recurringAgreement.status !== "cancelled") {
    return jsonError(409, "BUSINESS_RULE_FAILED", "이미 활성 또는 대기 중인 정기결제 약정이 있습니다.", {
      providerAgreementId: payment.recurringAgreement.providerAgreementId,
      status: payment.recurringAgreement.status,
    });
  }

  const body = (await request.json().catch(() => null)) as RecurringAgreementBody | null;
  const nextBillingDate = resolveNextBillingDate(payment, body);

  if (!isDateOnly(nextBillingDate)) {
    return jsonError(400, "VALIDATION_ERROR", "다음 청구일은 YYYY-MM-DD 형식이어야 합니다.");
  }

  const billingDayOfMonth = resolveBillingDay(nextBillingDate, body);
  const paymentRuntime = getOnlinePaymentRuntimeReadiness();

  if (!paymentRuntime.ok) {
    return jsonError(503, "PAYMENT_RUNTIME_NOT_READY", "온라인 결제 설정 확인이 필요합니다.");
  }

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
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
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
    ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? payment.branchId),
    recurringAgreement,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return response;
  }

  if (!["owner", "admin"].includes(user.role)) {
    return jsonError(403, "FORBIDDEN", "정기결제 약정 해지 권한이 없습니다.");
  }

  const payment = db.payments.find((candidate) => candidate.id === paymentId);

  if (!payment) {
    return jsonError(404, "NOT_FOUND", "결제 기록을 찾을 수 없습니다.");
  }

  if (!getAccessibleBranchIds(user, db).includes(payment.branchId)) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 정기결제 약정만 해지할 수 있습니다.");
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return selectedScope.response;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== payment.branchId) {
    return jsonError(403, "FORBIDDEN", "선택한 지점의 정기결제 약정만 해지할 수 있습니다.");
  }

  if (!payment.recurringAgreement || payment.recurringAgreement.status === "cancelled") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "해지할 활성 정기결제 약정이 없습니다.");
  }

  const body = (await request.json().catch(() => null)) as RecurringAgreementBody | null;
  const reason = body?.reason?.trim() ?? "";

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "정기결제 해지 사유가 필요합니다.");
  }

  const now = new Date().toISOString();
  const recurringAgreement: PaymentRecurringAgreement = {
    ...payment.recurringAgreement,
    cancelReason: reason,
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
      reason,
      status: payment.status,
    }),
  );
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
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
    ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? payment.branchId),
    recurringAgreement,
  });
}
