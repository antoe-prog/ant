import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

const SELECTED_CHILD_KEY = "parent_selected_child_id";

export function useSelectedChild() {
  const { user } = useAuth();
  const isParent = user?.accountType === "parent";
  const [selectedChildId, setSelectedChildIdState] = useState<number | null>(null);

  const childrenQuery = trpc.members.myChildren.useQuery(undefined, {
    enabled: isParent,
    staleTime: 60_000,
  });
  const children = useMemo(() => childrenQuery.data ?? [], [childrenQuery.data]);

  useEffect(() => {
    if (!isParent) {
      setSelectedChildIdState(null);
      return;
    }
    AsyncStorage.getItem(SELECTED_CHILD_KEY).then((value) => {
      const id = value ? Number(value) : NaN;
      if (Number.isInteger(id) && id > 0) {
        setSelectedChildIdState(id);
      }
    });
  }, [isParent]);

  useEffect(() => {
    if (!isParent || children.length === 0) return;
    const selectedExists = selectedChildId
      ? children.some((child) => child.id === selectedChildId)
      : false;
    if (selectedExists) return;
    const nextId = children[0]?.id ?? null;
    setSelectedChildIdState(nextId);
    if (nextId) void AsyncStorage.setItem(SELECTED_CHILD_KEY, String(nextId));
  }, [children, isParent, selectedChildId]);

  const setSelectedChildId = async (id: number) => {
    setSelectedChildIdState(id);
    await AsyncStorage.setItem(SELECTED_CHILD_KEY, String(id));
  };

  const selectedChild = useMemo(
    () => children.find((child) => child.id === selectedChildId) ?? children[0] ?? null,
    [children, selectedChildId],
  );

  const selectedMemberInput = isParent && selectedChild?.id ? { memberId: selectedChild.id } : undefined;

  return {
    isParent,
    children,
    selectedChild,
    selectedChildId: selectedChild?.id ?? selectedChildId,
    selectedMemberInput,
    setSelectedChildId,
    isLoadingChildren: childrenQuery.isLoading,
  };
}
