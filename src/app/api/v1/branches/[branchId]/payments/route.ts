import { NextRequest } from "next/server";
import type { AppUser, AuditLog, MockDatabase, Payment, PaymentStatus } from "@/lib/domain";
import {
  getManualPaymentDateRangeError,
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
import { readServerDb, withServerDbLock, writeServerDb } from "@/server/db";
import { createRuntimeId } from "@/server/runtime-id";
import { createBootstrapPayload, jsonError, jsonOk, requireSelectedBranchScope, requireSession } from "@/server/api";

export const runtime = "nodejs";

type PaymentBody = {
  memberId?: string;
  planName?: string;
  status?: PaymentStatus;
  amount?: number;
  discountAmount?: number;
  dueDate?: string;
  expiresAt?: string;
  reason?: string;
};

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
  const isCancelled = snapshot.status === "cancelled";
  const isRefunded = snapshot.status === "refunded";
  const historyReason = isRefunded
    ? `수기 환불 완료 등록: ${snapshot.reason}`
    : isCancelled
      ? `수기 취소 등록: ${snapshot.reason}`
      : "수기 결제 등록";
  const nextPayment: Payment = {
    id: paymentId,
    branchId,
    ...snapshot,
    refundedAmount: isRefunded ? snapshot.amount : 0,
    ...(isCancelled || isRefunded
      ? {
          refundedAt: now,
          refundReason: snapshot.reason,
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
      ...snapshot,
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

  const body = (await request.json().catch(() => null)) as PaymentBody | null;
  const memberId = body?.memberId?.trim() ?? "";
  const planName = body?.planName?.trim() ?? "";
  const status = body?.status;
  const amount = body?.amount;
  const discountAmount = body?.discountAmount ?? 0;
  const dueDate = body?.dueDate ?? "";
  const expiresAt = body?.expiresAt ?? "";
  const reason = body?.reason?.trim() ?? "";

  if (!memberId || !planName) {
    return jsonError(400, "VALIDATION_ERROR", "회원과 회원권명이 필요합니다.");
  }

  if (!status || !manualPaymentCreatableStatuses.includes(status as (typeof manualPaymentCreatableStatuses)[number])) {
    return jsonError(400, "VALIDATION_ERROR", "결제 상태가 올바르지 않습니다.");
  }

  if (requiresManualPaymentCreateReason(status) && !reason) {
    return jsonError(400, "VALIDATION_ERROR", "취소 또는 환불 완료 등록 사유를 입력해 주세요.");
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return jsonError(400, "VALIDATION_ERROR", "금액은 0원 이상의 숫자여야 합니다.");
  }

  if (typeof discountAmount !== "number" || !Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > amount) {
    return jsonError(400, "VALIDATION_ERROR", "할인 금액은 결제 금액 이하의 0원 이상 숫자여야 합니다.");
  }

  const dateRangeError = getManualPaymentDateRangeError(dueDate, expiresAt);

  if (dateRangeError) {
    return jsonError(400, "VALIDATION_ERROR", dateRangeError);
  }

  const snapshot = createPaymentCreateSnapshot({
    memberId,
    planName,
    status,
    amount,
    discountAmount,
    dueDate,
    expiresAt,
    ...(reason ? { reason } : {}),
  });
  const idempotencyFingerprint = parsedIdempotencyKey.value
    ? await createPaymentCreateFingerprint(snapshot)
    : null;

  if (!parsedIdempotencyKey.value) {
    return persistPayment({
      branchId,
      db,
      idempotencyFingerprint,
      idempotencyKey: null,
      selectedBranchId: selectedScope.selectedBranchId,
      snapshot,
      user,
    });
  }

  const idempotencyKey = parsedIdempotencyKey.value;

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
