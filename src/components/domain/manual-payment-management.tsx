"use client";

import { type FormEvent, useState } from "react";
import { Pencil, Save, Trash2, X } from "lucide-react";
import type { Payment } from "@/lib/domain";
import {
  manualPaymentEditableStatuses,
  validateManualPaymentUpdate,
  type ManualPaymentUpdatePayload,
} from "@/lib/manual-payment-management";
import { paymentStatusLabels } from "@/lib/roles";
import { Button } from "@/components/ui/primitives";

type ManualPaymentDraft = {
  amount: string;
  discountAmount: string;
  dueDate: string;
  expiresAt: string;
  planName: string;
  reason: string;
  status: Payment["status"];
};

type ManualPaymentManagementProps = {
  payment: Payment;
  onDelete: (paymentId: string, reason: string) => Promise<boolean>;
  onUpdate: (paymentId: string, payload: ManualPaymentUpdatePayload) => Promise<boolean>;
};

function createDraft(payment: Payment): ManualPaymentDraft {
  return {
    amount: String(payment.amount),
    discountAmount: String(payment.discountAmount ?? 0),
    dueDate: payment.dueDate,
    expiresAt: payment.expiresAt,
    planName: payment.planName,
    reason: "",
    status: payment.status,
  };
}

export function ManualPaymentManagement({ payment, onDelete, onUpdate }: ManualPaymentManagementProps) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [draft, setDraft] = useState<ManualPaymentDraft>(() => createDraft(payment));
  const [deleteReason, setDeleteReason] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function openEdit() {
    setDraft(createDraft(payment));
    setDeleteReason("");
    setFeedback(null);
    setMode("edit");
  }

  function openDelete() {
    setDeleteReason("");
    setFeedback(null);
    setMode("delete");
  }

  function closePanel() {
    if (pending) {
      return;
    }

    setFeedback(null);
    setMode(null);
  }

  function updateDraft(patch: Partial<ManualPaymentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFeedback(null);
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.amount.trim() || !draft.discountAmount.trim()) {
      setFeedback("결제 금액과 할인 금액을 입력해 주세요.");
      return;
    }

    const validated = validateManualPaymentUpdate({
      amount: Number(draft.amount),
      discountAmount: Number(draft.discountAmount),
      dueDate: draft.dueDate,
      expiresAt: draft.expiresAt,
      planName: draft.planName,
      reason: draft.reason,
      status: draft.status,
    });

    if (!validated.ok) {
      setFeedback(validated.message);
      return;
    }

    setPending(true);
    const ok = await onUpdate(payment.id, validated.value);
    setPending(false);

    if (ok) {
      setMode(null);
      setFeedback("수기 결제 정보를 수정했습니다.");
      return;
    }

    setFeedback("수기 결제 정보를 수정하지 못했습니다.");
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const reason = deleteReason.trim();

    if (!reason) {
      setFeedback("삭제 사유를 입력해 주세요.");
      return;
    }

    setPending(true);
    const ok = await onDelete(payment.id, reason);
    setPending(false);

    if (!ok) {
      setFeedback("수기 결제 기록을 삭제하지 못했습니다.");
    }
  }

  return (
    <div className="border-t border-zinc-200 pt-2 md:col-span-5" data-testid="manual-payment-management">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-500">수기 등록</span>
        <div className="flex gap-2">
          <button
            aria-label={`${payment.planName} 수기 결제 수정`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="manual-payment-edit-open"
            disabled={pending}
            type="button"
            onClick={openEdit}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            수정
          </button>
          <button
            aria-label={`${payment.planName} 수기 결제 삭제`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="manual-payment-delete-open"
            disabled={pending}
            type="button"
            onClick={openDelete}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            삭제
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <form className="mt-3 grid gap-3 border-t border-zinc-200 pt-3 md:grid-cols-2 xl:grid-cols-4" data-testid="manual-payment-edit-form" onSubmit={(event) => void handleUpdate(event)}>
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">회원권명</span>
            <input
              className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              data-testid="manual-payment-plan-input"
              required
              value={draft.planName}
              onChange={(event) => updateDraft({ planName: event.target.value })}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-zinc-600">결제 금액</span>
            <input
              className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              data-testid="manual-payment-amount-input"
              min={0}
              required
              step={100}
              type="number"
              value={draft.amount}
              onChange={(event) => updateDraft({ amount: event.target.value })}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-zinc-600">할인 금액</span>
            <input
              className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              data-testid="manual-payment-discount-input"
              min={0}
              required
              step={100}
              type="number"
              value={draft.discountAmount}
              onChange={(event) => updateDraft({ discountAmount: event.target.value })}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-zinc-600">상태</span>
            <select
              className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              data-testid="manual-payment-status-select"
              value={draft.status}
              onChange={(event) => updateDraft({ status: event.target.value as Payment["status"] })}
            >
              {manualPaymentEditableStatuses.map((status) => (
                <option key={status} value={status}>
                  {paymentStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-zinc-600">납부일</span>
            <input
              className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              data-testid="manual-payment-due-date-input"
              required
              type="date"
              value={draft.dueDate}
              onChange={(event) => updateDraft({ dueDate: event.target.value })}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-zinc-600">만료일</span>
            <input
              className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
              data-testid="manual-payment-expiry-date-input"
              required
              type="date"
              value={draft.expiresAt}
              onChange={(event) => updateDraft({ expiresAt: event.target.value })}
            />
          </label>
          <label className="md:col-span-2 xl:col-span-4">
            <span className="mb-1 block text-xs font-semibold text-zinc-600">수정 사유</span>
            <input
              className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
              data-testid="manual-payment-edit-reason-input"
              placeholder="예: 금액 오입력 정정"
              required
              value={draft.reason}
              onChange={(event) => updateDraft({ reason: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 md:col-span-2 xl:col-span-4">
            <Button disabled={pending} size="lg" type="button" variant="secondary" onClick={closePanel}>
              <X className="h-4 w-4" aria-hidden />
              닫기
            </Button>
            <Button data-testid="manual-payment-edit-submit" disabled={pending || !draft.reason.trim()} size="lg" type="submit">
              <Save className="h-4 w-4" aria-hidden />
              {pending ? "저장 중" : "변경 저장"}
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "delete" ? (
        <form className="mt-3 grid gap-3 border-t border-red-100 pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" data-testid="manual-payment-delete-form" onSubmit={(event) => void handleDelete(event)}>
          <label>
            <span className="mb-1 block text-xs font-semibold text-red-700">삭제 사유</span>
            <input
              className="h-11 w-full rounded-md border border-red-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-red-500"
              data-testid="manual-payment-delete-reason-input"
              placeholder="예: 중복 등록으로 삭제"
              required
              value={deleteReason}
              onChange={(event) => {
                setDeleteReason(event.target.value);
                setFeedback(null);
              }}
            />
          </label>
          <div className="flex gap-2">
            <Button disabled={pending} size="lg" type="button" variant="secondary" onClick={closePanel}>
              닫기
            </Button>
            <Button data-testid="manual-payment-delete-submit" disabled={pending || !deleteReason.trim()} size="lg" type="submit" variant="danger">
              <Trash2 className="h-4 w-4" aria-hidden />
              {pending ? "삭제 중" : "기록 삭제"}
            </Button>
          </div>
        </form>
      ) : null}

      {feedback ? (
        <p className="mt-2 text-xs font-medium text-zinc-600" data-testid="manual-payment-management-feedback" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
