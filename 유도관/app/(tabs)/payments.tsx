import React, { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { schedulePaymentReminderNotification, scheduleRegistrationExpiryNotification } from "@/lib/notifications";
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  Alert, ActivityIndicator, ScrollView, TextInput, Platform,
  StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import {
  getBeltColor, getBeltLabel, getInitials, getPaymentMethodLabel,
  formatDate, formatAmount,
} from "@/lib/judo-utils";
import { useTabBackHandler, useModalBackHandler } from "@/hooks/use-back-handler";
import type { PaymentMethod } from "@/lib/judo-utils";
import { idKeyExtractor, listPerfProps } from "@/lib/list-utils";
import { EmptyState, PillButton } from "@/components/ui/primitives";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card", "transfer"];

// 납부 영수증 텍스트 생성
function generateReceiptText(params: {
  memberName: string;
  beltRank: string;
  amount: number;
  method: PaymentMethod;
  periodStart?: string | null;
  periodEnd?: string | null;
  paidAt: Date;
  notes?: string | null;
  dojoName?: string;
}) {
  const lines = [
    "================================",
    "       유도장 납부 영수증",
    "================================",
    "",
    `도장명: ${params.dojoName ?? "유도장"}`,
    `발행일: ${params.paidAt.toLocaleDateString("ko-KR")}`,
    `발행시각: ${params.paidAt.toLocaleTimeString("ko-KR")}`,
    "",
    "--------------------------------",
    "  납부 정보",
    "--------------------------------",
    `회원명: ${params.memberName}`,
    `띠 등급: ${params.beltRank}`,
    "",
    `납부 금액: ${formatAmount(params.amount)}`,
    `납부 방법: ${getPaymentMethodLabel(params.method)}`,
    ...(params.periodStart && params.periodEnd
      ? [`납부 기간: ${formatDate(params.periodStart)} ~ ${formatDate(params.periodEnd)}`]
      : []),
    ...(params.notes ? [`메모: ${params.notes}`] : []),
    "",
    "================================",
    "   납부해 주셔서 감사합니다!",
    "================================",
  ];
  return lines.join("\n");
}

// 납부 영수증 공유 함수
async function shareReceipt(receiptText: string, memberName: string) {
  try {
    if (Platform.OS === "web") {
      if (await Sharing.isAvailableAsync()) {
        // 웹에서는 텍스트 직접 공유 시도
        await Sharing.shareAsync(receiptText);
      } else {
        Alert.alert("알림", "이 브라우저에서는 공유 기능을 지원하지 않습니다.");
      }
      return;
    }

    // 네이티브: 텍스트 파일로 저장 후 공유
    const fileName = `receipt_${memberName}_${new Date().toISOString().split("T")[0]}.txt`;
    const fileUri = (FileSystem.documentDirectory ?? "") + fileName;
    await FileSystem.writeAsStringAsync(fileUri, receiptText, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert("알림", "공유 기능을 사용할 수 없습니다.");
      return;
    }

    await Sharing.shareAsync(fileUri, {
      mimeType: "text/plain",
      dialogTitle: `${memberName} 납부 영수증`,
    });
  } catch (e) {
    Alert.alert("오류", "영수증 공유 중 오류가 발생했습니다.");
  }
}

export default function PaymentsScreen() {
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const utils = trpc.useUtils();
  const insets = useSafeAreaInsets();

  const [showAdd, setShowAdd] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1);
  const [lastPayment, setLastPayment] = useState<{
    memberName: string;
    beltRank: string;
    amount: number;
    method: PaymentMethod;
    periodStart?: string | null;
    periodEnd?: string | null;
    notes?: string | null;
    paidAt: Date;
  } | null>(null);

  useTabBackHandler();
  useModalBackHandler(showAdd, () => { setShowAdd(false); });
  useModalBackHandler(showReceipt, () => { setShowReceipt(false); });
  useModalBackHandler(showReport, () => { setShowReport(false); });

  const [form, setForm] = useState({
    memberId: 0,
    amount: "",
    method: "cash" as PaymentMethod,
    periodStart: "",
    periodEnd: "",
    notes: "",
  });

  const { data: members } = trpc.members.list.useQuery(undefined, { enabled: isManager });
  const { data: recentPayments } = trpc.payments.recent.useQuery({ limit: 15 }, { enabled: isManager });
  const { data: expiringSoon } = trpc.payments.expiringSoon.useQuery({ days: 7 }, { enabled: isManager });
  const { data: reportData, isLoading: reportLoading } = trpc.payments.monthlyReport.useQuery(
    { year: reportYear, month: reportMonth },
    { enabled: isManager && showReport }
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdueMembers = (members ?? [])
    .filter(m => m.status === "active" && m.nextPaymentDate)
    .sort((a, b) => new Date(a.nextPaymentDate!).getTime() - new Date(b.nextPaymentDate!).getTime());

  const createMutation = trpc.payments.create.useMutation({
    onSuccess: () => {
      void utils.members.list.invalidate();
      void utils.members.activityTimeline.invalidate();
      void utils.payments.recent.invalidate();
      void utils.payments.unpaid.invalidate();
      void utils.payments.expiringSoon.invalidate();
      // 월 매출·대시보드 통계도 같이 갱신
      void utils.dashboard.stats.invalidate();
      void utils.dashboard.monthlyStats.invalidate();
      setShowAdd(false);

      // 납부 등록 성공 시 영수증 표시
      const member = members?.find(m => m.id === form.memberId);
      if (member) {
        setLastPayment({
          memberName: member.name,
          beltRank: `${getBeltLabel(member.beltRank)} ${member.beltDegree ?? 1}단`,
          amount: Number.parseInt(form.amount, 10),
          method: form.method,
          periodStart: form.periodStart || null,
          periodEnd: form.periodEnd || null,
          notes: form.notes || null,
          paidAt: new Date(),
        });
        setShowReceipt(true);
        // 납부 만료 3일 전 알림 스케줄링
        if (form.periodEnd) {
          schedulePaymentReminderNotification({
            memberName: member.name,
            nextPaymentDate: form.periodEnd,
            memberId: member.id,
          });
          // 등록 만료 7일 전 회원용 알림 스케줄링
          scheduleRegistrationExpiryNotification({
            nextPaymentDate: form.periodEnd,
          });
        }
      }
      resetForm();
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const resetForm = () => setForm({
    memberId: 0, amount: "", method: "cash", periodStart: "", periodEnd: "", notes: "",
  });

  const openAddForMember = (memberId: number, monthlyFee: number) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    setForm(f => ({ ...f, memberId, amount: String(monthlyFee), periodStart: start, periodEnd: end }));
    setShowAdd(true);
  };

  const handleExportCsv = async () => {
    if (!reportData || reportData.payments.length === 0) {
      Alert.alert("알림", "해당 월에 납부 데이터가 없습니다.");
      return;
    }
    try {
      const header = "회원명,납부일시,금액(원),납부방법,시작일,종료일,메모";
      const rows = reportData.payments.map((p: any) => [
        `"${p.memberName ?? "-"}"`,
        `"${new Date(p.paidAt).toLocaleDateString("ko-KR")}"`,
        p.amount,
        `"${getPaymentMethodLabel(p.method as PaymentMethod)}"`,
        `"${p.periodStart ? formatDate(p.periodStart) : "-"}"`,
        `"${p.periodEnd ? formatDate(p.periodEnd) : "-"}"`,
        `"${p.notes ?? ""}"`,
      ].join(","));
      const summary = [
        "",
        `"합계","",${reportData.totalRevenue},"","","",""`,
        `"현금","",${reportData.byMethod.cash ?? 0},"","","",""`,
        `"카드","",${reportData.byMethod.card ?? 0},"","","",""`,
        `"계좌이체","",${reportData.byMethod.transfer ?? 0},"","","",""`,
      ];
      const csv = [header, ...rows, ...summary].join("\n");
      const fileName = `납부리포트_${reportYear}년${String(reportMonth).padStart(2, "0")}월.csv`;

      if (Platform.OS === "web") {
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
        Alert.alert("완료", "CSV 파일이 다운로드되었습니다.");
      } else {
        const fileUri = (FileSystem.documentDirectory ?? "") + fileName;
        await FileSystem.writeAsStringAsync(fileUri, "\uFEFF" + csv, { encoding: FileSystem.EncodingType.UTF8 });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, { mimeType: "text/csv", dialogTitle: `${reportYear}년 ${reportMonth}월 납부 리포트` });
        } else {
          Alert.alert("완료", `파일이 저장되었습니다: ${fileName}`);
        }
      }
    } catch (e) {
      Alert.alert("오류", "CSV 내보내기 중 오류가 발생했습니다.");
    }
  };

  const handleCreate = () => {
    if (!form.memberId) { Alert.alert("오류", "회원을 선택하세요"); return; }
    if (!form.amount || Number.isNaN(Number.parseInt(form.amount, 10))) { Alert.alert("오류", "금액을 입력하세요"); return; }
    createMutation.mutate({
      memberId: form.memberId,
      amount: Number.parseInt(form.amount, 10),
      method: form.method,
      periodStart: form.periodStart || undefined,
      periodEnd: form.periodEnd || undefined,
      notes: form.notes || undefined,
    });
  };

  const getDaysStatus = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { label: `${Math.abs(diff)}일 연체`, color: "#CF222E" };
    if (diff === 0) return { label: "오늘 납부", color: "#F4A261" };
    if (diff <= 7) return { label: `${diff}일 후`, color: "#F4A261" };
    return { label: `${diff}일 후`, color: "#2DA44E" };
  };

  if (!isManager) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-muted text-center">관리자만 접근할 수 있습니다</Text>
      </ScreenContainer>
    );
  }

  const overdueCount = overdueMembers.filter(m => new Date(m.nextPaymentDate!) < today).length;

  const receiptText = lastPayment
    ? generateReceiptText({
        memberName: lastPayment.memberName,
        beltRank: lastPayment.beltRank,
        amount: lastPayment.amount,
        method: lastPayment.method,
        periodStart: lastPayment.periodStart,
        periodEnd: lastPayment.periodEnd,
        notes: lastPayment.notes,
        paidAt: lastPayment.paidAt,
      })
    : "";

  const openReceiptForPayment = (p: {
    memberId: number;
    amount: number;
    method: string;
    paidAt: Date | string;
    periodStart?: string | null;
    periodEnd?: string | null;
    notes?: string | null;
  }) => {
    const m = members?.find(x => x.id === p.memberId);
    setLastPayment({
      memberName: m?.name ?? `회원 #${p.memberId}`,
      beltRank: m ? `${getBeltLabel(m.beltRank)} ${m.beltDegree ?? 1}단` : "-",
      amount: p.amount,
      method: p.method as PaymentMethod,
      periodStart: p.periodStart ?? null,
      periodEnd: p.periodEnd ?? null,
      notes: p.notes ?? null,
      paidAt: p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt),
    });
    setShowReceipt(true);
  };

  return (
    <ScreenContainer>
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between">
        <Text className="text-2xl font-bold text-foreground">납부 관리</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            style={{ backgroundColor: "#E3F2FD", borderWidth: 1, borderColor: "#1565C040" }}
            className="px-3 py-2 rounded-full"
            onPress={() => setShowReport(true)}
          >
            <Text style={{ color: "#1565C0", fontSize: 13, fontWeight: "600" }}>📊 리포트</Text>
          </TouchableOpacity>
          <PillButton label="+ 납부 등록" onPress={() => setShowAdd(true)} />
        </View>
      </View>

      <View className="px-5 pb-3 flex-row gap-3">
        {[
          { label: "연체", count: overdueCount, color: "#CF222E" },
          { label: "7일 이내", count: overdueMembers.filter(m => { const d = new Date(m.nextPaymentDate!); d.setHours(0,0,0,0); const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000); return diff >= 0 && diff <= 7; }).length, color: "#F4A261" },
          { label: "전체", count: overdueMembers.length, color: "#1565C0" },
        ].map(s => (
          <View key={s.label} className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
            <Text className="text-xl font-bold" style={{ color: s.color }}>{s.count}</Text>
            <Text className="text-xs text-muted mt-0.5">{s.label}</Text>
          </View>
        ))}
      </View>

      {/* 만료 임박 알림 배너 */}
      {expiringSoon && expiringSoon.length > 0 && (
        <View className="mx-5 mb-3 rounded-2xl p-4 border" style={{ backgroundColor: "#FFF3CD", borderColor: "#F4A261" }}>
          <View className="flex-row items-center gap-2 mb-2">
            <Text className="text-base">⚠️</Text>
            <Text className="text-sm font-bold" style={{ color: "#B45309" }}>
              7일 이내 납부 만료 {expiringSoon.length}명
            </Text>
          </View>
          <View className="gap-1.5">
            {expiringSoon.slice(0, 3).map(m => {
              const d = new Date(m.nextPaymentDate!);
              d.setHours(0, 0, 0, 0);
              const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
              return (
                <View key={m.id} className="flex-row items-center justify-between">
                  <Text className="text-sm font-medium" style={{ color: "#92400E" }}>{m.name}</Text>
                  <Text className="text-xs" style={{ color: "#B45309" }}>
                    {diff === 0 ? "오늘 만료" : `${diff}일 후 만료`} · {formatAmount(m.monthlyFee)}
                  </Text>
                </View>
              );
            })}
            {expiringSoon.length > 3 && (
              <Text className="text-xs" style={{ color: "#B45309" }}>외 {expiringSoon.length - 3}명 더...</Text>
            )}
          </View>
        </View>
      )}

      {recentPayments && recentPayments.length > 0 && (
        <View className="px-5 pb-3">
          <Text className="text-sm font-semibold text-foreground mb-2">최근 납부 내역</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
            {recentPayments.map((p) => {
              const m = members?.find(x => x.id === p.memberId);
              const paid = p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt as string);
              return (
                <View
                  key={p.id}
                  className="bg-surface rounded-2xl border border-border p-3"
                  style={{ width: 200 }}
                >
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {m?.name ?? `회원 #${p.memberId}`}
                  </Text>
                  <Text className="text-xs text-muted mt-0.5">{paid.toLocaleDateString("ko-KR")}</Text>
                  <Text className="text-base font-bold mt-1" style={{ color: "#1565C0" }}>{formatAmount(p.amount)}</Text>
                  <TouchableOpacity
                    className="mt-2 py-2 rounded-xl items-center border"
                    style={{ borderColor: "#1565C040", backgroundColor: "#E3F2FD" }}
                    onPress={() => openReceiptForPayment(p)}
                  >
                    <Text className="text-xs font-bold" style={{ color: "#1565C0" }}>영수증</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View className="px-5 pb-2">
        <Text className="text-sm font-semibold text-foreground">납부 예정 목록</Text>
      </View>

      <FlatList
        data={overdueMembers}
        keyExtractor={idKeyExtractor}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 8 }}
        {...listPerfProps}
        ListEmptyComponent={<EmptyState emoji="💳" title="납부 예정 회원이 없습니다" />}
        renderItem={({ item }) => {
          const status = getDaysStatus(item.nextPaymentDate!);
          return (
            <View className="bg-surface rounded-2xl border border-border p-4">
              <View className="flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-full items-center justify-center"
                  style={{ backgroundColor: getBeltColor(item.beltRank) + "30" }}>
                  <Text className="text-sm font-bold" style={{ color: getBeltColor(item.beltRank) }}>
                    {getInitials(item.name)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">{item.name}</Text>
                  <View className="flex-row items-center gap-2 mt-0.5">
                    <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getBeltColor(item.beltRank) }} />
                    <Text className="text-xs text-muted">{getBeltLabel(item.beltRank)}</Text>
                  </View>
                </View>
                <View className="items-end gap-1">
                  <Text className="text-base font-bold text-foreground">{formatAmount(item.monthlyFee)}</Text>
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: status.color + "20" }}>
                    <Text className="text-xs font-semibold" style={{ color: status.color }}>{status.label}</Text>
                  </View>
                </View>
              </View>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-xs text-muted">납부 예정일: {formatDate(item.nextPaymentDate)}</Text>
                <TouchableOpacity
                  style={{ backgroundColor: "#1565C0" }}
                  className="px-3 py-1.5 rounded-xl"
                  onPress={() => openAddForMember(item.id, item.monthlyFee)}
                >
                  <Text className="text-white text-xs font-semibold">납부 처리</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      {/* 납부 등록 모달 */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <Text className="text-xl font-bold text-foreground">납부 등록</Text>
            <TouchableOpacity onPress={() => { setShowAdd(false); resetForm(); }}>
              <Text className="text-primary font-semibold">취소</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
            <View className="py-4 gap-4">
              {!form.memberId ? (
                <View>
                  <Text className="text-sm font-medium text-foreground mb-2">회원 선택 *</Text>
                  <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                    {(members ?? []).filter(m => m.status === "active").map(m => (
                      <TouchableOpacity
                        key={m.id}
                        className="flex-row items-center gap-3 p-3 rounded-xl border mb-2"
                        style={{ borderColor: "#E5E7EB" }}
                        onPress={() => setForm(f => ({ ...f, memberId: m.id, amount: String(m.monthlyFee) }))}
                      >
                        <View className="w-8 h-8 rounded-full items-center justify-center"
                          style={{ backgroundColor: getBeltColor(m.beltRank) + "30" }}>
                          <Text className="text-xs font-bold" style={{ color: getBeltColor(m.beltRank) }}>
                            {getInitials(m.name)}
                          </Text>
                        </View>
                        <Text className="text-sm font-medium text-foreground">{m.name}</Text>
                        <Text className="text-xs text-muted ml-auto">{formatAmount(m.monthlyFee)}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : (
                <View className="flex-row items-center justify-between bg-surface rounded-xl p-3 border border-border">
                  <Text className="text-sm font-medium text-foreground">
                    {members?.find(m => m.id === form.memberId)?.name ?? "선택된 회원"}
                  </Text>
                  <TouchableOpacity onPress={() => setForm(f => ({ ...f, memberId: 0 }))}>
                    <Text className="text-xs text-primary">변경</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View>
                <Text className="text-sm font-medium text-foreground mb-1">금액 (원)</Text>
                <TextInput
                  className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                  value={form.amount}
                  onChangeText={v => setForm(f => ({ ...f, amount: v }))}
                  placeholder="80000"
                  placeholderTextColor="#9BA1A6"
                  keyboardType="numeric"
                />
              </View>

              <View>
                <Text className="text-sm font-medium text-foreground mb-2">납부 방법</Text>
                <View className="flex-row gap-2">
                  {PAYMENT_METHODS.map(method => (
                    <TouchableOpacity
                      key={method}
                      className="flex-1 py-2.5 rounded-xl border items-center"
                      style={{
                        backgroundColor: form.method === method ? "#1565C0" : "transparent",
                        borderColor: form.method === method ? "#1565C0" : "#E5E7EB",
                      }}
                      onPress={() => setForm(f => ({ ...f, method }))}
                    >
                      <Text className="text-sm font-medium"
                        style={{ color: form.method === method ? "#FFFFFF" : "#687076" }}>
                        {getPaymentMethodLabel(method)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground mb-1">시작일</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-3 py-3 text-foreground"
                    value={form.periodStart}
                    onChangeText={v => setForm(f => ({ ...f, periodStart: v }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#9BA1A6"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground mb-1">종료일</Text>
                  <TextInput
                    className="bg-surface border border-border rounded-xl px-3 py-3 text-foreground"
                    value={form.periodEnd}
                    onChangeText={v => setForm(f => ({ ...f, periodEnd: v }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#9BA1A6"
                  />
                </View>
              </View>

              <View>
                <Text className="text-sm font-medium text-foreground mb-1">메모</Text>
                <TextInput
                  className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
                  value={form.notes}
                  onChangeText={v => setForm(f => ({ ...f, notes: v }))}
                  placeholder="특이사항"
                  placeholderTextColor="#9BA1A6"
                  multiline
                  numberOfLines={2}
                  style={{ height: 60, textAlignVertical: "top" }}
                />
              </View>
            </View>
          </ScrollView>
          <View className="px-5 pt-3 border-t border-border" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
            <TouchableOpacity
              style={{ backgroundColor: "#1565C0" }}
              className="rounded-2xl py-4 items-center"
              onPress={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text className="text-white font-bold text-base">납부 등록</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 월별 리포트 모달 */}
      <Modal visible={showReport} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <Text className="text-xl font-bold text-foreground">월별 매출 리포트</Text>
            <TouchableOpacity onPress={() => setShowReport(false)}>
              <Text className="text-primary font-semibold">닫기</Text>
            </TouchableOpacity>
          </View>

          {/* 월 선택 */}
          <View className="px-5 pt-4 pb-2">
            <Text className="text-sm font-medium text-foreground mb-2">리포트 월 선택</Text>
            <View className="flex-row items-center gap-3">
              <TouchableOpacity
                className="w-9 h-9 rounded-full items-center justify-center border border-border bg-surface"
                onPress={() => {
                  if (reportMonth === 1) { setReportYear(y => y - 1); setReportMonth(12); }
                  else setReportMonth(m => m - 1);
                }}
              >
                <Text className="text-foreground font-bold">‹</Text>
              </TouchableOpacity>
              <Text className="text-base font-bold text-foreground flex-1 text-center">
                {reportYear}년 {reportMonth}월
              </Text>
              <TouchableOpacity
                className="w-9 h-9 rounded-full items-center justify-center border border-border bg-surface"
                onPress={() => {
                  if (reportMonth === 12) { setReportYear(y => y + 1); setReportMonth(1); }
                  else setReportMonth(m => m + 1);
                }}
              >
                <Text className="text-foreground font-bold">›</Text>
              </TouchableOpacity>
            </View>
          </View>

          {reportLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#1565C0" />
            </View>
          ) : reportData ? (
            <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
              <View className="py-4 gap-4">
                {/* 요약 카드 */}
                <View className="flex-row gap-3">
                  <View className="flex-1 bg-surface rounded-2xl p-4 border border-border items-center">
                    <Text className="text-2xl font-bold" style={{ color: "#1565C0" }}>
                      {formatAmount(reportData.totalRevenue)}
                    </Text>
                    <Text className="text-xs text-muted mt-1">이달 전체 매출</Text>
                  </View>
                  <View className="flex-1 bg-surface rounded-2xl p-4 border border-border items-center">
                    <Text className="text-2xl font-bold" style={{ color: "#2DA44E" }}>
                      {reportData.payments.length}
                    </Text>
                    <Text className="text-xs text-muted mt-1">납부 건수</Text>
                  </View>
                </View>

                {/* 방법별 요약 */}
                <View className="bg-surface rounded-2xl p-4 border border-border gap-2">
                  <Text className="text-sm font-semibold text-foreground mb-1">납부 방법별 요약</Text>
                  {Object.entries(reportData.byMethod).map(([method, amount]) => (
                    <View key={method} className="flex-row items-center justify-between">
                      <Text className="text-sm text-foreground">{getPaymentMethodLabel(method as PaymentMethod)}</Text>
                      <Text className="text-sm font-semibold text-foreground">{formatAmount(amount as number)}</Text>
                    </View>
                  ))}
                </View>

                {/* 납부 내역 */}
                <View>
                  <Text className="text-sm font-semibold text-foreground mb-2">납부 내역 ({reportData.payments.length}건)</Text>
                  {reportData.payments.length === 0 ? (
                    <View className="items-center py-8">
                      <Text className="text-muted">이달 납부 내역이 없습니다</Text>
                    </View>
                  ) : (
                    reportData.payments.map((p: any) => (
                      <View key={p.id} className="bg-surface rounded-xl border border-border p-3 mb-2">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-sm font-semibold text-foreground">{p.memberName ?? "-"}</Text>
                          <Text className="text-sm font-bold" style={{ color: "#1565C0" }}>{formatAmount(p.amount)}</Text>
                        </View>
                        <View className="flex-row items-center gap-2 mt-1">
                          <Text className="text-xs text-muted">{new Date(p.paidAt).toLocaleDateString("ko-KR")}</Text>
                          <Text className="text-xs text-muted">·</Text>
                          <Text className="text-xs text-muted">{getPaymentMethodLabel(p.method)}</Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </View>
            </ScrollView>
          ) : null}

          <View className="px-5 pt-3 border-t border-border" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
            <TouchableOpacity
              style={{ backgroundColor: reportData && reportData.payments.length > 0 ? "#1565C0" : "#E5E7EB" }}
              className="rounded-2xl py-4 items-center"
              onPress={handleExportCsv}
              disabled={!reportData || reportData.payments.length === 0}
            >
              <Text className="font-bold text-base"
                style={{ color: reportData && reportData.payments.length > 0 ? "#FFFFFF" : "#9BA1A6" }}>
                📅 CSV 내보내기
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 영수증 모달 */}
      <Modal visible={showReceipt} animationType="fade" transparent>
        <View style={styles.receiptOverlay}>
          <View style={styles.receiptCard}>
            {/* 영수증 헤더 */}
            <View style={styles.receiptHeader}>
              <Text style={styles.receiptTitle}>납부 영수증</Text>
              <Text style={styles.receiptSubtitle}>내용 확인 후 공유할 수 있습니다</Text>
            </View>

            {/* 영수증 미리보기 */}
            {lastPayment && (
              <View style={styles.receiptPreview}>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>회원명</Text>
                  <Text style={styles.receiptValue}>{lastPayment.memberName}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>납부 금액</Text>
                  <Text style={[styles.receiptValue, styles.receiptAmountText]}>
                    {formatAmount(lastPayment.amount)}
                  </Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>납부 방법</Text>
                  <Text style={styles.receiptValue}>{getPaymentMethodLabel(lastPayment.method)}</Text>
                </View>
                {lastPayment.periodStart && lastPayment.periodEnd && (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>납부 기간</Text>
                    <Text style={styles.receiptValue}>
                      {formatDate(lastPayment.periodStart)} ~ {formatDate(lastPayment.periodEnd)}
                    </Text>
                  </View>
                )}
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>납부 일시</Text>
                  <Text style={styles.receiptValue}>
                    {lastPayment.paidAt.toLocaleString("ko-KR")}
                  </Text>
                </View>
              </View>
            )}

            {/* 버튼 */}
            <View style={styles.receiptButtons}>
              <TouchableOpacity
                style={styles.receiptShareBtn}
                onPress={() => {
                  if (lastPayment) {
                    shareReceipt(receiptText, lastPayment.memberName);
                  }
                }}
              >
                <Text style={styles.receiptShareBtnText}>📤 영수증 공유</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.receiptCloseBtn}
                onPress={() => setShowReceipt(false)}
              >
                <Text style={styles.receiptCloseBtnText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  receiptOverlay: {
    flex: 1,
    backgroundColor: "#00000080",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  receiptCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    width: "100%",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  receiptHeader: {
    backgroundColor: "#1565C0",
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: "center",
    gap: 4,
  },
  receiptTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  receiptSubtitle: {
    fontSize: 13,
    color: "#BBDEFB",
  },
  receiptPreview: {
    padding: 20,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  receiptLabel: {
    fontSize: 13,
    color: "#687076",
  },
  receiptValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#11181C",
  },
  receiptAmountText: {
    fontSize: 18,
    color: "#1565C0",
  },
  receiptButtons: {
    padding: 16,
    gap: 10,
  },
  receiptShareBtn: {
    backgroundColor: "#1565C0",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  receiptShareBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  receiptCloseBtn: {
    backgroundColor: "#F5F5F5",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  receiptCloseBtnText: {
    color: "#687076",
    fontSize: 14,
    fontWeight: "600",
  },
});
