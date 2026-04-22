import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
  ViewProps,
  ViewStyle,
} from "react-native";
import { useColors } from "@/hooks/use-colors";

/**
 * 유도관 앱 전용 얇은 UI 프리미티브 모음.
 * - 공통 간격(spacing), 모서리(radius), 타이포그래피를 한 곳에서 관리.
 * - 각 프리미티브는 useColors()로 다크/라이트 팔레트를 자동 반영한다.
 * - 화면별 커스텀 색(예: 띠 색)은 color prop으로 주입받아 섞어 쓴다.
 */

// ─── 공통 디자인 상수 ────────────────────────────────────────────────────────

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({
  style,
  tone = "surface",
  padding = "md",
  children,
  ...rest
}: ViewProps & {
  tone?: "surface" | "background";
  padding?: keyof typeof spacing | "none";
}) {
  const c = useColors();
  const pad = padding === "none" ? 0 : spacing[padding];
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: tone === "surface" ? c.surface : c.background,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          padding: pad,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function PressableCard({
  style,
  tone = "surface",
  padding = "md",
  children,
  ...rest
}: TouchableOpacityProps & {
  tone?: "surface" | "background";
  padding?: keyof typeof spacing | "none";
}) {
  const c = useColors();
  const pad = padding === "none" ? 0 : spacing[padding];
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      {...rest}
      style={[
        {
          backgroundColor: tone === "surface" ? c.surface : c.background,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          padding: pad,
        },
        style,
      ]}
    >
      {children}
    </TouchableOpacity>
  );
}

// ─── Chip ────────────────────────────────────────────────────────────────────

export function Chip({
  label,
  color,
  size = "md",
  solid = false,
  style,
}: {
  label: string;
  color?: string;
  size?: "sm" | "md";
  solid?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  const base = color ?? c.primary;
  const paddingH = size === "sm" ? 8 : 12;
  const paddingV = size === "sm" ? 2 : 4;
  return (
    <View
      style={[
        {
          paddingHorizontal: paddingH,
          paddingVertical: paddingV,
          borderRadius: radius.pill,
          backgroundColor: solid ? base : base + "18",
          alignSelf: "flex-start",
        },
        style,
      ]}
    >
      <Text
        style={{
          fontSize: size === "sm" ? 11 : 12,
          fontWeight: "700",
          color: solid ? "#FFFFFF" : base,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── Section Header ──────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  emoji,
  right,
  style,
}: {
  title: string;
  emoji?: string;
  right?: React.ReactNode;
  style?: ViewStyle;
}) {
  const c = useColors();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.md,
        },
        style,
      ]}
    >
      <Text style={{ fontSize: 16, fontWeight: "800", color: c.foreground }}>
        {emoji ? `${emoji} ${title}` : title}
      </Text>
      {right}
    </View>
  );
}

// ─── Empty / Loading States ──────────────────────────────────────────────────

export function EmptyState({
  emoji = "📭",
  title,
  subtitle,
  action,
}: {
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: spacing.xl, gap: 6 }}>
      <Text style={{ fontSize: 44, marginBottom: spacing.sm }}>{emoji}</Text>
      <Text style={{ color: c.foreground, fontWeight: "700" }}>{title}</Text>
      {subtitle ? (
        <Text style={{ color: c.muted, textAlign: "center", lineHeight: 20 }}>{subtitle}</Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </View>
  );
}

export function LoadingView({ label }: { label?: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm }}>
      <ActivityIndicator size="large" color={c.primary} />
      {label ? <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text> : null}
    </View>
  );
}

// ─── Form Field ──────────────────────────────────────────────────────────────

export function FormField({
  label,
  hint,
  multiline,
  style,
  ...rest
}: TextInputProps & { label?: string; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ fontSize: 12, color: c.muted, fontWeight: "600" }}>{label}</Text>
      ) : null}
      <TextInput
        {...rest}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        placeholderTextColor={c.muted}
        style={[
          {
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: 10,
            fontSize: 14,
            color: c.foreground,
            backgroundColor: c.background,
            minHeight: multiline ? 80 : undefined,
            textAlignVertical: multiline ? "top" : "center",
          },
          style,
        ]}
      />
      {hint ? <Text style={{ fontSize: 11, color: c.muted }}>{hint}</Text> : null}
    </View>
  );
}

// ─── Solid / Ghost Buttons ───────────────────────────────────────────────────

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  const isOff = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isOff}
      activeOpacity={0.85}
      style={[
        {
          backgroundColor: c.primary,
          paddingVertical: 14,
          borderRadius: radius.md,
          alignItems: "center",
          opacity: isOff ? 0.5 : 1,
        },
        style,
      ]}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>
        {loading ? "처리 중..." : label}
      </Text>
    </TouchableOpacity>
  );
}

export function GhostButton({
  label,
  onPress,
  color,
  style,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  style?: ViewStyle;
}) {
  const c = useColors();
  const tint = color ?? c.muted;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      style={[
        {
          paddingVertical: 12,
          alignItems: "center",
        },
        style,
      ]}
    >
      <Text style={{ color: tint, fontWeight: "600" }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── FAB (Floating Action Button) ───────────────────────────────────────────

export function Fab({
  onPress,
  icon,
  color,
  bottom = 20,
  right = 20,
  accessibilityLabel,
}: {
  onPress: () => void;
  icon: React.ReactNode;
  color?: string;
  bottom?: number;
  right?: number;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        position: "absolute",
        right,
        bottom,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: color ?? c.primary,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 5,
      }}
    >
      {icon}
    </TouchableOpacity>
  );
}

// ─── 헤더의 "+ 추가" 같은 pill 버튼 ─────────────────────────────────────────

export function PillButton({
  label,
  onPress,
  color,
  solid = true,
  style,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  solid?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  const base = color ?? c.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        {
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radius.pill,
          backgroundColor: solid ? base : "transparent",
          borderWidth: solid ? 0 : 1,
          borderColor: base,
        },
        style,
      ]}
    >
      <Text style={{ color: solid ? "#FFFFFF" : base, fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Hook: 자주 쓰는 파생 색 ─────────────────────────────────────────────────

export function useSemanticColors() {
  const c = useColors();
  return useMemo(
    () => ({
      ...c,
      urgentBg: c.warning + "18",
      urgentFg: c.warning,
      dangerBg: c.error + "14",
      dangerFg: c.error,
      successBg: c.success + "18",
      successFg: c.success,
      primarySoft: (c as any).primarySoft ?? c.primary + "18",
    }),
    [c],
  );
}
