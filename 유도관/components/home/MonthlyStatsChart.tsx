import React from "react";
import { View, Text, Dimensions } from "react-native";
import Svg, { Rect, Text as SvgText, Line } from "react-native-svg";

const SCREEN_W = Dimensions.get("window").width;

export type MonthlyStatItem = {
  year: number;
  month: number;
  revenue: number;
  attendance: number;
  attendanceRate: number;
};

const MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

export const MonthlyStatsChart = React.memo(function MonthlyStatsChart({ data }: { data: MonthlyStatItem[] }) {
  const CHART_W = SCREEN_W - 80;
  const CHART_H = 110;
  const BAR_GAP = 8;
  const LABEL_H = 20;
  const barCount = data.length;
  const barW = Math.floor((CHART_W - BAR_GAP * (barCount - 1)) / barCount);
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const maxAttendance = Math.max(...data.map((d) => d.attendance), 1);
  const maxRate = Math.max(...data.map((d) => d.attendanceRate), 1);

  return (
    <View style={{ marginHorizontal: 20, marginBottom: 16, backgroundColor: "#FAFAFA", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#F1F5F9" }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A", marginBottom: 16 }}>📊 최근 6개월 통계</Text>

      <Text style={{ fontSize: 11, color: "#6B7280", fontWeight: "600", marginBottom: 8 }}>💰 월별 매출</Text>
      <Svg width={CHART_W} height={CHART_H + LABEL_H}>
        <Line x1={0} y1={CHART_H} x2={CHART_W} y2={CHART_H} stroke="#E5E7EB" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = Math.max(4, Math.round((d.revenue / maxRevenue) * (CHART_H - 20)));
          const x = i * (barW + BAR_GAP);
          const y = CHART_H - barH;
          const isCurrentMonth = i === data.length - 1;
          return (
            <Svg key={`rev-${i}`}>
              <Rect x={x} y={y} width={barW} height={barH} rx={6} fill={isCurrentMonth ? "#1565C0" : "#BFDBFE"} />
              {isCurrentMonth && d.revenue > 0 && (
                <SvgText x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={9} fill="#1565C0" fontWeight="bold">
                  {d.revenue >= 10000 ? `${Math.round(d.revenue / 10000)}만` : String(d.revenue)}
                </SvgText>
              )}
              <SvgText x={x + barW / 2} y={CHART_H + 14} textAnchor="middle" fontSize={10}
                fill={isCurrentMonth ? "#1565C0" : "#9CA3AF"} fontWeight={isCurrentMonth ? "bold" : "normal"}>
                {MONTH_LABELS[d.month - 1]}
              </SvgText>
            </Svg>
          );
        })}
      </Svg>

      <View style={{ height: 1, backgroundColor: "#F1F5F9", marginVertical: 14 }} />

      <Text style={{ fontSize: 11, color: "#6B7280", fontWeight: "600", marginBottom: 8 }}>📈 월별 출석률 (추정 %)</Text>
      <Text style={{ fontSize: 10, color: "#94A3B8", marginBottom: 8 }}>
        활성 회원 수 × 월 22일 기준 (대시보드 이달 출석률과 동일 계산)
      </Text>
      <Svg width={CHART_W} height={CHART_H + LABEL_H}>
        <Line x1={0} y1={CHART_H} x2={CHART_W} y2={CHART_H} stroke="#E5E7EB" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = Math.max(4, Math.round((d.attendanceRate / maxRate) * (CHART_H - 20)));
          const x = i * (barW + BAR_GAP);
          const y = CHART_H - barH;
          const isCurrentMonth = i === data.length - 1;
          return (
            <Svg key={`rate-${i}`}>
              <Rect x={x} y={y} width={barW} height={barH} rx={6} fill={isCurrentMonth ? "#D97706" : "#FCD34D"} />
              {isCurrentMonth && (
                <SvgText x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={9} fill="#B45309" fontWeight="bold">
                  {d.attendanceRate}%
                </SvgText>
              )}
              <SvgText x={x + barW / 2} y={CHART_H + 14} textAnchor="middle" fontSize={10}
                fill={isCurrentMonth ? "#B45309" : "#9CA3AF"} fontWeight={isCurrentMonth ? "bold" : "normal"}>
                {MONTH_LABELS[d.month - 1]}
              </SvgText>
            </Svg>
          );
        })}
      </Svg>

      <View style={{ height: 1, backgroundColor: "#F1F5F9", marginVertical: 14 }} />

      <Text style={{ fontSize: 11, color: "#6B7280", fontWeight: "600", marginBottom: 8 }}>🥋 월별 출석 횟수</Text>
      <Svg width={CHART_W} height={CHART_H + LABEL_H}>
        <Line x1={0} y1={CHART_H} x2={CHART_W} y2={CHART_H} stroke="#E5E7EB" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = Math.max(4, Math.round((d.attendance / maxAttendance) * (CHART_H - 20)));
          const x = i * (barW + BAR_GAP);
          const y = CHART_H - barH;
          const isCurrentMonth = i === data.length - 1;
          return (
            <Svg key={`att-${i}`}>
              <Rect x={x} y={y} width={barW} height={barH} rx={6} fill={isCurrentMonth ? "#16A34A" : "#BBF7D0"} />
              {isCurrentMonth && d.attendance > 0 && (
                <SvgText x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={9} fill="#16A34A" fontWeight="bold">
                  {d.attendance}
                </SvgText>
              )}
              <SvgText x={x + barW / 2} y={CHART_H + 14} textAnchor="middle" fontSize={10}
                fill={isCurrentMonth ? "#16A34A" : "#9CA3AF"} fontWeight={isCurrentMonth ? "bold" : "normal"}>
                {MONTH_LABELS[d.month - 1]}
              </SvgText>
            </Svg>
          );
        })}
      </Svg>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#1565C0" }} />
          <Text style={{ fontSize: 11, color: "#6B7280" }}>매출·이번 달</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#BFDBFE" }} />
          <Text style={{ fontSize: 11, color: "#6B7280" }}>매출·이전 달</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#D97706" }} />
          <Text style={{ fontSize: 11, color: "#6B7280" }}>출석률·이번 달</Text>
        </View>
      </View>
    </View>
  );
});
