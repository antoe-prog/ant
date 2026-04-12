import { useState, useMemo } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { BackButton } from "@/components/back-button";
import { trpc } from "@/lib/trpc";

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_NAMES = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay();
}

// 히트맵 색상 (출석 횟수에 따라)
function getHeatColor(count: number): string {
  if (count === 0) return "#EBEDF0";
  if (count === 1) return "#9BE9A8";
  if (count === 2) return "#40C463";
  if (count >= 3) return "#216E39";
  return "#EBEDF0";
}

export default function MyAttendanceCalendarScreen() {
  const router = useRouter();
  const now = new Date();
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<"monthly" | "yearly">("monthly");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // 월별 달력용
  const { data: attendanceData, isLoading: monthLoading } = trpc.members.myAttendanceByMonth.useQuery({ year, month });
  // 연간 히트맵용 (전체 이력)
  const { data: allAttendance, isLoading: allLoading } = trpc.members.myAttendanceAll.useQuery();

  // 이번 달 출석 날짜 Set
  const attendedDays = useMemo(() => {
    const set = new Set<number>();
    attendanceData?.forEach(a => {
      const d = new Date(a.attendanceDate);
      if (d.getFullYear() === year && d.getMonth() + 1 === month) {
        set.add(d.getDate());
      }
    });
    return set;
  }, [attendanceData, year, month]);

  // 연간 히트맵 데이터: "YYYY-MM-DD" → count
  const heatmapData = useMemo(() => {
    const map: Record<string, number> = {};
    allAttendance?.forEach(a => {
      const key = String(a.attendanceDate).slice(0, 10);
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [allAttendance]);

  // 연간 히트맵: 현재 연도 기준 52주 생성
  const heatmapYear = now.getFullYear();
  const heatmapWeeks = useMemo(() => {
    // 해당 연도 1월 1일부터 12월 31일까지 날짜 생성
    const startDate = new Date(heatmapYear, 0, 1);
    // 첫 번째 일요일로 맞추기
    const startOffset = startDate.getDay();
    const gridStart = new Date(startDate);
    gridStart.setDate(gridStart.getDate() - startOffset);

    const weeks: { date: Date; key: string }[][] = [];
    const endDate = new Date(heatmapYear, 11, 31);

    let current = new Date(gridStart);
    while (current <= endDate || weeks.length < 53) {
      const week: { date: Date; key: string }[] = [];
      for (let d = 0; d < 7; d++) {
        const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
        week.push({ date: new Date(current), key });
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
      if (current.getFullYear() > heatmapYear && weeks.length >= 53) break;
    }
    return weeks;
  }, [heatmapYear]);

  // 월별 달력 계산
  const totalDays = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const attendanceCount = attendedDays.size;
  const attendanceRate = Math.round((attendanceCount / totalDays) * 100);

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const today = now.getDate();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  // 연간 총 출석일
  const yearlyTotal = useMemo(() => {
    return Object.entries(heatmapData).filter(([k]) => k.startsWith(String(heatmapYear))).length;
  }, [heatmapData, heatmapYear]);

  // 월별 출석 요약 (히트맵 아래 표시)
  const monthlyBreakdown = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const prefix = `${heatmapYear}-${String(m).padStart(2, "0")}-`;
      const count = Object.keys(heatmapData).filter(k => k.startsWith(prefix)).length;
      return { month: m, count };
    });
  }, [heatmapData, heatmapYear]);

  const CELL_SIZE = Math.floor((width - 40 - 20) / 53); // 53주 + 패딩

  return (
    <ScreenContainer>
      {/* 헤더 */}
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>📆 출석달력</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 탭 */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "monthly" && styles.activeTab]}
          onPress={() => setActiveTab("monthly")}
        >
          <Text style={[styles.tabText, activeTab === "monthly" && styles.activeTabText]}>월별 달력</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "yearly" && styles.activeTab]}
          onPress={() => setActiveTab("yearly")}
        >
          <Text style={[styles.tabText, activeTab === "yearly" && styles.activeTabText]}>연간 잔디</Text>
        </TouchableOpacity>
      </View>

      {activeTab === "monthly" ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* 월 이동 */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
              <Text style={styles.navIcon}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{year}년 {MONTH_NAMES[month - 1]}</Text>
            <TouchableOpacity onPress={nextMonth} style={styles.navBtn} disabled={isCurrentMonth}>
              <Text style={[styles.navIcon, isCurrentMonth && { color: "#D1D5DB" }]}>›</Text>
            </TouchableOpacity>
          </View>

          {/* 출석 요약 */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryNum}>{attendanceCount}</Text>
              <Text style={styles.summaryLabel}>출석일</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryNum}>{totalDays}</Text>
              <Text style={styles.summaryLabel}>총 일수</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryNum, { color: attendanceRate >= 70 ? "#2DA44E" : attendanceRate >= 40 ? "#F59E0B" : "#EF4444" }]}>
                {attendanceRate}%
              </Text>
              <Text style={styles.summaryLabel}>출석률</Text>
            </View>
          </View>

          {/* 달력 */}
          <View style={styles.calendar}>
            <View style={styles.weekRow}>
              {DAYS.map((d, i) => (
                <Text key={d} style={[styles.dayHeader, i === 0 && { color: "#EF4444" }, i === 6 && { color: "#1565C0" }]}>
                  {d}
                </Text>
              ))}
            </View>

            {monthLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color="#2DA44E" />
              </View>
            ) : (
              Array.from({ length: cells.length / 7 }, (_, weekIdx) => (
                <View key={weekIdx} style={styles.weekRow}>
                  {cells.slice(weekIdx * 7, weekIdx * 7 + 7).map((day, dayIdx) => {
                    if (day === null) return <View key={`empty-${weekIdx}-${dayIdx}`} style={styles.dayCell} />;
                    const isAttended = attendedDays.has(day);
                    const isToday = isCurrentMonth && day === today;
                    return (
                      <View key={day} style={styles.dayCell}>
                        <View style={[
                          styles.dayInner,
                          isAttended && styles.attendedDay,
                          isToday && !isAttended && styles.todayDay,
                        ]}>
                          <Text style={[
                            styles.dayText,
                            dayIdx === 0 && { color: isAttended ? "#fff" : "#EF4444" },
                            dayIdx === 6 && { color: isAttended ? "#fff" : "#1565C0" },
                            isAttended && { color: "#fff", fontWeight: "700" },
                            isToday && !isAttended && { color: "#2DA44E", fontWeight: "700" },
                          ]}>
                            {day}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </View>

          {/* 범례 */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#2DA44E" }]} />
              <Text style={styles.legendText}>출석</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#2DA44E20", borderWidth: 2, borderColor: "#2DA44E" }]} />
              <Text style={styles.legendText}>오늘</Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        /* 연간 히트맵 뷰 */
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* 연간 요약 */}
          <View style={styles.yearlySummary}>
            <Text style={styles.yearlyTitle}>{heatmapYear}년 출석 현황</Text>
            <Text style={styles.yearlyCount}><Text style={styles.yearlyNum}>{yearlyTotal}</Text>일 출석</Text>
          </View>

          {allLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#2DA44E" />
            </View>
          ) : (
            <>
              {/* 히트맵 그리드 (가로 스크롤) */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View>
                  {/* 월 레이블 */}
                  <View style={{ flexDirection: "row", marginBottom: 4, paddingLeft: 0 }}>
                    {heatmapWeeks.map((week, wi) => {
                      // 해당 주의 첫 날이 새 달의 1일이면 월 레이블 표시
                      const firstInMonth = week.find(d => d.date.getDate() === 1 && d.date.getFullYear() === heatmapYear);
                      return (
                        <View key={wi} style={{ width: CELL_SIZE + 2, alignItems: "flex-start" }}>
                          {firstInMonth ? (
                            <Text style={{ fontSize: 9, color: "#9BA1A6" }}>
                              {MONTH_NAMES[firstInMonth.date.getMonth()]}
                            </Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>

                  {/* 요일 레이블 + 셀 */}
                  <View style={{ flexDirection: "row" }}>
                    {/* 요일 레이블 (일/월/수/금/토) */}
                    <View style={{ marginRight: 4 }}>
                      {["일", "", "화", "", "목", "", "토"].map((d, i) => (
                        <View key={i} style={{ height: CELL_SIZE + 2, justifyContent: "center" }}>
                          <Text style={{ fontSize: 8, color: "#9BA1A6", width: 12 }}>{d}</Text>
                        </View>
                      ))}
                    </View>

                    {/* 히트맵 셀 */}
                    {heatmapWeeks.map((week, wi) => (
                      <View key={wi} style={{ marginRight: 2 }}>
                        {week.map((day, di) => {
                          const isThisYear = day.date.getFullYear() === heatmapYear;
                          const count = isThisYear ? (heatmapData[day.key] ?? 0) : 0;
                          const isToday = day.key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                          return (
                            <View
                              key={di}
                              style={{
                                width: CELL_SIZE,
                                height: CELL_SIZE,
                                marginBottom: 2,
                                borderRadius: 2,
                                backgroundColor: isThisYear ? getHeatColor(count) : "transparent",
                                borderWidth: isToday ? 1.5 : 0,
                                borderColor: "#2DA44E",
                              }}
                            />
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollView>

              {/* 히트맵 범례 */}
              <View style={[styles.legend, { marginBottom: 20 }]}>
                <Text style={styles.legendText}>적음</Text>
                {["#EBEDF0", "#9BE9A8", "#40C463", "#216E39"].map(c => (
                  <View key={c} style={[styles.legendDot, { backgroundColor: c, borderRadius: 2 }]} />
                ))}
                <Text style={styles.legendText}>많음</Text>
              </View>

              {/* 월별 출석 막대 */}
              <Text style={styles.sectionTitle}>월별 출석 현황</Text>
              <View style={styles.monthBars}>
                {monthlyBreakdown.map(({ month: m, count }) => {
                  const maxCount = Math.max(...monthlyBreakdown.map(x => x.count), 1);
                  const barH = Math.max((count / maxCount) * 80, count > 0 ? 4 : 0);
                  const isNow = m === now.getMonth() + 1;
                  return (
                    <View key={m} style={styles.monthBarItem}>
                      <Text style={styles.monthBarCount}>{count > 0 ? count : ""}</Text>
                      <View style={[styles.monthBarBg]}>
                        <View style={[styles.monthBarFill, { height: barH, backgroundColor: isNow ? "#2DA44E" : "#9BE9A8" }]} />
                      </View>
                      <Text style={[styles.monthBarLabel, isNow && { color: "#2DA44E", fontWeight: "700" }]}>
                        {m}월
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E7EB",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 28, color: "#1565C0", fontWeight: "300" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#11181C" },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: "#2DA44E",
  },
  tabText: { fontSize: 14, color: "#687076", fontWeight: "500" },
  activeTabText: { color: "#2DA44E", fontWeight: "700" },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  navBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  navIcon: { fontSize: 28, color: "#1565C0", fontWeight: "300" },
  monthLabel: { fontSize: 18, fontWeight: "700", color: "#11181C" },
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  summaryNum: { fontSize: 22, fontWeight: "800", color: "#11181C", marginBottom: 2 },
  summaryLabel: { fontSize: 11, color: "#687076" },
  calendar: {
    backgroundColor: "#F5F5F5",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 16,
  },
  weekRow: { flexDirection: "row" },
  dayHeader: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "#687076",
    paddingVertical: 8,
  },
  loadingBox: { alignItems: "center", padding: 32 },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  dayInner: {
    width: "100%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 100,
  },
  attendedDay: { backgroundColor: "#2DA44E" },
  todayDay: { backgroundColor: "#2DA44E20", borderWidth: 2, borderColor: "#2DA44E" },
  dayText: { fontSize: 13, color: "#11181C" },
  legend: { flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 7 },
  legendText: { fontSize: 12, color: "#687076" },
  yearlySummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  yearlyTitle: { fontSize: 16, fontWeight: "700", color: "#11181C" },
  yearlyCount: { fontSize: 14, color: "#687076" },
  yearlyNum: { fontSize: 18, fontWeight: "800", color: "#2DA44E" },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#687076", marginBottom: 10 },
  monthBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 120,
    gap: 4,
  },
  monthBarItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  monthBarCount: { fontSize: 9, color: "#687076", marginBottom: 2 },
  monthBarBg: {
    width: "100%",
    height: 80,
    justifyContent: "flex-end",
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#F3F4F6",
  },
  monthBarFill: { width: "100%", borderRadius: 4 },
  monthBarLabel: { fontSize: 9, color: "#9BA1A6", marginTop: 4 },
});
