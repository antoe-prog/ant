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
import { formatDate } from "@/lib/judo-utils";
import { useTabBackHandler, useModalBackHandler } from "@/hooks/use-back-handler";
import { listPerfProps } from "@/lib/list-utils";
import {
  Chip,
  EmptyState,
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

export default function TournamentsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();
  const c = useSemanticColors();

  useTabBackHandler();

  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("upcoming");
  const [showCreate, setShowCreate] = useState(false);
  useModalBackHandler(showCreate, () => setShowCreate(false));

  const managerQuery = trpc.tournaments.list.useQuery(undefined, { enabled: isManager });
  const memberQuery = trpc.tournaments.myTournaments.useQuery(undefined, { enabled: !isManager });
  const rows = isManager ? (managerQuery.data ?? []) : (memberQuery.data ?? []);
  const isLoading = isManager ? managerQuery.isLoading : memberQuery.isLoading;

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
    onError: (e) => Alert.alert("오류", e.message),
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.sm }}>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {(["upcoming", "past", "all"] as const).map((k) => (
            <TouchableOpacity
              key={k}
              onPress={() => setFilter(k)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: radius.pill,
                borderWidth: 1,
                backgroundColor: filter === k ? c.primary : "transparent",
                borderColor: filter === k ? c.primary : c.border,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: filter === k ? "#FFFFFF" : c.muted }}>
                {k === "upcoming" ? "예정" : k === "past" ? "지난 대회" : "전체"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {isLoading ? (
        <LoadingView label="대회 목록 불러오는 중..." />
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
          ListEmptyComponent={
            <EmptyState
              emoji="🏆"
              title={
                isManager
                  ? filter === "upcoming"
                    ? "예정된 대회가 없습니다"
                    : "대회가 없습니다"
                  : "참가한 대회가 없습니다"
              }
              subtitle={isManager ? "+ 버튼으로 첫 대회를 등록해 보세요." : "관리자가 등록하면 여기에 표시됩니다."}
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
    description?: string;
  }) => void;
  isPending: boolean;
  topPadding: number;
}) {
  const c = useSemanticColors();
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setTitle("");
    setEventDate("");
    setLocation("");
    setDeadline("");
    setDescription("");
  };

  const submit = () => {
    if (!title.trim()) {
      Alert.alert("입력 필요", "대회명을 입력해 주세요.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      Alert.alert("입력 필요", "대회일은 YYYY-MM-DD 형식입니다.");
      return;
    }
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      Alert.alert("입력 필요", "신청 마감일 형식이 올바르지 않습니다.");
      return;
    }
    onSubmit({
      title: title.trim(),
      eventDate,
      location: location.trim() || undefined,
      registrationDeadline: deadline ? deadline : null,
      description: description.trim() || undefined,
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
            label="설명"
            value={description}
            onChangeText={setDescription}
            placeholder="체급·복장·기타 안내"
            multiline
          />
          <PrimaryButton label="대회 만들기" loading={isPending} onPress={submit} />
          <GhostButton label="닫기" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}
