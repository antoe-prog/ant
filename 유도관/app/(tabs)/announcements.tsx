import React, { useState, useEffect, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendAnnouncementNotification } from "@/lib/notifications";
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  Alert, ActivityIndicator, TextInput, ScrollView, Switch,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { formatDateTime, formatDate } from "@/lib/judo-utils";
import { useTabBackHandler, useModalBackHandler } from "@/hooks/use-back-handler";
import { idKeyExtractor, listPerfProps } from "@/lib/list-utils";
import { EmptyState, PillButton } from "@/components/ui/primitives";
import { useColors } from "@/hooks/use-colors";

export default function AnnouncementsScreen() {
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const utils = trpc.useUtils();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<{
    id: number; title: string; content: string; isPinned: boolean; pinnedUntil: string | null;
  } | null>(null);
  const [viewItem, setViewItem] = useState<{
    id: number; title: string; content: string; isPinned: boolean; createdAt: Date | string;
    pinnedUntil: string | null; isPinnedEffective: boolean; readAt: Date | string | null;
  } | null>(null);
  const [form, setForm] = useState({ title: "", content: "", isPinned: false, pinnedUntil: "" });
  const markedReadRef = useRef<Set<number>>(new Set());

  useTabBackHandler();
  useModalBackHandler(showAdd, () => { setShowAdd(false); setForm({ title: "", content: "", isPinned: false, pinnedUntil: "" }); });
  useModalBackHandler(!!editItem, () => setEditItem(null));
  useModalBackHandler(!!viewItem, () => setViewItem(null));

  const { data: items, isLoading } = trpc.announcements.list.useQuery();

  const markReadMutation = trpc.announcements.markRead.useMutation({
    onSuccess: () => {
      utils.announcements.list.invalidate();
      setViewItem(v => (v ? { ...v, readAt: new Date() } : null));
    },
  });

  useEffect(() => {
    if (!viewItem) return;
    if (markedReadRef.current.has(viewItem.id)) return;
    markedReadRef.current.add(viewItem.id);
    markReadMutation.mutate({ announcementId: viewItem.id });
  }, [viewItem?.id]);

  const createMutation = trpc.announcements.create.useMutation({
    onSuccess: (_, variables) => {
      utils.announcements.list.invalidate();
      setShowAdd(false);
      // 공지 등록 시 로컴 알림 발송
      sendAnnouncementNotification({ title: variables.title, content: variables.content });
      setForm({ title: "", content: "", isPinned: false, pinnedUntil: "" });
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const updateMutation = trpc.announcements.update.useMutation({
    onSuccess: () => { utils.announcements.list.invalidate(); setEditItem(null); },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const deleteMutation = trpc.announcements.delete.useMutation({
    onSuccess: () => utils.announcements.list.invalidate(),
    onError: (e) => Alert.alert("오류", e.message),
  });

  const handleDelete = (id: number) => {
    Alert.alert("공지 삭제", "이 공지사항을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => deleteMutation.mutate({ id }) },
    ]);
  };

  return (
    <ScreenContainer>
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between">
        <Text className="text-2xl font-bold text-foreground">공지사항</Text>
        {isManager && <PillButton label="+ 공지 작성" onPress={() => setShowAdd(true)} />}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={idKeyExtractor}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 10 }}
          {...listPerfProps}
          ListEmptyComponent={<EmptyState emoji="📢" title="공지사항이 없습니다" subtitle="관리자가 등록하면 여기에 표시됩니다." />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{ backgroundColor: "transparent" }}
              onPress={() => setViewItem({
                id: item.id,
                title: item.title,
                content: item.content,
                isPinned: item.isPinned ?? false,
                createdAt: item.createdAt as Date | string,
                pinnedUntil: (item as { pinnedUntil?: string | null }).pinnedUntil ?? null,
                isPinnedEffective: (item as { isPinnedEffective?: boolean }).isPinnedEffective ?? false,
                readAt: (item as { readAt?: Date | string | null }).readAt ?? null,
              })}
              activeOpacity={0.7}
            >
              <View className="bg-surface rounded-2xl border border-border p-4">
                <View className="flex-row items-start justify-between gap-2">
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2 mb-1">
                      {!item.readAt && (
                        <View
                          className="w-2 h-2 rounded-full mt-1.5"
                          style={{ backgroundColor: colors.primary }}
                          accessibilityLabel="미읽음"
                        />
                      )}
                      {(item as { isPinnedEffective?: boolean }).isPinnedEffective ? (
                        <View
                          className="px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: colors.primary + "20" }}
                        >
                          <Text className="text-xs font-semibold" style={{ color: colors.primary }}>📌 고정</Text>
                        </View>
                      ) : null}
                      <Text className="text-base font-semibold text-foreground flex-1">{item.title}</Text>
                    </View>
                    {(item as { pinnedUntil?: string | null }).pinnedUntil &&
                      (item as { isPinnedEffective?: boolean }).isPinnedEffective ? (
                      <Text className="text-[10px] text-muted mb-1">
                        고정 만료 {formatDate((item as { pinnedUntil: string }).pinnedUntil)}
                      </Text>
                    ) : null}
                    <Text className="text-sm text-muted leading-5 mb-2" numberOfLines={2}>{item.content}</Text>
                    <Text className="text-xs text-muted">{formatDateTime(item.createdAt)}</Text>
                  </View>
                  <View className="items-end gap-2">
                    <Text className="text-xs text-muted">›</Text>
                    {isManager && (
                      <View className="gap-1">
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation?.(); setEditItem({
                            id: item.id,
                            title: item.title,
                            content: item.content,
                            isPinned: item.isPinned ?? false,
                            pinnedUntil: (item as { pinnedUntil?: string | null }).pinnedUntil ?? null,
                          }); }}
                        >
                          <Text className="text-xs text-primary">수정</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); handleDelete(item.id); }}>
                          <Text className="text-xs text-error">삭제</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* 공지 작성 모달 */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <Text className="text-xl font-bold text-foreground">공지 작성</Text>
            <TouchableOpacity onPress={() => { setShowAdd(false); setForm({ title: "", content: "", isPinned: false, pinnedUntil: "" }); }}>
              <Text className="text-primary font-semibold">취소</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-5">
            <View className="py-4 gap-4">
              <View>
                <Text className="text-sm font-medium text-foreground mb-1">제목 *</Text>
                <TextInput
                  className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                  value={form.title}
                  onChangeText={v => setForm(f => ({ ...f, title: v }))}
                  placeholder="공지 제목"
                  placeholderTextColor={colors.muted}
                />
              </View>
              <View>
                <Text className="text-sm font-medium text-foreground mb-1">내용 *</Text>
                <TextInput
                  className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                  value={form.content}
                  onChangeText={v => setForm(f => ({ ...f, content: v }))}
                  placeholder="공지 내용을 입력하세요"
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={6}
                  style={{ height: 120, textAlignVertical: "top" }}
                />
              </View>
              <View className="flex-row items-center justify-between bg-surface rounded-xl p-4 border border-border">
                <Text className="text-sm font-medium text-foreground">상단 고정</Text>
                <Switch
                  value={form.isPinned}
                  onValueChange={v => setForm(f => ({ ...f, isPinned: v, pinnedUntil: v ? f.pinnedUntil : "" }))}
                  trackColor={{ true: "#1565C0" }}
                />
              </View>
              {form.isPinned && (
                <View>
                  <Text className="text-sm font-medium text-foreground mb-1">고정 만료일 (선택, YYYY-MM-DD)</Text>
                  <Text className="text-xs text-muted mb-2">비우면 만료 없이 고정됩니다. 지나면 목록에서 자동으로 고정 해제처럼 표시됩니다.</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                    value={form.pinnedUntil}
                    onChangeText={v => setForm(f => ({ ...f, pinnedUntil: v }))}
                    placeholder="예: 2026-12-31"
                    placeholderTextColor="#9BA1A6"
                  />
                </View>
              )}
            </View>
          </ScrollView>
          <View className="px-5 pt-3 border-t border-border" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
            <TouchableOpacity
              style={{ backgroundColor: "#1565C0" }}
              className="rounded-2xl py-4 items-center"
              onPress={() => {
                if (!form.title.trim()) { Alert.alert("오류", "제목을 입력하세요"); return; }
                if (!form.content.trim()) { Alert.alert("오류", "내용을 입력하세요"); return; }
                const pu = form.pinnedUntil.trim();
                if (form.isPinned && pu && !/^\d{4}-\d{2}-\d{2}$/.test(pu)) {
                  Alert.alert("오류", "고정 만료일은 YYYY-MM-DD 형식이어야 합니다.");
                  return;
                }
                createMutation.mutate({
                  title: form.title.trim(),
                  content: form.content.trim(),
                  isPinned: form.isPinned,
                  pinnedUntil: form.isPinned && pu ? pu : null,
                });
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text className="text-white font-bold text-base">공지 등록</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 공지 수정 모달 */}
      <Modal visible={!!editItem} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <Text className="text-xl font-bold text-foreground">공지 수정</Text>
            <TouchableOpacity onPress={() => setEditItem(null)}>
              <Text className="text-primary font-semibold">취소</Text>
            </TouchableOpacity>
          </View>
          {editItem && (
            <ScrollView className="flex-1 px-5">
              <View className="py-4 gap-4">
                <View>
                  <Text className="text-sm font-medium text-foreground mb-1">제목</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                    value={editItem.title}
                    onChangeText={v => setEditItem(e => e ? { ...e, title: v } : null)}
                    placeholderTextColor="#9BA1A6"
                  />
                </View>
                <View>
                  <Text className="text-sm font-medium text-foreground mb-1">내용</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                    value={editItem.content}
                    onChangeText={v => setEditItem(e => e ? { ...e, content: v } : null)}
                    multiline
                    numberOfLines={6}
                    style={{ height: 120, textAlignVertical: "top" }}
                    placeholderTextColor="#9BA1A6"
                  />
                </View>
                <View className="flex-row items-center justify-between bg-surface rounded-xl p-4 border border-border">
                  <Text className="text-sm font-medium text-foreground">상단 고정</Text>
                  <Switch
                    value={editItem.isPinned}
                    onValueChange={v => setEditItem(e => e ? { ...e, isPinned: v, pinnedUntil: v ? e.pinnedUntil : null } : null)}
                    trackColor={{ true: "#1565C0" }}
                  />
                </View>
                {editItem.isPinned && (
                  <View>
                    <Text className="text-sm font-medium text-foreground mb-1">고정 만료일 (선택)</Text>
                    <TextInput
                      className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                      value={editItem.pinnedUntil ?? ""}
                      onChangeText={v => setEditItem(e => e ? { ...e, pinnedUntil: v || null } : null)}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#9BA1A6"
                    />
                  </View>
                )}
              </View>
            </ScrollView>
          )}
          <View className="px-5 pt-3 border-t border-border" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
            <TouchableOpacity
              style={{ backgroundColor: "#1565C0" }}
              className="rounded-2xl py-4 items-center"
              onPress={() => {
                if (!editItem) return;
                const pu = (editItem.pinnedUntil ?? "").trim();
                if (editItem.isPinned && pu && !/^\d{4}-\d{2}-\d{2}$/.test(pu)) {
                  Alert.alert("오류", "고정 만료일은 YYYY-MM-DD 형식이어야 합니다.");
                  return;
                }
                updateMutation.mutate({
                  id: editItem.id,
                  title: editItem.title,
                  content: editItem.content,
                  isPinned: editItem.isPinned,
                  pinnedUntil: editItem.isPinned ? (pu || null) : null,
                });
              }}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text className="text-white font-bold text-base">수정 완료</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* 공지 상세 보기 모달 */}
      <Modal visible={!!viewItem} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <View className="flex-1 mr-4">
              {viewItem?.isPinnedEffective ? (
                <View className="flex-row items-center gap-1 mb-1 flex-wrap">
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: "#1565C020" }}>
                    <Text className="text-xs font-semibold" style={{ color: "#1565C0" }}>📌 고정 공지</Text>
                  </View>
                  {viewItem.pinnedUntil ? (
                    <Text className="text-xs text-muted">만료 {formatDate(viewItem.pinnedUntil)}</Text>
                  ) : null}
                </View>
              ) : null}
              <Text className="text-xl font-bold text-foreground" numberOfLines={2}>{viewItem?.title}</Text>
            </View>
            <TouchableOpacity onPress={() => setViewItem(null)}>
              <Text className="text-primary font-semibold">닫기</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-5 py-4">
            <Text className="text-sm text-muted mb-4">
              {viewItem ? formatDateTime(viewItem.createdAt) : ""}
              {viewItem?.readAt ? ` · 읽음 ${formatDateTime(viewItem.readAt)}` : ""}
            </Text>
            <Text className="text-base text-foreground leading-7">{viewItem?.content}</Text>
          </ScrollView>
          {isManager && viewItem && (
            <View className="px-5 pt-3 border-t border-border flex-row gap-3" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
              <TouchableOpacity
                className="flex-1 rounded-2xl py-3 items-center border border-border"
                onPress={() => {
                  setEditItem({
                    id: viewItem.id,
                    title: viewItem.title,
                    content: viewItem.content,
                    isPinned: viewItem.isPinned,
                    pinnedUntil: viewItem.pinnedUntil,
                  });
                  setViewItem(null);
                }}
              >
                <Text className="text-foreground font-semibold">수정</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-2xl py-3 items-center"
                style={{ backgroundColor: "#CF222E15" }}
                onPress={() => {
                  handleDelete(viewItem.id);
                  setViewItem(null);
                }}
              >
                <Text className="font-semibold" style={{ color: "#CF222E" }}>삭제</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </ScreenContainer>
  );
}
