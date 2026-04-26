import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useBackHandler } from "@/hooks/use-back-handler";

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "login_required">("loading");
  const [acceptedToken, setAcceptedToken] = useState<string | null>(null);

  // 뒤로가기: 홈으로 이동
  useBackHandler(() => { router.replace("/(tabs)"); return true; });
  const [errorMessage, setErrorMessage] = useState("");
  const [linkedMemberId, setLinkedMemberId] = useState<number | null>(null);

  const acceptMutation = trpc.admin.acceptInvite.useMutation({
    onSuccess: (data) => {
      setLinkedMemberId(data.memberId ?? null);
      setStatus("success");
    },
    onError: (e) => {
      setErrorMessage(e.message);
      setStatus("error");
    },
  });

  useEffect(() => {
    if (!token) {
      setErrorMessage("유효하지 않은 초대 링크입니다.");
      setStatus("error");
      return;
    }
    if (!isAuthenticated) {
      setStatus("login_required");
      return;
    }
    // 로그인된 상태면 바로 수락
    if (acceptedToken === token) return;
    setAcceptedToken(token);
    acceptMutation.mutate({ token });
  }, [token, isAuthenticated, acceptedToken, acceptMutation]);

  const handleLogin = () => {
    // 로그인 후 돌아올 수 있도록 토큰을 저장하고 로그인 화면으로 이동
    const redirectTo =
      typeof token === "string" && token ? `/invite?token=${encodeURIComponent(token)}` : "/invite";
    router.push({ pathname: "/login", params: { redirectTo } });
  };

  const handleGoHome = () => {
    router.replace("/(tabs)");
  };

  return (
    <ScreenContainer className="items-center justify-center p-6">
      {status === "loading" && (
        <View className="items-center gap-4">
          <ActivityIndicator size="large" color="#1565C0" />
          <Text className="text-foreground text-base font-medium">초대 링크 처리 중...</Text>
          <Text className="text-muted text-sm text-center">잠시만 기다려 주세요.</Text>
        </View>
      )}

      {status === "login_required" && (
        <View className="items-center gap-4">
          <Text className="text-5xl mb-2">🔐</Text>
          <Text className="text-xl font-bold text-foreground">로그인이 필요합니다</Text>
          <Text className="text-muted text-sm text-center">
            초대 링크를 수락하려면 먼저 로그인해 주세요.{"\n"}
            로그인 후 초대가 자동으로 처리됩니다.
          </Text>
          <TouchableOpacity
            className="mt-4 px-8 py-3 rounded-full"
            style={{ backgroundColor: "#1565C0" }}
            onPress={handleLogin}
          >
            <Text className="text-white font-semibold text-base">로그인하기</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === "success" && (
        <View className="items-center gap-4">
          <Text className="text-5xl mb-2">🎉</Text>
          <Text className="text-xl font-bold text-foreground">초대 수락 완료!</Text>
          <Text className="text-muted text-sm text-center">
            {linkedMemberId
              ? "회원 계정이 성공적으로 연결되었습니다.\n이제 앱에서 내 현황을 확인할 수 있습니다."
              : "초대가 수락되었습니다.\n관리자가 회원 정보를 연결해 드릴 예정입니다."}
          </Text>
          <View className="bg-surface rounded-2xl p-4 border border-border w-full mt-2">
            <Text className="text-foreground text-sm text-center">
              ✅ 계정 연결 완료{"\n"}
              <Text className="text-muted text-xs">홈 화면에서 내 정보를 확인하세요</Text>
            </Text>
          </View>
          <TouchableOpacity
            className="mt-4 px-8 py-3 rounded-full"
            style={{ backgroundColor: "#1565C0" }}
            onPress={handleGoHome}
          >
            <Text className="text-white font-semibold text-base">홈으로 이동</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === "error" && (
        <View className="items-center gap-4">
          <Text className="text-5xl mb-2">❌</Text>
          <Text className="text-xl font-bold text-foreground">초대 수락 실패</Text>
          <Text className="text-muted text-sm text-center">{errorMessage}</Text>
          <View className="bg-error/10 rounded-2xl p-4 border border-error/20 w-full mt-2">
            <Text className="text-error text-sm text-center">
              {errorMessage.includes("만료") ? "⏰ 초대 링크가 만료되었습니다.\n관리자에게 새 초대 링크를 요청하세요." :
               errorMessage.includes("사용") ? "🔒 이미 사용된 초대 링크입니다." :
               "관리자에게 문의하거나 새 초대 링크를 요청하세요."}
            </Text>
          </View>
          <TouchableOpacity
            className="mt-4 px-8 py-3 rounded-full bg-surface border border-border"
            onPress={handleGoHome}
          >
            <Text className="text-foreground font-semibold text-base">홈으로 이동</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScreenContainer>
  );
}
