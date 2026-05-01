import React from "react";
import {
  Text,
  TouchableOpacity,
  type TouchableOpacityProps,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";

export const dojoPalette = {
  ink: "#111827",
  inkSoft: "#1F2937",
  blue: "#1D4ED8",
  blueSoft: "#DBEAFE",
  cyan: "#67E8F9",
  emerald: "#047857",
  emeraldSoft: "#D1FAE5",
  gold: "#F5C542",
  goldSoft: "#FFF7D6",
  red: "#E11D48",
  violet: "#6D5DF6",
  tatami: "#F7F1E3",
  paper: "#FFFDF7",
  cloud: "#EEF5FF",
  slate: "#64748B",
  line: "#E2E8F0",
} as const;

export const dojoShadow = {
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 16 },
  shadowOpacity: 0.12,
  shadowRadius: 28,
  elevation: 8,
} satisfies ViewStyle;

export const dojoSoftShadow = {
  shadowColor: "#0F172A",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.08,
  shadowRadius: 18,
  elevation: 4,
} satisfies ViewStyle;

type DojoVariant = "student" | "parent" | "admin" | "calendar";

const variantAccent: Record<DojoVariant, string> = {
  student: dojoPalette.blue,
  parent: dojoPalette.emerald,
  admin: dojoPalette.violet,
  calendar: dojoPalette.blue,
};

const variantSurface: Record<DojoVariant, string> = {
  student: "#EEF5FF",
  parent: "#ECFDF5",
  admin: "#F4F2FF",
  calendar: "#F6F0FF",
};

export function DojoBackdrop({
  children,
  style,
  variant = "student",
  ...rest
}: ViewProps & { variant?: DojoVariant }) {
  const accent = variantAccent[variant];
  const surface = variantSurface[variant];

  return (
    <View
      {...rest}
      style={[
        {
          flex: 1,
          backgroundColor: surface,
          overflow: "hidden",
        },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -120,
          right: -90,
          width: 240,
          height: 240,
          borderRadius: 120,
          backgroundColor: accent + "22",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 130,
          left: -80,
          width: 180,
          height: 180,
          borderRadius: 90,
          backgroundColor: dojoPalette.gold + "24",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: -80,
          right: 20,
          width: 170,
          height: 170,
          borderRadius: 85,
          backgroundColor: "#FFFFFF66",
        }}
      />
      {children}
    </View>
  );
}

export function DojoHeroCard({
  action,
  eyebrow,
  metric,
  subtitle,
  title,
  variant = "student",
}: {
  action?: React.ReactNode;
  eyebrow: string;
  metric?: string;
  subtitle: string;
  title: string;
  variant?: DojoVariant;
}) {
  const accent = variantAccent[variant];
  const isAdmin = variant === "admin";

  return (
    <View
      style={[
        {
          marginHorizontal: 20,
          marginTop: 14,
          marginBottom: 18,
          borderRadius: 30,
          backgroundColor: isAdmin ? dojoPalette.ink : accent,
          padding: 22,
          overflow: "hidden",
        },
        dojoShadow,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -60,
          right: -45,
          width: 160,
          height: 160,
          borderRadius: 80,
          backgroundColor: "#FFFFFF22",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: -48,
          left: -24,
          width: 130,
          height: 130,
          borderRadius: 65,
          backgroundColor: dojoPalette.gold + (isAdmin ? "33" : "28"),
        }}
      />
      <Text style={{ color: "#FFFFFFB8", fontSize: 12, fontWeight: "900", letterSpacing: 0.8, marginBottom: 10 }}>
        {eyebrow}
      </Text>
      <Text style={{ color: "#FFFFFF", fontSize: 27, fontWeight: "900", letterSpacing: -0.8, lineHeight: 34 }}>
        {title}
      </Text>
      <Text style={{ color: "#FFFFFFD9", fontSize: 13, fontWeight: "700", lineHeight: 20, marginTop: 10, maxWidth: 270 }}>
        {subtitle}
      </Text>
      {(metric || action) && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, gap: 12 }}>
          {metric ? (
            <View style={{ borderRadius: 999, backgroundColor: "#FFFFFF22", paddingHorizontal: 13, paddingVertical: 8 }}>
              <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>{metric}</Text>
            </View>
          ) : (
            <View />
          )}
          {action}
        </View>
      )}
    </View>
  );
}

