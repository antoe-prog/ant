import React, { useState, useMemo } from "react";
import { Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  Alert, ActivityIndicator, TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import {
  getBeltColor, getBeltLabel, getMemberStatusColor, getMemberStatusLabel,
  getPaymentMethodLabel, getAttendanceTypeLabel, getCheckResultLabel, getPromotionResultLabel, formatDate, formatDateTime, formatAmount,
  getAge, getInitials, calcAttendanceRate,
} from "@/lib/judo-utils";
import { useBackHandler } from "@/hooks/use-back-handler";
import type { BeltRank, MemberStatus, AttendanceType, CheckResult } from "@/lib/judo-utils";
import * as ImagePicker from "expo-image-picker";
import { Image } from "react-native";

const BELT_RANKS: BeltRank[] = ["white", "yellow", "orange", "green", "blue", "brown", "black"];
const STATUSES: MemberStatus[] = ["active", "suspended", "withdrawn"];

type MemberActivityEvent = inferRouterOutputs<AppRouter>["members"]["activityTimeline"][number];

export default function MemberDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = parseInt(id ?? "0");
  const router = useRouter();
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const utils = trpc.useUtils();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<"info" | "attendance" | "payments" | "memo">("info");
  const [memoText, setMemoText] = useState("");
  const [memoSaved, setMemoSaved] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showMemoHistory, setShowMemoHistory] = useState(false);

  // 뒤로가기: 편집 모달 열림 시 모달 닫기, 탭이 info가 아니면 info로, 그 외에는 이전 화면으로
  useBackHandler(() => {
    if (showEdit) { setShowEdit(false); return true; }
    if (activeTab !== "info") { setActiveTab("info"); return true; }
    router.back();
    return true;
  });
  const [editForm, setEditForm] = useState<{
    name: string; phone: string; email: string; beltRank: BeltRank;
    beltDegree: number; status: MemberStatus; monthlyFee: number; notes: string;
  } | null>(null);

  // 캘린더 월 이동 상태
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);

  const year = calYear;
  const month = calMonth;

  const { data: member, isLoading } = trpc.members.byId.useQuery({ id: memberId }, { enabled: !!memberId });
  const { data: overview } = trpc.members.overview.useQuery(
    { memberId },
    { enabled: !!memberId },
  );
  const { data: attendanceMonth } = trpc.attendance.byMemberMonth.useQuery(
    { memberId, year, month }, { enabled: !!memberId && activeTab === "attendance" }
  );
  const { data: payments } = trpc.payments.byMember.useQuery(
    { memberId }, { enabled: !!memberId && activeTab === "payments" }
  );
  const { data: attendanceStats } = trpc.attendance.statsByMember.useQuery(
    { memberId }, { enabled: !!memberId && activeTab === "attendance" }
  );
  const { data: activityTimeline, isLoading: timelineLoading } = trpc.members.activityTimeline.useQuery(
    { memberId, limit: 80 },
    { enabled: !!memberId && activeTab === "attendance" },
  );

  const [avatarUploading, setAvatarUploading] = useState(false);

  const uploadAvatarMutation = trpc.members.uploadAvatar.useMutation({
    onSuccess: () => {
      utils.members.byId.invalidate({ id: memberId });
      utils.members.list.invalidate();
      Alert.alert("완료", "프로필 사진이 업데이트되었습니다.");
    },
    onError: (e) => Alert.alert("업로드 오류", e.message),
    onSettled: () => setAvatarUploading(false),
  });

  const handlePickAvatar = async () => {
    if (!isManager) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("권한 필요", "사진 라이브러리 접근 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) { Alert.alert("오류", "이미지를 읽을 수 없습니다."); return; }
    const mimeType = asset.mimeType ?? "image/jpeg";
    setAvatarUploading(true);
    uploadAvatarMutation.mutate({
      memberId,
      base64: `data:${mimeType};base64,${asset.base64}`,
      mimeType,
    });
  };

  const updateMutation = trpc.members.update.useMutation({
    onSuccess: () => {
      utils.members.byId.invalidate({ id: memberId });
      utils.members.list.invalidate();
      setShowEdit(false);
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const deleteMutation = trpc.members.delete.useMutation({
    onSuccess: () => { utils.members.list.invalidate(); router.back(); },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const saveMemoMutation = trpc.members.update.useMutation({
    onSuccess: () => {
      utils.members.byId.invalidate({ id: memberId });
      setMemoSaved(true);
      setTimeout(() => setMemoSaved(false), 2000);
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const { data: memoHistoryData, isLoading: memoHistoryLoading } = trpc.memoHistory.list.useQuery(
    { memberId },
    { enabled: showMemoHistory && !!memberId }
  );

  // 메모 탭 진입 시 현재 메모 불러오기
  React.useEffect(() => {
    if (activeTab === "memo" && member) {
      setMemoText(member.notes ?? "");
      setMemoSaved(false);
    }
  }, [activeTab, member?.id]);

  const openEdit = () => {
    if (!member) return;
    setEditForm({
      name: member.name,
      phone: member.phone ?? "",
      email: member.email ?? "",
      beltRank: member.beltRank,
      beltDegree: member.beltDegree ?? 1,
      status: member.status,
      monthlyFee: member.monthlyFee,
      notes: member.notes ?? "",
    });
    setShowEdit(true);
  };

  const handleDelete = () => {
    Alert.alert("회원 삭제", `${member?.name} 회원을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => deleteMutation.mutate({ id: memberId }) },
    ]);
  };

  if (isLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator size="large" color="#1565C0" />
      </ScreenContainer>
    );
  }

  if (!member) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-muted text-center">회원 정보를 찾을 수 없습니다</Text>
        <TouchableOpacity className="mt-4" onPress={() => router.back()}>
          <Text className="text-primary">돌아가기</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  const beltColor = getBeltColor(member.beltRank);
  const beltTextColor = member.beltRank === "white" || member.beltRank === "yellow" ? "#212121" : "#FFFFFF";

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View className="px-5 pt-2 pb-3 flex-row items-center gap-1">
        <BackButton />
        <Text className="text-xl font-bold text-foreground flex-1">회원 상세</Text>
        {isManager && (
          <View className="flex-row gap-3">
            <TouchableOpacity onPress={openEdit}>
              <Text className="text-primary text-sm font-semibold">수정</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete}>
              <Text className="text-error text-sm font-semibold">삭제</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 프로필 카드 */}
      <View className="mx-5 mb-4 rounded-2xl overflow-hidden border border-border"
        style={{ backgroundColor: beltColor + "15" }}>
        <View className="p-5 flex-row items-center gap-4">
          <TouchableOpacity
            onPress={handlePickAvatar}
            disabled={avatarUploading || !isManager}
            style={{ position: "relative" }}
          >
            <View className="w-16 h-16 rounded-full items-center justify-center border-2 overflow-hidden"
              style={{ backgroundColor: beltColor, borderColor: beltColor }}>
              {member.avatarUrl ? (
                <Image source={{ uri: member.avatarUrl }} style={{ width: 64, height: 64 }} />
              ) : (
                <Text className="text-xl font-bold" style={{ color: beltTextColor }}>
                  {getInitials(member.name)}
                </Text>
              )}
            </View>
            {isManager && (
              <View style={{ position: "absolute", bottom: 0, right: 0, backgroundColor: "#1565C0", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
                {avatarUploading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{ color: "#FFF", fontSize: 11, fontWeight: "700" }}>+</Text>
                )}
              </View>
            )}
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-2xl font-bold text-foreground">{member.name}</Text>
            <View className="flex-row items-center gap-2 mt-1">
              <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: beltColor }}>
                <Text className="text-xs font-bold" style={{ color: beltTextColor }}>
                  {getBeltLabel(member.beltRank)} {member.beltDegree}단
                </Text>
              </View>
              <View className="px-2.5 py-1 rounded-full"
                style={{ backgroundColor: getMemberStatusColor(member.status) + "20" }}>
                <Text className="text-xs font-semibold"
                  style={{ color: getMemberStatusColor(member.status) }}>
                  {getMemberStatusLabel(member.status)}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* 한눈에 요약: 최근 출석 · 납부 · 띠 · 심사 예정 */}
      <View className="mx-5 mb-4 rounded-2xl border border-border bg-surface overflow-hidden">
        <View className="px-4 pt-3 pb-2 border-b border-border">
          <Text className="text-sm font-bold text-foreground">한눈에</Text>
          <Text className="text-xs text-muted mt-0.5">최근 활동과 일정을 바로 확인하고 각 영역으로 이동합니다</Text>
        </View>
        <View className="p-2">
          <TouchableOpacity
            className="flex-row items-center justify-between px-3 py-3 rounded-xl active:bg-background"
            onPress={() => setActiveTab("attendance")}
          >
            <View className="flex-1 pr-2">
              <Text className="text-xs text-muted">최근 출석</Text>
              <Text className="text-sm font-semibold text-foreground mt-0.5" numberOfLines={2}>
                {overview?.lastAttendance
                  ? `${formatDate(overview.lastAttendance.attendanceDate)} · ${getAttendanceTypeLabel(overview.lastAttendance.type)} · ${getCheckResultLabel(overview.lastAttendance.checkResult as CheckResult)}`
                  : "출석 기록 없음"}
              </Text>
              <Text className="text-xs text-muted mt-0.5">최근 30일 {overview?.attendanceCount30d ?? 0}회</Text>
            </View>
            <Text className="text-primary text-xs font-semibold">출석 ›</Text>
          </TouchableOpacity>
          <View className="h-px bg-border mx-2" />
          <TouchableOpacity
            className="flex-row items-center justify-between px-3 py-3 rounded-xl active:bg-background"
            onPress={() => setActiveTab("payments")}
          >
            <View className="flex-1 pr-2">
              <Text className="text-xs text-muted">다음 납부 예정</Text>
              <Text className="text-sm font-semibold text-foreground mt-0.5">
                {member.nextPaymentDate
                  ? formatDate(member.nextPaymentDate)
                  : (member as { suggestedNextPaymentDate?: string | null }).suggestedNextPaymentDate
                    ? `${formatDate((member as { suggestedNextPaymentDate: string }).suggestedNextPaymentDate)} (제안)`
                    : "미정"}
                {member.monthlyFee ? ` · ${formatAmount(member.monthlyFee)}` : ""}
              </Text>
            </View>
            <Text className="text-primary text-xs font-semibold">납부 ›</Text>
          </TouchableOpacity>
          <View className="h-px bg-border mx-2" />
          <TouchableOpacity
            className="flex-row items-center justify-between px-3 py-3 rounded-xl active:bg-background"
            onPress={() => setActiveTab("info")}
          >
            <View className="flex-1 pr-2">
              <Text className="text-xs text-muted">현재 띠</Text>
              <Text className="text-sm font-semibold text-foreground mt-0.5">
                {getBeltLabel(member.beltRank)} {member.beltDegree}단
              </Text>
            </View>
            <Text className="text-primary text-xs font-semibold">기본정보 ›</Text>
          </TouchableOpacity>
          <View className="h-px bg-border mx-2" />
          <TouchableOpacity
            className="flex-row items-center justify-between px-3 py-3 rounded-xl active:bg-background"
            onPress={() => router.push("/(tabs)/promotions" as never)}
          >
            <View className="flex-1 pr-2">
              <Text className="text-xs text-muted">승급 심사 (대기)</Text>
              <Text className="text-sm font-semibold text-foreground mt-0.5" numberOfLines={2}>
                {overview?.pendingPromotion
                  ? `${formatDate(overview.pendingPromotion.examDate)} · ${getBeltLabel(overview.pendingPromotion.currentBelt as BeltRank)}→${getBeltLabel(overview.pendingPromotion.targetBelt as BeltRank)}`
                  : "예정된 심사 없음"}
              </Text>
            </View>
            <Text className="text-primary text-xs font-semibold">심사 ›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 탭 */}
      <View className="mx-5 mb-3 flex-row bg-surface rounded-xl border border-border p-1">
            {(["info", "attendance", "payments", "memo"] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            className="flex-1 py-2 rounded-lg items-center"
            style={{ backgroundColor: activeTab === tab ? "#1565C0" : "transparent" }}
            onPress={() => setActiveTab(tab)}
          >
            <Text className="text-xs font-semibold"
              style={{ color: activeTab === tab ? "#FFFFFF" : "#687076" }}>
              {tab === "info" ? "기본 정보" : tab === "attendance" ? "출석" : tab === "payments" ? "납부" : "메모"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 30 }}>

        {/* 기본 정보 탭 */}
        {activeTab === "info" && (
          <View className="gap-3">
            <InfoCard items={[
              { label: "전화번호", value: member.phone ?? "-" },
              { label: "이메일", value: member.email ?? "-" },
              { label: "생년월일", value: member.birthDate ? `${formatDate(member.birthDate)} (${getAge(member.birthDate)}세)` : "-" },
              { label: "성별", value: member.gender === "male" ? "남성" : member.gender === "female" ? "여성" : "-" },
            ]} />
            <InfoCard items={[
              { label: "입관일", value: formatDate(member.joinDate) },
              { label: "월 회비", value: formatAmount(member.monthlyFee) },
              {
                label: "다음 납부일",
                value: member.nextPaymentDate
                  ? formatDate(member.nextPaymentDate)
                  : (member as { suggestedNextPaymentDate?: string | null }).suggestedNextPaymentDate
                    ? `${formatDate((member as { suggestedNextPaymentDate: string }).suggestedNextPaymentDate)} (자동 제안)`
                    : "-",
              },
            ]} />
            {member.emergencyContact && (
              <InfoCard items={[{ label: "비상연락처", value: member.emergencyContact }]} />
            )}
            {member.notes && (
              <View className="bg-surface rounded-2xl border border-border p-4">
                <Text className="text-xs text-muted mb-1">메모</Text>
                <Text className="text-sm text-foreground leading-5">{member.notes}</Text>
              </View>
            )}
          </View>
        )}

        {/* 출석 탭 */}
        {activeTab === "attendance" && (
          <View className="gap-4">
            <MemberActivityTimeline
              events={activityTimeline ?? []}
              loading={timelineLoading}
            />
            {/* 최근 6개월 출석 통계 그래프 */}
            <AttendanceBarChart stats={attendanceStats ?? []} />
            {/* 월별 캘린더 */}
            <AttendanceCalendar
              year={calYear}
              month={calMonth}
              attendanceData={attendanceMonth ?? []}
              onPrevMonth={() => {
                if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
                else setCalMonth(m => m - 1);
              }}
              onNextMonth={() => {
                const now2 = new Date();
                if (calYear > now2.getFullYear() || (calYear === now2.getFullYear() && calMonth >= now2.getMonth() + 1)) return;
                if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
                else setCalMonth(m => m + 1);
              }}
              isCurrentMonth={calYear === now.getFullYear() && calMonth === now.getMonth() + 1}
            />
          </View>
        )}

        {/* 납부 탭 */}
        {activeTab === "payments" && (
          <View className="gap-3">
            {(payments ?? []).length === 0 ? (
              <View className="items-center py-10">
                <Text className="text-4xl mb-3">💳</Text>
                <Text className="text-muted text-center">납부 기록이 없습니다</Text>
              </View>
            ) : (
              (payments ?? []).map(p => (
                <View key={p.id} className="bg-surface rounded-2xl border border-border p-4">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-base font-bold text-foreground">{formatAmount(p.amount)}</Text>
                    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: "#2DA44E20" }}>
                      <Text className="text-xs font-semibold" style={{ color: "#2DA44E" }}>
                        {getPaymentMethodLabel(p.method)}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-xs text-muted">{formatDateTime(p.paidAt)}</Text>
                  {(p.periodStart || p.periodEnd) && (
                    <Text className="text-xs text-muted mt-1">
                      기간: {formatDate(p.periodStart)} ~ {formatDate(p.periodEnd)}
                    </Text>
                  )}
                  {p.notes && <Text className="text-xs text-muted mt-1">{p.notes}</Text>}
                </View>
              ))
            )}
          </View>
        )}

        {/* 메모 탭 */}
        {activeTab === "memo" && (
          <View className="gap-4">
            {!isManager ? (
              <View className="items-center py-10">
                <Text className="text-4xl mb-3">🔒</Text>
                <Text className="text-muted text-center">관리자만 메모를 입력할 수 있습니다</Text>
              </View>
            ) : (
              <>
                <View className="bg-surface rounded-2xl border border-border p-4">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-xs font-semibold text-foreground">📝 관리자 메모</Text>
                    <View className="flex-row items-center gap-2">
                      {(member as any)?.notesUpdatedAt && (
                        <Text className="text-xs text-muted">
                          {new Date((member as any).notesUpdatedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      )}
                      <TouchableOpacity
                        onPress={() => setShowMemoHistory(true)}
                        style={{ backgroundColor: "#E8F0FE", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}
                      >
                        <Text style={{ color: "#1565C0", fontSize: 11, fontWeight: "600" }}>📜 수정 이력</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text className="text-xs text-muted mb-3">부상 이력, 특이사항, 수련 상태 등 회원에 대한 내용을 자유롭게 입력하세요.</Text>
                  <TextInput
                    value={memoText}
                    onChangeText={setMemoText}
                    placeholder="메모를 입력하세요..."
                    multiline
                    numberOfLines={8}
                    style={{
                      backgroundColor: "transparent",
                      borderWidth: 1,
                      borderColor: "#E5E7EB",
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 14,
                      color: "#11181C",
                      minHeight: 160,
                      textAlignVertical: "top",
                    }}
                  />
                </View>
                <TouchableOpacity
                  style={{
                    backgroundColor: memoSaved ? "#2DA44E" : "#1565C0",
                    borderRadius: 14,
                    paddingVertical: 14,
                    alignItems: "center",
                  }}
                  onPress={() => saveMemoMutation.mutate({ id: memberId, notes: memoText })}
                  disabled={saveMemoMutation.isPending}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                    {saveMemoMutation.isPending ? "저장 중..." : memoSaved ? "✓ 저장되었습니다" : "메모 저장"}
                  </Text>
                </TouchableOpacity>
                {member?.notes && memoText !== member.notes && (
                  <TouchableOpacity
                    style={{ alignItems: "center", paddingVertical: 8 }}
                    onPress={() => setMemoText(member.notes ?? "")}
                  >
                    <Text style={{ color: "#687076", fontSize: 13 }}>수정 취소</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* 메모 이력 모달 */}
      <Modal visible={showMemoHistory} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowMemoHistory(false)}>
        <MemoHistoryModal
          memberId={memberId}
          visible={showMemoHistory}
          onClose={() => setShowMemoHistory(false)}
          data={memoHistoryData ?? []}
          isLoading={memoHistoryLoading}
        />
      </Modal>

      {/* 수정 모달 */}
      <Modal visible={showEdit} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <Text className="text-xl font-bold text-foreground">회원 정보 수정</Text>
            <TouchableOpacity onPress={() => setShowEdit(false)}>
              <Text className="text-primary font-semibold">취소</Text>
            </TouchableOpacity>
          </View>
          {editForm && (
            <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
              <View className="py-4 gap-4">
                <EditField label="이름" value={editForm.name} onChangeText={v => setEditForm(f => f ? { ...f, name: v } : null)} />
                <EditField label="전화번호" value={editForm.phone} onChangeText={v => setEditForm(f => f ? { ...f, phone: v } : null)} keyboardType="phone-pad" />
                <EditField label="이메일" value={editForm.email} onChangeText={v => setEditForm(f => f ? { ...f, email: v } : null)} keyboardType="email-address" />
                <EditField label="월 회비 (원)" value={String(editForm.monthlyFee)} onChangeText={v => setEditForm(f => f ? { ...f, monthlyFee: parseInt(v) || 0 } : null)} keyboardType="numeric" />

                {/* 띠 선택 */}
                <View>
                  <Text className="text-sm font-medium text-foreground mb-2">띠 등급</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row gap-2">
                      {BELT_RANKS.map(rank => (
                        <TouchableOpacity key={rank}
                          className="px-3 py-2 rounded-xl border"
                          style={{
                            backgroundColor: editForm.beltRank === rank ? getBeltColor(rank) : "transparent",
                            borderColor: getBeltColor(rank),
                          }}
                          onPress={() => setEditForm(f => f ? { ...f, beltRank: rank } : null)}
                        >
                          <Text className="text-xs font-medium"
                            style={{ color: editForm.beltRank === rank ? "#FFFFFF" : getBeltColor(rank) }}>
                            {getBeltLabel(rank)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* 상태 선택 */}
                <View>
                  <Text className="text-sm font-medium text-foreground mb-2">회원 상태</Text>
                  <View className="flex-row gap-2">
                    {STATUSES.map(s => (
                      <TouchableOpacity key={s}
                        className="flex-1 py-2.5 rounded-xl border items-center"
                        style={{
                          backgroundColor: editForm.status === s ? getMemberStatusColor(s) : "transparent",
                          borderColor: getMemberStatusColor(s),
                        }}
                        onPress={() => setEditForm(f => f ? { ...f, status: s } : null)}
                      >
                        <Text className="text-xs font-medium"
                          style={{ color: editForm.status === s ? "#FFFFFF" : getMemberStatusColor(s) }}>
                          {getMemberStatusLabel(s)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <EditField label="메모" value={editForm.notes} onChangeText={v => setEditForm(f => f ? { ...f, notes: v } : null)} multiline />
              </View>
            </ScrollView>
          )}
          <View className="px-5 pt-3 border-t border-border" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
            <TouchableOpacity
              style={{ backgroundColor: "#1565C0" }}
              className="rounded-2xl py-4 items-center"
              onPress={() => {
                if (!editForm) return;
                updateMutation.mutate({
                  id: memberId,
                  name: editForm.name,
                  phone: editForm.phone || undefined,
                  email: editForm.email || undefined,
                  beltRank: editForm.beltRank,
                  beltDegree: editForm.beltDegree,
                  status: editForm.status,
                  monthlyFee: editForm.monthlyFee,
                  notes: editForm.notes || undefined,
                });
              }}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text className="text-white font-bold text-base">수정 완료</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function InfoCard({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View className="bg-surface rounded-2xl border border-border overflow-hidden">
      {items.map((item, i) => (
        <View key={item.label}
          className={`flex-row items-center justify-between px-4 py-3 ${i < items.length - 1 ? "border-b border-border" : ""}`}>
          <Text className="text-sm text-muted">{item.label}</Text>
          <Text className="text-sm font-medium text-foreground">{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

function EditField({ label, value, onChangeText, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void;
  keyboardType?: any; multiline?: boolean;
}) {
  return (
    <View>
      <Text className="text-sm font-medium text-foreground mb-1">{label}</Text>
      <TextInput
        className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        style={multiline ? { height: 80, textAlignVertical: "top" } : undefined}
        placeholderTextColor="#9BA1A6"
      />
    </View>
  );
}

// ─── 출석·납부·심사 통합 타임라인 ─────────────────────────────────────────────
function MemberActivityTimeline({
  events,
  loading,
}: {
  events: MemberActivityEvent[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <View className="bg-surface rounded-2xl border border-border p-4 items-center py-6">
        <ActivityIndicator size="small" color="#1565C0" />
        <Text className="text-xs text-muted mt-2">타임라인 불러오는 중…</Text>
      </View>
    );
  }
  if (events.length === 0) {
    return (
      <View className="bg-surface rounded-2xl border border-border p-4">
        <Text className="text-sm font-bold text-foreground">활동 타임라인</Text>
        <Text className="text-xs text-muted mt-1">출석·납부·승급 심사 기록이 없습니다</Text>
      </View>
    );
  }

  return (
    <View className="bg-surface rounded-2xl border border-border p-4">
      <Text className="text-sm font-bold text-foreground">활동 타임라인</Text>
      <Text className="text-xs text-muted mt-0.5 mb-3">출석 · 납부 · 승급 심사를 최신순으로 모았습니다</Text>
      {events.map((ev, idx) => (
        <View
          key={`${ev.kind}-${ev.id}`}
          className={`flex-row gap-3 pb-3 ${idx < events.length - 1 ? "border-b border-border mb-3" : ""}`}
        >
          <Text className="text-lg pt-0.5" accessibilityLabel={ev.kind === "attendance" ? "출석" : ev.kind === "payment" ? "납부" : "승급 심사"}>
            {ev.kind === "attendance" ? "🥋" : ev.kind === "payment" ? "💳" : "🏆"}
          </Text>
          <View className="flex-1 min-w-0">
            <Text className="text-[11px] text-muted">{formatDateTime(ev.at)}</Text>
            {ev.kind === "attendance" ? (
              <>
                <Text className="text-sm font-semibold text-foreground mt-0.5">
                  출석 · {getAttendanceTypeLabel(ev.type)} · {getCheckResultLabel(ev.checkResult as CheckResult)}
                </Text>
                <Text className="text-xs text-muted mt-0.5">기준일 {formatDate(ev.attendanceDate)}</Text>
                {ev.notes ? <Text className="text-xs text-muted mt-1">{ev.notes}</Text> : null}
              </>
            ) : ev.kind === "payment" ? (
              <>
                <Text className="text-sm font-semibold text-foreground mt-0.5">
                  납부 {formatAmount(ev.amount)} · {getPaymentMethodLabel(ev.method)}
                </Text>
                {ev.periodStart && ev.periodEnd ? (
                  <Text className="text-xs text-muted mt-0.5">
                    기간 {formatDate(ev.periodStart)} ~ {formatDate(ev.periodEnd)}
                  </Text>
                ) : null}
                {ev.notes ? <Text className="text-xs text-muted mt-1">{ev.notes}</Text> : null}
              </>
            ) : (
              <>
                <Text className="text-sm font-semibold text-foreground mt-0.5">
                  승급 심사 · {getPromotionResultLabel(ev.result)}
                </Text>
                <Text className="text-xs text-muted mt-0.5">
                  심사일 {formatDate(ev.examDate)} · {getBeltLabel(ev.currentBelt as BeltRank)} → {getBeltLabel(ev.targetBelt as BeltRank)}
                </Text>
                {ev.notes ? <Text className="text-xs text-muted mt-1">{ev.notes}</Text> : null}
              </>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── 최근 6개월 출석 통계 바 차트 ────────────────────────────────────────────
const MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

function AttendanceBarChart({ stats }: { stats: { year: number; month: number; count: number }[] }) {
  const screenWidth = Dimensions.get("window").width;
  const chartWidth = screenWidth - 40; // 좌우 패딩 20씩
  const maxCount = Math.max(...stats.map(s => s.count), 1);
  const barWidth = Math.floor((chartWidth - 32) / Math.max(stats.length, 1)) - 8;

  // 연속 출석 계산 (현재 달 기준)
  const totalDays = stats.reduce((sum, s) => sum + s.count, 0);
  const avgPerMonth = stats.length > 0 ? Math.round(totalDays / stats.length) : 0;

  return (
    <View className="bg-surface rounded-2xl border border-border p-4">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-sm font-bold text-foreground">최근 6개월 출석 현황</Text>
        <View className="flex-row gap-3">
          <View className="items-center">
            <Text className="text-base font-bold" style={{ color: "#1565C0" }}>{totalDays}</Text>
            <Text className="text-xs text-muted">총 출석</Text>
          </View>
          <View className="items-center">
            <Text className="text-base font-bold" style={{ color: "#2DA44E" }}>{avgPerMonth}</Text>
            <Text className="text-xs text-muted">월 평균</Text>
          </View>
        </View>
      </View>

      {/* 바 차트 */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", height: 100, gap: 4, paddingHorizontal: 4 }}>
        {stats.map((s, i) => {
          const barHeight = maxCount > 0 ? Math.max((s.count / maxCount) * 80, s.count > 0 ? 4 : 0) : 0;
          const isCurrentMonth = i === stats.length - 1;
          return (
            <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
              {s.count > 0 && (
                <Text style={{ fontSize: 9, color: "#687076", marginBottom: 2 }}>{s.count}</Text>
              )}
              <View
                style={{
                  width: "100%",
                  height: barHeight,
                  backgroundColor: isCurrentMonth ? "#1565C0" : "#1565C040",
                  borderRadius: 4,
                  minHeight: s.count > 0 ? 4 : 0,
                }}
              />
              <Text style={{ fontSize: 9, color: isCurrentMonth ? "#1565C0" : "#9BA1A6", marginTop: 4, fontWeight: isCurrentMonth ? "700" : "400" }}>
                {MONTH_LABELS[s.month - 1]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── 월별 출석 캘린더 컴포넌트 ────────────────────────────────────────────────
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const ATTENDANCE_TYPE_COLORS: Record<AttendanceType, string> = {
  regular: "#1565C0",
  makeup: "#7B3F9E",
  trial: "#2DA44E",
};

function AttendanceCalendar({
  year, month, attendanceData, onPrevMonth, onNextMonth, isCurrentMonth,
}: {
  year: number;
  month: number;
  attendanceData: { id: number; attendanceDate: string; type: AttendanceType; checkResult?: CheckResult }[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  isCurrentMonth: boolean;
}) {
  // 출석 날짜 → type 맵 (정시·지각만 색 채움, 결석은 별도 표시)
  const { attendanceMap, absentDays } = useMemo(() => {
    const map: Record<number, AttendanceType> = {};
    const absent = new Set<number>();
    for (const a of attendanceData) {
      const day = parseInt(a.attendanceDate.split("-")[2], 10);
      const cr = a.checkResult ?? "present";
      if (cr === "absent") absent.add(day);
      else map[day] = a.type;
    }
    return { attendanceMap: map, absentDays: absent };
  }, [attendanceData]);

  // 이번 달 날짜 계산
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=일
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const todayDay = (today.getFullYear() === year && today.getMonth() + 1 === month)
    ? today.getDate() : -1;

  // 캘린더 셀 배열 (빈 칸 + 날짜)
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // 6행 맞추기
  while (cells.length % 7 !== 0) cells.push(null);

  const attendedDays = attendanceData.filter((a) => (a.checkResult ?? "present") !== "absent").length;
  const workingDays = daysInMonth; // 단순 비율
  const rate = calcAttendanceRate(attendedDays, Math.min(workingDays, isCurrentMonth ? todayDay : daysInMonth));

  return (
    <View className="gap-3">
      {/* 헤더 - 월 이동 */}
      <View className="bg-surface rounded-2xl border border-border p-4">
        <View className="flex-row items-center justify-between mb-4">
          <TouchableOpacity
            onPress={onPrevMonth}
            className="w-9 h-9 rounded-full items-center justify-center"
            style={{ backgroundColor: "#1565C010" }}
          >
            <Text style={{ color: "#1565C0", fontSize: 18, fontWeight: "600" }}>‹</Text>
          </TouchableOpacity>
          <View className="items-center">
            <Text className="text-base font-bold text-foreground">{year}년 {month}월</Text>
            <Text className="text-xs text-muted mt-0.5">출석 {attendedDays}회</Text>
          </View>
          <TouchableOpacity
            onPress={onNextMonth}
            className="w-9 h-9 rounded-full items-center justify-center"
            style={{
              backgroundColor: isCurrentMonth ? "#E5E7EB" : "#1565C010",
              opacity: isCurrentMonth ? 0.4 : 1,
            }}
            disabled={isCurrentMonth}
          >
            <Text style={{ color: "#1565C0", fontSize: 18, fontWeight: "600" }}>›</Text>
          </TouchableOpacity>
        </View>

        {/* 출석률 바 */}
        <View className="mb-4">
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted">이달 출석률</Text>
            <Text className="text-xs font-bold" style={{ color: rate >= 80 ? "#2DA44E" : rate >= 50 ? "#F4A261" : "#CF222E" }}>
              {rate}%
            </Text>
          </View>
          <View className="h-2 rounded-full bg-border overflow-hidden">
            <View
              className="h-2 rounded-full"
              style={{
                width: `${rate}%`,
                backgroundColor: rate >= 80 ? "#2DA44E" : rate >= 50 ? "#F4A261" : "#CF222E",
              }}
            />
          </View>
        </View>

        {/* 요일 헤더 */}
        <View className="flex-row mb-1">
          {WEEKDAYS.map((d, i) => (
            <View key={d} className="flex-1 items-center py-1">
              <Text
                className="text-xs font-semibold"
                style={{ color: i === 0 ? "#CF222E" : i === 6 ? "#1565C0" : "#687076" }}
              >
                {d}
              </Text>
            </View>
          ))}
        </View>

        {/* 날짜 셀 */}
        <View>
          {Array.from({ length: cells.length / 7 }, (_, row) => (
            <View key={row} className="flex-row">
              {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                const attendType = day ? attendanceMap[day] : undefined;
                const isAbsentOnly = day ? absentDays.has(day) && !attendType : false;
                const isToday = day === todayDay;
                const isSun = col === 0;
                const isSat = col === 6;

                return (
                  <View key={col} className="flex-1 items-center py-1">
                    {day ? (
                      <View
                        className="w-8 h-8 rounded-full items-center justify-center"
                        style={{
                          backgroundColor: attendType
                            ? ATTENDANCE_TYPE_COLORS[attendType]
                            : isAbsentOnly
                              ? "#CF222E35"
                              : isToday ? "#1565C010" : "transparent",
                          borderWidth: isToday && !attendType && !isAbsentOnly ? 1.5 : isAbsentOnly ? 1.5 : 0,
                          borderColor: isAbsentOnly ? "#CF222E" : "#1565C0",
                        }}
                      >
                        <Text
                          className="text-xs font-semibold"
                          style={{
                            color: attendType
                              ? "#FFFFFF"
                              : isAbsentOnly
                                ? "#CF222E"
                              : isToday
                              ? "#1565C0"
                              : isSun
                              ? "#CF222E"
                              : isSat
                              ? "#1565C0"
                              : "#11181C",
                          }}
                        >
                          {day}
                        </Text>
                      </View>
                    ) : (
                      <View className="w-8 h-8" />
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>

      {/* 범례 */}
      <View className="bg-surface rounded-2xl border border-border p-4">
        <Text className="text-xs font-semibold text-foreground mb-3">범례</Text>
        <View className="flex-row gap-4 flex-wrap">
          {(Object.entries(ATTENDANCE_TYPE_COLORS) as [AttendanceType, string][]).map(([type, color]) => (
            <View key={type} className="flex-row items-center gap-2">
              <View className="w-5 h-5 rounded-full" style={{ backgroundColor: color }} />
              <Text className="text-xs text-muted">{getAttendanceTypeLabel(type)}</Text>
            </View>
          ))}
          <View className="flex-row items-center gap-2">
            <View className="w-5 h-5 rounded-full border-2" style={{ borderColor: "#CF222E", backgroundColor: "#CF222E35" }} />
            <Text className="text-xs text-muted">결석</Text>
          </View>
        </View>
      </View>

      {/* 출석 목록 */}
      {attendanceData.length > 0 && (
        <View className="bg-surface rounded-2xl border border-border overflow-hidden">
          <View className="px-4 py-3 border-b border-border">
            <Text className="text-xs font-semibold text-foreground">출석 기록</Text>
          </View>
          {attendanceData.map((a, i) => (
            <View
              key={a.id}
              className={`flex-row items-center justify-between px-4 py-3 ${i < attendanceData.length - 1 ? "border-b border-border" : ""}`}
            >
              <View className="flex-1">
                <Text className="text-sm text-foreground">{formatDate(a.attendanceDate)}</Text>
                <Text className="text-xs text-muted mt-0.5">{getCheckResultLabel((a.checkResult ?? "present") as CheckResult)}</Text>
              </View>
              <View
                className="px-2.5 py-1 rounded-full"
                style={{ backgroundColor: ATTENDANCE_TYPE_COLORS[a.type] + "20" }}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: ATTENDANCE_TYPE_COLORS[a.type] }}
                >
                  {getAttendanceTypeLabel(a.type)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── 메모 이력 모달 컴포넌트 ─────────────────────────────────────────────────
type MemoHistoryItem = {
  id: number;
  memberId: number;
  content: string;
  savedBy: number;
  savedAt: Date | null;
  savedByName: string | null;
};

function MemoHistoryModal({
  memberId,
  visible,
  onClose,
  data,
  isLoading,
}: {
  memberId: number;
  visible: boolean;
  onClose: () => void;
  data: MemoHistoryItem[];
  isLoading: boolean;
}) {
  const utils = trpc.useUtils();

  const deleteItemMutation = trpc.memoHistory.deleteItem.useMutation({
    onSuccess: () => utils.memoHistory.list.invalidate({ memberId }),
    onError: (e) => Alert.alert("오류", e.message),
  });

  const clearAllMutation = trpc.memoHistory.clearAll.useMutation({
    onSuccess: () => utils.memoHistory.list.invalidate({ memberId }),
    onError: (e) => Alert.alert("오류", e.message),
  });

  const handleDeleteItem = (id: number, index: number) => {
    Alert.alert(
      "이력 삭제",
      `버전 ${data.length - index} 이력을 삭제하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: () => deleteItemMutation.mutate({ id }) },
      ]
    );
  };

  const handleClearAll = () => {
    Alert.alert(
      "전체 이력 초기화",
      "모든 메모 수정 이력을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
      [
        { text: "취소", style: "cancel" },
        { text: "초기화", style: "destructive", onPress: () => clearAllMutation.mutate({ memberId }) },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 17, fontWeight: "700", color: "#11181C" }}>📜 메모 수정 이력</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {data.length > 0 && (
            <TouchableOpacity onPress={handleClearAll} disabled={clearAllMutation.isPending}>
              <Text style={{ fontSize: 13, color: "#EF4444", fontWeight: "600" }}>전체 삭제</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Text style={{ fontSize: 15, color: "#687076" }}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : data.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
          <Text style={{ fontSize: 15, color: "#687076", textAlign: "center" }}>아직 수정 이력이 없습니다.{"\n"}메모를 저장하면 이전 버전이 여기에 기록됩니다.</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
          <Text style={{ fontSize: 12, color: "#687076", marginBottom: 16 }}>총 {data.length}개의 이전 버전</Text>
          {data.map((item, index) => (
            <View key={item.id} style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: index < data.length - 1 ? 0.5 : 0, borderBottomColor: "#E5E7EB" }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#E8F0FE", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#1565C0" }}>{data.length - index}</Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: "#11181C" }}>
                    {item.savedByName ?? "관리자"}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontSize: 11, color: "#687076" }}>
                    {item.savedAt ? new Date(item.savedAt).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleDeleteItem(item.id, index)}
                    disabled={deleteItemMutation.isPending}
                    style={{ padding: 4 }}
                  >
                    <Text style={{ fontSize: 13, color: "#EF4444" }}>삭제</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{ backgroundColor: "#F8F9FA", borderRadius: 10, padding: 12 }}>
                <Text style={{ fontSize: 13, color: "#11181C", lineHeight: 20 }}>{item.content}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
