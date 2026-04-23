import React, { useState, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  Alert, ActivityIndicator, TextInput, Share, Clipboard, RefreshControl,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { useModalBackHandler, useTabBackHandler } from "@/hooks/use-back-handler";
import { formatDateTime } from "@/lib/judo-utils";

type UserRole = "member" | "manager" | "admin";

const ROLE_LABELS: Record<UserRole, string> = { member: "회원", manager: "관리자", admin: "최고관리자" };
const ROLE_COLORS: Record<UserRole, string> = { member: "#687076", manager: "#1565C0", admin: "#7B3F9E" };
const ROLE_BG: Record<UserRole, string> = { member: "#F5F5F5", manager: "#1565C010", admin: "#7B3F9E10" };

const ACTION_LABELS: Record<string, string> = {
  updateRole: "역할 변경",
  claimAdmin: "최초 관리자 설정",
  linkMember: "회원 계정 연결",
  unlinkMember: "회원 계정 연결 해제",
  createInvite: "초대 링크 생성",
  acceptInvite: "초대 링크 수락",
};

const ACTION_COLORS: Record<string, string> = {
  updateRole: "#7C3AED",
  claimAdmin: "#DC2626",
  linkMember: "#16A34A",
  unlinkMember: "#EA580C",
  createInvite: "#2563EB",
  acceptInvite: "#0891B2",
};

function getInitials(name: string | null | undefined) {
  if (!name) return "?";
  return name.slice(0, 2);
}

function formatTime(d: Date | string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── 탭 버튼 ─────────────────────────────────────────────────────────────────
function TabBar({ tabs, active, onSelect }: { tabs: string[]; active: number; onSelect: (i: number) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-5 mb-3">
      <View className="flex-row gap-2">
        {tabs.map((t, i) => (
          <TouchableOpacity
            key={t}
            className="px-4 py-2 rounded-full"
            style={{ backgroundColor: active === i ? "#1565C0" : "#F5F5F5" }}
            onPress={() => onSelect(i)}
          >
            <Text className="text-sm font-semibold" style={{ color: active === i ? "#fff" : "#687076" }}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── 사용자 관리 탭 ───────────────────────────────────────────────────────────
function UsersTab({ currentUserId }: { currentUserId?: number }) {
  const utils = trpc.useUtils();
  const [selectedUser, setSelectedUser] = useState<{ id: number; name: string | null; role: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newRole, setNewRole] = useState<UserRole>("member");

  const { data: users, isLoading } = trpc.admin.users.useQuery();
  const updateRoleMutation = trpc.admin.updateRole.useMutation({
    onSuccess: () => { utils.admin.users.invalidate(); setShowModal(false); },
    onError: (e) => Alert.alert("오류", e.message),
  });

  useModalBackHandler(showModal, () => setShowModal(false));

  if (isLoading) return <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="#1565C0" /></View>;

  const grouped = {
    admin: (users ?? []).filter(u => u.role === "admin"),
    manager: (users ?? []).filter(u => u.role === "manager"),
    member: (users ?? []).filter(u => u.role === "member"),
  };

  return (
    <>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        {/* 역할 안내 */}
        <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-4">
          <Text className="text-sm font-semibold text-foreground mb-2">역할별 권한</Text>
          {([
            { role: "admin" as UserRole, desc: "모든 기능 + 사용자 역할 관리" },
            { role: "manager" as UserRole, desc: "회원 관리, 출석, 납부, 심사 관리" },
            { role: "member" as UserRole, desc: "내 현황, 공지사항 조회만 가능" },
          ]).map(item => (
            <View key={item.role} className="flex-row items-center gap-2 mt-1.5">
              <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: ROLE_BG[item.role] }}>
                <Text className="text-xs font-semibold" style={{ color: ROLE_COLORS[item.role] }}>{ROLE_LABELS[item.role]}</Text>
              </View>
              <Text className="text-xs text-muted flex-1">{item.desc}</Text>
            </View>
          ))}
        </View>

        {(["admin", "manager", "member"] as UserRole[]).map(role => grouped[role].length > 0 && (
          <View key={role} className="mx-5 mb-4">
            <Text className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">{ROLE_LABELS[role]} ({grouped[role].length}명)</Text>
            <View className="bg-surface rounded-2xl border border-border overflow-hidden">
              {grouped[role].map((u, idx) => (
                <TouchableOpacity
                  key={u.id}
                  className="flex-row items-center px-4 py-3"
                  style={{ borderTopWidth: idx > 0 ? 0.5 : 0, borderTopColor: "#E5E7EB" }}
                  onPress={() => { setSelectedUser(u); setNewRole(u.role as UserRole); setShowModal(true); }}
                >
                  <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: ROLE_BG[u.role as UserRole] }}>
                    <Text className="text-sm font-bold" style={{ color: ROLE_COLORS[u.role as UserRole] }}>{getInitials(u.name)}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{u.name ?? "이름 없음"}</Text>
                    {u.email ? <Text className="text-xs text-muted">{u.email}</Text> : null}
                  </View>
                  {u.id === currentUserId ? (
                    <Text className="text-xs text-muted">나</Text>
                  ) : (
                    <Text className="text-xs text-primary">변경 ›</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* 역할 변경 모달 */}
      <Modal visible={showModal} animationType="fade" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View className="bg-background rounded-t-3xl px-5 pt-5 pb-10">
            <Text className="text-lg font-bold text-foreground mb-1">역할 변경</Text>
            <Text className="text-sm text-muted mb-4">{selectedUser?.name ?? "사용자"}의 역할을 선택하세요</Text>
            <View className="gap-3 mb-4">
              {(["admin", "manager", "member"] as UserRole[]).map(r => (
                <TouchableOpacity
                  key={r}
                  className="flex-row items-center justify-between p-4 rounded-2xl border"
                  style={{ backgroundColor: newRole === r ? ROLE_BG[r] : "transparent", borderColor: newRole === r ? ROLE_COLORS[r] : "#E5E7EB" }}
                  onPress={() => setNewRole(r)}
                >
                  <View>
                    <Text className="font-semibold" style={{ color: ROLE_COLORS[r] }}>{ROLE_LABELS[r]}</Text>
                    <Text className="text-xs text-muted mt-0.5">
                      {r === "admin" ? "모든 기능 + 사용자 역할 관리" : r === "manager" ? "회원 관리, 출석, 납부, 심사 관리" : "내 현황, 공지사항 조회만 가능"}
                    </Text>
                  </View>
                  {newRole === r && <View className="w-6 h-6 rounded-full items-center justify-center" style={{ backgroundColor: ROLE_COLORS[r] }}><Text className="text-white text-xs font-bold">✓</Text></View>}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              className="py-4 rounded-2xl items-center mb-3"
              style={{ backgroundColor: ROLE_COLORS[newRole], opacity: updateRoleMutation.isPending ? 0.6 : 1 }}
              onPress={() => {
                if (!selectedUser) return;
                Alert.alert("역할 변경", `${selectedUser.name ?? "사용자"}의 역할을 "${ROLE_LABELS[newRole]}"으로 변경하시겠습니까?`, [
                  { text: "취소", style: "cancel" },
                  { text: "변경", onPress: () => updateRoleMutation.mutate({ userId: selectedUser.id, role: newRole }) },
                ]);
              }}
              disabled={updateRoleMutation.isPending}
            >
              <Text className="text-white font-bold text-base">{updateRoleMutation.isPending ? "변경 중..." : "역할 변경"}</Text>
            </TouchableOpacity>
            <TouchableOpacity className="py-3 items-center" onPress={() => setShowModal(false)}>
              <Text className="text-muted">취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── 회원 연결 탭 ─────────────────────────────────────────────────────────────
function LinkMemberTab() {
  const utils = trpc.useUtils();
  const { data: members, isLoading: loadingMembers } = trpc.members.list.useQuery();
  const { data: users, isLoading: loadingUsers } = trpc.admin.users.useQuery();

  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [showUserPicker, setShowUserPicker] = useState(false);

  useModalBackHandler(showMemberPicker, () => setShowMemberPicker(false));
  useModalBackHandler(showUserPicker, () => setShowUserPicker(false));

  const linkMutation = trpc.admin.linkMember.useMutation({
    onSuccess: () => {
      Alert.alert("완료", "회원과 계정이 연결되었습니다.");
      utils.members.list.invalidate();
      setSelectedMemberId(null);
      setSelectedUserId(null);
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const unlinkMutation = trpc.admin.unlinkMember.useMutation({
    onSuccess: () => { Alert.alert("완료", "연결이 해제되었습니다."); utils.members.list.invalidate(); },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const selectedMember = members?.find(m => m.id === selectedMemberId);
  const selectedUser = users?.find(u => u.id === selectedUserId);

  if (loadingMembers || loadingUsers) return <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="#1565C0" /></View>;

  const linkedMembers = (members ?? []).filter(m => m.userId);
  const unlinkedMembers = (members ?? []).filter(m => !m.userId);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
      {/* 안내 */}
      <View className="mx-5 mb-4 bg-blue-50 rounded-2xl p-4 border border-blue-100">
        <Text className="text-sm font-semibold text-blue-800 mb-1">회원-계정 연결이란?</Text>
        <Text className="text-xs text-blue-700 leading-relaxed">
          회원 DB와 앱 로그인 계정을 연결하면, 회원이 앱에 로그인했을 때 자신의 출석·납부 현황을 직접 조회할 수 있습니다.
        </Text>
      </View>

      {/* 새 연결 설정 */}
      <View className="mx-5 mb-4">
        <Text className="text-sm font-semibold text-foreground mb-3">새 연결 설정</Text>
        <View className="bg-surface rounded-2xl border border-border p-4 gap-3">
          {/* 회원 선택 */}
          <TouchableOpacity
            className="flex-row items-center justify-between p-3 rounded-xl border border-border bg-background"
            onPress={() => setShowMemberPicker(true)}
          >
            <Text className={selectedMember ? "text-foreground text-sm" : "text-muted text-sm"}>
              {selectedMember ? `${selectedMember.name} (${selectedMember.beltRank ?? "미설정"})` : "회원 선택..."}
            </Text>
            <Text className="text-muted">›</Text>
          </TouchableOpacity>

          {/* 사용자 선택 */}
          <TouchableOpacity
            className="flex-row items-center justify-between p-3 rounded-xl border border-border bg-background"
            onPress={() => setShowUserPicker(true)}
          >
            <Text className={selectedUser ? "text-foreground text-sm" : "text-muted text-sm"}>
              {selectedUser ? `${selectedUser.name ?? "이름없음"} (${selectedUser.email ?? ""})` : "앱 계정 선택..."}
            </Text>
            <Text className="text-muted">›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="py-3 rounded-xl items-center"
            style={{ backgroundColor: selectedMemberId && selectedUserId ? "#1565C0" : "#E5E7EB", opacity: linkMutation.isPending ? 0.6 : 1 }}
            onPress={() => {
              if (!selectedMemberId || !selectedUserId) return;
              Alert.alert("연결 확인", `${selectedMember?.name}을(를) ${selectedUser?.name ?? "해당 계정"}과 연결하시겠습니까?`, [
                { text: "취소", style: "cancel" },
                { text: "연결", onPress: () => linkMutation.mutate({ memberId: selectedMemberId, userId: selectedUserId }) },
              ]);
            }}
            disabled={!selectedMemberId || !selectedUserId || linkMutation.isPending}
          >
            <Text className="font-bold text-sm" style={{ color: selectedMemberId && selectedUserId ? "#fff" : "#9BA1A6" }}>
              {linkMutation.isPending ? "연결 중..." : "연결하기"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 연결된 회원 목록 */}
      {linkedMembers.length > 0 && (
        <View className="mx-5 mb-4">
          <Text className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">연결된 회원 ({linkedMembers.length}명)</Text>
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            {linkedMembers.map((m, idx) => {
              const linkedUser = users?.find(u => u.id === m.userId);
              return (
                <View key={m.id} className="flex-row items-center px-4 py-3" style={{ borderTopWidth: idx > 0 ? 0.5 : 0, borderTopColor: "#E5E7EB" }}>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{m.name}</Text>
                    <Text className="text-xs text-muted">{linkedUser?.name ?? "알 수 없음"} ({linkedUser?.email ?? ""})</Text>
                  </View>
                  <TouchableOpacity
                    className="px-3 py-1.5 rounded-full"
                    style={{ backgroundColor: "#FEE2E2" }}
                    onPress={() => Alert.alert("연결 해제", `${m.name}의 계정 연결을 해제하시겠습니까?`, [
                      { text: "취소", style: "cancel" },
                      { text: "해제", style: "destructive", onPress: () => unlinkMutation.mutate({ memberId: m.id }) },
                    ])}
                  >
                    <Text className="text-xs font-semibold text-red-600">해제</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 미연결 회원 */}
      {unlinkedMembers.length > 0 && (
        <View className="mx-5 mb-4">
          <Text className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">미연결 회원 ({unlinkedMembers.length}명)</Text>
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            {unlinkedMembers.map((m, idx) => (
              <View key={m.id} className="flex-row items-center px-4 py-3" style={{ borderTopWidth: idx > 0 ? 0.5 : 0, borderTopColor: "#E5E7EB" }}>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">{m.name}</Text>
                  <Text className="text-xs text-muted">{m.beltRank ?? "미설정"}</Text>
                </View>
                <Text className="text-xs text-muted">미연결</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 회원 선택 모달 */}
      <Modal visible={showMemberPicker} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View className="bg-background rounded-t-3xl px-5 pt-5" style={{ maxHeight: "70%" }}>
            <Text className="text-lg font-bold text-foreground mb-4">회원 선택</Text>
            <ScrollView>
              {(members ?? []).map(m => (
                <TouchableOpacity
                  key={m.id}
                  className="flex-row items-center py-3 border-b border-border"
                  onPress={() => { setSelectedMemberId(m.id); setShowMemberPicker(false); }}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{m.name}</Text>
                    <Text className="text-xs text-muted">{m.beltRank ?? "미설정"} · {m.userId ? "연결됨" : "미연결"}</Text>
                  </View>
                  {selectedMemberId === m.id && <Text className="text-primary font-bold">✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity className="py-4 items-center" onPress={() => setShowMemberPicker(false)}>
              <Text className="text-muted">취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 사용자 선택 모달 */}
      <Modal visible={showUserPicker} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View className="bg-background rounded-t-3xl px-5 pt-5" style={{ maxHeight: "70%" }}>
            <Text className="text-lg font-bold text-foreground mb-4">앱 계정 선택</Text>
            <ScrollView>
              {(users ?? []).map(u => (
                <TouchableOpacity
                  key={u.id}
                  className="flex-row items-center py-3 border-b border-border"
                  onPress={() => { setSelectedUserId(u.id); setShowUserPicker(false); }}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{u.name ?? "이름 없음"}</Text>
                    <Text className="text-xs text-muted">{u.email ?? ""} · {ROLE_LABELS[u.role as UserRole]}</Text>
                  </View>
                  {selectedUserId === u.id && <Text className="text-primary font-bold">✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity className="py-4 items-center" onPress={() => setShowUserPicker(false)}>
              <Text className="text-muted">취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── 활동 로그 탭 (감사 추적) ─────────────────────────────────────────────────
const AUDIT_ACTION_KEYS = Object.keys(ACTION_LABELS);

function ActivityLogsTab() {
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data: logs, isLoading, refetch } = trpc.admin.activityLogs.useQuery({
    limit: 300,
    action: actionFilter ?? undefined,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = logs ?? [];
    if (!q) return list;
    return list.filter(
      l =>
        (l.description ?? "").toLowerCase().includes(q) ||
        (l.userName ?? "").toLowerCase().includes(q) ||
        (l.userEmail ?? "").toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q),
    );
  }, [logs, search]);

  const actionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of logs ?? []) {
      m.set(l.action, (m.get(l.action) ?? 0) + 1);
    }
    return m;
  }, [logs]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#1565C0" />
      </View>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 30 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1565C0" colors={["#1565C0"]} />
      }
    >
      <View className="mx-5 mb-3 bg-surface rounded-2xl border border-border p-4">
        <Text className="text-sm font-semibold text-foreground mb-1">감사 추적 (활동 로그)</Text>
        <Text className="text-xs text-muted leading-5">
          관리자·최고관리자의 계정·초대 관련 작업이 기록됩니다. 유형·검색어로 좁힐 수 있고, 아래로 당겨 최신 목록을 불러옵니다.
        </Text>
        <View className="flex-row flex-wrap gap-2 mt-3">
          <View className="px-2 py-1 rounded-lg bg-blue-50">
            <Text className="text-xs font-semibold text-blue-800">불러온 {logs?.length ?? 0}건</Text>
          </View>
          {AUDIT_ACTION_KEYS.map(k => {
            const n = actionCounts.get(k) ?? 0;
            if (n === 0) return null;
            return (
              <View key={k} className="px-2 py-1 rounded-lg" style={{ backgroundColor: (ACTION_COLORS[k] ?? "#64748B") + "18" }}>
                <Text className="text-xs font-medium" style={{ color: ACTION_COLORS[k] ?? "#64748B" }}>
                  {ACTION_LABELS[k] ?? k} {n}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* 유형 필터 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2 px-5">
        <View className="flex-row gap-2">
          <TouchableOpacity
            className="px-3 py-1.5 rounded-full border"
            style={{
              backgroundColor: actionFilter === null ? "#1565C0" : "transparent",
              borderColor: actionFilter === null ? "#1565C0" : "#E5E7EB",
            }}
            onPress={() => setActionFilter(null)}
          >
            <Text className="text-xs font-semibold" style={{ color: actionFilter === null ? "#FFFFFF" : "#687076" }}>
              전체 유형
            </Text>
          </TouchableOpacity>
          {AUDIT_ACTION_KEYS.map(k => (
            <TouchableOpacity
              key={k}
              className="px-3 py-1.5 rounded-full border"
              style={{
                backgroundColor: actionFilter === k ? (ACTION_COLORS[k] ?? "#1565C0") : "transparent",
                borderColor: ACTION_COLORS[k] ?? "#E5E7EB",
              }}
              onPress={() => setActionFilter(actionFilter === k ? null : k)}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: actionFilter === k ? "#FFFFFF" : (ACTION_COLORS[k] ?? "#687076") }}
              >
                {ACTION_LABELS[k]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* 검색 */}
      <View className="mx-5 mb-3 flex-row items-center gap-2">
        <TextInput
          className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-foreground text-sm"
          placeholder="설명·실행자 이름·이메일 검색"
          placeholderTextColor="#9BA1A6"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")} className="px-3 py-2.5 rounded-xl border border-border">
            <Text className="text-xs text-muted font-semibold">✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text className="text-xs text-muted mx-5 mb-2">
        표시 {filtered.length}건{search.trim() ? " (검색 적용)" : ""}
        {actionFilter ? ` · 유형: ${ACTION_LABELS[actionFilter] ?? actionFilter}` : ""}
      </Text>

      <View className="mx-5">
        {filtered.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-4xl mb-3">📋</Text>
            <Text className="text-muted text-center">
              {(logs ?? []).length === 0 ? "활동 기록이 없습니다" : "조건에 맞는 기록이 없습니다"}
            </Text>
            {(logs ?? []).length > 0 && search.trim() ? (
              <TouchableOpacity className="mt-3 px-4 py-2 rounded-full border border-border" onPress={() => setSearch("")}>
                <Text className="text-sm text-primary font-semibold">검색어 지우기</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            {filtered.map((log, idx) => {
              const ac = ACTION_COLORS[log.action] ?? "#1565C0";
              return (
                <View
                  key={log.id}
                  className="px-4 py-3"
                  style={{
                    borderTopWidth: idx > 0 ? 0.5 : 0,
                    borderTopColor: "#E5E7EB",
                    borderLeftWidth: 3,
                    borderLeftColor: ac,
                  }}
                >
                  <View className="flex-row items-start justify-between mb-1">
                    <View className="flex-row items-center gap-2 flex-1 flex-wrap">
                      <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: ac + "22" }}>
                        <Text className="text-xs font-semibold" style={{ color: ac }}>
                          {ACTION_LABELS[log.action] ?? log.action}
                        </Text>
                      </View>
                      <Text className="text-xs text-muted">
                        {log.userName ?? `사용자 #${log.userId}`}
                        {log.userEmail ? ` · ${log.userEmail}` : ""}
                      </Text>
                    </View>
                    <Text className="text-xs text-muted shrink-0 ml-1">{formatDateTime(log.createdAt)}</Text>
                  </View>
                  {log.targetType != null && log.targetId != null ? (
                    <Text className="text-[10px] text-muted mb-0.5">
                      대상: {log.targetType} #{log.targetId}
                    </Text>
                  ) : null}
                  {log.description ? (
                    <Text className="text-xs text-foreground leading-5">{log.description}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ─── 초대 링크 탭 ─────────────────────────────────────────────────────────────
function InviteTab() {
  const utils = trpc.useUtils();
  const { data: members } = trpc.members.list.useQuery();
  const { data: invites, isLoading } = trpc.admin.myInvites.useQuery();
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [lastToken, setLastToken] = useState<string | null>(null);

  useModalBackHandler(showPicker, () => setShowPicker(false));

  const createMutation = trpc.admin.createInvite.useMutation({
    onSuccess: (data) => {
      setLastToken(data.token);
      utils.admin.myInvites.invalidate();
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const selectedMember = members?.find(m => m.id === selectedMemberId);
  const inviteUrl = lastToken ? `judomanager://invite/${lastToken}` : null;

  function handleShare() {
    if (!inviteUrl) return;
    Share.share({ message: `유도장 앱 초대 링크입니다:\n${inviteUrl}\n\n7일 이내에 앱에서 사용하세요.` });
  }

  function handleCopy() {
    if (!inviteUrl) return;
    Clipboard.setString(inviteUrl);
    Alert.alert("복사됨", "초대 링크가 클립보드에 복사되었습니다.");
  }

  if (isLoading) return <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="#1565C0" /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
      {/* 안내 */}
      <View className="mx-5 mb-4 bg-green-50 rounded-2xl p-4 border border-green-100">
        <Text className="text-sm font-semibold text-green-800 mb-1">초대 링크 사용 방법</Text>
        <Text className="text-xs text-green-700 leading-relaxed">
          1. 회원을 선택하고 초대 링크를 생성합니다{"\n"}
          2. 링크를 회원에게 카카오톡/문자로 전달합니다{"\n"}
          3. 회원이 앱 설치 후 링크를 열면 자동으로 계정이 연결됩니다{"\n"}
          4. 링크는 생성 후 7일간 유효합니다
        </Text>
      </View>

      {/* 링크 생성 */}
      <View className="mx-5 mb-4">
        <Text className="text-sm font-semibold text-foreground mb-3">초대 링크 생성</Text>
        <View className="bg-surface rounded-2xl border border-border p-4 gap-3">
          <TouchableOpacity
            className="flex-row items-center justify-between p-3 rounded-xl border border-border bg-background"
            onPress={() => setShowPicker(true)}
          >
            <Text className={selectedMember ? "text-foreground text-sm" : "text-muted text-sm"}>
              {selectedMember ? `${selectedMember.name} (${selectedMember.beltRank ?? "미설정"})` : "회원 선택 (선택사항)"}
            </Text>
            <Text className="text-muted">›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="py-3 rounded-xl items-center"
            style={{ backgroundColor: "#22C55E", opacity: createMutation.isPending ? 0.6 : 1 }}
            onPress={() => createMutation.mutate({ memberId: selectedMemberId ?? undefined })}
            disabled={createMutation.isPending}
          >
            <Text className="text-white font-bold text-sm">
              {createMutation.isPending ? "생성 중..." : "초대 링크 생성"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 생성된 링크 */}
      {inviteUrl && (
        <View className="mx-5 mb-4 bg-surface rounded-2xl border border-green-200 p-4">
          <Text className="text-sm font-semibold text-foreground mb-2">생성된 초대 링크</Text>
          <View className="bg-background rounded-xl p-3 mb-3">
            <Text className="text-xs text-muted font-mono" numberOfLines={2}>{inviteUrl}</Text>
          </View>
          <View className="flex-row gap-2">
            <TouchableOpacity
              className="flex-1 py-3 rounded-xl items-center"
              style={{ backgroundColor: "#1565C0" }}
              onPress={handleShare}
            >
              <Text className="text-white font-bold text-sm">공유하기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 py-3 rounded-xl items-center"
              style={{ backgroundColor: "#F5F5F5" }}
              onPress={handleCopy}
            >
              <Text className="text-foreground font-bold text-sm">복사하기</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 발급 이력 */}
      {(invites ?? []).length > 0 && (
        <View className="mx-5 mb-4">
          <Text className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">발급 이력</Text>
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            {(invites ?? []).map((inv, idx) => {
              const isUsed = !!inv.usedBy;
              const isExpired = new Date(inv.expiresAt) < new Date();
              const status = isUsed ? "사용됨" : isExpired ? "만료됨" : "유효";
              const statusColor = isUsed ? "#22C55E" : isExpired ? "#EF4444" : "#1565C0";
              return (
                <View key={inv.id} className="px-4 py-3" style={{ borderTopWidth: idx > 0 ? 0.5 : 0, borderTopColor: "#E5E7EB" }}>
                  <View className="flex-row items-center justify-between mb-0.5">
                    <Text className="text-sm font-semibold text-foreground">
                      {inv.memberName ?? "특정 회원 없음"}
                    </Text>
                    <Text className="text-xs font-semibold" style={{ color: statusColor }}>{status}</Text>
                  </View>
                  <Text className="text-xs text-muted">만료: {formatTime(inv.expiresAt)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 회원 선택 모달 */}
      <Modal visible={showPicker} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View className="bg-background rounded-t-3xl px-5 pt-5" style={{ maxHeight: "70%" }}>
            <Text className="text-lg font-bold text-foreground mb-4">회원 선택</Text>
            <ScrollView>
              <TouchableOpacity
                className="flex-row items-center py-3 border-b border-border"
                onPress={() => { setSelectedMemberId(null); setShowPicker(false); }}
              >
                <Text className="text-sm text-muted">선택 안 함 (일반 초대)</Text>
              </TouchableOpacity>
              {(members ?? []).map(m => (
                <TouchableOpacity
                  key={m.id}
                  className="flex-row items-center py-3 border-b border-border"
                  onPress={() => { setSelectedMemberId(m.id); setShowPicker(false); }}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{m.name}</Text>
                    <Text className="text-xs text-muted">{m.beltRank ?? "미설정"}</Text>
                  </View>
                  {selectedMemberId === m.id && <Text className="text-primary font-bold">✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity className="py-4 items-center" onPress={() => setShowPicker(false)}>
              <Text className="text-muted">취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── 메인 화면 ────────────────────────────────────────────────────────────────
export default function AdminScreen() {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState(0);

  // 뒤로가기: 서브탭 한 단계씩 앞으로(3→2→1→0), 0이면 앱 종료 확인
  useTabBackHandler(activeTab > 0 ? () => setActiveTab((t) => t - 1) : undefined);

  const { data: adminCount } = trpc.admin.adminCount.useQuery(undefined, { enabled: isAuthenticated });
  const claimAdminMutation = trpc.admin.claimAdmin.useMutation({
    onSuccess: () => {
      Alert.alert("완료", "최고관리자로 설정되었습니다. 앱을 재시작하거나 다시 로그인해 주세요.");
      utils.admin.adminCount.invalidate();
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-muted text-center">로그인이 필요합니다</Text>
      </ScreenContainer>
    );
  }

  if (adminCount === 0) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <View className="items-center gap-4 max-w-xs">
          <Text className="text-5xl">🥋</Text>
          <Text className="text-xl font-bold text-foreground text-center">관리자 설정이 필요합니다</Text>
          <Text className="text-sm text-muted text-center leading-relaxed">
            아직 도장 관리자가 설정되지 않았습니다.{"\n"}
            현재 계정을 최고관리자로 설정하면 모든 기능을 사용할 수 있습니다.
          </Text>
          <View className="w-full bg-surface border border-border rounded-2xl p-4">
            <Text className="text-xs text-muted mb-1">현재 계정</Text>
            <Text className="text-base font-semibold text-foreground">{user?.name ?? "알 수 없음"}</Text>
            {user?.email ? <Text className="text-xs text-muted mt-0.5">{user.email}</Text> : null}
          </View>
          <TouchableOpacity
            className="w-full py-4 rounded-2xl items-center"
            style={{ backgroundColor: "#7B3F9E", opacity: claimAdminMutation.isPending ? 0.6 : 1 }}
            onPress={() => Alert.alert("최고관리자 설정", "현재 계정을 최고관리자로 설정하시겠습니까?", [
              { text: "취소", style: "cancel" },
              { text: "설정", onPress: () => claimAdminMutation.mutate() },
            ])}
            disabled={claimAdminMutation.isPending}
          >
            <Text className="text-white font-bold text-base">
              {claimAdminMutation.isPending ? "설정 중..." : "최고관리자로 설정"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  if (!isAdmin) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <View className="items-center gap-4 max-w-xs">
          <Text className="text-5xl">🔒</Text>
          <Text className="text-xl font-bold text-foreground text-center">접근 권한 없음</Text>
          <Text className="text-sm text-muted text-center leading-relaxed">
            이 화면은 최고관리자만 접근할 수 있습니다.{"\n"}
            도장 관리자에게 권한을 요청해 주세요.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const TABS = ["사용자 관리", "회원 연결", "감사 로그", "초대 링크"];

  return (
    <ScreenContainer>
      <View className="px-5 pt-4 pb-3">
        <Text className="text-2xl font-bold text-foreground">관리자 설정</Text>
        <Text className="text-muted text-sm mt-0.5">사용자·연결·감사 로그·초대</Text>
      </View>

      <TabBar tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === 0 && <UsersTab currentUserId={user?.id} />}
      {activeTab === 1 && <LinkMemberTab />}
      {activeTab === 2 && <ActivityLogsTab />}
      {activeTab === 3 && <InviteTab />}
    </ScreenContainer>
  );
}
