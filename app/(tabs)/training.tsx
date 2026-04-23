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
import { formatDateTime, formatDuration } from "@/lib/onboarding-utils";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export default function TrainingScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<"all" | "scheduled" | "completed">("all");

  const { data: plan } = trpc.onboarding.myPlan.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const {
    data: trainings,
    isLoading,
    refetch,
  } = trpc.training.list.useQuery(
    { planId: plan?.id ?? 0 },
    { enabled: !!plan?.id }
  );

  const completeMutation = trpc.training.complete.useMutation({
    onSuccess: () => {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      refetch();
    },
  });

  const handleComplete = (trainingId: number, title: string) => {
    Alert.alert(
      "교육 완료",
      `'${title}' 교육을 완료 처리하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "완료",
          onPress: () => completeMutation.mutate({ id: trainingId }),
        },
      ]
    );
  };

  const filteredTrainings = trainings?.filter((t) => {
    if (filter === "scheduled") return t.status === "scheduled";
    if (filter === "completed") return t.status === "completed";
    return true;
  }) ?? [];

  const scheduledCount = trainings?.filter((t) => t.status === "scheduled").length ?? 0;
  const completedCount = trainings?.filter((t) => t.status === "completed").length ?? 0;

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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>교육 일정</Text>
        <View style={styles.headerStats}>
          <View style={[styles.statChip, { backgroundColor: "#F59E0B20" }]}>
            <Text style={[styles.statChipText, { color: "#F59E0B" }]}>예정 {scheduledCount}</Text>
          </View>
          <View style={[styles.statChip, { backgroundColor: "#10B98120" }]}>
            <Text style={[styles.statChipText, { color: "#10B981" }]}>완료 {completedCount}</Text>
          </View>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={[styles.filterRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {(["all", "scheduled", "completed"] as const).map((f) => (
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
              {f === "all" ? "전체" : f === "scheduled" ? "예정" : "완료"}
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
          data={filteredTrainings}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.centered}>
              <IconSymbol name="graduationcap.fill" size={48} color={colors.muted} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>교육 일정 없음</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                HR 담당자가 교육 일정을 등록하면 여기에 표시됩니다
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isCompleted = item.status === "completed";
            const isCancelled = item.status === "cancelled";
            const scheduledDate = item.scheduledAt ? new Date(item.scheduledAt) : null;
            const isPast = scheduledDate ? scheduledDate < new Date() : false;

            return (
              <View
                style={[
                  styles.trainingCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isCompleted ? "#10B98130" : colors.border,
                    opacity: isCancelled ? 0.6 : 1,
                  },
                ]}
              >
                {/* Date Badge */}
                {scheduledDate && (
                  <View style={[styles.dateBadge, { backgroundColor: isCompleted ? "#10B98115" : colors.primary + "15" }]}>
                    <Text style={[styles.dateMonth, { color: isCompleted ? "#10B981" : colors.primary }]}>
                      {scheduledDate.toLocaleDateString("ko-KR", { month: "short" })}
                    </Text>
                    <Text style={[styles.dateDay, { color: isCompleted ? "#10B981" : colors.primary }]}>
                      {scheduledDate.getDate()}
                    </Text>
                  </View>
                )}

                {/* Training Info */}
                <View style={styles.trainingInfo}>
                  <Text
                    style={[
                      styles.trainingTitle,
                      {
                        color: isCompleted ? colors.muted : colors.foreground,
                        textDecorationLine: isCompleted ? "line-through" : "none",
                      },
                    ]}
                  >
                    {item.title}
                  </Text>

                  <View style={styles.trainingMeta}>
                    {item.instructor && (
                      <View style={styles.metaItem}>
                        <IconSymbol name="person.fill" size={12} color={colors.muted} />
                        <Text style={[styles.metaText, { color: colors.muted }]}>{item.instructor}</Text>
                      </View>
                    )}
                    <View style={styles.metaItem}>
                      <IconSymbol name="clock" size={12} color={colors.muted} />
                      <Text style={[styles.metaText, { color: colors.muted }]}>
                        {formatDuration(item.durationMinutes)}
                      </Text>
                    </View>
                    {item.location && (
                      <View style={styles.metaItem}>
                        <IconSymbol name="location.fill" size={12} color={colors.muted} />
                        <Text style={[styles.metaText, { color: colors.muted }]}>{item.location}</Text>
                      </View>
                    )}
                  </View>

                  {scheduledDate && (
                    <Text style={[styles.scheduleTime, { color: colors.muted }]}>
                      {formatDateTime(scheduledDate)}
                    </Text>
                  )}

                  {item.meetingUrl && !isCompleted && (
                    <View style={[styles.meetingLink, { backgroundColor: colors.primary + "10" }]}>
                      <IconSymbol name="link" size={12} color={colors.primary} />
                      <Text style={[styles.meetingLinkText, { color: colors.primary }]}>
                        온라인 미팅 링크 있음
                      </Text>
                    </View>
                  )}
                </View>

                {/* Right: Status / Action */}
                <View style={styles.trainingRight}>
                  <StatusBadge status={item.status} size="sm" />
                  {!isCompleted && !isCancelled && isPast && (
                    <TouchableOpacity
                      style={[styles.completeBtn, { backgroundColor: "#10B981" }]}
                      onPress={() => handleComplete(item.id, item.title)}
                      disabled={completeMutation.isPending}
                    >
                      <Text style={styles.completeBtnText}>완료</Text>
                    </TouchableOpacity>
                  )}
                </View>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  headerStats: {
    flexDirection: "row",
    gap: 8,
  },
  statChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statChipText: {
    fontSize: 12,
    fontWeight: "600",
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
    gap: 12,
  },
  trainingCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  dateBadge: {
    width: 48,
    height: 56,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dateMonth: {
    fontSize: 11,
    fontWeight: "600",
  },
  dateDay: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 26,
  },
  trainingInfo: {
    flex: 1,
    gap: 6,
  },
  trainingTitle: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  trainingMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  scheduleTime: {
    fontSize: 12,
  },
  meetingLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  meetingLinkText: {
    fontSize: 11,
    fontWeight: "600",
  },
  trainingRight: {
    alignItems: "flex-end",
    gap: 8,
    flexShrink: 0,
  },
  completeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  completeBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
