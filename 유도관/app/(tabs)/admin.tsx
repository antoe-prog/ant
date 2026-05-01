import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  Alert, ActivityIndicator, TextInput, Share, RefreshControl, FlatList, Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ReactNative from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { DojoBackdrop, DojoHeroCard, dojoPalette, dojoSoftShadow } from "@/components/ui/dojo-theme";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { getFriendlyErrorMessage, getFriendlyErrorTitle } from "@/lib/error-messages";
import { useModalBackHandler, useTabBackHandler } from "@/hooks/use-back-handler";
import { formatDateTime } from "@/lib/judo-utils";
import { idKeyExtractor, listPerfProps } from "@/lib/list-utils";
import { getApiBaseUrl } from "@/constants/oauth";
import { IS_ADMIN_APP, MEMBER_INVITE_SCHEME } from "@/constants/app-variant";

type UserRole = "member" | "manager" | "admin";

const ROLE_LABELS: Record<UserRole, string> = { member: "회원", manager: "관리자", admin: "최고관리자" };
const ROLE_COLORS: Record<UserRole, string> = { member: "#687076", manager: "#1565C0", admin: "#7B3F9E" };
const ROLE_BG: Record<UserRole, string> = { member: "#F5F5F5", manager: "#1565C010", admin: "#7B3F9E10" };

const ACTION_LABELS: Record<string, string> = {
  updateRole: "역할 변경",
  claimAdmin: "최초 관리자 설정",
  linkMember: "회원 계정 연결",
  unlinkMember: "회원 계정 연결 해제",
  linkParentChild: "학부모-자녀 연결",
  unlinkParentChild: "학부모-자녀 연결 해제",
  createInvite: "초대 링크 생성",
  acceptInvite: "초대 링크 수락",
  setNotificationPreference: "알림 승인 변경",
  createBackup: "DB 백업 생성",
  importBackupMembers: "백업 회원 가져오기",
  setNotificationDefault: "알림 기본 정책 변경",
  applyNotificationDefaults: "알림 기본 정책 전체 적용",
};

