import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
  BackHandler,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";
import { useBackHandler } from "@/hooks/use-back-handler";
import * as Auth from "@/lib/_core/auth";
import { mirrorAuthToGateway } from "@/lib/_core/gateway-auth";
import { trpc } from "@/lib/trpc";

type Mode = "login" | "register";

export default function LoginScreen() {
  const colors = useColors();
  const { isAuthenticated, loading, refresh } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loginMutation = trpc.auth.login.useMutation();
  const registerMutation = trpc.auth.register.useMutation();

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

  const submitting = loginMutation.isPending || registerMutation.isPending;

  const handleSubmit = async () => {
    setErrorMsg(null);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim || !password) {
      setErrorMsg("이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    if (password.length < 8) {
      setErrorMsg("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (mode === "register" && !name.trim()) {
      setErrorMsg("이름을 입력해 주세요.");
      return;
    }

    try {
      const result =
        mode === "login"
          ? await loginMutation.mutateAsync({ email: emailTrim, password })
          : await registerMutation.mutateAsync({
              email: emailTrim,
              password,
              name: name.trim(),
            });

      if (Platform.OS !== "web" && result.app_session_id) {
        await Auth.setSessionToken(result.app_session_id);
      }
      if (result.user) {
        await Auth.setUserInfo({
          id: result.user.id,
          openId: result.user.openId,
          name: result.user.name ?? null,
          email: result.user.email ?? null,
          loginMethod: result.user.loginMethod ?? "email",
          role: (result.user.role as "member" | "manager" | "admin") ?? "member",
          avatarUrl: null,
          lastSignedIn: new Date(),
        });
      }

      // GenAI Gateway(admin-web)와 계정을 미러링한다. 실패해도 유도관 로그인은 그대로.
      void mirrorAuthToGateway({
        email: emailTrim,
        password,
        name: name.trim() || result.user?.name || undefined,
        mode,
      });

      await refresh();
      router.replace("/(tabs)");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "로그인에 실패했습니다.";
      setErrorMsg(message);
    }
  };

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={["top", "bottom", "left", "right"]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top", "bottom", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.heroSection, { backgroundColor: colors.primary }]}>
            <View style={styles.logoContainer}>
              <View style={[styles.logoCircle, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                <IconSymbol name="figure.martial.arts" size={48} color="#FFFFFF" />
              </View>
            </View>
            <Text style={styles.heroTitle}>유도관</Text>
            <Text style={styles.heroSubtitle}>유도 도장 회원 관리 앱</Text>
          </View>

          <View style={styles.contentSection}>
            <View style={[styles.tabRow, { backgroundColor: colors.border + "33" }]}>
              <TouchableOpacity
                style={[
                  styles.tabButton,
                  mode === "login" && { backgroundColor: colors.background },
                ]}
                onPress={() => {
                  setMode("login");
                  setErrorMsg(null);
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: mode === "login" ? colors.foreground : colors.muted },
                  ]}
                >
                  로그인
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.tabButton,
                  mode === "register" && { backgroundColor: colors.background },
                ]}
                onPress={() => {
                  setMode("register");
                  setErrorMsg(null);
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: mode === "register" ? colors.foreground : colors.muted },
                  ]}
                >
                  회원가입
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "register" && (
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.foreground }]}>이름</Text>
                <TextInput
                  style={[
                    styles.input,
                    { borderColor: colors.border, color: colors.foreground },
                  ]}
                  placeholder="홍길동"
                  placeholderTextColor={colors.muted}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.foreground }]}>이메일</Text>
              <TextInput
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.foreground },
                ]}
                placeholder="you@example.com"
                placeholderTextColor={colors.muted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.foreground }]}>비밀번호</Text>
              <TextInput
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.foreground },
                ]}
                placeholder="8자 이상"
                placeholderTextColor={colors.muted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>

            {errorMsg ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.submitButton,
                { backgroundColor: colors.primary },
                submitting && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {mode === "login" ? "로그인" : "가입하고 시작하기"}
                </Text>
              )}
            </TouchableOpacity>

            <Text style={[styles.disclaimer, { color: colors.muted }]}>
              {mode === "login"
                ? "계정이 없다면 회원가입 탭으로 전환해 주세요."
                : "가입 즉시 로그인되며, 비밀번호는 안전하게 해시되어 저장됩니다."}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  tabRow: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "700",
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  errorBox: {
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: "#991b1b",
    fontSize: 13,
    lineHeight: 18,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    borderRadius: 12,
    marginTop: 4,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
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
