import React, { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  Alert, ActivityIndicator, Platform, StyleSheet, TextInput,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import {
  getBeltColor, getBeltLabel, getInitials, getAttendanceTypeLabel, formatDate,
  getCheckResultLabel, type CheckResult,
} from "@/lib/judo-utils";
import { useTabBackHandler, useModalBackHandler } from "@/hooks/use-back-handler";
import type { AttendanceType } from "@/lib/judo-utils";

const TODAY = new Date().toISOString().split("T")[0];

export default function AttendanceScreen() {
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const utils = trpc.useUtils();
  const insets = useSafeAreaInsets();

  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showQrScan, setShowQrScan] = useState(false);
  const [selectedMember, setSelectedMember] = useState<number | null>(null);
  const [attendanceType, setAttendanceType] = useState<AttendanceType>("regular");
  const [checkResult, setCheckResult] = useState<CheckResult>("present");
  const [attendanceNote, setAttendanceNote] = useState("");
  // 일괄 출석 상태
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());

  // QR 스캔 상태
  const [qrScanned, setQrScanned] = useState(false);
  const [qrResult, setQrResult] = useState<{ memberId: number; name: string } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const [permission, requestPermission] = useCameraPermissions();

  useTabBackHandler();
  useModalBackHandler(showCheckIn, () => {
    setShowCheckIn(false);
    setSelectedMember(null);
    setCheckResult("present");
    setAttendanceNote("");
  });
  useModalBackHandler(showQrScan, () => {
    setShowQrScan(false);
    setQrScanned(false);
    setQrResult(null);
    setQrError(null);
  });

  const { data: todayAttendance, isLoading: loadingToday } = trpc.attendance.today.useQuery();
  const { data: members } = trpc.members.list.useQuery(undefined, { enabled: isManager });

  const checkMutation = trpc.attendance.check.useMutation({
    onSuccess: () => {
      utils.attendance.today.invalidate();
      utils.members.overview.invalidate();
      void utils.members.activityTimeline.invalidate();
      setShowCheckIn(false);
      setSelectedMember(null);
      setCheckResult("present");
      setAttendanceNote("");
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const checkBulkMutation = trpc.attendance.checkBulk.useMutation({
    onSuccess: (data) => {
      utils.attendance.today.invalidate();
      utils.members.overview.invalidate();
      void utils.members.activityTimeline.invalidate();
      setBulkSelected(new Set());
      setBulkMode(false);
      setShowCheckIn(false);
      setCheckResult("present");
      setAttendanceNote("");
      Alert.alert("일괄 처리 완료", `${data.succeeded}명 처리됨${data.failed > 0 ? ` (${data.failed}명 실패)` : ""}`);
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const checkByQrMutation = trpc.attendance.checkByQr.useMutation({
    onSuccess: (data) => {
      utils.attendance.today.invalidate();
      utils.members.overview.invalidate();
      void utils.members.activityTimeline.invalidate();
      setQrResult(prev => prev ? { ...prev } : null);
      // 성공 상태 유지 (사용자가 확인 후 닫기)
    },
    onError: (e) => {
      setQrError(e.message);
    },
  });

  const deleteMutation = trpc.attendance.delete.useMutation({
    onSuccess: () => {
      utils.attendance.today.invalidate();
      utils.members.overview.invalidate();
      void utils.members.activityTimeline.invalidate();
    },
    onError: (e) => Alert.alert("오류", e.message),
  });

  const handleCheckIn = () => {
    const note = attendanceNote.trim() || undefined;
    if (bulkMode) {
      if (bulkSelected.size === 0) { Alert.alert("오류", "회원을 선택하세요"); return; }
      const label = checkResult === "absent" ? "결석(노쇼)" : checkResult === "late" ? "지각 포함 출석" : "출석";
      Alert.alert(
        `일괄 ${label}`,
        `${bulkSelected.size}명을 ${getCheckResultLabel(checkResult)}(으)로 기록하시겠습니까?`,
        [
          { text: "취소", style: "cancel" },
          {
            text: "확인",
            onPress: () =>
              checkBulkMutation.mutate({
                memberIds: Array.from(bulkSelected),
                attendanceDate: TODAY,
                type: attendanceType,
                checkResult,
                notes: note,
              }),
          },
        ],
      );
    } else {
      if (!selectedMember) { Alert.alert("오류", "회원을 선택하세요"); return; }
      checkMutation.mutate({
        memberId: selectedMember,
        attendanceDate: TODAY,
        type: attendanceType,
        checkResult,
        notes: note,
      });
    }
  };

  const toggleBulkSelect = (id: number) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (bulkSelected.size === notCheckedIn.length) {
      setBulkSelected(new Set());
    } else {
      setBulkSelected(new Set(notCheckedIn.map(m => m.id)));
    }
  };

  const handleDelete = (id: number) => {
    Alert.alert("출석 취소", "출석 기록을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => deleteMutation.mutate({ id }) },
    ]);
  };

  // QR 코드 스캔 처리
  const handleBarCodeScanned = ({ data }: { type: string; data: string }) => {
    if (qrScanned) return;
    setQrScanned(true);

    try {
      const payload = JSON.parse(data) as { memberId?: number; name?: string; t?: number };
      if (!payload.memberId || typeof payload.memberId !== "number") {
        setQrError("유효하지 않은 QR 코드입니다.");
        return;
      }

      // 타임스탬프 유효성 검사 (15분 이내)
      if (payload.t !== undefined) {
        const currentT = Math.floor(Date.now() / (5 * 60 * 1000));
        if (Math.abs(currentT - payload.t) > 3) {
          setQrError("QR 코드가 만료되었습니다. 회원에게 새로운 QR 코드를 요청하세요.");
          return;
        }
      }

      setQrResult({ memberId: payload.memberId, name: payload.name ?? "알 수 없음" });
      checkByQrMutation.mutate({ memberId: payload.memberId, type: "regular" });
    } catch {
      setQrError("QR 코드를 읽을 수 없습니다.");
    }
  };

  const openQrScan = async () => {
    if (Platform.OS === "web") {
      Alert.alert("알림", "QR 스캔은 모바일 앱에서만 사용 가능합니다.");
      return;
    }
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert("권한 필요", "카메라 권한이 필요합니다. 설정에서 카메라 권한을 허용해주세요.");
        return;
      }
    }
    setQrScanned(false);
    setQrResult(null);
    setQrError(null);
    setShowQrScan(true);
  };

  const closeQrScan = () => {
    setShowQrScan(false);
    setQrScanned(false);
    setQrResult(null);
    setQrError(null);
  };

  const checkedInIds = new Set((todayAttendance ?? []).map(a => a.memberId));
  const notCheckedIn = (members ?? []).filter(m => m.status === "active" && !checkedInIds.has(m.id));

  if (!isManager) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <Text className="text-muted text-center">관리자만 접근할 수 있습니다</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between">
        <View>
          <Text className="text-2xl font-bold text-foreground">오늘 출석</Text>
          <Text className="text-sm text-muted">{formatDate(TODAY)}</Text>
        </View>
        <View style={styles.headerButtons}>
          {/* QR 스캔 버튼 */}
          <TouchableOpacity
            style={styles.qrScanBtn}
            onPress={openQrScan}
          >
            <Text style={styles.qrScanBtnText}>📷 QR 스캔</Text>
          </TouchableOpacity>
          {/* 수동 출석 체크 버튼 */}
          <TouchableOpacity
            style={styles.checkInBtn}
            onPress={() => setShowCheckIn(true)}
          >
            <Text style={styles.checkInBtnText}>+ 출석</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 통계 카드 */}
      <View className="px-5 pb-3 flex-row gap-3">
        <View className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
          <Text className="text-2xl font-bold" style={{ color: "#1565C0" }}>
            {todayAttendance?.length ?? 0}
          </Text>
          <Text className="text-xs text-muted mt-0.5">오늘 출석</Text>
        </View>
        <View className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
          <Text className="text-2xl font-bold" style={{ color: "#F4A261" }}>
            {notCheckedIn.length}
          </Text>
          <Text className="text-xs text-muted mt-0.5">미출석</Text>
        </View>
        <View className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
          <Text className="text-2xl font-bold" style={{ color: "#2DA44E" }}>
            {members?.filter(m => m.status === "active").length ?? 0}
          </Text>
          <Text className="text-xs text-muted mt-0.5">활성 회원</Text>
        </View>
      </View>

      {/* 출석 목록 */}
      <View className="px-5 pb-2">
        <Text className="text-sm font-semibold text-foreground">출석 완료 ({todayAttendance?.length ?? 0}명)</Text>
      </View>

      {loadingToday ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1565C0" />
        </View>
      ) : (
        <FlatList
          data={todayAttendance ?? []}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 8 }}
          ListEmptyComponent={
            <View className="items-center py-10">
              <Text className="text-4xl mb-3">📋</Text>
              <Text className="text-muted text-center">오늘 출석한 회원이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View className="bg-surface rounded-2xl border border-border p-4 flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: getBeltColor(item.member?.beltRank ?? "white") + "30" }}>
                <Text className="text-sm font-bold"
                  style={{ color: getBeltColor(item.member?.beltRank ?? "white") }}>
                  {getInitials(item.member?.name ?? "?")}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">{item.member?.name ?? "-"}</Text>
                <View className="flex-row items-center gap-2 mt-0.5">
                  <View className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: getBeltColor(item.member?.beltRank ?? "white") }} />
                  <Text className="text-xs text-muted">{getBeltLabel(item.member?.beltRank ?? "white")}</Text>
                  <Text className="text-xs text-muted">·</Text>
                  <Text className="text-xs text-muted">{getAttendanceTypeLabel(item.type)}</Text>
                  <Text className="text-xs text-muted">·</Text>
                  <Text className="text-xs text-muted">
                    {getCheckResultLabel((item.checkResult ?? "present") as CheckResult)}
                  </Text>
                  {item.notes === "QR 코드 스캔" && (
                    <>
                      <Text className="text-xs text-muted">·</Text>
                      <Text className="text-xs" style={{ color: "#1565C0" }}>QR</Text>
                    </>
                  )}
                </View>
              </View>
              <View className="items-end gap-1">
                {item.checkInTime ? (
                  <Text className="text-xs text-muted">
                    {new Date(item.checkInTime).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                ) : (item.checkResult ?? "present") === "absent" ? (
                  <Text className="text-xs text-muted">결석</Text>
                ) : null}
                {item.notes && item.notes !== "QR 코드 스캔" && item.notes !== "일괄 출석" && item.notes !== "일괄 결석" && (
                  <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>{item.notes}</Text>
                )}
                <TouchableOpacity onPress={() => handleDelete(item.id)}>
                  <Text className="text-xs text-error">취소</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* QR 스캔 모달 */}
      <Modal visible={showQrScan} animationType="slide" presentationStyle="fullScreen">
        <View style={styles.qrModalContainer}>
          {/* QR 스캔 헤더 */}
          <View style={styles.qrModalHeader}>
            <TouchableOpacity onPress={closeQrScan} style={styles.qrCloseBtn}>
              <Text style={styles.qrCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.qrModalTitle}>QR 출석 스캔</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* 스캔 결과 또는 카메라 */}
          {qrResult ? (
            // 스캔 성공 화면
            <View style={styles.qrResultContainer}>
              {checkByQrMutation.isPending ? (
                <View style={styles.qrResultCard}>
                  <ActivityIndicator size="large" color="#1565C0" />
                  <Text style={styles.qrResultText}>출석 처리 중...</Text>
                </View>
              ) : checkByQrMutation.isSuccess ? (
                <View style={styles.qrResultCard}>
                  <Text style={styles.qrSuccessIcon}>✅</Text>
                  <Text style={styles.qrSuccessTitle}>출석 완료!</Text>
                  <Text style={styles.qrSuccessName}>{qrResult.name}</Text>
                  <Text style={styles.qrSuccessDate}>{formatDate(TODAY)} 출석 기록됨</Text>
                  <TouchableOpacity style={styles.qrScanAgainBtn} onPress={() => {
                    setQrScanned(false);
                    setQrResult(null);
                    setQrError(null);
                    checkByQrMutation.reset();
                  }}>
                    <Text style={styles.qrScanAgainText}>다음 회원 스캔</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.qrDoneBtn} onPress={closeQrScan}>
                    <Text style={styles.qrDoneText}>완료</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : qrError ? (
            // 오류 화면
            <View style={styles.qrResultContainer}>
              <View style={styles.qrResultCard}>
                <Text style={styles.qrErrorIcon}>⚠️</Text>
                <Text style={styles.qrErrorTitle}>스캔 오류</Text>
                <Text style={styles.qrErrorMsg}>{qrError}</Text>
                <TouchableOpacity style={styles.qrScanAgainBtn} onPress={() => {
                  setQrScanned(false);
                  setQrError(null);
                }}>
                  <Text style={styles.qrScanAgainText}>다시 스캔</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.qrDoneBtn} onPress={closeQrScan}>
                  <Text style={styles.qrDoneText}>닫기</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // 카메라 뷰
            <View style={styles.cameraContainer}>
              {Platform.OS === "web" ? (
                <View style={styles.webCameraFallback}>
                  <Text style={styles.webCameraIcon}>📷</Text>
                  <Text style={styles.webCameraText}>QR 스캔은 모바일 앱에서만 사용 가능합니다</Text>
                  <TouchableOpacity style={styles.qrDoneBtn} onPress={closeQrScan}>
                    <Text style={styles.qrDoneText}>닫기</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <CameraView
                    style={styles.camera}
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={qrScanned ? undefined : handleBarCodeScanned}
                  />
                  {/* 스캔 가이드 오버레이 */}
                  <View style={styles.scanOverlay}>
                    <View style={styles.scanTopArea} />
                    <View style={styles.scanMiddleRow}>
                      <View style={styles.scanSideArea} />
                      <View style={styles.scanBox}>
                        {/* 모서리 표시 */}
                        <View style={[styles.corner, styles.cornerTL]} />
                        <View style={[styles.corner, styles.cornerTR]} />
                        <View style={[styles.corner, styles.cornerBL]} />
                        <View style={[styles.corner, styles.cornerBR]} />
                      </View>
                      <View style={styles.scanSideArea} />
                    </View>
                    <View style={styles.scanBottomArea}>
                      <Text style={styles.scanGuideText}>회원의 QR 코드를 박스 안에 맞춰주세요</Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          )}
        </View>
      </Modal>

      {/* 수동 출석 체크 모달 */}
      <Modal visible={showCheckIn} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background">
          <View className="px-5 pb-3 flex-row items-center justify-between border-b border-border"
            style={{ paddingTop: Math.max(insets.top, 20) }}>
            <Text className="text-xl font-bold text-foreground">
              {bulkMode ? `일괄 출석 (${bulkSelected.size}명 선택)` : "출석 체크"}
            </Text>
            <View className="flex-row gap-3 items-center">
              <TouchableOpacity onPress={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); setSelectedMember(null); }}>
                <Text className="text-sm font-semibold" style={{ color: bulkMode ? "#F4A261" : "#1565C0" }}>
                  {bulkMode ? "단일 모드" : "일괄 모드"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                setShowCheckIn(false);
                setSelectedMember(null);
                setBulkSelected(new Set());
                setBulkMode(false);
                setCheckResult("present");
                setAttendanceNote("");
              }}>
                <Text className="text-primary font-semibold">취소</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 출석 유형 선택 */}
          <View className="px-5 pt-4 pb-2">
            <Text className="text-sm font-medium text-foreground mb-2">출석 유형</Text>
            <View className="flex-row gap-2">
              {(["regular", "makeup", "trial"] as AttendanceType[]).map(type => (
                <TouchableOpacity
                  key={type}
                  className="flex-1 py-2 rounded-xl border items-center"
                  style={{
                    backgroundColor: attendanceType === type ? "#1565C0" : "transparent",
                    borderColor: attendanceType === type ? "#1565C0" : "#E5E7EB",
                  }}
                  onPress={() => setAttendanceType(type)}
                >
                  <Text className="text-sm font-medium"
                    style={{ color: attendanceType === type ? "#FFFFFF" : "#687076" }}>
                    {getAttendanceTypeLabel(type)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View className="px-5 pb-2">
            <Text className="text-sm font-medium text-foreground mb-2">처리 구분</Text>
            <View className="flex-row gap-2">
              {(["present", "late", "absent"] as CheckResult[]).map((r) => (
                <TouchableOpacity
                  key={r}
                  className="flex-1 py-2 rounded-xl border items-center"
                  style={{
                    backgroundColor: checkResult === r ? (r === "absent" ? "#CF222E" : "#1565C0") : "transparent",
                    borderColor: checkResult === r ? (r === "absent" ? "#CF222E" : "#1565C0") : "#E5E7EB",
                  }}
                  onPress={() => setCheckResult(r)}
                >
                  <Text
                    className="text-sm font-medium"
                    style={{ color: checkResult === r ? "#FFFFFF" : "#687076" }}
                  >
                    {getCheckResultLabel(r)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text className="text-xs text-muted mt-2">
              결석은 당일 미참석(노쇼) 등 기록용이며, 실제 출석·지각과 동일 날짜에 중복 등록되지 않습니다.
            </Text>
          </View>

          <View className="px-5 pb-3">
            <Text className="text-sm font-medium text-foreground mb-2">사유·메모 (선택)</Text>
            <TextInput
              value={attendanceNote}
              onChangeText={setAttendanceNote}
              placeholder="예: 늦은 사유, 결석 사유 등"
              placeholderTextColor="#9BA1A6"
              multiline
              numberOfLines={2}
              className="border border-border rounded-xl px-3 py-2 text-foreground text-sm"
              style={{ minHeight: 56, textAlignVertical: "top" }}
            />
          </View>

          <View className="px-5 pb-2 flex-row items-center justify-between">
            <Text className="text-sm font-medium text-foreground">
              미출석 회원 ({notCheckedIn.length}명)
            </Text>
            {bulkMode && notCheckedIn.length > 0 && (
              <TouchableOpacity onPress={toggleSelectAll}>
                <Text className="text-xs font-semibold" style={{ color: "#1565C0" }}>
                  {bulkSelected.size === notCheckedIn.length ? "전체 해제" : "전체 선택"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={notCheckedIn}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 8 }}
            ListEmptyComponent={
              <View className="items-center py-10">
                <Text className="text-muted">모든 회원이 출석했습니다 🎉</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = bulkMode ? bulkSelected.has(item.id) : selectedMember === item.id;
              return (
                <TouchableOpacity
                  className="flex-row items-center gap-3 p-3 rounded-2xl border"
                  style={{
                    backgroundColor: isSelected ? "#1565C010" : "transparent",
                    borderColor: isSelected ? "#1565C0" : "#E5E7EB",
                  }}
                  onPress={() => bulkMode ? toggleBulkSelect(item.id) : setSelectedMember(selectedMember === item.id ? null : item.id)}
                >
                  {bulkMode && (
                    <View style={{
                      width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                      borderColor: isSelected ? "#1565C0" : "#CBD5E1",
                      backgroundColor: isSelected ? "#1565C0" : "transparent",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      {isSelected && <Text style={{ color: "#FFF", fontSize: 13, fontWeight: "700" }}>✓</Text>}
                    </View>
                  )}
                  <View className="w-10 h-10 rounded-full items-center justify-center"
                    style={{ backgroundColor: getBeltColor(item.beltRank) + "30" }}>
                    <Text className="text-sm font-bold"
                      style={{ color: getBeltColor(item.beltRank) }}>
                      {getInitials(item.name)}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-foreground">{item.name}</Text>
                    <Text className="text-xs text-muted">{getBeltLabel(item.beltRank)}</Text>
                  </View>
                  {!bulkMode && isSelected && (
                    <Text className="text-primary text-lg">✓</Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />

          <View className="px-5 pt-3 border-t border-border" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
            <TouchableOpacity
              style={{ backgroundColor: (bulkMode ? bulkSelected.size > 0 : !!selectedMember) ? "#1565C0" : "#E5E7EB" }}
              className="rounded-2xl py-4 items-center"
              onPress={handleCheckIn}
              disabled={(bulkMode ? bulkSelected.size === 0 : !selectedMember) || checkMutation.isPending || checkBulkMutation.isPending}
            >
              {(checkMutation.isPending || checkBulkMutation.isPending)
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text className="font-bold text-base"
                    style={{ color: (bulkMode ? bulkSelected.size > 0 : !!selectedMember) ? "#FFFFFF" : "#9BA1A6" }}>
                    {bulkMode ? `${bulkSelected.size}명 일괄 출석` : "출석 완료"}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerButtons: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  qrScanBtn: {
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1565C040",
  },
  qrScanBtnText: {
    color: "#1565C0",
    fontSize: 13,
    fontWeight: "600",
  },
  checkInBtn: {
    backgroundColor: "#1565C0",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  checkInBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  // QR 스캔 모달
  qrModalContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  qrModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 56, // QR fullScreen 모달은 SafeAreaView로 감싸지 않으므로 고정값 유지 (버튼이 없는 영역)
    paddingBottom: 16,
    backgroundColor: "#000000",
  },
  qrCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF20",
    alignItems: "center",
    justifyContent: "center",
  },
  qrCloseBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  qrModalTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  cameraContainer: {
    flex: 1,
    position: "relative",
  },
  camera: {
    flex: 1,
  },
  // 스캔 오버레이
  scanOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  scanTopArea: {
    flex: 1,
    backgroundColor: "#00000080",
  },
  scanMiddleRow: {
    flexDirection: "row",
    height: 260,
  },
  scanSideArea: {
    flex: 1,
    backgroundColor: "#00000080",
  },
  scanBox: {
    width: 260,
    height: 260,
    position: "relative",
  },
  scanBottomArea: {
    flex: 1,
    backgroundColor: "#00000080",
    alignItems: "center",
    paddingTop: 20,
  },
  scanGuideText: {
    color: "#FFFFFF",
    fontSize: 14,
    textAlign: "center",
  },
  // 모서리 표시
  corner: {
    position: "absolute",
    width: 24,
    height: 24,
    borderColor: "#FFFFFF",
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  // 결과 화면
  qrResultContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  qrResultCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 32,
    width: "100%",
    alignItems: "center",
    gap: 12,
  },
  qrResultText: {
    color: "#687076",
    fontSize: 15,
    marginTop: 8,
  },
  qrSuccessIcon: {
    fontSize: 56,
    marginBottom: 8,
  },
  qrSuccessTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2DA44E",
  },
  qrSuccessName: {
    fontSize: 20,
    fontWeight: "600",
    color: "#11181C",
  },
  qrSuccessDate: {
    fontSize: 14,
    color: "#687076",
  },
  qrErrorIcon: {
    fontSize: 56,
    marginBottom: 8,
  },
  qrErrorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#EF4444",
  },
  qrErrorMsg: {
    fontSize: 14,
    color: "#687076",
    textAlign: "center",
    lineHeight: 22,
  },
  qrScanAgainBtn: {
    backgroundColor: "#1565C0",
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 8,
    width: "100%",
    alignItems: "center",
  },
  qrScanAgainText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  qrDoneBtn: {
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    width: "100%",
    alignItems: "center",
  },
  qrDoneText: {
    color: "#687076",
    fontSize: 15,
    fontWeight: "600",
  },
  // 웹 폴백
  webCameraFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 32,
  },
  webCameraIcon: {
    fontSize: 64,
  },
  webCameraText: {
    color: "#FFFFFF",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
});
