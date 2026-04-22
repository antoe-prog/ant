import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  Modal, ScrollView, Alert, ActivityIndicator, Pressable, Platform, Image,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { useTabBackHandler, useModalBackHandler } from "@/hooks/use-back-handler";
import {
  getBeltColor, getBeltLabel, getBeltOrder, getMemberStatusColor, getMemberStatusLabel,
  formatDate, formatAmount, getInitials, digitsOnly,
} from "@/lib/judo-utils";
import type { BeltRank, MemberStatus } from "@/lib/judo-utils";
import { idKeyExtractor as memberKeyExtractor, listPerfProps } from "@/lib/list-utils";
import { EmptyState, LoadingView, PillButton } from "@/components/ui/primitives";

const BELT_RANKS: BeltRank[] = ["white", "yellow", "orange", "green", "blue", "brown", "black"];
type MemberSortKey = "name" | "joinDate" | "belt" | "fee" | "nextPayment";
type PaymentFilterKey = "all" | "overdue" | "dueSoon";

const SORT_OPTIONS: { key: MemberSortKey; label: string }[] = [
  { key: "name", label: "이름" },
  { key: "joinDate", label: "입관일" },
  { key: "belt", label: "띠" },
  { key: "fee", label: "회비" },
  { key: "nextPayment", label: "납부일" },
];

// ─── MemberRow 컴포넌트 (Rules of Hooks 준수를 위해 분리) ──────────────────────
interface MemberRowProps {
  item: {
    id: number;
    name: string;
    beltRank: BeltRank;
    status: MemberStatus;
    phone?: string | null;
    notes?: string | null;
    monthlyFee: number;
    nextPaymentDate?: string | null;
    avatarUrl?: string | null;
  };
  tooltipMemberId: number | null;
  onShowTooltip: (id: number) => void;
  onHideTooltip: () => void;
  onPress: (id: number) => void;
  onCheckIn: (id: number, name: string, ref: React.RefObject<Swipeable | null>) => void;
  onDelete: (id: number, name: string, ref: React.RefObject<Swipeable | null>) => void;
}

