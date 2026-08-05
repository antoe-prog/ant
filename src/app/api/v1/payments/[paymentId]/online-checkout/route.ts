import { NextRequest } from "next/server";
import type { AuditLog, Payment } from "@/lib/domain";
import { createFamilySafeOnlinePayment } from "@/lib/family-payment-privacy";
import { getAccessibleBranchIds } from "@/lib/mock-api";
import { appendPaymentStatusHistory, createPaymentStatusHistoryEntry } from "@/lib/payment-lifecycle";
import {
  createCheckoutUrl,
  createProviderPaymentId,
  getOnlinePaymentAmount,
  getOnlinePaymentRuntimeReadiness,
} from "@/server/online-payments";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

function canCreateOnlineCheckout(payment: Payment) {
  return ["scheduled", "overdue", "expiringSoon", "partially_refunded"].includes(payment.status);
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
    return jsonError(403, "FORBIDDEN", "온라인 결제 요청 권한이 없습니다.");
  }

  return withServerDbLock(`payment-mutation:${paymentId}`, async () => {
    const latestDb = await readServerDb();
    const latestSession = requireSession(request, latestDb);

    if (!latestSession.user) {
      return latestSession.response;
    }

    if (!["owner", "admin"].includes(latestSession.user.role)) {
      return jsonError(403, "FORBIDDEN", "온라인 결제 요청 권한이 없습니다.");
    }

    const payment = latestDb.payments.find((candidate) => candidate.id === paymentId);

    if (!payment) {
      return jsonError(404, "NOT_FOUND", "결제 기록을 찾을 수 없습니다.");
    }

    if (!getAccessibleBranchIds(latestSession.user, latestDb).includes(payment.branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 결제만 요청할 수 있습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, latestSession.user, latestDb);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    if (selectedScope.selectedBranchId && selectedScope.selectedBranchId !== payment.branchId) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 결제만 요청할 수 있습니다.");
    }

    if (!canCreateOnlineCheckout(payment)) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "납부 예정, 미납, 만료 예정 또는 부분 환불 결제만 온라인 요청할 수 있습니다.");
    }

    if (payment.collectionRequest?.status === "pending") {
      return jsonError(409, "BUSINESS_RULE_FAILED", "회원이 요청한 납부 확인이 진행 중입니다.");
    }

    if (payment.onlinePayment?.status === "pending") {
      return jsonError(409, "BUSINESS_RULE_FAILED", "이미 대기 중인 온라인 결제 요청이 있습니다.", {
        checkoutUrl: payment.onlinePayment.checkoutUrl,
        providerPaymentId: payment.onlinePayment.providerPaymentId,
      });
    }

    const amount = getOnlinePaymentAmount(payment);

    if (amount <= 0) {
      return jsonError(422, "BUSINESS_RULE_FAILED", "온라인으로 요청할 결제 금액이 없습니다.");
    }

    const paymentRuntime = getOnlinePaymentRuntimeReadiness();

    if (!paymentRuntime.ok) {
      return jsonError(503, "PAYMENT_RUNTIME_NOT_READY", "온라인 결제 설정 확인이 필요합니다.");
    }

    const now = new Date().toISOString();
    const providerPaymentId = createProviderPaymentId(payment.id);
    const onlinePayment = {
      amount,
      checkoutUrl: createCheckoutUrl(providerPaymentId),
      provider: paymentRuntime.provider,
      providerPaymentId,
      requestedAt: now,
      requestedByUserId: latestSession.user.id,
      status: "pending" as const,
    };
    const nextPayment = appendPaymentStatusHistory(
      {
        ...payment,
        onlinePayment,
      },
      createPaymentStatusHistoryEntry({
        actorUserId: latestSession.user.id,
        changedAt: now,
        event: "online_checkout",
        reason: "온라인 결제 요청 생성",
        status: payment.status,
      }),
    );
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: payment.branchId,
      actorUserId: latestSession.user.id,
      action: "payment.online_checkout.create",
      targetType: "payment",
      targetId: payment.id,
      before: {
        onlinePayment: payment.onlinePayment ?? null,
        status: payment.status,
      },
      after: {
        onlinePayment,
        status: nextPayment.status,
      },
      result: "success",
      message: "온라인 결제 요청을 생성했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...latestDb,
      payments: latestDb.payments.map((candidate) => (candidate.id === payment.id ? nextPayment : candidate)),
      auditLogs: [auditLog, ...latestDb.auditLogs],
    });

    return jsonOk({
      ...createBootstrapPayload(nextDb, latestSession.user, selectedScope.selectedBranchId ?? payment.branchId),
      checkout: createFamilySafeOnlinePayment(onlinePayment),
    });
  });
}
