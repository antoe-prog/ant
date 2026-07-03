"use client";

import { ErrorState } from "@/components/ui/state-blocks";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error(error);
  return <ErrorState description="잠시 후 다시 시도해 주세요." onRetry={reset} />;
}
