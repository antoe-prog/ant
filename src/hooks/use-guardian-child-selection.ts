"use client";

import { useCallback, useEffect, useState } from "react";

const selectionEventName = "final-judo-family-member-selection";
const legacySelectionEventName = "final-judo-guardian-child-selection";

function storageKey(userId: string) {
  return `final-judo-family-member:${userId}`;
}

function legacyStorageKey(userId: string) {
  return `final-judo-guardian-child:${userId}`;
}

export function useFamilyMemberSelection(
  userId: string,
  validMemberIds?: readonly string[],
  preferredMemberId?: string | null,
) {
  const [selectedMemberId, setSelectedMemberIdState] = useState<string | null>(() => {
    if (preferredMemberId) {
      return preferredMemberId;
    }

    if (typeof window === "undefined") {
      return null;
    }

    return (
      window.localStorage.getItem(storageKey(userId)) ??
      window.localStorage.getItem(legacyStorageKey(userId))
    );
  });

  const setSelectedMemberId = useCallback(
    (memberId: string | null) => {
      setSelectedMemberIdState(memberId);

      if (typeof window === "undefined") {
        return;
      }

      if (memberId) {
        window.localStorage.setItem(storageKey(userId), memberId);
      } else {
        window.localStorage.removeItem(storageKey(userId));
      }

      window.localStorage.removeItem(legacyStorageKey(userId));
      window.dispatchEvent(new CustomEvent(selectionEventName, { detail: { memberId, userId } }));
    },
    [userId],
  );

  const effectiveSelectedMemberId = validMemberIds
    ? selectedMemberId && validMemberIds.includes(selectedMemberId)
      ? selectedMemberId
      : validMemberIds[0] ?? null
    : selectedMemberId;

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === storageKey(userId)) {
        setSelectedMemberIdState(event.newValue);
      }
    }

    function handleSelection(event: Event) {
      const detail = (event as CustomEvent<{ childId?: string | null; memberId?: string | null; userId: string }>).detail;

      if (detail?.userId === userId) {
        setSelectedMemberIdState(detail.memberId ?? detail.childId ?? null);
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(selectionEventName, handleSelection);
    window.addEventListener(legacySelectionEventName, handleSelection);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(selectionEventName, handleSelection);
      window.removeEventListener(legacySelectionEventName, handleSelection);
    };
  }, [userId]);

  useEffect(() => {
    if (!validMemberIds || selectedMemberId === effectiveSelectedMemberId) {
      return;
    }

    const key = storageKey(userId);
    const storedChildId = window.localStorage.getItem(key);

    if (storedChildId === effectiveSelectedMemberId) {
      return;
    }

    if (effectiveSelectedMemberId) {
      window.localStorage.setItem(key, effectiveSelectedMemberId);
    } else {
      window.localStorage.removeItem(key);
    }

    window.dispatchEvent(
      new CustomEvent(selectionEventName, { detail: { memberId: effectiveSelectedMemberId, userId } }),
    );
  }, [effectiveSelectedMemberId, selectedMemberId, userId, validMemberIds]);

  return [effectiveSelectedMemberId, setSelectedMemberId] as const;
}

export function useGuardianChildSelection(
  userId: string,
  validChildIds?: readonly string[],
  preferredChildId?: string | null,
) {
  return useFamilyMemberSelection(userId, validChildIds, preferredChildId);
}
