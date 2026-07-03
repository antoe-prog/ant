"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => {
          // Development cleanup should not surface as an app runtime error.
        });
      if ("caches" in window) {
        void caches
          .keys()
          .then((keys) => Promise.all(keys.filter((key) => key.startsWith("final-judo-mobile-shell")).map((key) => caches.delete(key))))
          .catch(() => {
            // Cache cleanup is best effort in local browsers and simulators.
          });
      }
      return;
    }

    let cancelled = false;
    const reloadMarker = "final-judo-sw-refreshing";

    window.setTimeout(() => {
      window.sessionStorage.removeItem(reloadMarker);
    }, 1000);

    const handleControllerChange = () => {
      if (window.sessionStorage.getItem(reloadMarker) === "1") {
        return;
      }

      window.sessionStorage.setItem(reloadMarker, "1");
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    const register = async () => {
      if (cancelled) {
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const installingWorker = registration.installing ?? registration.waiting;

        installingWorker?.postMessage({ type: "FINAL_JUDO_SKIP_WAITING" });
        void registration.update();
      } catch {
        // PWA install should never block the operational UI.
      }
    };

    if (document.readyState === "complete") {
      void register();
      return () => {
        cancelled = true;
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      };
    }

    window.addEventListener("load", register);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
