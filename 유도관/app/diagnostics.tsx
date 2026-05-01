import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Constants from "expo-constants";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { APP_VARIANT, APP_VARIANT_LABEL } from "@/constants/app-variant";
import { getApiBaseUrl } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";
import * as Auth from "@/lib/_core/auth";
import { getFriendlyErrorMessage } from "@/lib/error-messages";

type HealthState =
  | { status: "idle" | "loading" }
  | {
      status: "ok";
      timestamp?: number;
      envOk?: boolean;
      missing?: string[];
      invalid?: { key: string; reason: string }[];
    }
  | { status: "error"; message: string };

export default function DiagnosticsScreen() {
  const { user, isAuthenticated } = useAuth();
  const [health, setHealth] = useState<HealthState>({ status: "idle" });
  const [tokenState, setTokenState] = useState<"확인 중" | "있음" | "없음" | "웹 쿠키 사용" | "확인 실패">("확인 중");
  const [storedUserState, setStoredUserState] = useState("확인 중");
  const apiBaseUrl = getApiBaseUrl();

  const runDiagnostics = async () => {
    setHealth({ status: "loading" });
    try {
      const [token, storedUser, response] = await Promise.all([
        Auth.getSessionToken(),
        Auth.getUserInfo(),
        fetch(`${apiBaseUrl}/api/health`, { headers: { Accept: "application/json" } }),
      ]);

      setTokenState(Platform.OS === "web" ? "웹 쿠키 사용" : token ? "있음" : "없음");
      setStoredUserState(storedUser ? `${storedUser.name ?? "이름 없음"} / ${storedUser.role ?? "권한 없음"}` : "없음");

      if (!response.ok) {
        setHealth({ status: "error", message: `HTTP ${response.status}` });
        return;
      }

      const body = await response.json();
      setHealth({
        status: "ok",
        timestamp: body?.timestamp,
        envOk: body?.env?.ok,
        missing: body?.env?.missing ?? [],
        invalid: body?.env?.invalid ?? [],
      });
    } catch (error) {
      setHealth({ status: "error", message: getFriendlyErrorMessage(error) });
      if (tokenState === "확인 중") {
        setTokenState(Platform.OS === "web" ? "웹 쿠키 사용" : "확인 실패");
      }
      if (storedUserState === "확인 중") {
        setStoredUserState("확인 실패");
      }
    }
  };

  useEffect(() => {
    void runDiagnostics();
  }, []);

  const healthLabel =
    health.status === "loading"
      ? "확인 중"
      : health.status === "ok"
        ? health.envOk === false
          ? "환경변수 확인 필요"
          : "정상"
        : health.status === "error"
          ? "연결 실패"
          : "대기";

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>앱 진단</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>현장 연결 상태 점검</Text>
          <Text style={styles.heroSub}>
            네트워크 오류가 날 때 API, DB, 인증 상태를 한 화면에서 확인합니다.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, health.status === "loading" && styles.primaryButtonDisabled]}
            onPress={() => void runDiagnostics()}
            disabled={health.status === "loading"}
          >
            {health.status === "loading" ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>다시 검사</Text>
            )}
          </TouchableOpacity>
        </View>

        <Section title="앱 정보">
          <InfoRow label="앱 종류" value={`${APP_VARIANT_LABEL} (${APP_VARIANT})`} />
          <InfoRow label="플랫폼" value={Platform.OS} />
          <InfoRow label="앱 버전" value={Constants.expoConfig?.version ?? "개발 빌드"} />
          <InfoRow label="API 주소" value={apiBaseUrl} mono />
        </Section>

        <Section title="로그인/인증">
          <InfoRow label="로그인 상태" value={isAuthenticated ? "로그인됨" : "로그아웃"} tone={isAuthenticated ? "good" : "warn"} />
          <InfoRow label="현재 계정" value={user ? `${user.name ?? "이름 없음"} / ${user.role ?? "권한 없음"}` : "-"} />
          <InfoRow label="저장 토큰" value={tokenState} tone={tokenState === "없음" ? "warn" : "good"} />
          <InfoRow label="저장 사용자" value={storedUserState} />
        </Section>

        <Section title="서버/DB">
          <InfoRow label="Health" value={healthLabel} tone={health.status === "ok" && health.envOk !== false ? "good" : "warn"} />
          {health.status === "ok" ? (
            <>
              <InfoRow label="환경변수" value={health.envOk === false ? "확인 필요" : "정상"} tone={health.envOk === false ? "warn" : "good"} />
              {health.missing && health.missing.length > 0 ? (
                <InfoRow label="누락" value={health.missing.join(", ")} tone="bad" />
              ) : null}
              {health.invalid && health.invalid.length > 0 ? (
                <InfoRow
                  label="오류"
                  value={health.invalid.map((item) => `${item.key}(${item.reason})`).join(", ")}
                  tone="bad"
                />
              ) : null}
            </>
          ) : null}
          {health.status === "error" ? <InfoRow label="오류" value={health.message} tone="bad" /> : null}
        </Section>

        <View style={styles.helpBox}>
          <Text style={styles.helpTitle}>문제가 보이면 이렇게 확인하세요</Text>
          <Text style={styles.helpText}>API 주소가 `https://api.judokan.store`인지 확인합니다.</Text>
          <Text style={styles.helpText}>Health가 실패하면 서버 또는 Cloudflare 터널을 먼저 확인합니다.</Text>
          <Text style={styles.helpText}>환경변수가 확인 필요이면 서버의 `.env`와 MySQL 연결을 확인합니다.</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function InfoRow({
  label,
  mono,
  tone,
  value,
}: {
  label: string;
  mono?: boolean;
  tone?: "good" | "warn" | "bad";
  value: string;
}) {
  const color = tone === "good" ? "#15803D" : tone === "bad" ? "#B3261E" : tone === "warn" ? "#B45309" : "#111827";
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, { color }, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  headerTitle: {
    color: "#111827",
    fontSize: 17,
    fontWeight: "900",
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    gap: 14,
    padding: 20,
    paddingBottom: 36,
  },
  heroCard: {
    backgroundColor: "#EAF3FF",
    borderColor: "#BBD8FF",
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  heroTitle: {
    color: "#0B3D78",
    fontSize: 20,
    fontWeight: "900",
  },
  heroSub: {
    color: "#385A7C",
    fontSize: 13,
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#1565C0",
    borderRadius: 999,
    marginTop: 4,
    minWidth: 104,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    color: "#4B5563",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 2,
  },
  sectionBody: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E5E7EB",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  infoRow: {
    borderBottomColor: "#EEF2F7",
    borderBottomWidth: 1,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  infoLabel: {
    color: "#6B7280",
    fontSize: 12,
    fontWeight: "700",
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 12,
  },
  helpBox: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FED7AA",
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  helpTitle: {
    color: "#9A3412",
    fontSize: 14,
    fontWeight: "900",
  },
  helpText: {
    color: "#9A3412",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
});
