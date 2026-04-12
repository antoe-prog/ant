/**
 * 소셜 로그인 콜백 화면 (네이티브 딥링크)
 *
 * 카카오/인스타그램/구글 OAuth 완료 후 서버가 세션 토큰을 딥링크 파라미터로 전달하면
 * 이 화면에서 토큰을 저장하고 홈으로 이동합니다.
 *
 * 딥링크 예시:
 *   manus20260403001927://oauth/social-callback?app_session_id=TOKEN&user=JSON
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Auth from "@/lib/_core/auth";

export default function SocialCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    app_session_id?: string;
    user?: string;
    error?: string;
  }>();

  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handle = async () => {
      try {
        // 에러 파라미터 체크
        if (params.error) {
          setStatus("error");
          setErrorMessage(params.error);
          return;
        }

        const sessionToken = params.app_session_id;
        if (!sessionToken) {
          setStatus("error");
          setErrorMessage("세션 토큰이 없습니다.");
          return;
        }

        // 세션 토큰 저장
        await Auth.setSessionToken(sessionToken);

        // 유저 정보 저장 (있는 경우)
        if (params.user) {
          try {
            const userData = JSON.parse(decodeURIComponent(params.user));
            const userInfo: Auth.User = {
              id: userData.id,
              openId: userData.openId,
              name: userData.name,
              email: userData.email,
              loginMethod: userData.loginMethod,
              lastSignedIn: new Date(userData.lastSignedIn || Date.now()),
            };
            await Auth.setUserInfo(userInfo);
          } catch (e) {
            console.warn("[SocialCallback] Failed to parse user info:", e);
          }
        }

        setStatus("success");
        setTimeout(() => {
          router.replace("/(tabs)");
        }, 800);
      } catch (err) {
        console.error("[SocialCallback] Error:", err);
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "로그인 처리 중 오류가 발생했습니다.");
      }
    };

    handle();
  }, [params.app_session_id, params.user, params.error, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }} edges={["top", "bottom", "left", "right"]}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
        {status === "processing" && (
          <>
            <ActivityIndicator size="large" color="#1565C0" />
            <Text style={{ fontSize: 16, color: "#11181C", textAlign: "center" }}>
              로그인 처리 중...
            </Text>
          </>
        )}
        {status === "success" && (
          <>
            <Text style={{ fontSize: 40 }}>✅</Text>
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#11181C" }}>
              로그인 성공!
            </Text>
            <Text style={{ fontSize: 14, color: "#687076" }}>잠시 후 이동합니다...</Text>
          </>
        )}
        {status === "error" && (
          <>
            <Text style={{ fontSize: 40 }}>❌</Text>
            <Text style={{ fontSize: 18, fontWeight: "700", color: "#EF4444" }}>
              로그인 실패
            </Text>
            <Text style={{ fontSize: 14, color: "#687076", textAlign: "center" }}>
              {errorMessage}
            </Text>
            <Text
              style={{ fontSize: 14, color: "#1565C0", marginTop: 8 }}
              onPress={() => router.replace("/login")}
            >
              다시 시도하기
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