const ACTION_COLORS: Record<string, string> = {
  updateRole: "#7C3AED",
  claimAdmin: "#DC2626",
  linkMember: "#16A34A",
  unlinkMember: "#EA580C",
  linkParentChild: "#047857",
  unlinkParentChild: "#BE123C",
  createInvite: "#2563EB",
  acceptInvite: "#0891B2",
  setNotificationPreference: "#0F766E",
  createBackup: "#4F46E5",
  importBackupMembers: "#9333EA",
  setNotificationDefault: "#0369A1",
  applyNotificationDefaults: "#0891B2",
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

async function copyText(text: string) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const legacyClipboard = (ReactNative as any).Clipboard;
  if (legacyClipboard?.setString) {
    legacyClipboard.setString(text);
    return true;
  }

  return false;
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
            style={[
              { backgroundColor: active === i ? dojoPalette.ink : "#FFFFFFDD" },
              active === i ? dojoSoftShadow : null,
            ]}
            onPress={() => onSelect(i)}
          >
            <Text className="text-sm font-semibold" style={{ color: active === i ? "#fff" : dojoPalette.slate }}>{t}</Text>
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
  const closeRoleModal = useCallback(() => {
    setShowModal(false);
    setSelectedUser(null);
  }, []);

  const { data: users, isLoading } = trpc.admin.users.useQuery();
  const updateRoleMutation = trpc.admin.updateRole.useMutation({
    onSuccess: () => { void utils.admin.users.invalidate(); void utils.admin.activityLogs.invalidate(); closeRoleModal(); },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  useModalBackHandler(showModal, closeRoleModal);

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
            <TouchableOpacity className="py-3 items-center" onPress={closeRoleModal}>
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
  const { data: parentChildLinks, isLoading: loadingParentLinks } = trpc.admin.parentChildLinks.useQuery();

  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<number | null>(null);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [showParentPicker, setShowParentPicker] = useState(false);
  const [showChildPicker, setShowChildPicker] = useState(false);

  useModalBackHandler(showMemberPicker, () => setShowMemberPicker(false));
  useModalBackHandler(showUserPicker, () => setShowUserPicker(false));
  useModalBackHandler(showParentPicker, () => setShowParentPicker(false));
  useModalBackHandler(showChildPicker, () => setShowChildPicker(false));

  const linkMutation = trpc.admin.linkMember.useMutation({
    onSuccess: () => {
      Alert.alert("완료", "회원과 계정이 연결되었습니다.");
      void utils.members.list.invalidate();
      void utils.admin.users.invalidate();
      void utils.members.myProfile.invalidate();
      setSelectedMemberId(null);
      setSelectedUserId(null);
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  const unlinkMutation = trpc.admin.unlinkMember.useMutation({
    onSuccess: () => { Alert.alert("완료", "연결이 해제되었습니다."); utils.members.list.invalidate(); },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  const linkParentMutation = trpc.admin.linkParentChild.useMutation({
    onSuccess: () => {
      Alert.alert("완료", "학부모와 자녀가 연결되었습니다.");
      void utils.admin.parentChildLinks.invalidate();
      void utils.admin.activityLogs.invalidate();
      void utils.members.myProfile.invalidate();
      void utils.members.myChildren.invalidate();
      setSelectedParentId(null);
      setSelectedChildId(null);
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  const unlinkParentMutation = trpc.admin.unlinkParentChild.useMutation({
    onSuccess: () => {
      Alert.alert("완료", "학부모-자녀 연결이 해제되었습니다.");
      void utils.admin.parentChildLinks.invalidate();
      void utils.admin.activityLogs.invalidate();
      void utils.members.myProfile.invalidate();
      void utils.members.myChildren.invalidate();
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  useEffect(() => {
    if (!unlinkMutation.isSuccess) return;
    void utils.admin.users.invalidate();
    void utils.members.myProfile.invalidate();
  }, [unlinkMutation.isSuccess, utils]);

  const selectedMember = members?.find(m => m.id === selectedMemberId);
  const selectedUser = users?.find(u => u.id === selectedUserId);
  const parentUsers = (users ?? []).filter((u) => u.accountType === "parent");
  const selectedParent = parentUsers.find((u) => u.id === selectedParentId);
  const selectedChild = members?.find((m) => m.id === selectedChildId);

  if (loadingMembers || loadingUsers || loadingParentLinks) return <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="#1565C0" /></View>;

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

      {/* 학부모-자녀 연결 설정 */}
      <View className="mx-5 mb-4">
        <Text className="text-sm font-semibold text-foreground mb-3">학부모-자녀 연결</Text>
        <View className="bg-surface rounded-2xl border border-border p-4 gap-3">
          <View className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
            <Text className="text-xs text-emerald-800 leading-relaxed">
              학생 본인 계정은 위의 회원-계정 연결을 사용하고, 학부모 계정은 여기서 자녀와 연결합니다. 한 자녀에 여러 학부모를 연결할 수 있습니다.
            </Text>
          </View>

          <TouchableOpacity
            className="flex-row items-center justify-between p-3 rounded-xl border border-border bg-background"
            onPress={() => setShowParentPicker(true)}
          >
            <Text className={selectedParent ? "text-foreground text-sm" : "text-muted text-sm"}>
              {selectedParent ? `${selectedParent.name ?? "이름없음"} (${selectedParent.email ?? ""})` : "학부모 계정 선택..."}
            </Text>
            <Text className="text-muted">›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center justify-between p-3 rounded-xl border border-border bg-background"
            onPress={() => setShowChildPicker(true)}
          >
            <Text className={selectedChild ? "text-foreground text-sm" : "text-muted text-sm"}>
              {selectedChild ? `${selectedChild.name} (${selectedChild.beltRank ?? "미설정"})` : "자녀 회원 선택..."}
            </Text>
            <Text className="text-muted">›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="py-3 rounded-xl items-center"
            style={{ backgroundColor: selectedParentId && selectedChildId ? "#047857" : "#E5E7EB", opacity: linkParentMutation.isPending ? 0.6 : 1 }}
            onPress={() => {
              if (!selectedParentId || !selectedChildId) return;
              Alert.alert("연결 확인", `${selectedParent?.name ?? "학부모"} 계정을 ${selectedChild?.name ?? "자녀"} 회원과 연결하시겠습니까?`, [
                { text: "취소", style: "cancel" },
                { text: "연결", onPress: () => linkParentMutation.mutate({ parentUserId: selectedParentId, memberId: selectedChildId }) },
              ]);
            }}
            disabled={!selectedParentId || !selectedChildId || linkParentMutation.isPending}
          >
            <Text className="font-bold text-sm" style={{ color: selectedParentId && selectedChildId ? "#fff" : "#9BA1A6" }}>
              {linkParentMutation.isPending ? "연결 중..." : "학부모-자녀 연결하기"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {(parentChildLinks ?? []).length > 0 && (
        <View className="mx-5 mb-4">
          <Text className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">학부모 연결 ({(parentChildLinks ?? []).length}건)</Text>
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            {(parentChildLinks ?? []).map((link, idx) => (
              <View key={`${link.parentUserId}-${link.memberId}`} className="flex-row items-center px-4 py-3" style={{ borderTopWidth: idx > 0 ? 0.5 : 0, borderTopColor: "#E5E7EB" }}>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">{link.memberName ?? `회원 #${link.memberId}`}</Text>
                  <Text className="text-xs text-muted">{link.parentName ?? "학부모"} ({link.parentEmail ?? ""})</Text>
                </View>
                <TouchableOpacity
                  className="px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: "#FEE2E2" }}
                  onPress={() => Alert.alert("연결 해제", `${link.parentName ?? "학부모"}와 ${link.memberName ?? "자녀"} 연결을 해제하시겠습니까?`, [
                    { text: "취소", style: "cancel" },
                    { text: "해제", style: "destructive", onPress: () => unlinkParentMutation.mutate({ parentUserId: link.parentUserId, memberId: link.memberId }) },
                  ])}
                >
                  <Text className="text-xs font-semibold text-red-600">해제</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      )}

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

      {/* 학부모 계정 선택 모달 */}
      <Modal visible={showParentPicker} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View className="bg-background rounded-t-3xl px-5 pt-5" style={{ maxHeight: "70%" }}>
            <Text className="text-lg font-bold text-foreground mb-4">학부모 계정 선택</Text>
            <ScrollView>
              {parentUsers.length === 0 ? (
                <View className="py-8 items-center">
                  <Text className="text-muted text-sm">아직 학부모로 가입한 계정이 없습니다.</Text>
                </View>
              ) : parentUsers.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  className="flex-row items-center py-3 border-b border-border"
                  onPress={() => { setSelectedParentId(u.id); setShowParentPicker(false); }}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{u.name ?? "이름 없음"}</Text>
                    <Text className="text-xs text-muted">{u.email ?? ""} · 학부모</Text>
                  </View>
                  {selectedParentId === u.id && <Text className="text-primary font-bold">✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity className="py-4 items-center" onPress={() => setShowParentPicker(false)}>
              <Text className="text-muted">취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 자녀 회원 선택 모달 */}
      <Modal visible={showChildPicker} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View className="bg-background rounded-t-3xl px-5 pt-5" style={{ maxHeight: "70%" }}>
            <Text className="text-lg font-bold text-foreground mb-4">자녀 회원 선택</Text>
            <ScrollView>
              {(members ?? []).map((m) => (
                <TouchableOpacity
                  key={m.id}
                  className="flex-row items-center py-3 border-b border-border"
                  onPress={() => { setSelectedChildId(m.id); setShowChildPicker(false); }}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{m.name}</Text>
                    <Text className="text-xs text-muted">{m.beltRank ?? "미설정"} · {m.status}</Text>
                  </View>
                  {selectedChildId === m.id && <Text className="text-primary font-bold">✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity className="py-4 items-center" onPress={() => setShowChildPicker(false)}>
              <Text className="text-muted">취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
              {(users ?? []).filter((u) => u.accountType !== "parent").map(u => (
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

  const renderLog = useCallback(({ item: log, index: idx }: { item: NonNullable<typeof logs>[0]; index: number }) => {
    const ac = ACTION_COLORS[log.action] ?? "#1565C0";
    const isFirst = idx === 0;
    return (
      <View
        className="px-4 py-3 bg-surface border-border"
        style={{
          borderLeftWidth: 3,
          borderLeftColor: ac,
          borderTopWidth: isFirst ? 0.5 : 0,
          borderBottomWidth: 0.5,
          borderRightWidth: 0.5,
          borderTopColor: "#E5E7EB",
          borderBottomColor: "#E5E7EB",
          borderRightColor: "#E5E7EB",
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
  }, []);

  const listHeader = (
    <>
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
    </>
  );

  const listEmpty = (
    <View className="items-center py-12 mx-5">
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
  );

  return (
    <FlatList
      data={filtered}
      keyExtractor={idKeyExtractor}
      renderItem={renderLog}
      {...listPerfProps}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={listEmpty}
      // 기존 카드(rounded-2xl) 느낌은 버리고, 좌우 여백만 주어 행 단위 렌더로 전환.
      // 300건 .map → FlatList로 windowSize만큼만 실제 렌더되어 메모리·초기 프레임 이득.
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1565C0" colors={["#1565C0"]} />
      }
    />
  );
}

const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  announcement: "공지",
  attendance: "출석",
  payment: "납부",
  promotion: "승급",
  tournament: "대회",
  manager_ops: "운영",
};

const NOTIFICATION_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  announcement: "공지사항 등록 알림",
  attendance: "출석 체크 및 출석증 알림",
  payment: "납부 완료·만료·미납 알림",
  promotion: "승급 심사 등록·결과 알림",
  tournament: "대회 신청·결과·마감 알림",
  manager_ops: "관리자 운영 요약 알림",
};

function formatWon(value: number | null | undefined) {
  return `${Number(value ?? 0).toLocaleString("ko-KR")}원`;
}

function NotificationPreferencesTab() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const { data, isLoading, refetch } = trpc.admin.notificationPreferences.useQuery();
  const { data: defaults } = trpc.admin.notificationDefaults.useQuery();
  const mutation = trpc.admin.setNotificationPreference.useMutation({
    onSuccess: () => {
      void utils.admin.notificationPreferences.invalidate();
      void utils.admin.activityLogs.invalidate();
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });
  const defaultMutation = trpc.admin.setNotificationDefault.useMutation({
    onSuccess: () => {
      void utils.admin.notificationDefaults.invalidate();
      void utils.admin.notificationPreferences.invalidate();
      void utils.admin.activityLogs.invalidate();
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });
  const applyDefaultsMutation = trpc.admin.applyNotificationDefaults.useMutation({
    onSuccess: (result) => {
      void utils.admin.notificationDefaults.invalidate();
      void utils.admin.notificationPreferences.invalidate();
      void utils.admin.activityLogs.invalidate();
      Alert.alert("적용 완료", `사용자 ${result.users}명에게 알림 정책 ${result.preferences}개를 반영했습니다.`);
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (user) =>
        (user.name ?? "").toLowerCase().includes(q) ||
        (user.email ?? "").toLowerCase().includes(q) ||
        ROLE_LABELS[user.role as UserRole]?.includes(q),
    );
  }, [data, search]);

  const totals = useMemo(() => {
    const users = data ?? [];
    let disabled = 0;
    let enabled = 0;
    for (const user of users) {
      for (const pref of user.preferences) {
        if (pref.enabled) enabled++;
        else disabled++;
      }
    }
    return { users: users.length, enabled, disabled };
  }, [data]);

  if (isLoading) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="#1565C0" /></View>;
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
      <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-4">
        <Text className="text-sm font-semibold text-foreground mb-1">관리자 승인형 알림 설정</Text>
        <Text className="text-xs text-muted leading-5">
          회원별로 받을 수 있는 푸시 알림을 최고관리자가 직접 on/off 합니다. 꺼진 항목은 서버 발송 단계에서 제외됩니다.
        </Text>
        <View className="flex-row flex-wrap gap-2 mt-3">
          <View className="px-2 py-1 rounded-lg bg-blue-50"><Text className="text-xs font-semibold text-blue-800">사용자 {totals.users}명</Text></View>
          <View className="px-2 py-1 rounded-lg bg-green-50"><Text className="text-xs font-semibold text-green-800">허용 {totals.enabled}개</Text></View>
          <View className="px-2 py-1 rounded-lg bg-red-50"><Text className="text-xs font-semibold text-red-800">차단 {totals.disabled}개</Text></View>
        </View>
      </View>

      <View className="mx-5 mb-4 bg-blue-50 rounded-2xl border border-blue-100 p-4">
        <Text className="text-sm font-semibold text-blue-900 mb-1">신규 사용자 기본 알림 정책</Text>
        <Text className="text-xs text-blue-800 leading-5 mb-3">
          개별 승인값이 없는 신규 가입자는 아래 기본값을 따릅니다. 기존 사용자도 “상속” 상태인 항목은 이 정책이 적용됩니다.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(defaults ?? []).map((pref) => (
            <TouchableOpacity
              key={pref.category}
              className="px-3 py-2 rounded-xl border"
              style={{
                width: "48%",
                backgroundColor: pref.enabled ? "#ECFDF5" : "#FEF2F2",
                borderColor: pref.enabled ? "#86EFAC" : "#FCA5A5",
                opacity: defaultMutation.isPending ? 0.7 : 1,
              }}
              disabled={defaultMutation.isPending}
              onPress={() => defaultMutation.mutate({ category: pref.category, enabled: !pref.enabled })}
            >
              <Text className="text-xs font-bold" style={{ color: pref.enabled ? "#166534" : "#991B1B" }}>
                {NOTIFICATION_CATEGORY_LABELS[pref.category] ?? pref.category} 기본 {pref.enabled ? "ON" : "OFF"}
              </Text>
              <Text className="text-[10px] text-muted mt-1" numberOfLines={1}>
                신규/상속 사용자에게 적용
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          className="mt-3 rounded-xl px-4 py-3 items-center"
          style={{ backgroundColor: applyDefaultsMutation.isPending ? "#93C5FD" : "#1565C0" }}
          disabled={applyDefaultsMutation.isPending}
          onPress={() => applyDefaultsMutation.mutate()}
        >
          <Text className="text-xs font-bold text-white">
            {applyDefaultsMutation.isPending ? "전체 적용 중..." : "현재 기본 정책을 전체 사용자에게 적용"}
          </Text>
        </TouchableOpacity>
      </View>

      <View className="mx-5 mb-3 flex-row items-center gap-2">
        <TextInput
          className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-foreground text-sm"
          placeholder="이름·이메일·역할 검색"
          placeholderTextColor="#9BA1A6"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        <TouchableOpacity onPress={() => void refetch()} className="px-3 py-2.5 rounded-xl border border-border">
          <Text className="text-xs text-primary font-semibold">새로고침</Text>
        </TouchableOpacity>
      </View>

      <View className="mx-5 gap-3">
        {filtered.map((user) => (
          <View key={user.id} className="bg-surface rounded-2xl border border-border p-4">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-1">
                <Text className="text-sm font-bold text-foreground">{user.name ?? "이름 없음"}</Text>
                <Text className="text-xs text-muted mt-0.5">{user.email ?? "이메일 없음"} · {ROLE_LABELS[user.role as UserRole]}</Text>
              </View>
              <View className="px-2 py-1 rounded-full" style={{ backgroundColor: ROLE_BG[user.role as UserRole] ?? "#F5F5F5" }}>
                <Text className="text-xs font-semibold" style={{ color: ROLE_COLORS[user.role as UserRole] ?? "#687076" }}>
                  {ROLE_LABELS[user.role as UserRole] ?? user.role}
                </Text>
              </View>
            </View>

            <View className="flex-row flex-wrap gap-2">
              {user.preferences.map((pref) => (
                <TouchableOpacity
                  key={`${user.id}-${pref.category}`}
                  className="px-3 py-2 rounded-xl border"
                  style={{
                    width: "48%",
                    backgroundColor: pref.enabled ? "#ECFDF5" : "#FEF2F2",
                    borderColor: pref.enabled ? "#86EFAC" : "#FCA5A5",
                    opacity: mutation.isPending ? 0.7 : 1,
                  }}
                  disabled={mutation.isPending}
                  onPress={() => mutation.mutate({ userId: user.id, category: pref.category, enabled: !pref.enabled })}
                >
                  <Text className="text-xs font-bold" style={{ color: pref.enabled ? "#166534" : "#991B1B" }}>
                    {NOTIFICATION_CATEGORY_LABELS[pref.category] ?? pref.category} {pref.enabled ? "ON" : "OFF"}
                  </Text>
                  <Text className="text-[10px] text-muted mt-1" numberOfLines={2}>
                    {NOTIFICATION_CATEGORY_DESCRIPTIONS[pref.category] ?? "알림 설정"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {filtered.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-4xl mb-3">🔕</Text>
            <Text className="text-muted">조건에 맞는 사용자가 없습니다.</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function BackupRestoreTab() {
  const utils = trpc.useUtils();
  const [backupJson, setBackupJson] = useState("");
  const [importJson, setImportJson] = useState("");

  const createBackupMutation = trpc.admin.createBackup.useMutation({
    onSuccess: (data) => {
      setBackupJson(JSON.stringify(data, null, 2));
      void utils.admin.activityLogs.invalidate();
      Alert.alert("완료", "백업 JSON을 생성했습니다.");
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });
  const importMutation = trpc.admin.importBackupMembers.useMutation({
    onSuccess: (result) => {
      void utils.admin.activityLogs.invalidate();
      void utils.members.list.invalidate();
      Alert.alert("가져오기 완료", `생성 ${result.created}명, 건너뜀 ${result.skipped}명`);
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  const handleShareBackup = async () => {
    if (!backupJson) return;
    await Share.share({ message: backupJson });
  };

  const handleCopyBackup = async () => {
    if (!backupJson) return;
    const copied = await copyText(backupJson);
    Alert.alert(copied ? "복사됨" : "복사 미지원", copied ? "백업 JSON을 클립보드에 복사했습니다." : "공유 버튼을 이용해 주세요.");
  };

  const handleImport = () => {
    if (!importJson.trim()) {
      Alert.alert("확인", "가져올 백업 JSON을 붙여넣어 주세요.");
      return;
    }
    Alert.alert(
      "회원 안전 복구",
      "동명이인/연락처 중복은 건너뛰고, 누락된 회원만 추가합니다. 계속할까요?",
      [
        { text: "취소", style: "cancel" },
        { text: "가져오기", onPress: () => importMutation.mutate({ backupJson: importJson }) },
      ],
    );
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
      <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-4">
        <Text className="text-sm font-semibold text-foreground mb-1">DB 백업/복구</Text>
        <Text className="text-xs text-muted leading-5">
          백업은 사용자 비밀번호 해시를 제외하고 JSON으로 생성합니다. 복구는 안전을 위해 기존 데이터를 덮어쓰지 않고, 누락된 회원만 추가합니다.
        </Text>
      </View>

      <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-4 gap-3">
        <TouchableOpacity
          className="py-3 rounded-xl items-center"
          style={{ backgroundColor: "#4F46E5", opacity: createBackupMutation.isPending ? 0.6 : 1 }}
          disabled={createBackupMutation.isPending}
          onPress={() => createBackupMutation.mutate()}
        >
          <Text className="text-white font-bold">{createBackupMutation.isPending ? "생성 중..." : "백업 JSON 생성"}</Text>
        </TouchableOpacity>
        {backupJson ? (
          <>
            <TextInput
              className="bg-background border border-border rounded-xl px-3 py-3 text-foreground text-xs"
              value={backupJson}
              onChangeText={setBackupJson}
              multiline
              numberOfLines={8}
              style={{ minHeight: 160, textAlignVertical: "top" }}
            />
            <View className="flex-row gap-2">
              <TouchableOpacity className="flex-1 py-3 rounded-xl items-center bg-primary" onPress={handleShareBackup}>
                <Text className="text-white font-bold text-sm">공유</Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 py-3 rounded-xl items-center border border-border" onPress={handleCopyBackup}>
                <Text className="text-foreground font-bold text-sm">복사</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </View>

      <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-4 gap-3">
        <Text className="text-sm font-semibold text-foreground">회원 안전 복구</Text>
        <Text className="text-xs text-muted leading-5">백업 JSON을 붙여넣으면 기존 회원은 유지하고, 누락된 회원만 추가합니다.</Text>
        <TextInput
          className="bg-background border border-border rounded-xl px-3 py-3 text-foreground text-xs"
          placeholder="백업 JSON 붙여넣기"
          placeholderTextColor="#9BA1A6"
          value={importJson}
          onChangeText={setImportJson}
          multiline
          numberOfLines={8}
          style={{ minHeight: 160, textAlignVertical: "top" }}
        />
        <TouchableOpacity
          className="py-3 rounded-xl items-center"
          style={{ backgroundColor: "#9333EA", opacity: importMutation.isPending ? 0.6 : 1 }}
          disabled={importMutation.isPending}
          onPress={handleImport}
        >
          <Text className="text-white font-bold">{importMutation.isPending ? "가져오는 중..." : "누락 회원 가져오기"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function MonthlyReportTab() {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const { data, isLoading, error, refetch } = trpc.dashboard.monthlyReport.useQuery(cursor);

  const moveMonth = (delta: number) => {
    setCursor((current) => {
      const d = new Date(current.year, current.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  };

  const cards = data ? [
    { label: "전체 회원", value: `${data.totals.totalMembers}명`, color: "#1565C0" },
    { label: "활성 회원", value: `${data.totals.activeMembers}명`, color: "#16A34A" },
    { label: "신규 회원", value: `${data.totals.newMembers}명`, color: "#0F766E" },
    { label: "출석 기록", value: `${data.totals.attendance}건`, color: "#2563EB" },
    { label: "월 매출", value: formatWon(data.totals.revenue), color: "#EA580C" },
    { label: "사진 기록", value: `${data.totals.photos}장`, color: "#9333EA" },
  ] : [];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
      <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-4">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity className="px-3 py-2 rounded-xl border border-border" onPress={() => moveMonth(-1)}>
            <Text className="text-sm font-bold text-foreground">‹ 이전</Text>
          </TouchableOpacity>
          <View className="items-center">
            <Text className="text-lg font-bold text-foreground">{cursor.year}년 {cursor.month}월</Text>
            <Text className="text-xs text-muted">월간 운영 리포트</Text>
          </View>
          <TouchableOpacity className="px-3 py-2 rounded-xl border border-border" onPress={() => moveMonth(1)}>
            <Text className="text-sm font-bold text-foreground">다음 ›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center py-16"><ActivityIndicator size="large" color="#1565C0" /></View>
      ) : error ? (
        <View className="mx-5 bg-red-50 rounded-2xl border border-red-100 p-4">
          <Text className="text-sm font-bold text-red-800 mb-1">리포트를 불러오지 못했습니다</Text>
          <Text className="text-xs text-red-700 mb-3">{getFriendlyErrorMessage(error)}</Text>
          <TouchableOpacity className="px-4 py-2 rounded-xl bg-white border border-red-200" onPress={() => void refetch()}>
            <Text className="text-red-800 font-bold text-sm">다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <>
          <View className="mx-5 mb-4 flex-row flex-wrap gap-2">
            {cards.map((card) => (
              <View
                key={card.label}
                className="rounded-2xl border p-4"
                style={{ width: "48%", borderColor: `${card.color}44`, backgroundColor: `${card.color}10` }}
              >
                <Text className="text-xl font-bold" style={{ color: card.color }}>{card.value}</Text>
                <Text className="text-xs text-muted mt-1">{card.label}</Text>
              </View>
            ))}
          </View>

          <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-4">
            <Text className="text-sm font-semibold text-foreground mb-3">출석 세부</Text>
            <View className="flex-row flex-wrap gap-2">
              {[
                ["출석", data.attendance.present, "#2563EB"],
                ["지각", data.attendance.late, "#F59E0B"],
                ["결석", data.attendance.absent, "#DC2626"],
                ["보강", data.attendance.makeup, "#16A34A"],
                ["체험", data.attendance.trial, "#EAB308"],
              ].map(([label, value, color]) => (
                <View key={String(label)} className="px-3 py-2 rounded-xl" style={{ backgroundColor: `${color}16` }}>
                  <Text className="text-xs font-bold" style={{ color: String(color) }}>{label} {value}건</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="mx-5 bg-surface rounded-2xl border border-border p-4">
            <Text className="text-sm font-semibold text-foreground mb-3">운영 요약</Text>
            <Text className="text-xs text-muted leading-5">
              납부 {data.payments.count}건 · 승급심사 {data.totals.promotions}건 · 대회 {data.totals.tournaments}건{"\n"}
              심사 결과: 예정 {data.promotions.pending}건, 합격 {data.promotions.passed}건, 불합격 {data.promotions.failed}건
            </Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const QA_STORAGE_KEY = "admin_release_qa_checklist_v1";
const QA_ITEMS = [
  { id: "login-member", group: "인증", title: "회원 앱 로그인/회원가입", desc: "회원 전용 APK에서 가입과 로그인이 성공하는지 확인" },
  { id: "login-admin", group: "인증", title: "관리자 앱 로그인", desc: "관리자 전용 APK에서 관리자 계정 접근이 되는지 확인" },
  { id: "member-create", group: "회원", title: "회원 등록/수정", desc: "회원 추가, 상세 수정, 프로필 사진 업로드 확인" },
  { id: "attendance", group: "출석", title: "출석 체크/달력", desc: "관리자 출석 등록과 회원 출석달력 반영 확인" },
  { id: "payment", group: "납부", title: "납부 등록/등록기간", desc: "납부 후 다음 납부일과 회원 등록기간 화면 확인" },
  { id: "promotion", group: "승급", title: "승급 심사", desc: "심사 등록, 결과 변경, 회원 알림/화면 반영 확인" },
  { id: "tournament", group: "대회", title: "대회 참가/결과", desc: "체급·부문·참가비·안내사항·결과 표시 확인" },
  { id: "photo", group: "사진", title: "출석 사진 기록", desc: "사진 업로드, 삭제, 기록 탭 표시 확인" },
  { id: "push", group: "알림", title: "푸시/알림 승인", desc: "알림 기본 정책과 사용자별 ON/OFF 반영 확인" },
  { id: "backup", group: "운영", title: "백업/복구", desc: "백업 JSON 생성, 누락 회원 가져오기 안전 동작 확인" },
  { id: "network", group: "운영", title: "네트워크/DB 오류", desc: "API health, Cloudflare 터널, DB 연결 오류 메시지 확인" },
  { id: "build", group: "출시", title: "APK 설치/실기기 테스트", desc: "관리자/회원 APK 각각 설치 후 핵심 플로우 확인" },
] as const;

type AutoQaResult = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

function QAChecklistTab() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [autoChecking, setAutoChecking] = useState(false);
  const [autoResults, setAutoResults] = useState<AutoQaResult[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(QA_STORAGE_KEY).then((value) => {
      if (!value) return;
      try {
        setChecked(JSON.parse(value) as Record<string, boolean>);
      } catch {
        setChecked({});
      }
    });
  }, []);

  const saveChecked = useCallback(async (next: Record<string, boolean>) => {
    setChecked(next);
    await AsyncStorage.setItem(QA_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const toggle = (id: string) => {
    void saveChecked({ ...checked, [id]: !checked[id] });
  };

  const reset = () => {
    Alert.alert("QA 체크 초기화", "체크 상태를 모두 초기화할까요?", [
      { text: "취소", style: "cancel" },
      { text: "초기화", style: "destructive", onPress: () => void saveChecked({}) },
    ]);
  };

  const runAutoCheck = async () => {
    setAutoChecking(true);
    const results: AutoQaResult[] = [];
    const apiBaseUrl = getApiBaseUrl();

    results.push({
      id: "login-admin",
      label: "관리자 앱 변형",
      ok: IS_ADMIN_APP,
      detail: IS_ADMIN_APP ? "관리자 전용 빌드로 실행 중입니다." : "회원 앱 변형으로 실행 중입니다.",
    });
    results.push({
      id: "network",
      label: "API 주소",
      ok: /^https?:\/\//.test(apiBaseUrl),
      detail: apiBaseUrl || "API 주소가 비어 있습니다.",
    });

    try {
      const response = await fetch(`${apiBaseUrl}/api/health`);
      const text = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      const envOk = Boolean(json?.env?.ok);
      const ok = response.ok && Boolean(json?.ok) && envOk;
      results.push({
        id: "network",
        label: "API/DB Health",
        ok,
        detail: ok
          ? "API와 필수 서버 환경변수가 정상입니다."
          : `HTTP ${response.status}${json?.env?.missing?.length ? ` · 누락 ${json.env.missing.join(", ")}` : ""}`,
      });
    } catch (error) {
      results.push({
        id: "network",
        label: "API/DB Health",
        ok: false,
        detail: error instanceof Error ? error.message : "health 요청 실패",
      });
    }

    const next = { ...checked };
    for (const result of results) {
      if (result.ok) next[result.id] = true;
    }
    setAutoResults(results);
    await saveChecked(next);
    setAutoChecking(false);
  };

  const done = QA_ITEMS.filter((item) => checked[item.id]).length;
  const progress = Math.round((done / QA_ITEMS.length) * 100);
  const groups = Array.from(new Set(QA_ITEMS.map((item) => item.group)));

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
      <View className="mx-5 mb-4 bg-surface rounded-2xl border border-border p-4">
        <View className="flex-row items-center justify-between mb-2">
          <View>
            <Text className="text-sm font-bold text-foreground">출시 전 QA 체크리스트</Text>
            <Text className="text-xs text-muted mt-0.5">실기기에서 확인할 핵심 플로우를 순서대로 점검합니다.</Text>
          </View>
          <TouchableOpacity onPress={reset} className="px-3 py-2 rounded-xl border border-border">
            <Text className="text-xs font-bold text-muted">초기화</Text>
          </TouchableOpacity>
        </View>
        <View className="h-2 rounded-full bg-background overflow-hidden mt-3">
          <View style={{ width: `${progress}%`, height: "100%", backgroundColor: progress === 100 ? "#16A34A" : "#1565C0" }} />
        </View>
        <Text className="text-xs text-muted mt-2">완료 {done}/{QA_ITEMS.length}개 · {progress}%</Text>
        <TouchableOpacity
          onPress={() => void runAutoCheck()}
          disabled={autoChecking}
          className="mt-3 rounded-xl px-4 py-3 items-center"
          style={{ backgroundColor: autoChecking ? "#93C5FD" : "#1565C0" }}
        >
          <Text className="text-xs font-bold text-white">{autoChecking ? "자동 점검 중..." : "앱/API 자동 점검"}</Text>
        </TouchableOpacity>
        {autoResults.length > 0 ? (
          <View className="mt-3 gap-2">
            {autoResults.map((result, index) => (
              <View
                key={`${result.label}-${index}`}
                className="rounded-xl border px-3 py-2"
                style={{
                  backgroundColor: result.ok ? "#ECFDF5" : "#FEF2F2",
                  borderColor: result.ok ? "#86EFAC" : "#FCA5A5",
                }}
              >
                <Text className="text-xs font-bold" style={{ color: result.ok ? "#166534" : "#991B1B" }}>
                  {result.ok ? "통과" : "확인 필요"} · {result.label}
                </Text>
                <Text className="text-[11px] text-muted mt-1">{result.detail}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {groups.map((group) => (
        <View key={group} className="mx-5 mb-4">
          <Text className="text-xs font-semibold text-muted mb-2">{group}</Text>
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            {QA_ITEMS.filter((item) => item.group === group).map((item, index) => {
              const isChecked = Boolean(checked[item.id]);
              return (
                <TouchableOpacity
                  key={item.id}
                  className="flex-row items-start gap-3 px-4 py-3"
                  style={{ borderTopWidth: index > 0 ? 0.5 : 0, borderTopColor: "#E5E7EB" }}
                  onPress={() => toggle(item.id)}
                  activeOpacity={0.78}
                >
                  <View className="w-7 h-7 rounded-full items-center justify-center mt-0.5" style={{ backgroundColor: isChecked ? "#16A34A" : "#F1F5F9" }}>
                    <Text className="text-xs font-bold" style={{ color: isChecked ? "#FFFFFF" : "#94A3B8" }}>{isChecked ? "✓" : ""}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-foreground">{item.title}</Text>
                    <Text className="text-xs text-muted mt-1 leading-5">{item.desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
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
      setSelectedMemberId(null);
      void utils.admin.myInvites.invalidate();
      void utils.admin.activityLogs.invalidate();
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  const selectedMember = members?.find(m => m.id === selectedMemberId);
  const inviteUrl = lastToken ? `${MEMBER_INVITE_SCHEME}://invite/${lastToken}` : null;

  function handleShare() {
    if (!inviteUrl) return;
    Share.share({ message: `유도장 앱 초대 링크입니다:\n${inviteUrl}\n\n7일 이내에 앱에서 사용하세요.` });
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    const copied = await copyText(inviteUrl);
    if (copied) {
      Alert.alert("복사됨", "초대 링크를 클립보드에 복사했습니다.");
      return;
    }
    Alert.alert("복사 미지원", "이 환경에서는 클립보드 복사를 지원하지 않아 공유 시트를 엽니다.");
    await Share.share({ message: inviteUrl });
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
  const { user, isAuthenticated, refresh } = useAuth();
  const isAdmin = IS_ADMIN_APP && user?.role === "admin";
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState(0);

  // 뒤로가기: 서브탭 한 단계씩 앞으로(3→2→1→0), 0이면 앱 종료 확인
  useTabBackHandler(activeTab > 0 ? () => setActiveTab((t) => t - 1) : undefined);

  const { data: adminCount, isLoading: isAdminCountLoading } = trpc.admin.adminCount.useQuery(undefined, { enabled: isAuthenticated && IS_ADMIN_APP });
  const claimAdminMutation = trpc.admin.claimAdmin.useMutation({
    onSuccess: async () => {
      Alert.alert("완료", "최고관리자로 설정되었습니다. 앱을 재시작하거나 다시 로그인해 주세요.");
      void utils.admin.adminCount.invalidate();
      void utils.admin.users.invalidate();
      void utils.admin.activityLogs.invalidate();
      await refresh();
    },
    onError: (e) => Alert.alert(getFriendlyErrorTitle(e), getFriendlyErrorMessage(e)),
  });

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-muted text-center">로그인이 필요합니다</Text>
      </ScreenContainer>
    );
  }

  if (!IS_ADMIN_APP) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <View className="items-center gap-4 max-w-xs">
          <Text className="text-5xl">🔒</Text>
          <Text className="text-xl font-bold text-foreground text-center">관리자 전용 앱에서만 사용할 수 있습니다</Text>
          <Text className="text-sm text-muted text-center leading-relaxed">
            회원 전용 앱에는 관리자 기능을 노출하지 않습니다. 관리자 APK로 로그인해 주세요.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (isAdminCountLoading) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <ActivityIndicator size="large" color="#1565C0" />
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

  const TABS = ["사용자 관리", "회원 연결", "알림 승인", "백업/복구", "월간 리포트", "QA 체크", "감사 로그", "초대 링크"];

  return (
    <ScreenContainer>
      <DojoBackdrop variant="admin">
      <DojoHeroCard
        variant="admin"
        eyebrow="ADMIN CONTROL"
        title="관리자 설정"
        subtitle="권한, 회원 연결, 알림 승인, 백업, QA를 한 곳에서 운영하세요."
        metric={user?.role === "admin" ? "최고관리자" : "관리자"}
      />

      <TabBar tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === 0 && <UsersTab currentUserId={user?.id} />}
      {activeTab === 1 && <LinkMemberTab />}
      {activeTab === 2 && <NotificationPreferencesTab />}
      {activeTab === 3 && <BackupRestoreTab />}
      {activeTab === 4 && <MonthlyReportTab />}
      {activeTab === 5 && <QAChecklistTab />}
      {activeTab === 6 && <ActivityLogsTab />}
      {activeTab === 7 && <InviteTab />}
      </DojoBackdrop>
    </ScreenContainer>
  );
}
