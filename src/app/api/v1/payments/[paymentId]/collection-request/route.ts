import { NextRequest } from "next/server";
import type { AuditLog, FamilyPaymentMethod } from "@/lib/domain";
import { createFamilySafeCollectionRequest } from "@/lib/family-payment-privacy";
import {
  getFamilyPaymentRequestBodyTypeError,
  isValidFamilyPaymentMethodLabel,
} from "@/lib/family-payment-request-policy";
import { getFamilyPaymentCheckoutAccess } from "@/lib/payment-checkout-access";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const paymentMethods = new Set<FamilyPaymentMethod>(["bankTransfer", "card", "virtualAccount", "accountTransfer"]);

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function requireCollectionRequestContext(request: NextRequest, paymentId: string) {
  const db = await readServerDb();
  const { user, response } = requireSession(request, db);

  if (!user) {
    return { ok: false as const, response };
  }

  if (user.role !== "member" && user.role !== "guardian") {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", "회원 또는 학부모 계정에서 납부를 요청해 주세요."),
    };
  }

  const payment = db.payments.find((candidate) => candidate.id === paymentId);
  const member = payment ? db.members.find((candidate) => candidate.id === payment.memberId) : undefined;

  if (!payment || !member) {
    return {
      ok: false as const,
      response: jsonError(404, "NOT_FOUND", "결제 대상 정보를 찾을 수 없습니다."),
    };
  }

  const selectedScope = requireSelectedBranchScope(request, user, db);

  if (selectedScope.response) {
    return { ok: false as const, response: selectedScope.response };
  }

  if (!selectedScope.branchIds.includes(payment.branchId)) {
    return {
      ok: false as const,
      response: jsonError(404, "NOT_FOUND", "결제 대상 정보를 찾을 수 없습니다."),
    };
  }

  const access = getFamilyPaymentCheckoutAccess(user, payment, member);

  if (access.state === "forbidden") {
    return {
      ok: false as const,
      response: jsonError(404, "NOT_FOUND", "결제 대상 정보를 찾을 수 없습니다."),
    };
  }

  if (!access.canOpen) {
    return {
      ok: false as const,
      response: jsonError(403, "FORBIDDEN", access.reason),
    };
  }

  return {
    db,
    ok: true as const,
    payment,
    selectedBranchId: selectedScope.selectedBranchId,
    user,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const initialContext = await requireCollectionRequestContext(request, paymentId);

  if (!initialContext.ok) {
    return initialContext.response;
  }

  if (initialContext.payment.onlinePayment?.status === "pending") {
    return jsonError(409, "BUSINESS_RULE_FAILED", "이미 대기 중인 온라인 결제 요청이 있습니다.");
  }

  if (initialContext.payment.collectionRequest?.status === "pending") {
    return jsonOk({
      ...createBootstrapPayload(initialContext.db, initialContext.user, initialContext.selectedBranchId),
      collectionRequest: createFamilySafeCollectionRequest(initialContext.payment.collectionRequest, initialContext.user.id),
    });
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "납부 요청 정보를 확인해 주세요.");
  }

  const bodyTypeError = getFamilyPaymentRequestBodyTypeError(rawBody);

  if (bodyTypeError) {
    return jsonError(400, "VALIDATION_ERROR", bodyTypeError);
  }

  const candidate = rawBody as Record<string, unknown>;
  const payerName = readText(candidate.payerName);
  const payerPhone = readText(candidate.payerPhone).replace(/\D/g, "");
  const method = candidate.method;
  const methodLabel = readText(candidate.methodLabel);

  if (
    !payerName ||
    !/^01\d{8,9}$/.test(payerPhone) ||
    typeof method !== "string" ||
    !paymentMethods.has(method as FamilyPaymentMethod) ||
    !methodLabel ||
    !isValidFamilyPaymentMethodLabel(method as FamilyPaymentMethod, methodLabel)
  ) {
    return jsonError(422, "VALIDATION_ERROR", "이름, 휴대전화와 희망 납부 방법을 확인해 주세요.");
  }

  return withServerDbLock(`payment-mutation:${paymentId}`, async () => {
    const currentContext = await requireCollectionRequestContext(request, paymentId);

    if (!currentContext.ok) {
      return currentContext.response;
    }

    const { db, payment, selectedBranchId, user } = currentContext;

    if (payment.onlinePayment?.status === "pending") {
      return jsonError(409, "BUSINESS_RULE_FAILED", "이미 대기 중인 온라인 결제 요청이 있습니다.");
    }

    if (payment.collectionRequest?.status === "pending") {
      return jsonOk({
        ...createBootstrapPayload(db, user, selectedBranchId),
        collectionRequest: createFamilySafeCollectionRequest(payment.collectionRequest, user.id),
      });
    }

    const now = new Date().toISOString();
    const collectionRequest = {
      id: createRuntimeId("payment-request"),
      method: method as FamilyPaymentMethod,
      methodLabel,
      payerName,
      payerPhone,
      requestedAt: now,
      requestedByUserId: user.id,
      status: "pending" as const,
    };
    const nextPayment = { ...payment, collectionRequest };
    const auditLog: AuditLog = {
      id: createRuntimeId("audit"),
      branchId: payment.branchId,
      actorUserId: user.id,
      action: "payment.update",
      targetType: "payment",
      targetId: payment.id,
      before: { collectionRequest: payment.collectionRequest ?? null },
      after: {
        collectionRequest: {
          id: collectionRequest.id,
          method: collectionRequest.method,
          requestedAt: collectionRequest.requestedAt,
          status: collectionRequest.status,
        },
      },
      result: "success",
      message: "회원 납부 요청을 접수했습니다.",
      createdAt: now,
    };
    const nextDb = await writeServerDb({
      ...db,
      payments: db.payments.map((candidate) => (candidate.id === payment.id ? nextPayment : candidate)),
      auditLogs: [auditLog, ...db.auditLogs],
    });

    return jsonOk({
      ...createBootstrapPayload(nextDb, user, selectedBranchId),
      collectionRequest: createFamilySafeCollectionRequest(collectionRequest, user.id),
    });
  });
}
