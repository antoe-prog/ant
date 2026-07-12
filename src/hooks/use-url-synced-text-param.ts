"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createUrlWithTextParam, getNormalizedTextParam } from "@/lib/url-search-params";

export function useUrlSyncedTextParam(paramName = "q") {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramValue = getNormalizedTextParam(searchParams.get(paramName));
  const previousParamValueRef = useRef(paramValue);
  const [value, setValueState] = useState(paramValue);

  useEffect(() => {
    if (paramValue === previousParamValueRef.current) {
      return;
    }

    previousParamValueRef.current = paramValue;
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        setValueState(paramValue);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [paramValue]);

  const setValue = useCallback(
    (nextValue: string) => {
      setValueState(nextValue);

      if (typeof window === "undefined") {
        return;
      }

      previousParamValueRef.current = getNormalizedTextParam(nextValue);
      const nextUrl = createUrlWithTextParam(window.location.href, paramName, nextValue);
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (nextUrl !== currentUrl) {
        router.replace(nextUrl, { scroll: false });
      }
    },
    [paramName, router],
  );

  return [value, setValue] as const;
}
