import React from "react";
import { View, Text, Dimensions } from "react-native";
import Svg, { Text as SvgText, Line, Circle, Polyline } from "react-native-svg";

const SCREEN_W = Dimensions.get("window").width;

export const DailyAttendanceLineChart = React.memo(function DailyAttendanceLineChart({
  data,
}: {
  data: { day: number; count: number }[];
}) {
  const CHART_W = SCREEN_W - 80;
  const CHART_H = 100;
  const LABEL_H = 20;
  const PADDING = 14;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();

  const countMap: Record<number, number> = {};
  for (const d of data) countMap[d.day] = d.count;
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const points: { x: number; y: number; day: number; count: number }[] = [];
  for (let d = 1; d <= today; d++) {
    const count = countMap[d] ?? 0;
    const x = PADDING + ((d - 1) / Math.max(daysInMonth - 1, 1)) * (CHART_W - PADDING * 2);
    const y = CHART_H - PADDING - (count / maxCount) * (CHART_H - PADDING * 2);
    points.push({ x, y, day: d, count });
  }

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const todayPoint = points[points.length - 1];
  const xLabels = [1, 10, 20, today].filter((v, i, arr) => arr.indexOf(v) === i && v <= today);
  const totalAttendance = data.reduce((s, d) => s + d.count, 0);

  return (
    <View style={{ marginHorizontal: 20, marginBottom: 16, backgroundColor: "#EFF6FF", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#BFDBFE" }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#1E3A5F" }}>📈 이번 달 일별 출석</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#1565C0" }}>{totalAttendance}</Text>
            <Text style={{ fontSize: 9, color: "#6B7280" }}>총 출석</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#1565C0" }}>{todayPoint?.count ?? 0}</Text>
            <Text style={{ fontSize: 9, color: "#6B7280" }}>오늘</Text>
          </View>
        </View>
      </View>
      <Svg width={CHART_W} height={CHART_H + LABEL_H}>
        {[0.25, 0.5, 0.75].map((ratio, i) => {
          const y = CHART_H - PADDING - ratio * (CHART_H - PADDING * 2);
          return <Line key={i} x1={PADDING} y1={y} x2={CHART_W - PADDING} y2={y} stroke="#DBEAFE" strokeWidth={1} />;
        })}
        <Line x1={PADDING} y1={CHART_H - PADDING} x2={CHART_W - PADDING} y2={CHART_H - PADDING} stroke="#BFDBFE" strokeWidth={1} />
        {points.length >= 2 && (
          <Polyline points={polylinePoints} fill="none" stroke="#1565C0" strokeWidth={2.5}
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {points.filter((p) => p.count > 0).map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill="#1565C0" />
        ))}
        {todayPoint && todayPoint.count > 0 && (
          <>
            <Circle cx={todayPoint.x} cy={todayPoint.y} r={8} fill="#1565C030" />
            <Circle cx={todayPoint.x} cy={todayPoint.y} r={5} fill="#1565C0" />
            <SvgText x={todayPoint.x} y={todayPoint.y - 12} textAnchor="middle" fontSize={10} fill="#1565C0" fontWeight="bold">
              {todayPoint.count}명
            </SvgText>
          </>
        )}
        {xLabels.map((d) => {
          const x = PADDING + ((d - 1) / Math.max(daysInMonth - 1, 1)) * (CHART_W - PADDING * 2);
          return (
            <SvgText key={d} x={x} y={CHART_H + 14} textAnchor="middle" fontSize={9}
              fill={d === today ? "#1565C0" : "#9CA3AF"} fontWeight={d === today ? "bold" : "normal"}>
              {d === today ? "오늘" : `${d}일`}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
});
