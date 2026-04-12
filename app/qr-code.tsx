"use client";
import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { getBeltColor, getBeltLabel } from "@/lib/judo-utils";
import { useBackHandler } from "@/hooks/use-back-handler";

// react-native-qrcode-svg는 웹에서 지원 안 될 수 있으므로 Platform 분기
let QRCode: React.ComponentType<{ value: string; size: number; color?: string; backgroundColor?: string }> | null = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  QRCode = require("react-native-qrcode-svg").default;
}

export default function QrCodeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [showFull, setShowFull] = useState(false);

  useBackHandler(() => {
    router.back();
    return true;
  });

  const { data: myProfile, isLoading } = trpc.members.myProfile.useQuery(undefined, {
    enabled: !!user,
  });

  // QR 코드에 인코딩할 데이터: 회원 ID + 이름 + 타임스탬프(분 단위, 재사용 방지)
  const qrPayload = myProfile
    ? JSON.stringify({
        memberId: myProfile.id,
        name: myProfile.name,
        // 5분 단위 타임스탬프 (스캔 유효 시간 제한)
        t: Math.floor(Date.now() / (5 * 60 * 1000)),
      })
    : "";

  const beltColor = myProfile ? getBeltColor(myProfile.beltRank) : "#1565C0";
  const beltLabel = myProfile ? getBeltLabel(myProfile.beltRank) : "";

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>내 QR 출석증</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingBox}>
            <Text style={styles.loadingText}>불러오는 중...</Text>
          </View>
        ) : !myProfile ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🥋</Text>
            <Text style={styles.emptyTitle}>회원 정보 없음</Text>
            <Text style={styles.emptyDesc}>
              관리자에게 회원 계정 연결을 요청하세요.{"\n"}
              연결 후 QR 코드를 사용할 수 있습니다.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {/* 회원 정보 */}
            <View style={[styles.memberBadge, { backgroundColor: beltColor + "20" }]}>
              <View style={[styles.beltDot, { backgroundColor: beltColor }]} />
              <Text style={[styles.beltText, { color: beltColor }]}>
                {beltLabel} {myProfile.beltDegree}단 · {myProfile.name}
              </Text>
            </View>

            {/* QR 코드 */}
            <View style={styles.qrWrapper}>
              {Platform.OS === "web" ? (
                <View style={styles.webQrFallback}>
                  <Text style={styles.webQrIcon}>📱</Text>
                  <Text style={styles.webQrText}>QR 코드는{"\n"}모바일 앱에서 확인하세요</Text>
                  <View style={styles.webQrIdBox}>
                    <Text style={styles.webQrIdLabel}>회원 번호</Text>
                    <Text style={styles.webQrIdValue}>#{myProfile.id}</Text>
                  </View>
                </View>
              ) : QRCode ? (
                <QRCode
                  value={qrPayload}
                  size={showFull ? 260 : 220}
                  color="#1a1a2e"
                  backgroundColor="#FFFFFF"
                />
              ) : null}
            </View>

            {/* 안내 */}
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>📌 QR 코드 사용법</Text>
              <Text style={styles.infoText}>
                관리자에게 이 화면을 보여주세요.{"\n"}
                스캔 후 오늘 출석이 자동으로 기록됩니다.
              </Text>
            </View>

            {/* 회원 ID 표시 */}
            <View style={styles.idRow}>
              <Text style={styles.idLabel}>회원 번호</Text>
              <Text style={styles.idValue}>#{myProfile.id}</Text>
            </View>
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  backBtn: {
    color: "#1565C0",
    fontSize: 15,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#11181C",
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  loadingBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  loadingText: {
    color: "#687076",
    fontSize: 15,
  },
  emptyBox: {
    alignItems: "center",
    padding: 32,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#11181C",
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: "#687076",
    textAlign: "center",
    lineHeight: 22,
  },
  card: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    gap: 20,
  },
  memberBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  beltDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  beltText: {
    fontSize: 14,
    fontWeight: "600",
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },
  webQrFallback: {
    alignItems: "center",
    padding: 24,
    gap: 12,
  },
  webQrIcon: {
    fontSize: 48,
  },
  webQrText: {
    fontSize: 14,
    color: "#687076",
    textAlign: "center",
    lineHeight: 22,
  },
  webQrIdBox: {
    marginTop: 8,
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: "center",
  },
  webQrIdLabel: {
    fontSize: 11,
    color: "#687076",
    marginBottom: 4,
  },
  webQrIdValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1565C0",
  },
  infoBox: {
    width: "100%",
    backgroundColor: "#E3F2FD",
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1565C0",
  },
  infoText: {
    fontSize: 12,
    color: "#1565C0",
    lineHeight: 20,
  },
  idRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 4,
  },
  idLabel: {
    fontSize: 13,
    color: "#687076",
  },
  idValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1565C0",
  },
});
