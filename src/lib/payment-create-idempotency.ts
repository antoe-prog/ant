import type { AuditLog, Payment, PaymentStatus } from "@/lib/domain";

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

export type PaymentCreateSnapshot = {
  memberId: string;
  planName: string;
  status: PaymentStatus;
  amount: number;
  discountAmount: number;
  dueDate: string;
  expiresAt: string;
  reason?: string;
};

type PaymentCreateReplayResult =
  | { kind: "new" }
  | { kind: "replay"; payment: Payment }
  | { kind: "conflict"; reason: "deleted" | "payload_mismatch" };

export function createPaymentCreateIdempotencyKey() {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `manual.${uuid}`;
  }

  return `manual.${Date.now().toString(36)}.${Math.random().toString(36).slice(2).padEnd(12, "0")}`;
}

export function parsePaymentCreateIdempotencyKey(value: string | null) {
  if (value === null) {
    return { ok: true as const, value: null };
  }

  if (value !== value.trim() || !idempotencyKeyPattern.test(value)) {
    return {
      ok: false as const,
      message: "Idempotency-Key는 16~128자의 영문, 숫자, 점, 밑줄, 콜론 또는 하이픈이어야 합니다.",
    };
  }

  return { ok: true as const, value };
}

export function createPaymentCreateSnapshot(input: PaymentCreateSnapshot): PaymentCreateSnapshot {
  const reason = input.status === "cancelled" || input.status === "refunded" ? input.reason?.trim() : undefined;

  return {
    memberId: input.memberId,
    planName: input.planName,
    status: input.status,
    amount: Math.round(input.amount),
    discountAmount: Math.round(input.discountAmount),
    dueDate: input.dueDate,
    expiresAt: input.expiresAt,
    ...(reason ? { reason } : {}),
  };
}

export async function createPaymentCreateFingerprint(snapshot: PaymentCreateSnapshot) {
  const canonicalPayloadValues: Array<string | number> = [
    snapshot.memberId,
    snapshot.planName,
    snapshot.status,
    snapshot.amount,
    snapshot.discountAmount,
    snapshot.dueDate,
    snapshot.expiresAt,
  ];

  // 기존 일반 수기 등록 fingerprint는 유지하고, 사유가 필요한 신규 상태만 뒤에 추가한다.
  if (snapshot.reason) {
    canonicalPayloadValues.push(snapshot.reason);
  }

  const canonicalPayload = JSON.stringify(canonicalPayloadValues);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload));

  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function resolvePaymentCreateReplay({
  actorUserId,
  auditLogs,
  branchId,
  fingerprint,
  idempotencyKey,
  payments,
}: {
  actorUserId: string;
  auditLogs: AuditLog[];
  branchId: string;
  fingerprint: string;
  idempotencyKey: string;
  payments: Payment[];
}): PaymentCreateReplayResult {
  const creationLog = auditLogs.find(
    (log) =>
      log.action === "payment.create" &&
      log.actorUserId === actorUserId &&
      log.branchId === branchId &&
      log.after?.idempotencyKey === idempotencyKey,
  );

  if (!creationLog) {
    return { kind: "new" };
  }

  const payment = payments.find((candidate) => candidate.id === creationLog.targetId);

  if (!payment) {
    return { kind: "conflict", reason: "deleted" };
  }

  if (creationLog.after?.idempotencyFingerprint !== fingerprint) {
    return { kind: "conflict", reason: "payload_mismatch" };
  }

  return { kind: "replay", payment };
}
