import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  FlatList,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { formatDate, getBeltColor, getBeltLabel } from "@/lib/judo-utils";
import { useBackHandler, useModalBackHandler } from "@/hooks/use-back-handler";
import { idKeyExtractor, listPerfProps } from "@/lib/list-utils";
import {
  Card,
  Chip,
  EmptyState,
  FormField,
  GhostButton,
  LoadingView,
  PrimaryButton,
  SectionHeader,
  radius,
  spacing,
  useSemanticColors,
} from "@/components/ui/primitives";

const STATUS_OPTIONS = ["upcoming", "ongoing", "completed", "cancelled"] as const;
const RESULT_OPTIONS = ["pending", "participated", "gold", "silver", "bronze", "absent"] as const;
type Status = (typeof STATUS_OPTIONS)[number];
type Result = (typeof RESULT_OPTIONS)[number];

const STATUS_LABEL: Record<Status, string> = {
  upcoming: "예정",
  ongoing: "진행중",
  completed: "종료",
  cancelled: "취소",
};
const RESULT_LABEL: Record<Result, string> = {
  pending: "예정",
  participated: "참가",
  gold: "🥇 금",
  silver: "🥈 은",
  bronze: "🥉 동",
  absent: "불참",
};
const RESULT_COLOR: Record<Result, string> = {
  pending: "#64748B",
  participated: "#0EA5E9",
  gold: "#B45309",
  silver: "#64748B",
  bronze: "#A16207",
  absent: "#DC2626",
};