function MemberRow({
  item,
  tooltipMemberId,
  onShowTooltip,
  onHideTooltip,
  onPress,
  onCheckIn,
  onDelete,
}: MemberRowProps) {
  const swipeableRef = useRef<Swipeable | null>(null);

  const renderRightActions = useCallback(() => (
    <View style={{ flexDirection: "row", alignItems: "stretch" }}>
      {/* 출석 체크인 */}
      <TouchableOpacity
        style={{
          backgroundColor: "#2DA44E",
          justifyContent: "center",
          alignItems: "center",
          width: 80,
        }}
        onPress={() => onCheckIn(item.id, item.name, swipeableRef)}
      >
        <Text style={{ fontSize: 22 }}>✅</Text>
        <Text style={{ fontSize: 10, color: "#fff", fontWeight: "600", marginTop: 2 }}>출석</Text>
      </TouchableOpacity>
      {/* 삭제 */}
      <TouchableOpacity
        style={{
          backgroundColor: "#CF222E",
          justifyContent: "center",
          alignItems: "center",
          width: 80,
          borderTopRightRadius: 16,
          borderBottomRightRadius: 16,
        }}
        onPress={() => onDelete(item.id, item.name, swipeableRef)}
      >
        <Text style={{ fontSize: 22 }}>🗑️</Text>
        <Text style={{ fontSize: 10, color: "#fff", fontWeight: "600", marginTop: 2 }}>삭제</Text>
      </TouchableOpacity>
    </View>
  ), [item.id, item.name, onCheckIn, onDelete]);

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
      rightThreshold={40}
    >
      <TouchableOpacity
        style={{
          backgroundColor: "var(--color-surface, #f5f5f5)",
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "var(--color-border, #E5E7EB)",
          padding: 16,
        }}
        className="bg-surface rounded-2xl border border-border p-4"
        onPress={() => onPress(item.id)}
      >
        <View className="flex-row items-center gap-3">
          {/* 아바타 */}
          {item.avatarUrl ? (
            <Image
              source={{ uri: item.avatarUrl }}
              className="w-12 h-12 rounded-full"
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#F1F5F9" }}
            />
          ) : (
            <View
              className="w-12 h-12 rounded-full items-center justify-center"
              style={{ backgroundColor: getBeltColor(item.beltRank) + "30" }}
            >
              <Text className="text-lg font-bold" style={{ color: getBeltColor(item.beltRank) }}>
                {getInitials(item.name)}
              </Text>
            </View>
          )}
          {/* 정보 */}
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-base font-semibold text-foreground">{item.name}</Text>
              <View className="w-3 h-3 rounded-full" style={{ backgroundColor: getBeltColor(item.beltRank) }} />
              <Text className="text-xs text-muted">{getBeltLabel(item.beltRank)}</Text>
              {item.notes && item.notes.trim().length > 0 && (
                <View>
                  <Pressable
                    onLongPress={() => onShowTooltip(item.id)}
                    onPress={() => tooltipMemberId === item.id ? onHideTooltip() : onShowTooltip(item.id)}
                    style={{ backgroundColor: "#FFF3CD", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}
                  >
                    <Text style={{ fontSize: 10, color: "#856404" }}>📝 메모</Text>
                  </Pressable>
                  {tooltipMemberId === item.id && (
                    <MemoTooltip notes={item.notes} onDismiss={onHideTooltip} />
                  )}
                </View>
              )}
            </View>
            <View className="flex-row items-center gap-2 mt-0.5">
              <View
                className="px-2 py-0.5 rounded-full"
                style={{ backgroundColor: getMemberStatusColor(item.status) + "20" }}
              >
                <Text className="text-xs font-medium" style={{ color: getMemberStatusColor(item.status) }}>
                  {getMemberStatusLabel(item.status)}
                </Text>
              </View>
              {item.phone && <Text className="text-xs text-muted">{item.phone}</Text>}
            </View>
          </View>
          {/* 회비 */}
          <View className="items-end">
            <Text className="text-sm font-semibold text-foreground">{formatAmount(item.monthlyFee)}</Text>
            <Text className="text-xs text-muted">월 회비</Text>
          </View>
        </View>
        {/* 다음 납부일 */}
        {item.nextPaymentDate && (
          <View className="mt-2 pt-2 border-t border-border flex-row items-center gap-1">
            <Text className="text-xs text-muted">다음 납부일:</Text>
            <Text className="text-xs font-medium text-foreground">{formatDate(item.nextPaymentDate)}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Swipeable>
  );
}

// ─── 메인 화면 ─────────────────────────────────────────────────────────────────
export default function MemberListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [beltFilter, setBeltFilter] = useState<BeltRank | null>(null);
  const [statusFilter, setStatusFilter] = useState<MemberStatus | "all">("all");
  const [sortKey, setSortKey] = useState<MemberSortKey>("name");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilterKey>("all");
  const [memoOnly, setMemoOnly] = useState(false);
  const [tooltipMemberId, setTooltipMemberId] = useState<number | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    };
  }, []);

  const showTooltip = useCallback((id: number) => {
    setTooltipMemberId(id);
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => setTooltipMemberId(null), 3000);
  }, []);

  const hideTooltip = useCallback(() => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setTooltipMemberId(null);
  }, []);

  useTabBackHandler();
  useModalBackHandler(showAdd, () => { setShowAdd(false); resetForm(); });

  const [form, setForm] = useState({
    name: "", phone: "", email: "", birthDate: "",
    gender: "male" as "male" | "female" | "other",
    beltRank: "white" as BeltRank,
    beltDegree: 1,
    joinDate: new Date().toISOString().split("T")[0],
    monthlyFee: 80000,
    emergencyContact: "",
    notes: "",
  });

  const { data: members, isLoading } = trpc.members.list.useQuery();

  const createMutation = trpc.members.create.useMutation({
    onSuccess: () => {
      void utils.members.list.invalidate();
      // 전체 회원 수가 달라지므로 홈 대시보드도 갱신
      void utils.dashboard.stats.invalidate();
      setShowAdd(false);
      resetForm();
    },
    onError: (e: any) => Alert.alert("오류", e.message),
  });

  const deleteMutation = trpc.members.delete.useMutation({
    onSuccess: () => {
      void utils.members.list.invalidate();
      void utils.dashboard.stats.invalidate();
    },
    onError: (e: any) => Alert.alert("오류", e.message),
  });

  const checkInMutation = trpc.attendance.check.useMutation({
    onSuccess: () => {
      void utils.members.list.invalidate();
      void utils.members.overview.invalidate();
      void utils.members.activityTimeline.invalidate();
      // 출석 체크인은 오늘 출석수·일별·월별 차트에 모두 영향
      void utils.attendance.today.invalidate();
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.dailyAttendance.invalidate();
      void utils.dashboard.monthlyStats.invalidate();
      Alert.alert("체크인 완료", "오늘 출석이 등록되었습니다.");
    },
    onError: (e: any) => Alert.alert("오류", e.message),
  });

  const handleSwipeCheckIn = useCallback((
    memberId: number,
    memberName: string,
    swipeableRef: React.RefObject<Swipeable | null>,
  ) => {
    swipeableRef.current?.close();
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      "오늘 출석 체크인",
      `${memberName}님의 오늘 출석을 등록하시겠습니까?`,
      [
        { text: "취소", style: "cancel", onPress: () => swipeableRef.current?.close() },
        {
          text: "등록",
          onPress: () => checkInMutation.mutate({
            memberId,
            attendanceDate: new Date().toISOString().split("T")[0],
            type: "regular",
            checkResult: "present",
          }),
        },
      ],
    );
  }, [checkInMutation]);

  const handleSwipeDelete = useCallback((
    memberId: number,
    memberName: string,
    swipeableRef: React.RefObject<Swipeable | null>,
  ) => {
    swipeableRef.current?.close();
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      "회원 삭제",
      `${memberName}님을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      [
        { text: "취소", style: "cancel", onPress: () => swipeableRef.current?.close() },
        { text: "삭제", style: "destructive", onPress: () => deleteMutation.mutate({ id: memberId }) },
      ],
    );
  }, [deleteMutation]);

  const resetForm = () => setForm({
    name: "", phone: "", email: "", birthDate: "",
    gender: "male", beltRank: "white", beltDegree: 1,
    joinDate: new Date().toISOString().split("T")[0],
    monthlyFee: 80000, emergencyContact: "", notes: "",
  });

  const filteredSorted = useMemo(() => {
    const list = members ?? [];
    const todayStr = new Date().toISOString().split("T")[0];
    const future7 = new Date();
    future7.setDate(future7.getDate() + 7);
    const future7Str = future7.toISOString().split("T")[0];
    const q = search.trim();
    const qLower = q.toLowerCase();
    const qDigits = digitsOnly(q);

    const filtered = list.filter(m => {
      const matchSearch =
        !q ||
        m.name.toLowerCase().includes(qLower) ||
        (m.email ?? "").toLowerCase().includes(qLower) ||
        (qDigits.length > 0 && m.phone ? digitsOnly(m.phone).includes(qDigits) : false);
      const matchBelt = beltFilter === null || m.beltRank === beltFilter;
      const matchStatus = statusFilter === "all" || m.status === statusFilter;
      const matchMemo = !memoOnly || Boolean(m.notes?.trim());
      let matchPayment = true;
      if (paymentFilter !== "all") {
        const np = m.nextPaymentDate;
        if (paymentFilter === "overdue") {
          matchPayment = Boolean(np && np <= todayStr);
        } else if (paymentFilter === "dueSoon") {
          matchPayment = Boolean(np && np >= todayStr && np <= future7Str);
        }
      }
      return matchSearch && matchBelt && matchStatus && matchMemo && matchPayment;
    });

    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name, "ko");
        case "joinDate":
          return b.joinDate.localeCompare(a.joinDate);
        case "belt":
          return getBeltOrder(a.beltRank as BeltRank) - getBeltOrder(b.beltRank as BeltRank);
        case "fee":
          return b.monthlyFee - a.monthlyFee;
        case "nextPayment": {
          const na = a.nextPaymentDate ?? "9999-12-31";
          const nb = b.nextPaymentDate ?? "9999-12-31";
          return na.localeCompare(nb);
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [members, search, beltFilter, statusFilter, sortKey, paymentFilter, memoOnly]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    beltFilter !== null ||
    statusFilter !== "all" ||
    sortKey !== "name" ||
    paymentFilter !== "all" ||
    memoOnly;

  const resetFilters = () => {
    setSearch("");
    setBeltFilter(null);
    setStatusFilter("all");
    setSortKey("name");
    setPaymentFilter("all");
    setMemoOnly(false);
  };

  const handleCreate = () => {
    if (!form.name.trim()) { Alert.alert("오류", "이름을 입력하세요"); return; }
    createMutation.mutate({
      name: form.name.trim(),
      phone: form.phone || undefined,
      email: form.email || undefined,
      birthDate: form.birthDate || undefined,
      gender: form.gender,
      beltRank: form.beltRank,
      beltDegree: form.beltDegree,
      joinDate: form.joinDate,
      monthlyFee: form.monthlyFee,
      emergencyContact: form.emergencyContact || undefined,
      notes: form.notes || undefined,
    });
  };

  const handleNavigateToDetail = useCallback((id: number) => {
    router.push({ pathname: "/member-detail", params: { id } } as any);
  }, [router]);

  const handleExportMembersCsv = useCallback(async () => {
    if (filteredSorted.length === 0) {
      Alert.alert("알림", "보낼 회원이 없습니다.");
      return;
    }
    const header = "ID,이름,전화,이메일,띠등급,상태,월회비(원),입관일,다음납부일";
    const rows = filteredSorted.map((m) => {
      const belt = getBeltLabel(m.beltRank as BeltRank);
      const status = getMemberStatusLabel(m.status as MemberStatus);
      return [
        m.id,
        `"${String(m.name).replace(/"/g, '""')}"`,
        `"${String(m.phone ?? "").replace(/"/g, '""')}"`,
        `"${String(m.email ?? "").replace(/"/g, '""')}"`,
        `"${belt.replace(/"/g, '""')}"`,
        `"${status.replace(/"/g, '""')}"`,
        m.monthlyFee,
        `"${formatDate(m.joinDate)}"`,
        `"${m.nextPaymentDate ? formatDate(m.nextPaymentDate) : "-"}"`,
      ].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const stamp = new Date().toISOString().split("T")[0];
    const fileName = `회원목록_${stamp}.csv`;
    try {
      if (Platform.OS === "web") {
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        Alert.alert("완료", "CSV 파일이 다운로드되었습니다.");
        return;
      }
      const fileUri = (FileSystem.documentDirectory ?? "") + fileName;
      await FileSystem.writeAsStringAsync(fileUri, "\uFEFF" + csv, { encoding: FileSystem.EncodingType.UTF8 });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(fileUri, { mimeType: "text/csv", dialogTitle: "회원 목록 CSV" });
      } else {
        Alert.alert("완료", `저장됨: ${fileName}`);
      }
    } catch {
      Alert.alert("오류", "CSV보내기에 실패했습니다.");
    }
  }, [filteredSorted]);

  const renderItem = useCallback(({ item }: { item: NonNullable<typeof members>[0] }) => (
    <MemberRow
      item={item}
      tooltipMemberId={tooltipMemberId}
      onShowTooltip={showTooltip}
      onHideTooltip={hideTooltip}
      onPress={handleNavigateToDetail}
      onCheckIn={handleSwipeCheckIn}
      onDelete={handleSwipeDelete}
    />
  ), [tooltipMemberId, showTooltip, hideTooltip, handleNavigateToDetail, handleSwipeCheckIn, handleSwipeDelete]);

  if (!isManager) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-muted text-center">관리자만 접근할 수 있습니다</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between">
        <Text className="text-2xl font-bold text-foreground">회원 목록</Text>
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            className="px-3 py-2 rounded-full border border-border bg-surface"
            onPress={handleExportMembersCsv}
          >
            <Text className="text-foreground font-semibold text-xs">CSV</Text>
          </TouchableOpacity>
          <PillButton label="+ 추가" onPress={() => setShowAdd(true)} />
        </View>
      </View>

      {/* 띠 등급 필터 (상단) */}
      <View className="pb-2">
        <Text className="text-xs font-semibold text-muted px-5 mb-1.5">띠 등급</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 4 }}>
          <TouchableOpacity
            className="px-3 py-1.5 rounded-full border"
            style={{
              backgroundColor: beltFilter === null ? "#1565C0" : "transparent",
              borderColor: beltFilter === null ? "#1565C0" : "#E5E7EB",
            }}
            onPress={() => setBeltFilter(null)}
          >
            <Text className="text-xs font-semibold" style={{ color: beltFilter === null ? "#FFFFFF" : "#687076" }}>
              전체
            </Text>
          </TouchableOpacity>
          {BELT_RANKS.map(rank => (
            <TouchableOpacity
              key={rank}
              className="px-3 py-1.5 rounded-full border flex-row items-center gap-1.5"
              style={{
                backgroundColor: beltFilter === rank ? getBeltColor(rank) : "transparent",
                borderColor: getBeltColor(rank),
              }}
              onPress={() => setBeltFilter(beltFilter === rank ? null : rank)}
            >
              <View className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: beltFilter === rank ? "#FFFFFF" : getBeltColor(rank) }} />
              <Text className="text-xs font-semibold"
                style={{ color: beltFilter === rank ? "#FFFFFF" : getBeltColor(rank) }}>
                {getBeltLabel(rank)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 검색 */}
      <View className="px-5 pb-2 flex-row items-center gap-2">
        <TextInput
          className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
          placeholder="이름·전화(숫자)·이메일"
          placeholderTextColor="#9BA1A6"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearch("")}
            className="px-3 py-3 rounded-xl border border-border bg-surface"
            accessibilityLabel="검색어 지우기"
          >
            <Text className="text-muted text-sm font-semibold">✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text className="text-xs text-muted px-5 pb-2">
        {filteredSorted.length}명 표시
        {members && filteredSorted.length !== members.length ? ` · 전체 ${members.length}명 중` : ""}
      </Text>

      {/* 정렬 */}
      <View className="pb-2">
        <Text className="text-xs font-semibold text-muted px-5 mb-1.5">정렬</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 4 }}>
          {SORT_OPTIONS.map(o => (
            <TouchableOpacity
              key={o.key}
              className="px-3 py-1.5 rounded-full border"
              style={{
                backgroundColor: sortKey === o.key ? "#1565C0" : "transparent",
                borderColor: sortKey === o.key ? "#1565C0" : "#E5E7EB",
              }}
              onPress={() => setSortKey(o.key)}
            >
              <Text className="text-xs font-semibold" style={{ color: sortKey === o.key ? "#FFFFFF" : "#687076" }}>
                {o.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 납부일 필터 */}
      <View className="px-5 pb-2">
        <Text className="text-xs font-semibold text-muted mb-1.5">납부일</Text>
        <View className="flex-row flex-wrap gap-2">
          {([
            { key: "all" as const, label: "전체" },
            { key: "overdue" as const, label: "미납(기일 지남)" },
            { key: "dueSoon" as const, label: "7일 내 만료" },
          ]).map(p => (
            <TouchableOpacity
              key={p.key}
              className="px-3 py-1.5 rounded-full border"
              style={{
                backgroundColor: paymentFilter === p.key ? "#0F766E" : "transparent",
                borderColor: paymentFilter === p.key ? "#0F766E" : "#E5E7EB",
              }}
              onPress={() => setPaymentFilter(p.key)}
            >
              <Text className="text-xs font-medium" style={{ color: paymentFilter === p.key ? "#FFFFFF" : "#687076" }}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 메모 여부 */}
      <View className="px-5 pb-3 flex-row items-center justify-between">
        <Text className="text-xs font-semibold text-muted">관리자 메모가 있는 회원만</Text>
        <TouchableOpacity
          onPress={() => setMemoOnly(v => !v)}
          className="px-3 py-1.5 rounded-full border"
          style={{
            backgroundColor: memoOnly ? "#92400E" : "transparent",
            borderColor: memoOnly ? "#92400E" : "#E5E7EB",
          }}
        >
          <Text className="text-xs font-semibold" style={{ color: memoOnly ? "#FFFFFF" : "#687076" }}>
            {memoOnly ? "켜짐" : "꺼짐"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 상태 필터 */}
      <View className="px-5 pb-3 flex-row gap-2">
        {(["all", "active", "suspended", "withdrawn"] as const).map(s => (
          <TouchableOpacity
            key={s}
            className="px-3 py-1 rounded-full border"
            style={{
              backgroundColor: statusFilter === s ? "#1565C0" : "transparent",
              borderColor: statusFilter === s ? "#1565C0" : "#E5E7EB",
            }}
            onPress={() => setStatusFilter(s)}
          >
            <Text className="text-xs font-medium"
              style={{ color: statusFilter === s ? "#FFFFFF" : "#687076" }}>
              {s === "all" ? "전체" : s === "active" ? "활성" : s === "suspended" ? "휴회" : "탈퇴"}
            </Text>
          </TouchableOpacity>
        ))}
        {hasActiveFilters && (
          <TouchableOpacity
            className="px-3 py-1 rounded-full border"
            style={{ borderColor: "#EF4444" }}
            onPress={resetFilters}
          >
            <Text className="text-xs font-medium" style={{ color: "#EF4444" }}>전체 초기화</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 통계 */}
      <View className="px-5 pb-3 flex-row gap-3">
        {[
          { label: "전체", count: members?.length ?? 0, color: "#1565C0" },
          { label: "활성", count: members?.filter(m => m.status === "active").length ?? 0, color: "#2DA44E" },
          { label: "휴회", count: members?.filter(m => m.status === "suspended").length ?? 0, color: "#F4A261" },
        ].map(s => (
          <View key={s.label} className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
            <Text className="text-xl font-bold" style={{ color: s.color }}>{s.count}</Text>
            <Text className="text-xs text-muted mt-0.5">{s.label}</Text>
          </View>
        ))}
      </View>

      {/* 목록 */}
      {isLoading ? (
        <LoadingView label="회원 목록 불러오는 중..." />
      ) : (
        <FlatList
          data={filteredSorted}
          keyExtractor={memberKeyExtractor}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 10 }}
          {...listPerfProps}
          ListEmptyComponent={
            (members?.length ?? 0) === 0 ? (
              <EmptyState emoji="🥋" title="등록된 회원이 없습니다" subtitle="상단 + 버튼으로 회원을 추가해 주세요." />
            ) : (
              <EmptyState
                emoji="🔍"
                title="조건에 맞는 회원이 없습니다"
                subtitle="검색어나 필터를 비워 전체를 다시 보세요."
                action={
                  <TouchableOpacity
                    onPress={resetFilters}
                    className="px-4 py-2 rounded-full border border-border"
                  >
                    <Text className="text-sm font-semibold text-primary">필터 초기화</Text>
                  </TouchableOpacity>
                }
              />
            )
          }
          renderItem={renderItem}
        />
      )}

      {/* 회원 추가 모달 */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <Text className="text-xl font-bold text-foreground">회원 추가</Text>
            <TouchableOpacity onPress={() => { setShowAdd(false); resetForm(); }}>
              <Text className="text-primary font-semibold">취소</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
            <View className="py-4 gap-4">
              <FormField label="이름 *" value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="홍길동" />
              <FormField label="전화번호" value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} placeholder="010-0000-0000" keyboardType="phone-pad" />
              <FormField label="이메일" value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} placeholder="example@email.com" keyboardType="email-address" />
              <FormField label="생년월일" value={form.birthDate} onChangeText={v => setForm(f => ({ ...f, birthDate: v }))} placeholder="YYYY-MM-DD" />
              <FormField label="입관일 *" value={form.joinDate} onChangeText={v => setForm(f => ({ ...f, joinDate: v }))} placeholder="YYYY-MM-DD" />
              <FormField label="월 회비 (원)" value={String(form.monthlyFee)} onChangeText={v => setForm(f => ({ ...f, monthlyFee: parseInt(v) || 0 }))} keyboardType="numeric" />
              <FormField label="비상연락처" value={form.emergencyContact} onChangeText={v => setForm(f => ({ ...f, emergencyContact: v }))} placeholder="보호자 연락처" keyboardType="phone-pad" />

              {/* 띠 선택 */}
              <View>
                <Text className="text-sm font-medium text-foreground mb-2">띠 등급</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {BELT_RANKS.map(rank => (
                      <TouchableOpacity
                        key={rank}
                        className="px-3 py-2 rounded-xl border"
                        style={{
                          backgroundColor: form.beltRank === rank ? getBeltColor(rank) : "transparent",
                          borderColor: getBeltColor(rank),
                        }}
                        onPress={() => setForm(f => ({ ...f, beltRank: rank }))}
                      >
                        <Text className="text-xs font-medium"
                          style={{ color: form.beltRank === rank ? "#FFFFFF" : getBeltColor(rank) }}>
                          {getBeltLabel(rank)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <FormField label="메모" value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} placeholder="특이사항 등" multiline />
            </View>
          </ScrollView>
          <View className="px-5 pt-3 border-t border-border" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
            <TouchableOpacity
              style={{ backgroundColor: "#1565C0" }}
              className="rounded-2xl py-4 items-center"
              onPress={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text className="text-white font-bold text-base">회원 등록</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// ─── FormField 컴포넌트 ────────────────────────────────────────────────────────
function FormField({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any; multiline?: boolean;
}) {
  return (
    <View>
      <Text className="text-sm font-medium text-foreground mb-1">{label}</Text>
      <TextInput
        className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9BA1A6"
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        style={multiline ? { height: 80, textAlignVertical: "top" } : undefined}
        returnKeyType={multiline ? undefined : "done"}
      />
    </View>
  );
}

// ─── 메모 툴팁 컴포넌트 ────────────────────────────────────────────────────────
function MemoTooltip({ notes, onDismiss }: { notes: string; onDismiss: () => void }) {
  const preview = notes.length > 80 ? notes.slice(0, 80) + "…" : notes;
  return (
    <Pressable
      onPress={onDismiss}
      style={{
        position: "absolute",
        top: 22,
        left: 0,
        zIndex: 999,
        backgroundColor: "#1E293B",
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        minWidth: 180,
        maxWidth: 260,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 8,
      }}
    >
      {/* 위쪽 화살표 */}
      <View style={{
        position: "absolute",
        top: -6,
        left: 10,
        width: 0,
        height: 0,
        borderLeftWidth: 6,
        borderRightWidth: 6,
        borderBottomWidth: 6,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: "#1E293B",
      }} />
      <Text style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4, fontWeight: "600" }}>📝 관리자 메모</Text>
      <Text style={{ fontSize: 12, color: "#F1F5F9", lineHeight: 18 }}>{preview}</Text>
      <Text style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>탭하여 닫기</Text>
    </Pressable>
  );
}
