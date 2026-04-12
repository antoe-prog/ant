import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
  BackHandler,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { startOAuthLogin, getApiBaseUrl } from "@/constants/oauth";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";
import { useBackHandler } from "@/hooks/use-back-handler";
import * as Auth from "@/lib/_core/auth";
import * as Api from "@/lib/_core/api";

// ─── 소셜 로그인 헬퍼 ─────────────────────────────────────────────────────────

async function startSocialLogin(provider: "kakao" | "instagram" | "google") {
  const apiBase = getApiBaseUrl();
  const loginUrl = `${apiBase}/api/oauth/${provider}`;

  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.location.href = loginUrl;
    }
    return;
  }

  // 네이티브: 딥링크 콜백 URI를 state로 전달
  const deepLinkCallback = Linking.createURL("/oauth/social-callback");
  const url = `${loginUrl}?state=${encodeURIComponent(deepLinkCallback)}`;
  const supported = await Linking.canOpenURL(url);
  if (supported) {
    await Linking.openURL(url);
  } else {
    Alert.alert("오류", "브라우저를 열 수 없습니다.");
  }
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const colors = useColors();
  const { isAuthenticated, loading, refresh } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);

  // 뒤로가기: 로그인 화면에서 앱 종료 확인
  useBackHandler(() => {
    Alert.alert(
      "앱 종료",
      "앱을 종료하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        { text: "종료", style: "destructive", onPress: () => BackHandler.exitApp() },
      ],
      { cancelable: true },
    );
    return true;
  });

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, loading]);

  // 소셜 OAuth 콜백 딥링크 처리 (네이티브)
  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleUrl = async (event: { url: string }) => {
      const url = event.url;
      if (!url.includes("/oauth/social-callback")) return;

      const parsed = Linking.parse(url);
      const sessionToken = parsed.queryParams?.app_session_id as string;
      const userStr = parsed.queryParams?.user as string;

      if (sessionToken) {
        try {
          await Auth.setSessionToken(sessionToken);
          if (userStr) {
            const user = JSON.parse(decodeURIComponent(userStr));
            await Auth.setUserInfo(user);
          }
          await refresh();
          setSocialLoading(null);
        } catch (err) {
          console.error("[SocialLogin] Callback handling failed", err);
          Alert.alert("로그인 오류", "소셜 로그인 처리 중 오류가 발생했습니다.");
          setSocialLoading(null);
        }
      }
    };

    const subscription = Linking.addEventListener("url", handleUrl);
    return () => subscription.remove();
  }, [refresh]);

  const handleLogin = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setIsLoggingIn(true);
    try {
      await startOAuthLogin();
    } catch (error) {
      console.error("[Login] OAuth login failed:", error);
    } finally {
      if (Platform.OS !== "web") {
        setIsLoggingIn(false);
      }
    }
  };

  const handleSocialLogin = async (provider: "kakao" | "instagram" | "google") => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSocialLoading(provider);
    try {
      await startSocialLogin(provider);
    } catch (error) {
      console.error(`[Login] ${provider} login failed:`, error);
      Alert.alert("오류", `${provider} 로그인에 실패했습니다.`);
      setSocialLoading(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom", "left", "right"]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  const socialProviders: {
    key: "kakao" | "instagram" | "google";
    label: string;
    bg: string;
    textColor: string;
    emoji: string;
  }[] = [
    { key: "kakao", label: "카카오로 시작하기", bg: "#FEE500", textColor: "#191919", emoji: "💬" },
    { key: "instagram", label: "인스타그램으로 시작하기", bg: "#E1306C", textColor: "#FFFFFF", emoji: "📸" },
    { key: "google", label: "구글로 시작하기", bg: "#FFFFFF", textColor: "#3C4043", emoji: "🔍" },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top", "bottom", "left", "right"]}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* 히어로 섹션 */}
        <View style={[styles.heroSection, { backgroundColor: colors.primary }]}>
          <View style={styles.logoContainer}>
            <View style={[styles.logoCircle, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <IconSymbol name="figure.martial.arts" size={48} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.heroTitle}>유도관</Text>
          <Text style={styles.heroSubtitle}>유도 도장 회원 관리 앱</Text>
        </View>

        {/* 컨텐츠 영역 */}
        <View style={styles.contentSection}>
          {/* 기능 소개 */}
          <View style={styles.featureList}>
            {[
              { icon: "person.3.fill", text: "회원 등록 및 관리" },
              { icon: "checkmark.circle.fill", text: "출석 체크 및 이력 조회" },
              { icon: "creditcard.fill", text: "납부 관리 및 만료 알림" },
              { icon: "trophy.fill", text: "승급 심사 및 공지사항" },
            ].map((feature, idx) => (
              <View key={idx} style={styles.featureItem}>
                <View style={[styles.featureIcon, { backgroundColor: colors.primary + "15" }]}>
                  <IconSymbol name={feature.icon as any} size={18} color={colors.primary} />
                </View>
                <Text style={[styles.featureText, { color: colors.foreground }]}>
                  {feature.text}
                </Text>
              </View>
            ))}
          </View>

          {/* 구분선 */}
          <View style={styles.dividerSection}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.muted }]}>소셜 계정으로 시작하기</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          {/* 소셜 로그인 버튼 3개 */}
          <View style={styles.socialButtons}>
            {socialProviders.map((p) => (
              <TouchableOpacity
                key={p.key}
                style={[
                  styles.socialButton,
                  {
                    backgroundColor: p.bg,
                    borderWidth: p.key === "google" ? 1 : 0,
                    borderColor: p.key === "google" ? colors.border : "transparent",
                    opacity: socialLoading && socialLoading !== p.key ? 0.5 : 1,
                  },
                ]}
                onPress={() => handleSocialLogin(p.key)}
                disabled={!!socialLoading || isLoggingIn}
                activeOpacity={0.85}
              >
                {socialLoading === p.key ? (
                  <ActivityIndicator size="small" color={p.textColor} />
                ) : (
                  <Text style={styles.socialButtonEmoji}>{p.emoji}</Text>
                )}
                <Text style={[styles.socialButtonText, { color: p.textColor }]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 구분선 */}
          <View style={styles.dividerSection}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.muted }]}>또는</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          {/* Manus 기본 로그인 버튼 */}
          <TouchableOpacity
            style={[
              styles.loginButton,
              { backgroundColor: colors.primary },
              (isLoggingIn || !!socialLoading) && styles.loginButtonDisabled,
            ]}
            onPress={handleLogin}
            disabled={isLoggingIn || !!socialLoading}
            activeOpacity={0.85}
          >
            {isLoggingIn ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <IconSymbol name="person.crop.circle.fill" size={20} color="#FFFFFF" />
                <Text style={styles.loginButtonText}>Manus로 로그인</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.disclaimer, { color: colors.muted }]}>
            로그인하면 온보딩 프로세스를 시작할 수 있습니다.{"\n"}
            신규 입사자, HR 담당자, 관리자 역할을 지원합니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heroSection: {
    paddingTop: 48,
    paddingBottom: 40,
    alignItems: "center",
    gap: 12,
  },
  logoContainer: {
    marginBottom: 8,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
    fontWeight: "500",
  },
  contentSection: {
    padding: 24,
    paddingBottom: 32,
  },
  featureList: {
    gap: 14,
    marginTop: 4,
    marginBottom: 8,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  dividerSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: "500",
  },
  socialButtons: {
    gap: 10,
  },
  socialButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
  },
  socialButtonEmoji: {
    fontSize: 18,
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  loginButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 15,
    borderRadius: 12,
    marginBottom: 4,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  disclaimer: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 17,
    marginTop: 16,
  },
});
