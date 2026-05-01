import { useState } from "react";
import { ScrollView, Text, TouchableOpacity, View, StyleSheet, Switch, Modal } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedChild } from "@/hooks/use-selected-child";
import { trpc } from "@/lib/trpc";
import { getFriendlyErrorMessage, getFriendlyErrorTitle } from "@/lib/error-messages";
import { formatAmount, formatDate, getBeltColor, getBeltLabel, getMemberStatusLabel } from "@/lib/judo-utils";
import { useModalBackHandler, useTabBackHandler } from "@/hooks/use-back-handler";
import { Platform, Alert } from "react-native";
import { useThemeContext } from "@/lib/theme-provider";
import { IS_MEMBER_APP } from "@/constants/app-variant";
import { FormField, GhostButton, PrimaryButton, spacing, useSemanticColors } from "@/components/ui/primitives";
import { formatDateInput, formatPhoneInput } from "@/lib/input-formatters";

function isValidDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const hasManagerRole = user?.role === "manager" || user?.role === "admin";
  const isManager = !IS_MEMBER_APP && hasManagerRole;
  const isParentAccount = user?.accountType === "parent";
  const {
    children,
    selectedChild,
    selectedChildId,
    selectedMemberInput,
    setSelectedChildId,
    isLoadingChildren,
  } = useSelectedChild();
  useTabBackHandler();
  const utils = trpc.useUtils();
  const { data: myProfile, isLoading: isMyProfileLoading } = trpc.members.myProfile.useQuery(selectedMemberInput, {
    enabled: !!user && !isManager && (!isParentAccount || !!selectedChildId),
  });
  const { colorScheme, setColorScheme } = useThemeContext();
  const c = useSemanticColors();
  const isDark = colorScheme === "dark";
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editBirthDate, setEditBirthDate] = useState("");
  const [editEmergencyContact, setEditEmergencyContact] = useState("");
  useModalBackHandler(showEditProfile, () => setShowEditProfile(false));

  const updateMyProfileMutation = trpc.members.updateMyProfile.useMutation({
    onSuccess: () => {
      void utils.members.myProfile.invalidate();
      setShowEditProfile(false);
      Alert.alert("저장 완료", "회원 정보가 수정되었습니다.");
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  const openEditProfile = () => {
    if (!myProfile) return;
    setEditName(myProfile.name ?? "");
    setEditPhone(myProfile.phone ?? "");
    setEditEmail(myProfile.email ?? "");
    setEditBirthDate(myProfile.birthDate ?? "");
    setEditEmergencyContact(myProfile.emergencyContact ?? "");
    setShowEditProfile(true);
  };

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
        {isParentAccount && children.length > 1 && (
          <View className="mx-5 mb-4">
            <Text className="text-sm font-semibold text-foreground mb-2">자녀 선택</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {children.map((child) => {
                const active = child.id === selectedChild?.id;
                return (
                  <TouchableOpacity
                    key={child.id}
                    onPress={() => void setSelectedChildId(child.id)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? "#1565C0" : c.border,
                      backgroundColor: active ? "#1565C020" : c.surface,
                    }}
                  >
                    <Text style={{ color: active ? "#1565C0" : c.foreground, fontSize: 13, fontWeight: "800" }}>
                      {child.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {!isManager && (isMyProfileLoading || isLoadingChildren) && (
          <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-5 items-center">
            <Text className="text-muted text-sm">회원 정보를 불러오는 중입니다.</Text>
          </View>
        )}

        {!isManager && !isParentAccount && myProfile && (
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
            <View className="px-4 py-3 border-b border-border flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-foreground">
                {isParentAccount ? "연결된 자녀 정보" : "내 도장 정보"}
              </Text>
              {!isParentAccount && (
                <TouchableOpacity onPress={openEditProfile}>
                  <Text style={{ color: "#1565C0", fontSize: 12, fontWeight: "700" }}>내 정보 수정</Text>
                </TouchableOpacity>
              )}
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
              {myProfile.email && <InfoRow label="이메일" value={myProfile.email} />}
              {myProfile.birthDate && <InfoRow label="생년월일" value={formatDate(myProfile.birthDate)} />}
              {myProfile.emergencyContact && <InfoRow label="비상연락처" value={myProfile.emergencyContact} />}
            </View>
          </View>
        )}

        {!isManager && !isMyProfileLoading && !myProfile && (
          <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-5">
            <Text className="text-sm font-semibold text-foreground mb-1">
              {isParentAccount ? "자녀 연결 대기" : "회원 정보 없음"}
            </Text>
            <Text className="text-muted text-sm">
              {isParentAccount
                ? "학부모 계정은 가입되었습니다. 관리자 앱에서 자녀 회원과 이 계정을 연결하면 자녀 정보가 표시됩니다."
                : "현재 계정에 연결된 회원 정보가 아직 없습니다. 관리자에게 계정 연결을 요청해 주세요."}
            </Text>
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
          <TouchableOpacity
            className="px-4 py-3 flex-row items-center justify-between border-t border-border"
            onPress={() => router.push("/diagnostics" as never)}
          >
            <View className="flex-row items-center gap-2">
              <Text className="text-base">🩺</Text>
              <View>
                <Text className="text-foreground text-sm font-medium">앱 진단</Text>
                <Text className="text-muted text-xs mt-0.5">API, DB, 로그인 상태를 확인합니다</Text>
              </View>
            </View>
            <Text className="text-muted text-xl">›</Text>
          </TouchableOpacity>
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

      <Modal
        visible={showEditProfile}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditProfile(false)}
      >
        <View style={{ flex: 1, backgroundColor: c.background }}>
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 12,
              borderBottomWidth: 0.5,
              borderBottomColor: c.border,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ color: c.foreground, fontSize: 18, fontWeight: "800" }}>내 정보 수정</Text>
            <TouchableOpacity onPress={() => setShowEditProfile(false)}>
              <Text style={{ color: c.primary, fontWeight: "700" }}>닫기</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: spacing.md }}>
            <FormField label="이름" value={editName} onChangeText={setEditName} placeholder="이름" />
            <FormField
              label="연락처"
              value={editPhone}
              onChangeText={(value) => setEditPhone(formatPhoneInput(value))}
              placeholder="010-0000-0000"
              keyboardType="phone-pad"
            />
            <FormField
              label="이메일"
              value={editEmail}
              onChangeText={setEditEmail}
              placeholder="member@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <FormField
              label="생년월일"
              value={editBirthDate}
              onChangeText={(value) => setEditBirthDate(formatDateInput(value))}
              placeholder="YYYY-MM-DD"
              keyboardType="numeric"
              hint="비워두면 생년월일을 저장하지 않습니다."
            />
            <FormField
              label="비상연락처"
              value={editEmergencyContact}
              onChangeText={(value) => setEditEmergencyContact(formatPhoneInput(value))}
              placeholder="보호자 또는 비상연락처"
              keyboardType="phone-pad"
            />
            <PrimaryButton
              label="저장하기"
              loading={updateMyProfileMutation.isPending}
              onPress={() => {
                const birthDate = editBirthDate.trim();
                if (!editName.trim()) {
                  Alert.alert("입력 필요", "이름을 입력해 주세요.");
                  return;
                }
                if (birthDate && !isValidDateInput(birthDate)) {
                  Alert.alert("입력 확인", "생년월일은 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.");
                  return;
                }
                updateMyProfileMutation.mutate({
                  name: editName.trim(),
                  phone: editPhone.trim() || null,
                  email: editEmail.trim() || null,
                  birthDate: birthDate || null,
                  emergencyContact: editEmergencyContact.trim() || null,
                });
              }}
            />
            <GhostButton label="취소" onPress={() => setShowEditProfile(false)} />
          </ScrollView>
        </View>
      </Modal>
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
