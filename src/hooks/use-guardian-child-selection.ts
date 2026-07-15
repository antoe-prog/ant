"use client";

import { useCallback, useEffect, useState } from "react";

const selectionEventName = "final-judo-guardian-child-selection";

function storageKey(userId: string) {
  return `final-judo-guardian-child:${userId}`;
}

/**
 * 학부모의 자녀 선택을 기기(localStorage)에 계정별로 저장해
 * 대시보드/회원/결제 등 화면을 오가거나 재방문해도 같은 자녀가 유지되게 한다.
 * 저장된 id가 더 이상 유효하지 않으면 각 화면의 첫 자녀 폴백이 그대로 동작한다.
 */
export function useGuardianChildSelection(
  userId: string,
  validChildIds?: readonly string[],
  preferredChildId?: string | null,
) {
  const [selectedChildId, setSelectedChildIdState] = useState<string | null>(() => {
    if (preferredChildId) {
      return preferredChildId;
    }

    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(storageKey(userId));
  });

  const setSelectedChildId = useCallback(
    (childId: string | null) => {
      setSelectedChildIdState(childId);

      if (typeof window === "undefined") {
        return;
      }

      if (childId) {
        window.localStorage.setItem(storageKey(userId), childId);
      } else {
        window.localStorage.removeItem(storageKey(userId));
      }

      window.dispatchEvent(new CustomEvent(selectionEventName, { detail: { childId, userId } }));
    },
    [userId],
  );

  const effectiveSelectedChildId = validChildIds
    ? selectedChildId && validChildIds.includes(selectedChildId)
      ? selectedChildId
      : validChildIds[0] ?? null
    : selectedChildId;

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === storageKey(userId)) {
        setSelectedChildIdState(event.newValue);
      }
    }

    function handleSelection(event: Event) {
      const detail = (event as CustomEvent<{ childId: string | null; userId: string }>).detail;

      if (detail?.userId === userId) {
        setSelectedChildIdState(detail.childId);
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(selectionEventName, handleSelection);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(selectionEventName, handleSelection);
    };
  }, [userId]);

  useEffect(() => {
    if (!validChildIds || selectedChildId === effectiveSelectedChildId) {
      return;
    }

    const key = storageKey(userId);
    const storedChildId = window.localStorage.getItem(key);

    if (storedChildId === effectiveSelectedChildId) {
      return;
    }

    if (effectiveSelectedChildId) {
      window.localStorage.setItem(key, effectiveSelectedChildId);
    } else {
      window.localStorage.removeItem(key);
    }

    window.dispatchEvent(
      new CustomEvent(selectionEventName, { detail: { childId: effectiveSelectedChildId, userId } }),
    );
  }, [effectiveSelectedChildId, selectedChildId, userId, validChildIds]);

  return [effectiveSelectedChildId, setSelectedChildId] as const;
}
