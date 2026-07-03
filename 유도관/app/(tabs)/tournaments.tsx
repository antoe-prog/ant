import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { getFriendlyErrorMessage, getFriendlyErrorTitle } from "@/lib/error-messages";
import { formatAmount, formatDate } from "@/lib/judo-utils";
import { IS_ADMIN_APP } from "@/constants/app-variant";
import { useTabBackHandler, useModalBackHandler } from "@/hooks/use-back-handler";
import { listPerfProps } from "@/lib/list-utils";
import { useSelectedChild } from "@/hooks/use-selected-child";
import {
  Chip,
  EmptyState,
  ErrorState,
  Fab,
  FormField,
  GhostButton,
  LoadingView,
  PressableCard,
  PrimaryButton,
  radius,
  spacing,
  useSemanticColors,
} from "@/components/ui/primitives";

type TournamentStatus = "upcoming" | "ongoing" | "completed" | "cancelled";

const STATUS_LABEL: Record<TournamentStatus, string> = {
  upcoming: "예정",
  ongoing: "진행중",
  completed: "종료",
  cancelled: "취소",
};

function statusColor(status: TournamentStatus, c: ReturnType<typeof useSemanticColors>) {
  switch (status) {
    case "ongoing":
      return c.warning;
    case "completed":
      return c.muted;
    case "cancelled":
      return c.error;
    default:
      return c.primary;
  }
}

function isValidDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export default function TournamentsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isManager = IS_ADMIN_APP && (user?.role === "manager" || user?.role === "admin");
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const c = useSemanticColors();
  const { isParent, children, selectedChild, selectedChildId, selectedMemberInput, setSelectedChildId, isLoadingChildren } =
    useSelectedChild();
  const canReadSelectedMember = !isParent || !!selectedChildId;

  useTabBackHandler();

  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("upcoming");
  const [showCreate, setShowCreate] = useState(false);
  useModalBackHandler(showCreate, () => setShowCreate(false));

  const managerQuery = trpc.tournaments.list.useQuery(undefined, { enabled: isManager });
  const memberQuery = trpc.tournaments.myTournaments.useQuery(selectedMemberInput, {
    enabled: !isManager && canReadSelectedMember,
  });
  const rows = useMemo(
    () => (isManager ? (managerQuery.data ?? []) : (memberQuery.data ?? [])),
    [isManager, managerQuery.data, memberQuery.data],
  );
  const isLoading = isManager ? managerQuery.isLoading : memberQuery.isLoading || (isParent && isLoadingChildren);
  const queryError = isManager ? managerQuery.error : memberQuery.error;
  const refetchRows = isManager ? managerQuery.refetch : memberQuery.refetch;

  const filtered = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    return rows.filter((r: any) => {
      const date = r.eventDate ?? r.date;
      if (filter === "upcoming") return date >= todayStr && (r.status ?? "upcoming") !== "cancelled";
      if (filter === "past") return date < todayStr || r.status === "completed";
      return true;
    });
  }, [rows, filter]);

  const createMutation = trpc.tournaments.create.useMutation({
    onSuccess: () => {
      void utils.tournaments.list.invalidate();
      void utils.tournaments.upcoming.invalidate();
      setShowCreate(false);
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const id = item.id ?? item.tournamentId;
      const status = (item.status ?? "upcoming") as TournamentStatus;
      const color = statusColor(status, c);
      return (
        <PressableCard
          onPress={() =>
            router.push(
              ({ pathname: "/tournament-detail", params: { id: String(id) } }) as unknown as Href,
            )
          }
          style={{ gap: spacing.sm }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <IconSymbol name="rosette" size={20} color={color} />
            <Text
              style={{ flex: 1, fontSize: 16, fontWeight: "700", color: c.foreground }}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <Chip label={STATUS_LABEL[status]} color={color} size="sm" />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md, flexWrap: "wrap" }}>
            <MetaLine label={`📅 ${formatDate(item.eventDate)}`} />
            {item.location ? <MetaLine label={`📍 ${item.location}`} /> : null}
            {Number(item.entryFee ?? 0) > 0 ? <MetaLine label={`💳 ${formatAmount(Number(item.entryFee))}`} /> : null}
            {item.weightClass ? <MetaLine label={`⚖️ ${item.weightClass}`} /> : null}
            {item.division ? <MetaLine label={`🏷 ${item.division}`} /> : null}
            {!isManager && item.result && item.result !== "pending" ? (
              <MetaLine label={`🏅 ${item.result}`} />
            ) : null}
          </View>
        </PressableCard>
      );
    },
    [isManager, router, c],
  );

  return (
    <ScreenContainer>
      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: c.foreground }}>대회</Text>
        <Text style={{ fontSize: 13, color: c.muted, marginTop: 2 }}>
          {isManager ? "대회 일정과 참가자를 관리합니다." : "내가 참가한 대회를 확인합니다."}
        </Text>
      </View>

      {/* 필터 */}
      <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.md }}>
        <View
          style={{
            alignSelf: "flex-start",
            flexDirection: "row",
            gap: 4,
            padding: 4,
            height: 44,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
          }}
        >
          {(["upcoming", "past", "all"] as const).map((k) => (
            <TouchableOpacity
              key={k}
              onPress={() => setFilter(k)}
              style={{
                minWidth: k === "past" ? 92 : 64,
                height: 34,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                backgroundColor: filter === k ? c.primary : "transparent",
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: filter === k ? "#FFFFFF" : c.muted }}>
                {k === "upcoming" ? "예정" : k === "past" ? "지난 대회" : "전체"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isLoading ? (
        <LoadingView label="대회 목록 불러오는 중..." />
      ) : queryError ? (
        <ErrorState
          message={getFriendlyErrorMessage(queryError)}
          action={
            <TouchableOpacity
              onPress={() => void refetchRows()}
              style={{
                alignSelf: "flex-start",
                borderWidth: 1,
                borderColor: "#F2B8B5",
                borderRadius: radius.pill,
                paddingHorizontal: 14,
                paddingVertical: 8,
                backgroundColor: "#FFFFFF",
              }}
            >
              <Text style={{ color: "#B3261E", fontWeight: "800" }}>다시 시도</Text>
            </TouchableOpacity>
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it: any) => String(it.id ?? it.tournamentId)}
          renderItem={renderItem}
          {...listPerfProps}
          contentContainerStyle={{
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.xs,
            paddingBottom: Math.max(insets.bottom, spacing.xxl * 4),
            gap: spacing.md,
          }}
          ListHeaderComponent={
            !isManager && isParent && children.length > 1 ? (
              <View style={{ marginBottom: spacing.xs }}>
                <Text style={{ fontSize: 13, fontWeight: "800", color: c.foreground, marginBottom: 8 }}>
                  자녀 선택
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {children.map((child) => {
                    const active = child.id === selectedChild?.id;
                    return (
                      <TouchableOpacity
                        key={child.id}
                        activeOpacity={0.8}
                        onPress={() => void setSelectedChildId(child.id)}
                        style={{
                          borderWidth: 1,
                          borderColor: active ? c.primary : c.border,
                          backgroundColor: active ? c.primarySoft : c.surface,
                          borderRadius: radius.pill,
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                        }}
                      >
                        <Text style={{ color: active ? c.primary : c.foreground, fontSize: 13, fontWeight: "800" }}>
                          {child.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              emoji="🏆"
              title={
                isManager
                  ? filter === "upcoming"
                    ? "예정된 대회가 없습니다"
                    : "대회가 없습니다"
                  : isParent && !isLoadingChildren && children.length === 0
                    ? "연결된 자녀가 없습니다"
                  : "참가한 대회가 없습니다"
              }
              subtitle={
                isManager
                  ? "+ 버튼으로 첫 대회를 등록해 보세요."
                  : isParent && !isLoadingChildren && children.length === 0
                    ? "관리자에게 학부모-자녀 연결을 요청해 주세요."
                    : "관리자가 등록하면 여기에 표시됩니다."
              }
            />
          }
        />
      )}

      {/* FAB */}
      {isManager ? (
        <Fab
          onPress={() => setShowCreate(true)}
          icon={<IconSymbol name="plus" size={28} color="#FFFFFF" />}
          bottom={Math.max(insets.bottom, spacing.xl) + spacing.xl}
          right={spacing.xl}
          accessibilityLabel="대회 생성"
        />
      ) : null}

      <CreateTournamentModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={(payload) => createMutation.mutate(payload)}
        isPending={createMutation.isPending}
        topPadding={Math.max(insets.top, spacing.xl)}
      />
    </ScreenContainer>
  );
}

function MetaLine({ label }: { label: string }) {
  const c = useSemanticColors();
  return <Text style={{ fontSize: 12, color: c.muted }}>{label}</Text>;
}

// ───────────────────────────────────────────────────────────────────────────
// Create modal
// ───────────────────────────────────────────────────────────────────────────

function CreateTournamentModal({
  visible,
  onClose,
  onSubmit,
  isPending,
  topPadding,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    eventDate: string;
    location?: string;
    registrationDeadline?: string | null;
    entryFee?: number;
    description?: string;
    notice?: string;
  }) => void;
  isPending: boolean;
  topPadding: number;
}) {
  const c = useSemanticColors();
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [deadline, setDeadline] = useState("");
  const [entryFee, setEntryFee] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");

  const reset = () => {
    setTitle("");
    setEventDate("");
    setLocation("");
    setDeadline("");
    setEntryFee("");
    setDescription("");
    setNotice("");
  };

  const submit = () => {
    if (!title.trim()) {
      Alert.alert("입력 필요", "대회명을 입력해 주세요.");
      return;
    }
    if (!isValidDateInput(eventDate)) {
      Alert.alert("입력 필요", "대회일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.");
      return;
    }
    if (deadline && !isValidDateInput(deadline)) {
      Alert.alert("입력 필요", "신청 마감일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.");
      return;
    }
    if (deadline && deadline > eventDate) {
      Alert.alert("입력 확인", "신청 마감일은 대회일보다 늦을 수 없습니다.");
      return;
    }
    onSubmit({
      title: title.trim(),
      eventDate,
      location: location.trim() || undefined,
      registrationDeadline: deadline ? deadline : null,
      entryFee: Number.parseInt(entryFee.replace(/[^\d]/g, ""), 10) || 0,
      description: description.trim() || undefined,
      notice: notice.trim() || undefined,
    });
    reset();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View
          style={{
            paddingTop: topPadding,
            paddingHorizontal: spacing.xl,
            paddingBottom: spacing.sm,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottomWidth: 0.5,
            borderBottomColor: c.border,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "800", color: c.foreground }}>대회 생성</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: c.primary, fontWeight: "600" }}>취소</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.md }}>
          <FormField label="대회명 *" value={title} onChangeText={setTitle} placeholder="전국 유소년 유도대회" />
          <FormField
            label="대회일 * (YYYY-MM-DD)"
            value={eventDate}
            onChangeText={setEventDate}
            placeholder="2026-05-20"
          />
          <FormField label="장소" value={location} onChangeText={setLocation} placeholder="올림픽공원 체조경기장" />
          <FormField
            label="신청 마감 (선택)"
            value={deadline}
            onChangeText={setDeadline}
            placeholder="2026-05-10"
            hint="비워두면 상시 등록"
          />
          <FormField
            label="대회 비용"
            value={entryFee}
            onChangeText={setEntryFee}
            keyboardType="number-pad"
            placeholder="예: 30000"
            hint="0원이면 무료 또는 미정으로 표시됩니다."
          />
          <FormField
            label="설명"
            value={description}
            onChangeText={setDescription}
            placeholder="체급·복장·기타 안내"
            multiline
          />
          <FormField
            label="기타 안내사항"
            value={notice}
            onChangeText={setNotice}
            placeholder="집합 시간, 입금 계좌, 준비물 등"
            multiline
          />
          <PrimaryButton label="대회 만들기" loading={isPending} onPress={submit} />
          <GhostButton label="닫기" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}
