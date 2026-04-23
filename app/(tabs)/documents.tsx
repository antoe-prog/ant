import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StatusBadge } from "@/components/onboarding/StatusBadge";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/onboarding-utils";

export default function DocumentsScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const [showSubmit, setShowSubmit] = useState(false);
  const [docName, setDocName] = useState("");

  const { data: plan } = trpc.onboarding.myPlan.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const {
    data: documents,
    isLoading,
    refetch,
  } = trpc.documents.list.useQuery(
    { planId: plan?.id ?? 0 },
    { enabled: !!plan?.id }
  );

  const submitMutation = trpc.documents.submit.useMutation({
    onSuccess: () => {
      setDocName("");
      setShowSubmit(false);
      refetch();
      Alert.alert("제출 완료", "서류가 제출되었습니다. 검토 후 결과를 알려드립니다.");
    },
  });

  const handleSubmit = () => {
    if (!docName.trim()) {
      Alert.alert("오류", "서류 이름을 입력해주세요.");
      return;
    }
    if (!plan?.id) return;
    submitMutation.mutate({ planId: plan.id, name: docName.trim() });
  };

  const getDocIcon = (status: string) => {
    switch (status) {
      case "approved": return "checkmark.circle.fill";
      case "rejected": return "xmark.seal.fill";
      case "under_review": return "hourglass";
      default: return "doc.fill";
    }
  };

  const getDocIconColor = (status: string) => {
    switch (status) {
      case "approved": return "#10B981";
      case "rejected": return "#EF4444";
      case "under_review": return "#F59E0B";
      default: return "#6B7280";
    }
  };

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="p-6">
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: colors.muted }]}>로그인이 필요합니다</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>서류 제출</Text>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setShowSubmit(!showSubmit)}
        >
          <IconSymbol name={showSubmit ? "xmark" : "plus"} size={16} color="#FFFFFF" />
          <Text style={styles.addBtnText}>{showSubmit ? "취소" : "서류 제출"}</Text>
        </TouchableOpacity>
      </View>

      {/* Submit Form */}
      {showSubmit && (
        <View style={[styles.submitForm, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[styles.formLabel, { color: colors.foreground }]}>서류 이름</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            placeholder="예: 주민등록등본, 졸업증명서..."
            placeholderTextColor={colors.muted}
            value={docName}
            onChangeText={setDocName}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          <Text style={[styles.formHint, { color: colors.muted }]}>
            실제 파일은 HR 담당자에게 별도 제출하고, 여기서는 제출 내역을 등록합니다.
          </Text>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: submitMutation.isPending ? 0.7 : 1 }]}
            onPress={handleSubmit}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.submitBtnText}>제출하기</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={documents}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={[styles.infoCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
              <IconSymbol name="info.circle.fill" size={16} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.primary }]}>
                제출된 서류는 HR 담당자가 검토 후 승인/반려 처리합니다
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <IconSymbol name="doc.fill" size={48} color={colors.muted} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>제출된 서류 없음</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                위의 버튼을 눌러 서류를 제출하세요
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.docIcon, { backgroundColor: getDocIconColor(item.status) + "15" }]}>
                <IconSymbol
                  name={getDocIcon(item.status) as any}
                  size={24}
                  color={getDocIconColor(item.status)}
                />
              </View>
              <View style={styles.docInfo}>
                <Text style={[styles.docName, { color: colors.foreground }]}>{item.name}</Text>
                <Text style={[styles.docDate, { color: colors.muted }]}>
                  제출일: {formatDate(item.createdAt)}
                </Text>
                {item.reviewNote && (
                  <Text style={[styles.reviewNote, { color: item.status === "rejected" ? "#EF4444" : colors.muted }]}>
                    검토 의견: {item.reviewNote}
                  </Text>
                )}
              </View>
              <StatusBadge status={item.status} size="sm" />
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  submitForm: {
    padding: 16,
    gap: 10,
    borderBottomWidth: 1,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  formHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  submitBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  submitBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 4,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  docIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  docInfo: {
    flex: 1,
    gap: 3,
  },
  docName: {
    fontSize: 14,
    fontWeight: "600",
  },
  docDate: {
    fontSize: 12,
  },
  reviewNote: {
    fontSize: 12,
    fontStyle: "italic",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
  },
});
