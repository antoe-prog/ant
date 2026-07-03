"use client";

import { useAppStore } from "@/store/app-store";

export function useApiContext() {
  const store = useAppStore();

  if (!store.user) {
    throw new Error("Authenticated user is required.");
  }

  return {
    db: store.db,
    user: store.user,
    selectedBranchId: store.selectedBranchId,
    version: store.version,
  };
}