export function DojoStatTile({
  accent = dojoPalette.blue,
  detail,
  label,
  value,
  style,
}: {
  accent?: string;
  detail?: string;
  label: string;
  value: string | number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          flex: 1,
          minHeight: 96,
          borderRadius: 24,
          backgroundColor: dojoPalette.paper,
          borderWidth: 1,
          borderColor: accent + "28",
          padding: 15,
        },
        dojoSoftShadow,
        style,
      ]}
    >
      <View style={{ width: 30, height: 4, borderRadius: 999, backgroundColor: accent, marginBottom: 14 }} />
      <Text style={{ color: dojoPalette.slate, fontSize: 11, fontWeight: "900", marginBottom: 6 }}>{label}</Text>
      <Text style={{ color: dojoPalette.ink, fontSize: 22, fontWeight: "900", letterSpacing: -0.6 }}>{value}</Text>
      {detail ? <Text style={{ color: dojoPalette.slate, fontSize: 11, fontWeight: "700", marginTop: 5 }}>{detail}</Text> : null}
    </View>
  );
}

export function DojoActionCard({
  accent = dojoPalette.blue,
  description,
  icon,
  title,
  style,
  ...rest
}: TouchableOpacityProps & {
  accent?: string;
  description: string;
  icon: string;
  title: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      {...rest}
      style={[
        {
          borderRadius: 23,
          backgroundColor: dojoPalette.paper,
          borderWidth: 1,
          borderColor: accent + "20",
          padding: 15,
          flexDirection: "row",
          alignItems: "center",
          gap: 13,
        },
        dojoSoftShadow,
        style,
      ]}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 17,
          backgroundColor: accent + "16",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 23 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: dojoPalette.ink, fontSize: 15, fontWeight: "900", marginBottom: 3 }}>{title}</Text>
        <Text style={{ color: dojoPalette.slate, fontSize: 12, fontWeight: "700", lineHeight: 17 }}>{description}</Text>
      </View>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 12,
          backgroundColor: accent + "12",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: accent, fontSize: 20, fontWeight: "900", lineHeight: 22 }}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export function DojoSectionTitle({
  action,
  eyebrow,
  style,
  title,
}: {
  action?: React.ReactNode;
  eyebrow?: string;
  style?: ViewStyle;
  title: string;
}) {
  return (
    <View
      style={[
        { marginHorizontal: 20, marginBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
        style,
      ]}
    >
      <View>
        {eyebrow ? (
          <Text style={{ color: dojoPalette.slate, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 4 }}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={{ color: dojoPalette.ink, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 }}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function DojoProgressBar({
  accent = dojoPalette.blue,
  progress,
}: {
  accent?: string;
  progress: number;
}) {
  return (
    <View style={{ height: 10, borderRadius: 999, backgroundColor: "#E2E8F0", overflow: "hidden" }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(progress, 100))}%`,
          height: "100%",
          borderRadius: 999,
          backgroundColor: accent,
        }}
      />
    </View>
  );
}

export function DojoPill({
  label,
  tone = "light",
}: {
  label: string;
  tone?: "dark" | "light";
}) {
  return (
    <View
      style={{
        borderRadius: 999,
        backgroundColor: tone === "dark" ? "#111827" : "#FFFFFFDD",
        paddingHorizontal: 12,
        paddingVertical: 7,
      }}
    >
      <Text style={{ color: tone === "dark" ? "#FFFFFF" : dojoPalette.ink, fontSize: 11, fontWeight: "900" }}>{label}</Text>
    </View>
  );
}
