import { NextRequest } from "next/server";
import type { AuditLog, Payment } from "@/lib/domain";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import {
  getManualPaymentManagementBlockReason,
  validateManualPaymentUpdate,
} from "@/lib/manual-payment-management";
import { appendPaymentStatusHistory, createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, writeServerDb } from "@/server/db";

export const runtime = "nodejs";

function getPaymentSnapshot(payment: Payment) {
  return {
    amount: payment.amount,
    branchId: payment.branchId,
    discountAmount: payment.discountAmount ?? 0,
    dueDate: payment.dueDate,
    expiresAt: payment.expiresAt,
    memberId: payment.memberId,
    planName: payment.planName,
    status: payment.status,
  };
}

function hasEditablePaymentChange(payment: Payment, nextPayment: Payment) {
  const before = getPaymentSnapshot(payment);
  const after = getPaymentSnapshot(nextPayment);

  return Object.keys(before).some((key) => before[key as keyof typeof before] !== after[key as keyof typeof after]);
}

async function requireManualPaymentRequestContext(request: NextRequest, paymentId: string) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { response } as const;
  }

  if (user.role !== "owner" && user.role !== "admin") {
    return { response: jsonError(403, "FORBIDDEN", "수기 결제 기록을 관리할 권한이 없습니다.") } as const;
  }

  const payment = db.payments.find((candidate) => candidate.id === paymentId);

  if (!payment) {
    return { response: jsonError(404, "NOT_FOUND", "결제 기록을 찾을 수 없습니다.") } as const;
  }

  if (!getAccessibleBranchIds(user, db).includes(payment.branchId)) {
    return { response: jsonError(403, "FORBIDDEN", "선택한 지점의 결제 기록만 관리할 수 있습니다.") } as const;
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { response: selectedScope.response } as const;
  }

  if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== payment.branchId) {
    return { response: jsonError(403, "FORBIDDEN", "선택한 지점의 결제 기록만 관리할 수 있습니다.") } as const;
  }

  const blockReason = getManualPaymentManagementBlockReason(payment);

  if (blockReason) {
    return { response: jsonError(422, "BUSINESS_RULE_FAILED", blockReason) } as const;
  }

  return { db, payment, selectedBranchId: selectedScope.selectedBranchId, user } as const;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const context = await requireManualPaymentRequestContext(request, paymentId);

  if ("response" in context) {
    return context.response;
  }

  const body = await request.json().catch(() => null);
  const validated = validateManualPaymentUpdate(body);

  if (!validated.ok) {
    return jsonError(400, "VALIDATION_ERROR", validated.message);
  }

  const { db, payment, selectedBranchId, user } = context;
  const now = new Date().toISOString();
  const value = validated.value;
  const statusChanged = payment.status !== value.status;
  const updatedPaymentBase: Payment = {
    ...payment,
    amount: value.amount,
    discountAmount: value.discountAmount,
    dueDate: value.dueDate,
    expiresAt: value.expiresAt,
    planName: value.planName,
    status: value.status,
    ...(statusChanged && value.status === "cancelled"
      ? { refundedAt: now, refundReason: value.reason }
      : statusChanged && payment.status === "cancelled"
        ? { refundedAt: undefined, refundReason: undefined }
        : {}),
  };

  if (!hasEditablePaymentChange(payment, updatedPaymentBase)) {
    return jsonError(422, "BUSINESS_RULE_FAILED", "변경된 결제 정보가 없습니다.");
  }

  const nextPayment = statusChanged
    ? appendPaymentStatusHistory(
        updatedPaymentBase,
        createPaymentStatusHistoryEntry({
          actorUserId: user.id,
          changedAt: now,
          event: "status_changed",
          reason: `수기 결제 상태 변경: ${value.reason}`,
          status: value.status,
        }),
      )
    : updatedPaymentBase;
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: payment.branchId,
    actorUserId: user.id,
    action: "payment.update",
    targetType: "payment",
    targetId: payment.id,
    before: getPaymentSnapshot(payment),
    after: {
      ...getPaymentSnapshot(nextPayment),
      reason: value.reason,
    },
    result: "success",
    message: "수기 결제 기록을 수정했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    payments: db.payments.map((candidate) => (candidate.id === payment.id ? nextPayment : candidate)),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId ?? payment.branchId));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const context = await requireManualPaymentRequestContext(request, paymentId);

  if ("response" in context) {
    return context.response;
  }

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!reason) {
    return jsonError(400, "VALIDATION_ERROR", "삭제 사유를 입력해 주세요.");
  }

  const { db, payment, selectedBranchId, user } = context;
  const now = new Date().toISOString();
  const auditLog: AuditLog = {
    id: `audit-${Date.now()}-${db.auditLogs.length + 1}`,
    branchId: payment.branchId,
    actorUserId: user.id,
    action: "payment.delete",
    targetType: "payment",
    targetId: payment.id,
    before: getPaymentSnapshot(payment),
    after: {
      deletedAt: now,
      reason,
    },
    result: "success",
    message: "수기 결제 기록을 삭제했습니다.",
    createdAt: now,
  };
  const nextDb = await writeServerDb({
    ...db,
    payments: db.payments.filter((candidate) => candidate.id !== payment.id),
    auditLogs: [auditLog, ...db.auditLogs],
  });

  return jsonOk(createBootstrapPayload(nextDb, user, selectedBranchId ?? payment.branchId));
}
