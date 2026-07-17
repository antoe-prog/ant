import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { FinalWordmark } from "@/components/brand/final-wordmark";

type StateBlockProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function LoadingState({ label = "불러오는 중" }: { label?: string }) {
  return (
    <div
      className="min-h-40 rounded-lg border border-zinc-200 bg-white p-4 text-zinc-600 sm:min-h-[220px] sm:p-6"
      aria-live="polite"
      role="status"
    >
      {/* 실제 목록 구조를 닮은 스켈레톤 — 로딩 중에도 화면 골격이 유지된 느낌을 준다 */}
      <div className="grid gap-3" aria-hidden>
        <div className="h-5 w-1/3 animate-pulse rounded-md bg-zinc-100" />
        <div className="h-12 animate-pulse rounded-md bg-zinc-100" />
        <div className="h-12 w-11/12 animate-pulse rounded-md bg-zinc-100" />
        <div className="hidden h-12 w-4/5 animate-pulse rounded-md bg-zinc-100 sm:block" />
      </div>
      <div className="mt-5 flex items-center justify-center gap-2 text-zinc-500">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
        <span className="text-sm font-medium">{label}</span>
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: StateBlockProps) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-gradient-to-b from-white to-zinc-50/60 p-4 text-center sm:min-h-[220px] sm:p-6">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 ring-1 ring-inset ring-teal-100 sm:h-14 sm:w-14">
        <Inbox className="h-6 w-6 text-teal-600 sm:h-7 sm:w-7" aria-hidden />
      </span>
      <h2 className="mt-3 text-base font-semibold text-zinc-950">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-sm leading-6 text-zinc-600">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "화면을 불러오지 못했습니다", description, onRetry }: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div
      aria-atomic="true"
      aria-live="assertive"
      className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-4 text-center sm:min-h-[220px] sm:p-6"
      role="alert"
    >
      <AlertTriangle className="h-7 w-7 text-red-600 sm:h-8 sm:w-8" aria-hidden />
      <h2 className="mt-2 text-base font-semibold text-red-950 sm:mt-3">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-red-700">{description}</p>
      {onRetry ? (
        <button
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
          type="button"
          onClick={onRetry}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          다시 시도
        </button>
      ) : null}
    </div>
  );
}

export function FullPageLoading({ label = "불러오는 중" }: { label?: string } = {}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-6 py-[calc(env(safe-area-inset-top)+2rem)] text-zinc-700">
      <div className="flex flex-col items-center gap-4" aria-live="polite" role="status">
        <FinalWordmark ariaHidden />
        <div className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}
