import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Text, TouchableOpacity, View, Dimensions, RefreshControl, Modal, FlatList, AppState, type AppStateStatus, Alert, TextInput, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedChild } from "@/hooks/use-selected-child";
import { trpc } from "@/lib/trpc";
import { useBackHandler, useTabBackHandler } from "@/hooks/use-back-handler";
import { listPerfProps, stringKeyExtractor } from "@/lib/list-utils";
import { MonthlyStatsChart } from "@/components/home/MonthlyStatsChart";
import { DailyAttendanceLineChart } from "@/components/home/DailyAttendanceLineChart";
import { SectionHeader, PressableCard, radius, spacing, useSemanticColors } from "@/components/ui/primitives";
import {
  DojoActionCard,
  DojoBackdrop,
  DojoHeroCard,
  DojoPill,
  DojoProgressBar,
  DojoSectionTitle,
  DojoStatTile,
  dojoPalette,
  dojoShadow,
  dojoSoftShadow,
} from "@/components/ui/dojo-theme";
import { syncManagerOperationNotifications } from "@/lib/manager-operation-notifications";
import {
  formatAmount,
  formatDate,
  getBeltColor,
  getBeltLabel,
  getMemberStatusColor,
  getMemberStatusLabel,
} from "@/lib/judo-utils";
import { IS_ADMIN_APP, IS_MEMBER_APP, canUseAdminApp } from "@/constants/app-variant";

const SCREEN_W = Dimensions.get("window").width;

// 홈 섹션에서 공용 프리미티브와 섞어 쓰는 정적 색 참조.
// (테마 palette와 같은 값을 쓰지만 모듈 레벨에서 접근 가능하도록 리터럴로 둠)
const homeColors = { primary: "#1565C0" } as const;

// FlatList 안정 참조용 헬퍼 (매 렌더마다 새 함수 생성되어 renderItem이 리셋되는 것을 방지).
const AlertItemSeparator = () => <View style={{ height: 8 }} />;

type HomeWidgetKey =
  | "tasks"
  | "todos"
  | "statCards"
  | "expiringSoon"
  | "kpi"
  | "revenue"
  | "paymentNotice"
  | "dailyChart"
  | "monthlyChart"
  | "promotions"
  | "tournaments"
  | "quickMenu";

const HOME_WIDGET_STORAGE_KEY = "manager_home_widget_visibility";
const HOME_WIDGET_ORDER_STORAGE_KEY = "manager_home_widget_order";
const HOME_WIDGET_OPTIONS: { key: HomeWidgetKey; label: string; desc: string; icon: string }[] = [
  { key: "tasks", label: "오늘 해야 할 일", desc: "미납, 장기 미출석, 심사/대회 마감 요약", icon: "📌" },
  { key: "todos", label: "운영 할 일", desc: "관리자가 직접 남기는 작업 메모", icon: "📝" },
  { key: "statCards", label: "통계 카드", desc: "전체/활성/출석/미납 회원", icon: "📊" },
  { key: "expiringSoon", label: "만료 임박", desc: "7일 내 등록기간 만료 회원", icon: "⏰" },
  { key: "kpi", label: "핵심 KPI", desc: "신규 입관, 심사, 출석률, 누적 출석", icon: "🎯" },
  { key: "revenue", label: "매출/출석률", desc: "이달 매출과 출석률 배너", icon: "💰" },
  { key: "paymentNotice", label: "납부 주의", desc: "미납/만료 회원 경고 배너", icon: "⚠️" },
  { key: "dailyChart", label: "일별 출석 차트", desc: "이번 달 일별 출석 추이", icon: "📈" },
  { key: "monthlyChart", label: "월별 통계 차트", desc: "최근 6개월 매출/출석 추이", icon: "📉" },
  { key: "promotions", label: "예정 심사", desc: "다가오는 승급 심사 일정", icon: "🥋" },
  { key: "tournaments", label: "다가오는 대회", desc: "대회 일정과 장소", icon: "🏆" },
  { key: "quickMenu", label: "빠른 메뉴", desc: "출석/회원/납부/대회 바로가기", icon: "⚡" },
];

const DEFAULT_WIDGET_VISIBILITY = HOME_WIDGET_OPTIONS.reduce(
  (acc, item) => ({ ...acc, [item.key]: true }),
  {} as Record<HomeWidgetKey, boolean>,
);
const DEFAULT_WIDGET_ORDER = HOME_WIDGET_OPTIONS.map((item) => item.key);
type HomeWidgetPreset = {
  key: string;
  label: string;
  desc: string;
  order: HomeWidgetKey[];
  visible: HomeWidgetKey[];
};

const HOME_WIDGET_PRESETS: HomeWidgetPreset[] = [
  {
    key: "operations",
    label: "운영 집중",
    desc: "오늘 할 일, 운영 메모, 출석/심사/대회를 먼저 봅니다.",
    order: ["tasks", "todos", "dailyChart", "promotions", "tournaments", "quickMenu", "statCards", "expiringSoon", "paymentNotice", "kpi", "revenue", "monthlyChart"],
    visible: ["tasks", "todos", "dailyChart", "promotions", "tournaments", "quickMenu"],
  },
  {
    key: "finance",
    label: "납부 집중",
    desc: "미납, 만료, 매출 흐름을 먼저 확인합니다.",
    order: ["paymentNotice", "expiringSoon", "revenue", "monthlyChart", "tasks", "todos", "statCards", "kpi", "dailyChart", "promotions", "tournaments", "quickMenu"],
    visible: ["paymentNotice", "expiringSoon", "revenue", "monthlyChart", "tasks", "todos"],
  },
  {
    key: "simple",
    label: "간단 모드",
    desc: "핵심 카드만 남겨 첫 화면을 가볍게 정리합니다.",
    order: ["tasks", "todos", "statCards", "quickMenu", "paymentNotice", "expiringSoon", "dailyChart", "monthlyChart", "kpi", "revenue", "promotions", "tournaments"],
    visible: ["tasks", "todos", "statCards", "quickMenu"],
  },
];

/**
 * 홈 섹션의 "다가오는 X" 카드 한 행. 심사·대회 공통 레이아웃.
 * 긴급(D-3 이하)이면 경고색 배지·배경.
 */
