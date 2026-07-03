import { NextRequest } from "next/server";
import type { AuditLog, Payment, PaymentStatus } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import { readServerDb, writeServerDb } from "@/server/db";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

const paymentStatuses: PaymentStatus[] = [
  "scheduled",
  "paid",
  "overdue",
  "cancelled",
  "refunded",
  "partially_refunded",
  "expiringSoon",
];

type PaymentBody = {
  memberId?: string;
  planName?: string;
  status?: PaymentStatus;
  amount?: number;
  discountAmount?: number;
  dueDate?: string;
  expiresAt?: string;
};

function isDateOnly(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`)));
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

  const body = (await request.json().catch(() => null)) as PaymentBody | null;
  const memberId = body?.memberId?.trim() ?? "";
  const planName = body?.planName?.trim() ?? "";
  const status = body?.status;
  const amount = body?.amount;
  const discountAmount = body?.discountAmount ?? 0;
  const dueDate = body?.dueDate ?? "";
  const expiresAt = body?.expiresAt ?? "";

  if (!memberId || !planName) {
    return jsonError(400, "VALIDATION_ERROR", "회원과 회원권명이 필요합니다.");
  }

  if (!status || !paymentStatuses.includes(status)) {
    return jsonError(400, "VALIDATION_ERROR", "결제 상태가 올바르지 않습니다.");
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return jsonError(400, "VALIDATION_ERROR", "금액은 0원 이상의 숫자여야 합니다.");
  }

  if (typeof discountAmount !== "number" || !Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > amount) {
    return jsonError(400, "VALIDATION_ERROR", "할인 금액은 결제 금액 이하의 0원 이상 숫자여야 합니다.");
  }

  if (!isDateOnly(dueDate) || !isDateOnly(expiresAt)) {
    return jsonError(400, "VALIDATION_ERROR", "납부일과 만료일은 YYYY-MM-DD 형식이어야 합니다.");
  }

  const member = db.members.find((candidate) => candidate.id === memberId);

  if (!member || member.branchId !== branchId || member.status === "withdrawn") {
    return jsonError(422, "BUSINESS_RULE_FAILED", "선택한 지점의 활성 회원에게만 결제 기록을 등록할 수 있습니다.");
  }

  const paymentId = `pay-${Date.now()}`;
  const now = new Date().toISOString();
  const historyReason = status === "refunded" ? "수기 결제 등록과 동시에 환불 완료 처리" : "수기 결제 등록";
  const nextPayment: Payment = {
    id: paymentId,
    branchId,
    memberId,
    planName,
    status,
    amount: Math.round(amount),
    discountAmount: Math.round(discountAmount),
    dueDate,
    expiresAt,
    refundedAmount: status === "refunded" ? Math.round(amount) : 0,
    refundedAt: status === "refunded" ? now : undefined,
    statusHistory: [
      createPaymentStatusHistoryEntry({
        actorUserId: user.id,
        changedAt: now,
        event: "created",
        reason: historyReason,
        status,
      }),
    ],
  };
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId,
    actorUserId: user.id,
    action: "payment.create",
    targetType: "payment",
    targetId: paymentId,
    before: null,
    after: {
      memberId: nextPayment.memberId,
      planName: nextPayment.planName,
      status: nextPayment.status,
      amount: nextPayment.amount,
      discountAmount: nextPayment.discountAmount ?? 0,
      expiresAt: nextPayment.expiresAt,
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

  return jsonOk(createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId ?? branchId));
}
