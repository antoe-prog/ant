import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, TouchableOpacity, View, Dimensions, RefreshControl, Modal, FlatList, AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import Svg, { Rect, Text as SvgText, Line, Circle, Polyline } from "react-native-svg";
import { useBackHandler, useTabBackHandler } from "@/hooks/use-back-handler";
import {
  formatAmount,
  formatDate,
  getBeltColor,
  getBeltLabel,
  getMemberStatusColor,
  getMemberStatusLabel,
} from "@/lib/judo-utils";

const SCREEN_W = Dimensions.get("window").width;

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const isManager = user?.role === "manager" || user?.role === "admin";

  if (!user) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-2xl font-bold text-foreground mb-2">유도관</Text>
        <Text className="text-muted text-center mb-6">유도 도장 회원 관리 앱</Text>
        <TouchableOpacity
          style={{ backgroundColor: "#1565C0" }}
          className="px-8 py-3 rounded-full"
          onPress={() => router.push("/login")}
        >
          <Text className="text-white font-semibold text-base">로그인</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  if (isManager) return <ManagerHome />;
  return <MemberHome />;
}

// ─── 핵심 KPI 위젯 행 ───────────────────────────────────────────────────────────
type DashboardStatsShape = {
  newMembersThisMonth?: number;
  pendingPromotionsCount?: number;
  todayAttendanceRate?: number;
  monthlyAttendanceCount?: number;
};

