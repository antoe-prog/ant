import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StatusBadge } from "@/components/onboarding/StatusBadge";
import { ProgressRing } from "@/components/onboarding/ProgressRing";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/onboarding-utils";

export default function HRDashboardScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "in_progress" | "completed" | "not_started">("all");

  const { data: allPlans, isLoading } = trpc.onboarding.allPlans.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const filtered = allPlans?.filter(({ plan, employee }) => {
    const matchSearch =
      !search ||
      (employee.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (employee.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || plan.status === filter;
    return matchSearch && matchFilter;
  }) ?? [];

  const stats = {
    total: allPlans?.length ?? 0,
    notStarted: allPlans?.filter((p) => p.plan.status === "not_started").length ?? 0,
    inProgress: allPlans?.filter((p) => p.plan.status === "in_progress").length ?? 0,
    completed: allPlans?.filter((p) => p.plan.status === "completed").length ?? 0,
  };

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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>직원 온보딩 현황</Text>
      </View>

      {/* Stats Row */}
      <View style={[styles.statsSection, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.statsRow}>
          {[
            { label: "전체", value: stats.total, color: colors.primary },
            { label: "시작 전", value: stats.notStarted, color: "#6B7280" },
            { label: "진행중", value: stats.inProgress, color: "#F59E0B" },
            { label: "완료", value: stats.completed, color: "#10B981" },
          ].map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={[styles.statNum, { color: s.color }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Search */}
      <View style={[styles.searchSection, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="이름 또는 이메일 검색..."
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <IconSymbol name="xmark" size={14} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={[styles.filterRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {(["all", "not_started", "in_progress", "completed"] as const).map((f) => (
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
              {f === "all" ? "전체" : f === "not_started" ? "시작전" : f === "in_progress" ? "진행중" : "완료"}
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
          data={filtered}
          keyExtractor={(item) => item.plan.id.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.centered}>
              <IconSymbol name="person.3.fill" size={48} color={colors.muted} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>직원 없음</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                {search ? "검색 결과가 없습니다" : "등록된 직원이 없습니다"}
              </Text>
            </View>
          }
          renderItem={({ item: { plan, employee } }) => (
            <TouchableOpacity
              style={[styles.employeeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => router.push({ pathname: "/employee-detail", params: { employeeId: employee.id.toString() } })}
              activeOpacity={0.7}
            >
              {/* Avatar */}
              <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
                <Text style={[styles.avatarText, { color: colors.primary }]}>
                  {(employee.name ?? "?").slice(0, 2)}
                </Text>
              </View>

              {/* Info */}
              <View style={styles.employeeInfo}>
                <View style={styles.employeeNameRow}>
                  <Text style={[styles.employeeName, { color: colors.foreground }]}>
                    {employee.name ?? "이름 없음"}
                  </Text>
                  <StatusBadge status={plan.status} size="sm" />
                </View>
                <Text style={[styles.employeeEmail, { color: colors.muted }]}>
                  {employee.email ?? "이메일 없음"}
                </Text>
                {plan.targetCompletionDate && (
                  <Text style={[styles.employeeDue, { color: colors.muted }]}>
                    목표 완료: {formatDate(plan.targetCompletionDate)}
                  </Text>
                )}
              </View>

              {/* Progress */}
              <ProgressRing
                progress={plan.completionRate}
                size={52}
                strokeWidth={5}
                color={colors.primary}
                label="완료"
              />
            </TouchableOpacity>
          )}
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
  statsSection: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
    gap: 2,
  },
  statNum: {
    fontSize: 24,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  filterRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  employeeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "700",
  },
  employeeInfo: {
    flex: 1,
    gap: 3,
  },
  employeeNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  employeeName: {
    fontSize: 15,
    fontWeight: "600",
  },
  employeeEmail: {
    fontSize: 12,
  },
  employeeDue: {
    fontSize: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
  },
});
