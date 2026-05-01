import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { DojoBackdrop, dojoPalette, dojoShadow, dojoSoftShadow } from "@/components/ui/dojo-theme";
import { trpc } from "@/lib/trpc";
import { getFriendlyErrorMessage } from "@/lib/error-messages";
import { useSelectedChild } from "@/hooks/use-selected-child";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const MONTH_NAMES = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
const MAX_IMAGE_DATA_LENGTH = 3_500_000;

type AttendanceTab = "calendar" | "photos" | "yearly";

type AttendanceRecord = {
  attendanceDate: string | Date;
  type?: "regular" | "makeup" | "trial";
  checkResult?: "present" | "late" | "absent";
  checkInTime?: string | Date | null;
  notes?: string | null;
};

type AttendancePhotoRecord = {
  id: number;
  userId: number;
  memberId: number;
  attendanceDate: string | Date;
  imageData: string | null;
  imageUrl?: string | null;
  storageKey?: string | null;
  caption: string | null;
  createdAt: string | Date;
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOffset(year: number, month: number) {
  const sundayFirst = new Date(year, month - 1, 1).getDay();
  return (sundayFirst + 6) % 7;
}

function toDateKey(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return new Date(raw).toISOString().slice(0, 10);
}

function getDayOfMonth(value: string | Date): number {
  return Number(toDateKey(value).slice(8, 10));
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatMonthBadge(year: number, month: number) {
  return `${String(year).slice(2)}년 ${month}월`;
}

function getStatusLabel(record: AttendanceRecord | undefined) {
  if (!record) return "기록 없음";
  if (record.checkResult === "absent") return "결석";
  if (record.checkResult === "late") return "지각";
  if (record.type === "makeup") return "보강";
  if (record.type === "trial") return "체험";
  return "출석";
}

function getStatusColor(record: AttendanceRecord | undefined) {
  if (!record) return "transparent";
  if (record.checkResult === "absent") return "#EB5757";
  if (record.checkResult === "late") return "#F2994A";
  if (record.type === "makeup") return "#27AE60";
  if (record.type === "trial") return "#F2C94C";
  return "#2F80ED";
}

function getHeatColor(count: number): string {
  if (count === 0) return "#EEF1F5";
  if (count === 1) return "#BBD8FF";
  if (count === 2) return "#6FAAF2";
  return "#2F80ED";
}

function formatKoreanDate(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function formatTime(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function MyAttendanceCalendarScreen() {
  const now = new Date();
  const { width } = useWindowDimensions();
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<AttendanceTab>("calendar");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const { isParent, children, selectedChild, selectedChildId, selectedMemberInput, setSelectedChildId, isLoadingChildren } =
    useSelectedChild();
  const canReadSelectedMember = !isParent || !!selectedChildId;
  const canManagePhotos = !isParent;
  const monthInput = { year, month, ...(selectedMemberInput ?? {}) };

  const { data: attendanceData, isLoading: monthLoading, error: monthError } = trpc.members.myAttendanceByMonth.useQuery(
    monthInput,
    { enabled: canReadSelectedMember },
  );
  const { data: allAttendance, isLoading: allLoading, error: allAttendanceError } = trpc.members.myAttendanceAll.useQuery(
    selectedMemberInput,
    { enabled: canReadSelectedMember },
  );
  const { data: monthPhotos, isLoading: photosLoading, error: monthPhotosError } =
    trpc.members.myAttendancePhotosByMonth.useQuery(monthInput, { enabled: canReadSelectedMember });

  const totalDays = getDaysInMonth(year, month);
  const firstDayOffset = getFirstDayOffset(year, month);
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const today = now.getDate();
  const defaultPhotoDay = isCurrentMonth ? today : 1;
  const activePhotoDay = selectedDay && selectedDay <= totalDays ? selectedDay : defaultPhotoDay;
  const activePhotoDateKey = formatDateKey(year, month, activePhotoDay);
  const selectedDateKey = selectedDay ? formatDateKey(year, month, selectedDay) : "";
  const selectedDateInput = { attendanceDate: selectedDateKey || activePhotoDateKey, ...(selectedMemberInput ?? {}) };

  const { data: selectedDatePhotos, isLoading: selectedPhotosLoading, error: selectedPhotosError } =
    trpc.members.myAttendancePhotosByDate.useQuery(
      selectedDateInput,
      { enabled: selectedDay !== null && canReadSelectedMember },
    );

  const recordsByDay = useMemo(() => {
    const map = new Map<number, AttendanceRecord>();
    (attendanceData as AttendanceRecord[] | undefined)?.forEach((record) => {
      const key = toDateKey(record.attendanceDate);
      if (key.startsWith(`${year}-${String(month).padStart(2, "0")}-`)) {
        map.set(getDayOfMonth(record.attendanceDate), record);
      }
    });
    return map;
  }, [attendanceData, month, year]);

  const photosByDay = useMemo(() => {
    const map = new Map<number, number>();
    (monthPhotos as AttendancePhotoRecord[] | undefined)?.forEach((photo) => {
      const day = getDayOfMonth(photo.attendanceDate);
      map.set(day, (map.get(day) ?? 0) + 1);
    });
    return map;
  }, [monthPhotos]);

  const heatmapData = useMemo(() => {
    const map: Record<string, number> = {};
    (allAttendance as AttendanceRecord[] | undefined)?.forEach((record) => {
      const key = toDateKey(record.attendanceDate);
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [allAttendance]);

  const heatmapYear = now.getFullYear();
  const heatmapWeeks = useMemo(() => {
    const startDate = new Date(heatmapYear, 0, 1);
    const gridStart = new Date(startDate);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());

    const weeks: { date: Date; key: string }[][] = [];
    const endDate = new Date(heatmapYear, 11, 31);
    const current = new Date(gridStart);

    while (current <= endDate || weeks.length < 53) {
      const week: { date: Date; key: string }[] = [];
      for (let day = 0; day < 7; day++) {
        const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
        week.push({ date: new Date(current), key });
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
      if (current.getFullYear() > heatmapYear && weeks.length >= 53) break;
    }

    return weeks;
  }, [heatmapYear]);

  const observedDays = isCurrentMonth ? today : totalDays;
  const attendanceCount = recordsByDay.size;
  const restDays = Math.max(observedDays - attendanceCount, 0);
  const attendanceRate = observedDays > 0 ? Math.round((attendanceCount / observedDays) * 100) : 0;

  const cells: (number | null)[] = [
    ...Array(firstDayOffset).fill(null),
    ...Array.from({ length: totalDays }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = Array.from({ length: cells.length / 7 }, (_, weekIndex) =>
    cells.slice(weekIndex * 7, weekIndex * 7 + 7),
  );

  const yearlyTotal = useMemo(
    () => Object.keys(heatmapData).filter((key) => key.startsWith(String(heatmapYear))).length,
    [heatmapData, heatmapYear],
  );

  const monthlyBreakdown = useMemo(() => (
    Array.from({ length: 12 }, (_, index) => {
      const targetMonth = index + 1;
      const prefix = `${heatmapYear}-${String(targetMonth).padStart(2, "0")}-`;
      const count = Object.keys(heatmapData).filter((key) => key.startsWith(prefix)).length;
      return { month: targetMonth, count };
    })
  ), [heatmapData, heatmapYear]);

  const heatCellSize = Math.max(7, Math.min(12, Math.floor((width - 64) / 42)));
  const selectedRecord = selectedDay ? recordsByDay.get(selectedDay) : undefined;
  const selectedPhotoList = (selectedDatePhotos as AttendancePhotoRecord[] | undefined) ?? [];
  const monthlyPhotoList = (monthPhotos as AttendancePhotoRecord[] | undefined) ?? [];

  const invalidatePhotos = async (dateKey: string) => {
    await Promise.all([
      utils.members.myAttendancePhotosByMonth.invalidate({ year, month, ...(selectedMemberInput ?? {}) }),
      utils.members.myAttendancePhotosByDate.invalidate({ attendanceDate: dateKey, ...(selectedMemberInput ?? {}) }),
    ]);
  };

  const addPhotoMutation = trpc.members.addAttendancePhoto.useMutation({
    onSuccess: async (_, variables) => {
      setCaption("");
      await invalidatePhotos(variables.attendanceDate);
    },
    onError: (error) => {
      Alert.alert("사진 기록", getFriendlyErrorMessage(error, "사진 저장에 실패했습니다."));
    },
  });

  const deletePhotoMutation = trpc.members.deleteAttendancePhoto.useMutation({
    onSuccess: async () => {
      await utils.members.myAttendancePhotosByMonth.invalidate({ year, month, ...(selectedMemberInput ?? {}) });
      if (selectedDateKey) {
        await utils.members.myAttendancePhotosByDate.invalidate({ attendanceDate: selectedDateKey, ...(selectedMemberInput ?? {}) });
      }
    },
    onError: (error) => {
      Alert.alert("사진 삭제", getFriendlyErrorMessage(error, "사진 삭제에 실패했습니다."));
    },
  });

  const prevMonth = () => {
    setSelectedDay(null);
    if (month === 1) {
      setYear((value) => value - 1);
      setMonth(12);
      return;
    }
    setMonth((value) => value - 1);
  };

  const nextMonth = () => {
    if (isCurrentMonth) return;
    setSelectedDay(null);
    if (month === 12) {
      setYear((value) => value + 1);
      setMonth(1);
      return;
    }
    setMonth((value) => value + 1);
  };

  const pickAndUploadPhoto = async (attendanceDate: string) => {
    if (!canManagePhotos) {
      Alert.alert("사진 기록", "학부모 계정에서는 자녀 사진 기록을 조회만 할 수 있습니다.");
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("권한 필요", "사진 기록을 추가하려면 사진 접근 권한이 필요합니다.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.42,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "image/jpeg";
    let base64 = asset.base64 ?? null;
    if (!base64) {
      base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    const imageData = `data:${mimeType};base64,${base64}`;
    if (imageData.length > MAX_IMAGE_DATA_LENGTH) {
      Alert.alert("사진 기록", "사진 용량이 큽니다. 더 작은 사진을 선택해 주세요.");
      return;
    }

    addPhotoMutation.mutate({
      attendanceDate,
      imageData,
      caption: caption.trim() || undefined,
    });
  };

  const requestDeletePhoto = (id: number) => {
    Alert.alert("사진 삭제", "이 사진 기록을 삭제할까요?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => deletePhotoMutation.mutate({ id }) },
    ]);
  };

  return (
    <ScreenContainer>
      <DojoBackdrop variant="calendar" style={styles.screen}>
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.headerTitle}>내 기록</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>RECORD CALENDAR</Text>
            <Text style={styles.heroTitle}>기록 캘린더</Text>
            <Text style={styles.heroSub}>출석, 사진, 연간 흐름을 한 곳에서 선명하게 관리하세요.</Text>
          </View>

          <View style={styles.calendarCard}>
            <View style={styles.cardTopRow}>
              <View style={styles.monthControls}>
                <TouchableOpacity onPress={prevMonth} style={styles.arrowButton} activeOpacity={0.75}>
                  <Text style={styles.arrowText}>‹</Text>
                </TouchableOpacity>
                <View style={styles.monthBadge}>
                  <Text style={styles.monthBadgeText}>{formatMonthBadge(year, month)}</Text>
                </View>
                <TouchableOpacity
                  onPress={nextMonth}
                  style={[styles.arrowButton, isCurrentMonth && styles.arrowButtonDisabled]}
                  activeOpacity={0.75}
                  disabled={isCurrentMonth}
                >
                  <Text style={[styles.arrowText, isCurrentMonth && styles.arrowTextDisabled]}>›</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.segmented}>
                <SegmentButton label="달력" value="calendar" activeTab={activeTab} onPress={setActiveTab} />
                <SegmentButton label="사진" value="photos" activeTab={activeTab} onPress={setActiveTab} />
                <SegmentButton label="연간" value="yearly" activeTab={activeTab} onPress={setActiveTab} />
              </View>
            </View>

            {isParent && isLoadingChildren ? (
              <View style={styles.childLoadingRow}>
                <ActivityIndicator color="#2F80ED" />
                <Text style={styles.childLoadingText}>자녀 정보를 불러오는 중입니다</Text>
              </View>
            ) : null}

            {isParent && children.length > 1 ? (
              <View style={styles.childTabs}>
                <Text style={styles.childTabsTitle}>자녀 선택</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childTabsRow}>
                  {children.map((child) => {
                    const active = child.id === selectedChild?.id;
                    return (
                      <TouchableOpacity
                        key={child.id}
                        style={[styles.childTab, active && styles.childTabActive]}
                        activeOpacity={0.8}
                        onPress={() => {
                          setSelectedDay(null);
                          void setSelectedChildId(child.id);
                        }}
                      >
                        <Text style={[styles.childTabText, active && styles.childTabTextActive]}>{child.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {isParent && !isLoadingChildren && children.length === 0 ? (
              <InlineError message="아직 연결된 자녀가 없습니다. 관리자에게 학부모-자녀 연결을 요청해 주세요." />
            ) : null}

            {activeTab === "calendar" && (
              <>
                <SummaryStrip
                  attendanceCount={attendanceCount}
                  restDays={restDays}
                  attendanceRate={attendanceRate}
                />

                <View style={styles.weekdayRow}>
                  {WEEKDAYS.map((weekday) => (
                    <Text key={weekday} style={styles.weekdayText}>{weekday}</Text>
                  ))}
                </View>

                {monthLoading ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator color="#2F80ED" />
                  </View>
                ) : monthError ? (
                  <InlineError message={getFriendlyErrorMessage(monthError)} />
                ) : (
                  <View style={styles.monthGrid}>
                    {weeks.map((week, weekIndex) => (
                      <View key={`week-${weekIndex}`} style={styles.weekRow}>
                        {week.map((day, dayIndex) => {
                          const record = day ? recordsByDay.get(day) : undefined;
                          const photoCount = day ? (photosByDay.get(day) ?? 0) : 0;
                          const isToday = day !== null && isCurrentMonth && day === today;
                          const isFuture = day !== null && isCurrentMonth && day > today;
                          return (
                            <View key={`${weekIndex}-${dayIndex}`} style={styles.dayCell}>
                              {day !== null && (
                                <TouchableOpacity
                                  style={[styles.dayBubble, isToday && styles.todayBubble]}
                                  activeOpacity={0.78}
                                  onPress={() => setSelectedDay(day)}
                                >
                                  <Text style={[styles.dayText, isFuture && styles.futureDayText]}>{day}</Text>
                                  <View
                                    style={[
                                      styles.recordDot,
                                      { backgroundColor: getStatusColor(record), opacity: record ? 1 : 0 },
                                    ]}
                                  />
                                  {photoCount > 0 && (
                                    <View style={styles.photoBadge}>
                                      <Text style={styles.photoBadgeText}>{photoCount}</Text>
                                    </View>
                                  )}
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.legendRow}>
                  <LegendDot color="#2F80ED" label="출석" />
                  <LegendDot color="#F2994A" label="지각" />
                  <LegendDot color="#27AE60" label="보강" />
                  <LegendDot color="#F2C94C" label="체험" />
                  <LegendDot color="#EB5757" label="결석" />
                </View>
              </>
            )}

            {activeTab === "photos" && (
              <View style={styles.photoPanel}>
                <View style={styles.photoActionBox}>
                  <View>
                    <Text style={styles.photoActionTitle}>{formatKoreanDate(activePhotoDateKey)} 사진 기록</Text>
                    <Text style={styles.photoActionSub}>달력에서 날짜를 누르면 업로드 날짜가 바뀝니다.</Text>
                  </View>
                  {canManagePhotos ? (
                    <TouchableOpacity
                      style={[styles.primaryButton, addPhotoMutation.isPending && styles.primaryButtonDisabled]}
                      onPress={() => pickAndUploadPhoto(activePhotoDateKey)}
                      disabled={addPhotoMutation.isPending}
                    >
                      <Text style={styles.primaryButtonText}>{addPhotoMutation.isPending ? "저장 중" : "사진 추가"}</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.readOnlyBadge}>
                      <Text style={styles.readOnlyBadgeText}>조회 전용</Text>
                    </View>
                  )}
                </View>

                {canManagePhotos ? (
                  <TextInput
                    value={caption}
                    onChangeText={setCaption}
                    placeholder="사진 메모를 입력하세요"
                    placeholderTextColor="#A0A8B6"
                    style={styles.captionInput}
                    maxLength={255}
                  />
                ) : (
                  <Text style={styles.readOnlyHelp}>학부모 계정은 자녀의 사진 기록을 확인만 할 수 있습니다.</Text>
                )}

                {photosLoading ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator color="#2F80ED" />
                  </View>
                ) : monthPhotosError ? (
                  <InlineError message={getFriendlyErrorMessage(monthPhotosError)} />
                ) : monthlyPhotoList.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyTitle}>아직 사진 기록이 없습니다</Text>
                    <Text style={styles.emptyText}>운동 후 사진을 남기면 월별 기록으로 모아볼 수 있습니다.</Text>
                  </View>
                ) : (
                  <View style={styles.photoList}>
                    {monthlyPhotoList.map((photo) => (
                      <PhotoCard
                        key={photo.id}
                        photo={photo}
                        onDelete={canManagePhotos ? () => requestDeletePhoto(photo.id) : undefined}
                      />
                    ))}
                  </View>
                )}
              </View>
            )}

            {activeTab === "yearly" && (
              <YearlyPanel
                allLoading={allLoading}
                heatCellSize={heatCellSize}
                heatmapData={heatmapData}
                heatmapWeeks={heatmapWeeks}
                heatmapYear={heatmapYear}
                errorMessage={allAttendanceError ? getFriendlyErrorMessage(allAttendanceError) : null}
                monthlyBreakdown={monthlyBreakdown}
                now={now}
                yearlyTotal={yearlyTotal}
              />
            )}
          </View>
        </ScrollView>

        <Modal
          visible={selectedDay !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedDay(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.detailModal}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>{selectedDateKey ? formatKoreanDate(selectedDateKey) : ""}</Text>
                  <Text style={styles.modalSubTitle}>출석 상세 기록</Text>
                </View>
                <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedDay(null)}>
                  <Text style={styles.closeButtonText}>×</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.statusCard}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(selectedRecord) || "#DDE3EC" }]} />
                <View style={styles.statusTextBox}>
                  <Text style={styles.statusLabel}>{getStatusLabel(selectedRecord)}</Text>
                  <Text style={styles.statusMeta}>출석 시간 {formatTime(selectedRecord?.checkInTime)}</Text>
                </View>
              </View>

              {selectedRecord?.notes ? (
                <View style={styles.noteBox}>
                  <Text style={styles.noteLabel}>메모</Text>
                  <Text style={styles.noteText}>{selectedRecord.notes}</Text>
                </View>
              ) : null}

              <View style={styles.modalPhotoHeader}>
                <Text style={styles.modalSectionTitle}>사진 기록</Text>
                {canManagePhotos ? (
                  <TouchableOpacity
                    style={[styles.smallButton, addPhotoMutation.isPending && styles.primaryButtonDisabled]}
                    onPress={() => selectedDateKey && pickAndUploadPhoto(selectedDateKey)}
                    disabled={addPhotoMutation.isPending}
                  >
                    <Text style={styles.smallButtonText}>추가</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.readOnlyBadge}>
                    <Text style={styles.readOnlyBadgeText}>조회 전용</Text>
                  </View>
                )}
              </View>

              {canManagePhotos ? (
                <TextInput
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="사진 메모를 입력하세요"
                  placeholderTextColor="#A0A8B6"
                  style={styles.captionInput}
                  maxLength={255}
                />
              ) : null}

              {selectedPhotosLoading ? (
                <View style={styles.modalLoading}>
                  <ActivityIndicator color="#2F80ED" />
                </View>
              ) : selectedPhotosError ? (
                <InlineError message={getFriendlyErrorMessage(selectedPhotosError)} compact />
              ) : selectedPhotoList.length === 0 ? (
                <View style={styles.modalEmptyBox}>
                  <Text style={styles.emptyText}>이 날짜에 등록된 사진이 없습니다.</Text>
                </View>
              ) : (
                <ScrollView style={styles.modalPhotoScroll} showsVerticalScrollIndicator={false}>
                  {selectedPhotoList.map((photo) => (
                    <PhotoCard
                      key={photo.id}
                      photo={photo}
                      compact
                      onDelete={canManagePhotos ? () => requestDeletePhoto(photo.id) : undefined}
                    />
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </DojoBackdrop>
    </ScreenContainer>
  );
}

function SegmentButton({
  activeTab,
  label,
  onPress,
  value,
}: {
  activeTab: AttendanceTab;
  label: string;
  onPress: (value: AttendanceTab) => void;
  value: AttendanceTab;
}) {
  return (
    <TouchableOpacity
      style={[styles.segment, activeTab === value && styles.segmentActive]}
      onPress={() => onPress(value)}
      activeOpacity={0.8}
    >
      <Text style={[styles.segmentText, activeTab === value && styles.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SummaryStrip({
  attendanceCount,
  attendanceRate,
  restDays,
}: {
  attendanceCount: number;
  attendanceRate: number;
  restDays: number;
}) {
  return (
    <View style={styles.summaryStrip}>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryIcon}>🔥</Text>
        <Text style={styles.summaryLabel}>운동</Text>
        <Text style={styles.summaryValue}>{attendanceCount}일</Text>
      </View>
      <View style={styles.summaryDivider} />
      <View style={styles.summaryItem}>
        <Text style={styles.summaryIcon}>😌</Text>
        <Text style={styles.summaryLabel}>휴식</Text>
        <Text style={styles.summaryValue}>{restDays}일</Text>
      </View>
      <View style={styles.summaryDivider} />
      <View style={styles.summaryItem}>
        <Text style={styles.summaryIcon}>📈</Text>
        <Text style={styles.summaryLabel}>출석률</Text>
        <Text style={styles.summaryValue}>{attendanceRate}%</Text>
      </View>
    </View>
  );
}

function PhotoCard({
  compact = false,
  onDelete,
  photo,
}: {
  compact?: boolean;
  onDelete?: () => void;
  photo: AttendancePhotoRecord;
}) {
  const photoUri = photo.imageUrl || photo.imageData || "";
  return (
    <View style={[styles.photoCard, compact && styles.photoCardCompact]}>
      <Image source={{ uri: photoUri }} style={styles.photoImage} resizeMode="cover" />
      <View style={styles.photoCardBody}>
        <View style={styles.photoCardText}>
          <Text style={styles.photoDate}>{formatKoreanDate(toDateKey(photo.attendanceDate))}</Text>
          {photo.caption ? <Text style={styles.photoCaption}>{photo.caption}</Text> : null}
        </View>
        {onDelete ? (
          <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
            <Text style={styles.deleteButtonText}>삭제</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function InlineError({ compact = false, message }: { compact?: boolean; message: string }) {
  return (
    <View style={[styles.inlineErrorBox, compact && styles.inlineErrorBoxCompact]}>
      <Text style={styles.inlineErrorTitle}>연결을 확인해 주세요</Text>
      <Text style={styles.inlineErrorText}>{message}</Text>
    </View>
  );
}

function YearlyPanel({
  allLoading,
  errorMessage,
  heatCellSize,
  heatmapData,
  heatmapWeeks,
  heatmapYear,
  monthlyBreakdown,
  now,
  yearlyTotal,
}: {
  allLoading: boolean;
  errorMessage?: string | null;
  heatCellSize: number;
  heatmapData: Record<string, number>;
  heatmapWeeks: { date: Date; key: string }[][];
  heatmapYear: number;
  monthlyBreakdown: { month: number; count: number }[];
  now: Date;
  yearlyTotal: number;
}) {
  return (
    <View style={styles.yearPanel}>
      <View style={styles.yearSummary}>
        <View>
          <Text style={styles.yearTitle}>{heatmapYear}년 기록</Text>
          <Text style={styles.yearSubtitle}>총 {yearlyTotal}일 출석</Text>
        </View>
        <View style={styles.yearBadge}>
          <Text style={styles.yearBadgeText}>{yearlyTotal}</Text>
        </View>
      </View>

      {allLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#2F80ED" />
        </View>
      ) : errorMessage ? (
        <InlineError message={errorMessage} />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.heatmapScroll}>
            <View>
              <View style={styles.heatMonthRow}>
                {heatmapWeeks.map((week, weekIndex) => {
                  const firstInMonth = week.find((day) => day.date.getDate() === 1 && day.date.getFullYear() === heatmapYear);
                  return (
                    <View key={`month-${weekIndex}`} style={{ width: heatCellSize + 3 }}>
                      {firstInMonth ? (
                        <Text style={styles.heatMonthText}>{MONTH_NAMES[firstInMonth.date.getMonth()]}</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              <View style={styles.heatRows}>
                {heatmapWeeks.map((week, weekIndex) => (
                  <View key={`heat-${weekIndex}`} style={styles.heatWeek}>
                    {week.map((day) => {
                      const isThisYear = day.date.getFullYear() === heatmapYear;
                      const count = isThisYear ? (heatmapData[day.key] ?? 0) : 0;
                      return (
                        <View
                          key={day.key}
                          style={[
                            styles.heatCell,
                            {
                              width: heatCellSize,
                              height: heatCellSize,
                              backgroundColor: isThisYear ? getHeatColor(count) : "transparent",
                            },
                          ]}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.monthBars}>
            {monthlyBreakdown.map(({ month: targetMonth, count }) => {
              const maxCount = Math.max(...monthlyBreakdown.map((item) => item.count), 1);
              const barHeight = Math.max((count / maxCount) * 76, count > 0 ? 5 : 0);
              const isNowMonth = targetMonth === now.getMonth() + 1;
              return (
                <View key={targetMonth} style={styles.monthBarItem}>
                  <Text style={styles.monthBarCount}>{count || ""}</Text>
                  <View style={styles.monthBarTrack}>
                    <View
                      style={[
                        styles.monthBarFill,
                        {
                          height: barHeight,
                          backgroundColor: isNowMonth ? "#2F80ED" : "#BBD8FF",
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.monthBarLabel, isNowMonth && styles.monthBarLabelActive]}>
                    {targetMonth}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F0FF",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  headerTitle: {
    color: dojoPalette.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  hero: {
    alignItems: "center",
    paddingTop: 18,
    paddingBottom: 76,
  },
  heroKicker: {
    color: dojoPalette.violet,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginBottom: 10,
  },
  heroTitle: {
    color: dojoPalette.ink,
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: -1.2,
  },
  heroSub: {
    color: dojoPalette.slate,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 20,
    marginTop: 10,
    textAlign: "center",
    maxWidth: 280,
  },
  calendarCard: {
    backgroundColor: "#FFFDF7",
    borderRadius: 32,
    marginTop: -34,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: "#FFFFFF",
    ...dojoShadow,
  },
  cardTopRow: {
    gap: 12,
    marginBottom: 18,
  },
  childLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
  },
  childLoadingText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
  },
  childTabs: {
    marginBottom: 16,
  },
  childTabsTitle: {
    color: "#202A3A",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  childTabsRow: {
    gap: 8,
    paddingRight: 4,
  },
  childTab: {
    borderWidth: 1,
    borderColor: "#D7E2F0",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
  },
  childTabActive: {
    borderColor: "#2F80ED",
    backgroundColor: "#EAF4FF",
  },
  childTabText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "900",
  },
  childTabTextActive: {
    color: "#0B63CE",
  },
  monthControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  monthBadge: {
    backgroundColor: "#EEF2FF",
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  monthBadgeText: {
    color: dojoPalette.violet,
    fontSize: 13,
    fontWeight: "900",
  },
  arrowButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  arrowButtonDisabled: {
    backgroundColor: "#F7F8FA",
  },
  arrowText: {
    color: "#3C587C",
    fontSize: 22,
    fontWeight: "500",
    lineHeight: 23,
  },
  arrowTextDisabled: {
    color: "#C7CED8",
  },
  segmented: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: "#EEF2FF",
    borderRadius: 16,
    padding: 4,
  },
  segment: {
    minWidth: 52,
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  segmentActive: {
    backgroundColor: "#FFFFFF",
    ...dojoSoftShadow,
  },
  segmentText: {
    color: "#8A93A3",
    fontSize: 12,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: dojoPalette.ink,
  },
  summaryStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    paddingVertical: 15,
    paddingHorizontal: 10,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#EEF2FF",
  },
  summaryItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  summaryIcon: {
    fontSize: 14,
  },
  summaryLabel: {
    color: "#7F8796",
    fontSize: 12,
    fontWeight: "700",
  },
  summaryValue: {
    color: "#2A3445",
    fontSize: 13,
    fontWeight: "900",
  },
  summaryDivider: {
    width: 1,
    height: 20,
    backgroundColor: "#EEF1F5",
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  weekdayText: {
    flex: 1,
    color: "#89919F",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  loadingBox: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineErrorBox: {
    minHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#F2B8B5",
    backgroundColor: "#FFF1F0",
    padding: 18,
    justifyContent: "center",
    gap: 6,
  },
  inlineErrorBoxCompact: {
    minHeight: 72,
    marginVertical: 8,
  },
  inlineErrorTitle: {
    color: "#B3261E",
    fontSize: 14,
    fontWeight: "900",
  },
  inlineErrorText: {
    color: "#7A271A",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  monthGrid: {
    gap: 4,
  },
  weekRow: {
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  todayBubble: {
    backgroundColor: "#EEF2FF",
  },
  dayText: {
    color: "#313846",
    fontSize: 16,
    fontWeight: "700",
  },
  futureDayText: {
    color: "#B6BDCA",
  },
  recordDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 4,
  },
  photoBadge: {
    position: "absolute",
    right: 1,
    top: 0,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#21334F",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  photoBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 18,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: "#838B99",
    fontSize: 11,
    fontWeight: "700",
  },
  photoPanel: {
    gap: 14,
  },
  photoActionBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: "#F8FAFF",
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: "#EEF2FF",
  },
  photoActionTitle: {
    color: "#202A3A",
    fontSize: 15,
    fontWeight: "900",
  },
  photoActionSub: {
    color: "#7D8796",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
    maxWidth: 165,
  },
  primaryButton: {
    backgroundColor: dojoPalette.violet,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  readOnlyBadge: {
    borderRadius: 999,
    backgroundColor: "#EAF4FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  readOnlyBadgeText: {
    color: "#0B63CE",
    fontSize: 11,
    fontWeight: "900",
  },
  readOnlyHelp: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  captionInput: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E7EF",
    backgroundColor: "#FFFFFF",
    color: "#273142",
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 14,
  },
  emptyBox: {
    backgroundColor: "#F8FAFF",
    borderRadius: 22,
    padding: 22,
    alignItems: "center",
  },
  emptyTitle: {
    color: "#273142",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 6,
  },
  emptyText: {
    color: "#7D8796",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 18,
  },
  photoList: {
    gap: 14,
  },
  photoCard: {
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#EEF2FF",
    ...dojoSoftShadow,
  },
  photoCardCompact: {
    marginBottom: 12,
  },
  photoImage: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: "#E8EDF5",
  },
  photoCardBody: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
  },
  photoCardText: {
    flex: 1,
  },
  photoDate: {
    color: "#273142",
    fontSize: 13,
    fontWeight: "900",
  },
  photoCaption: {
    color: "#7D8796",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  deleteButton: {
    borderRadius: 11,
    backgroundColor: "#FFE9EC",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  deleteButtonText: {
    color: "#EB5757",
    fontSize: 11,
    fontWeight: "900",
  },
  yearPanel: {
    paddingTop: 4,
  },
  yearSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    marginBottom: 16,
  },
  yearTitle: {
    color: "#202A3A",
    fontSize: 16,
    fontWeight: "900",
  },
  yearSubtitle: {
    color: "#7D8796",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  yearBadge: {
    minWidth: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF2FF",
  },
  yearBadgeText: {
    color: dojoPalette.violet,
    fontSize: 18,
    fontWeight: "900",
  },
  heatmapScroll: {
    marginBottom: 18,
  },
  heatMonthRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  heatMonthText: {
    color: "#9AA3B0",
    fontSize: 9,
    fontWeight: "700",
  },
  heatRows: {
    flexDirection: "row",
  },
  heatWeek: {
    marginRight: 3,
  },
  heatCell: {
    borderRadius: 3,
    marginBottom: 3,
  },
  monthBars: {
    height: 122,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  monthBarItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  monthBarCount: {
    color: "#7D8796",
    fontSize: 9,
    fontWeight: "800",
    marginBottom: 3,
    height: 12,
  },
  monthBarTrack: {
    width: "100%",
    height: 76,
    borderRadius: 5,
    backgroundColor: "#F0F3F7",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  monthBarFill: {
    width: "100%",
    borderRadius: 5,
  },
  monthBarLabel: {
    color: "#98A1AF",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 5,
  },
  monthBarLabelActive: {
    color: "#2F80ED",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.42)",
    justifyContent: "center",
    padding: 20,
  },
  detailModal: {
    maxHeight: "86%",
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    padding: 18,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitle: {
    color: "#202A3A",
    fontSize: 21,
    fontWeight: "900",
  },
  modalSubTitle: {
    color: "#7D8796",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F2F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: {
    color: "#4B5565",
    fontSize: 24,
    lineHeight: 26,
    fontWeight: "700",
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#F8FBFF",
    padding: 14,
    marginBottom: 12,
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  statusTextBox: {
    flex: 1,
  },
  statusLabel: {
    color: "#202A3A",
    fontSize: 16,
    fontWeight: "900",
  },
  statusMeta: {
    color: "#7D8796",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  noteBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E8EDF5",
    padding: 12,
    marginBottom: 12,
  },
  noteLabel: {
    color: "#7D8796",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
  },
  noteText: {
    color: "#273142",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  modalPhotoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  modalSectionTitle: {
    color: "#202A3A",
    fontSize: 15,
    fontWeight: "900",
  },
  smallButton: {
    borderRadius: 11,
    backgroundColor: "#2F80ED",
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  smallButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  modalLoading: {
    padding: 24,
    alignItems: "center",
  },
  modalEmptyBox: {
    borderRadius: 16,
    backgroundColor: "#F8FBFF",
    padding: 18,
    marginTop: 10,
  },
  modalPhotoScroll: {
    marginTop: 12,
  },
});