function DashboardKpiWidgetsRow({
  stats,
  router,
}: {
  stats: DashboardStatsShape | null | undefined;
  router: ReturnType<typeof useRouter>;
}) {
  const chips: {
    key: string;
    label: string;
    value: string;
    unit: string;
    hint: string;
    color: string;
    route: string;
  }[] = [
    {
      key: "new",
      label: "이번 달 신규 입관",
      value: String(stats?.newMembersThisMonth ?? 0),
      unit: "명",
      hint: "입관일 기준",
      color: "#0EA5E9",
      route: "/(tabs)/members",
    },
    {
      key: "exam",
      label: "30일 내 예정 심사",
      value: String(stats?.pendingPromotionsCount ?? 0),
      unit: "건",
      hint: "대기 건만",
      color: "#7C3AED",
      route: "/(tabs)/promotions",
    },
    {
      key: "rate",
      label: "오늘 출석 참여율",
      value: String(stats?.todayAttendanceRate ?? 0),
      unit: "%",
      hint: "활성 회원 대비",
      color: "#16A34A",
      route: "/(tabs)/attendance",
    },
    {
      key: "month",
      label: "이달 누적 출석",
      value: String(stats?.monthlyAttendanceCount ?? 0),
      unit: "회",
      hint: "이번 달 합산",
      color: "#2563EB",
      route: "/(tabs)/attendance",
    },
  ];

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ paddingHorizontal: 20, fontSize: 14, fontWeight: "700", color: "#0F172A", marginBottom: 10 }}>
        핵심 KPI
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 4 }}
      >
        {chips.map((c) => (
          <TouchableOpacity
            key={c.key}
            activeOpacity={0.75}
            onPress={() => router.push(c.route as never)}
            style={{
              width: 132,
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 14,
              borderWidth: 1,
              borderColor: c.color + "35",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.06,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <Text style={{ fontSize: 10, color: "#64748B", fontWeight: "600", marginBottom: 6 }}>{c.label}</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: c.color }}>{c.value}</Text>
              <Text style={{ fontSize: 12, color: "#94A3B8", fontWeight: "600" }}>{c.unit}</Text>
            </View>
            <Text style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>{c.hint}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── 관리자 홈 ────────────────────────────────────────────────────────────────
function ManagerHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshInterval, setRefreshInterval] = useState<number | null>(5); // 분 (수동=null)
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);

  useTabBackHandler();
  useBackHandler(() => {
    if (showIntervalPicker) {
      setShowIntervalPicker(false);
      return true;
    }
    if (showAlerts) {
      setShowAlerts(false);
      return true;
    }
    return false;
  });

  // 저장된 갱신 주기 불러오기
  useEffect(() => {
    AsyncStorage.getItem("manager_refresh_interval").then(val => {
      if (val !== null) setRefreshInterval(val === "null" ? null : Number(val));
    });
  }, []);

  const { data: stats, refetch: refetchStats } = trpc.dashboard.stats.useQuery();
  const { data: upcomingPromotions, refetch: refetchPromotions } = trpc.promotions.upcoming.useQuery({ days: 30 });
  const { data: monthlyStats, refetch: refetchMonthly } = trpc.dashboard.monthlyStats.useQuery();
  const { data: dailyAttendance, refetch: refetchDaily } = trpc.dashboard.dailyAttendance.useQuery();
  const { data: unpaidMembers } = trpc.payments.unpaid.useQuery();
  const { data: expiringSoon } = trpc.payments.expiringSoon.useQuery({ days: 7 });
  const seedMutation = trpc.dashboard.seed.useMutation({ onSuccess: () => refetchStats() });
  const { user } = useAuth();

  // 알림 항목 조합
  const alertItems = useMemo(() => {
    const items: { id: string; type: "unpaid" | "expiring" | "promotion"; title: string; desc: string; color: string; icon: string }[] = [];
    (unpaidMembers ?? []).forEach(m => {
      items.push({ id: `unpaid-${m.id}`, type: "unpaid", title: `미납: ${m.name}`, desc: `월 회비 ${formatAmount(m.monthlyFee)} 미납`, color: "#DC2626", icon: "💳" });
    });
    (expiringSoon ?? []).forEach(m => {
      const daysLeft = m.nextPaymentDate ? Math.ceil((new Date(m.nextPaymentDate).getTime() - Date.now()) / 86400000) : 0;
      items.push({ id: `expiring-${m.id}`, type: "expiring", title: `만료 임박: ${m.name}`, desc: `D-${daysLeft} · ${formatDate(m.nextPaymentDate ?? "")}`, color: "#D97706", icon: "⏰" });
    });
    (upcomingPromotions ?? []).filter(p => {
      const d = Math.ceil((new Date(p.examDate).getTime() - Date.now()) / 86400000);
      return d <= 7;
    }).forEach(p => {
      const daysLeft = Math.ceil((new Date(p.examDate).getTime() - Date.now()) / 86400000);
      const memberName = (p as any).memberName ?? `회원 #${p.memberId}`;
      items.push({ id: `promo-${p.id}`, type: "promotion", title: `심사 D-${daysLeft}: ${memberName}`, desc: `${getBeltLabel(p.currentBelt as any)} → ${getBeltLabel(p.targetBelt as any)} · ${formatDate(p.examDate)}`, color: "#7C3AED", icon: "🥋" });
    });
    return items;
  }, [unpaidMembers, expiringSoon, upcomingPromotions]);

  const alertCount = alertItems.length;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStats(), refetchPromotions(), refetchMonthly(), refetchDaily()]);
    setLastUpdated(new Date());
    setRefreshing(false);
  }, [refetchStats, refetchPromotions, refetchMonthly, refetchDaily]);

  // 선택된 주기로 자동 갱신
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (refreshInterval === null) return; // 수동 모드
    const ms = refreshInterval * 60 * 1000;
    autoRefreshRef.current = setInterval(async () => {
      await Promise.all([refetchStats(), refetchPromotions(), refetchMonthly(), refetchDaily()]);
      setLastUpdated(new Date());
    }, ms);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [refreshInterval, refetchStats, refetchPromotions, refetchMonthly, refetchDaily]);

  const handleSelectInterval = async (minutes: number | null) => {
    setRefreshInterval(minutes);
    await AsyncStorage.setItem("manager_refresh_interval", minutes === null ? "null" : String(minutes));
    setShowIntervalPicker(false);
  };

  // 백그라운드 → 포그라운드 복귀 시 즉시 갱신
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        await Promise.all([refetchStats(), refetchPromotions(), refetchMonthly(), refetchDaily()]);
        setLastUpdated(new Date());
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [refetchStats, refetchPromotions, refetchMonthly, refetchDaily]);

  const formatLastUpdated = (date: Date) => {
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "방금 전 업데이트";
    if (diffMin < 60) return `${diffMin}분 전 업데이트`;
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m} 업데이트`;
  };

  const now = new Date();
  const greeting = now.getHours() < 12 ? "좋은 아침이에요" : now.getHours() < 18 ? "안녕하세요" : "수고하셨어요";
  const workingDays = 22;
  const attendanceRate = stats && stats.activeMembers > 0
    ? Math.round((stats.monthlyAttendanceCount / (stats.activeMembers * workingDays)) * 100)
    : 0;

  const statCards = [
    { label: "전체 회원", value: stats?.totalMembers ?? 0, unit: "명", color: "#1565C0", bg: "#EFF6FF", icon: "👥" },
    { label: "활성 회원", value: stats?.activeMembers ?? 0, unit: "명", color: "#16A34A", bg: "#F0FDF4", icon: "✅" },
    { label: "오늘 출석", value: stats?.todayAttendance ?? 0, unit: "명", color: "#7C3AED", bg: "#F5F3FF", icon: "🥋" },
    { label: "미납 회원", value: stats?.unpaidCount ?? 0, unit: "명", color: (stats?.unpaidCount ?? 0) > 0 ? "#DC2626" : "#6B7280", bg: (stats?.unpaidCount ?? 0) > 0 ? "#FEF2F2" : "#F9FAFB", icon: "💳" },
  ];

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#1565C0"
            colors={["#1565C0"]}
          />
        }
      >
        {/* ── 헤더 ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: Math.max(insets.top, 20), paddingBottom: 16, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: "#6B7280", fontWeight: "500", marginBottom: 2 }}>
              {now.getFullYear()}년 {now.getMonth() + 1}월 {now.getDate()}일
            </Text>
            <Text style={{ fontSize: 24, fontWeight: "800", color: "#0F172A", letterSpacing: -0.5 }}>
              {greeting}, {user?.name ?? "관리자"}님 👋
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E" }} />
              <Text style={{ fontSize: 11, color: "#9CA3AF", fontWeight: "500" }}>
                {formatLastUpdated(lastUpdated)}
              </Text>
              <TouchableOpacity
                style={{
                  backgroundColor: "#F1F5F9", borderRadius: 8,
                  paddingHorizontal: 7, paddingVertical: 3,
                  borderWidth: 1, borderColor: "#E2E8F0",
                  flexDirection: "row", alignItems: "center", gap: 3,
                }}
                onPress={() => setShowIntervalPicker(true)}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 10 }}>⏱</Text>
                <Text style={{ fontSize: 10, color: "#64748B", fontWeight: "600" }}>
                  {refreshInterval === null ? "수동" : `${refreshInterval}분`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* 알림 벨 버튼 */}
          <TouchableOpacity
            style={{
              marginTop: 4,
              width: 44, height: 44, borderRadius: 14,
              backgroundColor: alertCount > 0 ? "#FEF2F2" : "#F8FAFC",
              borderWidth: 1, borderColor: alertCount > 0 ? "#FECACA" : "#E2E8F0",
              alignItems: "center", justifyContent: "center",
            }}
            onPress={() => setShowAlerts(true)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 20 }}>🔔</Text>
            {alertCount > 0 && (
              <View style={{
                position: "absolute", top: -4, right: -4,
                backgroundColor: "#DC2626", borderRadius: 8,
                minWidth: 18, height: 18,
                alignItems: "center", justifyContent: "center",
                paddingHorizontal: 4,
              }}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: "#FFFFFF" }}>
                  {alertCount > 99 ? "99+" : alertCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── 통계 카드 2×2 ── */}
        <View style={{ paddingHorizontal: 20, flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          {statCards.map((card) => (
            <View
              key={card.label}
              style={{
                width: (SCREEN_W - 52) / 2,
                backgroundColor: card.bg,
                borderRadius: 18,
                padding: 16,
                borderWidth: 1,
                borderColor: card.color + "20",
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <Text style={{ fontSize: 12, color: "#6B7280", fontWeight: "600" }}>{card.label}</Text>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: card.color + "18", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 16 }}>{card.icon}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                <Text style={{ fontSize: 32, fontWeight: "800", color: card.color, letterSpacing: -1 }}>
                  {card.value}
                </Text>
                <Text style={{ fontSize: 13, color: "#9CA3AF", fontWeight: "500" }}>{card.unit}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── 만료 임박 회원 카드 (7일 이내 납부일) ── */}
        {(expiringSoon ?? []).length > 0 && (
          <TouchableOpacity
            style={{
              marginHorizontal: 20,
              marginBottom: 16,
              backgroundColor: "#FFF7ED",
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: "#FDBA74",
            }}
            onPress={() => router.push("/(tabs)/payments" as any)}
            activeOpacity={0.75}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={{ fontSize: 14, fontWeight: "800", color: "#9A3412" }}>⏰ 만료 임박 회원</Text>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#EA580C" }}>
                {(expiringSoon ?? []).length}명 · 7일 이내
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              {(expiringSoon ?? []).slice(0, 4).map((m) => {
                const daysLeft = m.nextPaymentDate
                  ? Math.ceil((new Date(m.nextPaymentDate).getTime() - Date.now()) / 86400000)
                  : 0;
                return (
                  <View key={m.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: "#431407", flex: 1 }} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#C2410C" }}>
                      {daysLeft <= 0 ? "오늘" : `D-${daysLeft}`}
                    </Text>
                  </View>
                );
              })}
            </View>
            {(expiringSoon ?? []).length > 4 && (
              <Text style={{ fontSize: 11, color: "#9A3412", marginTop: 8, textAlign: "center" }}>
                외 {(expiringSoon ?? []).length - 4}명 · 납부 탭에서 전체 보기
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* ── 핵심 KPI 위젯 (가로 스크롤) ── */}
        <DashboardKpiWidgetsRow stats={stats} router={router} />

        {/* ── 매출 & 출석률 가로 배너 ── */}
        <View style={{ paddingHorizontal: 20, flexDirection: "row", gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: "#1565C0", borderRadius: 18, padding: 16 }}>
            <Text style={{ fontSize: 11, color: "#93C5FD", fontWeight: "600", marginBottom: 6 }}>💰 이달 매출</Text>
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5 }}>
              {formatAmount(stats?.monthlyRevenue ?? 0)}
            </Text>
          </View>
          <View style={{
            flex: 1,
            backgroundColor: attendanceRate >= 70 ? "#16A34A" : attendanceRate >= 40 ? "#D97706" : "#DC2626",
            borderRadius: 18, padding: 16,
          }}>
            <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: "600", marginBottom: 6 }}>📊 이달 출석률</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}>
              <Text style={{ fontSize: 20, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5 }}>{attendanceRate}</Text>
              <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: "600" }}>%</Text>
            </View>
            <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
              {stats?.monthlyAttendanceCount ?? 0}회 출석
            </Text>
          </View>
        </View>

        {/* ── 납부 주의 배너 ── */}
        {((stats?.expiringSoonCount ?? 0) > 0 || (stats?.unpaidCount ?? 0) > 0) && (
          <TouchableOpacity
            style={{
              marginHorizontal: 20, marginBottom: 16,
              backgroundColor: "#FFFBEB",
              borderRadius: 16, padding: 14,
              borderWidth: 1, borderColor: "#FDE68A",
              flexDirection: "row", alignItems: "center", gap: 12,
            }}
            onPress={() => router.push("/(tabs)/payments" as any)}
            activeOpacity={0.75}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 20 }}>⚠️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#92400E", marginBottom: 2 }}>납부 주의 필요</Text>
              <Text style={{ fontSize: 11, color: "#B45309" }}>
                {[
                  (stats?.unpaidCount ?? 0) > 0 ? `미납 ${stats?.unpaidCount}명` : "",
                  (stats?.expiringSoonCount ?? 0) > 0 ? `7일 내 만료 ${stats?.expiringSoonCount}명` : "",
                ].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Text style={{ color: "#F59E0B", fontSize: 18, fontWeight: "600" }}>›</Text>
          </TouchableOpacity>
        )}

        {/* ── 일별 출석 추이 ── */}
        {dailyAttendance && dailyAttendance.length > 0 && (
          <DailyAttendanceLineChart data={dailyAttendance} />
        )}

        {/* ── 월별 통계 차트 ── */}
        {monthlyStats && monthlyStats.length > 0 && (
          <MonthlyStatsChart data={monthlyStats} />
        )}

        {/* ── 예정 심사 일정 ── */}
        {(upcomingPromotions ?? []).length > 0 && (
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A" }}>🥋 예정 심사 일정</Text>
              <TouchableOpacity onPress={() => router.push("/(tabs)/promotions" as any)}>
                <Text style={{ fontSize: 12, color: "#1565C0", fontWeight: "600" }}>전체 보기 →</Text>
              </TouchableOpacity>
            </View>
            <View style={{ gap: 8 }}>
              {(upcomingPromotions ?? []).slice(0, 3).map(p => {
                const memberName = (p as any).memberName ?? `회원 #${p.memberId}`;
                const daysLeft = Math.ceil((new Date(p.examDate).getTime() - Date.now()) / 86400000);
                const isUrgent = daysLeft <= 3;
                return (
                  <View key={p.id} style={{
                    backgroundColor: isUrgent ? "#FEF2F2" : "#FAFAFA",
                    borderRadius: 14, padding: 14,
                    borderWidth: 1, borderColor: isUrgent ? "#FECACA" : "#E5E7EB",
                    flexDirection: "row", alignItems: "center",
                  }}>
                    <View style={{
                      width: 42, height: 42, borderRadius: 13,
                      backgroundColor: getBeltColor(p.currentBelt as any) + "25",
                      alignItems: "center", justifyContent: "center", marginRight: 12,
                    }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: getBeltColor(p.currentBelt as any) }}>
                        {memberName.slice(0, 2)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A", marginBottom: 2 }}>{memberName}</Text>
                      <Text style={{ fontSize: 11, color: "#6B7280" }}>
                        {getBeltLabel(p.currentBelt as any)} → {getBeltLabel(p.targetBelt as any)}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <View style={{
                        backgroundColor: isUrgent ? "#DC2626" : "#F59E0B",
                        borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 3,
                      }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>
                          {daysLeft === 0 ? "D-Day" : daysLeft < 0 ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 10, color: "#9CA3AF" }}>{formatDate(p.examDate)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── 빠른 메뉴 ── */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 12 }}>빠른 메뉴</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {[
              { label: "출석 체크", icon: "✅", color: "#16A34A", route: "/(tabs)/attendance" as any },
              { label: "회원 목록", icon: "👥", color: "#1565C0", route: "/(tabs)/members" as any },
              { label: "납부 관리", icon: "💳", color: "#7C3AED", route: "/(tabs)/payments" as any },
              { label: "심사 관리", icon: "🥋", color: "#D97706", route: "/(tabs)/promotions" as any },
            ].map((item) => (
              <TouchableOpacity
                key={item.label}
                style={{
                  flex: 1,
                  backgroundColor: item.color + "10",
                  borderRadius: 16, paddingVertical: 14,
                  alignItems: "center",
                  borderWidth: 1, borderColor: item.color + "25",
                }}
                onPress={() => router.push(item.route)}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 24, marginBottom: 6 }}>{item.icon}</Text>
                <Text style={{ fontSize: 11, fontWeight: "600", color: item.color, textAlign: "center" }}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 데모 데이터 */}
        {stats?.totalMembers === 0 && (
          <View style={{ marginHorizontal: 20 }}>
            <TouchableOpacity
              style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, padding: 14, alignItems: "center" }}
              onPress={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#64748B" }}>
                {seedMutation.isPending ? "데모 데이터 생성 중..." : "🎯 데모 데이터 불러오기"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* ── 갱신 주기 선택 모달 ── */}
      <RefreshIntervalModal
        visible={showIntervalPicker}
        current={refreshInterval}
        onSelect={handleSelectInterval}
        onClose={() => setShowIntervalPicker(false)}
        topInset={insets.top}
      />

      {/* ── 알림 센터 모달 ── */}
      <AlertCenterModal
        visible={showAlerts}
        onClose={() => setShowAlerts(false)}
        items={alertItems}
        router={router}
        topInset={insets.top}
      />
    </ScreenContainer>
  );
}

