import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StatusBadge } from "@/components/onboarding/StatusBadge";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import {
  getCategoryLabel,
  getCategoryIcon,
  getPriorityColor,
  formatDate,
  type TaskCategory,
} from "@/lib/onboarding-utils";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export default function ChecklistScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("all");

  const { data: plan } = trpc.onboarding.myPlan.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const {
    data: tasks,
    isLoading,
    refetch,
  } = trpc.tasks.list.useQuery(
    { planId: plan?.id ?? 0 },
    { enabled: !!plan?.id }
  );

  const completeMutation = trpc.tasks.complete.useMutation({
    onSuccess: (result) => {
      if (Platform.OS !== "web") {
        if (result.requiresApproval) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
      refetch();
      if (result.requiresApproval) {
        Alert.alert(
          "승인 요청 완료",
          "관리자 승인이 필요한 항목입니다. 승인 후 완료 처리됩니다.",
          [{ text: "확인" }]
        );
      }
    },
  });

  const handleComplete = (taskId: number) => {
    if (!plan?.id) return;
    Alert.alert(
      "작업 완료",
      "이 작업을 완료 처리하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        {
          text: "완료",
          onPress: () => completeMutation.mutate({ id: taskId, planId: plan.id }),
        },
      ]
    );
  };

  const filteredTasks = tasks?.filter((t) => {
    if (filter === "pending") return t.status === "pending" || t.status === "in_progress";
    if (filter === "completed") return t.status === "completed";
    return true;
  }) ?? [];

  const completedCount = tasks?.filter((t) => t.status === "completed").length ?? 0;
  const totalCount = tasks?.length ?? 0;

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="p-6">
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: colors.muted }]}>로그인이 필요합니다</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>온보딩 체크리스트</Text>
        <Text style={[styles.headerSub, { color: colors.muted }]}>
          {completedCount}/{totalCount} 완료
        </Text>
      </View>

      {/* Filter Tabs */}
      <View style={[styles.filterRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {(["all", "pending", "completed"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[
              styles.filterTab,
              filter === f && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
            ]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={[
                styles.filterLabel,
                { color: filter === f ? colors.primary : colors.muted },
              ]}
            >
              {f === "all" ? "전체" : f === "pending" ? "진행중" : "완료"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredTasks}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.centered}>
              <IconSymbol name="checklist" size={48} color={colors.muted} />
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                {filter === "completed" ? "완료된 작업이 없습니다" : "작업이 없습니다"}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isCompleted = item.status === "completed";
            const isInProgress = item.status === "in_progress";
            const catIcon = getCategoryIcon(item.category as TaskCategory);
            const priorityColor = getPriorityColor(item.priority as "low" | "medium" | "high");

            return (
              <View
                style={[
                  styles.taskCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: isCompleted ? 0.7 : 1,
                  },
                ]}
              >
                {/* Left: Complete Button */}
                <TouchableOpacity
                  style={[
                    styles.checkBtn,
                    {
                      borderColor: isCompleted ? "#10B981" : isInProgress ? "#F59E0B" : colors.border,
                      backgroundColor: isCompleted ? "#10B981" : isInProgress ? "#FEF3C7" : "transparent",
                    },
                  ]}
                  onPress={() => !isCompleted && !isInProgress && handleComplete(item.id)}
                  disabled={isCompleted || isInProgress || completeMutation.isPending}
                >
                  {isCompleted ? (
                    <IconSymbol name="checkmark" size={14} color="#FFFFFF" />
                  ) : isInProgress ? (
                    <IconSymbol name="hourglass" size={14} color="#F59E0B" />
                  ) : null}
                </TouchableOpacity>

                {/* Middle: Task Info */}
                <View style={styles.taskInfo}>
                  <View style={styles.taskTitleRow}>
                    <Text
                      style={[
                        styles.taskTitle,
                        {
                          color: isCompleted ? colors.muted : colors.foreground,
                          textDecorationLine: isCompleted ? "line-through" : "none",
                        },
                      ]}
                    >
                      {item.title}
                    </Text>
                    {item.requiresApproval && (
                      <View style={[styles.approvalBadge, { backgroundColor: colors.primary + "15" }]}>
                        <Text style={[styles.approvalText, { color: colors.primary }]}>승인필요</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.taskMeta}>
                    <View style={[styles.catBadge, { backgroundColor: colors.border }]}>
                      <Text style={[styles.catText, { color: colors.muted }]}>
                        {getCategoryLabel(item.category as TaskCategory)}
                      </Text>
                    </View>
                    <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
                    {item.dueDate && (
                      <Text style={[styles.dueDate, { color: colors.muted }]}>
                        {formatDate(item.dueDate)}
                      </Text>
                    )}
                  </View>
                </View>

                {/* Right: Status */}
                <StatusBadge status={item.status} size="sm" />
              </View>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  headerSub: {
    fontSize: 13,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  taskCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  checkBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  taskInfo: {
    flex: 1,
    gap: 6,
  },
  taskTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  approvalBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  approvalText: {
    fontSize: 10,
    fontWeight: "700",
  },
  taskMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  catBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  catText: {
    fontSize: 11,
    fontWeight: "500",
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dueDate: {
    fontSize: 11,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
});