function HomeUpcomingRow({
  leading,
  title,
  subtitle,
  daysLeft,
  date,
  onPress,
}: {
  leading: React.ReactNode;
  title: string;
  subtitle?: string;
  daysLeft: number;
  date: string;
  onPress: () => void;
}) {
  const c = useSemanticColors();
  const isUrgent = daysLeft <= 3;
  const badgeBg = isUrgent ? c.error : c.warning;
  return (
    <PressableCard
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        backgroundColor: isUrgent ? c.dangerBg : c.surface,
        borderColor: isUrgent ? c.dangerFg + "40" : c.border,
      }}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: c.foreground, marginBottom: 2 }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 11, color: c.muted }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <View
          style={{
            backgroundColor: badgeBg,
            borderRadius: radius.sm,
            paddingHorizontal: 8,
            paddingVertical: 3,
            marginBottom: 3,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>
            {daysLeft === 0 ? "D-Day" : daysLeft < 0 ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`}
          </Text>
        </View>
        <Text style={{ fontSize: 10, color: c.muted }}>{date}</Text>
      </View>
    </PressableCard>
  );
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const canManage = canUseAdminApp(user?.role);

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

  if (IS_ADMIN_APP && !canManage) return <AdminAppAccessDenied onLogout={logout} />;
  if (IS_MEMBER_APP && user.accountType === "parent") return <ParentHome />;
  if (IS_MEMBER_APP) return <MemberHome />;
  if (canManage) return <ManagerHome />;
  return <MemberHome />;
}

function AdminAppAccessDenied({ onLogout }: { onLogout: () => void }) {
  return (
    <ScreenContainer className="items-center justify-center p-6">
      <View className="items-center gap-4 max-w-xs">
        <Text className="text-5xl">🔒</Text>
        <Text className="text-xl font-bold text-foreground text-center">관리자 앱 전용 계정이 필요합니다</Text>
        <Text className="text-sm text-muted text-center leading-relaxed">
          이 앱은 도장 관리자와 매니저 전용입니다. 회원 계정은 회원 전용 앱에서 로그인해 주세요.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: "#1565C0" }}
          className="w-full py-4 rounded-2xl items-center"
          onPress={onLogout}
        >
          <Text className="text-white font-bold text-base">다른 계정으로 로그인</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
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
  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [widgetVisibility, setWidgetVisibility] = useState<Record<HomeWidgetKey, boolean>>(DEFAULT_WIDGET_VISIBILITY);
  const [widgetOrder, setWidgetOrder] = useState<HomeWidgetKey[]>(DEFAULT_WIDGET_ORDER);

  useTabBackHandler();
  useBackHandler(() => {
    if (showWidgetSettings) {
      setShowWidgetSettings(false);
      return true;
    }
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
    AsyncStorage.getItem(HOME_WIDGET_STORAGE_KEY).then((value) => {
      if (!value) return;
      try {
        const parsed = JSON.parse(value) as Partial<Record<HomeWidgetKey, boolean>>;
        setWidgetVisibility({ ...DEFAULT_WIDGET_VISIBILITY, ...parsed });
      } catch {
        setWidgetVisibility(DEFAULT_WIDGET_VISIBILITY);
      }
    });
    AsyncStorage.getItem(HOME_WIDGET_ORDER_STORAGE_KEY).then((value) => {
      if (!value) return;
      try {
        const parsed = JSON.parse(value) as HomeWidgetKey[];
        const allowed = new Set(DEFAULT_WIDGET_ORDER);
        const cleaned = parsed.filter((key): key is HomeWidgetKey => allowed.has(key));
        const missing = DEFAULT_WIDGET_ORDER.filter((key) => !cleaned.includes(key));
        setWidgetOrder([...cleaned, ...missing]);
      } catch {
        setWidgetOrder(DEFAULT_WIDGET_ORDER);
      }
    });
  }, []);

  // 탭 전환 시 재조회 방지: 수동 Pull-to-Refresh / 자동 주기 갱신에만 의존하도록 staleTime을 크게 둔다.
  const LIST_STALE = 60_000;
  const { data: stats, refetch: refetchStats } = trpc.dashboard.stats.useQuery(undefined, { staleTime: LIST_STALE });
  const { data: upcomingPromotions, refetch: refetchPromotions } = trpc.promotions.upcoming.useQuery({ days: 30 }, { staleTime: LIST_STALE });
  const { data: monthlyStats, refetch: refetchMonthly } = trpc.dashboard.monthlyStats.useQuery(undefined, { staleTime: LIST_STALE });
  const { data: dailyAttendance, refetch: refetchDaily } = trpc.dashboard.dailyAttendance.useQuery(undefined, { staleTime: LIST_STALE });
  const { data: unpaidMembers } = trpc.payments.unpaid.useQuery(undefined, { staleTime: LIST_STALE });
  const { data: expiringSoon } = trpc.payments.expiringSoon.useQuery({ days: 7 }, { staleTime: LIST_STALE });
  const { data: upcomingTournaments } = trpc.tournaments.upcoming.useQuery({ days: 60 }, { staleTime: LIST_STALE });
  const { data: operationsSummary, refetch: refetchOperations } = trpc.dashboard.operationsSummary.useQuery(undefined, { staleTime: LIST_STALE });
  const seedMutation = trpc.dashboard.seed.useMutation({ onSuccess: () => refetchStats() });
  const { user } = useAuth();

  // 알림 항목 조합
  const alertItems = useMemo(() => {
    return (operationsSummary?.tasks ?? []).map((task) => ({
      id: task.id,
      type: task.kind,
      title: task.title,
      desc: task.description,
      color: task.severity === "critical" ? "#DC2626" : task.severity === "warning" ? "#D97706" : "#1565C0",
      icon:
        task.kind === "payment_overdue" || task.kind === "payment_expiring"
          ? "💳"
          : task.kind === "long_absence"
            ? "🧭"
            : task.kind === "promotion"
              ? "🥋"
              : task.kind.startsWith("tournament")
                ? "🏆"
                : "✅",
      route: task.route,
      severity: task.severity,
      count: task.count,
    }));
  }, [operationsSummary]);

  const alertCount = alertItems.length;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStats(), refetchPromotions(), refetchMonthly(), refetchDaily(), refetchOperations()]);
    setLastUpdated(new Date());
    setRefreshing(false);
  }, [refetchStats, refetchPromotions, refetchMonthly, refetchDaily, refetchOperations]);

  // 선택된 주기로 자동 갱신
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (refreshInterval === null) return; // 수동 모드
    const ms = refreshInterval * 60 * 1000;
    autoRefreshRef.current = setInterval(async () => {
      await Promise.all([refetchStats(), refetchPromotions(), refetchMonthly(), refetchDaily(), refetchOperations()]);
      setLastUpdated(new Date());
    }, ms);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [refreshInterval, refetchStats, refetchPromotions, refetchMonthly, refetchDaily, refetchOperations]);

  const handleSelectInterval = async (minutes: number | null) => {
    setRefreshInterval(minutes);
    await AsyncStorage.setItem("manager_refresh_interval", minutes === null ? "null" : String(minutes));
    setShowIntervalPicker(false);
  };

  const toggleWidget = useCallback(async (key: HomeWidgetKey) => {
    const next = { ...widgetVisibility, [key]: !widgetVisibility[key] };
    setWidgetVisibility(next);
    await AsyncStorage.setItem(HOME_WIDGET_STORAGE_KEY, JSON.stringify(next));
  }, [widgetVisibility]);

  const resetWidgets = useCallback(async () => {
    setWidgetVisibility(DEFAULT_WIDGET_VISIBILITY);
    setWidgetOrder(DEFAULT_WIDGET_ORDER);
    await AsyncStorage.setItem(HOME_WIDGET_STORAGE_KEY, JSON.stringify(DEFAULT_WIDGET_VISIBILITY));
    await AsyncStorage.setItem(HOME_WIDGET_ORDER_STORAGE_KEY, JSON.stringify(DEFAULT_WIDGET_ORDER));
  }, []);

  const applyWidgetPreset = useCallback(async (preset: HomeWidgetPreset) => {
    const visible = new Set(preset.visible);
    const nextVisibility = HOME_WIDGET_OPTIONS.reduce(
      (acc, item) => ({ ...acc, [item.key]: visible.has(item.key) }),
      {} as Record<HomeWidgetKey, boolean>,
    );
    const presetOrder = preset.order.filter((key) => DEFAULT_WIDGET_ORDER.includes(key));
    const missing = DEFAULT_WIDGET_ORDER.filter((key) => !presetOrder.includes(key));
    const nextOrder = [...presetOrder, ...missing];
    setWidgetVisibility(nextVisibility);
    setWidgetOrder(nextOrder);
    await AsyncStorage.setItem(HOME_WIDGET_STORAGE_KEY, JSON.stringify(nextVisibility));
    await AsyncStorage.setItem(HOME_WIDGET_ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
  }, []);

  const isWidgetVisible = useCallback((key: HomeWidgetKey) => widgetVisibility[key] !== false, [widgetVisibility]);

  const moveWidget = useCallback(async (key: HomeWidgetKey, direction: -1 | 1) => {
    const index = widgetOrder.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= widgetOrder.length) return;
    const next = [...widgetOrder];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setWidgetOrder(next);
    await AsyncStorage.setItem(HOME_WIDGET_ORDER_STORAGE_KEY, JSON.stringify(next));
  }, [widgetOrder]);

  // 백그라운드 → 포그라운드 복귀 시 즉시 갱신
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        await Promise.all([refetchStats(), refetchPromotions(), refetchMonthly(), refetchDaily(), refetchOperations()]);
        setLastUpdated(new Date());
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [refetchStats, refetchPromotions, refetchMonthly, refetchDaily, refetchOperations]);

  useEffect(() => {
    if (!operationsSummary) return;
    void syncManagerOperationNotifications(operationsSummary);
  }, [operationsSummary]);

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

  const renderHomeWidget = (key: HomeWidgetKey) => {
    switch (key) {
      case "tasks":
        return <TodayTasksBoard summary={operationsSummary} router={router} onOpenAlerts={() => setShowAlerts(true)} />;
      case "todos":
        return <ManagerTodoBoard />;
      case "statCards":
        return (
          <View style={{ paddingHorizontal: 20, flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            {statCards.map((card) => (
              <View key={card.label} style={{ width: (SCREEN_W - 52) / 2, backgroundColor: card.bg, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: card.color + "20" }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <Text style={{ fontSize: 12, color: "#6B7280", fontWeight: "600" }}>{card.label}</Text>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: card.color + "18", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 16 }}>{card.icon}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                  <Text style={{ fontSize: 32, fontWeight: "800", color: card.color, letterSpacing: -1 }}>{card.value}</Text>
                  <Text style={{ fontSize: 13, color: "#9CA3AF", fontWeight: "500" }}>{card.unit}</Text>
                </View>
              </View>
            ))}
          </View>
        );
      case "expiringSoon":
        if ((expiringSoon ?? []).length === 0) return null;
        return (
          <TouchableOpacity style={{ marginHorizontal: 20, marginBottom: 16, backgroundColor: "#FFF7ED", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#FDBA74" }} onPress={() => router.push("/(tabs)/payments" as any)} activeOpacity={0.75}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={{ fontSize: 14, fontWeight: "800", color: "#9A3412" }}>⏰ 만료 임박 회원</Text>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#EA580C" }}>{(expiringSoon ?? []).length}명 · 7일 이내</Text>
            </View>
            <View style={{ gap: 6 }}>
              {(expiringSoon ?? []).slice(0, 4).map((m) => {
                const daysLeft = m.nextPaymentDate ? Math.ceil((new Date(m.nextPaymentDate).getTime() - Date.now()) / 86400000) : 0;
                return (
                  <View key={m.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: "#431407", flex: 1 }} numberOfLines={1}>{m.name}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#C2410C" }}>{daysLeft <= 0 ? "오늘" : `D-${daysLeft}`}</Text>
                  </View>
                );
              })}
            </View>
          </TouchableOpacity>
        );
      case "kpi":
        return <DashboardKpiWidgetsRow stats={stats} router={router} />;
      case "revenue":
        return (
          <View style={{ paddingHorizontal: 20, flexDirection: "row", gap: 12, marginBottom: 16 }}>
            <View style={{ flex: 1, backgroundColor: "#1565C0", borderRadius: 18, padding: 16 }}>
              <Text style={{ fontSize: 11, color: "#93C5FD", fontWeight: "600", marginBottom: 6 }}>💰 이달 매출</Text>
              <Text style={{ fontSize: 20, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5 }}>{formatAmount(stats?.monthlyRevenue ?? 0)}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: attendanceRate >= 70 ? "#16A34A" : attendanceRate >= 40 ? "#D97706" : "#DC2626", borderRadius: 18, padding: 16 }}>
              <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: "600", marginBottom: 6 }}>📊 이달 출석률</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}>
                <Text style={{ fontSize: 20, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5 }}>{attendanceRate}</Text>
                <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: "600" }}>%</Text>
              </View>
            </View>
          </View>
        );
      case "paymentNotice":
        if ((stats?.expiringSoonCount ?? 0) === 0 && (stats?.unpaidCount ?? 0) === 0) return null;
        return (
          <TouchableOpacity style={{ marginHorizontal: 20, marginBottom: 16, backgroundColor: "#FFFBEB", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#FDE68A", flexDirection: "row", alignItems: "center", gap: 12 }} onPress={() => router.push("/(tabs)/payments" as any)} activeOpacity={0.75}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 20 }}>⚠️</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#92400E", marginBottom: 2 }}>납부 주의 필요</Text>
              <Text style={{ fontSize: 11, color: "#B45309" }}>{[(stats?.unpaidCount ?? 0) > 0 ? `미납 ${stats?.unpaidCount}명` : "", (stats?.expiringSoonCount ?? 0) > 0 ? `7일 내 만료 ${stats?.expiringSoonCount}명` : ""].filter(Boolean).join(" · ")}</Text>
            </View>
            <Text style={{ color: "#F59E0B", fontSize: 18, fontWeight: "600" }}>›</Text>
          </TouchableOpacity>
        );
      case "dailyChart":
        return dailyAttendance && dailyAttendance.length > 0 ? <DailyAttendanceLineChart data={dailyAttendance} /> : null;
      case "monthlyChart":
        return monthlyStats && monthlyStats.length > 0 ? <MonthlyStatsChart data={monthlyStats} /> : null;
      case "promotions":
        if ((upcomingPromotions ?? []).length === 0) return null;
        return (
          <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.xl }}>
            <SectionHeader emoji="🥋" title="예정 심사 일정" right={<TouchableOpacity onPress={() => router.push("/(tabs)/promotions" as any)}><Text style={{ fontSize: 12, color: homeColors.primary, fontWeight: "600" }}>전체 보기 →</Text></TouchableOpacity>} />
            <View style={{ gap: spacing.sm }}>
              {(upcomingPromotions ?? []).slice(0, 3).map((p) => {
                const memberName = (p as any).memberName ?? `회원 #${p.memberId}`;
                const daysLeft = Math.ceil((new Date(p.examDate).getTime() - Date.now()) / 86400000);
                return <HomeUpcomingRow key={p.id} onPress={() => router.push({ pathname: "/(tabs)/promotions" } as any)} leading={<View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: getBeltColor(p.currentBelt as any) + "25", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, fontWeight: "800", color: getBeltColor(p.currentBelt as any) }}>{memberName.slice(0, 2)}</Text></View>} title={memberName} subtitle={`${getBeltLabel(p.currentBelt as any)} → ${getBeltLabel(p.targetBelt as any)}`} daysLeft={daysLeft} date={p.examDate} />;
              })}
            </View>
          </View>
        );
      case "tournaments":
        if ((upcomingTournaments ?? []).length === 0) return null;
        return (
          <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.xl }}>
            <SectionHeader emoji="🏆" title="다가오는 대회" right={<TouchableOpacity onPress={() => router.push("/(tabs)/tournaments" as any)}><Text style={{ fontSize: 12, color: homeColors.primary, fontWeight: "600" }}>전체 보기 →</Text></TouchableOpacity>} />
            <View style={{ gap: spacing.sm }}>
              {(upcomingTournaments ?? []).slice(0, 3).map((t) => {
                const daysLeft = Math.ceil((new Date(t.eventDate).getTime() - Date.now()) / 86400000);
                return <HomeUpcomingRow key={t.id} onPress={() => router.push({ pathname: "/tournament-detail", params: { id: String(t.id) } } as any)} leading={<View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: homeColors.primary + "15", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 20 }}>🏆</Text></View>} title={t.title} subtitle={t.location ? `📍 ${t.location}` : undefined} daysLeft={daysLeft} date={t.eventDate} />;
              })}
            </View>
          </View>
        );
      case "quickMenu":
        return (
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 12 }}>빠른 메뉴</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {[
                { label: "출석 체크", icon: "✅", color: "#16A34A", route: "/(tabs)/attendance" as any },
                { label: "회원 목록", icon: "👥", color: "#1565C0", route: "/(tabs)/members" as any },
                { label: "납부 관리", icon: "💳", color: "#7C3AED", route: "/(tabs)/payments" as any },
                { label: "대회 관리", icon: "🏆", color: "#D97706", route: "/(tabs)/tournaments" as any },
              ].map((item) => <TouchableOpacity key={item.label} style={{ flex: 1, backgroundColor: item.color + "10", borderRadius: 16, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: item.color + "25" }} onPress={() => router.push(item.route)} activeOpacity={0.7}><Text style={{ fontSize: 24, marginBottom: 6 }}>{item.icon}</Text><Text style={{ fontSize: 11, fontWeight: "600", color: item.color, textAlign: "center" }}>{item.label}</Text></TouchableOpacity>)}
            </View>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <ScreenContainer>
      <DojoBackdrop variant="admin">
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
        <DojoHeroCard
          variant="admin"
          eyebrow={`${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 · ADMIN`}
          title={`${greeting}, ${user?.name ?? "관리자"}님`}
          subtitle="회원, 출석, 납부, 심사 흐름을 지휘하는 도장 운영 커맨드 센터입니다."
          metric={formatLastUpdated(lastUpdated)}
          action={
            <TouchableOpacity
              style={{
                minWidth: 46,
                height: 38,
                borderRadius: 15,
                backgroundColor: alertCount > 0 ? "#F43F5E" : "#FFFFFF22",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 10,
              }}
              onPress={() => setShowAlerts(true)}
              activeOpacity={0.82}
            >
              <Text style={{ fontSize: 17, color: "#FFFFFF", fontWeight: "900" }}>
                🔔{alertCount > 0 ? ` ${alertCount > 99 ? "99+" : alertCount}` : ""}
              </Text>
            </TouchableOpacity>
          }
        />

        <View style={{ marginHorizontal: 20, marginBottom: 16, flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              backgroundColor: "#FFFFFFDD",
              borderRadius: 16,
              paddingVertical: 11,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#E2E8F0",
            }}
            onPress={() => setShowIntervalPicker(true)}
            activeOpacity={0.75}
          >
            <Text style={{ color: dojoPalette.ink, fontSize: 12, fontWeight: "900" }}>
              ⏱ {refreshInterval === null ? "수동 갱신" : `${refreshInterval}분 갱신`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              flex: 1,
              backgroundColor: "#FFFFFFDD",
              borderRadius: 16,
              paddingVertical: 11,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#E2E8F0",
            }}
            onPress={() => setShowWidgetSettings(true)}
            activeOpacity={0.75}
          >
            <Text style={{ color: dojoPalette.violet, fontSize: 12, fontWeight: "900" }}>⚙️ 위젯 편집</Text>
          </TouchableOpacity>
        </View>

        {widgetOrder.map((key) => (
          <React.Fragment key={key}>
            {isWidgetVisible(key) ? renderHomeWidget(key) : null}
          </React.Fragment>
        ))}

        {false && <>
        {isWidgetVisible("tasks") && (
          <TodayTasksBoard
            summary={operationsSummary}
            router={router}
            onOpenAlerts={() => setShowAlerts(true)}
          />
        )}

        {isWidgetVisible("todos") && <ManagerTodoBoard />}

        {/* ── 통계 카드 2×2 ── */}
        {isWidgetVisible("statCards") && (
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
        )}

        {/* ── 만료 임박 회원 카드 (7일 이내 납부일) ── */}
        {isWidgetVisible("expiringSoon") && (expiringSoon ?? []).length > 0 && (
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
        {isWidgetVisible("kpi") && <DashboardKpiWidgetsRow stats={stats} router={router} />}

        {/* ── 매출 & 출석률 가로 배너 ── */}
        {isWidgetVisible("revenue") && (
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
        )}

        {/* ── 납부 주의 배너 ── */}
        {isWidgetVisible("paymentNotice") && ((stats?.expiringSoonCount ?? 0) > 0 || (stats?.unpaidCount ?? 0) > 0) && (
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
        {isWidgetVisible("dailyChart") && (dailyAttendance ?? []).length > 0 && (
          <DailyAttendanceLineChart data={dailyAttendance ?? []} />
        )}

        {/* ── 월별 통계 차트 ── */}
        {isWidgetVisible("monthlyChart") && (monthlyStats ?? []).length > 0 && (
          <MonthlyStatsChart data={monthlyStats ?? []} />
        )}

        {/* ── 예정 심사 일정 ── */}
        {isWidgetVisible("promotions") && (upcomingPromotions ?? []).length > 0 && (
          <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.xl }}>
            <SectionHeader
              emoji="🥋"
              title="예정 심사 일정"
              right={
                <TouchableOpacity onPress={() => router.push("/(tabs)/promotions" as any)}>
                  <Text style={{ fontSize: 12, color: homeColors.primary, fontWeight: "600" }}>전체 보기 →</Text>
                </TouchableOpacity>
              }
            />
            <View style={{ gap: spacing.sm }}>
              {(upcomingPromotions ?? []).slice(0, 3).map((p) => {
                const memberName = (p as any).memberName ?? `회원 #${p.memberId}`;
                const daysLeft = Math.ceil((new Date(p.examDate).getTime() - Date.now()) / 86400000);
                return (
                  <HomeUpcomingRow
                    key={p.id}
                    onPress={() =>
                      router.push({ pathname: "/(tabs)/promotions" } as any)
                    }
                    leading={
                      <View
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: radius.md,
                          backgroundColor: getBeltColor(p.currentBelt as any) + "25",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: "800", color: getBeltColor(p.currentBelt as any) }}>
                          {memberName.slice(0, 2)}
                        </Text>
                      </View>
                    }
                    title={memberName}
                    subtitle={`${getBeltLabel(p.currentBelt as any)} → ${getBeltLabel(p.targetBelt as any)}`}
                    daysLeft={daysLeft}
                    date={p.examDate}
                  />
                );
              })}
            </View>
          </View>
        )}

        {/* ── 다가오는 대회 ── */}
        {isWidgetVisible("tournaments") && (upcomingTournaments ?? []).length > 0 && (
          <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.xl }}>
            <SectionHeader
              emoji="🏆"
              title="다가오는 대회"
              right={
                <TouchableOpacity onPress={() => router.push("/(tabs)/tournaments" as any)}>
                  <Text style={{ fontSize: 12, color: homeColors.primary, fontWeight: "600" }}>전체 보기 →</Text>
                </TouchableOpacity>
              }
            />
            <View style={{ gap: spacing.sm }}>
              {(upcomingTournaments ?? []).slice(0, 3).map((t) => {
                const daysLeft = Math.ceil((new Date(t.eventDate).getTime() - Date.now()) / 86400000);
                return (
                  <HomeUpcomingRow
                    key={t.id}
                    onPress={() =>
                      router.push({ pathname: "/tournament-detail", params: { id: String(t.id) } } as any)
                    }
                    leading={
                      <View
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: radius.md,
                          backgroundColor: homeColors.primary + "15",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ fontSize: 20 }}>🏆</Text>
                      </View>
                    }
                    title={t.title}
                    subtitle={t.location ? `📍 ${t.location}` : undefined}
                    daysLeft={daysLeft}
                    date={t.eventDate}
                  />
                );
              })}
            </View>
          </View>
        )}
        {/* ── 빠른 메뉴 ── */}
        {isWidgetVisible("quickMenu") && (
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 12 }}>빠른 메뉴</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {[
              { label: "출석 체크", icon: "✅", color: "#16A34A", route: "/(tabs)/attendance" as any },
              { label: "회원 목록", icon: "👥", color: "#1565C0", route: "/(tabs)/members" as any },
              { label: "납부 관리", icon: "💳", color: "#7C3AED", route: "/(tabs)/payments" as any },
              { label: "대회 관리", icon: "🏆", color: "#D97706", route: "/(tabs)/tournaments" as any },
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
        )}

        </>}

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

      <WidgetSettingsModal
        visible={showWidgetSettings}
        values={widgetVisibility}
        order={widgetOrder}
        onApplyPreset={applyWidgetPreset}
        onToggle={toggleWidget}
        onMove={moveWidget}
        onReset={resetWidgets}
        onClose={() => setShowWidgetSettings(false)}
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
      </DojoBackdrop>
    </ScreenContainer>
  );
}

