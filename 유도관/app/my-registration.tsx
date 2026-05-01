import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { useSemanticColors } from "@/components/ui/primitives";
import { trpc } from "@/lib/trpc";
import { formatAmount, formatDate } from "@/lib/judo-utils";
import { useSelectedChild } from "@/hooks/use-selected-child";

const METHOD_LABEL: Record<string, string> = {
  cash: "현금",
  card: "카드",
  transfer: "계좌이체",
};

function getDday(dateStr: string | null | undefined): { label: string; color: string } | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `D+${Math.abs(diff)} 만료`, color: "#EF4444" };
  if (diff === 0) return { label: "D-Day (오늘 만료)", color: "#EF4444" };
  if (diff <= 7) return { label: `D-${diff} (곧 만료)`, color: "#F59E0B" };
  return { label: `D-${diff}`, color: "#22C55E" };
}

export default function MyRegistrationScreen() {
  const c = useSemanticColors();
  const { isParent, children, selectedChild, selectedChildId, selectedMemberInput, setSelectedChildId } = useSelectedChild();
  const { data: profile } = trpc.members.myProfile.useQuery(selectedMemberInput, {
    enabled: !isParent || !!selectedChildId,
  });
  const { data: payments, isLoading } = trpc.members.myPayments.useQuery(selectedMemberInput, {
    enabled: !isParent || !!selectedChildId,
  });

  const dday = getDday(profile?.nextPaymentDate);
  const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0;
  const currentPeriod = payments?.find((p) => p.periodStart && p.periodEnd);

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.foreground }]}>📅 등록기간</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={payments ?? []}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          ListHeaderComponent={
            <>
              {isParent && children.length > 1 && (
                <View style={styles.childTabs}>
                  <Text style={[styles.childTabsTitle, { color: c.foreground }]}>자녀 선택</Text>
                  <View style={styles.childTabsRow}>
                    {children.map((child) => {
                      const active = child.id === selectedChild?.id;
                      return (
                        <TouchableOpacity
                          key={child.id}
                          style={[
                            styles.childTab,
                            {
                              borderColor: active ? c.primary : c.border,
                              backgroundColor: active ? c.primary + "18" : c.surface,
                            },
                          ]}
                          onPress={() => void setSelectedChildId(child.id)}
                        >
                          <Text style={[styles.childTabText, { color: active ? c.primary : c.foreground }]}>
                            {child.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* 등록 현황 카드 */}
              <View style={[styles.statusCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.statusTitle, { color: c.primary }]}>현재 등록 현황</Text>

                <View style={[styles.statusRow, { borderBottomColor: c.border }]}>
                  <Text style={[styles.statusLabel, { color: c.muted }]}>월 회비</Text>
                  <Text style={[styles.statusValue, { color: c.foreground }]}>{formatAmount(profile?.monthlyFee ?? 0)}</Text>
                </View>

                {profile?.nextPaymentDate && (
                  <View style={[styles.statusRow, { borderBottomColor: c.border }]}>
                    <Text style={[styles.statusLabel, { color: c.muted }]}>다음 납부일</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={[styles.statusValue, { color: c.foreground }]}>{formatDate(profile.nextPaymentDate)}</Text>
                      {dday && (
                        <View style={[styles.ddayBadge, { backgroundColor: dday.color + "20" }]}>
                          <Text style={[styles.ddayText, { color: dday.color }]}>{dday.label}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {currentPeriod?.periodStart && currentPeriod?.periodEnd && (
                  <View style={[styles.statusRow, { borderBottomColor: c.border }]}>
                    <Text style={[styles.statusLabel, { color: c.muted }]}>현재 등록기간</Text>
                    <Text style={[styles.statusValue, { color: c.foreground }]}>
                      {formatDate(currentPeriod.periodStart)} ~ {formatDate(currentPeriod.periodEnd)}
                    </Text>
                  </View>
                )}

                <View style={[styles.statusRow, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.statusLabel, { color: c.muted }]}>총 납부 금액</Text>
                  <Text style={[styles.statusValue, { color: c.primary, fontWeight: "700" }]}>{formatAmount(totalPaid)}</Text>
                </View>
              </View>

              {/* 경고 배너 */}
              {dday && dday.color === "#EF4444" && (
                <View style={styles.warningBanner}>
                  <Text style={styles.warningText}>⚠️ 납부 기한이 지났거나 오늘 만료됩니다. 관리자에게 문의해 주세요.</Text>
                </View>
              )}
              {dday && dday.color === "#F59E0B" && (
                <View style={[styles.warningBanner, { backgroundColor: "#FEF3C7" }]}>
                  <Text style={[styles.warningText, { color: "#92400E" }]}>💡 납부 기한이 7일 이내입니다.</Text>
                </View>
              )}

              {/* 납부 이력 헤더 */}
              <Text style={[styles.sectionTitle, { color: c.muted }]}>납부 이력</Text>
              {(!payments || payments.length === 0) && (
                <View style={styles.emptyBox}>
                  <Text style={[styles.emptyText, { color: c.muted }]}>납부 이력이 없습니다.</Text>
                </View>
              )}
            </>
          }
          renderItem={({ item }) => (
            <View style={[styles.paymentCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.paymentTop}>
                <Text style={[styles.paymentDate, { color: c.muted }]}>{formatDate(String(item.paidAt))}</Text>
                <Text style={[styles.paymentAmount, { color: c.primary }]}>{formatAmount(Number(item.amount))}</Text>
              </View>
              <View style={styles.paymentBottom}>
                <View style={styles.methodBadge}>
                  <Text style={styles.methodText}>{METHOD_LABEL[item.method] ?? item.method}</Text>
                </View>
                {item.periodStart && item.periodEnd && (
                  <Text style={[styles.periodText, { color: c.muted }]}>
                    {formatDate(item.periodStart)} ~ {formatDate(item.periodEnd)}
                  </Text>
                )}
              </View>
              {item.notes ? <Text style={[styles.paymentNotes, { color: c.muted }]}>📝 {item.notes}</Text> : null}
            </View>
          )}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  childTabs: { marginBottom: 12 },
  childTabsTitle: { fontSize: 14, fontWeight: "800", marginBottom: 8 },
  childTabsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  childTab: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  childTabText: { fontSize: 13, fontWeight: "800" },
  statusCard: {
    backgroundColor: "#EFF6FF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  statusTitle: { fontSize: 14, fontWeight: "700", color: "#1565C0", marginBottom: 12 },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#DBEAFE",
  },
  statusLabel: { fontSize: 13, color: "#687076" },
  statusValue: { fontSize: 14, fontWeight: "600", color: "#11181C" },
  ddayBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  ddayText: { fontSize: 12, fontWeight: "700" },
  warningBanner: {
    backgroundColor: "#FEE2E2",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  warningText: { fontSize: 13, color: "#991B1B", fontWeight: "500" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#687076", marginBottom: 10, marginTop: 4 },
  emptyBox: { alignItems: "center", padding: 24 },
  emptyText: { fontSize: 14, color: "#9BA1A6" },
  paymentCard: {
    backgroundColor: "#F5F5F5",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  paymentTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  paymentDate: { fontSize: 13, color: "#687076" },
  paymentAmount: { fontSize: 16, fontWeight: "700", color: "#1565C0" },
  paymentBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  methodBadge: { backgroundColor: "#1565C020", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  methodText: { fontSize: 12, color: "#1565C0", fontWeight: "600" },
  periodText: { fontSize: 12, color: "#687076" },
  paymentNotes: { fontSize: 12, color: "#9BA1A6", marginTop: 6 },
});