export default function TournamentDetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id?: string }>();
  const id = idParam ? Number(idParam) : 0;
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const utils = trpc.useUtils();
  const c = useSemanticColors();

  useBackHandler(() => {
    router.back();
    return true;
  });

  const { data, isLoading } = trpc.tournaments.byId.useQuery(
    { id },
    { enabled: id > 0 && isManager },
  );

  // 회원(또는 역할 확인 전)도 공개 정보 + 본인 참가 내역을 볼 수 있다.
  const { data: memberView, isLoading: memberLoading } = trpc.tournaments.publicInfo.useQuery(
    { id },
    { enabled: id > 0 && !isManager },
  );

  // 참가자 등록용 회원 목록 (관리자 전용)
  const { data: members } = trpc.members.list.useQuery(undefined, { enabled: isManager });

  const [showPicker, setShowPicker] = useState(false);
  useModalBackHandler(showPicker, () => setShowPicker(false));
  const [weightClass, setWeightClass] = useState("");
  const [division, setDivision] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");

  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  const [editingResult, setEditingResult] = useState<Result>("pending");
  useModalBackHandler(editingMemberId != null, () => setEditingMemberId(null));

  const invalidate = () => {
    void utils.tournaments.byId.invalidate({ id });
    void utils.tournaments.list.invalidate();
    void utils.tournaments.upcoming.invalidate();
  };

  const registerMutation = trpc.tournaments.registerParticipant.useMutation({
    onSuccess: () => {
      invalidate();
      setShowPicker(false);
      setWeightClass("");
      setDivision("");
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const updateResultMutation = trpc.tournaments.updateParticipantResult.useMutation({
    onSuccess: () => {
      invalidate();
      setEditingMemberId(null);
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const removeMutation = trpc.tournaments.removeParticipant.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => Alert.alert("오류", e.message),
  });

  const updateTournamentMutation = trpc.tournaments.update.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => Alert.alert("오류", e.message),
  });

  const deleteTournamentMutation = trpc.tournaments.delete.useMutation({
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const participantIds = useMemo(
    () => new Set((data?.participants ?? []).map((p) => p.memberId)),
    [data?.participants],
  );

  const availableMembers = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return (members ?? []).filter((m) => {
      if (participantIds.has(m.id)) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q);
    });
  }, [members, participantIds, pickerSearch]);

  if (!isManager) {
    if (memberLoading || !memberView) {
      return (
        <ScreenContainer>
          <Header title="대회 상세" />
          <LoadingView />
        </ScreenContainer>
      );
    }
    const status = (memberView.status ?? "upcoming") as Status;
    const myResult = (memberView.myEntry?.result ?? null) as Result | null;
    return (
      <ScreenContainer>
        <Header title="대회 상세" />
        <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }}>
          <View style={{ padding: 20, gap: 8 }}>
            <Text style={{ fontSize: 22, fontWeight: "800", color: "#0F172A" }}>{memberView.title}</Text>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Text style={{ color: "#475569" }}>📅 {formatDate(memberView.eventDate)}</Text>
              {memberView.location ? <Text style={{ color: "#475569" }}>📍 {memberView.location}</Text> : null}
              {memberView.registrationDeadline ? (
                <Text style={{ color: "#475569" }}>⏰ 신청 {formatDate(memberView.registrationDeadline)} 까지</Text>
              ) : null}
            </View>
            <View
              style={{
                alignSelf: "flex-start",
                marginTop: 4,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                backgroundColor: "#1565C018",
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#1565C0" }}>{
                { upcoming: "예정", ongoing: "진행중", completed: "종료", cancelled: "취소" }[status]
              }</Text>
            </View>
            {memberView.description ? (
              <Text style={{ color: "#0F172A", marginTop: 10, lineHeight: 20 }}>{memberView.description}</Text>
            ) : null}
          </View>

          <View
            style={{
              marginHorizontal: 20,
              marginTop: 4,
              padding: 16,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#E5E7EB",
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A" }}>내 참가 정보</Text>
            {memberView.myEntry ? (
              <>
                <Text style={{ color: "#0F172A" }}>
                  {memberView.myEntry.weightClass ? `체급: ${memberView.myEntry.weightClass}` : "체급 미지정"}
                  {memberView.myEntry.division ? `  ·  부문: ${memberView.myEntry.division}` : ""}
                </Text>
                {myResult ? (
                  <Text style={{ color: RESULT_COLOR[myResult], fontWeight: "700" }}>
                    결과: {RESULT_LABEL[myResult]}
                  </Text>
                ) : null}
                {memberView.myEntry.notes ? (
                  <Text style={{ color: "#475569", fontSize: 12 }}>{memberView.myEntry.notes}</Text>
                ) : null}
              </>
            ) : (
              <Text style={{ color: "#64748B" }}>
                아직 참가자로 등록되지 않았습니다. 관리자에게 문의하세요.
              </Text>
            )}
            <Text style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
              전체 참가자 {memberView.participantCount}명
            </Text>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  if (isLoading || !data) {
    return (
      <ScreenContainer>
        <Header title="대회 상세" />
        <LoadingView />
      </ScreenContainer>
    );
  }

  const status = (data.status ?? "upcoming") as Status;

  const confirmDelete = () =>
    Alert.alert("대회 삭제", "이 대회와 모든 참가자 기록을 삭제할까요?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => deleteTournamentMutation.mutate({ id }) },
    ]);

  const confirmRemove = (memberId: number, name: string) =>
    Alert.alert("참가자 해제", `${name} 회원을 대회 참가자에서 제외할까요?`, [
      { text: "취소", style: "cancel" },
      {
        text: "해제",
        style: "destructive",
        onPress: () => removeMutation.mutate({ tournamentId: id, memberId }),
      },
    ]);

  return (
    <ScreenContainer>
      <Header title="대회 상세" right={
        <TouchableOpacity onPress={confirmDelete}>
          <Text style={{ color: "#DC2626", fontWeight: "600" }}>삭제</Text>
        </TouchableOpacity>
      } />

      <ScrollView contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }}>
        <View style={{ padding: 20, gap: 8 }}>
          <Text style={{ fontSize: 22, fontWeight: "800", color: "#0F172A" }}>{data.title}</Text>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Text style={{ color: "#475569" }}>📅 {formatDate(data.eventDate)}</Text>
            {data.location ? <Text style={{ color: "#475569" }}>📍 {data.location}</Text> : null}
            {data.registrationDeadline ? (
              <Text style={{ color: "#475569" }}>⏰ 신청 {formatDate(data.registrationDeadline)} 까지</Text>
            ) : null}
          </View>

          {/* 상태 전환 */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {STATUS_OPTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => updateTournamentMutation.mutate({ id, status: s })}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: status === s ? "#1565C0" : "#E5E7EB",
                  backgroundColor: status === s ? "#1565C0" : "transparent",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: status === s ? "#FFFFFF" : "#475569" }}>
                  {STATUS_LABEL[s]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {data.description ? (
            <Text style={{ color: "#0F172A", marginTop: 10, lineHeight: 20 }}>{data.description}</Text>
          ) : null}
        </View>

        {/* 참가자 섹션 */}
        <View
          style={{
            marginHorizontal: 20,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#E5E7EB",
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 14,
              borderBottomWidth: 1,
              borderBottomColor: "#F1F5F9",
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: "#0F172A" }}>
              참가자 ({data.participants.length})
            </Text>
            <TouchableOpacity
              onPress={() => setShowPicker(true)}
              style={{
                backgroundColor: "#1565C0",
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 12 }}>+ 회원 등록</Text>
            </TouchableOpacity>
          </View>

          {data.participants.length === 0 ? (
            <View style={{ padding: 24, alignItems: "center" }}>
              <Text style={{ color: "#64748B" }}>참가자가 없습니다.</Text>
            </View>
          ) : (
            data.participants.map((p, idx) => {
              const result = (p.result ?? "pending") as Result;
              return (
                <View
                  key={`${p.memberId}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    padding: 14,
                    borderTopWidth: idx > 0 ? 0.5 : 0,
                    borderTopColor: "#F1F5F9",
                  }}
                >
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: getBeltColor((p.beltRank ?? "white") as any),
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A" }}>
                      {p.memberName ?? `#${p.memberId}`}
                    </Text>
                    <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                      {getBeltLabel((p.beltRank ?? "white") as any)}
                      {p.weightClass ? ` · ${p.weightClass}` : ""}
                      {p.division ? ` · ${p.division}` : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingMemberId(p.memberId);
                      setEditingResult(result);
                    }}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: RESULT_COLOR[result] + "18",
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "700", color: RESULT_COLOR[result] }}>
                      {RESULT_LABEL[result]}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => confirmRemove(p.memberId, p.memberName ?? `#${p.memberId}`)}
                    style={{ paddingHorizontal: 8 }}
                  >
                    <Text style={{ color: "#DC2626", fontWeight: "600", fontSize: 12 }}>제외</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* 회원 등록 모달 */}
      <Modal visible={showPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPicker(false)}>
        <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
          <View
            style={{
              paddingTop: Math.max(insets.top, 20),
              paddingHorizontal: 20,
              paddingBottom: 10,
              borderBottomWidth: 0.5,
              borderBottomColor: "#E5E7EB",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "800", color: "#0F172A" }}>회원 등록</Text>
            <TouchableOpacity onPress={() => setShowPicker(false)}>
              <Text style={{ color: "#1565C0", fontWeight: "600" }}>닫기</Text>
            </TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm }}>
            <FormField placeholder="이름 검색" value={pickerSearch} onChangeText={setPickerSearch} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <FormField placeholder="체급 (예: -60kg)" value={weightClass} onChangeText={setWeightClass} />
              </View>
              <View style={{ flex: 1 }}>
                <FormField placeholder="부문 (예: 초등)" value={division} onChangeText={setDivision} />
              </View>
            </View>
            <Text style={{ fontSize: 11, color: c.muted }}>
              아래에서 회원을 선택하면 체급·부문을 함께 등록합니다. 등록 후 푸시 알림이 전송됩니다.
            </Text>
          </View>

          <FlatList
            data={availableMembers}
            keyExtractor={idKeyExtractor}
            {...listPerfProps}
            contentContainerStyle={{ padding: 20, gap: 8 }}
            ListEmptyComponent={
              <View style={{ alignItems: "center", paddingVertical: 40 }}>
                <Text style={{ color: "#64748B" }}>등록 가능한 회원이 없습니다.</Text>
              </View>
            }
            renderItem={({ item: m }) => (
              <TouchableOpacity
                onPress={() =>
                  registerMutation.mutate({
                    tournamentId: id,
                    memberId: m.id,
                    weightClass: weightClass.trim() || undefined,
                    division: division.trim() || undefined,
                  })
                }
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  borderRadius: 12,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: getBeltColor(m.beltRank as any),
                  }}
                />
                <Text style={{ flex: 1, fontWeight: "600", color: "#0F172A" }}>{m.name}</Text>
                <Text style={{ fontSize: 11, color: "#64748B" }}>{getBeltLabel(m.beltRank as any)}</Text>
                <Text style={{ fontSize: 11, color: "#1565C0", fontWeight: "700" }}>+ 등록</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      {/* 결과 선택 모달 */}
      <Modal
        visible={editingMemberId != null}
        animationType="fade"
        transparent
        onRequestClose={() => setEditingMemberId(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" }}>
          <View style={{ backgroundColor: "#FFFFFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#0F172A" }}>결과 선택</Text>
            {RESULT_OPTIONS.map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setEditingResult(r)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: editingResult === r ? RESULT_COLOR[r] : "#E5E7EB",
                  backgroundColor: editingResult === r ? RESULT_COLOR[r] + "12" : "transparent",
                }}
              >
                <Text style={{ fontWeight: "700", color: RESULT_COLOR[r] }}>{RESULT_LABEL[r]}</Text>
                {editingResult === r ? (
                  <Text style={{ color: RESULT_COLOR[r], fontWeight: "800" }}>✓</Text>
                ) : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => {
                if (editingMemberId == null) return;
                updateResultMutation.mutate({
                  tournamentId: id,
                  memberId: editingMemberId,
                  result: editingResult,
                });
              }}
              style={{
                backgroundColor: "#1565C0",
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: "center",
                marginTop: 8,
              }}
              disabled={updateResultMutation.isPending}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>
                {updateResultMutation.isPending ? "저장 중..." : "결과 저장"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditingMemberId(null)} style={{ paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ color: "#64748B" }}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 8,
      }}
    >
      <BackButton />
      <Text style={{ fontSize: 18, fontWeight: "700", color: "#0F172A" }}>{title}</Text>
      <View style={{ minWidth: 44, alignItems: "flex-end" }}>{right ?? null}</View>
    </View>
  );
}
