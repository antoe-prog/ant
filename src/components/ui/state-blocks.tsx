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
      className="flex min-h-40 items-center justify-center rounded-lg border border-zinc-200 bg-white p-4 text-zinc-600 sm:min-h-[220px] sm:p-6"
      aria-live="polite"
      role="status"
    >
      <LoaderCircle className="mr-2 h-5 w-5 animate-spin" aria-hidden />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: StateBlockProps) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-center sm:min-h-[220px] sm:p-6">
      <Inbox className="h-7 w-7 text-zinc-400 sm:h-8 sm:w-8" aria-hidden />
      <h2 className="mt-2 text-base font-semibold text-zinc-950 sm:mt-3">{title}</h2>
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
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-4 text-center sm:min-h-[220px] sm:p-6">
      <AlertTriangle className="h-7 w-7 text-red-600 sm:h-8 sm:w-8" aria-hidden />
      <h2 className="mt-2 text-base font-semibold text-red-950 sm:mt-3">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-red-700">{description}</p>
      {onRetry ? (
        <button
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
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
