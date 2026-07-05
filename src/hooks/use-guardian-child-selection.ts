"use client";

import { useCallback, useState } from "react";

function storageKey(userId: string) {
  return `final-judo-guardian-child:${userId}`;
}

/**
 * 학부모의 자녀 선택을 기기(localStorage)에 계정별로 저장해
 * 대시보드/회원/결제 등 화면을 오가거나 재방문해도 같은 자녀가 유지되게 한다.
 * 저장된 id가 더 이상 유효하지 않으면 각 화면의 첫 자녀 폴백이 그대로 동작한다.
 */
export function useGuardianChildSelection(userId: string) {
  const [selectedChildId, setSelectedChildIdState] = useState<string | null>(() => {
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
    },
    [userId],
  );

  return [selectedChildId, setSelectedChildId] as const;
}
