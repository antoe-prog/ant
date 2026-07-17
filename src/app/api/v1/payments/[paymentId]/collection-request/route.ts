import { NextRequest } from "next/server";
import type { AuditLog, FamilyPaymentMethod } from "@/lib/domain";
import { getFamilyPaymentCheckoutAccess } from "@/lib/payment-checkout-access";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";

export const runtime = "nodejs";

const paymentMethods = new Set<FamilyPaymentMethod>(["bankTransfer", "card", "virtualAccount", "accountTransfer"]);

function readText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const initialDb = await readServerDb();
  const initialSession = requireSession(request, initialDb);

  if (!initialSession.user) {
    return initialSession.response;
  }

  if (initialSession.user.role !== "member" && initialSession.user.role !== "guardian") {
    return jsonError(403, "FORBIDDEN", "회원 또는 학부모 계정에서 납부를 요청해 주세요.");
  }

  return withServerDbLock(`payment-collection-request:${paymentId}`, async () => {
    const db = await readServerDb();
    const { user, response } = requireSession(request, db);

    if (!user) {
      return response;
    }

    if (user.role !== "member" && user.role !== "guardian") {
      return jsonError(403, "FORBIDDEN", "회원 또는 학부모 계정에서 납부를 요청해 주세요.");
    }

    const payment = db.payments.find((candidate) => candidate.id === paymentId);
    const member = payment ? db.members.find((candidate) => candidate.id === payment.memberId) : undefined;

    if (!payment || !member) {
      return jsonError(404, "NOT_FOUND", "결제 대상 정보를 찾을 수 없습니다.");
    }

    const selectedScope = requireSelectedBranchScope(request, user, db);

    if (selectedScope.response) {
      return selectedScope.response;
    }

    if (!selectedScope.branchIds.includes(payment.branchId)) {
      return jsonError(403, "FORBIDDEN", "선택한 지점의 결제만 요청할 수 있습니다.");
    }

    const access = getFamilyPaymentCheckoutAccess(user, payment, member);

    if (!access.canOpen) {
      return jsonError(403, "FORBIDDEN", access.reason);
    }

    if (payment.collectionRequest?.status === "pending") {
      return jsonOk({
        ...createBootstrapPayload(db, user, selectedScope.selectedBranchId),
        collectionRequest: payment.collectionRequest,
      });
    }

    let body: Record<string, unknown>;

    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError(400, "VALIDATION_ERROR", "납부 요청 정보를 확인해 주세요.");
    }

    const payerName = readText(body.payerName, 50);
    const payerPhone = readText(body.payerPhone, 20).replace(/\D/g, "");
    const method = body.method;
    const methodLabel = readText(body.methodLabel, 60);

    if (!payerName || !/^01\d{8,9}$/.test(payerPhone) || typeof method !== "string" || !paymentMethods.has(method as FamilyPaymentMethod) || !methodLabel) {
      return jsonError(422, "VALIDATION_ERROR", "이름, 휴대전화와 희망 납부 방법을 확인해 주세요.");
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
      ...createBootstrapPayload(nextDb, user, selectedScope.selectedBranchId),
      collectionRequest,
    });
  });
}