// ─── 갱신 주기 선택 모달 ────────────────────────────────────────────────────────
const INTERVAL_OPTIONS: { label: string; value: number | null; desc: string; icon: string }[] = [
  { label: "1분", value: 1, desc: "매 1분마다 자동 갱신", icon: "⚡" },
  { label: "5분", value: 5, desc: "매 5분마다 자동 갱신 (기본)", icon: "🔄" },
  { label: "10분", value: 10, desc: "매 10분마다 자동 갱신", icon: "🕐" },
  { label: "수동", value: null, desc: "당겨서 새로고침으로만 갱신", icon: "✋" },
];

function RefreshIntervalModal({ visible, current, onSelect, onClose, topInset }: {
  visible: boolean;
  current: number | null;
  onSelect: (minutes: number | null) => void;
  onClose: () => void;
  topInset?: number;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
        {/* 헤더 */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: Math.max(topInset ?? 0, 20), paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" }}>
          <View>
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#0F172A" }}>⏱ 자동 갱신 주기</Text>
            <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>데이터를 자동으로 새로고침하는 주기를 선택하세요</Text>
          </View>
          <TouchableOpacity
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}
            onPress={onClose}
          >
            <Text style={{ fontSize: 16, color: "#6B7280", fontWeight: "700" }}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={{ padding: 16, gap: 10 }}>
          {INTERVAL_OPTIONS.map((opt) => {
            const isSelected = opt.value === current;
            return (
              <TouchableOpacity
                key={String(opt.value)}
                style={{
                  backgroundColor: isSelected ? "#EFF6FF" : "#FAFAFA",
                  borderRadius: 16, padding: 18,
                  borderWidth: isSelected ? 2 : 1,
                  borderColor: isSelected ? "#1565C0" : "#E5E7EB",
                  flexDirection: "row", alignItems: "center", gap: 14,
                }}
                onPress={() => onSelect(opt.value)}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: isSelected ? "#1565C020" : "#F1F5F9",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontSize: 24 }}>{opt.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: isSelected ? "#1565C0" : "#0F172A", marginBottom: 3 }}>
                    {opt.label}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#6B7280" }}>{opt.desc}</Text>
                </View>
                {isSelected && (
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#1565C0", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 13, color: "#FFFFFF", fontWeight: "800" }}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ marginHorizontal: 16, marginTop: 8, backgroundColor: "#FFFBEB", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#FDE68A" }}>
          <Text style={{ fontSize: 12, color: "#92400E", lineHeight: 18 }}>
            💡 포그라운드 복귀 시에는 설정과 관계없이 항상 즉시 갱신됩니다.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// ─── 알림 센터 모달 ────────────────────────────────────────────────────────────
type AlertItem = { id: string; type: "unpaid" | "expiring" | "promotion"; title: string; desc: string; color: string; icon: string };

function AlertCenterModal({ visible, onClose, items, router, topInset }: {
  visible: boolean;
  onClose: () => void;
  items: AlertItem[];
  router: ReturnType<typeof useRouter>;
  topInset?: number;
}) {
  const typeLabel: Record<AlertItem["type"], string> = {
    unpaid: "미납",
    expiring: "만료 임박",
    promotion: "심사 D-7",
  };

  const handleItemPress = (item: AlertItem) => {
    onClose();
    if (item.type === "unpaid" || item.type === "expiring") {
      router.push("/(tabs)/payments" as any);
    } else {
      router.push("/(tabs)/promotions" as any);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
        {/* 헤더 */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: Math.max(topInset ?? 0, 20), paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" }}>
          <View>
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#0F172A" }}>🔔 알림 센터</Text>
            <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
              {items.length > 0 ? `${items.length}개의 처리 필요 항목` : "모든 항목이 정상입니다"}
            </Text>
          </View>
          <TouchableOpacity
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}
            onPress={onClose}
          >
            <Text style={{ fontSize: 16, color: "#6B7280", fontWeight: "700" }}>✕</Text>
          </TouchableOpacity>
        </View>

        {items.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <Text style={{ fontSize: 48 }}>✅</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A" }}>모두 정상입니다</Text>
            <Text style={{ fontSize: 13, color: "#6B7280", textAlign: "center" }}>미납, 만료 임박, 긴급 심사 일정이{"\n"}없습니다.</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={{
                  backgroundColor: item.color + "08",
                  borderRadius: 16, padding: 16,
                  borderWidth: 1, borderColor: item.color + "25",
                  flexDirection: "row", alignItems: "center", gap: 14,
                }}
                onPress={() => handleItemPress(item)}
                activeOpacity={0.7}
              >
                <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: item.color + "18", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 22 }}>{item.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <View style={{ backgroundColor: item.color + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: item.color }}>{typeLabel[item.type]}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A", marginBottom: 2 }}>{item.title}</Text>
                  <Text style={{ fontSize: 12, color: "#6B7280" }}>{item.desc}</Text>
                </View>
                <Text style={{ fontSize: 16, color: item.color + "80", fontWeight: "600" }}>›</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

// ─── 회원 홈 ──────────────────────────────────────────────────────────────────
function MemberHome() {
  useTabBackHandler();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { data: myProfile } = trpc.members.myProfile.useQuery();
  const now = new Date();
  const { data: myAttendance } = trpc.members.myAttendanceByMonth.useQuery({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const { data: allAttendance } = trpc.members.myAttendanceAll.useQuery();
  const { data: myPromotions } = trpc.members.myPromotions.useQuery();
  const router = useRouter();

  const attendanceCount = myAttendance?.length ?? 0;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayDay = now.getDate();
  const attendanceRate = Math.round((attendanceCount / todayDay) * 100);

  // 연속 출석 스트릭 계산
  const streak = useMemo(() => {
    if (!allAttendance || allAttendance.length === 0) return 0;
    const dateSet = new Set(
      allAttendance.map(a => String(a.attendanceDate).slice(0, 10))
    );
    let count = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 오늘 출석했으면 오늘부터, 아니면 어제부터 역산
    const todayStr = today.toISOString().slice(0, 10);
    const startDay = dateSet.has(todayStr) ? today : (() => {
      const d = new Date(today); d.setDate(d.getDate() - 1); return d;
    })();
    const startStr = startDay.toISOString().slice(0, 10);
    if (!dateSet.has(startStr)) return 0;
    let cur = new Date(startDay);
    while (true) {
      const s = cur.toISOString().slice(0, 10);
      if (!dateSet.has(s)) break;
      count++;
      cur.setDate(cur.getDate() - 1);
    }
    return count;
  }, [allAttendance]);

  const upcomingPromotion = myPromotions
    ?.filter(p => p.result === "pending")
    .sort((a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime())[0];
  const promotionDday = upcomingPromotion ? (() => {
    const [y, m, d] = String(upcomingPromotion.examDate).split("-").map(Number);
    const target = new Date(y, m - 1, d);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  })() : null;

  const greeting = now.getHours() < 12 ? "좋은 아침이에요" : now.getHours() < 18 ? "안녕하세요" : "수고하셨어요";

  const daysToExpiry = myProfile?.nextPaymentDate
    ? Math.ceil((new Date(myProfile.nextPaymentDate).getTime() - now.getTime()) / 86400000)
    : null;
  const isExpiryWarning = daysToExpiry !== null && daysToExpiry <= 7;

  // 스트릭 메시지
  const streakMsg = streak >= 30 ? "🏆 한 달 개근!" : streak >= 14 ? "🔥 2주 연속!" : streak >= 7 ? "💪 일주일 연속!" : streak >= 3 ? `🔥 ${streak}일 연속 출석 중!` : streak > 0 ? `${streak}일 연속 출석 중` : null;
  const streakColor = streak >= 14 ? "#DC2626" : streak >= 7 ? "#D97706" : "#16A34A";

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>

        {/* ── 헤더 ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: Math.max(insets.top, 20), paddingBottom: 20 }}>
          <Text style={{ fontSize: 13, color: "#6B7280", fontWeight: "500", marginBottom: 2 }}>
            {now.getMonth() + 1}월 {now.getDate()}일 · {["일", "월", "화", "수", "목", "금", "토"][now.getDay()]}요일
          </Text>
          <Text style={{ fontSize: 24, fontWeight: "800", color: "#0F172A", letterSpacing: -0.5 }}>
            {greeting},{"\n"}{user?.name ?? "회원"}님 👋
          </Text>
        </View>

        {/* ── 프로필 카드 ── */}
        {myProfile ? (
          <View style={{ marginHorizontal: 20, marginBottom: 16 }}>
            <View style={{
              borderRadius: 22,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: getBeltColor(myProfile.beltRank) + "30",
            }}>
              <View style={{ backgroundColor: getBeltColor(myProfile.beltRank), paddingHorizontal: 20, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 22, fontWeight: "800", color: "#FFFFFF" }}>
                    {myProfile.name.slice(0, 1)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: "#FFFFFF", marginBottom: 2 }}>{myProfile.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 12, color: "#FFFFFF", fontWeight: "700" }}>
                        {getBeltLabel(myProfile.beltRank)} {myProfile.beltDegree}단
                      </Text>
                    </View>
                    <View style={{ backgroundColor: getMemberStatusColor(myProfile.status) + "40", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, color: "#FFFFFF", fontWeight: "600" }}>
                        {getMemberStatusLabel(myProfile.status)}
                      </Text>
                    </View>
                  </View>
                </View>
                {/* 스트릭 배지 (프로필 카드 우측) */}
                {streakMsg && (
                  <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center" }}>
                    <Text style={{ fontSize: 18 }}>{streak >= 14 ? "🔥" : streak >= 7 ? "💪" : "✨"}</Text>
                    <Text style={{ fontSize: 10, color: "#FFFFFF", fontWeight: "700", marginTop: 2 }}>{streak}일</Text>
                  </View>
                )}
              </View>
              <View style={{ backgroundColor: "#FFFFFF", paddingHorizontal: 20, paddingVertical: 14, gap: 10 }}>
                {[
                  { label: "입관일", value: formatDate(myProfile.joinDate) },
                  { label: "월 회비", value: formatAmount(myProfile.monthlyFee) },
                  ...(myProfile.nextPaymentDate ? [{ label: "다음 납부일", value: formatDate(myProfile.nextPaymentDate), warn: isExpiryWarning }] : []),
                ].map((row: any) => (
                  <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 13, color: "#6B7280" }}>{row.label}</Text>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: row.warn ? "#DC2626" : "#0F172A" }}>
                      {row.value}{row.warn ? ` (D-${daysToExpiry})` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : (
          <View style={{ marginHorizontal: 20, marginBottom: 16, backgroundColor: "#F8FAFC", borderRadius: 18, padding: 20, borderWidth: 1, borderColor: "#E2E8F0", alignItems: "center" }}>
            <Text style={{ fontSize: 14, color: "#6B7280" }}>회원 정보가 없습니다.</Text>
            <Text style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>관리자에게 문의하세요.</Text>
          </View>
        )}

        {/* ── 연속 출석 스트릭 배너 ── */}
        {streakMsg && (
          <View style={{
            marginHorizontal: 20, marginBottom: 16,
            backgroundColor: streakColor + "10",
            borderRadius: 16, padding: 14,
            borderWidth: 1, borderColor: streakColor + "30",
            flexDirection: "row", alignItems: "center", gap: 14,
          }}>
            <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: streakColor + "20", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 24 }}>{streak >= 14 ? "🔥" : streak >= 7 ? "💪" : "✨"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: streakColor, marginBottom: 2 }}>{streakMsg}</Text>
              <Text style={{ fontSize: 12, color: "#6B7280" }}>
                {streak >= 30 ? "대단해요! 한 달 내내 빠짐없이 수련했어요." :
                  streak >= 14 ? "꾸준한 수련이 실력을 만들어요." :
                  streak >= 7 ? "일주일 연속! 이 기세를 유지해요." :
                  "연속 출석 중이에요. 계속 도전하세요!"}
              </Text>
            </View>
          </View>
        )}

        {/* ── 이번 달 출석 현황 ── */}
        <View style={{ marginHorizontal: 20, marginBottom: 16 }}>
          <View style={{
            backgroundColor: "#F0FDF4",
            borderRadius: 18, padding: 18,
            borderWidth: 1, borderColor: "#BBF7D0",
          }}>
            <Text style={{ fontSize: 12, color: "#16A34A", fontWeight: "700", marginBottom: 12 }}>🥋 이번 달 출석 현황</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                  <Text style={{ fontSize: 40, fontWeight: "800", color: "#15803D", letterSpacing: -1 }}>{attendanceCount}</Text>
                  <Text style={{ fontSize: 15, color: "#4ADE80", fontWeight: "600" }}>일</Text>
                </View>
                <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                  {todayDay}일 기준 · 이번 달 {daysInMonth}일
                </Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <View style={{
                  width: 64, height: 64, borderRadius: 32,
                  backgroundColor: attendanceRate >= 70 ? "#15803D" : attendanceRate >= 40 ? "#D97706" : "#DC2626",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: "#FFFFFF" }}>{attendanceRate}%</Text>
                </View>
                <Text style={{ fontSize: 10, color: "#6B7280", marginTop: 4 }}>출석률</Text>
              </View>
            </View>
            <View style={{ marginTop: 14, height: 6, backgroundColor: "#DCFCE7", borderRadius: 3, overflow: "hidden" }}>
              <View style={{ width: `${Math.min(attendanceRate, 100)}%`, height: "100%", backgroundColor: "#22C55E", borderRadius: 3 }} />
            </View>
          </View>
        </View>

        {/* ── 승급심사 D-day 배너 ── */}
        {upcomingPromotion && promotionDday !== null && (
          <View style={{
            marginHorizontal: 20, marginBottom: 16,
            backgroundColor: promotionDday <= 3 ? "#FEF2F2" : "#F5F3FF",
            borderRadius: 18, padding: 16,
            borderWidth: 1, borderColor: promotionDday <= 3 ? "#FECACA" : "#DDD6FE",
            flexDirection: "row", alignItems: "center", gap: 14,
          }}>
            <View style={{
              width: 48, height: 48, borderRadius: 14,
              backgroundColor: promotionDday <= 3 ? "#FEE2E2" : "#EDE9FE",
              alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontSize: 24 }}>{promotionDday <= 3 ? "🔥" : "🏅"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "800", color: promotionDday <= 3 ? "#991B1B" : "#5B21B6", marginBottom: 3 }}>
                승급심사 {promotionDday === 0 ? "D-Day!" : promotionDday < 0 ? `D+${Math.abs(promotionDday)}` : `D-${promotionDday}`}
              </Text>
              <Text style={{ fontSize: 12, color: promotionDday <= 3 ? "#B91C1C" : "#7C3AED" }}>
                {getBeltLabel(upcomingPromotion.currentBelt)} → {getBeltLabel(upcomingPromotion.targetBelt)} · {formatDate(String(upcomingPromotion.examDate))}
              </Text>
            </View>
          </View>
        )}

        {/* ── 나의 도장 정보 메뉴 ── */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 12 }}>나의 도장 정보</Text>
          <View style={{ gap: 10 }}>
            {[
              { icon: "🏅", title: "승급심사", desc: "심사 예정 및 결과 확인", color: "#7C3AED", href: "/my-promotions" },
              { icon: "📅", title: "등록기간", desc: "납부 이력 및 만료일 확인", color: "#1565C0", href: "/my-registration" },
              { icon: "📆", title: "출석달력", desc: "월별 출석 현황 달력 보기", color: "#16A34A", href: "/my-attendance-calendar" },
            ].map((item) => (
              <TouchableOpacity
                key={item.title}
                style={{
                  backgroundColor: "#FAFAFA",
                  borderRadius: 16, padding: 16,
                  borderWidth: 1, borderColor: "#F1F5F9",
                  flexDirection: "row", alignItems: "center", gap: 14,
                }}
                onPress={() => router.push(item.href as never)}
                activeOpacity={0.7}
              >
                <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: item.color + "15", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 22 }}>{item.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: "#0F172A", marginBottom: 2 }}>{item.title}</Text>
                  <Text style={{ fontSize: 12, color: "#6B7280" }}>{item.desc}</Text>
                </View>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: item.color + "12", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 14, color: item.color, fontWeight: "700" }}>›</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── 공지사항 ── */}
        <AnnouncementPreview />
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── 공지사항 미리보기 ─────────────────────────────────────────────────────────
function AnnouncementPreview() {
  const { data: announcements } = trpc.announcements.list.useQuery();
  const pinned = announcements?.filter((a) => (a as { isPinnedEffective?: boolean }).isPinnedEffective) ?? [];
  const recent = announcements?.slice(0, 3) ?? [];
  const items = pinned.length > 0 ? pinned : recent;

  if (items.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 12 }}>📢 공지사항</Text>
      <View style={{ gap: 8 }}>
        {items.map((a) => (
          <View key={a.id} style={{ backgroundColor: "#FAFAFA", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#F1F5F9" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              {(a as { isPinnedEffective?: boolean }).isPinnedEffective ? (
                <View style={{ backgroundColor: "#EFF6FF", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 10, color: "#1565C0", fontWeight: "700" }}>공지</Text>
                </View>
              ) : null}
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A", flex: 1 }} numberOfLines={1}>
                {a.title}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: "#6B7280", lineHeight: 18 }} numberOfLines={2}>
              {a.content}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── 월별 통계 차트 ────────────────────────────────────────────────────────────
type MonthlyStatItem = { year: number; month: number; revenue: number; attendance: number; attendanceRate: number };

function MonthlyStatsChart({ data }: { data: MonthlyStatItem[] }) {
  const CHART_W = SCREEN_W - 80;
  const CHART_H = 110;
  const BAR_GAP = 8;
  const LABEL_H = 20;
  const barCount = data.length;
  const barW = Math.floor((CHART_W - BAR_GAP * (barCount - 1)) / barCount);
  const maxRevenue = Math.max(...data.map(d => d.revenue), 1);
  const maxAttendance = Math.max(...data.map(d => d.attendance), 1);
  const maxRate = Math.max(...data.map(d => d.attendanceRate), 1);
  const MONTH_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

  return (
    <View style={{ marginHorizontal: 20, marginBottom: 16, backgroundColor: "#FAFAFA", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#F1F5F9" }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A", marginBottom: 16 }}>📊 최근 6개월 통계</Text>

      <Text style={{ fontSize: 11, color: "#6B7280", fontWeight: "600", marginBottom: 8 }}>💰 월별 매출</Text>
      <Svg width={CHART_W} height={CHART_H + LABEL_H}>
        <Line x1={0} y1={CHART_H} x2={CHART_W} y2={CHART_H} stroke="#E5E7EB" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = Math.max(4, Math.round((d.revenue / maxRevenue) * (CHART_H - 20)));
          const x = i * (barW + BAR_GAP);
          const y = CHART_H - barH;
          const isCurrentMonth = i === data.length - 1;
          return (
            <Svg key={i}>
              <Rect x={x} y={y} width={barW} height={barH} rx={6}
                fill={isCurrentMonth ? "#1565C0" : "#BFDBFE"} />
              {isCurrentMonth && d.revenue > 0 && (
                <SvgText x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={9} fill="#1565C0" fontWeight="bold">
                  {d.revenue >= 10000 ? `${Math.round(d.revenue / 10000)}만` : String(d.revenue)}
                </SvgText>
              )}
              <SvgText x={x + barW / 2} y={CHART_H + 14} textAnchor="middle" fontSize={10}
                fill={isCurrentMonth ? "#1565C0" : "#9CA3AF"} fontWeight={isCurrentMonth ? "bold" : "normal"}>
                {MONTH_LABELS[d.month - 1]}
              </SvgText>
            </Svg>
          );
        })}
      </Svg>

      <View style={{ height: 1, backgroundColor: "#F1F5F9", marginVertical: 14 }} />

      <Text style={{ fontSize: 11, color: "#6B7280", fontWeight: "600", marginBottom: 8 }}>📈 월별 출석률 (추정 %)</Text>
      <Text style={{ fontSize: 10, color: "#94A3B8", marginBottom: 8 }}>
        활성 회원 수 × 월 22일 기준 (대시보드 이달 출석률과 동일 계산)
      </Text>
      <Svg width={CHART_W} height={CHART_H + LABEL_H}>
        <Line x1={0} y1={CHART_H} x2={CHART_W} y2={CHART_H} stroke="#E5E7EB" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = Math.max(4, Math.round((d.attendanceRate / maxRate) * (CHART_H - 20)));
          const x = i * (barW + BAR_GAP);
          const y = CHART_H - barH;
          const isCurrentMonth = i === data.length - 1;
          return (
            <Svg key={`rate-${i}`}>
              <Rect x={x} y={y} width={barW} height={barH} rx={6}
                fill={isCurrentMonth ? "#D97706" : "#FCD34D"} />
              {isCurrentMonth && (
                <SvgText x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={9} fill="#B45309" fontWeight="bold">
                  {d.attendanceRate}%
                </SvgText>
              )}
              <SvgText x={x + barW / 2} y={CHART_H + 14} textAnchor="middle" fontSize={10}
                fill={isCurrentMonth ? "#B45309" : "#9CA3AF"} fontWeight={isCurrentMonth ? "bold" : "normal"}>
                {MONTH_LABELS[d.month - 1]}
              </SvgText>
            </Svg>
          );
        })}
      </Svg>

      <View style={{ height: 1, backgroundColor: "#F1F5F9", marginVertical: 14 }} />

      <Text style={{ fontSize: 11, color: "#6B7280", fontWeight: "600", marginBottom: 8 }}>🥋 월별 출석 횟수</Text>
      <Svg width={CHART_W} height={CHART_H + LABEL_H}>
        <Line x1={0} y1={CHART_H} x2={CHART_W} y2={CHART_H} stroke="#E5E7EB" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = Math.max(4, Math.round((d.attendance / maxAttendance) * (CHART_H - 20)));
          const x = i * (barW + BAR_GAP);
          const y = CHART_H - barH;
          const isCurrentMonth = i === data.length - 1;
          return (
            <Svg key={i}>
              <Rect x={x} y={y} width={barW} height={barH} rx={6}
                fill={isCurrentMonth ? "#16A34A" : "#BBF7D0"} />
              {isCurrentMonth && d.attendance > 0 && (
                <SvgText x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={9} fill="#16A34A" fontWeight="bold">
                  {d.attendance}
                </SvgText>
              )}
              <SvgText x={x + barW / 2} y={CHART_H + 14} textAnchor="middle" fontSize={10}
                fill={isCurrentMonth ? "#16A34A" : "#9CA3AF"} fontWeight={isCurrentMonth ? "bold" : "normal"}>
                {MONTH_LABELS[d.month - 1]}
              </SvgText>
            </Svg>
          );
        })}
      </Svg>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#1565C0" }} />
          <Text style={{ fontSize: 11, color: "#6B7280" }}>매출·이번 달</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#BFDBFE" }} />
          <Text style={{ fontSize: 11, color: "#6B7280" }}>매출·이전 달</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#D97706" }} />
          <Text style={{ fontSize: 11, color: "#6B7280" }}>출석률·이번 달</Text>
        </View>
      </View>
    </View>
  );
}