function routeForOperation(route: string) {
  switch (route) {
    case "attendance":
      return "/(tabs)/attendance" as const;
    case "payments":
      return "/(tabs)/payments" as const;
    case "members":
      return "/(tabs)/members" as const;
    case "promotions":
      return "/(tabs)/promotions" as const;
    case "tournaments":
      return "/(tabs)/tournaments" as const;
    case "home":
      return "/(tabs)" as const;
    default:
      return "/(tabs)" as const;
  }
}

function operationIcon(kind: string) {
  if (kind === "payment_overdue" || kind === "payment_expiring") return "💳";
  if (kind === "long_absence") return "🧭";
  if (kind === "promotion") return "🥋";
  if (kind.startsWith("tournament")) return "🏆";
  if (kind === "attendance") return "✅";
  return "📌";
}

function severityPalette(severity: string) {
  if (severity === "critical") {
    return { fg: "#B91C1C", bg: "#FEF2F2", border: "#FECACA", label: "긴급" };
  }
  if (severity === "warning") {
    return { fg: "#B45309", bg: "#FFFBEB", border: "#FDE68A", label: "주의" };
  }
  return { fg: "#1565C0", bg: "#EFF6FF", border: "#BFDBFE", label: "확인" };
}

function TodayTasksBoard({
  onOpenAlerts,
  router,
  summary,
}: {
  onOpenAlerts: () => void;
  router: ReturnType<typeof useRouter>;
  summary: any;
}) {
  const tasks = summary?.tasks ?? [];
  const totals = summary?.totals;
  const topTasks = tasks.slice(0, 4);

  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
      <View
        style={{
          backgroundColor: "#0F172A",
          borderRadius: 22,
          padding: 18,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#93C5FD", fontSize: 12, fontWeight: "800", marginBottom: 4 }}>
              오늘 해야 할 일
            </Text>
            <Text style={{ color: "#FFFFFF", fontSize: 26, fontWeight: "900", letterSpacing: -0.5 }}>
              {totals?.totalTasks ?? 0}건
            </Text>
            <Text style={{ color: "#CBD5E1", fontSize: 12, fontWeight: "600", marginTop: 4 }}>
              긴급 {totals?.critical ?? 0} · 주의 {totals?.warning ?? 0} · 확인 {totals?.info ?? 0}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onOpenAlerts}
            style={{
              backgroundColor: "#FFFFFF18",
              borderColor: "#FFFFFF22",
              borderRadius: 999,
              borderWidth: 1,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "800" }}>전체 보기</Text>
          </TouchableOpacity>
        </View>

        {tasks.length === 0 ? (
          <View style={{ marginTop: 16, backgroundColor: "#FFFFFF10", borderRadius: 16, padding: 14 }}>
            <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800", marginBottom: 4 }}>모두 정상입니다</Text>
            <Text style={{ color: "#CBD5E1", fontSize: 12, lineHeight: 18 }}>
              미납, 장기 미출석, 승급/대회 마감 등 긴급 운영 항목이 없습니다.
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: 16, gap: 10 }}>
            {topTasks.map((task: any) => {
              const palette = severityPalette(task.severity);
              const preview =
                task.members?.slice(0, 3).map((member: any) => member.name).join(", ") ||
                task.items?.slice(0, 3).map((item: any) => item.title).join(", ") ||
                "";
              return (
                <TouchableOpacity
                  key={task.id}
                  onPress={() => router.push(routeForOperation(task.route) as never)}
                  activeOpacity={0.78}
                  style={{
                    backgroundColor: "#FFFFFF",
                    borderRadius: 16,
                    padding: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      alignItems: "center",
                      backgroundColor: palette.bg,
                      borderColor: palette.border,
                      borderRadius: 14,
                      borderWidth: 1,
                      height: 44,
                      justifyContent: "center",
                      width: 44,
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{operationIcon(task.kind)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <Text style={{ color: "#0F172A", fontSize: 14, fontWeight: "900", flex: 1 }} numberOfLines={1}>
                        {task.title}
                      </Text>
                      <View style={{ backgroundColor: palette.bg, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ color: palette.fg, fontSize: 10, fontWeight: "900" }}>{palette.label}</Text>
                      </View>
                    </View>
                    <Text style={{ color: "#64748B", fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
                      {preview ? `${preview} · ${task.description}` : task.description}
                    </Text>
                  </View>
                  <Text style={{ color: palette.fg, fontSize: 18, fontWeight: "800" }}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          {[
            { label: "출석", value: totals?.todayAttendanceMissing ?? 0 },
            { label: "납부", value: totals?.paymentAttention ?? 0 },
            { label: "미출석", value: totals?.longAbsence ?? 0 },
            { label: "대회", value: totals?.tournamentAttention ?? 0 },
          ].map((item) => (
            <View key={item.label} style={{ flex: 1, backgroundColor: "#FFFFFF10", borderRadius: 12, padding: 9, alignItems: "center" }}>
              <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900" }}>{item.value}</Text>
              <Text style={{ color: "#CBD5E1", fontSize: 10, fontWeight: "700", marginTop: 2 }}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const TASK_PRIORITY_META = {
  low: { label: "낮음", color: "#64748B" },
  normal: { label: "보통", color: "#1565C0" },
  high: { label: "높음", color: "#DC2626" },
} as const;

function ManagerTodoBoard() {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [dueDate, setDueDate] = useState("");
  const [memberId, setMemberId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"open" | "today" | "week" | "high" | "done">("open");
  const [showDone, setShowDone] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);

  const { data: tasks, isLoading } = trpc.managerTasks.list.useQuery(
    { includeDone: true, limit: 80 },
    { staleTime: 30_000 },
  );
  const { data: members } = trpc.members.list.useQuery(undefined, { staleTime: 60_000 });
  const createMutation = trpc.managerTasks.create.useMutation({
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setPriority("normal");
      setDueDate("");
      setMemberId(null);
      void utils.managerTasks.list.invalidate();
    },
  });
  const resetTaskForm = () => {
    setTitle("");
    setDescription("");
    setPriority("normal");
    setDueDate("");
    setMemberId(null);
    setEditingTaskId(null);
  };
  const updateMutation = trpc.managerTasks.update.useMutation({
    onSuccess: () => {
      resetTaskForm();
      void utils.managerTasks.list.invalidate();
    },
    onError: (e) => Alert.alert("할 일 수정 실패", e.message),
  });
  const doneMutation = trpc.managerTasks.setDone.useMutation({
    onSuccess: () => void utils.managerTasks.list.invalidate(),
  });
  const archiveMutation = trpc.managerTasks.archive.useMutation({
    onSuccess: () => void utils.managerTasks.list.invalidate(),
  });

  const todayKey = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndKey = weekEnd.toISOString().slice(0, 10);
  const openTasks = (tasks ?? []).filter((task) => task.status === "open");
  const doneTasks = (tasks ?? []).filter((task) => task.status === "done");
  const dueTasks = openTasks.filter((task) => Boolean(task.dueDate && task.dueDate <= todayKey));
  const highDueTasks = dueTasks.filter((task) => task.priority === "high");
  const filteredTasks = (tasks ?? []).filter((task) => {
    if (filter === "done") return task.status === "done";
    if (task.status !== "open") return false;
    if (filter === "today") return Boolean(task.dueDate && task.dueDate <= todayKey);
    if (filter === "week") return Boolean(task.dueDate && task.dueDate >= todayKey && task.dueDate <= weekEndKey);
    if (filter === "high") return task.priority === "high";
    return true;
  });

  const handleCreate = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert("확인", "할 일 제목을 입력해 주세요.");
      return;
    }
    const normalizedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim()) ? dueDate.trim() : null;
    if (editingTaskId != null) {
      updateMutation.mutate({
        id: editingTaskId,
        title: trimmed,
        description: description.trim() || null,
        priority,
        dueDate: normalizedDueDate,
        memberId,
      });
      return;
    }
    createMutation.mutate({
      title: trimmed,
      description: description.trim() || undefined,
      priority,
      dueDate: normalizedDueDate ?? undefined,
      memberId: memberId ?? undefined,
    });
  };
  const startEditTask = (task: {
    id: number;
    title: string;
    description: string | null;
    priority: "low" | "normal" | "high";
    dueDate: string | null;
    memberId: number | null;
  }) => {
    setEditingTaskId(task.id);
    setTitle(task.title);
    setDescription(task.description ?? "");
    setPriority(task.priority);
    setDueDate(task.dueDate ?? "");
    setMemberId(task.memberId);
  };
  const selectedMember = members?.find((member) => member.id === memberId);

  return (
    <View style={{ marginHorizontal: 20, marginBottom: 16, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 16, fontWeight: "900", color: "#0F172A" }}>📝 운영 할 일</Text>
          <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
            진행 중 {openTasks.length}건{showDone ? ` · 완료 ${doneTasks.length}건` : ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowDone((v) => !v)}
          style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: showDone ? "#EFF6FF" : "#F8FAFC", borderWidth: 1, borderColor: showDone ? "#BFDBFE" : "#E2E8F0" }}
        >
          <Text style={{ fontSize: 11, fontWeight: "800", color: showDone ? "#1565C0" : "#64748B" }}>
            {showDone ? "완료 포함" : "진행만"}
          </Text>
        </TouchableOpacity>
      </View>

      {dueTasks.length > 0 ? (
        <TouchableOpacity
          onPress={() => setFilter("today")}
          activeOpacity={0.82}
          style={{ marginBottom: 12, borderRadius: 14, borderWidth: 1, borderColor: "#FDBA74", backgroundColor: "#FFF7ED", padding: 12 }}
        >
          <Text style={{ fontSize: 12, fontWeight: "900", color: "#9A3412" }}>
            마감 확인 필요 {dueTasks.length}건{highDueTasks.length > 0 ? ` · 중요 ${highDueTasks.length}건` : ""}
          </Text>
          <Text style={{ fontSize: 11, color: "#C2410C", marginTop: 3 }}>
            누르면 오늘/마감 필터로 바로 확인할 수 있습니다.
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ gap: 8, marginBottom: 12 }}>
        {editingTaskId != null ? (
          <View style={{ borderRadius: 10, backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE", paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#7C3AED" }}>할 일 수정 중 — 저장을 누르면 반영됩니다</Text>
          </View>
        ) : null}
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="예: 대회비 입금 확인"
          placeholderTextColor="#94A3B8"
          style={{ borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: "#0F172A", backgroundColor: "#F8FAFC" }}
          returnKeyType="done"
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="상세 메모 선택 입력"
          placeholderTextColor="#94A3B8"
          style={{ borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, color: "#0F172A", backgroundColor: "#F8FAFC" }}
          returnKeyType="done"
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="마감일 YYYY-MM-DD"
            placeholderTextColor="#94A3B8"
            style={{ flex: 1, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, color: "#0F172A", backgroundColor: "#F8FAFC" }}
            returnKeyType="done"
          />
          <TouchableOpacity
            onPress={() => setDueDate(todayKey)}
            style={{ borderWidth: 1, borderColor: "#BFDBFE", backgroundColor: "#EFF6FF", borderRadius: 12, paddingHorizontal: 12, justifyContent: "center" }}
          >
            <Text style={{ fontSize: 11, color: "#1565C0", fontWeight: "900" }}>오늘</Text>
          </TouchableOpacity>
        </View>
        {(members ?? []).length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 6, paddingBottom: 2 }}>
              <TouchableOpacity
                onPress={() => setMemberId(null)}
                style={{ borderRadius: 999, borderWidth: 1, borderColor: memberId == null ? "#1565C0" : "#E2E8F0", backgroundColor: memberId == null ? "#EFF6FF" : "#FFFFFF", paddingHorizontal: 10, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800", color: memberId == null ? "#1565C0" : "#64748B" }}>회원 연결 없음</Text>
              </TouchableOpacity>
              {(members ?? []).slice(0, 20).map((member) => {
                const selected = memberId === member.id;
                return (
                  <TouchableOpacity
                    key={member.id}
                    onPress={() => setMemberId(selected ? null : member.id)}
                    style={{ borderRadius: 999, borderWidth: 1, borderColor: selected ? "#1565C0" : "#E2E8F0", backgroundColor: selected ? "#EFF6FF" : "#FFFFFF", paddingHorizontal: 10, paddingVertical: 6 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "800", color: selected ? "#1565C0" : "#64748B" }}>{member.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {(["low", "normal", "high"] as const).map((p) => {
            const meta = TASK_PRIORITY_META[p];
            const selected = priority === p;
            return (
              <TouchableOpacity
                key={p}
                onPress={() => setPriority(p)}
                style={{ flex: 1, borderRadius: 999, borderWidth: 1, borderColor: selected ? meta.color : "#E2E8F0", backgroundColor: selected ? meta.color + "14" : "#FFFFFF", paddingVertical: 8, alignItems: "center" }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800", color: selected ? meta.color : "#64748B" }}>
                  {meta.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {editingTaskId != null ? (
            <TouchableOpacity
              onPress={resetTaskForm}
              style={{ borderRadius: 999, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 9 }}
            >
              <Text style={{ color: "#64748B", fontSize: 12, fontWeight: "900" }}>취소</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={handleCreate}
            disabled={createMutation.isPending || updateMutation.isPending}
            style={{ borderRadius: 999, backgroundColor: editingTaskId != null ? "#7C3AED" : "#1565C0", paddingHorizontal: 14, paddingVertical: 9, opacity: createMutation.isPending || updateMutation.isPending ? 0.6 : 1 }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>
              {editingTaskId != null
                ? updateMutation.isPending ? "저장 중" : "저장"
                : createMutation.isPending ? "추가 중" : "추가"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {([
            { key: "open", label: `진행 ${openTasks.length}` },
            { key: "today", label: "오늘까지" },
            { key: "week", label: "이번 주" },
            { key: "high", label: "중요" },
            { key: "done", label: `완료 ${doneTasks.length}` },
          ] as const).map((item) => {
            const selected = filter === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                onPress={() => {
                  setFilter(item.key);
                  if (item.key === "done") setShowDone(true);
                }}
                style={{ borderRadius: 999, borderWidth: 1, borderColor: selected ? "#1565C0" : "#E2E8F0", backgroundColor: selected ? "#1565C0" : "#FFFFFF", paddingHorizontal: 10, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 11, fontWeight: "900", color: selected ? "#FFFFFF" : "#64748B" }}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {isLoading ? (
        <Text style={{ fontSize: 12, color: "#64748B", textAlign: "center", paddingVertical: 14 }}>할 일을 불러오는 중...</Text>
      ) : filteredTasks.length === 0 ? (
        <View style={{ backgroundColor: "#F8FAFC", borderRadius: 14, padding: 14, alignItems: "center" }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: "#334155" }}>조건에 맞는 운영 할 일이 없습니다</Text>
          <Text style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>필터를 바꾸거나 새 할 일을 추가해 보세요.</Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {filteredTasks.slice(0, 8).map((task) => {
            const meta = TASK_PRIORITY_META[task.priority];
            const isDone = task.status === "done";
            const dueColor = task.dueDate && task.dueDate <= todayKey ? "#DC2626" : "#64748B";
            return (
              <View
                key={task.id}
                style={{ borderRadius: 14, borderWidth: 1, borderColor: isDone ? "#BBF7D0" : meta.color + "35", backgroundColor: isDone ? "#F0FDF4" : "#FAFAFA", padding: 12 }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => doneMutation.mutate({ id: task.id, done: !isDone })}
                    style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: isDone ? "#16A34A" : "#CBD5E1", backgroundColor: isDone ? "#16A34A" : "#FFFFFF", alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>{isDone ? "✓" : ""}</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ flex: 1, fontSize: 13, fontWeight: "900", color: isDone ? "#15803D" : "#0F172A", textDecorationLine: isDone ? "line-through" : "none" }} numberOfLines={1}>
                        {task.title}
                      </Text>
                      <View style={{ backgroundColor: meta.color + "14", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, color: meta.color, fontWeight: "900" }}>{meta.label}</Text>
                      </View>
                    </View>
                    {task.description ? (
                      <Text style={{ fontSize: 11, color: "#64748B", marginTop: 4, lineHeight: 16 }} numberOfLines={2}>
                        {task.description}
                      </Text>
                    ) : null}
                    <Text style={{ fontSize: 10, color: "#94A3B8", marginTop: 5 }}>
                      {task.memberName ? `회원 ${task.memberName} · ` : ""}
                      작성 {task.createdByName ?? `사용자 #${task.createdBy}`} · {formatDate(task.createdAt)}
                    </Text>
                    {task.dueDate ? (
                      <Text style={{ fontSize: 10, color: dueColor, marginTop: 3, fontWeight: "800" }}>
                        마감 {formatDate(task.dueDate)}
                      </Text>
                    ) : selectedMember && task.memberId === selectedMember.id ? (
                      <Text style={{ fontSize: 10, color: "#1565C0", marginTop: 3, fontWeight: "800" }}>
                        {selectedMember.name} 연결됨
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "center", gap: 6 }}>
                    <TouchableOpacity onPress={() => archiveMutation.mutate({ id: task.id })} style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
                      <Text style={{ color: "#94A3B8", fontSize: 14, fontWeight: "900" }}>×</Text>
                    </TouchableOpacity>
                    {!isDone ? (
                      <TouchableOpacity onPress={() => startEditTask(task)} style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
                        <Text style={{ color: editingTaskId === task.id ? "#7C3AED" : "#94A3B8", fontSize: 13 }}>✎</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function WidgetSettingsModal({
  onApplyPreset,
  onClose,
  onMove,
  onReset,
  onToggle,
  order,
  topInset,
  values,
  visible,
}: {
  visible: boolean;
  values: Record<HomeWidgetKey, boolean>;
  order: HomeWidgetKey[];
  onApplyPreset: (preset: HomeWidgetPreset) => void;
  onToggle: (key: HomeWidgetKey) => void;
  onMove: (key: HomeWidgetKey, direction: -1 | 1) => void;
  onReset: () => void;
  onClose: () => void;
  topInset?: number;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: Math.max(topInset ?? 0, 20), paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "900", color: "#0F172A" }}>홈 위젯 설정</Text>
            <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>관리자 홈에 표시할 카드만 선택합니다</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 16, color: "#64748B", fontWeight: "900" }}>×</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          <View style={{ gap: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "900" }}>추천 프리셋</Text>
            {HOME_WIDGET_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.key}
                onPress={() => onApplyPreset(preset)}
                activeOpacity={0.8}
                style={{ borderRadius: 14, borderWidth: 1, borderColor: "#BFDBFE", backgroundColor: "#EFF6FF", paddingHorizontal: 14, paddingVertical: 12 }}
              >
                <Text style={{ fontSize: 13, color: "#0F172A", fontWeight: "900" }}>{preset.label}</Text>
                <Text style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>{preset.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {order.map((key, index) => {
            const item = HOME_WIDGET_OPTIONS.find((option) => option.key === key);
            if (!item) return null;
            const enabled = values[item.key] !== false;
            return (
              <TouchableOpacity
                key={item.key}
                onPress={() => onToggle(item.key)}
                activeOpacity={0.75}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: enabled ? "#BFDBFE" : "#E2E8F0", backgroundColor: enabled ? "#EFF6FF" : "#FAFAFA", padding: 14 }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: enabled ? "#DBEAFE" : "#F1F5F9", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 22 }}>{item.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: "#0F172A", fontWeight: "900" }}>{item.label}</Text>
                  <Text style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>{item.desc}</Text>
                </View>
                <View style={{ width: 46, height: 26, borderRadius: 999, backgroundColor: enabled ? "#1565C0" : "#CBD5E1", padding: 3, alignItems: enabled ? "flex-end" : "flex-start" }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFFFFF" }} />
                </View>
                <View style={{ gap: 4 }}>
                  <TouchableOpacity
                    disabled={index === 0}
                    onPress={() => onMove(item.key, -1)}
                    style={{ width: 28, height: 24, borderRadius: 8, backgroundColor: index === 0 ? "#F1F5F9" : "#DBEAFE", alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ color: index === 0 ? "#CBD5E1" : "#1565C0", fontWeight: "900" }}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={index === order.length - 1}
                    onPress={() => onMove(item.key, 1)}
                    style={{ width: 28, height: 24, borderRadius: 8, backgroundColor: index === order.length - 1 ? "#F1F5F9" : "#DBEAFE", alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ color: index === order.length - 1 ? "#CBD5E1" : "#1565C0", fontWeight: "900" }}>↓</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity onPress={onReset} style={{ marginTop: 6, borderRadius: 14, borderWidth: 1, borderColor: "#E2E8F0", paddingVertical: 13, alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: "#64748B", fontWeight: "900" }}>기본값으로 복원</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
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
type AlertItem = {
  id: string;
  type: string;
  title: string;
  desc: string;
  color: string;
  icon: string;
  route: string;
  severity: "critical" | "warning" | "info";
  count: number;
};

function AlertCenterModal({ visible, onClose, items, router, topInset }: {
  visible: boolean;
  onClose: () => void;
  items: AlertItem[];
  router: ReturnType<typeof useRouter>;
  topInset?: number;
}) {
  const handleItemPress = (item: AlertItem) => {
    onClose();
    router.push(routeForOperation(item.route) as never);
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
            keyExtractor={stringKeyExtractor}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            ItemSeparatorComponent={AlertItemSeparator}
            {...listPerfProps}
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
                      <Text style={{ fontSize: 10, fontWeight: "700", color: item.color }}>
                        {item.severity === "critical" ? "긴급" : item.severity === "warning" ? "주의" : "확인"} · {item.count}건
                      </Text>
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

// ─── 학부모 홈 ────────────────────────────────────────────────────────────────
function ParentHome() {
  useTabBackHandler();
  const { user } = useAuth();
  const {
    children,
    selectedChild,
    selectedChildId,
    selectedMemberInput,
    setSelectedChildId,
    isLoadingChildren,
  } = useSelectedChild();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = new Date();
  const MEMBER_STALE = 60_000;

  const { data: childProfile, isLoading: childLoading } = trpc.members.myProfile.useQuery(
    selectedMemberInput,
    { enabled: !!selectedChildId, staleTime: MEMBER_STALE },
  );
  const { data: childAttendance } = trpc.members.myAttendanceByMonth.useQuery(
    { year: now.getFullYear(), month: now.getMonth() + 1, ...(selectedMemberInput ?? {}) },
    { enabled: !!selectedChildId, staleTime: MEMBER_STALE },
  );
  const { data: payments } = trpc.members.myPayments.useQuery(selectedMemberInput, {
    enabled: !!selectedChildId,
    staleTime: MEMBER_STALE,
  });
  const { data: announcements } = trpc.announcements.list.useQuery(undefined, {
    staleTime: MEMBER_STALE,
  });

  const observedDays = now.getDate();
  const attendanceCount = childAttendance?.length ?? 0;
  const attendanceRate = observedDays > 0 ? Math.round((attendanceCount / observedDays) * 100) : 0;
  const totalPaid = payments?.reduce((sum, item) => sum + Number(item.amount), 0) ?? 0;
  const recentAnnouncements = (announcements ?? []).slice(0, 3);

  return (
    <ScreenContainer>
      <DojoBackdrop variant="parent">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
        >
          <DojoHeroCard
            variant="parent"
            eyebrow="PARENT VIEW"
            title={`안녕하세요, ${user?.name ?? "학부모"}님`}
            subtitle="자녀의 출석, 납부, 승급 흐름을 한 화면에서 부드럽게 확인하세요."
            metric={selectedChild ? `${selectedChild.name} 선택됨` : `${children.length}명 연결`}
            action={<DojoPill label={`${attendanceRate}% 출석`} />}
          />

        {children.length > 1 && (
          <View style={{ marginHorizontal: 20, marginBottom: 16 }}>
            <Text style={{ fontSize: 13, fontWeight: "800", color: "#064E3B", marginBottom: 8 }}>
              자녀 선택
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {children.map((child) => {
                const active = child.id === selectedChild?.id;
                return (
                  <TouchableOpacity
                    key={child.id}
                    activeOpacity={0.82}
                    onPress={() => void setSelectedChildId(child.id)}
                    style={{
                      minWidth: 108,
                      borderRadius: 999,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: active ? "#047857" : "#D1D5DB",
                      backgroundColor: active ? "#D1FAE5" : "#FFFFFF",
                    }}
                  >
                    <Text
                      style={{
                        color: active ? "#065F46" : "#334155",
                        fontSize: 13,
                        fontWeight: "900",
                        textAlign: "center",
                      }}
                      numberOfLines={1}
                    >
                      {child.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {isLoadingChildren || childLoading ? (
          <View style={{ paddingVertical: 44, alignItems: "center" }}>
            <ActivityIndicator size="large" color="#047857" />
            <Text style={{ marginTop: 12, color: "#64748B", fontSize: 13 }}>자녀 정보를 확인하는 중입니다.</Text>
          </View>
        ) : !childProfile ? (
          <View
            style={{
              marginHorizontal: 20,
              borderRadius: 24,
              padding: 20,
              backgroundColor: "#FFFFFF",
              borderWidth: 1,
              borderColor: "#D1FAE5",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", color: "#064E3B", marginBottom: 8 }}>
              자녀 연결이 필요합니다
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 21, color: "#475569", marginBottom: 16 }}>
              학부모 계정은 가입이 완료되었습니다. 관리자 앱에서 자녀 회원과 이 계정을 연결하면 출석률,
              등록기간, 승급심사, 도장 소식이 이 화면에 표시됩니다.
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push("/(tabs)/profile" as never)}
              style={{
                backgroundColor: "#047857",
                borderRadius: 16,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800" }}>내 계정 정보 확인</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View
              style={{
                marginHorizontal: 20,
                marginBottom: 16,
                borderRadius: 24,
                padding: 18,
                backgroundColor: "#FFFFFF",
                borderWidth: 1,
                borderColor: "#D1FAE5",
                ...dojoSoftShadow,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 }}>
                <View
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: 20,
                    backgroundColor: getBeltColor(childProfile.beltRank) + "20",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: getBeltColor(childProfile.beltRank), fontSize: 22, fontWeight: "900" }}>
                    {childProfile.name.slice(0, 1)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 19, fontWeight: "900", color: "#0F172A", marginBottom: 4 }}>
                    {childProfile.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: "#64748B" }}>
                    {getBeltLabel(childProfile.beltRank)} {childProfile.beltDegree}단 · {getMemberStatusLabel(childProfile.status)}
                  </Text>
                </View>
                <Text style={{ color: "#047857", fontSize: 22, fontWeight: "900" }}>{attendanceRate}%</Text>
              </View>

              <DojoProgressBar progress={attendanceRate} accent={dojoPalette.emerald} />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginHorizontal: 20, marginBottom: 16 }}>
              {[
                { label: "이번 달 출석", value: `${attendanceCount}회`, color: "#047857" },
                { label: "월 회비", value: formatAmount(childProfile.monthlyFee), color: "#1565C0" },
                { label: "총 납부", value: formatAmount(totalPaid), color: "#7C3AED" },
              ].map((item) => (
                <DojoStatTile
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  accent={item.color}
                  style={{ minHeight: 86, padding: 13 }}
                />
              ))}
            </View>

            <View style={{ marginHorizontal: 20, marginBottom: 16 }}>
              <DojoSectionTitle title="빠른 확인" eyebrow="CHECKLIST" style={{ marginHorizontal: 0 }} />
              <View style={{ gap: 10 }}>
                {[
                  { title: "출석 달력", desc: "자녀의 월별 출석 현황", href: "/my-attendance-calendar", icon: "📆", color: "#047857" },
                  { title: "등록기간", desc: "납부 이력과 만료일 확인", href: "/my-registration", icon: "💳", color: "#1565C0" },
                  { title: "승급심사", desc: "심사 일정과 결과 확인", href: "/my-promotions", icon: "🏅", color: "#7C3AED" },
                ].map((item) => (
                  <DojoActionCard
                    key={item.title}
                    onPress={() => router.push(item.href as never)}
                    icon={item.icon}
                    title={item.title}
                    description={item.desc}
                    accent={item.color}
                  />
                ))}
              </View>
            </View>
          </>
        )}

        <View style={{ marginHorizontal: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: "900", color: "#0F172A" }}>도장 소식</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/announcements" as never)}>
              <Text style={{ color: "#047857", fontSize: 12, fontWeight: "800" }}>더보기</Text>
            </TouchableOpacity>
          </View>
          <View style={{ gap: 8 }}>
            {recentAnnouncements.length > 0 ? (
              recentAnnouncements.map((item) => (
                <View
                  key={item.id}
                  style={{
                    backgroundColor: "#FFFFFF",
                    borderRadius: 16,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: "#E2E8F0",
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: "800", color: "#0F172A", marginBottom: 4 }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#64748B" }}>{formatDate(String(item.createdAt))}</Text>
                </View>
              ))
            ) : (
              <View style={{ backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
                <Text style={{ color: "#64748B", fontSize: 13 }}>아직 표시할 도장 소식이 없습니다.</Text>
              </View>
            )}
          </View>
        </View>
        </ScrollView>
      </DojoBackdrop>
    </ScreenContainer>
  );
}

// ─── 회원 홈 ──────────────────────────────────────────────────────────────────
function MemberHome() {
  useTabBackHandler();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  // 회원 홈은 새 출석·심사가 자주 변하지 않으므로 staleTime을 1~2분으로 여유 있게 잡는다.
  const MEMBER_STALE = 60_000;
  const { data: myProfile } = trpc.members.myProfile.useQuery(undefined, { staleTime: MEMBER_STALE });
  const now = new Date();
  const { data: myAttendance } = trpc.members.myAttendanceByMonth.useQuery(
    { year: now.getFullYear(), month: now.getMonth() + 1 },
    { staleTime: MEMBER_STALE },
  );
  const { data: allAttendance } = trpc.members.myAttendanceAll.useQuery(undefined, { staleTime: MEMBER_STALE });
  const { data: myPromotions } = trpc.members.myPromotions.useQuery(undefined, { staleTime: MEMBER_STALE });
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
      <DojoBackdrop variant="student">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}>
          <DojoHeroCard
            variant="student"
            eyebrow={`${now.getMonth() + 1}월 ${now.getDate()}일 · ${["일", "월", "화", "수", "목", "금", "토"][now.getDay()]}요일`}
            title={`${greeting}, ${user?.name ?? "회원"}님`}
            subtitle="오늘의 수련 리듬, 출석 흐름, 승급 목표를 한눈에 확인하세요."
            metric={`${attendanceRate}% 출석률`}
            action={<DojoPill label={streak > 0 ? `${streak}일 연속` : "오늘도 수련"} />}
          />

        {/* ── 프로필 카드 ── */}
        {myProfile ? (
          <View style={{ marginHorizontal: 20, marginBottom: 16 }}>
            <View style={{
              borderRadius: 22,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: getBeltColor(myProfile.beltRank) + "30",
              ...dojoSoftShadow,
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
            borderRadius: 24, padding: 18,
            borderWidth: 1, borderColor: "#BBF7D0",
            ...dojoSoftShadow,
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
            <View style={{ marginTop: 14 }}>
              <DojoProgressBar progress={attendanceRate} accent="#22C55E" />
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
          <DojoSectionTitle title="나의 도장 정보" eyebrow="MY DOJO" style={{ marginHorizontal: 0 }} />
          <View style={{ gap: 10 }}>
            {[
              { icon: "🏅", title: "승급심사", desc: "심사 예정 및 결과 확인", color: "#7C3AED", href: "/my-promotions" },
              { icon: "📅", title: "등록기간", desc: "납부 이력 및 만료일 확인", color: "#1565C0", href: "/my-registration" },
              { icon: "📆", title: "출석달력", desc: "월별 출석 현황 달력 보기", color: "#16A34A", href: "/my-attendance-calendar" },
            ].map((item) => (
              <DojoActionCard
                key={item.title}
                onPress={() => router.push(item.href as never)}
                icon={item.icon}
                title={item.title}
                description={item.desc}
                accent={item.color}
              />
            ))}
          </View>
        </View>

        {/* ── 공지사항 ── */}
        <AnnouncementPreview />
        </ScrollView>
      </DojoBackdrop>
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

