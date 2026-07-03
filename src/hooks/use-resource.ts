"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api-client";

type ResourceState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useResource<T>(loader: () => Promise<T>, dependencies: unknown[]): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (active) {
        setLoading(true);
        setError(null);
      }
    });

    loader()
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof ApiClientError ? caught.message : "정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, reloadToken]);

  return { data, loading, error, reload };
}
