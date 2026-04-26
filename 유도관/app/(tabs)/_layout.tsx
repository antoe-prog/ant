import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, View, Text } from "react-native";
import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { IS_ADMIN_APP, IS_MEMBER_APP } from "@/constants/app-variant";

// 배지 컴포넌트
function BadgeIcon({
  iconName,
  color,
  badgeCount,
}: {
  iconName: Parameters<typeof IconSymbol>[0]["name"];
  color: string;
  badgeCount?: number;
}) {
  return (
    <View style={{ width: 28, height: 28 }}>
      <IconSymbol size={24} name={iconName} color={color} />
      {badgeCount != null && badgeCount > 0 && (
        <View
          style={{
            position: "absolute",
            top: -4,
            right: -6,
            backgroundColor: "#CF222E",
            borderRadius: 8,
            minWidth: 16,
            height: 16,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 9, fontWeight: "700" }}>
            {badgeCount > 99 ? "99+" : badgeCount}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated } = useAuth();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;
  const role = user?.role ?? "member";
  const hasManagerRole = role === "manager" || role === "admin";
  const isManager = IS_ADMIN_APP && hasManagerRole;

  // 미납 회원 수 조회 (관리자만, 30초마다 갱신)
  const { data: stats } = trpc.dashboard.stats.useQuery(undefined, {
    enabled: isAuthenticated && isManager,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const unpaidCount = stats?.unpaidCount ?? 0;

  // 관리자 수 조회 - 관리자가 없으면 누구나 관리 탭 표시
  const { data: adminCount } = trpc.admin.adminCount.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60000,
  });
  // 최고관리자이거나, 아직 관리자가 없는 경우 탭 표시
  const showAdminTab = IS_ADMIN_APP && isAuthenticated && (role === "admin" || adminCount === 0);

  const { data: announcementList } = trpc.announcements.list.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 45_000,
  });
  const unreadAnnouncementCount =
    announcementList?.filter((a) => !(a as { readAt?: unknown }).readAt).length ?? 0;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 8,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginTop: -2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "홈",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={24} name="house.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: "회원",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={24} name="person.3.fill" color={color} />
          ),
          href: IS_ADMIN_APP && isAuthenticated && isManager ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: "출석",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={24} name="checklist" color={color} />
          ),
          href: IS_ADMIN_APP && isAuthenticated && isManager ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: "납부",
          tabBarIcon: ({ color }) => (
            <BadgeIcon
              iconName="creditcard.fill"
              color={color}
              badgeCount={isManager ? unpaidCount : undefined}
            />
          ),
          href: IS_ADMIN_APP && isAuthenticated && isManager ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="promotions"
        options={{
          title: "심사",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={24} name="trophy.fill" color={color} />
          ),
          href: IS_ADMIN_APP && isAuthenticated && isManager ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="tournaments"
        options={{
          title: "대회",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={24} name="rosette" color={color} />
          ),
          // 관리자는 항상, 일반 회원은 내가 참가한 대회가 있을 때만 노출되도록 하고 싶다면 별도 쿼리 필요.
          // 현재는 모든 로그인 사용자에게 탭을 보여 회원이 자기 참가 이력을 확인할 수 있게 한다.
          href: isAuthenticated && (IS_MEMBER_APP || isManager) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: "공지",
          tabBarIcon: ({ color }) => (
            <BadgeIcon
              iconName="bell.fill"
              color={color}
              badgeCount={unreadAnnouncementCount > 0 ? unreadAnnouncementCount : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: "관리",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={24} name="gearshape.fill" color={color} />
          ),
          // 최고관리자만 표시, 관리자가 없을 때도 표시
          href: showAdminTab ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "내 정보",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={24} name="person.crop.circle.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
