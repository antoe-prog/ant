"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Download, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/primitives";

type InstallPromptChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallPromptChoice>;
};

type InstallState = "checking" | "installed" | "ready" | "manual" | "dismissed";

function isNativeAppRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  const windowWithCapacitor = window as Window & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  };

  return Boolean(windowWithCapacitor.Capacitor?.isNativePlatform?.());
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(navigatorWithStandalone.standalone);
}

function subscribeNativeAppRuntime(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const hydrationTimer = window.setTimeout(onStoreChange, 0);

  return () => window.clearTimeout(hydrationTimer);
}

function getNativeAppRuntimeSnapshot() {
  return isNativeAppRuntime();
}

function getServerNativeAppRuntimeSnapshot() {
  return false;
}

function useNativeAppRuntime() {
  return useSyncExternalStore(
    subscribeNativeAppRuntime,
    getNativeAppRuntimeSnapshot,
    getServerNativeAppRuntimeSnapshot,
  );
}

const stateLabels: Record<InstallState, string> = {
  checking: "확인 중",
  installed: "추가됨",
  ready: "추가 가능",
  manual: "기기 메뉴 사용",
  dismissed: "나중에",
};

export function InstallAppAction() {
  const nativeAppRuntime = useNativeAppRuntime();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState<InstallState>("checking");

  useEffect(() => {
    if (nativeAppRuntime) {
      return;
    }

    const updateInstalledState = () => {
      if (isStandaloneDisplay()) {
        setInstallPrompt(null);
        setInstallState("installed");
        return;
      }

      setInstallState((current) => (current === "checking" || current === "installed" ? "manual" : current));
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallState("ready");
    };

    const displayModeQuery = window.matchMedia("(display-mode: standalone)");
    const fallbackTimer = window.setTimeout(updateInstalledState, 800);

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    displayModeQuery.addEventListener("change", updateInstalledState);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      displayModeQuery.removeEventListener("change", updateInstalledState);
    };
  }, [nativeAppRuntime]);

  if (nativeAppRuntime || installState === "checking" || installState === "manual" || installState === "dismissed") {
    return null;
  }

  const handleInstall = async () => {
    if (!installPrompt) {
      setInstallState(isStandaloneDisplay() ? "installed" : "manual");
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      setInstallState(choice.outcome === "accepted" || isStandaloneDisplay() ? "installed" : "dismissed");
    } catch {
      setInstallPrompt(null);
      setInstallState(isStandaloneDisplay() ? "installed" : "manual");
    }
  };

  const isInstalled = installState === "installed";
  const isReady = installState === "ready";
  const Icon = isInstalled ? CheckCircle2 : MonitorSmartphone;

  return (
    <div
      className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2"
      data-testid="pwa-install-action"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-brand-teal-700">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-950">홈 화면 추가</p>
          <p className="text-xs font-medium text-zinc-500" id="pwa-install-status" aria-live="polite">
            {stateLabels[installState]}
          </p>
        </div>
      </div>

      {isReady ? (
        <Button
          aria-describedby="pwa-install-status"
          className="shrink-0"
          onClick={handleInstall}
          size="sm"
          variant="primary"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          추가
        </Button>
      ) : null}
    </div>
  );
}
