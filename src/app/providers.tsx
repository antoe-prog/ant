"use client";

import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { AppStoreProvider } from "@/store/app-store";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppStoreProvider>
      {children}
      <ServiceWorkerRegistration />
    </AppStoreProvider>
  );
}
