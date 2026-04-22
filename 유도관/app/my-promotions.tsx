import { useState } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { trpc } from "@/lib/trpc";
import { getBeltColor, getBeltLabel, formatDate } from "@/lib/judo-utils";

const RESULT_LABEL: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: "예정", color: "#F59E0B", icon: "⏳" },
  passed:  { label: "합격", color: "#22C55E", icon: "🏆" },
  failed:  { label: "불합격", color: "#EF4444", icon: "❌" },
};

export default function MyPromotionsScreen() {
  const router = useRouter();
  const { data: promotions, isLoading } = trpc.members.myPromotions.useQuery();

  const pending = promotions?.filter(p => p.result === "pending") ?? [];
  const history = promotions?.filter(p => p.result !== "pending") ?? [];

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>🏅 내 승급심사</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7B3F9E" />
        </View>
      ) : !promotions || promotions.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🥋</Text>
          <Text style={styles.emptyTitle}>등록된 심사 내역이 없습니다</Text>
          <Text style={styles.emptyDesc}>관리자가 심사 일정을 등록하면 여기에 표시됩니다.</Text>
        </View>
      ) : (
        <FlatList
          data={[
            ...(pending.length > 0 ? [{ type: "section", title: "📌 예정된 심사" } as const] : []),
            ...pending.map(p => ({ type: "item", data: p } as const)),
            ...(history.length > 0 ? [{ type: "section", title: "📋 심사 이력" } as const] : []),
            ...history.map(p => ({ type: "item", data: p } as const)),
          ]}
          keyExtractor={(item, idx) => item.type === "section" ? `sec-${idx}` : `item-${(item as any).data.id}`}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          renderItem={({ item }) => {
            if (item.type === "section") {
              return <Text style={styles.sectionTitle}>{item.title}</Text>;
            }
            const p = item.data;
            const res = RESULT_LABEL[p.result] ?? RESULT_LABEL.pending;
            const fromColor = getBeltColor(p.currentBelt);
            const toColor = getBeltColor(p.targetBelt);
            return (
              <View style={styles.card}>
                {/* 날짜 + 결과 */}
                <View style={styles.cardTop}>
                  <Text style={styles.cardDate}>{formatDate(p.examDate)}</Text>
                  <View style={[styles.resultBadge, { backgroundColor: res.color + "20" }]}>
                    <Text style={[styles.resultText, { color: res.color }]}>{res.icon} {res.label}</Text>
                  </View>
                </View>

                {/* 띠 변화 */}
                <View style={styles.beltRow}>
                  <View style={styles.beltItem}>
                    <View style={[styles.beltDot, { backgroundColor: fromColor }]} />
                    <Text style={styles.beltLabel}>{getBeltLabel(p.currentBelt)}띠</Text>
                    <Text style={styles.beltSub}>현재</Text>
                  </View>
                  <Text style={styles.beltArrow}>→</Text>
                  <View style={styles.beltItem}>
                    <View style={[styles.beltDot, { backgroundColor: toColor }]} />
                    <Text style={styles.beltLabel}>{getBeltLabel(p.targetBelt)}띠</Text>
                    <Text style={styles.beltSub}>목표</Text>
                  </View>
                </View>

                {/* 메모 */}
                {p.notes ? (
                  <Text style={styles.notes}>📝 {p.notes}</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E7EB",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 28, color: "#1565C0", fontWeight: "300" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#11181C" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#11181C", marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: "#687076", textAlign: "center" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#687076", marginTop: 8, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  card: {
    backgroundColor: "#F5F5F5",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  cardDate: { fontSize: 14, fontWeight: "600", color: "#11181C" },
  resultBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  resultText: { fontSize: 13, fontWeight: "700" },
  beltRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 8 },
  beltItem: { alignItems: "center", gap: 4 },
  beltDot: { width: 32, height: 32, borderRadius: 16 },
  beltLabel: { fontSize: 13, fontWeight: "600", color: "#11181C" },
  beltSub: { fontSize: 11, color: "#687076" },
  beltArrow: { fontSize: 20, color: "#9BA1A6", fontWeight: "300" },
  notes: { fontSize: 12, color: "#687076", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
});
