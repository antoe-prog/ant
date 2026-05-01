import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { trpc } from "@/lib/trpc";
import { formatAmount, formatDate, getBeltColor, getBeltLabel, type BeltRank } from "@/lib/judo-utils";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedChild } from "@/hooks/use-selected-child";

export default function MyScheduleScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isParent, children, selectedChild, selectedChildId, selectedMemberInput, setSelectedChildId, isLoadingChildren } =
    useSelectedChild();
  const [refreshing, setRefreshing] = useState(false);
  const canReadSelectedMember = !isParent || !!selectedChildId;
  const scheduleInput = { days: 180, ...(selectedMemberInput ?? {}) };

  const { data, isLoading, refetch } = trpc.members.mySchedule.useQuery(
    scheduleInput,
    { enabled: !!user && canReadSelectedMember },
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  if (!user) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-muted">로그인이 필요합니다</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View className="px-5 pt-2 pb-3 flex-row items-center gap-2">
        <BackButton />
        <Text className="text-xl font-bold text-foreground flex-1">📅 내 일정</Text>
      </View>

      {isLoading || (isParent && isLoadingChildren) ? (
        <View className="flex-1 items-center justify-center py-20">
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-5"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1565C0" colors={["#1565C0"]} />
          }
        >
          <Text className="text-xs text-muted mb-4">
            향후 약 6개월 이내 예정된 승급 심사와 납부 날짜를 모았습니다.
          </Text>

          {isParent && children.length > 1 ? (
            <View className="mb-4">
              <Text className="text-sm font-bold text-foreground mb-2">자녀 선택</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {children.map((child) => {
                  const active = child.id === selectedChild?.id;
                  return (
                    <TouchableOpacity
                      key={child.id}
                      className="px-4 py-2 rounded-full border"
                      style={{
                        backgroundColor: active ? "#EAF4FF" : "#FFFFFF",
                        borderColor: active ? "#1565C0" : "#D7E2F0",
                      }}
                      activeOpacity={0.8}
                      onPress={() => void setSelectedChildId(child.id)}
                    >
                      <Text style={{ color: active ? "#1565C0" : "#64748B", fontWeight: "800" }}>{child.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {isParent && !isLoadingChildren && children.length === 0 ? (
            <View className="items-center py-12 px-4">
              <Text className="text-4xl mb-3">🔗</Text>
              <Text className="text-base font-semibold text-foreground text-center mb-2">
                연결된 자녀가 없습니다
              </Text>
              <Text className="text-sm text-muted text-center leading-5">
                관리자에게 학부모-자녀 연결을 요청하면 자녀별 일정을 확인할 수 있습니다.
              </Text>
            </View>
          ) : !data?.hasMemberProfile ? (
            <View className="items-center py-12 px-4">
              <Text className="text-4xl mb-3">🔗</Text>
              <Text className="text-base font-semibold text-foreground text-center mb-2">
                도장 회원 정보가 연결되지 않았습니다
              </Text>
              <Text className="text-sm text-muted text-center leading-5">
                관리자에게 회원 등록 및 계정 연결을 요청하시면 일정을 확인할 수 있습니다.
              </Text>
            </View>
          ) : data.items.length === 0 ? (
            <View className="items-center py-12 px-4">
              <Text className="text-4xl mb-3">✨</Text>
              <Text className="text-sm text-muted text-center leading-5">
                예정된 심사나 납부 일정이 없습니다.{"\n"}
                일정이 생기면 여기에 표시됩니다.
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              {data.items.map((item, idx) => (
                <View
                  key={item.kind === "promotion" ? `p-${item.id}` : `pay-${item.sortDate}-${idx}`}
                  className="bg-surface rounded-2xl border border-border overflow-hidden"
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: item.kind === "promotion" ? "#7C3AED" : "#16A34A",
                  }}
                >
                  {item.kind === "promotion" ? (
                    <View className="p-4">
                      <View className="flex-row items-center justify-between mb-2">
                        <Text className="text-xs font-semibold text-muted">승급 심사</Text>
                        <Text className="text-sm font-bold text-foreground">{formatDate(item.examDate)}</Text>
                      </View>
                      <View className="flex-row items-center gap-2 flex-wrap">
                        <View className="flex-row items-center gap-1">
                          <View className="w-3 h-3 rounded-full" style={{ backgroundColor: getBeltColor(item.currentBelt as BeltRank) }} />
                          <Text className="text-sm text-foreground">{getBeltLabel(item.currentBelt as BeltRank)}</Text>
                        </View>
                        <Text className="text-muted">→</Text>
                        <View className="flex-row items-center gap-1">
                          <View className="w-3 h-3 rounded-full" style={{ backgroundColor: getBeltColor(item.targetBelt as BeltRank) }} />
                          <Text className="text-sm text-foreground">{getBeltLabel(item.targetBelt as BeltRank)}</Text>
                        </View>
                      </View>
                      <Text className="text-xs text-muted mt-2">관리자가 등록한 일정입니다. 자세한 내용은 공지를 확인하세요.</Text>
                    </View>
                  ) : (
                    <View className="p-4">
                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-xs font-semibold text-muted">납부 예정</Text>
                        <Text className="text-sm font-bold text-foreground">{formatDate(item.date)}</Text>
                      </View>
                      <Text className="text-base font-semibold text-foreground">{formatAmount(item.amount)}</Text>
                      <Text className="text-xs text-muted mt-1">등록된 다음 납부일 기준입니다.</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {data?.hasMemberProfile ? (
            <View className="mt-6 gap-2">
              <TouchableOpacity
                className="py-3 rounded-2xl border border-border items-center bg-surface"
                onPress={() => router.push("/my-promotions" as never)}
              >
                <Text className="text-sm font-semibold text-primary">내 승급 심사 전체 보기 →</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="py-3 rounded-2xl border border-border items-center bg-surface"
                onPress={() => router.push("/my-attendance-calendar" as never)}
              >
                <Text className="text-sm font-semibold text-primary">출석 달력 보기 →</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}
