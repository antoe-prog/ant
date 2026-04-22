import { ScrollView, Text, TouchableOpacity, View, StyleSheet, Switch } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { formatAmount, formatDate, getBeltColor, getBeltLabel, getMemberStatusLabel } from "@/lib/judo-utils";
import { useTabBackHandler } from "@/hooks/use-back-handler";
import { Platform, Alert } from "react-native";
import { useThemeContext } from "@/lib/theme-provider";

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const isManager = user?.role === "manager" || user?.role === "admin";
  useTabBackHandler();
  const { data: myProfile } = trpc.members.myProfile.useQuery(undefined, { enabled: !!user && !isManager });
  const { colorScheme, setColorScheme } = useThemeContext();
  const isDark = colorScheme === "dark";

  if (!user) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-lg font-semibold text-foreground mb-2">로그인이 필요합니다</Text>
        <TouchableOpacity
          style={{ backgroundColor: "#1565C0" }}
          className="px-6 py-3 rounded-full mt-4"
          onPress={() => router.push("/login")}
        >
          <Text className="text-white font-semibold">로그인</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  const roleLabel = user.role === "admin" ? "관리자" : user.role === "manager" ? "매니저" : "회원";

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 프로필 헤더 */}
        <View className="px-5 pt-6 pb-4 items-center">
          <View
            className="w-20 h-20 rounded-full items-center justify-center mb-3"
            style={{ backgroundColor: "#1565C020" }}
          >
            <Text className="text-4xl">🥋</Text>
          </View>
          <Text className="text-xl font-bold text-foreground">{user.name ?? "이름 없음"}</Text>
          <View className="mt-1 px-3 py-1 rounded-full" style={{ backgroundColor: "#1565C020" }}>
            <Text className="text-sm font-medium" style={{ color: "#1565C0" }}>{roleLabel}</Text>
          </View>
          {user.email && (
            <Text className="text-muted text-sm mt-1">{user.email}</Text>
          )}
        </View>

        {/* QR 출석증 버튼 (일반 회원) */}
        {!isManager && myProfile && (
          <View className="mx-5 mb-4">
            <TouchableOpacity
              style={styles.qrButton}
              onPress={() => router.push("/qr-code" as never)}
            >
              <Text style={styles.qrButtonIcon}>📲</Text>
              <View style={styles.qrButtonTextBox}>
                <Text style={styles.qrButtonTitle}>내 QR 출석증</Text>
                <Text style={styles.qrButtonDesc}>관리자에게 보여주면 출석이 자동 기록됩니다</Text>
              </View>
              <Text style={styles.qrButtonArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.qrButton}
              className="mt-3"
              onPress={() => router.push("/my-schedule" as never)}
            >
              <Text style={styles.qrButtonIcon}>📅</Text>
              <View style={styles.qrButtonTextBox}>
                <Text style={styles.qrButtonTitle}>내 일정</Text>
                <Text style={styles.qrButtonDesc}>승급 심사·납부 예정일을 한곳에서 확인</Text>
              </View>
              <Text style={styles.qrButtonArrow}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 회원 정보 (일반 회원인 경우) */}
        {!isManager && myProfile && (
          <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border overflow-hidden">
            <View className="px-4 py-3 border-b border-border">
              <Text className="text-sm font-semibold text-foreground">내 도장 정보</Text>
            </View>
            <View className="px-4 py-3 gap-3">
              <InfoRow label="띠" value={
                <View className="flex-row items-center gap-2">
                  <View className="w-4 h-4 rounded-full" style={{ backgroundColor: getBeltColor(myProfile.beltRank) }} />
                  <Text className="text-foreground text-sm">{getBeltLabel(myProfile.beltRank)} {myProfile.beltDegree}단</Text>
                </View>
              } />
              <InfoRow label="상태" value={getMemberStatusLabel(myProfile.status)} />
              <InfoRow label="입관일" value={formatDate(myProfile.joinDate)} />
              <InfoRow label="월 회비" value={formatAmount(myProfile.monthlyFee)} />
              {myProfile.nextPaymentDate && (
                <InfoRow label="다음 납부일" value={formatDate(myProfile.nextPaymentDate)} />
              )}
              {myProfile.phone && <InfoRow label="연락처" value={myProfile.phone} />}
            </View>
          </View>
        )}

        {/* 계정 정보 */}
        <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border overflow-hidden">
          <View className="px-4 py-3 border-b border-border">
            <Text className="text-sm font-semibold text-foreground">계정 정보</Text>
          </View>
          <View className="px-4 py-3 gap-3">
            <InfoRow label="이름" value={user.name ?? "-"} />
            <InfoRow label="이메일" value={user.email ?? "-"} />
            <InfoRow label="권한" value={roleLabel} />
          </View>
        </View>

        {/* 다크 모드 토글 */}
        <View className="mx-5 mb-3 bg-surface rounded-2xl border border-border overflow-hidden">
          <View className="px-4 py-3 border-b border-border">
            <Text className="text-sm font-semibold text-foreground">화면 설정</Text>
          </View>
          <View className="px-4 py-3 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Text className="text-base">{isDark ? "🌙" : "☀️"}</Text>
              <Text className="text-foreground text-sm font-medium">{isDark ? "다크 모드" : "라이트 모드"}</Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={(val) => setColorScheme(val ? "dark" : "light")}
              trackColor={{ false: "#E5E7EB", true: "#1565C0" }}
              thumbColor={isDark ? "#FFFFFF" : "#FFFFFF"}
            />
          </View>
        </View>

        {/* 알림 테스트 (모바일에서만 표시) */}
        {Platform.OS !== "web" && (
          <View className="mx-5 mb-3">
            <TouchableOpacity
              className="rounded-2xl py-3 items-center border border-border bg-surface"
              onPress={async () => {
                try {
                  const { sendTestNotification } = await import("@/lib/notifications");
                  await sendTestNotification();
                  Alert.alert("알림 테스트", "테스트 알림을 발송했습니다. 알림이 안 온다면 설정 > 알림에서 해당 앱의 알림을 허용해 주세요.");
                } catch (e) {
                  Alert.alert("오류", "알림 테스트에 실패했습니다.");
                }
              }}
            >
              <Text className="text-muted text-sm">🔔 알림 테스트</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 로그아웃 */}
        <View className="mx-5 mb-8">
          <TouchableOpacity
            className="bg-error/10 rounded-2xl py-4 items-center"
            onPress={logout}
          >
            <Text className="text-error font-semibold">로그아웃</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function InfoRow({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <View className="flex-row justify-between items-center">
      <Text className="text-muted text-sm">{label}</Text>
      {typeof value === "string" ? (
        <Text className="text-foreground text-sm font-medium">{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  qrButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1565C0",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
  },
  qrButtonIcon: {
    fontSize: 28,
  },
  qrButtonTextBox: {
    flex: 1,
    gap: 2,
  },
  qrButtonTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  qrButtonDesc: {
    fontSize: 12,
    color: "#BBDEFB",
  },
  qrButtonArrow: {
    fontSize: 22,
    color: "#BBDEFB",
    fontWeight: "300",
  },
});