// ─── 일별 출석 추이 꺾은선 그래프 ─────────────────────────────────────────────
function DailyAttendanceLineChart({ data }: { data: { day: number; count: number }[] }) {
  const CHART_W = SCREEN_W - 80;
  const CHART_H = 100;
  const LABEL_H = 20;
  const PADDING = 14;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();

  const countMap: Record<number, number> = {};
  for (const d of data) countMap[d.day] = d.count;
  const maxCount = Math.max(...data.map(d => d.count), 1);

  const points: { x: number; y: number; day: number; count: number }[] = [];
  for (let d = 1; d <= today; d++) {
    const count = countMap[d] ?? 0;
    const x = PADDING + ((d - 1) / Math.max(daysInMonth - 1, 1)) * (CHART_W - PADDING * 2);
    const y = CHART_H - PADDING - (count / maxCount) * (CHART_H - PADDING * 2);
    points.push({ x, y, day: d, count });
  }

  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(" ");
  const todayPoint = points[points.length - 1];
  const xLabels = [1, 10, 20, today].filter((v, i, arr) => arr.indexOf(v) === i && v <= today);
  const totalAttendance = data.reduce((s, d) => s + d.count, 0);

  return (
    <View style={{ marginHorizontal: 20, marginBottom: 16, backgroundColor: "#EFF6FF", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#BFDBFE" }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#1E3A5F" }}>📈 이번 달 일별 출석</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#1565C0" }}>{totalAttendance}</Text>
            <Text style={{ fontSize: 9, color: "#6B7280" }}>총 출석</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#1565C0" }}>{todayPoint?.count ?? 0}</Text>
            <Text style={{ fontSize: 9, color: "#6B7280" }}>오늘</Text>
          </View>
        </View>
      </View>
      <Svg width={CHART_W} height={CHART_H + LABEL_H}>
        {[0.25, 0.5, 0.75].map((ratio, i) => {
          const y = CHART_H - PADDING - ratio * (CHART_H - PADDING * 2);
          return <Line key={i} x1={PADDING} y1={y} x2={CHART_W - PADDING} y2={y} stroke="#DBEAFE" strokeWidth={1} />;
        })}
        <Line x1={PADDING} y1={CHART_H - PADDING} x2={CHART_W - PADDING} y2={CHART_H - PADDING} stroke="#BFDBFE" strokeWidth={1} />
        {points.length >= 2 && (
          <Polyline points={polylinePoints} fill="none" stroke="#1565C0" strokeWidth={2.5}
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {points.filter(p => p.count > 0).map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill="#1565C0" />
        ))}
        {todayPoint && todayPoint.count > 0 && (
          <>
            <Circle cx={todayPoint.x} cy={todayPoint.y} r={8} fill="#1565C030" />
            <Circle cx={todayPoint.x} cy={todayPoint.y} r={5} fill="#1565C0" />
            <SvgText x={todayPoint.x} y={todayPoint.y - 12} textAnchor="middle" fontSize={10} fill="#1565C0" fontWeight="bold">
              {todayPoint.count}명
            </SvgText>
          </>
        )}
        {xLabels.map((d) => {
          const x = PADDING + ((d - 1) / Math.max(daysInMonth - 1, 1)) * (CHART_W - PADDING * 2);
          return (
            <SvgText key={d} x={x} y={CHART_H + 14} textAnchor="middle" fontSize={9}
              fill={d === today ? "#1565C0" : "#9CA3AF"} fontWeight={d === today ? "bold" : "normal"}>
              {d === today ? "오늘" : `${d}일`}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}
