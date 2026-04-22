import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  Alert, ActivityIndicator, TextInput, FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { getBeltColor, getBeltLabel, formatDate, getInitials } from "@/lib/judo-utils";
import { useTabBackHandler, useModalBackHandler } from "@/hooks/use-back-handler";
import type { BeltRank } from "@/lib/judo-utils";

type PromotionResult = "pending" | "passed" | "failed";

const BELT_RANKS: BeltRank[] = ["white", "yellow", "orange", "green", "blue", "brown", "black"];

const RESULT_COLORS: Record<PromotionResult, string> = {
  pending: "#F59E0B",
  passed: "#2DA44E",
  failed: "#CF222E",
};
const RESULT_LABELS: Record<PromotionResult, string> = {
  pending: "대기",
  passed: "합격",
  failed: "불합격",
};

function PromotionChecklistSection({
  promotionId,
  canEdit,
}: {
  promotionId: number;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.promotions.checklist.useQuery(
    { promotionId },
    { staleTime: 30_000 }
  );
  const toggleMutation = trpc.promotions.toggleChecklist.useMutation({
    onSuccess: () => {
      void utils.promotions.checklist.invalidate({ promotionId });
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  if (isLoading || !data) {
    return (
      <View className="mt-3 pt-3 border-t border-border">
        <Text className="text-xs font-semibold text-foreground mb-2">심사 준비 체크리스트</Text>
        <ActivityIndicator size="small" color="#1565C0" />
      </View>
    );
  }

  if (data.totalCount === 0) return null;

  const pct = Math.round((data.completedCount / data.totalCount) * 100);

  return (
    <View className="mt-3 pt-3 border-t border-border">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-xs font-semibold text-foreground">심사 준비 체크리스트</Text>
        <Text className="text-xs text-muted">
          {data.completedCount}/{data.totalCount} ({pct}%)
        </Text>
      </View>
      {data.items.map(row => (
        <TouchableOpacity
          key={row.templateId}
          disabled={!canEdit || toggleMutation.isPending}
          onPress={() => toggleMutation.mutate({ promotionId, templateId: row.templateId })}
          className="flex-row items-center py-1.5 gap-2"
          activeOpacity={canEdit ? 0.65 : 1}
        >
          <View
            className="w-5 h-5 rounded border items-center justify-center"
            style={{
              borderColor: row.completed ? "#2DA44E" : "#D1D5DB",
              backgroundColor: row.completed ? "#2DA44E20" : "transparent",
            }}
          >
            {row.completed ? (
              <Text style={{ color: "#2DA44E", fontSize: 12, fontWeight: "700" }}>✓</Text>
            ) : null}
          </View>
          <Text
            className="text-xs flex-1"
            style={{
              color: row.completed ? "#687076" : "#11181C",
              textDecorationLine: row.completed ? "line-through" : "none",
            }}
          >
            {row.label}
          </Text>
        </TouchableOpacity>
      ))}
      {!canEdit ? (
        <Text className="text-[10px] text-muted mt-1">결과 확정 후에는 체크를 변경할 수 없습니다</Text>
      ) : null}
    </View>
  );
}

export default function PromotionsScreen() {
  const { user, isAuthenticated } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const utils = trpc.useUtils();
  const insets = useSafeAreaInsets();

  const now = new Date();
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [resultValue, setResultValue] = useState<PromotionResult>("passed");
  const [resultNotes, setResultNotes] = useState("");

  useTabBackHandler();
  useModalBackHandler(showAddModal, () => setShowAddModal(false));
  useModalBackHandler(showResultModal, () => { setShowResultModal(false); setSelectedId(null); });

  // 신규 등록 폼
  const [form, setForm] = useState<{
    memberId: number | null;
    examDate: string;
    currentBelt: BeltRank;
    targetBelt: BeltRank;
    notes: string;
  }>({
    memberId: null,
    examDate: now.toISOString().split("T")[0],
    currentBelt: "white",
    targetBelt: "yellow",
    notes: "",
  });

  const { data: promotions, isLoading } = trpc.promotions.byMonth.useQuery(
    { year: filterYear, month: filterMonth },
    { enabled: isAuthenticated && isManager }
  );
  const { data: members } = trpc.members.activeList.useQuery(undefined, {
    enabled: isAuthenticated && isManager && showAddModal,
  });

  const createMutation = trpc.promotions.create.useMutation({
    onSuccess: () => {
      utils.promotions.byMonth.invalidate();
      utils.promotions.upcoming.invalidate();
      void utils.members.activityTimeline.invalidate();
      setShowAddModal(false);
      setForm({ memberId: null, examDate: now.toISOString().split("T")[0], currentBelt: "white", targetBelt: "yellow", notes: "" });
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const updateResultMutation = trpc.promotions.updateResult.useMutation({
    onSuccess: (_, variables) => {
      utils.promotions.byMonth.invalidate();
      void utils.promotions.checklist.invalidate();
      void utils.members.activityTimeline.invalidate();
      utils.members.list.invalidate();
      utils.dashboard.stats.invalidate();
      setShowResultModal(false);
      setSelectedId(null);
      if (variables.result === "passed") {
        Alert.alert("합격 완료 🎉", "띠 등급이 자동으로 업그레이드되었습니다.");
      }
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const deleteMutation = trpc.promotions.delete.useMutation({
    onSuccess: () => {
      utils.promotions.byMonth.invalidate();
      void utils.members.activityTimeline.invalidate();
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const handleCreate = () => {
    if (!form.memberId) { Alert.alert("오류", "회원을 선택해 주세요."); return; }
    if (!form.examDate) { Alert.alert("오류", "심사 날짜를 입력해 주세요."); return; }
    createMutation.mutate({
      memberId: form.memberId,
      examDate: form.examDate,
      currentBelt: form.currentBelt,
      targetBelt: form.targetBelt,
      notes: form.notes || undefined,
    });
  };

  const openResultModal = (id: number, currentResult: PromotionResult) => {
    setSelectedId(id);
    setResultValue(currentResult === "pending" ? "passed" : currentResult);
    setResultNotes("");
    setShowResultModal(true);
  };

  const handleUpdateResult = () => {
    if (!selectedId) return;
    if (resultValue === "passed") {
      // 합격 시 자동 띠 업그레이드 확인
      const promotion = (promotions ?? []).find(p => p.id === selectedId);
      const memberName = (promotion as any)?.memberName ?? `회원 #${promotion?.memberId}`;
      const targetBeltLabel = promotion ? getBeltLabel(promotion.targetBelt as BeltRank) : "";
      Alert.alert(
        "합격 확인",
        `${memberName}님을 합격 처리하면 띠 등급이 \n${targetBeltLabel}(으)로 자동 업그레이드됩니다.`,
        [
          { text: "취소", style: "cancel" },
          {
            text: "합격 처리",
            onPress: () => updateResultMutation.mutate({ id: selectedId, result: resultValue, notes: resultNotes || undefined }),
          },
        ]
      );
    } else {
      updateResultMutation.mutate({ id: selectedId, result: resultValue, notes: resultNotes || undefined });
    }
  };

  const handleDelete = (id: number, memberName: string) => {
    Alert.alert("심사 일정 삭제", `${memberName}의 심사 일정을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => deleteMutation.mutate({ id }) },
    ]);
  };

  const prevMonth = () => {
    if (filterMonth === 1) { setFilterYear(y => y - 1); setFilterMonth(12); }
    else setFilterMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (filterYear > now.getFullYear() || (filterYear === now.getFullYear() && filterMonth >= now.getMonth() + 1)) return;
    if (filterMonth === 12) { setFilterYear(y => y + 1); setFilterMonth(1); }
    else setFilterMonth(m => m + 1);
  };
  const isCurrentMonth = filterYear === now.getFullYear() && filterMonth === now.getMonth() + 1;

  if (!isAuthenticated || !isManager) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-muted text-center">관리자만 접근할 수 있습니다</Text>
      </ScreenContainer>
    );
  }

  const pendingCount = (promotions ?? []).filter(p => p.result === "pending").length;
  const passedCount = (promotions ?? []).filter(p => p.result === "passed").length;
  const failedCount = (promotions ?? []).filter(p => p.result === "failed").length;

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between">
        <Text className="text-2xl font-bold text-foreground">승급 심사</Text>
        <TouchableOpacity
          onPress={() => setShowAddModal(true)}
          className="px-4 py-2 rounded-xl"
          style={{ backgroundColor: "#1565C0" }}
        >
          <Text className="text-white text-sm font-semibold">+ 등록</Text>
        </TouchableOpacity>
      </View>

      {/* 월 선택 */}
      <View className="mx-5 mb-3 flex-row items-center justify-between bg-surface rounded-2xl border border-border p-3">
        <TouchableOpacity
          onPress={prevMonth}
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: "#1565C010" }}
        >
          <Text style={{ color: "#1565C0", fontSize: 18, fontWeight: "600" }}>‹</Text>
        </TouchableOpacity>
        <Text className="text-base font-bold text-foreground">{filterYear}년 {filterMonth}월</Text>
        <TouchableOpacity
          onPress={nextMonth}
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: isCurrentMonth ? "#E5E7EB" : "#1565C010", opacity: isCurrentMonth ? 0.4 : 1 }}
          disabled={isCurrentMonth}
        >
          <Text style={{ color: "#1565C0", fontSize: 18, fontWeight: "600" }}>›</Text>
        </TouchableOpacity>
      </View>

      {/* 통계 카드 */}
      <View className="mx-5 mb-4 flex-row gap-3">
        {[
          { label: "대기", count: pendingCount, color: "#F59E0B" },
          { label: "합격", count: passedCount, color: "#2DA44E" },
          { label: "불합격", count: failedCount, color: "#CF222E" },
        ].map(s => (
          <View key={s.label} className="flex-1 bg-surface rounded-2xl border border-border p-3 items-center">
            <Text className="text-xl font-bold" style={{ color: s.color }}>{s.count}</Text>
            <Text className="text-xs text-muted mt-0.5">{s.label}</Text>
          </View>
        ))}
      </View>

      {/* 목록 */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (promotions ?? []).length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-5xl mb-4">🥋</Text>
          <Text className="text-base font-semibold text-foreground mb-2">이번 달 심사 일정이 없습니다</Text>
          <Text className="text-sm text-muted text-center">+ 등록 버튼으로 심사 일정을 추가하세요</Text>
        </View>
      ) : (
        <FlatList
          data={promotions}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30, gap: 12 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const currentColor = getBeltColor(item.currentBelt as BeltRank);
            const targetColor = getBeltColor(item.targetBelt as BeltRank);
            const resultColor = RESULT_COLORS[item.result as PromotionResult];
            return (
              <View className="bg-surface rounded-2xl border border-border overflow-hidden">
                <View className="p-4">
                  {/* 회원 정보 + 결과 배지 */}
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center gap-3">
                      <View
                        className="w-10 h-10 rounded-full items-center justify-center"
                        style={{ backgroundColor: currentColor }}
                      >
                        <Text className="text-sm font-bold text-white">
                          {getInitials((item as any).memberName ?? String(item.memberId))}
                        </Text>
                      </View>
                      <View>
                        <Text className="text-sm font-bold text-foreground">{(item as any).memberName ?? `회원 #${item.memberId}`}</Text>
                        <Text className="text-xs text-muted">{formatDate(item.examDate)}</Text>
                      </View>
                    </View>
                    <View
                      className="px-3 py-1 rounded-full"
                      style={{ backgroundColor: resultColor + "20" }}
                    >
                      <Text className="text-xs font-bold" style={{ color: resultColor }}>
                        {RESULT_LABELS[item.result as PromotionResult]}
                      </Text>
                    </View>
                  </View>

                  {/* 띠 변경 화살표 */}
                  <View className="flex-row items-center gap-2 mb-3">
                    <View className="px-3 py-1.5 rounded-full" style={{ backgroundColor: currentColor }}>
                      <Text className="text-xs font-bold text-white">{getBeltLabel(item.currentBelt as BeltRank)}</Text>
                    </View>
                    <Text className="text-muted text-base">→</Text>
                    <View className="px-3 py-1.5 rounded-full" style={{ backgroundColor: targetColor }}>
                      <Text className="text-xs font-bold text-white">{getBeltLabel(item.targetBelt as BeltRank)}</Text>
                    </View>
                  </View>

                  {item.notes ? (
                    <Text className="text-xs text-muted mb-3">{item.notes}</Text>
                  ) : null}

                  <PromotionChecklistSection
                    promotionId={item.id}
                    canEdit={item.result === "pending"}
                  />

                  {/* 액션 버튼 */}
                  <View className="flex-row gap-2">
                    {item.result === "pending" && (
                      <TouchableOpacity
                        className="flex-1 py-2 rounded-xl items-center"
                        style={{ backgroundColor: "#1565C015" }}
                        onPress={() => openResultModal(item.id, item.result as PromotionResult)}
                      >
                        <Text className="text-xs font-semibold" style={{ color: "#1565C0" }}>결과 입력</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      className="py-2 px-4 rounded-xl items-center"
                      style={{ backgroundColor: "#CF222E15" }}
                      onPress={() => handleDelete(item.id, (item as any).memberName ?? `회원 #${item.memberId}`)}
                    >
                      <Text className="text-xs font-semibold" style={{ color: "#CF222E" }}>삭제</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* 심사 등록 모달 */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <Text className="text-lg font-bold text-foreground">심사 일정 등록</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Text className="text-muted text-base">취소</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-5 pt-4" contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
            {/* 회원 선택 */}
            <View>
              <Text className="text-sm font-semibold text-foreground mb-2">회원 선택</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {(members ?? []).map(m => (
                    <TouchableOpacity
                      key={m.id}
                      className="px-3 py-2 rounded-xl border"
                      style={{
                        backgroundColor: form.memberId === m.id ? "#1565C0" : "transparent",
                        borderColor: form.memberId === m.id ? "#1565C0" : "#E5E7EB",
                      }}
                      onPress={() => setForm(f => ({
                        ...f,
                        memberId: m.id,
                        currentBelt: m.beltRank as BeltRank,
                        targetBelt: (BELT_RANKS[BELT_RANKS.indexOf(m.beltRank as BeltRank) + 1] ?? m.beltRank) as BeltRank,
                      }))}
                    >
                      <Text className="text-sm font-medium" style={{ color: form.memberId === m.id ? "#FFFFFF" : "#11181C" }}>
                        {m.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* 심사 날짜 */}
            <View>
              <Text className="text-sm font-semibold text-foreground mb-2">심사 날짜 (YYYY-MM-DD)</Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                value={form.examDate}
                onChangeText={v => setForm(f => ({ ...f, examDate: v }))}
                placeholder="2026-04-20"
                placeholderTextColor="#9BA1A6"
                returnKeyType="done"
              />
            </View>

            {/* 현재 띠 */}
            <View>
              <Text className="text-sm font-semibold text-foreground mb-2">현재 띠</Text>
              <View className="flex-row flex-wrap gap-2">
                {BELT_RANKS.map(b => (
                  <TouchableOpacity
                    key={b}
                    className="px-3 py-2 rounded-xl"
                    style={{ backgroundColor: form.currentBelt === b ? getBeltColor(b) : "#F5F5F5" }}
                    onPress={() => setForm(f => ({ ...f, currentBelt: b }))}
                  >
                    <Text className="text-xs font-semibold" style={{ color: form.currentBelt === b ? "#FFFFFF" : "#687076" }}>
                      {getBeltLabel(b)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 목표 띠 */}
            <View>
              <Text className="text-sm font-semibold text-foreground mb-2">목표 띠</Text>
              <View className="flex-row flex-wrap gap-2">
                {BELT_RANKS.map(b => (
                  <TouchableOpacity
                    key={b}
                    className="px-3 py-2 rounded-xl"
                    style={{ backgroundColor: form.targetBelt === b ? getBeltColor(b) : "#F5F5F5" }}
                    onPress={() => setForm(f => ({ ...f, targetBelt: b }))}
                  >
                    <Text className="text-xs font-semibold" style={{ color: form.targetBelt === b ? "#FFFFFF" : "#687076" }}>
                      {getBeltLabel(b)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 메모 */}
            <View>
              <Text className="text-sm font-semibold text-foreground mb-2">메모 (선택)</Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                value={form.notes}
                onChangeText={v => setForm(f => ({ ...f, notes: v }))}
                placeholder="심사 관련 메모"
                placeholderTextColor="#9BA1A6"
                multiline
                numberOfLines={3}
                style={{ height: 80, textAlignVertical: "top" }}
              />
            </View>

            <TouchableOpacity
              className="py-4 rounded-2xl items-center"
              style={{ backgroundColor: "#1565C0", opacity: createMutation.isPending ? 0.6 : 1 }}
              onPress={handleCreate}
              disabled={createMutation.isPending}
            >
              <Text className="text-white font-bold text-base">
                {createMutation.isPending ? "등록 중..." : "심사 일정 등록"}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* 결과 입력 모달 */}
      <Modal visible={showResultModal} animationType="fade" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View className="bg-background rounded-t-3xl px-5 pt-5 pb-10">
            <Text className="text-lg font-bold text-foreground mb-4">심사 결과 입력</Text>
            <View className="flex-row gap-3 mb-4">
              {(["passed", "failed"] as PromotionResult[]).map(r => (
                <TouchableOpacity
                  key={r}
                  className="flex-1 py-3 rounded-2xl items-center border"
                  style={{
                    backgroundColor: resultValue === r ? RESULT_COLORS[r] : "transparent",
                    borderColor: resultValue === r ? RESULT_COLORS[r] : "#E5E7EB",
                  }}
                  onPress={() => setResultValue(r)}
                >
                  <Text className="font-bold" style={{ color: resultValue === r ? "#FFFFFF" : "#687076" }}>
                    {RESULT_LABELS[r]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground mb-4"
              value={resultNotes}
              onChangeText={setResultNotes}
              placeholder="결과 메모 (선택)"
              placeholderTextColor="#9BA1A6"
              returnKeyType="done"
            />
            <TouchableOpacity
              className="py-4 rounded-2xl items-center"
              style={{ backgroundColor: RESULT_COLORS[resultValue], opacity: updateResultMutation.isPending ? 0.6 : 1 }}
              onPress={handleUpdateResult}
              disabled={updateResultMutation.isPending}
            >
              <Text className="text-white font-bold text-base">
                {updateResultMutation.isPending ? "저장 중..." : "결과 저장"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity className="mt-3 items-center py-2" onPress={() => setShowResultModal(false)}>
              <Text className="text-muted">취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
